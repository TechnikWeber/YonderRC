import { useState } from 'react';
import type { CalibrationStatus, Profile } from '@yonderrc/protocol';
import { throttleChannelsOf } from '../lib/templates';

/**
 * ESC throttle-range calibration wizard. Runs against the vehicle's non-blocking
 * state machine: Start applies MAX, Next steps to MIN, Next again finishes. The
 * vehicle stays disarmed and forces all other channels safe throughout.
 */
export function CalibrationPanel({
  profile,
  calibration,
  connected,
  onStart,
  onNext,
  onCancel,
}: {
  profile: Profile;
  calibration: CalibrationStatus | undefined;
  connected: boolean;
  onStart: (channel: number) => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const [channel, setChannel] = useState((throttleChannelsOf(profile)[0] ?? 2) + 1);
  const active = calibration?.active ?? false;

  return (
    <section className="panel calib">
      <span className="eyebrow">ESC calibration</span>

      <p className="calib-warn">
        ⚠ Remove propellers before calibrating. The motor may spin at full
        throttle during the first step.
      </p>

      {!active ? (
        <>
          <label className="calib-ch">
            Throttle channel
            <input
              type="number"
              min={1}
              max={16}
              value={channel}
              onChange={(e) => setChannel(Number(e.target.value))}
            />
          </label>
          <button
            className="btn wide primary"
            disabled={!connected}
            onClick={() => onStart(channel - 1)}
          >
            {connected ? 'Start calibration' : 'Connect vehicle first'}
          </button>
        </>
      ) : (
        <>
          <div className="calib-step">
            <div className="step-name">{calibration?.step}</div>
            <p>{calibration?.message}</p>
          </div>
          <div className="calib-actions">
            <button className="btn primary" onClick={onNext}>
              {calibration?.step === 'lower-min' ? 'Finish' : 'Next'}
            </button>
            <button className="btn" onClick={onCancel}>Cancel</button>
          </div>
        </>
      )}
    </section>
  );
}
