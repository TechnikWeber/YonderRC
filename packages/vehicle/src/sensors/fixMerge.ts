import type { GpsFix } from '@yonderrc/protocol';
import { emptyFix } from '@yonderrc/protocol';

/**
 * Carrying the last known value of a GPS field while its next update is missing.
 *
 * A fix does not arrive as one packet. NMEA spreads it over several sentences —
 * GGA carries fix/position/satellites, RMC speed and course, GSA the 2D/3D mode —
 * and `parseNmea` builds a GpsFix from whatever sentences happened to fall inside
 * one parse window. A burst cut by a window boundary therefore produced a fix with
 * holes: no lat/lon (the home symbol, the arrow and the odometer vanish together,
 * because they share one condition in the OSD) or no speed (only the speed vanishes).
 * It lasts a few seconds at a time, because the receiver's 1 Hz and ours are free
 * running clocks drifting through each other. Seen on the first real drive
 * (2026-08-28): 8 satellites, solid fix, OSD blinking in and out anyway.
 *
 * So a missing field means "this window said nothing about it", not "it is gone".
 * Carry the last value — but only for `FIX_HOLD_MS`, because a held value that never
 * expires shows a position the vehicle left minutes ago, which is worse than a gap.
 * An explicit "no fix" from the receiver is not a gap and is never held.
 */

/** How long a field survives without an update. Two receiver cycles plus slack. */
export const FIX_HOLD_MS = 3000;

/**
 * How long the whole fix survives silence — an unplugged antenna, a receiver that
 * stopped talking, a service that was stopped. Beyond this there is no fix, and
 * saying so is the honest answer: a frozen position is worse than none, because the
 * home arrow keeps pointing confidently from a place the vehicle has left.
 */
export const FIX_STALE_MS = 5000;

/** The fields that are held. `source` is not a reading; hasFix/fixType are handled together. */
const HELD = ['lat', 'lon', 'altM', 'satellites', 'hdop', 'speedMs', 'courseDeg', 'timeUtc'] as const;
type HeldField = (typeof HELD)[number];

/** Key for the hasFix/fixType pair, which travel together and expire together. */
const FIX_KEY = 'fix';

export interface FixHold {
  /** The fix as it should be reported: this window's values, gaps filled from before. */
  fix: GpsFix;
  /** ms timestamp of the last real update, per held field (plus FIX_KEY). */
  at: Record<string, number>;
}

/**
 * Did the receiver actually SAY there is no fix, rather than just staying silent?
 *
 * A GGA with quality 0 (and a TPV with mode < 2) still reports a satellite count, so
 * a fixless message that carries one is evidence, not absence of evidence — a fix
 * that was really lost must drop out at once, not three seconds later.
 */
function saysNoFix(f: GpsFix): boolean {
  return !f.hasFix && f.satellites != null;
}

function stamp(f: GpsFix, now: number): Record<string, number> {
  const at: Record<string, number> = {};
  for (const k of HELD) if (f[k] != null) at[k] = now;
  if (f.hasFix) at[FIX_KEY] = now;
  return at;
}

/**
 * Merge a freshly parsed fix over the previous one. Pure: `now` and `holdMs` are
 * passed in, so the whole hold/expiry behaviour is testable without a clock.
 */
export function mergeFix(
  prev: FixHold | null,
  next: GpsFix,
  now: number,
  holdMs: number = FIX_HOLD_MS,
): FixHold {
  // A different source starts over: readings from the old receiver must not survive
  // a reconfigure, and neither must a real fix survive a switch to 'off'.
  if (!prev || prev.fix.source !== next.source) return { fix: { ...next }, at: stamp(next, now) };
  // A reported loss of fix is complete information, not a gap: take it verbatim.
  // Holding the last position through it would draw a home arrow from a point the
  // receiver no longer stands behind — the one case where a gap is the honest answer.
  if (saysNoFix(next)) return { fix: { ...next }, at: stamp(next, now) };

  const fix: GpsFix = { ...next };
  const at: Record<string, number> = { ...prev.at };
  const fresh = (key: string) => now - (prev.at[key] ?? -Infinity) <= holdMs;

  for (const k of HELD) {
    if (next[k] != null) {
      at[k] = now;
      continue;
    }
    const held = prev.fix[k];
    if (held != null && fresh(k)) (fix as Record<HeldField, unknown>)[k] = held;
    else delete at[k];
  }

  if (next.hasFix) {
    at[FIX_KEY] = now;
  } else if (!saysNoFix(next) && prev.fix.hasFix && fresh(FIX_KEY)) {
    fix.hasFix = true;
    fix.fixType = prev.fix.fixType;
  } else {
    delete at[FIX_KEY];
  }

  return { fix, at };
}

/**
 * What to report given the age of the last message from the receiver. Keeping this
 * separate from `mergeFix` draws the line between the two silences: a single missing
 * sentence is a gap to be filled, a receiver that says nothing at all is a loss.
 */
export function reportedFix(
  fix: GpsFix,
  lastAt: number | null,
  now: number,
  staleMs: number = FIX_STALE_MS,
): GpsFix {
  return lastAt == null || now - lastAt > staleMs ? emptyFix(fix.source) : fix;
}
