import { hostname } from 'node:os';
import type {
  ActionResult,
  LteStatus,
  SystemManager,
  SystemStatus,
  TailscaleStatus,
  WifiStatus,
} from './SystemManager.js';

/**
 * Mock system: pretends to have an LTE modem and Tailscale so the entire setup
 * flow can be exercised without a Pi. State transitions mimic the real thing
 * (connect → connected, tailscale up → login URL then running).
 */
export class SimSystem implements SystemManager {
  readonly kind = 'sim';
  private lte: LteStatus = {
    present: true,
    connected: false,
    operator: 'SimTel',
    signal: 68,
    apn: null,
    iface: 'wwan0',
    ip: null,
  };
  private tailscale: TailscaleStatus = {
    installed: true,
    running: false,
    ip: null,
    loginUrl: null,
    backendState: 'Stopped',
  };
  private wifi: WifiStatus = { mode: 'ap', ssid: 'YonderRC-setup', ip: '192.168.4.1' };

  async status(): Promise<SystemStatus> {
    return {
      kind: this.kind,
      hostname: hostname(),
      tailscale: { ...this.tailscale },
      lte: { ...this.lte },
      wifi: { ...this.wifi },
    };
  }

  async lteConnect(apn: string): Promise<ActionResult> {
    this.lte = { ...this.lte, connected: true, apn, ip: '10.64.12.34' };
    this.wifi = { mode: 'client', ssid: null, ip: null };
    return { ok: true, message: `LTE connected on APN "${apn}" (simulated).` };
  }

  async lteDisconnect(): Promise<ActionResult> {
    this.lte = { ...this.lte, connected: false, ip: null };
    return { ok: true, message: 'LTE disconnected (simulated).' };
  }

  async tailscaleUp(authKey?: string): Promise<ActionResult> {
    if (authKey) {
      this.tailscale = {
        installed: true,
        running: true,
        ip: '100.101.102.103',
        loginUrl: null,
        backendState: 'Running',
      };
      return { ok: true, message: 'Tailscale up with auth key (simulated).' };
    }
    // Interactive: hand back a login URL; a real user would open it.
    const loginUrl = 'https://login.tailscale.com/a/simulated1234';
    this.tailscale = { ...this.tailscale, loginUrl, backendState: 'NeedsLogin' };
    // Simulate the user completing login shortly after.
    setTimeout(() => {
      this.tailscale = {
        installed: true,
        running: true,
        ip: '100.101.102.103',
        loginUrl: null,
        backendState: 'Running',
      };
    }, 4000);
    return { ok: true, message: 'Open the login URL to finish (simulated).', loginUrl };
  }

  async tailscaleDown(): Promise<ActionResult> {
    this.tailscale = { installed: true, running: false, ip: null, loginUrl: null, backendState: 'Stopped' };
    return { ok: true, message: 'Tailscale stopped (simulated).' };
  }

  async reboot(): Promise<ActionResult> {
    return { ok: true, message: 'Reboot requested (simulated — no-op).' };
  }
}
