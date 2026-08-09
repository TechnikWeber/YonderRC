import { useEffect, useRef, useState } from 'react';
import {
  CHANNEL_MIN_US,
  CHANNEL_MAX_US,
  CHANNEL_NEUTRAL_US,
  type Profile,
  type TelemetryMessage,
} from '@yonderrc/protocol';
import type { ControlPath, LinkState } from '../lib/transport';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

type PlayState = 'idle' | 'connecting' | 'playing' | 'error';

/**
 * Estimate glass-to-glass video latency from WebRTC stats: the jitter buffer
 * delay (how long frames wait to be played) plus half the round-trip time, plus a
 * small decode allowance. It's an estimate — a true glass-to-glass figure needs a
 * timestamp burned into the frame — but it tracks the real end-to-end delay well
 * and needs no special source.
 */
async function estimateVideoLatency(pc: RTCPeerConnection): Promise<number | null> {
  const stats = await pc.getStats();
  let jbDelay = 0;
  let jbCount = 0;
  let rtt = 0;
  let decodeMs = 0;
  stats.forEach((r) => {
    if (r.type === 'inbound-rtp' && (r as RTCInboundRtpStreamStats & { kind?: string }).kind === 'video') {
      const s = r as RTCInboundRtpStreamStats & {
        jitterBufferDelay?: number;
        jitterBufferEmittedCount?: number;
        totalDecodeTime?: number;
        framesDecoded?: number;
      };
      jbDelay = s.jitterBufferDelay ?? 0;
      jbCount = s.jitterBufferEmittedCount ?? 0;
      if (s.totalDecodeTime && s.framesDecoded) decodeMs = (s.totalDecodeTime / s.framesDecoded) * 1000;
    }
    if (r.type === 'candidate-pair' && (r as RTCIceCandidatePairStats).nominated) {
      rtt = (r as RTCIceCandidatePairStats).currentRoundTripTime ?? 0;
    }
  });
  if (jbCount === 0) return null;
  const jbMs = (jbDelay / jbCount) * 1000;
  return Math.round(jbMs + (rtt * 1000) / 2 + decodeMs);
}

/** Minimal WebRTC client for go2rtc: POST our offer, apply its answer. */
async function playWhep(
  baseUrl: string,
  src: string,
  video: HTMLVideoElement,
): Promise<RTCPeerConnection> {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
  pc.addTransceiver('video', { direction: 'recvonly' });
  pc.addTransceiver('audio', { direction: 'recvonly' });
  pc.ontrack = (e) => {
    if (e.streams[0]) video.srcObject = e.streams[0];
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

/** Battery/telemetry block for the OSD: voltages, currents, capacity, percent. */
function TelemetryOsd({ t }: { t: TelemetryMessage }) {
  // Real source but no sensor → make it unmistakable, never show fake numbers.
  if (t.source === 'real' && !t.ok) {
    return (
      <div className="osd-tel">
        <span className="osd-nodata">⚠ NO SENSOR</span>
      </div>
    );
  }
  const pct = t.batteryPercent;
  const capLine =
    t.capacityMah != null
      ? t.displayMode === 'remaining'
        ? `${Math.max(0, Math.round(t.capacityMah - t.mah))}/${t.capacityMah} mAh left`
        : `${Math.round(t.mah)}/${t.capacityMah} mAh used`
      : `${Math.round(t.mah)} mAh`;
  return (
    <div className="osd-tel">
      {t.source === 'sim' && <span className="osd-sim" title="Simulated telemetry — no real sensor">SIM DATA</span>}
      {t.voltages.map((v, i) => (
        <span key={`v${i}`} className="osd-batt">{v.value.toFixed(2)} V</span>
      ))}
      {t.currents.map((c, i) => (
        <span key={`c${i}`}>{c.value.toFixed(1)} A</span>
      ))}
      <span>{capLine}</span>
      {pct != null && (
        <div className="osd-batt-bar" title={`${pct}%`}>
          <i
            style={{
              width: `${pct}%`,
              background: pct < 15 ? 'var(--bad)' : pct < 35 ? 'var(--idle)' : 'var(--go)',
            }}
          />
          <span className="osd-batt-pct">{Math.round(pct)}%</span>
        </div>
      )}
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
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [camera, setCamera] = useState(cameras[0] ?? '');
  const [play, setPlay] = useState<PlayState>('idle');
  const [showOsd, setShowOsd] = useState(true);
  const [videoLatency, setVideoLatency] = useState<number | null>(null);

  useEffect(() => {
    if (cameras.length && !cameras.includes(camera)) setCamera(cameras[0]);
  }, [cameras, camera]);

  useEffect(() => {
    let cancelled = false;
    pcRef.current?.close();
    pcRef.current = null;
    if (!videoBaseUrl || !camera || linkState !== 'connected') {
      setPlay('idle');
      return;
    }
    setPlay('connecting');
    playWhep(videoBaseUrl, camera, videoRef.current!)
      .then((pc) => {
        if (cancelled) {
          pc.close();
          return;
        }
        pcRef.current = pc;
        setPlay('playing');
      })
      .catch(() => !cancelled && setPlay('error'));
    return () => {
      cancelled = true;
      pcRef.current?.close();
      pcRef.current = null;
    };
  }, [videoBaseUrl, camera, linkState]);

  // Poll WebRTC stats for a video-latency estimate while a stream is playing.
  useEffect(() => {
    if (play !== 'playing') {
      setVideoLatency(null);
      return;
    }
    const id = setInterval(async () => {
      const pc = pcRef.current;
      if (!pc) return;
      const est = await estimateVideoLatency(pc).catch(() => null);
      if (est !== null) setVideoLatency(est);
    }, 1000);
    return () => clearInterval(id);
  }, [play]);

  const throttleCh = profile.throttleChannels[0] ?? 2;
  const steerCh = profile.bindings.find((b) => b.mode === 'proportional')?.channel ?? 0;

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
          <button className="btn tiny" onClick={() => setShowOsd((v) => !v)}>
            OSD {showOsd ? 'on' : 'off'}
          </button>
        </div>
      </div>

      <div className="video-stage">
        <video ref={videoRef} autoPlay playsInline muted />

        {play !== 'playing' && (
          <div className="video-placeholder">
            {play === 'connecting' && 'Connecting to camera…'}
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
            <div className="osd-tl">
              <span className={`osd-badge ${failsafe ? 'bad' : armed ? 'go' : 'idle'}`}>
                {failsafe ? 'FAILSAFE' : armed ? 'ARMED' : 'DISARMED'}
              </span>
            </div>
            <div className="osd-tr">
              <span>{linkState === 'connected' ? controlPath.toUpperCase() : 'NO LINK'}</span>
              <span>ctrl {latencyMs === null ? '--' : `${latencyMs}`} ms</span>
              {videoLatency !== null && <span>video ~{videoLatency} ms</span>}
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
              {telemetry ? <TelemetryOsd t={telemetry} /> : <span className="osd-batt">-- V</span>}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
