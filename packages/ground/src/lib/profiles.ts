import {
  CHANNEL_COUNT,
  CHANNEL_NEUTRAL_US,
  defaultShaping,
  neutralChannels,
} from '@yonderrc/protocol';
import type { BindingMode, ChannelBinding, InputSource, Profile } from '@yonderrc/protocol';

const PROFILES_KEY = 'yonderrc.profiles.v1';
const ACTIVE_KEY = 'yonderrc.activeProfile.v1';

let idCounter = 0;
function bindingId(): string {
  return `b${Date.now().toString(36)}${(idCounter++).toString(36)}`;
}

export function makeBinding(
  channel: number,
  source: InputSource,
  element: string,
  mode: BindingMode,
  overrides: Partial<ChannelBinding['shaping']> = {},
  holdRampSeconds?: number,
): ChannelBinding {
  return {
    id: bindingId(),
    channel,
    source,
    element,
    mode,
    holdRampSeconds,
    shaping: { ...defaultShaping(), ...overrides },
  };
}

/** The three profiles the user asked for, plus a gamepad one — all editable. */
function seedProfiles(): Profile[] {
  return [
    {
      id: 'keyboard',
      name: 'Keyboard + Buttons',
      driver: 'sim',
      throttleChannels: [2],
      bindings: [
        makeBinding(0, 'keyboard', 'a|d', 'proportional'),
        makeBinding(2, 'keyboard', 's|w', 'proportional'),
        makeBinding(4, 'onscreen', 'btn', 'momentary'),
        makeBinding(5, 'onscreen', 'btn', 'toggle'),
      ],
    },
    {
      id: 'gamepad',
      name: 'Gamepad Sticks',
      driver: 'sim',
      throttleChannels: [2],
      bindings: [
        makeBinding(0, 'gamepad', 'axis:0', 'proportional'),
        makeBinding(2, 'gamepad', 'axis:3:inv', 'proportional'),
        makeBinding(3, 'gamepad', 'axis:2', 'proportional'),
        makeBinding(4, 'gamepad', 'button:0', 'momentary'),
        makeBinding(5, 'gamepad', 'button:1', 'toggle'),
      ],
    },
    {
      id: 'touch',
      name: 'Touch Joysticks',
      driver: 'sim',
      throttleChannels: [2],
      bindings: [
        makeBinding(0, 'virtual', 'joy:L:x', 'proportional'),
        makeBinding(2, 'virtual', 'joy:R:y', 'proportional'),
        makeBinding(4, 'onscreen', 'btn', 'momentary'),
        makeBinding(5, 'onscreen', 'btn', 'toggle'),
      ],
    },
    {
      id: 'holdramp',
      name: 'Hold-ramp Buttons',
      driver: 'sim',
      throttleChannels: [2],
      bindings: [
        // Throttle climbs the longer you hold — proportional from a button.
        makeBinding(2, 'onscreen', 'btn', 'hold-ramp', {}, 0.8),
        makeBinding(0, 'keyboard', 'a|d', 'proportional'),
        makeBinding(5, 'onscreen', 'btn', 'toggle'),
      ],
    },
  ];
}

export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Profile[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    }
  } catch {
    /* fall through to seed */
  }
  const seeded = seedProfiles();
  saveProfiles(seeded);
  return seeded;
}

export function saveProfiles(profiles: Profile[]): void {
  try {
    localStorage.setItem(PROFILES_KEY, JSON.stringify(profiles));
  } catch {
    /* storage unavailable — non-fatal for a session */
  }
}

export function getActiveId(profiles: Profile[]): string {
  const stored = localStorage.getItem(ACTIVE_KEY);
  if (stored && profiles.some((p) => p.id === stored)) return stored;
  return profiles[0]?.id ?? 'keyboard';
}

export function setActiveId(id: string): void {
  try {
    localStorage.setItem(ACTIVE_KEY, id);
  } catch {
    /* ignore */
  }
}

/** Build the 16-channel failsafe array the vehicle should hold on link loss. */
export function profileFailsafeUs(profile: Profile): number[] {
  const arr = neutralChannels();
  for (const b of profile.bindings) {
    if (b.channel >= 0 && b.channel < CHANNEL_COUNT) {
      arr[b.channel] = b.shaping.failsafeUs ?? CHANNEL_NEUTRAL_US;
    }
  }
  return arr;
}

export function cloneProfile(p: Profile, name: string): Profile {
  return {
    ...p,
    id: `p${Date.now().toString(36)}`,
    name,
    bindings: p.bindings.map((b) => ({ ...b, id: bindingId(), shaping: { ...b.shaping } })),
  };
}
