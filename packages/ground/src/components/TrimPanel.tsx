import type { Profile } from '@yonderrc/protocol';
import { HoldButton } from './HoldButton';
import { TRIM_STEP_US, TRIM_LIMIT_US, trimmableBindings, trimNeutralUs } from '../lib/trim';

/**
 * Live trims, one row per stick axis. Collapsed by default: this is a control you
 * reach for occasionally, and open it would be four more rows of buttons sitting
 * under your thumbs for no reason.
 *
 * Each nudge is a held press (see HoldButton) and moves one step — no auto-repeat,
 * so trim can't run away while a finger rests on it.
 */
export function TrimPanel({
  profile,
  holdMs,
  onNudge,
  onClear,
  disabled = false,
}: {
  profile: Profile;
  /** Hold required per nudge; 0 = plain taps. */
  holdMs: number;
  onNudge: (bindingId: string, deltaUs: number) => void;
  onClear: (bindingId: string) => void;
  disabled?: boolean;
}) {
  const rows = trimmableBindings(profile);
  if (rows.length === 0) return null;
  const trimmed = rows.filter((b) => b.shaping.trimUs !== 0).length;

  return (
    <details className="trim-panel">
      <summary>
        Trims
        {trimmed > 0 && <span className="trim-badge">{trimmed} adjusted</span>}
      </summary>
      <div className="trim-rows">
        {rows.map((b) => {
          const t = b.shaping.trimUs;
          const atMin = t <= -TRIM_LIMIT_US;
          const atMax = t >= TRIM_LIMIT_US;
          return (
            <div className="trim-row" key={b.id}>
              <span className="trim-label">
                {b.label ?? `CH${String(b.channel + 1).padStart(2, '0')}`}
              </span>
              <HoldButton
                className="btn tiny trim-btn"
                holdMs={holdMs}
                disabled={disabled || atMin}
                onFire={() => onNudge(b.id, -TRIM_STEP_US)}
                title={`Trim ${b.label ?? 'channel'} down ${TRIM_STEP_US} µs`}
              >
                −
              </HoldButton>
              <span className={`trim-value${t === 0 ? '' : ' set'}`}>
                {t > 0 ? `+${t}` : t} µs
                <i className="trim-neutral">neutral {trimNeutralUs(b)}</i>
              </span>
              <HoldButton
                className="btn tiny trim-btn"
                holdMs={holdMs}
                disabled={disabled || atMax}
                onFire={() => onNudge(b.id, TRIM_STEP_US)}
                title={`Trim ${b.label ?? 'channel'} up ${TRIM_STEP_US} µs`}
              >
                +
              </HoldButton>
              <HoldButton
                className="btn tiny trim-reset"
                holdMs={holdMs}
                disabled={disabled || t === 0}
                onFire={() => onClear(b.id)}
                title="Back to centre"
              >
                0
              </HoldButton>
            </div>
          );
        })}
      </div>
      <p className="hint">
        {TRIM_STEP_US} µs per press, up to ±{TRIM_LIMIT_US} µs. Trim shifts the channel's neutral and is
        saved with the model — it's the same value as <span className="mono">trim µs</span> in Setup › Channels.
      </p>
    </details>
  );
}
