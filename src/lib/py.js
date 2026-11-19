// The few Python semantics the method scripts' outputs depend on, so their Node forms print the same
// bytes (#476, S05 of #470). worklog's report is published and hashed: a digest over a JSON rendering
// changes with one float printed as `13` instead of `13.0`, one key sorted by UTF-16 unit instead of code
// point, or one character Python counts as whitespace and JavaScript does not. Each function names the
// CPython behaviour it reproduces; test/lib/py.test.js holds each against values recorded from CPython
// 3.14 (test/golden/S05/py-*.json).
//
// What is not reproduced, and is named rather than hidden: nesting deep enough to raise CPython's
// RecursionError, an integer literal of more than 4300 digits (CPython's int limit), a lone surrogate
// reaching an output (CPython raises UnicodeEncodeError), and Unicode-version differences between
// CPython's unicodedata and Node's ICU in the `\w` class. node: modules only.

/** A JSON number that CPython reads as a float: kept apart from an int, which prints without `.0`. */
export class PyFloat {
  /** @param {number} v */
  constructor(v) {
    this.v = v;
  }
}

/** CPython's str.isspace() set (CPython 3.14, Unicode 16.0; measured over every code point). */
const PY_WS = new Set([
  0x9, 0xa, 0xb, 0xc, 0xd, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x85, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003,
  0x2004, 0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000,
]);

/** @param {string | undefined} ch one code point */
export const isPyWs = (ch) => ch !== undefined && ch !== '' && PY_WS.has(/** @type {number} */ (ch.codePointAt(0)));

/** @param {string} s @returns {string[]} the code points */
export const codePoints = (s) => Array.from(s);

/** Python len(): code points, not UTF-16 units. @param {string} s */
export const pyLen = (s) => codePoints(s).length;

/** Python str.strip() with no argument. @param {string} s */
export function pyStrip(s) {
  const cps = codePoints(s);
  let a = 0;
  let b = cps.length;
  while (a < b && isPyWs(cps[a])) a++;
  while (b > a && isPyWs(cps[b - 1])) b--;
  return cps.slice(a, b).join('');
}

/**
 * Python's ordering of str: by code point (JavaScript's default compares UTF-16 units, which disagrees
 * for a character above U+FFFF against one in U+E000-U+FFFF).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function cmpStr(a, b) {
  if (a === b) return 0;
  const x = codePoints(a);
  const y = codePoints(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const d = /** @type {number} */ (x[i].codePointAt(0)) - /** @type {number} */ (y[i].codePointAt(0));
    if (d) return d < 0 ? -1 : 1;
  }
  return x.length - y.length < 0 ? -1 : 1;
}

/** @param {unknown} v Python `type(v) is int` (bool excluded) */
export const isInt = (v) => (typeof v === 'number' && Number.isInteger(v)) || typeof v === 'bigint';
/** @param {unknown} v Python `type(v) is float` */
export const isFloat = (v) => v instanceof PyFloat;
/** @param {unknown} v Python `isinstance(v, dict)` for a parsed JSON value */
export const isDict = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PyFloat);
/** @param {unknown} v @returns {number} the numeric value of an int or a float */
export const num = (v) => (v instanceof PyFloat ? v.v : Number(v));

/** An int that stays exact: a number while safe, a BigInt beyond. @param {bigint} b @returns {number | bigint} */
const normInt = (b) => (b >= BigInt(Number.MIN_SAFE_INTEGER) && b <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(b) : b);

/** Python int + int. @param {number | bigint} a @param {number | bigint} b @returns {number | bigint} */
export function addInt(a, b) {
  return normInt(BigInt(a) + BigInt(b));
}

/** Python int * int. @param {number | bigint} a @param {number | bigint} b @returns {number | bigint} */
export function mulInt(a, b) {
  return normInt(BigInt(a) * BigInt(b));
}

/**
 * Python's builtin sum(values) of ints and floats, start 0 (CPython 3.12+): exact int addition while
 * every item is an int, then Neumaier-compensated float addition, an int in that phase converted to a
 * double and compensated too (CPython 3.14, measured: sum([0.1, 3, 0.2]) is 3.3). Returns an int, or a
 * PyFloat once any float was added.
 * @param {Array<number | bigint | PyFloat>} values
 * @returns {number | bigint | PyFloat}
 */
export function pySum(values) {
  /** @type {number | bigint} */
  let i = 0;
  let k = 0;
  for (; k < values.length; k++) {
    const v = values[k];
    if (v instanceof PyFloat) break;
    i = addInt(i, v);
  }
  if (k === values.length) return i;
  let f = num(i) + /** @type {PyFloat} */ (values[k]).v;
  let c = 0;
  for (k++; k < values.length; k++) {
    const v = values[k];
    const x = num(v);
    const t = f + x;
    if (Math.abs(f) >= Math.abs(x)) c += f - t + x;
    else c += x - t + f;
    f = t;
  }
  if (c && Number.isFinite(c)) f += c;
  return new PyFloat(f);
}

/**
 * float.__repr__: the shortest round-trip digits, fixed notation for a decimal exponent in [-4, 16),
 * scientific beyond with a sign and at least two exponent digits, `.0` on an integral value.
 * @param {number} x
 */
export function floatRepr(x) {
  if (Number.isNaN(x)) return 'NaN';
  if (x === Infinity) return 'Infinity';
  if (x === -Infinity) return '-Infinity';
  if (x === 0) return Object.is(x, -0) ? '-0.0' : '0.0';
  const [m, e] = x.toExponential().split('e');
  const exp = Number(e);
  const digits = m.replace('-', '').replace('.', '');
  const sign = x < 0 ? '-' : '';
  if (exp >= -4 && exp < 16) {
    if (exp >= 0) {
      const whole = digits.slice(0, exp + 1).padEnd(exp + 1, '0');
      return sign + whole + '.' + (digits.slice(exp + 1) || '0');
    }
    return sign + '0.' + '0'.repeat(-exp - 1) + digits;
  }
  const mant = digits.length > 1 ? digits[0] + '.' + digits.slice(1) : digits;
  return sign + mant + 'e' + (exp < 0 ? '-' : '+') + String(Math.abs(exp)).padStart(2, '0');
}

/**
 * Python round(x, n) for a float and 0 <= n <= 15: the exact binary value rounded half to even (the
 * decimal digits CPython's dtoa produces), not JavaScript's half away from zero.
 * @param {number} x
 * @param {number} n
 */
export function pyRound(x, n) {
  if (!Number.isFinite(x) || Math.abs(x) >= 2 ** 52) return x;
  const s = x.toFixed(n); // the exact value rounded, a tie going away from zero
  // A tie is exact only when 2 * x * 10^n is an odd integer.
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  const biased = Number((bits >> 52n) & 0x7ffn);
  let mant = bits & ((1n << 52n) - 1n);
  let e2 = biased - 1075;
  if (biased === 0) e2 = -1074;
  else mant |= 1n << 52n;
  const scaled = (mant < 0n ? -mant : mant) * 2n * 10n ** BigInt(n);
  let tie = false;
  if (e2 < 0) {
    const den = 1n << BigInt(-e2);
    tie = scaled % den === 0n && (scaled / den) % 2n === 1n;
  }
  if (!tie) return Number(s);
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const unit = BigInt(body.replace('.', ''));
  if (unit % 2n === 0n) return Number(s);
  const down = (unit - 1n).toString().padStart(n + 1, '0');
  const fixed = n ? down.slice(0, down.length - n) + '.' + down.slice(down.length - n) : down;
  return Number((neg ? '-' : '') + fixed);
}

export class JsonDecodeError extends Error {}

const JSON_WS = new Set([' ', '\t', '\n', '\r']);
const isDigit = (/** @type {string | undefined} */ c) => c !== undefined && c >= '0' && c <= '9';
/** @type {Record<string, string>} */
const ESCAPES = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };

class StopIteration extends Error {
  /** @param {number} at */
  constructor(at) {
    super('stop');
    this.at = at;
  }
}

/**
 * json.loads(text) as CPython's C scanner reads it (CPython 3.14): NaN and Infinity accepted, an int kept
 * apart from a float (PyFloat), a big int as a BigInt, the last of a duplicate key kept, and a failure
 * raised as JsonDecodeError carrying CPython's own message: "<what>: line L column C (char P)", P in code
 * points. With `ordered`, an object reads as a Map, so its keys keep CPython's insertion order even when
 * they look like integers (a plain object moves those first); dumps() writes a Map in that order.
 * @param {string} text
 * @param {{ ordered?: boolean }} [opts]
 * @returns {unknown}
 */
export function loads(text, opts = {}) {
  const ordered = opts.ordered === true;
  /** A new dict: a Map when ordered. @returns {Record<string, unknown> | Map<string, unknown>} */
  const newDict = () => (ordered ? new Map() : {});
  /** dict[k] = v. @param {Record<string, unknown> | Map<string, unknown>} obj @param {string} k @param {unknown} v */
  const put = (obj, k, v) => {
    if (obj instanceof Map) obj.set(k, v);
    else Object.defineProperty(obj, k, { value: v, writable: true, enumerable: true, configurable: true });
  };
  const s = codePoints(text);
  const len = s.length;
  /** @param {string} msg @param {number} pos */
  const fail = (msg, pos) => {
    let line = 1;
    let last = -1;
    for (let i = 0; i < pos; i++) {
      if (s[i] === '\n') {
        line++;
        last = i;
      }
    }
    return new JsonDecodeError(msg + ': line ' + line + ' column ' + (pos - last) + ' (char ' + pos + ')');
  };
  /** @param {number} i */
  const skip = (i) => {
    while (i < len && JSON_WS.has(s[i])) i++;
    return i;
  };
  /** @param {number} begin the opening quote @returns {[string, number]} */
  const scanString = (begin) => {
    let end = begin + 1;
    let out = '';
    for (;;) {
      let next = end;
      let c = '';
      for (; next < len; next++) {
        c = s[next];
        if (c === '"' || c === '\\') break;
        if (/** @type {number} */ (c.codePointAt(0)) <= 0x1f) throw fail('Invalid control character at', next);
      }
      if (next === len) throw fail('Unterminated string starting at', begin);
      out += s.slice(end, next).join('');
      next++;
      if (c === '"') return [out, next];
      if (next === len) throw fail('Unterminated string starting at', begin);
      c = s[next];
      if (c !== 'u') {
        end = next + 1;
        if (!Object.hasOwn(ESCAPES, c)) throw fail('Invalid \\escape', end - 2);
        out += ESCAPES[c];
        continue;
      }
      next++;
      end = next + 4;
      if (end >= len) throw fail('Invalid \\uXXXX escape', next - 1);
      /** @param {number} from @param {number} to */
      const hex4 = (from, to) => {
        const h = s.slice(from, to).join('');
        if (!/^[0-9a-fA-F]{4}$/.test(h)) throw fail('Invalid \\uXXXX escape', to - 5);
        return Number.parseInt(h, 16);
      };
      let code = hex4(next, end);
      next = end;
      if (code >= 0xd800 && code <= 0xdbff && end + 6 < len && s[next] === '\\' && s[next + 1] === 'u') {
        const c2 = hex4(next + 2, end + 6);
        if (c2 >= 0xdc00 && c2 <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (c2 - 0xdc00);
          end += 6;
        }
      }
      out += String.fromCodePoint(code);
    }
  };
  /** @param {number} start @returns {[unknown, number]} */
  const scanNumber = (start) => {
    let i = start;
    if (s[i] === '-') {
      i++;
      if (i >= len) throw new StopIteration(start);
    }
    if (s[i] >= '1' && s[i] <= '9') {
      i++;
      while (isDigit(s[i])) i++;
    } else if (s[i] === '0') {
      i++;
    } else {
      throw new StopIteration(start);
    }
    let float = false;
    if (i < len - 1 && s[i] === '.' && isDigit(s[i + 1])) {
      float = true;
      i += 2;
      while (isDigit(s[i])) i++;
    }
    if (i < len - 1 && (s[i] === 'e' || s[i] === 'E')) {
      const eStart = i;
      i++;
      if (i < len - 1 && (s[i] === '-' || s[i] === '+')) i++;
      while (isDigit(s[i])) i++;
      if (isDigit(s[i - 1])) float = true;
      else i = eStart;
    }
    const lit = s.slice(start, i).join('');
    if (float) return [new PyFloat(Number(lit)), i];
    return [normInt(BigInt(lit)), i];
  };
  /** @param {number} i @returns {[unknown, number]} */
  const scan = (i) => {
    if (i >= len) throw new StopIteration(i);
    const c = s[i];
    const word = (/** @type {string} */ w) => s.slice(i, i + w.length).join('') === w;
    if (c === '"') return scanString(i);
    if (c === '{') return scanObject(i + 1);
    if (c === '[') return scanArray(i + 1);
    if (c === 'n' && word('null')) return [null, i + 4];
    if (c === 't' && word('true')) return [true, i + 4];
    if (c === 'f' && word('false')) return [false, i + 5];
    if (c === 'N' && word('NaN')) return [new PyFloat(Number.NaN), i + 3];
    if (c === 'I' && word('Infinity')) return [new PyFloat(Infinity), i + 8];
    if (c === '-' && word('-Infinity')) return [new PyFloat(-Infinity), i + 9];
    return scanNumber(i);
  };
  /** @param {number} i after the brace @returns {[unknown, number]} */
  const scanObject = (i) => {
    const obj = newDict();
    i = skip(i);
    if (i >= len || s[i] !== '}') {
      for (;;) {
        if (i >= len || s[i] !== '"') throw fail('Expecting property name enclosed in double quotes', i);
        const [key, after] = scanString(i);
        i = skip(after);
        if (i >= len || s[i] !== ':') throw fail("Expecting ':' delimiter", i);
        i = skip(i + 1);
        const [val, next] = scan(i);
        put(obj, key, val);
        i = skip(next);
        if (i < len && s[i] === '}') break;
        if (i >= len || s[i] !== ',') throw fail("Expecting ',' delimiter", i);
        const comma = i;
        i = skip(i + 1);
        if (i < len && s[i] === '}') throw fail('Illegal trailing comma before end of object', comma);
      }
    }
    return [obj, i + 1];
  };
  /** @param {number} i after the bracket @returns {[unknown, number]} */
  const scanArray = (i) => {
    const arr = [];
    i = skip(i);
    if (i >= len || s[i] !== ']') {
      for (;;) {
        const [val, next] = scan(i);
        arr.push(val);
        i = skip(next);
        if (i < len && s[i] === ']') break;
        if (i >= len || s[i] !== ',') throw fail("Expecting ',' delimiter", i);
        const comma = i;
        i = skip(i + 1);
        if (i < len && s[i] === ']') throw fail('Illegal trailing comma before end of array', comma);
      }
    }
    return [arr, i + 1];
  };
  if (s[0] === '\ufeff') throw fail('Unexpected UTF-8 BOM (decode using utf-8-sig)', 0);
  try {
    const [value, end] = scan(skip(0));
    const rest = skip(end);
    if (rest !== len) throw fail('Extra data', rest);
    return value;
  } catch (e) {
    if (e instanceof StopIteration) throw fail('Expecting value', e.at);
    throw e;
  }
}

/** @type {Record<string, string>} */
const DUMP_ESC = { '\\': '\\\\', '"': '\\"', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

/** json's string encoding. @param {string} s @param {boolean} [ascii] ensure_ascii */
function dumpString(s, ascii = false) {
  let out = '"';
  for (const ch of s) {
    const code = /** @type {number} */ (ch.codePointAt(0));
    if (DUMP_ESC[ch]) out += DUMP_ESC[ch];
    else if (code < 0x20 || (ascii && code > 0x7e && code < 0x10000)) out += '\\u' + code.toString(16).padStart(4, '0');
    else if (ascii && code >= 0x10000) {
      const v = code - 0x10000;
      out += '\\u' + (0xd800 + (v >> 10)).toString(16) + '\\u' + (0xdc00 + (v & 0x3ff)).toString(16);
    } else out += ch;
  }
  return out + '"';
}

/**
 * json.dumps(value, ...) as CPython renders it. The defaults are the worklog's: sort_keys=True,
 * ensure_ascii=False, and the separators json picks (", " and ": " with no indent are CPython's own
 * default, "," and ":" the worklog's canonical form, "," and ": " with an indent). A value that is not
 * JSON throws. DEL (U+007F) is escaped under ensure_ascii and kept otherwise, as CPython does.
 * @param {unknown} value
 * @param {{ indent?: number, sortKeys?: boolean, separators?: [string, string], ensureAscii?: boolean }} [opts]
 */
export function dumps(value, opts = {}) {
  const indent = opts.indent;
  const sortKeys = opts.sortKeys !== false;
  const ascii = opts.ensureAscii === true;
  const [item, key] = opts.separators || (indent === undefined ? [',', ':'] : [',', ': ']);
  /** @param {unknown} v @param {number} depth @returns {string} */
  const enc = (v, depth) => {
    if (v === null || v === undefined) return 'null';
    if (v === true) return 'true';
    if (v === false) return 'false';
    if (v instanceof PyFloat) return floatRepr(v.v);
    if (typeof v === 'number' || typeof v === 'bigint') return String(v);
    if (typeof v === 'string') return dumpString(v, ascii);
    const nl = indent === undefined ? '' : '\n' + ' '.repeat(indent * (depth + 1));
    const close = indent === undefined ? '' : '\n' + ' '.repeat(indent * depth);
    if (Array.isArray(v)) {
      if (!v.length) return '[]';
      return '[' + v.map((x) => nl + enc(x, depth + 1)).join(item) + close + ']';
    }
    if (typeof v !== 'object') throw new TypeError('not JSON serializable');
    // A Map (an ordered loads()) and a plain object are both a dict; only the entries differ.
    const entries = v instanceof Map ? [...v.entries()] : Object.entries(/** @type {Record<string, unknown>} */ (v));
    if (sortKeys) entries.sort((a, b) => cmpStr(a[0], b[0]));
    if (!entries.length) return '{}';
    return '{' + entries.map(([k, x]) => nl + dumpString(k, ascii) + key + enc(x, depth + 1)).join(item) + close + '}';
  };
  return enc(value, 0);
}

const NONPRINT = /[\p{Cc}\p{Cf}\p{Cs}\p{Co}\p{Cn}\p{Zl}\p{Zp}\p{Zs}]/u;

/** repr(str). @param {string} s */
function reprString(s) {
  const q = s.includes("'") && !s.includes('"') ? '"' : "'";
  let out = q;
  for (const ch of s) {
    const code = /** @type {number} */ (ch.codePointAt(0));
    if (ch === q || ch === '\\') out += '\\' + ch;
    else if (ch === '\t') out += '\\t';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (code < 0x20 || code === 0x7f) out += '\\x' + code.toString(16).padStart(2, '0');
    else if (code > 0x7f && ch !== ' ' && NONPRINT.test(ch)) {
      if (code < 0x100) out += '\\x' + code.toString(16).padStart(2, '0');
      else if (code < 0x10000) out += '\\u' + code.toString(16).padStart(4, '0');
      else out += '\\U' + code.toString(16).padStart(8, '0');
    } else out += ch;
  }
  return out + q;
}

/**
 * repr() of a parsed JSON value. A dict's keys print in JavaScript's own key order, which differs from
 * CPython's insertion order only for integer-like keys.
 * @param {unknown} v
 * @returns {string}
 */
export function pyRepr(v) {
  if (v === null || v === undefined) return 'None';
  if (v === true) return 'True';
  if (v === false) return 'False';
  if (v instanceof PyFloat) {
    const r = floatRepr(v.v);
    return r === 'NaN' ? 'nan' : r === 'Infinity' ? 'inf' : r === '-Infinity' ? '-inf' : r;
  }
  if (typeof v === 'number' || typeof v === 'bigint') return String(v);
  if (typeof v === 'string') return reprString(v);
  if (Array.isArray(v)) return '[' + v.map(pyRepr).join(', ') + ']';
  const o = /** @type {Record<string, unknown>} */ (v);
  return '{' + Object.keys(o).map((k) => reprString(k) + ': ' + pyRepr(o[k])).join(', ') + '}';
}

/** f"{v}" / str(v) of a scalar the report prints. @param {unknown} v */
export function pyStr(v) {
  if (v === null || v === undefined) return 'None';
  if (v instanceof PyFloat) {
    const r = floatRepr(v.v);
    return r === 'NaN' ? 'nan' : r === 'Infinity' ? 'inf' : r === '-Infinity' ? '-inf' : r;
  }
  if (typeof v === 'string') return v;
  return pyRepr(v);
}

/** A deep copy of a parsed JSON value (PyFloat kept). @template T @param {T} v @returns {T} */
export function deepCopy(v) {
  if (Array.isArray(v)) return /** @type {T} */ (/** @type {unknown} */ (v.map(deepCopy)));
  if (v instanceof PyFloat) return /** @type {T} */ (/** @type {unknown} */ (new PyFloat(v.v)));
  if (v && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const [k, x] of Object.entries(v)) {
      Object.defineProperty(out, k, { value: deepCopy(x), writable: true, enumerable: true, configurable: true });
    }
    return /** @type {T} */ (/** @type {unknown} */ (out));
  }
  return v;
}

/** @param {number} y */
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** @param {number} y @param {number} m */
const daysIn = (y, m) => [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
/** Days from 0001-01-01 (proleptic Gregorian, day 1). @param {number} y @param {number} m @param {number} d */
function ordinal(y, m, d) {
  const py = y - 1;
  let days = py * 365 + Math.floor(py / 4) - Math.floor(py / 100) + Math.floor(py / 400);
  for (let i = 1; i < m; i++) days += daysIn(y, i);
  return days + d;
}
/** 0 = Monday. @param {number} y @param {number} m @param {number} d */
const weekday = (y, m, d) => (ordinal(y, m, d) + 6) % 7;

class IsoError extends Error {}
const MAX_ORDINAL = ordinal(9999, 12, 31);

/** @param {string} t @param {number} from @param {number} n */
function digits(t, from, n) {
  const part = t.slice(from, from + n);
  if (part.length !== n || !/^[0-9]+$/.test(part)) throw new IsoError('digits');
  return Number(part);
}

/** @param {string} d the date part, length 7, 8 or 10 @returns {number} the ordinal day */
function isoDate(d) {
  const year = digits(d, 0, 4);
  const sep = d[4] === '-';
  let pos = 4 + (sep ? 1 : 0);
  if (d[pos] === 'W') {
    pos++;
    const week = digits(d, pos, 2);
    pos += 2;
    let day = 1;
    if (d.length > pos) {
      if ((d[pos] === '-') !== sep) throw new IsoError('dash');
      pos += sep ? 1 : 0;
      day = digits(d, pos, 1);
      if (d.length > pos + 1) throw new IsoError('length');
    }
    if (year < 1 || week < 1 || week > 53 || day < 1 || day > 7) throw new IsoError('week');
    if (week === 53) {
      const first = weekday(year, 1, 1);
      if (!(first === 3 || (first === 2 && leap(year)))) throw new IsoError('week');
    }
    const jan4 = ordinal(year, 1, 4);
    const monday1 = jan4 - weekday(year, 1, 4);
    return monday1 + (week - 1) * 7 + (day - 1);
  }
  const month = digits(d, pos, 2);
  pos += 2;
  if ((d[pos] === '-') !== sep) throw new IsoError('dash');
  pos += sep ? 1 : 0;
  const day = digits(d, pos, 2);
  if (d.length !== pos + 2) throw new IsoError('length');
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > daysIn(year, month)) throw new IsoError('range');
  return ordinal(year, month, day);
}

/**
 * CPython's parse_hh_mm_ss_ff over t[from, end): HH[:?MM[:?SS[{.,}f{1,6}]]], where t[end] (or the end of
 * the string, read as NUL) is the character after the region. Returns the four components and whether the
 * parse stopped before the end of the string (1) or at it (0); a negative CPython return throws.
 * @param {string} t
 * @param {number} from
 * @param {number} end
 * @returns {{ comps: number[], rest: boolean }}
 */
function hhmmss(t, from, end) {
  const at = (/** @type {number} */ i) => (i < t.length ? t[i] : '\0');
  const two = (/** @type {number} */ i) => {
    if (!isDigit(at(i)) || !isDigit(at(i + 1))) throw new IsoError('digits');
    return Number(at(i) + at(i + 1));
  };
  const comps = [0, 0, 0, 0];
  let p = from;
  let sep = true;
  let i = 0;
  for (; i < 3; i++) {
    comps[i] = two(p);
    p += 2;
    const c = at(p++);
    if (i === 0) sep = c === ':';
    if (p >= end) return { comps, rest: c !== '\0' };
    if (sep && c === ':') {
      if (i === 2) throw new IsoError('sep');
      continue;
    }
    if (c === '.' || c === ',') {
      if (i < 2) throw new IsoError('decimal');
      break;
    }
    if (sep) throw new IsoError('sep');
    p--;
  }
  const toParse = Math.min(end - p, 6);
  let micro = 0;
  for (let k = 0; k < toParse; k++) {
    if (!isDigit(at(p + k))) throw new IsoError('digits');
    micro = micro * 10 + Number(at(p + k));
  }
  p += toParse;
  comps[3] = micro * 10 ** (6 - toParse);
  while (isDigit(at(p))) p++;
  return { comps, rest: at(p) !== '\0' };
}

/** The separator position after the date part (CPython's _find_isoformat_datetime_separator). @param {string} s */
function separatorAt(s) {
  const n = s.length;
  if (n === 7) return 7;
  if (s[4] === '-') {
    if (s[5] !== 'W') return 10;
    if (n < 8) throw new IsoError('short');
    if (n > 8 && s[8] === '-') {
      if (n === 9) throw new IsoError('short');
      if (n > 10 && isDigit(s[10])) return 8;
      return 10;
    }
    return 8;
  }
  if (s[4] === 'W') {
    let i = 7;
    while (i < n && isDigit(s[i])) i++;
    if (i < 9) return i;
    return i % 2 === 0 ? 7 : 8;
  }
  return 8;
}

/**
 * datetime.fromisoformat(s) as CPython 3.14 reads it, reduced to what the worklog compares: the instant
 * in microseconds and whether the value carries an offset. Throws when CPython raises ValueError.
 * @param {string} input
 * @returns {{ us: bigint, aware: boolean }}
 */
export function fromIsoformat(input) {
  // Every non-ASCII code point becomes one U+0080: CPython indexes code points, and no part of the grammar
  // but the separator may be anything other than ASCII.
  const s = codePoints(input).map((c) => (c.length > 1 || c > '\x7f' ? '\x80' : c)).join('');
  try {
    if (s.length < 7) throw new IsoError('short');
    const at = separatorAt(s);
    const day = isoDate(s.slice(0, at));
    const tstr = s.slice(at + 1);
    if (s.length > at && !tstr) throw new IsoError('empty time');
    let us = 0n;
    let aware = false;
    let dayShift = 0;
    if (tstr) {
      // CPython's parse_isoformat_time: the offset starts at the first of Z, + or -.
      let tz = 0;
      while (tz < tstr.length && !'Z+-'.includes(tstr[tz])) tz++;
      const parsed = hhmmss(tstr, 0, tz);
      if (tz === tstr.length && parsed.rest) throw new IsoError('trailing');
      let [h] = parsed.comps;
      const [, m, sec, micro] = parsed.comps;
      if (h === 24) {
        if (m || sec || micro) throw new IsoError('24');
        h = 0;
        dayShift = 1;
      }
      if (h > 23 || m > 59 || sec > 59) throw new IsoError('range');
      let offset = 0n;
      if (tz < tstr.length) {
        aware = true;
        if (tstr[tz] === 'Z') {
          if (tz + 1 < tstr.length) throw new IsoError('tz');
        } else {
          const zone = hhmmss(tstr, tz + 1, tstr.length);
          if (zone.rest) throw new IsoError('tz');
          const [zh, zm, zsec, zus] = zone.comps;
          const total = ((BigInt(zh) * 60n + BigInt(zm)) * 60n + BigInt(zsec)) * 1000000n + BigInt(zus);
          if (total >= 86400000000n) throw new IsoError('tz');
          offset = tstr[tz] === '-' ? -total : total;
        }
      }
      us = ((BigInt(h) * 60n + BigInt(m)) * 60n + BigInt(sec)) * 1000000n + BigInt(micro) - offset;
    }
    if (day + dayShift > MAX_ORDINAL) throw new IsoError('range');
    return { us: BigInt(day + dayShift) * 86400000000n + us, aware };
  } catch (e) {
    if (e instanceof IsoError) throw new Error('Invalid isoformat string');
    throw e;
  }
}
