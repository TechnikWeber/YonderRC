#!/usr/bin/env bash
# YonderRC onboarding: if the Pi has no usable network shortly after boot (no LTE,
# no known WiFi), bring up a NetworkManager hotspot so you can reach the setup UI
# headless at http://192.168.4.1:8080/setup. Once you configure WiFi/LTE via the
# UI and reboot, normal connectivity takes over and the hotspot won't start.
set -uo pipefail

SSID="YonderRC-setup"
PASS="yonderrc123"
IFACE="wlan0"

# Give normal connections a chance first.
sleep 25

have_route() { ip route | grep -q '^default'; }
lte_up() { mmcli -L 2>/dev/null | grep -q 'Modem/'; }

if have_route; then
  echo "[onboard] network present — no hotspot needed"
  exit 0
fi

echo "[onboard] no default route — starting hotspot $SSID on $IFACE"
nmcli device wifi hotspot ifname "$IFACE" ssid "$SSID" password "$PASS" || {
  echo "[onboard] hotspot failed (is $IFACE available?)"
  exit 0
}
# NetworkManager assigns 10.42.0.1 by default for shared mode; pin a friendly one.
nmcli connection modify Hotspot ipv4.addresses 192.168.4.1/24 ipv4.method shared || true
nmcli connection up Hotspot || true

# Captive portal: make NetworkManager's dnsmasq resolve EVERY name to the Pi, so
# phones detect a captive portal and open the control/setup page automatically.
NMDIR=/etc/NetworkManager/dnsmasq-shared.d
sudo mkdir -p "$NMDIR"
echo 'address=/#/192.168.4.1' | sudo tee "$NMDIR/yonderrc-captive.conf" >/dev/null
nmcli connection down Hotspot 2>/dev/null || true
nmcli connection up Hotspot || true

echo "[onboard] hotspot up — connect and the control page opens at http://192.168.4.1:8080/"
