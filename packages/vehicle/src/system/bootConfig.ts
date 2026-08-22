/**
 * Choosing a CSI camera module from the setup page instead of over SSH.
 *
 * A Raspberry Pi only sees a camera the firmware knows how to bind. The four official
 * sensors are found by `camera_auto_detect=1`; everything else — the Arducam modules in
 * particular — needs `camera_auto_detect=0` plus an explicit `dtoverlay=` in
 * `/boot/firmware/config.txt` and a reboot. That is exactly the kind of terminal-only
 * step a vehicle reachable through its own hotspot must not require.
 *
 * Everything here is pure text manipulation of config.txt so the test suite can pin down
 * the one file that decides whether the Pi boots at all. The rules are deliberately
 * conservative: we never rewrite the file, we only comment out the lines that compete
 * with our choice and append one clearly marked block.
 */

/** A selectable camera module. `overlay: null` means "let the firmware auto-detect". */
export interface CsiModule {
  id: string;
  label: string;
  overlay: string | null;
  /** Shown in the UI so the choice explains itself. */
  note: string;
  /** Tuning file we ship because the stock one is unusable (see provisioning/tuning). */
  tuningFile?: string;
  /** Module has a focus actuator worth exposing in the camera editor. */
  focus?: boolean;
}

export const TUNING_DIR = '/var/lib/yonderrc/tuning';

export const CSI_MODULES: CsiModule[] = [
  {
    id: 'auto',
    label: 'Auto-detect (official Raspberry Pi cameras)',
    overlay: null,
    note: 'Finds OV5647, IMX219, IMX477 and IMX708 (Camera Module 1/2/3 and HQ) on its own.',
  },
  {
    id: 'imx519',
    label: 'Arducam 16MP IMX519 (autofocus)',
    overlay: 'imx519',
    note: 'Not auto-detected. Ships with a tuning file — Raspberry Pi’s own imx519.json has no autofocus algorithm.',
    tuningFile: `${TUNING_DIR}/imx519-af.json`,
    focus: true,
  },
  {
    id: 'arducam-64mp',
    label: 'Arducam 64MP Hawkeye (autofocus)',
    overlay: 'arducam-64mp',
    note: 'Not auto-detected.',
    focus: true,
  },
  {
    id: 'ov64a40',
    label: 'Arducam 64MP Owlsight (OV64A40, autofocus)',
    overlay: 'ov64a40',
    note: 'Not auto-detected.',
    focus: true,
  },
  {
    id: 'arducam-pivariety',
    label: 'Arducam Pivariety module',
    overlay: 'arducam-pivariety',
    note: 'For Arducam’s Pivariety boards, which answer on I²C 0x0c.',
  },
  { id: 'ov5647', label: 'Raspberry Pi Camera v1 (OV5647), forced', overlay: 'ov5647', note: 'Use when auto-detect misses it.' },
  { id: 'imx219', label: 'Raspberry Pi Camera v2 (IMX219), forced', overlay: 'imx219', note: 'Use when auto-detect misses it.' },
  { id: 'imx477', label: 'Raspberry Pi HQ Camera (IMX477), forced', overlay: 'imx477', note: 'Use when auto-detect misses it.' },
  { id: 'imx708', label: 'Raspberry Pi Camera v3 (IMX708), forced', overlay: 'imx708', note: 'Use when auto-detect misses it.', focus: true },
  {
    id: 'custom',
    label: 'Other module (enter the overlay name)',
    overlay: null,
    note: 'Any overlay shipped in /boot/firmware/overlays. Checked against what is actually installed before it is written.',
  },
];

export function moduleById(id: string): CsiModule | undefined {
  return CSI_MODULES.find((m) => m.id === id);
}

/**
 * Camera overlays we may have to clear when switching modules. Only these are touched —
 * a `dtoverlay=vc4-kms-v3d` or `dwc2` line is none of our business.
 */
export const CAMERA_OVERLAYS = [
  'imx219', 'imx258', 'imx283', 'imx290', 'imx296', 'imx327', 'imx335', 'imx378',
  'imx415', 'imx462', 'imx477', 'imx500', 'imx500-pi5', 'imx519', 'imx708',
  'ov5647', 'ov64a40', 'ov9281', 'arducam-64mp', 'arducam-pivariety',
];

const BEGIN = '# --- YonderRC camera module (managed by the setup page) ---';
const END = '# --- end YonderRC camera module ---';

/** An overlay name plus optional params, as it may appear after `dtoverlay=`. */
export function overlayBaseName(value: string): string {
  return value.split(',')[0].trim();
}

/**
 * A custom overlay name goes into config.txt, so it must not be able to inject a second
 * directive. Allow the shape dtoverlay actually uses and nothing else.
 */
export function validOverlayName(value: string): boolean {
  return /^[a-z0-9][a-z0-9_-]*(,[a-z0-9_-]+(=[A-Za-z0-9_.:-]+)?)*$/.test(value.trim());
}

/** Read back what config.txt currently asks for, ignoring commented-out lines. */
export function parseBootConfig(text: string): { autoDetect: boolean; overlay: string | null } {
  let autoDetect = true; // the Raspberry Pi OS default when the key is absent
  let overlay: string | null = null;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const auto = /^camera_auto_detect\s*=\s*(\d+)/.exec(line);
    if (auto) autoDetect = auto[1] !== '0';
    const dt = /^dtoverlay\s*=\s*(.+)$/.exec(line);
    if (dt && CAMERA_OVERLAYS.includes(overlayBaseName(dt[1]))) overlay = dt[1].trim();
  }
  return { autoDetect, overlay };
}

/** Which catalogue entry the current config corresponds to. */
export function moduleIdFor(state: { autoDetect: boolean; overlay: string | null }): string {
  if (!state.overlay) return state.autoDetect ? 'auto' : 'custom';
  const base = overlayBaseName(state.overlay);
  return CSI_MODULES.find((m) => m.overlay === base)?.id ?? 'custom';
}

/** Drop a block we wrote earlier, so applying twice can't stack up. */
export function stripManagedBlock(text: string): string {
  const lines = text.split('\n');
  const out: string[] = [];
  let inside = false;
  for (const line of lines) {
    if (line.trim() === BEGIN) { inside = true; continue; }
    if (inside) { if (line.trim() === END) inside = false; continue; }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Write the choice into config.txt.
 *
 * Competing lines elsewhere in the file are **commented out, not deleted** — the user can
 * see what was there and put it back. The new block is appended under its own `[all]`
 * so it lands in the unconditional section no matter which `[cm4]`/`[pi5]` section the
 * file happened to end in.
 */
export function applyCameraModule(text: string, overlay: string | null): string {
  const body = stripManagedBlock(text)
    .split('\n')
    .map((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return raw;
      if (/^camera_auto_detect\s*=/.test(line)) return `# ${raw}  # (replaced by YonderRC)`;
      const dt = /^dtoverlay\s*=\s*(.+)$/.exec(line);
      if (dt && CAMERA_OVERLAYS.includes(overlayBaseName(dt[1]))) {
        return `# ${raw}  # (replaced by YonderRC)`;
      }
      return raw;
    })
    .join('\n');

  const block = [
    BEGIN,
    '[all]',
    `camera_auto_detect=${overlay ? 0 : 1}`,
    ...(overlay ? [`dtoverlay=${overlay}`] : []),
    END,
  ].join('\n');

  return `${body.replace(/\n*$/, '')}\n\n${block}\n`;
}

/**
 * A config.txt change only takes effect at boot. The boot id changes on every boot, so
 * comparing the one recorded at write time against the current one answers "is the
 * running kernel still the old one?" exactly, and survives a service restart.
 */
export function rebootStillPending(savedBootId: string | null, currentBootId: string): boolean {
  return !!savedBootId && savedBootId.trim() === currentBootId.trim();
}

/** What `detectHardware` should say about the boot config, given what libcamera found. */
export function explainBootConfig(
  state: { autoDetect: boolean; overlay: string | null },
  cameraCount: number,
): string | null {
  if (cameraCount > 0) return null;
  if (state.overlay) {
    return (
      `config.txt forces dtoverlay=${state.overlay}, but no camera bound to it — wrong module ` +
      'selected, or the ribbon cable is not seated (contacts towards the HDMI side, CAM port).'
    );
  }
  if (state.autoDetect) {
    return (
      'camera_auto_detect is on and found nothing. That covers only OV5647 / IMX219 / IMX477 / ' +
      'IMX708 — pick your module under "CSI camera module" if it is an Arducam or another sensor.'
    );
  }
  return 'camera_auto_detect is off and no overlay is set, so the firmware never looks for a camera. Pick a module under "CSI camera module".';
}
