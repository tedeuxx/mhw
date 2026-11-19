// A strict, hand-written reader for the one subset of YAML that Kiro's permissions schema uses (ADR-0036,
// Issue #144): a top-level "rules" list of mappings with capability, effect, match and exclude, and an
// optional "policies" list. The Node form of the reader in global/kiro/kiro_permissions.py (#482, S11 of
// #470), deliberately NOT a general YAML library: a general parser accepts anchors, tags, flow mappings,
// multi-line and implicitly typed scalars, so swapping it in would silently change which of the owner's
// files are merged. Anything outside the subset, or a file Kiro itself would reject (it then drops every
// rule in it), raises Refuse and nothing is written. test/render/kiro-permissions.test.js holds this
// reader to the transcripts recorded from the Python one (test/golden/S11/reader.json).
//
// The Python semantics the subset depends on are reproduced here: str.splitlines()'s line boundaries,
// str.isspace() for strip and for the regular expression class \s, json.loads for a double-quoted scalar
// (src/lib/py.js), and str.lower() for the implicit-type check. Python indexes code points and this file
// UTF-16 units; every character the reader branches on is in the Basic Multilingual Plane and no
// surrogate is one of them, so the two walks take the same branches. node: modules only.
import { isPyWs, loads, JsonDecodeError, pyRepr } from './py.js';

/** A file this reader will not merge into: the message says why, nothing is written. */
export class Refuse extends Error {}

export const RULE_KEYS = /** @type {const} */ (['capability', 'effect', 'match', 'exclude']);
export const EFFECTS = /** @type {const} */ (['deny', 'allow', 'ask']);

/**
 * @typedef {{ capability?: string, effect?: string, match?: string[], exclude?: string[] }} Rule
 * @typedef {{ rules: Rule[], policies: string[] | null }} Doc
 * @typedef {{ ind: number, content: string, n: number }} Line
 */

// Plain scalars a YAML parser could read as something other than a string. They are refused, never
// re-quoted: quoting one would turn a rule Kiro rejects (which disables the whole file) into a rule that
// applies. Fail closed: YAML 1.2 core plus every YAML 1.1 implicit type (yaml.org/type: bool, float, int,
// merge, null, timestamp, value), matched after lowering, with any number spelling (signs, leading dot,
// exponent, hex, octal, binary, underscores, sexagesimal) and the three timestamp spellings.
const NOT_STRING_WORDS = new Set(['~', 'null', 'true', 'false', 'yes', 'no', 'on', 'off', 'y', 'n', '<<', '=']);
const NOT_STRING_RE = /^[-+]?(?:0x[0-9a-f_]+|0o[0-7_]+|0b[01_]+|(?:[0-9][0-9_]*(?::[0-9_]+)*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:e[-+]?[0-9_]+)?|\.inf|\.nan)$/;
const TIMESTAMP_RE = /^[0-9]{4}-[0-9]{1,2}-[0-9]{1,2}(?:(?:t|[ \t]+)[0-9]{1,2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]*)?(?:[ \t]*(?:z|[-+][0-9]{1,2}(?::[0-9]{2})?))?)?$/;
// The first characters a plain scalar may not start with.
const BAD_START = new Set('&*!|>{}%@`,[]\'"#');
// str.splitlines()'s line boundaries ("\r\n" is one).
const LINE_BREAKS = new Set(['\n', '\r', '\v', '\f', '\x1c', '\x1d', '\x1e', '\x85', ' ', ' ']);

/**
 * True when YAML reads tok as something other than a string (Python's str.lower() first).
 * @param {string} tok
 */
export function notAString(tok) {
  const low = tok.toLowerCase();
  return NOT_STRING_WORDS.has(low) || NOT_STRING_RE.test(low) || TIMESTAMP_RE.test(low);
}

/** str.splitlines(). @param {string} text @returns {string[]} */
export function splitlines(text) {
  /** @type {string[]} */
  const out = [];
  let start = 0;
  let i = 0;
  while (i < text.length) {
    if (LINE_BREAKS.has(text[i])) {
      out.push(text.slice(start, i));
      i += text[i] === '\r' && text[i + 1] === '\n' ? 2 : 1;
      start = i;
    } else i++;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}

/** str.rstrip(). @param {string} s */
export function rstrip(s) {
  let end = s.length;
  while (end > 0 && isPyWs(s[end - 1])) end--;
  return s.slice(0, end);
}

/** str.lstrip(). @param {string} s */
export function lstrip(s) {
  let start = 0;
  while (start < s.length && isPyWs(s[start])) start++;
  return s.slice(start);
}

/** str.strip(). @param {string} s */
export const strip = (s) => lstrip(rstrip(s));

/** How many spaces s starts with: len(s) - len(s.lstrip(" ")). @param {string} s */
const leadingSpaces = (s) => {
  let i = 0;
  while (s[i] === ' ') i++;
  return i;
};

/**
 * The line without its comment; quotes are tracked so a # inside one stays.
 * @param {string} text
 * @param {number} lineno
 */
function stripComment(text, lineno) {
  /** @type {string | null} */
  let quote = null;
  let i = 0;
  while (i < text.length) {
    const ch = text[i];
    if (quote === '"') {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === '"') quote = null;
    } else if (quote === "'") {
      // The original stepped over a doubled quote ('') here. Closing at the first quote and opening again
      // at the second leaves the same state at the same place, so that step is not reproduced.
      if (ch === "'") quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '#' && (i === 0 || text[i - 1] === ' ' || text[i - 1] === '\t')) {
      return rstrip(text.slice(0, i));
    }
    i++;
  }
  if (quote) throw new Refuse('line ' + lineno + ': a quoted scalar does not end on its line');
  return rstrip(text);
}

/** @param {string} text @returns {Line[]} */
function lines(text) {
  /** @type {Line[]} */
  const out = [];
  splitlines(text).forEach((raw, idx) => {
    const n = idx + 1;
    let r = raw;
    while (r.endsWith('\r')) r = r.slice(0, -1);
    const body = stripComment(r, n);
    const content = strip(body);
    if (!content) return;
    if (content === '---' || content === '...') {
      if (out.length) throw new Refuse('line ' + n + ': more than one YAML document');
      return;
    }
    if (body.slice(0, body.length - lstrip(body).length).includes('\t')) throw new Refuse('line ' + n + ': a tab in the indentation');
    out.push({ ind: leadingSpaces(body), content, n });
  });
  return out;
}

/**
 * One scalar value: double-quoted (decoded as JSON), single-quoted, or a plain scalar YAML reads as a
 * string. Anything else is refused.
 * @param {string} token
 * @param {number} n the line number
 * @returns {string}
 */
export function scalar(token, n) {
  const tok = strip(token);
  if (!tok) throw new Refuse('line ' + n + ': an empty value');
  if (tok[0] === '"') {
    // A JSON text that starts with a quote decodes to a string or not at all.
    try {
      return /** @type {string} */ (loads(tok));
    } catch (e) {
      if (e instanceof JsonDecodeError) throw new Refuse('line ' + n + ': a double-quoted scalar this reader does not decode: ' + tok);
      throw e;
    }
  }
  if (tok[0] === "'") {
    const inner = tok.slice(1, -1);
    if (tok.length < 2 || !tok.endsWith("'") || hasLoneQuote(inner)) {
      throw new Refuse('line ' + n + ': a single-quoted scalar this reader does not decode: ' + tok);
    }
    return inner.replaceAll("''", "'");
  }
  if (BAD_START.has(tok[0]) || tok.startsWith('- ') || tok.startsWith('? ') || tok.startsWith(': ') || tok === '-') {
    throw new Refuse('line ' + n + ': a value YAML reads as something other than a plain string: ' + tok);
  }
  if (tok.includes(': ') || tok.endsWith(':') || tok.includes(' #')) {
    throw new Refuse('line ' + n + ": a plain scalar holding ': ' or ' #': " + tok);
  }
  if (notAString(tok)) throw new Refuse('line ' + n + ': ' + tok + ' is not a string in YAML');
  return tok;
}

/** A single quote with no quote on either side of it: the regular expression (?<!')'(?!'). @param {string} s */
function hasLoneQuote(s) {
  for (let i = 0; i < s.length; i++) {
    if (s[i] === "'" && s[i - 1] !== "'" && s[i + 1] !== "'") return true;
  }
  return false;
}

/**
 * A flow sequence "[a, 'b', \"c\"]" on one line, of scalars only.
 * @param {string} tok
 * @param {number} n
 */
function flowSeq(tok, n) {
  if (!(tok.startsWith('[') && tok.endsWith(']'))) throw new Refuse('line ' + n + ': a flow sequence must open and close on one line');
  const inner = strip(tok.slice(1, -1));
  if (!inner) return [];
  /** @type {string[]} */
  const items = [];
  let cur = '';
  /** @type {string | null} */
  let quote = null;
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (quote === '"' && ch === '\\') {
      cur += inner.slice(i, i + 2);
      i += 2;
      continue;
    }
    if (quote) {
      if (ch === quote) {
        if (quote === "'" && inner[i + 1] === "'") {
          cur += "''";
          i += 2;
          continue;
        }
        quote = null;
      }
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === '[' || ch === ']' || ch === '{' || ch === '}') {
      throw new Refuse('line ' + n + ': a nested flow collection');
    } else if (ch === ',') {
      items.push(cur);
      cur = '';
      i++;
      continue;
    }
    cur += ch;
    i++;
  }
  // The original also pushed cur when no item came before it; with no comma, cur is the whole stripped,
  // non-empty inner text, so that clause never decides and is not reproduced.
  if (strip(cur)) items.push(cur);
  return items.map((x) => scalar(x, n));
}

const isIdentStart = (/** @type {string | undefined} */ c) => c !== undefined && ((c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') || c === '_');
const isIdent = (/** @type {string | undefined} */ c) => isIdentStart(c) || (c !== undefined && c >= '0' && c <= '9');

/**
 * "key: value" -> [key, value stripped]: the regular expression ([A-Za-z_][A-Za-z0-9_]*)\s*:(?:\s+(.*))?
 * matched against the whole line, \s being Python's whitespace.
 * @param {string} content
 * @param {number} n
 * @returns {[string, string]}
 */
function keyValue(content, n) {
  const bad = () => new Refuse('line ' + n + ": expected 'key: value', got: " + content);
  if (!isIdentStart(content[0])) throw bad();
  let i = 1;
  while (isIdent(content[i])) i++;
  const key = content.slice(0, i);
  while (i < content.length && isPyWs(content[i])) i++;
  if (content[i] !== ':') throw bad();
  i++;
  if (i === content.length) return [key, ''];
  if (!isPyWs(content[i])) throw bad();
  return [key, strip(content.slice(i))];
}

/** @param {Line} l */
const isItem = (l) => l.content === '-' || l.content.startsWith('- ');

/**
 * Items "- x" at one indent >= minIndent, from lines[i]: each item is its first line and every deeper line
 * after it. null when lines[i] is not such an item. (The original's check for a deeper line after the last
 * item can never fire: the inner loop has taken every deeper line, so it is not reproduced.)
 * @param {Line[]} ls
 * @param {number} i
 * @param {number} minIndent
 * @returns {{ items: Line[][], next: number } | null}
 */
function blockSeq(ls, i, minIndent) {
  if (i >= ls.length || ls[i].ind < minIndent || !isItem(ls[i])) return null;
  const ind = ls[i].ind;
  /** @type {Line[][]} */
  const items = [];
  while (i < ls.length && ls[i].ind === ind && isItem(ls[i])) {
    const start = i;
    i++;
    while (i < ls.length && ls[i].ind > ind) i++;
    items.push(ls.slice(start, i));
  }
  return { items, next: i };
}

/**
 * A key's sequence value: inline flow, or a following block of scalars.
 * @param {string} rest
 * @param {Line[]} ls
 * @param {number} i
 * @param {number} parentIndent
 * @param {number} n
 * @returns {[string[], number]}
 */
function seqValue(rest, ls, i, parentIndent, n) {
  if (rest) return [flowSeq(rest, n), i];
  const got = blockSeq(ls, i, parentIndent);
  if (!got) throw new Refuse('line ' + n + ': the key has no value');
  const out = got.items.map((item) => {
    const { content, n: m } = item[0];
    if (item.length !== 1 || content === '-') throw new Refuse('line ' + m + ': a sequence item must be one scalar on its line');
    return scalar(content.slice(2), m);
  });
  return [out, got.next];
}

/** @param {Line[]} item @returns {Rule} */
function rule(item) {
  const { ind, content, n } = item[0];
  const first = strip(content.slice(2));
  if (!first) throw new Refuse('line ' + n + ": a rule must start on its '- ' line");
  if (first.startsWith('{')) throw new Refuse('line ' + n + ': a rule written as a flow mapping');
  const keyIndent = ind + 2 + leadingSpaces(content.slice(2));
  const body = [{ ind: keyIndent, content: first, n }, ...item.slice(1)];
  /** @type {Record<string, string | string[]>} */
  const got = {};
  let i = 0;
  while (i < body.length) {
    const { ind: kind, content: kcontent, n: kn } = body[i];
    if (kind !== keyIndent) throw new Refuse('line ' + kn + ': unexpected indentation in a rule');
    const [key, rest] = keyValue(kcontent, kn);
    if (Object.hasOwn(got, key)) throw new Refuse('line ' + kn + ': ' + key + ' repeated in one rule');
    if (!(/** @type {readonly string[]} */ (RULE_KEYS).includes(key))) {
      throw new Refuse('line ' + kn + ': Kiro rejects a rule with the field ' + pyRepr(key) + ', and then drops every rule in the file');
    }
    i++;
    if (key === 'match' || key === 'exclude') {
      [got[key], i] = seqValue(rest, body, i, keyIndent, kn);
    } else {
      if (!rest) throw new Refuse('line ' + kn + ': ' + key + ' has no value');
      got[key] = scalar(rest, kn);
    }
  }
  if (!Object.hasOwn(got, 'capability')) throw new Refuse('line ' + n + ': a rule with no capability; Kiro would drop every rule in the file');
  if (!(/** @type {readonly unknown[]} */ (EFFECTS).includes(got.effect))) {
    throw new Refuse('line ' + n + ': a rule whose effect is not deny, allow or ask; Kiro would drop every rule in the file');
  }
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const k of RULE_KEYS) if (Object.hasOwn(got, k)) out[k] = got[k];
  return /** @type {Rule} */ (out);
}

/**
 * The document, or Refuse.
 * @param {string} text
 * @returns {Doc}
 */
export function parse(text) {
  const ls = lines(text);
  if (!ls.length) return { rules: [], policies: null };
  /** @type {{ rules: Rule[] | null, policies: string[] | null }} */
  const doc = { rules: null, policies: null };
  let i = 0;
  while (i < ls.length) {
    const { ind, content, n } = ls[i];
    if (ind !== 0) throw new Refuse('line ' + n + ': unexpected indentation at the top level');
    const [key, rest] = keyValue(content, n);
    if (key !== 'rules' && key !== 'policies') throw new Refuse('line ' + n + ': a top-level key this reader does not keep: ' + key);
    if (doc[key] !== null) throw new Refuse('line ' + n + ': ' + key + ' repeated');
    i++;
    if (key === 'policies') {
      [doc.policies, i] = seqValue(rest, ls, i, 0, n);
      continue;
    }
    if (rest) {
      if (rest !== '[]') throw new Refuse('line ' + n + ': rules must be a block list of rules (or [])');
      doc.rules = [];
      continue;
    }
    const got = blockSeq(ls, i, 0);
    if (!got) throw new Refuse('line ' + n + ': rules has no value');
    i = got.next;
    doc.rules = got.items.map(rule);
  }
  if (doc.rules === null) throw new Refuse('no "rules" list; Kiro would reject the file');
  return { rules: doc.rules, policies: doc.policies };
}
