# YonderRC — Troubleshooting and reporting a problem

The short version: when something goes wrong, **make a diagnostics file right away and
attach it to a GitHub issue.** It holds everything needed to find the cause — and it
often names the cause itself, before anybody has to look.

---

## 1. Reporting a problem: the diagnostics file

### 1.1 Which file, made where

| Situation | Where | What you get |
|---|---|---|
| **Usual case** — the ground app connects | Ground app › **Ground setup › Diagnostics › Download diagnostics** | one `.json` with **both halves**: this app and the vehicle |
| The ground app cannot connect, the Vehicle setup opens | Vehicle setup › **Overview › Problem report › Download diagnostics** | one `.json` with the vehicle's half |
| Not even the Vehicle setup opens (service down) | SSH: `sudo bash /opt/yonderrc/provisioning/diag.sh` | one `.txt` in your home folder on the Pi |

**Make it right after the problem happened**, without restarting anything in between:
the vehicle counts its link statistics since the service started, the app since the page
was loaded. A restart wipes the evidence.

The `.txt` from `diag.sh` has to come off the Pi: in a terminal **on your PC**,
`scp pi@yonderrc.local:yonderrc-diagnostics-*.txt .` — or with WinSCP/FileZilla (SFTP),
like in [`QUICKSTART.md` §6](QUICKSTART.md#option-b-copy-the-files-yourself).

### 1.2 What is in it — and what is not

**In it:**

- **Both sides of the control link.** The app records how regularly its 50 Hz control
  loop really sent and whether the page was hidden; the vehicle records the gaps between
  the frames it received and every failsafe episode. Side by side, they say whether a
  failsafe came from the network, from the app, or from the vehicle itself.
- The vehicle's version, settings and log, its WiFi and power state, temperature, load and
  memory, what the operating system says about network and services, journal excerpts.
- Browser and device, the controllers the browser sees and which one is used, the active
  model.
- **Findings**: plain-language statements about what the numbers mean — at the top of the
  file and shown on the page right after the download.

**Not in it:** passwords, PINs, VPN keys and profiles' key material, the API secret, a
pending Tailscale login link, the GPS position and the home point. They are removed before
the file is written.

**Still in it:** network names (SSIDs) and local IP addresses — they are what a network
problem is found with. If that is too much for a public issue, see 1.3.

### 1.3 How to send it

1. Open <https://github.com/TechnikWeber/YonderRC/issues/new> (a free GitHub account is
   needed) and pick **Bug report**.
2. Describe it in a few lines: what you did, what happened, what you expected; Pi model,
   how the ground connects (home WiFi, the vehicle's hotspot, LTE + VPN), browser.
3. **Drag the file into the text box** — GitHub accepts `.json` and `.txt` directly.

Rather not post the file publicly? Open the issue without it and ask for a private way to
send it.

### 1.4 Reading it yourself

Open the `.json` in a browser or editor. The **`findings`** at the top are the summary;
`vehicle.link` has the gap histogram and the failsafe episodes (`failsafe.recent`),
`ground.sendLoop` the app's own pauses (`recentStalls`, with `hidden: true` when the page
was in the background).

## 2. The vehicle flickers in and out of failsafe

**What happens:** the vehicle drives every channel to its failsafe value when it has not
received a control frame for longer than its **watchdog** (500 ms by default since
v1.70.0, 300 ms before). The status strip's **Link gaps** cell counts those episodes and
shows the longest wait. A link that *works* can still trip it, if frames arrive in bursts.

| Cause | How to tell | What helps |
|---|---|---|
| **The control page was hidden or busy** — another tab in front, a minimised window, a phone screen that went dark, a slow phone | Diagnostics: "control loop paused …", events `page: hidden`, `control: held: hidden` | Keep the control page in front and the screen on. Since v1.70.1 the app sends nothing at all while it is in the background, so the vehicle holds its failsafe cleanly instead of jerking between command and failsafe — and says so when you come back. |
| **WiFi power saving on the Pi** | Diagnostics: "WiFi power saving is on"; on the Pi: `iw dev wlan0 get power_save` | `sudo iw dev wlan0 set power_save off`; the installer (v1.70.0+) switches it off for good — run it once. |
| **Weak WiFi** | OSD/diagnostics: signal below about −70 dBm | Closer access point, the vehicle's own hotspot, or LTE. |
| **The supply sags** | ⚠ POWER in the OSD, "under-voltage" in the diagnostics | 5.1 V / 3 A or more, a short thick cable, servos never powered from the Pi ([HARDWARE.md 2.3](HARDWARE.md#23-power-supply)). |
| **LTE jitter** | Gaps of 300–1000 ms with 0 % loss | Raise the watchdog (below) to 700–1000 ms; try *Control via WebRTC data channel* in the ground app. |
| **The vehicle itself is busy** | Diagnostics: "the vehicle service itself stalls", high load or temperature | Lower the video resolution or quality; cooling. |

**Changing the watchdog:** Vehicle setup › **Core setup › Watchdog (ms)**, 100–2000,
applies on *Save* without a restart. Shorter stops sooner after a real loss; too short
trips on ordinary jitter. The failsafe *values* per channel are set per model in the
ground app (Ground setup › Channels).

## 3. The game controller does nothing

- **Press a button on it.** A browser shows a controller to a page only after one of its
  buttons was pressed while the page had focus.
- **Ground setup › Controls › Game controller** lists every device the browser sees, which one is
  used, and lights a dot while a device sends input. Pick yours if the automatic choice
  is wrong — a headset or a "Motion Sensors" device is never chosen automatically, but it
  is listed.
- **"Own layout"** means the browser does not map the device to the standard layout — an
  RC transmitter in joystick mode, for instance: its axes and buttons are numbered its own
  way. Press **Set up** next to it and show the app once where its sticks and buttons are
  (a switch it reports as an axis works too); from then on every model works with it. A
  channel learned with it before that may point at another control afterwards — press
  **Learn** on it once more.
- **A button works on one controller and not on another:** each controller can have its
  own action buttons (Ground setup › Controls › Action bindings › *Controller buttons for*). One
  without its own uses the shared ones; keys are always shared.
- **Button numbers** follow the standard layout in the desktop app too, since v1.71
  (Start = 9, RT/R2 = 7, LT/L2 = 6, as in the browser). What the desktop app had learned
  before was renumbered once, automatically; each binding kept its physical button.
- **PS4 / PS5:** USB works straight away. Bluetooth: hold **Share + PS** (PS5: **Create +
  PS**) until the light bar flashes, pair it in the system's Bluetooth settings. In Chrome
  and Edge it then has the standard layout. **DS4Windows** hides the real controller and
  offers an emulated Xbox pad — pick that, or close the tool. **Steam** can grab the
  controller while it runs — close it if the controller shows no input.
- The model's **input method** must be *gamepad*: Ground setup › model › Input method.
- **"No controller" when arming** means just that: a gamepad model does not arm without its
  controller. If the controller drops out while armed, the app stops sending and the
  vehicle goes to failsafe until it is back ("Controller lost").

## 4. The servos do not move

- Vehicle setup › **Overview › Output driver**: `sim` means no hardware driver is selected;
  red text means one failed to start, with the reason.
- The usual reasons: the native module is missing (*Core setup › Add-ons › Install*
  `i2c-bus`), or the I²C address is wrong (*Detect hardware*, then the PCA9685 address
  field). Then **Restart vehicle service**.
- **A servo moves, but on the wrong channel:** the app counts channels 1–16, the PCA9685
  board its pins 0–15 — **CH01 is pin 0**. Connected, the channel monitor and the
  channel list name the pin next to each channel (`CH03 · PCA 2`).
- Still nothing: `sudo i2cdetect -y 1` over SSH must show the PCA9685's address (e.g. `41`)
  and `70`. Nothing there is wiring or power; two chips on one address give garbage
  ([QUICKSTART.md §2](QUICKSTART.md)).
- Servo power (V+) on the PCA9685 comes from a BEC, not from the Pi, and every ground is
  connected.

## 5. Installation problems

| Message | Meaning and fix |
|---|---|
| `$'\r': command not found`, `set: pipefail: invalid option` | The scripts have Windows line endings. On the Pi: `sed -i 's/\r$//' /opt/yonderrc/provisioning/*.sh`, run again. |
| `Run it with sudo` | `sudo bash /opt/yonderrc/provisioning/install.sh` |
| `… YonderRC lives in /opt/yonderrc — and that folder already has content` | Two copies. Install the one in `/opt/yonderrc`, or copy yours over it with the command shown (keeps the vehicle's settings). |
| `does not look like the YonderRC project` | The folder one level too deep was copied (e.g. `YonderRC-main/YonderRC-main`). Copy the folder that has `package.json` in it. |
| `curl: (6) Could not resolve host` | No internet on the Pi. WiFi set in Imager? Otherwise Ethernet, or copy the files (QUICKSTART Option B). |
| `REMOTE HOST IDENTIFICATION HAS CHANGED` (SSH) | After re-flashing: on the PC `ssh-keygen -R yonderrc.local`. |
| Certificate error during an update | The Pi's clock is wrong (it has no battery-backed clock). Give it internet; the Vehicle setup shows the clock next to the update button. |
| Simulator on Windows: `Cannot find module @rollup/rollup-win32-…` with "An Application Control policy has blocked this file" (German Windows: "Eine Anwendungssteuerungsrichtlinie hat diese Datei blockiert") | Windows' **Smart App Control** checks new program files online and can block one right after `npm install`. Wait a few minutes and run `npm run dev` again; usually the file is allowed then. If it stays blocked, the way out is to switch it off: *Windows Security › App & browser control › Smart App Control settings › Off*. **Think first:** it protects you from unknown programs, and depending on the Windows version it can only be switched back on by reinstalling Windows. |

## 6. Remote access is slow to come back after a network change

Moving the vehicle from one network to another — home Wi-Fi to a phone hotspot, Wi-Fi to
LTE — leaves a VPN tunnel on a path that no longer exists.

- **OpenVPN** (experimental): since v1.73 the vehicle notices the new uplink within a few
  seconds and tells OpenVPN to reconnect at once, and between failed attempts it waits at
  most 15 s (OpenVPN's own default grows to 300 s). *Remote access* shows how often it
  reconnected and why. Still slow? Make the diagnostics file right afterwards —
  `vehicle.remoteKeeper` and the OpenVPN journal in it show what happened — and open an
  issue.
- **WireGuard** (Keepalive 25) and **Tailscale** roam by themselves: they carry on from the
  new address without a new connection, which makes them the better fit for a vehicle that
  hops between networks.
- **WireGuard to a DynDNS name** (a home router's MyFRITZ address, say): when the router's
  address changes, the vehicle looks the name up again once the handshake goes stale (after
  about two minutes) — no restart needed.

More symptoms — no video, LTE, GPS, the data budget — are in
[`HARDWARE.md` §7](HARDWARE.md#7-quick-troubleshooting).
