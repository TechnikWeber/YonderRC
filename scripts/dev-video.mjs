/**
 * Video for the simulator: download go2rtc once into bin/ and run it with the YonderRC
 * config, so the ground app shows the FPV test pattern and the OSD.
 *
 *     npm run dev        # first: vehicle :8080 + ground :5173
 *     npm run dev:video  # then, in a second terminal
 *
 * Node instead of bash so it runs the same on Windows, Linux and macOS — the old
 * dev-video.sh always fetched the Linux binary and needed Git Bash on Windows.
 * Needs ffmpeg with an H.264 encoder on PATH.
 */
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { arch, platform } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const binDir = join(root, 'bin');
const isWin = platform() === 'win32';
const bin = join(binDir, isWin ? 'go2rtc.exe' : 'go2rtc');
const cfg = join(root, 'docker', 'go2rtc.yaml');

const INSTALL_FFMPEG = `
    Windows:        winget install Gyan.FFmpeg   (then open a new terminal)
    Debian/Ubuntu:  sudo apt install ffmpeg
    Fedora:         sudo dnf install ffmpeg-free openh264
    macOS:          brew install ffmpeg`;

// go2rtc needs an H.264 encoder for browser WebRTC. YonderRC picks whichever ffmpeg
// has: libx264, Cisco's libopenh264 (in Fedora's ffmpeg-free), or a hardware encoder.
const probe = spawnSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
if (probe.error) {
  console.error(`ffmpeg is required and was not found on PATH. Install it:${INSTALL_FFMPEG}`);
  process.exit(1);
}
const encoder = (probe.stdout ?? '').match(/libx264|libopenh264|h264_v4l2m2m|h264_omx|h264_nvenc/)?.[0];
if (!encoder) {
  console.error(`Your ffmpeg has no usable H.264 encoder (libx264 or libopenh264).${INSTALL_FFMPEG}
    On Fedora the full ffmpeg with libx264 comes from RPM Fusion.`);
  process.exit(1);
}
console.log(`H.264 encoder available: ${encoder}`);

/** The go2rtc release asset for this machine; zips for Windows and macOS. */
function asset() {
  const a = arch();
  if (isWin) return a === 'arm64' ? 'go2rtc_win_arm64.zip' : a === 'ia32' ? 'go2rtc_win32.zip' : 'go2rtc_win64.zip';
  if (platform() === 'darwin') return a === 'arm64' ? 'go2rtc_mac_arm64.zip' : 'go2rtc_mac_amd64.zip';
  const linux = { x64: 'amd64', arm64: 'arm64', arm: 'arm', ia32: 'i386' }[a] ?? 'amd64';
  return `go2rtc_linux_${linux}`;
}

if (!existsSync(bin)) {
  const name = asset();
  console.log(`Downloading go2rtc (${name})…`);
  const res = await fetch(`https://github.com/AlexxIT/go2rtc/releases/latest/download/${name}`);
  if (!res.ok) {
    console.error(`Download failed: HTTP ${res.status}. Put a go2rtc binary at ${bin} by hand.`);
    process.exit(1);
  }
  mkdirSync(binDir, { recursive: true });
  const data = Buffer.from(await res.arrayBuffer());
  if (name.endsWith('.zip')) {
    const zip = join(binDir, name);
    writeFileSync(zip, data);
    // bsdtar unpacks zips: built into Windows 10+ and macOS. On Windows call it by its
    // full path — Git Bash puts GNU tar, which cannot read zips, first on PATH.
    const tar = isWin ? join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe') : 'tar';
    const x = spawnSync(tar, ['-xf', zip, '-C', binDir], { stdio: 'inherit' });
    rmSync(zip, { force: true });
    if (x.status !== 0 || !existsSync(bin)) {
      console.error(`Could not unpack ${name}. Unzip it into ${binDir} by hand.`);
      process.exit(1);
    }
  } else {
    writeFileSync(bin, data);
  }
  if (!isWin) chmodSync(bin, 0o755);
}

console.log(`Starting go2rtc with ${cfg} (test pattern on stream 'test')…`);
const child = spawn(bin, ['-config', cfg], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
