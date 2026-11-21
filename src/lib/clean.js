// The cleaning core (#486, S15 of #470): the detection and redaction engine of
// global/clipboard/clipboard_guard.py (ADR-0011, ADR-0033) ported to Node. Terms, credentials and
// personal data, the same eleven categories in the same order, the same spans in the same order.
// clipboard_guard.py stays: the prompt hook and the paste wrapper still run it, until their slices move.
//
// Fail-open is the risk this file is built against: Python's re and JavaScript's RegExp disagree on
// \w, \d, \s, \b, case-insensitive matching and $, and a pattern that silently matches less reports
// nothing. So no pattern here uses a JavaScript class or flag for those. Each is rebuilt from the sets
// CPython 3.14.6 itself answers (src/lib/clean-unicode.js, recorded by test/helpers/s15-record.py):
//   \w \d \s     the recorded sets, as explicit code point ranges (the u flag, never \w or \p{})
//   \b           a lookaround pair over the recorded \w
//   (?i:...)     every letter expanded to the code points Python's re accepts for it (I to I i U+0130
//                U+0131, K to K k U+212A, S to S s U+017F, ...), never the i flag
//   $ and \Z     only ever at the end of the text here: JavaScript's $ without the m flag
// Offsets and lengths are in code points, as Python counts them, not in UTF-16 units.
// test/clean/clean.test.js holds every answer against the Python original's on a shared corpus.
//
// It returns positions and categories, never the matched text, and writes nothing. node: modules only
// (convention 5 of #470: the prompt hook will run it).
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  WORD, DIGIT, SPACE, ISDIGIT, LETTER_OR_NUMBER, MARK, CASEFOLD, IGNORE_CASE,
} from './clean-unicode.js';

export const PROJECT = 'personal-multi-harness-workstation-configuration';
export const MAX_TERM_TOKENS = 6;
export const MIN_TERM_CHARS = 3;
export const TERMS_HEADER = '# ' + PROJECT + ' clipboard terms v1: HMAC-SHA256(salt, normalised term), one per line; never plaintext\n';
export const CATEGORY_ORDER = Object.freeze(['employer-client-term', 'credential', 'email', 'payment-card', 'cpf', 'cnpj',
  'phone', 'postal-address', 'contract-value', 'health', 'colleague-name']);
/** The two categories seeded by a private term list of the owner's (Issue #36): category -> config key. */
export const TERM_LISTS = Object.freeze({ health: 'health_terms_file', 'colleague-name': 'colleague_terms_file' });
export const LIST_FILES = Object.freeze({ health: 'clipboard-terms-health', 'colleague-name': 'clipboard-terms-colleague' });
const REPORT_ONLY_DEFAULT = ['postal-address', 'contract-value'];

/**
 * The settings clipboard_guard.py's DEFAULTS carries that this core reads. The paste wrapper's notices
 * moved with it (#487), verbatim; the prompt hook's stay in the Python original until the hook moves. A
 * notice_ key is kept verbatim, as Python keeps it.
 * @type {Readonly<Record<string, string>>}
 */
export const DEFAULTS = Object.freeze({
  max_bytes: '1000000',
  block_categories: CATEGORY_ORDER.filter((c) => !REPORT_ONLY_DEFAULT.includes(c)).join(','),
  report_categories: REPORT_ONLY_DEFAULT.join(','),
  show_cleaned_chars: '8000',
  salt_store: '',
  keychain_service: PROJECT + '.clipboard-salt',
  keychain_path: '',
  terms_file: '',
  health_terms_file: '',
  colleague_terms_file: '',
  salt_file: '',
  // The paste wrapper (src/commands/paste-wrapper.js). The first two REPLACE a paste inside the CLI's
  // input, so they stay one line.
  notice_paste_too_large: '[paste filter (ADR-0033): a paste over {max} bytes was NOT forwarded, it could not '
    + 'be checked]',
  notice_paste_error: '[paste filter (ADR-0033): internal error ({error}), the paste was NOT forwarded]',
  notice_no_bracketed_paste: 'Paste filter (ADR-0033): {program} has not enabled bracketed paste, so pastes in '
    + 'this session are NOT cleaned.',
  // Appended to the two notices above when the CLI is kiro-cli (Issue #455).
  notice_kiro_hook_on: 'The Kiro prompt hook checks each prompt instead, but only in a trusted workspace: in '
    + 'an untrusted one Kiro runs no hooks, so nothing checks.',
  notice_kiro_hook_off: 'No Kiro prompt hook from this project is installed, so nothing checks a prompt.',
  notice_bracketed_paste_off: 'Paste filter (ADR-0033): {program} turned bracketed paste off, so pastes are '
    + 'NOT cleaned until it turns it back on.',
  notice_session_summary: 'Paste filter (ADR-0033): {count} paste(s) cleaned in this session ({categories}); '
    + '{replaced} paste(s) replaced by a notice.',
  notice_wrapper_no_salt: 'Paste filter (ADR-0033): the term list exists but its salt could not be read without '
    + 'a prompt, so term matching (employer/client terms, health terms, colleague names) is NOT '
    + 'applied in this session.',
  notice_wrapper_args_unmarked: 'Paste filter (ADR-0033): a command-line argument carries {categories} or could '
    + 'not be checked, so this session is NOT marked and the prompt hook checks '
    + 'every prompt.',
  notice_session_report_only: 'Paste filter (ADR-0033): {count} paste(s) in this session carried report-only '
    + 'categories ({categories}) and were forwarded unchanged.',
});

// ---------------------------------------------------------------------------------- character sets

/** @param {number} cp */
const hex = (cp) => String.raw`\u{` + cp.toString(16) + '}';

/** A class body (no brackets) for inclusive ranges. @param {number[]} r */
function classBody(r) {
  let s = '';
  for (let i = 0; i < r.length; i += 2) s += r[i] === r[i + 1] ? hex(r[i]) : hex(r[i]) + '-' + hex(r[i + 1]);
  return s;
}

/**
 * Is cp in the inclusive ranges r (sorted)? Binary search.
 * @param {number[]} r
 * @param {number} cp
 */
export function inRanges(r, cp) {
  let lo = 0;
  let hi = r.length / 2 - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cp < r[2 * mid]) hi = mid - 1;
    else if (cp > r[2 * mid + 1]) lo = mid + 1;
    else return true;
  }
  return false;
}

const W = classBody(WORD);
const D = classBody(DIGIT);
const S = classBody(SPACE);
/** The class bodies py() puts in place of \w, \d and \s. @type {Record<string, string>} */
const PY_CLASSES = { w: W, d: D, s: S };
/** Python's \b over its own \w. */
const B = '(?:(?<=[' + W + '])(?![' + W + '])|(?<![' + W + '])(?=[' + W + ']))';

/**
 * A Python pattern source, in the subset this file uses, as a JavaScript one with the u flag: \w \d \s
 * become the recorded sets, \b the lookaround pair, \Z the end of the text. Inside a class \w \d \s
 * become the set's ranges. Any other escape is copied as it is.
 * @param {string} src
 */
export function py(src) {
  let inClass = false;
  return src.replace(PY_TOKEN, (t) => {
    if (t.length === 1) {
      if (t === '[' && !inClass) inClass = true;
      else if (t === ']' && inClass) inClass = false;
      return t;
    }
    const next = t[1];
    if (Object.hasOwn(PY_CLASSES, next)) return inClass ? PY_CLASSES[next] : '[' + PY_CLASSES[next] + ']';
    if (next === 'b' && !inClass) return B;
    if (next === 'Z' && !inClass) return '$';
    return t;
  });
}

/** An escape (a backslash and the character after it), or one UTF-16 unit. */
const PY_TOKEN = /\\[^]|[^]/g;

/** @param {string} letter */
function ignoreCaseSet(letter) {
  const set = IGNORE_CASE[/** @type {keyof typeof IGNORE_CASE} */ (letter)];
  if (!set) throw new Error('no recorded ignore-case set for ' + JSON.stringify(letter));
  return set;
}

/**
 * Python's (?i:...) over a source in the subset this file uses: each letter outside a class becomes the
 * class of every code point Python accepts for it; a class's letters add theirs. Escapes and {m,n} pass
 * through. A letter with no recorded set throws, so a new pattern cannot silently turn case-sensitive.
 * @param {string} src
 */
export function ci(src) {
  return src.replace(CI_TOKEN, (t) => {
    if (t.length > 1 && (t[0] === '\\' || t[0] === '{')) return t;
    if (t.length > 1 && t[0] === '[') return ciClass(t.slice(1, -1));
    return LETTER.test(t) ? '[' + ignoreCaseSet(t).map(hex).join('') + ']' : t;
  });
}

/** An escape, a {m,n} quantifier, a class (none here holds a ]), or one code point. */
const CI_TOKEN = /\\.|\{[^}]*\}|\[[^\]]*\]|[^]/gu;
const LETTER = /^\p{L}$/u;

/**
 * A class under (?i): its letters' recorded sets added, everything else kept. A range (an unescaped -
 * between two members) throws: its letters would be taken one by one and the range dropped, so the class
 * would silently match less. The patterns here use no range inside a ci() class; one that needs it must
 * spell its letters out.
 * @param {string} body
 */
function ciClass(body) {
  /** @type {Set<number>} */
  const set = new Set();
  let raw = '';
  const toks = body.match(/\\.|[^]/gu) || [];
  const start = toks[0] === '^' ? 1 : 0;
  if (toks.some((t, i) => t === '-' && i > start && i < toks.length - 1)) {
    throw new Error('ci(): a range in a class is not supported: [' + body + ']');
  }
  for (const tok of toks) {
    if (LETTER.test(tok)) for (const cp of ignoreCaseSet(tok)) set.add(cp);
    else raw += tok;
  }
  return '[' + raw + [...set].sort((a, b) => a - b).map(hex).join('') + ']';
}

/** @param {string} src @param {string} [flags] */
const rx = (src, flags = 'gu') => new RegExp(src, flags);

// --------------------------------------------------------------------------------------- detectors

// Credential prefixes in the style of gitleaks' rules (clipboard_guard.py CREDENTIAL_PATTERNS, same order).
const CREDENTIAL_PATTERNS = [
  // [\s\S] is every character on both sides; written [^] here.
  String.raw`-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----[^]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----|\Z)`,
  String.raw`\b(?:AKIA|ASIA|ABIA|ACCA)[0-9A-Z]{16}\b`,
  String.raw`\bgh[pousr]_[A-Za-z0-9]{36,255}\b`,
  String.raw`\bgithub_pat_[A-Za-z0-9_]{50,255}\b`,
  String.raw`\bglpat-[A-Za-z0-9_\-]{20,}`,
  String.raw`\bxox[abposr]-[A-Za-z0-9\-]{10,}`,
  String.raw`https://hooks\.slack\.com/services/[A-Za-z0-9/_\-]{20,}`,
  String.raw`\bAIza[0-9A-Za-z_\-]{35}\b`,
  String.raw`\b[rs]k_live_[0-9A-Za-z]{20,}\b`,
  String.raw`\bsk-ant-[A-Za-z0-9_\-]{20,}`,
  String.raw`\bsk-(?:proj|svcacct|admin)-[A-Za-z0-9_\-]{20,}`,
  String.raw`\bnpm_[A-Za-z0-9]{36}\b`,
  String.raw`\beyJ[A-Za-z0-9_\-]{10,}\.eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}`,
].map((s) => rx(py(s)));

const EMAIL = rx(py(String.raw`(?<![A-Za-z0-9._%+\-])([A-Za-z0-9._%+\-]+)@((?:[A-Za-z0-9\-]+\.)+[A-Za-z]{2,})\b`), 'gdu');
const EMAIL_SKIP_LOCAL = new Set(['git']);
// re.IGNORECASE over the whole pattern; $ is only ever reached at the end of the domain group.
const EMAIL_SKIP_DOMAIN = rx(ci(String.raw`(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost|users\.noreply\.github\.com)$`), 'u');

const UPPER = 'A-ZÀ-ÖØ-Þ';
const LOWER = 'a-zß-öø-ÿ';
const PHONE_PATTERNS = [
  String.raw`(?<![\w+])\+55[ .\-]?(?:\([1-9]{2}\)|[1-9]{2})[ .\-]?9?\d{4}[ .\-]?\d{4}(?![\w\-])`,
  String.raw`(?<![\w(])\([1-9]{2}\)[ ]?9?\d{4}-\d{4}(?![\w\-])`,
  String.raw`(?<![\w+])\+(?!55)[1-9]\d{0,2}(?:[ .\-]?\(?\d{1,4}\)?){2,4}(?![\w\-])`,
].map((s) => rx(py(s)));
const PHONE_DIGITS = [10, 15];
const ADDRESS_PATTERNS = [
  String.raw`(?<![\w.\-/])\d{5}-\d{3}(?![\w\-/])(?!\.\w)`,
  String.raw`\b` + ci('CEP') + String.raw`[:\s]*\d{8}\b`,
  String.raw`\b(?:Rua|Avenida|Av\.|Alameda|Travessa|Praça|Rodovia|Estrada|Largo)\s+`
    + String.raw`(?:d[aeo]s?\s+)?[${UPPER}0-9][${UPPER}${LOWER}.]*(?:\s+(?:d[aeo]s?\s+|e\s+)?[${UPPER}0-9][${UPPER}${LOWER}.]*){0,5}`
    + String.raw`\s*(?:,\s*(?:n[º°o]\.?\s*)?|\s+n[º°o]\.?\s*)\d{1,5}\b`,
  String.raw`(?<![\w.])\d{1,5}\s+(?:[${UPPER}][${LOWER}]+\s+){1,4}(?:Street|Avenue|Road|Boulevard|Lane|Drive)\b`,
].map((s) => rx(py(s)));
const CONTRACT_AMOUNT = rx(py(
  String.raw`(?<![\w$])(?:R\$|US\$|U\$|€|£|(?:BRL|USD|EUR|GBP)\s)\s?(?:\d{1,3}(?:[.,]\d{3})+|\d+)(?:[.,]\d{1,2})?`
  + String.raw`(?:\s?(?:mil|milh(?:ão|ões|ao|oes)|k|K|mi|M|million|thousand)\b)?(?![\d.,]\d)`
  + String.raw`|(?<![\w$])\$\d{1,3}(?:,\d{3})+(?:\.\d{2})?(?![\d,])`
  + String.raw`|(?<![\w$])\$\d+(?:\.\d+)?[kK]\b`));
const CONTRACT_CUE = rx(py(ci(
  String.raw`\b(?:sal[aá]rios?|salar(?:y|ies)|remunera[çc][ãa]o|compensation|pretens[ãa]o|contratos?|contracts?|`
  + 'proposta|offer|b[ôo]nus|PLR|CLT|PJ|honor[áa]rios|day rate|hourly rate|por hora|per hour|valor/hora|'
  + String.raw`pacote|package|stock options?|equity)\b`)), 'u');
export const CONTRACT_WINDOW = 80;
const HEALTH_PATTERNS = [
  String.raw`\b` + ci('(?:CID|ICD)') + String.raw`(?:[\- ]?1[01])?[\s:.\-]*[A-Z]\d{2}(?:\.\d{1,2})?\b`,
].map((s) => rx(py(s)));
const COLLEAGUE_PATTERN = rx(py(ci(
  String.raw`\b(?:meu|minha|meus|minhas|nosso|nossa|my|our)\s+(?:ex-?)?(?:colegas?|gestora?|chefe|l[íi]der|`
  + 'diretora?|colleagues?|coworkers?|co-workers?|manager|boss|teammates?|team lead|tech lead|director)'
  + String.raw`(?:\s+(?:de\s+(?:time|equipe|trabalho)|at work))?\s+`)
  + String.raw`([${UPPER}][${LOWER}]+(?:\s+(?:d[aeo]s?\s+)?[${UPPER}][${LOWER}]+){0,3})`), 'gdu');

const CARD = rx(py(String.raw`(?<![\d\-])\d(?:[ \-]?\d){14,15}(?![\d\-])`));
const CPF = rx(py(String.raw`(?<![\d.])\d{3}\.\d{3}\.\d{3}-\d{2}(?![\d\-])`));
const CNPJ = rx(py(String.raw`(?<![\d.])\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}(?![\d\-])`));

// --------------------------------------------------------------------------- Python's digits, in Node

/** The code points of s, as numbers. @param {string} s */
const cps = (s) => Array.from(s, (c) => /** @type {number} */ (c.codePointAt(0)));

/**
 * The decimal value of a code point in re's \d (Nd). Unicode assigns Nd only in contiguous runs of ten
 * ascending from zero, so a maximal run starts at a zero and the value is the offset modulo ten.
 * @param {number} cp
 */
export function digitValue(cp) {
  let start = cp;
  while (inRanges(DIGIT, start - 1)) start--;
  return (cp - start) % 10;
}

/** Python's int() of a string of \d characters. @param {string} s */
const pyIntDigits = (s) => cps(s).reduce((n, cp) => n * 10 + digitValue(cp), 0);

/** re.sub(r"\D", "", s). @param {string} s */
const onlyDigits = (s) => Array.from(s).filter((c) => inRanges(DIGIT, /** @type {number} */ (c.codePointAt(0)))).join('');

/** @param {string} digits */
export function luhnOk(digits) {
  let total = 0;
  const all = cps(digits).reverse();
  for (let i = 0; i < all.length; i++) {
    let d = digitValue(all[i]);
    if (i % 2) d = d > 4 ? d * 2 - 9 : d * 2;
    total += d;
  }
  return total % 10 === 0;
}

/** @param {string} digits (no space or hyphen) */
function cardOk(digits) {
  const d = Array.from(digits);
  let prefixOk;
  if (d.length === 15) {
    prefixOk = ['34', '37'].includes(d.slice(0, 2).join(''));
  } else {
    const p2 = pyIntDigits(d.slice(0, 2).join(''));
    const p4 = pyIntDigits(d.slice(0, 4).join(''));
    prefixOk = d[0] === '4' || (p2 >= 51 && p2 <= 55) || (p4 >= 2221 && p4 <= 2720) || d.slice(0, 4).join('') === '6011' || p2 === 65;
  }
  return prefixOk && luhnOk(digits);
}

/** @param {string[]} digits @param {number[]} weights */
export function mod11Digit(digits, weights) {
  let s = 0;
  const n = Math.min(digits.length, weights.length);
  for (let i = 0; i < n; i++) s += digitValue(/** @type {number} */ (digits[i].codePointAt(0))) * weights[i];
  s %= 11;
  return s < 2 ? 0 : 11 - s;
}

/** @param {number} a @param {number} b (exclusive) */
const down = (a, b) => Array.from({ length: a - b }, (_, i) => a - i);

/** @param {string} value */
export function cpfOk(value) {
  const d = Array.from(value);
  if (d.length !== 11 || new Set(d).size === 1) return false;
  const d1 = mod11Digit(d.slice(0, 9), down(10, 1));
  const d2 = mod11Digit([...d.slice(0, 9), String(d1)], down(11, 1));
  return d.slice(9).join('') === String(d1) + String(d2);
}

/** @param {string} value */
export function cnpjOk(value) {
  const d = Array.from(value);
  if (d.length !== 14 || new Set(d).size === 1) return false;
  const w1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  const d1 = mod11Digit(d.slice(0, 12), w1);
  const d2 = mod11Digit([...d.slice(0, 12), String(d1)], [6, ...w1]);
  return d.slice(12).join('') === String(d1) + String(d2);
}

// -------------------------------------------------------------------- UTF-16 units <-> code points

/**
 * Offsets into text: JavaScript's matches are in UTF-16 units, Python's in code points.
 * @param {string} text
 */
export function offsets(text) {
  if (!/[\uD800-\uDFFF]/.test(text)) {
    return { toCp: (/** @type {number} */ u) => u, toUnit: (/** @type {number} */ c) => c, cpLength: text.length };
  }
  const unitToCp = new Int32Array(text.length + 1);
  /** @type {number[]} */
  const cpToUnit = [];
  let c = 0;
  let u = 0;
  while (u < text.length) {
    cpToUnit.push(u);
    const step = (/** @type {number} */ (text.codePointAt(u))) > 0xffff ? 2 : 1;
    unitToCp[u] = c;
    if (step === 2) unitToCp[u + 1] = c + 1;
    u += step;
    c += 1;
  }
  unitToCp[text.length] = c;
  cpToUnit.push(text.length);
  return { toCp: (/** @type {number} */ u) => unitToCp[u], toUnit: (/** @type {number} */ cp) => cpToUnit[cp], cpLength: c };
}

/**
 * @typedef {[number, number, string]} Span [start, end, category], code points
 */

/**
 * @param {string} text
 * @param {ReturnType<typeof offsets>} o
 * @param {number} start code point
 * @param {number} end code point
 * @param {number[]} newlines the UTF-16 index of every \n in text, ascending
 */
function contractCueNear(text, o, start, end, newlines) {
  // text.rfind("\n", 0, start) + 1 and text.find("\n", end), by binary search over the newlines found
  // once per text: a scan per amount is quadratic on a long line of amounts (measured: 25 s on 1 MB).
  const us = o.toUnit(start);
  const ue = o.toUnit(end);
  let lo = 0;
  let hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (newlines[mid] < us) lo = mid + 1;
    else hi = mid;
  }
  const lineStart = lo > 0 ? o.toCp(newlines[lo - 1] + 1) : 0;
  lo = 0;
  hi = newlines.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (newlines[mid] < ue) lo = mid + 1;
    else hi = mid;
  }
  const lineEnd = lo < newlines.length ? o.toCp(newlines[lo]) : o.cpLength;
  const a = Math.max(lineStart, start - CONTRACT_WINDOW);
  const b = Math.min(lineEnd, end + CONTRACT_WINDOW);
  return a < b && CONTRACT_CUE.test(text.slice(o.toUnit(a), o.toUnit(b)));
}

/**
 * Every match of re in text, as code point [start, end].
 * @param {RegExp} re
 * @param {string} text
 * @param {ReturnType<typeof offsets>} o
 * @param {number} [group]
 * @returns {Array<{ start: number, end: number, value: string }>}
 */
function finditer(re, text, o, group = 0) {
  const out = [];
  for (const m of text.matchAll(re)) {
    if (group) {
      const ix = /** @type {[number, number]} */ (/** @type {any} */ (m).indices[group]);
      out.push({ start: o.toCp(ix[0]), end: o.toCp(ix[1]), value: m[group] });
    } else {
      out.push({ start: o.toCp(m.index), end: o.toCp(m.index + m[0].length), value: m[0] });
    }
  }
  return out;
}

/** Python's str ordering for the ASCII names compared here. @param {string} a @param {string} b */
function byString(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** @param {Span} a @param {Span} b */
function byCategoryStartEndDesc(a, b) {
  if (a[2] !== b[2]) return a[2] < b[2] ? -1 : 1;
  if (a[0] !== b[0]) return a[0] - b[0];
  return b[1] - a[1];
}

/**
 * The five pattern categories of Issue #36, overlapping findings of one category merged.
 * @param {string} text
 * @param {ReturnType<typeof offsets>} [o]
 * @returns {Span[]}
 */
export function patternSpans(text, o = offsets(text)) {
  /** @type {Span[]} */
  const spans = [];
  for (const re of PHONE_PATTERNS) {
    for (const m of finditer(re, text, o)) {
      const n = Array.from(onlyDigits(m.value)).length;
      if (n >= PHONE_DIGITS[0] && n <= PHONE_DIGITS[1]) spans.push([m.start, m.end, 'phone']);
    }
  }
  for (const re of ADDRESS_PATTERNS) for (const m of finditer(re, text, o)) spans.push([m.start, m.end, 'postal-address']);
  /** @type {number[]} */
  const newlines = [];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) newlines.push(i);
  for (const m of finditer(CONTRACT_AMOUNT, text, o)) {
    if (contractCueNear(text, o, m.start, m.end, newlines)) spans.push([m.start, m.end, 'contract-value']);
  }
  for (const re of HEALTH_PATTERNS) for (const m of finditer(re, text, o)) spans.push([m.start, m.end, 'health']);
  for (const m of finditer(COLLEAGUE_PATTERN, text, o, 1)) spans.push([m.start, m.end, 'colleague-name']);
  return mergeSameCategory(spans);
}

/**
 * pattern_spans()'s merge: findings of one category that OVERLAP become one (start < previous end);
 * findings that only touch stay two, as in Python.
 * @param {Span[]} spans
 * @returns {Span[]}
 */
export function mergeSameCategory(spans) {
  /** @type {Span[]} */
  const merged = [];
  for (const s of [...spans].sort(byCategoryStartEndDesc)) {
    const last = merged.at(-1);
    if (last?.[2] === s[2] && s[0] < last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1], s[2]]);
  }
  return merged;
}

// ---------------------------------------------------------------------------------- normalisation

/** @type {Map<number, number[]> | null} */
let foldMap = null;
function casefoldMap() {
  if (!foldMap) {
    foldMap = new Map();
    for (let i = 0; i < CASEFOLD.length;) {
      const n = CASEFOLD[i + 1];
      foldMap.set(CASEFOLD[i], CASEFOLD.slice(i + 2, i + 2 + n));
      i += 2 + n;
    }
  }
  return foldMap;
}

/** Python's str.casefold(). @param {string} s */
export function casefold(s) {
  const m = casefoldMap();
  let out = '';
  for (const c of s) {
    const to = m.get(/** @type {number} */ (c.codePointAt(0)));
    out += to ? String.fromCodePoint(...to) : c;
  }
  return out;
}

const TOKEN = rx('[' + classBody(LETTER_OR_NUMBER) + '][' + classBody(LETTER_OR_NUMBER) + classBody(MARK) + ']*');

/** NFKD, case folded, only letters and digits kept (clipboard_guard.py _normalise_word). @param {string} word */
function normaliseWord(word) {
  let out = '';
  for (const c of casefold(word.normalize('NFKD'))) {
    if (inRanges(LETTER_OR_NUMBER, /** @type {number} */ (c.codePointAt(0)))) out += c;
  }
  return out;
}

/**
 * [start, end, normalised] per word: a run of letters, digits and combining marks that starts with a
 * letter or a digit. Code points.
 * @param {string} text
 * @param {ReturnType<typeof offsets>} [o]
 * @returns {Array<[number, number, string]>}
 */
export function tokens(text, o = offsets(text)) {
  /** @type {Array<[number, number, string]>} */
  const out = [];
  for (const m of finditer(TOKEN, text, o)) {
    const norm = normaliseWord(m.value);
    if (norm) out.push([m.start, m.end, norm]);
  }
  return out;
}

/** The normalised forms stored for one term. @param {string} term */
export function termForms(term) {
  const words = tokens(term).map((t) => t[2]);
  if (!words.length) return [];
  const forms = [words.join(' ')];
  if (words.length > 1) forms.push(words.join(''));
  return forms;
}

/** HMAC-SHA256(bytes.fromhex(salt), form). @param {string} salt @param {string} form */
export function termHash(salt, form) {
  return crypto.createHmac('sha256', Buffer.from(salt, 'hex')).update(form, 'utf8').digest('hex');
}

// --------------------------------------------------------------------------------------- findSpans

/**
 * [start, end, category] for every finding, in clipboard_guard.find_spans()'s own order. termHashes is
 * the employer and client list; termLists maps "health" and "colleague-name" to the owner's private
 * lists, matched like the employer list with the same salt. Never returns the matched text.
 * @param {string} text
 * @param {Set<string>} [termHashes]
 * @param {string | null} [salt]
 * @param {Record<string, Set<string>>} [termLists]
 * @returns {Span[]}
 */
export function findSpans(text, termHashes = new Set(), salt = null, termLists = {}) {
  const o = offsets(text);
  const spans = patternSpans(text, o);
  for (const re of CREDENTIAL_PATTERNS) for (const m of finditer(re, text, o)) spans.push([m.start, m.end, 'credential']);
  for (const m of text.matchAll(EMAIL)) {
    const ix = /** @type {any} */ (m).indices;
    if (!EMAIL_SKIP_LOCAL.has(m[1].toLowerCase()) && !EMAIL_SKIP_DOMAIN.test(m[2])) {
      spans.push([o.toCp(ix[0][0]), o.toCp(ix[0][1]), 'email']);
    }
  }
  for (const m of finditer(CARD, text, o)) if (cardOk(m.value.replaceAll(/[ -]/g, ''))) spans.push([m.start, m.end, 'payment-card']);
  for (const m of finditer(CPF, text, o)) if (cpfOk(onlyDigits(m.value))) spans.push([m.start, m.end, 'cpf']);
  for (const m of finditer(CNPJ, text, o)) if (cnpjOk(onlyDigits(m.value))) spans.push([m.start, m.end, 'cnpj']);
  /** @type {Array<[string, Set<string>]>} */
  const lists = [/** @type {[string, Set<string>]} */ (['employer-client-term', termHashes]),
    ...Object.entries(termLists).sort((a, b) => byString(a[0], b[0]))]
    .filter((e) => e[1]?.size);
  if (lists.length && salt) {
    const words = tokens(text, o);
    /** @type {Map<string, string>} */
    const memo = new Map();
    const digest = (/** @type {string} */ f) => {
      let h = memo.get(f);
      if (h === undefined) {
        h = termHash(salt, f);
        memo.set(f, h);
      }
      return h;
    };
    for (let i = 0; i < words.length; i++) {
      for (let n = 1; n <= Math.min(MAX_TERM_TOKENS, words.length - i); n++) {
        const group = words.slice(i, i + n).map((w) => w[2]);
        const digests = new Set([digest(group.join(' ')), digest(group.join(''))]);
        for (const [cat, hashes] of lists) {
          if ([...digests].some((d) => hashes.has(d))) spans.push([words[i][0], words[i + n - 1][1], cat]);
        }
      }
    }
  }
  return spans;
}

/** The categories present, in CATEGORY_ORDER. @param {Span[]} spans */
export function categories(spans) {
  const found = new Set(spans.map((s) => s[2]));
  return CATEGORY_ORDER.filter((c) => found.has(c));
}

/** @param {Span} a @param {Span} b */
function byStartEndCategory(a, b) {
  if (a[0] !== b[0]) return a[0] - b[0];
  if (a[1] !== b[1]) return a[1] - b[1];
  return byString(a[2], b[2]);
}

/**
 * Every finding replaced with [REDACTED:<category>]; overlapping findings merge into one, labelled by
 * the earliest-starting one. Not reversible: no mapping is kept anywhere.
 * @param {string} text
 * @param {Span[]} spans
 */
export function sanitise(text, spans) {
  const o = offsets(text);
  /** @type {Span[]} */
  const merged = [];
  for (const s of [...spans].sort(byStartEndCategory)) {
    const last = merged.at(-1);
    if (last && s[0] < last[1]) last[1] = Math.max(last[1], s[1]);
    else merged.push([s[0], s[1], s[2]]);
  }
  let out = '';
  let pos = 0;
  for (const [start, end, cat] of merged) {
    out += text.slice(o.toUnit(Math.min(pos, o.cpLength)), o.toUnit(Math.min(Math.max(start, pos), o.cpLength))) + '[REDACTED:' + cat + ']';
    pos = end;
  }
  return out + text.slice(o.toUnit(Math.min(pos, o.cpLength)));
}

// ------------------------------------------------------------------------------- config and files

/** Python's str.isspace() members (src/lib/py.js has the same set; this file stays node:-only). */
const PY_SPACE = new Set([0x9, 0xa, 0xb, 0xc, 0xd, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001,
  0x2002, 0x2003, 0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000]);

/** Python's str.strip(). @param {string} s */
export function strip(s) {
  const a = Array.from(s);
  let i = 0;
  let j = a.length;
  while (i < j && PY_SPACE.has(/** @type {number} */ (a[i].codePointAt(0)))) i++;
  while (j > i && PY_SPACE.has(/** @type {number} */ (a[j - 1].codePointAt(0)))) j--;
  return a.slice(i, j).join('');
}

/** A Python exception, by its class name only (an error is never reported by its message). */
export class PyError extends Error {
  /** @param {string} pyClass */
  constructor(pyClass) {
    super(pyClass);
    this.pyClass = pyClass;
  }
}

/** The Python class an OSError of this Node code would be. @param {unknown} e */
export function osErrorClass(e) {
  const code = e && typeof e === 'object' && 'code' in e ? String(/** @type {any} */ (e).code) : '';
  return /** @type {Record<string, string>} */ ({
    ENOENT: 'FileNotFoundError', EACCES: 'PermissionError', EPERM: 'PermissionError', EISDIR: 'IsADirectoryError',
    ENOTDIR: 'NotADirectoryError', EEXIST: 'FileExistsError',
  })[code] || 'OSError';
}

/**
 * Text as Python's open(..., encoding=enc) reads it with universal newlines: \r\n and \r become \n.
 * A decoding error is UnicodeDecodeError; a byte-order mark is kept as U+FEFF, as the utf-8 codec keeps it.
 * @param {string} file
 * @param {'utf-8' | 'ascii'} enc
 */
export function readTextPy(file, enc) {
  const raw = fs.readFileSync(file);
  if (enc === 'ascii' && raw.some((b) => b > 0x7f)) throw new PyError('UnicodeDecodeError');
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new PyError('UnicodeDecodeError');
  }
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/** Python's os.path.expanduser("~"), from the environment. @param {Record<string, string | undefined>} env @param {string} platform */
function home(env, platform) {
  if (platform === 'win32') return env.USERPROFILE || os.homedir();
  return env.HOME !== undefined ? env.HOME : os.homedir();
}

/** @param {Record<string, string | undefined>} env @param {string} [platform] */
export function dataDir(env, platform = process.platform) {
  const base = env.XDG_DATA_HOME || path.join(home(env, platform), '.local', 'share');
  return path.join(base, PROJECT);
}

/** @param {Record<string, string | undefined>} env @param {string} [platform] */
export function localOverlayDir(env, platform = process.platform) {
  return path.join(dataDir(env, platform), 'local-overlay');
}

/** str.isdigit() of a non-empty string. @param {string} s */
const isDigitStr = (s) => s.length > 0 && cps(s).every((cp) => inRanges(ISDIGIT, cp));

/**
 * Python's int() of a str.isdigit() string: the decimal digits read, anything else (a superscript, a
 * circled digit) raises ValueError.
 * @param {string} s
 */
export function pyInt(s) {
  const all = cps(s);
  if (!all.every((cp) => inRanges(DIGIT, cp))) throw new PyError('ValueError');
  return all.reduce((n, cp) => n * 10 + digitValue(cp), 0);
}

/**
 * clipboard_guard.load_config(): key=value per line, '#' comments, last value wins; an invalid value falls
 * back to its default. Throws PyError with the class Python raised (an unreadable or undecodable file,
 * a keychain_path that is not absolute).
 * @param {string | null | undefined} file
 * @param {{ env?: Record<string, string | undefined>, platform?: string, defaults?: Readonly<Record<string, string>> }} [opts]
 *   defaults: the keys this reader knows and their values (the prompt hook adds its notices, #488)
 * @returns {Record<string, string>}
 */
export function loadConfig(file, opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const defaults = opts.defaults || DEFAULTS;
  /** @type {Record<string, string>} */
  const conf = { ...defaults };
  if (file && fs.existsSync(file)) {
    let text;
    try {
      text = readTextPy(file, 'utf-8');
    } catch (e) {
      throw e instanceof PyError ? e : new PyError(osErrorClass(e));
    }
    const lines = text.split('\n');
    if (lines.at(-1) === '') lines.pop();
    for (const line of lines) {
      if (!strip(line) || strip(line).startsWith('#') || !line.includes('=')) continue;
      const eq = line.indexOf('=');
      const key = strip(line.slice(0, eq));
      const value = line.slice(eq + 1);
      if (Object.hasOwn(defaults, key)) conf[key] = key.startsWith('notice_') ? value : strip(value);
    }
  }
  for (const key of ['max_bytes', 'show_cleaned_chars']) {
    if (!isDigitStr(conf[key]) || pyInt(conf[key]) < 1) conf[key] = DEFAULTS[key];
  }
  const wanted = conf.block_categories.split(',').map(strip).filter(Boolean);
  if (!wanted.length || wanted.some((c) => !CATEGORY_ORDER.includes(c))) conf.block_categories = DEFAULTS.block_categories;
  const report = conf.report_categories.split(',').map(strip).filter(Boolean);
  if (report.some((c) => !CATEGORY_ORDER.includes(c))) conf.report_categories = DEFAULTS.report_categories;
  if (conf.salt_store !== 'keychain' && conf.salt_store !== 'file') conf.salt_store = platform === 'darwin' ? 'keychain' : 'file';
  const overlay = localOverlayDir(env, platform);
  if (!conf.terms_file) conf.terms_file = path.join(overlay, 'clipboard-terms');
  if (!conf.salt_file) conf.salt_file = path.join(overlay, 'clipboard-salt');
  for (const [cat, key] of Object.entries(TERM_LISTS)) {
    if (!conf[key]) conf[key] = path.join(overlay, LIST_FILES[/** @type {keyof typeof LIST_FILES} */ (cat)]);
  }
  const kc = conf.keychain_path;
  if (kc && (!path.isAbsolute(kc) || /["\\\n\r]/.test(kc))) throw new PyError('ValueError');
  return conf;
}

const HASH_LINE = /^[0-9a-f]{64}$/;

/**
 * The salted hashes in a term list file. An unreadable file is an empty list, as in Python; a file that
 * is not ASCII is too (Python raised UnicodeDecodeError there; see test/golden/S15/expected-differences.json).
 * @param {string} file
 * @returns {Set<string>}
 */
export function readTerms(file) {
  let text;
  try {
    text = readTextPy(file, 'ascii');
  } catch {
    return new Set();
  }
  return new Set(text.split('\n').map(strip).filter((l) => HASH_LINE.test(l)));
}

/**
 * (employer and client hashes, {category: hashes} for the private health and colleague lists).
 * @param {Record<string, string>} conf
 * @returns {[Set<string>, Record<string, Set<string>>]}
 */
export function readTermLists(conf) {
  /** @type {Record<string, Set<string>>} */
  const lists = {};
  for (const [cat, key] of Object.entries(TERM_LISTS)) lists[cat] = readTerms(conf[key]);
  return [readTerms(conf.terms_file), lists];
}

/**
 * The salt in a file store, or null (absent, unreadable, or not 64 lowercase hex digits).
 * @param {string} file
 */
export function fileSalt(file) {
  let value;
  try {
    value = strip(readTextPy(file, 'ascii'));
  } catch {
    return null;
  }
  return /^[0-9a-f]{64}$/.test(value) ? value : null;
}

/** @param {Record<string, string>} conf */
export function blockingSet(conf) {
  return new Set(conf.block_categories.split(',').map(strip).filter(Boolean));
}

/** Named but never blocked or rewritten. @param {Record<string, string>} conf */
export function reportOnlySet(conf) {
  const block = blockingSet(conf);
  return new Set(conf.report_categories.split(',').map(strip).filter((c) => c && !block.has(c)));
}

/**
 * Python's str.format for the notice templates: {name} and the {{ }} escapes. Anything else (a format
 * spec, a conversion, a positional field, a name not given) throws, as the Python call raised.
 * @param {string} template
 * @param {Record<string, string | number>} values
 */
export function pyFormat(template, values) {
  let out = '';
  let i = 0;
  while (i < template.length) {
    const c = template[i];
    if (c === '{' && template[i + 1] === '{') {
      out += '{';
      i += 2;
    } else if (c === '}' && template[i + 1] === '}') {
      out += '}';
      i += 2;
    } else if (c === '{') {
      const end = template.indexOf('}', i);
      if (end < 0) throw new Error('ValueError');
      const name = template.slice(i + 1, end);
      if (!/^[A-Za-z_]\w*$/.test(name) || !Object.hasOwn(values, name)) throw new Error('KeyError');
      out += String(values[name]);
      i = end + 1;
    } else if (c === '}') {
      throw new Error('ValueError');
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}
