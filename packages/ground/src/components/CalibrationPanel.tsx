import { useEffect, useState } from 'react';
import type { CalibrationStatus, Profile } from '@yonderrc/protocol';
import { channelEndpoints, throttleChannelsOf } from '../lib/templates';

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
  onStart: (channel: number, minUs: number, maxUs: number) => void;
  onNext: () => void;
  onCancel: () => void;
}) {
  const derived = (throttleChannelsOf(profile)[0] ?? 2) + 1;
  const [channel, setChannel] = useState(derived);
  // Follow the model: switching profiles (or moving the throttle) must not leave
  // the field pointing at the previous model's channel.
  useEffect(() => {
    if (!(calibration?.active ?? false)) setChannel(derived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [derived, profile.id]);
  const active = calibration?.active ?? false;
  // The ESC has to learn the range it is actually driven with, so use the
  // channel's own endpoints (the profile-wide ones are only a fallback).
  const ep = channelEndpoints(profile, channel - 1);

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
          <p className="calib-range">
            Will teach the ESC <b>CH{String(channel).padStart(2, '0')}</b>: max{' '}
            <b>{ep.maxUs} µs</b> → min <b>{ep.minUs} µs</b>
            {channel !== derived && <> · ⚠ not this model's throttle channel (CH{String(derived).padStart(2, '0')})</>}
          </p>
          <button
            className="btn wide primary"
            disabled={!connected}
            onClick={() => onStart(channel - 1, ep.minUs, ep.maxUs)}
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
