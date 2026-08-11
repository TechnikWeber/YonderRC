/**
 * YonderRC test suite — run with `npm test` (tsx). Consolidates the checks we
 * built incrementally into one repeatable run so future hardware tweaks can't
 * silently regress the safety-critical logic.
 */
import * as C from '../packages/vehicle/src/sensors/convert';
import { TelemetryService } from '../packages/vehicle/src/sensors/TelemetryService';
import { cameraSource, scaleCamera } from '../packages/vehicle/src/video/cameraManager';
import { buildProfile, rebuildForMethod, applyEndpoints, setDetent, currentDetents, applyStickMode, createBinding, nextFreeChannel, funcFromLabel } from '../packages/ground/src/lib/templates';
import { profileFailsafeUs, profileDisarmedUs } from '../packages/ground/src/lib/profiles';
import { BindingEngine, type InputSnapshot } from '../packages/ground/src/lib/input/bindingEngine';
import { autoQualityStep, AUTO_DEFAULTS } from '../packages/ground/src/lib/autoQuality';
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

  // ---- extended endpoint range (500..2500) ----
  const { clampChannelUs } = await import('../packages/protocol/src/channels');
  ok('clamp allows 500', clampChannelUs(400) === 500, `=${clampChannelUs(400)}`);
  ok('clamp allows 2500', clampChannelUs(2600) === 2500, `=${clampChannelUs(2600)}`);
  ok('clamp keeps nominal', clampChannelUs(1500) === 1500);

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

  // ---- auto video quality (hysteresis) ----
  const acfg = AUTO_DEFAULTS;
  // Sustained loss steps down after downHoldS ticks.
  let lvl: 'low' | 'medium' | 'high' = 'high';
  let stt = { bad: 0, good: 0 };
  for (let i = 0; i < acfg.downHoldS; i++) {
    const r = autoQualityStep(lvl, 10, 100, acfg, stt);
    lvl = r.level;
    stt = r.state;
  }
  ok('auto steps down under loss', lvl === 'medium', `=${lvl}`);
  // A single good sample must NOT immediately step back up (hysteresis).
  const oneGood = autoQualityStep(lvl, 0, 50, acfg, stt);
  ok('auto does not step up instantly', oneGood.changed === false && oneGood.level === 'medium');
  // Sustained good for upHoldS steps up.
  lvl = 'medium';
  stt = { bad: 0, good: 0 };
  for (let i = 0; i < acfg.upHoldS; i++) {
    const r = autoQualityStep(lvl, 0, 50, acfg, stt);
    lvl = r.level;
    stt = r.state;
  }
  ok('auto recovers up when good', lvl === 'high', `=${lvl}`);

  // ---- binding engine: keyboard throttle with low detent springs to min ----
  const eng = new BindingEngine();
  const pk = rebuildForMethod(planeLow, 'keyboard');
  let ch: number[] = [];
  for (let i = 0; i < 15; i++) ch = eng.compute(pk, snap({}), 100);
  ok('kbd low-throttle springs to min', ch[2] <= 1005, `=${ch[2]}`);

  // ---- stick mode 1–4 remapping ----
  const planeM = buildProfile('plane');
  const axOf = (p: typeof planeM, label: string) => p.bindings.find((b) => b.label === label)?.stickAxis;
  ok('plane default mode 2', planeM.stickMode === 2);
  ok('mode2 throttle=leftY', axOf(planeM, 'Throttle') === 'leftY');
  const pm1 = applyStickMode(planeM, 1);
  ok('mode1 throttle=rightY', axOf(pm1, 'Throttle') === 'rightY');
  ok('mode1 elevator=leftY', axOf(pm1, 'Elevator') === 'leftY');
  ok('mode1 element re-derived (touch R stick)', pm1.bindings.find((b) => b.label === 'Throttle')?.element === 'joy:R:y');
  ok('mode survives method switch', rebuildForMethod(pm1, 'gamepad').stickMode === 1 && axOf(rebuildForMethod(pm1, 'gamepad'), 'Throttle') === 'rightY');
  ok('car defaults to mode 1', buildProfile('car').stickMode === 1);
  ok('funcFromLabel maps steering→rudder', funcFromLabel('Steering') === 'rudder');

  // ---- add / remove channels ----
  const carA = buildProfile('car');
  const freeCh = nextFreeChannel(carA);
  ok('nextFreeChannel unused', !carA.bindings.some((b) => b.channel === freeCh));
  const added = { ...carA, bindings: [...carA.bindings, createBinding({ channel: freeCh, source: 'keyboard', element: 'r', mode: 'toggle', label: 'Winch', endpoints: carA.endpoints })] };
  ok('added binding present', added.bindings.some((b) => b.label === 'Winch'));
  const engT = new BindingEngine();
  let a0 = engT.compute(added, snap({}), 50)[freeCh];
  engT.compute(added, snap({ pressed: new Set(['r']), keys: new Set(['r']) }), 50);
  const a1 = engT.compute(added, snap({ keys: new Set(['r']) }), 50)[freeCh];
  ok('toggle flips added channel', a0 !== a1, `${a0}->${a1}`);
  ok('custom channel survives method switch', rebuildForMethod(added, 'gamepad').bindings.some((b) => b.label === 'Winch' && b.element === 'r'));
  const removed2 = { ...added, bindings: added.bindings.filter((b) => b.label !== 'Winch') };
  ok('removed binding gone', !removed2.bindings.some((b) => b.label === 'Winch'));

  // ---- per-channel rest position (hold-ramp / switch) ----
  const { shapeSwitch } = await import('../packages/protocol/src/shaping');
  const sh = added.bindings[0].shaping;
  ok('shapeSwitch off = min by default', shapeSwitch(false, sh) === sh.minUs);
  ok('shapeSwitch off = center rest', shapeSwitch(false, sh, 1500) === 1500);
  const hr = createBinding({ channel: 15, source: 'keyboard', element: 'y', mode: 'hold-ramp', label: 'CH16', endpoints: carA.endpoints, detent: 'center' });
  const hp = { ...carA, bindings: [...carA.bindings, hr] };
  const engH = new BindingEngine();
  ok('hold-ramp center rests at 1500', engH.compute(hp, snap({}), 50)[15] === 1500, `=${engH.compute(hp, snap({}), 50)[15]}`);
  let up = 0;
  for (let i = 0; i < 40; i++) up = engH.compute(hp, snap({ keys: new Set(['y']) }), 50)[15];
  ok('hold-ramp center holds toward max', up > 1900, `=${up}`);

  // ---- pre-arm safety check ----
  const { preArmCheck, throttleSafeUs } = await import('../packages/ground/src/lib/safety');
  const { neutralChannels } = await import('../packages/protocol/src/channels');
  const carP = buildProfile('car'); // throttle detent center → safe at 1500
  const cThr = carP.throttleChannels[0];
  ok('car throttle safe = centre', throttleSafeUs(carP.bindings.find((b) => b.channel === cThr)) === 1500);
  ok('car arms at centre throttle', preArmCheck(carP, neutralChannels()).ok);
  const pushed = neutralChannels();
  pushed[cThr] = 2000;
  ok('car blocked with throttle up', !preArmCheck(carP, pushed).ok);
  const planeP = buildProfile('plane'); // throttle detent free → safe at min
  const pThr = planeP.throttleChannels[0];
  ok('plane throttle safe = min', throttleSafeUs(planeP.bindings.find((b) => b.channel === pThr)) === 1000);
  ok('plane blocked at centre throttle', !preArmCheck(planeP, neutralChannels()).ok);
  const low = neutralChannels();
  low[pThr] = 1000;
  ok('plane arms at idle throttle', preArmCheck(planeP, low).ok);

  // ---- low-battery warning ----
  const { evaluateBattery, BATTERY_DEFAULTS } = await import('../packages/ground/src/lib/battery');
  const mk = (over: Partial<import('@yonderrc/protocol').TelemetryMessage>): import('@yonderrc/protocol').TelemetryMessage => ({
    type: 'telemetry', source: 'real', ok: true, voltages: [{ label: 'V', value: 12 }], currents: [], mah: 0, wh: 0, capacityMah: 2200, batteryPercent: 80, displayMode: 'remaining', ...over,
  });
  const auto = { ...BATTERY_DEFAULTS };
  ok('auto inactive in sim', evaluateBattery(auto, mk({ source: 'sim' })).active === false);
  ok('auto active with real sensor', evaluateBattery(auto, mk({})).active === true);
  ok('not low at 80%', evaluateBattery(auto, mk({ batteryPercent: 80 })).low === false);
  ok('low at 15%', evaluateBattery(auto, mk({ batteryPercent: 15 })).low === true);
  ok('off mode never warns', evaluateBattery({ ...auto, mode: 'off' }, mk({ batteryPercent: 5 })).low === false);
  const volt = { ...auto, useVolt: true, voltThreshold: 10.5, usePct: false };
  ok('voltage threshold triggers', evaluateBattery(volt, mk({ voltages: [{ label: 'V', value: 10.2 }] })).low === true);
  ok('voltage ok above threshold', evaluateBattery(volt, mk({ voltages: [{ label: 'V', value: 11.5 }] })).low === false);

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
