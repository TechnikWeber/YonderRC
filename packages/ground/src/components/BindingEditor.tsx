import { useEffect, useRef, useState } from 'react';
import { CHANNEL_COUNT, defaultShaping } from '@yonderrc/protocol';
import type { BindingMode, ChannelBinding, InputSource, Profile } from '@yonderrc/protocol';
import type { InputManager } from '../lib/input/inputManager';
import { makeBinding } from '../lib/profiles';

const SOURCES: InputSource[] = ['keyboard', 'gamepad', 'onscreen', 'virtual'];
const MODES: BindingMode[] = ['proportional', 'momentary', 'toggle', 'hold-ramp'];
const JOY_OPTIONS = ['joy:L:x', 'joy:L:y', 'joy:R:x', 'joy:R:y'];

function elementPlaceholder(source: InputSource, mode: BindingMode): string {
  if (source === 'keyboard') return mode === 'proportional' ? 'negKey|posKey e.g. a|d' : 'key e.g. l or space';
  if (source === 'gamepad') return mode === 'proportional' ? 'axis:0 or axis:3:inv' : 'button:1';
  if (source === 'virtual') return 'joy:L:x';
  return 'btn';
}

export function BindingEditor({
  profile,
  input,
  onChange,
  onRename,
  onDelete,
  onDuplicate,
}: {
  profile: Profile;
  input: InputManager;
  onChange: (next: Profile) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const [learningId, setLearningId] = useState<string | null>(null);
  const learnKindRef = useRef<'axis' | 'button' | 'key'>('key');

  const update = (bindings: ChannelBinding[]) => onChange({ ...profile, bindings });
  const patchBinding = (id: string, patch: Partial<ChannelBinding>) =>
    update(profile.bindings.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  const patchShaping = (id: string, patch: Partial<ChannelBinding['shaping']>) =>
    update(
      profile.bindings.map((b) =>
        b.id === id ? { ...b, shaping: { ...b.shaping, ...patch } } : b,
      ),
    );

  // Learn: capture the next input of the requested kind and write the element.
  useEffect(() => {
    if (!learningId) return;
    const kind = learnKindRef.current;

    if (kind === 'key') {
      const onKey = (e: KeyboardEvent) => {
        const k = e.key === ' ' ? 'space' : e.key.toLowerCase();
        patchBinding(learningId, { element: k });
        setLearningId(null);
      };
      window.addEventListener('keydown', onKey, { once: true });
      return () => window.removeEventListener('keydown', onKey);
    }

    // gamepad axis/button: poll until something moves / is pressed
    const iv = setInterval(() => {
      if (kind === 'axis') {
        for (let n = 0; n < 8; n++) {
          const v = input.readGamepadAxis(n);
          if (v !== null && Math.abs(v) > 0.6) {
            patchBinding(learningId, { element: `axis:${n}` });
            setLearningId(null);
            return;
          }
        }
      } else {
        const buttons = input.readGamepadButtons();
        const idx = buttons.findIndex((p) => p);
        if (idx >= 0) {
          patchBinding(learningId, { element: `button:${idx}` });
          setLearningId(null);
        }
      }
    }, 60);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learningId]);

  const startLearn = (b: ChannelBinding) => {
    learnKindRef.current =
      b.source === 'keyboard' ? 'key' : b.mode === 'proportional' ? 'axis' : 'button';
    setLearningId(b.id);
  };

  return (
    <section className="panel editor">
      <div className="editor-head">
        <input
          className="name-input"
          value={profile.name}
          onChange={(e) => onRename(e.target.value)}
          aria-label="Profile name"
        />
        <div className="editor-actions">
          <button className="btn" onClick={onDuplicate}>Duplicate</button>
          <button className="btn" onClick={onDelete}>Delete</button>
        </div>
      </div>

      <label className="throttle-row">
        Throttle channels (safe while disarmed)
        <input
          className="mono-input"
          value={profile.throttleChannels.map((c) => c + 1).join(', ')}
          onChange={(e) =>
            onChange({
              ...profile,
              throttleChannels: e.target.value
                .split(',')
                .map((s) => Number(s.trim()) - 1)
                .filter((n) => Number.isInteger(n) && n >= 0 && n < CHANNEL_COUNT),
            })
          }
        />
      </label>

      {profile.bindings.map((b) => (
        <div className="binding" key={b.id}>
          <div className="binding-top">
            <label>
              CH
              <input
                type="number"
                min={1}
                max={CHANNEL_COUNT}
                value={b.channel + 1}
                onChange={(e) => patchBinding(b.id, { channel: Number(e.target.value) - 1 })}
              />
            </label>
            <select
              value={b.source}
              onChange={(e) => patchBinding(b.id, { source: e.target.value as InputSource })}
            >
              {SOURCES.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
            <select
              value={b.mode}
              onChange={(e) => patchBinding(b.id, { mode: e.target.value as BindingMode })}
            >
              {MODES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <button
              className="btn del"
              onClick={() => update(profile.bindings.filter((x) => x.id !== b.id))}
              aria-label="Remove binding"
            >
              ✕
            </button>
          </div>

          <div className="binding-el">
            {b.source === 'virtual' ? (
              <select value={b.element} onChange={(e) => patchBinding(b.id, { element: e.target.value })}>
                {JOY_OPTIONS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
            ) : b.source === 'onscreen' ? (
              <span className="el-fixed">on-screen button (auto)</span>
            ) : (
              <>
                <input
                  className="mono-input"
                  value={b.element}
                  placeholder={elementPlaceholder(b.source, b.mode)}
                  onChange={(e) => patchBinding(b.id, { element: e.target.value })}
                />
                <button className="btn learn" onClick={() => startLearn(b)}>
                  {learningId === b.id ? 'press…' : 'Learn'}
                </button>
                {b.source === 'gamepad' && b.mode === 'proportional' && (
                  <label className="inv">
                    <input
                      type="checkbox"
                      checked={b.element.endsWith(':inv')}
                      onChange={(e) => {
                        const base = b.element.replace(/:inv$/, '');
                        patchBinding(b.id, { element: e.target.checked ? `${base}:inv` : base });
                      }}
                    />
                    inv
                  </label>
                )}
              </>
            )}
          </div>

          <details className="shaping">
            <summary>trim {b.shaping.trimUs} · expo {b.shaping.expo} · {b.shaping.minUs}–{b.shaping.maxUs} · fs {b.shaping.failsafeUs}{b.shaping.reverse ? ' · rev' : ''}</summary>
            <div className="shaping-grid">
              <label>trim µs<input type="number" value={b.shaping.trimUs} onChange={(e) => patchShaping(b.id, { trimUs: Number(e.target.value) })} /></label>
              <label>expo<input type="number" step={0.05} min={0} max={1} value={b.shaping.expo} onChange={(e) => patchShaping(b.id, { expo: Number(e.target.value) })} /></label>
              <label>min µs<input type="number" value={b.shaping.minUs} onChange={(e) => patchShaping(b.id, { minUs: Number(e.target.value) })} /></label>
              <label>max µs<input type="number" value={b.shaping.maxUs} onChange={(e) => patchShaping(b.id, { maxUs: Number(e.target.value) })} /></label>
              <label>failsafe µs<input type="number" value={b.shaping.failsafeUs} onChange={(e) => patchShaping(b.id, { failsafeUs: Number(e.target.value) })} /></label>
              <label className="rev">reverse<input type="checkbox" checked={b.shaping.reverse} onChange={(e) => patchShaping(b.id, { reverse: e.target.checked })} /></label>
              {b.mode === 'hold-ramp' && (
                <label>ramp s<input type="number" step={0.1} min={0.1} value={b.holdRampSeconds ?? 0.5} onChange={(e) => patchBinding(b.id, { holdRampSeconds: Number(e.target.value) })} /></label>
              )}
            </div>
          </details>
        </div>
      ))}

      <button
        className="btn wide"
        onClick={() =>
          update([...profile.bindings, makeBinding(profile.bindings.length % CHANNEL_COUNT, 'onscreen', 'btn', 'momentary', defaultShaping())])
        }
      >
        + Add binding
      </button>
    </section>
  );
}
