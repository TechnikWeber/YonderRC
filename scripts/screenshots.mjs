/**
 * Regenerate the README screenshots (docs/screenshots/*).
 *
 * They went stale three releases in a row — the app had turned light, the setup page
 * had grown tabs, and the README still showed a dark v1.58 — so this is the recipe,
 * not a one-off: start the sim, put the vehicle into a photogenic state, drive a
 * headless Chrome over CDP and capture at deviceScaleFactor 2 (1300x860 CSS →
 * 2600x1720, which is what the existing PNGs are).
 *
 * Run it with the dev stack up:
 *     npm run dev        # vehicle :8080 + ground :5173
 *     npm run dev:video  # go2rtc test pattern, or the FPV panel stays empty
 *     node scripts/screenshots.mjs
 *
 * Needs google-chrome on PATH. Node 22+ (global WebSocket, global fetch).
 */
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'screenshots');
const GROUND = process.env.YRC_GROUND_URL ?? 'http://localhost:5173/';
const VEHICLE = process.env.YRC_VEHICLE_URL ?? 'http://localhost:8080';
const PORT = 9333;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- the vehicle's state is half the picture ----
/** GPS with a fix, a pack with a capacity, and a counter that hasn't run all day. */
async function primeVehicle() {
  const post = (path, body) =>
    fetch(`${VEHICLE}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  await post('/api/gps', { source: 'sim', autoHome: true, minSats: 6, device: '/dev/serial0', baud: 9600 });
  const tel = await (await fetch(`${VEHICLE}/api/telemetry`)).json();
  await post('/api/telemetry', { ...tel, enabled: true, source: 'sim', batteryCapacityMah: 2200 });
  await post('/api/telemetry/reset', {});
  await sleep(3000); // let a fix and a first reading arrive
}

// ---- headless chrome over CDP ----
const profile = mkdtempSync(join(tmpdir(), 'yrc-shot-'));
const chrome = spawn('google-chrome', [
  '--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--autoplay-policy=no-user-gesture-required', '--window-size=1400,1000',
], { stdio: ['ignore', 'ignore', process.env.DEBUG ? 'inherit' : 'ignore'] });

async function browserWs() {
  for (let i = 0; i < 50; i++) {
    try {
      return (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl;
    } catch { await sleep(200); }
  }
  throw new Error('chrome did not come up');
}
const ws = new WebSocket(await browserWs());
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
let nextId = 1;
const pending = new Map();
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  const p = msg.id && pending.get(msg.id);
  if (!p) return;
  pending.delete(msg.id);
  msg.error ? p.rej(new Error(msg.error.message)) : p.res(msg.result);
};
const send = (method, params = {}, sessionId) =>
  new Promise((res, rej) => {
    const id = nextId++;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });

/**
 * One shot. `prep` is a list of JS expressions (numbers are pauses) run in the page;
 * `clip` returns a plain viewport-relative getBoundingClientRect to crop to.
 */
async function shot({ url, out, width = 1300, height = 860, dsf = 2, mobile = false, prep = [], settle = 1500, clip = null }) {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Page.enable', {}, sessionId);
  await send('Runtime.enable', {}, sessionId);
  await send('Emulation.setDeviceMetricsOverride',
    { width, height, deviceScaleFactor: dsf, mobile, screenWidth: width, screenHeight: height }, sessionId);
  if (mobile) await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
  await send('Page.navigate', { url }, sessionId);
  await sleep(2500);
  for (const step of prep) {
    if (typeof step === 'number') { await sleep(step); continue; }
    const r = await send('Runtime.evaluate', { expression: step, awaitPromise: true, returnByValue: true }, sessionId);
    if (r.exceptionDetails) throw new Error(`${out}: ${r.exceptionDetails.text}`);
  }
  await sleep(settle);
  let params = { format: 'png', captureBeyondViewport: false };
  if (clip) {
    // Two traps: captureBeyondViewport re-lays-out the page and leaves everything below
    // the original fold unpainted, and window.scrollTo does nothing in the ground app —
    // `body` carries overflow-x, which makes IT the scroll container, not the document.
    const SCROLL_BY = (dy) => `(() => {
      const el = [document.scrollingElement, document.body, document.documentElement, document.getElementById('root')]
        .find((e) => e && e.scrollHeight > e.clientHeight + 4);
      if (el) el.scrollTop += ${dy};
      return el ? el.scrollTop : -1;
    })()`;
    const measure = async () => {
      const r = await send('Runtime.evaluate', { expression: clip, returnByValue: true }, sessionId);
      if (r.exceptionDetails || !r.result.value) throw new Error(`${out}: clip failed`);
      return r.result.value;
    };
    const r1 = await measure();
    await send('Runtime.evaluate', { expression: SCROLL_BY(Math.floor(r1.y) - 10) }, sessionId);
    await sleep(600);
    const r2 = await measure();
    const h = Math.min(r2.height, height - r2.y);
    if (h < r2.height - 2) console.warn(`  ! ${out}: cropped by ${Math.round(r2.height - h)}px — raise its viewport height`);
    params = { format: 'png', captureBeyondViewport: false, clip: { x: r2.x, y: r2.y, width: r2.width, height: h, scale: 1 } };
  }
  const { data } = await send('Page.captureScreenshot', params, sessionId);
  writeFileSync(join(OUT, out), Buffer.from(data, 'base64'));
  await send('Target.closeTarget', { targetId });
  console.log('  ✓', out);
}

const CONNECT = `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Connect')?.click(), 'ok'`;
// The link NUMBERS are off by default (a single health score replaced them in v1.37).
// The README caption describes them, so force them on for the hero shot.
const LINK_ON = `localStorage.setItem('yonderrc.osdFields.v1', JSON.stringify({ link: true })), 'ok'`;
const RELOAD = `location.reload(), 'ok'`;
const panelWith = (needle, extra = '') => `(() => {
  const el = [...document.querySelectorAll('.panel')].find((p) => ${needle});
  const r = el.getBoundingClientRect();
  ${extra || 'return { x: r.x - 10, y: r.y - 10, width: r.width + 20, height: r.height + 20 };'}
})()`;

console.log('priming the vehicle…');
await primeVehicle();
console.log('capturing…');

await shot({ url: GROUND, out: 'Overview_OSD.png', prep: [LINK_ON, RELOAD, 3000, CONNECT, 15000], settle: 2000 });

await shot({
  url: GROUND, out: 'TouchInputs_and_Status.png', width: 1080, height: 1500,
  prep: [CONNECT, 12000],
  // Pad panel down into the first channel rows — the same framing as the original.
  clip: `(() => {
    const panels = [...document.querySelectorAll('.panel')];
    const a = panels.find((p) => p.querySelector('.arm-btn')).getBoundingClientRect();
    const b = panels.find((p) => /channel output/i.test(p.textContent)).getBoundingClientRect();
    return { x: a.x - 10, y: a.y - 10, width: a.width + 20, height: (b.top - a.top) + 190 };
  })()`,
});

await shot({
  url: GROUND, out: 'ChannelOutput_Monitor.png', width: 980, height: 1300,
  prep: [CONNECT, 10000],
  clip: `(() => {
    const el = [...document.querySelectorAll('.panel')].find((p) => /channel output/i.test(p.textContent));
    const r = el.getBoundingClientRect();
    const f = el.nextElementSibling ? el.nextElementSibling.getBoundingClientRect() : r;
    return { x: r.x - 10, y: r.y - 10, width: r.width + 20, height: (f.bottom - r.top) + 20 };
  })()`,
});

await shot({
  url: `${VEHICLE}/setup`, out: 'VehicleConfig_Setup.png', width: 1000, height: 1700, prep: [4000],
  clip: `(() => { const r = document.querySelector('.wrap').getBoundingClientRect();
    return { x: 0, y: 0, width: innerWidth, height: r.height + 20 }; })()`,
});

// The phone view is an emulated 390px viewport, not a device photo — the caption in
// both READMEs says so. Written as PNG; convert it to the .jpeg the README points at:
//     magick docs/screenshots/Mobile_FPV.png -quality 88 docs/screenshots/Mobile_FPV.jpeg
await shot({ url: GROUND, out: 'Mobile_FPV.png', width: 390, height: 844, dsf: 3, mobile: true, prep: [CONNECT, 14000], settle: 2000 });

ws.close();
chrome.kill();
console.log('done — check the diff before committing, the sim numbers change every run');
