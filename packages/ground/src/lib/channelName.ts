/**
 * How a channel is named on screen: `CH03` — and, where the vehicle reports its wiring
 * (v1.71), what that channel is on the hardware: `CH03 · out 2` on a PCA9685 board,
 * whose outputs count from 0 where the app counts from 1; `CH03 · GPIO 27`;
 * `CH03 · SBUS 3`. A channel the driver has no output for says so.
 */
export function channelName(ch: number, outputs?: readonly string[]): string {
  const name = `CH${String(ch + 1).padStart(2, '0')}`;
  if (!outputs) return name;
  const out = outputs[ch];
  return out ? `${name} · ${out}` : `${name} · not wired`;
}
