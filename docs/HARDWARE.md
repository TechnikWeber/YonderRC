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

The native libraries are **optional dependencies** and the installer deliberately runs
`npm install --omit=optional`, so a Pi without any of that hardware still installs
cleanly. Add the one you need:

```bash
cd /opt/yonderrc
npm install i2c-bus    -w @yonderrc/vehicle    # PCA9685 + INA2xx
npm install pigpio     -w @yonderrc/vehicle    # (only for GPIO-PWM instead of PCA9685)
npm install serialport -w @yonderrc/vehicle    # (only for SBUS/drone, and serial GPS)
sudo systemctl restart yonderrc-vehicle
```

### 3.4 Configure over Wi-Fi (graphical)

From a laptop/phone on the same Wi-Fi open: **`http://yonderrc.local:8080/setup`**
(or `http://<pi-ip>:8080/setup`).

0. **Detect hardware** (in *Vehicle configuration*) scans the I²C bus, `mmcli` and the
   camera devices and suggests a driver/sensors — a good starting point before you fill
   anything in by hand.
1. **Vehicle:** set the name, **Output driver = `pca9685`** (drone: `sbus`), check the
   throttle channel. The *Auto-disarm on reconnect* checkbox here is only a **fallback**
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
   restart the vehicle (`sudo systemctl restart yonderrc-vehicle`).
4. **Security (optional):** set an **API secret** if the vehicle sits on a network you
   don't fully trust — see 6.1. Leave it empty for the first bench tests; it's off by
   default.

### 3.5 First function test (WHEELS UP / PROPS OFF!)

1. Open the ground app on the laptop, enter the **Pi address** at the top:
   `ws://yonderrc.local:8080`, **Connect**.
2. Do **not arm** yet. In the channel monitor check: does steering/rudder move the
   right channel? Endpoints ok? Adjust trim/EPA/reverse in the setup if needed.
3. **ESC calibration** (if needed) — start it in the setup, instructions follow.
4. Only once everything is right: arm the drive, press **Arm**, throttle up carefully.
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

### 4.2 Tailscale

1. In the setup under **Tailscale**, click **Bring up** — without an auth key you get a
   login URL; open it and approve the device in your tailnet. (Or create an auth key
   ahead of time and paste it for non-interactive setup.)
2. The vehicle's **Tailscale IP** then appears at the top of the setup status
   (e.g. `100.x.y.z`).

### 4.3 Connect from the field

- Put your ground device (laptop/phone) on the same tailnet too (install the Tailscale
  app, log in).
- In the ground app, use the **Tailscale IP** as the address:
  `ws://100.x.y.z:8080`. Video works the same way over `http://100.x.y.z:1984`.

> **Latency/range:** for the absolute lowest-latency WebRTC path over LTE you can later
> add your own **TURN server (coturn)** on a cheap VPS. Tailscale alone already gives
> you a working, encrypted connection and is the simplest path that reliably works.

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

If the Pi finds **neither a known Wi-Fi nor LTE**, after boot it automatically starts
its own **Wi-Fi hotspot "YonderRC-setup"** (password `yonderrc123`). This lets you
control and configure entirely **without a laptop, using only a phone**:

1. On the phone, connect to the Wi-Fi **"YonderRC-setup"**.
2. Thanks to the **captive portal** the YonderRC page opens automatically (if not, open
   `http://192.168.4.1:8080/` in the browser).
3. There you have **both**: the **control** (the ground app, served directly by the Pi)
   and under **Setup** the full configuration.

So the vehicle serves the ground app itself — the ground app connects back
automatically to the same host (the Pi), including video. That makes the Pi
self-sufficient in the field; once Wi-Fi/LTE is back, you use the laptop or the
Tailscale address as usual.

> **Safety in AP mode:** the watchdog, arming and auto-disarm on reconnect apply here
> too. You don't have to switch auto-disarm off for a plane/drone by hand — the ground
> app sets it from the model type (car/boat on, plane/drone off).

> **Who can reach it:** the hotspot is WPA2-protected, but anyone joined to it can talk
> to the vehicle unless you set an **API secret** (6.1). The same applies on a shared
> Wi-Fi.

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
  is only the fallback used until a ground station connects.
- **Pre-arm check:** arming is refused while the throttle isn't at its rest position
  (centre or idle, depending on the channel's detent).
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
