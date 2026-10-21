import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * Serves the built ground web app so a phone on the vehicle's own WiFi (AP mode)
 * can fly and configure without a laptop. It's an SPA, so unknown paths fall back
 * to index.html; real files (assets) are served directly.
 */

const DEFAULT_DIST = fileURLToPath(new URL('../../../ground/dist', import.meta.url));
const DIST = process.env.YRC_GROUND_DIST ?? DEFAULT_DIST;

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

export function groundAppAvailable(): boolean {
  return existsSync(join(DIST, 'index.html'));
}

/**
 * The file a request path names inside `dist`, or null when it cannot name one.
 *
 * `decodeURIComponent` throws on a malformed escape such as `/%E0%A4%A`, and it used to
 * throw straight out of the request handler: one stray request from any device on the
 * network ended the vehicle service, and the servo board held its last value until
 * systemd had started a new one.
 */
export function resolveGroundPath(dist: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  // Guard against path traversal: drop leading `../`, then check the result is inside.
  let rel = normalize(decoded).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel === '\\' || rel === '' || rel === '.') rel = 'index.html';
  const filePath = join(dist, rel);
  const root = dist.endsWith(sep) ? dist : dist + sep;
  if (filePath !== dist && !filePath.startsWith(root)) return null;
  return filePath;
}

/** Returns true if it answered the request. */
export function serveGroundApp(req: IncomingMessage, res: ServerResponse): boolean {
  if (!groundAppAvailable()) return false;
  const urlPath = (req.url ?? '/').split('?')[0];

  let filePath = resolveGroundPath(DIST, urlPath);
  if (filePath === null) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('bad request');
    return true;
  }

  // SPA fallback: unknown non-asset paths serve index.html.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, 'index.html');
  }

  const type = TYPES[extname(filePath)] ?? 'application/octet-stream';
  const stream = createReadStream(filePath);
  // A read error (file replaced by an update mid-request, permissions) is an 'error'
  // event — unhandled, that too ended the process.
  stream.on('error', (err) => {
    console.warn(`[http] could not read ${filePath}: ${err.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('could not read file');
    } else {
      res.destroy();
    }
  });
  stream.once('open', () => res.writeHead(200, { 'content-type': type }));
  stream.pipe(res);
  return true;
}
