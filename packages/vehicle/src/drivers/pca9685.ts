/**
 * PCA9685 16-channel PWM driver — pure register math, no I/O.
 *
 * This isolates the exact bug that broke the old v2 server: there, the chip ran
 * at 50 Hz but the pulse-width math used 60 Hz, so every pulse was ~20% off. Here
 * the frequency is a single value and the counts are always derived from it.
 */

export const PCA9685_MODE1 = 0x00;
export const PCA9685_MODE2 = 0x01;
export const PCA9685_PRESCALE = 0xfe;
export const PCA9685_LED0_ON_L = 0x06;

export const MODE1_SLEEP = 0x10;
export const MODE1_AI = 0x20; // auto-increment
export const MODE1_RESTART = 0x80;
export const MODE2_OUTDRV = 0x04;

const OSC_CLOCK_HZ = 25_000_000; // internal oscillator
const COUNTS = 4096;

/** Prescale value for a target PWM frequency (datasheet formula, rounded). */
export function prescaleFor(freqHz: number): number {
  const prescale = Math.round(OSC_CLOCK_HZ / (COUNTS * freqHz)) - 1;
  return Math.max(3, Math.min(255, prescale)); // datasheet valid range
}

/**
 * Convert a pulse width in microseconds to a 12-bit "off" count for the given
 * PWM frequency. On-count is 0, so the pulse starts at the period boundary.
 */
export function pulseWidthToCounts(us: number, freqHz: number): number {
  const periodUs = 1_000_000 / freqHz;
  const counts = Math.round((us / periodUs) * COUNTS);
  return Math.max(0, Math.min(COUNTS - 1, counts));
}

/** The 4 bytes (ON_L, ON_H, OFF_L, OFF_H) for a channel's on=0/off=count pulse. */
export function channelBytes(offCount: number): [number, number, number, number] {
  const off = Math.max(0, Math.min(COUNTS - 1, offCount));
  return [0x00, 0x00, off & 0xff, (off >> 8) & 0x0f];
}

/** Register address of a channel's first (ON_L) register. */
export function channelRegister(channel: number): number {
  return PCA9685_LED0_ON_L + 4 * channel;
}

/**
 * Which channels have to go out on the wire. The PCA9685 holds the last value it was
 * given, so re-sending an unchanged one buys nothing — and it is not free: each channel
 * is its own I²C transaction, sixteen of them nearly fill the 20 ms control tick, and
 * `VehicleCore` then drops the next tick ("driver write still busy").
 *
 * `null` in `next` means "leave this channel alone" (the caller had no value for it),
 * which is not the same as "write zero". `prev` of null means nothing is known about the
 * chip — after init, or after a failed write — and forces every known value out again,
 * so the cache can never claim a value the chip never received.
 */
export function channelsToWrite(prev: (number | null)[] | null, next: (number | null)[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < next.length; i++) {
    if (next[i] === null) continue;
    if (!prev || prev[i] !== next[i]) out.push(i);
  }
  return out;
}
