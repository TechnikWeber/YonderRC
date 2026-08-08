import {
  CHANNEL_COUNT,
  CHANNEL_NEUTRAL_US,
  CONTROL_PERIOD_MS,
  WATCHDOG_TIMEOUT_MS,
  clampChannelUs,
  neutralChannels,
} from '@yonderrc/protocol';
import type { ControlMessage, StatusMessage } from '@yonderrc/protocol';
import type { OutputDriver } from '../drivers/OutputDriver.js';
import { EscCalibration } from './EscCalibration.js';

export interface VehicleCoreOptions {
  driver: OutputDriver;
  channelCount?: number;
  watchdogTimeoutMs?: number;
  /**
   * Per-channel failsafe values in µs. Applied when the link is lost. Defaults
   * to neutral on every channel. In M1 these come from the active profile,
   * pushed from the ground and stored here on the vehicle — because when the
   * link drops, only the vehicle can still act.
   */
  failsafeUs?: number[];
  /**
   * Channels that must be held at failsafe whenever the vehicle is disarmed
   * (typically throttle). Prevents a motor spinning up on connect/boot.
   */
  throttleChannels?: number[];
}

/**
 * VehicleCore owns the live channel state and the safety rules around it:
 *  - arming (outputs to throttle channels stay safe until explicitly armed)
 *  - a TIME-BASED watchdog (no frame within the window → failsafe values)
 *
 * It ticks at the control rate and writes to the driver every tick, so the
 * output reflects failsafe within one period of a link loss rather than
 * freezing on the last command (the v2 runaway bug).
 */
export class VehicleCore {
  private driver: OutputDriver;
  private channelCount: number;
  private watchdogTimeoutMs: number;
  private failsafeUs: number[];
  private throttleChannels: Set<number>;

  private commanded: number[];
  private armed = false;
  private failsafeActive = true;
  private lastFrameAt = 0;
  private lastSeq = -1;
  private lastClientT = 0;

  private timer: ReturnType<typeof setInterval> | null = null;
  private calibration = new EscCalibration();

  constructor(opts: VehicleCoreOptions) {
    this.driver = opts.driver;
    this.channelCount = opts.channelCount ?? CHANNEL_COUNT;
    this.watchdogTimeoutMs = opts.watchdogTimeoutMs ?? WATCHDOG_TIMEOUT_MS;
    this.failsafeUs = (opts.failsafeUs ?? neutralChannels()).slice(0, this.channelCount);
    this.throttleChannels = new Set(opts.throttleChannels ?? []);
    this.commanded = this.failsafeUs.slice();
  }

  async start(): Promise<void> {
    await this.driver.init();
    // Write a safe frame immediately so outputs are defined from t=0.
    await this.driver.writeChannels(this.resolveOutput());
    this.timer = setInterval(() => {
      void this.tick();
    }, CONTROL_PERIOD_MS);
  }

  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    // Leave outputs in a defined safe state on shutdown.
    await this.driver.writeChannels(this.failsafeUs.slice());
    await this.driver.close();
  }

  /** Apply an incoming control frame. Older/duplicate frames are ignored. */
  applyControl(msg: ControlMessage): void {
    if (msg.seq <= this.lastSeq) return; // newest-wins, drop stale
    this.lastSeq = msg.seq;
    this.lastClientT = msg.t;
    this.lastFrameAt = Date.now();
    const incoming = msg.channels;
    for (let i = 0; i < this.channelCount; i++) {
      const v = incoming[i];
      this.commanded[i] = typeof v === 'number' ? clampChannelUs(v) : CHANNEL_NEUTRAL_US;
    }
  }

  setArmed(armed: boolean): void {
    // Arming is blocked while an ESC calibration is running (bench safety).
    if (this.calibration.isActive) {
      this.armed = false;
      return;
    }
    this.armed = armed;
  }

  /**
   * Reset the accepted-sequence tracking. Called when a NEW ground connects (page
   * reload, reconnect), whose seq counter restarts at 0. Without this the vehicle
   * would treat every fresh frame as "older" than the last session's high seq and
   * drop them all — freezing channels, tripping failsafe and making round-trip
   * climb forever.
   */
  resetControlLink(): void {
    this.lastSeq = -1;
    this.lastFrameAt = 0;
    this.lastClientT = 0;
  }

  // --- ESC calibration control (from the ground) ---
  startCalibration(channel: number, minUs?: number, maxUs?: number): void {
    this.armed = false; // never armed during calibration
    this.calibration.start(channel, minUs, maxUs);
    console.log(`[calib] started on channel ${channel + 1} — MAX applied`);
  }
  nextCalibration(): void {
    const stillActive = this.calibration.next();
    console.log(`[calib] step → ${this.calibration.status().step}`);
    if (!stillActive) console.log('[calib] finished');
  }
  cancelCalibration(): void {
    this.calibration.cancel();
    console.log('[calib] cancelled');
  }

  /** Update per-channel failsafe values (pushed from the ground's active profile). */
  setFailsafe(channelsUs: number[]): void {
    for (let i = 0; i < this.channelCount; i++) {
      const v = channelsUs[i];
      if (typeof v === 'number') this.failsafeUs[i] = clampChannelUs(v);
    }
  }

  /** Update which channels are forced safe while disarmed (typically throttle). */
  setThrottleChannels(channels: number[]): void {
    this.throttleChannels = new Set(channels.filter((n) => Number.isInteger(n)));
  }

  /** True while no fresh frame has arrived within the watchdog window. */
  private isLinkLost(): boolean {
    return Date.now() - this.lastFrameAt > this.watchdogTimeoutMs;
  }

  /**
   * Resolve the values actually sent to the driver, applying the safety rules:
   *  1. link lost      → every channel to its failsafe value
   *  2. disarmed       → throttle channels forced to failsafe (rest pass through)
   *  3. armed + linked → commanded values
   */
  private resolveOutput(): number[] {
    // ESC calibration overrides everything: throttle channel gets the calibration
    // value, every other channel is held at failsafe, and the vehicle is disarmed.
    if (this.calibration.isActive) {
      const out = this.failsafeUs.slice();
      const ch = this.calibration.calibratedChannel;
      const thr = this.calibration.throttleOutput();
      if (thr !== null && ch >= 0 && ch < out.length) out[ch] = thr;
      this.failsafeActive = false;
      return out;
    }
    if (this.isLinkLost()) {
      this.failsafeActive = true;
      return this.failsafeUs.slice();
    }
    this.failsafeActive = false;
    const out = this.commanded.slice();
    if (!this.armed) {
      for (const ch of this.throttleChannels) {
        if (ch >= 0 && ch < out.length) out[ch] = this.failsafeUs[ch];
      }
    }
    return out;
  }

  private async tick(): Promise<void> {
    try {
      await this.driver.writeChannels(this.resolveOutput());
    } catch (err) {
      console.error('[core] driver write failed:', err);
    }
  }

  status(): StatusMessage {
    return {
      type: 'status',
      armed: this.armed,
      failsafeActive: this.failsafeActive,
      channels: this.driver.readLast(),
      lastFrameAgeMs: this.lastFrameAt === 0 ? -1 : Date.now() - this.lastFrameAt,
      lastSeq: this.lastSeq,
      lastClientT: this.lastClientT,
      calibration: this.calibration.isActive ? this.calibration.status() : undefined,
    };
  }
}
