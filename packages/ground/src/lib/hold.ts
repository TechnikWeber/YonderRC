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

/** How long the arm button has to be held before the toggle fires. */
export const ARM_HOLD_MS = 3000;

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
