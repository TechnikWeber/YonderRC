import { useEffect, useState } from 'react';
import { CHANNEL_COUNT } from '@yonderrc/protocol';
import type { BindingMode, ChannelBinding, Detent, InputMethod, Profile, StickAxis, StickMode } from '@yonderrc/protocol';
import {
  applyEndpoints,
  applyStickMode,
  createBinding,
  nextFreeChannel,
  rebuildForMethod,
  setDetent,
  stickModes,
} from '../lib/templates';
import type { InputManager } from '../lib/input/inputManager';

const METHODS: InputMethod[] = ['keyboard', 'gamepad', 'touch'];
const DETENTS: Detent[] = ['center', 'low', 'free'];
const AXIS_ORDER: StickAxis[] = ['leftX', 'leftY', 'rightX', 'rightY'];
const AXIS_LABEL: Record<StickAxis, string> = { leftX: 'Left ◀▶', leftY: 'Left ▲▼', rightX: 'Right ◀▶', rightY: 'Right ▲▼' };
const SOURCES: ChannelBinding['source'][] = ['keyboard', 'gamepad', 'onscreen'];
const MODES: BindingMode[] = ['proportional', 'momentary', 'toggle', 'hold-ramp'];
const RESTS: Detent[] = ['center', 'low', 'free'];
const REST_LABEL: Record<Detent, string> = { center: 'center', low: 'min', free: 'hold' };

type Draft = { channel: number; label: string; source: ChannelBinding['source']; mode: BindingMode; element: string; detent: Detent };

export function BindingEditor({
  profile,
  locked = false,
  input,
  onChange,
  onRename,
  onDelete,
  onDuplicate,
}: {
  profile: Profile;
  locked?: boolean;
  input: InputManager;
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

  const removeBinding = (id: string) =>
    onChange({ ...profile, bindings: profile.bindings.filter((b) => b.id !== id) });

  // Which stick axes exist in this model (for the detent controls).
  const axisBindings = profile.bindings.filter((b) => b.stickAxis);
  const presentAxes = AXIS_ORDER.filter((ax) => axisBindings.some((b) => b.stickAxis === ax));
  const detentOf = (ax: StickAxis): Detent => axisBindings.find((b) => b.stickAxis === ax)?.detent ?? 'center';
  const showDetents = profile.inputMethod !== 'gamepad'; // physical stick centers itself
  const mode = profile.stickMode ?? 2;

  // ---- Add / edit channel form ----
  const [adding, setAdding] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const emptyDraft = (): Draft => ({ channel: nextFreeChannel(profile), label: '', source: 'keyboard', mode: 'momentary', element: '', detent: 'center' });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [learning, setLearning] = useState(false);

  const openAdd = () => {
    setEditingId(null);
    setDraft(emptyDraft());
    setAdding(true);
  };
  const openEdit = (b: ChannelBinding) => {
    setEditingId(b.id);
    setDraft({
      channel: b.channel,
      label: b.label ?? '',
      source: b.source === 'virtual' ? 'onscreen' : b.source,
      mode: b.mode,
      element: b.element,
      detent: b.detent ?? 'center',
    });
    setAdding(true);
  };
  const closeForm = () => {
    setAdding(false);
    setEditingId(null);
    setLearning(false);
  };

  // Capture a keyboard key or gamepad button/axis for the new binding's element.
  useEffect(() => {
    if (!learning) return;
    if (draft.source === 'keyboard') {
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        setDraft((d) => ({ ...d, element: e.key.toLowerCase() }));
        setLearning(false);
      };
      window.addEventListener('keydown', onKey, { once: true });
      return () => window.removeEventListener('keydown', onKey);
    }
    if (draft.source === 'gamepad') {
      const id = setInterval(() => {
        const btns = input.readGamepadButtons();
        const bi = btns.findIndex((p) => p);
        if (bi >= 0) {
          setDraft((d) => ({ ...d, element: `button:${bi}` }));
          setLearning(false);
          return;
        }
        for (let a = 0; a < 6; a++) {
          const v = input.readGamepadAxis(a);
          if (v != null && Math.abs(v) > 0.6) {
            setDraft((d) => ({ ...d, element: `axis:${a}` }));
            setLearning(false);
            return;
          }
        }
      }, 80);
      return () => clearInterval(id);
    }
    return;
  }, [learning, draft.source, input]);

  const saveChannel = () => {
    const element = draft.source === 'onscreen' ? 'btn' : draft.element.trim();
    if (!element) return;
    if (editingId) {
      onChange({
        ...profile,
        bindings: profile.bindings.map((b) =>
          b.id === editingId
            ? { ...b, channel: draft.channel, label: draft.label || b.label, source: draft.source, element, mode: draft.mode, detent: draft.detent }
            : b,
        ),
      });
    } else {
      onChange({
        ...profile,
        bindings: [
          ...profile.bindings,
          createBinding({ channel: draft.channel, source: draft.source, element, mode: draft.mode, label: draft.label, endpoints: profile.endpoints, detent: draft.detent }),
        ],
      });
    }
    closeForm();
  };

  return (
    <section className="panel editor">
      {locked && (
        <div className="editor-lock">🔒 Disarm the vehicle to change model settings.</div>
      )}
      <div className={locked ? 'editor-body locked' : 'editor-body'}>
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
        <div className="eyebrow">Stick mode (transmitter mode 1–4)</div>
        <div className="radios">
          {stickModes().map((m) => (
            <label key={m} className={`radio${mode === m ? ' on' : ''}`}>
              <input
                type="radio"
                name="stickmode"
                checked={mode === m}
                onChange={() => onChange(applyStickMode(profile, m as StickMode))}
              />
              Mode {m}
            </label>
          ))}
        </div>
        <p className="note">Swaps which stick controls throttle / elevator / aileron / rudder. Mode 2 is the common default; applies to touch, gamepad and keyboard.</p>
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
        <p className="note">Typical is 1000–2000 µs (absolute limit 500–2500). A channel below can override this.</p>
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
              <span className="ch-mode">{b.source}/{b.mode}{b.element ? ` · ${b.element}` : ''}</span>
              <button className="btn tiny" onClick={() => openEdit(b)} title="Edit channel">Edit</button>
              <button className="btn tiny danger" onClick={() => removeBinding(b.id)} title="Remove channel">Remove</button>
            </div>
            <details className="shaping">
              <summary>trim {b.shaping.trimUs} · expo {b.shaping.expo} · {b.shaping.minUs}–{b.shaping.maxUs} µs · fs {b.shaping.failsafeUs}{b.shaping.reverse ? ' · rev' : ''}{b.detent ? ` · rest ${REST_LABEL[b.detent]}` : ''}</summary>
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

        {adding ? (
          <div className="add-channel">
            <div className="add-grid">
              <label>Channel
                <select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: Number(e.target.value) })}>
                  {Array.from({ length: CHANNEL_COUNT }, (_, i) => (
                    <option key={i} value={i}>CH{String(i + 1).padStart(2, '0')}{profile.bindings.some((b) => b.channel === i) ? ' (in use)' : ''}</option>
                  ))}
                </select>
              </label>
              <label>Label<input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Winch" /></label>
              <label>Source
                <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as ChannelBinding['source'], element: '' })}>
                  {SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </label>
              <label>Mode
                <select value={draft.mode} onChange={(e) => setDraft({ ...draft, mode: e.target.value as BindingMode })}>
                  {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                </select>
              </label>
              {draft.source !== 'onscreen' && (
                <label className="add-element">Input
                  <div className="learn-row">
                    <input
                      value={draft.element}
                      onChange={(e) => setDraft({ ...draft, element: e.target.value })}
                      placeholder={draft.source === 'keyboard' ? "key e.g. r  ·  axis: a|d" : 'button:0 · axis:2'}
                    />
                    <button className="btn tiny" onClick={() => setLearning((v) => !v)}>{learning ? 'Press…' : 'Learn'}</button>
                  </div>
                </label>
              )}
              <label className="add-rest">Rest position
                <select value={draft.detent} onChange={(e) => setDraft({ ...draft, detent: e.target.value as Detent })}>
                  {RESTS.map((d) => <option key={d} value={d}>{REST_LABEL[d]}</option>)}
                </select>
              </label>
            </div>
            <div className="add-actions">
              <button className="btn" onClick={saveChannel}>{editingId ? 'Save' : 'Add'}</button>
              <button className="btn ghost" onClick={closeForm}>Cancel</button>
            </div>
            <p className="note">
              proportional = axis (keyboard needs two keys like <code>a|d</code>) · momentary = while held · toggle = on/off · hold-ramp = ramps while held.
              Rest position = where a switch/ramp sits when released: <b>center</b> (1500), <b>min</b> (1000) or <b>hold</b> (stays put). Independent of stick modes.
            </p>
          </div>
        ) : (
          <button className="btn add-btn" onClick={openAdd}>+ Add channel</button>
        )}

        <p className="note">Up to {CHANNEL_COUNT} channels. Templates give you the model's default map; add or remove channels here for full flexibility.</p>
      </div>
      </div>
    </section>
  );
}
