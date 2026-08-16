import { CHANNEL_NEUTRAL_US, clamp, clampChannelUs } from './channels';
import type { ChannelCurve, ChannelShaping } from './types/profile';

/** Point counts a curve may have. Odd, so there is always a point at centre. */
export const CURVE_SIZES = [3, 5, 7, 9] as const;
export type CurveSize = (typeof CURVE_SIZES)[number];
export const CURVE_DEFAULT_SIZE: CurveSize = 5;

/** The straight line — a curve that changes nothing. */
export function identityCurve(size: CurveSize = CURVE_DEFAULT_SIZE): ChannelCurve {
  const n = size - 1;
  return { points: Array.from({ length: size }, (_, i) => -1 + (2 * i) / n) };
}

/**
 * Force a curve into a usable shape: a valid odd length, every point inside
 * [-1,1], and the two ends pinned to ±1 (see ChannelCurve — full travel must stay
 * reachable, or the resting stick would stop producing the channel's off value).
 * Anything unusable falls back to the identity curve rather than throwing, because
 * this also runs over profiles loaded from storage.
 */
export function normalizeCurve(curve: ChannelCurve | null | undefined): ChannelCurve | null {
  if (!curve || !Array.isArray(curve.points)) return null;
  const size = (CURVE_SIZES as readonly number[]).includes(curve.points.length)
    ? (curve.points.length as CurveSize)
    : CURVE_DEFAULT_SIZE;
  const base = identityCurve(size);
  const points = base.points.map((fallback, i) => {
    const v = curve.points[i];
    return Number.isFinite(v) ? clamp(v, -1, 1) : fallback;
  });
  points[0] = -1;
  points[points.length - 1] = 1;
  return { points };
}

/** True when the curve does nothing, so the UI can show it as "off". */
export function curveIsIdentity(curve: ChannelCurve | null | undefined): boolean {
  const c = normalizeCurve(curve);
  if (!c) return true;
  return c.points.every((p, i) => Math.abs(p - identityCurve(c.points.length as CurveSize).points[i]) < 1e-9);
}

/**
 * Map a normalized input through the curve, linearly interpolating between the
 * evenly spaced points. Outside [-1,1] the input is clamped first, so the result
 * can never leave the curve's own range.
 */
export function applyCurve(x: number, curve: ChannelCurve | null | undefined): number {
  const c = normalizeCurve(curve);
  if (!c) return clamp(x, -1, 1);
  const pts = c.points;
  const n = pts.length - 1;
  const v = clamp(x, -1, 1);
  // Position along the point array: 0 .. n.
  const pos = ((v + 1) / 2) * n;
  const i = Math.min(n - 1, Math.floor(pos));
  const t = pos - i;
  return clamp(pts[i] + (pts[i + 1] - pts[i]) * t, -1, 1);
}

/**
 * Standard RC exponential curve. e=0 is linear; higher e softens response around
 * center (fine control near neutral, full range still reachable at the extremes).
 *   out = (1 - e) * x + e * x^3
 */
export function applyExpo(x: number, e: number): number {
  const v = clamp(x, -1, 1);
  const exp = clamp(e, 0, 1);
  return (1 - exp) * v + exp * v * v * v;
}

/** Default, conservative shaping for a fresh channel binding. */
export function defaultShaping(): ChannelShaping {
  return {
    trimUs: 0,
    expo: 0,
    reverse: false,
    minUs: 1000,
    maxUs: 2000,
    failsafeUs: CHANNEL_NEUTRAL_US,
  };
}

/**
 * Turn a normalized proportional input in [-1, 1] into microseconds, applying
 * reverse → expo → endpoint (EPA) mapping → trim, then clamping to the channel's
 * own endpoints and the global safe range.
 */
export function shapeProportional(normalized: number, s: ChannelShaping): number {
  let v = clamp(normalized, -1, 1);
  if (s.reverse) v = -v;
  // Curve BEFORE expo, so the curve's X axis is the stick position itself — that
  // is what makes the curve editor readable. Expo then softens on top of it, and
  // with no curve set this line is the identity.
  v = applyCurve(v, s.curve);
  v = applyExpo(v, s.expo);
  const center = (s.minUs + s.maxUs) / 2;
  const half = (s.maxUs - s.minUs) / 2;
  const us = center + v * half + s.trimUs;
  return clampChannelUs(clamp(us, s.minUs, s.maxUs));
}

/**
 * A switch/momentary output: off → one endpoint, on → the other. Reverse swaps
 * which endpoint is "on", so a channel can be inverted without rewiring.
 */
export function shapeSwitch(on: boolean, s: ChannelShaping, restUs?: number): number {
  const active = s.reverse ? !on : on;
  return clampChannelUs(active ? s.maxUs : restUs ?? s.minUs);
}
