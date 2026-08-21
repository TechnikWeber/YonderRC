**English** · [Deutsch](HARDWARE.de.md)

# YonderRC — Hardware guide (parts list, wiring, setup)

This guide takes YonderRC from pure simulation to real hardware: a Raspberry Pi as
the vehicle computer, a PCA9685 for servos/ESC, an INA228 for current/voltage, a
camera for FPV, first over Wi-Fi and then over LTE with Tailscale for the field.

> **Safety first.** For the first test, **props off / wheels up**, ESC unpowered or
> the motor unplugged. Only once every channel provably does the right thing do you
> add drive power. Arming is always the **last** step.

---

## 1. Parts list

### Required

| Part | Recommendation | Why |
|---|---|---|
| Computer | **Raspberry Pi 4** (2 GB is enough) or **Pi Zero 2 W** | Both have a hardware H.264 encoder for low-latency FPV. **The Pi 5 does not** — not ideal for video. |
| Storage | microSD 32 GB (A1/A2) | For Raspberry Pi OS Lite. |
| Servo/ESC driver | **PCA9685** 16-channel PWM (I2C) | Produces clean 50 Hz servo signals independent of the CPU. |
| Current/voltage sensor | **INA228** breakout (I2C) | Measures pack voltage and current high-side. **Counts charge and energy itself** (CHARGE/ENERGY registers), 85 V bus range (up to 12S) and 20-bit resolution. See "Which current sensor?" below for the alternatives. |
| Pi power supply | **UBEC/BEC 5 V / 3 A** | Powers the Pi reliably from the drive battery. |
| Camera | **Pi Camera Module 3** (CSI) *or* a USB camera with H.264 | CSI = lowest latency. |
| Wiring | Jumpers, JST, soldering gear | I2C bus, servo connectors, sensor. |

### Which current sensor? (INA228 recommended)

All of these are supported and configured the same way — pick one, wire it high-side,
enter the shunt value in the setup:

| Sensor | Bus range | Resolution | Charge counter | When |
|---|---|---|---|---|
| **INA228** | 85 V | 20-bit | **yes — in the chip** | **Recommended.** Covers up to 12S, and the mAh come out of the sensor instead of being summed on the Pi. |
| INA238 | 85 V | 16-bit | no | Cheaper 85 V option, same wiring and register map. The Pi integrates. |
| INA237 | 85 V | 16-bit | no | Like the INA238 but a lower accuracy grade. |
| INA226 | 36 V | 16-bit | no | Fine for up to 8S; the most common breakout. |
| INA219 | 26 V | 12-bit | no | Small currents / small packs. |
| INA260 | 36 V | 16-bit | no | Integrated 2 mΩ shunt — no shunt to choose, limited to ~15 A. |
| INA3221 | 26 V | 13-bit | no | Three channels at once, coarse. |

**Why the INA228 is worth it.** Beyond the range and resolution it integrates
**charge (coulombs) and energy (joules) in hardware**, continuously at the ADC rate.
YonderRC then just reads two registers: the consumed mAh no longer depend on how
often the vehicle polls, and a sample the loop missed (busy CPU, video hiccup) can no
longer quietly go uncounted. On every other sensor the vehicle integrates the sampled
current itself — precise, but only as good as the sampling.

You still set **Max current A** (it picks the chip's internal LSB and with it the
calibration) and the **shunt value**. Rule of thumb: shunt so that
`max current × shunt ≤ 163 mV`, e.g. 1 mΩ for 100 A. If `max current × shunt` also
stays under **40.96 mV**, switch the shunt range to ±40.96 mV for 4× the resolution.

### For LTE (phase 2)

| Part | Recommendation |
|---|---|
| LTE stick | USB LTE dongle supported by ModemManager (e.g. Huawei E3372 in "stick"/NCM mode, or Quectel EG25-G) |
| SIM | Data SIM with a known APN |

### Depending on the vehicle

- **Car/boat:** ESC + steering/rudder servo.
- **Plane:** ESC + servos (aileron/elevator/rudder/throttle).
- **Drone:** usually a **flight controller**, driven via **SBUS** (instead of the PCA9685). YonderRC supports both.

---

## 2. Wiring

### 2.1 PCA9685 ↔ Raspberry Pi (I2C)

| PCA9685 | Raspberry Pi (BCM) | Pin |
|---|---|---|
| VCC (logic) | 3V3 | Pin 1 |
| GND | GND | Pin 6 |
| SDA | GPIO2 / SDA1 | Pin 3 |
| SCL | GPIO3 / SCL1 | Pin 5 |
| V+ (servo power) | **not** from the Pi! | its own BEC 5–6 V |

- **V+** is the servo/ESC supply and comes from the BEC, **not** from the Pi.
- Default I2C address **0x40**. For multiple boards: address solder bridges A0–A5.
- Servos/ESC plug into channel outputs 0–15 (signal/+/−). YonderRC's channels 1–16
  in the app map to PCA9685 channels 0–15.

### 2.2 INA228 (current/voltage) ↔ I2C

*(Wiring is identical for the INA226/237/238 — only the setup entry changes.)*

- SDA/SCL on the **same** I2C bus as the PCA9685 (in parallel), with a different
  address (the INA2xx default is **0x40** — that collides with the PCA9685! **Set the
  address via the A0/A1 pins/solder bridges to e.g. 0x41**, or move the PCA9685 to 0x41;
  the point is they must differ).
- The sensor sits **high-side** in the battery's positive lead: battery(+) → `VIN+`,
  load (ESC/BEC) → `VIN−`. The **shunt** sets the measurement range (e.g. 0.002 Ω for
  high currents, 0.001 Ω for very high). You enter the shunt value later in the setup.
- **VBUS** measures against the sensor's ground — one INA228 delivers pack voltage
  **and** current, no extra divider.
- Connect the sensor's **GND** to the common ground point.

```
Battery(+) ──► [INA228 VIN+  VIN−] ──► ESC/BEC (+)
Battery(−) ─────────────── common ground ───────────────
                 │
              Pi GND, PCA9685 GND, BEC GND  (ALL together!)
```

> **A common ground is mandatory.** The Pi, PCA9685, sensor, BEC and ESC must share a
> ground, otherwise servo signals and readings are unreliable.

### 2.3 Power supply

```
Drive battery ──► BEC 5V/3A ──► Pi (5V/GND, e.g. GPIO pin 2/6 or USB-C)
           └──► ESC ──► motor
```

- Do **not** power the Pi from a PCA9685 channel.
- Power-on order: electronics/Pi first, drive last.

### 2.4 Camera

- **CSI:** ribbon cable to the camera port (on the Pi Zero: the narrower cable).
- **USB:** just plug it in; ideally a camera that outputs H.264 itself.

### 2.5 Drone via SBUS (optional, instead of the PCA9685)

- Pi **UART TX** (GPIO14 / pin 8) → **SBUS-in** of the flight controller.
- SBUS is **inverted** and runs at 100000 8E2. Many FCs expect the inverted signal;
  if your FC has no internal invert, you need a small inverter (transistor) between the
  Pi TX and the FC.

### 2.6 GPS (optional)

Common receivers that just work on a Pi: **Adafruit Ultimate GPS** (MTK3339),
**u-blox NEO-6M/7M/8M/M9N**, **Beitian BN-220/BN-880** — most speak **NMEA at 9600 baud**
over UART. Wiring:

| GPS | Raspberry Pi | Pin |
|---|---|---|
| VCC | 3V3 (or 5V per module) | Pin 1 / 2 |
| GND | GND | Pin 6 |
| TX  | GPIO15 / RXD | Pin 10 |
| RX  | GPIO14 / TXD | Pin 8 |

- Use the Pi's hardware UART (`/dev/ttyAMA0` or `/dev/serial0`; disable the serial
  console). In Setup › GPS pick **local NMEA (serial)**, device `/dev/ttyAMA0`, 9600.
  The serial source needs the optional `serialport` package (see 3.3) — without it the
  service says so and stays on the previous source.
- **USB GPS dongles** (u-blox VK-172, GlobalSat BU-353): plug in and pick the **gpsd**
  source instead — `gpsd` is installed by the setup script and handles the device.
- Set the **min. satellites** for a good fix (6 is a good default) and enable
  **auto-home** to capture the takeoff point automatically.

---

### 2.7 Temperature sensors (optional)

Any number of temperature channels can be added in Setup › Telemetry; they show up in
the OSD under voltage and current. Pick by how the sensor is read:

| Sensor | Bus | Range / notes | Extra setup |
|---|---|---|---|
| **Raspberry Pi SoC** | — | The Pi's own die temperature; good for a thermal-throttle warning | none |
| **DS18B20** | 1-Wire | −55…+125 °C, ±0.5 °C, cheap and available as a waterproof probe | `dtoverlay=w1-gpio` + a 4.7 kΩ pull-up from data to 3V3 |
| **MCP9808 / TMP102 / TMP117** | I²C | −40…+125 °C; TMP117 is the accurate one (±0.1 °C) | address (0x18 / 0x48…) |
| **BMP280 / BME280** | I²C | Ambient air (the BME also does humidity); not for hot spots | address 0x76/0x77 |
| **MAX6675 / MAX31855** | SPI | Type-K thermocouple, up to ~1000 °C — for motors, ESCs, exhausts | `dtparam=spi=on` |
| **MAX31856** | SPI | Thermocouple with a selectable type (B/E/J/K/N/R/S/T) | `dtparam=spi=on` |
| **MAX31865** | SPI | PT100/PT1000, accurate up to ~600 °C | `dtparam=spi=on`, reference resistor 430 Ω (PT100) / 4300 Ω (PT1000) |
| **ADS1115 / MCP3008 + NTC or PT100** | I²C / SPI | Whatever you already have wired; cheapest option | series resistor, excitation voltage, NTC R25/beta |

- **1-Wire and I²C sensors share the bus** with the PCA9685/INA — just make sure the
  addresses differ. SPI amplifiers each need their own chip-select (CE0/CE1).
- **NTC/PT100 on an ADC** is a divider: excitation → fixed resistor → *probe* → GND, and
  the ADC input sits between resistor and probe. Enter the fixed resistor as *series
  resistor* and, for an NTC, its `R25/beta` (e.g. `10000/3950`, printed on the part).
- **Thermocouples measure hot things, not precisely** (±2 °C typical). For a motor or
  ESC that's exactly right; for pack temperature a DS18B20 taped to the cells is better.
- A sensor that can't be read (open thermocouple, CRC error, missing 1-Wire device) is
  **left out of the OSD** rather than shown as 0 °C, and logged once on the vehicle.

---

### 2.8 GPIO-PWM (instead of the PCA9685)

With `YRC_DRIVER=gpio-pwm` the Pi generates the servo pulses itself, via `pigpio`
(DMA-timed, so far less jitter than software PWM). No extra board — but the CPU and one
GPIO per channel are now part of the signal path. **For anything beyond a couple of
channels the PCA9685 stays the better answer**: its own timer, unaffected by CPU load,
and it leaves the GPIOs alone.

Default pin map (BCM numbering), channel 1 → 16 in this order:

| CH | BCM | Header pin | | CH | BCM | Header pin |
|---|---|---|---|---|---|---|
| 1 | 17 | 11 | | 9 | 6 | 31 |
| 2 | 18 | 12 | | 10 | 12 | 32 |
| 3 | 27 | 13 | | 11 | 13 | 33 |
| 4 | 22 | 15 | | 12 | 16 | 36 |
| 5 | 23 | 16 | | 13 | 19 | 35 |
| 6 | 24 | 18 | | 14 | 20 | 38 |
| 7 | 25 | 22 | | 15 | 21 | 40 |
| 8 | 5 | 29 | | 16 | 26 | 37 |

- **Change it with `YRC_GPIO_PINS`** (comma-separated BCM numbers, in channel order),
  e.g. `YRC_GPIO_PINS=17,18,27,22` in the systemd unit. The **length caps the channel
  count** — four pins means four channels. There is no setup-UI field for this.
- The service logs the map it actually uses at start: `[gpio-pwm] ready on BCM pins […]`.
- **Channel 3 (BCM 27) is the default throttle**, because `YRC_THROTTLE_CH` is `2` and
  that index is 0-based.
- All pins start at **1500 µs** so nothing lurches at boot, and the pulses are dropped
  (off) on shutdown.
- `pigpio` **needs root** — the shipped systemd unit already runs as root.

#### It fits the reference build

The default map deliberately avoids every bus this guide uses, so **GPIO-PWM,
the INA228, a GPS and a temperature sensor can all run at once**:

| Left free | Pins | Used by |
|---|---|---|
| I²C1 | BCM 2/3 (header 3/5) | INA228/226, MCP9808/TMP102/TMP117, BMP280/BME280, ADS1115 |
| UART0 | BCM 14/15 (header 8/10) | serial GPS — and SBUS for a flight controller |
| SPI0 | BCM 7–11 (header 19/21/23/24/26) | MAX6675/31855/31856/31865, MCP3008 |
| 1-Wire | BCM 4 (header 7) | DS18B20 (`dtoverlay=w1-gpio` default) |

Two things to watch anyway:

- **BCM 18/19/20/21 double as I²S** (PCM). Only a problem with an audio HAT — drop those
  channels from `YRC_GPIO_PINS` if you use one.
- **Move the 1-Wire pin, don't reuse one.** If you set `dtoverlay=w1-gpio,gpiopin=17`,
  GPIO 17 is the kernel's from then on and channel 1 goes silent. Leave the DS18B20 on
  its default GPIO 4.

> **Power stays the same as 2.3:** servo/ESC power comes from the BEC, never from the
> Pi's 5 V pins. The Pi only contributes the **signal** — and a **common ground** is
> mandatory, otherwise the pulses are measured against nothing.

---

## 3. Software — step by step (Wi-Fi first)

### 3.1 Flash Raspberry Pi OS

1. **Raspberry Pi Imager** → **Raspberry Pi OS Lite (64-bit)**. The install script is
   written and tested against **Bookworm**; newer releases should work (it only uses
   apt, systemd and NetworkManager), but that isn't verified.
2. In the Imager settings (gear icon): **enable SSH**, set a user, enter your
   **Wi-Fi credentials**, hostname e.g. `yonderrc`.
3. Flash the SD card, put it in the Pi, power on.

### 3.2 Log in and copy the project onto the Pi

First log in via SSH:

```bash
ssh pi@yonderrc.local          # or the IP from your router
```

Then get the project onto `/opt/yonderrc`. **Three ways — pick one:**

**a) git clone (easiest, if the Pi has internet)**
```bash
sudo mkdir -p /opt/yonderrc
sudo chown $USER /opt/yonderrc
git clone https://github.com/TechnikWeber/YonderRC.git /opt/yonderrc
```

**b) scp from the laptop (copies your local repo to the Pi)**
Run on your **laptop** (not on the Pi):
```bash
# in the folder that contains YonderRC:
scp -r ~/YonderRC pi@yonderrc.local:/tmp/YonderRC
# then on the Pi:
ssh pi@yonderrc.local 'sudo mkdir -p /opt/yonderrc && sudo cp -a /tmp/YonderRC/. /opt/yonderrc/'
```
Tip: don't copy `node_modules` from the laptop (saves time) — the install script
installs fresh on the Pi anyway.

**c) USB stick (if the Pi has no network)**
Copy YonderRC onto a USB stick, plug it into the Pi, then on the Pi:
```bash
sudo mkdir -p /opt/yonderrc
sudo cp -a /media/*/YonderRC/. /opt/yonderrc/   # adjust the path (lsblk shows the drive)
```

Then install:

```bash
sudo bash /opt/yonderrc/provisioning/install.sh
```

`install.sh` installs Node 22, ffmpeg, NetworkManager, ModemManager, `usb-modeswitch`,
`i2c-tools`, `gpsd`, `wireguard-tools`, Tailscale, ZeroTier and go2rtc, sets up the
three systemd services (`yonderrc-vehicle`, `go2rtc`, `yonderrc-onboard`) and enables
**I2C** and **UART**.

> The Fedora note for your laptop does not apply here — on the Pi the script brings
> the right ffmpeg with H.264.

### 3.3 Hardware driver dependencies (only what you use)

The native libraries are **optional dependencies**: they are compiled on the Pi and a
given vehicle needs at most one of them, so the installer deliberately runs
`npm install --omit=optional` and a Pi without that hardware still provisions cleanly.
(It then re-installs the *ground* workspace with optional deps allowed — the flag is
global, and rollup/esbuild ship their platform binaries as optional deps, which
`vite build` needs.)

**Install the one you need in the browser** — Setup › Vehicle configuration ›
**Native driver modules**:

| module | needed for |
| --- | --- |
| `i2c-bus` | PCA9685 servo/ESC driver · INA2xx current sensors · ADS1115 ADC |
| `pigpio` | GPIO-PWM output instead of a PCA9685 (pin map: 2.8) |
| `serialport` | SBUS output (flight controller) · serial GPS |

Each row shows whether it is installed and has an **Install** button; afterwards the page
offers the service restart that picks it up. No SSH — which is the point on a vehicle you
can only reach over its own hotspot. Three things to know:

- The Pi needs **internet** for it (WiFi or LTE). Its own hotspot has no uplink, so join a
  network in Setup › WiFi first.
- It **takes a minute** — the module is compiled on the Pi.
- If the build fails, the page names the cause and the command that fixes it. Usually
  `sudo apt install -y build-essential` (no compiler), and `pigpio` additionally needs its
  C library: `sudo apt install -y pigpio`.

What you installed is **remembered** (`hardwareDeps` in `yonderrc-config.json`) and
restored by `install.sh` after every update — an update can't silently turn a configured
vehicle back into a simulator.

The same thing over SSH, if you prefer:

```bash
cd /opt/yonderrc
npm install i2c-bus    -w @yonderrc/vehicle    # PCA9685 + INA2xx
npm install pigpio     -w @yonderrc/vehicle    # (only for GPIO-PWM instead of PCA9685 — pin map: 2.8)
npm install serialport -w @yonderrc/vehicle    # (only for SBUS/drone, and serial GPS)
sudo systemctl restart yonderrc-vehicle
```

### 3.4 Updating the vehicle

**From the setup page** — *Software update*, which is what you want in a field:

1. **Check for updates** fetches and reports: installed version, available version, how
   many commits behind, and the subject line of each one. It changes nothing.
2. **Update & restart** appears only when there is something to install. It does what an
   SSH session would — `git pull --ff-only`, install changed dependencies, rebuild the
   control app if it changed — and restarts the vehicle service last, so the service
   never comes back into a half-updated checkout. The page reloads itself afterwards.

It refuses (and says why) when the vehicle has **local changes**, because a fast-forward
would either fail or throw them away, and when there is **no internet**. If a step fails,
it stops there and the vehicle keeps running the version it had.

> **What it does not do:** apt packages, systemd units and `install.sh` itself. When the
> check says the installer changed, run the full `sudo bash provisioning/install.sh` once
> you are back at a keyboard.

The equivalent over SSH:

```bash
cd /opt/yonderrc
sudo git pull --ff-only
sudo systemctl restart yonderrc-vehicle
# …and when the ground app or dependencies changed, the full run instead:
sudo bash provisioning/install.sh
```

### 3.5 Configure over Wi-Fi (graphical)

From a laptop/phone on the same Wi-Fi open: **`http://yonderrc.local:8080/setup`**
(or `http://<pi-ip>:8080/setup`).

0. **Detect hardware** (in *Vehicle configuration*) scans the I²C bus, `mmcli` and the
   camera devices and suggests a driver/sensors — a good starting point before you fill
   anything in by hand.
1. **Vehicle:** set the name, **Output driver = `pca9685`** (drone: `sbus`; without an
   extra board: `gpio-pwm`, pin map in 2.8), check the throttle channel. The *Auto-disarm on reconnect* checkbox here is only a **fallback**
   — as soon as a ground station connects, it pushes the setting that matches the model
   type (car/boat on, plane/drone off).
2. **Cameras:** add a camera (type `rpicam` or `usb`, resolution/FPS/bitrate) →
   **Save & apply**. go2rtc reloads.
3. **Telemetry:** source **`real`**, current sensor **`ina228`** (or `ina226`/`ina237`/
   `ina238`), enter `Shunt Ω` (e.g. 0.002) and, for the INA228/237/238, **Max current A**
   plus the shunt range. Add a voltage channel of the same kind ("Voltage 1") — the INA
   provides both. Enter the battery capacity (mAh), choose consumed/remaining display,
   pick what drives the **battery %** (coulomb counting, the voltage curve, or *clamp* =
   the lower of the two), and leave **Charge counter** on `auto`: with an INA228 that
   uses the chip's own counter, everything else integrates on the Pi → **Save**. Then
   restart the vehicle (`sudo systemctl restart yonderrc-vehicle`). With more than one
   voltage or current channel, mark the one that measures the pack as **primary** — it
   drives the %, the mAh and the warnings. **Temperature channels** are optional (see
   2.7); each value can be hidden per ground device under FPV › ⚙ › *Sensor values*.
4. **Security (optional):** set an **API secret** if the vehicle sits on a network you
   don't fully trust — see 6.1. Leave it empty for the first bench tests; it's off by
   default.

### 3.6 First function test (WHEELS UP / PROPS OFF!)

1. Open the ground app on the laptop, enter the **Pi address** at the top:
   `ws://yonderrc.local:8080`, **Connect**.
2. Do **not arm** yet. In the channel monitor check: does steering/rudder move the
   right channel? Endpoints ok? Adjust trim/EPA/reverse in the setup if needed.
3. **ESC calibration** (if needed) — start it in the setup, instructions follow. It
   teaches the ESC the **throttle channel's own endpoints** (shown above the start
   button, e.g. "CH03: max 1800 µs → min 1200 µs"), so set that channel's travel first
   if you want a reduced range. The profile-wide *Endpoints* field is a **batch write**
   into every channel, not a cap — a channel can be adjusted individually afterwards.
4. Only once everything is right: arm the drive, **hold the arm button** until the
   countdown completes (1 s by default), throttle up carefully.
5. **Video** should run in the FPV panel (the `go2rtc` service runs continuously).
6. Check **telemetry** in the OSD: does it show real pack voltage? Does it **not** say
   "SIM"? Then the sensor reads correctly. If "SIM" appears, the fallback kicked in
   (sensor not found) — check wiring/address/`i2c-bus` (`sudo i2cdetect -y 1`).

---

## 4. Switch from Wi-Fi to LTE (phase 2)

Once everything works over Wi-Fi, range comes via cellular. The catch: LTE sits behind
**CGNAT**, the vehicle has no public IP. The fix: **Tailscale** puts the Pi and the
ground device on the same private network — reachable anywhere.

### 4.1 LTE stick

1. Plug in the USB LTE dongle. Check that ModemManager sees it:
   ```bash
   mmcli -L
   ```
2. In the setup under **LTE**, enter your provider's **APN** → **Connect**. The APN is
   saved and will connect automatically at boot from then on (with `autoconnect`, so
   NetworkManager redials by itself). If your SIM has a **PIN**, or your carrier needs
   **APN username/password**, fill those in too — PIN/password are stored on the vehicle
   and never shown again. The status panel shows the modem model, registration state and
   flags "SIM PIN required" when relevant. Dongles that boot in "Zero-CD"/storage mode are
   handled by `usb-modeswitch` (installed by the setup script). You can also force the
   **network mode** (4G-only for lower latency), toggle **data roaming**, **change or
   remove the SIM's PIN lock**, and run **Diagnostics** (raw `mmcli` output) to see
   exactly what the Pi detects.
3. Once connected, the **uplink signal shows up in the ground station's OSD** (LTE
   signal % from ModemManager, otherwise the Wi-Fi RSSI from `iw dev wlan0 link`), and
   the OSD marks the link as weak below 25 %. If your Wi-Fi interface isn't `wlan0`,
   the Wi-Fi reading stays empty — LTE is unaffected.

### 4.1.1 HiLink sticks (Huawei E3372h-320 and friends)

Many Huawei sticks are **not modems** in the ModemManager sense: they run their own
little router, appear as a USB Ethernet interface with DHCP and dial by themselves.
`mmcli -L` stays empty for them forever, so §4.1 above simply does not apply — nothing
is broken, and the LTE panel staying empty is expected.

YonderRC reads them through their own API instead. **Setup › LTE stick (HiLink)** shows
model, interface, state, operator, network type and signal, and the **OSD link block
shows the LTE percentage** just as it does for a ModemManager modem.

- The stick is located **through the routing table** (`ip route get 192.168.8.1`), never
  by interface name. A vehicle with a FritzBox on `eth0` and the stick on `eth1` — or the
  other way round after a reboot or a different USB port — can therefore never confuse
  the two.
- **APN, SIM PIN and network mode live in the stick**, not in YonderRC. The vehicle
  therefore **passes the stick's own configuration page through on port 8081 by
  default**: open `http://<vehicle>:8081/` (or the **Open the stick's UI ↗** button in
  the panel) from the hotspot, the LAN or the VPN — no keyboard on the Pi and no moving
  the stick to a laptop. With an API secret configured, open it once as
  `…:8081/?secret=YOUR_SECRET`; the vehicle remembers it in a cookie. Clearing the port
  field switches the proxy off entirely.
  > Note what that means: on an **open** onboarding hotspot, anyone who joins can reach
  > the stick's admin page. Set a hotspot password or an API secret before the vehicle
  > leaves the bench — the same rule that already applies to the setup UI itself.
- Opening a raw API path in a browser (e.g. `…:8081/api/monitoring/status`) returns
  `125002`: the stick wants a session, which its own UI establishes. That is expected —
  YonderRC's own reader fetches a session token first.
- A **2G/3G-only stick** (E3131/E353, USB ID `12d1:14db`) is flagged in the panel:
  several countries — Germany among them — switched 3G off years ago, so such a stick
  gets no data connection there at all.

### 4.2 Tailscale

1. **Setup › Remote access** → Method **Tailscale** → **Bring up**, with the auth-key
   field left empty. The vehicle starts a login and shows the link within a few seconds
   (it waits up to 14 s for it); open the link, approve the device — it joins as
   `yonderrc`. The link also stays in the status while the login is pending, so a page
   reload does not lose it.
2. Prefer no clicking? Create an **auth key** in the admin console (*Settings › Keys*),
   paste it into the field and press **Bring up** — that path is non-interactive.
3. The vehicle's **Tailscale IP** then appears at the top of the setup status
   (e.g. `100.x.y.z`).
4. **Disable key expiry** for the vehicle in the admin console (*Machines › yonderrc ›
   Disable key expiry*), or it drops out of the tailnet after ~180 days — reliably while
   you are standing in a field with no keyboard.

> If no link appears at all, the vehicle has no internet, or Tailscale is wedged. Over
> SSH, `sudo tailscale up --hostname=yonderrc` prints the link directly.

### 4.3 Connect from the field

- Put your ground device (laptop/phone) on the same tailnet too (install the Tailscale
  app, log in).
- In the ground app, use the **Tailscale IP** as the address:
  `ws://100.x.y.z:8080`. Video works the same way over `http://100.x.y.z:1984`.

> **Latency/range:** for the absolute lowest-latency WebRTC path over LTE you can later
> add your own **TURN server (coturn)** on a cheap VPS. Tailscale alone already gives
> you a working, encrypted connection and is the simplest path that reliably works.

#### What this actually measured (first field test)

One afternoon, one carrier, one location — a data point, not a benchmark. Vehicle: Pi 4
with a **Huawei E3372h-320** on its **internal** antenna, Ethernet unplugged. Ground: a
Fedora laptop, both on the same tailnet.

| Reading | Value | Note |
|---|---|---|
| Tailscale path | **direct, IPv6** | `pong … via [2a01:599:…]:41641 in 69ms` — no DERP relay |
| Control round-trip | **110 ms** | scores 87/100 in the OSD's link health |
| Video latency | **128 ms** | barely above the control path, i.e. the WebRTC leg is healthy |
| Video bitrate | 444 kbps | auto-quality had stepped down for the weak signal |
| LTE signal | **52 %** (≈ −106 dBm RSRP) | the limiting factor — OSD showed `⇅ 52` and `⚠ SIGNAL` |

Two things worth taking from it. First, **the score names its own bottleneck**: 52 was the
signal, not the latency, so the fix is an antenna, not a faster link — the E3372h-320 has
two TS-9 sockets and an external antenna is worth 10–20 dB. Second, switching the ground
station from Wi-Fi to LTE mid-session **fired failsafe and cleared it again**, which is the
watchdog doing its job: control frames stopped for longer than 300 ms, the vehicle went
safe, and it came back when the frames resumed.

> A direct path is not guaranteed: it happened here because the carrier handed out a
> routable **IPv6** address. Behind CGNAT-only IPv4 Tailscale may fall back to a DERP
> relay, which adds latency — check with `tailscale ping <vehicle>` before you rely on it.

### 4.4 Other remote-access methods (Setup › Remote access)

Under **Setup › Remote access** you pick **one** method:

- **Tailscale** / **ZeroTier** — zero-config mesh VPNs, no server of your own. For
  ZeroTier: create a network at my.zerotier.com, enter its 16-hex **Network ID**, press
  *Bring up*, then authorize the Pi in ZeroTier Central. Connect the ground app to the
  Pi's ZeroTier IP.
- **WireGuard (your own server / FritzBox)** — if you already run a WireGuard server,
  add the Pi as a peer and **upload the exported `.conf`**. On a **FritzBox**: *Internet
  › Permit Access › VPN (WireGuard) › Add connection*, create a connection for the Pi,
  download the config file, then upload it under *Setup › Remote access › WireGuard* and
  press *Bring up*. The vehicle stores the file, applies it with `wg-quick`, and is then
  reachable at its WireGuard address (e.g. from your home network / via MyFRITZ!). It
  comes up automatically on the next boot.

> ZeroTier/WireGuard need their tools on the Pi (`zerotier-cli`, `wireguard-tools`) —
> the install script adds them; WireGuard applies as root via `wg-quick`. Verify the
> method on your Pi before relying on it in the field.

---

## 5. Operate locally with no network (AP mode + phone)

Unless its WiFi is joined to a network, the Pi starts its own **Wi-Fi hotspot
"YonderRC-setup"** shortly after boot (mode `always`, the default since v1.41.0 — see
5.2 for the other modes) — **open, with no password**, so the captive
portal can put the page in front of you with nothing to type. This lets you control and
configure entirely **without a laptop, using only a phone**:

1. On the phone, connect to the Wi-Fi **"YonderRC-setup"**.
2. Thanks to the **captive portal** the YonderRC page opens automatically (if not, open
   `http://192.168.4.1:8080/` in the browser).

> **When the page does *not* open by itself — by design.** The captive portal works by
> resolving every name to the Pi. If the vehicle has an uplink of its own (Ethernet on
> the bench, LTE in the field) the hotspot **shares that internet**, and hijacking DNS
> would break it for everyone connected — so YonderRC leaves DNS alone in that case and
> you open `http://192.168.4.1:8080/` yourself. The hotspot message in Setup says which
> of the two happened. Also: **phones** pop the page up reliably; a **laptop**
> (GNOME/Fedora, Windows) usually only shows a "sign in to network" notification.
3. There you have **both**: the **control** (the ground app, served directly by the Pi)
   and under **Setup** the full configuration.

> **The Wi-Fi radio has to be switched on first.** Raspberry Pi OS keeps it
> rfkill-blocked until a **Wi-Fi country** is set (radio regulations), and
> NetworkManager then simply calls the device "unavailable" — no hotspot can start,
> and nothing says why. YonderRC handles this: **Setup › WiFi › WiFi radio** shows the
> state and the country, and one button unblocks the radio and sets the country
> (pre-filled from the Pi's own locale/timezone). Starting the hotspot repairs it
> automatically and says so. The boot-time `onboard.sh` does the same. Over SSH the
> equivalent is `sudo raspi-config nonint do_wifi_country DE && sudo rfkill unblock wifi`.

### 5.1 Put the Pi on your Wi-Fi from the phone

**Setup › WiFi** does the whole onboarding without a keyboard on the Pi:

1. **Scan for networks** — the list shows SSID, signal and whether it's encrypted.
2. Tap your network, type the password, **Connect**.
3. The Pi has **one radio**, so joining your network **closes the hotspot** — the page
   stops responding, which is the expected sign that it worked. Rejoin your own Wi-Fi
   and open `http://yonderrc.local:8080/setup` (or the Pi's new IP).
4. If the password was wrong, the vehicle **brings the hotspot back up** so you can't
   lock yourself out. Join it again and retry.

### 5.2 Hotspot password and when it starts

Under **Setup › WiFi › Setup hotspot** you can rename the hotspot, give it a password
(min. 8 characters, WPA2 — empty keeps it open) and choose **when it starts**:

| Mode | Behaviour |
|---|---|
| **always** (default) | Whenever the WiFi radio is free — **next to Ethernet or LTE too**, so you can always walk up to the vehicle and reach the setup page. |
| **auto** | Only when the Pi has **no uplink at all** at boot (the behaviour before v1.41.0). |
| **off** | Never starts on its own. |

> Since the default keeps the hotspot up permanently, **give it a password** once the
> vehicle leaves the bench (same panel, min. 8 characters). Leaving it open is a
> deliberate choice — it is what makes the captive portal work with nothing to type —
> but an open AP also means anyone nearby reaches the setup page and, if you enabled it,
> the LTE stick's admin page.

*Save* applies at the next hotspot start, *Save & start now* restarts it immediately
(which drops you if you're connected through it) and *Stop hotspot* takes it down.

> **One radio, one job.** The Pi's built-in WiFi can either serve the hotspot **or** be
> joined to a network — not both. So `always` starts the hotspot next to **LTE**, but
> never while the Pi is a WiFi client; the onboarding checks that first, because tearing
> the WiFi link down would cut the vehicle off your LAN. If you want a hotspot *and* WiFi
> at the same time, add a **second USB WiFi adapter**.

> **What closes the hotspot:** joining a network from **Setup › WiFi** (single radio),
> *Stop hotspot*, or a reboot with a working uplink while the mode is `auto`. A remote
> service (Tailscale / ZeroTier / WireGuard) or an LTE connection does **not** — those
> ride on other interfaces, so the AP simply stays up.

So the vehicle serves the ground app itself — the ground app connects back
automatically to the same host (the Pi), including video. That makes the Pi
self-sufficient in the field; once Wi-Fi/LTE is back, you use the laptop or the
Tailscale address as usual.

> **Safety in AP mode:** the watchdog, arming and auto-disarm on reconnect apply here
> too. You don't have to switch auto-disarm off for a plane/drone by hand — the ground
> app sets it from the model type (car/boat on, plane/drone off).

> **Who can reach it:** the hotspot is **open by default**, so anyone in range can join
> and talk to the vehicle. On the bench that's convenient; before you go out, set a
> **hotspot password** (5.2) and an **API secret** (6.1). A published default password
> would have protected nothing, which is why there isn't one.

---

## 6. What safety YonderRC adds

- **Failsafe watchdog:** if valid control frames stop arriving for longer than the
  configured time (default 300 ms, changeable in the setup as "Watchdog (ms)"), the
  vehicle drives every channel to its failsafe value. The defaults are **vehicle-type
  aware and separate from disarming**: a drone holds throttle **mid** (no crash), a
  car/boat goes to **stop**, a plane to **motor off**. All adjustable per channel.
- **Disarming ≠ failsafe:** deliberate disarming really switches the motor off
  (drone/plane = minimum, car/boat = stop) — independent of the failsafe value.
- **Arming:** the throttle channel stays at idle while disarmed; the motor only runs
  after a deliberate arm.
- **Arming is per connection:** a newly connected ground station is always disarmed and
  has to arm deliberately. Whether an *existing* arm survives a reconnect is
  **vehicle-type dependent**: for a car/boat the vehicle disarms on reconnect, for a
  plane/drone it does **not** — a brief link drop must not cut an aircraft's motors in
  flight. The ground app pushes this from the model type; the checkbox in the setup page
  is only the fallback used until a ground station connects. In the ground app under
  **Setup › Controls** the policy can be forced to *always on* or *always off* — leave
  it on **auto** unless your setup really isn't described by the vehicle type.
- **Pre-arm check:** arming is refused while the throttle isn't at its rest position
  (centre or idle, depending on the channel's detent).
- **Hold to arm:** the arm button only acts after being held (1 s by default; it fills
  up and counts down), for arming *and* disarming — a mis-touch on a phone can't cut the
  motors. The same hold applies to a **key or controller button** bound to arm/disarm —
  a bumped controller cuts motors just as well as a mis-touch. Hold time (0.5–10 s) and
  an off switch live in the ground app under **Setup › Controls**. The bindable **panic-disarm** stays instant either way, and the OSD only
  ever shows DISARMED or FAILSAFE, never a badge for the normal armed case.
- **The speed limiter is comfort, not safety.** The three steps under the sticks scale
  the throttle command on the ground side; they do not change the failsafe value, the
  disarmed value or the pre-arm check, and a limited vehicle is not a disarmed one.
- **Panic-disarm ships unbound.** It is the one control with no hold and no
  confirmation, so an accidental press cuts the motors — on an aircraft, that is a
  crash. Bind it in **Setup › Controls** to a key or controller button you can't hit by
  accident; with a controller in your hands, bind it *on the controller*.
- **Driver fallback:** if the hardware driver fails to start, the service keeps running
  in sim and the setup UI stays reachable.
- **systemd `Restart=always`:** if the service crashes, systemd restarts it.

### 6.1 Trust model (who can control the vehicle)

The vehicle service listens on **all interfaces** (`0.0.0.0:8080`) and, out of the box,
**anyone who can reach that port can control and reconfigure it**. That is deliberate —
a headless vehicle must never lock you out — but it means the network *is* the security
boundary:

- **Home Wi-Fi / bench:** fine as-is.
- **The Pi's own hotspot:** WPA2 keeps strangers off the air; everyone on the hotspot is
  trusted.
- **LTE:** with Tailscale/ZeroTier/WireGuard the vehicle is only reachable inside your
  private network. CGNAT additionally means it has no public IP.
- **Shared or public Wi-Fi:** set an **API secret** under *Setup › Security*. Once set,
  mutating `/api/*` calls need the `x-yonderrc-secret` header (or `?secret=`) and the
  control WebSocket needs `?secret=` — a wrong one is rejected with close code 4001. The
  ground app has a secret field next to the address, and the setup page prompts for it.
  It can also come from the `YRC_API_SECRET` environment variable. The secret is stored
  in plain text in the vehicle's config file, so treat it as a lock on the door, not as
  encryption; the traffic itself is not encrypted (use a VPN for that).
- A **factory reset** (*Setup › System*) clears the secret along with everything else.
- To narrow it down further you can bind the service to a single address instead of
  every interface — e.g. `YRC_HOST=100.x.y.z` (its Tailscale IP) in the systemd unit's
  `Environment=`. There's no UI for it, and it locks you out of the hotspot/LAN path, so
  only do this once remote access provably works.

---

## 7. Quick troubleshooting

| Symptom | Check |
|---|---|
| No I2C device | `sudo i2cdetect -y 1` — do 0x40/0x41 appear? Wiring/addresses. |
| Servos jitter | Common ground? BEC strong enough? Is PCA9685 V+ powered? |
| OSD shows "SIM" despite a sensor | Is `i2c-bus` installed? Address correct in the setup? Is the sensor visible on the bus? |
| No video | Is `go2rtc` running? `systemctl status go2rtc`. Camera detected? |
| LTE won't connect | `mmcli -L`, APN correct? Signal? |
| No connection from the field | Are both devices on the same tailnet? Using the Tailscale IP? |
| Link drops immediately / setup asks for a password | An **API secret** is set — enter it next to the address in the ground app (WS close code 4001 = wrong secret, HTTP 401 on the setup API). |
| No GPS fix | Right source and device in *Setup › GPS*? Serial needs the optional `serialport` package; USB dongles need the **gpsd** source. Outdoors, first fix can take minutes. |
| No signal value in the OSD | LTE must be connected (`mmcli`), or the Wi-Fi interface must be `wlan0` — other interface names aren't read. |
