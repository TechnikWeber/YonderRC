/**
 * Gamepad source abstraction. The binding engine never knows where controller
 * data comes from — it just asks the InputManager, which asks the active
 * provider. In a plain browser that's the Gamepad API; inside the Electron shell
 * it's a native SDL2 bridge (window.yonder) with a far larger controller
 * database, hot-plug and rumble. Swapping providers changes nothing above.
 */

export interface GamepadProvider {
  readonly kind: 'browser' | 'sdl';
  /** Display name of the active controller, or null if none is connected. */
  activeName(): string | null;
  /** Deadzoned axis value in [-1,1], or null if no controller. */
  axis(n: number): number | null;
  button(n: number): boolean;
  buttons(): boolean[];
  /** Best-effort haptics; no-op where unsupported. */
  rumble(low: number, high: number, ms: number): void;
}

const DEADZONE = 0.08;
const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);

class BrowserGamepadProvider implements GamepadProvider {
  readonly kind = 'browser';
  private index: number | null = null;

  private pad(): Gamepad | null {
    const pads = navigator.getGamepads?.() ?? [];
    if (this.index !== null && pads[this.index]?.connected) return pads[this.index];
    for (let i = 0; i < pads.length; i++) {
      if (pads[i]?.connected) {
        this.index = i;
        return pads[i];
      }
    }
    this.index = null;
    return null;
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

class ElectronSdlProvider implements GamepadProvider {
  readonly kind = 'sdl';
  private snap() {
    return window.yonder?.getGamepads?.() ?? [];
  }
  activeName(): string | null {
    return this.snap()[0]?.id ?? null;
  }
  axis(n: number): number | null {
    const g = this.snap()[0];
    if (!g) return null;
    const v = g.axes[n];
    return typeof v === 'number' ? dz(v) : null;
  }
  button(n: number): boolean {
    return this.snap()[0]?.buttons[n] ?? false;
  }
  buttons(): boolean[] {
    return this.snap()[0]?.buttons ?? [];
  }
  rumble(low: number, high: number, ms: number): void {
    try {
      window.yonder?.rumble?.(0, low, high, ms);
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
