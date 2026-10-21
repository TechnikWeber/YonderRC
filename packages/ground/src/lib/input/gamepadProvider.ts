/**
 * Gamepad source abstraction. The binding engine never knows where controller
 * data comes from — it just asks the InputManager, which asks the active
 * provider. In a plain browser that's the Gamepad API; inside the Electron shell
 * it's a native SDL2 bridge (window.yonder) with a far larger controller
 * database, hot-plug and rumble. Swapping providers changes nothing above.
 *
 * Both providers read ONE pad: the one `choosePad` picks — the operator's explicit
 * choice when that device is connected, otherwise the best match. Not simply the first
 * device in the list, which used to be a headset as often as a controller.
 */
import { choosePad, type PadInfo } from './gamepadPick';

export interface GamepadProvider {
  readonly kind: 'browser' | 'sdl';
  /** Display name of the active controller, or null if none is connected. */
  activeName(): string | null;
  /** The pad being read right now, or null. */
  active(): PadInfo | null;
  /** Every device the source reports — including the ones that are not controllers. */
  list(): PadInfo[];
  /** Read this device (by id) whenever it is connected; null = pick automatically. */
  setPreferred(id: string | null): void;
  /** Raw state of one listed device, for the live view in Setup. */
  peek(index: number): { axes: number[]; buttons: boolean[] } | null;
  /** Deadzoned axis value in [-1,1], or null if no controller. */
  axis(n: number): number | null;
  button(n: number): boolean;
  /** How far a button is pressed, 0..1 — analog for the triggers (6/7), 0 or 1 otherwise. */
  buttonValue(n: number): number;
  buttons(): boolean[];
  /** Best-effort haptics; no-op where unsupported. */
  rumble(low: number, high: number, ms: number): void;
}

const DEADZONE = 0.08;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);
/** A released trigger that does not quite read 0 must not creep a channel. */
const BUTTON_DEADZONE = 0.05;
export const dzButton = (v: number) => (Number.isFinite(v) && v >= BUTTON_DEADZONE ? Math.min(1, v) : 0);

function infosOf(pads: (Gamepad | null)[]): PadInfo[] {
  const out: PadInfo[] = [];
  pads.forEach((g, i) => {
    if (g && g.connected) out.push({ index: i, id: g.id, mapping: g.mapping, axes: g.axes.length, buttons: g.buttons.length });
  });
  return out;
}

class BrowserGamepadProvider implements GamepadProvider {
  readonly kind = 'browser';
  private preferred: string | null = null;

  setPreferred(id: string | null): void {
    this.preferred = id;
  }

  private raw(): (Gamepad | null)[] {
    try {
      return Array.from(navigator.getGamepads?.() ?? []);
    } catch {
      return []; // a page whose permissions policy forbids gamepads
    }
  }

  list(): PadInfo[] {
    return infosOf(this.raw());
  }

  active(): PadInfo | null {
    return choosePad(this.list(), this.preferred);
  }

  private pad(): Gamepad | null {
    const pads = this.raw();
    const chosen = choosePad(infosOf(pads), this.preferred);
    return chosen ? pads[chosen.index] ?? null : null;
  }

  peek(index: number): { axes: number[]; buttons: boolean[] } | null {
    const g = this.raw()[index];
    return g && g.connected ? { axes: [...g.axes], buttons: g.buttons.map((b) => b.pressed) } : null;
  }

  activeName(): string | null {
    return this.pad()?.id ?? null;
  }
  axis(n: number): number | null {
    const p = this.pad();
    if (!p) return null;
    const v = p.axes[n];
    return typeof v === 'number' ? dz(v) : null;
  }
  button(n: number): boolean {
    return this.pad()?.buttons[n]?.pressed ?? false;
  }
  buttonValue(n: number): number {
    const b = this.pad()?.buttons[n];
    return b ? dzButton(typeof b.value === 'number' ? b.value : b.pressed ? 1 : 0) : 0;
  }
  buttons(): boolean[] {
    return this.pad()?.buttons.map((b) => b.pressed) ?? [];
  }
  rumble(low: number, high: number, ms: number): void {
    const p = this.pad() as (Gamepad & { vibrationActuator?: { playEffect: (t: string, o: object) => void } }) | null;
    try {
      p?.vibrationActuator?.playEffect('dual-rumble', {
        duration: ms,
        strongMagnitude: high,
        weakMagnitude: low,
      });
    } catch {
      /* unsupported — ignore */
    }
  }
}

/**
 * SDL only lists devices it recognises as game controllers and maps every one of them to
 * the standard layout, so a headset never shows up here — but two controllers can, and
 * the choice applies the same way.
 */
class ElectronSdlProvider implements GamepadProvider {
  readonly kind = 'sdl';
  private preferred: string | null = null;

  setPreferred(id: string | null): void {
    this.preferred = id;
  }
  private snap() {
    return window.yonder?.getGamepads?.() ?? [];
  }
  list(): PadInfo[] {
    return this.snap().map((g, i) => ({ index: i, id: g.id, mapping: 'standard', axes: g.axes.length, buttons: g.buttons.length }));
  }
  active(): PadInfo | null {
    return choosePad(this.list(), this.preferred);
  }
  private pad() {
    const a = this.active();
    return a ? this.snap()[a.index] ?? null : null;
  }
  peek(index: number): { axes: number[]; buttons: boolean[] } | null {
    const g = this.snap()[index];
    return g ? { axes: [...g.axes], buttons: [...g.buttons] } : null;
  }
  activeName(): string | null {
    return this.pad()?.id ?? null;
  }
  axis(n: number): number | null {
    const g = this.pad();
    if (!g) return null;
    const v = g.axes[n];
    return typeof v === 'number' ? dz(v) : null;
  }
  button(n: number): boolean {
    return this.pad()?.buttons[n] ?? false;
  }
  buttonValue(n: number): number {
    const g = this.pad();
    if (!g) return 0;
    return dzButton(g.values?.[n] ?? (g.buttons[n] ? 1 : 0));
  }
  buttons(): boolean[] {
    return this.pad()?.buttons ?? [];
  }
  rumble(low: number, high: number, ms: number): void {
    // The bridge rumbles by list position, so it has to be the chosen pad's position.
    const a = this.active();
    if (!a) return;
    try {
      window.yonder?.rumble?.(a.index, low, high, ms);
    } catch {
      /* ignore */
    }
  }
}

export function pickGamepadProvider(): GamepadProvider {
  // Prefer native SDL only when the Electron shell reports it active; otherwise
  // fall back to the Chromium Gamepad API (which also works inside Electron).
  if (typeof window !== 'undefined' && window.yonder?.isElectron && window.yonder.sdlActive) {
    return new ElectronSdlProvider();
  }
  return new BrowserGamepadProvider();
}
