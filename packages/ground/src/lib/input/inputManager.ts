import type { InputSnapshot } from './bindingEngine';
import { pickGamepadProvider, type GamepadProvider } from './gamepadProvider';
import { loadPadPref, savePadPref, type PadInfo } from './gamepadPick';

const storage = () => (typeof localStorage !== 'undefined' ? localStorage : null);

/**
 * Raw input aggregator. Tracks keyboard, on-screen buttons and virtual joysticks,
 * and delegates all controller reads to a GamepadProvider (browser Gamepad API,
 * or the native SDL bridge when running inside the Electron shell). Hands the
 * BindingEngine a snapshot each tick.
 */
export class InputManager {
  private keys = new Set<string>();
  private pressed = new Set<string>(); // on-screen buttons, by binding id
  private joysticks = new Map<string, { x: number; y: number }>();
  private gamepad: GamepadProvider = pickGamepadProvider();
  private padPref: string | null = loadPadPref(storage());

  constructor() {
    this.gamepad.setPreferred(this.padPref);
  }

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }
  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  private onKeyDown = (e: KeyboardEvent) => {
    // Typing into a field is typing, not driving. Every key used to count: a space never
    // reached a label or a model name, and on a keyboard model a "w" typed into the
    // vehicle address was throttle.
    if (isTypingTarget(e.target)) return;
    this.keys.add(normKey(e.key));
    if (isControlKey(normKey(e.key))) e.preventDefault();
  };
  private onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(normKey(e.key));
  };
  private onBlur = () => {
    this.keys.clear();
    this.pressed.clear();
  };

  setPressed(bindingId: string, pressed: boolean): void {
    if (pressed) this.pressed.add(bindingId);
    else this.pressed.delete(bindingId);
  }
  isPressed(bindingId: string): boolean {
    return this.pressed.has(bindingId);
  }

  setJoystick(id: string, x: number, y: number): void {
    this.joysticks.set(id, { x, y });
  }

  /** Name of the active controller (or null). Also reports the source kind. */
  pollGamepadName(): string | null {
    return this.gamepad.activeName();
  }
  get gamepadKind(): 'browser' | 'sdl' {
    return this.gamepad.kind;
  }

  readGamepadAxis(n: number): number | null {
    return this.gamepad.axis(n);
  }
  readGamepadButtons(): boolean[] {
    return this.gamepad.buttons();
  }

  /** Every device the browser lists — controllers and the things that only claim to be. */
  listGamepads(): PadInfo[] {
    return this.gamepad.list();
  }
  /** The device being read right now. */
  activeGamepad(): PadInfo | null {
    return this.gamepad.active();
  }
  /** Raw state of one listed device (Setup's live view). */
  peekGamepad(index: number): { axes: number[]; buttons: boolean[] } | null {
    return this.gamepad.peek(index);
  }
  /** The operator's explicit choice (by id), or null for automatic. */
  get preferredGamepad(): string | null {
    return this.padPref;
  }
  /** Choose a device, or null for automatic. Remembered in this browser. */
  setPreferredGamepad(id: string | null): void {
    this.padPref = id;
    this.gamepad.setPreferred(id);
    savePadPref(storage(), id);
  }

  /** Haptic feedback (e.g. on failsafe). No-op where unsupported. */
  rumble(low = 0.6, high = 0.9, ms = 250): void {
    this.gamepad.rumble(low, high, ms);
  }

  snapshot(): InputSnapshot {
    return {
      keys: this.keys,
      pressed: this.pressed,
      joystick: (id) => this.joysticks.get(id) ?? null,
      gamepadAxis: (n) => this.gamepad.axis(n),
      gamepadButton: (n) => this.gamepad.button(n),
      gamepadButtonValue: (n) => this.gamepad.buttonValue(n),
    };
  }
}

function normKey(key: string): string {
  return key.toLowerCase();
}

/** A text field, a select or editable text — not a checkbox, a radio or a button. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as { tagName?: unknown; type?: unknown; isContentEditable?: unknown } | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT') return true;
  if (el.tagName === 'INPUT') return !['checkbox', 'radio', 'button', 'range', 'submit', 'reset'].includes(String(el.type));
  return el.isContentEditable === true;
}
function isControlKey(k: string): boolean {
  return ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k);
}
