import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { exec } from 'node:child_process';
import type { CameraCfg } from '@yonderrc/protocol';

/**
 * Turns the graphical camera list into a go2rtc.yaml and reloads go2rtc — so the
 * user configures cameras (type, resolution, fps, bitrate) in the setup UI, not
 * by hand-editing a config file. Each camera becomes one selectable stream.
 *
 * The H.264 encoder is auto-detected so it works everywhere: libx264 (full
 * ffmpeg), libopenh264 (Fedora's patent-free ffmpeg-free), or a hardware encoder
 * on the Pi (h264_v4l2m2m) — no RPM Fusion required.
 */

/** Detect the best available H.264 encoder from the local ffmpeg. */
export function detectH264Encoder(): Promise<string> {
  return new Promise((resolve) => {
    exec('ffmpeg -hide_banner -encoders', { timeout: 8000 }, (_err, stdout) => {
      const out = stdout || '';
      // Prefer quality/latency: x264, then Cisco openh264, then Pi hardware.
      const prefer = ['libx264', 'libopenh264', 'h264_v4l2m2m', 'h264_omx', 'h264_nvenc'];
      for (const e of prefer) if (out.includes(e)) return resolve(e);
      resolve('libx264'); // last resort; preflight will have warned
    });
  });
}

/**
 * Raspberry Pi OS renamed the camera tools from `libcamera-*` to `rpicam-*` in
 * Bookworm and dropped the old symlinks entirely in current images — a hardcoded
 * `libcamera-vid` dies with "executable file not found in $PATH" and the ground
 * station only ever sees connecting → black → reconnecting. Detect what is
 * actually installed instead of guessing.
 */
export function detectRpicamBinary(): Promise<string> {
  return new Promise((resolve) => {
    exec('command -v rpicam-vid || command -v libcamera-vid', { timeout: 8000 }, (_err, stdout) => {
      const first = (stdout || '').split('\n')[0].trim();
      resolve(first.endsWith('libcamera-vid') ? 'libcamera-vid' : 'rpicam-vid');
    });
  });
}

/** Encoder-specific ffmpeg output args (libx264 presets don't apply elsewhere). */
function encoderArgs(encoder: string, fps: number, bitrateKbps?: number): string {
  const br = bitrateKbps && bitrateKbps > 0 ? bitrateKbps : null;
  if (encoder === 'libx264') {
    return (
      `-c:v libx264 -preset ultrafast -tune zerolatency -pix_fmt yuv420p -g ${fps}` +
      (br ? ` -b:v ${br}k -maxrate ${br}k -bufsize ${br * 2}k` : '')
    );
  }
  if (encoder === 'libopenh264') {
    // openh264 has no presets; needs an explicit bitrate.
    return `-c:v libopenh264 -profile:v constrained_baseline -pix_fmt yuv420p -g ${fps} -b:v ${br ?? 2000}k`;
  }
  if (encoder === 'h264_v4l2m2m' || encoder === 'h264_omx') {
    return `-c:v ${encoder} -pix_fmt yuv420p -g ${fps} -b:v ${br ?? 2000}k`;
  }
  return `-c:v ${encoder} -g ${fps}` + (br ? ` -b:v ${br}k` : '');
}

/** Round to an even number ≥ 2 (H.264 needs even dimensions). */
function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

/**
 * A camera name becomes a go2rtc stream key (YAML) AND the stream id the ground
 * requests — restrict it to a safe charset so a crafted name can't break the YAML
 * or inject a second stream. Empty/garbage falls back to "cam".
 */
export function safeStreamName(name: string): string {
  const cleaned = (name ?? '').replace(/[^A-Za-z0-9_-]/g, '_').replace(/^_+|_+$/g, '');
  return cleaned || 'cam';
}

/**
 * A tuning file path lands in an `exec:` argv. go2rtc splits that on whitespace, so a
 * path with spaces would silently become two arguments — require an absolute, safe,
 * space-free .json path and drop anything else.
 */
function safeTuningFile(path: string | undefined): string | null {
  if (!path) return null;
  const t = path.trim();
  if (!/^\/[A-Za-z0-9_\-./]+\.json$/.test(t) || t.includes('..')) return null;
  return t;
}

/** Focus flags for rpicam-vid. 'off' emits nothing — the historic behaviour. */
function focusArgs(cam: CameraCfg): string {
  const mode = cam.focus ?? 'off';
  if (mode === 'off') return '';
  if (mode === 'manual') {
    // Dioptres: 0 = infinity, 10 = 10 cm. Clamp to what the actuators actually cover.
    const d = Number(cam.lensPosition);
    const pos = Number.isFinite(d) ? Math.min(20, Math.max(0, Math.round(d * 100) / 100)) : 0;
    return ` --autofocus-mode manual --lens-position ${pos}`;
  }
  return ` --autofocus-mode ${mode}`;
}

/** The camera binary lands in an `exec:` command line — allow only a bare safe name. */
function safeBinary(bin: string | undefined): string {
  const b = bin ?? 'rpicam-vid';
  return /^[A-Za-z0-9_-]+$/.test(b) ? b : 'rpicam-vid';
}

/** A V4L2 device path lands inside an `exec:` command line — allow only /dev/<safe>. */
function safeDevice(dev: string | undefined): string {
  const d = dev ?? '/dev/video0';
  return /^\/dev\/[A-Za-z0-9_-]+$/.test(d) ? d : '/dev/video0';
}

/** Positive integer with a floor (dimensions/fps go into shell command lines). */
function posInt(n: number, min: number, fallback: number): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v >= min ? v : fallback;
}

/**
 * Scale a camera's resolution/bitrate for a live quality level requested from the
 * ground. 'high' keeps the configured values; lower levels shrink dimensions and
 * cap bitrate so the picture stays fluid on a poor link.
 */
export function scaleCamera(cam: CameraCfg, quality: 'high' | 'medium' | 'low'): CameraCfg {
  if (quality === 'high') return cam;
  const factor = quality === 'medium' ? 0.66 : 0.5;
  const cap = quality === 'medium' ? 1200 : 600;
  return {
    ...cam,
    width: even(cam.width * factor),
    height: even(cam.height * factor),
    bitrateKbps: Math.min(cam.bitrateKbps ?? cap, cap),
  };
}
export function cameraSource(cam: CameraCfg, encoder = 'libx264', rpicamBin = 'rpicam-vid'): string {
  // Coerce everything that lands in a shell command line to safe numeric/string
  // values — these come from the setup UI and must never inject.
  const w = even(posInt(cam.width, 2, 1280));
  const h = even(posInt(cam.height, 2, 720));
  const fps = posInt(cam.fps, 1, 25);
  const br = cam.bitrateKbps != null ? posInt(cam.bitrateKbps, 1, 0) : undefined;
  const enc = encoderArgs(encoder, fps, br);
  if (cam.type === 'sim') {
    return `exec:ffmpeg -re -f lavfi -i testsrc=size=${w}x${h}:rate=${fps} ${enc} -f rtsp {output}`;
  }
  if (cam.type === 'rpicam') {
    const brArg = br ? ` --bitrate ${br * 1000}` : '';
    // No ffmpeg and no shell pipe: go2rtc runs `exec:` WITHOUT a shell
    // (shell.QuoteSplit + exec.Command), so a `|` would be handed to the camera
    // binary as a literal argument. Without `{output}` go2rtc reads the process
    // stdout instead and sniffs the format itself — a raw H.264 Annex-B stream is
    // exactly what rpicam-vid writes, so the encoder is irrelevant here and we
    // save a transcode hop.
    const tuning = safeTuningFile(cam.tuningFile);
    const tuneArg = tuning ? ` --tuning-file ${tuning}` : '';
    return (
      `exec:${safeBinary(rpicamBin)} -t 0 --inline --flush --nopreview --codec h264 ` +
      `--width ${w} --height ${h} --framerate ${fps} --intra ${fps}${brArg}` +
      `${tuneArg}${focusArgs(cam)} -o -`
    );
  }
  // usb (V4L2): transcode to H.264 with the detected encoder.
  const dev = safeDevice(cam.device);
  return `exec:ffmpeg -f v4l2 -framerate ${fps} -video_size ${w}x${h} -i ${dev} ${enc} -f rtsp {output}`;
}

export function generateGo2rtcYaml(cameras: CameraCfg[], encoder = 'libx264', rpicamBin = 'rpicam-vid'): string {
  const lines: string[] = [
    '# Generated by YonderRC from the graphical camera settings — do not edit by hand.',
    `# H.264 encoder: ${encoder} · Pi camera binary: ${rpicamBin}`,
    'api:',
    '  listen: ":1984"',
    '  origin: "*"',
    'rtsp:',
    '  listen: ":8554"',
    'webrtc:',
    '  listen: ":8555"',
    '  candidates:',
    '    - stun:8555',
    'streams:',
  ];
  if (cameras.length === 0) {
    lines.push('  {}');
  } else {
    for (const cam of cameras) {
      lines.push(`  ${safeStreamName(cam.name)}: ${JSON.stringify(cameraSource(cam, encoder, rpicamBin))}`);
    }
  }
  return lines.join('\n') + '\n';
}

/** Write the config file and ask a running go2rtc to reload it. */
export async function applyCameras(
  cameras: CameraCfg[],
  configPath: string,
  videoBaseUrl: string | null,
  encoder = 'libx264',
  rpicamBin = 'rpicam-vid',
): Promise<void> {
  try {
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, generateGo2rtcYaml(cameras, encoder, rpicamBin));
  } catch (err) {
    console.error(`[video] could not write ${configPath}: ${(err as Error).message}`);
    return;
  }
  if (!videoBaseUrl) return;
  const ok = () => console.log(`[video] go2rtc reloaded with ${cameras.length} camera(s), encoder ${encoder}`);
  try {
    await fetch(`${videoBaseUrl}/api/restart`, { method: 'POST' });
    ok();
  } catch {
    // go2rtc restarts *itself* in response to this call, so it often drops the
    // connection before answering — the fetch rejects even though the reload
    // happened. Saying "start go2rtc to apply" then is simply wrong, so ask it what
    // it is serving before claiming anything.
    if (await reloadTookEffect(videoBaseUrl, cameras)) ok();
    else console.log('[video] wrote go2rtc.yaml; start/restart go2rtc to apply');
  }
}

/** Did go2rtc come back with exactly the streams we just wrote? */
async function reloadTookEffect(videoBaseUrl: string, cameras: CameraCfg[]): Promise<boolean> {
  const want = new Set(cameras.map((c) => safeStreamName(c.name)));
  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((r) => setTimeout(r, 300));
    try {
      const res = await fetch(`${videoBaseUrl}/api/streams`);
      if (!res.ok) continue;
      const have = Object.keys((await res.json()) as Record<string, unknown>);
      if (have.length === want.size && have.every((k) => want.has(k))) return true;
    } catch {
      // still restarting — try again
    }
  }
  return false;
}
