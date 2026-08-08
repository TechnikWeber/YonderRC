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
}

export interface WifiStatus {
  mode: 'client' | 'ap' | 'unknown';
  ssid: string | null;
  ip: string | null;
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

export interface SystemManager {
  readonly kind: string;
  status(): Promise<SystemStatus>;
  lteConnect(apn: string): Promise<ActionResult>;
  lteDisconnect(): Promise<ActionResult>;
  /** Bring Tailscale up. With an auth key it's non-interactive; without, returns a login URL. */
  tailscaleUp(authKey?: string): Promise<ActionResult>;
  tailscaleDown(): Promise<ActionResult>;
  reboot(): Promise<ActionResult>;
}
