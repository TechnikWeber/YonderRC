/**
 * How a channel is named on screen: `CH03` — and, where the vehicle reports its wiring
 * (v1.71), what that channel is on the hardware: `CH03 · PCA 2` on a PCA9685 board,
 * whose outputs count from 0 where the app counts from 1; `CH03 · GPIO 27`;
 * `CH03 · SBUS 3`. A channel the driver has no output for says so.
 *
 * The app keeps counting from 1 (the RC convention: transmitters, SBUS, ArduPilot). A
 * tester wiring a PCA9685 asked for channels from 0 to match the board; the answer
 * (v1.73) is to name the board's own pin next to every channel instead, so neither
 * world has to translate.
 */
export function channelName(ch: number, outputs?: readonly string[]): string {
  const name = `CH${String(ch + 1).padStart(2, '0')}`;
  if (!outputs) return name;
  const out = outputLabel(outputs[ch]);
  return out ? `${name} · ${out}` : `${name} · not wired`;
}

/**
 * One reported output, as shown. Vehicles before v1.73 report a PCA9685 pin as
 * `out 2`; it is the same pin, so it reads the same as from a current vehicle.
 */
export function outputLabel(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const old = /^out (\d+)$/.exec(raw);
  return old ? `PCA ${old[1]}` : raw;
}
