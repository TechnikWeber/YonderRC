#!/usr/bin/env bash
# YonderRC vehicle provisioning for Raspberry Pi OS Lite (Bookworm).
# Flash Pi OS Lite, boot, copy this repo to /opt/yonderrc, then run:
#   sudo bash /opt/yonderrc/provisioning/install.sh
set -euo pipefail

REPO=/opt/yonderrc
echo "== YonderRC provisioning =="

echo "-- packages"
apt-get update
# wireguard-tools = wg / wg-quick for the WireGuard remote-access option (e.g. FritzBox).
# usb-modeswitch = flips "Zero-CD" LTE dongles from storage mode into modem mode so
# ModemManager can see them (many Huawei/ZTE sticks need this).
apt-get install -y curl git ffmpeg network-manager modemmanager wireguard-tools usb-modeswitch

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
    armhf) GOARCH=armv7 ;;
    *) GOARCH=amd64 ;;
  esac
  curl -fsSL -o /usr/local/bin/go2rtc \
    "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_${GOARCH}"
  chmod +x /usr/local/bin/go2rtc
fi

echo "-- npm install (sim by default; hardware driver deps are optional)"
cd "$REPO"
npm install --omit=optional

echo "-- build the ground control app (so a phone can fly/configure via the Pi)"
npm run build -w @yonderrc/ground

echo "-- hardware access groups (I2C / GPIO / serial)"
usermod -aG i2c,gpio,dialout "${SUDO_USER:-pi}" || true
# Enable I2C + UART on the Pi if raspi-config is present:
if command -v raspi-config >/dev/null; then
  raspi-config nonint do_i2c 0 || true
  raspi-config nonint do_serial_hw 0 || true
fi

echo "-- systemd services"
cp "$REPO/provisioning/systemd/"*.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now go2rtc.service yonderrc-vehicle.service yonderrc-onboard.service

echo
echo "== Done =="
echo "Setup UI:   http://<pi-ip>:8080/setup"
echo "If the Pi has no network, it starts a WiFi hotspot 'YonderRC-setup'"
echo "(password yonderrc123) — join it and open http://192.168.4.1:8080/setup"
