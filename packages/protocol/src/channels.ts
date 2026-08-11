/**
 * Channel model for YonderRC.
 *
 * Channel values are expressed in microseconds (µs) of servo pulse width —
 * the same unit an RC receiver outputs. Internally everything is µs so there
 * is exactly ONE representation of a channel value across the whole system.
 *
 * Lesson carried over from the old code: v2 mixed a 50 Hz PWM chip with a
 * 60 Hz constant in the pulse-width math, so every pulse was ~20% off. Here the
 * PWM frequency lives on the vehicle's driver only, and the wire always speaks
 * microseconds. Endpoints are conservative on purpose (v2 used 500–2500 µs and
 * drove servos past their mechanical stops).
 */

export const CHANNEL_COUNT = 16;

/** Nominal servo range — the DEFAULT endpoint window and the -1..1 unit mapping. */
export const CHANNEL_MIN_US = 1000;
export const CHANNEL_MAX_US = 2000;
export const CHANNEL_NEUTRAL_US = 1500;

/**
 * Absolute hard limits for a channel's µs value. Per-channel endpoints (EPA) may
 * be widened up to this extended range (many servos/ESCs accept 500–2500 µs); the
 * final safety clamp uses these bounds, not the nominal 1000–2000 window.
 */
export const CHANNEL_ABS_MIN_US = 500;
export const CHANNEL_ABS_MAX_US = 2500;

/** Control loop / send rate. RC standard is ~50 Hz, not the old 10 Hz poll. */
export const CONTROL_RATE_HZ = 50;
export const CONTROL_PERIOD_MS = 1000 / CONTROL_RATE_HZ;

/**
 * Link watchdog. If the vehicle receives no control frame within this window it
 * declares the link lost and drives every channel to its failsafe value.
 * This is time-based on purpose — it fires on a silent LTE drop, not only on a
 * clean TCP reset like the old code.
 */
export const WATCHDOG_TIMEOUT_MS = 300;

export function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

/** Clamp a single channel to the absolute safe µs window and round to an integer. */
export function clampChannelUs(us: number): number {
  return Math.round(clamp(us, CHANNEL_ABS_MIN_US, CHANNEL_ABS_MAX_US));
}

/** A fresh channel array with every channel at neutral. */
export function neutralChannels(): number[] {
  return new Array(CHANNEL_COUNT).fill(CHANNEL_NEUTRAL_US);
}

/**
 * Map a normalized axis in [-1, 1] to microseconds around neutral.
 * -1 → CHANNEL_MIN_US, 0 → CHANNEL_NEUTRAL_US, +1 → CHANNEL_MAX_US.
 */
export function axisToUs(value: number): number {
  const half = (CHANNEL_MAX_US - CHANNEL_MIN_US) / 2;
  return clampChannelUs(CHANNEL_NEUTRAL_US + clamp(value, -1, 1) * half);
}

/** Map µs back to a normalized [-1, 1] value (for meters / display). */
export function usToNormalized(us: number): number {
  const half = (CHANNEL_MAX_US - CHANNEL_MIN_US) / 2;
  return clamp((us - CHANNEL_NEUTRAL_US) / half, -1, 1);
}
