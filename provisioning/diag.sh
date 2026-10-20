#!/usr/bin/env bash
# YonderRC diagnostics from a terminal — for when the setup page itself is not reachable
# (the service does not start, the Pi is only reachable over SSH).
#
#   sudo bash /opt/yonderrc/provisioning/diag.sh
#
# Writes ONE text file into the home directory of the user who ran it and prints where.
# Passwords, PINs, keys, the API secret and GPS positions are masked. When the vehicle
# service is running, its own diagnostics report (the same as Setup > Problem report) is
# included as well. How to send the file: docs/TROUBLESHOOTING.md.
set -uo pipefail

REPO=/opt/yonderrc
CONFIG="${YRC_CONFIG:-$REPO/yonderrc-config.json}"
OWNER="${SUDO_USER:-$(id -un)}"
HOME_DIR="$(getent passwd "$OWNER" | cut -d: -f6)"
[ -d "$HOME_DIR" ] || HOME_DIR=/tmp
OUT="$HOME_DIR/yonderrc-diagnostics-$(hostname)-$(date +%Y%m%d-%H%M).txt"

if [ "$(id -u)" -ne 0 ]; then
  echo "Run it with sudo, or the journal and the hardware are not readable:  sudo bash $0"
  exit 1
fi

# The same masks as the vehicle's own report (vehicle/src/system/diagnostics.ts), in sed.
mask() {
  sed -E \
    -e 's/-----BEGIN ([A-Z ]*)PRIVATE KEY-----.*/-----BEGIN \1PRIVATE KEY----- (redacted)/' \
    -e 's/tskey-[A-Za-z0-9_-]+/tskey-***/g' \
    -e 's#(login\.tailscale\.com/a/)[A-Za-z0-9]+#\1***#g' \
    -e 's#([a-z][a-z0-9+.-]*://)[^/@: ]+:[^/@ ]+@#\1***@#gI' \
    -e 's/(--(pin|change-pin|authkey|password|secret)=)[^[:space:]]+/\1***/gI' \
    -e 's/(WPA2?,? +key +)[^)[:space:]]+/\1***/gI' \
    -e 's/\b([A-Za-z0-9_.-]*(key|psk|passwd|password|secret|token|pin))([[:space:]]*[:=][[:space:]]*)("[^"]*"|[^[:space:],;&)]+)/\1\3***/gI' \
    -e 's/-?[0-9]{1,3}\.[0-9]{4,}[[:space:]]*,[[:space:]]*-?[0-9]{1,3}\.[0-9]{4,}/(position)/g'
}

section() { printf '\n===== %s =====\n' "$1"; }
# Run a command, label it, keep its error output, cap its length, mask it.
cmd() {
  local limit="$1"; shift
  printf '$ %s\n' "$*"
  "$@" 2>&1 | tail -n "$limit" | mask
}

{
  echo "YonderRC diagnostics (terminal) — $(date -Iseconds)"
  echo "Passwords, PINs, keys, the API secret and GPS positions are masked."

  section "Software"
  echo "version: $(sed -n 's/^ *"version": *"\([^"]*\)".*/\1/p' "$REPO/package.json" 2>/dev/null | head -1)"
  cmd 3 git -c safe.directory="$REPO" -C "$REPO" log -1 --format='commit %h %cd %s' --date=short
  cmd 30 git -c safe.directory="$REPO" -C "$REPO" status --short
  cmd 3 node -v
  cmd 30 ls -A "$REPO"

  section "System"
  cmd 2 sh -c 'tr -d "\0" < /proc/device-tree/model; echo'
  cmd 5 sh -c 'grep PRETTY_NAME /etc/os-release'
  cmd 2 uname -srm
  cmd 2 uptime
  cmd 5 free -m
  cmd 5 df -h /
  cmd 2 vcgencmd get_throttled
  cmd 2 vcgencmd measure_temp

  section "Services"
  cmd 40 systemctl --no-pager -l status yonderrc-vehicle.service
  cmd 15 systemctl --no-pager -l status go2rtc.service
  cmd 10 systemctl --no-pager -l status yonderrc-onboard.service
  cmd 10 systemctl --no-pager -l status openvpn-client@yonderrc.service

  section "The vehicle's own report (GET /api/diagnostics)"
  SECRET=""
  if [ -f "$CONFIG" ] && command -v python3 >/dev/null 2>&1; then
    SECRET=$(python3 -c 'import json,sys; print((json.load(open(sys.argv[1])) or {}).get("apiSecret") or "")' "$CONFIG" 2>/dev/null || true)
  fi
  if REPORT=$(curl -fsS --max-time 30 -H "x-yonderrc-secret: $SECRET" http://127.0.0.1:8080/api/diagnostics 2>&1); then
    printf '%s\n' "$REPORT" | mask
  else
    echo "(no answer from the vehicle service: $REPORT)"
  fi

  section "Stored configuration (secrets masked)"
  if [ -f "$CONFIG" ] && command -v python3 >/dev/null 2>&1; then
    python3 - "$CONFIG" <<'PY' | mask
import json, re, sys
SECRET = re.compile(r'(secret|password|passwd|psk|pin|authkey|privatekey|presharedkey|token)$', re.I)
BLOCKS = ['key', 'tls-auth', 'tls-crypt', 'tls-crypt-v2', 'pkcs12', 'secret', 'auth-user-pass']
def scrub(s):
    # An uploaded VPN profile: key material inline, the rest is what helps debugging.
    for t in BLOCKS:
        s = re.sub(r'<%s>[\s\S]*?</%s>' % (re.escape(t), re.escape(t)), '<%s>(redacted)</%s>' % (t, t), s, flags=re.I)
    s = re.sub(r'-----BEGIN ([A-Z0-9 ]*)PRIVATE KEY-----[\s\S]*?-----END \1PRIVATE KEY-----', '(private key redacted)', s)
    return re.sub(r'(?im)^(\s*(?:PrivateKey|PresharedKey)\s*=\s*).*$', r'\1***', s)
def walk(v, key=''):
    if isinstance(v, dict):
        return {k: ('(set — position not exported)' if k == 'home' and isinstance(x, dict) else walk(x, k)) for k, x in v.items()}
    if isinstance(v, list):
        return [walk(x) for x in v]
    if SECRET.search(key) and v not in (None, '', True, False):
        return '(set)'
    if isinstance(v, str) and key.lower().endswith('conf'):
        return scrub(v)
    return v
try:
    print(json.dumps(walk(json.load(open(sys.argv[1]))), indent=2, ensure_ascii=False))
except Exception as e:
    print(f'(could not read {sys.argv[1]}: {e})')
PY
  else
    echo "(no config file at $CONFIG — every setting is at its default)"
  fi

  section "Network"
  cmd 30 ip -br addr
  cmd 20 ip route
  cmd 20 nmcli -t -f DEVICE,TYPE,STATE,CONNECTION device
  cmd 15 iw dev wlan0 link
  cmd 2 iw dev wlan0 get power_save
  cmd 10 mmcli -L

  section "I²C bus 1"
  if systemctl is-active --quiet yonderrc-vehicle.service; then
    echo "(skipped while the vehicle service runs — its report above has the scan when disarmed)"
  else
    cmd 12 i2cdetect -y 1
  fi

  section "Journal: yonderrc-vehicle (this boot)"
  cmd 400 journalctl -u yonderrc-vehicle --boot=0 --no-pager -o short-iso
  section "Journal: yonderrc-vehicle (previous boot — why did it restart?)"
  cmd 80 journalctl -u yonderrc-vehicle --boot=-1 --no-pager -o short-iso
  section "Journal: go2rtc"
  cmd 100 journalctl -u go2rtc --boot=0 --no-pager -o short-iso
  section "Journal: yonderrc-onboard"
  cmd 50 journalctl -u yonderrc-onboard --boot=0 --no-pager -o short-iso
  section "Kernel: power, WiFi, USB, I²C"
  journalctl -k --boot=0 --no-pager -o short-iso 2>&1 |
    grep -iE 'under-?voltage|voltage normali[sz]ed|brcmf|wlan0|firmware|usb [0-9]+-[0-9.]+: (USB disconnect|reset)|throttl|oom|out of memory|i2c|mmc0.*(error|timeout)|EXT4-fs error' |
    tail -n 100 | mask
} > "$OUT" 2>&1

chown "$OWNER" "$OUT" 2>/dev/null || true
echo "Saved: $OUT ($(wc -c < "$OUT") bytes)"
echo
echo "Copy it to your computer, e.g. from a Windows/macOS/Linux terminal:"
echo "  scp $OWNER@$(hostname).local:$OUT ."
echo "(or with WinSCP/FileZilla over SFTP), then attach it to a GitHub issue:"
echo "  https://github.com/TechnikWeber/YonderRC/issues/new"
