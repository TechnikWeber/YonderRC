import { CHANNEL_COUNT, CONTROL_RATE_HZ } from '@yonderrc/protocol';
import { loadConfig, videoApiUrl } from './config.js';
import { createDriver } from './drivers/index.js';
import { VehicleCore } from './core/VehicleCore.js';
import { startWsServer } from './transport/wsServer.js';
import { createSystem } from './system/index.js';
import { TelemetryService } from './sensors/TelemetryService.js';
import { GpsService } from './sensors/GpsService.js';
import { applyCameras, detectH264Encoder, detectRpicamBinary } from './video/cameraManager.js';
import { startCaptivePortal } from './transport/captivePortal.js';
import { captureConsole, serviceLog } from './system/logBuffer.js';
import { startLoopDelayMonitor } from './system/loopDelay.js';

/** The core driving the outputs right now — for the crash guard below. */
let liveCore: VehicleCore | null = null;

/**
 * The last line of defence. Every known path catches its own errors; this is for the
 * one nobody has found yet. An exception nothing caught used to end the process with
 * the servo board still holding its last value — whatever the sticks were doing.
 */
function installCrashGuards(): void {
  // Rejections come from async side work — LTE, VPN, video, a setup request — never
  // from the control loop, which catches its own. Ending the service over a failed
  // modem command would cut a working control link, so they are logged, not fatal.
  process.on('unhandledRejection', (reason) => {
    console.error('[core] unhandled rejection (the service keeps running):', reason);
  });
  // After an uncaught exception the process is in an unknown state. Write the safe
  // frame first, then exit, and systemd starts a clean service two seconds later.
  let exiting = false;
  process.on('uncaughtException', (err) => {
    console.error('[core] uncaught exception — writing failsafe, then exiting for a clean restart:', err);
    if (exiting) return;
    exiting = true;
    const exit = () => process.exit(1);
    setTimeout(exit, 1000).unref();
    if (liveCore) liveCore.stop().then(exit, exit);
    else exit();
  });
}

async function main() {
  // First, so the diagnostics export has the whole story — banner and driver start included.
  captureConsole(serviceLog);
  installCrashGuards();
  startLoopDelayMonitor();
  const config = loadConfig();
  // What the last ground pushed. Before v1.70.1 these lived in memory only, and a
  // restarted service drove 1500 µs on every channel until a ground connected again.
  const safety = config.controlSafety;

  console.log('');
  console.log(`  YonderRC vehicle service  v${config.version}`);
  console.log('  ────────────────────────────────');
  console.log(`  vehicle   : ${config.vehicleName}`);
  console.log(`  driver    : ${config.driver}`);
  console.log(`  channels  : ${CHANNEL_COUNT} @ ${CONTROL_RATE_HZ} Hz`);
  console.log(`  watchdog  : ${config.watchdogTimeoutMs} ms → failsafe`);
  const throttleChannels = safety?.throttleChannels ?? config.throttleChannels;
  console.log(`  throttle  : ch [${throttleChannels.join(', ')}] safe while disarmed`);
  console.log(
    `  failsafe  : ${safety ? 'as the last ground app set it' : 'neutral 1500 µs — no ground app has connected yet'}`,
  );
  console.log(
    `  video     : ${config.videoBaseUrl ?? 'disabled'} · ` +
      (config.cameras.length
        ? `cams [${config.cameras.map((c) => c.name).join(', ')}]`
        : 'no cameras (fine — the ground station just stays dark)'),
  );
  console.log('');

  // Start the configured driver. If it fails (e.g. a hardware driver was chosen
  // via the setup UI but the lib/hardware is missing), fall back to sim so the
  // vehicle stays up and the setup UI remains reachable to fix the config —
  // never leave a headless appliance dead and unconfigurable.
  const driverOpts = { logEveryMs: config.simLogEveryMs, ...config.driverOptions };
  // One options object for both cores: the fallback used to list its own and silently
  // dropped disarmOnReconnect — re-enabling auto-disarm for a type configured without it.
  const coreOpts = {
    watchdogTimeoutMs: config.watchdogTimeoutMs,
    failsafeUs: safety?.failsafeUs,
    disarmedUs: safety?.disarmedUs,
    throttleChannels,
    disarmOnReconnect: config.disarmOnReconnect,
  };
  let core = new VehicleCore({ driver: await createDriver(config.driver, driverOpts), ...coreOpts });
  try {
    await core.start();
  } catch (err) {
    config.driverError = (err as Error).message;
    console.error(
      `[core] driver "${config.driver}" failed to start: ${(err as Error).message}\n` +
        '[core] falling back to sim driver so the setup UI stays reachable.',
    );
    core = new VehicleCore({ driver: await createDriver('sim', driverOpts), ...coreOpts });
    await core.start();
  }
  liveCore = core;

  const system = createSystem(config.systemKind);

  // Telemetry (sensors → coulomb counting → OSD). Sim by default.
  const telemetry = new TelemetryService(config.telemetry);
  await telemetry.start();

  // GPS (selectable source → normalized fix + home). Off by default.
  const gps = new GpsService(config.gps);
  await gps.start().catch((e) => console.warn(`[gps] start failed: ${(e as Error).message}`));

  // Generate go2rtc.yaml from the graphical camera list (best effort at boot).
  config.h264Encoder = await detectH264Encoder();
  console.log(`  encoder   : ${config.h264Encoder} (auto-detected)`);
  config.rpicamBin = await detectRpicamBinary();
  console.log(`  pi camera : ${config.rpicamBin} (auto-detected)`);
  await applyCameras(
    config.cameras,
    config.go2rtcConfigPath,
    videoApiUrl(config),
    config.h264Encoder,
    config.rpicamBin,
  ).catch(
    (e) => console.error('[video] initial camera generation failed:', (e as Error).message),
  );

  const { traffic } = startWsServer(core, config, system, telemetry, gps);
  console.log(`  setup UI  : http://<vehicle>:${config.port}/setup  (system: ${config.systemKind})`);
  console.log(`  control   : http://<vehicle>:${config.port}/  (ground app, if built)`);
  console.log(`  telemetry : ${config.telemetry.source} · ${config.telemetry.enabled ? 'on' : 'off'}`);

  // Captive portal for AP-mode onboarding (binds :80; skipped if not permitted).
  if (config.systemKind === 'real') startCaptivePortal(config.port);

  // Auto-connect LTE at boot if an APN was configured via the setup UI.
  if (config.lte.apn) {
    system
      .lteConnect(config.lte)
      .then((r) => console.log(`[lte] ${r.message}`))
      .catch((e) => console.warn(`[lte] connect failed: ${(e as Error).message}`));
  }

  // Bring the configured remote-access method up at boot so the vehicle is reachable.
  if (config.remoteAccess.kind !== 'none') {
    system
      .remoteUp(config.remoteAccess)
      .then((r) => console.log(`[remote] ${config.remoteAccess.kind}: ${r.message}`))
      .catch((e) => console.warn(`[remote] up failed: ${(e as Error).message}`));
  }

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\n[core] shutting down, holding failsafe…');
    // The safe frame first: everything after it is housekeeping, and a sensor that
    // fails to close must not keep the outputs where the sticks left them.
    await core.stop().catch((e) => console.error('[core] failsafe write on shutdown failed:', (e as Error).message));
    await telemetry.stop().catch(() => {});
    await gps.stop().catch(() => {});
    // Persist the data counter before the process goes: it is otherwise written at most
    // every 5 min, so a clean `systemctl restart` — which every update does — threw away
    // whatever had been counted since the last write.
    try {
      traffic.stop();
    } catch {
      /* the counter loses at most five minutes */
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
