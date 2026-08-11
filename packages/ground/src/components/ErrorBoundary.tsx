import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches render/runtime errors anywhere below it so a single component fault
 * can't white-screen the whole ground station mid-flight. Shows a minimal
 * recovery panel with a reload button instead. The control link and video run in
 * their own effects, but a hard crash here still means the operator should reload.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface it for anyone tailing the console; no telemetry is sent anywhere.
    console.error('[yonderrc] UI crash:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash">
          <div className="crash-card">
            <h1>Ground station hit an error</h1>
            <p>The interface stopped unexpectedly. Your vehicle keeps its own failsafe — if a link was live it will hold or go to failsafe until you reconnect.</p>
            <pre>{this.state.error.message}</pre>
            <button className="btn" onClick={() => window.location.reload()}>Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
