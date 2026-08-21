/**
 * Native driver modules (i2c-bus / pigpio / serialport).
 *
 * They are `optionalDependencies` of @yonderrc/vehicle and stay out of the base
 * install on purpose: they compile on the Pi, need extra apt packages, and most
 * vehicles use exactly one of them — a failing build must not take the whole
 * provisioning down (`install.sh` runs `npm install --omit=optional`).
 *
 * That used to mean "open a terminal", which is exactly wrong for a vehicle you
 * reach over its own hotspot with nothing but a phone. So the setup UI installs
 * them, and everything here is pure so the allowlist and — more importantly —
 * the failure diagnosis are unit-tested rather than discovered in the field.
 */

export type HwDepName = 'i2c-bus' | 'pigpio' | 'serialport';

export interface HwDepInfo {
  name: HwDepName;
  /** What stops working without it (shown in the setup UI). */
  needFor: string;
  /** apt packages this module needs BEFORE npm can build it. */
  apt: string[];
}

/**
 * The allowlist. It is the only thing that ever reaches `npm install`, so an
 * operator (or anyone who reaches the API) can't turn the endpoint into
 * "install arbitrary package on my vehicle".
 */
export const HW_DEPS: readonly HwDepInfo[] = [
  {
    name: 'i2c-bus',
    needFor: 'PCA9685 servo/ESC driver · INA2xx current sensors · ADS1115 ADC',
    apt: [],
  },
  {
    name: 'pigpio',
    // The npm package builds against the pigpio C library, which is a separate
    // apt package — without it the build fails on a missing pigpio.h.
    needFor: 'GPIO-PWM output (only if you drive servos straight from the Pi)',
    apt: ['pigpio'],
  },
  {
    name: 'serialport',
    needFor: 'SBUS output (flight controller) · serial GPS receivers',
    apt: [],
  },
];

export function isHwDep(name: unknown): name is HwDepName {
  return typeof name === 'string' && HW_DEPS.some((d) => d.name === name);
}

export function hwDepInfo(name: HwDepName): HwDepInfo {
  return HW_DEPS.find((d) => d.name === name)!;
}

/**
 * Arguments for `npm install`. Passed to execFile as an array (no shell), and the
 * name is allowlisted by `isHwDep` before it ever gets here — two independent
 * reasons why an injected value can't become a command.
 */
export function npmInstallArgs(name: HwDepName, workspace = '@yonderrc/vehicle'): string[] {
  // --foreground-scripts is not cosmetic: these modules are optionalDependencies of
  // the vehicle package, so npm hides node-gyp's output, drops the module when the
  // build fails and still exits 0 with "up to date". Without this flag the operator
  // gets a success message and no driver. (The caller checks resolution too.)
  return ['install', name, '-w', workspace, '--no-audit', '--no-fund', '--foreground-scripts'];
}

/** Keep the tail of a long npm/node-gyp log — the end is where the cause is. */
export function lastLines(out: string, n = 14): string {
  const lines = out.split('\n').filter((l) => l.trim() !== '');
  return lines.slice(-n).join('\n');
}

/**
 * The interesting part of a build log. node-gyp prints the real cause FIRST (a
 * compiler message or a Python traceback) and then pages of boilerplate, so a
 * plain tail usually shows everything except the reason — this starts at the
 * first error-looking line instead.
 */
export function errorExcerpt(out: string, max = 24): string {
  const lines = (out ?? '').split('\n').filter((l) => l.trim() !== '');
  if (!lines.length) return '';
  const first = lines.findIndex((l) => /error|ERR!|fatal|Traceback|No such file|not ok/i.test(l));
  if (first < 0) return lines.slice(-max).join('\n');
  const from = Math.max(0, first - 2);
  return lines.slice(from, from + max).join('\n');
}

export interface NpmFailure {
  /** One sentence, plain language: what actually went wrong. */
  cause: string;
  /** The concrete next step, or '' when there is nothing sensible to suggest. */
  fix: string;
}

/**
 * Translate an npm/node-gyp failure into something an operator can act on. The
 * raw log is still shown, but "gyp ERR! stack Error: not found: make" is not an
 * error message a person should have to decode while standing in a field.
 *
 * Ordered most-specific first: a build that fails for a missing library must not
 * be reported as the generic "compiler missing".
 */
export function explainNpmFailure(
  out: string,
  opts: {
    dep?: HwDepName;
    timedOut?: boolean;
    /** npm exited 0 but the module is not there — see npmInstallArgs. */
    silentDrop?: boolean;
  } = {},
): NpmFailure {
  const log = out ?? '';
  const dep = opts.dep;
  const aptFor = (pkgs: string[]) => `sudo apt install -y ${pkgs.join(' ')}`;

  if (opts.timedOut) {
    return {
      cause: 'the install took too long and was stopped',
      fix: 'A slow SD card plus a from-source build can exceed the limit. Try again — npm keeps what it already downloaded — or install it over SSH.',
    };
  }

  // npm/libc error codes are matched CASE-SENSITIVELY as whole words. Case-insensitive
  // matching looked harmless until a node-gyp stack trace containing the identifier
  // `eNotFound` was diagnosed as "no internet" — the log is full of JS identifiers that
  // spell error codes in camelCase.
  if (/\bENOSPC\b/.test(log) || /no space left on device/i.test(log)) {
    return { cause: 'the SD card is full', fix: 'Free some space (`df -h`, then e.g. `sudo apt clean`) and try again.' };
  }

  // Network before everything else: on an isolated vehicle this is the common one,
  // and a failed download produces confusing follow-up errors.
  if (
    /\b(ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ENETUNREACH)\b/.test(log) ||
    /network error|request to https?:\/\/registry\.npmjs\.org/i.test(log)
  ) {
    return {
      cause: 'the Pi could not reach the npm registry (no internet)',
      fix: 'The vehicle needs internet for this — join a WiFi network in Setup › WiFi, or bring up LTE, then try again. On its own hotspot without an uplink it cannot download anything.',
    };
  }

  if (/\b(EACCES|EPERM)\b/.test(log) || /permission denied/i.test(log)) {
    return {
      cause: 'npm was not allowed to write into the install directory',
      fix: 'The vehicle service must own its checkout: `sudo chown -R $(whoami) /opt/yonderrc` — or run the install over SSH with sudo.',
    };
  }

  // A missing C library for the module itself (pigpio.h / -lpigpio) — this is NOT
  // a missing compiler, and telling the operator to install build-essential here
  // would send them down the wrong path.
  const libMatch = log.match(/fatal error:\s*([\w./-]+\.h):\s*No such file/i) || log.match(/cannot find -l([\w.-]+)/i);
  if (libMatch) {
    const apt = dep ? hwDepInfo(dep).apt : [];
    return {
      cause: `a system library this module builds against is missing (${libMatch[1]})`,
      fix: apt.length
        ? `Install it first: \`${aptFor(apt)}\`, then install the module again.`
        : 'Install the matching `-dev` apt package for that header, then try again.',
    };
  }

  if (/gyp ERR!.*(not found: (make|g\+\+|cc|gcc))|not found: (make|g\+\+|cc|gcc)|make: not found|g\+\+: not found/i.test(log)) {
    return {
      cause: 'the C/C++ build tools are missing, so the module could not be compiled',
      fix: `Install them once: \`${aptFor(['build-essential'])}\`, then install the module again.`,
    };
  }

  // Python 3.12 removed distutils, which older node-gyp still imports. Not a
  // missing compiler and not a missing Python — a third thing entirely, and the
  // traceback says nothing an operator could act on.
  if (/No module named ['\"]?distutils/i.test(log)) {
    return {
      cause: "node-gyp cannot run with this Python — version 3.12 removed the `distutils` module it imports",
      fix: 'Install the replacement once: `sudo apt install -y python3-setuptools`, then try again. (Raspberry Pi OS Bookworm ships Python 3.11 and is not affected.)',
    };
  }

  if (/gyp ERR! find Python|Could not find any Python installation/i.test(log)) {
    return {
      cause: 'node-gyp found no Python, which it needs to configure the build',
      fix: `Install it once: \`${aptFor(['python3'])}\`, then install the module again.`,
    };
  }

  if (/404 Not Found.*registry\.npmjs\.org|E404/i.test(log)) {
    return {
      cause: 'the npm registry does not know that package name',
      fix: 'That should not happen with the built-in list — please report it with the log below.',
    };
  }

  if (/gyp ERR!|node-gyp|make: \*\*\*/i.test(log)) {
    const apt = dep ? hwDepInfo(dep).apt : [];
    return {
      cause: 'the native build failed while compiling',
      fix: apt.length
        ? `Usually a missing prerequisite: \`${aptFor(['build-essential', ...apt])}\`, then try again. The log below has the compiler's own message.`
        : `Usually a missing prerequisite: \`${aptFor(['build-essential'])}\`, then try again. The log below has the compiler's own message.`,
    };
  }

  if (opts.silentDrop) {
    return {
      cause: 'the native build failed, so npm dropped the module — and reported success, because an optional dependency that fails to build is not an error to npm',
      fix: 'The log below has the compiler\'s own message. Missing build tools are the usual cause: `sudo apt install -y build-essential`.',
    };
  }

  return {
    cause: 'npm reported an error',
    fix: 'The log below usually names the cause; the same command works over SSH if you need more detail.',
  };
}
