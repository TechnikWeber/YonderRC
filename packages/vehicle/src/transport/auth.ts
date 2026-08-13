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
