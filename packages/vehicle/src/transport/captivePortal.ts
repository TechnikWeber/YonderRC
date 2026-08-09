import { createServer } from 'node:http';

/**
 * Captive-portal helper. In AP mode the Pi's DNS resolves every host to itself;
 * this tiny port-80 server answers the OS "is there internet?" probes in a way
 * that makes phones pop up the sign-in page, and redirects everything to the
 * YonderRC control app on :8080. Binding :80 needs root — on a dev laptop that
 * fails harmlessly and the captive portal is simply skipped.
 */
export function startCaptivePortal(controlPort: number): void {
  const portal = `:${controlPort}/`;
  const server = createServer((req, res) => {
    const host = req.headers.host ?? '';
    const target = `http://${host.split(':')[0]}${portal}`;
    // Apple expects exactly "Success" when online; anything else triggers the
    // captive UI. Redirect all probes and paths to the control app.
    res.writeHead(302, { location: target });
    res.end();
  });
  server.on('error', (err) => {
    console.log(`[captive] not started (${(err as NodeJS.ErrnoException).code}) — needs root/port 80; skipping.`);
  });
  server.listen(80, () => {
    console.log('[captive] portal on :80 → redirecting to control app');
  });
}
