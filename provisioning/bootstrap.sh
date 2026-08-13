#!/usr/bin/env bash
#
# YonderRC one-line bootstrap: clone (or update) the repo into /opt/yonderrc and run
# the installer. Run it on a fresh Raspberry Pi OS Lite:
#
#   curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
#
set -euo pipefail

REPO_URL="${YRC_REPO_URL:-https://github.com/TechnikWeber/YonderRC.git}"
DEST="${YRC_DEST:-/opt/yonderrc}"

echo "== YonderRC bootstrap =="

if ! command -v git >/dev/null; then
  echo "-- installing git"
  sudo apt-get update && sudo apt-get install -y git
fi

if [ -d "$DEST/.git" ]; then
  echo "-- updating existing checkout at $DEST"
  sudo git -C "$DEST" pull --ff-only
else
  echo "-- cloning into $DEST"
  sudo mkdir -p "$DEST"
  sudo chown "$USER" "$DEST"
  git clone "$REPO_URL" "$DEST"
fi

echo "-- running installer"
sudo bash "$DEST/provisioning/install.sh"
