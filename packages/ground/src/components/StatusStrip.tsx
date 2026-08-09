import type { LinkState } from '../lib/transport';

export function ConnectionBar({
  url,
  setUrl,
  linkState,
  onConnect,
  onDisconnect,
}: {
  url: string;
  setUrl: (v: string) => void;
  linkState: LinkState;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = linkState === 'connected';
  return (
    <section className="panel">
      <span className="eyebrow">Vehicle link</span>
      <div className="conn">
        <span className={`dot ${connected ? 'on' : linkState === 'connecting' ? '' : 'bad'}`} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="Vehicle WebSocket address"
          placeholder="ws://vehicle-host:8080"
        />
        {connected || linkState === 'connecting' ? (
          <button className="btn" onClick={onDisconnect}>
            Disconnect
          </button>
        ) : (
          <button className="btn primary" onClick={onConnect}>
            Connect
          </button>
        )}
      </div>
    </section>
  );
}

export function StatusStrip({
  linkState,
  vehicleName,
  driver,
  armed,
  failsafe,
  latencyMs,
  gamepad,
  gamepadKind,
  telemetrySource,
}: {
  linkState: LinkState;
  vehicleName: string;
  driver: string;
  armed: boolean;
  failsafe: boolean;
  latencyMs: number | null;
  gamepad: string | null;
  gamepadKind: 'browser' | 'sdl';
  telemetrySource: 'sim' | 'real' | 'nodata' | null;
}) {
  const linkClass = linkState === 'connected' ? 'link' : 'warn';
  return (
    <section className="status-strip">
      <div className="stat">
        <div className="k">Link</div>
        <div className={`v ${linkClass}`}>{linkState}</div>
      </div>
      <div className="stat">
        <div className="k">State</div>
        <div className={`v ${failsafe ? 'bad' : armed ? 'good' : 'warn'}`}>
          {failsafe ? 'FAILSAFE' : armed ? 'armed' : 'disarmed'}
        </div>
      </div>
      <div className="stat">
        <div className="k">Round-trip</div>
        <div className="v">{latencyMs === null ? '—' : `${latencyMs} ms`}</div>
      </div>
      <div className="stat">
        <div className="k">Input</div>
        <div className={`v ${gamepad ? 'good' : ''}`}>
          {gamepad ? `gamepad · ${gamepadKind}` : 'kbd / touch'}
        </div>
      </div>
      <div className="stat">
        <div className="k">Vehicle</div>
        <div className="v">{vehicleName || '—'}</div>
      </div>
      <div className="stat">
        <div className="k">Driver</div>
        <div className="v">{driver || '—'}</div>
      </div>
      <div className="stat">
        <div className="k">Telemetry</div>
        <div className={`v ${telemetrySource === 'real' ? 'good' : telemetrySource === 'nodata' ? 'bad' : telemetrySource === 'sim' ? 'warn' : ''}`}>
          {telemetrySource === null ? '—' : telemetrySource === 'sim' ? 'SIM' : telemetrySource === 'nodata' ? 'NO DATA' : 'real'}
        </div>
      </div>
    </section>
  );
}
