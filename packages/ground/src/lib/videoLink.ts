/**
 * Pure decisions around the FPV link: which stream to show, and how hard to keep
 * trying when there is nothing to show.
 */

import { VIDEO_PATH } from '@yonderrc/protocol';

/**
 * The stream that should be selected, given the vehicle's list and the current pick.
 *
 * The empty case is the point: **no cameras means no selection**. Keeping the last id
 * around left the panel asking a vehicle that has no streams for a stream that no
 * longer exists, once every few seconds, forever — deleting every camera has to be a
 * quiet, valid state. Running YonderRC as a plain IP receiver for line-of-sight
 * driving is a legitimate setup, not a misconfiguration.
 */
export function selectedCamera(cameras: string[], current: string): string {
  if (cameras.length === 0) return '';
  return cameras.includes(current) ? current : cameras[0];
}

/**
 * Backoff between reconnect attempts, in ms.
 *
 * Fast at first, because the common failure is a blip and the picture should come
 * straight back. But a camera that is unplugged does not come back within the minute,
 * and a five-second retry forever is a storm: on a phone every attempt is a fresh
 * RTCPeerConnection plus ICE, and that work competes with the 20 ms control loop.
 * So the interval widens once it is clear this is not a blip.
 */
export function reconnectDelayMs(attempt: number): number {
  if (attempt < 4) return 500 * 2 ** attempt; // 0.5s, 1s, 2s, 4s — a blip is covered
  if (attempt < 10) return 5000; // ~30 s more of brisk retries
  if (attempt < 20) return 15000;
  return 30000; // gone for good: keep a slow pulse, stop hammering
}

/**
 * The API secret for the video request, or '' — and only ever for the vehicle itself.
 *
 * Since v1.70.1 the ground asks the vehicle for video (its /video path) instead of
 * talking to go2rtc directly, and a vehicle with an API secret wants it there too. A
 * video URL pointed at some other machine must not be handed the secret, so it goes
 * only where the control link goes: the same host and port.
 */
export function videoSecretFor(videoBase: string | null, wsUrl: string, secret: string): string {
  if (!videoBase || !secret) return '';
  try {
    const v = new URL(videoBase);
    const w = new URL(wsUrl.replace(/^ws/, 'http'));
    return v.host === w.host ? secret : '';
  } catch {
    return '';
  }
}

/** Where the WebRTC offer for one camera goes. */
export function whepUrl(baseUrl: string, src: string, secret = ''): string {
  return `${baseUrl}/api/webrtc?src=${encodeURIComponent(src)}${secret ? `&secret=${encodeURIComponent(secret)}` : ''}`;
}

/**
 * Where the ground asks for video: over the control link's own address, whenever the
 * vehicle serves the video itself.
 *
 * Since v1.70.1 a vehicle serves video on its `/video` path, and reports it under
 * whatever host it has stored for itself. That need not be the address the ground
 * reached it on — `yonderrc.local` where the ground used the IP, a LAN address where it
 * came over Tailscale, plain http behind an HTTPS proxy. Taken at its word, the video
 * URL then missed the vehicle, or reached it under a name the API secret is not sent to
 * (`videoSecretFor`), and the vehicle refused the video. So a reported `/video` path is
 * resolved against the control link: same scheme, host and port. Video goes wherever
 * control goes.
 *
 * Older vehicles report go2rtc itself (`http://localhost:1984`); there only a loopback
 * host is swapped for the link's host, as before. Anything else is a video server of
 * the operator's own and is used as reported.
 */
export function effectiveVideoBase(reported: string | null | undefined, wsUrl: string): string | null {
  if (!reported) return null;
  let v: URL;
  let link: URL;
  try {
    v = new URL(reported);
    link = new URL(wsUrl.replace(/^ws/, 'http'));
  } catch {
    return reported;
  }
  if (v.pathname.replace(/\/+$/, '') === VIDEO_PATH) return `${link.protocol}//${link.host}${VIDEO_PATH}`;
  if ((v.hostname === 'localhost' || v.hostname === '127.0.0.1') && link.hostname) v.hostname = link.hostname;
  return v.toString().replace(/\/$/, '');
}

/**
 * What the operator reads when the video offer is answered with an error — instead of a
 * panel that says "Reconnecting…" forever. `detail` is the answer's own text: the
 * vehicle says what is wrong (go2rtc not running, no camera of that name), go2rtc says
 * why a stream failed. Null when there is nothing better to say than retrying.
 */
export function videoProblem(status: number, detail = ''): string | null {
  if (status === 401) return 'the vehicle wants its API secret for video — enter it next to the address.';
  if (status === 403)
    return 'the vehicle refused the video request. Desktop app and vehicle on the same computer: connect via the computer’s network address instead of localhost, or set an API secret.';
  if (status < 400) return null;
  const said = detail.trim().split('\n')[0].trim().slice(0, 200);
  return said || `the vehicle answered HTTP ${status} to the video request.`;
}
