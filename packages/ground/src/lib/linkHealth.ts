/**
 * Link quality as ONE number.
 *
 * Round-trip, packet loss and radio signal are three readouts you have to combine
 * in your head while driving, and the combination is what actually matters. This
 * turns them into a 0–100 score with a trend, and keeps the parts available for
 * the moment the score goes bad — because "link 34, falling" tells you to react
 * but not how, whereas "loss 12%" versus "signal 18%" point at different fixes
 * (drop the bitrate, versus turn the antenna or get closer).
 */

export type LinkLevel = 'good' | 'fair' | 'bad';
export type LinkTrend = 'up' | 'flat' | 'down';

export type SignalKind = 'lte' | 'wifi' | 'ethernet' | 'none';

export interface LinkInputs {
  /** Control round-trip in ms, or null when unknown. */
  rttMs: number | null;
  /** Video packet loss in percent, or null when unknown. */
  lossPct: number | null;
  /** Radio signal 0–100 (LTE or WiFi), or null when there is no radio reading. */
  signalPct: number | null;
  /** Which radio the percentage came from — it decides how to read it. */
  signalKind?: SignalKind;
}

export interface LinkHealth {
  /** 0–100, or null when nothing is known yet (not connected). */
  score: number | null;
  level: LinkLevel;
  /** Which input is dragging the score down — what to actually fix. */
  worst: 'rtt' | 'loss' | 'signal' | null;
  /** Per-input sub-scores, for the detail view. Null where the input was null. */
  parts: { rtt: number | null; loss: number | null; signal: number | null };
}

/** Below this the link is degrading; below BAD it is failing. */
export const LINK_FAIR = 70;
export const LINK_BAD = 40;

/** Round-trip: perfect up to 50 ms, useless from 500 ms. */
export function rttScore(ms: number): number {
  return band(ms, 50, 500);
}
/** Loss: perfect at 0%, useless from 10%. */
export function lossScore(pct: number): number {
  return band(pct, 0, 10);
}

/**
 * Signal needs its own curve per radio, because **a radio's percentage is not a
 * quality score**. Treating it as one is what put a permanent ⚠ SIGNAL on a link
 * that was fine: a HiLink stick derives its percentage from RSRP over
 * −140…−75 dBm, so a thoroughly usable −100 dBm reads as 62 % — and 62 was taken
 * straight as the score, landing under the 70 that means "good".
 *
 * The bands below are the point where each radio actually starts to hurt:
 *  - **LTE**: 60 % is RSRP ≈ −101 dBm and still fine; 30 % is ≈ −120 dBm, the edge
 *    of coverage. Between them the score falls off.
 *  - **WiFi**: the percentage is a linear map of −100…−50 dBm, so 60 % is −70 dBm
 *    (the usual "reliable" mark) and 25 % is −87 dBm (about to drop).
 *
 * A cable has no signal to worry about.
 */
export function signalScore(pct: number, kind: SignalKind = 'lte'): number {
  if (kind === 'ethernet') return 100;
  const [bad, good] = kind === 'wifi' ? [25, 60] : [30, 60];
  return bandUp(pct, bad, good);
}

/** Linear 0→100 between `bad` and `good`, clamped — for readings where more is better. */
function bandUp(value: number, bad: number, good: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value >= good) return 100;
  if (value <= bad) return 0;
  return Math.round(((value - bad) / (good - bad)) * 100);
}

/** Linear 100→0 between `good` and `bad`, clamped at both ends. */
function band(value: number, good: number, bad: number): number {
  if (!Number.isFinite(value)) return 100;
  if (value <= good) return 100;
  if (value >= bad) return 0;
  return Math.round(((bad - value) / (bad - good)) * 100);
}

/**
 * The score is the WORST of the parts, not an average. A link with a perfect
 * signal and 15% packet loss is a bad link; averaging would call it fair and hide
 * exactly the thing that will bite.
 */
export function linkHealth(inputs: LinkInputs): LinkHealth {
  const parts = {
    rtt: inputs.rttMs == null ? null : rttScore(inputs.rttMs),
    loss: inputs.lossPct == null ? null : lossScore(inputs.lossPct),
    signal: inputs.signalPct == null ? null : signalScore(clamp100(inputs.signalPct), inputs.signalKind ?? 'lte'),
  };
  const known = (Object.entries(parts) as ['rtt' | 'loss' | 'signal', number | null][])
    .filter((e): e is ['rtt' | 'loss' | 'signal', number] => e[1] !== null);
  if (known.length === 0) return { score: null, level: 'bad', worst: null, parts };

  let worst = known[0];
  for (const e of known) if (e[1] < worst[1]) worst = e;
  const score = worst[1];
  return {
    score,
    level: score >= LINK_FAIR ? 'good' : score >= LINK_BAD ? 'fair' : 'bad',
    // Only name a culprit once it is actually pulling the score down; at 95 there
    // is nothing to fix and pointing at the "worst" part would be noise.
    worst: score >= LINK_FAIR ? null : worst[0],
    parts,
  };
}

function clamp100(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(100, Math.round(v)));
}

/** Ignore wobble — only a real move counts as a trend. */
export const TREND_DEADBAND = 8;

/**
 * Direction of travel over a short history (oldest first). Compares the recent
 * half against the older half, so a single noisy sample can't flip the arrow.
 */
export function linkTrend(history: number[]): LinkTrend {
  const h = history.filter((v) => Number.isFinite(v));
  if (h.length < 4) return 'flat';
  const half = Math.floor(h.length / 2);
  const older = mean(h.slice(0, half));
  const recent = mean(h.slice(h.length - half));
  const delta = recent - older;
  if (delta > TREND_DEADBAND) return 'up';
  if (delta < -TREND_DEADBAND) return 'down';
  return 'flat';
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Arrow for the badge. Flat gets nothing rather than a neutral glyph. */
export function trendArrow(t: LinkTrend): string {
  return t === 'up' ? '▲' : t === 'down' ? '▼' : '';
}

/**
 * Whether the numbers behind the score should be on screen. They appear by
 * themselves once the link stops being good — that is the moment you need them,
 * and the moment you can't go looking for a setting.
 */
export function showLinkDetail(level: LinkLevel, userForced: boolean): boolean {
  return userForced || level !== 'good';
}
