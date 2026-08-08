import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Resolve the shared protocol package straight to its TypeScript source so there
// is no build step in dev and the two sides always agree on the same types.
const protocolSrc = fileURLToPath(
  new URL('../protocol/src/index.ts', import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@yonderrc/protocol': protocolSrc,
    },
  },
  server: {
    host: true, // listen on all interfaces so a phone on the LAN can reach it
    port: 5173,
  },
});
