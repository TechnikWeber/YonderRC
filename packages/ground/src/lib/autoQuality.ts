/**
 * Ground-side automatic video-quality control. Pure decision logic (no React) so
 * it can be unit-tested: given the current level, the latest loss/latency and the
 * running good/bad streaks, decide whether to step the level down or up. Hysteresis
 * comes from separate up/down thresholds plus separate hold times.
 */

export type Level = 'low' | 'medium' | 'high';
const LEVELS: Level[] = ['low', 'medium', 'high'];

export interface AutoQualityCfg {
  lossDownPct: number;
  latDownMs: number;
  lossUpPct: number;
  latUpMs: number;
  downHoldS: number;
  upHoldS: number;
}

export const AUTO_DEFAULTS: AutoQualityCfg = {
  lossDownPct: 5,
  latDownMs: 400,
  lossUpPct: 1.5,
  latUpMs: 200,
  downHoldS: 3,
  upHoldS: 8,
};

export interface AutoState {
  bad: number;
  good: number;
}

export function autoQualityStep(
  current: Level,
  loss: number,
  latency: number,
  cfg: AutoQualityCfg,
  st: AutoState,
): { level: Level; state: AutoState; changed: boolean } {
  const bad = loss > cfg.lossDownPct || latency > cfg.latDownMs;
  const good = loss < cfg.lossUpPct && latency < cfg.latUpMs;
  let b = st.bad;
  let g = st.good;
  if (bad) {
    b += 1;
    g = 0;
  } else if (good) {
    g += 1;
    b = 0;
  } else {
    b = 0;
    g = 0;
  }
  const idx = LEVELS.indexOf(current);
  if (b >= cfg.downHoldS && idx > 0) return { level: LEVELS[idx - 1], state: { bad: 0, good: 0 }, changed: true };
  if (g >= cfg.upHoldS && idx < LEVELS.length - 1) return { level: LEVELS[idx + 1], state: { bad: 0, good: 0 }, changed: true };
  return { level: current, state: { bad: b, good: g }, changed: false };
}
