/**
 * What the Pi says about itself: temperature, load, uptime, card space, clock.
 *
 * These are not vanity numbers on a vehicle. Each one has a failure it explains that
 * otherwise looks like a bug in this software:
 *
 *  - **Temperature.** The Pi encodes H.264 for the FPV feed, in a sealed model hull,
 *    often in the sun. At 80 °C the firmware clamps the clock and everything gets
 *    slower and jerkier at once — which reads exactly like a bad link.
 *  - **Load.** The control loop and the failsafe watchdog run on this box. A load
 *    spike is the honest explanation for round-trip jitter that the link did not cause.
 *  - **Card space.** A full card cannot take an update and cannot write a log.
 *  - **The clock.** A Pi has no battery-backed clock: with no network at boot it
 *    starts in 1970, and then **`git pull` fails with a certificate error** ("not yet
 *    valid") that names neither the cause nor the fix. That is the one that costs an
 *    afternoon, and it is why the clock is reported next to the update button.
 *
 * The supply verdict lives in `power.ts` and stays there — it has its own bitmask and
 * its own badge. Everything here is pure; RealSystem does the reading.
 */

export interface VehicleHealth {
  /** SoC temperature in °C. */
  cpuTempC: number | null;
  /** 1-minute load average. */
  load1: number | null;
  /** Seconds since boot. */
  uptimeS: number | null;
  /** Free space on the root filesystem, in MB. */
  diskFreeMb: number | null;
  diskUsedPercent: number | null;
  /** Has the clock been set from the network? null = could not tell. */
  clockSynced: boolean | null;
  /** Is time synchronisation switched on at all? */
  ntpEnabled: boolean | null;
  /** The time server actually in use, when one is. */
  timeServer: string | null;
  /** The vehicle's own clock, so the page can compare it with the operator's. */
  nowIso: string;
}

export const HEALTH_UNKNOWN: VehicleHealth = {
  cpuTempC: null,
  load1: null,
  uptimeS: null,
  diskFreeMb: null,
  diskUsedPercent: null,
  clockSynced: null,
  ntpEnabled: null,
  timeServer: null,
  nowIso: '',
};

/**
 * `Number('')` is 0, not NaN — so an unreadable sensor used to read as a healthy
 * 0 °C, an idle 0.00 load and a box that booted this instant. Empty is checked
 * before the conversion in all three.
 */
/** `/sys/class/thermal/thermal_zone0/temp` is millidegrees. */
export function parseCpuTemp(raw: string): number | null {
  const text = (raw ?? '').trim();
  if (!text) return null;
  const v = Number(text);
  if (!Number.isFinite(v)) return null;
  return Math.round((v / 1000) * 10) / 10;
}

/** `/proc/uptime` → seconds since boot. */
export function parseUptime(raw: string): number | null {
  const first = (raw ?? '').trim().split(/\s+/)[0];
  if (!first) return null;
  const v = Number(first);
  return Number.isFinite(v) ? Math.round(v) : null;
}

/** `/proc/loadavg` → the 1-minute figure. */
export function parseLoad(raw: string): number | null {
  const first = (raw ?? '').trim().split(/\s+/)[0];
  if (!first) return null;
  const v = Number(first);
  return Number.isFinite(v) ? v : null;
}

/** `df -m /` → free megabytes and percent used on the root filesystem. */
export function parseDf(out: string): { freeMb: number | null; usedPercent: number | null } {
  const line = (out ?? '').split('\n')[1];
  if (!line) return { freeMb: null, usedPercent: null };
  const cols = line.trim().split(/\s+/);
  const free = Number(cols[3]);
  const used = Number((cols[4] ?? '').replace('%', ''));
  return {
    freeMb: Number.isFinite(free) ? free : null,
    usedPercent: Number.isFinite(used) ? used : null,
  };
}

/** `timedatectl show` → whether the clock is set from the network, and whether NTP is on. */
export function parseTimedatectl(out: string): { synced: boolean | null; ntpEnabled: boolean | null } {
  const map = new Map(
    (out ?? '')
      .split('\n')
      .map((l) => l.split('='))
      .filter((p) => p.length === 2)
      .map(([k, v]) => [k.trim(), v.trim()]),
  );
  const synced = map.get('NTPSynchronized');
  const enabled = map.get('NTP');
  return {
    synced: synced === undefined ? null : synced === 'yes',
    ntpEnabled: enabled === undefined ? null : enabled === 'yes',
  };
}

/** `timedatectl timesync-status` → the server actually in use. */
export function parseTimesyncServer(out: string): string | null {
  const m = (out ?? '').match(/Server:\s*([^\s(]+)/);
  return m ? m[1] : null;
}

/** Thresholds. Warn where it starts to matter, not where the datasheet ends. */
export const TEMP_WARN_C = 75; // the firmware starts clamping at 80
export const DISK_WARN_MB = 500;
export const LOAD_WARN = 3; // a 4-core Pi at 3 has nothing spare for the control loop

/**
 * One line naming what is wrong and what it means for the vehicle, or null when
 * nothing is. Ordered by what to act on first: heat throttles the whole box, a full
 * card blocks the update that would fix things, an unset clock breaks that update in
 * a way whose error message points nowhere near the cause.
 */
export function explainHealth(h: VehicleHealth): string | null {
  if (h.cpuTempC !== null && h.cpuTempC >= TEMP_WARN_C) {
    return `The Pi is at ${h.cpuTempC} °C. From 80 °C the firmware clamps its clock, and video and control get slower together — open the hull, shade it, or give the encoder less to do (lower the camera resolution).`;
  }
  if (h.diskFreeMb !== null && h.diskFreeMb < DISK_WARN_MB) {
    return `${h.diskFreeMb} MB left on the card. An update needs room to fetch and build; clear space before pressing it.`;
  }
  if (h.clockSynced === false) {
    return 'The clock has never been set from the network. A Pi has no battery-backed clock, so it boots in the past — and `git pull` then fails with a certificate error that says nothing about the time. Give it a network and this fixes itself.';
  }
  if (h.load1 !== null && h.load1 >= LOAD_WARN) {
    return `Load ${h.load1.toFixed(1)}. The control loop shares this CPU, so round-trip jitter right now is the box being busy rather than the link being bad.`;
  }
  return null;
}

/** "3 d 4 h", "2 h 15 min", "8 min" — uptime as something a person reads. */
export function formatUptime(seconds: number | null): string {
  if (seconds === null) return '—';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (d) return `${d} d ${h} h`;
  if (h) return `${h} h ${m} min`;
  return `${m} min`;
}
