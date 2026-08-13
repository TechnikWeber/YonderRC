/**
 * Wire messages between ground and vehicle.
 *
 * v0.1 uses a WebSocket transport (trivial to run locally, no signaling, works
 * PC↔phone on a LAN). The transport sits behind an interface on both sides, so
 * swapping in a WebRTC data channel later (bundled with video in M2) does not
 * touch any protocol or app logic. Because both WS messages and WebRTC data
 * messages preserve message boundaries, the framing bug from the old raw-TCP
 * code cannot happen here.
 */

/** Ground → Vehicle */
export type ClientMessage =
  | HelloMessage
  | ControlMessage
  | ArmMessage
  | SetConfigMessage
  | CalibrationMessage
  | VideoQualityMessage
  | RtcSignalMessage;

/** Ground → Vehicle: switch live video quality (rescales cameras + reloads go2rtc). */
export interface VideoQualityMessage {
  type: 'video';
  quality: 'high' | 'medium' | 'low';
}

export interface HelloMessage {
  type: 'hello';
  clientName: string;
  /** Protocol version so mismatches can be detected early. */
  protocol: number;
}

export interface ControlMessage {
  type: 'control';
  /** Monotonic sequence number; vehicle ignores out-of-order/older frames. */
  seq: number;
  /** Client send timestamp (ms since epoch) for latency estimation. */
  t: number;
  /** Exactly CHANNEL_COUNT values, in microseconds. */
  channels: number[];
}

export interface ArmMessage {
  type: 'arm';
  armed: boolean;
}

/**
 * Push vehicle-side config from the ground: per-channel failsafe values (applied
 * locally by the watchdog on link loss) and which channels count as throttle
 * (forced safe while disarmed). Sent on connect and whenever the active profile
 * changes. Failsafe MUST live on the vehicle because only it can act once the
 * link is gone.
 */
export interface SetConfigMessage {
  type: 'config';
  /** Per-channel values held on LINK LOSS while armed (drone throttle → hold). */
  failsafeUs?: number[];
  /** Channels forced to their disarmed value while disarmed (typically throttle). */
  throttleChannels?: number[];
  /**
   * Per-channel value a channel takes when DELIBERATELY disarmed. Distinct from
   * failsafe: a disarmed drone has motors OFF (min), while its in-flight failsafe
   * holds at center. Defaults to failsafe if omitted.
   */
  disarmedUs?: number[];
  /**
   * Whether the vehicle should auto-disarm when a new ground connects. Derived by
   * the ground from the vehicle type (car/boat = true, plane/drone = false) so a
   * reconnect can't cut an aircraft's motors in flight. Applies to the NEXT connect.
   */
  disarmOnReconnect?: boolean;
}

/** Vehicle → Ground */
export type ServerMessage =
  | WelcomeMessage
  | StatusMessage
  | RtcSignalMessage
  | import('./telemetry').TelemetryMessage
  | import('./gps').GpsMessage;

export interface WelcomeMessage {
  type: 'welcome';
  vehicleName: string;
  protocol: number;
  channelCount: number;
  driver: string;
  /** Echo of watchdog timeout so the ground can show/keepalive correctly. */
  watchdogTimeoutMs: number;
  /** Base URL of the go2rtc video server, e.g. http://vehicle:1984 (or null in pure sim). */
  videoBaseUrl: string | null;
  /** Names of available camera streams for switching, e.g. ["test"] or ["rpicam","usb0"]. */
  cameras: string[];
}

/** Vehicle uplink signal, unified across LTE / WiFi for the OSD "link health". */
export interface LinkSignal {
  kind: 'lte' | 'wifi' | 'ethernet' | 'none';
  /** 0..100 quality, or null if unknown. */
  quality: number | null;
  /** Short OSD label, e.g. "LTE 72%" or "WiFi −58 dBm". */
  label: string;
}

export interface StatusMessage {
  type: 'status';
  /** Whether outputs are live. When disarmed, throttle-type channels stay safe. */
  armed: boolean;
  /** Whether the watchdog has tripped and failsafe values are being applied. */
  failsafeActive: boolean;
  /** Last channel values actually written by the output driver, in µs. */
  channels: number[];
  /** Age of the last received control frame, in ms. */
  lastFrameAgeMs: number;
  /** Sequence number of the last accepted control frame (for RTT/echo). */
  lastSeq: number;
  /** Client timestamp of the last accepted frame, echoed for RTT calc. */
  lastClientT: number;
  /** ESC calibration progress, if a calibration is running. */
  calibration?: CalibrationStatus;
  /** Vehicle uplink signal (LTE/WiFi), refreshed slowly on the vehicle. */
  link?: LinkSignal;
}

export interface CalibrationStatus {
  active: boolean;
  step: 'idle' | 'raise-max' | 'lower-min' | 'done';
  channel: number;
  /** Human-readable instruction for the current step. */
  message: string;
}

/**
 * ESC calibration control from the ground. Non-blocking on the vehicle: it drives
 * a small state machine that overrides the throttle channel with min/max while
 * the ESC learns its range. `start` requires the vehicle to be disarmed; the
 * vehicle blocks arming until calibration finishes or is cancelled.
 *   start → outputs MAX  (power the ESC, wait for tones)
 *   next  → outputs MIN  (wait for confirmation tones)
 *   next  → done         (idle, then back to normal)
 */
export interface CalibrationMessage {
  type: 'calib';
  action: 'start' | 'next' | 'cancel';
  channel?: number;
  minUs?: number;
  maxUs?: number;
}

/**
 * WebRTC signaling relayed over the existing WS link. Ground is the offerer; the
 * vehicle answers. Once the data channel opens, control frames travel over it
 * (SCTP/DTLS over UDP — unreliable+unordered, newest-wins), which is the low-
 * latency, NAT-friendly path for LTE. Status + signaling stay on the WS for now.
 */
export interface RtcSignalMessage {
  type: 'rtc';
  sub: 'offer' | 'answer' | 'ice' | 'bye';
  payload: unknown;
}

export const PROTOCOL_VERSION = 1;
