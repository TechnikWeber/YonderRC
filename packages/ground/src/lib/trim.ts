import { clampChannelUs, type ChannelBinding, type Profile } from '@yonderrc/protocol';

/**
 * Live trims — nudging a proportional channel's neutral while you drive, instead
 * of stopping and editing `trimUs` in Setup. Same idea as the trim buttons on a
 * transmitter: the car pulls left, you tap right a few times.
 *
 * The value lands in the channel's `shaping.trimUs`, which is where trim already
 * lived, so nothing else in the chain has to learn about this: `shapeProportional`
 * adds it and clamps to the channel's own endpoints, and the profile persists it.
 */

/** One tap. 5 µs of a 1000 µs span is 0.5% — fine enough to creep up on centre. */
export const TRIM_STEP_US = 5;

/**
 * How far trim may pull a channel. Trim shifts the whole range, so a large value
 * eats travel at one end; ±150 µs (15% of a nominal span) is more than any
 * mechanical misalignment worth trimming out, and past that you should be fixing
 * the linkage or the endpoints instead.
 */
export const TRIM_LIMIT_US = 150;

export function clampTrim(us: number): number {
  if (!Number.isFinite(us)) return 0;
  return Math.max(-TRIM_LIMIT_US, Math.min(TRIM_LIMIT_US, Math.round(us)));
}

/** The channels worth showing a trim for: the proportional (stick) axes. */
export function trimmableBindings(profile: Profile): ChannelBinding[] {
  return profile.bindings.filter((b) => b.mode === 'proportional');
}

/**
 * Apply a trim nudge to one channel. Returns the profile unchanged when the
 * channel is already at the limit, so the caller can tell nothing happened.
 */
export function nudgeTrim(profile: Profile, bindingId: string, deltaUs: number): Profile {
  let changed = false;
  const bindings = profile.bindings.map((b) => {
    if (b.id !== bindingId || b.mode !== 'proportional') return b;
    const next = clampTrim(b.shaping.trimUs + deltaUs);
    if (next === b.shaping.trimUs) return b;
    changed = true;
    return { ...b, shaping: { ...b.shaping, trimUs: next } };
  });
  return changed ? { ...profile, bindings } : profile;
}

/** Reset one channel's trim to centre. */
export function clearTrim(profile: Profile, bindingId: string): Profile {
  const current = profile.bindings.find((b) => b.id === bindingId)?.shaping.trimUs ?? 0;
  return nudgeTrim(profile, bindingId, -current);
}

/** True when any trimmable channel is off centre — drives the "trimmed" marker. */
export function hasTrim(profile: Profile): boolean {
  return trimmableBindings(profile).some((b) => b.shaping.trimUs !== 0);
}

/**
 * Where trim has pushed this channel's neutral, in µs. Shown next to the buttons
 * so the number you are changing is visible while you change it.
 */
export function trimNeutralUs(b: ChannelBinding): number {
  const centre = (b.shaping.minUs + b.shaping.maxUs) / 2;
  return clampChannelUs(centre + b.shaping.trimUs);
}
