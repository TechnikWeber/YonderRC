import { CHANNEL_NEUTRAL_US, CHANNEL_MIN_US, type ChannelBinding, type Profile } from '@yonderrc/protocol';
import { throttleChannelsOf } from './templates';

/**
 * The µs a throttle stick is expected to sit at when "safe to arm", taken from the
 * channel's own detent so it's vehicle-appropriate:
 *  - center detent (car reverse-capable ESC, drone) → centre (1500)
 *  - low / free / unset → throttle-low (1000), the standard "arm with throttle down"
 * Returns null only if we genuinely can't tell (no throttle binding).
 */
export function throttleSafeUs(b: ChannelBinding | undefined): number | null {
  if (!b) return null;
  if (b.detent === 'center') return CHANNEL_NEUTRAL_US;
  return CHANNEL_MIN_US;
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
    const safe = throttleSafeUs(b);
    if (safe === null) continue;
    const v = live[ch] ?? safe;
    if (Math.abs(v - safe) > tolUs) {
      const where = safe >= CHANNEL_NEUTRAL_US - 1 ? 'centre' : 'idle (min)';
      return { ok: false, message: `Throttle not at ${where} — set throttle to ${where} before arming.` };
    }
  }
  return { ok: true };
}
