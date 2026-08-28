import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  CHANNEL_COUNT,
  type ClientMessage,
  type RtcSignalMessage,
  type WelcomeMessage,
  type ThemeMessage,
  type UiTheme,
} from '@yonderrc/protocol';
import type { VehicleCore } from '../core/VehicleCore.js';
import type { VehicleConfig } from '../config.js';
import { handleClientMessage } from './handleMessage.js';
import { WebRtcControl } from './WebRtcControl.js';
import { handleSetup, type SetupContext } from './setupRouter.js';
import { startHilinkProxy, type HilinkProxyHandle } from './hilinkProxy.js';
import type { SystemManager } from '../system/index.js';
import type { TelemetryService } from '../sensors/TelemetryService.js';
import type { GpsService } from '../sensors/GpsService.js';
import { TrafficService } from '../system/TrafficService.js';
import { loadPersisted } from '../config.js';
import { applyCameras, scaleCamera, safeStreamName } from '../video/cameraManager.js';
import { powerBadge } from '../system/power.js';
import { serveGroundApp } from './staticServer.js';
import { secretOk, readSecretFromUrl, originAllowed, originOf, secFetchSiteOf } from './auth.js';

/**
 * v0.1 control link over WebSocket, now doubling as the WebRTC signaling channel
 * (M2). Control payload can travel either over the WS (fallback) or, once
 * negotiated, over a WebRTC data channel. Status + telemetry + signaling stay on
 * the WS.
 */
export function startWsServer(
  core: VehicleCore,
  config: VehicleConfig,
  system: SystemManager,
  telemetry: TelemetryService,
  gps: GpsService,
) {
  // The HiLink stick's own web UI, proxied through the vehicle so it can be configured
  // from the AP/LAN instead of a keyboard on the Pi. Off unless a port is configured.
  let hilinkProxy: HilinkProxyHandle | null = null;
  const applyHilink = () => {
    hilinkProxy?.close();
    hilinkProxy = null;
    system.setHilinkHost(config.hilink.host);
    if (config.hilink.proxyPort) {
      hilinkProxy = startHilinkProxy({
        port: config.hilink.proxyPort,
        host: config.hilink.host,
        secret: config.apiSecret,
        log: (m) => console.log(m),
      });
    }
  };
  applyHilink();

  /**
   * How the WiFi radio is being used, cached from the system status poll below (which
   * happens anyway). The data counter needs it to tell a metered client link from the
   * vehicle's own hotspot — whose traffic is free and would otherwise empty a data plan
   * on the bench. Declared here because `setupCtx` and the status frame both want the
   * service, and both are built before the poll starts.
   */
  let currentWifiMode: string = 'unknown';
  // Same 5 s cadence as the link/power reads: one small file read, for a number that
  // moves in minutes rather than milliseconds.
  const traffic = new TrafficService(
    config.configPath,
    config.dataUsage,
    loadPersisted(config.configPath).dataUsageState,
    { hilinkTraffic: () => system.hilinkTraffic(), wifiMode: () => currentWifiMode },
  );
  traffic.start();

  const setupCtx: SetupContext = {
    config,
    system,
    telemetry,
    gps,
    core,
    traffic,
    applyCameras: (cams) =>
      applyCameras(cams, config.go2rtcConfigPath, config.videoBaseUrl, config.h264Encoder, config.rpicamBin),
    applyHilink,
    onConfigSaved: (patch) => {
      console.log('[setup] config saved:', Object.keys(patch).join(', '));
      // The one setting that must reach a ground that is already flying: switching the
      // theme in the setup page has to repaint the control app, not wait for its next
      // reconnect. Everything else here is read at connect time or needs a restart.
      if (patch.theme) broadcastTheme(patch.theme);
    },
  };
  const http = createServer((req, res) => {
    void handleSetup(req, res, setupCtx).then((handled) => {
      if (!handled) handleHttp(req, res, core, config);
    });
  });
  const wss = new WebSocketServer({ server: http });
  const broadcastTheme = (theme: UiTheme) => {
    const msg = JSON.stringify({ type: 'theme', theme } satisfies ThemeMessage);
    for (const client of wss.clients) if (client.readyState === client.OPEN) client.send(msg);
  };

  // Uplink signal (LTE/WiFi) refreshed slowly and attached to every status frame,
  // so the ground OSD can show one "link health" number. Reading shells out, so a
  // 5 s cadence is plenty — the value changes slowly.
  // Which level the cameras are scaled to right now. Starts at 'high' because that is
  // what the generated config holds after a vehicle restart.
  let videoQuality: import('@yonderrc/protocol').VideoQuality = 'high';
  let currentLink: import('@yonderrc/protocol').LinkSignal | undefined;
  // Same cadence for the supply: it also shells out, and a sagging rail is not a
  // millisecond-scale event — but it IS the difference between "the app crashed" and
  // "your servo is browning out the Pi".
  let currentPower: import('@yonderrc/protocol').PowerFlags | undefined;
  const refreshLink = () => {
    system.linkSignal().then((l) => { currentLink = l; }).catch(() => {});
    system
      .status()
      .then((st) => {
        currentWifiMode = st.wifi.mode;
        currentPower = {
          underVoltageNow: st.power.underVoltageNow,
          underVoltagePast: st.power.underVoltagePast,
          throttledNow: st.power.throttledNow,
          hotNow: st.power.hotNow,
          badge: powerBadge(st.power),
          message: st.power.message,
        };
      })
      .catch(() => {});
  };
  refreshLink();
  setInterval(refreshLink, 5000);

  /**
   * The one live control link.
   *
   * Nothing used to stop a second ground from connecting, and `resetControlLink()`
   * makes the vehicle accept the newcomer's sequence numbers immediately — so a
   * forgotten tab on a phone in someone's pocket and the operator's real session
   * would both be driving, at 50 Hz, whichever frame arrived last. Reconnecting has
   * to work (that is the normal case after a link loss), so the new session wins and
   * the old one is told exactly why it was dropped instead of racing it.
   */
  let control: WebSocket | null = null;

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const who = req.socket.remoteAddress ?? 'unknown';
    // Optional shared secret: when configured, the control link must present it as
    // `?secret=` (browsers can't set WS headers). Close 4001 so the ground can tell
    // an auth failure from a normal drop and stop retrying. OFF by default → no-op.
    if (!secretOk(config.apiSecret, readSecretFromUrl(req.url))) {
      console.warn(`[link] rejected ${who}: missing/invalid API secret`);
      ws.close(4001, 'auth required');
      return;
    }
    // WebSockets ignore CORS, so without this a page from the internet could open a
    // control link to a vehicle on the operator's own network and arm it.
    const origin = originOf(req);
    const secretProven = !!config.apiSecret && secretOk(config.apiSecret, readSecretFromUrl(req.url));
    if (!originAllowed(origin, secretProven, req.headers.host, secFetchSiteOf(req))) {
      console.warn(`[link] rejected ${who}: foreign origin ${origin}`);
      ws.close(4003, 'foreign origin');
      return;
    }
    if (control && control !== ws && control.readyState === control.OPEN) {
      console.warn('[link] a new ground connected — closing the previous control link');
      control.close(4002, 'superseded by a new ground');
    }
    control = ws;
    console.log(`[link] ground connected from ${who}`);
    // Fresh ground session: its seq restarts at 0, so forget the old high-water
    // mark or every new frame would be dropped as "stale".
    const session = core.beginControlSession();
    // Safety: by default every new connection starts DISARMED, so after a link
    // loss + reconnect the operator must re-arm deliberately. The flag lives on the
    // core (seeded from config, then overridden per vehicle type by the ground), so
    // it's OFF for aircraft where cutting motors in flight would crash.
    if (core.shouldDisarmOnReconnect) core.setArmed(false);

    const sendSignal = (msg: RtcSignalMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const rtc = new WebRtcControl(core, sendSignal, session);

    const welcome: WelcomeMessage = {
      type: 'welcome',
      vehicleName: config.vehicleName,
      protocol: PROTOCOL_VERSION,
      channelCount: CHANNEL_COUNT,
      driver: config.driver,
      watchdogTimeoutMs: config.watchdogTimeoutMs,
      videoBaseUrl: config.videoBaseUrl,
      cameras: config.cameras.map((c) => safeStreamName(c.name)),
      videoQuality,
    };
    ws.send(JSON.stringify(welcome));
    // Separate from the welcome on purpose: the welcome describes what this vehicle can
    // do, and it is sent once. The theme is the one thing that can change under a live
    // session, so it travels as its own message and is simply re-sent when it does.
    ws.send(JSON.stringify({ type: 'theme', theme: config.theme } satisfies ThemeMessage));

    const statusTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN)
        ws.send(JSON.stringify({ ...core.status(), link: currentLink, power: currentPower, data: traffic.usage ?? undefined }));
    }, 50);
    // Telemetry at a calmer rate (voltage/current/mAh change slowly).
    const telemetryTimer = setInterval(() => {
      const t = telemetry.message;
      if (t && ws.readyState === ws.OPEN) ws.send(JSON.stringify(t));
    }, 200);
    // GPS at ~1 Hz (most receivers update at 1 Hz).
    const gpsTimer = setInterval(() => {
      if (config.gps.source !== 'off' && ws.readyState === ws.OPEN) ws.send(JSON.stringify(gps.message));
    }, 1000);

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }
      if (msg.type === 'rtc') {
        void rtc.onSignal(msg);
        return;
      }
      if (msg.type === 'video') {
        // Rescale all cameras for the requested quality and reload go2rtc.
        videoQuality = msg.quality;
        const scaled = config.cameras.map((c) => scaleCamera(c, msg.quality));
        applyCameras(scaled, config.go2rtcConfigPath, config.videoBaseUrl, config.h264Encoder).catch((e) =>
          console.error('[video] quality change failed:', (e as Error).message),
        );
        console.log(`[video] quality → ${msg.quality}`);
        return;
      }
      handleClientMessage(core, msg, session);
    });

    ws.on('close', () => {
      if (control === ws) control = null;
      clearInterval(statusTimer);
      clearInterval(telemetryTimer);
      clearInterval(gpsTimer);
      rtc.close();
      console.log(`[link] ground disconnected (${who}); watchdog will hold failsafe`);
    });

    ws.on('error', (err) => console.warn('[link] socket error:', err.message));
  });

  // Without a handler this raises an unhandled 'error' event and the service dies
  // with a stack trace — under systemd, a restart loop with no explanation in it.
  http.on('error', (err) => {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'EADDRINUSE') {
      console.error(`[link] port ${config.port} is already in use — another vehicle service is probably still running.`);
      console.error('[link] stop it (systemctl stop yonderrc-vehicle) or start this one with YRC_PORT=<other port>.');
    } else if (e.code === 'EACCES') {
      console.error(`[link] not allowed to bind port ${config.port} — ports below 1024 need root.`);
    } else {
      console.error(`[link] could not listen on ${config.host}:${config.port}: ${e.message}`);
    }
    process.exit(1);
  });
  http.listen(config.port, config.host, () => {
    console.log(`[link] listening on ws://${config.host}:${config.port}`);
  });

  return { http, wss, traffic };
}

function handleHttp(
  req: IncomingMessage,
  res: ServerResponse,
  core: VehicleCore,
  config: VehicleConfig,
) {
  // Allow the ground web app (different origin in dev) to query these.
  res.setHeader('access-control-allow-origin', '*');

  if (req.url === '/status') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify(core.status()));
    return;
  }
  if (req.url === '/cameras') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ videoBaseUrl: config.videoBaseUrl, cameras: config.cameras }));
    return;
  }
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, vehicle: config.vehicleName, driver: config.driver }));
    return;
  }
  // Serve the built ground app (control + setup from a phone in AP mode). Falls
  // through to 404 in dev where the app is served separately by Vite.
  if (serveGroundApp(req, res)) return;
  res.writeHead(404);
  res.end('not found');
}
