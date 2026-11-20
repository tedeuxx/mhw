// src/lib/jq-json.js (#490): JSON written as jq 1.7.1 writes it. The expected strings are jq-1.7.1's own
// output for the same input, measured on 2026-11-19; where jq is on PATH, the same inputs are also run
// through it and compared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { parse, stringify, formatNumber, quote, equal, alt, codepointCompare, JqNumber, JqParseError, typeOf, get, contains } from '../../src/lib/jq-json.js';
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
    const out = spawnSync(jq, args, { input: text, encoding: 'utf8' }).stdout;
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
