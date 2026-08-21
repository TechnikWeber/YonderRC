/**
 * Huawei "HiLink" LTE sticks (E3372h-320, E8372, …).
 *
 * These are not modems in the ModemManager sense: the stick runs its own router,
 * appears as a USB Ethernet interface with DHCP, and dials on its own. `mmcli -L`
 * stays empty forever, which is why the LTE panel could only ever say "no modem".
 * Everything the stick knows — operator, network type, signal, WAN IP — is behind a
 * small XML API on its web UI, so that is where we read it from.
 *
 * Design rules:
 *  - **Never identify the stick by interface name.** A vehicle on a FritzBox LAN has
 *    eth0 and the stick on eth1 (or the other way round after a reboot); guessing by
 *    name would eventually report the LAN as "LTE" or dial through the wrong link.
 *    The routing table is asked instead: whichever interface routes to the stick's
 *    address *is* the stick.
 *  - All parsing is pure and unit-tested; the HTTP call is injected, so the whole
 *    flow can be exercised with recorded XML instead of hardware.
 */

import type { LteStatus } from './SystemManager.js';

export const HILINK_DEFAULT_HOST = '192.168.8.1';

/** Only a literal IPv4 address is accepted — this value ends up as a proxy target. */
export function isIpv4(host: unknown): host is string {
  if (typeof host !== 'string') return false;
  const parts = host.split('.');
  return parts.length === 4 && parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) <= 255);
}

/** Flat tag → text map of a HiLink XML document. The documents are one level deep. */
export function parseHilinkXml(xml: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /<([A-Za-z_][\w:-]*)>([^<]*)<\/\1>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml ?? '')) !== null) out[m[1]] = m[2].trim();
  return out;
}

/** HiLink reports failures as `<error><code>100003</code>…`, with HTTP 200. */
export function hilinkError(xml: string): string | null {
  if (!/<error>/i.test(xml ?? '')) return null;
  const v = parseHilinkXml(xml);
  const code = v.code ?? '?';
  const known: Record<string, string> = {
    '100002': 'the stick does not support this request',
    '100003': 'the stick refused the request (no session — log out of its web UI and try again)',
    '108001': 'wrong login',
    '125001': 'the stick wants a fresh session token',
    '125002': 'the session expired',
    '125003': 'the session token was rejected',
  };
  return known[code] ?? `the stick returned error ${code}`;
}

/**
 * `CurrentNetworkType` / `CurrentNetworkTypeEx`. Anything unmapped is reported with
 * its code rather than silently as "unknown" — a stick on a network we mislabel is
 * worse than one we admit we don't recognise.
 */
export function networkTypeLabel(code: string | undefined): string | null {
  if (!code) return null;
  const map: Record<string, string> = {
    '0': 'no service',
    '1': '2G (GSM)',
    '2': '2G (GPRS)',
    '3': '2G (EDGE)',
    '4': '3G (WCDMA)',
    '5': '3G (HSDPA)',
    '6': '3G (HSUPA)',
    '7': '3G (HSPA)',
    '9': '3G (HSPA+)',
    '19': '4G (LTE)',
    '41': '3G (WCDMA)',
    '44': '3G (HSPA)',
    '45': '3G (HSPA+)',
    '46': '3G (DC-HSPA+)',
    '64': '3G (HSPA)',
    '65': '3G (HSPA+)',
    '101': '4G (LTE)',
    '102': '4G+ (LTE-A)',
    '111': '5G (NSA)',
    '112': '5G (SA)',
  };
  return map[code] ?? `unknown network type (${code})`;
}

/** 901 = connected; the others are the states worth naming. */
export function connectionStatusLabel(code: string | undefined): { connected: boolean; label: string } {
  const map: Record<string, string> = {
    '900': 'connecting',
    '901': 'connected',
    '902': 'disconnected',
    '903': 'disconnecting',
    '904': 'connection failed',
    '905': 'no reconnect',
    '906': 'connection failed (roaming not allowed)',
    '907': 'no SIM / SIM error',
    '908': 'SIM PIN required',
    '909': 'SIM PUK required',
  };
  return { connected: code === '901', label: map[code ?? ''] ?? (code ? `state ${code}` : 'unknown') };
}

/** "-95dBm" → -95. HiLink appends the unit to every number. */
export function dbmValue(raw: string | undefined): number | null {
  if (!raw) return null;
  const m = raw.match(/-?\d+(\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Signal as a percentage for the OSD. RSRP is the honest measure on LTE
 * (−140 dBm = unusable … −75 dBm = excellent); the stick's own 0–5 bar icon is the
 * fallback, because some firmwares leave RSRP empty.
 */
export function signalPercent(opts: { rsrp?: number | null; signalIcon?: string | null }): number | null {
  if (opts.rsrp != null && Number.isFinite(opts.rsrp)) {
    const pct = ((opts.rsrp + 140) / 65) * 100;
    return Math.max(0, Math.min(100, Math.round(pct)));
  }
  const bars = Number(opts.signalIcon);
  if (Number.isFinite(bars) && bars >= 0 && bars <= 5) return Math.round((bars / 5) * 100);
  return null;
}

/**
 * The interface that routes to the stick, from `ip route get <host>`:
 *   "192.168.8.1 dev eth1 src 192.168.8.100 uid 1000"
 * This is what keeps a LAN (FritzBox on eth0) from ever being taken for the LTE link.
 */
export function parseRouteDev(out: string): string | null {
  const m = (out ?? '').match(/\bdev\s+([\w.@-]+)/);
  return m ? m[1] : null;
}

export interface HilinkStatus {
  /** The stick answered at all. */
  present: boolean;
  /** Interface it is reachable through (from the routing table, never guessed). */
  iface: string | null;
  connected: boolean;
  /** Human state: connected / SIM PIN required / no SIM … */
  state: string;
  networkType: string | null;
  operator: string | null;
  signalPercent: number | null;
  rsrp: number | null;
  rsrq: number | null;
  sinr: number | null;
  model: string | null;
  wanIp: string | null;
  /** Why there is nothing to show, when present=false. */
  message: string | null;
}

export const HILINK_ABSENT: HilinkStatus = {
  present: false,
  iface: null,
  connected: false,
  state: 'no HiLink stick found',
  networkType: null,
  operator: null,
  signalPercent: null,
  rsrp: null,
  rsrq: null,
  sinr: null,
  model: null,
  wanIp: null,
  message: null,
};

/** One HTTP GET against the stick. Injected so the flow is testable without one. */
export type HilinkGet = (path: string, headers: Record<string, string>) => Promise<{
  ok: boolean;
  status: number;
  text: string;
  /** Set-Cookie of the response, used to carry the SessionID. */
  cookie: string | null;
}>;

/**
 * Read everything worth showing. Newer firmware rejects API calls without a session,
 * so a token is fetched first and passed along; if that step fails we still try the
 * plain calls, because older sticks don't need it.
 */
export async function readHilink(get: HilinkGet, iface: string | null): Promise<HilinkStatus> {
  let headers: Record<string, string> = {};
  const ses = await get('/api/webserver/SesTokInfo', {}).catch(() => null);
  if (ses?.ok) {
    const v = parseHilinkXml(ses.text);
    const sid = (v.SesInfo ?? '').trim();
    const tok = (v.TokInfo ?? '').trim();
    headers = {
      ...(sid ? { cookie: sid.startsWith('SessionID=') ? sid : `SessionID=${sid}` } : {}),
      ...(tok ? { __RequestVerificationToken: tok } : {}),
    };
  }

  const status = await get('/api/monitoring/status', headers).catch(() => null);
  if (!status || !status.ok) {
    return { ...HILINK_ABSENT, iface, message: 'The stick did not answer its API.' };
  }
  const err = hilinkError(status.text);
  if (err) return { ...HILINK_ABSENT, present: true, iface, state: 'API error', message: err };

  const s = parseHilinkXml(status.text);
  const conn = connectionStatusLabel(s.ConnectionStatus);

  const [signal, plmn, info] = await Promise.all([
    get('/api/device/signal', headers).catch(() => null),
    get('/api/net/current-plmn', headers).catch(() => null),
    get('/api/device/information', headers).catch(() => null),
  ]);
  const sig = signal?.ok ? parseHilinkXml(signal.text) : {};
  const net = plmn?.ok ? parseHilinkXml(plmn.text) : {};
  const dev = info?.ok ? parseHilinkXml(info.text) : {};

  const rsrp = dbmValue(sig.rsrp);
  return {
    present: true,
    iface,
    connected: conn.connected,
    state: conn.label,
    networkType: networkTypeLabel(s.CurrentNetworkTypeEx || s.CurrentNetworkType),
    operator: net.FullName || net.ShortName || null,
    signalPercent: signalPercent({ rsrp, signalIcon: s.SignalIcon ?? null }),
    rsrp,
    rsrq: dbmValue(sig.rsrq),
    sinr: dbmValue(sig.sinr),
    model: dev.DeviceName || null,
    wanIp: dev.WanIPAddress || s.WanIPAddress || null,
    message: null,
  };
}

/**
 * Present a HiLink stick as the vehicle's LTE status. Without this the status panel
 * says "no modem" while the vehicle is happily online over that very stick — the APN
 * stays null on purpose, because it lives inside the stick and we cannot set it.
 */
export function hilinkAsLte(h: HilinkStatus): LteStatus {
  return {
    present: true,
    connected: h.connected,
    operator: h.operator,
    signal: h.signalPercent,
    apn: null,
    iface: h.iface,
    ip: h.wanIp,
    state: h.state,
    modemModel: h.model ? `${h.model} (HiLink)` : 'HiLink stick',
    pinRequired: /PIN/i.test(h.state),
    kind: 'hilink',
  };
}

/**
 * Label for the OSD link block. "LTE 72%" on 4G — repeating "4G (LTE)" after it adds
 * nothing — but a **2G/3G fallback is spelled out**, because that is the moment video
 * stops working and the pilot needs to know why.
 */
export function hilinkOsdLabel(h: HilinkStatus): string {
  const pct = h.signalPercent != null ? ` ${h.signalPercent}%` : '';
  if (!h.networkType) return `LTE${pct}`;
  if (h.networkType.startsWith('4G') || h.networkType.startsWith('5G')) {
    return `${h.networkType.startsWith('5G') ? '5G' : 'LTE'}${pct}`;
  }
  return `${h.networkType}${pct}`;
}
