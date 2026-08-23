import { useCallback, useEffect, useRef, useState } from 'react';
import type { Detent } from '@yonderrc/protocol';
import { axisZone, playHaptic, zoneEvents, type AxisZone, type HapticCfg } from '../lib/haptics';

/**
 * Full virtual joystick: multitouch (each stick tracks its own pointer id, so two
 * thumbs work at once), a small deadzone, per-axis detent with animated spring
 * return, and responsive scaling. Reports normalized x,y in [-1,1] via onChange.
 *
 * Detent per axis:
 *   center → springs to 0
 *   low    → springs to -1 (e.g. throttle to idle)
 *   free   → stays where released (ratcheted throttle feel)
 */
export function VirtualJoystick({
  id,
  label,
  axisX = true,
  axisY = true,
  detentX = 'center',
  detentY = 'center',
  onChange,
  haptics,
}: {
  id: string;
  label: string;
  axisX?: boolean;
  axisY?: boolean;
  detentX?: Detent;
  detentY?: Detent;
  onChange: (id: string, x: number, y: number) => void;
  haptics?: HapticCfg;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  // Resting position: center axes rest at 0; low/free axes rest at minimum
  // (idle) — so a throttle loads safely at the bottom.
  const initX = detentX === 'center' ? 0 : -1;
  const initY = detentY === 'center' ? 0 : -1;
  const [knob, setKnob] = useState({ x: initX, y: initY });
  const value = useRef({ x: initX, y: initY });
  const active = useRef(false);
  const pointerId = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const DEADZONE = 0.06;
  const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);

  // Zone per axis, so centre and rim can be felt without looking away from the FPV
  // picture. Kept in a ref: this runs on every pointer move and must not re-render.
  const zoneX = useRef<AxisZone>('center');
  const zoneY = useRef<AxisZone>('center');
  const hapticsRef = useRef(haptics);
  hapticsRef.current = haptics;

  const emit = useCallback(
    (x: number, y: number) => {
      const nx = axisX ? dz(x) : 0;
      const ny = axisY ? dz(y) : 0;
      value.current = { x: nx, y: ny };
      setKnob({ x: nx, y: ny });
      onChange(id, nx, ny);

      const cfg = hapticsRef.current;
      if (cfg?.enabled) {
        // One event per boundary crossing even when both axes cross at once —
        // two buzzes in the same millisecond just read as one longer buzz.
        const fired = new Set<string>();
        if (axisX) {
          const next = axisZone(nx, zoneX.current);
          for (const e of zoneEvents(zoneX.current, next)) fired.add(e);
          zoneX.current = next;
        }
        if (axisY) {
          const next = axisZone(ny, zoneY.current);
          for (const e of zoneEvents(zoneY.current, next)) fired.add(e);
          zoneY.current = next;
        }
        // Rim wins: hitting the edge is the more important of the two to feel.
        if (fired.has('edge')) playHaptic('edge', cfg);
        else if (fired.has('center')) playHaptic('center', cfg);
      }
    },
    [axisX, axisY, id, onChange],
  );

  const fromEvent = useCallback(
    (e: PointerEvent | React.PointerEvent) => {
      const base = baseRef.current;
      if (!base) return;
      const r = base.getBoundingClientRect();
      const radius = r.width / 2;
      let x = (e.clientX - (r.left + radius)) / radius;
      let y = (e.clientY - (r.top + radius)) / radius; // screen down = +
      const mag = Math.hypot(x, y);
      if (mag > 1) {
        x /= mag;
        y /= mag;
      }
      emit(x, -y); // up = positive
    },
    [emit],
  );

  const target = useCallback(
    (axis: 'x' | 'y'): number | null => {
      const d = axis === 'x' ? detentX : detentY;
      if (d === 'free') return null; // stay
      return d === 'low' ? -1 : 0;
    },
    [detentX, detentY],
  );

  const springReturn = useCallback(() => {
    const tx = target('x');
    const ty = target('y');
    const step = () => {
      const cur = value.current;
      let { x, y } = cur;
      const rate = 0.2; // per frame ease toward target
      if (tx !== null) x += (tx - x) * rate;
      if (ty !== null) y += (ty - y) * rate;
      if (Math.abs((tx ?? x) - x) < 0.005) x = tx ?? x;
      if (Math.abs((ty ?? y) - y) < 0.005) y = ty ?? y;
      emit(x, y);
      const doneX = tx === null || x === tx;
      const doneY = ty === null || y === ty;
      if (!doneX || !doneY) raf.current = requestAnimationFrame(step);
      else raf.current = null;
    };
    if (raf.current) cancelAnimationFrame(raf.current);
    raf.current = requestAnimationFrame(step);
  }, [emit, target]);

  const onDown = (e: React.PointerEvent) => {
    if (raf.current) cancelAnimationFrame(raf.current);
    active.current = true;
    pointerId.current = e.pointerId;
    (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
    fromEvent(e);
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      if (active.current && e.pointerId === pointerId.current) fromEvent(e);
    };
    const up = (e: PointerEvent) => {
      if (e.pointerId !== pointerId.current) return;
      active.current = false;
      pointerId.current = null;
      springReturn();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [fromEvent, springReturn]);

  // Cancel any in-flight spring animation only when the component unmounts,
  // never on a routine re-render (that used to kill the spring mid-flight).
  useEffect(() => () => {
    if (raf.current) cancelAnimationFrame(raf.current);
  }, []);

  // Publish the resting value once on mount so the channel is correct before the
  // first touch (e.g. a free/low throttle sits at idle, not center).
  useEffect(() => {
    onChange(id, initX, initY);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="joy-wrap">
      <div
        className="joy-base"
        ref={baseRef}
        onPointerDown={onDown}
        role="slider"
        aria-label={label}
        aria-valuenow={Math.round(knob.x * 100)}
      >
        {axisX && <div className="joy-cross-h" />}
        {axisY && <div className="joy-cross-v" />}
        <div
          className="joy-knob"
          style={{
            // Travel comes from --joy-throw so the knob keeps reaching the rim at
            // every size; a hardcoded 44px only fitted the 128px stick.
            transform: `translate(calc(var(--joy-throw) * ${knob.x}), calc(var(--joy-throw) * ${-knob.y}))`,
          }}
        />
      </div>
      <span className="joy-label">{label}</span>
    </div>
  );
}
