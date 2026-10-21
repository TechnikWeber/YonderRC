**English** · [Deutsch](QUICKSTART.de.md)

# YonderRC — Quick start on a Raspberry Pi

From an empty SD card to a vehicle you can drive from a browser — written for people
who have never used Linux. Plan about an hour; most of it is waiting.

At the end you have: a Raspberry Pi running YonderRC, its setup page open in your
browser, and — if you wired them before installing — the servo board and the camera
already in use.

> **Safety first.** Until everything is checked: **wheels up / props off**, motor
> unplugged. Arming is always the last step.

---

## 0. What runs where

| Part | Where | What you do |
|---|---|---|
| **Vehicle** | a Raspberry Pi in the model | install YonderRC on it — this guide |
| **Ground station** | any browser (PC, phone, tablet) | nothing to install — the vehicle serves it at `http://yonderrc.local:8080/` |
| Desktop app (optional) | Windows / Linux | `packages/desktop` — only if you want native controller support |

In the repository, `provisioning/` is everything that only concerns the Pi (installer,
services, hotspot). You never run anything from it on your PC.

## 1. What you need

- **Raspberry Pi 4** (2 GB is enough) or **Pi Zero 2 W**, a **microSD card** (32 GB), a
  proper **5 V / 3 A** supply.
- A **PC** (Windows, macOS or Linux) with an SD card reader, on the same WiFi/LAN.
- Optional, for a real vehicle: a **PCA9685** servo board, a **Pi camera module**, an
  **INA228** current sensor — parts and wiring are in [`HARDWARE.md`](HARDWARE.md).

## 2. Before installing: wire the hardware and set the I²C addresses

**Do this first.** The installer looks at the I²C bus and the camera port once: a
PCA9685 it finds becomes the output driver, a camera module replaces the test pattern.
Whatever is not connected then stays simulated — that is fine, it can be set later in
the setup page, but "plug in, install, drive" only works in this order.

1. **Power off** the Pi while wiring.
2. Wire the boards as in [`HARDWARE.md` §2](HARDWARE.md#2-wiring): SDA → pin 3,
   SCL → pin 5, 3V3 → pin 1, GND → pin 6. Servo power (V+) **never** from the Pi.
3. **Give every I²C chip its own address.** Two chips on the same address answer at
   the same time and return garbage, and neither can be identified:

   | Chip | Factory address | What to do |
   |---|---|---|
   | INA228 / INA2xx current sensor | `0x40` | leave it |
   | **PCA9685** servo board | `0x40` | **with an INA on the bus: close solder bridge A0 → `0x41`** |
   | ADS1115 ADC | `0x48` | — |
   | MCP9808 temperature | `0x18` | — |
   | BME280 / BMP280 | `0x76` / `0x77` | — |

   Without a current sensor, the PCA9685 can stay on `0x40`.
4. **Camera:** ribbon cable into the **CAM** port (not DISPLAY), contacts facing the
   HDMI side. The official Pi cameras are detected automatically. Others (Arducam
   IMX519, 64MP …) need their overlay selected after the install: Setup › Camera ›
   *CSI camera module*, reboot, then run the installer once more.

## 3. Write the SD card (Raspberry Pi Imager)

1. Install **Raspberry Pi Imager** on your PC: <https://www.raspberrypi.com/software/>.
2. **Device:** your Pi model.
3. **Operating system:** *Raspberry Pi OS (other)* → **Raspberry Pi OS Lite (64-bit)**.
   "Lite" means no desktop — the Pi runs headless in the model.
   > The installer is **tested on Bookworm (Debian 12)**. Imager's current Lite image
   > is based on **Trixie (Debian 13)**; it should work but has not been verified on a
   > vehicle yet. If you want the tested path, pick the **Legacy** Lite image (Bookworm)
   > in the same list — and if you use Trixie, a short note in an issue whether it
   > worked helps everyone.
4. **Storage:** your SD card. Everything on it is erased.
5. **Customise the OS** — Imager asks for it (Imager 2: the customisation steps of the
   wizard; Imager 1.x: *Edit settings*). This is what makes the Pi reachable without a
   screen:
   - **Hostname:** `yonderrc`
   - **Username and password:** your choice — write them down. This guide uses `pi`.
   - **WiFi:** network name, password and **WiFi country** (without a country the Pi
     keeps its WiFi switched off).
   - **Locale / time zone:** yours.
   - **Remote access / Services:** **enable SSH**, with password authentication.
6. Write the card, put it into the Pi, power on. The **first boot takes 2–5 minutes**
   (it enlarges the file system, applies the settings and may reboot once).

### Without Imager customisation (plan B)

Skipped step 5? On a **wired network** (Ethernet cable) the Pi can still be prepared
from the PC: the SD card shows one drive, `bootfs`. Put two files on it:

- an empty file named exactly **`ssh`** — no extension. Windows hides extensions: turn
  them on (Explorer › View › *File name extensions*) and check it is not `ssh.txt`;
- a file **`userconf.txt`** with one line `username:encrypted-password`. The encrypted
  password comes from `echo 'yourpassword' | openssl passwd -6 -stdin` (Linux, macOS,
  or the *Git Bash* that comes with Git for Windows).

WiFi cannot be set this way any more since Raspberry Pi OS Bookworm (`wpa_supplicant.conf`
is no longer read) — use the cable for the first start, then **Setup › Network › WiFi**
in the browser. (Trixie images read their settings from the files `user-data` and
`network-config` on the same drive — see
[Raspberry Pi's note on cloud-init](https://www.raspberrypi.com/news/cloud-init-on-raspberry-pi-os/).)
Honestly: running Imager again with the customisation is quicker.

## 4. Find the Pi on the network

Wait until the first boot is done (2–5 minutes), then on the PC:

- **Windows:** Start → type **PowerShell** → Enter. **macOS:** Programs › Utilities ›
  **Terminal**. **Linux:** your terminal.
- Type `ping yonderrc.local` and Enter. Answers coming back → the Pi is there, use
  `yonderrc.local` from now on. (Stop ping with **Ctrl+C**.)
- No answer? Look the Pi up in your **router's device list** (FritzBox: *Home
  Network › Network*) — the device called `yonderrc` — and use its IP address
  (e.g. `192.168.178.42`) instead of `yonderrc.local` everywhere below.

## 5. Log in with SSH

In the same PowerShell/terminal window:

```bash
ssh pi@yonderrc.local
```

(`pi` = the username from step 3.)

- The first time it asks *"Are you sure you want to continue connecting?"* → type
  `yes` and Enter.
- Type your password. **Nothing appears while you type — no dots, no stars. That is
  normal.** Enter.
- You are in when the line reads `pi@yonderrc:~ $`. Every command now runs **on the Pi**.

A few basics:

| | |
|---|---|
| `sudo …` | run a command as administrator (may ask for your password) |
| paste | right mouse button, or **Ctrl+Shift+V** (Windows Terminal: Ctrl+V) |
| **Ctrl+C** | stop the running command |
| `exit` | log out; the Pi keeps running |
| `sudo reboot` / `sudo poweroff` | restart / shut down — never just pull the plug while it writes |

> **"REMOTE HOST IDENTIFICATION HAS CHANGED"** after re-flashing the card: the PC
> remembers the old Pi. Run `ssh-keygen -R yonderrc.local` **on the PC** and log in again.

## 6. Install YonderRC

### Option A (recommended): one line, the Pi fetches everything itself

The Pi needs internet (it has it through your WiFi). Paste into the SSH window:

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

- It downloads YonderRC to **`/opt/yonderrc`** and runs the installer. That takes
  **10–30 minutes** (a Pi Zero 2 W longer); a lot of text scrolls past.
- Look for the block **`-- hardware detection`**: it says what was found and set, e.g.
  `Output driver: PCA9685 at 0x41 → driver "pca9685"` and
  `Camera: CSI module imx708 → camera "cam"`. "staying on sim" means nothing was found
  — check wiring and addresses (step 2).
- It ends with **`== Done ==`** and the addresses of the setup page.
- Connection dropped half-way? Log in again and run the same line once more — it picks up
  where it is.

### Option B: copy the files yourself

For a Pi without internet, or your own modified copy.

1. Get the project onto the PC: on GitHub **Code › Download ZIP**, unpack it. You get a
   folder (e.g. `YonderRC-main`) that contains `package.json`, `packages`,
   `provisioning`, … **directly** — that is the folder to copy.
2. Copy it to the Pi with **WinSCP** (Windows) or **FileZilla**: protocol **SFTP**,
   host `yonderrc.local`, port `22`, **your normal user** and password — **not root**:
   root login is switched off on Raspberry Pi OS, and it is not needed. Drop the folder
   into your home folder (`/home/pi`). Leave out a `node_modules` folder if there is one.
3. In the SSH window, run the installer from where you put it:

   ```bash
   sudo bash ~/YonderRC-main/provisioning/install.sh
   ```

   It moves the project to **`/opt/yonderrc`** itself (where the services expect it)
   and continues there. If `/opt/yonderrc` already exists, it says exactly what to do.

> **`$'\r': command not found`** or **`set: pipefail: invalid option`**: the scripts got
> Windows line endings on the way (a copy edited or checked out on Windows). Fix on the
> Pi: `sed -i 's/\r$//' ~/YonderRC-main/provisioning/*.sh` — then run the installer again.

## 7. Open the setup page

In a browser on the PC or phone (same network):

- **Setup page:** `http://yonderrc.local:8080/setup`
- **Control app:** `http://yonderrc.local:8080/`

On **Overview**, check the first lines:

- **Output driver** — `pca9685` means the servo board is in use. `sim — nothing is wired to
  a servo` means the simulator. Red text means a driver that failed to start; the line
  says why. Fix it under **Sensors & outputs**: *Detect hardware*, the *Install* button of
  the native module, *Restart vehicle service*.
- **Cameras** — a camera of type `rpicam` is the camera module; type `sim` is the test
  pattern.

Then, before the vehicle leaves the bench: a **password for the setup hotspot**
(Network › WiFi) and, on networks you do not fully trust, an **API secret**
(Network › Security).

> **No WiFi in reach?** The Pi then opens its own hotspot **`YonderRC-setup`** — join it
> with the phone and open `http://192.168.4.1:8080/setup`.

## 8. The first drive (wheels up!)

1. Open the control app `http://yonderrc.local:8080/` and press **Connect**.
2. **Setup** (top right) › pick a model or create one (*+ New…*), choose the **input
   method**: keyboard, gamepad or touch.
3. **Game controller:** plug it in or pair it via Bluetooth, then **press one of its
   buttons** — browsers only show a controller after that. *Setup › Controls › Game
   controller* lists every device and which one is used; pick yours if the automatic
   choice is wrong. PS4/PS5 pairing is explained right there. An RC transmitter or
   another controller marked *own layout*: press **Set up** next to it once.
4. Back to **Drive**: does the channel monitor follow the sticks? Then **hold Arm for
   1 s**, and carefully.

## 9. Updating later

**Setup › Overview › Software update**: *Check for updates*, then *Update & restart*.
When it says the installer itself changed, run it once more over SSH:

```bash
sudo bash /opt/yonderrc/provisioning/install.sh
```

## 10. When something does not work

Make a **diagnostics file** right after it happened — *Setup › Diagnostics* in the
control app (or *Overview › Problem report* on the setup page) — and attach it to a
GitHub issue. What is in it, how to send it, and the usual causes of a vehicle that
flickers into failsafe or a controller that does nothing:
[`TROUBLESHOOTING.md`](TROUBLESHOOTING.md).
