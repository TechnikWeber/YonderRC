import { clampChannelUs, type Profile, type ThrottleLimit } from '@yonderrc/protocol';
import { throttleChannelsOf } from './templates';
import { throttleSafeUs } from './safety';

/**
 * Throttle limiter — several speeds for the same model.
 *
 * The command is **scaled around the channel's rest position**, and the rest
 * position is exactly what the pre-arm check uses (throttleSafeUs — the resting
 * stick through the channel's own shaping, so reverse and endpoints count):
 *   rests at centre (car, boat, drone)  → 1500 → caps forward AND reverse
 *   rests at idle (plane, low detent)   → idle stays put, only the way up is capped
 * One formula, both behaviours, no special case.
 *
 * Scaling (not clipping) keeps the whole stick travel usable: at 50 % full
 * deflection gives half power, and the resolution in between is unchanged.
 *
 * This is a comfort/training limit on the ground side. It deliberately does NOT
 * touch endpoints, failsafe values, the disarmed value or the pre-arm check —
 * those keep working off the true rest position.
 *
 * Steps (v1.73): two to five per model, 20/40/60/80/100 by default — a tester asked
 * for exactly those, and 20 % is the crawl a first drive or a child wants. Until
 * v1.72 every model had three (Low/Mid/High = 40/70/100). A model that still carries
 * those untouched gets the five; a model whose three were edited keeps them.
 */

export const LIMIT_MIN_PCT = 10;
export const LIMIT_MAX_PCT = 100;
export const LIMIT_MIN_STEPS = 2;
export const LIMIT_MAX_STEPS = 5;

export const THROTTLE_LIMIT_DEFAULT: ThrottleLimit = { steps: [20, 40, 60, 80, 100], step: 4 };
/** What every model got until v1.72 — untouched, it is replaced by the default above. */
export const THROTTLE_LIMIT_V1_STEPS: readonly number[] = [40, 70, 100];

/** Keep a typed-in percentage sane: 10..100, whole numbers. */
export function clampPercent(pct: number): number {
  if (!Number.isFinite(pct)) return LIMIT_MAX_PCT;
  return Math.min(LIMIT_MAX_PCT, Math.max(LIMIT_MIN_PCT, Math.round(pct)));
}

/** The step of `steps` closest to `pct`; on a tie the slower one — this is a limiter. */
export function nearestStep(steps: readonly number[], pct: number): number {
  let best = 0;
  for (let i = 1; i < steps.length; i++) {
    const d = Math.abs(steps[i] - pct);
    const bestD = Math.abs(steps[best] - pct);
    if (d < bestD || (d === bestD && steps[i] < steps[best])) best = i;
  }
  return best;
}

function defaultLimit(): ThrottleLimit {
  return { steps: [...THROTTLE_LIMIT_DEFAULT.steps], step: THROTTLE_LIMIT_DEFAULT.step };
}

/**
 * The profile's limiter, filled in with defaults for older/absent configs. Absent
 * means full travel (the last default step is 100 %). Garbage is healed rather than
 * trusted: a stored model outlives the version that wrote it.
 */
export function limitOf(profile: Profile): ThrottleLimit {
  const l = profile.throttleLimit;
  if (!l || !Array.isArray(l.steps) || l.steps.length < LIMIT_MIN_STEPS) return defaultLimit();
  const steps = l.steps.slice(0, LIMIT_MAX_STEPS).map((s) => clampPercent(Number(s)));
  const rawStep = Number(l.step);
  const valid = Number.isInteger(rawStep) && rawStep >= 0 && rawStep < steps.length;
  // The untouched pre-v1.73 default: hand over the five steps, keeping the speed that
  // was selected (70 % has no exact match and lands on the slower 60 %).
  if (steps.join() === THROTTLE_LIMIT_V1_STEPS.join()) {
    const next = defaultLimit();
    next.step = valid ? nearestStep(next.steps, steps[rawStep]) : next.step;
    return next;
  }
  return { steps, step: valid ? rawStep : steps.length - 1 };
}

/**
 * Write the healed limiter into the model when it differs from what is stored — the
 * one-time repair `loadProfiles` runs. Returns the same object when nothing changes,
 * so the caller can tell whether anything needs saving.
 */
export function withHealedLimit(profile: Profile): Profile {
  const l = profile.throttleLimit;
  if (!l) return profile;
  const healed = limitOf(profile);
  const same = Array.isArray(l.steps) && l.step === healed.step && l.steps.join() === healed.steps.join();
  return same ? profile : { ...profile, throttleLimit: healed };
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
    const rest = throttleSafeUs(binding, profile.vehicleType);
    if (rest === null) continue;
    out[ch] = limitUs(out[ch], rest, pct);
  }
  return out;
}

/** Set the active step (the drive-screen buttons and the bindable actions). */
export function withStep(profile: Profile, step: number): Profile {
  const l = limitOf(profile);
  const s = Math.min(l.steps.length - 1, Math.max(0, Math.round(step)));
  return { ...profile, throttleLimit: { ...l, step: s } };
}

/** The next step, wrapping from the last to the first — one controller button. */
export function nextStep(limit: ThrottleLimit): number {
  return (limit.step + 1) % limit.steps.length;
}

/**
 * One step slower (−1) or faster (+1), stopping at either end — two controller
 * buttons. With five steps a single cycling button is four presses from 20 % to
 * 100 %; and "faster" must never wrap round to the slowest step, nor "slower" to
 * full speed.
 */
export function stepToward(limit: ThrottleLimit, dir: -1 | 1): number {
  return Math.min(limit.steps.length - 1, Math.max(0, limit.step + dir));
}

/** Change one step's percentage. */
export function withStepPercent(profile: Profile, index: number, pct: number): Profile {
  const l = limitOf(profile);
  if (index < 0 || index >= l.steps.length) return profile;
  const steps = l.steps.slice();
  steps[index] = clampPercent(pct);
  return { ...profile, throttleLimit: { ...l, steps } };
}

/**
 * Add a step (up to five) above the last one, half-way to 100 % — or remove the
 * last one (down to two). The active step stays on the same speed where it can.
 */
export function withStepCount(profile: Profile, change: 1 | -1): Profile {
  const l = limitOf(profile);
  if (change > 0) {
    if (l.steps.length >= LIMIT_MAX_STEPS) return profile;
    const last = l.steps[l.steps.length - 1];
    const added = last >= LIMIT_MAX_PCT ? LIMIT_MAX_PCT : clampPercent((last + LIMIT_MAX_PCT) / 2);
    return { ...profile, throttleLimit: { steps: [...l.steps, added], step: l.step } };
  }
  if (l.steps.length <= LIMIT_MIN_STEPS) return profile;
  const steps = l.steps.slice(0, -1);
  return { ...profile, throttleLimit: { steps, step: Math.min(l.step, steps.length - 1) } };
}
