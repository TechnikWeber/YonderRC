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
