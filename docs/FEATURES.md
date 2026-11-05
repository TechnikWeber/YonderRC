# What YonderRC does

The full feature list. The short version is in the [README](../README.md).

## Control

- 16 channels over WebSocket or a WebRTC data channel. Input from keyboard, on-screen
  buttons, gamepad or a touch joystick (multitouch, deadzone, spring return).
- **Models** for car, boat, plane and drone, each with a matching channel template, an
  input method and transmitter modes 1–4.
- **Per channel**: trim, expo, reverse, endpoints (µs), failsafe value, optional response
  curve (3–9 points). Connected, each channel names the pin it drives — `CH03 · PCA 2`:
  the app counts from 1 like every transmitter, the PCA9685 board from 0. The channel
  list, the monitor, the calibration and the servo test all show it.
- **Live trims** under the sticks: 5 µs a press, up to ±150 µs, saved with the model.
  Also on two keys or controller buttons (Trim −/+).
- **Two buttons as one axis**, e.g. RT/R2 forward and LT/L2 back on a car or boat.
- **Follower channels** for a second steering servo or ESC: a copy of another channel
  with its own offset, reverse and endpoints.
- **Speed limiter**: 20 / 40 / 60 / 80 / 100 % by default, two to five steps per model,
  switchable while driving — on screen, or Speed −/+ (or one cycling button) on a controller.
- **Controllers**: every device the browser lists is shown; headsets and motion sensors
  are never picked automatically. A controller with a layout of its own (an RC
  transmitter in joystick mode) is set up once, then every model works with it. Each
  controller can have its own action buttons.

![Touch control: one large steering/throttle stick, the hold-to-arm button, Lights and Horn buttons, the five speed-limit steps, the WebRTC control toggle and a status strip](screenshots/TouchInputs_and_Status.png?v=6)

*Touch control, hold-to-arm, speed limiter, the WebRTC toggle and the status strip.*

## On a phone

- A normal web page: open it over the LAN, the Pi's own hotspot or a VPN address. No
  install; the vehicle serves it itself.
- Responsive layout and a **compact OSD** that keeps the picture free
  (FPV › ⚙ › *OSD size*).

<details>
<summary><b>Mobile view — click to expand</b></summary>

![YonderRC on a phone: FPV with the compact OSD, wrapped tool buttons, arm button and touch joysticks](screenshots/Mobile_FPV.jpeg?v=6)

*The same app in an emulated 390 px phone viewport.*

</details>

## Safety

- **Failsafe**: no control frames for 500 ms (adjustable) → every channel goes to its
  failsafe value. It depends on the vehicle type: a drone *holds*, a car or boat *stops*,
  a plane cuts the *motor*.
- **Arming**: every connection starts disarmed. Car and boat disarm again after a
  reconnect, aircraft do not (changeable in Ground setup › Controls).
- **Hold to arm** (1 s) for arm *and* disarm — on the button and on a bound key.
  **Panic-disarm** is instant and ships unbound: pick a key you cannot hit by accident.
- **Pre-arm check**: the throttle must be at rest before arming.
- **No frames rather than wrong frames**: when the app goes to the background or the
  controller disappears, nothing is sent and the vehicle goes to failsafe.
- Model and settings are locked while armed. Optional **shared secret** for the control
  link and the Vehicle setup page.
- **Stick feedback** (off by default): a click or rumble at the centre and the rim.

![Channel monitor: the actual µs output per channel, throttle "HELD SAFE · DISARMED"](screenshots/ChannelOutput_Monitor.png?v=6)

*The real vehicle output in µs, including failsafe and disarm.*

## Video (FPV)

- Low-latency video over **go2rtc/WebRTC**; the H.264 encoder is detected automatically.
- **Self-healing**: a frozen picture reconnects; the last frame stays up meanwhile.
- **Quality** high/medium/low or **Auto**, switchable while driving.
- **CSI camera modules** picked in the browser, including ones the Pi does not detect by
  itself. Rotation, mirroring and focus per camera.
- No camera is fine: the FPV area stays dark, everything else works.
- OSD with status, channels, video stats and telemetry; every value can be hidden. On
  request also the **vehicle computer's CPU and RAM** (FPV › ⚙ › *OSD fields*).
- **Recording and snapshots** in the browser, bindable to a key or button.

## Telemetry

- **Voltage and current**: INA219/226/228/237/238/260/3221, ADS1115/1015, MCP3008/3208,
  ACS712/758. mAh counting and battery % from the capacity. **INA228 recommended** — it
  counts the charge itself.
- **Temperature**: Pi SoC, DS18B20, MCP9808, TMP102/117, BMP280/BME280, MAX6675/318xx,
  NTC/PT100 on an ADC.
- Any number of channels, each can be hidden in the OSD. Simulated values are marked
  **SIM**, a missing sensor shows **NO SENSOR** — never made-up numbers.
- **Low-battery warning** on %, voltage or mAh: blinking OSD, rumble, beep.
- **Return-home budget** (off by default): how much further you may go and still get
  home. Needs capacity, a current sensor and GPS.
- **Voice callouts**: link lost/back, failsafe, armed/disarmed, low battery.
- **Link health** as one number 0–100 (round-trip, loss, signal; the worst counts).
- **Blackbox log** (off by default): CSV with link, video, battery, every sensor, the
  vehicle's CPU and RAM and the GPS track; also as GPX.

## GPS & navigation

- Serial NMEA receiver, USB receiver via gpsd, or simulated.
- Home point by hand or automatically; the OSD shows distance and direction home.
- Setup frees the Pi's serial port and counts incoming data, so a receiver can be checked
  indoors.

## Operation & setup

- **Two setups, named for where they live.** *Ground setup* in the ground app: models,
  channels, controls and safety — stored in that browser. *Vehicle setup* on the vehicle
  (`/setup`, works from a phone, no app needed): Core setup (name, output driver, add-ons),
  network, remote access, device access, sensors & telemetry, camera, GPS, design.
- **Wi-Fi**: scan and connect from the page. Wrong password → the hotspot comes back.
- **Own hotspot** with a captive portal, so the page opens by itself in the field.
- **Remote access**: Tailscale, ZeroTier, WireGuard; OpenVPN (experimental). OpenVPN
  reconnects at once when the vehicle changes networks; a WireGuard server behind a
  DynDNS name is looked up again when its handshake goes stale.
- **Device access** to the Pi itself: **Raspberry Pi Connect** (a shell in the browser
  from anywhere, the screen on a desktop image; installable from Core setup › Add-ons —
  experimental), the **SSH** commands for every address the vehicle has, and a **VNC**
  switch on images with a desktop.
- **LTE**: USB modems via ModemManager (APN, PIN, 4G-only, roaming) and HiLink sticks
  (Huawei E3372h & co.); the stick's own page is reachable through the vehicle.
- **Data budget**: counts mobile data and warns (**⚠ DATA**) before the plan runs out.
- **Problem report in one file**: *Ground setup › Diagnostics* collects both sides and
  says in plain words what it found. How to send it: [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
- **Update, restart, shut down and factory reset** from the page — refused while armed.
- Hardware self-test, ESC calibration, driver modules installable from the browser.
- The vehicle reports its own health: **⚠ POWER** on a weak supply, temperature, CPU,
  memory, load, free space, a wrong clock.
- Output drivers **PCA9685 / GPIO-PWM / SBUS**. **Desktop app** (Electron) with native
  controller support.

![Vehicle setup, Overview tab: what the page is for, the tabs from Core setup to Device access, then system status — mode, LTE modem and operator, remote access, Wi-Fi, one line each for the output driver, sensors, GPS, mobile data, device access and cameras, the Pi's temperature, CPU and memory — followed by the hardware test, the software update and the system buttons](screenshots/VehicleConfig_Setup.png?v=6)

## Measured in the field

2026-08-21, one afternoon, one carrier, one place — not a benchmark. Pi 4 with a Huawei
E3372h-320 (internal antenna), controlled from a laptop over Tailscale.

| | |
| --- | --- |
| Control round-trip | 110 ms |
| Video latency | 128 ms |
| Bitrate | 444 kbps |
| LTE signal | 52 % (≈ −106 dBm RSRP) |
| Path | direct IPv6, no relay |

Failsafe fired and cleared as designed while the link moved from Wi-Fi to LTE.

## Project layout

```
packages/
  protocol/   shared TypeScript types (messages, channels, profiles, telemetry)
  vehicle/    vehicle service (Node): core, failsafe, drivers, sensors, video, Vehicle setup
  ground/     ground app (React): driving, FPV, OSD, recording, Ground setup
  desktop/    Electron shell with native controller input
docs/         quick start, hardware, troubleshooting, this list
provisioning/ Pi only: installer, systemd, hotspot, diag.sh
test/         test suite (npm test)
```

Control travels over WebSocket or a WebRTC data channel; everything above that does not
care which.
