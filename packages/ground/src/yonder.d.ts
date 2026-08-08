/** Bridge exposed by the Electron preload (absent in a plain browser). */
export interface YonderBridge {
  isElectron: boolean;
  /** Whether the native SDL controller layer is active. */
  sdlActive: boolean;
  /** Latest controller snapshots from the native SDL layer. */
  getGamepads(): { id: string; axes: number[]; buttons: boolean[] }[];
  /** Rumble a controller by index. Magnitudes 0..1. */
  rumble(index: number, low: number, high: number, ms: number): void;
}

declare global {
  interface Window {
    yonder?: YonderBridge;
  }
}

export {};
