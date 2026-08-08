// Copy the built ground web app into the desktop package for packaging.
import { cp, rm, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const groundDist = fileURLToPath(new URL('../../ground/dist', import.meta.url));
const dest = fileURLToPath(new URL('../renderer', import.meta.url));

try {
  await access(groundDist);
} catch {
  console.error('ground/dist not found — run `npm --prefix ../ground run build` first.');
  process.exit(1);
}
await rm(dest, { recursive: true, force: true });
await cp(groundDist, dest, { recursive: true });
console.log('copied ground/dist → desktop/renderer');
