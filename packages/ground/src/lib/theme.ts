import type { UiTheme } from '@yonderrc/protocol';

/**
 * Which palette the app paints in. There are two, and the VEHICLE owns the choice —
 * it arrives over the control link (`theme` message) and is edited in the vehicle's
 * own setup page, not here. The ground app has no switch of its own on purpose: the
 * setup page and the control app are one product, and a per-device toggle is how the
 * two ends end up disagreeing with nobody able to say which is right.
 *
 * The last answer is remembered per browser so a cold start does not flash dark on
 * its way to light — a cache, never the authority.
 */
export const THEME_KEY = 'yonderrc.theme.v1';
export const DEFAULT_THEME: UiTheme = 'dark';

export function isTheme(v: unknown): v is UiTheme {
  return v === 'dark' || v === 'light';
}

/** What to paint before the vehicle has said anything. */
export function cachedTheme(storage: Pick<Storage, 'getItem'>): UiTheme {
  try {
    const v = storage.getItem(THEME_KEY);
    return isTheme(v) ? v : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

/**
 * Paint it. `data-theme` on the root element is what styles.css keys off; the
 * theme-color meta drives the browser chrome on a phone, which is otherwise left
 * showing the dark bar above a light page.
 */
export function applyTheme(doc: Document, theme: UiTheme): void {
  doc.documentElement.dataset.theme = theme;
  const meta = doc.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', theme === 'light' ? '#eef2f6' : '#0b0f14');
}

export function rememberTheme(storage: Pick<Storage, 'setItem'>, theme: UiTheme): void {
  try {
    storage.setItem(THEME_KEY, theme);
  } catch {
    /* private mode / storage disabled — the vehicle re-sends it on every connect */
  }
}
