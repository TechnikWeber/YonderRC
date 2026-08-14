/**
 * Pure conversion math for the supported sensors — no I/O, fully unit-testable.
 * Each function turns a raw register/ADC reading into a physical value.
 * Datasheet LSB values are encoded here so the I/O layer stays trivial.
 */

function toSigned16(raw: number): number {
  return raw > 0x7fff ? raw - 0x10000 : raw;
}

// ---- INA219 ---- (bus LSB 4 mV after >>3; shunt LSB 10 µV)
export function ina219BusVolts(raw: number): number {
  return ((raw >> 3) & 0x1fff) * 0.004;
}
export function ina219Amps(shuntRaw: number, shuntOhms: number): number {
  const shuntV = toSigned16(shuntRaw) * 10e-6;
  return shuntV / shuntOhms;
}

// ---- INA226 ---- (bus LSB 1.25 mV; shunt LSB 2.5 µV)
export function ina226BusVolts(raw: number): number {
  return raw * 1.25e-3;
}
export function ina226Amps(shuntRaw: number, shuntOhms: number): number {
  const shuntV = toSigned16(shuntRaw) * 2.5e-6;
  return shuntV / shuntOhms;
}

// ---- INA260 ---- (integrated 2 mΩ shunt; current LSB 1.25 mA; bus LSB 1.25 mV)
export function ina260BusVolts(raw: number): number {
  return raw * 1.25e-3;
}
export function ina260Amps(currentRaw: number): number {
  return toSigned16(currentRaw) * 1.25e-3;
}

// ---- INA3221 ---- (bus LSB 8 mV after >>3; shunt LSB 40 µV after >>3)
export function ina3221BusVolts(raw: number): number {
  return (toSigned16(raw) >> 3) * 0.008;
}
export function ina3221Amps(shuntRaw: number, shuntOhms: number): number {
  const shuntV = (toSigned16(shuntRaw) >> 3) * 40e-6;
  return shuntV / shuntOhms;
}

/**
 * ---- INA228 ---- 20-bit ΔΣ, 85 V bus, and the reason it's the recommended part:
 * it integrates CHARGE (coulombs) and ENERGY (joules) in hardware, continuously,
 * at the ADC rate. The Pi only reads two registers instead of summing samples, so
 * the mAh no longer depend on the polling rate or on samples the loop missed.
 *
 * The accumulators are scaled by CURRENT_LSB, which the host chooses via
 * SHUNT_CAL — so the calibration write at init is what makes CHARGE/ENERGY (and
 * the CURRENT/POWER registers) mean anything.
 *
 * Registers: 0x00 CONFIG, 0x02 SHUNT_CAL, 0x04 VSHUNT, 0x05 VBUS, 0x06 DIETEMP,
 * 0x07 CURRENT, 0x08 POWER, 0x09 ENERGY (40-bit), 0x0A CHARGE (40-bit).
 */
export const INA228_REG = {
  config: 0x00,
  adcConfig: 0x01,
  shuntCal: 0x02,
  vshunt: 0x04,
  vbus: 0x05,
  dietemp: 0x06,
  current: 0x07,
  power: 0x08,
  energy: 0x09,
  charge: 0x0a,
} as const;
/** CONFIG bit 14 clears ENERGY/CHARGE; bit 4 selects the ±40.96 mV shunt range. */
export const INA228_RSTACC = 0x4000;
export const INA228_ADCRANGE = 0x0010;

function toSigned20(raw: number): number {
  return raw > 0x7ffff ? raw - 0x100000 : raw;
}
function toSigned40(raw: number): number {
  return raw > 0x7fffffffff ? raw - 0x10000000000 : raw;
}

/** Current per LSB: the full 20-bit signed span maps to ±maxCurrentA. */
export function ina228CurrentLsb(maxCurrentA: number): number {
  return maxCurrentA / 2 ** 19;
}
/** SHUNT_CAL = 13107.2e6 × CURRENT_LSB × R_shunt, ×4 in the low shunt range. */
export function ina228ShuntCal(currentLsb: number, shuntOhms: number, lowRange = false): number {
  const cal = 13107.2e6 * currentLsb * shuntOhms * (lowRange ? 4 : 1);
  return Math.max(0, Math.min(0x7fff, Math.round(cal)));
}
/** VBUS: 24-bit register, 20-bit result left-aligned, 195.3125 µV/LSB, always positive. */
export function ina228BusVolts(raw24: number): number {
  return (raw24 >> 4) * 195.3125e-6;
}
/** VSHUNT: 312.5 nV/LSB (±163.84 mV range) or 78.125 nV/LSB (±40.96 mV range). */
export function ina228ShuntVolts(raw24: number, lowRange = false): number {
  return toSigned20(raw24 >> 4) * (lowRange ? 78.125e-9 : 312.5e-9);
}
/**
 * Amps from VSHUNT rather than the CURRENT register: the shunt LSB is fixed by the
 * datasheet, so the reading stays right even if SHUNT_CAL was never written.
 */
export function ina228Amps(shuntRaw24: number, shuntOhms: number, lowRange = false): number {
  return ina228ShuntVolts(shuntRaw24, lowRange) / shuntOhms;
}
/** CHARGE is signed 40-bit coulombs × CURRENT_LSB; ÷3.6 turns C into mAh. */
export function ina228ChargeMah(raw40: number, currentLsb: number): number {
  return (toSigned40(raw40) * currentLsb) / 3.6;
}
/** ENERGY is unsigned 40-bit × 16 × POWER_LSB (= 3.2 × CURRENT_LSB) joules → Wh. */
export function ina228EnergyWh(raw40: number, currentLsb: number): number {
  return (raw40 * 16 * 3.2 * currentLsb) / 3600;
}
/** DIETEMP: signed 16-bit, 7.8125 m°C/LSB. */
export function ina228TempC(raw16: number): number {
  return toSigned16(raw16) * 7.8125e-3;
}

/**
 * ---- INA237 / INA238 ---- Same 85 V front end and register map as the INA228 but
 * a 16-bit ADC and, importantly, **no CHARGE/ENERGY accumulators** — those two
 * still have to be integrated on the Pi. INA237 is the lower-accuracy grade of the
 * same silicon; both use the identical conversions.
 * Registers: 0x00 CONFIG, 0x02 SHUNT_CAL, 0x04 VSHUNT, 0x05 VBUS, 0x06 DIETEMP,
 * 0x07 CURRENT, 0x08 POWER.
 */
export const INA238_REG = {
  config: 0x00,
  adcConfig: 0x01,
  shuntCal: 0x02,
  vshunt: 0x04,
  vbus: 0x05,
  dietemp: 0x06,
  current: 0x07,
  power: 0x08,
} as const;
export const INA238_ADCRANGE = 0x0010;

export function ina238CurrentLsb(maxCurrentA: number): number {
  return maxCurrentA / 2 ** 15;
}
/** SHUNT_CAL = 819.2e6 × CURRENT_LSB × R_shunt, ×4 in the low shunt range. */
export function ina238ShuntCal(currentLsb: number, shuntOhms: number, lowRange = false): number {
  const cal = 819.2e6 * currentLsb * shuntOhms * (lowRange ? 4 : 1);
  return Math.max(0, Math.min(0x7fff, Math.round(cal)));
}
/** VBUS: 16-bit, 3.125 mV/LSB. */
export function ina238BusVolts(raw16: number): number {
  return raw16 * 3.125e-3;
}
/** VSHUNT: 5 µV/LSB (±163.84 mV) or 1.25 µV/LSB (±40.96 mV). */
export function ina238ShuntVolts(raw16: number, lowRange = false): number {
  return toSigned16(raw16) * (lowRange ? 1.25e-6 : 5e-6);
}
export function ina238Amps(shuntRaw16: number, shuntOhms: number, lowRange = false): number {
  return ina238ShuntVolts(shuntRaw16, lowRange) / shuntOhms;
}
/** DIETEMP: signed 16-bit with the result in bits 15:4, 125 m°C/LSB. */
export function ina238TempC(raw16: number): number {
  return (toSigned16(raw16) >> 4) * 0.125;
}

/** Which sensors integrate charge/energy themselves. */
export function hasHardwareCounter(kind: string | undefined): boolean {
  return kind === 'ina228';
}

/**
 * Who counts the consumed mAh/Wh. 'sensor' is only possible when the primary
 * current sensor has an accumulator, so an impossible request degrades to 'pi'
 * rather than silently reporting nothing.
 */
export function resolveChargeSource(
  mode: 'auto' | 'sensor' | 'pi' | undefined,
  sensorHasCounter: boolean,
): 'sensor' | 'pi' {
  if (mode === 'pi') return 'pi';
  return sensorHasCounter ? 'sensor' : 'pi';
}

// ============================ temperature ============================
// Every function turns one raw reading into °C. The I/O (i2c/spi/sysfs) stays in
// TelemetryReader; only the datasheet maths lives here, so it can be tested.

/** Pi SoC sensor: /sys/class/thermal/thermal_zone0/temp holds milli-°C. */
export function piThermalC(sysfs: string): number | null {
  const milli = Number(String(sysfs).trim());
  if (!Number.isFinite(milli)) return null;
  return milli / 1000;
}

/**
 * DS18B20 via the kernel's 1-Wire driver. `w1_slave` looks like
 *   72 01 4b 46 7f ff 0c 10 5c : crc=5c YES
 *   72 01 4b 46 7f ff 0c 10 5c t=23125
 * A "NO" CRC line means the read was corrupt — report null instead of a value.
 */
export function ds18b20C(w1Slave: string): number | null {
  if (/crc=[0-9a-f]{2}\s+NO/i.test(w1Slave)) return null;
  const m = /t=(-?\d+)/.exec(w1Slave);
  if (!m) return null;
  const milli = Number(m[1]);
  // 85000 is the power-on default: the sensor was read before it converted.
  if (!Number.isFinite(milli) || milli === 85000) return null;
  return milli / 1000;
}

/** MCP9808: 13-bit two's complement in bits 12:0, 0.0625 °C/LSB. */
export function mcp9808C(raw16: number): number {
  const v = raw16 & 0x1fff;
  return (v > 0x0fff ? v - 0x2000 : v) * 0.0625;
}
/** TMP102: 12-bit left-aligned (bits 15:4), 0.0625 °C/LSB. */
export function tmp102C(raw16: number): number {
  return (toSigned16(raw16) >> 4) * 0.0625;
}
/** TMP117: full 16-bit two's complement, 7.8125 m°C/LSB. */
export function tmp117C(raw16: number): number {
  return toSigned16(raw16) * 7.8125e-3;
}

/**
 * BMP280 / BME280 temperature compensation, straight from the datasheet: the
 * chip ships per-part calibration words (dig_T1..T3) that have to be applied to
 * the raw 20-bit ADC value. Returns °C; also yields t_fine, which the pressure
 * compensation would need.
 */
export function bmp280TempC(adcT: number, digT1: number, digT2: number, digT3: number): number {
  const var1 = (adcT / 16384 - digT1 / 1024) * digT2;
  const var2 = (adcT / 131072 - digT1 / 8192) ** 2 * digT3;
  return (var1 + var2) / 5120;
}

/** MAX6675: bits 14:3 hold 12 bits at 0.25 °C; bit 2 set = no thermocouple. */
export function max6675C(raw16: number): number | null {
  if (raw16 & 0x0004) return null;
  return ((raw16 >> 3) & 0x0fff) * 0.25;
}
/**
 * MAX31855: 32 bits — 14-bit thermocouple temperature in 31:18 (0.25 °C), fault
 * bit 16, and the cold-junction temperature in 15:4 (0.0625 °C).
 */
export function max31855C(raw32: number): number | null {
  if (raw32 & 0x00010000) return null; // any fault (open / short to GND / VCC)
  const v = (raw32 >>> 18) & 0x3fff;
  return (v > 0x1fff ? v - 0x4000 : v) * 0.25;
}
export function max31855ColdJunctionC(raw32: number): number {
  const v = (raw32 >>> 4) & 0x0fff;
  return (v > 0x07ff ? v - 0x1000 : v) * 0.0625;
}
/** MAX31856: 24-bit linearised temperature, 19 bits used, 0.0078125 °C/LSB. */
export function max31856C(raw24: number): number {
  const v = raw24 >> 5; // bits 4:0 are unused
  return (v > 0x3ffff ? v - 0x80000 : v) * 0.0078125;
}

/**
 * MAX31865: the RTD register is a 15-bit ratio of the reference resistor
 * (bit 0 is the fault flag), so R = ratio × R_ref / 32768.
 */
export function max31865Ohms(raw16: number, refOhms: number): number | null {
  if (raw16 & 0x0001) return null; // fault
  return ((raw16 >> 1) * refOhms) / 32768;
}

/**
 * PT100/PT1000 resistance → °C (inverse Callendar–Van-Dusen). Above 0 °C the
 * quadratic has a closed-form solution; below 0 °C the polynomial has no simple
 * inverse, so the standard approximation polynomial is used there.
 */
export function rtdTempC(ohms: number, r0 = 100): number {
  const A = 3.9083e-3;
  const B = -5.775e-7;
  const ratio = ohms / r0;
  if (ratio >= 1) {
    return (-A + Math.sqrt(A * A - 4 * B * (1 - ratio))) / (2 * B);
  }
  // Below 0 °C the CVD polynomial has no closed-form inverse; this is the
  // standard approximation, evaluated on the PT100-equivalent resistance.
  const x = ratio * 100;
  return (
    -242.02 +
    2.2228 * x +
    2.5859e-3 * x ** 2 -
    4.826e-6 * x ** 3 -
    2.8183e-8 * x ** 4 +
    1.5243e-10 * x ** 5
  );
}

/**
 * Divider resistance from a measured voltage. The probe sits either at the low
 * side (probe to GND, fixed resistor to the excitation) or the high side.
 */
export function dividerOhms(
  measuredVolts: number,
  exciteVolts: number,
  seriesOhms: number,
  probeAtLowSide = true,
): number | null {
  if (exciteVolts <= 0 || measuredVolts <= 0 || measuredVolts >= exciteVolts) return null;
  return probeAtLowSide
    ? (seriesOhms * measuredVolts) / (exciteVolts - measuredVolts)
    : (seriesOhms * (exciteVolts - measuredVolts)) / measuredVolts;
}

/**
 * NTC resistance → °C via the beta equation, referenced to 25 °C. Good to about
 * ±1 °C over a typical motor/ESC range; Steinhart–Hart would need three
 * coefficients most datasheets don't print.
 */
export function ntcTempC(ohms: number, r25 = 10000, beta = 3950): number | null {
  if (ohms <= 0 || r25 <= 0 || beta <= 0) return null;
  const t0 = 298.15; // 25 °C in kelvin
  const inv = 1 / t0 + Math.log(ohms / r25) / beta;
  return 1 / inv - 273.15;
}

// ---- ADS1115 (16-bit) / ADS1015 (12-bit) ----
export function ads1115Volts(raw: number, fsrVolts: number): number {
  return (toSigned16(raw) / 32768) * fsrVolts;
}
export function ads1015Volts(raw: number, fsrVolts: number): number {
  // ADS1015 puts its 12-bit result in the top bits.
  return ((toSigned16(raw) >> 4) / 2048) * fsrVolts;
}

// ---- MCP3008 (10-bit) / MCP3208 (12-bit) ----
export function mcp3008Volts(raw: number, vref: number): number {
  return (raw / 1023) * vref;
}
export function mcp3208Volts(raw: number, vref: number): number {
  return (raw / 4095) * vref;
}

// ---- ACS712 / ACS758 (analog Hall, read via an ADC channel) ----
export function acsAmps(voutVolts: number, zeroVolts: number, mvPerAmp: number): number {
  return ((voutVolts - zeroVolts) * 1000) / mvPerAmp;
}

/**
 * Coulomb counting: add a current sample over an interval to consumed charge.
 * amps × hours × 1000 = mAh. Precise because it integrates every sample with its
 * exact dt rather than assuming a fixed rate.
 */
export function accumulateMah(prevMah: number, amps: number, dtSeconds: number): number {
  return prevMah + amps * (dtSeconds / 3600) * 1000;
}
export function accumulateWh(prevWh: number, volts: number, amps: number, dtSeconds: number): number {
  return prevWh + volts * amps * (dtSeconds / 3600);
}

import type { BatteryPercentSource } from '@yonderrc/protocol';

/** Voltage-based state-of-charge %, or null when no usable full/empty curve. */
export function voltagePercent(
  voltage: number | null | undefined,
  vFull: number | null | undefined,
  vEmpty: number | null | undefined,
): number | null {
  if (voltage == null || vFull == null || vEmpty == null || vFull <= vEmpty) return null;
  return Math.max(0, Math.min(100, ((voltage - vEmpty) / (vFull - vEmpty)) * 100));
}

/**
 * Resolve the battery percentage and report which method produced it, so the OSD can
 * label it clearly. Modes:
 *  - coulomb : consumed-mAh vs capacity (assumes a full pack at start)
 *  - voltage : the full/empty voltage curve only
 *  - clamp   : the LOWER of the two — voltage can pull it down (safe: an empty pack
 *              can't hide behind a wrong coulomb start) but never inflate it
 * Each mode falls back to whichever value actually exists. Under heavy load the pack
 * voltage sags, so voltage/clamp read a bit conservatively mid-throttle — on purpose.
 */
export function computeBatteryPercent(
  mode: BatteryPercentSource,
  coulombPct: number | null,
  voltage: number | null | undefined,
  vFull: number | null | undefined,
  vEmpty: number | null | undefined,
): { pct: number | null; source: BatteryPercentSource | null } {
  const vPct = voltagePercent(voltage, vFull, vEmpty);
  if (mode === 'coulomb') return { pct: coulombPct, source: coulombPct == null ? null : 'coulomb' };
  if (mode === 'voltage') return { pct: vPct, source: vPct == null ? null : 'voltage' };
  // clamp
  if (coulombPct == null && vPct == null) return { pct: null, source: null };
  if (vPct == null) return { pct: coulombPct, source: 'coulomb' };
  if (coulombPct == null) return { pct: vPct, source: 'voltage' };
  return { pct: Math.min(coulombPct, vPct), source: 'clamp' };
}

/** Backwards-compatible clamp helper (lower of coulomb/voltage). */
export function batteryPercentWithVoltage(
  coulombPct: number | null,
  voltage: number | null | undefined,
  vFull: number | null | undefined,
  vEmpty: number | null | undefined,
): number | null {
  return computeBatteryPercent('clamp', coulombPct, voltage, vFull, vEmpty).pct;
}
