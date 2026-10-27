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
- Default address **0x40** — the same as every INA2xx sensor. **Leave the sensor on 0x40
  and move the PCA9685 to 0x41** (close the solder bridge **A0**), then enter `0x41` under
  Setup › *Vehicle configuration* and restart the service.
- Servos/ESC go to outputs 0–15. App channels 1–16 map to PCA9685 channels 0–15; while
  connected, the app shows the output next to each channel (`CH03 · out 2`).

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
- **Servo V+ does not come from the Pi either.** A servo on the Pi's 5 V pins pulls the
  whole Pi down — it looks like a software crash: picture freezes, back a minute later.
- **5.1 V / 3 A with a short, thick cable is the minimum.** Pi, camera, LTE stick and GPS
  alone draw 1.4–2 A at 5 V; a 5 A regulator from the drive battery is a safe choice.
- The OSD shows **⚠ POWER** while the supply is too weak.
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

- **TX and RX cross over.** Swapped, the receiver stays silent.
- Use **`/dev/serial0`**, not `/dev/ttyAMA0` (that is Bluetooth on a Pi 3/4/5). Needs the
  `serialport` module (3.3).
- If Setup › GPS offers **Free the serial port for GPS**, press it and reboot.
- **Indoors there is no fix**, but the GPS panel counts the incoming data: counting up
  means the wiring is right. "Nothing received" is the wiring; "no fix" is the roof.
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

> **First time with Linux?** [`QUICKSTART.md`](QUICKSTART.md) shows this chapter click by
> click — Imager, finding the Pi, SSH, copying the files.

1. **Raspberry Pi Imager** → **Raspberry Pi OS Lite (64-bit)**. Tested on **Bookworm**
   (listed as *Legacy*); the current **Trixie** should work but is untested.
2. In the Imager settings: **enable SSH**, a user, **Wi-Fi name, password and country**,
   hostname `yonderrc`.
3. **Wire the hardware first** (chapter 2), the PCA9685 on **0x41** — the installer looks
   at the bus once.
4. Flash, insert, power on.

### 3.2 Install

With internet on the Pi, log in (`ssh pi@yonderrc.local`) and run:

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

No internet on the Pi, or your own copy: copy the folder over
([`QUICKSTART.md`, option B](QUICKSTART.md#option-b-copy-the-files-yourself)), then
`sudo bash /opt/yonderrc/provisioning/install.sh`.

The installer sets up everything the vehicle needs (Node, video, network and VPN tools,
three systemd services), enables I²C and the serial port, and turns Wi-Fi power saving
off. Then it looks at the hardware **once** and fills in only what was never saved:

- a **PCA9685** → output driver `pca9685` with its address;
- a **CSI camera** → camera `cam` instead of the test pattern;
- current sensors are only **named** — set them up on the page (3.5 step 4).

Nothing found → the simulator stays. Running the installer again is safe. Two chips on the
same address cannot be told apart, so set the addresses **before** installing.

### 3.3 Hardware driver dependencies (only what you use)

The hardware drivers need a native module, which is compiled on the Pi. A vehicle needs at
most one, so none is installed by default. **Install yours in the browser** — Setup ›
Vehicle configuration › **Native driver modules**:

| module | needed for |
| --- | --- |
| `i2c-bus` | PCA9685 servo/ESC driver · INA2xx current sensors · ADS1115 ADC |
| `pigpio` | GPIO-PWM output instead of a PCA9685 (pin map: 2.8) |
| `serialport` | SBUS output (flight controller) · serial GPS |

Press **Install**, then restart the service when the page offers it.

- The Pi needs **internet** — its own hotspot has none, so join a network first.
- It **takes a minute**.
- A failed build names the cause and the command that fixes it.

Installed modules are restored after every update.

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

1. **Check for updates** shows what is new. It changes nothing.
2. **Update & restart** downloads, installs, rebuilds and restarts. If a step fails, the
   old version keeps running.

It refuses, with the reason, when there is no internet or the files were changed by hand.
*Update source* can point at a fork or another branch.

> When the check says the **installer** changed, run `sudo bash provisioning/install.sh`
> once — system packages and services are not updated from the page.

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

The page has tabs — **Overview · Network · Remote access · Sensors & outputs · Camera ·
GPS · Design**. *Overview* shows on one screen whether everything is there.

0. **Detect hardware** (in *Vehicle configuration*) lists the chips, modem and cameras it
   finds, by name. **Use these addresses** fills them into the forms; Save keeps them.
1. **Vehicle:** name, **Output driver = `pca9685`** (drone: `sbus`; no extra board:
   `gpio-pwm`, pins in 2.8), check the throttle channel. Set the **I²C address** — **0x41**
   for the reference build. Save, then **Restart vehicle service**.
2. **CSI camera module:** pick the sensor on the camera port. The official Pi cameras are
   found by themselves; for others (Arducam …) the page writes the boot setting and asks
   for a **reboot**.
3. **Cameras:** add a camera (`rpicam` for the ribbon cable, `usb` for USB; resolution,
   FPS, bitrate) → **Save & apply**.

   - **Mounted upside down?** Each camera has **Rotation** (0°/180°) and mirroring.
   - **No camera** is fine: the FPV area stays dark, everything else works.
   - **Picture stays black?** `rpicam-hello --list-cameras` must list the camera. If not:
     the ribbon cable — contacts towards the HDMI side, **CAM** port, not DISPLAY.
   - **Arducam 16 MP IMX519 blurry?** Set **Tuning file** to
     `/var/lib/yonderrc/tuning/imx519-af.json` and **Focus** to `manual` at 0 dioptres.
4. **Telemetry:** source **`real`**, current sensor **`ina228`** (or another INA) — this
   fills in the reference values. Set `Shunt Ω` to what is printed on your board and
   **Max current A** to your model's peak. Add a voltage channel of the same kind (the INA
   measures both), enter the battery capacity. With several channels, mark the one on the
   pack as **primary**. Temperature channels are optional (2.7).
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
2. In Setup › **LTE**, enter the **APN** → **Connect**. It reconnects by itself after a
   reboot. **SIM PIN** and APN user/password if your provider needs them. The panel can
   also force **4G-only**, switch **roaming**, change the PIN and show diagnostics.
3. The **signal** then shows in the OSD, marked weak below 25 %.

### 4.1.1 HiLink sticks (Huawei E3372h-320 and friends)

Many Huawei sticks are **not modems** but small routers: they dial by themselves, and
`mmcli -L` stays empty — so the LTE panel stays empty too. That is expected.

- **Setup › LTE stick (HiLink)** shows model, state, operator and signal; the OSD shows
  the signal as for any modem.
- **APN, PIN and network mode are set on the stick's own page.** The vehicle passes it
  through on **port 8081**: open `http://<vehicle>:8081/` (with an API secret:
  `…:8081/?secret=YOUR_SECRET`).
  > On an **open** hotspot anyone who joins reaches that page. Set a hotspot password or an
  > API secret before the vehicle leaves the bench.
- A **2G/3G-only stick** (E3131/E353) is flagged: 3G is switched off in many countries.

### 4.1.2 Mobile data budget

An FPV stream costs **0.5–1 GB per hour**. **Setup › Mobile data budget** counts the
mobile data and shows `⚠ DATA` in the OSD past a set share of your plan.

- Enter the **Plan allowance** in MB (4096 = 4 GB), **Warn at** in % (default 80) and,
  optionally, the **day of month** the plan resets.
- Counted: LTE stick, phone hotspot, tethered laptop. Not counted: the vehicle's own
  hotspot (free) and VPN interfaces (they would count every byte twice).
- With a HiLink stick, its own counter can be used instead. Both survive a reboot.

### 4.2 Tailscale

1. **Setup › Remote access** → **Tailscale** → **Bring up**, leave the auth key empty. A
   login link appears; open it and approve the device (it joins as `yonderrc`).
2. Or create an **auth key** in Tailscale (*Settings › Keys*), paste it, **Bring up**.
3. The vehicle's **Tailscale IP** appears in the status.
4. **Disable key expiry** for the vehicle (*Machines › yonderrc*), or it drops out after
   about 180 days.

### 4.3 Connect from the field

- Put the ground device into the same tailnet.
- Use the **Tailscale IP** as the address: `ws://100.x.y.z:8080`. Video comes along over
  the same address.

A first field test over LTE measured 110 ms control round-trip and 128 ms video latency
(details: [`FEATURES.md`](FEATURES.md#measured-in-the-field)). A weak signal is the usual
limit — an external antenna helps more than anything else. `tailscale ping <vehicle>`
shows whether the connection is direct or goes through a relay.

### 4.4 Other remote-access methods (Setup › Remote access)

Pick **one** method:

- **Tailscale** / **ZeroTier** — zero-config mesh VPNs, no server of your own. For
  ZeroTier: create a network at my.zerotier.com, enter the 16-hex **Network ID**, press
  *Bring up*, then authorize the Pi in ZeroTier Central.
- **WireGuard (your own server / FritzBox)** — **upload the exported `.conf`** or type the
  values in. On a FritzBox: *Internet › Permit Access › VPN (WireGuard) › Add connection*,
  download the file, upload it, *Bring up*. Keep **PersistentKeepalive at 25** — without
  it the tunnel dies behind the carrier's NAT.
- **OpenVPN (your own server) — experimental.** Upload the client profile (`.ovpn`) **with
  the certificates inside**; add username and password if it asks for them. Lines that
  would run programs on the vehicle are disabled and listed. **Not yet tested on a
  vehicle** — try it on the bench and report back.

Test the method at home before you rely on it in the field.

---

## 5. Operate locally with no network (AP mode + phone)

Unless its Wi-Fi is joined to a network, the Pi starts its own hotspot
**"YonderRC-setup"** shortly after boot — **open, no password**.

1. Connect the phone to **"YonderRC-setup"**.
2. The page opens by itself; otherwise open `http://192.168.4.1:8080/`.
3. You get **both**: the control app and, under **Setup**, the full configuration.

> **The page does not open by itself** when the vehicle has its own internet (LTE): the
> hotspot then shares it, and the page has to be opened by hand. Laptops usually only show
> a "sign in to network" notice.

> **Wi-Fi does not work at all?** Raspberry Pi OS blocks the radio until a **Wi-Fi
> country** is set. **Setup › WiFi › WiFi radio** fixes it with one button.

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
| **always** (default) | Whenever the radio is free — also next to Ethernet or LTE. |
| **auto** | Only when there is no other connection at boot. |
| **off** | Never starts on its own. |

> **Give it a password** once the vehicle leaves the bench. Open is only the default so the
> first setup needs no typing — on an open hotspot anyone nearby reaches the setup page.

> **One radio, one job.** The built-in Wi-Fi is either the hotspot **or** joined to a
> network, never both. For both at once, add a USB Wi-Fi adapter.

---

## 6. What safety YonderRC adds

- **Failsafe:** no control frames for **500 ms** (100–2000 ms, Setup › Sensors &
  outputs) → every channel goes to its failsafe value: a drone holds **mid** throttle, a
  car or boat **stops**, a plane cuts the **motor**. Adjustable per channel.
- **Disarmed means off:** a disarmed vehicle keeps its motor off, also when the link
  drops. The failsafe values hold from the moment the service starts, even before a ground
  station connects.
- **No frames rather than wrong ones:** in the background (another tab, phone screen
  off) or with an armed gamepad model whose controller is gone, the app sends nothing and
  the vehicle goes to failsafe. A gamepad model does not arm without its controller.
- **Arming:** every new connection starts disarmed. After a reconnect, car and boat are
  disarmed, aircraft stay armed — a short drop must not cut a motor in flight (changeable
  in **Setup › Controls**).
- **Pre-arm check:** arming is refused while the throttle is not at rest.
- **Hold to arm** (1 s) for arming *and* disarming, on the button and a bound key.
  **Panic-disarm** is instant and ships unbound — bind it to something you cannot hit by
  accident.
- The **speed limiter** is comfort, not safety. ESC calibration stops when the link drops.
- A hardware driver that fails to start leaves the vehicle in the simulator, reachable,
  and the page says why. The service restarts itself after a crash.

### 6.1 Trust model (who can control the vehicle)

The service listens on **all interfaces** (`0.0.0.0:8080`) and out of the box **anyone who
can reach that port can control and reconfigure it**. That is deliberate — a headless
vehicle must never lock you out — but it makes the network the security boundary.

- **Home Wi-Fi / bench:** fine as-is.
- **The Pi's own hotspot:** WPA2 keeps strangers off the air.
- **LTE:** with Tailscale/ZeroTier/WireGuard the vehicle is only reachable inside your
  private network, and CGNAT means no public IP anyway.
- **Shared or public Wi-Fi:** set an **API secret** under *Setup › Security*. The control
  app, the video and every change on the setup page then need it (enter it next to the
  address). It is a lock on the door, not encryption.
- **A web page from the internet cannot drive your vehicle**, even without a secret: the
  vehicle only accepts pages from itself, the local network or a VPN.
- **The video server is not reachable from the network**; video goes through the vehicle
  service (`…:8080/video`) under the same rules. WebRTC media uses port 8555.
- **Only one ground station is in control.** A new connection takes over and the old one
  is told why.
- A **factory reset** clears the secret along with everything else.
- Tighter still: `YRC_HOST=100.x.y.z` in the systemd unit binds the service to one address
  — but locks out the hotspot and the LAN, so only once remote access works.

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
| Flickers in and out of failsafe | Usually WiFi power saving, a hidden control page or jitter — the diagnostics file tells which ([TROUBLESHOOTING.md §2](TROUBLESHOOTING.md#2-the-vehicle-flickers-in-and-out-of-failsafe)). |
| Controller does nothing / the wrong device is used | Press a button on it; *Setup › Controls › Game controller* lists every device and lets you pick ([TROUBLESHOOTING.md §3](TROUBLESHOOTING.md#3-the-game-controller-does-nothing)). |
| Overview: "Output driver … failed to start" | The native module is missing or the address is wrong — the line says which (TROUBLESHOOTING.md §4). |
| Anything else | *Setup › Diagnostics* → one file → GitHub issue ([TROUBLESHOOTING.md §1](TROUBLESHOOTING.md#1-reporting-a-problem-the-diagnostics-file)). |

---

## 8. Glossary

| Term | Meaning |
|---|---|
| **Arm / disarm** | Arm = the motor may run. Disarmed, the vehicle holds its throttle off. |
| **BEC / UBEC** | A small voltage regulator: makes 5 V for the Pi and the servos from the drive battery. |
| **ESC** | Electronic speed controller — drives the motor; gets a servo signal like a servo. |
| **Failsafe** | What every channel does when the link is lost (stop, hold, motor off). |
| **FPV** | First-person view: driving by the camera picture. |
| **I²C** | A two-wire bus (SDA, SCL) for the PCA9685 and the sensors; every chip has an address like `0x40`. |
| **LTE / CGNAT** | Mobile internet. The vehicle gets no public address there, hence a VPN. |
| **OSD** | On-screen display: the readings drawn over the video. |
| **PCA9685** | A 16-channel board that makes the servo signals. |
| **Shunt** | A tiny resistor the current sensor measures across; its value is printed on the board (`R002` = 0.002 Ω). |
| **SSH** | Remote login to the Pi's command line. |
| **Tailscale / WireGuard / ZeroTier** | VPNs: put the vehicle and your phone or laptop in one private network over the internet. |
| **µs (microseconds)** | The servo signal: 1000 µs one end, 1500 µs centre, 2000 µs the other end. |
