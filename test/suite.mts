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

  // ---- WiFi scan parsing + hotspot arguments ----
  const { parseWifiScan, hotspotArgs, HOTSPOT_DEFAULTS } = await import('../packages/vehicle/src/system/SystemManager');
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
  const openArgs = hotspotArgs(HOTSPOT_DEFAULTS);
  ok('open hotspot has no password arg', !openArgs.includes('password') && openArgs.includes('YonderRC-setup'));
  ok('secured hotspot passes the key', hotspotArgs({ ssid: 'X', password: 'longenough' }).slice(-2).join(' ') === 'password longenough');
  ok('too short key falls back to open', !hotspotArgs({ ssid: 'X', password: 'short' }).includes('password'));
  ok('hotspot honours the interface', hotspotArgs(HOTSPOT_DEFAULTS, 'wlan1').includes('wlan1'));

  // When the boot-time onboarding starts the hotspot (mirrored in onboard.sh).
  const { shouldStartHotspot } = await import('../packages/vehicle/src/system/SystemManager');
  ok('auto: no uplink → start', shouldStartHotspot('auto', false, false).start === true);
  ok('auto: uplink → skip', shouldStartHotspot('auto', true, false).start === false);
  ok('default (undefined) behaves like auto', shouldStartHotspot(undefined, true, false).start === false);
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
