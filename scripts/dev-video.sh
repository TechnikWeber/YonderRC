#!/usr/bin/env bash
# Download go2rtc (once) and run it with the YonderRC config so you can see the
# FPV test pattern + OSD in the ground app during development. Needs ffmpeg.
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="./bin/go2rtc"
CFG="./docker/go2rtc.yaml"

if ! command -v ffmpeg >/dev/null; then
  echo "ffmpeg is required. On Fedora: sudo dnf install -y ffmpeg-free"
  exit 1
fi

if [ ! -x "$BIN" ]; then
  mkdir -p bin
  case "$(uname -m)" in
    x86_64) GOARCH=amd64 ;;
    aarch64|arm64) GOARCH=arm64 ;;
    armv7l) GOARCH=armv7 ;;
    *) GOARCH=amd64 ;;
  esac
  echo "Downloading go2rtc ($GOARCH)…"
  curl -fsSL -o "$BIN" "https://github.com/AlexxIT/go2rtc/releases/latest/download/go2rtc_linux_${GOARCH}"
  chmod +x "$BIN"
fi

echo "Starting go2rtc with $CFG (test pattern on stream 'test')…"
exec "$BIN" -config "$CFG"
