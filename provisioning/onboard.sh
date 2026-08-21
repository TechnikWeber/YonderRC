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
MODE="auto"   # auto | always | off — see HotspotConfig.mode

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
print((h.get('mode') or '').strip())
PY
) || true
  [ -n "${cfg[0]:-}" ] && SSID="${cfg[0]}"
  [ -n "${cfg[1]:-}" ] && PASS="${cfg[1]}"
  [ -n "${cfg[2]:-}" ] && MODE="${cfg[2]}"
fi

# Give normal connections a chance first.
sleep 25

have_route() { ip route | grep -q '^default'; }
# Is wlan0 joined to a normal network (i.e. NOT our own Hotspot profile)? One radio
# can't serve an AP and stay joined, and tearing that link down would cut the vehicle
# off the LAN — so a WiFi client connection always wins over "always".
wifi_is_client() {
  nmcli -t -f DEVICE,STATE,CONNECTION device 2>/dev/null |
    awk -F: -v i="$IFACE" '$1==i && $2=="connected" && $3!="Hotspot" { found=1 } END { exit !found }'
}

if [ "$MODE" = "off" ]; then
  echo "[onboard] hotspot disabled in the config — nothing to do"
  exit 0
fi

if wifi_is_client; then
  echo "[onboard] $IFACE is joined to a WiFi network — no hotspot (one radio)"
  exit 0
fi

if [ "$MODE" = "always" ]; then
  echo "[onboard] hotspot mode 'always' — starting it regardless of the uplink"
elif have_route; then
  echo "[onboard] network present — no hotspot needed"
  exit 0
fi

# The radio first. Raspberry Pi OS keeps WiFi rfkill-blocked until a regulatory
# country is set, and NetworkManager then reports wlan0 as "unavailable" — with
# that, no hotspot can ever start. Mirrors RealSystem.wifiRadioEnable().
if rfkill list wifi 2>/dev/null | grep -qi 'soft blocked: *yes'; then
  echo "[onboard] WiFi radio is soft-blocked — unblocking"
  rfkill unblock wifi || true
fi
if ! iw reg get 2>/dev/null | grep -qE 'country [A-Z]{2}:'; then
  # Only the locale is used here (the service also knows the timezone); a wrong
  # guess is corrected in Setup > WiFi, no guess means no radio at all.
  CC=$(sed -n 's/^LANG="\?[a-z]\{2,3\}_\([A-Z]\{2\}\).*/\1/p' /etc/default/locale 2>/dev/null | head -1)
  if [ -n "${CC:-}" ] && command -v raspi-config >/dev/null 2>&1; then
    echo "[onboard] no WiFi country set — setting $CC from this Pi's locale"
    raspi-config nonint do_wifi_country "$CC" || true
    rfkill unblock wifi || true
  else
    echo "[onboard] no WiFi country set and none derivable — set it in Setup > WiFi"
  fi
fi

# Build the profile explicitly. `nmcli device wifi hotspot` ALWAYS secures the AP:
# "If not provided, nmcli will generate a password" — so the OPEN onboarding hotspot
# this script promises was never open, and nobody could join it. Mirrors
# hotspotCommands() in vehicle/system/wifi.ts.
nmcli connection delete Hotspot >/dev/null 2>&1 || true
if ! nmcli connection add type wifi ifname "$IFACE" con-name Hotspot autoconnect no ssid "$SSID" \
    802-11-wireless.mode ap 802-11-wireless.band bg ipv4.method shared ipv4.addresses 192.168.4.1/24; then
  echo "[onboard] could not create the hotspot profile (is $IFACE available?)"
  exit 0
fi

if [ -n "$PASS" ] && [ "${#PASS}" -ge 8 ]; then
  echo "[onboard] starting WPA2 hotspot $SSID on $IFACE"
  nmcli connection modify Hotspot \
    wifi-sec.key-mgmt wpa-psk wifi-sec.psk "$PASS" \
    wifi-sec.proto rsn wifi-sec.pairwise ccmp wifi-sec.group ccmp || true
else
  echo "[onboard] starting OPEN hotspot $SSID on $IFACE"
fi

# Captive portal: make NetworkManager's dnsmasq resolve EVERY name to the Pi, so
# phones detect a captive portal and open the control/setup page by themselves.
# ONLY without an uplink: with one (Ethernet on the bench, LTE in the field) the
# hotspot shares real internet, and hijacking DNS would break it for every client
# while the portal would be pointless. Written BEFORE the profile comes up, so
# dnsmasq starts with it. Mirrors shouldHijackDns() in vehicle/system/wifi.ts.
NMDIR=/etc/NetworkManager/dnsmasq-shared.d
CAPTIVE="$NMDIR/yonderrc-captive.conf"
if have_route; then
  rm -f "$CAPTIVE"
  echo "[onboard] uplink present — sharing it, DNS left alone (no captive portal)"
else
  mkdir -p "$NMDIR"
  echo 'address=/#/192.168.4.1' > "$CAPTIVE"
fi

nmcli connection up Hotspot || {
  echo "[onboard] hotspot failed to start (is $IFACE available? 'rfkill list wifi')"
  exit 0
}

if [ -f "$CAPTIVE" ]; then
  echo "[onboard] hotspot up — connect and the control page opens by itself (http://192.168.4.1:8080/)"
else
  echo "[onboard] hotspot up — connect and open http://192.168.4.1:8080/ (uplink shared, no auto-open)"
fi
