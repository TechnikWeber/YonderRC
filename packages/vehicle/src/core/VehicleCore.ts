import {
  CHANNEL_COUNT,
  CONTROL_RATE_HZ,
  CHANNEL_NEUTRAL_US,
  CONTROL_PERIOD_MS,
  WATCHDOG_TIMEOUT_MS,
  clampChannelUs,
  neutralChannels,
} from '@yonderrc/protocol';
import type { ControlMessage, StatusMessage } from '@yonderrc/protocol';
import type { OutputDriver } from '../drivers/OutputDriver.js';
import { EscCalibration } from './EscCalibration.js';
import { LinkStats, type ControlVia } from './linkStats.js';

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
   * Per-channel values the throttle channels take while DISARMED (motor off / stop).
   * Defaults to the failsafe values. Pushed from the ground like failsafeUs.
   */
  disarmedUs?: number[];
  /**
   * Channels that must be held at their disarmed value whenever the vehicle is
   * disarmed (typically throttle). Prevents a motor spinning up on connect/boot.
   */
  throttleChannels?: number[];
  /**
   * Auto-disarm when a new ground connects. Default true (safe for cars/boats). The
   * ground overrides this per vehicle type (false for aircraft) via a config frame.
   */
  disarmOnReconnect?: boolean;
}

/**
 * The safety values a restarted service has to come back with — what the last ground
 * pushed. Kept in the config file (`controlSafety`) and handed back to the constructor.
 */
export interface ControlSafety {
  failsafeUs: number[];
  disarmedUs: number[];
  throttleChannels: number[];
}

/** `count` clamped channel values: from `src` where it holds a number, else from `fallback`. */
function channelValues(src: readonly unknown[] | undefined, fallback: readonly number[], count: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const v = src?.[i];
    out.push(typeof v === 'number' && Number.isFinite(v) ? clampChannelUs(v) : fallback[i] ?? CHANNEL_NEUTRAL_US);
  }
  return out;
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
  private disarmedUs: number[];
  private testOverride: { ch: number; us: number } | null = null;
  private throttleChannels: Set<number>;
  private disarmOnReconnect: boolean;

  private commanded: number[];
  private armed = false;
  private failsafeActive = true;
  private lastFrameAt = 0;
  private lastSeq = -1;
  private controlSession = 0;
  private lastClientT = 0;

  private timer: ReturnType<typeof setInterval> | null = null;
  private calibration = new EscCalibration();

  /**
   * Arrival-side record of the control link — gap histogram and failsafe episodes —
   * for the diagnostics export. Counting only; it never influences an output.
   */
  readonly link = new LinkStats(Date.now());

  constructor(opts: VehicleCoreOptions) {
    this.driver = opts.driver;
    this.channelCount = opts.channelCount ?? CHANNEL_COUNT;
    this.watchdogTimeoutMs = opts.watchdogTimeoutMs ?? WATCHDOG_TIMEOUT_MS;
    this.failsafeUs = channelValues(opts.failsafeUs, neutralChannels(), this.channelCount);
    this.disarmedUs = channelValues(opts.disarmedUs, this.failsafeUs, this.channelCount);
    this.throttleChannels = new Set();
    this.setThrottleChannels(opts.throttleChannels ?? []);
    this.disarmOnReconnect = opts.disarmOnReconnect ?? true;
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
    await this.driver.writeChannels(this.safeOutput());
    await this.driver.close();
  }

  /**
   * Apply an incoming control frame. Older/duplicate frames are ignored, and so are
   * frames from a session that has been superseded.
   *
   * The session check is not belt-and-braces. A superseded ground keeps sending for a
   * while — a WebSocket close is quick, but a **WebRTC data channel takes seconds to
   * tear down**, and control frames travel over that channel. One straggler carrying the
   * old session's high sequence number lands after the new session reset `lastSeq` to
   * −1, pins it back up there, and every frame from the new ground is then dropped as
   * "stale". Arm and config still work, because those go over the reliable WS — which is
   * exactly what it looked like: a connected vehicle that would not steer.
   */
  applyControl(msg: ControlMessage, session?: number, via: ControlVia = 'ws'): void {
    // A frame without a sequence number or a channel list is not a frame — and reading
    // `channels[i]` off a missing list threw inside the socket handler.
    if (!Number.isFinite(msg.seq) || !Array.isArray(msg.channels)) return;
    if (session !== undefined && session !== this.controlSession) {
      this.link.dropped('superseded');
      return; // superseded ground
    }
    if (msg.seq <= this.lastSeq) {
      this.link.dropped('stale');
      return; // newest-wins, drop stale
    }
    this.lastSeq = msg.seq;
    this.lastClientT = typeof msg.t === 'number' ? msg.t : 0;
    this.lastFrameAt = Date.now();
    this.link.frame(this.lastFrameAt, via);
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

  /**
   * Start a control session and return its token. Everything that can reach
   * `applyControl` for this ground — the WebSocket and its WebRTC data channel — carries
   * the same token, so the moment a new ground takes over, the previous one stops being
   * able to move anything.
   */
  beginControlSession(): number {
    this.controlSession += 1;
    this.resetControlLink();
    this.link.beginSession(this.controlSession, Date.now());
    return this.controlSession;
  }

  /**
   * The controlling ground's connection closed. Nothing changes for the outputs — the
   * watchdog keeps them at failsafe — this only tells the link statistics that what
   * follows is a parked vehicle, not a dropout.
   */
  endControlSession(session: number): void {
    this.link.endSession(session, Date.now());
  }

  /** The output driver actually running — `sim` after a hardware driver failed to start. */
  get driverKind(): string {
    return this.driver.kind;
  }

  /**
   * What each channel is wired to on the running driver ('' = nowhere), or undefined
   * when the driver has no hardware to name — the sim, or a hardware driver that fell
   * back to it.
   */
  outputLabels(): string[] | undefined {
    const d = this.driver;
    if (!d.outputLabel) return undefined;
    return Array.from({ length: CHANNEL_COUNT }, (_, ch) => d.outputLabel?.(ch) ?? '');
  }

  get watchdogMs(): number {
    return this.watchdogTimeoutMs;
  }

  /**
   * Change the watchdog live. It is only a comparison against the age of the last frame,
   * so there is nothing to restart — the setup page's Save takes effect on the next tick.
   * The caller clamps (see clampWatchdogMs); this refuses only what is not a number.
   */
  setWatchdogTimeout(ms: number): void {
    if (Number.isFinite(ms) && ms > 0) this.watchdogTimeoutMs = ms;
  }

  /** The session token currently accepted. */
  get activeControlSession(): number {
    return this.controlSession;
  }

  /**
   * What the ground last asked for, before arming, failsafe and the test override have
   * their say. `status()` reports what the driver actually wrote, which needs a running
   * tick; this is the raw command.
   */
  readCommanded(): number[] {
    return this.commanded.slice();
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

  /** Update per-channel disarmed values (throttle → off/stop, distinct from failsafe). */
  setDisarmedUs(channelsUs: number[]): void {
    for (let i = 0; i < this.channelCount; i++) {
      const v = channelsUs[i];
      if (typeof v === 'number') this.disarmedUs[i] = clampChannelUs(v);
    }
  }

  /**
   * Bench self-test override: force one channel to a value (all others held at
   * failsafe), regardless of link state, but ONLY while disarmed. Used by the
   * setup UI to sweep a channel and verify servo wiring. Returns false if armed.
   */
  setTestOverride(channel: number, us: number): boolean {
    if (this.armed) return false;
    this.testOverride = { ch: channel, us: clampChannelUs(us) };
    return true;
  }
  clearTestOverride(): void {
    this.testOverride = null;
  }

  /** Update which channels are forced safe while disarmed (typically throttle). */
  setThrottleChannels(channels: number[]): void {
    this.throttleChannels = new Set(channels.filter((n) => Number.isInteger(n) && n >= 0 && n < this.channelCount));
  }

  /** The values a restart must come back with — see ControlSafety. */
  safetyConfig(): ControlSafety {
    return {
      failsafeUs: this.failsafeUs.slice(),
      disarmedUs: this.disarmedUs.slice(),
      throttleChannels: [...this.throttleChannels].sort((a, b) => a - b),
    };
  }

  /** Vehicle-type policy pushed from the ground: auto-disarm on a new connection? */
  setDisarmOnReconnect(v: boolean): void {
    this.disarmOnReconnect = v;
  }
  get shouldDisarmOnReconnect(): boolean {
    return this.disarmOnReconnect;
  }

  /** True while no fresh frame has arrived within the watchdog window. */
  private isLinkLost(): boolean {
    return Date.now() - this.lastFrameAt > this.watchdogTimeoutMs;
  }

  /**
   * Failsafe on every channel — except that while DISARMED the throttle channels take
   * their disarmed value. The two differ for aircraft: a drone's failsafe holds hover
   * throttle for a link loss in flight, and that must not spin up a drone sitting
   * disarmed on the bench when its ground goes away, or before one ever connected.
   */
  private safeOutput(): number[] {
    const out = this.failsafeUs.slice();
    if (!this.armed) {
      for (const ch of this.throttleChannels) {
        if (ch >= 0 && ch < out.length) out[ch] = this.disarmedUs[ch];
      }
    }
    return out;
  }

  /**
   * Resolve the values actually sent to the driver, applying the safety rules:
   *  1. link lost      → failsafe values (throttle at its disarmed value while disarmed)
   *  2. disarmed       → throttle channels forced to their DISARMED value (off/stop)
   *  3. armed + linked → commanded values
   */
  private resolveOutput(): number[] {
    // Bench self-test: one channel driven, everything else safe. Highest priority
    // but gated on disarmed (setTestOverride refuses while armed).
    if (this.testOverride && !this.armed) {
      const out = this.safeOutput();
      const { ch, us } = this.testOverride;
      if (ch >= 0 && ch < out.length) out[ch] = us;
      this.failsafeActive = false;
      return out;
    }
    // ESC calibration overrides everything: throttle channel gets the calibration
    // value, every other channel is held safe, and the vehicle is disarmed — but only
    // while the ground running it is still there. It used to ignore the link: a ground
    // that went away in the MAX step left the ESC at full throttle until someone
    // restarted the service.
    if (this.calibration.isActive) {
      if (this.isLinkLost()) {
        this.calibration.cancel();
        console.warn('[calib] link lost — calibration cancelled, throttle back to its safe value');
      } else {
        const out = this.safeOutput();
        const ch = this.calibration.calibratedChannel;
        const thr = this.calibration.throttleOutput();
        if (thr !== null && ch >= 0 && ch < out.length) out[ch] = thr;
        this.failsafeActive = false;
        return out;
      }
    }
    if (this.isLinkLost()) {
      this.failsafeActive = true;
      return this.safeOutput();
    }
    this.failsafeActive = false;
    const out = this.commanded.slice();
    if (!this.armed) {
      // Deliberately disarmed: throttle to its OFF/STOP value (not the in-flight
      // failsafe, which for a drone holds mid). Other channels pass through.
      for (const ch of this.throttleChannels) {
        if (ch >= 0 && ch < out.length) out[ch] = this.disarmedUs[ch];
      }
    }
    return out;
  }

  /**
   * One write per tick, and never two at once.
   *
   * `setInterval` does not wait for an async callback, so a driver that stalls —
   * an I2C bus holding the line, a serial port with a full buffer — gets a second
   * `writeChannels` on top of the first. Two interleaved frames on the same bus is
   * not a slow servo, it is a corrupted one. Skipping is the right answer rather
   * than queueing: the next tick is 20 ms away and carries fresher values than
   * anything a queue would hold.
   */
  private writing = false;
  private skippedWrites = 0;

  private async tick(): Promise<void> {
    if (this.writing) {
      this.skippedWrites += 1;
      // Loud, but only once per second of stalling, so a bad bus is visible in the
      // log without drowning it.
      if (this.skippedWrites % CONTROL_RATE_HZ === 0) {
        console.warn(`[core] driver write still busy — ${this.skippedWrites} ticks skipped`);
      }
      return;
    }
    this.writing = true;
    // A connection that has not delivered its first frame yet is not a dropout — every
    // connection opens in failsafe (resetControlLink zeroes lastFrameAt).
    let failsafeNow = false;
    try {
      const out = this.resolveOutput();
      failsafeNow = this.failsafeActive && this.lastFrameAt !== 0;
      await this.driver.writeChannels(out);
    } catch (err) {
      console.error('[core] driver write failed:', err);
    } finally {
      this.writing = false;
    }
    // Statistics come last and on their own: counting must never cost a write.
    try {
      this.link.observeFailsafe(failsafeNow, Date.now());
    } catch {
      /* counting only */
    }
  }

  /** Ticks dropped because the driver was still writing. Zero on healthy hardware. */
  get droppedWrites(): number {
    return this.skippedWrites;
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
