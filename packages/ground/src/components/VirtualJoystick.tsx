import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A touch/mouse joystick. Reports normalized x,y in [-1,1] via onChange. Springs
 * back to center on release unless `spring` is false (useful for a throttle you
 * want to stay put). `axis` locks it to one dimension.
 *
 * This is the rudimentary v1 of the virtual joystick; multitouch tuning,
 * deadzone shaping and layout presets are on the roadmap.
 */
export function VirtualJoystick({
  id,
  label,
  axis = 'xy',
  spring = true,
  onChange,
}: {
  id: string;
  label: string;
  axis?: 'xy' | 'x' | 'y';
  spring?: boolean;
  onChange: (id: string, x: number, y: number) => void;
}) {
  const baseRef = useRef<HTMLDivElement>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });
  const active = useRef(false);
  const pointerId = useRef<number | null>(null);

  const emit = useCallback(
    (x: number, y: number) => {
      const nx = axis === 'y' ? 0 : x;
      const ny = axis === 'x' ? 0 : y;
      setKnob({ x: nx, y: ny });
      onChange(id, nx, ny);
    },
    [axis, id, onChange],
  );

  const fromEvent = useCallback(
    (e: PointerEvent | React.PointerEvent) => {
      const base = baseRef.current;
      if (!base) return;
      const r = base.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const radius = r.width / 2;
      let x = (e.clientX - cx) / radius;
      let y = (e.clientY - cy) / radius; // screen down = +; invert so up = +
      const mag = Math.hypot(x, y);
      if (mag > 1) {
        x /= mag;
        y /= mag;
      }
      emit(x, -y);
    },
    [emit],
  );

  const onDown = (e: React.PointerEvent) => {
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
      if (spring) emit(0, 0);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  }, [fromEvent, emit, spring]);

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
        <div className="joy-cross-h" />
        <div className="joy-cross-v" />
        <div
          className="joy-knob"
          style={{ transform: `translate(${knob.x * 42}px, ${-knob.y * 42}px)` }}
        />
      </div>
      <span className="joy-label">{label}</span>
    </div>
  );
}
