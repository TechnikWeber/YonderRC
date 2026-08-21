/**
 * WiFi radio state, regulatory country, and the nmcli commands that build the
 * onboarding hotspot. Pure helpers only — the shelling out lives in RealSystem.
 *
 * Two things learned the hard way on a real Pi:
 *
 *  1. `nmcli device wifi hotspot` ALWAYS creates a secured AP. Its man page says
 *     it plainly: "password to use for the created hotspot. If not provided,
 *     nmcli will generate a password." So the documented *open* onboarding AP was
 *     never open — it had a random WPA key nobody could know, which makes the
 *     captive-portal story ("join it, the page opens, type nothing") impossible.
 *     We therefore build the connection profile explicitly.
 *
 *  2. Raspberry Pi OS keeps the WiFi radio rfkill-soft-blocked until a regulatory
 *     country is set, and NetworkManager then reports the device as simply
 *     "unavailable". The raw error ("Connection 'Hotspot' is not available on
 *     device wlan0 because device is not available") tells the operator nothing.
 */

export const HOTSPOT_CON_NAME = 'Hotspot';
/** Documented address of the setup page in AP mode (NM would default to 10.42.0.1). */
export const HOTSPOT_ADDRESS = '192.168.4.1';

export interface RfkillState {
  softBlocked: boolean;
  hardBlocked: boolean;
}

/**
 * Parse `rfkill list wifi`. Absent/unparseable output means "nothing blocked" —
 * a missing rfkill tool must not make the UI claim the radio is off.
 */
export function parseRfkill(out: string): RfkillState {
  const soft = /soft blocked:\s*yes/i.test(out ?? '');
  const hard = /hard blocked:\s*yes/i.test(out ?? '');
  return { softBlocked: soft, hardBlocked: hard };
}

/** Country from `iw reg get` ("country DE: DFS-ETSI"); '00' is the unset world domain. */
export function parseWifiCountry(out: string): string | null {
  const m = (out ?? '').match(/country\s+([A-Z]{2}|00)\s*:/);
  if (!m) return null;
  return m[1] === '00' ? null : m[1];
}

export function isCountryCode(cc: unknown): cc is string {
  return typeof cc === 'string' && /^[A-Za-z]{2}$/.test(cc);
}

/**
 * Timezones whose country isn't already obvious from the locale. Deliberately
 * short: this only provides a *suggestion* the operator can override, so a wrong
 * guess costs a dropdown change, not a broken radio.
 */
const TZ_COUNTRY: Record<string, string> = {
  'Europe/Berlin': 'DE',
  'Europe/Vienna': 'AT',
  'Europe/Zurich': 'CH',
  'Europe/Amsterdam': 'NL',
  'Europe/Brussels': 'BE',
  'Europe/Paris': 'FR',
  'Europe/Madrid': 'ES',
  'Europe/Rome': 'IT',
  'Europe/Lisbon': 'PT',
  'Europe/London': 'GB',
  'Europe/Dublin': 'IE',
  'Europe/Copenhagen': 'DK',
  'Europe/Oslo': 'NO',
  'Europe/Stockholm': 'SE',
  'Europe/Helsinki': 'FI',
  'Europe/Warsaw': 'PL',
  'Europe/Prague': 'CZ',
  'Europe/Budapest': 'HU',
  'Europe/Athens': 'GR',
  'America/New_York': 'US',
  'America/Chicago': 'US',
  'America/Denver': 'US',
  'America/Los_Angeles': 'US',
  'America/Toronto': 'CA',
  'Australia/Sydney': 'AU',
};

/**
 * Best guess for the regulatory country, so the operator doesn't have to know
 * what a "WiFi country" is. The locale wins (`de_DE.UTF-8` → DE) because it is
 * unambiguous; the timezone is the fallback.
 */
export function guessWifiCountry(opts: { locale?: string | null; timezone?: string | null }): string | null {
  const loc = (opts.locale ?? '').trim();
  const m = loc.match(/^[a-z]{2,3}[_-]([A-Z]{2})/);
  if (m) return m[1];
  const tz = (opts.timezone ?? '').trim();
  return TZ_COUNTRY[tz] ?? null;
}

/** LANG from /etc/default/locale — under systemd the service's own env has none. */
export function parseLocaleFile(out: string): string | null {
  const m = (out ?? '').match(/^\s*LANG=\"?([A-Za-z0-9_.@-]+)/m);
  return m ? m[1] : null;
}

export type WifiDeviceState = 'ready' | 'unavailable' | 'missing';

export interface WifiRadioStatus {
  /** 'ready' = usable, 'unavailable' = present but blocked/unconfigured, 'missing' = no such device. */
  device: WifiDeviceState;
  softBlocked: boolean;
  hardBlocked: boolean;
  /** Regulatory country in force, null when unset (world domain). */
  country: string | null;
  /** What we would set if asked to fix it, derived from locale/timezone. */
  suggestedCountry: string | null;
}

/** State of the WiFi interface from `nmcli -t -f DEVICE,TYPE,STATE device`. */
export function parseWifiDeviceState(out: string, iface = 'wlan0'): WifiDeviceState {
  for (const line of (out ?? '').split('\n')) {
    const [dev, , state] = line.split(':');
    if (dev?.trim() !== iface) continue;
    const s = (state ?? '').trim().toLowerCase();
    if (s === 'unavailable' || s === 'unmanaged') return 'unavailable';
    return 'ready';
  }
  return 'missing';
}

/** True when the radio can actually carry an AP right now. */
export function radioIsUsable(r: WifiRadioStatus): boolean {
  return r.device === 'ready' && !r.softBlocked && !r.hardBlocked;
}

export interface HotspotProfile {
  ssid: string;
  /** null/'' = a genuinely OPEN network (no security settings on the profile). */
  password: string | null;
}

/**
 * The nmcli invocations that (re)create and start the onboarding hotspot, in
 * order. Built explicitly rather than via `nmcli device wifi hotspot`, which
 * cannot produce an open network (see the file header) and picks its own IP.
 *
 * Each entry is an argv array — no shell, so an SSID or password containing
 * spaces, quotes or semicolons is just text.
 */
export function hotspotCommands(cfg: HotspotProfile, iface = 'wlan0'): { args: string[]; optional: boolean }[] {
  const ssid = (cfg.ssid || 'YonderRC-setup').trim() || 'YonderRC-setup';
  const secured = !!cfg.password && cfg.password.length >= 8;
  const cmds: { args: string[]; optional: boolean }[] = [
    // A stale profile from an earlier run would keep its old SSID/security.
    { args: ['connection', 'delete', HOTSPOT_CON_NAME], optional: true },
    {
      args: [
        'connection', 'add',
        'type', 'wifi',
        'ifname', iface,
        'con-name', HOTSPOT_CON_NAME,
        'autoconnect', 'no',
        'ssid', ssid,
        '802-11-wireless.mode', 'ap',
        '802-11-wireless.band', 'bg',
        'ipv4.method', 'shared',
        'ipv4.addresses', `${HOTSPOT_ADDRESS}/24`,
      ],
      optional: false,
    },
  ];
  if (secured) {
    cmds.push({
      args: [
        'connection', 'modify', HOTSPOT_CON_NAME,
        'wifi-sec.key-mgmt', 'wpa-psk',
        'wifi-sec.psk', cfg.password as string,
        'wifi-sec.proto', 'rsn',
        'wifi-sec.pairwise', 'ccmp',
        'wifi-sec.group', 'ccmp',
      ],
      optional: false,
    });
  }
  cmds.push({ args: ['connection', 'up', HOTSPOT_CON_NAME], optional: false });
  return cmds;
}

/** Read back the key of an existing Hotspot profile (nmcli -s -g …). */
export function hotspotPskArgs(): string[] {
  return ['-s', '-g', '802-11-wireless-security.psk', 'connection', 'show', HOTSPOT_CON_NAME];
}

/** `raspi-config nonint do_wifi_country DE` — the country is validated first. */
export function wifiCountryArgs(cc: string): string[] {
  return ['nonint', 'do_wifi_country', cc.toUpperCase()];
}

/** NetworkManager's dnsmasq drop-in directory, read for *shared* connections only. */
export const CAPTIVE_CONF_PATH = '/etc/NetworkManager/dnsmasq-shared.d/yonderrc-captive.conf';

/** Resolve every name to the vehicle — this is what makes a phone show the portal. */
export function captivePortalConf(address = HOTSPOT_ADDRESS): string {
  return `address=/#/${address}\n`;
}

/**
 * Hijack DNS only when the vehicle has no uplink of its own.
 *
 * With an uplink the hotspot shares real internet (Ethernet on the bench, LTE in the
 * field), and pointing every name at the Pi would break the internet for everyone
 * connected — while the portal it triggers is pointless, because those clients are
 * online. Without an uplink it is the whole trick that opens the page unprompted.
 */
export function shouldHijackDns(hasUplink: boolean): boolean {
  return !hasUplink;
}

export interface WifiFailure {
  cause: string;
  fix: string;
  /** True when the setup UI itself can repair this (radio blocked / no country). */
  fixableHere: boolean;
}

/**
 * Turn an nmcli failure into something an operator can act on, using what we know
 * about the radio. "device is not available" is nmcli's way of saying "rfkill has
 * it blocked because you never set a WiFi country" — a sentence nobody guesses.
 */
export function explainWifiFailure(out: string, radio?: WifiRadioStatus | null): WifiFailure {
  const log = out ?? '';

  if (radio?.hardBlocked) {
    return {
      cause: 'the WiFi radio is switched off by a hardware switch',
      fix: 'Some boards/cases have a physical WiFi switch or a firmware setting — enable it, then try again.',
      fixableHere: false,
    };
  }
  if (radio && radio.device === 'missing') {
    return {
      cause: 'this Pi has no WiFi interface (wlan0 does not exist)',
      fix: 'A Pi without WiFi (or with the interface disabled in config.txt) cannot serve a hotspot. Reach the vehicle over Ethernet or LTE.',
      fixableHere: false,
    };
  }
  if (radio && (radio.softBlocked || radio.device === 'unavailable')) {
    return {
      cause: radio.country
        ? 'the WiFi radio is blocked (rfkill), so NetworkManager reports the device as unavailable'
        : 'Raspberry Pi OS keeps the WiFi radio blocked until a WiFi country is set — NetworkManager then reports the device as unavailable',
      fix: radio.country
        ? 'Press “Enable WiFi radio” below — it unblocks the radio and retries.'
        : `Press “Enable WiFi radio” below${radio.suggestedCountry ? ` (it will set the country to ${radio.suggestedCountry}, change it if that's wrong)` : ' and pick your country'} — that is exactly what the radio is waiting for.`,
      fixableHere: true,
    };
  }

  if (/not available on device|device is not available|device is strictly unmanaged/i.test(log)) {
    return {
      cause: 'NetworkManager says the WiFi device is not available',
      fix: 'Usually a blocked radio or a missing WiFi country — press “Enable WiFi radio” below. If it persists: `sudo systemctl restart NetworkManager`.',
      fixableHere: true,
    };
  }
  if (/No Wi-?Fi device found|no wireless device/i.test(log)) {
    return {
      cause: 'NetworkManager found no WiFi device at all',
      fix: 'Check that wlan0 exists (`nmcli device status`) and is not disabled in `/boot/firmware/config.txt`.',
      fixableHere: false,
    };
  }
  if (/Secrets were required|no secrets provided|802-1x|invalid password|key-mgmt/i.test(log)) {
    return {
      cause: 'the password was rejected',
      fix: 'A WPA2 key needs at least 8 characters. Leave the field empty for an open hotspot.',
      fixableHere: false,
    };
  }
  if (/Timeout|timed out/i.test(log)) {
    return {
      cause: 'NetworkManager did not finish in time',
      fix: 'Try again; if it keeps timing out, restart NetworkManager (`sudo systemctl restart NetworkManager`).',
      fixableHere: false,
    };
  }
  if (/AP mode is not supported|not supported by the device|mode ap/i.test(log)) {
    return {
      cause: 'this WiFi adapter cannot run in access-point mode',
      fix: 'The Pi\'s built-in adapter can; some USB sticks cannot. Use the built-in wlan0.',
      fixableHere: false,
    };
  }

  return {
    cause: 'NetworkManager refused to start the hotspot',
    fix: 'The message below is nmcli\'s own; “Enable WiFi radio” fixes the common case (blocked radio / no WiFi country).',
    fixableHere: true,
  };
}
