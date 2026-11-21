// mhw policy check [--project=DIR | --file=PATH] (#498, S28 of #470): the fail-closed validator of the
// project-policy contract (ADR-0015 lock 3 of 5, Issue #245), the Node form of
// global/project-policy/project_policy.py, which this slice deletes.
//
// It reads one project's contract file, project-policy.json at the root of DIR (default: the current
// directory), or the file PATH names, and checks it against global/project-policy/project-policy.schema.json
// (Issue #244). It exits 0 only when the file is valid. Every other outcome is non-zero, one line per reason:
//
//     exit 1  the file is missing, unreadable, not JSON, not an object, declares an unknown or no
//             schema_version, or breaks the contract (each finding names the #192 class it falls in)
//     exit 2  a usage error, or the validator cannot run (its own schema is unreadable, or carries a
//             keyword this evaluator does not implement): it cannot say the file is valid, so it does not
//
// It checks the contract only. It reads no evidence: whether the named controls ran, the MADR is really
// accepted or the runbook was really tested is #246's reference CI/CD (delivery_gate.py), which reaches
// this command through the CLI until S29 (#499).
//
// Parity with the original (test/project-policy/project-policy-golden.test.js, test/golden/S28/):
// - JSON is read by its own strict parser, not JSON.parse, because the original's answers depend on what
//   CPython's json module does: a repeated key and NaN, Infinity or -Infinity are refused, an integer
//   (1) and a float (1.0) are different types to the schema, and a malformed file is reported with
//   CPython's own message ("Expecting ',' delimiter"; for the schema also its line, column and char).
// - Integers are BigInt, floats are numbers, objects are Maps (key order is the file's), arrays are arrays.
// - Every schema pattern is compiled here, from literals; a pattern outside the known set is refused
//   (exit 2), so no regular expression read from a file reaches the engine.
// node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pyRepr } from '../lib/argparse.js';

const HERE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'global', 'project-policy');
export const SCHEMA = path.join(HERE, 'project-policy.schema.json');
export const FILE_NAME = 'project-policy.json';
export const KNOWN_VERSIONS = [1n];
export const SEVERITIES = ['low', 'medium', 'high', 'critical'];

const ANNOTATIONS = ['$schema', 'title', 'description', '$comment'];
const KEYWORDS = new Set([
  ...ANNOTATIONS,
  'type', 'const', 'enum', 'required', 'properties', 'additionalProperties', 'items', 'minItems',
  'maxItems', 'uniqueItems', 'contains', 'allOf', 'if', 'then', 'minimum', 'maximum',
  'exclusiveMinimum', 'minLength', 'pattern',
]);

/** @typedef {null | boolean | bigint | number | string | Json[] | Map<string, Json>} Json */

/** @type {Record<string, (v: Json) => boolean>} */
const TYPES = {
  object: (v) => v instanceof Map,
  array: (v) => Array.isArray(v),
  string: (v) => typeof v === 'string',
  boolean: (v) => typeof v === 'boolean',
  integer: (v) => typeof v === 'bigint',
  number: (v) => typeof v === 'bigint' || typeof v === 'number',
};

// Every pattern the schema may use, from literals, each with its ECMA-262 form (the dialect of JSON
// Schema; anchored, so test() is a full match). [0-9], not \d, as in the original.
/** @type {Map<string, RegExp>} */
export const KNOWN_PATTERNS = new Map([
  ['^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$', /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/],
  ['^(?!/)(?!.*(^|/)\\.\\.(/|$))[A-Za-z0-9_./-]+\\.md$', /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9_./-]+\.md$/],
  ['^[a-z0-9][a-z0-9-]*$', /^[a-z0-9][a-z0-9-]*$/],
  ['^[0-9]{4}-[0-9]{2}-[0-9]{2}$', /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/],
  ['^@[A-Za-z0-9-]+$', /^@[A-Za-z0-9-]+$/],
  // Issue #523: a free-text field must carry a letter or digit. [\s\S] is every character, so the
  // pattern means "some ASCII letter or digit somewhere"; tested that way, which is linear.
  ['^[\\s\\S]*[A-Za-z0-9][\\s\\S]*$', /[A-Za-z0-9]/],
]);

const PROJECT_OPT = '--project=';
const FILE_OPT = '--file=';

// -- Python's exceptions, as far as the original's messages name them ------------------------------

/** The schema uses something this evaluator does not implement (the original's SchemaError). */
export class SchemaError extends Error {
  get pyName() { return 'SchemaError'; }
}

/** The file cannot be read as a contract at all (the original's Refusal). */
export class Refusal extends Error {}

/** CPython's json.JSONDecodeError: msg, and str() with the line, column and char position. */
export class JSONDecodeError extends Error {
  /** @param {string} msg @param {string} s @param {number} unit an index into s, in UTF-16 units */
  constructor(msg, s, unit) {
    const prefix = s.slice(0, unit);
    const pos = [...prefix].length;
    const lineno = (prefix.match(/\n/g) || []).length + 1;
    const nl = prefix.lastIndexOf('\n');
    const colno = nl < 0 ? pos + 1 : pos - [...prefix.slice(0, nl)].length;
    super(msg + ': line ' + lineno + ' column ' + colno + ' (char ' + pos + ')');
    this.msg = msg;
  }
}

/** A nesting deep enough that CPython's stack overflows (its RecursionError). */
export class PyRecursionError extends Error {
  get pyName() { return 'RecursionError'; }
}

/** An integer literal past CPython's 4300-digit conversion limit (a ValueError without msg). */
export class PyValueError extends Error {}

// CPython overflows its stack, measured on 3.14.6 macOS: a JSON array or object nested 100000 deep
// decodes, one nested 1000000 deep does not; two nested lists compared at depth 10000 are equal, at
// depth 50000 the comparison overflows. The limit is stack-based there, so these are the measured
// bounds, not CPython's exact ones (a residual of test/golden/S28/expected-differences.json).
const MAX_DECODE_DEPTH = 100000;
const MAX_COMPARE_DEPTH = 10000;
const INT_MAX_STR_DIGITS = 4300;

// -- the strict JSON reader -------------------------------------------------------------------------

const WS = new Set([' ', '\t', '\n', '\r']);
/** @type {Record<string, string>} */
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
const NUMBER = /-?(?:0|[1-9][0-9]*)(\.[0-9]+)?([eE][-+]?[0-9]+)?/y;
const HEX4 = /^[0-9a-fA-F]{4}$/;

/**
 * The pairs of one object as the original's object_pairs_hook took them: a repeated key is refused.
 * @param {Array<[string, Json]>} pairs
 */
function noDuplicates(pairs) {
  /** @type {Map<string, Json>} */
  const out = new Map();
  /** @type {Set<string>} */
  const dup = new Set();
  for (const [k, v] of pairs) {
    if (out.has(k)) dup.add(k);
    out.set(k, v);
  }
  if (dup.size) {
    // CPython keeps the last value of a repeated key; a reader in another language may keep the first.
    // One file must not mean two things, so a repeated key is refused.
    throw new Refusal('repeated key ' + [...dup].sort(codepointCompare).map((k) => pyDumps(k)).join(', '));
  }
  return out;
}

/**
 * CPython's json.loads(s, object_pairs_hook=_no_duplicates, parse_constant=_no_constant).
 * @param {string} s
 * @returns {Json}
 */
export function strictLoads(s) {
  if (s.startsWith('\uFEFF')) throw new JSONDecodeError('Unexpected UTF-8 BOM (decode using utf-8-sig)', s, 0);
  const n = s.length;
  /** @param {number} i */
  const ws = (i) => {
    while (i < n && WS.has(s[i])) i++;
    return i;
  };
  /**
   * The four hex digits after s[at] ('u'), or the escape error at it.
   * @param {number} at
   */
  const hex4 = (at) => {
    const digits = s.slice(at + 1, at + 5);
    // CPython needs a character after the four digits too (it reports an escape the input ends inside).
    if (at + 5 >= n || !HEX4.test(digits)) throw new JSONDecodeError('Invalid \\uXXXX escape', s, at);
    return Number.parseInt(digits, 16);
  };
  /**
   * A string whose opening quote is s[start - 1]: [value, index after the closing quote].
   * @param {number} start
   * @returns {[string, number]}
   */
  const scanString = (start) => {
    const begin = start - 1;
    let out = '';
    let j = start;
    for (;;) {
      let k = j;
      while (k < n) {
        const c = s.charCodeAt(k);
        if (c === 34 || c === 92 || c < 0x20) break;
        k++;
      }
      if (k >= n) throw new JSONDecodeError('Unterminated string starting at', s, begin);
      out += s.slice(j, k);
      const c = s.charCodeAt(k);
      if (c === 34) return [out, k + 1];
      if (c !== 92) throw new JSONDecodeError('Invalid control character at', s, k);
      if (k + 1 >= n) throw new JSONDecodeError('Unterminated string starting at', s, begin);
      const esc = s[k + 1];
      if (esc !== 'u') {
        if (!Object.hasOwn(ESCAPES, esc)) throw new JSONDecodeError('Invalid \\escape', s, k);
        out += ESCAPES[esc];
        j = k + 2;
        continue;
      }
      let uni = hex4(k + 1);
      let next = k + 6;
      if (uni >= 0xd800 && uni <= 0xdbff && s[next] === '\\' && s[next + 1] === 'u') {
        const low = hex4(next + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          uni = 0x10000 + (((uni - 0xd800) << 10) | (low - 0xdc00));
          next += 6;
        }
      }
      out += String.fromCodePoint(uni);
      j = next;
    }
  };
  /**
   * A scalar at i: [value, index after it]; "Expecting value" when there is none.
   * @param {number} i
   * @returns {[Json, number]}
   */
  const scanScalar = (i) => {
    const c = s[i];
    if (c === '"') return scanString(i + 1);
    if (c === 'n' && s.startsWith('null', i)) return [null, i + 4];
    if (c === 't' && s.startsWith('true', i)) return [true, i + 4];
    if (c === 'f' && s.startsWith('false', i)) return [false, i + 5];
    // NaN compares false with every bound, so threshold_percent NaN would pass every range check.
    for (const name of ['NaN', 'Infinity', '-Infinity']) {
      if (s.startsWith(name, i)) throw new Refusal(name + ' is not JSON');
    }
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(s);
    if (!m) throw new JSONDecodeError('Expecting value', s, i);
    const text = m[0];
    const end = i + text.length;
    if (m[1] !== undefined || m[2] !== undefined) return [Number(text), end];
    const digits = text.startsWith('-') ? text.length - 1 : text.length;
    if (digits > INT_MAX_STR_DIGITS) {
      throw new PyValueError('Exceeds the limit (' + INT_MAX_STR_DIGITS + ' digits) for integer string conversion: value has '
        + digits + ' digits; use sys.set_int_max_str_digits() to increase the limit');
    }
    return [BigInt(text), end];
  };

  /** @type {Array<{ kind: 'array', items: Json[] } | { kind: 'object', pairs: Array<[string, Json]>, key: string }>} */
  const stack = [];
  /**
   * After a key's opening quote at i: the key, its colon, the index of its value.
   * @param {number} i
   * @returns {[string, number]}
   */
  const keyAt = (i) => {
    if (s[i] !== '"') throw new JSONDecodeError('Expecting property name enclosed in double quotes', s, i);
    const [key, after] = scanString(i + 1);
    const colon = ws(after);
    if (s[colon] !== ':') throw new JSONDecodeError("Expecting ':' delimiter", s, colon);
    return [key, ws(colon + 1)];
  };
  /** @param {string} kind */
  const push = (kind) => {
    if (stack.length >= MAX_DECODE_DEPTH) {
      throw new PyRecursionError('Stack overflow while decoding a JSON ' + kind + ' from a unicode string');
    }
  };
  let i = ws(0);
  /** @type {Json} */
  let value = null;
  for (;;) {
    // a value starts at i
    if (s[i] === '{') {
      push('object');
      const first = ws(i + 1);
      if (s[first] === '}') {
        value = noDuplicates([]);
        i = first + 1;
      } else {
        const [key, at] = keyAt(first);
        stack.push({ kind: 'object', pairs: [], key });
        i = at;
        continue;
      }
    } else if (s[i] === '[') {
      push('array');
      const first = ws(i + 1);
      if (s[first] === ']') {
        value = [];
        i = first + 1;
      } else {
        stack.push({ kind: 'array', items: [] });
        i = first;
        continue;
      }
    } else {
      [value, i] = scanScalar(i);
    }
    // a value ended at i: close what it completes
    let more = false;
    while (stack.length && !more) {
      const top = stack[stack.length - 1];
      i = ws(i);
      if (top.kind === 'array') {
        top.items.push(value);
        if (s[i] === ']') {
          stack.pop();
          value = top.items;
          i++;
        } else if (s[i] === ',') {
          const comma = i;
          i = ws(i + 1);
          if (s[i] === ']') throw new JSONDecodeError('Illegal trailing comma before end of array', s, comma);
          more = true;
        } else {
          throw new JSONDecodeError("Expecting ',' delimiter", s, i);
        }
      } else {
        top.pairs.push([top.key, value]);
        if (s[i] === '}') {
          stack.pop();
          value = noDuplicates(top.pairs);
          i++;
        } else if (s[i] === ',') {
          const comma = i;
          i = ws(i + 1);
          if (s[i] === '}') throw new JSONDecodeError('Illegal trailing comma before end of object', s, comma);
          const [key, at] = keyAt(i);
          top.key = key;
          i = at;
          more = true;
        } else {
          throw new JSONDecodeError("Expecting ',' delimiter", s, i);
        }
      }
    }
    if (more) continue;
    const end = ws(i);
    if (end !== n) throw new JSONDecodeError('Extra data', s, end);
    return value;
  }
}

// -- Python's equality, json.dumps and float repr ---------------------------------------------------

/** Code-point order, as Python sorts str. @param {string} a @param {string} b */
export function codepointCompare(a, b) {
  const x = [...a];
  const y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = /** @type {number} */ (x[k].codePointAt(0)) - /** @type {number} */ (y[k].codePointAt(0));
    if (d) return d;
  }
  return x.length - y.length;
}

/** @param {Json} v */
const isNumeric = (v) => typeof v === 'bigint' || typeof v === 'number' || typeof v === 'boolean';
/** @param {Json} v */
const numeric = (v) => (typeof v === 'boolean' ? BigInt(v) : /** @type {bigint | number} */ (v));

/**
 * Python's ==, where True == 1 and 1 == 1.0, over lists and dicts too. Iterative, with the measured
 * comparison depth as CPython's RecursionError.
 * @param {Json} a @param {Json} b
 */
export function pyEq(a, b) {
  /** @type {Array<[Json, Json, number]>} */
  const work = [[a, b, 0]];
  while (work.length) {
    const [x, y, depth] = /** @type {[Json, Json, number]} */ (work.pop());
    if (isNumeric(x) && isNumeric(y)) {
      // BigInt and number compare exactly with < and >, as Python compares int and float (no NaN here).
      const [p, q] = [numeric(x), numeric(y)];
      if (p < q || p > q) return false;
      continue;
    }
    if (Array.isArray(x) && Array.isArray(y)) {
      if (depth >= MAX_COMPARE_DEPTH) throw new PyRecursionError('Stack overflow in comparison');
      if (x.length !== y.length) return false;
      for (let k = x.length - 1; k >= 0; k--) work.push([x[k], y[k], depth + 1]);
      continue;
    }
    if (x instanceof Map && y instanceof Map) {
      if (depth >= MAX_COMPARE_DEPTH) throw new PyRecursionError('Stack overflow in comparison');
      if (x.size !== y.size) return false;
      for (const [k, v] of x) {
        if (!y.has(k)) return false;
        work.push([v, /** @type {Json} */ (y.get(k)), depth + 1]);
      }
      continue;
    }
    if (x !== y) return false;
  }
  return true;
}

/** JSON equality: true is not 1 (at the top). @param {Json} a @param {Json} b */
export function same(a, b) {
  if (typeof a === 'boolean' || typeof b === 'boolean') return typeof a === typeof b && a === b;
  return pyEq(a, b);
}

/** Python's repr of a float. @param {number} x */
export function pyFloatRepr(x) {
  if (Number.isNaN(x)) return 'nan';
  if (x === Infinity) return 'inf';
  if (x === -Infinity) return '-inf';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const m = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(x.toExponential());
  const [, sign, lead, frac = '', e] = /** @type {RegExpExecArray} */ (m);
  const digits = lead + frac;
  const exp = Number(e);
  if (exp < -4 || exp >= 16) {
    const mant = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
    return sign + mant + 'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
  }
  if (exp < 0) return sign + '0.' + '0'.repeat(-exp - 1) + digits;
  if (digits.length <= exp + 1) return sign + digits + '0'.repeat(exp + 1 - digits.length) + '.0';
  return sign + digits.slice(0, exp + 1) + '.' + digits.slice(exp + 1);
}

/** Python's json.dumps(v) (ensure_ascii, ", " and ": "). @param {Json} v @returns {string} */
export function pyDumps(v) {
  if (v === null) return 'null';
  if (typeof v === 'boolean') return v ? 'true' : 'false';
  if (typeof v === 'bigint') return v.toString();
  if (typeof v === 'number') {
    if (v === Infinity) return 'Infinity';
    if (v === -Infinity) return '-Infinity';
    if (Number.isNaN(v)) return 'NaN';
    return pyFloatRepr(v);
  }
  if (typeof v === 'string') {
    let out = '"';
    for (let k = 0; k < v.length; k++) {
      const c = v.charCodeAt(k);
      const ch = v[k];
      if (ch === '"') out += '\\"';
      else if (ch === '\\') out += '\\\\';
      else if (ch === '\n') out += '\\n';
      else if (ch === '\r') out += '\\r';
      else if (ch === '\t') out += '\\t';
      else if (ch === '\b') out += '\\b';
      else if (ch === '\f') out += '\\f';
      else if (c < 0x20 || c > 0x7e) out += '\\u' + c.toString(16).padStart(4, '0');
      else out += ch;
    }
    return out + '"';
  }
  if (Array.isArray(v)) return '[' + v.map(pyDumps).join(', ') + ']';
  return '{' + [...v].map(([k, x]) => pyDumps(k) + ': ' + pyDumps(x)).join(', ') + '}';
}

// -- the schema walk and the evaluator --------------------------------------------------------------

/** @param {Json} v */
const isCount = (v) => typeof v === 'bigint' && v >= 0n;
/** @param {Json} v */
const isNumber = (v) => typeof v === 'bigint' || typeof v === 'number';

// The value each applied keyword needs; a schema with another value cannot be evaluated.
/** @type {Array<[string, (v: Json) => boolean]>} */
const VALUE_SHAPES = [
  ['required', (v) => Array.isArray(v) && v.every((k) => typeof k === 'string')],
  ['enum', (v) => Array.isArray(v)],
  ['minItems', isCount], ['maxItems', isCount], ['minLength', isCount],
  ['minimum', isNumber], ['maximum', isNumber], ['exclusiveMinimum', isNumber],
  ['uniqueItems', (v) => typeof v === 'boolean'],
];

/** @param {Map<string, Json>} schema */
const unknownKeywords = (schema) => [...schema.keys()].filter((k) => !KEYWORDS.has(k)).sort(codepointCompare);
/** @param {string[]} names */
const pyList = (names) => '[' + names.map(pyRepr).join(', ') + ']';
/** @param {Map<string, Json>} schema @param {string} key @returns {Json | undefined} */
const get = (schema, key) => schema.get(key);
/** @param {Json | undefined} v */
const absent = (v) => v === undefined || v === null;

/**
 * Throw SchemaError on any construct evaluate() cannot apply, anywhere in the schema. evaluate() visits
 * only the subschemas a document reaches, so its own refusals are lazy; this walk runs once over the
 * whole schema before any file is read.
 * @param {Json} schema @param {string} [where]
 */
export function validateSchema(schema, where = '$') {
  if (!(schema instanceof Map)) throw new SchemaError(where + ': a subschema must be an object');
  const unknown = unknownKeywords(schema);
  if (unknown.length) throw new SchemaError(where + ': schema keyword not implemented: ' + pyList(unknown));
  const kind = get(schema, 'type');
  if (!absent(kind) && !(typeof kind === 'string' && Object.hasOwn(TYPES, kind))) {
    throw new SchemaError(where + ': type not implemented: ' + pyDumps(/** @type {Json} */ (kind)));
  }
  if (schema.has('additionalProperties') && typeof schema.get('additionalProperties') !== 'boolean') {
    throw new SchemaError(where + ': only additionalProperties true or false is implemented');
  }
  const pattern = get(schema, 'pattern');
  if (!absent(pattern)) {
    if (!(typeof pattern === 'string' && pattern.startsWith('^') && pattern.endsWith('$'))) {
      throw new SchemaError(where + ': only patterns anchored with ^ and $ are implemented');
    }
    if (!KNOWN_PATTERNS.has(pattern)) throw new SchemaError(where + ": pattern not in the validator's known set: " + pattern);
  }
  if (schema.has('then') && !schema.has('if')) throw new SchemaError(where + ': then without if');
  for (const [key, ok] of VALUE_SHAPES) {
    if (schema.has(key) && !ok(/** @type {Json} */ (schema.get(key)))) {
      throw new SchemaError(where + ': ' + key + ' has a value this evaluator cannot apply');
    }
  }
  const properties = schema.has('properties') ? schema.get('properties') : new Map();
  if (!(properties instanceof Map)) throw new SchemaError(where + ': properties must be an object');
  for (const [key, sub] of properties) validateSchema(sub, where + '.properties.' + key);
  for (const key of ['items', 'contains', 'if', 'then']) {
    if (schema.has(key)) validateSchema(/** @type {Json} */ (schema.get(key)), where + '.' + key);
  }
  const allOf = schema.has('allOf') ? schema.get('allOf') : [];
  if (!Array.isArray(allOf)) throw new SchemaError(where + ': allOf must be an array');
  allOf.forEach((sub, k) => validateSchema(sub, where + '.allOf[' + k + ']'));
}

/** @typedef {[string, string]} Finding a (path, keyword) pair */

/** Python's len of a str: code points. @param {string} s */
const pyLen = (s) => [...s].length;

/**
 * Errors, as (path, keyword) pairs, of value against the subset of draft 2020-12 used here.
 * @param {Json} value @param {Json} schemaIn @param {string} [where]
 * @returns {Finding[]}
 */
export function evaluate(value, schemaIn, where = '$') {
  if (!(schemaIn instanceof Map)) throw new SchemaError(where + ': a subschema must be an object');
  const schema = schemaIn;
  const unknown = unknownKeywords(schema);
  if (unknown.length) throw new SchemaError(where + ': schema keyword not implemented: ' + pyList(unknown));
  /** @type {Finding[]} */
  const errors = [];
  const kind = get(schema, 'type');
  if (!absent(kind)) {
    if (typeof kind !== 'string' || !Object.hasOwn(TYPES, kind)) throw new SchemaError(where + ': type not implemented');
    if (!TYPES[kind](value)) return [[where, 'type']];
  }
  if (schema.has('const') && !same(value, /** @type {Json} */ (schema.get('const')))) errors.push([where, 'const']);
  if (schema.has('enum')) {
    const options = /** @type {Json[]} */ (schema.get('enum'));
    if (!options.some((option) => same(value, option))) errors.push([where, 'enum']);
  }
  if (value instanceof Map) {
    const properties = /** @type {Map<string, Json>} */ (schema.has('properties') ? schema.get('properties') : new Map());
    for (const key of /** @type {string[]} */ (schema.has('required') ? schema.get('required') : [])) {
      if (!value.has(key)) errors.push([where + '.' + key, 'required']);
    }
    if (schema.get('additionalProperties') === false) {
      for (const key of value.keys()) {
        if (!properties.has(key)) errors.push([where + '.' + key, 'additionalProperties']);
      }
    } else if (schema.has('additionalProperties') && schema.get('additionalProperties') !== true) {
      throw new SchemaError(where + ': only additionalProperties false is implemented');
    }
    for (const [key, sub] of properties) {
      if (value.has(key)) errors.push(...evaluate(/** @type {Json} */ (value.get(key)), sub, where + '.' + key));
    }
  }
  if (Array.isArray(value)) {
    const minItems = /** @type {bigint} */ (schema.has('minItems') ? schema.get('minItems') : 0n);
    if (value.length < minItems) errors.push([where, 'minItems']);
    if (schema.has('maxItems') && value.length > /** @type {bigint} */ (schema.get('maxItems'))) errors.push([where, 'maxItems']);
    if (schema.get('uniqueItems') === true && value.some((item, k) => value.slice(0, k).some((earlier) => same(item, earlier)))) {
      errors.push([where, 'uniqueItems']);
    }
    if (schema.has('items')) {
      const items = /** @type {Json} */ (schema.get('items'));
      value.forEach((item, k) => errors.push(...evaluate(item, items, where + '[' + k + ']')));
    }
    if (schema.has('contains')) {
      const contains = /** @type {Json} */ (schema.get('contains'));
      if (!value.some((item) => evaluate(item, contains, where).length === 0)) errors.push([where, 'contains']);
    }
  }
  if (TYPES.number(value)) {
    const v = /** @type {bigint | number} */ (value);
    if (schema.has('minimum') && v < /** @type {bigint | number} */ (schema.get('minimum'))) errors.push([where, 'minimum']);
    if (schema.has('maximum') && v > /** @type {bigint | number} */ (schema.get('maximum'))) errors.push([where, 'maximum']);
    if (schema.has('exclusiveMinimum') && v <= /** @type {bigint | number} */ (schema.get('exclusiveMinimum'))) {
      errors.push([where, 'exclusiveMinimum']);
    }
  }
  const pattern = get(schema, 'pattern');
  if (!absent(pattern)) {
    if (!(typeof pattern === 'string' && pattern.startsWith('^') && pattern.endsWith('$'))) {
      throw new SchemaError(where + ': only patterns anchored with ^ and $ are implemented');
    }
    if (!KNOWN_PATTERNS.has(pattern)) throw new SchemaError(where + ": pattern not in the validator's known set: " + pattern);
  }
  if (typeof value === 'string') {
    if (schema.has('minLength') && pyLen(value) < /** @type {bigint} */ (schema.get('minLength'))) errors.push([where, 'minLength']);
    if (typeof pattern === 'string' && !(/** @type {RegExp} */ (KNOWN_PATTERNS.get(pattern))).test(value)) {
      errors.push([where, 'pattern']);
    }
  }
  for (const sub of /** @type {Json[]} */ (schema.has('allOf') ? schema.get('allOf') : [])) errors.push(...evaluate(value, sub, where));
  if (schema.has('if')) {
    if (evaluate(value, /** @type {Json} */ (schema.get('if')), where).length === 0) {
      errors.push(...evaluate(value, /** @type {Json} */ (schema.has('then') ? schema.get('then') : new Map()), where));
    }
  } else if (schema.has('then')) {
    throw new SchemaError(where + ': then without if');
  }
  return errors;
}

// -- reading the file, failing closed ---------------------------------------------------------------

// What C strerror() says for the errors a read can raise here (macOS and Linux agree on these).
/** @type {Record<string, string>} */
const STRERROR = {
  EACCES: 'Permission denied',
  EPERM: 'Operation not permitted',
  ENOTDIR: 'Not a directory',
  ELOOP: 'Too many levels of symbolic links',
  ENAMETOOLONG: 'File name too long',
  EIO: 'Input/output error',
  EINVAL: 'Invalid argument',
  EISDIR: 'Is a directory',
  ENOENT: 'No such file or directory',
};
/** @type {Record<string, number>} */
const ERRNO = { ENOENT: 2, EIO: 5, EACCES: 13, ENOTDIR: 20, EISDIR: 21, EINVAL: 22, ENAMETOOLONG: 63, ELOOP: 62, EPERM: 1 };

/** @param {unknown} e */
const errCode = (e) => String((e && /** @type {NodeJS.ErrnoException} */ (e).code) || '');
/** @param {unknown} e */
const strerror = (e) => STRERROR[errCode(e)] || (e instanceof Error ? e.message : String(e));

/** @param {string} p */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** @param {Buffer} raw */
function decodeUtf8(raw) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
}

/**
 * The parsed file, or Refusal with the reason.
 * @param {string} p
 * @returns {Json}
 */
export function read(p) {
  // A directory is tested first, as the original did (Windows refuses to read one with EPERM).
  if (isDir(p)) throw new Refusal('missing: ' + p + ' is a directory, not a file');
  let raw;
  try {
    raw = fs.readFileSync(p);
  } catch (e) {
    if (errCode(e) === 'ENOENT') throw new Refusal('missing: no file at ' + p);
    if (errCode(e) === 'EISDIR') throw new Refusal('missing: ' + p + ' is a directory, not a file');
    throw new Refusal('unreadable: ' + strerror(e));
  }
  let text;
  try {
    text = decodeUtf8(raw);
  } catch {
    throw new Refusal('malformed: not UTF-8');
  }
  try {
    return strictLoads(text);
  } catch (e) {
    if (e instanceof Refusal) throw new Refusal('malformed: ' + e.message);
    if (e instanceof JSONDecodeError) throw new Refusal('malformed: not JSON (' + e.msg + ')');
    if (e instanceof PyRecursionError) throw new Refusal('malformed: not JSON (RecursionError)');
    if (e instanceof PyValueError) throw new Refusal('malformed: not JSON (ValueError)');
    throw e;
  }
}

/**
 * The schema, read as the original read it (read_text: universal newlines, then the same strict parse),
 * or the reason it cannot be, as str() of CPython's exception.
 * @param {string} schemaPath
 * @returns {{ schema?: Json, error?: string }}
 */
function readSchema(schemaPath) {
  let raw;
  try {
    raw = fs.readFileSync(schemaPath);
  } catch (e) {
    const code = errCode(e);
    const errno = ERRNO[code];
    if (errno === undefined) return { error: strerror(e) };
    return { error: '[Errno ' + errno + '] ' + strerror(e) + ': ' + pyRepr(schemaPath) };
  }
  let text;
  try {
    text = decodeUtf8(raw);
  } catch {
    return { error: "'utf-8' codec can't decode the schema: invalid UTF-8" };
  }
  try {
    return { schema: strictLoads(text.replaceAll('\r\n', '\n').replaceAll('\r', '\n')) };
  } catch (e) {
    if (e instanceof Refusal || e instanceof JSONDecodeError || e instanceof PyRecursionError || e instanceof PyValueError) {
      return { error: e.message };
    }
    throw e;
  }
}

// -- the #192 classes -------------------------------------------------------------------------------

/**
 * The value at a "$.a.b[0]" path, or null, as the original's _at: re.findall over the path, so text that
 * matches neither form is skipped.
 * @param {Json} doc @param {string} where
 * @returns {Json}
 */
function at(doc, where) {
  /** @type {Json} */
  let value = doc;
  for (const m of where.slice(1).matchAll(/\.([A-Za-z0-9_$-]+)|\[(\d+)\]/g)) {
    const [, name, index] = m;
    if (name !== undefined) {
      if (!(value instanceof Map) || !value.has(name)) return null;
      value = /** @type {Json} */ (value.get(name));
    } else if (Array.isArray(value) || typeof value === 'string') {
      const k = Number(index);
      // Python indexes a str by code point.
      const items = typeof value === 'string' ? [...value] : value;
      if (k >= items.length) return null;
      value = items[k];
    } else {
      return null;
    }
  }
  return value;
}

/**
 * The failure class #192 (and #245) names that an error at a path falls in.
 * @param {string} where @param {string} keyword @param {Json} doc
 */
export function classify(where, keyword, doc) {
  const higher = SEVERITIES.slice(1);
  if (where === '$.schema_version') return 'unknown version';
  if (where.startsWith('$.risk_classification')) return 'missing or invalid risk classification';
  if (where.startsWith('$.approval')) return 'risk-based approval weakened';
  if (where === '$.coverage.threshold_percent' && keyword === 'minimum') return 'coverage below the mhw floor of 85 percent';
  if (where.startsWith('$.baseline_override')) return 'baseline override invalid (it may only add)';
  if (where.startsWith('$.mandatory_scenarios') || where.startsWith('$.coverage')) return 'missing mandatory evidence';
  if (where.startsWith('$.madr')) return 'project MADR not ratified';
  if (where === '$.severity.inconclusive') return 'inconclusive evidence does not block';
  if (where.startsWith('$.severity.tolerated')) {
    const value = at(doc, where);
    if (typeof value === 'string' && higher.includes(value)) return 'medium-or-higher findings tolerated';
    if (keyword === 'maxItems' && Array.isArray(value) && value.some((v) => typeof v === 'string' && higher.includes(v))) {
      return 'medium-or-higher findings tolerated';
    }
    return 'unknown severity';
  }
  if (where.startsWith('$.severity')) return 'unknown severity';
  if (where.startsWith('$.low_findings')) return 'low finding without a bug Issue';
  if (where.startsWith('$.recovery')) return 'recovery not prepared';
  return 'contract invalid';
}

/** @typedef {{ year: number, month: number, day: number }} Day */

/** Days since 1970-01-01, proleptic Gregorian. @param {Day} d */
function epochDay({ year, month, day }) {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const mp = (month + 9) % 12;
  const doy = Math.floor((153 * mp + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146097 + doe - 719468;
}

/** @param {number} year @param {number} month */
function daysIn(year, month) {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

/** The local date today. @returns {Day} */
export function localToday() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() };
}

/**
 * What the schema's pattern cannot say: last_tested is a real date, and not a future one.
 * @param {Map<string, Json>} doc @param {Day} today
 * @returns {Finding[]}
 */
export function semanticErrors(doc, today) {
  /** @type {Finding[]} */
  const errors = [];
  const recovery = doc.get('recovery');
  const runbook = recovery instanceof Map ? recovery.get('runbook') : null;
  const tested = runbook instanceof Map ? runbook.get('last_tested') : null;
  if (typeof tested === 'string' && /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(tested)) {
    const [year, month, day] = tested.split('-').map(Number);
    if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) {
      errors.push(['$.recovery.runbook.last_tested', 'date']);
    } else if (epochDay({ year, month, day }) > epochDay(today) + 1) {
      // One day of slack: a runbook tested today in a time zone ahead of this clock.
      errors.push(['$.recovery.runbook.last_tested', 'future']);
    }
  }
  return errors;
}

/** @param {Finding} a @param {Finding} b */
const byFinding = (a, b) => codepointCompare(a[0], b[0]) || codepointCompare(a[1], b[1]);

/**
 * The check: { code, lines }, 0 and one OK line only when the file is a valid contract.
 * @param {string} p
 * @param {string} [schemaPath]
 * @param {Day} [today]
 * @returns {{ code: number, lines: string[] }}
 */
export function check(p, schemaPath = SCHEMA, today = undefined) {
  // The same strict parse as the project file: a NaN or Infinity bound, or a repeated key, in the
  // validator's own schema would otherwise loosen a check silently (a NaN maximum passes 1000).
  const read0 = readSchema(schemaPath);
  if (read0.error !== undefined) return { code: 2, lines: ['ERROR  cannot read the contract schema: ' + read0.error] };
  const schema = /** @type {Json} */ (read0.schema);
  try {
    validateSchema(schema);
  } catch (e) {
    return cannotEvaluate(e);
  }
  let doc;
  try {
    doc = read(p);
  } catch (e) {
    if (e instanceof Refusal) return { code: 1, lines: ['FAIL  ' + e.message] };
    throw e;
  }
  if (!(doc instanceof Map)) return { code: 1, lines: ['FAIL  malformed: the contract is a JSON object, this file is not'] };
  if (!doc.has('schema_version')) return { code: 1, lines: ['FAIL  unknown version: no schema_version'] };
  const version = /** @type {Json} */ (doc.get('schema_version'));
  if (typeof version === 'boolean' || !KNOWN_VERSIONS.some((v) => isNumeric(version) && pyEq(version, v))) {
    return {
      code: 1,
      lines: ['FAIL  unknown version: schema_version ' + pyDumps(version) + '; this validator knows '
        + KNOWN_VERSIONS.map(String).join(', ')],
    };
  }
  /** @type {Finding[]} */
  let errors;
  try {
    errors = evaluate(doc, schema);
  } catch (e) {
    // A schema this evaluator cannot apply is no answer: never a pass, and not a contract failure.
    return cannotEvaluate(e);
  }
  errors.push(...semanticErrors(doc, today || localToday()));
  if (!errors.length) {
    return { code: 0, lines: ['OK  ' + p + ' is a valid project-policy contract, schema_version ' + String(version)] };
  }
  const unique = [...new Map(errors.map((e) => [e[0] + '\u0000' + e[1], e])).values()].sort(byFinding);
  const lines = unique.map(([where, keyword]) => 'FAIL  ' + where + ': ' + keyword + ' (' + classify(where, keyword, doc) + ')');
  return { code: 1, lines: [...lines, 'FAIL  ' + lines.length + ' finding(s); the contract is not valid'] };
}

/** @param {unknown} e */
function cannotEvaluate(e) {
  if (e instanceof SchemaError || e instanceof PyRecursionError) {
    return { code: 2, lines: ['ERROR  the validator cannot evaluate its schema: ' + e.pyName + ': ' + e.message] };
  }
  // A schema nested deeper than this stack: CPython's walk raised RecursionError there, also exit 2.
  if (e instanceof RangeError) {
    return { code: 2, lines: ['ERROR  the validator cannot evaluate its schema: RecursionError: maximum recursion depth exceeded'] };
  }
  throw e;
}

// -- the command line -------------------------------------------------------------------------------

/**
 * str(Path(dir) / name) as pathlib writes it: separators collapsed, "." parts dropped, a trailing
 * separator removed; on Windows with backslashes, the drive and root kept.
 * @param {string} dir @param {string} name @param {string} platform
 */
export function pathlibJoin(dir, name, platform) {
  if (platform === 'win32') {
    const s = dir.replaceAll('/', '\\');
    const m = /^(\\\\[^\\]+\\[^\\]+|[A-Za-z]:)?(\\)?/.exec(s);
    const prefix = (m && m[0]) || '';
    const parts = s.slice(prefix.length).split('\\').filter((x) => x && x !== '.');
    const head = m && m[1] && m[1].startsWith('\\\\') && !m[2] ? m[1] + '\\' : prefix;
    return head + [...parts, name].join('\\');
  }
  let root = '';
  if (dir.startsWith('//') && !dir.startsWith('///')) root = '//';
  else if (dir.startsWith('/')) root = '/';
  const parts = dir.split('/').filter((x) => x && x !== '.');
  return root + [...parts, name].join('/');
}

/** @param {number} fd @param {string[]} lines */
function emit(fd, lines) {
  if (lines.length) fs.writeSync(fd, lines.join('\n') + '\n');
}

/**
 * `mhw policy <rest>`: only `check` exists. The CLI calls this with what follows `policy`.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} [_env]
 * @param {{ platform?: string, today?: Day, schema?: string }} [opts]
 * @returns {number}
 */
export function main(argv, _env = {}, opts = {}) {
  if (!argv.length || argv[0] !== 'check') {
    emit(2, ['mhw: policy takes one subcommand, check [--project=DIR | --file=PATH]']);
    return 2;
  }
  return checkMain(argv.slice(1), opts);
}

/**
 * `mhw policy check [--project=DIR | --file=PATH]`.
 * @param {string[]} args
 * @param {{ platform?: string, today?: Day, schema?: string }} [opts]
 */
export function checkMain(args, opts = {}) {
  let project = null;
  let file = null;
  for (const arg of args) {
    if (arg.startsWith(PROJECT_OPT) && arg !== PROJECT_OPT) project = arg.slice(PROJECT_OPT.length);
    else if (arg.startsWith(FILE_OPT) && arg !== FILE_OPT) file = arg.slice(FILE_OPT.length);
    else {
      emit(2, ['mhw policy check: unknown argument ' + arg + ' (--project=DIR or --file=PATH)']);
      return 2;
    }
  }
  if (project !== null && file !== null) {
    emit(2, ['mhw policy check: --project and --file exclude each other']);
    return 2;
  }
  const target = file !== null ? file : pathlibJoin(project || '.', FILE_NAME, opts.platform || process.platform);
  const { code, lines } = check(target, opts.schema || SCHEMA, opts.today);
  emit(code === 0 ? 1 : 2, lines);
  return code;
}
