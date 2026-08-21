/**
 * Self-update from the setup page: what a terminal session would do
 * (`git pull --ff-only` + restart), minus the terminal — because the moment you
 * need it is the moment you are standing in a field with a phone.
 *
 * Two rules shape this file:
 *
 *  1. **Check before you change.** The vehicle fetches, then reports what would
 *     happen — which commits, which version, and whether the update needs more
 *     than a pull. You decide afterwards.
 *  2. **Never leave the vehicle unable to start.** A pull that adds a dependency
 *     or changes the ground app, followed by a bare restart, gives you a service
 *     that crashes on boot — and the setup UI *is* that service, so you would
 *     lose the very page you were using. The steps are therefore derived from the
 *     diff: dependencies changed → install them, ground app changed → rebuild it,
 *     and only then restart.
 *
 * All of it is pure here; RealSystem runs the commands.
 */

export interface WorkingTree {
  clean: boolean;
  /** Locally modified files (up to a handful, for the message). */
  dirty: string[];
}

/** `git status --porcelain` — empty means clean. */
export function parseWorkingTree(out: string): WorkingTree {
  const dirty = (out ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => l.replace(/^\S+\s+/, ''));
  return { clean: dirty.length === 0, dirty: dirty.slice(0, 8) };
}

export interface Commit {
  hash: string;
  subject: string;
}

/** `git log --oneline --no-decorate HEAD..origin/main`, newest first. */
export function parseCommits(out: string): Commit[] {
  return (out ?? '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const sp = l.indexOf(' ');
      return sp < 0 ? { hash: l, subject: '' } : { hash: l.slice(0, sp), subject: l.slice(sp + 1) };
    });
}

/** Version field out of a `package.json` blob (`git show origin/main:package.json`). */
export function parseVersion(pkgJson: string): string | null {
  try {
    const v = (JSON.parse(pkgJson ?? '') as { version?: string }).version;
    return typeof v === 'string' ? v : null;
  } catch {
    return null;
  }
}

export interface UpdateImpact {
  /** Any package.json changed → node_modules may be out of date. */
  deps: boolean;
  /** The ground app changed → its built bundle is stale until rebuilt. */
  ground: boolean;
  /** install.sh / systemd units / onboard.sh changed → a full installer run is wiser. */
  provisioning: boolean;
  /** The vehicle service itself changed → a restart is enough. */
  vehicle: boolean;
}

/** What the incoming diff touches, from `git diff --name-only HEAD..origin/main`. */
export function classifyChanges(files: string[]): UpdateImpact {
  const f = files.filter(Boolean);
  return {
    deps: f.some((p) => /(^|\/)package(-lock)?\.json$/.test(p)),
    ground: f.some((p) => p.startsWith('packages/ground/')),
    provisioning: f.some((p) => p.startsWith('provisioning/')),
    vehicle: f.some((p) => p.startsWith('packages/vehicle/') || p.startsWith('packages/protocol/')),
  };
}

export type UpdateStep = { label: string; args: string[]; cmd: 'git' | 'npm' };

/**
 * Arguments for every git call the vehicle makes.
 *
 * `-c safe.directory=…` is not optional: the installer clones as `pi` while the
 * service runs as root, and git then refuses with "detected dubious ownership".
 * Passing it per invocation beats writing a global config — that would depend on
 * `$HOME`, which a systemd service is not guaranteed to have, and it would leave
 * state behind on the machine. `-C` then runs it in the checkout no matter where
 * the process happens to be.
 */
export function gitArgs(repoRoot: string, args: string[]): string[] {
  return ['-c', `safe.directory=${repoRoot}`, '-C', repoRoot, ...args];
}

/**
 * The commands to run, in order. Dependencies before the build (vite needs its
 * platform binaries), build before the restart (so the service comes back with a
 * matching ground app rather than a half-updated one).
 */
export function updateSteps(impact: UpdateImpact): UpdateStep[] {
  const steps: UpdateStep[] = [{ label: 'Fetching and applying the update', cmd: 'git', args: ['pull', '--ff-only', 'origin', 'main'] }];
  if (impact.deps) {
    steps.push({ label: 'Installing changed dependencies', cmd: 'npm', args: ['install', '--omit=optional', '--no-audit', '--no-fund'] });
    // Mirrors install.sh: --omit=optional also drops rollup's/esbuild's platform
    // binaries, which the ground build needs.
    steps.push({ label: 'Restoring the build tooling', cmd: 'npm', args: ['install', '--include-workspace-root', '-w', '@yonderrc/ground', '--no-audit', '--no-fund'] });
  }
  if (impact.ground || impact.deps) {
    steps.push({ label: 'Rebuilding the control app', cmd: 'npm', args: ['run', 'build', '-w', '@yonderrc/ground'] });
  }
  return steps;
}

/**
 * Why `git fetch` failed, in words an operator can act on. The generic "needs
 * internet" was wrong often enough to be harmful: the most common cause on a Pi is
 * git refusing to work in a checkout owned by another user, which has nothing to do
 * with the network at all.
 */
export function explainGitFailure(out: string): { cause: string; fix: string; selfFixable: boolean } {
  const log = out ?? '';
  if (/dubious ownership|safe\.directory/i.test(log)) {
    return {
      cause: 'git refused to use the checkout because it belongs to a different user than the service',
      fix: 'The vehicle can fix this itself — press Check again. (Manually: `sudo git config --global --add safe.directory /opt/yonderrc`.)',
      selfFixable: true,
    };
  }
  if (/not a git repository/i.test(log)) {
    return {
      cause: 'this vehicle was not installed from git, so there is nothing to pull',
      fix: 'Re-install it with the bootstrap one-liner (it clones into /opt/yonderrc); a copied or unzipped folder cannot update itself.',
      selfFixable: false,
    };
  }
  if (/could not resolve (host|proxy)|name or service not known|temporary failure in name resolution/i.test(log)) {
    return {
      cause: 'the vehicle could not resolve github.com (no DNS)',
      fix: 'The uplink is up but name resolution is not — check Setup › WiFi / the LTE stick, then try again.',
      selfFixable: false,
    };
  }
  if (/failed to connect|connection timed out|network is unreachable|could not read from remote/i.test(log)) {
    return {
      cause: 'the vehicle could not reach github.com',
      fix: 'Check the uplink. Reaching the vehicle over Tailscale does not mean the vehicle itself has internet.',
      selfFixable: false,
    };
  }
  if (/authentication failed|permission denied \(publickey\)|terminal prompts disabled/i.test(log)) {
    return {
      cause: 'the remote asked for credentials',
      fix: 'Point the checkout at the public HTTPS URL: `sudo git -C /opt/yonderrc remote set-url origin https://github.com/TechnikWeber/YonderRC.git`.',
      selfFixable: false,
    };
  }
  if (/couldn't find remote ref|unknown revision|ambiguous argument/i.test(log)) {
    return {
      cause: "the branch `main` does not exist on the remote (or this checkout is on another branch)",
      fix: 'Check `git -C /opt/yonderrc status` over SSH.',
      selfFixable: false,
    };
  }
  return {
    cause: 'git could not fetch',
    fix: 'The message below is git\'s own. The vehicle needs internet for this — reaching it over a VPN does not prove that it has any.',
    selfFixable: false,
  };
}

export interface UpdateCheck {
  /** Did the check itself work (network, git)? */
  ok: boolean;
  /** Version running right now. */
  current: string | null;
  /** Version that would be installed. */
  available: string | null;
  behind: number;
  commits: Commit[];
  impact: UpdateImpact;
  tree: WorkingTree;
  /** One sentence for the panel. */
  message: string;
  /** Extra warning worth reading before pressing Update. */
  note: string | null;
  /** git's own words, when something went wrong. */
  detail?: string | null;
}

/** Human summary of a check, so the wording lives next to the rules that produce it. */
export function describeCheck(c: Omit<UpdateCheck, 'message' | 'note'>): { message: string; note: string | null } {
  if (!c.ok) {
    // The caller passes git's output through `detail`; explain it rather than
    // guessing "no internet", which was wrong more often than it was right.
    const f = explainGitFailure(c.detail ?? '');
    return { message: `Update check failed — ${f.cause}.`, note: f.fix };
  }
  if (!c.tree.clean) {
    return {
      message: 'This vehicle has local changes, so it will not fast-forward.',
      note: `Modified here: ${c.tree.dirty.join(', ')}. Sort that out over SSH — updating would either fail or throw those changes away.`,
    };
  }
  if (c.behind === 0) {
    return { message: `Up to date${c.current ? ` (v${c.current})` : ''}.`, note: null };
  }
  const what = `${c.behind} commit${c.behind === 1 ? '' : 's'} behind${c.available ? ` — v${c.current ?? '?'} → v${c.available}` : ''}.`;
  const notes: string[] = [];
  if (c.impact.deps) notes.push('dependencies changed, so they are installed as part of the update (this needs data and a few minutes)');
  if (c.impact.ground) notes.push('the control app changed and is rebuilt (~1 minute on a Pi)');
  if (c.impact.provisioning)
    notes.push('the installer/systemd files changed — those are only applied by a full `sudo bash provisioning/install.sh`, so run that when you are back at a keyboard');
  return { message: what, note: notes.length ? `Note: ${notes.join('; ')}.` : null };
}
