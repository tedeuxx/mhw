// S15 (#486): the character sets and mappings src/lib/clean-unicode.js pins, held against CPython.
//   always: Node's NFKD equals CPython's on every letter, number and mark (the only characters tokens()
//           normalises), by the digest recorded from CPython; the tables are sorted, disjoint ranges.
//   live:   the recorded CPython re-records every table (about two minutes) and the module must equal
//           it. MHW_S15_LIVE_REQUIRED=1 (CI) runs it and turns a missing or other python3 into a
//           failure; elsewhere it runs only with MHW_S15_LIVE_UNICODE=1.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as U from '../../src/lib/clean-unicode.js';
import { inRanges } from '../../src/lib/clean.js';
import { recordedPython, RECORDER, CLIPBOARD } from '../helpers/s15.js';

const LIVE_REQUIRED = process.env.MHW_S15_LIVE_REQUIRED === '1';
const RANGES = /** @type {const} */ ({ word: 'WORD', digit: 'DIGIT', space: 'SPACE', isdigit: 'ISDIGIT', letterOrNumber: 'LETTER_OR_NUMBER', mark: 'MARK' });

test('every range table is sorted, disjoint and outside the surrogates', () => {
  for (const name of Object.values(RANGES)) {
    const r = /** @type {number[]} */ (U[name]);
    assert.equal(r.length % 2, 0, name);
    for (let i = 0; i < r.length; i += 2) {
      assert.ok(r[i] <= r[i + 1], name);
      if (i) assert.ok(r[i] > r[i - 1] + 1, name + ' not merged at ' + i);
      assert.ok(r[i + 1] < 0xd800 || r[i] > 0xdfff, name + ' holds a surrogate');
    }
  }
});

test('Node\'s NFKD equals CPython\'s on every character tokens() normalises', () => {
  const h = crypto.createHash('sha256');
  for (let cp = 0; cp < 0x110000; cp++) {
    if (cp >= 0xd800 && cp < 0xe000) continue;
    if (inRanges(U.LETTER_OR_NUMBER, cp) || inRanges(U.MARK, cp)) h.update(cp.toString(16) + ':' + String.fromCodePoint(cp).normalize('NFKD') + '\n');
  }
  assert.equal(h.digest('hex'), U.NFKD_WORD_SHA256);
});

test('live: the recorded CPython re-records the tables the module pins', (t) => {
  if (!LIVE_REQUIRED && process.env.MHW_S15_LIVE_UNICODE !== '1') {
    t.skip('about two minutes; set MHW_S15_LIVE_UNICODE=1 (CI sets MHW_S15_LIVE_REQUIRED=1)');
    return;
  }
  const p = recordedPython();
  if (!p.py) {
    if (LIVE_REQUIRED) assert.fail('MHW_S15_LIVE_REQUIRED=1: ' + p.why);
    t.skip(p.why);
    return;
  }
  const r = spawnSync(p.py, ['-B', RECORDER, 'unicode', CLIPBOARD], { encoding: 'utf8', maxBuffer: 64 << 20 });
  assert.equal(r.status, 0, r.stderr);
  const d = JSON.parse(r.stdout);
  assert.equal(d.cpython, U.CPYTHON);
  assert.equal(d.unidata, U.UNIDATA);
  for (const [key, name] of Object.entries(RANGES)) assert.deepEqual(d[key], U[/** @type {keyof typeof U} */ (name)], name);
  /** @type {number[]} */
  const fold = [];
  for (const [cp, to] of Object.entries(d.casefold).sort((a, b) => Number(a[0]) - Number(b[0]))) fold.push(Number(cp), to.length, ...to);
  assert.deepEqual(fold, U.CASEFOLD);
  assert.equal(d.nfkdWordSha256, U.NFKD_WORD_SHA256);
  assert.deepEqual(d.ignoreCase, U.IGNORE_CASE);
});
