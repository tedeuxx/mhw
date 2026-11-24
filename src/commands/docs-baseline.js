// The documentation baseline check (Issue #523): the documentation baseline a repository declares, and
// the pull-request check that keeps it current. Since #592 (ADR-0046) the check is not a CLI command: it
// is the delivery gates Action's `docs-baseline` gate (src/action/gates.js), with the arguments below.
// `mhw onboard`, the onboarding entry point, left the CLI at #599: it is the method skill `onboard`
// (method/skills/onboard/SKILL.md), which names this gate and the Action's contract gate.
//
//   mhw docs-baseline check --base=REF [--head=REF] [--body-file=PATH] [--project=DIR] [--manifest=PATH]
//
// The manifest is docs/documentation-baseline.json (the method's documentation-standard skill, *The
// documentation baseline*). It maps each capability to the code globs it owns and the documents that
// describe it, and names the five baseline items (README, requirements document, ADR library,
// architecture and sequence diagrams), each a path or not applicable with a reason.
//
// check reads the diff base...head. A changed path belongs to the FIRST capability, in manifest order,
// whose code globs match it, so order runs from specific to general. A capability a path belongs to is
// satisfied when the same diff changes one of its documents by more than whitespace: a numstat line under
// `git diff -w --ignore-blank-lines` (measured on git 2.52.0: a blank-line or whitespace-only edit prints
// no line). A changed path no code glob and no document glob matches fails, and no escape waives it: the
// manifest is amended instead. Otherwise an unsatisfied capability fails unless the pull-request body
// carries, at column 0, outside a CommonMark code fence and outside an HTML comment, one of
//     docs-baseline: none — <reason>        (an ASCII hyphen is accepted for the dash)
//     docs-baseline: in #<N>
// When the merge base holds a manifest, the change is judged by it too, so a change cannot pass by
// loosening the ruler in the same diff; and a head manifest that drops a capability, code glob or
// document the base had fails unless the body carries `docs-baseline: manifest — <reason>`.
// Exit 0 when every capability is satisfied or waived, 1 when not, 2 on a usage error, an invalid
// manifest or a git failure (it cannot say the change is current, so it does not).
//
// It is not a hook and installs nothing. git is found on PATH and run by absolute path with no shell;
// no value given here reaches git's command line except a base or head ref that passed REF below.
// node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { onPath } from '../lib/onpath.js';

export const MANIFEST = 'docs/documentation-baseline.json';
const BASELINE_KEYS = ['readme', 'prd', 'adr_library', 'architecture', 'sequences'];
const OPTIONAL_ITEMS = new Set(['architecture', 'sequences']);
const ID = /^[a-z0-9][a-z0-9-]*$/;
// A repository-relative path or glob: no leading slash, no `..` segment, a small character set. A glob
// adds only `*` and `?`; `**` is a whole segment. No brace, class or negation, so nothing here compiles
// a regular expression from a file.
const PATH_CHARS = /^[A-Za-z0-9_.@+/-]+$/;
const GLOB_CHARS = /^[A-Za-z0-9_.@+/*?-]+$/;
const PRD = /^docs\/[a-z0-9][a-z0-9.-]*-product-requirements-document-[a-z0-9][a-z0-9-]*\.md$/;
const REF = /^[A-Za-z0-9_][A-Za-z0-9_./@^~-]*$/;
const NONBLANK = /[A-Za-z0-9]/;
const NONE_LINE = /^docs-baseline: none (?:—|-) (.+)$/;
const ISSUE_LINE = /^docs-baseline: in #([1-9][0-9]*)$/;
const MANIFEST_LINE = /^docs-baseline: manifest (?:—|-) (.+)$/;
// CommonMark fenced code: an opener of three or more backticks or tildes, indented at most three
// spaces (a backtick opener's info string holds no backtick); it closes only on a run of the same
// character at least as long, indented at most three spaces, followed by nothing but blanks.
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

export class UsageError extends Error {}
export class GitError extends Error {}

/**
 * @typedef {string | { not_applicable: string }} Item
 * @typedef {{ id: string, code: string[], docs: string[] }} Capability
 * @typedef {{ schema_version: 1, baseline: Record<string, Item>, capabilities: Capability[] }} Manifest
 * @typedef {{ exe: string, cwd: string, env: Record<string, string | undefined> }} Git
 */

// -- globs ------------------------------------------------------------------------------------------

/**
 * Why a path or glob is refused, or null when it is acceptable.
 * @param {unknown} p
 * @param {boolean} glob
 */
export function badPath(p, glob) {
  if (typeof p !== 'string' || p === '') return 'not a non-empty string';
  if (!(glob ? GLOB_CHARS : PATH_CHARS).test(p)) return 'uses a character outside ' + (glob ? 'A-Z a-z 0-9 _ . @ + / * ? -' : 'A-Z a-z 0-9 _ . @ + / -');
  if (p.startsWith('/')) return 'is absolute';
  const segs = p.split('/');
  if (segs.some((s) => s === '' || s === '..' || s === '.')) return 'has an empty, . or .. segment';
  if (glob && segs.some((s) => s.includes('**') && s !== '**')) return 'uses ** inside a segment';
  return null;
}

/**
 * One segment against one segment pattern with * and ?: the classic two-pointer match, linear in
 * practice and never a regular expression.
 * @param {string} pat
 * @param {string} s
 */
function segmentMatches(pat, s) {
  let p = 0;
  let i = 0;
  let star = -1;
  let mark = 0;
  while (i < s.length) {
    if (p < pat.length && (pat[p] === '?' || pat[p] === s[i])) {
      p += 1;
      i += 1;
    } else if (p < pat.length && pat[p] === '*') {
      star = p;
      mark = i;
      p += 1;
    } else if (star >= 0) {
      p = star + 1;
      mark += 1;
      i = mark;
    } else {
      return false;
    }
  }
  while (p < pat.length && pat[p] === '*') p += 1;
  return p === pat.length;
}

/**
 * Does the repository-relative path match the glob? `**` is zero or more whole segments; `*` and `?`
 * stay inside one segment. Dynamic programming over segments, so no glob is exponential.
 * @param {string} glob
 * @param {string} file
 */
export function globMatches(glob, file) {
  const g = glob.split('/');
  const f = file.split('/');
  // ok[i][j]: g[i..] matches f[j..]
  /** @type {boolean[][]} */
  const ok = Array.from({ length: g.length + 1 }, () => new Array(f.length + 1).fill(false));
  ok[g.length][f.length] = true;
  for (let i = g.length - 1; i >= 0; i -= 1) {
    for (let j = f.length; j >= 0; j -= 1) {
      if (g[i] === '**') ok[i][j] = ok[i + 1][j] || (j < f.length && ok[i][j + 1]);
      else ok[i][j] = j < f.length && segmentMatches(g[i], f[j]) && ok[i + 1][j + 1];
    }
  }
  return ok[0][0];
}

/**
 * @param {string[]} globs
 * @param {string} file
 */
const anyMatches = (globs, file) => globs.some((g) => globMatches(g, file));

// -- the manifest -----------------------------------------------------------------------------------

/**
 * Every reason the value is not a manifest; an empty list means it is one.
 * @param {unknown} doc
 * @returns {string[]}
 */
export function manifestErrors(doc) {
  /** @type {string[]} */
  const errors = [];
  const isObject = (/** @type {unknown} */ v) => typeof v === 'object' && v !== null && !Array.isArray(v);
  if (!isObject(doc)) return ['the manifest is not a JSON object'];
  const d = /** @type {Record<string, unknown>} */ (doc);
  for (const key of Object.keys(d)) {
    if (!['schema_version', 'baseline', 'capabilities'].includes(key)) errors.push('unknown key ' + key);
  }
  if (d.schema_version !== 1) errors.push('schema_version must be 1');
  if (!isObject(d.baseline)) {
    errors.push('baseline must be an object');
  } else {
    const b = /** @type {Record<string, unknown>} */ (d.baseline);
    for (const key of Object.keys(b)) if (!BASELINE_KEYS.includes(key)) errors.push('baseline: unknown key ' + key);
    for (const key of BASELINE_KEYS) {
      const v = b[key];
      if (v === undefined) {
        errors.push('baseline.' + key + ' is missing');
      } else if (isObject(v) && OPTIONAL_ITEMS.has(key)) {
        const o = /** @type {Record<string, unknown>} */ (v);
        const reason = o.not_applicable;
        if (Object.keys(o).length !== 1 || typeof reason !== 'string' || !NONBLANK.test(reason)) {
          errors.push('baseline.' + key + ': not applicable needs exactly {"not_applicable": "<reason>"}, the reason carrying a letter or digit');
        }
      } else {
        const why = badPath(v, false);
        if (why) errors.push('baseline.' + key + ' ' + why + (OPTIONAL_ITEMS.has(key) ? ' (a path, or {"not_applicable": "<reason>"})' : ''));
        else if (key === 'prd' && !PRD.test(/** @type {string} */ (v))) errors.push('baseline.prd must be named docs/<repo>-product-requirements-document-<subject>.md');
      }
    }
  }
  if (!Array.isArray(d.capabilities) || d.capabilities.length === 0) {
    errors.push('capabilities must be a non-empty array');
    return errors;
  }
  const seen = new Set();
  d.capabilities.forEach((cap, i) => {
    const where = 'capabilities[' + i + ']';
    if (!isObject(cap)) {
      errors.push(where + ' is not an object');
      return;
    }
    const c = /** @type {Record<string, unknown>} */ (cap);
    for (const key of Object.keys(c)) if (!['id', 'code', 'docs'].includes(key)) errors.push(where + ': unknown key ' + key);
    if (typeof c.id !== 'string' || !ID.test(c.id)) errors.push(where + '.id must be lowercase letters, digits and hyphens');
    else if (seen.has(c.id)) errors.push(where + '.id ' + c.id + ' is repeated');
    else seen.add(c.id);
    for (const key of ['code', 'docs']) {
      const list = c[key];
      if (!Array.isArray(list) || list.length === 0) {
        errors.push(where + '.' + key + ' must be a non-empty array of globs');
        continue;
      }
      list.forEach((g, j) => {
        const why = badPath(g, true);
        if (why) errors.push(where + '.' + key + '[' + j + '] ' + why);
      });
    }
  });
  return errors;
}

/**
 * The manifest at file, or UsageError naming every reason it is not one.
 * @param {string} file
 * @returns {Manifest}
 */
export function readManifest(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code;
    throw new UsageError(code === 'ENOENT' ? 'no manifest at ' + file : 'cannot read ' + file + ': ' + code);
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    throw new UsageError(file + ' is not JSON (' + (e instanceof Error ? e.message : String(e)) + ')');
  }
  const errors = manifestErrors(doc);
  if (errors.length) throw new UsageError(file + ' is not a valid manifest: ' + errors.join('; '));
  return /** @type {Manifest} */ (doc);
}

// -- the pull-request body --------------------------------------------------------------------------

/**
 * The body with every HTML comment blanked out, its newlines kept so lines stay where they were. A
 * comment that never closes hides the rest of the body, as it does in the rendered pull request. A
 * line a reader cannot see declares nothing.
 * @param {string} body
 */
export function withoutComments(body) {
  let out = '';
  let at = 0;
  for (;;) {
    const open = body.indexOf('<!--', at);
    if (open < 0) return out + body.slice(at);
    const close = body.indexOf('-->', open + 4);
    const end = close < 0 ? body.length : close + 3;
    out += body.slice(at, open) + body.slice(open, end).replace(/[^\n]/g, '');
    at = end;
    if (close < 0) return out;
  }
}

/**
 * The escapes the body declares, and every column-0 `docs-baseline:` line that is malformed. Lines in a
 * fenced code block (CommonMark rules) or an HTML comment are quotes or hidden, not declarations.
 * @param {string} body
 * @returns {{ waiver: string | null, manifestWaiver: string | null, malformed: string[] }}
 */
export function parseBody(body) {
  /** @type {{ ch: string, len: number } | null} */
  let fence = null;
  /** @type {string | null} */
  let waiver = null;
  /** @type {string | null} */
  let manifestWaiver = null;
  /** @type {string[]} */
  const malformed = [];
  for (const raw of withoutComments(body).split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (fence) {
      const close = FENCE_CLOSE.exec(line);
      if (close && close[1][0] === fence.ch && close[1].length >= fence.len) fence = null;
      continue;
    }
    const open = FENCE_OPEN.exec(line);
    if (open && !(open[1][0] === '`' && open[2].includes('`'))) {
      fence = { ch: open[1][0], len: open[1].length };
      continue;
    }
    if (!line.startsWith('docs-baseline:')) continue;
    const none = NONE_LINE.exec(line);
    const issue = ISSUE_LINE.exec(line);
    const manifest = MANIFEST_LINE.exec(line);
    if (none && NONBLANK.test(none[1])) waiver = waiver || 'docs-baseline: none — ' + none[1].trim();
    else if (issue) waiver = waiver || 'docs-baseline: in #' + issue[1];
    else if (manifest && NONBLANK.test(manifest[1])) manifestWaiver = manifestWaiver || 'docs-baseline: manifest — ' + manifest[1].trim();
    else malformed.push(line);
  }
  return { waiver, manifestWaiver, malformed };
}

// -- git --------------------------------------------------------------------------------------------

/**
 * @param {Git} g
 * @param {string[]} args
 */
function git(g, args) {
  const p = spawnSync(g.exe, args, { cwd: g.cwd, env: g.env, shell: false, windowsHide: true, maxBuffer: Infinity, encoding: 'utf8' });
  if (p.error) throw new GitError('git could not run: ' + p.error.message);
  if (p.status !== 0) throw new GitError('git ' + args[0] + ' failed: ' + (p.stderr || '').trim());
  return p.stdout;
}

/**
 * @param {string} dir
 * @param {Record<string, string | undefined>} env
 * @param {string} [platform]
 * @returns {Git}
 */
function gitIn(dir, env, platform) {
  const exe = onPath('git', env, platform);
  if (!exe) throw new GitError('git was not found on PATH');
  return { exe, cwd: dir, env };
}

/**
 * The paths the range changes, and those it changes by more than whitespace.
 * @param {Git} g
 * @param {string} range
 */
export function changedPaths(g, range) {
  const names = git(g, ['diff', '--name-only', '--no-renames', '-z', range, '--']).split('\0').filter(Boolean);
  const substantive = new Set();
  for (const record of git(g, ['diff', '-w', '--ignore-blank-lines', '--numstat', '--no-renames', '-z', range, '--']).split('\0')) {
    const m = /^(-|[0-9]+)\t(-|[0-9]+)\t([\s\S]+)$/.exec(record);
    if (m && (m[1] === '-' || Number(m[1]) + Number(m[2]) > 0)) substantive.add(m[3]);
  }
  return { names, substantive };
}

// -- check ------------------------------------------------------------------------------------------

/**
 * What the head manifest drops that the base manifest had: a capability, or one of its code globs or
 * documents. Each is a loosening of the ruler the change is judged by.
 * @param {Manifest} base
 * @param {Manifest} head
 * @returns {string[]}
 */
export function loosenings(base, head) {
  const out = [];
  for (const b of base.capabilities) {
    const h = head.capabilities.find((c) => c.id === b.id);
    if (!h) {
      out.push('drops the capability ' + b.id);
      continue;
    }
    for (const g of b.code) if (!h.code.includes(g)) out.push(b.id + ' drops the code glob ' + g);
    for (const g of b.docs) if (!h.docs.includes(g)) out.push(b.id + ' drops the document ' + g);
  }
  return out;
}

/**
 * The decision for the changed paths against the head manifest and, when the base revision has one,
 * against the base manifest too, so a change cannot pass by loosening the ruler it is judged by: every
 * capability must be satisfied under both, and a manifest that drops something the base had fails
 * unless the body carries `docs-baseline: manifest — <reason>`. Coverage (a path outside every
 * capability) is judged by the head manifest alone, so a new capability for new code is not refused.
 * @param {Manifest} manifest the head's
 * @param {string[]} names
 * @param {Set<string>} substantive
 * @param {string | null} body null when no body was read
 * @param {Manifest | null} [base] the base revision's, or null when it has none
 * @returns {{ code: number, lines: string[] }}
 */
export function decide(manifest, names, substantive, body, base = null) {
  const parsed = parseBody(body ?? '');
  /** @type {string[]} */
  const lines = [];
  for (const line of parsed.malformed) lines.push('FAIL  malformed escape line (it waives nothing): ' + line);
  let failed = parsed.malformed.length;
  const head = judge(manifest, names, substantive, body, parsed, true, '');
  lines.push(...head.lines);
  failed += head.failed;
  if (base) {
    const old = judge(base, names, substantive, body, parsed, false, '[base manifest] ');
    lines.push(...old.lines);
    failed += old.failed;
    for (const l of loosenings(base, manifest)) {
      if (parsed.manifestWaiver) {
        lines.push('WAIVED the manifest ' + l + '; the body declares ' + parsed.manifestWaiver);
      } else {
        failed += 1;
        lines.push('FAIL  the manifest ' + l + ' that the base revision had; restore it, or declare why at column 0: docs-baseline: manifest — <reason>');
      }
    }
  }
  lines.push(failed ? 'FAIL  ' + failed + ' finding(s); the documentation baseline is not current'
    : 'OK    the documentation baseline is current for this change');
  return { code: failed ? 1 : 0, lines };
}

/**
 * One manifest's verdict on the change.
 * @param {Manifest} manifest
 * @param {string[]} names
 * @param {Set<string>} substantive
 * @param {string | null} body
 * @param {{ waiver: string | null }} parsed
 * @param {boolean} coverage whether a path outside every capability fails
 * @param {string} tag
 * @returns {{ failed: number, lines: string[] }}
 */
function judge(manifest, names, substantive, body, parsed, coverage, tag) {
  const { waiver } = parsed;
  /** @type {string[]} */
  const lines = [];
  /** @type {Map<string, string[]>} */
  const touched = new Map();
  const uncovered = [];
  for (const file of names) {
    const owner = manifest.capabilities.find((c) => anyMatches(c.code, file));
    if (owner) {
      touched.set(owner.id, [...(touched.get(owner.id) || []), file]);
    } else if (coverage && !manifest.capabilities.some((c) => anyMatches(c.docs, file))) {
      uncovered.push(file);
    }
  }
  let failed = uncovered.length;
  for (const file of uncovered) lines.push('FAIL  ' + file + ': outside every capability of the manifest; add it to one');
  for (const cap of manifest.capabilities) {
    const files = touched.get(cap.id);
    if (!files) continue;
    const doc = names.find((f) => substantive.has(f) && anyMatches(cap.docs, f));
    const by = files.slice(0, 3).join(', ') + (files.length > 3 ? ' and ' + (files.length - 3) + ' more' : '');
    if (doc) {
      lines.push('OK    ' + tag + cap.id + ': ' + doc + ' changed (touched by ' + by + ')');
    } else if (waiver) {
      lines.push('WAIVED ' + tag + cap.id + ': no document of it changed; the body declares ' + waiver + ' (touched by ' + by + ')');
    } else {
      failed += 1;
      lines.push('FAIL  ' + tag + cap.id + ': touched by ' + by + ', and none of its documents (' + cap.docs.join(', ')
        + ') changed by more than whitespace' + (body === null ? '; no pull-request body was read' : ''));
    }
  }
  if (!touched.size && !uncovered.length) lines.push('OK    ' + tag + 'no capability is touched');
  return { failed, lines };
}

// -- the commands -----------------------------------------------------------------------------------

/**
 * --key=value options; a bare flag is true.
 * @param {string[]} argv
 * @param {string[]} valued
 * @param {string[]} flags
 */
function options(argv, valued, flags) {
  /** @type {Record<string, string | true>} */
  const out = {};
  for (const arg of argv) {
    const eq = arg.indexOf('=');
    const key = eq < 0 ? arg : arg.slice(0, eq);
    if (eq > 0 && valued.includes(key) && arg.length > eq + 1 && !Object.hasOwn(out, key)) out[key] = arg.slice(eq + 1);
    else if (eq < 0 && flags.includes(key) && !Object.hasOwn(out, key)) out[key] = true;
    else throw new UsageError('unknown or repeated argument ' + arg);
  }
  return out;
}

/**
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, platform?: string,
 *   out: (s: string) => void, err: (s: string) => void }} Io
 */

const CHECK_USAGE = 'usage: mhw docs-baseline check --base=REF [--head=REF] [--body-file=PATH] [--project=DIR] [--manifest=PATH]\n';

/**
 * The manifest as the commit holds it: the manifest, null when the commit has no file there, or the
 * reason it is not a valid manifest. The path is the project-relative manifest path, which must lie
 * inside the project.
 * @param {Git} g
 * @param {string} commit a full commit id git printed
 * @param {string} project
 * @param {string} manifestPath
 * @returns {Manifest | null | string}
 */
function manifestAt(g, commit, project, manifestPath) {
  const rel = path.relative(project, manifestPath).split(path.sep).join('/');
  if (!/^[0-9a-f]{40,64}$/.test(commit) || badPath(rel, false)) throw new UsageError('cannot locate the manifest in the merge base: ' + rel);
  const spec = commit + ':./' + rel;
  try {
    git(g, ['cat-file', '-e', spec]);
  } catch (e) {
    if (e instanceof GitError) return null;
    throw e;
  }
  let doc;
  try {
    doc = JSON.parse(git(g, ['show', spec]));
  } catch (e) {
    if (e instanceof GitError) throw e;
    return 'not JSON';
  }
  const errors = manifestErrors(doc);
  return errors.length ? errors.join('; ') : /** @type {Manifest} */ (doc);
}

/**
 * `mhw docs-baseline check ...`
 * @param {string[]} argv
 * @param {Io} io
 */
export function runCheck(argv, io) {
  if (argv[0] !== 'check') {
    io.err(CHECK_USAGE);
    return 2;
  }
  try {
    const o = options(argv.slice(1), ['--base', '--head', '--body-file', '--project', '--manifest'], []);
    const base = /** @type {string | undefined} */ (o['--base']);
    const head = /** @type {string} */ (o['--head'] ?? 'HEAD');
    if (!base) throw new UsageError('--base=REF is required');
    for (const ref of [base, head]) if (!REF.test(ref) || ref.includes('..')) throw new UsageError('not a ref this check accepts: ' + ref);
    const project = path.resolve(io.cwd, /** @type {string} */ (o['--project'] ?? '.'));
    const manifestPath = path.resolve(project, /** @type {string} */ (o['--manifest'] ?? MANIFEST));
    const manifest = readManifest(manifestPath);
    /** @type {string | null} */
    let body = null;
    if (o['--body-file'] !== undefined) {
      try {
        body = fs.readFileSync(path.resolve(io.cwd, /** @type {string} */ (o['--body-file'])), 'utf8');
      } catch (e) {
        throw new UsageError('cannot read the body file: ' + /** @type {NodeJS.ErrnoException} */ (e).code);
      }
    }
    const g = gitIn(project, io.env, io.platform);
    const { names, substantive } = changedPaths(g, base + '...' + head);
    const baseManifest = manifestAt(g, git(g, ['merge-base', base, head]).trim(), project, manifestPath);
    /** @type {string[]} */
    const notes = [];
    if (baseManifest === null) notes.push('NOTE  the merge base has no manifest at this path; only the head manifest judges this change');
    else if (typeof baseManifest === 'string') notes.push('NOTE  the merge base manifest is not valid (' + baseManifest + '); only the head manifest judges this change');
    const { code, lines } = decide(manifest, names, substantive, body, typeof baseManifest === 'object' ? baseManifest : null);
    io.out([...notes, ...lines].join('\n') + '\n');
    return code;
  } catch (e) {
    if (e instanceof UsageError || e instanceof GitError) {
      io.err('mhw docs-baseline check: ' + e.message + '\n' + (e instanceof UsageError ? CHECK_USAGE : ''));
      return 2;
    }
    throw e;
  }
}

/**
 * @param {(argv: string[], io: Io) => number} fn
 * @returns {(argv: string[], env: Record<string, string | undefined>) => number}
 */
function entry(fn) {
  return (argv, env) => fn(argv, {
    cwd: process.cwd(),
    env,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}

export const checkMain = entry(runCheck);
