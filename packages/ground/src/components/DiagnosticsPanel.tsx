import { useState } from 'react';
import type { DiagnosticFinding } from '@yonderrc/protocol';
import { Hint } from './Hint';

export interface DiagnosticsExport {
  fileName: string;
  findings: DiagnosticFinding[];
  /** Why the vehicle's half is missing, when it is. */
  vehicleError: string | null;
}

/**
 * Setup › Diagnostics: one button that writes a file with both halves — this app and
 * the vehicle — and shows right away what the report noticed, because the finding is
 * often the answer and nobody has to send anything anywhere.
 */
export function DiagnosticsPanel({ onExport }: { onExport: () => Promise<DiagnosticsExport> }) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<DiagnosticsExport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      setResult(await onExport());
    } catch (e) {
      setError((e as Error).message || 'Export failed.');
    } finally {
      setBusy(false);
    }
  };

  const icon = { bad: '✗', warn: '⚠', info: 'ℹ' } as const;
  return (
    <section className="panel">
      <span className="eyebrow">Diagnostics</span>
      <p className="note">
        Something not working — the vehicle flickering into failsafe, a controller that does nothing? This
        writes <b>one file</b> with everything needed to find the cause, from this app and from the vehicle.
        Make it <b>right after</b> the problem happened.
      </p>
      <div className="log-row">
        <button className="btn primary" onClick={() => void run()} disabled={busy}>
          {busy ? 'Collecting… (a few seconds)' : 'Download diagnostics'}
        </button>
      </div>
      {error && <p className="finding bad">✗ {error}</p>}
      {result && (
        <>
          <p className="note">
            Saved <span className="mono">{result.fileName}</span>.
            {result.vehicleError ? <> The vehicle's half is missing: {result.vehicleError}</> : null}
          </p>
          {result.findings.length === 0 ? (
            <p className="finding">Nothing stood out — the numbers in the file may still show it.</p>
          ) : (
            result.findings.map((f, i) => (
              <p key={i} className={`finding ${f.level}`}>
                {icon[f.level]} {f.text}
                {f.fix && <span className="fix">→ {f.fix}</span>}
              </p>
            ))
          )}
        </>
      )}
      <Hint summary="What is in the file, and where to send it">
        This app: browser and device, the controllers it sees, the active model, how regularly the 50 Hz
        control loop really ran (and whether the page was hidden), round-trip times and a timeline of the
        link. The vehicle: its version and settings, its log, the gaps between the control frames it
        received, every failsafe episode, WiFi and power state, load and temperature. <b>Passwords, PINs,
        VPN keys, the API secret and GPS positions are removed</b>; network names and local IP addresses
        stay, they are what a network problem is found with. Attach the file to a new issue on GitHub
        (TechnikWeber/YonderRC → Issues → New issue) and describe what you saw. Rather not post it
        publicly? Open the issue without it and ask for a private way. Details:
        docs/TROUBLESHOOTING.md.
      </Hint>
    </section>
  );
}
