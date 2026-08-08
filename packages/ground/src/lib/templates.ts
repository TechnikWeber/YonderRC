import type {
  ChannelBinding,
  ChannelShaping,
  Detent,
  Endpoints,
  InputMethod,
  Profile,
  StickAxis,
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
  },
};

let idc = 0;
const bid = () => `b${Date.now().toString(36)}${(idc++).toString(36)}`;

function shaping(endpoints: Endpoints, failsafeUs: number): ChannelShaping {
  return { trimUs: 0, expo: 0, reverse: false, minUs: endpoints.minUs, maxUs: endpoints.maxUs, failsafeUs };
}

function failsafeFor(channel: number, throttleChannels: number[], endpoints: Endpoints): number {
  // Throttle fails safe to minimum (motor idle/off); everything else to center.
  return throttleChannels.includes(channel) ? endpoints.minUs : 1500;
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
      shaping: shaping(endpoints, failsafeFor(ax.channel, t.throttleChannels, endpoints)),
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
      shaping: shaping(endpoints, failsafeFor(a.channel, t.throttleChannels, endpoints)),
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
  return {
    id: opts.id ?? `p_${vehicleType}_${Date.now().toString(36)}${(idc++).toString(36)}`,
    name: opts.name ?? t.name,
    vehicleType,
    driver: 'sim',
    inputMethod: method,
    endpoints,
    throttleChannels: t.throttleChannels,
    bindings: buildBindings(t, method, endpoints, detents),
  };
}

/** Regenerate bindings for a new input method, preserving detents + per-channel shaping. */
export function rebuildForMethod(profile: Profile, method: InputMethod): Profile {
  const t = TEMPLATES[profile.vehicleType];
  const detents = { ...t.defaultDetents };
  for (const b of profile.bindings) if (b.stickAxis && b.detent) detents[b.stickAxis] = b.detent;

  const fresh = buildBindings(t, method, profile.endpoints, detents);
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
  }
  return { ...profile, inputMethod: method, bindings: fresh };
}

/** Apply a new global endpoint range to every channel (per-channel edits come after). */
export function applyEndpoints(profile: Profile, endpoints: Endpoints): Profile {
  return {
    ...profile,
    endpoints,
    bindings: profile.bindings.map((b) => ({
      ...b,
      shaping: {
        ...b.shaping,
        minUs: endpoints.minUs,
        maxUs: endpoints.maxUs,
        failsafeUs: profile.throttleChannels.includes(b.channel) ? endpoints.minUs : b.shaping.failsafeUs,
      },
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

/** The detents currently in effect, for the editor UI. */
export function currentDetents(profile: Profile): Partial<Record<StickAxis, Detent>> {
  const out: Partial<Record<StickAxis, Detent>> = {};
  for (const b of profile.bindings) if (b.stickAxis) out[b.stickAxis] = b.detent;
  return out;
}
