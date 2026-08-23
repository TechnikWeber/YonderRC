import { exec, execFile, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { hostname, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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
import { normaliseWireguardConf, parseWifiScan, HOTSPOT_DEFAULTS } from './SystemManager.js';
import {
  explainWifiFailure,
  guessWifiCountry,
  captivePortalConf,
  hotspotCommands,
  hotspotPskArgs,
  shouldHijackDns,
  CAPTIVE_CONF_PATH,
  isCountryCode,
  parseLocaleFile,
  parseRfkill,
  parseWifiCountry,
  parseWifiDeviceState,
  parseWifiMode,
  radioIsUsable,
  wifiCountryArgs,
  HOTSPOT_ADDRESS,
  type WifiRadioStatus,
} from './wifi.js';
import { parseModemId, parseModemInfo, parseSimId, lteStateLabel } from './lte.js';
import { parseWifiSignalDbm, dbmToQualityPct } from './signal.js';
import { parseI2cAddresses, suggestI2c } from './detect.js';
import { parseTailscaleStatus } from './tailscale.js';
import {
  classifyChanges,
  describeCheck,
  gitArgs,
  safeDirectoryConfig,
  UPDATE_SOURCE_DEFAULT,
  type UpdateSource,
  parseCommits,
  parseVersion,
  parseWorkingTree,
  updateSteps,
  type UpdateCheck,
} from './update.js';
import {
  readHilink,
  parseRouteDev,
  isIpv4,
  hilinkAsLte,
  hilinkOsdLabel,
  HILINK_ABSENT,
  HILINK_DEFAULT_HOST,
  type HilinkGet,
  type HilinkStatus,
} from './hilink.js';
import { HW_DEPS, errorExcerpt, explainNpmFailure, hwDepInfo, isHwDep, lastLines, npmInstallArgs, type HwDepName } from './hwDeps.js';
import { parseCameraList, captureNodes, explainNoCamera } from './cameras.js';
import {
  applyCameraModule,
  explainBootConfig,
  moduleById,
  moduleIdFor,
  parseBootConfig,
  recordIsCurrent,
  bootedStateChanged,
  type CameraBootRecord,
  validOverlayName,
  overlayBaseName,
} from './bootConfig.js';

const run = promisify(exec);
const runFile = promisify(execFile);

/** Shell helper — ONLY for static commands (pipes/grep). Never pass user input. */
/** The Pi's built-in WiFi. Same assumption as the signal readout. */
const WIFI_IFACE = 'wlan0';

/**
 * Every command we parse runs in the C locale. git, nmcli and friends translate
 * their messages, and a Pi with a German locale would answer "Schwerwiegend: Kein
 * Git-Repository" — which no pattern here matches. Forcing it keeps the output the
 * one this code was written against, on any vehicle.
 */
const C_LOCALE = { ...process.env, LC_ALL: 'C', LANG: 'C' };

/** What the running system booted with, so a pending reboot can be detected exactly. */
const BOOT_RECORD_FILE = '/var/lib/yonderrc/camera-module.json';

async function sh(cmd: string): Promise<{ ok: boolean; out: string }> {
  try {
    const { stdout } = await run(cmd, { timeout: 15000, env: C_LOCALE });
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
    const { stdout } = await runFile(file, args, { timeout: 15000, env: C_LOCALE });
    return { ok: true, out: stdout.trim() };
  } catch (err) {
    return { ok: false, out: (err as { stderr?: string }).stderr ?? String(err) };
  }
}

/**
 * Environment for git. The installer clones as `pi`, the service runs as root, and
 * git then refuses the checkout as "dubious ownership". The exception is only
 * honoured from PROTECTED config — system or global — so `-c safe.directory=…` on
 * the command line does nothing (it looked fine on a newer git and changed nothing
 * on the Pi). Handing git a global config file of our own is honoured, needs no
 * `$HOME`, and leaves nothing behind but a file in /tmp.
 */
function gitEnv(repoRoot: string): { env: NodeJS.ProcessEnv; note: string } {
  const file = join(tmpdir(), 'yonderrc-gitconfig');
  try {
    writeFileSync(file, safeDirectoryConfig(repoRoot));
    return { env: { ...C_LOCALE, GIT_CONFIG_GLOBAL: file }, note: `declared "${repoRoot}" safe via ${file}` };
  } catch (err) {
    return { env: { ...C_LOCALE }, note: `could not write ${file} (${(err as Error).message})` };
  }
}

/** Read a file, or '' when it isn't there — used for version lookups. */
function readFileSafe(path: string): string {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return '';
  }
}

/** The repo checkout (…/packages/vehicle/src/system → repo root), where npm must run. */
// resolve() strips the trailing slash the URL form leaves behind — git compares
// safe.directory literally, so "/opt/yonderrc/" is not "/opt/yonderrc".
const REPO_ROOT = resolve(fileURLToPath(new URL('../../../../', import.meta.url)));
/** Resolves from the vehicle package, i.e. through the workspace's node_modules. */
const requireFrom = createRequire(import.meta.url);

/**
 * execFile for SLOW jobs (npm + node-gyp): minutes instead of seconds, a buffer
 * big enough for a full compiler log, and stderr kept — npm writes nearly all of
 * its diagnostics there, and throwing that away is what makes an install failure
 * unreadable.
 */
async function shSlow(
  file: string,
  args: string[],
  opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv },
): Promise<{ ok: boolean; out: string; timedOut: boolean }> {
  try {
    const { stdout, stderr } = await runFile(file, args, {
      cwd: opts.cwd,
      timeout: opts.timeoutMs,
      maxBuffer: 8 * 1024 * 1024,
      env: opts.env ?? C_LOCALE,
    });
    return { ok: true, out: [stdout, stderr].filter(Boolean).join('\n').trim(), timedOut: false };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; message?: string };
    const out = [e.stdout, e.stderr].filter(Boolean).join('\n').trim();
    return { ok: false, out: out || e.message || String(err), timedOut: !!e.killed };
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
    const [ts, mm, wifi] = await Promise.all([
      this.tailscaleStatus(),
      this.lteStatus(),
      this.wifiStatus(),
    ]);
    // No ModemManager modem doesn't mean no LTE: a HiLink stick dials on its own and
    // is invisible to mmcli. Reporting "no modem" next to a working uplink is just
    // wrong, so the stick fills the LTE row when there is no real modem.
    const lte = mm.present ? { ...mm, kind: 'modemmanager' as const } : await this.lteFromHilink(mm);
    return { kind: this.kind, hostname: hostname(), tailscale: ts, lte, wifi };
  }

  /** Map a HiLink reading onto the LTE row, or keep the empty ModemManager one. */
  private async lteFromHilink(fallback: LteStatus): Promise<LteStatus> {
    const hi = await this.hilinkStatus();
    return hi.present ? hilinkAsLte(hi) : fallback;
  }

  private async tailscaleStatus(): Promise<TailscaleStatus> {
    const ver = await sh('tailscale version');
    if (!ver.ok) {
      return { installed: false, running: false, ip: null, loginUrl: null, backendState: 'NotInstalled' };
    }
    const st = parseTailscaleStatus((await sh('tailscale status --json')).out);
    // Fall back to the CLI only when the status had no address of its own.
    let ip = st.ip;
    if (!ip) {
      const r = await sh('tailscale ip -4');
      ip = r.ok ? r.out.split('\n')[0] || null : null;
    }
    return {
      installed: true,
      running: st.running,
      ip,
      // A pending login used to be dropped here, so the setup page showed
      // "NeedsLogin" with no way to act on it.
      loginUrl: st.authUrl,
      backendState: st.backendState,
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

  /** Remembered so a failed join can restore the same hotspot settings. */
  private lastHotspot: HotspotConfig | null = null;

  private async wifiStatus(): Promise<WifiStatus> {
    // Serving our own hotspot and being joined to a network both read as
    // "connected" — only the connection NAME tells them apart.
    const dev = await sh('nmcli -t -f DEVICE,STATE,CONNECTION device');
    const mode = parseWifiMode(dev.out, WIFI_IFACE);
    const ssid = await sh("nmcli -t -f active,ssid dev wifi | grep '^yes' | cut -d: -f2");
    const ip = await sh(`nmcli -t -f IP4.ADDRESS dev show ${WIFI_IFACE} | head -1 | cut -d: -f2`);
    let name = ssid.ok ? ssid.out || null : null;
    if (!name && mode === 'ap') {
      const ap = await shArgs('nmcli', ['-g', '802-11-wireless.ssid', 'connection', 'show', 'Hotspot']);
      name = ap.ok ? ap.out.trim() || null : null;
    }
    return { mode, ssid: name, ip: ip.ok ? ip.out.split('/')[0] || null : null };
  }

  /** Nearby networks. `--rescan yes` costs a few seconds but avoids a stale list. */
  async wifiScan(): Promise<WifiNetwork[]> {
    const r = await shArgs('nmcli', ['-t', '-f', 'IN-USE,SIGNAL,SECURITY,SSID', 'device', 'wifi', 'list', '--rescan', 'yes']);
    return r.ok ? parseWifiScan(r.out) : [];
  }

  /**
   * Join a network. The Pi has one radio, so NetworkManager drops the hotspot the
   * moment it associates — the HTTP response usually never reaches the phone that
   * asked. That's expected; what must not happen is a vehicle stuck with neither:
   * on failure the hotspot is brought straight back up.
   */
  async wifiConnect(ssid: string, password: string | null): Promise<ActionResult> {
    const args = ['device', 'wifi', 'connect', ssid, 'ifname', WIFI_IFACE];
    if (password) args.push('password', password);
    const r = await shArgs('nmcli', args);
    if (r.ok) {
      // Make sure the hotspot profile doesn't fight the new connection.
      await shArgs('nmcli', ['connection', 'down', 'Hotspot']);
      const ip = (await sh(`nmcli -t -f IP4.ADDRESS dev show ${WIFI_IFACE} | head -1 | cut -d: -f2`)).out.split('/')[0];
      return { ok: true, message: `Connected to "${ssid}"${ip ? ` — ${ip}` : ''}. The hotspot is closing; rejoin your own WiFi.` };
    }
    await this.hotspotStart(this.lastHotspot ?? HOTSPOT_DEFAULTS);
    return { ok: false, message: `Could not join "${ssid}": ${r.out.split('\n').slice(-1)[0] || 'unknown error'}. Hotspot restarted.` };
  }

  private hilinkHost = HILINK_DEFAULT_HOST;

  setHilinkHost(host: string): void {
    if (isIpv4(host)) this.hilinkHost = host;
    this.hilinkCache = null;
  }

  /**
   * Read the HiLink stick. The interface is taken from the ROUTING TABLE (`ip route
   * get <stick>`), never from an interface name: a vehicle with a LAN on eth0 and the
   * stick on eth1 must not have the two mixed up, and the names swap around across
   * reboots and USB ports.
   */
  private hilinkCache: { at: number; value: HilinkStatus } | null = null;

  /**
   * Cached for a few seconds: the setup page polls status every 3 s and the OSD link
   * every 5 s, and each read is five HTTP requests to the stick. `force` is for the
   * Refresh button, where the operator is waiting for a fresh answer.
   */
  async hilinkStatus(opts: { force?: boolean } = {}): Promise<HilinkStatus> {
    const cached = this.hilinkCache;
    if (!opts.force && cached && Date.now() - cached.at < 8000) return cached.value;
    const value = await this.readHilinkNow();
    this.hilinkCache = { at: Date.now(), value };
    return value;
  }

  private async readHilinkNow(): Promise<HilinkStatus> {
    const host = this.hilinkHost;
    if (!isIpv4(host)) return { ...HILINK_ABSENT, message: `"${host}" is not an IPv4 address.` };

    const route = await shArgs('ip', ['route', 'get', host]);
    const iface = route.ok ? parseRouteDev(route.out) : null;
    if (!iface) {
      return { ...HILINK_ABSENT, message: `No route to ${host} — is the stick plugged in? (\`ip route get ${host}\`)` };
    }

    const get: HilinkGet = async (path, headers) => {
      try {
        const res = await fetch(`http://${host}${path}`, { headers, signal: AbortSignal.timeout(3000) });
        return { ok: res.ok, status: res.status, text: await res.text(), cookie: res.headers.get('set-cookie') };
      } catch {
        return { ok: false, status: 0, text: '', cookie: null };
      }
    };
    return readHilink(get, iface);
  }

  /** Radio state: rfkill, NetworkManager's view of wlan0, and the regulatory country. */
  async wifiRadio(): Promise<WifiRadioStatus> {
    const [rf, dev, reg, tz, loc] = await Promise.all([
      sh('rfkill list wifi'),
      sh('nmcli -t -f DEVICE,TYPE,STATE device'),
      sh('iw reg get'),
      sh('timedatectl show -p Timezone --value'),
      sh('cat /etc/default/locale'),
    ]);
    const blocked = parseRfkill(rf.out);
    return {
      device: parseWifiDeviceState(dev.out, WIFI_IFACE),
      softBlocked: blocked.softBlocked,
      hardBlocked: blocked.hardBlocked,
      country: parseWifiCountry(reg.out),
      suggestedCountry: guessWifiCountry({
        locale: parseLocaleFile(loc.ok ? loc.out : '') ?? process.env.LANG ?? null,
        timezone: tz.ok ? tz.out : null,
      }),
    };
  }

  /**
   * Unblock the radio and, if asked, set the regulatory country. Pi OS keeps WiFi
   * rfkill-blocked until a country is configured, which is the single most common
   * reason the onboarding hotspot never appears — and it used to require SSH.
   */
  async wifiRadioEnable(country?: string | null): Promise<ActionResult & { radio: WifiRadioStatus }> {
    const notes: string[] = [];
    if (country != null && country !== '') {
      if (!isCountryCode(country)) {
        return { ok: false, message: `"${country}" is not a two-letter country code.`, radio: await this.wifiRadio() };
      }
      const cc = country.toUpperCase();
      const r = await shArgs('sudo', ['raspi-config', ...wifiCountryArgs(cc)]);
      notes.push(
        r.ok
          ? `WiFi country set to ${cc}.`
          : `Could not set the WiFi country (${r.out.split('\n').slice(-1)[0] || 'raspi-config not available'}).`,
      );
    }
    await shArgs('sudo', ['rfkill', 'unblock', 'wifi']);
    await shArgs('nmcli', ['radio', 'wifi', 'on']);
    // NetworkManager needs a moment to notice the interface came back.
    await new Promise((r) => setTimeout(r, 2000));
    const radio = await this.wifiRadio();
    const usable = radioIsUsable(radio);
    notes.push(usable ? 'WiFi radio is enabled.' : 'The radio is still not usable.');
    if (!usable && !radio.country) notes.push('No WiFi country is set yet — pick one and try again.');
    return { ok: usable, message: notes.join(' '), radio };
  }

  /**
   * Build and start the onboarding hotspot. Two departures from the obvious
   * `nmcli device wifi hotspot`: that command cannot create an OPEN network (it
   * generates a WPA key when none is given, which silently broke the documented
   * captive-portal onboarding), and it picks its own subnet. So the profile is
   * built explicitly — and a blocked radio is repaired first instead of being
   * reported as nmcli's unhelpful "device is not available".
   */
  async hotspotStart(cfg: HotspotConfig): Promise<HotspotResult> {
    this.lastHotspot = cfg;
    const notes: string[] = [];

    let radio = await this.wifiRadio();
    if (!radioIsUsable(radio)) {
      // Unblocking your own radio is safe and reversible; the country only gets set
      // when it is missing AND we could derive one, and we always say that we did.
      const repair = await this.wifiRadioEnable(radio.country ? null : radio.suggestedCountry);
      radio = repair.radio;
      notes.push(repair.message);
      if (!radioIsUsable(radio)) {
        const f = explainWifiFailure('', radio);
        return { ok: false, message: `Hotspot not started — ${f.cause}.`, fix: f.fix, radio };
      }
    }

    const failed = (out: string): HotspotResult => {
      const f = explainWifiFailure(out, radio);
      return {
        ok: false,
        message: `Hotspot failed — ${f.cause}.`,
        fix: `${f.fix}\n\nnmcli said: ${out.split('\n').slice(-2).join(' ')}`,
        radio,
      };
    };

    const cmds = hotspotCommands({ ssid: cfg.ssid, password: cfg.password }, WIFI_IFACE);
    const up = cmds.pop()!; // run last, after the captive-portal decision
    for (const cmd of cmds) {
      const r = await shArgs('nmcli', cmd.args);
      if (!r.ok && !cmd.optional) return failed(r.out);
    }

    // Decide about the captive portal BEFORE the profile comes up, so dnsmasq starts
    // with the right config and nobody has to be kicked off to apply it.
    const uplink = await this.hasUplink();
    const captive = this.applyCaptiveConf(shouldHijackDns(uplink));

    const upRes = await shArgs('nmcli', up.args);
    if (!upRes.ok) return failed(upRes.out);

    // Read the key back rather than assuming: this is the check that would have
    // caught NetworkManager quietly securing a hotspot we asked to be open.
    const psk = (await shArgs('nmcli', hotspotPskArgs())).out.trim() || null;
    const secured = !!psk;
    notes.push(
      captive
        ? 'The captive portal is active: joining opens the page by itself.'
        : 'This Pi is sharing its own uplink, so DNS is left alone — no captive portal, open the address yourself.',
    );
    return {
      ok: true,
      message:
        `${notes.join(' ')} Hotspot "${cfg.ssid}" is up (${secured ? `WPA2, key ${psk}` : 'open'}) — ` +
        `join it and open http://${HOTSPOT_ADDRESS}:8080/`,
      psk,
      radio,
    };
  }

  /** Is there any default route (i.e. internet this hotspot could share)? */
  private async hasUplink(): Promise<boolean> {
    const r = await sh('ip route');
    return r.ok && /^default\b/m.test(r.out);
  }

  /**
   * Install or remove the dnsmasq drop-in that makes every name resolve to the
   * vehicle. Failure is not fatal: the hotspot still works, the page just doesn't
   * open on its own. Returns whether the portal is now active.
   */
  private applyCaptiveConf(enabled: boolean): boolean {
    try {
      if (enabled) {
        mkdirSync(dirname(CAPTIVE_CONF_PATH), { recursive: true });
        writeFileSync(CAPTIVE_CONF_PATH, captivePortalConf());
        return true;
      }
      if (existsSync(CAPTIVE_CONF_PATH)) rmSync(CAPTIVE_CONF_PATH);
      return false;
    } catch {
      return false;
    }
  }

  async hotspotStop(): Promise<ActionResult> {
    // Leave DNS alone once the AP is gone, or a later shared connection would
    // inherit the hijack.
    this.applyCaptiveConf(false);
    const r = await shArgs('nmcli', ['connection', 'down', 'Hotspot']);
    return r.ok
      ? { ok: true, message: 'Hotspot stopped.' }
      : { ok: false, message: `Could not stop the hotspot: ${r.out}` };
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
    // Interactive login. `tailscale up` blocks until the device is authorised, and
    // the URL appears only after tailscaled has reached the control plane — asking
    // for it with --timeout=1s returned before that every single time. So: start it
    // detached and read the URL from the daemon's own status instead.
    const before = parseTailscaleStatus((await sh('tailscale status --json')).out);
    if (before.authUrl) {
      // A login is already pending — hand back that link rather than spawning a
      // second `tailscale up` and leaving the first one behind.
      return { ok: true, message: 'A login is already waiting — open this link:', loginUrl: before.authUrl };
    }
    if (before.running) return { ok: true, message: 'Tailscale is already up.' };

    spawn('tailscale', ['up', '--hostname=yonderrc'], { detached: true, stdio: 'ignore' }).unref();

    for (let i = 0; i < 20; i++) {
      await new Promise((r) => setTimeout(r, 700));
      const st = parseTailscaleStatus((await sh('tailscale status --json')).out);
      if (st.authUrl) return { ok: true, message: 'Open this link to authorise the vehicle:', loginUrl: st.authUrl };
      if (st.running) return { ok: true, message: 'Tailscale is up.' };
    }
    return {
      ok: false,
      message:
        'Tailscale produced no login link within 14s. Check that the vehicle has internet, ' +
        'then try again — or run `sudo tailscale up --hostname=yonderrc` over SSH, which prints the link directly.',
    };
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
    // A HiLink stick never shows up in ModemManager, so ask it directly before
    // falling back to WiFi — otherwise a vehicle on LTE shows no link signal at all.
    const hi = await this.hilinkStatus();
    if (hi.present && hi.connected && hi.signalPercent != null) {
      return { kind: 'lte' as const, quality: hi.signalPercent, label: hilinkOsdLabel(hi) };
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

    // Prefer libcamera (CSI) names; fall back to V4L2 capture nodes. Pi OS Bookworm
    // renamed the tools to rpicam-*, so try that first and keep the old name for
    // Bullseye — a hardcoded libcamera-hello silently reported "no cameras".
    const camTool = await sh('command -v rpicam-hello || command -v libcamera-hello');
    const toolFound = camTool.out.trim().length > 0;
    const cams: string[] = [];
    if (toolFound) {
      const lc = await sh(`${camTool.out.trim().split('\n')[0]} --list-cameras -t 1 2>&1`);
      cams.push(...parseCameraList(lc.out));
    }
    if (cams.length === 0) {
      const v4l = await sh('ls /dev/video* 2>/dev/null');
      cams.push(...captureNodes(v4l.out.split(/\s+/)));
    }
    if (cams.length === 0) {
      notes.push(explainNoCamera(toolFound));
      const boot = await this.readBootConfig();
      const why = boot ? explainBootConfig(parseBootConfig(boot.text), 0) : null;
      if (why) notes.push(why);
    }

    // Serial candidates for a GPS receiver.
    const serial: string[] = [];
    const ser = await sh('ls /dev/ttyAMA0 /dev/ttyUSB* /dev/ttyACM* /dev/serial0 2>/dev/null');
    for (const d of ser.out.split(/\s+/)) if (d.startsWith('/dev/')) serial.push(d);
    if ((await sh('systemctl is-active gpsd')).out.trim() === 'active') notes.push('gpsd is running — you can use the "gpsd" GPS source.');

    return { i2c, modemPresent, cameras: cams, serial, notes };
  }

  /**
   * Which native modules are present. Resolution only — the module is never
   * imported here, so probing can't touch I²C/GPIO or fail on missing hardware.
   */
  async hwDeps(): Promise<HwDepStatus[]> {
    return HW_DEPS.map((d) => {
      let installed = false;
      let version: string | null = null;
      try {
        requireFrom.resolve(d.name);
        installed = true;
      } catch {
        return { name: d.name, installed: false, version: null, needFor: d.needFor };
      }
      try {
        const pkg = JSON.parse(readFileSync(requireFrom.resolve(`${d.name}/package.json`), 'utf8')) as { version?: string };
        version = pkg.version ?? null;
      } catch {
        /* an "exports" map can hide package.json — installed is what matters */
      }
      return { name: d.name, installed, version, needFor: d.needFor };
    });
  }

  async hwDepInstall(name: HwDepName): Promise<HwDepInstallResult> {
    // Defence in depth: the router allowlists too, but this is the thing that
    // actually runs a command, so it refuses anything off the list itself.
    if (!isHwDep(name)) return { ok: false, message: `Refused: "${String(name)}" is not a known driver module.`, output: '' };

    const before = new Set((await this.hwDeps()).filter((d) => d.installed).map((d) => d.name));
    const started = Date.now();
    const r = await shSlow('npm', npmInstallArgs(name), { cwd: REPO_ROOT, timeoutMs: 10 * 60_000 });
    const secs = Math.max(1, Math.round((Date.now() - started) / 1000));

    // npm's exit code is NOT the truth here. These modules are optionalDependencies
    // of the vehicle package, so when the native build fails npm quietly removes the
    // package again, prints "up to date" and exits 0 — reporting that as success is
    // exactly the silent fallback-to-sim this feature exists to prevent. What counts
    // is whether the module can be resolved afterwards.
    const deps = await this.hwDeps();
    const after = deps.find((d) => d.name === name);
    if (r.ok && after?.installed) {
      // npm reifies the WHOLE vehicle package, and its siblings are optional
      // dependencies of it — so asking for one builds the others too. That can't be
      // avoided (`--omit=optional` skips the requested one as well), so say it plainly
      // instead of leaving the operator wondering why the log shows another module.
      const extra = deps.filter((d) => d.installed && d.name !== name && !before.has(d.name)).map((d) => d.name);
      return {
        ok: true,
        message:
          `${name}${after.version ? ` ${after.version}` : ''} installed in ${secs}s — restart the vehicle service to use it.` +
          (extra.length
            ? ` npm also built ${extra.join(' and ')}: they are optional dependencies of the same package, so npm always reifies them together. Harmless — nothing uses them unless you select that driver.`
            : ''),
        output: lastLines(r.out),
        restartRequired: true,
      };
    }

    const f = explainNpmFailure(r.out, { dep: name, timedOut: r.timedOut, silentDrop: r.ok });
    const apt = hwDepInfo(name).apt;
    return {
      ok: false,
      message: `Could not install ${name} — ${f.cause}.`,
      fix: f.fix,
      output:
        errorExcerpt(r.out) ||
        `npm produced no output (after ${secs}s).${apt.length ? ` This module also needs: ${apt.join(', ')}.` : ''}`,
    };
  }

  /**
   * Restart our own systemd unit. Deferred by a moment so the HTTP response is
   * flushed before systemd kills this process — otherwise the browser sees a
   * dropped connection instead of "restarting".
   */
  async restartService(): Promise<ActionResult> {
    setTimeout(() => {
      void sh('sudo systemctl restart yonderrc-vehicle.service');
    }, 700).unref();
    return { ok: true, message: 'Restarting the vehicle service — this page comes back on its own in a few seconds.' };
  }

  /**
   * What an update would change. Fetches from the remote and compares — it never
   * modifies the checkout, so pressing this in the field is free.
   */
  async updateCheck(src: UpdateSource = UPDATE_SOURCE_DEFAULT): Promise<UpdateCheck> {
    const g = gitEnv(REPO_ROOT);
    const git = (args: string[], timeoutMs = 60_000) =>
      shSlow('git', gitArgs(REPO_ROOT, args), { cwd: REPO_ROOT, timeoutMs, env: g.env });

    const current = parseVersion(readFileSafe(join(REPO_ROOT, 'package.json')));

    // Ownership is handled by gitArgs() on every call — see there. It used to be a
    // `git config --global` write plus a retry, which quietly did nothing when the
    // service had no $HOME to write it to.
    // Fetch by source+branch (a remote name or a URL) and compare against
    // FETCH_HEAD, so a custom source works exactly like the default origin/main.
    const fetched = await git(['fetch', '--quiet', src.source, src.branch]);
    const tree = parseWorkingTree((await git(['status', '--porcelain'])).out);

    if (!fetched.ok) {
      // Say what the vehicle already tried, so a persistent failure is diagnosable
      // instead of costing another round trip.
      const tried = `\n\n(The vehicle ${g.note}, and git still refused. Please report this together with \`git --version\`.)`;
      const raw = errorExcerpt(fetched.out, 8) || 'git produced no output.';
      const detail = /dubious ownership/i.test(fetched.out) ? raw + tried : raw;
      const base = { ok: false, current, available: null, behind: 0, commits: [], impact: classifyChanges([]), tree, conflicts: [], detail };
      return { ...base, ...describeCheck(base) };
    }

    const log = await git(['log', '--oneline', '--no-decorate', 'HEAD..FETCH_HEAD']);
    const commits = parseCommits(log.out);
    const files = (await git(['diff', '--name-only', 'HEAD..FETCH_HEAD'])).out.split('\n').map((l) => l.trim());
    const available = parseVersion((await git(['show', 'FETCH_HEAD:package.json'])).out);

    const base = {
      ok: true,
      current,
      available,
      behind: commits.length,
      commits: commits.slice(0, 15),
      impact: classifyChanges(files),
      tree,
      // Only an overlap between "changed here" and "changed there" stops a
      // fast-forward. Refusing on any local change at all was stricter than git.
      conflicts: tree.dirty.filter((f) => files.includes(f)),
    };
    return { ...base, ...describeCheck(base) };
  }

  /**
   * Apply it. Dependencies and the ground build run BEFORE the restart, so the
   * service never comes back into a half-updated checkout — the setup page you are
   * holding is served by that same service.
   */
  async updateApply(src: UpdateSource = UPDATE_SOURCE_DEFAULT, hardwareDeps: string[] = []): Promise<UpdateResult> {
    const check = await this.updateCheck(src);
    if (!check.ok) {
      return { ok: false, message: check.message, output: [check.note, check.detail].filter(Boolean).join('\n\n'), steps: [] };
    }
    if (check.conflicts.length) return { ok: false, message: check.message, output: check.note ?? '', steps: [] };
    if (check.behind === 0) return { ok: true, message: check.message, output: '', steps: [] };

    const steps: { label: string; ok: boolean }[] = [];
    const logs: string[] = [];
    const { env } = gitEnv(REPO_ROOT);
    for (const step of updateSteps(check.impact, src, check.tree.generated, hardwareDeps)) {
      const args = step.cmd === 'git' ? gitArgs(REPO_ROOT, step.args) : step.args;
      const r = await shSlow(step.cmd, args, { cwd: REPO_ROOT, timeoutMs: 15 * 60_000, env: step.cmd === 'git' ? env : undefined });
      steps.push({ label: step.label, ok: r.ok });
      logs.push(`$ ${step.cmd} ${step.args.join(' ')}\n${errorExcerpt(r.out, 12) || '(no output)'}`);
      if (!r.ok) {
        return {
          ok: false,
          message: `Update stopped at: ${step.label.toLowerCase()}. The vehicle was NOT restarted and keeps running the previous version.`,
          output: logs.join('\n\n'),
          steps,
        };
      }
    }

    // Restart last, and deferred, so this response still reaches the browser.
    void this.restartService();
    return {
      ok: true,
      message: `Updated to v${check.available ?? '?'} — restarting now. This page comes back in a few seconds.`,
      output: logs.join('\n\n'),
      steps,
      restarting: true,
    };
  }

  /** Locate and read the firmware config (Bookworm moved it under /boot/firmware). */
  private async readBootConfig(): Promise<{ path: string; text: string } | null> {
    for (const path of ['/boot/firmware/config.txt', '/boot/config.txt']) {
      try {
        return { path, text: readFileSync(path, 'utf8') };
      } catch {
        // try the next location
      }
    }
    return null;
  }

  private async bootId(): Promise<string> {
    try {
      return readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim();
    } catch {
      return '';
    }
  }

  async cameraModule(): Promise<CameraModuleStatus> {
    const boot = await this.readBootConfig();
    if (!boot) {
      return {
        available: false,
        configPath: null,
        moduleId: 'auto',
        overlay: null,
        autoDetect: true,
        rebootRequired: false,
        message: 'No Raspberry Pi firmware config found — this is not a Pi.',
      };
    }
    const state = parseBootConfig(boot.text);
    // The first read after a boot records what the running system actually booted with;
    // from then on a pending reboot is simply "config.txt asks for something else".
    const now = await this.bootId();
    let stored: CameraBootRecord | null = null;
    try {
      stored = JSON.parse(readFileSync(BOOT_RECORD_FILE, 'utf8')) as CameraBootRecord;
    } catch {
      stored = null;
    }
    let record: CameraBootRecord;
    if (recordIsCurrent(stored, now)) {
      record = stored as CameraBootRecord;
    } else {
      record = { bootId: now, booted: state };
      try {
        mkdirSync(dirname(BOOT_RECORD_FILE), { recursive: true });
        writeFileSync(BOOT_RECORD_FILE, JSON.stringify(record), 'utf8');
      } catch {
        // read-only state dir: we just lose the reboot hint, not the feature
      }
    }
    const pending = bootedStateChanged(record.booted, state);
    return {
      available: true,
      configPath: boot.path,
      moduleId: moduleIdFor(state),
      overlay: state.overlay,
      autoDetect: state.autoDetect,
      rebootRequired: pending,
      message: null,
    };
  }

  /**
   * Write the module choice into config.txt. The overlay never comes from free text
   * unchecked: it is either a catalogue entry or a name that both passes the syntax
   * check and exists as a .dtbo on this Pi.
   */
  async setCameraModule(id: string, customOverlay?: string | null): Promise<ActionResult & { rebootRequired: boolean }> {
    const boot = await this.readBootConfig();
    if (!boot) return { ok: false, message: 'No Raspberry Pi firmware config found.', rebootRequired: false };

    const mod = moduleById(id);
    if (!mod) return { ok: false, message: `Unknown camera module "${id}".`, rebootRequired: false };

    let overlay: string | null = mod.overlay;
    if (id === 'custom') {
      const want = (customOverlay ?? '').trim();
      if (!validOverlayName(want)) {
        return { ok: false, message: `"${want}" is not a valid overlay name.`, rebootRequired: false };
      }
      const dtbo = `${dirname(boot.path)}/overlays/${overlayBaseName(want)}.dtbo`;
      if (!existsSync(dtbo)) {
        return { ok: false, message: `No overlay ${overlayBaseName(want)}.dtbo installed on this Pi.`, rebootRequired: false };
      }
      overlay = want;
    }

    const next = applyCameraModule(boot.text, overlay);
    if (next === boot.text) {
      return { ok: true, message: 'Already configured — nothing to change.', rebootRequired: false };
    }
    try {
      // One backup of the state we found, kept forever: this file decides whether the Pi boots.
      const backup = `${boot.path}.yonderrc-bak`;
      if (!existsSync(backup)) writeFileSync(backup, boot.text, 'utf8');
      writeFileSync(boot.path, next, 'utf8');
    } catch (err) {
      return {
        ok: false,
        message: `Could not write ${boot.path}: ${(err as Error).message} — the service needs write access to the boot partition.`,
        rebootRequired: false,
      };
    }
    const after = await this.cameraModule();
    return {
      ok: true,
      message: after.rebootRequired
        ? `${mod.label} selected. Reboot to apply — the firmware only reads config.txt at boot.`
        : `${mod.label} selected — that is what the Pi already booted with, so no reboot is needed.`,
      rebootRequired: after.rebootRequired,
    };
  }

  async reboot(): Promise<ActionResult> {
    void sh('sudo reboot'); // fire and forget
    return { ok: true, message: 'Rebooting…' };
  }
}
