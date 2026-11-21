// The install conversation's shared parts (Issue #113), moved from global/workstation.py by #495 (S24 of
// #470): mhw install, update and uninstall say what will change, wait for RETURN, ask for the
// administrator password once and only when the admin layer changes, show a few ==> headings, and end
// with the result and numbered next steps. The installers' own lines are shown with --verbose; a problem
// line (REFUSE, STALE, DRIFT, MISSING) and every CHANGED line are always shown.
//
// global/install.sh and global/install-managed.sh stay the internals: this module decides their flags and
// summarises their output, it renders nothing itself. They run under /bin/sh by absolute path, never a
// sh looked up on PATH. sudo (/usr/bin/sudo, by absolute path) runs only for install-managed.sh --apply or
// --remove, after the owner confirmed in a terminal (or passed --yes), and sudo itself asks for the
// password: `-k` makes it ignore any cached credential. Without a terminal it is never run. Under
// WORKSTATION_MANAGED_ROOT (tests and probes) the admin root is a directory of theirs and no sudo runs.
// node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import tty from 'node:tty';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { managedRoot, splitlines } from './readers/common.js';
import { issues as countIssues, leadingWord } from './readers/admin.js';
import { runAbsolute } from './run.js';

/** @typedef {import('./readers/common.js').Env} Env */
/** @typedef {{ out: (text: string) => void, err: (text: string) => void, tty?: boolean }} Io */
/** @typedef {(exe: string, args: string[], env: Env) => [number, string[]]} Runner */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SH = '/bin/sh';
export const SUDO = '/usr/bin/sudo';
export const STTY = '/bin/stty';
export const INSTALL = path.join(ROOT, 'global', 'install.sh');
export const INSTALL_MANAGED = path.join(ROOT, 'global', 'install-managed.sh');
export const FRESH = 'Open new Claude Code, Codex and Kiro sessions: a session already running keeps its old settings.';
const PROBLEM = ['REFUSE', 'STALE', 'DRIFT', 'MISSING'];

/** The standard output and error of this process, written synchronously so they interleave with children's. */
export const STDIO = /** @type {Io} */ ({
  out: (text) => fs.writeSync(1, text),
  err: (text) => fs.writeSync(2, text),
});

/** Both stdin and stdout are terminals: the conversation may ask. */
export function interactive() {
  return tty.isatty(0) && tty.isatty(1);
}

/**
 * An ANSI style around text, only on a terminal and without NO_COLOR.
 * @param {string} code @param {string} text @param {Env} env @param {Io} io
 */
export function styled(code, text, env, io) {
  const isTty = io.tty ?? tty.isatty(1);
  if (isTty && !env.NO_COLOR) return '\x1b[' + code + 'm' + text + '\x1b[0m';
  return text;
}

/** @param {string} text @param {Env} env @param {Io} io */
export function heading(text, env, io) {
  io.out(styled('34', '==>', env, io) + ' ' + styled('1', text, env, io) + '\n');
}

/** @param {string[]} steps @param {Env} env @param {Io} io */
export function nextSteps(steps, env, io) {
  io.out('\n');
  heading('Next steps', env, io);
  steps.forEach((step, i) => io.out((i + 1) + '. ' + step + '\n'));
}

/**
 * The installers' lines: all of them with --verbose; otherwise the problems, and every CHANGED line,
 * which names a setting of the owner's that install replaced or removed, old -> new (Issue #145).
 * @param {string[]} lines @param {boolean} verbose @param {Io} io
 */
export function show(lines, verbose, io) {
  for (const line of lines) {
    if (verbose || leadingWord(line, PROBLEM) || line.startsWith('CHANGED ')) io.out('    ' + line + '\n');
  }
}

/** The target lines install fixes: neither OK nor SKIP. @param {string[]} lines */
export const issues = countIssues;

/** The lines of a problem: a REFUSE, STALE, DRIFT or MISSING line. @param {string} line */
export const isProblem = (line) => leadingWord(line, PROBLEM) !== null;

/**
 * Run exe (absolute) and return [exit code, lines]: stdout then stderr, split as str.splitlines() does,
 * with stdin inherited (sudo asks for the password on the terminal, not through the captured output).
 * @type {Runner}
 */
export function capture(exe, args, env) {
  const r = runAbsolute(exe, args, { env, stdio: ['inherit', 'pipe', 'pipe'] });
  if (r.error && !r.stdout && !r.stderr) return [r.code, ['REFUSE  ' + path.basename(exe) + ' did not start: ' + r.error.message]];
  return [r.code, splitlines(r.stdout + r.stderr)];
}

/**
 * Run exe (absolute) on this process's own terminal and output; the exit code.
 * @param {string} exe @param {string[]} args @param {Env} env @param {Io} io
 */
export function passThrough(exe, args, env, io) {
  const r = runAbsolute(exe, args, { env, stdio: 'inherit' });
  if (r.error) {
    io.err('mhw: ' + path.basename(exe) + ' did not start: ' + r.error.message + '\n');
    return 2;
  }
  return r.code;
}

/** install.sh's argv: the flags, and the managed root when one is set. @param {string[]} extra @param {Env} env */
export function installArgs(extra, env) {
  const args = [INSTALL, ...extra];
  if (managedRoot(env)) args.push('--managed-root=' + managedRoot(env));
  return args;
}

/** install-managed.sh's argv. @param {string[]} extra @param {Env} env */
export function managedArgs(extra, env) {
  const args = [INSTALL_MANAGED, ...extra];
  if (managedRoot(env)) args.push('--root=' + managedRoot(env));
  return args;
}

/**
 * The admin-layer step, run as root by one sudo call that asks for the password itself: [exe, args].
 * `-k` makes sudo ignore any cached credential, so the password is typed for this very step; sudo reads
 * it from the terminal, not from the captured output. (`sudo -k -v` followed by `sudo -n` would fail:
 * with -k, sudo does not cache, per its manual; PR #114 lens.) Under WORKSTATION_MANAGED_ROOT (tests) the
 * admin root is a directory of the tests and no sudo runs.
 * @param {string[]} args the command, its program first (an absolute path) @param {Env} env
 * @returns {[string, string[]]}
 */
export function asRoot(args, env) {
  if (managedRoot(env)) return [args[0], [...args.slice(1), '--root=' + managedRoot(env)]];
  return [SUDO, ['-k', '-p', 'Password for %u: ', ...args]];
}

const RENDERED = /--apply="([^"]+)" --sha256=([0-9a-f]+)/;

/**
 * Render the admin stage as the owner, then apply it as root (asRoot). -> [code, lines].
 * @param {boolean} verbose @param {Env} env @param {Io} io @param {Runner} [run]
 * @returns {[number, string[]]}
 */
export function adminApply(verbose, env, io, run = capture) {
  const [code, lines] = run(SH, managedArgs([], env), env);
  show(lines.filter((l) => !l.startsWith('RUN ') && !l.startsWith('THEN')), verbose, io);
  if (code !== 0) return [code, lines];
  const runLine = lines.find((l) => l.startsWith('RUN ')) || '';
  const m = RENDERED.exec(runLine);
  if (!m) return [3, ['REFUSE  the admin stage did not render']];
  const [exe, args] = asRoot([SH, INSTALL_MANAGED, '--apply=' + m[1], '--sha256=' + m[2]], env);
  const [acode, alines] = run(exe, args, env);
  show(alines.filter((l) => !l.startsWith('THEN')), verbose, io);
  return [acode, alines];
}

/**
 * True when the admin-layer step may run: in a terminal (`asking`), after saying why the password is
 * needed. The barrier is the password itself, asked by the one sudo call of asRoot with `-k`, so a
 * process that only fakes a terminal (an agent can, with `script`) meets a prompt it cannot answer
 * (PR #114 lens). Without a terminal, sudo is not run at all. Under WORKSTATION_MANAGED_ROOT (tests) no
 * sudo runs, so this is true.
 * @param {boolean} asking @param {Env} env @param {Io} io
 */
export function adminAccess(asking, env, io) {
  if (managedRoot(env)) return true;
  if (!asking) return false;
  heading('Administrator access', env, io);
  io.out('The system-wide protections live in folders only an administrator can change, so that no agent\n');
  io.out('session can switch them off. sudo asks for your password now; mhw uses it for that step only.\n');
  return true;
}

/**
 * The owner's own acts that install.sh names in its output, as plain next steps (Issue #113).
 * @param {string[]} lines
 */
export function ownerSteps(lines) {
  /** @type {string[]} */
  const steps = [];
  lines.forEach((line, i) => {
    // Issue #145: install writes the paste wrapper's block into ~/.zshrc or ~/.bashrc itself. Only when it
    // chose no file (another shell, --shell-rc=none, a ZDOTDIR outside HOME) is the line the owner's;
    // install.sh gives the reason in parentheses, and the step repeats it rather than guessing one.
    if (line.startsWith('NOTE    automatic paste cleaning') && i + 1 < lines.length) {
      const m = /\((.*)\); add this line/.exec(line);
      const why = m ? ' (' + m[1] + ')' : '';
      // macOS bash: ~/.bashrc got the block, only the login file did not (only ~/.profile is there).
      const which = line.includes('no bash login start-up file') ? 'bash login start-up file' : 'shell start-up file';
      steps.push('mhw wrote no ' + which + why + '. To clean pasted text automatically, add this line to yours:\n       '
        + lines[i + 1].trim());
    }
    if (line.startsWith('RESTART REQUIRED') && line.includes('/hooks')) {
      steps.push('In Codex, approve the mhw hooks once: type /hooks in a new session.');
    }
  });
  return steps;
}

/** Sleep without the event loop. @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** /bin/stty on the terminal at fd 0; its trimmed output, or null when it failed. @param {string[]} args */
function stty(args) {
  const p = spawnSync(STTY, args, { stdio: [0, 'pipe', 'pipe'], encoding: 'utf8', timeout: 10000 });
  return p.error || p.status !== 0 ? null : p.stdout.trim();
}

/** One byte from fd 0, or null at end of file. */
function readByte() {
  const buf = Buffer.alloc(1);
  for (;;) {
    try {
      return fs.readSync(0, buf, 0, 1, null) === 1 ? buf[0] : null;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EAGAIN') return null;
      sleep(20);
    }
  }
}

/**
 * True on RETURN. One key, no echo; any other key aborts. The terminal leaves line mode before the prompt
 * is shown, so a key typed right after it is never held back waiting for a newline. Signals are off for
 * that one key too: Ctrl+C is "any other key", so the terminal is always restored.
 * @param {Env} env @param {Io} io
 */
export function confirm(env, io) {
  const prompt = 'Press ' + styled('1', 'RETURN', env, io) + ' to continue or any other key to abort:';
  const saved = stty(['-g']);
  /** @type {number | null} */
  let key = null;
  if (saved !== null && stty(['-icanon', '-echo', '-isig', 'min', '1', 'time', '0']) !== null) {
    try {
      io.out(prompt + ' ');
      key = readByte();
    } finally {
      stty([saved]);
    }
  } else {
    // No terminal modes to change: the first character of a line.
    io.out(prompt + ' ');
    key = readByte();
    // The rest of the line, up to its newline or the end of input.
    for (let b = key; b !== null && b !== 0x0a;) b = readByte();
    if (key === null) key = 0x78;
  }
  io.out('\n');
  return key === 0x0d || key === 0x0a;
}

/** @param {boolean} verbose @param {boolean} yes */
export function uxFlags(verbose, yes) {
  return [...(verbose ? ['--verbose'] : []), ...(yes ? ['--yes'] : [])];
}
