import type {
  CurrentChannelCfg,
  TelemetryConfig,
  VoltageChannelCfg,
} from '@yonderrc/protocol';
import * as C from './convert.js';

export interface TelemetrySample {
  voltages: number[]; // volts, per config.voltages
  currents: number[]; // amps, per config.currents
}

export interface TelemetryReader {
  readonly kind: string;
  init(): Promise<void>;
  sample(): Promise<TelemetrySample>;
  close(): Promise<void>;
  /**
   * Consumed charge/energy straight from the sensor's own accumulator (INA228),
   * or null when the configured chip has none — then the service integrates.
   */
  accumulated?(): Promise<{ mah: number; wh: number } | null>;
  /** Clear that accumulator (fresh battery). No-op without one. */
  resetAccumulator?(): Promise<void>;
}

/** INA parts that need a SHUNT_CAL / range write before their registers mean anything. */
const CALIBRATED_INA = ['ina228', 'ina237', 'ina238'];
const DEFAULT_MAX_A = 50;

/**
 * SimReader: plausible battery telemetry with no hardware. A pack voltage that
 * sags under load and a wandering current draw, so the OSD, coulomb counting and
 * percentage all animate realistically for development.
 */
export class SimReader implements TelemetryReader {
  readonly kind = 'sim';
  private cfg: TelemetryConfig;
  private t = 0;
  private nominal: number;
  // Emulated INA228 charge/energy registers, so the hardware-counter path can be
  // exercised (and demoed) without the chip. Sim-first: same code path, fake chip.
  private accMah = 0;
  private accWh = 0;
  private lastSampleAt = 0;

  constructor(cfg: TelemetryConfig) {
    this.cfg = cfg;
    // Guess a nominal pack voltage from a 4S LiPo unless told otherwise.
    this.nominal = 16.8;
  }
  async init(): Promise<void> {
    this.lastSampleAt = Date.now();
  }

  private get emulatesCounter(): boolean {
    return C.hasHardwareCounter(this.cfg.currents[0]?.kind);
  }

  async accumulated(): Promise<{ mah: number; wh: number } | null> {
    return this.emulatesCounter ? { mah: this.accMah, wh: this.accWh } : null;
  }
  async resetAccumulator(): Promise<void> {
    this.accMah = 0;
    this.accWh = 0;
  }

  async sample(): Promise<TelemetrySample> {
    this.t += 0.1;
    // Wandering current 2..25 A.
    const baseCurrent = 8 + 6 * Math.sin(this.t * 0.3) + 3 * Math.sin(this.t * 1.7);
    const current = Math.max(0.5, baseCurrent);
    // Voltage sags ~0.02 V/A plus slow depletion.
    const sag = current * 0.02 + this.t * 0.0009;
    const packV = Math.max(12.5, this.nominal - sag + 0.05 * Math.sin(this.t * 2.3));

    const voltages = this.cfg.voltages.map((_, i) => (i === 0 ? packV : packV / 2 + i));
    const currents = this.cfg.currents.map((_, i) => (i === 0 ? current : current * 0.4));

    if (this.emulatesCounter) {
      const now = Date.now();
      const dt = this.lastSampleAt ? (now - this.lastSampleAt) / 1000 : 0;
      this.lastSampleAt = now;
      this.accMah = C.accumulateMah(this.accMah, currents[0] ?? 0, dt);
      this.accWh = C.accumulateWh(this.accWh, voltages[0] ?? 0, currents[0] ?? 0, dt);
    }
    return { voltages, currents };
  }
  async close(): Promise<void> {}
}

/**
 * RealReader: reads the configured chips over I2C (INA2xx, ADS1x15) and SPI
 * (MCP3xxx). Native modules are imported lazily; on a dev machine this driver is
 * never selected. Register-level conversions live in convert.ts and are unit
 * tested. Hardware wiring/addresses are validated on the Pi.
 */
export class RealReader implements TelemetryReader {
  readonly kind = 'real';
  private cfg: TelemetryConfig;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private i2c: any = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private spi: any = null;
  private lastVoltages: number[] = [];
  /** CURRENT_LSB per INA228/237/238 address, from the calibration write. */
  private currentLsb = new Map<number, number>();

  constructor(cfg: TelemetryConfig) {
    this.cfg = cfg;
  }

  async init(): Promise<void> {
    const needsI2c = [...this.cfg.voltages, ...this.cfg.currents].some((c) =>
      ['ads1115', 'ads1015', 'ina219', 'ina226', 'ina260', 'ina3221', ...CALIBRATED_INA].includes(c.kind),
    );
    const needsSpi = this.cfg.voltages.some((c) => ['mcp3008', 'mcp3208'].includes(c.kind));
    if (needsI2c) {
      const mod: string = 'i2c-bus';
      const i2cBus = await import(mod).catch(() => {
        throw new Error('i2c-bus not available — needed for INA/ADS sensors. Use telemetry source "sim".');
      });
      this.i2c = await i2cBus.openPromisified(1);
    }
    if (needsSpi) {
      const mod: string = 'spi-device';
      const spiDev = await import(mod).catch(() => {
        throw new Error('spi-device not available — needed for MCP sensors. Use telemetry source "sim".');
      });
      this.spi = spiDev; // opened per-read below
    }
    await this.calibrateInas();
  }

  /**
   * INA228/237/238 need SHUNT_CAL (and the shunt range) programmed before their
   * CURRENT/POWER/CHARGE/ENERGY registers are meaningful. Voltage-only channels
   * don't, but calibrating them too is harmless and keeps a single INA that
   * provides both voltage and current consistent.
   */
  private async calibrateInas(): Promise<void> {
    for (const c of this.cfg.currents) {
      if (!CALIBRATED_INA.includes(c.kind)) continue;
      const addr = c.address ?? 0x40;
      const low = !!c.lowShuntRange;
      const shunt = c.shuntOhms ?? 0.001;
      const maxA = c.maxCurrentA ?? DEFAULT_MAX_A;
      if (c.kind === 'ina228') {
        const lsb = C.ina228CurrentLsb(maxA);
        await this.writeWord(addr, C.INA228_REG.config, low ? C.INA228_ADCRANGE : 0);
        await this.writeWord(addr, C.INA228_REG.shuntCal, C.ina228ShuntCal(lsb, shunt, low));
        this.currentLsb.set(addr, lsb);
      } else {
        const lsb = C.ina238CurrentLsb(maxA);
        await this.writeWord(addr, C.INA238_REG.config, low ? C.INA238_ADCRANGE : 0);
        await this.writeWord(addr, C.INA238_REG.shuntCal, C.ina238ShuntCal(lsb, shunt, low));
        this.currentLsb.set(addr, lsb);
      }
    }
  }

  /** The INA228 channel (if any) whose accumulator we report. */
  private get counterChannel(): CurrentChannelCfg | null {
    const primary = this.cfg.currents[0];
    return primary && C.hasHardwareCounter(primary.kind) ? primary : null;
  }

  async accumulated(): Promise<{ mah: number; wh: number } | null> {
    const c = this.counterChannel;
    if (!c || !this.i2c) return null;
    const addr = c.address ?? 0x40;
    const lsb = this.currentLsb.get(addr) ?? C.ina228CurrentLsb(c.maxCurrentA ?? DEFAULT_MAX_A);
    const charge = await this.readBig(addr, C.INA228_REG.charge, 5);
    const energy = await this.readBig(addr, C.INA228_REG.energy, 5);
    return { mah: C.ina228ChargeMah(charge, lsb), wh: C.ina228EnergyWh(energy, lsb) };
  }

  async resetAccumulator(): Promise<void> {
    const c = this.counterChannel;
    if (!c || !this.i2c) return;
    // RSTACC clears CHARGE/ENERGY; keep the range bit so calibration survives.
    const range = c.lowShuntRange ? C.INA228_ADCRANGE : 0;
    await this.writeWord(c.address ?? 0x40, C.INA228_REG.config, C.INA228_RSTACC | range);
  }

  private async readWord(addr: number, reg: number): Promise<number> {
    const buf = Buffer.alloc(2);
    await this.i2c.readI2cBlock(addr, reg, 2, buf);
    return (buf[0] << 8) | buf[1]; // big-endian
  }

  /** Big-endian register of 3 (24-bit) or 5 (40-bit) bytes — INA228 ENERGY/CHARGE. */
  private async readBig(addr: number, reg: number, bytes: number): Promise<number> {
    const buf = Buffer.alloc(bytes);
    await this.i2c.readI2cBlock(addr, reg, bytes, buf);
    let v = 0;
    for (const b of buf) v = v * 256 + b; // shifts overflow past 32 bits, multiply
    return v;
  }

  private async writeWord(addr: number, reg: number, value: number): Promise<void> {
    await this.i2c.writeI2cBlock(addr, reg, 2, Buffer.from([(value >> 8) & 0xff, value & 0xff]));
  }

  private async readVoltage(c: VoltageChannelCfg): Promise<number> {
    const scale = c.scale ?? 1;
    if (c.kind === 'ads1115' || c.kind === 'ads1015') {
      // Single-shot on the selected single-ended channel, PGA from FSR.
      const fsr = c.gainFsrVolts ?? 4.096;
      const pga = fsrToPga(fsr);
      const mux = 0x4 | (c.channel ?? 0); // 100..111 = AINx vs GND
      const config = 0x8000 | (mux << 12) | (pga << 9) | 0x0100 | 0x0083;
      await this.i2c.writeI2cBlock(c.address ?? 0x48, 0x01, 2, Buffer.from([(config >> 8) & 0xff, config & 0xff]));
      await new Promise((r) => setTimeout(r, 10));
      const raw = await this.readWord(c.address ?? 0x48, 0x00);
      const v = c.kind === 'ads1115' ? C.ads1115Volts(raw, fsr) : C.ads1015Volts(raw, fsr);
      return v * scale;
    }
    if (c.kind === 'mcp3008' || c.kind === 'mcp3208') {
      const raw = await this.readMcp(c);
      const v = c.kind === 'mcp3008' ? C.mcp3008Volts(raw, c.vref ?? 3.3) : C.mcp3208Volts(raw, c.vref ?? 3.3);
      return v * scale;
    }
    // INA228/237/238 keep the bus voltage at 0x05 (24-bit / 16-bit).
    if (c.kind === 'ina228') {
      return C.ina228BusVolts(await this.readBig(c.address ?? 0x40, C.INA228_REG.vbus, 3)) * scale;
    }
    if (c.kind === 'ina237' || c.kind === 'ina238') {
      return C.ina238BusVolts(await this.readWord(c.address ?? 0x40, C.INA238_REG.vbus)) * scale;
    }
    // INA2xx bus-voltage register (0x02; INA3221 has one per channel at 0x02/04/06).
    if (c.kind === 'ina219' || c.kind === 'ina226' || c.kind === 'ina260' || c.kind === 'ina3221') {
      const addr = c.address ?? 0x40;
      if (c.kind === 'ina3221') {
        const ch = (c.channel ?? 1) - 1;
        return C.ina3221BusVolts(await this.readWord(addr, 0x02 + ch * 2)) * scale;
      }
      const raw = await this.readWord(addr, 0x02);
      const v =
        c.kind === 'ina219' ? C.ina219BusVolts(raw)
        : c.kind === 'ina226' ? C.ina226BusVolts(raw)
        : C.ina260BusVolts(raw);
      return v * scale;
    }
    return 0;
  }

  private readMcp(c: VoltageChannelCfg): Promise<number> {
    return new Promise((resolve, reject) => {
      const dev = this.spi.open(c.spiBus ?? 0, c.spiDevice ?? 0, (err: Error) => {
        if (err) return reject(err);
        const ch = c.channel ?? 0;
        const txBuf = Buffer.from([0x01, (0x08 | ch) << 4, 0x00]);
        const rxBuf = Buffer.alloc(3);
        dev.transfer([{ sendBuffer: txBuf, receiveBuffer: rxBuf, byteLength: 3, speedHz: 1_000_000 }], (e: Error) => {
          dev.close(() => {});
          if (e) return reject(e);
          resolve(((rxBuf[1] & 0x03) << 8) | rxBuf[2]);
        });
      });
    });
  }

  private async readCurrent(c: CurrentChannelCfg): Promise<number> {
    const addr = c.address ?? 0x40;
    const shunt = c.shuntOhms ?? 0.001;
    switch (c.kind) {
      case 'ina219':
        return C.ina219Amps(await this.readWord(addr, 0x01), shunt);
      case 'ina226':
        return C.ina226Amps(await this.readWord(addr, 0x01), shunt);
      case 'ina260':
        return C.ina260Amps(await this.readWord(addr, 0x01));
      case 'ina3221': {
        const ch = (c.channel ?? 1) - 1;
        return C.ina3221Amps(await this.readWord(addr, 0x01 + ch * 2), shunt);
      }
      // Amps from VSHUNT (fixed datasheet LSB) so the reading is independent of
      // the SHUNT_CAL write; that calibration only scales the chip's own
      // CURRENT/POWER/CHARGE/ENERGY registers.
      case 'ina228':
        return C.ina228Amps(await this.readBig(addr, C.INA228_REG.vshunt, 3), shunt, !!c.lowShuntRange);
      case 'ina237':
      case 'ina238':
        return C.ina238Amps(await this.readWord(addr, C.INA238_REG.vshunt), shunt, !!c.lowShuntRange);
      case 'acs712':
      case 'acs758': {
        const vout = this.lastVoltages[c.adcChannel ?? 0] ?? 0;
        return C.acsAmps(vout, c.zeroVolts ?? 2.5, c.mvPerAmp ?? 66);
      }
      default:
        return 0;
    }
  }

  async sample(): Promise<TelemetrySample> {
    const voltages: number[] = [];
    for (const v of this.cfg.voltages) voltages.push(await this.readVoltage(v));
    this.lastVoltages = voltages; // ACS reads reference these
    const currents: number[] = [];
    for (const c of this.cfg.currents) currents.push(await this.readCurrent(c));
    return { voltages, currents };
  }

  async close(): Promise<void> {
    try {
      await this.i2c?.close();
    } catch {
      /* ignore */
    }
  }
}

function fsrToPga(fsr: number): number {
  if (fsr >= 6.144) return 0;
  if (fsr >= 4.096) return 1;
  if (fsr >= 2.048) return 2;
  if (fsr >= 1.024) return 3;
  if (fsr >= 0.512) return 4;
  return 5;
}

export function createReader(cfg: TelemetryConfig): TelemetryReader {
  return cfg.source === 'real' ? new RealReader(cfg) : new SimReader(cfg);
}
