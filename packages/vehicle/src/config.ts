import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { WATCHDOG_TIMEOUT_MS } from '@yonderrc/protocol';
import type { TelemetryConfig, CameraCfg } from '@yonderrc/protocol';
import type { DriverKind, DriverOptions } from './drivers/index.js';
import type { SystemKind } from './system/index.js';

/**
 * Config is env-defaulted and file-persisted. The on-Pi setup UI writes a small
 * JSON file of "persistent" fields; loadConfig() layers that over the env
 * defaults so the appliance keeps its settings across reboots. Env still wins for
 * host/port/system so docker + dev stay predictable.
 */
export interface VehicleConfig {
  vehicleName: string;
  host: string;
  port: number;
  driver: DriverKind;
  watchdogTimeoutMs: number;
  /** Channels treated as throttle: forced safe while disarmed. */
  throttleChannels: number[];
  /** Throttle SimDriver terminal logging (ms); 0 disables. */
  simLogEveryMs: number;
  /** Base URL of the go2rtc video server, or null for pure sim without video. */
  videoBaseUrl: string | null;
  /** Hardware-driver-specific options (I2C, GPIO pins, serial path). */
  driverOptions: DriverOptions;
  /** 'sim' (default) or 'real' networking (Pi). */
  systemKind: SystemKind;
  /** LTE APN to auto-connect at boot, if set. */
  apn: string | null;
  /**
   * Auto-disarm whenever a new ground connects. Safe for cars (prevents runaway);
   * turn OFF for aircraft, where disarming in flight would cut the motors.
   */
  disarmOnReconnect: boolean;
  /**
   * Optional shared secret. When set (non-empty), mutating setup-API calls and the
   * control WebSocket must present it (header `x-yonderrc-secret` / `?secret=`).
   * null = OFF (default), so first-time connect/setup needs nothing.
   */
  apiSecret: string | null;
  /** Telemetry (sensors, coulomb counting, battery). */
  telemetry: TelemetryConfig;
  /** Cameras (graphical); generates go2rtc.yaml. */
  cameras: CameraCfg[];
  /** Path of the generated go2rtc config. */
  go2rtcConfigPath: string;
  /** Detected H.264 encoder for generated camera sources (set at startup). */
  h264Encoder: string;
  /** Where the persistent config file lives. */
  configPath: string;
}

/** The subset the setup UI can edit and persist. */
export interface PersistentConfig {
  vehicleName?: string;
  driver?: DriverKind;
  watchdogTimeoutMs?: number;
  throttleChannels?: number[];
  videoBaseUrl?: string | null;
  apn?: string | null;
  disarmOnReconnect?: boolean;
  apiSecret?: string | null;
  telemetry?: TelemetryConfig;
  cameras?: CameraCfg[];
}

function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) ? n : fallback;
}

function publicHost(): string {
  return process.env.YRC_PUBLIC_HOST ?? 'localhost';
}

export function loadPersisted(path: string): PersistentConfig {
  try {
    if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8')) as PersistentConfig;
  } catch {
    /* corrupt or unreadable — ignore, fall back to defaults */
  }
  return {};
}

export function savePersisted(path: string, patch: PersistentConfig): PersistentConfig {
  const merged = { ...loadPersisted(path), ...patch };
  writeFileSync(path, JSON.stringify(merged, null, 2));
  return merged;
}

export function loadConfig(): VehicleConfig {
  const configPath = process.env.YRC_CONFIG ?? 'yonderrc-config.json';
  const p = loadPersisted(configPath);

  const envDriver = process.env.YRC_DRIVER as DriverKind | undefined;

  return {
    // Persistent fields: file overrides env-default.
    vehicleName: p.vehicleName ?? process.env.YRC_NAME ?? 'YonderRC-Sim',
    driver: p.driver ?? envDriver ?? 'sim',
    watchdogTimeoutMs: p.watchdogTimeoutMs ?? num('YRC_WATCHDOG_MS', WATCHDOG_TIMEOUT_MS),
    throttleChannels:
      p.throttleChannels ??
      (process.env.YRC_THROTTLE_CH ?? '2')
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isInteger(n)),
    videoBaseUrl:
      p.videoBaseUrl !== undefined
        ? p.videoBaseUrl
        : process.env.YRC_VIDEO_URL === ''
          ? null
          : process.env.YRC_VIDEO_URL ?? `http://${publicHost()}:1984`,
    apn: p.apn ?? process.env.YRC_APN ?? null,
    disarmOnReconnect: p.disarmOnReconnect ?? true,
    apiSecret: (p.apiSecret ?? process.env.YRC_API_SECRET ?? null) || null,
    telemetry: p.telemetry ?? {
      enabled: true,
      source: 'sim',
      sampleHz: 10,
      voltages: [{ label: 'Voltage 1', kind: 'sim' }],
      currents: [{ label: 'Current 1', kind: 'sim' }],
      countCapacity: true,
      batteryCapacityMah: null,
      displayMode: 'remaining',
    },
    cameras: p.cameras ?? [{ name: 'test', type: 'sim', width: 1280, height: 720, fps: 25 }],
    go2rtcConfigPath:
      process.env.YRC_GO2RTC_CONFIG ??
      fileURLToPath(new URL('../../../docker/go2rtc.yaml', import.meta.url)),
    h264Encoder: 'libx264',

    // Env-only fields.
    host: process.env.YRC_HOST ?? '0.0.0.0',
    port: num('YRC_PORT', 8080),
    simLogEveryMs: num('YRC_SIM_LOG_MS', 0),
    systemKind: (process.env.YRC_SYSTEM as SystemKind) ?? 'sim',
    configPath,
    driverOptions: {
      pca9685: {
        bus: num('YRC_I2C_BUS', 1),
        address: process.env.YRC_I2C_ADDR ? Number(process.env.YRC_I2C_ADDR) : 0x40,
        freqHz: num('YRC_PWM_FREQ', 50),
      },
      gpioPwm: process.env.YRC_GPIO_PINS
        ? { pins: process.env.YRC_GPIO_PINS.split(',').map((s) => Number(s.trim())) }
        : {},
      sbus: {
        path: process.env.YRC_SBUS_PATH ?? '/dev/ttyAMA0',
        frameIntervalMs: num('YRC_SBUS_INTERVAL_MS', 7),
      },
    },
  };
}
