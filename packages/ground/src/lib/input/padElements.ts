/**
 * The gamepad side of a binding's `element`:
 *  - `axis:N`, `axis:N:inv` — stick axis N, the second one turned around
 *  - `button:N` — button N, for switches and ramps
 *  - `buttons:P:N` — two buttons as one axis (v1.71): P pushes towards +1, N towards
 *    −1, each by how far it is pressed. R2 forward and L2 back is `buttons:7:6`. One
 *    side may be empty: `buttons:7:` is a single trigger, 0..1.
 *
 * Numbers are the browser's standard layout. The desktop app reports the same since
 * v1.71, and moved what it had stored once (lib/padLayout.ts).
 */

/** Standard-layout button names, by index — both families' names for the shoulders. */
export const STANDARD_BUTTON_NAMES = [
  'A', 'B', 'X', 'Y', 'LB/L1', 'RB/R1', 'LT/L2', 'RT/R2', 'Back', 'Start',
  'L-stick', 'R-stick', 'D-pad ↑', 'D-pad ↓', 'D-pad ←', 'D-pad →', 'Home',
] as const;

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

/** How the editor shows an element: `buttons:7:6` → `+ 7 (RT/R2) · − 6 (LT/L2)`. */
export function describeElement(el: string): string {
  const pair = parsePairElement(el);
  if (pair) {
    const parts = [];
    if (pair.pos !== null) parts.push(`+ ${buttonName(pair.pos)}`);
    if (pair.neg !== null) parts.push(`− ${buttonName(pair.neg)}`);
    return parts.join(' · ');
  }
  const button = /^button:(\d+)$/.exec(el);
  return button ? `button ${buttonName(Number(button[1]))}` : el;
}
