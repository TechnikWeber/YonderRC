import { useCallback, useEffect, useRef, useState } from 'react';
import type { Detent } from '@yonderrc/protocol';

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
}: {
  id: string;
  label: string;
  axisX?: boolean;
  axisY?: boolean;
  detentX?: Detent;
  detentY?: Detent;
  onChange: (id: string, x: number, y: number) => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: detentY === 'low' ? -1 : 0 });
  const value = useRef({ x: 0, y: detentY === 'low' ? -1 : 0 });
  const active = useRef(false);
  const pointerId = useRef<number | null>(null);
  const raf = useRef<number | null>(null);

  const DEADZONE = 0.06;
  const dz = (v: number) => (Math.abs(v) < DEADZONE ? 0 : v);

  const emit = useCallback(
    (x: number, y: number) => {
      const nx = axisX ? dz(x) : 0;
      const ny = axisY ? dz(y) : 0;
      value.current = { x: nx, y: ny };
      setKnob({ x: nx, y: ny });
      onChange(id, nx, ny);
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
          style={{ transform: `translate(${knob.x * 44}px, ${-knob.y * 44}px)` }}
        />
      </div>
      <span className="joy-label">{label}</span>
    </div>
  );
}
