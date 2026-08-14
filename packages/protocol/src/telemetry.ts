/**
 * Pure helpers around telemetry channels — shared by the vehicle (which does the
 * battery maths) and the ground (which warns and logs on the same channel).
 */
import type { TelemetryMessage, TelemetryReading } from './types/telemetry';

/**
 * Index of the channel marked `primary`, else 0 (the historic behaviour: the
 * first configured channel drove the battery maths). An empty list gives 0 as
 * well — callers index defensively.
 */
export function primaryIndex(channels: { primary?: boolean }[]): number {
  const i = channels.findIndex((c) => c.primary);
  return i >= 0 ? i : 0;
}

/** The pack-voltage reading the vehicle counted with, or null. */
export function primaryVoltage(t: TelemetryMessage | null | undefined): TelemetryReading | null {
  if (!t?.voltages?.length) return null;
  return t.voltages[t.primaryVoltage ?? 0] ?? t.voltages[0] ?? null;
}

/** The current reading that feeds coulomb counting, or null. */
export function primaryCurrent(t: TelemetryMessage | null | undefined): TelemetryReading | null {
  if (!t?.currents?.length) return null;
  return t.currents[t.primaryCurrent ?? 0] ?? t.currents[0] ?? null;
}

/**
 * Stable key for one telemetry reading, used to remember per-channel OSD
 * visibility. The label is what the operator sees and edits, so it is the key;
 * the index keeps unlabelled channels apart.
 */
export function readingKey(kind: 'v' | 'c' | 't', label: string, index: number): string {
  return `${kind}:${label.trim() || index}`;
}
