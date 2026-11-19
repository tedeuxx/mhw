// mhw worklog validate-event|prepare-event|report|export (#476, S05 of #470; the worklog of #499, #514,
// #515 and #76): the Node form of method/scripts/worklog.py, which this slice deletes. Offline: it reads
// files and writes stdout. It never calls GitHub, edits a comment, or authenticates attribution.
//
//   mhw worklog validate-event EVENT.json
//   mhw worklog prepare-event EVENT.json
//   mhw worklog report --snapshot SNAPSHOT.json --export EXPORT.json [--format json|markdown]
//                      --reproduction-command CMD
//   mhw worklog export --cutoff T --capture ISSUE.json [--capture ...] [--prior EXPORT.json]
//                      [--pagination-complete]
//
// The contract is method/scripts/worklog-contract/ (event.schema.json and README.md). Events are checked
// by the same hand validator the Python carried, field by field and in the same order, so a refusal names
// the same field with the same words; test/method/worklog.test.js runs the deleted suite's cases and checks
// the schema's enums and patterns against the constants here. What is printed, and what is hashed into a
// report's snapshot_sha256 and export_sha256, is byte for byte the Python's (src/lib/py.js: float repr,
// code-point key order, CPython's json and fromisoformat); test/golden/S05 holds the transcripts.
//
// A path an agent passes is confined to the work tree or the temporary directory before it is read
// (mhw #170, Sonar S8707): what is loaded becomes a published comment. Exit 0, 2 on a contract error or a
// usage error, 1 where CPython raised an uncaught exception (named, never a traceback). node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { confined, ConfineError } from '../lib/confine.js';
import {
  PyFloat, isPyWs, pyLen, pyStrip, cmpStr, isInt, isFloat, isDict, num, addInt, mulInt, pySum, pyRound,
  loads, dumps, JsonDecodeError, pyRepr, pyStr, fromIsoformat,
} from '../lib/py.js';

export const EVENT_MARKER = '<!-- worklog-event:v1 -->';
export const VERSION = '1.0.0';
export const EVENT_TYPES = new Set(['implementation_start', 'checkpoint', 'handoff', 'outcome', 'correction']);
export const OUTCOMES = new Set(['accepted', 'reopened', 'cancelled', 'superseded', 'no_longer_relevant']);
export const PROVENANCE = new Set(['observed', 'declared', 'unknown']);
export const CONTINUITY_TYPES = new Set(['checkpoint', 'handoff']);
export const FREE_TEXT_LIMIT = 280;
export const USAGE_TYPES = new Set(['checkpoint', 'handoff', 'outcome']);
export const USAGE_FIELDS = new Set(['model', 'effort', 'tokens_input', 'tokens_output', 'credits', 'usage_provenance']);
export const USAGE_PROVENANCE = new Set(['native', 'unavailable']);
export const USAGE_METRICS = ['tokens_input', 'tokens_output', 'credits'];

// CPython's \s, spelled out (str.isspace(), src/lib/py.js), so every pattern below reads whitespace as the
// Python did. Each pattern is anchored and its repeated classes exclude the character that follows them,
// so none backtracks.
const WS = String.raw`\t\n\v\f\r\x1c-\x20\x85\xa0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000`;
const ISSUE_RE = new RegExp('^[^/' + WS + ']+/[^#' + WS + ']+#[1-9]\\d*$', 'u');
const REPO_RE = new RegExp('^[^/' + WS + ']+/[^/#' + WS + ']+$', 'u');
const EXPORT_URL_RE = new RegExp('^https://github\\.com/([^/' + WS + ']+/[^/' + WS + ']+)/issues/([1-9]\\d*)$', 'u');
const COMMENT_URL_RE = new RegExp('^(https://github\\.com/[^/' + WS + ']+/[^/' + WS + ']+/issues/[1-9]\\d*)#issuecomment-([1-9]\\d*)$', 'u');
const SHA_RE = /^[0-9a-f]{7,40}$/;
const HASH_RE = /^[0-9a-f]{64}$/;
export const IDENTIFIER_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

export class ContractError extends Error {}
/** Where CPython raised an exception the script did not catch: exit 1, never a contract refusal. */
export class PyCrash extends Error {}

/** @typedef {Record<string, any>} Obj */

/** @param {unknown} v @returns {v is Obj} */
const dict = (v) => isDict(v);
/** @param {Obj} o @param {string} k */
const has = (o, k) => Object.hasOwn(o, k);

/** Python's canonical(): json.dumps(sort_keys=True, separators=(",", ":"), ensure_ascii=False). @param {unknown} v */
export const canonical = (v) => dumps(v);

/** UTF-8 of s, refusing a lone surrogate as CPython's str.encode() does. @param {string} s */
function utf8(s) {
  if (/\p{Cs}/u.test(s)) throw new PyCrash("UnicodeEncodeError: 'utf-8' codec can't encode a surrogate: surrogates not allowed");
  return Buffer.from(s, 'utf8');
}
/** @param {string} s */
const sha256 = (s) => crypto.createHash('sha256').update(utf8(s)).digest('hex');
/** @param {unknown} v */
export const digest = (v) => sha256(canonical(v));

// The reader filter: one of four strings at the start of the text or after whitespace or a backtick.
const PRIVATE_TOKENS = ['/Users/', '/private/tmp/', 'file://', '.brand/']; // NOSONAR javascript:S5443 - literals that REFUSE machine-local paths in published text; nothing opens a directory
/** PRIVATE_EVIDENCE.search(text) of the Python. @param {string} text */
export function privateEvidence(text) {
  const cps = Array.from(text);
  for (let i = 0; i < cps.length; i++) {
    if (i > 0 && !isPyWs(cps[i - 1]) && cps[i - 1] !== '`') continue;
    for (const t of PRIVATE_TOKENS) {
      if (cps.slice(i, i + t.length).join('') === t) return true;
    }
  }
  return false;
}

// The producer filter (#514): any of these anywhere, case-insensitively as CPython's re.IGNORECASE
// matches an ASCII letter: also U+0130 and U+0131 for i, U+017F for s and U+212A for k (measured over
// every code point on CPython 3.14). The Windows drive form needs a word boundary before the letter.
const STRICT_TOKENS = ['/tmp/', '~/', '/var/folders/', '/home/', '/users/', '/private/', 'file://']; // NOSONAR javascript:S5443 - literals that REFUSE machine-local paths in published text; nothing opens a directory
/** @type {Record<string, string>} */
const FOLD_EXTRA = { '\u0130': 'i', '\u0131': 'i', '\u017f': 's', '\u212a': 'k' };
/** The ASCII letter c matches case-insensitively, or c. @param {string} c */
const fold = (c) => FOLD_EXTRA[c] || (c >= 'A' && c <= 'Z' ? c.toLowerCase() : c);
const WORD = /[\p{L}\p{N}_]/u;
const BRAND_NEXT = /[A-Za-z0-9_-]/;
/** STRICT_PRIVATE.search(text) of the Python. @param {string} text */
export function strictPrivate(text) {
  const cps = Array.from(text);
  const low = cps.map(fold);
  const at = (/** @type {number} */ i, /** @type {string} */ t) => low.slice(i, i + t.length).join('') === t;
  for (let i = 0; i < cps.length; i++) {
    for (const t of STRICT_TOKENS) if (at(i, t)) return true;
    // \.brand(?![A-Za-z0-9_-]), the class matched case-insensitively too
    if (at(i, '.brand') && !(i + 6 < cps.length && (BRAND_NEXT.test(cps[i + 6]) || FOLD_EXTRA[cps[i + 6]]))) return true;
    // \b[A-Za-z]:\\
    if (/^[a-z]$/.test(low[i]) && cps[i + 1] === ':' && cps[i + 2] === '\\' && (i === 0 || !WORD.test(cps[i - 1]))) return true;
  }
  return false;
}

/**
 * The cohort identity of a declared harness (#515): casefolded, every character but ASCII letters and
 * digits dropped, "unknown" when nothing is left. CPython's casefold() maps these characters to ASCII
 * letters (every code point measured on CPython 3.14, Unicode 16.0); any other non-ASCII one folds to
 * nothing ASCII.
 */
/** @type {Record<string, string>} */
const CASEFOLD_ASCII = {
  '\u00df': 'ss', '\u0130': 'i', '\u0149': 'n', '\u017f': 's', '\u01f0': 'j', '\u1e96': 'h', '\u1e97': 't',
  '\u1e98': 'w', '\u1e99': 'y', '\u1e9a': 'a', '\u1e9e': 'ss', '\u212a': 'k', '\ufb00': 'ff', '\ufb01': 'fi',
  '\ufb02': 'fl', '\ufb03': 'ffi', '\ufb04': 'ffl', '\ufb05': 'st', '\ufb06': 'st',
};
/** @param {string} value */
export function harnessKey(value) {
  let key = '';
  for (const c of value) {
    if (/[0-9a-z]/.test(c)) key += c;
    else if (c >= 'A' && c <= 'Z') key += c.toLowerCase();
    else if (CASEFOLD_ASCII[c]) key += CASEFOLD_ASCII[c];
  }
  return key || 'unknown';
}

/**
 * Every complete envelope in a comment body, as EVENT_RE.findall: the marker alone at the start of a line
 * (the start of the body or after "\n"), [ \t]*, an optional CR, a newline, whitespace, ```json, whitespace,
 * then the shortest {...} followed by whitespace and ```. A scan, not a regular expression: the same
 * matches, with no backtracking.
 * @param {string} body
 * @returns {string[]}
 */
export function eventBodies(body) {
  const s = Array.from(body);
  const n = s.length;
  const marker = Array.from(EVENT_MARKER);
  const out = [];
  let pos = 0;
  /** @param {number} i @param {string[]} t */
  const starts = (i, t) => t.every((c, k) => s[i + k] === c);
  const fence = Array.from('```');
  const jsonFence = Array.from('```json');
  while (pos < n) {
    let found = -1;
    for (let i = pos; i < n; i++) {
      if ((i === 0 || s[i - 1] === '\n') && starts(i, marker)) {
        const end = matchAt(i);
        if (end) {
          found = i;
          out.push(end.group);
          pos = end.next;
          break;
        }
      }
    }
    if (found < 0) break;
  }
  return out;
  /** @param {number} i @returns {{ group: string, next: number } | null} */
  function matchAt(i) {
    let p = i + marker.length;
    while (s[p] === ' ' || s[p] === '\t') p++;
    if (s[p] === '\r') p++;
    if (s[p] !== '\n') return null;
    p++;
    while (p < n && isPyWs(s[p])) p++;
    if (!starts(p, jsonFence)) return null;
    p += jsonFence.length;
    while (p < n && isPyWs(s[p])) p++;
    if (s[p] !== '{') return null;
    const open = p;
    for (let q = open + 1; q < n; q++) {
      if (s[q] !== '}') continue;
      let r = q + 1;
      while (r < n && isPyWs(s[r])) r++;
      if (starts(r, fence)) return { group: s.slice(open, q + 1).join(''), next: r + 3 };
    }
    return null;
  }
}

/**
 * EVENT_MARKER_RE.findall: the version of every `<!-- worklog-event:v<non-space> -->` alone on its line.
 * @param {string} body
 * @returns {string[]}
 */
export function markerVersions(body) {
  const s = Array.from(body);
  const head = Array.from('<!-- worklog-event:v');
  const tail = Array.from(' -->');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (!(i === 0 || s[i - 1] === '\n') || !head.every((c, k) => s[i + k] === c)) continue;
    let p = i + head.length;
    const v = p;
    while (p < s.length && !isPyWs(s[p])) p++;
    if (p === v || !tail.every((c, k) => s[p + k] === c)) continue;
    const version = s.slice(v, p).join('');
    p += tail.length;
    while (s[p] === ' ' || s[p] === '\t') p++;
    if (s[p] === '\r') p++;
    if (p === s.length || s[p] === '\n') out.push(version);
  }
  return out;
}

/** @param {Obj} obj @param {string[]} fields @param {string} where */
function require(obj, fields, where) {
  const missing = fields.filter((f) => !has(obj, f));
  if (missing.length) throw new ContractError(where + ': missing ' + missing.join(', '));
}

/** @param {unknown} value @param {string} where @returns {string} */
function nonemptyString(value, where) {
  if (typeof value !== 'string' || !pyStrip(value)) throw new ContractError(where + ': must be a non-empty string');
  return value;
}

/** @param {unknown} value @param {string} where @param {boolean} [nonempty] */
function publicStrings(value, where, nonempty = false) {
  if (!Array.isArray(value) || !value.every((x) => typeof x === 'string')) throw new ContractError(where + ': must be a string array');
  if (nonempty && !value.length) throw new ContractError(where + ': must not be empty');
  if (value.some((x) => !pyStrip(x))) throw new ContractError(where + ': entries must be non-empty strings');
  if (value.some((x) => privateEvidence(x))) throw new ContractError(where + ': contains private or machine-local material');
  return value;
}

/** @param {unknown} value @param {string} where */
function boundedLine(value, where) {
  const v = nonemptyString(value, where);
  if (v.includes('\n') || v.includes('\r')) throw new ContractError(where + ': must be a single line');
  if (pyLen(v) > FREE_TEXT_LIMIT) throw new ContractError(where + ': must be at most ' + FREE_TEXT_LIMIT + ' characters');
  if (strictPrivate(v)) throw new ContractError(where + ': contains private or machine-local material');
  return v;
}

/**
 * Producer-side bounds for a NEW event; readers of retained history do not apply them. A correction is
 * checked on its own fields and on the event it carries, which the report reads as the effective one.
 * @param {Obj} event
 * @param {string} [where]
 * @returns {Obj}
 */
export function validatePrepared(event, where = 'event') {
  if (event.event_type === 'handoff') require(event, ['next_act'], where);
  event.evidence.forEach((/** @type {unknown} */ item, /** @type {number} */ i) => boundedLine(item, where + '.evidence[' + i + ']'));
  (has(event, 'acceptance_evidence') ? event.acceptance_evidence : []).forEach((/** @type {string} */ item, /** @type {number} */ i) => {
    if (strictPrivate(item)) throw new ContractError(where + '.acceptance_evidence[' + i + ']: contains private or machine-local material');
  });
  if (event.event_type === 'correction') validatePrepared(event.corrected_event, where + '.corrected_event');
  return event;
}

/** `value in some_set` of the Python, which raises on an unhashable list or dict. @param {Set<string>} set @param {unknown} value */
function inSet(set, value) {
  if (Array.isArray(value)) throw new PyCrash("TypeError: unhashable type: 'list'");
  if (dict(value)) throw new PyCrash("TypeError: unhashable type: 'dict'");
  return typeof value === 'string' && set.has(value);
}

/** @param {unknown} usage @param {string} where */
function validateUsage(usage, where) {
  if (!dict(usage)) throw new ContractError(where + ': must be an object');
  const extra = Object.keys(usage).filter((k) => !USAGE_FIELDS.has(k)).sort(cmpStr);
  if (extra.length) throw new ContractError(where + ': unknown field ' + extra.join(', ') + '; usage carries numbers and fixed identifiers only');
  require(usage, ['usage_provenance'], where);
  if (!inSet(USAGE_PROVENANCE, usage.usage_provenance)) throw new ContractError(where + '.usage_provenance: must be native or unavailable');
  for (const field of ['model', 'effort']) {
    const value = has(usage, field) ? usage[field] : null;
    if (value !== null && (typeof value !== 'string' || !IDENTIFIER_RE.test(value))) throw new ContractError(where + '.' + field + ': must be a fixed identifier or null');
  }
  for (const field of ['tokens_input', 'tokens_output']) {
    const value = has(usage, field) ? usage[field] : null;
    if (value !== null && (!isInt(value) || value < 0)) throw new ContractError(where + '.' + field + ': must be a non-negative integer or null');
  }
  const credits = has(usage, 'credits') ? usage.credits : null;
  if (credits !== null && (!(isInt(credits) || isFloat(credits)) || !Number.isFinite(num(credits)) || num(credits) < 0)) {
    throw new ContractError(where + '.credits: must be a non-negative number or null');
  }
  const reported = USAGE_METRICS.filter((f) => has(usage, f) && usage[f] !== null);
  if (usage.usage_provenance === 'unavailable' && reported.length) throw new ContractError(where + ': unavailable usage carries no numbers');
  if (usage.usage_provenance === 'native' && !reported.length) throw new ContractError(where + ': native usage carries at least one of ' + USAGE_METRICS.join(', '));
}

/**
 * @typedef {{ us: bigint, aware: boolean }} Instant
 */

/** @param {unknown} value @param {string} where @returns {Instant} */
function timestamp(value, where) {
  if (typeof value !== 'string' || !value.endsWith('Z')) throw new ContractError(where + ': timestamp must be UTC and end in Z');
  try {
    return fromIsoformat(value.replaceAll('Z', '+00:00'));
  } catch {
    throw new ContractError(where + ': invalid timestamp');
  }
}

/** a <= b, or a < b, as CPython compares two datetimes. @param {Instant} a @param {Instant} b @param {boolean} [strict] */
function before(a, b, strict = false) {
  if (a.aware !== b.aware) throw new PyCrash("TypeError: can't compare offset-naive and offset-aware datetimes");
  return strict ? a.us < b.us : a.us <= b.us;
}

/** @param {unknown} identity @param {string} where */
function validateIdentity(identity, where) {
  if (!dict(identity)) throw new ContractError(where + ': attribution must be an object');
  require(identity, ['harness', 'runtime_version', 'plugin', 'persona', 'provenance'], where);
  nonemptyString(identity.provenance, where + '.provenance');
  if (!PROVENANCE.has(identity.provenance)) throw new ContractError(where + ': invalid provenance');
  for (const field of ['harness', 'runtime_version', 'persona']) nonemptyString(identity[field], where + '.' + field);
  if (!dict(identity.plugin)) throw new ContractError(where + ': plugin must be an object');
  require(identity.plugin, ['version', 'source_revision'], where + '.plugin');
  nonemptyString(identity.plugin.version, where + '.plugin.version');
  nonemptyString(identity.plugin.source_revision, where + '.plugin.source_revision');
}

/** str(v) for the SHA check: only a string or an int can read as hex digits. @param {unknown} v */
const strForSha = (v) => (typeof v === 'string' ? v : isInt(v) ? String(v) : '');

/**
 * @param {unknown} event
 * @param {string} [where]
 * @returns {Obj}
 */
export function validateEvent(event, where = 'event') {
  if (!dict(event)) throw new ContractError(where + ': must be an object');
  require(event, ['schema_version', 'event_id', 'issue', 'timestamp', 'event_type', 'stage', 'run_id', 'attempt_id',
    'attribution', 'revision', 'evidence', 'handoff'], where);
  if (!isInt(event.schema_version) || event.schema_version !== 1) throw new ContractError(where + ': unsupported schema_version ' + pyRepr(event.schema_version));
  nonemptyString(event.event_id, where + '.event_id');
  if (typeof event.issue !== 'string' || !ISSUE_RE.test(event.issue)) throw new ContractError(where + ': issue must be owner/repo#number');
  timestamp(event.timestamp, where);
  nonemptyString(event.event_type, where + '.event_type');
  if (!EVENT_TYPES.has(event.event_type)) throw new ContractError(where + ': invalid event_type');
  for (const field of ['stage', 'run_id', 'attempt_id']) nonemptyString(event[field], where + '.' + field);
  for (const field of ['predecessor_event_id', 'resume_of_event_id']) {
    if (has(event, field) && event[field] !== null) nonemptyString(event[field], where + '.' + field);
  }
  validateIdentity(event.attribution, where + '.attribution');
  const revision = event.revision;
  if (!dict(revision)) throw new ContractError(where + '.revision: must be an object');
  require(revision, ['repository', 'branch', 'commit'], where + '.revision');
  if (typeof revision.repository !== 'string' || !REPO_RE.test(revision.repository)) throw new ContractError(where + '.revision: repository must be owner/repo');
  nonemptyString(revision.branch, where + '.revision.branch');
  if (revision.commit !== null && revision.commit !== 'unknown' && !SHA_RE.test(strForSha(revision.commit))) {
    throw new ContractError(where + '.revision: commit must be a git SHA, unknown, or null');
  }
  publicStrings(event.evidence, where + '.evidence');
  if (has(event, 'acceptance_evidence')) publicStrings(event.acceptance_evidence, where + '.acceptance_evidence');
  if (!dict(event.handoff)) throw new ContractError(where + ': handoff must be an object');
  require(event.handoff, ['state', 'to'], where + '.handoff');
  nonemptyString(event.handoff.state, where + '.handoff.state');
  if (event.handoff.to !== null) nonemptyString(event.handoff.to, where + '.handoff.to');
  if (has(event, 'next_act')) {
    if (!CONTINUITY_TYPES.has(event.event_type)) throw new ContractError(where + ': next_act is only valid on checkpoint and handoff events');
    boundedLine(event.next_act, where + '.next_act');
  }
  if (has(event, 'usage')) {
    if (!USAGE_TYPES.has(event.event_type)) throw new ContractError(where + ': usage is only valid on checkpoint, handoff and outcome events');
    validateUsage(event.usage, where + '.usage');
  }
  if (event.event_type === 'implementation_start') {
    require(event, ['frozen_estimate'], where);
    const estimate = event.frozen_estimate;
    if (!dict(estimate)) throw new ContractError(where + '.frozen_estimate: must be an object');
    require(estimate, ['points', 'provenance', 'commitment_points'], where + '.frozen_estimate');
    if (!isInt(estimate.points) || estimate.points <= 0) throw new ContractError(where + '.frozen_estimate: points must be a positive integer');
    if (!isInt(estimate.commitment_points) || estimate.commitment_points <= 0) throw new ContractError(where + '.frozen_estimate: commitment_points must be a positive integer');
    nonemptyString(estimate.provenance, where + '.frozen_estimate.provenance');
  } else if (has(event, 'frozen_estimate')) {
    throw new ContractError(where + ': frozen_estimate is only valid on implementation_start');
  }
  if (event.event_type === 'outcome') {
    require(event, ['outcome'], where);
    nonemptyString(event.outcome, where + '.outcome');
    if (!OUTCOMES.has(event.outcome)) throw new ContractError(where + ': invalid outcome');
    if (event.outcome === 'accepted') {
      require(event, ['completion_sprint', 'acceptance_evidence'], where);
      nonemptyString(event.completion_sprint, where + '.completion_sprint');
      publicStrings(event.acceptance_evidence, where + '.acceptance_evidence', true);
    } else if (has(event, 'completion_sprint') || has(event, 'acceptance_evidence')) {
      throw new ContractError(where + ': completion evidence is only valid on accepted outcomes');
    }
  } else if (['outcome', 'completion_sprint', 'acceptance_evidence'].some((f) => has(event, f))) {
    throw new ContractError(where + ': outcome fields are only valid on outcome events');
  }
  if (event.event_type === 'correction') {
    require(event, ['supersedes_event_id', 'corrected_event'], where);
    nonemptyString(event.supersedes_event_id, where + '.supersedes_event_id');
    validateEvent(event.corrected_event, where + '.corrected_event');
    if (event.corrected_event.event_type === 'correction') throw new ContractError(where + ': corrected_event cannot itself be a correction');
    if (event.corrected_event.event_id === event.event_id) throw new ContractError(where + ': correction and corrected event IDs must differ');
  } else if (has(event, 'supersedes_event_id') || has(event, 'corrected_event')) {
    throw new ContractError(where + ': correction fields are only valid on correction events');
  }
  return event;
}

/** @param {unknown} snapshot @returns {Obj} */
export function validateSnapshot(snapshot) {
  if (!dict(snapshot)) throw new ContractError('snapshot: must be an object');
  require(snapshot, ['schema_version', 'sprint', 'timezone', 'starts_at', 'ends_at', 'repositories', 'counting_units'], 'snapshot');
  if (!isInt(snapshot.schema_version) || snapshot.schema_version !== 1) throw new ContractError('snapshot: unsupported schema_version');
  nonemptyString(snapshot.sprint, 'snapshot.sprint');
  nonemptyString(snapshot.timezone, 'snapshot.timezone');
  if (snapshot.starts_at !== null) timestamp(snapshot.starts_at, 'snapshot.starts_at');
  if (snapshot.ends_at !== null) timestamp(snapshot.ends_at, 'snapshot.ends_at');
  if (!Array.isArray(snapshot.repositories) || !snapshot.repositories.length) throw new ContractError('snapshot: repositories must be a non-empty array');
  const repositories = new Set();
  snapshot.repositories.forEach((/** @type {unknown} */ repo, /** @type {number} */ i) => {
    const at = 'snapshot.repositories[' + i + ']';
    if (!dict(repo)) throw new ContractError(at + ': must be an object');
    require(repo, ['repository', 'milestone_number'], at);
    if (typeof repo.repository !== 'string' || !REPO_RE.test(repo.repository)) throw new ContractError(at + '.repository: must be owner/repo');
    if (repositories.has(repo.repository)) throw new ContractError('snapshot: duplicate repository ' + repo.repository);
    repositories.add(repo.repository);
    if (!isInt(repo.milestone_number) || repo.milestone_number <= 0) throw new ContractError(at + '.milestone_number: must be a positive integer');
  });
  if (!Array.isArray(snapshot.counting_units)) throw new ContractError('snapshot: counting_units must be an array');
  const seen = new Set();
  snapshot.counting_units.forEach((/** @type {unknown} */ unit, /** @type {number} */ i) => {
    const at = 'snapshot.counting_units[' + i + ']';
    if (!dict(unit)) throw new ContractError(at + ': must be an object');
    require(unit, ['issue', 'planned_points', 'work_type', 'parent'], at);
    if (typeof unit.issue !== 'string' || !ISSUE_RE.test(unit.issue)) throw new ContractError(at + '.issue: must be owner/repo#number');
    if (!repositories.has(unit.issue.split('#')[0])) throw new ContractError(at + ': issue repository is not declared');
    if (!isInt(unit.planned_points) || unit.planned_points <= 0) throw new ContractError(at + '.planned_points: must be a positive integer');
    nonemptyString(unit.work_type, at + '.work_type');
    if (unit.parent !== null && (typeof unit.parent !== 'string' || !ISSUE_RE.test(unit.parent))) throw new ContractError(at + '.parent: must be owner/repo#number or null');
    if (seen.has(unit.issue)) throw new ContractError('snapshot: duplicate counting unit ' + unit.issue);
    seen.add(unit.issue);
  });
  for (const unit of snapshot.counting_units) {
    if (seen.has(unit.parent)) throw new ContractError('snapshot: parent/child overlap ' + unit.parent + ' and ' + unit.issue);
  }
  return snapshot;
}

/** sorted(values, key=str) of the Python (stable). @param {unknown[]} values */
const sortedByStr = (values) => [...values].sort((a, b) => cmpStr(pyStr(a), pyStr(b)));

/**
 * @typedef {{ event: Obj, source: Obj, available_at: string, correction_event_id?: string }} RecordT
 */

/**
 * @param {unknown} exp
 * @returns {[RecordT[], string[], Obj]}
 */
export function extractEvents(exp) {
  if (!dict(exp)) throw new ContractError('export: must be an object');
  require(exp, ['schema_version', 'cutoff', 'repositories', 'prior_inventory', 'comments'], 'export');
  if (!isInt(exp.schema_version) || exp.schema_version !== 1) throw new ContractError('export: unsupported schema_version');
  const cutoff = timestamp(exp.cutoff, 'export.cutoff');
  /** @type {string[]} */
  const warnings = [];
  if (!Array.isArray(exp.repositories)) throw new ContractError('export.repositories: must be an array');
  if (!exp.repositories.length) warnings.push('missing repositories: export declares no repository source');
  const exported = new Set();
  exp.repositories.forEach((/** @type {unknown} */ repo, /** @type {number} */ i) => {
    const at = 'export.repositories[' + i + ']';
    if (!dict(repo)) throw new ContractError(at + ': must be an object');
    require(repo, ['repository', 'pagination_complete'], at);
    if (typeof repo.repository !== 'string' || !REPO_RE.test(repo.repository)) throw new ContractError(at + '.repository: must be owner/repo');
    if (exported.has(repo.repository)) throw new ContractError('export: duplicate repository ' + repo.repository);
    exported.add(repo.repository);
    if (typeof repo.pagination_complete !== 'boolean') throw new ContractError(at + '.pagination_complete: must be a boolean');
    if (!repo.pagination_complete) warnings.push('incomplete pagination: ' + repo.repository);
  });
  const prior = exp.prior_inventory;
  if (!dict(prior)) throw new ContractError('export.prior_inventory: must be an object');
  require(prior, ['complete', 'comment_ids'], 'export.prior_inventory');
  if (typeof prior.complete !== 'boolean') throw new ContractError('export.prior_inventory.complete: must be a boolean');
  if (!Array.isArray(prior.comment_ids)) throw new ContractError('export.prior_inventory.comment_ids: must be an array');
  if (!prior.comment_ids.every((/** @type {unknown} */ id) => isInt(id) || (typeof id === 'string' && Boolean(pyStrip(id))))) {
    throw new ContractError('export.prior_inventory.comment_ids: entries must be strings or integers');
  }
  if (!prior.complete) warnings.push('historical integrity unknown: prior inventory is absent or incomplete');
  const comments = exp.comments;
  if (!Array.isArray(comments)) throw new ContractError('export.comments: must be an array');
  /** @type {RecordT[]} */
  const records = [];
  const current = new Set();
  comments.forEach((/** @type {unknown} */ comment, /** @type {number} */ index) => {
    const at = 'comment[' + index + ']';
    if (!dict(comment)) throw new ContractError(at + ': must be an object');
    require(comment, ['repository', 'issue', 'comment_id', 'created_at', 'updated_at', 'body', 'body_sha256'], at);
    if (typeof comment.repository !== 'string' || !REPO_RE.test(comment.repository)) throw new ContractError(at + '.repository: must be owner/repo');
    if (!exported.has(comment.repository)) warnings.push('comment source repository is not declared: ' + comment.repository);
    if (typeof comment.issue !== 'string' || !ISSUE_RE.test(comment.issue)) throw new ContractError(at + '.issue: must be owner/repo#number');
    if (comment.issue.split('#')[0] !== comment.repository) throw new ContractError(at + ': issue disagrees with repository');
    if (!(typeof comment.comment_id === 'string' || isInt(comment.comment_id))) throw new ContractError(at + '.comment_id: must be a string or integer');
    const createdAt = timestamp(comment.created_at, at + '.created_at');
    let updatedAt;
    if (comment.updated_at === null) {
      warnings.push('comment edit timestamp unavailable: comment ' + pyStr(comment.comment_id));
      updatedAt = createdAt;
    } else {
      updatedAt = timestamp(comment.updated_at, at + '.updated_at');
    }
    if (before(updatedAt, createdAt, true)) throw new ContractError(at + ': updated_at precedes created_at');
    if (typeof comment.body !== 'string') throw new ContractError(at + '.body: must be a string');
    if (typeof comment.body_sha256 !== 'string' || !HASH_RE.test(comment.body_sha256)) throw new ContractError(at + '.body_sha256: must be a SHA-256 hex digest');
    const bodyHash = sha256(comment.body);
    current.add(comment.comment_id);
    if (bodyHash !== comment.body_sha256) throw new ContractError(at + ': body hash mismatch; record was edited or input is corrupt');
    if (comment.updated_at !== null && comment.created_at !== comment.updated_at) warnings.push('edited historical record: comment ' + pyStr(comment.comment_id));
    const versions = markerVersions(comment.body);
    const unsupported = versions.filter((v) => v !== '1');
    if (unsupported.length) throw new ContractError(at + ': unsupported worklog marker version v' + unsupported[0]);
    const matches = eventBodies(comment.body);
    if (versions.length && versions.length !== matches.length) throw new ContractError(at + ': malformed worklog event body');
    for (const match of matches) {
      let parsed;
      try {
        parsed = loads(match);
      } catch (e) {
        if (e instanceof JsonDecodeError) throw new ContractError(at + ': invalid event JSON: ' + e.message);
        throw e;
      }
      const event = validateEvent(parsed, at + '.event');
      if (event.issue !== comment.issue || event.issue.split('#')[0] !== comment.repository) throw new ContractError(at + ': event issue disagrees with comment source');
      const effectiveAt = timestamp(event.timestamp, at + '.event.timestamp');
      if (before(createdAt, cutoff) && before(effectiveAt, cutoff)) {
        if (event.event_type !== 'correction' || before(timestamp(event.corrected_event.timestamp, at + '.event.corrected_event.timestamp'), cutoff)) {
          records.push({
            event,
            source: { repository: comment.repository, issue: comment.issue, comment_id: comment.comment_id,
              created_at: comment.created_at, updated_at: comment.updated_at, body_sha256: comment.body_sha256 },
            available_at: comment.created_at,
          });
        }
      }
    }
  });
  const priorIds = new Set(prior.comment_ids);
  const deleted = sortedByStr([...priorIds].filter((id) => !current.has(id)));
  if (deleted.length) warnings.push('deleted historical records: ' + deleted.map(pyStr).join(', '));
  return [records, warnings, exp];
}

/**
 * Validate the full retained ledger before deriving its effective leaves.
 * @param {RecordT[]} records
 * @returns {[RecordT[], RecordT[], Set<string>]}
 */
export function retainedGraph(records) {
  /** @type {Map<string, RecordT>} */
  const unique = new Map();
  for (const record of records) {
    const id = record.event.event_id;
    const known = unique.get(id);
    if (known) {
      if (canonical(known.event) !== canonical(record.event)) throw new ContractError('conflicting content for event_id ' + id);
      continue;
    }
    unique.set(id, record);
  }
  /** @type {Map<string, RecordT>} */
  const semantic = new Map([...unique].filter(([, r]) => r.event.event_type !== 'correction'));
  const retained = new Set(unique.keys());
  /** @type {RecordT[]} */
  const corrections = [];
  for (const [id, record] of unique) {
    if (record.event.event_type !== 'correction') continue;
    const replacement = record.event.corrected_event;
    if (retained.has(replacement.event_id)) throw new ContractError('correction ' + id + ': replacement event_id collision ' + replacement.event_id);
    retained.add(replacement.event_id);
    semantic.set(replacement.event_id, { event: replacement, source: record.source, available_at: record.available_at, correction_event_id: id });
    corrections.push(record);
  }
  /** @type {Map<string, string>} */
  const successors = new Map();
  for (const record of corrections) {
    const event = record.event;
    const target = event.supersedes_event_id;
    const replacement = event.corrected_event;
    const old = semantic.get(target);
    if (!old) throw new ContractError('correction ' + event.event_id + ': missing superseded event ' + target);
    if (successors.has(target)) throw new ContractError('correction ' + event.event_id + ': event ' + target + ' already superseded');
    if (old.event.issue !== event.issue || replacement.issue !== event.issue) throw new ContractError('correction ' + event.event_id + ': target and replacement must belong to ' + event.issue);
    successors.set(target, replacement.event_id);
  }
  for (const start of successors.keys()) {
    const seen = new Set();
    let node = start;
    while (successors.has(node)) {
      if (seen.has(node)) throw new ContractError('correction graph: cycle at ' + node);
      seen.add(node);
      node = /** @type {string} */ (successors.get(node));
    }
  }
  const effective = [...semantic].filter(([id]) => !successors.has(id)).map(([, r]) => r);
  effective.sort((a, b) => cmpStr(a.event.timestamp, b.event.timestamp) || cmpStr(a.event.event_id, b.event.event_id));
  return [effective, [...unique.values()], retained];
}

/** @param {Obj[]} events */
function latestOutcome(events) {
  const outcomes = events.filter((e) => e.event_type === 'outcome');
  return outcomes.length ? outcomes[outcomes.length - 1] : null;
}

/**
 * One coverage unit per run on an Issue (#76): its harness key and its usage record, or null. Two on one
 * run cannot be told apart as cumulative or delta, so the report refuses rather than guesses.
 * @param {string} issue
 * @param {Obj[]} events
 * @returns {Array<{ harness: string, usage: Obj | null }>}
 */
export function usageRuns(issue, events) {
  /** @type {Map<string, { harness: string, usage: Obj | null }>} */
  const runs = new Map();
  for (const event of events) {
    let run = runs.get(event.run_id);
    if (!run) {
      run = { harness: 'unknown', usage: null };
      runs.set(event.run_id, run);
    }
    if (has(event, 'usage')) {
      if (run.usage !== null) throw new ContractError(issue + ': run ' + event.run_id + ' carries more than one usage record');
      run.usage = event.usage;
      run.harness = harnessKey(event.attribution.harness);
    } else if (run.usage === null) {
      run.harness = harnessKey(event.attribution.harness);
    }
  }
  return [...runs.keys()].sort(cmpStr).map((k) => /** @type {{ harness: string, usage: Obj | null }} */ (runs.get(k)));
}

/** Sums of what was reported, never an estimate; a metric no run reported is null, not zero. @param {Array<{ usage: Obj | null }>} runs */
export function usageSummary(runs) {
  const native = runs.filter((r) => r.usage && r.usage.usage_provenance === 'native').map((r) => /** @type {Obj} */ (r.usage));
  const unavailable = runs.filter((r) => r.usage && r.usage.usage_provenance === 'unavailable').length;
  const unrecorded = runs.filter((r) => r.usage === null).length;
  const coverage = !native.length ? 'none' : unavailable || unrecorded ? 'partial' : 'complete';
  /** @type {Obj} */
  const summary = { coverage, runs: runs.length, native_runs: native.length, unavailable_runs: unavailable, unrecorded_runs: unrecorded };
  for (const metric of USAGE_METRICS) {
    const values = native.filter((u) => has(u, metric) && u[metric] !== null).map((u) => u[metric]);
    summary[metric] = { sum: values.length ? pySum(values) : null, runs: values.length };
  }
  return summary;
}

/** @param {RecordT} record */
function projectSegment(record) {
  const event = record.event;
  /** @type {Obj} */
  const projected = {};
  for (const [k, v] of Object.entries(event)) if (k !== 'corrected_event') projected[k] = v;
  projected.available_at = record.available_at;
  projected.source = record.source;
  if (event.event_type === 'correction') projected.corrected_event = event.corrected_event;
  return projected;
}

/**
 * @param {unknown} snapshotIn
 * @param {unknown} exportIn
 * @param {string} reproduction
 * @returns {Obj}
 */
export function report(snapshotIn, exportIn, reproduction) {
  const snapshot = validateSnapshot(snapshotIn);
  const [records, warnings, raw] = extractEvents(exportIn);
  const [effectiveRecords, ledger, retained] = retainedGraph(records);
  const current = effectiveRecords.map((r) => r.event);
  for (const record of ledger) {
    const event = record.event;
    const nodes = [event, ...(event.event_type === 'correction' ? [event.corrected_event] : [])];
    for (const node of nodes) {
      for (const field of ['predecessor_event_id', 'resume_of_event_id']) {
        const reference = has(node, field) ? node[field] : null;
        if (reference && !retained.has(reference)) warnings.push('missing ' + field + ' ' + reference + ' referenced by ' + node.event_id);
      }
    }
  }
  /** @type {Map<string, Obj[]>} */
  const byIssue = new Map();
  for (const event of current) byIssue.set(event.issue, [...(byIssue.get(event.issue) || []), event]);
  /** @type {Map<string, RecordT[]>} */
  const ledgerByIssue = new Map();
  for (const record of ledger) ledgerByIssue.set(record.event.issue, [...(ledgerByIssue.get(record.event.issue) || []), record]);
  /** @type {Map<string, Obj>} */
  const units = new Map(snapshot.counting_units.map((/** @type {Obj} */ u) => [u.issue, u]));
  const expectedRepos = new Set(snapshot.repositories.map((/** @type {Obj} */ r) => r.repository));
  const exportedRepos = new Set(raw.repositories.map((/** @type {Obj} */ r) => r.repository));
  for (const repository of [...expectedRepos].filter((r) => !exportedRepos.has(r)).sort(cmpStr)) warnings.push('missing repository: ' + repository);
  /** @type {number | bigint} */
  let completed = 0;
  /** @type {number | bigint} */
  let planned = 0;
  /** @type {number | bigint} */
  let carryover = 0;
  let scopeChanges = 0;
  /** @type {string[]} */
  const unestimated = [];
  /** @type {Obj[]} */
  const mismatched = [];
  /** @type {Obj[]} */
  const excluded = [];
  /** @type {Record<string, number | bigint>} */
  const cohorts = { sole: 0, mixed: 0, unknown: 0 };
  /** @type {Record<string, number>} */
  const cohortItems = { sole: 0, mixed: 0, unknown: 0 };
  /** @type {Obj[]} */
  const items = [];
  /** @type {Map<string, number | bigint>} */
  const workTypes = new Map();
  /** @type {Map<string, Array<{ harness: string, usage: Obj | null }>>} */
  const harnessRuns = new Map();
  for (const [issue, unit] of units) {
    planned = addInt(planned, unit.planned_points);
    const issueEvents = byIssue.get(issue) || [];
    const issueLedger = ledgerByIssue.get(issue) || [];
    if (!issueLedger.length) warnings.push('missing worklog history: ' + issue);
    const starts = issueEvents.filter((e) => e.event_type === 'implementation_start');
    /** @type {number | bigint | null} */
    let frozen = null;
    if (!starts.length) {
      if (issueLedger.length) warnings.push('missing frozen estimate: ' + issue);
    } else {
      const values = new Set(starts.map((e) => e.frozen_estimate.points));
      if (values.size !== 1) throw new ContractError(issue + ': multiple uncorrected frozen estimates');
      frozen = /** @type {number | bigint} */ ([...values][0]);
      if (frozen !== unit.planned_points) scopeChanges += 1;
    }
    const known = (/** @type {Obj} */ e) => e.attribution.provenance !== 'unknown' && harnessKey(e.attribution.harness) !== 'unknown';
    const harnesses = new Set(issueEvents.filter(known).map((e) => harnessKey(e.attribution.harness)));
    const unknown = issueEvents.some((e) => !known(e));
    if (unknown) warnings.push('incomplete attribution coverage: ' + issue);
    let cohort;
    if (!issueEvents.length || (unknown && harnesses.size <= 1)) cohort = 'unknown';
    else if (harnesses.size > 1) cohort = 'mixed';
    else if (harnesses.size === 1 && !unknown) cohort = 'sole';
    else cohort = 'unknown';
    cohortItems[cohort] += 1;
    const runs = usageRuns(issue, issueEvents);
    for (const run of runs) harnessRuns.set(run.harness, [...(harnessRuns.get(run.harness) || []), run]);
    const outcome = latestOutcome(issueEvents);
    const accepted = Boolean(outcome && outcome.outcome === 'accepted');
    const sprintOf = outcome && has(outcome, 'completion_sprint') ? outcome.completion_sprint : null;
    const credited = Boolean(accepted && sprintOf === snapshot.sprint && frozen !== null);
    if (credited) {
      completed = addInt(completed, /** @type {number | bigint} */ (frozen));
      cohorts[cohort] = addInt(cohorts[cohort], /** @type {number | bigint} */ (frozen));
      workTypes.set(unit.work_type, addInt(workTypes.get(unit.work_type) || 0, /** @type {number | bigint} */ (frozen)));
    } else if (accepted && sprintOf !== snapshot.sprint) {
      // #515: an acceptance naming ANOTHER sprint earns nothing here; it still carries over, and is named.
      mismatched.push({ issue, completion_sprint: sprintOf });
      warnings.push('completion sprint mismatch: ' + issue + ' was accepted in ' + pyStr(sprintOf) + ', not ' + snapshot.sprint + '; no credit here');
      carryover = addInt(carryover, frozen ?? 0);
    } else if (accepted && frozen === null) {
      unestimated.push(issue);
    } else if (outcome && ['cancelled', 'superseded', 'no_longer_relevant'].includes(outcome.outcome)) {
      excluded.push({ issue, reason: outcome.outcome });
    } else {
      carryover = addInt(carryover, frozen ?? 0);
    }
    items.push({
      issue, planned_points: unit.planned_points, points: frozen,
      frozen_estimate_provenance: starts.length ? starts[0].frozen_estimate.provenance : null,
      work_type: unit.work_type, cohort, outcome: outcome ? outcome.outcome : 'unknown', credited,
      usage: usageSummary(runs), segments: issueLedger.map(projectSegment),
    });
  }
  const unmapped = [...byIssue.keys()].filter((i) => !units.has(i)).sort(cmpStr);
  if (unmapped.length) warnings.push('missing sprint mapping: ' + unmapped.join(', '));
  /** @type {PyFloat | null} */
  let durationDays = null;
  /** @type {PyFloat | null} */
  let pointsPerWeek = null;
  if (snapshot.starts_at === null || snapshot.ends_at === null) {
    warnings.push('sprint boundary is unknown: duration and points-per-week are not measured');
  } else {
    const start = timestamp(snapshot.starts_at, 'snapshot.starts_at');
    const end = timestamp(snapshot.ends_at, 'snapshot.ends_at');
    if (start.aware !== end.aware) throw new PyCrash("TypeError: can't subtract offset-naive and offset-aware datetimes");
    // timedelta.total_seconds(): microseconds / 10**6, then / 86400, each a float division.
    const days = Number(end.us - start.us) / 1000000 / 86400;
    if (days <= 0) throw new ContractError('snapshot: ends_at must follow starts_at');
    durationDays = new PyFloat(days);
    pointsPerWeek = new PyFloat(pyRound(Number(mulInt(completed, 7)) / days, 6));
  }
  const partial = Boolean(warnings.length || unestimated.length || unmapped.length);
  /** @type {Obj} */
  const workTypePoints = {};
  for (const k of [...workTypes.keys()].sort(cmpStr)) workTypePoints[k] = workTypes.get(k);
  /** @type {Obj} */
  const usageByHarness = {};
  for (const k of [...harnessRuns.keys()].sort(cmpStr)) usageByHarness[k] = usageSummary(/** @type {Array<{ usage: Obj | null }>} */ (harnessRuns.get(k)));
  return {
    report_version: VERSION, schema_version: 1, sprint: snapshot.sprint, cutoff: raw.cutoff, partial,
    warnings: [...new Set(warnings)].sort(cmpStr),
    source: {
      snapshot_sha256: digest(snapshot), export_sha256: digest(raw), repositories: raw.repositories,
      comment_ids: sortedByStr(raw.comments.map((/** @type {Obj} */ c) => c.comment_id)),
    },
    reproduction_command: reproduction,
    totals: {
      planned_points: planned, completed_points: completed, carryover_points: carryover, scope_changes: scopeChanges,
      unestimated_completions: [...unestimated].sort(cmpStr),
      completion_sprint_mismatches: [...mismatched].sort((a, b) => cmpStr(a.issue, b.issue)),
      cohort_points: cohorts, cohort_items: cohortItems, work_type_points: workTypePoints,
      usage_by_harness: usageByHarness, duration_days: durationDays, points_per_week: pointsPerWeek,
    },
    excluded, items,
  };
}

/**
 * Compose the `--export` input from saved tracker captures (#515). Offline: it reads, never fetches. Each
 * capture is the stdout of `gh issue view <n> --repo <owner/repo> --json url,comments`. Edit time,
 * pagination and the prior inventory are not in a capture and are never guessed (worklog-contract/README.md).
 * @param {unknown[]} captures
 * @param {unknown} cutoff
 * @param {unknown} [prior]
 * @param {boolean} [paginationComplete]
 * @returns {Obj}
 */
export function buildExport(captures, cutoff, prior = null, paginationComplete = false) {
  timestamp(cutoff, 'export.cutoff');
  /** @type {Obj[]} */
  const comments = [];
  /** @type {Set<string>} */
  const repositories = new Set();
  /** @type {Set<string>} */
  const issues = new Set();
  captures.forEach((capture, index) => {
    const where = 'capture[' + index + ']';
    if (!dict(capture)) throw new ContractError(where + ': must be an object');
    require(capture, ['url', 'comments'], where);
    const match = typeof capture.url === 'string' ? EXPORT_URL_RE.exec(capture.url) : null;
    if (!match) throw new ContractError(where + '.url: must be a GitHub issue URL; capture with --json url,comments');
    const repository = match[1];
    const issue = match[1] + '#' + match[2];
    if (issues.has(issue)) throw new ContractError(where + ': ' + issue + ' is captured twice');
    issues.add(issue);
    repositories.add(repository);
    if (!Array.isArray(capture.comments)) throw new ContractError(where + '.comments: must be an array');
    capture.comments.forEach((/** @type {unknown} */ comment, /** @type {number} */ position) => {
      const at = where + '.comments[' + position + ']';
      if (!dict(comment)) throw new ContractError(at + ': must be an object');
      require(comment, ['url', 'createdAt', 'body'], at);
      const found = typeof comment.url === 'string' ? COMMENT_URL_RE.exec(comment.url) : null;
      if (!found || found[1] !== capture.url) throw new ContractError(at + '.url: must be a comment URL on ' + pyStr(capture.url));
      timestamp(comment.createdAt, at + '.createdAt');
      if (typeof comment.body !== 'string') throw new ContractError(at + '.body: must be a string');
      const unedited = has(comment, 'includesCreatedEdit') && comment.includesCreatedEdit === false;
      const id = BigInt(found[2]);
      comments.push({
        repository, issue, comment_id: id <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(id) : id,
        created_at: comment.createdAt, updated_at: unedited ? comment.createdAt : null,
        body: comment.body, body_sha256: sha256(comment.body),
      });
    });
  });
  let inventory;
  if (prior === null || prior === undefined) {
    inventory = { complete: false, comment_ids: [] };
  } else {
    extractEvents(prior);
    const p = /** @type {Obj} */ (prior);
    const priorComplete = new Set(p.repositories.filter((/** @type {Obj} */ r) => r.pagination_complete).map((/** @type {Obj} */ r) => r.repository));
    const ids = new Set(p.comments.filter((/** @type {Obj} */ c) => issues.has(c.issue)).map((/** @type {Obj} */ c) => c.comment_id));
    inventory = { complete: [...repositories].every((r) => priorComplete.has(r)), comment_ids: sortedByStr([...ids]) };
  }
  comments.sort((a, b) => cmpStr(a.issue, b.issue) || cmpStr(a.created_at, b.created_at) || cmpStr(pyStr(a.comment_id), pyStr(b.comment_id)));
  const exp = {
    schema_version: 1, cutoff,
    repositories: [...repositories].sort(cmpStr).map((repository) => ({ repository, pagination_complete: paginationComplete })),
    prior_inventory: inventory, comments,
  };
  extractEvents(exp); // what this produces, the report must accept
  return exp;
}

/** The report as Markdown, line for line the Python's. @param {Obj} data */
export function markdown(data) {
  const status = data.partial ? 'PARTIAL' : 'COMPLETE';
  const t = data.totals;
  const lines = ['# ' + data.sprint + ' worklog report', '', 'status: **' + status + '**',
    'report version: `' + data.report_version + '`', 'schema version: `' + data.schema_version + '`',
    'cutoff: `' + pyStr(data.cutoff) + '`', 'snapshot sha256: `' + data.source.snapshot_sha256 + '`',
    'export sha256: `' + data.source.export_sha256 + '`', '',
    '- planned points: ' + pyStr(t.planned_points),
    '- completed points: ' + pyStr(t.completed_points),
    '- carryover points: ' + pyStr(t.carryover_points),
    '- scope changes: ' + pyStr(t.scope_changes),
    '- cohort points: `' + canonical(t.cohort_points) + '`',
    '- cohort items: `' + canonical(t.cohort_items) + '`',
    '- work-type points: `' + canonical(t.work_type_points) + '`',
    '- usage by harness: `' + canonical(t.usage_by_harness) + '`',
    '- unestimated completions: `' + canonical(t.unestimated_completions) + '`',
    '- completion sprint mismatches: `' + canonical(t.completion_sprint_mismatches) + '`',
    '- duration days: ' + pyStr(t.duration_days),
    '- points per week: ' + pyStr(t.points_per_week), '', '## Sources', '',
    '- repositories: `' + canonical(data.source.repositories) + '`',
    '- comment IDs: `' + canonical(data.source.comment_ids) + '`', '', '## Warnings'];
  lines.push(...(data.warnings.length ? data.warnings.map((/** @type {string} */ w) => '- ' + w) : ['- none']));
  lines.push('', '## Excluded', '', '```json', dumps(data.excluded, { indent: 2 }), '```',
    '', '## Items and retained segments', '', '```json', dumps(data.items, { indent: 2 }), '```');
  lines.push('', '## Reproduce', '', '```sh', data.reproduction_command, '```', '');
  return lines.join('\n');
}

/** @type {Record<string, [number, string]>} */
const ERRNO = {
  ENOENT: [2, 'No such file or directory'], EACCES: [13, 'Permission denied'], EISDIR: [21, 'Is a directory'],
  ENOTDIR: [20, 'Not a directory'], EPERM: [1, 'Operation not permitted'], ENAMETOOLONG: [63, 'File name too long'],
  ELOOP: [62, 'Too many levels of symbolic links'],
};
if (process.platform === 'linux') {
  ERRNO.ENAMETOOLONG = [36, 'File name too long'];
  ERRNO.ELOOP = [40, 'Too many levels of symbolic links'];
}

/**
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, platform?: string }} Ctx
 */

/**
 * Read one JSON input, confined first (mhw #170). Python's read_text: UTF-8, universal newlines.
 * @param {string} p
 * @param {Ctx} ctx
 */
export function load(p, ctx) {
  let real;
  try {
    real = confined(p, ctx);
  } catch (e) {
    if (e instanceof ConfineError) throw new ContractError(e.message);
    throw e;
  }
  let text;
  try {
    const bytes = fs.readFileSync(real);
    try {
      text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new PyCrash("UnicodeDecodeError: 'utf-8' codec can't decode the file " + pyRepr(real));
    }
  } catch (e) {
    if (e instanceof PyCrash) throw e;
    const code = /** @type {NodeJS.ErrnoException} */ (e).code || '';
    const [n, what] = ERRNO[code] || [0, code || String(e)];
    throw new ContractError('cannot read JSON ' + p + ': [Errno ' + n + '] ' + what + ': ' + pyRepr(real));
  }
  text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
  try {
    return loads(text);
  } catch (e) {
    if (e instanceof JsonDecodeError) throw new ContractError('cannot read JSON ' + p + ': ' + e.message);
    throw e;
  }
}

const COMMANDS = ['validate-event', 'prepare-event', 'report', 'export'];
const USAGE = [
  'usage: mhw worklog validate-event EVENT.json',
  '       mhw worklog prepare-event EVENT.json',
  '       mhw worklog report --snapshot SNAPSHOT.json --export EXPORT.json [--format json|markdown] --reproduction-command CMD',
  '       mhw worklog export --cutoff T --capture ISSUE.json [--capture ...] [--prior EXPORT.json] [--pagination-complete]',
].join('\n') + '\n';

class UsageError extends Error {}
/** @type {Record<string, { flags: string[], values: string[], repeat: string[], required: string[], positional: number }>} */
const SPEC = {
  'validate-event': { flags: [], values: [], repeat: [], required: [], positional: 1 },
  'prepare-event': { flags: [], values: [], repeat: [], required: [], positional: 1 },
  report: { flags: [], values: ['--snapshot', '--export', '--format', '--reproduction-command'], repeat: [], required: ['--snapshot', '--export', '--reproduction-command'], positional: 0 },
  export: { flags: ['--pagination-complete'], values: ['--cutoff', '--prior'], repeat: ['--capture'], required: ['--cutoff', '--capture'], positional: 0 },
};
// argparse reads "-5" or "-.5" as a value, and anything else opening with "-" as an option.
const NEGATIVE = /^-\d+$|^-\d*\.\d+$/;

/**
 * argparse's reading of one subcommand's arguments: --opt value, --opt=value, a unique prefix of a long
 * option, "--" ending the options. The error texts are this command's own (its name is mhw worklog).
 * @param {string} command
 * @param {string[]} argv
 * @returns {{ positional: string[], opts: Record<string, string | string[] | boolean> }}
 */
export function parseArgs(command, argv) {
  const spec = SPEC[command];
  const all = [...spec.flags, ...spec.values, ...spec.repeat];
  /** @type {Record<string, string | string[] | boolean>} */
  const opts = {};
  const positional = [];
  let only = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!only && a === '--') {
      only = true;
      continue;
    }
    if (only || !a.startsWith('-') || a === '-' || NEGATIVE.test(a)) {
      positional.push(a);
      continue;
    }
    const eq = a.indexOf('=');
    const word = eq > 0 && a.startsWith('--') ? a.slice(0, eq) : a;
    const hits = all.includes(word) ? [word] : a.startsWith('--') ? all.filter((o) => o.startsWith(word)) : [];
    if (hits.length > 1) throw new UsageError('ambiguous option: ' + word + ' could match ' + hits.join(', '));
    if (!hits.length) throw new UsageError('unrecognized arguments: ' + a);
    const name = hits[0];
    if (spec.flags.includes(name)) {
      if (eq > 0) throw new UsageError('argument ' + name + ': ignored explicit argument ' + pyRepr(a.slice(eq + 1)));
      opts[name] = true;
      continue;
    }
    let value;
    if (eq > 0) {
      value = a.slice(eq + 1);
    } else {
      const next = argv[i + 1];
      if (i + 1 >= argv.length || (next.startsWith('-') && next !== '-' && !NEGATIVE.test(next))) throw new UsageError('argument ' + name + ': expected one argument');
      value = next;
      i++;
    }
    if (spec.repeat.includes(name)) opts[name] = [.../** @type {string[]} */ (opts[name] || []), value];
    else opts[name] = value;
  }
  if (positional.length > spec.positional) throw new UsageError('unrecognized arguments: ' + positional.slice(spec.positional).join(' '));
  const missing = spec.required.filter((r) => opts[r] === undefined);
  if (spec.positional && positional.length < spec.positional) missing.unshift('event');
  if (missing.length) throw new UsageError('the following arguments are required: ' + missing.join(', '));
  if (opts['--format'] !== undefined && !['json', 'markdown'].includes(/** @type {string} */ (opts['--format']))) {
    throw new UsageError("argument --format: invalid choice: " + pyRepr(opts['--format']) + " (choose from json, markdown)");
  }
  return { positional, opts };
}

/**
 * @typedef {Ctx & { out: (s: string) => void, err: (s: string) => void }} Io
 */

/**
 * mhw worklog <command> ...: 0, 2 on a contract or usage error, 1 where CPython crashed.
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
export function run(argv, io) {
  const [command, ...rest] = argv;
  if (command === '-h' || command === '--help' || (rest.includes('-h') && !rest.includes('--')) || (rest.includes('--help') && !rest.includes('--'))) {
    io.out(USAGE);
    return 0;
  }
  if (!command || !COMMANDS.includes(command)) {
    io.err(USAGE + 'mhw worklog: error: ' + (command ? 'argument command: invalid choice: ' + pyRepr(command) + ' (choose from ' + COMMANDS.join(', ') + ')' : 'the following arguments are required: command') + '\n');
    return 2;
  }
  let parsed;
  try {
    parsed = parseArgs(command, rest);
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(USAGE + 'mhw worklog ' + command + ': error: ' + e.message + '\n');
      return 2;
    }
    throw e;
  }
  const { positional, opts } = parsed;
  try {
    if (command === 'export') {
      const captures = /** @type {string[]} */ (opts['--capture']).map((p) => load(p, io));
      // argparse's `if args.prior`: an empty value reads as no prior.
      const prior = opts['--prior'] ? load(/** @type {string} */ (opts['--prior']), io) : null;
      io.out(dumps(buildExport(captures, opts['--cutoff'], prior, opts['--pagination-complete'] === true), { indent: 2 }) + '\n');
    } else if (command === 'validate-event' || command === 'prepare-event') {
      const event = validateEvent(load(positional[0], io));
      if (command === 'validate-event') {
        io.out(canonical(event) + '\n');
      } else {
        validatePrepared(event);
        io.out(EVENT_MARKER + '\n```json\n' + dumps(event, { indent: 2 }) + '\n```\n');
      }
    } else {
      const data = report(validateSnapshot(load(/** @type {string} */ (opts['--snapshot']), io)), load(/** @type {string} */ (opts['--export']), io),
        /** @type {string} */ (opts['--reproduction-command']));
      io.out((opts['--format'] === 'markdown' ? markdown(data) : dumps(data, { indent: 2 })) + '\n');
    }
    return 0;
  } catch (e) {
    if (e instanceof ContractError) {
      io.err('worklog: error: ' + e.message + '\n');
      return 2;
    }
    if (e instanceof PyCrash) {
      io.err('worklog: internal error: ' + e.message + '\n');
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
  });
}
