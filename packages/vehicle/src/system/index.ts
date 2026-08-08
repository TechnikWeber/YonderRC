import type { SystemManager } from './SystemManager.js';
import { SimSystem } from './SimSystem.js';
import { RealSystem } from './RealSystem.js';

export type SystemKind = 'sim' | 'real';

/**
 * Choose the system manager. Defaults to 'sim' everywhere except when explicitly
 * set to 'real' (YRC_SYSTEM=real on the Pi), so a dev machine never tries to
 * shell out to tailscale/mmcli.
 */
export function createSystem(kind: SystemKind): SystemManager {
  return kind === 'real' ? new RealSystem() : new SimSystem();
}

export type { SystemManager } from './SystemManager.js';
