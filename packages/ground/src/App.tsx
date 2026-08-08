import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTROL_PERIOD_MS,
  neutralChannels,
  type Profile,
  type StatusMessage,
  type WelcomeMessage,
} from '@yonderrc/protocol';
import { LinkClient, type ControlPath, type LinkState } from './lib/transport';
import { InputManager } from './lib/input/inputManager';
import { BindingEngine } from './lib/input/bindingEngine';
import {
  cloneProfile,
  getActiveId,
  loadProfiles,
  profileFailsafeUs,
  saveProfiles,
  setActiveId,
} from './lib/profiles';
import { ConnectionBar, StatusStrip } from './components/StatusStrip';
import { ControlPad } from './components/ControlPad';
import { ChannelMonitor } from './components/ChannelMonitor';
import { BindingEditor } from './components/BindingEditor';
import { VideoPanel } from './components/VideoPanel';
import { CalibrationPanel } from './components/CalibrationPanel';
import { buildProfile, vehicleTypes } from './lib/templates';

const DEFAULT_URL = `ws://${location.hostname || 'localhost'}:8080`;

export function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [linkState, setLinkState] = useState<LinkState>('disconnected');
  const [welcome, setWelcome] = useState<WelcomeMessage | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
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

  if (linkRef.current === null) {
    linkRef.current = new LinkClient({
      onState: setLinkState,
      onWelcome: (w) => {
        setWelcome(w);
        pushConfig(activeRef.current); // vehicle needs failsafe as soon as we connect
      },
      onStatus: setStatus,
      onControlPath: setControlPath,
    });
  }

  function pushConfig(p: Profile) {
    linkRef.current?.sendConfig(profileFailsafeUs(p), p.throttleChannels);
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

  // Haptic alert when the vehicle drops into failsafe (link loss).
  const prevFailsafe = useRef(false);
  useEffect(() => {
    if (failsafe && !prevFailsafe.current) input.rumble();
    prevFailsafe.current = failsafe;
  }, [failsafe, input]);

  const monitorChannels = connected && status ? status.channels : previewChannels;
  const latencyMs =
    connected && status && status.lastClientT > 0 && status.lastFrameAgeMs >= 0
      ? Math.max(0, Date.now() - status.lastClientT)
      : null;

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
      <header className="masthead">
        <h1>YonderRC</h1>
        <span className="ver">ground · v1.1.1</span>
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

      <div className="profile-bar">
        <span className="eyebrow">Model</span>
        <select value={active.id} onChange={(e) => selectProfile(e.target.value)}>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>{p.name} · {p.vehicleType}</option>
          ))}
        </select>
        <select className="new-model" value="" onChange={(e) => newFromTemplate(e.target.value)} aria-label="New model from template">
          <option value="">+ New…</option>
          {vehicleTypes().map((t) => (
            <option key={t} value={t}>{t}</option>
          ))}
        </select>
      </div>

      <StatusStrip
        linkState={linkState}
        vehicleName={welcome?.vehicleName ?? ''}
        driver={welcome?.driver ?? ''}
        armed={armed}
        failsafe={failsafe}
        latencyMs={latencyMs}
        gamepad={gamepad}
        gamepadKind={input.gamepadKind}
      />

      {setupMode ? (
        <>
          <BindingEditor
            profile={active}
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
        </>
      ) : (
        <>
          {status?.calibration?.active && (
            <div className="calib-banner">
              ESC calibration active — {status.calibration.message}
            </div>
          )}
          <VideoPanel
            videoBaseUrl={welcome?.videoBaseUrl ?? null}
            cameras={welcome?.cameras ?? []}
            linkState={linkState}
            controlPath={controlPath}
            armed={armed}
            failsafe={failsafe}
            latencyMs={latencyMs}
            channels={monitorChannels}
            profile={active}
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
          <div className="columns">
            <ControlPad
              profile={active}
              input={input}
              engine={engine}
              armed={armed}
              onToggleArm={() => linkRef.current?.sendArm(!armed)}
              connected={connected}
              calibrationActive={status?.calibration?.active ?? false}
              version={tick}
            />
            <ChannelMonitor channels={monitorChannels} failsafe={failsafe} profile={active} />
          </div>
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
