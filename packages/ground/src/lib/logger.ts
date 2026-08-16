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
 *
 * Position rides in the SAME row as the electrics and the link stats, so a track
 * can be coloured by voltage or RTT ("where does the link get bad?") without
 * joining two files. `toGpx` additionally writes the plain standard format that
 * every map tool reads.
 */
import type { GpsMessage, TelemetryMessage } from '@yonderrc/protocol';

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
  /** GPS — null throughout when no receiver is configured or there's no fix. */
  lat?: number | null;
  lon?: number | null;
  altM?: number | null;
  sats?: number | null;
  hdop?: number | null;
  speedMs?: number | null;
  courseDeg?: number | null;
  /** Every reported channel: column name → value. The union drives the header. */
  sensors?: Record<string, number | null>;
}

export const LOG_CAP = 36000; // ~5 h at 2 Hz

const FIXED_HEAD =
  't_ms,armed,failsafe,link,rtt_ms,bitrate_kbps,loss_pct,fps,video_latency_ms,volt,amp,mah,percent,' +
  'lat,lon,alt_m,sats,hdop,speed_ms,course_deg';

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

/**
 * The position part of a row. A message without a fix logs as empty cells rather
 * than as stale coordinates — a frozen last-known position would look like the
 * vehicle parked there.
 */
export function gpsSnapshot(g: GpsMessage | null | undefined): Pick<LogRow, 'lat' | 'lon' | 'altM' | 'sats' | 'hdop' | 'speedMs' | 'courseDeg'> {
  if (!g?.hasFix || g.lat == null || g.lon == null) {
    return { lat: null, lon: null, altM: null, sats: g?.satellites ?? null, hdop: null, speedMs: null, courseDeg: null };
  }
  return {
    lat: g.lat, lon: g.lon, altM: g.altM,
    sats: g.satellites, hdop: g.hdop, speedMs: g.speedMs, courseDeg: g.courseDeg,
  };
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
      // 7 decimals ≈ 1 cm — well past what any receiver resolves, but it keeps
      // the value from being re-rounded on the way out.
      r.lat == null ? '' : r.lat.toFixed(7),
      r.lon == null ? '' : r.lon.toFixed(7),
      cell(r.altM), cell(r.sats), cell(r.hdop), cell(r.speedMs), cell(r.courseDeg),
      ...cols.map((c) => cell(r.sensors?.[c])),
    ].join(',');
  return [head, ...rows.map(line)].join('\n');
}

/** A row carries a usable position (both coordinates present and finite). */
export function hasFixRow(r: LogRow): boolean {
  return (
    r.lat != null && r.lon != null &&
    Number.isFinite(r.lat) && Number.isFinite(r.lon)
  );
}

/** Rows in the log that can become track points. */
export function fixCount(rows: LogRow[]): number {
  return rows.reduce((n, r) => n + (hasFixRow(r) ? 1 : 0), 0);
}

const xml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');

/**
 * GPX 1.1 track — the format Google Earth, gpx.studio, QGIS, GPSBabel and every
 * mapping tool read without conversion. Speed and course go into the Garmin
 * TrackPointExtension namespace, which is what readers that show them expect;
 * everything else stays in the CSV. Rows without a fix are skipped, so a log
 * that starts indoors doesn't draw a line from null island.
 *
 * `startedAtMs` is the wall-clock time logging began — rows only carry an offset,
 * and GPX timestamps must be absolute UTC.
 */
export function logToGpx(rows: LogRow[], startedAtMs: number, name = 'YonderRC track'): string {
  const pts = rows.filter(hasFixRow);
  const pt = (r: LogRow) => {
    const time = new Date(startedAtMs + r.t).toISOString();
    const ext =
      r.speedMs == null && r.courseDeg == null
        ? ''
        : '\n        <extensions><gpxtpx:TrackPointExtension>' +
          (r.speedMs == null ? '' : `<gpxtpx:speed>${r.speedMs}</gpxtpx:speed>`) +
          (r.courseDeg == null ? '' : `<gpxtpx:course>${r.courseDeg}</gpxtpx:course>`) +
          '</gpxtpx:TrackPointExtension></extensions>';
    return (
      `      <trkpt lat="${r.lat!.toFixed(7)}" lon="${r.lon!.toFixed(7)}">` +
      (r.altM == null ? '' : `\n        <ele>${r.altM}</ele>`) +
      `\n        <time>${time}</time>` +
      (r.hdop == null ? '' : `\n        <hdop>${r.hdop}</hdop>`) +
      (r.sats == null ? '' : `\n        <sat>${Math.round(r.sats)}</sat>`) +
      ext +
      '\n      </trkpt>'
    );
  };
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="YonderRC" xmlns="http://www.topografix.com/GPX/1/1"' +
      ' xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1">',
    '  <metadata>',
    `    <name>${xml(name)}</name>`,
    `    <time>${new Date(startedAtMs).toISOString()}</time>`,
    '  </metadata>',
    '  <trk>',
    `    <name>${xml(name)}</name>`,
    '    <trkseg>',
    ...pts.map(pt),
    '    </trkseg>',
    '  </trk>',
    '</gpx>',
  ].join('\n');
}

export function downloadText(name: string, text: string, mime = 'text/csv'): void {
  const blob = new Blob([text], { type: mime });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
