import { CHANNEL_COUNT, clampChannelUs, neutralChannels } from '@yonderrc/protocol';
import type { OutputDriver } from './OutputDriver.js';

export interface GpioPwmOptions {
  /** BCM pin numbers, one per channel in order. Length caps the channel count. */
  pins?: number[];
}

// A sensible default pin map (BCM). Adjust to your wiring in config.
const DEFAULT_PINS = [17, 18, 27, 22, 23, 24, 25, 5, 6, 12, 13, 16, 19, 20, 21, 26];

/**
 * Direct-to-GPIO PWM using `pigpio`, which generates DMA-timed pulses — far less
 * jitter than the software RPi.GPIO PWM the very first prototype used. Each pin's
 * `servoWrite` takes microseconds directly (500..2500), so there is no duty-cycle
 * math to get wrong. Native module is imported lazily.
 */
export class GpioPwmDriver implements OutputDriver {
  readonly kind = 'gpio-pwm';
  private pins: number[];
  private last = neutralChannels();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private gpios: any[] = [];

  constructor(opts: GpioPwmOptions = {}) {
    this.pins = (opts.pins ?? DEFAULT_PINS).slice(0, CHANNEL_COUNT);
  }

  async init(): Promise<void> {
    const modName: string = 'pigpio';
    const pigpio = await import(modName).catch(() => {
      throw new Error(
        'pigpio not available. On a Raspberry Pi: `sudo apt install pigpio` and ' +
          '`npm i pigpio` in packages/vehicle. On a dev machine use the "sim" driver.',
      );
    });
    const Gpio = pigpio.Gpio;
    this.gpios = this.pins.map((pin) => new Gpio(pin, { mode: Gpio.OUTPUT }));
    // Start every pin at neutral so nothing lurches on boot.
    this.gpios.forEach((g) => g.servoWrite(1500));
    console.log(`[gpio-pwm] ready on BCM pins [${this.pins.join(', ')}]`);
  }

  async writeChannels(channelsUs: number[]): Promise<void> {
    for (let i = 0; i < this.gpios.length; i++) {
      const us = channelsUs[i];
      if (typeof us === 'number') this.gpios[i].servoWrite(clampChannelUs(us));
    }
    this.last = channelsUs.slice(0, CHANNEL_COUNT);
  }

  readLast(): number[] {
    return this.last.slice();
  }

  async close(): Promise<void> {
    // Drop pulses (servoWrite 0 = off) so outputs are defined at shutdown.
    try {
      this.gpios.forEach((g) => g.servoWrite(0));
    } catch {
      /* best effort */
    }
  }
}
