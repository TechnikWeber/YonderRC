/**
 * "Can I still get home?" — the question a battery percentage does not answer.
 *
 * 30% sounds fine until you notice you are 800 m out into a headwind. This turns
 * what the vehicle already reports — consumed mAh, configured capacity, distance
 * travelled, distance to home — into the one number that is actually a decision:
 * **how much further you may go before you have to turn back.**
 *
 * Everything here is optional by construction. A vehicle with nothing but a PCA9685
 * has no capacity, no coulomb count and no GPS, so every input is null, the status
 * is `unknown`, and nothing is shown or warned about. Missing sensors must never be
 * an error — they are the normal case.
 */

export interface ReturnBudgetCfg {
  enabled: boolean;
  /**
   * Safety margin on the return leg, in percent — **not** a percentage of the pack.
   *
   * 50 means: at the moment you have to turn around, the pack must still hold
   * **1.5×** what the trip home costs, so you arrive with half that cost to spare.
   * The margin is therefore proportional to the distance home — small when you are
   * 100 m out, large when you are 2 km out, which is exactly where a misjudged
   * consumption rate becomes expensive.
   *
   * It guards against ESTIMATION error (headwind on the way back, a detour, a hill,
   * a pack that sags at the end). It is not a deep-discharge limit; that is the
   * low-battery warning, which is a separate setting.
   */
  reservePct: number;
}
export const RETURN_BUDGET_DEFAULTS: ReturnBudgetCfg = { enabled: false, reservePct: 50 };
export const RESERVE_MIN_PCT = 0;
export const RESERVE_MAX_PCT = 200;

const KEY = 'yonderrc.returnBudget.v1';

export function clampReservePct(v: number): number {
  if (!Number.isFinite(v)) return RETURN_BUDGET_DEFAULTS.reservePct;
  return Math.min(RESERVE_MAX_PCT, Math.max(RESERVE_MIN_PCT, Math.round(v)));
}

export function loadReturnBudgetCfg(): ReturnBudgetCfg {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const p = JSON.parse(raw) as Partial<ReturnBudgetCfg>;
      return { enabled: p.enabled === true, reservePct: clampReservePct(p.reservePct ?? RETURN_BUDGET_DEFAULTS.reservePct) };
    }
  } catch {
    /* ignore */
  }
  return { ...RETURN_BUDGET_DEFAULTS };
}

export function saveReturnBudgetCfg(cfg: ReturnBudgetCfg): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

// ---- odometer ----

/**
 * Metres to add for one new fix, or 0 to ignore it. Lifted out of the OSD so the
 * odometer has a single source of truth: the readout and the energy estimate must
 * never disagree about how far the vehicle has gone.
 *
 * A stationary receiver wanders by a metre or two, so movement below the deadband
 * is discarded; an implausible jump (a re-acquired fix) is discarded too, rather
 * than adding a kilometre that never happened.
 */
export const ODO_MIN_STEP_M = 1;
export const ODO_MAX_STEP_M = 500;
export const ODO_MIN_SPEED_MS = 0.5;

export function odoStep(
  prev: { lat: number; lon: number } | null,
  next: { lat: number | null; lon: number | null; speedMs: number | null; hasFix: boolean },
  distance: (aLat: number, aLon: number, bLat: number, bLon: number) => number,
): number {
  if (!prev || !next.hasFix || next.lat == null || next.lon == null) return 0;
  const moving = next.speedMs == null || next.speedMs > ODO_MIN_SPEED_MS;
  if (!moving) return 0;
  const d = distance(prev.lat, prev.lon, next.lat, next.lon);
  return d >= ODO_MIN_STEP_M && d < ODO_MAX_STEP_M ? d : 0;
}

// ---- consumption rate ----

export interface EnergySample {
  /** Consumed charge at this instant, mAh. */
  mah: number;
  /** Trip odometer at this instant, metres. */
  odoM: number;
}

/** ~5 min at 1 Hz: long enough to be steady, short enough to follow conditions. */
export const RATE_WINDOW = 300;
/** Below these the rate is noise, not a measurement. */
export const RATE_MIN_DISTANCE_M = 50;
export const RATE_MIN_MAH = 2;

/**
 * Add a sample, starting over if a counter went backwards.
 *
 * Both inputs can reset under you: the charge counter when telemetry is
 * reconfigured or the operator zeroes it, the odometer when the link drops. A
 * window spanning such a reset has a negative delta, which makes the rate vanish
 * and then reappear — enough, in practice, to fire the turn-back callout a second
 * time. Discarding the old samples is both simpler and more correct than trying
 * to stitch across the gap.
 */
export function pushSample(samples: EnergySample[], s: EnergySample): EnergySample[] {
  const last = samples[samples.length - 1];
  if (last && (s.mah < last.mah || s.odoM < last.odoM)) return [s];
  return [...samples, s].slice(-RATE_WINDOW);
}

/**
 * mAh per metre over the window, or null when there isn't enough movement to say.
 *
 * A rolling window rather than the whole trip: the return leg is predicted better
 * by how the vehicle is behaving now than by an average that still includes five
 * minutes of sitting still at the start. Note that idle consumption inside the
 * window inflates the rate, which errs toward turning back early — the right
 * direction for this to be wrong in.
 */
export function consumptionRate(samples: EnergySample[]): number | null {
  if (samples.length < 2) return null;
  const first = samples[0];
  const last = samples[samples.length - 1];
  const dDist = last.odoM - first.odoM;
  const dMah = last.mah - first.mah;
  if (!Number.isFinite(dDist) || !Number.isFinite(dMah)) return null;
  if (dDist < RATE_MIN_DISTANCE_M || dMah < RATE_MIN_MAH) return null;
  return dMah / dDist;
}

// ---- the budget ----

export type ReturnStatus = 'unknown' | 'ok' | 'advise' | 'now';

export interface ReturnBudgetInputs {
  /** Consumed charge, mAh — null without a coulomb-counting sensor. */
  mah: number | null;
  /** Configured pack capacity, mAh — null when it was never set on the vehicle. */
  capacityMah: number | null;
  /** Straight-line distance to home, metres — null without a fix or a home point. */
  homeDistanceM: number | null;
  /** mAh per metre, from `consumptionRate` — null until it can be measured. */
  mahPerMeter: number | null;
}

export interface ReturnBudgetResult {
  status: ReturnStatus;
  /** How much further you may travel outbound before you must turn back, metres. */
  furtherM: number | null;
  /** What the trip home should cost from here, mAh. */
  homeCostMah: number | null;
  /** What is left in the pack, mAh. */
  remainingMah: number | null;
  /** Consumption, mAh per km — the readable form of the rate. */
  mahPerKm: number | null;
  /** Why it can't say anything, for the settings panel (never shown on the OSD). */
  missing: string | null;
}

/** Below this share of the distance already flown out, start advising. */
const ADVISE_FRACTION = 0.25;

/**
 * Hysteresis for the turn-back WARNING (the badge and the spoken callout), so a
 * budget sitting on the threshold cannot nag.
 *
 * Without it the warning flaps: consumption and distance both wobble, and near the
 * limit the status crosses back and forth, re-announcing "turn back now" each
 * time. Once raised, the warning stays up until the budget is comfortably `ok`
 * again — `advise` is not good enough to clear it, because `advise` is precisely
 * the region it would flap in.
 *
 * The displayed block keeps showing the live status; only the alarm is latched.
 */
export function latchReturnNow(previous: boolean, status: ReturnStatus): boolean {
  if (status === 'now') return true;
  if (status === 'ok' || status === 'unknown') return false;
  return previous; // 'advise' holds whatever it was
}

/**
 * How far further you can go and still come home with the reserve intact.
 *
 * Going `x` further costs `x·rate` now and makes the trip home `(d+x)·rate`, which
 * must fit inside what's left with the reserve factor `r` applied:
 *
 *     remaining − x·rate  ≥  (d + x)·rate·r
 *     x  ≤  (remaining − d·rate·r) / (rate·(1 + r))
 */
export function returnBudget(inputs: ReturnBudgetInputs, cfg: ReturnBudgetCfg): ReturnBudgetResult {
  const empty: ReturnBudgetResult = {
    status: 'unknown', furtherM: null, homeCostMah: null, remainingMah: null, mahPerKm: null, missing: null,
  };
  if (!cfg.enabled) return { ...empty, missing: 'switched off' };

  const { mah, capacityMah, homeDistanceM, mahPerMeter } = inputs;
  if (capacityMah == null || capacityMah <= 0) return { ...empty, missing: 'no battery capacity set on the vehicle' };
  if (mah == null) return { ...empty, missing: 'no charge counter (needs a current sensor)' };
  if (homeDistanceM == null) return { ...empty, missing: 'no GPS fix or no home point' };
  if (mahPerMeter == null || mahPerMeter <= 0) return { ...empty, missing: 'not moved far enough to measure consumption' };

  const remainingMah = Math.max(0, capacityMah - mah);
  const r = 1 + clampReservePct(cfg.reservePct) / 100;
  const homeCostMah = homeDistanceM * mahPerMeter;
  const furtherM = (remainingMah - homeDistanceM * mahPerMeter * r) / (mahPerMeter * (1 + r));
  const mahPerKm = mahPerMeter * 1000;

  const status: ReturnStatus =
    furtherM <= 0 ? 'now' : furtherM <= homeDistanceM * ADVISE_FRACTION ? 'advise' : 'ok';

  return {
    status,
    furtherM: Math.max(0, furtherM),
    homeCostMah,
    remainingMah,
    mahPerKm,
    missing: null,
  };
}
