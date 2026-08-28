/**
 * How much mobile data this vehicle has spent.
 *
 * The problem it solves is specific: an FPV link is a video stream, and a video stream
 * eats a data plan quietly. There is no symptom until the plan is empty, and then the
 * symptom is that the vehicle is gone. A warning at 80 % of a known budget is worth
 * more than an exact number at 100 %.
 *
 * Everything here is pure so it can be tested without a Pi; the file reads and the
 * timer live in TrafficService.
 */

/** One interface's byte counters, exactly as /proc/net/dev reports them. */
export interface IfaceBytes {
  name: string;
  rx: number;
  tx: number;
}

/**
 * Parse /proc/net/dev. Two header lines, then one row per interface:
 *
 *   Inter-|   Receive                            |  Transmit
 *    face |bytes    packets errs drop fifo frame compressed multicast|bytes …
 *      lo: 12345      120    0    0    0     0          0         0   12345 …
 *
 * The name can carry a colon with no space before the numbers, and an interface with a
 * huge counter can run the name into the first field — so split on the LAST colon of
 * the name field rather than on whitespace.
 */
export function parseProcNetDev(text: string): IfaceBytes[] {
  const out: IfaceBytes[] = [];
  for (const line of String(text).split('\n')) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const name = line.slice(0, colon).trim();
    if (!name || name.includes('|')) continue; // header rows
    const cols = line
      .slice(colon + 1)
      .trim()
      .split(/\s+/)
      .map(Number);
    // rx bytes is column 0, tx bytes is column 8.
    if (cols.length < 9) continue;
    const rx = cols[0];
    const tx = cols[8];
    if (!Number.isFinite(rx) || !Number.isFinite(tx)) continue;
    out.push({ name, rx, tx });
  }
  return out;
}

/**
 * Interfaces whose bytes cost money.
 *
 * Two exclusions matter and neither is obvious:
 *
 *  - **Tunnels** (`tailscale0`, `wg*`, `zt*`, `tun*`). Their traffic is encapsulated and
 *    leaves again through the physical interface, so counting both counts every byte
 *    twice. All three remote-access backends this project offers are tunnels.
 *  - **The WiFi radio while it is running the vehicle's own hotspot.** A ground station
 *    connected straight to the vehicle's AP pulls the full video stream over it and that
 *    costs nothing at all — roughly 900 MB an hour of *free* traffic that would empty a
 *    4 GB budget in an afternoon on the bench. The same interface in *client* mode is a
 *    phone hotspot or a home network, and then it very much does count. Interface names
 *    cannot tell those apart; the WiFi mode can.
 *
 * Everything else is counted, deliberately including a wired uplink: over-counting a
 * free LAN costs a warning too early, while missing a metered link costs the vehicle.
 */
export function isMeteredIface(
  name: string,
  opts: { wifiIface?: string; wifiMode?: 'client' | 'ap' | 'unknown' | string } = {},
): boolean {
  if (name === 'lo') return false;
  if (/^(tailscale|wg|zt|tun|tap|ppp|sit|gre)/.test(name)) return false;
  if (/^(docker|br-|virbr|veth)/.test(name)) return false;
  if (name === (opts.wifiIface ?? 'wlan0') && opts.wifiMode === 'ap') return false;
  return true;
}

/** Accumulated usage plus the per-interface high-water marks that make it monotonic. */
export interface TrafficState {
  /** Bytes charged to the current period. */
  usedBytes: number;
  /** ISO date the current period started. */
  periodStart: string;
  /** Last counter value seen per interface, to turn absolutes into deltas. */
  lastSeen: Record<string, { rx: number; tx: number }>;
}

export function emptyTrafficState(nowIso: string): TrafficState {
  return { usedBytes: 0, periodStart: nowIso, lastSeen: {} };
}

/**
 * Fold one sample into the running total.
 *
 * /proc/net/dev counters are per-boot and per-interface-instance: they restart at zero
 * on reboot, and a USB LTE stick that is re-plugged comes back as a fresh device with
 * fresh counters. So a counter that went DOWN did not mean "negative traffic", it means
 * the interface restarted — and the honest reading of the new value is that all of it
 * is new traffic. Treating it as a delta from the old high value would silently drop
 * everything used before the restart.
 *
 * An interface that has simply disappeared keeps its last-seen entry: if it comes back
 * with a higher counter (the kernel kept it), the difference is still right.
 */
export function foldTraffic(prev: TrafficState, sample: IfaceBytes[]): TrafficState {
  const lastSeen = { ...prev.lastSeen };
  let added = 0;
  for (const { name, rx, tx } of sample) {
    const was = lastSeen[name];
    if (!was) {
      // First sight: record the mark, charge nothing. The counter is an absolute since
      // the interface came up, and on a box that has been running for days that is a
      // number we did not measure and must not claim. It also makes "Reset counter"
      // mean what it says — charging the absolute here made the total jump straight
      // back up on the very next sample. A restart is NOT this case: `lastSeen` is
      // persisted, so the branch below sees the reset counter and charges it in full.
    } else {
      added += rx >= was.rx ? rx - was.rx : rx;
      added += tx >= was.tx ? tx - was.tx : tx;
    }
    lastSeen[name] = { rx, tx };
  }
  return { usedBytes: prev.usedBytes + added, periodStart: prev.periodStart, lastSeen };
}

/**
 * Has the billing period rolled over? `resetDay` is the day of month the mobile plan
 * starts again; null means the counter only ever resets by hand.
 *
 * A plan that resets on the 31st still has to reset in February, so the day is clamped
 * to the length of the month it lands in.
 */
export function shouldRollPeriod(periodStart: string, now: Date, resetDay: number | null): boolean {
  if (resetDay == null) return false;
  const start = new Date(periodStart);
  if (Number.isNaN(start.getTime())) return true;
  const boundary = periodBoundaryOnOrBefore(now, resetDay);
  return start.getTime() < boundary.getTime();
}

/** The most recent reset day at or before `now`, as a local midnight. */
export function periodBoundaryOnOrBefore(now: Date, resetDay: number): Date {
  const clampDay = (y: number, m: number) => Math.min(resetDay, new Date(y, m + 1, 0).getDate());
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), clampDay(now.getFullYear(), now.getMonth()));
  if (thisMonth.getTime() <= now.getTime()) return thisMonth;
  const y = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const m = now.getMonth() === 0 ? 11 : now.getMonth() - 1;
  return new Date(y, m, clampDay(y, m));
}

/**
 * Persist rarely, but never lose much.
 *
 * Writing the counter on every 5 s sample would be ~17 000 SD-card writes a day for a
 * number nobody reads that often; writing it only on shutdown would lose everything on
 * the brownout this project already warns about. Bounding BOTH the unsaved bytes and
 * the time since the last save costs one condition and caps the loss at whichever comes
 * first.
 */
export const PERSIST_EVERY_MS = 5 * 60_000;
export const PERSIST_EVERY_BYTES = 20 * 1024 * 1024;
export function shouldPersist(unsavedBytes: number, msSinceSave: number): boolean {
  return unsavedBytes >= PERSIST_EVERY_BYTES || msSinceSave >= PERSIST_EVERY_MS;
}

/**
 * The budget actually in force, in bytes.
 *
 * A HiLink stick already knows the plan — the operator typed it into the stick's own web
 * UI and the stick enforces it. Making them type it again here, and warning about
 * nothing until they do, is the setting that states a wish and silently does nothing.
 * So an unset allowance falls back to the stick's own limit whenever the stick is the
 * one doing the counting.
 */
export function effectiveBudgetBytes(budgetMb: number | null, fallbackBytes: number | null): number | null {
  if (budgetMb && budgetMb > 0) return budgetMb * 1024 * 1024;
  return fallbackBytes && fallbackBytes > 0 ? fallbackBytes : null;
}

/** Where the budget stands. `warn` is the point of the whole feature. */
export function usageLevel(
  usedBytes: number,
  budgetBytes: number | null,
  warnPercent: number,
): 'ok' | 'warn' | 'over' {
  if (!budgetBytes || budgetBytes <= 0) return 'ok';
  const pct = (usedBytes / budgetBytes) * 100;
  if (pct >= 100) return 'over';
  return pct >= warnPercent ? 'warn' : 'ok';
}

/** Bytes as a person reads them: 3 significant-ish digits, never "0.00 GB". */
export function formatBytes(n: number): string {
  const v = Math.max(0, n);
  if (v < 1024) return `${Math.round(v)} B`;
  if (v < 1024 ** 2) return `${(v / 1024).toFixed(0)} kB`;
  if (v < 1024 ** 3) return `${(v / 1024 ** 2).toFixed(v < 10 * 1024 ** 2 ? 1 : 0)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
}

/** The OSD label: used against the budget when there is one, plain usage when not. */
export function usageLabel(usedBytes: number, budgetBytes: number | null): string {
  if (!budgetBytes || budgetBytes <= 0) return formatBytes(usedBytes);
  return `${formatBytes(usedBytes)} / ${formatBytes(budgetBytes)}`;
}

/**
 * The stick's own limit string ("3GB", "500MB", "0") as bytes. The HiLink UI writes it
 * in exactly this shape and it is the operator's real contract figure, so offering it
 * as the budget saves them typing a number they already told the stick.
 */
export function parseDataLimit(raw: string | undefined | null): number | null {
  const m = /^\s*([\d.]+)\s*(TB|GB|MB|KB|B)?\s*$/i.exec(String(raw ?? ''));
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n <= 0) return null;
  const unit = (m[2] ?? 'MB').toUpperCase();
  const mul: Record<string, number> = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4 };
  return Math.round(n * (mul[unit] ?? 1024 ** 2));
}
