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
- **Stored profiles outlive app versions.** `loadProfiles()` heals them once on load
  (`repairAxisBindings` + `withResolvedThrottle`) and rewrites storage: an axis binding
  whose `source`/`element` don't match the profile's `inputMethod` is invisible on the
  pad and undrivable (pre-v1.10 mode switches could produce exactly that). Add repairs
  there rather than assuming stored data matches the current shape.
- **Which channel is throttle** comes from `throttleChannelsOf(profile)`
  (`ground/src/lib/templates.ts`), derived from the bindings' labels with the stored
  `profile.throttleChannels` as fallback — the stored list used to go stale whenever a
  binding was moved, and it drives the disarmed value, the failsafe array, the pre-arm
  check, the OSD bar and the speed limiter. Never read `profile.throttleChannels`
  directly; the binding editor normalises it via `withResolvedThrottle` on every edit.
- **Speed limiter** (`ground/src/lib/throttleLimit.ts`): three per-model steps, scaled
  around the channel's rest position (`throttleSafeUs`), applied to what is SENT while
  the pre-arm check keeps seeing the raw command.
- **Per-channel rest position** (`detent`: center/low/free) drives where hold-ramp /
  momentary / toggle settle, and the **pre-arm check** (`ground/src/lib/safety.ts`)
  uses the throttle channel's detent to know the safe rest (centre vs idle).
- **Actions** (`ground/src/lib/actions.ts`): panic-disarm, arm, next-camera, record,
  snapshot — bindable to key+button, edited in Setup › Controls. Add new bindable
  features here rather than scattering hotkeys. **panic-disarm and toggle-arm ship
  unbound** (panic fires instantly with no hold — an accidental press is a crash);
  storage is `yonderrc.actions.v2`, and `migrateActions` drops a stored panic binding
  that is exactly the pre-v1.30 `escape` default while keeping deliberate choices.
- **Link gaps** (`ground/src/lib/linkQuality.ts`, v1.67.0): a watchdog trip is invisible —
  `VehicleCore.resolveOutput()` drops every channel to failsafe after `watchdogTimeoutMs`,
  the status goes out at 20 Hz and the bars snap back unread; the 2 Hz blackbox misses it.
  `foldLinkQuality` counts failsafe **rising edges** (not ticks — a held failsafe is one
  episode) and keeps the worst `lastFrameAgeMs`, reset per connection in `onWelcome`.
  `lastFrameAgeMs === -1` means the vehicle has accepted no frame at all — every connection
  opens in that state, so it must never count as a dropout. Measured 2026-08-28 on an
  indoor LTE/hotspot link: 13 gaps >300 ms per minute at 0 % packet loss — jitter, not
  latency, is what trips the watchdog.
- **Video** (`ground/src/components/VideoPanel.tsx`): self-healing WHEP player. The
  watchdog uses **refs, not stale state**; a fresh connect bumps `genRef` so a
  superseded attempt can't attach a dead stream. Keep that invariant.
- **Telemetry channels**: voltages/currents/temperatures are lists; the one flagged
  `primary` (else index 0, see `protocol/telemetry.ts` `primaryIndex`) drives battery %,
  mAh/Wh, the low-battery warning and the blackbox. **`chargeSource: 'auto'` states a wish,
  not an outcome** — `resolveChargeSource` degrades to Pi integration whenever the primary
  current channel is not an INA228, and the mAh keep coming either way, only less accurate.
  The resolved `chargeFrom` therefore has to stay visible: Setup › Sensors (`renderChargeLive`)
  and the overview's `· counter` row, since v1.66.1. Verified live on the reference Pi
  (2026-08-28): the hardware counter tracked the polled current to 0.6 % over 151 s. The OSD prefixes a channel's label
  only when its kind has >1 channel, and each value can be hidden per browser
  (`yonderrc.osdHidden.v1`, keyed by `readingKey`).
- **Telemetry config hot-applies** (`vehicle` POST `/api/telemetry` →
  `TelemetryService.reconfigure`). Battery % needs a capacity set there.
- **The setup page is tabbed** (v1.63.0): every `<section class="panel">` in
  `vehicle/src/setup/setup.html` declares a `data-tab` (overview / network / remote /
  sensors / camera / gps) and `showTab` shows one group at a time, keyed off the URL hash.
  A new panel without a `data-tab` is invisible on every tab — the test suite checks the
  panels, the buttons and the switcher's own list against each other. **Hidden panels stay
  in the DOM** (`hidden`, not removed): handlers read fields across groups. Long
  explanations belong in `<details class="hint">` with the one-line takeaway as the
  `<summary>`, not in an always-open `<p class="msg">` — the ground app has the same
  pattern in `components/Hint.tsx` (`<p class="note">` stays the short one-liner), and
  every settings group in `ControlsPanel` is a `<details class="group">` that starts
  closed — with the two forced-auto-disarm ⚠ notes deliberately *outside* their group,
  since a warning you have to unfold is not a warning (the suite checks both).
  The tab strip **wraps**; only under 520px is it a single scrolling row, because a
  mouse wheel cannot scroll a horizontal box and the last tab became unreachable. `body` must keep `overflow-x: clip`
  rather than `hidden` — `hidden` makes it a scroll container and the sticky tab bar has
  nothing to stick to.
- **`system/health.ts`** (v1.66.0, ported from YonderGate) carries temperature, load,
  uptime, card space and the clock, on `/api/health` — polled at 30 s, deliberately NOT
  part of the 3 s status: every reading costs a file or a process on a box that is also
  driving servos. `Number('')` is 0, so every parser checks for an empty read first — an
  unreadable sensor must be *unknown*, not a healthy 0 °C. The **clock** is reported next
  to the update button rather than as a status row: it matters for exactly one thing, a
  `git pull` that fails with a certificate error naming neither the cause nor the fix.
  There is deliberately **no DS3231 and no NTP-server editor** here — the vehicle only
  needs the time when it already has internet, and then NTP just works.
- **The theme belongs to the vehicle** (v1.64.0): `config.theme` ('light' default since v1.65.0 | 'dark'),
  edited in Setup › Design, sent to the ground as its own `theme` WS message right after
  the welcome and re-broadcast to every connected client when it changes. The ground has
  **no switch of its own** — `ground/src/lib/theme.ts` only caches the last answer so a
  cold start does not flash the wrong palette. Both stylesheets carry the whole palette as
  tokens under `:root[data-theme='light']`; a hardcoded colour outside those blocks simply
  will not switch. The **`.video-stage` keeps the dark tokens in both themes** — the OSD is
  drawn on the picture, not on the page. The suite fails if a `var(--x)` in the ground CSS
  has no definition (that bug had `--bad`/`--go` undefined for months).
- go2rtc config path is **absolute**, never a bare relative path (that caused an ENOENT
  crash historically). On a Pi it is **`/var/lib/yonderrc/go2rtc.yaml`** since v1.45.0
  (`YRC_GO2RTC_CONFIG` in `yonderrc-vehicle.service`, same path in `go2rtc.service`);
  the dev/docker default still resolves to `docker/go2rtc.yaml` in the repo. It is
  **generated**, so writing it inside the checkout dirtied every running vehicle and
  blocked `git pull --ff-only` — keep generated state out of the working tree.

## Release / packaging flow
Bump all five `package.json` to the same version and update the masthead string in
`ground/src/App.tsx`, then add a `CHANGELOG.md` entry. The **vehicle banner and the setup
page read the version from `package.json`** (`config.version`, since v1.45.1) — nothing to
bump there, and the test suite fails if the ground masthead falls behind. Locally you can just commit + tag + `gh release create`. README describes the
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
- **Hold-to-arm — DONE (v1.22.0, configurable since v1.28.0)**: press-and-hold for arm
  *and* disarm (`ground/src/lib/hold.ts`; default 1 s, 0.5–10 s, switchable off in
  Setup › Controls — `holdMsFor` returns 0 and the button becomes a plain toggle).
  Since v1.29.0 the same hold gates the **bound key / gamepad button** via
  `useActionHotkeys(..., { holdMs, actions: ['toggle-arm'], onProgress })`, whose
  progress drives the arm button's fill. Panic-disarm stays instant, OSD shows only
  DISARMED/FAILSAFE.
- **WiFi onboarding — DONE (v1.27.0)**: Setup › WiFi scans (`nmcli … device wifi list`,
  pure `parseWifiScan`), joins a network and manages the hotspot (`hotspotArgs`, open by
  default — `config.hotspot`). A failed join restarts the hotspot so the Pi can't lock
  itself out. `hotspot.mode` (auto/always/off, pure `shouldStartHotspot`, mirrored in
  `onboard.sh`) decides when boot starts it; **the default is `always` since v1.41.0** (an
  unset mode follows it too), and a WiFi client connection always wins (one radio). nmcli paths are hardware-only-verified; the sim has a mock neighbourhood.
  **Corrected in v1.39.1 on real hardware**: `nmcli device wifi hotspot` *always* secures
  the AP ("If not provided, nmcli will generate a password"), so the documented open
  hotspot never was open — `wifi.ts` `hotspotCommands` builds the profile explicitly
  (`connection add … 802-11-wireless.mode ap … ipv4.addresses 192.168.4.1/24`, security
  added only for a real password) and `hotspotStart` reads the key back instead of
  assuming. Pi OS also keeps the radio rfkill-blocked until a **WiFi country** is set —
  `wifiRadio`/`wifiRadioEnable` (+ `explainWifiFailure`, `guessWifiCountry`) diagnose and
  repair that from Setup › WiFi, and `onboard.sh` mirrors both.
- **Native driver modules from the UI — DONE (v1.39.0)**: `vehicle/system/hwDeps.ts` holds
  the allowlist (`i2c-bus`/`pigpio`/`serialport`), the npm args and `explainNpmFailure`
  (pure, unit-tested: no internet / no compiler / missing C library / timeout / full disk /
  permissions each get a cause + the command that fixes it). `GET|POST /api/hw-deps`
  installs one, `POST /api/restart` restarts the unit, and Setup › Vehicle configuration
  lists status + Install buttons — the point is that a vehicle reachable only over its own
  hotspot never forces an SSH session. Successful installs are recorded in `hardwareDeps`
  and **restored by `install.sh`** after an update (`--omit=optional` prunes them). Only
  the sim path is proven; the real npm/node-gyp run is hardware-only-verified.
- **HiLink LTE sticks — DONE (v1.40.0)**: Huawei E3372h-320 & co. are routers, not
  ModemManager modems (`mmcli -L` stays empty). `vehicle/system/hilink.ts` reads their XML
  API (`SesTokInfo` session first, then `monitoring/status`, `device/signal`,
  `current-plmn`, `device/information`) with everything pure + injectable `get` so it is
  tested against recorded XML. **The interface comes from `ip route get <host>`, never
  from a name** — a LAN on the other `eth*` must never be taken for the stick.
  `linkSignal()` falls back to it, so the OSD shows LTE % without ModemManager.
  `transport/hilinkProxy.ts` passes the stick's own web UI through on its own port
  (root-level, since the HiLink UI is full of absolute paths), gated by the API secret via
  `?secret=` → cookie; `config.hilink.proxyPort` null = off (default). The XML shapes are
  recorded-from-docs, so the real stick is still the only proof.
- **CSI camera pipeline — DONE (v1.47.0–v1.49.1)**: three separate bugs, all found on a
  real Pi 4B. (a) The generated go2rtc source called `libcamera-vid`; Bookworm renamed the
  tools to `rpicam-*` — `detectRpicamBinary()` resolves it at startup. (b) The source
  piped through ffmpeg, but **go2rtc runs `exec:` without a shell** (`shell.QuoteSplit` +
  `exec.Command`), so the `|` was a literal argv; without `{output}` go2rtc reads stdout
  and sniffs the format, so the `rpicam` path is now plain `rpicam-vid … -o -`. Never
  reintroduce a pipe there. (c) A sensor outside the firmware's auto-detect set needs
  `camera_auto_detect=0` + `dtoverlay=`, which **Setup › CSI camera module** now writes
  (`vehicle/system/bootConfig.ts`, pure + tested; competing lines are commented out, one
  backup as `config.txt.yonderrc-bak`, reboot detected via the kernel boot id). The module
  choice is deliberately *not* a fourth `CameraCfg.type` — the type says how the picture is
  produced, the overlay is one setting for the one CSI connector.
  **Focus**: `CameraCfg.focus`/`lensPosition`/`tuningFile`. Raspberry Pi's `imx519.json`
  has no `rpi.af` algorithm, so an Arducam 16MP is permanently soft; we ship
  `provisioning/tuning/imx519-af.json` with a **measured** map (`[0.0, 597, 10.0, 1023]` —
  the actuator's rest position is *not* infinity). `manual` at 0 dioptres beats
  `continuous` on a moving model.
- **I²C identification + addresses from the browser — DONE (v1.60.0–v1.60.2)**:
  `vehicle/system/detect.ts` reads ID registers via `i2ctransfer` (`probesFor` /
  `identifyI2c`, pure + tested) and names the actual chip — INA2xx by manufacturer + die
  id, MCP9808/TMP117/BMP280/BME280 by chip id, and the PCA9685, which has no ID register,
  through its all-call address 0x70. `Pca9685Driver` therefore **keeps ALLCALL enabled**;
  clearing it (a bare 0x00 to MODE1) makes a running chip unidentifiable. The PCA's
  bus/address is a persisted setting with a field in the setup UI (was `YRC_I2C_ADDR`
  only), voltage/current channels have an address field, and `GET /api/config` answers
  with the **saved** values plus `restartPending` — reporting only the running ones made
  a saved change look lost. Reference pairing: **INA228 on 0x40, PCA9685 on 0x41**.
- **GPS bring-up without a terminal — DONE (v1.61.0/v1.61.1)**: Raspberry Pi OS parks a
  login console on the header UART, and `install.sh` only ever enabled the hardware — so
  every wired GPS delivered shredded NMEA. `system/serial.ts` (pure) strips the console
  token from cmdline.txt token-wise and ensures `enable_uart=1`; Setup › GPS shows the
  state and frees the port, the installer does it on fresh installs. `/dev/serial0` is the
  device everywhere — **`/dev/ttyAMA0` is the Bluetooth UART on a Pi 3/4/5** and stays
  silent, which the panel now warns about. GPS link stats (sentences, satellites in view)
  make a receiver verifiable **indoors**, where there will never be a fix.
- Operator / first-flight guide (non-hardware).
- Real-hardware bring-up: drivers, ESC calibration, encoder, LTE + Tailscale.
- Screenshots: `scripts/screenshots.mjs` regenerates every image in `docs/screenshots`
  (headless Chrome over CDP at deviceScaleFactor 2; needs `npm run dev` **and**
  `npm run dev:video` running). Retake them whenever the UI changes visibly — they had
  gone three releases stale before v1.65.2. `Mobile_FPV` is an emulated 390 px viewport,
  not a device photo, and both READMEs say so; a real phone screenshot is still welcome.

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

**Both language versions are edited in the same commit — always.** `README.md` /
`README.de.md`, `docs/HARDWARE.md` / `.de.md`. A translation that lags is worse than
none: it states as current something the project stopped doing, and the reader has no
way to tell which of the two is the lie. The test suite fails if the two READMEs stop
matching in structure (heading count), which catches the common case of adding a
section to one of them.
