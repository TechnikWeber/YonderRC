import { hostname } from 'node:os';
import type {
  ActionResult,
  HotspotResult,
  UpdateResult,
  HwDepInstallResult,
  HwDepStatus,
  LteConfig,
  LtePinChange,
  LteStatus,
  RemoteAccessConfig,
  RemoteAccessStatus,
  SystemManager,
  SystemStatus,
  TailscaleStatus,
  WifiStatus,
  WifiNetwork,
  HotspotConfig,
  CameraModuleStatus,
} from './SystemManager.js';
import { HW_DEPS, explainNpmFailure, isHwDep, lastLines, type HwDepName } from './hwDeps.js';
import { powerState } from './power.js';
import {
  applyCameraModule,
  moduleById,
  moduleIdFor,
  parseBootConfig,
  validOverlayName,
  bootedStateChanged,
} from './bootConfig.js';
import { HOTSPOT_ADDRESS, isCountryCode, radioIsUsable, type WifiRadioStatus } from './wifi.js';
import { type HilinkStatus } from './hilink.js';
import { classifyChanges, describeCheck, type UpdateCheck } from './update.js';

/**
 * Mock system: pretends to have an LTE modem and Tailscale so the entire setup
 * flow can be exercised without a Pi. State transitions mimic the real thing
 * (connect → connected, tailscale up → login URL then running).
 */
export class SimSystem implements SystemManager {
  readonly kind = 'sim';
  private lte: LteStatus = {
    kind: 'modemmanager',
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
  /** Mock neighbourhood, so the WiFi panel is fully usable without a Pi. */
  private networks: WifiNetwork[] = [
    { ssid: 'Weber-Home', signal: 88, secured: true, active: false },
    { ssid: 'Weber-Home-5G', signal: 74, secured: true, active: false },
    { ssid: 'FRITZ!Box 7590', signal: 51, secured: true, active: false },
    { ssid: 'Gastnetz', signal: 33, secured: false, active: false },
  ];

  /** Raw throttle mask the simulator reports; 0 = a healthy rail. Settable for demos. */
  private simThrottled = 0;
  setSimThrottled(mask: number): void {
    this.simThrottled = mask;
  }

  async status(): Promise<SystemStatus> {
    return {
      kind: this.kind,
      hostname: hostname(),
      tailscale: { ...this.tailscale },
      lte: { ...this.lte },
      wifi: { ...this.wifi },
      // A simulated Pi has a perfect supply. `simPower` lets the panel be exercised.
      power: powerState(this.simThrottled),
    };
  }

  async wifiScan(): Promise<WifiNetwork[]> {
    return this.networks.map((n) => ({ ...n, active: n.ssid === this.wifi.ssid && this.wifi.mode === 'client' }));
  }

  async wifiConnect(ssid: string, password: string | null): Promise<ActionResult> {
    const net = this.networks.find((n) => n.ssid === ssid);
    if (net?.secured && !password) {
      return { ok: false, message: `"${ssid}" needs a password.` };
    }
    this.wifi = { mode: 'client', ssid, ip: '192.168.178.42' };
    return { ok: true, message: `Connected to "${ssid}" — 192.168.178.42 (simulated). The hotspot is closing.` };
  }

  /** Mock radio: healthy, but "enable" still works so the UI flow is exercisable. */
  private radio: WifiRadioStatus = {
    device: 'ready',
    softBlocked: false,
    hardBlocked: false,
    country: 'DE',
    suggestedCountry: 'DE',
  };

  /** Kept only so the sim honours the same interface as the real system. */
  setHilinkHost(_host: string): void {}

  /** A plausible stick, so the panel and the OSD label can be seen without hardware. */
  async hilinkStatus(_opts: { force?: boolean } = {}): Promise<HilinkStatus> {
    return {
      present: true,
      iface: 'eth1',
      connected: true,
      state: 'connected',
      networkType: '4G (LTE)',
      operator: 'SimTel',
      signalPercent: 72,
      rsrp: -93,
      rsrq: -9,
      sinr: 12,
      model: 'E3372h-320 (simulated)',
      wanIp: '10.64.12.34',
      message: null,
    };
  }

  async wifiRadio(): Promise<WifiRadioStatus> {
    return { ...this.radio };
  }

  async wifiRadioEnable(country?: string | null): Promise<ActionResult & { radio: WifiRadioStatus }> {
    if (country != null && country !== '' && !isCountryCode(country)) {
      return { ok: false, message: `"${country}" is not a two-letter country code.`, radio: { ...this.radio } };
    }
    if (country) this.radio.country = country.toUpperCase();
    this.radio = { ...this.radio, device: 'ready', softBlocked: false, hardBlocked: false };
    return { ok: true, message: `WiFi radio enabled${country ? `, country ${this.radio.country}` : ''} (simulated).`, radio: { ...this.radio } };
  }

  async hotspotStart(cfg: HotspotConfig): Promise<HotspotResult> {
    if (!radioIsUsable(this.radio)) {
      return { ok: false, message: 'Hotspot not started — the WiFi radio is blocked (simulated).', fix: 'Press “Enable WiFi radio”.', radio: { ...this.radio } };
    }
    this.wifi = { mode: 'ap', ssid: cfg.ssid, ip: HOTSPOT_ADDRESS };
    const psk = cfg.password && cfg.password.length >= 8 ? cfg.password : null;
    return {
      ok: true,
      message: `Hotspot "${cfg.ssid}" is up (${psk ? `WPA2, key ${psk}` : 'open'}) — join it and open http://${HOTSPOT_ADDRESS}:8080/ (simulated).`,
      psk,
      radio: { ...this.radio },
    };
  }

  async hotspotStop(): Promise<ActionResult> {
    this.wifi = { mode: 'unknown', ssid: null, ip: null };
    return { ok: true, message: 'Hotspot stopped (simulated).' };
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

  async linkSignal() {
    if (this.lte.connected && this.lte.signal != null) {
      return { kind: 'lte' as const, quality: this.lte.signal, label: `LTE ${this.lte.signal}%` };
    }
    return { kind: 'wifi' as const, quality: 82, label: 'WiFi −52 dBm' };
  }

  async detectHardware() {
    return {
      i2c: [
        { address: '0x40', hint: 'PCA9685 servo/ESC driver — or INA2xx current sensor (219/226/228/237/238)' },
        { address: '0x41', hint: 'INA2xx current sensor (219/226/228/237/238/3221)' },
      ],
      modemPresent: this.lte.present,
      cameras: ['/dev/video0 (simulated)'],
      serial: ['/dev/ttyAMA0 (simulated)'],
      notes: ['Simulated detection — real probe runs on the Pi.'],
    };
  }

  /** Mock state: nothing installed until the setup UI "installs" it. */
  private installedDeps = new Set<HwDepName>();

  async hwDeps(): Promise<HwDepStatus[]> {
    return HW_DEPS.map((d) => ({
      name: d.name,
      installed: this.installedDeps.has(d.name),
      version: this.installedDeps.has(d.name) ? '0.0.0-sim' : null,
      needFor: d.needFor,
    }));
  }

  /**
   * Simulated install. `pigpio` deliberately fails with a realistic node-gyp log:
   * it is the module that genuinely needs a separate C library, and it means the
   * whole error path (cause, fix, log tail) can be seen on a dev machine instead
   * of first appearing on a Pi in a field.
   */
  async hwDepInstall(name: HwDepName): Promise<HwDepInstallResult> {
    if (!isHwDep(name)) return { ok: false, message: `Refused: "${String(name)}" is not a known driver module.`, output: '' };
    if (name === 'pigpio') {
      const log = [
        'npm error code 1',
        'npm error path /opt/yonderrc/node_modules/pigpio',
        'npm error command sh -c node-gyp rebuild',
        'npm error gyp info spawn make',
        'npm error ../src/pigpio.cc:5:10: fatal error: pigpio.h: No such file or directory',
        'npm error    5 | #include <pigpio.h>',
        'npm error      |          ^~~~~~~~~~',
        'npm error compilation terminated.',
        'npm error make: *** [pigpio.o] Error 1',
      ].join('\n');
      const f = explainNpmFailure(log, { dep: name });
      return {
        ok: false,
        message: `Could not install ${name} — ${f.cause}. (Simulated: the sim system reproduces this failure so the error path is visible without a Pi.)`,
        fix: f.fix,
        output: lastLines(log),
      };
    }
    this.installedDeps.add(name);
    return {
      ok: true,
      message: `${name} installed (simulated) — restart the vehicle service to use it.`,
      output: `added 1 package in 12s (simulated)`,
      restartRequired: true,
    };
  }

  async restartService(): Promise<ActionResult> {
    return { ok: true, message: 'Vehicle service restart requested (simulated — no-op).' };
  }

  /** A pretend update, so the panel and both outcomes can be tried without a Pi. */
  private simBehind = 2;

  async updateCheck(_src?: unknown): Promise<UpdateCheck> {
    const impact = classifyChanges(this.simBehind ? ['packages/vehicle/src/index.ts', 'packages/ground/src/App.tsx'] : []);
    const base = {
      ok: true,
      current: '1.0.0-sim',
      available: this.simBehind ? '1.0.1-sim' : '1.0.0-sim',
      behind: this.simBehind,
      commits: this.simBehind
        ? [
            { hash: 'a1b2c3d', subject: 'v1.0.1-sim — simulated change' },
            { hash: 'e4f5a6b', subject: 'docs: simulated note' },
          ].slice(0, this.simBehind)
        : [],
      impact,
      tree: { clean: true, dirty: [], generated: [] },
      conflicts: [],
    };
    return { ...base, ...describeCheck(base) };
  }

  async updateApply(_src?: unknown, _hardwareDeps?: string[]): Promise<UpdateResult> {
    if (!this.simBehind) return { ok: true, message: 'Up to date (simulated).', output: '', steps: [] };
    this.simBehind = 0;
    return {
      ok: true,
      message: 'Updated to v1.0.1-sim — restarting now (simulated).',
      output: '$ git pull --ff-only origin main\nFast-forward (simulated)',
      steps: [
        { label: 'Fetching and applying the update', ok: true },
        { label: 'Rebuilding the control app', ok: true },
      ],
      restarting: true,
    };
  }

  /**
   * A config.txt the simulator can edit, so the camera-module panel is fully usable
   * without a Pi — including the "reboot required" state, which clears on a simulated
   * reboot the same way a real one clears it.
   */
  private bootConfig = ['# Simulated Raspberry Pi firmware config', 'camera_auto_detect=1', ''].join('\n');
  /** What the simulated system "booted" with — a simulated reboot catches this up. */
  private bootedConfig = this.bootConfig;

  async cameraModule(): Promise<CameraModuleStatus> {
    const state = parseBootConfig(this.bootConfig);
    return {
      available: true,
      configPath: '(simulated) /boot/firmware/config.txt',
      moduleId: moduleIdFor(state),
      overlay: state.overlay,
      autoDetect: state.autoDetect,
      rebootRequired: bootedStateChanged(parseBootConfig(this.bootedConfig), state),
      message: null,
    };
  }

  async setCameraModule(id: string, customOverlay?: string | null): Promise<ActionResult & { rebootRequired: boolean }> {
    const mod = moduleById(id);
    if (!mod) return { ok: false, message: `Unknown camera module "${id}".`, rebootRequired: false };
    let overlay = mod.overlay;
    if (id === 'custom') {
      // Same syntax gate as the real system — an unvalidated name would be a genuine
      // config.txt injection there, so the simulator must not pretend it is fine.
      const want = (customOverlay ?? '').trim();
      if (!validOverlayName(want)) {
        return { ok: false, message: `"${want}" is not a valid overlay name.`, rebootRequired: (await this.cameraModule()).rebootRequired };
      }
      overlay = want;
    }
    this.bootConfig = applyCameraModule(this.bootConfig, overlay);
    const pending = (await this.cameraModule()).rebootRequired;
    return {
      ok: true,
      message: pending
        ? `${mod.label} selected (simulated). Reboot to apply.`
        : `${mod.label} selected — that is what the Pi already booted with, so no reboot is needed.`,
      rebootRequired: pending,
    };
  }

  async reboot(): Promise<ActionResult> {
    this.bootedConfig = this.bootConfig;
    return { ok: true, message: 'Reboot requested (simulated — no-op).' };
  }

  async shutdown(): Promise<ActionResult> {
    return { ok: true, message: 'Shutdown requested (simulated — no-op).' };
  }
}
