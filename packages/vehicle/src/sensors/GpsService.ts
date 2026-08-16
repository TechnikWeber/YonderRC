import type { GpsConfig, GpsFix, GpsHome, GpsMessage } from '@yonderrc/protocol';
import { emptyFix } from '@yonderrc/protocol';
import { parseNmea } from './nmea.js';

/**
 * Owns the GPS: one selectable SOURCE (sim / local NMEA receiver / gpsd / — later —
 * MAVLink), normalized to a GpsFix, plus the home point and auto-home logic. The
 * source abstraction means the ground and OSD never care where the fix came from.
 */

interface GpsSource {
  readonly kind: string;
  start(onFix: (f: GpsFix) => void): Promise<void>;
  stop(): Promise<void>;
}

/** Synthetic receiver: sats ramp up, then a slow circular track — for dev. */
/** Where the sim flies: Balingen (72336), ~517 m above sea level. */
const SIM_CENTER = { lat: 48.275833, lon: 8.853611, altM: 517 };

class SimGpsSource implements GpsSource {
  readonly kind = 'sim';
  private timer: ReturnType<typeof setInterval> | null = null;
  private t = 0;
  async start(onFix: (f: GpsFix) => void): Promise<void> {
    this.timer = setInterval(() => {
      this.t += 1;
      const sats = Math.min(11, Math.floor(this.t / 2)); // ramp 0→11 over ~22s
      const has = sats >= 4;
      const r = 0.0009; // ~100 m circle
      onFix({
        source: 'sim', hasFix: has, fixType: has ? '3d' : 'none',
        // Circling over Balingen (72336), Baden-Württemberg.
        lat: SIM_CENTER.lat + r * Math.sin(this.t / 20),
        lon: SIM_CENTER.lon + r * Math.cos(this.t / 20),
        altM: has ? SIM_CENTER.altM + 2 * Math.sin(this.t / 7) : null,
        satellites: sats, hdop: has ? 0.9 : null,
        speedMs: has ? 3.2 : null, courseDeg: has ? (this.t * 5) % 360 : null,
        timeUtc: new Date().toISOString().slice(0, 19) + 'Z',
      });
    }, 1000);
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

/** Local NMEA receiver over serial (Adafruit Ultimate GPS, u-blox, most modules). */
class SerialNmeaSource implements GpsSource {
  readonly kind = 'serial-nmea';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private port: any = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private buf = '';
  constructor(private device: string, private baud: number) {}
  async start(onFix: (f: GpsFix) => void): Promise<void> {
    const modName = 'serialport';
    const mod = await import(modName).catch(() => {
      throw new Error('serialport not available — `npm i serialport` in packages/vehicle, or use gpsd/sim.');
    });
    this.port = new mod.SerialPort({ path: this.device, baudRate: this.baud, autoOpen: true });
    this.port.on('error', (e: Error) => console.warn(`[gps] serial error: ${e.message}`));
    this.port.on('data', (d: Buffer) => { this.buf += d.toString('ascii'); if (this.buf.length > 8192) this.buf = this.buf.slice(-4096); });
    // Parse the rolling buffer once a second (NMEA is ~1 Hz anyway).
    this.timer = setInterval(() => { if (this.buf) { onFix(parseNmea(this.buf, 'serial-nmea')); this.buf = ''; } }, 1000);
  }
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try { await new Promise<void>((r) => this.port?.close(() => r())); } catch { /* best effort */ }
  }
}

/** gpsd (localhost:2947) — the easy path for USB dongles and many receivers. */
class GpsdSource implements GpsSource {
  readonly kind = 'gpsd';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sock: any = null;
  private sats: number | null = null;
  async start(onFix: (f: GpsFix) => void): Promise<void> {
    const net = await import('node:net');
    const sock = net.connect(2947, '127.0.0.1', () => sock.write('?WATCH={"enable":true,"json":true}\n'));
    this.sock = sock;
    sock.on('error', (e: Error) => console.warn(`[gps] gpsd error: ${e.message}`));
    let buf = '';
    sock.on('data', (d: Buffer) => {
      buf += d.toString('utf8');
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        try {
          const o = JSON.parse(line);
          if (o.class === 'SKY' && typeof o.uSat === 'number') this.sats = o.uSat;
          else if (o.class === 'SKY' && Array.isArray(o.satellites)) this.sats = o.satellites.filter((s: { used?: boolean }) => s.used).length;
          if (o.class === 'TPV') {
            const has = (o.mode ?? 0) >= 2;
            onFix({
              source: 'gpsd', hasFix: has, fixType: o.mode === 3 ? '3d' : o.mode === 2 ? '2d' : 'none',
              lat: o.lat ?? null, lon: o.lon ?? null, altM: o.altMSL ?? o.alt ?? null,
              satellites: this.sats, hdop: o.hdop ?? null,
              speedMs: o.speed ?? null, courseDeg: o.track ?? null, timeUtc: o.time ?? null,
            });
          }
        } catch { /* ignore non-JSON banner lines */ }
      }
    });
  }
  async stop(): Promise<void> { try { this.sock?.destroy(); } catch { /* ignore */ } }
}

/** Placeholder until the MAVLink bridge lands — reports no fix so the UI is honest. */
class MavlinkGpsSource implements GpsSource {
  readonly kind = 'mavlink';
  async start(onFix: (f: GpsFix) => void): Promise<void> { onFix({ ...emptyFix('mavlink') }); }
  async stop(): Promise<void> {}
}

function createSource(cfg: GpsConfig): GpsSource | null {
  switch (cfg.source) {
    case 'sim': return new SimGpsSource();
    case 'serial-nmea': return new SerialNmeaSource(cfg.device ?? '/dev/ttyAMA0', cfg.baud ?? 9600);
    case 'gpsd': return new GpsdSource();
    case 'mavlink': return new MavlinkGpsSource();
    default: return null; // 'off'
  }
}

export class GpsService {
  private cfg: GpsConfig;
  private source: GpsSource | null = null;
  private latest: GpsFix;
  /** Manually saved home (persisted by the caller). */
  private savedHome: GpsHome | null;
  /** Auto-home for this session (takeoff point); not persisted. */
  private sessionHome: GpsHome | null = null;

  constructor(cfg: GpsConfig) {
    this.cfg = cfg;
    this.latest = emptyFix(cfg.source);
    this.savedHome = cfg.home ?? null;
  }

  private goodFix(f: GpsFix): boolean {
    return f.hasFix && f.lat != null && f.lon != null && (f.satellites ?? 0) >= this.cfg.minSats;
  }

  private get effectiveHome(): GpsHome | null {
    return this.savedHome ?? this.sessionHome;
  }

  async start(): Promise<void> {
    this.source = createSource(this.cfg);
    if (!this.source) { this.latest = emptyFix('off'); return; }
    await this.source.start((f) => {
      this.latest = f;
      // Auto-home: set the session home the first time we get a solid fix.
      if (this.cfg.autoHome && !this.effectiveHome && this.goodFix(f)) {
        this.sessionHome = { lat: f.lat!, lon: f.lon!, altM: f.altM };
        console.log(`[gps] auto-home set at ${f.lat!.toFixed(6)}, ${f.lon!.toFixed(6)} (${f.satellites} sats)`);
      }
    });
    console.log(`[gps] source ${this.cfg.source}${this.cfg.source === 'serial-nmea' ? ` (${this.cfg.device} @ ${this.cfg.baud})` : ''}, autoHome=${this.cfg.autoHome}, minSats=${this.cfg.minSats}`);
  }

  async stop(): Promise<void> {
    await this.source?.stop();
    this.source = null;
  }

  async reconfigure(cfg: GpsConfig): Promise<void> {
    await this.stop();
    this.cfg = cfg;
    this.savedHome = cfg.home ?? null;
    this.sessionHome = null;
    this.latest = emptyFix(cfg.source);
    await this.start();
  }

  /** Save the current position as home (persisted by the caller). Returns it, or null. */
  setHomeNow(): GpsHome | null {
    const f = this.latest;
    if (f.lat == null || f.lon == null) return null;
    this.savedHome = { lat: f.lat, lon: f.lon, altM: f.altM };
    return this.savedHome;
  }

  clearHome(): void {
    this.savedHome = null;
    this.sessionHome = null;
  }

  get message(): GpsMessage {
    return { type: 'gps', ...this.latest, home: this.effectiveHome };
  }
}
