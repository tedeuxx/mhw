// The provenance stamp derived from git (ADR-0029) and the deny floor's parser (ADR-0016), shared by the two
// user-layer installers: `mhw install-user` (macOS and Linux, #503) and `mhw install-windows` (Windows, #497).
// They lived in src/commands/install-user.js until #497 moved them here, so that neither installer imports
// the other. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { onPath } from './onpath.js';
import { runAbsolute } from './run.js';

/** @typedef {Record<string, string | undefined>} Env */

/** The bytes of a file, or null when it cannot be read. @param {string} p */
function readBytes(p) {
  try {
    return fs.readFileSync(p);
  } catch {
    return null;
  }
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
  const commit = inside && top !== null && samePath(top, real) ? run('rev-parse', '--verify', 'HEAD') : null;
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
    // \r?\n: git archive on a Windows checkout (core.autocrlf=true) writes this file with CRLF (#497).
    const lines = archive.toString('utf8').split(/\r?\n/);
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

/**
 * git's --show-toplevel against this tree's own path. On Windows (#497, as install.ps1 compared them) git
 * prints C:/x where the path reads C:\x, and the file system ignores case.
 * @param {string} top @param {string | null} real
 */
function samePath(top, real) {
  if (real === null) return false;
  if (process.platform !== 'win32') return top === real;
  return path.resolve(top).toLowerCase() === path.resolve(real).toLowerCase();
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
      // "Bash(<words>:*)" is the shape of a prefix rule: install-managed.sh would render it for Codex.
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
