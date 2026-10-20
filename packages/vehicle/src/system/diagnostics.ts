/**
 * The diagnostics export — everything here is pure and unit-tested.
 *
 * A user who writes "it keeps going in and out of failsafe" can not be asked to open a
 * terminal, run five commands and paste the output. So the vehicle assembles one file
 * (`GET /api/diagnostics`, the setup page and the ground app both offer it as a
 * download) and says up front what it found. Two rules shape everything in this file:
 *
 *  - **Nothing secret leaves the box.** The file ends up attached to a public GitHub
 *    issue. Passwords, PINs, VPN keys, the API secret, a pending Tailscale login link and
 *    the GPS home position are masked — structurally where the shape is known
 *    (`redactConfig`), by pattern where it is free text (`redactSecrets`, for log lines
 *    and uploaded configs). Network names and local IP addresses stay: they are what a
 *    network problem is debugged with, and the docs say so before anyone uploads.
 *  - **The file says what it means.** Raw numbers alone send the maintainer back to the
 *    user with questions. `vehicleFindings` turns them into a short list of plain
 *    statements — each one only when the evidence is actually there.
 */
import type { DiagnosticFinding } from '@yonderrc/protocol';
import type { PersistentConfig } from '../config.js';
import type { LinkStatsSnapshot } from '../core/linkStats.js';
import { gapsOver } from '../core/linkStats.js';
import type { PowerState } from './power.js';
import type { VehicleHealth } from './health.js';

export { DIAGNOSTICS_SCHEMA } from '@yonderrc/protocol';
export type Finding = DiagnosticFinding;

/** What the operating system says — collected by RealSystem, mocked by SimSystem. */
export interface SystemDiagnostics {
  kind: string;
  os: { prettyName: string | null; kernel: string | null; model: string | null; arch: string };
  node: string;
  git: { commit: string | null; dirty: string[] | null };
  memory: { totalMb: number | null; availableMb: number | null };
  wifi: { iface: string; powerSave: boolean | null; link: string | null; signalDbm: number | null };
  network: { addresses: string | null; routes: string | null; devices: string | null };
  /** systemd unit → `systemctl is-active` answer. */
  services: Record<string, string>;
  /** Tails of the relevant journals, already redacted. */
  journal: { unit: string; lines: string[] }[];
  /** Kernel lines worth a look (undervoltage, WiFi firmware, USB resets), redacted. */
  kernel: string[];
  /** Raw `i2cdetect -y 1`, or null when it was not run (armed, no tool). */
  i2c: string | null;
  /** go2rtc's view of its streams: producers and consumers per stream. */
  video: Record<string, { producers: number; consumers: number; errors: string[] }> | null;
  /** What could not be collected, and why — an empty section is not the same as "fine". */
  notes: string[];
}

// ---------------------------------------------------------------------------
// Redaction
// ---------------------------------------------------------------------------

const MASK = '***';

/** Inline blocks of an OpenVPN profile that hold key material. */
const SECRET_BLOCKS = ['key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'pkcs12', 'secret', 'auth-user-pass'];

/**
 * Mask secrets in free text — a log line, a journal line, an uploaded VPN profile.
 * Errs towards masking: a hidden harmless value costs nothing, a leaked one costs a key
 * rotation. Covers `key = value` / `password: value` / `secret=value` style pairs (also
 * WireGuard's PrivateKey/PresharedKey), the hotspot message's "key …", Tailscale auth
 * keys and pending login links, `--pin=` arguments, credentials in URLs, PEM private keys
 * and the key blocks of an inline .ovpn.
 */
export function redactSecrets(text: string): string {
  let t = String(text ?? '');
  // PEM private keys, whatever wraps them.
  t = t.replace(/-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----/g, '-----BEGIN $1PRIVATE KEY----- (redacted) -----END $1PRIVATE KEY-----');
  // Inline OpenVPN key material.
  for (const tag of SECRET_BLOCKS) {
    t = t.replace(new RegExp(`<${tag}>[\\s\\S]*?</${tag}>`, 'gi'), `<${tag}>(redacted)</${tag}>`);
  }
  // Tailscale: an auth key, and a pending login link — whoever opens that one first
  // decides whose tailnet the vehicle joins.
  t = t.replace(/tskey-[A-Za-z0-9_-]+/g, `tskey-${MASK}`);
  t = t.replace(/(login\.tailscale\.com\/a\/)[A-Za-z0-9]+/g, `$1${MASK}`);
  // user:password@ in a URL (an RTSP camera, a git remote).
  t = t.replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, `$1${MASK}@`);
  // --pin=1234, --authkey=…
  t = t.replace(/(--(?:pin|change-pin|authkey|password|secret)=)\S+/gi, `$1${MASK}`);
  // The hotspot result message: "(WPA2, key s3cr3tpw)".
  t = t.replace(/(WPA2?,?\s+key\s+)\S+?(?=[)\s]|$)/gi, `$1${MASK}`);
  // key = value pairs: PrivateKey = …, psk=…, password: …, ?secret=…
  t = t.replace(
    /\b([\w.-]*(?:key|psk|passw(?:or)?d|secret|token|pin))(\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,;&)]+)/gi,
    (_m, k: string, sep: string) => `${k}${sep}${MASK}`,
  );
  // A coordinate pair ("auto-home set at 48.275812, 8.853601") — the home point is very
  // often where the operator lives.
  t = t.replace(/-?\d{1,3}\.\d{4,}\s*,\s*-?\d{1,3}\.\d{4,}/g, '(position)');
  return t;
}

/** Keys whose values are secret wherever they appear in a stored config. */
const SECRET_KEY = /(secret|password|passwd|psk|pin|authkey|privatekey|presharedkey|token)$/i;

/**
 * A stored config, safe to publish. Structural: the fields that are secrets by their
 * name become "(set)" or null, free-text fields that can carry keys (an uploaded
 * WireGuard or OpenVPN profile) go through `redactSecrets`, and the GPS home point —
 * very often the operator's actual home — is reduced to whether one is set.
 */
export function redactConfig(p: PersistentConfig | Record<string, unknown>): Record<string, unknown> {
  const walk = (v: unknown, key: string): unknown => {
    if (v === null || v === undefined) return v;
    if (SECRET_KEY.test(key) && typeof v !== 'boolean') {
      return v === '' ? '' : '(set)';
    }
    if (typeof v === 'string') {
      if (/conf$/i.test(key)) return redactSecrets(v);
      return v;
    }
    if (Array.isArray(v)) return v.map((x) => walk(x, ''));
    if (typeof v === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
        if (k === 'home' && x && typeof x === 'object') {
          out[k] = '(set — position not exported)';
          continue;
        }
        out[k] = walk(x, k);
      }
      return out;
    }
    return v;
  };
  return walk(p, '') as Record<string, unknown>;
}

/**
 * `redactSecrets` applied to every string inside a value, leaving its shape alone. For
 * the parts of the report whose content is known to be harmless *except* for free text
 * that may quote something (a status message with a login link, an nmcli answer).
 * Masking JSON text as a whole would not be safe: a pattern could eat a closing quote.
 */
export function redactDeep<T>(v: T): T {
  if (typeof v === 'string') return redactSecrets(v) as unknown as T;
  if (Array.isArray(v)) return v.map((x) => redactDeep(x)) as unknown as T;
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = redactDeep(x);
    return out as T;
  }
  return v;
}

/** A GPS message without the position: fix quality is diagnostic, where the vehicle is is not. */
export function stripPosition<T extends Record<string, unknown>>(gps: T | null | undefined): Record<string, unknown> | null {
  if (!gps) return null;
  const { lat: _lat, lon: _lon, home, ...rest } = gps as Record<string, unknown>;
  return { ...rest, home: home ? '(set — position not exported)' : null };
}

// ---------------------------------------------------------------------------
// Small parsers for what RealSystem collects
// ---------------------------------------------------------------------------

/** `iw dev wlan0 get power_save` → "Power save: on". Null when it says anything else. */
export function parsePowerSave(out: string): boolean | null {
  const m = /power save:\s*(on|off)/i.exec(out ?? '');
  return m ? m[1].toLowerCase() === 'on' : null;
}

/** PRETTY_NAME from /etc/os-release. */
export function parseOsRelease(out: string): string | null {
  const m = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(out ?? '');
  return m ? m[1].trim() : null;
}

/** MemTotal / MemAvailable from /proc/meminfo, in MB. */
export function parseMeminfo(out: string): { totalMb: number | null; availableMb: number | null } {
  const kb = (name: string) => {
    const m = new RegExp(`^${name}:\\s+(\\d+)\\s+kB`, 'm').exec(out ?? '');
    return m ? Math.round(Number(m[1]) / 1024) : null;
  };
  return { totalMb: kb('MemTotal'), availableMb: kb('MemAvailable') };
}

/** Kernel lines that explain a dropping link or a resetting box; everything else is noise. */
export function interestingKernelLines(lines: string[], max = 80): string[] {
  const re = /under-?voltage|voltage normali[sz]ed|brcmf|wlan0|firmware|usb \d+-[\d.]+: (?:USB disconnect|reset)|throttl|oom|out of memory|i2c|mmc0.*(?:error|timeout)|EXT4-fs error/i;
  return lines.filter((l) => re.test(l)).slice(-max).map(redactSecrets);
}

/**
 * go2rtc's `/api/streams` answer, reduced to what tells a working stream from a broken
 * one: how many producers (the camera side) and consumers (viewers) each stream has. The
 * full answer carries SDP and codec dumps — kilobytes nobody reads.
 */
export function summariseStreams(json: unknown): Record<string, { producers: number; consumers: number; errors: string[] }> | null {
  if (!json || typeof json !== 'object') return null;
  const out: Record<string, { producers: number; consumers: number; errors: string[] }> = {};
  for (const [name, s] of Object.entries(json as Record<string, unknown>)) {
    const st = (s ?? {}) as { producers?: unknown; consumers?: unknown };
    const producers = Array.isArray(st.producers) ? st.producers : [];
    const consumers = Array.isArray(st.consumers) ? st.consumers : [];
    const errors: string[] = [];
    for (const p of producers as Record<string, unknown>[]) {
      const e = p && typeof p === 'object' ? (p as Record<string, unknown>).error ?? (p as Record<string, unknown>).last_error : null;
      if (typeof e === 'string' && e) errors.push(redactSecrets(e));
    }
    out[name] = { producers: producers.length, consumers: consumers.length, errors };
  }
  return out;
}

// ---------------------------------------------------------------------------
// What it means
// ---------------------------------------------------------------------------

export interface VehicleFindingInput {
  systemKind: string;
  watchdogMs: number;
  link: LinkStatsSnapshot;
  /** Seconds the service has been running — the denominator for "how often". */
  uptimeS: number;
  loopDelay: { p99Ms: number | null; maxMs: number | null } | null;
  power: PowerState | null;
  wifi: { mode: string; powerSave: boolean | null; signalDbm: number | null } | null;
  driver: { configured: string; running: string; error: string | null };
  health: VehicleHealth | null;
  memoryAvailableMb: number | null;
}

/**
 * The plain-language part of the report. Ordered roughly by how often each one turned
 * out to be the answer: a driver that silently fell back to sim, a brownout, WiFi power
 * saving, then the link numbers themselves.
 */
export function vehicleFindings(i: VehicleFindingInput): Finding[] {
  const out: Finding[] = [];
  const add = (f: Finding) => out.push(f);

  // --- the outputs ---
  if (i.driver.running !== i.driver.configured) {
    add({
      level: 'bad',
      area: 'driver',
      text: `Output driver "${i.driver.configured}" is configured, but "${i.driver.running}" is running — the servos are not being driven.` +
        (i.driver.error ? ` Start-up error: ${redactSecrets(i.driver.error)}` : ''),
      fix: 'Setup › Sensors & outputs: install the native module the driver needs (i2c-bus for pca9685) and check the I²C address, then restart the vehicle service.',
    });
  } else if (i.driver.running === 'sim' && i.systemKind === 'real') {
    add({
      level: 'info',
      area: 'driver',
      text: 'The output driver is "sim": everything works, but nothing is connected to a servo. Fine on the bench, not for driving.',
      fix: 'Setup › Sensors & outputs › Output driver (pca9685 for the reference build).',
    });
  }

  // --- supply ---
  if (i.power?.underVoltageNow) {
    add({ level: 'bad', area: 'power', text: 'The Pi is under-voltage right now. WiFi, USB (LTE stick) and the camera all misbehave before the Pi resets.', fix: '5.1 V / 3 A or more, short thick cable, servos never powered from the Pi (docs/HARDWARE.md 2.3).' });
  } else if (i.power?.underVoltagePast) {
    add({ level: 'warn', area: 'power', text: 'The Pi was under-voltage at some point since boot. A brownout drops WiFi and USB for a moment — that looks exactly like a link problem.', fix: 'Check the 5 V supply under load (servos moving, LTE transmitting).' });
  }

  // --- WiFi ---
  if (i.wifi && i.wifi.mode === 'client' && i.wifi.powerSave === true) {
    add({
      level: 'warn',
      area: 'wifi',
      text: 'WiFi power saving is on. The Pi then holds incoming packets back for up to a few hundred ms — the classic cause of a link that flickers in and out of failsafe on a perfectly good network.',
      fix: 'sudo iw dev wlan0 set power_save off  (install.sh v1.70.0+ switches it off permanently — re-run it once)',
    });
  }
  if (i.wifi && i.wifi.mode === 'client' && i.wifi.signalDbm != null && i.wifi.signalDbm <= -70) {
    add({ level: 'warn', area: 'wifi', text: `Weak WiFi signal at the vehicle (${i.wifi.signalDbm} dBm). Below about −70 dBm retransmissions add jitter.`, fix: 'Move the access point closer, or use the vehicle’s own hotspot / LTE.' });
  }

  // --- the link itself ---
  const L = i.link;
  const minutes = Math.max(1 / 60, i.uptimeS / 60);
  if (L.failsafe.episodes > 0) {
    const viaCount = (v: 'ws' | 'webrtc') => L.failsafe.recent.filter((e) => e.via === v).length;
    const rtc = viaCount('webrtc');
    const ws = viaCount('ws');
    add({
      level: L.failsafe.episodes / minutes > 1 ? 'bad' : 'warn',
      area: 'link',
      text:
        `${L.failsafe.episodes} failsafe episode(s) since the service started ${fmtDuration(i.uptimeS)} ago ` +
        `(longest ${L.failsafe.longestMs} ms, ${Math.round(L.failsafe.totalMs / 100) / 10} s in total). ` +
        `Watchdog: ${i.watchdogMs} ms.` +
        (rtc + ws > 0 ? ` Last frame before them came over ${ws ? `WebSocket ${ws}×` : ''}${ws && rtc ? ', ' : ''}${rtc ? `WebRTC ${rtc}×` : ''}.` : ''),
    });
  }
  const over = gapsOver(L, i.watchdogMs);
  const over300 = gapsOver(L, 300);
  if (i.watchdogMs > 300 && over300 > over) {
    add({
      level: 'info',
      area: 'link',
      text: `${over300 - over} gap(s) between control frames were longer than 300 ms but within today's ${i.watchdogMs} ms watchdog — each of those was a failsafe with the pre-v1.70.0 default.`,
    });
  }
  if (L.gaps.total > 0 && L.failsafe.episodes === 0 && L.gaps.maxMs >= i.watchdogMs * 0.6) {
    add({ level: 'info', area: 'link', text: `No failsafe yet, but the longest gap (${L.gaps.maxMs} ms) used ${Math.round((L.gaps.maxMs / i.watchdogMs) * 100)} % of the watchdog.` });
  }
  if (L.sessions > 3 && L.sessions / minutes > 0.2) {
    add({ level: 'warn', area: 'link', text: `${L.sessions} ground connections since start — the link dropped out completely and reconnected repeatedly, not just jittered.` });
  }

  // --- the vehicle's own timing ---
  if (i.loopDelay && i.loopDelay.p99Ms != null && i.loopDelay.p99Ms >= 50) {
    add({
      level: i.loopDelay.p99Ms >= 150 ? 'bad' : 'warn',
      area: 'vehicle',
      text: `The vehicle service itself stalls: 1 % of its event-loop turns were late by ${Math.round(i.loopDelay.p99Ms)} ms or more (worst ${Math.round(i.loopDelay.maxMs ?? 0)} ms). Frames that arrive during a stall are counted late — this is the vehicle, not the network.`,
      fix: 'Check load and temperature below; a Pi Zero streaming high-resolution video is often simply busy.',
    });
  }
  const h = i.health;
  if (h?.cpuTempC != null && h.cpuTempC >= 80) {
    add({ level: 'warn', area: 'vehicle', text: `SoC at ${h.cpuTempC} °C — the firmware clamps the clock from about 80 °C and everything gets slower at once.`, fix: 'Heatsink or airflow; lower the video resolution.' });
  }
  if (h?.load1 != null && h.load1 >= 3) {
    add({ level: 'warn', area: 'vehicle', text: `Load average ${h.load1} — the control loop shares the CPU with video encoding.` });
  }
  if (i.memoryAvailableMb != null && i.memoryAvailableMb < 80) {
    add({ level: 'warn', area: 'vehicle', text: `Only ${i.memoryAvailableMb} MB of memory available — the Pi is close to swapping, which stalls everything.` });
  }
  return out;
}

export function fmtDuration(s: number): string {
  const sec = Math.max(0, Math.round(s));
  if (sec < 90) return `${sec} s`;
  const m = Math.round(sec / 60);
  if (m < 90) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${m % 60} min`;
}

/** File name for a downloaded report: vehicle name + local time, safe on every OS. */
export function diagnosticsFileName(vehicleName: string, now = new Date()): string {
  const name = (vehicleName || 'vehicle').replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'vehicle';
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}`;
  return `yonderrc-diagnostics-${name}-${stamp}.json`;
}
