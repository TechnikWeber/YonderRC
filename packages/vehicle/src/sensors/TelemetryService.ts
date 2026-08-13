import type { TelemetryConfig, TelemetryMessage } from '@yonderrc/protocol';
import { accumulateMah, accumulateWh, computeBatteryPercent } from './convert.js';
import { createReader, type TelemetryReader } from './TelemetryReader.js';

/**
 * Owns the telemetry loop: sample the sensors at a fixed rate, integrate the
 * primary current into consumed mAh (precise coulomb counting using each
 * sample's real dt), derive battery percentage from the configured capacity, and
 * expose the latest TelemetryMessage for the link to stream to the ground.
 *
 * If real sensors fail to initialise, it falls back to the sim source and reports
 * that in the message, so the OSD can make clear the numbers aren't real.
 */
export class TelemetryService {
  private cfg: TelemetryConfig;
  private reader: TelemetryReader;
  private actualSource: 'sim' | 'real' = 'sim';
  private degraded = false;
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
    this.actualSource = this.cfg.source;
    try {
      await this.reader.init();
    } catch (err) {
      // Do NOT silently fall back to sim — that could be mistaken for real data
      // mid-flight. Mark degraded so the OSD shows "no data" instead.
      console.error(
        `[telemetry] ${this.cfg.source} sensors failed to init: ${(err as Error).message}\n` +
          '[telemetry] reporting NO DATA (no sim substitution while source=real).',
      );
      this.degraded = true;
    }
    const periodMs = 1000 / Math.max(1, this.cfg.sampleHz);
    this.lastAt = Date.now();
    this.timer = setInterval(() => void this.tick(), periodMs);
    console.log(
      `[telemetry] ${this.actualSource} source${this.degraded ? ' (DEGRADED — no sensor)' : ''}, ` +
        `${this.cfg.sampleHz} Hz, capacity ${this.cfg.batteryCapacityMah ?? '—'} mAh, counting=${this.cfg.countCapacity}`,
    );
  }

  private async tick(): Promise<void> {
    try {
      const now = Date.now();
      const dt = (now - this.lastAt) / 1000;
      this.lastAt = now;

      // Real source but sensor unavailable: report NO DATA, never fake values.
      if (this.degraded) {
        this.latest = {
          type: 'telemetry',
          source: this.actualSource,
          ok: false,
          voltages: this.cfg.voltages.map((c) => ({ label: c.label, value: 0 })),
          currents: this.cfg.currents.map((c) => ({ label: c.label, value: 0 })),
          mah: 0,
          wh: 0,
          capacityMah: this.cfg.batteryCapacityMah,
          batteryPercent: null,
          displayMode: this.cfg.displayMode,
        };
        return;
      }

      const s = await this.reader.sample();

      // Coulomb counting on the primary current channel (index 0).
      if (this.cfg.countCapacity && s.currents.length > 0) {
        const amps = s.currents[0];
        const volts = s.voltages[0] ?? 0;
        this.mah = accumulateMah(this.mah, amps, dt);
        this.wh = accumulateWh(this.wh, volts, amps, dt);
      }

      const cap = this.cfg.batteryCapacityMah;
      const coulombPct =
        cap && cap > 0 ? Math.max(0, Math.min(100, ((cap - this.mah) / cap) * 100)) : null;
      // The user picks which method drives the % (coulomb / voltage / clamp).
      const { pct: batteryPercent, source: batteryPercentSource } = computeBatteryPercent(
        this.cfg.percentSource ?? 'clamp',
        coulombPct,
        s.voltages[0],
        this.cfg.voltageFullV ?? null,
        this.cfg.voltageEmptyV ?? null,
      );

      this.latest = {
        type: 'telemetry',
        source: this.actualSource,
        ok: true,
        voltages: this.cfg.voltages.map((c, i) => ({ label: c.label, value: round(s.voltages[i] ?? 0, 2) })),
        currents: this.cfg.currents.map((c, i) => ({ label: c.label, value: round(s.currents[i] ?? 0, 2) })),
        mah: round(this.mah, 1),
        wh: round(this.wh, 2),
        capacityMah: cap,
        batteryPercent: batteryPercent == null ? null : round(batteryPercent, 1),
        batteryPercentSource,
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

  /** Apply a new config live: stop, swap the reader, reset counters, restart. */
  async reconfigure(cfg: TelemetryConfig): Promise<void> {
    await this.stop();
    this.cfg = cfg;
    this.reader = createReader(cfg);
    this.degraded = false;
    this.mah = 0;
    this.wh = 0;
    this.latest = null;
    await this.start();
  }
}

function round(v: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
}
