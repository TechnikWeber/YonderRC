import type { InputSnapshot } from './bindingEngine';
import { pickGamepadProvider, type GamepadProvider } from './gamepadProvider';

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
    };
  }
}

function normKey(key: string): string {
  return key.toLowerCase();
}
function isControlKey(k: string): boolean {
  return ['arrowleft', 'arrowright', 'arrowup', 'arrowdown', ' '].includes(k);
}
