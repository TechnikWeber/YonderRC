import { useEffect, useRef } from 'react';
import type { InputManager } from './input/inputManager';

/**
 * App actions that can be bound to a keyboard key and/or a gamepad button, edited
 * in one place (the Controls panel) instead of being scattered. Each consumer
 * subscribes only to the actions it owns via useActionHotkeys, so App handles
 * panic/arm and VideoPanel handles record/snapshot/camera from the same config.
 */
export type ActionId =
  | 'panic-disarm'
  | 'toggle-arm'
  | 'next-camera'
  | 'record-toggle'
  | 'snapshot';

export interface ActionBinding {
  key: string | null; // keyboard key (lower-case)
  button: number | null; // gamepad button index
}
export type ActionBindings = Record<ActionId, ActionBinding>;

export const ACTION_LABELS: Record<ActionId, string> = {
  'panic-disarm': 'Panic — disarm now',
  'toggle-arm': 'Arm / disarm',
  'next-camera': 'Next camera',
  'record-toggle': 'Record start/stop',
  snapshot: 'Snapshot',
};

const KEY = 'yonderrc.actions.v1';
const DEFAULTS: ActionBindings = {
  'panic-disarm': { key: 'escape', button: null },
  'toggle-arm': { key: null, button: null },
  'next-camera': { key: 'c', button: null },
  'record-toggle': { key: 'r', button: null },
  snapshot: { key: 't', button: null },
};

export function loadActions(): ActionBindings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ActionBindings>;
      return { ...DEFAULTS, ...parsed };
    }
  } catch {
    /* ignore */
  }
  return { ...DEFAULTS };
}

export function saveActions(b: ActionBindings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(b));
  } catch {
    /* ignore */
  }
}

/**
 * Actions that may require a sustained press instead of a tap, and how long.
 * `holdMs <= 0` (or an action not listed) keeps the historic rising-edge
 * behaviour — panic-disarm is never in here, it must stay instant.
 */
export interface HoldOptions {
  holdMs: number;
  actions: ActionId[];
  /** 0..1 while a held action is being pressed, so the UI can show the same fill. */
  onProgress?: (p: number) => void;
}

/**
 * Fire the given handlers when their bound key or gamepad button is pressed.
 * Only actions present in `handlers` are watched; keydown is edge-triggered and
 * ignored while typing in a field, gamepad buttons use rising-edge detection.
 *
 * Actions listed in `hold` need the key/button held for `holdMs` before they
 * fire — the same protection the on-screen arm button has, because a bumped
 * gamepad is exactly as capable of cutting the motors as a mis-touch.
 */
export function useActionHotkeys(
  bindings: ActionBindings,
  handlers: Partial<Record<ActionId, () => void>>,
  input: InputManager,
  hold?: HoldOptions,
): void {
  const bRef = useRef(bindings);
  bRef.current = bindings;
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const holdRef = useRef(hold);
  holdRef.current = hold;

  /** Action → when its key/button went down; only for actions that need a hold. */
  const pressedAt = useRef(new Map<ActionId, number>());
  const needsHold = (id: ActionId): number => {
    const h = holdRef.current;
    return h && h.holdMs > 0 && h.actions.includes(id) ? h.holdMs : 0;
  };
  const report = (p: number) => holdRef.current?.onProgress?.(p);
  const release = (id: ActionId) => {
    if (pressedAt.current.delete(id) && pressedAt.current.size === 0) report(0);
  };

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      for (const [id, h] of Object.entries(hRef.current)) {
        if (!h || bRef.current[id as ActionId]?.key !== k) continue;
        const ms = needsHold(id as ActionId);
        if (ms > 0) pressedAt.current.set(id as ActionId, performance.now());
        else h();
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const k = e.key.toLowerCase();
      for (const id of Object.keys(hRef.current) as ActionId[]) {
        if (bRef.current[id]?.key === k) release(id);
      }
    };
    // Losing focus (alt-tab, switching to the setup tab) must not leave a key
    // "held" — it would fire the moment the window comes back.
    const onBlur = () => {
      pressedAt.current.clear();
      report(0);
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Gamepad buttons (rising edge) + the hold timer for both input kinds.
  const prev = useRef<boolean[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const btns = input.readGamepadButtons();
      for (const [aid, h] of Object.entries(hRef.current)) {
        const actionId = aid as ActionId;
        const bi = bRef.current[actionId]?.button;
        if (!h || bi == null) continue;
        const ms = needsHold(actionId);
        if (btns[bi] && !prev.current[bi]) {
          if (ms > 0) pressedAt.current.set(actionId, performance.now());
          else h();
        } else if (!btns[bi] && prev.current[bi]) {
          release(actionId);
        }
      }
      prev.current = btns;

      // Anything held long enough fires once, then waits for a release.
      const now = performance.now();
      let maxProgress = 0;
      for (const [actionId, since] of [...pressedAt.current]) {
        const ms = needsHold(actionId);
        if (ms <= 0) continue;
        const p = Math.min(1, (now - since) / ms);
        maxProgress = Math.max(maxProgress, p);
        if (p >= 1) {
          pressedAt.current.delete(actionId);
          maxProgress = 0;
          navigator.vibrate?.(60);
          hRef.current[actionId]?.();
        }
      }
      if (pressedAt.current.size > 0 || maxProgress === 0) report(maxProgress);
    }, 60);
    return () => clearInterval(id);
  }, [input]);
}
