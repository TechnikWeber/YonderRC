import { useEffect, useState } from 'react';
import { ACTION_LABELS, type ActionBindings, type ActionId } from '../lib/actions';
import type { BatteryWarnCfg } from '../lib/battery';
import type { InputManager } from '../lib/input/inputManager';
import type { AutoDisarmMode } from '../lib/templates';
import { clampHoldSeconds, HOLD_MAX_S, HOLD_MIN_S, type HoldCfg } from '../lib/hold';
import { clampButtonHoldSeconds, BUTTON_HOLD_MAX_S, BUTTON_HOLD_MIN_S, type ButtonHoldCfg } from '../lib/buttonHold';

const ORDER: ActionId[] = ['panic-disarm', 'toggle-arm', 'throttle-limit', 'next-camera', 'record-toggle', 'snapshot'];

export function ControlsPanel({
  bindings,
  onBindings,
  preArm,
  onPreArm,
  hold,
  onHold,
  buttonHold,
  onButtonHold,
  battery,
  onBattery,
  logging,
  onLogging,
  logRows,
  logFixes,
  onDownloadLog,
  onDownloadGpx,
  onClearLog,
  input,
  autoDisarm,
  autoDisarmMode,
  onAutoDisarmMode,
  typeDefault,
  vehicleType,
}: {
  bindings: ActionBindings;
  onBindings: (b: ActionBindings) => void;
  preArm: boolean;
  onPreArm: (v: boolean) => void;
  hold: HoldCfg;
  onHold: (c: HoldCfg) => void;
  buttonHold: ButtonHoldCfg;
  onButtonHold: (c: ButtonHoldCfg) => void;
  battery: BatteryWarnCfg;
  onBattery: (c: BatteryWarnCfg) => void;
  logging: boolean;
  onLogging: (v: boolean) => void;
  logRows: number;
  /** Rows that carry a GPS fix — 0 disables the GPX export. */
  logFixes: number;
  onDownloadLog: () => void;
  onDownloadGpx: () => void;
  onClearLog: () => void;
  input: InputManager;
  autoDisarm: boolean;
  autoDisarmMode: AutoDisarmMode;
  onAutoDisarmMode: (m: AutoDisarmMode) => void;
  /** What the vehicle-type policy alone would pick — shown next to "Auto". */
  typeDefault: boolean;
  vehicleType: string;
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

      <label className="opt big">
        <input type="checkbox" checked={hold.enabled} onChange={(e) => onHold({ ...hold, enabled: e.target.checked })} />
        Hold to arm — the arm button only acts after being held
      </label>
      <label className="batt-th hold-row">
        <span>Hold time</span>
        <input
          type="number"
          step={0.5}
          min={HOLD_MIN_S}
          max={HOLD_MAX_S}
          value={hold.seconds}
          disabled={!hold.enabled}
          onChange={(e) => onHold({ ...hold, seconds: clampHoldSeconds(Number(e.target.value)) })}
        />
        <span className="unit">s</span>
      </label>
      <p className="note">
        Applies to arming <b>and</b> disarming — the mis-touch that cuts the motors is the second
        one — and to a key or controller button bound to <b>Arm / disarm</b> below, since a bumped
        controller is just as capable of it. Switched off, both toggle on a plain press again.
        {HOLD_MIN_S}–{HOLD_MAX_S} s; panic-disarm stays instant either way.
      </p>

      <label className="opt big">
        <input
          type="checkbox"
          checked={buttonHold.enabled}
          onChange={(e) => onButtonHold({ ...buttonHold, enabled: e.target.checked })}
        />
        Hold the other buttons too — a short press is ignored
      </label>
      <label className="batt-th hold-row">
        <span>Button hold</span>
        <input
          type="number"
          step={0.05}
          min={BUTTON_HOLD_MIN_S}
          max={BUTTON_HOLD_MAX_S}
          value={buttonHold.seconds}
          disabled={!buttonHold.enabled}
          onChange={(e) => onButtonHold({ ...buttonHold, seconds: clampButtonHoldSeconds(Number(e.target.value)) })}
        />
        <span className="unit">s</span>
      </label>
      <p className="note">
        A much shorter filter than the arm hold, for the buttons that change something <b>lasting</b>:
        <b> toggle channels</b>, the <b>speed limiter</b> and the <b>trims</b> — on the screen and on a
        controller alike. Deliberately <b>not</b> applied to <b>momentary channels</b> (a horn has to
        sound the instant you press it), <b>hold-ramp channels</b> (holding is already the gesture),
        or the <b>sticks</b> — steering and throttle are never delayed. Arm keeps its own longer hold,
        panic-disarm stays instant. {BUTTON_HOLD_MIN_S}–{BUTTON_HOLD_MAX_S} s.
      </p>

      <div className={`info-line ${autoDisarm ? 'go' : 'idle'}`}>
        Auto-disarm on reconnect: <b>{autoDisarm ? 'ON' : 'OFF'}</b>
        <span className="info-sub"> — pushed to the vehicle on connect and whenever you change it here.</span>
      </div>
      <div className="radios">
        {([
          ['auto', `Auto (${vehicleType} → ${typeDefault ? 'on' : 'off'})`],
          ['on', 'Always on'],
          ['off', 'Always off'],
        ] as [AutoDisarmMode, string][]).map(([val, label]) => (
          <label key={val} className={`radio${autoDisarmMode === val ? ' on' : ''}`}>
            <input
              type="radio"
              name="autodisarm"
              checked={autoDisarmMode === val}
              onChange={() => onAutoDisarmMode(val)}
            />
            {label}
          </label>
        ))}
      </div>
      <p className="note">
        <b>Auto</b> follows the vehicle type — on for car/boat (stopping is always safe), off for
        plane/drone, so a brief link drop can't cut an aircraft's motors in flight. Override it only
        when the type doesn't describe your setup.
      </p>
      {autoDisarmMode === 'on' && !typeDefault && (
        <p className="note warn-note">
          ⚠ Forced ON for a <b>{vehicleType}</b>: every reconnect will disarm — in the air that means
          motors off.
        </p>
      )}
      {autoDisarmMode === 'off' && typeDefault && (
        <p className="note warn-note">
          ⚠ Forced OFF for a <b>{vehicleType}</b>: after a link drop the vehicle stays armed and will
          keep driving as soon as control frames resume.
        </p>
      )}

      <div className="eyebrow" style={{ marginTop: 14 }}>Action bindings</div>
      <p className="note">Assign any action to a keyboard key and/or a controller button. Panic disarms immediately over the reliable link — <b>no hold, no confirmation</b>, which is why it ships <b>unbound</b>: a stray key cuts the motors, and on an aircraft that is a crash. Bind it to something you can't hit by accident, and if you fly with a controller, bind it there — a keyboard key is no use with both hands on the sticks.</p>
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
      <div className="batt-thresholds">
        <label className="batt-th">
          <input type="checkbox" checked={battery.usePct} onChange={(e) => setBat({ usePct: e.target.checked })} />
          <span>Percent ≤</span>
          <input type="number" value={battery.pctThreshold} onChange={(e) => setBat({ pctThreshold: Number(e.target.value) })} />
          <span className="unit">%</span>
        </label>
        <label className="batt-th">
          <input type="checkbox" checked={battery.useVolt} onChange={(e) => setBat({ useVolt: e.target.checked })} />
          <span>Voltage ≤</span>
          <input type="number" step={0.1} value={battery.voltThreshold} onChange={(e) => setBat({ voltThreshold: Number(e.target.value) })} />
          <span className="unit">V</span>
        </label>
        <label className="batt-th">
          <input type="checkbox" checked={battery.useMah} onChange={(e) => setBat({ useMah: e.target.checked })} />
          <span>Consumed ≥</span>
          <input type="number" step={50} value={battery.mahThreshold} onChange={(e) => setBat({ mahThreshold: Number(e.target.value) })} />
          <span className="unit">mAh</span>
        </label>
      </div>
      <div className="batt-alerts">
        <label className="opt"><input type="checkbox" checked={battery.osdBlink} onChange={(e) => setBat({ osdBlink: e.target.checked })} /> OSD blink</label>
        <label className="opt"><input type="checkbox" checked={battery.rumble} onChange={(e) => setBat({ rumble: e.target.checked })} /> Rumble</label>
        <label className="opt"><input type="checkbox" checked={battery.sound} onChange={(e) => setBat({ sound: e.target.checked })} /> Sound</label>
      </div>
      <p className="note">Auto only warns when a real sensor delivers data. Percent needs a battery capacity set on the vehicle (Setup › Telemetry). Voltage is a pack value — set it for your cell count (e.g. 3S ≈ 10.5 V). "Consumed" warns after using that many mAh — handy without a capacity set. Alerts repeat every ~3 s while low.</p>

      <div className="eyebrow" style={{ marginTop: 14 }}>Blackbox logging</div>
      <label className="opt big">
        <input type="checkbox" checked={logging} onChange={(e) => onLogging(e.target.checked)} />
        Record telemetry, link stats and GPS track to a downloadable log
      </label>
      <div className="log-row">
        <span className="log-status">
          {logging ? `● recording · ${logRows} rows${logFixes ? ` · ${logFixes} fixes` : ''}` : 'off'}
        </span>
        <button className="btn tiny" onClick={onDownloadLog} disabled={logRows === 0}>Download CSV</button>
        <button className="btn tiny" onClick={onDownloadGpx} disabled={logFixes === 0} title={logFixes === 0 ? 'No GPS fix recorded yet' : `${logFixes} track points`}>Download GPX</button>
        <button className="btn tiny" onClick={onClearLog} disabled={logRows === 0}>Clear</button>
      </div>
      <p className="note">Off by default — it only samples (2×/s) while enabled, so it adds no overhead otherwise. Logs stay in this browser tab until you download or clear them. The CSV holds link/video stats, <b>position</b> (<span className="mono">lat</span>, <span className="mono">lon</span>, <span className="mono">alt_m</span>, <span className="mono">sats</span>, <span className="mono">speed_ms</span>) plus <b>every telemetry channel</b> the vehicle reports, one column per channel (<span className="mono">Pack_V</span>, <span className="mono">I1_A</span>, <span className="mono">Motor_C</span>); <span className="mono">volt</span>/<span className="mono">amp</span> stay as the primary channel. Because position and telemetry share a row, you can colour the track by voltage or RTT in QGIS or kepler.gl. <b>GPX</b> is the plain track for Google Earth, gpx.studio or any mapping tool — it needs a GPS fix (Setup › GPS).</p>
    </section>
  );
}
