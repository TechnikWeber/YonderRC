import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { VehicleConfig, PersistentConfig } from '../config.js';
import { loadPersisted, savePersisted, resetPersisted } from '../config.js';
import type { SystemManager } from '../system/index.js';
import type { TelemetryService } from '../sensors/TelemetryService.js';
import type { GpsService } from '../sensors/GpsService.js';
import type { VehicleCore } from '../core/VehicleCore.js';
import { CHANNEL_MIN_US, CHANNEL_MAX_US, CHANNEL_NEUTRAL_US } from '@yonderrc/protocol';
import type { CameraCfg, TelemetryConfig, GpsConfig } from '@yonderrc/protocol';
import { safeStreamName } from '../video/cameraManager.js';
import { secretOk, readSecretFromReq } from './auth.js';
import {
  HOTSPOT_DEFAULTS,
  redactRemoteConfig,
  normaliseWireguardConf,
  looksLikeWireguardConf,
  isZerotierNetworkId,
  type RemoteAccessConfig,
  type LteConfig,
} from '../system/SystemManager.js';
import { redactLteConfig, isValidPin } from '../system/lte.js';
import { HW_DEPS, isHwDep } from '../system/hwDeps.js';
import { isCountryCode } from '../system/wifi.js';

const SETUP_HTML = fileURLToPath(new URL('../setup/setup.html', import.meta.url));

export interface SetupContext {
  config: VehicleConfig;
  system: SystemManager;
  telemetry: TelemetryService;
  gps: GpsService;
  core: VehicleCore;
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

  // Auth gate: only MUTATING calls (POST) are protected, and only when a secret is
  // configured. GET status stays open (read-only) and the /setup page above is open
  // so the operator can always reach the UI to enter the secret. When no secret is
  // set this is a no-op — first-time connect/setup needs nothing.
  if (method === 'POST' && url.startsWith('/api/') && !secretOk(ctx.config.apiSecret, readSecretFromReq(req))) {
    json(res, 401, { ok: false, message: 'Unauthorized — provide the API secret.' });
    return true;
  }

  if (url === '/api/system' && method === 'GET') {
    json(res, 200, await ctx.system.status());
    return true;
  }

  if (url === '/api/detect' && method === 'GET') {
    json(res, 200, await ctx.system.detectHardware());
    return true;
  }

  // ---- native driver modules (i2c-bus / pigpio / serialport) ----
  // The whole point is that a vehicle you only reach from a phone never forces
  // the operator into an SSH session; see hwDeps.ts.
  if (url === '/api/hw-deps' && method === 'GET') {
    json(res, 200, { deps: await ctx.system.hwDeps() });
    return true;
  }

  if (url === '/api/hw-deps' && method === 'POST') {
    const body = (await readBody(req)) as { pkg?: unknown };
    if (!isHwDep(body.pkg)) {
      json(res, 400, {
        ok: false,
        message: `Unknown module. Installable: ${HW_DEPS.map((d) => d.name).join(', ')}.`,
      });
      return true;
    }
    const r = await ctx.system.hwDepInstall(body.pkg);
    if (r.ok) {
      // Remember it so `install.sh` can restore it after the next update.
      const known = new Set(loadPersisted(ctx.config.configPath).hardwareDeps ?? []);
      known.add(body.pkg);
      savePersisted(ctx.config.configPath, { hardwareDeps: [...known] });
      ctx.onConfigSaved?.({ hardwareDeps: [...known] });
    }
    json(res, r.ok ? 200 : 500, r);
    return true;
  }

  if (url === '/api/restart' && method === 'POST') {
    json(res, 200, await ctx.system.restartService());
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
      apn: c.lte.apn,
      disarmOnReconnect: c.disarmOnReconnect,
      systemKind: c.systemKind,
      // Never return the secret itself — only whether one is required.
      authRequired: !!c.apiSecret,
    });
    return true;
  }

  if (url === '/api/config' && method === 'POST') {
    const patch = (await readBody(req)) as PersistentConfig;
    // Normalise an empty secret to null (= OFF) so clearing it is unambiguous.
    if (patch.apiSecret !== undefined) patch.apiSecret = patch.apiSecret || null;
    const saved = savePersisted(ctx.config.configPath, patch);
    if (typeof patch.disarmOnReconnect === 'boolean') {
      ctx.config.disarmOnReconnect = patch.disarmOnReconnect;
      ctx.core.setDisarmOnReconnect(patch.disarmOnReconnect); // keep the live flag in sync
    }
    // Apply the secret live so the gate takes effect immediately (no restart).
    if (patch.apiSecret !== undefined) ctx.config.apiSecret = patch.apiSecret;
    ctx.onConfigSaved?.(patch);
    // Don't echo the secret back in `saved`.
    const { apiSecret: _omit, ...safeSaved } = saved;
    json(res, 200, { ok: true, saved: safeSaved, note: 'Saved. Some changes apply after a restart.' });
    return true;
  }

  if (url === '/api/lte' && method === 'GET') {
    json(res, 200, { config: redactLteConfig(ctx.config.lte) });
    return true;
  }
  if (url === '/api/lte' && method === 'POST') {
    const body = (await readBody(req)) as Partial<LteConfig>;
    const cur = ctx.config.lte;
    // Merge onto the stored config so unspecified secrets (PIN, password) survive.
    const cfg: LteConfig = {
      apn: body.apn !== undefined ? body.apn || null : cur.apn,
      pin: body.pin !== undefined ? body.pin || null : cur.pin ?? null,
      username: body.username !== undefined ? body.username || null : cur.username ?? null,
      password: body.password !== undefined ? body.password || null : cur.password ?? null,
      networkMode: body.networkMode ?? cur.networkMode ?? 'auto',
      allowRoaming: body.allowRoaming !== undefined ? body.allowRoaming : cur.allowRoaming,
    };
    savePersisted(ctx.config.configPath, { lte: cfg });
    ctx.config.lte = cfg;
    json(res, 200, await ctx.system.lteConnect(cfg));
    return true;
  }
  if (url === '/api/lte/pin' && method === 'POST') {
    const body = (await readBody(req)) as { action?: 'change' | 'disable'; currentPin?: string; newPin?: string };
    if (!body.currentPin) {
      json(res, 400, { ok: false, message: 'Current PIN is required.' });
      return true;
    }
    if (body.action === 'change' && !(body.newPin && isValidPin(body.newPin))) {
      json(res, 400, { ok: false, message: 'New PIN must be 4–8 digits (or use Remove to disable the lock).' });
      return true;
    }
    json(res, 200, await ctx.system.lteSetPin({
      action: body.action === 'disable' ? 'disable' : 'change',
      currentPin: body.currentPin,
      newPin: body.newPin,
    }));
    return true;
  }
  if (url === '/api/lte/diagnostics' && method === 'POST') {
    json(res, 200, await ctx.system.lteDiagnostics());
    return true;
  }
  if (url === '/api/lte/disconnect' && method === 'POST') {
    json(res, 200, await ctx.system.lteDisconnect());
    return true;
  }

  // --- remote access (Tailscale / ZeroTier / WireGuard), one active at a time ---
  if (url === '/api/remote' && method === 'GET') {
    json(res, 200, {
      config: redactRemoteConfig(ctx.config.remoteAccess),
      status: await ctx.system.remoteStatus(ctx.config.remoteAccess),
    });
    return true;
  }
  if (url === '/api/remote' && method === 'POST') {
    const body = (await readBody(req)) as Partial<RemoteAccessConfig>;
    const cur = ctx.config.remoteAccess;
    // Merge onto the current config so unspecified secrets (auth key, WG conf) survive.
    const cfg: RemoteAccessConfig = {
      kind: body.kind ?? 'none',
      tailscaleAuthKey: body.tailscaleAuthKey !== undefined ? body.tailscaleAuthKey || null : cur.tailscaleAuthKey ?? null,
      zerotierNetworkId: body.zerotierNetworkId !== undefined ? body.zerotierNetworkId || null : cur.zerotierNetworkId ?? null,
      wireguardConf: body.wireguardConf !== undefined ? body.wireguardConf || null : cur.wireguardConf ?? null,
    };
    if (cfg.kind === 'zerotier' && !(cfg.zerotierNetworkId && isZerotierNetworkId(cfg.zerotierNetworkId))) {
      json(res, 400, { ok: false, message: 'ZeroTier needs a 16-hex network ID.' });
      return true;
    }
    if (cfg.kind === 'wireguard') {
      if (!cfg.wireguardConf) {
        json(res, 400, { ok: false, message: 'Upload a WireGuard .conf first.' });
        return true;
      }
      cfg.wireguardConf = normaliseWireguardConf(cfg.wireguardConf);
      if (!looksLikeWireguardConf(cfg.wireguardConf)) {
        json(res, 400, { ok: false, message: "That doesn't look like a WireGuard .conf ([Interface]/[Peer]/PrivateKey missing)." });
        return true;
      }
    }
    savePersisted(ctx.config.configPath, { remoteAccess: cfg });
    ctx.config.remoteAccess = cfg;
    const r = await ctx.system.remoteUp(cfg);
    json(res, r.ok ? 200 : 500, r);
    return true;
  }
  if (url === '/api/remote/down' && method === 'POST') {
    json(res, 200, await ctx.system.remoteDown(ctx.config.remoteAccess));
    return true;
  }

  // --- WiFi: join a network from the onboarding hotspot, and the hotspot itself ---
  if (url === '/api/wifi' && method === 'GET') {
    const st = await ctx.system.status();
    json(res, 200, {
      wifi: st.wifi,
      // The radio state is what decides whether a hotspot can start at all — Pi OS
      // keeps it blocked until a WiFi country is set.
      radio: await ctx.system.wifiRadio(),
      hotspot: {
        ssid: ctx.config.hotspot.ssid,
        hasPassword: !!ctx.config.hotspot.password,
        mode: ctx.config.hotspot.mode ?? 'auto',
      },
    });
    return true;
  }
  if (url === '/api/wifi/scan' && method === 'POST') {
    json(res, 200, { networks: await ctx.system.wifiScan() });
    return true;
  }
  if (url === '/api/wifi/connect' && method === 'POST') {
    const body = (await readBody(req)) as { ssid?: string; password?: string | null };
    const ssid = (body.ssid ?? '').trim();
    if (!ssid) {
      json(res, 400, { ok: false, message: 'Pick a network first.' });
      return true;
    }
    // On a single-radio Pi this drops the hotspot mid-request, so the caller may
    // never see this response — the UI says so before it asks.
    const r = await ctx.system.wifiConnect(ssid, body.password?.trim() || null);
    json(res, r.ok ? 200 : 500, r);
    return true;
  }
  if (url === '/api/wifi/radio' && method === 'POST') {
    const body = (await readBody(req)) as { country?: unknown };
    const country = typeof body.country === 'string' ? body.country : null;
    if (country && !isCountryCode(country)) {
      json(res, 400, { ok: false, message: 'Pick a two-letter country code (e.g. DE).' });
      return true;
    }
    const r = await ctx.system.wifiRadioEnable(country);
    json(res, r.ok ? 200 : 500, r);
    return true;
  }

  if (url === '/api/wifi/hotspot' && method === 'POST') {
    const body = (await readBody(req)) as {
      ssid?: string;
      password?: string | null;
      mode?: 'auto' | 'always' | 'off';
      start?: boolean;
      stop?: boolean;
    };
    const password = body.password === undefined ? ctx.config.hotspot.password : body.password || null;
    if (password && password.length < 8) {
      json(res, 400, { ok: false, message: 'A WiFi password needs at least 8 characters — leave it empty for an open hotspot.' });
      return true;
    }
    const hotspot = {
      ssid: (body.ssid ?? ctx.config.hotspot.ssid).trim() || HOTSPOT_DEFAULTS.ssid,
      password,
      mode: body.mode ?? ctx.config.hotspot.mode ?? 'auto',
    };
    savePersisted(ctx.config.configPath, { hotspot });
    ctx.config.hotspot = hotspot;
    if (body.stop) {
      json(res, 200, await ctx.system.hotspotStop());
      return true;
    }
    if (body.start) {
      const r = await ctx.system.hotspotStart(hotspot);
      json(res, r.ok ? 200 : 500, r);
      return true;
    }
    const modeNote =
      hotspot.mode === 'always'
        ? ' It will also come up next to a working LTE link (but not while the Pi is a WiFi client — one radio).'
        : hotspot.mode === 'off'
          ? ' It will not start on its own any more.'
          : ' It starts on its own only when the Pi has no uplink.';
    json(res, 200, {
      ok: true,
      message: `Saved. ${password ? 'The hotspot will use the new password' : 'The hotspot will be open'} the next time it starts.${modeNote}`,
    });
    return true;
  }

  if (url === '/api/reboot' && method === 'POST') {
    json(res, 200, await ctx.system.reboot());
    return true;
  }

  if (url === '/api/factory-reset' && method === 'POST') {
    resetPersisted(ctx.config.configPath);
    // Drop the secret live so the operator isn't locked out after a reset; the rest
    // (driver, telemetry, cameras) reverts to defaults on the next restart.
    ctx.config.apiSecret = null;
    json(res, 200, { ok: true, message: 'Factory reset — restart the vehicle to apply defaults.' });
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
    // Keep the in-memory config in sync — GET /api/telemetry reads it, so without
    // this the setup page showed the pre-save values again after a reload.
    if (telemetry) ctx.config.telemetry = telemetry;
    ctx.onConfigSaved?.({ telemetry });
    // Apply live so battery %/mAh appears without a restart.
    let note = 'Telemetry applied.';
    try {
      await ctx.telemetry.reconfigure(telemetry as unknown as TelemetryConfig);
    } catch (e) {
      note = `Saved, but live apply failed (${(e as Error).message}). Restart to apply.`;
    }
    json(res, 200, { ok: true, note });
    return true;
  }
  if (url === '/api/telemetry/reset' && method === 'POST') {
    await ctx.telemetry.resetCapacity();
    json(res, 200, { ok: true, message: 'Coulomb counter reset.' });
    return true;
  }

  // --- GPS ---
  if (url === '/api/gps' && method === 'GET') {
    json(res, 200, { config: ctx.config.gps, status: ctx.gps.message });
    return true;
  }
  if (url === '/api/gps' && method === 'POST') {
    const body = (await readBody(req)) as Partial<GpsConfig>;
    const cur = ctx.config.gps;
    const cfg: GpsConfig = {
      source: body.source ?? cur.source,
      device: body.device !== undefined ? body.device || null : cur.device ?? null,
      baud: body.baud ?? cur.baud ?? 9600,
      autoHome: body.autoHome ?? cur.autoHome,
      minSats: body.minSats ?? cur.minSats,
      home: cur.home ?? null, // home is changed only via /api/gps/home
    };
    savePersisted(ctx.config.configPath, { gps: cfg });
    ctx.config.gps = cfg;
    let note = 'GPS applied.';
    try { await ctx.gps.reconfigure(cfg); } catch (e) { note = `Saved, but apply failed (${(e as Error).message}).`; }
    json(res, 200, { ok: true, note });
    return true;
  }
  if (url === '/api/gps/home' && method === 'POST') {
    const { action } = (await readBody(req)) as { action?: 'set' | 'clear' };
    if (action === 'clear') {
      ctx.gps.clearHome();
      ctx.config.gps = { ...ctx.config.gps, home: null };
      savePersisted(ctx.config.configPath, { gps: ctx.config.gps });
      json(res, 200, { ok: true, message: 'Home cleared.' });
      return true;
    }
    const home = ctx.gps.setHomeNow();
    if (!home) {
      json(res, 400, { ok: false, message: 'No position yet — wait for a GPS fix.' });
      return true;
    }
    ctx.config.gps = { ...ctx.config.gps, home };
    savePersisted(ctx.config.configPath, { gps: ctx.config.gps });
    json(res, 200, { ok: true, message: `Home set at ${home.lat.toFixed(6)}, ${home.lon.toFixed(6)}.`, home });
    return true;
  }
  // Live one-shot sensor read for the setup "Hardware test".
  if (url === '/api/telemetry/live' && method === 'GET') {
    json(res, 200, ctx.telemetry.message ?? { ok: false, note: 'no telemetry yet' });
    return true;
  }
  // Channel sweep: min → max → center, to verify servo wiring. Disarmed only.
  if (url === '/api/test/channel' && method === 'POST') {
    const { channel } = (await readBody(req)) as { channel?: number };
    const ch = Number(channel);
    if (!Number.isInteger(ch) || ch < 0) {
      json(res, 400, { ok: false, message: 'invalid channel' });
      return true;
    }
    if (!ctx.core.setTestOverride(ch, CHANNEL_NEUTRAL_US)) {
      json(res, 409, { ok: false, message: 'Disarm the vehicle before testing channels.' });
      return true;
    }
    const seq = [CHANNEL_NEUTRAL_US, CHANNEL_MIN_US, CHANNEL_NEUTRAL_US, CHANNEL_MAX_US, CHANNEL_NEUTRAL_US];
    for (const us of seq) {
      ctx.core.setTestOverride(ch, us);
      await new Promise((r) => setTimeout(r, 450));
    }
    ctx.core.clearTestOverride();
    json(res, 200, { ok: true, message: `Swept channel ${ch + 1} (min→max→center).` });
    return true;
  }

  // --- cameras (graphical → generates go2rtc.yaml) ---
  if (url === '/api/cameras' && method === 'GET') {
    json(res, 200, { cameras: ctx.config.cameras });
    return true;
  }
  if (url === '/api/cameras' && method === 'POST') {
    const body = (await readBody(req)) as { cameras?: CameraCfg[] };
    // Normalise stream names on save so the stored config, the welcome message and
    // the generated go2rtc.yaml all agree on the same safe stream id.
    const cameras = (body.cameras ?? []).map((c) => ({ ...c, name: safeStreamName(c.name) }));
    savePersisted(ctx.config.configPath, { cameras });
    ctx.config.cameras = cameras;
    await ctx.applyCameras(cameras);
    json(res, 200, { ok: true, message: `Applied ${cameras.length} camera(s) and reloaded video.` });
    return true;
  }

  return false;
}
