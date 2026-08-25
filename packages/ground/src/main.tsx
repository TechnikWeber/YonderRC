import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import './styles.css';
import { applyTheme, cachedTheme } from './lib/theme';

// Before the first render: the vehicle's answer arrives with the control link, which
// is seconds away at best, and a page that starts dark and turns light is worse than
// one that simply remembers.
applyTheme(document, cachedTheme(localStorage));

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
);
