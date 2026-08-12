import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTROL_PERIOD_MS,
  neutralChannels,
  type Profile,
  type StatusMessage,
  type TelemetryMessage,
  type WelcomeMessage,
} from '@yonderrc/protocol';
import { LinkClient, type ControlPath, type LinkState } from './lib/transport';
import { InputManager } from './lib/input/inputManager';
import { BindingEngine } from './lib/input/bindingEngine';
import {
  cloneProfile,
  getActiveId,
  loadProfiles,
  profileDisarmedUs,
  profileFailsafeUs,
  saveProfiles,
  setActiveId,
} from './lib/profiles';
import { ConnectionBar, StatusStrip } from './components/StatusStrip';
import { ControlPad } from './components/ControlPad';
import { ChannelMonitor } from './components/ChannelMonitor';
import { BindingEditor } from './components/BindingEditor';
import { CalibrationPanel } from './components/CalibrationPanel';
import { ControlsPanel } from './components/ControlsPanel';
import { loadActions, saveActions, useActionHotkeys, type ActionBindings } from './lib/actions';
import { preArmCheck } from './lib/safety';
import { loadBattery, saveBattery, evaluateBattery, packVoltage, type BatteryWarnCfg } from './lib/battery';
import { beep } from './lib/beep';
import { logToCsv, downloadText, LOG_CAP, type LogRow } from './lib/logger';
import { VideoPanel, type VideoStats } from './components/VideoPanel';
import { buildProfile, vehicleTypes } from './lib/templates';

const DEFAULT_URL = `ws://${location.hostname || 'localhost'}:8080`;

/**
 * If the vehicle reports its video URL as localhost but we connected to it
 * remotely (e.g. a phone → the Pi's AP), rewrite the video host to the host we're
 * actually talking to, so video works without the vehicle knowing its own address.
 */
function effectiveVideoBase(reported: string | null | undefined, wsUrl: string): string | null {
  if (!reported) return null;
  try {
    const v = new URL(reported);
    if (v.hostname === 'localhost' || v.hostname === '127.0.0.1') {
      const host = new URL(wsUrl.replace(/^ws/, 'http')).hostname;
      if (host) v.hostname = host;
    }
    return v.toString().replace(/\/$/, '');
  } catch {
    return reported;
  }
}

export function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [linkState, setLinkState] = useState<LinkState>('disconnected');
  const [welcome, setWelcome] = useState<WelcomeMessage | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryMessage | null>(null);
  const [gamepad, setGamepad] = useState<string | null>(null);
  const [previewChannels, setPreviewChannels] = useState<number[]>(neutralChannels());
  const [tick, setTick] = useState(0);
  const [setupMode, setSetupMode] = useState(false);
  const [controlPath, setControlPath] = useState<ControlPath>('ws');
  const [preferWebRtc, setPreferWebRtc] = useState(false);

  const [profiles, setProfiles] = useState<Profile[]>(() => loadProfiles());
  const [activeId, setActive] = useState<string>(() => getActiveId(loadProfiles()));

  const input = useMemo(() => new InputManager(), []);
  const engine = useMemo(() => new BindingEngine(), []);
  const linkRef = useRef<LinkClient | null>(null);

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const activeRef = useRef(active);
  activeRef.current = active;
  const liveChannelsRef = useRef<number[]>(neutralChannels());

  // Safety + action bindings.
  const [preArm, setPreArm] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('yonderrc.preArm.v1') !== 'off' : true));
  const [actions, setActionsState] = useState(loadActions);
  const [preArmMsg, setPreArmMsg] = useState<string | null>(null);
  const [batteryCfg, setBatteryCfgState] = useState(loadBattery);
  const setBatteryCfg = (c: BatteryWarnCfg) => {
    setBatteryCfgState(c);
    saveBattery(c);
  };
  const setActions = (b: ActionBindings) => {
    setActionsState(b);
    saveActions(b);
  };
  const setPreArmPersist = (v: boolean) => {
    setPreArm(v);
    try {
      localStorage.setItem('yonderrc.preArm.v1', v ? 'on' : 'off');
    } catch {
      /* ignore */
    }
  };

  if (linkRef.current === null) {
    linkRef.current = new LinkClient({
      onState: setLinkState,
      onWelcome: (w) => {
        setWelcome(w);
        pushConfig(activeRef.current); // vehicle needs failsafe as soon as we connect
      },
      onStatus: setStatus,
      onTelemetry: setTelemetry,
      onControlPath: setControlPath,
    });
  }

  function pushConfig(p: Profile) {
    linkRef.current?.sendConfig(profileFailsafeUs(p), p.throttleChannels, profileDisarmedUs(p));
  }

  // Control loop.
  useEffect(() => {
    input.attach();
    let last = performance.now();
    let n = 0;
    const id = setInterval(() => {
      const now = performance.now();
      const dt = now - last;
      last = now;

      const name = input.pollGamepadName();
      setGamepad((prev) => (prev === name ? prev : name));

      const channels = engine.compute(activeRef.current, input.snapshot(), dt);
      liveChannelsRef.current = channels;
      linkRef.current?.sendControl(channels);

      if (++n % 3 === 0) {
        setPreviewChannels(channels);
        setTick((t) => (t + 1) % 1_000_000);
      }
    }, CONTROL_PERIOD_MS);
    return () => {
      clearInterval(id);
      input.detach();
    };
  }, [input, engine]);

  const connected = linkState === 'connected';

  // Toggle the control transport between WS and the WebRTC data channel.
  useEffect(() => {
    linkRef.current?.setPreferWebRtc(preferWebRtc);
  }, [preferWebRtc, connected]);

  // Re-push config whenever the active profile (or its contents) change while connected.
  useEffect(() => {
    if (connected) pushConfig(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, active]);

  const armed = status?.armed ?? false;
  const failsafe = connected ? status?.failsafeActive ?? false : false;

  // Arming goes through the pre-arm check (unless disabled); disarming is always
  // allowed. Panic disarms immediately, bypassing any check.
  const requestArm = (want: boolean) => {
    if (want && preArm) {
      const r = preArmCheck(activeRef.current, liveChannelsRef.current);
      if (!r.ok) {
        setPreArmMsg(r.message ?? 'Pre-arm check failed.');
        input.rumble(0.5, 0.5, 150);
        window.setTimeout(() => setPreArmMsg(null), 3500);
        return;
      }
    }
    linkRef.current?.sendArm(want);
  };
  const panicDisarm = () => {
    linkRef.current?.sendArm(false);
    setPreArmMsg('PANIC — disarm sent');
    window.setTimeout(() => setPreArmMsg((m) => (m === 'PANIC — disarm sent' ? null : m)), 2500);
  };
  useActionHotkeys(actions, { 'panic-disarm': panicDisarm, 'toggle-arm': () => requestArm(!armed) }, input);

  // Flight timer + session: runs while armed; captures mAh consumed since arming.
  const [flightSeconds, setFlightSeconds] = useState(0);
  const armedSince = useRef<number | null>(null);
  const mahAtArm = useRef<number | null>(null);
  const [sessionMah, setSessionMah] = useState<number | null>(null);
  useEffect(() => {
    if (armed && armedSince.current === null) {
      armedSince.current = Date.now();
      mahAtArm.current = telemetry?.mah ?? null;
    } else if (!armed) {
      armedSince.current = null;
    }
  }, [armed, telemetry]);
  useEffect(() => {
    const id = setInterval(() => {
      if (armedSince.current) {
        setFlightSeconds(Math.floor((Date.now() - armedSince.current) / 1000));
        const cur = telemetryRef.current?.mah;
        setSessionMah(cur != null && mahAtArm.current != null ? Math.max(0, Math.round(cur - mahAtArm.current)) : null);
      } else {
        setFlightSeconds(0);
        setSessionMah(null);
      }
    }, 500);
    return () => clearInterval(id);
  }, []);
  const telemetryRef = useRef(telemetry);
  telemetryRef.current = telemetry;

  // Blackbox logging — OFF by default; only samples while explicitly enabled, so
  // it costs nothing otherwise. Snapshot ref keeps the current values for the loop.
  const [logging, setLogging] = useState(false);
  const [logRows, setLogRows] = useState(0);
  const logRef = useRef<LogRow[]>([]);
  const logStartRef = useRef(0);
  const videoStatsRef = useRef<VideoStats | null>(null);
  const snapRef = useRef<{ armed: boolean; failsafe: boolean; link: LinkState; rtt: number | null }>({ armed: false, failsafe: false, link: 'disconnected', rtt: null });
  useEffect(() => {
    if (!logging) return;
    logStartRef.current = Date.now();
    logRef.current = [];
    setLogRows(0);
    const id = setInterval(() => {
      const t = telemetryRef.current;
      const vs = videoStatsRef.current;
      const s = snapRef.current;
      logRef.current.push({
        t: Date.now() - logStartRef.current,
        armed: s.armed ? 1 : 0,
        failsafe: s.failsafe ? 1 : 0,
        link: s.link,
        rtt: s.rtt,
        bitrate: vs?.bitrateKbps ?? null,
        loss: vs?.lossPct ?? null,
        fps: vs?.fps ?? null,
        vlat: vs?.latencyMs ?? null,
        volt: packVoltage(t),
        amp: t?.currents?.[0]?.value ?? null,
        mah: t?.mah ?? null,
        pct: t?.batteryPercent ?? null,
      });
      if (logRef.current.length > LOG_CAP) logRef.current.shift();
      setLogRows(logRef.current.length);
    }, 500);
    return () => clearInterval(id);
  }, [logging]);
  const downloadLog = () => {
    if (!logRef.current.length) return;
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    downloadText(`yonderrc-log-${stamp}.csv`, logToCsv(logRef.current));
  };
  const clearLog = () => {
    logRef.current = [];
    setLogRows(0);
  };

  // Low-battery warning: evaluate, then pulse rumble + beep while low.
  const battery = evaluateBattery(batteryCfg, connected ? telemetry : null);
  const batteryLowRef = useRef(false);
  batteryLowRef.current = battery.low;
  const batteryCfgRef = useRef(batteryCfg);
  batteryCfgRef.current = batteryCfg;
  useEffect(() => {
    const id = setInterval(() => {
      if (!batteryLowRef.current) return;
      if (batteryCfgRef.current.rumble) input.rumble(0.7, 0.9, 300);
      if (batteryCfgRef.current.sound) beep(880, 180);
    }, 3000);
    return () => clearInterval(id);
  }, [input]);

  // Haptic alert when the vehicle drops into failsafe (link loss).
  const prevFailsafe = useRef(false);
  useEffect(() => {
    if (failsafe && !prevFailsafe.current) input.rumble();
    prevFailsafe.current = failsafe;
  }, [failsafe, input]);

  const monitorChannels = connected && status ? status.channels : previewChannels;

  // Round-trip time: raw samples jitter with the status phase (~0–70 ms). Smooth
  // them with an exponential moving average and refresh the shown number slowly,
  // the way games display a stable ping.
  const rttEma = useRef<number | null>(null);
  const [rttDisplay, setRttDisplay] = useState<number | null>(null);
  snapRef.current = { armed, failsafe, link: linkState, rtt: rttDisplay };
  useEffect(() => {
    const fresh =
      connected && status && !failsafe && status.lastClientT > 0 &&
      status.lastFrameAgeMs >= 0 && status.lastFrameAgeMs < 500;
    if (fresh) {
      const sample = Math.max(0, Date.now() - status!.lastClientT);
      const prev = rttEma.current;
      rttEma.current = prev == null ? sample : prev + 0.1 * (sample - prev);
    } else {
      rttEma.current = null;
    }
  }, [status, connected, failsafe]);
  useEffect(() => {
    const id = setInterval(() => {
      setRttDisplay(rttEma.current == null ? null : Math.round(rttEma.current));
    }, 500);
    return () => clearInterval(id);
  }, []);

  // --- profile management ---
  const updateProfile = (next: Profile) => {
    setProfiles((list) => {
      const updated = list.map((p) => (p.id === next.id ? next : p));
      saveProfiles(updated);
      return updated;
    });
  };
  const selectProfile = (id: string) => {
    setActive(id);
    setActiveId(id);
  };
  const duplicateActive = () => {
    const copy = cloneProfile(active, `${active.name} copy`);
    setProfiles((list) => {
      const updated = [...list, copy];
      saveProfiles(updated);
      return updated;
    });
    selectProfile(copy.id);
  };
  const deleteActive = () => {
    if (profiles.length <= 1) return;
    setProfiles((list) => {
      const updated = list.filter((p) => p.id !== active.id);
      saveProfiles(updated);
      selectProfile(updated[0].id);
      return updated;
    });
  };
  const newFromTemplate = (type: string) => {
    if (!type) return;
    const p = buildProfile(type as ReturnType<typeof vehicleTypes>[number]);
    setProfiles((list) => {
      const updated = [...list, p];
      saveProfiles(updated);
      return updated;
    });
    selectProfile(p.id);
  };

  return (
    <div className="app">
      {preArmMsg && <div className="prearm-toast">{preArmMsg}</div>}
      <header className="masthead">
        <h1>YonderRC</h1>
        <span className="ver">ground · v1.15.0</span>
        <div className="mode-toggle">
          <button className={`seg${!setupMode ? ' on' : ''}`} onClick={() => setSetupMode(false)}>Drive</button>
          <button className={`seg${setupMode ? ' on' : ''}`} onClick={() => setSetupMode(true)}>Setup</button>
        </div>
      </header>

      <ConnectionBar
        url={url}
        setUrl={setUrl}
        linkState={linkState}
        onConnect={() => linkRef.current?.connect(url)}
        onDisconnect={() => linkRef.current?.disconnect()}
      />

      {setupMode ? (
        <>
          <div className="profile-bar">
            <span className="eyebrow">Model</span>
            <select value={active.id} onChange={(e) => selectProfile(e.target.value)} disabled={armed}>
              {profiles.map((p) => (
                <option key={p.id} value={p.id}>{p.name} · {p.vehicleType}</option>
              ))}
            </select>
            <select className="new-model" value="" onChange={(e) => newFromTemplate(e.target.value)} aria-label="New model from template" disabled={armed}>
              <option value="">+ New…</option>
              {vehicleTypes().map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            {armed && <span className="lock-hint">🔒 disarm to change model</span>}
          </div>
          <BindingEditor
            profile={active}
            locked={armed}
            input={input}
            onChange={updateProfile}
            onRename={(name) => updateProfile({ ...active, name })}
            onDelete={deleteActive}
            onDuplicate={duplicateActive}
          />
          <CalibrationPanel
            profile={active}
            calibration={status?.calibration}
            connected={connected}
            onStart={(ch) => linkRef.current?.sendCalib('start', ch, active.endpoints.minUs, active.endpoints.maxUs)}
            onNext={() => linkRef.current?.sendCalib('next')}
            onCancel={() => linkRef.current?.sendCalib('cancel')}
          />
          <ControlsPanel bindings={actions} onBindings={setActions} preArm={preArm} onPreArm={setPreArmPersist} battery={batteryCfg} onBattery={setBatteryCfg} logging={logging} onLogging={setLogging} logRows={logRows} onDownloadLog={downloadLog} onClearLog={clearLog} input={input} />
        </>
      ) : (
        <>
          {status?.calibration?.active && (
            <div className="calib-banner">
              ESC calibration active — {status.calibration.message}
            </div>
          )}
          <VideoPanel
            videoBaseUrl={effectiveVideoBase(welcome?.videoBaseUrl, url)}
            cameras={welcome?.cameras ?? []}
            linkState={linkState}
            controlPath={controlPath}
            armed={armed}
            failsafe={failsafe}
            latencyMs={rttDisplay}
            channels={monitorChannels}
            profile={active}
            telemetry={connected ? telemetry : null}
            input={input}
            actions={actions}
            flightSeconds={armed ? flightSeconds : null}
            batteryLow={battery.low && batteryCfg.osdBlink}
            batteryReason={battery.reason}
            onQuality={(q) => linkRef.current?.sendVideoQuality(q)}
            onStats={(s) => {
              videoStatsRef.current = s;
            }}
          />
          <ControlPad
            profile={active}
            input={input}
            engine={engine}
            armed={armed}
            onToggleArm={() => requestArm(!armed)}
            connected={connected}
            calibrationActive={status?.calibration?.active ?? false}
            version={tick}
          />
          <div className="link-opts">
            <label className="opt">
              <input
                type="checkbox"
                checked={preferWebRtc}
                onChange={(e) => setPreferWebRtc(e.target.checked)}
              />
              Control via WebRTC data channel
            </label>
            <span className={`path-tag ${controlPath}`}>{controlPath.toUpperCase()}</span>
          </div>
          <StatusStrip
            linkState={linkState}
            vehicleName={welcome?.vehicleName ?? ''}
            driver={welcome?.driver ?? ''}
            armed={armed}
            failsafe={failsafe}
            latencyMs={rttDisplay}
            gamepad={gamepad}
            gamepadKind={input.gamepadKind}
            flightSeconds={armed ? flightSeconds : null}
            sessionMah={sessionMah}
            telemetrySource={
              !connected || !telemetry
                ? null
                : telemetry.source === 'sim'
                  ? 'sim'
                  : telemetry.ok
                    ? 'real'
                    : 'nodata'
            }
          />
          <ChannelMonitor channels={monitorChannels} failsafe={failsafe} profile={active} armed={armed} />
        </>
      )}

      <p className="footnote">
        {connected
          ? 'Monitor shows the vehicle’s actual output, including failsafe and disarm. Failsafe values are pushed to and held by the vehicle.'
          : 'Not connected — the monitor previews what would be sent. Start the vehicle service and press Connect.'}
      </p>
    </div>
  );
}
