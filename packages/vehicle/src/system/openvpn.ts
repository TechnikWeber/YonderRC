/**
 * OpenVPN as a remote-access method — EXPERIMENTAL.
 *
 * Asked for by a user who already runs an OpenVPN server (on a router, a NAS, a VPS).
 * It is built from the OpenVPN 2.5/2.6 documentation and Debian's `openvpn-client@`
 * systemd unit and covered by these unit tests — but it has not run on a vehicle yet.
 * The setup page says so next to the option.
 *
 * How it works: the operator uploads the client profile (`.ovpn`) their server exported.
 * The vehicle keeps that text as uploaded, and every time the tunnel is brought up it
 * writes a *sanitised* copy to /etc/openvpn/client/yonderrc.conf and (re)starts
 * `openvpn-client@yonderrc`. Sanitised, because an .ovpn file is not just settings:
 *
 *  - **It can run programs.** `up`, `down`, `route-up`, `plugin` and friends execute
 *    commands — as root here — and `log`/`status`/`writepid` write files wherever they
 *    point. An uploaded file must not be a way to run code on the vehicle, so those lines
 *    are commented out and the page lists what was removed. The usual victim is the
 *    `update-resolv-conf` DNS hook, which a vehicle reached *through* the tunnel does not
 *    need.
 *  - **It decides the vehicle's routing.** A server that pushes `redirect-gateway` sends
 *    all of the vehicle's internet through the VPN; when the VPN then drops, so does
 *    everything else. Remote access needs only the VPN's own subnet, so the push is
 *    ignored unless the operator ticks "all traffic through the VPN".
 *  - **It names its interface.** `dev tun` becomes `dev tunyrc`, so status and the data
 *    counter can find it (and the counter excludes it — tunnel traffic is counted on the
 *    real uplink already).
 *  - **It may point at files.** `ca ca.crt` cannot work from a single uploaded file; the
 *    page asks for the inline export instead of failing later in a log nobody reads.
 *
 * Everything here is pure. RealSystem does the writing and the systemd calls.
 */

export const OVPN_UNIT = 'openvpn-client@yonderrc';
export const OVPN_CONF_PATH = '/etc/openvpn/client/yonderrc.conf';
export const OVPN_AUTH_PATH = '/etc/openvpn/client/yonderrc.auth';
export const OVPN_TUN_IFACE = 'tunyrc';
export const OVPN_TAP_IFACE = 'tapyrc';

/**
 * The exact privileged commands RealSystem runs — listed once, so the sudoers file
 * (provisioning/yonderrc.sudoers, for non-root setups) can name them verbatim.
 */
export const OVPN_ENABLE_ARGS = ['systemctl', 'enable', OVPN_UNIT];
export const OVPN_RESTART_ARGS = ['systemctl', 'restart', '--no-block', OVPN_UNIT];
export const OVPN_STOP_ARGS = ['systemctl', 'disable', '--now', OVPN_UNIT];

/** Directives that run programs, load code, open a control port, or write files. */
const UNSAFE = new Set([
  'up', 'down', 'route-up', 'route-pre-down', 'ipchange', 'client-connect', 'client-disconnect',
  'learn-address', 'auth-user-pass-verify', 'tls-verify', 'tls-export-cert', 'plugin', 'script-security',
  'log', 'log-append', 'status', 'writepid', 'replay-persist', 'tmp-dir', 'cd', 'chroot', 'daemon',
  'config', 'askpass', 'iproute', 'up-restart',
]);

/** Windows-only directives that make OpenVPN on Linux refuse the whole profile or misbehave. */
const WINDOWS_ONLY = new Set([
  'block-outside-dns', 'register-dns', 'route-method', 'ip-win32', 'dhcp-renew', 'dhcp-release',
  'dhcp-pre-release', 'tap-sleep', 'show-net-up', 'win-sys', 'service', 'allow-nonadmin', 'dev-node',
  'windows-driver',
]);

/** Directives whose argument is a file — unusable when the profile is a single upload. */
const FILE_ARGS = new Set(['ca', 'cert', 'key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'pkcs12', 'secret', 'crl-verify', 'dh', 'extra-certs']);

export interface OvpnSanitised {
  /** The profile as it is written to /etc/openvpn/client/yonderrc.conf. */
  conf: string;
  /** Directive names that were commented out, in order, without repeats. */
  removed: string[];
  /** "ca ca.crt" — references to files that do not exist on the vehicle. */
  externalFiles: string[];
  /** The profile asks for a username/password that it does not carry inline. */
  needsAuth: boolean;
  device: 'tun' | 'tap';
  /** Why it cannot work at all; empty when it can. */
  problems: string[];
}

/** CRLF and a BOM are what a Windows-exported profile usually brings along. */
export function normaliseOvpn(text: string): string {
  return String(text ?? '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').trim() + '\n';
}

export function sanitiseOvpn(
  text: string,
  opts: { authFile?: string | null; fullTunnel?: boolean } = {},
): OvpnSanitised {
  const lines = normaliseOvpn(text).split('\n');
  const out: string[] = [];
  const removed: string[] = [];
  const externalFiles: string[] = [];
  const problems: string[] = [];
  const seen = new Set<string>();
  const inline = new Set<string>();
  let block: string | null = null;
  let device: 'tun' | 'tap' = 'tun';
  let sawDev = false;
  let authLine = false;

  const drop = (name: string, line: string, why = 'removed by YonderRC') => {
    if (!removed.includes(name)) removed.push(name);
    out.push(`# ${why}: ${line}`);
  };

  for (const raw of lines) {
    const line = raw.trim();
    if (block) {
      out.push(raw);
      // A <connection> block holds its own "remote" — a profile with several servers.
      if (block === 'connection' && /^remote\s+\S+/i.test(line)) seen.add('remote');
      if (line.toLowerCase() === `</${block}>`) block = null;
      continue;
    }
    const open = /^<([a-z0-9-]+)>$/i.exec(line);
    if (open) {
      block = open[1].toLowerCase();
      inline.add(block);
      out.push(raw);
      continue;
    }
    if (!line || line.startsWith('#') || line.startsWith(';')) {
      out.push(raw);
      continue;
    }
    const tokens = line.replace(/^--/, '').split(/\s+/);
    const name = tokens[0].toLowerCase();
    seen.add(name);
    if (UNSAFE.has(name) || name.startsWith('management')) {
      drop(name, line);
      continue;
    }
    if (WINDOWS_ONLY.has(name)) {
      drop(name, line, 'Windows-only, removed by YonderRC');
      continue;
    }
    if (name === 'dev') {
      device = /^tap/i.test(tokens[1] ?? '') ? 'tap' : 'tun';
      sawDev = true;
      out.push(`dev ${device === 'tap' ? OVPN_TAP_IFACE : OVPN_TUN_IFACE}`);
      continue;
    }
    if (name === 'redirect-gateway' && !opts.fullTunnel) {
      drop(name, line, 'removed by YonderRC (the vehicle keeps its own uplink)');
      continue;
    }
    if (name === 'auth-user-pass') {
      authLine = true;
      // Replaced by the vehicle's own credentials file below — or left bare when the
      // profile carries them inline.
      continue;
    }
    if (FILE_ARGS.has(name) && tokens[1] && tokens[1] !== '[inline]') {
      externalFiles.push(`${name} ${tokens[1]}`);
    }
    out.push(raw);
  }
  if (block) problems.push(`the inline block <${block}> is never closed — the file is cut off.`);
  if (!seen.has('remote')) problems.push('there is no "remote" line, so it does not say which server to connect to.');
  if (!seen.has('client') && !(seen.has('tls-client') && seen.has('pull'))) {
    problems.push('it is not a client profile (no "client" line) — export the profile for a client/device, not the server configuration.');
  }

  const authInline = inline.has('auth-user-pass');
  const needsAuth = authLine && !authInline;
  if (authLine) out.push(authInline ? 'auth-user-pass' : opts.authFile ? `auth-user-pass ${opts.authFile}` : 'auth-user-pass');

  out.push('', '# --- added by YonderRC ---');
  if (!sawDev) out.push(`dev ${OVPN_TUN_IFACE}`);
  if (!opts.fullTunnel) out.push('pull-filter ignore "redirect-gateway"');
  // A vehicle boots wherever it is: maybe before its uplink is up, maybe behind a
  // flapping LTE link. Keep resolving and keep the tunnel device across reconnects.
  if (!seen.has('resolv-retry')) out.push('resolv-retry infinite');
  if (!seen.has('persist-tun')) out.push('persist-tun');
  if (!seen.has('persist-key')) out.push('persist-key');
  if (!seen.has('keepalive') && !seen.has('ping')) out.push('keepalive 10 60');

  return { conf: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n', removed, externalFiles, needsAuth, device, problems };
}

/** A quick plausibility check before anything is stored. */
export function looksLikeOvpn(text: string): boolean {
  const t = normaliseOvpn(text);
  return /^\s*remote\s+\S+/m.test(t) && (/^\s*client\s*$/m.test(t) || /^\s*tls-client\b/m.test(t));
}

/** The credentials file OpenVPN reads: username on the first line, password on the second. */
export function ovpnAuthFile(username: string, password: string): string {
  return `${username.replace(/[\r\n]/g, '')}\n${password.replace(/[\r\n]/g, '')}\n`;
}

/** Why a profile is refused, in one sentence the setup page can show. Null when it is usable. */
export function ovpnRefusal(s: OvpnSanitised, haveCredentials: boolean): string | null {
  if (s.problems.length) return `This profile cannot work: ${s.problems.join(' ')}`;
  if (s.externalFiles.length) {
    return `This profile points at files that are not on the vehicle (${s.externalFiles.join(', ')}). ` +
      'Export it with the certificates inline (one file containing <ca>…</ca>, <cert>…</cert>, <key>…</key>) — most servers and routers offer that.';
  }
  if (s.needsAuth && !haveCredentials) return 'This profile asks for a username and password — enter them and bring it up again.';
  return null;
}

/**
 * The last thing OpenVPN said, translated. Its log is precise but written for people who
 * run OpenVPN servers; the operator needs the cause and the next step.
 */
export function explainOvpnLog(lines: string[]): string | null {
  const text = lines.join('\n');
  if (/AUTH_FAILED/i.test(text)) return 'the server rejected the username/password.';
  if (/Initialization Sequence Completed/i.test(text)) return null;
  if (/Cannot resolve host address|RESOLVE: Cannot resolve/i.test(text)) return "the server's name cannot be resolved — does the vehicle have internet?";
  if (/TLS key negotiation failed|TLS handshake failed/i.test(text)) return 'no answer from the server — check its address and port, and that it is reachable from the vehicle’s uplink.';
  if (/Options error|Unrecognized option/i.test(text)) {
    const m = /Options error:\s*(.+)/i.exec(text);
    return `this OpenVPN does not accept an option in the profile${m ? `: ${m[1].trim()}` : ''}.`;
  }
  if (/VERIFY ERROR|certificate verify failed/i.test(text)) return 'the server certificate does not match the CA in the profile.';
  if (/Connection refused|ECONNREFUSED/i.test(text)) return 'the server refused the connection — wrong port or protocol (udp/tcp)?';
  return null;
}
