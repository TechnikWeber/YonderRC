import { hostname } from 'node:os';
import type {
  ActionResult,
  LteConfig,
  LtePinChange,
  LteStatus,
  RemoteAccessConfig,
  RemoteAccessStatus,
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
    state: 'registered',
    modemModel: 'SimModem LTE-1',
    pinRequired: false,
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

  async lteConnect(cfg: LteConfig): Promise<ActionResult> {
    const apn = cfg.apn ?? '';
    this.lte = { ...this.lte, connected: true, apn, ip: '10.64.12.34', state: 'connected' };
    this.wifi = { mode: 'client', ssid: null, ip: null };
    const extra = `${cfg.username ? ' (with auth)' : ''}${cfg.networkMode && cfg.networkMode !== 'auto' ? ` [${cfg.networkMode}]` : ''}${cfg.allowRoaming === false ? ' [home-only]' : ''}`;
    return { ok: true, message: `LTE connected on APN "${apn}"${extra} (simulated).` };
  }

  async lteDisconnect(): Promise<ActionResult> {
    this.lte = { ...this.lte, connected: false, ip: null, state: 'registered' };
    return { ok: true, message: 'LTE disconnected (simulated).' };
  }

  async lteSetPin(change: LtePinChange): Promise<ActionResult> {
    return { ok: true, message: change.action === 'disable' ? 'SIM PIN lock removed (simulated).' : 'SIM PIN changed (simulated).' };
  }

  async lteDiagnostics(): Promise<{ ok: boolean; output: string }> {
    return {
      ok: true,
      output: [
        'mmcli -L:',
        '    /org/freedesktop/ModemManager1/Modem/0 [SimModem] LTE-1',
        '',
        'mmcli -m 0:',
        '  Hardware |          model: SimModem LTE-1',
        '  Status   |          state: connected',
        '           | signal quality: 68% (recent)',
        '  3GPP     |  operator name: SimTel',
      ].join('\n'),
    };
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

  // --- generic remote access (mock) ---
  private remote: RemoteAccessStatus = { kind: 'none', running: false, address: null, detail: 'off' };

  async remoteUp(cfg: RemoteAccessConfig): Promise<ActionResult> {
    if (cfg.kind === 'tailscale') {
      const r = await this.tailscaleUp(cfg.tailscaleAuthKey ?? undefined);
      this.remote = { kind: 'tailscale', running: this.tailscale.running, address: this.tailscale.ip, detail: this.tailscale.backendState, loginUrl: r.loginUrl ?? null };
      return r;
    }
    if (cfg.kind === 'zerotier') {
      if (!cfg.zerotierNetworkId) return { ok: false, message: 'ZeroTier network ID required.' };
      this.remote = { kind: 'zerotier', running: true, address: '10.147.20.42', detail: `joined ${cfg.zerotierNetworkId}`, loginUrl: null };
      return { ok: true, message: `Joined ZeroTier network ${cfg.zerotierNetworkId} (simulated).` };
    }
    if (cfg.kind === 'wireguard') {
      if (!cfg.wireguardConf) return { ok: false, message: 'Upload a WireGuard .conf first.' };
      this.remote = { kind: 'wireguard', running: true, address: '192.168.178.120', detail: 'handshake ok', loginUrl: null };
      return { ok: true, message: 'WireGuard up (simulated).' };
    }
    this.remote = { kind: 'none', running: false, address: null, detail: 'off' };
    return { ok: true, message: 'Remote access off.' };
  }

  async remoteDown(cfg: RemoteAccessConfig): Promise<ActionResult> {
    if (cfg.kind === 'tailscale') await this.tailscaleDown();
    this.remote = { kind: cfg.kind, running: false, address: null, detail: 'stopped' };
    return { ok: true, message: 'Remote access stopped (simulated).' };
  }

  async remoteStatus(cfg: RemoteAccessConfig): Promise<RemoteAccessStatus> {
    if (cfg.kind === 'tailscale') {
      return { kind: 'tailscale', running: this.tailscale.running, address: this.tailscale.ip, detail: this.tailscale.backendState, loginUrl: this.tailscale.loginUrl };
    }
    // Reflect the last mock action if it matches the requested kind, else "off".
    return this.remote.kind === cfg.kind ? { ...this.remote } : { kind: cfg.kind, running: false, address: null, detail: 'off' };
  }

  async reboot(): Promise<ActionResult> {
    return { ok: true, message: 'Reboot requested (simulated — no-op).' };
  }
}
