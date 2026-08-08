/**
 * SBUS frame encoder — pure, no I/O.
 *
 * SBUS packs 16 channels of 11 bits each into 22 bytes, little-endian bit order,
 * framed by a start byte (0x0F), a flags byte, and an end byte (0x00). Wire is
 * 100000 baud, 8E2, and electrically inverted (handled by the UART/hardware, not
 * here). Channel values are 11-bit (0..2047); 172..1811 corresponds to the usual
 * 1000..2000 µs, which is what usToSbus() maps.
 */

export const SBUS_START = 0x0f;
export const SBUS_END = 0x00;
export const SBUS_MIN = 172; // ~1000 µs
export const SBUS_MAX = 1811; // ~2000 µs

/** Map a servo pulse width in µs to an 11-bit SBUS value. */
export function usToSbus(us: number): number {
  const t = (us - 1000) / 1000; // 0..1 across 1000..2000 µs
  const v = Math.round(SBUS_MIN + t * (SBUS_MAX - SBUS_MIN));
  return Math.max(0, Math.min(2047, v));
}

export interface SbusFlags {
  ch17?: boolean;
  ch18?: boolean;
  frameLost?: boolean;
  failsafe?: boolean;
}

/** Encode up to 16 channels (11-bit each) into a 25-byte SBUS frame. */
export function encodeSbusFrame(channels11: number[], flags: SbusFlags = {}): Uint8Array {
  const frame = new Uint8Array(25);
  frame[0] = SBUS_START;

  // Pack 16 * 11 bits into bytes 1..22, LSB-first.
  let bitBuffer = 0;
  let bitsInBuffer = 0;
  let byteIndex = 1;
  for (let i = 0; i < 16; i++) {
    const value = Math.max(0, Math.min(2047, channels11[i] ?? 0)) & 0x07ff;
    bitBuffer |= value << bitsInBuffer;
    bitsInBuffer += 11;
    while (bitsInBuffer >= 8) {
      frame[byteIndex++] = bitBuffer & 0xff;
      bitBuffer >>= 8;
      bitsInBuffer -= 8;
    }
  }

  let flagByte = 0;
  if (flags.ch17) flagByte |= 0x01;
  if (flags.ch18) flagByte |= 0x02;
  if (flags.frameLost) flagByte |= 0x04;
  if (flags.failsafe) flagByte |= 0x08;
  frame[23] = flagByte;
  frame[24] = SBUS_END;
  return frame;
}
