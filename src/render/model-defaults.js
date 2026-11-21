// The session-start default model and reasoning effort per agent harness (ADR-0007, ADR-0035), the Node
// form of the deleted global/models/model_defaults.py (#481, S10 of #470). Same arguments, same output
// lines, same exit codes, same files written byte for byte; test/golden/S10 holds the transcripts
// recorded from the Python original.
//
//   node src/render/model-defaults.js --mode=install|check|dry-run|uninstall [--stamp="release: R; commit: C"]
//                                     [--policy=FILE|none] [--home=DIR]
//
// The policy is one versioned file, overlay/model-defaults.json (the owner's values: model IDs depend on
// his subscriptions, so the generic layer pins none). Each value is written into the harness's own native
// user-level key, and nothing else in that file is touched:
//
//     Claude Code  ~/.claude/settings.json              model, effortLevel
//     Codex        ${CODEX_HOME:-~/.codex}/config.toml  model, model_reasoning_effort (top-level keys)
//     Kiro CLI     ~/.kiro/settings/cli.json            chat.defaultModel
//
// Kiro takes no effort here: its effort is a per-model entry (chat.modelDefaults.<id>), and whether the
// pinned model accepts one was not verified, so the policy schema refuses a Kiro effort.
//
// Ownership. The keys mhw set are recorded, with the provenance stamp, in
// ${XDG_DATA_HOME:-~/.local/share}/personal-multi-harness-workstation-configuration/model-defaults.json.
// The pinned value is written whatever the key holds (Issue #145; ADR-0035, amendment of 2026-10-11).
// Every write is reported as old -> new on a CHANGED line. A value of the owner's that it replaces is
// recorded beside the key, so uninstall puts it back. Uninstall touches a key only while it still holds
// the value mhw recorded: it restores the replaced value, or removes the key when there was none. Every
// write leaves the previous file, owner-only (0600), beside it as <file>.pmhwc-models-backup.
//
// The Codex TOML is EDITED LINE BY LINE, top level only, never parsed and re-serialised: the owner's
// comments, blank lines, key order and tables stay as they are. The edited text is parsed (smol-toml)
// before it replaces the file; one that would not parse is refused and nothing is written. The JSON files
// are re-serialised whole, exactly as Python's json.dumps(indent=4|2, ensure_ascii=False) wrote them
// (src/lib/py.js: ints, floats, big ints and NaN keep CPython's spelling). A recorded file outside --home
// (and CODEX_HOME) is never edited.
//
// Output lines use install.sh's words: OK, CHANGED, STAMP, DRIFT, MISSING, STALE, REFUSE, REMOVED, WOULD.
// Exit codes: 0 ok; 1 a target differs (--check); 2 usage or invalid policy; 3 a file or value mhw cannot
// read, a foreign record, or an edit that would not parse.
//
// Python text-mode semantics are reproduced where they change bytes: a file is decoded as strict UTF-8
// (a byte-order mark is kept, as Python's utf-8 codec keeps it), \r\n and a lone \r read as \n, lines split
// as str.splitlines() splits them, and on Windows a written file gets \r\n line ends. node: modules and
// the vendored TOML parser only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER_ID, NAME } from '../lib/marker.js';
import { privateCopy } from '../lib/private-copy.js';
import { loads, dumps, pyStrip, pyRepr, isPyWs, isDict, PyFloat, JsonDecodeError } from '../lib/py.js';
import { tomlInvalid } from './toml-guard.js';
import { utf8Error, utf8ErrorText, splitLines } from '../lib/py-text.js';

// CPython's UTF-8 error and str.splitlines() live in src/lib/py-text.js since #499; re-exported for the S10 suites.
export { utf8Error, splitLines };

const SOURCE = 'overlay/model-defaults.json';
export const BACKUP = '.pmhwc-models-backup';
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:/-]*(?:\[1m\])?$/;
const MODES = ['install', 'check', 'dry-run', 'uninstall'];

/**
 * @typedef {{ fmt: 'json4' | 'json2' | 'toml', keys: Record<string, string>, efforts: string[] | null, aliases: string[] }} Harness
 */
/** @type {Record<string, Harness>} harness -> file format, {policy field: native key}, efforts, aliases refused */
export const HARNESSES = {
  'claude-code': {
    fmt: 'json4',
    keys: { model: 'model', effort: 'effortLevel' },
    efforts: ['low', 'medium', 'high', 'xhigh', 'max'],
    aliases: ['default', 'best', 'opus', 'sonnet', 'haiku', 'fable', 'opusplan'],
  },
  codex: {
    fmt: 'toml',
    keys: { model: 'model', effort: 'model_reasoning_effort' },
    efforts: ['minimal', 'low', 'medium', 'high', 'xhigh'],
    aliases: [],
  },
  'kiro-cli': { fmt: 'json2', keys: { model: 'chat.defaultModel' }, efforts: null, aliases: ['auto'] },
};
const HARNESS_NAMES = Object.keys(HARNESSES);

/** A value mhw cannot read: not a string where one was expected. */
export const UNREADABLE = Symbol('unreadable');

export class PolicyError extends Error {}

// ── Python's text and path semantics ────────────────────────────────────────────────────────────────

/** A UnicodeDecodeError's message, as str(e) prints it. */
class DecodeError extends Error {}

/**
 * Path.read_text(encoding="utf-8"): strict UTF-8 (a BOM kept), then universal newlines.
 * @param {string} file
 */
export function readText(file) {
  const buf = fs.readFileSync(file);
  const bad = utf8ErrorText(buf);
  if (bad) throw new DecodeError(bad);
  return new TextDecoder('utf-8', { ignoreBOM: true }).decode(buf).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/**
 * Path.write_text(text, encoding="utf-8"): \n becomes \r\n on Windows, as Python's text mode writes it.
 * A lone surrogate cannot be encoded: Python raises (not an OSError), so this throws a TypeError.
 * @param {string} file
 * @param {string} text
 * @param {string} platform
 */
function writeText(file, text, platform) {
  if (/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(text)) {
    throw new TypeError("'utf-8' codec can't encode a surrogate: surrogates not allowed");
  }
  fs.writeFileSync(file, platform === 'win32' ? text.replaceAll('\n', '\r\n') : text);
}

/** str.lstrip(). @param {string} s */
function lstrip(s) {
  const cps = Array.from(s);
  let a = 0;
  while (a < cps.length && isPyWs(cps[a])) a++;
  return cps.slice(a).join('');
}

/**
 * str(Path(p)): separators collapsed, "." parts dropped; POSIX keeps exactly two leading slashes, Windows
 * writes backslashes and keeps a drive or UNC prefix.
 * @param {string} p
 * @param {string} platform
 */
export function pyPath(p, platform) {
  if (platform !== 'win32') {
    let lead = p.startsWith('/') ? '/' : '';
    if (p.startsWith('//') && !p.startsWith('///')) lead = '//';
    return lead + p.split('/').filter((x) => x && x !== '.').join('/') || '.';
  }
  let s = p.replaceAll('/', '\\');
  let prefix = '';
  if (/^[A-Za-z]:/.test(s)) {
    prefix = s.slice(0, 2);
    s = s.slice(2);
  } else if (s.startsWith('\\\\')) {
    const parts = s.slice(2).split('\\').filter((x) => x);
    prefix = '\\\\' + parts.slice(0, 2).join('\\');
    s = '\\' + parts.slice(2).join('\\');
  }
  const root = s.startsWith('\\') ? '\\' : '';
  return prefix + root + s.split('\\').filter((x) => x && x !== '.').join('\\') || '.';
}

/**
 * Path(base) / part / ... as str.
 * @param {string} platform
 * @param {string} base
 * @param {...string} parts
 */
function joinPath(platform, base, ...parts) {
  const sep = platform === 'win32' ? '\\' : '/';
  return pyPath(base === '.' ? parts.join(sep) : [base, ...parts].join(sep), platform);
}

/** Path(p).name. @param {string} p @param {string} platform */
function baseName(p, platform) {
  const parts = p.split(platform === 'win32' ? '\\' : '/');
  return parts[parts.length - 1];
}

/**
 * Path.home() for the given environment.
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 */
function pyHome(env, platform) {
  if (platform === 'win32') {
    if (env.USERPROFILE !== undefined) return pyPath(env.USERPROFILE, platform);
    if (env.HOMEPATH !== undefined) return pyPath((env.HOMEDRIVE || '') + env.HOMEPATH, platform);
    return pyPath(os.homedir(), platform);
  }
  if (env.HOME !== undefined) {
    // posixpath.expanduser: HOME with its trailing slashes removed, or / when nothing is left.
    let h = env.HOME;
    while (h.endsWith('/')) h = h.slice(0, -1);
    return pyPath(h || '/', platform);
  }
  return pyPath(os.userInfo().homedir, platform);
}

/** The Python exception class an OSError from Node's error code would be. */
const OS_ERROR_CLASS = /** @type {Record<string, string>} */ ({
  EACCES: 'PermissionError',
  EPERM: 'PermissionError',
  EEXIST: 'FileExistsError',
  ENOENT: 'FileNotFoundError',
  EISDIR: 'IsADirectoryError',
  ENOTDIR: 'NotADirectoryError',
  EINTR: 'InterruptedError',
  EAGAIN: 'BlockingIOError',
  EPIPE: 'BrokenPipeError',
  ETIMEDOUT: 'TimeoutError',
});

/**
 * e.__class__.__name__ for an OSError Python would have raised; OSError for one with no errno code (the
 * Windows owner-only access list failure was an OSError in the deleted private_copy.py too).
 * @param {unknown} e
 */
export function pyErrorClass(e) {
  const code = e && typeof e === 'object' && 'code' in e ? String(/** @type {any} */ (e).code) : '';
  return OS_ERROR_CLASS[code] || 'OSError';
}

/** strerror and errno Python prints for the codes a policy read can meet. */
const STRERROR = /** @type {Record<string, [number, string]>} */ ({
  ENOENT: [2, 'No such file or directory'],
  EACCES: [13, 'Permission denied'],
  EPERM: [1, 'Operation not permitted'],
  EISDIR: [21, 'Is a directory'],
  ENOTDIR: [20, 'Not a directory'],
});

/**
 * str(e) of the OSError Python raised reading file.
 * @param {unknown} e
 * @param {string} file
 * @param {string} platform
 */
function osErrorText(e, file, platform) {
  const code = e && typeof e === 'object' && 'code' in e ? String(/** @type {any} */ (e).code) : '';
  // Windows: opening a directory is a permission error to CPython.
  const known = STRERROR[platform === 'win32' && code === 'EISDIR' ? 'EACCES' : code];
  if (known) return '[Errno ' + known[0] + '] ' + known[1] + ': ' + pyRepr(file);
  return e instanceof Error ? e.message : String(e);
}

/** Python `v == 1` for a parsed JSON value (True and 1.0 are equal to 1). @param {unknown} v */
const equalsOne = (v) => v === 1 || v === true || (v instanceof PyFloat && v.v === 1);

/** Python truthiness of a parsed JSON value. @param {unknown} v */
function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '' || v === 0n) return false;
  if (v instanceof PyFloat) return v.v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** json.dumps(v) of a string, ASCII-only as Python's default writes it. @param {string} v */
const dumpStr = (v) => dumps(v, { ensureAscii: true });

/**
 * Python `rec.get(key)` on a record entry: an entry that is not a dict raises AttributeError, so this
 * throws, as the original crashed.
 * @param {unknown} rec
 * @returns {Record<string, unknown>}
 */
function asDict(rec) {
  if (!isDict(rec)) {
    /** @type {string} */
    let type = typeof rec;
    if (Array.isArray(rec)) type = 'list';
    else if (rec === null) type = 'NoneType';
    throw new TypeError("'" + type + "' object has no attribute 'get'");
  }
  return /** @type {Record<string, unknown>} */ (rec);
}

// ── The policy ──────────────────────────────────────────────────────────────────────────────────────

/**
 * -> {harness: {native key: value}}. Model IDs only, never an alias (ADR-0035, decision 8).
 * @param {string} file
 * @param {string} platform
 * @returns {Record<string, Record<string, string>>}
 */
export function loadPolicy(file, platform) {
  let doc;
  try {
    doc = loads(readText(file));
  } catch (e) {
    const why = e instanceof DecodeError || e instanceof JsonDecodeError ? e.message : osErrorText(e, file, platform);
    throw new PolicyError('cannot read ' + file + ': ' + why);
  }
  if (!isDict(doc) || !equalsOne(/** @type {Record<string, unknown>} */ (doc).version)) {
    throw new PolicyError(file + ': an object with "version": 1 is required');
  }
  /** @type {Record<string, Record<string, string>>} */
  const out = {};
  for (const [harness, entry] of Object.entries(/** @type {Record<string, unknown>} */ (doc))) {
    if (harness === 'version') continue;
    if (!Object.hasOwn(HARNESSES, harness)) {
      throw new PolicyError(file + ': unknown agent harness ' + pyRepr(harness) + ' (known: ' + HARNESS_NAMES.join(', ') + ')');
    }
    const { keys, efforts, aliases } = HARNESSES[harness];
    const e = /** @type {Record<string, unknown>} */ (entry);
    if (!isDict(entry) || typeof e.model !== 'string') throw new PolicyError(file + ': ' + harness + ' needs a "model" string');
    for (const field of Object.keys(e)) {
      if (!Object.hasOwn(keys, field)) {
        throw new PolicyError(file + ': ' + harness + ' takes no ' + pyRepr(field) + ' here (its fields: ' + Object.keys(keys).join(', ') + ')');
      }
    }
    const model = /** @type {string} */ (e.model);
    if (!ID_RE.test(model) || aliases.includes(model.split('[')[0])) {
      throw new PolicyError(file + ': ' + harness + ' model ' + pyRepr(model) + ' is not a pinned model ID (an alias is refused)');
    }
    // Kiro has no effort field, so the field check above refuses one before efforts (null) is consulted.
    if (Object.hasOwn(e, 'effort') && !/** @type {string[]} */ (efforts).includes(/** @type {string} */ (e.effort))) {
      throw new PolicyError(file + ': ' + harness + ' effort ' + pyRepr(e.effort) + ' is not one of ' + /** @type {string[]} */ (efforts).join(', '));
    }
    /** @type {Record<string, string>} */
    const pins = {};
    for (const f of Object.keys(keys)) if (Object.hasOwn(e, f)) pins[keys[f]] = /** @type {string} */ (e[f]);
    out[harness] = pins;
  }
  return out;
}

// ── Native files: read one key, write a set of keys. A TOML file is edited line by line, top level only.

/**
 * Index just past a run of Python whitespace from i.
 * @param {string} s
 * @param {number} i
 */
function skipWs(s, i) {
  while (i < s.length && isPyWs(s[i])) i++;
  return i;
}

/**
 * Whether line is a top-level assignment of key in any of its three TOML spellings: bare, "basic" or
 * 'literal' (Python: re.match(r'\s*(?:k|"k"|'k')\s*='). Matching only the bare one read a quoted key as
 * absent and inserted a duplicate (PR #119 lens).
 * @param {string} line
 * @param {string} key
 */
export function isKeyLine(line, key) {
  const i = skipWs(line, 0);
  for (const spelling of [key, '"' + key + '"', "'" + key + "'"]) {
    if (line.startsWith(spelling, i) && line[skipWs(line, i + spelling.length)] === '=') return true;
  }
  return false;
}

/**
 * The quoted string value of a `key = "value"  # comment` line, or UNREADABLE when it is anything else.
 * (Python: re.fullmatch of a bare, "basic" or 'literal' key, =, a "basic" string with no quote or
 * backslash or a 'literal' one with no quote, then an optional comment.)
 * @param {string} line
 * @returns {string | typeof UNREADABLE}
 */
export function tomlValue(line) {
  let i = skipWs(line, 0);
  const q = line[i];
  if (q === '"' || q === "'") {
    const end = line.indexOf(q, i + 1);
    if (end < 0 || (q === '"' && line.slice(i + 1, end).includes('\\'))) return UNREADABLE;
    i = end + 1;
  } else {
    const start = i;
    while (i < line.length && /[A-Za-z0-9_.-]/.test(line[i])) i++;
    if (i === start) return UNREADABLE;
  }
  i = skipWs(line, i);
  if (line[i] !== '=') return UNREADABLE;
  i = skipWs(line, i + 1);
  const vq = line[i];
  if (vq !== '"' && vq !== "'") return UNREADABLE;
  const end = line.indexOf(vq, i + 1);
  if (end < 0) return UNREADABLE;
  const value = line.slice(i + 1, end);
  if (vq === '"' && value.includes('\\')) return UNREADABLE;
  i = skipWs(line, end + 1);
  if (i < line.length && line[i] !== '#') return UNREADABLE;
  return value;
}

/** The index of the first line that opens a table: the top level ends there. @param {string[]} lines */
function topLevel(lines) {
  const i = lines.findIndex((line) => lstrip(line).startsWith('['));
  return i < 0 ? lines.length : i;
}

/**
 * @typedef {{ lexists?: (p: string) => boolean, rename?: (from: string, to: string) => void }} Seams
 */

export class NativeFile {
  /**
   * @param {string} harness
   * @param {string} file
   * @param {{ platform?: string, env?: Record<string, string | undefined>, seams?: Seams }} [opts]
   */
  constructor(harness, file, opts = {}) {
    this.fmt = HARNESSES[harness].fmt;
    this.path = file;
    this.platform = opts.platform || process.platform;
    this.env = opts.env || process.env;
    this.seams = opts.seams || {};
    this.exists = fs.existsSync(file);
    /** @type {Record<string, unknown> | null} */
    this.doc = null;
    /** @type {string[]} */
    this.lines = [];
    const text = this.exists ? readText(file) : '';
    if (this.fmt === 'toml') {
      this.lines = splitLines(text);
    } else {
      const doc = pyStrip(text) ? loads(text) : {};
      if (!isDict(doc)) throw new TypeError('not a JSON object');
      this.doc = /** @type {Record<string, unknown>} */ (doc);
    }
  }

  /**
   * The key's value: a string, null when absent, UNREADABLE when it holds anything else.
   * @param {string} key
   * @returns {string | null | typeof UNREADABLE}
   */
  get(key) {
    if (this.doc !== null) {
      const value = Object.hasOwn(this.doc, key) ? this.doc[key] : null;
      return value === null || typeof value === 'string' ? value : UNREADABLE;
    }
    for (const line of this.lines.slice(0, topLevel(this.lines))) {
      if (isKeyLine(line, key)) return tomlValue(line);
    }
    return null;
  }

  /**
   * Set the key; value null removes it.
   * @param {string} key
   * @param {string | null} value
   */
  put(key, value) {
    if (this.doc !== null) {
      if (value === null) delete this.doc[key];
      else Object.defineProperty(this.doc, key, { value, writable: true, enumerable: true, configurable: true });
      return;
    }
    const top = topLevel(this.lines);
    for (let i = 0; i < top; i++) {
      if (isKeyLine(this.lines[i], key)) {
        if (value === null) this.lines.splice(i, 1);
        else this.lines[i] = key + ' = ' + dumpStr(value);
        return;
      }
    }
    if (value !== null) this.lines.unshift(key + ' = ' + dumpStr(value));
  }

  text() {
    if (this.doc !== null) return dumps(this.doc, { indent: this.fmt === 'json4' ? 4 : 2, sortKeys: false }) + '\n';
    return this.lines.length ? this.lines.join('\n') + '\n' : '';
  }

  /** Why the new text would not parse, or null. JSON is serialised whole and cannot come out invalid. */
  invalid() {
    // TOML 1.0, as the original's tomllib reads it (src/render/toml-guard.js).
    return this.fmt === 'toml' ? tomlInvalid(this.text()) : null;
  }

  write() {
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    // The backup first: if it cannot be made, no temporary file is left behind and nothing is replaced.
    if (this.exists) {
      privateCopy(this.path, this.path + BACKUP, { lexists: this.seams.lexists, platform: this.platform, env: this.env });
    }
    const tmp = path.join(path.dirname(this.path), path.basename(this.path) + '.new.' + process.pid);
    try {
      writeText(tmp, this.text(), this.platform);
      if (this.exists) fs.chmodSync(tmp, fs.statSync(this.path).mode & 0o7777);
      (this.seams.rename || fs.renameSync)(tmp, this.path);
    } catch (e) {
      try {
        fs.lstatSync(tmp);
        fs.unlinkSync(tmp);
      } catch {
        // nothing left to remove
      }
      throw e;
    }
  }
}

/** @param {Record<string, string>} pairs */
const show = (pairs) => Object.entries(pairs).map(([k, v]) => k + ' = ' + dumpStr(v)).join(', ') || 'no key';

/** @param {string | null | typeof UNREADABLE} v */
const shown = (v) => (v === null ? '(absent)' : dumpStr(/** @type {string} */ (v)));

// ── The ownership record ────────────────────────────────────────────────────────────────────────────

/**
 * @param {string} file
 * @returns {{ record: Record<string, unknown>, stamp: string | null, state: 'absent' | 'ours' | 'foreign' }}
 */
export function readRecord(file) {
  if (!fs.existsSync(file)) return { record: {}, stamp: null, state: 'absent' };
  let doc;
  try {
    doc = loads(readText(file));
  } catch {
    return { record: {}, stamp: null, state: 'foreign' };
  }
  if (!isDict(doc)) return { record: {}, stamp: null, state: 'foreign' };
  const d = /** @type {Record<string, unknown>} */ (doc);
  const managed = Object.hasOwn(d, 'managed-by') ? d['managed-by'] : '';
  if (typeof managed !== 'string' || !managed.includes(MARKER_ID) || !isDict(d.set)) {
    return { record: {}, stamp: null, state: 'foreign' };
  }
  const m = /; (release: [^;]*; commit: [^;]*);/.exec(managed);
  return { record: /** @type {Record<string, unknown>} */ (d.set), stamp: m ? m[1] : null, state: 'ours' };
}

/**
 * @param {Record<string, unknown>} entries
 * @param {string} stamp
 */
function recordText(entries, stamp) {
  const doc = {
    'managed-by': MARKER_ID + '; source: ' + SOURCE + '; ' + stamp + '; do not edit, re-run the installer',
    note: 'The session-start model and effort keys this project set, per file, and under "replaced" the value '
      + 'each one replaced; uninstall restores those and removes the rest.',
    set: entries,
  };
  return dumps(doc, { indent: 2, sortKeys: false }) + '\n';
}

/** The str -> str entries of a dict, {} for anything else. @param {unknown} d @returns {Record<string, string>} */
function strings(d) {
  /** @type {Record<string, string>} */
  const out = {};
  if (!isDict(d)) return out;
  for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (d))) if (typeof v === 'string') out[k] = v;
  return out;
}

/** Python `v in HARNESSES`: an unhashable value (a list or dict) raises. @param {unknown} v */
function isHarness(v) {
  if (v !== null && typeof v === 'object' && !(v instanceof PyFloat)) {
    throw new TypeError("unhashable type: '" + (Array.isArray(v) ? 'list' : 'dict') + "'");
  }
  return typeof v === 'string' && Object.hasOwn(HARNESSES, v);
}

/**
 * @typedef {{ harness: string, file: string, want: Record<string, string>, rec: Record<string, string>, replaced: Record<string, string> }} Step
 */

/**
 * @param {Record<string, Record<string, string>>} policy
 * @param {Record<string, unknown>} record
 * @param {(harness: string) => string} target
 * @param {string} platform
 * @returns {Step[]}
 */
function plan(policy, record, target, platform) {
  /** @type {Step[]} */
  const out = [];
  const seen = new Set();
  for (const harness of HARNESS_NAMES) {
    const file = target(harness);
    const rec = Object.hasOwn(record, file) ? asDict(record[file]) : {};
    const want = policy[harness] || {};
    if (Object.keys(want).length || truthy(rec.keys)) {
      out.push({ harness, file, want, rec: strings(rec.keys), replaced: strings(rec.replaced) });
    }
    seen.add(file);
  }
  for (const [p, value] of Object.entries(record)) {
    if (seen.has(p)) continue;
    const rec = asDict(value);
    if (isHarness(rec.harness) && truthy(rec.keys)) {
      out.push({ harness: /** @type {string} */ (rec.harness), file: pyPath(p, platform), want: {}, rec: strings(rec.keys), replaced: strings(rec.replaced) });
    }
  }
  return out;
}

/**
 * @param {string} harness
 * @param {Record<string, string>} keys
 * @param {Record<string, string>} replaced
 */
function entry(harness, keys, replaced) {
  /** @type {{ harness: string, keys: Record<string, string>, replaced?: Record<string, string> }} */
  const e = { harness, keys };
  /** @type {Record<string, string>} */
  const kept = {};
  for (const [k, v] of Object.entries(replaced)) if (Object.hasOwn(keys, k)) kept[k] = v;
  if (Object.keys(kept).length) e.replaced = kept;
  return e;
}

/** Python == over parsed JSON values (the new record holds only dicts and strings). @param {unknown} a @param {unknown} b @returns {boolean} */
function deepEqual(a, b) {
  if (isDict(a) && isDict(b)) {
    const x = /** @type {Record<string, unknown>} */ (a);
    const y = /** @type {Record<string, unknown>} */ (b);
    const kx = Object.keys(x);
    return kx.length === Object.keys(y).length && kx.every((k) => Object.hasOwn(y, k) && deepEqual(x[k], y[k]));
  }
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  return a === b;
}

/**
 * Whether file is root or under one of roots (os.path.abspath, compared as Path compares: by case on Windows).
 * @param {string} file
 * @param {string[]} roots
 * @param {string} cwd
 * @param {string} platform
 */
function inside(file, roots, cwd, platform) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  /** @param {string} s */
  const norm = (s) => {
    const r = p.resolve(cwd, s);
    return platform === 'win32' ? r.toLowerCase() : r;
  };
  const target = norm(file);
  return roots.some((root) => {
    const base = norm(root);
    return target === base || target.startsWith(base.endsWith(p.sep) ? base : base + p.sep);
  });
}

// ── The run ─────────────────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ env?: Record<string, string | undefined>, platform?: string, cwd?: string,
 *   out?: (s: string) => void, err?: (s: string) => void, seams?: Seams }} RunOptions
 */

/**
 * @param {string[]} argv
 * @param {RunOptions} [opts]
 * @returns {number} the exit code
 */
export function run(argv, opts = {}) {
  const env = opts.env || process.env;
  const platform = opts.platform || process.platform;
  const cwd = opts.cwd || process.cwd();
  /** @param {string} s */
  const say = (s) => (opts.out || ((x) => process.stdout.write(x)))(s + '\n');
  /** @param {string} s */
  const warn = (s) => (opts.err || ((x) => process.stderr.write(x)))(s + '\n');

  /** @type {string | null} */
  let mode = null;
  let stamp = 'release: unknown; commit: unknown';
  /** @type {string | null} */
  let policyFile = null;
  /** @type {string | null} */
  let home = null;
  for (const arg of argv) {
    const value = arg.slice(arg.indexOf('=') + 1);
    if (arg.startsWith('--mode=')) mode = value;
    else if (arg.startsWith('--stamp=')) stamp = value;
    else if (arg.startsWith('--policy=')) policyFile = value;
    else if (arg.startsWith('--home=')) home = pyPath(value, platform);
    else {
      warn('unknown argument: ' + arg);
      return 2;
    }
  }
  if (mode === null || !MODES.includes(mode)) {
    warn('--mode=install|check|dry-run|uninstall is required');
    return 2;
  }
  if (home === null) home = pyHome(env, platform);
  /** @type {Record<string, Record<string, string>>} */
  let policy = {};
  try {
    if (mode !== 'uninstall' && policyFile !== null && policyFile !== '' && policyFile !== 'none') policy = loadPolicy(policyFile, platform);
  } catch (e) {
    if (!(e instanceof PolicyError)) throw e;
    warn('REFUSE  model defaults: ' + e.message + '; nothing written');
    return 2;
  }

  const h = /** @type {string} */ (home);
  const rpath = joinPath(platform, env.XDG_DATA_HOME ? pyPath(env.XDG_DATA_HOME, platform) : joinPath(platform, h, '.local', 'share'), NAME, 'model-defaults.json');
  const { record, stamp: recStamp, state: rstate } = readRecord(rpath);
  if (rstate === 'foreign') {
    say('REFUSE  ' + rpath + ': exists and is NOT managed by this project; move it aside');
    return 3;
  }
  /** @param {string} harness */
  const target = (harness) => {
    if (harness === 'claude-code') return joinPath(platform, h, '.claude', 'settings.json');
    if (harness === 'codex') return joinPath(platform, env.CODEX_HOME ? pyPath(env.CODEX_HOME, platform) : joinPath(platform, h, '.codex'), 'config.toml');
    return joinPath(platform, h, '.kiro', 'settings', 'cli.json');
  };

  let status = 0;
  let pending = false;
  /** @type {Record<string, unknown>} */
  const newRecord = {};
  /** @param {string} k @param {unknown} v */
  const setRecord = (k, v) => Object.defineProperty(newRecord, k, { value: v, writable: true, enumerable: true, configurable: true });
  const roots = [h, ...(env.CODEX_HOME ? [pyPath(env.CODEX_HOME, platform)] : [])];
  for (const { harness, file, want, rec, replaced } of plan(policy, record, target, platform)) {
    if (!inside(file, roots, cwd, platform)) {
      // A recorded file outside --home (and CODEX_HOME) is never edited: a record read through a leaked
      // XDG_DATA_HOME must not reach the real settings of a test's or a dry run's caller.
      say('NOTE    ' + file + ': recorded, but outside ' + h + '; left untouched');
      setRecord(file, entry(harness, rec, replaced));
      continue;
    }
    let nf;
    try {
      nf = new NativeFile(harness, file, { platform, env, seams: opts.seams });
    } catch {
      say('REFUSE  ' + file + ': not readable as its format; model defaults left untouched');
      status = Math.max(status, 3);
      if (Object.keys(rec).length) setRecord(file, entry(harness, rec, replaced));
      continue;
    }
    // changes: key -> new value (null removes it); olds: key -> the value it holds now.
    /** @type {Record<string, string>} */
    const keep = {};
    /** @type {Record<string, string>} */
    const keptReplaced = {};
    /** @type {Map<string, string | null>} */
    const changes = new Map();
    /** @type {Map<string, string | null | typeof UNREADABLE>} */
    const olds = new Map();
    /** @type {string[]} */
    const unreadable = [];
    /** @type {string[]} */
    const notes = [];
    for (const key of [...Object.keys(want), ...Object.keys(rec).filter((k) => !Object.hasOwn(want, k))]) {
      const cur = nf.get(key);
      const w = mode === 'uninstall' || !Object.hasOwn(want, key) ? null : want[key];
      const r = Object.hasOwn(rec, key) ? rec[key] : null;
      if (w !== null) {
        if (cur === UNREADABLE) {
          unreadable.push(key + ' holds a value mhw cannot read, the policy says ' + dumpStr(w));
          if (r !== null) {
            keep[key] = r;
            if (Object.hasOwn(replaced, key)) keptReplaced[key] = replaced[key];
          }
          continue;
        }
        // Issue #145: the pinned value is written whatever the key holds.
        if (cur !== w) {
          changes.set(key, w);
          olds.set(key, cur);
        }
        if (cur === w || (r !== null && cur === r)) {
          // Still mhw's value (or the pin): the replaced value recorded earlier stands.
          if (r !== null || cur !== w) {
            keep[key] = w;
            if (Object.hasOwn(replaced, key)) keptReplaced[key] = replaced[key];
          }
        } else {
          // The owner's value, the latest one he set (PR #146 lens L1): it is what uninstall restores. A
          // key he deleted (null) records nothing, so uninstall removes the key.
          keep[key] = w;
          if (cur !== null) keptReplaced[key] = cur;
        }
      } else if (r !== null) {
        if (cur === r) {
          // Undo: the replaced value comes back, or the key goes when there was none.
          changes.set(key, Object.hasOwn(replaced, key) ? replaced[key] : null);
          olds.set(key, cur);
        } else if (cur !== null) {
          notes.push(key + ' was changed to a value of yours; left alone');
        }
      }
    }
    const label = 'model defaults ' + harness;
    if (unreadable.length) {
      status = Math.max(status, 3);
      say('REFUSE  ' + file + ': ' + unreadable.join('; ') + ' (' + label + '); not readable, so not overwritten');
    }
    for (const note of notes) say('NOTE    ' + file + ': ' + note);
    const hasKeep = Object.keys(keep).length > 0;
    if (!changes.size) {
      if (hasKeep) setRecord(file, entry(harness, keep, keptReplaced));
      if (!unreadable.length && mode !== 'uninstall') {
        const mine = deepEqual(keep, want) ? '' : ' (a value equal to the policy that you set stays yours)';
        say('OK      ' + file + ': ' + show(want) + ' (' + label + ')' + mine);
      }
      continue;
    }
    const what = [...changes].map(([k, v]) => k + ' ' + shown(/** @type {string | null} */ (olds.get(k))) + ' -> ' + shown(v)).join('; ');
    const keys = [...changes.keys()];
    let word = 'DRIFT  ';
    if (keys.every((k) => !Object.hasOwn(want, k) || mode === 'uninstall')) word = 'STALE  ';
    else if (keys.every((k) => olds.get(k) === null)) word = 'MISSING';
    for (const [k, v] of changes) nf.put(k, v);
    const broken = nf.invalid();
    if (broken) {
      // The edit would leave a file the agent harness cannot parse: write nothing, record nothing new.
      status = Math.max(status, 3);
      say('REFUSE  ' + file + ': setting the model defaults would make it unparseable (' + broken + '); nothing written (' + label + ')');
      if (Object.keys(rec).length) setRecord(file, entry(harness, rec, replaced));
      continue;
    }
    if (hasKeep) setRecord(file, entry(harness, keep, keptReplaced));
    if (mode === 'check') {
      say(word + ' ' + file + ': install would change ' + what + ' (' + label + ')');
      status = Math.max(status, 1);
      pending = true;
    } else if (mode === 'dry-run') {
      say('WOULD CHANGE ' + file + ': ' + what + ' (' + label + '; backup ' + baseName(file, platform) + BACKUP + ')');
    } else {
      try {
        nf.write();
      } catch (e) {
        if (e instanceof TypeError) throw e; // not an OSError: the original crashed too
        // Visible, never a traceback; the record keeps what it held, since nothing was changed.
        say('REFUSE  ' + file + ': the backup or the write failed (' + pyErrorClass(e) + '); left untouched (' + label + ')');
        status = Math.max(status, 3);
        if (Object.keys(rec).length) setRecord(file, entry(harness, rec, replaced));
        else delete newRecord[file];
        continue;
      }
      const verb = mode === 'uninstall' ? 'REMOVED' : 'CHANGED';
      const kept = nf.exists ? '; previous file kept as ' + file + BACKUP : '; new file';
      say(verb + ' ' + file + ': ' + what + ' (' + label + kept + ')');
    }
  }

  // The ownership record, with the provenance stamp.
  if (Object.keys(newRecord).length) {
    if (rstate === 'ours' && deepEqual(record, newRecord) && recStamp === stamp) {
      say('OK      ' + rpath + ' (' + stamp + ')');
    } else if (mode === 'check' && pending) {
      // the harness line above already says what install would do, record included
    } else if (mode === 'check') {
      if (rstate === 'ours' && deepEqual(record, newRecord)) {
        say('STAMP   ' + rpath + ': content matches, but it carries (' + (recStamp === null ? 'None' : recStamp) + ') and the source is (' + stamp + ')');
      } else if (rstate === 'absent') {
        say('MISSING ' + rpath);
      } else {
        say('DRIFT   ' + rpath);
      }
      status = Math.max(status, 1);
    } else if (mode === 'dry-run') {
      say('WOULD WRITE ' + rpath + ' (the record of the model-default keys mhw set)');
    } else {
      fs.mkdirSync(path.dirname(rpath), { recursive: true });
      const tmp = path.join(path.dirname(rpath), path.basename(rpath) + '.new.' + process.pid);
      writeText(tmp, recordText(newRecord, stamp), platform);
      fs.renameSync(tmp, rpath);
      say('WROTE   ' + rpath + ' (' + stamp + ')');
    }
  } else if (rstate === 'ours') {
    if (mode === 'check' && pending) {
      // as above
    } else if (mode === 'check') {
      say('STALE   ' + rpath + ': records no key any more; install removes it');
      status = Math.max(status, 1);
    } else if (mode === 'dry-run') {
      say('WOULD REMOVE ' + rpath);
    } else {
      fs.unlinkSync(rpath);
      say('REMOVED ' + rpath);
    }
  }
  return status;
}

/** @param {string} p */
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  process.exitCode = run(process.argv.slice(2));
}
