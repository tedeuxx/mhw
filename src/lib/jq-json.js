// JSON read and written the way jq 1.7.1 does it (#490, S19 of #470), for the settings files whose shell
// steps were jq programs. Objects are Maps, so key order is kept exactly as jq keeps it (insertion order,
// a repeated key keeping its first position and its last value, integer-like keys never moved), and a
// number is a JqNumber holding its literal, printed as jq 1.7.1 prints a literal it did not compute: the
// decNumber scientific string (1e2 -> 1E+2, 0.10 -> 0.10, 0.00000012 -> 1.2E-7). Strings are escaped as
// jq escapes them: the JSON escapes, every other control character and DEL as \u00xx, nothing else.
// Measured against jq-1.7.1 on 2026-11-19. The reader refuses what jq refuses; what jq reads and JSON does
// not (NaN, a byte-order mark, several documents, 01 ...) it refuses too, and classify() names that case so a
// caller can refuse it visibly (PR #519 QA B1). node: modules only.

export class JqNumber {
  /** @param {string} raw the literal as written */
  constructor(raw) {
    this.raw = raw;
  }

  /** The value as a double, for comparison. */
  valueOf() {
    return Number(this.raw);
  }
}

/** @typedef {null | boolean | string | JqNumber | JqValue[] | Map<string, any>} JqValue */

export class JqParseError extends Error {}

const WS = new Set([' ', '\t', '\n', '\r']);
/** The one-character escapes of a JSON string. @type {Record<string, string>} */
const SIMPLE = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
/** How quote() writes each character JSON escapes by name. @type {Record<string, string>} */
const NAMED = { '"': String.raw`\"`, '\\': String.raw`\\`, '\n': String.raw`\n`, '\t': String.raw`\t`, '\r': String.raw`\r`, '\b': String.raw`\b`, '\f': String.raw`\f` };

/** jq 1.7.1's parser stack limit: containers open plus object keys pending (measured: 256 nested arrays
 * parse and 257 do not; an object counts its pending key too, so {"a": 254 arrays} parses and 255 do not). */
export const MAX_DEPTH = 256;
const STRUCTURAL = new Set(['[', ']', '{', '}', ',', ':', '"']);
/** The literals jq's lexer reads as a number beyond JSON's: nan, inf and infinity in any case, a sign,
 * leading zeros, a bare fraction or exponent dot (measured on jq-1.7.1). */
const JQ_NUMBER = /^[+-]?(?:(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?|nan\d*|inf(?:inity)?)$/i;

/**
 * Parse one JSON document as jq 1.7.1 accepts it, and refuse with a JqParseError what jq refuses:
 * a high surrogate escape not followed by a low one, nesting past jq's stack (MAX_DEPTH), and anything
 * that is not JSON. A lone low surrogate escape reads as U+FFFD, as jq prints it.
 *
 * { jqOnly: true } accepts, in addition, what jq reads and JSON does not: one leading byte-order mark,
 * input cut at the first NUL, several documents in a row, and jq's number literals (NaN, Infinity, 01,
 * .5, 1., +1 and the like; each reads as null here, since nothing uses the value). It exists only to tell
 * "jq would have read this file" from "nobody can", and returns the last document.
 * @param {string} text
 * @param {{ jqOnly?: boolean }} [opts]
 * @returns {JqValue}
 */
export function parse(text, opts = {}) {
  const lenient = opts.jqOnly === true;
  let src = text;
  if (lenient) {
    if (src.startsWith('﻿')) src = src.slice(1);
    const nul = src.indexOf('\u0000');
    if (nul >= 0) src = src.slice(0, nul);
  }
  let i = 0;
  let stack = 0;
  const fail = (/** @type {string} */ why) => {
    throw new JqParseError(why + ' at offset ' + i);
  };
  const skip = () => {
    while (i < src.length && WS.has(src[i])) i++;
  };
  const open = () => {
    if (stack >= MAX_DEPTH) fail('exceeds the depth limit');
    stack++;
  };
  /** A bare literal: true, false, null, a JSON number, or (jqOnly) one of jq's own number literals. @returns {JqValue} */
  const literal = () => {
    const start = i;
    while (i < src.length && !WS.has(src[i]) && !STRUCTURAL.has(src[i])) i++;
    const token = src.slice(start, i);
    if (token === 'true') return true;
    if (token === 'false') return false;
    if (token === 'null') return null;
    if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(token)) return new JqNumber(token);
    if (lenient && JQ_NUMBER.test(token)) return null;
    i = start;
    return fail('unexpected character');
  };
  /** @returns {JqValue} */
  const value = () => {
    skip();
    const c = src[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    return literal();
  };
  const object = () => {
    open();
    /** @type {Map<string, JqValue>} */
    const m = new Map();
    i++;
    skip();
    if (src[i] === '}') {
      i++;
      stack--;
      return m;
    }
    for (;;) {
      skip();
      if (src[i] !== '"') fail('expected a key');
      const k = string();
      skip();
      if (src[i] !== ':') fail('expected a colon');
      i++;
      stack++;
      m.set(k, value());
      stack--;
      skip();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === '}') {
        i++;
        stack--;
        return m;
      }
      fail('expected , or }');
    }
  };
  const array = () => {
    open();
    /** @type {JqValue[]} */
    const a = [];
    i++;
    skip();
    if (src[i] === ']') {
      i++;
      stack--;
      return a;
    }
    for (;;) {
      a.push(value());
      skip();
      if (src[i] === ',') {
        i++;
        continue;
      }
      if (src[i] === ']') {
        i++;
        stack--;
        return a;
      }
      fail('expected , or ]');
    }
  };
  /** Four hex digits after \u at i; returns the code unit. */
  const unit = () => {
    const hex = src.slice(i + 2, i + 6);
    if (src[i + 1] !== 'u' || !/^[0-9A-Fa-f]{4}$/.test(hex)) fail(String.raw`bad \u escape`);
    i += 6;
    return Number.parseInt(hex, 16);
  };
  /** One escape at src[i] (the backslash): the character it stands for. @returns {string} */
  const escape = () => {
    const e = src[i + 1] ?? '';
    if (Object.hasOwn(SIMPLE, e)) {
      i += 2;
      return SIMPLE[e];
    }
    if (e !== 'u') return fail('bad escape');
    const u = unit();
    if (u >= 0xdc00 && u <= 0xdfff) return '�';
    if (u < 0xd800 || u > 0xdbff) return String.fromCodePoint(u);
    // jq refuses a high surrogate escape unless a low surrogate escape follows it at once.
    if (src[i] !== '\\') fail('unpaired high surrogate');
    const low = unit();
    if (low < 0xdc00 || low > 0xdfff) fail('unpaired high surrogate');
    return String.fromCodePoint(0x10000 + ((u - 0xd800) << 10) + (low - 0xdc00));
  };
  const string = () => {
    i++;
    let out = '';
    for (;;) {
      if (i >= src.length) fail('unterminated string');
      const c = src[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c < ' ') fail('control character in a string');
      if (c === '\\') out += escape();
      else {
        out += c;
        i++;
      }
    }
  };
  let v = value();
  skip();
  while (lenient && i < src.length) {
    v = value();
    skip();
  }
  if (i !== src.length) fail('trailing content');
  return v;
}

/**
 * What became of reading a file the allow-list step acts on: 'json' (strict JSON, the value given),
 * 'jq-only' (jq 1.7.1 would have read it, this reader does not: refuse visibly) or 'unreadable' (jq
 * refuses it too: the shell step said nothing, and neither does this).
 * @param {string} text
 * @returns {{ kind: 'json', value: JqValue } | { kind: 'jq-only' | 'unreadable' }}
 */
export function classify(text) {
  try {
    return { kind: 'json', value: parse(text) };
  } catch (e) {
    if (!(e instanceof JqParseError)) throw e;
  }
  try {
    parse(text, { jqOnly: true });
    return { kind: 'jq-only' };
  } catch (e) {
    if (!(e instanceof JqParseError)) throw e;
    return { kind: 'unreadable' };
  }
}

/**
 * The decNumber scientific string of a JSON number literal, as jq 1.7.1 prints a literal.
 * @param {string} raw
 */
export function formatNumber(raw) {
  let s = raw;
  let sign = '';
  if (s.startsWith('-')) {
    sign = '-';
    s = s.slice(1);
  }
  let exp = 0;
  const ePos = Math.max(s.indexOf('e'), s.indexOf('E'));
  if (ePos >= 0) {
    exp = Number.parseInt(s.slice(ePos + 1), 10);
    s = s.slice(0, ePos);
  }
  const dot = s.indexOf('.');
  if (dot >= 0) {
    exp -= s.length - dot - 1;
    s = s.slice(0, dot) + s.slice(dot + 1);
  }
  let k = 0;
  while (k < s.length - 1 && s[k] === '0') k++;
  const digits = s.slice(k);
  const adjusted = exp + digits.length - 1;
  if (exp <= 0 && adjusted >= -6) {
    if (exp === 0) return sign + digits;
    const point = digits.length + exp;
    if (point > 0) return sign + digits.slice(0, point) + '.' + digits.slice(point);
    return sign + '0.' + '0'.repeat(-point) + digits;
  }
  const rest = digits.length > 1 ? '.' + digits.slice(1) : '';
  return sign + digits[0] + rest + 'E' + (adjusted < 0 ? '-' : '+') + Math.abs(adjusted);
}

/** @param {string} s */
export function quote(s) {
  let out = '"';
  for (const ch of s) {
    const c = ch.codePointAt(0) || 0;
    if (Object.hasOwn(NAMED, ch)) out += NAMED[ch];
    else if (c < 0x20 || c === 0x7f) out += String.raw`\u` + c.toString(16).padStart(4, '0');
    else out += ch;
  }
  return out + '"';
}

/** Codepoint order, as jq sorts object keys. @param {string} a @param {string} b */
export function codepointCompare(a, b) {
  const x = [...a];
  const y = [...b];
  for (let k = 0; k < Math.min(x.length, y.length); k++) {
    const d = (x[k].codePointAt(0) || 0) - (y[k].codePointAt(0) || 0);
    if (d) return d;
  }
  return x.length - y.length;
}

/**
 * Serialise as jq does: `jq --indent N .` (sortKeys false) or `jq -S .` (indent 2, sortKeys true).
 * No trailing newline.
 * @param {JqValue} v
 * @param {{ indent?: number, sortKeys?: boolean }} [opts]
 */
export function stringify(v, opts = {}) {
  const ind = opts.indent ?? 2;
  /** @param {JqValue} x @param {string} pad @returns {string} */
  const go = (x, pad) => {
    if (x === null) return 'null';
    if (x === true) return 'true';
    if (x === false) return 'false';
    if (typeof x === 'string') return quote(x);
    if (x instanceof JqNumber) return formatNumber(x.raw);
    const inner = pad + ' '.repeat(ind);
    if (Array.isArray(x)) {
      if (!x.length) return '[]';
      return '[\n' + x.map((e) => inner + go(e, inner)).join(',\n') + '\n' + pad + ']';
    }
    const keys = [...x.keys()];
    if (opts.sortKeys) keys.sort(codepointCompare);
    if (!keys.length) return '{}';
    return '{\n' + keys.map((k) => inner + quote(k) + ': ' + go(x.get(k), inner)).join(',\n') + '\n' + pad + '}';
  };
  return go(v, '');
}

/** jq's type name. @param {JqValue | undefined} v */
export function typeOf(v) {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'string') return 'string';
  if (v instanceof JqNumber) return 'number';
  if (Array.isArray(v)) return 'array';
  return 'object';
}

/**
 * jq equality: numbers by value, objects regardless of key order.
 * @param {JqValue | undefined} a
 * @param {JqValue | undefined} b
 * @returns {boolean}
 */
export function equal(a, b) {
  const ta = typeOf(a);
  if (ta !== typeOf(b)) return false;
  if (ta === 'number') return Number(a) === Number(b);
  if (ta === 'array') {
    const x = /** @type {JqValue[]} */ (a);
    const y = /** @type {JqValue[]} */ (b);
    return x.length === y.length && x.every((e, k) => equal(e, y[k]));
  }
  if (ta === 'object') {
    const x = /** @type {Map<string, JqValue>} */ (a);
    const y = /** @type {Map<string, JqValue>} */ (b);
    return x.size === y.size && [...x.keys()].every((k) => y.has(k) && equal(x.get(k), y.get(k)));
  }
  return (a ?? null) === (b ?? null);
}

/** jq's `index($x) != null` on an array: whether some element equals x. @param {JqValue[]} list @param {JqValue} x */
export function contains(list, x) {
  return list.some((e) => equal(e, x));
}

/** jq's `a // b`: b when a is null, false or missing. @param {JqValue | undefined} a @param {JqValue} b */
export function alt(a, b) {
  return a === null || a === false || a === undefined ? b : a;
}

/** `.key` on an object, null otherwise (the caller checks the shape first). @param {JqValue | undefined} o @param {string} k */
export function get(o, k) {
  return o instanceof Map ? (o.get(k) ?? null) : null;
}
