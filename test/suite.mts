/**
 * YonderRC test suite — run with `npm test` (tsx). Consolidates the checks we
 * built incrementally into one repeatable run so future hardware tweaks can't
 * silently regress the safety-critical logic.
 */
import * as C from '../packages/vehicle/src/sensors/convert';
import { TelemetryService } from '../packages/vehicle/src/sensors/TelemetryService';
import { cameraSource, scaleCamera } from '../packages/vehicle/src/video/cameraManager';
import { buildProfile, rebuildForMethod, applyEndpoints, setDetent, currentDetents, applyStickMode, createBinding, nextFreeChannel, funcFromLabel, disarmOnReconnectForType } from '../packages/ground/src/lib/templates';
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

  // ---- battery %: voltage sanity clamp ----
  ok('no voltage curve → coulomb unchanged', C.batteryPercentWithVoltage(100, 3.7, null, null) === 100);
  ok('voltage clamps coulomb down', near(C.batteryPercentWithVoltage(100, 3.75, 4.2, 3.3)!, 50, 0.5), `=${C.batteryPercentWithVoltage(100, 3.75, 4.2, 3.3)}`);
  ok('no coulomb → voltage estimate', C.batteryPercentWithVoltage(null, 4.2, 4.2, 3.3) === 100);
  ok('voltage never inflates coulomb', C.batteryPercentWithVoltage(50, 4.5, 4.2, 3.3) === 50);
  ok('invalid curve (full<=empty) ignored', C.batteryPercentWithVoltage(80, 3.5, 3.3, 3.3) === 80);
  // explicit % source selection + reported source
  ok('mode coulomb uses coulomb', (() => { const r = C.computeBatteryPercent('coulomb', 90, 3.7, 4.2, 3.3); return r.pct === 90 && r.source === 'coulomb'; })());
  ok('mode voltage uses voltage', (() => { const r = C.computeBatteryPercent('voltage', 90, 3.75, 4.2, 3.3); return near(r.pct!, 50, 0.5) && r.source === 'voltage'; })());
  ok('mode voltage w/o curve → null', C.computeBatteryPercent('voltage', 90, 3.7, null, null).pct === null);
  ok('mode clamp reports clamp source', (() => { const r = C.computeBatteryPercent('clamp', 90, 3.75, 4.2, 3.3); return r.source === 'clamp' && near(r.pct!, 50, 0.5); })());
  ok('mode clamp falls back to coulomb', (() => { const r = C.computeBatteryPercent('clamp', 90, 3.7, null, null); return r.pct === 90 && r.source === 'coulomb'; })());

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

  // ---- transport routing: only control frames may use the lossy data channel ----
  const { prefersDataChannel } = await import('../packages/ground/src/lib/transport');
  ok('control prefers data channel', prefersDataChannel('control') === true);
  ok('arm never on data channel (reliable WS)', prefersDataChannel('arm') === false);
  ok('config stays on WS', prefersDataChannel('config') === false);
  ok('hello stays on WS', prefersDataChannel('hello') === false);

  // ---- optional shared secret (off by default, exact match when set) ----
  const { secretOk, readSecretFromUrl } = await import('../packages/vehicle/src/transport/auth');
  ok('secret off (null) → allow', secretOk(null, undefined) === true);
  ok('secret off (empty) → allow', secretOk('', 'whatever') === true);
  ok('secret set + match → allow', secretOk('s3cr3t', 's3cr3t') === true);
  ok('secret set + wrong → deny', secretOk('s3cr3t', 'nope') === false);
  ok('secret set + missing → deny', secretOk('s3cr3t', undefined) === false);
  ok('readSecretFromUrl parses query', readSecretFromUrl('/?secret=abc') === 'abc');
  ok('readSecretFromUrl none → null', readSecretFromUrl('/') === null);
  const { withSecret, setupUrlFromWs } = await import('../packages/ground/src/lib/transport');
  ok('withSecret off → unchanged', withSecret('ws://h:8080', '') === 'ws://h:8080');
  ok('withSecret appends encoded', withSecret('ws://h:8080', 'a b') === 'ws://h:8080?secret=a%20b');
  ok('withSecret respects existing query', withSecret('ws://h:8080?x=1', 'a') === 'ws://h:8080?x=1&secret=a');
  ok('setupUrl from ws', setupUrlFromWs('ws://localhost:8080') === 'http://localhost:8080/setup');
  ok('setupUrl from tailscale ws', setupUrlFromWs('ws://100.64.0.1:8080') === 'http://100.64.0.1:8080/setup');
  ok('setupUrl wss → https', setupUrlFromWs('wss://host:8080') === 'https://host:8080/setup');

  // ---- remote access: pure validators + redaction + sim transitions ----
  const RA = await import('../packages/vehicle/src/system/SystemManager');
  ok('zerotier id valid', RA.isZerotierNetworkId('8056c2e21c000001') === true);
  ok('zerotier id rejects junk', RA.isZerotierNetworkId('nope') === false);
  const wgConf = '[Interface]\nPrivateKey = abc=\nAddress = 192.168.178.2/24\n[Peer]\nPublicKey = def=\nEndpoint = home.myfritz.net:51820\nAllowedIPs = 0.0.0.0/0';
  ok('wg conf recognised', RA.looksLikeWireguardConf(wgConf) === true);
  ok('wg conf rejects non-conf', RA.looksLikeWireguardConf('hello world') === false);
  ok('wg conf normalises CRLF', RA.normaliseWireguardConf('a\r\nb\r\n') === 'a\nb\n');
  const red = RA.redactRemoteConfig({ kind: 'wireguard', wireguardConf: 'secret', tailscaleAuthKey: 'tskey', zerotierNetworkId: '8056c2e21c000001' });
  ok('redact hides secrets', !('wireguardConf' in red) && !('tailscaleAuthKey' in red) && red.hasWireguardConf === true && red.hasTailscaleAuthKey === true && red.zerotierNetworkId === '8056c2e21c000001');
  const { SimSystem } = await import('../packages/vehicle/src/system/SimSystem');
  const sys = new SimSystem();
  const ztUp = await sys.remoteUp({ kind: 'zerotier', zerotierNetworkId: '8056c2e21c000001' });
  ok('sim zerotier up ok', ztUp.ok === true);
  const ztSt = await sys.remoteStatus({ kind: 'zerotier', zerotierNetworkId: '8056c2e21c000001' });
  ok('sim zerotier running', ztSt.kind === 'zerotier' && ztSt.running === true && ztSt.address !== null);
  const wgUp = await sys.remoteUp({ kind: 'wireguard', wireguardConf: wgConf });
  ok('sim wireguard up ok', wgUp.ok === true);
  ok('sim wireguard needs conf', (await sys.remoteUp({ kind: 'wireguard' })).ok === false);
  const ztDown = await sys.remoteDown({ kind: 'zerotier', zerotierNetworkId: '8056c2e21c000001' });
  ok('sim remote down ok', ztDown.ok === true);

  // ---- LTE: mmcli parsing + secret redaction + sim dial ----
  const LTE = await import('../packages/vehicle/src/system/lte');
  const mmA = [
    '  Hardware |          model: Quectel EG25-G',
    '  Status   |          state: registered',
    '           |    power state: on',
    '           | signal quality: 71% (recent)',
    '  3GPP     |  operator name: Telekom.de',
  ].join('\n');
  const iA = LTE.parseModemInfo(mmA);
  ok('mmcli state parsed (not power state)', iA.state === 'registered', `=${iA.state}`);
  ok('mmcli operator parsed', iA.operator === 'Telekom.de', `=${iA.operator}`);
  ok('mmcli signal parsed', iA.signal === 71);
  ok('mmcli model parsed', iA.model === 'Quectel EG25-G', `=${iA.model}`);
  ok('mmcli no pin needed', iA.pinRequired === false);
  const mmB = '  Status   |          state: locked\n           | unlock required: sim-pin';
  ok('mmcli pin required', LTE.parseModemInfo(mmB).pinRequired === true);
  ok('mmcli modem id', LTE.parseModemId('  /org/freedesktop/ModemManager1/Modem/2 [Quectel]') === '2');
  const rl = LTE.redactLteConfig({ apn: 'internet', pin: '1234', username: 'u', password: 'p' });
  ok('lte redact hides pin+pass', !('pin' in rl) && !('password' in rl) && rl.hasPin === true && rl.hasPassword === true && rl.apn === 'internet' && rl.username === 'u');
  const lteUp = await sys.lteConnect({ apn: 'internet', pin: '1234' });
  ok('sim lte connect ok', lteUp.ok === true);
  ok('sim lte 4g-only mode', (await sys.lteConnect({ apn: 'i', networkMode: '4g' })).message.includes('[4g]'));
  ok('sim lte home-only', (await sys.lteConnect({ apn: 'i', allowRoaming: false })).message.includes('home-only'));
  ok('parse sim id', LTE.parseSimId('  System | primary sim path: /org/freedesktop/ModemManager1/SIM/0') === '0');
  ok('valid pin 4-8 digits', LTE.isValidPin('1234') === true && LTE.isValidPin('12') === false && LTE.isValidPin('abcd') === false);
  ok('redact includes mode+roaming', (() => { const r = LTE.redactLteConfig({ apn: 'i', networkMode: '4g', allowRoaming: false }); return r.networkMode === '4g' && r.allowRoaming === false; })());
  ok('sim pin change ok', (await sys.lteSetPin({ action: 'change', currentPin: '1234', newPin: '4321' })).ok === true);
  ok('sim pin remove ok', (await sys.lteSetPin({ action: 'disable', currentPin: '1234' })).message.toLowerCase().includes('removed'));
  ok('sim lte diagnostics', (await sys.lteDiagnostics()).output.includes('mmcli -m 0'));

  // ---- link signal (WiFi dBm → quality) + hardware detection parsing ----
  const SIG = await import('../packages/vehicle/src/system/signal');
  ok('wifi dbm parsed', SIG.parseWifiSignalDbm('  signal: -58 dBm\n  rx bitrate: 65 MBit/s') === -58);
  ok('wifi dbm none', SIG.parseWifiSignalDbm('Not connected.') === null);
  ok('dbm→quality mid', SIG.dbmToQualityPct(-75) === 50);
  ok('dbm→quality clamp hi', SIG.dbmToQualityPct(-40) === 100);
  ok('dbm→quality clamp lo', SIG.dbmToQualityPct(-120) === 0);
  const link = await sys.linkSignal();
  ok('sim link signal has label+quality', typeof link.label === 'string' && (link.quality === null || typeof link.quality === 'number'));
  const DET = await import('../packages/vehicle/src/system/detect');
  const i2cSample = [
    '     0  1  2  3  4  5  6  7  8  9  a  b  c  d  e  f',
    '00:                         -- -- -- -- -- -- -- --',
    '40: 40 41 -- -- -- -- -- -- 48 -- -- -- -- -- -- --',
    '70: -- -- -- -- -- -- -- --',
  ].join('\n');
  const addrs = DET.parseI2cAddresses(i2cSample);
  ok('i2c addresses parsed', addrs.length === 3 && addrs[0] === 0x40 && addrs[1] === 0x41 && addrs[2] === 0x48, `=${addrs.map((a) => a.toString(16))}`);
  const sugg = DET.suggestI2c(addrs);
  ok('i2c suggest PCA9685 @0x40', sugg[0].address === '0x40' && /PCA9685/.test(sugg[0].hint));
  ok('i2c suggest ADS @0x48', sugg[2].hint.includes('ADS'));
  ok('sim detect finds 0x40', (await sys.detectHardware()).i2c.some((x) => x.address === '0x40'));
  ok('sim detect lists serial', (await sys.detectHardware()).serial.length > 0);

  // ---- GPS: NMEA parsing + geo (distance/bearing) + sim service + home ----
  const { parseNmea, nmeaChecksumOk } = await import('../packages/vehicle/src/sensors/nmea');
  const { distanceMeters, bearingDeg } = await import('../packages/protocol/src/types/gps');
  // Real GGA/RMC/GSA lines (checksums valid).
  const gga = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';
  const rmc = '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A';
  const gsa = '$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39';
  ok('nmea checksum ok', nmeaChecksumOk(gga) === true);
  ok('nmea checksum bad', nmeaChecksumOk('$GPGGA,123519,4807.038,N*00') === false);
  const nf = parseNmea([gga, rmc, gsa].join('\n'));
  ok('nmea lat parsed', near(nf.lat!, 48.1173, 1e-3), `=${nf.lat}`);
  ok('nmea lon parsed', near(nf.lon!, 11.5167, 1e-3), `=${nf.lon}`);
  ok('nmea sats + fix', nf.satellites === 8 && nf.hasFix === true && nf.fixType === '3d');
  ok('nmea altitude', near(nf.altM!, 545.4, 0.1));
  ok('nmea speed m/s', nf.speedMs != null && nf.speedMs > 0);
  ok('nmea garbage ignored', parseNmea('hello\n$GPXXX,bad').hasFix === false);
  // Geo: ~157 km between two points 1° apart in latitude near the equator... use known pair.
  ok('distance ~1.11km per 0.01°', near(distanceMeters(52.0, 13.0, 52.01, 13.0), 1112, 5), `=${Math.round(distanceMeters(52.0, 13.0, 52.01, 13.0))}`);
  ok('bearing north', Math.abs(bearingDeg(52.0, 13.0, 52.1, 13.0) - 0) < 1);
  ok('bearing east', Math.abs(bearingDeg(52.0, 13.0, 52.0, 13.1) - 90) < 1);
  const { GpsService } = await import('../packages/vehicle/src/sensors/GpsService');
  const gsvc = new GpsService({ source: 'sim', autoHome: true, minSats: 4, home: null });
  await gsvc.start();
  await new Promise((r) => setTimeout(r, 1200));
  const gm = gsvc.message;
  ok('sim gps emits fix over time', gm.type === 'gps' && gm.lat != null);
  const setHome = gsvc.setHomeNow();
  ok('gps set home returns point', setHome != null && typeof setHome.lat === 'number');
  ok('gps message carries home', gsvc.message.home != null);
  gsvc.clearHome();
  ok('gps clear home', gsvc.message.home === null);
  await gsvc.stop();

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
  // auto-disarm on reconnect is coupled to vehicle type (aircraft = OFF)
  ok('car auto-disarm on reconnect', disarmOnReconnectForType('car') === true);
  ok('boat auto-disarm on reconnect', disarmOnReconnectForType('boat') === true);
  ok('plane NO auto-disarm (motors)', disarmOnReconnectForType('plane') === false);
  ok('drone NO auto-disarm (motors)', disarmOnReconnectForType('drone') === false);
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

  // ---- camera name / device sanitisation (no YAML break, no shell injection) ----
  const { safeStreamName, generateGo2rtcYaml } = await import('../packages/vehicle/src/video/cameraManager');
  ok('safeStreamName charset only', /^[A-Za-z0-9_-]+$/.test(safeStreamName('cam 1: $(reboot)')));
  ok('safeStreamName empty → cam', safeStreamName('') === 'cam');
  const evilCam: CameraCfg = { name: 'bad name!', type: 'usb', device: '/dev/video0; rm -rf /', width: 1281, height: 721, fps: 30 };
  const evilSrc = cameraSource(evilCam, 'libx264');
  ok('device injection neutralised', !evilSrc.includes('rm -rf') && evilSrc.includes('-i /dev/video0 '));
  const dims = evilSrc.match(/-video_size (\d+)x(\d+)/);
  ok('usb dims coerced even', !!dims && Number(dims[1]) % 2 === 0 && Number(dims[2]) % 2 === 0);
  ok('yaml stream key sanitised', /\n {2}bad_name:/.test(generateGo2rtcYaml([{ name: 'bad name!', type: 'sim', width: 320, height: 240, fps: 10 }], 'libx264')));

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
  // Detents follow the CHANNEL, not the stick axis, across a mode + method change.
  const pMode1 = applyStickMode(buildProfile('plane'), 1); // throttle→rightY, elevator→leftY
  const pRebuilt = rebuildForMethod(pMode1, 'keyboard');
  ok('detent follows channel: throttle stays free', pRebuilt.bindings.find((b) => b.channel === pRebuilt.throttleChannels[0])?.detent === 'free', `=${pRebuilt.bindings.find((b) => b.channel === pRebuilt.throttleChannels[0])?.detent}`);
  ok('detent follows channel: elevator stays center', pRebuilt.bindings.find((b) => b.channel === 1)?.detent === 'center');

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
  const mahCfg = { ...auto, useMah: true, mahThreshold: 1800, usePct: false };
  ok('mAh threshold triggers', evaluateBattery(mahCfg, mk({ mah: 1850 })).low === true);
  ok('mAh below threshold ok', evaluateBattery(mahCfg, mk({ mah: 1000 })).low === false);

  // ---- blackbox log CSV ----
  const { logToCsv } = await import('../packages/ground/src/lib/logger');
  const csv = logToCsv([{ t: 0, armed: 1, failsafe: 0, link: 'connected', rtt: 40, bitrate: 2500, loss: 0.5, fps: 30, vlat: 120, volt: 12.1, amp: 3.2, mah: 150, pct: 88 }]);
  ok('csv has header + row', csv.split('\n').length === 2 && csv.includes('t_ms,armed'));
  ok('csv null renders empty', logToCsv([{ t: 5, armed: 0, failsafe: 0, link: 'connected', rtt: null, bitrate: null, loss: null, fps: null, vlat: null, volt: null, amp: null, mah: null, pct: null }]).split('\n')[1] === '5,0,0,connected,,,,,,,,,');

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
