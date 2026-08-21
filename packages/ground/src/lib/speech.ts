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
  armed: boolean;
  failsafe: boolean;
  batteryLow: boolean;
  batteryPercent: number | null;
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

  // The link is NOT handled here — it needs a clock, not a comparison. See linkVoice.
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

  return out;
}

/**
 * How long the link has to stay down before it is worth saying out loud.
 *
 * The WebSocket reconnects a second after any close, so a WiFi roam or an LTE
 * handover produces a real, truthful "link lost / link restored" pair for an
 * outage nobody needed to know about — and a voice that cries wolf is a voice you
 * stop listening to.
 *
 * This does not delay the safety signal: the vehicle drops into failsafe after
 * 300 ms without frames, and **failsafe is announced immediately and urgently**.
 * So a genuine outage still speaks up at once; only the informational
 * "link lost" waits to see whether it mattered.
 */
export const LINK_LOST_GRACE_MS = 2000;

/**
 * How long the quality has to stay bad before it is said out loud. Longer than the
 * outage grace: a momentary spike in round-trip or loss is normal, and the OSD
 * badge already shows it instantly.
 */
export const LINK_WEAK_GRACE_MS = 3000;

/** What `linkVoice` has to remember between ticks. */
export interface LinkVoiceState {
  /**
   * Whether this session ever had a link at all. A link that never existed cannot
   * be lost: opening the app and not pressing Connect used to produce "Link lost"
   * two seconds later — and because browsers hold speech until the page has seen a
   * user gesture, it typically arrived at the next tap, which made it look like the
   * tap had caused it.
   */
  everConnected: boolean;
  /** When the link went down, or null while it is up. */
  downSince: number | null;
  /** Whether the outage was announced — restoration is only worth saying if so. */
  lostAnnounced: boolean;
  /** When the quality went bad, or null while it is fine. */
  weakSince: number | null;
  /** Whether the weakness was announced — same rule for its recovery. */
  weakAnnounced: boolean;
}

export const LINK_VOICE_INITIAL: LinkVoiceState = {
  everConnected: false, downSince: null, lostAnnounced: false, weakSince: null, weakAnnounced: false,
};

/**
 * All link callouts, on a clock rather than on state comparisons.
 *
 * Presence and quality are handled together because they are not independent:
 * **while the link is down, its quality is not "bad", it is unknown.** Treating
 * them separately produced the actual bug this replaces — a one-second reconnect
 * made the health score vanish, which read as a transition out of "bad" and
 * cheerfully announced "link recovered" in the middle of an outage.
 *
 * Both callouts only announce a recovery for a problem that was announced. That
 * covers the first connect of a session for free (you pressed Connect and are
 * looking at the screen) and stops a blip from producing a lone "restored".
 *
 * The wording keeps the two apart on purpose: **lost / restored** is the link
 * existing, **weak / good** is how well it is working. "Link recovered" next to
 * "Link restored" was two near-identical phrases for different events.
 */
export function linkVoice(
  prev: LinkVoiceState,
  input: { connected: boolean; qualityBad: boolean },
  now: number,
): { next: LinkVoiceState; say: Announcement | null } {
  // ---- link is down: quality is frozen, not "recovered" ----
  if (!input.connected) {
    // Before the first connection there is nothing to lose. Silence here is not
    // politeness: announcing a loss you never had teaches the operator to distrust
    // the voice, and this one arrived while they were still setting the model up.
    if (!prev.everConnected) return { next: prev, say: null };
    if (prev.downSince === null) return { next: { ...prev, downSince: now, lostAnnounced: false }, say: null };
    if (!prev.lostAnnounced && now - prev.downSince >= LINK_LOST_GRACE_MS) {
      return { next: { ...prev, lostAnnounced: true }, say: { text: 'Link lost', urgent: true } };
    }
    return { next: prev, say: null };
  }

  // ---- link is up again after being down ----
  if (prev.downSince !== null) {
    const say = prev.lostAnnounced ? { text: 'Link restored', urgent: false } : null;
    // A reconnect starts the quality clock over: whatever the score did while the
    // socket was down says nothing about the link we have now.
    return { next: { everConnected: true, downSince: null, lostAnnounced: false, weakSince: null, weakAnnounced: false }, say };
  }
  // The link exists, so from here on losing it is worth saying out loud.
  const up: LinkVoiceState = prev.everConnected ? prev : { ...prev, everConnected: true };

  // ---- link is up: judge the quality ----
  if (input.qualityBad) {
    if (up.weakSince === null) return { next: { ...up, weakSince: now, weakAnnounced: false }, say: null };
    if (!up.weakAnnounced && now - up.weakSince >= LINK_WEAK_GRACE_MS) {
      return { next: { ...up, weakAnnounced: true }, say: { text: 'Weak link', urgent: false } };
    }
    return { next: up, say: null };
  }
  if (up.weakSince !== null) {
    const say = up.weakAnnounced ? { text: 'Link good', urgent: false } : null;
    return { next: { ...up, weakSince: null, weakAnnounced: false }, say };
  }
  return { next: up, say: null };
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
