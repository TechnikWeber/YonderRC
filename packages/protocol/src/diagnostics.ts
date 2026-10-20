/**
 * Shared shape of a diagnostics file — the vehicle writes one half, the ground app the
 * other, and either can be read on its own.
 */

/** Bumped when the shape changes in a way a reader of old files has to know about. */
export const DIAGNOSTICS_SCHEMA = 'yonderrc-diagnostics/1';

/** One plain-language statement about what the numbers in the report mean. */
export interface DiagnosticFinding {
  level: 'info' | 'warn' | 'bad';
  /** Short subject: 'link', 'power', 'wifi', 'driver', 'ground', 'controller', … */
  area: string;
  text: string;
  /** What to do about it, when there is something concrete. */
  fix?: string;
}
