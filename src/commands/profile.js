// mhw profile validate|plan|render|check (#479, S08 of #470): the Node form of global/profile/profile.py,
// which this slice deletes. It validates a preference profile against global/profile/profile.schema.json
// and compiles the owner overlay (AGENTS.md, clipboard.conf, desktop-instructions.md, profile-plan.json)
// that the installers append to every harness's user brief. It never installs into a harness.
//
//   mhw profile validate --source overlay/profile.json
//   mhw profile plan     --source overlay/profile.json
//   mhw profile render   --source overlay/profile.json --output overlay
//   mhw profile check    --source overlay/profile.json --output overlay
//
// Exit 0: success; 1: generated output drift; 2: invalid input or usage; 3: I/O error or an unmanaged or
// symlink conflict. Errors never echo profile values or unrecognized keys.
//
// The generated files must be byte for byte what profile.py wrote: a one-byte drift lands in every brief.
// So the Python semantics the output depends on are reproduced, each named where it is:
//   - the profile is read by an iterative JSON reader with CPython 3.14's acceptance (json.loads with a
//     duplicate-key hook and NaN/Infinity refused; an int of more than 4300 digits refused, as CPython's
//     int limit does; any nesting depth inside the 64 KiB cap, which CPython 3.14 parses), keeping an int
//     apart from a float and true apart from 1;
//   - the schema subset is checked with Python's equality (1 == 1.0 == true in a uniqueItems check);
//   - the digest is sha256 of json.dumps(profile, sort_keys=True) (", " and ": ", ASCII escapes);
//   - text files are read as Path.read_text reads them (UTF-8, BOM kept, CRLF and CR read as LF), and
//     str.rstrip() strips Python's whitespace set (src/lib/py.js);
//   - a rendered file is written through a 0600 temporary file and a rename, as NamedTemporaryFile and
//     os.replace did, so it is 0600;
//   - the argument parser is src/lib/argparse.js (Python 3.14's argparse), and every parse error is the
//     one line profile.py printed: "REFUSE: invalid arguments; use --help".
// test/profile/ holds the Python suite's cases and the original's golden transcripts (test/golden/S08/).
// The intended differences (the help's description names this command, not profile.py and Python) are
// in test/golden/S08/expected-differences.json. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse, helpText, terminalColumns } from '../lib/argparse.js';
import { PyFloat, dumps, isPyWs } from '../lib/py.js';
import { realpathLoose } from '../lib/confine.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const MANAGED = 'personal-multi-harness-workstation-configuration/profile-v1';
export const MAX_BYTES = 65536;
export const NAMES = ['AGENTS.md', 'clipboard.conf', 'desktop-instructions.md', 'profile-plan.json'];
/** @type {Record<string, string>} */
const LANGUAGES = { en: 'English', 'pt-BR': 'Brazilian Portuguese' };
/** @type {Record<string, string>} */
const TONES = {
  concise: 'Keep decision requests concise and state the practical consequence.',
  'executive-concise': 'Use an executive, concise tone: decision needed, impact and options, with minimal explanation.',
  conversational: 'Use a natural, approachable tone, with a brief recommendation and the consequence of each option.',
  didactic: 'Give brief explanatory context to make the decision and its consequences understandable.',
};
/** @type {Record<string, string>} */
const PRIORITIES = {
  unselected: 'Model and reasoning-effort priority has not been selected.',
  balanced: 'Balance good quality, moderate latency and restrained use of the subscription allowance.',
  quality: 'Prioritize capability and depth, accepting higher latency and subscription usage.',
  speed: 'Prioritize lower latency and subscription usage; reassess when the task requires more depth.',
};

export const DESCRIPTION = `Validate a preference profile and compile an overlay. Never install into a harness.

    mhw profile validate --source overlay/profile.json
    mhw profile plan --source overlay/profile.json
    mhw profile render --source overlay/profile.json --output overlay
    mhw profile check --source overlay/profile.json --output overlay

Node, node: modules only. Exit 0: success; 1: generated output drift;
2: invalid input/usage; 3: I/O error or unmanaged/symlink conflict. Errors never echo
profile values or unrecognized keys. This is a closed preference vocabulary, not a
general-purpose JSON Schema validator or a confidential-content classifier.
`;

/** @type {import('../lib/argparse.js').ParserSpec} */
export const SPEC = {
  prog: 'mhw profile',
  description: [],
  raw: DESCRIPTION,
  options: [
    { dest: 'help', nargs: 0, strings: ['-h', '--help'],
      help: ['show', ' ', 'this', ' ', 'help', ' ', 'message', ' ', 'and', ' ', 'exit'] },
    { dest: 'source', nargs: null, strings: ['--source'], help: [], required: true },
    { dest: 'output', nargs: null, strings: ['--output'], help: [] },
  ],
  positionals: [{ dest: 'command', nargs: null, help: [], choices: ['validate', 'plan', 'render', 'check'] }],
};

export class Refuse extends Error {
  /** @param {number} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** profile.py's `except (OSError, UnicodeError)` in main: exit 3 with this one line. */
class IoFailure extends Error {}

class JsonInvalid extends Error {}

/**
 * json.loads as CPython 3.14 accepts it, without recursion. Objects are Maps; ints BigInts; floats
 * PyFloats. strict: a duplicate key and NaN/Infinity/-Infinity are refused (profile.py's hooks);
 * otherwise the last duplicate wins and the constants are floats (plain json.loads).
 * @param {string} text
 * @param {boolean} strict
 * @returns {unknown}
 */
export function readJson(text, strict) {
  const s = text;
  const len = s.length;
  let i = 0;
  const bad = () => new JsonInvalid('invalid');
  const ws = () => {
    while (i < len && (s[i] === ' ' || s[i] === '\t' || s[i] === '\n' || s[i] === '\r')) i++;
  };
  /** @returns {string} */
  const str = () => {
    i++;
    let out = '';
    for (;;) {
      if (i >= len) throw bad();
      const c = s[i];
      if (c === '"') {
        i++;
        return out;
      }
      if (c.charCodeAt(0) < 0x20) throw bad();
      if (c !== '\\') {
        out += c;
        i++;
        continue;
      }
      const e = s[i + 1];
      /** @type {Record<string, string>} */
      const simple = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' };
      // An escape at the very end leaves e undefined; hasOwn is then false and the \u test refuses it.
      if (Object.hasOwn(simple, e)) {
        out += simple[e];
        i += 2;
        continue;
      }
      if (e !== 'u') throw bad();
      const hex = (/** @type {number} */ at) => {
        const h = s.slice(at, at + 4);
        if (!/^[0-9a-fA-F]{4}$/.test(h)) throw bad();
        return Number.parseInt(h, 16);
      };
      let code = hex(i + 2);
      i += 6;
      if (code >= 0xd800 && code <= 0xdbff && s[i] === '\\' && s[i + 1] === 'u' && /^[0-9a-fA-F]{4}$/.test(s.slice(i + 2, i + 6))) {
        const low = Number.parseInt(s.slice(i + 2, i + 6), 16);
        if (low >= 0xdc00 && low <= 0xdfff) {
          code = 0x10000 + ((code - 0xd800) << 10) + (low - 0xdc00);
          i += 6;
        }
      }
      // fromCodePoint takes a lone surrogate too, as json.loads keeps one.
      out += String.fromCodePoint(code);
    }
  };
  const NUM = /-?(?:0|[1-9]\d*)(\.\d+)?(?:[eE][-+]?\d+)?/y;
  /** @returns {unknown} a scalar */
  const scalar = () => {
    const word = (/** @type {string} */ w) => s.startsWith(w, i);
    if (word('null')) return (i += 4, null);
    if (word('true')) return (i += 4, true);
    if (word('false')) return (i += 5, false);
    for (const [w, v] of /** @type {Array<[string, number]>} */ ([['NaN', Number.NaN], ['Infinity', Infinity], ['-Infinity', -Infinity]])) {
      if (word(w)) {
        if (strict) throw bad();
        i += w.length;
        return new PyFloat(v);
      }
    }
    NUM.lastIndex = i;
    const m = NUM.exec(s);
    if (!m) throw bad();
    i += m[0].length;
    if (m[1] !== undefined || /[eE]/.test(m[0])) return new PyFloat(Number(m[0]));
    // CPython's int max_str_digits (4300), counted without the sign: a longer int is a ValueError.
    if (m[0].replace('-', '').length > 4300) throw bad();
    return BigInt(m[0]);
  };
  // An explicit stack, so nesting depth costs no call depth. state: what the frame expects next.
  /** @typedef {{ kind: 'array', value: unknown[], state: 'value' | 'after' } | { kind: 'object', value: Map<string, unknown>, key: string, state: 'key' | 'value' | 'after' }} Frame */
  /** @type {Frame[]} */
  const stack = [];
  /** @type {unknown} */
  let result;
  /** @param {unknown} v */
  const place = (v) => {
    const top = stack.at(-1);
    if (!top) result = v;
    else if (top.kind === 'array') top.value.push(v);
    else {
      if (strict && top.value.has(top.key)) throw bad();
      top.value.set(top.key, v);
    }
  };
  const close = () => place(/** @type {Frame} */ (stack.pop()).value);
  // One value at i: a scalar is placed; a container is opened (and closed at once when empty).
  const value = () => {
    ws();
    if (i >= len) throw bad();
    const c = s[i];
    if (c === '{' || c === '[') {
      i++;
      stack.push(c === '{' ? { kind: 'object', value: new Map(), key: '', state: 'key' } : { kind: 'array', value: [], state: 'value' });
      ws();
      if (s[i] === (c === '{' ? '}' : ']')) {
        i++;
        close();
      }
      return;
    }
    place(c === '"' ? str() : scalar());
  };
  value();
  for (;;) {
    const top = stack.at(-1);
    if (!top) break;
    if (top.state === 'value') {
      top.state = 'after';
      value();
      continue;
    }
    if (top.kind === 'object' && top.state === 'key') {
      ws();
      if (s[i] !== '"') throw bad();
      top.key = str();
      ws();
      if (s[i] !== ':') throw bad();
      i++;
      top.state = 'value';
      continue;
    }
    ws();
    const end = top.kind === 'array' ? ']' : '}';
    if (s[i] === end) {
      i++;
      close();
      continue;
    }
    if (s[i] !== ',') throw bad();
    i++;
    // A trailing comma needs no check of its own: neither a value nor a key starts with ']' or '}'.
    top.state = top.kind === 'object' ? 'key' : 'value';
  }
  ws();
  if (i !== len) throw bad();
  return result;
}

/**
 * Python's == over parsed JSON values, without recursion: bool, int and float compare as numbers.
 * @param {unknown} a
 * @param {unknown} b
 */
export function pyEq(a, b) {
  /** @param {unknown} v @returns {bigint | number | null} */
  const numeric = (v) => {
    if (typeof v === 'bigint') return v;
    if (v === true) return 1n;
    if (v === false) return 0n;
    if (v instanceof PyFloat) return v.v;
    return null;
  };
  /** @type {Array<[unknown, unknown]>} */
  const work = [[a, b]];
  while (work.length) {
    const [x, y] = /** @type {[unknown, unknown]} */ (work.pop());
    const nx = numeric(x);
    const ny = numeric(y);
    if (nx !== null || ny !== null) {
      if (nx === null || ny === null) return false;
      if (typeof nx === 'bigint' && typeof ny === 'bigint') {
        if (nx !== ny) return false;
      } else if (typeof nx === 'number' && typeof ny === 'number') {
        if (nx !== ny) return false;
      } else {
        const f = /** @type {number} */ (typeof nx === 'number' ? nx : ny);
        const n = /** @type {bigint} */ (typeof nx === 'bigint' ? nx : ny);
        if (!Number.isInteger(f) || BigInt(f) !== n) return false;
      }
      continue;
    }
    if (x === null || y === null || typeof x === 'string' || typeof y === 'string') {
      if (x !== y) return false;
      continue;
    }
    if (Array.isArray(x) || Array.isArray(y)) {
      if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length) return false;
      for (let k = 0; k < x.length; k++) work.push([x[k], y[k]]);
      continue;
    }
    if (x instanceof Map && y instanceof Map) {
      if (x.size !== y.size) return false;
      for (const [k, v] of x) {
        if (!y.has(k)) return false;
        work.push([v, y.get(k)]);
      }
      continue;
    }
    return false;
  }
  return true;
}

/** @param {unknown} v @param {string} kind */
function isKind(v, kind) {
  if (kind === 'object') return v instanceof Map;
  if (kind === 'array') return Array.isArray(v);
  if (kind === 'string') return typeof v === 'string';
  return typeof v === 'bigint';
}

/**
 * The closed schema's types, enums, constants, objects, arrays and integer bounds; profile.py's
 * messages in its order. value and schema are readJson values.
 * @param {unknown} value
 * @param {any} schema a Map
 * @param {string} [location]
 * @returns {string[]}
 */
export function validate(value, schema, location = 'profile') {
  const kind = schema.get('type');
  if (!isKind(value, kind)) return [location + ': wrong type'];
  /** @type {string[]} */
  const errors = [];
  if (schema.has('const') && !pyEq(value, schema.get('const'))) errors.push(location + ': unsupported version');
  if (schema.has('enum') && !schema.get('enum').some((/** @type {unknown} */ e) => pyEq(value, e))) errors.push(location + ': unsupported choice');
  if (kind === 'object') {
    const v = /** @type {Map<string, unknown>} */ (value);
    const properties = schema.get('properties');
    if ([...v.keys()].some((k) => !properties.has(k))) errors.push(location + ': unrecognized field (name and value omitted)');
    for (const key of schema.get('required')) if (!v.has(key)) errors.push(location + '.' + key + ': required');
    for (const [key, sub] of properties) if (v.has(key)) errors.push(...validate(v.get(key), sub, location + '.' + key));
  } else if (kind === 'array') {
    const v = /** @type {unknown[]} */ (value);
    if (BigInt(v.length) < (schema.has('minItems') ? schema.get('minItems') : 0n)) errors.push(location + ': empty selection');
    if (schema.get('uniqueItems') === true && v.some((item, k) => v.slice(0, k).some((prev) => pyEq(prev, item)))) {
      errors.push(location + ': duplicate selection');
    }
    v.forEach((item, k) => errors.push(...validate(item, schema.get('items'), location + '[' + k + ']')));
  } else if (kind === 'integer') {
    const v = /** @type {bigint} */ (value);
    if ((schema.has('minimum') && v < schema.get('minimum')) || (schema.has('maximum') && v > schema.get('maximum'))) {
      errors.push(location + ': out of range');
    }
  }
  return errors;
}

/**
 * Path.read_text(encoding="utf-8"): strict UTF-8 with a BOM kept, and universal newlines.
 * @param {string} file
 */
export function readText(file) {
  const raw = fs.readFileSync(file);
  return decode(raw).replace(/\r\n?/g, '\n');
}

/** @param {Uint8Array} raw */
function decode(raw) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new UnicodeFailure('undecodable');
  }
}

class UnicodeFailure extends Error {}

/** str.rstrip() with no argument. @param {string} s */
function pyRstrip(s) {
  const cps = Array.from(s);
  let end = cps.length;
  while (end > 0 && isPyWs(cps[end - 1])) end--;
  return cps.slice(0, end).join('');
}

/** @param {string} p */
function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/** @param {string} p */
function stat(p) {
  try {
    return fs.statSync(p);
  } catch {
    return null;
  }
}

/**
 * pathlib.Path(value)'s normalisation: empty and '.' components dropped, trailing separators gone.
 * @param {string} value
 * @param {string} platform
 */
function purePath(value, platform) {
  const P = platform === 'win32' ? path.win32 : path.posix;
  if (platform === 'win32') {
    const root = P.parse(value).root;
    const rest = value.slice(root.length).split(/[\\/]+/).filter((c) => c && c !== '.');
    return (root + rest.join('\\')) || '.';
  }
  const lead = /^\/+/.exec(value);
  // POSIX keeps exactly two leading slashes, and folds one or three or more to one.
  let root = '';
  if (lead) root = lead[0].length === 2 ? '//' : '/';
  const rest = value.split('/').filter((c) => c && c !== '.');
  return (root + rest.join('/')) || '.';
}

/**
 * profile.py's confined_path: CLI input may name files only inside the working directory (or it).
 * @param {string} value
 * @param {{ cwd: string, platform: string }} ctx
 * @param {string} [root]
 */
export function confinedPath(value, ctx, root) {
  const P = ctx.platform === 'win32' ? path.win32 : path.posix;
  const cctx = { cwd: ctx.cwd, env: {}, platform: ctx.platform };
  /** @param {string} p */
  const resolve = (p) => {
    try {
      return realpathLoose(p, cctx);
    } catch {
      // A symlink loop: Python's non-strict realpath keeps the unresolved path; opening it then fails.
      return P.resolve(ctx.cwd, p);
    }
  };
  const base = resolve(root === undefined ? ctx.cwd : root);
  const pure = purePath(value, ctx.platform);
  // os.path.islink on the path as written (relative to the working directory), not lexically resolved.
  if (lstat(P.isAbsolute(pure) ? pure : ctx.cwd + P.sep + pure)?.isSymbolicLink()) throw new Refuse(3, 'symlink paths are not accepted');
  const resolved = resolve(pure);
  const fold = (/** @type {string} */ s) => (ctx.platform === 'win32' ? s.toLowerCase() : s);
  const rel = P.relative(fold(base), fold(resolved));
  const inside = rel === '' || (!P.isAbsolute(rel) && rel.split(P.sep)[0] !== '..');
  if (!inside || (ctx.platform === 'win32' && P.parse(fold(base)).root !== P.parse(fold(resolved)).root)) {
    throw new Refuse(3, 'path escapes the working directory; contents omitted');
  }
  return resolved;
}

/** @returns {any} the schema, as readJson reads it */
function schema() {
  return readJson(readText(path.join(ROOT, 'global', 'profile', 'profile.schema.json')), false);
}

/**
 * profile.py's load_profile: read at most MAX_BYTES + 1, parse, validate; a Map.
 * @param {string} source
 * @param {{ cwd: string, platform: string }} ctx
 * @returns {Map<string, any>}
 */
export function loadProfile(source, ctx) {
  const file = confinedPath(source, ctx);
  /** @type {Buffer} */
  let raw;
  try {
    const fd = fs.openSync(file, 'r');
    try {
      const buf = Buffer.alloc(MAX_BYTES + 1);
      let n = 0;
      for (;;) {
        const got = fs.readSync(fd, buf, n, buf.length - n, null);
        if (!got) break;
        n += got;
        if (n === buf.length) break;
      }
      raw = buf.subarray(0, n);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    throw new Refuse(3, 'cannot read profile; contents omitted');
  }
  if (raw.length > MAX_BYTES) throw new Refuse(2, 'profile exceeds the size limit; contents omitted');
  let profile;
  try {
    profile = readJson(decode(raw), true);
  } catch {
    throw new Refuse(2, 'invalid profile JSON; contents omitted');
  }
  let sch;
  try {
    sch = schema();
  } catch {
    throw new IoFailure('schema');
  }
  const errors = validate(profile, sch);
  if (errors.length) throw new Refuse(2, errors.join('\n'));
  return /** @type {Map<string, any>} */ (profile);
}

/**
 * A validated profile as plain objects (every key is a schema name), for json.dumps and lookups.
 * @param {unknown} v
 * @returns {any}
 */
export function plain(v) {
  if (v instanceof Map) return Object.fromEntries([...v].map(([k, x]) => [k, plain(x)]));
  if (Array.isArray(v)) return v.map(plain);
  return v;
}

/**
 * profile.py's plan().
 * @param {any} profile a plain profile
 */
export function plan(profile) {
  /** @type {Record<string, string>} */
  const routes = {
    'claude-code': 'Existing installer: user CLAUDE.md; hooks remain subject to native support.',
    codex: 'Existing installer: user AGENTS.md; hook trust is a separate owner action.',
    'kiro-cli': 'Existing installer: global steering; custom-agent resource loading must be verified.',
    'claude-desktop': 'Prepared instructions for account settings; no account write or automatic sync.',
  };
  return {
    managed_by: MANAGED,
    profile_version: profile.version,
    priority: profile.session_start.priority,
    surfaces: profile.surfaces.map((/** @type {string} */ name) => ({ surface: name, instruction_route: routes[name],
      runtime_verification: 'not-performed' })),
    limits: {
      surface_selection: 'describes intended targets; existing installers still target all supported CLIs',
      native_model_and_effort: 'not-written; concrete model/effort mappings remain pending',
      financial_authorization: 'not-granted',
      mcp_and_pre_authorizations: 'not-imported-or-synchronized',
      slash_commands: 'preference-only; native command installation remains pending',
      conversation_cadence: 'instruction-only; no universal before-display output gate',
      token_discipline: 'minimum-sufficient context and concise output instructions; no hard token cap',
      decision_options: 'instruction-only on every surface; no hook checks it (the picker guard was removed, ADR-0013 2026-10-05 amendment)',
      desktop_notifications: 'intent=' + (profile.desktop?.notifications ?? 'unselected') + '; instructions compiled; native GUI values require separate application and verification',
    },
  };
}

/** json.dumps(plan(profile), ensure_ascii=False, indent=2). @param {any} profile */
export function planJson(profile) {
  return dumps(plan(profile), { indent: 2, sortKeys: false });
}

/**
 * profile.py's compile_profile: the four generated files. root holds global/AGENTS.md and
 * global/profile/locales (a test passes a synthetic one).
 * @param {any} profile a plain, validated profile
 * @param {string} [root]
 * @returns {Record<string, string>}
 */
export function compileProfile(profile, root = ROOT) {
  const conversation = profile.conversation;
  const interaction = profile.interaction;
  const locale = conversation.language;
  const digest = crypto.createHash('sha256')
    .update(dumps(profile, { sortKeys: true, separators: [', ', ': '], ensureAscii: true }), 'utf8').digest('hex');
  const marker = 'managed-by: ' + MANAGED + '; source-sha256: ' + digest + '; generated; do not edit';
  const limit = interaction.max_question_chars;
  const length = limit ? 'a question stem is at most ' + String(limit) + ' characters'
    : 'no numeric question-length limit is configured; keep each interruption concise';
  const command = interaction.command_preference === 'slash'
    ? 'Prefer native slash commands when available; explain the actual invocation on this harness.'
    : 'Accept ordinary language for directing work; explain command syntax only when useful.';
  const discipline = [];
  if (conversation.cadence === 'paced') {
    discipline.push(
      "- **Paced conversation:** present one proposal at a time, briefly state its practical effect, then leave room for questions before advancing a decision that needs the owner's choice. Answer the current doubt first and pause again; a question, silence or elapsed time is not approval. Do not repeat a decision picker while the owner is clarifying the proposal. Continue routine work already authorized; do not manufacture new approvals.",
      '- **Output discipline:** lead with the current point in a short paragraph or a few short bullets. Reveal detail on request; put lengthy reasoning and evidence in a linked artifact. Avoid unsolicited background, repeated recaps and multiple next steps. Expand when the owner requests detail or a material limitation needs explanation.',
    );
  }
  if (conversation.context_discipline === 'minimum-sufficient') {
    discipline.push("- **Input discipline:** retrieve the minimum sufficient context with scoped searches, bounded tool output and targeted excerpts. Reuse verified findings; do not repeatedly load full files, logs or history. Expand reads when correctness requires it. Never silently truncate the owner's request, governing instructions or essential evidence. This is context discipline, not a hard token or spending cap.");
  }
  if (interaction.decision_options === 3n) {
    discipline.push('- **Path decisions:** a decision always gets exactly three authored, mutually exclusive options: one extreme, the opposite extreme, and the middle ground between them. Use one native multiple-choice question when the harness offers one. Give each option a short label and a concise description of risk and expected benefit; recommend one based on the evidence. Never invent an unsafe or misleading option to fill a position. Leave the native free-text clarification route available; it is not an authored fourth option. If no picker is available, show three numbered choices and wait. An already-decided action remains one action line; native security approvals retain their own controls.');
  }
  if (profile.desktop?.notifications === 'essential') {
    discipline.push("- **Attention and notifications:** minimize simultaneous information; one point at a time. Prefer notifications only when the owner's decision or action is needed. Do not proactively send routine progress or completion notifications. Keep requested results accessible in the conversation; do not hide blockers or material failures. This instruction does not itself change native desktop notification settings.");
  }
  const body = [
    '## Owner overlay (generated personal profile)', '',
    '- **Language:** talk to the owner in ' + LANGUAGES[locale]
    + ' in everything made for the owner to read: chat, reports, artifacts and pickers. Only text for an outside audience is in '
    + LANGUAGES[conversation.publication_language]
    + ": public repository text (Issues, pull requests, commits, docs). Site copy and social posts follow their own surface's language rule, which may be per locale or bilingual.",
    '- **Decision tone:** ' + TONES[conversation.decision_tone],
    '- **Escalation limits:** one question per message; ' + length
    + '; the reasoning goes in a linked artifact, not in the message.',
    ...discipline,
    '- **Commands:** ' + command,
    '- **Session-start preference:** ' + PRIORITIES[profile.session_start.priority],
    '- **Evidence:** this preference does not configure a native model or effort value. Report the effective settings only when verified.',
    '- **Authorization:** this profile grants no new tool permissions, paid API use, purchases or publication rights.',
    '',
  ].join('\n');
  const notices = locale === 'pt-BR'
    ? readText(path.join(root, 'global', 'profile', 'locales', 'pt-BR', 'clipboard.conf'))
    : "# No notice overrides: use the components' built-in English messages.\n";
  // A desktop handoff includes the floor, not merely the personal preferences.
  const floor = readText(path.join(root, 'global', 'AGENTS.md'));
  return {
    'AGENTS.md': '<!-- ' + marker + ' -->\n\n' + body,
    'clipboard.conf': '# ' + marker + '\n' + notices,
    'desktop-instructions.md': '<!-- ' + marker + ' -->\n\n' + pyRstrip(floor) + '\n\n' + body,
    'profile-plan.json': planJson(profile) + '\n',
  };
}

/**
 * profile.py's is_managed: the marker must open the file (a mention elsewhere is not ownership).
 * @param {string} name
 * @param {string} content
 */
export function isManaged(name, content) {
  if (name === 'profile-plan.json') {
    let parsed;
    try {
      parsed = readJson(content, false);
    } catch {
      return false;
    }
    return parsed instanceof Map && parsed.get('managed_by') === MANAGED;
  }
  const prefix = name.endsWith('.md') ? '<!-- managed-by: ' : '# managed-by: ';
  return content.startsWith(prefix + MANAGED + ';');
}

/** NamedTemporaryFile's name: "tmp" and eight of its characters. */
function tempName() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789_';
  const bytes = crypto.randomBytes(8);
  return 'tmp' + Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * profile.py's write_or_check: preflight every target, then (render) write the changed ones.
 * @param {string} output
 * @param {Record<string, string>} compiled
 * @param {{ cwd: string, platform: string }} ctx
 * @param {{ check?: boolean, root?: string }} [opts]
 * @returns {string[]} the names that differ
 */
export function writeOrCheck(output, compiled, ctx, opts = {}) {
  const dir = confinedPath(output, ctx, opts.root);
  const dirStat = stat(dir);
  if (lstat(dir)?.isSymbolicLink() || (dirStat && !dirStat.isDirectory())) {
    throw new Refuse(3, 'output must be a real directory, not a symlink or file');
  }
  /** @type {string[]} */
  const changed = [];
  for (const [name, desired] of Object.entries(compiled)) {
    if (!NAMES.includes(name)) throw new Refuse(3, 'unknown generated artifact name; nothing written');
    const file = path.join(dir, name);
    const st = stat(file);
    if (lstat(file)?.isSymbolicLink() || (st && !st.isFile())) {
      throw new Refuse(3, 'output contains a symlink or non-file target; nothing written');
    }
    let current = null;
    if (st) {
      try {
        current = readText(file);
      } catch {
        throw new IoFailure('read');
      }
    }
    if (current !== null && !isManaged(name, current)) throw new Refuse(3, 'output contains an unmanaged target; nothing written');
    if (current !== desired) changed.push(name);
  }
  if (opts.check) return changed;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of changed) {
      const temp = path.join(dir, tempName());
      try {
        fs.writeFileSync(temp, compiled[name], { encoding: 'utf8', flag: 'wx', mode: 0o600 });
        fs.renameSync(temp, path.join(dir, name));
      } finally {
        if (lstat(temp)) fs.rmSync(temp, { force: true });
      }
    }
  } catch {
    throw new IoFailure('write');
  }
  return changed;
}

/**
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, platform?: string, terminal?: number,
 *   out: (s: string) => void, err: (s: string) => void }} Io
 */

/**
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
export function run(argv, io) {
  const ctx = { cwd: io.cwd, platform: io.platform || process.platform };
  try {
    const parsed = parse(SPEC, argv);
    if (parsed.kind === 'help') {
      io.out(helpText(SPEC, terminalColumns(io.env, io.terminal)));
      return 0;
    }
    if (parsed.kind === 'error') throw new Refuse(2, 'invalid arguments; use --help');
    const { command, source, output } = parsed.values;
    const needsOutput = command === 'render' || command === 'check';
    if (needsOutput !== (output !== undefined)) throw new Refuse(2, '--output is required only for render and check');
    const profile = plain(loadProfile(/** @type {string} */ (source), ctx));
    if (command === 'validate') {
      io.out('OK: valid preference profile; no installation or permission grant\n');
    } else if (command === 'plan') {
      io.out(planJson(profile) + '\n');
    } else {
      let compiled;
      try {
        compiled = compileProfile(profile);
      } catch {
        throw new IoFailure('compile');
      }
      const check = command === 'check';
      const changed = writeOrCheck(/** @type {string} */ (output), compiled, ctx, { check });
      if (check && changed.length) {
        io.out('DRIFT: ' + changed.join(', ') + '\n');
        return 1;
      }
      io.out('OK: ' + (check ? 'generated overlay is current' : changed.length + ' generated files updated; no harness installation') + '\n');
    }
    return 0;
  } catch (e) {
    if (e instanceof Refuse) {
      io.err('REFUSE: ' + e.message + '\n');
      return e.code;
    }
    if (e instanceof IoFailure) {
      io.err('REFUSE: cannot read or write profile artifacts; contents omitted\n');
      return 3;
    }
    throw e;
  }
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function main(argv, env) {
  return run(argv, {
    cwd: process.cwd(),
    env,
    out: (s) => fs.writeSync(1, s),
    err: (s) => fs.writeSync(2, s),
    terminal: process.stdout.isTTY ? process.stdout.columns : 0,
  });
}
