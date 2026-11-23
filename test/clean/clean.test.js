// S15 parity (#486, convention 3 of #470): src/lib/clean.js against global/clipboard/clipboard_guard.py's
// detection and redaction core, on the shared corpus (test/clean/corpus.js).
//   golden: every case's find_spans() (category, offset and length in code points, in Python's own
//           order), sanitise(), categories() and tokens(), recorded from CPython 3.14.6 into
//           test/golden/S15/corpus.json, against clean.js in this process. Every OS.
//   The golden is frozen: its recorder (test/helpers/s15-record.py) and the live arm that re-ran it
//           were deleted by #502 (S32 of #470, one Node runtime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as clean from '../../src/lib/clean.js';
import { CASES, SALT } from './corpus.js';
import { CPYTHON } from '../helpers/s15.js';
import { readGolden, UPDATE } from '../helpers/golden.js';

const SLICE = 'S15';

/** @typedef {{ name: string, text_sha256: string, spans: Array<[string, number, number]>, sanitised: string, categories: string[], tokens: Array<[number, number, string]> }} Answer */

/** @param {import('./corpus.js').Case} c */
function hashes(c) {
  /** @param {string[] | undefined} words */
  const set = (words) => new Set((c.salt ? words || [] : []).flatMap((w) => clean.termForms(w).map((f) => clean.termHash(/** @type {string} */ (c.salt), f))));
  const t = c.terms || {};
  /** @type {Record<string, Set<string>>} */
  const lists = c.salt ? { health: set(t.health), 'colleague-name': set(t.colleague) } : {};
  return { employer: set(t.employer), lists };
}

/**
 * Each normalised word as the first 16 hex digits of its sha256: equality is still exact, and a
 * normalised card or key number of the corpus never sits in the golden in plain text, where mhw scan
 * would report it.
 * @param {Array<[number, number, string]>} tokens
 * @returns {Array<[number, number, string]>}
 */
const digestTokens = (tokens) => tokens.map(([s, e, n]) => [s, e, crypto.createHash('sha256').update(n, 'utf8').digest('hex').slice(0, 16)]);

/** clean.js's answer for one case. @param {import('./corpus.js').Case} c @returns {Answer} */
export function nodeAnswer(c) {
  const h = hashes(c);
  const spans = clean.findSpans(c.text, h.employer, c.salt || null, h.lists);
  return {
    name: c.name,
    text_sha256: crypto.createHash('sha256').update(c.text, 'utf8').digest('hex'),
    spans: spans.map(([s, e, cat]) => /** @type {[string, number, number]} */ ([cat, s, e - s])),
    sanitised: clean.sanitise(c.text, spans),
    categories: clean.categories(spans),
    tokens: digestTokens(clean.tokens(c.text)),
  };
}

/** @param {Answer[]} want @param {(c: import('./corpus.js').Case) => Answer} got */
function compare(want, got) {
  const byName = new Map(want.map((a) => [a.name, a]));
  const diffs = [];
  for (const c of CASES) {
    const w = byName.get(c.name);
    if (!w) {
      diffs.push(c.name + ': no recorded answer');
      continue;
    }
    const g = got(c);
    for (const key of /** @type {const} */ (['text_sha256', 'spans', 'sanitised', 'categories', 'tokens'])) {
      if (JSON.stringify(g[key]) !== JSON.stringify(w[key])) diffs.push(c.name + ' ' + key + ': python ' + JSON.stringify(w[key]) + ' node ' + JSON.stringify(g[key]));
    }
  }
  return diffs;
}

test('every corpus case has a unique name and a recorded answer, and every answer a case', () => {
  const names = CASES.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  const golden = /** @type {Answer[]} */ (readGolden(SLICE, 'corpus.json').cases);
  assert.deepEqual(golden.map((a) => a.name).sort(), [...names].sort());
});

test('golden: clean.js answers the corpus as the Python original did', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, () => {
  const golden = readGolden(SLICE, 'corpus.json');
  assert.equal(golden.cpython, CPYTHON);
  assert.deepEqual(compare(golden.cases, nodeAnswer), []);
});

test('the corpus holds a known-present hit for every category, and Unicode, case and boundary edges', () => {
  /** @type {Record<string, number>} */
  const hits = Object.fromEntries(clean.CATEGORY_ORDER.map((c) => [c, 0]));
  for (const a of /** @type {Answer[]} */ (readGolden(SLICE, 'corpus.json').cases)) for (const [cat] of a.spans) hits[cat] += 1;
  for (const cat of clean.CATEGORY_ORDER) assert.ok(hits[cat] >= 1, cat + ' has no known-present hit');
  for (const prefix of ['unicode/', 'ignore-case/', 'offsets/', 'term/']) assert.ok(CASES.some((c) => c.name.startsWith(prefix)), prefix);
});

// Unit tests of what the corpus does not reach through findSpans.
test('the term hash depends on the salt and is never the plaintext; no salt, no term match', () => {
  const a = clean.termHash(SALT, 'zyxw quillon synthetic');
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, clean.termHash('6b'.repeat(32), 'zyxw quillon synthetic'));
  const set = new Set(clean.termForms('Zyxw Quillon Synthetic').map((f) => clean.termHash(SALT, f)));
  assert.deepEqual(clean.findSpans('Zyxw Quillon Synthetic', set, null), []);
  assert.deepEqual(clean.termForms('!!!'), []);
  assert.deepEqual(clean.termForms('Zyxw'), ['zyxw']);
});

test('ci() refuses a letter it has no recorded set for, so a pattern never turns case-sensitive silently', () => {
  assert.throws(() => clean.ci('Ω'), /no recorded ignore-case set/);
  assert.equal(new RegExp('^' + clean.ci('k') + '$', 'u').test('K'), true);
  assert.equal(new RegExp('^' + clean.ci('[íi]') + '$', 'u').test('İ'), true);
  assert.equal(new RegExp('^' + clean.ci('a{2}') + '$', 'u').test('aA'), true);
});

test('ci() refuses a range inside a class, at load, rather than match less', () => {
  for (const src of ['[a-c]', 'x[a-c]y', '[^a-c]', '[aá-c]']) assert.throws(() => clean.ci(src), /a range in a class is not supported/, src);
  // A hyphen first, last, after the negation, or escaped is a literal, and the letters still expand.
  for (const [src, yes, no] of /** @type {Array<[string, string, string]>} */ ([['[-a]', '-', 'b'], ['[a-]', 'A', 'b'], ['[^-a]', 'b', 'A'], [String.raw`[a\-c]`, 'C', 'b']])) {
    const re = new RegExp('^' + clean.ci(src) + '$', 'u');
    assert.ok(re.test(yes), src + ' accepts ' + yes);
    assert.ok(!re.test(no), src + ' refuses ' + no);
  }
});

test('py() keeps escapes it does not translate, and translates \\w \\d \\s inside a class', () => {
  assert.equal(clean.py(String.raw`\.\$`), String.raw`\.\$`);
  assert.ok(new RegExp('^[' + clean.py(String.raw`\d`).slice(1, -1) + ']$', 'u').test('٣'));
  assert.ok(new RegExp('^' + clean.py(String.raw`[\s]`) + '$', 'u').test('\u0085'));
  assert.ok(!new RegExp('^' + clean.py(String.raw`[\s]`) + '$', 'u').test('﻿'));
  assert.ok(new RegExp(clean.py(String.raw`x\Z`), 'u').test('ax'));
});

test('Python digits: values, int(), Luhn, check digits', () => {
  assert.equal(clean.digitValue(0x663), 3);
  assert.equal(clean.digitValue(0x1d7d8), 0); // the second run of the mathematical digits
  assert.equal(clean.pyInt('١٢'), 12);
  assert.throws(() => clean.pyInt('²'), (e) => e instanceof clean.PyError && e.pyClass === 'ValueError');
  assert.equal(clean.cpfOk('11111111111'), false);
  assert.equal(clean.cnpjOk('123'), false);
  assert.equal(clean.cpfOk('123'), false);
});

test('a line of a megabyte of amounts is not quadratic (the Python original took 16 s on it)', () => {
  const text = 'R$ 1.000,00 '.repeat(83334).slice(0, 1000000);
  const t = performance.now();
  assert.deepEqual(clean.findSpans(text), []);
  assert.ok(performance.now() - t < 10000, 'took ' + Math.round(performance.now() - t) + ' ms');
});

test('the merges join overlapping findings only; touching ones stay apart, as Python\'s `start < end` does', () => {
  // pattern_spans(): one category, overlap merged, touch kept, another category never merged.
  assert.deepEqual(clean.mergeSameCategory([[0, 5, 'phone'], [4, 9, 'phone'], [9, 12, 'phone'], [10, 11, 'health']]),
    [[10, 11, 'health'], [0, 9, 'phone'], [9, 12, 'phone']]);
  // sanitise(): any categories, overlap merged under the earliest label, touch kept as two markers.
  assert.equal(clean.sanitise('abcdefghij', [[0, 3, 'email'], [3, 5, 'cpf'], [4, 7, 'phone']]), '[REDACTED:email][REDACTED:cpf]hij');
});

test('scanText reports exactly findSpans\' categories and lengths (scan_test.py ScanText, both tests)', async () => {
  const { scanText } = await import('../../src/commands/scan.js');
  const { AWS, EMAIL, CPF } = await import('../scan/cases.js');
  // test_returns_positions_never_text
  const found = scanText('x\n\ny ' + AWS + '\n');
  assert.deepEqual(found, [[3, 'credential', AWS.length]]);
  for (const part of found.flat()) assert.ok(!String(part).includes(AWS));
  // test_reuses_the_paste_filter_engine
  const text = EMAIL + ' ' + CPF;
  const want = clean.findSpans(text).map(([s, e, c]) => [e - s, c]).sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[1]).localeCompare(String(b[1])));
  const got = scanText(text).map(([, c, n]) => [n, c]).sort((a, b) => Number(a[0]) - Number(b[0]) || String(a[1]).localeCompare(String(b[1])));
  assert.deepEqual(got, want);
  assert.ok(want.length);
});

test('blocking and report-only sets, as clipboard_guard.py computes them', () => {
  const conf = clean.loadConfig(null, { env: { HOME: '/nonexistent-home' }, platform: 'linux' });
  assert.deepEqual([...clean.blockingSet(conf)].sort(), clean.CATEGORY_ORDER.filter((c) => c !== 'postal-address' && c !== 'contract-value').sort());
  assert.deepEqual([...clean.reportOnlySet(conf)].sort(), ['contract-value', 'postal-address']);
  assert.equal(clean.sanitise('abc', [[0, 1, 'email'], [0, 1, 'cpf']]), '[REDACTED:cpf]bc');
});
