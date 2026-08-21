import { useEffect, useMemo, useRef, useState } from 'react';
import {
  CONTROL_PERIOD_MS,
  neutralChannels,
  distanceMeters,
  type Profile,
  type StatusMessage,
  type TelemetryMessage,
  type GpsMessage,
  type WelcomeMessage,
  primaryCurrent,
} from '@yonderrc/protocol';
import { LinkClient, setupUrlFromWs, type ControlPath, type LinkState } from './lib/transport';
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
import { logToCsv, logToGpx, downloadText, sensorSnapshot, gpsSnapshot, fixCount, LOG_CAP, type LogRow } from './lib/logger';
import { loadHoldCfg, saveHoldCfg, holdMsFor, type HoldCfg } from './lib/hold';
import { loadButtonHoldCfg, saveButtonHoldCfg, buttonHoldMsFor, type ButtonHoldCfg } from './lib/buttonHold';
import {
  loadSpeechCfg, saveSpeechCfg, announcementsFor, batteryRepeat, linkVoice, speak, primeSpeech,
  LINK_VOICE_INITIAL, type SpeechCfg, type SpeechState, type LinkVoiceState,
} from './lib/speech';
import { linkHealth, linkTrend } from './lib/linkHealth';
import {
  loadReturnBudgetCfg, saveReturnBudgetCfg, returnBudget, consumptionRate, pushSample, odoStep, latchReturnNow,
  type ReturnBudgetCfg, type EnergySample,
} from './lib/returnBudget';
import { applyThrottleLimit, limitOf, withStep, nextStep } from './lib/throttleLimit';
import { nudgeTrim, clearTrim } from './lib/trim';
import { VideoPanel, type VideoStats } from './components/VideoPanel';
import { buildProfile, vehicleTypes, disarmOnReconnectForType, resolveAutoDisarm, throttleChannelsOf, type AutoDisarmMode } from './lib/templates';

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

/** Auto-disarm override, per browser; 'auto' = the vehicle-type policy. */
const AUTO_DISARM_KEY = 'yonderrc.autoDisarm.v1';

export function App() {
  const [url, setUrl] = useState(DEFAULT_URL);
  const [secret, setSecretState] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('yonderrc.secret.v1') ?? '' : ''));
  const setSecret = (v: string) => {
    setSecretState(v);
    try {
      localStorage.setItem('yonderrc.secret.v1', v);
    } catch {
      /* ignore */
    }
  };
  const [linkState, setLinkState] = useState<LinkState>('disconnected');
  const [authMsg, setAuthMsg] = useState<string | null>(null);
  const [welcome, setWelcome] = useState<WelcomeMessage | null>(null);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [telemetry, setTelemetry] = useState<TelemetryMessage | null>(null);
  const [gps, setGps] = useState<GpsMessage | null>(null);
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
  const lastTelemetryAt = useRef(0);

  const active = profiles.find((p) => p.id === activeId) ?? profiles[0];
  const activeRef = useRef(active);
  activeRef.current = active;
  const liveChannelsRef = useRef<number[]>(neutralChannels());

  // Safety + action bindings.
  const [preArm, setPreArm] = useState(() => (typeof localStorage !== 'undefined' ? localStorage.getItem('yonderrc.preArm.v1') !== 'off' : true));
  // Auto-disarm on reconnect: 'auto' follows the vehicle-type policy (default).
  const [autoDisarmMode, setAutoDisarmModeState] = useState<AutoDisarmMode>(() => {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem(AUTO_DISARM_KEY) : null;
    return v === 'on' || v === 'off' ? v : 'auto';
  });
  const [actions, setActionsState] = useState(loadActions);
  const [holdCfg, setHoldCfgState] = useState<HoldCfg>(loadHoldCfg);
  // Short hold for the buttons that change something lasting (toggles, speed
  // limiter, trims). A ref as well, because the control loop reads it every tick.
  const [buttonHoldCfg, setButtonHoldCfgState] = useState<ButtonHoldCfg>(loadButtonHoldCfg);
  const buttonHoldMs = buttonHoldMsFor(buttonHoldCfg);
  const buttonHoldRef = useRef(buttonHoldMs);
  buttonHoldRef.current = buttonHoldMs;
  const setButtonHoldCfg = (c: ButtonHoldCfg) => {
    setButtonHoldCfgState(c);
    saveButtonHoldCfg(c);
  };
  const [preArmMsg, setPreArmMsg] = useState<string | null>(null);
  const [batteryCfg, setBatteryCfgState] = useState(loadBattery);
  const setBatteryCfg = (c: BatteryWarnCfg) => {
    setBatteryCfgState(c);
    saveBattery(c);
  };
  const setHoldCfg = (c: HoldCfg) => {
    setHoldCfgState(c);
    saveHoldCfg(c);
  };
  const setActions = (b: ActionBindings) => {
    setActionsState(b);
    saveActions(b);
  };
  const autoDisarmRef = useRef(autoDisarmMode);
  autoDisarmRef.current = autoDisarmMode;
  const setAutoDisarmMode = (m: AutoDisarmMode) => {
    setAutoDisarmModeState(m);
    try {
      localStorage.setItem(AUTO_DISARM_KEY, m);
    } catch {
      /* ignore */
    }
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
      onTelemetry: (m) => {
        lastTelemetryAt.current = Date.now();
        setTelemetry(m);
      },
      onGps: setGps,
      onControlPath: setControlPath,
      onAuthFail: () => {
        setAuthMsg('Vehicle rejected the secret — check the API secret and Connect again.');
        window.setTimeout(() => setAuthMsg(null), 6000);
      },
    });
  }

  function pushConfig(p: Profile) {
    linkRef.current?.sendConfig(
      profileFailsafeUs(p),
      throttleChannelsOf(p), // derived, not the (possibly stale) stored list
      profileDisarmedUs(p),
      // 'auto' = vehicle-type policy (car/boat on, aircraft off); the operator can force it.
      resolveAutoDisarm(autoDisarmRef.current, p.vehicleType),
    );
  }

  // Ground factory reset: wipe every `yonderrc.*` key (models, bindings, actions,
  // battery, secret, video quality) and reload so the demo models re-seed.
  function resetGroundSettings() {
    if (!window.confirm('Reset all ground app settings (models, bindings, actions, battery, secret)? This cannot be undone.')) return;
    try {
      Object.keys(localStorage)
        .filter((k) => k.startsWith('yonderrc.'))
        .forEach((k) => localStorage.removeItem(k));
    } catch {
      /* ignore */
    }
    window.location.reload();
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

      // RAW command first: the pre-arm check must see what the sticks really
      // ask for, so the speed limiter can never soften that check.
      const channels = engine.compute(activeRef.current, input.snapshot(), dt, buttonHoldRef.current);
      liveChannelsRef.current = channels;
      const sent = applyThrottleLimit(activeRef.current, channels);
      linkRef.current?.sendControl(sent);

      if (++n % 3 === 0) {
        setPreviewChannels(sent);
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

  // If the vehicle stops sending telemetry (e.g. telemetry set to "off" in Setup),
  // clear it so the OSD/status don't keep showing stale or sim values.
  useEffect(() => {
    const id = setInterval(() => {
      if (linkState === 'connected' && lastTelemetryAt.current && Date.now() - lastTelemetryAt.current > 3000) {
        setTelemetry(null);
        lastTelemetryAt.current = 0;
      }
    }, 1000);
    return () => clearInterval(id);
  }, [linkState]);

  // Re-push config whenever the active profile (or its contents) change while
  // connected — and when the auto-disarm override changes, so it takes effect
  // without a reconnect.
  useEffect(() => {
    if (connected) pushConfig(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, active, autoDisarmMode]);

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
  // The bound arm key/button gets the same hold protection as the on-screen
  // button (panic-disarm never does); the progress feeds the button's fill so
  // there's visible feedback wherever you look.
  const [hotkeyHold, setHotkeyHold] = useState(0);
  useActionHotkeys(
    actions,
    {
      'panic-disarm': panicDisarm,
      'toggle-arm': () => requestArm(!armed),
      'throttle-limit': () => updateProfile(withStep(activeRef.current, nextStep(limitOf(activeRef.current).step))),
    },
    input,
    {
      // Arming is a confirmation; the speed limiter only needs the short filter.
      // Panic-disarm is absent on purpose and must stay instant.
      holdMs: { 'toggle-arm': holdMsFor(holdCfg), 'throttle-limit': buttonHoldMs },
      progressFor: 'toggle-arm',
      onProgress: setHotkeyHold,
    },
  );

  // Session timer: runs while armed; also captures mAh consumed since arming.
  const [sessionSeconds, setFlightSeconds] = useState(0);
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
  const gpsRef = useRef(gps);
  gpsRef.current = gps;

  // Blackbox logging — OFF by default; only samples while explicitly enabled, so
  // it costs nothing otherwise. Snapshot ref keeps the current values for the loop.
  const [logging, setLogging] = useState(false);
  const [logRows, setLogRows] = useState(0);
  const [logFixes, setLogFixes] = useState(0);
  const logRef = useRef<LogRow[]>([]);
  const logStartRef = useRef(0);
  const videoStatsRef = useRef<VideoStats | null>(null);
  const snapRef = useRef<{ armed: boolean; failsafe: boolean; link: LinkState; rtt: number | null }>({ armed: false, failsafe: false, link: 'disconnected', rtt: null });
  useEffect(() => {
    if (!logging) return;
    logStartRef.current = Date.now();
    logRef.current = [];
    setLogRows(0);
    setLogFixes(0);
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
        amp: primaryCurrent(t)?.value ?? null,
        mah: t?.mah ?? null,
        pct: t?.batteryPercent ?? null,
        ...gpsSnapshot(gpsRef.current),
        sensors: sensorSnapshot(t),
      });
      if (logRef.current.length > LOG_CAP) logRef.current.shift();
      setLogRows(logRef.current.length);
      setLogFixes(fixCount(logRef.current));
    }, 500);
    return () => clearInterval(id);
  }, [logging]);
  const logStamp = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const downloadLog = () => {
    if (!logRef.current.length) return;
    downloadText(`yonderrc-log-${logStamp()}.csv`, logToCsv(logRef.current));
  };
  const downloadGpx = () => {
    if (!logFixes) return;
    const stamp = logStamp();
    downloadText(
      `yonderrc-track-${stamp}.gpx`,
      logToGpx(logRef.current, logStartRef.current, `YonderRC ${stamp}`),
      'application/gpx+xml',
    );
  };
  const clearLog = () => {
    logRef.current = [];
    setLogRows(0);
    setLogFixes(0);
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

  // Trip odometer. Owned here rather than in the OSD, because the energy budget
  // needs the same distance — a readout and an estimate that disagree about how
  // far the vehicle has gone would be worse than either alone.
  const [odoMeters, setOdoMeters] = useState(0);
  const odoRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!gps) {
      odoRef.current = null;
      setOdoMeters(0);
      return;
    }
    if (!gps.hasFix || gps.lat == null || gps.lon == null) return;
    const step = odoStep(odoRef.current, gps, distanceMeters);
    if (step > 0) setOdoMeters((m) => m + step);
    odoRef.current = { lat: gps.lat, lon: gps.lon };
  }, [gps]);

  // Return-home energy budget. Every input is optional: a vehicle that is just a
  // PCA9685 has no capacity, no charge counter and no GPS, so this stays `unknown`
  // and nothing is drawn or warned about.
  const [budgetCfg, setBudgetCfgState] = useState<ReturnBudgetCfg>(loadReturnBudgetCfg);
  const setBudgetCfg = (c: ReturnBudgetCfg) => {
    setBudgetCfgState(c);
    saveReturnBudgetCfg(c);
  };
  const connectedRef = useRef(false);
  connectedRef.current = connected;
  const samplesRef = useRef<EnergySample[]>([]);
  const [rate, setRate] = useState<number | null>(null);
  const odoRefForSamples = useRef(odoMeters);
  odoRefForSamples.current = odoMeters;
  useEffect(() => {
    if (!budgetCfg.enabled) {
      samplesRef.current = [];
      setRate(null);
      return;
    }
    const id = setInterval(() => {
      const mah = telemetryRef.current?.mah;
      if (mah == null || !connectedRef.current) {
        samplesRef.current = [];
        setRate(null);
        return;
      }
      samplesRef.current = pushSample(samplesRef.current, { mah, odoM: odoRefForSamples.current });
      setRate(consumptionRate(samplesRef.current));
    }, 1000);
    return () => clearInterval(id);
  }, [budgetCfg.enabled]);
  const homeDistanceM =
    gps?.hasFix && gps.home && gps.lat != null && gps.lon != null
      ? distanceMeters(gps.home.lat, gps.home.lon, gps.lat, gps.lon)
      : null;
  const budget = returnBudget(
    {
      mah: connected ? telemetry?.mah ?? null : null,
      capacityMah: connected ? telemetry?.capacityMah ?? null : null,
      homeDistanceM: connected ? homeDistanceM : null,
      mahPerMeter: rate,
    },
    budgetCfg,
  );
  // The alarm is latched; the block below it still shows the live status.
  const warnReturnRef = useRef(false);
  warnReturnRef.current = latchReturnNow(warnReturnRef.current, budget.status);
  const warnReturn = warnReturnRef.current;

  // Link quality as one number, plus a short history for the trend arrow.
  const health = linkHealth({
    rttMs: connected ? rttDisplay : null,
    lossPct: connected ? videoStatsRef.current?.lossPct ?? null : null,
    signalPct: connected ? status?.link?.quality ?? null : null,
  });
  const healthRef = useRef(health);
  healthRef.current = health;
  const [healthTrend, setHealthTrend] = useState<'up' | 'flat' | 'down'>('flat');
  const healthHistory = useRef<number[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const s = healthRef.current.score;
      if (s === null) {
        healthHistory.current = [];
        setHealthTrend('flat');
        return;
      }
      healthHistory.current = [...healthHistory.current, s].slice(-12); // ~12 s
      setHealthTrend(linkTrend(healthHistory.current));
    }, 1000);
    return () => clearInterval(id);
  }, []);

  // Spoken callouts. The pure part decides what is worth saying; this only hands
  // it to the browser's voice.
  const [speechCfg, setSpeechCfgState] = useState<SpeechCfg>(loadSpeechCfg);
  const setSpeechCfg = (c: SpeechCfg) => {
    setSpeechCfgState(c);
    saveSpeechCfg(c);
  };
  const speechCfgRef = useRef(speechCfg);
  speechCfgRef.current = speechCfg;
  const prevSpeech = useRef<SpeechState | null>(null);
  const batterySpokenAt = useRef<number | null>(null);
  const speechState: SpeechState = {
    connected,
    armed,
    failsafe,
    batteryLow: battery.low,
    batteryPercent: telemetry?.batteryPercent ?? null,
    // `score !== null` matters: with no measurement yet the level is 'bad', and
    // announcing that at every connect would be pure noise.
    returnNow: warnReturn,
  };
  const speechStateRef = useRef(speechState);
  speechStateRef.current = speechState;
  const qualityBadRef = useRef(false);
  qualityBadRef.current = health.score !== null && health.level === 'bad';
  useEffect(() => {
    for (const a of announcementsFor(prevSpeech.current, speechStateRef.current)) speak(a, speechCfgRef.current);
    prevSpeech.current = speechStateRef.current;
    // Depends on the fields, not the object — that one is rebuilt every render.
  }, [armed, failsafe, battery.low, warnReturn]);
  // The time-driven callouts: the link needs a clock (a blip must not be announced
  // as an outage) and a battery that stays low says so again now and then.
  const linkVoiceRef = useRef<LinkVoiceState>(LINK_VOICE_INITIAL);
  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      const link = linkVoice(
        linkVoiceRef.current,
        // Quality is only a claim while the link exists; linkVoice freezes it otherwise.
        { connected: speechStateRef.current.connected, qualityBad: qualityBadRef.current },
        now,
      );
      linkVoiceRef.current = link.next;
      if (link.say) speak(link.say, speechCfgRef.current);

      const rep = batteryRepeat(speechStateRef.current, batterySpokenAt.current, now);
      if (!rep) {
        if (!speechStateRef.current.batteryLow) batterySpokenAt.current = null;
        return;
      }
      batterySpokenAt.current = now;
      speak(rep, speechCfgRef.current);
    }, 500);
    return () => clearInterval(id);
  }, []);
  // iOS stays silent until speech has been started from a real gesture once.
  useEffect(() => {
    const onFirst = () => primeSpeech();
    window.addEventListener('pointerdown', onFirst, { once: true });
    return () => window.removeEventListener('pointerdown', onFirst);
  }, []);

  return (
    <div className="app">
      {preArmMsg && <div className="prearm-toast">{preArmMsg}</div>}
      {authMsg && <div className="prearm-toast">{authMsg}</div>}
      <header className="masthead">
        <h1>YonderRC</h1>
        <span className="ver">ground · v1.43.2</span>
        <div className="mode-toggle">
          <button className={`seg${!setupMode ? ' on' : ''}`} onClick={() => setSetupMode(false)}>Drive</button>
          <button className={`seg${setupMode ? ' on' : ''}`} onClick={() => setSetupMode(true)}>Setup</button>
        </div>
      </header>

      <ConnectionBar
        url={url}
        setUrl={setUrl}
        secret={secret}
        setSecret={setSecret}
        setupUrl={setupUrlFromWs(url)}
        linkState={linkState}
        onConnect={() => linkRef.current?.connect(url, secret)}
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
            onStart={(ch, minUs, maxUs) => linkRef.current?.sendCalib('start', ch, minUs, maxUs)}
            onNext={() => linkRef.current?.sendCalib('next')}
            onCancel={() => linkRef.current?.sendCalib('cancel')}
          />
          <ControlsPanel bindings={actions} onBindings={setActions} preArm={preArm} onPreArm={setPreArmPersist} hold={holdCfg} onHold={setHoldCfg} buttonHold={buttonHoldCfg} onButtonHold={setButtonHoldCfg} speech={speechCfg} onSpeech={setSpeechCfg} budget={budgetCfg} onBudget={setBudgetCfg} budgetLive={budget} battery={batteryCfg} onBattery={setBatteryCfg} logging={logging} onLogging={setLogging} logRows={logRows} logFixes={logFixes} onDownloadLog={downloadLog} onDownloadGpx={downloadGpx} onClearLog={clearLog} input={input} autoDisarm={resolveAutoDisarm(autoDisarmMode, active.vehicleType)} autoDisarmMode={autoDisarmMode} onAutoDisarmMode={setAutoDisarmMode} typeDefault={disarmOnReconnectForType(active.vehicleType)} vehicleType={active.vehicleType} />
          <section className="panel">
            <span className="eyebrow">Ground app</span>
            <p className="note">Ground settings (models, bindings, actions, battery, secret, video quality) live in this browser only. Reset restores the demo models and defaults.</p>
            <button className="btn bad" onClick={resetGroundSettings}>Reset app settings (factory)</button>
          </section>
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
            sessionSeconds={armed ? sessionSeconds : null}
            batteryLow={battery.low && batteryCfg.osdBlink}
            batteryReason={battery.reason}
            linkSignal={connected ? status?.link ?? null : null}
            gps={connected ? gps : null}
            odoMeters={odoMeters}
            budget={budget}
            warnReturn={warnReturn}
            health={health}
            healthTrend={healthTrend}
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
            holdMs={holdMsFor(holdCfg)}
            externalProgress={hotkeyHold}
            limit={limitOf(active)}
            onLimitStep={(step) => updateProfile(withStep(active, step))}
            buttonHoldMs={buttonHoldMs}
            onTrim={(id, delta) => updateProfile(nudgeTrim(active, id, delta))}
            onTrimClear={(id) => updateProfile(clearTrim(active, id))}
            version={tick}
          />
          <div className="link-opts">
            <label
              className="opt"
              title="Send control frames over a WebRTC data channel instead of the WebSocket: lower latency and better through NAT/CGNAT (e.g. over LTE). Falls back to WS automatically if it can't connect. Arm/disarm and settings always use the reliable WS."
            >
              <input
                type="checkbox"
                checked={preferWebRtc}
                onChange={(e) => setPreferWebRtc(e.target.checked)}
              />
              Control via WebRTC data channel
            </label>
            <span className={`path-tag ${controlPath}`}>{controlPath.toUpperCase()}</span>
            <span className="opt-hint">Lower-latency control path (NAT/LTE-friendly); auto-falls back to WS.</span>
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
            sessionSeconds={armed ? sessionSeconds : null}
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
