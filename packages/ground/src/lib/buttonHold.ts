/**
 * A short press-and-hold on the buttons that CHANGE something lasting.
 *
 * Distinct from the arm hold (`hold.ts`, ~1 s) and deliberately much shorter: this
 * is not a confirmation, it is a filter against brushing a control by accident —
 * on a phone the buttons sit right where your thumbs already are.
 *
 * Which buttons, and why the list is exactly this:
 *  - toggle channels : flip a channel and leave it flipped (lights, gear, a pump)
 *  - speed limiter   : changes how much throttle the vehicle gets from now on
 *  - trims           : nudge a channel's neutral, permanently, in the profile
 *
 * Deliberately NOT covered:
 *  - momentary channels : a horn or a winch has to answer the instant you press it
 *  - hold-ramp channels : holding IS the gesture there; a delay would fight it
 *  - proportional axes  : steering and throttle must never be delayed
 *  - arm / panic-disarm : arm has its own, longer hold; panic must stay instant
 */

/** Long enough to reject a brush, short enough not to feel broken. */
export const BUTTON_HOLD_MS = 300;

/** Bounds, so a typo can't make every button in the app unusable. */
export const BUTTON_HOLD_MIN_S = 0.1;
export const BUTTON_HOLD_MAX_S = 3;

export interface ButtonHoldCfg {
  enabled: boolean;
  seconds: number;
}
export const BUTTON_HOLD_DEFAULTS: ButtonHoldCfg = { enabled: true, seconds: BUTTON_HOLD_MS / 1000 };

const KEY = 'yonderrc.buttonHold.v1';

export function clampButtonHoldSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return BUTTON_HOLD_DEFAULTS.seconds;
  const rounded = Math.round(seconds * 100) / 100;
  return Math.min(BUTTON_HOLD_MAX_S, Math.max(BUTTON_HOLD_MIN_S, rounded));
}

export function loadButtonHoldCfg(): ButtonHoldCfg {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ButtonHoldCfg>;
      return { enabled: p.enabled !== false, seconds: clampButtonHoldSeconds(p.seconds ?? BUTTON_HOLD_DEFAULTS.seconds) };
    }
  } catch {
    /* ignore */
  }
  return { ...BUTTON_HOLD_DEFAULTS };
}

export function saveButtonHoldCfg(cfg: ButtonHoldCfg): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

/**
 * The hold time to use, in ms. **0 means "no hold"** — buttons fire on the press
 * again, which is what switching the protection off has to mean, and is also the
 * behaviour every version before this one had.
 */
export function buttonHoldMsFor(cfg: ButtonHoldCfg): number {
  return cfg.enabled ? clampButtonHoldSeconds(cfg.seconds) * 1000 : 0;
}
