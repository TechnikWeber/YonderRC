import type { ClientMessage } from '@yonderrc/protocol';
import { CHANNEL_COUNT, PROTOCOL_VERSION } from '@yonderrc/protocol';
import type { VehicleCore } from '../core/VehicleCore.js';
import type { ControlVia } from '../core/linkStats.js';

/** A number, or undefined — never a string or NaN on its way to an output. */
const numOrUndef = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/**
 * One place that turns a decoded client message into VehicleCore calls, so the
 * WebSocket path and the WebRTC data-channel path behave identically. RTC
 * signaling ('rtc') is handled by the transport, not here. `via` only labels the
 * link statistics — both paths are treated exactly alike.
 *
 * Messages arrive as parsed JSON from whatever is connected, so the shape is checked
 * here rather than trusted: only `armed: true` arms, lists must be lists, and a
 * calibration needs one of the 16 channels.
 */
export function handleClientMessage(core: VehicleCore, msg: ClientMessage, session?: number, via: ControlVia = 'ws'): void {
  switch (msg.type) {
    case 'hello':
      if (msg.protocol !== PROTOCOL_VERSION) {
        console.warn(
          `[link] protocol mismatch: ground=${msg.protocol} vehicle=${PROTOCOL_VERSION}`,
        );
      }
      break;
    case 'control':
      core.applyControl(msg, session, via);
      break;
    case 'arm': {
      const armed = msg.armed === true;
      core.setArmed(armed);
      console.log(`[link] ${armed ? 'ARMED' : 'disarmed'} by ground`);
      break;
    }
    case 'config': {
      const failsafe = Array.isArray(msg.failsafeUs) ? msg.failsafeUs : null;
      const disarmed = Array.isArray(msg.disarmedUs) ? msg.disarmedUs : null;
      const throttle = Array.isArray(msg.throttleChannels) ? msg.throttleChannels : null;
      if (failsafe) core.setFailsafe(failsafe);
      if (disarmed) core.setDisarmedUs(disarmed);
      if (throttle) core.setThrottleChannels(throttle);
      if (typeof msg.disarmOnReconnect === 'boolean') core.setDisarmOnReconnect(msg.disarmOnReconnect);
      console.log(
        `[link] config updated: failsafe=${failsafe ? 'yes' : 'no'} ` +
          `disarmed=${disarmed ? 'yes' : 'no'} ` +
          `throttle=[${throttle?.join(',') ?? 'unchanged'}] ` +
          `disarmOnReconnect=${typeof msg.disarmOnReconnect === 'boolean' ? msg.disarmOnReconnect : 'unchanged'}`,
      );
      break;
    }
    case 'rtc':
      /* handled by the transport layer */
      break;
    case 'calib':
      if (msg.action === 'start') {
        const ch = msg.channel ?? 0;
        if (!Number.isInteger(ch) || ch < 0 || ch >= CHANNEL_COUNT) {
          console.warn(`[calib] refused: channel ${String(msg.channel)} is not one of the ${CHANNEL_COUNT}`);
          break;
        }
        core.startCalibration(ch, numOrUndef(msg.minUs), numOrUndef(msg.maxUs));
      } else if (msg.action === 'next') core.nextCalibration();
      else if (msg.action === 'cancel') core.cancelCalibration();
      break;
  }
}
