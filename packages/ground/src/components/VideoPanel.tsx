import { useEffect, useRef, useState } from 'react';
import {
  CHANNEL_MIN_US,
  CHANNEL_MAX_US,
  CHANNEL_NEUTRAL_US,
  type Profile,
  type TelemetryMessage,
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

/**
 * Battery charge bar for the OSD — shown alone top-right, phone-style. Returns
 * null when there's no real sensor or no percentage, so nothing floats up there.
 */
function TelemetryBar({ t }: { t: TelemetryMessage }) {
  if (t.source === 'real' && !t.ok) return null;
  const pct = t.batteryPercent;
  if (pct == null) return null;
  return (
    <div className="osd-batt-bar" title={`${pct}%`}>
      <i
        style={{
          width: `${pct}%`,
          background: pct < 15 ? 'var(--bad)' : pct < 35 ? 'var(--idle)' : 'var(--go)',
        }}
      />
      <span className="osd-batt-pct">{Math.round(pct)}%</span>
    </div>
  );
}

/**
 * Battery data block: voltages, currents, capacity. Shown bottom-right as its own
 * panel under the link/latency block.
 */
function TelemetryData({ t }: { t: TelemetryMessage }) {
  // Real source but no sensor → make it unmistakable, never show fake numbers.
  if (t.source === 'real' && !t.ok) {
    return (
      <div className="osd-block osd-tel">
        <span className="osd-nodata">⚠ NO SENSOR</span>
      </div>
    );
  }
  const capLine =
    t.capacityMah != null
      ? t.displayMode === 'remaining'
        ? `${Math.max(0, Math.round(t.capacityMah - t.mah))}/${t.capacityMah} mAh left`
        : `${Math.round(t.mah)}/${t.capacityMah} mAh used`
      : `${Math.round(t.mah)} mAh`;
  return (
    <div className="osd-block osd-tel">
      {t.source === 'sim' && <span className="osd-sim" title="Simulated telemetry — no real sensor">SIM DATA</span>}
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
  const [videoLatency, setVideoLatency] = useState<number | null>(null);
  const [stats, setStats] = useState<VideoStats | null>(null);
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
  // Weak-link warning from control RTT or video packet loss.
  const weakLink = (latencyMs != null && latencyMs > 300) || (stats?.lossPct != null && stats.lossPct >= 5);

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
          <div className="osd">
            {flightSeconds !== null && (
              <div className="osd-tl">
                <span className="osd-badge go">⏱ {Math.floor(flightSeconds / 60)}:{String(flightSeconds % 60).padStart(2, '0')}</span>
              </div>
            )}
            <div className="osd-tc">
              <span className={`osd-badge ${linkState === 'connected' ? 'go' : 'bad'}`}>
                {linkState === 'connected' ? '● LINK' : linkState === 'connecting' ? '● RECONNECTING…' : '● NO LINK'}
              </span>
              {weakLink && linkState === 'connected' && <span className="osd-badge bad">⚠ WEAK LINK</span>}
            </div>
            <div className="osd-bc">
              <span className={`osd-badge ${failsafe ? 'bad' : armed ? 'go' : 'idle'}`}>
                {failsafe ? 'FAILSAFE' : armed ? 'ARMED' : 'DISARMED'}
              </span>
            </div>
            <div className="osd-tr">
              {telemetry && <TelemetryBar t={telemetry} />}
            </div>
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
            <div className="osd-br">
              <div className="osd-block">
                <span>
                  {linkState === 'connected' ? controlPath.toUpperCase() : linkState === 'connecting' ? 'RECONNECTING' : 'NO LINK'}
                </span>
                <span>ctrl {latencyMs === null ? '--' : `${latencyMs}`} ms</span>
                {videoLatency !== null && <span>video ~{videoLatency} ms</span>}
                {stats?.bitrateKbps != null && <span>{stats.bitrateKbps} kbps</span>}
                {stats?.fps != null && <span>{stats.fps} fps</span>}
                {stats?.lossPct != null && (
                  <span className={stats.lossPct >= 3 ? 'osd-warn' : undefined}>loss {stats.lossPct}%</span>
                )}
              </div>
              {telemetry ? <TelemetryData t={telemetry} /> : <div className="osd-block osd-tel"><span className="osd-batt">-- V</span></div>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
