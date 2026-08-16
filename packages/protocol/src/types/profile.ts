/**
 * Profile & binding schema.
 *
 * A profile represents a MODEL (a car, plane, drone, boat …). It stores which
 * output channel each control drives, the input METHOD used to fly it
 * (keyboard / gamepad / touch), the global endpoint range, and per-stick detent
 * (self-centering) behaviour so different transmitter modes can be simulated.
 */

export type VehicleType = 'car' | 'plane' | 'drone' | 'boat';
export type InputMethod = 'keyboard' | 'gamepad' | 'touch';
export type InputSource = 'gamepad' | 'keyboard' | 'onscreen' | 'virtual';

/**
 * Detent = what a stick axis does when released:
 *  - center : springs back to the middle (neutral)
 *  - low    : springs to the minimum (e.g. throttle to idle)
 *  - free   : stays where you left it (ratcheted throttle feel)
 * Applies to touch and keyboard axes; a physical gamepad centers on its own.
 */
export type Detent = 'center' | 'low' | 'free';

/** The four stick axes, mode-2 layout by convention. */
export type StickAxis = 'leftX' | 'leftY' | 'rightX' | 'rightY';

/**
 * How an input element maps onto a channel value.
 *  - proportional : axis value maps directly across the channel range
 *  - momentary    : channel = high while held, else low (tastend)
 *  - toggle       : each press flips between two positions (schaltend)
 *  - hold-ramp    : held button ramps toward a target, releases back to center
 */
export type BindingMode = 'proportional' | 'momentary' | 'toggle' | 'hold-ramp';

/**
 * A multi-point response curve for one channel — what expo can't express: a
 * throttle that stays gentle to half stick and then opens up, a steering that is
 * soft at the extremes but direct in the middle, and so on.
 *
 * `points` are Y values at evenly spaced X from -1 (stick at one end) to +1 (the
 * other), with linear interpolation between them.
 *
 * **The first and last point are pinned to -1 and +1** and cannot be edited. A
 * channel's reachable travel is set by `minUs`/`maxUs`; letting the curve also cut
 * the ends would be a confusing second way to do the same thing — and, more
 * importantly, it would break the guarantee that the resting stick produces the
 * channel's "off" value, which the disarmed value and the pre-arm check depend on.
 * The curve shapes what happens BETWEEN the extremes.
 */
export interface ChannelCurve {
  points: number[];
}

export interface ChannelShaping {
  /** Trim offset in µs applied after the raw value. */
  trimUs: number;
  /** Exponential curve, 0 = linear .. 1 = maximum softening around center. */
  expo: number;
  /** Reverse channel direction. */
  reverse: boolean;
  /** Endpoint (EPA) limits in µs for THIS channel (default from profile.endpoints). */
  minUs: number;
  maxUs: number;
  /** Value driven on the vehicle when the link is lost. */
  failsafeUs: number;
  /**
   * Optional response curve, applied before expo. Absent or null = off, which is
   * the default and what every profile stored before curves existed has.
   */
  curve?: ChannelCurve | null;
}

export interface ChannelBinding {
  /** Stable id so per-binding runtime state (toggle, ramp) survives edits. */
  id: string;
  channel: number; // 0-based index into the 16 channels
  source: InputSource;
  /** Identifier of the element on that source (axis index, key code, button id). */
  element: string;
  mode: BindingMode;
  /** Which logical stick axis this is, if it's a stick axis (for detents/joysticks). */
  stickAxis?: StickAxis;
  /** Self-centering behaviour for stick axes (touch + keyboard). */
  detent?: Detent;
  /** Human label for the control, e.g. "Throttle", "Aileron". */
  label?: string;
  /** For hold-ramp: full-travel time in seconds while held (default 0.5). */
  holdRampSeconds?: number;
  shaping: ChannelShaping;
}

export interface Endpoints {
  minUs: number;
  maxUs: number;
}

export interface Profile {
  id: string;
  name: string;
  /** The kind of model this profile flies. */
  vehicleType: VehicleType;
  /** Output path on the vehicle this profile drives. */
  driver: 'sim' | 'pca9685' | 'gpio-pwm' | 'sbus';
  /** Which input method is active for this model. */
  inputMethod: InputMethod;
  /** Global default endpoint range; per-channel shaping may override. */
  endpoints: Endpoints;
  /** Channels forced safe while disarmed (typically throttle). */
  throttleChannels: number[];
  /** Transmitter stick mode (1–4): which stick controls throttle/elevator/etc. */
  stickMode?: StickMode;
  /** Speed limiter for the throttle channel(s). Optional — absent = full travel. */
  throttleLimit?: ThrottleLimit;
  bindings: ChannelBinding[];
}

/**
 * Throttle limiter: three named steps the operator switches between while
 * driving, in percent of full travel. It scales the command **around the
 * channel's rest position**, so a centre-detent throttle is capped forwards and
 * backwards while a min-detent one keeps its idle and is only capped upwards.
 *
 * It is a ground-side comfort/training limit — it never touches the endpoints,
 * the failsafe value, the disarmed value or the pre-arm check.
 */
export interface ThrottleLimit {
  /** Percent per step, in order Low / Mid / High. */
  steps: [number, number, number];
  /** Which step is active (0..2). */
  step: 0 | 1 | 2;
}

/** Transmitter mode 1–4 (which stick carries throttle vs elevator, etc.). */
export type StickMode = 1 | 2 | 3 | 4;
/** The four primary flight/drive functions that stick modes reassign. */
export type StickFunction = 'throttle' | 'elevator' | 'aileron' | 'rudder';
