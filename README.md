# YonderRC

<p>
  <img alt="Status: stable" src="https://img.shields.io/badge/status-stable-brightgreen">
  <a href="https://github.com/TechnikWeber/YonderRC/releases/latest"><img alt="Download" src="https://img.shields.io/github/v/release/TechnikWeber/YonderRC?include_prereleases&label=download&color=2ea44f"></a>
  <a href="https://github.com/TechnikWeber/YonderRC/releases"><img alt="Downloads" src="https://img.shields.io/github/downloads/TechnikWeber/YonderRC/total?color=blue"></a>
  <a href="https://github.com/TechnikWeber/YonderRC/stargazers"><img alt="Stars" src="https://img.shields.io/github/stars/TechnikWeber/YonderRC?style=flat&color=yellow"></a>
  <a href="https://github.com/TechnikWeber/YonderRC/actions/workflows/ci.yml"><img alt="tests" src="https://img.shields.io/github/actions/workflow/status/TechnikWeber/YonderRC/ci.yml?branch=main&label=tests"></a>
  <img alt="Platform: Raspberry Pi | browser | Windows | Linux" src="https://img.shields.io/badge/platform-Raspberry%20Pi%20%7C%20browser%20%7C%20Windows%20%7C%20Linux-blue">
  <img alt="UI: English" src="https://img.shields.io/badge/UI-English-informational">
  <a href="LICENSE"><img alt="License: PolyForm NC 1.0.0 + no military" src="https://img.shields.io/badge/license-PolyForm%20NC%201.0.0%20%2B%20no%20military-lightgrey"></a>
</p>

Remote control over the internet for RC cars, boats, planes and drones — with live video,
telemetry and settings in the browser. A Raspberry Pi in the vehicle, a browser, phone or
desktop app on the ground. Built for LTE.

Everything also runs **in a simulator, with no hardware**.

![Ground station while driving: FPV video with a full OSD — GPS fix and home compass with distance, odometer and speed top left, battery bar top right, voltage/current/mAh bottom right, link health score top centre](docs/screenshots/Overview_OSD.png?v=6)

**Contents:** [What it does](#what-it-does) · [Get started](#get-started) · [Try it in the simulator](#try-it-in-the-simulator) · [Desktop app](#desktop-app) · [How this code was written](#how-this-code-was-written) · [Safety & legal](#safety--legal) · [License](#license)

## What it does

- **Drive from anywhere**: 16 channels, low-latency FPV video (WebRTC), over LTE, Wi-Fi
  or a VPN.
- **Safe by default**: failsafe after 500 ms without a signal — the vehicle stops, holds
  or cuts the motor, depending on its type. Hold to arm, panic-disarm, pre-arm check.
- **Any input**: touch sticks on a phone, keyboard, gamepad, or an RC transmitter in
  joystick mode.
- **Models** for car, boat, plane and drone with ready channel templates; trim, expo,
  endpoints, curves, follower channels and a speed limiter.
- **Telemetry**: battery voltage, current, mAh, temperatures, GPS with the way home, voice
  callouts, a blackbox log.
- **Vehicle setup on the vehicle itself**: Wi-Fi, LTE, remote access (Tailscale, ZeroTier,
  WireGuard), cameras, sensors, updates, a shell on the Pi — from a phone, no screen on the
  Pi. Models and controls live in the ground app's **Ground setup**.
- **Problem report in one file** that says in plain words what went wrong.

The full list: [`docs/FEATURES.md`](docs/FEATURES.md).

## Get started

| You want to … | Read |
| --- | --- |
| try it without hardware | [the simulator](#try-it-in-the-simulator), below |
| build a vehicle, step by step | [`docs/QUICKSTART.md`](docs/QUICKSTART.md) |
| see parts, wiring, LTE and remote access | [`docs/HARDWARE.md`](docs/HARDWARE.md) |
| fix something that does not work | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |
| control from a desktop program | [the desktop app](#desktop-app), below |

On a Raspberry Pi with the hardware connected, one line installs everything:

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

Then open the Vehicle setup at `http://<pi-ip>:8080/setup`.

## Try it in the simulator

Runs on Windows, Linux and macOS. You need [Node.js](https://nodejs.org) 20.19 or newer
(npm comes with it) and [Git](https://git-scm.com); for video also `ffmpeg`. No compiler:
the hardware drivers are optional and are skipped on a PC.

| System | Install once |
| --- | --- |
| Windows | `winget install OpenJS.NodeJS.LTS Git.Git Gyan.FFmpeg`, then open a new terminal |
| Debian / Ubuntu | `sudo apt install git ffmpeg`, Node.js from [nodejs.org](https://nodejs.org/en/download) (the system package is often older than 20.19) |
| Fedora | `sudo dnf install nodejs git ffmpeg-free openh264` |
| macOS | `brew install node git ffmpeg` |

Then, in a terminal (PowerShell on Windows):

```bash
git clone https://github.com/TechnikWeber/YonderRC.git
cd YonderRC
npm install
npm run dev
```

Open `http://localhost:5173`, press **Connect**, **hold Arm for 1 s** and drive with
`W A S D`. From a phone: `http://<your-PC's-IP>:5173`.

For video, run `npm run dev:video` in a second terminal in the same folder. The first
time it downloads go2rtc into `bin/`. Tests: `npm test`.

Windows blocks a file on the first start ("Application Control policy")? See
[Troubleshooting §5](docs/TROUBLESHOOTING.md#5-installation-problems).

## Desktop app

The same ground app as a program of its own, for Windows and Linux. It reads game
controllers natively (SDL): worth it when the browser does not know your controller, or
for rumble. Everything else is the same as in the browser.

- **Download** from the [latest release](https://github.com/TechnikWeber/YonderRC/releases/latest):

  | System | File |
  | --- | --- |
  | Windows (x64, and Windows on ARM through its emulation) | `…-windows-setup.exe` (installs) or `…-windows-portable.exe` (runs without installing) |
  | Linux x64 | `…-linux-x86_64.AppImage`, or `…-linux-amd64.deb` for Debian/Ubuntu |
  | Linux ARM64 (Raspberry Pi 4/5 with a desktop, ARM laptops) | `…-linux-arm64.AppImage`, or `…-linux-arm64.deb` for Raspberry Pi OS/Debian/Ubuntu |

  `SHA256SUMS` lists the checksums (`sha256sum -c SHA256SUMS --ignore-missing`).
- **Windows**: the files are **not signed**. SmartScreen warns — *More info › Run anyway*.
  With Smart App Control on, Windows blocks them outright; then use the browser, or start
  it from the source (below).
- **Linux**: `.deb` — `sudo apt install ./YonderRC-*.deb`, then *YonderRC* is in the menu.
  AppImage — `chmod +x YonderRC-*.AppImage`, then start it. Ubuntu 22.04 and newer need
  `libfuse2` (`sudo apt install libfuse2`; on 24.04 `libfuse2t64`), Fedora needs
  `fuse-libs` (`sudo dnf install fuse-libs`). The AppImage is built
  automatically and **not yet tested on a real Linux desktop** — if it does not start,
  please open an issue.
- **From the source**: with `npm run dev` running, start `npm run dev:desktop` in a second
  terminal. More in [`packages/desktop`](packages/desktop/README.md).

## How this code was written

YonderRC is written **with AI assistance**: most of the code comes from Anthropic's Claude,
following the author's specifications, and every change is reviewed by a human before it
ships. Commits carry a `Co-Authored-By: Claude` line.

- Everything is covered by the test suite; the safety logic is tested without hardware.
- **The simulator path is verified. The hardware path is not fully** — drivers, sensors,
  LTE and video can only be proven on a real Pi, and the docs say where.
- **Review it yourself before you trust it with a vehicle.**

## Safety & legal

YonderRC controls **real vehicles** and can cause damage, injury or death. It comes **"as
is", without any warranty**; the author accepts **no liability**.

- Flying or driving beyond line of sight (FPV, BVLOS) is **restricted or forbidden in many
  countries**. **Check your local laws** before you use it.
- Keep failsafe and arming enabled, test in the simulator and on the bench first, keep
  away from people, and never rely on the link alone.
- You use YonderRC **at your own risk.** See [`LICENSE`](LICENSE).

## License

[PolyForm-Noncommercial-1.0.0](LICENSE) **plus: no military use**. Free to use, change and
share; not for commercial or military use. Notes and third-party parts:
[NOTICE.md](NOTICE.md). Changes: [`CHANGELOG.md`](CHANGELOG.md) and the
[releases](https://github.com/TechnikWeber/YonderRC/releases).
