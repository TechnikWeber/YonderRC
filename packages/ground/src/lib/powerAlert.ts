/**
 * How long a power problem stays on screen.
 *
 * A live fault shows for as long as it is live — that is the whole point, and it clears
 * itself the moment the rail recovers. The *sticky* "it has sagged since boot" flag is
 * different: the firmware never clears it until the next reboot, so a badge tied to it is
 * permanent by construction. Permanent warnings stop being read. It gets a window instead:
 * long enough that you cannot miss a sag that happened while you were watching the road,
 * short enough that it goes away again.
 */

export interface PowerFlagsLike {
  underVoltageNow: boolean;
  underVoltagePast: boolean;
  throttledNow: boolean;
  hotNow: boolean;
}

export const PAST_ALERT_MS = 20_000;

export type PowerAlert = { text: string; live: boolean } | null;

/**
 * @param firstPastAt when the sticky flag was first seen in this session, or null
 * @param now         current clock, injected so this stays testable
 */
export function powerAlert(
  p: PowerFlagsLike | null,
  firstPastAt: number | null,
  now: number,
  windowMs = PAST_ALERT_MS,
): PowerAlert {
  if (!p) return null;
  if (p.underVoltageNow) return { text: 'POWER', live: true };
  if (p.throttledNow) return { text: p.hotNow ? 'HOT' : 'THROTTLED', live: true };
  if (p.underVoltagePast && firstPastAt != null && now - firstPastAt < windowMs) {
    return { text: 'POWER?', live: false };
  }
  return null;
}

/**
 * Track when the sticky flag first appeared. Returns the timestamp to keep — cleared
 * again when the flag goes away, so a vehicle reboot starts the window over.
 */
export function trackFirstPast(
  p: PowerFlagsLike | null,
  previous: number | null,
  now: number,
): number | null {
  if (!p?.underVoltagePast) return null;
  return previous ?? now;
}
