/**
 * Pure hardware-detection helpers — no I/O, unit-tested. Turn `i2cdetect` output
 * into a list of present addresses and human hints, so the setup UI can suggest a
 * driver / sensor instead of making the user guess.
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

export interface I2cSuggestion {
  address: string;
  hint: string;
}

/** Map known I²C addresses to the device YonderRC most likely expects there. */
export function suggestI2c(addresses: number[]): I2cSuggestion[] {
  const hex = (n: number) => '0x' + n.toString(16).padStart(2, '0');
  const hintFor = (a: number): string => {
    if (a === 0x40) return 'PCA9685 servo/ESC driver — or INA2xx current sensor (219/226/228/237/238)';
    if (a >= 0x48 && a <= 0x4b) return 'ADS1015/1115 ADC (voltage) — or INA2xx';
    if (a >= 0x41 && a <= 0x4f) return 'INA2xx current sensor (219/226/228/237/238/3221)';
    if (a === 0x36) return 'MAX17043 battery fuel gauge';
    if (a >= 0x68 && a <= 0x69) return 'IMU / RTC (MPU6050 / DS3231)';
    return 'unknown I²C device';
  };
  return addresses.map((a) => ({ address: hex(a), hint: hintFor(a) }));
}
