import type { GpsFix, GpsSourceKind } from '@yonderrc/protocol';
import { emptyFix } from '@yonderrc/protocol';

/**
 * Pure NMEA 0183 parsing — no I/O, unit-tested. Covers the sentences every common
 * RPi receiver emits (Adafruit Ultimate GPS / MTK, u-blox NEO-6/7/8/M9, most USB
 * dongles): GGA (fix, sats, HDOP, altitude), RMC (position, speed, course, time),
 * GSA (2D/3D fix type). Talker prefix is ignored (GP/GN/GL/GA…), so multi-GNSS works.
 */

const KNOTS_TO_MS = 0.514444;

/** "4807.038,N" → +48.1173 degrees; "01131.000,E" → +11.5167. */
function nmeaCoord(value: string, hemi: string): number | null {
  if (!value) return null;
  const dot = value.indexOf('.');
  if (dot < 3) return null;
  const degLen = dot - 2; // 2 digits of minutes before the dot
  const deg = Number(value.slice(0, degLen));
  const min = Number(value.slice(degLen));
  if (!Number.isFinite(deg) || !Number.isFinite(min)) return null;
  const sign = hemi === 'S' || hemi === 'W' ? -1 : 1;
  return sign * (deg + min / 60);
}

/** "123519" (+ optional "hhmmss.sss") + date "ddmmyy" → ISO UTC, or null. */
function nmeaTime(t: string, date?: string): string | null {
  if (!t || t.length < 6) return null;
  const hh = t.slice(0, 2), mm = t.slice(2, 4), ss = t.slice(4, 6);
  if (date && date.length === 6) {
    const dd = date.slice(0, 2), mo = date.slice(2, 4), yy = Number(date.slice(4, 6));
    const yyyy = 2000 + yy;
    return `${yyyy}-${mo}-${dd}T${hh}:${mm}:${ss}Z`;
  }
  return `1970-01-01T${hh}:${mm}:${ss}Z`;
}

/** Verify the trailing "*HH" XOR checksum if present; sentences without one pass. */
export function nmeaChecksumOk(sentence: string): boolean {
  const star = sentence.indexOf('*');
  if (star < 0) return true;
  const body = sentence.slice(sentence.startsWith('$') ? 1 : 0, star);
  let sum = 0;
  for (let i = 0; i < body.length; i++) sum ^= body.charCodeAt(i);
  const given = sentence.slice(star + 1, star + 3);
  return sum === parseInt(given, 16);
}

/**
 * Satellites in view from GSV, summed across talkers (GP/GL/GA each send their own).
 *
 * This is the number that matters during bring-up: a receiver reports satellites in
 * *view* long before it has a fix, and indoors it may never get further. Sentences
 * arriving with 0 in view still prove the wiring; no sentences at all is a different
 * problem entirely.
 */
export function satellitesInView(text: string): number | null {
  const byTalker = new Map<string, number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('$') || !nmeaChecksumOk(line)) continue;
    const f = line.split('*')[0].split(',');
    if (f[0].slice(3) !== 'GSV') continue;
    const n = Number(f[3]);
    if (Number.isFinite(n)) byTalker.set(f[0].slice(1, 3), n);
  }
  if (byTalker.size === 0) return null;
  return [...byTalker.values()].reduce((a, b) => a + b, 0);
}

/**
 * Split a rolling serial buffer into the part that is safe to parse and the rest.
 *
 * The last line of a buffer is usually a sentence the read cut in half. Parsing and
 * then dropping the whole buffer destroyed it — one sentence per second, and always
 * the same one for seconds at a time, because the receiver's 1 Hz and the parse timer
 * drift slowly against each other. `rest` goes back into the buffer instead.
 */
export function takeCompleteLines(buf: string): { batch: string; rest: string } {
  const cut = buf.lastIndexOf('\n');
  if (cut < 0) return { batch: '', rest: buf };
  return { batch: buf.slice(0, cut + 1), rest: buf.slice(cut + 1) };
}

/**
 * Parse a batch of NMEA text into one GpsFix (later sentences fill in fields).
 * Robust to partial/garbage lines. `source` is stamped onto the result.
 */
export function parseNmea(text: string, source: GpsSourceKind = 'serial-nmea'): GpsFix {
  const fix = emptyFix(source);
  let lastDate: string | undefined;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line.startsWith('$') || !nmeaChecksumOk(line)) continue;
    const f = line.split('*')[0].split(',');
    const type = f[0].slice(3); // drop "$GP"/"$GN"…
    if (type === 'RMC') {
      lastDate = f[9] || lastDate;
      if (f[2] === 'A') {
        fix.lat = nmeaCoord(f[3], f[4]);
        fix.lon = nmeaCoord(f[5], f[6]);
        if (f[7]) fix.speedMs = Number(f[7]) * KNOTS_TO_MS;
        if (f[8]) fix.courseDeg = Number(f[8]);
      }
      fix.timeUtc = nmeaTime(f[1], lastDate) ?? fix.timeUtc;
    } else if (type === 'GGA') {
      const q = Number(f[6]);
      if (q > 0) {
        fix.hasFix = true;
        fix.lat = nmeaCoord(f[2], f[3]) ?? fix.lat;
        fix.lon = nmeaCoord(f[4], f[5]) ?? fix.lon;
      }
      if (f[7]) fix.satellites = Number(f[7]);
      if (f[8]) fix.hdop = Number(f[8]);
      if (f[9]) fix.altM = Number(f[9]);
    } else if (type === 'GSA') {
      const mode = Number(f[2]); // 1=none 2=2D 3=3D
      fix.fixType = mode === 3 ? '3d' : mode === 2 ? '2d' : 'none';
      if (mode >= 2) fix.hasFix = true;
    }
  }
  if (fix.hasFix && fix.fixType === 'none') fix.fixType = fix.altM != null ? '3d' : '2d';
  return fix;
}
