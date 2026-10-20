/**
 * Hardware detection for the installer: probe once, fill in what was never saved.
 *
 * provisioning/install.sh runs this after it has switched I²C on and before it starts the
 * vehicle service, so a vehicle with a PCA9685 and a camera module comes up driving the
 * servos and showing the camera instead of the simulator. The decisions are made by
 * `firstRunPlan` (system/firstRun.ts, unit-tested); this file only wires the real probe to
 * the config file and prints what happened. It never fails the installation.
 *
 *   YRC_CONFIG=/opt/yonderrc/yonderrc-config.json npm run first-run -w @yonderrc/vehicle
 *   … -- --dry-run   only print what would be saved
 *   … -- --sim       use the simulated probe (works on any machine)
 */
import { loadPersisted, savePersisted } from '../config.js';
import { firstRunPlan } from '../system/firstRun.js';
import type { SystemManager } from '../system/SystemManager.js';

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const sim = args.includes('--sim');
  const path = process.env.YRC_CONFIG ?? 'yonderrc-config.json';

  // Imported lazily: the real system pulls in the whole shell-out layer, which a --sim
  // run on a laptop has no use for.
  const system: SystemManager = sim
    ? new (await import('../system/SimSystem.js')).SimSystem()
    : new (await import('../system/RealSystem.js')).RealSystem();

  let detect;
  try {
    detect = await system.detectHardware();
  } catch (err) {
    console.log(`   hardware detection failed (${(err as Error).message}) — pick driver and camera in the setup page.`);
    return;
  }

  const plan = firstRunPlan(loadPersisted(path), detect);
  for (const line of plan.notes) console.log(`   ${line}`);
  // The probe's own remarks that matter at install time: a sagging supply and a silent
  // bus. "No LTE modem" is normal for most vehicles and only noise here.
  for (const n of detect.notes) {
    if (/power|voltage|I²C|i2c|Two devices/i.test(n)) console.log(`   (probe) ${n}`);
  }

  const keys = Object.keys(plan.patch);
  if (keys.length === 0) {
    console.log('   nothing to change in the saved settings.');
    return;
  }
  if (dryRun) {
    console.log(`   --dry-run: would save ${JSON.stringify(plan.patch)}`);
    return;
  }
  savePersisted(path, plan.patch);
  console.log(`   saved to ${path}: ${keys.join(', ')}`);
}

main().catch((err) => {
  // An installer step that throws would abort `set -e` provisioning over something the
  // setup page can fix in two clicks.
  console.log(`   hardware detection skipped: ${(err as Error).message}`);
});
