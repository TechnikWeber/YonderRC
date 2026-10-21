import { useEffect, useRef, useState } from 'react';
import type { InputManager } from '../lib/input/inputManager';
import { padLabel } from '../lib/input/gamepadPick';
import { STANDARD_AXIS_NAMES, STANDARD_BUTTON_NAMES } from '../lib/input/padElements';
import {
  describeAxisSource,
  describeButtonSource,
  learnAxisSource,
  learnButtonSource,
  sharedStickAxes,
  withAxisSource,
  withButtonSource,
  withoutLayout,
  type PadProfiles,
} from '../lib/input/padProfiles';
import { Hint } from './Hint';

type Learning = { kind: 'axis' | 'button'; n: number } | null;

/** The way to move each stick for Learn — what the standard counts as right, and as up. */
const AXIS_PROMPT = ['Move it right…', 'Push it up…', 'Move it right…', 'Push it up…'];

/**
 * Setup › Controls › Game controller › Set up (v1.72): where the standard controls are on a
 * controller that reports a layout of its own — an RC transmitter in joystick mode, a pad
 * the browser does not know. Learned once from the device's raw readings; every model then
 * reads it through this (lib/input/padProfiles.ts). Locked while armed: a stick that
 * suddenly drives another channel is not something to find out on the move.
 */
export function PadSetup({
  input,
  id,
  profiles,
  onChange,
  locked,
  onClose,
}: {
  input: InputManager;
  id: string;
  profiles: PadProfiles;
  onChange: (next: PadProfiles) => void;
  locked: boolean;
  onClose: () => void;
}) {
  const [learning, setLearning] = useState<Learning>(null);
  const [live, setLive] = useState<{ axes: number[]; buttons: boolean[] } | null>(null);
  const layout = profiles[id]?.layout;
  // The interval below outlives renders; it must write into the setups as they are now.
  const latest = useRef({ profiles, onChange });
  latest.current = { profiles, onChange };

  useEffect(() => {
    const read = () => {
      const pad = input.listGamepads().find((p) => p.id === id);
      return pad ? input.peekGamepad(pad.index) : null;
    };
    setLive(read());
    const iv = setInterval(() => setLive(read()), 150);
    return () => clearInterval(iv);
  }, [input, id]);

  // Armed in the middle of learning: that learn is over, not paused.
  useEffect(() => {
    if (locked) setLearning(null);
  }, [locked]);

  useEffect(() => {
    if (!learning || locked) return;
    const read = () => {
      const pad = input.listGamepads().find((p) => p.id === id);
      return pad ? input.peekGamepad(pad.index) : null;
    };
    // Everything is compared against where it rested when Learn was pressed: a trigger
    // or a switch rests at an end, and a stick already held is not the one being taught.
    const rest = read();
    if (!rest) {
      setLearning(null);
      return;
    }
    const iv = setInterval(() => {
      const now = read();
      if (!now) return;
      const { profiles: current, onChange: commit } = latest.current;
      if (learning.kind === 'axis') {
        const src = learnAxisSource(learning.n, rest.axes, now.axes);
        if (!src) return;
        commit(withAxisSource(current, id, learning.n, src));
      } else {
        const src = learnButtonSource(rest, now);
        if (!src) return;
        commit(withButtonSource(current, id, learning.n, src));
      }
      setLearning(null);
    }, 80);
    return () => clearInterval(iv);
  }, [learning, locked, input, id]);

  const toggleLearn = (kind: 'axis' | 'button', n: number) =>
    setLearning((l) => (l?.kind === kind && l.n === n ? null : { kind, n }));
  const isLearning = (kind: 'axis' | 'button', n: number) => learning?.kind === kind && learning.n === n;
  const shared = sharedStickAxes(layout);
  const canLearn = !locked && live !== null;

  return (
    <div className="pad-setup">
      <div className="pad-setup-head">
        <b>Set up {padLabel(id)}</b>
        <button className="btn tiny ghost" onClick={onClose}>Close</button>
      </div>
      <p className="note">
        Models use the standard controls — left stick, R2/L2, A, Start. Show the app once where they are on
        this controller, and every model works with it. Whatever you leave alone keeps the controller's own number.
      </p>
      {locked && <p className="note warn-note">Disarm the vehicle to change the controller's setup.</p>}
      {!live && <p className="note warn-note">Not connected — connect it and press one of its buttons to learn.</p>}

      <div className="pad-map">
        {STANDARD_AXIS_NAMES.map((name, n) => (
          <div className="pad-map-row" key={`axis-${n}`}>
            <span className="pad-map-name">{name}</span>
            <span className="pad-map-src">{describeAxisSource(layout?.axes?.[n], n)}</span>
            <button className="btn tiny" disabled={!canLearn} onClick={() => toggleLearn('axis', n)}>
              {isLearning('axis', n) ? AXIS_PROMPT[n] : 'Learn'}
            </button>
            <button
              className="btn tiny ghost"
              disabled={locked || layout?.axes?.[n] === undefined}
              title="Back to the controller's own number"
              onClick={() => onChange(withAxisSource(profiles, id, n, undefined))}
            >
              ↺
            </button>
          </div>
        ))}
      </div>
      {shared.length > 0 && (
        <p className="note warn-note">
          ⚠ Axis {shared.join(', ')} drives two sticks at once — learn the other stick too.
        </p>
      )}

      <details className="pad-map-buttons">
        <summary>Buttons and switches (A … Home)</summary>
        <div className="pad-map">
          {STANDARD_BUTTON_NAMES.map((name, n) => (
            <div className="pad-map-row" key={`button-${n}`}>
              <span className="pad-map-name">{name}</span>
              <span className="pad-map-src">{describeButtonSource(layout?.buttons?.[n], n)}</span>
              <button className="btn tiny" disabled={!canLearn} onClick={() => toggleLearn('button', n)}>
                {isLearning('button', n) ? 'Press it…' : 'Learn'}
              </button>
              <button
                className="btn tiny ghost"
                disabled={locked || layout?.buttons?.[n] === undefined}
                title="Back to the controller's own number"
                onClick={() => onChange(withButtonSource(profiles, id, n, undefined))}
              >
                ↺
              </button>
            </div>
          ))}
        </div>
        <p className="note">
          A switch the controller reports as an axis works here too: flip it from the position that means
          off. A stick pushed one way can stand in for a trigger — R2 up, L2 down, say.
        </p>
      </details>

      {live && (
        <div className="pad-live mono" aria-label="What the controller reports right now">
          {live.axes.map((v, i) => `${i} ${v >= 0 ? '+' : '−'}${Math.abs(v).toFixed(2)}`).join(' · ')}
          {live.buttons.some(Boolean) ? `  ·  buttons ${live.buttons.flatMap((b, i) => (b ? [i] : [])).join(', ')}` : ''}
        </div>
      )}

      <div className="log-row">
        <button className="btn tiny" disabled={locked || !layout} onClick={() => onChange(withoutLayout(profiles, id))}>
          Reset to its own numbers
        </button>
      </div>
      <Hint summary="Channels learned with this controller before it was set up">
        Learn in the channel editor stored the controller's own numbers. Where the setup now moves a number to
        another control — the sticks above, mostly — such a channel follows the new meaning. Check those
        channels and press Learn on them once more; from now on Learn stores the standard control, which works
        with any controller.
      </Hint>
    </div>
  );
}
