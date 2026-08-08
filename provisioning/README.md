# YonderRC vehicle provisioning (Raspberry Pi, headless)

Turns a Raspberry Pi into a headless YonderRC vehicle: control service, go2rtc
video, LTE, and Tailscale for remote access — configured from a phone/laptop via
a local web page, no screen or keyboard needed.

## 1. Flash

Flash **Raspberry Pi OS Lite (64-bit, Bookworm)** with Raspberry Pi Imager. In the
Imager settings, enable SSH and (optionally) preconfigure your home WiFi so the
first boot is reachable. Pi 4 or Pi Zero 2 W are the sweet spot (they have the
hardware H.264 encoder; the Pi 5 does not).

## 2. Copy the repo and install

```bash
sudo mkdir -p /opt/yonderrc
# copy this repository into /opt/yonderrc (scp, git clone, or a USB stick), then:
sudo bash /opt/yonderrc/provisioning/install.sh
```

`install.sh` installs Node, ffmpeg, NetworkManager, ModemManager, Tailscale and
go2rtc, does `npm install`, and enables three services:

- `yonderrc-vehicle` — the control service + setup UI on port 8080
- `go2rtc` — the video server on port 1984
- `yonderrc-onboard` — WiFi hotspot fallback when the Pi is isolated

## 3. First boot / onboarding

- If the Pi joins a network you preconfigured, open `http://<pi-ip>:8080/setup`.
- If it has **no** network, it starts a WiFi hotspot **`YonderRC-setup`**
  (password `yonderrc123`). Join it and open `http://192.168.4.1:8080/setup`.

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

The default driver is `sim`. Switch it on the setup page (or via `YRC_DRIVER`).
The native libraries are optional — install only what you use:

```bash
cd /opt/yonderrc
npm install i2c-bus      -w @yonderrc/vehicle   # PCA9685
npm install pigpio       -w @yonderrc/vehicle   # GPIO PWM (also: sudo apt install pigpio)
npm install serialport   -w @yonderrc/vehicle   # SBUS
```

## Building a ready-made image (optional)

For flashing many vehicles, bake the above into a `.img` with
[`rpi-image-gen`](https://github.com/RPi-Distro/rpi-image-gen) or `pi-gen`, adding
this repo to `/opt/yonderrc` and running `install.sh` in a customization stage.
For a single build, the flash-then-`install.sh` path above is simplest.
