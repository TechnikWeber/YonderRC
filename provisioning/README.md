# YonderRC vehicle provisioning (Raspberry Pi, headless)

Turns a Raspberry Pi into a headless YonderRC vehicle: control service, go2rtc
video, LTE, and Tailscale for remote access — configured from a phone/laptop via
a local web page, no screen or keyboard needed.

Everything in this folder runs **on the Pi** — nothing here is meant for your PC. First
install, step by step for people new to Linux: [`docs/QUICKSTART.md`](../docs/QUICKSTART.md).

| File | What it does |
|---|---|
| `bootstrap.sh` | the one-liner: clone to `/opt/yonderrc`, then run `install.sh` |
| `install.sh` | packages, Node, go2rtc, services, I²C/UART, WiFi power saving off, hardware detection |
| `diag.sh` | diagnostics file from a terminal, for when the setup page is not reachable |
| `onboard.sh` | boot-time hotspot fallback (run by `yonderrc-onboard.service`) |
| `systemd/` | the three units |
| `yonderrc.sudoers` | only for running the service as a non-root user (§7) |

## 1. Flash

Flash **Raspberry Pi OS Lite (64-bit)** with Raspberry Pi Imager — the installer is
tested on **Bookworm** (listed as *Legacy* once Trixie became the default; Trixie should
work but is unverified). In the Imager settings, enable SSH and preconfigure your home
WiFi (with its country) so the first boot is reachable. Pi 4 or Pi Zero 2 W are the sweet
spot (they have the hardware H.264 encoder; the Pi 5 does not).

**Wire the hardware before installing**, and give every I²C chip its own address — a
PCA9685 next to an INA2xx goes to `0x41` (solder bridge A0). The installer looks at the bus
once (§2).

## 2. Copy the repo and install

**One line** (clones to `/opt/yonderrc` and installs):

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

Or by hand — copy the repository anywhere on the Pi (scp, WinSCP/FileZilla over SFTP as
your normal user, a USB stick) and run its installer; it moves the copy to
`/opt/yonderrc` itself when that does not exist yet:

```bash
sudo bash ~/YonderRC/provisioning/install.sh
```

**Hardware detection:** once I²C is on, the installer probes the bus and the camera port
and fills in what was **never saved** — a PCA9685 becomes the output driver (and
`i2c-bus` is built), a CSI camera replaces the test pattern. Sensors are named, not
configured. A saved choice is never overwritten, so re-running the installer is safe.
After it's up, open `http://<pi-ip>:8080/setup`: *Overview › Output driver* shows what is
actually running, and **Detect hardware** probes again on demand.

`install.sh` installs Node, ffmpeg, NetworkManager, ModemManager, Tailscale, ZeroTier,
WireGuard and OpenVPN tools and go2rtc, does `npm install`, switches WiFi power saving off
(it delays incoming packets and trips the failsafe watchdog), and enables three services:

- `yonderrc-vehicle` — the control service + setup UI on port 8080
- `go2rtc` — the video server on port 1984
- `yonderrc-onboard` — WiFi hotspot fallback when the Pi is isolated

## 3. First boot / onboarding

- If the Pi joins a network you preconfigured, open `http://<pi-ip>:8080/setup`.
- If it has **no** network, it starts an **open** WiFi hotspot **`YonderRC-setup`**
  (no password, so the captive portal can open the page straight away). Join it and the
  setup page appears; otherwise open `http://192.168.4.1:8080/setup`.
  From there, **Setup › WiFi** scans for networks and joins one — the hotspot closes as
  soon as the Pi is on your WiFi. Set a hotspot password (and an API secret) in the same
  panel before the vehicle leaves the bench.

On the setup page you can set the vehicle name, output driver (sim / pca9685 /
gpio-pwm / sbus), cameras, watchdog, throttle channels, connect LTE (enter your
carrier APN), and bring up Tailscale.

## 4. LTE

Plug in the USB LTE stick. ModemManager detects it; enter your APN on the setup
page and press Connect. The APN is saved and auto-connects on future boots.

## 5. Tailscale (remote access over LTE)

Mobile carriers use CGNAT, so the vehicle has no public inbound IP. Tailscale puts
the vehicle and your ground PC/phone on the same private network so they can reach
each other anywhere.

- On the setup page, press **Bring up**. Without an auth key you get a login URL —
  open it and approve the device in your tailnet.
- Or paste a pre-generated **auth key** for hands-off setup.

Then, from the ground app, connect to the vehicle's Tailscale IP (shown on the
setup page), e.g. `ws://100.x.y.z:8080`. Video works the same way via
`http://100.x.y.z:1984`.

> For the lowest-latency WebRTC path over LTE you can later add a TURN server
> (coturn) on a cheap VPS; Tailscale alone already gives you a working, encrypted
> link and is the simplest thing that works.

## 6. Hardware drivers

The default driver is `sim` — unless the installer found a PCA9685 (§2), then it is
`pca9685` and `i2c-bus` is already built. Switch it on the setup page (or via
`YRC_DRIVER`; a saved setting wins over the variable). The native libraries are optional —
install only what you use, from the setup page (*Native driver modules*) or here:

```bash
cd /opt/yonderrc
npm install i2c-bus      -w @yonderrc/vehicle   # PCA9685
npm install pigpio       -w @yonderrc/vehicle   # GPIO PWM (also: sudo apt install pigpio)
npm install serialport   -w @yonderrc/vehicle   # SBUS
```

## 7. Running as a non-root user (optional hardening)

The shipped `yonderrc-vehicle.service` runs as **`User=root`** (pigpio needs root
for DMA PWM). If you instead run it as a **non-root user**, the vehicle's privileged
helpers — SIM-PIN unlock (`mmcli`), WireGuard (`wg`/`wg-quick`), ZeroTier
(`zerotier-cli`), OpenVPN (`systemctl … openvpn-client@yonderrc`), placing the WireGuard
conf and the OpenVPN profile (`install`) and the reboot button — need passwordless sudo.
The diagnostics export also reads the journal, which needs the `systemd-journal` group. A ready-made, minimal policy ships in
[`provisioning/yonderrc.sudoers`](yonderrc.sudoers):

```bash
sudo cp /opt/yonderrc/provisioning/yonderrc.sudoers /etc/sudoers.d/yonderrc
# replace "yonderrc" with your service user if different:
sudo sed -i 's/^yonderrc /YOURUSER /' /etc/sudoers.d/yonderrc
sudo chmod 0440 /etc/sudoers.d/yonderrc
sudo visudo -cf /etc/sudoers.d/yonderrc      # must print ": parsed OK"
```

It grants NOPASSWD only for that fixed command set. NetworkManager (`nmcli`) is
deliberately not in it — grant that to the user via polkit or the `netdev` group.
When running as root (the default) this file is not needed. See the header of the
file for the security note about `install`.

## Building a ready-made image (optional)

For flashing many vehicles, bake the above into a `.img` with
[`rpi-image-gen`](https://github.com/RPi-Distro/rpi-image-gen) or `pi-gen`, adding
this repo to `/opt/yonderrc` and running `install.sh` in a customization stage.
For a single build, the flash-then-`install.sh` path above is simplest.
