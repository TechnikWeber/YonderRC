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
