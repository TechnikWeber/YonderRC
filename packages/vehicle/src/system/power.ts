/**
 * The Pi's own verdict on its power supply.
 *
 * `vcgencmd get_throttled` returns a bitmask the firmware maintains: whether the 5 V
 * rail is sagging *right now*, and whether it ever has since boot. On a vehicle this
 * is not a footnote — a brownout mid-drive is a reset mid-drive, and the operator has
 * no way to tell that from a software crash. It reads exactly like a bug in the app.
 *
 * Everything here is pure so the bit meanings are pinned by tests rather than by
 * whoever last read the firmware docs.
 */

export interface PowerState {
  /** Raw mask, for the detail line. Null when the reading failed. */
  raw: number | null;
  /** The 5 V rail is below spec right now. */
  underVoltageNow: boolean;
  /** It has been below spec at some point since boot. */
  underVoltagePast: boolean;
  /** The firmware is currently clamping the clock to cope. */
  throttledNow: boolean;
  throttledPast: boolean;
  /** Soft temperature limit — the *other* reason for a clamp, so they don't get confused. */
  hotNow: boolean;
  /** One line for the operator: what is wrong and what to change. Null when all is well. */
  message: string | null;
}

export const POWER_UNKNOWN: PowerState = {
  raw: null,
  underVoltageNow: false,
  underVoltagePast: false,
  throttledNow: false,
  throttledPast: false,
  hotNow: false,
  message: null,
};

/** Bit positions as documented by the Raspberry Pi firmware. */
const UNDERVOLTAGE_NOW = 0;
const THROTTLED_NOW = 2;
const SOFT_TEMP_NOW = 3;
const UNDERVOLTAGE_PAST = 16;
const THROTTLED_PAST = 18;

/** Parse `throttled=0x50005`. Anything else is an unknown state, not a healthy one. */
export function parseThrottled(out: string): number | null {
  const m = /throttled\s*=\s*(0x[0-9a-fA-F]+|\d+)/.exec(out ?? '');
  if (!m) return null;
  const v = m[1].startsWith('0x') ? parseInt(m[1], 16) : Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

const bit = (v: number, n: number) => ((v >> n) & 1) === 1;

export function powerState(raw: number | null): PowerState {
  if (raw == null) return POWER_UNKNOWN;
  const s: PowerState = {
    raw,
    underVoltageNow: bit(raw, UNDERVOLTAGE_NOW),
    underVoltagePast: bit(raw, UNDERVOLTAGE_PAST),
    throttledNow: bit(raw, THROTTLED_NOW),
    throttledPast: bit(raw, THROTTLED_PAST),
    hotNow: bit(raw, SOFT_TEMP_NOW),
    message: null,
  };
  return { ...s, message: explainPower(s) };
}

/**
 * What to say about it. Ordered by what the operator should do first: a rail that is
 * sagging right now is the emergency; a past event is a warning worth acting on before
 * the next drive; a clamp with no under-voltage is heat, which is a different fix.
 */
export function explainPower(s: PowerState): string | null {
  if (s.underVoltageNow) {
    return (
      'Under-voltage NOW — the 5 V rail is below spec. The Pi will reset the moment a ' +
      'servo pulls current, and that looks exactly like a software crash. Feed servo V+ ' +
      'from its own BEC, never from the Pi, and use a 5.1 V / 3 A supply with a short, ' +
      'thick cable.'
    );
  }
  if (s.throttledNow && s.hotNow) {
    return 'Throttled by temperature right now — the Pi is clamping its clock to cool down. Improve airflow or add a heatsink.';
  }
  if (s.throttledNow) {
    return 'Clock is being clamped right now, without a temperature limit — treat it as a power problem and check the supply.';
  }
  if (s.underVoltagePast) {
    return (
      'Under-voltage has happened since boot. It is not happening this second, but the ' +
      'supply has no headroom — fix it before the next drive rather than after the crash.'
    );
  }
  if (s.throttledPast) {
    return 'The clock has been clamped since boot. Worth a look at supply and cooling.';
  }
  return null;
}

/** Short OSD tag, or null when there is nothing to show. */
export function powerBadge(s: PowerState): string | null {
  if (s.underVoltageNow) return 'POWER';
  if (s.throttledNow) return s.hotNow ? 'HOT' : 'THROTTLED';
  if (s.underVoltagePast) return 'POWER?';
  return null;
}
