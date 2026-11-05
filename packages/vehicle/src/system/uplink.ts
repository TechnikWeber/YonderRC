/**
 * Which way the vehicle's own traffic leaves — so a VPN can be told the moment that
 * changes (v1.73).
 *
 * A tester's OpenVPN tunnel survived a WiFi drop poorly: when the vehicle moved from
 * the home WiFi to a phone hotspot, the old UDP path was dead but OpenVPN only noticed
 * at its ping-restart, a minute or two later — and then backed off. RemoteKeeper
 * compares this key on every poll and reconnects the tunnel when it changes.
 * WireGuard and Tailscale roam by themselves and need nothing here.
 *
 * The key is read from `/proc/net/route` — the main routing table, so the routes a VPN
 * adds in tables of its own (wg-quick, Tailscale) or as /1 halves (OpenVPN's
 * redirect-gateway def1) never count as the uplink — plus the interface's own address,
 * because two networks can share a gateway address (192.168.1.1 is everywhere) but
 * rarely hand out the same address to the vehicle as well. Pure; RealSystem reads.
 */

export interface DefaultRoute {
  dev: string;
  /** Gateway in dotted form, or null for a route straight onto the link. */
  via: string | null;
  metric: number;
}

/**
 * Interfaces that are tunnels themselves — never the uplink a tunnel rides on. (ppp is
 * not one of them here: a 3G modem dialled over PPP is a real uplink.)
 */
export function isTunnelIface(name: string): boolean {
  return /^(tun|tap|wg|tailscale|zt|yonderrc)/.test(name);
}

/** `/proc/net/route` stores IPv4 addresses as little-endian hex: 0101A8C0 → 192.168.1.1. */
export function hexToIpv4(hex: string): string | null {
  if (!/^[0-9a-fA-F]{8}$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff].join('.');
}

/** Every default route (0.0.0.0/0, up) in `/proc/net/route`, best — lowest metric — first. */
export function parseDefaultRoutes(text: string): DefaultRoute[] {
  const out: DefaultRoute[] = [];
  for (const line of (text ?? '').split('\n').slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 8) continue;
    const [dev, dest, gw, flagsHex, , , metricRaw, mask] = f;
    const flags = parseInt(flagsHex, 16);
    if (dest !== '00000000' || mask !== '00000000' || !(flags & 0x1)) continue; // default + RTF_UP
    const via = gw === '00000000' ? null : hexToIpv4(gw);
    out.push({ dev, via, metric: Number(metricRaw) || 0 });
  }
  return out.sort((a, b) => a.metric - b.metric);
}

/**
 * The uplink as one comparable string: `wlan0 via 192.168.1.1 src 192.168.1.50`, or ''
 * when the vehicle has no way out at all. `addressOf` names an interface's own IPv4
 * address (os.networkInterfaces on the vehicle).
 */
export function uplinkKey(routes: readonly DefaultRoute[], addressOf: (dev: string) => string | null): string {
  const r = routes.find((x) => !isTunnelIface(x.dev));
  if (!r) return '';
  const src = addressOf(r.dev);
  return `${r.dev}${r.via ? ` via ${r.via}` : ''}${src ? ` src ${src}` : ''}`;
}
