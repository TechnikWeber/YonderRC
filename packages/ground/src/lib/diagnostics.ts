/**
 * The ground app's half of the diagnostics file.
 *
 * The vehicle can say when frames arrived; only the ground can say when they were SENT.
 * A browser slows its timers down as soon as the tab is hidden (another tab in front, a
 * minimised window, a phone screen that went dark), and a busy page delays them too —
 * and to the vehicle a frame that was never sent looks exactly like one the network
 * lost. So this records how regularly the 50 Hz control loop actually ran, every gap it
 * left and whether the page was visible at the time, plus a short timeline of what the
 * link did. Merged with the vehicle's report, the two halves say which side a failsafe
 * came from.
 *
 * Pure apart from the clock values passed in, and bounded: a session of hours keeps the
 * same few kilobytes.
 */
import { DIAGNOSTICS_SCHEMA, type DiagnosticFinding } from '@yonderrc/protocol';

/** Upper bounds (ms) of the send-interval histogram; one open-ended bucket follows. */
export const SEND_BUCKETS_MS = [25, 40, 60, 100, 200, 300, 500, 1000] as const;

/** A control-loop interval this long is a stall worth recording individually. */
export const SEND_STALL_MS = 100;

const STALLS_KEPT = 40;
const EVENTS_KEPT = 300;
const RTT_KEPT = 600;

export interface SendStall {
  at: string;
  ms: number;
  /** The page was hidden — the browser throttled us on purpose. */
  hidden: boolean;
}

export interface SendLoopStats {
  since: string;
  ticks: number;
  buckets: number[];
  maxMs: number;
  stalls: number;
  stallsHidden: number;
  /** Ticks that ran while the page was hidden. */
  hiddenTicks: number;
  recentStalls: SendStall[];
}

export function emptySendLoop(now: number): SendLoopStats {
  return {
    since: new Date(now).toISOString(),
    ticks: 0,
    buckets: new Array(SEND_BUCKETS_MS.length + 1).fill(0),
    maxMs: 0,
    stalls: 0,
    stallsHidden: 0,
    hiddenTicks: 0,
    recentStalls: [],
  };
}

/**
 * One control-loop tick, `dtMs` after the previous one. Mutates `s` — this runs 50
 * times a second, and a fresh object per tick buys nothing.
 */
export function recordSendTick(s: SendLoopStats, dtMs: number, now: number, hidden: boolean): void {
  if (!Number.isFinite(dtMs) || dtMs < 0) return;
  s.ticks += 1;
  if (hidden) s.hiddenTicks += 1;
  let i = SEND_BUCKETS_MS.findIndex((b) => dtMs <= b);
  if (i < 0) i = SEND_BUCKETS_MS.length;
  s.buckets[i] += 1;
  if (dtMs > s.maxMs) s.maxMs = Math.round(dtMs);
  if (dtMs > SEND_STALL_MS) {
    s.stalls += 1;
    if (hidden) s.stallsHidden += 1;
    s.recentStalls.push({ at: new Date(now).toISOString(), ms: Math.round(dtMs), hidden });
    if (s.recentStalls.length > STALLS_KEPT) s.recentStalls.shift();
  }
}

/** Intervals longer than `ms` (exact on a bucket edge, errs low in between). */
export function sendGapsOver(s: SendLoopStats, ms: number): number {
  let lower = 0;
  let n = 0;
  s.buckets.forEach((count, i) => {
    if (lower >= ms) n += count;
    lower = SEND_BUCKETS_MS[i] ?? Infinity;
  });
  return n;
}

export interface GroundEvent {
  at: string;
  kind: string;
  detail?: string;
}

/** A short timeline: connects, drops, transport switches, failsafe edges, the tab hiding. */
export class EventLog {
  private items: GroundEvent[] = [];
  push(kind: string, detail: string | undefined, now: number): void {
    this.items.push({ at: new Date(now).toISOString(), kind, ...(detail ? { detail } : {}) });
    if (this.items.length > EVENTS_KEPT) this.items.shift();
  }
  list(): GroundEvent[] {
    return this.items.slice();
  }
}

/** Round-trip samples, bounded; summarised only when a report is made. */
export class RttSamples {
  private v: number[] = [];
  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    this.v.push(ms);
    if (this.v.length > RTT_KEPT) this.v.shift();
  }
  summary(): { n: number; min: number; p50: number; p95: number; max: number } | null {
    if (!this.v.length) return null;
    const s = [...this.v].sort((a, b) => a - b);
    const q = (p: number) => s[Math.min(s.length - 1, Math.floor(p * (s.length - 1)))];
    return { n: s.length, min: Math.round(s[0]), p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(s[s.length - 1]) };
  }
}

export interface GroundFindingInput {
  sendLoop: SendLoopStats;
  /** The vehicle's watchdog as announced in the welcome; 0 when not connected. */
  watchdogMs: number;
  /** Failsafe episodes the ground saw on this connection (link-gaps counter). */
  dropouts: number;
  rtt: { p95: number } | null;
  /** `setUp`: the controller in use has a layout of its own set up (padProfiles.ts). */
  controller: { inputMethod: string; active: { id: string; mapping: string } | null; listed: number; setUp?: boolean };
  connected: boolean;
}

/** What the ground's numbers mean — the half of the story only this side knows. */
export function groundFindings(i: GroundFindingInput): DiagnosticFinding[] {
  const out: DiagnosticFinding[] = [];
  const s = i.sendLoop;
  if (s.stalls > 0) {
    const visible = s.stalls - s.stallsHidden;
    const overWd = i.watchdogMs > 0 ? sendGapsOver(s, i.watchdogMs) : 0;
    out.push({
      level: overWd > 0 ? 'bad' : 'warn',
      area: 'ground',
      text:
        `This app's 50 Hz control loop paused ${s.stalls}× for more than ${SEND_STALL_MS} ms (longest ${s.maxMs} ms)` +
        (s.stallsHidden ? `, ${s.stallsHidden}× while the page was hidden` : '') +
        (overWd ? `; ${overWd} pause(s) were longer than the vehicle's ${i.watchdogMs} ms watchdog — each of those is a failsafe that no network caused.` : '.'),
      fix: s.stallsHidden
        ? 'Keep the control page in front: browsers slow down timers in background tabs, minimised windows and on a dark phone screen — the vehicle then stops, as it should.'
        : visible > 0
          ? 'The page itself was too busy (a slow phone, many tabs, video at high resolution). Close other tabs or lower the video quality.'
          : undefined,
    });
  }
  if (i.dropouts > 0 && s.stalls === 0) {
    out.push({
      level: 'warn',
      area: 'link',
      text: `${i.dropouts} failsafe episode(s) on this connection while this app sent without a single pause — the frames were sent on time and arrived late: network or vehicle, see the vehicle's findings.`,
    });
  }
  if (i.rtt && i.rtt.p95 >= 250) {
    out.push({ level: 'warn', area: 'link', text: `Round-trip 95th percentile ${i.rtt.p95} ms — the link is slow or bursty.` });
  }
  const c = i.controller;
  if (c.inputMethod === 'gamepad' && !c.active) {
    out.push({
      level: 'bad',
      area: 'controller',
      text: c.listed
        ? `The model expects a game controller, but none of the ${c.listed} listed device(s) is in use.`
        : 'The model expects a game controller, but the browser lists none.',
      fix: 'Setup › Controls › Game controller. A browser only shows a controller after one of its buttons was pressed on this page.',
    });
  } else if (c.active && c.active.mapping !== 'standard') {
    out.push(
      c.setUp
        ? { level: 'info', area: 'controller', text: `The controller in use (${c.active.id}) reports its own layout and is set up — its controls are read as the standard ones.` }
        : {
            level: 'info',
            area: 'controller',
            text: `The controller in use (${c.active.id}) reports its own layout and is not set up — its sticks may not be where the models expect them.`,
            fix: 'Setup › Controls › Game controller › Set up: show the app once where its sticks and buttons are.',
          },
    );
  }
  if (!i.connected) {
    out.push({ level: 'info', area: 'ground', text: 'Not connected to the vehicle when this report was made — the link numbers cover the last connection only.' });
  }
  return out;
}

/** The merged file: the ground's half, the vehicle's half (if it answered) and all findings. */
export function mergeReports(
  ground: Record<string, unknown>,
  groundFindingsList: DiagnosticFinding[],
  vehicle: { findings?: DiagnosticFinding[]; vehicle?: unknown } | null,
  vehicleError: string | null,
  now = new Date(),
): Record<string, unknown> {
  return {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt: now.toISOString(),
    generatedBy: 'ground',
    findings: [...groundFindingsList, ...(vehicle?.findings ?? [])],
    ground,
    vehicle: vehicle?.vehicle ?? null,
    vehicleError,
  };
}

/** Same naming as the vehicle's download, so both halves sort together in a folder. */
export function groundReportFileName(vehicleName: string | null, now = new Date()): string {
  const name = (vehicleName || 'ground').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ground';
  const p = (n: number) => String(n).padStart(2, '0');
  return `yonderrc-diagnostics-${name}-${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}.json`;
}

/** Where the vehicle's half comes from: the setup API on the control link's host. */
export function diagnosticsUrlFromWs(wsUrl: string, secret: string | null | undefined): string | null {
  try {
    const u = new URL(wsUrl.replace(/^ws/, 'http'));
    const q = secret ? `?secret=${encodeURIComponent(secret)}` : '';
    return `${u.protocol}//${u.host}/api/diagnostics${q}`;
  } catch {
    return null;
  }
}
