import {
  PROTOCOL_VERSION,
  type ClientMessage,
  type RtcSignalMessage,
  type ServerMessage,
  type StatusMessage,
  type TelemetryMessage,
  type WelcomeMessage,
} from '@yonderrc/protocol';

export type LinkState = 'disconnected' | 'connecting' | 'connected';
export type ControlPath = 'ws' | 'webrtc';

export interface LinkCallbacks {
  onState?: (state: LinkState) => void;
  onWelcome?: (msg: WelcomeMessage) => void;
  onStatus?: (msg: StatusMessage) => void;
  onTelemetry?: (msg: TelemetryMessage) => void;
  onControlPath?: (path: ControlPath) => void;
  /** The vehicle rejected the shared secret (WS close 4001). */
  onAuthFail?: () => void;
}

/** Append an optional shared secret as a `?secret=` query to the WS URL. */
export function withSecret(url: string, secret?: string | null): string {
  if (!secret) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}secret=${encodeURIComponent(secret)}`;
}

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * Which transport a client message must use. Only continuous control frames
 * tolerate loss (a dropped one is superseded 20 ms later) and prefer the
 * low-latency, unordered data channel. Everything else — arm/disarm (incl.
 * panic), hello, config, video, calib — is a one-shot state change and MUST go
 * over the reliable WS, or a single dropped packet is silently lost with no
 * retransmit. Pure + exported so the routing is unit-tested.
 */
export function prefersDataChannel(type: ClientMessage['type']): boolean {
  return type === 'control';
}

/**
 * Control link. Always connects a WebSocket first — it carries the handshake,
 * status stream, and WebRTC signaling, and is the control fallback. If WebRTC is
 * preferred, it negotiates a data channel over that signaling; once open, control
 * frames travel over the data channel (low-latency, NAT-friendly) instead of WS.
 */
export class LinkClient {
  private ws: WebSocket | null = null;
  private url = '';
  private secret: string | null = null;
  private seq = 0;
  private wantConnected = false;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private cbs: LinkCallbacks;

  private preferWebRtc = false;
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;

  constructor(cbs: LinkCallbacks = {}) {
    this.cbs = cbs;
  }

  connect(url: string, secret?: string | null): void {
    this.url = url;
    this.secret = secret ?? null;
    this.wantConnected = true;
    this.open();
  }

  disconnect(): void {
    this.wantConnected = false;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardownRtc();
    this.ws?.close();
    this.ws = null;
    this.cbs.onState?.('disconnected');
  }

  setPreferWebRtc(v: boolean): void {
    this.preferWebRtc = v;
    if (v && this.ws?.readyState === WebSocket.OPEN && !this.pc) this.upgradeToWebRtc();
    if (!v) {
      this.teardownRtc();
      this.cbs.onControlPath?.('ws');
    }
  }

  private open(): void {
    this.cbs.onState?.('connecting');
    try {
      this.ws = new WebSocket(withSecret(this.url, this.secret));
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.cbs.onState?.('connected');
      this.send({ type: 'hello', clientName: 'ground-web', protocol: PROTOCOL_VERSION });
    };

    this.ws.onmessage = (ev) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(ev.data as string) as ServerMessage;
      } catch {
        return;
      }
      if (msg.type === 'welcome') {
        this.cbs.onWelcome?.(msg);
        if (this.preferWebRtc && !this.pc) this.upgradeToWebRtc();
      } else if (msg.type === 'status') {
        this.cbs.onStatus?.(msg);
      } else if (msg.type === 'telemetry') {
        this.cbs.onTelemetry?.(msg);
      } else if (msg.type === 'rtc') {
        void this.onSignal(msg);
      }
    };

    this.ws.onclose = (ev) => {
      this.teardownRtc();
      this.cbs.onState?.('disconnected');
      this.cbs.onControlPath?.('ws');
      // 4001 = the vehicle rejected our secret. Don't loop-reconnect on bad auth —
      // stay down and let the operator fix the secret, then Connect again.
      if (ev.code === 4001) {
        this.wantConnected = false;
        this.cbs.onAuthFail?.();
        return;
      }
      this.scheduleReconnect();
    };
    this.ws.onerror = () => {};
  }

  private scheduleReconnect(): void {
    if (!this.wantConnected || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (this.wantConnected) this.open();
    }, 1000);
  }

  // --- WebRTC control upgrade (ground = offerer) ---
  private async upgradeToWebRtc(): Promise<void> {
    try {
      this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
      this.dc = this.pc.createDataChannel('control', { ordered: false, maxRetransmits: 0 });
      this.dc.onopen = () => this.cbs.onControlPath?.('webrtc');
      this.dc.onclose = () => this.cbs.onControlPath?.('ws');
      this.pc.onicecandidate = (e) => {
        if (e.candidate) this.sendSignal({ type: 'rtc', sub: 'ice', payload: e.candidate });
      };
      const offer = await this.pc.createOffer();
      await this.pc.setLocalDescription(offer);
      this.sendSignal({ type: 'rtc', sub: 'offer', payload: this.pc.localDescription });
    } catch (err) {
      console.warn('[link] webrtc upgrade failed, staying on ws:', err);
      this.teardownRtc();
    }
  }

  private async onSignal(msg: RtcSignalMessage): Promise<void> {
    if (!this.pc) return;
    try {
      if (msg.sub === 'answer') {
        await this.pc.setRemoteDescription(msg.payload as RTCSessionDescriptionInit);
      } else if (msg.sub === 'ice') {
        await this.pc.addIceCandidate(msg.payload as RTCIceCandidateInit);
      }
    } catch (err) {
      console.warn('[link] signaling error:', err);
    }
  }

  private teardownRtc(): void {
    try {
      this.dc?.close();
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.dc = null;
    this.pc = null;
  }

  private sendSignal(msg: RtcSignalMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  private send(msg: ClientMessage): void {
    // Control payload prefers the data channel when it's open; safety-critical
    // one-shots (arm, config, …) always take the reliable WS — see prefersDataChannel.
    if (prefersDataChannel(msg.type) && this.dc && this.dc.readyState === 'open') {
      this.dc.send(JSON.stringify(msg));
      return;
    }
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  sendControl(channels: number[]): void {
    this.send({ type: 'control', seq: this.seq++, t: Date.now(), channels });
  }
  sendArm(armed: boolean): void {
    // Routed over the reliable WS by send() (prefersDataChannel('arm') === false)
    // so a panic-disarm can't be dropped on a lossy data channel.
    this.send({ type: 'arm', armed });
  }
  sendConfig(failsafeUs: number[], throttleChannels: number[], disarmedUs?: number[]): void {
    // Config always goes over WS (reliable) regardless of control path.
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'config', failsafeUs, throttleChannels, disarmedUs }));
    }
  }

  /** Switch live video quality (reliable, over WS). */
  sendVideoQuality(quality: 'high' | 'medium' | 'low'): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'video', quality }));
    }
  }

  /** ESC calibration control (reliable, over WS). */
  sendCalib(action: 'start' | 'next' | 'cancel', channel?: number, minUs?: number, maxUs?: number): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'calib', action, channel, minUs, maxUs }));
    }
  }

  get isOpen(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
