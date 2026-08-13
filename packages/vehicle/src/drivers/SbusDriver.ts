import { CHANNEL_COUNT, neutralChannels } from '@yonderrc/protocol';
import type { OutputDriver } from './OutputDriver.js';
import { encodeSbusFrame, usToSbus } from './sbus.js';

export interface SbusOptions {
  path?: string; // serial device, e.g. /dev/ttyAMA0
  /** Frame interval in ms. Standard SBUS is ~7ms (fast) or ~14ms. */
  frameIntervalMs?: number;
}

/**
 * SBUS output over a serial UART (100000 baud, 8E2). Feeds a real flight
 * controller / SBUS receiver-input with up to 16 channels on a single wire.
 * NOTE: SBUS is electrically inverted — use a hardware inverter or a UART/OS that
 * inverts, unless your FC accepts non-inverted SBUS. Native `serialport` is
 * imported lazily; the frame encoding itself is hardware-independent and tested.
 */
export class SbusDriver implements OutputDriver {
  readonly kind = 'sbus';
  private path: string;
  private intervalMs: number;
  private last = neutralChannels();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private port: any = null;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: SbusOptions = {}) {
    this.path = opts.path ?? '/dev/ttyAMA0';
    this.intervalMs = opts.frameIntervalMs ?? 7;
  }

  async init(): Promise<void> {
    const modName: string = 'serialport';
    const mod = await import(modName).catch(() => {
      throw new Error(
        'serialport not available. Install `npm i serialport` in packages/vehicle. ' +
          'On a dev machine use the "sim" driver.',
      );
    });
    const { SerialPort } = mod;
    this.port = new SerialPort({
      path: this.path,
      baudRate: 100000,
      dataBits: 8,
      parity: 'even',
      stopBits: 2,
      autoOpen: true,
    });
    // A serial error (unplugged adapter, I/O failure) must not crash the process as
    // an unhandled 'error' event — log it; the fixed-rate timer keeps trying and the
    // core's watchdog holds failsafe if output stops.
    this.port.on('error', (err: Error) => console.warn(`[sbus] serial error: ${err.message}`));

    // SBUS is continuous: retransmit the latest frame on a fixed cadence so the
    // receiver never times out even if channel values are unchanged.
    this.timer = setInterval(() => this.sendFrame(), this.intervalMs);
    console.log(`[sbus] ready on ${this.path} (100000 8E2, ${this.intervalMs} ms frames)`);
  }

  async writeChannels(channelsUs: number[]): Promise<void> {
    this.last = channelsUs.slice(0, CHANNEL_COUNT);
    // Actual transmission happens on the fixed-rate timer via sendFrame().
  }

  private sendFrame(): void {
    if (!this.port?.writable) return;
    const ch11 = this.last.map(usToSbus);
    const frame = encodeSbusFrame(ch11);
    this.port.write(Buffer.from(frame));
  }

  readLast(): number[] {
    return this.last.slice();
  }

  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      await new Promise<void>((res) => this.port?.close(() => res()));
    } catch {
      /* best effort */
    }
  }
}
