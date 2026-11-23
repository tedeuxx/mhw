// src/lib/py.js (#476, S05 of #470) against CPython 3.14, on the inputs the worklog's output depends on:
// json.loads and its error texts, datetime.fromisoformat, float repr, round(x, 6) and sum(). The answers
// were recorded from CPython 3.14.6 into test/golden/S05/py-<kind>.json, and they are frozen: the
// recording oracle (test/helpers/py-probe.py) was deleted by #502 (S32 of #470, one Node runtime), so the
// golden is the only oracle, and it is never rewritten from the Node side.
// The inputs are generated from a fixed seed, so the golden file and the generator agree on every OS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  loads, dumps, JsonDecodeError, fromIsoformat, pyStr, pyRound, pySum, PyFloat, cmpStr, pyStrip, pyLen,
} from '../../src/lib/py.js';
import { readGolden } from '../helpers/golden.js';

let seed = 476;
/** @param {number} n */
const rnd = (n) => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed % n;
};
/** @template T @param {T[]} a @returns {T} */
const pick = (a) => a[rnd(a.length)];

/** @param {number} x the double as 16 hex digits, as two words of 8 */
const hex = (x) => {
  const b = Buffer.alloc(8);
  b.writeDoubleBE(x);
  // Split in two words, so a run of sixteen digits never reads as a card number to an outbound scan.
  const h = b.toString('hex');
  return h.slice(0, 8) + ':' + h.slice(8);
};
/** @param {string} h */
const unhex = (h) => Buffer.from(h.replace(':', ''), 'hex').readDoubleBE(0);

function isoCases() {
  seed = 476;
  const out = new Set(['2026-09-01T10:30:15+00:00', '2026-09-01+00:00', '9999-12-31T24:00+00:00', '2026-W53-1T00+00:00', '2026-W53-1T24:00+00:00']);
  const dates = ['2026-09-01', '20260901', '2026-W01-1', '2026W011', '2026-W01', '2026W01', '2024-02-29', '2026-02-29', '9999-12-31', '0001-01-01', '2020-W53-7', '2026-W00-1'];
  const times = ['T10:30:15', 'T10', 'T1030', 'T103015', 'T10:30', ' 10:30:15.5', 'T24:00', 'T24:00:01', 'T10:30:15,123', 'T10:30:15.', 'T103015123',
    'T1030151', 'T10301512', 'T10:30:15a', 'T10:30:156', 'T10:30:15.1234567', '\u00e910', '\u{1f600}10:00', 'T', '', 'T23:59:60', 'T10:3015', 'T10:30:15:'];
  const zones = ['+00:00', '', '+00:00+00:00', '-03:00+00:00', '+0000', '+00', '+01:30', '-01:30', '+013015.5', '+00:99', '+24:00', '+0', '+000', 'Z5', ' '];
  for (const d of dates) for (const t of times) for (const z of zones) if (rnd(4) === 0) out.add(d + t + z);
  const parts = ['2026', '-', '09', '01', 'T', ' ', 'W', '53', '1', '24', '00', ':', '30', '59', '.', ',', '5', '+', 'Z', '0000', '29', '9999', '\u00e9', 'x', '7', ''];
  for (let i = 0; i < 600; i++) {
    let s = '';
    for (let k = 3 + rnd(9); k > 0; k--) s += pick(parts);
    out.add(s.replaceAll('Z', '+00:00'));
  }
  return [...out];
}

function jsonCases() {
  seed = 476;
  const out = new Set(['', ' ', '{}', '[]', '1.0', '1e5', '-0', '-0.0', '[1,]', '{"a":1,}', '{"a":1 "b":2}', '"\\uD83D\\uDE00"', '1e400', '123456789012345678901234567890',
    '[1e16, 1e-5, 1e-4, 123456789.125, 5e-324, 1.7976931348623157e308]', '\ufeff{}', 'NaN', '[-Infinity]', '{"__proto__": 1, "a": {"__proto__": [2]}}', '{"a": 1, "a": 2}']);
  const parts = ['{', '}', '[', ']', '"a"', '"', ':', ',', ' ', '\n', '1', '-', '0', '.', '5', 'e', 'E', '+', 'true', 'nul', 'null', 'NaN', 'Infinity', '-Infinity', '\\', '\\u12',
    '\\ud83d\\ude00', '\\ud800', 'x', '\u0001', '\u{1f600}', '"b\\n"', '1.0', '01', '\ufeff', '\t'];
  for (let i = 0; i < 900; i++) {
    let s = '';
    for (let k = 1 + rnd(9); k > 0; k--) s += pick(parts);
    out.add(s);
  }
  return [...out];
}

function floatCases() {
  seed = 476;
  const out = [0, -0, 1, -1, 0.1, 0.2 + 0.1, 1e16, 1e15, 9999999999999998, 1e-4, 1e-5, 1.5e-5, 123456789.125, 5e-324, Number.MAX_VALUE, Infinity, -Infinity, Number.NaN, 13, 6.5, 9.1, 1 / 3, 2 / 3];
  for (let i = 0; i < 300; i++) out.push(((rnd(2000000) - 1000000) / (1 + rnd(1000))) * 10 ** (rnd(40) - 20));
  return out.map(hex);
}

function roundCases() {
  seed = 476;
  const out = [1 / 128, 3 / 128, 0.0000005, 0.0000015, 2.5, 13, 9.1, 13 * 7 / 10, 91 / 10, 1e-7, -1 / 128, -0.0000025, 0.1234565, 0.1234575, 1e15 + 0.5];
  for (let i = 0; i < 200; i++) out.push(rnd(1000000) / (1 + rnd(9999)));
  for (let i = 0; i < 100; i++) out.push((rnd(100000) * 2 + 1) / 2 ** (7 + rnd(20)));
  return out.map(hex);
}

function sumCases() {
  seed = 476;
  /** @type {Array<Array<string | number>>} */
  const out = [[hex(0.1), hex(0.1), hex(0.1)], [1, hex(0.5), 2], [hex(1e100), hex(1), hex(-1e100)], [hex(0.1), 3, hex(0.2)], [3, 4], [hex(Infinity), hex(1)], [hex(1.25)]];
  for (let i = 0; i < 100; i++) {
    const list = [];
    for (let k = 1 + rnd(8); k > 0; k--) list.push(rnd(3) ? hex(rnd(100000) / (1 + rnd(997))) : rnd(1000));
    out.push(list);
  }
  return out;
}

/** @type {Record<string, () => unknown[]>} */
const GEN = { iso: isoCases, json: jsonCases, float: floatCases, round: roundCases, sum: sumCases };

/** @type {Record<string, (c: any) => unknown>} */
const NODE = {
  iso: (c) => {
    try {
      const v = fromIsoformat(c);
      return ['OK', String(v.us), v.aware];
    } catch {
      return ['ERR', 'ValueError'];
    }
  },
  json: (c) => {
    try {
      return ['OK', dumps(loads(c))];
    } catch (e) {
      return e instanceof JsonDecodeError ? ['ERR', e.message] : ['EXC', String(e)];
    }
  },
  float: (c) => pyStr(new PyFloat(unhex(c))),
  round: (c) => pyStr(new PyFloat(pyRound(unhex(c), 6))),
  sum: (c) => {
    const s = pySum(c.map((/** @type {string | number} */ v) => (typeof v === 'string' ? new PyFloat(unhex(v)) : v)));
    return pyStr(s);
  },
};

for (const kind of Object.keys(GEN)) {
  test('golden: ' + kind + ' answers what CPython 3.14 answered', () => {
    const g = readGolden('S05', 'py-' + kind + '.json');
    assert.deepEqual(GEN[kind](), g.cases, 'the generator and the golden inputs agree');
    const bad = g.cases.map((/** @type {unknown} */ c, /** @type {number} */ i) => [c, g.answers[i], NODE[kind](c)]).filter((/** @type {unknown[]} */ x) => JSON.stringify(x[1]) !== JSON.stringify(x[2]));
    assert.deepEqual(bad.slice(0, 10), []);
  });
}

test('string helpers follow str: code-point order, len, strip', () => {
  assert.equal(cmpStr('\u{1f600}', '\uffff'), 1, 'U+1F600 sorts after U+FFFF, as in Python');
  assert.ok(['\uffff', '\u{1f600}', 'a'].sort()[1] === '\u{1f600}', 'calibration: JavaScript\'s default order disagrees');
  assert.equal(pyLen('\u{1f600}'.repeat(3)), 3);
  assert.equal(pyStrip('\x1c\x85 a \u3000'), 'a');
  assert.equal(pyStrip('\ufeffa'), '\ufeffa', 'U+FEFF is not whitespace to Python');
});
