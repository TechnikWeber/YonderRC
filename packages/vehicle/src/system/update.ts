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

/**
 * Files the vehicle writes into its own checkout, so they are modified on every
 * running vehicle and must not be mistaken for someone's work in progress. They are
 * regenerated at startup, so the update simply discards them.
 *
 * (`docker/go2rtc.yaml` is tracked *and* rewritten from the camera settings at every
 * start — which is why a real vehicle could never fast-forward.)
 */
export const GENERATED_PATHS = ['docker/go2rtc.yaml'];

export interface WorkingTree {
  /** Nothing that blocks a fast-forward. */
  clean: boolean;
  /** Tracked modifications that DO block — someone's actual changes. */
  dirty: string[];
  /** Tracked files the vehicle generates itself; discarded before pulling. */
  generated: string[];
}

/**
 * `git status --porcelain`. Untracked files are ignored on purpose: they never stand
 * in the way of a fast-forward, and a vehicle always has some (its own config, logs).
 * Counting them was why an ordinary vehicle reported "local changes".
 */
export function parseWorkingTree(out: string): WorkingTree {
  const dirty: string[] = [];
  const generated: string[] = [];
  for (const line of (out ?? '').split('\n')) {
    if (!line.trim()) continue;
    const code = line.slice(0, 2);
    if (code === '??' || code === '!!') continue; // untracked / ignored — harmless
    const path = line.slice(3).trim().split(' -> ').pop() ?? '';
    if (!path) continue;
    (GENERATED_PATHS.includes(path) ? generated : dirty).push(path);
  }
  return { clean: dirty.length === 0, dirty: dirty.slice(0, 8), generated };
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
 * Arguments for every git call the vehicle makes: just run inside the checkout.
 *
 * The ownership exception does NOT belong here. The installer clones as `pi` while
 * the service runs as root, so git refuses with "detected dubious ownership" — and
 * `-c safe.directory=…` does not lift it: git only honours that setting from
 * *protected* configuration (system or global), never from the command line. It
 * silently changed nothing on a real Pi. The fix is an env var, see gitEnv().
 */
export function gitArgs(repoRoot: string, args: string[]): string[] {
  return ['-C', repoRoot, ...args];
}

/**
 * Contents of the throwaway global git config that lifts the ownership block.
 *
 * Three entries, because two attempts already failed on a real Pi for reasons that
 * were invisible from here: the path with and without a trailing slash (the repo
 * root is derived from a URL and carries one, and older git compares literally),
 * plus `*`. The wildcard is safe *here* precisely because this file is handed to
 * git only through `GIT_CONFIG_GLOBAL` on the vehicle's own invocations — it never
 * touches the operator's git config, and it never applies to any other command.
 */
export function safeDirectoryConfig(repoRoot: string): string {
  const trimmed = repoRoot.replace(/\/+$/, '');
  return `[safe]\n\tdirectory = ${trimmed}\n\tdirectory = ${trimmed}/\n\tdirectory = *\n`;
}

/**
 * Where the update comes from. Defaults to the checkout's own `origin`/`main`, and
 * can be pointed at a fork or a branch — a remote NAME or a URL, both of which git
 * accepts in the same position.
 */
export interface UpdateSource {
  source: string;
  branch: string;
}

export const UPDATE_SOURCE_DEFAULT: UpdateSource = { source: 'origin', branch: 'main' };

/**
 * Accept a remote name or an http(s)/ssh URL, and nothing that could confuse a
 * later reader. Commands are executed without a shell, so this is about catching
 * typos early rather than about injection.
 */
export function isGitSource(v: unknown): v is string {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || /\s/.test(s)) return false;
  if (/^https?:\/\/[^\s]+$/.test(s)) return true;
  if (/^(ssh:\/\/|git@)[^\s]+$/.test(s)) return true;
  return /^[A-Za-z0-9._-]+$/.test(s);
}

export function isGitBranch(v: unknown): v is string {
  return typeof v === 'string' && /^[A-Za-z0-9._\/-]+$/.test(v.trim()) && v.trim().length > 0;
}

/**
 * The commands to run, in order. Dependencies before the build (vite needs its
 * platform binaries), build before the restart (so the service comes back with a
 * matching ground app rather than a half-updated one).
 */
export function updateSteps(
  impact: UpdateImpact,
  src: UpdateSource = UPDATE_SOURCE_DEFAULT,
  generated: string[] = [],
): UpdateStep[] {
  const steps: UpdateStep[] = [];
  if (generated.length) {
    // The vehicle wrote these itself and writes them again on the next start, so
    // discarding them costs nothing — and without it the pull cannot fast-forward.
    steps.push({ label: 'Discarding generated files', cmd: 'git', args: ['checkout', '--', ...generated] });
  }
  steps.push({ label: 'Fetching and applying the update', cmd: 'git', args: ['pull', '--ff-only', src.source, src.branch] });
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
  /**
   * Locally modified files that the incoming update ALSO changes. Only these
   * actually block a fast-forward — git does not care about the rest, and neither
   * should we.
   */
  conflicts: string[];
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
  if (c.conflicts.length) {
    return {
      message: 'This vehicle has local changes to files the update also changes, so it will not fast-forward.',
      note: `Both sides changed: ${c.conflicts.join(', ')}. Sort that out over SSH — updating would either fail or throw those changes away.`,
    };
  }
  if (c.behind === 0) {
    return { message: `Up to date${c.current ? ` (v${c.current})` : ''}.`, note: null };
  }
  const what = `${c.behind} commit${c.behind === 1 ? '' : 's'} behind${c.available ? ` — v${c.current ?? '?'} → v${c.available}` : ''}.`;
  const notes: string[] = [];
  // Local changes that the update does not touch are worth mentioning, but they are
  // not a reason to refuse — git would have fast-forwarded right past them.
  if (c.tree.dirty.length) notes.push(`this vehicle has local changes to ${c.tree.dirty.join(', ')}, which this update does not touch — they stay as they are`);
  if (c.tree.generated.length) notes.push(`${c.tree.generated.join(', ')} was regenerated by the vehicle and will be discarded (it is written again on the next start)`);
  if (c.impact.deps) notes.push('dependencies changed, so they are installed as part of the update (this needs data and a few minutes)');
  if (c.impact.ground) notes.push('the control app changed and is rebuilt (~1 minute on a Pi)');
  if (c.impact.provisioning)
    notes.push('the installer/systemd files changed — those are only applied by a full `sudo bash provisioning/install.sh`, so run that when you are back at a keyboard');
  return { message: what, note: notes.length ? `Note: ${notes.join('; ')}.` : null };
}
