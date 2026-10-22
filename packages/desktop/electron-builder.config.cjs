// Installers for the desktop app (`npm run build:desktop`).
//
// JS rather than YAML for one line: electron-builder reads Electron's version from this
// package's own node_modules, but npm workspaces hoist electron to the repo root, so the
// build stopped with "Cannot compute electron version". Read it from where it is.
const { version: electronVersion } = require('electron/package.json');

module.exports = {
  appId: 'com.yonderrc.desktop',
  productName: 'YonderRC',
  electronVersion,
  // No "installing production dependencies" step: in an npm workspace it runs a production
  // install over the whole repo and deletes every dev tool, electron-builder included,
  // mid-build. Nothing needs it — @kmamal/sdl ships prebuilt N-API binaries, which do not
  // depend on the Electron version.
  npmRebuild: false,
  directories: { output: 'release' },
  files: ['dist/**', 'renderer/**', 'package.json'],
  // @kmamal/sdl ships native binaries; keep it unpacked so it loads at runtime.
  asarUnpack: ['node_modules/@kmamal/**'],
  // One predictable name per file, so the release page and the docs can point at them.
  artifactName: 'YonderRC-${version}-${os}-${arch}.${ext}',
  win: { target: ['nsis', 'portable'] },
  portable: { artifactName: 'YonderRC-${version}-windows-portable.${ext}' },
  nsis: { artifactName: 'YonderRC-${version}-windows-setup.${ext}' },
  // AppImage only: one file that runs on any desktop Linux, no package to maintain.
  linux: { target: ['AppImage'], category: 'Utility' },
};
