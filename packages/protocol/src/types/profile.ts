/**
 * Profile & binding schema.
 *
 * A profile stores, per output channel, HOW an input drives it. This is what
 * makes "profile A = sticks, profile B = plain buttons, profile C = hold-for-
 * proportional buttons" fall out of one model instead of being special cases.
 *
 * v0.1 uses a small subset of this (see ground/src/lib/input). The full editor
 * and persistence land in M1 — the shape is defined now so both sides agree.
 */

export type InputSource = 'gamepad' | 'keyboard' | 'onscreen' | 'virtual';

/**
 * How an input element maps onto a channel value.
 *  - proportional : axis value maps directly across the channel range
 *  - momentary    : channel = high while held, else low (tastend)
 *  - toggle       : each press flips between two positions (schaltend)
 *  - hold-ramp    : held button ramps toward a target, releases back to center
 *                   (the "proportional over hold duration" idea — TODO, M5)
 */
export type BindingMode = 'proportional' | 'momentary' | 'toggle' | 'hold-ramp';

export interface ChannelShaping {
  /** Trim offset in µs applied after the raw value. */
  trimUs: number;
  /** Exponential curve, 0 = linear .. 1 = maximum softening around center. */
  expo: number;
  /** Reverse channel direction. */
  reverse: boolean;
  /** Endpoint (EPA) limits in µs — never exceed the mechanical safe range. */
  minUs: number;
  maxUs: number;
  /** Value driven on the vehicle when the link is lost. */
  failsafeUs: number;
}

export interface ChannelBinding {
  /** Stable id so per-binding runtime state (toggle, ramp) survives edits. */
  id: string;
  channel: number; // 0-based index into the 16 channels
  source: InputSource;
  /** Identifier of the element on that source (axis index, key code, button id). */
  element: string;
  mode: BindingMode;
  /** For hold-ramp: full-travel time in seconds while held (default 0.5). */
  holdRampSeconds?: number;
  shaping: ChannelShaping;
}

export interface Profile {
  id: string;
  name: string;
  /** Output path on the vehicle this profile drives. */
  driver: 'sim' | 'pca9685' | 'gpio-pwm' | 'sbus';
  /** Channels forced safe while disarmed (typically throttle). */
  throttleChannels: number[];
  bindings: ChannelBinding[];
}
