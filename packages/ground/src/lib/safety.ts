import {
  CHANNEL_NEUTRAL_US,
  shapeProportional,
  shapeSwitch,
  type ChannelBinding,
  type Profile,
  type VehicleType,
} from '@yonderrc/protocol';
import { throttleChannelsOf, throttleRestStick } from './templates';

/**
 * The µs a throttle channel sits at when it is safe to arm: where its stick rests
 * (throttleRestStick), run through the channel's OWN shaping — the way the engine
 * turns that stick into a command. Returns null only if we genuinely can't tell (no
 * throttle binding).
 *
 * It used to be read off the detent alone — centre → 1500, anything else → 1000 — and
 * that was wrong twice. A boat's ratcheted throttle rests at centre, which is stop, so
 * it could only be armed at full reverse. And on a reversed channel idle is 2000 µs, so
 * a reversed plane throttle could only be armed at full throttle. The speed limiter
 * scales around the same value and inherited both mistakes.
 */
export function throttleSafeUs(b: ChannelBinding | undefined, vehicleType: VehicleType): number | null {
  if (!b) return null;
  // A switch rests "off" — exactly what the engine outputs for it when released.
  if (b.mode === 'momentary' || b.mode === 'toggle') {
    return shapeSwitch(false, b.shaping, b.detent === 'center' ? CHANNEL_NEUTRAL_US : b.shaping.minUs);
  }
  return shapeProportional(throttleRestStick(b, vehicleType), b.shaping);
}

export interface PreArmResult {
  ok: boolean;
  message?: string;
}

/**
 * Refuse arming while a throttle channel is commanded away from its safe rest
 * position (prevents the classic "vehicle lurches the instant you arm"). `live`
 * is the RAW engine command (what the throttle would be if armed), not the
 * safe-held output. Tolerance defaults to 120 µs (~12%).
 */
export function preArmCheck(profile: Profile, live: number[], tolUs = 120): PreArmResult {
  for (const ch of throttleChannelsOf(profile)) {
    const b = profile.bindings.find((x) => x.channel === ch);
    const safe = throttleSafeUs(b, profile.vehicleType);
    if (safe === null) continue;
    const v = live[ch] ?? safe;
    if (Math.abs(v - safe) > tolUs) {
      const where = throttleRestStick(b, profile.vehicleType) === 0 ? 'centre' : 'idle';
      return { ok: false, message: `Throttle not at ${where} — set throttle to ${where} before arming.` };
    }
  }
  return { ok: true };
}
