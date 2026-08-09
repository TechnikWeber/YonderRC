import type { TelemetryConfig, TelemetryMessage } from '@yonderrc/protocol';
import { accumulateMah, accumulateWh } from './convert.js';
import { createReader, type TelemetryReader } from './TelemetryReader.js';

/**
 * Owns the telemetry loop: sample the sensors at a fixed rate, integrate the
 * primary current into consumed mAh (precise coulomb counting using each
 * sample's real dt), derive battery percentage from the configured capacity, and
 * expose the latest TelemetryMessage for the link to stream to the ground.
 */
export class TelemetryService {
  private cfg: TelemetryConfig;
  private reader: TelemetryReader;
  private timer: ReturnType<typeof setInterval> | null = null;
  private mah = 0;
  private wh = 0;
  private lastAt = 0;
  private latest: TelemetryMessage | null = null;

  constructor(cfg: TelemetryConfig) {
    this.cfg = cfg;
    this.reader = createReader(cfg);
  }

  async start(): Promise<void> {
    if (!this.cfg.enabled) return;
    await this.reader.init();
    const periodMs = 1000 / Math.max(1, this.cfg.sampleHz);
    this.lastAt = Date.now();
    this.timer = setInterval(() => void this.tick(), periodMs);
    console.log(
      `[telemetry] ${this.reader.kind} source, ${this.cfg.sampleHz} Hz, ` +
        `capacity ${this.cfg.batteryCapacityMah ?? '—'} mAh, counting=${this.cfg.countCapacity}`,
    );
  }

  private async tick(): Promise<void> {
    try {
      const now = Date.now();
      const dt = (now - this.lastAt) / 1000;
      this.lastAt = now;
      const s = await this.reader.sample();

      // Coulomb counting on the primary current channel (index 0).
      if (this.cfg.countCapacity && s.currents.length > 0) {
        const amps = s.currents[0];
        const volts = s.voltages[0] ?? 0;
        this.mah = accumulateMah(this.mah, amps, dt);
        this.wh = accumulateWh(this.wh, volts, amps, dt);
      }

      const cap = this.cfg.batteryCapacityMah;
      const batteryPercent =
        cap && cap > 0 ? Math.max(0, Math.min(100, ((cap - this.mah) / cap) * 100)) : null;

      this.latest = {
        type: 'telemetry',
        voltages: this.cfg.voltages.map((c, i) => ({ label: c.label, value: round(s.voltages[i] ?? 0, 2) })),
        currents: this.cfg.currents.map((c, i) => ({ label: c.label, value: round(s.currents[i] ?? 0, 2) })),
        mah: round(this.mah, 1),
        wh: round(this.wh, 2),
        capacityMah: cap,
        batteryPercent: batteryPercent == null ? null : round(batteryPercent, 1),
        displayMode: this.cfg.displayMode,
      };
    } catch (err) {
      console.error('[telemetry] sample failed:', (err as Error).message);
    }
  }

  /** Reset the coulomb counter (e.g. on a fresh battery). */
  resetCapacity(): void {
    this.mah = 0;
    this.wh = 0;
  }

  get message(): TelemetryMessage | null {
    return this.latest;
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.reader.close();
  }
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
