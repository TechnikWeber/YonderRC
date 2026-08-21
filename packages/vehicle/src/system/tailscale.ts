/**
 * Pure parsing for `tailscale status --json`.
 *
 * The login URL matters most here. `tailscale up` blocks until the device is
 * authorised and only prints the URL once tailscaled has reached the control
 * plane — which is why waiting one second for it and scraping stdout produced
 * "Tailscale is starting" and no link, leaving the operator at `NeedsLogin` with
 * nothing to click. The daemon publishes the same URL as `AuthURL` in its status,
 * so that is what we read, and it stays readable for as long as the login is
 * pending (a page reload no longer loses it).
 */

export interface TailscaleStatusInfo {
  backendState: string;
  running: boolean;
  /** Pending login URL, or null when no login is in progress. */
  authUrl: string | null;
  /** The vehicle's own IPv4 in the tailnet. */
  ip: string | null;
}

const EMPTY: TailscaleStatusInfo = { backendState: 'Unknown', running: false, authUrl: null, ip: null };

export function parseTailscaleStatus(json: string): TailscaleStatusInfo {
  try {
    const s = JSON.parse(json ?? '') as {
      BackendState?: string;
      AuthURL?: string;
      Self?: { TailscaleIPs?: string[] };
    };
    const backendState = s.BackendState ?? 'Unknown';
    const ip = (s.Self?.TailscaleIPs ?? []).find((a) => /^\d+\.\d+\.\d+\.\d+$/.test(a)) ?? null;
    return {
      backendState,
      running: backendState === 'Running',
      authUrl: (s.AuthURL ?? '').trim() || null,
      ip,
    };
  } catch {
    return { ...EMPTY };
  }
}
