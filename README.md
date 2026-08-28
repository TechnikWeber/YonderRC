**English** · [Deutsch](README.de.md)

# YonderRC

Beyond-line-of-sight remote control over IP — **video, control and configuration** for
cars, boats, planes and drones. Runs in the browser (incl. phone), as a desktop app
(Windows/Linux), and on a Raspberry Pi as the vehicle computer. Built for LTE.

Everything runs **in a simulator, with no hardware**. For the real build see
[`docs/HARDWARE.md`](docs/HARDWARE.md).

![Ground station while driving: FPV video with a full OSD — GPS fix and home compass with distance, odometer and speed top left, battery bar top right, voltage/current/mAh bottom right, link health score top centre](docs/screenshots/Overview_OSD.png?v=5)

*FPV with the full OSD: GPS + home compass, distance, odometer and speed (top left),
battery bar (top right), voltage/current/mAh (bottom right), link health as one score
(top centre). Light or dark is set on the vehicle (Setup › Design).*

---

## What YonderRC does

**Control**
- 16 channels over WebSocket or a WebRTC data channel; keyboard, on-screen buttons,
  gamepad or a full touch joystick (multitouch, deadzone, spring return).
- **Models** for car / boat / plane / drone with matching channel templates, selectable
  input method and per-axis detent (center/min/free).
- Per channel: trim, expo, reverse, endpoints (µs), failsafe value.
- **Response curves** per stick channel (3/5/7/9 points, live plot) for shapes expo
  cannot express. Off by default.
- **Live trims** under the sticks: 5 µs a press, up to ±150 µs, saved with the model.
- **Speed limiter**, three steps, switchable while driving. Scaled around the throttle's
  rest position, so a car is capped in both directions and a plane only upwards.

![Touch control: one large steering/throttle stick, the hold-to-arm button, Lights and Horn buttons, the speed limiter, the WebRTC control toggle and a status strip](docs/screenshots/TouchInputs_and_Status.png?v=5)

*Touch control, hold-to-arm, speed limiter, the WebRTC toggle, and a status strip:
link, state, session, round-trip, link gaps, input, vehicle, telemetry.*

**On a phone**
- A normal web page — open it over the LAN, the Pi's own hotspot or a VPN address. No
  install; the vehicle can serve it itself.
- **Responsive layout** and a **compact OSD** that drops secondary readouts so it stops
  covering the picture (FPV › ⚙ › *OSD size*).

<details>
<summary><b>Mobile view — click to expand</b></summary>

![YonderRC on a phone: FPV with the compact OSD, wrapped tool buttons, arm button and touch joysticks](docs/screenshots/Mobile_FPV.jpeg?v=5)

*The same app at 390 px: compact OSD, wrapped FPV tools, arm button and touch stick.*

</details>

**Safety**
- **Failsafe watchdog**: no control frames → every channel goes to its failsafe value.
  **Vehicle-type aware and separate from disarming** — drone *holds*, car/boat *stops*,
  plane goes to *motor off*.
- **Arming**; every connection starts disarmed. Auto-disarm on reconnect follows the
  vehicle type (car/boat on, plane/drone off), overridable in Setup › Controls.
- **Hold-to-arm** (1 s default) for arm *and* disarm, on the button and on a bound
  key/controller button. Adjustable, switchable off. **Panic-disarm stays instant** and
  ships **unbound**, so you pick a key you cannot hit by accident.
- **Pre-arm check**: throttle must be at its rest position.
- **Stick feedback** (off by default): a click or rumble at centre and at the rim, since
  a thumb on glass has no edge to feel for. iPhones cannot vibrate from a web page, so
  the default is a click.
- Model switching and settings are locked while armed.
- **Optional shared secret** (off by default) for the control link and setup API.

![Channel monitor: the actual µs output per channel, throttle "HELD SAFE · DISARMED"](docs/screenshots/ChannelOutput_Monitor.png?v=5)

*The **real** vehicle output in µs, including failsafe and disarm.*

**Video (FPV)**
- Low-latency video over **go2rtc/WebRTC**; H.264 encoder auto-detected (`libx264`,
  `libopenh264`, Pi hardware).
- **Self-healing**: detects a frozen picture and reconnects; the last frame stays up.
- **Quality switchable live** (high/medium/low) or **Auto** — starts low, climbs when the
  link is clearly good, steps down fast when it is not.
- **CSI camera module picked in the browser.** Only the four official Pi sensors are
  auto-detected; anything else needs a device-tree overlay, which Setup writes (one
  backup, reboot flagged). **Rotation/mirroring** and, where the module has an actuator,
  **focus** are per camera.
- **No camera is a supported setup**: remove every entry and the FPV area stays dark
  while OSD, telemetry and controls carry on.
- OSD with status, channels, bitrate/loss/FPS/video latency and telemetry. Every block
  and every single sensor value can be switched off.
- **Recording & snapshots** locally, bindable to a key or button.

**Telemetry**
- Voltage/current sensors (ADS1115/1015, MCP3008/3208, INA219/226/228/237/238/260/3221,
  ACS712/758 — or sim), **coulomb counting** and **battery %** from the capacity.
- Sim values are marked **SIM**; a missing real sensor shows **NO SENSOR**, never faked
  numbers. Telemetry can be turned off entirely.
- **% source is selectable**: coulomb, a full/empty voltage curve, or **clamp** (the
  lower of the two).
- **Temperature, 1..n**: Pi SoC, DS18B20, MCP9808 / TMP102 / TMP117 / BMP280 / BME280,
  MAX6675 / MAX31855 / MAX31856 / MAX31865, or an NTC/PT100 on an ADS1115 / MCP3008.
- **Any number of channels, individually switchable** in the OSD; labels appear once a
  kind has more than one channel.
- **One channel is *primary*** and drives the battery %, mAh/Wh, the low-battery warning
  and the blackbox — so a second sensor cannot quietly take over the battery maths.
- **INA228 (recommended)** counts charge in hardware, so the mAh no longer depend on the
  polling rate. 85 V bus, 20-bit. INA237/238 are the same family without the counter.
- **Low-battery warning** on percent / voltage / mAh, with a blinking OSD marker, rumble
  and a beep.
- **Return-home energy budget** (off by default): measures consumption per km and answers
  *how much further you may go and still get home*. A percentage cannot — 30 % is plenty
  at 50 m and not enough at 800 m. Needs capacity, a current sensor and a home point.
- **Voice callouts** (on by default, offline): link lost/restored, failsafe, arm state,
  low battery. A beep says *that* something happened, a voice says *what*.
- **Link health as one number**: round-trip, loss and signal as a 0–100 score with a
  trend arrow. It is the **worst** of the three, not an average. The individual numbers
  come back by themselves when the link goes bad.
- **Blackbox logging** (off by default): 2 Hz CSV of arm/failsafe, link, round-trip,
  bitrate, loss, FPS, video latency, mAh, percent, **one column per telemetry channel**,
  and the GPS track in the same row — so you can colour the route by pack voltage in
  QGIS. A second button exports plain **GPX**.

**GPS & navigation**
- **Selectable source**: serial NMEA receiver, USB dongle via **gpsd**, **sim**, or
  (later) MAVLink — all normalized to one fix. Setup frees the header UART (Raspberry Pi
  OS parks a login console on it) and counts arriving sentences, so a receiver can be
  verified indoors where there will never be a fix.
- **Home point**, manual or auto on the first good fix. The OSD shows fix + satellites
  and, once home is set, distance and direction back.

**Operation & setup**
- **Mobile data budget**: counts every metered uplink (LTE stick, phone hotspot, tethered
  laptop) and shows **⚠ DATA** past a set share of the plan. The vehicle's own hotspot and
  VPN interfaces are excluded — free and double-counted respectively. A HiLink stick's own
  billing month can be used instead. Survives reboots.
- **Link gaps**: a watchdog trip lasts one control tick and is gone before it can be read.
  The status strip counts the episodes per connection and the longest wait for a frame.
- Graphical **setup page** on the vehicle (`/setup`): driver, cameras, telemetry,
  watchdog, Wi-Fi, LTE, remote access, security — from a phone, no screen needed.
  **Wi-Fi onboarding**: scan, pick, connect; the hotspot returns if the password was
  wrong, and can be kept up next to LTE. The ground app has a **Setup ↗** shortcut.

  ![Vehicle setup page, Overview tab: tabs across the top, then system status — mode, LTE modem and operator, remote access, Wi-Fi, and one line each for sensors, GPS and cameras — followed by the hardware test, the software update and the system buttons](docs/screenshots/VehicleConfig_Setup.png?v=5)

  *Tabs — Overview · Network · Remote access · Sensors & outputs · Camera · GPS · Design,
  each one a URL (`…/setup#gps`). Overview answers "is everything there?" on one screen.*
- **Remote access, one method**: **Tailscale**, **ZeroTier** or **WireGuard** — upload
  the `.conf` from your server or FritzBox, or type the values in. Up at boot.
- **Robust LTE**: APN, SIM PIN, APN user/password, 4G-only mode, roaming toggle, raw
  `mmcli` diagnostics, PIN change/remove. `autoconnect` redials by itself.
- **HiLink sticks too** (Huawei E3372h-320 & co.). They are routers, invisible to
  `mmcli`, so YonderRC reads the stick's own API for state, operator and signal. Found
  through the **routing table**, never by interface name; its config page is proxied
  through the vehicle on port 8081.
- **Native driver modules install from the browser**: `i2c-bus`, `pigpio`, `serialport`,
  one button each. A failed build is translated into a cause and the fixing command.
- **The Wi-Fi radio fixes itself**: Pi OS keeps it rfkill-blocked until a Wi-Fi country
  is set, and NetworkManager only says "device is not available". Setup unblocks it.
- **Update from the setup page**: check shows the incoming commits; update pulls,
  installs dependencies, rebuilds the control app and restarts.
- **Guided hardware self-test**: channel sweep, read sensors, camera snapshot.
- **The vehicle reports its own condition**: **⚠ POWER** in the OSD while the 5 V rail
  sags (a brownout reset is indistinguishable from a crash from the ground), plus SoC
  temperature, load, uptime and free card space on the overview. The clock is flagged
  only when it is wrong — a Pi with no battery-backed clock boots into the past and
  `git pull` then fails with a certificate error that never mentions the time.
- **Shut down from the page.** Pulling power mid-write is how an SD card dies. Refused
  while armed.
- **Factory reset** for the vehicle and the ground app.
- **Self-sufficient in the field**: the Pi starts its own hotspot whenever the radio is
  free and opens the page via a **captive portal**.
- Hardware drivers **PCA9685 / GPIO-PWM / SBUS** (native libs optional), non-blocking
  **ESC calibration**.
- **Desktop app** (Electron) with native SDL2 input (hot-plug, rumble).

**Measured in the field** (2026-08-21, one afternoon, one carrier, one location — not a
benchmark): Pi 4 on a Huawei E3372h-320 with its internal antenna, controlled from a
laptop over Tailscale, Ethernet unplugged.

| | |
| --- | --- |
| Control round-trip | 110 ms |
| Video latency | 128 ms |
| Bitrate | 444 kbps |
| LTE signal | 52 % (≈ −106 dBm RSRP) |
| Path | direct IPv6, no DERP relay |

Link health read 52 and named `SIGNAL` as the limiting part. Failsafe fired and cleared
as designed while the link moved from Wi-Fi to LTE.

---

## Quick start

Requires Node 20+.

```bash
npm install
npm run dev
```

- Vehicle service: `ws://localhost:8080` (sim driver), setup at `/setup`.
- Ground station: `http://localhost:5173`.

Press **Connect**, **hold Arm for 1 s**, drive with `W A S D` / arrow keys. From a phone
open `http://<PC-LAN-IP>:5173`.

**Video in the sim** (synthetic test pattern, needs `ffmpeg`):

```bash
npm run dev            # terminal 1: vehicle + ground app
npm run dev:video      # terminal 2: go2rtc with the test pattern
```

Mind the order — `npm run dev` writes the go2rtc config first. Fedora:
`sudo dnf install -y openh264 ffmpeg-free`.

**Tests:**

```bash
npm test               # safety / logic test suite
```

---

## On real hardware

Parts list, wiring and the step-by-step build are in
**[`docs/HARDWARE.md`](docs/HARDWARE.md)**.

**Quickest (one line on Raspberry Pi OS Lite):**

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

Clones to `/opt/yonderrc` and runs the installer. Then open `http://<pi-ip>:8080/setup`
and press **Detect hardware**: it reads each I²C chip's **ID register**, so it names the
actual part (INA228, MCP9808, BME280, and the PCA9685 through its all-call address)
instead of guessing from a shared address. One button fills those into the forms, and the
native module a suggestion needs installs from the same page.

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

Driver selection via env (details in `docs/HARDWARE.md`):

```bash
YRC_DRIVER=pca9685 npm run start -w @yonderrc/vehicle   # I2C PWM, 16 channels
YRC_DRIVER=gpio-pwm npm run start -w @yonderrc/vehicle   # pigpio; pins: docs/HARDWARE.md 2.8
YRC_DRIVER=sbus     npm run start -w @yonderrc/vehicle   # SBUS to a flight controller
```

A hardware driver that fails to start falls back to `sim`, so a headless device never
becomes unconfigurable.

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

Everything above the transport is transport-agnostic; control travels over WebSocket
(fallback + signaling) or the WebRTC data channel.

---

## Versions

Changes are in [`CHANGELOG.md`](CHANGELOG.md) and the
[GitHub releases](https://github.com/TechnikWeber/YonderRC/releases). This README always
describes the current state.

## How this code was written

YonderRC is written **with AI assistance** — the bulk of the code was produced by
Anthropic's Claude from the author's specifications, and every change is reviewed and
accepted by a human before it ships. Commits carry a `Co-Authored-By: Claude` trailer.

What that means for how much you should trust it:

- **Everything is covered by the test suite** (`npm test`) and all four packages
  typecheck. Safety logic — failsafe, disarmed values, arming, channel maths, the pre-arm
  check — is written as pure functions so it can be tested without hardware.
- **The simulator path is genuinely verified. The hardware path is not.** Real drivers,
  I²C registers, nmcli/mmcli, LTE and WebRTC reconnect can only be proven on a Pi. Those
  places say so rather than pretending otherwise.
- **Review it yourself before you trust it with a vehicle.**

There is no standard for disclosing AI involvement in a codebase — no SPDX field, no
licence header. The conventions that exist are commit trailers (`Co-Authored-By:`) and a
plain statement like this one. This project uses both.

## Disclaimer — safety & legal

YonderRC controls **physical vehicles** and can cause property damage, injury or death.
It is provided **"as is", without any warranty**, and the author accepts **no liability**.

- **FPV and beyond-visual-line-of-sight (BVLOS) operation is restricted or prohibited in
  many countries** and may require registration, a licence or a spotter. **Check your
  local laws** (aviation, radio, privacy) **before you use it.**
- Keep the failsafe and arming safeguards enabled, test in the simulator and on the bench
  first, stay away from people and property, and never rely on the link alone.
- You use YonderRC **entirely at your own risk.** See [`LICENSE`](LICENSE).

## License

**CC BY-NC-ND 4.0** (Attribution – NonCommercial – NoDerivatives) **plus one addition: no
military or warfare use**. Use it for free and pass on unmodified copies with attribution;
no modifying, no commercial and no military use. Full text in [`LICENSE`](LICENSE).
