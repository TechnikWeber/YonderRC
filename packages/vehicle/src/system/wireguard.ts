/**
 * WireGuard, set up either way.
 *
 * The original path was "upload the `.conf` your server exported", which is perfect
 * when there is a file — a FritzBox hands you one. It is useless when there is not:
 * a peer someone set up for you by hand, a provider that shows the values on a web
 * page, a key you generated on the Pi itself. Then you have seven pieces of
 * information and nowhere to type them, and the answer used to be "make a file".
 *
 * So the same connection can now be described two ways, and both end up as one
 * thing: the `.conf` text. That stays the single source of truth — `wg-quick` reads
 * a file either way, and keeping a second parallel representation in the config
 * would be a drift bug waiting for the day the two disagree. The form is rebuilt by
 * parsing the stored conf, which has the pleasant side effect that a file you
 * uploaded can afterwards be edited field by field.
 *
 * Everything here is pure and unit-tested. The two secrets — the private key and the
 * preshared key — never come back out of the box: see redactWireguardFields, and
 * note that the status endpoints are readable by anyone on the LAN or the hotspot.
 */

/** The values a WireGuard peer is described by, as strings straight from a form. */
export interface WireguardFields {
  /** [Interface] PrivateKey — this box's own secret. */
  privateKey: string;
  /** [Interface] Address — this box's address inside the tunnel, e.g. 10.0.0.2/32. */
  address: string;
  /** [Interface] DNS — optional. */
  dns: string;
  /** [Interface] ListenPort — optional; empty means an ephemeral port. */
  listenPort: string;
  /** [Peer] PublicKey — the server's public key. Not a secret. */
  peerPublicKey: string;
  /** [Peer] PresharedKey — optional extra symmetric secret. */
  presharedKey: string;
  /** [Peer] Endpoint — host:port of the server. */
  endpoint: string;
  /** [Peer] AllowedIPs — what goes through the tunnel. */
  allowedIps: string;
  /** [Peer] PersistentKeepalive — seconds. */
  persistentKeepalive: string;
}

/**
 * Sensible where there is a sensible default, empty where a wrong guess would be
 * worse than a blank. Keepalive is 25 rather than off on purpose: this box lives
 * behind carrier NAT, and without it the tunnel works until the first idle minute
 * and then quietly stops carrying anything inbound.
 */
export const WIREGUARD_DEFAULTS: WireguardFields = {
  privateKey: '',
  address: '',
  dns: '',
  listenPort: '',
  peerPublicKey: '',
  presharedKey: '',
  endpoint: '',
  allowedIps: '0.0.0.0/0, ::/0',
  persistentKeepalive: '25',
};

/** A WireGuard key is 32 bytes of base64: 43 characters and a '='. */
export function isWireguardKey(v: string): boolean {
  return /^[A-Za-z0-9+/]{43}=$/.test(v.trim());
}

/** host:port, where host is a name, an IPv4 address, or [IPv6]. */
export function isEndpoint(v: string): boolean {
  const m = /^(\[[0-9a-fA-F:]+\]|[A-Za-z0-9._-]+):(\d{1,5})$/.exec(v.trim());
  if (!m) return false;
  const port = Number(m[2]);
  return port >= 1 && port <= 65535;
}

/**
 * Addresses may be written without a prefix — people type "10.0.0.2" because that is
 * what their server told them. A single host is what they mean, so say so explicitly
 * rather than letting wg-quick guess.
 */
export function normaliseCidrList(v: string): string {
  return v
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => (p.includes('/') ? p : p.includes(':') ? `${p}/128` : `${p}/32`))
    .join(', ');
}

function looksLikeCidrList(v: string): boolean {
  const parts = v.split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return false;
  return parts.every((p) => /^[0-9a-fA-F.:]+\/\d{1,3}$/.test(p));
}

/**
 * What is wrong with these values, in words that say what to do about it — this is a
 * page someone is reading on a phone, possibly standing next to the box.
 * Returns null when they are usable.
 */
export function validateWireguardFields(f: WireguardFields, opts: { keyStored?: boolean } = {}): string | null {
  if (!f.privateKey.trim() && !opts.keyStored) {
    return 'The private key is missing. It is this box\'s own key — generate one on the Pi with `wg genkey`, keep it here, and give your server the matching `wg pubkey`.';
  }
  if (f.privateKey.trim() && !isWireguardKey(f.privateKey)) {
    return 'That private key is not a WireGuard key: they are 44 characters of base64 ending in "=". `wg genkey` produces one.';
  }
  if (!isWireguardKey(f.peerPublicKey)) {
    return 'The server\'s public key is missing or malformed — 44 characters of base64 ending in "=", copied from the peer you are connecting to.';
  }
  if (f.presharedKey.trim() && !isWireguardKey(f.presharedKey)) {
    return 'The preshared key is not a WireGuard key. Leave it empty unless your server uses one; `wg genpsk` produces one.';
  }
  if (!isEndpoint(f.endpoint)) {
    return 'The endpoint must be host:port — for example vpn.example.org:51820. That is where this box dials out to.';
  }
  const address = normaliseCidrList(f.address);
  if (!looksLikeCidrList(address)) {
    return 'The address is this box\'s own address inside the tunnel, as given to you by the server — for example 10.0.0.2/32.';
  }
  const allowed = normaliseCidrList(f.allowedIps);
  if (!looksLikeCidrList(allowed)) {
    return 'AllowedIPs decides what goes through the tunnel. 0.0.0.0/0, ::/0 sends everything; a single subnet sends only that.';
  }
  if (f.listenPort.trim() && !/^\d{1,5}$/.test(f.listenPort.trim())) {
    return 'The listen port is a number, or empty to let WireGuard pick one (which is what a box behind CGNAT wants).';
  }
  if (f.persistentKeepalive.trim() && !/^\d{1,5}$/.test(f.persistentKeepalive.trim())) {
    return 'Keepalive is a number of seconds. 25 is the usual value behind NAT; 0 turns it off.';
  }
  return null;
}

/** The `.conf` these values describe. */
export function buildWireguardConf(f: WireguardFields): string {
  const lines: string[] = ['[Interface]', `PrivateKey = ${f.privateKey.trim()}`, `Address = ${normaliseCidrList(f.address)}`];
  if (f.dns.trim()) lines.push(`DNS = ${f.dns.trim()}`);
  if (f.listenPort.trim()) lines.push(`ListenPort = ${f.listenPort.trim()}`);
  lines.push('', '[Peer]', `PublicKey = ${f.peerPublicKey.trim()}`);
  if (f.presharedKey.trim()) lines.push(`PresharedKey = ${f.presharedKey.trim()}`);
  lines.push(`AllowedIPs = ${normaliseCidrList(f.allowedIps)}`, `Endpoint = ${f.endpoint.trim()}`);
  if (f.persistentKeepalive.trim()) lines.push(`PersistentKeepalive = ${f.persistentKeepalive.trim()}`);
  return lines.join('\n') + '\n';
}

/**
 * Read a conf back into the form. Lenient on purpose: this also has to cope with a
 * file some other tool wrote, where the spacing, the case and the order are whatever
 * that tool felt like. Values are split on the *first* `=` only — base64 keys end in
 * one, and splitting on all of them silently truncates every key in the file.
 */
export function parseWireguardConf(conf: string): WireguardFields {
  const out: WireguardFields = { ...WIREGUARD_DEFAULTS, allowedIps: '', persistentKeepalive: '' };
  let section = '';
  for (const raw of conf.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const head = /^\[(\w+)\]$/.exec(line);
    if (head) {
      section = head[1].toLowerCase();
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    const value = line.slice(eq + 1).trim();
    if (section === 'interface') {
      if (key === 'privatekey') out.privateKey = value;
      else if (key === 'address') out.address = value;
      else if (key === 'dns') out.dns = value;
      else if (key === 'listenport') out.listenPort = value;
    } else if (section === 'peer') {
      // Only the first peer: this box is a client of one server, and a conf with
      // several would lose the rest on the next save — better to leave such a file
      // as a file, which the upload path still allows.
      if (key === 'publickey' && !out.peerPublicKey) out.peerPublicKey = value;
      else if (key === 'presharedkey' && !out.presharedKey) out.presharedKey = value;
      else if (key === 'endpoint' && !out.endpoint) out.endpoint = value;
      else if (key === 'allowedips' && !out.allowedIps) out.allowedIps = value;
      else if (key === 'persistentkeepalive' && !out.persistentKeepalive) out.persistentKeepalive = value;
    }
  }
  return out;
}

/** More than one [Peer]: a conf the form cannot represent without losing something. */
export function hasMultiplePeers(conf: string): boolean {
  return (conf.match(/^\s*\[Peer\]/gim) ?? []).length > 1;
}

/** Every directive the form can hold. Anything else in a file would be lost. */
const KNOWN_KEYS = new Set([
  'privatekey', 'address', 'dns', 'listenport',
  'publickey', 'presharedkey', 'endpoint', 'allowedips', 'persistentkeepalive',
]);

/**
 * Directives in a stored conf that the form does not represent — MTU, Table, PostUp
 * and friends. Rebuilding the file from the form would silently drop them, so the
 * page says so instead of finding out later that the tunnel comes up differently.
 */
export function unsupportedWireguardKeys(conf: string): string[] {
  const found: string[] = [];
  for (const raw of conf.split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line || /^\[\w+\]$/.test(line)) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    if (!KNOWN_KEYS.has(key.toLowerCase()) && !found.includes(key)) found.push(key);
  }
  return found;
}

export interface PublicWireguardFields extends Omit<WireguardFields, 'privateKey' | 'presharedKey'> {
  hasPrivateKey: boolean;
  hasPresharedKey: boolean;
}

/**
 * What the form may be filled from. The two secrets stay in the box: `/api/remote`
 * is readable without the API secret so the page always loads, which means anyone on
 * the open onboarding hotspot could otherwise read the key that lets them onto the
 * VPN. The form shows them as stored and leaves the boxes blank.
 */
export function redactWireguardFields(f: WireguardFields): PublicWireguardFields {
  const { privateKey, presharedKey, ...rest } = f;
  return { ...rest, hasPrivateKey: !!privateKey.trim(), hasPresharedKey: !!presharedKey.trim() };
}

/** Normalise an uploaded WireGuard conf: LF line endings, single trailing newline. */
export function normaliseWireguardConf(conf: string): string {
  return conf.replace(/\r\n?/g, '\n').trim() + '\n';
}

/** A plausible WireGuard conf has an [Interface] section with a PrivateKey. */
export function looksLikeWireguardConf(conf: string): boolean {
  return /\[Interface\]/i.test(conf) && /PrivateKey\s*=/.test(conf) && /\[Peer\]/i.test(conf);
}
