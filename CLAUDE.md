# CLAUDE.md — YonderRC

Guidance for Claude (and humans) working in this repository.

## What this is
YonderRC is a cross-platform app for **beyond-line-of-sight RC control** (car / boat
/ plane / drone) over IP/LTE, with low-latency FPV video, telemetry and in-browser
configuration. It runs in the browser (incl. phone), as an Electron desktop app, and
on a Raspberry Pi as the vehicle computer. **Everything runs in a simulator without
hardware** — sim-first is a core principle.

Owner: Philipp Weber · GitHub: TechnikWeber/YonderRC · License: CC BY-NC-ND 4.0 **plus
a no-military-use restriction** (see `LICENSE`; not a plain CC license).

## Monorepo layout (npm workspaces, TypeScript)
- `packages/protocol` — shared types + pure functions (channels, shaping, telemetry,
  profiles). No runtime deps. Safety-critical math lives here.
- `packages/vehicle` — Node/tsx service on the Pi: `VehicleCore` (failsafe/arming/
  watchdog), drivers (PCA9685 / GPIO-PWM / SBUS, native libs are optional), sensors,
  go2rtc camera management, WS + WebRTC transport, and the `/setup` web UI.
- `packages/ground` — React (Vite) ground station: control, FPV/OSD, recording,
  binding editor, controls/safety panel.
- `packages/desktop` — Electron shell + native SDL2 input, falls back to the browser
  gamepad API.
- `docs/HARDWARE.md` — parts list + wiring + WLAN→LTE/Tailscale bring-up.
- `provisioning/` — Pi install script, systemd, hotspot/onboarding.
- `test/suite.mts` — the whole test suite (`npm test`).

## Commands
```bash
npm install
npm run dev          # vehicle (ws://localhost:8080, /setup) + ground (http://localhost:5173)
npm run dev:video    # go2rtc with a synthetic test pattern (needs ffmpeg); run AFTER `npm run dev`
npm test             # runs test/suite.mts (must stay green)
```
Typecheck a package: `npx tsc --noEmit -p packages/<pkg>/tsconfig.json`.
Build ground: `npx vite build -c packages/ground/vite.config.ts packages/ground`.

## Verification expectations
- After any change, keep `npm test` green and typecheck all four packages.
- Prefer **pure, testable functions** in `protocol` or `ground/src/lib` and add
  assertions to `test/suite.mts` (that's how mode-switching, pre-arm, battery,
  auto-quality, endpoints, telemetry are covered).
- Anything touching real hardware, WebRTC reconnect behaviour, LTE, or drivers can
  only be *fully* verified on a Pi with hardware — call that out honestly rather than
  claiming it's proven.

## Conventions / gotchas (read before editing)
- **Sim-first**: every driver/sensor/source has a Sim and a Real implementation. A
  failed real driver falls back to `sim` so a headless device stays reachable.
- **Failsafe ≠ disarmed** and both are **vehicle-type aware** (see
  `ground/src/lib/profiles.ts`): drone failsafe = centre/hold, car/boat = stop,
  plane = motor off; disarmed forces throttle safe. Don't collapse these.
- **Channel µs**: nominal 1000–2000, absolute clamp 500–2500 (`protocol/channels.ts`,
  `clampChannelUs`). Endpoints are free within the absolute range; default stays
  1000–2000. This is the real servo range — don't widen without discussion.
- **Stick modes 1–4** (`ground/src/lib/templates.ts`, `applyStickMode`): remap the
  primary stick axes by *function* (derived from the label). Custom channels (added
  in the binding editor) are untouched by mode and **survive method switches**.
- **Per-channel rest position** (`detent`: center/low/free) drives where hold-ramp /
  momentary / toggle settle, and the **pre-arm check** (`ground/src/lib/safety.ts`)
  uses the throttle channel's detent to know the safe rest (centre vs idle).
- **Actions** (`ground/src/lib/actions.ts`): panic-disarm, arm, next-camera, record,
  snapshot — bindable to key+button, edited in Setup › Controls. Add new bindable
  features here rather than scattering hotkeys.
- **Video** (`ground/src/components/VideoPanel.tsx`): self-healing WHEP player. The
  watchdog uses **refs, not stale state**; a fresh connect bumps `genRef` so a
  superseded attempt can't attach a dead stream. Keep that invariant.
- **Telemetry channels**: voltages/currents/temperatures are lists; the one flagged
  `primary` (else index 0, see `protocol/telemetry.ts` `primaryIndex`) drives battery %,
  mAh/Wh, the low-battery warning and the blackbox. The OSD prefixes a channel's label
  only when its kind has >1 channel, and each value can be hidden per browser
  (`yonderrc.osdHidden.v1`, keyed by `readingKey`).
- **Telemetry config hot-applies** (`vehicle` POST `/api/telemetry` →
  `TelemetryService.reconfigure`). Battery % needs a capacity set there.
- go2rtc config path is **absolute** (resolved to repo root) — never a bare relative
  path (that caused an ENOENT crash historically).

## Release / packaging flow
Bump all five `package.json` to the same version, update the masthead string in
`ground/src/App.tsx` and the banner in `vehicle/src/index.ts`, add a `CHANGELOG.md`
entry. Locally you can just commit + tag + `gh release create`. README describes the
current feature set; detailed history lives in `CHANGELOG.md` + releases.

## Open / next
- **Optional shared secret — DONE (v1.17.1)**: `config.apiSecret` (null = off, default).
  When set it gates mutating `/api/*` POSTs (`x-yonderrc-secret` / `?secret=`) and the
  control WS (`?secret=`, close 4001 on mismatch). Pure check in `vehicle/transport/auth.ts`
  (`secretOk`). Ground has a secret field; setup UI has a Security panel + 401 prompt.
  The trust model is documented in `HARDWARE.md` §6.1 (both languages). Still open: a
  UI for a bind-to-localhost/Tailscale-only mode — the env var `YRC_HOST` already works.
- **English-first docs — DONE (v1.17.0)**: `README.md`/`docs/HARDWARE.md` are English,
  German in `README.de.md`/`docs/HARDWARE.de.md` with switchers. GitHub "About" +
  topics are set. The setup page is fully English since v1.21.1. Still open: UI-copy
  i18n (the ground app + setup page are English-only, no language switch).
- **LTE/WiFi signal in the OSD — DONE (v1.19.0)**: `RealSystem.linkSignal()` prefers the
  LTE signal % from `mmcli`, else parses the WiFi RSSI from `iw dev wlan0 link` (pure
  helpers + tests in `vehicle/system/signal.ts`); shown in the OSD link block, with the
  weak-link warning below 25 %. Interface name is hardcoded to `wlan0`.
- **Telemetry expansion — DONE (v1.23.0 / v1.24.0)**: INA228 (hardware CHARGE/ENERGY
  counter, `chargeSource` auto/sensor/pi) plus INA237/238; temperature channels
  (Pi SoC, DS18B20, MCP9808/TMP102/TMP117/BMP280/BME280, MAX6675/31855/31856/31865,
  ADS1115/MCP3008 + NTC/PT100) with pure conversions in `vehicle/sensors/convert.ts`;
  per-channel OSD visibility, labels from the second channel of a kind on, explicit
  `primary` flag, and one blackbox CSV column per channel. **All register/bus access is
  hardware-only-verified** — only the maths and the sim path are proven.
- **Hold-to-arm — DONE (v1.22.0)**: 3 s press-and-hold for arm *and* disarm
  (`ground/src/lib/hold.ts`), panic-disarm stays instant, OSD shows only
  DISARMED/FAILSAFE.
- **WiFi onboarding — DONE (v1.27.0)**: Setup › WiFi scans (`nmcli … device wifi list`,
  pure `parseWifiScan`), joins a network and manages the hotspot (`hotspotArgs`, open by
  default — `config.hotspot`). A failed join restarts the hotspot so the Pi can't lock
  itself out. `hotspot.mode` (auto/always/off, pure `shouldStartHotspot`, mirrored in
  `onboard.sh`) decides when boot starts it; a WiFi client connection always wins (one
  radio). nmcli paths are hardware-only-verified; the sim has a mock neighbourhood.
- Operator / first-flight guide (non-hardware).
- Real-hardware bring-up: drivers, ESC calibration, encoder, LTE + Tailscale.
- Screenshots: `Mobile_FPV.jpeg` is a real phone screenshot and still shows the
  pre-v1.22 arm button — retake it on a phone when convenient.

Done in the v1.16.2–v1.18.0 review/feature pass: arm-over-WS, no-shell-injection, camera
name/device hardening, INA voltage, per-channel detents, optional shared secret,
telemetry OFF, Setup↗ shortcut, factory reset (vehicle + ground), battery voltage
floor, SBUS error handler, selectable battery-% source, and selectable remote access
(Tailscale / ZeroTier / WireGuard-conf-upload; RealSystem `remoteUp/Down/Status` — the
wg-quick/zerotier-cli paths are hardware-only-verified). Still open: reverse-SSH / VPS
gateway backends, a localhost/Tailscale-only bind mode, auto WS↔WebRTC switch + TURN.

## Style
German UI copy is fine in chat with the owner; **code, comments and identifiers stay
in English**. Keep responses about verified-vs-needs-hardware honest.
