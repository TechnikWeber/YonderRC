import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, normalize, extname } from 'node:path';
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

/** Returns true if it served something. */
export function serveGroundApp(req: IncomingMessage, res: ServerResponse): boolean {
  if (!groundAppAvailable()) return false;
  const urlPath = (req.url ?? '/').split('?')[0];

  // Resolve to a file inside DIST; guard against path traversal.
  let rel = normalize(decodeURIComponent(urlPath)).replace(/^(\.\.[/\\])+/, '');
  if (rel === '/' || rel === '') rel = 'index.html';
  let filePath = join(DIST, rel);
  if (!filePath.startsWith(DIST)) return false;

  // SPA fallback: unknown non-asset paths serve index.html.
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(DIST, 'index.html');
  }

  const type = TYPES[extname(filePath)] ?? 'application/octet-stream';
  res.writeHead(200, { 'content-type': type });
  createReadStream(filePath).pipe(res);
  return true;
}
