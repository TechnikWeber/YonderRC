/**
 * Making the video fill the screen — including on a phone, where the Fullscreen
 * API cannot do it.
 *
 * iPhone Safari has no `Element.requestFullscreen` at all (iPadOS 13+ does), which
 * is why the fullscreen button did nothing there: the old code called
 * `requestFullscreen?.()` and the optional call simply evaluated to undefined. The
 * one fullscreen iOS does offer, `video.webkitEnterFullscreen()`, hands the stream
 * to Apple's native player and drops every overlay we draw — so it would take the
 * OSD with it, and the OSD is the point.
 *
 * So the mode is CSS-driven (a fixed, viewport-sized stage) and behaves the same
 * everywhere. The real Fullscreen API is used ON TOP of that wherever it exists,
 * to also hide the browser's own chrome. On iPhone only the CSS applies, which
 * leaves Safari's slim URL bar — the picture still fills the rest.
 */

/** True when the real Fullscreen API can be used on elements (not iPhone Safari). */
export function supportsRealFullscreen(doc: Document = document): boolean {
  return typeof doc.documentElement.requestFullscreen === 'function' && doc.fullscreenEnabled !== false;
}

/**
 * Ask for real fullscreen if the browser has it. Failure is not an error: the CSS
 * mode is already doing the work, this only removes the browser chrome as well.
 */
export async function enterRealFullscreen(el: HTMLElement | null): Promise<void> {
  if (!el || !supportsRealFullscreen()) return;
  try {
    await el.requestFullscreen();
  } catch {
    /* refused (no user activation, or a permissions policy) — CSS mode stands */
  }
}

export async function exitRealFullscreen(): Promise<void> {
  if (!document.fullscreenElement) return;
  try {
    await document.exitFullscreen();
  } catch {
    /* ignore */
  }
}
