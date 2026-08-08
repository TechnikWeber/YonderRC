import { CHANNEL_COUNT } from '@yonderrc/protocol';
import type { ChannelBinding, Detent, InputMethod, Profile, StickAxis } from '@yonderrc/protocol';
import { applyEndpoints, rebuildForMethod, setDetent } from '../lib/templates';

const METHODS: InputMethod[] = ['keyboard', 'gamepad', 'touch'];
const DETENTS: Detent[] = ['center', 'low', 'free'];
const AXIS_ORDER: StickAxis[] = ['leftX', 'leftY', 'rightX', 'rightY'];
const AXIS_LABEL: Record<StickAxis, string> = { leftX: 'Left ◀▶', leftY: 'Left ▲▼', rightX: 'Right ◀▶', rightY: 'Right ▲▼' };

export function BindingEditor({
  profile,
  onChange,
  onRename,
  onDelete,
  onDuplicate,
}: {
  profile: Profile;
  onChange: (next: Profile) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const patchShaping = (id: string, patch: Partial<ChannelBinding['shaping']>) =>
    onChange({
      ...profile,
      bindings: profile.bindings.map((b) => (b.id === id ? { ...b, shaping: { ...b.shaping, ...patch } } : b)),
    });

  // Which stick axes exist in this model (for the detent controls).
  const axisBindings = profile.bindings.filter((b) => b.stickAxis);
  const presentAxes = AXIS_ORDER.filter((ax) => axisBindings.some((b) => b.stickAxis === ax));
  const detentOf = (ax: StickAxis): Detent => axisBindings.find((b) => b.stickAxis === ax)?.detent ?? 'center';
  const showDetents = profile.inputMethod !== 'gamepad'; // physical stick centers itself

  return (
    <section className="panel editor">
      <div className="editor-head">
        <input className="name-input" value={profile.name} onChange={(e) => onRename(e.target.value)} aria-label="Profile name" />
        <span className="type-badge">{profile.vehicleType}</span>
        <div className="editor-actions">
          <button className="btn" onClick={onDuplicate}>Duplicate</button>
          <button className="btn" onClick={onDelete}>Delete</button>
        </div>
      </div>

      <div className="field">
        <div className="eyebrow">Input method</div>
        <div className="radios">
          {METHODS.map((m) => (
            <label key={m} className={`radio${profile.inputMethod === m ? ' on' : ''}`}>
              <input
                type="radio"
                name="method"
                checked={profile.inputMethod === m}
                onChange={() => onChange(rebuildForMethod(profile, m))}
              />
              {m}
            </label>
          ))}
        </div>
      </div>

      <div className="field">
        <div className="eyebrow">Endpoints (µs) — applied to all channels</div>
        <div className="grid2">
          <label>min µs
            <input
              type="number"
              value={profile.endpoints.minUs}
              onChange={(e) => onChange(applyEndpoints(profile, { ...profile.endpoints, minUs: Number(e.target.value) }))}
            />
          </label>
          <label>max µs
            <input
              type="number"
              value={profile.endpoints.maxUs}
              onChange={(e) => onChange(applyEndpoints(profile, { ...profile.endpoints, maxUs: Number(e.target.value) }))}
            />
          </label>
        </div>
        <p className="note">Typical is 1000–2000 µs. Some servos/ESCs want a wider or narrower range. A channel below can override this.</p>
      </div>

      {showDetents && presentAxes.length > 0 && (
        <div className="field">
          <div className="eyebrow">Stick detents (release behaviour)</div>
          {presentAxes.map((ax) => (
            <div className="detent-row" key={ax}>
              <span className="detent-name">{AXIS_LABEL[ax]}</span>
              <div className="radios">
                {DETENTS.map((d) => (
                  <label key={d} className={`radio${detentOf(ax) === d ? ' on' : ''}`}>
                    <input
                      type="radio"
                      name={`detent-${ax}`}
                      checked={detentOf(ax) === d}
                      onChange={() => onChange(setDetent(profile, ax, d))}
                    />
                    {d}
                  </label>
                ))}
              </div>
            </div>
          ))}
          <p className="note">center = springs to middle · low = springs to minimum (throttle idle) · free = stays put.</p>
        </div>
      )}

      <div className="field">
        <div className="eyebrow">Channels</div>
        {profile.bindings.map((b) => (
          <div className="binding" key={b.id}>
            <div className="binding-top">
              <span className="ch-label">CH{String(b.channel + 1).padStart(2, '0')} · {b.label ?? '—'}</span>
              <span className="ch-mode">{b.source}/{b.mode}</span>
            </div>
            <details className="shaping">
              <summary>trim {b.shaping.trimUs} · expo {b.shaping.expo} · {b.shaping.minUs}–{b.shaping.maxUs} µs · fs {b.shaping.failsafeUs}{b.shaping.reverse ? ' · rev' : ''}</summary>
              <div className="shaping-grid">
                <label>trim µs<input type="number" value={b.shaping.trimUs} onChange={(e) => patchShaping(b.id, { trimUs: Number(e.target.value) })} /></label>
                <label>expo<input type="number" step={0.05} min={0} max={1} value={b.shaping.expo} onChange={(e) => patchShaping(b.id, { expo: Number(e.target.value) })} /></label>
                <label>min µs<input type="number" value={b.shaping.minUs} onChange={(e) => patchShaping(b.id, { minUs: Number(e.target.value) })} /></label>
                <label>max µs<input type="number" value={b.shaping.maxUs} onChange={(e) => patchShaping(b.id, { maxUs: Number(e.target.value) })} /></label>
                <label>failsafe µs<input type="number" value={b.shaping.failsafeUs} onChange={(e) => patchShaping(b.id, { failsafeUs: Number(e.target.value) })} /></label>
                <label className="rev">reverse<input type="checkbox" checked={b.shaping.reverse} onChange={(e) => patchShaping(b.id, { reverse: e.target.checked })} /></label>
              </div>
            </details>
          </div>
        ))}
        <p className="note">Channel count: {CHANNEL_COUNT}. Mapping comes from the model template; tweak shaping per channel here.</p>
      </div>
    </section>
  );
}
