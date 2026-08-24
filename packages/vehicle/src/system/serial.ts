/**
 * Freeing the Pi's header UART for a GPS receiver — from the setup page instead of
 * `raspi-config` over SSH.
 *
 * Two things stand between a wired GPS and NMEA data, and only one of them is obvious:
 *  1. `enable_uart=1` in config.txt, so the UART exists on GPIO14/15 at all.
 *  2. **no serial login console**, because Raspberry Pi OS hands the very same port to
 *     a getty by default. With the console on, the kernel talks over the GPS and the
 *     receiver's sentences arrive shredded — which looks exactly like bad wiring.
 *
 * `install.sh` only ever enabled the hardware, so every wired GPS hit (2). Everything
 * here is pure text manipulation of the two boot files; the writes live in RealSystem.
 */

const BEGIN = '# --- YonderRC serial port (managed by the setup page) ---';
const END = '# --- end YonderRC serial port ---';

/** Serial devices a login console can be pinned to. `console=tty1` is the screen. */
const SERIAL_CONSOLE = /^console=(serial0|ttyAMA0|ttyS0|ttyAMA10)[,\s]?/;

/** getty units that would fight a GPS for the port. Disabled together. */
export const SERIAL_GETTY_UNITS = ['serial-getty@ttyAMA0.service', 'serial-getty@ttyS0.service'];

/** Is a login console pinned to the header UART? (cmdline.txt is a single line.) */
export function serialConsoleOn(cmdline: string): boolean {
  return cmdline.split(/\s+/).some((t) => SERIAL_CONSOLE.test(t));
}

/**
 * Remove only the serial console tokens, byte-for-byte otherwise. cmdline.txt decides
 * whether the Pi boots at all, so this never rewrites, reorders or reformats the rest —
 * `console=tty1`, `root=`, `rootwait` and every vendor parameter survive untouched.
 */
export function stripSerialConsole(cmdline: string): string {
  const kept = cmdline.trim().split(/\s+/).filter((t) => t && !SERIAL_CONSOLE.test(t));
  return kept.join(' ') + '\n';
}

/** Does config.txt ask for the UART on the header pins? */
export function uartEnabled(text: string): boolean {
  let on = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^enable_uart\s*=\s*(\d+)/.exec(line);
    if (m) on = m[1] !== '0';
  }
  return on;
}

/** Drop a block we wrote earlier so applying twice can't stack up. */
export function stripSerialBlock(text: string): string {
  const out: string[] = [];
  let inside = false;
  for (const line of text.split('\n')) {
    if (line.trim() === BEGIN) { inside = true; continue; }
    if (inside) { if (line.trim() === END) inside = false; continue; }
    out.push(line);
  }
  return out.join('\n');
}

/**
 * Ensure `enable_uart=1`. Competing lines are commented out rather than deleted (same
 * rule as the camera module), and the new line goes into its own `[all]` block so it
 * cannot land inside a `[cm4]`/`[pi5]` section that happens to end the file.
 */
export function enableUart(text: string): string {
  const body = stripSerialBlock(text)
    .split('\n')
    .map((raw) => {
      const line = raw.trim();
      if (!line || line.startsWith('#')) return raw;
      return /^enable_uart\s*=/.test(line) ? `# ${raw}  # (replaced by YonderRC)` : raw;
    })
    .join('\n');
  const block = [BEGIN, '[all]', 'enable_uart=1', END].join('\n');
  return `${body.replace(/\n*$/, '')}\n\n${block}\n`;
}

export interface SerialPortState {
  /** A login console holds the port — the one that shreds NMEA data. */
  consoleOn: boolean;
  /** config.txt asks for the UART on GPIO14/15. */
  uartOn: boolean;
  /** Both conditions met: a receiver wired to pins 8/10 can be read. */
  ready: boolean;
}

export function serialState(cmdline: string, configTxt: string): SerialPortState {
  const consoleOn = serialConsoleOn(cmdline);
  const uartOn = uartEnabled(configTxt);
  return { consoleOn, uartOn, ready: uartOn && !consoleOn };
}

/** One sentence for the setup page — what is wrong, or that nothing is. */
export function explainSerial(state: SerialPortState): string {
  if (state.ready) return 'The header UART is free: /dev/serial0 can be used for a GPS receiver.';
  const parts: string[] = [];
  if (!state.uartOn) parts.push('the UART on GPIO14/15 is off (enable_uart=1 missing)');
  if (state.consoleOn) parts.push('a login console holds the port, so it would talk over the receiver');
  return `Not usable for GPS yet: ${parts.join(', and ')}.`;
}
