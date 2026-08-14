import type { LinkSignal } from '@yonderrc/protocol';
import type { I2cSuggestion } from './detect.js';

/** Result of a hardware probe (see detectHardware). */
export interface DetectResult {
  i2c: I2cSuggestion[];
  modemPresent: boolean;
  cameras: string[];
  /** Serial device candidates for a GPS receiver (/dev/ttyAMA0, ttyUSB*, ttyACM*). */
  serial: string[];
  notes: string[];
}

/**
 * SystemManager is the seam between YonderRC and the Pi's OS-level networking:
 * the LTE modem, Tailscale, and the WiFi AP/client mode used for headless
 * onboarding. Like the OutputDriver, it has a real implementation (shells out to
 * mmcli/nmcli/tailscale) and a sim implementation (mock state), so the whole
 * setup UI runs and is testable on a dev machine with no modem and no Pi.
 */
export interface TailscaleStatus {
  installed: boolean;
  running: boolean;
  ip: string | null;
  /** Interactive login URL, present when `up` needs the user to authenticate. */
  loginUrl: string | null;
  backendState: string; // e.g. "Running", "NeedsLogin", "Stopped"
}

export interface LteStatus {
  present: boolean;
  connected: boolean;
  operator: string | null;
  /** Signal quality 0..100, or null if unknown. */
  signal: number | null;
  apn: string | null;
  iface: string | null;
  ip: string | null;
  /** Human-readable modem state: 'connected','registered','searching','locked','sim-missing','no-modem',… */
  state?: string;
  /** Modem model, e.g. "Quectel EG25-G". */
  modemModel?: string | null;
  /** SIM PIN needed before it can register. */
  pinRequired?: boolean;
}

/** LTE dial settings. apn is the minimum; the rest cover non-plug-and-play sticks. */
export interface LteConfig {
  apn: string | null;
  /** SIM PIN (secret) — unlocked before dialing. */
  pin?: string | null;
  /** APN username/password (secret) for carriers that require PAP/CHAP auth. */
  username?: string | null;
  password?: string | null;
  /** Allowed radio modes: 'auto' (default) or force '4g' / '3g'. */
  networkMode?: 'auto' | '4g' | '3g';
  /** Allow data roaming. Undefined/true = NM default (roam ok); false = home-only. */
  allowRoaming?: boolean;
}

/** Change or remove the SIM's PIN lock (operates on the SIM itself, not the config). */
export interface LtePinChange {
  /** 'change' the PIN to newPin, or 'disable' the PIN lock entirely. */
  action: 'change' | 'disable';
  currentPin: string;
  /** New PIN for action 'change'. */
  newPin?: string;
}

export interface WifiStatus {
  mode: 'client' | 'ap' | 'unknown';
  ssid: string | null;
  ip: string | null;
}

/** One network from a scan. */
export interface WifiNetwork {
  ssid: string;
  /** 0..100 as reported by NetworkManager. */
  signal: number;
  /** False for an open network. */
  secured: boolean;
  /** Already connected to this one. */
  active: boolean;
}

/**
 * The onboarding hotspot. An **open** AP by default: the captive portal then puts
 * the setup page in front of the operator with nothing to type, and a shared
 * default password published in the README protected nothing anyway. Set a
 * password here once the vehicle leaves the bench.
 */
export interface HotspotConfig {
  ssid: string;
  /** null/'' = open network. WPA2 needs at least 8 characters. */
  password: string | null;
}

export const HOTSPOT_DEFAULTS: HotspotConfig = { ssid: 'YonderRC-setup', password: null };

/**
 * Parse `nmcli -t -f IN-USE,SIGNAL,SECURITY,SSID dev wifi list`. Terse output is
 * colon-separated with `\:` escaping inside fields (SSIDs may contain colons),
 * so unescape before use. Hidden networks (empty SSID) are dropped, duplicates
 * (same SSID on several bands) collapse to the strongest, and the result is
 * sorted strongest first.
 */
export function parseWifiScan(out: string): WifiNetwork[] {
  const best = new Map<string, WifiNetwork>();
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    // Split on unescaped colons, then unescape.
    const parts = line.split(/(?<!\\):/).map((p) => p.replace(/\\:/g, ':'));
    const [inUse, signalRaw, security, ...rest] = parts;
    const ssid = rest.join(':').trim();
    if (!ssid) continue;
    const signal = Number(signalRaw);
    const net: WifiNetwork = {
      ssid,
      signal: Number.isFinite(signal) ? signal : 0,
      secured: !!security && security.trim() !== '' && security.trim() !== '--',
      active: inUse.trim() === '*',
    };
    const prev = best.get(ssid);
    if (!prev || net.signal > prev.signal) best.set(ssid, { ...net, active: net.active || !!prev?.active });
  }
  return [...best.values()].sort((a, b) => b.signal - a.signal);
}

/**
 * nmcli arguments that create the onboarding hotspot. Without a password the
 * hotspot is open; nmcli rejects a WPA key shorter than 8 characters, so a too
 * short one is treated as "no password" rather than failing the whole bring-up.
 */
export function hotspotArgs(cfg: HotspotConfig, iface = 'wlan0'): string[] {
  const args = ['device', 'wifi', 'hotspot', 'ifname', iface, 'ssid', cfg.ssid || HOTSPOT_DEFAULTS.ssid];
  if (cfg.password && cfg.password.length >= 8) args.push('password', cfg.password);
  return args;
}

export interface SystemStatus {
  kind: string; // "sim" | "real"
  hostname: string;
  tailscale: TailscaleStatus;
  lte: LteStatus;
  wifi: WifiStatus;
}

export interface ActionResult {
  ok: boolean;
  message: string;
  /** For Tailscale: a login URL the user must open to finish authentication. */
  loginUrl?: string;
}

/**
 * Remote access = how the vehicle stays reachable behind CGNAT/LTE. One method is
 * active at a time. Mesh VPNs (Tailscale, ZeroTier) need no VPS; WireGuard connects
 * the Pi as a peer to a WireGuard server you already run — e.g. a FritzBox, whose
 * exported `.conf` you upload here.
 */
export type RemoteAccessKind = 'none' | 'tailscale' | 'zerotier' | 'wireguard';

export interface RemoteAccessConfig {
  kind: RemoteAccessKind;
  /** Tailscale: optional pre-auth key (non-interactive up). */
  tailscaleAuthKey?: string | null;
  /** ZeroTier: the 16-hex network ID to join. */
  zerotierNetworkId?: string | null;
  /** WireGuard: the full `.conf` text (e.g. a FritzBox export), applied verbatim. */
  wireguardConf?: string | null;
}

export interface RemoteAccessStatus {
  kind: RemoteAccessKind;
  running: boolean;
  /** VPN-assigned address, when known. */
  address: string | null;
  /** Short human-readable state. */
  detail: string;
  /** Present when an interactive login is required (Tailscale). */
  loginUrl?: string | null;
}

export interface SystemManager {
  readonly kind: string;
  status(): Promise<SystemStatus>;
  lteConnect(cfg: LteConfig): Promise<ActionResult>;
  lteDisconnect(): Promise<ActionResult>;
  /** Change or remove the SIM's PIN lock. */
  lteSetPin(change: LtePinChange): Promise<ActionResult>;
  /** Raw modem diagnostics (mmcli) for troubleshooting a non-plug-and-play stick. */
  lteDiagnostics(): Promise<{ ok: boolean; output: string }>;
  /** Current uplink signal (LTE preferred, else WiFi) for the OSD link health. */
  linkSignal(): Promise<LinkSignal>;
  /** Probe attached hardware (I²C devices, modem, cameras) to suggest a config. */
  detectHardware(): Promise<DetectResult>;
  /** Nearby WiFi networks (triggers a rescan). */
  wifiScan(): Promise<WifiNetwork[]>;
  /**
   * Join a WiFi network. On a single-radio Pi this tears down the onboarding
   * hotspot, so the caller loses the connection it asked over; on failure the
   * hotspot is brought back up so the vehicle can't lock itself out.
   */
  wifiConnect(ssid: string, password: string | null): Promise<ActionResult>;
  /** (Re)start the onboarding hotspot with the given settings. */
  hotspotStart(cfg: HotspotConfig): Promise<ActionResult>;
  /** Bring Tailscale up. With an auth key it's non-interactive; without, returns a login URL. */
  tailscaleUp(authKey?: string): Promise<ActionResult>;
  tailscaleDown(): Promise<ActionResult>;
  /** Generic remote-access control (dispatches by cfg.kind). */
  remoteUp(cfg: RemoteAccessConfig): Promise<ActionResult>;
  remoteDown(cfg: RemoteAccessConfig): Promise<ActionResult>;
  remoteStatus(cfg: RemoteAccessConfig): Promise<RemoteAccessStatus>;
  reboot(): Promise<ActionResult>;
}

/** Strip secrets (auth key, WG conf) from a remote config for safe display. */
export function redactRemoteConfig(cfg: RemoteAccessConfig): Record<string, unknown> {
  return {
    kind: cfg.kind,
    zerotierNetworkId: cfg.zerotierNetworkId ?? null,
    hasTailscaleAuthKey: !!cfg.tailscaleAuthKey,
    hasWireguardConf: !!cfg.wireguardConf,
  };
}

/** Normalise an uploaded WireGuard conf: LF line endings, single trailing newline. */
export function normaliseWireguardConf(conf: string): string {
  return conf.replace(/\r\n?/g, '\n').trim() + '\n';
}

/** A plausible WireGuard conf has an [Interface] section with a PrivateKey. */
export function looksLikeWireguardConf(conf: string): boolean {
  return /\[Interface\]/i.test(conf) && /PrivateKey\s*=/.test(conf) && /\[Peer\]/i.test(conf);
}

/** A ZeroTier network ID is 16 hex chars. */
export function isZerotierNetworkId(id: string): boolean {
  return /^[0-9a-fA-F]{16}$/.test(id.trim());
}
