import {
  CHANNEL_COUNT,
  CHANNEL_MIN_US,
  CHANNEL_MAX_US,
  CHANNEL_NEUTRAL_US,
  type Profile,
} from '@yonderrc/protocol';
import { throttleChannelsOf } from '../lib/templates';

/** Position of the fill for a value within THIS channel's own endpoint range. */
function fillGeometry(us: number, min: number, max: number): { left: number; width: number } {
  const center = (min + max) / 2;
  const half = Math.max(1, (max - min) / 2);
  const pct = ((us - center) / half) * 50; // -50 .. 50 across the channel's range
  if (pct >= 0) return { left: 50, width: Math.min(50, pct) };
  return { left: 50 + Math.max(-50, pct), width: Math.min(50, -pct) };
}

/** Per-channel endpoint range, falling back to the profile default then nominal. */
function rangeFor(profile: Profile, channel: number): { min: number; max: number } {
  const b = profile.bindings.find((x) => x.channel === channel);
  if (b) return { min: b.shaping.minUs, max: b.shaping.maxUs };
  return { min: profile.endpoints?.minUs ?? CHANNEL_MIN_US, max: profile.endpoints?.maxUs ?? CHANNEL_MAX_US };
}

function labelsFor(profile: Profile): Record<number, string> {
  const out: Record<number, string> = {};
  for (const b of profile.bindings) {
    out[b.channel] = b.label ?? `${b.source}/${b.mode}`;
  }
  return out;
}

export function ChannelMonitor({
  channels,
  failsafe,
  profile,
  armed,
}: {
  channels: number[];
  failsafe: boolean;
  profile: Profile;
  armed: boolean;
}) {
  const labels = labelsFor(profile);
  const throttleSet = new Set(throttleChannelsOf(profile));
  return (
    <section className={`panel monitor${failsafe ? ' failsafe' : ''}`}>
      <div className="mon-head">
        <span className="eyebrow">Channel output · <span className="nocaps">µs</span></span>
        {failsafe && <span className="fs-tag">FAILSAFE</span>}
      </div>
      {Array.from({ length: CHANNEL_COUNT }, (_, i) => {
        const us = channels[i] ?? CHANNEL_NEUTRAL_US;
        const { min, max } = rangeFor(profile, i);
        const { left, width } = fillGeometry(us, min, max);
        const label = labels[i];
        const heldSafe = !armed && !failsafe && throttleSet.has(i);
        return (
          <div className={`chan${heldSafe ? ' safe' : ''}`} key={i}>
            <span className={`name${label ? ' bound' : ''}`}>
              {String(i + 1).padStart(2, '0')} {label ?? '—'}
            </span>
            <div className="track">
              <div className="center" />
              <div className="fill" style={{ left: `${left}%`, width: `${width}%` }} />
              {heldSafe && <span className="safe-overlay">held safe · disarmed</span>}
            </div>
            <span className="us">{Math.round(us)}</span>
          </div>
        );
      })}
    </section>
  );
}
