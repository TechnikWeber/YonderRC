**English** · [Deutsch](README.de.md)

# YonderRC vehicle provisioning (Raspberry Pi, headless)

Everything in this folder runs **on the Pi** — nothing here is meant for your PC. It turns
a Raspberry Pi into a headless YonderRC vehicle: control service, go2rtc video, hotspot
onboarding, remote access — configured from a phone or laptop through the vehicle's own
setup page.

- **First install, step by step:** [`docs/QUICKSTART.md`](../docs/QUICKSTART.md)
- **Wiring, LTE, Tailscale, everything after the install:** [`docs/HARDWARE.md`](../docs/HARDWARE.md)
- **When something does not work:** [`docs/TROUBLESHOOTING.md`](../docs/TROUBLESHOOTING.md)

This page only describes the files themselves.

## 1. The files

| File | What it does |
|---|---|
| `bootstrap.sh` | the one-liner: clone to `/opt/yonderrc` (or update it), then run `install.sh` |
| `install.sh` | everything the Pi needs — see §2; safe to run again after every update |
| `diag.sh` | diagnostics file from a terminal, for when the setup page is not reachable (§3) |
| `onboard.sh` | boot-time hotspot fallback, run by `yonderrc-onboard.service` |
| `systemd/` | `yonderrc-vehicle` (control + setup page, port 8080), `go2rtc` (video, port 1984), `yonderrc-onboard` |
| `tuning/` | camera tuning files (Arducam IMX519 autofocus), copied to `/var/lib/yonderrc/tuning` |
| `yonderrc.sudoers` | only for running the service as a non-root user (§4) |

## 2. What install.sh does

```bash
sudo bash /opt/yonderrc/provisioning/install.sh
```

1. Checks that it runs as root and that the project is in `/opt/yonderrc`. A copy elsewhere
   is moved there when `/opt/yonderrc` does not exist yet; otherwise it says what to do.
2. Installs the packages (ffmpeg, NetworkManager, ModemManager, WireGuard, OpenVPN,
   i2c-tools, gpsd, iw), Node 22, Tailscale, ZeroTier and go2rtc.
3. `npm install` without the native driver modules, then restores the ones this vehicle
   recorded (`hardwareDeps` in the config) — an update never turns a configured vehicle
   back into a simulator. Builds the control app.
4. Enables I²C and the UART and takes the login console off the UART (for a wired GPS).
5. Switches **WiFi power saving off** — it delays incoming packets and trips the failsafe
   watchdog on a working link.
6. **Hardware detection** (`npm run first-run -w @yonderrc/vehicle`): a PCA9685 on bus 1
   becomes the output driver and `i2c-bus` is built, a CSI camera replaces the test
   pattern. Only settings that were **never saved** are filled in; sensors are named, not
   configured. Wire and address the hardware **before** installing (a PCA9685 next to an
   INA2xx on `0x41`).
7. Moves the generated video config to `/var/lib/yonderrc`, installs and (re)starts the
   three services.

The config lives in `/opt/yonderrc/yonderrc-config.json` (`YRC_CONFIG` overrides it).

## 3. diag.sh

```bash
sudo bash /opt/yonderrc/provisioning/diag.sh
```

Writes one text file into the home folder of the user who ran it: versions, service
states, the vehicle's own diagnostics report (if the service answers), the stored config,
network, journals and kernel messages. Passwords, keys, the API secret and GPS positions
are masked. How to get it off the Pi and send it:
[`docs/TROUBLESHOOTING.md` §1](../docs/TROUBLESHOOTING.md#1-reporting-a-problem-the-diagnostics-file).

## 4. Running as a non-root user (optional hardening)

The shipped `yonderrc-vehicle.service` runs as **`User=root`** (pigpio needs root
for DMA PWM). If you instead run it as a **non-root user**, the vehicle's privileged
helpers — SIM-PIN unlock (`mmcli`), WireGuard (`wg`/`wg-quick`), ZeroTier
(`zerotier-cli`), OpenVPN (`systemctl … openvpn-client@yonderrc`), placing the WireGuard
conf and the OpenVPN profile (`install`) and the reboot button — need passwordless sudo.
The diagnostics export also reads the journal, which needs the `systemd-journal` group.
A ready-made, minimal policy ships in [`yonderrc.sudoers`](yonderrc.sudoers):

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

## 5. Building a ready-made image (optional)

For flashing many vehicles, bake the above into a `.img` with
[`rpi-image-gen`](https://github.com/RPi-Distro/rpi-image-gen) or `pi-gen`, adding
this repo to `/opt/yonderrc` and running `install.sh` in a customization stage.
Hardware detection then finds nothing (the image is built without the vehicle) — run
`install.sh` once more on the vehicle, or pick driver and camera in the setup page.
For a single build, the flash-then-`install.sh` path is simplest.
