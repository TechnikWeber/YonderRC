import type { IncomingMessage, ServerResponse } from 'node:http';
import { VIDEO_PATH } from '@yonderrc/protocol';
import { originAllowed, originOf, readSecretFromReq, secFetchSiteOf, secretOk } from './auth.js';

/**
 * Video through the vehicle service.
 *
 * go2rtc's API answers on the vehicle only (see generateGo2rtcYaml): it is full control
 * of go2rtc, which runs as root, and it used to be open to the whole network — without
 * the API secret, with `origin: *`. The ground needs exactly one call of it, the WebRTC
 * offer, and the setup page one more, a snapshot. Those two come through here, under the
 * same rules as the rest of the vehicle's API (origin, API secret), and only for the
 * cameras that are configured. The WebRTC media itself still flows straight from go2rtc
 * (port 8555) — only the signalling takes this detour.
 */

/** go2rtc's API on the vehicle itself. `YRC_GO2RTC_API` overrides it. */
export const GO2RTC_API_DEFAULT = 'http://127.0.0.1:1984';

/** The go2rtc calls passed on, and nothing else. */
const ROUTES: Record<string, { method: 'GET' | 'POST'; timeoutMs: number }> = {
  '/api/webrtc': { method: 'POST', timeoutMs: 10_000 },
  '/api/frame.jpeg': { method: 'GET', timeoutMs: 15_000 },
};

/** An SDP offer is a few KB; anything far past that is not one. */
const MAX_BODY_BYTES = 256 * 1024;

export type VideoProxyDecision =
  | { ok: true; method: 'GET' | 'POST'; upstream: string; timeoutMs: number }
  | { ok: false; status: number; message: string };

/**
 * Where a request under /video goes upstream, or why it is refused. A known route with
 * its method, and a `src` that is one of the configured cameras — matched exactly, and
 * the only parameter passed on: go2rtc builds a stream from any source URL it is handed,
 * `exec:` (a command) included, so `src` is the dangerous one.
 */
export function videoProxyTarget(
  method: string,
  path: string,
  query: string,
  streams: readonly string[],
  apiUrl: string,
): VideoProxyDecision {
  const sub = path.startsWith(VIDEO_PATH + '/') ? path.slice(VIDEO_PATH.length) : '';
  const route = ROUTES[sub];
  if (!route) return { ok: false, status: 404, message: 'Not available through the vehicle.' };
  if (method !== route.method) return { ok: false, status: 405, message: `Use ${route.method}.` };
  const src = new URLSearchParams(query).get('src') ?? '';
  if (!src || !streams.includes(src)) return { ok: false, status: 404, message: 'No camera of that name on this vehicle.' };
  return {
    ok: true,
    method: route.method,
    upstream: `${apiUrl.replace(/\/$/, '')}${sub}?src=${encodeURIComponent(src)}`,
    timeoutMs: route.timeoutMs,
  };
}

/**
 * A stored video URL that points at go2rtc's own port, moved to the vehicle's video
 * path on the same host. Up to v1.70.0 the ground talked to go2rtc directly on :1984,
 * and that is what almost every vehicle has stored — the setup form saved the field
 * with every Save. That port now answers on the vehicle only.
 */
export function migrateVideoUrl(url: string | null, port: number): string | null {
  if (!url) return url;
  try {
    const u = new URL(url);
    if (u.port !== '1984') return url;
    u.port = String(port);
    u.pathname = VIDEO_PATH;
    u.search = '';
    u.hash = '';
    return u.toString().replace(/\/$/, '');
  } catch {
    return url;
  }
}

export interface VideoProxyContext {
  /** go2rtc's API (config.go2rtcApiUrl). */
  apiUrl: string;
  /** The configured cameras' stream names (safeStreamName), read per request. */
  streams: () => readonly string[];
  /** The API secret, read per request so a change applies at once. */
  secret: () => string | null;
}

async function readLimited(req: IncomingMessage, max: number): Promise<Buffer | null> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > max) return null;
    chunks.push(c as Buffer);
  }
  return Buffer.concat(chunks);
}

/** True when the request was for the video path — answered, whatever the outcome. */
export async function handleVideoProxy(req: IncomingMessage, res: ServerResponse, ctx: VideoProxyContext): Promise<boolean> {
  const raw = req.url ?? '';
  const q = raw.indexOf('?');
  const path = q < 0 ? raw : raw.slice(0, q);
  const query = q < 0 ? '' : raw.slice(q + 1);
  if (path !== VIDEO_PATH && !path.startsWith(VIDEO_PATH + '/')) return false;

  const reply = (status: number, message: string) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8', 'access-control-allow-origin': '*' });
    res.end(message);
  };

  // The same two rules as every other door of the vehicle: no page from the internet,
  // and the API secret when one is set (`?secret=`, so neither the ground nor an <img>
  // needs a header).
  const secret = ctx.secret();
  const provided = readSecretFromReq(req);
  const secretProven = !!secret && secretOk(secret, provided);
  if (!originAllowed(originOf(req), secretProven, req.headers.host, secFetchSiteOf(req))) {
    reply(403, 'Refused: a page from outside this network may not open this vehicle’s video.');
    return true;
  }
  if (!secretOk(secret, provided)) {
    reply(401, 'Unauthorized — provide the API secret.');
    return true;
  }

  const d = videoProxyTarget(req.method ?? 'GET', path, query, ctx.streams(), ctx.apiUrl);
  if (!d.ok) {
    reply(d.status, d.message);
    return true;
  }

  // An SDP offer is text.
  let body: string | undefined;
  if (d.method === 'POST') {
    const b = await readLimited(req, MAX_BODY_BYTES);
    if (!b) {
      reply(413, 'Request too large.');
      return true;
    }
    body = b.toString('utf8');
  }

  let status: number;
  let type: string;
  let payload: Buffer;
  try {
    const up = await fetch(d.upstream, {
      method: d.method,
      body,
      headers: body ? { 'content-type': String(req.headers['content-type'] ?? 'application/sdp') } : undefined,
      signal: AbortSignal.timeout(d.timeoutMs),
    });
    status = up.status;
    type = up.headers.get('content-type') ?? 'application/octet-stream';
    payload = Buffer.from(await up.arrayBuffer());
  } catch (err) {
    console.warn(`[video] go2rtc did not answer (${ctx.apiUrl}): ${(err as Error).message}`);
    reply(502, `go2rtc is not answering on ${ctx.apiUrl} — is it running?`);
    return true;
  }
  res.writeHead(status, { 'content-type': type, 'access-control-allow-origin': '*', 'cache-control': 'no-store' });
  res.end(payload);
  return true;
}
