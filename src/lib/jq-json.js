// JSON read and written the way jq 1.7.1 does it (#490, S19 of #470), for the settings files whose shell
// steps were jq programs. Objects are Maps, so key order is kept exactly as jq keeps it (insertion order,
// a repeated key keeping its first position and its last value, integer-like keys never moved), and a
// number is a JqNumber holding its literal, printed as jq 1.7.1 prints a literal it did not compute: the
// decNumber scientific string (1e2 -> 1E+2, 0.10 -> 0.10, 0.00000012 -> 1.2E-7). Strings are escaped as
// jq escapes them: the JSON escapes, every other control character and DEL as \u00xx, nothing else.
// Measured against jq-1.7.1 on 2026-11-19. Not covered: input jq accepts and JSON does not (nan, several
// documents in one file), which this reader refuses. node: modules only.

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

/**
 * Parse one JSON document. Throws JqParseError on anything else.
 * @param {string} text
 * @returns {JqValue}
 */
export function parse(text) {
  let i = 0;
  const fail = (/** @type {string} */ why) => {
    throw new JqParseError(why + ' at offset ' + i);
  };
  const skip = () => {
    while (i < text.length && WS.has(text[i])) i++;
  };
  /** @returns {JqValue} */
  const value = () => {
    skip();
    const c = text[i];
    if (c === '{') return object();
    if (c === '[') return array();
    if (c === '"') return string();
    if (c === '-' || (c >= '0' && c <= '9')) return number();
    for (const [word, v] of /** @type {Array<[string, JqValue]>} */ ([['true', true], ['false', false], ['null', null]])) {
      if (text.startsWith(word, i)) {
        i += word.length;
        return v;
      }
    }
    return fail('unexpected character');
  };
  const object = () => {
    /** @type {Map<string, JqValue>} */
    const m = new Map();
    i++;
    skip();
    if (text[i] === '}') {
      i++;
      return m;
    }
    for (;;) {
      skip();
      if (text[i] !== '"') fail('expected a key');
      const k = string();
      skip();
      if (text[i] !== ':') fail('expected a colon');
      i++;
      m.set(k, value());
      skip();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === '}') {
        i++;
        return m;
      }
      fail('expected , or }');
    }
  };
  const array = () => {
    /** @type {JqValue[]} */
    const a = [];
    i++;
    skip();
    if (text[i] === ']') {
      i++;
      return a;
    }
    for (;;) {
      a.push(value());
      skip();
      if (text[i] === ',') {
        i++;
        continue;
      }
      if (text[i] === ']') {
        i++;
        return a;
      }
      fail('expected , or ]');
    }
  };
  const string = () => {
    i++;
    let out = '';
    for (;;) {
      if (i >= text.length) fail('unterminated string');
      const c = text[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c < ' ') fail('control character in a string');
      if (c !== '\\') {
        out += c;
        i++;
        continue;
      }
      const e = text[i + 1];
      const simple = /** @type {Record<string, string>} */ ({ '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' });
      if (e !== undefined && Object.hasOwn(simple, e)) {
        out += simple[e];
        i += 2;
      } else if (e === 'u') {
        const hex = text.slice(i + 2, i + 6);
        if (!/^[0-9A-Fa-f]{4}$/.test(hex)) fail('bad \\u escape');
        out += String.fromCharCode(Number.parseInt(hex, 16));
        i += 6;
      } else fail('bad escape');
    }
  };
  const number = () => {
    const start = i;
    if (text[i] === '-') i++;
    const digits = () => {
      const s = i;
      while (i < text.length && text[i] >= '0' && text[i] <= '9') i++;
      return i - s;
    };
    if (text[i] === '0') i++;
    else if (!digits()) fail('bad number');
    if (text[i] === '.') {
      i++;
      if (!digits()) fail('bad number');
    }
    if (text[i] === 'e' || text[i] === 'E') {
      i++;
      if (text[i] === '+' || text[i] === '-') i++;
      if (!digits()) fail('bad number');
    }
    return new JqNumber(text.slice(start, i));
  };
  const v = value();
  skip();
  if (i !== text.length) fail('trailing content');
  return v;
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
    if (ch === '"') out += '\\"';
    else if (ch === '\\') out += '\\\\';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\t') out += '\\t';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\b') out += '\\b';
    else if (ch === '\f') out += '\\f';
    else if (c < 0x20 || c === 0x7f) out += '\\u' + c.toString(16).padStart(4, '0');
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
