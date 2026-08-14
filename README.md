**English** · [Deutsch](README.de.md)

# YonderRC

Beyond-line-of-sight remote control over IP — an app for **video, control and
configuration** of cars, boats, planes and drones. Runs in the browser (incl. phone),
as a desktop app (Windows/Linux), and on a Raspberry Pi as the vehicle computer.
Low latency, built for operation over LTE.

Everything runs **in a simulator — with no hardware at all**. For the real build on
the Pi (parts list, wiring, step by step from Wi-Fi → LTE) see
[`docs/HARDWARE.md`](docs/HARDWARE.md).

![Ground station while driving: FPV video with a full OSD — GPS fix and home compass with distance, odometer and speed top left, battery bar top right, link signal and stats bottom right](docs/screenshots/Overview_OSD.png?v=2)

*Ground station while driving: low-latency FPV with a full OSD — GPS fix + **home
compass, distance, odometer and speed** (top left), battery bar (top right), and the
**link signal** + control/video latency, bitrate, FPS and loss (bottom right). A
**Setup ↗** shortcut opens the vehicle's setup page.*

---

## What YonderRC does

**Control**
- 16 channels over WebSocket or a WebRTC data channel; keyboard, on-screen buttons,
  gamepad, or a full touch joystick (multitouch, deadzone, spring return).
- **Models** for car / boat / plane / drone with matching channel templates,
  selectable input method, and per-axis detent (center/min/free).
- Per channel: trim, expo, reverse, endpoints (µs) and failsafe value.

![Touch control with throttle/steering joysticks, Lights/Horn buttons, the WebRTC control toggle and a status strip](docs/screenshots/TouchInputs_and_Status.png?v=2)

*Touch control (multitouch joysticks, bindable buttons), the optional **WebRTC control
channel** toggle, and a status strip: link, state, round-trip, input method,
vehicle/driver, telemetry.*

**On a phone**
- The ground app is a normal web page — open it from a phone over the LAN, the Pi's
  own hotspot, or a VPN address. No install, and the vehicle can serve it itself.
- **Responsive layout**: controls wrap instead of pushing the page sideways, so the
  browser never pans or zooms the view away while you're driving.
- **Compact OSD**: on a phone the overlay automatically shrinks and drops secondary
  readouts so it stops covering the picture. Switchable under FPV › ⚙ › *OSD size*
  (Auto / Compact / Full).

<details>
<summary><b>Mobile view — click to expand</b></summary>

![YonderRC on a phone: FPV with the compact OSD, wrapped tool buttons, arm button and touch joysticks](docs/screenshots/Mobile_FPV.jpeg?v=1)

*Same app on an iPhone: FPV with the compact OSD (GPS, home compass, odometer and
speed left, battery bar right, link/latency in one line), the FPV tools wrapped onto a
second row, and below it the arm button with the touch joysticks and bindable buttons.*

</details>

**Safety**
- Time-based **failsafe watchdog**: if control frames stop arriving, every channel
  goes to its failsafe value. **Vehicle-type aware and separate from disarming** —
  a drone *holds* on link loss (throttle mid), a car/boat *stops*, a plane goes to
  *motor off*.
- **Arming**; every new connection starts disarmed. **Auto-disarm on reconnect is
  coupled to the vehicle type** (car/boat on, plane/drone off — pushed from the
  ground) so a reconnect can't cut an aircraft's motors in flight.
- **Hold-to-arm**: the arm button has to be held for 3 s (with a countdown filling the
  button) to arm *or* disarm, so a mis-touch on a phone can't cut the motors.
  **Panic-disarm** stays instant.
- **Pre-arm check** (throttle must be at its rest position) and **panic-disarm** on a
  bindable key/button, always sent over the reliable link.
- Model switching and settings are locked while armed.
- **Optional shared secret** (off by default): when set, the control link and the
  setup API require it — quick to connect the first time, lockable when you want it.

![Channel monitor: the actual µs output per channel, throttle "HELD SAFE · DISARMED"](docs/screenshots/ChannelOutput_Monitor.png?v=2)

*Channel monitor: shows the **real** vehicle output in µs including failsafe and
disarm — the throttle channel is visibly held safe while disarmed.*

**Video (FPV)**
- Low-latency video over **go2rtc/WebRTC**; the H.264 encoder is auto-detected
  (`libx264`, `libopenh264`, Pi hardware).
- **Self-healing**: detects a frozen/dropped picture and reconnects automatically;
  the last frame stays on screen.
- **Video quality switchable live** from the ground station (high/medium/low) or
  **Auto**: it steps down quickly when loss/latency rise and back up slowly when the
  link is clearly good again (thresholds are editable).
- OSD with status, channels, **bitrate/packet loss/FPS/video latency** and telemetry.
  Every block can be **switched off individually**, and the whole overlay has a
  **compact mode** for phones.
- **Recording & snapshots** locally (pick a folder once; bindable to a key or a
  controller button).

**Telemetry**
- Voltage/current sensors (real: ADS1115/1015, MCP3008/3208, INA219/226/260/3221,
  ACS712/758 — or sim), **precise coulomb counting** (consumed mAh) and
  **battery percentage** from the configured capacity. Sim values are clearly marked
  **SIM**; when a real sensor is missing, the OSD shows **"NO SENSOR"** instead of
  faked numbers, and telemetry can be **turned off** so a first flight shows no fake data.
- **Choose what drives the % gauge**: coulomb counting, a full/empty **voltage** curve,
  or **clamp** (the lower of the two, so a not-actually-full pack can't read 100%). The
  OSD labels which source it's using; the mAh readout is shown independently.
- A single INA sensor can provide **both voltage and current**.
- **Low-battery warning** on percent / voltage / consumed mAh, with a blinking OSD
  marker, controller rumble and a beep.
- **Blackbox logging** (optional, off by default): 2 Hz CSV of arm/failsafe state,
  link, round-trip, bitrate, loss, FPS, video latency, voltage, current, mAh and
  percent — up to ~5 h, downloadable from Setup › Controls.

**GPS & navigation**
- **Selectable GPS source**: a local NMEA receiver over serial (Adafruit Ultimate GPS,
  u-blox NEO-6/7/8/M9, BN-880…), a USB dongle via **gpsd**, a **sim** source, or (later)
  **MAVLink** from a flight controller — all normalized to one fix.
- **Home point**: set it manually, or **auto-home** on the first good fix (takeoff
  point). The OSD shows fix type + satellites and, once home is set, **distance and
  direction back to home** — the essentials for beyond-line-of-sight.

**Operation & setup**
- Graphical **setup page** served by the vehicle itself (`/setup`): driver, cameras,
  telemetry, watchdog, LTE, remote access, security — from a phone/laptop, no screen
  needed. The ground app has a **"Setup ↗" shortcut** that opens it for the connected
  vehicle (works over LAN, the Pi's AP, or a VPN address).

  ![Vehicle setup page: system status (LTE modem, operator, Tailscale, Wi-Fi) and the LTE section with APN, SIM PIN, APN auth and network mode](docs/screenshots/VehicleConfig_Setup.png?v=2)

  *Setup page served by the vehicle: system status (mode, LTE modem/operator, remote
  access, Wi-Fi) and the robust **LTE** section — APN, SIM PIN, APN username/password
  and network mode. Usable from a phone with no screen.*
- **Remote access, pick one method**: **Tailscale** or **ZeroTier** (zero-config mesh
  VPNs) or **WireGuard** — just **upload the `.conf`** exported by your own server or a
  **FritzBox**. Brought up automatically at boot.
- **Robust LTE setup** (not just plug-and-play): APN, **SIM PIN**, **APN username/
  password**, **network mode** (4G-only), **roaming** toggle, live **diagnostics**
  (raw `mmcli`), and **SIM PIN change/remove**. `autoconnect` redials by itself.
- **Guided hardware self-test**: channel sweep, read sensors, camera snapshot.
- **Factory reset** for both the vehicle and the ground app.
- **Self-sufficient in the field**: with no network the Pi starts a Wi-Fi hotspot and
  opens the control/setup page via a **captive portal** — the ground app is served by
  the Pi itself, so you can control and configure with nothing but a phone.
- Hardware drivers **PCA9685 / GPIO-PWM / SBUS** (native libs are optional),
  non-blocking **ESC calibration**.
- **Desktop app** (Electron) with a native SDL2 controller layer (hot-plug, rumble)
  and a fallback to the browser Gamepad API.

---

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev
```

- Vehicle service: `ws://localhost:8080` (sim driver), setup at `/setup`.
- Ground station: `http://localhost:5173`.

Press **Connect**, then **Arm**, and drive with `W A S D` / arrow keys. From a phone
open `http://<PC-LAN-IP>:5173` (the dev server and the vehicle listen on all
interfaces).

**Video in the sim** (synthetic test pattern, needs `ffmpeg`):

```bash
npm run dev            # terminal 1: vehicle + ground app
npm run dev:video      # terminal 2: go2rtc with the test pattern
```

Mind the order: `npm run dev` detects the H.264 encoder and writes the go2rtc config;
then run `npm run dev:video`. Fedora: `sudo dnf install -y openh264 ffmpeg-free`.

**Tests:**

```bash
npm test               # safety / logic test suite
```

---

## On real hardware

The complete build on a Raspberry Pi — parts list, wiring, Pi setup, first on Wi-Fi
then switching to LTE — is in **[`docs/HARDWARE.md`](docs/HARDWARE.md)**.

**Quickest (one line on Raspberry Pi OS Lite):**

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

This clones the repo to `/opt/yonderrc` and runs the installer. Then open
`http://<pi-ip>:8080/setup` and press **Detect hardware** to have it suggest the
driver/sensors from what's on the I²C bus. Prefer to do it by hand? Use the steps below.

**1. Copy the repo onto the Pi** (`/opt/yonderrc`) — one way is enough:

```bash
# a) git clone (if the Pi has internet)
sudo mkdir -p /opt/yonderrc && sudo chown $USER /opt/yonderrc
git clone https://github.com/TechnikWeber/YonderRC.git /opt/yonderrc

# b) scp from the laptop (copy your local repo to the Pi) — run on the LAPTOP:
scp -r ~/YonderRC pi@yonderrc.local:/tmp/YonderRC
ssh pi@yonderrc.local 'sudo mkdir -p /opt/yonderrc && sudo cp -a /tmp/YonderRC/. /opt/yonderrc/'

# c) USB stick (Pi with no network) — insert the stick, then on the Pi:
sudo mkdir -p /opt/yonderrc && sudo cp -a /media/*/YonderRC/. /opt/yonderrc/   # check the path via lsblk
```

**2. Install and configure:**

```bash
sudo bash /opt/yonderrc/provisioning/install.sh   # Node, ffmpeg, go2rtc, systemd, I2C/UART
# then configure graphically at  http://<pi>:8080/setup
```

Driver selection via env (details in `docs/HARDWARE.md` and `provisioning/README.md`):

```bash
YRC_DRIVER=pca9685 npm run start -w @yonderrc/vehicle   # I2C PWM, 16 channels
YRC_DRIVER=gpio-pwm npm run start -w @yonderrc/vehicle   # pigpio
YRC_DRIVER=sbus     npm run start -w @yonderrc/vehicle   # SBUS to a flight controller
```

If a hardware driver fails to start, the service automatically falls back to `sim`
and stays reachable — a headless device never becomes unconfigurable.

---

## Project layout

```
packages/
  protocol/   shared TypeScript types (wire messages, channels, profiles, telemetry)
  vehicle/    vehicle service (Node/tsx): core, failsafe, drivers, sensors, go2rtc, setup
  ground/     ground station (React): control, FPV, OSD, recording, setup UI
  desktop/    Electron shell with native SDL2 input
docs/HARDWARE.md   hardware guide
provisioning/      Pi setup (systemd, LTE, Tailscale, hotspot/onboarding)
test/              test suite (npm test)
```

Everything above the transport is transport-agnostic; control travels over
WebSocket (fallback + signaling) or the WebRTC data channel.

---

## Versions

The current changes are in [`CHANGELOG.md`](CHANGELOG.md) and in the
[GitHub releases](https://github.com/TechnikWeber/YonderRC/releases). This README
always describes the current state.

## Disclaimer — safety & legal

YonderRC controls **physical vehicles** and can cause property damage, injury or
death. It is provided **"as is", without any warranty**, and the author accepts
**no liability** for any damage or loss arising from its use.

- **FPV and beyond-visual-line-of-sight (BVLOS) operation is restricted or outright
  prohibited in many countries** and may require registration, a licence, a spotter
  or special authorisation. **Check and comply with your local laws** (aviation/drone,
  radio/spectrum, privacy) **before you use it.**
- Always fly/drive **responsibly**: keep the failsafe and arming safeguards enabled,
  test everything in the simulator and on the bench first, keep away from people and
  property, and never rely on the link alone.
- You use YonderRC **entirely at your own risk.** See [`LICENSE`](LICENSE) for the
  full no-warranty / liability terms.

## License

YonderRC is licensed under **CC BY-NC-ND 4.0** (Attribution – NonCommercial –
NoDerivatives) **plus one addition: no military or warfare use**. In short: use it for
free and pass on unmodified copies with attribution; no modifying, no commercial and
no military use. The full text is in [`LICENSE`](LICENSE).
