**English** · [Deutsch](HARDWARE.de.md)

# YonderRC — Hardware guide (parts list, wiring, setup)

From pure simulation to real hardware: a Raspberry Pi as the vehicle computer, a PCA9685
for servos/ESC, an INA228 for current/voltage, a camera for FPV — first over Wi-Fi, then
over LTE with Tailscale.

> **Safety first.** For the first test: **props off / wheels up**, ESC unpowered or the
> motor unplugged. Add drive power only once every channel provably does the right thing.
> Arming is always the **last** step.

---

## 1. Parts list

### Required

| Part | Recommendation | Why |
|---|---|---|
| Computer | **Raspberry Pi 4** (2 GB is enough) or **Pi Zero 2 W** | Hardware H.264 encoder for low-latency FPV. **The Pi 5 has none.** |
| Storage | microSD 32 GB (A1/A2) | For Raspberry Pi OS Lite. |
| Servo/ESC driver | **PCA9685** 16-channel PWM (I2C), moved to **0x41** | Clean 50 Hz servo signals independent of the CPU. Close solder bridge **A0** so it does not collide with the sensor (2.1). |
| Current/voltage sensor | **INA228** breakout (I2C) on **0x40**, **2 mΩ shunt** (`R002`) | Pack voltage and current, high-side. Counts charge and energy itself, 85 V bus (up to 12S), 20-bit. |
| Pi power supply | **UBEC/BEC 5 V / 3 A** | Powers the Pi from the drive battery. |
| Camera | **Pi Camera Module 3** (CSI) *or* a USB camera with H.264 | CSI = lowest latency. |
| Wiring | Jumpers, JST, soldering gear | I2C bus, servo connectors, sensor. |

### Optional

| Part | Recommendation | Why |
|---|---|---|
| GPS | **Adafruit Ultimate GPS v3** (MTK3339) | NMEA 9600 on the header UART, battery-backed. u-blox NEO-6/7/8/M9 and BN-880 work identically (2.6). |
| LTE | see "For LTE" below | Beyond line of sight. |
| Temperature | see 2.7 | Motor/ESC/pack temperatures in the OSD. |

### The reference build

What the setup page fills in for you, and what this guide assumes. All changeable.

| What | Value | Why this one |
|---|---|---|
| INA228 address | **0x40** | Factory address; the telemetry channel defaults to it. |
| PCA9685 address | **0x41** | Both chips ship on 0x40, and the driver's address is the one you can change from the browser (2.1). |
| Shunt | **0.002 Ω** (`R002`) | What common 85 V breakouts carry. Read your own board and **calibrate against a reference meter**. |
| Max current | **20 A** | Sets the chip's LSB, i.e. the resolution of the mAh/Wh counter. Use your model's real peak. |
| Shunt range | ±163.84 mV | 0.002 Ω × 20 A = 40 mV *just* fits the ±40.96 mV range, with no margin — over it the reading clips silently. |
| GPS | `/dev/serial0`, 9600 baud | The alias for the header UART; ttyAMA0 is the Bluetooth UART (2.6). |
| Control | on-screen pad (touch) | The demo car and boat start in touch mode, so a phone on the hotspot can drive immediately. |

### Which current sensor? (INA228 recommended)

All supported and configured the same way — wire it high-side, enter the shunt value.

| Sensor | Bus range | Resolution | Charge counter | When |
|---|---|---|---|---|
| **INA228** | 85 V | 20-bit | **yes — in the chip** | **Recommended.** Up to 12S, and the mAh come out of the sensor. |
| INA238 | 85 V | 16-bit | no | Cheaper 85 V option, same wiring. The Pi integrates. |
| INA237 | 85 V | 16-bit | no | Like the INA238, lower accuracy grade. |
| INA226 | 36 V | 16-bit | no | Fine up to 8S; the most common breakout. |
| INA219 | 26 V | 12-bit | no | Small currents / small packs. |
| INA260 | 36 V | 16-bit | no | Integrated 2 mΩ shunt, limited to ~15 A. |
| INA3221 | 26 V | 13-bit | no | Three channels at once, coarse. |

The INA228 integrates **charge and energy in hardware** at ADC rate, so the consumed mAh
no longer depend on the polling rate or on a sample the loop missed. Every other sensor is
integrated on the Pi — precise, but only as good as the sampling.

Sizing: shunt so that `max current × shunt ≤ 163 mV` (e.g. 1 mΩ for 100 A). Under
**40.96 mV** you can switch to the ±40.96 mV range for 4× the resolution.

**The shunt field is a calibration factor**, not a datasheet value — its tolerance and the
terminal resistance both land in the measurement. Feed a known current and enter
`old shunt × reading / true current`. On the reference build a nominal 0.002 Ω became
0.00206 Ω, a 3 % error no amount of resolution would have found.

### For LTE (phase 2)

| Part | Recommendation |
|---|---|
| LTE stick | USB dongle supported by ModemManager (Huawei E3372 in "stick"/NCM mode, Quectel EG25-G) — or a HiLink stick, see 4.1.1 |
| SIM | Data SIM with a known APN |

### Depending on the vehicle

- **Car/boat:** ESC + steering/rudder servo.
- **Plane:** ESC + servos (aileron/elevator/rudder/throttle).
- **Drone:** usually a **flight controller** over **SBUS** instead of the PCA9685.

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
- Default address **0x40**, which every INA2xx also uses. **Leave the sensor on 0x40 and
  move the PCA9685 to 0x41** (close bridge **A0**), then enter `0x41` under Setup ›
  *Vehicle configuration* and restart the service. The PCA moves because its address is
  settable from the browser.
- The PCA9685 also answers on **0x70**, its *all-call* address. It has no ID register, so
  that is how **Detect hardware** tells it apart from an INA2xx. YonderRC leaves all-call
  enabled on purpose so the chip stays identifiable while running.
- Servos/ESC go to outputs 0–15. App channels 1–16 map to PCA9685 channels 0–15.

### 2.2 INA228 (current/voltage) ↔ I2C

*(Identical for the INA226/237/238 — only the setup entry changes.)*

A breakout has **two sides**: the small header carries I²C, the load current runs over the
separate terminals — never over the header.

| INA228 board | Raspberry Pi (BCM) | Pin |
|---|---|---|
| VCC | **3V3** | Pin 1 |
| GND | GND | Pin 6 |
| SDA | GPIO2 / SDA1 | Pin 3 |
| SCL | GPIO3 / SCL1 | Pin 5 |
| ALE / ALERT | — | leave unconnected |

- **VCC on 3V3, not 5 V**, unless the board has a level shifter (Adafruit/STEMMA do,
  plain CJMCU-style ones do not). Without one the pull-ups would drive SDA/SCL to 5 V.
- SDA/SCL share the bus with the PCA9685. Keep the INA on 0x40 and move the PCA (2.1); if
  you must move the sensor, its address is a field on every telemetry channel.
- **High-side** in the battery's positive lead: battery(+) → `VIN+`, load → `VIN−`. Read
  the shunt off the board: `R001` = 0.001 Ω, `R002` = 0.002 Ω, `R015` = 0.015 Ω. It caps
  what the chip can see — **I_max = 163.84 mV / R_shunt** (0.015 Ω ≈ 10 A, 0.001 Ω ≈ 160 A).
- **VBUS** measures against the sensor's ground, so one INA228 gives voltage *and*
  current with no extra divider.
- The sensor's **GND** goes to the common ground point.

```
Battery(+) ──► [INA228 VIN+  VIN−] ──► ESC/BEC (+)
Battery(−) ─────────────── common ground ───────────────
                 │
              Pi GND, PCA9685 GND, BEC GND  (ALL together!)
```

> **A common ground is mandatory.** Pi, PCA9685, sensor, BEC and ESC must share one, or
> servo signals and readings are unreliable.

### 2.3 Power supply

```
Drive battery ──► BEC 5V/3A ──► Pi (5V/GND, e.g. GPIO pin 2/6 or USB-C)
           └──► ESC ──► motor
```

- Do **not** power the Pi from a PCA9685 channel.
- **Servo V+ does not come from the Pi either.** The 5 V header pins sit on the input rail
  with no fuse, so a servo browns the whole board out — and that failure looks like a
  software crash, not a power problem: picture fine, freeze, back a minute later. It costs
  an SD card eventually.
- **5.1 V / 3 A with a short, thick cable.** A camera plus an LTE stick on a phone charger
  is already over the edge.
- **Measured idle draw** (Pi 4B + CSI camera + HiLink LTE stick + PCA9685 + GPS,
  streaming, motor stopped): **0.7–1.0 A at 7.2 V** ≈ 5–7 W — **1.4–2 A behind a 5 V
  regulator before a servo moves**. "5 V / 3 A" is the floor, not headroom. A 5 A
  buck-boost from the pack held `vcgencmd get_throttled` at `0x0`.
- The vehicle shows **⚠ POWER** in the OSD while the rail is below spec, and tells a
  thermal clamp apart from it. `0x0` is a healthy rail.
- Power-on order: electronics first, drive last. To switch off use **Shut down** on the
  setup page and wait for the green LED.

### 2.4 Camera

- **CSI:** ribbon cable to the camera port (Pi Zero: the narrower cable).
- **USB:** plug it in; ideally one that outputs H.264 itself.

### 2.5 Drone via SBUS (optional, instead of the PCA9685)

- Pi **UART TX** (GPIO14 / pin 8) → **SBUS-in** of the flight controller.
- SBUS is **inverted**, 100000 8E2. If your FC has no internal invert, add a transistor
  inverter between Pi TX and FC.

### 2.6 GPS (optional)

**Adafruit Ultimate GPS** (MTK3339), **u-blox NEO-6M/7M/8M/M9N**, **Beitian BN-220/880** —
most speak **NMEA at 9600 baud** over UART.

| GPS | Raspberry Pi | Pin |
|---|---|---|
| VCC | 3V3 (or 5V per module) | Pin 1 / 2 |
| GND | GND | Pin 6 |
| TX  | GPIO15 / RXD | Pin 10 |
| RX  | GPIO14 / TXD | Pin 8 |

- **TX and RX cross over.** Getting it wrong gives the same symptom as no cable: silence.
- Use **`/dev/serial0`** — the alias always points at the UART wired to the header. **Not
  `/dev/ttyAMA0` on a Pi 3/4/5**: that is the *Bluetooth* PL011. It opens without error and
  never delivers a byte, which reads exactly like a wiring fault. Setup › GPS warns about
  it. The serial source needs the optional `serialport` package (3.3).
- **Raspberry Pi OS parks a login console on that UART**, and a console talking over the
  receiver shreds its sentences. Setup › GPS checks both conditions (`enable_uart=1`, no
  serial console) and offers **Free the serial port for GPS** (backups as `*.yonderrc-bak`, reboot required). The installer does
  this on fresh installs since v1.61.0.
- **Indoors, where there is no fix:** the GPS panel counts arriving NMEA sentences and
  shows satellites *in view*. Sentences ticking up with 0 satellites means cable, baud and
  port are all correct. "Nothing received" is the wiring; "no fix" is the roof.
- **USB dongles** (u-blox VK-172, GlobalSat BU-353): pick the **gpsd** source instead.
- Set **min. satellites** (6 is a good default) and enable **auto-home**.

---

### 2.7 Temperature sensors (optional)

Any number of channels, added in Setup › Telemetry, shown in the OSD under voltage and
current.

| Sensor | Bus | Range / notes | Extra setup |
|---|---|---|---|
| **Raspberry Pi SoC** | — | The Pi's own die temperature | none |
| **DS18B20** | 1-Wire | −55…+125 °C, ±0.5 °C, waterproof probes available | `dtoverlay=w1-gpio` + 4.7 kΩ pull-up to 3V3 |
| **MCP9808 / TMP102 / TMP117** | I²C | −40…+125 °C; TMP117 is the accurate one (±0.1 °C) | address (0x18 / 0x48…) |
| **BMP280 / BME280** | I²C | Ambient air; not for hot spots | address 0x76/0x77 |
| **MAX6675 / MAX31855** | SPI | Type-K thermocouple to ~1000 °C — motors, ESCs, exhausts | `dtparam=spi=on` |
| **MAX31856** | SPI | Thermocouple, selectable type (B/E/J/K/N/R/S/T) | `dtparam=spi=on` |
| **MAX31865** | SPI | PT100/PT1000 to ~600 °C | `dtparam=spi=on`, ref. resistor 430 Ω / 4300 Ω |
| **ADS1115 / MCP3008 + NTC or PT100** | I²C / SPI | Cheapest option | series resistor, excitation, NTC R25/beta |

- 1-Wire and I²C sensors **share the bus** with the PCA9685/INA — just keep the addresses
  apart. SPI amplifiers each need their own chip-select (CE0/CE1).
- **NTC/PT100 on an ADC** is a divider: excitation → fixed resistor → probe → GND, ADC
  input between resistor and probe. Enter the fixed resistor as *series resistor* and the
  NTC's `R25/beta` (e.g. `10000/3950`).
- **Thermocouples measure hot things, not precisely** (±2 °C). For pack temperature a
  DS18B20 taped to the cells is better.
- A sensor that cannot be read is **left out of the OSD**, never shown as 0 °C.

---

### 2.8 GPIO-PWM (instead of the PCA9685)

`YRC_DRIVER=gpio-pwm` makes the Pi generate the pulses itself via `pigpio` (DMA-timed).
No extra board, but the CPU and one GPIO per channel join the signal path. **Beyond a
couple of channels the PCA9685 stays the better answer.**

Default pin map (BCM), channel 1 → 16:

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

- **Change it with `YRC_GPIO_PINS`** (comma-separated BCM numbers in channel order), e.g.
  `YRC_GPIO_PINS=17,18,27,22`. The **length caps the channel count**. No setup-UI field.
- The service logs the map it uses: `[gpio-pwm] ready on BCM pins […]`.
- **Channel 3 (BCM 27) is the default throttle** (`YRC_THROTTLE_CH=2`, 0-based).
- All pins start at **1500 µs**; pulses are dropped on shutdown.
- `pigpio` **needs root** — the shipped unit already runs as root.

#### It fits the reference build

The map avoids every bus this guide uses, so GPIO-PWM, the INA228, a GPS and a temperature
sensor can all run at once:

| Left free | Pins | Used by |
|---|---|---|
| I²C1 | BCM 2/3 (header 3/5) | INA228/226, MCP9808/TMP102/TMP117, BMP280/BME280, ADS1115 |
| UART0 | BCM 14/15 (header 8/10) | serial GPS — and SBUS |
| SPI0 | BCM 7–11 (header 19/21/23/24/26) | MAX6675/31855/31856/31865, MCP3008 |
| 1-Wire | BCM 4 (header 7) | DS18B20 (`dtoverlay=w1-gpio` default) |

- **BCM 18/19/20/21 double as I²S.** Only a problem with an audio HAT.
- **Move the 1-Wire pin, don't reuse one.** `dtoverlay=w1-gpio,gpiopin=17` makes GPIO 17
  the kernel's and channel 1 goes silent. Leave the DS18B20 on GPIO 4.

> **Power stays as in 2.3:** servo/ESC power from the BEC, never the Pi's 5 V pins. The Pi
> contributes only the **signal**, and a **common ground** is mandatory.

---

## 3. Software — step by step (Wi-Fi first)

### 3.1 Flash Raspberry Pi OS

1. **Raspberry Pi Imager** → **Raspberry Pi OS Lite (64-bit)**. The installer is tested
   against **Bookworm**; newer releases should work but are unverified.
2. In the Imager settings (gear): **enable SSH**, set a user, enter **Wi-Fi credentials**,
   hostname e.g. `yonderrc`.
3. Flash, insert, power on.

### 3.2 Log in and copy the project onto the Pi

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

**b) scp from the laptop** — run on your **laptop**:
```bash
# in the folder that contains YonderRC:
scp -r ~/YonderRC pi@yonderrc.local:/tmp/YonderRC
# then on the Pi:
ssh pi@yonderrc.local 'sudo mkdir -p /opt/yonderrc && sudo cp -a /tmp/YonderRC/. /opt/yonderrc/'
```
Don't copy `node_modules` — the installer installs fresh anyway.

**c) USB stick (Pi with no network)**
```bash
sudo mkdir -p /opt/yonderrc
sudo cp -a /media/*/YonderRC/. /opt/yonderrc/   # adjust the path (lsblk shows the drive)
```

Then install:

```bash
sudo bash /opt/yonderrc/provisioning/install.sh
```

That installs Node 22, ffmpeg, NetworkManager, ModemManager, `usb-modeswitch`,
`i2c-tools`, `gpsd`, `wireguard-tools`, Tailscale, ZeroTier and go2rtc, sets up the three
systemd services (`yonderrc-vehicle`, `go2rtc`, `yonderrc-onboard`) and enables **I2C** and
**UART**.

### 3.3 Hardware driver dependencies (only what you use)

The native libraries are **optional dependencies** — they compile on the Pi and a vehicle
needs at most one, so the installer runs `npm install --omit=optional`.

**Install the one you need in the browser** — Setup › Vehicle configuration › **Native
driver modules**:

| module | needed for |
| --- | --- |
| `i2c-bus` | PCA9685 servo/ESC driver · INA2xx current sensors · ADS1115 ADC |
| `pigpio` | GPIO-PWM output instead of a PCA9685 (pin map: 2.8) |
| `serialport` | SBUS output (flight controller) · serial GPS |

Each row shows its status and has an **Install** button; the page then offers the service
restart. Three things to know:

- The Pi needs **internet** — its own hotspot has no uplink, so join a network first.
- It **takes a minute**: the module is compiled on the Pi.
- A failed build names the cause and the fixing command. Usually
  `sudo apt install -y build-essential`; `pigpio` also needs `sudo apt install -y pigpio`.

What you installed is remembered (`hardwareDeps`) and restored by `install.sh` after every
update, so an update cannot turn a configured vehicle back into a simulator.

Over SSH instead:

```bash
cd /opt/yonderrc
npm install i2c-bus    -w @yonderrc/vehicle    # PCA9685 + INA2xx
npm install pigpio     -w @yonderrc/vehicle    # GPIO-PWM (pin map: 2.8)
npm install serialport -w @yonderrc/vehicle    # SBUS, serial GPS
sudo systemctl restart yonderrc-vehicle
```

### 3.4 Updating the vehicle

**From the setup page** — *Software update*:

1. **Check for updates** reports installed version, available version, how many commits
   behind and each subject line. It changes nothing.
2. **Update & restart** does what an SSH session would — `git pull --ff-only`, install
   changed dependencies, rebuild the control app if needed — and restarts the service
   last, so it never comes back into a half-updated checkout.

It refuses, and says why, on **local changes** (a fast-forward would fail or throw them
away) and with **no internet**. A failed step stops there and the old version keeps running.

**Update source.** Default is the checkout's own `origin` / `main`. The two fields under
*Update source* take a remote name or full URL plus a branch, so a vehicle can point at
your fork or a test branch without code changes.

> **The generated video config** lives at **`/var/lib/yonderrc/go2rtc.yaml`**, outside the
> checkout (`YRC_GO2RTC_CONFIG` overrides it). Writing it inside the repo left every
> vehicle with local modifications — exactly what a fast-forward trips over.
> `install.sh` moves an existing file across once.

> **Not covered:** apt packages, systemd units and `install.sh` itself. When the check says
> the installer changed, run `sudo bash provisioning/install.sh` once.

The equivalent over SSH:

```bash
cd /opt/yonderrc
sudo git pull --ff-only
sudo systemctl restart yonderrc-vehicle
# …and when the ground app or dependencies changed, the full run instead:
sudo bash provisioning/install.sh
```

### 3.5 Configure over Wi-Fi (graphical)

Open **`http://yonderrc.local:8080/setup`** (or `http://<pi-ip>:8080/setup`).

Seven tabs — **Overview · Network · Remote access · Sensors & outputs · Camera · GPS ·
Design**. *Overview* answers "is everything there?" on one screen. *Design* picks light
(default) or dark; the vehicle stores it and pushes it to the ground app, and the video
overlay stays light-on-dark in both. Every tab is a URL (`…/setup#gps`). Long explanations
are collapsed behind a one-line summary.

0. **Detect hardware** (in *Vehicle configuration*) scans I²C, `mmcli` and the camera
   devices. Chips with an ID register are **read out**, not guessed — a ✓ row names the
   actual part, and the PCA9685 is found through its all-call address. **Use these
   addresses** fills them into the forms; nothing is saved until you press Save.
1. **Vehicle:** name, **Output driver = `pca9685`** (drone: `sbus`; no extra board:
   `gpio-pwm`, pins in 2.8), check the throttle channel. With `pca9685` an **I²C address**
   field appears — **0x41** for the reference build, 0x40 for a board with no sensor next
   to it. The driver is built at startup, so save and use **Restart vehicle service**. The
   *Auto-disarm on reconnect* checkbox is only a **fallback**; a connected ground station
   pushes the setting matching the model type.
2. **CSI camera module:** pick the sensor on the camera port. Only the official Raspberry
   Pi cameras are auto-detected; anything else needs a device-tree overlay, read **only at
   boot**. Selecting a module writes `camera_auto_detect` and `dtoverlay=` into
   `/boot/firmware/config.txt` (one backup as `config.txt.yonderrc-bak`, competing lines
   commented out) and the panel says *Reboot required* until it has booted. A Pi 4 has one
   CSI connector, so this is one choice per vehicle; USB cameras are unaffected. A sensor
   not in the list goes under *Other module*, accepted only if that `.dtbo` exists.
3. **Cameras:** add a camera (type `rpicam` or `usb`, resolution/FPS/bitrate) → **Save &
   apply**. go2rtc reloads.

   - **Mounted upside down?** Each camera has **Rotation** (0°/180°) plus horizontal and
     vertical mirrors. On CSI the sensor applies them for free; USB gets an ffmpeg filter.
     90°/270° are deliberately not offered — the sensor cannot do them and faking them
     would put a transcode back into the pipeline.
   - **No camera is a valid setup.** Remove every entry and the FPV area stays dark:
     nothing retried, no error, OSD/telemetry/controls carry on.
   - **`rpicam` stream black?** `rpicam-hello --list-cameras` is the ground truth. Bookworm
     renamed the tools from `libcamera-*` to `rpicam-*`; YonderRC detects that itself. The
     official OV5647 / IMX219 / IMX477 / IMX708 need only `camera_auto_detect=1`. Others —
     **Arducam IMX519 / 64MP / Pivariety, OV64A40** — need `camera_auto_detect=0` plus an
     explicit `dtoverlay=` and a reboot, which the **CSI camera module** panel does. If the
     sensor's I²C address is silent too (`sudo i2cdetect -y 10`, needs `dtparam=i2c_vc=on`),
     it is the ribbon cable:
     contacts towards the HDMI side, **CAM** port, not DISPLAY.
   - **Arducam 16 MP IMX519 — sharp picture.** Raspberry Pi's `imx519.json` has no `rpi.af`
     algorithm, so libcamera answers every focus request with *no AF algorithm* and the
     lens stays at rest — which looks like a soft lens. Set **Tuning file** to
     `/var/lib/yonderrc/tuning/imx519-af.json` (shipped by `install.sh`) and pick a
     **Focus** mode. On a moving model prefer `manual` at 0 dioptres; `continuous` hunts.
4. **Telemetry:** source **`real`**, current sensor **`ina228`** (or `ina226`/`ina237`/
   `ina238`) — picking it fills in the reference values. Correct `Shunt Ω` to what is
   printed on your board and set **Max current A** to your model's real peak. The **I²C
   address** field stays empty for the default 0x40. Add a voltage channel of the same kind
   — the INA provides both. Enter the battery capacity, pick the display mode and what
   drives the **battery %**, and leave **Charge counter** on `auto`. With more than one
   voltage or current channel, mark the one measuring the pack as **primary**.
   **Temperature channels** are optional (2.7).
5. **Security (optional):** set an **API secret** if the vehicle sits on a network you
   don't fully trust — see 6.1. Off by default.

### 3.6 First function test (WHEELS UP / PROPS OFF!)

1. Open the ground app, enter `ws://yonderrc.local:8080`, **Connect**.
2. Do **not arm**. In the channel monitor: does steering move the right channel? Endpoints
   ok? Adjust trim/EPA/reverse in the setup.
3. **ESC calibration** if needed — it teaches the ESC the **throttle channel's own
   endpoints** (shown above the start button), so set that channel's travel first. The
   profile-wide *Endpoints* field is a **batch write**, not a cap.
4. Only then: arm, **hold the arm button** until the countdown completes, throttle up
   carefully.
5. **Video** should run in the FPV panel.
6. Check **telemetry**: real pack voltage, and **no** "SIM" marker. "SIM" means the sensor
   was not found — check wiring/address/`i2c-bus` (`sudo i2cdetect -y 1`).

---

## 4. Switch from Wi-Fi to LTE (phase 2)

LTE sits behind **CGNAT**, so the vehicle has no public IP. **Tailscale** puts the Pi and
the ground device on the same private network.

### 4.1 LTE stick

1. Plug in the dongle and check `mmcli -L`.
2. In Setup › **LTE**, enter the **APN** → **Connect**. It is saved and reconnects at boot
   (`autoconnect`). Fill in the **SIM PIN** and **APN username/password** if needed — both
   are stored on the vehicle and never shown again. Sticks that boot in "Zero-CD" mode are
   handled by `usb-modeswitch`. You can also force **4G-only**, toggle **roaming**, change
   or remove the **PIN lock**, and run **Diagnostics** (raw `mmcli`).
3. The **uplink signal then shows in the OSD** (LTE % from ModemManager, otherwise Wi-Fi
   RSSI from `iw dev wlan0 link`), marked weak below 25 %. A Wi-Fi interface that is not
   `wlan0` leaves the Wi-Fi reading empty; LTE is unaffected.

### 4.1.1 HiLink sticks (Huawei E3372h-320 and friends)

Many Huawei sticks are **not modems**: they run their own router, appear as USB Ethernet
with DHCP and dial by themselves. `mmcli -L` stays empty forever, so §4.1 does not apply —
an empty LTE panel is expected, not broken.

YonderRC reads them through their own API. **Setup › LTE stick (HiLink)** shows model,
interface, state, operator, network type and signal, and the OSD shows the LTE percentage
as it would for any modem.

- The stick is located **through the routing table** (`ip route get 192.168.8.1`), never by
  interface name — so a FritzBox on `eth0` and the stick on `eth1` can never be confused,
  whichever order they come up in.
- **APN, SIM PIN and network mode live in the stick.** The vehicle therefore **proxies the
  stick's own config page on port 8081**: open `http://<vehicle>:8081/` from the hotspot,
  the LAN or the VPN. With an API secret, open it once as `…:8081/?secret=YOUR_SECRET`.
  Clearing the port field switches the proxy off.
  > On an **open** hotspot, anyone who joins reaches the stick's admin page. Set a hotspot
  > password or an API secret before the vehicle leaves the bench.
- A raw API path in a browser returns `125002` — the stick wants a session, which its own
  UI establishes. Expected; YonderRC fetches a session token first.
- A **2G/3G-only stick** (E3131/E353, USB ID `12d1:14db`) is flagged: several countries,
  Germany included, switched 3G off years ago.

### 4.1.2 Mobile data budget

An FPV stream costs **0.5–1 GB per hour** and nothing announces that the plan is running
out. **Setup › Mobile data budget** counts it and puts `⚠ DATA` in the OSD past a
configured share.

| Measured by | Sees | Survives a reboot |
| --- | --- | --- |
| **the vehicle** (default) | every metered interface: LTE stick, phone hotspot, tethered laptop | yes |
| **the LTE stick** | only traffic through the stick | yes, in the stick's own flash |

Deliberately not counted:

- **The vehicle's own WiFi hotspot** — a ground station on it pulls the video stream for
  free (~900 MB/h). The same radio in *client* mode is counted.
- **VPN interfaces** (Tailscale, WireGuard, ZeroTier) — their traffic leaves again
  through the real uplink, so counting both counts every byte twice.

Settings: **Plan allowance** in MB (4096 = 4 GB), **Warn at** in % (default 80), and
optionally the **day of month** the plan resets. Otherwise reset with *Reset counter*.
With a HiLink stick an empty allowance falls back to the limit the stick already holds.

> The counter is saved every 5 minutes, every 20 MB and on shutdown — a hard power cut
> can cost at most the last few minutes.

### 4.2 Tailscale

1. **Setup › Remote access** → **Tailscale** → **Bring up**, auth-key field empty. The
   login link appears within a few seconds; open it and approve the device — it joins as
   `yonderrc`. The link stays in the status, so a page reload does not lose it.
2. Non-interactive instead: create an **auth key** (*Settings › Keys*), paste it in, press
   **Bring up**.
3. The vehicle's **Tailscale IP** then appears in the setup status.
4. **Disable key expiry** for the vehicle (*Machines › yonderrc*), or it drops out of the
   tailnet after ~180 days — reliably while you are standing in a field.

> No link at all means no internet, or a wedged Tailscale. Over SSH,
> `sudo tailscale up --hostname=yonderrc` prints it directly.

### 4.3 Connect from the field

- Put the ground device on the same tailnet.
- Use the **Tailscale IP** as the address: `ws://100.x.y.z:8080`. Video the same way over
  `http://100.x.y.z:1984`.

> For the lowest-latency WebRTC path over LTE you can later add your own **TURN server
> (coturn)** on a cheap VPS. Tailscale alone already gives a working encrypted connection.

#### What this actually measured (first field test)

One afternoon, one carrier, one location — a data point, not a benchmark. Pi 4 with a
**Huawei E3372h-320** on its **internal** antenna, Ethernet unplugged; ground a Fedora
laptop on the same tailnet.

| Reading | Value | Note |
|---|---|---|
| Tailscale path | **direct, IPv6** | 69 ms, no DERP relay |
| Control round-trip | **110 ms** | scores 87/100 in the OSD's link health |
| Video latency | **128 ms** | barely above the control path — the WebRTC leg is healthy |
| Video bitrate | 444 kbps | auto-quality had stepped down for the weak signal |
| LTE signal | **52 %** (≈ −106 dBm RSRP) | the limiting factor — OSD showed `⚠ SIGNAL` |

Two things to take from it. The score **names its own bottleneck**: 52 was the signal, so
the fix is an antenna, not a faster link (the E3372h-320 has two TS-9 sockets, worth
10–20 dB). And switching the ground station from Wi-Fi to LTE mid-session **fired failsafe
and cleared it again** — the watchdog doing its job.

> A direct path is not guaranteed; it happened here because the carrier handed out a
> routable **IPv6** address. Behind CGNAT-only IPv4 Tailscale may fall back to a relay —
> check with `tailscale ping <vehicle>`.

### 4.4 Other remote-access methods (Setup › Remote access)

Pick **one** method:

- **Tailscale** / **ZeroTier** — zero-config mesh VPNs, no server of your own. For
  ZeroTier: create a network at my.zerotier.com, enter the 16-hex **Network ID**, press
  *Bring up*, then authorize the Pi in ZeroTier Central.
- **WireGuard (your own server / FritzBox)** — either **upload the exported `.conf`** or
  **type the values** (private key, tunnel address, server public key, endpoint,
  AllowedIPs). On a FritzBox: *Internet › Permit Access › VPN (WireGuard) › Add
  connection*, download the config, upload it, *Bring up*. Keep **PersistentKeepalive at
  25** — behind carrier NAT a tunnel without it works until the first idle minute. Comes
  up automatically on the next boot.

> ZeroTier/WireGuard need their tools on the Pi (`zerotier-cli`, `wireguard-tools`); the
> installer adds them. Verify the method before relying on it in the field.

---

## 5. Operate locally with no network (AP mode + phone)

Unless its WiFi is joined to a network, the Pi starts its own hotspot **"YonderRC-setup"**
shortly after boot (mode `always`, the default since v1.41.0) — **open, no password**, so
the captive portal can put the page in front of you with nothing to type.

1. Connect the phone to **"YonderRC-setup"**.
2. The **captive portal** opens the page automatically; otherwise
   `http://192.168.4.1:8080/`.
3. You get **both**: the control app and, under **Setup**, the full configuration.

> **When the page does not open by itself — by design.** The portal resolves every name to
> the Pi. If the vehicle has its own uplink, the hotspot **shares that internet** and
> hijacking DNS would break it, so YonderRC leaves DNS alone and you open
> `http://192.168.4.1:8080/` yourself. The Setup message says which happened. Phones pop
> the page up reliably; laptops usually only show a "sign in to network" notification.

> **The Wi-Fi radio has to be on first.** Raspberry Pi OS keeps it rfkill-blocked until a
> **Wi-Fi country** is set, and NetworkManager then just calls the device "unavailable".
> **Setup › WiFi › WiFi radio** shows the state and unblocks it in one button, country
> pre-filled from the Pi's locale. Starting the hotspot repairs it automatically. The
> country stays editable — it decides channels and transmit power. Over SSH:
> `sudo raspi-config nonint do_wifi_country DE && sudo rfkill unblock wifi`.

### 5.1 Put the Pi on your Wi-Fi from the phone

**Setup › WiFi**, no keyboard needed:

1. **Scan for networks** — SSID, signal, encryption.
2. Tap yours, type the password, **Connect**.
3. The Pi has **one radio**, so joining closes the hotspot — the page stops responding,
   which is the expected sign that it worked. Rejoin your Wi-Fi and open
   `http://yonderrc.local:8080/setup`.
4. A wrong password **brings the hotspot back up**, so you cannot lock yourself out.

### 5.2 Hotspot password and when it starts

**Setup › WiFi › Setup hotspot** renames it, sets a password (min. 8 chars, WPA2 — empty
keeps it open) and chooses when it starts:

| Mode | Behaviour |
|---|---|
| **always** (default) | Whenever the radio is free — **next to Ethernet or LTE too**. |
| **auto** | Only with **no uplink at all** at boot (pre-v1.41.0 behaviour). |
| **off** | Never starts on its own. |

*Save* applies at the next start, *Save & start now* restarts immediately (dropping you if
you are connected through it), *Stop hotspot* takes it down.

> **Give it a password** once the vehicle leaves the bench. Open by default is deliberate —
> it is what makes the captive portal work with nothing to type — but an open AP means
> anyone nearby reaches the setup page and, if enabled, the LTE stick's admin page.

> **One radio, one job.** The built-in WiFi can serve the hotspot **or** join a network,
> not both. So `always` starts the hotspot next to **LTE**, but never while the Pi is a
> WiFi client. For both at once, add a **second USB WiFi adapter**.

> **What closes the hotspot:** joining a network from Setup › WiFi, *Stop hotspot*, or a
> reboot with a working uplink while the mode is `auto`. A VPN or an LTE connection does
> **not** — those ride on other interfaces.

The vehicle serves the ground app itself and the app connects back to the same host,
video included — self-sufficient in the field.

> **Safety in AP mode** is unchanged: watchdog, arming and auto-disarm all apply, and the
> ground app sets auto-disarm from the model type.

---

## 6. What safety YonderRC adds

- **Failsafe watchdog:** no valid control frames for longer than the configured time
  (default 300 ms) and every channel goes to its failsafe value. The defaults are
  **vehicle-type aware and separate from disarming**: drone holds throttle **mid**,
  car/boat **stop**, plane **motor off**. Adjustable per channel.
- **Disarming ≠ failsafe:** deliberate disarming really switches the motor off,
  independent of the failsafe value.
- **Arming:** the throttle stays at idle while disarmed.
- **Arming is per connection.** A new ground station is always disarmed. Whether an
  *existing* arm survives a reconnect is **vehicle-type dependent**: car/boat disarm,
  plane/drone do not — a brief link drop must not cut an aircraft's motors in flight. The
  ground app pushes this; the setup checkbox is only the fallback. It can be forced to
  always on/off under **Setup › Controls**.
- **Pre-arm check:** refused while the throttle is not at its rest position.
- **Hold to arm** (1 s by default) for arming *and* disarming, on the button and on a
  bound key or controller button. Hold time (0.5–10 s) and an off switch are in **Setup ›
  Controls**. **Panic-disarm stays instant.**
- **The speed limiter is comfort, not safety.** It scales the throttle command on the
  ground side; failsafe, the disarmed value and the pre-arm check are untouched.
- **Panic-disarm ships unbound.** It has no hold and no confirmation, so an accidental
  press cuts the motors — on an aircraft that is a crash. Bind it to something you cannot
  hit by accident.
- **Driver fallback:** a hardware driver that fails to start leaves the service running in
  sim with the setup UI reachable.
- **systemd `Restart=always`.**

### 6.1 Trust model (who can control the vehicle)

The service listens on **all interfaces** (`0.0.0.0:8080`) and out of the box **anyone who
can reach that port can control and reconfigure it**. That is deliberate — a headless
vehicle must never lock you out — but it makes the network the security boundary.

- **Home Wi-Fi / bench:** fine as-is.
- **The Pi's own hotspot:** WPA2 keeps strangers off the air.
- **LTE:** with Tailscale/ZeroTier/WireGuard the vehicle is only reachable inside your
  private network, and CGNAT means no public IP anyway.
- **Shared or public Wi-Fi:** set an **API secret** under *Setup › Security*. Mutating
  `/api/*` calls then need the `x-yonderrc-secret` header (or `?secret=`) and the control
  WebSocket needs `?secret=`; a wrong one closes with code 4001. It can also come from
  `YRC_API_SECRET`. Stored in plain text — treat it as a lock on the door, not encryption.
- **A page from the internet cannot drive your vehicle**, even with no secret. Any site the
  operator opens while on the vehicle's hotspot could otherwise POST to the setup API, or
  open a control WebSocket, which ignores CORS entirely. So the vehicle checks where the
  page came from: no `Origin` (curl, scripts), `file://` (desktop app), a private,
  loopback, `.local` or Tailscale address, or the vehicle's own address are accepted; a
  page from the public internet is refused (HTTP 403, WS close **4003**) unless it presents
  the secret. This also defeats DNS rebinding.
- **Only one ground station is in control.** A second connection closes the older link with
  code **4002** and says why. The newcomer always wins, which is what makes reconnecting
  after a link loss work.
- A **factory reset** clears the secret along with everything else.
- To narrow it further, bind to one address: `YRC_HOST=100.x.y.z` in the systemd unit. No
  UI for it, and it locks you out of the hotspot/LAN path — only do this once remote access
  provably works.

---

## 7. Quick troubleshooting

| Symptom | Check |
|---|---|
| No I2C device | `sudo i2cdetect -y 1` — do 0x40/0x41 appear? Wiring/addresses. |
| Sensor and driver both on 0x40 | Two chips at one address return junk, not an error. *Detect hardware* says so; move the PCA9685 to 0x41 (2.1). |
| Servos jitter | Common ground? BEC strong enough? PCA9685 V+ powered? |
| OSD shows "SIM" despite a sensor | Is `i2c-bus` installed? Address correct? Sensor visible on the bus? |
| No video | `systemctl status go2rtc`. Camera detected? |
| LTE won't connect | `mmcli -L`, APN correct? Signal? For a HiLink stick see 4.1.1. |
| No connection from the field | Both devices on the same tailnet? Using the Tailscale IP? |
| Link drops immediately / setup asks for a password | An **API secret** is set — enter it next to the address (WS 4001, HTTP 401). |
| "Another ground station took over" | A second ground connected (close code 4002). Reconnect to take it back. |
| "The vehicle refused this page" | The ground app came from a public address (4003 / HTTP 403). Serve it from the vehicle or set a secret. |
| No GPS fix | Right source and device in *Setup › GPS*? Serial needs `serialport`; USB dongles need **gpsd**. First fix can take minutes. |
| No signal value in the OSD | LTE must be connected, or the Wi-Fi interface must be `wlan0`. |
| No data warning despite a budget | Without a **Plan allowance** there is no threshold — the panel says so (4.1.2). |
