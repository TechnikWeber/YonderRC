import { CHANNEL_COUNT, CONTROL_RATE_HZ } from '@yonderrc/protocol';
import { loadConfig } from './config.js';
import { createDriver } from './drivers/index.js';
import { VehicleCore } from './core/VehicleCore.js';
import { startWsServer } from './transport/wsServer.js';
import { createSystem } from './system/index.js';

async function main() {
  const config = loadConfig();

  console.log('');
  console.log('  YonderRC vehicle service  v1.1.3');
  console.log('  ────────────────────────────────');
  console.log(`  vehicle   : ${config.vehicleName}`);
  console.log(`  driver    : ${config.driver}`);
  console.log(`  channels  : ${CHANNEL_COUNT} @ ${CONTROL_RATE_HZ} Hz`);
  console.log(`  watchdog  : ${config.watchdogTimeoutMs} ms → failsafe`);
  console.log(`  throttle  : ch [${config.throttleChannels.join(', ')}] safe while disarmed`);
  console.log(`  video     : ${config.videoBaseUrl ?? 'disabled'} · cams [${config.cameras.join(', ')}]`);
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
  startWsServer(core, config, system);
  console.log(`  setup UI  : http://<vehicle>:${config.port}/setup  (system: ${config.systemKind})`);

  // Auto-connect LTE at boot if an APN was configured via the setup UI.
  if (config.apn) {
    system.lteConnect(config.apn).then((r) => console.log(`[lte] ${r.message}`));
  }

  const shutdown = async () => {
    console.log('\n[core] shutting down, holding failsafe…');
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
