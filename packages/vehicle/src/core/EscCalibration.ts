import { CHANNEL_MIN_US, CHANNEL_MAX_US, clampChannelUs } from '@yonderrc/protocol';
import type { CalibrationStatus } from '@yonderrc/protocol';

type Step = 'idle' | 'raise-max' | 'lower-min' | 'done';

const MESSAGES: Record<Step, string> = {
  idle: 'Idle.',
  'raise-max':
    'MAX throttle applied. Disconnect propellers! Power the ESC now; after the tones, press Next.',
  'lower-min': 'MIN throttle applied. Wait for the confirmation tones, then press Next.',
  done: 'Calibration complete. ESC range stored. Returning to normal.',
};

/**
 * Drives ESC throttle-range calibration WITHOUT blocking the control loop — the
 * old prototype used time.sleep() mid-loop, going deaf for ~17 s. Here each step
 * just changes what the throttle channel outputs; the ground advances the steps.
 * While active the vehicle forces every other channel to failsafe and blocks
 * arming, so it is safe to run on the bench.
 */
export class EscCalibration {
  private step: Step = 'idle';
  private channel = 0;
  private minUs = CHANNEL_MIN_US;
  private maxUs = CHANNEL_MAX_US;

  get isActive(): boolean {
    return this.step !== 'idle';
  }

  start(channel: number, minUs?: number, maxUs?: number): void {
    this.channel = channel;
    this.minUs = clampChannelUs(minUs ?? CHANNEL_MIN_US);
    this.maxUs = clampChannelUs(maxUs ?? CHANNEL_MAX_US);
    this.step = 'raise-max';
  }

  /** Advance to the next step. Returns true while still calibrating. */
  next(): boolean {
    if (this.step === 'raise-max') this.step = 'lower-min';
    else if (this.step === 'lower-min') this.step = 'done';
    else if (this.step === 'done') this.step = 'idle';
    return this.isActive;
  }

  cancel(): void {
    this.step = 'idle';
  }

  /** The µs value the throttle channel must output right now, or null if idle. */
  throttleOutput(): number | null {
    switch (this.step) {
      case 'raise-max':
        return this.maxUs;
      case 'lower-min':
      case 'done':
        return this.minUs; // idle throttle
      default:
        return null;
    }
  }

  get calibratedChannel(): number {
    return this.channel;
  }

  status(): CalibrationStatus {
    return {
      active: this.isActive,
      step: this.step,
      channel: this.channel,
      message: MESSAGES[this.step],
    };
  }
}
