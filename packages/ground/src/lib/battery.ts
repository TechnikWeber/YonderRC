import { primaryVoltage, type TelemetryMessage } from '@yonderrc/protocol';

/**
 * Low-battery warning. "auto" mode only arms itself when a REAL sensor is
 * delivering data (so it never nags in sim or without hardware); "on"/"off"
 * override that. Percent and voltage thresholds are independently switchable —
 * voltage is off by default because the sensible value depends on your pack's
 * cell count, so you set it once for your battery.
 */
export interface BatteryWarnCfg {
  mode: 'auto' | 'on' | 'off';
  usePct: boolean;
  pctThreshold: number;
  useVolt: boolean;
  voltThreshold: number;
  useMah: boolean;
  mahThreshold: number;
  osdBlink: boolean;
  rumble: boolean;
  sound: boolean;
}

const KEY = 'yonderrc.battery.v1';
export const BATTERY_DEFAULTS: BatteryWarnCfg = {
  mode: 'auto',
  usePct: true,
  pctThreshold: 20,
  useVolt: false,
  voltThreshold: 10.5,
  useMah: false,
  mahThreshold: 1800,
  osdBlink: true,
  rumble: true,
  sound: true,
};

export function loadBattery(): BatteryWarnCfg {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...BATTERY_DEFAULTS, ...(JSON.parse(raw) as Partial<BatteryWarnCfg>) };
  } catch {
    /* ignore */
  }
  return { ...BATTERY_DEFAULTS };
}

export function saveBattery(c: BatteryWarnCfg): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/**
 * Pack voltage = the channel the vehicle marked primary (falls back to the first),
 * so the warning threshold watches the same voltage the vehicle counts with.
 */
export function packVoltage(t: TelemetryMessage | null): number | null {
  return primaryVoltage(t)?.value ?? null;
}

export interface BatteryState {
  active: boolean; // is the warning feature engaged at all
  low: boolean; // …and the battery is below a threshold
  reason: string | null; // short text for the OSD, e.g. "18% · 10.4V"
}

export function evaluateBattery(cfg: BatteryWarnCfg, t: TelemetryMessage | null): BatteryState {
  const active = cfg.mode === 'on' ? true : cfg.mode === 'off' ? false : !!t && t.source === 'real' && t.ok;
  if (!active || !t) return { active, low: false, reason: null };

  let low = false;
  let reason: string | null = null;
  if (cfg.usePct && t.batteryPercent != null && t.batteryPercent <= cfg.pctThreshold) {
    low = true;
    reason = `${Math.round(t.batteryPercent)}%`;
  }
  const v = packVoltage(t);
  if (cfg.useVolt && v != null && v <= cfg.voltThreshold) {
    low = true;
    reason = reason ? `${reason} · ${v.toFixed(1)}V` : `${v.toFixed(1)}V`;
  }
  if (cfg.useMah && t.mah >= cfg.mahThreshold) {
    low = true;
    reason = reason ? `${reason} · ${Math.round(t.mah)}mAh` : `${Math.round(t.mah)}mAh`;
  }
  return { active, low, reason };
}
