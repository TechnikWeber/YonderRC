/**
 * Opt-in "blackbox" flight log. Recording is off by default and only samples
 * while explicitly enabled, so it costs nothing otherwise. Rows are compact and
 * the buffer is capped, so memory stays bounded even on a long session; the log
 * is turned into CSV only on download.
 */
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
  volt: number | null;
  amp: number | null;
  mah: number | null;
  pct: number | null;
}

export const LOG_CAP = 36000; // ~5 h at 2 Hz

export function logToCsv(rows: LogRow[]): string {
  const head = 't_ms,armed,failsafe,link,rtt_ms,bitrate_kbps,loss_pct,fps,video_latency_ms,volt,amp,mah,percent';
  const cell = (n: number | null) => (n == null ? '' : n);
  const line = (r: LogRow) =>
    [r.t, r.armed, r.failsafe, r.link, cell(r.rtt), cell(r.bitrate), cell(r.loss), cell(r.fps), cell(r.vlat), cell(r.volt), cell(r.amp), cell(r.mah), cell(r.pct)].join(',');
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
