/**
 * OutputDriver is the single seam between YonderRC's control logic and the
 * physical output. Everything above it speaks microseconds; each driver decides
 * how to realize that (I2C PWM chip, direct GPIO, an SBUS UART frame, or nothing
 * at all in simulation).
 *
 * Because the core only ever talks to this interface, "simulation mode" is not a
 * special path through the code — it's just the SimDriver. The same control
 * logic, watchdog and profiles run identically with or without hardware.
 */
export interface OutputDriver {
  /** Human-readable id surfaced to the ground station (e.g. "sim", "pca9685"). */
  readonly kind: string;

  /** Prepare the driver. Called once at startup. */
  init(): Promise<void>;

  /**
   * Write all channel values, in microseconds. Called every control tick
   * (~50 Hz) with the current safe, clamped values — including failsafe values
   * when the watchdog has tripped.
   */
  writeChannels(channelsUs: number[]): Promise<void>;

  /** Read back the last values written, for status/telemetry. */
  readLast(): number[];

  /** Release resources (I2C bus, serial port, …). */
  close(): Promise<void>;
}
