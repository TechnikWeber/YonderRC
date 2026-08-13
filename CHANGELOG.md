# Changelog

All notable changes to YonderRC. Each release is the full project; every zip is
self-contained. Entries from v1.17.0 on are bilingual (English / Deutsch).

## v1.17.1
**English**
- **Optional shared secret (off by default).** Set an "API secret" in the vehicle's
  Setup › Security. While unset, nothing changes — first-time connect and setup need
  no password. Once set, it's required for **saving settings** (mutating `/api/*`
  POSTs, via header `x-yonderrc-secret` or `?secret=`) **and for the control link**
  (the ground app's new "secret" field, sent as `?secret=`; a wrong/missing secret is
  rejected with WS close 4001). The secret is never returned by the API. Set/clear it
  live without a restart.

**Deutsch**
- **Optionales Shared Secret (standardmäßig aus).** Unter Setup › Security am Fahrzeug
  ein „API secret" setzen. Solange keins gesetzt ist, ändert sich nichts — der erste
  Verbindungsaufbau und das Setup brauchen kein Passwort. Einmal gesetzt, ist es nötig
  zum **Speichern von Einstellungen** (mutierende `/api/*`-POSTs, per Header
  `x-yonderrc-secret` oder `?secret=`) **und für den Steuer-Link** (neues „secret"-Feld
  in der Ground-App, als `?secret=`; falsches/fehlendes Secret → WS-Close 4001). Das
  Secret wird von der API nie zurückgegeben. Setzen/Löschen live ohne Neustart.

## v1.17.0
**English**
- **English-first documentation.** `README.md` and `docs/HARDWARE.md` are now
  English; the German originals live in `README.de.md` and `docs/HARDWARE.de.md`,
  with a language switcher at the top of each. No code changes — docs only.

**Deutsch**
- **Englisch als Hauptsprache der Doku.** `README.md` und `docs/HARDWARE.md` sind
  jetzt englisch; die deutschen Originale liegen in `README.de.md` und
  `docs/HARDWARE.de.md`, mit Sprachumschalter oben in jeder Datei. Keine
  Code-Änderungen — nur Dokumentation.

## v1.16.3
- **Camera setup hardening**: stream names are restricted to a safe charset (they
  become go2rtc stream keys *and* the ground's stream id), USB device paths are
  validated, and dimensions/fps are coerced to safe integers — a crafted camera
  name or device path can no longer break the generated `go2rtc.yaml` or inject
  into its `exec:` command lines. Names are normalised on save so config, welcome
  and YAML stay in sync.
- **INA sensors can now provide pack voltage too**: `ina219/226/260/3221` are
  selectable as voltage channels and read from their bus-voltage register, so a
  single INA battery monitor delivers both voltage and current (no extra divider).
  *(Register conversions are unit-tested; the I²C read path is hardware-verified only.)*
- **Fix — per-axis detent could be mis-assigned after a transmitter-mode change**:
  detents are now preserved per channel (not per stick axis), so switching input
  method after changing the stick mode keeps each channel's centering correct.

## v1.16.2
- **Safety fix — arm/disarm now always travels over the reliable WebSocket.**
  Previously, when the opt-in "Control via WebRTC data channel" mode was active,
  arm/disarm (incl. panic-disarm) went over the lossy, no-retransmit data channel,
  so a single dropped packet could silently leave the vehicle armed. Only control
  frames (which are superseded 20 ms later) now use the data channel; every
  one-shot command (arm, config, hello, video, calib) is forced onto the WS.
- **Security fix — no more shell injection in the vehicle setup API.** The LTE APN
  and Tailscale auth key from `/api/lte` and `/api/tailscale` were interpolated
  into shell strings; a crafted value could execute arbitrary commands on the Pi.
  These now use `execFile` (no shell), so operator input is a literal argument.

## v1.16.1
- **OSD refinement**: the battery **charge bar stands alone top-right** (phone-style),
  and the numeric battery data (voltage, current, mAh) moves to the **bottom-right as
  its own panel under the link/latency block**, so the two are cleanly separated.

## v1.16.0
- **OSD layout swapped** for a more intuitive read: battery/power block (charge bar,
  voltage, current, capacity) now sits **top-right**, phone-style, with the charge
  bar on top; link/latency data (control path, ctrl/video ms, bitrate, fps, loss)
  moved to the **bottom-right**.

## v1.15.0
- Fix: battery %/mAh now appears **without a vehicle restart** — telemetry config
  hot-applies (`/api/telemetry` reconfigures the running service). Set the capacity
  in the vehicle's Setup › Telemetry.
- Fix: switching Setup → Drive could show a black picture every other time — the
  WHEP stream now attaches only for the latest connection attempt (generation guard)
  and force-plays, so overlapping attempts can't leave a dead stream.
- **Fullscreen** button on the FPV panel (OSD stays overlaid).
- Vehicle Setup: camera W/H/FPS/kbps fields no longer overflow their box.
- Added `CLAUDE.md` for local development handoff.

## v1.14.0
- **Blackbox logging** (opt-in, OFF by default): records telemetry + link stats
  (RTT, bitrate, loss, fps, video latency, volts/amps/mAh/percent) at 2 Hz while
  enabled and downloads as CSV. Costs nothing when off; buffer is capped. In
  Setup › Controls.
- **Low-battery warning** gained a **consumed-mAh** threshold (in addition to
  percent and voltage), and the settings layout was tidied into aligned rows.
- Fix: switching Setup → Drive could leave a frozen/black video with no recovery —
  the frame watchdog used a stale state value; it now tracks live frames and
  reconnects a black stream on its own.

## v1.13.0 — Low-battery warning
- **Low-battery warning** with independent **percent** and **voltage** thresholds.
  "Auto" mode only warns when a real sensor is delivering data (no nagging in sim);
  can be forced on/off. Alerts — **OSD red blink**, **rumble** and **sound** — are
  each individually switchable and repeat every ~3 s while low. Settings live in
  Setup › Controls.

## v1.12.0 — Safety & controls
- **Pre-arm check**: arming is refused while a throttle channel is off its rest
  position (centre for reverse-capable cars/drones, idle for planes/boats — taken
  from the channel's detent). Toggleable in Setup › Controls, on by default.
- **Unified action bindings** (Setup › Controls): assign a keyboard key and/or a
  controller button to Panic-disarm, Arm/disarm, Next-camera, Record and Snapshot,
  each with a Learn button. Record/snapshot hotkeys moved here from the FPV panel.
- **Panic disarm**: a bindable action that disarms immediately over the reliable link.
- **React error boundary**: a UI fault shows a reload panel instead of a white screen.
- **Flight timer + session**: runs while armed (OSD top-left and status strip), with
  mAh consumed since arming when a real sensor is present.


## v1.11.0
- OSD: link state moved to top-center, armed/failsafe to bottom-center; the
  top-right stats and bottom-right telemetry now sit on a translucent panel so
  they stay readable over bright video.
- Channels: added an **Edit** button (alongside Add/Remove) and a per-channel
  **rest position** (center / min / hold) so a hold-ramp, momentary or toggle can
  settle at centre (1500) instead of min. Independent of stick modes.
- Channel monitor: throttle-held-safe channels are now clearly tinted and labelled
  "held safe · disarmed" instead of a truncated tag.


## v1.10.0
- **Transmitter stick modes 1–4**: switch which stick controls throttle / elevator
  / aileron / rudder — for touch, gamepad and keyboard. Chosen per model in Setup
  and preserved across input-method switches (car/boat default to Mode 1, plane/
  drone to Mode 2).
- **Add / remove channels**: build your own channel map in Setup. "+ Add channel"
  with a channel number, label, source (keyboard / gamepad / on-screen), mode
  (proportional / momentary / toggle / hold-ramp) and a "Learn" button to capture a
  key or gamepad button/axis; each channel has a Remove button. Custom channels now
  survive input-method and stick-mode switches.


## v1.9.0
- Fix: per-channel and global endpoints (µs) now actually apply beyond 1000–2000 —
  the hard clamp was widened to an absolute 500–2500 range (nominal default stays
  1000–2000). The channel monitor scales each bar to that channel's own endpoints.
- UI: dark, consistent styling for all dropdowns and number fields. Layout
  reorganised — model selection now lives under Setup only; Drive view is
  Vehicle-Link → FPV+control → status info → servo outputs. The OSD now shows the
  link state (LINK / NO LINK) alongside armed/failsafe.


## v1.8.0
- **Auto video quality**: a new "Auto" mode steps the video quality down when the
  link degrades (packet loss / latency) and back up when it recovers, with
  hysteresis so it doesn't oscillate. Thresholds are adjustable in the FPV video
  settings (⚙). Manual High/Medium/Low still available.
- **Link robustness**: the OSD now shows "RECONNECTING…" during control-link
  recovery and a "⚠ WEAK LINK" warning when control latency or video loss is high.
- **License**: switched to CC BY-NC-ND 4.0 with an additional no-military-use
  restriction. README gained the repo-copy instructions (git/scp/USB).


## v1.7.2
- Docs: README rewritten to be concise and describe the current feature set
  (per-version notes moved to this changelog). Added a LICENSE — freeware for
  private, non-commercial use; no modification, no commercial use, and no
  military/warfare use.

## v1.7.1
- Fix: live video quality change crashed the vehicle with ENOENT — the go2rtc
  config path is now absolute (resolved to the repo root) and writes create the
  folder and never throw. REC toast in the OSD now blinks red.

## v1.7.0
- **Self-healing video**: the FPV stream now detects a frozen/dropped picture
  (WebRTC state + a frame watchdog) and reconnects on its own with backoff, keeping
  the last frame on screen and showing "Reconnecting…" instead of freezing.
- **Live video quality from the ground** (High / Medium / Low): the ground sends a
  command; the vehicle rescales resolution + caps bitrate and reloads go2rtc, then
  the stream re-establishes automatically. Keeps the picture fluid on a poor link.
- **Connection stats in the OSD**: bitrate, packet loss, FPS and video latency from
  WebRTC stats (top-right). Armed/failsafe badge moved to top-center so it no longer
  overlaps the REC indicator.

## v1.6.0
- **Recording & snapshots** in the FPV panel: record the live video locally (WebM)
  and grab stills (PNG). Pick a target folder once before flight (File System
  Access API) so nothing needs clicking mid-flight; otherwise files go to Downloads.
  Bindable to a keyboard key or controller button (video start/stop + snapshot).
- **Guided hardware self-test** in the setup UI: sweep any channel (min→max→center,
  disarmed only — refused while armed), read the current sensor values once, and
  snapshot each camera. Makes the first real bring-up a click-through.
- **Repeatable test suite** (`npm test`): consolidates the sensor math, coulomb
  counting, sim/real telemetry, vehicle-type failsafe/disarmed logic, template and
  binding-engine behaviour, and camera-source generation into one run (23 checks).

## v1.5.1
- Auto-detect the H.264 encoder (libx264 / libopenh264 / Pi hardware) so video
  works without RPM Fusion; `dev:video` accepts any usable encoder.

## v1.5.0
- Disarmed and failsafe are separate, vehicle-type-aware values (drone holds on
  link loss, disarms motors-off). Auto-disarm on reconnect is toggleable (off for
  aircraft). Telemetry shows "NO SENSOR" instead of silently substituting sim.
  Field operation: AP hotspot + captive portal; the Pi serves the ground app.

## v1.4.0
- Sim telemetry clearly marked SIM (OSD + status). Model switch and settings
  locked while armed. New connections start disarmed. Hardware guide added.

## v1.3.0 / v1.3.1
- Telemetry subsystem (voltage/current sensors, coulomb counting, battery %),
  graphical camera configuration generating go2rtc.yaml, video-latency estimate.
  libx264 preflight added.

## v1.2.0
- Video verified end-to-end (go2rtc /api/webrtc), `dev:video` helper.

## v1.1.x
- Models (car/plane/drone/boat) from templates, per-model input method and
  per-axis detents, virtual joystick, µs endpoints; reconnect and detent fixes.

## v1.0.0
- First consolidated monorepo: protocol, vehicle (sim + hardware drivers), ground
  (React), desktop (Electron + SDL2). Sim-complete.
