/**
 * Opt-in "blackbox" log. Recording is off by default and only samples while
 * explicitly enabled, so it costs nothing otherwise. Rows are compact and the
 * buffer is capped, so memory stays bounded even on a long session; the log is
 * turned into CSV only on download.
 *
 * Columns are fixed for link/video/battery basics and then **grow with the
 * vehicle's telemetry**: every configured voltage, current and temperature
 * channel gets its own column, named after its label. `volt`/`amp` stay as the
 * primary channel so a script always finds the pack in a known place, even when
 * channels are added or renamed.
 */
import type { TelemetryMessage } from '@yonderrc/protocol';

export interface LogRow {
  t: number; // ms since logging started
  armed: 0 | 1;
  failsafe: 0 | 1;
  link: string;
  rtt: number | null;
  bitrate: number | null;
  loss: number | null;
  fps: number | null;
  vlat: number | null;
  volt: number | null; // primary voltage channel
  amp: number | null; // primary current channel
  mah: number | null;
  pct: number | null;
  /** Every reported channel: column name → value. The union drives the header. */
  sensors?: Record<string, number | null>;
}

export const LOG_CAP = 36000; // ~5 h at 2 Hz

const FIXED_HEAD =
  't_ms,armed,failsafe,link,rtt_ms,bitrate_kbps,loss_pct,fps,video_latency_ms,volt,amp,mah,percent';

/** Labels are free text; a CSV header is not. Keep it ASCII and separator-safe. */
function sanitize(label: string): string {
  return label.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '');
}

/**
 * One flat record of every channel in a telemetry message, keyed by
 * `<label>_<unit>` (°C becomes a plain C so the header stays ASCII). Duplicate
 * or empty labels fall back to the channel index, so no column ever collides.
 */
export function sensorSnapshot(t: TelemetryMessage | null | undefined): Record<string, number | null> {
  const out: Record<string, number | null> = {};
  const add = (label: string, unit: 'V' | 'A' | 'C', i: number, value: number | null) => {
    const base = sanitize(label) || `${unit}${i + 1}`;
    let name = `${base}_${unit}`;
    if (name in out) name = `${base}${i + 1}_${unit}`;
    out[name] = value;
  };
  t?.voltages?.forEach((r, i) => add(r.label, 'V', i, r.value));
  t?.currents?.forEach((r, i) => add(r.label, 'A', i, r.value));
  t?.temperatures?.forEach((r, i) => add(r.label, 'C', i, r.value));
  return out;
}

export function logToCsv(rows: LogRow[]): string {
  // A sensor can appear or drop out mid-log (a failing probe is omitted), so the
  // header is the union over all rows, in first-seen order; gaps stay empty.
  const cols: string[] = [];
  for (const r of rows) {
    for (const k of Object.keys(r.sensors ?? {})) if (!cols.includes(k)) cols.push(k);
  }
  const head = [FIXED_HEAD, ...cols].join(',');
  const cell = (n: number | null | undefined) => (n == null ? '' : n);
  const line = (r: LogRow) =>
    [
      r.t, r.armed, r.failsafe, r.link,
      cell(r.rtt), cell(r.bitrate), cell(r.loss), cell(r.fps), cell(r.vlat),
      cell(r.volt), cell(r.amp), cell(r.mah), cell(r.pct),
      ...cols.map((c) => cell(r.sensors?.[c])),
    ].join(',');
  return [head, ...rows.map(line)].join('\n');
}

export function downloadText(name: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
