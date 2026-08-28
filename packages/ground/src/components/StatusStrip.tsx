import type { LinkState } from '../lib/transport';

export function ConnectionBar({
  url,
  setUrl,
  secret,
  setSecret,
  setupUrl,
  linkState,
  onConnect,
  onDisconnect,
}: {
  url: string;
  setUrl: (v: string) => void;
  secret: string;
  setSecret: (v: string) => void;
  setupUrl: string | null;
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
        <input
          className="secret"
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label="API secret (optional)"
          placeholder="secret (optional)"
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
        {setupUrl && (
          <a
            className="btn"
            href={setupUrl}
            target="_blank"
            rel="noreferrer"
            title="Open the vehicle's setup page (same host as the control link)"
          >
            Setup ↗
          </a>
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
  linkGaps,
  gamepad,
  gamepadKind,
  telemetrySource,
  sessionSeconds,
  sessionMah,
}: {
  linkState: LinkState;
  vehicleName: string;
  driver: string;
  armed: boolean;
  failsafe: boolean;
  latencyMs: number | null;
  linkGaps: { text: string; level: 'none' | 'ok' | 'near' | 'bad' } | null;
  gamepad: string | null;
  gamepadKind: 'browser' | 'sdl';
  telemetrySource: 'sim' | 'real' | 'nodata' | null;
  sessionSeconds: number | null;
  sessionMah: number | null;
}) {
  const linkClass = linkState === 'connected' ? 'link' : 'warn';
  const mmss = sessionSeconds === null ? null : `${Math.floor(sessionSeconds / 60)}:${String(sessionSeconds % 60).padStart(2, '0')}`;
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
        {/* "Session", not "Flight" — the same strip serves cars and boats. */}
        <div className="k">Session</div>
        <div className={`v ${mmss ? 'good' : ''}`}>{mmss ?? '—'}{sessionMah != null ? ` · ${sessionMah} mAh` : ''}</div>
      </div>
      <div className="stat">
        <div className="k">Round-trip</div>
        <div className="v">{latencyMs === null ? '—' : `${latencyMs} ms`}</div>
      </div>
      {/* A watchdog trip lasts one tick: the bars snap to failsafe and back before it
          can be read, and the 2 Hz blackbox misses it. This is the only place the
          episode leaves a mark — plus the worst frame age, which says how much margin
          is left on a link that has not failed yet. */}
      <div className="stat">
        <div className="k">Link gaps</div>
        <div
          className={`v ${linkGaps?.level === 'bad' ? 'bad' : linkGaps?.level === 'near' ? 'warn' : linkGaps?.level === 'ok' ? 'good' : ''}`}
          title="Failsafe episodes since this connection began, and the longest the vehicle ever waited for a control frame. The vehicle drops to failsafe once that wait passes its watchdog timeout."
        >
          {linkGaps?.text ?? '—'}
        </div>
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
