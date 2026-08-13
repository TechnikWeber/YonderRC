/**
 * Pure link-signal helpers — no I/O, unit-tested. Turn `iw dev <if> link` output
 * into a dBm value and a 0..100 quality percentage, so the OSD can show one
 * uniform "link health" number regardless of LTE vs WiFi.
 */

/** Parse the RSSI in dBm from `iw dev <if> link` output, or null. */
export function parseWifiSignalDbm(iwOut: string): number | null {
  const m = iwOut.match(/signal:\s*(-?\d+)\s*dBm/i);
  return m ? Number(m[1]) : null;
}

/**
 * Map WiFi RSSI (dBm) to a rough 0..100 quality, the common linear approximation:
 * −50 dBm or better = 100%, −100 dBm or worse = 0%.
 */
export function dbmToQualityPct(dbm: number): number {
  if (dbm >= -50) return 100;
  if (dbm <= -100) return 0;
  return Math.round(2 * (dbm + 100));
}
