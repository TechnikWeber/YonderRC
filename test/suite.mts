/**
 * YonderRC test suite — run with `npm test` (tsx). Consolidates the checks we
 * built incrementally into one repeatable run so future hardware tweaks can't
 * silently regress the safety-critical logic.
 */
import * as C from '../packages/vehicle/src/sensors/convert';
import { TelemetryService } from '../packages/vehicle/src/sensors/TelemetryService';
import { cameraSource, scaleCamera } from '../packages/vehicle/src/video/cameraManager';
import { buildProfile, rebuildForMethod, applyEndpoints, setDetent, currentDetents, applyStickMode, createBinding, nextFreeChannel, funcFromLabel, disarmOnReconnectForType, failsafeStickPosition, throttleFailsafeRisk } from '../packages/ground/src/lib/templates';
import { profileFailsafeUs, profileDisarmedUs } from '../packages/ground/src/lib/profiles';
import { BindingEngine, type InputSnapshot } from '../packages/ground/src/lib/input/bindingEngine';
import { autoQualityStep, AUTO_DEFAULTS } from '../packages/ground/src/lib/autoQuality';
import type { TelemetryConfig, CameraCfg } from '@yonderrc/protocol';
import { readFileSync } from 'node:fs';

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

  // INA228: 20-bit registers are left-aligned in 24 bits, so every raw value here
  // is the datasheet code << 4.
  ok('ina228 bus 12V', near(C.ina228BusVolts(Math.round(12 / 195.3125e-6) << 4), 12, 1e-4));
  ok('ina228 shunt 10 mV', near(C.ina228ShuntVolts(Math.round(0.01 / 312.5e-9) << 4), 0.01, 1e-9));
  ok('ina228 low range 4x finer', near(C.ina228ShuntVolts(0x10 << 4, true), 16 * 78.125e-9, 1e-12));
  ok('ina228 negative shunt', C.ina228ShuntVolts(0xfffff << 4) < 0);
  ok('ina228 10A over 1 mΩ', near(C.ina228Amps(Math.round(0.01 / 312.5e-9) << 4, 0.001), 10, 1e-6));
  const lsb228 = C.ina228CurrentLsb(50); // 50 A / 2^19
  ok('ina228 current LSB', near(lsb228, 50 / 524288));
  // SHUNT_CAL = 13107.2e6 × LSB × R  → 50 A, 1 mΩ: 13107.2e6 × 9.5367e-5 × 0.001
  ok('ina228 shunt cal', C.ina228ShuntCal(lsb228, 0.001) === 1250);
  ok('ina228 shunt cal x4 in low range', C.ina228ShuntCal(lsb228, 0.001, true) === 5000);
  ok('ina228 shunt cal clamps to 15 bit', C.ina228ShuntCal(lsb228, 1) === 0x7fff);
  // 1 A for 1 h = 3600 C = 1000 mAh; charge counts in CURRENT_LSB steps.
  ok('ina228 charge 1000 mAh', near(C.ina228ChargeMah(Math.round(3600 / lsb228), lsb228), 1000, 0.01));
  ok('ina228 charge signed (regen)', C.ina228ChargeMah(0xffffffffff, lsb228) < 0);
  // ENERGY LSB = 16 × 3.2 × CURRENT_LSB joules; 3600 J = 1 Wh.
  ok('ina228 energy 1 Wh', near(C.ina228EnergyWh(Math.round(3600 / (16 * 3.2 * lsb228)), lsb228), 1, 0.01));
  ok('ina228 die temp', near(C.ina228TempC(0x0800), 16, 1e-9));

  // INA237/238: same registers, 16-bit, no charge counter.
  ok('ina238 bus 12V', near(C.ina238BusVolts(3840), 12));
  ok('ina238 shunt 10 mV', near(C.ina238ShuntVolts(2000), 0.01, 1e-9));
  ok('ina238 low range', near(C.ina238ShuntVolts(2000, true), 0.0025, 1e-9));
  ok('ina238 10A over 1 mΩ', near(C.ina238Amps(2000, 0.001), 10, 1e-6));
  const lsb238 = C.ina238CurrentLsb(50);
  ok('ina238 current LSB', near(lsb238, 50 / 32768));
  ok('ina238 shunt cal', C.ina238ShuntCal(lsb238, 0.001) === 1250);
  // INA238 keeps its 12-bit temperature in bits 15:4 → 128 codes × 125 m°C = 16 °C.
  ok('ina238 die temp', near(C.ina238TempC(128 << 4), 16, 1e-9));
  ok('ina238 die temp negative', C.ina238TempC(0xf800) < 0);

  // ---- temperature sensors ----
  ok('pi thermal 47.8 °C', near(C.piThermalC('47774\n')!, 47.774));
  ok('pi thermal garbage → null', C.piThermalC('n/a') === null);
  ok('ds18b20 parses t=', near(C.ds18b20C('aa bb : crc=5c YES\n aa bb t=23125')!, 23.125));
  ok('ds18b20 bad crc → null', C.ds18b20C('aa bb : crc=5c NO\n aa bb t=23125') === null);
  ok('ds18b20 power-on 85 °C → null', C.ds18b20C('crc=5c YES t=85000') === null);
  ok('ds18b20 negative', near(C.ds18b20C('crc=aa YES t=-10625')!, -10.625));
  ok('mcp9808 +25.25', near(C.mcp9808C(0x0194), 25.25));
  ok('mcp9808 negative', near(C.mcp9808C(0x1f9c), -6.25)); // 13-bit two's complement
  ok('tmp102 +25', near(C.tmp102C(0x1900), 25));
  ok('tmp102 negative', C.tmp102C(0xe700) < 0);
  ok('tmp117 +25', near(C.tmp117C(3200), 25));
  // BMP280 datasheet worked example: adc_T 519888 with T1..T3 = 27504/26435/-1000.
  ok('bmp280 compensation', Math.abs(C.bmp280TempC(519888, 27504, 26435, -1000) - 25.08) < 0.05);
  ok('max6675 +25', near(C.max6675C(100 << 3)!, 25));
  ok('max6675 open thermocouple → null', C.max6675C((100 << 3) | 0x04) === null);
  ok('max31855 +25', near(C.max31855C(100 << 18)!, 25));
  ok('max31855 fault → null', C.max31855C((100 << 18) | 0x00010000) === null);
  ok('max31855 cold junction', near(C.max31855ColdJunctionC(400 << 4), 25));
  ok('max31856 +25', near(C.max31856C((25 / 0.0078125) << 5), 25));
  ok('max31865 ratio → ohms', near(C.max31865Ohms(16384 << 1, 430)!, 215));
  ok('max31865 fault → null', C.max31865Ohms((16384 << 1) | 1, 430) === null);
  // PT100: 100 Ω = 0 °C, 138.51 Ω = 100 °C, 80.31 Ω = −50 °C.
  ok('pt100 at 0 °C', Math.abs(C.rtdTempC(100, 100)) < 0.01);
  ok('pt100 at 100 °C', Math.abs(C.rtdTempC(138.5055, 100) - 100) < 0.05);
  ok('pt100 sub-zero', Math.abs(C.rtdTempC(80.31, 100) + 50) < 0.1);
  ok('pt1000 scales', Math.abs(C.rtdTempC(1385.055, 1000) - 100) < 0.05);
  // NTC: at R25 the beta equation must return exactly 25 °C.
  ok('ntc at r25 = 25 °C', Math.abs(C.ntcTempC(10000)! - 25) < 1e-9);
  ok('ntc hotter = lower R', C.ntcTempC(4000)! > 25 && C.ntcTempC(20000)! < 25);
  ok('ntc nonsense → null', C.ntcTempC(0) === null);
  // Divider: probe to GND, half the excitation ⇒ probe equals the series resistor.
  ok('divider half = series', near(C.dividerOhms(1.65, 3.3, 10000)!, 10000));
  ok('divider high side', near(C.dividerOhms(1.65, 3.3, 10000, false)!, 10000));
  ok('divider out of range → null', C.dividerOhms(3.3, 3.3, 10000) === null);

  // ---- which channel drives the battery maths ----
  const { primaryIndex, primaryVoltage, primaryCurrent, readingKey } = await import('../packages/protocol/src/telemetry');
  ok('no flag → first channel', primaryIndex([{}, {}]) === 0);
  ok('flag wins', primaryIndex([{}, { primary: true }, {}]) === 1);
  ok('empty list → 0', primaryIndex([]) === 0);
  const tm2 = {
    type: 'telemetry', source: 'sim', ok: true,
    voltages: [{ label: 'BEC', value: 5.1 }, { label: 'Pack', value: 16.4 }],
    currents: [{ label: 'I1', value: 9 }],
    primaryVoltage: 1, mah: 0, wh: 0, capacityMah: null, batteryPercent: null, displayMode: 'remaining',
  } as import('@yonderrc/protocol').TelemetryMessage;
  ok('message points at the pack', primaryVoltage(tm2)?.value === 16.4);
  ok('current falls back to index 0', primaryCurrent(tm2)?.label === 'I1');
  ok('no channels → null', primaryVoltage({ ...tm2, voltages: [] }) === null);
  ok('reading key uses the label', readingKey('t', 'Motor', 3) === 't:Motor');
  ok('reading key falls back to the index', readingKey('v', '  ', 2) === 'v:2');

  // Who counts the charge: only the INA228 has the hardware accumulator.
  ok('ina228 has a counter', C.hasHardwareCounter('ina228'));
  ok('ina238 has none', !C.hasHardwareCounter('ina238') && !C.hasHardwareCounter('ina226'));
  ok('auto uses the sensor when present', C.resolveChargeSource('auto', true) === 'sensor');
  ok('auto falls back to the Pi', C.resolveChargeSource('auto', false) === 'pi');
  ok('sensor request degrades to Pi', C.resolveChargeSource('sensor', false) === 'pi');
  ok('pi stays on the Pi', C.resolveChargeSource('pi', true) === 'pi');
  ok('undefined behaves like auto', C.resolveChargeSource(undefined, true) === 'sensor');
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

  // ---- INA228: the sensor counts, the service only reads it ----
  // The sim reader emulates the chip's CHARGE/ENERGY registers, so the whole
  // service path (auto → sensor, reset clears it) runs without hardware. The I²C
  // register access itself can only be proven on a Pi.
  const hwCfg: TelemetryConfig = {
    ...tcfg,
    currents: [{ label: 'I1', kind: 'ina228', shuntOhms: 0.001, maxCurrentA: 50 }],
    chargeSource: 'auto',
  };
  const hwSvc = new TelemetryService(hwCfg);
  await hwSvc.start();
  await new Promise((r) => setTimeout(r, 300));
  const hm = hwSvc.message!;
  ok('ina228 → charge from the sensor', hm.chargeFrom === 'sensor');
  ok('sensor counter accumulates', hm.mah > 0, `=${hm.mah}`);
  await hwSvc.resetCapacity();
  await new Promise((r) => setTimeout(r, 120));
  ok('reset clears the sensor counter', hwSvc.message!.mah < hm.mah, `=${hwSvc.message!.mah}`);
  await hwSvc.stop();

  // ---- primary channel + temperatures end-to-end through the service ----
  const multiCfg: TelemetryConfig = {
    ...tcfg,
    // The sim puts the pack on index 0 and a half-voltage rail on index 1, so
    // flagging the rail is a clean discriminator: the % must follow the flag.
    voltages: [{ label: 'Pack', kind: 'sim' }, { label: 'BEC', kind: 'sim', primary: true }],
    currents: [{ label: 'I1', kind: 'sim' }],
    temperatures: [{ label: 'Motor', kind: 'sim' }, { label: 'ESC', kind: 'sim' }],
    percentSource: 'voltage',
    voltageFullV: 16.8,
    voltageEmptyV: 13.2,
  };
  const multi = new TelemetryService(multiCfg);
  await multi.start();
  await new Promise((r) => setTimeout(r, 200));
  const mm = multi.message!;
  ok('primary index is reported', mm.primaryVoltage === 1 && mm.primaryCurrent === 0);
  ok('battery % follows the flag (rail → empty)', mm.batteryPercent === 0, `=${mm.batteryPercent}`);
  ok('temperatures are reported with labels', mm.temperatures?.length === 2 && mm.temperatures[0].label === 'Motor');
  ok('temperatures are plausible', (mm.temperatures?.[0].value ?? 0) > 20 && (mm.temperatures?.[0].value ?? 0) < 90);
  await multi.stop();
  // Same pack, flag moved back to the real pack channel → a full battery again.
  const packPrimary = new TelemetryService({
    ...multiCfg,
    voltages: [{ label: 'Pack', kind: 'sim', primary: true }, { label: 'BEC', kind: 'sim' }],
  });
  await packPrimary.start();
  await new Promise((r) => setTimeout(r, 200));
  ok('flag on the pack → full', (packPrimary.message!.batteryPercent ?? 0) > 50, `=${packPrimary.message!.batteryPercent}`);
  await packPrimary.stop();

  // Same config forced onto the Pi, and a chip without a counter.
  const piSvc = new TelemetryService({ ...hwCfg, chargeSource: 'pi' });
  await piSvc.start();
  await new Promise((r) => setTimeout(r, 200));
  ok('forced pi integration', piSvc.message!.chargeFrom === 'pi' && piSvc.message!.mah > 0);
  await piSvc.stop();
  const noCounter = new TelemetryService({ ...hwCfg, currents: [{ label: 'I1', kind: 'ina238', shuntOhms: 0.001 }], chargeSource: 'sensor' });
  await noCounter.start();
  await new Promise((r) => setTimeout(r, 200));
  ok('ina238 falls back to pi counting', noCounter.message!.chargeFrom === 'pi' && noCounter.message!.mah > 0);
  await noCounter.stop();

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
  // ---- where a request came FROM (the gap the secret does not close) ----
  // The secret is off by default and WebSockets ignore CORS, so without this any
  // page the operator opens could arm a vehicle on their own network.
  const { isLocalOrigin, originAllowed } = await import('../packages/vehicle/src/transport/auth');
  ok('the vehicle\'s own page is local', isLocalOrigin('http://192.168.4.1:8080') === true);
  ok('a laptop on the LAN is local', isLocalOrigin('http://192.168.1.50:5173') === true);
  ok('so is 10/8 and 172.16/12', isLocalOrigin('http://10.0.0.9') === true && isLocalOrigin('http://172.20.1.1') === true);
  ok('but 172.32 is not private', isLocalOrigin('http://172.32.0.1') === false);
  ok('localhost and ::1 are local', isLocalOrigin('http://localhost:5173') === true && isLocalOrigin('http://[::1]:5173') === true);
  ok('a tailnet address is local', isLocalOrigin('http://100.101.102.103:8080') === true);
  ok('the packaged desktop app is local', isLocalOrigin('file://') === true);
  ok('a .local name is local', isLocalOrigin('http://yonderrc.local:8080') === true);
  ok('a page from the internet is not', isLocalOrigin('https://evil.example') === false);
  // DNS rebinding keeps the attacker's origin even once the name points at the Pi.
  ok('nor is it after it resolves to the Pi', isLocalOrigin('https://rebind.evil.example') === false);
  ok('a sandboxed frame ("null") is not local', isLocalOrigin('null') === false);
  ok('no Origin at all → not a browser → allowed', originAllowed(undefined, false) === true);
  ok('a foreign origin is refused', originAllowed('https://evil.example', false) === false);
  ok('unless it proves intent with the secret', originAllowed('https://evil.example', true) === true);
  ok('a local origin needs no secret', originAllowed('http://192.168.4.1:8080', false) === true);
  // An <img> or a <script> carries no Origin at all, so Origin alone would wave it
  // through; Sec-Fetch-Site is sent on every request and does not.
  ok('a cross-site fetch with no Origin is refused', originAllowed(undefined, false, undefined, 'cross-site') === false);
  ok('same-origin is fine', originAllowed(undefined, false, undefined, 'same-origin') === true);
  ok('and so is typing the address in', originAllowed(undefined, false, undefined, 'none') === true);
  // A vehicle reached over a public hostname serves its own setup page from that
  // hostname — refusing it would break the very page the operator is looking at.
  ok('the page the vehicle served itself is allowed', originAllowed('https://my-boat.example', false, 'my-boat.example') === true);
  ok('a different public page still is not', originAllowed('https://evil.example', false, 'my-boat.example') === false);
  ok('and the dev ground on another port counts as same host', originAllowed('http://192.168.1.50:5173', false, '192.168.1.50:8080') === true);

  // A deliberate close must not be retried: two grounds trading the vehicle every
  // second is worse than one of them plainly stopping.
  const { closeReason } = await import('../packages/ground/src/lib/transport');
  ok('takeover explains itself', closeReason(4002).includes('took over'));
  ok('a refused origin says what to do', closeReason(4003).includes('API secret'));

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
  // ---- WireGuard set up by hand ----
  // The upload path stays; this is the other half, for a peer that came as a page of
  // values rather than a file. One stored representation (the .conf) either way, so the
  // two cannot drift apart.
  const WG = await import('../packages/vehicle/src/system/wireguard');
  // Real-shaped keys: 32 bytes of base64, which is 43 characters and a '='.
  const KEY_A = '4k9IqqA4sX3r013U7WoG3R/clIqSHynjMP0qj/w/stw=';
  const KEY_B = 'KpcpI1RB/6lURHP/5Tb84x7wx3H7+iI65kz/cqjvACI=';
  ok('a WireGuard key is recognised', WG.isWireguardKey(KEY_A) && WG.isWireguardKey(KEY_B));
  ok('a truncated key is not', !WG.isWireguardKey(KEY_A.slice(0, 20)));
  ok('an unpadded key is not', !WG.isWireguardKey(KEY_A.slice(0, 43) + 'x'));
  ok('a name endpoint is fine', WG.isEndpoint('vpn.example.org:51820'));
  ok('so is an address', WG.isEndpoint('203.0.113.9:51820'));
  ok('so is a bracketed v6 one', WG.isEndpoint('[2001:db8::1]:51820'));
  ok('a missing port is not', !WG.isEndpoint('vpn.example.org'));
  ok('an impossible port is not', !WG.isEndpoint('vpn.example.org:70000'));
  // People type what their server told them, which is often a bare address.
  ok('a bare v4 address becomes a host route', WG.normaliseCidrList('10.0.0.2') === '10.0.0.2/32');
  ok('a bare v6 address too', WG.normaliseCidrList('fd00::2') === 'fd00::2/128');
  ok('a list keeps its prefixes', WG.normaliseCidrList('0.0.0.0/0, ::/0') === '0.0.0.0/0, ::/0');

  const wgGood = {
    ...WG.WIREGUARD_DEFAULTS,
    privateKey: KEY_A, address: '10.0.0.2/32', peerPublicKey: KEY_B, endpoint: 'vpn.example.org:51820',
  };
  ok('a complete set validates', WG.validateWireguardFields(wgGood) === null, String(WG.validateWireguardFields(wgGood)));
  // Every message has to say what to do about it — this is read on a phone.
  const missingKey = WG.validateWireguardFields({ ...wgGood, privateKey: '' }) ?? '';
  ok('a missing private key names the fix', missingKey.includes('wg genkey'), missingKey);
  ok('but not when one is already stored', WG.validateWireguardFields({ ...wgGood, privateKey: '' }, { keyStored: true }) === null);
  ok('a bad peer key is caught', (WG.validateWireguardFields({ ...wgGood, peerPublicKey: 'nope' }) ?? '').includes('public key'));
  ok('a bad endpoint names the shape', (WG.validateWireguardFields({ ...wgGood, endpoint: 'vpn.example.org' }) ?? '').includes('host:port'));
  ok('a missing address is caught', (WG.validateWireguardFields({ ...wgGood, address: '' }) ?? '').includes('inside the tunnel'));
  ok('a stray preshared key is caught', (WG.validateWireguardFields({ ...wgGood, presharedKey: 'x' }) ?? '').includes('genpsk'));

  const built = WG.buildWireguardConf(wgGood);
  ok('what it builds is a WireGuard conf', WG.looksLikeWireguardConf(built), built);
  ok('the optional lines stay out when empty', !built.includes('DNS') && !built.includes('ListenPort') && !built.includes('PresharedKey'));
  // Behind CGNAT a tunnel without keepalive works until the first idle minute.
  ok('keepalive is there by default', built.includes('PersistentKeepalive = 25'));

  // The round trip is what lets an uploaded file be edited field by field afterwards.
  const back = WG.parseWireguardConf(built);
  ok('a built conf parses back to the same values',
    back.privateKey === KEY_A && back.peerPublicKey === KEY_B && back.endpoint === 'vpn.example.org:51820' && back.address === '10.0.0.2/32',
    JSON.stringify(back));
  // Base64 ends in '=', so splitting a line on every '=' truncates every key in the file.
  ok('a key is not cut at its own padding', back.privateKey.endsWith('='));

  const foreign = [
    '# exported by something else', '[Interface]', 'privatekey=' + KEY_A, 'Address = 10.0.0.9/24',
    'DNS = 10.0.0.1', 'MTU = 1412', '', '[Peer]', 'PublicKey   =   ' + KEY_B,
    'AllowedIPs = 192.168.178.0/24', 'Endpoint = fritz.box:51820', 'PersistentKeepalive = 25',
  ].join('\n');
  const wgParsed = WG.parseWireguardConf(foreign);
  ok('a foreign file parses too', wgParsed.address === '10.0.0.9/24' && wgParsed.dns === '10.0.0.1' && wgParsed.endpoint === 'fritz.box:51820', JSON.stringify(wgParsed));
  ok('lower-case and loose spacing are fine', wgParsed.privateKey === KEY_A && wgParsed.peerPublicKey === KEY_B);
  ok('comments are ignored', !wgParsed.address.includes('#'));
  // Rebuilding that file from the form would drop MTU — say so rather than find out later.
  ok('what the form cannot hold is named', WG.unsupportedWireguardKeys(foreign).includes('MTU'), WG.unsupportedWireguardKeys(foreign).join(','));
  ok('and what it can hold is not', !WG.unsupportedWireguardKeys(foreign).includes('Address'));
  ok('one peer is not several', !WG.hasMultiplePeers(foreign));
  ok('two peers are', WG.hasMultiplePeers(foreign + '\n[Peer]\nPublicKey = ' + KEY_A));

  // The page may fill in everything except the two secrets: /api/remote answers without
  // the API secret, and this box's onboarding hotspot is open by default.
  const pub = WG.redactWireguardFields(wgGood);
  ok('the private key never leaves the box', !('privateKey' in pub) && pub.hasPrivateKey === true);
  ok('nor does a preshared key', !('presharedKey' in pub) && pub.hasPresharedKey === false);
  ok('the rest is there to fill the form', pub.endpoint === 'vpn.example.org:51820' && pub.address === '10.0.0.2/32');

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

  // The disarmed value is DERIVED from the channel's own shaping, not read off the
  // profile endpoints. On a REVERSED throttle the idle stick maps to maxUs, so
  // "off" is 2000 — the flat endpoints.minUs used to command FULL THROTTLE there.
  const reverseThrottle = (p: typeof drone) => ({
    ...p,
    bindings: p.bindings.map((b) =>
      b.channel === p.throttleChannels[0] ? { ...b, shaping: { ...b.shaping, reverse: true } } : b,
    ),
  });
  for (const [type, offUs] of [['drone', 1000], ['plane', 1000], ['car', 1500], ['boat', 1500]] as const) {
    const p = buildProfile(type);
    const ch = p.throttleChannels[0];
    ok(`${type} disarmed throttle = ${offUs} (off)`, profileDisarmedUs(p)[ch] === offUs, `=${profileDisarmedUs(p)[ch]}`);
    const rev = reverseThrottle(p);
    // car/boat sit at centre, which is reverse-symmetric; plane/drone must flip.
    const expect = offUs === 1500 ? 1500 : 2000;
    ok(`${type} reversed throttle disarms to ${expect}`, profileDisarmedUs(rev)[ch] === expect, `=${profileDisarmedUs(rev)[ch]}`);
  }
  // Per-channel endpoints must come from the CHANNEL, not the profile.
  const narrowThrottle = {
    ...drone,
    bindings: drone.bindings.map((b) =>
      b.channel === dch ? { ...b, shaping: { ...b.shaping, minUs: 1100, maxUs: 1900 } } : b,
    ),
  };
  ok('disarmed follows the channel endpoints', profileDisarmedUs(narrowThrottle)[dch] === 1100, `=${profileDisarmedUs(narrowThrottle)[dch]}`);
  // Trim shifts where the resting stick actually lands, so it counts too.
  const trimmed = {
    ...car,
    bindings: car.bindings.map((b) => (b.channel === cch ? { ...b, shaping: { ...b.shaping, trimUs: 40 } } : b)),
  };
  ok('disarmed includes trim', profileDisarmedUs(trimmed)[cch] === 1540, `=${profileDisarmedUs(trimmed)[cch]}`);
  // A stored throttle channel with nothing bound to it must still get a safe value.
  const orphan = { ...drone, bindings: drone.bindings.filter((b) => b.channel !== dch), throttleChannels: [dch] };
  ok('orphaned throttle channel still disarms safe', profileDisarmedUs(orphan)[dch] === 1000, `=${profileDisarmedUs(orphan)[dch]}`);
  // Non-throttle channels are untouched by any of this.
  ok('non-throttle channels stay neutral', profileDisarmedUs(drone).filter((_, i) => i !== dch).every((v) => v === 1500));

  // The failsafe is a RAW µs and never passes through shaping, so on a reversed
  // channel a stored 1000 (seeded as "motor off") silently becomes full throttle.
  const planeThr = plane.bindings.find((b) => b.channel === pch)!.shaping;
  ok('plane failsafe reads as idle', failsafeStickPosition(planeThr) === -1, `=${failsafeStickPosition(planeThr)}`);
  ok('normal plane failsafe raises no warning', throttleFailsafeRisk('plane', planeThr) === null);
  const revThr = { ...planeThr, reverse: true };
  ok('reversed plane failsafe reads as FULL', failsafeStickPosition(revThr) === 1, `=${failsafeStickPosition(revThr)}`);
  const risk = throttleFailsafeRisk('plane', revThr);
  ok('reversed plane failsafe warns', risk !== null);
  ok('warning reports 100% throttle', risk?.percent === 100, `=${risk?.percent}`);
  ok('warning names the safe value', risk?.safeUs === 2000, `=${risk?.safeUs}`);
  // Fixing the value the warning suggests must clear it.
  ok('corrected failsafe clears the warning', throttleFailsafeRisk('plane', { ...revThr, failsafeUs: 2000 }) === null);
  // Centre-failsafe types are reverse-symmetric and must never warn.
  const droneThr = drone.bindings.find((b) => b.channel === dch)!.shaping;
  ok('drone centre failsafe never warns', throttleFailsafeRisk('drone', droneThr) === null
    && throttleFailsafeRisk('drone', { ...droneThr, reverse: true }) === null);
  // A deliberate low cruise-throttle failsafe stays under the threshold.
  ok('low cruise failsafe does not warn', throttleFailsafeRisk('plane', { ...planeThr, failsafeUs: 1300 }) === null);
  ok('but a high one does', throttleFailsafeRisk('plane', { ...planeThr, failsafeUs: 1900 }) !== null);
  // Degenerate endpoints must not divide by zero.
  ok('zero-span channel is inert', failsafeStickPosition({ ...planeThr, minUs: 1500, maxUs: 1500 }) === 0);
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
  const rpi = cameraSource({ ...cam, type: 'rpicam' });
  ok('rpicam uses rpicam-vid by default', rpi.includes('rpicam-vid'));
  // go2rtc runs exec: without a shell — a pipe would be a literal argv, and the
  // stream dies before the first frame. This is what shipped broken until v1.47.0.
  ok('rpicam source has no shell pipe', !rpi.includes('|'));
  ok('rpicam source has no {output}', !rpi.includes('{output}'));
  ok('rpicam writes to stdout', rpi.trimEnd().endsWith('-o -'));
  ok('rpicam honours legacy binary', cameraSource({ ...cam, type: 'rpicam' }, 'libx264', 'libcamera-vid').includes('libcamera-vid'));
  ok(
    'rpicam binary sanitised',
    cameraSource({ ...cam, type: 'rpicam' }, 'libx264', 'rm -rf /').includes('exec:rpicam-vid '),
  );
  ok(
    'rpicam bitrate in bits',
    cameraSource({ ...cam, type: 'rpicam', bitrateKbps: 3000 }).includes('--bitrate 3000000'),
  );

  // ---- rpicam focus / tuning file ----
  const rpiBase: CameraCfg = { ...cam, type: 'rpicam' };
  ok('focus off emits nothing', !cameraSource(rpiBase).includes('--autofocus-mode'));
  ok(
    'focus continuous',
    cameraSource({ ...rpiBase, focus: 'continuous' }).includes('--autofocus-mode continuous'),
  );
  const man = cameraSource({ ...rpiBase, focus: 'manual', lensPosition: 3.5 });
  ok('focus manual carries lens position', man.includes('--autofocus-mode manual --lens-position 3.5'));
  ok(
    'lens position clamped',
    cameraSource({ ...rpiBase, focus: 'manual', lensPosition: -4 }).includes('--lens-position 0'),
  );
  ok(
    'manual without position → infinity',
    cameraSource({ ...rpiBase, focus: 'manual' }).includes('--lens-position 0'),
  );
  ok(
    'tuning file passed through',
    cameraSource({ ...rpiBase, tuningFile: '/var/lib/yonderrc/tuning/imx519-af.json' }).includes(
      '--tuning-file /var/lib/yonderrc/tuning/imx519-af.json',
    ),
  );
  // go2rtc splits exec: on whitespace, so a path with a space would become two args.
  ok(
    'tuning file with space rejected',
    !cameraSource({ ...rpiBase, tuningFile: '/etc/my tuning.json' }).includes('--tuning-file'),
  );
  ok(
    'relative / traversing tuning file rejected',
    !cameraSource({ ...rpiBase, tuningFile: '/var/../etc/shadow.json' }).includes('--tuning-file'),
  );
  ok(
    'non-json tuning file rejected',
    !cameraSource({ ...rpiBase, tuningFile: '/tmp/evil.sh' }).includes('--tuning-file'),
  );
  ok('focus only on rpicam', !cameraSource({ ...cam, type: 'sim', focus: 'auto' }).includes('--autofocus-mode'));

  // ---- CSI camera module (config.txt, pure part) ----
  const bc = await import('../packages/vehicle/src/system/bootConfig');
  const PI_CONFIG = [
    '# Some comments',
    'dtparam=i2c_arm=on',
    'camera_auto_detect=1',
    'dtoverlay=vc4-kms-v3d',
    'max_framebuffers=2',
    '[cm5]',
    'dtoverlay=dwc2,dr_mode=host',
    '[all]',
    'enable_uart=1',
    '',
  ].join('\n');

  ok('parse default is auto-detect', bc.parseBootConfig(PI_CONFIG).autoDetect === true);
  ok('parse finds no camera overlay', bc.parseBootConfig(PI_CONFIG).overlay === null);
  ok('parse maps to the auto module', bc.moduleIdFor(bc.parseBootConfig(PI_CONFIG)) === 'auto');

  const withImx = bc.applyCameraModule(PI_CONFIG, 'imx519');
  ok('apply turns auto-detect off', /\ncamera_auto_detect=0/.test(withImx));
  ok('apply writes the overlay', /\ndtoverlay=imx519\n/.test(withImx));
  ok('apply comments the old auto-detect', withImx.includes('# camera_auto_detect=1  # (replaced by YonderRC)'));
  // The block must land in [all], not in whatever conditional section the file ended in.
  ok('apply opens an [all] section', withImx.slice(withImx.indexOf('--- YonderRC')).includes('[all]'));
  ok('apply leaves foreign overlays alone', withImx.includes('\ndtoverlay=vc4-kms-v3d') && withImx.includes('\ndtoverlay=dwc2,dr_mode=host'));
  ok('round-trip reads back the module', bc.moduleIdFor(bc.parseBootConfig(withImx)) === 'imx519');

  // Switching modules must not stack blocks up.
  const switched = bc.applyCameraModule(withImx, 'arducam-64mp');
  ok('switch leaves one managed block', switched.split('--- YonderRC camera module').length === 2);
  ok('switch drops the old overlay', !/\ndtoverlay=imx519\n/.test(switched));
  ok('switch reads back', bc.moduleIdFor(bc.parseBootConfig(switched)) === 'arducam-64mp');

  const backToAuto = bc.applyCameraModule(switched, null);
  ok('back to auto sets 1', /\ncamera_auto_detect=1/.test(backToAuto));
  ok('back to auto writes no overlay', bc.parseBootConfig(backToAuto).overlay === null);
  ok('back to auto is the auto module', bc.moduleIdFor(bc.parseBootConfig(backToAuto)) === 'auto');
  ok('apply is idempotent', bc.applyCameraModule(backToAuto, null) === backToAuto);

  ok('overlay name accepted', bc.validOverlayName('imx296'));
  ok('overlay with params accepted', bc.validOverlayName('imx519,cam0'));
  ok('overlay with assignment accepted', bc.validOverlayName('imx477,rotation=180'));
  ok('overlay newline rejected', !bc.validOverlayName('imx296\nenable_uart=0'));
  ok('overlay space rejected', !bc.validOverlayName('imx296 foo'));
  ok('overlay shell chars rejected', !bc.validOverlayName('imx296;reboot'));
  ok('overlay base name', bc.overlayBaseName('imx519,cam0') === 'imx519');

  ok('reboot pending while boot id unchanged', bc.rebootStillPending('abc', 'abc'));
  ok('reboot done after new boot id', !bc.rebootStillPending('abc', 'def'));
  ok('nothing pending without a record', !bc.rebootStillPending(null, 'abc'));

  ok('explain: overlay set but nothing bound', (bc.explainBootConfig({ autoDetect: false, overlay: 'imx519' }, 0) || '').includes('ribbon cable'));
  ok('explain: auto-detect found nothing', (bc.explainBootConfig({ autoDetect: true, overlay: null }, 0) || '').includes('CSI camera module'));
  ok('explain: auto off and no overlay', (bc.explainBootConfig({ autoDetect: false, overlay: null }, 0) || '').includes('never looks'));
  ok('explain: silent when a camera is there', bc.explainBootConfig({ autoDetect: true, overlay: null }, 1) === null);
  ok('catalogue has the arducam 16MP with a tuning file', !!bc.moduleById('imx519')?.tuningFile);

  // ---- CSI camera detection (pure part) ----
  const { parseCameraList, captureNodes, explainNoCamera } = await import(
    '../packages/vehicle/src/system/cameras'
  );
  ok(
    'parseCameraList reads rpicam-hello',
    parseCameraList('Available cameras\n-----------------\n0 : imx519 [4656x3496] (/base/soc/i2c0mux/i2c@1/imx519@1a)')[0].startsWith(
      'imx519',
    ),
  );
  ok('parseCameraList empty on none', parseCameraList('No cameras available!').length === 0);
  ok(
    'captureNodes drops codec nodes',
    captureNodes(['/dev/video0', '/dev/video10', '/dev/video31']).join() === '/dev/video0',
  );
  ok('explainNoCamera names dtoverlay', explainNoCamera(true).includes('dtoverlay'));
  ok('explainNoCamera names rpicam-apps', explainNoCamera(false).includes('rpicam-apps'));

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
  ok('car defaults to mode 2 (one-stick layout)', buildProfile('car').stickMode === 2);
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

  // ---- action bindings: panic ships unbound, legacy Escape is dropped ----
  const { migrateActions } = await import('../packages/ground/src/lib/actions');
  const fresh = migrateActions(null);
  ok('panic is unbound by default', fresh['panic-disarm'].key === null && fresh['panic-disarm'].button === null);
  ok('arm is unbound by default', fresh['toggle-arm'].key === null && fresh['toggle-arm'].button === null);
  ok('the harmless defaults stay', fresh['record-toggle'].key === 'r' && fresh.snapshot.key === 't');
  // The old shipped default was never a choice — drop it on migration.
  const legacy = migrateActions({ 'panic-disarm': { key: 'escape', button: null } });
  ok('legacy escape default is dropped', legacy['panic-disarm'].key === null);
  // Anything the operator actually picked survives, including Escape *plus* a button.
  const chosen = migrateActions({ 'panic-disarm': { key: 'escape', button: 7 } });
  ok('a deliberate escape+button survives', chosen['panic-disarm'].key === 'escape' && chosen['panic-disarm'].button === 7);
  const custom = migrateActions({ 'panic-disarm': { key: 'p', button: null } });
  ok('a custom panic key survives', custom['panic-disarm'].key === 'p');
  const btnOnly = migrateActions({ 'panic-disarm': { key: null, button: 3 } });
  ok('a controller-only panic survives', btnOnly['panic-disarm'].button === 3);

  // ---- auto-disarm on reconnect: type policy + operator override ----
  const { resolveAutoDisarm } = await import('../packages/ground/src/lib/templates');
  ok('auto follows car policy', resolveAutoDisarm('auto', 'car') === true);
  ok('auto follows boat policy', resolveAutoDisarm('auto', 'boat') === true);
  ok('auto keeps aircraft armed', resolveAutoDisarm('auto', 'plane') === false && resolveAutoDisarm('auto', 'drone') === false);
  ok('forced on overrides the policy', resolveAutoDisarm('on', 'drone') === true);
  ok('forced off overrides the policy', resolveAutoDisarm('off', 'car') === false);

  // ---- which channel is the throttle (must follow the bindings, not the template) ----
  const { throttleChannelsOf, withResolvedThrottle } = await import('../packages/ground/src/lib/templates');
  const carT = buildProfile('car');
  ok('derives the template channel', throttleChannelsOf(carT).join() === carT.throttleChannels.join());
  // Move the throttle binding to another channel — the stored list stays behind.
  const moved = {
    ...carT,
    bindings: carT.bindings.map((b) => (b.label === 'Throttle' ? { ...b, channel: 7 } : b)),
  };
  ok('stored list goes stale', moved.throttleChannels.join() === '2');
  ok('derivation follows the binding', throttleChannelsOf(moved).join() === '7');
  ok('normalising writes it back', withResolvedThrottle(moved).throttleChannels.join() === '7');
  ok('normalising is a no-op when in sync', withResolvedThrottle(carT) === carT);
  // The label is what marks a throttle; an unrecognised one falls back to the list.
  const renamed = { ...carT, bindings: carT.bindings.map((b) => (b.label === 'Throttle' ? { ...b, label: 'Gas' } : b)) };
  ok('unknown label falls back to the stored list', throttleChannelsOf(renamed).join() === '2');
  const deleted = { ...carT, bindings: carT.bindings.filter((b) => b.label !== 'Throttle') };
  ok('deleted binding falls back too', throttleChannelsOf(deleted).join() === '2');
  // Twin motors: two throttle bindings, both must be guarded.
  const twin = {
    ...carT,
    bindings: [...carT.bindings, { ...carT.bindings.find((b) => b.label === 'Throttle')!, id: 'twin', channel: 3 }],
  };
  ok('two throttles are both derived', throttleChannelsOf(twin).join() === '2,3');

  // …and the safety arrays follow it. A car's OFF value is centre (= neutral), so
  // the plane is the case that actually proves it: OFF there is min.
  const movedPlane = (() => {
    const p = buildProfile('plane');
    return { ...p, bindings: p.bindings.map((b) => (b.label === 'Throttle' ? { ...b, channel: 7 } : b)) };
  })();
  const planeDisarm = profileDisarmedUs(movedPlane);
  ok('moved plane throttle is still cut when disarmed', planeDisarm[7] === 1000, `=${planeDisarm[7]}`);
  ok('the old channel is no longer forced', planeDisarm[2] === 1500, `=${planeDisarm[2]}`);

  // ---- self-healing: an axis left on the wrong source/element by an old version ----
  const { repairAxisBindings } = await import('../packages/ground/src/lib/templates');
  const touchCar = rebuildForMethod(buildProfile('car'), 'touch');
  ok('a healthy profile is returned unchanged', repairAxisBindings(touchCar) === touchCar);
  // Exactly the state that made the throttle stick disappear: touch profile, but
  // the throttle axis still carries its keyboard source/element.
  const brokenCar = {
    ...touchCar,
    bindings: touchCar.bindings.map((b) => (b.label === 'Throttle' ? { ...b, source: 'keyboard' as const, element: 'k|i' } : b)),
  };
  const drawn = (p: typeof brokenCar) => p.bindings.filter((b) => b.source === 'virtual' && b.element.startsWith('joy:')).map((b) => b.label);
  ok('the broken profile hides the throttle stick', drawn(brokenCar).join() === 'Steering');
  const healed = repairAxisBindings(brokenCar);
  ok('repair brings the stick back', drawn(healed).join() === 'Steering,Throttle');
  ok('repair restores source and element', healed.bindings.find((b) => b.label === 'Throttle')?.element === 'joy:L:y');
  // A stale element after an old stick-mode switch is repaired from the axis.
  const staleMode = {
    ...touchCar,
    stickMode: 4 as const,
    bindings: touchCar.bindings.map((b) => (b.label === 'Throttle' ? { ...b, stickAxis: 'leftY' as const } : b)),
  };
  ok('stale element follows the axis', repairAxisBindings(staleMode).bindings.find((b) => b.label === 'Throttle')?.element === 'joy:L:y');
  // Aux and user-added channels must not be touched (they have no stickAxis).
  const withAux = repairAxisBindings(brokenCar);
  ok('aux channels are left alone', withAux.bindings.find((b) => b.label === 'Lights')?.element === 'btn');

  // ---- a template's default stick mode must be APPLIED, not just recorded ----
  for (const vt of ['car', 'boat', 'plane', 'drone'] as const) {
    const p = buildProfile(vt);
    const remapped = applyStickMode(p, p.stickMode ?? 1);
    const same = p.bindings.every((b, i) => b.stickAxis === remapped.bindings[i].stickAxis && b.element === remapped.bindings[i].element);
    ok(`${vt} axes match its default mode`, same);
  }
  const carMode = buildProfile('car');
  ok('car defaults to mode 2', carMode.stickMode === 2);
  // Mode 2 on a two-axis model puts both axes on the LEFT stick (one thumb).
  const carTouch = rebuildForMethod(carMode, 'touch');
  const carSticks = new Set(carTouch.bindings.filter((b) => b.source === 'virtual').map((b) => b.element.split(':')[1]));
  ok('car mode 2 is a one-stick layout', carSticks.size === 1 && carSticks.has('L'), [...carSticks].join());
  ok('steering and throttle share it', carTouch.bindings.filter((b) => b.element === 'joy:L:x' || b.element === 'joy:L:y').length === 2);
  // The throttle detent has to travel with the axis, or the pre-arm rest is wrong.
  ok('car throttle keeps its centre detent', carTouch.bindings.find((b) => b.label === 'Throttle')?.detent === 'center');
  ok('boat keeps its free throttle detent', rebuildForMethod(buildProfile('boat'), 'touch').bindings.find((b) => b.label === 'Throttle')?.detent === 'free');
  ok('plane keeps its free throttle detent', buildProfile('plane').bindings.find((b) => b.label === 'Throttle')?.detent === 'free');

  // ---- ESC calibration uses the CHANNEL's endpoints, not the profile default ----
  const { channelEndpoints } = await import('../packages/ground/src/lib/templates');
  const epCar = buildProfile('car');
  ok('falls back to the profile endpoints', JSON.stringify(channelEndpoints(epCar, 2)) === JSON.stringify(epCar.endpoints));
  const narrowed = {
    ...epCar,
    bindings: epCar.bindings.map((b) => (b.label === 'Throttle' ? { ...b, shaping: { ...b.shaping, minUs: 1200, maxUs: 1800 } } : b)),
  };
  const narrowEp = channelEndpoints(narrowed, 2);
  ok('a narrowed throttle channel wins', narrowEp.minUs === 1200 && narrowEp.maxUs === 1800);
  ok('other channels keep the profile range', channelEndpoints(narrowed, 0).maxUs === 2000);
  ok('an unbound channel falls back', channelEndpoints(narrowed, 15).maxUs === epCar.endpoints.maxUs);

  // ---- throttle limiter (three speeds) ----
  const TL = await import('../packages/ground/src/lib/throttleLimit');
  const { neutralChannels: neutral } = await import('../packages/protocol/src/channels');
  // Centre detent (car with reverse): capped in BOTH directions around 1500.
  ok('centre: full forward at 50%', TL.limitUs(2000, 1500, 50) === 1750);
  ok('centre: full reverse at 50%', TL.limitUs(1000, 1500, 50) === 1250);
  ok('centre: rest stays rest', TL.limitUs(1500, 1500, 50) === 1500);
  // Min detent (plane/ratcheted): idle untouched, only the top is capped.
  ok('min: idle stays exactly at min', TL.limitUs(1000, 1000, 50) === 1000);
  ok('min: full throttle at 50%', TL.limitUs(2000, 1000, 50) === 1500);
  ok('min: half throttle at 50%', TL.limitUs(1500, 1000, 50) === 1250);
  // Scaling, not clipping: the whole stick travel keeps mapping proportionally.
  ok('scales linearly', TL.limitUs(1750, 1500, 40) === 1600);
  ok('100% is a no-op', TL.limitUs(1873, 1500, 100) === 1873);
  ok('percent is clamped', TL.clampPercent(0) === 10 && TL.clampPercent(500) === 100 && TL.clampPercent(Number.NaN) === 100);

  const limCar = buildProfile('car'); // throttle ch 2, centre detent
  ok('no limiter configured → full travel', TL.activePercent(limCar) === 100);
  const pushed2 = neutral();
  pushed2[2] = 2000;
  pushed2[0] = 2000; // steering must NOT be limited
  const limited = TL.applyThrottleLimit(TL.withStep({ ...limCar, throttleLimit: { steps: [40, 70, 100], step: 0 } }, 0), pushed2);
  ok('limits the throttle channel', limited[2] === 1700, `=${limited[2]}`);
  ok('leaves other channels alone', limited[0] === 2000);
  ok('unlimited returns the same array', TL.applyThrottleLimit(limCar, pushed2) === pushed2);
  // It has to follow a throttle that was moved to another channel.
  const limMoved = { ...movedPlane, throttleLimit: { steps: [50, 70, 100], step: 0 as const } };
  const planePush = neutral();
  planePush[7] = 2000;
  const limPlane = TL.applyThrottleLimit(limMoved, planePush);
  ok('follows the moved throttle channel', limPlane[7] === 1500, `=${limPlane[7]}`);
  ok('step cycling wraps', TL.nextStep(0) === 1 && TL.nextStep(1) === 2 && TL.nextStep(2) === 0);
  ok('withStep keeps the steps', TL.withStep(limCar, 1).throttleLimit?.step === 1);
  ok('garbage config falls back', TL.limitOf({ ...limCar, throttleLimit: { steps: [0, 999, Number.NaN] as [number, number, number], step: 9 as 0 } }).steps.join() === '10,100,100');

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
  // …and it follows a throttle that was moved to another channel in the editor.
  const upOnSeven = neutralChannels();
  upOnSeven[7] = 2000;
  ok('pre-arm blocks on the moved throttle', !preArmCheck(movedPlane, upOnSeven).ok);
  const idleOnSeven = neutralChannels();
  idleOnSeven[7] = 1000;
  ok('pre-arm passes at idle on the moved throttle', preArmCheck(movedPlane, idleOnSeven).ok);

  // ---- hold-to-arm timing ----
  const { holdProgress, holdRemainingS, ARM_HOLD_MS, clampHoldSeconds, holdMsFor, HOLD_DEFAULTS, HOLD_MIN_S, HOLD_MAX_S } =
    await import('../packages/ground/src/lib/hold');
  ok('hold defaults to 1 s, on', ARM_HOLD_MS === 1000 && HOLD_DEFAULTS.seconds === 1 && HOLD_DEFAULTS.enabled === true);
  ok('not holding = 0', holdProgress(null, 12345) === 0);
  ok('hold starts at 0', holdProgress(1000, 1000) === 0);
  ok('hold half way', near(holdProgress(1000, 1500), 0.5));
  ok('hold completes', holdProgress(1000, 4000) === 1);
  ok('hold clamps past the end', holdProgress(1000, 99999) === 1);
  ok('clock jumping back does not fire', holdProgress(1000, 500) === 0);
  ok('zero hold fires at once', holdProgress(1000, 1000, 0) === 1);
  ok('custom hold time is honoured', near(holdProgress(0, 2500, 5000), 0.5));
  ok('remaining counts down', holdRemainingS(0) === 1 && holdRemainingS(0.5) === 0.5 && holdRemainingS(1) === 0);
  ok('remaining follows a custom hold', holdRemainingS(0.5, 6000) === 3);
  // Configurable in Setup › Controls: off means a plain tap, and the seconds are clamped.
  ok('enabled → ms from seconds', holdMsFor({ enabled: true, seconds: 2.5 }) === 2500);
  ok('disabled → 0 (plain tap)', holdMsFor({ enabled: false, seconds: 3 }) === 0);
  ok('clamps below the minimum', clampHoldSeconds(0.1) === HOLD_MIN_S);
  ok('clamps above the maximum', clampHoldSeconds(99) === HOLD_MAX_S);
  ok('rounds to a tenth', clampHoldSeconds(2.34) === 2.3);
  ok('garbage falls back to the default', clampHoldSeconds(Number.NaN) === HOLD_DEFAULTS.seconds);

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

  // ---- native driver modules: allowlist, npm args, failure diagnosis ----
  // These sentences are the whole user-facing failure story on a vehicle that may
  // only be reachable from a phone, so they are pinned here.
  const { isHwDep, npmInstallArgs, explainNpmFailure, errorExcerpt, lastLines, HW_DEPS } = await import('../packages/vehicle/src/system/hwDeps');
  ok('allowlist has exactly the three modules', HW_DEPS.length === 3 && isHwDep('i2c-bus') && isHwDep('pigpio') && isHwDep('serialport'));
  ok('allowlist rejects everything else', !isHwDep('rimraf') && !isHwDep('i2c-bus; rm -rf /') && !isHwDep('') && !isHwDep(42));
  ok('npm args target the vehicle workspace', npmInstallArgs('i2c-bus').join(' ') === 'install i2c-bus -w @yonderrc/vehicle --no-audit --no-fund --foreground-scripts');
  // Without --foreground-scripts npm hides the build output of an optional dependency,
  // which is where the reason for a failed install lives.
  ok('npm args show the build output', npmInstallArgs('i2c-bus').includes('--foreground-scripts'));
  ok('npm args carry no shell syntax', npmInstallArgs('serialport').every((a) => !/[;&|$`<>]/.test(a)));

  const netFail = explainNpmFailure('npm error code ENOTFOUND\nnpm error network request to https://registry.npmjs.org/i2c-bus failed');
  ok('no internet is named as such', /internet|registry/.test(netFail.cause) && /WiFi|LTE/.test(netFail.fix));
  // Regression: a node-gyp stack trace mentions the identifier `eNotFound`, which a
  // case-insensitive ENOTFOUND match read as "the Pi has no internet" — on a log whose
  // real cause was a broken Python. Error codes are matched case-sensitively now.
  const camelTrap = explainNpmFailure(
    'gyp ERR! stack at getNotFoundError (/opt/yonderrc/node_modules/which/which.js:13:12)\n' +
      "ModuleNotFoundError: No module named 'distutils'",
    { dep: 'i2c-bus', silentDrop: true },
  );
  ok('camelCase identifier is not read as a network error', !/internet|registry/.test(camelTrap.cause));
  ok('the real cause (python/distutils) wins', camelTrap.cause.includes('distutils') && camelTrap.fix.includes('python3-setuptools'));
  ok('a real ENOTFOUND is still caught', explainNpmFailure('npm error code ENOTFOUND').cause.includes('internet'));
  // npm exits 0 when an optionalDependency fails to build: that must never read as success.
  const silent = explainNpmFailure('up to date in 2s', { dep: 'i2c-bus', silentDrop: true });
  ok('a silently dropped module is explained', silent.cause.includes('optional dependency') && silent.fix.includes('build-essential'));
  const excerpt = errorExcerpt('n1\nn2\nn3\nn4\nfatal error: pigpio.h: No such file\ndetail\nboilerplate', 3);
  ok('excerpt starts just before the error, not at the end', excerpt === 'n3\nn4\nfatal error: pigpio.h: No such file', excerpt);
  ok('excerpt without an error keeps the tail', errorExcerpt('a\nb\nc', 2) === 'b\nc');

  const gypFail = explainNpmFailure('npm error gyp ERR! stack Error: not found: make\nnpm error gyp ERR! stack at getNotFoundError');
  ok('missing compiler points at build-essential', gypFail.fix.includes('sudo apt install -y build-essential'));
  // A missing C library must NOT be reported as a missing compiler — that sends
  // the operator down the wrong path (pigpio needs its own apt package).
  const libFail = explainNpmFailure('../src/pigpio.cc:5:10: fatal error: pigpio.h: No such file or directory\nmake: *** [pigpio.o] Error 1', { dep: 'pigpio' });
  ok('missing library names the header', libFail.cause.includes('pigpio.h'));
  ok('missing library points at its apt package', libFail.fix.includes('apt install -y pigpio') && !libFail.fix.includes('build-essential'));
  ok('missing python is its own case', explainNpmFailure('npm error gyp ERR! find Python').fix.includes('python3'));
  ok('timeout has its own explanation', explainNpmFailure('', { timedOut: true }).cause.includes('too long'));
  ok('full disk is recognised', explainNpmFailure('npm error ENOSPC: no space left on device').cause.includes('full'));
  ok('permission trouble suggests chown', explainNpmFailure('npm error EACCES: permission denied, mkdir').fix.includes('chown'));
  const unknown = explainNpmFailure('something nobody anticipated');
  ok('an unknown failure still says something useful', unknown.cause.length > 0 && unknown.fix.length > 0);
  ok('log tail keeps the end', lastLines('a\nb\nc\nd', 2) === 'c\nd');
  ok('log tail drops blank lines', lastLines('a\n\n\nb', 5) === 'a\nb');

  // The sim system runs the same flow end to end on a dev machine (`sys` above).
  const simSys = sys;
  ok('sim: nothing installed initially', (await simSys.hwDeps()).every((d) => !d.installed));
  const simOk = await simSys.hwDepInstall('i2c-bus');
  ok('sim: install succeeds and sticks', simOk.ok && (await simSys.hwDeps()).some((d) => d.name === 'i2c-bus' && d.installed));
  ok('sim: install asks for a service restart', simOk.restartRequired === true);
  const simBad = await simSys.hwDepInstall('pigpio');
  ok('sim: failure carries cause, fix and log', !simBad.ok && !!simBad.fix && simBad.output.includes('pigpio.h'));

  // ---- WiFi scan parsing + hotspot arguments ----
  const { parseWifiScan, HOTSPOT_DEFAULTS } = await import('../packages/vehicle/src/system/SystemManager');
  const scan = parseWifiScan(
    [
      '*:88:WPA2:Weber-Home',
      ' :74:WPA2:Weber-Home-5G',
      ' :51:WPA1 WPA2:FRITZ\\!Box 7590',
      ' :33::Gastnetz', // open network → empty SECURITY
      ' :20:WPA2:', // hidden SSID → dropped
      ' :44:WPA2:Weber-Home', // same SSID on another band → keep the strongest
      ' :12:WPA2:Cafe\\: Central', // escaped colon inside the SSID
    ].join('\n'),
  );
  ok('scan drops hidden networks', !scan.some((n) => n.ssid === ''));
  ok('scan dedupes by ssid', scan.filter((n) => n.ssid === 'Weber-Home').length === 1);
  ok('scan keeps the strongest', scan.find((n) => n.ssid === 'Weber-Home')?.signal === 88);
  ok('scan sorts strongest first', scan[0].ssid === 'Weber-Home' && scan[scan.length - 1].signal <= scan[0].signal);
  ok('scan marks the active network', scan.find((n) => n.ssid === 'Weber-Home')?.active === true);
  ok('scan detects open networks', scan.find((n) => n.ssid === 'Gastnetz')?.secured === false);
  ok('scan keeps secured flag', scan.find((n) => n.ssid === 'Weber-Home-5G')?.secured === true);
  ok('scan unescapes colons', scan.some((n) => n.ssid === 'Cafe: Central'), scan.map((n) => n.ssid).join('|'));
  ok('scan of nothing is empty', parseWifiScan('').length === 0);

  ok('hotspot default is open', HOTSPOT_DEFAULTS.password === null);

  // ---- the two READMEs must not drift apart ----
  // A translation that lags is worse than none: it states as current something the
  // project stopped doing, and the reader cannot tell which of the two is the lie. This
  // will not catch a bad translation, but it catches the case that actually happens —
  // a section added to one of them and not the other.
  {
    const en = readFileSync('README.md', 'utf8');
    const de = readFileSync('README.de.md', 'utf8');
    const heads = (t: string) => (t.match(/^#{2,3} /gm) ?? []).length;
    ok('both READMEs exist', en.length > 0 && de.length > 0);
    ok('each points at the other', en.includes('[Deutsch](README.de.md)') && de.includes('[English](README.md)'));
    ok('the same sections in both', heads(en) === heads(de), `${heads(en)} vs ${heads(de)}`);
    ok('the German README links the German hardware guide', de.includes('docs/HARDWARE.de.md'));
    ok('and CLAUDE.md says both are edited together',
      readFileSync('CLAUDE.md', 'utf8').includes('Both language versions are edited in the same commit'));
  }

  // ---- one version, three places ----
  // The banner, the setup header and the update check all show it; a hardcoded copy
  // in the service was one more thing to forget on release day.
  const { readVersion } = await import('../packages/vehicle/src/config');
  const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
  ok('the vehicle reads its version from package.json', readVersion() === pkgVersion, `${readVersion()} vs ${pkgVersion}`);
  ok('and the ground masthead agrees', readFileSync('packages/ground/src/App.tsx', 'utf8').includes(`ground · v${pkgVersion}`));
  ok('no hardcoded version left in the vehicle banner', !/YonderRC vehicle service {2}v\d/.test(readFileSync('packages/vehicle/src/index.ts', 'utf8')));

  // ---- generated video config lives outside the checkout ----
  // It used to be written into docker/go2rtc.yaml inside the repo, which left every
  // running vehicle with a modified checkout and blocked `git pull --ff-only`. The two
  // units must agree on the runtime path, or the vehicle writes a config go2rtc never
  // reads — a failure that is invisible until the cameras stay dark.
  const go2rtcUnit = readFileSync('provisioning/systemd/go2rtc.service', 'utf8');
  const vehicleUnit = readFileSync('provisioning/systemd/yonderrc-vehicle.service', 'utf8');
  const unitPath = go2rtcUnit.match(/-config\s+(\S+)/)?.[1] ?? '';
  const envPath = vehicleUnit.match(/YRC_GO2RTC_CONFIG=(\S+)/)?.[1] ?? '';
  ok('go2rtc reads a runtime path, not the checkout', unitPath === '/var/lib/yonderrc/go2rtc.yaml', unitPath);
  ok('the vehicle writes exactly that path', envPath === unitPath, `${envPath} vs ${unitPath}`);
  ok('the installer creates the directory', readFileSync('provisioning/install.sh', 'utf8').includes('install -d -m 0755 /var/lib/yonderrc'));

  // ---- self-update: what the vehicle would do, and in which order ----
  const U = await import('../packages/vehicle/src/system/update');
  ok('clean tree recognised', U.parseWorkingTree('').clean === true);
  const dirty = U.parseWorkingTree(' M packages/vehicle/src/index.ts\n?? scratch.txt');
  ok('local changes are listed', !dirty.clean && dirty.dirty.includes('packages/vehicle/src/index.ts'));
  // Untracked files never block a fast-forward, and every running vehicle has some
  // (its own config, logs) — counting them made an ordinary vehicle "dirty".
  ok('untracked files do not block', dirty.dirty.every((f) => f !== 'scratch.txt'));
  ok('a vehicle with only untracked files is clean', U.parseWorkingTree('?? yonderrc-config.json\n?? npm-debug.log').clean === true);
  // docker/go2rtc.yaml is tracked AND rewritten by the vehicle at every start, so it
  // is modified on every real vehicle — it must not be mistaken for someone's work.
  const gen = U.parseWorkingTree(' M docker/go2rtc.yaml');
  ok('a generated file does not block the update', gen.clean === true && gen.generated.includes('docker/go2rtc.yaml'));
  ok('but it is still noticed', gen.dirty.length === 0 && U.GENERATED_PATHS.includes('docker/go2rtc.yaml'));
  const genSteps = U.updateSteps({ deps: false, ground: false, provisioning: false, vehicle: true }, U.UPDATE_SOURCE_DEFAULT, ['docker/go2rtc.yaml']);
  ok('generated files are discarded before pulling', genSteps[0].args.join(' ') === 'checkout -- docker/go2rtc.yaml' && genSteps[1].args[0] === 'pull');
  ok('and nothing is discarded when nothing was generated', U.updateSteps({ deps: false, ground: false, provisioning: false, vehicle: true })[0].args[0] === 'pull');
  const commits = U.parseCommits('7aa5354 v1.42.0 — setup page fits a phone\n651e485 v1.41.2 — no more stale message');
  ok('commits parsed', commits.length === 2 && commits[0].hash === '7aa5354' && commits[0].subject.startsWith('v1.42.0'));
  ok('version read from a package.json blob', U.parseVersion('{"name":"x","version":"1.42.0"}') === '1.42.0');
  ok('broken package.json is null, not a crash', U.parseVersion('{oops') === null);

  // The installer clones as `pi` and the service runs as root, so git refuses with
  // "dubious ownership" unless every call carries this. A global config write was the
  // first attempt and did nothing — a systemd service has no guaranteed $HOME.
  const ga = U.gitArgs('/opt/yonderrc', ['fetch', '--quiet', 'origin', 'main']);
  ok('git runs inside the checkout', ga.slice(0, 2).join(' ') === '-C /opt/yonderrc');
  ok('the subcommand follows unchanged', ga.slice(-4).join(' ') === 'fetch --quiet origin main');
  // …and the ownership exception is NOT a command-line flag: git only honours
  // safe.directory from protected (system/global) config, which is why the `-c`
  // version silently changed nothing on the Pi.
  ok('no -c safe.directory on the command line', !ga.includes('-c'));
  const sdc = U.safeDirectoryConfig('/opt/yonderrc/');
  ok('the exception is a global-config file instead', sdc.includes('[safe]'));
  // The repo root comes from a URL and carries a trailing slash; git compares the
  // value literally, so both spellings go in — and `*`, which is harmless because
  // this file reaches git only through the vehicle's own GIT_CONFIG_GLOBAL.
  ok('trailing slash and bare path both listed', sdc.includes('directory = /opt/yonderrc\n') && sdc.includes('directory = /opt/yonderrc/\n'));
  ok('wildcard as the last resort', sdc.includes('directory = *'));

  // The update source is a field, so a fork or a branch needs no code change.
  ok('a remote name is a source', U.isGitSource('origin') && U.isGitSource('upstream'));
  ok('an https URL is a source', U.isGitSource('https://github.com/you/YonderRC.git'));
  ok('nonsense is rejected', !U.isGitSource('') && !U.isGitSource('two words') && !U.isGitSource(42));
  ok('branch names validated', U.isGitBranch('main') && U.isGitBranch('feature/x') && !U.isGitBranch('') && !U.isGitBranch('a b'));
  const forkSteps = U.updateSteps({ deps: false, ground: false, provisioning: false, vehicle: true }, { source: 'https://example.com/x.git', branch: 'dev' });
  ok('the pull uses the configured source', forkSteps[0].args.join(' ') === 'pull --ff-only https://example.com/x.git dev');

  const impact = U.classifyChanges(['packages/ground/src/App.tsx', 'package.json', 'provisioning/install.sh']);
  ok('changed files classified', impact.ground && impact.deps && impact.provisioning);
  ok('vehicle-only change stays small', U.classifyChanges(['packages/vehicle/src/index.ts']).ground === false);

  // Order matters: dependencies before the build (vite needs its platform binaries),
  // and the restart happens after both — the setup page IS the service being restarted.
  const stepsAll = U.updateSteps({ deps: true, ground: true, provisioning: false, vehicle: true }).map((st) => `${st.cmd} ${st.args.join(' ')}`);
  ok('pull comes first, from origin/main by default', stepsAll[0] === 'git pull --ff-only origin main');
  ok('deps installed before the build', stepsAll.findIndex((x) => x.includes('--omit=optional')) < stepsAll.findIndex((x) => x.includes('run build')));
  ok('build tooling restored after --omit=optional', stepsAll.some((x) => x.includes('--include-workspace-root -w @yonderrc/ground')));
  const stepsSmall = U.updateSteps({ deps: false, ground: false, provisioning: false, vehicle: true }).map((st) => st.cmd);
  ok('a vehicle-only update is just a pull', stepsSmall.length === 1 && stepsSmall[0] === 'git');

  const clean = { clean: true, dirty: [], generated: [] };
  const noConflict: string[] = [];
  const upToDate = U.describeCheck({ ok: true, current: '1.42.0', available: '1.42.0', behind: 0, commits: [], impact: U.classifyChanges([]), tree: clean, conflicts: noConflict });
  ok('up to date says so', upToDate.message.startsWith('Up to date') && upToDate.note === null);
  const behind = U.describeCheck({ ok: true, current: '1.41.0', available: '1.42.0', behind: 3, commits: [], impact: U.classifyChanges(['packages/ground/src/App.tsx']), tree: clean, conflicts: noConflict });
  ok('behind names the versions', behind.message.includes('3 commits behind') && behind.message.includes('v1.42.0'));
  ok('a ground change warns about the rebuild', (behind.note || '').includes('rebuilt'));
  const prov = U.describeCheck({ ok: true, current: '1', available: '2', behind: 1, commits: [], impact: U.classifyChanges(['provisioning/install.sh']), tree: clean, conflicts: noConflict });
  ok('installer changes send you to the full installer', (prov.note || '').includes('install.sh'));
  const dirtyCheck = U.describeCheck({ ok: true, current: '1', available: '2', behind: 1, commits: [], impact: U.classifyChanges([]), tree: { clean: false, dirty: ['a.ts'], generated: [] }, conflicts: ['a.ts'] });
  ok('an overlapping local change blocks, with the reason', dirtyCheck.message.includes('local changes') && (dirtyCheck.note || '').includes('a.ts'));
  // git fast-forwards past local changes it does not touch, so refusing there was
  // stricter than git itself.
  const untouched = U.describeCheck({ ok: true, current: '1', available: '2', behind: 1, commits: [], impact: U.classifyChanges(['README.md']), tree: { clean: false, dirty: ['notes.txt'], generated: [] }, conflicts: [] });
  ok('a local change the update ignores does not block', !untouched.message.includes('will not fast-forward'));
  ok('but it is mentioned', (untouched.note || '').includes('notes.txt'));
  // A failed check must repeat git's own reason. Reporting "needs internet" for a
  // permission problem sent a vehicle WITH internet on a wild goose chase.
  const dubious = U.explainGitFailure("fatal: detected dubious ownership in repository at '/opt/yonderrc'");
  ok('dubious ownership is recognised, not called a network fault', dubious.cause.includes('belongs to a different user') && dubious.selfFixable === true);
  ok('no DNS is its own case', U.explainGitFailure('fatal: unable to access ...: Could not resolve host: github.com').cause.includes('resolve'));
  ok('unreachable remote is its own case', U.explainGitFailure('fatal: unable to access ...: Failed to connect to github.com port 443').cause.includes('reach'));
  ok('a VPN is not proof of internet', U.explainGitFailure('Failed to connect').fix.includes('Tailscale'));
  // Verbatim strings from a real git (with LC_ALL=C, which the vehicle forces —
  // a localised git says "Schwerwiegend: Kein Git-Repository" and matches nothing).
  ok('a zip install is told it cannot update', U.explainGitFailure('fatal: not a git repository (or any parent up to mount point /)').cause.includes('not installed from git'));
  ok('real "could not resolve host" wording', U.explainGitFailure("fatal: unable to access 'https://github.com/x.git/': Could not resolve host: github.com").cause.includes('resolve'));
  ok('real "couldn\'t find remote ref" wording', U.explainGitFailure('fatal: couldn\'t find remote ref main').cause.includes('does not exist'));
  ok('credential prompts are explained', U.explainGitFailure('fatal: Authentication failed for ...').fix.includes('remote set-url'));
  const failed = U.describeCheck({
    ok: false, current: '1', available: null, behind: 0, commits: [], impact: U.classifyChanges([]), tree: clean, conflicts: [],
    detail: "fatal: detected dubious ownership in repository at '/opt/yonderrc'",
  });
  ok('the check surfaces the real cause', failed.message.includes('different user'), failed.message);
  ok('and offers the self-repair', (failed.note || '').includes('fix this itself'));

  // ---- Tailscale status: the pending login URL ----
  // A real Pi sat at "down · NeedsLogin" with nothing to click, because the login URL
  // was scraped from `tailscale up --timeout=1s` (too early) and the status parser
  // hardcoded loginUrl to null. The daemon publishes it as AuthURL.
  const { parseTailscaleStatus } = await import('../packages/vehicle/src/system/tailscale');
  const needsLogin = parseTailscaleStatus(JSON.stringify({
    BackendState: 'NeedsLogin',
    AuthURL: 'https://login.tailscale.com/a/1234deadbeef',
    Self: { TailscaleIPs: [] },
  }));
  ok('pending login url is surfaced', needsLogin.authUrl === 'https://login.tailscale.com/a/1234deadbeef');
  ok('needs-login is not running', !needsLogin.running && needsLogin.backendState === 'NeedsLogin');
  const tsUp = parseTailscaleStatus(JSON.stringify({
    BackendState: 'Running',
    Self: { TailscaleIPs: ['100.101.102.103', 'fd7a:115c:a1e0::1'] },
  }));
  ok('running state detected', tsUp.running && tsUp.backendState === 'Running');
  ok('tailnet IPv4 picked from the status', tsUp.ip === '100.101.102.103');
  ok('no pending login when authorised', tsUp.authUrl === null);
  ok('empty AuthURL counts as none', parseTailscaleStatus(JSON.stringify({ BackendState: 'Stopped', AuthURL: '' })).authUrl === null);
  ok('garbage status degrades quietly', parseTailscaleStatus('not json').backendState === 'Unknown');

  // ---- HiLink LTE stick (Huawei E3372h-320 & friends) ----
  const H = await import('../packages/vehicle/src/system/hilink');
  ok('ipv4 accepted', H.isIpv4('192.168.8.1'));
  ok('non-ipv4 refused (it becomes a proxy target)', !H.isIpv4('192.168.8.1; reboot') && !H.isIpv4('999.1.1.1') && !H.isIpv4('stick.local'));
  ok('xml flattened', H.parseHilinkXml('<response><A>1</A><B> x </B></response>').B === 'x');
  ok('no error is null', H.hilinkError('<response><A>1</A></response>') === null);
  ok('error 100003 is explained', (H.hilinkError('<error><code>100003</code></error>') || '').includes('session'));
  ok('unknown error keeps its code', (H.hilinkError('<error><code>424242</code></error>') || '').includes('424242'));
  ok('LTE recognised', H.networkTypeLabel('101') === '4G (LTE)' && H.networkTypeLabel('19') === '4G (LTE)');
  ok('HSPA+ recognised as 3G', (H.networkTypeLabel('9') || '').startsWith('3G'));
  ok('unknown network type admits it', (H.networkTypeLabel('777') || '').includes('777'));
  ok('901 is connected', H.connectionStatusLabel('901').connected === true);
  ok('908 names the SIM PIN', H.connectionStatusLabel('908').label.includes('PIN') && !H.connectionStatusLabel('908').connected);
  ok('dbm value parsed', H.dbmValue('-93dBm') === -93 && H.dbmValue('') === null);
  ok('rsrp → percent', H.signalPercent({ rsrp: -93 }) === 72);
  ok('rsrp clamped', H.signalPercent({ rsrp: -160 }) === 0 && H.signalPercent({ rsrp: -40 }) === 100);
  ok('bar icon is the fallback', H.signalPercent({ signalIcon: '3' }) === 60);
  ok('no signal info stays null', H.signalPercent({}) === null);
  // The interface comes from the routing table — never from a name like "eth1", or a
  // FritzBox LAN on the other eth would eventually be reported as the LTE link.
  ok('route dev parsed', H.parseRouteDev('192.168.8.1 dev eth1 src 192.168.8.100 uid 1000') === 'eth1');
  ok('no route → null', H.parseRouteDev('RTNETLINK answers: Network is unreachable') === null);

  const XML = {
    ses: '<response><SesInfo>SessionID=abc123</SesInfo><TokInfo>tok987</TokInfo></response>',
    status: '<response><ConnectionStatus>901</ConnectionStatus><SignalIcon>4</SignalIcon><CurrentNetworkType>19</CurrentNetworkType><CurrentNetworkTypeEx>101</CurrentNetworkTypeEx></response>',
    signal: '<response><rsrp>-93dBm</rsrp><rsrq>-9dB</rsrq><sinr>12dB</sinr></response>',
    plmn: '<response><State>0</State><FullName>Telekom.de</FullName><ShortName>TDG</ShortName></response>',
    info: '<response><DeviceName>E3372h-320</DeviceName><WanIPAddress>10.64.12.34</WanIPAddress></response>',
  };
  const seen: { path: string; headers: Record<string, string> }[] = [];
  const fakeGet = async (path: string, headers: Record<string, string>) => {
    seen.push({ path, headers });
    const body =
      path.includes('SesTokInfo') ? XML.ses :
      path.includes('monitoring/status') ? XML.status :
      path.includes('device/signal') ? XML.signal :
      path.includes('current-plmn') ? XML.plmn :
      path.includes('device/information') ? XML.info : '';
    return { ok: !!body, status: body ? 200 : 404, text: body, cookie: null };
  };
  const hi = await H.readHilink(fakeGet, 'eth1');
  ok('stick read: connected', hi.present && hi.connected && hi.state === 'connected');
  ok('stick read: model + operator', hi.model === 'E3372h-320' && hi.operator === 'Telekom.de');
  ok('stick read: 4G and signal', hi.networkType === '4G (LTE)' && hi.signalPercent === 72 && hi.rsrp === -93);
  ok('stick read: interface passed through', hi.iface === 'eth1');
  ok('session token is sent with the API calls', seen.slice(1).every((c) => c.headers.cookie === 'SessionID=abc123' && c.headers.__RequestVerificationToken === 'tok987'), JSON.stringify(seen[1]?.headers));
  // "LTE 72% · 4G (LTE)" says LTE twice; a 2G/3G fallback however must be visible,
  // because that is the moment video stops working.
  ok('osd label on 4G is just LTE + percent', H.hilinkOsdLabel(hi) === 'LTE 72%');
  ok('osd label spells out a 3G fallback', H.hilinkOsdLabel({ ...hi, networkType: '3G (HSPA+)' }) === '3G (HSPA+) 72%');
  ok('osd label survives a missing percent', H.hilinkOsdLabel({ ...hi, signalPercent: null }) === 'LTE');

  // The status panel said "no modem" while the vehicle was online through the stick.
  const asLte = H.hilinkAsLte(hi);
  ok('stick fills the LTE status row', asLte.present && asLte.connected && asLte.kind === 'hilink');
  ok('stick model is marked as HiLink', (asLte.modemModel || '').includes('HiLink'));
  ok('stick carries operator, signal and WAN IP', asLte.operator === 'Telekom.de' && asLte.signal === 72 && asLte.ip === '10.64.12.34');
  ok('APN stays null (it lives in the stick)', asLte.apn === null);
  ok('a PIN-locked stick is flagged', H.hilinkAsLte({ ...hi, state: 'SIM PIN required', connected: false }).pinRequired === true);

  const dead = await H.readHilink(async () => ({ ok: false, status: 0, text: '', cookie: null }), 'eth1');
  ok('unreachable stick is not "present"', !dead.present && (dead.message || '').includes('did not answer'));
  const denied = await H.readHilink(
    async (path) => ({ ok: true, status: 200, text: path.includes('SesTokInfo') ? XML.ses : '<error><code>100003</code></error>', cookie: null }),
    'eth1',
  );
  ok('an API error is reported, not swallowed', denied.present && (denied.message || '').includes('session'));

  // Proxy gate for the stick's admin UI.
  const P = await import('../packages/vehicle/src/transport/hilinkProxy');
  ok('cookie parsed', P.cookieValue('a=1; yrc_hilink=s3cret; b=2', 'yrc_hilink') === 's3cret');
  ok('no secret configured → open', P.proxyAuth(null, null, undefined) === 'ok');
  ok('matching query earns a cookie', P.proxyAuth('s3cret', 's3cret', undefined) === 'set-cookie');
  ok('cookie is accepted afterwards', P.proxyAuth('s3cret', null, 'yrc_hilink=s3cret') === 'ok');
  ok('wrong secret denied', P.proxyAuth('s3cret', 'nope', 'yrc_hilink=nope') === 'denied');
  ok('no credentials denied', P.proxyAuth('s3cret', null, undefined) === 'denied');

  // ---- hotspot profile + WiFi radio ----
  const W = await import('../packages/vehicle/src/system/wifi');
  const openCmds = W.hotspotCommands({ ssid: 'YonderRC-setup', password: null });
  const openFlat = openCmds.map((c) => c.args.join(' ')).join(' | ');
  // `nmcli device wifi hotspot` ALWAYS secures the AP ("If not provided, nmcli will
  // generate a password"), so the documented OPEN hotspot has to be an explicit
  // profile. This is the assertion that keeps it open.
  ok('open hotspot carries no security at all', !/wifi-sec|psk|password/.test(openFlat), openFlat);
  ok('open hotspot is an AP profile', openFlat.includes('802-11-wireless.mode ap'));
  ok('hotspot pins the documented address', openFlat.includes('ipv4.addresses 192.168.4.1/24') && openFlat.includes('ipv4.method shared'));
  ok('a stale profile is deleted first, and may fail', openCmds[0].args.join(' ') === 'connection delete Hotspot' && openCmds[0].optional === true);
  ok('the profile is brought up last', openCmds[openCmds.length - 1].args.join(' ') === 'connection up Hotspot');
  const secFlat = W.hotspotCommands({ ssid: 'X', password: 'longenough' }).map((c) => c.args.join(' ')).join(' | ');
  ok('secured hotspot sets WPA2 and the key', secFlat.includes('wifi-sec.key-mgmt wpa-psk') && secFlat.includes('wifi-sec.psk longenough'));
  ok('a too short key stays open', !W.hotspotCommands({ ssid: 'X', password: 'short' }).some((c) => c.args.includes('wifi-sec.psk')));
  ok('hotspot honours the interface', W.hotspotCommands({ ssid: 'X', password: null }, 'wlan1').some((c) => c.args.includes('wlan1')));
  ok('an SSID with spaces/semicolons stays one argument', W.hotspotCommands({ ssid: 'My Car; reboot', password: null })[1].args.includes('My Car; reboot'));

  ok('rfkill soft block detected', W.parseRfkill('1: phy0: Wireless LAN\n\tSoft blocked: yes\n\tHard blocked: no').softBlocked === true);
  ok('rfkill hard block detected', W.parseRfkill('\tSoft blocked: no\n\tHard blocked: yes').hardBlocked === true);
  ok('no rfkill output blocks nothing', W.parseRfkill('').softBlocked === false);
  ok('regulatory country parsed', W.parseWifiCountry('global\ncountry DE: DFS-ETSI') === 'DE');
  ok('world domain counts as unset', W.parseWifiCountry('country 00: DFS-UNSET') === null);
  ok('unavailable wlan0 detected', W.parseWifiDeviceState('eth0:ethernet:connected\nwlan0:wifi:unavailable') === 'unavailable');
  ok('ready wlan0 detected', W.parseWifiDeviceState('wlan0:wifi:disconnected') === 'ready');
  ok('a Pi without wlan0', W.parseWifiDeviceState('eth0:ethernet:connected') === 'missing');
  // Serving the hotspot and being joined to a network both read as "connected" —
  // the status row must not call the vehicle's own AP a client connection.
  ok('own hotspot is reported as ap', W.parseWifiMode('wlan0:connected:Hotspot') === 'ap');
  ok('a joined network is a client', W.parseWifiMode('wlan0:connected:Weber-Home') === 'client');
  ok('disconnected wifi is unknown', W.parseWifiMode('wlan0:disconnected:') === 'unknown');
  ok('other interfaces are ignored', W.parseWifiMode('eth0:connected:Wired connection 1') === 'unknown');
  ok('country guessed from the locale', W.guessWifiCountry({ locale: 'de_DE.UTF-8' }) === 'DE');
  ok('country guessed from the timezone', W.guessWifiCountry({ timezone: 'Europe/Vienna' }) === 'AT');
  ok('no guess stays null', W.guessWifiCountry({}) === null);
  ok('locale file parsed', W.parseLocaleFile('LC_ALL=\nLANG="de_DE.UTF-8"\n') === 'de_DE.UTF-8');
  ok('country code validated', W.isCountryCode('DE') && !W.isCountryCode('D') && !W.isCountryCode('DE; reboot'));
  ok('country args are fixed and upper-cased', W.wifiCountryArgs('de').join(' ') === 'nonint do_wifi_country DE');

  // Captive portal: only when the vehicle has nothing to share.
  ok('no uplink → hijack DNS', W.shouldHijackDns(false) === true);
  ok('uplink present → leave DNS alone', W.shouldHijackDns(true) === false);
  ok('captive conf points every name at the vehicle', W.captivePortalConf() === 'address=/#/192.168.4.1\n');
  ok('captive conf lives where NM reads it for shared connections', W.CAPTIVE_CONF_PATH.includes('/NetworkManager/dnsmasq-shared.d/'));

  const blockedRadio = { device: 'unavailable' as const, softBlocked: true, hardBlocked: false, country: null, suggestedCountry: 'DE' };
  ok('a blocked radio is not usable', !W.radioIsUsable(blockedRadio));
  // The exact message a real Pi produced when the radio was blocked.
  const wf = W.explainWifiFailure(
    "Error: Failed to setup a Wi-Fi hotspot: Connection 'Hotspot' is not available on device wlan0 because device is not available",
    blockedRadio,
  );
  ok('the nmcli message becomes a real explanation', wf.cause.includes('country') && wf.fixableHere === true, wf.cause);
  ok('and it points at the button and the country', wf.fix.includes('Enable WiFi radio') && wf.fix.includes('DE'));
  ok('a hardware switch is not offered a software fix', W.explainWifiFailure('', { ...blockedRadio, hardBlocked: true }).fixableHere === false);
  ok('a missing device is not offered a fix', W.explainWifiFailure('', { device: 'missing', softBlocked: false, hardBlocked: false, country: 'DE', suggestedCountry: 'DE' }).fixableHere === false);
  ok('a wrong key is explained as a key problem', W.explainWifiFailure('Error: Secrets were required, but not provided', { ...blockedRadio, device: 'ready', softBlocked: false }).cause.includes('password'));

  // When the boot-time onboarding starts the hotspot (mirrored in onboard.sh).
  const { shouldStartHotspot } = await import('../packages/vehicle/src/system/SystemManager');
  ok('auto: no uplink → start', shouldStartHotspot('auto', false, false).start === true);
  ok('auto: uplink → skip', shouldStartHotspot('auto', true, false).start === false);
  // The shipped default is "always" since v1.41.0 — a vehicle you can always walk up
  // to beats one that is only reachable while its uplink works.
  ok('default is always', HOTSPOT_DEFAULTS.mode === 'always');
  ok('unset mode follows the shipped default', shouldStartHotspot(undefined, true, false).start === true);
  ok('unset mode still yields to a WiFi client', shouldStartHotspot(undefined, true, true).start === false);
  ok('always: starts next to LTE', shouldStartHotspot('always', true, false).start === true);
  ok('off: never starts', shouldStartHotspot('off', false, false).start === false);
  // One radio: an active WiFi client connection beats every mode.
  ok('wifi client blocks always', shouldStartHotspot('always', true, true).start === false);
  ok('wifi client blocks auto', shouldStartHotspot('auto', false, true).start === false);
  ok('and it says why', shouldStartHotspot('always', true, true).reason.includes('one radio'));

  // ---- blackbox log CSV ----
  const { logToCsv } = await import('../packages/ground/src/lib/logger');
  const csv = logToCsv([{ t: 0, armed: 1, failsafe: 0, link: 'connected', rtt: 40, bitrate: 2500, loss: 0.5, fps: 30, vlat: 120, volt: 12.1, amp: 3.2, mah: 150, pct: 88 }]);
  ok('csv has header + row', csv.split('\n').length === 2 && csv.includes('t_ms,armed'));
  ok('csv null renders empty', logToCsv([{ t: 5, armed: 0, failsafe: 0, link: 'connected', rtt: null, bitrate: null, loss: null, fps: null, vlat: null, volt: null, amp: null, mah: null, pct: null }]).split('\n')[1] === '5,0,0,connected' + ','.repeat(16), logToCsv([{ t: 5, armed: 0, failsafe: 0, link: 'connected', rtt: null, bitrate: null, loss: null, fps: null, vlat: null, volt: null, amp: null, mah: null, pct: null }]).split('\n')[1]);

  // Every telemetry channel gets its own column, named after its label.
  const { sensorSnapshot } = await import('../packages/ground/src/lib/logger');
  const snapMsg = {
    type: 'telemetry', source: 'sim', ok: true,
    voltages: [{ label: 'Pack', value: 16.4 }, { label: 'BEC', value: 5.1 }],
    currents: [{ label: 'I1', value: 9.2 }],
    temperatures: [{ label: 'Motor °C', value: 62.5 }, { label: '', value: 41 }],
    mah: 0, wh: 0, capacityMah: null, batteryPercent: null, displayMode: 'remaining',
  } as import('@yonderrc/protocol').TelemetryMessage;
  const cols = sensorSnapshot(snapMsg);
  ok('snapshot names columns by label', cols.Pack_V === 16.4 && cols.BEC_V === 5.1 && cols.I1_A === 9.2);
  ok('snapshot sanitises labels', cols['Motor_C_C'] === 62.5, Object.keys(cols).join('|'));
  ok('snapshot falls back for empty labels', cols.C2_C === 41);
  ok('snapshot of nothing is empty', Object.keys(sensorSnapshot(null)).length === 0);
  const dup = sensorSnapshot({ ...snapMsg, voltages: [{ label: 'V', value: 1 }, { label: 'V', value: 2 }], currents: [], temperatures: [] });
  ok('duplicate labels stay distinct', dup.V_V === 1 && dup.V2_V === 2, Object.keys(dup).join('|'));
  // A channel that drops out mid-log must not shift the columns of later rows.
  const base = { armed: 0, failsafe: 0, link: 'connected', rtt: null, bitrate: null, loss: null, fps: null, vlat: null, volt: null, amp: null, mah: null, pct: null } as const;
  const grown = logToCsv([
    { t: 0, ...base, sensors: { Pack_V: 16.4, Motor_C: 60 } },
    { t: 500, ...base, sensors: { Pack_V: 16.3 } }, // temperature sensor dropped out
    { t: 1000, ...base, sensors: { Pack_V: 16.2, Motor_C: 61, ESC_C: 55 } }, // and a new one appeared
  ]).split('\n');
  ok('csv header unions all channels', grown[0].endsWith(',Pack_V,Motor_C,ESC_C'), grown[0]);
  ok('csv keeps columns aligned', grown[2].endsWith(',16.3,,') && grown[3].endsWith(',16.2,61,55'), grown[2]);

  // ---- GPS in the blackbox + GPX export ----
  const { gpsSnapshot, hasFixRow, fixCount, logToGpx } = await import('../packages/ground/src/lib/logger');
  const fixMsg = {
    type: 'gps', source: 'sim', hasFix: true, fixType: '3d',
    lat: 48.275833, lon: 8.853611, altM: 517, satellites: 9, hdop: 0.9,
    speedMs: 3.2, courseDeg: 45, timeUtc: '2026-08-16T09:00:00Z', home: null,
  } as import('@yonderrc/protocol').GpsMessage;
  const snapFix = gpsSnapshot(fixMsg);
  ok('gps snapshot carries the fix', snapFix.lat === 48.275833 && snapFix.lon === 8.853611 && snapFix.altM === 517);
  // No fix must not log a stale position — that would look like the vehicle parked there.
  const noFix = gpsSnapshot({ ...fixMsg, hasFix: false });
  ok('no fix logs empty position', noFix.lat === null && noFix.lon === null && noFix.altM === null);
  ok('no fix still logs sats', noFix.sats === 9);
  ok('no gps at all is empty', gpsSnapshot(null).lat === null);
  ok('hasFixRow needs both coords', !hasFixRow({ t: 0, ...base, lat: 48.2, lon: null }) && hasFixRow({ t: 0, ...base, lat: 48.2, lon: 8.8 }));

  const gpsRows = [
    { t: 0, ...base, lat: null, lon: null }, // indoors, no fix yet
    { t: 500, ...base, ...snapFix },
    { t: 1000, ...base, lat: 48.276, lon: 8.854, altM: 518, sats: 10, hdop: null, speedMs: null, courseDeg: null },
  ];
  ok('fixCount ignores fixless rows', fixCount(gpsRows) === 2);
  const gpsCsv = logToCsv(gpsRows).split('\n');
  ok('csv has gps columns', gpsCsv[0].includes(',lat,lon,alt_m,sats,hdop,speed_ms,course_deg'), gpsCsv[0]);
  ok('csv writes full coordinate precision', gpsCsv[2].includes('48.2758330,8.8536110'), gpsCsv[2]);

  const started = Date.UTC(2026, 7, 16, 9, 0, 0);
  const gpx = logToGpx(gpsRows, started, 'Balingen');
  ok('gpx is well-formed enough', gpx.startsWith('<?xml') && gpx.trimEnd().endsWith('</gpx>'));
  ok('gpx skips rows without a fix', (gpx.match(/<trkpt /g) ?? []).length === 2, gpx);
  ok('gpx timestamps are absolute UTC', gpx.includes('<time>2026-08-16T09:00:00.500Z</time>'), gpx);
  ok('gpx carries elevation + sats', gpx.includes('<ele>517</ele>') && gpx.includes('<sat>9</sat>'));
  ok('gpx puts speed in the extension', gpx.includes('<gpxtpx:speed>3.2</gpxtpx:speed>'));
  ok('gpx omits the extension when empty', (gpx.match(/TrackPointExtension>/g) ?? []).length === 2, gpx);
  ok('gpx escapes the track name', logToGpx(gpsRows, started, 'A & B<x>').includes('A &amp; B&lt;x&gt;'));
  const emptyGpx = logToGpx([{ t: 0, ...base }], started);
  ok('gpx with no fixes is still valid', emptyGpx.includes('<trkseg>') && !emptyGpx.includes('<trkpt'));

  // ---- fullscreen capability detection ----
  const { supportsRealFullscreen } = await import('../packages/ground/src/lib/immersive');
  // iPhone Safari has no requestFullscreen on elements at all — the helper must
  // report that rather than throwing, because the CSS mode is then the only path.
  ok('iPhone reports no real fullscreen', supportsRealFullscreen({ documentElement: {}, fullscreenEnabled: false } as unknown as Document) === false);
  ok('Chrome reports real fullscreen', supportsRealFullscreen({ documentElement: { requestFullscreen: () => Promise.resolve() }, fullscreenEnabled: true } as unknown as Document) === true);
  ok('a blocking permissions policy counts as unsupported', supportsRealFullscreen({ documentElement: { requestFullscreen: () => Promise.resolve() }, fullscreenEnabled: false } as unknown as Document) === false);

  // ---- short button hold: toggles, and what it must NOT touch ----
  const { buttonHoldMsFor, clampButtonHoldSeconds, BUTTON_HOLD_DEFAULTS, BUTTON_HOLD_MIN_S, BUTTON_HOLD_MAX_S } =
    await import('../packages/ground/src/lib/buttonHold');
  ok('button hold defaults to 0.3 s', buttonHoldMsFor(BUTTON_HOLD_DEFAULTS) === 300);
  ok('switched off means no hold at all', buttonHoldMsFor({ ...BUTTON_HOLD_DEFAULTS, enabled: false }) === 0);
  ok('button hold clamps low', clampButtonHoldSeconds(0.001) === BUTTON_HOLD_MIN_S);
  ok('button hold clamps high', clampButtonHoldSeconds(99) === BUTTON_HOLD_MAX_S);
  ok('button hold survives nonsense', clampButtonHoldSeconds(NaN) === BUTTON_HOLD_DEFAULTS.seconds);

  const { BindingEngine: Eng } = await import('../packages/ground/src/lib/input/bindingEngine');
  const holdProfile = buildProfile('car', { inputMethod: 'touch' });
  // Give the car a toggle and a momentary channel to press.
  const tog = { ...holdProfile.bindings.find((b) => b.mode === 'toggle')! };
  const mom = holdProfile.bindings.find((b) => b.mode === 'momentary');
  const withModes = {
    ...holdProfile,
    bindings: [
      { ...tog, id: 'tog', channel: 7, mode: 'toggle' as const },
      { ...(mom ?? tog), id: 'mom', channel: 8, mode: 'momentary' as const },
    ],
  } as typeof holdProfile;
  const snapWith = (pressed: string[]) => ({
    keys: new Set<string>(),
    pressed: new Set(pressed),
    joystick: () => null,
    gamepadAxis: () => null,
    gamepadButton: () => false,
  });
  // Both bindings read from `pressed` (source 'onscreen'); force that.
  withModes.bindings = withModes.bindings.map((b) => ({ ...b, source: 'onscreen' as const, element: 'btn' }));

  const hEng = new Eng();
  const tick = (pressed: string[], ms = 50, holdMs = 300) => hEng.compute(withModes, snapWith(pressed), ms, holdMs);
  const on = (out: number[], ch: number) => out[ch] > 1500;
  // A press shorter than the hold must not flip the toggle.
  tick(['tog'], 100);
  ok('toggle ignores a brush', !on(tick([], 50), 7), 'flipped on a 100 ms press');
  // Held past the threshold it flips exactly once, however long you keep holding.
  tick(['tog'], 200);
  tick(['tog'], 200);
  ok('toggle flips after the hold', on(tick(['tog'], 50), 7));
  tick(['tog'], 1000);
  ok('and only once per press', on(tick(['tog'], 1000), 7), 'flipped back while still held');
  tick([], 50); // release
  tick(['tog'], 400);
  ok('a second held press flips it back', !on(tick(['tog'], 50), 7));

  // Momentary is never delayed — a horn has to answer immediately.
  const eng2 = new Eng();
  ok('momentary fires on the first frame', on(eng2.compute(withModes, snapWith(['mom']), 16, 300), 8));
  ok('momentary releases immediately', !on(eng2.compute(withModes, snapWith([]), 16, 300), 8));

  // With the hold switched off a toggle flips on the first frame, exactly as before.
  const eng3 = new Eng();
  ok('no hold = old rising-edge behaviour', on(eng3.compute(withModes, snapWith(['tog']), 16, 0), 7));

  // ---- live trims ----
  const { nudgeTrim, clearTrim, clampTrim, hasTrim, trimmableBindings, TRIM_LIMIT_US, TRIM_STEP_US } =
    await import('../packages/ground/src/lib/trim');
  const trimBase = buildProfile('car', { inputMethod: 'touch' });
  const steerId = trimBase.bindings.find((b) => b.mode === 'proportional')!.id;
  ok('nothing is trimmed to begin with', !hasTrim(trimBase));
  const t1 = nudgeTrim(trimBase, steerId, TRIM_STEP_US);
  ok('a nudge moves one step', t1.bindings.find((b) => b.id === steerId)!.shaping.trimUs === TRIM_STEP_US);
  ok('and shows as trimmed', hasTrim(t1));
  ok('the original profile is untouched', trimBase.bindings.find((b) => b.id === steerId)!.shaping.trimUs === 0);
  // Trim must stop at the limit rather than eating the channel's travel.
  let far = trimBase;
  for (let i = 0; i < 200; i++) far = nudgeTrim(far, steerId, TRIM_STEP_US);
  ok('trim stops at the limit', far.bindings.find((b) => b.id === steerId)!.shaping.trimUs === TRIM_LIMIT_US);
  ok('at the limit a nudge is a no-op', nudgeTrim(far, steerId, TRIM_STEP_US) === far);
  ok('reset returns to centre', clearTrim(far, steerId).bindings.find((b) => b.id === steerId)!.shaping.trimUs === 0);
  ok('clamp is symmetric', clampTrim(-9999) === -TRIM_LIMIT_US && clampTrim(9999) === TRIM_LIMIT_US);
  // Only stick axes get trims — a toggle or momentary channel has no neutral to shift.
  ok('only proportional channels are trimmable', trimmableBindings(trimBase).every((b) => b.mode === 'proportional'));
  const togId = trimBase.bindings.find((b) => b.mode !== 'proportional')?.id;
  if (togId) ok('a switch channel refuses a trim', nudgeTrim(trimBase, togId, TRIM_STEP_US) === trimBase);
  // Trim feeds the existing shaping, so the neutral really moves.
  const { shapeProportional: shapeP } = await import('../packages/protocol/src/shaping');
  const trimmedShape = t1.bindings.find((b) => b.id === steerId)!.shaping;
  ok('trim shifts the shaped neutral', shapeP(0, trimmedShape) === 1500 + TRIM_STEP_US,
    `=${shapeP(0, trimmedShape)}`);

  // ---- response curves ----
  const {
    identityCurve, applyCurve, normalizeCurve, curveIsIdentity, CURVE_SIZES, CURVE_DEFAULT_SIZE,
  } = await import('../packages/protocol/src/shaping');
  const { shapeProportional: shapeC } = await import('../packages/protocol/src/shaping');

  ok('identity curve spans -1..1', identityCurve(5).points[0] === -1 && identityCurve(5).points[4] === 1);
  ok('identity curve is evenly spaced', identityCurve(5).points.join(',') === '-1,-0.5,0,0.5,1');
  ok('identity reads as no curve', curveIsIdentity(identityCurve(CURVE_DEFAULT_SIZE)));
  ok('absent curve reads as no curve', curveIsIdentity(null) && curveIsIdentity(undefined));
  for (const n of CURVE_SIZES) {
    ok(`identity ${n}pt is a straight line`, [-1, -0.4, 0, 0.7, 1].every(
      (x) => Math.abs(applyCurve(x, identityCurve(n)) - x) < 1e-9,
    ));
  }

  // A curve interpolates linearly between its points.
  const soft = { points: [-1, -0.25, 0, 0.25, 1] }; // gentle in the middle, full at the ends
  ok('curve hits its own points', applyCurve(-0.5, soft) === -0.25 && applyCurve(0.5, soft) === 0.25);
  ok('curve interpolates between them', Math.abs(applyCurve(0.75, soft) - 0.625) < 1e-9, `=${applyCurve(0.75, soft)}`);
  ok('curve clamps its input', applyCurve(5, soft) === 1 && applyCurve(-5, soft) === -1);

  // The ends are pinned: full travel must stay reachable, because the disarmed
  // value and the pre-arm check both assume the resting stick produces the
  // channel's off value.
  const cut = normalizeCurve({ points: [-0.2, -0.1, 0, 0.1, 0.2] })!;
  ok('normalize pins the ends to ±1', cut.points[0] === -1 && cut.points[4] === 1);
  ok('normalize keeps the middle', cut.points[1] === -0.1 && cut.points[2] === 0 && cut.points[3] === 0.1);
  ok('normalize clamps out-of-range points', normalizeCurve({ points: [0, 9, 0, -9, 0] })!.points.join(',') === '-1,1,0,-1,1');
  ok('normalize repairs a bad length', normalizeCurve({ points: [0, 0, 0, 0] })!.points.length === CURVE_DEFAULT_SIZE);
  ok('normalize survives junk', normalizeCurve({ points: [NaN, NaN, NaN, NaN, NaN] })!.points.join(',') === '-1,-0.5,0,0.5,1');
  ok('normalize of nothing is null', normalizeCurve(null) === null && normalizeCurve(undefined) === null);

  // Integration with shaping: no curve must be bit-identical to before.
  const plainCh = { trimUs: 0, expo: 0, reverse: false, minUs: 1000, maxUs: 2000, failsafeUs: 1500 };
  for (const x of [-1, -0.5, 0, 0.33, 1]) {
    ok(`no curve leaves ${x} unchanged`, shapeC(x, plainCh) === shapeC(x, { ...plainCh, curve: null }));
  }
  ok('identity curve changes nothing', shapeC(0.42, { ...plainCh, curve: identityCurve(9) }) === shapeC(0.42, plainCh));
  // A real curve moves the middle but never the extremes.
  const curved = { ...plainCh, curve: soft };
  ok('curve softens the middle', shapeC(0.5, curved) === 1625, `=${shapeC(0.5, curved)}`);
  ok('curve keeps full travel at the top', shapeC(1, curved) === 2000);
  ok('curve keeps full travel at the bottom', shapeC(-1, curved) === 1000);

  // THE safety property: whatever the curve, the resting stick still produces the
  // channel's off value — so the disarmed value stays motors-off.
  const droneCurved = {
    ...drone,
    bindings: drone.bindings.map((b) => (b.channel === dch ? { ...b, shaping: { ...b.shaping, curve: soft } } : b)),
  };
  ok('a curved throttle still disarms to min', profileDisarmedUs(droneCurved)[dch] === 1000, `=${profileDisarmedUs(droneCurved)[dch]}`);
  const carCurved = {
    ...car,
    bindings: car.bindings.map((b) => (b.channel === cch ? { ...b, shaping: { ...b.shaping, curve: soft } } : b)),
  };
  ok('a curved car throttle still stops at centre', profileDisarmedUs(carCurved)[cch] === 1500, `=${profileDisarmedUs(carCurved)[cch]}`);
  // Even a curve someone tried to cut the ends off cannot break it.
  const sneaky = {
    ...drone,
    bindings: drone.bindings.map((b) => (b.channel === dch ? { ...b, shaping: { ...b.shaping, curve: { points: [-0.2, -0.1, 0, 0.1, 0.2] } } } : b)),
  };
  ok('a curve with cut ends cannot lift the disarmed value', profileDisarmedUs(sneaky)[dch] === 1000, `=${profileDisarmedUs(sneaky)[dch]}`);

  // Curve composes with reverse and expo rather than fighting them.
  ok('curve respects reverse', shapeC(0.5, { ...curved, reverse: true }) === 1375, `=${shapeC(0.5, { ...curved, reverse: true })}`);
  ok('curve and expo stack', shapeC(0.5, { ...curved, expo: 1 }) < shapeC(0.5, curved));
  // Switch channels never get one — shapeSwitch doesn't consult the curve at all.
  ok('a curve cannot affect a switch', shapeSwitch(true, curved, 1000) === shapeSwitch(true, plainCh, 1000));

  // ---- link health ----
  const { linkHealth, linkTrend, trendArrow, showLinkDetail, rttScore, lossScore, LINK_FAIR, LINK_BAD } =
    await import('../packages/ground/src/lib/linkHealth');
  ok('a perfect link scores 100', linkHealth({ rttMs: 20, lossPct: 0, signalPct: 100 }).score === 100);
  ok('and reads as good', linkHealth({ rttMs: 20, lossPct: 0, signalPct: 100 }).level === 'good');
  ok('nothing known = no score', linkHealth({ rttMs: null, lossPct: null, signalPct: null }).score === null);
  // The score is the WORST part, not an average — a perfect signal must not hide
  // 15% packet loss.
  const lossy = linkHealth({ rttMs: 20, lossPct: 15, signalPct: 100 });
  ok('one bad part drags the score down', lossy.score === 0, `=${lossy.score}`);
  ok('and it is named', lossy.worst === 'loss', `worst=${lossy.worst}`);
  ok('bad level below the threshold', lossy.level === 'bad');
  const laggy = linkHealth({ rttMs: 350, lossPct: 0, signalPct: 90 });
  ok('latency can be the culprit', laggy.worst === 'rtt' && laggy.level !== 'good', `${laggy.worst}/${laggy.level}`);
  const weakRadio = linkHealth({ rttMs: 30, lossPct: 0, signalPct: 20 });
  ok('so can the radio', weakRadio.worst === 'signal' && weakRadio.score === 20);
  // A good link names no culprit — at 95 there is nothing to fix.
  ok('a good link blames nobody', linkHealth({ rttMs: 40, lossPct: 0.5, signalPct: 95 }).worst === null);
  // Missing inputs are skipped rather than counted as zero.
  ok('a missing radio does not score 0', linkHealth({ rttMs: 20, lossPct: 0, signalPct: null }).score === 100);
  ok('parts report what was known', linkHealth({ rttMs: 20, lossPct: null, signalPct: null }).parts.loss === null);
  ok('rtt band ends where documented', rttScore(50) === 100 && rttScore(500) === 0);
  ok('loss band ends where documented', lossScore(0) === 100 && lossScore(10) === 0);
  ok('thresholds are ordered', LINK_BAD < LINK_FAIR);

  ok('a short history has no trend', linkTrend([80, 70]) === 'flat');
  ok('falling is detected', linkTrend([95, 95, 92, 60, 55, 50]) === 'down', linkTrend([95, 95, 92, 60, 55, 50]));
  ok('rising is detected', linkTrend([40, 45, 50, 85, 90, 92]) === 'up');
  // Noise must not flip the arrow back and forth.
  ok('wobble stays flat', linkTrend([80, 84, 79, 82, 81, 83]) === 'flat');
  ok('arrows match the trend', trendArrow('down') === '▼' && trendArrow('up') === '▲' && trendArrow('flat') === '');

  // The detail numbers appear by themselves once the link stops being good.
  ok('detail hidden while good', !showLinkDetail('good', false));
  ok('detail shown when fair', showLinkDetail('fair', false));
  ok('detail shown when bad', showLinkDetail('bad', false));
  ok('user can force it on', showLinkDetail('good', true));

  // ---- voice callouts ----
  const { announcementsFor, batteryRepeat, BATTERY_REPEAT_MS, SPEECH_DEFAULTS, loadSpeechCfg } =
    await import('../packages/ground/src/lib/speech');
  const sBase = { connected: true, armed: false, failsafe: false, batteryLow: false, batteryPercent: 80 };
  ok('speech is on by default', SPEECH_DEFAULTS.enabled === true);
  ok('the first observation says nothing', announcementsFor(null, sBase).length === 0);
  // The link is no longer a state comparison — it is on a clock (see linkVoice).
  ok('connecting says nothing here', announcementsFor({ ...sBase, connected: false }, sBase).length === 0);
  ok('disconnecting says nothing here', announcementsFor(sBase, { ...sBase, connected: false }).length === 0);
  ok('a steady state says nothing', announcementsFor(sBase, sBase).length === 0);
  ok('arming is announced', announcementsFor(sBase, { ...sBase, armed: true })[0].text === 'Armed');
  ok('disarming too', announcementsFor({ ...sBase, armed: true }, sBase)[0].text === 'Disarmed');
  const fs = announcementsFor(sBase, { ...sBase, failsafe: true })[0];
  ok('failsafe is announced', fs.text === 'Failsafe');
  ok('and is urgent', fs.urgent === true, 'failsafe must jump the queue');
  // A tick where several things change puts the most consequential first.
  const many = announcementsFor({ ...sBase, armed: true }, { ...sBase, armed: false, failsafe: true });
  ok('failsafe comes before armed state', many[0].text === 'Failsafe', many.map((a) => a.text).join(' | '));
  const lowMsg = announcementsFor(sBase, { ...sBase, batteryLow: true, batteryPercent: 24.6 })[0];
  ok('low battery names the percentage', lowMsg.text === 'Battery low, 25 percent', lowMsg.text);
  ok('and is urgent', lowMsg.urgent === true);
  ok('an unknown percentage still warns', announcementsFor(sBase, { ...sBase, batteryLow: true, batteryPercent: null })[0].text === 'Battery low');

  // The link runs on a clock: a blip that reconnects inside the grace period must
  // stay silent, or a WiFi roam gets announced as an outage.
  const { linkVoice, LINK_VOICE_INITIAL, LINK_LOST_GRACE_MS, LINK_WEAK_GRACE_MS } =
    await import('../packages/ground/src/lib/speech');
  const T = 1_000_000;
  const lvUp = { connected: true, qualityBad: false };
  const lvDown = { connected: false, qualityBad: false };
  const lvWeak = { connected: true, qualityBad: true };
  ok('a healthy link says nothing', linkVoice(LINK_VOICE_INITIAL, lvUp, T).say === null);
  ok('the first connect stays silent', linkVoice(LINK_VOICE_INITIAL, lvUp, T).say === null);

  // A link that never existed cannot be lost. Opening the app and not pressing
  // Connect used to announce "Link lost" two seconds later — and since browsers hold
  // speech until the page has had a user gesture, it surfaced at the next tap, which
  // made switching to Drive look like the cause.
  let never = LINK_VOICE_INITIAL;
  for (const t of [0, 500, 2000, 5000, 60000]) {
    const r = linkVoice(never, lvDown, T + t);
    never = r.next;
    ok(`never connected stays silent (+${t}ms)`, r.say === null);
  }
  ok('and it keeps no phantom outage', never.downSince === null && never.lostAnnounced === false);
  // After a real connection, the same disconnect IS announced.
  const afterConnect = linkVoice(never, lvUp, T + 61000).next;
  ok('a connection is remembered', afterConnect.everConnected === true);
  const lostNow = linkVoice(linkVoice(afterConnect, lvDown, T + 62000).next, lvDown, T + 62000 + LINK_LOST_GRACE_MS);
  ok('losing a link that existed is announced', lostNow.say?.text === 'Link lost');

  // Everything below is about a link that HAS been up (the state carries that).
  const lvSeen = linkVoice(LINK_VOICE_INITIAL, lvUp, T).next;

  // Blip: lvDown and lvBack inside the grace period — completely silent.
  let lv = linkVoice(lvSeen, lvDown, T).next;
  ok('the drop itself is not announced', linkVoice(lvSeen, lvDown, T).say === null);
  let lvStep = linkVoice(lv, lvDown, T + 1000);
  ok('still silent inside the grace period', lvStep.say === null);
  lvStep = linkVoice(lvStep.next, lvUp, T + 1100);
  ok('a blip produces no "restored" either', lvStep.say === null);
  ok('and leaves no state behind', lvStep.next.downSince === null && lvStep.next.lostAnnounced === false);

  // A real outage: announced once, and its recovery announced.
  lv = linkVoice(lvSeen, lvDown, T).next;
  lvStep = linkVoice(lv, lvDown, T + LINK_LOST_GRACE_MS);
  ok('a real outage is announced', lvStep.say?.text === 'Link lost');
  ok('and is urgent', lvStep.say?.urgent === true);
  ok('but only once', linkVoice(lvStep.next, lvDown, T + 9000).say === null);
  lvStep = linkVoice(lvStep.next, lvUp, T + 10000);
  ok('its recovery is announced', lvStep.say?.text === 'Link restored');
  ok('recovery is not urgent', lvStep.say?.urgent === false);

  // Quality: same treatment, longer grace, and a DIFFERENT pair of words so it
  // cannot be confused with the link existing or not.
  lv = linkVoice(lvSeen, lvWeak, T).next;
  ok('a quality lvDip is not announced at once', linkVoice(lvSeen, lvWeak, T).say === null);
  ok('nor inside its grace period', linkVoice(lv, lvWeak, T + LINK_WEAK_GRACE_MS - 1).say === null);
  lvStep = linkVoice(lv, lvWeak, T + LINK_WEAK_GRACE_MS);
  ok('sustained weakness is announced', lvStep.say?.text === 'Weak link');
  ok('once', linkVoice(lvStep.next, lvWeak, T + 20000).say === null);
  const lvGood = linkVoice(lvStep.next, lvUp, T + 20000);
  ok('and recovery uses different words', lvGood.say?.text === 'Link good',
    'must not be confused with "Link restored"');
  // A brief lvDip that clears before the grace never says anything at all.
  const lvDip = linkVoice(linkVoice(lvSeen, lvWeak, T).next, lvUp, T + 500);
  ok('a brief lvDip is silent', lvDip.say === null);

  // THE lvBug this replaces: a reconnect made the health score vanish, which read as
  // a transition out of "bad" and announced a recovery mid-outage.
  let lvBug = linkVoice(LINK_VOICE_INITIAL, lvWeak, T).next;
  lvBug = linkVoice(lvBug, lvWeak, T + LINK_WEAK_GRACE_MS).next; // "Weak link" said
  const duringOutage = linkVoice(lvBug, lvDown, T + 4000);
  ok('an outage never announces a quality recovery', duringOutage.say === null,
    `said "${duringOutage.say?.text}" while the link was lvDown`);
  ok('and the weakness is frozen, not cleared', duringOutage.next.weakAnnounced === true);
  // Coming lvBack starts the quality clock over rather than claiming it got better.
  const lvBack = linkVoice(duringOutage.next, lvUp, T + 4500);
  ok('reconnecting does not claim the link got better', lvBack.say === null);
  ok('and the quality clock restarts', lvBack.next.weakSince === null && lvBack.next.weakAnnounced === false);

  // The low-battery repeat runs on its own clock, not on state changes.
  const lowState = { ...sBase, batteryLow: true, batteryPercent: 20 };
  ok('no repeat while the battery is fine', batteryRepeat(sBase, null, 1_000_000) === null);
  ok('first repeat fires immediately', batteryRepeat(lowState, null, 1_000_000)?.text === 'Battery 20 percent');
  ok('and then waits', batteryRepeat(lowState, 1_000_000, 1_000_000 + BATTERY_REPEAT_MS - 1) === null);
  ok('before firing again', batteryRepeat(lowState, 1_000_000, 1_000_000 + BATTERY_REPEAT_MS)?.text === 'Battery 20 percent');
  ok('the repeat is not urgent', batteryRepeat(lowState, null, 0)?.urgent === false, 'it must not cut off a failsafe callout');
  ok('speech config survives no storage', typeof loadSpeechCfg().enabled === 'boolean');

  // ---- return-home energy budget ----
  const {
    returnBudget, consumptionRate, pushSample, odoStep, clampReservePct,
    RETURN_BUDGET_DEFAULTS, RATE_WINDOW, RATE_MIN_DISTANCE_M, ODO_MAX_STEP_M,
  } = await import('../packages/ground/src/lib/returnBudget');
  const { distanceMeters: dist } = await import('../packages/protocol/src/types/gps');
  const budgetOn = { enabled: true, reservePct: 50 };

  ok('the budget is off by default', RETURN_BUDGET_DEFAULTS.enabled === false);
  // THE requirement: a vehicle that is just a servo driver has none of these
  // inputs, and that must be silent, never an error.
  const nothing = { mah: null, capacityMah: null, homeDistanceM: null, mahPerMeter: null };
  ok('no sensors at all = unknown', returnBudget(nothing, budgetOn).status === 'unknown');
  ok('and it says why', typeof returnBudget(nothing, budgetOn).missing === 'string');
  ok('switched off = unknown even with data', returnBudget({ mah: 100, capacityMah: 2000, homeDistanceM: 100, mahPerMeter: 0.1 }, { ...budgetOn, enabled: false }).status === 'unknown');
  ok('no capacity = unknown', returnBudget({ mah: 100, capacityMah: null, homeDistanceM: 100, mahPerMeter: 0.1 }, budgetOn).status === 'unknown');
  ok('no charge counter = unknown', returnBudget({ mah: null, capacityMah: 2000, homeDistanceM: 100, mahPerMeter: 0.1 }, budgetOn).status === 'unknown');
  ok('no home point = unknown', returnBudget({ mah: 100, capacityMah: 2000, homeDistanceM: null, mahPerMeter: 0.1 }, budgetOn).status === 'unknown');
  ok('no measured rate = unknown', returnBudget({ mah: 100, capacityMah: 2000, homeDistanceM: 100, mahPerMeter: null }, budgetOn).status === 'unknown');
  ok('a zero capacity cannot divide by zero', returnBudget({ mah: 0, capacityMah: 0, homeDistanceM: 100, mahPerMeter: 0.1 }, budgetOn).status === 'unknown');
  ok('every unknown result has null numbers', [nothing, { mah: null, capacityMah: 2000, homeDistanceM: 5, mahPerMeter: 1 }]
    .every((i) => { const r = returnBudget(i, budgetOn); return r.furtherM === null && r.homeCostMah === null && r.mahPerKm === null; }));

  // Plenty of pack, close to home: keep going.
  const roomy = returnBudget({ mah: 200, capacityMah: 2000, homeDistanceM: 200, mahPerMeter: 0.1 }, budgetOn);
  ok('a healthy budget is ok', roomy.status === 'ok', `${roomy.status} further=${roomy.furtherM}`);
  ok('home cost is distance times rate', roomy.homeCostMah === 20);
  ok('remaining is capacity minus consumed', roomy.remainingMah === 1800);
  ok('rate is reported per km', roomy.mahPerKm === 100);
  // 1800 left, home costs 20*1.5=30 reserved; x = (1800-30)/(0.1*2.5) = 7080 m.
  ok('further distance uses the closed form', Math.round(roomy.furtherM!) === 7080, `=${roomy.furtherM}`);

  // Far out budgetOn a nearly empty pack: turn back.
  const spent = returnBudget({ mah: 1900, capacityMah: 2000, homeDistanceM: 800, mahPerMeter: 0.1 }, budgetOn);
  ok('an exhausted budget says turn back', spent.status === 'now', `${spent.status} further=${spent.furtherM}`);
  ok('and clamps the distance at zero', spent.furtherM === 0);
  // Exactly at the limit counts as "now", not "ok".
  const edge = returnBudget({ mah: 2000 - 100 * 1.5, capacityMah: 2000, homeDistanceM: 1000, mahPerMeter: 0.1 }, budgetOn);
  ok('the boundary turns back', edge.status === 'now', `${edge.status} further=${edge.furtherM}`);

  // A bigger reserve turns you back earlier — that is the whole point of it.
  const cautious = returnBudget({ mah: 1500, capacityMah: 2000, homeDistanceM: 1500, mahPerMeter: 0.2 }, { enabled: true, reservePct: 150 });
  const relaxed = returnBudget({ mah: 1500, capacityMah: 2000, homeDistanceM: 1500, mahPerMeter: 0.2 }, { enabled: true, reservePct: 0 });
  ok('more reserve leaves less range', cautious.furtherM! < relaxed.furtherM!, `${cautious.furtherM} vs ${relaxed.furtherM}`);
  ok('reserve is clamped', clampReservePct(-50) === 0 && clampReservePct(9999) === 200 && clampReservePct(NaN) === 50);

  // Consumption rate needs real movement before it will say anything.
  ok('no samples, no rate', consumptionRate([]) === null);
  ok('one sample, no rate', consumptionRate([{ mah: 0, odoM: 0 }]) === null);
  ok('too little distance, no rate', consumptionRate([{ mah: 0, odoM: 0 }, { mah: 50, odoM: RATE_MIN_DISTANCE_M - 1 }]) === null);
  ok('too little charge, no rate', consumptionRate([{ mah: 0, odoM: 0 }, { mah: 0.5, odoM: 1000 }]) === null);
  ok('enough of both gives a rate', consumptionRate([{ mah: 0, odoM: 0 }, { mah: 100, odoM: 1000 }]) === 0.1);
  // A standing vehicle must not produce an infinite rate.
  ok('standing still gives no rate', consumptionRate([{ mah: 0, odoM: 500 }, { mah: 50, odoM: 500 }]) === null);
  let buf: { mah: number; odoM: number }[] = [];
  for (let i = 0; i < RATE_WINDOW + 50; i++) buf = pushSample(buf, { mah: i, odoM: i * 10 });
  ok('the window is bounded', buf.length === RATE_WINDOW);
  ok('and keeps the newest', buf[buf.length - 1].mah === RATE_WINDOW + 49);
  // A counter that goes backwards has been reset. Spanning the reset gives a
  // negative delta, which made the rate vanish and reappear — and that fired the
  // turn-back callout a second time in the browser.
  ok('a charge-counter reset starts over',
    pushSample([{ mah: 100, odoM: 900 }, { mah: 180, odoM: 1500 }], { mah: 2, odoM: 1520 }).length === 1);
  ok('an odometer reset starts over',
    pushSample([{ mah: 100, odoM: 900 }], { mah: 110, odoM: 0 }).length === 1);
  ok('normal growth keeps the history',
    pushSample([{ mah: 100, odoM: 900 }], { mah: 110, odoM: 1000 }).length === 2);
  ok('a reset never yields a negative rate',
    consumptionRate(pushSample([{ mah: 500, odoM: 5000 }], { mah: 1, odoM: 5100 })) === null);

  // Odometer: drift and re-acquired fixes must not add distance that never happened.
  const odoHome = { lat: 48.2758, lon: 8.8536 };
  const odoNext = { lat: 48.2761, lon: 8.8536, speedMs: 5, hasFix: true }; // ~33 m
  ok('a real move counts', odoStep(odoHome, odoNext, dist) > 30);
  ok('no previous fix adds nothing', odoStep(null, odoNext, dist) === 0);
  ok('no fix adds nothing', odoStep(odoHome, { ...odoNext, hasFix: false }, dist) === 0);
  ok('a standing receiver does not creep', odoStep(odoHome, { ...odoNext, speedMs: 0.1 }, dist) === 0);
  ok('sub-metre jitter is ignored', odoStep(odoHome, { lat: 48.27580, lon: 8.85360, speedMs: 5, hasFix: true }, dist) === 0);
  const jump = { lat: 48.4, lon: 8.8536, speedMs: 5, hasFix: true };
  ok('an implausible jump is discarded', odoStep(odoHome, jump, dist) === 0, `=${odoStep(odoHome, jump, dist)} (limit ${ODO_MAX_STEP_M})`);
  ok('a null coordinate is safe', odoStep(odoHome, { lat: null, lon: null, speedMs: 5, hasFix: true }, dist) === 0);

  // The alarm latches, so a budget hovering at the threshold cannot nag. Without
  // this it re-announces every time consumption or distance wobbles across the line.
  const { latchReturnNow } = await import('../packages/ground/src/lib/returnBudget');
  ok('now raises the alarm', latchReturnNow(false, 'now') === true);
  ok('advise cannot raise it', latchReturnNow(false, 'advise') === false);
  ok('advise cannot clear it either', latchReturnNow(true, 'advise') === true);
  ok('only a comfortable ok clears it', latchReturnNow(true, 'ok') === false);
  ok('losing the inputs clears it', latchReturnNow(true, 'unknown') === false);
  // The flap that produced a double callout in the browser: now -> advise -> now
  // must stay raised throughout, so the transition fires exactly once.
  let latched = false;
  const flap = ['now', 'advise', 'now', 'advise', 'now'] as const;
  let raises = 0;
  for (const st of flap) {
    const next = latchReturnNow(latched, st);
    if (next && !latched) raises++;
    latched = next;
  }
  ok('a flapping budget announces once', raises === 1, `raised ${raises} times`);

  // The turn-back callout is spoken, and only when the budget is actually enabled.
  const bBase = { ...sBase, returnNow: false };
  ok('turning back is announced', announcementsFor(bBase, { ...bBase, returnNow: true })[0].text === 'Turn back now');
  ok('and is urgent', announcementsFor(bBase, { ...bBase, returnNow: true })[0].urgent === true);
  ok('a disabled budget never announces it', announcementsFor(bBase, bBase).length === 0);
  // Failsafe still outranks it in the same tick.
  const both = announcementsFor(bBase, { ...bBase, returnNow: true, failsafe: true });
  ok('failsafe is still spoken first', both[0].text === 'Failsafe', both.map((a) => a.text).join('|'));

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
