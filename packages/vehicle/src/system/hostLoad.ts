/**
 * CPU and memory of the computer the vehicle service runs on — for the OSD, the setup
 * page's overview and the diagnostics file (v1.73, asked for by a tester).
 *
 * Why it is worth a number on the picture: the control loop, the failsafe watchdog and
 * the H.264 encoder all share this CPU. A Pi Zero 2 at 100 % or a Pi whose memory is
 * gone into swap explains round-trip jitter and stuttering video that the link did
 * not cause — and from the ground the two look the same.
 *
 * Read through `node:os`, not /proc: no process is started, nothing is parsed by
 * hand, and the simulator then shows the PC it runs on instead of invented numbers.
 * On Linux `os.cpus()` comes from /proc/stat (user + nice + sys + irq against idle;
 * iowait is left out by libuv) and `os.freemem()` is MemAvailable — memory the
 * kernel can hand out, so a full page cache does not read as a full Pi.
 *
 * Sampled on the status poll's 5 s cadence (transport/wsServer.ts): CPU is the busy
 * share between two samples, so the first sample has none yet.
 */
import { cpus, freemem, totalmem } from 'node:os';
import type { HostLoad } from '@yonderrc/protocol';

export interface CpuTimes {
  busy: number;
  total: number;
}

/** What `os.cpus()` reports per core, the part this module uses. */
export interface CoreTimes {
  times: { user: number; nice: number; sys: number; idle: number; irq: number };
}

/** All cores summed: time spent working, and in total (ms since boot). */
export function cpuTimes(list: readonly CoreTimes[]): CpuTimes {
  let busy = 0;
  let total = 0;
  for (const c of list) {
    const t = c.times;
    const b = t.user + t.nice + t.sys + t.irq;
    busy += b;
    total += b + t.idle;
  }
  return { busy, total };
}

/**
 * The busy share between two samples, 0..100. Null without a previous sample, when no
 * time passed, or when a counter went backwards (it does not, but a guess would be a
 * number on the OSD that means nothing).
 */
export function cpuBusyPercent(prev: CpuTimes | null, cur: CpuTimes): number | null {
  if (!prev) return null;
  const dt = cur.total - prev.total;
  const db = cur.busy - prev.busy;
  if (!(dt > 0) || db < 0) return null;
  return Math.round(Math.min(100, Math.max(0, (db / dt) * 100)));
}

/** Memory in use from the total and what the kernel could still hand out. */
export function memUsage(totalBytes: number, availableBytes: number): Omit<HostLoad, 'cpuPercent'> {
  if (!(totalBytes > 0) || !(availableBytes >= 0)) return { memPercent: null, memUsedMb: null, memTotalMb: null };
  const used = Math.max(0, totalBytes - Math.min(availableBytes, totalBytes));
  return {
    memPercent: Math.round((used / totalBytes) * 100),
    memUsedMb: Math.round(used / 1048576),
    memTotalMb: Math.round(totalBytes / 1048576),
  };
}

export const HOST_UNKNOWN: HostLoad = { cpuPercent: null, memPercent: null, memUsedMb: null, memTotalMb: null };

/** Thresholds for the OSD and the overview: where it starts to cost the control loop. */
export const CPU_WARN_PERCENT = 85;
export const MEM_WARN_PERCENT = 90;

/** Keeps the previous CPU sample, so each call reports the share since the last one. */
export class HostLoadSampler {
  private prev: CpuTimes | null = null;
  private last: HostLoad = { ...HOST_UNKNOWN };

  constructor(
    private readonly read: { cpus: () => readonly CoreTimes[]; totalmem: () => number; freemem: () => number } = {
      cpus,
      totalmem,
      freemem,
    },
  ) {}

  /** Take a sample. Never throws: an unreadable value is unknown, not zero. */
  sample(): HostLoad {
    let cpuPercent: number | null = null;
    try {
      const cur = cpuTimes(this.read.cpus());
      cpuPercent = cpuBusyPercent(this.prev, cur);
      this.prev = cur;
    } catch {
      this.prev = null;
    }
    let mem: Omit<HostLoad, 'cpuPercent'> = { memPercent: null, memUsedMb: null, memTotalMb: null };
    try {
      mem = memUsage(this.read.totalmem(), this.read.freemem());
    } catch {
      /* unknown */
    }
    this.last = { cpuPercent, ...mem };
    return this.last;
  }

  /** The last sample, without taking a new one. */
  get latest(): HostLoad {
    return this.last;
  }
}
