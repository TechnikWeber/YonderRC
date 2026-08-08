import { CHANNEL_NEUTRAL_US, clamp, clampChannelUs } from './channels';
import type { ChannelShaping } from './types/profile';

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
export function shapeSwitch(on: boolean, s: ChannelShaping): number {
  const active = s.reverse ? !on : on;
  return clampChannelUs(active ? s.maxUs : s.minUs);
}
