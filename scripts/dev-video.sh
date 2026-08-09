#!/usr/bin/env bash
# Download go2rtc (once) and run it with the YonderRC config so you can see the
# FPV test pattern + OSD in the ground app during development. Needs ffmpeg.
set -euo pipefail

cd "$(dirname "$0")/.."
BIN="./bin/go2rtc"
CFG="./docker/go2rtc.yaml"

if ! command -v ffmpeg >/dev/null; then
  echo "ffmpeg is required. On Fedora: sudo dnf install -y ffmpeg (see note below)."
  exit 1
fi

# go2rtc needs an H.264 encoder for browser WebRTC. Fedora's patent-free
# "ffmpeg-free" ships WITHOUT libx264, which makes the stream fail with a cryptic
# "Unknown encoder 'libx264'". Catch that here with a clear fix.
if ! ffmpeg -hide_banner -encoders 2>/dev/null | grep -q 'libx264'; then
  echo
  echo "  ✗ Your ffmpeg has no libx264 encoder (common with Fedora 'ffmpeg-free')."
  echo "    go2rtc needs it for browser video. Install the full ffmpeg:"
  echo
  echo "      sudo dnf install -y https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-\$(rpm -E %fedora).noarch.rpm"
  echo "      sudo dnf install -y --allowerasing ffmpeg"
  echo
  echo "    Then re-run: npm run dev:video"
  echo
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
