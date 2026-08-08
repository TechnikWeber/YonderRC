import { RTCPeerConnection } from 'node-datachannel/polyfill';
import type { ClientMessage, RtcSignalMessage } from '@yonderrc/protocol';
import type { VehicleCore } from '../core/VehicleCore.js';
import { handleClientMessage } from './handleMessage.js';

const ICE_SERVERS = [{ urls: 'stun:stun.l.google.com:19302' }];

/**
 * One WebRtcControl per connected ground client. The ground is the offerer; this
 * side answers. Signaling ('rtc' messages) is relayed by the caller over the WS.
 * When the data channel opens, control frames arrive here and go through the same
 * handleClientMessage path as the WS — so behaviour is identical on either path.
 */
export class WebRtcControl {
  private pc: RTCPeerConnection;
  private core: VehicleCore;
  private sendSignal: (msg: RtcSignalMessage) => void;
  private open = false;

  constructor(core: VehicleCore, sendSignal: (msg: RtcSignalMessage) => void) {
    this.core = core;
    this.sendSignal = sendSignal;
    this.pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.sendSignal({ type: 'rtc', sub: 'ice', payload: e.candidate });
    };

    this.pc.ondatachannel = (e) => {
      const ch = e.channel;
      if (ch.label !== 'control') return;
      ch.onopen = () => {
        this.open = true;
        console.log('[rtc] control data channel open — control now on WebRTC');
      };
      ch.onclose = () => {
        this.open = false;
        console.log('[rtc] control data channel closed');
      };
      ch.onmessage = (m) => {
        try {
          const msg = JSON.parse(String(m.data)) as ClientMessage;
          handleClientMessage(this.core, msg);
        } catch {
          /* ignore malformed frame; newest supersedes */
        }
      };
    };
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Handle an inbound signaling message relayed from the ground over WS. */
  async onSignal(msg: RtcSignalMessage): Promise<void> {
    try {
      if (msg.sub === 'offer') {
        await this.pc.setRemoteDescription(msg.payload as RTCSessionDescriptionInit);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.sendSignal({ type: 'rtc', sub: 'answer', payload: this.pc.localDescription });
      } else if (msg.sub === 'ice') {
        await this.pc.addIceCandidate(msg.payload as RTCIceCandidateInit);
      } else if (msg.sub === 'bye') {
        this.close();
      }
    } catch (err) {
      console.warn('[rtc] signaling error:', (err as Error).message);
    }
  }

  close(): void {
    try {
      this.pc.close();
    } catch {
      /* already closed */
    }
    this.open = false;
  }
}
