**English** · [Deutsch](README.de.md)

# YonderRC

Remote control over the internet for RC cars, boats, planes and drones — with live video,
telemetry and settings in the browser. A Raspberry Pi in the vehicle, a browser, phone or
desktop app on the ground. Built for LTE.

Everything also runs **in a simulator, with no hardware**.

![Ground station while driving: FPV video with a full OSD — GPS fix and home compass with distance, odometer and speed top left, battery bar top right, voltage/current/mAh bottom right, link health score top centre](docs/screenshots/Overview_OSD.png?v=5)

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
- **Setup page on the vehicle**: Wi-Fi, LTE, remote access (Tailscale, ZeroTier,
  WireGuard), cameras, sensors, updates — from a phone, no screen on the Pi.
- **Problem report in one file** that says in plain words what went wrong.

The full list: [`docs/FEATURES.md`](docs/FEATURES.md).

## Get started

| You want to … | Read |
| --- | --- |
| try it without hardware | [the simulator](#try-it-in-the-simulator), below |
| build a vehicle, step by step | [`docs/QUICKSTART.md`](docs/QUICKSTART.md) |
| see parts, wiring, LTE and remote access | [`docs/HARDWARE.md`](docs/HARDWARE.md) |
| fix something that does not work | [`docs/TROUBLESHOOTING.md`](docs/TROUBLESHOOTING.md) |

On a Raspberry Pi with the hardware connected, one line installs everything:

```bash
curl -fsSL https://raw.githubusercontent.com/TechnikWeber/YonderRC/main/provisioning/bootstrap.sh | bash
```

Then open `http://<pi-ip>:8080/setup`.

## Try it in the simulator

Runs on Windows, Linux and macOS. You need [Node.js](https://nodejs.org) 20 or newer
(npm comes with it) and [Git](https://git-scm.com); for video also `ffmpeg`. No compiler:
the hardware drivers are optional and are skipped on a PC.

| System | Install once |
| --- | --- |
| Windows | `winget install OpenJS.NodeJS.LTS Git.Git Gyan.FFmpeg`, then open a new terminal |
| Debian / Ubuntu | `sudo apt install git ffmpeg`, Node.js from [nodejs.org](https://nodejs.org/en/download) (the system package is often older than 20) |
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
