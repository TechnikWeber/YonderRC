import type { ActionBindings, ActionId } from '../actions';
import { movedAxis, newlyPressed } from './gamepadPick';

/**
 * Controller profiles (v1.72): what the app knows about one controller, stored per device
 * under the id the browser (or the desktop bridge) reports for it — so two pads of the
 * same kind share one, and a different kind gets its own.
 *
 * Models speak the standard layout: left stick, R2/L2, A, Start (lib/input/padElements.ts),
 * the same in the browser and the desktop app. A controller that reports that layout
 * itself needs nothing here. One that reports its OWN — an RC transmitter in joystick mode,
 * a pad the browser does not know — gets a LAYOUT: where the standard controls are on it,
 * learned once in Setup › Controls › Game controller. Every model then works with it,
 * instead of each model being learned again for each controller. Anything the layout does
 * not mention keeps the controller's own number, which is exactly how it was read before.
 *
 * A profile can also carry the controller's own ACTION BUTTONS (arm, panic, trims …).
 * Without them the shared buttons apply — as they did for every controller before.
 */

export const PADS_KEY = 'yonderrc.pads.v1';

/** The standard layout's sticks and buttons (W3C "standard" mapping). */
export const STANDARD_AXIS_COUNT = 4;
export const STANDARD_BUTTON_COUNT = 17;

/** Where a standard stick axis is on this controller. */
export interface AxisSource {
  axis: number;
  invert?: boolean;
}

/**
 * Where a standard button is: a button of the controller, or one of its axes read as a
 * button — 0 at `from`, 1 at `to`. That covers a switch an RC transmitter reports as an
 * axis (−1 → +1), a trigger resting at −1, and half a stick (0 → ±1).
 */
export type ButtonSource = { button: number } | { axis: number; from: number; to: number };

/**
 * Standard number → where it is on this controller. A number that is absent is read from
 * the controller's own number; `null` means the controller has no such control.
 */
export interface PadLayout {
  axes?: Record<number, AxisSource | null>;
  buttons?: Record<number, ButtonSource | null>;
}

export interface PadProfile {
  layout?: PadLayout;
  /** This controller's own action buttons (standard numbers); absent = the shared ones. */
  actions?: Partial<Record<ActionId, number | null>>;
}

export type PadProfiles = Record<string, PadProfile>;

/** What a controller reports: the Gamepad API's shape, which the desktop bridge is adapted to. */
export interface RawPad {
  axes: readonly number[];
  buttons: readonly { pressed: boolean; value: number }[];
}

export interface ButtonState {
  pressed: boolean;
  value: number;
}

const RELEASED: ButtonState = { pressed: false, value: 0 };
/** An axis read as a button counts as pressed past half its travel — a nudged stick is not a press. */
const AXIS_PRESSED = 0.5;

/** Standard axis `n` on this controller, −1..1; null when it has no such axis at all. */
export function stdAxis(raw: RawPad, layout: PadLayout | undefined, n: number): number | null {
  const src = layout?.axes?.[n];
  if (src === null) return 0;
  const v = raw.axes[src === undefined ? n : src.axis];
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return src?.invert ? -v : v;
}

/** Standard button `n` on this controller: pressed, and how far (0..1). */
export function stdButton(raw: RawPad, layout: PadLayout | undefined, n: number): ButtonState {
  const src = layout?.buttons?.[n];
  if (src === null) return RELEASED;
  if (src === undefined || 'button' in src) {
    const b = raw.buttons[src === undefined ? n : src.button];
    if (!b) return RELEASED;
    const value = typeof b.value === 'number' && Number.isFinite(b.value) ? b.value : b.pressed ? 1 : 0;
    return { pressed: !!b.pressed, value };
  }
  return axisAsButton(raw.axes[src.axis], src);
}

/** An axis read as a button: 0 at `from`, 1 at `to`, clamped. */
export function axisAsButton(v: number | undefined, src: { from: number; to: number }): ButtonState {
  if (typeof v !== 'number' || !Number.isFinite(v) || src.to === src.from) return RELEASED;
  const t = Math.max(0, Math.min(1, (v - src.from) / (src.to - src.from)));
  return { pressed: t > AXIS_PRESSED, value: t };
}

/** Every button's pressed state in standard numbers — what Learn and the action buttons watch. */
export function stdButtons(raw: RawPad, layout: PadLayout | undefined): boolean[] {
  if (!layout) return raw.buttons.map((b) => !!b.pressed);
  const count = Math.max(STANDARD_BUTTON_COUNT, raw.buttons.length);
  return Array.from({ length: count }, (_, n) => stdButton(raw, layout, n).pressed);
}

/** A live view (`peek`: axes and pressed flags) as a RawPad. */
export function rawFromPeek(p: { axes: readonly (number | null)[]; buttons: readonly boolean[] }): RawPad {
  return {
    axes: p.axes.map((v) => (typeof v === 'number' ? v : NaN)),
    buttons: p.buttons.map((pressed) => ({ pressed, value: pressed ? 1 : 0 })),
  };
}

// ---- learning ----

/**
 * Learn a standard stick axis from a move away from where everything rested. The
 * operator is asked to move it RIGHT (the X axes, 0 and 2) or UP (the Y axes, 1 and 3);
 * the standard counts right as + and up as −, which is what decides `invert`.
 * Buttons are ignored — a stick is an axis. Null while nothing moved far enough.
 */
export function learnAxisSource(
  target: number,
  baseline: readonly (number | null)[],
  now: readonly (number | null)[],
  threshold = 0.6,
): AxisSource | null {
  const j = movedAxis(baseline, now, threshold);
  if (j < 0) return null;
  const delta = (now[j] ?? 0) - (baseline[j] ?? 0);
  const isX = target % 2 === 0;
  const invert = isX ? delta < 0 : delta > 0;
  return invert ? { axis: j, invert: true } : { axis: j };
}

/** Where an axis rests, as one of its three positions: a stick centres, a trigger or a switch sits at an end. */
function restPosition(v: number): -1 | 0 | 1 {
  if (v <= -0.5) return -1;
  if (v >= 0.5) return 1;
  return 0;
}

/**
 * Learn a standard button: a controller button pressed since learning began — or, failing
 * that, an axis that moved: a switch flipped, a trigger pulled, a stick pushed. The axis is
 * then read from where it rested to the far end it moved towards.
 */
export function learnButtonSource(
  baseline: { axes: readonly (number | null)[]; buttons: readonly boolean[] },
  now: { axes: readonly (number | null)[]; buttons: readonly boolean[] },
  threshold = 0.6,
): ButtonSource | null {
  const b = newlyPressed(baseline.buttons, now.buttons);
  if (b >= 0) return { button: b };
  const j = movedAxis(baseline.axes, now.axes, threshold);
  if (j < 0) return null;
  const from = restPosition(baseline.axes[j] ?? 0);
  const to = from === 0 ? (Math.sign((now.axes[j] ?? 0) - (baseline.axes[j] ?? 0)) || 1) : -from;
  return { axis: j, from, to };
}

// ---- editing (pure; empty profiles are dropped) ----

function tidy(profiles: PadProfiles, id: string, next: PadProfile): PadProfiles {
  const out = { ...profiles };
  const layout = next.layout;
  const emptyLayout = !layout || (!Object.keys(layout.axes ?? {}).length && !Object.keys(layout.buttons ?? {}).length);
  const clean: PadProfile = {};
  if (!emptyLayout) {
    clean.layout = {};
    if (Object.keys(layout!.axes ?? {}).length) clean.layout.axes = layout!.axes;
    if (Object.keys(layout!.buttons ?? {}).length) clean.layout.buttons = layout!.buttons;
  }
  if (next.actions) clean.actions = next.actions;
  if (clean.layout || clean.actions) out[id] = clean;
  else delete out[id];
  return out;
}

/** Set (or with `undefined` forget) where standard axis `n` is on controller `id`. */
export function withAxisSource(profiles: PadProfiles, id: string, n: number, src: AxisSource | null | undefined): PadProfiles {
  const p = profiles[id] ?? {};
  const axes = { ...(p.layout?.axes ?? {}) };
  if (src === undefined) delete axes[n];
  else axes[n] = src;
  return tidy(profiles, id, { ...p, layout: { ...p.layout, axes } });
}

/** Set (or with `undefined` forget) where standard button `n` is on controller `id`. */
export function withButtonSource(profiles: PadProfiles, id: string, n: number, src: ButtonSource | null | undefined): PadProfiles {
  const p = profiles[id] ?? {};
  const buttons = { ...(p.layout?.buttons ?? {}) };
  if (src === undefined) delete buttons[n];
  else buttons[n] = src;
  return tidy(profiles, id, { ...p, layout: { ...p.layout, buttons } });
}

/** Back to the controller's own numbers. */
export function withoutLayout(profiles: PadProfiles, id: string): PadProfiles {
  const p = profiles[id];
  return p ? tidy(profiles, id, { ...p, layout: undefined }) : profiles;
}

/** Give controller `id` its own action buttons, starting from the shared ones. */
export function withOwnActions(profiles: PadProfiles, id: string, shared: ActionBindings): PadProfiles {
  const actions: Partial<Record<ActionId, number | null>> = {};
  for (const a of Object.keys(shared) as ActionId[]) actions[a] = shared[a]?.button ?? null;
  return tidy(profiles, id, { ...(profiles[id] ?? {}), actions });
}

/** Set one of controller `id`'s own action buttons. */
export function withOwnActionButton(profiles: PadProfiles, id: string, action: ActionId, button: number | null): PadProfiles {
  const p = profiles[id] ?? {};
  return tidy(profiles, id, { ...p, actions: { ...(p.actions ?? {}), [action]: button } });
}

/** Controller `id` uses the shared action buttons again. */
export function withoutOwnActions(profiles: PadProfiles, id: string): PadProfiles {
  const p = profiles[id];
  return p ? tidy(profiles, id, { ...p, actions: undefined }) : profiles;
}

/**
 * The action bindings in effect while controller `profile` is in use: the shared ones,
 * with its own buttons where it has them. Keys always stay shared — there is one keyboard.
 */
export function padActionsFor(shared: ActionBindings, profile: PadProfile | undefined): ActionBindings {
  const own = profile?.actions;
  if (!own) return shared;
  const out = { ...shared };
  for (const id of Object.keys(shared) as ActionId[]) {
    if (Object.prototype.hasOwnProperty.call(own, id)) out[id] = { ...shared[id], button: own[id] ?? null };
  }
  return out;
}

/** Device axes that end up as more than one standard stick axis — a setup half done. */
export function sharedStickAxes(layout: PadLayout | undefined): number[] {
  if (!layout?.axes) return [];
  const count = new Map<number, number>();
  for (let n = 0; n < STANDARD_AXIS_COUNT; n++) {
    const src = layout.axes[n];
    if (src === null) continue;
    const raw = src === undefined ? n : src.axis;
    count.set(raw, (count.get(raw) ?? 0) + 1);
  }
  return [...count].filter(([, c]) => c > 1).map(([a]) => a).sort((a, b) => a - b);
}

// ---- what the setup table shows ----

const end = (v: number) => (v > 0 ? '+1' : v < 0 ? '−1' : '0');

export function describeAxisSource(src: AxisSource | null | undefined, n: number): string {
  if (src === null) return 'none';
  if (src === undefined) return `axis ${n} — its own number`;
  return `axis ${src.axis}${src.invert ? ' · reversed' : ''}`;
}

export function describeButtonSource(src: ButtonSource | null | undefined, n: number): string {
  if (src === null) return 'none';
  if (src === undefined) return `button ${n} — its own number`;
  if ('button' in src) return `button ${src.button}`;
  return `axis ${src.axis} · ${end(src.from)} → ${end(src.to)}`;
}

// ---- storage ----

type Store = { getItem(k: string): string | null; setItem(k: string, v: string): void };

const MAX_INDEX = 63;
const isIndex = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= MAX_INDEX;
const isEnd = (v: unknown): v is number => v === -1 || v === 0 || v === 1;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function cleanAxisSource(v: unknown): AxisSource | null | undefined {
  if (v === null) return null;
  if (!isObject(v) || !isIndex(v.axis)) return undefined;
  return v.invert === true ? { axis: v.axis, invert: true } : { axis: v.axis };
}

function cleanButtonSource(v: unknown): ButtonSource | null | undefined {
  if (v === null) return null;
  if (!isObject(v)) return undefined;
  if (isIndex(v.button)) return { button: v.button };
  if (isIndex(v.axis) && isEnd(v.from) && isEnd(v.to) && v.from !== v.to) return { axis: v.axis, from: v.from, to: v.to };
  return undefined;
}

function cleanTable<T>(v: unknown, count: number, clean: (x: unknown) => T | null | undefined): Record<number, T | null> | undefined {
  if (!isObject(v)) return undefined;
  const out: Record<number, T | null> = {};
  for (let n = 0; n < count; n++) {
    if (!Object.prototype.hasOwnProperty.call(v, String(n))) continue;
    const c = clean(v[String(n)]);
    if (c !== undefined) out[n] = c;
  }
  return Object.keys(out).length ? out : undefined;
}

/** Whatever storage holds, reduced to what this version understands; anything else is dropped. */
export function cleanPadProfiles(v: unknown): PadProfiles {
  const out: PadProfiles = {};
  if (!isObject(v)) return out;
  for (const [id, raw] of Object.entries(v)) {
    if (!id || id.length > 300 || !isObject(raw)) continue;
    const p: PadProfile = {};
    if (isObject(raw.layout)) {
      const axes = cleanTable(raw.layout.axes, STANDARD_AXIS_COUNT, cleanAxisSource);
      const buttons = cleanTable(raw.layout.buttons, STANDARD_BUTTON_COUNT, cleanButtonSource);
      if (axes || buttons) p.layout = { ...(axes ? { axes } : {}), ...(buttons ? { buttons } : {}) };
    }
    if (isObject(raw.actions)) {
      const actions: Partial<Record<ActionId, number | null>> = {};
      for (const [a, b] of Object.entries(raw.actions)) {
        if (/^[a-z][a-z-]{0,40}$/.test(a) && (b === null || isIndex(b))) actions[a as ActionId] = b;
      }
      if (Object.keys(actions).length) p.actions = actions;
    }
    if (p.layout || p.actions) out[id] = p;
  }
  return out;
}

export function loadPadProfiles(store: Store | null | undefined): PadProfiles {
  try {
    const raw = store?.getItem(PADS_KEY);
    return raw ? cleanPadProfiles(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function savePadProfiles(store: Store | null | undefined, profiles: PadProfiles): void {
  try {
    store?.setItem(PADS_KEY, JSON.stringify(profiles));
  } catch {
    /* private mode — the setup lasts for this session only */
  }
}
