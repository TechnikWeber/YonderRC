/**
 * YonderRC test suite — run with `npm test` (tsx). Consolidates the checks we
 * built incrementally into one repeatable run so future hardware tweaks can't
 * silently regress the safety-critical logic.
 */
import * as C from '../packages/vehicle/src/sensors/convert';
import { TelemetryService } from '../packages/vehicle/src/sensors/TelemetryService';
import { cameraSource, scaleCamera } from '../packages/vehicle/src/video/cameraManager';
import { buildProfile, rebuildForMethod, applyEndpoints, setDetent, currentDetents } from '../packages/ground/src/lib/templates';
import { profileFailsafeUs, profileDisarmedUs } from '../packages/ground/src/lib/profiles';
import { BindingEngine, type InputSnapshot } from '../packages/ground/src/lib/input/bindingEngine';
import type { TelemetryConfig, CameraCfg } from '@yonderrc/protocol';

let pass = 0;
let fail = 0;
const failures: string[] = [];
const ok = (name: string, cond: boolean, extra = '') => {
  if (cond) pass++;
  else {
    fail++;
    failures.push(`${name} ${extra}`);
  }
};
const near = (a: number, b: number, t = 1e-6) => Math.abs(a - b) < t;
const snap = (p: Partial<InputSnapshot>): InputSnapshot => ({
  keys: new Set(),
  pressed: new Set(),
  joystick: () => null,
  gamepadAxis: () => null,
  gamepadButton: () => false,
  ...p,
});

async function main() {
  // ---- sensor conversion math ----
  ok('ina219 bus 12V', near(C.ina219BusVolts(3000 << 3), 12));
  ok('ina219 amps', near(C.ina219Amps(2000, 0.01), 2));
  ok('ina226 bus 12V', near(C.ina226BusVolts(9600), 12));
  ok('ina260 amps 5A', near(C.ina260Amps(4000), 5));
  ok('ads1115 half-scale', near(C.ads1115Volts(16384, 4.096), 2.048, 1e-4));
  ok('mcp3208 half', near(C.mcp3208Volts(2048, 3.3), 1.65, 2e-3));
  ok('acs712 5A', near(C.acsAmps(2.83, 2.5, 66), 5, 1e-2));

  // ---- coulomb counting precision ----
  let mah = 0;
  for (let i = 0; i < 3600; i++) mah = C.accumulateMah(mah, 10, 0.1);
  ok('coulomb 10A·360s = 1000mAh', near(mah, 1000, 1e-3), `=${mah}`);

  // ---- sim telemetry service ----
  const tcfg: TelemetryConfig = {
    enabled: true, source: 'sim', sampleHz: 50,
    voltages: [{ label: 'V1', kind: 'sim' }], currents: [{ label: 'I1', kind: 'sim' }],
    countCapacity: true, batteryCapacityMah: 2200, displayMode: 'remaining',
  };
  const svc = new TelemetryService(tcfg);
  await svc.start();
  await new Promise((r) => setTimeout(r, 300));
  const tm = svc.message!;
  ok('telemetry sim source+ok', tm.source === 'sim' && tm.ok === true);
  ok('telemetry battery %', tm.batteryPercent !== null && tm.batteryPercent > 90);
  await svc.stop();

  // ---- real telemetry with no sensor → NO DATA (no sim substitution) ----
  const rcfg: TelemetryConfig = { ...tcfg, source: 'real', voltages: [{ label: 'V1', kind: 'ina226' }], currents: [{ label: 'I1', kind: 'ina226', shuntOhms: 0.001 }] };
  const rsvc = new TelemetryService(rcfg);
  await rsvc.start();
  await new Promise((r) => setTimeout(r, 200));
  const rm = rsvc.message!;
  ok('real w/o sensor → ok:false', rm.source === 'real' && rm.ok === false);
  await rsvc.stop();

  // ---- vehicle-type failsafe vs disarmed (the drone safety fix) ----
  const drone = buildProfile('drone');
  const dch = drone.throttleChannels[0];
  ok('drone failsafe throttle = center (hold)', profileFailsafeUs(drone)[dch] === 1500, `=${profileFailsafeUs(drone)[dch]}`);
  ok('drone disarmed throttle = min (off)', profileDisarmedUs(drone)[dch] === 1000, `=${profileDisarmedUs(drone)[dch]}`);
  const car = buildProfile('car');
  const cch = car.throttleChannels[0];
  ok('car failsafe throttle = center (stop)', profileFailsafeUs(car)[cch] === 1500);
  const plane = buildProfile('plane');
  const pch = plane.throttleChannels[0];
  ok('plane failsafe throttle = min', profileFailsafeUs(plane)[pch] === 1000);
  // endpoints change must NOT clobber failsafe
  const droneEp = applyEndpoints(drone, { minUs: 1100, maxUs: 1900 });
  ok('applyEndpoints keeps drone failsafe', droneEp.bindings.find((b) => b.channel === dch)?.shaping.failsafeUs === 1500);

  // ---- templates: method switch preserves channels + detents ----
  const planeGp = rebuildForMethod(plane, 'gamepad');
  ok('method switch keeps throttle channel', planeGp.throttleChannels[0] === pch);
  ok('plane throttle detent free', currentDetents(plane).leftY === 'free');
  const planeLow = setDetent(plane, 'leftY', 'low');
  ok('setDetent low', currentDetents(planeLow).leftY === 'low');

  // ---- camera source per encoder ----
  const cam: CameraCfg = { name: 'test', type: 'sim', width: 640, height: 480, fps: 20 };
  ok('libx264 source', cameraSource(cam, 'libx264').includes('-c:v libx264'));
  ok('libopenh264 source', cameraSource(cam, 'libopenh264').includes('libopenh264'));
  ok('rpicam uses libcamera', cameraSource({ ...cam, type: 'rpicam' }).includes('libcamera-vid'));

  // ---- video quality scaling ----
  const big: CameraCfg = { name: 'c', type: 'sim', width: 1280, height: 720, fps: 30, bitrateKbps: 2500 };
  ok('quality high keeps size', scaleCamera(big, 'high').width === 1280);
  ok('quality low shrinks + caps bitrate', scaleCamera(big, 'low').width === 640 && scaleCamera(big, 'low').bitrateKbps === 600);
  ok('quality medium even dims', scaleCamera(big, 'medium').width % 2 === 0);

  // ---- binding engine: keyboard throttle with low detent springs to min ----
  const eng = new BindingEngine();
  const pk = rebuildForMethod(planeLow, 'keyboard');
  let ch: number[] = [];
  for (let i = 0; i < 15; i++) ch = eng.compute(pk, snap({}), 100);
  ok('kbd low-throttle springs to min', ch[2] <= 1005, `=${ch[2]}`);

  // ---- report ----
  console.log(`\n${'='.repeat(40)}`);
  console.log(`YonderRC test suite: ${pass} passed, ${fail} failed`);
  if (fail) {
    console.log('\nFailures:');
    for (const f of failures) console.log(`  ✗ ${f}`);
  }
  console.log('='.repeat(40));
  process.exit(fail ? 1 : 0);
}

void main();
