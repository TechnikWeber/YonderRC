/**
 * Telemetry return channel: voltage/current sensors, coulomb-counted capacity and
 * battery percentage, streamed from the vehicle to the ground for the OSD.
 *
 * Sensor reads happen on the vehicle (only it has the hardware / does the precise
 * time integration). The ground just displays what arrives. A sim source produces
 * plausible values when no sensor is present.
 */

export interface TelemetryReading {
  label: string;
  value: number;
}

/**
 * Which method drives the battery PERCENTAGE (top-right OSD):
 *  - coulomb : consumed-mAh vs capacity (assumes a full pack at start)
 *  - voltage : from the configured full/empty pack-voltage curve
 *  - clamp   : the lower of the two (safe: voltage can't inflate a wrong coulomb)
 * The mAh readout (consumed/remaining) is independent of this — see displayMode.
 */
export type BatteryPercentSource = 'coulomb' | 'voltage' | 'clamp';

export interface TelemetryMessage {
  type: 'telemetry';
  /** Where the values come from: real sensors, or explicitly-enabled sim. */
  source: 'sim' | 'real';
  /** False when 'real' is selected but the sensor can't be read (show "no data"). */
  ok: boolean;
  /** Volts per configured voltage channel. */
  voltages: TelemetryReading[];
  /** Amps per configured current channel. */
  currents: TelemetryReading[];
  /** Coulomb-counted charge consumed since reset, in mAh. */
  mah: number;
  /** Energy consumed, in Wh (optional). */
  wh: number;
  /** Configured battery capacity, or null if unset. */
  capacityMah: number | null;
  /** Remaining battery percentage, or null if no capacity set. */
  batteryPercent: number | null;
  /** Which method produced batteryPercent (for a clear OSD label), or null. */
  batteryPercentSource?: BatteryPercentSource | null;
  /** Who counted mah/wh: the sensor's own accumulator or the Pi's integration. */
  chargeFrom?: 'sensor' | 'pi';
  /** How the OSD should show capacity. */
  displayMode: 'consumed' | 'remaining';
}

// ---- configuration (edited graphically in the setup UI) ----

export type VoltageSensorKind =
  | 'sim'
  | 'mcp3008'
  | 'mcp3208'
  | 'ads1115'
  | 'ads1015'
  // INA2xx expose a bus-voltage register too, so a single INA can provide BOTH
  // pack voltage (here) and current (as a CurrentChannelCfg) — no extra divider.
  | 'ina219'
  | 'ina226'
  | 'ina260'
  | 'ina3221'
  // 85 V-class parts: INA228 (20-bit + hardware charge/energy counters),
  // INA237/INA238 (16-bit, same register map, no counters).
  | 'ina228'
  | 'ina237'
  | 'ina238';
export type CurrentSensorKind =
  | 'sim'
  | 'ina219'
  | 'ina226'
  | 'ina260'
  | 'ina3221'
  | 'ina228'
  | 'ina237'
  | 'ina238'
  | 'acs712'
  | 'acs758';

/**
 * Where consumed mAh / Wh come from:
 *  - auto   : the sensor's own accumulator when it has one (INA228), else the Pi
 *  - sensor : the sensor accumulator; falls back to the Pi if the chip has none
 *  - pi     : always integrate the sampled current on the Pi
 * Only the INA228 has hardware CHARGE/ENERGY registers today.
 */
export type ChargeSource = 'auto' | 'sensor' | 'pi';

export interface VoltageChannelCfg {
  label: string; // e.g. "Spannung 1"
  kind: VoltageSensorKind;
  bus?: number; // i2c bus (ADS1x15)
  address?: number; // i2c address (ADS1x15)
  spiBus?: number; // SPI bus (MCP3xxx)
  spiDevice?: number; // SPI chip-select
  channel?: number; // ADC input channel
  gainFsrVolts?: number; // ADS full-scale range (e.g. 4.096)
  vref?: number; // MCP reference voltage
  scale?: number; // multiply result (external divider ratio), default 1
}

export interface CurrentChannelCfg {
  label: string; // e.g. "Strom 1"
  kind: CurrentSensorKind;
  bus?: number; // i2c bus (INA)
  address?: number; // i2c address (INA)
  channel?: number; // INA3221 channel (1..3) or ADC channel (ACS)
  shuntOhms?: number; // INA219/226/3221/228/237/238
  mvPerAmp?: number; // ACS712 (66/100/185) / ACS758
  zeroVolts?: number; // ACS zero-current output (~Vcc/2)
  adcChannel?: number; // which voltage channel index the ACS is wired to
  /**
   * INA228/237/238: the highest current you expect. It sets CURRENT_LSB and with
   * it SHUNT_CAL, which is what scales the chip's CURRENT/POWER/CHARGE/ENERGY
   * registers. Too low clips, far too high wastes resolution. Default 50 A.
   */
  maxCurrentA?: number;
  /**
   * INA228/237/238: use the ±40.96 mV shunt range instead of ±163.84 mV — 4× the
   * resolution for small shunts, but the shunt voltage must stay inside it
   * (I_max × R_shunt ≤ 40.96 mV).
   */
  lowShuntRange?: boolean;
}

export interface TelemetryConfig {
  enabled: boolean;
  source: 'sim' | 'real';
  sampleHz: number;
  voltages: VoltageChannelCfg[];
  currents: CurrentChannelCfg[];
  /** Integrate current into consumed mAh (coulomb counting). */
  countCapacity: boolean;
  batteryCapacityMah: number | null;
  displayMode: 'consumed' | 'remaining';
  /**
   * Optional full/empty PACK voltage for the voltage-based percentage / clamp.
   * mAh (consumed/remaining) is shown regardless; this only feeds the %.
   */
  voltageFullV?: number | null;
  voltageEmptyV?: number | null;
  /** Which method drives the % display. Defaults to 'clamp'. */
  percentSource?: BatteryPercentSource;
  /** Who integrates charge/energy. Defaults to 'auto' (sensor counter if present). */
  chargeSource?: ChargeSource;
}

// ---- camera configuration (graphical, generates go2rtc.yaml) ----

export type CameraType = 'sim' | 'rpicam' | 'usb';

export interface CameraCfg {
  name: string; // stream id, e.g. "cam1"
  type: CameraType;
  device?: string; // /dev/video0 for usb
  width: number;
  height: number;
  fps: number;
  bitrateKbps?: number;
}
