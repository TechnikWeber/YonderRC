/**
 * Keeps the remote-access tunnel pointed at the network the vehicle is actually on
 * (v1.73).
 *
 * Two failures a tester and the WireGuard docs describe, both invisible until the
 * vehicle is unreachable:
 *  - **OpenVPN after a network change.** Moving from the home WiFi to a phone hotspot
 *    leaves the tunnel on a dead path; OpenVPN only notices at its ping-restart (60–
 *    120 s, set by the server) and then backs off. When the uplink key changes
 *    (`uplink.ts`), the keeper tells OpenVPN to reconnect at once (SIGUSR1).
 *  - **WireGuard and DynDNS.** wg-quick resolves the server's name once. When a home
 *    router's address changes, the tunnel stays dead until a restart. Every half
 *    minute, for a peer whose handshake is stale, the name is looked up again and the
 *    endpoint set when the address moved.
 *
 * Tailscale and ZeroTier roam on their own; for them, and with no remote access, the
 * keeper does nothing at all — not even read the routing table. The decision is pure
 * (`decideUplink`); the class only schedules it and does what it says.
 */
import type { ActionResult, RemoteAccessConfig } from './SystemManager.js';

/** Never reconnect more often than this — a flapping uplink must not keep the tunnel down. */
export const RECONNECT_MIN_GAP_MS = 15_000;
/** How often the uplink is compared. */
export const KEEPER_POLL_MS = 5_000;
/** How often a WireGuard peer with a name for an endpoint is checked. */
export const WG_RERESOLVE_EVERY_MS = 30_000;

export interface UplinkState {
  /** The last uplink seen ('' = none), or null before the first look. */
  key: string | null;
  /** A change is waiting for the rate limit to pass. */
  pending: boolean;
  lastReconnectAt: number;
  reconnects: number;
}

export const UPLINK_INITIAL: UplinkState = { key: null, pending: false, lastReconnectAt: 0, reconnects: 0 };

/**
 * Reconnect when the uplink changed to one that exists. The first look only records
 * (the tunnel was just started on it); losing the uplink altogether waits for the next
 * one (there is nothing to reconnect over); a change inside the rate limit waits.
 */
export function decideUplink(state: UplinkState, key: string, now: number): { state: UplinkState; reconnect: boolean } {
  if (state.key === null) return { state: { ...state, key, pending: false }, reconnect: false };
  const wanted = (state.pending || key !== state.key) && key !== '';
  if (!wanted) return { state: { ...state, key, pending: false }, reconnect: false };
  if (now - state.lastReconnectAt < RECONNECT_MIN_GAP_MS) return { state: { ...state, key, pending: true }, reconnect: false };
  return {
    state: { key, pending: false, lastReconnectAt: now, reconnects: state.reconnects + 1 },
    reconnect: true,
  };
}

/** What the keeper needs from the system — RealSystem and SimSystem both have it. */
export interface KeeperSystem {
  uplinkKey(): Promise<string>;
  openvpnReconnect(): Promise<ActionResult>;
  wireguardReresolve(conf: string): Promise<{ updated: string[] }>;
}

/** For the diagnostics file and the setup page. */
export interface KeeperSnapshot {
  uplink: string | null;
  reconnects: number;
  lastReconnectAt: string | null;
  lastEvent: string | null;
}

export class RemoteKeeper {
  private uplink: UplinkState = { ...UPLINK_INITIAL };
  private lastReresolveAt = 0;
  private lastEvent: string | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private watchedKind: string | null = null;

  constructor(
    private readonly system: KeeperSystem,
    private readonly config: () => RemoteAccessConfig,
    private readonly log: (m: string) => void = (m) => console.log(m),
    private readonly now: () => number = () => Date.now(),
  ) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), KEEPER_POLL_MS);
    // Never keep the process alive on its own.
    (this.timer as { unref?: () => void }).unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  snapshot(): KeeperSnapshot {
    return {
      uplink: this.uplink.key,
      reconnects: this.uplink.reconnects,
      lastReconnectAt: this.uplink.lastReconnectAt ? new Date(this.uplink.lastReconnectAt).toISOString() : null,
      lastEvent: this.lastEvent,
    };
  }

  /** One poll. Exposed for tests; overlapping calls are skipped. */
  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      const cfg = this.config();
      // A method switch starts from a clean slate: its tunnel was just brought up on
      // whatever uplink there is now.
      if (cfg.kind !== this.watchedKind) {
        this.watchedKind = cfg.kind;
        this.uplink = { ...UPLINK_INITIAL, reconnects: this.uplink.reconnects };
      }
      if (cfg.kind === 'openvpn') await this.keepOpenvpn();
      else if (cfg.kind === 'wireguard' && cfg.wireguardConf) await this.keepWireguard(cfg.wireguardConf);
    } catch (e) {
      this.log(`[remote] keeper: ${(e as Error).message}`);
    } finally {
      this.busy = false;
    }
  }

  private async keepOpenvpn(): Promise<void> {
    const key = await this.system.uplinkKey();
    const before = this.uplink.key;
    const d = decideUplink(this.uplink, key, this.now());
    this.uplink = d.state;
    if (!d.reconnect) return;
    const r = await this.system.openvpnReconnect();
    this.lastEvent = `uplink changed (${before || 'none'} → ${key}) — ${r.ok ? 'OpenVPN reconnecting' : `reconnect failed: ${r.message}`}`;
    this.log(`[remote] ${this.lastEvent}`);
  }

  private async keepWireguard(conf: string): Promise<void> {
    const now = this.now();
    if (now - this.lastReresolveAt < WG_RERESOLVE_EVERY_MS) return;
    this.lastReresolveAt = now;
    const r = await this.system.wireguardReresolve(conf);
    if (!r.updated.length) return;
    this.lastEvent = `WireGuard endpoint looked up again: ${r.updated.join(', ')}`;
    this.log(`[remote] ${this.lastEvent}`);
  }
}
