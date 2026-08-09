import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VehicleConfig, PersistentConfig } from '../config.js';
import { savePersisted } from '../config.js';
import type { SystemManager } from '../system/index.js';
import type { TelemetryService } from '../sensors/TelemetryService.js';
import type { CameraCfg } from '@yonderrc/protocol';

const SETUP_HTML = fileURLToPath(new URL('../setup/setup.html', import.meta.url));

export interface SetupContext {
  config: VehicleConfig;
  system: SystemManager;
  telemetry: TelemetryService;
  applyCameras: (cams: CameraCfg[]) => Promise<void>;
  /** Called after config is persisted so the caller can note "restart needed". */
  onConfigSaved?: (patch: PersistentConfig) => void;
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

/**
 * Returns true if it handled the request. Mounted by the HTTP server before its
 * own routes. Covers GET /setup (page) and the /api/* setup endpoints.
 */
export async function handleSetup(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: SetupContext,
): Promise<boolean> {
  const url = (req.url ?? '').split('?')[0];
  const method = req.method ?? 'GET';

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
      'access-control-allow-headers': 'content-type',
    });
    res.end();
    return true;
  }

  if (url === '/setup' && method === 'GET') {
    try {
      const html = await readFile(SETUP_HTML, 'utf8');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(html);
    } catch {
      res.writeHead(500);
      res.end('setup page missing');
    }
    return true;
  }

  if (url === '/api/system' && method === 'GET') {
    json(res, 200, await ctx.system.status());
    return true;
  }

  if (url === '/api/config' && method === 'GET') {
    const c = ctx.config;
    json(res, 200, {
      vehicleName: c.vehicleName,
      driver: c.driver,
      watchdogTimeoutMs: c.watchdogTimeoutMs,
      throttleChannels: c.throttleChannels,
      cameras: c.cameras,
      videoBaseUrl: c.videoBaseUrl,
      apn: c.apn,
      disarmOnReconnect: c.disarmOnReconnect,
      systemKind: c.systemKind,
    });
    return true;
  }

  if (url === '/api/config' && method === 'POST') {
    const patch = (await readBody(req)) as PersistentConfig;
    const saved = savePersisted(ctx.config.configPath, patch);
    if (typeof patch.disarmOnReconnect === 'boolean') ctx.config.disarmOnReconnect = patch.disarmOnReconnect;
    ctx.onConfigSaved?.(patch);
    json(res, 200, { ok: true, saved, note: 'Saved. Some changes apply after a restart.' });
    return true;
  }

  if (url === '/api/lte' && method === 'POST') {
    const { apn } = (await readBody(req)) as { apn?: string };
    json(res, 200, await ctx.system.lteConnect(apn ?? ''));
    return true;
  }
  if (url === '/api/lte/disconnect' && method === 'POST') {
    json(res, 200, await ctx.system.lteDisconnect());
    return true;
  }

  if (url === '/api/tailscale' && method === 'POST') {
    const { authKey } = (await readBody(req)) as { authKey?: string };
    json(res, 200, await ctx.system.tailscaleUp(authKey));
    return true;
  }
  if (url === '/api/tailscale/down' && method === 'POST') {
    json(res, 200, await ctx.system.tailscaleDown());
    return true;
  }

  if (url === '/api/reboot' && method === 'POST') {
    json(res, 200, await ctx.system.reboot());
    return true;
  }

  // --- telemetry ---
  if (url === '/api/telemetry' && method === 'GET') {
    json(res, 200, ctx.config.telemetry);
    return true;
  }
  if (url === '/api/telemetry' && method === 'POST') {
    const telemetry = (await readBody(req)) as PersistentConfig['telemetry'];
    savePersisted(ctx.config.configPath, { telemetry });
    ctx.onConfigSaved?.({ telemetry });
    json(res, 200, { ok: true, note: 'Telemetry saved. Restart the vehicle to apply.' });
    return true;
  }
  if (url === '/api/telemetry/reset' && method === 'POST') {
    ctx.telemetry.resetCapacity();
    json(res, 200, { ok: true, message: 'Coulomb counter reset.' });
    return true;
  }

  // --- cameras (graphical → generates go2rtc.yaml) ---
  if (url === '/api/cameras' && method === 'GET') {
    json(res, 200, { cameras: ctx.config.cameras });
    return true;
  }
  if (url === '/api/cameras' && method === 'POST') {
    const body = (await readBody(req)) as { cameras?: CameraCfg[] };
    const cameras = body.cameras ?? [];
    savePersisted(ctx.config.configPath, { cameras });
    ctx.config.cameras = cameras;
    await ctx.applyCameras(cameras);
    json(res, 200, { ok: true, message: `Applied ${cameras.length} camera(s) and reloaded video.` });
    return true;
  }

  return false;
}
