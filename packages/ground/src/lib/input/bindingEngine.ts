import {
  CHANNEL_COUNT,
  CHANNEL_NEUTRAL_US,
  clamp,
  clampChannelUs,
  neutralChannels,
  shapeProportional,
  shapeSwitch,
} from '@yonderrc/protocol';
import type { ChannelBinding, Profile } from '@yonderrc/protocol';

/**
 * A read-only view of every input source at one instant. The engine depends only
 * on this interface, not on the DOM or the Gamepad API directly, which keeps the
 * mapping logic pure and unit-testable (see engine test).
 */
export interface InputSnapshot {
  keys: Set<string>; // normalized key names currently held
  pressed: Set<string>; // binding ids currently pressed via on-screen buttons
  joystick: (id: string) => { x: number; y: number } | null;
  gamepadAxis: (n: number) => number | null; // null if no gamepad
  gamepadButton: (n: number) => boolean;
}

const CENTER_SPRING_PER_SEC = 3.5; // keyboard/virtual axis return-to-center
const KEY_RAMP_PER_SEC = 2.4; // keyboard proportional ramp

/**
 * The BindingEngine turns "which profile + what are the inputs doing" into the
 * 16 channel values in µs. It owns the small amount of state that must persist
 * between frames: toggle positions and ramp values, both keyed by binding id so
 * they survive edits to a profile.
 */
export class BindingEngine {
  private toggles = new Map<string, boolean>();
  private prevActive = new Map<string, boolean>();
  private ramp = new Map<string, number>();

  getToggle(id: string): boolean {
    return this.toggles.get(id) ?? false;
  }

  /** Directly flip a toggle (used by on-screen toggle buttons on tap). */
  flipToggle(id: string): void {
    this.toggles.set(id, !this.toggles.get(id));
  }

  compute(profile: Profile, snap: InputSnapshot, dtMs: number): number[] {
    const dt = dtMs / 1000;
    const channels = neutralChannels();

    for (const b of profile.bindings) {
      if (b.channel < 0 || b.channel >= CHANNEL_COUNT) continue;
      channels[b.channel] = this.evalBinding(b, snap, dt);
    }
    return channels;
  }

  private evalBinding(b: ChannelBinding, snap: InputSnapshot, dt: number): number {
    switch (b.mode) {
      case 'proportional':
        return shapeProportional(this.readAxis(b, snap, dt), b.shaping);
      case 'momentary':
        return shapeSwitch(this.readActive(b, snap), b.shaping, restUsFor(b));
      case 'toggle': {
        const active = this.readActive(b, snap);
        const prev = this.prevActive.get(b.id) ?? false;
        if (active && !prev) this.flipToggle(b.id); // rising edge
        this.prevActive.set(b.id, active);
        return shapeSwitch(this.getToggle(b.id), b.shaping, restUsFor(b));
      }
      case 'hold-ramp':
        return this.readHoldRamp(b, snap, dt);
      default:
        return b.shaping.failsafeUs;
    }
  }

  /** Proportional [-1,1] value from the binding's source. */
  private readAxis(b: ChannelBinding, snap: InputSnapshot, dt: number): number {
    if (b.source === 'gamepad') {
      const { index, invert } = parseAxisElement(b.element);
      const v = snap.gamepadAxis(index);
      if (v !== null) return invert ? -v : v;
      return 0;
    }
    if (b.source === 'virtual') {
      const { joyId, axis } = parseJoyElement(b.element);
      const j = snap.joystick(joyId);
      if (!j) return 0;
      return axis === 'y' ? j.y : j.x;
    }
    if (b.source === 'keyboard') {
      // element "negKey|posKey", ramped; return target depends on the detent.
      const [neg, pos] = b.element.split('|').map(normElementKey);
      const dir = (snap.keys.has(pos) ? 1 : 0) + (snap.keys.has(neg) ? -1 : 0);
      const cur = this.ramp.get(b.id) ?? (b.detent === 'low' ? -1 : 0);
      const next = rampAxis(cur, dir, dt, b.detent ?? 'center');
      this.ramp.set(b.id, next);
      return next;
    }
    return 0;
  }

  /** Boolean "is this input active right now" for switch/momentary/toggle. */
  private readActive(b: ChannelBinding, snap: InputSnapshot): boolean {
    switch (b.source) {
      case 'keyboard':
        return snap.keys.has(normElementKey(b.element));
      case 'gamepad':
        return snap.gamepadButton(parseButtonElement(b.element));
      case 'onscreen':
        return snap.pressed.has(b.id);
      default:
        return false;
    }
  }

  /** Hold-ramp: value climbs toward max while held, springs back to its rest. */
  private readHoldRamp(b: ChannelBinding, snap: InputSnapshot, dt: number): number {
    const held = this.readActive(b, snap);
    const perSec = 1 / Math.max(0.05, b.holdRampSeconds ?? 0.5);
    const rest = b.detent === 'center' ? 0.5 : 0; // where it settles on release
    let n = this.ramp.get(b.id) ?? rest;
    if (held) n = clamp(n + perSec * dt, 0, 1);
    else if (b.detent !== 'free') n = Math.max(rest, n - CENTER_SPRING_PER_SEC * dt);
    this.ramp.set(b.id, n);
    const { minUs, maxUs, trimUs, reverse } = b.shaping;
    const span = maxUs - minUs;
    const us = reverse ? maxUs - n * span : minUs + n * span;
    return clampChannelUs(us + trimUs);
  }
}

/** The µs a switch/ramp settles to when released, from its per-channel detent. */
function restUsFor(b: ChannelBinding): number {
  if (b.detent === 'center') return CHANNEL_NEUTRAL_US;
  return b.shaping.minUs;
}

function rampAxis(current: number, dir: number, dt: number, detent: 'center' | 'low' | 'free' = 'center'): number {
  if (dir === 0) {
    if (detent === 'free') return current; // ratcheted: stay put
    const target = detent === 'low' ? -1 : 0;
    const step = CENTER_SPRING_PER_SEC * dt;
    if (current > target) return Math.max(target, current - step);
    if (current < target) return Math.min(target, current + step);
    return target;
  }
  return clamp(current + dir * KEY_RAMP_PER_SEC * dt, -1, 1);
}

function parseAxisElement(el: string): { index: number; invert: boolean } {
  // "axis:3" or "axis:3:inv"
  const parts = el.split(':');
  return { index: Number(parts[1] ?? 0) || 0, invert: parts[2] === 'inv' };
}

function parseButtonElement(el: string): number {
  // "button:1"
  return Number(el.split(':')[1] ?? 0) || 0;
}

function parseJoyElement(el: string): { joyId: string; axis: 'x' | 'y' } {
  // "joy:L:x"
  const parts = el.split(':');
  return { joyId: parts[1] ?? 'L', axis: parts[2] === 'y' ? 'y' : 'x' };
}

function normElementKey(k: string): string {
  const key = (k ?? '').trim().toLowerCase();
  if (key === 'space' || key === '') return ' ';
  return key;
}
