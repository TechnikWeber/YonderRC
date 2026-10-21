import type { ChannelBinding, Profile } from '@yonderrc/protocol';
import { pairElement } from './input/padElements';
import { ACTIONS_KEY, LEGACY_ACTIONS_KEY } from './actions';
import { PROFILES_KEY } from './profiles';

/**
 * The desktop app's controller numbers, moved to the standard layout once (v1.71).
 *
 * Up to v1.70 the desktop app reported controllers in SDL's own order: Back and Start
 * at 6/7 where the browser has the triggers, Guide at 8, everything after one place
 * off, and the triggers as axes 4/5. What was learned there worked there and only
 * there — "Start" was button 9 in the browser and 7 in the desktop app. Since v1.71
 * the desktop reports the browser's layout (packages/desktop/src/sdlService.ts), so
 * what it stored is renumbered once, and every binding keeps its physical button.
 */

/** v1.70 desktop button index → standard index. */
export const SDL_TO_STANDARD: readonly number[] = [0, 1, 2, 3, 4, 5, 8, 9, 16, 10, 11, 12, 13, 14, 15];

/** Set once the stored numbers are standard — in the browser from the start. */
export const PAD_LAYOUT_KEY = 'yonderrc.padLayout';
const STANDARD = 'standard';

/** One gamepad element in the old desktop numbering, renumbered. */
export function elementFromSdl(el: string): string {
  const button = /^button:(\d+)$/.exec(el);
  if (button) {
    const to = SDL_TO_STANDARD[Number(button[1])];
    return to === undefined ? el : `button:${to}`;
  }
  // The triggers were axes 4 (left) and 5 (right), 0 released: now buttons 6/7 and
  // their travel — the same 0..1, as a two-button axis with one side.
  const trigger = /^axis:(4|5)(:inv)?$/.exec(el);
  if (trigger) {
    const b = trigger[1] === '4' ? 6 : 7;
    return trigger[2] ? pairElement(null, b) : pairElement(b, null);
  }
  return el;
}

function bindingFromSdl(b: ChannelBinding): ChannelBinding {
  if (b.source !== 'gamepad') return b;
  const element = elementFromSdl(b.element);
  if (element === b.element) return b;
  const moved = { ...b, element };
  // A stick moved onto a trigger is no longer the template's stick.
  if (element.startsWith('buttons:')) delete moved.stickAxis;
  return moved;
}

export function profileFromSdl(p: Profile): Profile {
  if (!Array.isArray(p?.bindings)) return p;
  return { ...p, bindings: p.bindings.map(bindingFromSdl) };
}

type StoredActions = Record<string, { key?: string | null; button?: number | null } | undefined>;

export function actionsFromSdl(a: StoredActions): StoredActions {
  const out: StoredActions = {};
  for (const [id, binding] of Object.entries(a)) {
    const button = binding?.button;
    const to = typeof button === 'number' ? SDL_TO_STANDARD[button] : undefined;
    out[id] = binding && to !== undefined ? { ...binding, button: to } : binding;
  }
  return out;
}

interface Store {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * Run once, before anything loads a model. Only a desktop app whose native controller
 * layer is active stored SDL numbers; anywhere else they were standard already and
 * only the mark is set. The mark is set whatever happens, so nothing is ever
 * renumbered twice — a second pass would move Back from 8 on to Guide.
 */
export function migratePadLayout(store: Store, sdlActive: boolean): 'moved' | 'marked' | 'done' {
  if (store.getItem(PAD_LAYOUT_KEY) === STANDARD) return 'done';
  try {
    if (sdlActive) {
      rewrite(store, PROFILES_KEY, (v) => (Array.isArray(v) ? v.map((p) => profileFromSdl(p as Profile)) : v));
      for (const key of [ACTIONS_KEY, LEGACY_ACTIONS_KEY]) {
        rewrite(store, key, (v) => (v && typeof v === 'object' && !Array.isArray(v) ? actionsFromSdl(v as StoredActions) : v));
      }
    }
  } finally {
    store.setItem(PAD_LAYOUT_KEY, STANDARD);
  }
  return sdlActive ? 'moved' : 'marked';
}

/** Rewrite one stored JSON value; a value that does not parse is left as it is. */
function rewrite(store: Store, key: string, fn: (v: unknown) => unknown): void {
  const raw = store.getItem(key);
  if (!raw) return;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return;
  }
  store.setItem(key, JSON.stringify(fn(parsed)));
}
