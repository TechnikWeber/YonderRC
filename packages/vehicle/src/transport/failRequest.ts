import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * A request that throws costs that request, never the service. The HTTP handler used to
 * be fire-and-forget: a malformed URL raised a rejection nothing caught, Node ended the
 * process, and the servo board held its last value until systemd had started a new one.
 */
export function failRequest(req: IncomingMessage, res: ServerResponse, err: unknown): void {
  // The path only: a query can carry `?secret=`.
  const path = (req.url ?? '').split('?')[0];
  console.error(`[http] ${req.method ?? '?'} ${path} failed: ${(err as Error)?.message ?? String(err)}`);
  try {
    if (!res.headersSent) {
      res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('internal error');
    } else {
      res.destroy();
    }
  } catch {
    /* the socket is already gone */
  }
}
