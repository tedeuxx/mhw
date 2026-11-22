// S15 (#486): the character sets and mappings src/lib/clean-unicode.js pins, held against CPython.
//   always: Node's NFKD equals CPython's on every letter, number and mark (the only characters tokens()
//           normalises), by the digest recorded from CPython; the tables are sorted, disjoint ranges.
//   The tables are frozen: their recorder (test/helpers/s15-record.py) and the live arm that re-ran it
//           were deleted by #502 (S32 of #470, one Node runtime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as U from '../../src/lib/clean-unicode.js';
import { inRanges } from '../../src/lib/clean.js';

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
