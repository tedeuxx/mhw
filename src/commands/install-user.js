// `mhw install-user`: the user-layer installer, moved from global/install.sh by #503 (S25 of #470). It
// renders the global brief to each harness, installs the user-level deny floor (Kiro's too, ADR-0036) and
// the paste filter at the harness-CLI prompt (ADR-0010, ADR-0016, ADR-0033), renders the inner-loop allow
// list (allow-list.conf; ADR-0031: wide only while the admin deny floor is complete), and sets each
// harness's session-start default model and effort from overlay/model-defaults.json (ADR-0007, ADR-0035).
// The brief, the managed files, the retirements and the modes run in this process; each renderer of
// src/render (and `mhw profile check`, `mhw chrome-debugging`) runs as its own node process, by absolute
// path, with the arguments and exit-code reading install.sh gave it. Its lines go to this process's own
// output, written synchronously, so they interleave with the renderers' in the order they happen.
//
// The command line and the exit codes are install.sh's (USAGE below). A file is managed when its marker line
// is in its first five lines; an unmanaged file is never overwritten. node: modules only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { MARKER_ID, isManaged as managedText, unstamp, stampOfLine } from '../lib/marker.js';
import { privateCopy } from '../lib/private-copy.js';
import { onPath } from '../lib/onpath.js';
import { runAbsolute } from '../lib/run.js';

/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {{ out: (text: string | Buffer) => void, err: (text: string | Buffer) => void }} Io */

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = 'personal-multi-harness-workstation-configuration';
const CLIP_LABEL = 'local.' + NAME + '.clipboard-guard';
const ALLOW_OWN_KEY = NAME + '-owned-allow';
export const PASTE_START_NOTICE = 'Paste filter (ADR-0033): internal error (HookStartError); this prompt was NOT checked.';

export const USAGE = `Render the global brief to each harness, install the user-level deny floor (Kiro's too, ADR-0036), and
install the paste filter at the harness-CLI prompt (ADR-0010, ADR-0016, ADR-0033), render the inner-loop
allow list (allow-list.conf; ADR-0031: wide only while the admin deny floor is complete), and set each
harness's session-start default model and effort from overlay/model-defaults.json (ADR-0007, ADR-0035).
The owner runs it through mhw install, update and uninstall; this is their internal step.

  mhw install-user                  install or update every managed target
  mhw install-user --dry-run        print exactly what would be written or merged where; write nothing
  mhw install-user --uninstall      remove every file this step placed (only files carrying its marker) and
                                    its hook entries, deny-floor rules and stamp key from ~/.claude/settings.json
  mhw install-user --check          exit non-zero if any target is missing, drifted, unmanaged, or carries a
                                    provenance stamp (release and commit) other than the source's
  mhw install-user --overlay=DIR    owner overlay directory (default: <repo>/overlay); --overlay=none for none.
                                    WORKSTATION_OVERLAY=DIR|none in the environment sets the same default;
                                    an --overlay argument wins over it
  mhw install-user --hooks=managed  the hooks run from the admin layer (mhw install-admin, ADR-0025): remove
                                    this project's hook entries from the user settings and its Codex hooks.json
                                    instead of writing them (default --hooks=user)
  --managed-root=DIR                read the admin layer under DIR instead of / (tests only); this step never
                                    writes the admin layer, it only reports which layer carries the deny floor
  --shell-rc=FILE                   the shell start-up file that gets the paste wrapper's managed block (an
                                    absolute path). Default: from $SHELL, zsh \${ZDOTDIR:-~}/.zshrc, bash
                                    ~/.bashrc, plus on macOS the login file. --shell-rc=none writes none.
  --method                          opt-in (Issue #61): render the working method (method/) too

Exit codes: 0 ok · 1 drift, stamp or missing (--check) · 2 usage, invalid floor entry or missing dependency ·
3 something UNMANAGED or unreadable is in the way.
`;

/** install.sh's `exit N` from inside a step: unwinds to main, which cleans the work directory. */
class Exit extends Error {
  /** @param {number} code */
  constructor(code) {
    super('exit ' + code);
    this.code = code;
  }
}

/** Every byte of text, written synchronously. @param {number} fd @param {string | Buffer} text */
function write(fd, text) {
  const b = typeof text === 'string' ? Buffer.from(text, 'utf8') : text;
  for (let off = 0; off < b.length;) off += fs.writeSync(fd, b, off, b.length - off);
}

/** This process's output, written synchronously so it interleaves with the renderers' inherited output. */
export const STDIO = /** @type {Io} */ ({
  out: (text) => { write(1, text); },
  err: (text) => { write(2, text); },
});

// ------------------------------------------------------------------------------------------- the file system

/** test -e: exists after links. @param {string} p */
function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** test -L. @param {string} p */
function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/** test -f: a regular file after links. @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** test -d. @param {string} p */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** test -f && test -x. @param {string} p */
function executableFile(p) {
  if (!isFile(p)) return false;
  try {
    fs.accessSync(p, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** The bytes of a file, or null when it cannot be read. @param {string} p */
function readBytes(p) {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/** is_managed: the marker in the first five lines (head -n 5 | grep -F). @param {string} p */
export function isManaged(p) {
  const raw = readBytes(p);
  return raw !== null && managedText(raw.toString('latin1'));
}

/** stamp_of: the release and commit fields of the first managed-by line, or "none". @param {string} p */
export function stampOf(p) {
  const raw = readBytes(p);
  if (raw === null) return 'none';
  const line = raw.toString('latin1').split('\n').find((l) => l.includes(MARKER_ID));
  return line === undefined ? 'none' : stampOfLine(line);
}

/** same: byte-identical, or identical once the stamp fields of the marker lines are removed. @param {Buffer} a @param {string} p */
function same(a, p) {
  const b = readBytes(p);
  if (b === null) return false;
  if (a.equals(b)) return true;
  return unstamp(a.toString('latin1')) === unstamp(b.toString('latin1'));
}

/** rm -f one name (never a directory). @param {string} p */
function rmF(p) {
  try {
    fs.unlinkSync(p);
  } catch {
    // rm -f: an absent name is not an error, and a directory stays
  }
}

/** rmdir; true when it was removed. @param {string} p */
function rmdir(p) {
  try {
    fs.rmdirSync(p);
    return true;
  } catch {
    return false;
  }
}

/** sha256 of bytes. @param {Buffer} b */
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ------------------------------------------------------------------------------------------- node lookups

/**
 * Which node a step runs: MHW_NODE when it is an absolute path, else node on PATH; null when there is
 * none. `refused` is set when an absolute MHW_NODE is not an executable file: it is never replaced by
 * another node (PR #515 lens A1).
 * @param {Env} env
 * @returns {{ node: string | null, refused: boolean }}
 */
export function nodeLookup(env) {
  const given = env.MHW_NODE || '';
  if (given.startsWith('/')) return executableFile(given) ? { node: given, refused: false } : { node: null, refused: true };
  return { node: onPath('node', env), refused: false };
}

/** The node answers as node: a program that exits 0 and prints nothing never reads as one. @param {string} node @param {Env} env */
function answersAsNode(node, env) {
  const r = runAbsolute(node, ['-e', 'process.stdout.write("mhw-node-ok")'], { env });
  return r.stdout.replace(/\n+$/, '') === 'mhw-node-ok';
}

// ------------------------------------------------------------------------------------------- the stamp

const NUMERIC_TAG = /^v\d+\.\d+\.\d+$/;
/** grep -Eqx over printf '%s\n' "$s": any line matches. @param {string} s */
const numericTag = (s) => s.split('\n').some((l) => NUMERIC_TAG.test(l));
/** $(...): the output without its trailing newlines. @param {string} s */
const subst = (s) => s.replace(/\n+$/, '');

/**
 * The provenance stamp (Issue #66, PRD 9a, ADR-0029): every file this step renders names the commit and
 * the release it came from.
 *   release: vX.Y.Z                       HEAD is exactly that numeric SemVer tag and nothing tracked is modified
 *   release: unreleased, after vX.Y.Z     any other commit: the nearest tag
 *   release: unreleased, no tag reachable a checkout without tags (a shallow CI clone)
 *   commit:  the full HEAD SHA, with "-dirty" appended when a tracked file differs from HEAD
 * Outside a git checkout of this repository itself (a GitHub source archive, which is what an npm install
 * downloads; Issue #68, ADR-0034) the fields come from .workstation-archive, which git archive filled in;
 * otherwise both say unknown and name the .bumpversion.toml version instead.
 * @param {string} root @param {string} version @param {Env} env
 */
export function deriveStamp(root, version, env) {
  const git = onPath('git', env);
  /** @param {string[]} args @returns {string | null} the output, or null when git failed */
  const run = (...args) => {
    if (!git) return null;
    const r = runAbsolute(git, ['-C', root, ...args], { env });
    return r.code === 0 ? subst(r.stdout) : null;
  };
  let real = null;
  try {
    real = fs.realpathSync(root);
  } catch {
    real = null;
  }
  const glob = 'v[0-9]*.[0-9]*.[0-9]*';
  const inside = run('rev-parse', '--is-inside-work-tree') !== null;
  const top = inside ? (run('rev-parse', '--show-toplevel') ?? '') : null;
  const commit = inside && top === real ? run('rev-parse', '--verify', 'HEAD') : null;
  if (commit !== null) {
    const dirty = (run('status', '--porcelain', '--untracked-files=no') ?? '') !== '' ? '-dirty' : '';
    const exact = dirty ? null : run('describe', '--tags', '--exact-match', '--match', glob, 'HEAD');
    let release;
    if (exact !== null && numericTag(exact)) release = exact;
    else {
      const near = run('describe', '--tags', '--abbrev=0', '--match', glob, 'HEAD');
      if (near !== null && numericTag(near)) release = 'unreleased, after ' + near;
      else release = 'unreleased, no tag reachable';
    }
    return 'release: ' + release + '; commit: ' + commit + dirty;
  }
  const archive = readBytes(path.join(root, '.workstation-archive'));
  if (archive !== null) {
    const lines = archive.toString('utf8').split('\n');
    const commitLine = lines.map((l) => /^commit: ([0-9a-f]{40})$/.exec(l)).find((m) => m);
    if (commitLine) {
      const d = lines.find((l) => l.startsWith('describe: '));
      const describe = d === undefined ? '' : d.slice('describe: '.length);
      let release = null;
      if (numericTag(describe)) release = describe;
      else if (/^v\d+\.\d+\.\d+-\d+-g[0-9a-f]+$/.test(describe)) release = 'unreleased, after ' + describe.replace(/-\d+-g[0-9a-f]+$/, '');
      else if (describe === '') release = 'unreleased, no tag reachable';
      if (release !== null) return 'release: ' + release + '; commit: ' + commitLine[1];
    }
  }
  return 'release: unknown, not a git checkout (.bumpversion.toml says ' + version + '); commit: unknown';
}

// ------------------------------------------------------------------------------------------- the deny floor

const WORD = /^[A-Za-z0-9._/~=:@+*-]+$/;

/**
 * The deny floor (ADR-0016), validated before anything is rendered, so an entry the parser would drop or
 * mangle stops the run instead of silently leaving a hole: one Claude Code rule per line, and one Codex
 * word list per cmd line. Text in and out is latin1, so every byte goes through as it came.
 * @param {string} text
 * @returns {{ claude: string[], codex: string[], errors: string[] }}
 */
export function parseFloor(text) {
  const claude = [];
  const codex = [];
  const errors = [];
  let n = 0;
  const lines = text.split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  for (const raw of lines) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (/^[ \t]*(#|$)/.test(line)) continue;
    const f = line.split(/[ \t]+/).filter((w) => w !== '');
    const kind = f[0];
    const words = f.slice(1);
    let why = '';
    if (kind !== 'cmd' && kind !== 'file' && kind !== 'glob') why = 'kind must be cmd, file or glob';
    else if (f.length < 2) why = 'no words';
    else if (kind === 'file' && f.length !== 2) why = 'a file entry takes one path';
    else if (kind === 'glob' && f.length < 3) why = 'a glob entry takes a program and at least one word';
    for (const w of words) {
      if (why) break;
      if (!WORD.test(w)) why = 'word outside the allowed set';
      else if (kind === 'cmd' && w.includes('*')) why = 'a cmd word may not hold *';
    }
    if (!why && kind === 'glob') {
      if (words.slice(0, -1).some((w) => w.includes('*'))) why = 'a glob holds * only at the end of its last word';
      const last = words[words.length - 1];
      if (!why && !/^[^*]+\*$/.test(last)) why = 'a glob holds * only at the end of its last word';
      // "Bash(<words>:*)" is the shape of a prefix rule: mhw install-admin would render it for Codex.
      if (!why && last.endsWith(':*')) why = 'a glob may not end in :* (that is a cmd entry)';
    }
    if (why) {
      errors.push('invalid deny-floor entry (' + why + '): ' + line);
      continue;
    }
    if (kind === 'cmd') {
      claude.push('Bash(' + words.join(' ') + ':*)');
      codex.push(words.join(' '));
    } else if (kind === 'glob') claude.push('Bash(' + words.join(' ') + ')');
    else claude.push('Read(' + words[0] + ')', 'Edit(' + words[0] + ')');
    n++;
  }
  if (!errors.length && !n) errors.push('the deny floor has no entry');
  return { claude, codex, errors };
}

// ------------------------------------------------------------------------------------------- the paste filter

/**
 * The start fallback (#488, PR #536 lens B3): when node or the entry is missing or does not start, the hook
 * still says the prompt was NOT checked, in the harness's own protocol. Claude Code and Codex: the notice as
 * {"systemMessage": ...} and exit 0. Kiro: exit 2 with the notice on stderr; the hook's own exit 2 passes
 * through. The whole command is an explicit /bin/sh -c '...', so it means the same whether the agent
 * harness runs it through a shell or splits it into words itself.
 * @param {string} harness @param {string} cmd the hook command (no single quote in it)
 */
export function pasteWrap(harness, cmd) {
  if (harness === 'kiro') {
    return "/bin/sh -c '" + cmd + ' || { [ $? -eq 2 ] && exit 2; printf "%s\\n" "' + PASTE_START_NOTICE + '" >&2; exit 2; }\'';
  }
  return "/bin/sh -c '" + cmd + ' || { printf "%s\\n" "{\\"systemMessage\\": \\"' + PASTE_START_NOTICE + '\\"}"; exit 0; }\'';
}

/**
 * The paste filter's hook command (ADR-0033; Node since #488): `mhw hook prompt`, by absolute paths, with
 * NODE_OPTIONS, NODE_ICU_DATA, NODE_PATH and NODE_COMPILE_CACHE cleared by /usr/bin/env.
 * @param {string} harness @param {string} node @param {string} mhw @param {string} conf
 */
export function pasteCmd(harness, node, mhw, conf) {
  return pasteWrap(harness, '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "'
    + node + '" "' + mhw + '" hook prompt --harness ' + harness + ' --config "' + conf + '"');
}

/** A rendered command as a JSON string's body: backslashes first, then double quotes. @param {string} s */
export const jsonBody = (s) => s.replaceAll('\\', '\\\\').replaceAll('"', '\\"');

// ------------------------------------------------------------------------------------------- the context

/**
 * @typedef {{
 *   env: Env, io: Io, home: string, mode: string, hooksMode: string, methodOptin: boolean, overlay: string,
 *   managedRoot: string, shellRc: string, scriptDir: string, repoRoot: string, dataDir: string, stamp: string,
 *   work: string, status: number, paths: Record<string, string>, brief: Buffer, briefSha: string, briefFrom: string,
 *   floor: string, floorFrom: string, floorClaude: string, floorCodex: string, floorCodexWords: string[],
 *   clipConf: Buffer, allowNode: string | null, allowWhy: string, settingsWhy: string, mergeRefused: boolean,
 *   codexFloorRefused: boolean, kiroFloorRefused: boolean, pasteOk: boolean, wrapNode: string, wrapRefused: boolean,
 *   wrapMhw: string, startupBody: string, processRefused: boolean, cmd: string, uname?: string
 * }} Ctx
 */

/** raise: the status only goes up. @param {Ctx} ctx @param {number} n */
export function raise(ctx, n) {
  if (n > ctx.status) ctx.status = n;
}

/** A line on stdout. @param {Ctx} ctx @param {string} s */
const say = (ctx, s) => ctx.io.out(s + '\n');
/** A line on stderr. @param {Ctx} ctx @param {string} s */
const warn = (ctx, s) => ctx.io.err(s + '\n');

/**
 * Run a node script by absolute path, its output on this process's own (inherited); the exit code.
 * @param {Ctx} ctx @param {string} node @param {string[]} args @param {string} [cwd]
 */
function runNode(ctx, node, args, cwd) {
  const r = runAbsolute(node, args, { env: ctx.env, stdio: 'inherit', cwd });
  if (r.error) warn(ctx, 'mhw: ' + node + ' did not start: ' + r.error.message);
  return r.code;
}

/** The file paths every step reads, derived from HOME, XDG_DATA_HOME and CODEX_HOME. @param {string} home @param {Env} env */
export function pathsOf(home, env) {
  const dataDir = (env.XDG_DATA_HOME || home + '/.local/share') + '/' + NAME;
  const codex = env.CODEX_HOME || home + '/.codex';
  return {
    dataDir,
    hookDest: dataDir + '/hitl-escalation-guard.sh', // removed (ADR-0013, 2026-10-05); retired below
    hookConfDest: dataDir + '/hitl.conf', // removed (ADR-0013, 2026-10-05); retired below
    restartDest: dataDir + '/restart_guard.py', // removed (ADR-0028); retired below
    glassDest: dataDir + '/breaking_glass.py', // removed (ADR-0028); retired below
    glasscmdDest: home + '/.claude/commands/breaking-glass.md', // removed (ADR-0028); retired below
    settings: home + '/.claude/settings.json',
    clipDest: dataDir + '/clipboard_guard.py', // the Python hook core, removed (#488); retired below
    clipConfDest: dataDir + '/clipboard.conf',
    wrapDest: dataDir + '/paste_wrapper.py', // the Python wrapper, removed (#487); retired below
    snippetDest: dataDir + '/paste-filter.sh',
    clipPlist: home + '/Library/LaunchAgents/' + CLIP_LABEL + '.plist',
    codexRules: codex + '/rules/workstation-deny-floor.rules',
    codexHooks: codex + '/hooks.json',
    // Kiro CLI V3's user-level hook file (Issue #455); the name is KIRO_HOOK_FILE in paste-wrapper.js.
    kiroHook: home + '/.kiro/hooks/' + NAME + '-paste-filter.json',
    claudeBrief: home + '/.claude/CLAUDE.md',
    codexBrief: codex + '/AGENTS.md',
    kiroBrief: home + '/.kiro/steering/workstation-global-brief.md',
    allowCodexRules: codex + '/rules/workstation-allow-list.rules',
    allowCodexProfile: codex + '/workstation.config.toml',
    allowKiroAgent: home + '/.kiro/agents/workstation.json',
  };
}

/**
 * The command line, as install.sh read it. A usage error is [2, message]; --help is [0, USAGE].
 * @param {string[]} argv @param {Env} env @param {string} repoRoot
 * @returns {{ mode: string, hooksMode: string, methodOptin: boolean, overlay: string, managedRoot: string, shellRc: string } | [number, string]}
 */
export function parseArgs(argv, env, repoRoot) {
  let mode = 'install';
  let hooksMode = 'user';
  let methodOptin = false;
  let overlay = repoRoot + '/overlay';
  if (env.WORKSTATION_OVERLAY !== undefined) overlay = env.WORKSTATION_OVERLAY === 'none' ? '' : env.WORKSTATION_OVERLAY;
  let managedRoot = '';
  let shellRc = '';
  for (const arg of argv) {
    if (arg.startsWith('--managed-root=')) managedRoot = arg.slice('--managed-root='.length);
    else if (arg === '--dry-run') mode = 'dry-run';
    else if (arg === '--check') mode = 'check';
    else if (arg === '--uninstall') mode = 'uninstall';
    else if (arg === '--hooks=user') hooksMode = 'user';
    else if (arg === '--hooks=managed') hooksMode = 'managed';
    else if (arg === '--method') methodOptin = true;
    else if (arg === '--overlay=none') overlay = '';
    else if (arg.startsWith('--overlay=')) overlay = arg.slice('--overlay='.length);
    else if (arg === '--shell-rc=none') shellRc = 'none';
    else if (arg.startsWith('--shell-rc=') && arg.length > '--shell-rc='.length) shellRc = arg.slice('--shell-rc='.length);
    else if (arg === '-h' || arg === '--help') return [0, USAGE];
    else return [2, 'unknown argument: ' + arg];
  }
  if (shellRc !== '' && shellRc !== 'none' && !shellRc.startsWith('/')) return [2, '--shell-rc needs an absolute path, got: ' + shellRc];
  return { mode, hooksMode, methodOptin, overlay, managedRoot, shellRc };
}

/** current_version of .bumpversion.toml (every matching line, as sed -n ...p prints them), or ''. @param {string} root */
function readVersion(root) {
  const raw = readBytes(path.join(root, '.bumpversion.toml'));
  if (raw === null) return '';
  return raw.toString('utf8').split('\n')
    .map((l) => /^current_version[ \t\n\v\f\r]*=[ \t\n\v\f\r]*"([0-9][0-9.]*)".*/.exec(l)).filter((m) => m)
    .map((m) => /** @type {RegExpExecArray} */ (m)[1]).join('\n');
}

/**
 * Everything before the first target: the sources, the profile, the stamp, the brief, the floor, the
 * allow-list parse and the paste filter's command. Returns the context, or the exit code it stopped with.
 * @param {string[]} argv @param {Env} env @param {Io} io @param {string} [repoRoot]
 * @returns {Ctx | number}
 */
export function prepare(argv, env, io, repoRoot = ROOT) {
  const scriptDir = repoRoot + '/global';
  const a = parseArgs(argv, env, repoRoot);
  if (Array.isArray(a)) {
    if (a[0] === 0) io.out(a[1]);
    else io.err(a[1] + '\n');
    return a[0];
  }
  const home = env.HOME;
  if (home === undefined) {
    io.err('mhw install-user: HOME is not set\n');
    return 2;
  }
  const src = scriptDir + '/AGENTS.md';
  const floorSrc = scriptDir + '/deny-floor.conf';
  const clipConfSrc = scriptDir + '/clipboard.conf';
  for (const f of [src, floorSrc, clipConfSrc]) {
    if (!isFile(f)) {
      io.err('source not found: ' + f + '\n');
      return 2;
    }
  }
  const { overlay } = a;
  if (overlay && !isDir(overlay)) {
    io.err('overlay directory not found: ' + overlay + '\n');
    return 2;
  }
  // Structured profiles must be compiled and current before any target is written (ADR-0018). The compiler
  // is `mhw profile check` (#479): the node that runs mhw (MHW_NODE), else node on PATH, by absolute path.
  if (a.mode !== 'uninstall' && overlay && isFile(overlay + '/profile.json')) {
    let profileNode = env.MHW_NODE || '';
    if (!profileNode.startsWith('/')) profileNode = onPath('node', env) || '';
    if (!profileNode.startsWith('/')) {
      io.err('profile overlay requires node (26 or later); no target was written\n');
      return 2;
    }
    const r = runAbsolute(profileNode, [scriptDir + '/../bin/mhw.js', 'profile', 'check', '--source', 'profile.json', '--output', '.'],
      { env, stdio: 'inherit', cwd: overlay });
    if (r.error) io.err('mhw: ' + profileNode + ' did not start: ' + r.error.message + '\n');
    if (r.code !== 0) return r.code;
  }
  const paths = pathsOf(home, env);
  const version = readVersion(repoRoot);
  if (!version) {
    io.err('cannot read current_version from .bumpversion.toml\n');
    return 2;
  }
  const stamp = deriveStamp(repoRoot, version, env);
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-install-'));
  /** @type {Ctx} */
  const ctx = /** @type {Ctx} */ (/** @type {unknown} */ ({
    env, io, home, ...a, scriptDir, repoRoot, dataDir: paths.dataDir, stamp, work, status: 0, paths,
    cmd: env.MHW_CMD || './mhw', mergeRefused: false, codexFloorRefused: false, kiroFloorRefused: false,
    processRefused: false,
  }));
  try {
    const code = prepareTargets(ctx, src, floorSrc, clipConfSrc);
    if (code !== null) {
      cleanup(ctx);
      return code;
    }
  } catch (e) {
    cleanup(ctx);
    throw e;
  }
  return ctx;
}

/**
 * The brief, the floor, the allow-list parse, the clipboard settings and the paste filter's command.
 * @param {Ctx} ctx @param {string} src @param {string} floorSrc @param {string} clipConfSrc
 * @returns {number | null} the exit code it stopped with, or null
 */
function prepareTargets(ctx, src, floorSrc, clipConfSrc) {
  const { env, overlay } = ctx;
  const hasOverlayFile = (/** @type {string} */ f) => Boolean(overlay) && isFile(overlay + '/' + f);
  // The brief: the generic source, then the overlay's fragment when there is one.
  ctx.brief = Buffer.concat([fs.readFileSync(src), ...(hasOverlayFile('AGENTS.md') ? [fs.readFileSync(overlay + '/AGENTS.md')] : [])]);
  ctx.briefSha = sha256(ctx.brief);
  ctx.briefFrom = hasOverlayFile('AGENTS.md') ? 'global/AGENTS.md + overlay' : 'global/AGENTS.md';
  // The deny floor: generic entries, then the overlay's (ADR-0016).
  const floorOverlay = hasOverlayFile('deny-floor.conf');
  const floorBytes = Buffer.concat([fs.readFileSync(floorSrc), ...(floorOverlay ? [fs.readFileSync(overlay + '/deny-floor.conf')] : [])]);
  ctx.floorFrom = floorOverlay ? 'global/deny-floor.conf + overlay' : 'global/deny-floor.conf';
  ctx.floor = path.join(ctx.work, 'deny-floor.conf');
  fs.writeFileSync(ctx.floor, floorBytes);
  const floor = parseFloor(floorBytes.toString('latin1'));
  ctx.floorClaude = path.join(ctx.work, 'floor.claude');
  ctx.floorCodex = path.join(ctx.work, 'floor.codex');
  const lines = (/** @type {string[]} */ l) => Buffer.from(l.map((x) => x + '\n').join(''), 'latin1');
  fs.writeFileSync(ctx.floorClaude, lines(floor.claude));
  fs.writeFileSync(ctx.floorCodex, lines(floor.codex));
  ctx.floorCodexWords = floor.codex;
  if (floor.errors.length) {
    ctx.io.err(Buffer.from(floor.errors.map((x) => x + '\n').join(''), 'latin1'));
    return 2;
  }

  // The allow list (Issue #83, ADR-0031): parsed and checked against the floor before anything is written,
  // by src/render/allow-list.js (#490). An absolute MHW_NODE that is not an executable file is refused, never
  // replaced by another node; the node must answer as node (PR #519 lens A1). Without one the list is neither
  // checked nor rendered, and the settings merge, the floor report and the start-up block are not run either.
  const allow = nodeLookup(env);
  ctx.allowNode = allow.node;
  ctx.allowWhy = '';
  if (allow.refused) ctx.allowWhy = 'REFUSE  the allow list: MHW_NODE (' + env.MHW_NODE + ') is not an executable file; nothing written';
  else if (!allow.node) ctx.allowWhy = 'SKIP    the allow list: node (26 or later) is required';
  else if (!answersAsNode(allow.node, env)) ctx.allowWhy = 'REFUSE  the allow list: ' + allow.node + ' did not run as node; nothing written';
  if (!ctx.allowWhy) ctx.settingsWhy = '';
  else if (allow.refused) ctx.settingsWhy = 'MHW_NODE (' + env.MHW_NODE + ') is not an executable file';
  else if (ctx.allowWhy.includes('did not run as node')) ctx.settingsWhy = allow.node + ' did not run as node';
  else ctx.settingsWhy = 'node (26 or later) is required';
  if (!ctx.allowWhy) {
    const code = runNode(ctx, /** @type {string} */ (ctx.allowNode), [ctx.scriptDir + '/../src/render/allow-list.js', '--phase=parse',
      '--source=' + ctx.scriptDir + '/allow-list.conf', '--overlay=' + overlay, '--floor-codex=' + ctx.floorCodex]);
    if (code !== 0) return 2;
  }

  // The clipboard guard's settings: generic defaults, then the overlay's (last value of a key wins).
  ctx.clipConf = Buffer.concat([fs.readFileSync(clipConfSrc), ...(hasOverlayFile('clipboard.conf') ? [fs.readFileSync(overlay + '/clipboard.conf')] : [])]);

  // The paste wrapper's and the prompt hook's node (#487, #488): MHW_NODE (an absolute path), else the first
  // node on PATH. MHW_NODE is process.execPath, the resolved, versioned path, so node on PATH is rendered when
  // it is the same file (ADR-0017, PR #516 lens A1). An absolute MHW_NODE that is not an executable file is
  // refused, never replaced by another node.
  const given = env.MHW_NODE || '';
  const pathNode = onPath('node', env) || '';
  ctx.wrapRefused = false;
  if (given.startsWith('/')) {
    if (!executableFile(given)) {
      ctx.wrapRefused = true;
      ctx.wrapNode = '';
    } else {
      ctx.wrapNode = given;
      if (pathNode.startsWith('/')) {
        // The same file: node itself compares the two resolved paths.
        const r = runAbsolute(given, ['-e', 'const f = require("node:fs"); process.exit(f.realpathSync(process.argv[1]) === f.realpathSync(process.argv[2]) ? 0 : 1)',
          pathNode, given], { env });
        if (r.code === 0 && !r.error) ctx.wrapNode = pathNode;
      }
    }
  } else ctx.wrapNode = pathNode;
  ctx.wrapMhw = ctx.repoRoot + '/bin/mhw.js';
  const p = ctx.paths;
  ctx.pasteOk = true;
  // A single quote too: the hook command is a /bin/sh -c '...' (#488).
  if (/["\\$`']/.test(p.clipDest + p.clipConfDest + p.wrapDest + ctx.wrapNode + ctx.wrapMhw)) {
    ctx.pasteOk = false;
    warn(ctx, 'REFUSE  paste filter: the data directory, node or package path holds a quote (single or double), backslash, dollar sign or backtick');
  } else if (!ctx.wrapNode.startsWith('/')) {
    ctx.pasteOk = false;
    if (ctx.wrapRefused) warn(ctx, 'REFUSE  paste filter: MHW_NODE (' + given + ') is not an executable file; the hook is not registered');
    else warn(ctx, 'REFUSE  paste filter: node (26 or later) not found; the hook is not registered');
  }
  if (ctx.pasteOk && !executableFile('/usr/bin/env')) {
    ctx.pasteOk = false;
    warn(ctx, 'REFUSE  paste filter: /usr/bin/env not found; the hook is not registered');
  }
  ctx.startupBody = '[ -r "' + p.snippetDest + '" ] && . "' + p.snippetDest + '"';
  return null;
}

/** @param {Ctx} ctx */
function cleanup(ctx) {
  fs.rmSync(ctx.work, { recursive: true, force: true });
}

// ------------------------------------------------------------------------------------------- the managed files

/**
 * One managed file's bytes.
 * @param {Ctx} ctx @param {string} kind plain|kiro|codexrules|clipconf|snippet|codexhooks|kirohook
 * @returns {Buffer}
 */
export function render(ctx, kind) {
  const { stamp } = ctx;
  if (kind === 'plain' || kind === 'kiro') {
    const head = (kind === 'kiro' ? '---\ninclusion: always\n---\n' : '')
      + '<!-- ' + MARKER_ID + '; source: ' + ctx.briefFrom + '; ' + stamp + '; sha256: ' + ctx.briefSha + '; do not edit, re-run the installer -->\n\n';
    return Buffer.concat([Buffer.from(head, 'utf8'), ctx.brief]);
  }
  if (kind === 'codexrules') {
    const head = '# ' + MARKER_ID + '; source: ' + ctx.floorFrom + '; ' + stamp + '; do not edit, re-run the installer\n'
      + '# The workstation deny floor (ADR-0016). A prefix rule matches the command words from the\n'
      + '# program name on; another spelling, a wrapper or a script is not matched.\n';
    const rules = ctx.floorCodexWords.map((w) => 'prefix_rule(pattern=[' + w.split(/[ \t]+/).filter(Boolean).map((t) => '"' + t + '"').join(', ')
      + '], decision="forbidden")\n').join('');
    return Buffer.concat([Buffer.from(head, 'utf8'), Buffer.from(rules, 'latin1')]);
  }
  if (kind === 'clipconf') {
    return Buffer.concat([Buffer.from('# ' + MARKER_ID + '; source: global/clipboard.conf + overlay; ' + stamp + '; do not edit, re-run the installer\n', 'utf8'), ctx.clipConf]);
  }
  const conf = ctx.paths.clipConfDest;
  if (kind === 'snippet') {
    // Shell functions for zsh and bash. Sourcing this file is the owner's act; nothing here runs it.
    let s = '# ' + MARKER_ID + '; source: global/install.sh (paste wrapper, ADR-0011); ' + stamp + '; do not edit, re-run the installer\n'
      + '# The paste filter at the harness-CLI paste boundary (ADR-0011). install.sh sources it from a\n'
      + '# managed block in your shell start-up file (~/.zshrc, or ~/.bashrc and on macOS ~/.bash_profile;\n'
      + '# Issue #145), which reads:\n'
      + '#   ' + ctx.startupBody + '\n'
      + '# Then claude, codex and kiro-cli run through the wrapper, which cleans bracketed pastes before the\n'
      + '# CLI sees them and marks the session (PMHWC_PASTE_WRAPPER=1), so the prompt hook lets its prompts\n'
      + '# through. "command claude" (or codex, kiro-cli) runs a CLI without it, and the hook then checks.\n';
    for (const cli of ['claude', 'codex', 'kiro-cli']) {
      s += cli + '() { "' + ctx.wrapNode + '" "' + ctx.wrapMhw + '" paste-wrapper run --config "' + conf + '" -- ' + cli + ' "$@"; }\n';
    }
    return Buffer.from(s, 'utf8');
  }
  if (kind === 'codexhooks') {
    // The marker and the provenance stamp sit in the file's "description" (documented as metadata that does
    // not change which hooks run). Measured on Codex 0.160.0 (Issue #66): changing "description" leaves the
    // hook's currentHash unchanged, so a new stamp does not ask for re-trust.
    return Buffer.from('{\n  "description": "' + MARKER_ID + '; source: global/install.sh (paste filter, ADR-0011); ' + stamp + '; do not edit, re-run the installer",\n'
      + '  "hooks": {\n    "UserPromptSubmit": [\n      {\n        "hooks": [\n'
      + '          {"type": "command", "command": "' + jsonBody(pasteCmd('codex', ctx.wrapNode, ctx.wrapMhw, conf)) + '", "timeout": 30}\n'
      + '        ]\n      }\n    ]\n  }\n}\n', 'utf8');
  }
  if (kind === 'kirohook') {
    // Kiro CLI V3's hook file format, read from the bundle (kas 2.35.2). The marker and the stamp sit in
    // "description" and land on line 5, inside is_managed's first five lines.
    return Buffer.from('{\n  "version": "v1",\n  "hooks": [\n    {\n'
      + '      "description": "' + MARKER_ID + '; source: global/install.sh (paste filter, ADR-0033); ' + stamp + '; do not edit, re-run the installer",\n'
      + '      "name": "paste filter (' + NAME + ')",\n'
      + '      "trigger": "UserPromptSubmit",\n'
      + '      "action": {"type": "command", "command": "' + jsonBody(pasteCmd('kiro', ctx.wrapNode, ctx.wrapMhw, conf)) + '"},\n'
      + '      "timeout": 30\n    }\n  ]\n}\n', 'utf8');
  }
  throw new Error('unknown kind ' + kind);
}

/**
 * The backup of a file install replaces, owner-only from its first byte (src/lib/private-copy.js).
 * @param {Ctx} ctx @param {string} src @param {string} dst
 */
function backup(ctx, src, dst) {
  rmF(dst);
  if (exists(dst) || isLink(dst)) {
    warn(ctx, 'REFUSE  ' + dst + ': something is still there after the unlink; no backup written');
    return false;
  }
  try {
    privateCopy(src, dst);
  } catch {
    warn(ctx, 'REFUSE  ' + dst + ': the backup could not be created exclusively; no backup written');
    return false;
  }
  if (!isFile(dst) || isLink(dst)) {
    warn(ctx, 'REFUSE  ' + dst + ': not a regular file after the copy');
    return false;
  }
  return true;
}

/**
 * One managed target in the run's mode: OK, STAMP, DRIFT, MISSING, WOULD WRITE, WROTE or RESTAMPED; an
 * unmanaged file in the way is refused (exit 3) and sets processRefused.
 * @param {Ctx} ctx @param {string} kind @param {string} dest @param {boolean} [keepBackup] install keeps the
 *   file it replaces as <dest>.pmhwc-backup, 0600
 */
export function processTarget(ctx, kind, dest, keepBackup = false) {
  ctx.processRefused = false;
  const data = render(ctx, kind);
  if (exists(dest) && !isManaged(dest)) {
    warn(ctx, 'REFUSE  ' + dest + ': exists and is NOT managed by this project; move it aside or merge it by hand');
    ctx.processRefused = true;
    raise(ctx, 3);
    return;
  }
  let restamp = false;
  if (exists(dest) && same(data, dest)) {
    if (stampOf(dest) === ctx.stamp) {
      say(ctx, 'OK      ' + dest + ' (' + ctx.stamp + ')');
      return;
    }
    restamp = true;
  }
  if (ctx.mode === 'check') {
    if (restamp) say(ctx, 'STAMP   ' + dest + ': content matches, but it carries (' + stampOf(dest) + ') and the source is (' + ctx.stamp + ')');
    else if (exists(dest)) say(ctx, 'DRIFT   ' + dest + ' (' + stampOf(dest) + ')');
    else say(ctx, 'MISSING ' + dest);
    raise(ctx, 1);
  } else if (ctx.mode === 'dry-run') {
    say(ctx, 'WOULD WRITE ' + dest + ' (' + data.length + ' bytes):');
    say(ctx, '----- begin ' + dest);
    ctx.io.out(data);
    say(ctx, '----- end ' + dest);
  } else if (ctx.mode === 'install') {
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
    } catch (e) {
      warn(ctx, 'mkdir: ' + path.dirname(dest) + ': ' + (e instanceof Error ? e.message : String(e)));
      throw new Exit(1);
    }
    let kept = '';
    if (keepBackup && !restamp && isFile(dest)) { // a restamp changes no content
      if (!backup(ctx, dest, dest + '.pmhwc-backup')) {
        raise(ctx, 3);
        return;
      }
      kept = ' (previous version kept as ' + dest + '.pmhwc-backup)';
    }
    const tmp = dest + '.new.' + process.pid;
    try {
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, dest);
    } catch (e) {
      rmF(tmp);
      warn(ctx, 'REFUSE  ' + dest + ': could not be written (' + (e instanceof Error ? e.message : String(e)) + ')');
      throw new Exit(1);
    }
    say(ctx, (restamp ? 'RESTAMPED ' : 'WROTE   ') + dest + ' (' + ctx.stamp + ')' + kept);
  }
}

/**
 * A managed file this mode no longer wants: STALE (check), WOULD REMOVE (dry run), REMOVED (install);
 * one that is not ours is left alone, with a NOTE.
 * @param {Ctx} ctx @param {string} file @param {string} what
 */
export function retire(ctx, file, what) {
  if (isFile(file) && isManaged(file)) {
    if (ctx.mode === 'check') {
      say(ctx, 'STALE   ' + file + ': ' + what + '; install removes it');
      raise(ctx, 1);
    } else if (ctx.mode === 'dry-run') say(ctx, 'WOULD REMOVE ' + file + ' (' + what + ')');
    else if (ctx.mode === 'install') {
      rmF(file);
      say(ctx, 'REMOVED ' + file + ' (' + what + ')');
    }
  } else if (exists(file) || isLink(file)) say(ctx, 'NOTE    ' + file + ' exists and is NOT managed by this project; left alone');
}

/** rm -f dir/*.json: every regular name ending in .json, not starting with a dot. @param {string} dir */
function removeJson(dir) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const n of names) if (n.endsWith('.json') && !n.startsWith('.')) rmF(path.join(dir, n));
}

// ------------------------------------------------------------------------------------------- the steps

/**
 * $SHELL as install.sh saw it. Unset, /bin/sh on macOS (bash) set it to the user's login shell, and on
 * Linux (dash) left it unset; both are kept, so a run without SHELL picks the same start-up file as before.
 * @param {Env} env
 */
export function shellOf(env) {
  if (env.SHELL !== undefined) return env.SHELL;
  if (process.platform !== 'darwin') return '';
  try {
    return os.userInfo().shell || '';
  } catch {
    return '';
  }
}

/**
 * The shell start-up block that activates the paste wrapper (Issue #145): src/render/shell-rc.js (#492),
 * run by the node the settings merge runs. Its exit code: 1 is drift under --check only (elsewhere node's own
 * exit for an uncaught exception, so a refusal), 3 a refused file, 4 a write that failed, which stops the run.
 * @param {Ctx} ctx
 */
export function startupStep(ctx) {
  if (ctx.settingsWhy) {
    say(ctx, 'REFUSE  the shell start-up block: ' + ctx.settingsWhy + '; no start-up file changed');
    raise(ctx, 2);
    return;
  }
  const rc = runNode(ctx, /** @type {string} */ (ctx.allowNode), [ctx.scriptDir + '/../src/render/shell-rc.js', '--mode=' + ctx.mode,
    '--shell-rc=' + ctx.shellRc, '--shell=' + shellOf(ctx.env), '--snippet=' + ctx.paths.snippetDest,
    '--data-dir=' + ctx.dataDir, '--uname=' + (ctx.uname || os.type())]);
  if (rc === 0) return;
  if (ctx.mode === 'check' && rc === 1) raise(ctx, 1);
  else if (rc === 4) throw new Exit(1);
  else if (rc === 1) raise(ctx, 3);
  else raise(ctx, rc);
}

/**
 * Merge the paste filter's UserPromptSubmit entry and the deny floor into ~/.claude/settings.json:
 * src/render/settings-merge.js (#491). Without the paste filter, or under --hooks=managed (ADR-0025), its
 * entry is removed instead. Any refusal (and any exit but 0 outside --check, where 1 is drift) sets
 * mergeRefused, so the allow step writes no allow list; a backup or write that fails stops the run.
 * @param {Ctx} ctx
 */
export function mergeSettings(ctx) {
  const settings = ctx.paths.settings;
  if (ctx.settingsWhy) {
    warn(ctx, 'REFUSE  ' + settings + ': ' + ctx.settingsWhy + ' to merge the hook entry and the deny floor; left untouched');
    ctx.mergeRefused = true;
    raise(ctx, 2);
    return;
  }
  const args = [ctx.scriptDir + '/../src/render/settings-merge.js', '--phase=merge', '--mode=' + ctx.mode, '--settings=' + settings,
    '--floor-claude=' + ctx.floorClaude, '--stamp=' + ctx.stamp];
  if (ctx.pasteOk && ctx.hooksMode !== 'managed') args.push('--paste-cmd=' + pasteCmd('claude', ctx.wrapNode, ctx.wrapMhw, ctx.paths.clipConfDest));
  const rc = runNode(ctx, /** @type {string} */ (ctx.allowNode), args);
  if (rc === 0) return;
  if (ctx.mode === 'check' && rc === 1) raise(ctx, 1);
  else if (rc === 4) throw new Exit(1);
  else {
    ctx.mergeRefused = true;
    raise(ctx, rc);
  }
}

/**
 * Uninstall (Issue #67): every file of ours goes, wherever a hooks mode put it; a file without the marker is
 * never touched. In the settings file only our hook entries, the deny-floor rules recorded as ours and the
 * stamp key are removed (src/render/settings-merge.js --phase=uninstall).
 * @param {Ctx} ctx
 */
export function uninstallUser(ctx) {
  const p = ctx.paths;
  for (const dest of [p.claudeBrief, p.codexBrief, p.kiroBrief, p.hookDest, p.hookConfDest, p.codexRules, p.clipDest, p.clipConfDest,
    p.codexHooks, p.kiroHook, p.wrapDest, p.snippetDest, p.restartDest, p.glassDest, p.glasscmdDest, p.clipPlist]) {
    if (isFile(dest) && isManaged(dest)) {
      rmF(dest);
      say(ctx, 'REMOVED ' + dest);
    } else if (exists(dest) || isLink(dest)) say(ctx, 'NOTE    ' + dest + ' exists and is NOT managed by this project; left alone');
  }
  const state = ctx.dataDir + '/restart-state';
  if (isDir(state) && !isLink(state)) {
    removeJson(state);
    if (rmdir(state)) say(ctx, 'REMOVED ' + state);
  }
  if (rmdir(ctx.dataDir)) say(ctx, 'REMOVED ' + ctx.dataDir + ' (empty)');
  if (isFile(p.kiroHook + '.pmhwc-backup')) {
    say(ctx, 'NOTE    ' + p.kiroHook + '.pmhwc-backup kept (a 0600 copy of a hook file install replaced; Kiro does not load it)');
  }
  if (!exists(p.settings)) {
    say(ctx, 'ABSENT  ' + p.settings);
    return;
  }
  if (ctx.settingsWhy) {
    warn(ctx, 'REFUSE  ' + p.settings + ': ' + ctx.settingsWhy + ' to remove our entries; left untouched');
    raise(ctx, 2);
    return;
  }
  const rc = runNode(ctx, /** @type {string} */ (ctx.allowNode), [ctx.scriptDir + '/../src/render/settings-merge.js', '--phase=uninstall',
    '--settings=' + p.settings, '--floor-claude=' + ctx.floorClaude]);
  if (rc === 4) throw new Exit(1);
  raise(ctx, rc);
}

/**
 * A step run by the node lookup of models_step: an absolute MHW_NODE that is not an executable file is
 * refused (REFUSE, exit 2), no node is a SKIP (exit 2), else the node.
 * @param {Ctx} ctx @param {string} what @param {string} skip
 * @returns {string | null}
 */
function stepNode(ctx, what, skip) {
  const l = nodeLookup(ctx.env);
  if (l.refused) {
    say(ctx, 'REFUSE  ' + what + ': MHW_NODE (' + ctx.env.MHW_NODE + ') is not an executable file; nothing written');
    raise(ctx, 2);
    return null;
  }
  if (!l.node) {
    say(ctx, 'SKIP    ' + skip);
    raise(ctx, 2);
    return null;
  }
  return l.node;
}

/**
 * The working method (Issue #61, ADR-0032): src/render/method.js (#489), with this run's mode and stamp.
 * @param {Ctx} ctx
 */
export function methodStep(ctx) {
  const node = stepNode(ctx, 'the working method (method/)', 'the working method (method/): node (26 or later) is required to render it');
  if (!node) return;
  const args = [ctx.scriptDir + '/../src/render/method.js', '--mode=' + ctx.mode, '--stamp=' + ctx.stamp];
  if (ctx.methodOptin) args.push('--opt-in');
  raise(ctx, runNode(ctx, node, args));
}

/**
 * The session-start default model and reasoning effort per agent harness (ADR-0007, ADR-0035), from the
 * overlay's model-defaults.json: src/render/model-defaults.js (#481).
 * @param {Ctx} ctx
 */
export function modelsStep(ctx) {
  const node = stepNode(ctx, 'the session-start model defaults', 'the session-start model defaults: node (26 or later) is required');
  if (!node) return;
  const policy = ctx.overlay && isFile(ctx.overlay + '/model-defaults.json') ? ctx.overlay + '/model-defaults.json' : 'none';
  raise(ctx, runNode(ctx, node, [ctx.scriptDir + '/../src/render/model-defaults.js', '--mode=' + ctx.mode, '--stamp=' + ctx.stamp, '--policy=' + policy]));
}

/**
 * The deny floor for Kiro IDE and Kiro CLI V3 (ADR-0036, Issue #144): src/render/kiro-permissions.js (#482).
 * The Kiro allow agent is not written beside a floor that was not (#491): any exit but 0, outside --check.
 * @param {Ctx} ctx
 */
export function kiroStep(ctx) {
  ctx.kiroFloorRefused = true; // until the renderer says otherwise
  const node = stepNode(ctx, 'the Kiro deny floor', 'the Kiro deny floor: node (26 or later) is required');
  if (!node) return;
  const rc = runNode(ctx, node, [ctx.scriptDir + '/../src/render/kiro-permissions.js', '--mode=' + ctx.mode, '--stamp=' + ctx.stamp,
    '--floor=' + ctx.floor, '--floor-from=' + ctx.floorFrom]);
  raise(ctx, rc);
  if (rc === 0 || ctx.mode === 'check') ctx.kiroFloorRefused = false;
}

/**
 * The policy MCP servers (ADR-0038, Issue #174) and the MCP active set (Issue #219, ADR-0041):
 * src/render/mcp.js --policy, then --active (#484, #485).
 * @param {Ctx} ctx
 */
export function mcpStep(ctx) {
  const node = stepNode(ctx, 'the MCP servers', 'the policy MCP servers and the MCP active set: node (26 or later) is required');
  if (!node) return;
  for (const which of ['--policy', '--active']) {
    raise(ctx, runNode(ctx, node, [ctx.scriptDir + '/../src/render/mcp.js', which, '--mode=' + ctx.mode, '--stamp=' + ctx.stamp]));
  }
}

/**
 * Chrome's remote-debugging toggle (Issue #224, ADR-0038 amendment): `mhw chrome-debugging` (#480). Its node:
 * MHW_NODE when it is an executable file, else node on PATH.
 * @param {Ctx} ctx
 */
export function chromeStep(ctx) {
  const given = ctx.env.MHW_NODE || '';
  let node = given.startsWith('/') && executableFile(given) ? given : '';
  if (!node) node = onPath('node', ctx.env) || '';
  if (!node) {
    say(ctx, 'SKIP    Chrome remote debugging: node 26 or later is required');
    raise(ctx, 2);
    return;
  }
  raise(ctx, runNode(ctx, node, [ctx.scriptDir + '/../bin/mhw.js', 'chrome-debugging', '--mode=' + ctx.mode]));
}

/**
 * The allow-list step (ADR-0031): Claude Code permissions.allow and defaultMode, the Codex rules and profile,
 * and the Kiro agent (src/render/allow-list.js). An allow list never lands without the deny floor beside it.
 * @param {Ctx} ctx
 */
export function allowStep(ctx) {
  if (ctx.allowWhy) {
    say(ctx, ctx.allowWhy);
    raise(ctx, 2);
    return;
  }
  if (ctx.mergeRefused && ctx.mode !== 'check') {
    warn(ctx, 'REFUSE  the allow list: the deny floor was not merged into ' + ctx.paths.settings
      + ' (see above), and an allow list never lands without it; nothing written');
    raise(ctx, 2);
    return;
  }
  const refused = [];
  if (ctx.mode !== 'check') {
    if (ctx.codexFloorRefused) refused.push('codex');
    if (ctx.kiroFloorRefused) refused.push('kiro');
  }
  raise(ctx, runNode(ctx, /** @type {string} */ (ctx.allowNode), [ctx.scriptDir + '/../src/render/allow-list.js', '--phase=step',
    '--mode=' + ctx.mode, '--stamp=' + ctx.stamp, '--source=' + ctx.scriptDir + '/allow-list.conf', '--overlay=' + ctx.overlay,
    '--retired=' + ctx.scriptDir + '/allow-retired.conf', '--floor-codex=' + ctx.floorCodex, '--floor-claude=' + ctx.floorClaude,
    '--managed-root=' + (ctx.managedRoot || '/'), '--settings=' + ctx.paths.settings, '--home=' + ctx.home,
    '--codex-home=' + (ctx.env.CODEX_HOME || ''), '--repo-root=' + ctx.repoRoot, '--cmd=' + ctx.cmd, '--refused-floor=' + refused.join(',')]));
}

/**
 * Uninstall: only the allow rules and permission mode this installer added leave settings.json. Without a node
 * while something of ours is left, nothing is uninstalled at all: the deny floor must not leave from beside
 * our allow rules (PR #519 lens B1); a failed step stops the uninstall the same way (PR #519 lens A3).
 * @param {Ctx} ctx
 */
export function allowUninstall(ctx) {
  const p = ctx.paths;
  if (ctx.allowWhy) {
    const ownKey = (() => {
      const raw = isFile(p.settings) ? readBytes(p.settings) : null;
      return raw !== null && raw.toString('latin1').includes('"' + ALLOW_OWN_KEY + '"');
    })();
    const ours = (/** @type {string} */ f) => isFile(f) && isManaged(f);
    if (ownKey || ours(p.allowCodexRules) || ours(p.allowCodexProfile) || ours(p.allowKiroAgent)) {
      warn(ctx, ctx.allowWhy);
      warn(ctx, 'REFUSE  uninstall: the allow list this installer wrote cannot be removed without node, and the deny floor must not leave '
        + 'from beside it; nothing uninstalled. Re-run with node 26 or later on PATH (or MHW_NODE)');
      throw new Exit(2);
    }
    say(ctx, ctx.allowWhy);
    raise(ctx, 2);
    return;
  }
  const rc = runNode(ctx, /** @type {string} */ (ctx.allowNode), [ctx.scriptDir + '/../src/render/allow-list.js', '--phase=uninstall',
    '--settings=' + p.settings, '--home=' + ctx.home, '--codex-home=' + (ctx.env.CODEX_HOME || '')]);
  if (rc !== 0) {
    warn(ctx, 'REFUSE  uninstall: the allow-list step failed (exit ' + rc + '), and the deny floor must not leave from beside its allow rules; '
      + 'nothing else uninstalled. Fix ' + p.settings + ' (or move it aside) and re-run');
    throw new Exit(rc);
  }
}

/**
 * Which layer carries the deny floor (ADR-0016, 2026-10-05 amendment): src/render/floor-report.js (#491).
 * A report, never a status change beyond its own exit.
 * @param {Ctx} ctx
 */
export function reportFloor(ctx) {
  if (ctx.settingsWhy) {
    say(ctx, 'FLOOR   not reported: ' + ctx.settingsWhy);
    raise(ctx, 2);
    return;
  }
  raise(ctx, runNode(ctx, /** @type {string} */ (ctx.allowNode), [ctx.scriptDir + '/../src/render/floor-report.js', '--settings=' + ctx.paths.settings,
    '--floor-claude=' + ctx.floorClaude, '--floor-codex=' + ctx.floorCodex, '--floor=' + ctx.floor, '--floor-from=' + ctx.floorFrom,
    '--stamp=' + ctx.stamp, '--codex-rules=' + ctx.paths.codexRules, '--managed-root=' + ctx.managedRoot, '--cmd=' + ctx.cmd]));
}

/**
 * The removed restart guard's per-session baselines (ADR-0028): opaque aggregate hashes, one JSON file each.
 * @param {Ctx} ctx
 */
function restartState(ctx) {
  const state = ctx.dataDir + '/restart-state';
  if (isLink(state)) say(ctx, 'NOTE    ' + state + ' is a symbolic link; left alone');
  else if (isDir(state)) {
    if (ctx.mode === 'check') {
      say(ctx, 'STALE   ' + state + ": the removed restart guard's baselines; install removes them");
      raise(ctx, 1);
    } else if (ctx.mode === 'dry-run') say(ctx, 'WOULD REMOVE ' + state + " (the removed restart guard's baselines)");
    else {
      removeJson(state);
      if (rmdir(state)) say(ctx, 'REMOVED ' + state + " (the removed restart guard's baselines, ADR-0028)");
      else say(ctx, 'NOTE    ' + state + ' still holds files this project did not write; left alone');
    }
  }
}

/**
 * The term lists' salt is a 0600 file since #488. A list that holds hashes while no salt file exists was
 * hashed with the macOS Keychain salt of an earlier install; it is NOT migrated, and the owner re-adds the terms.
 * @param {Ctx} ctx
 */
function saltNotice(ctx) {
  const lo = ctx.dataDir + '/local-overlay';
  if (isFile(lo + '/clipboard-salt')) return;
  for (const list of ['clipboard-terms', 'clipboard-terms-health', 'clipboard-terms-colleague']) {
    const raw = isFile(lo + '/' + list) ? readBytes(lo + '/' + list) : null;
    if (raw !== null && raw.toString('latin1').split('\n').some((l) => /^[0-9a-f]{64}$/.test(l))) {
      say(ctx, 'SKIP    ' + lo + '/' + list + ': its hashes were made with the macOS Keychain salt, which mhw no longer reads (#488); '
        + 'nothing was migrated. Re-add each term with mhw add-term; until then term matching is off and every prompt says so');
    }
  }
}

/**
 * The paste filter's files: the Codex hooks (user mode only), the Kiro hook, the snippet and the start-up block.
 * @param {Ctx} ctx
 */
function pasteFiles(ctx) {
  const p = ctx.paths;
  if (!ctx.pasteOk) {
    raise(ctx, 2);
    say(ctx, 'SKIP    ' + p.codexHooks + ': the paste filter cannot run here (see the REFUSE line above)');
    say(ctx, 'SKIP    ' + p.kiroHook + ': the paste filter cannot run here either');
    say(ctx, 'SKIP    ' + p.wrapDest + ' and ' + p.snippetDest + ': the paste wrapper cannot run here either');
    return;
  }
  if (ctx.hooksMode === 'user') processTarget(ctx, 'codexhooks', p.codexHooks);
  else retire(ctx, p.codexHooks, 'the user-level Codex hooks, now registered in the admin layer (ADR-0025)');
  processTarget(ctx, 'kirohook', p.kiroHook, true);
  retire(ctx, p.wrapDest, 'the Python paste wrapper, replaced by mhw paste-wrapper (Node, #487)');
  // pasteOk holds only with an absolute wrap node, so the snippet and its start-up block always follow.
  processTarget(ctx, 'snippet', p.snippetDest);
  startupStep(ctx);
}

/**
 * The always-on clipboard watcher is withdrawn (ADR-0011): a LaunchAgent plist this project wrote earlier is
 * removed; launchctl is the owner's act, so its unload is printed.
 * @param {Ctx} ctx
 */
function plist(ctx) {
  const f = ctx.paths.clipPlist;
  if (!exists(f) && !isLink(f)) return;
  if (!(isFile(f) && isManaged(f))) {
    say(ctx, 'NOTE    ' + f + ' exists and is NOT managed by this project; left alone');
    return;
  }
  if (ctx.mode === 'check') {
    say(ctx, 'STALE   ' + f + ": the withdrawn clipboard watcher's LaunchAgent; install removes it");
    raise(ctx, 1);
  } else if (ctx.mode === 'dry-run') say(ctx, 'WOULD REMOVE ' + f + " (the withdrawn clipboard watcher's LaunchAgent)");
  else {
    rmF(f);
    say(ctx, 'REMOVED ' + f + " (the withdrawn clipboard watcher's LaunchAgent, ADR-0011)");
    say(ctx, 'NOTE    if the watcher is still loaded, unload it yourself (this installer never runs launchctl):');
    say(ctx, '        launchctl bootout gui/$(id -u)/' + CLIP_LABEL);
  }
}

/**
 * The run, in install.sh's order, after prepare(). Returns the exit code.
 * @param {Ctx} ctx
 */
export function run(ctx) {
  const p = ctx.paths;
  if (ctx.mode === 'uninstall') {
    allowUninstall(ctx);
    modelsStep(ctx);
    mcpStep(ctx);
    chromeStep(ctx);
    kiroStep(ctx);
    startupStep(ctx); // before uninstallUser, which removes the data directory once it is empty
    uninstallUser(ctx);
    methodStep(ctx);
    say(ctx, 'NOTE    the admin layer is not touched here; ' + ctx.cmd + ' uninstall prints its sudo line');
    return ctx.status;
  }
  say(ctx, 'SOURCE  ' + ctx.stamp);
  processTarget(ctx, 'plain', p.claudeBrief);
  processTarget(ctx, 'plain', p.codexBrief);
  processTarget(ctx, 'kiro', p.kiroBrief);
  retire(ctx, p.hookDest, 'the removed HITL picker guard (ADR-0013, 2026-10-05 amendment)');
  retire(ctx, p.hookConfDest, "the removed HITL picker guard's limits (ADR-0013, 2026-10-05 amendment)");
  retire(ctx, p.glassDest, 'the removed breaking-glass switch module (ADR-0028)');
  retire(ctx, p.glasscmdDest, 'the removed /breaking-glass command (ADR-0028)');
  retire(ctx, p.restartDest, 'the removed restart guard (ADR-0028)');
  restartState(ctx);
  processTarget(ctx, 'codexrules', p.codexRules);
  ctx.codexFloorRefused = ctx.processRefused; // the Codex allow list is not written beside a refused floor (#491)
  retire(ctx, p.clipDest, 'the Python prompt hook core, replaced by mhw hook prompt (Node, #488)');
  processTarget(ctx, 'clipconf', p.clipConfDest);
  saltNotice(ctx);
  pasteFiles(ctx);
  plist(ctx);
  mergeSettings(ctx);
  kiroStep(ctx);
  mcpStep(ctx);
  chromeStep(ctx);
  modelsStep(ctx);
  allowStep(ctx);
  methodStep(ctx);
  reportFloor(ctx);
  if (ctx.mode === 'install') {
    say(ctx, 'RESTART REQUIRED: open fresh Claude Code, Codex and Kiro sessions before further work; Codex hook trust remains an owner action in /hooks.');
  }
  return ctx.status;
}

/**
 * Run a prepared context's steps (or the whole run), cleaning the work directory whatever happens.
 * @param {Ctx} ctx @param {(ctx: Ctx) => number} [body]
 */
export function finish(ctx, body = run) {
  try {
    return body(ctx);
  } catch (e) {
    if (e instanceof Exit) return e.code;
    throw e;
  } finally {
    cleanup(ctx);
  }
}

/**
 * `mhw install-user [flags]`: the exit code.
 * @param {string[]} argv @param {Env} env @param {Io} [io]
 */
export function main(argv, env, io = STDIO) {
  const ctx = prepare(argv, env, io);
  if (typeof ctx === 'number') return ctx;
  return finish(ctx);
}
