import type { IncomingMessage } from 'node:http';

/** Header the setup UI / ground send the shared secret in. */
export const SECRET_HEADER = 'x-yonderrc-secret';

/**
 * Is a request allowed given the configured secret? Pure so it's unit-tested.
 * A null/empty configured secret means the feature is OFF → always allowed
 * (first-time connect/setup needs nothing). Otherwise the provided value must
 * match exactly.
 */
export function secretOk(configured: string | null | undefined, provided: string | null | undefined): boolean {
  if (!configured) return true;
  return typeof provided === 'string' && provided === configured;
}

/** Pull the secret from a request: `x-yonderrc-secret` header or a `?secret=` query. */
export function readSecretFromReq(req: IncomingMessage): string | null {
  const h = req.headers[SECRET_HEADER];
  if (typeof h === 'string' && h) return h;
  return readSecretFromUrl(req.url);
}

/** Pull the `?secret=` query value from a request URL (used for the WebSocket). */
export function readSecretFromUrl(url: string | undefined): string | null {
  if (!url) return null;
  const q = url.indexOf('?');
  if (q < 0) return null;
  const params = new URLSearchParams(url.slice(q + 1));
  return params.get('secret');
}

/**
 * Where a browser request came FROM — the gap a shared secret does not close.
 *
 * The vehicle answers CORS preflights with `*`, and the secret is off by default,
 * so any page the operator happens to open in a browser on the same network can
 * POST to the vehicle: factory reset, a servo sweep, a camera or WiFi change, a
 * restart. The page cannot read the answer, but it does not need to — sending the
 * request is the damage. The same hole is wider on the control socket, because
 * WebSockets ignore CORS entirely: a foreign page can open one and arm the vehicle.
 *
 * What separates the operator's own tools from a random web page is not the port
 * or the path, it is where the page itself was served from:
 *
 *  - **no Origin at all** → not a browser (curl, a script, the tests) → allowed
 *  - **`file://`** → the packaged desktop app → allowed
 *  - **a private or loopback address, or a .local name** → something on this
 *    network: the ground app on the operator's laptop, the vehicle's own page,
 *    a Tailscale address → allowed
 *  - **anything else** → a page from the public internet, which has no business
 *    driving an RC vehicle → refused, unless it proves intent with the API secret
 *
 * That last clause also covers DNS rebinding: the attacker's page keeps its public
 * Origin even after its name resolves to 192.168.4.1.
 */
export function isLocalOrigin(origin: string | undefined | null): boolean {
  if (!origin) return false;
  const o = origin.trim();
  if (o === 'file://') return true;
  let host: string;
  try {
    // URL.hostname keeps the brackets around an IPv6 literal; nothing else does.
    host = new URL(o).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (!host) return false;
  if (host === '::1' || host === '0:0:0:0:0:0:0:1') return true;
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local')) return true;
  if (/^fe80:/.test(host) || /^f[cd][0-9a-f]{2}:/.test(host)) return true; // link-local / ULA
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  if (a === 127 || a === 10) return true;
  if (a === 192 && b === 168) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 169 && b === 254) return true; // link-local
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT range — Tailscale lives here
  return false;
}

/** Same host as the request was addressed to — a page the vehicle served itself. */
export function isSameOrigin(origin: string | undefined | null, host: string | undefined | null): boolean {
  if (!origin || !host) return false;
  try {
    const o = new URL(origin);
    // The Host header carries host[:port]; compare hosts, not ports, so the dev
    // ground on :5173 talking to :8080 on the same machine still counts.
    const hostName = host.toLowerCase().replace(/:\d+$/, '').replace(/^\[|\]$/g, '');
    return o.hostname.toLowerCase().replace(/^\[|\]$/g, '') === hostName && hostName !== '';
  } catch {
    return false;
  }
}

/**
 * May this request act on the vehicle? Browsers send Origin on every cross-site
 * request; everything else sends none. A valid secret always wins, so a ground app
 * hosted somewhere public still works once it is configured with one — and a page
 * the vehicle served itself is allowed whatever its address, which is what keeps a
 * vehicle reached over a public hostname working.
 */
export function originAllowed(
  origin: string | undefined | null,
  secretMatched: boolean,
  host?: string | undefined | null,
  secFetchSite?: string | undefined | null,
): boolean {
  if (secretMatched) return true;
  // Decisive when present: browsers send `Sec-Fetch-Site` on *every* request, which
  // covers the ones that carry no Origin at all — an `<img src>`, a `<script>`, a
  // plain form. Those cannot read an answer, but they can still make the vehicle do
  // something, and Origin alone would wave them through.
  const site = (secFetchSite ?? '').toLowerCase();
  if (site === 'cross-site') return false;
  if (site === 'same-origin' || site === 'same-site' || site === 'none') return true;
  if (origin === undefined || origin === null || origin === '') return true;
  if (isSameOrigin(origin, host)) return true;
  return isLocalOrigin(origin);
}

/** First value of a possibly-repeated header. */
export function secFetchSiteOf(req: IncomingMessage): string | undefined {
  const v = req.headers['sec-fetch-site'];
  return Array.isArray(v) ? v[0] : v;
}

/** First value of a possibly-repeated header. */
export function originOf(req: IncomingMessage): string | undefined {
  const o = req.headers.origin;
  return Array.isArray(o) ? o[0] : o;
}
