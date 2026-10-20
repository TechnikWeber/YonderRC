/**
 * What the control link actually delivered, measured where it matters: at the vehicle,
 * at the moment a control frame is accepted.
 *
 * "It keeps going in and out of failsafe" has three very different causes, and each
 * looks the same from the ground:
 *
 *  - the **network** delivers frames in bursts (WiFi power saving, LTE scheduling) —
 *    the frames were sent on time and arrived late, all at once;
 *  - the **ground** stopped sending for a moment (a background tab, a busy phone) —
 *    nothing was sent, so nothing arrived;
 *  - the **vehicle** itself stalled (CPU, a blocking call) — frames waited in the socket.
 *
 * The ground can only see the second. This sees the arrival side: a histogram of the
 * gaps between accepted frames, the failsafe episodes with their length, and which
 * transport carried the last frame before each one. Together with the ground's own
 * send-loop timing (ground/lib/diagnostics.ts) and the vehicle's event-loop delay, the
 * three can be told apart from one exported file.
 *
 * Pure apart from the clock, which every method takes as an argument — the core hands in
 * `Date.now()`, the tests hand in whatever they need. Nothing here may throw: it runs
 * inside the control path.
 */

export type ControlVia = 'ws' | 'webrtc';

/** Upper bounds (ms, inclusive) of the gap histogram; one more open-ended bucket follows. */
export const GAP_BUCKETS_MS = [30, 50, 100, 200, 300, 500, 1000, 2000] as const;

/** Failsafe episodes kept in full; older ones only count towards the totals. */
export const EPISODES_KEPT = 50;

export interface FailsafeEpisode {
  /** When the vehicle entered failsafe (ISO). */
  at: string;
  /** How long it lasted; null while it is still going on. */
  durationMs: number | null;
  /** Transport of the last frame before it — a gap on WebRTC and one on WS are different stories. */
  via: ControlVia | null;
  /** Which connection it happened on (the core's control-session number). */
  session: number;
  /** How it ended when frames did NOT come back: the ground's connection closed, or a new ground took over. */
  endedBy?: 'disconnect' | 'new ground';
}

export interface LinkStatsSnapshot {
  /** When counting started — the service start. */
  since: string;
  /** Ground connections seen since then. */
  sessions: number;
  frames: {
    ws: number;
    webrtc: number;
    /** Arrived out of order or twice — normal in small numbers on the unordered data channel. */
    staleDropped: number;
    /** Sent by a ground that has been superseded by a newer one. */
    supersededDropped: number;
  };
  /** Time between two accepted frames of the same connection. */
  gaps: {
    buckets: { upToMs: number | null; count: number }[];
    maxMs: number;
    total: number;
  };
  failsafe: {
    episodes: number;
    totalMs: number;
    longestMs: number;
    /** The most recent episodes, oldest first. */
    recent: FailsafeEpisode[];
  };
  /** The connection that is (or was last) in control. */
  current: {
    session: number;
    startedAt: string | null;
    frames: number;
    maxGapMs: number;
    episodes: number;
    lastVia: ControlVia | null;
  };
}

const iso = (ms: number) => new Date(ms).toISOString();

export class LinkStats {
  private readonly startedAt: number;
  private sessions = 0;
  private session = 0;
  private sessionStartedAt: number | null = null;
  private lastFrameAt: number | null = null;
  private lastVia: ControlVia | null = null;

  private framesWs = 0;
  private framesRtc = 0;
  private stale = 0;
  private superseded = 0;

  private buckets: number[] = new Array(GAP_BUCKETS_MS.length + 1).fill(0);
  private gapCount = 0;
  private maxGapMs = 0;

  private sessionFrames = 0;
  private sessionMaxGapMs = 0;
  private sessionEpisodes = 0;

  private episodes: FailsafeEpisode[] = [];
  private episodeCount = 0;
  private failsafeTotalMs = 0;
  private longestMs = 0;
  private inEpisodeSince: number | null = null;
  /** A ground is connected. Failsafe without one is the parked state, not a dropout. */
  private connected = false;

  constructor(now: number) {
    this.startedAt = now;
  }

  /** A new ground took control. Gaps are never measured across two connections. */
  beginSession(session: number, now: number): void {
    this.closeEpisode(now, 'new ground');
    this.sessions += 1;
    this.session = session;
    this.sessionStartedAt = now;
    this.lastFrameAt = null;
    this.sessionFrames = 0;
    this.sessionMaxGapMs = 0;
    this.sessionEpisodes = 0;
    this.connected = true;
  }

  /**
   * The controlling ground's connection closed. The vehicle stays in failsafe — that is
   * the point — but from here on it is parked, not dropping out: an operator who closes
   * the app must not show up as a ten-minute "episode". One that was already running
   * when the connection went (a link that died before its socket noticed) is closed and
   * kept, marked as such.
   */
  endSession(session: number, now: number): void {
    if (session !== this.session) return;
    this.closeEpisode(now, 'disconnect');
    this.connected = false;
  }

  private closeEpisode(now: number, endedBy: FailsafeEpisode['endedBy'] | null): void {
    if (this.inEpisodeSince === null) return;
    const d = Math.max(0, now - this.inEpisodeSince);
    this.inEpisodeSince = null;
    this.failsafeTotalMs += d;
    if (d > this.longestMs) this.longestMs = d;
    const open = this.episodes[this.episodes.length - 1];
    if (open && open.durationMs === null) {
      open.durationMs = d;
      if (endedBy) open.endedBy = endedBy;
    }
  }

  /** A control frame was accepted. */
  frame(now: number, via: ControlVia): void {
    if (via === 'webrtc') this.framesRtc += 1;
    else this.framesWs += 1;
    this.sessionFrames += 1;
    if (this.lastFrameAt !== null) {
      const gap = Math.max(0, now - this.lastFrameAt);
      let i = GAP_BUCKETS_MS.findIndex((b) => gap <= b);
      if (i < 0) i = GAP_BUCKETS_MS.length;
      this.buckets[i] += 1;
      this.gapCount += 1;
      if (gap > this.maxGapMs) this.maxGapMs = gap;
      if (gap > this.sessionMaxGapMs) this.sessionMaxGapMs = gap;
    }
    this.lastFrameAt = now;
    this.lastVia = via;
  }

  /** A frame was refused before it could count. */
  dropped(why: 'stale' | 'superseded'): void {
    if (why === 'stale') this.stale += 1;
    else this.superseded += 1;
  }

  /**
   * Feed the failsafe state once per control tick. `active` must already exclude the
   * state every connection opens in (no frame accepted yet) — that is a session that has
   * not started, not a dropout, the same rule the ground's link-gap counter follows.
   */
  observeFailsafe(active: boolean, now: number): void {
    if (!this.connected) return;
    if (active && this.inEpisodeSince === null) {
      this.inEpisodeSince = now;
      this.episodeCount += 1;
      this.sessionEpisodes += 1;
      this.episodes.push({ at: iso(now), durationMs: null, via: this.lastVia, session: this.session });
      if (this.episodes.length > EPISODES_KEPT) this.episodes.shift();
    } else if (!active && this.inEpisodeSince !== null) {
      this.closeEpisode(now, null);
    }
  }

  snapshot(now: number): LinkStatsSnapshot {
    // An episode still going on counts with its length so far, so a vehicle stuck in
    // failsafe while the report is taken does not read as "0 ms".
    const running = this.inEpisodeSince === null ? 0 : Math.max(0, now - this.inEpisodeSince);
    return {
      since: iso(this.startedAt),
      sessions: this.sessions,
      frames: {
        ws: this.framesWs,
        webrtc: this.framesRtc,
        staleDropped: this.stale,
        supersededDropped: this.superseded,
      },
      gaps: {
        buckets: this.buckets.map((count, i) => ({ upToMs: GAP_BUCKETS_MS[i] ?? null, count })),
        maxMs: Math.round(this.maxGapMs),
        total: this.gapCount,
      },
      failsafe: {
        episodes: this.episodeCount,
        totalMs: Math.round(this.failsafeTotalMs + running),
        longestMs: Math.round(Math.max(this.longestMs, running)),
        recent: this.episodes.map((e) => ({ ...e })),
      },
      current: {
        session: this.session,
        startedAt: this.sessionStartedAt === null ? null : iso(this.sessionStartedAt),
        frames: this.sessionFrames,
        maxGapMs: Math.round(this.sessionMaxGapMs),
        episodes: this.sessionEpisodes,
        lastVia: this.lastVia,
      },
    };
  }
}

/**
 * Gaps longer than `ms` — how many would have tripped a watchdog of that length. Exact
 * on a bucket edge (300, 500, 1000 …); in between, only the buckets that lie wholly
 * above it count, so it errs low.
 */
export function gapsOver(s: LinkStatsSnapshot, ms: number): number {
  let lower = 0;
  let n = 0;
  for (const b of s.gaps.buckets) {
    if (lower >= ms) n += b.count;
    lower = b.upToMs ?? Infinity;
  }
  return n;
}
