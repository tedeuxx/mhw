// mhw delivery merge|verify: the gated merge and the read-only proof for both delivery routes (#474, S03
// of #470). It replaces workspace/delivery.py with the same gate decisions; test/golden/S03/ holds that
// script's own transcripts, so the parity survives its deletion. node: modules only.
//
// A slice PR targets the integration branch rc/next; only the release candidate (rc/next -> main) may
// target main. No credentials, prompts or transcripts are read or persisted. Exit 1 means
// pending/blocked, exit 2 a usage error. `merge` changes GitHub only after the local and remote gates
// pass; `verify` never writes.
//
// It acts on the git checkout that holds the current directory (the nearest directory upward with a
// .git entry), where delivery.py acted on the checkout it was stored in. Run it from the checkout.
//
// Review artifacts, in the tadeumendonca-skills plugin's own formats (agents/quality-assurance.md, read at
// that repository's origin/main 01045b660fc31fa6cb4f063fc0c5a2f1aa04db7c). Only a strict header at the
// very top of a comment counts; nothing in the prose below it is read, so a fence, a blockquote or a
// sentence can never supply or override a verdict. Lines are compared whole (a trailing CR from a CRLF
// body is the only thing removed), never as substrings.
//   quality-assurance (the method's required shape, lines 1-4 exactly as its brief fixes them):
//     line 1  <!-- gatekeeper-verdict: quality-assurance -->
//     line 2  one verdict literal, alone on the line
//     line 3  head: <full 40-character head SHA>
//     line 4  owner-check: none | <one live act for the owner>   (#134: mandatory; absent = malformed)
//   agents-lead: lines 1-2 are the plugin's required shape. LINE 3 IS THIS REPOSITORY'S CONTRACT, NOT THE
//   PLUGIN'S: the plugin brief asks for "the lens is CLOSED" in those words but fixes no position, so a
//   marker that only follows the plugin brief is refused here (fail closed) until line 3 says it.
//     line 1  <!-- harness-lead-verdict: <one-line summary> -->
//     line 2  commit: <full 40-character SHA>
//     line 3  the lens is CLOSED      (any other line 3 means the lens is open)
//   A CLOSED lens at an earlier commit carries forward to the head (owner ruling on #474, 2026-11-18) when
//   (a) that commit is an ancestor of the head, (b) its merge-base with the base branch equals the head's,
//   and (c) the delta from it to the head touches no harness path. Anything that cannot be read refuses.
//
// Python semantics are kept where a value from gh could make them differ: truthiness (an empty list or
// object is false), dict.get defaults (only for an absent key), str.strip and \s (Python's whitespace
// set, not JavaScript's), and json.dumps's separators and ASCII escaping.
import fs from 'node:fs';
import path from 'node:path';
import { toolRunner } from '../lib/gh.js';

export const INTEGRATION = 'rc/next';
export const RELEASE = 'main';
export const TESTS_WORKFLOW = 'tests';
// Required per base, in the order a refusal names them. semver-label runs only on PRs into main.
/** @type {Readonly<Record<string, readonly string[]>>} */
export const REQUIRED = Object.freeze({
  [INTEGRATION]: Object.freeze(['delivery-ci', 'SonarCloud Code Analysis', 'docs-baseline']),
  [RELEASE]: Object.freeze(['delivery-ci', 'semver-label', 'SonarCloud Code Analysis', 'docs-baseline']),
});
// mergeStateStatus values a merge may proceed from; DIRTY, BEHIND, BLOCKED, UNKNOWN, UNSTABLE refuse.
export const MERGEABLE_STATES = Object.freeze(['CLEAN', 'HAS_HOOKS']);
export const GATE_PREFIX = '<!-- gatekeeper-verdict';
export const GATE_HEADER = '<!-- gatekeeper-verdict: quality-assurance -->';
export const LENS_PREFIX = '<!-- harness-lead-verdict';
export const LENS_CLOSED = 'the lens is CLOSED';
// Only this exact line authorizes a merge (the merge-authority contract, v3). #134 retired the boundary
// literal with no transition window; it is refused by name so the refusal says what to do.
export const MERGE_LITERALS = Object.freeze(['APPROVE-AND-MERGE']);
export const RETIRED_LITERALS = Object.freeze(['APPROVE-AND-MERGE-BOUNDARY']);
export const TRUSTED_AUTHORS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);
// Hold 2's harness-path list for a consuming repository, at any depth, plus this repository's own other
// harness carriers, .agents/ and .kiro/ (stricter, never looser). Compared by path component.
export const HARNESS_DIRS = Object.freeze(new Set(['.claude', '.codex', '.github', '.agents', '.kiro']));
export const HARNESS_FILES = Object.freeze(new Set(['AGENTS.md', 'CLAUDE.md']));
export const MERGED = 'MERGED: ';
// gh api filters with --jq so only what a gate reads crosses the pipe: a compare payload carries every
// file's patch, and a large PR's compare ran past spawnSync's buffer (ENOBUFS). One argument each, `--jq=`.
// The behind count prints as a bare integer; anything else (an absent key prints nothing) refuses.
export const BEHIND_JQ = '--jq=.behind_by';
export const STATUS_JQ = '--jq={status}';
// Each run keeps only the keys read below, and a key that is absent stays absent.
export const RUNS_JQ = '--jq=.workflow_runs |= map(with_entries(select(.key == "id" or .key == "head_sha"'
  + ' or .key == "event" or .key == "conclusion")))';
const BEHIND_BY = /^(?:0|[1-9][0-9]*)$/;
const USAGE = 'usage: mhw delivery {merge,verify} --pr N';

// Python's str whitespace (str.isspace, which re's \s and str.strip use), as a character-class body.
const SP = '\\t\\n\\v\\f\\r \\x1c-\\x1f\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000';
// [^\n] where Python's regex has `.`: JavaScript's `.` also refuses \r, \u2028 and \u2029.
const LENS_HEADER = /^<!-- harness-lead-verdict: (?:(?!-->)[^\n])* -->$/;
const OWNER_CHECK_LINE = new RegExp('^owner-check: [^' + SP + '](?:[^\\n]*[^' + SP + '])?$');
const HEAD_LINE = /^head: ([0-9a-f]{40})$/;
const COMMIT_LINE = /^commit: ([0-9a-f]{40})$/;
const REMOTE = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/;
const SEMVER_TAG = /^v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/;
const IS_SPACE = new RegExp('^[' + SP + ']$');
const SPLIT_WS = new RegExp('[' + SP + ']+');
const CURRENT_VERSION = new RegExp('current_version[' + SP + ']*=[' + SP + ']*"([0-9.]+)"', 'y');

/** A refusal the route explains: exit 1, "PENDING: <message>". */
export class Pending extends Error {}
/** Anything unexpected: exit 1, with no detail that could carry remote content. */
class Unavailable extends Error {}

/**
 * Why a tool could not run, for an Unavailable: its output overflowing the buffer is told apart. The
 * route still prints no detail; the reason is for tests and a debugger.
 * @param {Error & { code?: string }} error
 */
export function failureReason(error) {
  return error && error.code === 'ENOBUFS' ? 'output too large' : 'could not run';
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isDict = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Python's dict.get: the default only when the key is absent (a present null stays null).
 * @param {unknown} o @param {string} k @param {unknown} [d]
 * @returns {any}
 */
function get(o, k, d) {
  if (!isDict(o)) throw new Unavailable('not an object');
  return Object.hasOwn(o, k) ? o[k] : d;
}

/** Python's o[k]: an absent key is a KeyError. @param {unknown} o @param {string} k @returns {any} */
function need(o, k) {
  if (!isDict(o) || !Object.hasOwn(o, k)) throw new Unavailable('missing ' + k);
  return o[k];
}

/** Python truthiness of a JSON value. @param {unknown} v */
export function truthy(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(v).length > 0;
  return Boolean(v);
}

/** Python's `a or b`. @param {unknown} a @param {unknown} b */
const or = (a, b) => (truthy(a) ? a : b);

/** @param {unknown} s */
function str(s) {
  if (typeof s !== 'string') throw new Unavailable('not a string');
  return s;
}

/** Python's str.strip(). @param {string} s */
export function strip(s) {
  // A scan from each end, one character at a time: linear, where a trailing [ws]+$ regex backtracks.
  let start = 0;
  let end = s.length;
  while (start < end && IS_SPACE.test(s[start])) start++;
  while (end > start && IS_SPACE.test(s[end - 1])) end--;
  return s.slice(start, end);
}

/** Python's str() of a JSON scalar, for a refusal message. @param {unknown} v */
function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  return typeof v === 'string' ? v : JSON.stringify(v);
}

// The line boundaries str.splitlines() honours beyond \r and \n, control characters included on purpose:
// \v \f, the file, group and record separators (0x1c-0x1e), NEL (0x85), and U+2028 and U+2029.
const LINE_BOUNDARIES = new RegExp('[\\n' + String.fromCodePoint(0x0b, 0x0c, 0x1c, 0x1d, 0x1e, 0x85, 0x2028, 0x2029) + ']');

/** Python's str.splitlines() of text read with universal newlines. @param {string} text */
function splitlines(text) {
  const lines = text.replace(/\r\n?/g, '\n').split(LINE_BOUNDARIES);
  if (lines.length && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/** Python's json.dumps with its default separators and ensure_ascii. @param {unknown} v @returns {string} */
export function pyDumps(v) {
  if (Array.isArray(v)) return '[' + v.map(pyDumps).join(', ') + ']';
  if (isDict(v)) return '{' + Object.entries(v).map(([k, x]) => pyDumps(k) + ': ' + pyDumps(x)).join(', ') + '}';
  if (v === undefined) return 'null';
  const out = JSON.stringify(v);
  return out.replace(/[^\x00-\x7f]/g, (c) => '\\u' + (c.codePointAt(0) ?? 0).toString(16).padStart(4, '0'));
}

/** A UTF-8 file as Python's read_text(encoding="utf-8") reads it: strict, BOM kept. @param {string} file */
function readUtf8(file) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file));
}

/** @param {unknown} tag @returns {bigint[]} */
export function version(tag) {
  const m = typeof tag === 'string' ? SEMVER_TAG.exec(tag) : null;
  if (!m) {
    if (typeof tag !== 'string') throw new Unavailable('tag');
    throw new Pending('release tag is not a numeric SemVer');
  }
  return [BigInt(m[1]), BigInt(m[2]), BigInt(m[3])];
}

/** Python's comparison of two tuples of strings and integers. @param {any[]} a @param {any[]} b */
function cmp(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (typeof a[i] !== typeof b[i]) throw new Unavailable('incomparable');
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

/** The name a check reports under. @param {unknown} c */
const checkName = (c) => get(c, 'name', get(c, 'context'));
/** The conclusion a check reports. @param {unknown} c */
const checkConclusion = (c) => get(c, 'conclusion', get(c, 'state'));

/**
 * Keep only the most recent run of each check on this head. A re-run reports a second entry with the
 * same workflow and name; the superseded one must neither block nor satisfy the gate. Ordered by start
 * time, then completion time, then rollup position, so a pending re-run still counts as pending.
 * @param {unknown[]} checks
 */
export function latestChecks(checks) {
  /** @type {Map<string, [any[], unknown]>} */
  const latest = new Map();
  checks.forEach((check, index) => {
    const key = JSON.stringify([or(get(check, 'workflowName'), ''), checkName(check) ?? null]);
    const stamp = [or(get(check, 'startedAt'), ''), or(get(check, 'completedAt'), ''), index];
    const prior = latest.get(key);
    if (!prior || cmp(stamp, prior[0]) >= 0) latest.set(key, [stamp, check]);
  });
  return [...latest.values()].map(([, check]) => check);
}

/**
 * The jobs the stable delivery-ci job aggregates, read from the workflow itself, not restated: the
 * `needs:` key directly inside the delivery-ci job block, by a line scan.
 * @param {string} root
 */
export function testsJobs(root) {
  let inside = false;
  for (const line of splitlines(readUtf8(path.join(root, '.github', 'workflows', 'tests.yml')))) {
    if (line === '  delivery-ci:') inside = true;
    else if (inside && !line.startsWith('    ')) break;
    else if (inside && line.startsWith('    needs: [') && line.endsWith(']')) {
      const jobs = line.slice('    needs: ['.length, -1).split(',').map(strip).filter(Boolean);
      if (jobs.length) return jobs;
    }
  }
  throw new Pending("cannot read the tests workflow's delivery-ci job list");
}

/**
 * The tests workflow must actually have run on this head: a CLEAN PR with no tests run is not green.
 * Every job delivery-ci needs (a matrix job reports as "job (variant)") and delivery-ci itself must be
 * reported by the tests workflow, not merely by a same-named check from somewhere else.
 * @param {unknown[]} checks @param {string[]} jobs
 */
export function testsRegistered(checks, jobs) {
  const names = checks.filter((c) => get(c, 'workflowName') === TESTS_WORKFLOW).map((c) => str(or(checkName(c), '')));
  for (const job of [...jobs, 'delivery-ci']) {
    if (!names.some((n) => n === job || n.startsWith(job + ' ('))) {
      throw new Pending('the tests workflow has not registered on this head: ' + job);
    }
  }
}

/** @param {Record<string, any>} pr @param {string[]} jobs */
export function checksPass(pr, jobs) {
  const rollup = or(get(pr, 'statusCheckRollup'), []);
  if (!Array.isArray(rollup)) throw new Unavailable('rollup');
  const checks = latestChecks(rollup);
  testsRegistered(checks, jobs);
  for (const name of REQUIRED[get(pr, 'baseRefName')]) {
    const matches = checks.filter((c) => checkName(c) === name);
    if (!matches.length || matches.some((c) => checkConclusion(c) !== 'SUCCESS')) {
      throw new Pending('required CI not successful: ' + name);
    }
  }
  // Never ignore another failed or pending workflow reported for this head.
  for (const check of checks) {
    if (!['SUCCESS', 'NEUTRAL', 'SKIPPED'].includes(checkConclusion(check))) {
      throw new Pending('another head check is pending or failed');
    }
  }
}

/** @param {Record<string, any>} pr @param {string} head */
export function prMatches(pr, head) {
  const base = get(pr, 'baseRefName');
  if (get(pr, 'headRefOid') !== head || typeof base !== 'string' || !Object.hasOwn(REQUIRED, base) || truthy(get(pr, 'isCrossRepository'))) {
    throw new Pending('PR does not match this exact local head and a same-repository rc/next or main target');
  }
  // A slice never goes straight to main: the only PR main accepts is the release candidate.
  if (base === RELEASE && get(pr, 'headRefName') !== INTEGRATION) {
    throw new Pending('only the rc/next release candidate may target main; open the slice against rc/next');
  }
  if (base === INTEGRATION && [INTEGRATION, RELEASE].includes(get(pr, 'headRefName'))) {
    throw new Pending('a slice must come from its own feature branch');
  }
  const all = get(pr, 'labels', []);
  if (!Array.isArray(all)) throw new Unavailable('labels');
  const labels = all.map((v) => str(need(v, 'name'))).filter((n) => n.startsWith('semver:'));
  if (labels.length !== 1 || !['semver:major', 'semver:minor', 'semver:patch'].includes(labels[0])) {
    throw new Pending('PR must carry exactly one valid semver label');
  }
}

/**
 * The first lines of a comment, whole, with only a CRLF's trailing CR removed.
 * @param {unknown} comment @param {number} [size]
 */
export function header(comment, size = 3) {
  const lines = str(or(get(comment, 'body'), '')).split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  while (lines.length < size) lines.push('');
  return lines.slice(0, size);
}

/** @param {unknown} comment */
const trusted = (comment) => TRUSTED_AUTHORS.includes(get(comment, 'authorAssociation'));

/**
 * The newest trusted comment whose FIRST line opens with the envelope; a quoted one never counts.
 * @param {unknown[]} comments @param {string} prefix
 */
function newest(comments, prefix) {
  const found = comments.filter((c) => trusted(c) && header(c, 1)[0].startsWith(prefix));
  return found.length ? found[found.length - 1] : null;
}

/**
 * The newest agents-lead lens marker, selected as the quality-assurance brief selects it (#522 round 3):
 * a trusted comment that does not open with the gatekeeper envelope and has a line opening with the lens
 * envelope at column 0 outside a fenced code block (a line whose first characters, after at most three
 * spaces, are three backticks or three tildes opens or closes one). Selection is broad so a newer marker with a preamble
 * still withdraws an older CLOSED one; lensClosed then requires the strict three-line header, so such a
 * marker refuses (lens round 1 on PR #508).
 * @param {unknown[]} comments
 */
function newestLens(comments) {
  const found = comments.filter((c) => {
    if (!trusted(c)) return false;
    const body = str(or(get(c, 'body'), ''));
    if (body.startsWith(GATE_PREFIX)) return false;
    let fenced = false;
    for (const raw of body.split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && line.startsWith(LENS_PREFIX)) return true;
    }
    return false;
  });
  return found.length ? found[found.length - 1] : null;
}

/**
 * The newest quality-assurance verdict must be well formed, name this exact head and authorize it.
 * Newest wins whatever it says: a later REQUEST-CHANGES (or a malformed verdict) beats an earlier
 * approval at the same head.
 * @param {unknown[]} comments @param {string} head
 */
export function gateApproves(comments, head) {
  const verdict = newest(comments, GATE_PREFIX);
  if (verdict === null) throw new Pending('no quality-assurance gatekeeper-verdict on the PR');
  const [envelope, literal, headLine, ownerCheck] = header(verdict, 4);
  const named = HEAD_LINE.exec(headLine);
  if (envelope !== GATE_HEADER || !named) {
    throw new Pending('the newest gatekeeper-verdict is not in the strict header format');
  }
  if (!OWNER_CHECK_LINE.test(ownerCheck)) {
    throw new Pending('the newest gatekeeper-verdict has no owner-check line on line 4 (malformed)');
  }
  if (named[1] !== head) throw new Pending('the newest gatekeeper-verdict does not name the current head');
  if (RETIRED_LITERALS.includes(literal)) {
    throw new Pending('the newest gatekeeper-verdict carries the retired literal ' + literal
      + '; re-verdict at this head with APPROVE-AND-MERGE and an owner-check line');
  }
  if (!MERGE_LITERALS.includes(literal)) {
    throw new Pending('the newest gatekeeper-verdict does not authorize a merge: ' + literal);
  }
}

/** The paths that are harness paths. @param {string[]} paths */
export function harnessPaths(paths) {
  return paths.filter((p) => {
    // A path git quoted (core.quotePath, a non-ASCII or unusual byte) cannot be read by component, so it
    // counts as a harness path: fail closed (lens round 1 on PR #508). The diffs run with -z, which
    // quotes nothing, so this is defence in depth.
    if (p.startsWith('"')) return true;
    const parts = p.split('/');
    return parts.slice(0, -1).some((x) => HARNESS_DIRS.has(x)) || HARNESS_FILES.has(parts[parts.length - 1]);
  });
}

/**
 * @typedef {{ isAncestor: (commit: string, head: string) => number, mergeBase: (ref: string) => string,
 *   delta: (commit: string, head: string) => string[], base: string }} History
 */

/**
 * The history the carry-forward reads, from git in the checkout (exec runs it there).
 * @param {import('../lib/gh.js').ToolRunner} exec @param {string} base the base branch, read as origin/<base>
 * @returns {History}
 */
export function gitHistory(exec, base) {
  /** @param {string[]} args */
  const git = (...args) => {
    const r = exec('git', args);
    if (r.error) throw new Unavailable(failureReason(r.error));
    if (r.code) throw new Pending('command failed or remote unavailable: git; details omitted');
    return r.stdout;
  };
  return {
    base,
    isAncestor: (commit, to) => {
      const r = exec('git', ['merge-base', '--is-ancestor', commit, to]);
      return r.error ? 2 : r.code;
    },
    // Every best common ancestor, as a sorted set: a criss-cross history has more than one, and plain
    // merge-base prints only one of them (QA B3 and lens round 1 on PR #508). An empty set refuses.
    mergeBase: (ref) => {
      const set = splitlines(strip(git('merge-base', '--all', 'origin/' + base, ref))).sort((a, b) => a.localeCompare(b));
      if (!set.length) throw new Pending('cannot read the merge-base with ' + base);
      return set.join(' ');
    },
    // NUL-separated, so git quotes no path the harness test reads.
    delta: (commit, to) => nulNames(git('diff', '--no-renames', '--name-only', '-z', commit, to)),
  };
}

/** The paths of a NUL-terminated `--name-only -z` list. @param {string} out */
export const nulNames = (out) => out.split('\0').filter((p) => p !== '');

/**
 * Whether a CLOSED lens at commit carries forward to head; null when it does, else the reason.
 * @param {string} commit @param {string} head @param {History} history
 */
export function carryForward(commit, head, history) {
  const ancestor = history.isAncestor(commit, head);
  if (ancestor === 1) return '(a) its commit is not an ancestor of the head';
  if (ancestor !== 0) return '(a) its commit cannot be read in this checkout';
  if (history.mergeBase(commit) !== history.mergeBase(head)) {
    return '(b) the merge-base with ' + history.base + ' moved since its commit';
  }
  const touched = harnessPaths(history.delta(commit, head));
  if (touched.length) return '(c) the delta since its commit touches a harness path: ' + touched[0];
  return null;
}

/**
 * Hold 2: the newest agents-lead lens marker must say CLOSED on line 3 and name this exact head, or an
 * earlier commit it carries forward from. A newer marker that leaves the lens open withdraws an earlier
 * closed one.
 * @param {unknown[]} comments @param {string} head @param {History} history
 */
export function lensClosed(comments, head, history) {
  const marker = newestLens(comments);
  if (marker === null) throw new Pending('harness paths changed and no agents-lead lens marker is on the PR');
  const [envelope, commitLine, state] = header(marker);
  const named = COMMIT_LINE.exec(commitLine);
  if (!LENS_HEADER.test(envelope) || !named) {
    throw new Pending('the newest agents-lead lens marker is not in the strict header format');
  }
  if (named[1] !== head) {
    if (state !== LENS_CLOSED) throw new Pending('the newest agents-lead lens marker does not name the current head');
    const reason = carryForward(named[1], head, history);
    if (reason !== null) {
      throw new Pending('the newest agents-lead lens marker does not name the current head; it does not carry forward: ' + reason);
    }
    return;
  }
  if (state !== LENS_CLOSED) {
    throw new Pending('the newest agents-lead lens marker at this head does not say the lens is CLOSED');
  }
}

/**
 * The slice review gate: a QA approval at this head, and the lens closed for it on harness paths.
 * @param {Record<string, any>} pr @param {string} head @param {string[]} paths @param {History} history
 */
export function reviewGate(pr, head, paths, history) {
  const comments = or(get(pr, 'comments'), []);
  if (!Array.isArray(comments)) throw new Unavailable('comments');
  gateApproves(comments, head);
  if (harnessPaths(paths).length) lensClosed(comments, head, history);
}

/** @param {Record<string, any>} pr */
export function mergeable(pr) {
  const state = get(pr, 'mergeStateStatus');
  if (!MERGEABLE_STATES.includes(state)) throw new Pending('PR merge state is not clean: ' + pyStr(state));
}

/**
 * A real merge commit, never a squash or a rebase (owner, 2026-10-05: workstation standard). The merge
 * commit keeps the session head as its second parent, so verify's ancestry check holds for every
 * session commit.
 * @param {string} number @param {string} repo @param {string} head
 */
export function mergeCommand(number, repo, head) {
  return ['gh', 'pr', 'merge', number, '--repo', repo, '--merge', '--match-head-commit', head];
}

/** @param {Record<string, any>} release @param {string} baseline @param {Record<string, any>} comparison */
export function releaseMatches(release, baseline, comparison) {
  if (truthy(get(release, 'draft')) || truthy(get(release, 'prerelease')) || !truthy(get(release, 'published_at'))) {
    throw new Pending('release is not publicly published as a stable release');
  }
  if (cmp(version(get(release, 'tag_name', '')), version('v' + baseline)) <= 0) {
    throw new Pending('no newer session release is published');
  }
  if (!['ahead', 'identical'].includes(get(comparison, 'status'))) {
    throw new Pending('release does not contain the session merge commit');
  }
}

/**
 * The action and the PR number, the way delivery.py's argparse read them; null with a message on a
 * usage error.
 * @param {string[]} argv
 * @returns {{ action: string, pr: bigint } | { help: true } | { error: string }}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let action;
  /** @type {string | undefined} */
  let pr;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') return { help: true };
    if (a === '--pr') {
      if (i + 1 >= argv.length) return { error: 'argument --pr: expected one argument' };
      pr = argv[++i];
    } else if (a.startsWith('--pr=')) pr = a.slice('--pr='.length);
    else if (a.startsWith('-') && !/^-[0-9]/.test(a)) return { error: 'unrecognized arguments: ' + a };
    else if (action === undefined) action = a;
    else return { error: 'unrecognized arguments: ' + a };
  }
  if (action === undefined) return { error: 'the following arguments are required: action' };
  if (action !== 'merge' && action !== 'verify') {
    return { error: "argument action: invalid choice: '" + action + "' (choose from 'merge', 'verify')" };
  }
  if (pr === undefined) return { error: 'the following arguments are required: --pr' };
  const digits = strip(pr);
  if (!/^[+-]?[0-9]+(?:_[0-9]+)*$/.test(digits)) return { error: "argument --pr: invalid int value: '" + pr + "'" };
  return { action, pr: BigInt(digits.replaceAll('_', '')) };
}

/**
 * The checkout holding dir: the nearest directory upward with a .git entry (a directory, or a worktree's
 * file), or null.
 * @param {string} dir
 */
export function checkoutRoot(dir) {
  let d = path.resolve(dir);
  for (;;) {
    if (fs.existsSync(path.join(d, '.git'))) return d;
    const up = path.dirname(d);
    if (up === d) return null;
    d = up;
  }
}

/**
 * @typedef {import('../lib/gh.js').ToolRunner} ToolRunner
 * @typedef {{ cwd: string, env?: Record<string, string | undefined>, platform?: string, exec?: ToolRunner }} Options
 * @typedef {{ code: number, stdout: string, stderr: string }} Outcome
 */

/**
 * @param {string[]} argv the arguments after `delivery`
 * @param {Options} opts
 * @returns {Outcome}
 */
export function delivery(argv, opts) {
  const args = parseArgs(argv);
  if ('help' in args) return { code: 0, stdout: USAGE + '\n', stderr: '' };
  if ('error' in args) return { code: 2, stdout: '', stderr: USAGE + '\nmhw delivery: error: ' + args.error + '\n' };
  /** @type {string[]} */
  const out = [];
  try {
    route(args.action, args.pr, opts, out);
    return { code: 0, stdout: out.map((l) => l + '\n').join(''), stderr: '' };
  } catch (e) {
    const message = e instanceof Pending ? e.message : 'verification unavailable; details omitted';
    return { code: 1, stdout: out.map((l) => l + '\n').join(''), stderr: 'PENDING: ' + message + '\n' };
  }
}

/**
 * @param {string} action @param {bigint} number @param {Options} opts @param {string[]} out
 */
function route(action, number, opts, out) {
  if (number < 1n) throw new Pending('invalid PR number');
  const root = checkoutRoot(opts.cwd);
  if (root === null) throw new Pending('run this from a git checkout of the repository');
  const exec = opts.exec || toolRunner(root, opts.env || process.env, opts.platform || process.platform);
  /** Run a tool; its stripped stdout, or a refusal when it fails. @param {string[]} argv */
  const run = (...argv) => {
    const r = exec(argv[0], argv.slice(1));
    if (r.error) throw new Unavailable(failureReason(r.error));
    if (r.code) throw new Pending('command failed or remote unavailable: ' + argv[0] + '; details omitted');
    return strip(r.stdout);
  };
  /** Run a tool; its stdout untouched (a -z list must not lose a path's own spaces). @param {string[]} argv */
  const runRaw = (...argv) => {
    const r = exec(argv[0], argv.slice(1));
    if (r.error) throw new Unavailable(failureReason(r.error));
    if (r.code) throw new Pending('command failed or remote unavailable: ' + argv[0] + '; details omitted');
    return r.stdout;
  };
  /** @param {string} repo @param {string} p @param {string} [jq] @returns {any} */
  const api = (repo, p, jq) => {
    try {
      return JSON.parse(run('gh', 'api', 'repos/' + repo + '/' + p, ...(jq ? [jq] : [])));
    } catch (e) {
      if (e instanceof SyntaxError) throw new Unavailable('json');
      throw e;
    }
  };
  if (run('git', 'status', '--porcelain')) throw new Pending('workspace has uncommitted or untracked changes');
  const head = run('git', 'rev-parse', 'HEAD');
  let remote = run('git', 'remote', 'get-url', 'origin');
  if (remote.endsWith('.git')) remote = remote.slice(0, -4);
  const m = REMOTE.exec(remote);
  if (!m) throw new Pending('origin is not a supported GitHub repository URL');
  const repo = m[1];
  const pr = parseJson(run('gh', 'pr', 'view', String(number), '--repo', repo, '--json',
    'number,url,headRefOid,headRefName,baseRefName,isCrossRepository,state,mergeCommit,mergedAt,'
    + 'mergeStateStatus,labels,statusCheckRollup,comments'));
  if (!isDict(pr)) throw new Unavailable('pr');
  prMatches(pr, head);
  checksPass(pr, testsJobs(root));
  const base = str(need(pr, 'baseRefName'));
  if (action === 'merge') {
    if (need(pr, 'state') === 'MERGED') {
      out.push(MERGED + str(need(pr, 'url')) + '; run verify for publication proof');
      return;
    }
    if (need(pr, 'state') !== 'OPEN') throw new Pending('PR is not open');
    mergeable(pr);
    if (base === INTEGRATION) {
      // A tree diff from the merge base, never the paginated PR file list.
      run('git', 'fetch', 'origin', base);
      const paths = nulNames(runRaw('git', 'diff', '--no-renames', '--name-only', '-z', 'origin/' + base + '...' + head));
      reviewGate(pr, head, paths, gitHistory(exec, base));
    }
    const branch = run('git', 'branch', '--show-current');
    if (branch === '' || branch === base || branch !== need(pr, 'headRefName')) {
      throw new Pending("check out the PR's head branch (the slice branch, or rc/next for a release)");
    }
    const refs = run('git', 'ls-remote', '--heads', 'origin', 'refs/heads/' + branch).split(SPLIT_WS).filter(Boolean);
    if (!refs.length || refs[0] !== head) throw new Pending('session HEAD has not been pushed');
    const behind = run('gh', 'api', 'repos/' + repo + '/compare/' + base + '...' + head, BEHIND_JQ);
    if (!BEHIND_BY.test(behind)) throw new Unavailable('behind_by');
    if (behind !== '0') {
      throw new Pending('head is behind ' + base + '; update it and rerun CI');
    }
    run(...mergeCommand(String(number), repo, head));
    if (base === INTEGRATION) out.push(MERGED + str(need(pr, 'url')) + ' into rc/next; no release is cut, run verify');
    else out.push(MERGED + str(need(pr, 'url')) + '; CI publication is pending, run verify');
    return;
  }
  if (need(pr, 'state') !== 'MERGED' || !truthy(get(pr, 'mergeCommit'))) throw new Pending('session PR is not merged');
  if (base === INTEGRATION) {
    // A slice only integrates: merged with its checks green at this head; no tag or release expected.
    out.push(pyDumps({ status: 'integrated', base: INTEGRATION, session_head: head,
      pr: need(pr, 'url'), merge_commit: need(need(pr, 'mergeCommit'), 'oid') }));
    return;
  }
  const baseline = currentVersion(readUtf8(path.join(root, '.bumpversion.toml')));
  if (baseline === null) throw new Pending("cannot establish the session's baseline version");
  const release = api(repo, 'releases/latest');
  const tag = get(release, 'tag_name', '');
  version(tag); // validate before putting a remote value in an API path
  const comparison = api(repo, 'compare/' + str(need(need(pr, 'mergeCommit'), 'oid')) + '...' + tag, STATUS_JQ);
  releaseMatches(release, baseline, comparison);
  const runs = need(api(repo, 'actions/workflows/version-main.yml/runs?per_page=100', RUNS_JQ), 'workflow_runs');
  if (!Array.isArray(runs)) throw new Unavailable('runs');
  const matching = runs.filter((r) => get(r, 'head_sha') === head && get(r, 'event') === 'pull_request');
  let best = null;
  for (const r of matching) if (best === null || cmp([need(r, 'id')], [need(best, 'id')]) > 0) best = r;
  if (best === null || get(best, 'conclusion') !== 'success') {
    throw new Pending('session version workflow is not verified successful');
  }
  out.push(pyDumps({ status: 'published', session_head: head, pr: need(pr, 'url'),
    version: tag, release: need(release, 'html_url') }));
}

/** @param {string} text @returns {unknown} */
function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    throw new Unavailable('json');
  }
}

/**
 * The `current_version = "X.Y.Z"` value at the start of a line, as delivery.py's re.M search read it
 * (its \s may cross a line break).
 * @param {string} text
 */
export function currentVersion(text) {
  const t = text.replace(/\r\n?/g, '\n');
  let at = 0;
  for (;;) {
    CURRENT_VERSION.lastIndex = at;
    const m = CURRENT_VERSION.exec(t);
    if (m) return m[1];
    const nl = t.indexOf('\n', at);
    if (nl < 0) return null;
    at = nl + 1;
  }
}
