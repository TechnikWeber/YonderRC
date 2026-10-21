import { useEffect, useState } from 'react';
import { CHANNEL_COUNT, curveIsIdentity } from '@yonderrc/protocol';
import type { BindingMode, ChannelBinding, Detent, InputMethod, Profile, StickAxis, StickMode } from '@yonderrc/protocol';
import {
  applyEndpoints,
  applyStickMode,
  createBinding,
  detachIfNotStick,
  disarmedThrottleUs,
  funcFromLabel,
  nextFreeChannel,
  rebuildForMethod,
  setDetent,
  stickModes,
  throttleChannelsOf,
  throttleFailsafeRisk,
  throttleRestStick,
  withResolvedThrottle,
} from '../lib/templates';
import { clampPercent, limitOf, LIMIT_MAX_PCT, LIMIT_MIN_PCT, LIMIT_STEP_LABELS } from '../lib/throttleLimit';
import { CurveEditor } from './CurveEditor';
import type { InputManager } from '../lib/input/inputManager';
import { movedAxis, newlyPressed } from '../lib/input/gamepadPick';
import { describeElement, pairElement, parsePairElement } from '../lib/input/padElements';
import { createFollower, followElement, followedChannel, isFollower, leaderCandidates, leaderOf, throttleOutputsOf } from '../lib/follow';
import { trimmableBindings, trimTargetOf } from '../lib/trim';
import { channelName } from '../lib/channelName';
import { Hint } from './Hint';

const METHODS: InputMethod[] = ['keyboard', 'gamepad', 'touch'];
const DETENTS: Detent[] = ['center', 'low', 'free'];
const AXIS_ORDER: StickAxis[] = ['leftX', 'leftY', 'rightX', 'rightY'];
const AXIS_LABEL: Record<StickAxis, string> = { leftX: 'Left ◀▶', leftY: 'Left ▲▼', rightX: 'Right ◀▶', rightY: 'Right ▲▼' };
const SOURCES: ChannelBinding['source'][] = ['keyboard', 'gamepad', 'onscreen', 'follow'];
const SOURCE_LABEL: Partial<Record<ChannelBinding['source'], string>> = { follow: 'follow another channel' };
const MODES: BindingMode[] = ['proportional', 'momentary', 'toggle', 'hold-ramp'];
const RESTS: Detent[] = ['center', 'low', 'free'];
const REST_LABEL: Record<Detent, string> = { center: 'center', low: 'min', free: 'hold' };

/** `pair`: a gamepad axis made of two buttons (element `buttons:P:N`). */
type Draft = { channel: number; label: string; source: ChannelBinding['source']; mode: BindingMode; element: string; detent: Detent; pair: boolean };
/** What Learn is listening for: the input itself, or one side of a two-button axis. */
type Learning = null | 'element' | 'pos' | 'neg';

export function BindingEditor({
  profile,
  locked = false,
  input,
  outputs,
  onChange: onChangeRaw,
  onRename,
  onDelete,
  onDuplicate,
}: {
  profile: Profile;
  locked?: boolean;
  input: InputManager;
  /** What each channel is wired to on the vehicle (welcome.outputs). */
  outputs?: string[];
  onChange: (next: Profile) => void;
  onRename: (name: string) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  // Every edit re-derives which channels carry throttle, so the stored list can
  // never drift away from the bindings — it drives the disarmed value, the
  // failsafe array and the pre-arm check.
  const onChange = (next: Profile) => onChangeRaw(withResolvedThrottle(next));

  // Speed-limit steps live on the throttle channel, where you'd look for them.
  const throttleSet = new Set(throttleChannelsOf(profile));
  // …plus the followers of a throttle channel: they stop with it.
  const throttleOutputs = new Set(throttleOutputsOf(profile));
  const limit = limitOf(profile);
  const setLimitStepPct = (i: 0 | 1 | 2, pct: number) => {
    const steps = [...limit.steps] as [number, number, number];
    steps[i] = clampPercent(pct);
    onChange({ ...profile, throttleLimit: { ...limit, steps } });
  };

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
  const emptyDraft = (): Draft => ({ channel: nextFreeChannel(profile), label: '', source: 'keyboard', mode: 'momentary', element: '', detent: 'center', pair: false });
  const [draft, setDraft] = useState<Draft>(emptyDraft);
  const [learning, setLearning] = useState<Learning>(null);

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
      pair: b.source === 'gamepad' && parsePairElement(b.element) !== null,
    });
    setAdding(true);
  };
  const closeForm = () => {
    setAdding(false);
    setEditingId(null);
    setLearning(null);
  };

  // Capture a keyboard key or gamepad button/axis for the new binding's element.
  useEffect(() => {
    if (!learning) return;
    if (draft.source === 'keyboard') {
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        setDraft((d) => ({ ...d, element: e.key.toLowerCase() }));
        setLearning(null);
      };
      window.addEventListener('keydown', onKey, { once: true });
      return () => window.removeEventListener('keydown', onKey);
    }
    if (draft.source === 'gamepad') {
      // Compared against where everything rested when Learn was pressed: a trigger in a
      // controller's own layout rests at −1 and used to be "learned" instantly, and a
      // button already held down is not the one being chosen.
      const axesNow = () => Array.from({ length: 8 }, (_, a) => input.readGamepadAxis(a));
      const restAxes = axesNow();
      const restButtons = input.readGamepadButtons();
      const id = setInterval(() => {
        const bi = newlyPressed(restButtons, input.readGamepadButtons());
        // One side of a two-button axis: only a button will do — in the standard layout
        // the triggers are buttons 6 and 7, in the browser and in the desktop app alike.
        if (learning === 'pos' || learning === 'neg') {
          if (bi < 0) return;
          setDraft((d) => {
            const cur = parsePairElement(d.element) ?? { pos: null, neg: null };
            return { ...d, element: learning === 'pos' ? pairElement(bi, cur.neg) : pairElement(cur.pos, bi) };
          });
          setLearning(null);
          return;
        }
        if (bi >= 0) {
          setDraft((d) => ({ ...d, element: `button:${bi}` }));
          setLearning(null);
          return;
        }
        const a = movedAxis(restAxes, axesNow());
        if (a >= 0) {
          setDraft((d) => ({ ...d, element: `axis:${a}` }));
          setLearning(null);
        }
      }, 80);
      return () => clearInterval(id);
    }
    return;
  }, [learning, draft.source, input]);

  // Two buttons rest in the middle. Right for steering, and for a car's or boat's
  // throttle (centre = stop) — wrong for a throttle that rests at idle, where both
  // released would be half throttle. The pre-arm check would refuse to arm; better to
  // say so here.
  const draftLabel = draft.label || (editingId ? profile.bindings.find((b) => b.id === editingId)?.label ?? '' : '');
  const pairProblem =
    draft.source === 'gamepad' && draft.mode === 'proportional' && draft.pair &&
    funcFromLabel(draftLabel) === 'throttle' && throttleRestStick(undefined, profile.vehicleType) !== 0
      ? `Two buttons rest in the middle, and a ${profile.vehicleType}'s throttle rests at idle — use a stick for it.`
      : null;
  const draftLeader = draft.source === 'follow' ? followedChannel({ source: 'follow', element: draft.element }) : null;
  // What the channel being edited may copy — never itself, wherever it is about to move.
  const followable = leaderCandidates(profile, draft.channel).filter((b) => b.id !== editingId);
  const canSave =
    draft.source === 'follow'
      ? draftLeader !== null && followable.some((b) => b.channel === draftLeader)
      : draft.source === 'onscreen'
        ? true
        : draft.pair
          ? parsePairElement(draft.element) !== null && !pairProblem
          : draft.element.trim() !== '';

  const saveFollower = () => {
    const leader = followable.find((b) => b.channel === draftLeader);
    if (!leader) return;
    const label = draft.label || (editingId ? profile.bindings.find((b) => b.id === editingId)?.label ?? '' : '');
    if (editingId) {
      onChange({
        ...profile,
        bindings: profile.bindings.map((b) =>
          b.id !== editingId
            ? b
            : isFollower(b)
              ? { ...b, channel: draft.channel, label: label || b.label, element: followElement(leader.channel) }
              : createFollower({ id: b.id, channel: draft.channel, leader, label }),
        ),
      });
    } else {
      onChange({ ...profile, bindings: [...profile.bindings, createFollower({ channel: draft.channel, leader, label })] });
    }
    closeForm();
  };

  const saveChannel = () => {
    if (!canSave) return;
    if (draft.source === 'follow') {
      saveFollower();
      return;
    }
    const element = draft.source === 'onscreen' ? 'btn' : draft.element.trim();
    // A two-button axis rests in the middle, whatever the form said.
    const detent: Detent = draft.pair ? 'center' : draft.detent;
    if (editingId) {
      // A channel that moves takes its followers along, rather than leaving them behind
      // with nothing to copy.
      const before = profile.bindings.find((b) => b.id === editingId);
      const movedFrom = before && !isFollower(before) && before.channel !== draft.channel ? before.channel : null;
      onChange({
        ...profile,
        bindings: profile.bindings.map((b) => {
          if (b.id === editingId)
            return detachIfNotStick(
              { ...b, channel: draft.channel, label: draft.label || b.label, source: draft.source, element, mode: draft.mode, detent },
              profile.inputMethod,
            );
          if (movedFrom !== null && followedChannel(b) === movedFrom) return { ...b, element: followElement(draft.channel) };
          return b;
        }),
      });
    } else {
      onChange({
        ...profile,
        bindings: [
          ...profile.bindings,
          createBinding({ channel: draft.channel, source: draft.source, element, mode: draft.mode, label: draft.label, endpoints: profile.endpoints, detent }),
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
        <div className="eyebrow">Endpoints <span className="nocaps">(µs)</span> — write to all channels</div>
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
        <Hint summary="A batch write, not a cap that keeps applying">
          Changing a value here stamps it into <i>every</i> channel below; each channel can be
          adjusted individually afterwards. Typical is 1000–2000 µs (absolute limit 500–2500). ESC
          calibration uses the throttle channel's own values, not these.
        </Hint>
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
        {profile.bindings.map((b) => {
          const follower = isFollower(b);
          const leader = follower ? leaderOf(profile, b) : null;
          const how = follower
            ? `follows ${leader ? `${channelName(leader.channel)} · ${leader.label ?? '—'}` : channelName(followedChannel(b) ?? b.channel)}`
            : `${b.source}/${b.mode}${b.element ? ` · ${b.source === 'gamepad' ? describeElement(b.element) : b.element}` : ''}`;
          return (
          <div className="binding" key={b.id}>
            <div className="binding-top">
              <span className="ch-label">{channelName(b.channel, outputs)} · {b.label ?? '—'}</span>
              <span className="ch-mode" title={how}>{how}</span>
              {/* Grouped so the controls can never end up on separate lines. Reverse is
                  here, not in the collapsed details: it is what people look for first,
                  and behind "trim · expo · …" nobody found it. */}
              <div className="ch-actions">
                <label className="rev-toggle" title="Reverse this channel's direction">
                  <input type="checkbox" checked={b.shaping.reverse} onChange={(e) => patchShaping(b.id, { reverse: e.target.checked })} />
                  reverse
                </label>
                <button className="btn tiny" onClick={() => openEdit(b)} title="Edit channel">Edit</button>
                <button className="btn tiny danger" onClick={() => removeBinding(b.id)} title="Remove channel">Remove</button>
              </div>
            </div>
            {follower && !leader && (
              <p className="ch-warn">
                ⚠ {channelName(followedChannel(b) ?? b.channel)} has no input of its own to copy — this channel
                holds its failsafe value ({b.shaping.failsafeUs} µs). Edit it and pick the channel to follow.
              </p>
            )}
            {/* Shown outside the collapsed <details>: a failsafe that opens the
                throttle is not something you should have to expand a row to find.
                The value is a raw µs, so on a reversed channel a perfectly
                innocent-looking 1000 means full power. */}
            {throttleSet.has(b.channel) && (() => {
              const risk = throttleFailsafeRisk(profile.vehicleType, b.shaping);
              if (!risk) return null;
              return (
                <p className="ch-warn">
                  ⚠ Failsafe {b.shaping.failsafeUs} µs = <b>{risk.percent}% throttle</b> on this channel
                  {b.shaping.reverse ? ' (reverse is on, so the endpoints are swapped)' : ''} — on link loss it
                  would open up, not shut down. Motor-off here is <b>{risk.safeUs} µs</b>.
                </p>
              );
            })()}
            <details className="shaping">
              {/* The disarmed value is only shown on a throttle channel, because
                  that's the only place it differs from the failsafe — and seeing
                  "fs 1500" next to a channel sitting at 1000 is otherwise a
                  puzzle rather than information. */}
              <summary title={throttleSet.has(b.channel) ? `Failsafe = link loss WHILE ARMED. Disarmed = deliberately off, on the ground. For a ${profile.vehicleType} these are different on purpose.` : undefined}>
                {follower ? (
                  <>
                    offset {b.shaping.trimUs} µs · {b.shaping.minUs}–{b.shaping.maxUs} µs{b.shaping.reverse ? ' · rev' : ''} · failsafe
                    {throttleOutputs.has(b.channel) ? ' and disarmed' : ''} {leader ? `follow ${channelName(leader.channel)}` : 'stored'}
                  </>
                ) : (
                  <>
                    trim {b.shaping.trimUs} · expo {b.shaping.expo} · {b.shaping.minUs}–{b.shaping.maxUs} µs · fs {b.shaping.failsafeUs}
                    {throttleSet.has(b.channel) ? ` · disarmed ${disarmedThrottleUs(profile.vehicleType, b.shaping)}` : ''}
                    {b.shaping.reverse ? ' · rev' : ''}
                    {curveIsIdentity(b.shaping.curve) ? '' : ` · curve ${b.shaping.curve!.points.length}pt`}
                    {b.detent ? ` · rest ${REST_LABEL[b.detent]}` : ''}
                  </>
                )}
              </summary>
              {/* A follower copies its leader's final value: its own are only the offset
                  (two servos rarely centre on the same µs) and the endpoints. Expo, curve
                  and failsafe come with the copy. */}
              <div className="shaping-grid">
                <label>{follower ? 'offset µs' : 'trim µs'}<input type="number" value={b.shaping.trimUs} onChange={(e) => patchShaping(b.id, { trimUs: Number(e.target.value) })} /></label>
                {!follower && <label>expo<input type="number" step={0.05} min={0} max={1} value={b.shaping.expo} onChange={(e) => patchShaping(b.id, { expo: Number(e.target.value) })} /></label>}
                <label>min µs<input type="number" value={b.shaping.minUs} onChange={(e) => patchShaping(b.id, { minUs: Number(e.target.value) })} /></label>
                <label>max µs<input type="number" value={b.shaping.maxUs} onChange={(e) => patchShaping(b.id, { maxUs: Number(e.target.value) })} /></label>
                {!follower && <label>failsafe µs<input type="number" value={b.shaping.failsafeUs} onChange={(e) => patchShaping(b.id, { failsafeUs: Number(e.target.value) })} /></label>}
              </div>
              {/* Only stick axes get a curve — a switch has two positions, there is
                  nothing in between to shape. */}
              {b.mode === 'proportional' && !follower && (
                <CurveEditor
                  curve={b.shaping.curve}
                  disabled={locked}
                  onChange={(c) => patchShaping(b.id, { curve: c })}
                />
              )}
              {throttleSet.has(b.channel) && (
                <>
                  <div className="eyebrow2" style={{ marginTop: 10 }}>Speed limit steps (%)</div>
                  <div className="shaping-grid">
                    {([0, 1, 2] as const).map((i) => (
                      <label key={i}>
                        {LIMIT_STEP_LABELS[i]}
                        <input
                          type="number"
                          min={LIMIT_MIN_PCT}
                          max={LIMIT_MAX_PCT}
                          value={limit.steps[i]}
                          onChange={(e) => setLimitStepPct(i, Number(e.target.value))}
                        />
                      </label>
                    ))}
                  </div>
                  <Hint summary="How the steps scale around the rest position">
                    Switched while driving with the three buttons under the sticks (and a bindable
                    controller button). The command is scaled around this channel's rest position:
                    it rests at <b>{throttleRestStick(b, profile.vehicleType) === 0 ? 'centre' : 'idle'}</b>, so{' '}
                    {throttleRestStick(b, profile.vehicleType) === 0
                      ? 'forward and reverse are capped equally'
                      : 'idle stays exactly where it is and only the way up is capped'}.
                    Endpoints, failsafe, the disarmed value and the pre-arm check are untouched.
                  </Hint>
                </>
              )}
            </details>
          </div>
          );
        })}

        {adding ? (
          <div className="add-channel">
            <div className="add-grid">
              <label>Channel
                <select value={draft.channel} onChange={(e) => setDraft({ ...draft, channel: Number(e.target.value) })}>
                  {Array.from({ length: CHANNEL_COUNT }, (_, i) => (
                    <option key={i} value={i}>{channelName(i, outputs)}{profile.bindings.some((b) => b.channel === i) ? ' (in use)' : ''}</option>
                  ))}
                </select>
              </label>
              <label>Label<input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="e.g. Winch" /></label>
              <label>Source
                <select value={draft.source} onChange={(e) => setDraft({ ...draft, source: e.target.value as ChannelBinding['source'], element: '', pair: false })}>
                  {SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s] ?? s}</option>)}
                </select>
              </label>
              {draft.source !== 'follow' && (
                <label>Mode
                  <select
                    value={draft.mode}
                    onChange={(e) => {
                      const mode = e.target.value as BindingMode;
                      // Two buttons make an axis; as a switch they would make no sense.
                      setDraft((d) => ({ ...d, mode, ...(mode !== 'proportional' && d.pair ? { pair: false, element: '' } : {}) }));
                    }}
                  >
                    {MODES.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                </label>
              )}
              {draft.source === 'follow' ? (
                <label className="add-element">Copies
                  <select
                    value={draftLeader ?? ''}
                    onChange={(e) => setDraft({ ...draft, element: e.target.value === '' ? '' : followElement(Number(e.target.value)) })}
                  >
                    <option value="">— pick the channel to follow —</option>
                    {followable.map((b) => (
                      <option key={b.id} value={b.channel}>{channelName(b.channel, outputs)} · {b.label ?? '—'}</option>
                    ))}
                  </select>
                </label>
              ) : draft.pair ? (
                <div className="add-element pair-learn">
                  {(['pos', 'neg'] as const).map((side) => {
                    const p = parsePairElement(draft.element);
                    const n = side === 'pos' ? p?.pos : p?.neg;
                    return (
                      <label key={side}>
                        {side === 'pos' ? '+ button (forward, right)' : '− button (back, left)'}
                        <div className="learn-row">
                          <input
                            type="number"
                            min={0}
                            value={n ?? ''}
                            placeholder={side === 'pos' ? '7 = RT/R2' : '6 = LT/L2'}
                            onChange={(e) => {
                              const v = e.target.value === '' ? null : Number(e.target.value);
                              setDraft((d) => {
                                const cur = parsePairElement(d.element) ?? { pos: null, neg: null };
                                return { ...d, element: side === 'pos' ? pairElement(v, cur.neg) : pairElement(cur.pos, v) };
                              });
                            }}
                          />
                          <button className="btn tiny" onClick={() => setLearning((l) => (l === side ? null : side))}>{learning === side ? 'Press…' : 'Learn'}</button>
                        </div>
                      </label>
                    );
                  })}
                </div>
              ) : (
                draft.source !== 'onscreen' && (
                  <label className="add-element">Input
                    <div className="learn-row">
                      <input
                        value={draft.element}
                        onChange={(e) => setDraft({ ...draft, element: e.target.value })}
                        placeholder={draft.source === 'keyboard' ? "key e.g. r  ·  axis: a|d" : 'button:0 · axis:2'}
                      />
                      <button className="btn tiny" onClick={() => setLearning((l) => (l === 'element' ? null : 'element'))}>{learning === 'element' ? 'Press…' : 'Learn'}</button>
                    </div>
                  </label>
                )
              )}
              {draft.source === 'gamepad' && draft.mode === 'proportional' && (
                <label className="chk add-element">
                  <input type="checkbox" checked={draft.pair} onChange={(e) => setDraft({ ...draft, pair: e.target.checked, element: '' })} />
                  Two buttons as one axis — e.g. RT/R2 forward, LT/L2 back. Rests in the middle.
                </label>
              )}
              {draft.source !== 'follow' && !draft.pair && (
                <label className="add-rest">Rest position
                  <select value={draft.detent} onChange={(e) => setDraft({ ...draft, detent: e.target.value as Detent })}>
                    {RESTS.map((d) => <option key={d} value={d}>{REST_LABEL[d]}</option>)}
                  </select>
                </label>
              )}
            </div>
            {pairProblem && <p className="ch-warn">⚠ {pairProblem}</p>}
            <div className="add-actions">
              <button className="btn" onClick={saveChannel} disabled={!canSave}>{editingId ? 'Save' : 'Add'}</button>
              <button className="btn ghost" onClick={closeForm}>Cancel</button>
            </div>
            <p className="note">
              proportional = axis (keyboard needs two keys like <code>a|d</code>) · momentary = while held · toggle = on/off · hold-ramp = ramps while held.
              Rest position = where a switch/ramp sits when released: <b>center</b> (1500), <b>min</b> (1000) or <b>hold</b> (stays put). Independent of stick modes.
              <b> Follow another channel</b> copies that channel's final value, with its own offset, reverse and endpoints — a second
              steering servo, a second ESC. Its failsafe (and, on a throttle, its disarmed value) follow too.
            </p>
          </div>
        ) : (
          <button className="btn add-btn" onClick={openAdd}>+ Add channel</button>
        )}

        <p className="note">Up to {CHANNEL_COUNT} channels. Templates give you the model's default map; add or remove channels here for full flexibility.</p>
      </div>

      {trimmableBindings(profile).length > 0 && (
        <div className="field">
          <div className="eyebrow">Trim buttons</div>
          <label className="trim-target">Trim −/+ act on
            <select value={trimTargetOf(profile) ?? ''} onChange={(e) => onChange({ ...profile, trimTarget: e.target.value || undefined })}>
              {trimmableBindings(profile).map((b) => (
                <option key={b.id} value={b.id}>{channelName(b.channel, outputs)} · {b.label ?? '—'}</option>
              ))}
            </select>
          </label>
          <p className="note">
            Bind the two buttons under Controls › Action bindings: 5 µs a press, up to ±150 µs, saved with the
            model — the same trim as the buttons under the sticks.
          </p>
        </div>
      )}
      </div>
    </section>
  );
}
