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
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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
  ok('i2c address-only guess is not confirmed', sugg[0].confirmed === false && sugg[0].kind === null);

  // ---- I²C chip identification (ID registers, not just addresses) ----
  // The collision that actually happens on a vehicle: PCA9685 and every INA2xx both
  // ship on 0x40, so the address alone can never answer "which one is this?".
  const probes = DET.probesFor(0x40);
  ok('probes cover both INA register maps', probes.some((p) => p.key === 'inaDieA' && p.reg === 0x3f) && probes.some((p) => p.key === 'inaDieB' && p.reg === 0xff));
  ok('probes include PCA9685 MODE1', probes.some((p) => p.key === 'mode1' && p.reg === 0x00 && p.bytes === 1));
  ok('probes for a BMP address', DET.probesFor(0x76).some((p) => p.reg === 0xd0));
  ok('no probes for an unknown address', DET.probesFor(0x36).length === 0);
  ok('i2ctransfer args', DET.i2cTransferArgs(1, { key: 'x', address: 0x40, reg: 0x3f, bytes: 2 }).join(' ') === '-y 1 w1@0x40 0x3f r2');
  ok('i2ctransfer output → word', DET.parseI2cTransfer('0x22 0x81') === 0x2281);
  ok('i2ctransfer output → byte', DET.parseI2cTransfer('0x58') === 0x58);
  ok('i2ctransfer error → null', DET.parseI2cTransfer('Error: Read failed') === null);
  // Real INA228: manufacturer "TI", DIE_ID 0x228 with revision 1 in the low nibble.
  const ina228 = DET.identifyI2c(0x40, { inaManufA: DET.TI_MANUFACTURER, inaDieA: 0x2281 }, true);
  ok('INA228 identified on 0x40', ina228.kind === 'ina228' && ina228.confirmed === true && ina228.device === 'INA228');
  ok('INA228 revision shown', ina228.hint.includes('rev 1'));
  const ina226 = DET.identifyI2c(0x41, { inaManufB: DET.TI_MANUFACTURER, inaDieB: 0x2260 }, false);
  ok('INA226 identified via the old register map', ina226.kind === 'ina226' && ina226.confirmed === true);
  // The PCA9685 has no ID register at all — its all-call address gives it away.
  const pca = DET.identifyI2c(0x41, { inaManufA: 0xffff, inaManufB: 0xffff, mode1: 0x11 }, true);
  ok('PCA9685 identified via all-call', pca.kind === 'pca9685' && pca.confirmed === true);
  // A driver that cleared ALLCALL takes the confirmation away — the register
  // signature still points at a PCA9685, but only as an explicit guess.
  const pcaQuiet = DET.identifyI2c(0x41, { mode1: 0xa0, mode2: 0x04, prescale: 121 }, false);
  ok('all-call off → PCA9685 only as a guess', pcaQuiet.kind === 'pca9685' && pcaQuiet.confirmed === false);
  ok('guess names the PWM frequency', pcaQuiet.hint.includes('50 Hz'));
  ok('prescale → 50 Hz', DET.pwmFrequency(121) === 50);
  const pcaNoAllCall = DET.identifyI2c(0x41, { mode1: 0x11 }, false);
  ok('no all-call and no signature → no PCA9685 claim', pcaNoAllCall.kind === null && pcaNoAllCall.confirmed === false);
  // An ADS1x15 answers those same reads with its config MSB — must not pass as a PCA.
  const adsLike = DET.identifyI2c(0x48, { mode1: 0x85, mode2: 0x85, prescale: 0x80 }, false);
  ok('ADS1x15 is not mistaken for a PCA9685', adsLike.kind === null);
  ok('0x70 stays the all-call address', DET.identifyI2c(0x70, {}, true).kind === null && /all-call/.test(DET.identifyI2c(0x70, {}, true).hint));
  ok('BME280 by chip id', DET.identifyI2c(0x76, { bmpChipId: 0x60 }, false).kind === 'bme280');
  ok('MCP9808 by manufacturer+device', DET.identifyI2c(0x18, { mcpManuf: 0x0054, mcpDevice: 0x0400 }, false).kind === 'mcp9808');
  ok('TMP117 by device id', DET.identifyI2c(0x48, { tmp117Id: 0x0117 }, false).kind === 'tmp117');
  const mixed = DET.suggestI2c([0x40, 0x41, 0x70], new Map([
    [0x40, { inaManufA: DET.TI_MANUFACTURER, inaDieA: 0x2281 }],
    [0x41, { mode1: 0x11 }],
  ]));
  ok('scan separates INA from PCA9685', mixed[0].kind === 'ina228' && mixed[1].kind === 'pca9685' && mixed[2].kind === null);

  // ---- the PCA9685 address must be settable from the setup UI ----
  // It used to be env-only, so resolving the 0x40 collision meant editing a systemd
  // unit over SSH — impossible on a vehicle reachable only over its own hotspot.
  const { loadConfig } = await import('../packages/vehicle/src/config');
  const cfgPath = join(tmpdir(), `yonderrc-cfg-test-${process.pid}.json`);
  const envCfg = process.env.YRC_CONFIG;
  const envAddr = process.env.YRC_I2C_ADDR;
  process.env.YRC_CONFIG = cfgPath;
  process.env.YRC_I2C_ADDR = '0x40';
  writeFileSync(cfgPath, JSON.stringify({ pca9685: { address: 0x41, bus: 1 } }));
  ok('persisted PCA9685 address beats the env default', loadConfig().driverOptions.pca9685?.address === 0x41);
  writeFileSync(cfgPath, JSON.stringify({}));
  ok('env address still applies when nothing is persisted', loadConfig().driverOptions.pca9685?.address === 0x40);
  rmSync(cfgPath, { force: true });
  if (envCfg === undefined) delete process.env.YRC_CONFIG; else process.env.YRC_CONFIG = envCfg;
  if (envAddr === undefined) delete process.env.YRC_I2C_ADDR; else process.env.YRC_I2C_ADDR = envAddr;
  ok('sim detect finds 0x40', (await sys.detectHardware()).i2c.some((x) => x.address === '0x40'));
  ok('sim detect lists serial', (await sys.detectHardware()).serial.length > 0);

  // ---- serial port: freeing the header UART for a GPS ----
  // Two conditions, and the non-obvious one is the login console: Raspberry Pi OS
  // pins a getty to the same UART, which shreds NMEA and looks like bad wiring.
  const SER = await import('../packages/vehicle/src/system/serial');
  const piCmdline = 'console=serial0,115200 console=tty1 root=PARTUUID=abc-02 rootfstype=ext4 fsck.repair=yes rootwait';
  ok('serial console detected', SER.serialConsoleOn(piCmdline) === true);
  ok('screen console is not a serial console', SER.serialConsoleOn('console=tty1 root=/dev/mmcblk0p2') === false);
  const strippedCmdline = SER.stripSerialConsole(piCmdline);
  ok('serial console token removed', SER.serialConsoleOn(strippedCmdline) === false);
  ok('everything else in cmdline survives', strippedCmdline.trim() === 'console=tty1 root=PARTUUID=abc-02 rootfstype=ext4 fsck.repair=yes rootwait');
  ok('ttyAMA0 console form also removed', SER.serialConsoleOn(SER.stripSerialConsole('console=ttyAMA0,115200 root=/dev/x')) === false);
  ok('uart off by default', SER.uartEnabled('dtparam=audio=on\n') === false);
  ok('uart=0 counts as off', SER.uartEnabled('enable_uart=0\n') === false);
  const uartCfg = SER.enableUart('dtparam=audio=on\nenable_uart=0\n');
  ok('uart enabled', SER.uartEnabled(uartCfg) === true);
  ok('competing line commented, not deleted', uartCfg.includes('# enable_uart=0'));
  ok('applying twice does not stack', SER.enableUart(uartCfg).split('enable_uart=1').length === 2);
  const notReady = SER.serialState(piCmdline, 'dtparam=audio=on\n');
  ok('default Pi state is not GPS-ready', notReady.ready === false && notReady.consoleOn === true && notReady.uartOn === false);
  ok('explanation names both causes', /enable_uart=1 missing/.test(SER.explainSerial(notReady)) && /login console/.test(SER.explainSerial(notReady)));
  ok('prepared state is ready', SER.serialState(strippedCmdline, uartCfg).ready === true);
  // The second trap: /dev/ttyAMA0 is the Bluetooth UART on a Pi 3/4/5. It opens
  // without error and never delivers a byte — indistinguishable from bad wiring.
  ok('ttyAMA0 warned about when serial0 is ttyS0', /Bluetooth/.test(SER.serialAliasWarning('/dev/ttyAMA0', '/dev/ttyS0') ?? ''));
  ok('serial0 itself is never warned about', SER.serialAliasWarning('/dev/serial0', '/dev/ttyS0') === null);
  ok('the alias target itself is fine', SER.serialAliasWarning('/dev/ttyS0', '/dev/ttyS0') === null);
  ok('ttyAMA0 is fine when serial0 points at it', SER.serialAliasWarning('/dev/ttyAMA0', '/dev/ttyAMA0') === null);
  ok('USB receivers are not second-guessed', SER.serialAliasWarning('/dev/ttyUSB0', '/dev/ttyS0') === null);
  const simSerial = await sys.serialPort();
  ok('sim reports the default Pi trap', simSerial.configured.ready === false);
  await sys.freeSerialPort();
  const simFreed = await sys.serialPort();
  ok('sim can free the port', simFreed.configured.ready === true && simFreed.rebootRequired === true);

  // ---- GPS: NMEA parsing + geo (distance/bearing) + sim service + home ----
  const { parseNmea, nmeaChecksumOk } = await import('../packages/vehicle/src/sensors/nmea');
  const { distanceMeters, bearingDeg, emptyFix } = await import('../packages/protocol/src/types/gps');
  // Real GGA/RMC/GSA lines (checksums valid).
  const gga = '$GPGGA,123519,4807.038,N,01131.000,E,1,08,0.9,545.4,M,46.9,M,,*47';
  const rmc = '$GPRMC,123519,A,4807.038,N,01131.000,E,022.4,084.4,230394,003.1,W*6A';
  const gsa = '$GPGSA,A,3,04,05,,09,12,,,24,,,,,2.5,1.3,2.1*39';
  ok('nmea checksum ok', nmeaChecksumOk(gga) === true);
  // Satellites in view exist long before a fix does — the number that tells an
  // operator wiring up indoors that the receiver is alive.
  const { satellitesInView } = await import('../packages/vehicle/src/sensors/nmea');
  const gsv = '$GPGSV,3,1,09,01,05,040,20,03,15,100,18,06,30,220,25,11,45,300,30*7C';
  ok('satellites in view parsed', satellitesInView(gsv) === 9, `=${satellitesInView(gsv)}`);
  ok('no GSV → null', satellitesInView(gga) === null);
  ok('nmea checksum bad', nmeaChecksumOk('$GPGGA,123519,4807.038,N*00') === false);
  const nf = parseNmea([gga, rmc, gsa].join('\n'));
  ok('nmea lat parsed', near(nf.lat!, 48.1173, 1e-3), `=${nf.lat}`);
  ok('nmea lon parsed', near(nf.lon!, 11.5167, 1e-3), `=${nf.lon}`);
  ok('nmea sats + fix', nf.satellites === 8 && nf.hasFix === true && nf.fixType === '3d');
  ok('nmea altitude', near(nf.altM!, 545.4, 0.1));
  ok('nmea speed m/s', nf.speedMs != null && nf.speedMs > 0);
  ok('nmea garbage ignored', parseNmea('hello\n$GPXXX,bad').hasFix === false);

  // The first real drive (2026-08-28) showed the home symbol, the arrow, the odometer
  // and the speed blinking in and out at 8 satellites with a solid fix. Cause: one
  // parse window = one whole fix, rebuilt from scratch, so a sentence burst cut by the
  // window boundary produced a fix with holes — and the OSD draws nothing for a null.
  const { takeCompleteLines } = await import('../packages/vehicle/src/sensors/nmea');
  const split = takeCompleteLines(`${gga}\n${rmc}\n$GPGS`);
  ok('complete lines are parsed', split.batch.includes(rmc) && !split.batch.includes('$GPGS\n'));
  ok('the half sentence waits for the next window', split.rest === '$GPGS');
  ok('a buffer without a line end is never parsed', takeCompleteLines('$GPGG').batch === '');
  const { mergeFix, FIX_HOLD_MS } = await import('../packages/vehicle/src/sensors/fixMerge');
  // Window 1: the whole burst. Window 2: only GSA survived the cut — fix, but no
  // position, which is exactly the case that made the home symbol disappear.
  const h1 = mergeFix(null, parseNmea([gga, rmc, gsa].join('\n')), 1000);
  ok('a complete window is passed through', h1.fix.lat != null && h1.fix.speedMs != null);
  const h2 = mergeFix(h1, parseNmea(gsa), 2000);
  ok('position survives a window without GGA/RMC', near(h2.fix.lat!, 48.1173, 1e-3));
  ok('satellites survive it too', h2.fix.satellites === 8);
  ok('speed survives it too', h2.fix.speedMs != null);
  // Window with GGA but no RMC: only the speed was missing on the drive.
  const h3 = mergeFix(h1, parseNmea([gga, gsa].join('\n')), 2000);
  ok('speed survives a window without RMC', h3.fix.speedMs != null && h3.fix.lat != null);
  // A held value must not outlive its usefulness: after the hold it goes.
  const stale = mergeFix(h1, parseNmea(gsa), 1000 + FIX_HOLD_MS + 1);
  ok('a held value expires', stale.fix.lat === null && stale.fix.speedMs === null);
  ok('holding does not stack', mergeFix(h2, parseNmea(gsa), 1000 + FIX_HOLD_MS + 1).fix.lat === null);
  // Silence is held; an explicit "no fix" is not — a lost fix must drop out at once.
  const noFixGga = '$GPGGA,123519,,,,,0,00,,,M,,M,,*6B';
  const lost = mergeFix(h1, parseNmea(noFixGga), 1500);
  ok('a reported loss of fix is not held', lost.fix.hasFix === false && lost.fix.lat === null);
  ok('silence keeps the fix', mergeFix(h1, parseNmea(gsv), 1500).fix.hasFix === true);
  // A source switch starts over — the old receiver's position must not survive it.
  ok('a source change drops the held fix', mergeFix(h1, emptyFix('sim'), 1500).fix.lat === null);
  // Filling a gap is not the same as inventing one: a receiver that says nothing at
  // all reports no fix, rather than a position the vehicle left minutes ago.
  const { reportedFix, FIX_STALE_MS } = await import('../packages/vehicle/src/sensors/fixMerge');
  ok('a live fix is reported as it is', reportedFix(h1.fix, 1000, 2000).lat != null);
  ok('a silent receiver reports no fix', reportedFix(h1.fix, 1000, 1000 + FIX_STALE_MS + 1).hasFix === false);
  ok('nothing ever received reports no fix', reportedFix(h1.fix, null, 2000).lat === null);
  ok('a stale report keeps the source', reportedFix(h1.fix, null, 2000).source === h1.fix.source);
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

  // ---- video quality: low by default, and actually applied ----
  {
    const { scaleCamera } = await import('../packages/vehicle/src/video/cameraManager');
    const cam4k: CameraCfg = { name: 'c', type: 'rpicam', width: 1280, height: 720, fps: 25 };
    // "Max performance at the start" means the smallest picture, not the biggest.
    ok('low is the smallest', scaleCamera(cam4k, 'low').width < scaleCamera(cam4k, 'medium').width);
    ok('and caps the bitrate hardest', (scaleCamera(cam4k, 'low').bitrateKbps ?? 0) < (scaleCamera(cam4k, 'medium').bitrateKbps ?? 0));
    ok('high is untouched', scaleCamera(cam4k, 'high').width === 1280 && scaleCamera(cam4k, 'high').bitrateKbps === undefined);
    // Scaling must not throw away the mounting transform — it is a property of the
    // camera, not of the level.
    const rotated = scaleCamera({ ...cam4k, rotation: 180, hflip: true }, 'low');
    ok('scaling keeps the orientation', rotated.rotation === 180 && rotated.hflip === true);
  }

  // ---- how long a power warning stays on screen ----
  const pa = await import('../packages/ground/src/lib/powerAlert');
  const T0 = 1_000_000;
  const live = { underVoltageNow: true, underVoltagePast: true, throttledNow: true, hotNow: false };
  const pastOnly = { underVoltageNow: false, underVoltagePast: true, throttledNow: false, hotNow: false };
  const railOk = { underVoltageNow: false, underVoltagePast: false, throttledNow: false, hotNow: false };

  ok('nothing to show when all is well', pa.powerAlert(railOk, null, T0) === null);
  ok('nothing to show without a reading', pa.powerAlert(null, null, T0) === null);
  ok('a live fault shows', pa.powerAlert(live, T0, T0)?.text === 'POWER');
  ok('and is marked live', pa.powerAlert(live, T0, T0)?.live === true);
  // The one that was wrong: it must clear itself the moment the rail recovers, without
  // anyone reloading or acknowledging anything.
  ok('a recovered rail clears the warning', pa.powerAlert(railOk, T0, T0 + 1000) === null);
  ok('a thermal clamp is named differently', pa.powerAlert({ ...live, underVoltageNow: false, hotNow: true }, T0, T0)?.text === 'HOT');
  ok('a clamp without heat is a power problem', pa.powerAlert({ ...live, underVoltageNow: false }, T0, T0)?.text === 'THROTTLED');

  // The sticky flag never clears until reboot, so it only gets a window — a permanent
  // warning is one you stop reading.
  ok('the sticky flag shows briefly', pa.powerAlert(pastOnly, T0, T0 + 5000)?.text === 'POWER?');
  ok('and is not marked live', pa.powerAlert(pastOnly, T0, T0 + 5000)?.live === false);
  ok('then goes away on its own', pa.powerAlert(pastOnly, T0, T0 + pa.PAST_ALERT_MS + 1) === null);
  ok('a live fault outranks the window', pa.powerAlert(live, T0, T0 + pa.PAST_ALERT_MS + 1)?.text === 'POWER');

  ok('the window starts when the flag first appears', pa.trackFirstPast(pastOnly, null, T0) === T0);
  ok('and does not restart while it stays set', pa.trackFirstPast(pastOnly, T0, T0 + 9999) === T0);
  ok('a vehicle reboot clears it, so the window can start over', pa.trackFirstPast(railOk, T0, T0 + 1) === null);

  // ---- the Pi's verdict on its own 5 V rail ----
  const pw = await import('../packages/vehicle/src/system/power');
  ok('parses the firmware hex', pw.parseThrottled('throttled=0x50005') === 0x50005);
  ok('parses a healthy rail', pw.parseThrottled('throttled=0x0') === 0);
  ok('unreadable is unknown, not healthy', pw.parseThrottled('command not found') === null);
  ok('unknown reports nothing', pw.powerState(null).message === null && pw.powerBadge(pw.powerState(null)) === null);
  ok('healthy reports nothing', pw.powerState(0).message === null && pw.powerBadge(pw.powerState(0)) === null);

  // The mask measured on the real Pi while a servo was browning it out.
  const real = pw.powerState(0x50005);
  ok('under-voltage now', real.underVoltageNow && real.throttledNow);
  ok('and recorded since boot', real.underVoltagePast && real.throttledPast);
  ok('not a temperature problem', !real.hotNow);
  ok('badge is POWER', pw.powerBadge(real) === 'POWER');
  ok('the message names the fix, not just the fault', /BEC/.test(real.message ?? ''));

  // A past event still matters: no headroom, fix it before the next drive.
  const past = pw.powerState(0x10000);
  ok('past under-voltage is reported', past.underVoltagePast && !past.underVoltageNow);
  ok('with a calmer badge', pw.powerBadge(past) === 'POWER?');

  // Heat is a different fix, so it must not be described as a supply problem.
  const hot = pw.powerState((1 << 2) | (1 << 3));
  ok('thermal clamp is named as such', pw.powerBadge(hot) === 'HOT' && /airflow|heatsink/.test(hot.message ?? ''));
  ok('and does not mention the supply', !/BEC/.test(hot.message ?? ''));
  const clamped = pw.powerState(1 << 2);
  ok('a clamp with no heat is treated as power', /supply/.test(clamped.message ?? ''));

  // ---- a superseded ground must not be able to steer ----
  {
    const { VehicleCore } = await import('../packages/vehicle/src/core/VehicleCore');
    const { SimDriver } = await import('../packages/vehicle/src/drivers/SimDriver');
    const core = new VehicleCore({ driver: new SimDriver() });

    const pc = core.beginControlSession();
    core.applyControl({ type: 'control', seq: 50000, t: Date.now(), channels: [1800, 1500, 1500, 1500] }, pc);
    ok('the established ground steers', core.readCommanded()[0] === 1800);

    const phone = core.beginControlSession();
    ok('a new session gets a new token', phone !== pc);
    // The straggler: a WebRTC data channel takes seconds to tear down, so the superseded
    // ground keeps sending. Its high sequence number used to pin lastSeq back up and make
    // every frame from the new ground look stale — a connected vehicle that would not steer.
    core.applyControl({ type: 'control', seq: 60000, t: Date.now(), channels: [1900, 1500, 1500, 1500] }, pc);
    ok('the superseded ground is ignored', core.readCommanded()[0] !== 1900);
    core.applyControl({ type: 'control', seq: 0, t: Date.now(), channels: [1200, 1500, 1500, 1500] }, phone);
    ok('and the new ground steers from sequence 0', core.readCommanded()[0] === 1200);

    core.applyControl({ type: 'control', seq: 1, t: Date.now(), channels: [1300, 1500, 1500, 1500] }, phone);
    ok('it keeps steering', core.readCommanded()[0] === 1300);
    core.applyControl({ type: 'control', seq: 1, t: Date.now(), channels: [1400, 1500, 1500, 1500] }, phone);
    ok('duplicates are still dropped', core.readCommanded()[0] === 1300);
    // Callers without a token (tests, future paths) keep the old newest-wins behaviour.
    core.applyControl({ type: 'control', seq: 2, t: Date.now(), channels: [1250, 1500, 1500, 1500] });
    ok('an untokened frame still applies', core.readCommanded()[0] === 1250);
  }

  // ---- signal is not a score: each radio gets its own curve ----
  const lh = await import('../packages/ground/src/lib/linkHealth');
  // The report that started this: a HiLink stick on RSRP −101 dBm reports 62 %, which
  // used to be taken straight as the score and sat under the 70 that means "good" —
  // a permanent ⚠ SIGNAL on a link with 19 dB SINR.
  ok('62 % LTE is a healthy link', lh.signalScore(62, 'lte') === 100);
  ok('and no longer drags the score down', lh.linkHealth({ rttMs: 20, lossPct: 0, signalPct: 62, signalKind: 'lte' }).level === 'good');
  ok('nothing is named as the culprit', lh.linkHealth({ rttMs: 20, lossPct: 0, signalPct: 62, signalKind: 'lte' }).worst === null);
  ok('LTE at the edge of coverage still scores 0', lh.signalScore(30, 'lte') === 0);
  ok('LTE half way is half a score', lh.signalScore(45, 'lte') === 50);
  // WiFi percentages come off a different scale (a linear map of −100…−50 dBm), so the
  // same number must not mean the same thing.
  ok('WiFi −70 dBm (60 %) is fine', lh.signalScore(60, 'wifi') === 100);
  ok('WiFi is judged more strictly at the bottom', lh.signalScore(30, 'wifi') > lh.signalScore(30, 'lte'));
  ok('a cable has no signal problem', lh.signalScore(0, 'ethernet') === 100);
  ok('a genuinely weak LTE link is still caught', lh.linkHealth({ rttMs: 20, lossPct: 0, signalPct: 38, signalKind: 'lte' }).worst === 'signal');
  ok('unknown radio defaults to the LTE curve', lh.signalScore(62) === 100);
  ok('signal never outvotes real loss', lh.linkHealth({ rttMs: 20, lossPct: 12, signalPct: 100, signalKind: 'lte' }).worst === 'loss');

  // ---- FPV link: no camera is a valid state, not an error ----
  const vl = await import('../packages/ground/src/lib/videoLink');
  ok('picks the first camera', vl.selectedCamera(['cam1', 'cam2'], '') === 'cam1');
  ok('keeps a valid pick', vl.selectedCamera(['cam1', 'cam2'], 'cam2') === 'cam2');
  ok('falls back when the pick vanished', vl.selectedCamera(['cam2'], 'cam1') === 'cam2');
  // The one that was broken: deleting every camera kept the stale id, so the panel
  // kept asking a vehicle with no streams for a stream, every few seconds, forever.
  ok('no cameras → no selection', vl.selectedCamera([], 'cam1') === '');
  ok('empty stays empty', vl.selectedCamera([], '') === '');

  ok('first retry is quick', vl.reconnectDelayMs(0) === 500);
  ok('backoff doubles at first', vl.reconnectDelayMs(2) === 2000);
  ok('brisk plateau covers a blip', vl.reconnectDelayMs(5) === 5000);
  ok('widens once it is not a blip', vl.reconnectDelayMs(12) === 15000);
  ok('slow pulse when it is gone for good', vl.reconnectDelayMs(50) === 30000);
  ok(
    'never goes backwards',
    Array.from({ length: 40 }, (_, i) => vl.reconnectDelayMs(i)).every((d, i, a) => i === 0 || d >= a[i - 1]),
  );

  // ---- stick feedback zones (centre / rim, with hysteresis) ----
  const hap = await import('../packages/ground/src/lib/haptics');
  ok('rest is centre', hap.axisZone(0, 'center') === 'center');
  ok('leaving centre needs more than entering', hap.axisZone(0.1, 'center') === 'center');
  ok('past the outer centre threshold → mid', hap.axisZone(0.2, 'center') === 'mid');
  ok('back inside → centre again', hap.axisZone(0.05, 'mid') === 'center');
  ok('rim needs 0.97', hap.axisZone(0.95, 'mid') === 'mid' && hap.axisZone(0.98, 'mid') === 'edge');
  // Holding a stick against the stop must buzz once, not chatter: leaving the rim
  // needs a bigger move than entering it did.
  ok('rim holds through jitter', hap.axisZone(0.93, 'edge') === 'edge');
  ok('rim released below 0.9', hap.axisZone(0.85, 'edge') === 'mid');
  ok('slammed from rim to centre', hap.axisZone(0.0, 'edge') === 'center');

  ok('entering centre fires', hap.zoneEvents('mid', 'center').join() === 'center');
  ok('entering the rim fires', hap.zoneEvents('mid', 'edge').join() === 'edge');
  ok('leaving is silent', hap.zoneEvents('center', 'mid').length === 0 && hap.zoneEvents('edge', 'mid').length === 0);
  ok('staying put is silent', hap.zoneEvents('edge', 'edge').length === 0);
  ok('rim is firmer than centre', hap.patternFor('edge')[0] > hap.patternFor('center')[0]);
  ok('feedback is off until asked for', hap.HAPTICS_DEFAULTS.enabled === false);

  // ---- PCA9685: only changed channels go on the wire ----
  const { channelsToWrite } = await import('../packages/vehicle/src/drivers/pca9685');
  ok('first write sends everything', channelsToWrite(null, [1, 2, 3]).join() === '0,1,2');
  ok('unchanged sends nothing', channelsToWrite([1, 2, 3], [1, 2, 3]).length === 0);
  ok('only the changed one', channelsToWrite([1, 2, 3], [1, 9, 3]).join() === '1');
  // "no value for this channel" must stay untouched, not be driven to zero.
  ok('null leaves a channel alone', channelsToWrite([1, 2, 3], [1, null, 3]).length === 0);
  ok('null on a first write too', channelsToWrite(null, [1, null, 3]).join() === '0,2');
  ok('unknown chip state rewrites all', channelsToWrite(null, [1, 1, 1]).length === 3);

  // ---- update: an update must not prune the operator's native driver modules ----
  const { restorableHwDeps, updateSteps } = await import('../packages/vehicle/src/system/update');
  ok('restorable keeps the allowlisted', restorableHwDeps(['i2c-bus', 'pigpio']).join() === 'i2c-bus,pigpio');
  ok('restorable drops anything else', restorableHwDeps(['i2c-bus', 'rm -rf /', 'left-pad']).join() === 'i2c-bus');
  ok('restorable dedupes', restorableHwDeps(['pigpio', 'pigpio']).join() === 'pigpio');
  const depSteps = updateSteps({ deps: true, ground: false } as never, undefined, [], ['i2c-bus']);
  ok(
    'update reinstalls the recorded module',
    depSteps.some((s) => s.cmd === 'npm' && s.args.join(' ') === 'install i2c-bus -w @yonderrc/vehicle --no-audit --no-fund'),
  );
  ok(
    'restore runs after the pruning install',
    depSteps.findIndex((s) => s.args.includes('--omit=optional')) <
      depSteps.findIndex((s) => s.args.includes('i2c-bus')),
  );
  const noDepSteps = updateSteps({ deps: false, ground: true } as never, undefined, [], ['i2c-bus']);
  ok('no restore when nothing was pruned', !noDepSteps.some((s) => s.args.includes('i2c-bus')));

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

  // ---- mounting orientation ----
  const cm = await import('../packages/vehicle/src/video/cameraManager');
  const plain: CameraCfg = { name: 'c', type: 'rpicam', width: 640, height: 480, fps: 20 };
  ok('no transform by default', cm.orientationArgs(plain) === '' && cm.orientationFilter(plain) === null);
  // 180° IS both mirrors, so it collapses to the same two booleans rather than being a
  // third, separately-ordered option.
  const upside = cm.orientationOf({ ...plain, rotation: 180 });
  ok('180 is both mirrors', upside.hflip && upside.vflip);
  ok('180 on rpicam', cm.orientationArgs({ ...plain, rotation: 180 }) === ' --hflip --vflip');
  ok('hflip alone', cm.orientationArgs({ ...plain, hflip: true }) === ' --hflip');
  // …which also makes "upside down, but the lens is mirrored" behave as expected.
  ok('180 + hflip cancels on that axis', cm.orientationArgs({ ...plain, rotation: 180, hflip: true }) === ' --vflip');
  ok('180 + both flips is a no-op', cm.orientationArgs({ ...plain, rotation: 180, hflip: true, vflip: true }) === '');
  ok('rpicam source carries the flags', cm.cameraSource({ ...plain, rotation: 180 }).includes('--hflip --vflip'));

  const usbCam: CameraCfg = { name: 'u', type: 'usb', device: '/dev/video0', width: 640, height: 480, fps: 30 };
  ok('usb filter for 180', cm.orientationFilter({ ...usbCam, rotation: 180 }) === 'hflip,vflip');
  // go2rtc splits exec: on whitespace, so the filter must stay a single argument.
  ok('usb filter has no spaces', !cm.orientationFilter({ ...usbCam, rotation: 180 })!.includes(' '));
  const usbSrc = cm.cameraSource({ ...usbCam, vflip: true }, 'libx264');
  ok('usb source carries -vf', usbSrc.includes('-vf vflip '));
  ok('-vf sits before the encoder', usbSrc.indexOf('-vf ') < usbSrc.indexOf('-c:v'));
  ok('no -vf when there is nothing to do', !cm.cameraSource(usbCam, 'libx264').includes('-vf'));

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

  ok('boot record current while boot id unchanged', bc.recordIsCurrent({ bootId: 'abc', booted: { autoDetect: true, overlay: null } }, 'abc'));
  ok('boot record stale after a reboot', !bc.recordIsCurrent({ bootId: 'abc', booted: { autoDetect: true, overlay: null } }, 'def'));
  ok('no record is never current', !bc.recordIsCurrent(null, 'abc'));
  ok('reboot due when the overlay changed', bc.bootedStateChanged({ autoDetect: true, overlay: null }, { autoDetect: false, overlay: 'imx519' }));
  // auto → imx519 → auto rewrites the file but changes nothing the firmware cares about.
  ok('no reboot when the effective state is unchanged', !bc.bootedStateChanged({ autoDetect: true, overlay: null }, bc.parseBootConfig(bc.applyCameraModule(bc.applyCameraModule(PI_CONFIG, 'imx519'), null))));
  ok('reboot due when only auto-detect flipped', bc.bootedStateChanged({ autoDetect: true, overlay: null }, { autoDetect: false, overlay: null }));

  ok('explain: overlay set but nothing bound', (bc.explainBootConfig({ autoDetect: false, overlay: 'imx519' }, 0) || '').includes('ribbon cable'));
  ok('explain: auto-detect found nothing', (bc.explainBootConfig({ autoDetect: true, overlay: null }, 0) || '').includes('CSI camera module'));
  ok('explain: auto off and no overlay', (bc.explainBootConfig({ autoDetect: false, overlay: null }, 0) || '').includes('never looks'));
  ok('explain: silent when a camera is there', bc.explainBootConfig({ autoDetect: true, overlay: null }, 1) === null);
  ok('catalogue has the arducam 16MP with a tuning file', !!bc.moduleById('imx519')?.tuningFile);

  // ---- switching module reconciles the camera settings ----
  const imx = bc.moduleById('imx519')!;
  const ov = bc.moduleById('ov5647')!;
  const rpiCam = { name: 'cam1', type: 'rpicam', width: 1280, height: 720, fps: 25 } as Record<string, unknown>;
  const withImxTuning = bc.reconcileCameras([{ ...rpiCam }], imx);
  ok('module with a tuning file fills it in', withImxTuning[0].tuningFile === imx.tuningFile);
  // The trap: an IMX519 tuning file is a *sensor* calibration; leaving it on an OV5647
  // silently gives that sensor the wrong colour and exposure model.
  const swapped = bc.reconcileCameras([{ ...rpiCam, tuningFile: imx.tuningFile, focus: 'manual', lensPosition: 0 }], ov);
  ok('switching sensors drops the old tuning file', swapped[0].tuningFile === undefined);
  ok('and the focus mode a fixed-focus sensor cannot use', swapped[0].focus === undefined && swapped[0].lensPosition === undefined);
  const handEntered = bc.reconcileCameras([{ ...rpiCam, tuningFile: '/home/pi/mine.json' }], ov);
  ok('a hand-entered tuning path is left alone', handEntered[0].tuningFile === '/home/pi/mine.json');
  const usb = bc.reconcileCameras([{ name: 'u', type: 'usb', width: 640, height: 480, fps: 30, tuningFile: imx.tuningFile } as Record<string, unknown>], ov);
  ok('usb cameras are untouched', usb[0].tuningFile === imx.tuningFile);
  ok('idempotent', JSON.stringify(bc.reconcileCameras(swapped, ov)) === JSON.stringify(swapped));

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
  // A phone on the vehicle's own hotspot is the first control surface anyone reaches
  // for — a keyboard default left that screen empty until someone found the editor.
  ok('car defaults to touch', buildProfile('car').inputMethod === 'touch');
  ok('and both axes land on the on-screen pad', buildProfile('car').bindings.filter((b) => b.source === 'virtual' && b.element.startsWith('joy:L')).length === 2);
  // The boat too, and on the same single stick — but its throttle must stay ratcheted:
  // the detent travels with the binding, so moving the axis must not spring it to centre.
  ok('boat defaults to touch', buildProfile('boat').inputMethod === 'touch');
  ok('boat is single-stick too', buildProfile('boat').bindings.filter((b) => b.source === 'virtual' && b.element.startsWith('joy:L')).length === 2);
  ok('and its throttle stays ratcheted', buildProfile('boat').bindings.find((b) => b.label === 'Throttle')?.detent === 'free');
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
  ok('car throttle safe = centre', throttleSafeUs(carP.bindings.find((b) => b.channel === cThr), 'car') === 1500);
  ok('car arms at centre throttle', preArmCheck(carP, neutralChannels()).ok);
  const pushed = neutralChannels();
  pushed[cThr] = 2000;
  ok('car blocked with throttle up', !preArmCheck(carP, pushed).ok);
  const planeP = buildProfile('plane'); // throttle detent free → safe at min
  const pThr = planeP.throttleChannels[0];
  ok('plane throttle safe = min', throttleSafeUs(planeP.bindings.find((b) => b.channel === pThr), 'plane') === 1000);
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

  // The rest position is the resting stick through the channel's own shaping — not the
  // detent alone, which got two templates wrong.
  {
    const boatP = buildProfile('boat'); // ratcheted ('free') throttle, centre = stop
    const bThr = boatP.throttleChannels[0];
    ok('a boat throttle rests at centre — stop', throttleSafeUs(boatP.bindings.find((b) => b.channel === bThr), 'boat') === 1500);
    ok('a boat arms with the throttle at stop', preArmCheck(boatP, neutralChannels()).ok);
    const fullReverse = neutralChannels();
    fullReverse[bThr] = 1000;
    ok('and no longer only at full reverse', !preArmCheck(boatP, fullReverse).ok);
    ok('the message names the centre', /centre/.test(preArmCheck(boatP, fullReverse).message ?? ''));
    const boatLow = { ...boatP, throttleLimit: { steps: [40, 70, 100] as [number, number, number], step: 0 as const } };
    const boatStop = neutralChannels();
    ok('the limiter keeps a boat at stop', TL.applyThrottleLimit(boatLow, boatStop)[bThr] === 1500);
    const boatFull = neutralChannels();
    boatFull[bThr] = 2000;
    ok('and caps it around stop, both ways', TL.applyThrottleLimit(boatLow, boatFull)[bThr] === 1700);
    boatFull[bThr] = 1000;
    ok('reverse included', TL.applyThrottleLimit(boatLow, boatFull)[bThr] === 1300);

    // A reversed plane throttle: idle is 2000 µs.
    const revPlane = {
      ...planeP,
      bindings: planeP.bindings.map((b) => (b.channel === pThr ? { ...b, shaping: { ...b.shaping, reverse: true } } : b)),
    };
    ok('a reversed throttle idles at max', throttleSafeUs(revPlane.bindings.find((b) => b.channel === pThr), 'plane') === 2000);
    const revIdle = neutralChannels();
    revIdle[pThr] = 2000;
    ok('a reversed plane arms at idle', preArmCheck(revPlane, revIdle).ok);
    const revFull = neutralChannels();
    revFull[pThr] = 1000;
    ok('and not at full throttle any more', !preArmCheck(revPlane, revFull).ok);
    ok('the message says idle', /idle/.test(preArmCheck(revPlane, revFull).message ?? ''));
    const revHalf = { ...revPlane, throttleLimit: { steps: [50, 70, 100] as [number, number, number], step: 0 as const } };
    ok('the limiter leaves a reversed idle where it is', TL.applyThrottleLimit(revHalf, revIdle)[pThr] === 2000);
    ok('and halves full throttle towards it', TL.applyThrottleLimit(revHalf, revFull)[pThr] === 1500);

    // A throttle on a switch rests "off" — what the engine sends when it is released.
    const switchThr = { ...carP.bindings.find((b) => b.channel === cThr)!, mode: 'momentary' as const, detent: 'low' as const };
    ok('a switch throttle rests at its off end', throttleSafeUs(switchThr, 'car') === switchThr.shaping.minUs);
  }

  // ---- the status strip stays a rectangle ----
  // The grid is four columns wide (two on a phone). Nine cells leaves one stranded on a
  // row of its own, which is what adding "Link gaps" did until Vehicle and Driver — one
  // fact, both fixed for the life of a connection — were merged into one cell.
  {
    const strip = readFileSync('packages/ground/src/components/StatusStrip.tsx', 'utf8');
    const cells = (strip.match(/<div className="stat">/g) ?? []).length;
    ok('the strip divides by the grid', cells === 8 && cells % 4 === 0, `${cells} cells`);
    ok('and still names the driver', /\{vehicleName \|\| '—'\}\{driver \? ` · \$\{driver\}` : ''\}/.test(strip));
  }

  // A budget-less counter cannot warn. The panel used to show "Used: 2.24 GB" and
  // nothing else, which reads exactly like a working warning.
  {
    const html = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    ok('a missing allowance says so instead of looking fine', /no allowance set, so nothing can warn/.test(html));
    ok('and the overview flags it too', /no allowance set/.test(html) && /u\.budgetBytes == null \? 'warn'/.test(html));
  }

  // ---- tick boxes are tick-box sized ----
  // `input { width: 100% }` is right for text fields and wrong for a checkbox, which in
  // a row-flex label inherited it and stretched across the whole line — every tick box
  // on the setup page sat somewhere in the middle of its own label (measured: 194-477 px
  // instead of 13). Five checkboxes and the telemetry "primary" radios were affected.
  {
    const html = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    ok('a checkbox in a .chk label is not stretched',
      /\.chk input\[type='checkbox'\], \.chk input\[type='radio'\] \{[^}]*width: auto/.test(html));
  }

  // ---- the data budget has a home in the UI ----
  {
    const html = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    ok('the budget panel exists on the network tab',
      /<section class="panel" data-tab="network">\s*<div class="eyebrow">Mobile data budget<\/div>/.test(html));
    ok('it has the four settings that matter',
      ['dataEnabled', 'dataSource', 'dataBudget', 'dataWarn', 'dataResetDay'].every((id) => html.includes(`id="${id}"`)));
    // "counted" must be the default in the markup as well as in the config: the option
    // that works with every uplink is the safe one to fall back on.
    ok('the vehicle-side count is the first option',
      html.indexOf('value="counted"') < html.indexOf('value="hilink"'));
    ok('and the live row names its source', /function renderDataLive/.test(html) && /the stick's own month counter/.test(html));
  }

  // ---- the data plan nobody notices until it is gone ----
  // An FPV stream costs ~0.5-1 GB/h and says nothing about it. Everything here is about
  // producing a number that is honest enough to warn on.
  {
    const T = await import('../packages/vehicle/src/system/traffic');

    const PROC = [
      'Inter-|   Receive                                                |  Transmit',
      ' face |bytes    packets errs drop fifo frame compressed multicast|bytes    packets errs drop fifo colls carrier compressed',
      '    lo:  123456     900    0    0    0     0          0         0   123456     900    0    0    0     0       0          0',
      '  eth1: 1722575572 900000  0    0    0     0          0         0 657320314  400000   0    0    0     0       0          0',
      ' wlan0:  50000000  40000   0    0    0     0          0         0  10000000   20000   0    0    0     0       0          0',
      'tailscale0: 900 9 0 0 0 0 0 0 800 8 0 0 0 0 0 0',
    ].join('\n');
    const dev = T.parseProcNetDev(PROC);
    ok('the header rows are not interfaces', dev.every((d) => !d.name.includes('|')));
    ok('rx is column 0 and tx is column 8',
      dev.find((d) => d.name === 'eth1')?.rx === 1722575572 && dev.find((d) => d.name === 'eth1')?.tx === 657320314);
    // A name that runs straight into its numbers ("tailscale0:" with no padding) still
    // has to parse — splitting on whitespace loses it.
    ok('a name with no padding still parses', !!dev.find((d) => d.name === 'tailscale0'));

    // A tunnel's bytes leave again through the real uplink; counting both counts twice,
    // and all three remote-access backends this project offers are tunnels.
    ok('loopback is not metered', !T.isMeteredIface('lo'));
    ok('tunnels are not metered (they would double-count)',
      !T.isMeteredIface('tailscale0') && !T.isMeteredIface('wg0') && !T.isMeteredIface('ztabcdef'));
    ok('the LTE stick is metered', T.isMeteredIface('eth1'));
    // wg-quick names the interface after its config file, and the vehicle's is
    // /etc/wireguard/yonderrc.conf — so it is "yonderrc", which no wg* pattern catches.
    ok('the vehicle’s own WireGuard tunnel is not metered', !T.isMeteredIface('yonderrc'));
    ok('nor its OpenVPN tunnel', !T.isMeteredIface('tunyrc') && !T.isMeteredIface('tapyrc'));
    // The one that would ruin the feature: a ground station on the vehicle's own AP
    // pulls the whole video stream for free, ~900 MB an hour of traffic that costs
    // nothing and would empty a 4 GB budget in an afternoon on the bench.
    ok('the radio is free while it serves the vehicle hotspot',
      !T.isMeteredIface('wlan0', { wifiMode: 'ap' }));
    ok('and metered while it is a client on someone else\'s network',
      T.isMeteredIface('wlan0', { wifiMode: 'client' }));

    // ---- accumulation ----
    const t0 = T.emptyTrafficState('2026-08-01T00:00:00.000Z');
    const a = T.foldTraffic(t0, [{ name: 'eth1', rx: 1000, tx: 500 }]);
    // The counter is an absolute since the interface came up. On a box that has been
    // running for days, charging it on first sight claims traffic we never measured —
    // and it made "Reset counter" jump straight back up on the very next sample.
    ok('the first sight only sets the mark, it charges nothing', a.usedBytes === 0);
    ok('but the mark is kept', a.lastSeen.eth1.rx === 1000);
    const b = T.foldTraffic(a, [{ name: 'eth1', rx: 3000, tx: 1500 }]);
    ok('later samples add the delta, not the total', b.usedBytes === 2000 + 1000);
    // /proc counters are per-boot and per-device-instance: a reboot, or a USB stick
    // re-plugged, restarts them at zero. Subtracting the old high value would go
    // negative; treating the new value as a delta from zero is the honest reading.
    // A restart IS charged in full: `lastSeen` is persisted across one, so this branch
    // is the one that sees a rebooted Pi, and those bytes really were used.
    const c = T.foldTraffic(b, [{ name: 'eth1', rx: 100, tx: 50 }]);
    ok('a restarted counter adds its whole value, never a negative', c.usedBytes === b.usedBytes + 150);
    ok('and the total never goes backwards', c.usedBytes > b.usedBytes);
    // An interface that vanished must not lose its mark, or its traffic is counted
    // from scratch the moment it returns.
    const d = T.foldTraffic(c, []);
    ok('a missing interface keeps its high-water mark', d.lastSeen.eth1.rx === 100 && d.usedBytes === c.usedBytes);

    // ---- billing period ----
    ok('no reset day means it never rolls on its own',
      !T.shouldRollPeriod('2026-01-01T00:00:00.000Z', new Date(2026, 7, 28), null));
    ok('a period started before this month\'s reset day has rolled',
      T.shouldRollPeriod('2026-07-02T00:00:00.000Z', new Date(2026, 7, 28), 1));
    ok('a period started after it has not',
      !T.shouldRollPeriod('2026-08-02T00:00:00.000Z', new Date(2026, 7, 28), 1));
    // Before the day arrives, the current period is the one that began LAST month.
    ok('the boundary falls back a month when the day has not come yet',
      T.periodBoundaryOnOrBefore(new Date(2026, 7, 5), 20).getMonth() === 6);
    // A plan that resets on the 31st still has to reset in February.
    ok('the 31st is clamped to the length of the month',
      T.periodBoundaryOnOrBefore(new Date(2026, 1, 28), 31).getDate() === 28);

    // ---- warning ----
    const GB = 1024 ** 3;
    ok('no budget never warns', T.usageLevel(99 * GB, null, 80) === 'ok');
    ok('below the threshold is quiet', T.usageLevel(3 * GB, 4 * GB, 80) === 'ok');
    ok('at the threshold it warns', T.usageLevel(3.2 * GB, 4 * GB, 80) === 'warn');
    ok('past the budget it is over, not merely warning', T.usageLevel(4.1 * GB, 4 * GB, 80) === 'over');

    ok('bytes read like a person wrote them',
      T.formatBytes(900) === '900 B' && T.formatBytes(5 * 1024 ** 2) === '5.0 MB' && T.formatBytes(2.5 * GB) === '2.50 GB');
    ok('the label carries the budget when there is one', T.usageLabel(2.5 * GB, 4 * GB) === '2.50 GB / 4.00 GB');
    ok('and just the usage when there is not', T.usageLabel(2.5 * GB, null) === '2.50 GB');

    // Persist rarely, lose little: 5 s writes would be ~17k SD-card writes a day, and
    // saving only on shutdown loses everything to the brownout this project warns about.
    ok('a quiet minute does not write', !T.shouldPersist(1024, 60_000));
    ok('a big transfer writes early', T.shouldPersist(25 * 1024 ** 2, 1000));
    ok('and time alone writes eventually', T.shouldPersist(0, 6 * 60_000));

    // ---- the allowance ----
    // The stick already holds the plan the operator typed into its own web UI and
    // enforces it. Making them retype it here — and warning about nothing until they do —
    // is the same silent no-op as a `chargeSource` that never took effect.
    ok('an explicit allowance wins', T.effectiveBudgetBytes(4096, 3 * GB) === 4096 * 1024 ** 2);
    ok("an unset one falls back to the stick's limit", T.effectiveBudgetBytes(null, 3 * GB) === 3 * GB);
    ok('with neither there is no budget at all', T.effectiveBudgetBytes(null, null) === null);
    ok('and a zero limit is not a budget', T.effectiveBudgetBytes(0, 0) === null);

    // ---- the stick's own numbers ----
    const H = await import('../packages/vehicle/src/system/hilink');
    const monthXml = '<?xml version="1.0" encoding="UTF-8"?><response>' +
      '<CurrentMonthDownload>1722575380</CurrentMonthDownload><CurrentMonthUpload>657320266</CurrentMonthUpload>' +
      '<MonthLastClearTime>2026-08-21</MonthLastClearTime></response>';
    const m = H.parseMonthStatistics(monthXml);
    ok('the stick\'s month is down + up', m.monthBytes === 1722575380 + 657320266);
    ok('and it names the day it was cleared', m.monthSince === '2026-08-21');
    // A stick that answered with nothing has not said "zero" — it has said nothing, and
    // reporting 0 GB used would be a wrong answer rather than a missing one.
    ok('no answer is unknown, not zero', H.parseMonthStatistics('').monthBytes === null);
    ok('an API error is unknown too',
      H.parseMonthStatistics('<response><error><code>125002</code></error></response>').monthBytes === null);
    const sd = H.parseStartDate('<response><StartDay>1</StartDay><DataLimit>3GB</DataLimit><trafficmaxlimit>3221225472</trafficmaxlimit></response>');
    ok('the enforced byte limit wins over the pretty string', sd.limitBytes === 3221225472 && sd.startDay === 1);
    ok('and the pretty string is the fallback',
      H.parseStartDate('<response><StartDay>7</StartDay><DataLimit>500MB</DataLimit></response>').limitBytes === 500 * 1024 ** 2);
    ok('a bare number means MB, the stick\'s own unit', T.parseDataLimit('500') === 500 * 1024 ** 2);
    ok('an unset limit is null, not zero', T.parseDataLimit('0') === null && T.parseDataLimit('') === null);
  }

  // ---- the link gaps nobody can see ----
  // A watchdog trip lasts one control tick: every channel snaps to failsafe and back
  // inside 50 ms, the blackbox samples at 2 Hz and misses it, and the operator is left
  // with "something flickered". Measured on the reference vehicle on 2026-08-28: 13
  // arrival gaps over 300 ms in 60 seconds on an indoor LTE/hotspot link, i.e. one
  // invisible failsafe episode every few seconds. This counter is the only record.
  {
    const LQ = await import('../packages/ground/src/lib/linkQuality');
    const fold = (samples: Array<[boolean, number]>) =>
      samples.reduce((q, [failsafeActive, lastFrameAgeMs]) => LQ.foldLinkQuality(q, { failsafeActive, lastFrameAgeMs }), LQ.LINK_QUALITY_ZERO);

    // Every connection opens in failsafe with age -1: `resetControlLink()` zeroes
    // `lastFrameAt`, so the vehicle is "link lost" until the first frame lands. That is
    // a session that has not started, and counting it would stamp a 1 on every connect.
    ok('a fresh connection is not a dropout', fold([[true, -1], [true, -1], [false, 4]]).dropouts === 0);
    ok('and -1 is not the worst gap either', fold([[true, -1], [false, 4]]).worstGapMs === 4);

    ok('a healthy link stays at zero', fold([[false, 4], [false, 12], [false, 8]]).dropouts === 0);
    ok('one trip is one dropout', fold([[false, 4], [true, 340], [false, 6]]).dropouts === 1);
    // The vehicle reports failsafe on every status frame while it lasts (20 Hz), so
    // counting ticks instead of edges would turn a single 1-second dropout into 20.
    ok('a held failsafe is still one episode',
      fold([[false, 4], [true, 340], [true, 700], [true, 1200], [false, 6]]).dropouts === 1);
    ok('two separate trips count twice',
      fold([[false, 4], [true, 340], [false, 6], [true, 380], [false, 5]]).dropouts === 2);
    ok('the worst gap is kept, not the last one', fold([[false, 4], [true, 426], [false, 6]]).worstGapMs === 426);

    const d = (q: unknown, w = 300) => LQ.describeLinkQuality(q as never, w);
    ok('nothing seen yet reads as a dash', d(LQ.LINK_QUALITY_ZERO).text === '—' && d(LQ.LINK_QUALITY_ZERO).level === 'none');
    ok('a clean link says so with its margin', d(fold([[false, 40]])).text === 'clean · 40 ms worst');
    ok('and is good, not merely silent', d(fold([[false, 40]])).level === 'ok');
    // The case with no other way of being noticed: nothing has failed, but the link is
    // spending its margin. 180 of 300 ms is already two thirds gone.
    ok('a link close to the watchdog warns before it trips', d(fold([[false, 200]])).level === 'near');
    ok('a dropout outranks the margin', d(fold([[false, 4], [true, 340], [false, 6]])).level === 'bad');
    ok('and the count leads the text', d(fold([[false, 4], [true, 340], [false, 6]])).text === '1 · 340 ms worst');
    // A slower watchdog moves the line with it rather than hardcoding 180 ms.
    ok('the threshold follows the vehicle\'s own watchdog', d(fold([[false, 200]]), 1000).level === 'ok');
  }

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

  // ---- the two hardware guides must not drift apart either ----
  // Same rule as the READMEs, and the guide is where the wiring lives: a German
  // reader following a section the English one has since corrected is the worst case.
  {
    const en = readFileSync('docs/HARDWARE.md', 'utf8');
    const de = readFileSync('docs/HARDWARE.de.md', 'utf8');
    const heads = (t: string) => (t.match(/^#{2,3} /gm) ?? []).length;
    ok('the same sections in both hardware guides', heads(en) === heads(de), `${heads(en)} vs ${heads(de)}`);
  }

  // ---- …nor the quick start and the troubleshooting guide ----
  // Written for people new to Linux; a German reader following steps the English guide
  // has since changed is exactly the person who cannot tell.
  {
    const heads = (t: string) => (t.match(/^#{2,3} /gm) ?? []).length;
    for (const name of ['QUICKSTART', 'TROUBLESHOOTING']) {
      const en = readFileSync(`docs/${name}.md`, 'utf8');
      const de = readFileSync(`docs/${name}.de.md`, 'utf8');
      ok(`the same sections in both ${name} guides`, heads(en) === heads(de), `${heads(en)} vs ${heads(de)}`);
      ok(`${name} links its translation both ways`, en.includes(`[Deutsch](${name}.de.md)`) && de.includes(`[English](${name}.md)`));
    }
    {
      const en = readFileSync('provisioning/README.md', 'utf8');
      const de = readFileSync('provisioning/README.de.md', 'utf8');
      ok('the same sections in both provisioning READMEs', heads(en) === heads(de), `${heads(en)} vs ${heads(de)}`);
    }
    const readme = readFileSync('README.md', 'utf8');
    const readmeDe = readFileSync('README.de.md', 'utf8');
    ok('the READMEs point newcomers at the quick start',
      readme.includes('docs/QUICKSTART.md') && readmeDe.includes('docs/QUICKSTART.de.md'));
    ok('and at the troubleshooting guide',
      readme.includes('docs/TROUBLESHOOTING.md') && readmeDe.includes('docs/TROUBLESHOOTING.de.md'));
    const qs = readFileSync('docs/QUICKSTART.md', 'utf8');
    // The two things the user report asked for explicitly.
    ok('the quick start says to address the I²C chips before installing', /0x41/.test(qs) && qs.indexOf('0x41') < qs.indexOf('## 6.'));
    ok('and how to copy the files without root', /not root/.test(qs) && /SFTP/.test(qs));
    ok('the issue template asks for the diagnostics file', /Download diagnostics/.test(readFileSync('.github/ISSUE_TEMPLATE/bug_report.md', 'utf8')));
    ok('shell scripts keep LF on any checkout', /^\*\.sh\s+text eol=lf/m.test(readFileSync('.gitattributes', 'utf8')));
  }

  // ---- one theme, both halves ----
  // The vehicle owns the look: the setup page and the ground app are one product, and a
  // per-device toggle is how the two ends end up disagreeing with nobody able to say
  // which is right. So the ground has no switch — only a cache of the last answer.
  {
    const TH = await import('../packages/ground/src/lib/theme');
    const store = new Map<string, string>();
    const fake = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    };
    ok('light until the vehicle says otherwise', TH.cachedTheme(fake) === 'light');
    TH.rememberTheme(fake, 'dark');
    ok('the last answer is remembered', TH.cachedTheme(fake) === 'dark');
    store.set(TH.THEME_KEY, 'neon');
    ok('a junk value falls back to the default', TH.cachedTheme(fake) === TH.DEFAULT_THEME);
    // Storage can throw outright (private mode), not just come back empty.
    ok('unreadable storage is not fatal', TH.cachedTheme({ getItem: () => { throw new Error('denied'); } }) === 'light');
    ok('only the two are themes', TH.isTheme('light') && TH.isTheme('dark') && !TH.isTheme('auto') && !TH.isTheme(null));

    const cfgPath2 = join(tmpdir(), `yonderrc-theme-test-${process.pid}.json`);
    const envCfg2 = process.env.YRC_CONFIG;
    process.env.YRC_CONFIG = cfgPath2;
    writeFileSync(cfgPath2, JSON.stringify({}));
    const vehicleDefault = loadConfig().theme;
    ok('light is the vehicle default', vehicleDefault === 'light');
    // Both ends must agree on what "nothing chosen yet" looks like, or a fresh browser
    // paints one thing while the vehicle believes the other.
    ok('and the ground app defaults to the same', TH.DEFAULT_THEME === vehicleDefault);
    writeFileSync(cfgPath2, JSON.stringify({ theme: 'dark' }));
    ok('the saved choice survives a restart', loadConfig().theme === 'dark');
    rmSync(cfgPath2, { force: true });
    if (envCfg2 === undefined) delete process.env.YRC_CONFIG; else process.env.YRC_CONFIG = envCfg2;

    // Every colour the two pages use is a token; a hardcoded hex outside the palette
    // blocks would simply not switch. The ground's video stage is the one deliberate
    // exception (it keeps the dark palette over the picture) and is commented as such.
    const css = readFileSync('packages/ground/src/styles.css', 'utf8');
    ok('the ground has a light palette', /:root\[data-theme='light'\]\s*\{[^}]*--bg:/.test(css));
    ok('the video stage keeps the dark one', /:root\[data-theme='light'\] \.video-stage\s*\{[^}]*--danger:/.test(css));
    // …and it must SET a colour, not inherit one: inheritance passes the computed value,
    // so an OSD span with no class of its own would arrive carrying the page's ink and
    // land dark-on-dark over video the moment the page went light.
    ok('and states its own text colour', /\.video-stage \{[^}]*color: var\(--text\);/s.test(css));
    // --bad/--go were used in eight places and defined nowhere: an unresolvable var()
    // is invalid at computed-value time, so the NO-DATA badge lost its background and
    // .osd-warn inherited its colour instead of turning red.
    ok('every token the CSS uses is defined', [...css.matchAll(/var\((--[a-z0-9-]+)/g)].every((m) => css.includes(`${m[1]}:`)));

    const setup = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    ok('the setup page has a light palette', /:root\[data-theme='light'\]/.test(setup));
    ok('and a Design tab to pick it', /data-tab="design"/.test(setup) && /data-theme-pick="light"/.test(setup));
  }

  // ---- the ground's Setup is folded, not a wall ----
  // Same shape as the vehicle's setup page: the long explanations sit behind a one-line
  // summary, and the Safety group — settings you set once per model — starts closed.
  {
    const cp = readFileSync('packages/ground/src/components/ControlsPanel.tsx', 'utf8');
    ok('the long notes are collapsed', (cp.match(/<Hint summary=/g) ?? []).length >= 8);
    const groups = [...cp.matchAll(/<details className="group"([^>]*)>/g)];
    const heads = [...cp.matchAll(/<summary className="eyebrow">([A-Za-z- ]+)/g)].map((m) => m[1].trim());
    ok('every settings group folds', groups.length === 8, `${groups.length} groups`);
    ok('and every one of them starts closed', groups.every((g) => !/\bopen\b/.test(g[1])));
    ok('the groups are the ones we expect', heads.join(',') ===
      'Safety,Return-home budget,Stick feedback,Voice callouts,Auto-disarm on reconnect,Action bindings,Low-battery warning,Blackbox logging', heads.join(','));
    // A warning you have to unfold is not a warning: the two forced-auto-disarm notes
    // live outside the group they belong to, and must stay there.
    ok('the forced-auto-disarm warnings stay outside the fold',
      cp.indexOf('warn-note') > cp.indexOf('<summary className="eyebrow">Auto-disarm on reconnect') &&
      cp.indexOf('warn-note') > cp.lastIndexOf('</details>', cp.indexOf('warn-note')));
  }

  // ---- what the Pi says about itself ----
  // Ported from YonderGate, trimmed to what a vehicle can act on. Each reading exists
  // because it explains a failure that otherwise looks like a bug in this software.
  {
    const H = await import('../packages/vehicle/src/system/health');
    ok('millidegrees become degrees', H.parseCpuTemp('54321\n') === 54.3);
    ok('a missing sensor is null, not zero', H.parseCpuTemp('') === null);
    ok('uptime is the first field of /proc/uptime', H.parseUptime('123456.78 98765.43') === 123457);
    ok('load is the 1-minute figure', H.parseLoad('0.42 0.31 0.28 1/123 4567') === 0.42);
    const df = H.parseDf('Filesystem 1M-blocks Used Available Use% Mounted on\n/dev/root 30000 19000 9800 66% /');
    ok('df gives free MB and percent', df.freeMb === 9800 && df.usedPercent === 66);
    ok('df with no data line is null', H.parseDf('').freeMb === null);
    const td = H.parseTimedatectl('NTP=yes\nNTPSynchronized=no\nTimezone=Europe/Berlin');
    ok('the clock state is read as three values, not two', td.ntpEnabled === true && td.synced === false);
    ok('an unreadable timedatectl says "unknown", not "fine"', H.parseTimedatectl('').synced === null);
    ok('the time server is named', H.parseTimesyncServer('Server: 162.159.200.1 (time.cloudflare.com)') === '162.159.200.1');

    // The explanation must lead with what to act on first, and stay silent when there
    // is nothing to say — a warning that is always on is not a warning.
    const ok0 = { ...H.HEALTH_UNKNOWN, cpuTempC: 48, load1: 0.2, uptimeS: 3600, diskFreeMb: 8000, clockSynced: true };
    ok('a healthy box says nothing', H.explainHealth(ok0) === null);
    ok('heat is named first, with what it does', /clamps its clock/.test(H.explainHealth({ ...ok0, cpuTempC: 81 }) ?? ''));
    ok('a full card is named before the clock',
      /MB left/.test(H.explainHealth({ ...ok0, diskFreeMb: 100, clockSynced: false }) ?? ''));
    // The clock's whole point on a vehicle: it is what breaks the update, with an error
    // that points nowhere near the time.
    ok('the clock explains the certificate error', /certificate error/.test(H.explainHealth({ ...ok0, clockSynced: false }) ?? ''));
    ok('load is mentioned last, as an explanation for jitter',
      /jitter/.test(H.explainHealth({ ...ok0, load1: 4 }) ?? ''));
    ok('uptime reads like a person wrote it',
      H.formatUptime(400000) === '4 d 15 h' && H.formatUptime(3900) === '1 h 5 min' && H.formatUptime(120) === '2 min');
    ok('and an unknown uptime is a dash', H.formatUptime(null) === '—');
  }

  // ---- the setup page's tabs ----
  // Fourteen panels in one column were unfindable, so each panel now declares the tab
  // it belongs to. Three ways that can rot silently: a panel with no tab (invisible on
  // every tab), a tab name only the panel knows (a button that shows nothing), and a
  // button the switcher's own list doesn't contain (a dead tab).
  {
    const html = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    const panels = [...html.matchAll(/<section class="panel"([^>]*)>/g)].map((m) => m[1]);
    const tabsOf = panels.map((a) => /data-tab="([a-z]+)"/.exec(a)?.[1] ?? null);
    const buttons = [...html.matchAll(/<button class="tab"[^>]*data-for="([a-z]+)"/g)].map((m) => m[1]);
    const listed = /const TABS = \[([^\]]*)\]/.exec(html)?.[1] ?? '';
    const inList = [...listed.matchAll(/'([a-z]+)'/g)].map((m) => m[1]);
    ok('every setup panel names a tab', tabsOf.length > 0 && tabsOf.every((t) => t !== null), `${tabsOf.filter((t) => !t).length} without`);
    ok('every panel tab has a button', tabsOf.every((t) => t !== null && buttons.includes(t)));
    ok('every tab button has a panel', buttons.length > 0 && buttons.every((b) => tabsOf.includes(b)));
    ok('the switcher knows exactly those tabs', inList.join(',') === buttons.join(','), `${inList} vs ${buttons}`);
    // The overview is what a fresh page shows; losing it would land nobody anywhere.
    ok('the overview carries the system status', /data-tab="overview"[\s\S]{0,200}id="status"/.test(html));

    // ---- which charge counter is actually running ----
    // `chargeSource: 'auto'` states a wish, not an outcome: it degrades to Pi
    // integration whenever the primary current channel is not an INA228, and the mAh
    // keep coming either way — only their accuracy changes. The resolved answer
    // (`chargeFrom` from /api/telemetry/live) has to be on the page, or the degrade is
    // invisible. It used to live in an OSD tooltip and a startup log line, i.e. nowhere
    // a phone can reach.
    ok('the resolved charge counter has a place on the page', /id="charge-live"/.test(html));
    ok('and something fills it', /function renderChargeLive\(\)/.test(html) && /live\.chargeFrom === 'sensor'/.test(html));
    ok('it is refreshed on the poll, not only on load', /renderDevices\(\);\s*\n\s*renderChargeLive\(\);/.test(html));
    // "off" and "not counting" must not read as "counting on the Pi" — that would be a
    // wrong answer rather than a missing one.
    ok('telemetry off and counting off are their own answers',
      /Telemetry is off/.test(html) && /Coulomb counting is off/.test(html));
    ok('the overview names the counter too', /devRow\('· counter'/.test(html));
  }

  // ---- one version, three places ----
  // The banner, the setup header and the update check all show it; a hardcoded copy
  // in the service was one more thing to forget on release day.
  const { readVersion } = await import('../packages/vehicle/src/config');
  const pkgVersion = JSON.parse(readFileSync('package.json', 'utf8')).version as string;
  ok('the vehicle reads its version from package.json', readVersion() === pkgVersion, `${readVersion()} vs ${pkgVersion}`);
  {
    // The masthead and the diagnostics file both read GROUND_VERSION — one literal to bump.
    const app = readFileSync('packages/ground/src/App.tsx', 'utf8');
    ok('and the ground version agrees', app.includes(`export const GROUND_VERSION = '${pkgVersion}';`));
    ok('which is what the masthead shows', app.includes('ground · v{GROUND_VERSION}'));
  }
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
  // 20 % is RSRP ≈ −127 dBm — the edge of coverage. The score is no longer the raw
  // percentage (see signalScore), but the radio is still correctly named as the culprit.
  const weakRadio = linkHealth({ rttMs: 30, lossPct: 0, signalPct: 20, signalKind: 'lte' });
  ok('so can the radio', weakRadio.worst === 'signal' && weakRadio.level === 'bad', `worst=${weakRadio.worst} score=${weakRadio.score}`);
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

  // ---- the watchdog: 500 ms, and the old default is not a choice ----
  // A user report: "it keeps going in and out of failsafe". 300 ms was tighter than the
  // jitter of the links this runs on (13 gaps > 300 ms per minute measured on LTE at 0 %
  // loss), and the setup page saved the field on every Save — so a stored 300 is the old
  // default, not a decision, until a v1.70 save marks it as one.
  {
    const P = await import('../packages/protocol/src/channels');
    const { resolveWatchdogMs, loadConfig: lc } = await import('../packages/vehicle/src/config');
    ok('the watchdog default is 500 ms', P.WATCHDOG_TIMEOUT_MS === 500);
    ok('nothing stored → the default', resolveWatchdogMs(undefined, 500) === 500);
    ok('a stored pre-v1.70 default is not a choice', resolveWatchdogMs(300, 500) === 500);
    ok('a 300 saved since v1.70 is one', resolveWatchdogMs(300, 500, true) === 300);
    ok('any other stored value is kept', resolveWatchdogMs(700, 500) === 700);
    ok('the environment still decides when nothing is stored', resolveWatchdogMs(undefined, 800) === 800);
    ok('a typo cannot make it permanent failsafe', resolveWatchdogMs(50, 500, true) === P.WATCHDOG_MIN_MS);
    ok('nor switch it off', resolveWatchdogMs(50000, 500) === P.WATCHDOG_MAX_MS);
    ok('garbage falls back to the default', P.clampWatchdogMs(Number('x')) === 500);

    const cfgPath = join(tmpdir(), `yonderrc-wd-test-${process.pid}.json`);
    const envCfg = process.env.YRC_CONFIG;
    process.env.YRC_CONFIG = cfgPath;
    writeFileSync(cfgPath, JSON.stringify({ watchdogTimeoutMs: 300 }));
    ok('a vehicle configured before v1.70 runs 500 ms', lc().watchdogTimeoutMs === 500);
    writeFileSync(cfgPath, JSON.stringify({ watchdogTimeoutMs: 300, watchdogChosen: true }));
    ok('and one that chose 300 since keeps it', lc().watchdogTimeoutMs === 300);
    rmSync(cfgPath, { force: true });
    if (envCfg === undefined) delete process.env.YRC_CONFIG; else process.env.YRC_CONFIG = envCfg;

    const setup = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    ok('the setup page no longer falls back to 300', !/watchdogTimeoutMs[^\n]*\b300\b/.test(setup));
    ok('and explains when to raise it', /raise it if the vehicle flickers in and out of failsafe/.test(setup));
  }

  // ---- what the control link delivered, measured at the vehicle ----
  {
    const { LinkStats, gapsOver, EPISODES_KEPT } = await import('../packages/vehicle/src/core/linkStats');
    const s = new LinkStats(0);
    s.beginSession(1, 0);
    s.frame(1000, 'ws'); s.frame(1020, 'ws'); s.frame(1040, 'webrtc'); s.frame(1490, 'webrtc');
    let snap = s.snapshot(1500);
    ok('frames are counted per transport', snap.frames.ws === 2 && snap.frames.webrtc === 2);
    ok('gaps land in their buckets', snap.gaps.buckets[0].count === 2 && snap.gaps.buckets.find((b) => b.upToMs === 500)!.count === 1);
    ok('the longest gap is kept', snap.gaps.maxMs === 450);
    ok('gaps over a watchdog are countable', gapsOver(snap, 300) === 1 && gapsOver(snap, 500) === 0);
    s.observeFailsafe(true, 2000);
    snap = s.snapshot(2300);
    ok('a running episode counts with its length so far',
      snap.failsafe.episodes === 1 && snap.failsafe.totalMs === 300 && snap.failsafe.recent[0].durationMs === null);
    ok('and names the transport of the last frame before it', snap.failsafe.recent[0].via === 'webrtc');
    s.observeFailsafe(true, 2100);
    s.observeFailsafe(false, 2600);
    snap = s.snapshot(3000);
    ok('a held failsafe is one episode', snap.failsafe.episodes === 1 && snap.failsafe.longestMs === 600 && snap.failsafe.recent[0].durationMs === 600);
    s.beginSession(2, 4000);
    s.frame(9000, 'ws');
    snap = s.snapshot(9000);
    ok('no gap is measured across two connections', snap.gaps.maxMs === 450 && snap.sessions === 2 && snap.current.frames === 1);
    s.dropped('stale');
    s.dropped('superseded');
    snap = s.snapshot(9000);
    ok('refused frames are counted by reason', snap.frames.staleDropped === 1 && snap.frames.supersededDropped === 1);
    for (let n = 0; n < EPISODES_KEPT + 10; n++) {
      s.observeFailsafe(true, 10000 + n * 10);
      s.observeFailsafe(false, 10005 + n * 10);
    }
    snap = s.snapshot(20000);
    ok('only the recent episodes are kept in full', snap.failsafe.recent.length === EPISODES_KEPT && snap.failsafe.episodes === EPISODES_KEPT + 11);

    // Closing the app is parking, not a dropout: found live, where one closed tab showed up
    // as an "episode" lasting until the next ground connected.
    const park = new LinkStats(0);
    park.beginSession(1, 0);
    park.frame(100, 'ws');
    park.observeFailsafe(true, 700);
    park.endSession(1, 900);
    park.observeFailsafe(true, 5000);
    let ps = park.snapshot(60000);
    ok('a dropout running when the ground disconnects is closed there', ps.failsafe.episodes === 1 && ps.failsafe.recent[0].durationMs === 200 && ps.failsafe.recent[0].endedBy === 'disconnect');
    ok('and the parked vehicle afterwards is not one', ps.failsafe.totalMs === 200);
    park.endSession(7, 61000);
    park.beginSession(2, 62000);
    park.observeFailsafe(true, 63000);
    park.beginSession(3, 63500);
    ps = park.snapshot(64000);
    ok('a new ground taking over ends the old episode', ps.failsafe.recent[1].durationMs === 500 && ps.failsafe.recent[1].endedBy === 'new ground');

    const { VehicleCore } = await import('../packages/vehicle/src/core/VehicleCore');
    const { SimDriver } = await import('../packages/vehicle/src/drivers/SimDriver');
    const core = new VehicleCore({ driver: new SimDriver() });
    const a = core.beginControlSession();
    core.applyControl({ type: 'control', seq: 5, t: Date.now(), channels: [] }, a, 'webrtc');
    core.applyControl({ type: 'control', seq: 4, t: Date.now(), channels: [] }, a, 'webrtc');
    core.beginControlSession();
    core.applyControl({ type: 'control', seq: 9, t: Date.now(), channels: [] }, a, 'webrtc');
    const cs = core.link.snapshot(Date.now());
    ok('the core feeds the link statistics',
      cs.frames.webrtc === 1 && cs.frames.staleDropped === 1 && cs.frames.supersededDropped === 1 && cs.sessions === 2);
    ok('the running driver is reported, not the configured one', core.driverKind === 'sim');
    core.setWatchdogTimeout(700);
    ok('the watchdog applies live', core.watchdogMs === 700);
    core.setWatchdogTimeout(Number.NaN);
    ok('and refuses what is not a number', core.watchdogMs === 700);
  }

  // ---- the diagnostics file: nothing secret leaves the box ----
  {
    const D = await import('../packages/vehicle/src/system/diagnostics');
    // Assembled at runtime: a literal in Tailscale's key format trips GitHub secret scanning.
    const FAKE_TS = ['tskey', 'auth', ''].join('-');
    const r = (s: string) => D.redactSecrets(s);
    ok('a WireGuard private key is masked', !r('PrivateKey = yAnz5TF+lXXJte14tji3zlMNq+hd2rYUIgJBgB3fBmk=').includes('yAnz5'));
    ok('a password pair is masked', !r('password: hunter2').includes('hunter2') && !r('802-11-wireless-security.psk:hunter2').includes('hunter2'));
    ok('a secret in a URL query is masked', !r('GET /api/diagnostics?secret=s3cr3t&x=1').includes('s3cr3t'));
    ok('a Tailscale auth key is masked', !r(`tailscale up --authkey=${FAKE_TS}kAbC123-xyz`).includes('kAbC123'));
    ok('a pending Tailscale login is masked', !r('Login: https://login.tailscale.com/a/1a2b3c4d').includes('1a2b3c4d'));
    ok('a SIM PIN argument is masked', !r('mmcli -m 0 --pin=4711').includes('4711'));
    ok('credentials in a URL are masked', !r('rtsp://admin:geheim@192.168.1.20/stream').includes('geheim'));
    ok('the hotspot key in its status message is masked', !r('Hotspot "YonderRC-setup" is up (WPA2, key s3cr3tpw) — join it').includes('s3cr3tpw'));
    ok('inline OpenVPN keys are masked', !r('<key>\n-----BEGIN PRIVATE KEY-----\nMIIEvQ\n-----END PRIVATE KEY-----\n</key>').includes('MIIEvQ'));
    ok('a PEM private key is masked anywhere', !r('-----BEGIN RSA PRIVATE KEY-----\nAAAAB3\n-----END RSA PRIVATE KEY-----').includes('AAAAB3'));
    ok('a coordinate pair is masked', !r('[gps] auto-home set at 48.275812, 8.853601 (9 sats)').includes('48.2758'));
    ok('ordinary log lines survive', r('[link] ground connected from 192.168.4.2') === '[link] ground connected from 192.168.4.2');
    ok('a certificate is not a secret', r('<ca>\nPUBLICCERT\n</ca>').includes('PUBLICCERT'));

    const stored = {
      vehicleName: 'Buggy',
      apiSecret: 'API-SECRET-1',
      lte: { apn: 'internet.telekom', pin: '4321', password: 'APN-PW-1' },
      hotspot: { ssid: 'YonderRC-setup', password: 'HOTSPOT-PW-1', mode: 'always' },
      remoteAccess: {
        kind: 'wireguard',
        tailscaleAuthKey: FAKE_TS + 'LEAK1',
        wireguardConf: '[Interface]\nPrivateKey = WGPRIVATEKEYAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\nAddress = 10.0.0.2/32\n[Peer]\nPublicKey = x\nEndpoint = vpn.example.org:51820\n',
      },
      gps: { source: 'serial-nmea', autoHome: true, minSats: 6, home: { lat: 48.27581, lon: 8.85361, altM: 517 } },
    };
    const red = JSON.stringify(D.redactConfig(stored));
    ok('no secret survives the config redaction',
      ['API-SECRET-1', '4321', 'APN-PW-1', 'HOTSPOT-PW-1', FAKE_TS + 'LEAK1', 'WGPRIVATEKEY', '48.27581'].every((x) => !red.includes(x)), red);
    ok('but what helps debugging stays',
      red.includes('internet.telekom') && red.includes('wireguard') && red.includes('vpn.example.org') && red.includes('Buggy'));
    ok('a set secret reads as set, an unset one as unset',
      /"apiSecret":"\(set\)"/.test(red) && D.redactConfig({ apiSecret: null }).apiSecret === null);
    const gpsMsg = D.stripPosition({ type: 'gps', hasFix: true, lat: 48.2, lon: 8.8, satellites: 9, home: { lat: 48.2, lon: 8.8 } });
    ok('a GPS message loses its position but keeps the fix', gpsMsg!.lat === undefined && gpsMsg!.satellites === 9 && typeof gpsMsg!.home === 'string');
    ok('redactDeep keeps the shape', JSON.stringify(D.redactDeep({ a: ['psk=x1y2'], n: 3 })) === '{"a":["psk=***"],"n":3}');

    ok('power save on', D.parsePowerSave('Power save: on') === true);
    ok('power save off', D.parsePowerSave('Power save: off') === false);
    ok('power save unknown', D.parsePowerSave('command failed: No such device (-19)') === null);
    ok('the OS name is read', D.parseOsRelease('PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nID=debian') === 'Debian GNU/Linux 12 (bookworm)');
    const mem = D.parseMeminfo('MemTotal:        3884136 kB\nMemFree:  1000 kB\nMemAvailable:    2900000 kB');
    ok('memory is read in MB', mem.totalMb === 3793 && mem.availableMb === 2832);
    const kl = D.interestingKernelLines(['usb 1-1.2: new device', 'hwmon hwmon1: Undervoltage detected!', 'brcmf_cfg80211_scan: scan error', 'random noise']);
    ok('only the kernel lines that explain something', kl.length === 2 && /Undervoltage/.test(kl[0]));
    const st = D.summariseStreams({ cam: { producers: [{ url: 'exec:rpicam-vid' }], consumers: [{}, {}] }, test: { producers: [{ error: 'exit status 1' }] } });
    ok('go2rtc streams are summarised', st!.cam.producers === 1 && st!.cam.consumers === 2 && st!.test.errors[0] === 'exit status 1');
    ok('a report file name is safe everywhere',
      D.diagnosticsFileName('My Car / v2', new Date(2026, 9, 20, 14, 5)) === 'yonderrc-diagnostics-My-Car-v2-20261020-1405.json');

    // ---- … and it says what it means ----
    const { LinkStats } = await import('../packages/vehicle/src/core/linkStats');
    const { powerState } = await import('../packages/vehicle/src/system/power');
    const quiet = new LinkStats(0);
    const base = {
      systemKind: 'real', watchdogMs: 500, link: quiet.snapshot(60000), uptimeS: 600, loopDelay: { p99Ms: 3, maxMs: 9 },
      power: powerState(0), wifi: { mode: 'client', powerSave: false, signalDbm: -55 },
      driver: { configured: 'pca9685', running: 'pca9685', error: null }, health: null, memoryAvailableMb: 900,
    };
    ok('a healthy vehicle has nothing to say', D.vehicleFindings(base).length === 0, JSON.stringify(D.vehicleFindings(base)));
    const fell = D.vehicleFindings({ ...base, driver: { configured: 'pca9685', running: 'sim', error: 'i2c-bus not available' } });
    ok('a driver that fell back to sim is the first thing said', fell[0]?.level === 'bad' && fell[0].area === 'driver' && /i2c-bus/.test(fell[0].text));
    ok('a sim driver on a real vehicle is mentioned', D.vehicleFindings({ ...base, driver: { configured: 'sim', running: 'sim', error: null } })[0]?.area === 'driver');
    ok('a past brownout is a warning', D.vehicleFindings({ ...base, power: powerState(0x10000) })[0]?.area === 'power');
    const ps = D.vehicleFindings({ ...base, wifi: { mode: 'client', powerSave: true, signalDbm: -55 } });
    ok('WiFi power saving is named with its fix', ps[0]?.area === 'wifi' && /power_save off/.test(ps[0].fix ?? ''));
    ok('but not on the vehicle’s own hotspot', D.vehicleFindings({ ...base, wifi: { mode: 'ap', powerSave: true, signalDbm: null } }).length === 0);
    const flaky = new LinkStats(0);
    flaky.beginSession(1, 0);
    flaky.frame(1000, 'ws'); flaky.frame(1400, 'ws'); flaky.frame(1420, 'ws');
    flaky.observeFailsafe(true, 5000); flaky.observeFailsafe(false, 5700);
    const lf = D.vehicleFindings({ ...base, link: flaky.snapshot(6000) });
    ok('failsafe episodes are reported with their length', lf.some((f) => f.area === 'link' && /1 failsafe episode/.test(f.text) && /700 ms/.test(f.text)));
    ok('and gaps the old 300 ms watchdog would have tripped on', lf.some((f) => /pre-v1\.70\.0 default/.test(f.text)));
    ok('a stalling vehicle is told apart from the network',
      D.vehicleFindings({ ...base, loopDelay: { p99Ms: 80, maxMs: 300 } })[0]?.area === 'vehicle');
  }

  // ---- the service's own log, kept for the report ----
  {
    const { LogBuffer, captureConsole } = await import('../packages/vehicle/src/system/logBuffer');
    const lb = new LogBuffer(3);
    for (const t of ['a', 'b', 'c', 'd']) lb.push('log', t, 0);
    ok('the log keeps only the newest lines', lb.size === 3 && lb.tail().map((l) => l.text).join('') === 'bcd');
    lb.push('warn', 'x'.repeat(5000), 0);
    ok('one huge line cannot flood it', lb.tail(1)[0].text.length < 2100);
    const cap = new LogBuffer(10);
    const quietLog = console.log;
    console.log = () => {};
    const restore = captureConsole(cap);
    console.log('[test] captured %d', 7);
    restore();
    console.log = quietLog;
    ok('console output is captured, formatted', cap.tail().some((l) => l.text === '[test] captured 7'));
    ok('and the console is restored', console.log === quietLog);
  }

  // ---- the ground's half: was it the network, or did this app stop sending? ----
  {
    const G = await import('../packages/ground/src/lib/diagnostics');
    const s = G.emptySendLoop(0);
    for (let n = 0; n < 100; n++) G.recordSendTick(s, 20, n * 20, false);
    ok('a steady loop has no stalls', s.stalls === 0 && s.ticks === 100 && s.buckets[0] === 100);
    G.recordSendTick(s, 1000, 3000, true);
    G.recordSendTick(s, 150, 3200, false);
    ok('stalls are counted, hidden ones apart', s.stalls === 2 && s.stallsHidden === 1 && s.maxMs === 1000);
    ok('and the long ones can be compared with the watchdog', G.sendGapsOver(s, 500) === 1);
    const hiddenOnly = G.groundFindings({
      sendLoop: s, watchdogMs: 500, dropouts: 1, rtt: null, connected: true,
      controller: { inputMethod: 'touch', active: null, listed: 0 },
    });
    ok('a stall longer than the watchdog is a failsafe nobody else caused',
      hiddenOnly[0]?.level === 'bad' && /longer than the vehicle's 500 ms watchdog/.test(hiddenOnly[0].text));
    ok('and a hidden page is named as the reason', /background tabs/.test(hiddenOnly[0].fix ?? ''));
    const steady = G.emptySendLoop(0);
    for (let n = 0; n < 50; n++) G.recordSendTick(steady, 20, n * 20, false);
    const net = G.groundFindings({
      sendLoop: steady, watchdogMs: 500, dropouts: 3, rtt: { p95: 90 }, connected: true,
      controller: { inputMethod: 'gamepad', active: null, listed: 1 },
    });
    ok('dropouts with a steady loop point at the network or the vehicle', net.some((f) => f.area === 'link' && /sent on time and arrived late/.test(f.text)));
    ok('a gamepad model without a controller is flagged', net.some((f) => f.area === 'controller' && f.level === 'bad'));
    const rs = new G.RttSamples();
    [40, 50, 60, 70, 400].forEach((v) => rs.push(v));
    const sum = rs.summary()!;
    ok('round-trips are summarised', sum.n === 5 && sum.min === 40 && sum.max === 400 && sum.p50 === 60);
    const merged = G.mergeReports({ v: 1 }, [{ level: 'warn', area: 'ground', text: 'g' }], { findings: [{ level: 'bad', area: 'driver', text: 'v' }], vehicle: { name: 'x' } }, null);
    ok('the merged file carries both halves and all findings',
      (merged.findings as unknown[]).length === 2 && (merged.vehicle as { name: string }).name === 'x' && merged.generatedBy === 'ground');
    ok('the vehicle half is fetched from the control link’s host, secret as a query',
      G.diagnosticsUrlFromWs('ws://192.168.4.1:8080', 'a b&c') === 'http://192.168.4.1:8080/api/diagnostics?secret=a%20b%26c');
    ok('wss maps to https', G.diagnosticsUrlFromWs('wss://car.example:8443', null) === 'https://car.example:8443/api/diagnostics');
    const ev = new G.EventLog();
    for (let n = 0; n < 400; n++) ev.push('link', `e${n}`, n);
    ok('the timeline is bounded', ev.list().length === 300 && ev.list()[299].detail === 'e399');
  }

  // ---- the game controller is the controller, not the headset ----
  // A user report: "the browser was trying to use my audio headset as a joystick". The
  // provider took the first device the Gamepad API listed.
  {
    const GP = await import('../packages/ground/src/lib/input/gamepadPick');
    const headset = { index: 0, id: 'Logitech G PRO X Gaming Headset (Vendor: 046d Product: 0aaa)', mapping: '', axes: 0, buttons: 4 };
    const ds4 = { index: 1, id: 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)', mapping: 'standard', axes: 4, buttons: 17 };
    const ds4own = { index: 1, id: '054c-09cc-Wireless Controller', mapping: '', axes: 6, buttons: 14 };
    const motion = { index: 2, id: 'Sony Interactive Entertainment Wireless Controller Motion Sensors', mapping: '', axes: 6, buttons: 0 };
    const touch = { index: 3, id: 'Sony Interactive Entertainment Wireless Controller Touchpad', mapping: '', axes: 2, buttons: 1 };
    const radio = { index: 0, id: 'EdgeTX RadioMaster TX16S Joystick (Vendor: 1209 Product: 4f54)', mapping: '', axes: 8, buttons: 24 };
    const volume = { index: 0, id: 'USB Device (Vendor: 1b3f Product: 2008)', mapping: '', axes: 1, buttons: 3 };
    ok('the headset loses to the controller', GP.choosePad([headset, ds4], null)?.id === ds4.id);
    ok('also when the controller reports its own layout', GP.choosePad([headset, ds4own], null)?.id === ds4own.id);
    ok('a headset alone is never picked automatically', GP.choosePad([headset], null) === null);
    ok('an unnamed volume knob is not a controller', GP.choosePad([volume], null) === null);
    ok('the pad’s Linux side devices are recognised', !GP.assessPad(motion).likely && !GP.assessPad(touch).likely);
    ok('so the pad wins over its own motion sensors', GP.choosePad([motion, touch, ds4own], null)?.id === ds4own.id);
    ok('an RC transmitter in joystick mode counts', GP.assessPad(radio).likely);
    ok('an explicit choice wins, even a doubtful one', GP.choosePad([headset, ds4], headset.id)?.id === headset.id);
    ok('a chosen pad that is gone falls back to the best match', GP.choosePad([headset, ds4], 'Xbox 360 Controller')?.id === ds4.id);
    ok('everything is still listed, likely ones first', GP.rankPads([headset, motion, ds4]).map((p) => p.index).join() === '1,0,2');
    ok('a resting trigger is not learned', GP.movedAxis([0, 0, -1, 0], [0.01, 0, -1, 0]) === -1);
    ok('a moved stick is', GP.movedAxis([0, 0, -1, 0], [0, 0, -1, 0.9]) === 3);
    ok('a pulled trigger is too', GP.movedAxis([0, 0, -1, 0], [0, 0, 0.2, 0]) === 2);
    ok('a button already held is not learned', GP.newlyPressed([true, false], [true, false]) === -1 && GP.newlyPressed([true, false], [true, true]) === 1);
    ok('labels drop the vendor suffix', GP.padLabel(ds4.id) === 'Wireless Controller' && GP.padLabel(ds4own.id) === 'Wireless Controller');
    const mem = new Map<string, string>();
    const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v), removeItem: (k: string) => void mem.delete(k) };
    GP.savePadPref(store, ds4.id);
    ok('the choice is remembered by name', GP.loadPadPref(store) === ds4.id);
    GP.savePadPref(store, null);
    ok('and automatic forgets it', GP.loadPadPref(store) === null);
    ok('unreadable storage is not fatal', GP.loadPadPref({ getItem: () => { throw new Error('denied'); }, setItem: () => {} }) === null);
    const picker = readFileSync('packages/ground/src/components/ControllerPicker.tsx', 'utf8');
    ok('the controller group folds and starts closed like the others', /<details className="group" onToggle=/.test(picker) && !/<details className="group"[^>]*\bopen\b/.test(picker));
    ok('and sits in Setup › Controls', readFileSync('packages/ground/src/components/ControlsPanel.tsx', 'utf8').includes('<ControllerPicker input={input} />'));
  }

  // ---- OpenVPN (experimental): an uploaded profile must not be a way to run code ----
  {
    const O = await import('../packages/vehicle/src/system/openvpn');
    const profile = [
      'client', 'dev tun', 'proto udp', 'remote vpn.example.org 1194', 'nobind',
      'script-security 2', 'up /etc/openvpn/update-resolv-conf', 'down /etc/openvpn/update-resolv-conf',
      'management 0.0.0.0 7505', 'log /etc/passwd', 'block-outside-dns', 'redirect-gateway def1',
      'auth-user-pass',
      '<ca>', '-----BEGIN CERTIFICATE-----', 'CAONLY', '-----END CERTIFICATE-----', '</ca>',
      '<key>', '-----BEGIN PRIVATE KEY-----', 'KEYDATA', '-----END PRIVATE KEY-----', '</key>',
    ].join('\r\n');
    const s = O.sanitiseOvpn(profile, { authFile: O.OVPN_AUTH_PATH });
    const active = s.conf.split('\n').filter((l) => l.trim() && !l.trim().startsWith('#'));
    const has = (d: string) => active.some((l) => l.trim().split(/\s+/)[0] === d);
    ok('script hooks are removed', !has('up') && !has('down') && !has('script-security'));
    ok('so are the management port and file writes', !has('management') && !has('log'));
    ok('and Windows-only options', !has('block-outside-dns'));
    ok('what was removed is listed', ['script-security', 'up', 'down', 'management', 'log', 'block-outside-dns'].every((d) => s.removed.includes(d)));
    ok('the vehicle keeps its own uplink by default', !has('redirect-gateway') && s.conf.includes('pull-filter ignore "redirect-gateway"'));
    ok('unless all traffic is wanted through the VPN',
      O.sanitiseOvpn(profile, { fullTunnel: true }).conf.includes('redirect-gateway def1') && !O.sanitiseOvpn(profile, { fullTunnel: true }).conf.includes('pull-filter'));
    ok('the interface gets a known name', active.includes(`dev ${O.OVPN_TUN_IFACE}`) && !active.includes('dev tun'));
    ok('inline certificates and keys stay intact', s.conf.includes('CAONLY') && s.conf.includes('KEYDATA'));
    ok('credentials come from the vehicle’s own file', active.includes(`auth-user-pass ${O.OVPN_AUTH_PATH}`) && s.needsAuth);
    ok('Windows line endings are gone', !s.conf.includes('\r'));
    ok('a usable profile is not refused', O.ovpnRefusal(s, true) === null);
    ok('but one that wants a password without one is', /username and password/.test(O.ovpnRefusal(s, false) ?? ''));
    const files = O.sanitiseOvpn('client\nremote a.example 1194\nca ca.crt\ncert me.crt\nkey me.key\n');
    ok('separate certificate files are named', files.externalFiles.join() === 'ca ca.crt,cert me.crt,key me.key');
    ok('and explained', /certificates inline/.test(O.ovpnRefusal(files, false) ?? ''));
    ok('a server config is not a client profile', O.sanitiseOvpn('port 1194\ndev tun\nserver 10.8.0.0 255.255.255.0\n').problems.length === 2);
    ok('a <connection> block carries its own remote',
      O.sanitiseOvpn('client\n<connection>\nremote a.example 1194 udp\n</connection>\n').problems.length === 0);
    ok('a cut-off file is caught', /never closed/.test(O.sanitiseOvpn('client\nremote a 1\n<ca>\nXYZ\n').problems.join()));
    ok('inline credentials need no form', !O.sanitiseOvpn('client\nremote a 1\nauth-user-pass\n<auth-user-pass>\nu\np\n</auth-user-pass>\n').needsAuth);
    ok('a tap profile keeps being tap', O.sanitiseOvpn('client\nremote a 1\ndev tap0\n').conf.includes(`dev ${O.OVPN_TAP_IFACE}`));
    ok('the plausibility check', O.looksLikeOvpn(profile) && !O.looksLikeOvpn('[Interface]\nPrivateKey = x\n'));
    ok('the credentials file is two lines, no injected third', O.ovpnAuthFile('me\nevil', 'pw') === 'meevil\npw\n');
    ok('a rejected login is explained', /rejected the username\/password/.test(O.explainOvpnLog(['AUTH: Received control message: AUTH_FAILED']) ?? ''));
    ok('so is an unreachable server', /no answer from the server/.test(O.explainOvpnLog(['TLS Error: TLS key negotiation failed to occur within 60 seconds']) ?? ''));
    ok('a working tunnel needs no explanation', O.explainOvpnLog(['Initialization Sequence Completed']) === null);
    // The sudoers file must name exactly what RealSystem runs, or a non-root setup fails.
    const sudoers = readFileSync('provisioning/yonderrc.sudoers', 'utf8');
    ok('sudoers allows exactly the OpenVPN commands that are run',
      [O.OVPN_ENABLE_ARGS, O.OVPN_RESTART_ARGS, O.OVPN_STOP_ARGS].every((a) => sudoers.includes(`/usr/bin/${a.join(' ')}`)));
    ok('the installer installs OpenVPN', /apt-get install -y[^\n]*\bopenvpn\b/.test(readFileSync('provisioning/install.sh', 'utf8')));
    const html = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    ok('the setup page offers it, marked experimental', /<option value="openvpn">[^<]*experimental/.test(html) && /id="remote-openvpn"/.test(html));

    // Through the simulated system: the same refusals as on a vehicle.
    const { SimSystem } = await import('../packages/vehicle/src/system/SimSystem');
    const simSys = new SimSystem();
    ok('the sim refuses what a vehicle would refuse', !(await simSys.remoteUp({ kind: 'openvpn', openvpnConf: profile })).ok);
    const up = await simSys.remoteUp({ kind: 'openvpn', openvpnConf: profile, openvpnUsername: 'u', openvpnPassword: 'p' });
    ok('and brings up a valid one, naming what it removed', up.ok && /script-security/.test(up.message));
    ok('its status is experimental', /experimental/.test((await simSys.remoteStatus({ kind: 'openvpn' })).detail));
    const { redactRemoteConfig } = await import('../packages/vehicle/src/system/SystemManager');
    const shown = JSON.stringify(redactRemoteConfig({ kind: 'openvpn', openvpnConf: profile, openvpnUsername: 'u', openvpnPassword: 'TOPSECRETPW' }));
    ok('the status API never hands out the profile or the password', !shown.includes('KEYDATA') && !shown.includes('TOPSECRETPW') && shown.includes('"hasOpenvpnConf":true'));
  }

  // ---- the installer configures what it finds, and only what was never saved ----
  {
    const F = await import('../packages/vehicle/src/system/firstRun');
    const pca41 = { address: '0x41', hint: '', device: 'PCA9685', kind: 'pca9685', confirmed: true };
    const ina40 = { address: '0x40', hint: '', device: 'INA228', kind: 'ina228', confirmed: true };
    const imx708 = 'imx708_wide [4608x2592 10-bit RGGB] (/base/soc/i2c0mux/i2c@1/imx708@1a)';
    const det = (i2c: unknown[], cameras: string[] = []) => ({ i2c, cameras, modemPresent: false, serial: [], notes: [] }) as Parameters<typeof F.firstRunPlan>[1];
    const fresh = F.firstRunPlan({}, det([ina40, pca41, { address: '0x70', hint: '', device: null, kind: null, confirmed: false }], [imx708]));
    ok('a PCA9685 becomes the output driver', fresh.patch.driver === 'pca9685' && fresh.patch.pca9685?.address === 0x41 && fresh.patch.pca9685?.bus === 1);
    ok('and the module it needs gets built', fresh.patch.hardwareDeps?.includes('i2c-bus') === true);
    ok('a CSI camera replaces the test pattern', fresh.patch.cameras?.[0]?.type === 'rpicam' && fresh.patch.cameras.length === 1);
    ok('a current sensor is reported, never configured', fresh.patch.telemetry === undefined && fresh.notes.some((n) => /INA228 at 0x40/.test(n)));
    const kept = F.firstRunPlan({ driver: 'sim', cameras: [] }, det([pca41], [imx708]));
    ok('a saved driver is never changed', kept.patch.driver === undefined && kept.notes.some((n) => /keeping the saved "sim"/.test(n)));
    ok('nor a saved camera list — empty included', kept.patch.cameras === undefined);
    const bare = F.firstRunPlan({}, det([], []));
    ok('nothing found leaves everything as it is', Object.keys(bare.patch).length === 0 && bare.notes.some((n) => /staying on "sim"/.test(n)));
    ok('a saved address is kept even when the driver is new',
      F.firstRunPlan({ pca9685: { address: 0x42 } }, det([pca41])).patch.pca9685 === undefined);
    const usb = F.firstRunPlan({}, det([], ['USB Camera (/base/scb/pcie@7d500000/pci@0,0/usb@0,0-1:1.0-0c45:6366)']));
    ok('a USB webcam is mentioned, not guessed into a config', usb.patch.cameras === undefined && usb.notes.some((n) => /USB\/V4L2/.test(n)));
    ok('bare video nodes are not taken for a CSI camera', F.cameraEntryKind('/dev/video0') === 'v4l2' && F.cameraEntryKind(imx708) === 'csi');
    ok('the sensor is named', F.sensorName(imx708) === 'imx708_wide');
    const doubtful = F.firstRunPlan({}, det([{ address: '0x40', hint: '', device: null, kind: null, confirmed: false }, { address: '0x70', hint: '', device: null, kind: null, confirmed: false }]));
    ok('a suspected 0x40 collision is pointed out', doubtful.notes.some((n) => /Move the PCA9685 to 0x41/.test(n)));
    ok('a configured vehicle gets the module its settings need',
      F.firstRunPlan({ driver: 'pca9685' }, det([])).patch.hardwareDeps?.join() === 'i2c-bus');
    ok('serial GPS needs serialport', F.requiredHwDeps({ gps: { source: 'serial-nmea', autoHome: true, minSats: 6 } }).join() === 'serialport');
    ok('nothing already recorded is asked for twice',
      F.firstRunPlan({ driver: 'pca9685', hardwareDeps: ['i2c-bus'] }, det([])).patch.hardwareDeps === undefined);
    const inst = readFileSync('provisioning/install.sh', 'utf8');
    ok('the installer runs it after I²C is on, before the services start',
      inst.indexOf('do_i2c 0') < inst.indexOf('npm run --silent first-run') && inst.indexOf('npm run --silent first-run') < inst.indexOf('-- systemd services'));
    ok('and builds what it asked for afterwards', inst.indexOf('npm run --silent first-run') < inst.lastIndexOf('restore_hw_deps'));
    ok('it switches WiFi power saving off for good', /wifi\.powersave = 2/.test(inst));
    ok('and refuses to run without root, with the command to use', /id -u\)" -ne 0/.test(inst) && /sudo bash \$0/.test(inst));
  }

  // ---- GET /api/diagnostics end to end (sim system, real router) ----
  {
    const { handleSetup } = await import('../packages/vehicle/src/transport/setupRouter');
    const { VehicleCore } = await import('../packages/vehicle/src/core/VehicleCore');
    const { SimDriver } = await import('../packages/vehicle/src/drivers/SimDriver');
    const { SimSystem } = await import('../packages/vehicle/src/system/SimSystem');
    const { loadConfig: lc } = await import('../packages/vehicle/src/config');
    const cfgPath = join(tmpdir(), `yonderrc-diag-test-${process.pid}.json`);
    const envCfg = process.env.YRC_CONFIG;
    process.env.YRC_CONFIG = cfgPath;
    writeFileSync(cfgPath, JSON.stringify({
      watchdogTimeoutMs: 300,
      lte: { apn: 'web', pin: '9876' },
      hotspot: { ssid: 'YonderRC-setup', password: 'HOTSPOT-PW-2', mode: 'always' },
    }));
    const config = lc();
    const core = new VehicleCore({ driver: new SimDriver(), watchdogTimeoutMs: config.watchdogTimeoutMs });
    const ctx = {
      config, core, system: new SimSystem(),
      telemetry: { message: null }, gps: { message: { type: 'gps', hasFix: false, lat: null, lon: null, home: null }, linkStats: () => null },
      traffic: { usage: null }, applyCameras: async () => {},
    } as unknown as Parameters<typeof handleSetup>[2];
    const call = async (url: string, headers: Record<string, string> = {}, method = 'GET', body?: unknown) => {
      const req = {
        url, method, headers,
        async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); },
      };
      const res = { code: 0, head: {} as Record<string, string>, body: '', writeHead(c: number, h?: Record<string, string>) { this.code = c; this.head = h ?? {}; }, end(b?: string) { this.body = b ?? ''; }, setHeader() {} };
      await handleSetup(req as never, res as never, ctx);
      return res;
    };
    let res = await call('/api/diagnostics');
    const rep = JSON.parse(res.body);
    ok('the vehicle exports a report', res.code === 200 && rep.schema === 'yonderrc-diagnostics/1' && Array.isArray(rep.findings));
    ok('with the link statistics and the log', !!rep.vehicle.link && Array.isArray(rep.vehicle.log) && rep.vehicle.watchdogMs === 500);
    ok('and without the secrets in the stored config', !res.body.includes('9876') && !res.body.includes('HOTSPOT-PW-2'));
    res = await call('/api/diagnostics?download=1');
    ok('?download=1 makes it a file', /attachment; filename="yonderrc-diagnostics-/.test(res.head['content-disposition'] ?? ''));
    res = await call('/api/diagnostics', { origin: 'https://evil.example' });
    ok('a page from the internet may not read it', res.code === 403);
    config.apiSecret = 'S3CRET-XYZ';
    res = await call('/api/diagnostics');
    ok('with an API secret set it is required', res.code === 401);
    res = await call('/api/diagnostics?secret=S3CRET-XYZ');
    ok('and accepted as a query', res.code === 200 && !res.body.includes('S3CRET-XYZ'));
    config.apiSecret = null;

    // The watchdog from the setup form: clamped, live, and marked as chosen.
    res = await call('/api/config', {}, 'POST', { watchdogTimeoutMs: 40 });
    ok('a watchdog typo is clamped and applied live', res.code === 200 && core.watchdogMs === 100);
    const saved = JSON.parse(readFileSync(cfgPath, 'utf8'));
    ok('and saved as a choice', saved.watchdogTimeoutMs === 100 && saved.watchdogChosen === true);
    res = await call('/api/config');
    ok('the form shows what runs', JSON.parse(res.body).watchdogTimeoutMs === 100);
    ok('and which driver really runs', JSON.parse(res.body).driverRunning === 'sim');

    rmSync(cfgPath, { force: true });
    if (envCfg === undefined) delete process.env.YRC_CONFIG; else process.env.YRC_CONFIG = envCfg;
  }

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const restoreEnv = (name: string, value: string | undefined) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };

  // ---- v1.70.1: one stray request or frame must not end the service ----
  {
    const { resolveGroundPath } = await import('../packages/vehicle/src/transport/staticServer');
    const { failRequest } = await import('../packages/vehicle/src/transport/failRequest');
    const dist = join(tmpdir(), 'yrc-dist');
    // The request that took the vehicle down: decodeURIComponent threw out of the handler.
    ok('a malformed escape is refused instead of thrown', resolveGroundPath(dist, '/%E0%A4%A') === null);
    ok('a NUL byte is refused', resolveGroundPath(dist, '/index.html%00.png') === null);
    ok('the root is the app', resolveGroundPath(dist, '/') === join(dist, 'index.html'));
    ok('an asset resolves inside dist', resolveGroundPath(dist, '/assets/app.js') === join(dist, 'assets', 'app.js'));
    const up = resolveGroundPath(dist, '/../../etc/passwd');
    ok('a traversal stays inside dist', up !== null && up.startsWith(dist));
    const encUp = resolveGroundPath(dist, '/..%2F..%2Fetc%2Fpasswd');
    ok('an encoded one too', encUp === null || encUp.startsWith(dist));

    const errs: string[] = [];
    const origErr = console.error;
    console.error = (...a: unknown[]) => { errs.push(a.join(' ')); };
    const fresh = { headersSent: false, code: 0, destroyed: false, writeHead(c: number) { this.code = c; }, end() {}, destroy() { this.destroyed = true; } };
    failRequest({ method: 'GET', url: '/api/x?secret=TOPSECRET' } as never, fresh as never, new Error('boom'));
    const late = { ...fresh, headersSent: true, code: 0 };
    failRequest({ method: 'GET', url: '/x' } as never, late as never, new Error('late'));
    console.error = origErr;
    ok('a failing request answers 500', fresh.code === 500);
    ok('one that already started is cut off', late.destroyed && late.code === 0);
    ok('and the log line never carries the secret', errs.length === 2 && !errs.join('\n').includes('TOPSECRET'));

    const wsSrc = readFileSync('packages/vehicle/src/transport/wsServer.ts', 'utf8');
    ok('the HTTP handler catches what it starts', wsSrc.includes('.catch((err) => failRequest(req, res, err))'));
    ok('a WebSocket message cannot throw out of its handler', /handleClientMessage\(core, msg, session\);[\s\S]{0,500}\} catch \(err\)/.test(wsSrc));
    const idxSrc = readFileSync('packages/vehicle/src/index.ts', 'utf8');
    ok('an uncaught exception writes failsafe before the process goes', /process\.on\('uncaughtException'[\s\S]{0,700}liveCore\.stop\(\)/.test(idxSrc));
    ok('a stray rejection is logged, not fatal', idxSrc.includes("process.on('unhandledRejection'"));
    ok('shutdown writes the safe frame first', /shutting down, holding failsafe[\s\S]{0,300}await core\.stop\(\)/.test(idxSrc));

    const { VehicleCore } = await import('../packages/vehicle/src/core/VehicleCore');
    const { SimDriver } = await import('../packages/vehicle/src/drivers/SimDriver');
    const core = new VehicleCore({ driver: new SimDriver() });
    const s = core.beginControlSession();
    let threw = false;
    try {
      core.applyControl({ type: 'control', seq: 1, t: 0, channels: null } as never, s);
      core.applyControl({ type: 'control', t: 0, channels: [1800] } as never, s);
      core.applyControl({ type: 'control', seq: 'x', t: 0, channels: [1800] } as never, s);
    } catch {
      threw = true;
    }
    ok('a frame without channels or a sequence does not throw', !threw);
    ok('and changes nothing', core.readCommanded()[0] === 1500);
    core.applyControl({ type: 'control', seq: 2, t: 0, channels: [1600] }, s);
    ok('the next good frame still applies', core.readCommanded()[0] === 1600);

    const { handleClientMessage } = await import('../packages/vehicle/src/transport/handleMessage');
    const quiet = { log: console.log, warn: console.warn };
    console.log = () => {};
    console.warn = () => {};
    handleClientMessage(core, { type: 'arm', armed: 'yes' } as never, s);
    const armedByString = core.status().armed;
    handleClientMessage(core, { type: 'calib', action: 'start', channel: 'x', minUs: 'a' } as never, s);
    const calibOnGarbage = core.status().calibration;
    let configThrew = false;
    try {
      handleClientMessage(core, { type: 'config', throttleChannels: 2, failsafeUs: 'abc' } as never, s);
    } catch {
      configThrew = true;
    }
    console.log = quiet.log;
    console.warn = quiet.warn;
    ok('only armed: true arms', armedByString === false);
    ok('a calibration needs one of the 16 channels', calibOnGarbage === undefined);
    ok('a config with lists that are not lists changes nothing and throws nothing', !configThrew && core.safetyConfig().throttleChannels.length === 0);
  }

  // ---- v1.70.1: safe values from the first tick, and after every restart ----
  {
    const { VehicleCore } = await import('../packages/vehicle/src/core/VehicleCore');
    const { SimDriver } = await import('../packages/vehicle/src/drivers/SimDriver');
    // A drone: its failsafe holds hover throttle on CH3, its disarmed value is motors off.
    const fs = Array(16).fill(1500);
    const dis = Array(16).fill(1500);
    dis[2] = 1000;
    const drv = new SimDriver();
    const drone = new VehicleCore({ driver: drv, watchdogTimeoutMs: 100, failsafeUs: fs, disarmedUs: dis, throttleChannels: [2, 99, -1] });
    await drone.start();
    ok('a fresh start with no ground holds the throttle at its disarmed value', drv.readLast()[2] === 1000);
    const sess = drone.beginControlSession();
    drone.applyControl({ type: 'control', seq: 1, t: Date.now(), channels: Array(16).fill(1500) }, sess);
    drone.setArmed(true);
    await sleep(250);
    ok('an ARMED drone that loses its link holds its failsafe', drv.readLast()[2] === 1500 && drone.status().failsafeActive);
    drone.setArmed(false);
    await sleep(60);
    // The bug: a disarmed drone on the bench spun up to hover throttle when its ground went away.
    ok('a DISARMED one that loses its link keeps its motors off', drv.readLast()[2] === 1000 && drone.status().failsafeActive);
    const sc = drone.safetyConfig();
    ok('the values a restart needs are reported', sc.disarmedUs[2] === 1000 && sc.failsafeUs[2] === 1500 && sc.throttleChannels.join() === '2');
    await drone.stop();
    ok('stopping a disarmed vehicle leaves its throttle off', drv.readLast()[2] === 1000);

    // ESC calibration ignored the link: a ground that went away in the MAX step left the
    // ESC at full throttle until the service was restarted.
    const cdrv = new SimDriver();
    const cc = new VehicleCore({ driver: cdrv, watchdogTimeoutMs: 100, throttleChannels: [2] });
    await cc.start();
    const cs = cc.beginControlSession();
    let seq = 0;
    const frame = () => cc.applyControl({ type: 'control', seq: ++seq, t: Date.now(), channels: Array(16).fill(1500) }, cs);
    frame(); // a ground that is connected is sending
    const feed = setInterval(frame, 20);
    const log = console.log;
    const warn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    cc.startCalibration(2, 1000, 2000);
    await sleep(80);
    const duringCal = cdrv.readLast()[2];
    const activeCal = cc.status().calibration?.active === true;
    clearInterval(feed);
    await sleep(250);
    console.log = log;
    console.warn = warn;
    ok('calibration drives MAX while the ground is there', duringCal === 2000 && activeCal);
    ok('a lost link cancels it', cc.status().calibration === undefined);
    ok('and the throttle leaves MAX', cdrv.readLast()[2] === 1500);
    await cc.stop();

    // Stored, and read back at the next start.
    const C2 = await import('../packages/vehicle/src/config');
    const p = join(tmpdir(), `yonderrc-safety-test-${process.pid}.json`);
    writeFileSync(p, JSON.stringify({ vehicleName: 'Quad', videoBaseUrl: 'http://yonderrc.local:1984' }));
    ok('the pushed values are stored', C2.persistControlSafety(p, sc) === true);
    ok('the same values again are not written again', C2.persistControlSafety(p, sc) === false);
    ok('other settings survive', C2.loadPersisted(p).vehicleName === 'Quad');
    const envCfg = process.env.YRC_CONFIG;
    process.env.YRC_CONFIG = p;
    const cfg = C2.loadConfig();
    restoreEnv('YRC_CONFIG', envCfg);
    ok('the next start reads them back', cfg.controlSafety !== null && cfg.controlSafety.disarmedUs[2] === 1000 && cfg.controlSafety.throttleChannels.join() === '2');
    ok('garbage is not trusted', C2.sanitiseControlSafety({ failsafeUs: ['x'] }) === null && C2.sanitiseControlSafety(null) === null && C2.sanitiseControlSafety('1500') === null);
    const short = C2.sanitiseControlSafety({ failsafeUs: [1000, 9999], throttleChannels: [2, 40, -1, 1.5] });
    ok('a short list is filled with neutral and clamped', !!short && short.failsafeUs.length === 16 && short.failsafeUs[1] === 2500 && short.failsafeUs[5] === 1500);
    ok('throttle channels outside the 16 are dropped', short?.throttleChannels.join() === '2');
    ok('disarmed values default to the failsafe ones', short?.disarmedUs[0] === 1000);
    const idxSrc = readFileSync('packages/vehicle/src/index.ts', 'utf8');
    ok('the service starts its core with them', /failsafeUs: safety\?\.failsafeUs/.test(idxSrc) && /disarmedUs: safety\?\.disarmedUs/.test(idxSrc));
    const wsSrc = readFileSync('packages/vehicle/src/transport/wsServer.ts', 'utf8');
    ok('and keeps what each ground pushes', wsSrc.includes("if (msg.type === 'config') persistControlSafety(config.configPath, core.safetyConfig())"));

    // The setup page says which throttle channels are in force — and where they came from.
    const { handleSetup } = await import('../packages/vehicle/src/transport/setupRouter');
    const { SimSystem } = await import('../packages/vehicle/src/system/SimSystem');
    const live = new VehicleCore({ driver: new SimDriver(), throttleChannels: cfg.controlSafety?.throttleChannels });
    const ctx = {
      config: cfg, core: live, system: new SimSystem(),
      telemetry: { message: null }, gps: { message: null }, traffic: { usage: null }, applyCameras: async () => {},
    } as unknown as Parameters<typeof handleSetup>[2];
    const res = { code: 0, body: '', writeHead(c: number) { this.code = c; }, end(b?: string) { this.body = b ?? ''; }, setHeader() {} };
    await handleSetup({ url: '/api/config', method: 'GET', headers: {}, async *[Symbol.asyncIterator]() {} } as never, res as never, ctx);
    const body = JSON.parse(res.body);
    ok('the setup page learns which throttle channels are in force', body.throttleFromGround === true && body.throttleChannelsActive.join() === '2');
    ok('and sees a stored go2rtc address already moved over', body.videoBaseUrl === `http://yonderrc.local:${cfg.port}/video`);

    // Anything that takes the outputs away and brings the vehicle back disarmed waits for a disarm.
    live.setArmed(true);
    const refused: Record<string, number> = {};
    for (const u of ['/api/restart', '/api/reboot', '/api/update', '/api/factory-reset', '/api/shutdown']) {
      const r2 = { code: 0, body: '', writeHead(c: number) { this.code = c; }, end(b?: string) { this.body = b ?? ''; }, setHeader() {} };
      await handleSetup({ url: u, method: 'POST', headers: {}, async *[Symbol.asyncIterator]() {} } as never, r2 as never, ctx);
      refused[u] = r2.code;
    }
    live.setArmed(false);
    ok('restart, reboot, update, factory reset and shutdown are refused while armed', Object.values(refused).every((c) => c === 409), JSON.stringify(refused));
    ok('and the refused factory reset kept the settings', C2.loadPersisted(p).vehicleName === 'Quad');
    const html = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    ok('the setup page shows a refused reboot instead of announcing one', html.includes("r && r.ok === false"));
    rmSync(p, { force: true });
  }

  // ---- v1.70.1: go2rtc's API is not on the network any more ----
  {
    const { generateGo2rtcYaml } = await import('../packages/vehicle/src/video/cameraManager');
    const y = generateGo2rtcYaml([{ name: 'cam1', type: 'sim', width: 640, height: 480, fps: 25 }]);
    ok('the go2rtc API listens on the vehicle only', /api:\n {2}listen: "127\.0\.0\.1:1984"/.test(y));
    ok('so does RTSP — nobody nearby can publish into a stream', /rtsp:\n {2}listen: "127\.0\.0\.1:8554"/.test(y));
    ok('no wildcard origin any more', !/origin:/.test(y));
    ok('the WebRTC media port stays reachable', /webrtc:\n {2}listen: ":8555"/.test(y));

    const VP = await import('../packages/vehicle/src/transport/videoProxy');
    const api = 'http://127.0.0.1:1984';
    const okT = VP.videoProxyTarget('POST', '/video/api/webrtc', 'src=cam1&secret=s&extra=1', ['cam1'], api);
    ok('the WebRTC offer goes through, with nothing but the camera name', okT.ok && okT.upstream === 'http://127.0.0.1:1984/api/webrtc?src=cam1');
    const execT = VP.videoProxyTarget('POST', '/video/api/webrtc', `src=${encodeURIComponent('exec:touch /tmp/pwned')}`, ['cam1'], api);
    ok('a command as source is refused', !execT.ok && execT.status === 404);
    ok('so is an unknown camera', !VP.videoProxyTarget('POST', '/video/api/webrtc', 'src=cam2', ['cam1'], api).ok);
    ok('and no camera at all', !VP.videoProxyTarget('POST', '/video/api/webrtc', '', ['cam1'], api).ok);
    const cfgT = VP.videoProxyTarget('POST', '/video/api/config', 'src=cam1', ['cam1'], api);
    ok('the rest of the go2rtc API stays on the vehicle', !cfgT.ok && cfgT.status === 404);
    ok('streams and restart included',
      !VP.videoProxyTarget('GET', '/video/api/streams', 'src=cam1', ['cam1'], api).ok &&
      !VP.videoProxyTarget('POST', '/video/api/restart', 'src=cam1', ['cam1'], api).ok);
    const getT = VP.videoProxyTarget('GET', '/video/api/webrtc', 'src=cam1', ['cam1'], api);
    ok('the wrong method is refused', !getT.ok && getT.status === 405);
    const snapT = VP.videoProxyTarget('GET', '/video/api/frame.jpeg', 'src=cam1&t=1', ['cam1'], api);
    ok('a snapshot goes through', snapT.ok && snapT.upstream === 'http://127.0.0.1:1984/api/frame.jpeg?src=cam1');

    ok('an old go2rtc address moves to the vehicle', VP.migrateVideoUrl('http://localhost:1984', 8080) === 'http://localhost:8080/video');
    ok('with its host kept', VP.migrateVideoUrl('http://100.64.1.2:1984/', 8080) === 'http://100.64.1.2:8080/video');
    ok('a new address is left alone', VP.migrateVideoUrl('http://yonderrc.local:8080/video', 8080) === 'http://yonderrc.local:8080/video');
    ok("so is someone else's server", VP.migrateVideoUrl('https://video.example.org/cam', 8080) === 'https://video.example.org/cam');
    ok('and "no video"', VP.migrateVideoUrl(null, 8080) === null);

    // End to end, against a stand-in for go2rtc.
    const { createServer } = await import('node:http');
    const seen: { url: string; body: string }[] = [];
    const fake = createServer((rq, rs) => {
      let b = '';
      rq.on('data', (c) => (b += c));
      rq.on('end', () => {
        seen.push({ url: rq.url ?? '', body: b });
        if ((rq.url ?? '').startsWith('/api/webrtc')) {
          rs.writeHead(201, { 'content-type': 'application/sdp' });
          rs.end('v=0 answer');
        } else {
          rs.writeHead(200, { 'content-type': 'image/jpeg' });
          rs.end(Buffer.from([0xff, 0xd8, 0xff]));
        }
      });
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', () => r()));
    const fport = (fake.address() as { port: number }).port;
    let secretNow: string | null = null;
    const vctx = { apiUrl: `http://127.0.0.1:${fport}`, streams: () => ['cam1'], secret: () => secretNow };
    const vcall = async (url: string, method = 'GET', headers: Record<string, string> = {}, body?: string) => {
      const req = { url, method, headers, async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(body); } };
      const res = {
        code: 0, head: {} as Record<string, string>, body: Buffer.alloc(0),
        writeHead(c: number, h?: Record<string, string>) { this.code = c; this.head = h ?? {}; },
        end(b?: string | Buffer) { this.body = Buffer.from(b ?? ''); },
      };
      const handled = await VP.handleVideoProxy(req as never, res as never, vctx);
      return { handled, code: res.code, head: res.head, body: res.body };
    };
    let r = await vcall('/video/api/webrtc?src=cam1', 'POST', { 'content-type': 'application/sdp' }, 'v=0 offer');
    ok('the offer reaches go2rtc and its answer comes back', r.code === 201 && r.body.toString() === 'v=0 answer' && seen.at(-1)?.body === 'v=0 offer');
    ok('upstream sees only the camera name', seen.at(-1)?.url === '/api/webrtc?src=cam1');
    r = await vcall('/video/api/webrtc?src=exec%3Areboot', 'POST', {}, 'x');
    ok('a command as source never reaches go2rtc', r.code === 404 && seen.length === 1);
    r = await vcall('/video/api/frame.jpeg?src=cam1&t=5');
    ok('a snapshot comes back as an image', r.code === 200 && r.head['content-type'] === 'image/jpeg' && r.body[0] === 0xff);
    r = await vcall('/video/api/webrtc?src=cam1', 'POST', { origin: 'https://evil.example' }, 'x');
    ok('a page from the internet is refused', r.code === 403);
    secretNow = 'S3CRET';
    r = await vcall('/video/api/webrtc?src=cam1', 'POST', {}, 'x');
    ok('with an API secret set, video needs it too', r.code === 401);
    r = await vcall('/video/api/webrtc?src=cam1&secret=S3CRET', 'POST', {}, 'v=0 offer');
    ok('and works with it — which go2rtc never sees', r.code === 201 && !seen.at(-1)!.url.includes('S3CRET'));
    secretNow = null;
    ok("other paths are not the proxy's business", !(await vcall('/setup')).handled && !(await vcall('/videos')).handled);
    r = await vcall('/video/api/webrtc?src=cam1', 'POST', {}, 'x'.repeat(300 * 1024));
    ok('an oversized offer is refused', r.code === 413);
    fake.closeAllConnections();
    await new Promise<void>((done) => fake.close(() => done()));
    const warn = console.warn;
    console.warn = () => {};
    r = await vcall('/video/api/webrtc?src=cam1', 'POST', {}, 'x');
    console.warn = warn;
    ok('a stopped go2rtc is a clear 502', r.code === 502 && /go2rtc/.test(r.body.toString()));

    // Where the ground is sent for video.
    const { loadConfig: lc3 } = await import('../packages/vehicle/src/config');
    const pv = join(tmpdir(), `yonderrc-video-test-${process.pid}.json`);
    const envC = process.env.YRC_CONFIG;
    const envV = process.env.YRC_VIDEO_URL;
    const envH = process.env.YRC_PUBLIC_HOST;
    process.env.YRC_CONFIG = pv;
    delete process.env.YRC_VIDEO_URL;
    delete process.env.YRC_PUBLIC_HOST;
    writeFileSync(pv, '{}');
    let vc = lc3();
    ok('by default the ground gets video from the vehicle itself', vc.videoBaseUrl === `http://localhost:${vc.port}/video` && vc.go2rtcApiUrl === 'http://127.0.0.1:1984');
    writeFileSync(pv, JSON.stringify({ videoBaseUrl: 'http://localhost:1984' }));
    vc = lc3();
    ok('a stored go2rtc address is moved over', vc.videoBaseUrl === `http://localhost:${vc.port}/video`);
    writeFileSync(pv, JSON.stringify({ videoBaseUrl: null }));
    ok('"no video" stays no video', lc3().videoBaseUrl === null);
    writeFileSync(pv, '{}');
    process.env.YRC_VIDEO_URL = 'http://localhost:1984';
    ok('an old compose file still gets video', lc3().videoBaseUrl === `http://localhost:${vc.port}/video`);
    restoreEnv('YRC_CONFIG', envC);
    restoreEnv('YRC_VIDEO_URL', envV);
    restoreEnv('YRC_PUBLIC_HOST', envH);
    rmSync(pv, { force: true });

    const compose = readFileSync('docker/docker-compose.yml', 'utf8');
    ok('the compose file does not point the ground at go2rtc', !/YRC_VIDEO_URL:.*1984/.test(compose));
  }

  // ---- v1.70.1: no frames rather than wrong frames ----
  {
    const G = await import('../packages/ground/src/lib/controlGate');
    const padPlane = rebuildForMethod(buildProfile('plane'), 'gamepad');
    const touchPlane = rebuildForMethod(buildProfile('plane'), 'touch');
    ok('a gamepad model needs its pad, a touch model does not', G.needsGamepad(padPlane) && !G.needsGamepad(touchPlane));
    ok('a hidden app sends nothing', G.controlHold(touchPlane, { hidden: true, padConnected: true, armed: false }) === 'hidden');
    // The bug: a missing pad reads as sticks centred — half throttle on a plane, and the
    // vehicle's watchdog never tripped because frames kept coming.
    ok('an armed gamepad model without its pad sends nothing', G.controlHold(padPlane, { hidden: false, padConnected: false, armed: true }) === 'no-controller');
    ok('a disarmed one still sends — bench work needs no controller', G.controlHold(padPlane, { hidden: false, padConnected: false, armed: false }) === null);
    ok('a touch model never waits for a pad', G.controlHold(touchPlane, { hidden: false, padConnected: false, armed: true }) === null);
    ok('with everything there it sends', G.controlHold(padPlane, { hidden: false, padConnected: true, armed: true }) === null);
    ok('arming a gamepad model without its pad is refused',
      G.armBlockedByController(padPlane, false) !== null && G.armBlockedByController(padPlane, true) === null && G.armBlockedByController(touchPlane, false) === null);
    ok('every hold has words for the operator', !!G.controlHoldMessage('hidden') && !!G.controlHoldMessage('no-controller') && G.controlHoldMessage(null) === null);
    const app = readFileSync('packages/ground/src/App.tsx', 'utf8');
    ok('the control loop asks before it sends', app.includes('if (!hold) linkRef.current?.sendControl(sent);') && !/^\s*linkRef\.current\?\.sendControl\(sent\);/m.test(app));
    ok('and arming asks for the pad first', app.includes('armBlockedByController(activeRef.current'));

    const VL = await import('../packages/ground/src/lib/videoLink');
    ok("the secret goes to the vehicle's own video", VL.videoSecretFor('http://192.168.4.1:8080/video', 'ws://192.168.4.1:8080', 'k') === 'k');
    ok('never to another host', VL.videoSecretFor('http://cams.example.org:8080/video', 'ws://192.168.4.1:8080', 'k') === '');
    ok('nor to another port', VL.videoSecretFor('http://192.168.4.1:1984', 'ws://192.168.4.1:8080', 'k') === '');
    ok('nothing to send without one', VL.videoSecretFor('http://192.168.4.1:8080/video', 'ws://192.168.4.1:8080', '') === '');
    ok('the offer URL carries it only when given',
      VL.whepUrl('http://v:8080/video', 'cam 1') === 'http://v:8080/video/api/webrtc?src=cam%201' &&
      VL.whepUrl('http://v:8080/video', 'c', 'a&b') === 'http://v:8080/video/api/webrtc?src=c&secret=a%26b');
  }

  // ---- v1.70.2: video goes where control goes ----
  {
    const VL = await import('../packages/ground/src/lib/videoLink');
    const { VIDEO_PATH } = await import('../packages/protocol/src/types/messages');
    const base = VL.effectiveVideoBase;
    const link = 'ws://192.168.4.1:8080';
    ok('the default video URL follows the link', base('http://localhost:8080/video', link) === 'http://192.168.4.1:8080/video');
    // The bug: a name the vehicle had stored for itself, not the one the ground used —
    // the secret stayed at home and the vehicle refused the video.
    ok('a stored name gives way to the address actually used', base('http://yonderrc.local:8080/video', link) === 'http://192.168.4.1:8080/video');
    ok('so the secret goes along', VL.videoSecretFor(base('http://yonderrc.local:8080/video', link), link, 'k') === 'k');
    ok('over Tailscale, video comes over Tailscale', base('http://192.168.1.50:8080/video', 'ws://100.101.102.103:8080') === 'http://100.101.102.103:8080/video');
    ok('behind an HTTPS proxy, video is https on the same name', base('http://localhost:8080/video', 'wss://rover.tail1234.ts.net') === 'https://rover.tail1234.ts.net/video');
    ok('an IPv6 link keeps its brackets', base('http://localhost:8080/video', 'ws://[fd7a:115c:a1e0::1]:8080') === 'http://[fd7a:115c:a1e0::1]:8080/video');
    ok('a trailing slash changes nothing', base('http://localhost:8080/video/', 'ws://10.0.0.2:8080') === 'http://10.0.0.2:8080/video');
    ok('an older vehicle still gets its go2rtc, loopback swapped for the link host', base('http://localhost:1984', link) === 'http://192.168.4.1:1984');
    ok('and never the secret there', VL.videoSecretFor(base('http://localhost:1984', link), link, 'k') === '');
    ok("an operator's own video server is used as reported, without the secret",
      base('https://cams.example.org/go2rtc', link) === 'https://cams.example.org/go2rtc' &&
      VL.videoSecretFor(base('https://cams.example.org/go2rtc', link), link, 'k') === '');
    ok('video off stays off', base(null, link) === null && base('', link) === null);
    ok('ground and vehicle share one video path', VIDEO_PATH === '/video');

    ok('a refused secret is named', /API secret/.test(VL.videoProblem(401) ?? ''));
    ok('a refused origin says what to do', /localhost/.test(VL.videoProblem(403) ?? ''));
    const down = 'go2rtc is not answering on http://127.0.0.1:1984 — is it running?';
    ok("the vehicle's own words come through", VL.videoProblem(502, down) === down);
    ok('only their first line, and not forever',
      VL.videoProblem(500, 'streams: exec failed\nmore') === 'streams: exec failed' && (VL.videoProblem(500, 'x'.repeat(500)) ?? '').length === 200);
    ok('a bare error still says something', VL.videoProblem(500) === 'the vehicle answered HTTP 500 to the video request.');
    ok('an answer is no problem', VL.videoProblem(201) === null);

    const app = readFileSync('packages/ground/src/App.tsx', 'utf8');
    ok('the app uses the shared resolver', app.includes("import { effectiveVideoBase, videoSecretFor } from './lib/videoLink'") && !app.includes('function effectiveVideoBase'));
    const panel = readFileSync('packages/ground/src/components/VideoPanel.tsx', 'utf8');
    ok('the panel says why instead of retrying in silence',
      panel.includes('throw new VideoRefused(res.status') && panel.includes('videoProblem(e.status, e.detail)') && panel.includes('`No video: ${problem}`'));
    const proxy = readFileSync('packages/vehicle/src/transport/videoProxy.ts', 'utf8');
    ok('the vehicle takes the path from the protocol', proxy.includes("import { VIDEO_PATH } from '@yonderrc/protocol'") && !proxy.includes('export const VIDEO_PATH'));
  }

  // ---- v1.70.1: a network name is not markup ----
  {
    const html = readFileSync('packages/vehicle/src/setup/setup.html', 'utf8');
    const fnSrc = (name: string) => {
      const start = html.indexOf(`function ${name}(`);
      if (start < 0) return '';
      let depth = 0;
      for (let i = html.indexOf('{', start); i < html.length; i++) {
        if (html[i] === '{') depth++;
        else if (html[i] === '}' && --depth === 0) return html.slice(start, i + 1);
      }
      return '';
    };
    const esc = new Function(`${fnSrc('esc')}; return esc;`)() as (v: unknown) => string;
    const loginLink = new Function(`${fnSrc('esc')} ${fnSrc('loginLink')}; return loginLink;`)() as (u: unknown) => string;
    ok('esc covers quotes, so it is safe inside an attribute', esc(`"><img src=x onerror=alert(1)>'`) === '&quot;&gt;&lt;img src=x onerror=alert(1)&gt;&#39;');
    ok('a Tailscale login link stays a link', loginLink('https://login.tailscale.com/a/abc123').includes('href="https://login.tailscale.com/a/abc123"'));
    ok('anything else is shown, never linked', !loginLink('javascript:alert(1)').includes('href') && !loginLink('https://x" onmouseover="alert(1)').includes('href'));
    ok('no login URL lands in an href unchecked', !html.includes('href="${ts.loginUrl}"') && !html.includes('href="${s.loginUrl}"') && !html.includes('href="${r.loginUrl}"'));
    // 32 bytes of SSID are enough for `<img src=x onerror=…>`, and a quote broke out of the onclick.
    ok('the WiFi list is built from nodes, not from the SSID', !html.includes('onclick="pickWifi(') && html.includes('name.textContent = `${n.secured'));
    ok('and a pick is matched exactly', html.includes('b.dataset.ssid === ssid'));
    const rs = fnSrc('renderStatus');
    ok('the status rows escape what the air and the devices say', rs.includes('${esc(k)}') && rs.includes('${esc(v)}') && !rs.includes('<span class="k">${k}</span>'));
    ok('without escaping twice', !rs.includes("row('power', esc("));
    const det = fnSrc('detectHw');
    ok('so does the hardware probe', det.includes('${esc(x.hint)}') && det.includes('${esc(n)}') && det.includes('${esc(c)}'));
    const snap = fnSrc('snapCameras');
    ok('camera snapshots come through the vehicle, built from nodes', snap.includes('/video/api/frame.jpeg') && !snap.includes('1984') && !snap.includes('innerHTML = names'));
  }

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
