import { CHANNEL_COUNT, neutralChannels } from '@yonderrc/protocol';
import type { OutputDriver } from './OutputDriver.js';
import {
  MODE1_AI,
  MODE1_ALLCALL,
  MODE1_RESTART,
  MODE1_SLEEP,
  MODE2_OUTDRV,
  PCA9685_MODE1,
  PCA9685_MODE2,
  PCA9685_PRESCALE,
  channelBytes,
  channelRegister,
  channelsToWrite,
  prescaleFor,
  pulseWidthToCounts,
} from './pca9685.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface Pca9685Options {
  bus?: number; // I2C bus number, default 1 on a Pi
  address?: number; // default 0x40
  freqHz?: number; // PWM frequency, default 50 Hz for servos/ESCs
}

/**
 * Real PCA9685 driver. The `i2c-bus` native module is imported lazily so this
 * file only touches hardware when the driver is actually selected — on a dev
 * machine in sim mode it is never loaded.
 */
export class Pca9685Driver implements OutputDriver {
  readonly kind = 'pca9685';
  private last = neutralChannels();
  /** Counts last written to the chip; null = unknown, so the next write is a full one. */
  private written: (number | null)[] | null = null;
  private freqHz: number;
  private bus: number;
  private address: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private i2c: any = null;

  constructor(opts: Pca9685Options = {}) {
    this.bus = opts.bus ?? 1;
    this.address = opts.address ?? 0x40;
    this.freqHz = opts.freqHz ?? 50;
  }

  async init(): Promise<void> {
    const mod: string = 'i2c-bus';
    const i2cBus = await import(mod).catch(() => {
      throw new Error(
        'i2c-bus not available. On a Raspberry Pi: enable I2C and `npm i i2c-bus` ' +
          'in packages/vehicle. On a dev machine use the "sim" driver.',
      );
    });
    this.i2c = await i2cBus.openPromisified(this.bus);

    // Reset, program prescale while asleep, then wake with auto-increment.
    await this.writeReg(PCA9685_MODE1, 0x00);
    await sleep(5);
    const prescale = prescaleFor(this.freqHz);
    const oldMode = await this.readReg(PCA9685_MODE1);
    await this.writeReg(PCA9685_MODE1, (oldMode & ~MODE1_RESTART) | MODE1_SLEEP);
    await this.writeReg(PCA9685_PRESCALE, prescale);
    await this.writeReg(PCA9685_MODE1, oldMode);
    await sleep(5);
    await this.writeReg(PCA9685_MODE1, oldMode | MODE1_RESTART | MODE1_AI | MODE1_ALLCALL);
    await this.writeReg(PCA9685_MODE2, MODE2_OUTDRV);

    console.log(
      `[pca9685] ready on i2c-${this.bus} @0x${this.address.toString(16)} ` +
        `at ${this.freqHz} Hz (prescale ${prescale})`,
    );
  }

  async writeChannels(channelsUs: number[]): Promise<void> {
    // Compare in counts, not µs: two µs values that round to the same count are the
    // same pulse on the wire, and re-sending them would cost a transaction for nothing.
    const counts: (number | null)[] = [];
    for (let ch = 0; ch < CHANNEL_COUNT; ch++) {
      const us = channelsUs[ch];
      // null keeps the old behaviour for a channel the caller has no value for: untouched.
      counts.push(typeof us === 'number' ? pulseWidthToCounts(us, this.freqHz) : null);
    }
    const todo = channelsToWrite(this.written, counts);
    try {
      for (const ch of todo) {
        const [onL, onH, offL, offH] = channelBytes(counts[ch] as number);
        const reg = channelRegister(ch);
        await this.i2c.writeI2cBlock(this.address, reg, 4, Buffer.from([onL, onH, offL, offH]));
      }
    } catch (err) {
      // A half-written frame leaves the chip in a state the cache does not describe.
      // Forget it so the next tick writes everything again.
      this.written = null;
      throw err;
    }
    // Channels we skipped keep whatever the chip last got from us.
    this.written = counts.map((c, i) => c ?? this.written?.[i] ?? null);
    this.last = channelsUs.slice(0, CHANNEL_COUNT);
  }

  readLast(): number[] {
    return this.last.slice();
  }

  async close(): Promise<void> {
    try {
      await this.writeReg(PCA9685_MODE1, MODE1_SLEEP); // outputs off
      await this.i2c?.close();
    } catch {
      /* best effort */
    }
  }

  private async writeReg(reg: number, value: number): Promise<void> {
    await this.i2c.writeByte(this.address, reg, value);
  }
  private async readReg(reg: number): Promise<number> {
    return this.i2c.readByte(this.address, reg);
  }
}
