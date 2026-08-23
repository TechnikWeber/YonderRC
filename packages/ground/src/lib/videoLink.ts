/**
 * Pure decisions around the FPV link: which stream to show, and how hard to keep
 * trying when there is nothing to show.
 */

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
