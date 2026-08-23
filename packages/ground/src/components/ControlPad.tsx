import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Detent, Profile, ThrottleLimit } from '@yonderrc/protocol';
import type { InputManager } from '../lib/input/inputManager';
import type { BindingEngine } from '../lib/input/bindingEngine';
import { holdProgress, holdRemainingS } from '../lib/hold';
import { LIMIT_STEP_LABELS } from '../lib/throttleLimit';
import { VirtualJoystick } from './VirtualJoystick';
import type { HapticCfg } from '../lib/haptics';
import { HoldButton } from './HoldButton';
import { TrimPanel } from './TrimPanel';

interface JoyCfg {
  axisX: boolean;
  axisY: boolean;
  detentX: Detent;
  detentY: Detent;
  label: string;
}

function joyConfigs(profile: Profile): Record<'L' | 'R', JoyCfg | null> {
  const mk = (): JoyCfg => ({ axisX: false, axisY: false, detentX: 'center', detentY: 'center', label: '' });
  const map: Record<'L' | 'R', JoyCfg | null> = { L: null, R: null };
  const labels: Record<'L' | 'R', string[]> = { L: [], R: [] };
  for (const b of profile.bindings) {
    if (b.source !== 'virtual') continue;
    const [, jid, axis] = b.element.split(':') as ['joy', 'L' | 'R', 'x' | 'y'];
    const cfg = map[jid] ?? mk();
    if (axis === 'x') {
      cfg.axisX = true;
      cfg.detentX = b.detent ?? 'center';
    } else {
      cfg.axisY = true;
      cfg.detentY = b.detent ?? 'center';
    }
    if (b.label) labels[jid].push(b.label);
    map[jid] = cfg;
  }
  (['L', 'R'] as const).forEach((k) => {
    if (map[k]) map[k]!.label = labels[k].join(' / ') || `Stick ${k}`;
  });
  return map;
}

export function ControlPad({
  profile,
  input,
  engine,
  armed,
  onToggleArm,
  connected,
  calibrationActive,
  holdMs,
  externalProgress = 0,
  limit,
  onLimitStep,
  buttonHoldMs,
  onTrim,
  onTrimClear,
  version,
  haptics,
}: {
  profile: Profile;
  input: InputManager;
  engine: BindingEngine;
  armed: boolean;
  onToggleArm: () => void;
  /** Stick feedback (centre / rim) settings; undefined or disabled = silent. */
  haptics?: HapticCfg;
  /** Hold time for the arm button in ms; 0 = protection off (plain tap). */
  holdMs: number;
  /** Hold progress coming from the bound arm key/button, so the fill matches. */
  externalProgress?: number;
  /** Speed-limit steps for this model, and the active one. */
  limit: ThrottleLimit;
  onLimitStep: (step: 0 | 1 | 2) => void;
  /**
   * Short hold for the buttons that change something lasting (toggle channels,
   * speed limiter, trims). 0 = plain taps. Momentary channels are never affected.
   */
  buttonHoldMs: number;
  onTrim: (bindingId: string, deltaUs: number) => void;
  onTrimClear: (bindingId: string) => void;
  connected: boolean;
  calibrationActive: boolean;
  version: number;
}) {
  const joys = useMemo(() => joyConfigs(profile), [profile]);
  const onscreen = profile.bindings.filter((b) => b.source === 'onscreen');
  const hasJoys = !!(joys.L || joys.R);
  // Stick modes 2 and 3 collapse both axes onto one stick. Keyed on what is actually
  // rendered rather than on the mode number, so a custom binding that leaves one side
  // empty gets the same benefit.
  const soloJoy = !!(joys.L ? !joys.R : joys.R);
  // Stable identity so the joystick's effect doesn't churn (which used to cancel
  // the spring animation mid-flight).
  const handleJoy = useCallback((jid: string, x: number, y: number) => input.setJoystick(jid, x, y), [input]);

  const armDisabled = !connected || calibrationActive;

  // Hold-to-confirm: unless it is switched off in Setup › Controls, a single tap
  // can't arm (or, worse, disarm in flight) — the button has to be held for the
  // configured time and fills up while you do.
  const [progress, setProgress] = useState(0);
  const startedAt = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const firedRef = useRef(false);

  const cancelHold = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startedAt.current = null;
    firedRef.current = false;
    setProgress(0);
  }, []);

  const beginHold = useCallback(() => {
    if (armDisabled || holdMs <= 0 || startedAt.current !== null) return;
    startedAt.current = performance.now();
    firedRef.current = false;
    const step = () => {
      const p = holdProgress(startedAt.current, performance.now(), holdMs);
      setProgress(p);
      if (p >= 1) {
        if (!firedRef.current) {
          firedRef.current = true;
          navigator.vibrate?.(60); // haptic confirm on phones that support it
          onToggleArm();
        }
        cancelHold();
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, [armDisabled, cancelHold, holdMs, onToggleArm]);

  // Losing the link (or starting ESC calibration) mid-hold must not leave a
  // half-filled button that fires the moment it comes back.
  useEffect(() => {
    if (armDisabled) cancelHold();
  }, [armDisabled, cancelHold]);
  useEffect(() => () => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
  }, []);

  // The same button visualises both paths: pressing it, or holding the bound
  // key / gamepad button.
  const shownProgress = Math.max(progress, externalProgress);
  const holding = shownProgress > 0;
  const armLabel = !connected
    ? 'Connect the vehicle to arm'
    : calibrationActive
      ? 'ESC calibration active — cancel it to arm'
      : holding
        ? `${armed ? 'DISARMING' : 'ARMING'} IN ${holdRemainingS(shownProgress, holdMs).toFixed(1)} s — keep holding`
        : armed
          ? holdMs > 0 ? `ARMED — hold ${holdMs / 1000} s to disarm` : 'ARMED — tap to disarm'
          : holdMs > 0 ? `DISARMED — hold ${holdMs / 1000} s to arm` : 'DISARMED — tap to arm';

  const methodHint =
    profile.inputMethod === 'keyboard'
      ? 'Keyboard: W A S D (left stick) · I J K L (right stick) · aux keys G H …'
      : profile.inputMethod === 'gamepad'
        ? 'Gamepad: sticks drive the axes, buttons drive aux. Plug in and go.'
        : 'Touch: drag the sticks. Detents (centering) are set per axis in Setup.';

  return (
    <section className="panel">
      <span className="eyebrow">
        {profile.name} · {profile.vehicleType} · {profile.inputMethod}
      </span>
      <button
        className={`arm-btn${armed ? ' armed' : ''}${holding ? ' holding' : ''}`}
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
          beginHold();
        }}
        onPointerUp={cancelHold}
        onPointerLeave={cancelHold}
        onPointerCancel={cancelHold}
        // Space/Enter hold works too; the browser's synthetic click is ignored.
        onKeyDown={(e) => {
          if (!e.repeat && (e.key === ' ' || e.key === 'Enter')) beginHold();
        }}
        onKeyUp={(e) => {
          if (e.key === ' ' || e.key === 'Enter') cancelHold();
        }}
        onBlur={cancelHold}
        onClick={(e) => {
          // With the hold switched off the button is an ordinary toggle again;
          // otherwise the pointer/key handlers above own the interaction.
          if (holdMs > 0) e.preventDefault();
          else onToggleArm();
        }}
        disabled={armDisabled}
        aria-pressed={armed}
      >
        <i className="arm-fill" style={{ width: `${Math.round(shownProgress * 100)}%` }} aria-hidden="true" />
        <span className="arm-text">{armLabel}</span>
      </button>

      {hasJoys && (
        <div className={soloJoy ? 'joy-row solo' : 'joy-row'} data-version={version}>
          {(['L', 'R'] as const).map((k) =>
            joys[k] ? (
              <VirtualJoystick
                key={k}
                id={k}
                label={joys[k]!.label}
                axisX={joys[k]!.axisX}
                axisY={joys[k]!.axisY}
                detentX={joys[k]!.detentX}
                detentY={joys[k]!.detentY}
                onChange={handleJoy}
                haptics={haptics}
              />
            ) : null,
          )}
        </div>
      )}

      {onscreen.length > 0 && (
        <div className="pad-grid">
          {onscreen.map((b) => {
            const isToggle = b.mode === 'toggle';
            const activeState = isToggle ? engine.getToggle(b.id) : input.isPressed(b.id);
            // Toggles are held in the engine (it owns the flip), so the fill is
            // read back from there. Momentary buttons fire at once and never fill.
            const fill = isToggle ? engine.holdProgress(b.id) : 0;
            return (
              <button
                key={b.id}
                className={`padbtn${activeState ? ' active' : ''}${fill > 0 ? ' holding' : ''}`}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  input.setPressed(b.id, true);
                }}
                onPointerUp={() => input.setPressed(b.id, false)}
                onPointerLeave={() => input.setPressed(b.id, false)}
                onPointerCancel={() => input.setPressed(b.id, false)}
              >
                <i className="hold-fill" style={{ width: `${Math.round(fill * 100)}%` }} aria-hidden="true" />
                <span className="hold-text">{b.label ?? `CH${b.channel + 1}`}</span>
                <span className="sub hold-text">
                  CH{String(b.channel + 1).padStart(2, '0')} · {isToggle ? (activeState ? 'on' : 'off') : b.mode}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div className="limit-row" role="group" aria-label="Speed limit">
        <span className="limit-label">Speed</span>
        {([0, 1, 2] as const).map((i) => (
          <HoldButton
            key={i}
            className={`limitbtn${limit.step === i ? ' on' : ''}`}
            holdMs={buttonHoldMs}
            onFire={() => onLimitStep(i)}
            ariaPressed={limit.step === i}
          >
            <span>{LIMIT_STEP_LABELS[i]}</span>
            <span className="sub">{limit.steps[i]}%</span>
          </HoldButton>
        ))}
      </div>

      <TrimPanel
        profile={profile}
        holdMs={buttonHoldMs}
        onNudge={onTrim}
        onClear={onTrimClear}
      />

      <p className="hint">{methodHint}</p>
    </section>
  );
}
