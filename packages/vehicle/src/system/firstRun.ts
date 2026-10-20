/**
 * What the installer sets up from the hardware it finds — pure, unit-tested.
 *
 * A fresh vehicle used to start as a simulator however it was wired: driver `sim`, a test
 * pattern for a camera, until somebody found the right two settings in the setup page. A
 * user report put it plainly — "make the Pi camera and the real servo board the default"
 * — and the sim-first principle stays intact if the *installer* decides instead of the
 * defaults: on a dev machine nothing is found and everything stays sim; on a Pi with a
 * PCA9685 and a camera module both are simply used.
 *
 * Two rules:
 *  - **A setting that was ever saved is never touched.** Detection only fills gaps, so
 *    re-running the installer after an update cannot undo a choice.
 *  - **Only what is unambiguous.** A PCA9685 has one sensible meaning; a current sensor
 *    does not (its reading depends on a shunt value printed on the board), so sensors are
 *    reported, not configured.
 */
import type { CameraCfg } from '@yonderrc/protocol';
import type { PersistentConfig } from '../config.js';
import type { DetectResult } from './SystemManager.js';
import type { HwDepName } from './hwDeps.js';

export interface FirstRunPlan {
  /** What to save — empty when nothing needs to change. */
  patch: PersistentConfig;
  /** One line per decision, printed by the installer. */
  notes: string[];
}

/** The camera a detected CSI module gets: 720p30, the rest left to the setup page. */
export const DETECTED_CSI_CAMERA: CameraCfg = { name: 'cam', type: 'rpicam', width: 1280, height: 720, fps: 30 };

/**
 * What a camera entry from `detectHardware()` is. `rpicam-hello --list-cameras` lists
 * CSI sensors by their device-tree path (`…/i2c@1/imx708@1a`) — and, through libcamera's
 * UVC handler, USB webcams too (`…/usb@…`). Without any rpicam entry the probe falls
 * back to bare `/dev/video*` nodes.
 */
export function cameraEntryKind(entry: string): 'csi' | 'usb' | 'v4l2' {
  if (entry.startsWith('/dev/video')) return 'v4l2';
  if (/usb@|\/usb\d|uvc/i.test(entry)) return 'usb';
  return 'csi';
}

/** "imx708_wide [4608x2592 10-bit RGGB] (/base/…)" → "imx708_wide". */
export function sensorName(entry: string): string {
  return entry.trim().split(/[\s[(]/)[0] || entry.trim();
}

/** Native modules a saved configuration cannot run without (only the ones npm alone can build). */
export function requiredHwDeps(p: PersistentConfig): HwDepName[] {
  const need = new Set<HwDepName>();
  if (p.driver === 'pca9685') need.add('i2c-bus');
  if (p.driver === 'sbus') need.add('serialport');
  if (p.gps?.source === 'serial-nmea') need.add('serialport');
  const t = p.telemetry;
  if (t && t.enabled !== false && t.source === 'real') {
    const kinds = [...(t.voltages ?? []), ...(t.currents ?? []), ...(t.temperatures ?? [])].map((c) => String((c as { kind?: string }).kind ?? ''));
    if (kinds.some((k) => /^(ina|ads|mcp9808|tmp1|bmp|bme)/.test(k))) need.add('i2c-bus');
  }
  return [...need];
}

export function firstRunPlan(persisted: PersistentConfig, detect: DetectResult): FirstRunPlan {
  const patch: PersistentConfig = {};
  const notes: string[] = [];

  // --- output driver ---
  const pcas = detect.i2c.filter((d) => d.kind === 'pca9685');
  const inas = detect.i2c.filter((d) => d.kind && d.kind.startsWith('ina'));
  if (persisted.driver !== undefined) {
    notes.push(`Output driver: keeping the saved "${persisted.driver}" (change it in Setup › Sensors & outputs).`);
  } else if (pcas.length === 0) {
    notes.push(
      'Output driver: no PCA9685 found on I²C bus 1 — staying on "sim". ' +
        'Wired one? Check SDA/SCL/3V3/GND and its address, then re-run the installer or pick it in Setup › Sensors & outputs.',
    );
  } else {
    const pick = pcas.find((d) => d.confirmed) ?? pcas[0];
    const address = parseInt(pick.address, 16);
    patch.driver = 'pca9685';
    if (persisted.pca9685?.address === undefined) {
      patch.pca9685 = { ...(persisted.pca9685 ?? {}), address, bus: persisted.pca9685?.bus ?? 1 };
    } else if (persisted.pca9685.address !== address) {
      notes.push(
        `The saved PCA9685 address is 0x${persisted.pca9685.address.toString(16)}, but the chip answers at ${pick.address} — ` +
          'the saved one is kept; correct it in Setup › Sensors & outputs if it is wrong, or the driver falls back to sim.',
      );
    }
    notes.push(
      `Output driver: PCA9685 at ${pick.address}${pick.confirmed ? '' : ' (probable — its all-call address is off, so not confirmed)'} → driver "pca9685".`,
    );
    if (pcas.length > 1) notes.push(`More than one PCA9685 answered (${pcas.map((p) => p.address).join(', ')}) — using ${pick.address}.`);
  }

  // --- the native module that driver needs: an update must not prune it, a fresh install must build it ---
  const effective: PersistentConfig = { ...persisted, ...patch };
  const have = new Set<HwDepName>(persisted.hardwareDeps ?? []);
  const missing = requiredHwDeps(effective).filter((d) => !have.has(d));
  if (missing.length) {
    patch.hardwareDeps = [...have, ...missing];
    notes.push(`Native driver module(s) to build: ${missing.join(', ')}.`);
  }

  // --- camera ---
  if (persisted.cameras !== undefined) {
    notes.push(`Cameras: keeping the saved list (${persisted.cameras.length}).`);
  } else {
    const csi = detect.cameras.filter((c) => cameraEntryKind(c) === 'csi');
    const other = detect.cameras.filter((c) => cameraEntryKind(c) !== 'csi');
    if (csi.length) {
      patch.cameras = [{ ...DETECTED_CSI_CAMERA }];
      notes.push(`Camera: CSI module ${sensorName(csi[0])} → camera "cam" (rpicam, 1280×720 @ 30 fps).`);
      if (csi.length > 1) notes.push(`A second CSI camera (${sensorName(csi[1])}) was found — add it in Setup › Camera.`);
    } else if (other.length) {
      notes.push(`Camera: only a USB/V4L2 device (${other[0]}) — add it in Setup › Camera (type usb). The test pattern stays until then.`);
    } else {
      notes.push(
        'Camera: none detected — the test pattern stays. Official Pi cameras are found by themselves; ' +
          'others (Arducam …) need their overlay first: Setup › Camera › CSI camera module, reboot, re-run the installer.',
      );
    }
  }

  // --- sensors: reported, never configured ---
  for (const ina of inas) {
    notes.push(`${ina.device ?? 'INA2xx'} at ${ina.address} found — set it up in Setup › Sensors & outputs › Telemetry (enter the shunt value printed on the board).`);
  }
  // The collision this project's docs warn about: both chips ship on 0x40.
  const at40 = detect.i2c.find((d) => d.address === '0x40');
  if (at40 && !at40.confirmed && detect.i2c.some((d) => d.address === '0x70')) {
    notes.push('Something answers at 0x40 that could not be identified, next to a PCA9685 all-call address: a PCA9685 and an INA2xx sharing 0x40? Move the PCA9685 to 0x41 (solder bridge A0) and re-run.');
  }
  return { patch, notes };
}
