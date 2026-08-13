import { exec, execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
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
import { normaliseWireguardConf } from './SystemManager.js';
import { parseModemId, parseModemInfo, parseSimId, lteStateLabel } from './lte.js';
import { parseWifiSignalDbm, dbmToQualityPct } from './signal.js';
import { parseI2cAddresses, suggestI2c } from './detect.js';

const run = promisify(exec);
const runFile = promisify(execFile);

/** Shell helper — ONLY for static commands (pipes/grep). Never pass user input. */
async function sh(cmd: string): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run(cmd, { timeout: 15000 });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: (err as { stderr?: string }).stderr ?? String(err) };
  }
}

/**
 * No-shell exec: the program and each argument are passed directly to the OS, so
 * user-supplied values (APN, Tailscale auth key) can NEVER be interpreted as
 * shell syntax. Use this for anything that carries operator input.
 */
async function shArgs(file: string, args: string[]): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await runFile(file, args, { timeout: 15000 });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: (err as { stderr?: string }).stderr ?? String(err) };
  }
}

/**
 * Real system control on Raspberry Pi OS. Uses:
 *  - tailscale CLI for the mesh VPN
 *  - ModemManager (mmcli) + NetworkManager (nmcli) for the USB LTE stick
 *  - nmcli for WiFi mode
 * Each call degrades gracefully if a tool is missing, so a half-provisioned Pi
 * still serves a useful status page rather than crashing.
 */
export class RealSystem implements SystemManager {
  readonly kind = 'real';

  async status(): Promise<SystemStatus> {
    const [ts, lte, wifi] = await Promise.all([
      this.tailscaleStatus(),
      this.lteStatus(),
      this.wifiStatus(),
    ]);
    return { kind: this.kind, hostname: hostname(), tailscale: ts, lte, wifi };
  }

  private async tailscaleStatus(): Promise<TailscaleStatus> {
    const ver = await sh('tailscale version');
    if (!ver.ok) {
      return { installed: false, running: false, ip: null, loginUrl: null, backendState: 'NotInstalled' };
    }
    const json = await sh('tailscale status --json');
    let backendState = 'Unknown';
    let running = false;
    if (json.ok) {
      try {
        const s = JSON.parse(json.out) as { BackendState?: string };
        backendState = s.BackendState ?? 'Unknown';
        running = backendState === 'Running';
      } catch {
        /* ignore */
      }
    }
    const ip = await sh('tailscale ip -4');
    return {
      installed: true,
      running,
      ip: ip.ok ? ip.out.split('\n')[0] || null : null,
      loginUrl: null,
      backendState,
    };
  }

  private async lteStatus(): Promise<LteStatus> {
    const empty: LteStatus = {
      present: false, connected: false, operator: null, signal: null,
      apn: null, iface: null, ip: null, state: 'no-modem', modemModel: null, pinRequired: false,
    };
    const list = await sh('mmcli -L');
    const id = list.ok ? parseModemId(list.out) : null;
    if (!id) return empty;

    const info = await sh(`mmcli -m ${id}`);
    const parsed = parseModemInfo(info.out);
    const hasSim = !/SIM\s*\|\s*primary sim path:\s*none/i.test(info.out) && !/sim-missing/i.test(info.out);

    // Pull the live APN/iface/IP from our NM connection when it's up.
    const nm = await sh("nmcli -t -f GENERAL.STATE,IP4.ADDRESS,connection.id connection show yonderrc-lte");
    const apn = (await sh("nmcli -t -f gsm.apn connection show yonderrc-lte")).out.split(':')[1]?.trim() || null;
    const ip = nm.out.match(/IP4\.ADDRESS\[1]:\s*([\d.]+)/)?.[1] ?? null;
    const iface = (await sh("nmcli -t -f connection.interface-name connection show yonderrc-lte")).out.split(':')[1]?.trim() || 'wwan0';

    return {
      present: true,
      connected: parsed.state === 'connected',
      operator: parsed.operator,
      signal: parsed.signal,
      apn,
      iface,
      ip,
      state: lteStateLabel(parsed, hasSim),
      modemModel: parsed.model,
      pinRequired: parsed.pinRequired,
    };
  }

  private async wifiStatus(): Promise<WifiStatus> {
    const mode = await sh("nmcli -t -f DEVICE,TYPE,STATE device | grep ':wifi:' | head -1");
    const ssid = await sh("nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2");
    const ip = await sh("nmcli -t -f IP4.ADDRESS dev show wlan0 | head -1 | cut -d: -f2");
    return {
      mode: mode.out.includes('connected') ? 'client' : 'unknown',
      ssid: ssid.ok ? ssid.out || null : null,
      ip: ip.ok ? (ip.out.split('/')[0] || null) : null,
    };
  }

  async lteConnect(cfg: LteConfig): Promise<ActionResult> {
    const apn = cfg.apn ?? '';
    const modemId = parseModemId((await sh('mmcli -L')).out);
    // 1) Unlock the SIM first if a PIN is configured (no shell → PIN can't inject).
    if (cfg.pin && modemId) {
      const unlock = await shArgs('sudo', ['mmcli', '-m', modemId, `--pin=${cfg.pin}`]);
      if (!unlock.ok && /incorrect|failure|error/i.test(unlock.out)) {
        return { ok: false, message: `SIM PIN rejected: ${unlock.out}` };
      }
    }
    // 2) Force the radio mode if requested (4g-only lowers latency where LTE exists).
    if (cfg.networkMode && cfg.networkMode !== 'auto' && modemId) {
      await shArgs('sudo', ['mmcli', '-m', modemId, `--set-allowed-modes=${cfg.networkMode}`]);
    }
    // 3) (Re)create the NM GSM connection. execFile (no shell) so APN/user/password
    //    can't be interpreted as shell syntax. autoconnect=yes so NM redials itself.
    await shArgs('nmcli', ['connection', 'delete', 'yonderrc-lte']); // ignore if absent
    const args = [
      'connection', 'add', 'type', 'gsm', 'ifname', '*', 'con-name', 'yonderrc-lte',
      'connection.autoconnect', 'yes', 'gsm.apn', apn,
      'gsm.home-only', cfg.allowRoaming === false ? 'yes' : 'no',
    ];
    if (cfg.username) args.push('gsm.username', cfg.username);
    if (cfg.password) args.push('gsm.password', cfg.password);
    const add = await shArgs('nmcli', args);
    if (!add.ok) return { ok: false, message: `nmcli add failed: ${add.out}` };
    const up = await shArgs('nmcli', ['connection', 'up', 'yonderrc-lte']);
    return up.ok
      ? { ok: true, message: `LTE connecting on APN "${apn}"${cfg.username ? ' (with auth)' : ''}${cfg.networkMode && cfg.networkMode !== 'auto' ? ` [${cfg.networkMode}]` : ''}.` }
      : { ok: false, message: `nmcli up failed: ${up.out}` };
  }

  async lteSetPin(change: LtePinChange): Promise<ActionResult> {
    const modemId = parseModemId((await sh('mmcli -L')).out);
    if (!modemId) return { ok: false, message: 'No modem found.' };
    const simId = parseSimId((await sh(`mmcli -m ${modemId}`)).out) ?? '0';
    // mmcli operates on the SIM object; current PIN is required for both actions.
    const base = ['mmcli', '-i', simId, `--pin=${change.currentPin}`];
    const args =
      change.action === 'disable'
        ? [...base, '--disable-pin']
        : [...base, `--change-pin=${change.newPin ?? ''}`];
    const r = await shArgs('sudo', args);
    if (!r.ok) return { ok: false, message: `PIN ${change.action} failed: ${r.out}` };
    return { ok: true, message: change.action === 'disable' ? 'SIM PIN lock removed.' : 'SIM PIN changed.' };
  }

  async lteDiagnostics(): Promise<{ ok: boolean; output: string }> {
    const list = await sh('mmcli -L');
    const id = parseModemId(list.out);
    if (!id) return { ok: false, output: `mmcli -L:\n${list.out || '(no output — is ModemManager running / dongle plugged in?)'}` };
    const info = await sh(`mmcli -m ${id}`);
    return { ok: true, output: `mmcli -L:\n${list.out}\n\nmmcli -m ${id}:\n${info.out}` };
  }

  async lteDisconnect(): Promise<ActionResult> {
    const down = await shArgs('nmcli', ['connection', 'down', 'yonderrc-lte']);
    return { ok: down.ok, message: down.ok ? 'LTE disconnected.' : down.out };
  }

  async tailscaleUp(authKey?: string): Promise<ActionResult> {
    if (authKey) {
      // execFile (no shell): the auth key is a literal argument, never parsed by a shell.
      const r = await shArgs('tailscale', ['up', `--authkey=${authKey}`, '--hostname=yonderrc']);
      return r.ok
        ? { ok: true, message: 'Tailscale up.' }
        : { ok: false, message: r.out };
    }
    // Interactive: parse the login URL tailscale prints. Run detached so it
    // doesn't block waiting for auth.
    const r = await sh('tailscale up --hostname=yonderrc --timeout=1s 2>&1 || true');
    const url = r.out.match(/https:\/\/login\.tailscale\.com\/\S+/)?.[0] ?? null;
    return url
      ? { ok: true, message: 'Open the login URL to finish.', loginUrl: url }
      : { ok: true, message: 'Tailscale is starting; check status.' };
  }

  async tailscaleDown(): Promise<ActionResult> {
    const r = await sh('tailscale down');
    return { ok: r.ok, message: r.ok ? 'Tailscale stopped.' : r.out };
  }

  // --- generic remote access (dispatch by kind) ---
  private readonly wgIface = 'yonderrc';
  private readonly wgConfPath = '/etc/wireguard/yonderrc.conf';

  async remoteUp(cfg: RemoteAccessConfig): Promise<ActionResult> {
    if (cfg.kind === 'tailscale') return this.tailscaleUp(cfg.tailscaleAuthKey ?? undefined);
    if (cfg.kind === 'zerotier') {
      if (!cfg.zerotierNetworkId) return { ok: false, message: 'ZeroTier network ID required.' };
      const r = await shArgs('sudo', ['zerotier-cli', 'join', cfg.zerotierNetworkId]);
      return r.ok
        ? { ok: true, message: `Joined ZeroTier ${cfg.zerotierNetworkId}. Authorize the node in your ZeroTier Central.` }
        : { ok: false, message: `zerotier join failed: ${r.out}` };
    }
    if (cfg.kind === 'wireguard') {
      if (!cfg.wireguardConf) return { ok: false, message: 'Upload a WireGuard .conf first.' };
      try {
        // Write to a temp file we can create as a normal user, then install it to
        // /etc/wireguard with root perms (no shell, so the conf can't inject).
        const tmp = join(tmpdir(), 'yonderrc-wg.conf');
        writeFileSync(tmp, normaliseWireguardConf(cfg.wireguardConf), { mode: 0o600 });
        const cp = await shArgs('sudo', ['install', '-m', '600', tmp, this.wgConfPath]);
        if (!cp.ok) return { ok: false, message: `could not install WireGuard conf: ${cp.out}` };
      } catch (e) {
        return { ok: false, message: `write failed: ${(e as Error).message}` };
      }
      await shArgs('sudo', ['wg-quick', 'down', this.wgIface]); // ignore if it wasn't up
      const up = await shArgs('sudo', ['wg-quick', 'up', this.wgIface]);
      return up.ok ? { ok: true, message: 'WireGuard up.' } : { ok: false, message: `wg-quick up failed: ${up.out}` };
    }
    return { ok: true, message: 'Remote access off.' };
  }

  async remoteDown(cfg: RemoteAccessConfig): Promise<ActionResult> {
    if (cfg.kind === 'tailscale') return this.tailscaleDown();
    if (cfg.kind === 'zerotier') {
      if (cfg.zerotierNetworkId) await shArgs('sudo', ['zerotier-cli', 'leave', cfg.zerotierNetworkId]);
      return { ok: true, message: 'Left ZeroTier network.' };
    }
    if (cfg.kind === 'wireguard') {
      const r = await shArgs('sudo', ['wg-quick', 'down', this.wgIface]);
      return { ok: r.ok, message: r.ok ? 'WireGuard down.' : r.out };
    }
    return { ok: true, message: 'Remote access off.' };
  }

  async remoteStatus(cfg: RemoteAccessConfig): Promise<RemoteAccessStatus> {
    if (cfg.kind === 'tailscale') {
      const t = await this.tailscaleStatus();
      return { kind: 'tailscale', running: t.running, address: t.ip, detail: t.backendState, loginUrl: t.loginUrl };
    }
    if (cfg.kind === 'zerotier') {
      const j = await shArgs('sudo', ['zerotier-cli', '-j', 'listnetworks']);
      if (!j.ok) return { kind: 'zerotier', running: false, address: null, detail: 'zerotier-cli not available' };
      try {
        const nets = JSON.parse(j.out) as Array<{ nwid?: string; id?: string; status?: string; assignedAddresses?: string[] }>;
        const net = nets.find((n) => (n.nwid || n.id) === cfg.zerotierNetworkId) ?? nets[0];
        const addr = net?.assignedAddresses?.[0]?.split('/')[0] ?? null;
        return { kind: 'zerotier', running: net?.status === 'OK', address: addr, detail: net?.status ?? 'unknown' };
      } catch {
        return { kind: 'zerotier', running: false, address: null, detail: 'parse error' };
      }
    }
    if (cfg.kind === 'wireguard') {
      const w = await shArgs('sudo', ['wg', 'show', this.wgIface, 'latest-handshakes']);
      if (!w.ok) return { kind: 'wireguard', running: false, address: null, detail: 'not up' };
      const now = Date.now() / 1000;
      const running = w.out.split('\n').some((l) => {
        const ts = Number(l.trim().split(/\s+/)[1]);
        return ts > 0 && now - ts < 180; // a handshake within 3 min = live
      });
      const addr = await shArgs('ip', ['-4', '-o', 'addr', 'show', 'dev', this.wgIface]);
      const ip = addr.ok ? addr.out.match(/inet (\d+\.\d+\.\d+\.\d+)/)?.[1] ?? null : null;
      return { kind: 'wireguard', running, address: ip, detail: running ? 'handshake ok' : 'no recent handshake' };
    }
    return { kind: 'none', running: false, address: null, detail: 'off' };
  }

  async linkSignal() {
    // Prefer LTE when the modem is connected; otherwise read the WiFi RSSI.
    const lte = await this.lteStatus();
    if (lte.connected && lte.signal != null) {
      return { kind: 'lte' as const, quality: lte.signal, label: `LTE ${lte.signal}%` };
    }
    const iw = await sh('iw dev wlan0 link');
    const dbm = parseWifiSignalDbm(iw.out);
    if (dbm != null) {
      return { kind: 'wifi' as const, quality: dbmToQualityPct(dbm), label: `WiFi ${dbm} dBm` };
    }
    return { kind: 'none' as const, quality: null, label: '—' };
  }

  async detectHardware() {
    const notes: string[] = [];
    const i2cOut = await sh('i2cdetect -y 1');
    if (!i2cOut.ok) notes.push('i2cdetect failed — is i2c-tools installed and I²C enabled?');
    const i2c = suggestI2c(parseI2cAddresses(i2cOut.out));
    if (i2cOut.ok && i2c.length === 0) notes.push('No I²C devices found on bus 1 — check wiring/power.');

    const modemPresent = /Modem\/\d+/.test((await sh('mmcli -L')).out);
    if (!modemPresent) notes.push('No LTE modem detected (mmcli -L).');

    // Prefer libcamera (CSI) names; fall back to V4L2 /dev/video* nodes.
    const cams: string[] = [];
    const lc = await sh('libcamera-hello --list-cameras -t 1 2>/dev/null');
    for (const m of lc.out.matchAll(/^\s*\d+\s*:\s*(.+)$/gm)) cams.push(m[1].trim());
    if (cams.length === 0) {
      const v4l = await sh('ls /dev/video* 2>/dev/null');
      for (const d of v4l.out.split(/\s+/)) if (d.startsWith('/dev/video')) cams.push(d);
    }
    if (cams.length === 0) notes.push('No cameras detected (libcamera / /dev/video*).');

    // Serial candidates for a GPS receiver.
    const serial: string[] = [];
    const ser = await sh('ls /dev/ttyAMA0 /dev/ttyUSB* /dev/ttyACM* /dev/serial0 2>/dev/null');
    for (const d of ser.out.split(/\s+/)) if (d.startsWith('/dev/')) serial.push(d);
    if ((await sh('systemctl is-active gpsd')).out.trim() === 'active') notes.push('gpsd is running — you can use the "gpsd" GPS source.');

    return { i2c, modemPresent, cameras: cams, serial, notes };
  }

  async reboot(): Promise<ActionResult> {
    void sh('sudo reboot'); // fire and forget
    return { ok: true, message: 'Rebooting…' };
  }
}
