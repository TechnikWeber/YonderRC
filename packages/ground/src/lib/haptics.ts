/**
 * Feedback when a stick reaches a landmark you cannot see while looking at the FPV
 * picture: the centre, and the rim.
 *
 * **iOS has no Vibration API.** `navigator.vibrate` exists on Android but not in
 * Safari on iPhone, and no permission or setting changes that — so a phone-only
 * "rumble" cannot be built from it. What is available everywhere is a very short
 * click through Web Audio, and a real gamepad's `vibrationActuator` when one is
 * connected. All three are driven from the same events here, and the caller picks
 * which ones it wants.
 */

export type HapticEvent = 'center' | 'edge';

export interface HapticCfg {
  /** Master switch. */
  enabled: boolean;
  /** Vibration where the platform has it (Android). Silent no-op on iOS. */
  vibrate: boolean;
  /** Short audible click — the only feedback an iPhone can actually produce. */
  click: boolean;
  /** Rumble a connected gamepad. */
  gamepad: boolean;
}

export const HAPTICS_DEFAULTS: HapticCfg = { enabled: false, vibrate: true, click: true, gamepad: true };
const KEY = 'yonderrc.haptics.v1';

export function loadHapticCfg(): HapticCfg {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...HAPTICS_DEFAULTS, ...(JSON.parse(raw) as Partial<HapticCfg>) } : { ...HAPTICS_DEFAULTS };
  } catch {
    return { ...HAPTICS_DEFAULTS };
  }
}

export function saveHapticCfg(cfg: HapticCfg): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* private mode — the setting just doesn't persist */
  }
}

/** True where a real vibration motor can be driven (Android). Always false on iOS. */
export function vibrationAvailable(): boolean {
  return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
}

/**
 * State an axis can be in. Rim and centre are *zones*, not points: a thumb resting
 * exactly on the boundary would otherwise fire on every jitter.
 */
export type AxisZone = 'center' | 'mid' | 'edge';

const CENTER_IN = 0.06; // matches the stick's deadzone
const CENTER_OUT = 0.14;
const EDGE_IN = 0.97;
const EDGE_OUT = 0.9;

/**
 * Zone of an axis, given where it was. The two thresholds per boundary are the
 * hysteresis: you have to leave properly before the next entry counts, so holding a
 * stick against the rim buzzes once instead of chattering.
 */
export function axisZone(value: number, prev: AxisZone): AxisZone {
  const a = Math.abs(value);
  if (prev === 'edge') return a >= EDGE_OUT ? 'edge' : a <= CENTER_IN ? 'center' : 'mid';
  if (prev === 'center') return a >= EDGE_IN ? 'edge' : a <= CENTER_OUT ? 'center' : 'mid';
  return a >= EDGE_IN ? 'edge' : a <= CENTER_IN ? 'center' : 'mid';
}

/** Which events a zone change should fire. Entering a zone fires; leaving is silent. */
export function zoneEvents(prev: AxisZone, next: AxisZone): HapticEvent[] {
  if (prev === next) return [];
  if (next === 'center') return ['center'];
  if (next === 'edge') return ['edge'];
  return [];
}

/** Vibration pattern per event, in ms. Edge is firmer than centre on purpose. */
export function patternFor(event: HapticEvent): number[] {
  return event === 'edge' ? [22] : [10];
}

/** Fire one event through whichever channels the config allows. Never throws. */
export function playHaptic(event: HapticEvent, cfg: HapticCfg): void {
  if (!cfg.enabled) return;
  if (cfg.vibrate && vibrationAvailable()) {
    try {
      navigator.vibrate(patternFor(event));
    } catch {
      /* some browsers throw without a user gesture */
    }
  }
  if (cfg.click) clickTone(event);
  if (cfg.gamepad) rumbleGamepad(event);
}

/**
 * A click short enough to read as a tick rather than a beep. Deliberately separate
 * from `beep.ts`, whose tones are alerts (battery, link) and are meant to be heard
 * over wind — this one must not compete with them.
 */
let ctx: AudioContext | null = null;
function clickTone(event: HapticEvent): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx ?? new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = event === 'edge' ? 220 : 660;
    const now = ctx.currentTime;
    const ms = event === 'edge' ? 0.03 : 0.015;
    // Ramp instead of a hard stop: a square edge on a 15 ms tone is an audible pop.
    g.gain.setValueAtTime(0.0001, now);
    g.gain.exponentialRampToValueAtTime(0.08, now + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, now + ms);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + ms + 0.01);
  } catch {
    /* audio unavailable — ignore */
  }
}

function rumbleGamepad(event: HapticEvent): void {
  try {
    for (const pad of navigator.getGamepads?.() ?? []) {
      const act = (pad as unknown as { vibrationActuator?: { playEffect: (t: string, o: object) => Promise<unknown> } })
        ?.vibrationActuator;
      if (!act) continue;
      const strong = event === 'edge' ? 0.6 : 0.25;
      void act.playEffect('dual-rumble', { duration: event === 'edge' ? 40 : 18, strongMagnitude: strong, weakMagnitude: strong }).catch(() => {});
    }
  } catch {
    /* no gamepad haptics here */
  }
}
