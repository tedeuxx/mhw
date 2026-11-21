// The version key (Issue #57, ADR-0030), moved from global/workstation.py (#493, S22 of #470): a
// project declares the workstation release range it needs in a .workstation-version file, for example
// ">=3.1 <4"; status compares it with the installed provenance stamp and never fails on a mismatch.
// Pure functions, no I/O. Python's \d is every Unicode decimal digit and its \s every str.isspace()
// character; both are kept. Versions compare as BigInt, as Python's int does. node: modules only.
import { inRanges, digitValue } from '../clean.js';
import { DIGIT } from '../clean-unicode.js';
import { isPyWs, pyStrip } from '../py.js';
import { splitlines } from '../yaml-subset.js';
import { KEY_FILE } from './common.js';

/** @typedef {[bigint, bigint, bigint]} Version */

/** @param {string} ch */
const isDigit = (ch) => inRanges(DIGIT, /** @type {number} */ (ch.codePointAt(0)));

/** int() of a run of \d characters. @param {string[]} cps */
const intOf = (cps) => cps.reduce((n, c) => n * 10n + BigInt(digitValue(/** @type {number} */ (c.codePointAt(0)))), 0n);

/**
 * re.fullmatch(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?", s): the up to three numbers, or null.
 * @param {string} s
 * @returns {Version | null}
 */
function versionMatch(s) {
  const cps = Array.from(s);
  let i = cps[0] === 'v' ? 1 : 0;
  /** @type {bigint[]} */
  const parts = [];
  for (let n = 0; n < 3; n++) {
    if (n > 0) {
      if (cps[i] !== '.' || i + 1 >= cps.length || !isDigit(cps[i + 1])) break;
      i++;
    }
    const start = i;
    while (i < cps.length && isDigit(cps[i])) i++;
    if (i === start) return null;
    parts.push(intOf(cps.slice(start, i)));
  }
  if (i !== cps.length) return null;
  while (parts.length < 3) parts.push(0n);
  return /** @type {Version} */ (parts);
}

/** 'v3.1.2' -> [3n, 1n, 2n]; a missing part is 0; anything else is null. @param {string} text */
export function parseVersion(text) {
  return versionMatch(pyStrip(text));
}

const OPS = ['>=', '<=', '>', '<', '='];

/**
 * re.split(r"[\s,]+", text.strip()) without its empty parts.
 * @param {string} text
 */
function splitRange(text) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  for (const ch of pyStrip(text)) {
    if (ch === ',' || isPyWs(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/**
 * '>=3.1 <4' -> [['>=', [3n,1n,0n]], ['<', [4n,0n,0n]]]. Comparators are separated by blanks or commas
 * and all must hold. Throws an Error with Python's message on anything else, an empty range included.
 * @param {string} text
 * @returns {Array<[string, Version]>}
 */
export function parseRange(text) {
  const parts = splitRange(text);
  if (!parts.length) throw new Error('empty range');
  /** @type {Array<[string, Version]>} */
  const out = [];
  for (const part of parts) {
    // (>=|<=|>|<|=)(v?\d+(?:\.\d+){0,2}) as a full match: the operator is the longest that leaves a version.
    let hit = null;
    for (const op of OPS) {
      if (!part.startsWith(op)) continue;
      const v = versionMatch(part.slice(op.length));
      if (v) {
        hit = /** @type {[string, Version]} */ ([op, v]);
        break;
      }
    }
    if (!hit) throw new Error('not a comparator: ' + part);
    out.push(hit);
  }
  return out;
}

/** -1, 0 or 1. @param {Version} a @param {Version} b */
function compare(a, b) {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  }
  return 0;
}

/** @param {Version} version @param {Array<[string, Version]>} comparators */
export function satisfies(version, comparators) {
  for (const [op, bound] of comparators) {
    const c = compare(version, bound);
    const ok = { '>=': c >= 0, '<=': c <= 0, '>': c > 0, '<': c < 0, '=': c === 0 }[op];
    if (!ok) return false;
  }
  return true;
}

/**
 * re.fullmatch(r"v(\d+)\.(\d+)\.(\d+)", s) or, with prefix, r"unreleased, after v(\d+)\.(\d+)\.(\d+)".
 * @param {string} s
 */
function releaseMatch(s) {
  const body = s.startsWith('v') ? s.slice(1) : null;
  if (body === null) return null;
  const cps = Array.from(body);
  /** @type {bigint[]} */
  const parts = [];
  let i = 0;
  for (let n = 0; n < 3; n++) {
    if (n > 0) {
      if (cps[i] !== '.') return null;
      i++;
    }
    const start = i;
    while (i < cps.length && isDigit(cps[i])) i++;
    if (i === start) return null;
    parts.push(intOf(cps.slice(start, i)));
  }
  return i === cps.length ? /** @type {Version} */ (parts) : null;
}

/**
 * The version a provenance stamp's release field stands for. 'vX.Y.Z' is that release; an
 * 'unreleased, after vX.Y.Z' install is compared as X.Y.Z, because no newer release is in it.
 * 'none', 'unknown' and 'no tag reachable' stand for nothing.
 * @param {string | null | undefined} release
 */
export function installedVersion(release) {
  const r = pyStrip(release || '');
  const after = 'unreleased, after ';
  return releaseMatch(r) || (r.startsWith(after) ? releaseMatch(r.slice(after.length)) : null);
}

/** The range in a .workstation-version file: the first line that is not blank or a # comment. @param {string} text */
export function readKey(text) {
  for (const raw of splitlines(text)) {
    const line = pyStrip(raw.split('#')[0]);
    if (line) return line;
  }
  return '';
}

/** @param {string} required @param {string} installed */
export function mismatchLine(required, installed) {
  return 'Workstation version key: required ' + required + ', installed ' + (installed || 'none') +
    '. Run mhw install (./mhw install in a checkout).';
}

/**
 * -> [state, line]: state is match, mismatch or invalid; line is the one line to print, or ''.
 * @param {string} required
 * @param {string} release
 * @returns {['match' | 'mismatch' | 'invalid', string]}
 */
export function keyVerdict(required, release) {
  let comparators;
  try {
    comparators = parseRange(required);
  } catch (e) {
    return ['invalid', 'Workstation version key: ' + KEY_FILE + ' holds no valid range (' + /** @type {Error} */ (e).message + ').'];
  }
  const version = installedVersion(release);
  if (version !== null && satisfies(version, comparators)) return ['match', ''];
  return ['mismatch', mismatchLine(required, release)];
}
