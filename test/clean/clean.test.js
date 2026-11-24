// S15 parity (#486, convention 3 of #470): src/lib/clean.js against global/clipboard/clipboard_guard.py's
// detection and redaction core, on the shared corpus (test/clean/corpus.js).
//   golden: every case's find_spans() (category, offset and length in code points, in Python's own
//           order), sanitise(), categories() and tokens(), recorded from CPython 3.14.6 into
//           test/golden/S15/corpus.json, against clean.js in this process. Every OS.
//   live:   python3 at the recorded version answers the same corpus beside clean.js, through
//           test/helpers/s15-record.py and the clipboard_guard.py of this tree (it stays in this slice).
//           MHW_S15_LIVE_REQUIRED=1 (CI) turns a missing or other python3 into a failure.
//           MHW_UPDATE_GOLDEN=1 rewrites the golden from the Python side, never from the Node side.
// #589: the term lists and their salt are removed, so findSpans() takes the text alone. A corpus case that
// carries terms (it was matched against a hashed list) is compared on its tokens and on its spans less the
// term-list ones: every span clean.js finds is a recorded one, and every recorded span it no longer finds is
// in a term category (test/golden/S15/expected-differences.json, the #589 entry).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as clean from '../../src/lib/clean.js';
import { CASES, SALT } from './corpus.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { CPYTHON, RECORDER, clipboardDir, recordedPython } from '../helpers/s15.js';

const SLICE = 'S15';
const LIVE_REQUIRED = process.env.MHW_S15_LIVE_REQUIRED === '1';

/** @typedef {{ name: string, text_sha256: string, spans: Array<[string, number, number]>, sanitised: string, categories: string[], tokens: Array<[number, number, string]> }} Answer */

/** The categories a term list could produce (#589: no longer produced from a list). */
const TERM_CATEGORIES = new Set(['employer-client-term', 'health', 'colleague-name']);

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
  const spans = clean.findSpans(c.text);
  return {
    name: c.name,
    text_sha256: crypto.createHash('sha256').update(c.text, 'utf8').digest('hex'),
    spans: spans.map(([s, e, cat]) => /** @type {[string, number, number]} */ ([cat, s, e - s])),
    sanitised: clean.sanitise(c.text, spans),
    categories: clean.categories(spans),
    tokens: digestTokens(clean.tokens(c.text)),
  };
}

/** @param {string} py @param {string} dir the directory holding clipboard_guard.py @returns {Answer[]} */
function pythonAnswers(py, dir) {
  const p = spawnSync(py, ['-B', RECORDER, 'corpus', dir], { input: JSON.stringify(CASES), encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout).cases.map((/** @type {Answer} */ a) => ({ ...a, tokens: digestTokens(a.tokens) }));
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
    if (c.terms) {
      for (const key of /** @type {const} */ (['text_sha256', 'tokens'])) {
        if (JSON.stringify(g[key]) !== JSON.stringify(w[key])) diffs.push(c.name + ' ' + key + ': python ' + JSON.stringify(w[key]) + ' node ' + JSON.stringify(g[key]));
      }
      const recorded = new Set(w.spans.map((x) => JSON.stringify(x)));
      const found = new Set(g.spans.map((x) => JSON.stringify(x)));
      for (const x of found) if (!recorded.has(x)) diffs.push(c.name + ' spans: node found ' + x + ', python did not');
      for (const x of recorded) if (!found.has(x) && !TERM_CATEGORIES.has(JSON.parse(x)[0])) diffs.push(c.name + ' spans: node lost ' + x + ', not a term category');
      continue;
    }
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

test('the corpus holds a known-present hit for every category but the term one, and Unicode, case and boundary edges', () => {
  /** @type {Record<string, number>} */
  const hits = Object.fromEntries(clean.CATEGORY_ORDER.map((c) => [c, 0]));
  for (const a of /** @type {Answer[]} */ (readGolden(SLICE, 'corpus.json').cases)) for (const [cat] of a.spans) hits[cat] += 1;
  for (const cat of clean.CATEGORY_ORDER) assert.ok(hits[cat] >= 1, cat + ' has no known-present hit');
  // #589: the recorded hits above include the term lists'; clean.js's own answers must still hit every
  // pattern category, and never employer-client-term, whose only producer was a list.
  /** @type {Record<string, number>} */
  const now = Object.fromEntries(clean.CATEGORY_ORDER.map((c) => [c, 0]));
  for (const c of CASES) for (const [cat] of nodeAnswer(c).spans) now[cat] += 1;
  for (const cat of clean.CATEGORY_ORDER) {
    if (cat === 'employer-client-term') assert.equal(now[cat], 0, 'employer-client-term is found without a term list');
    else assert.ok(now[cat] >= 1, cat + ' has no known-present hit in clean.js');
  }
  for (const prefix of ['unicode/', 'ignore-case/', 'offsets/', 'term/']) assert.ok(CASES.some((c) => c.name.startsWith(prefix)), prefix);
});

test('live: the recorded CPython answers the corpus as clean.js does', (t) => {
  const p = recordedPython();
  if (!p.py) {
    if (LIVE_REQUIRED) assert.fail('MHW_S15_LIVE_REQUIRED=1: ' + p.why);
    t.skip(p.why);
    return;
  }
  // clipboard_guard.py was deleted by #488 (S17): the base revision's copy while the base still holds it.
  const d = clipboardDir('clipboard_guard.py', LIVE_REQUIRED);
  if (!d.dir) {
    if (d.fail) assert.fail('MHW_S15_LIVE_REQUIRED=1: ' + d.why);
    t.skip(d.why);
    return;
  }
  const answers = pythonAnswers(p.py, d.dir);
  if (UPDATE) writeGolden(SLICE, 'corpus.json', { cpython: CPYTHON, salt: SALT, cases: answers });
  assert.deepEqual(compare(answers, nodeAnswer), []);
});

// Unit tests of what the corpus does not reach through findSpans.
test('#589: no term list, no salt and no term hashing: findSpans() takes the text alone', () => {
  for (const name of ['termHash', 'termForms', 'readTerms', 'readTermsStrict', 'readTermLists', 'fileSalt', 'fileSaltStrict',
    'TERMS_HEADER', 'TERM_LISTS', 'LIST_FILES']) assert.equal(Object.hasOwn(clean, name), false, name + ' is still exported');
  assert.equal(clean.findSpans.length, 1);
  for (const key of ['terms_file', 'health_terms_file', 'colleague_terms_file', 'salt_file', 'salt_store']) {
    assert.equal(Object.hasOwn(clean.DEFAULTS, key), false, key + ' is still a setting');
  }
  const conf = clean.loadConfig(null, { env: { HOME: '/nonexistent' }, platform: 'linux' });
  for (const key of ['terms_file', 'salt_file']) assert.equal(conf[key], undefined, key + ' is still derived');
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
  const { scanText } = await import('../../.github/scripts/outbound-scan.js');
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
