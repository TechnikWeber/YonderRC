**English** · [Deutsch](README.de.md)

# YonderRC

Beyond-line-of-sight remote control over IP — an app for **video, control and
configuration** of cars, boats, planes and drones. Runs in the browser (incl. phone),
as a desktop app (Windows/Linux), and on a Raspberry Pi as the vehicle computer.
Low latency, built for operation over LTE.

Everything runs **in a simulator — with no hardware at all**. For the real build on
the Pi (parts list, wiring, step by step from Wi-Fi → LTE) see
[`docs/HARDWARE.md`](docs/HARDWARE.md).

![Ground station while driving: FPV video with a full OSD — GPS fix and home compass with distance, odometer and speed top left, battery bar top right, voltage/current/mAh bottom right, link health score top centre](docs/screenshots/Overview_OSD.png?v=5)

*Ground station while driving, exactly as it ships: low-latency FPV with a full OSD —
GPS fix + **home compass, distance, odometer and speed** (top left), battery bar (top
right), voltage/current/mAh (bottom right), and **link health as one score** (top
centre). The numbers behind that score — control and video latency, bitrate, FPS, loss —
appear by themselves the moment the link stops being good, or permanently under
FPV › ⚙. A **Setup ↗** shortcut opens the vehicle's setup page. The **look is set on the
vehicle** (Setup › Design) and pushed to the ground app — light by default, dark for
night flying; the OSD stays light-on-dark either way, because it is drawn on the picture.*

---

## What YonderRC does

**Control**
- 16 channels over WebSocket or a WebRTC data channel; keyboard, on-screen buttons,
  gamepad, or a full touch joystick (multitouch, deadzone, spring return).
- **Models** for car / boat / plane / drone with matching channel templates,
  selectable input method, and per-axis detent (center/min/free). The demo car and boat
  start on the **on-screen pad**, so a phone joining the vehicle's own hotspot can drive
  straight away — no trip through the binding editor first.
- Per channel: trim, expo, reverse, endpoints (µs) and failsafe value.
- **Response curves** per stick channel (off by default): a 3/5/7/9-point curve with a
  live plot, for the shapes expo can't express — a throttle that stays gentle to half
  stick and then opens up, a steering that is soft at the extremes but direct in the
  middle. Applied before expo, so both work together. The two end points are fixed at
  ±100% so full travel stays reachable — limit travel with the endpoints instead, and
  the disarmed value and pre-arm check keep working whatever shape you draw.
- **Live trims** in a collapsible panel under the sticks: 5 µs a press, up to ±150 µs,
  reset per channel. Same value as `trim µs` in Setup, saved with the model.
- **Speed limiter with three steps** (Low / Mid / High, percentages per model): three
  buttons under the sticks switch while driving, or a bindable controller button cycles
  them. The command is scaled **around the throttle's rest position** — a car with
  reverse is capped in both directions, a plane keeps its exact idle and is capped only
  upwards. Endpoints, failsafe, the disarmed value and the pre-arm check stay untouched.

![Touch control: one large steering/throttle stick, the hold-to-arm button, Lights and Horn buttons, the speed limiter, the WebRTC control toggle and a status strip](docs/screenshots/TouchInputs_and_Status.png?v=5)

*Touch control, the **hold-to-arm** button, the **speed limiter**, the optional
**WebRTC control channel** toggle, and a status strip: link, state, session time,
round-trip, **link gaps**, input method, vehicle, telemetry. A car in stick mode 2 drives from a
**single stick** — steering on X, throttle on Y — so it gets the whole row and the size
that comes with it; mode 4 splits them across two.*

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

![YonderRC on a phone: FPV with the compact OSD, wrapped tool buttons, arm button and touch joysticks](docs/screenshots/Mobile_FPV.jpeg?v=5)

*The same app at phone size (390 px): FPV with the compact OSD (GPS, home compass,
odometer and speed left, battery bar right, telemetry in one line), the FPV tools
wrapped onto a second row, and below it the arm button with the touch stick.*

</details>

**Safety**
- Time-based **failsafe watchdog**: if control frames stop arriving, every channel
  goes to its failsafe value. **Vehicle-type aware and separate from disarming** —
  a drone *holds* on link loss (throttle mid), a car/boat *stops*, a plane goes to
  *motor off*.
- **Arming**; every new connection starts disarmed. **Auto-disarm on reconnect follows
  the vehicle type** (car/boat on, plane/drone off — pushed from the ground) so a
  reconnect can't cut an aircraft's motors in flight; **overridable** to always on/off
  in Setup › Controls, with *auto* as the default.
- **Hold-to-arm**: the arm button has to be held (1 s by default, with a countdown
  filling the button) to arm *or* disarm, so a mis-touch on a phone can't cut the
  motors — and the same hold applies to a **key or controller button** bound to
  arm/disarm. Hold time is adjustable and the protection can be switched off entirely in
  Setup › Controls; **panic-disarm** stays instant either way.
- **Pre-arm check** (throttle must be at its rest position) and **panic-disarm** on a
  bindable key/button, always sent over the reliable link. Panic ships **unbound**: it
  fires instantly with no hold, so you choose a key or controller button you can't hit
  by accident.
- **Feel where the stick is** (off by default, Setup › Controls). On FPV your thumb has
  no edge to feel for, so the on-screen stick marks the two positions that matter: back at
  centre, and hard against the rim, once per crossing. An **iPhone cannot vibrate from a
  web page** — Safari has no Vibration API — so the default channel is a short click,
  which does work there; vibration is offered only where the browser actually has it, and
  a connected gamepad is rumbled through its actuator.
- Model switching and settings are locked while armed.
- **Optional shared secret** (off by default): when set, the control link and the
  setup API require it — quick to connect the first time, lockable when you want it.

![Channel monitor: the actual µs output per channel, throttle "HELD SAFE · DISARMED"](docs/screenshots/ChannelOutput_Monitor.png?v=5)

*Channel monitor: shows the **real** vehicle output in µs including failsafe and
disarm — the throttle channel is visibly held safe while disarmed.*

**Video (FPV)**
- Low-latency video over **go2rtc/WebRTC**; the H.264 encoder is auto-detected
  (`libx264`, `libopenh264`, Pi hardware).
- **Self-healing**: detects a frozen/dropped picture and reconnects automatically;
  the last frame stays on screen.
- **Video quality switchable live** from the ground station (high/medium/low) or
  **Auto**: it steps down quickly when loss/latency rise and back up slowly when the
  link is clearly good again (thresholds are editable). It **starts on low** — what
  matters in the first seconds is a fluid picture, not the most pixels — and Auto climbs
  from there rather than opening at full resolution and stepping down after it has
  already stuttered.
- **Pick the camera module without a terminal.** Only the four official Raspberry Pi
  sensors are auto-detected; an Arducam needs an explicit device-tree overlay in the
  firmware config, which is read only at boot. *Setup › CSI camera module* writes it,
  keeps one backup, and says when a reboot is due. **Rotation (0°/180°) and mirroring**
  are per camera — a camera bolted in upside down is the normal case, and on a CSI sensor
  the transform is free. The **focus** of a module with a lens actuator is settable too;
  an Arducam 16 MP needs a tuning file for it, which YonderRC ships and fills in for you,
  because Raspberry Pi's own one has no autofocus algorithm.
- **No camera is a supported setup**, not a broken one: remove every entry and the FPV
  area stays dark, nothing is retried, nothing reports an error, and the OSD, telemetry
  and controls carry on. That is the configuration for a plain IP/WiFi/AP receiver used
  for line-of-sight driving.
- OSD with status, channels, **bitrate/packet loss/FPS/video latency** and telemetry.
  Every block **and every single sensor value** can be switched off individually, and
  the whole overlay has a **compact mode** for phones.
- **Recording & snapshots** locally (pick a folder once; bindable to a key or a
  controller button).

**Telemetry**
- Voltage/current sensors (real: ADS1115/1015, MCP3008/3208, INA219/226/228/237/238/
  260/3221, ACS712/758 — or sim), **precise coulomb counting** (consumed mAh) and
  **battery percentage** from the configured capacity. Sim values are clearly marked
  **SIM**; when a real sensor is missing, the OSD shows **"NO SENSOR"** instead of
  faked numbers, and telemetry can be **turned off** so a first flight shows no fake data.
- **Choose what drives the % gauge**: coulomb counting, a full/empty **voltage** curve,
  or **clamp** (the lower of the two, so a not-actually-full pack can't read 100%). The
  OSD labels which source it's using; the mAh readout is shown independently.
- A single INA sensor can provide **both voltage and current**.
- **Temperature sensors, 1..n**: Raspberry Pi SoC, DS18B20 (1-Wire), MCP9808 / TMP102 /
  TMP117 / BMP280 / BME280 (I²C), MAX6675 / MAX31855 / MAX31856 thermocouples and
  MAX31865 PT100/PT1000 (SPI), or an NTC/PT100 on an ADS1115 / MCP3008. Shown in the
  OSD under voltage and current.
- **Any number of channels, each individually switchable**: the OSD lists every channel
  the vehicle reports under FPV › ⚙ › *Sensor values*, so you decide per device what
  sits over the picture. As soon as a kind has more than one channel, its **label** is
  shown in front of the value (`Pack 16.6 V · BEC 5.1 V`, `Motor 62 °C`); with a single
  channel the value stays as terse as before.
- **One channel is marked *primary*** (Setup › Telemetry) and drives the battery %, the
  mAh/Wh counting, the low-battery warning and the blackbox — so adding a second
  voltage or current can't quietly move the battery maths onto the wrong sensor.
- **INA228 (recommended): the sensor counts the charge itself.** Its hardware
  CHARGE/ENERGY registers integrate at ADC rate, so the vehicle only reads two
  registers — the mAh no longer depend on the polling rate or on a sample the loop
  missed. 85 V bus range (up to 12S) and 20-bit resolution. INA237/238 are the same
  85 V family without the counter (the Pi integrates), INA226 stays fine up to 36 V.
- **Low-battery warning** on percent / voltage / consumed mAh, with a blinking OSD
  marker, controller rumble and a beep.
- **Return-home energy budget** (off by default): measures what the vehicle actually
  consumes per km and turns it into the number that is a decision — **how much further
  you may go and still get home** with a reserve intact. A percentage can't answer that:
  30% is plenty at 50 m and not enough at 800 m. Shown in the **full OSD**; the
  **turn-back warning** also appears in the compact OSD and is spoken. Needs a battery
  capacity, a current sensor and a GPS home point — **without them it simply shows
  nothing**, which is the normal case for a vehicle that is only a servo driver.
- **Voice callouts** (on by default, browser's built-in voice, no network): link lost /
  restored, failsafe, armed / disarmed and low battery with the percentage. On FPV you
  are watching the picture — a beep says *that* something happened, a voice says *what*.
  Deliberately nothing beyond that, so it never becomes something you mute.
- **Link health as one number**: round-trip, packet loss and radio signal boiled down to
  a 0–100 score with a trend arrow, coloured green / amber / red. The score is the
  **worst** of the three, not an average, so a perfect signal can't hide 15% packet loss.
  The individual numbers stay hidden while the link is good and **come back by
  themselves** the moment it isn't — that's when you need to know *which* one went bad.
- **Blackbox logging** (optional, off by default): 2 Hz CSV of arm/failsafe state,
  link, round-trip, bitrate, loss, FPS, video latency, mAh and percent — plus **one
  column per telemetry channel** (`Pack_V`, `BEC_V`, `I1_A`, `Motor_C`…), so every
  voltage, current and temperature you configured lands in the log. Up to ~5 h,
  downloadable from Setup › Controls.
- **The track goes in the same log**: `lat`, `lon`, `alt_m`, `sats`, `hdop`,
  `speed_ms` and `course_deg` ride in the *same row* as the electrics and the link
  stats, so you can colour the route by pack voltage or round-trip in QGIS or
  kepler.gl — literally a map of where the link gets bad. A second button exports
  the plain **GPX** track (with elevation, satellites, speed and course) that Google
  Earth, [gpx.studio](https://gpx.studio), Garmin BaseCamp, GPSBabel and every other
  mapping tool read without conversion.

**GPS & navigation**
- **Selectable GPS source**: a local NMEA receiver over serial (**Adafruit Ultimate GPS
  v3** is the reference, u-blox NEO-6/7/8/M9, BN-880…), a USB dongle via **gpsd**, a
  **sim** source, or (later) **MAVLink** from a flight controller — all normalized to one
  fix. Setup › GPS frees the header UART for you (Raspberry Pi OS parks a login console
  on it) and counts the arriving NMEA sentences, so a receiver can be verified indoors,
  where there will never be a fix.
- **Home point**: set it manually, or **auto-home** on the first good fix (takeoff
  point). The OSD shows fix type + satellites and, once home is set, **distance and
  direction back to home** — the essentials for beyond-line-of-sight.

**Operation & setup**
- **Mobile data budget with a warning.** An FPV stream costs 0.5–1 GB an hour and says
  nothing about it; the first symptom of an empty plan is that the vehicle is gone. The
  vehicle counts what it spends across **every metered uplink** — LTE stick, phone
  hotspot, tethered laptop — and the OSD shows **⚠ DATA** once the configured share of
  the allowance is gone. It deliberately does not count the vehicle's own hotspot (that
  traffic is free) or VPN interfaces (they would be counted twice). With a Huawei HiLink
  stick the **stick's own billing month** can be used instead, which survives a reboot
  and follows the operator's real reset day.
- **Link gaps are recorded, not just felt.** A watchdog trip lasts one control tick — the
  channels snap to failsafe and back before it can be read. The status strip counts the
  episodes per connection and shows the longest the vehicle ever waited for a frame,
  amber while the link is merely spending its margin.
- Graphical **setup page** served by the vehicle itself (`/setup`): driver, cameras,
  telemetry, watchdog, **Wi-Fi**, LTE, remote access, security — from a phone/laptop, no
  screen needed. **Wi-Fi onboarding from the phone**: scan, pick a network, connect —
  the setup hotspot closes once the Pi is on your Wi-Fi, and comes back if the password
  was wrong. The hotspot can be set to **stay up next to LTE** for field diagnostics.
  The **API secret** can be generated with one click. The ground app has a **"Setup ↗" shortcut** that opens it for the connected
  vehicle (works over LAN, the Pi's AP, or a VPN address).

  ![Vehicle setup page, Overview tab: tabs across the top, then system status — mode, LTE modem and operator, remote access, Wi-Fi, and one line each for sensors, GPS and cameras — followed by the hardware test, the software update and the system buttons](docs/screenshots/VehicleConfig_Setup.png?v=5)

  *Setup page served by the vehicle, split into tabs — **Overview · Network · Remote
  access · Sensors & outputs · Camera · GPS · Design**, each one a URL (`…/setup#gps`).
  *Overview* answers "is everything there?" on one screen: mode, LTE modem/operator,
  remote access and Wi-Fi, plus a line each for **sensors** (source, channels, live
  reading, consumed mAh), **GPS** (fix and satellites) and **cameras** — each jumping to
  its own tab. Long explanations sit folded behind a one-line summary. Usable from a
  phone with no screen.*
- **Remote access, pick one method**: **Tailscale** or **ZeroTier** (zero-config mesh
  VPNs) or **WireGuard** — either **upload the `.conf`** exported by your own server or a
  **FritzBox**, or **type the values in** (keys, address, endpoint, AllowedIPs) when all
  you were given is a page of settings. Both end up as the same stored `.conf`, so a file
  you uploaded can afterwards be edited field by field. Brought up automatically at boot.
- **Robust LTE setup** (not just plug-and-play): APN, **SIM PIN**, **APN username/
  password**, **network mode** (4G-only), **roaming** toggle, live **diagnostics**
  (raw `mmcli`), and **SIM PIN change/remove**. `autoconnect` redials by itself.
- **HiLink LTE sticks too** (Huawei E3372h-320 & friends). They are routers, not
  ModemManager modems — `mmcli` never sees them — so YonderRC reads the stick's own API:
  model, state, operator, network type and **signal in the OSD** like any modem. The
  stick is found through the **routing table**, so a LAN on another `eth*` can't be
  mistaken for it, and its **configuration page is proxied through the vehicle** (port
  8081) so APN/PIN can be set from the hotspot, the LAN or the VPN.
- **Native driver modules install from the browser** (Setup › Vehicle configuration):
  `i2c-bus`, `pigpio`, `serialport` with a status and one button — no SSH on a vehicle
  you may only reach over its own hotspot. A failed build is translated into a cause and
  the command that fixes it, and the choice survives updates.
- **The Wi-Fi radio fixes itself.** Raspberry Pi OS keeps it rfkill-blocked until a
  **Wi-Fi country** is set, and NetworkManager then only says "device is not available".
  Setup shows the state and unblocks it in one press, with the country pre-filled from
  the Pi's locale — starting the hotspot repairs it on its own and says so.
- **Update from the setup page**: *Check for updates* shows the incoming commits and
  version without changing anything; *Update & restart* then pulls, installs changed
  dependencies, rebuilds the control app if needed and restarts the service — so a
  vehicle can be updated from a field with nothing but a phone.
- **Guided hardware self-test**: channel sweep, read sensors, camera snapshot.
- **The vehicle says when its own power is failing.** A Pi whose 5 V rail sags resets
  mid-drive, and from the ground that is indistinguishable from a software crash — video
  fine, then a freeze and a minute of reconnecting. YonderRC reads the firmware's own
  verdict and puts **⚠ POWER** in the OSD while it lasts, with a line that names the fix
  (servo V+ belongs on its own BEC, never on the Pi) and tells a thermal clamp apart from
  a sagging supply, because those want different things.
- **Shut down the vehicle from the page.** Pulling power from a Pi mid-write is how an SD
  card stops being readable. Refused while armed.
- **What the Pi says about itself**, on the overview: SoC **temperature**, **load**,
  **uptime** and **free card space**. Each one explains a failure that otherwise reads as
  a bug in this software — a hull in the sun clamps the clock and video and control get
  worse together, a load spike is the honest cause of round-trip jitter, a full card
  cannot take an update.
- **The clock, where it actually matters**: a Pi has no battery-backed clock, so with no
  network at boot it starts in the past and `git pull` fails with a **certificate error
  that never mentions the time**. The update panel says so, and only when the clock is
  wrong.
- **Factory reset** for both the vehicle and the ground app.
**Measured in the field** (2026-08-21, one afternoon, one carrier, one location — not a
benchmark): a Pi 4 on a **Huawei E3372h-320** with its internal antenna, controlled from a
Fedora laptop over **Tailscale**, Ethernet unplugged. Tailscale found a **direct IPv6
path** over LTE (no DERP relay, `tailscale ping` 69 ms). The ground app showed **control
round-trip 110 ms**, **video 128 ms** and 444 kbps at **52 % LTE signal** — the OSD's link
health read 52 and named `SIGNAL` as the limiting part, which is exactly what an internal
stick antenna at ≈ −106 dBm RSRP looks like. Failsafe fired and cleared as designed while
the link moved from Wi-Fi to LTE.

- **Self-sufficient in the field**: the Pi starts its own Wi-Fi hotspot whenever its radio is free and
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

Press **Connect**, **hold Arm for 1 s**, and drive with `W A S D` / arrow keys. From a phone
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
`http://<pi-ip>:8080/setup` and press **Detect hardware**: it scans the I²C bus and
**reads each chip's ID register**, so it names the actual part (INA228, MCP9808, BME280,
and the PCA9685 through its all-call address) instead of guessing from an address that
several devices share. One button fills those addresses into the driver and telemetry
forms. The native driver module a suggestion needs (`i2c-bus`, `pigpio`, `serialport`)
installs from the same page, no SSH. Prefer to do it
by hand? Use the steps below.

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
YRC_DRIVER=gpio-pwm npm run start -w @yonderrc/vehicle   # pigpio; pins: docs/HARDWARE.md 2.8
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

## How this code was written

YonderRC is written **with AI assistance** — the bulk of the code was produced by
Anthropic's Claude, working from the author's specifications, and every change is
reviewed and accepted by a human before it ships. Commits carry a
`Co-Authored-By: Claude` trailer, so `git log` shows exactly which ones.

What that means in practice, stated plainly because it affects how much you should
trust this code:

- **Everything is covered by the test suite** (`npm test`) and all four packages
  typecheck. Safety-relevant logic — failsafe, disarmed values, arming, channel
  maths, the pre-arm check — is written as pure functions in `protocol` and
  `ground/src/lib` specifically so it can be tested without hardware.
- **The simulator path is genuinely verified. The hardware path is not.** Anything
  touching real drivers, I²C sensor registers, nmcli/mmcli, LTE or WebRTC reconnect
  behaviour can only be proven on a Pi with the hardware attached. Those places say
  so in the docs and the changelog rather than pretending otherwise.
- **Review it yourself before you trust it with a vehicle.** That is good advice for
  any RC software; it is not weaker or stronger here because of how it was written.

There is no formal industry standard for disclosing AI involvement in a codebase —
no SPDX field, no agreed licence header. The conventions that do exist are commit
trailers (`Co-Authored-By:`, which the Linux kernel formalised as `Co-developed-by:`)
and a plain statement like this one in the README. This project uses both.

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
