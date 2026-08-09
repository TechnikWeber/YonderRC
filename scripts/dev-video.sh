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

# go2rtc needs an H.264 encoder for browser WebRTC. YonderRC auto-picks whichever
# ffmpeg has: libx264, Cisco's libopenh264 (in Fedora's ffmpeg-free!), or a Pi
# hardware encoder. Only bail if NONE is present.
ENCODERS=$(ffmpeg -hide_banner -encoders 2>/dev/null || true)
if ! echo "$ENCODERS" | grep -qE 'libx264|libopenh264|h264_v4l2m2m|h264_omx|h264_nvenc'; then
  echo
  echo "  ✗ Your ffmpeg has no usable H.264 encoder."
  echo "    Easiest on Fedora — install openh264 (patent-free, works with ffmpeg-free):"
  echo "      sudo dnf install -y openh264 ffmpeg-free"
  echo "    Or the full ffmpeg with libx264 via RPM Fusion:"
  echo "      sudo dnf install -y https://mirrors.rpmfusion.org/free/fedora/rpmfusion-free-release-\$(rpm -E %fedora).noarch.rpm"
  echo "      sudo dnf install -y --allowerasing ffmpeg"
  echo
  echo "    Then re-run: npm run dev:video"
  echo
  exit 1
fi
PICKED=$(echo "$ENCODERS" | grep -oE 'libx264|libopenh264|h264_v4l2m2m|h264_omx|h264_nvenc' | head -1)
echo "H.264 encoder available: $PICKED"

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
