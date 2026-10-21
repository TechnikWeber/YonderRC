/**
 * The gamepad side of a binding's `element`:
 *  - `axis:N`, `axis:N:inv` — stick axis N, the second one turned around
 *  - `button:N` — button N, for switches and ramps
 *  - `buttons:P:N` — two buttons as one axis (v1.71): P pushes towards +1, N towards
 *    −1, each by how far it is pressed. R2 forward and L2 back is `buttons:7:6`. One
 *    side may be empty: `buttons:7:` is a single trigger, 0..1.
 *
 * Numbers are the browser's standard layout. The desktop app reports the same since
 * v1.71, and moved what it had stored once (lib/padLayout.ts). A controller with a layout
 * of its own is read through its setup (lib/input/padProfiles.ts, v1.72), so these
 * numbers mean the same control on every controller.
 */

/** Standard-layout button names, by index — both families' names for the shoulders. */
export const STANDARD_BUTTON_NAMES = [
  'A', 'B', 'X', 'Y', 'LB/L1', 'RB/R1', 'LT/L2', 'RT/R2', 'Back', 'Start',
  'L-stick', 'R-stick', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home',
] as const;

/** Standard-layout stick axes, by index. The standard counts right and DOWN as +. */
export const STANDARD_AXIS_NAMES = ['Left stick ◀▶', 'Left stick ▲▼', 'Right stick ◀▶', 'Right stick ▲▼'] as const;

/**
 * A stick axis as the direction that drives the channel up: `axis:1:inv` is "left stick ↑",
 * `axis:0` "left stick →". Axes past the four sticks keep their number.
 */
export function axisName(index: number, invert: boolean): string {
  if (index < 0 || index >= STANDARD_AXIS_NAMES.length) return `axis ${index}${invert ? ' reversed' : ''}`;
  const stick = index < 2 ? 'left stick' : 'right stick';
  const isX = index % 2 === 0;
  const arrow = isX ? (invert ? '←' : '→') : invert ? '↑' : '↓';
  return `${stick} ${arrow}`;
}

/** A button's number with its standard name, where it has one: `7 (RT/R2)`. */
export function buttonName(n: number): string {
  const name = STANDARD_BUTTON_NAMES[n];
  return name ? `${n} (${name})` : String(n);
}

export interface PairElement {
  /** The button that drives the axis towards +1, or null. */
  pos: number | null;
  /** The button that drives it towards −1, or null. */
  neg: number | null;
}

export function pairElement(pos: number | null, neg: number | null): string {
  return `buttons:${pos ?? ''}:${neg ?? ''}`;
}

/** The two buttons of a `buttons:` element, or null when the element is something else. */
export function parsePairElement(el: string | undefined): PairElement | null {
  const m = /^buttons:(\d*):(\d*)$/.exec(el ?? '');
  if (!m) return null;
  const pos = m[1] === '' ? null : Number(m[1]);
  const neg = m[2] === '' ? null : Number(m[2]);
  return pos === null && neg === null ? null : { pos, neg };
}

/**
 * How the editor shows an element: `buttons:7:6` → `+ 7 (RT/R2) · − 6 (LT/L2)`,
 * `axis:1:inv` → `left stick ↑`, `button:9` → `button 9 (Start)`.
 */
export function describeElement(el: string): string {
  const pair = parsePairElement(el);
  if (pair) {
    const parts = [];
    if (pair.pos !== null) parts.push(`+ ${buttonName(pair.pos)}`);
    if (pair.neg !== null) parts.push(`− ${buttonName(pair.neg)}`);
    return parts.join(' · ');
  }
  const axis = /^axis:(\d+)(:inv)?$/.exec(el);
  if (axis) return axisName(Number(axis[1]), !!axis[2]);
  const button = /^button:(\d+)$/.exec(el);
  return button ? `button ${buttonName(Number(button[1]))}` : el;
}
