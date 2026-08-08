import { useEffect, useRef, useState } from 'react';
import {
  CHANNEL_MIN_US,
  CHANNEL_MAX_US,
  CHANNEL_NEUTRAL_US,
  type Profile,
} from '@yonderrc/protocol';
import type { ControlPath, LinkState } from '../lib/transport';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

type PlayState = 'idle' | 'connecting' | 'playing' | 'error';

/** Minimal WHEP client: POST our offer to go2rtc, apply its answer. */
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

  const res = await fetch(`${baseUrl}/api/whep?src=${encodeURIComponent(src)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/sdp' },
    body: pc.localDescription?.sdp ?? '',
  });
  if (!res.ok) throw new Error(`WHEP ${res.status}`);
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
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const [camera, setCamera] = useState(cameras[0] ?? '');
  const [play, setPlay] = useState<PlayState>('idle');
  const [showOsd, setShowOsd] = useState(true);

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
              <span>{latencyMs === null ? '-- ms' : `${latencyMs} ms`}</span>
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
              <span className="osd-batt">-- V</span>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
