import { contextBridge, ipcRenderer } from 'electron';

/**
 * Preload bridge. Caches the latest controller snapshots pushed from main and
 * exposes them synchronously so the renderer's InputManager can poll them exactly
 * like navigator.getGamepads(). Also exposes rumble.
 */
type Snapshot = { id: string; axes: number[]; buttons: boolean[] };
let gamepads: Snapshot[] = [];

ipcRenderer.on('yonder:gamepad', (_e, data: Snapshot[]) => {
  gamepads = data;
});

const sdlActive = process.argv.some((a) => a === '--yonder-sdl=1');

contextBridge.exposeInMainWorld('yonder', {
  isElectron: true,
  sdlActive,
  getGamepads: () => gamepads,
  rumble: (index: number, low: number, high: number, ms: number) =>
    ipcRenderer.send('yonder:rumble', { index, low, high, ms }),
});
