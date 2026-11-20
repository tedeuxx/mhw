// src/lib/jq-json.js (#490): JSON written as jq 1.7.1 writes it. The expected strings are jq-1.7.1's own
// output for the same input, measured on 2026-11-19; where jq is on PATH, the same inputs are also run
// through it and compared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parse, classify, jqNumberToken, MAX_DEPTH, stringify, formatNumber, quote, equal, alt, codepointCompare, JqNumber, JqParseError, typeOf, get, contains } from '../../src/lib/jq-json.js';
import { which } from '../helpers/home.js';

const NUMBERS = [['1.0', '1.0'], ['0.5e1', '5'], ['1e-7', '1E-7'], ['123e-2', '1.23'], ['0e3', '0E+3'], ['-1.50', '-1.50'],
  ['1e400', '1E+400'], ['0.0000001', '1E-7'], ['0.000001', '0.000001'], ['12e0', '12'], ['1.23E+5', '1.23E+5'], ['5E-1', '0.5'],
  ['-0.0', '-0.0'], ['10e-1', '1.0'], ['1e1', '1E+1'], ['100e-1', '10.0'], ['0e-9', '0E-9'], ['0.000e5', '0E+2'],
  ['123456789012345678901234567890e10', '1.23456789012345678901234567890E+39'], ['1.5e-6', '0.0000015'], ['0.00000012', '1.2E-7'],
  ['-0', '-0'], ['30', '30'], ['100000000000000000001', '100000000000000000001'], ['0.10', '0.10']];

test('numbers print as jq 1.7.1 prints a literal', () => {
  for (const [lit, want] of NUMBERS) assert.equal(formatNumber(lit), want, lit);
});

test('key order, repeated keys, escapes and indentation follow jq', () => {
  const v = parse('{"b":1.0,"2":"x","1":"y","f":"\\u007f\\u2028\\u00e9\\u0001/\\b\\f\\n\\r\\t\\"\\\\","b":3,"i":[],"j":{},"k":[true,false,null]}');
  assert.equal(stringify(v, { indent: 4 }), '{\n    "b": 3,\n    "2": "x",\n    "1": "y",\n    "f": "\\u007f\u2028\u00e9\\u0001/\\b\\f\\n\\r\\t\\"\\\\",\n'
    + '    "i": [],\n    "j": {},\n    "k": [\n        true,\n        false,\n        null\n    ]\n}');
  assert.equal(stringify(parse('{"b":{"z":1,"a":2},"a":0}'), { sortKeys: true }), '{\n  "a": 0,\n  "b": {\n    "a": 2,\n    "z": 1\n  }\n}');
});

test('the same inputs through jq itself, where jq is on PATH', (t) => {
  const jq = which('jq');
  if (!jq) return t.skip('jq is not on PATH');
  const text = '{"b":1.0,"2":"x","1":"y","n":[' + NUMBERS.map((n) => n[0]).join(',') + '],"s":"\\u007f\u00e9\\u0002","b":{"z":[],"a":{}}}';
  for (const [args, opts] of /** @type {Array<[string[], { indent?: number, sortKeys?: boolean }]>} */ ([[['--indent', '4', '.'], { indent: 4 }], [['-S', '.'], { sortKeys: true }], [['.'], {}]])) {
    /** @type {string} */
    const out = spawnSync(jq, args, { input: text, encoding: 'utf8' }).stdout.replaceAll('\r\n', '\n');
    assert.equal(stringify(parse(text), opts) + '\n', out, args.join(' '));
  }
});

test('parse refuses what is not one JSON document', () => {
  for (const bad of ['', '{"a":1,}', '{"a":1}{"b":2}', '[1,]', 'nan', '{a:1}', '"x', '"\\x"', '"\\u12"', '01', '1.', '-', '1e', '[1 2]', '{"a" 1}',
    '"\u0001"', 'tru']) {
    assert.throws(() => parse(bad), JqParseError, JSON.stringify(bad));
  }
  assert.equal(stringify(parse(' \t\n{ "a" : [ 1 , -2.5e+3 ] }\r\n'), { indent: 0 }), '{\n"a": [\n1,\n-2.5E+3\n]\n}');
});

test('equality, alternatives and helpers', () => {
  assert.ok(equal(parse('{"a":1.0,"b":[1]}'), parse('{"b":[1e0],"a":1}')));
  assert.ok(!equal(parse('{"a":1}'), parse('{"a":1,"b":2}')));
  assert.ok(!equal(parse('[1]'), parse('[1,2]')));
  assert.ok(!equal(parse('"1"'), parse('1')));
  assert.ok(!equal(parse('{"a":1}'), parse('{"b":1}')));
  assert.ok(equal(null, undefined));
  assert.equal(alt(false, 'd'), 'd');
  assert.equal(alt(null, 'd'), 'd');
  assert.equal(alt(0 === 0 ? '' : null, 'd'), '');
  assert.equal(typeOf(new JqNumber('1')), 'number');
  assert.equal(typeOf(true), 'boolean');
  assert.equal(get('x', 'a'), null);
  assert.ok(contains(['a', new JqNumber('2')], new JqNumber('2.0')));
  assert.ok(codepointCompare('\u{1F600}', '\uFFFF') > 0, 'by codepoint, not by UTF-16 unit');
  assert.ok(codepointCompare('a', 'ab') < 0);
  assert.equal(quote('\u001f'), '"\\u001f"');
});

// ---- acceptance (PR #519 QA B1): what jq 1.7.1 reads, what it refuses ------------------------------
// Each row: the input, and what jq-1.7.1 did with it (measured 2026-11-20): 'json' (strict JSON, read by
// both), 'jq-only' (jq reads it, strict JSON does not) or 'unreadable' (jq refuses it).
const nest = (/** @type {number} */ n, /** @type {string} */ open, /** @type {string} */ close, inner = '1') => open.repeat(n) + inner + close.repeat(n);
/** @type {Array<[string, 'json' | 'jq-only' | 'unreadable', string]>} */
const ACCEPTANCE = [
  // (a) a high surrogate escape not followed by a low one: jq refuses.
  ['"\\ud800"', 'unreadable', 'lone high surrogate'],
  ['"\\ud83dA"', 'unreadable', 'high surrogate then a letter'],
  ['"\\ud83d\u{1F600}"', 'unreadable', 'high surrogate then a raw astral character'],
  ['"\\ude00\\ud83d"', 'unreadable', 'low then high'],
  ['"\\ud800\\u0000"', 'unreadable', 'high surrogate then a non-surrogate escape'],
  ['"\\udc00"', 'json', 'a lone low surrogate (U+FFFD)'],
  ['"\\ud800\\udc00"', 'json', 'a pair'],
  // (b) and (c) nesting: Apple's jq reads 256 arrays and not 257 (an object counts its pending key); the
  // Ubuntu and Windows builds read deeper (CI, PR #519). Past the limit this reader stops, and names it
  // jq-only, so the step refuses visibly on every build.
  [nest(MAX_DEPTH, '[', ']', ''), 'json', '256 arrays'],
  [nest(MAX_DEPTH + 1, '[', ']', ''), 'jq-only', '257 arrays'],
  ['{"a":' + nest(254, '[', ']', '') + '}', 'json', 'an object and 254 arrays'],
  ['{"a":' + nest(255, '[', ']', '') + '}', 'jq-only', 'an object and 255 arrays'],
  [nest(300, '{"a":', '}'), 'jq-only', '300 objects'],
  [nest(10000, '[', ']'), 'jq-only', '10,000 arrays (no RangeError)'],
  // (d) what jq reads and strict JSON does not.
  ['\ufeff{}', 'jq-only', 'a byte-order mark'],
  ['[nan]', 'jq-only', 'nan'], ['[NaN]', 'jq-only', 'NaN'], ['[-NaN]', 'jq-only', '-NaN'], ['[NAN]', 'jq-only', 'NAN'],
  ['[Infinity]', 'jq-only', 'Infinity'], ['[-Infinity]', 'jq-only', '-Infinity'], ['[infinity]', 'jq-only', 'infinity'],
  ['[inf]', 'jq-only', 'inf'], ['[01]', 'jq-only', '01'], ['[00]', 'jq-only', '00'], ['[-01]', 'jq-only', '-01'],
  ['[.5]', 'jq-only', '.5'], ['[-.5]', 'jq-only', '-.5'], ['[1.]', 'jq-only', '1.'], ['[0.]', 'jq-only', '0.'],
  ['[1.e5]', 'jq-only', '1.e5'], ['[+1]', 'jq-only', '+1'], ['[+.5]', 'jq-only', '+.5'], ['[00.5]', 'jq-only', '00.5'],
  ['{} {}', 'jq-only', 'two documents'], ['{}{}', 'jq-only', 'two documents, no space'], ['[1] [2]', 'jq-only', 'two arrays'],
  ['{}\u0000', 'jq-only', 'a trailing NUL'], ['{"a":1}\u0000x', 'jq-only', 'input cut at a NUL'],
  // Refused by both.
  ['', 'unreadable', 'empty'], ['\u0000{}', 'unreadable', 'a leading NUL'], ['[1,]', 'unreadable', 'a trailing comma'],
  ['{"a":1,}', 'unreadable', 'a trailing comma in an object'], ['[1 2]', 'unreadable', 'no comma'], ['{a:1}', 'unreadable', 'a bare key'],
  ['"a\tb"', 'unreadable', 'a raw tab in a string'], ['[1e]', 'unreadable', '1e'], ['[0x1]', 'unreadable', '0x1'],
  ['[--1]', 'unreadable', '--1'], ['[tru]', 'unreadable', 'tru'], ['[true1]', 'unreadable', 'true1'], ['[-]', 'unreadable', '-'],
  ['\ufeff\ufeff{}', 'unreadable', 'two byte-order marks'], ['{"a":"x\u0000y"}', 'unreadable', 'a raw NUL in a string'],
  ['{"a" 1}', 'unreadable', 'no colon'], ['[\f1]', 'unreadable', 'a form feed'],
];

test('acceptance: each input is read, jq-only or unreadable as jq 1.7.1 found it', () => {
  for (const [input, want, name] of ACCEPTANCE) assert.equal(classify(input).kind, want, name);
  assert.equal(stringify(parse('"\\udc00"')), '"\ufffd"');
  assert.equal(stringify(parse('"\\ud83d\\ude00"')), '"\u{1F600}"');
  // Anything that is not JSON throws JqParseError, never another error.
  assert.throws(() => parse(nest(20000, '[', ']')), JqParseError);
  for (const [t, want] of /** @type {Array<[string, boolean]>} */ ([['nan', true], ['NaN12', true], ['-inf', true], ['+Infinity', true],
    ['1.', true], ['.5', true], ['1.e5', true], ['00.5', true], ['1e-3', true], ['nana', false], ['infx', false], ['.', false],
    ['1e', false], ['1e+', false], ['0x1', false], ['1.5.', false], ['.e5', false], ['1e5e5', false], ['--1', false], ['', false]])) {
    assert.equal(jqNumberToken(t), want, t);
  }
});

test('acceptance: the same inputs through jq itself, where jq is on PATH', (t) => {
  const jq = which('jq');
  if (!jq) return t.skip('jq is not on PATH');
  const wrong = [];
  for (const [input, , name] of ACCEPTANCE) {
    const p = spawnSync(jq, ['-c', '.'], { input: Buffer.from(input, 'utf8') });
    const jqReads = p.status === 0 && p.stdout.length > 0;
    const kind = classify(input).kind;
    // jq reads it: this reader reads it or names it jq-only (never silent). jq refuses it: never read.
    if (jqReads ? kind === 'unreadable' : kind === 'json') wrong.push(name + ': jq ' + (jqReads ? 'reads' : 'refuses') + ', classify says ' + kind);
  }
  assert.deepEqual(wrong, []);
});

test('jq -S orders keys by code point, astral keys included (QA A7)', () => {
  assert.equal(stringify(parse('{"\u{1F600}":2,"\uffff":1}'), { sortKeys: true }), '{\n  "\uffff": 1,\n  "\u{1F600}": 2\n}');
});
