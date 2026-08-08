import type { ClientMessage } from '@yonderrc/protocol';
import { PROTOCOL_VERSION } from '@yonderrc/protocol';
import type { VehicleCore } from '../core/VehicleCore.js';

/**
 * One place that turns a decoded client message into VehicleCore calls, so the
 * WebSocket path and the WebRTC data-channel path behave identically. RTC
 * signaling ('rtc') is handled by the transport, not here.
 */
export function handleClientMessage(core: VehicleCore, msg: ClientMessage): void {
  switch (msg.type) {
    case 'hello':
      if (msg.protocol !== PROTOCOL_VERSION) {
        console.warn(
          `[link] protocol mismatch: ground=${msg.protocol} vehicle=${PROTOCOL_VERSION}`,
        );
      }
      break;
    case 'control':
      core.applyControl(msg);
      break;
    case 'arm':
      core.setArmed(msg.armed);
      console.log(`[link] ${msg.armed ? 'ARMED' : 'disarmed'} by ground`);
      break;
    case 'config':
      if (msg.failsafeUs) core.setFailsafe(msg.failsafeUs);
      if (msg.throttleChannels) core.setThrottleChannels(msg.throttleChannels);
      console.log(
        `[link] config updated: failsafe=${msg.failsafeUs ? 'yes' : 'no'} ` +
          `throttle=[${msg.throttleChannels?.join(',') ?? 'unchanged'}]`,
      );
      break;
    case 'rtc':
      /* handled by the transport layer */
      break;
    case 'calib':
      if (msg.action === 'start') core.startCalibration(msg.channel ?? 0, msg.minUs, msg.maxUs);
      else if (msg.action === 'next') core.nextCalibration();
      else if (msg.action === 'cancel') core.cancelCalibration();
      break;
  }
}
