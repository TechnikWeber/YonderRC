import { CHANNEL_COUNT, CHANNEL_NEUTRAL_US, clampChannelUs } from '@yonderrc/protocol';
import type { ChannelBinding, Profile } from '@yonderrc/protocol';
import { throttleChannelsOf } from './templates';

/**
 * Follower channels (v1.71): a channel that copies another instead of reading an
 * input — the second steering servo of a Traxxas Revo, the second ESC of a twin.
 *
 * It copies the other channel's FINAL value — after trim, curve and the speed limiter
 * — so a steering trim moves both servos and the limiter caps both motors. On top it
 * has its own offset (`shaping.trimUs`: two servos rarely centre on the same µs), its
 * own reverse (a mirrored servo: mirrored around neutral) and its own endpoints (each
 * linkage has its own stops).
 *
 * Its safety values come from the same rule: failsafe and disarmed value are the
 * leader's, through the same offset, reverse and endpoints — and a follower of a
 * throttle channel is a throttle channel to the vehicle. Two ESCs must never disagree
 * about what "stop" is, and one of them must not be left out of the disarm hold.
 *
 * A follower cannot follow another follower: in a chain the result would depend on
 * the order the channels are evaluated in.
 */

export function followElement(ch: number): string {
  return `ch:${ch}`;
}

export function isFollower(b: Pick<ChannelBinding, 'source'>): boolean {
  return b.source === 'follow';
}

/** The channel a follower copies (0-based), or null for anything else. */
export function followedChannel(b: Pick<ChannelBinding, 'source' | 'element'>): number | null {
  if (!isFollower(b)) return null;
  const m = /^ch:(\d+)$/.exec(b.element ?? '');
  if (!m) return null;
  const ch = Number(m[1]);
  return ch < CHANNEL_COUNT ? ch : null;
}

/** The bindings a follower on `ownChannel` may copy: any input-driven channel but its own. */
export function leaderCandidates(profile: Profile, ownChannel: number): ChannelBinding[] {
  return profile.bindings.filter((b) => !isFollower(b) && b.channel !== ownChannel);
}

/** The binding a follower copies — null when that channel has no input of its own. */
export function leaderOf(profile: Profile, f: ChannelBinding): ChannelBinding | null {
  const ch = followedChannel(f);
  if (ch === null || ch === f.channel) return null;
  return profile.bindings.find((b) => b.channel === ch && !isFollower(b)) ?? null;
}

/** The follower's µs for its leader's µs: reverse mirrors around neutral, then the offset, then its endpoints. */
export function followerUs(leaderUs: number, f: ChannelBinding): number {
  const s = f.shaping;
  const base = s.reverse ? 2 * CHANNEL_NEUTRAL_US - leaderUs : leaderUs;
  const lo = Math.min(s.minUs, s.maxUs);
  const hi = Math.max(s.minUs, s.maxUs);
  return clampChannelUs(Math.max(lo, Math.min(hi, base + s.trimUs)));
}

/**
 * Fill every follower channel from its leader's value in `channels`. Returns the same
 * array when the model has none. A follower whose leader is gone holds its own stored
 * failsafe value — the one thing about it that is known to be safe.
 */
export function applyFollowers(profile: Profile, channels: number[]): number[] {
  const followers = profile.bindings.filter(isFollower);
  if (!followers.length) return channels;
  const out = channels.slice();
  for (const f of followers) {
    if (f.channel < 0 || f.channel >= out.length) continue;
    const leader = leaderOf(profile, f);
    out[f.channel] = leader ? followerUs(channels[leader.channel] ?? CHANNEL_NEUTRAL_US, f) : clampChannelUs(f.shaping.failsafeUs);
  }
  return out;
}

/**
 * The channels the vehicle must treat as throttle: the model's throttle channels and
 * every follower of one. This is the list the vehicle holds at the disarmed value.
 */
export function throttleOutputsOf(profile: Profile): number[] {
  const primary = throttleChannelsOf(profile);
  const set = new Set(primary);
  for (const f of profile.bindings) {
    const leader = isFollower(f) ? leaderOf(profile, f) : null;
    if (leader && set.has(leader.channel) && f.channel >= 0 && f.channel < CHANNEL_COUNT) set.add(f.channel);
  }
  return [...set].sort((a, b) => a - b);
}

/**
 * A new follower of `leader` on `channel`: the leader's endpoints, so both travel alike,
 * no offset, not reversed. The stored failsafe is the leader's — it is what the
 * follower holds should the leader ever be removed.
 */
let followerCounter = 0;

export function createFollower(opts: { id?: string; channel: number; leader: ChannelBinding; label: string }): ChannelBinding {
  const s = opts.leader.shaping;
  return {
    id: opts.id ?? `f_${Date.now().toString(36)}${(followerCounter++).toString(36)}`,
    channel: opts.channel,
    source: 'follow',
    element: followElement(opts.leader.channel),
    mode: 'proportional',
    label: opts.label || `${opts.leader.label ?? 'Channel'} 2`,
    shaping: { trimUs: 0, expo: 0, reverse: false, minUs: s.minUs, maxUs: s.maxUs, failsafeUs: s.failsafeUs, curve: null },
  };
}
