# Changelog

All notable changes to YonderRC. Each release is the full project; every zip is
self-contained.

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
