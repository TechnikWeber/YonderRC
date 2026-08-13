/**
 * GPS: source-agnostic position/fix, streamed vehicle → ground. The SOURCE is
 * selectable (local NMEA receiver, gpsd, or later MAVLink from a flight controller)
 * so the rest of the system only ever sees a normalized GpsFix.
 */

export type GpsSourceKind = 'off' | 'sim' | 'serial-nmea' | 'gpsd' | 'mavlink';

export interface GpsHome {
  lat: number;
  lon: number;
  altM: number | null;
}

export interface GpsConfig {
  source: GpsSourceKind;
  /** Serial device for 'serial-nmea' (e.g. /dev/ttyAMA0, /dev/ttyUSB0). */
  device?: string | null;
  /** Serial baud for 'serial-nmea' (most modules default to 9600). */
  baud?: number;
  /** Auto-set home on the first good fix (session home / takeoff point). */
  autoHome: boolean;
  /** Minimum satellites for a "good" fix (auto-home + weak-fix warning). */
  minSats: number;
  /** Manually saved home (persists); auto-home is kept only for the session. */
  home?: GpsHome | null;
}

export interface GpsFix {
  source: GpsSourceKind;
  hasFix: boolean;
  fixType: 'none' | '2d' | '3d';
  lat: number | null;
  lon: number | null;
  altM: number | null;
  satellites: number | null;
  /** Horizontal dilution of precision (lower is better). */
  hdop: number | null;
  /** Ground speed, m/s. */
  speedMs: number | null;
  /** Track/course over ground, degrees. */
  courseDeg: number | null;
  /** UTC time of the fix, ISO string. */
  timeUtc: string | null;
}

export interface GpsMessage extends GpsFix {
  type: 'gps';
  /** Effective home (manual or session auto-home), for distance/bearing display. */
  home: GpsHome | null;
}

export function emptyFix(source: GpsSourceKind): GpsFix {
  return {
    source, hasFix: false, fixType: 'none', lat: null, lon: null, altM: null,
    satellites: null, hdop: null, speedMs: null, courseDeg: null, timeUtc: null,
  };
}

const R_EARTH_M = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance between two lat/lon points, in metres (haversine). */
export function distanceMeters(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R_EARTH_M * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing from A to B, degrees 0..360 (0 = north). */
export function bearingDeg(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLon = toRad(bLon - aLon);
  const y = Math.sin(dLon) * Math.cos(toRad(bLat));
  const x =
    Math.cos(toRad(aLat)) * Math.sin(toRad(bLat)) -
    Math.sin(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.cos(dLon);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}
