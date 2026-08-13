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
- **Auth for the setup/`/api/*` surface** (from the v1.16.2 review): the setup UI and
  all `/api/*` endpoints are unauthenticated by design (trusted-network assumption).
  Injection was closed in v1.16.2, but `/api/reboot`, `/api/lte`, `/api/tailscale`,
  camera/telemetry writes are still open to anyone on the network. Add an optional
  shared secret (header/token) and/or a bind-to-localhost+Tailscale-only mode; document
  the trust model in `HARDWARE.md`.
- **English-first docs (i18n)**: make `README.md` English, add `README.de.md` (German)
  with a language switcher line at the top of each; optionally `HARDWARE.de.md`. Update
  the GitHub "About" + topics. UI copy can follow later.
- **LTE/WiFi signal in the OSD** (RSSI / quality %): needs vehicle-side reading
  (`iw`/`/proc/net/wireless` for WiFi, ModemManager/`mmcli` or AT for LTE) — device
  specific, best done on real hardware. Add a status field + OSD display when present.
- Operator / first-flight guide (non-hardware).
- Real-hardware bring-up: drivers, ESC calibration, encoder, LTE + Tailscale.

## Style
German UI copy is fine in chat with the owner; **code, comments and identifiers stay
in English**. Keep responses about verified-vs-needs-hardware honest.
