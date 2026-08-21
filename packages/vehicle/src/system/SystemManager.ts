import type { LinkSignal } from '@yonderrc/protocol';
import type { I2cSuggestion } from './detect.js';
import type { HwDepName } from './hwDeps.js';
import type { WifiRadioStatus } from './wifi.js';

/** Result of a hardware probe (see detectHardware). */
export interface DetectResult {
  i2c: I2cSuggestion[];
  modemPresent: boolean;
  cameras: string[];
  /** Serial device candidates for a GPS receiver (/dev/ttyAMA0, ttyUSB*, ttyACM*). */
  serial: string[];
  notes: string[];
}

/** One native driver module and whether this vehicle actually has it. */
/**
 * Result of starting the onboarding hotspot. Carries the radio state so the setup
 * UI can offer the one-click repair, and the key the AP actually ended up with —
 * NetworkManager invents one if asked for a hotspot without a password, and an AP
 * whose key nobody knows is worse than no AP at all.
 */
export interface HotspotResult extends ActionResult {
  fix?: string;
  /** The WPA key in force, or null for an open network. */
  psk?: string | null;
  radio?: WifiRadioStatus;
}

export interface HwDepStatus {
  name: HwDepName;
  installed: boolean;
  /** Installed version when we could read it (a package may hide its package.json). */
  version: string | null;
  /** What it is needed for — copy for the setup UI. */
  needFor: string;
}

/**
 * Result of installing a native driver module. Carries the npm log tail on
 * purpose: this runs on a vehicle the operator may only reach from a phone, so
 * "it failed" without the reason would send them looking for a terminal again.
 */
export interface HwDepInstallResult extends ActionResult {
  /** Tail of the npm output, success or failure. */
  output: string;
  /** Concrete next step when it failed. */
  fix?: string;
  /** The module is only picked up after the vehicle service restarts. */
  restartRequired?: boolean;
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
  /**
   * When the onboarding hotspot starts at boot:
   *  - auto   : only when the Pi has no uplink at all (the historic behaviour)
   *  - always : also next to a working LTE link, so the vehicle stays reachable
   *             on the field for diagnostics even when the modem or the VPN is fine
   *  - off    : never (you always reach the vehicle some other way)
   * "always" cannot override physics: with one radio the Pi is either an access
   * point or a WiFi client, so an active WiFi client connection always wins.
   */
  mode?: HotspotMode;
}

export type HotspotMode = 'auto' | 'always' | 'off';

export const HOTSPOT_DEFAULTS: HotspotConfig = { ssid: 'YonderRC-setup', password: null, mode: 'auto' };

/**
 * Should the boot-time onboarding start the hotspot? Pure so the decision is
 * testable; `onboard.sh` mirrors it in shell.
 *
 * `wifiIsClient` is the hard stop: one radio can't serve an AP and stay joined to
 * a network, and tearing down the WiFi link would cut the vehicle off the LAN.
 */
export function shouldStartHotspot(
  mode: HotspotMode | undefined,
  hasUplink: boolean,
  wifiIsClient: boolean,
): { start: boolean; reason: string } {
  if (mode === 'off') return { start: false, reason: 'hotspot disabled in the config' };
  if (wifiIsClient) return { start: false, reason: 'wlan0 is joined to a WiFi network (one radio)' };
  if (mode === 'always') return { start: true, reason: 'hotspot mode "always"' };
  return hasUplink
    ? { start: false, reason: 'uplink present — no hotspot needed' }
    : { start: true, reason: 'no uplink' };
}

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
  hotspotStart(cfg: HotspotConfig): Promise<HotspotResult>;
  /** Radio state: blocked? which regulatory country? what would we suggest? */
  wifiRadio(): Promise<WifiRadioStatus>;
  /** Unblock the radio (and set the WiFi country if one is given/derivable). */
  wifiRadioEnable(country?: string | null): Promise<ActionResult & { radio: WifiRadioStatus }>;
  /** Take the onboarding hotspot down (leaves any other connection alone). */
  hotspotStop(): Promise<ActionResult>;
  /** Bring Tailscale up. With an auth key it's non-interactive; without, returns a login URL. */
  tailscaleUp(authKey?: string): Promise<ActionResult>;
  tailscaleDown(): Promise<ActionResult>;
  /** Generic remote-access control (dispatches by cfg.kind). */
  remoteUp(cfg: RemoteAccessConfig): Promise<ActionResult>;
  remoteDown(cfg: RemoteAccessConfig): Promise<ActionResult>;
  remoteStatus(cfg: RemoteAccessConfig): Promise<RemoteAccessStatus>;
  /** Which native driver modules (i2c-bus/pigpio/serialport) are installed. */
  hwDeps(): Promise<HwDepStatus[]>;
  /** Install one allowlisted native driver module via npm (slow: it compiles). */
  hwDepInstall(name: HwDepName): Promise<HwDepInstallResult>;
  /** Restart the vehicle service itself, so a freshly installed driver is picked up. */
  restartService(): Promise<ActionResult>;
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
