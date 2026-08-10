import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import {
  PROTOCOL_VERSION,
  CHANNEL_COUNT,
  type ClientMessage,
  type RtcSignalMessage,
  type WelcomeMessage,
} from '@yonderrc/protocol';
import type { VehicleCore } from '../core/VehicleCore.js';
import type { VehicleConfig } from '../config.js';
import { handleClientMessage } from './handleMessage.js';
import { WebRtcControl } from './WebRtcControl.js';
import { handleSetup, type SetupContext } from './setupRouter.js';
import type { SystemManager } from '../system/index.js';
import type { TelemetryService } from '../sensors/TelemetryService.js';
import { applyCameras, scaleCamera } from '../video/cameraManager.js';
import { serveGroundApp } from './staticServer.js';

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
) {
  const setupCtx: SetupContext = {
    config,
    system,
    telemetry,
    core,
    applyCameras: (cams) => applyCameras(cams, config.go2rtcConfigPath, config.videoBaseUrl, config.h264Encoder),
    onConfigSaved: (patch) => console.log('[setup] config saved:', Object.keys(patch).join(', ')),
  };
  const http = createServer((req, res) => {
    void handleSetup(req, res, setupCtx).then((handled) => {
      if (!handled) handleHttp(req, res, core, config);
    });
  });
  const wss = new WebSocketServer({ server: http });

  wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
    const who = req.socket.remoteAddress ?? 'unknown';
    console.log(`[link] ground connected from ${who}`);
    // Fresh ground session: its seq restarts at 0, so forget the old high-water
    // mark or every new frame would be dropped as "stale".
    core.resetControlLink();
    // Safety: by default every new connection starts DISARMED, so after a link
    // loss + reconnect the operator must re-arm deliberately. Disabled for aircraft
    // (config.disarmOnReconnect = false), where cutting motors in flight would crash.
    if (config.disarmOnReconnect) core.setArmed(false);

    const sendSignal = (msg: RtcSignalMessage) => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
    };
    const rtc = new WebRtcControl(core, sendSignal);

    const welcome: WelcomeMessage = {
      type: 'welcome',
      vehicleName: config.vehicleName,
      protocol: PROTOCOL_VERSION,
      channelCount: CHANNEL_COUNT,
      driver: config.driver,
      watchdogTimeoutMs: config.watchdogTimeoutMs,
      videoBaseUrl: config.videoBaseUrl,
      cameras: config.cameras.map((c) => c.name),
    };
    ws.send(JSON.stringify(welcome));

    const statusTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(core.status()));
    }, 50);
    // Telemetry at a calmer rate (voltage/current/mAh change slowly).
    const telemetryTimer = setInterval(() => {
      const t = telemetry.message;
      if (t && ws.readyState === ws.OPEN) ws.send(JSON.stringify(t));
    }, 200);

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
        const scaled = config.cameras.map((c) => scaleCamera(c, msg.quality));
        void applyCameras(scaled, config.go2rtcConfigPath, config.videoBaseUrl, config.h264Encoder);
        console.log(`[video] quality → ${msg.quality}`);
        return;
      }
      handleClientMessage(core, msg);
    });

    ws.on('close', () => {
      clearInterval(statusTimer);
      clearInterval(telemetryTimer);
      rtc.close();
      console.log(`[link] ground disconnected (${who}); watchdog will hold failsafe`);
    });

    ws.on('error', (err) => console.warn('[link] socket error:', err.message));
  });

  http.listen(config.port, config.host, () => {
    console.log(`[link] listening on ws://${config.host}:${config.port}`);
  });

  return { http, wss };
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
