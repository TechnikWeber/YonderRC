import { clampChannelUs, type Profile, type ThrottleLimit } from '@yonderrc/protocol';
import { throttleChannelsOf } from './templates';
import { throttleSafeUs } from './safety';

/**
 * Throttle limiter — "three speeds" for the same model.
 *
 * The command is **scaled around the channel's rest position**, and the rest
 * position is exactly what the pre-arm check already derives from the channel's
 * detent:
 *   centre detent (car with reverse, drone) → 1500 → caps forward AND reverse
 *   low / free detent (plane, ratcheted)    → 1000 → idle stays put, only the
 *                                                    upper half is capped
 * One formula, both behaviours, no special case.
 *
 * Scaling (not clipping) keeps the whole stick travel usable: at 50 % full
 * deflection gives half power, and the resolution in between is unchanged.
 *
 * This is a comfort/training limit on the ground side. It deliberately does NOT
 * touch endpoints, failsafe values, the disarmed value or the pre-arm check —
 * those keep working off the true rest position.
 */

export const LIMIT_MIN_PCT = 10;
export const LIMIT_MAX_PCT = 100;
export const LIMIT_STEP_LABELS = ['Low', 'Mid', 'High'] as const;

export const THROTTLE_LIMIT_DEFAULT: ThrottleLimit = { steps: [40, 70, 100], step: 2 };

/** Keep a typed-in percentage sane: 10..100, whole numbers. */
export function clampPercent(pct: number): number {
  if (!Number.isFinite(pct)) return LIMIT_MAX_PCT;
  return Math.min(LIMIT_MAX_PCT, Math.max(LIMIT_MIN_PCT, Math.round(pct)));
}

/** The profile's limiter, filled in with defaults for older/absent configs. */
export function limitOf(profile: Profile): ThrottleLimit {
  const l = profile.throttleLimit;
  if (!l) return { ...THROTTLE_LIMIT_DEFAULT };
  const steps = [0, 1, 2].map((i) => clampPercent(l.steps?.[i] ?? THROTTLE_LIMIT_DEFAULT.steps[i]));
  const step = (l.step === 0 || l.step === 1 || l.step === 2 ? l.step : 2) as 0 | 1 | 2;
  return { steps: [steps[0], steps[1], steps[2]], step };
}

/** Active percentage for a profile (100 when nothing is configured). */
export function activePercent(profile: Profile): number {
  const l = limitOf(profile);
  return l.steps[l.step];
}

/**
 * Scale one channel value towards its rest position. `percent >= 100` returns the
 * value untouched, so the common case is a no-op rather than a rounding source.
 */
export function limitUs(us: number, restUs: number, percent: number): number {
  if (percent >= LIMIT_MAX_PCT) return us;
  const f = clampPercent(percent) / 100;
  return clampChannelUs(restUs + (us - restUs) * f);
}

/**
 * Apply the active limit to every throttle channel of a profile. Returns the
 * same array instance when there is nothing to do, so the control loop doesn't
 * allocate 50 times a second for the full-throttle case.
 */
export function applyThrottleLimit(profile: Profile, channels: number[]): number[] {
  const pct = activePercent(profile);
  if (pct >= LIMIT_MAX_PCT) return channels;
  const chs = throttleChannelsOf(profile);
  if (!chs.length) return channels;
  const out = channels.slice();
  for (const ch of chs) {
    if (ch < 0 || ch >= out.length) continue;
    const binding = profile.bindings.find((b) => b.channel === ch);
    const rest = throttleSafeUs(binding);
    if (rest === null) continue;
    out[ch] = limitUs(out[ch], rest, pct);
  }
  return out;
}

/** Set the active step (used by the drive-screen buttons and the bindable action). */
export function withStep(profile: Profile, step: 0 | 1 | 2): Profile {
  return { ...profile, throttleLimit: { ...limitOf(profile), step } };
}

/** Cycle Low → Mid → High → Low, for a controller button. */
export function nextStep(step: 0 | 1 | 2): 0 | 1 | 2 {
  return ((step + 1) % 3) as 0 | 1 | 2;
}
