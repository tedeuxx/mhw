// Render one MCP server definition into every agent surface's own config (ADR-0017): the Node form of the
// deleted global/mcp/mcp_render.py (#484, S13 of #470). Same arguments, same output lines, same exit codes,
// same files written; test/golden/S13 holds the transcripts recorded from the Python original, and
// test/golden/S13/expected-differences.json names every intended difference.
//
//   mhw mcp render                 render into every installed surface (backup kept beside each file)
//   mhw mcp render --dry-run       print what would change where; write nothing
//   mhw mcp render --check         exit 1 if a surface is missing a server, holds a stale one, drifted, or
//                                  carries a provenance stamp other than the source's (ADR-0029)
//   mhw mcp render --scan          read-only, owner-run: list the MCP config KEYS that look like
//                                  credentials, in every surface and backup file. Never prints a value
//   mhw mcp render --adopt         take over a same-named server that was configured by hand
//                                  (JSON surfaces only; a backup is kept)
//   --source=FILE                  the definition (default: <data dir>/local-overlay/mcp-servers.json)
//   --surfaces=a,b                 restrict to these surfaces: codex, claude-code, claude-desktop, kiro
//   mhw mcp render --policy --mode=install|check|dry-run|uninstall [--stamp=S]
//                                  the policy servers (ADR-0038), global/mcp/policy-servers.json, rendered
//                                  by global/install.sh on every mhw install
//   mhw mcp render --active --mode=install|check|dry-run|uninstall|connect [--stamp=S] [--source=FILE]
//                  [--timeout=SECONDS, connect only]
//                                  the MCP active set (Issue #219, ADR-0041), src/commands/mcp-active.js, and
//                                  its connection check, src/commands/mcp-connect.js (Node since #485, S14)
//
// `node src/render/mcp.js` takes the same arguments (global/install.sh runs it that way).
//
// The definition lives only in the untracked local overlay, outside every repository: server names,
// commands, args and non-secret environment values. A credential is never in it. A server that needs one
// names it under "secrets" with its source (macOS Keychain service, or an environment variable), and is
// rendered as the Node launcher (`mhw mcp launch`, src/commands/mcp-launch.js, #483): the renderer installs
// a copy of it beside its other managed files and renders `<node> <that copy> --secret ... -- <command>`,
// and the launcher reads the value when the server starts. So the renderer never reads a secret, and no
// rendered file can hold one it was given.
//
// Python semantics are reproduced where they change bytes or decisions: strict UTF-8 and universal newlines
// on read, CPython's json (src/lib/py.js: key order, ints, floats, NaN, messages), str.splitlines(), sorted()
// by code point, == on dicts. The Codex TOML is proved with the vendored smol-toml plus the TOML 1.0 guard
// of S10 (src/render/toml-guard.js) where the original used tomllib; a parser message differs and is
// declared. node: modules and the vendored TOML parser only.
//
// Exit codes: 0 ok · 1 drift or missing (--check) · 2 usage, invalid definition or a missing dependency ·
// 3 something unmanaged, conflicting or unreadable is in the way (left untouched).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { MARKER_ID, NAME as PROJECT, unstamp } from '../lib/marker.js';
import { privateCopy } from '../lib/private-copy.js';
import { loads, dumps, pyRepr, pyStrip, pyLen, cmpStr, PyFloat, JsonDecodeError } from '../lib/py.js';
import { realpathLoose } from '../lib/confine.js';
import { parse as tomlParseRaw } from '../vendor/smol-toml/dist/index.js';
import { tomlInvalid } from './toml-guard.js';
import { PyOSError, pyOSError, utf8Error } from './kiro-permissions.js';
import { splitLines } from './model-defaults.js';
import { ci, py } from '../lib/clean.js';
import { SPACE as PY_SPACE_RANGES, IGNORE_CASE } from '../lib/clean-unicode.js';

export { PROJECT, MARKER_ID };
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDERER_REL = 'src/render/mcp.js';
export const BLOCK_BEGIN = '# >>> ' + MARKER_ID + ' (mcp servers); generated, do not edit inside this block: re-run mhw mcp render';
export const BLOCK_BEGIN_PREFIX = '# >>> ' + MARKER_ID + ' (mcp servers)';
export const BLOCK_END = '# <<< ' + MARKER_ID + ' (mcp servers)';
export const SURFACES = /** @type {const} */ (['codex', 'claude-code', 'claude-desktop', 'kiro']);
// The launcher (#483, S12 of #470): src/commands/mcp-launch.js, which replaced global/mcp/mcp-launch.sh.
export const LAUNCHER_SRC = path.join(ROOT, 'src', 'commands', 'mcp-launch.js');
const LAUNCHER_SRC_REL = 'src/commands/mcp-launch.js';
export const LAUNCHER_NAME = 'mcp-launch.mjs'; // .mjs: an ES module wherever it is copied
const LEGACY_LAUNCHER = 'mcp-launch.sh'; // the shell launcher an earlier release installed; retired on install
export const POLICY_SRC = path.join(ROOT, 'global', 'mcp', 'policy-servers.json');
export const POLICY_BACKUP = '.pmhwc-mcp-policy-backup';
export const BACKUP = '.pmhwc-backup';
// The manifest's sections: the local definition's servers, the policy servers (ADR-0038) and what the
// active set turned off (Issue #219). A section empty in all of them leaves no manifest behind.
export const MANIFEST_KEYS = ['surfaces', 'stamps', 'policy', 'policy_stamps', 'active'];
export const SOURCE_KEYS = new Set(['$schema', 'version', 'servers', 'active_set']);
export const ACTIVE_KEYS = new Set(['description', 'connectors']);
// Decision 1 of Issue #219 (parity): a server in a declared active set is on in all three agent harnesses.
export const PARITY = ['codex', 'claude-code', 'kiro'];
export const SERVER_KEYS = new Set(['description', 'command', 'args', 'env', 'secrets', 'surfaces', 'not_secret']);
export const AGENT_ENV = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT', 'CODEX_SANDBOX', 'CODEX_SANDBOX_NETWORK_DISABLED'];
const UNREADABLE = (/** @type {string} */ p, /** @type {string} */ e) => 'cannot read the MCP definition ' + p + ': ' + e;

// The patterns, as Python's re.match(...$) reads them: a trailing newline is allowed before the end. The
// Python pattern text is what an error message prints.
const NAME_PATTERN = '^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$';
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\n?$/;
const ENV_RE = /^[A-Za-z_]\w*\n?$/;
const SERVICE_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._@:+-]{0,127}$';
const SERVICE_RE = /^[A-Za-z0-9][A-Za-z0-9._@:+-]{0,127}\n?$/;
// Python's re semantics, built with the cleaning core's tables (src/lib/clean.js, S15): \s is Python's
// whitespace set (it holds \x1c-\x1f and \x85, and not U+FEFF, unlike JavaScript's), \b is Python's word
// boundary, and every letter under re.I is the set of code points CPython's (?i) accepts for it (i also
// matches U+0130 and U+0131, k U+212A, s U+017F). The S13 credential oracle (test/golden/S13) holds each
// pattern to CPython 3.14.6's answers.
/** @param {number} cp */
const hexCp = (cp) => String.raw`\u{` + cp.toString(16) + '}';
const PY_SPACE_BODY = (() => {
  let b = '';
  for (let i = 0; i < PY_SPACE_RANGES.length; i += 2) b += hexCp(PY_SPACE_RANGES[i]) + '-' + hexCp(PY_SPACE_RANGES[i + 1]);
  return b;
})();
const PS = '[' + PY_SPACE_BODY + ']';
const PNS = '[^' + PY_SPACE_BODY + ']';
const PY_SPACE_CHAR = new RegExp('^' + PS + '$', 'u');
const PB = py(String.raw`\b`);
/** [A-Za-z0-9<extra>] under re.I: every ASCII letter's (?i) set, the digits, and extra as written. @param {string} extra */
function ciAsciiClass(extra) {
  const cps = new Set();
  for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz') for (const cp of IGNORE_CASE[/** @type {keyof typeof IGNORE_CASE} */ (c)]) cps.add(cp);
  return '[0-9' + extra + [...cps].sort((a, b) => a - b).map(hexCp).join('') + ']';
}
// A key NAME that suggests a credential (re.I). Used to refuse a plain env value in the definition, and by
// --scan to list keys in the surfaces. A false positive is visible and has an escape (not_secret).
const CRED_RE = new RegExp(ci(String.raw`TOKEN|SECRET|PASSW(?:OR)?D|PASSPHRASE|PWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|CLIENT[_-]?KEY|CREDENTIAL|AUTH|BEARER|COOKIE|SESSION|DSN|SIGNATURE|(?:^|[_.-])(?:PAT|KEY|KEYS|APIKEY|CERT)(?:[_.-]|\n?$)`), 'u');
/** CRED_RE.search(name): the key name looks like a credential's. @param {string} name */
export const credentialName = (name) => CRED_RE.test(name);
const ARG_FLAG_RE = /^(--?[\w.-]+)(=[\s\S]*)?\n?$/;
const URL_WORD = new RegExp(ci('token|key|secret|passw|auth'), 'u');
const URL_PARAM_CHAR = new RegExp('^' + ciAsciiClass('_.\\-') + '$', 'u');

/**
 * The original's URL pattern, (://[^/@\s]+:[^/@\s]+@)|([?&][A-Za-z0-9_.-]*(token|key|secret|passw|auth)
 * [A-Za-z0-9_.-]*=) under re.I, answered by one linear pass instead of a backtracking search: userinfo is
 * the run after :// of characters that are not /, @ or Python whitespace, ended by @ and holding a : with
 * a character on each side; a credential parameter is the run of the class's characters (under re.I) after
 * ? or &, ended by = and holding one of the words. A run is maximal, so on the characters CPython's tables
 * cover the scan answers what the regex answers; test/render/mcp.test.js holds it to CPython 3.14.6's
 * recorded answers, non-ASCII input included.
 * @param {string} s
 */
export function urlCredential(s) {
  const cps = Array.from(s);
  for (let i = 0; i + 2 < cps.length; i++) {
    if (cps[i] !== ':' || cps[i + 1] !== '/' || cps[i + 2] !== '/') continue;
    let j = i + 3;
    while (j < cps.length && cps[j] !== '/' && cps[j] !== '@' && !PY_SPACE_CHAR.test(cps[j])) j++;
    if (cps[j] === '@' && cps.slice(i + 4, j - 1).includes(':')) return true;
  }
  for (let i = 0; i < cps.length; i++) {
    if (cps[i] !== '?' && cps[i] !== '&') continue;
    let j = i + 1;
    while (j < cps.length && URL_PARAM_CHAR.test(cps[j])) j++;
    if (cps[j] === '=' && URL_WORD.test(cps.slice(i + 1, j).join(''))) return true;
  }
  return false;
}
// A credential-looking VALUE, whatever its key is called: userinfo or a credential query parameter in a
// URL, an Authorization-style header, a bearer/basic scheme, a private key block, or a well-known token
// prefix. A hit is refused and reported by location only; the value is never echoed. The header pattern
// is the original's with its redundant prefixes dropped: a search finds `token:` wherever it found
// `x-token:`, and `authorization:` wherever `proxy-authorization:`, so the answer is the same.
const VALUE_CRED_RES = [
  { test: urlCredential },
  new RegExp(ci('(?:authorization|api[-_]?key|token|secret|password|cookie)') + PS + '*:' + PS + '*' + PNS, 'u'),
  new RegExp(PB + ci('(?:bearer|basic|token)') + PS + '+' + ciAsciiClass('._~+/=\\-') + '{8,}', 'u'),
  new RegExp(PB + '(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|sk-[A-Za-z0-9_-]{16,}|'
    + '(?:sk|rk|pk)_(?:live|test)_[A-Za-z0-9]{10,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|'
    + 'npm_[A-Za-z0-9]{30,})', 'u'),
];

/** -----BEGIN [A-Z ]*PRIVATE KEY----- searched without backtracking. @param {string} s */
function hasPrivateKeyBlock(s) {
  const head = '-----BEGIN ';
  for (let i = s.indexOf(head); i !== -1; i = s.indexOf(head, i + 1)) {
    let j = i + head.length;
    while (j < s.length && ((s[j] >= 'A' && s[j] <= 'Z') || s[j] === ' ')) j++;
    // The run of [A-Z ] must end in PRIVATE KEY, followed by the five dashes.
    if (s.slice(i + head.length, j).endsWith('PRIVATE KEY') && s.startsWith('-----', j)) return true;
  }
  return false;
}

/** @param {string} s */
export function looksLikeCredentialValue(s) {
  return VALUE_CRED_RES.some((rx) => rx.test(s)) || hasPrivateKeyBlock(s);
}

export class Refuse extends Error {
  /** @param {number} code @param {string} msg */
  constructor(code, msg) {
    super(msg);
    this.code = code;
  }
}

// ------------------------------------------------------------------------------- Python's dict and ==

/**
 * @typedef {Map<string, any> | Record<string, any>} Dict
 * @typedef {{ env: Record<string, string | undefined>, platform: string, cwd: string,
 *   out: (s: string) => void, err: (s: string) => void }} Ctx
 */

/** isinstance(v, dict): a Map (an ordered JSON read) or a plain object (a TOML read). @param {unknown} v @returns {v is Dict} */
export function isD(v) {
  return v instanceof Map || (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof PyFloat)
    && !(v instanceof Date) && [Object.prototype, null].includes(Object.getPrototypeOf(v)));
}
/** @param {Dict} d @returns {[string, any][]} */
const entries = (d) => (d instanceof Map ? [...d.entries()] : Object.entries(d));
/** @param {Dict} d @returns {string[]} */
const keysOf = (d) => (d instanceof Map ? [...d.keys()] : Object.keys(d));
/** @param {Dict} d @param {string} k */
const has = (d, k) => (d instanceof Map ? d.has(k) : Object.hasOwn(d, k));
/** dict.get(k, dflt). @param {unknown} d @param {string} k @param {any} [dflt] */
export function get(d, k, dflt = undefined) {
  if (!isD(d) || !has(d, k)) return dflt;
  return d instanceof Map ? d.get(k) : d[k];
}
/** A new ordered dict from [k, v] pairs. @param {Iterable<[string, any]>} [pairs] @returns {Map<string, any>} */
const dict = (pairs = []) => new Map(pairs);
/** len(). @param {unknown} v */
function pyLength(v) {
  if (typeof v === 'string') return pyLen(v);
  if (Array.isArray(v)) return v.length;
  if (isD(v)) return keysOf(v).length;
  return 0;
}
/** Truthiness of a JSON/TOML value. @param {unknown} v */
function truthy(v) {
  if (v === null || v === undefined || v === false || v === '' || v === 0 || v === 0n) return false;
  if (v instanceof PyFloat) return v.v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isD(v)) return keysOf(v).length > 0;
  return true;
}
/** x in container: a dict's keys, a list's items, a str's substrings. @param {string} x @param {unknown} c */
function pyIn(x, c) {
  if (isD(c)) return has(c, x);
  if (Array.isArray(c)) return c.some((v) => pyEq(v, x));
  if (typeof c === 'string') return c.includes(x);
  return false;
}
/** A number as Python compares it (bool is an int). @param {unknown} v @returns {number | bigint | null} */
function numeric(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (typeof v === 'number' || typeof v === 'bigint') return v;
  if (v instanceof PyFloat) return v.v;
  return null;
}
/** Python == on JSON and TOML values: dict order ignored, 1 == 1.0 == True, nan != nan. @param {unknown} a @param {unknown} b @returns {boolean} */
export function pyEq(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  const na = numeric(a);
  const nb = numeric(b);
  if (na !== null || nb !== null) {
    if (na === null || nb === null) return false;
    if (typeof na === typeof nb) return na === nb;
    // an int beyond 2^53 (a BigInt) against a JavaScript number
    const n = typeof na === 'number' ? na : /** @type {number} */ (nb);
    const big = typeof na === 'bigint' ? na : /** @type {bigint} */ (nb);
    return Number.isInteger(n) && BigInt(n) === big;
  }
  const none = (/** @type {unknown} */ v) => v === null || v === undefined;
  if (none(a) || none(b)) return none(a) && none(b);
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => pyEq(x, b[i]));
  }
  if (isD(a) || isD(b)) {
    if (!isD(a) || !isD(b)) return false;
    const ka = keysOf(a);
    return ka.length === keysOf(b).length && ka.every((k) => has(b, k) && pyEq(get(a, k), get(b, k)));
  }
  return isDeepStrictEqual(a, b);
}
/** A deep copy of a dict tree, Maps kept as Maps. @param {any} v @returns {any} */
function deepCopy(v) {
  if (Array.isArray(v)) return v.map(deepCopy);
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [k, deepCopy(x)]));
  if (isD(v)) {
    /** @type {Record<string, any>} */
    const out = {};
    for (const [k, x] of Object.entries(v)) Object.defineProperty(out, k, { value: deepCopy(x), writable: true, enumerable: true, configurable: true });
    return out;
  }
  return v;
}
/** del d[k]. @param {Dict} d @param {string} k */
function del(d, k) {
  if (d instanceof Map) d.delete(k);
  else delete d[k];
}
/** sorted() of strings, by code point. @param {Iterable<string>} xs */
const sorted = (xs) => [...xs].sort(cmpStr);
/** "%r" % s. @param {unknown} v */
const r = (v) => pyRepr(v);
// The Python-semantics helpers src/commands/mcp-active.js and mcp-connect.js share with the render (#485).
export { entries, keysOf, has, dict, deepCopy as deepCopyTree, truthy };

// ------------------------------------------------------------------------------- Python's files

/** open(p, encoding="utf-8").read(): strict UTF-8, BOM kept, universal newlines. @param {string} file */
export function readText(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    throw pyOSError(e, file);
  }
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new PyOSError('UnicodeDecodeError', utf8Error(raw));
  }
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
/** open(p, encoding="utf-8", errors="replace").read(). @param {string} file */
function readLoose(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    throw pyOSError(e, file);
  }
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(raw).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}
/** json.load(open(p)). @param {string} file */
export function readJson(file) {
  return loads(readText(file), { ordered: true });
}
/** os.path.exists: False on any error. @param {string} p */
export function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}
/** os.path.isdir. @param {string} p */
export function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
/** The separators str.splitlines() splits on. */
const BREAKS = new Set(['\n', '\r', '\v', '\f', '\x1c', '\x1d', '\x1e', '\x85', ' ', ' ']);
/** str.splitlines(keepends=True). @param {string} text @returns {string[]} */
export function splitKeep(text) {
  /** @type {string[]} */
  const out = [];
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (!BREAKS.has(text[i])) continue;
    if (text[i] === '\r' && text[i + 1] === '\n') i++;
    out.push(text.slice(start, i + 1));
    start = i + 1;
  }
  if (start < text.length) out.push(text.slice(start));
  return out;
}
/** str.rstrip(chars). @param {string} s @param {string} chars */
function rstripChars(s, chars) {
  let e = s.length;
  while (e > 0 && chars.includes(s[e - 1])) e--;
  return s.slice(0, e);
}
/** The message str(e) gives for an error a read or a parse raised. @param {unknown} e */
export const msgOf = (e) => (e instanceof Error ? e.message : String(e));
/** type(e).__name__ for the errors a read or a parse raises. @param {unknown} e */
export function clsOf(e) {
  if (e instanceof PyOSError) return /** @type {string} */ (e.cls);
  if (e instanceof JsonDecodeError) return 'JSONDecodeError';
  if (e instanceof TomlError) return 'TOMLDecodeError';
  if (e instanceof AttrError) return 'AttributeError';
  return 'Exception';
}
class TomlError extends Error {}
class AttrError extends Error {}

/** tomllib.loads(text), with the TOML 1.0 guard of S10 where smol-toml is more permissive. @param {string} text */
export function tomlLoads(text) {
  const why = tomlInvalid(text);
  if (why) throw new TomlError(why);
  return tomlParseRaw(text, { integersAsBigInt: 'asNeeded' });
}

const TOML_KEY = String.raw`("(?:[^"\\]|\\.)*"|'[^']*'|[A-Za-z0-9_-]+)`;
const SERVER_HEADER = new RegExp(String.raw`^[ \t]*\[[ \t]*mcp_servers[ \t]*\.[ \t]*` + TOML_KEY);
const SERVERS_TABLE = /^[ \t]*\[[ \t]*mcp_servers[ \t]*\][ \t]*(?:#.*)?$/;
const ANY_HEADER = /^[ \t]*\[/;
const KEY_IN_SERVERS = new RegExp(String.raw`^[ \t]*` + TOML_KEY + String.raw`[ \t]*[.=]`);
const DOTTED_AT_ROOT = new RegExp(String.raw`^[ \t]*mcp_servers[ \t]*\.[ \t]*` + TOML_KEY + String.raw`[ \t]*[.=]`);

/** A TOML key as written: a basic string, a literal string or a bare key. @param {string} tok */
function tomlKey(tok) {
  if (tok.startsWith("'")) return tok.slice(1, -1);
  if (tok.startsWith('"')) {
    try {
      return JSON.parse(tok);
    } catch {
      return tok.slice(1, -1);
    }
  }
  return tok;
}

/**
 * The server names of a config.toml in the order tomllib's dict holds them: the order each is first
 * defined in the text, by an [mcp_servers.<name>] header, a key of the [mcp_servers] table, or a dotted
 * mcp_servers.<name> key at the top level. A plain JavaScript object lists integer-like keys first (PR #520
 * QA B1), so a TOML read is put back in document order before anything iterates over it.
 * @param {string} text
 */
export function serverOrder(text) {
  /** @type {string[]} */
  const order = [];
  /** @type {'root' | 'servers' | 'other'} */
  let table = 'root';
  /** @param {string} k */
  const add = (k) => {
    if (!order.includes(k)) order.push(k);
  };
  for (const ln of text.split('\n')) {
    const header = SERVER_HEADER.exec(ln);
    if (header) {
      add(tomlKey(header[1]));
      table = 'other';
      continue;
    }
    if (SERVERS_TABLE.test(ln)) {
      table = 'servers';
      continue;
    }
    if (ANY_HEADER.test(ln)) {
      table = 'other';
      continue;
    }
    const m = table === 'servers' ? KEY_IN_SERVERS.exec(ln) : table === 'root' ? DOTTED_AT_ROOT.exec(ln) : null;
    if (m) add(tomlKey(m[1]));
  }
  return order;
}

/**
 * tomllib.loads(text).get("mcp_servers", {}) with its servers in document order (a Map), or the value as
 * it is when it is not a table.
 * @param {string} text
 */
export function tomlServers(text) {
  const servers = get(tomlLoads(text), 'mcp_servers', dict());
  if (!isD(servers)) return servers;
  const out = dict();
  for (const k of serverOrder(text)) if (has(servers, k)) out.set(k, get(servers, k));
  for (const [k, v] of entries(servers)) if (!out.has(k)) out.set(k, v);
  return out;
}

/** shutil.which(name) on POSIX and Windows, relative PATH entries made absolute (QA P8). @param {string} name @param {Ctx} ctx */
export function pyWhich(name, ctx) {
  const win = ctx.platform === 'win32';
  const value = ctx.env.PATH ?? (win ? ctx.env.Path : undefined);
  if (value === undefined) return null;
  const exts = win ? (ctx.env.PATHEXT || '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean) : [''];
  for (const dir of value.split(win ? ';' : ':')) {
    for (const ext of exts) {
      const p = path.resolve(ctx.cwd, dir, name + ext.toLowerCase());
      try {
        if (!win) fs.accessSync(p, fs.constants.X_OK);
        if (!fs.statSync(p).isDirectory()) return p;
      } catch {
        // not here
      }
    }
  }
  return null;
}

// ------------------------------------------------------------------------------------------- paths

/** os.path.expanduser("~"). @param {Ctx} ctx */
export function home(ctx) {
  const e = ctx.env;
  if (ctx.platform === 'win32') {
    if (e.USERPROFILE !== undefined) return e.USERPROFILE;
    if (e.HOMEPATH !== undefined) return (e.HOMEDRIVE || '') + e.HOMEPATH;
    return os.homedir();
  }
  return e.HOME === undefined ? os.homedir() : e.HOME;
}
/** @param {Ctx} ctx */
export const dataDir = (ctx) => path.join(ctx.env.XDG_DATA_HOME || path.join(home(ctx), '.local', 'share'), PROJECT);
/** @param {Ctx} ctx */
export const defaultSource = (ctx) => path.join(dataDir(ctx), 'local-overlay', 'mcp-servers.json');
/** @param {Ctx} ctx */
export const manifestPath = (ctx) => path.join(dataDir(ctx), 'mcp-managed.json');
/** @param {Ctx} ctx */
export const launcherDest = (ctx) => path.join(dataDir(ctx), LAUNCHER_NAME);
/** @param {Ctx} ctx */
const legacyLauncher = (ctx) => path.join(dataDir(ctx), LEGACY_LAUNCHER);

/**
 * (config file, directory whose existence means the surface is installed), or null.
 * @param {string} surface @param {Ctx} ctx @returns {[string, string] | null}
 */
export function surfaceTarget(surface, ctx) {
  const h = home(ctx);
  if (surface === 'codex') {
    const d = ctx.env.CODEX_HOME || path.join(h, '.codex');
    return [path.join(d, 'config.toml'), d];
  }
  if (surface === 'claude-code') return [path.join(h, '.claude.json'), path.join(h, '.claude')];
  if (surface === 'claude-desktop') {
    let d;
    if (ctx.platform === 'darwin') d = path.join(h, 'Library', 'Application Support', 'Claude');
    else if (ctx.platform === 'win32' && ctx.env.APPDATA) d = path.join(ctx.env.APPDATA, 'Claude');
    else return null; // no desktop app is published for this OS
    return [path.join(d, 'claude_desktop_config.json'), d];
  }
  if (surface === 'kiro') return [path.join(h, '.kiro', 'settings', 'mcp.json'), path.join(h, '.kiro')];
  throw new Error('unknown surface ' + surface);
}

/**
 * The node that runs the launcher, as an absolute path: the node running mhw (bin/mhw.js passes its own
 * path in MHW_NODE), else the first node on PATH; null when there is none. An absolute MHW_NODE that is
 * not an executable file is refused (exit 2), never replaced by another node (install.sh's lookup, #481).
 * node on PATH, when it is the same file as MHW_NODE, is the stable name and is the one rendered (PR #516 A1).
 * @param {Ctx} ctx
 */
export function nodeBinary(ctx) {
  const node = ctx.env.MHW_NODE || '';
  if (path.isAbsolute(node)) {
    let ok = false;
    try {
      ok = fs.statSync(node).isFile();
      if (ok && ctx.platform !== 'win32') fs.accessSync(node, fs.constants.X_OK);
    } catch {
      ok = false;
    }
    if (ok) {
      const found = pyWhich('node', ctx);
      if (found && path.isAbsolute(found) && real(found, ctx) === real(node, ctx)) return found;
      return node;
    }
    throw new Refuse(2, 'REFUSE  the MCP launcher: MHW_NODE (' + node + ') is not an executable file; nothing written');
  }
  return pyWhich('node', ctx);
}
/** os.path.realpath. @param {string} p @param {Ctx} ctx */
const real = (p, ctx) => realpathLoose(p, { cwd: ctx.cwd, platform: ctx.platform, env: ctx.env });

/**
 * [node, the installed launcher copy] when a server of the definition has secrets, else null. A definition
 * with secrets and no node is refused (exit 2) before anything is written; with required=false (the active
 * set, which only compares entries) the bare word node stands in, whatever the lookup says (PR #516 O1).
 * @param {Dict} doc @param {Ctx} ctx @param {boolean} [required]
 * @returns {[string, string] | null}
 */
export function launcherFor(doc, ctx, required = true) {
  if (!entries(get(doc, 'servers')).some(([, s]) => truthy(get(s, 'secrets')))) return null;
  if (!required) {
    let node = null;
    try {
      node = nodeBinary(ctx);
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
    }
    return [node || 'node', launcherDest(ctx)];
  }
  const node = nodeBinary(ctx);
  if (node === null) {
    throw new Refuse(2, 'a server with secrets is started by the Node launcher (mhw mcp launch, #483), and no node '
      + 'was found (MHW_NODE, or node on PATH); install Node 26 or later');
  }
  return [node, launcherDest(ctx)];
}

/** current_version of .bumpversion.toml. */
function version() {
  const text = readText(path.join(ROOT, '.bumpversion.toml'));
  const m = /^current_version\s*=\s*"(\d[\d.]*)"/m.exec(text);
  if (!m) throw new Refuse(2, 'cannot read current_version from .bumpversion.toml');
  return m[1];
}

const NUMERIC_TAG_RE = /^v\d+\.\d+\.\d+$/;
const STAMP_RE = /; (release: [^;"]*; commit: [^;"]*);/;

/**
 * The provenance stamp (Issue #66, ADR-0029), by the rule global/install.sh applies: release vX.Y.Z on a
 * clean checkout exactly at a numeric tag, otherwise "unreleased, after <nearest tag>" (or "no tag
 * reachable"); the full HEAD SHA, plus "-dirty" when a tracked file is modified.
 * @param {Ctx} ctx
 */
export function provenance(ctx) {
  const git = pyWhich('git', ctx);
  /** @param {string[]} args @returns {string | null} */
  const run = (...args) => {
    if (!git) return null;
    const p = spawnSync(git, ['-C', ROOT, ...args], { encoding: 'utf8', env: /** @type {NodeJS.ProcessEnv} */ (ctx.env) });
    return p.status === 0 && !p.error ? pyStrip(p.stdout) : null;
  };
  const commit = run('rev-parse', '--is-inside-work-tree') ? run('rev-parse', '--verify', 'HEAD') : null;
  if (!commit) return 'release: unknown, not a git checkout (.bumpversion.toml says ' + version() + '); commit: unknown';
  const dirty = run('status', '--porcelain', '--untracked-files=no') ? '-dirty' : '';
  const glob = 'v[0-9]*.[0-9]*.[0-9]*';
  const exact = dirty ? null : run('describe', '--tags', '--exact-match', '--match', glob, 'HEAD');
  const near = run('describe', '--tags', '--abbrev=0', '--match', glob, 'HEAD');
  let release;
  if (exact && NUMERIC_TAG_RE.test(exact)) release = exact;
  else if (near && NUMERIC_TAG_RE.test(near)) release = 'unreleased, after ' + near;
  else release = 'unreleased, no tag reachable';
  return 'release: ' + release + '; commit: ' + commit + dirty;
}

/** The release and commit fields of the first managed-by line in text, or "none". @param {string} text */
export function stampOf(text) {
  for (const line of splitLines(text)) {
    if (line.includes(MARKER_ID)) {
      const m = STAMP_RE.exec(line);
      return m ? m[1] : 'none';
    }
  }
  return 'none';
}

// -------------------------------------------------------------------------------------- definition

/** @param {string} s */
const noControl = (s) => ![...s].some((c) => /** @type {number} */ (c.codePointAt(0)) < 0x20 || c === '\x7f');
/** @param {unknown} v @returns {v is string} */
const isStr = (v) => typeof v === 'string';

/**
 * The human-readable errors of a definition; empty means valid. covered: name -> the surfaces a policy
 * server is rendered on (policySurfaces), which count towards the active set's parity.
 * @param {unknown} doc @param {string} platform @param {Map<string, Set<string>>} [covered]
 * @returns {string[]}
 */
export function validate(doc, platform, covered = new Map()) {
  /** @type {string[]} */
  const errs = [];
  if (!isD(doc)) return ['the definition must be a JSON object'];
  for (const k of keysOf(doc)) if (!SOURCE_KEYS.has(k)) errs.push('unknown top-level key ' + r(k));
  if (!pyEq(get(doc, 'version'), 1)) errs.push('"version" must be 1');
  const servers = get(doc, 'servers');
  if (!isD(servers)) return [...errs, '"servers" must be an object of name -> server'];
  for (const [name, s] of entries(servers)) {
    const where = 'server ' + r(name);
    if (!NAME_RE.test(name)) errs.push(where + ': the name must match ' + NAME_PATTERN);
    if (!isD(s)) {
      errs.push(where + ': must be an object');
      continue;
    }
    for (const k of keysOf(s)) if (!SERVER_KEYS.has(k)) errs.push(where + ': unknown key ' + r(k));
    const cmd = get(s, 'command');
    if (!isStr(cmd) || !pyStrip(cmd)) errs.push(where + ': "command" must be a non-empty string');
    let args = get(s, 'args', []);
    if (!Array.isArray(args) || !args.every(isStr)) {
      errs.push(where + ': "args" must be a list of strings');
      args = [];
    }
    let env = get(s, 'env', dict());
    if (!isD(env) || !entries(env).every(([, v]) => isStr(v))) {
      errs.push(where + ': "env" must map names to strings');
      env = dict();
    }
    let secrets = get(s, 'secrets', dict());
    if (!isD(secrets) || !entries(secrets).every(([, v]) => isStr(v))) {
      errs.push(where + ': "secrets" must map names to "keychain:<service>" or "env:<VAR>"');
      secrets = dict();
    }
    const surfaces = get(s, 'surfaces', [...SURFACES]);
    if (!Array.isArray(surfaces) || !surfaces.length || surfaces.some((x) => !/** @type {readonly unknown[]} */ (SURFACES).includes(x))) {
      errs.push(where + ': "surfaces" must be a non-empty list of ' + SURFACES.join(', '));
    }
    let reviewed = get(s, 'not_secret', []);
    if (!Array.isArray(reviewed) || !reviewed.every(isStr)) {
      errs.push(where + ': "not_secret" must be a list of strings');
      reviewed = [];
    }
    const envKeys = keysOf(env);
    const envVals = entries(env).map(([, v]) => v);
    const strings = [cmd, ...args, ...envKeys, ...envVals, ...keysOf(secrets), ...entries(secrets).map(([, v]) => v)].filter(isStr);
    if (!strings.every(noControl)) errs.push(where + ': a control character is in a string');
    for (const k of envKeys) {
      if (!ENV_RE.test(k)) errs.push(where + ': env name ' + r(k) + ' is not a valid variable name');
      else if (CRED_RE.test(k) && !reviewed.includes(k)) {
        errs.push(where + ': env ' + r(k) + ' looks like a credential, so its value may not be written in plain text. '
          + 'Move it to "secrets", or list it in "not_secret" if it is not one');
      }
    }
    if (isStr(cmd) && looksLikeCredentialValue(cmd)) errs.push(where + ': "command" carries a credential-looking value (not shown)');
    for (const [k, v] of entries(env)) {
      if (looksLikeCredentialValue(v)) {
        errs.push(where + ': the value of env ' + r(k) + ' looks like a credential (not shown). Put the whole value in '
          + 'the Keychain and reference it under "secrets"');
      }
    }
    args.forEach((/** @type {string} */ a, /** @type {number} */ i) => {
      if (looksLikeCredentialValue(a)) {
        errs.push(where + ': args[' + i + '] looks like a credential (not shown). Pass it through "secrets" (an '
          + 'environment variable) instead of the command line');
      }
    });
    args.forEach((/** @type {string} */ a, /** @type {number} */ i) => {
      const m = ARG_FLAG_RE.exec(a);
      if (m && CRED_RE.test(m[1]) && !reviewed.includes(m[1])) {
        errs.push(where + ': args[' + i + '] flag ' + r(m[1]) + ' looks like it carries a credential on the command line. '
          + 'Pass it through "secrets" (an environment variable), or list the flag in "not_secret" if it is not one');
      }
    });
    for (const [k, src] of entries(secrets)) {
      if (!ENV_RE.test(k)) errs.push(where + ': secret name ' + r(k) + ' is not a valid variable name');
      if (has(env, k)) errs.push(where + ': ' + r(k) + ' is both in env and in secrets');
      if (src.startsWith('keychain:')) {
        if (!SERVICE_RE.test(src.slice('keychain:'.length))) {
          errs.push(where + ': secret ' + r(k) + ': the Keychain service must match ' + SERVICE_PATTERN);
        } else if (platform !== 'darwin') {
          errs.push(where + ': secret ' + r(k) + ': keychain: is macOS only; use env:<VAR> on this OS');
        }
      } else if (src.startsWith('env:')) {
        if (!ENV_RE.test(src.slice('env:'.length))) errs.push(where + ': secret ' + r(k) + ': ' + r(src) + ' is not a valid variable name');
      } else {
        errs.push(where + ': secret ' + r(k) + ': the source must be "keychain:<service>" or "env:<VAR>"');
      }
    }
    if (truthy(secrets) && platform === 'win32') errs.push(where + ': secrets are not supported on Windows (the launcher is not rendered there)');
    if (has(doc, 'active_set') && Array.isArray(surfaces)
      && PARITY.some((x) => !surfaces.some((y) => pyEq(y, x)) && !(covered.get(name) || new Set()).has(x))) {
      errs.push(where + ': the active set is on in Claude Code, Codex and Kiro alike (Issue #219, parity), so '
        + '"surfaces" must include ' + PARITY.join(', ') + ', or be left out (a policy server\'s own surfaces count)');
    }
  }
  return [...errs, ...validateActive(get(doc, 'active_set', dict()))];
}

/**
 * The active set's own keys (Issue #219). Only the claude.ai connectors, which are account-level and
 * cannot be read from a local file, are declared here.
 * @param {unknown} active
 */
export function validateActive(active) {
  if (!isD(active)) return ['"active_set" must be an object'];
  const errs = keysOf(active).filter((k) => !ACTIVE_KEYS.has(k)).map((k) => 'active_set: unknown key ' + r(k));
  if (!isStr(get(active, 'description', ''))) errs.push('active_set: "description" must be a string');
  const connectors = get(active, 'connectors', dict());
  if (!isD(connectors)) return [...errs, 'active_set: "connectors" must map a claude.ai connector name to "on" or "off"'];
  for (const [name, state] of entries(connectors)) {
    if (!name || name !== pyStrip(name) || pyLen(name) > 128 || !noControl(name)) {
      errs.push('active_set: connector ' + r(name) + ': the name must be the display name claude.ai shows, without '
        + 'leading or trailing blanks or control characters');
    }
    if (state !== 'on' && state !== 'off') errs.push('active_set: connector ' + r(name) + ': the state must be "on" or "off"');
  }
  return errs;
}

/** The entry of the listing of directory that is the object want names: the same name first, else the same device and inode. @param {string} directory @param {string} name @param {fs.Stats} want */
function listedEntry(directory, name, want) {
  let names;
  try {
    names = fs.readdirSync(directory);
  } catch (e) {
    throw pyOSError(e, directory);
  }
  /** @param {fs.Stats} a */
  const same = (a) => a.dev === want.dev && a.ino === want.ino;
  for (const entry of names) {
    if (entry !== name) continue;
    let st;
    try {
      st = fs.lstatSync(path.join(directory, entry));
    } catch (e) {
      throw pyOSError(e, path.join(directory, entry));
    }
    if (same(st)) return entry;
  }
  for (const entry of names) {
    try {
      if (same(fs.lstatSync(path.join(directory, entry)))) return entry;
    } catch {
      // gone, or not readable: not this one
    }
  }
  throw new PyOSError('FileNotFoundError', '[Errno 2] not listed in its directory: ' + r(path.join(directory, name)));
}

/**
 * The absolute, symlink-free path real, rebuilt from a fixed root and the names the filesystem itself lists,
 * one directory at a time (SonarCloud S8707, S8705). The argument only selects among listed entries,
 * compared by name and inode; no character of it reaches the returned string. Throws a PyOSError
 * (FileNotFoundError when a component is missing).
 * @param {string} realPath @param {string} [platform]
 */
export function trustedPath(realPath, platform = process.platform) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  const root = P.parse(realPath).root;
  const anchors = platform === 'win32' ? [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((c) => c + ':\\') : ['/'];
  const anchor = anchors.find((a) => a.toLowerCase() === root.toLowerCase());
  if (!anchor || !root || !P.isAbsolute(realPath)) {
    throw new PyOSError('FileNotFoundError', '[Errno 2] not an absolute local path: ' + r(realPath));
  }
  let out = anchor;
  let prefix = root;
  for (const name of realPath.slice(root.length).split(P.sep).filter(Boolean)) {
    prefix = P.join(prefix, name);
    let st;
    try {
      st = fs.lstatSync(prefix);
    } catch (e) {
      throw pyOSError(e, prefix);
    }
    out = P.join(out, listedEntry(out, name, st));
  }
  return out;
}

/** The definition's path, rebuilt by trustedPath, once it is a regular file owned by the caller. @param {string} p @param {Ctx} ctx */
function resolveSource(p, ctx) {
  let trusted;
  let st;
  try {
    trusted = trustedPath(real(p, ctx), ctx.platform);
    st = fs.statSync(trusted);
  } catch (e) {
    const err = e instanceof PyOSError ? e : pyOSError(e, p);
    if (err.cls === 'FileNotFoundError') {
      throw new Refuse(2, 'no MCP definition at ' + p + '. Copy global/mcp/mcp-servers.example.json there and edit it '
        + '(the directory is outside every repository)');
    }
    throw new Refuse(2, UNREADABLE(p, err.message));
  }
  if (!st.isFile()) throw new Refuse(2, 'the MCP definition ' + p + ' is not a regular file');
  if (typeof process.getuid === 'function' && ctx.platform !== 'win32' && st.uid !== process.getuid()) {
    throw new Refuse(2, 'the MCP definition ' + p + ' is not owned by the user running the renderer');
  }
  return trusted;
}

/** The validated definition. @param {string} p @param {Ctx} ctx */
export function loadSource(p, ctx) {
  const trusted = resolveSource(p, ctx);
  let doc;
  try {
    doc = readJson(trusted);
  } catch (e) {
    throw new Refuse(2, UNREADABLE(p, msgOf(e)));
  }
  const errs = validate(doc, ctx.platform, policySurfaces(loadPolicy()));
  if (errs.length) throw new Refuse(2, 'invalid MCP definition ' + p + ':\n  - ' + errs.join('\n  - '));
  return /** @type {Map<string, any>} */ (doc);
}

/** True when the file sits in a git work tree and is not ignored there: it could be committed. @param {string} p @param {Ctx} ctx */
export function committable(p, ctx) {
  const git = pyWhich('git', ctx);
  if (!git) return false;
  let d;
  try {
    d = trustedPath(real(path.dirname(path.resolve(ctx.cwd, p)), ctx), ctx.platform);
  } catch (e) {
    const err = e instanceof PyOSError ? e : pyOSError(e, p);
    if (err.cls === 'FileNotFoundError') return false;
    throw new Refuse(2, UNREADABLE(p, err.message));
  }
  const env = /** @type {NodeJS.ProcessEnv} */ (ctx.env);
  const w = spawnSync(git, ['-C', d, 'rev-parse', '--is-inside-work-tree'], { encoding: 'utf8', env });
  if (w.status !== 0 || pyStrip(w.stdout || '') !== 'true') return false;
  // The file is named on stdin, NUL-terminated, never in argv: it is data to git, never an option.
  const c = spawnSync(git, ['-C', d, 'check-ignore', '--stdin', '-z', '-q'], { input: path.resolve(ctx.cwd, p) + '\0', env });
  return c.status !== 0;
}

// --------------------------------------------------------------------------------------- rendering

/**
 * The command, args, env and forwarded variables one surface runs for this server.
 * @param {Dict} server @param {[string, string] | null} launcher
 */
function effective(server, launcher) {
  const secrets = get(server, 'secrets', dict());
  let command = get(server, 'command');
  let args = [...get(server, 'args', [])];
  if (truthy(secrets)) {
    const [node, script] = /** @type {[string, string]} */ (launcher);
    const wrapped = [script];
    for (const name of sorted(keysOf(secrets))) wrapped.push('--secret', name + '=' + get(secrets, name));
    args = [...wrapped, '--', command, ...args];
    command = node;
  }
  const envVars = sorted(new Set(entries(secrets).map(([, v]) => v).filter((v) => isStr(v) && v.startsWith('env:')).map((v) => v.slice(4))));
  return { command, args, env: dict(entries(get(server, 'env', dict()))), envVars };
}

/** One surface's entry for one server. @param {string} surface @param {Dict} server @param {[string, string] | null} launcher */
export function entry(surface, server, launcher) {
  const { command, args, env, envVars } = effective(server, launcher);
  const e = dict();
  if (surface === 'claude-code') e.set('type', 'stdio');
  e.set('command', command);
  e.set('args', args);
  if (env.size) e.set('env', env);
  if (surface === 'codex' && envVars.length) e.set('env_vars', envVars);
  return e;
}

/** @param {Dict} s */
const serverSurfaces = (s) => get(s, 'surfaces', [...SURFACES]);

/** name -> entry for the servers this surface carries. @param {Dict} doc @param {string} surface @param {[string, string] | null} launcher */
export function desired(doc, surface, launcher) {
  return dict(entries(get(doc, 'servers')).filter(([, s]) => pyIn(surface, serverSurfaces(s))).map(([n, s]) => [n, entry(surface, s, launcher)]));
}

/** name -> the surfaces a policy server (ADR-0038) is rendered on. @param {Dict} policyDoc @returns {Map<string, Set<string>>} */
export function policySurfaces(policyDoc) {
  return new Map(entries(get(policyDoc, 'servers')).map(([n, s]) => [n, new Set(get(s, 'surfaces'))]));
}

/**
 * The local definition's entries for one surface, without a policy server on a surface the policy names.
 * @param {Dict} doc @param {string} surface @param {[string, string] | null} launcher @param {Map<string, Set<string>>} covered
 */
export function localDesired(doc, surface, launcher, covered) {
  return dict([...desired(doc, surface, launcher)].filter(([n]) => !(covered.get(n) || new Set()).has(surface)));
}

/**
 * name -> the surfaces (sorted) where the local copy of a policy server differs from the policy's own entry.
 * @param {Dict} doc @param {Dict} policyDoc @param {[string, string] | null} launcher
 * @returns {Map<string, string[]>}
 */
export function policyConflicts(doc, policyDoc, launcher) {
  const out = new Map();
  const policy = get(policyDoc, 'servers');
  for (const [n, s] of entries(get(doc, 'servers'))) {
    if (!has(policy, n)) continue;
    const mine = new Set(serverSurfaces(s));
    const theirs = new Set(get(get(policy, n), 'surfaces'));
    for (const surface of sorted([...mine].filter((x) => theirs.has(x)))) {
      if (!pyEq(entry(surface, s, launcher), entry(surface, get(policy, n), null))) {
        if (!out.has(n)) out.set(n, []);
        out.get(n).push(surface);
      }
    }
  }
  return out;
}

/** The block's begin and end line indexes. @param {string[]} lines */
function markers(lines) {
  const begins = [];
  const ends = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].startsWith(BLOCK_BEGIN_PREFIX)) begins.push(i);
    if (rstripChars(lines[i], '\r\n') === BLOCK_END) ends.push(i);
  }
  return { begins, ends };
}

/**
 * The copies mhw wrote earlier of these servers on one surface, as they are now: kept unchanged for a
 * refused server. An empty map when the file cannot be read or parsed (the surface's own run refuses that).
 * @param {string} surface @param {string} file @param {Set<string>} names @param {string[]} managedBefore
 * @returns {Map<string, any>}
 */
function heldCopies(surface, file, names, managedBefore) {
  if (!names.size) return dict();
  let text;
  try {
    text = readText(file);
  } catch {
    return dict();
  }
  /** @type {any} */
  let ours;
  if (surface === 'codex') {
    const lines = splitKeep(text);
    const { begins, ends } = markers(lines);
    if (begins.length !== 1 || ends.length !== 1 || begins[0] > ends[0]) return dict();
    try {
      ours = get(tomlLoads(lines.slice(begins[0], ends[0] + 1).join('')), 'mcp_servers', dict());
    } catch {
      return dict();
    }
  } else {
    let doc;
    try {
      doc = loads(text, { ordered: true });
    } catch {
      return dict();
    }
    if (!isD(doc)) return dict();
    const current = get(doc, 'mcpServers', dict());
    ours = dict(managedBefore.filter((n) => isD(current) && has(current, n)).map((n) => [n, get(current, n)]));
  }
  if (!isD(ours)) return dict();
  return dict(sorted(names).filter((n) => has(ours, n)).map((n) => [n, get(ours, n)]));
}

/** json.dumps(s) of a TOML string: JSON's escapes are valid in a TOML basic string. @param {unknown} s */
const tomlStr = (s) => dumps(s, { ensureAscii: true });

/** The managed block. stamp: the provenance stamp (ADR-0029), written into the opening marker line. @param {Map<string, any>} servers @param {string | null} [stamp] */
export function tomlBlock(servers, stamp = null) {
  const lines = [stamp ? BLOCK_BEGIN.replace(' (mcp servers); ', ' (mcp servers); ' + stamp + '; ') : BLOCK_BEGIN];
  for (const [name, e] of servers) {
    lines.push('[mcp_servers.' + name + ']');
    lines.push('command = ' + tomlStr(get(e, 'command')));
    lines.push('args = [' + (get(e, 'args') || []).map(tomlStr).join(', ') + ']');
    const env = get(e, 'env');
    if (truthy(env)) lines.push('env = { ' + entries(env).map(([k, v]) => k + ' = ' + tomlStr(v)).join(', ') + ' }');
    const vars = get(e, 'env_vars');
    if (truthy(vars)) lines.push('env_vars = [' + vars.map(tomlStr).join(', ') + ']');
    lines.push('');
  }
  if (lines[lines.length - 1] === '') lines.pop();
  lines.push(BLOCK_END);
  return lines.join('\n') + '\n';
}

/** A copy of parsed without these mcp_servers (and without mcp_servers once it is empty). @param {any} parsed @param {Iterable<string>} names */
function without(parsed, names) {
  const p = deepCopy(parsed);
  const servers = get(p, 'mcp_servers');
  if (isD(servers)) {
    for (const n of names) del(servers, n);
    if (!keysOf(servers).length) del(p, 'mcp_servers');
  }
  return p;
}

/**
 * The new config.toml text, and the block's servers before. Every edit is proved by a parse before it is accepted.
 * @param {string} oldText @param {Map<string, any>} want @param {string | null} [stamp]
 * @returns {[string, any]}
 */
export function codexPlan(oldText, want, stamp = null) {
  const lines = splitKeep(oldText);
  const { begins, ends } = markers(lines);
  let blockText;
  let outside;
  if (!begins.length && !ends.length) {
    if (!want.size) return [oldText, dict()];
    blockText = '';
    outside = oldText;
  } else if (begins.length === 1 && ends.length === 1 && begins[0] < ends[0]) {
    blockText = lines.slice(begins[0], ends[0] + 1).join('');
    outside = [...lines.slice(0, begins[0]), ...lines.slice(ends[0] + 1)].join('');
  } else {
    throw new Refuse(3, "the managed block's markers are damaged (missing, repeated or out of order); "
      + 'fix or remove them by hand, then re-run');
  }
  let old;
  let out;
  let oursBefore;
  try {
    old = tomlLoads(oldText);
    out = tomlLoads(outside);
    oursBefore = tomlServers(blockText);
  } catch (e) {
    throw new Refuse(3, 'not valid TOML (' + msgOf(e) + '); left untouched');
  }
  if (!pyEq(without(old, isD(oursBefore) ? keysOf(oursBefore) : []), out)) {
    throw new Refuse(3, 'content after the managed block is parsed into its last table, so moving the block '
      + 'would change what that content means; move it above the block by hand');
  }
  const outServers = get(out, 'mcp_servers', dict());
  const hand = [...want.keys()].filter((n) => pyIn(n, outServers));
  if (hand.length) {
    throw new Refuse(3, 'server(s) ' + hand.join(', ') + ' are also configured outside the managed block, by hand. Codex refuses '
      + 'to load a config with a duplicate table, so nothing was written: remove those tables '
      + '(after moving any credential to the Keychain), then re-run');
  }
  const base = rstripChars(outside, '\n');
  let newText;
  if (want.size) newText = (base ? base + '\n\n' : '') + tomlBlock(want, stamp);
  else newText = base ? base + '\n' : '';
  let parsed;
  try {
    parsed = tomlLoads(newText);
  } catch (e) {
    throw new Refuse(3, 'the rendered TOML does not parse (' + msgOf(e) + '); nothing written');
  }
  const got = get(parsed, 'mcp_servers', dict());
  if (!pyEq(without(parsed, want.keys()), out) || [...want].some(([n, e]) => !pyEq(get(got, n), e))) {
    throw new Refuse(3, 'the rendered TOML does not parse back to the intended content; nothing written');
  }
  return [newText, oursBefore];
}

/**
 * The new JSON document. @param {Map<string, any>} data @param {Map<string, any>} want @param {string[]} managedBefore @param {boolean} adopt
 */
export function jsonPlan(data, want, managedBefore, adopt) {
  const current = get(data, 'mcpServers', dict());
  if (!isD(current)) throw new Refuse(3, 'its mcpServers is not an object; left untouched');
  const hand = [...want.keys()].filter((n) => has(current, n) && !managedBefore.includes(n) && !pyEq(get(current, n), want.get(n)));
  if (hand.length && !adopt) {
    throw new Refuse(3, 'server(s) ' + hand.join(', ') + ' already exist and are not managed by this project. Re-run with --adopt '
      + 'to replace them (a backup is kept), or rename them in the definition');
  }
  const servers = dict(entries(current));
  for (const n of managedBefore) if (!want.has(n)) servers.delete(n);
  for (const [n, e] of want) servers.set(n, e);
  const next = dict(entries(data));
  if (servers.size || has(data, 'mcpServers')) next.set('mcpServers', servers);
  return next;
}

// ------------------------------------------------------------------------------------------ writing

/**
 * Write text whole, replacing the file in one rename; the previous file is kept beside it, owner-only
 * (privateCopy), when backup is set. The file keeps its mode; a new one is 0600.
 * @param {string} file @param {string} text @param {boolean} backup @param {string} [suffix] @param {Ctx} [ctx]
 */
export function atomicWrite(file, text, backup, suffix = BACKUP, ctx = undefined) {
  const platform = ctx ? ctx.platform : process.platform;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let mode = 0o600;
  if (exists(file)) {
    mode = fs.statSync(file).mode & 0o7777;
    if (backup) privateCopy(file, file + suffix, ctx ? { platform, env: ctx.env } : {});
  }
  const tmp = file + '.new.' + process.pid;
  try {
    const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_TRUNC, mode);
    try {
      fs.writeSync(fd, platform === 'win32' ? text.replaceAll('\n', '\r\n') : text);
    } finally {
      fs.closeSync(fd);
    }
    fs.chmodSync(tmp, mode);
    fs.renameSync(tmp, file);
  } catch (e) {
    if (exists(tmp)) fs.unlinkSync(tmp);
    throw e;
  }
}

/** "add a, b; update c; remove d", or "no server change". @param {Dict} before @param {Dict} after */
function changeSummary(before, after) {
  const added = keysOf(after).filter((n) => !has(before, n));
  const removed = keysOf(before).filter((n) => !has(after, n));
  const changed = keysOf(after).filter((n) => has(before, n) && !pyEq(get(before, n), get(after, n)));
  const parts = [];
  for (const [label, names] of /** @type {[string, string[]][]} */ ([['add', added], ['update', changed], ['remove', removed]])) {
    if (names.length) parts.push(label + ' ' + names.join(', '));
  }
  return parts.join('; ') || 'no server change';
}

/** @param {string} p @param {string} root @param {Ctx} ctx */
function inside(p, root, ctx) {
  const a = real(p, ctx);
  const b = real(root, ctx);
  return a === b || a.startsWith(rstripChars(b, path.sep) + path.sep);
}

/**
 * An agent session may render only into a throwaway HOME: never the owner's real one, never an ancestor of
 * it, and never a write target outside that HOME (CODEX_HOME, XDG_DATA_HOME and APPDATA all move targets).
 * A speed bump keyed on environment markers, not a control.
 * @param {string} homeDir @param {string[]} targets @param {Record<string, string | undefined>} env
 * @param {string | null} realHome @param {Ctx} ctx
 */
export function ownerActRefusal(homeDir, targets, env, realHome, ctx) {
  if (!AGENT_ENV.some((v) => env[v])) return null;
  const why = "writing harness configs outside a throwaway HOME is the owner's act (ADR-0017), and this process "
    + 'runs inside an agent session. Run it from your own terminal';
  if (realHome && inside(realHome, homeDir, ctx)) return why + ' (HOME is the real home, or contains it)';
  const outside = targets.filter((t) => !inside(t, homeDir, ctx));
  if (outside.length) return why + ' (' + outside[0] + ' is outside HOME)';
  return null;
}

/** pwd.getpwuid(os.getuid()).pw_dir, or null where there is no pwd module. @param {Ctx} ctx */
function realHomeDir(ctx) {
  if (ctx.platform === 'win32') return null;
  try {
    return os.userInfo().homedir;
  } catch {
    return null;
  }
}

/** "%-7s %s%s". @param {string} word @param {string} p @param {string} [extra] */
const line = (word, p, extra = '') => word.padEnd(7) + ' ' + p + (extra ? ' (' + extra + ')' : '');

class Run {
  /** @param {string} mode @param {boolean} adopt @param {string} stamp @param {Ctx} ctx */
  constructor(mode, adopt, stamp, ctx) {
    this.mode = mode;
    this.adopt = adopt;
    this.status = 0;
    this.stamp = stamp;
    this.ctx = ctx;
  }

  /** @param {number} code */
  raise(code) {
    this.status = Math.max(this.status, code);
  }

  /** @param {string} word @param {string} p @param {string} [extra] */
  say(word, p, extra = '') {
    this.ctx.out(line(word, p, extra) + '\n');
  }

  /** @param {string} p @param {string} msg @param {number} code */
  refuse(p, msg, code) {
    this.ctx.err('REFUSE  ' + p + ': ' + msg + '\n');
    this.raise(code);
  }

  /** Matching content under another provenance stamp (ADR-0029): STAMP in --check; rewritten otherwise. @param {string} p @param {string} installed */
  restamp(p, installed) {
    if (this.mode === 'check') {
      this.ctx.out('STAMP   ' + p + ': content matches, but it carries (' + installed + ') and the source is (' + this.stamp + ')\n');
      this.raise(1);
      return false;
    }
    return true;
  }

  /** @param {string} p @param {string} newText @param {boolean} existed @param {string} summary @param {string} show */
  apply(p, newText, existed, summary, show) {
    if (this.mode === 'check') {
      this.say(existed ? 'DRIFT' : 'MISSING', p, summary);
      this.raise(1);
    } else if (this.mode === 'dry-run') {
      this.ctx.out('WOULD WRITE ' + p + ' (' + summary + "). Only this project's entries are shown, never a current value:\n");
      this.ctx.out('----- begin ' + p + '\n' + show + '----- end ' + p + '\n');
    } else {
      atomicWrite(p, newText, true, BACKUP, this.ctx);
      this.say('WROTE', p, summary + (existed ? '; previous version kept as .pmhwc-backup' : ''));
    }
  }

  /** The installed launcher copy; false when an unmanaged file is in its place. */
  launcher() {
    const dest = launcherDest(this.ctx);
    const src = readText(LAUNCHER_SRC);
    const nl = src.indexOf('\n');
    const text = src.slice(0, nl) + '\n// ' + MARKER_ID + '; source: ' + LAUNCHER_SRC_REL + '; ' + this.stamp
      + '; do not edit, re-run the renderer\n' + src.slice(nl + 1);
    if (exists(dest)) {
      const current = readLoose(dest);
      if (!splitKeep(current).slice(0, 5).join('').includes(MARKER_ID)) {
        this.refuse(dest, 'exists and is NOT managed by this project; move it aside. No surface was '
          + 'rendered, because every secret-bearing entry would execute that file', 3);
        return false;
      }
      const ownerOnly = (fs.statSync(dest).mode & 0o7777) === 0o700;
      if (current === text && ownerOnly) {
        this.say('OK', dest, this.stamp);
        return true;
      }
      if (unstamp(current) === unstamp(text) && ownerOnly && !this.restamp(dest, stampOf(current))) return true;
    }
    if (this.mode === 'check') {
      this.say(exists(dest) ? 'DRIFT' : 'MISSING', dest);
      this.raise(1);
    } else if (this.mode === 'dry-run') {
      this.ctx.out('WOULD WRITE ' + dest + ' (the credential launcher, ' + pyLen(text) + ' bytes)\n');
    } else {
      atomicWrite(dest, text, false, BACKUP, this.ctx);
      fs.chmodSync(dest, 0o700); // owner-only: only the owner's own harness processes run it
      this.say('WROTE', dest);
    }
    return true;
  }

  /**
   * The shell launcher an earlier release installed (#483), once nothing can still run it. Only a file
   * carrying this project's marker; removed only when this run refused nothing and no surface config still
   * names its path (PR #516 lens B2).
   * @param {string[]} configs
   */
  retireLegacy(configs) {
    const old = legacyLauncher(this.ctx);
    let head;
    try {
      head = readLoose(old).split(/(?<=\n)/).slice(0, 5).join('');
    } catch {
      return;
    }
    if (!head.includes(MARKER_ID)) return;
    if (this.mode === 'check') {
      this.say('STALE', old, 'the retired shell launcher; install removes it');
      this.raise(1);
      return;
    }
    const named = [];
    for (const p of configs) {
      try {
        if (readLoose(p).includes(old)) named.push(p);
      } catch {
        // unreadable or absent: names nothing
      }
    }
    let why = '';
    if (this.status) why = 'this run refused something, and what it left as it was may still start it';
    else if (named.length && this.mode !== 'dry-run') why = 'still named by ' + named.join(', ');
    if (why) this.say('KEPT', old, 'the retired shell launcher; ' + why);
    else if (this.mode === 'dry-run') this.ctx.out('WOULD REMOVE ' + old + ' (the retired shell launcher)\n');
    else {
      fs.unlinkSync(old);
      this.say('REMOVED', old, 'the retired shell launcher');
    }
  }

  /** @param {string} p @param {Map<string, any>} want */
  codex(p, want) {
    const existed = exists(p);
    let oldText;
    try {
      oldText = readText(p);
    } catch (e) {
      if (e instanceof PyOSError && e.cls === 'FileNotFoundError') oldText = '';
      else return this.refuse(p, 'unreadable (' + msgOf(e) + '); left untouched', 3);
    }
    let newText;
    let before;
    try {
      [newText, before] = codexPlan(oldText, want, this.stamp);
    } catch (e) {
      if (e instanceof Refuse) return this.refuse(p, e.message, e.code);
      throw e;
    }
    if (newText === oldText) {
      return this.say('OK', p, want.size ? want.size + ' managed server(s); ' + this.stamp : 'no managed server');
    }
    if (unstamp(newText) === unstamp(oldText) && !this.restamp(p, stampOf(oldText))) return undefined;
    const summary = changeSummary(isD(before) ? before : dict(), want);
    return this.apply(p, newText, existed, summary, want.size ? tomlBlock(want, this.stamp) : '(the managed block is removed)\n');
  }

  /**
   * @param {string} surface @param {string} p @param {Map<string, any>} want @param {Record<string, string[]>} managed
   * @returns {string[] | null}
   */
  jsonSurface(surface, p, want, managed) {
    const existed = exists(p);
    let data = dict();
    if (existed) {
      try {
        data = /** @type {any} */ (readJson(p));
      } catch (e) {
        this.refuse(p, 'not readable JSON (' + msgOf(e) + '); left untouched', 3);
        return null;
      }
      if (!isD(data)) {
        this.refuse(p, 'not a JSON object; left untouched', 3);
        return null;
      }
    }
    const before = managed[surface] || [];
    let next;
    try {
      next = jsonPlan(/** @type {Map<string, any>} */ (data), want, before, this.adopt);
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      this.refuse(p, e.message, e.code);
      return null;
    }
    if (pyEq(next, data) && (existed || !want.size)) {
      this.say('OK', p, want.size + ' managed server(s)');
      return [...want.keys()];
    }
    const cur = get(data, 'mcpServers');
    const current = isD(cur) ? cur : dict();
    const oldOurs = dict([...before, ...want.keys()].filter((n) => has(current, n)).map((n) => [n, get(current, n)]));
    let summary = changeSummary(oldOurs, want);
    if (existed && this.mode === 'dry-run') summary += '; the file is re-serialized (2-space JSON), so whitespace may change';
    this.apply(p, dumps(next, { indent: 2, sortKeys: false }) + '\n', existed, summary,
      dumps(dict([['mcpServers', want]]), { indent: 2, sortKeys: false }) + '\n');
    return this.mode === 'install' ? [...want.keys()] : null;
  }
}

/** @param {Ctx} ctx */
const shape = (ctx) => new Refuse(3, 'the managed-server manifest ' + manifestPath(ctx) + ' has an unexpected shape');

/**
 * The whole manifest, validated: the local definition's names and stamps, the policy servers' own
 * (ADR-0038) and what the active set turned off, kept apart so no mode removes another's servers.
 * @param {Ctx} ctx @returns {Map<string, any>}
 */
export function loadManifestDoc(ctx) {
  let m;
  try {
    m = readJson(manifestPath(ctx));
  } catch (e) {
    if (e instanceof PyOSError && e.cls === 'FileNotFoundError') return dict();
    throw new Refuse(3, 'the managed-server manifest ' + manifestPath(ctx) + ' is unreadable (' + msgOf(e) + ')');
  }
  const surfaces = isD(m) ? get(m, 'surfaces', dict()) : null;
  if (!isD(surfaces) || !entries(surfaces).every(([, v]) => Array.isArray(v))) throw shape(ctx);
  for (const [key, kind] of /** @type {[string, string][]} */ ([['stamps', 'str'], ['policy_stamps', 'str'], ['policy', 'list']])) {
    const v = get(m, key, dict());
    if (!isD(v) || !entries(v).every(([, x]) => (kind === 'str' ? isStr(x) : Array.isArray(x)))) throw shape(ctx);
  }
  if (!isD(get(m, 'active', dict()))) throw shape(ctx);
  return /** @type {Map<string, any>} */ (m);
}

/** @param {Map<string, any>} doc @param {Ctx} ctx */
export function writeManifest(doc, ctx) {
  const out = dict([['version', 1]]);
  for (const key of MANIFEST_KEYS) {
    if (truthy(get(doc, key)) || key === 'surfaces' || key === 'stamps') out.set(key, get(doc, key, dict()));
  }
  atomicWrite(manifestPath(ctx), dumps(out, { indent: 2, sortKeys: false, ensureAscii: true }) + '\n', false, BACKUP, ctx);
}

/** A dict of str -> list[str] as a plain record. @param {unknown} d @returns {Record<string, string[]>} */
function lists(d) {
  /** @type {Record<string, string[]>} */
  const out = Object.create(null);
  if (isD(d)) for (const [k, v] of entries(d)) out[k] = v;
  return out;
}

/**
 * The provenance stamp recorded per JSON surface (ADR-0029), in this project's manifest: those files are
 * the apps' own JSON, with no comment syntax and no field this project has measured each app to ignore.
 * @param {Ctx} ctx @returns {Map<string, any>}
 */
function loadStamps(ctx) {
  try {
    const m = readJson(manifestPath(ctx));
    const s = isD(m) ? get(m, 'stamps', dict()) : null;
    return isD(s) ? dict(entries(s)) : dict();
  } catch {
    return dict();
  }
}

/** @param {string} mode @param {string} source @param {string[]} surfaces @param {boolean} adopt @param {Ctx} ctx */
export function render(mode, source, surfaces, adopt, ctx) {
  if (mode === 'install') {
    const targets = [launcherDest(ctx), manifestPath(ctx)];
    for (const x of surfaces) {
      const t = surfaceTarget(x, ctx);
      if (t) targets.push(t[0]);
    }
    const why = ownerActRefusal(home(ctx), targets, ctx.env, realHomeDir(ctx), ctx);
    if (why) throw new Refuse(2, why);
  }
  if (committable(source, ctx)) {
    throw new Refuse(2, source + ' is inside a git work tree and not ignored, so it could be committed. The definition '
      + 'lives only in the untracked local overlay');
  }
  const doc = loadSource(source, ctx);
  const policyDoc = loadPolicy();
  const covered = policySurfaces(policyDoc);
  const stamp = provenance(ctx);
  ctx.out('SOURCE  ' + stamp + '\n');
  const managed = lists(get(loadManifestDoc(ctx), 'surfaces', dict()));
  const stamps = loadStamps(ctx);
  const run = new Run(mode, adopt, stamp, ctx);
  const launcher = launcherFor(doc, ctx);
  // ADR-0038 amendment (Issue #219): a policy server in the local definition is extended to the surfaces the
  // policy does not name. A local copy that differs from the policy's where both apply is refused alone.
  const conflicts = policyConflicts(doc, policyDoc, launcher);
  for (const n of sorted(conflicts.keys())) {
    const where = /** @type {string[]} */ (conflicts.get(n)).join(', ');
    ctx.err('REFUSE  ' + n + ": a policy server (global/mcp/policy-servers.json, ADR-0038) whose local copy differs "
      + "from the policy's on " + where + ", where the policy's copy runs. Nothing is written for it on any surface "
      + '(a copy mhw wrote earlier is kept as it is); the other servers are rendered. Make the local copy '
      + "match the policy's, or leave " + where + ' out of its "surfaces"\n');
    run.raise(3);
  }
  const secretful = entries(get(doc, 'servers')).some(([, s]) => truthy(get(s, 'secrets')));
  if (secretful && !run.launcher()) return run.status;
  const newManifest = { ...managed };
  const newStamps = dict(entries(stamps));
  for (const surface of surfaces) {
    const target = surfaceTarget(surface, ctx);
    if (target === null) {
      ctx.out('SKIP    ' + surface + ': no published app for this OS\n');
      continue;
    }
    const [p, installedDir] = target;
    if (!isDir(installedDir) && !exists(p)) {
      ctx.out('SKIP    ' + surface + ': not installed (' + installedDir + ' absent)\n');
      continue;
    }
    // A name the policy renders on this surface is the policy's here, even one an earlier render recorded.
    const before = (managed[surface] || []).filter((n) => !(covered.get(n) || new Set()).has(surface));
    const local = localDesired(doc, surface, launcher, covered);
    const want = dict([...local].filter(([n]) => !conflicts.has(n)));
    for (const [n, e] of heldCopies(surface, p, new Set(conflicts.keys()), before)) want.set(n, e);
    const policyHere = sorted([...desired(doc, surface, launcher).keys()].filter((n) => !local.has(n)));
    if (policyHere.length) {
      ctx.out('POLICY  ' + surface + ': ' + policyHere.join(', ') + ' rendered here by the policy servers (mhw mcp render --policy, ADR-0038), not by '
        + 'the local definition\n');
    }
    if (surface === 'codex') {
      run.codex(p, want);
    } else {
      const names = run.jsonSurface(surface, p, want, { ...managed, [surface]: before });
      if (names !== null) {
        newManifest[surface] = names;
        if (!names.length) newStamps.delete(surface);
        else if (stamps.get(surface) !== stamp) {
          if (mode === 'install') newStamps.set(surface, stamp);
          else if (mode === 'check') run.restamp(p + ' (its entries, recorded in ' + manifestPath(ctx) + ')', stamps.has(surface) ? stamps.get(surface) : 'none');
          else ctx.out('WOULD RECORD ' + p + "'s stamp (" + stamp + ') in ' + manifestPath(ctx) + '\n');
        }
      }
    }
    if (surface !== 'codex' && [...want.keys()].some((n) => entries(get(get(get(doc, 'servers'), n), 'secrets', dict())).some(([, v]) => v.startsWith('env:')))) {
      ctx.out('NOTE    ' + surface + ': an env: secret depends on this app passing that variable to the launcher; '
        + 'only Codex is told to (env_vars)\n');
    }
  }
  if (mode === 'install' && (!pyEq(dict(Object.entries(newManifest)), dict(Object.entries(managed))) || !pyEq(newStamps, stamps))) {
    const mdoc = loadManifestDoc(ctx);
    mdoc.set('surfaces', dict(Object.entries(newManifest)));
    mdoc.set('stamps', newStamps);
    writeManifest(mdoc, ctx);
  }
  if (launcher !== null) {
    run.retireLegacy(SURFACES.map((x) => surfaceTarget(x, ctx)).filter((t) => t !== null).map((t) => /** @type {[string, string]} */ (t)[0]));
  }
  return run.status;
}

// ---------------------------------------------------------------------------------- policy servers

/**
 * The tracked policy servers (ADR-0038). Refuse(2) when the file is invalid, or a server names a secret,
 * an owner value or a surface this mode does not render.
 * @param {string} [file]
 */
export function loadPolicy(file = POLICY_SRC) {
  let doc;
  try {
    doc = readJson(file);
  } catch (e) {
    throw new Refuse(2, 'cannot read the policy MCP servers ' + file + ': ' + msgOf(e));
  }
  const errs = validate(doc, 'linux'); // a policy server carries no secret, so keychain rules never apply
  const servers = isD(doc) ? get(doc, 'servers') : null;
  for (const [name, s] of truthy(servers) && isD(servers) ? entries(servers) : []) {
    if (!isD(s)) continue;
    if (truthy(get(s, 'secrets')) || truthy(get(s, 'not_secret'))) errs.push('policy server ' + r(name) + ': a tracked server may not name a secret');
    if (!has(s, 'surfaces')) errs.push('policy server ' + r(name) + ': "surfaces" must be stated');
    else if (pyIn('codex', get(s, 'surfaces', []))) errs.push('policy server ' + r(name) + ': the Codex surface is not rendered for policy servers');
  }
  if (errs.length) throw new Refuse(2, 'invalid policy MCP servers ' + file + ':\n  - ' + errs.join('\n  - '));
  return /** @type {Map<string, any>} */ (doc);
}

/** shlex.quote. @param {string} s */
function shQuote(s) {
  if (!s) return "''";
  if (!/[^\w@%+=:,./-]/.test(s)) return s;
  return "'" + s.replaceAll("'", "'\"'\"'") + "'";
}

/**
 * One server entry as a command line, for an old -> new line. An entry that looks like it carries a
 * credential (which only a hand edit can put there) is named, never shown; env values are never shown.
 * @param {unknown} e
 */
export function describe(e) {
  if (e === null || e === undefined) return 'absent';
  if (!isD(e)) return 'present (not an object)';
  const a = get(e, 'args', []);
  /** @type {unknown[]} */
  let list = [];
  if (Array.isArray(a)) list = a;
  else if (typeof a === 'string') list = [...a];
  else if (isD(a)) list = keysOf(a);
  const parts = [get(e, 'command', ''), ...list].filter(isStr);
  const flags = parts.map((p) => ARG_FLAG_RE.exec(p)).filter((m) => m !== null).map((m) => /** @type {RegExpExecArray} */ (m)[1]);
  if (parts.some(looksLikeCredentialValue) || flags.some((f) => CRED_RE.test(f))) {
    return 'present (not shown: it looks like it carries a credential)';
  }
  let text = parts.map(shQuote).join(' ');
  if (truthy(get(e, 'env'))) text += ' (env: ' + pyLength(get(e, 'env')) + ' value(s), not shown)';
  return text;
}

/**
 * Render, check, preview or remove the policy servers in each JSON surface they name -> exit code.
 * @param {string} mode @param {string | null} stamp @param {Ctx} ctx @param {string} [file]
 */
export function renderPolicy(mode, stamp, ctx, file = POLICY_SRC) {
  if (ctx.platform === 'win32') {
    ctx.out('SKIP    policy MCP servers (ADR-0038): not rendered on Windows\n');
    return 0;
  }
  const doc = loadPolicy(file);
  const st = stamp || provenance(ctx);
  const mdoc = loadManifestDoc(ctx);
  const pol = dict(entries(get(mdoc, 'policy', dict())));
  const pstamps = dict(entries(get(mdoc, 'policy_stamps', dict())));
  let status = 0;
  for (const surface of SURFACES.filter((s) => s !== 'codex')) {
    const want = mode === 'uninstall' ? dict() : desired(doc, surface, null);
    const before = pol.get(surface) || [];
    if (!want.size && !before.length) continue;
    const target = surfaceTarget(surface, ctx);
    if (target === null) {
      ctx.out('SKIP    ' + surface + ': no published app for this OS\n');
      continue;
    }
    const [cfg, installedDir] = target;
    if (!isDir(installedDir) && !exists(cfg)) {
      ctx.out('SKIP    ' + surface + ': not installed (' + installedDir + ' absent)\n');
      continue;
    }
    let data;
    try {
      data = readJson(cfg);
    } catch (e) {
      if (e instanceof PyOSError && e.cls === 'FileNotFoundError') data = dict();
      else {
        ctx.err('REFUSE  ' + cfg + ': not readable JSON (' + clsOf(e) + '); left untouched\n');
        status = Math.max(status, 3);
        continue;
      }
    }
    const current = isD(data) ? get(data, 'mcpServers', dict()) : null;
    if (!isD(current)) {
      ctx.err('REFUSE  ' + cfg + ': not a JSON object with an mcpServers object; left untouched\n');
      status = Math.max(status, 3);
      continue;
    }
    const hand = [...want.keys()].filter((n) => has(current, n) && !before.includes(n) && !pyEq(get(current, n), want.get(n)));
    if (hand.length) {
      ctx.err('REFUSE  ' + cfg + ': server(s) ' + hand.join(', ') + ' already exist and were not written by mhw (by hand, or by '
        + '`claude mcp add`). Remove them, then re-run; nothing was written\n');
      status = Math.max(status, 3);
      continue;
    }
    const names = sorted(new Set([...want.keys(), ...before]));
    const changes = names.filter((n) => !pyEq(get(current, n, null), want.has(n) ? want.get(n) : null))
      .map((n) => [n, get(current, n, null), want.has(n) ? want.get(n) : null]);
    const what = changes.map(([n, o, w]) => n + ' ' + describe(o) + ' -> ' + describe(w)).join('; ');
    if (!changes.length) {
      if (want.size && pstamps.get(surface) !== st) {
        if (mode === 'check') {
          ctx.out('STAMP   ' + cfg + ': policy MCP server(s) match, but recorded under (' + (pstamps.has(surface) ? pstamps.get(surface) : 'none')
            + ') and the source is (' + st + ')\n');
          status = Math.max(status, 1);
          continue;
        }
        if (mode === 'dry-run') {
          ctx.out('WOULD RECORD ' + cfg + "'s policy stamp (" + st + ') in ' + manifestPath(ctx) + '\n');
          continue;
        }
      }
      ctx.out('OK      ' + cfg + ': ' + want.size + ' policy MCP server(s) (ADR-0038)\n');
    } else if (mode === 'check') {
      ctx.out('DRIFT   ' + cfg + ': install would change ' + what + ' (policy MCP servers, ADR-0038)\n');
      status = Math.max(status, 1);
      continue;
    } else if (mode === 'dry-run') {
      ctx.out('WOULD CHANGE ' + cfg + ': ' + what + ' (policy MCP servers; backup ' + path.basename(cfg) + POLICY_BACKUP + ')\n');
      continue;
    } else {
      const next = jsonPlan(/** @type {Map<string, any>} */ (data), want, before, true); // hand-configured names were refused above
      const existed = exists(cfg);
      atomicWrite(cfg, dumps(next, { indent: 2, sortKeys: false }) + '\n', true, POLICY_BACKUP, ctx);
      ctx.out('CHANGED ' + cfg + ': ' + what + ' (policy MCP servers, ADR-0038' + (existed ? '; previous file kept as ' + cfg + POLICY_BACKUP : '') + ')\n');
    }
    if (mode === 'install' || mode === 'uninstall') {
      if (want.size) {
        pol.set(surface, sorted(want.keys()));
        pstamps.set(surface, st);
      } else {
        pol.delete(surface);
        pstamps.delete(surface);
      }
    }
  }
  if ((mode === 'install' || mode === 'uninstall')
    && (!pyEq(pol, get(mdoc, 'policy', dict())) || !pyEq(pstamps, get(mdoc, 'policy_stamps', dict())))) {
    mdoc.set('policy', pol);
    mdoc.set('policy_stamps', pstamps);
    if (MANIFEST_KEYS.some((k) => truthy(get(mdoc, k)))) writeManifest(mdoc, ctx);
    else if (exists(manifestPath(ctx))) {
      fs.unlinkSync(manifestPath(ctx));
      ctx.out('REMOVED ' + manifestPath(ctx) + ' (it recorded only the policy MCP servers)\n');
    }
  }
  return status;
}

// --------------------------------------------------------------------------------------------- scan

/**
 * The locations (never values) inside one server entry that look like a credential.
 * @param {unknown} server @returns {string[]}
 */
export function scanServer(server) {
  if (!isD(server)) return [];
  /** @type {string[]} */
  const out = [];
  /** @param {unknown} obj @param {string} where */
  const walk = (obj, where) => {
    if (!isD(obj)) return;
    for (const [k, v] of entries(obj)) {
      const p = where ? where + '.' + k : String(k);
      if (k === 'env' || k === 'args' || k === 'url') continue;
      if (isStr(v) && v && CRED_RE.test(String(k))) out.push(p);
      else walk(v, p);
    }
  };
  const env = get(server, 'env');
  if (isD(env)) {
    for (const [k, v] of entries(env)) {
      if (isStr(v) && v && (CRED_RE.test(String(k)) || looksLikeCredentialValue(v))) out.push('env.' + k);
    }
  }
  const args = get(server, 'args');
  if (Array.isArray(args)) {
    args.forEach((a, i) => {
      const m = isStr(a) ? ARG_FLAG_RE.exec(a) : null;
      if (isStr(a) && looksLikeCredentialValue(a)) out.push('args[' + i + '] <credential-looking value>');
      else if (m && CRED_RE.test(m[1])) {
        if (m[2] && pyLen(m[2]) > 1) out.push('args[' + i + '] ' + m[1] + '=<value>');
        else if (i + 1 < args.length && isStr(args[i + 1]) && !args[i + 1].startsWith('-')) out.push('args[' + i + '] ' + m[1] + ' <value>');
      }
    });
  }
  const url = get(server, 'url');
  if (isStr(url) && urlCredential(url)) out.push('url (userinfo or a credential-like query parameter)');
  walk(server, '');
  return out;
}

/** @param {string[]} surfaces @param {Ctx} ctx */
export function scan(surfaces, ctx) {
  let found = 0;
  for (const surface of surfaces) {
    const target = surfaceTarget(surface, ctx);
    if (target === null) continue;
    const folder = path.dirname(target[0]);
    const base = path.basename(target[0]);
    if (isDir(folder)) {
      for (const f of sorted(fs.readdirSync(folder))) {
        if (f.startsWith(base + '.new.') && /^\d+$/.test(f.slice(base.length + 5))) {
          found++;
          ctx.out(surface + '\ttemp\t' + path.join(folder, f) + '\t-\ta leftover temporary copy of the config (delete it)\n');
        }
      }
    }
    for (const [p, kind] of [[target[0], 'config'], [target[0] + BACKUP, 'backup'], [target[0] + POLICY_BACKUP, 'backup']]) {
      if (!exists(p)) continue;
      let servers;
      try {
        if (surface === 'codex') {
          let raw;
          try {
            raw = fs.readFileSync(p);
          } catch (e) {
            throw pyOSError(e, p);
          }
          let text;
          try {
            text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
          } catch {
            throw new PyOSError('UnicodeDecodeError', utf8Error(raw));
          }
          servers = tomlServers(text);
        } else {
          const doc = readJson(p);
          if (!isD(doc)) throw new AttrError("'list' object has no attribute 'get'");
          servers = get(doc, 'mcpServers', dict());
        }
      } catch (e) {
        // report the failure class only; a parser message can quote content
        ctx.out('SKIP    ' + p + ': unreadable (' + clsOf(e) + ')\n');
        continue;
      }
      if (!isD(servers)) continue;
      for (const [name, server] of entries(servers)) {
        for (const loc of scanServer(server)) {
          found++;
          ctx.out(surface + '\t' + kind + '\t' + p + '\t' + name + '\t' + loc + '\n');
        }
      }
    }
  }
  ctx.out(found + ' credential-looking key(s) found. Key names only: no value was printed. Move each value to the '
    + 'Keychain (security add-generic-password -s <service> -a "$USER" -w, typed at the prompt), '
    + 'reference it under "secrets", remove the plain-text entry, delete the .pmhwc-backup files, '
    + 'and rotate the credential: it has been on disk in plain text.\n');
  return 0;
}

// ----------------------------------------------------------------------------------- the active set

/**
 * The facts the active set (src/commands/mcp-active.js) reads: the definition and the policy servers read
 * and checked here, and the entries each harness renders. doc null: no definition, or uninstall.
 * @param {Map<string, any> | null} doc @param {Ctx} ctx
 */
export function activeFacts(doc, ctx) {
  const declared = doc !== null && has(doc, 'active_set');
  const policyDoc = loadPolicy();
  const policy = get(policyDoc, 'servers');
  const covered = policySurfaces(policyDoc);
  const launcher = declared ? launcherFor(/** @type {Map<string, any>} */ (doc), ctx, false) : null;
  const connectors = declared ? get(get(doc, 'active_set'), 'connectors', dict()) : dict();
  /** @type {Map<string, any>} */
  const facts = dict();
  facts.set('defined', doc !== null);
  facts.set('declared', declared);
  facts.set('servers', declared ? keysOf(get(doc, 'servers')) : []);
  facts.set('on', sorted(entries(connectors).filter(([, v]) => v === 'on').map(([n]) => n)));
  facts.set('off', sorted(entries(connectors).filter(([, v]) => v === 'off').map(([n]) => n)));
  facts.set('policy', dict(SURFACES.map((s) => [s, entries(policy).filter(([, v]) => pyIn(s, get(v, 'surfaces'))).map(([n]) => n)])));
  const where = dict();
  const conflicts = declared ? policyConflicts(/** @type {Map<string, any>} */ (doc), policyDoc, launcher) : new Map();
  const divergent = dict();
  const kept = dict();
  if (declared) {
    for (const [n, s] of entries(get(doc, 'servers'))) {
      where.set(n, sorted(new Set([...serverSurfaces(s), ...(covered.get(n) || [])])));
      if (!has(policy, n) || conflicts.has(n)) continue;
      for (const surface of sorted(new Set(serverSurfaces(s)))) {
        if ((covered.get(n) || new Set()).has(surface)) continue;
        if (!pyEq(entry(surface, s, launcher), entry(surface, get(policy, n), null))) {
          if (!divergent.has(n)) divergent.set(n, []);
          divergent.get(n).push(surface);
        }
      }
    }
    for (const [n, e] of localDesired(/** @type {Map<string, any>} */ (doc), 'claude-code', launcher, covered)) kept.set(n, [e]);
  }
  for (const [n, e] of desired(policyDoc, 'claude-code', null)) {
    if (!kept.has(n)) kept.set(n, []);
    kept.get(n).push(e);
  }
  facts.set('where', where);
  facts.set('conflicts', dict(conflicts));
  facts.set('divergent', divergent);
  facts.set('kept', kept);
  return facts;
}

/** The backup suffix of every file the MCP active set writes. */
export const ACTIVE_BACKUP = '.pmhwc-mcp-active-backup';

/**
 * --active: the MCP active set and its connection check (src/commands/mcp-active.js and mcp-connect.js,
 * Node since #485). The arguments are checked here; the last --mode, --stamp, --source and --timeout win.
 * @param {string[]} argv @param {Ctx} ctx @returns {Promise<number>}
 */
async function activeMain(argv, ctx) {
  let mode = 'install';
  /** @type {string | null} */
  let stamp = null;
  /** @type {string | null} */
  let source = null;
  /** @type {number | null} */
  let timeout = null;
  for (const a of argv) {
    if (a === '--active') continue;
    if (['--mode=install', '--mode=check', '--mode=dry-run', '--mode=uninstall', '--mode=connect'].includes(a)) mode = a.slice(7);
    else if (/^--timeout=[1-9]\d{0,3}$/.test(a)) timeout = Number(a.slice(10));
    else if (a.startsWith('--stamp=') && a.length > 8) stamp = a.slice(8);
    else if (a.startsWith('--source=') && a.length > 9) source = a.slice(9);
    else {
      ctx.err('usage: mhw mcp render --active --mode=install|check|dry-run|uninstall|connect [--stamp=S] '
        + '[--source=FILE] [--timeout=SECONDS, connect only]\n');
      return 2;
    }
  }
  if (timeout !== null && mode !== 'connect') {
    ctx.err('--timeout applies to --mode=connect only\n');
    return 2;
  }
  // Loaded here, not at the top: both import this renderer, which stays the entry point.
  const active = await import('../commands/mcp-active.js');
  try {
    if (mode === 'connect') {
      const { connect, DEFAULT_TIMEOUT } = await import('../commands/mcp-connect.js');
      return await connect(active.loadSet(mode, source, ctx), timeout || DEFAULT_TIMEOUT, ctx);
    }
    return active.activeRun(mode, stamp, source, ctx);
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    ctx.err(e.message + '\n');
    return e.code;
  }
}

/** @param {string[]} argv @param {Ctx} ctx */
function policyMain(argv, ctx) {
  let mode = 'install';
  let stamp = null;
  for (const a of argv) {
    if (a === '--policy') continue;
    if (['--mode=install', '--mode=check', '--mode=dry-run', '--mode=uninstall'].includes(a)) mode = a.slice(7);
    else if (a.startsWith('--stamp=') && a.length > 8) stamp = a.slice(8);
    else {
      ctx.err('usage: mhw mcp render --policy --mode=install|check|dry-run|uninstall [--stamp=S]\n');
      return 2;
    }
  }
  try {
    return renderPolicy(mode, stamp, ctx);
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    ctx.err(e.message + '\n');
    return e.code;
  }
}

export const USAGE = [
  'usage: mhw mcp render [--dry-run | --check | --scan] [--adopt] [--source=FILE] [--surfaces=a,b]',
  '       mhw mcp render --policy --mode=install|check|dry-run|uninstall [--stamp=S]',
  '       mhw mcp render --active --mode=install|check|dry-run|uninstall|connect [--stamp=S] [--source=FILE]',
  '                      [--timeout=SECONDS, connect only]',
  'Renders the MCP definition (ADR-0017) into Codex, Claude Code, the Claude desktop app and Kiro.',
  'Exit codes: 0 ok, 1 drift or missing (--check), 2 usage or invalid definition, 3 something in the way.',
].join('\n');

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, platform?: string, cwd?: string, out?: (s: string) => void,
 *   err?: (s: string) => void }} [io]
 * @returns {number | Promise<number>} a promise for --active, whose connection check waits on servers
 */
export function main(argv, io = {}) {
  /** @type {Ctx} */
  const ctx = {
    env: io.env || process.env,
    platform: io.platform || process.platform,
    cwd: io.cwd || process.cwd(),
    out: io.out || ((s) => fs.writeSync(1, s)),
    err: io.err || ((s) => fs.writeSync(2, s)),
  };
  if (argv.includes('--policy') && argv.includes('--active')) {
    ctx.err('--policy and --active are separate runs\n');
    return 2;
  }
  if (argv.includes('--policy')) return policyMain(argv, ctx);
  if (argv.includes('--active')) return activeMain(argv, ctx);
  let mode = 'install';
  let adopt = false;
  /** @type {string | null} */
  let source = null;
  /** @type {string[]} */
  let surfaces = [...SURFACES];
  for (const a of argv) {
    if (a === '--dry-run' || a === '--check' || a === '--scan') mode = a.slice(2);
    else if (a === '--adopt') adopt = true;
    else if (a.startsWith('--source=')) source = a.slice(9);
    else if (a.startsWith('--surfaces=')) {
      surfaces = a.slice(11).split(',').filter(Boolean);
      const bad = surfaces.filter((x) => !/** @type {readonly string[]} */ (SURFACES).includes(x));
      if (bad.length || !surfaces.length) {
        ctx.err('unknown surface(s): ' + (bad.join(', ') || 'none given') + ' (known: ' + SURFACES.join(', ') + ')\n');
        return 2;
      }
    } else if (a === '-h' || a === '--help') {
      ctx.out(USAGE + '\n');
      return 0;
    } else {
      ctx.err('unknown argument: ' + a + '\n');
      return 2;
    }
  }
  try {
    if (mode === 'scan') {
      if (AGENT_ENV.some((v) => ctx.env[v])) {
        throw new Refuse(2, '--scan is owner-run only (ADR-0017): it reads the real configs that may hold '
          + 'credentials, and this process runs inside an agent session');
      }
      return scan(surfaces, ctx);
    }
    return render(mode, source || defaultSource(ctx), surfaces, adopt, ctx);
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    ctx.err(e.message + '\n');
    return e.code;
  }
}

/** @param {string} p */
const realArg = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
if (process.argv[1] && realArg(process.argv[1]) === realArg(fileURLToPath(import.meta.url))) {
  // Not a top-level await: src/commands/mcp-active.js imports this module back, and a top-level await here
  // would leave this module unevaluated while main() waits on that import (a deadlock, exit 13).
  Promise.resolve(main(process.argv.slice(2))).then((code) => {
    process.exitCode = code;
  }, (e) => {
    fs.writeSync(2, (e instanceof Error && e.stack ? e.stack : String(e)) + '\n');
    process.exitCode = 1;
  });
}
export { RENDERER_REL };
