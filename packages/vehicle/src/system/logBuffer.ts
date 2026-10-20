import { format } from 'node:util';

/**
 * The service's own console, kept in memory for the diagnostics export.
 *
 * journald has the same lines — on a Pi, under systemd, for whoever may read the
 * journal. Not in `npm run dev`, not in Docker, and not on a vehicle whose operator has
 * never opened a terminal, which is exactly the person a "download diagnostics" button
 * is for. So the last lines are simply kept: bounded in count and in length, cheap to
 * keep, and gone on restart (the journal is still collected on top where it exists).
 */

export interface LogLine {
  /** ISO time the line was written. */
  at: string;
  level: 'log' | 'warn' | 'error';
  text: string;
}

/** One runaway line (a stack trace, a dumped object) must not push everything else out. */
const MAX_LINE = 2000;

export class LogBuffer {
  private lines: LogLine[] = [];

  constructor(private readonly cap = 1500) {}

  push(level: LogLine['level'], text: string, now = Date.now()): void {
    const t = text.length > MAX_LINE ? `${text.slice(0, MAX_LINE)} …(${text.length - MAX_LINE} more chars)` : text;
    this.lines.push({ at: new Date(now).toISOString(), level, text: t });
    if (this.lines.length > this.cap) this.lines.splice(0, this.lines.length - this.cap);
  }

  /** The newest `n` lines (all of them by default), oldest first. */
  tail(n = this.cap): LogLine[] {
    return this.lines.slice(-n);
  }

  get size(): number {
    return this.lines.length;
  }
}

/**
 * Copy everything written to console.log/info/warn/error into `buffer`, unchanged on the
 * real console. Returns the function that undoes it (the tests use that).
 */
export function captureConsole(buffer: LogBuffer): () => void {
  const orig = { log: console.log, info: console.info, warn: console.warn, error: console.error };
  const wrap =
    (level: LogLine['level'], fn: (...a: unknown[]) => void) =>
    (...args: unknown[]) => {
      fn(...args);
      try {
        buffer.push(level, format(...args));
      } catch {
        /* never let logging break the caller */
      }
    };
  console.log = wrap('log', orig.log);
  console.info = wrap('log', orig.info);
  console.warn = wrap('warn', orig.warn);
  console.error = wrap('error', orig.error);
  return () => Object.assign(console, orig);
}

/** The process-wide buffer the service writes into and the diagnostics endpoint reads. */
export const serviceLog = new LogBuffer();
