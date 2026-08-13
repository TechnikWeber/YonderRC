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
  | 'ina3221';
export type CurrentSensorKind =
  | 'sim'
  | 'ina219'
  | 'ina226'
  | 'ina260'
  | 'ina3221'
  | 'acs712'
  | 'acs758';

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
  shuntOhms?: number; // INA219/226/3221
  mvPerAmp?: number; // ACS712 (66/100/185) / ACS758
  zeroVolts?: number; // ACS zero-current output (~Vcc/2)
  adcChannel?: number; // which voltage channel index the ACS is wired to
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
   * Optional full/empty PACK voltage. When both are set, the battery % is clamped
   * so it can't exceed what the voltage suggests (sanity floor against coulomb
   * counting from a not-actually-full pack). Also yields a % when no capacity is set.
   */
  voltageFullV?: number | null;
  voltageEmptyV?: number | null;
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
