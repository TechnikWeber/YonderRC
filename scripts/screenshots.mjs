/**
 * Regenerate the README screenshots (docs/screenshots/*).
 *
 * They went stale three releases in a row — the app had turned light, the setup page
 * had grown tabs, and the README still showed a dark v1.58 — so this is the recipe,
 * not a one-off: start the sim, put the vehicle into a photogenic state, drive a
 * headless Chrome over CDP and capture at deviceScaleFactor 1.5 (1300x860 CSS →
 * 1950x1290), then shrink what can be shrunk — see DSF and `optimise` below.
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
// A random port per run, because a fixed one silently reuses a chrome left behind by a
// failed run — with ITS profile, so the shots come out carrying the last run's
// localStorage. That cost an afternoon: the hero shot kept showing a setting that had
// been removed from the script.
const PORT = 9000 + Math.floor(Math.random() * 900);
/**
 * Render scale. 2 was three times what GitHub ever displays (it lays a README image out
 * at ~900 px), so the five files came to 1.2 MB for no visible gain. 1.5 still has more
 * pixels than a retina reader can use and is a third of the weight.
 */
const DSF = 1.5;
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
async function shot({ url, out, width = 1300, height = 860, dsf = DSF, mobile = false, prep = [], settle = 1500, clip = null }) {
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
const panelWith = (needle, extra = '') => `(() => {
  const el = [...document.querySelectorAll('.panel')].find((p) => ${needle});
  const r = el.getBoundingClientRect();
  ${extra || 'return { x: r.x - 10, y: r.y - 10, width: r.width + 20, height: r.height + 20 };'}
})()`;

process.on('exit', () => chrome.kill());
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { chrome.kill(); process.exit(1); });
process.on('uncaughtException', (e) => { chrome.kill(); console.error(e.message); process.exit(1); });

console.log('priming the vehicle…');
await primeVehicle();
console.log('capturing…');

// Nothing is forced on for the camera: this is the OSD as it ships, down to the single
// link health score (the numbers behind it appear by themselves once the link degrades).
await shot({ url: GROUND, out: 'Overview_OSD.png', prep: [CONNECT, 15000], settle: 2000 });

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
// both READMEs says so. Captured as PNG; optimise() turns it into the .jpeg they link.
await shot({ url: GROUND, out: 'Mobile_FPV.png', width: 390, height: 844, dsf: 2, mobile: true, prep: [CONNECT, 14000], settle: 2000 });

ws.close();
chrome.kill();
await optimise();
console.log('done — check the diff before committing, the sim numbers change every run');

/**
 * Squeeze the files. The three flat-UI shots are a few dozen colours pretending to be
 * truecolour, so a 256-colour palette is invisible and roughly halves them; the two
 * that carry the video test pattern keep their full palette, and the phone one becomes
 * the .jpeg the READMEs point at (photographic content, and it is the biggest file).
 */
async function optimise() {
  const run = (args) => new Promise((res) => {
    const p = spawn('magick', args, { stdio: 'ignore' });
    p.on('close', (code) => res(code === 0));
    p.on('error', () => res(false));
  });
  const at = (f) => join(OUT, f);
  if (!(await run(['-version']))) {
    console.warn('  ! ImageMagick not found — files left as captured, and Mobile_FPV is still a .png');
    return;
  }
  for (const f of ['TouchInputs_and_Status.png', 'ChannelOutput_Monitor.png', 'VehicleConfig_Setup.png']) {
    await run([at(f), '-strip', '-colors', '256', '-define', 'png:compression-level=9', at(f)]);
  }
  await run([at('Overview_OSD.png'), '-strip', '-define', 'png:compression-level=9', at('Overview_OSD.png')]);
  await run([at('Mobile_FPV.png'), '-strip', '-quality', '85', at('Mobile_FPV.jpeg')]);
  await run(['-version']); // (magick has no rm; the stray .png goes below)
  const { rmSync } = await import('node:fs');
  rmSync(at('Mobile_FPV.png'), { force: true });
}
