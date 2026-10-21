import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import { applyTheme, cachedTheme } from './lib/theme';
import { migratePadLayout } from './lib/padLayout';

// Before the first render: the vehicle's answer arrives with the control link, which
// is seconds away at best, and a page that starts dark and turns light is worse than
// one that simply remembers.
applyTheme(document, cachedTheme(localStorage));

// Before anything loads a model: since v1.71 the desktop app numbers controller
// buttons like the browser, and what it stored is renumbered once.
try {
  migratePadLayout(localStorage, !!window.yonder?.isElectron && !!window.yonder.sdlActive);
} catch {
  /* no storage — nothing stored to renumber */
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
