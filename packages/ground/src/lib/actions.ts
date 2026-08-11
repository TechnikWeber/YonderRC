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
 * Fire the given handlers when their bound key or gamepad button is pressed.
 * Only actions present in `handlers` are watched; keydown is edge-triggered and
 * ignored while typing in a field, gamepad buttons use rising-edge detection.
 */
export function useActionHotkeys(
  bindings: ActionBindings,
  handlers: Partial<Record<ActionId, () => void>>,
  input: InputManager,
): void {
  const bRef = useRef(bindings);
  bRef.current = bindings;
  const hRef = useRef(handlers);
  hRef.current = handlers;

  // Keyboard.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      for (const [id, h] of Object.entries(hRef.current)) {
        if (h && bRef.current[id as ActionId]?.key === k) h();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Gamepad buttons (rising edge).
  const prev = useRef<boolean[]>([]);
  useEffect(() => {
    const id = setInterval(() => {
      const btns = input.readGamepadButtons();
      for (const [aid, h] of Object.entries(hRef.current)) {
        const bi = bRef.current[aid as ActionId]?.button;
        if (h && bi != null && btns[bi] && !prev.current[bi]) h();
      }
      prev.current = btns;
    }, 60);
    return () => clearInterval(id);
  }, [input]);
}
