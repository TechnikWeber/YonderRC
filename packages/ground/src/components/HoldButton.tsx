import { useCallback, useEffect, useRef, useState } from 'react';
import { holdProgress } from '../lib/hold';

/**
 * A button that only fires after being held for `holdMs`, filling up while you
 * hold it. Used for the controls that change something lasting — the speed limiter
 * and the trims — so brushing one on a phone doesn't quietly alter how the vehicle
 * behaves.
 *
 * The fill matters as much as the delay: a button that ignores the first 300 ms of
 * a press and gives no sign of it reads as broken. With `holdMs <= 0` this is an
 * ordinary button again, which is what switching the protection off has to mean.
 *
 * Fires ONCE per press — no auto-repeat. Nudging a trim four steps takes four
 * deliberate presses, which is the point.
 */
export function HoldButton({
  onFire,
  holdMs,
  className = 'btn tiny',
  disabled = false,
  title,
  ariaPressed,
  children,
}: {
  onFire: () => void;
  holdMs: number;
  className?: string;
  disabled?: boolean;
  title?: string;
  ariaPressed?: boolean;
  children: React.ReactNode;
}) {
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const cancel = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startedAt.current = null;
    firedRef.current = false;
    setProgress(0);
  }, []);

  const begin = useCallback(() => {
    if (disabled || startedAt.current !== null) return;
    if (holdMs <= 0) {
      onFire();
      return;
    }
    startedAt.current = performance.now();
    firedRef.current = false;
    const step = () => {
      const p = holdProgress(startedAt.current, performance.now(), holdMs);
      setProgress(p);
      if (p >= 1) {
        if (!firedRef.current) {
          firedRef.current = true;
          navigator.vibrate?.(30);
          onFire();
        }
        cancel();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [cancel, disabled, holdMs, onFire]);

  // A button that becomes disabled mid-hold must not fire when it comes back.
  useEffect(() => {
    if (disabled) cancel();
  }, [disabled, cancel]);
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  return (
    <button
      className={`${className}${progress > 0 ? ' holding' : ''}`}
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        begin();
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onKeyDown={(e) => {
        if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) begin();
      }}
      onKeyUp={(e) => {
        if (e.key === ' ' || e.key === 'Enter') cancel();
      }}
      onBlur={cancel}
      // The pointer handlers own the interaction unless the hold is switched off.
      onClick={(e) => {
        if (holdMs > 0) e.preventDefault();
      }}
      disabled={disabled}
      aria-pressed={ariaPressed}
      title={title}
    >
      <i className="hold-fill" style={{ width: `${Math.round(progress * 100)}%` }} aria-hidden="true" />
      <span className="hold-text">{children}</span>
    </button>
  );
}
