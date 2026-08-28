/**
 * How well the control link actually held — counted from the vehicle's own status.
 *
 * A watchdog trip is invisible in practice. `VehicleCore.resolveOutput()` drops every
 * channel to its failsafe value once `watchdogTimeoutMs` passes without an accepted
 * frame, the status goes out at 20 Hz, and the bars snap back long before anyone can
 * read them — the operator sees "something flickered" and has nothing to point at. The
 * blackbox samples at 2 Hz and misses it too. So the only honest record is a running
 * count of the episodes plus the worst frame age the vehicle ever reported, both kept
 * for the life of one connection.
 *
 * The worst gap matters even when the count is zero: a link that peaks at 280 ms
 * against a 300 ms watchdog has not failed yet, and that is worth knowing before it
 * does.
 */
export interface LinkQuality {
  /** Failsafe episodes since this connection began — rising edges, not ticks. */
  dropouts: number;
  /** Largest control-frame age the vehicle reported this connection, in ms. */
  worstGapMs: number;
  /** Whether the previous sample was already in failsafe (edge detection). */
  inFailsafe: boolean;
  /** Status frames folded in — until the first one there is nothing to show. */
  samples: number;
}

export const LINK_QUALITY_ZERO: LinkQuality = {
  dropouts: 0,
  worstGapMs: 0,
  inFailsafe: false,
  samples: 0,
};

/** One status frame's worth of evidence. */
export function foldLinkQuality(
  prev: LinkQuality,
  sample: { failsafeActive: boolean; lastFrameAgeMs: number },
): LinkQuality {
  const age = sample.lastFrameAgeMs;
  // `lastFrameAgeMs` is -1 while the vehicle has accepted no frame at all, and it
  // reports failsafe in exactly that state — every connection starts there, because
  // `resetControlLink()` zeroes `lastFrameAt`. That is a session which has not begun,
  // not a dropout; counting it would stamp a "1" on the strip on every single connect.
  const started = age >= 0;
  return {
    dropouts: sample.failsafeActive && !prev.inFailsafe && started ? prev.dropouts + 1 : prev.dropouts,
    worstGapMs: started && age > prev.worstGapMs ? age : prev.worstGapMs,
    inFailsafe: sample.failsafeActive,
    samples: prev.samples + 1,
  };
}

/**
 * How to render it. `near` is the state that has no other way of being noticed: no
 * dropout has happened, but the link is spending its margin.
 */
export function describeLinkQuality(
  q: LinkQuality,
  watchdogMs: number,
): { text: string; level: 'none' | 'ok' | 'near' | 'bad' } {
  if (q.samples === 0) return { text: '—', level: 'none' };
  const worst = `${Math.round(q.worstGapMs)} ms worst`;
  if (q.dropouts > 0) return { text: `${q.dropouts} · ${worst}`, level: 'bad' };
  const near = watchdogMs > 0 && q.worstGapMs >= watchdogMs * 0.6;
  return { text: `clean · ${worst}`, level: near ? 'near' : 'ok' };
}
