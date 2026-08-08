import { app, BrowserWindow, ipcMain } from 'electron';
import { join } from 'node:path';
import { SdlService } from './sdlService';

const isDev = process.env.YRC_DEV === '1';
const sdl = new SdlService();

async function createWindow(): Promise<void> {
  const sdlActive = await sdl.init();

  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    backgroundColor: '#0b0f14',
    title: 'YonderRC',
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload needs Node for ipc + argv
      additionalArguments: [`--yonder-sdl=${sdlActive ? '1' : '0'}`],
    },
  });

  // Push controller snapshots to the renderer at 60 Hz.
  const pump = setInterval(() => {
    if (!win.isDestroyed() && sdl.active) {
      win.webContents.send('yonder:gamepad', sdl.poll());
    }
  }, 1000 / 60);

  ipcMain.on('yonder:rumble', (_e, p: { index: number; low: number; high: number; ms: number }) => {
    sdl.rumble(p.index, p.low, p.high, p.ms);
  });

  win.on('closed', () => clearInterval(pump));

  if (isDev) {
    await win.loadURL('http://localhost:5173');
    win.webContents.openDevTools({ mode: 'detach' });
  } else {
    await win.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  sdl.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) void createWindow();
});
