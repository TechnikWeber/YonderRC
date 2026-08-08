import { CHANNEL_COUNT, CHANNEL_NEUTRAL_US, neutralChannels } from '@yonderrc/protocol';
import type { Profile } from '@yonderrc/protocol';
import { buildProfile } from './templates';

const PROFILES_KEY = 'yonderrc.profiles.v2';
const ACTIVE_KEY = 'yonderrc.activeProfile.v2';

/** Model demo profiles: a car, a plane and a drone, each pre-wired to its type. */
function seedProfiles(): Profile[] {
  return [
    buildProfile('car', { id: 'demo-car', name: 'Demo Car' }),
    buildProfile('plane', { id: 'demo-plane', name: 'Demo Plane' }),
    buildProfile('drone', { id: 'demo-drone', name: 'Demo Drone' }),
  ];
}

export function loadProfiles(): Profile[] {
  try {
    const raw = localStorage.getItem(PROFILES_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Profile[];
      if (Array.isArray(parsed) && parsed.length && parsed[0].vehicleType) return parsed;
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
  return profiles[0]?.id ?? 'demo-car';
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

let cloneCounter = 0;
export function cloneProfile(p: Profile, name: string): Profile {
  return {
    ...p,
    id: `p${Date.now().toString(36)}${(cloneCounter++).toString(36)}`,
    name,
    endpoints: { ...p.endpoints },
    bindings: p.bindings.map((b) => ({
      ...b,
      id: `b${Date.now().toString(36)}${(cloneCounter++).toString(36)}`,
      shaping: { ...b.shaping },
    })),
  };
}
