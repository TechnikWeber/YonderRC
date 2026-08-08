/**
 * Native controller service using @kmamal/sdl (SDL2). Runs in the Electron main
 * process. Gives the far larger SDL controller database, hot-plug and rumble that
 * the browser Gamepad API lacks. Values are normalized into the same shape the
 * renderer's ElectronSdlProvider expects: { id, axes[], buttons[] } in the
 * standard layout (axes: LX, LY, RX, RY, LT, RT; buttons: A,B,X,Y,LB,RB,…).
 *
 * The dependency is optional: if SDL is unavailable, the service reports inactive
 * and the app falls back to the Chromium Gamepad API inside Electron.
 */
export interface GamepadSnapshot {
  id: string;
  axes: number[];
  buttons: boolean[];
}

const AXIS_ORDER = ['leftStickX', 'leftStickY', 'rightStickX', 'rightStickY', 'leftTrigger', 'rightTrigger'];
const BUTTON_ORDER = [
  'a', 'b', 'x', 'y', 'leftShoulder', 'rightShoulder', 'back', 'start',
  'guide', 'leftStick', 'rightStick', 'dpadUp', 'dpadDown', 'dpadLeft', 'dpadRight',
];

export class SdlService {
  private sdl: unknown = null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private controllers = new Map<number, any>();
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
    for (const c of this.controllers.values()) {
      try {
        const axes = AXIS_ORDER.map((k) => Number(c.axes?.[k] ?? 0));
        const buttons = BUTTON_ORDER.map((k) => Boolean(c.buttons?.[k]));
        out.push({ id: String(c.name ?? c.device?.name ?? 'controller'), axes, buttons });
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
  }
}
