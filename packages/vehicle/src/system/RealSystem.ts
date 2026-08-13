import { exec, execFile } from 'node:child_process';
import { hostname } from 'node:os';
import { promisify } from 'node:util';
import type {
  ActionResult,
  LteStatus,
  SystemManager,
  SystemStatus,
  TailscaleStatus,
  WifiStatus,
} from './SystemManager.js';

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
    const list = await sh('mmcli -L');
    const empty: LteStatus = {
      present: false,
      connected: false,
      operator: null,
      signal: null,
      apn: null,
      iface: null,
      ip: null,
    };
    if (!list.ok || !/Modem\/\d+/.test(list.out)) return empty;
    const m = list.out.match(/Modem\/(\d+)/);
    if (!m) return empty;
    const info = await sh(`mmcli -m ${m[1]}`);
    const operator = info.out.match(/operator name:\s*'?([^'\n]+)'?/i)?.[1]?.trim() ?? null;
    const signalStr = info.out.match(/signal quality:\s*'?(\d+)/i)?.[1];
    const state = info.out.match(/state:\s*'?(\w+)/i)?.[1] ?? '';
    return {
      present: true,
      connected: /connected/i.test(state),
      operator,
      signal: signalStr ? Number(signalStr) : null,
      apn: null,
      iface: 'wwan0',
      ip: null,
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

  async lteConnect(apn: string): Promise<ActionResult> {
    // Create/activate an NM GSM connection for the modem. execFile (no shell) so
    // the APN can't inject commands even with quotes/semicolons in it.
    const del = await shArgs('nmcli', ['connection', 'delete', 'yonderrc-lte']);
    void del; // ignore if it didn't exist
    const add = await shArgs('nmcli', [
      'connection', 'add', 'type', 'gsm', 'ifname', '*',
      'con-name', 'yonderrc-lte', 'apn', apn,
    ]);
    if (!add.ok) return { ok: false, message: `nmcli add failed: ${add.out}` };
    const up = await shArgs('nmcli', ['connection', 'up', 'yonderrc-lte']);
    return up.ok
      ? { ok: true, message: `LTE connecting on APN "${apn}".` }
      : { ok: false, message: `nmcli up failed: ${up.out}` };
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

  async reboot(): Promise<ActionResult> {
    void sh('sudo reboot'); // fire and forget
    return { ok: true, message: 'Rebooting…' };
  }
}
