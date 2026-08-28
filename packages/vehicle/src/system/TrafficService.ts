import { readFile } from 'node:fs/promises';
import type { DataUsage } from '@yonderrc/protocol';
import {
  DATA_USAGE_DEFAULT,
  savePersisted,
  type DataUsageConfig,
  type DataUsageState,
  type PersistentConfig,
} from '../config.js';
import {
  emptyTrafficState,
  foldTraffic,
  isMeteredIface,
  parseProcNetDev,
  periodBoundaryOnOrBefore,
  shouldPersist,
  shouldRollPeriod,
  effectiveBudgetBytes,
  usageLabel,
  usageLevel,
  type TrafficState,
} from './traffic.js';
import type { HilinkTraffic } from './hilink.js';

const PROC_NET_DEV = '/proc/net/dev';

/**
 * Owns the mobile-data counter: sample the interface byte counters, accumulate them
 * across reboots and re-plugs, persist the total rarely enough not to chew the SD card,
 * and expose one `DataUsage` for the status frame.
 *
 * The maths is all in `system/traffic.ts`; what lives here is the I/O and the timer.
 * With `source: 'hilink'` almost none of it runs — the stick has already done the
 * counting and we only read its answer.
 */
export class TrafficService {
  private cfg: DataUsageConfig;
  private state: TrafficState;
  private latest: DataUsage | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private unsavedBytes = 0;
  private lastSaveAt = Date.now();
  private hilink: HilinkTraffic | null = null;

  constructor(
    private readonly configPath: string,
    cfg: DataUsageConfig | undefined,
    stored: DataUsageState | undefined,
    /** How to reach the stick, and how the vehicle's WiFi is being used right now. */
    private readonly deps: {
      /** The stick's own month counter, or null when there is no stick. */
      hilinkTraffic: () => Promise<HilinkTraffic | null>;
      /**
       * How the WiFi radio is being used right now. Supplied by the caller rather than
       * read here: the ws server already refreshes the system status every 5 s, and
       * shelling out a second time for one word would double that cost.
       */
      wifiMode: () => 'client' | 'ap' | 'unknown' | string;
      readProc?: (path: string) => Promise<string>;
    },
  ) {
    this.cfg = { ...DATA_USAGE_DEFAULT, ...(cfg ?? {}) };
    this.state = stored
      ? { usedBytes: stored.usedBytes, periodStart: stored.periodStart, lastSeen: stored.lastSeen ?? {} }
      : emptyTrafficState(new Date().toISOString());
  }

  start(intervalMs = 5000): void {
    if (this.timer) return;
    void this.tick();
    this.timer = setInterval(() => void this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.persist(); // a deliberate stop is the one moment we know we can save
  }

  get usage(): DataUsage | null {
    return this.cfg.enabled ? this.latest : null;
  }

  get config(): DataUsageConfig {
    return this.cfg;
  }

  /** The stick's own figures, for the setup UI (its plan and its billing day). */
  get hilinkTraffic(): HilinkTraffic | null {
    return this.hilink;
  }

  reconfigure(cfg: DataUsageConfig): void {
    const wasSource = this.cfg.source;
    this.cfg = { ...DATA_USAGE_DEFAULT, ...cfg };
    // Switching source switches what the number MEANS, so the old one must not linger
    // in the OSD until the next sample lands.
    if (wasSource !== this.cfg.source) this.latest = null;
    void this.tick();
  }

  /** Start a fresh period — a new plan month, or a new SIM. */
  reset(): void {
    this.state = emptyTrafficState(new Date().toISOString());
    this.unsavedBytes = 0;
    this.latest = null;
    this.persist();
  }

  private async tick(): Promise<void> {
    if (!this.cfg.enabled) {
      this.latest = null;
      return;
    }
    try {
      if (this.cfg.source === 'hilink') await this.tickHilink();
      else await this.tickCounted();
    } catch (err) {
      // A counter that cannot be read must not take the status frame down with it.
      console.error('[data] sample failed:', (err as Error).message);
    }
  }

  private async tickCounted(): Promise<void> {
    const now = new Date();
    if (shouldRollPeriod(this.state.periodStart, now, this.cfg.resetDay)) {
      // Date the new period from the plan's own boundary, not from the moment the
      // vehicle happened to be switched on — otherwise a vehicle that sat in a shed
      // over the reset day reports a period that started days late.
      const boundary = periodBoundaryOnOrBefore(now, this.cfg.resetDay as number);
      this.state = { usedBytes: 0, periodStart: boundary.toISOString(), lastSeen: {} };
      this.unsavedBytes = 0;
      console.log(`[data] billing period rolled over — counter reset (day ${this.cfg.resetDay})`);
    }
    const read = this.deps.readProc ?? ((p: string) => readFile(p, 'utf8'));
    const text = await read(PROC_NET_DEV);
    const wifiMode = this.deps.wifiMode();
    const sample = parseProcNetDev(text).filter((i) => isMeteredIface(i.name, { wifiMode }));
    const before = this.state.usedBytes;
    this.state = foldTraffic(this.state, sample);
    this.unsavedBytes += this.state.usedBytes - before;
    if (shouldPersist(this.unsavedBytes, Date.now() - this.lastSaveAt)) this.persist();
    this.publish(this.state.usedBytes, this.state.periodStart);
  }

  private async tickHilink(): Promise<void> {
    this.hilink = await this.deps.hilinkTraffic();
    if (!this.hilink || this.hilink.monthBytes == null) {
      this.latest = null;
      return;
    }
    // The stick's own configured limit stands in for an unset allowance — see
    // effectiveBudgetBytes.
    this.publish(this.hilink.monthBytes, this.hilink.monthSince, this.hilink.limitBytes);
  }

  private publish(usedBytes: number, since: string | null, fallbackBudgetBytes: number | null = null): void {
    const budgetBytes = effectiveBudgetBytes(this.cfg.budgetMb ?? null, fallbackBudgetBytes);
    this.latest = {
      usedBytes: Math.round(usedBytes),
      budgetBytes,
      percent: budgetBytes ? Math.round((usedBytes / budgetBytes) * 1000) / 10 : null,
      source: this.cfg.source,
      level: usageLevel(usedBytes, budgetBytes, this.cfg.warnPercent),
      label: usageLabel(usedBytes, budgetBytes),
      since,
    };
  }

  private persist(): void {
    try {
      const patch: PersistentConfig = {
        dataUsageState: {
          usedBytes: Math.round(this.state.usedBytes),
          periodStart: this.state.periodStart,
          lastSeen: this.state.lastSeen,
        },
      };
      savePersisted(this.configPath, patch);
      this.unsavedBytes = 0;
      this.lastSaveAt = Date.now();
    } catch (err) {
      console.error('[data] could not persist the counter:', (err as Error).message);
    }
  }
}
