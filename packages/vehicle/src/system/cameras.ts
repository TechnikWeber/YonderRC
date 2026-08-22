/**
 * Pure helpers for CSI camera detection. The shell calls live in RealSystem —
 * everything that can be reasoned about (and got us wrong answers on real
 * hardware) is here so the test suite can pin it down.
 */

/** Parse the camera list of `rpicam-hello --list-cameras` / `libcamera-hello …`. */
export function parseCameraList(out: string): string[] {
  const cams: string[] = [];
  for (const m of out.matchAll(/^\s*(\d+)\s*:\s*(.+)$/gm)) cams.push(m[2].trim());
  return cams;
}

/**
 * Which `/dev/video*` nodes are actual capture devices. On a Pi, video10 and up
 * are the V4L2 codec/ISP nodes — they exist with no camera attached at all, so
 * listing them made `/api/detect` claim fourteen cameras on a Pi with none.
 */
export function captureNodes(paths: string[]): string[] {
  return paths
    .filter((p) => /^\/dev\/video(\d+)$/.test(p))
    .filter((p) => Number(p.replace('/dev/video', '')) < 10);
}

/** Explain an empty camera list so the user knows what to change, not just that it failed. */
export function explainNoCamera(toolFound: boolean): string {
  if (!toolFound) {
    return 'No camera tool found — install rpicam-apps (Raspberry Pi OS Bookworm renamed libcamera-* to rpicam-*).';
  }
  return (
    'No CSI camera detected. Check the ribbon cable (contacts towards the HDMI side, ' +
    'CAM port not DISPLAY). A sensor outside the auto-detect set (Arducam IMX519 / 64MP / ' +
    'Pivariety, OV64A40, …) needs its own dtoverlay — pick it under "CSI camera module" ' +
    'and reboot.'
  );
}
