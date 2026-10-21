import type { Profile } from '@yonderrc/protocol';

/**
 * Whether a control frame may leave this app — or why not.
 *
 * Sending is not the safe default when the input behind it is gone. Two ways it used to
 * go wrong, both of them a vehicle that kept doing something nobody was commanding:
 *
 *  - **The controller disappeared** (battery, Bluetooth, cable). The engine reads a
 *    missing pad as sticks at centre, and the app went on sending that at 50 Hz — so
 *    the vehicle's watchdog never tripped, and an armed plane got half throttle
 *    instead of its failsafe.
 *  - **The app went to the background** (another tab, a minimised window, a phone
 *    screen that turned off). Browsers slow timers there to about once a second, so
 *    frames arrived every ~1000 ms against a 500 ms watchdog: the vehicle pulsed
 *    between the last command and failsafe.
 *
 * Not sending is the answer in both cases: the vehicle's own failsafe — the one place
 * that knows what "safe" means for this vehicle type — takes over within one watchdog
 * period. A disarmed vehicle without its controller still gets frames: its throttle is
 * held safe on the vehicle anyway, and the bench work (servo check, ESC calibration)
 * must not need the controller plugged in.
 */
export type ControlHold = 'hidden' | 'no-controller' | null;

/** True when a stick of this model is read from a gamepad — losing it reads as "centred". */
export function needsGamepad(profile: Profile): boolean {
  return profile.bindings.some((b) => b.source === 'gamepad' && b.mode === 'proportional');
}

export function controlHold(
  profile: Profile,
  s: { hidden: boolean; padConnected: boolean; armed: boolean },
): ControlHold {
  if (s.hidden) return 'hidden';
  if (s.armed && !s.padConnected && needsGamepad(profile)) return 'no-controller';
  return null;
}

/** What the operator is told while frames are held. */
export function controlHoldMessage(hold: ControlHold): string | null {
  if (hold === 'hidden') return 'The control app is in the background — nothing is sent, the vehicle is in failsafe.';
  if (hold === 'no-controller') return 'Controller lost — nothing is sent, the vehicle is in failsafe until it is back.';
  return null;
}

/**
 * Arming a gamepad model without its gamepad would hand the vehicle "sticks centred" —
 * half throttle on a plane. Refused regardless of the pre-arm setting.
 */
export function armBlockedByController(profile: Profile, padConnected: boolean): string | null {
  if (padConnected || !needsGamepad(profile)) return null;
  return 'No controller — this model is driven with a gamepad. Connect it and press a button on it, then arm.';
}
