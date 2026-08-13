import type { LteConfig } from './SystemManager.js';

/**
 * Pure parsing of `mmcli -m <n>` output — no I/O, so it's unit-tested against a
 * captured sample. Real modems vary a little in wording; we match the common
 * ModemManager fields (state, operator, signal, model, SIM lock).
 */
export interface ModemInfo {
  state: string; // e.g. connected / registered / searching / enabled / locked / disabled
  operator: string | null;
  signal: number | null; // 0..100
  model: string | null;
  pinRequired: boolean;
}

/** Find the first modem index from `mmcli -L` output, or null. */
export function parseModemId(listOut: string): string | null {
  return listOut.match(/Modem\/(\d+)/)?.[1] ?? null;
}

/** Find the primary SIM index from `mmcli -m <n>` output, or null. */
export function parseSimId(modemOut: string): string | null {
  return modemOut.match(/(?:primary sim path|sim):[^\n]*\/SIM\/(\d+)/i)?.[1] ?? null;
}

/** A SIM PIN is 4–8 digits. */
export function isValidPin(pin: string): boolean {
  return /^\d{4,8}$/.test(pin);
}

export function parseModemInfo(text: string): ModemInfo {
  // The modem "state:" field, excluding "power state:" via a negative lookbehind.
  const state = text.match(/(?<!power )state:\s*'?([\w-]+)/i)?.[1]?.toLowerCase() ?? 'unknown';
  const operator = text.match(/operator name:\s*'?([^'\n]+?)'?\s*$/im)?.[1]?.trim() || null;
  const signalStr = text.match(/signal quality:\s*'?(\d+)/i)?.[1];
  const model = text.match(/\bmodel:\s*'?([^'\n]+?)'?\s*$/im)?.[1]?.trim() || null;
  const pinRequired = /unlock required:\s*'?sim-pin/i.test(text) || state === 'locked';
  return {
    state,
    operator,
    signal: signalStr ? Number(signalStr) : null,
    model,
    pinRequired,
  };
}

/** Map a raw modem/registration state to a short human label for the UI. */
export function lteStateLabel(info: ModemInfo, hasSim: boolean): string {
  if (!hasSim) return 'sim-missing';
  if (info.pinRequired) return 'sim-pin-required';
  return info.state;
}

/** Strip secrets (PIN, password) from an LTE config for safe display/return. */
export function redactLteConfig(cfg: LteConfig): Record<string, unknown> {
  return {
    apn: cfg.apn ?? null,
    username: cfg.username ?? null,
    hasPin: !!cfg.pin,
    hasPassword: !!cfg.password,
    networkMode: cfg.networkMode ?? 'auto',
    allowRoaming: cfg.allowRoaming !== false,
  };
}
