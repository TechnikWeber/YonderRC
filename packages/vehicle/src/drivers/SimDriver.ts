import { CHANNEL_COUNT, neutralChannels } from '@yonderrc/protocol';
import type { OutputDriver } from './OutputDriver.js';

/**
 * SimDriver realizes channels by simply remembering them. No I2C, no GPIO, no
 * UART — so it runs anywhere (your laptop, or a Pi with nothing plugged in) and
 * never errors on missing hardware. The ground station's virtual servo monitor
 * reads these values back through the status stream.
 *
 * Optional throttled logging lets you watch values in the terminal without
 * flooding it at 50 Hz.
 */
export class SimDriver implements OutputDriver {
  readonly kind = 'sim';
  private last: number[] = neutralChannels();
  private logEveryMs: number;
  private lastLog = 0;

  constructor(opts: { logEveryMs?: number } = {}) {
    this.logEveryMs = opts.logEveryMs ?? 0; // 0 = no logging
  }

  async init(): Promise<void> {
    this.last = neutralChannels();
    console.log(`[sim] output driver ready — ${CHANNEL_COUNT} channels, no hardware`);
  }

  async writeChannels(channelsUs: number[]): Promise<void> {
    this.last = channelsUs.slice(0, CHANNEL_COUNT);
    if (this.logEveryMs > 0) {
      const now = Date.now();
      if (now - this.lastLog >= this.logEveryMs) {
        this.lastLog = now;
        console.log('[sim] ch µs:', this.last.map((v) => String(v).padStart(4)).join(' '));
      }
    }
  }

  readLast(): number[] {
    return this.last.slice();
  }

  async close(): Promise<void> {
    /* nothing to release */
  }
}
