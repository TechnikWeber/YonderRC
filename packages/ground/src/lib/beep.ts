/**
 * A short alert beep via Web Audio — no asset files needed. The AudioContext is
 * created lazily on first use (by then the operator has interacted with the page,
 * so autoplay policies are satisfied) and reused.
 */
let ctx: AudioContext | null = null;

export function beep(freq = 880, ms = 200, gain = 0.14): void {
  try {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    ctx = ctx ?? new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = 'square';
    osc.frequency.value = freq;
    g.gain.value = gain;
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + ms / 1000);
  } catch {
    /* audio unavailable — ignore */
  }
}
