import { useEffect, useState } from 'react';
import { ACTION_LABELS, type ActionBindings, type ActionId } from '../lib/actions';
import type { BatteryWarnCfg } from '../lib/battery';
import type { InputManager } from '../lib/input/inputManager';
import type { AutoDisarmMode } from '../lib/templates';
import { clampHoldSeconds, HOLD_MAX_S, HOLD_MIN_S, type HoldCfg } from '../lib/hold';
import { clampButtonHoldSeconds, BUTTON_HOLD_MAX_S, BUTTON_HOLD_MIN_S, type ButtonHoldCfg } from '../lib/buttonHold';
import { speechAvailable, speak, type SpeechCfg } from '../lib/speech';
import {
  clampReservePct, RESERVE_MAX_PCT, RESERVE_MIN_PCT,
  type ReturnBudgetCfg, type ReturnBudgetResult,
} from '../lib/returnBudget';

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
  speech,
  onSpeech,
  budget,
  onBudget,
  budgetLive,
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
  speech: SpeechCfg;
  onSpeech: (c: SpeechCfg) => void;
  budget: ReturnBudgetCfg;
  onBudget: (c: ReturnBudgetCfg) => void;
  /** Live result, so the panel can explain why the OSD is showing nothing. */
  budgetLive: ReturnBudgetResult;
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

      <div className="eyebrow" style={{ marginTop: 14 }}>Return-home budget</div>
      <label className="opt big">
        <input
          type="checkbox"
          checked={budget.enabled}
          onChange={(e) => onBudget({ ...budget, enabled: e.target.checked })}
        />
        Work out how much further you can go and still get home
      </label>
      <label className="batt-th hold-row">
        <span>Reserve</span>
        <input
          type="number"
          step={10}
          min={RESERVE_MIN_PCT}
          max={RESERVE_MAX_PCT}
          value={budget.reservePct}
          disabled={!budget.enabled}
          onChange={(e) => onBudget({ ...budget, reservePct: clampReservePct(Number(e.target.value)) })}
        />
        <span className="unit">%</span>
      </label>
      {/* The OSD stays silent when an input is missing — that has to be the
          behaviour, since most vehicles have no current sensor and no GPS. So the
          reason belongs here, where someone who switched it on comes looking. */}
      {budget.enabled && budgetLive.missing && (
        <div className="info-line idle">
          Nothing to show yet: <b>{budgetLive.missing}</b>.
        </div>
      )}
      {budget.enabled && !budgetLive.missing && budgetLive.mahPerKm != null && (
        <div className="info-line go">
          Measuring <b>{Math.round(budgetLive.mahPerKm)} mAh/km</b>
          <span className="info-sub"> — {budgetLive.status === 'now' ? 'turn back now' : `${Math.round(budgetLive.furtherM ?? 0)} m of outbound range left`}.</span>
        </div>
      )}
      <p className="note">
        A percentage doesn't answer "can I still get home?" — 30% is plenty at 50 m and
        not enough at 800 m. This measures what the vehicle actually consumes per km and
        turns it into the number that <i>is</i> a decision: how much further you may go.
        The <b>reserve</b> is a margin on the <b>trip home</b>, not a percentage of the
        pack: at <b>50%</b> you turn around while the pack still holds <b>1.5×</b> what
        getting home costs, so you arrive with half that cost to spare. It therefore
        scales with how far out you are — small at 100 m, large at 2 km, which is where a
        misjudged consumption rate gets expensive. It covers <b>estimation error</b>
        (headwind on the way back, a detour, a hill, a pack that sags at the end); it is
        not a deep-discharge limit — that's the low-battery warning below.
        Shown in the <b>full OSD</b> only, but the <b>turn-back warning</b> appears in the
        compact OSD too and is spoken if callouts are on. <b>Needs a battery capacity set
        on the vehicle, a current sensor and a GPS home point</b> — without any of them it
        simply shows nothing, which is the normal case for a vehicle that is just a
        servo driver.
      </p>

      <div className="eyebrow" style={{ marginTop: 14 }}>Voice callouts</div>
      <label className="opt big">
        <input
          type="checkbox"
          checked={speech.enabled}
          disabled={!speechAvailable()}
          onChange={(e) => onSpeech({ ...speech, enabled: e.target.checked })}
        />
        Speak state changes out loud
      </label>
      <div className="log-row">
        <label className="batt-th">
          <span>Rate</span>
          <input
            type="number"
            step={0.1}
            min={0.5}
            max={2}
            value={speech.rate}
            disabled={!speech.enabled || !speechAvailable()}
            onChange={(e) => onSpeech({ ...speech, rate: Number(e.target.value) })}
          />
          <span className="unit">×</span>
        </label>
        <button
          className="btn tiny"
          disabled={!speech.enabled || !speechAvailable()}
          onClick={() => speak({ text: 'Battery low, 25 percent', urgent: false }, speech)}
        >
          Test
        </button>
      </div>
      <p className="note">
        {speechAvailable()
          ? <>On FPV you watch the picture, not the OSD — a beep says <i>that</i> something happened,
            a voice says <i>what</i>. Spoken: <b>link lost / restored</b>, <b>failsafe</b>,
            <b> armed / disarmed</b> and <b>low battery</b> (repeated every 30 s while it stays low).
            Deliberately nothing else: a chatty voice gets muted, and then the ones that matter are
            gone too. Uses the browser's built-in voice — no network. On iOS it stays silent until
            you have tapped the page once.</>
          : <>This browser has no speech engine, so callouts are unavailable here.</>}
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
