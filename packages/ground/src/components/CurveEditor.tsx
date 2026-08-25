import {
  applyCurve,
  identityCurve,
  normalizeCurve,
  CURVE_SIZES,
  CURVE_DEFAULT_SIZE,
  type ChannelCurve,
  type CurveSize,
} from '@yonderrc/protocol';
import { Hint } from './Hint';

/**
 * Per-channel response curve. Off by default — a channel with no curve behaves
 * exactly as it did before curves existed.
 *
 * The plot is not decoration: a list of numbers between -100 and 100 says almost
 * nothing about how a channel will feel, and the shape says it immediately.
 */
const PLOT = 120; // viewBox is square; CSS decides the drawn size.

function plotPath(curve: ChannelCurve): string {
  // Sample the interpolated curve rather than joining the points, so the drawn
  // line is the same function the channel actually uses.
  const steps = 48;
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const x = -1 + (2 * i) / steps;
    const y = applyCurve(x, curve);
    pts.push(`${((x + 1) / 2) * PLOT},${((1 - y) / 2) * PLOT}`);
  }
  return `M${pts.join(' L')}`;
}

export function CurveEditor({
  curve,
  onChange,
  disabled = false,
}: {
  curve: ChannelCurve | null | undefined;
  /** null switches the curve off entirely. */
  onChange: (c: ChannelCurve | null) => void;
  disabled?: boolean;
}) {
  const active = normalizeCurve(curve);
  const shown = active ?? identityCurve();
  const size = shown.points.length as CurveSize;

  const setPoint = (i: number, pct: number) => {
    const points = [...shown.points];
    points[i] = Math.max(-1, Math.min(1, pct / 100));
    onChange(normalizeCurve({ points }));
  };
  const setSize = (n: CurveSize) => {
    // Resample the current shape onto the new point count, so changing the
    // resolution refines a curve instead of throwing it away.
    const next = identityCurve(n).points.map((x) => applyCurve(x, shown));
    onChange(normalizeCurve({ points: next }));
  };

  return (
    <div className="curve-editor">
      <label className="opt">
        <input
          type="checkbox"
          checked={!!active}
          disabled={disabled}
          onChange={(e) => onChange(e.target.checked ? identityCurve(CURVE_DEFAULT_SIZE) : null)}
        />
        Response curve
      </label>

      {active && (
        <>
          <div className="curve-body">
            <svg className="curve-plot" viewBox={`0 0 ${PLOT} ${PLOT}`} role="img" aria-label="Channel response curve">
              <rect x="0" y="0" width={PLOT} height={PLOT} className="curve-bg" />
              <line x1="0" y1={PLOT / 2} x2={PLOT} y2={PLOT / 2} className="curve-axis" />
              <line x1={PLOT / 2} y1="0" x2={PLOT / 2} y2={PLOT} className="curve-axis" />
              {/* The straight line, so the deviation is visible at a glance. */}
              <line x1="0" y1={PLOT} x2={PLOT} y2="0" className="curve-linear" />
              <path d={plotPath(active)} className="curve-line" />
              {active.points.map((p, i) => (
                <circle
                  key={i}
                  cx={(i / (active.points.length - 1)) * PLOT}
                  cy={((1 - p) / 2) * PLOT}
                  r={i === 0 || i === active.points.length - 1 ? 2 : 3.2}
                  className={i === 0 || i === active.points.length - 1 ? 'curve-dot pinned' : 'curve-dot'}
                />
              ))}
            </svg>

            <div className="curve-points">
              <label className="curve-size">
                <span>Points</span>
                <select value={size} disabled={disabled} onChange={(e) => setSize(Number(e.target.value) as CurveSize)}>
                  {CURVE_SIZES.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              </label>
              {active.points.map((p, i) => {
                const pinned = i === 0 || i === active.points.length - 1;
                const x = Math.round((-1 + (2 * i) / (active.points.length - 1)) * 100);
                return (
                  <label key={i} className={`curve-pt${pinned ? ' pinned' : ''}`}>
                    <span>{x > 0 ? `+${x}` : x}%</span>
                    <input
                      type="number"
                      step={5}
                      min={-100}
                      max={100}
                      value={Math.round(p * 100)}
                      disabled={disabled || pinned}
                      title={pinned ? 'The ends are fixed so full travel stays reachable — use min/max µs to limit it' : undefined}
                      onChange={(e) => setPoint(i, Number(e.target.value))}
                    />
                  </label>
                );
              })}
              <button
                className="btn tiny"
                disabled={disabled}
                onClick={() => onChange(identityCurve(size))}
                title="Back to a straight line"
              >
                Reset
              </button>
            </div>
          </div>
          <Hint summary="X is the stick, Y is the channel">
            The curve is applied <b>before</b> expo, so both can be used together. The two end points
            are fixed at ±100% so full travel stays reachable; limit the travel with{' '}
            <span className="mono">min/max µs</span> instead. Applies to this channel only.
          </Hint>
        </>
      )}
    </div>
  );
}
