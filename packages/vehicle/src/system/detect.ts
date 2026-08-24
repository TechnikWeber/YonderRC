/**
 * Pure hardware-detection helpers — no I/O, unit-tested. Turn `i2cdetect` output
 * into a list of present addresses and human hints, so the setup UI can suggest a
 * driver / sensor instead of making the user guess.
 *
 * An address alone is a guess: 0x40 is the factory default of BOTH the PCA9685 and
 * every INA2xx, which is exactly the collision an operator runs into first. Most of
 * these chips can say what they are, so `probesFor` + `identifyI2c` read their ID
 * registers and turn "0x40 — PCA9685 or INA2xx" into "0x40 — INA228, confirmed".
 * The reads themselves happen in RealSystem (i2ctransfer); everything here is pure.
 */

/**
 * Present I²C addresses from `i2cdetect -y <bus>`. Data cells print the device's own
 * address as two hex digits, so we can read them directly regardless of column
 * alignment. The `XX:` row label is stripped first; `UU` (driver-claimed) cells are
 * not counted (their address isn't recoverable after whitespace collapsing).
 */
export function parseI2cAddresses(out: string): number[] {
  const addrs = new Set<number>();
  for (const line of out.split('\n')) {
    const cells = line.replace(/^\s*[0-9a-fA-F]{2}:/, '').split(/\s+/);
    for (const c of cells) if (/^[0-9a-fA-F]{2}$/.test(c)) addrs.add(parseInt(c, 16));
  }
  return [...addrs].sort((a, b) => a - b);
}

/** One identifying register read. `bytes` is what the register returns, big-endian. */
export interface I2cProbe {
  /** Name under which `identifyI2c` expects the value. */
  key: string;
  address: number;
  reg: number;
  bytes: number;
}

/** Register values read back for one address, `null` where the read failed. */
export type I2cReads = Record<string, number | null>;

/** TI's manufacturer ID, ASCII "TI", in every INA2xx. */
export const TI_MANUFACTURER = 0x5449;

/** DIE_ID (bits 15:4 of the ID register) → the sensor kind our config uses. */
const INA_DIE_A: Record<number, string> = {
  0x228: 'ina228',
  0x229: 'ina229', // not a configurable kind here, but worth naming in the UI
  0x237: 'ina237',
  0x238: 'ina238',
};
/** Older INA parts keep manufacturer/die at 0xFE/0xFF and use the whole word. */
const INA_DIE_B: Record<number, string> = {
  0x2260: 'ina226',
  0x2270: 'ina260',
  0x3220: 'ina3221',
};

/**
 * Which register reads help identify a device at this address. Reads only — and only
 * registers that exist on the chips we actually expect in that address range, so a
 * probe can't disturb a device. A read of an unknown chip's unknown register returns
 * junk, which `identifyI2c` then simply doesn't recognise.
 */
export function probesFor(address: number): I2cProbe[] {
  const probes: I2cProbe[] = [];
  const at = (key: string, reg: number, bytes: number) => probes.push({ key, address, reg, bytes });
  if (address >= 0x40 && address <= 0x4f) {
    at('inaManufA', 0x3e, 2); // INA228/229/237/238
    at('inaDieA', 0x3f, 2);
    at('inaManufB', 0xfe, 2); // INA226/260/3221
    at('inaDieB', 0xff, 2);
    at('mode1', 0x00, 1); // PCA9685 MODE1 — its ALLCALL bit
    at('mode2', 0x01, 1); // PCA9685 MODE2 — its top three bits always read 0
    at('prescale', 0xfe, 1); // PCA9685 PRE_SCALE — the PWM frequency it is set to
  }
  if (address >= 0x48 && address <= 0x4b) at('tmp117Id', 0x0f, 2);
  if (address >= 0x18 && address <= 0x1f) {
    at('mcpManuf', 0x06, 2);
    at('mcpDevice', 0x07, 2);
  }
  if (address === 0x76 || address === 0x77) at('bmpChipId', 0xd0, 1);
  return probes;
}

/**
 * `i2ctransfer` arguments for one probe: write the register pointer, then read back.
 * Returned as an argv array — RealSystem execs it without a shell, and every element
 * is a number we formatted ourselves, so nothing operator-supplied gets near it.
 */
export function i2cTransferArgs(bus: number, p: I2cProbe): string[] {
  const hex = (n: number) => '0x' + Math.trunc(n).toString(16);
  return ['-y', String(Math.trunc(bus)), `w1@${hex(p.address)}`, hex(p.reg), `r${Math.trunc(p.bytes)}`];
}

/**
 * `i2ctransfer` prints the bytes it read as `0x22 0x81`. Combine them big-endian —
 * that is the byte order every one of these ID registers uses. Returns null when the
 * output holds no byte values (device didn't answer, tool missing, error text).
 */
export function parseI2cTransfer(out: string): number | null {
  const bytes = (out.match(/0x[0-9a-fA-F]{1,2}\b/g) ?? []).map((b) => parseInt(b, 16));
  if (bytes.length === 0) return null;
  return bytes.reduce((acc, b) => (acc << 8) | b, 0);
}

export interface I2cSuggestion {
  address: string;
  hint: string;
  /** Chip name once an ID register confirmed it, else null. */
  device?: string | null;
  /** Machine-usable kind for the setup forms ('ina228', 'pca9685', 'mcp9808', …). */
  kind?: string | null;
  /** true = read back from the chip, false = guessed from the address alone. */
  confirmed?: boolean;
}

/** Map known I²C addresses to the device YonderRC most likely expects there. */
function hintFor(address: number): string {
  if (address === 0x70) return 'PCA9685 all-call address — answers in addition to its own address';
  if (address === 0x40) return 'PCA9685 servo/ESC driver — or INA2xx current sensor (219/226/228/237/238)';
  if (address >= 0x48 && address <= 0x4b) return 'ADS1015/1115 ADC (voltage) — or INA2xx';
  if (address >= 0x41 && address <= 0x4f) return 'INA2xx current sensor (219/226/228/237/238/3221)';
  if (address === 0x36) return 'MAX17043 battery fuel gauge';
  if (address >= 0x68 && address <= 0x69) return 'IMU / RTC (MPU6050 / DS3231)';
  return 'unknown I²C device';
}

/**
 * Identify one device from what its ID registers returned. `allCall` says whether
 * 0x70 answered on the bus: the PCA9685 has no ID register at all, but it does
 * respond to the all-call address and keeps that bit set in MODE1 — the two together
 * are enough to name it instead of leaving the operator with "0x40 — or".
 */
export function identifyI2c(address: number, reads: I2cReads, allCall = false): I2cSuggestion {
  const hex = '0x' + address.toString(16).padStart(2, '0');
  const found = (device: string, kind: string | null, extra = ''): I2cSuggestion => ({
    address: hex,
    hint: `${device}${extra} — identified from its ID register`,
    device,
    kind,
    confirmed: true,
  });

  if (reads.inaManufA === TI_MANUFACTURER && reads.inaDieA != null) {
    const kind = INA_DIE_A[reads.inaDieA >> 4];
    if (kind) return found(kind.toUpperCase(), kind === 'ina229' ? null : kind, ` rev ${reads.inaDieA & 0xf}`);
    return found(`INA2xx (die 0x${(reads.inaDieA >> 4).toString(16)})`, null);
  }
  if (reads.inaManufB === TI_MANUFACTURER && reads.inaDieB != null) {
    const kind = INA_DIE_B[reads.inaDieB];
    if (kind) return found(kind.toUpperCase(), kind);
    return found(`INA2xx (die 0x${reads.inaDieB.toString(16)})`, null);
  }
  if (reads.tmp117Id === 0x0117) return found('TMP117', 'tmp117');
  if (reads.mcpManuf === 0x0054 && reads.mcpDevice != null && reads.mcpDevice >> 8 === 0x04) {
    return found('MCP9808', 'mcp9808');
  }
  if (reads.bmpChipId === 0x58) return found('BMP280', 'bmp280');
  if (reads.bmpChipId === 0x60) return found('BME280', 'bme280');
  // No ID register: the PCA9685 gives itself away through the all-call address.
  if (allCall && address !== 0x70 && reads.mode1 != null && (reads.mode1 & 0x01) !== 0) {
    return {
      address: hex,
      hint: 'PCA9685 servo/ESC driver — identified via its all-call address (0x70)',
      device: 'PCA9685',
      kind: 'pca9685',
      confirmed: true,
    };
  }
  // All-call switched off (some drivers clear it): fall back to the register
  // signature — MODE2's top three bits read 0 and PRE_SCALE holds a valid divider.
  // That is a family resemblance, not an ID, so it stays an unconfirmed guess.
  if (looksLikePca9685(reads)) {
    return {
      address: hex,
      hint: `probably a PCA9685 — MODE2/PRE_SCALE look like one (${pwmFrequency(reads.prescale as number)} Hz), but its all-call address is off, so this cannot be confirmed`,
      device: 'PCA9685',
      kind: 'pca9685',
      confirmed: false,
    };
  }
  return { address: hex, hint: hintFor(address), device: null, kind: null, confirmed: false };
}

/** PWM frequency a PRE_SCALE value produces on the PCA9685's 25 MHz internal clock. */
export function pwmFrequency(prescale: number): number {
  return Math.round(25e6 / (4096 * (prescale + 1)));
}

/**
 * A PCA9685 whose all-call bit was cleared. MODE2 bits 7:5 are reserved and read 0,
 * and PRE_SCALE below 3 is not a legal divider — enough to tell it from an ADS1x15 or
 * an INA (whose registers are 16 bit and answer differently), not enough to be sure.
 */
function looksLikePca9685(reads: I2cReads): boolean {
  const { mode1, mode2, prescale } = reads;
  if (mode1 == null || mode2 == null || prescale == null) return false;
  return (mode2 & 0xe0) === 0 && prescale >= 3 && prescale <= 0xff;
}

/**
 * Turn the scanned addresses into UI rows. Pass `reads` (register values per address,
 * from `probesFor`) to get identified chips; without it the result is the old
 * address-based guess, which is what a Pi without `i2ctransfer` still gets.
 */
export function suggestI2c(addresses: number[], reads?: Map<number, I2cReads>): I2cSuggestion[] {
  const allCall = addresses.includes(0x70);
  return addresses.map((a) => identifyI2c(a, reads?.get(a) ?? {}, allCall));
}
