# YonderRC Desktop (Electron)

The desktop shell wraps the same ground web app in an Electron window for Windows
and Linux, and adds a **native SDL2 controller layer**: hundreds of controller
mappings, hot-plug, and rumble — beyond what the browser Gamepad API offers. When
SDL isn't available it transparently falls back to Chromium's Gamepad API, so the
app always runs.

Nothing above the input layer changes: the same profiles, bindings and engine
drive the vehicle whether controllers come from SDL or the browser.

## Develop

Run the ground dev server and the vehicle, then launch Electron pointed at it:

```bash
# terminal 1 — ground web app at http://localhost:5173
npm run dev:ground
# terminal 2 — vehicle (sim)
npm run dev:vehicle
# terminal 3 — Electron shell
npm run dev:desktop
```

`dev:desktop` compiles the main/preload TypeScript and starts Electron with
`YRC_DEV=1`, loading the dev server (with hot reload) and opening dev tools.

## Build installers

Every published release gets them automatically: `.github/workflows/desktop.yml` builds
on Windows and Linux and attaches `YonderRC-<version>-windows-setup.exe`,
`…-windows-portable.exe` and `…-linux-x86_64.AppImage`. Unsigned. To build by hand (each
OS builds its own; an AppImage needs Linux):

```bash
npm run build:desktop
```

This compiles the shell, builds the ground app into `renderer/` with relative paths
(`--base ./`, because the installed app loads it from a file) and runs electron-builder
(`electron-builder.config.cjs`) into `packages/desktop/release/`.

Two things that used to break it:

- **Install scripts.** npm 11 skips dependency install scripts unless `allowScripts` in the
  root `package.json` lists them; without electron's, there is no Electron binary.
- **`npmRebuild: false`.** electron-builder's "installing production dependencies" step
  runs a production install over the whole workspace and deletes every dev tool mid-build.
  `@kmamal/sdl` is N-API and prebuilt, so nothing needs rebuilding.

## Talking to a vehicle

The installed app loads the ground from `file://`, so Chromium labels its requests
`Sec-Fetch-Site: cross-site` with `Origin: null`, which a vehicle refuses as a page from
the internet. `markRequestsAsLocal` in `src/main.ts` rewrites this window's own requests
to `Origin: file://` (what its control WebSocket already sends), so video and setup work
with every vehicle, old ones included. In dev the page comes from `localhost:5173` and
needs none of this.

## SDL note

`@kmamal/sdl` is an optional dependency shipping prebuilt SDL2 binaries. On Linux
you may need the system SDL2 runtime (`sudo apt install libsdl2-2.0-0`). If SDL
fails to load, the app logs a warning and uses the Chromium Gamepad API instead.

## How the input bridge works

- **main** (`src/main.ts`) starts `SdlService`, polls controllers at 60 Hz and
  pushes snapshots to the renderer; it also handles rumble requests.
- **preload** (`src/preload.ts`) caches the latest snapshots and exposes
  `window.yonder` (`isElectron`, `sdlActive`, `getGamepads()`, `rumble()`).
- **renderer** (the ground app) picks the SDL provider when `sdlActive`, else the
  browser provider — see `packages/ground/src/lib/input/gamepadProvider.ts`.
