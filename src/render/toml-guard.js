// The parse guard of src/render/model-defaults.js (#481, S10 of #470): would CPython's tomllib, a TOML 1.0
// parser, accept this text? The original refused an edit that tomllib could not parse; the port parses
// with the vendored smol-toml 1.9.1, which differs from tomllib on a few inputs (PR #515 QA, B1):
//   - it refuses an integer above 2^53 unless asked for big ints (asked for here, 'asNeeded');
//   - it accepts TOML 1.1 forms tomllib refuses: a newline or a trailing comma inside an inline table,
//     the \e and \xHH escapes, a time without seconds;
//   - it accepts a calendar-impossible date (2026-02-30) and a byte-order mark outside a string.
// tomlRefusal() refuses those, with a lexical pass over the text smol-toml has already accepted. It is not
// a TOML parser: what it reads is bounded to the forms above, and test/render/model-defaults.test.js pins
// accept or refuse per input against tomllib's answers. What still differs is declared in
// test/golden/S10/expected-differences.json. node: modules and the vendored TOML parser only.
import { parse } from '../vendor/smol-toml/dist/index.js';

const BARE = /[A-Za-z0-9_+\-.:]/;

/** @param {number} y */
const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * Why a value token is not TOML 1.0, or null.
 * @param {string} tok
 */
function valueRefusal(tok) {
  const d = /^(\d{4})-(\d{2})-(\d{2})/.exec(tok);
  if (d) {
    const [y, m, day] = [Number(d[1]), Number(d[2]), Number(d[3])];
    const days = [31, leap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if (m < 1 || m > 12 || day < 1 || day > days[m - 1]) return 'invalid date ' + d[0];
  }
  const t = /(?:^|[Tt])\d{2}:\d{2}(:\d{2})?/.exec(tok);
  if (t && t[1] === undefined) return 'a time without seconds';
  return null;
}

/**
 * The index after the string that opens at i (text[i] is a quote), and why it is not TOML 1.0 (a \e or
 * \x escape in a basic string), or null.
 * @param {string} text
 * @param {number} i
 * @returns {[number, string | null]}
 */
function scanString(text, i) {
  const q = text[i];
  const multi = text.startsWith(q.repeat(3), i);
  let j = i + (multi ? 3 : 1);
  while (j < text.length) {
    const c = text[j];
    if (q === '"' && c === '\\') {
      const e = text[j + 1];
      if (e === 'e' || e === 'x') return [j + 2, 'the \\' + e + ' escape (TOML 1.1)'];
      j += 2;
      continue;
    }
    if (multi && text.startsWith(q.repeat(3), j)) {
      j += 3;
      // Up to two more quotes belong to the string ("""a"""" is a" then the closing delimiter).
      for (let k = 0; k < 2 && text[j] === q; k++) j++;
      return [j, null];
    }
    if (!multi && c === q) return [j + 1, null];
    j++;
  }
  return [j, null];
}

/**
 * Why tomllib (TOML 1.0) would refuse text that smol-toml accepts, or null. Only the forms named above.
 * @param {string} text
 */
export function toml10Refusal(text) {
  /** @type {string[]} '[' an array, '{' an inline table, 'h' a table header */
  const stack = [];
  // What came before the next token: 'start' (a statement), '=', '[' or ',' inside an array, 'date' (a
  // date that a space may join to its time), or 'other'.
  let prev = 'start';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    const top = stack[stack.length - 1];
    if (c === '"' || c === "'") {
      const [end, why] = scanString(text, i);
      if (why) return why;
      i = end;
      prev = 'other';
      continue;
    }
    if (c === '#') {
      while (i < text.length && text[i] !== '\n') i++;
      continue;
    }
    if (c === '\n') {
      if (top === '{') return 'a newline inside an inline table (TOML 1.1)';
      if (!stack.length) prev = 'start';
      i++;
      continue;
    }
    if (c === '\ufeff') return 'a byte-order mark outside a string';
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    if (c === '[') {
      // A table header ([t] or [[t]]) holds keys, never values.
      stack.push((prev === 'start' && !stack.length) || top === 'h' ? 'h' : '[');
      prev = '[';
    } else if (c === ']') {
      stack.pop();
      prev = 'other';
    } else if (c === '{') {
      stack.push('{');
      prev = 'other';
    } else if (c === '}') {
      stack.pop();
      prev = 'other';
    } else if (c === ',') {
      let j = i + 1;
      while (text[j] === ' ' || text[j] === '\t') j++;
      if (top === '{' && text[j] === '}') return 'a trailing comma in an inline table (TOML 1.1)';
      prev = top === '[' ? ',' : 'other';
    } else if (c === '=') {
      prev = '=';
    } else if (BARE.test(c)) {
      let j = i;
      while (j < text.length && BARE.test(text[j])) j++;
      const tok = text.slice(i, j);
      const isValue = prev === '=' || prev === 'date' || (top === '[' && (prev === '[' || prev === ','));
      if (isValue) {
        const why = valueRefusal(tok);
        if (why) return why;
      }
      prev = isValue && /^\d{4}-\d{2}-\d{2}$/.test(tok) ? 'date' : 'other';
      i = j;
      continue;
    } else {
      prev = 'other';
    }
    i++;
  }
  return null;
}

/**
 * Why text would not parse as TOML 1.0, or null: smol-toml (big ints kept), then the TOML 1.0 forms it
 * accepts and tomllib does not.
 * @param {string} text
 */
export function tomlInvalid(text) {
  try {
    parse(text, { integersAsBigInt: 'asNeeded' });
  } catch (e) {
    return (e instanceof Error ? e.message : String(e)).split('\n')[0];
  }
  const why = toml10Refusal(text);
  return why ? 'Invalid TOML 1.0 document: ' + why : null;
}
