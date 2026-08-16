/**
 * Spoken callouts.
 *
 * On FPV you are watching the picture, not the OSD. A beep tells you *that*
 * something happened; a voice tells you *what*, without looking away. The browser
 * has SpeechSynthesis built in, so this costs no dependency and works offline.
 *
 * On by default, and deliberately terse: only state changes that would make you
 * act. Anything chattier gets muted within a session and then you lose the ones
 * that matter.
 */

export interface SpeechCfg {
  enabled: boolean;
  /** 0..1 */
  volume: number;
  /** 0.5..2 — a little quick, so a callout is over before you need to react. */
  rate: number;
}
export const SPEECH_DEFAULTS: SpeechCfg = { enabled: true, volume: 1, rate: 1.1 };

const KEY = 'yonderrc.speech.v1';

export function loadSpeechCfg(): SpeechCfg {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<SpeechCfg>;
      return {
        enabled: p.enabled !== false,
        volume: clamp(p.volume ?? SPEECH_DEFAULTS.volume, 0, 1),
        rate: clamp(p.rate ?? SPEECH_DEFAULTS.rate, 0.5, 2),
      };
    }
  } catch {
    /* ignore */
  }
  return { ...SPEECH_DEFAULTS };
}

export function saveSpeechCfg(cfg: SpeechCfg): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

function clamp(v: number, lo: number, hi: number): number {
  if (!Number.isFinite(v)) return lo;
  return Math.max(lo, Math.min(hi, v));
}

/** What the app knows at one instant; the callouts come from changes in it. */
export interface SpeechState {
  connected: boolean;
  /**
   * Whether a link has been up at any point this session. Without it, the first
   * successful connect announces "link restored", which is both wrong and noise —
   * you just pressed Connect and are looking at the screen.
   */
  everConnected: boolean;
  armed: boolean;
  failsafe: boolean;
  batteryLow: boolean;
  batteryPercent: number | null;
  /**
   * Set only when the link health is actually known to be bad. It must stay false
   * while there is no measurement yet, or every connect announces "weak link"
   * followed a second later by "link recovered".
   */
  linkBad: boolean;
  /**
   * The return-home budget has run out. False whenever the feature is off or its
   * inputs are missing, so a vehicle without a current sensor never hears this.
   */
  returnNow: boolean;
}

export interface Announcement {
  text: string;
  /** Urgent ones jump the queue — a failsafe must not wait behind "armed". */
  urgent: boolean;
}

/**
 * Callouts for a state change. Pure, so the wording and the priorities are
 * testable without a speech engine.
 *
 * Order matters: the list is spoken front to back, so the most consequential
 * event of a tick comes first.
 */
export function announcementsFor(prev: SpeechState | null, next: SpeechState): Announcement[] {
  const out: Announcement[] = [];
  if (!prev) return out; // first observation is not a change

  // Losing the link outranks everything else that could happen in the same tick.
  if (prev.connected && !next.connected) out.push({ text: 'Link lost', urgent: true });
  // Only a RECONNECT is worth saying; the first connect of a session isn't news.
  if (!prev.connected && next.connected && prev.everConnected) {
    out.push({ text: 'Link restored', urgent: false });
  }

  if (!prev.failsafe && next.failsafe) out.push({ text: 'Failsafe', urgent: true });
  if (prev.failsafe && !next.failsafe) out.push({ text: 'Failsafe cleared', urgent: false });

  if (!prev.armed && next.armed) out.push({ text: 'Armed', urgent: false });
  if (prev.armed && !next.armed) out.push({ text: 'Disarmed', urgent: false });

  if (!prev.batteryLow && next.batteryLow) {
    const pct = next.batteryPercent;
    out.push({ text: pct == null ? 'Battery low' : `Battery low, ${Math.round(pct)} percent`, urgent: true });
  }

  // Ranked just under failsafe: it is the one callout that asks you to change
  // what you are doing rather than telling you what already happened.
  if (!prev.returnNow && next.returnNow) out.push({ text: 'Turn back now', urgent: true });

  if (!prev.linkBad && next.linkBad) out.push({ text: 'Weak link', urgent: false });
  if (prev.linkBad && !next.linkBad) out.push({ text: 'Link recovered', urgent: false });

  return out;
}

/** How often a still-low battery repeats itself, ms. Often enough to nag, not to annoy. */
export const BATTERY_REPEAT_MS = 30000;

/**
 * The repeat callout while the battery stays low, or null if it isn't due yet.
 * Separate from `announcementsFor` because it is time-driven, not change-driven.
 */
export function batteryRepeat(state: SpeechState, lastSpokenAt: number | null, now: number): Announcement | null {
  if (!state.batteryLow) return null;
  if (lastSpokenAt !== null && now - lastSpokenAt < BATTERY_REPEAT_MS) return null;
  const pct = state.batteryPercent;
  return { text: pct == null ? 'Battery low' : `Battery ${Math.round(pct)} percent`, urgent: false };
}

// ---- the thin, untestable part: the browser engine ----

function synth(): SpeechSynthesis | null {
  return typeof window !== 'undefined' && 'speechSynthesis' in window ? window.speechSynthesis : null;
}

/** True when this browser can speak at all (Safari and Chrome can; some can't). */
export function speechAvailable(): boolean {
  return synth() !== null && typeof SpeechSynthesisUtterance === 'function';
}

export function speak(a: Announcement, cfg: SpeechCfg): void {
  if (!cfg.enabled) return;
  const s = synth();
  if (!s) return;
  try {
    // An urgent callout drops whatever is queued: by the time "armed" has finished
    // playing, "failsafe" is already stale news.
    if (a.urgent) s.cancel();
    const u = new SpeechSynthesisUtterance(a.text);
    u.volume = cfg.volume;
    u.rate = cfg.rate;
    s.speak(u);
  } catch {
    /* a browser without a working voice must not break the control loop */
  }
}

/**
 * iOS refuses to speak until speech has been started from a user gesture once.
 * Saying nothing, from a real tap, buys the permission for the rest of the session.
 */
export function primeSpeech(): void {
  const s = synth();
  if (!s) return;
  try {
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    s.speak(u);
  } catch {
    /* ignore */
  }
}
