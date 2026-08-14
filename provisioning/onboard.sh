#!/usr/bin/env bash
# YonderRC onboarding: if the Pi has no usable network shortly after boot (no LTE,
# no known WiFi), bring up a NetworkManager hotspot so you can reach the setup UI
# headless at http://192.168.4.1:8080/setup — and from there put the Pi on your
# WiFi (Setup › WiFi › Scan) or configure LTE. Once it has a normal connection the
# hotspot won't start again.
#
# The hotspot is OPEN by default: the captive portal then puts the setup page in
# front of you with nothing to type, and a default password published in a public
# README protected nothing anyway. Set one in Setup › WiFi › Setup hotspot (and an
# API secret) before the vehicle leaves the bench.
set -uo pipefail

CONFIG="${YRC_CONFIG:-/opt/yonderrc/yonderrc-config.json}"
IFACE="${YRC_WIFI_IFACE:-wlan0}"
SSID="YonderRC-setup"
PASS=""

# Read SSID/password from the persisted config, if the setup UI wrote any. Two
# separate lines, so an SSID with spaces survives; an empty line means "not set".
if [ -f "$CONFIG" ] && command -v python3 >/dev/null 2>&1; then
  mapfile -t cfg < <(python3 - "$CONFIG" <<'PY'
import json, sys
try:
    with open(sys.argv[1]) as f:
        h = (json.load(f) or {}).get('hotspot') or {}
except Exception:
    h = {}
print((h.get('ssid') or '').strip())
print((h.get('password') or '').strip())
PY
) || true
  [ -n "${cfg[0]:-}" ] && SSID="${cfg[0]}"
  [ -n "${cfg[1]:-}" ] && PASS="${cfg[1]}"
fi

# Give normal connections a chance first.
sleep 25

have_route() { ip route | grep -q '^default'; }

if have_route; then
  echo "[onboard] network present — no hotspot needed"
  exit 0
fi

if [ -n "$PASS" ] && [ "${#PASS}" -ge 8 ]; then
  echo "[onboard] no default route — starting WPA2 hotspot $SSID on $IFACE"
  nmcli device wifi hotspot ifname "$IFACE" ssid "$SSID" password "$PASS" || {
    echo "[onboard] hotspot failed (is $IFACE available?)"
    exit 0
  }
else
  echo "[onboard] no default route — starting OPEN hotspot $SSID on $IFACE"
  nmcli device wifi hotspot ifname "$IFACE" ssid "$SSID" || {
    echo "[onboard] hotspot failed (is $IFACE available?)"
    exit 0
  }
fi

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
