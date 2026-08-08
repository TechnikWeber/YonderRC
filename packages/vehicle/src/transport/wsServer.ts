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

/**
 * v0.1 control link over WebSocket, now doubling as the WebRTC signaling channel
 * (M2). Control payload can travel either over the WS (fallback) or, once
 * negotiated, over a WebRTC data channel. Status + signaling stay on the WS.
 */
export function startWsServer(core: VehicleCore, config: VehicleConfig, system: SystemManager) {
  const setupCtx: SetupContext = {
    config,
    system,
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
      cameras: config.cameras,
    };
    ws.send(JSON.stringify(welcome));

    const statusTimer = setInterval(() => {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(core.status()));
    }, 50);

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
      handleClientMessage(core, msg);
    });

    ws.on('close', () => {
      clearInterval(statusTimer);
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
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, vehicle: config.vehicleName, driver: config.driver }));
    return;
  }
  res.writeHead(404);
  res.end('not found');
}
