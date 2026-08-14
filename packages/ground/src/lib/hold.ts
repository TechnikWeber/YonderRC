/**
 * Press-and-hold confirmation (v1.22).
 *
 * Arming — and, worse, disarming in flight — used to be a single tap, so a
 * mis-touch on a phone could cut the motors. The arm button now requires a
 * sustained press; this module holds the (pure, testable) timing math, the
 * component only drives it from pointer/key events.
 *
 * Panic-disarm (Setup › Controls) stays immediate on purpose — that's the
 * emergency path and must not be slowed down.
 */

/**
 * Default hold time. 2 s is long enough that no pocket-touch or fat finger gets
 * through, short enough that arming doesn't feel like a ceremony. Adjustable —
 * and switchable off — in Setup › Controls.
 */
export const ARM_HOLD_MS = 2000;

/** Bounds for the configurable hold, so a typo can't make the button useless. */
export const HOLD_MIN_S = 0.5;
export const HOLD_MAX_S = 10;

/** Hold-to-arm settings, per browser (like the other ground-side safety options). */
export interface HoldCfg {
  enabled: boolean;
  seconds: number;
}
export const HOLD_DEFAULTS: HoldCfg = { enabled: true, seconds: ARM_HOLD_MS / 1000 };

const HOLD_KEY = 'yonderrc.armHold.v1';

export function loadHoldCfg(): HoldCfg {
  try {
    const raw = localStorage.getItem(HOLD_KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<HoldCfg>;
      return { enabled: p.enabled !== false, seconds: clampHoldSeconds(p.seconds ?? HOLD_DEFAULTS.seconds) };
    }
  } catch {
    /* ignore */
  }
  return { ...HOLD_DEFAULTS };
}

export function saveHoldCfg(cfg: HoldCfg): void {
  try {
    localStorage.setItem(HOLD_KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function clampHoldSeconds(seconds: number): number {
  if (!Number.isFinite(seconds)) return HOLD_DEFAULTS.seconds;
  return Math.min(HOLD_MAX_S, Math.max(HOLD_MIN_S, Math.round(seconds * 10) / 10));
}

/**
 * The hold time the arm button should use, in ms. **0 means "no hold"** — the
 * button toggles on a plain tap again, which is what turning the protection off
 * has to mean.
 */
export function holdMsFor(cfg: HoldCfg): number {
  return cfg.enabled ? clampHoldSeconds(cfg.seconds) * 1000 : 0;
}

/**
 * Progress of a hold in [0,1]. `startedAt === null` means "not holding".
 * A non-positive holdMs completes instantly (so the hold can be disabled).
 */
export function holdProgress(startedAt: number | null, now: number, holdMs = ARM_HOLD_MS): number {
  if (startedAt === null) return 0;
  if (holdMs <= 0) return 1;
  const p = (now - startedAt) / holdMs;
  if (!Number.isFinite(p) || p < 0) return 0;
  return p > 1 ? 1 : p;
}

/** Seconds left, rounded to one decimal — what the button counts down. */
export function holdRemainingS(progress: number, holdMs = ARM_HOLD_MS): number {
  const left = (1 - Math.min(Math.max(progress, 0), 1)) * holdMs;
  return Math.round(left / 100) / 10;
}
