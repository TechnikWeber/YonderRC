import { useEffect, useState } from 'react';
import { ACTION_LABELS, type ActionBindings, type ActionId } from '../lib/actions';
import type { BatteryWarnCfg } from '../lib/battery';
import type { InputManager } from '../lib/input/inputManager';

const ORDER: ActionId[] = ['panic-disarm', 'toggle-arm', 'next-camera', 'record-toggle', 'snapshot'];

export function ControlsPanel({
  bindings,
  onBindings,
  preArm,
  onPreArm,
  battery,
  onBattery,
  input,
}: {
  bindings: ActionBindings;
  onBindings: (b: ActionBindings) => void;
  preArm: boolean;
  onPreArm: (v: boolean) => void;
  battery: BatteryWarnCfg;
  onBattery: (c: BatteryWarnCfg) => void;
  input: InputManager;
}) {
  const [learn, setLearn] = useState<{ id: ActionId; what: 'key' | 'button' } | null>(null);

  const set = (id: ActionId, patch: Partial<ActionBindings[ActionId]>) =>
    onBindings({ ...bindings, [id]: { ...bindings[id], ...patch } });
  const setBat = (patch: Partial<BatteryWarnCfg>) => onBattery({ ...battery, ...patch });

  // Capture the next key or gamepad button for the action being learned.
  useEffect(() => {
    if (!learn) return;
    if (learn.what === 'key') {
      const onKey = (e: KeyboardEvent) => {
        e.preventDefault();
        set(learn.id, { key: e.key.toLowerCase() });
        setLearn(null);
      };
      window.addEventListener('keydown', onKey, { once: true });
      return () => window.removeEventListener('keydown', onKey);
    }
    const iv = setInterval(() => {
      const btns = input.readGamepadButtons();
      const bi = btns.findIndex((p) => p);
      if (bi >= 0) {
        set(learn.id, { button: bi });
        setLearn(null);
      }
    }, 70);
    return () => clearInterval(iv);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [learn, input]);

  return (
    <section className="panel controls-panel">
      <div className="eyebrow">Safety</div>
      <label className="opt big">
        <input type="checkbox" checked={preArm} onChange={(e) => onPreArm(e.target.checked)} />
        Pre-arm check — refuse to arm unless throttle is at its rest position
      </label>
      <p className="note">Uses each throttle channel's detent: centre for reverse-capable cars and drones, idle (min) for planes/boats. Prevents a lurch on arming.</p>

      <div className="eyebrow" style={{ marginTop: 14 }}>Action bindings</div>
      <p className="note">Assign any action to a keyboard key and/or a controller button. Panic disarms immediately over the reliable link.</p>
      <div className="actions-grid">
        <div className="actions-head"><span>Action</span><span>Key</span><span>Button</span></div>
        {ORDER.map((id) => (
          <div className="action-row" key={id}>
            <span className="action-name">{ACTION_LABELS[id]}</span>
            <div className="learn-cell">
              <input
                value={bindings[id].key ?? ''}
                placeholder="—"
                onChange={(e) => set(id, { key: e.target.value ? e.target.value.toLowerCase().slice(-1) : null })}
              />
              <button className="btn tiny" onClick={() => setLearn({ id, what: 'key' })}>
                {learn?.id === id && learn.what === 'key' ? 'Press…' : 'Learn'}
              </button>
            </div>
            <div className="learn-cell">
              <input
                type="number"
                value={bindings[id].button ?? ''}
                placeholder="—"
                onChange={(e) => set(id, { button: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <button className="btn tiny" onClick={() => setLearn({ id, what: 'button' })}>
                {learn?.id === id && learn.what === 'button' ? 'Press…' : 'Learn'}
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="eyebrow" style={{ marginTop: 14 }}>Low-battery warning</div>
      <div className="batt-mode">
        {(['auto', 'on', 'off'] as const).map((m) => (
          <label key={m} className={`radio${battery.mode === m ? ' on' : ''}`}>
            <input type="radio" name="battmode" checked={battery.mode === m} onChange={() => setBat({ mode: m })} />
            {m === 'auto' ? 'auto (real sensor)' : m}
          </label>
        ))}
      </div>
      <div className="batt-grid">
        <label className="opt">
          <input type="checkbox" checked={battery.usePct} onChange={(e) => setBat({ usePct: e.target.checked })} />
          Percent ≤
        </label>
        <input type="number" value={battery.pctThreshold} onChange={(e) => setBat({ pctThreshold: Number(e.target.value) })} /> %
        <label className="opt">
          <input type="checkbox" checked={battery.useVolt} onChange={(e) => setBat({ useVolt: e.target.checked })} />
          Voltage ≤
        </label>
        <input type="number" step={0.1} value={battery.voltThreshold} onChange={(e) => setBat({ voltThreshold: Number(e.target.value) })} /> V
      </div>
      <div className="batt-alerts">
        <label className="opt"><input type="checkbox" checked={battery.osdBlink} onChange={(e) => setBat({ osdBlink: e.target.checked })} /> OSD blink</label>
        <label className="opt"><input type="checkbox" checked={battery.rumble} onChange={(e) => setBat({ rumble: e.target.checked })} /> Rumble</label>
        <label className="opt"><input type="checkbox" checked={battery.sound} onChange={(e) => setBat({ sound: e.target.checked })} /> Sound</label>
      </div>
      <p className="note">Auto only warns when a real sensor delivers data. Voltage is a pack value — set it for your cell count (e.g. 3S ≈ 10.5 V). Alerts repeat every ~3 s while low.</p>
    </section>
  );
}
