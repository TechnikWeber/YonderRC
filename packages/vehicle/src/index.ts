import { CHANNEL_COUNT, CONTROL_RATE_HZ } from '@yonderrc/protocol';
import { loadConfig } from './config.js';
import { createDriver } from './drivers/index.js';
import { VehicleCore } from './core/VehicleCore.js';
import { startWsServer } from './transport/wsServer.js';
import { createSystem } from './system/index.js';
import { TelemetryService } from './sensors/TelemetryService.js';
import { GpsService } from './sensors/GpsService.js';
import { applyCameras, detectH264Encoder } from './video/cameraManager.js';
import { startCaptivePortal } from './transport/captivePortal.js';

async function main() {
  const config = loadConfig();

  console.log('');
  console.log('  YonderRC vehicle service  v1.20.1');
  console.log('  ────────────────────────────────');
  console.log(`  vehicle   : ${config.vehicleName}`);
  console.log(`  driver    : ${config.driver}`);
  console.log(`  channels  : ${CHANNEL_COUNT} @ ${CONTROL_RATE_HZ} Hz`);
  console.log(`  watchdog  : ${config.watchdogTimeoutMs} ms → failsafe`);
  console.log(`  throttle  : ch [${config.throttleChannels.join(', ')}] safe while disarmed`);
  console.log(`  video     : ${config.videoBaseUrl ?? 'disabled'} · cams [${config.cameras.map((c) => c.name).join(', ')}]`);
  console.log('');

  // Start the configured driver. If it fails (e.g. a hardware driver was chosen
  // via the setup UI but the lib/hardware is missing), fall back to sim so the
  // vehicle stays up and the setup UI remains reachable to fix the config —
  // never leave a headless appliance dead and unconfigurable.
  const driverOpts = { logEveryMs: config.simLogEveryMs, ...config.driverOptions };
  let core = new VehicleCore({
    driver: await createDriver(config.driver, driverOpts),
    watchdogTimeoutMs: config.watchdogTimeoutMs,
    throttleChannels: config.throttleChannels,
    disarmOnReconnect: config.disarmOnReconnect,
  });
  try {
    await core.start();
  } catch (err) {
    console.error(
      `[core] driver "${config.driver}" failed to start: ${(err as Error).message}\n` +
        '[core] falling back to sim driver so the setup UI stays reachable.',
    );
    core = new VehicleCore({
      driver: await createDriver('sim', driverOpts),
      watchdogTimeoutMs: config.watchdogTimeoutMs,
      throttleChannels: config.throttleChannels,
    });
    await core.start();
  }

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
  await applyCameras(config.cameras, config.go2rtcConfigPath, config.videoBaseUrl, config.h264Encoder).catch(
    (e) => console.error('[video] initial camera generation failed:', (e as Error).message),
  );

  startWsServer(core, config, system, telemetry, gps);
  console.log(`  setup UI  : http://<vehicle>:${config.port}/setup  (system: ${config.systemKind})`);
  console.log(`  control   : http://<vehicle>:${config.port}/  (ground app, if built)`);
  console.log(`  telemetry : ${config.telemetry.source} · ${config.telemetry.enabled ? 'on' : 'off'}`);

  // Captive portal for AP-mode onboarding (binds :80; skipped if not permitted).
  if (config.systemKind === 'real') startCaptivePortal(config.port);

  // Auto-connect LTE at boot if an APN was configured via the setup UI.
  if (config.lte.apn) {
    system.lteConnect(config.lte).then((r) => console.log(`[lte] ${r.message}`));
  }

  // Bring the configured remote-access method up at boot so the vehicle is reachable.
  if (config.remoteAccess.kind !== 'none') {
    system
      .remoteUp(config.remoteAccess)
      .then((r) => console.log(`[remote] ${config.remoteAccess.kind}: ${r.message}`))
      .catch((e) => console.warn(`[remote] up failed: ${(e as Error).message}`));
  }

  const shutdown = async () => {
    console.log('\n[core] shutting down, holding failsafe…');
    await telemetry.stop();
    await gps.stop();
    await core.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('fatal:', err);
  process.exit(1);
});
