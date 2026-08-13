**English** · [Deutsch](HARDWARE.de.md)

# YonderRC — Hardware guide (parts list, wiring, setup)

This guide takes YonderRC from pure simulation to real hardware: a Raspberry Pi as
the vehicle computer, a PCA9685 for servos/ESC, an INA226 for current/voltage, a
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
| Current/voltage sensor | **INA226** breakout (I2C) | Measures pack voltage and current high-side; precise for mAh counting. Alternatively INA219 (smaller currents). |
| Pi power supply | **UBEC/BEC 5 V / 3 A** | Powers the Pi reliably from the drive battery. |
| Camera | **Pi Camera Module 3** (CSI) *or* a USB camera with H.264 | CSI = lowest latency. |
| Wiring | Jumpers, JST, soldering gear | I2C bus, servo connectors, sensor. |

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

### 2.2 INA226 (current/voltage) ↔ I2C

- SDA/SCL on the **same** I2C bus as the PCA9685 (in parallel), with a different
  address (the INA226 default is **0x40**? — that collides with the PCA9685! **Set the
  address via a solder bridge to e.g. 0x41**, or move the PCA9685 to 0x41; the point is
  they must differ).
- The sensor sits **high-side** in the battery's positive lead: battery(+) → `VIN+`,
  load (ESC/BEC) → `VIN−`. The internal/external **shunt** sets the measurement range
  (e.g. 0.002 Ω for high currents). You enter the shunt value later in the setup.
- Connect the sensor's **GND** to the common ground point.

```
Battery(+) ──► [INA226 VIN+  VIN−] ──► ESC/BEC (+)
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

---

## 3. Software — step by step (Wi-Fi first)

### 3.1 Flash Raspberry Pi OS

1. **Raspberry Pi Imager** → **Raspberry Pi OS Lite (64-bit, Bookworm)**.
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

`install.sh` installs Node, ffmpeg, NetworkManager, ModemManager, Tailscale and
go2rtc, sets up the three systemd services (`yonderrc-vehicle`, `go2rtc`,
`yonderrc-onboard`) and enables **I2C** and **UART**.

> The Fedora note for your laptop does not apply here — on the Pi the script brings
> the right ffmpeg with H.264.

### 3.3 Hardware driver dependencies (only what you use)

```bash
cd /opt/yonderrc
npm install i2c-bus    -w @yonderrc/vehicle    # PCA9685 + INA226
npm install pigpio     -w @yonderrc/vehicle    # (only for GPIO-PWM instead of PCA9685)
npm install serialport -w @yonderrc/vehicle    # (only for SBUS/drone)
sudo systemctl restart yonderrc-vehicle
```

### 3.4 Configure over Wi-Fi (graphical)

From a laptop/phone on the same Wi-Fi open: **`http://yonderrc.local:8080/setup`**
(or `http://<pi-ip>:8080/setup`).

1. **Vehicle:** set the name, **Output driver = `pca9685`** (drone: `sbus`), check the
   throttle channel.
2. **Cameras:** add a camera (type `rpicam` or `usb`, resolution/FPS/bitrate) →
   **Save & apply**. go2rtc reloads.
3. **Telemetry:** source **`real`**, current sensor **`ina226`**, enter `Shunt Ω`
   (e.g. 0.002), voltage label "Voltage 1", enter the battery capacity (mAh), choose
   consumed/remaining display → **Save**. Then restart the vehicle
   (`sudo systemctl restart yonderrc-vehicle`).

### 3.5 First function test (WHEELS UP / PROPS OFF!)

1. Open the ground app on the laptop, enter the **Pi address** at the top:
   `ws://yonderrc.local:8080`, **Connect**.
2. Do **not arm** yet. In the channel monitor check: does steering/rudder move the
   right channel? Endpoints ok? Adjust trim/EPA/reverse in the setup if needed.
3. **ESC calibration** (if needed) — start it in the setup, instructions follow.
4. Only once everything is right: arm the drive, press **Arm**, throttle up carefully.
5. **Video** should run in the FPV panel (the `go2rtc` service runs continuously).
6. Check **telemetry** in the OSD: does it show real pack voltage? Does it **not** say
   "SIM"? Then the INA226 reads correctly. If "SIM" appears, the fallback kicked in
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

> **Safety in AP mode:** the watchdog, arming and (if enabled) auto-disarm on reconnect
> apply here too. For plane/drone, turn off auto-disarm in the setup.

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
- **Auto-disarm on reconnect:** every new connection starts disarmed — after a link
  loss you must deliberately re-arm.
- **Driver fallback:** if the hardware driver fails to start, the service keeps running
  in sim and the setup UI stays reachable.
- **systemd `Restart=always`:** if the service crashes, systemd restarts it.

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
