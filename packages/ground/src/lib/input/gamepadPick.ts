/**
 * Which connected device is the game controller.
 *
 * The browser's Gamepad API lists every HID device that *claims* to be a joystick, and
 * some headsets do: their volume and mute buttons arrive as a "gamepad" with a handful
 * of buttons and no sticks. The provider used to take the first device in the list, so
 * a user with a headset plugged in got the headset — and the PS4 controller next to it
 * was ignored. Linux makes it worse for Sony pads: the kernel splits a DualShock 4 /
 * DualSense into the pad itself, a "Motion Sensors" device (whose accelerometer looks
 * like three axes) and a "Touchpad".
 *
 * So every device is still listed — the operator decides — but the automatic choice
 * goes to the one that most looks like a controller, and something that does not look
 * like one at all is never picked automatically. Pure and unit-tested; the providers
 * only feed it what the browser (or the SDL bridge) reports.
 */

export interface PadInfo {
  /** Position in navigator.getGamepads() (or in the SDL bridge's list). */
  index: number;
  /** What the browser calls it, e.g. "Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)". */
  id: string;
  /** 'standard' when the browser maps it to the standard layout; '' when the layout is the device's own. */
  mapping: string;
  axes: number;
  buttons: number;
}

export interface PadAssessment {
  /** Looks like something you can drive with. Only these are ever picked automatically. */
  likely: boolean;
  /** Ranking among the likely ones — higher is better. */
  score: number;
  layout: 'standard' | 'own';
  /** Why — shown next to the device in Setup › Controls. */
  reasons: string[];
}

/** Names that rule a device out: audio gear, keyboards, the Sony pads' extra Linux devices. */
const NOT_A_PAD =
  /head\s?set|headphone|ear ?(?:buds?|phones?)|audio|speaker|microphone|\bmic\b|sound|webcam|camera|keyboard|mouse|touch ?pad|trackpad|motion sensors|accelerometer|gyro|consumer control|system control|hands-?free/i;

/** Names (and USB vendor ids) that say "controller": Sony 054c, Microsoft 045e, Nintendo 057e, 8BitDo 2dc8, Valve 28de — and RC transmitters in USB joystick mode. */
const PAD_HINT =
  /gamepad|game ?pad|controller|joystick|joy-con|xbox|x-?input|dualshock|dualsense|playstation|\bps[345]\b|8bitdo|nintendo|switch pro|stadia|radiomaster|frsky|edgetx|opentx|taranis|\b054c\b|\b045e\b|\b057e\b|\b2dc8\b|\b28de\b/i;

export function assessPad(p: PadInfo): PadAssessment {
  const layout = p.mapping === 'standard' ? 'standard' : 'own';
  if (NOT_A_PAD.test(p.id)) {
    return { likely: false, score: -10, layout, reasons: ['its name says audio, input or sensor device — not a controller'] };
  }
  const reasons: string[] = [];
  let score = 0;
  const named = PAD_HINT.test(p.id);
  if (layout === 'standard') {
    score += 4;
    reasons.push('standard layout — sticks and buttons where the templates expect them');
  } else {
    reasons.push('own layout — check the axes with Learn');
  }
  if (p.axes >= 4) score += 2;
  else if (p.axes >= 2) score += 1;
  else reasons.push('no analog sticks');
  if (p.buttons >= 10) score += 1;
  if (named) {
    score += 2;
    reasons.push('named like a controller');
  }
  // A standard mapping is the browser vouching for it. Without that, it needs sticks —
  // and with only two axes also a name that says so (a 2-axis "device" is as likely a
  // volume wheel as a stick).
  const likely = layout === 'standard' || p.axes >= 4 || (p.axes >= 2 && named);
  return { likely, score, layout, reasons };
}

/** Likely controllers first, best first; the rest after them, in browser order. */
export function rankPads(pads: PadInfo[]): PadInfo[] {
  return pads
    .map((p) => ({ p, a: assessPad(p) }))
    .sort((x, y) => Number(y.a.likely) - Number(x.a.likely) || y.a.score - x.a.score || x.p.index - y.p.index)
    .map((x) => x.p);
}

/**
 * The pad to read. An explicit choice wins whenever that device is connected — even one
 * that does not look like a controller, because the operator said so. Otherwise the best
 * likely controller, and if there is none: nothing. Driving with a headset's volume
 * buttons is not a fallback.
 */
export function choosePad(pads: PadInfo[], preferredId: string | null): PadInfo | null {
  if (preferredId) {
    const p = pads.find((x) => x.id === preferredId);
    if (p) return p;
  }
  return rankPads(pads).find((p) => assessPad(p).likely) ?? null;
}

/** Remembered per browser, by name: the index changes with plug order and between sessions. */
export const GAMEPAD_PREF_KEY = 'yonderrc.gamepad.v1';

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void; removeItem?(k: string): void };

export function loadPadPref(store: Store | null | undefined): string | null {
  try {
    return store?.getItem(GAMEPAD_PREF_KEY) || null;
  } catch {
    return null;
  }
}

export function savePadPref(store: Store | null | undefined, id: string | null): void {
  try {
    if (id) store?.setItem(GAMEPAD_PREF_KEY, id);
    else store?.removeItem?.(GAMEPAD_PREF_KEY);
  } catch {
    /* private mode — the choice simply does not survive a reload */
  }
}

/**
 * "Learn" for an axis: the first one that moved far from where it rested when learning
 * began. Comparing against the rest position instead of zero matters: a trigger in the
 * device's own layout rests at −1, and the old absolute test learned it the instant
 * Learn was pressed. Returns −1 while nothing moved.
 */
export function movedAxis(baseline: (number | null)[], now: (number | null)[], threshold = 0.6): number {
  for (let i = 0; i < now.length; i++) {
    const v = now[i];
    if (v == null) continue;
    const base = baseline[i] ?? 0;
    if (Math.abs(v - base) > threshold) return i;
  }
  return -1;
}

/** "Learn" for a button: one that is down now and was not when learning began. −1 if none. */
export function newlyPressed(baseline: boolean[], now: boolean[]): number {
  for (let i = 0; i < now.length; i++) if (now[i] && !baseline[i]) return i;
  return -1;
}

/** A shorter label for the UI: the browser's id minus the vendor/product suffix. */
export function padLabel(id: string): string {
  const s = id.replace(/\s*\((?:STANDARD GAMEPAD\s*)?Vendor:.*\)\s*$/i, '').replace(/^[0-9a-f]{4}-[0-9a-f]{4}-/i, '').trim();
  return s || id;
}
