import type { OutputDriver } from './OutputDriver.js';
import { SimDriver } from './SimDriver.js';
import { Pca9685Driver } from './Pca9685Driver.js';
import { GpioPwmDriver } from './GpioPwmDriver.js';
import { SbusDriver } from './SbusDriver.js';

export type DriverKind = 'sim' | 'pca9685' | 'gpio-pwm' | 'sbus';

export interface DriverOptions {
  logEveryMs?: number; // sim
  pca9685?: { bus?: number; address?: number; freqHz?: number };
  gpioPwm?: { pins?: number[] };
  sbus?: { path?: string; frameIntervalMs?: number };
}

/**
 * Build the configured output driver. All hardware drivers implement the exact
 * same OutputDriver interface, so nothing else in the system changes with the
 * choice. Native hardware libraries are loaded lazily inside each driver's
 * init(), so importing/instantiating here is safe on any machine — only the
 * selected driver ever touches hardware.
 */
export async function createDriver(
  kind: DriverKind,
  opts: DriverOptions = {},
): Promise<OutputDriver> {
  switch (kind) {
    case 'sim':
      return new SimDriver({ logEveryMs: opts.logEveryMs });
    case 'pca9685':
      return new Pca9685Driver(opts.pca9685);
    case 'gpio-pwm':
      return new GpioPwmDriver(opts.gpioPwm);
    case 'sbus':
      return new SbusDriver(opts.sbus);
    default:
      throw new Error(`Unknown output driver "${kind as string}".`);
  }
}
