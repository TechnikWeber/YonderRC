import { useMemo } from 'react';
import type { Profile } from '@yonderrc/protocol';
import type { InputManager } from '../lib/input/inputManager';
import type { BindingEngine } from '../lib/input/bindingEngine';
import { VirtualJoystick } from './VirtualJoystick';

function joyMeta(profile: Profile) {
  // Group virtual bindings by joystick id and figure out which axes are used.
  const byJoy = new Map<string, { x: boolean; y: boolean; throttle: boolean }>();
  for (const b of profile.bindings) {
    if (b.source !== 'virtual') continue;
    const [, jid, axis] = b.element.split(':');
    const m = byJoy.get(jid) ?? { x: false, y: false, throttle: false };
    if (axis === 'y') m.y = true;
    else m.x = true;
    if (profile.throttleChannels.includes(b.channel)) m.throttle = true;
    byJoy.set(jid, m);
  }
  return byJoy;
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
  const joys = useMemo(() => joyMeta(profile), [profile]);
  const onscreen = profile.bindings.filter((b) => b.source === 'onscreen');

  return (
    <section className="panel">
      <span className="eyebrow">Controls · {profile.name}</span>
      <button
        className={`arm-btn${armed ? ' armed' : ''}`}
        onClick={onToggleArm}
        aria-pressed={armed}
      >
        {armed ? 'ARMED — tap to disarm' : 'DISARMED — tap to arm'}
      </button>

      {joys.size > 0 && (
        <div className="joy-row" data-version={version}>
          {[...joys.entries()].map(([jid, m]) => (
            <VirtualJoystick
              key={jid}
              id={jid}
              label={`Stick ${jid}`}
              axis={m.x && m.y ? 'xy' : m.y ? 'y' : 'x'}
              spring={!m.throttle}
              onChange={(id, x, y) => input.setJoystick(id, x, y)}
            />
          ))}
        </div>
      )}

      {onscreen.length > 0 && (
        <div className="pad-grid">
          {onscreen.map((b) => {
            const isToggle = b.mode === 'toggle';
            const active = isToggle ? engine.getToggle(b.id) : input.isPressed(b.id);
            return (
              <button
                key={b.id}
                className={`padbtn${active ? ' active' : ''}`}
                onPointerDown={(e) => {
                  (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
                  input.setPressed(b.id, true);
                }}
                onPointerUp={() => input.setPressed(b.id, false)}
                onPointerLeave={() => input.setPressed(b.id, false)}
                onPointerCancel={() => input.setPressed(b.id, false)}
              >
                <span>
                  CH{String(b.channel + 1).padStart(2, '0')} · {b.mode}
                </span>
                <span className="sub">
                  {isToggle ? (active ? 'on' : 'off') : 'hold'}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <p className="hint">
        This profile’s inputs are live. Keyboard/gamepad work anytime; on-screen
        buttons and sticks appear here when the profile uses them. Edit mappings in
        Setup.
      </p>
    </section>
  );
}
