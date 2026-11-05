/**
 * Getting onto the vehicle's computer itself — a shell, or its screen — from
 * Vehicle setup › Device access (v1.73, a tester's request).
 *
 * Three ways, chosen for what a Raspberry Pi already has rather than for what this
 * project could build:
 *  - **Raspberry Pi Connect** (connect.raspberrypi.com), Raspberry Pi's own service: a
 *    shell in the browser from anywhere and, on an image with a desktop, the screen.
 *    WebRTC, end-to-end encrypted, through carrier NAT without a VPN, free for a
 *    personal account. Raspberry Pi OS Lite ships its shell-only variant
 *    (`rpi-connect-lite`) installed and switched off; a desktop image ships the full
 *    one. Needs internet and a Raspberry Pi ID.
 *  - **SSH** — on the local network, the hotspot or through the VPN. Encrypted, and
 *    Windows 10+, macOS and Linux all have `ssh` built in.
 *  - **VNC** — only on an image with a desktop, switched by raspi-config. Pi OS Lite
 *    (what docs/QUICKSTART.md recommends) has no screen to share, and a desktop on a
 *    vehicle costs RAM, CPU and boot time the control loop needs — so none is
 *    installed from here.
 *
 * Deliberately NOT a terminal inside this page: that would be a root shell over plain
 * HTTP, through a hotspot that is open by default. Connect and SSH are encrypted and
 * are maintained by people whose job that is.
 *
 * Connect is a systemd *user* service of the Pi's login user, never root. The vehicle
 * service (root) runs its CLI as that user — `runuser`, with that user's home, runtime
 * directory and session bus — and switches on lingering, so the service runs at boot
 * with nobody logged in. Built from Raspberry Pi's documentation; not yet run on a
 * vehicle. Everything here is pure; RealSystem does the running.
 */
import type { ActionResult } from './SystemManager.js';

export type ConnectVariant = 'rpi-connect' | 'rpi-connect-lite';
export type ConnectPermission = 'allowed' | 'disallowed' | 'unavailable';

export interface PiConnectStatus {
  /** Which package is installed, if any. */
  installed: ConnectVariant | null;
  version: string | null;
  /** The user service answered `rpi-connect status`. */
  running: boolean;
  signedIn: boolean | null;
  shell: ConnectPermission | null;
  screen: ConnectPermission | null;
  /** Lingering is on: the service starts at boot with nobody logged in. */
  linger: boolean | null;
  /** What `rpi-connect status` printed, for the page to show when it is not the usual. */
  raw: string | null;
  /** Why nothing could be read, in a sentence — or null. */
  note: string | null;
}

export interface SshStatus {
  active: boolean | null;
  enabled: boolean | null;
  /** `ssh user@host` for every way this box can be reached right now (sshCommands). */
  commands: string[];
}

export interface VncStatus {
  /** The image boots into a desktop (systemd's default target is graphical). */
  desktop: boolean | null;
  /** raspi-config says VNC is on; null without raspi-config. */
  enabled: boolean | null;
}

export interface DeviceAccessStatus {
  kind: string;
  /** The Pi's login user — whose shell Connect and SSH open. */
  user: string | null;
  hostname: string;
  /** Every IPv4 address this box has, with its interface (LAN, hotspot, VPN). */
  addresses: { iface: string; address: string }[];
  connect: PiConnectStatus;
  ssh: SshStatus;
  vnc: VncStatus;
  /** The vehicle service can act for that user (it runs as root, or as that user). */
  canManage: boolean;
  /** No API secret is set — anyone who can open the setup page can use these buttons. */
  open?: boolean;
}

export const DEVICE_ACCESS_ACTIONS = [
  'connect-install',
  'connect-on',
  'connect-off',
  'connect-signin',
  'connect-signout',
  'connect-shell-on',
  'ssh-on',
  'vnc-on',
  'vnc-off',
] as const;
export type DeviceAccessAction = (typeof DEVICE_ACCESS_ACTIONS)[number];

export function isDeviceAccessAction(v: unknown): v is DeviceAccessAction {
  return typeof v === 'string' && (DEVICE_ACCESS_ACTIONS as readonly string[]).includes(v);
}

export interface DeviceAccessResult extends ActionResult {
  /**
   * Connect's sign-in page for this device. Only ever in the answer to the POST that
   * asked for it — never in the status, which answers without the API secret: whoever
   * completes that page owns a shell on the vehicle.
   */
  signinUrl?: string;
  /** apt's output tail, for an install. */
  output?: string;
  /** The next step when it failed. */
  fix?: string;
}

export const CONNECT_UNKNOWN: PiConnectStatus = {
  installed: null,
  version: null,
  running: false,
  signedIn: null,
  shell: null,
  screen: null,
  linger: null,
  raw: null,
  note: null,
};

// ---- the commands, listed once (the sudoers file names them verbatim) ----

export const APT_UPDATE_ARGS = ['apt-get', 'update'];
export function connectInstallArgs(variant: ConnectVariant): string[] {
  return ['apt-get', 'install', '-y', variant];
}
export const SSH_ENABLE_ARGS = ['systemctl', 'enable', '--now', 'ssh'];
export function vncArgs(on: boolean): string[] {
  return ['raspi-config', 'nonint', 'do_vnc', on ? '0' : '1'];
}
export const VNC_GET_ARGS = ['raspi-config', 'nonint', 'get_vnc'];
export function lingerArgs(user: string): string[] {
  return ['loginctl', 'enable-linger', user];
}
/** What the CLI is asked, per action that is the user's own business. */
export const CONNECT_CLI: Partial<Record<DeviceAccessAction, string[]>> = {
  'connect-on': ['on'],
  'connect-off': ['off'],
  'connect-signin': ['signin'],
  'connect-signout': ['signout'],
  'connect-shell-on': ['shell', 'on'],
};

/** Which package fits this image: the full one wants a desktop to share. */
export function connectVariantFor(desktop: boolean | null): ConnectVariant {
  return desktop ? 'rpi-connect' : 'rpi-connect-lite';
}

// ---- reading ----

function permission(v: string | undefined): ConnectPermission | null {
  const s = (v ?? '').trim().toLowerCase();
  if (s.startsWith('allowed')) return 'allowed';
  if (s.startsWith('disallowed') || s.startsWith('not allowed') || s.startsWith('denied') || s.startsWith('off')) return 'disallowed';
  if (s.startsWith('unavailable')) return 'unavailable';
  return null;
}

/**
 * `rpi-connect status`, per Raspberry Pi's documentation:
 *   Signed in: yes
 *   Screen sharing: allowed (0 sessions active)
 *   Remote shell: allowed (1 session active)
 * Lenient about everything else — `answered` says whether it looked like that at all.
 */
export function parseConnectStatus(out: string): {
  answered: boolean;
  signedIn: boolean | null;
  shell: ConnectPermission | null;
  screen: ConnectPermission | null;
} {
  const lines = new Map<string, string>();
  for (const raw of (out ?? '').split('\n')) {
    const m = /^\s*([A-Za-z][A-Za-z ]+?)\s*:\s*(.+?)\s*$/.exec(raw.replace(/^[^A-Za-z]+/, ''));
    if (m) lines.set(m[1].toLowerCase(), m[2]);
  }
  const signed = lines.get('signed in');
  return {
    answered: signed !== undefined,
    signedIn: signed === undefined ? null : /^yes\b/i.test(signed),
    shell: permission(lines.get('remote shell')),
    screen: permission(lines.get('screen sharing')),
  };
}

/**
 * `dpkg-query -W -f '${Package} ${db:Status-Abbrev} ${Version}\n' rpi-connect rpi-connect-lite`:
 * installed packages read `ii`. A package that is not there at all goes to stderr.
 */
export function parseDpkgConnect(out: string): { variant: ConnectVariant | null; version: string | null } {
  let found: { variant: ConnectVariant; version: string | null } | null = null;
  for (const line of (out ?? '').split('\n')) {
    const [pkg, status, version] = line.trim().split(/\s+/);
    if (pkg !== 'rpi-connect' && pkg !== 'rpi-connect-lite') continue;
    if (!status || !status.startsWith('ii')) continue;
    // The two conflict, so there is one — but if a half-removed one lingers, the full one wins.
    if (!found || pkg === 'rpi-connect') found = { variant: pkg, version: version && version !== '<none>' ? version : null };
  }
  return found ?? { variant: null, version: null };
}

/**
 * The sign-in link `rpi-connect signin` prints ("Complete sign in by visiting
 * https://connect.raspberrypi.com/verify/XXXX-XXXX"). Only Raspberry Pi's own verify
 * page is ever accepted as a link — whatever else the output says stays text.
 */
export function connectSigninUrl(text: string): string | null {
  const m = /https:\/\/connect\.raspberrypi\.com\/verify\/[A-Za-z0-9-]+/.exec(text ?? '');
  return m ? m[0] : null;
}

/** Why apt failed, in words — this page is often read on a phone, next to the vehicle. */
export function explainAptFailure(out: string): { cause: string; fix: string } {
  const t = out ?? '';
  if (/Unable to locate package|has no installation candidate/i.test(t)) {
    return {
      cause: 'this system has no Raspberry Pi OS package source',
      fix: 'Raspberry Pi Connect exists for Raspberry Pi OS (Bookworm or newer) only. On another system, use SSH below.',
    };
  }
  if (/Could not get lock|Unable to acquire the dpkg frontend lock|is another process using it/i.test(t)) {
    return { cause: 'another installation is running — most likely the automatic updates', fix: 'Wait a few minutes and press Install again.' };
  }
  if (/dpkg was interrupted/i.test(t)) {
    return { cause: 'an earlier installation was interrupted', fix: 'Over SSH: `sudo dpkg --configure -a`, then press Install again.' };
  }
  if (/Temporary failure resolving|Could not resolve|Failed to fetch|Network is unreachable/i.test(t)) {
    return { cause: 'the vehicle has no internet', fix: 'Join a WiFi with internet (Network tab) or connect LTE, then press Install again — the hotspot has no uplink.' };
  }
  if (/No space left on device/i.test(t)) {
    return { cause: 'the SD card is full', fix: 'Free some space (old logs, recordings), then try again.' };
  }
  return { cause: 'apt failed', fix: 'The log below says why. Over SSH, `sudo apt-get install rpi-connect-lite` shows the same.' };
}

/** A login user from `/etc/passwd`: a person's account, not a system one. */
export interface LoginUser {
  name: string;
  uid: number;
  home: string;
}

/**
 * The Pi's login user — the one Imager created, whose shell Connect and SSH open. The
 * owner of the checkout wins when it is such an account (the installer ran as them);
 * otherwise the first person's account, which on Raspberry Pi OS is uid 1000.
 */
export function pickLoginUser(passwd: string, ownerUid: number | null): LoginUser | null {
  const users: LoginUser[] = [];
  for (const line of (passwd ?? '').split('\n')) {
    const f = line.split(':');
    if (f.length < 7) continue;
    const uid = Number(f[2]);
    const shell = f[6].trim();
    if (!Number.isInteger(uid) || uid < 1000 || uid >= 60000) continue;
    if (/(nologin|\/false)$/.test(shell)) continue;
    users.push({ name: f[0], uid, home: f[5] || `/home/${f[0]}` });
  }
  users.sort((a, b) => a.uid - b.uid);
  return users.find((u) => u.uid === ownerUid) ?? users[0] ?? null;
}

/** The environment a user service of `user` is reached with. */
export function userServiceEnv(user: LoginUser): Record<string, string> {
  const run = `/run/user/${user.uid}`;
  return {
    HOME: user.home,
    USER: user.name,
    LOGNAME: user.name,
    XDG_RUNTIME_DIR: run,
    DBUS_SESSION_BUS_ADDRESS: `unix:path=${run}/bus`,
    PATH: '/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    LC_ALL: 'C',
    LANG: 'C',
  };
}

/** `runuser -u <user> -- env K=V … rpi-connect <args>` — no shell, so nothing is ever parsed as one. */
export function runAsUserArgs(user: LoginUser, cli: string[]): { file: string; args: string[] } {
  const env = Object.entries(userServiceEnv(user)).map(([k, v]) => `${k}=${v}`);
  return { file: 'runuser', args: ['-u', user.name, '--', 'env', ...env, 'rpi-connect', ...cli] };
}

/**
 * What to type to get a shell, one line per way to reach the box: its mDNS name, then
 * every address it has (LAN, hotspot, VPN).
 */
export function sshCommands(user: string | null, hostname: string, addresses: readonly { iface: string; address: string }[]): string[] {
  const who = user || 'pi';
  const out: string[] = [];
  const add = (host: string) => {
    const c = `ssh ${who}@${host}`;
    if (host && !out.includes(c)) out.push(c);
  };
  if (hostname) add(hostname.includes('.') ? hostname : `${hostname}.local`);
  for (const a of addresses) add(a.address);
  return out;
}

/** `raspi-config nonint get_vnc` prints 0 when VNC is on, 1 when it is off. */
export function parseVncGet(out: string): boolean | null {
  const v = (out ?? '').trim();
  if (v === '0') return true;
  if (v === '1') return false;
  return null;
}

/** `systemctl is-active/is-enabled ssh.service ssh.socket` — one state per line; either unit counts. */
export function parseUnitStates(out: string, good: string): boolean | null {
  const states = (out ?? '').split('\n').map((s) => s.trim()).filter(Boolean);
  if (!states.length) return null;
  return states.some((s) => s === good);
}
