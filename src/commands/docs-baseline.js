// mhw docs-baseline check and mhw onboard (Issue #523): the documentation baseline a repository
// declares, the pull-request check that keeps it current, and the onboarding entry point.
//
//   mhw docs-baseline check --base=REF [--head=REF] [--body-file=PATH] [--project=DIR] [--manifest=PATH]
//   mhw onboard [--project=DIR] [--scaffold]
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
// onboard validates read-only and reports each gap (exit 1 when there is one, 0 when none), and how many
// tracked files each capability owns. With --scaffold it first writes the missing baseline files, never
// one that exists, never through a directory resolving outside the project (decided for every file
// before anything is created), and never an ADR record (a record earns its place by explaining the
// current code): in the ADR library, compared case-folded and by containment on the resolved path, it
// writes only README.md and template.md.
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

// -- onboard ----------------------------------------------------------------------------------------

/** @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The name the requirements document carries: the directory's name, lowercase, hyphenated.
 * @param {string} dir
 */
export function repoName(dir) {
  const name = path.basename(dir).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return name || 'project';
}

/**
 * The default manifest for a project directory (Issue #523's default proposal).
 * @param {string} name
 * @returns {Manifest}
 */
export function defaultManifest(name) {
  const prd = 'docs/' + name + '-product-requirements-document-project.md';
  return {
    schema_version: 1,
    baseline: { readme: 'README.md', prd, adr_library: 'docs/adr', architecture: 'docs/architecture.md', sequences: 'docs/sequences.md' },
    capabilities: [{ id: 'project', code: ['**'], docs: ['README.md', prd, 'docs/**'] }],
  };
}

/**
 * The scaffold's files: path -> content, for the manifest's baseline. Never an ADR record.
 * @param {Manifest} manifest
 * @param {string} name
 * @param {boolean} withManifest
 */
export function scaffoldFiles(manifest, name, withManifest) {
  const b = manifest.baseline;
  const prd = /** @type {string} */ (b.prd);
  const adr = /** @type {string} */ (b.adr_library);
  /** @type {Array<[string, string]>} */
  const files = [
    [/** @type {string} */ (b.readme), '# ' + name + '\n\nWhat this project is and what it does today, mirroring its requirements document,\n['
      + prd + '](' + prd + '). Keep the two in step: a change that alters what the project does updates both.\n\n'
      + '## Decisions\n\nThe decision records are in [' + adr + '](' + adr + '/README.md).\n'],
    [prd, '# ' + name + ' Product Requirements Document: project\n\n## Problem\n\n## Users\n\n## Requirements\n\n'
      + '## Out of scope\n\n## Decisions\n\nSignificant decisions are recorded in [the ADR library](' + path.posix.relative(path.posix.dirname(prd), adr) + '/README.md).\n'],
    [adr + '/README.md', '# Decision records\n\nThe Architecture Decision Records of this repository, in MADR format. Copy\n'
      + '[template.md](template.md) for a new one. A record is written only when a significant decision\n'
      + 'explains the current code; there is no record yet.\n\n## Index\n\n| Record | Decision | Status |\n| --- | --- | --- |\n'],
    [adr + '/template.md', '# NNNN — Title of the decision\n\n- Status: proposed\n- Deciders:\n- Date:\n\n'
      + '## Context and problem\n\n## Decision drivers\n\n## Considered options\n\n## Decision outcome\n\n'
      + '## Consequences\n\nGood:\n\nBad:\n\n## Links\n'],
  ];
  if (typeof b.architecture === 'string') {
    files.push([b.architecture, '# Architecture\n\nRead bottom-up. Replace each layer with this project\'s own.\n\n```mermaid\nblock-beta\n  columns 1\n'
      + '  L3["Application · project contributors"]\n  L2["Runtime · project contributors"]\n  L1["Platform · vendor"]\n'
      + '  classDef project fill:#CDEDE2,stroke:#009E73,stroke-width:2px,color:#1d2228\n'
      + '  classDef vendor fill:#E3E5E8,stroke:#6b7178,stroke-width:2px,color:#1d2228,stroke-dasharray:5 4\n'
      + '  class L3,L2 project\n  class L1 vendor\n```\n\n*Read bottom-up. Grey dashed: vendor. Green: project contributors.*\n']);
  }
  if (typeof b.sequences === 'string') {
    files.push([b.sequences, '# Sequences\n\nOne flow per diagram, left to right. Replace the steps with this project\'s own.\n\n'
      + '```mermaid\nflowchart LR\n  A[Request] --> B[Validate] --> C[Store] --> D[Respond]\n```\n']);
  }
  if (withManifest) files.push([MANIFEST, JSON.stringify(manifest, null, 2) + '\n']);
  for (const [file] of files) {
    // The scaffold never writes a record. Only the index and the template enter the library. Compared
    // case-folded (a case-insensitive file system makes docs/ADR the library) and by containment, so a
    // subdirectory of the library is the library too (PR #528 lens). writeMissing repeats the test on
    // the resolved path, which a link inside the project could otherwise route into the library.
    if (inAdrLibrary(file, adr)) throw new UsageError('refusing to scaffold a decision record: ' + file);
  }
  return files;
}

/**
 * True when file is at or under the ADR library and is not its index or template. Case-folded on every
 * file system: refusing a case-variant directory on a case-sensitive one costs a message, while
 * accepting it on a case-insensitive one writes a record.
 * @param {string} file a '/'-separated path, relative or absolute
 * @param {string} adr the library, in the same form
 */
export function inAdrLibrary(file, adr) {
  const f = file.toLowerCase();
  const a = adr.toLowerCase().replace(/\/+$/, '');
  if (f !== a && !f.startsWith(a + '/')) return false;
  return !(f === a + '/readme.md' || f === a + '/template.md');
}

/**
 * Write the missing scaffold files under root; never one that exists, never outside root.
 * @param {string} root the project's real path
 * @param {Array<[string, string]>} files
 * @param {string | null} [adr] the ADR library's project-relative path; a target resolving into it
 *   other than its README.md or template.md is refused
 * @returns {string[]} the files written
 */
export function writeMissing(root, files, adr = null) {
  const written = [];
  const missing = files
    .map(([rel, content]) => /** @type {[string, string, string]} */ ([rel, content, path.join(root, ...rel.split('/'))]))
    .filter(([, , target]) => !fs.existsSync(target) && !isSymlink(target));
  // Confinement is decided for every file BEFORE anything is created: the nearest ancestor that exists
  // (a symlink counts as existing, dangling or not) must resolve inside the project, so every directory
  // mkdir creates is new and below it. Checking after mkdir created directories through a link (PR #528).
  const library = adr === null ? null : resolved(path.join(root, ...adr.split('/')));
  for (const [rel, , target] of missing) {
    if (!confinedAncestor(root, path.dirname(target))) {
      throw new UsageError('refusing to write ' + rel + ': its directory resolves outside the project');
    }
    const at = resolved(target);
    if (library !== null && at !== null && inAdrLibrary(at.split(path.sep).join('/'), library.split(path.sep).join('/'))) {
      throw new UsageError('refusing to write ' + rel + ': it resolves into the ADR library, where only README.md and template.md are scaffolded');
    }
  }
  for (const [rel, content, target] of missing) {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    try {
      fs.writeFileSync(target, content, { flag: 'wx' });
      written.push(rel);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
  }
  return written;
}

/**
 * True when the nearest existing ancestor of dir (dir included) is a directory inside root.
 * @param {string} root the project's real path
 * @param {string} dir
 */
export function confinedAncestor(root, dir) {
  const real = resolved(dir, true);
  return real !== null && (real === root || real.startsWith(root + path.sep));
}

/**
 * p as it would resolve: the real path of its nearest existing ancestor (a symlink counts as existing,
 * dangling or not), with the components that do not exist yet appended; null when that ancestor cannot
 * be resolved (a dangling link) or, with mustBeDir, is not a directory.
 * @param {string} p an absolute path
 * @param {boolean} [mustBeDir] whether the nearest existing ancestor itself must be a directory
 */
export function resolved(p, mustBeDir = false) {
  let at = p;
  const rest = [];
  for (;;) {
    let exists = true;
    try {
      fs.lstatSync(at);
    } catch {
      exists = false;
    }
    if (exists) break;
    const up = path.dirname(at);
    if (up === at) return null;
    rest.unshift(path.basename(at));
    at = up;
  }
  try {
    const real = fs.realpathSync.native(at);
    if (mustBeDir && !fs.statSync(real).isDirectory()) return null;
    return rest.length ? path.join(real, ...rest) : real;
  } catch {
    return null;
  }
}

/** @param {string} p */
function isSymlink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

/**
 * The read-only validation: one line per finding, and the gap count.
 * @param {string} root
 * @param {Record<string, string | undefined>} env
 * @param {string} [platform]
 * @returns {{ gaps: number, lines: string[] }}
 */
export function validate(root, env, platform) {
  /** @type {string[]} */
  const lines = [];
  let gaps = 0;
  const gap = (/** @type {string} */ s) => {
    gaps += 1;
    lines.push('GAP   ' + s);
  };
  /** @type {Manifest} */
  let manifest;
  let manifestValid = false;
  try {
    manifest = readManifest(path.join(root, MANIFEST));
    manifestValid = true;
    lines.push('OK    ' + MANIFEST + ' is a valid manifest, ' + manifest.capabilities.length + ' capabilities');
  } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    gap(e.message);
    manifest = defaultManifest(repoName(root));
    lines.push('NOTE  the items below are checked against the default baseline');
  }
  const b = manifest.baseline;
  const need = (/** @type {string} */ label, /** @type {string} */ rel) => {
    if (isFile(path.join(root, ...rel.split('/')))) lines.push('OK    ' + label + ': ' + rel);
    else gap(label + ': ' + rel + ' is missing');
  };
  need('README', /** @type {string} */ (b.readme));
  need('requirements document', /** @type {string} */ (b.prd));
  need('ADR library index', b.adr_library + '/README.md');
  need('ADR template', b.adr_library + '/template.md');
  for (const key of ['architecture', 'sequences']) {
    const item = b[key];
    if (typeof item !== 'string') {
      lines.push('NOTE  ' + key + ': not applicable, ' + item.not_applicable);
      continue;
    }
    const file = path.join(root, ...item.split('/'));
    if (!isFile(file)) gap(key + ' diagram: ' + item + ' is missing');
    else if (!fs.readFileSync(file, 'utf8').split('\n').some((l) => l.trimEnd() === '```mermaid')) gap(key + ' diagram: ' + item + ' carries no ```mermaid block');
    else lines.push('OK    ' + key + ' diagram: ' + item);
  }
  if (manifestValid) {
    let tracked = null;
    try {
      const g = gitIn(root, env, platform);
      const top = git(g, ['rev-parse', '--show-toplevel']).trim();
      // native: on Windows git prints the long path where a temporary directory may be an 8.3 short one.
      if (top && fs.realpathSync.native(top) === fs.realpathSync.native(root)) tracked = git(g, ['ls-files', '-z']).split('\0').filter(Boolean);
    } catch (e) {
      if (!(e instanceof GitError)) throw e;
    }
    if (tracked === null) {
      lines.push('NOTE  coverage not checked: ' + root + ' is not the top of a git repository');
    } else {
      const out = tracked.filter((f) => !manifest.capabilities.some((c) => anyMatches(c.code, f) || anyMatches(c.docs, f)));
      if (out.length) gap(out.length + ' tracked file(s) outside every capability, first: ' + out.slice(0, 5).join(', '));
      else lines.push('OK    every one of ' + tracked.length + ' tracked files belongs to a capability');
      // How much each capability owns (first match, as the check assigns it): a catch-all that owns most
      // of the tree means almost any document edit satisfies almost any change (PR #528 lens).
      /** @type {Map<string, number>} */
      const owned = new Map();
      for (const f of tracked) {
        const owner = manifest.capabilities.find((c) => anyMatches(c.code, f));
        if (owner) owned.set(owner.id, (owned.get(owner.id) || 0) + 1);
      }
      lines.push('NOTE  tracked files each capability owns (first match): '
        + manifest.capabilities.map((c) => c.id + ' ' + (owned.get(c.id) || 0)).join(', ') + ' of ' + tracked.length);
    }
  }
  const policy = path.join(root, 'project-policy.json');
  if (isFile(policy)) {
    let extra = [];
    try {
      const doc = JSON.parse(fs.readFileSync(policy, 'utf8'));
      extra = doc?.baseline_override?.documentation?.additional_docs ?? [];
    } catch {
      gap('project-policy.json is not JSON; run mhw policy check');
    }
    for (const d of Array.isArray(extra) ? extra : []) {
      if (d && typeof d.path === 'string' && !badPath(d.path, false)) need('additional document (project-policy.json)', d.path);
    }
    lines.push('NOTE  project-policy.json is present; mhw policy check validates it, this command does not');
  }
  lines.push(gaps ? 'GAP   ' + gaps + ' gap(s) in the documentation baseline' : 'OK    the documentation baseline is complete');
  return { gaps, lines };
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
const ONBOARD_USAGE = 'usage: mhw onboard [--project=DIR] [--scaffold]\n';

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
 * `mhw onboard ...`
 * @param {string[]} argv
 * @param {Io} io
 */
export function runOnboard(argv, io) {
  try {
    const o = options(argv, ['--project'], ['--scaffold']);
    const dir = path.resolve(io.cwd, /** @type {string} */ (o['--project'] ?? '.'));
    let root;
    try {
      root = fs.realpathSync.native(dir);
      if (!fs.statSync(root).isDirectory()) throw new Error('not a directory');
    } catch {
      throw new UsageError('not a directory: ' + dir);
    }
    if (o['--scaffold']) {
      const existing = isFile(path.join(root, MANIFEST)) ? readManifest(path.join(root, MANIFEST)) : null;
      const manifest = existing || defaultManifest(repoName(root));
      const written = writeMissing(root, scaffoldFiles(manifest, repoName(root), existing === null), /** @type {string} */ (manifest.baseline.adr_library));
      for (const rel of written) io.out('WROTE ' + rel + '\n');
      if (!written.length) io.out('NOTE  nothing to write: every baseline file exists\n');
    }
    const { gaps, lines } = validate(root, io.env, io.platform);
    io.out(lines.join('\n') + '\n');
    return gaps ? 1 : 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err('mhw onboard: ' + e.message + '\n' + ONBOARD_USAGE);
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
export const onboardMain = entry(runOnboard);
