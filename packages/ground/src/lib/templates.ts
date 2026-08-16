import { CHANNEL_COUNT, CHANNEL_NEUTRAL_US, shapeProportional } from '@yonderrc/protocol';
import type {
  ChannelBinding,
  ChannelShaping,
  Detent,
  Endpoints,
  InputMethod,
  Profile,
  StickAxis,
  StickFunction,
  StickMode,
  VehicleType,
} from '@yonderrc/protocol';

/**
 * A model template describes a vehicle's controls logically (which stick axis and
 * which aux switches drive which channels), independent of the input method. From
 * it we generate concrete bindings for keyboard / gamepad / touch, so switching
 * the input method inside a profile keeps the same channel map and just changes
 * where the values come from.
 */

interface AxisSpec {
  channel: number;
  label: string;
  stickAxis: StickAxis;
}
interface AuxSpec {
  channel: number;
  label: string;
  mode: 'toggle' | 'momentary';
}
interface VehicleTemplate {
  vehicleType: VehicleType;
  name: string;
  throttleChannels: number[];
  axes: AxisSpec[];
  aux: AuxSpec[];
  defaultDetents: Record<StickAxis, Detent>;
  defaultInputMethod: InputMethod;
  defaultStickMode: StickMode;
}

// Element mapping per input method (mode-2 stick layout by convention).
const KB_AXIS: Record<StickAxis, string> = { leftX: 'a|d', leftY: 's|w', rightX: 'j|l', rightY: 'k|i' };
const GP_AXIS: Record<StickAxis, string> = {
  leftX: 'axis:0',
  leftY: 'axis:1:inv',
  rightX: 'axis:2',
  rightY: 'axis:3:inv',
};
const TOUCH_AXIS: Record<StickAxis, string> = {
  leftX: 'joy:L:x',
  leftY: 'joy:L:y',
  rightX: 'joy:R:x',
  rightY: 'joy:R:y',
};

/**
 * Transmitter modes 1–4: which stick axis carries each function. Mode 2 is the
 * common default (throttle on the left stick). Switching mode reassigns the stick
 * axes; the per-method element (keys / gamepad axis / touch stick) is then
 * re-derived from the new axis.
 */
const MODE_TABLE: Record<StickMode, Record<StickFunction, StickAxis>> = {
  1: { throttle: 'rightY', elevator: 'leftY', aileron: 'rightX', rudder: 'leftX' },
  2: { throttle: 'leftY', elevator: 'rightY', aileron: 'rightX', rudder: 'leftX' },
  3: { throttle: 'rightY', elevator: 'leftY', aileron: 'leftX', rudder: 'rightX' },
  4: { throttle: 'leftY', elevator: 'rightY', aileron: 'leftX', rudder: 'rightX' },
};

/** Map a control label to its stick function (for mode remapping). */
export function funcFromLabel(label?: string): StickFunction | null {
  switch ((label ?? '').toLowerCase()) {
    case 'throttle':
      return 'throttle';
    case 'elevator':
    case 'pitch':
      return 'elevator';
    case 'aileron':
    case 'roll':
      return 'aileron';
    case 'rudder':
    case 'yaw':
    case 'steering':
      return 'rudder';
    default:
      return null;
  }
}

const AXIS_ELEMENT: Record<InputMethod, Record<StickAxis, string>> = {
  keyboard: KB_AXIS,
  gamepad: GP_AXIS,
  touch: TOUCH_AXIS,
};

export function stickModes(): StickMode[] {
  return [1, 2, 3, 4];
}

/**
 * Reassign the primary stick-axis bindings to a transmitter mode (1–4), then
 * re-derive each one's input element for the profile's current method. Aux
 * channels and custom channels are untouched.
 */
export function applyStickMode(profile: Profile, mode: StickMode): Profile {
  const map = MODE_TABLE[mode];
  const bindings = profile.bindings.map((b) => {
    const fn = b.stickAxis ? funcFromLabel(b.label) : null;
    if (!fn) return b;
    const stickAxis = map[fn];
    const element = AXIS_ELEMENT[profile.inputMethod][stickAxis];
    return { ...b, stickAxis, element };
  });
  return { ...profile, stickMode: mode, bindings };
}
const KB_AUX = ['g', 'h', 'b', 'n', 'm', 'v'];

const CENTER: Record<StickAxis, Detent> = { leftX: 'center', leftY: 'center', rightX: 'center', rightY: 'center' };

const TEMPLATES: Record<VehicleType, VehicleTemplate> = {
  car: {
    vehicleType: 'car',
    name: 'Car',
    throttleChannels: [2],
    axes: [
      { channel: 0, label: 'Steering', stickAxis: 'leftX' },
      { channel: 2, label: 'Throttle', stickAxis: 'rightY' },
    ],
    aux: [
      { channel: 4, label: 'Lights', mode: 'toggle' },
      { channel: 5, label: 'Horn', mode: 'momentary' },
    ],
    // Car throttle centers (neutral = stop, allows reverse).
    defaultDetents: { ...CENTER },
    defaultInputMethod: 'keyboard',
    // Mode 2 puts steering (X) and throttle (Y) on the SAME left stick — a car
    // needs only two axes, so one thumb drives it. Mode 4 splits them across two
    // sticks if you prefer that.
    defaultStickMode: 2,
  },
  boat: {
    vehicleType: 'boat',
    name: 'Boat',
    throttleChannels: [2],
    axes: [
      { channel: 0, label: 'Rudder', stickAxis: 'leftX' },
      { channel: 2, label: 'Throttle', stickAxis: 'rightY' },
    ],
    aux: [
      { channel: 4, label: 'Lights', mode: 'toggle' },
      { channel: 5, label: 'Horn', mode: 'momentary' },
    ],
    defaultDetents: { ...CENTER, rightY: 'free' },
    defaultInputMethod: 'keyboard',
    defaultStickMode: 1,
  },
  plane: {
    vehicleType: 'plane',
    name: 'Plane',
    throttleChannels: [2],
    axes: [
      { channel: 0, label: 'Aileron', stickAxis: 'rightX' },
      { channel: 1, label: 'Elevator', stickAxis: 'rightY' },
      { channel: 2, label: 'Throttle', stickAxis: 'leftY' },
      { channel: 3, label: 'Rudder', stickAxis: 'leftX' },
    ],
    aux: [
      { channel: 4, label: 'Flaps', mode: 'toggle' },
      { channel: 5, label: 'Gear', mode: 'toggle' },
    ],
    // Throttle (left Y) stays where set (ratcheted); control surfaces center.
    defaultDetents: { ...CENTER, leftY: 'free' },
    defaultInputMethod: 'touch',
    defaultStickMode: 2,
  },
  drone: {
    vehicleType: 'drone',
    name: 'Drone',
    throttleChannels: [2],
    axes: [
      { channel: 0, label: 'Roll', stickAxis: 'rightX' },
      { channel: 1, label: 'Pitch', stickAxis: 'rightY' },
      { channel: 2, label: 'Throttle', stickAxis: 'leftY' },
      { channel: 3, label: 'Yaw', stickAxis: 'leftX' },
    ],
    aux: [
      { channel: 4, label: 'Arm', mode: 'toggle' },
      { channel: 5, label: 'Mode', mode: 'toggle' },
    ],
    // Drone: both sticks center (altitude-hold style).
    defaultDetents: { ...CENTER },
    defaultInputMethod: 'touch',
    defaultStickMode: 2,
  },
};

let idc = 0;
const bid = () => `b${Date.now().toString(36)}${(idc++).toString(36)}`;

function shaping(endpoints: Endpoints, failsafeUs: number): ChannelShaping {
  return { trimUs: 0, expo: 0, reverse: false, minUs: endpoints.minUs, maxUs: endpoints.maxUs, failsafeUs };
}

function centerUs(endpoints: Endpoints): number {
  return Math.round((endpoints.minUs + endpoints.maxUs) / 2);
}

/**
 * Failsafe value for a channel on LINK LOSS while armed. This is deliberately
 * vehicle-type aware, because "safe" differs:
 *  - car/boat throttle → center (neutral = stop; min could be full reverse!)
 *  - plane throttle    → min (motor off, glide down)
 *  - drone throttle    → center (HOLD; min would cut motors and drop it)
 * All non-throttle channels center. Every value stays editable per channel.
 */
function failsafeFor(
  channel: number,
  throttleChannels: number[],
  endpoints: Endpoints,
  vehicleType: VehicleType,
): number {
  const center = centerUs(endpoints);
  if (!throttleChannels.includes(channel)) return center;
  if (vehicleType === 'plane') return endpoints.minUs;
  return center; // car, boat, drone throttle → neutral/hold
}

/** A channel's neutral shaping, for the rare throttle channel with no binding. */
export function plainShaping(endpoints: Endpoints): ChannelShaping {
  return shaping(endpoints, centerUs(endpoints));
}

/**
 * Where the stick sits, normalized, when a vehicle of this type is OFF:
 *  - car/boat → centre (neutral = stop; min could be full reverse!)
 *  - plane/drone → idle (motors off)
 */
function offPosition(vehicleType: VehicleType): number {
  return vehicleType === 'car' || vehicleType === 'boat' ? 0 : -1;
}

/**
 * Value a throttle channel takes when DELIBERATELY disarmed (on the bench / landed).
 * This is NOT the failsafe value — a disarmed drone must have motors OFF, even
 * though its in-flight failsafe holds at centre.
 *
 * It is DERIVED by running the resting stick position through the channel's own
 * shaping, rather than being read off the profile's endpoints. That is what makes
 * it correct on a **reversed** channel: with `reverse` ticked, the idle stick maps
 * to maxUs, so "motors off" is 2000 µs, not 1000 — and the old version, which
 * returned `endpoints.minUs` flat, commanded FULL throttle on disarm there.
 * Per-channel endpoints and trim come along for the same reason.
 */
export function disarmedThrottleUs(vehicleType: VehicleType, shape: ChannelShaping): number {
  return shapeProportional(offPosition(vehicleType), shape);
}

/**
 * The stick position a stored failsafe µs corresponds to on this channel, -1..1.
 *
 * The failsafe is sent as a RAW µs — it never passes through shaping — so reading
 * it back is the only way to know what it physically means on a channel that has
 * been reversed, retrimmed or given its own endpoints. Expo is deliberately not
 * undone: it only compresses the middle, and this is used to judge positions near
 * the top, where it is the identity.
 */
export function failsafeStickPosition(shape: ChannelShaping): number {
  const half = (shape.maxUs - shape.minUs) / 2;
  if (half === 0) return 0;
  const center = (shape.minUs + shape.maxUs) / 2;
  const v = Math.max(-1, Math.min(1, (shape.failsafeUs - shape.trimUs - center) / half));
  return shape.reverse ? -v : v;
}

/** How much throttle counts as "this must be a mistake" for a link-loss value. */
const FAILSAFE_HIGH_THROTTLE = 0.5;

export interface ThrottleFailsafeRisk {
  /** Stick position the stored failsafe maps to, -1..1 (1 = full throttle). */
  position: number;
  /** Percent of travel, for a readable message. */
  percent: number;
  /** The µs on THIS channel that means "off" for this vehicle type. */
  safeUs: number;
}

/**
 * Non-null when a throttle channel's stored failsafe would open the throttle on
 * link loss. No vehicle type wants that, so the threshold can be blunt rather than
 * second-guessing a deliberate setting — a plane cruising home on a low failsafe
 * throttle stays under it.
 *
 * The case this exists for: the failsafe µs is seeded when the profile is built,
 * before anyone ticks `reverse`. Tick it afterwards and the stored 1000 µs, which
 * meant "motor off", now means full power — while the number in the editor still
 * reads 1000 and looks entirely reasonable.
 */
export function throttleFailsafeRisk(vehicleType: VehicleType, shape: ChannelShaping): ThrottleFailsafeRisk | null {
  const position = failsafeStickPosition(shape);
  if (position <= FAILSAFE_HIGH_THROTTLE) return null;
  return {
    position,
    percent: Math.round(((position + 1) / 2) * 100),
    safeUs: disarmedThrottleUs(vehicleType, shape),
  };
}

/**
 * Which channels actually carry throttle **right now**.
 *
 * A profile stores `throttleChannels` from its template, but the binding editor
 * lets you move a binding to another channel without touching that list — and
 * everything safety-relevant hangs off it: the disarmed value the vehicle forces,
 * the failsafe array, the pre-arm check, the OSD bar. A stale list means the
 * vehicle guards a channel that isn't the throttle and passes the real one
 * straight through while "disarmed".
 *
 * So derive it from the bindings (same label→function mapping the stick modes
 * use) and only fall back to the stored list when nothing matches — renaming the
 * label to something we don't recognise then behaves exactly as before.
 */
export function throttleChannelsOf(profile: Profile): number[] {
  const derived = profile.bindings
    .filter((b) => funcFromLabel(b.label) === 'throttle')
    .map((b) => b.channel)
    .filter((ch) => Number.isInteger(ch) && ch >= 0);
  const unique = [...new Set(derived)].sort((a, b) => a - b);
  return unique.length ? unique : profile.throttleChannels;
}

/**
 * The travel limits an ESC on this channel will actually see: the channel's own
 * endpoints, falling back to the profile-wide ones when it has none. Used by the
 * calibration wizard, which must teach the ESC the range it is driven with — not
 * the profile default, which the channel may deliberately have narrowed.
 */
export function channelEndpoints(profile: Profile, channel: number): Endpoints {
  const b = profile.bindings.find((x) => x.channel === channel);
  return {
    minUs: b?.shaping.minUs ?? profile.endpoints.minUs,
    maxUs: b?.shaping.maxUs ?? profile.endpoints.maxUs,
  };
}

/** Store the derived list back, so the persisted model is self-consistent. */
export function withResolvedThrottle(profile: Profile): Profile {
  const ch = throttleChannelsOf(profile);
  const same = ch.length === profile.throttleChannels.length && ch.every((c, i) => c === profile.throttleChannels[i]);
  return same ? profile : { ...profile, throttleChannels: ch };
}

/**
 * Should the vehicle auto-disarm when a new ground connects? Vehicle-type policy:
 * car/boat → YES (stopping is always safe; prevents runaway on reconnect), but
 * plane/drone → NO, because disarming in flight cuts the motors and it falls. The
 * ground derives this from the active profile and pushes it, so it can't be
 * mis-set independently of the vehicle type.
 */
export function disarmOnReconnectForType(vehicleType: VehicleType): boolean {
  return vehicleType === 'car' || vehicleType === 'boat';
}

/**
 * How the operator wants auto-disarm decided. 'auto' keeps the vehicle-type
 * policy above (the default and the safe choice); 'on'/'off' override it for a
 * setup the type doesn't describe — e.g. a bench rig, or a boat you want to keep
 * running through a link drop.
 */
export type AutoDisarmMode = 'auto' | 'on' | 'off';

export function resolveAutoDisarm(mode: AutoDisarmMode, vehicleType: VehicleType): boolean {
  if (mode === 'on') return true;
  if (mode === 'off') return false;
  return disarmOnReconnectForType(vehicleType);
}

function buildBindings(
  t: VehicleTemplate,
  method: InputMethod,
  endpoints: Endpoints,
  detents: Record<StickAxis, Detent>,
): ChannelBinding[] {
  const out: ChannelBinding[] = [];

  for (const ax of t.axes) {
    const source = method === 'keyboard' ? 'keyboard' : method === 'gamepad' ? 'gamepad' : 'virtual';
    const element =
      method === 'keyboard' ? KB_AXIS[ax.stickAxis] : method === 'gamepad' ? GP_AXIS[ax.stickAxis] : TOUCH_AXIS[ax.stickAxis];
    out.push({
      id: bid(),
      channel: ax.channel,
      source,
      element,
      mode: 'proportional',
      stickAxis: ax.stickAxis,
      detent: detents[ax.stickAxis],
      label: ax.label,
      shaping: shaping(endpoints, failsafeFor(ax.channel, t.throttleChannels, endpoints, t.vehicleType)),
    });
  }

  t.aux.forEach((a, i) => {
    const source = method === 'keyboard' ? 'keyboard' : method === 'gamepad' ? 'gamepad' : 'onscreen';
    const element = method === 'keyboard' ? KB_AUX[i] ?? 'g' : method === 'gamepad' ? `button:${i}` : 'btn';
    out.push({
      id: bid(),
      channel: a.channel,
      source,
      element,
      mode: a.mode,
      label: a.label,
      shaping: shaping(endpoints, failsafeFor(a.channel, t.throttleChannels, endpoints, t.vehicleType)),
    });
  });

  return out;
}

export function vehicleTypes(): VehicleType[] {
  return ['car', 'plane', 'drone', 'boat'];
}

export function buildProfile(
  vehicleType: VehicleType,
  opts: { id?: string; name?: string; inputMethod?: InputMethod; endpoints?: Endpoints } = {},
): Profile {
  const t = TEMPLATES[vehicleType];
  const endpoints = opts.endpoints ?? { minUs: 1000, maxUs: 2000 };
  const method = opts.inputMethod ?? t.defaultInputMethod;
  const detents = { ...t.defaultDetents };
  // The template's `axes` are written in one fixed stick layout, so the default
  // mode has to be APPLIED, not just recorded — otherwise a template whose
  // default differs from that layout ships a profile claiming a mode it isn't in.
  return applyStickMode({
    id: opts.id ?? `p_${vehicleType}_${Date.now().toString(36)}${(idc++).toString(36)}`,
    name: opts.name ?? t.name,
    vehicleType,
    driver: 'sim',
    inputMethod: method,
    endpoints,
    throttleChannels: t.throttleChannels,
    stickMode: t.defaultStickMode,
    bindings: buildBindings(t, method, endpoints, detents),
  }, t.defaultStickMode);
}

/** Regenerate bindings for a new input method, preserving detents + per-channel shaping. */
export function rebuildForMethod(profile: Profile, method: InputMethod): Profile {
  const t = TEMPLATES[profile.vehicleType];
  // A detent belongs to a CHANNEL, not a stick axis. Keying it by axis breaks
  // once a transmitter mode has moved an axis to a different channel, so capture
  // it per channel and re-apply after buildBindings (which seeds template defaults).
  const detentByChannel = new Map<number, Detent>();
  for (const b of profile.bindings) if (b.stickAxis && b.detent) detentByChannel.set(b.channel, b.detent);

  const fresh = buildBindings(t, method, profile.endpoints, t.defaultDetents);
  for (const nb of fresh) {
    const ob = profile.bindings.find((o) => o.channel === nb.channel);
    if (ob) {
      nb.shaping = {
        ...nb.shaping,
        trimUs: ob.shaping.trimUs,
        expo: ob.shaping.expo,
        reverse: ob.shaping.reverse,
        failsafeUs: ob.shaping.failsafeUs,
        minUs: ob.shaping.minUs,
        maxUs: ob.shaping.maxUs,
      };
      if (ob.holdRampSeconds != null) nb.holdRampSeconds = ob.holdRampSeconds;
    }
    const d = detentByChannel.get(nb.channel);
    if (d) nb.detent = d;
  }
  // Preserve user-added channels (those not produced by the template) unchanged —
  // they carry their own source/element and aren't tied to the input method.
  const freshChannels = new Set(fresh.map((b) => b.channel));
  const custom = profile.bindings.filter((b) => !freshChannels.has(b.channel));
  const rebuilt: Profile = { ...profile, inputMethod: method, bindings: [...fresh, ...custom] };
  // Preserve the transmitter mode across a method switch (fresh bindings come out
  // in the template's default-mode layout).
  return applyStickMode(rebuilt, profile.stickMode ?? TEMPLATES[profile.vehicleType].defaultStickMode);
}

let customCounter = 0;

/** The lowest channel index (0-based) not yet used by any binding. */
export function nextFreeChannel(profile: Profile): number {
  const used = new Set(profile.bindings.map((b) => b.channel));
  for (let i = 0; i < CHANNEL_COUNT; i++) if (!used.has(i)) return i;
  return CHANNEL_COUNT - 1;
}

/** Build a fresh custom binding (used by the Add-channel UI). */
export function createBinding(opts: {
  channel: number;
  source: ChannelBinding['source'];
  element: string;
  mode: ChannelBinding['mode'];
  label: string;
  endpoints: Endpoints;
  detent?: Detent;
}): ChannelBinding {
  return {
    id: `c_${Date.now().toString(36)}${(customCounter++).toString(36)}`,
    channel: opts.channel,
    source: opts.source,
    element: opts.element,
    mode: opts.mode,
    detent: opts.detent,
    label: opts.label || `Channel ${opts.channel + 1}`,
    shaping: shaping(opts.endpoints, opts.detent === 'center' ? CHANNEL_NEUTRAL_US : failsafeFor(opts.channel, [], opts.endpoints, 'car')),
  };
}

/** Apply a new global endpoint range to every channel (per-channel edits come after). */
export function applyEndpoints(profile: Profile, endpoints: Endpoints): Profile {
  return {
    ...profile,
    endpoints,
    bindings: profile.bindings.map((b) => ({
      ...b,
      // Only the travel limits change; failsafe values are a safety setting and
      // must NOT be silently reset here (that could turn a drone's "hold" failsafe
      // back into a motor-cut).
      shaping: { ...b.shaping, minUs: endpoints.minUs, maxUs: endpoints.maxUs },
    })),
  };
}

/** Set the detent for one stick axis (edits the matching axis binding). */
export function setDetent(profile: Profile, stickAxis: StickAxis, detent: Detent): Profile {
  return {
    ...profile,
    bindings: profile.bindings.map((b) => (b.stickAxis === stickAxis ? { ...b, detent } : b)),
  };
}

/**
 * Repair stick-axis bindings whose `source`/`element` don't match the profile's
 * input method.
 *
 * A profile is stored in the browser and outlives the app version that wrote it.
 * Before v1.10.0 a transmitter-mode switch reassigned the axis without
 * re-deriving its input element, and a method switch could leave a moved axis on
 * its old source — the result is an axis that no input drives: on touch its
 * joystick isn't rendered at all (the pad only draws `virtual` bindings with a
 * `joy:…` element), and the channel sits at centre instead of its rest position,
 * so the pre-arm check refuses to arm with "throttle not at idle".
 *
 * An axis binding has exactly one correct source/element per method, so this can
 * be repaired without guessing. Aux and user-added channels are left alone.
 */
export function repairAxisBindings(profile: Profile): Profile {
  const method = profile.inputMethod;
  const wantSource = method === 'keyboard' ? 'keyboard' : method === 'gamepad' ? 'gamepad' : 'virtual';
  let changed = false;
  const bindings = profile.bindings.map((b) => {
    if (!b.stickAxis) return b;
    const wantElement = AXIS_ELEMENT[method]?.[b.stickAxis];
    if (!wantElement) return b;
    if (b.source === wantSource && b.element === wantElement) return b;
    changed = true;
    return { ...b, source: wantSource as ChannelBinding['source'], element: wantElement };
  });
  return changed ? { ...profile, bindings } : profile;
}

/** The detents currently in effect, for the editor UI. */
export function currentDetents(profile: Profile): Partial<Record<StickAxis, Detent>> {
  const out: Partial<Record<StickAxis, Detent>> = {};
  for (const b of profile.bindings) if (b.stickAxis) out[b.stickAxis] = b.detent;
  return out;
}
