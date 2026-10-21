#!/usr/bin/env bash
# YonderRC vehicle provisioning for Raspberry Pi OS Lite (tested on Bookworm).
# Flash Pi OS Lite, boot, copy this repo to /opt/yonderrc, then run:
#   sudo bash /opt/yonderrc/provisioning/install.sh
# Step by step, for a first install: docs/QUICKSTART.md
set -euo pipefail

REPO=/opt/yonderrc
echo "== YonderRC provisioning =="

# Root first: half the steps below install packages or write to /etc, and a run without
# sudo dies on the first of them with a permission error that names neither cause nor fix.
if [ "$(id -u)" -ne 0 ]; then
  echo "Run it with sudo:  sudo bash $0"
  exit 1
fi

# Everything — the services, the update button, the docs — expects the project in
# /opt/yonderrc. A copy anywhere else used to fail at "cd /opt/yonderrc" with nothing more
# to go on. When /opt/yonderrc does not exist yet, move this copy there; when it does and
# this is a different copy, say exactly what to do instead of guessing which one is right.
SRC="$REPO"
if [ -f "${BASH_SOURCE[0]:-}" ]; then
  SRC="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi
if [ "$SRC" != "$REPO" ]; then
  if [ ! -e "$REPO" ] || [ -z "$(ls -A "$REPO" 2>/dev/null)" ]; then
    echo "-- copying $SRC to $REPO (the services expect it there)"
    mkdir -p "$REPO"
    cp -a "$SRC/." "$REPO/"
    exec bash "$REPO/provisioning/install.sh" "$@"
  fi
  echo "This copy is in $SRC, but YonderRC lives in $REPO — and that folder already has content."
  echo "Either install the one in $REPO:      sudo bash $REPO/provisioning/install.sh"
  echo "or replace it with this copy:         sudo cp -a \"$SRC/.\" $REPO/   (keeps $REPO/yonderrc-config.json)"
  exit 1
fi
# The project root itself, not the folder around it — a GitHub ZIP unpacks into
# YonderRC-main/, and copying that folder one level too deep is the classic mistake.
if [ ! -f "$REPO/package.json" ] || [ ! -d "$REPO/packages/vehicle" ]; then
  echo "$REPO does not look like the YonderRC project (no package.json / packages/vehicle in it)."
  echo "Its content is:"; ls -A "$REPO" | head -20
  echo "Copy the CONTENT of the project folder (the one with package.json in it) to $REPO."
  exit 1
fi

echo "-- packages"
apt-get update
# wireguard-tools = wg / wg-quick for the WireGuard remote-access option (e.g. FritzBox).
# openvpn = the OpenVPN remote-access option (experimental, Setup > Remote access).
# usb-modeswitch = flips "Zero-CD" LTE dongles from storage mode into modem mode so
# ModemManager can see them (many Huawei/ZTE sticks need this).
# i2c-tools = i2cdetect for the setup page's "Detect hardware" probe.
# gpsd = optional GPS daemon (easiest path for USB GPS dongles).
# iw = WiFi signal and power-save state (OSD link signal, diagnostics).
apt-get install -y curl git ffmpeg network-manager modemmanager wireguard-tools openvpn usb-modeswitch i2c-tools gpsd iw

echo "-- Node.js 22"
if ! command -v node >/dev/null || [ "$(node -v | cut -c2-3)" -lt 20 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

echo "-- Tailscale"
if ! command -v tailscale >/dev/null; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi

echo "-- ZeroTier (optional remote-access method)"
if ! command -v zerotier-cli >/dev/null; then
  curl -fsSL https://install.zerotier.com | bash || echo "   (ZeroTier install skipped/failed — only needed if you pick ZeroTier)"
fi

echo "-- go2rtc"
if [ ! -x /usr/local/bin/go2rtc ]; then
  ARCH=$(dpkg --print-architecture) # arm64 / armhf
  case "$ARCH" in
    arm64) GOARCH=arm64 ;;
    armhf) [ "$(uname -m)" = armv6l ] && GOARCH=armv6 || GOARCH=arm ;; # asset names: go2rtc_linux_arm / _armv6
    *) GOARCH=amd64 ;;
  esac
  curl -fsSL -o /usr/local/bin/go2rtc \
    "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_${GOARCH}"
  chmod +x /usr/local/bin/go2rtc
fi

echo "-- npm install (sim by default; hardware driver deps are optional)"
cd "$REPO"
# --omit=optional keeps the native hardware drivers (i2c-bus/pigpio/serialport) out of a
# plain sim install — see HARDWARE.md 3.3. But the flag is *global*: it also drops the
# platform binaries that rollup and esbuild ship as their own optionalDependencies, and
# the ground build then dies with "Cannot find module @rollup/rollup-linux-arm64-gnu".
npm install --omit=optional
# ...so install the ground workspace once more with optional deps allowed. That adds only
# @rollup/rollup-<arch> and @esbuild/<arch> (incl. vite's nested esbuild) — the vehicle's
# hardware drivers stay out because that workspace is not selected here.
npm install --include-workspace-root -w @yonderrc/ground

CONFIG="${YRC_CONFIG:-$REPO/yonderrc-config.json}"

# The native modules compile on the Pi; Raspberry Pi OS Lite does not always ship a
# compiler, and npm then fails with a node-gyp message nobody can read.
ensure_build_tools() {
  if ! command -v make >/dev/null 2>&1 || ! command -v g++ >/dev/null 2>&1; then
    echo "-- build tools for native driver modules (make, g++)"
    apt-get install -y build-essential python3 ||
      echo "   (could not install build-essential — native driver modules will not build)"
  fi
}

# Native driver modules the operator installed from the setup UI (Setup > Vehicle
# configuration > Native driver modules) — or that hardware detection below asked for —
# are optionalDependencies too, so `--omit=optional` just pruned them. Put back exactly
# the ones this vehicle recorded: an update must not silently turn a configured vehicle
# back into a simulator.
restore_hw_deps() {
  [ -f "$CONFIG" ] && command -v python3 >/dev/null 2>&1 || return 0
  local deps
  deps=$(python3 - "$CONFIG" <<'PY'
import json, sys
ALLOWED = {'i2c-bus', 'pigpio', 'serialport'}   # mirrors hwDeps.ts
try:
    with open(sys.argv[1]) as f:
        deps = (json.load(f) or {}).get('hardwareDeps') or []
except Exception:
    deps = []
print(' '.join(sorted(d for d in deps if d in ALLOWED)))
PY
) || deps=""
  [ -n "$deps" ] || return 0
  ensure_build_tools
  for dep in $deps; do
    if [ -d "$REPO/node_modules/$dep" ]; then continue; fi
    echo "-- installing native driver module: $dep"
    npm install "$dep" -w @yonderrc/vehicle --no-audit --no-fund ||
      echo "   ($dep failed to build — reinstall it in Setup > Sensors & outputs, it shows why)"
  done
}
restore_hw_deps

echo "-- build the ground control app (so a phone can fly/configure via the Pi)"
if ! npm run build -w @yonderrc/ground; then
  echo "   build failed — retrying once with a full install (incl. all optional deps)"
  npm install
  npm run build -w @yonderrc/ground
fi

echo "-- hardware access groups (I2C / GPIO / serial)"
usermod -aG i2c,gpio,dialout "${SUDO_USER:-pi}" || true
# Enable I2C + UART on the Pi if raspi-config is present:
if command -v raspi-config >/dev/null; then
  raspi-config nonint do_i2c 0 || true
  raspi-config nonint do_serial_hw 0 || true
  # ...and take the LOGIN CONSOLE off that same UART. Enabling the hardware alone was
  # only half the job: Raspberry Pi OS pins a getty to the header UART by default, so a
  # wired GPS shares its line with kernel messages and its sentences arrive shredded —
  # which looks exactly like bad wiring. `do_serial_cons 1` = console off.
  raspi-config nonint do_serial_cons 1 2>/dev/null ||
    echo "   (this raspi-config has no do_serial_cons — free the port in Setup > GPS instead)"
  systemctl disable --now serial-getty@ttyAMA0.service serial-getty@ttyS0.service 2>/dev/null || true
fi

echo "-- WiFi power saving off"
# With power saving on, the Pi's WiFi holds incoming packets back for up to a few hundred
# ms and then delivers them in a burst. Control frames arrive late, all at once, and the
# vehicle flickers in and out of failsafe on a perfectly good network. The hotspot (AP
# mode) is not affected; a WiFi client connection is.
install -d -m 0755 /etc/NetworkManager/conf.d
cat > /etc/NetworkManager/conf.d/yonderrc-wifi-powersave.conf <<'EOF'
# Written by YonderRC's install.sh — 2 = power saving off for every WiFi connection.
# Power saving delays incoming packets by up to a few hundred ms, which trips the
# vehicle's failsafe watchdog on a working link.
[connection]
wifi.powersave = 2
EOF
nmcli general reload conf 2>/dev/null || true
iw dev wlan0 set power_save off 2>/dev/null || true

echo "-- hardware detection (fills in only what was never saved)"
# Wired and addressed BEFORE this step, a PCA9685 becomes the output driver and a camera
# module replaces the test pattern — see docs/QUICKSTART.md. A setting that is already in
# the config is never changed, so re-running the installer cannot undo a choice.
modprobe i2c-dev 2>/dev/null || true
if [ ! -e /dev/i2c-1 ] && command -v raspi-config >/dev/null; then
  # raspi-config switches I²C on for the running system too, but not on every image —
  # then the bus only appears after a reboot, and a probe now would find nothing.
  echo "   I²C bus 1 is not active yet — it appears after a reboot. Reboot and run this"
  echo "   installer once more to have a PCA9685 detected (the camera is checked now)."
fi
YRC_CONFIG="$CONFIG" npm run --silent first-run -w @yonderrc/vehicle ||
  echo "   (detection did not run — pick the driver and the camera in the setup page)"
restore_hw_deps

echo "-- runtime state directory (generated video config lives outside the checkout)"
# go2rtc's config is generated by the vehicle from the camera settings. It used to be
# written into docker/go2rtc.yaml inside the git checkout, which left every running
# vehicle with local modifications and blocked `git pull --ff-only` — including the
# update button in the setup page. Move it once, seed it from whatever is there now so
# go2rtc keeps its streams, and restore the checkout.
install -d -m 0755 /var/lib/yonderrc
if [ ! -f /var/lib/yonderrc/go2rtc.yaml ] && [ -f "$REPO/docker/go2rtc.yaml" ]; then
  cp "$REPO/docker/go2rtc.yaml" /var/lib/yonderrc/go2rtc.yaml
  echo "   (migrated the existing go2rtc config to /var/lib/yonderrc/)"
fi
if [ -d "$REPO/.git" ]; then
  git -c safe.directory="$REPO" -C "$REPO" checkout -- docker/go2rtc.yaml 2>/dev/null || true
fi

# Camera tuning files. Raspberry Pi's stock imx519.json has no rpi.af algorithm, so an
# Arducam 16MP stays permanently out of focus; ours adds it. Copied out of the checkout
# so a camera can point at a stable path that survives an update.
install -d -m 0755 /var/lib/yonderrc/tuning
cp "$REPO/provisioning/tuning/"*.json /var/lib/yonderrc/tuning/ 2>/dev/null || true

echo "-- systemd services"
cp "$REPO/provisioning/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now go2rtc.service yonderrc-vehicle.service
# The onboarding hotspot is a oneshot fallback (it exits right away when the Pi already
# has a network). Never let it abort provisioning — the vehicle service is what matters.
systemctl enable --now yonderrc-onboard.service ||
  echo "   (onboard hotspot service did not start — check: journalctl -u yonderrc-onboard)"
# `enable --now` starts what is stopped but leaves running services on their OLD unit,
# so a changed ExecStart or Environment= would only take effect at the next reboot.
systemctl try-restart go2rtc.service yonderrc-vehicle.service || true

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "== Done =="
echo "Setup page:   http://$(hostname).local:8080/setup   (or http://${IP:-<pi-ip>}:8080/setup)"
echo "Control app:  http://$(hostname).local:8080/"
echo "If the Pi has no network, it starts an OPEN WiFi hotspot 'YonderRC-setup'"
echo "— join it; the captive portal opens http://192.168.4.1:8080/setup"
echo "There, Setup > WiFi scans and joins your network (and sets a hotspot password)."
echo "Something not working? Setup > Overview > Problem report — or: sudo bash $REPO/provisioning/diag.sh"
