// mhw rite-cadence [--repo DIR] <root> [marker] (#477, S06 of #470; the dater of #128): the Node form of
// method/scripts/rite-cadence.py, which this slice deletes. It dates a rite by the artifacts that prove
// it ran, not by its artifact root.
//
// Session check 3 of agents-configuration reports how long since each rite last ran. Dating the root
// (`git log -1 -- <root>`) also dates scaffolding: a README, or a report saying nothing was collected,
// reads as a run. So when a rite declares a ran-marker (for /funnel-review, FUNNEL-REVIEW-RAN), only
// files under the root whose committed content carries the marker as a whole line are dated.
//
// Prints one line and exits 0:
//     <root>: last ran <YYYY-MM-DD> (<short commit>), dated by files carrying <marker>
//     <root>: never landed a file carrying <marker>
//     <root>: last changed <YYYY-MM-DD> (<short commit>), no ran-marker declared
//     <root>: never changed
// Exits 1 when git fails (not a repository, no git, an object missing from the store) or HEAD names no
// readable commit (a dangling or malformed branch ref), so those failures do not read as "never"; only
// an unborn HEAD (a branch with no commit yet) reads as "never". Exits 2 on a usage error: an unknown
// option, an empty marker, or a root that is empty, absolute or outside the repository. A value
// beginning with '-' is an unknown option unless it follows `--`, where it is a literal path or marker.
//
// It reports and fires nothing. It is not a hook and nothing runs it but the session.
//
// No value given here reaches git's command line. git runs in the repository as its working directory;
// it lists the whole tree or the whole history, and the root is matched against git's own output here,
// as a literal path: the root itself or anything under it, by whole path components, so `docs/*` names
// a directory spelled with an asterisk and `docs/fr` does not reach `docs/frx`. The only paths handed
// back to git are paths git printed. The marker is never passed to git at all.
//
// With no marker, the root is dated as `git log -1 --format=%cs -- <root>` dated it: the committer date
// of the newest commit, in git log's own order and history simplification, that touched a path under
// the root, deletions included, by listing every path the history ever held under the root and asking
// that same log about exactly those paths. One difference: that command read the root as a pattern,
// and this reads it literally.
//
// With a marker, which files count: regular files under the root in the commit HEAD names whose HEAD
// blob carries the marker as a whole line (a CR ending a CRLF line is ignored). A symlink or a submodule
// is never a run; the working copy and the index play no part. Which commit dates them: the latest
// commit, by AUTHOR date, that in one of those files ADDS more whole-line marker lines than it removes.
// Author date is kept by a rebase, a cherry-pick and an amend. A later edit that leaves the marker line
// alone does not move the date, nor a commit that only removes it, nor one that rewrites it in place
// (a CRLF-to-LF normalisation, a reorder). A report that loses the marker and regains it is dated by the
// regain. Reports are diffed as text whatever their attributes say. Merge commits are not read, and
// renames are not followed. In a shallow clone, a marker added before the shallow boundary is dated by
// the boundary commit, which is too recent; nothing here detects that. Measured on git 2.52.0 first.
//
// Bytes: git's output is read as bytes (latin1, one char per byte) and compared with the root and the
// marker encoded as UTF-8, so a match is byte for byte as the Python original's was. A path git printed
// is handed back to git decoded as UTF-8; a path that is not valid UTF-8 cannot be (the original passed
// bytes), which is the one known difference, not exercised by a case.
//
// git is found on PATH and run by absolute path with no shell, as the original ran `git` from PATH.
// node: modules only. test/method/rite-cadence.test.js holds this against the original's golden
// transcripts (test/golden/S06/); intended differences are in test/golden/S06/expected-differences.json.
import path from 'node:path';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { onPath } from '../lib/onpath.js';
import { parse, helpText, usageText, terminalColumns } from '../lib/argparse.js';

const REGULAR_FILE_MODES = new Set(['100644', '100755']);

export class GitError extends Error {}
class UsageError extends Error {}

/**
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, platform?: string, terminal?: number,
 *   out: (s: string) => void, err: (s: string) => void }} Io
 *   terminal: stdout's columns when it is a terminal (argparse's width when COLUMNS is unset)
 * @typedef {{ cwd: string, exe: string, env: Record<string, string | undefined> }} Git
 */

/** latin1 <-> bytes: one char per byte, so a string compares byte for byte. @param {string} s */
const bytesOf = (s) => Buffer.from(s, 'utf8').toString('latin1');
/** A latin1 string (bytes) back to the text git would read on its command line. @param {string} b */
const textOf = (b) => Buffer.from(b, 'latin1').toString('utf8');

/**
 * Run git in g.cwd; its stdout as bytes (latin1). Every argument is a constant here or a path git
 * itself printed.
 * @param {Git} g
 * @param {string[]} args
 * @param {string} [data] stdin, as bytes (latin1)
 */
function git(g, args, data) {
  const p = spawnSync(g.exe, args, {
    cwd: g.cwd,
    env: g.env,
    input: data === undefined ? undefined : Buffer.from(data, 'latin1'),
    shell: false,
    windowsHide: true,
    maxBuffer: Infinity,
  });
  if (p.error) throw new GitError('rite-cadence: git could not run: ' + p.error.message);
  if (p.status !== 0) {
    const stderr = p.stderr ? p.stderr.toString('utf8').trim() : '';
    throw new GitError('rite-cadence: git ' + args[0] + ' failed: ' + stderr);
  }
  return p.stdout.toString('latin1');
}

/**
 * True when git's run succeeds; false on any git failure, as the original caught every GitError.
 * @param {Git} g
 * @param {string[]} args
 */
function gitOk(g, args) {
  try {
    git(g, args);
    return true;
  } catch (e) {
    if (e instanceof GitError) return false;
    throw e;
  }
}

/**
 * True when HEAD names a commit; false when HEAD is unborn (no commit yet). "No commit" needs two
 * signals: `rev-parse --verify HEAD` fails AND `symbolic-ref -q HEAD` still resolves HEAD to a branch.
 * A malformed branch ref fails both; a HEAD naming an object that is not a readable commit fails the
 * second rev-parse. Both are git failures, never "never".
 * @param {Git} g
 */
function headExists(g) {
  if (!gitOk(g, ['rev-parse', '--verify', '--quiet', 'HEAD'])) {
    if (!gitOk(g, ['symbolic-ref', '-q', 'HEAD'])) throw new GitError('rite-cadence: HEAD names no readable commit');
    return false;
  }
  if (!gitOk(g, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'])) throw new GitError('rite-cadence: HEAD names no readable commit');
  return true;
}

/**
 * True when the repository path is the root or lies under it, by whole path components.
 * @param {string} p
 * @param {string} root
 */
const under = (p, root) => root === '.' || p === root || p.startsWith(root + '/');

/**
 * The line without every trailing CR, as Python's rstrip(b"\r"); a loop, not a backtracking regex.
 * @param {string} line
 */
function stripCr(line) {
  let end = line.length;
  while (end > 0 && line[end - 1] === '\r') end -= 1;
  return line.slice(0, end);
}

/**
 * True when one line of the content is exactly the marker (CR of a CRLF line ignored).
 * @param {string} data
 * @param {string} marker
 */
const carries = (data, marker) => data.split('\n').some((line) => stripCr(line) === marker);

/**
 * [blob id, path] of every regular file under the root in the HEAD tree.
 * @param {Git} g
 * @param {string} root
 */
function regularFilesUnder(g, root) {
  /** @type {Array<[string, string]>} */
  const entries = [];
  for (const record of git(g, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD']).split('\0')) {
    const tab = record.indexOf('\t');
    const meta = tab < 0 ? record : record.slice(0, tab);
    const p = tab < 0 ? '' : record.slice(tab + 1);
    const fields = meta.split(' ');
    if (fields.length === 3 && REGULAR_FILE_MODES.has(fields[0]) && under(p, root)) entries.push([fields[2], p]);
  }
  return entries;
}

/**
 * The content of each blob, in order. A blob missing from the store is a git failure.
 * @param {Git} g
 * @param {string[]} oids
 */
function readBlobs(g, oids) {
  const out = git(g, ['cat-file', '--batch'], oids.map((oid) => oid + '\n').join(''));
  /** @type {string[]} */
  const bodies = [];
  let offset = 0;
  for (const oid of oids) {
    const headerEnd = out.indexOf('\n', offset);
    const fields = (headerEnd < 0 ? out.slice(offset) : out.slice(offset, headerEnd)).split(' ');
    if (headerEnd < 0 || fields.length !== 3) throw new GitError('rite-cadence: git cat-file could not read blob ' + oid);
    const size = Number.parseInt(fields[2], 10);
    bodies.push(out.slice(headerEnd + 1, headerEnd + 1 + size));
    offset = headerEnd + 1 + size + 1;
  }
  return bodies;
}

/**
 * Paths of the regular files under the root whose HEAD blob carries the marker as a whole line.
 * @param {Git} g
 * @param {string} root
 * @param {string} marker
 */
function committedWithMarker(g, root, marker) {
  if (!headExists(g)) return [];
  const entries = regularFilesUnder(g, root);
  if (!entries.length) return [];
  const bodies = readBlobs(g, entries.map(([oid]) => oid));
  return entries.filter((_, i) => carries(bodies[i], marker)).map(([, p]) => p);
}

/**
 * @typedef {{ stamp: number, date: string, commit: string }} Header
 */

/**
 * Each [commit, diff lines] of each file of each commit of a `log -p` output.
 * @param {string} out
 * @returns {Array<[Header, string[]]>}
 */
function fileDiffs(out) {
  /** @type {Array<[Header, string[]]>} */
  const found = [];
  /** @type {Header | null} */
  let commit = null;
  /** @type {string[]} */
  let lines = [];
  for (const line of out.split('\n')) {
    if (line.startsWith('\0') || line.startsWith('diff --git ')) {
      if (commit !== null) found.push([commit, lines]);
      lines = [];
      if (line.startsWith('\0')) {
        const [stamp, date, short] = textOf(line.slice(1)).split(' ');
        commit = { stamp: Number.parseInt(stamp, 10), date, commit: short };
      }
    } else {
      lines.push(line);
    }
  }
  if (commit !== null) found.push([commit, lines]);
  return found;
}

/**
 * Whole-line marker lines added minus those removed, in the hunks of one file's diff.
 * @param {string[]} lines
 * @param {string} marker
 */
function netMarkerLines(lines, marker) {
  let inHunk = false;
  let net = 0;
  for (const line of lines) {
    if (line.startsWith('@@')) inHunk = true;
    else if (inHunk && stripCr(line.slice(1)) === marker) {
      if (line.startsWith('+')) net += 1;
      else if (line.startsWith('-')) net -= 1;
    }
  }
  return net;
}

/**
 * [author date, short commit] of the latest commit, by author date, that adds more marker lines than
 * it removes in one of the paths; null when there is none. Ties keep the first found, as Python's max.
 * @param {Git} g
 * @param {string[]} paths
 * @param {string} marker
 */
function lastMarkerCommit(g, paths, marker) {
  if (!paths.length) return null;
  const out = git(g, ['--literal-pathspecs', 'log', '-p', '--text', '--unified=0', '--no-color',
    '--no-ext-diff', '--no-textconv', '--no-renames', '--no-relative', '--diff-merges=off',
    '--format=%x00%at %as %h', '--', ...paths.map(textOf)]);
  /** @type {Header | null} */
  let best = null;
  for (const [commit, lines] of fileDiffs(out)) {
    if (netMarkerLines(lines, marker) > 0 && (best === null || commit.stamp > best.stamp)) best = commit;
  }
  return best === null ? null : [best.date, best.commit];
}

/**
 * Byte order of two latin1 strings (Python's sort of bytes), never the locale's.
 * @param {string} a
 * @param {string} b
 */
function byteOrder(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/**
 * Every path under the root that any commit reachable from HEAD added, changed or deleted, sorted.
 * @param {Git} g
 * @param {string} root
 */
function pathsEverUnder(g, root) {
  if (!headExists(g)) return [];
  const out = git(g, ['log', '--format=', '--name-only', '-z', '--no-renames', '--no-relative', '--root', '--diff-merges=separate']);
  return [...new Set(out.split('\0').filter((p) => p && under(p, root)))].sort(byteOrder);
}

/**
 * [committer date, short commit] of the newest commit touching the root, as `git log -1` orders it;
 * null when nothing under the root was ever committed.
 * @param {Git} g
 * @param {string} root
 */
function lastChange(g, root) {
  const paths = pathsEverUnder(g, root);
  if (!paths.length) return null;
  const out = textOf(git(g, ['--literal-pathspecs', 'log', '-1', '--format=%cs %h', '--', ...paths.map(textOf)])).trim();
  const sp = out.indexOf(' ');
  const date = sp < 0 ? out : out.slice(0, sp);
  if (!date) return null;
  return [date, sp < 0 ? '' : out.slice(sp + 1)];
}

/**
 * Python's posixpath.normpath, for a path known to be relative.
 * @param {string} p
 */
export function normpath(p) {
  /** @type {string[]} */
  const parts = [];
  for (const c of p.split('/')) {
    if (!c || c === '.') continue;
    if (c !== '..' || (parts.length && parts.at(-1) === '..')) parts.push(c);
    else if (parts.length) parts.pop();
    else parts.push(c);
  }
  return parts.join('/') || '.';
}

/**
 * The root as a repository path, in bytes (latin1), or a usage error when it is not one.
 * @param {string} root
 * @param {string} platform
 */
export function normalisedRoot(root, platform) {
  const win = platform === 'win32';
  const p = win ? root.replaceAll('\\', '/') : root;
  if (!p || p.startsWith('/') || (win ? path.win32.isAbsolute(root) : false)) throw new UsageError('root must be a path relative to the repository');
  const n = normpath(p);
  if (n === '..' || n.startsWith('../')) throw new UsageError('root must not leave the repository');
  return bytesOf(n);
}

/**
 * The parser of the original, as argparse built it: prog, description, help and the help texts'
 * textwrap chunks (TextWrapper._split_chunks of Python 3.14, see src/lib/argparse.js).
 * @type {import('../lib/argparse.js').ParserSpec}
 */
export const SPEC = {
  prog: 'mhw rite-cadence',
  description: ['Date', ' ', 'a', ' ', 'rite', ' ', 'by', ' ', 'its', ' ', 'ran-', 'marked', ' ', 'artifacts.'],
  options: [
    { dest: 'help', nargs: 0, strings: ['-h', '--help'],
      help: ['show', ' ', 'this', ' ', 'help', ' ', 'message', ' ', 'and', ' ', 'exit'] },
    { dest: 'repo', nargs: null, strings: ['--repo'],
      help: ['the', ' ', 'repository', ' ', '(default:', ' ', 'the', ' ', 'current', ' ', 'directory)'] },
  ],
  positionals: [
    { dest: 'root', nargs: null,
      help: ['the', ' ', "rite's", ' ', 'artifact', ' ', 'root,', ' ', 'relative', ' ', 'to', ' ', 'the', ' ', 'repository'] },
    { dest: 'marker', nargs: '?',
      help: ['the', ' ', "rite's", ' ', 'ran-', 'marker,', ' ', 'matched', ' ', 'as', ' ', 'a', ' ', 'whole', ' ', 'line'] },
  ],
};

/**
 * The repository's top directory, from --repo resolved against the caller's directory.
 * @param {Io} io
 * @param {string} repo
 */
function repositoryTop(io, repo) {
  const directory = path.resolve(io.cwd, repo);
  let isDir = false;
  try {
    isDir = fs.statSync(directory).isDirectory();
  } catch {
    isDir = false;
  }
  if (!isDir) throw new GitError('rite-cadence: not a directory: ' + directory);
  const exe = onPath('git', io.env, io.platform);
  if (!exe) throw new GitError('rite-cadence: git could not run: git was not found on PATH');
  const top = textOf(git({ cwd: directory, exe, env: io.env }, ['rev-parse', '--show-toplevel'])).trim();
  return { cwd: top, exe, env: io.env };
}

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
export function run(argv, io) {
  const columns = terminalColumns(io.env, io.terminal);
  /** @param {string} message */
  const usageError = (message) => {
    io.err(usageText(SPEC, columns) + SPEC.prog + ': error: ' + message + '\n');
    return 2;
  };
  const parsed = parse(SPEC, argv);
  if (parsed.kind === 'help') {
    io.out(helpText(SPEC, columns));
    return 0;
  }
  if (parsed.kind === 'error') return usageError(parsed.message);
  const rootText = /** @type {string} */ (parsed.values.root);
  const markerText = parsed.values.marker;
  const repo = parsed.values.repo ?? '.';
  if (markerText !== undefined && !markerText.trim()) return usageError('marker must not be empty');
  try {
    const root = normalisedRoot(rootText, io.platform || process.platform);
    const g = repositoryTop(io, repo);
    if (markerText === undefined) {
      const found = lastChange(g, root);
      io.out(found ? rootText + ': last changed ' + found[0] + ' (' + found[1] + '), no ran-marker declared\n' : rootText + ': never changed\n');
      return 0;
    }
    const marker = bytesOf(markerText);
    const found = lastMarkerCommit(g, committedWithMarker(g, root, marker), marker);
    io.out(found
      ? rootText + ': last ran ' + found[0] + ' (' + found[1] + '), dated by files carrying ' + markerText + '\n'
      : rootText + ': never landed a file carrying ' + markerText + '\n');
    return 0;
  } catch (e) {
    if (e instanceof UsageError) return usageError(e.message);
    if (e instanceof GitError) {
      io.err(e.message + '\n');
      return 1;
    }
    throw e;
  }
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function main(argv, env) {
  return run(argv, {
    cwd: path.resolve(process.cwd()),
    env,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
    terminal: process.stdout.isTTY ? process.stdout.columns : 0,
  });
}
