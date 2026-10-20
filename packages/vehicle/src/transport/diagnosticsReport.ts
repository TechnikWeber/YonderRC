import { loadPersisted } from '../config.js';
import type { SetupContext } from './setupRouter.js';
import { serviceLog } from '../system/logBuffer.js';
import { loopDelaySnapshot } from '../system/loopDelay.js';
import {
  DIAGNOSTICS_SCHEMA,
  redactConfig,
  redactDeep,
  redactSecrets,
  stripPosition,
  vehicleFindings,
  type SystemDiagnostics,
} from '../system/diagnostics.js';

/** How many of the service's own log lines go into a report. */
const LOG_LINES = 600;

/**
 * The vehicle's half of a diagnostics file — served by `GET /api/diagnostics`, and
 * merged with the ground's own half when the ground app exports one.
 *
 * Collected on demand and never cached: the person pressing the button has usually
 * just watched the problem happen, and the minute after is exactly what is wanted.
 * Every source is optional — a failed piece becomes a note, not a failed report.
 */
export async function collectVehicleDiagnostics(ctx: SetupContext): Promise<Record<string, unknown>> {
  const now = Date.now();
  const c = ctx.config;
  const status = ctx.core.status();
  const notes: string[] = [];

  const [system, health, os] = await Promise.all([
    ctx.system.status().catch((e) => {
      notes.push(`system status: ${(e as Error).message}`);
      return null;
    }),
    ctx.system.health().catch((e) => {
      notes.push(`health: ${(e as Error).message}`);
      return null;
    }),
    ctx.system.diagnostics({ probeI2c: !status.armed }).catch((e): SystemDiagnostics | null => {
      notes.push(`system diagnostics: ${(e as Error).message}`);
      return null;
    }),
  ]);

  const link = ctx.core.link.snapshot(now);
  const loopDelay = loopDelaySnapshot();
  const uptimeS = Math.round(process.uptime());
  const findings = vehicleFindings({
    systemKind: c.systemKind,
    watchdogMs: ctx.core.watchdogMs,
    link,
    uptimeS,
    loopDelay,
    power: system?.power ?? null,
    wifi: system ? { mode: system.wifi.mode, powerSave: os?.wifi.powerSave ?? null, signalDbm: os?.wifi.signalDbm ?? null } : null,
    driver: { configured: c.driver, running: ctx.core.driverKind, error: c.driverError },
    health,
    memoryAvailableMb: os?.memory.availableMb ?? null,
  });

  const gpsLink = ctx.gps.linkStats();
  return {
    schema: DIAGNOSTICS_SCHEMA,
    generatedAt: new Date(now).toISOString(),
    generatedBy: 'vehicle',
    findings,
    vehicle: {
      name: c.vehicleName,
      version: c.version,
      systemKind: c.systemKind,
      uptimeS,
      driver: { configured: c.driver, running: ctx.core.driverKind, error: c.driverError ? redactSecrets(c.driverError) : null },
      watchdogMs: ctx.core.watchdogMs,
      link,
      loopDelay,
      status,
      system: system ? redactDeep(system) : null,
      health,
      os: os ? redactDeep(os) : null,
      telemetry: ctx.telemetry.message ?? null,
      gps: stripPosition(ctx.gps.message as unknown as Record<string, unknown>),
      // The last NMEA sentence verbatim would be a position; its type is what matters.
      gpsLink: gpsLink ? { ...gpsLink, last: gpsLink.last ? gpsLink.last.split(',')[0] : null } : null,
      cameras: c.cameras,
      dataUsage: ctx.traffic.usage ?? null,
      effective: {
        remoteAccess: c.remoteAccess.kind,
        hotspotMode: c.hotspot.mode ?? null,
        telemetrySource: c.telemetry.enabled === false ? 'off' : c.telemetry.source,
        gpsSource: c.gps.source,
        videoBaseUrl: c.videoBaseUrl,
        apiSecretSet: !!c.apiSecret,
        configPath: c.configPath,
      },
      config: redactConfig(loadPersisted(c.configPath)),
      log: serviceLog.tail(LOG_LINES).map((l) => ({ ...l, text: redactSecrets(l.text) })),
      notes,
    },
  };
}
