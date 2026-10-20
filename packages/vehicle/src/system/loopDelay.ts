import { monitorEventLoopDelay } from 'node:perf_hooks';

type IntervalHistogram = ReturnType<typeof monitorEventLoopDelay>;

/**
 * How late the vehicle service's own event loop runs.
 *
 * Control frames are timestamped when their message handler runs, not when the packet
 * reached the Pi. If the process is busy — a synchronous file read, a slow shell-out
 * parsed in one go, a CPU pegged by the video encoder — frames queue up in the socket
 * and arrive "late" together. From the link statistics alone that is indistinguishable
 * from network jitter; this histogram is what tells them apart. Node samples it in the
 * background at a 20 ms resolution, which costs nothing measurable.
 */

let histogram: IntervalHistogram | null = null;
let startedAt = 0;

/** Sampling period. Node records the whole interval, so this much of every value is not delay. */
const RESOLUTION_MS = 20;

export function startLoopDelayMonitor(): void {
  if (histogram) return;
  try {
    histogram = monitorEventLoopDelay({ resolution: RESOLUTION_MS });
    histogram.enable();
    startedAt = Date.now();
  } catch {
    histogram = null; // a runtime without perf_hooks simply reports nothing
  }
}

export interface LoopDelaySnapshot {
  since: string;
  meanMs: number | null;
  p50Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
}

/**
 * Lateness in ms. Measured on Node 24: idle samples read ~21 ms and a 150 ms block reads
 * 165 ms — the histogram holds the full timer interval, so the period comes off.
 */
const ms = (ns: number) =>
  Number.isFinite(ns) ? Math.max(0, Math.round((ns / 1e6 - RESOLUTION_MS) * 10) / 10) : null;

/** Delays beyond the 20 ms sampling period, since the service started. Null if not running. */
export function loopDelaySnapshot(): LoopDelaySnapshot | null {
  if (!histogram || histogram.count === 0) return null;
  return {
    since: new Date(startedAt).toISOString(),
    meanMs: ms(histogram.mean),
    p50Ms: ms(histogram.percentile(50)),
    p99Ms: ms(histogram.percentile(99)),
    maxMs: ms(histogram.max),
  };
}
