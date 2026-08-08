import { useMemo } from 'react';
import type { Detent, Profile } from '@yonderrc/protocol';
import type { InputManager } from '../lib/input/inputManager';
import type { BindingEngine } from '../lib/input/bindingEngine';
import { VirtualJoystick } from './VirtualJoystick';

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
  version,
}: {
  profile: Profile;
  input: InputManager;
  engine: BindingEngine;
  armed: boolean;
  onToggleArm: () => void;
  version: number;
}) {
  const joys = useMemo(() => joyConfigs(profile), [profile]);
  const onscreen = profile.bindings.filter((b) => b.source === 'onscreen');
  const hasJoys = !!(joys.L || joys.R);

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
      <button className={`arm-btn${armed ? ' armed' : ''}`} onClick={onToggleArm} aria-pressed={armed}>
        {armed ? 'ARMED — tap to disarm' : 'DISARMED — tap to arm'}
      </button>

      {hasJoys && (
        <div className="joy-row" data-version={version}>
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
                onChange={(jid, x, y) => input.setJoystick(jid, x, y)}
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
            return (
              <button
                key={b.id}
                className={`padbtn${activeState ? ' active' : ''}`}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  input.setPressed(b.id, true);
                }}
                onPointerUp={() => input.setPressed(b.id, false)}
                onPointerLeave={() => input.setPressed(b.id, false)}
                onPointerCancel={() => input.setPressed(b.id, false)}
              >
                <span>{b.label ?? `CH${b.channel + 1}`}</span>
                <span className="sub">
                  CH{String(b.channel + 1).padStart(2, '0')} · {isToggle ? (activeState ? 'on' : 'off') : b.mode}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="hint">{methodHint}</p>
    </section>
  );
}
