// The merge-authority contract (#195), moved from global/merge_authority.py (#494, S23 of #470): parse it,
// project it, and validate a project brief against it.
//
// The contract is a fenced `merge-authority-contract` JSON block in the method's `merge-authority` skill
// (method/skills/merge-authority/SKILL.md). `mhw check --project=DIR` calls checkProject(), which reads the
// INSTALLED copies of that skill and the project's root AGENTS.md, and reports:
//
//   - fail closed (exit 2) when no installed copy carries a readable contract, the copies disagree, or the
//     installed contract does not understand the declared format;
//   - findings (exit 1) when the project's one declaration block is absent, duplicated, incomplete, names an
//     unknown loop model or carries any key other than contract, loop-model, integration-branch and
//     boundary-trigger; when a trunk brief describes a release candidate without declaring its integration
//     branch (the contract's release-candidate hold then rests on prose); when a boundary trigger uses
//     authority vocabulary; when the live prose carries a known legacy phrase; and when the live prose
//     names a loop model other than the declared one.
//
// Live prose excludes struck spans, code fences, blockquotes, HTML comments and quoted text. This parses one
// bounded block and a short list of known phrases; it does not understand natural language, so an unrelated
// paraphrase outside the block is a review-level false negative. A check you run, not a hook.
// The patterns are the Python ones, read with Python's \w, \d, \s, \b and IGNORECASE sets (src/lib/clean.js
// py() and ci()), so a non-ASCII letter next to a phrase decides a word boundary as CPython 3.14 does.
// node: modules only.
import fs from 'node:fs';
import { py, ci, readTextPy, osErrorClass, PyError, digitValue } from './clean.js';
import { loads, isDict, isPyWs, pyStrip, pyRepr, pyStr, cmpStr, PyFloat, codePoints } from './py.js';
import { pathlibJoin } from '../render/chrome-debugging.js';

export const FENCE_INFO = 'merge-authority-contract';
export const SKILL = 'merge-authority';
export const BEGIN = '<!-- merge-authority:begin -->';
export const END = '<!-- merge-authority:end -->';
export const PROJECTION_BEGIN = '<!-- merge-authority:projection';
export const PROJECTION_END = '<!-- merge-authority:end -->';
export const INSTALL = 'run `mhw install --method` (./mhw install --method in a checkout), then check again';
export const ALLOWED = Object.freeze(['contract', 'loop-model', 'integration-branch', 'boundary-trigger']);

// Every ASCII letter, spelled out: ci() takes a class's letters one by one and refuses a range.
const LETTERS = 'abcdefghijklmnopqrstuvwxyz';
/** A Python pattern compiled with re.IGNORECASE. @param {string} src @param {string} [flags] */
const pyI = (src, flags = 'gu') => new RegExp(py(ci(src)), flags);
/** A Python pattern, case-sensitive. @param {string} src @param {string} [flags] */
const pyR = (src, flags = 'gu') => new RegExp(py(src), flags);

// Live prose that describes a release candidate or an rc/ branch: the release-candidate hold must then be
// declared, so it rests on the contract and not on prose the contract does not see.
const RC_PROSE = pyI(String.raw`\brelease candidate\b|(?<![\w/])rc/[` + LETTERS + String.raw`0123456789._\-]+`, 'u');
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

// A key a project may not declare, by what it would override. Matched on the lower-cased key.
const OVERRIDE_KEYS = /** @type {Array<[RegExp, string]>} */ ([
  [/execut|merger|merged-by|merges?$|who-merges/, 'executor override'],
  [/hold|ratif|escalat|human/, 'hold override'],
  [/verdict|literal|approve/, 'verdict override'],
  [/^(?:safe|boundary|class|classes|class-.*)$/s, 'class relationship override'],
]);
// Words that assign authority rather than classify. A boundary trigger carrying one is refused.
const AUTHORITY_WORDS = pyI(String.raw`APPROVE-|\bratif\w*|\bescalat\w*|\bholds?\b|\bmerges\b|\bmerged by\b|`
  + 'go/no-go|pending[- ]human', 'u');
// Known legacy phrases, matched on flattened live prose with emphasis and code marks removed.
const LEGACY = /** @type {Array<[RegExp, string]>} */ ([
  [pyI(String.raw`\bescalat\w*\s+(?:the\s+)?boundary\b`),
    'the gate escalates the boundary class: that is a fifth hold the method does not have'],
  [pyI(String.raw`\bboundary(?:\s+class)?\s+(?:is|are|goes|go)\s+(?:escalated|held|handed up|ratified|to the owner)\b`),
    'the boundary class is held for the owner: that is a fifth hold the method does not have'],
  [pyI(String.raw`\b(?:never|not|n't)\s+merges?\s+(?:the\s+)?boundary\b`),
    'the gate does not merge the boundary class: that changes the method\'s executor'],
]);
const PRECEDENCE = pyI(String.raw`\bthis file wins\b`, 'u');
const MERGE_AUTHORITY = pyI('merge[- ]authority', 'u');
const LOOP_MODEL_PROSE = pyI(String.raw`\bloop model:\s*([` + LETTERS + ']+(?:-[' + LETTERS + ']+)+)');
const DECL_BULLET = pyR(String.raw`^[-*]\s+`, 'u');
const DECL_LINE = pyR(String.raw`^([A-Za-z][A-Za-z0-9_-]*)\s*:\s*(.*)$`, 'su');
const DECL_CONTRACT = pyR(String.raw`^merge-authority\s+v(\d+)$`, 'u');
const VERDICT_EDGE = (/** @type {string} */ v) => new RegExp('(?<![A-Z-])' + v.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`) + '(?![A-Z-])', 'u');

export class ContractError extends Error {}

/** @typedef {Record<string, any>} Contract */

// ---------------------------------------------------------------------------------------------------
// Python's view of a parsed JSON value.

/** isinstance(v, int): an int, or a bool (Python's bool is an int). @param {unknown} v */
const isIntLike = (v) => typeof v === 'boolean' || (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'bigint';
/** The numeric value of an int-like or float, for Python's == and %d. @param {unknown} v */
const numeric = (v) => (v instanceof PyFloat ? v.v : Number(v));
/** @param {unknown} v */
const isNumberLike = (v) => isIntLike(v) || v instanceof PyFloat;

/**
 * Python's == over parsed JSON values: 1 == 1.0 == True, a dict by its keys and values in any order, a list
 * item by item.
 * @param {unknown} a @param {unknown} b
 * @returns {boolean}
 */
export function pyEqual(a, b) {
  if (isNumberLike(a) && isNumberLike(b)) return numeric(a) === numeric(b);
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => pyEqual(x, b[i]));
  }
  if (isDict(a) && isDict(b)) {
    const ka = Object.keys(/** @type {object} */ (a));
    const kb = Object.keys(/** @type {object} */ (b));
    return ka.length === kb.length && ka.every((k) => Object.hasOwn(/** @type {object} */ (b), k)
      && pyEqual(/** @type {any} */ (a)[k], /** @type {any} */ (b)[k]));
  }
  return a === b;
}

/** Python `x in container` for a list, a dict (its keys) or a str (a substring). @param {unknown} x @param {unknown} container */
function pyIn(x, container) {
  if (Array.isArray(container)) return container.some((y) => pyEqual(x, y));
  if (typeof container === 'string') return typeof x === 'string' && container.includes(x);
  if (isDict(container)) return typeof x === 'string' && Object.hasOwn(/** @type {object} */ (container), x);
  return false;
}

/** list(x): a list's items, a str's characters, a dict's keys. @param {unknown} x @param {string} where */
function pyList(x, where) {
  if (Array.isArray(x)) return x;
  if (typeof x === 'string') return codePoints(x);
  if (isDict(x)) return Object.keys(/** @type {object} */ (x));
  throw new ContractError(where + ': holds must be a list');
}

/** "%d" % v. @param {unknown} v */
const pyD = (v) => String(Math.trunc(numeric(v)));

// ---------------------------------------------------------------------------------------------------
// The contract.

/**
 * The bodies of every fenced contract block: re.findall(r"(?ms)^```merge-authority-contract[ \t]*\n(.*?)^```[ \t]*$").
 * @param {string} text
 */
function fencedBlocks(text) {
  const lines = text.split('\n');
  const open = new RegExp('^```' + FENCE_INFO + '[ \\t]*$');
  const close = /^```[ \t]*$/;
  /** @type {string[]} */
  const blocks = [];
  for (let i = 0; i < lines.length - 1; i++) {
    if (!open.test(lines[i])) continue;
    let j = i + 1;
    while (j < lines.length && !close.test(lines[j])) j++;
    if (j === lines.length) break;
    blocks.push(lines.slice(i + 1, j).map((l) => l + '\n').join(''));
    i = j;
  }
  return blocks;
}

/** The one fenced contract block, decoded, with its top-level shape checked. @param {string} text @param {string} where */
function load(text, where) {
  const blocks = fencedBlocks(text);
  if (blocks.length !== 1) {
    throw new ContractError(where + ': expected one ```' + FENCE_INFO + ' block, found ' + blocks.length);
  }
  /** @type {any} */
  let c;
  try {
    c = loads(blocks[0]);
  } catch (e) {
    throw new ContractError(where + ': the contract is not valid JSON (' + /** @type {Error} */ (e).message + ')');
  }
  if (!isDict(c) || c.contract !== 'merge-authority') throw new ContractError(where + ': not a merge-authority contract');
  const dv = c['declaration-versions'];
  if (!isIntLike(c.version) || !Array.isArray(dv) || !dv.length || !dv.every(isIntLike)) {
    throw new ContractError(where + ': version and a non-empty list of integer declaration-versions are required');
  }
  if (!Array.isArray(c.verdicts) || !isDict(c.holds) || !isDict(c.models) || !Object.keys(c.models).length) {
    throw new ContractError(where + ': verdicts, holds and models are required');
  }
  return /** @type {Contract} */ (c);
}

/**
 * Optional keys (#133, #134): a copy installed before the evidence, discharge or owner-check rule still
 * parses; a present key must be well formed.
 * @param {Contract} c @param {string} where
 */
function checkOptional(c, where) {
  for (const key of ['owner-evidence', 'hold-discharge', 'owner-check']) {
    if (Object.hasOwn(c, key) && (typeof c[key] !== 'string' || !pyStrip(c[key]))) {
      throw new ContractError(where + ': ' + key + ' must be a non-empty string');
    }
  }
  const retired = Object.hasOwn(c, 'retired-verdicts') ? c['retired-verdicts'] : [];
  if (!Array.isArray(retired) || !retired.every((v) => typeof v === 'string' && pyStrip(v))
      || retired.some((v) => pyIn(v, c.verdicts))) {
    throw new ContractError(where + ': retired-verdicts must be a list of literals none of which is a live verdict');
  }
}

/** One model's keys, verdict mappings and holds, its integration-branch variant included. @param {string} name @param {any} m @param {Contract} c @param {string} where */
function checkModel(name, m, c, where) {
  for (const key of ['executor', 'safe', 'boundary', 'holds', 'on-hold', 'hold-executor', 'executor-blocked', 'changes']) {
    if (!pyIn(key, m)) throw new ContractError(where + ': model ' + name + ' lacks ' + key);
  }
  for (const key of ['safe', 'boundary', 'on-hold', 'executor-blocked', 'changes']) {
    if (!pyIn(m[key], c.verdicts)) {
      throw new ContractError(where + ': model ' + name + ' maps ' + key + ' to an unknown verdict ' + pyStr(m[key]));
    }
  }
  const variant = isDict(m) ? m['with-integration-branch'] : undefined;
  /** @type {unknown[]} */
  let extra = [];
  if (variant !== undefined && variant !== null) {
    if (!isDict(variant) || !Array.isArray(variant.holds) || !variant.holds.length || !Object.hasOwn(variant, 'promotion-executor')) {
      throw new ContractError(where + ': model ' + name + ' has a malformed with-integration-branch');
    }
    extra = variant.holds;
  }
  for (const h of [...pyList(m.holds, where + ': model ' + name), ...extra]) {
    if (!pyIn(h, c.holds)) throw new ContractError(where + ': model ' + name + ' names an unknown hold ' + pyStr(h));
  }
}

/**
 * The one fenced merge-authority-contract block in a text, as a validated contract.
 * @param {string} text @param {string} [where]
 * @returns {Contract}
 */
export function parseContract(text, where = 'the contract') {
  const c = load(text, where);
  checkOptional(c, where);
  for (const [name, m] of Object.entries(c.models)) checkModel(name, m, c, where);
  return c;
}

/**
 * One model's projection line. #133 (contract v2): a hold is discharged by the owner's cited comment, then
 * the named actor merges; a contract without hold-discharge (v1) renders the v1 wording unchanged.
 * @param {string} name @param {any} m @param {Contract} c
 */
function modelLine(name, m, c) {
  const holdList = pyList(m.holds, name);
  const holds = holdList.map((h, i) => '(' + (i + 1) + ') ' + pyStr(c.holds[/** @type {string} */ (h)])).join('; ');
  const discharge = c['hold-discharge'];
  const held = discharge
    ? '`' + pyStr(m['on-hold']) + '` until ' + pyStr(discharge) + ', then `' + pyStr(m['hold-executor']) + '` merges'
    : '`' + pyStr(m['on-hold']) + '`, the ' + pyStr(m['hold-executor']) + ' merges';
  let line = '- `' + name + '`: `' + pyStr(m.executor) + '` merges what it clears; safe class -> `' + pyStr(m.safe)
    + '`; boundary class -> `' + pyStr(m.boundary) + '`; ' + holdList.length + ' holds -> ' + held + ': ' + holds
    + '. Cleared but not executable -> `' + pyStr(m['executor-blocked']) + '`; unmet Definition of Done -> `'
    + pyStr(m.changes) + '`.';
  if (Object.hasOwn(m, 'promotion-executor')) {
    line += discharge
      ? ' The promotion is held the same way, then `' + pyStr(m['promotion-executor']) + '` merges it.'
      : ' The promotion is the ' + pyStr(m['promotion-executor']) + "'s.";
  }
  const variant = m['with-integration-branch'];
  if (isDict(variant) && Object.keys(variant).length) {
    const vheld = discharge
      ? '`' + pyStr(m['on-hold']) + '`, discharged the same way, then `' + pyStr(variant['promotion-executor']) + '` merges'
      : '`' + pyStr(m['on-hold']) + '`, the ' + pyStr(variant['promotion-executor']) + ' merges';
    line += ' With a declared integration branch, slices merge into it under this rule, and '
      + (variant.holds.length > 1 ? 'these holds are added' : 'this hold is added') + ': '
      + variant.holds.map((/** @type {string} */ h) => pyStr(c.holds[h])).join('; ') + ' -> ' + vheld + '.';
  }
  return line;
}

/**
 * The operational copy every method consumer carries, generated from the contract (exact text).
 * @param {Contract} c
 */
export function projection(c) {
  const out = [PROJECTION_BEGIN + ' v' + pyD(c.version) + ': generated from the merge-authority skill; do not edit by hand -->'];
  for (const name of Object.keys(c.models)) out.push(modelLine(name, c.models[name], c));
  if (c['owner-evidence']) out.push('- Owner-dependent criteria: ' + pyStr(c['owner-evidence']) + '.');
  if (c['owner-check']) out.push('- Owner check: ' + pyStr(c['owner-check']) + '.');
  const retired = c['retired-verdicts'];
  if (Array.isArray(retired) && retired.length) {
    out.push('- Retired verdicts, refused by every reader: ' + retired.map((v) => '`' + v + '`').join(', ') + '.');
  }
  out.push('- Canonical source: the `merge-authority` skill. A project brief declares only its loop model, '
    + 'its integration branch if it has one, and its boundary triggers.');
  out.push(PROJECTION_END);
  return out.join('\n');
}

/** The projection block in a consumer's text, or null. @param {string} text */
export function projectionBlock(text) {
  const start = text.indexOf(PROJECTION_BEGIN);
  if (start === -1) return null;
  const end = text.indexOf(PROJECTION_END, start);
  return end === -1 ? null : text.slice(start, end + PROJECTION_END.length);
}

/**
 * Drift of one method operational copy from the contract: its projection block must equal the projection,
 * each verdict in `verdicts` must still be named outside the block, its live prose must name no retired
 * verdict (#134; struck, fenced or quoted history may) and carry no known legacy phrase. A check over
 * strings; a paraphrase elsewhere is not caught.
 * @param {string} text @param {Contract} contract @param {string[]} verdicts
 */
export function methodCopyFindings(text, contract, verdicts) {
  /** @type {string[]} */
  const found = [];
  const block = projectionBlock(text);
  if (block === null) found.push('no projection block');
  else if (block !== projection(contract)) found.push('the projection block differs from the contract');
  const rest = block ? text.replaceAll(block, '') : text;
  for (const v of verdicts) if (!VERDICT_EDGE(v).test(rest)) found.push('no longer names ' + v);
  const live = liveProse(rest);
  for (const v of contract['retired-verdicts'] || []) {
    if (VERDICT_EDGE(v).test(live)) found.push('its live prose names the retired verdict ' + v);
  }
  found.push(...legacyFindings(text));
  return found;
}

// ---------------------------------------------------------------------------------------------------
// Live prose.

/**
 * A fence opener or closer at the start of a line after any whitespace (re.match(r"^\s*(`{3,}|~{3,})")):
 * the run of backticks or tildes, or null.
 * @param {string} line
 */
function fenceOf(line) {
  const cps = codePoints(line);
  let i = 0;
  while (i < cps.length && isPyWs(cps[i])) i++;
  const ch = cps[i];
  if (ch !== '`' && ch !== '~') return null;
  let j = i;
  while (j < cps.length && cps[j] === ch) j++;
  return j - i >= 3 ? ch.repeat(j - i) : null;
}

/** re.match(r"^\s*>", line). @param {string} line */
function quoted(line) {
  const cps = codePoints(line);
  let i = 0;
  while (i < cps.length && isPyWs(cps[i])) i++;
  return cps[i] === '>';
}

/** re.sub(open + ".*?" + close, " ", text, flags=re.S), close searched after open. @param {string} text @param {string} open @param {string} close */
function dropSpans(text, open, close) {
  let out = '';
  let at = 0;
  for (;;) {
    const a = text.indexOf(open, at);
    if (a === -1) break;
    const b = text.indexOf(close, a + open.length);
    if (b === -1) break;
    out += text.slice(at, a) + ' ';
    at = b + close.length;
  }
  return out + text.slice(at);
}

/** re.sub(re.escape(a) + r"[^\n]*?" + re.escape(b), " ", text): a quote closed on its own line. @param {string} text @param {string} a @param {string} b */
function dropQuotes(text, a, b) {
  let out = '';
  let at = 0;
  let from = 0;
  for (;;) {
    const s = text.indexOf(a, from);
    if (s === -1) break;
    const e = text.indexOf(b, s + a.length);
    const nl = text.indexOf('\n', s + a.length);
    if (e === -1 || (nl !== -1 && nl < e)) {
      from = s + 1;
      continue;
    }
    out += text.slice(at, s) + ' ';
    at = e + b.length;
    from = at;
  }
  return out + text.slice(at);
}

/**
 * Text a reader takes as a live instruction: no fences, struck spans, blockquotes, comments or quotes. A
 * fence is recognised at any indentation (#134, PR #423 round 2): a fence inside a list item left
 * unrecognised keeps its `~~~` and inverts every strike pairing after it.
 * @param {string} text
 */
export function liveProse(text) {
  /** @type {string[]} */
  const kept = [];
  /** @type {string | null} */
  let fence = null;
  for (const line of text.split('\n')) {
    const m = fenceOf(line);
    if (fence) {
      if (m && m[0] === fence[0] && m.length >= fence.length) fence = null;
      continue;
    }
    if (m) {
      fence = m;
      continue;
    }
    if (quoted(line)) continue;
    kept.push(line);
  }
  let t = kept.join('\n');
  t = dropSpans(t, '<!--', '-->');
  t = dropSpans(t, '~~', '~~');
  for (const [a, b] of [['“', '”'], ['«', '»'], ['"', '"']]) t = dropQuotes(t, a, b);
  return t;
}

/** Python '" ".join(re.sub(r"[*_BACKTICK]", "", text).split())': emphasis and code marks dropped, whitespace runs one space.
 * @param {string} text */
export function flatten(text) {
  /** @type {string[]} */
  const words = [];
  let word = '';
  for (const ch of text) {
    if (ch === '*' || ch === '_' || ch === '`') continue;
    if (isPyWs(ch)) {
      if (word) words.push(word);
      word = '';
    } else word += ch;
  }
  if (word) words.push(word);
  return words.join(' ');
}

/** Known conflicting phrases in the live prose of a text. @param {string} text */
export function legacyFindings(text) {
  const flat = flatten(liveProse(text));
  /** @type {string[]} */
  const found = [];
  for (const [pattern, why] of LEGACY) {
    for (const m of flat.matchAll(pattern)) found.push(why + ' (' + pyRepr(m[0]) + ')');
  }
  for (const sentence of flat.split(/(?<=[.;!?]) +/)) {
    const m = PRECEDENCE.exec(sentence);
    if (m && !MERGE_AUTHORITY.test(sentence)) {
      found.push('the brief claims it wins over the method, which reaches merge authority (' + pyRepr(m[0]) + ')');
    }
  }
  return found;
}

// ---------------------------------------------------------------------------------------------------
// The project's declaration.

/** Python's str.rstrip(). @param {string} s */
function rstrip(s) {
  const cps = codePoints(s);
  let b = cps.length;
  while (b > 0 && isPyWs(cps[b - 1])) b--;
  return cps.slice(0, b).join('');
}

/**
 * Each declaration block's inner lines, for blocks whose markers sit at column 0 outside a fence; null
 * for a block opened and never closed.
 * @param {string} text
 * @returns {Array<string[] | null>}
 */
export function declarationBlocks(text) {
  /** @type {Array<string[] | null>} */
  const blocks = [];
  /** @type {string[] | null} */
  let current = null;
  /** @type {string | null} */
  let fence = null;
  for (const line of text.split('\n')) {
    const m = fenceOf(line);
    if (fence) {
      if (m && m[0] === fence[0] && m.length >= fence.length) fence = null;
      continue;
    }
    if (m && current === null) {
      fence = m;
      continue;
    }
    const r = rstrip(line);
    if (r === BEGIN) current = [];
    else if (r === END && current !== null) {
      blocks.push(current);
      current = null;
    } else if (current !== null) current.push(line);
  }
  if (current !== null) blocks.push(null);
  return blocks;
}

/** s[:n] in code points. @param {string} s @param {number} n */
const head = (s, n) => codePoints(s).slice(0, n).join('');
/** str.strip() of the backtick character. @param {string} s */
function stripTicks(s) {
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === '`') a++;
  while (b > a && s[b - 1] === '`') b--;
  return s.slice(a, b);
}

/**
 * Findings, the unsupported format (or null), the loop model and whether an integration branch is declared,
 * for one block's lines against the installed contract.
 * @param {string[]} lines @param {Contract} contract
 * @returns {{ findings: string[], unsupported: [number, unknown[]] | null, model: string | null, branch: boolean }}
 */
export function checkDeclaration(lines, contract) {
  /** @type {string[]} */
  const findings = [];
  /** @type {Array<[string, string]>} */
  const entries = [];
  for (const raw of lines) {
    let s = pyStrip(raw);
    if (!s) continue;
    s = s.replace(DECL_BULLET, '');
    const m = DECL_LINE.exec(s);
    if (!m) {
      findings.push('the declaration carries a line that is not `key: value`: ' + pyRepr(head(s, 60)));
      continue;
    }
    entries.push([m[1].toLowerCase(), pyStrip(m[2])]);
  }
  for (const [key] of entries) {
    if (ALLOWED.includes(key)) continue;
    const kind = OVERRIDE_KEYS.find(([p]) => p.test(key))?.[1];
    if (kind) {
      findings.push(kind + ': a project may not declare `' + key + '`; the method owns the executor, the verdicts and the holds');
    } else findings.push('unknown key `' + key + '`: the declaration carries only ' + ALLOWED.join(', '));
  }
  const contracts = entries.filter(([k]) => k === 'contract').map(([, v]) => v);
  const models = entries.filter(([k]) => k === 'loop-model').map(([, v]) => v);
  const branches = entries.filter(([k]) => k === 'integration-branch').map(([, v]) => v);
  /** @type {[number, unknown[]] | null} */
  let unsupported = null;
  if (contracts.length !== 1) {
    findings.push('the declaration needs exactly one `contract: merge-authority vN` line (found ' + contracts.length + ')');
  } else {
    const m = DECL_CONTRACT.exec(contracts[0]);
    if (!m) findings.push('`contract: ' + contracts[0] + '` does not reference the method contract (merge-authority vN)');
    else {
      const n = codePoints(m[1]).reduce((acc, ch) => acc * 10 + digitValue(/** @type {number} */ (ch.codePointAt(0))), 0);
      const known = contract['declaration-versions'];
      if (!known.some((/** @type {unknown} */ k) => pyEqual(n, k))) unsupported = [n, known];
    }
  }
  const models0 = contract.models;
  if (models.length !== 1) findings.push('the declaration needs exactly one `loop-model` line (found ' + models.length + ')');
  else if (!Object.hasOwn(models0, models[0])) {
    findings.push('loop model `' + models[0] + '` is not one the contract maps (' + Object.keys(models0).sort(cmpStr).join(', ') + ')');
  }
  if (branches.length > 1) findings.push('the declaration carries ' + branches.length + ' `integration-branch` lines; at most one');
  for (const b of branches) {
    if (!BRANCH.test(stripTicks(b))) findings.push('`integration-branch: ' + head(b, 60) + '` is not a branch name');
  }
  if (branches.length && models.length === 1 && Object.hasOwn(models0, models[0])
      && !models0[models[0]]['with-integration-branch']) {
    findings.push('`integration-branch` is declared, but the contract gives `' + models[0] + '` no integration-branch variant');
  }
  for (const [key, value] of entries) {
    if (key !== 'boundary-trigger') continue;
    if (!value) findings.push('an empty `boundary-trigger`');
    else {
      const m = AUTHORITY_WORDS.exec(value);
      if (m) findings.push('a boundary trigger may classify, not assign authority: ' + pyRepr(head(value, 60)) + ' uses ' + pyRepr(m[0]));
    }
  }
  return { findings, unsupported, model: models.length === 1 ? models[0] : null, branch: branches.length > 0 };
}

// ---------------------------------------------------------------------------------------------------
// The installed contract, and a project against it.

/** @param {string} home @returns {Array<[string, string]>} */
export function installedSkillPaths(home) {
  return [['Claude Code', pathlibJoin(home, ['.claude', 'skills', SKILL, 'SKILL.md'])],
    ['Codex', pathlibJoin(home, ['.agents', 'skills', SKILL, 'SKILL.md'])],
    ['Kiro', pathlibJoin(home, ['.kiro', 'skills', SKILL, 'SKILL.md'])]];
}

/** pathlib's is_file(). @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * The installed contract, or a ContractError with the reason to fail closed.
 * @param {string} home
 * @returns {Contract}
 */
export function installedContract(home) {
  /** @type {Array<[string, Contract]>} */
  const found = [];
  for (const [harness, p] of installedSkillPaths(home)) {
    if (!isFile(p)) continue;
    let text;
    try {
      text = readTextPy(p, 'utf-8');
    } catch (e) {
      const cls = e instanceof PyError ? e.message : osErrorClass(/** @type {NodeJS.ErrnoException} */ (e));
      throw new ContractError(harness + ' copy ' + p + ' cannot be read (' + cls + ')');
    }
    found.push([harness, parseContract(text, harness + ' copy ' + p)]);
  }
  if (!found.length) {
    throw new ContractError("no installed copy of the method's merge-authority contract (the method is not installed, or it predates #195)");
  }
  const first = found[0][1];
  for (const [harness, c] of found.slice(1)) {
    if (!pyEqual(c, first)) throw new ContractError('the installed copies of the contract disagree (' + found[0][0] + ' and ' + harness + ')');
  }
  return first;
}

/** "v1, v2" from a list of int-likes. @param {unknown[]} known */
const versions = (known) => known.map((k) => 'v' + pyD(k)).join(', ');

/**
 * [exit code, report lines] for a project's root AGENTS.md against the installed contract.
 * @param {string} root @param {string} home
 * @returns {[number, string[]]}
 */
export function checkProject(root, home) {
  const tag = 'PROJECT merge authority: ';
  /** @type {Contract} */
  let contract;
  try {
    contract = installedContract(home);
  } catch (e) {
    if (!(e instanceof ContractError)) throw e;
    return [2, [tag + 'CANNOT VALIDATE (fail closed): ' + e.message + '; ' + INSTALL]];
  }
  const brief = pathlibJoin(root, ['AGENTS.md']);
  let text;
  try {
    text = readTextPy(brief, 'utf-8');
  } catch (e) {
    if (e instanceof PyError) {
      // #494: workstation.py stopped here with a traceback (UnicodeDecodeError is not an OSError).
      return [1, [tag + 'FAIL the AGENTS.md at ' + root + ' is not readable UTF-8; the project brief must declare its merge-authority block']];
    }
    return [1, [tag + 'no AGENTS.md at ' + root + '; the project brief must declare its merge-authority block']];
  }
  /** @type {string[]} */
  const findings = [];
  const blocks = declarationBlocks(text);
  const first = blocks[0];
  if (!blocks.length) {
    findings.push('no `' + BEGIN + '` block: declare the loop model and the boundary triggers there and reference the method contract instead of restating it');
  } else if (blocks.length > 1) findings.push(blocks.length + ' declaration blocks; there must be exactly one');
  else if (first === null) findings.push('the declaration block is opened and never closed with `' + END + '`');
  else {
    const d = checkDeclaration(first, contract);
    if (d.unsupported) {
      const [n, known] = d.unsupported;
      if (n > Math.max(...known.map(numeric))) {
        return [2, [tag + 'CANNOT VALIDATE (fail closed): the project declares format v' + n + ' and the installed contract (v'
          + pyD(contract.version) + ') understands only ' + versions(known) + '; ' + INSTALL]];
      }
      d.findings.push('the project declares format v' + n + ', which the installed contract no longer reads (it reads '
        + versions(known) + '); update the `contract` line');
    }
    findings.push(...d.findings);
    const model = d.model;
    const models = contract.models;
    const modelDoc = model !== null && Object.hasOwn(models, model) ? models[model] : {};
    if (model && modelDoc['with-integration-branch'] && !d.branch) {
      const rc = RC_PROSE.exec(flatten(liveProse(text)));
      if (rc) {
        findings.push('the prose describes a release candidate or an integration branch (' + pyRepr(rc[0]) + ') but the '
          + "declaration has no `integration-branch`; declare it so the contract's release-candidate hold applies");
      }
    }
    if (model) {
      for (const m of flatten(liveProse(text)).matchAll(LOOP_MODEL_PROSE)) {
        if (m[1].toLowerCase() !== model) findings.push('the prose names loop model `' + m[1] + '`, the declaration `' + model + '`');
      }
    }
  }
  findings.push(...legacyFindings(text).map((f) => 'changes method-owned merge authority: ' + f));
  if (findings.length) return [1, findings.map((f) => tag + 'FAIL ' + f)];
  return [0, [tag + 'OK (contract v' + pyD(contract.version) + ')']];
}
