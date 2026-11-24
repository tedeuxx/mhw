#!/usr/bin/env node
// The outbound scan (ADR-0035, decision 7): what a push or a pull request is about to send, checked with
// the cleaning core (src/lib/clean.js), the port of the paste filter's own engine. There is no second
// detector. It was `mhw scan` (src/commands/scan.js, Node since #486, S15 of #470) until #600 took the
// command out of the CLI (CLI native baseline PRD, section 5: "CI calls the engine directly"); it is a
// script of this repository's CI now, outside the npm package, and the outbound-scan workflow runs it.
// test/golden/S15/ holds the deleted global/scan.py's transcripts, which test/scan/ plays against it.
// It reads a commit with the fixed-pattern check's -U0 patch reader and attribution-trailer rule
// (src/hooks/pattern-check.js, #588), so the CI check and the push hook read a commit the same way.
//
//     node .github/scripts/outbound-scan.js
//                                 what this branch would send beyond its upstream: the files changed
//                                 since the merge base of HEAD and @{upstream}, as they are in the working
//                                 tree (deleted files are skipped), AND the lines added by every commit
//                                 between that merge base and HEAD, AND each of those commits' messages
//     ... --base=REF              the same, against REF instead of @{upstream} (CI passes the PR's base)
//     ... PATH...                 exactly these files, provided git lists them under the current
//                                 directory; the file opened is always git's own entry, never the argument
//     ... --file=PATH             exactly one text file, git or no git (Issue #34)
//
// One line per finding, never the text:
//     path:line: category, N chars                    in the working tree
//     <short-sha>:path:line: category, N chars        in a line that commit added
//     <short-sha>:message: category, N chars          in that commit's message
// The matched text, an excerpt or a hash of it is NEVER printed, on stdout or stderr (ADR-0005). A file
// that is not scanned is named with the reason. In a commit message only, the vendor no-reply address
// inside the required attribution trailer is not reported; the name is scanned.
//
// It informs and never blocks: exit 0 with or without findings. Exit 2 means the scan could not run.
// Every category is reported, whatever block_categories says. Employer and client terms, and the term
// half of health and colleague-name, are matched only where the owner's hashed lists and their salt are
// readable without a prompt; a NOTE line says so whenever they are not (in CI, every time).
//
// The salt is read the way the prompt hook reads it, from its file (src/lib/salt.js): since #488 it is a
// file on every system (owner ruling, 2026-11-21), so no process is started for it and the Keychain is never
// read. A missing or unreadable salt file gets a NOTE and no term list is checked. The salt never leaves this
// process. Reads files and git objects; writes nothing. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { onPath } from '../../src/lib/onpath.js';
import * as core from '../../src/lib/clean.js';
import { readSalt } from '../../src/lib/salt.js';
import * as baseUrl from '../../src/lib/base-url.js';
// The -U0 patch reader and the attribution-trailer rule, written once in the fixed-pattern check (#588), which
// reads a push's commits the way this script does; re-exported here for this script's own tests.
import { addedBlocks, withoutAttributionTrailer } from '../../src/hooks/pattern-check.js';

export { addedBlocks, withoutAttributionTrailer };

export const PROG = 'outbound-scan';
const NO_REPOSITORY = 'not inside a git repository; ' + PROG + ' needs one, in every mode';
const NO_GIT = 'git was not found on PATH; ' + PROG + ' needs it in this mode';
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, platform: string, out: string[], git: string | null,
 * }} Ctx
 * @typedef {[string, string | null, string | null]} Target [label, path or null, skip reason or null]
 * @typedef {[string, string, boolean]} Commit [short sha, full sha, is a merge]
 */

/** bytes.decode("utf-8", errors="replace"), a byte-order mark kept. @param {Buffer} b */
const decode = (b) => new TextDecoder('utf-8', { ignoreBOM: true }).decode(b);

/** @param {Ctx} ctx @param {string[]} args @returns {[number, string]} */
function git(ctx, args) {
  const p = spawnSync(/** @type {string} */ (ctx.git), args, { cwd: ctx.cwd, env: ctx.env, maxBuffer: 1 << 30, shell: false, windowsHide: true });
  if (p.error) return [2, ''];
  return [p.status === null ? 1 : p.status, decode(p.stdout)];
}

/** A --base value is a ref name, never an option. @param {string} base */
export const validBase = (base) => Boolean(base) && !base.startsWith('-');

/** Python's os.path.realpath(p) (strict=False): what does not exist is kept as it is. @param {string} p @returns {string} */
export function pyRealpath(p) {
  try {
    return fs.realpathSync.native(p);
  } catch {
    const parent = path.dirname(p);
    if (parent === p) return p;
    return path.join(pyRealpath(parent), path.basename(p));
  }
}

/** Python's os.path.relpath(to, from). @param {string} to @param {string} from */
const relpath = (to, from) => path.relative(from, to) || '.';

/** Python's str ordering: by code point. @param {string} a @param {string} b */
function byCodePoint(a, b) {
  const x = Array.from(a);
  const y = Array.from(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = /** @type {number} */ (x[i].codePointAt(0)) - /** @type {number} */ (y[i].codePointAt(0));
    if (d) return d;
  }
  return x.length - y.length;
}

/**
 * The changed files and the commits after the merge base, or the error.
 * @param {Ctx} ctx
 * @param {string | null} base
 * @returns {{ root?: string, paths?: string[], commits?: Commit[], error?: string }}
 */
function outbound(ctx, base) {
  const [code, top] = git(ctx, ['rev-parse', '--show-toplevel']);
  if (code) return { error: NO_REPOSITORY };
  if (base !== null && !validBase(base)) return { error: '--base takes a git ref' };
  const [c2, refOut] = git(ctx, ['rev-parse', '--verify', '--quiet', '--end-of-options', (base || '@{upstream}') + '^{commit}']);
  const ref = core.strip(refOut);
  if (c2 || !OBJECT_ID.test(ref)) {
    if (base) return { error: '--base=' + base + ' is not a commit' };
    return { error: 'this branch has no upstream; pass --base=REF (for example --base=origin/main)' };
  }
  const [c3, mbOut] = git(ctx, ['merge-base', '--end-of-options', 'HEAD', ref]);
  const mb = core.strip(mbOut);
  if (c3 || !OBJECT_ID.test(mb)) return { error: 'cannot find a merge base of HEAD and ' + (base || 'its upstream') };
  const [c4, names] = git(ctx, ['diff', '--name-only', '-z', '--diff-filter=d', mb]);
  if (c4) return { error: 'git diff failed' };
  const root = core.strip(top);
  const paths = names.split('\0').filter(Boolean).map((p) => relpath(path.join(root, p), ctx.cwd));
  const [c5, log] = git(ctx, ['log', '--reverse', '--format=%H %h %P', mb + '..HEAD']);
  if (c5) return { error: 'git log failed' };
  /** @type {Commit[]} */
  const commits = [];
  for (const line of log.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)) {
    const parts = line.split(/\s+/).filter(Boolean);
    if (parts.length >= 2 && OBJECT_ID.test(parts[0])) commits.push([parts[1], parts[0], parts.length > 3]);
  }
  return { root, paths, commits };
}

/**
 * [line, category, length] for every finding in text, in order. Never the matched text.
 * @param {string} text
 * @param {Set<string>} terms
 * @param {string | null} salt
 * @param {Record<string, Set<string>>} lists
 * @returns {Array<[number, string, number]>}
 */
export function scanText(text, terms = new Set(), salt = null, lists = {}) {
  const o = core.offsets(text);
  /** @type {number[]} */
  const lineStarts = [];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) lineStarts.push(i);
  /** @param {number} unit the number of \n before it, plus one */
  const lineAt = (unit) => {
    let lo = 0;
    let hi = lineStarts.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (lineStarts[mid] < unit) lo = mid + 1;
      else hi = mid;
    }
    return lo + 1;
  };
  /** @type {Array<[number, string, number]>} */
  const found = core.findSpans(text, terms, salt, lists).map(([s, e, cat]) => [lineAt(o.toUnit(s)), cat, e - s]);
  return found.sort((a, b) => a[0] - b[0] || core.CATEGORY_ORDER.indexOf(a[1]) - core.CATEGORY_ORDER.indexOf(b[1]) || a[2] - b[2]);
}

/**
 * The term lists and salt, with a NOTE for every list that cannot be checked. Never silent.
 * @param {Ctx} ctx
 * @param {Record<string, string>} conf
 * @returns {[Set<string>, string | null, Record<string, Set<string>>]}
 */
function termDetector(ctx, conf) {
  const [terms, lists] = core.readTermLists(conf);
  if (!terms.size) {
    ctx.out.push('NOTE    no employer and client term list could be read (absent, empty or unreadable); '
      + 'employer-client-term was NOT checked\n');
  }
  for (const [cat, hashes] of Object.entries(lists)) {
    if (!hashes.size) {
      ctx.out.push('NOTE    no ' + cat + ' term list could be read (absent, empty or unreadable); ' + cat + ' was checked '
        + 'by its pattern only, NOT against a term list\n');
    }
  }
  if (!terms.size && !Object.values(lists).some((h) => h.size)) return [terms, null, lists];
  const { salt } = readSalt(conf);
  if (!salt) {
    ctx.out.push("NOTE    the term list's salt file could not be read (missing, unreadable or not a salt; re-add your "
      + 'terms with mhw add-term); no term list was checked '
      + '(employer-client-term, and the term half of health and colleague-name)\n');
  }
  return [terms, salt, lists];
}

/** @param {Ctx} ctx @returns {{ files?: string[], error?: string }} */
function listedFiles(ctx) {
  const [code, out] = git(ctx, ['ls-files', '-z', '--cached', '--others', '--exclude-standard']);
  if (code) return { error: NO_REPOSITORY };
  return { files: [...new Set(out.split('\0').filter(Boolean))].sort(byCodePoint) };
}

/** Python's os.path.normpath. @param {string} p */
function normpath(p) {
  const n = path.normalize(p);
  return n.length > 1 && (n.endsWith('/') || n.endsWith(path.sep)) ? n.slice(0, -1) : n;
}

/**
 * The normalised path, relative to cwd, that arg names, or null outside it. The last component is not
 * resolved, so a symlink is looked up as itself, as git lists it.
 * @param {string} arg
 * @param {string} cwd
 */
function lookupKey(arg, cwd) {
  const full = path.resolve(cwd, arg);
  const rel = relpath(path.join(pyRealpath(path.dirname(full)), path.basename(full)), pyRealpath(cwd));
  if (rel === '..' || rel.startsWith('..' + path.sep) || path.isAbsolute(rel)) return null;
  return rel;
}

/**
 * The PATH arguments as targets, in order; a path is always an entry of files, never built from an argument.
 * @param {string[]} args
 * @param {string[]} files
 * @param {string} cwd
 * @returns {Target[]}
 */
function explicitTargets(args, files, cwd) {
  /** @type {Map<string, string>} */
  const byKey = new Map(files.map((f) => [normpath(f), f]));
  const dirs = new Set();
  for (const key of byKey.keys()) {
    let parent = path.dirname(key);
    while (parent !== '.' && parent && !dirs.has(parent)) {
      dirs.add(parent);
      const up = path.dirname(parent);
      if (up === parent) break;
      parent = up;
    }
  }
  /** @type {Map<string, string>} */
  const byCase = new Map();
  // The value is git's own entry, so the name shown has git's / on Windows too (normpath's key has \).
  for (const [key, f] of byKey) if (!byCase.has(core.casefold(key))) byCase.set(core.casefold(key), f);
  return args.map((arg) => {
    const key = lookupKey(arg, cwd);
    if (key === null) return /** @type {Target} */ ([arg, null, 'outside the working directory, not scanned']);
    const hit = byKey.get(key);
    if (hit !== undefined) return /** @type {Target} */ ([arg, hit, null]);
    if (key === '.' || dirs.has(key)) return /** @type {Target} */ ([arg, null, 'a directory, name its files; not scanned']);
    const other = byCase.get(core.casefold(key));
    if (other !== undefined) {
      return /** @type {Target} */ ([arg, null, 'differs only in case from ' + other + ', which git lists; name it as git does, not scanned']);
    }
    return /** @type {Target} */ ([arg, null, 'not a file git lists (missing or ignored), not scanned']);
  });
}

/** Is real inside root (os.path.commonpath([root, real]) == root)? @param {string} root @param {string} real @param {string} platform */
function contains(root, real, platform) {
  const win = platform === 'win32';
  const r = win ? root.toLowerCase() : root;
  const x = win ? real.toLowerCase() : real;
  if (win && path.parse(r).root !== path.parse(x).root) return false;
  return x === r || x.startsWith(r.endsWith(path.sep) ? r : r + path.sep);
}

/** A changed file's label with / on every OS, as git and the POSIX original spell it. @param {string} label @param {string} platform */
const shown = (label, platform) => (platform === 'win32' ? label.replaceAll('\\', '/') : label);

/**
 * Findings in one commit's message and, unless it is a merge, in the lines it added.
 * @param {Ctx} ctx
 * @param {Commit} commit
 * @param {[Set<string>, string | null, Record<string, Set<string>>]} det
 * @param {number} limit
 */
function scanCommit(ctx, [short, full, isMerge], det, limit) {
  let found = 0;
  const [code, message] = git(ctx, ['log', '-1', '--format=%B', full]);
  if (code) {
    ctx.out.push('SKIPPED ' + short + ':message: unreadable, not scanned\n');
  } else {
    for (const [, cat, length] of scanText(withoutAttributionTrailer(message), ...det)) {
      ctx.out.push(short + ':message: ' + cat + ', ' + length + ' chars\n');
      found += 1;
    }
  }
  if (isMerge) return found;
  const [c2, patch] = git(ctx, ['diff-tree', '-p', '-r', '-U0', '--root', '--no-commit-id', '--no-color',
    '--no-ext-diff', '--no-textconv', '--no-renames', full]);
  if (c2) {
    ctx.out.push('SKIPPED ' + short + ': diff unreadable, not scanned\n');
    return found;
  }
  for (const [file, first, text] of addedBlocks(patch)) {
    if (text === null) {
      ctx.out.push('SKIPPED ' + short + ':' + file + ': binary, not scanned\n');
      continue;
    }
    if (Buffer.byteLength(text, 'utf8') > limit) {
      ctx.out.push('SKIPPED ' + short + ':' + file + ': added lines over ' + limit + ' bytes, not scanned\n');
      continue;
    }
    for (const [line, cat, length] of scanText(text, ...det)) {
      ctx.out.push(short + ':' + file + ':' + (first + line - 1) + ': ' + cat + ', ' + length + ' chars\n');
      found += 1;
    }
  }
  return found;
}

/**
 * Print the findings for targets (and commits) and a summary.
 * @param {Ctx} ctx
 * @param {Target[]} targets
 * @param {Record<string, string>} conf
 * @param {string | null} root
 * @param {Commit[] | null} commits
 */
function scan(ctx, targets, conf, root, commits) {
  const det = termDetector(ctx, conf);
  const limit = core.pyInt(conf.max_bytes);
  const top = pyRealpath(root || ctx.cwd);
  let total = 0;
  let filesWith = 0;
  let scanned = 0;
  for (const [label, file, reason] of targets) {
    const name = label;
    if (reason) {
      ctx.out.push('SKIPPED ' + name + ': ' + reason + '\n');
      continue;
    }
    const real = pyRealpath(path.resolve(ctx.cwd, /** @type {string} */ (file)));
    if (!contains(top, real, ctx.platform)) {
      ctx.out.push('SKIPPED ' + name + ': outside ' + (commits !== null ? 'the repository' : 'the working directory') + ', not scanned\n');
      continue;
    }
    let raw;
    try {
      if (fs.statSync(real).size > limit) {
        ctx.out.push('SKIPPED ' + name + ': over ' + limit + ' bytes, not scanned\n');
        continue;
      }
      raw = fs.readFileSync(real);
    } catch (e) {
      ctx.out.push('SKIPPED ' + name + ': unreadable (' + core.osErrorClass(e) + ')\n');
      continue;
    }
    if (raw.includes(0)) {
      ctx.out.push('SKIPPED ' + name + ': binary, not scanned\n');
      continue;
    }
    scanned += 1;
    const text = decode(raw);
    const findings = scanText(text, ...det);
    // #27: a Claude Code settings file whose env block sets ANTHROPIC_BASE_URL; the value is never shown.
    if (baseUrl.isSettingsPath(name)) {
      for (const [line, length] of baseUrl.findInSettings(text)) findings.push([line, baseUrl.CATEGORY, length]);
      findings.sort((a, b) => a[0] - b[0]);
    }
    for (const [line, cat, length] of findings) ctx.out.push(name + ':' + line + ': ' + cat + ', ' + length + ' chars\n');
    total += findings.length;
    if (findings.length) filesWith += 1;
  }
  let summary = filesWith + ' of ' + scanned + ' scanned file(s)';
  if (commits !== null) {
    let commitsWith = 0;
    for (const c of commits) {
      const found = scanCommit(ctx, c, det, limit);
      total += found;
      if (found) commitsWith += 1;
    }
    summary += ' and ' + commitsWith + ' of ' + commits.length + ' commit(s)';
  }
  ctx.out.push(PROG + ': ' + total + ' finding(s); ' + summary + ' had one; informs only, never blocks; the matched text is never '
    + 'shown (ADR-0005)\n');
}

/**
 * --file=PATH: the one file the caller named; root is its own directory, so a symlink is followed.
 * @param {string} arg
 * @param {string} cwd
 * @returns {{ targets?: Target[], root?: string, error?: string }}
 */
function fileTarget(arg, cwd) {
  if (!arg) return { error: '--file takes a path' };
  const real = pyRealpath(path.resolve(cwd, arg));
  let isFile = false;
  try {
    isFile = fs.statSync(real).isFile();
  } catch {
    isFile = false;
  }
  if (!isFile) return { error: '--file=' + arg + ': no such regular file' };
  return { targets: [[arg, real, null]], root: path.dirname(real) };
}

/** The paste filter's installed settings, or null. @param {Ctx} ctx */
function installedConfig(ctx) {
  const file = path.join(core.dataDir(ctx.env, ctx.platform), 'clipboard.conf');
  try {
    return fs.statSync(file).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * @param {string[]} argv
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, platform?: string }} [opts]
 * @returns {{ code: number, stdout: string, stderr: string }}
 */
export function run(argv, opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  /** @type {Ctx} */
  const ctx = { cwd: opts.cwd || process.cwd(), env, platform, out: [], git: onPath('git', env, platform) };
  const fail = (/** @type {string} */ msg) => ({ code: 2, stdout: ctx.out.join(''), stderr: PROG + ': ' + msg + '\n' });
  /** @type {string | null} */
  let base = null;
  /** @type {string | null} */
  let fileArg = null;
  /** @type {string[]} */
  const paths = [];
  for (const arg of argv) {
    if (arg.startsWith('--file=')) {
      if (fileArg !== null) return fail('--file takes one path; pass it once');
      fileArg = arg.slice('--file='.length);
    } else if (arg.startsWith('--base=')) {
      base = arg.slice('--base='.length);
      if (!validBase(base)) return fail('--base takes a git ref');
    } else if (arg.startsWith('-')) {
      return fail('unknown argument ' + arg);
    } else {
      paths.push(arg);
    }
  }
  if (paths.length && base) return fail('name files or pass --base, not both');
  if (fileArg !== null && (paths.length || base !== null)) return fail('--file cannot be combined with --base or with PATH arguments');
  /** @type {string | null} */
  let root = null;
  /** @type {Commit[] | null} */
  let commits = null;
  /** @type {Target[]} */
  let targets;
  if (fileArg !== null) {
    const f = fileTarget(fileArg, ctx.cwd);
    if (f.error) return fail(f.error);
    targets = /** @type {Target[]} */ (f.targets);
    root = /** @type {string} */ (f.root);
  } else {
    if (!ctx.git) return fail(NO_GIT);
    if (paths.length) {
      const l = listedFiles(ctx);
      if (l.error) return fail(l.error);
      targets = explicitTargets(paths, /** @type {string[]} */ (l.files), ctx.cwd);
    } else {
      const o = outbound(ctx, base);
      if (o.error) return fail(o.error);
      root = /** @type {string} */ (o.root);
      commits = /** @type {Commit[]} */ (o.commits);
      targets = /** @type {string[]} */ (o.paths).map((p) => /** @type {Target} */ ([shown(p, platform), p, null]));
    }
  }
  let conf;
  try {
    conf = core.loadConfig(installedConfig(ctx), { env, platform });
  } catch (e) {
    ctx.out.push('NOTE    the paste filter settings could not be read (' + (e instanceof core.PyError ? e.pyClass : 'OSError')
      + '); built-in defaults used\n');
    conf = core.loadConfig(null, { env, platform });
  }
  scan(ctx, targets, conf, root, commits);
  return { code: 0, stdout: ctx.out.join(''), stderr: '' };
}

/**
 * The script's entry: runs in the current directory and writes both streams.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function main(argv, env) {
  const r = run(argv, { env });
  if (r.stdout) fs.writeSync(1, r.stdout);
  if (r.stderr) fs.writeSync(2, r.stderr);
  return r.code;
}

// Run directly (the outbound-scan workflow, or a checkout): the exit code is the scan's.
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) {
  process.exitCode = main(process.argv.slice(2), process.env);
}
