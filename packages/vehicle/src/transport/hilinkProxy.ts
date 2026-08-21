import { createServer, request, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { secretOk } from './auth.js';

/**
 * Passes a HiLink stick's own web UI through the vehicle.
 *
 * The stick lives on its private 192.168.8.0/24, reachable only from the Pi itself —
 * so configuring it (APN, PIN, network mode) used to mean plugging a keyboard and a
 * screen into the vehicle, or moving the stick to a laptop. This makes it reachable
 * from wherever you already are: the vehicle's own AP, the LAN, or the VPN.
 *
 * It listens on its OWN port and proxies from the root, rather than under a path on
 * the setup server: the HiLink UI is full of absolute paths (`/api/…`, `/html/…`) and
 * rewriting them is a losing game, while a dedicated origin also keeps the stick's
 * SessionID cookie working exactly as it expects.
 *
 * When an API secret is configured it guards this port too — otherwise the vehicle
 * would hand the stick's admin UI to anyone who can reach it.
 */

const COOKIE = 'yrc_hilink';

/** Value of one cookie from a request's Cookie header. */
export function cookieValue(header: string | undefined, name: string): string | null {
  for (const part of (header ?? '').split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

export type ProxyAuth = 'ok' | 'set-cookie' | 'denied';

/**
 * Decide access for one request. Pure so the gate is testable: no secret means open
 * (same rule as the rest of the setup API), a matching `?secret=` earns a cookie so
 * the UI's own XHRs get through, and anything else is refused.
 */
export function proxyAuth(secret: string | null, query: string | null, cookieHeader: string | undefined): ProxyAuth {
  if (!secret) return 'ok';
  if (query != null && secretOk(secret, query)) return 'set-cookie';
  if (secretOk(secret, cookieValue(cookieHeader, COOKIE))) return 'ok';
  return 'denied';
}

export interface HilinkProxyHandle {
  port: number;
  close(): void;
}

export function startHilinkProxy(opts: {
  port: number;
  host: string;
  /** API secret, or null when the vehicle runs without one. */
  secret: string | null;
  /** The stick's HTTP port. Only tests move it off 80. */
  targetPort?: number;
  bindHost?: string;
  log?: (msg: string) => void;
}): HilinkProxyHandle {
  const log = opts.log ?? (() => {});
  const server: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', `http://${opts.host}`);
    const auth = proxyAuth(opts.secret, url.searchParams.get('secret'), req.headers.cookie);

    if (auth === 'denied') {
      res.writeHead(401, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('This vehicle has an API secret. Open this page once as  …/?secret=YOUR_SECRET\n');
      return;
    }
    if (auth === 'set-cookie') {
      // Trade the query parameter for a cookie so the stick's own XHRs are covered,
      // and drop the secret out of the address bar.
      const granted = url.searchParams.get('secret') ?? '';
      url.searchParams.delete('secret');
      res.writeHead(302, {
        'set-cookie': `${COOKIE}=${encodeURIComponent(granted)}; Path=/; HttpOnly; SameSite=Lax`,
        location: `${url.pathname}${url.search}`,
      });
      res.end();
      return;
    }

    // Forward as-is. The Host header is rewritten (the stick checks it) and our own
    // cookie is stripped so the stick never sees it.
    const headers: Record<string, string | string[]> = { ...req.headers } as Record<string, string | string[]>;
    headers.host = opts.host;
    if (typeof headers.cookie === 'string') {
      const kept = headers.cookie
        .split(';')
        .filter((c) => c.trim().split('=')[0] !== COOKIE)
        .join(';')
        .trim();
      if (kept) headers.cookie = kept;
      else delete headers.cookie;
    }

    const upstream = request(
      { host: opts.host, port: opts.targetPort ?? 80, method: req.method, path: req.url, headers, timeout: 8000 },
      (up) => {
        res.writeHead(up.statusCode ?? 502, up.headers);
        up.pipe(res);
      },
    );
    upstream.on('timeout', () => upstream.destroy(new Error('timeout')));
    upstream.on('error', (err) => {
      if (res.headersSent) {
        res.destroy();
        return;
      }
      res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' });
      res.end(
        `Could not reach the LTE stick at ${opts.host}: ${(err as Error).message}\n` +
          'Is it plugged in, and does `ip route get ' + opts.host + '` show an interface?\n',
      );
    });
    req.pipe(upstream);
  });

  server.on('error', (err) => log(`[hilink] proxy not started (${(err as NodeJS.ErrnoException).code ?? err.message})`));
  server.listen(opts.port, opts.bindHost ?? '0.0.0.0', () =>
    log(`[hilink] stick UI proxied on :${opts.port} → http://${opts.host}/`),
  );

  return {
    port: opts.port,
    close() {
      server.close();
    },
  };
}
