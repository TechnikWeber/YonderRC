import { useEffect, useRef, useState } from 'react';
import type { InputManager } from '../lib/input/inputManager';
import { assessPad, choosePad, padLabel, rankPads, type PadInfo } from '../lib/input/gamepadPick';
import { Hint } from './Hint';

/**
 * Setup › Controls › Game controller: every device the browser reports, which one is
 * being read, and a way to pick another. Everything stays listed — a device the
 * heuristic doubts may still be the one you want, an RC transmitter in joystick mode
 * for instance — but only a likely controller is ever chosen automatically.
 *
 * The list is polled while the group is open: the Gamepad API has connect events, but
 * a browser only fires them after a button press, and the live "input" marker is what
 * tells two similar entries apart anyway.
 */
export function ControllerPicker({ input }: { input: InputManager }) {
  const [open, setOpen] = useState(false);
  const [pads, setPads] = useState<PadInfo[]>(() => input.listGamepads());
  const [pref, setPref] = useState<string | null>(() => input.preferredGamepad);
  const [busy, setBusy] = useState<Set<number>>(new Set());
  const last = useRef(new Map<number, number[]>());

  useEffect(() => {
    const poll = () => {
      const list = input.listGamepads();
      setPads((prev) => (JSON.stringify(prev) === JSON.stringify(list) ? prev : list));
      if (!open) return;
      // "Input right now": a button held, or a stick that moved since the last poll.
      const moving = new Set<number>();
      for (const p of list) {
        const s = input.peekGamepad(p.index);
        if (!s) continue;
        const before = last.current.get(p.index);
        if (s.buttons.some(Boolean) || (before && s.axes.some((v, i) => Math.abs(v - (before[i] ?? v)) > 0.15))) moving.add(p.index);
        last.current.set(p.index, s.axes);
      }
      setBusy(moving);
    };
    poll();
    const id = setInterval(poll, open ? 250 : 1500);
    return () => clearInterval(id);
  }, [input, open]);

  const select = (id: string | null) => {
    input.setPreferredGamepad(id);
    setPref(id);
  };

  const active = choosePad(pads, pref);
  const auto = choosePad(pads, null);
  const ranked = rankPads(pads);
  const prefMissing = !!pref && !pads.some((p) => p.id === pref);

  return (
    <details className="group" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="eyebrow">
        Game controller{' '}
        <span className={`group-badge ${active ? 'go' : 'idle'}`}>{active ? 'connected' : 'none'}</span>
      </summary>
      <div className="pad-list">
        <label className={`radio pad-row${pref === null ? ' on' : ''}`}>
          <input type="radio" name="padpick" checked={pref === null} onChange={() => select(null)} />
          <span className="pad-name">Automatic — best match{auto ? `: ${padLabel(auto.id)}` : ' (none found)'}</span>
        </label>
        {ranked.map((p) => {
          const a = assessPad(p);
          return (
            <label key={`${p.index}:${p.id}`} className={`radio pad-row${pref === p.id ? ' on' : ''}`} title={`${p.id}\n${a.reasons.join(' · ')}`}>
              <input type="radio" name="padpick" checked={pref === p.id} onChange={() => select(p.id)} />
              <span className="pad-name">{padLabel(p.id)}</span>
              <span className={`pad-tag ${a.likely ? 'go' : 'idle'}`}>
                {a.likely ? (a.layout === 'standard' ? 'controller' : 'controller · own layout') : 'probably not a controller'}
              </span>
              {active?.index === p.index && <span className="pad-tag go">in use</span>}
              {busy.has(p.index) && <span className="pad-dot" title="input right now" />}
            </label>
          );
        })}
      </div>
      {pads.length === 0 && (
        <p className="note">
          No controller visible yet. A browser only reveals a controller after one of its <b>buttons is
          pressed</b> while this page has focus — press one now. Over Bluetooth it has to be paired with
          the computer or phone first.
        </p>
      )}
      {pads.length > 0 && !auto && pref === null && (
        <p className="note warn-note">
          Nothing here looks like a game controller, so none is used automatically. If one of them is
          yours, pick it.
        </p>
      )}
      {prefMissing && (
        <p className="note warn-note">
          The chosen controller is not connected — {auto ? `using ${padLabel(auto.id)} meanwhile` : 'none is used meanwhile'}.
        </p>
      )}
      {active && active.mapping !== 'standard' && (
        <p className="note">
          <b>{padLabel(active.id)}</b> reports its own layout, so the stick numbers may not be where the
          model templates expect them. Use <b>Learn</b> in the channel editor to assign each axis by moving it.
        </p>
      )}
      <Hint summary="PS4 / PS5 controller: pairing and the usual traps">
        <b>USB</b> works straight away. <b>Bluetooth</b>: hold <b>Share + PS</b> (PS5: <b>Create + PS</b>) until
        the light bar flashes, then pair it in the system's Bluetooth settings as "Wireless Controller". In
        Chrome and Edge it then appears with the <b>standard layout</b> — sticks on axes 0–3, triggers as
        buttons 6/7 — which is what the gamepad templates use. Then press a button on it once. Three things
        get in the way: <b>DS4Windows</b> (or similar tools) hide the controller and offer an emulated Xbox
        pad instead — pick that one, or close the tool; <b>Steam</b> can grab the controller while it is
        running — close it if the controller shows no input here; and on <b>Linux</b> the kernel lists the
        pad's touchpad and motion sensors as separate devices — they are recognised and never used
        automatically. Whether it rumbles depends on the browser; Chrome and Edge do it.
      </Hint>
    </details>
  );
}
