import {
  CHANNEL_COUNT,
  CHANNEL_MIN_US,
  CHANNEL_MAX_US,
  CHANNEL_NEUTRAL_US,
  type Profile,
} from '@yonderrc/protocol';

/** Position of the fill for a value, measured from center as a % of the track. */
function fillGeometry(us: number): { left: number; width: number } {
  const span = CHANNEL_MAX_US - CHANNEL_MIN_US;
  const pct = ((us - CHANNEL_NEUTRAL_US) / span) * 100; // -50 .. 50
  if (pct >= 0) return { left: 50, width: pct };
  return { left: 50 + pct, width: -pct };
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
  const throttleSet = new Set(profile.throttleChannels);
  return (
    <section className={`panel monitor${failsafe ? ' failsafe' : ''}`}>
      <div className="mon-head">
        <span className="eyebrow">Channel output · µs</span>
        {failsafe && <span className="fs-tag">FAILSAFE</span>}
      </div>
      {Array.from({ length: CHANNEL_COUNT }, (_, i) => {
        const us = channels[i] ?? CHANNEL_NEUTRAL_US;
        const { left, width } = fillGeometry(us);
        const label = labels[i];
        const heldSafe = !armed && !failsafe && throttleSet.has(i);
        return (
          <div className="chan" key={i}>
            <span className={`name${label ? ' bound' : ''}`}>
              {String(i + 1).padStart(2, '0')} {label ?? '—'}
              {heldSafe && <span className="safe-tag">disarm</span>}
            </span>
            <div className="track">
              <div className="center" />
              <div className="fill" style={{ left: `${left}%`, width: `${width}%` }} />
            </div>
            <span className="us">{Math.round(us)}</span>
          </div>
        );
      })}
    </section>
  );
}
