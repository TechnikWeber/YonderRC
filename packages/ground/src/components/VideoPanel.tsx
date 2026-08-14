import { useEffect, useRef, useState } from 'react';
import {
  CHANNEL_MIN_US,
  CHANNEL_MAX_US,
  CHANNEL_NEUTRAL_US,
  type Profile,
  type TelemetryMessage,
  type LinkSignal,
  type GpsMessage,
  distanceMeters,
  bearingDeg,
} from '@yonderrc/protocol';
import type { ControlPath, LinkState } from '../lib/transport';
import type { InputManager } from '../lib/input/inputManager';
import { useRecorder } from '../lib/recorder';
import { useActionHotkeys, type ActionBindings } from '../lib/actions';
import { autoQualityStep, AUTO_DEFAULTS, type AutoQualityCfg, type AutoState } from '../lib/autoQuality';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

const QUALITY_KEY = 'yonderrc.videoQuality.v1';
type QualitySel = 'auto' | VideoQuality;
function loadQuality(): QualitySel {
  const v = (typeof localStorage !== 'undefined' && localStorage.getItem(QUALITY_KEY)) as QualitySel | null;
  return v === 'auto' || v === 'high' || v === 'medium' || v === 'low' ? v : 'high';
}

/**
 * Auto-quality thresholds (ground-side). Defaults live in lib/autoQuality; they
 * protect fluidity: step DOWN quickly when the link is bad, step UP slowly when
 * it's clearly good, with a hysteresis gap between the up/down thresholds.
 */
const AUTO_KEY = 'yonderrc.autoQuality.v1';
function loadAutoCfg(): AutoQualityCfg {
  try {
    const raw = localStorage.getItem(AUTO_KEY);
    if (raw) return { ...AUTO_DEFAULTS, ...(JSON.parse(raw) as Partial<AutoQualityCfg>) };
  } catch {
    /* ignore */
  }
  return { ...AUTO_DEFAULTS };
}


/** Which OSD blocks are shown — toggled in the gear (⚙) settings, persisted. */
export interface OsdFields {
  timer: boolean;
  gps: boolean;
  homeArrow: boolean;
  channels: boolean;
  link: boolean;
  batteryBar: boolean;
  batteryData: boolean;
}
const OSD_FIELDS_KEY = 'yonderrc.osdFields.v1';
const OSD_FIELDS_DEFAULT: OsdFields = {
  timer: true, gps: true, homeArrow: true, channels: true, link: true, batteryBar: true, batteryData: true,
};
function loadOsdFields(): OsdFields {
  try {
    const raw = localStorage.getItem(OSD_FIELDS_KEY);
    if (raw) return { ...OSD_FIELDS_DEFAULT, ...(JSON.parse(raw) as Partial<OsdFields>) };
  } catch {
    /* ignore */
  }
  return { ...OSD_FIELDS_DEFAULT };
}

/**
 * OSD scale: on a phone the full-size OSD eats most of the picture, so it can run
 * compact (smaller type/bars, secondary readouts hidden). "auto" picks compact on
 * narrow screens; the other two force it, for people who prefer one or the other.
 */
export type OsdSize = 'auto' | 'compact' | 'full';
const OSD_SIZE_KEY = 'yonderrc.osdSize.v1';
/** Too small for a full-size OSD: a phone in portrait, or a phone in landscape
    (wide but short, and always a touch device — a desktop window is neither). */
const COMPACT_QUERY = '(max-width: 700px), (max-height: 520px) and (pointer: coarse)';
function loadOsdSize(): OsdSize {
  const v = (typeof localStorage !== 'undefined' && localStorage.getItem(OSD_SIZE_KEY)) as OsdSize | null;
  return v === 'compact' || v === 'full' ? v : 'auto';
}

/** Live match for a media query, so "auto" follows rotation/resize without a reload. */
function useMediaQuery(query: string): boolean {
  const [match, setMatch] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query).matches
      : false,
  );
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(query);
    const onChange = () => setMatch(mq.matches);
    onChange();
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);
  return match;
}

type PlayState = 'idle' | 'connecting' | 'playing' | 'reconnecting' | 'error';
export type VideoQuality = 'high' | 'medium' | 'low';

export interface VideoStats {
  latencyMs: number | null;
  bitrateKbps: number | null;
  lossPct: number | null;
  fps: number | null;
  framesDecoded: number;
}

/**
 * Read the useful inbound-video stats from WebRTC in one pass: an estimated
 * glass-to-glass latency (jitter buffer + half RTT + decode), current bitrate,
 * packet loss and framerate. Bitrate/loss/fps are computed as deltas against the
 * previous sample, so the caller keeps the previous VideoStats around.
 */
async function readVideoStats(pc: RTCPeerConnection, prev: VideoStats | null, dtMs: number): Promise<VideoStats | null> {
  const stats = await pc.getStats();
  let jbDelay = 0;
  let jbCount = 0;
  let rtt = 0;
  let decodeMs = 0;
  let bytes = 0;
  let framesDecoded = 0;
  let packetsLost = 0;
  let packetsReceived = 0;
  let reportedFps: number | undefined;
  let haveInbound = false;

  stats.forEach((r) => {
    if (r.type === 'inbound-rtp' && (r as RTCInboundRtpStreamStats & { kind?: string }).kind === 'video') {
      haveInbound = true;
      const s = r as RTCInboundRtpStreamStats & {
        jitterBufferDelay?: number;
        jitterBufferEmittedCount?: number;
        totalDecodeTime?: number;
        framesDecoded?: number;
        bytesReceived?: number;
        packetsLost?: number;
        packetsReceived?: number;
        framesPerSecond?: number;
      };
      jbDelay = s.jitterBufferDelay ?? 0;
      jbCount = s.jitterBufferEmittedCount ?? 0;
      if (s.totalDecodeTime && s.framesDecoded) decodeMs = (s.totalDecodeTime / s.framesDecoded) * 1000;
      bytes = s.bytesReceived ?? 0;
      framesDecoded = s.framesDecoded ?? 0;
      packetsLost = s.packetsLost ?? 0;
      packetsReceived = s.packetsReceived ?? 0;
      reportedFps = s.framesPerSecond;
    }
    if (r.type === 'candidate-pair' && (r as RTCIceCandidatePairStats).nominated) {
      rtt = (r as RTCIceCandidatePairStats).currentRoundTripTime ?? 0;
    }
  });
  if (!haveInbound) return null;

  const latencyMs = jbCount > 0 ? Math.round((jbDelay / jbCount) * 1000 + (rtt * 1000) / 2 + decodeMs) : prev?.latencyMs ?? null;
  const totalPackets = packetsReceived + packetsLost;
  const lossPct = totalPackets > 0 ? Math.max(0, Math.min(100, (packetsLost / totalPackets) * 100)) : null;

  let bitrateKbps: number | null = prev?.bitrateKbps ?? null;
  let fps: number | null = reportedFps != null ? Math.round(reportedFps) : prev?.fps ?? null;
  if (prev && dtMs > 0) {
    const dSec = dtMs / 1000;
    const prevBytes = (prev as VideoStats & { _bytes?: number })._bytes ?? bytes;
    bitrateKbps = Math.max(0, Math.round(((bytes - prevBytes) * 8) / 1000 / dSec));
    if (reportedFps == null) fps = Math.max(0, Math.round((framesDecoded - prev.framesDecoded) / dSec));
  }
  const out: VideoStats & { _bytes?: number } = { latencyMs, bitrateKbps, lossPct: lossPct == null ? null : Math.round(lossPct * 10) / 10, fps, framesDecoded };
  out._bytes = bytes;
  return out;
}

/** Minimal WebRTC client for go2rtc: POST our offer, apply its answer. */
async function playWhep(
  baseUrl: string,
  src: string,
  onStream: (stream: MediaStream) => void,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    if (e.streams[0]) onStream(e.streams[0]);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIceComplete(pc);

  // go2rtc's WebRTC signaling endpoint: POST the SDP offer, receive the answer.
  const res = await fetch(`${baseUrl}/api/webrtc?src=${encodeURIComponent(src)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/sdp' },
    body: pc.localDescription?.sdp ?? '',
  });
  if (!res.ok) throw new Error(`go2rtc webrtc ${res.status}`);
  const answer = await res.text();
  await pc.setRemoteDescription({ type: 'answer', sdp: answer });
  return pc;
}

function waitIceComplete(pc: RTCPeerConnection): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const check = () => {
      if (pc.iceGatheringState === 'complete') {
        pc.removeEventListener('icegatheringstatechange', check);
        resolve();
      }
    };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(resolve, 1500); // don't block forever on slow ICE
  });
}

function bar(us: number): number {
  return ((us - CHANNEL_MIN_US) / (CHANNEL_MAX_US - CHANNEL_MIN_US)) * 100;
}

const COMPASS8 = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
function compass(deg: number): string {
  return COMPASS8[Math.round(deg / 45) % 8];
}
function fmtDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`;
}

/**
 * Battery charge bar for the OSD — shown alone top-right, phone-style. Returns
 * null when there's no real sensor or no percentage, so nothing floats up there.
 */
const PERCENT_SRC_LABEL: Record<string, string> = {
  coulomb: 'mAh',
  voltage: 'volt',
  clamp: 'mAh·V',
};

function TelemetryBar({ t }: { t: TelemetryMessage }) {
  if (t.source === 'real' && !t.ok) return null;
  const pct = t.batteryPercent;
  if (pct == null) return null;
  const src = t.batteryPercentSource ? PERCENT_SRC_LABEL[t.batteryPercentSource] : null;
  return (
    <div className="osd-batt-wrap">
      <div className="osd-batt-bar" title={`${pct}% (from ${t.batteryPercentSource ?? 'coulomb'})`}>
        <i
          style={{
            width: `${pct}%`,
            background: pct < 15 ? 'var(--bad)' : pct < 35 ? 'var(--idle)' : 'var(--go)',
          }}
        />
        <span className="osd-batt-pct">{Math.round(pct)}%</span>
      </div>
      {src && <span className="osd-batt-src" title="Which method drives the % (set in Setup › Telemetry)">{src}</span>}
    </div>
  );
}

/**
 * Battery data block: voltages, currents, capacity. Shown bottom-right as its own
 * panel under the link/latency block.
 */
function TelemetryData({ t, compact }: { t: TelemetryMessage; compact: boolean }) {
  // Real source but no sensor → make it unmistakable, never show fake numbers.
  if (t.source === 'real' && !t.ok) {
    return (
      <div className="osd-block osd-tel">
        <span className="osd-nodata">⚠ NO SENSOR</span>
      </div>
    );
  }
  // Compact drops the capacity denominator and the "left/used" word — on a phone
  // the block has to stay narrow enough to clear the centred ARMED badge.
  const mahValue =
    t.capacityMah != null && t.displayMode === 'remaining'
      ? Math.max(0, Math.round(t.capacityMah - t.mah))
      : Math.round(t.mah);
  const capLine =
    t.capacityMah == null || compact
      ? `${mahValue} mAh`
      : t.displayMode === 'remaining'
        ? `${mahValue}/${t.capacityMah} mAh left`
        : `${mahValue}/${t.capacityMah} mAh used`;
  return (
    <div className="osd-block osd-tel">
      {t.source === 'sim' && <span className="osd-sim" title="Simulated telemetry — no real sensor">{compact ? 'SIM' : 'SIM DATA'}</span>}
      {t.voltages.map((v, i) => (
        <span key={`v${i}`} className="osd-batt">{v.value.toFixed(2)} V</span>
      ))}
      {t.currents.map((c, i) => (
        <span key={`c${i}`}>{c.value.toFixed(1)} A</span>
      ))}
      <span>{capLine}</span>
    </div>
  );
}

export function VideoPanel({
  videoBaseUrl,
  cameras,
  linkState,
  controlPath,
  armed,
  failsafe,
  latencyMs,
  channels,
  profile,
  telemetry,
  input,
  actions,
  flightSeconds,
  batteryLow,
  batteryReason,
  linkSignal,
  gps,
  onQuality,
  onStats,
}: {
  videoBaseUrl: string | null;
  cameras: string[];
  linkState: LinkState;
  controlPath: ControlPath;
  armed: boolean;
  failsafe: boolean;
  latencyMs: number | null;
  channels: number[];
  profile: Profile;
  telemetry: TelemetryMessage | null;
  input: InputManager;
  actions: ActionBindings;
  flightSeconds: number | null;
  batteryLow: boolean;
  batteryReason: string | null;
  linkSignal: LinkSignal | null;
  gps: GpsMessage | null;
  onQuality: (q: VideoQuality) => void;
  onStats?: (s: VideoStats | null) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [isFull, setIsFull] = useState(false);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [camera, setCamera] = useState(cameras[0] ?? '');
  const [play, setPlay] = useState<PlayState>('idle');
  const [showOsd, setShowOsd] = useState(true);
  const [osdFields, setOsdFieldsState] = useState<OsdFields>(loadOsdFields);
  const [osdSize, setOsdSizeState] = useState<OsdSize>(loadOsdSize);
  const narrowScreen = useMediaQuery(COMPACT_QUERY);
  const compactOsd = osdSize === 'compact' || (osdSize === 'auto' && narrowScreen);
  const setOsdSize = (v: OsdSize) => {
    setOsdSizeState(v);
    try {
      localStorage.setItem(OSD_SIZE_KEY, v);
    } catch {
      /* ignore */
    }
  };
  const setOsdField = (key: keyof OsdFields, v: boolean) => {
    setOsdFieldsState((prev) => {
      const next = { ...prev, [key]: v };
      try {
        localStorage.setItem(OSD_FIELDS_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  };
  const [videoLatency, setVideoLatency] = useState<number | null>(null);
  const [stats, setStats] = useState<VideoStats | null>(null);

  // Trip odometer: sum of ground distance between successive fixes, with a jitter
  // deadband so a stationary receiver's drift doesn't make it creep. Resets when the
  // link drops (gps becomes null).
  const [odoMeters, setOdoMeters] = useState(0);
  const odoRef = useRef<{ lat: number; lon: number } | null>(null);
  useEffect(() => {
    if (!gps) { odoRef.current = null; setOdoMeters(0); return; }
    if (!gps.hasFix || gps.lat == null || gps.lon == null) return;
    const prev = odoRef.current;
    if (prev) {
      const d = distanceMeters(prev.lat, prev.lon, gps.lat, gps.lon);
      const moving = gps.speedMs == null || gps.speedMs > 0.5; // ignore GPS drift while stopped
      if (moving && d >= 1 && d < 500) setOdoMeters((m) => m + d);
    }
    odoRef.current = { lat: gps.lat, lon: gps.lon };
  }, [gps]);
  const [quality, setQuality] = useState<QualitySel>(loadQuality);
  const [effectiveQuality, setEffectiveQuality] = useState<VideoQuality>(() => {
    const q = loadQuality();
    return q === 'auto' ? 'high' : q;
  });
  const [autoCfg, setAutoCfg] = useState<AutoQualityCfg>(loadAutoCfg);
  const [showRecSettings, setShowRecSettings] = useState(false);
  const rec = useRecorder(videoRef);
  const streakRef = useRef<AutoState>({ bad: 0, good: 0 });
  const effRef = useRef<VideoQuality>(effectiveQuality);
  effRef.current = effectiveQuality;
  const autoCfgRef = useRef<AutoQualityCfg>(autoCfg);
  autoCfgRef.current = autoCfg;
  const playRef = useRef<PlayState>('idle');
  playRef.current = play;
  const genRef = useRef(0);

  // Reconnect bookkeeping (refs so the watchdog can act without re-subscribing).
  const attemptRef = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const statsRef = useRef<VideoStats | null>(null);
  const lastFramesRef = useRef<{ frames: number; at: number }>({ frames: 0, at: 0 });
  const wantVideo = !!videoBaseUrl && !!camera && linkState === 'connected';

  useEffect(() => {
    if (cameras.length && !cameras.includes(camera)) setCamera(cameras[0]);
  }, [cameras, camera]);

  // Self-healing video: connect, watch for stalls/failures, reconnect with backoff.
  useEffect(() => {
    let cancelled = false;

    const clearReconnect = () => {
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      reconnectTimer.current = null;
    };

    const scheduleReconnect = () => {
      if (cancelled || !wantVideo) return;
      clearReconnect();
      const delay = Math.min(500 * 2 ** attemptRef.current, 5000);
      attemptRef.current += 1;
      setPlay('reconnecting');
      reconnectTimer.current = setTimeout(connect, delay);
    };

    async function connect() {
      if (cancelled || !wantVideo) return;
      // Keep the last frame on screen; don't clear srcObject.
      pcRef.current?.close();
      pcRef.current = null;
      setPlay((p) => (p === 'reconnecting' ? p : 'connecting'));
      const myGen = ++genRef.current;
      try {
        // Attach the stream only if this attempt is still the latest one, so a
        // superseded attempt (e.g. StrictMode double-mount, or a fast Setup→Drive
        // toggle) can't leave a dead stream on the element. Also force play() —
        // autoplay can stall on remount.
        const onStream = (stream: MediaStream) => {
          if (cancelled || myGen !== genRef.current) return;
          const v = videoRef.current;
          if (!v) return;
          if (v.srcObject !== stream) v.srcObject = stream;
          v.play().catch(() => {});
        };
        const pc = await playWhep(videoBaseUrl!, camera, onStream);
        if (cancelled || myGen !== genRef.current) {
          pc.close();
          return;
        }
        pcRef.current = pc;
        lastFramesRef.current = { frames: 0, at: Date.now() };
        pc.onconnectionstatechange = () => {
          const st = pc.connectionState;
          if (st === 'connected') {
            attemptRef.current = 0;
            setPlay('playing');
          } else if (st === 'failed' || st === 'disconnected' || st === 'closed') {
            if (!cancelled && wantVideo) scheduleReconnect();
          }
        };
      } catch {
        if (!cancelled && wantVideo) scheduleReconnect();
      }
    }

    if (!wantVideo) {
      setPlay('idle');
      setStats(null);
      pcRef.current?.close();
      pcRef.current = null;
      clearReconnect();
      return;
    }

    attemptRef.current = 0;
    connect();

    // Watchdog: sample stats every second; detect a frozen picture (frames not
    // advancing while nominally connected) and force a reconnect.
    let lastAt = Date.now();
    const watch = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const now = Date.now();
      const dt = now - lastAt;
      lastAt = now;
      const s = await readVideoStats(pc, statsRef.current, dt).catch(() => null);
      if (s) {
        statsRef.current = s;
        setStats(s);
        setVideoLatency(s.latencyMs);
        onStats?.(s);
        // Frame liveness: real decoded frames mean we're playing; a stall (no new
        // frames for a few seconds, incl. a black/empty stream after a remount)
        // forces a reconnect regardless of the WebRTC connectionState.
        const lf = lastFramesRef.current;
        if (s.framesDecoded > lf.frames) {
          lastFramesRef.current = { frames: s.framesDecoded, at: now };
          if (playRef.current !== 'playing') {
            attemptRef.current = 0;
            setPlay('playing');
          }
        } else if (now - lf.at > 4000) {
          scheduleReconnect();
        }

        // Auto-quality: nudge the effective level based on loss/latency, with
        // hysteresis so a flaky link doesn't make it oscillate.
        if (quality === 'auto' && playRef.current === 'playing') {
          const r = autoQualityStep(
            effRef.current,
            s.lossPct ?? 0,
            s.latencyMs ?? 0,
            autoCfgRef.current,
            streakRef.current,
          );
          streakRef.current = r.state;
          if (r.changed) {
            setEffectiveQuality(r.level);
            onQuality(r.level);
          }
        }
      }
    }, 1000);

    return () => {
      cancelled = true;
      clearInterval(watch);
      clearReconnect();
      pcRef.current?.close();
      pcRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoBaseUrl, camera, linkState, quality]);

  // Fullscreen the whole stage (video + OSD overlays stay together).
  useEffect(() => {
    const onFs = () => setIsFull(document.fullscreenElement === stageRef.current);
    document.addEventListener('fullscreenchange', onFs);
    return () => document.removeEventListener('fullscreenchange', onFs);
  }, []);
  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void stageRef.current?.requestFullscreen?.();
  };

  // Record / snapshot / next-camera via the unified action bindings.
  const nextCamera = () => {
    if (cameras.length < 2) return;
    const i = cameras.indexOf(camera);
    setCamera(cameras[(i + 1) % cameras.length]);
  };
  useActionHotkeys(
    actions,
    { 'record-toggle': rec.toggleRecord, snapshot: rec.snapshot, 'next-camera': nextCamera },
    input,
  );

  const throttleCh = profile.throttleChannels[0] ?? 2;
  const steerCh = profile.bindings.find((b) => b.mode === 'proportional')?.channel ?? 0;
  // Unified weak-link warning: control RTT, video packet loss, OR low uplink signal.
  const weakLink =
    (latencyMs != null && latencyMs > 300) ||
    (stats?.lossPct != null && stats.lossPct >= 5) ||
    (linkSignal?.quality != null && linkSignal.quality < 25);

  // Distance + direction to home, when we have both a fix and a home point.
  // arrowDeg points at home relative to the vehicle's travel direction (course),
  // so on an FPV view "up = forward" and the arrow shows which way home is. With no
  // course (stationary) it falls back to absolute bearing (up = north).
  const gpsHome =
    gps?.hasFix && gps.home && gps.lat != null && gps.lon != null
      ? (() => {
          const brg = bearingDeg(gps.lat, gps.lon, gps.home.lat, gps.home.lon);
          const arrowDeg = ((brg - (gps.courseDeg ?? 0)) % 360 + 360) % 360;
          return {
            dist: fmtDist(distanceMeters(gps.home.lat, gps.home.lon, gps.lat, gps.lon)),
            dir: compass(brg),
            arrowDeg,
            relative: gps.courseDeg != null,
          };
        })()
      : null;

  function changeQuality(q: QualitySel) {
    setQuality(q);
    try {
      localStorage.setItem(QUALITY_KEY, q);
    } catch {
      /* ignore */
    }
    streakRef.current = { bad: 0, good: 0 };
    if (q !== 'auto') {
      setEffectiveQuality(q);
      onQuality(q); // vehicle rescales + reloads go2rtc; the watchdog reconnects
    }
    // For 'auto', the controller in the watchdog takes over from the current level.
  }

  function saveAutoCfg(patch: Partial<AutoQualityCfg>) {
    setAutoCfg((prev) => {
      const next = { ...prev, ...patch };
      try {
        localStorage.setItem(AUTO_KEY, JSON.stringify(next));
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  // Only the states worth interrupting the picture for: FAILSAFE and DISARMED
  // ("why doesn't it move?"). ARMED is deliberately silent — that's the normal
  // case, the flight timer and the channel bars already show it, and on a phone
  // one badge less keeps the OSD off the middle of the frame.
  const armBadge = failsafe ? (
    <span className="osd-badge bad">FAILSAFE</span>
  ) : armed ? null : (
    <span className="osd-badge idle">DISARMED</span>
  );

  return (
    <section className="panel video">
      <div className="video-head">
        <span className="eyebrow">FPV</span>
        <div className="video-tools">
          {cameras.length > 1 && (
            <select value={camera} onChange={(e) => setCamera(e.target.value)} aria-label="Camera">
              {cameras.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <select value={quality} onChange={(e) => changeQuality(e.target.value as QualitySel)} aria-label="Video quality" title="Video quality">
            <option value="auto">Quality: Auto{quality === 'auto' ? ` (${effectiveQuality})` : ''}</option>
            <option value="high">Quality: High</option>
            <option value="medium">Quality: Medium</option>
            <option value="low">Quality: Low</option>
          </select>
          <button
            className={`btn tiny${rec.recording ? ' rec-on' : ''}`}
            onClick={rec.toggleRecord}
            title="Record (bindable in Setup › Controls)"
          >
            {rec.recording ? '● REC' : 'Record'}
          </button>
          <button className="btn tiny" onClick={rec.snapshot} title="Snapshot (bindable in Setup › Controls)">
            Snapshot
          </button>
          <button className="btn tiny" onClick={() => setShowRecSettings((v) => !v)} title="Recording settings">
            ⚙
          </button>
          <button className="btn tiny" onClick={toggleFullscreen} title="Fullscreen">
            {isFull ? '⤢ Exit' : '⛶ Full'}
          </button>
          <button className="btn tiny" onClick={() => setShowOsd((v) => !v)}>
            OSD {showOsd ? 'on' : 'off'}
          </button>
        </div>
      </div>

      {showRecSettings && (
        <div className="rec-settings">
          <div className="eyebrow2">OSD size</div>
          <div className="radios">
            {([
              ['auto', `Auto${osdSize === 'auto' ? ` (${compactOsd ? 'compact' : 'full'})` : ''}`],
              ['compact', 'Compact'],
              ['full', 'Full'],
            ] as [OsdSize, string][]).map(([val, label]) => (
              <label key={val} className={`radio${osdSize === val ? ' on' : ''}`}>
                <input type="radio" name="osdsize" checked={osdSize === val} onChange={() => setOsdSize(val)} />
                {label}
              </label>
            ))}
          </div>
          <p className="note">Compact shrinks the OSD and drops secondary readouts (video latency, kbps, fps) so the picture stays visible on a phone. Auto uses it on narrow screens.</p>

          <div className="eyebrow2" style={{ marginTop: 10 }}>OSD fields</div>
          <p className="note">Show or hide OSD blocks. Kept per browser.</p>
          <div className="osd-fields">
            {([
              ['timer', 'Flight timer'],
              ['gps', 'GPS (fix / sats / home)'],
              ['homeArrow', 'Home arrow / compass'],
              ['channels', 'Channel bars (THR/STR)'],
              ['link', 'Link block (WS / ms / fps / loss)'],
              ['batteryBar', 'Battery bar (%)'],
              ['batteryData', 'Battery data (V / A / mAh)'],
            ] as [keyof OsdFields, string][]).map(([key, label]) => (
              <label key={key} className="opt">
                <input type="checkbox" checked={osdFields[key]} onChange={(e) => setOsdField(key, e.target.checked)} />
                {label}
              </label>
            ))}
          </div>

          <div className="eyebrow2" style={{ marginTop: 10 }}>Recording</div>
          <div className="rec-row">
            <button className="btn tiny" onClick={rec.pickFolder}>Choose folder</button>
            <span className="rec-folder">{rec.folderName ? `${rec.folderName}/` : 'Downloads (fallback)'}</span>
          </div>
          <label className="rec-field">Filename prefix
            <input value={rec.settings.prefix} onChange={(e) => rec.setSettings({ prefix: e.target.value })} />
          </label>
          <p className="note">Pick a folder once before flying, then record/snapshot never prompt. Record, snapshot and next-camera keys/buttons live in <b>Setup › Controls</b>.</p>

          <div className="eyebrow2" style={{ marginTop: 10 }}>Auto quality thresholds</div>
          <p className="note">Used when quality is set to <b>Auto</b>. Step down if loss/latency exceed the "down" limits for the hold time; step up only when both are below the "up" limits for the (longer) up-hold.</p>
          <div className="rec-grid">
            <label className="rec-field">Loss down %<input type="number" value={autoCfg.lossDownPct} onChange={(e) => saveAutoCfg({ lossDownPct: Number(e.target.value) })} /></label>
            <label className="rec-field">Latency down ms<input type="number" value={autoCfg.latDownMs} onChange={(e) => saveAutoCfg({ latDownMs: Number(e.target.value) })} /></label>
            <label className="rec-field">Loss up %<input type="number" value={autoCfg.lossUpPct} onChange={(e) => saveAutoCfg({ lossUpPct: Number(e.target.value) })} /></label>
            <label className="rec-field">Latency up ms<input type="number" value={autoCfg.latUpMs} onChange={(e) => saveAutoCfg({ latUpMs: Number(e.target.value) })} /></label>
            <label className="rec-field">Down hold s<input type="number" value={autoCfg.downHoldS} onChange={(e) => saveAutoCfg({ downHoldS: Number(e.target.value) })} /></label>
            <label className="rec-field">Up hold s<input type="number" value={autoCfg.upHoldS} onChange={(e) => saveAutoCfg({ upHoldS: Number(e.target.value) })} /></label>
          </div>
        </div>
      )}

      <div className="video-stage" ref={stageRef}>
        <video ref={videoRef} autoPlay playsInline muted />
        {rec.recording && <div className="rec-badge">● REC</div>}
        {batteryLow && <div className="batt-warn">⚠ BATTERY LOW{batteryReason ? ` · ${batteryReason}` : ''}</div>}
        {rec.lastAction && <div className="rec-toast">{rec.lastAction}</div>}

        {play !== 'playing' && (
          <div className="video-placeholder">
            {play === 'connecting' && 'Connecting to camera…'}
            {play === 'reconnecting' && 'Reconnecting…'}
            {play === 'idle' &&
              (videoBaseUrl
                ? 'Connect the vehicle to start video.'
                : 'Video disabled. Start go2rtc on the vehicle to enable FPV.')}
            {play === 'error' &&
              'No video stream. Is go2rtc running and the camera name correct?'}
          </div>
        )}

        {showOsd && (
          <div className={`osd${compactOsd ? ' compact' : ''}`}>
            {((osdFields.timer && flightSeconds !== null) ||
              (osdFields.gps && gps && gps.source !== 'off') ||
              (osdFields.homeArrow && gpsHome)) && (
              <div className="osd-tl">
                {osdFields.timer && flightSeconds !== null && (
                  <span className="osd-badge go">⏱ {Math.floor(flightSeconds / 60)}:{String(flightSeconds % 60).padStart(2, '0')}</span>
                )}
                {osdFields.gps && gps && gps.source !== 'off' && (
                  <span className={`osd-badge ${gps.hasFix ? 'go' : 'idle'}`}>
                    ⌖ {gps.hasFix ? `${gps.fixType.toUpperCase()} ${gps.satellites ?? ''}` : 'NO FIX'}
                  </span>
                )}
                {osdFields.gps && gpsHome && (
                  <span className={`osd-badge ${weakLink ? 'idle' : 'go'}`}>⌂ {gpsHome.dist} {gpsHome.dir}</span>
                )}
                {osdFields.homeArrow && gpsHome && (
                  <div className="osd-home" title={`Home ${gpsHome.dist} ${gpsHome.dir}${gpsHome.relative ? ' (relative to heading)' : ' (relative to north)'}`}>
                    <div className="osd-home-rose">
                      <span className="osd-home-ref">{gpsHome.relative ? 'FWD' : 'N'}</span>
                      <span className="osd-home-arrow" style={{ transform: `rotate(${Math.round(gpsHome.arrowDeg)}deg)` }}>↑</span>
                    </div>
                    <span className="osd-odo" title="Distance travelled (odometer)">⟳ {fmtDist(odoMeters)}</span>
                    {gps?.speedMs != null && (
                      <span className="osd-odo" title="Ground speed (GPS)">▸ {(gps.speedMs * 3.6).toFixed(1)} km/h</span>
                    )}
                  </div>
                )}
              </div>
            )}
            <div className="osd-tc">
              <span className={`osd-badge ${linkState === 'connected' ? 'go' : 'bad'}`}>
                {linkState === 'connected' ? '● LINK' : linkState === 'connecting' ? '● RECONNECTING…' : '● NO LINK'}
              </span>
              {weakLink && linkState === 'connected' && <span className="osd-badge bad">⚠ WEAK LINK</span>}
              {/* Compact keeps the arm state up top: on a phone the bottom-centre
                  badge would sit under the (wider) telemetry block. */}
              {compactOsd && armBadge}
            </div>
            {!compactOsd && armBadge && <div className="osd-bc">{armBadge}</div>}
            {osdFields.batteryBar && (
              <div className="osd-tr">
                {telemetry && <TelemetryBar t={telemetry} />}
              </div>
            )}
            {osdFields.channels && (
              <div className="osd-bl">
                <div className="osd-ch">
                  <span>THR</span>
                  <div className="osd-bar"><i style={{ width: `${bar(channels[throttleCh] ?? CHANNEL_NEUTRAL_US)}%` }} /></div>
                </div>
                <div className="osd-ch">
                  <span>STR</span>
                  <div className="osd-bar"><i style={{ width: `${bar(channels[steerCh] ?? CHANNEL_NEUTRAL_US)}%` }} /></div>
                </div>
              </div>
            )}
            <div className="osd-br">
              {osdFields.link && (
                <div className="osd-block">
                  <span>
                    {linkState === 'connected' ? controlPath.toUpperCase() : linkState === 'connecting' ? 'RECONNECTING' : 'NO LINK'}
                  </span>
                  {linkSignal && linkSignal.kind !== 'none' && (
                    <span className={linkSignal.quality != null && linkSignal.quality < 25 ? 'osd-warn' : undefined}>{linkSignal.label}</span>
                  )}
                  <span>ctrl {latencyMs === null ? '--' : `${latencyMs}`} ms</span>
                  {videoLatency !== null && <span className="osd-sec">video ~{videoLatency} ms</span>}
                  {stats?.bitrateKbps != null && <span className="osd-sec">{stats.bitrateKbps} kbps</span>}
                  {stats?.fps != null && <span className="osd-sec">{stats.fps} fps</span>}
                  {stats?.lossPct != null && (
                    <span className={stats.lossPct >= 3 ? 'osd-warn' : undefined}>loss {stats.lossPct}%</span>
                  )}
                </div>
              )}
              {osdFields.batteryData && (telemetry ? <TelemetryData t={telemetry} compact={compactOsd} /> : <div className="osd-block osd-tel"><span className="osd-batt">-- V</span></div>)}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
