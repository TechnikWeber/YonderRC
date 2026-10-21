/**
 * Native controller service using @kmamal/sdl (SDL2). Runs in the Electron main
 * process. Gives the far larger SDL controller database, hot-plug and rumble that
 * the browser Gamepad API lacks. Values are normalized into the shape the renderer's
 * ElectronSdlProvider expects, in the browser's own **standard layout** — so a
 * binding means the same button in the browser and in the desktop app.
 *
 * The dependency is optional: if SDL is unavailable, the service reports inactive
 * and the app falls back to the Chromium Gamepad API inside Electron.
 */
export interface GamepadSnapshot {
  id: string;
  axes: number[];
  buttons: boolean[];
  /** Per button 0..1: how far a trigger is pulled; 0 or 1 for every other button. */
  values: number[];
}

/**
 * The W3C "standard" gamepad: axes LX, LY, RX, RY; buttons A, B, X, Y, LB, RB, LT, RT,
 * Back, Start, L-stick, R-stick, D-pad up/down/left/right, Guide — the triggers as
 * analog buttons 6 and 7, the way the browser reports them.
 *
 * Up to v1.70 this was SDL's own order: Back and Start at 6/7 where the browser has
 * the triggers, every button after that one place off, and the triggers as axes 4/5.
 * A binding learned in the browser meant another button in the desktop app, and the
 * triggers could not be used as buttons at all. Stored desktop bindings are moved to
 * this layout once, by the ground (`lib/padLayout.ts`).
 */
export const STANDARD_BUTTONS = [
  'a', 'b', 'x', 'y', 'leftShoulder', 'rightShoulder', 'leftTrigger', 'rightTrigger',
  'back', 'start', 'leftStick', 'rightStick', 'dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight', 'guide',
] as const;
const STANDARD_AXES = ['leftStickX', 'leftStickY', 'rightStickX', 'rightStickY'] as const;
const TRIGGERS = ['leftTrigger', 'rightTrigger'] as const;
type Trigger = (typeof TRIGGERS)[number];
export type TriggerRest = Record<Trigger, number>;

/** Travel past which a trigger counts as pressed — about where a browser says so too. */
export const TRIGGER_PRESSED = 0.12;

/**
 * How far a trigger is pulled, 0..1, measured from where it rests.
 *
 * @kmamal/sdl scales an axis against the joystick's first raw reading, and a trigger
 * whose raw range starts at the bottom then reads about 0.5 released and 1 pulled.
 * Others read 0 released. So the trigger's own rest is the reference, not 0.
 */
export function triggerTravel(value: number, rest: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(rest)) return 0;
  const span = 1 - rest;
  if (span <= 0.05) return 0; // no travel left to measure
  return Math.max(0, Math.min(1, (value - rest) / span));
}

/** A fresh rest record: the first reading of each trigger becomes its rest. */
export function freshTriggerRest(): TriggerRest {
  return { leftTrigger: Infinity, rightTrigger: Infinity };
}

/**
 * One controller in the standard layout. `rest` is the controller's trigger record and
 * is lowered to every reading below it: a trigger held while the pad was plugged in
 * finds its true rest the moment it is let go.
 */
export function standardSnapshot(
  id: string,
  axes: Record<string, unknown> | undefined,
  buttons: Record<string, unknown> | undefined,
  rest: TriggerRest,
): GamepadSnapshot {
  for (const t of TRIGGERS) {
    const v = Number(axes?.[t] ?? 0);
    if (Number.isFinite(v) && v < rest[t]) rest[t] = v;
  }
  const values = STANDARD_BUTTONS.map((k) =>
    k === 'leftTrigger' || k === 'rightTrigger' ? triggerTravel(Number(axes?.[k] ?? 0), rest[k]) : buttons?.[k] ? 1 : 0,
  );
  return {
    id,
    axes: STANDARD_AXES.map((k) => Number(axes?.[k] ?? 0) || 0),
    buttons: STANDARD_BUTTONS.map((k, i) => (k === 'leftTrigger' || k === 'rightTrigger' ? values[i] > TRIGGER_PRESSED : values[i] === 1)),
    values,
  };
}

export class SdlService {
  private sdl: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private controllers = new Map<number, any>();
  /** Each open controller's trigger rests (see standardSnapshot). */
  private triggerRest = new Map<number, TriggerRest>();
  private _active = false;

  get active(): boolean {
    return this._active;
  }

  async init(): Promise<boolean> {
    try {
      const name = '@kmamal/sdl';
      const mod = await import(name);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const sdl: any = (mod as any).default ?? mod;
      this.sdl = sdl;

      const open = (device: unknown) => {
        try {
          const c = sdl.controller.openDevice(device);
          this.controllers.set((device as { id: number }).id, c);
          this.triggerRest.set((device as { id: number }).id, freshTriggerRest());
        } catch {
          /* ignore a controller that won't open */
        }
      };
      // Open already-connected controllers, then track hot-plug.
      for (const dev of sdl.controller.devices) open(dev);
      sdl.controller.on('deviceAdd', (e: { device: unknown }) => open(e.device));
      sdl.controller.on('deviceRemove', (e: { device: { id: number } }) => {
        const c = this.controllers.get(e.device.id);
        try {
          c?.close();
        } catch {
          /* ignore */
        }
        this.controllers.delete(e.device.id);
        this.triggerRest.delete(e.device.id);
      });

      this._active = true;
      return true;
    } catch (err) {
      console.warn('[sdl] unavailable, falling back to Chromium gamepads:', (err as Error).message);
      this._active = false;
      return false;
    }
  }

  /** Current snapshots of all open controllers. */
  poll(): GamepadSnapshot[] {
    const out: GamepadSnapshot[] = [];
    for (const [deviceId, c] of this.controllers) {
      try {
        let rest = this.triggerRest.get(deviceId);
        if (!rest) this.triggerRest.set(deviceId, (rest = freshTriggerRest()));
        out.push(standardSnapshot(String(c.name ?? c.device?.name ?? 'controller'), c.axes, c.buttons, rest));
      } catch {
        /* skip a controller that errored this frame */
      }
    }
    return out;
  }

  rumble(index: number, low: number, high: number, ms: number): void {
    const c = [...this.controllers.values()][index];
    try {
      c?.rumble?.(low, high, ms);
    } catch {
      /* unsupported — ignore */
    }
  }

  close(): void {
    for (const c of this.controllers.values()) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    this.controllers.clear();
    this.triggerRest.clear();
  }
}
