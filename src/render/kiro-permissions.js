// Render the workstation deny floor into Kiro's user-level permissions.yaml (ADR-0036, Issue #144). The
// Node form of global/kiro/kiro_permissions.py (#482, S11 of #470), with the same output, files, modes,
// exit codes and refusals; test/golden/S11/ holds the transcripts recorded from the Python original and
// test/golden/S11/expected-differences.json names every intended difference.
//
//   node src/render/kiro-permissions.js --mode=install|check|dry-run|uninstall|report --stamp=STAMP --floor=FILE
//                                       [--floor-from=TEXT] [--admin=FILE]   (--admin: report only)
//   node src/render/kiro-permissions.js --mode=admin-json --stamp=STAMP --from-yaml=FILE
//                                       (print the admin managed-settings.json mhw install-admin installs)
//   node src/render/kiro-permissions.js --mode=admin-validate --file=FILE
//                                       (exit 3 unless FILE is an admin document Kiro accepts, every statement
//                                       under the condition ceiling; a file Kiro rejects puts Kiro in deny-all)
//
// FILE is the deny floor install.sh already validated (global/deny-floor.conf, then the overlay's), the
// same single source the Claude Code and Codex floors are rendered from. STAMP is install.sh's provenance
// stamp ("release: ...; commit: ..."), so it is derived once (ADR-0029).
//
// Target. ~/.kiro/settings/permissions.yaml, from the home directory only (HOME; USERPROFILE on
// Windows): no argument names a path this program writes. Kiro IDE (1.x) and Kiro CLI V3 read it with one
// rule engine (documented, kiro.dev/docs/permissions).
//
// Rendering. Every floor entry becomes a deny pattern:
//   cmd  <words>    shell              "<words> *"  Kiro compiles a pattern ending in " *" to "equals
//                                                   <words>, or <words> followed by anything" (read from the IDE bundle)
//   glob <words>*   shell              "<words>*"   as written
//   file <path>     fs_read, fs_write  "<path>"     (a leading ~/ is the home directory)
// A pattern is present when some deny rule of that exact capability, with no exclude list, lists it. The
// missing patterns are appended as new deny rules, one per capability. On install nothing of the owner's is
// ever removed; a pattern that left the floor is taken out of a rule mhw recorded as its own (#593: the
// gh api write entries left the floor, and an upgraded file must equal it), and such a rule left empty goes.
//
// Merge, never clobber. The file is read with the strict reader of src/lib/yaml-subset.js, never a
// general YAML library: anything outside Kiro's schema subset, or a file Kiro itself would reject, is
// REFUSED and nothing is written. The owner's rules are kept, in order, value for value; the file is
// re-serialised, so his comments and quoting do not survive (the backup does). The new text is read back
// and must equal the old rules plus the appended ones, or nothing is written. Before a write the previous
// file is copied to permissions.yaml.pmhwc-backup, owner-only (0600; an owner-only access list on Windows).
//
// Ownership. The deny rules appended (capability and match list, as appended) are recorded in
// $XDG_DATA_HOME/personal-multi-harness-workstation-configuration/kiro-permissions-owned.json, outside the
// YAML: Kiro rewrites permissions.yaml when the owner answers a consent prompt with a user-scope rule,
// which drops every comment. Each entry is matched to its own distinct rule: a deny of that capability,
// no exclude, exactly the recorded match list. Install reconciles the record with the file first and
// forgets an entry with no such rule (a NOTE line). Uninstall removes only matched rules, whole, never one
// of the owner's unless it is byte-identical to the one mhw appended, which it cannot tell apart. An entry
// that cannot be matched, or no record at all, removes nothing (the safe direction), said on a NOTE line.
//
// Kiro's lock. install and uninstall take Kiro's own lock (proper-lockfile: a <real file>.lock directory
// made with mkdir) before reading and hold it across the write and the rename, with a bounded wait; a lock
// still held is refused, nothing written and the lock left alone. Before each rename, and before uninstall
// removes a file mhw created, the lock must still be the directory mhw made (same device and inode), or the
// step is refused and the refusal names any file this run had already changed. Best effort: an inode can be
// reused, and a reclaim can land between a check and the rename or the rmdir.
//
// permissions.json. Kiro reads permissions.yaml when it exists and permissions.json only otherwise, so a
// non-empty permissions.json without a permissions.yaml is REFUSED.
//
// Exit codes, as install.sh: 0 ok · 1 drift, stamp or missing (--check) · 2 usage or floor · 3 refused.
// node: modules only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parse, Refuse, RULE_KEYS, splitlines, strip, lstrip } from '../lib/yaml-subset.js';
import { loads, dumps, pyRepr, isPyWs, isDict, JsonDecodeError } from '../lib/py.js';
import { privateCopy } from '../lib/private-copy.js';
import { realpathLoose } from '../lib/confine.js';
import { NAME, MARKER_ID } from '../lib/marker.js';

export { Refuse };
export const BACKUP = '.pmhwc-backup';
export const CAPS = /** @type {const} */ (['shell', 'fs_read', 'fs_write']);
/** Where this renderer is named in the files it writes. */
export const SOURCE = 'src/render/kiro-permissions.js';
const WORD_RE = /^[A-Za-z0-9._/~=:@+*-]+$/;
export const LOCK_WAIT = 3000; // milliseconds; Kiro holds its lock only for one read-modify-write
// A rejected admin file is not "no rule": Kiro catches the parse error as fatal and its policy engine then
// answers deny to EVERY tool call (IDE 1.2.56 and kas 2.29.1, read from both bundles), and so does a
// compiled statement of 64 or more conditions that fails Kiro's cedar-wasm probe. Each match pattern
// compiles to its own statement of 1 (the pattern) + one per exclude + 1 for an ask rule conditions, so the
// pattern count does not add up; the exclude list does. CONDITION_CEILING keeps every statement far under.
export const KIRO_CONDITION_LIMIT = 64;
export const CONDITION_CEILING = 32;
const ROLLBACK = 'Kiro IDE and the Kiro CLI V3 engine deny every tool call while a file Kiro rejects is there; remove '
  + 'it with mhw install-admin --uninstall and the sudo line it prints (or delete that one file as root). Kiro CLI '
  + '2.x does not read it';

/**
 * @typedef {import('../lib/yaml-subset.js').Rule} Rule
 * @typedef {import('../lib/yaml-subset.js').Doc} Doc
 * @typedef {'shell' | 'fs_read' | 'fs_write'} Cap
 * @typedef {Record<Cap, string[]>} Want
 * @typedef {{ capability: Cap, match: string[] }} Entry
 * @typedef {{ appended: Entry[], created: boolean }} Record_
 * @typedef {{ lock: string, ident: [bigint, bigint] }} Held
 * @typedef {{
 *   run: typeof run, uninstall: typeof uninstall, write: typeof write, writeOwned: typeof writeOwned, emit: typeof emit,
 * }} Ops
 * @typedef {{ out: (s: string) => void, err: (s: string) => void, env: Record<string, string | undefined>,
 *   platform: string, cwd: string, changed: string[], held: Held[], appended: number, ops: Ops }} Ctx
 * @typedef {{ out?: (s: string) => void, err?: (s: string) => void, env?: Record<string, string | undefined>,
 *   platform?: string, cwd?: string, ops?: Partial<Ops> }} Io
 */

// --- the Python behaviour the messages carry ---------------------------------------------------------

/** An OSError as CPython names and prints it. */
export class PyOSError extends Error {
  /** @param {string} cls @param {string} message */
  constructor(cls, message) {
    super(message);
    this.cls = cls;
  }
}

const LINUX = process.platform === 'linux';
/** @type {Record<string, [number, string, string]>} */
const ERRNO = {
  ENOENT: [2, 'No such file or directory', 'FileNotFoundError'],
  EACCES: [13, 'Permission denied', 'PermissionError'],
  EPERM: [1, 'Operation not permitted', 'PermissionError'],
  EISDIR: [21, 'Is a directory', 'IsADirectoryError'],
  ENOTDIR: [20, 'Not a directory', 'NotADirectoryError'],
  ELOOP: [LINUX ? 40 : 62, 'Too many levels of symbolic links', 'OSError'],
  ENAMETOOLONG: [LINUX ? 36 : 63, 'File name too long', 'OSError'],
  EEXIST: [17, 'File exists', 'FileExistsError'],
};

/**
 * The CPython exception a failed file operation raises.
 * @param {unknown} e
 * @param {string} [file] the name the message carries
 */
export function pyOSError(e, file) {
  const err = /** @type {NodeJS.ErrnoException} */ (e);
  const [n, what, cls] = ERRNO[err.code || ''] || [Math.abs(err.errno || 0), err.message, 'OSError'];
  return new PyOSError(cls, '[Errno ' + n + '] ' + what + (file === undefined ? '' : ': ' + pyRepr(file)));
}

/**
 * The UnicodeDecodeError message CPython's strict UTF-8 decoder gives for the first bad sequence.
 * @param {Uint8Array} raw
 */
export function utf8Error(raw) {
  /** @param {number} a @param {number} b @param {string} why */
  const at = (a, b, why) => "'utf-8' codec can't decode " + (b - a === 1
    ? 'byte 0x' + raw[a].toString(16).padStart(2, '0') + ' in position ' + a
    : 'bytes in position ' + a + '-' + (b - 1)) + ': ' + why;
  let i = 0;
  while (i < raw.length) {
    const b = raw[i];
    if (b < 0x80) {
      i++;
      continue;
    }
    let need = 3;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) lo = 0xa0;
      if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      if (b === 0xf0) lo = 0x90;
      if (b === 0xf4) hi = 0x8f;
    } else return at(i, i + 1, 'invalid start byte');
    for (let k = 0; k < need; k++) {
      const j = i + 1 + k;
      if (j >= raw.length) return at(i, j, 'unexpected end of data');
      if (raw[j] < (k ? 0x80 : lo) || raw[j] > (k ? 0xbf : hi)) return at(i, j, 'invalid continuation byte');
    }
    i += need + 1;
  }
  return "'utf-8' codec can't decode";
}

/** @param {string} file */
function readBytes(file) {
  try {
    return fs.readFileSync(file);
  } catch (e) {
    throw pyOSError(e, file);
  }
}

/** Strict UTF-8, a BOM kept as a character, as Python's "utf-8" codec. @param {Uint8Array} raw */
function decode(raw) {
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
  } catch {
    throw new PyOSError('UnicodeDecodeError', utf8Error(raw));
  }
}

/** Path.read_text(encoding="utf-8"): strict UTF-8 and universal newlines. @param {string} file */
export function readText(file) {
  return decode(readBytes(file)).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/** os.path.exists / Path.exists (CPython 3.14): False on any error. @param {string} p */
const exists = (p) => {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
};
/** os.path.lexists. @param {string} p */
const lexists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
/** Path.is_dir: False on any error. @param {string} p */
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};

/** str.split() with no argument: on runs of Python whitespace. @param {string} s */
function pySplit(s) {
  /** @type {string[]} */
  const out = [];
  let cur = '';
  for (const ch of s) {
    if (isPyWs(ch)) {
      if (cur) out.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) out.push(cur);
  return out;
}

/** Python == on JSON-shaped values (dict key order ignored). @param {unknown} a @param {unknown} b @returns {boolean} */
export function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  }
  if (isDict(a) || isDict(b)) {
    if (!isDict(a) || !isDict(b)) return false;
    const o = /** @type {Record<string, unknown>} */ (a);
    const p = /** @type {Record<string, unknown>} */ (b);
    const ka = Object.keys(o);
    return ka.length === Object.keys(p).length && ka.every((k) => Object.hasOwn(p, k) && same(o[k], p[k]));
  }
  return a === b;
}

// --- where ------------------------------------------------------------------------------------------

/** Path.home(): HOME (USERPROFILE on Windows), else the account's. @param {Ctx} ctx */
function home(ctx) {
  const e = ctx.env;
  if (ctx.platform === 'win32') {
    if (e.USERPROFILE !== undefined) return e.USERPROFILE;
    if (e.HOMEPATH !== undefined) return (e.HOMEDRIVE || '') + e.HOMEPATH;
    return os.homedir();
  }
  return e.HOME === undefined ? os.homedir() : e.HOME;
}

/** @param {Ctx} ctx */
export const target = (ctx) => path.join(home(ctx), '.kiro', 'settings', 'permissions.yaml');

/** @param {Ctx} ctx */
export const ownedPath = (ctx) => path.join(ctx.env.XDG_DATA_HOME || path.join(home(ctx), '.local', 'share'), NAME,
  'kiro-permissions-owned.json');

/** os.path.realpath (non-strict). @param {string} p @param {Ctx} ctx */
const realpath = (p, ctx) => realpathLoose(p, { cwd: ctx.cwd, env: ctx.env });

// --- the floor --------------------------------------------------------------------------------------

export class FloorError extends Error {}

/**
 * The floor file -> {capability: [pattern, ...]} in floor order, without repeats. Throws FloorError (a
 * malformed floor) or PyOSError (a file that cannot be read).
 * @param {string} file
 * @returns {Want}
 */
export function loadFloor(file) {
  /** @type {Want} */
  const want = { shell: [], fs_read: [], fs_write: [] };
  /** @param {Cap} cap @param {string} pattern */
  const add = (cap, pattern) => {
    if (!want[cap].includes(pattern)) want[cap].push(pattern);
  };
  for (const raw of splitlines(readText(file))) {
    let line = raw;
    while (line.endsWith('\r')) line = line.slice(0, -1);
    if (!strip(line) || lstrip(line).startsWith('#')) continue;
    const f = pySplit(line);
    if (!['cmd', 'file', 'glob'].includes(f[0]) || f.length < 2 || !f.slice(1).every((w) => WORD_RE.test(w))) {
      throw new FloorError('invalid deny-floor entry: ' + line);
    }
    const words = f.slice(1);
    if (f[0] === 'cmd') {
      if (words.some((w) => w.includes('*'))) throw new FloorError('a cmd word may not hold *: ' + line);
      add('shell', words.join(' ') + ' *');
    } else if (f[0] === 'glob') {
      add('shell', words.join(' '));
    } else {
      if (f.length !== 2) throw new FloorError('a file entry takes one path: ' + line);
      add('fs_read', f[1]);
      add('fs_write', f[1]);
    }
  }
  if (!CAPS.some((c) => want[c].length)) throw new FloorError('the deny floor has no entry');
  return want;
}

/** @param {Want} want */
const total = (want) => CAPS.reduce((n, c) => n + want[c].length, 0);

// --- emit, merge, verify ----------------------------------------------------------------------------

/** json.dumps(s) with ensure_ascii. @param {string} s */
const q = (s) => dumps(s, { ensureAscii: true });

/**
 * The YAML text of doc, in the reader's subset: a header (stamp first) unless header is false.
 * @param {Doc} doc
 * @param {string} stamp
 * @param {string} floorFrom
 * @param {boolean} [header]
 */
export function emit(doc, stamp, floorFrom, header = true) {
  const out = header ? [
    '# ' + MARKER_ID + '; source: ' + floorFrom + ' via ' + SOURCE + ' (only the deny-floor rules recorded as ours '
      + "are this project's; every other rule is yours); " + stamp + '; re-run the installer',
    '# The workstation deny floor for Kiro IDE and Kiro CLI V3 (ADR-0036). A deny wins over any allow in',
    '# any scope. Your own rules are kept; comments are not (the installer re-serialises this file).',
  ] : [];
  if (Array.isArray(doc.policies)) {
    out.push('policies:' + (doc.policies.length ? '' : ' []'));
    for (const p of doc.policies) out.push('  - ' + q(p));
  }
  if (doc.rules.length) {
    out.push('rules:');
    for (const rule of doc.rules) {
      let lead = '  - ';
      for (const key of RULE_KEYS) {
        if (!Object.hasOwn(rule, key)) continue;
        const value = /** @type {string | string[]} */ (rule[key]);
        if (!Array.isArray(value)) out.push(lead + key + ': ' + q(value));
        else if (value.length) out.push(lead + key + ':', ...value.map((v) => '      - ' + q(v)));
        else out.push(lead + key + ': []');
        lead = '    ';
      }
    }
  } else out.push('rules: []');
  return out.join('\n') + '\n';
}

/**
 * Some deny rule of cap, with no exclude list, lists pattern.
 * @param {Rule[]} rules @param {string} cap @param {string} pattern
 */
export const covered = (rules, cap, pattern) => rules.some((r) => r.capability === cap && r.effect === 'deny'
  && !r.exclude?.length && Array.isArray(r.match) && r.match.includes(pattern));

/** @param {Doc} doc @param {Want} want @returns {Want} */
const missing = (doc, want) => ({
  shell: want.shell.filter((p) => !covered(doc.rules, 'shell', p)),
  fs_read: want.fs_read.filter((p) => !covered(doc.rules, 'fs_read', p)),
  fs_write: want.fs_write.filter((p) => !covered(doc.rules, 'fs_write', p)),
});

/** The stamp on the managed-by line within the first five lines, or "none". @param {string} text */
export function stampOf(text) {
  for (const line of splitlines(text).slice(0, 5)) {
    if (line.includes(MARKER_ID)) {
      const m = /; (release: [^;]*; commit: [^;]*);/.exec(line);
      return m ? m[1] : 'none';
    }
  }
  return 'none';
}

/** @param {Doc} doc @param {Want} miss @returns {Doc} */
function merged(doc, miss) {
  const rules = doc.rules.map((r) => ({ ...r }));
  for (const c of CAPS) if (miss[c].length) rules.push({ capability: c, effect: 'deny', match: [...miss[c]] });
  return { rules, policies: doc.policies };
}

/** The new text must read back as wantDoc, or Refuse. @param {string} newText @param {Doc} wantDoc */
export function verify(newText, wantDoc) {
  let got;
  try {
    got = parse(newText);
  } catch (e) {
    if (e instanceof Refuse) throw new Refuse('the merged file would not read back (' + e.message + '); nothing written');
    throw e;
  }
  if (!same(got, wantDoc)) throw new Refuse('the merged file would not read back as your rules plus the floor; nothing written');
}

// --- files ------------------------------------------------------------------------------------------

/** Path.mkdir(parents=True, exist_ok=True, mode): the parents with the default mode, dir with mode. @param {string} dir @param {number} [mode] */
function mkdirs(dir, mode = 0o777) {
  try {
    fs.mkdirSync(dir, { mode });
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code;
    if (code === 'ENOENT' && path.dirname(dir) !== dir) {
      mkdirs(path.dirname(dir));
      mkdirs(dir, mode);
    } else if (!isDir(dir)) throw e;
  }
}

/**
 * Atomic. A file that is a symbolic link is written through; a new file is 0600 in a 0700 directory, as
 * Kiro creates it; an existing file keeps its mode. The temporary file has a random name and is created
 * exclusively in the same directory, so a link planted at a predictable name cannot redirect the write.
 * Text is written as Python's text mode writes it: "\n" becomes "\r\n" on Windows.
 * @param {string} p @param {string} text @param {Ctx} ctx
 */
export function write(p, text, ctx) {
  const real = realpath(p, ctx);
  let mode = 0o600;
  if (exists(real)) mode = fs.statSync(real).mode & 0o7777;
  else mkdirs(path.dirname(real), 0o700);
  const data = Buffer.from(ctx.platform === 'win32' ? text.replaceAll('\n', '\r\n') : text, 'utf8');
  let tmp = '';
  let fd = -1;
  while (fd < 0) {
    tmp = path.join(path.dirname(real), path.basename(real) + '.new.' + crypto.randomBytes(6).toString('hex'));
    try {
      fd = fs.openSync(tmp, 'wx', 0o600);
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
  }
  try {
    let off = 0;
    while (off < data.length) off += fs.writeSync(fd, data, off, data.length - off);
    fs.closeSync(fd);
    fd = -1;
    fs.chmodSync(tmp, mode);
    refreshHeldLocks(real, ctx);
    fs.renameSync(tmp, real);
  } catch (e) {
    if (fd >= 0) fs.closeSync(fd);
    if (exists(tmp)) fs.unlinkSync(tmp);
    throw e;
  }
  ctx.changed.push(real);
}

/** The record of the rules install appended, or null. @param {Ctx} ctx @returns {Record_ | null} */
export function readOwned(ctx) {
  let doc;
  try {
    doc = loads(readText(ownedPath(ctx)));
  } catch (e) {
    if (e instanceof PyOSError || e instanceof JsonDecodeError) return null;
    throw e;
  }
  if (!isDict(doc)) return null;
  const d = /** @type {Record<string, unknown>} */ (doc);
  if (!Array.isArray(d.appended)) return null;
  /** @type {Entry[]} */
  const appended = [];
  for (const e of d.appended) {
    if (!isDict(e)) continue;
    const { capability: cap, match } = /** @type {Record<string, unknown>} */ (e);
    if (typeof cap === 'string' && /** @type {readonly string[]} */ (CAPS).includes(cap) && Array.isArray(match)
        && match.length && match.every((p) => typeof p === 'string')) {
      appended.push({ capability: /** @type {Cap} */ (cap), match: [...match] });
    }
  }
  return { appended, created: d.created === true };
}

/** @param {Entry[]} appended @param {boolean} created @param {string} stamp @param {Ctx} ctx */
export function writeOwned(appended, created, stamp, ctx) {
  const p = ownedPath(ctx);
  mkdirs(path.dirname(p));
  const body = {
    _: MARKER_ID + '; source: ' + SOURCE + ' (the deny rules it appended to ~/.kiro/settings/permissions.yaml; '
      + 'uninstall removes only these); ' + stamp + '; do not edit',
    created, appended,
  };
  ctx.ops.write(p, dumps(body, { indent: 2, sortKeys: false, ensureAscii: true }) + '\n', ctx);
}

/** The deny rule install appended for entry: same capability, deny, no exclude, exactly entry's match list. @param {Rule} rule @param {Entry} entry */
const isOurs = (rule, entry) => rule.capability === entry.capability && rule.effect === 'deny' && !rule.exclude?.length
  && same(rule.match, entry.match);

/**
 * For each recorded entry, the index of its own rule, or null; each rule serves one entry at most. A rule
 * that also holds another pattern (his edit, or a consent pattern Kiro appended) is never taken.
 * @param {Rule[]} rules @param {Entry[]} appended @returns {Array<number | null>}
 */
export function matchEntries(rules, appended) {
  const claimed = new Set();
  return appended.map((entry) => {
    const i = rules.findIndex((r, j) => !claimed.has(j) && isOurs(r, entry));
    if (i < 0) return null;
    claimed.add(i);
    return i;
  });
}

// --- Kiro's lock ------------------------------------------------------------------------------------

/** @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** @param {string} p @returns {[bigint, bigint]} */
const identity = (p) => {
  const st = fs.statSync(p, { bigint: true });
  return [st.dev, st.ino];
};

/**
 * Run fn holding Kiro's own lock on p (proper-lockfile: a directory <real file>.lock made with mkdir,
 * which is atomic), taken with a short bounded wait. Still held after the wait: Refuse, nothing written.
 * No settings directory: no file, so no Kiro writer to wait for, and fn runs without a lock.
 * @template T
 * @param {string} p @param {Ctx} ctx @param {() => T} fn
 * @returns {T}
 */
export function withKiroLock(p, ctx, fn) {
  const real = realpath(p, ctx);
  if (!isDir(path.dirname(real))) return fn();
  const lock = real + '.lock';
  const deadline = performance.now() + LOCK_WAIT;
  for (;;) {
    try {
      fs.mkdirSync(lock, { mode: 0o700 });
      break;
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      if (performance.now() >= deadline) {
        throw new Refuse("Kiro's lock " + lock + ' is held (Kiro is writing the file, or a crashed writer left it); '
          + 'nothing written. Re-run when Kiro is idle; if no Kiro is running, remove that directory and re-run');
      }
      sleep(100);
    }
  }
  /** @type {Held} */
  const held = { lock, ident: identity(lock) };
  ctx.held.push(held);
  try {
    return fn();
  } finally {
    ctx.held.splice(ctx.held.indexOf(held), 1);
    releaseLock(held, ctx);
  }
}

/**
 * Just before pending (a real path) is replaced or removed: each held lock must still be the directory mhw
 * made, or Refuse so pending is left as it is. Otherwise its mtime is refreshed, so it never looks older
 * than proper-lockfile's stale threshold (10 s, read from the IDE bundle).
 * @param {string} pending @param {Ctx} ctx
 */
export function refreshHeldLocks(pending, ctx) {
  for (const { lock, ident } of ctx.held) {
    let now = null;
    try {
      now = identity(lock);
    } catch {
      // gone: reclaimed
    }
    if (!now || now[0] !== ident[0] || now[1] !== ident[1]) throw new Refuse(reclaimedMessage(lock, pending, ctx));
    const t = new Date();
    fs.utimesSync(lock, t, t);
  }
}

/** What a refusal after a reclaim must say: what this run already changed. @param {string} lock @param {string} pending @param {Ctx} ctx */
function reclaimedMessage(lock, pending, ctx) {
  const head = "Kiro's lock " + lock + ' is no longer the one mhw took (Kiro reclaimed it as stale)';
  if (!ctx.changed.length) return head + '; ' + pending + ' not changed, so no rule Kiro is writing is lost. Re-run';
  let msg = head + '; ' + ctx.changed.join(' and ') + ' was already changed before that, and ' + pending + ' was not';
  if (ctx.appended && pending === realpath(ownedPath(ctx), ctx)) {
    // Only the record can be left behind: the rules this run appended are in the file and not recorded.
    msg += '. The deny rules this run appended are in the file but not in mhw\'s record, so uninstall will '
      + 'leave them in place (the safe direction); remove them by hand if you want them gone';
  }
  return msg;
}

/** Remove the lock only when it still looks like ours; a failure is a NOTE, never thrown. @param {Held} held @param {Ctx} ctx */
function releaseLock({ lock, ident }, ctx) {
  let now;
  try {
    now = identity(lock);
  } catch {
    ctx.out("NOTE    Kiro's lock " + lock + ' was gone before mhw released it; nothing removed\n');
    return;
  }
  if (now[0] !== ident[0] || now[1] !== ident[1]) {
    ctx.out("NOTE    Kiro's lock " + lock + ' is no longer the one mhw took (Kiro reclaimed it); left alone\n');
    return;
  }
  try {
    fs.rmdirSync(lock);
  } catch (e) {
    ctx.out("NOTE    could not release Kiro's lock " + lock + ' (' + pyOSError(e).cls + '); remove that directory if no Kiro is running\n');
  }
}

// --- modes ------------------------------------------------------------------------------------------

/**
 * -> [text or null, doc]. Refuse.
 * @param {string} p @returns {[string | null, Doc]}
 */
function loadTarget(p) {
  const jsonPath = path.join(path.dirname(p), 'permissions.json');
  if (!exists(p) && exists(jsonPath)) {
    let nonempty = true;
    try {
      nonempty = strip(readText(jsonPath)) !== '';
    } catch (e) {
      if (!(e instanceof PyOSError)) throw e;
    }
    if (nonempty) {
      throw new Refuse(jsonPath + ' holds your rules, and Kiro reads permissions.yaml instead of it when both exist; '
        + 'nothing written. Move its rules into permissions.yaml (same schema), then re-run');
    }
  }
  if (!exists(p)) return [null, { rules: [], policies: null }];
  let text;
  try {
    text = readText(p);
  } catch (e) {
    if (e instanceof PyOSError) throw new Refuse('unreadable (' + e.cls + '); left untouched');
    throw e;
  }
  try {
    return [text, parse(text)];
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    throw new Refuse(e.message + '. Kiro probably rewrote this file after a consent prompt: its writer folds a long pattern '
      + 'onto several lines and leaves values such as yes unquoted, which this reader refuses rather '
      + 'than guess at. Nothing written. Put each pattern on one line, quoted ("..."), or restore '
      + path.basename(p) + BACKUP + ' and add your new rule again, then re-run');
  }
}

/** Conditions in each statement Kiro compiles from this rule (its Vpd/yQc, read from the bundles). @param {Rule} rule */
export function conditions(rule) {
  const match = rule.match || [];
  const all = !match.length || (match.length === 1 && match[0] === '*');
  return (all ? 0 : 1) + (rule.exclude || []).length + (rule.effect === 'ask' ? 1 : 0);
}

/**
 * Refuse unless doc is an admin document of ours that Kiro accepts with every statement under the
 * condition ceiling.
 * @param {unknown} doc
 */
export function adminCheck(doc) {
  const d = /** @type {Record<string, unknown>} */ (doc);
  const keys = isDict(doc) ? Object.keys(d) : [];
  if (keys.length !== 2 || !keys.includes('rules') || !keys.includes(NAME)) {
    throw new Refuse('the top level must be the rules list and the ' + NAME + ' key, nothing else');
  }
  const stamp = d[NAME];
  if (typeof stamp !== 'string' || !stamp.includes(MARKER_ID) || !stamp.includes('; release: ') || !stamp.includes('; commit: ')) {
    throw new Refuse('the ' + NAME + ' key does not carry the provenance stamp');
  }
  const rules = d.rules;
  if (!Array.isArray(rules) || !rules.length) throw new Refuse('rules must be a non-empty list');
  const seen = new Set();
  rules.forEach((r, i) => {
    const rule = /** @type {Record<string, unknown>} */ (r);
    // Kiro rejects an unknown rule field; the administration scope allows deny and ask, and only deny is ours.
    if (!isDict(r) || !Object.keys(rule).every((k) => ['capability', 'effect', 'match', 'exclude'].includes(k))
        || !Object.hasOwn(rule, 'match') || rule.effect !== 'deny' || !(/** @type {readonly unknown[]} */ (CAPS)).includes(rule.capability)) {
      throw new Refuse('rule ' + i + ' is not a deny rule of shell, fs_read or fs_write with only Kiro\'s fields');
    }
    for (const k of ['match', 'exclude']) {
      const v = Object.hasOwn(rule, k) ? rule[k] : [];
      if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && x)) throw new Refuse('rule ' + i + ': ' + k + ' must be a list of non-empty strings');
    }
    if (!(/** @type {string[]} */ (rule.match)).length) throw new Refuse('rule ' + i + ': an empty match list would deny the whole capability');
    const n = conditions(/** @type {Rule} */ (rule));
    if (n > CONDITION_CEILING) {
      throw new Refuse('rule ' + i + ' compiles to statements of ' + n + ' conditions, over the ceiling of ' + CONDITION_CEILING
        + ' (Kiro treats ' + KIRO_CONDITION_LIMIT + ' or more that fail its cedar-wasm check as deny-all)');
    }
    seen.add(rule.capability);
  });
  if (seen.size !== rules.length) throw new Refuse('one rule per capability');
}

/** Refuse unless the file is an admin document Kiro accepts (bytes as Kiro reads them). @param {string} file */
export function adminValidate(file) {
  let raw;
  try {
    raw = fs.readFileSync(file);
  } catch (e) {
    throw new Refuse('unreadable (' + pyOSError(e).cls + ')');
  }
  if (raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) throw new Refuse('starts with a byte order mark, which Kiro refuses');
  let doc;
  try {
    doc = loads(decode(raw));
  } catch (e) {
    if (e instanceof PyOSError) throw new Refuse('not JSON Kiro can parse (UnicodeDecodeError)');
    if (e instanceof JsonDecodeError) throw new Refuse('not JSON Kiro can parse (JSONDecodeError)');
    throw e;
  }
  adminCheck(doc);
  return doc;
}

/** The admin document: one stamp key of ours (JSON has no comment) and one deny rule per capability. @param {Want} want @param {string} stamp */
export function adminDoc(want, stamp) {
  const doc = {
    [NAME]: MARKER_ID + '; source: global/install-managed.sh via ' + SOURCE + '; ' + stamp + '; do not edit, re-run the installer',
    rules: CAPS.filter((c) => want[c].length).map((c) => ({ capability: c, effect: 'deny', match: [...want[c]] })),
  };
  adminCheck(doc);
  return doc;
}

/** The floor as install.sh rendered it into a fresh permissions.yaml: its deny rules, in order. @param {string} file @returns {Want} */
export function wantFromYaml(file) {
  const doc = parse(readText(file));
  /** @type {Want} */
  const want = { shell: [], fs_read: [], fs_write: [] };
  for (const r of doc.rules) {
    const cap = /** @type {Cap} */ (r.capability);
    if (r.effect !== 'deny' || r.exclude?.length || !CAPS.includes(cap)) throw new Refuse(file + ' holds a rule that is not a plain floor deny rule');
    for (const p of r.match || []) if (!want[cap].includes(p)) want[cap].push(p);
  }
  if (!CAPS.some((c) => want[c].length)) throw new Refuse(file + ' holds no deny-floor pattern');
  return want;
}

/** str(v) of a parsed JSON value. @param {unknown} v */
const pyStrOf = (v) => (typeof v === 'string' ? v : pyRepr(v));

/** One FLOOR line for the admin copy: absent, not ours, unreadable, invalid, or n/m floor patterns. @param {string} admin @param {Want} want @param {Ctx} ctx */
function adminReport(admin, want, ctx) {
  const nWant = total(want);
  let state;
  if (!lexists(admin)) state = 'absent';
  else {
    let doc;
    try {
      doc = loads(readText(admin));
    } catch (e) {
      if (e instanceof PyOSError) state = 'not read (' + e.cls + '); if Kiro cannot parse it either: ' + ROLLBACK;
      else if (e instanceof JsonDecodeError) state = 'not read (JSONDecodeError); if Kiro cannot parse it either: ' + ROLLBACK;
      else throw e;
    }
    if (state === undefined) {
      const d = /** @type {Record<string, unknown>} */ (doc);
      if (!isDict(doc) || !pyStrOf(Object.hasOwn(d, NAME) ? d[NAME] : '').includes(MARKER_ID)) state = 'present and NOT managed by this project';
      else {
        try {
          adminValidate(admin);
          const rules = /** @type {Rule[]} */ (d.rules);
          const nMiss = CAPS.reduce((n, c) => n + want[c].filter((p) => !covered(rules, c, p)).length, 0);
          state = (nWant - nMiss) + '/' + nWant + ' floor patterns';
        } catch (e) {
          if (!(e instanceof Refuse)) throw e;
          state = 'INVALID (' + e.message + '): ' + ROLLBACK;
        }
      }
    }
  }
  ctx.out('FLOOR   Kiro: admin managed-settings.json ' + state + ' (read by Kiro IDE 1.2.56 and the Kiro CLI V3 engine as the '
    + 'administration scope, read from their bundles; Kiro CLI 2.x does not read it; not enforced-measured; ADR-0036)\n');
}

/**
 * install, check, dry-run or report.
 * @param {string} mode @param {string} stamp @param {Want} want @param {string} floorFrom @param {Ctx} ctx
 */
export function run(mode, stamp, want, floorFrom, ctx) {
  const p = target(ctx);
  const say = (/** @type {string} */ s) => ctx.out(s + '\n');
  const nWant = total(want);
  let text;
  let doc;
  try {
    [text, doc] = loadTarget(p);
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    if (mode === 'report') {
      say('FLOOR   Kiro: user permissions.yaml not read (' + e.message + ')');
      return 0;
    }
    say('REFUSE  ' + p + ': ' + e.message);
    return 3;
  }
  const miss = missing(doc, want);
  const nMiss = total(miss);
  if (mode === 'report') {
    const state = text === null ? 'absent' : (nWant - nMiss) + '/' + nWant + ' floor patterns';
    say('FLOOR   Kiro: user permissions.yaml ' + state + ' (read by Kiro IDE and Kiro CLI V3, documented; Kiro CLI '
      + '2.x does not read it; not enforced-measured; ADR-0036)');
    return 0;
  }
  // Install reconciles the record with the file first: an entry whose rule is gone (or edited past
  // recognition) is forgotten, so a later uninstall cannot claim one of the owner's rules for it.
  const rec = mode === 'install' ? readOwned(ctx) : null;
  /** @type {Entry[]} */
  let kept = [];
  if (rec !== null) {
    const found = matchEntries(doc.rules, rec.appended);
    kept = rec.appended.filter((_, i) => found[i] !== null);
    if (kept.length !== rec.appended.length) {
      say('NOTE    ' + ownedPath(ctx) + ': ' + (rec.appended.length - kept.length) + ' recorded mhw rule(s) no longer in ' + p
        + ' (removed or edited by hand); forgotten, so uninstall never takes one of your rules for them');
      ctx.ops.writeOwned(kept, rec.created, stamp, ctx);
    }
  }
  // #593: a pattern that left the floor leaves the rule mhw recorded as its own (only that rule, matched
  // exactly as uninstall matches it); a rule left with no pattern goes whole, never kept empty.
  let pruned = 0;
  if (kept.length) {
    const found = matchEntries(doc.rules, kept);
    const drop = new Set();
    const rules = doc.rules.map((r) => ({ ...r }));
    /** @type {Entry[]} */
    const next = [];
    kept.forEach((entry, k) => {
      const i = /** @type {number} */ (found[k]);
      const match = entry.match.filter((x) => want[entry.capability].includes(x));
      pruned += entry.match.length - match.length;
      if (!match.length) drop.add(i);
      else {
        if (match.length !== entry.match.length) rules[i] = { ...rules[i], match: [...match] };
        next.push({ capability: entry.capability, match });
      }
    });
    if (pruned) {
      doc = { rules: rules.filter((_, i) => !drop.has(i)), policies: doc.policies };
      kept = next;
    }
  }
  const have = text === null ? 'none' : stampOf(text);
  if (text !== null && nMiss === 0 && !pruned && have === stamp) {
    say('OK      ' + p + ' (all ' + nWant + ' deny-floor patterns present; ' + stamp + ')');
    return 0;
  }
  if (mode === 'check') {
    if (text === null) say('MISSING ' + p);
    else if (nMiss === 0) say('STAMP   ' + p + ': the deny-floor patterns match, but it carries (' + have + ') and the source is (' + stamp + ')');
    else say('DRIFT   ' + p + ' (' + nMiss + ' deny-floor pattern(s) missing; ' + have + ')');
    return 1;
  }
  const newDoc = merged(doc, miss);
  const newText = ctx.ops.emit(newDoc, stamp, floorFrom);
  try {
    verify(newText, newDoc);
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    say('REFUSE  ' + p + ': ' + e.message);
    return 3;
  }
  if (mode === 'dry-run') {
    say('WOULD MERGE ' + p + ': ' + nMiss + ' deny-floor pattern(s), every rule of yours kept (backup ' + path.basename(p) + BACKUP + '):');
    for (const c of CAPS) for (const pattern of miss[c]) say('  + ' + c + ' deny ' + pattern);
    return 0;
  }
  const created = rec ? rec.created : text === null;
  const appended = [...kept, ...CAPS.filter((c) => miss[c].length).map((c) => ({ capability: c, match: [...miss[c]] }))];
  const backup = p + BACKUP;
  if (text !== null) privateCopy(realpath(p, ctx), backup);
  ctx.appended = nMiss;
  ctx.ops.write(p, newText, ctx);
  ctx.ops.writeOwned(appended, created, stamp, ctx);
  if (text === null) say('MERGED  ' + p + ' (new file; ' + nWant + ' deny-floor patterns)');
  else if (nMiss === 0 && pruned) say('MERGED  ' + p + ' (' + pruned + ' pattern(s) mhw had added and the floor no longer lists removed, every rule of yours kept; previous version kept as ' + backup + ')');
  else if (nMiss === 0) say('RESTAMPED ' + p + ' (' + stamp + '; previous version kept as ' + backup + ')');
  else say('MERGED  ' + p + ' (' + nMiss + ' deny-floor pattern(s) added, every rule of yours kept; previous version kept as ' + backup + ')');
  return 0;
}

/** @param {string} stamp @param {string} floorFrom @param {Ctx} ctx */
export function uninstall(stamp, floorFrom, ctx) {
  const p = target(ctx);
  const say = (/** @type {string} */ s) => ctx.out(s + '\n');
  const rec = readOwned(ctx);
  if (rec === null) {
    if (exists(p)) {
      say('NOTE    ' + p + ': no record of which deny rules mhw added; nothing removed (a deny left behind is the '
        + 'safe direction). Remove them by hand if you want them gone');
    }
    return 0;
  }
  if (!exists(p)) {
    fs.unlinkSync(ownedPath(ctx));
    say('REMOVED ' + ownedPath(ctx) + ' (the file it describes is gone)');
    return 0;
  }
  let doc;
  try {
    doc = loadTarget(p)[1];
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    say('REFUSE  ' + p + ': ' + e.message);
    return 3;
  }
  // Only the rules install appended are removed, each matched to its own distinct rule, whole (never
  // left with an empty match list, which would match everything). One that cannot be matched stays.
  const drop = new Set();
  matchEntries(doc.rules, rec.appended).forEach((i, k) => {
    const entry = rec.appended[k];
    if (i === null) {
      say('NOTE    ' + p + ': the ' + entry.capability + ' deny rule mhw appended (' + entry.match.length + ' pattern(s)) was not found as its own rule '
        + '(removed or edited by hand?); nothing removed for it (a deny left behind is the safe direction)');
    } else drop.add(i);
  });
  const rules = doc.rules.filter((_, i) => !drop.has(i)).map((r) => ({ ...r }));
  /** @type {Doc} */
  const newDoc = { rules, policies: doc.policies };
  if (rec.created && !rules.length && !doc.policies?.length) {
    privateCopy(realpath(p, ctx), p + BACKUP);
    // Guarded like a rename: if Kiro reclaimed the lock, the file stays.
    refreshHeldLocks(realpath(p, ctx), ctx);
    fs.unlinkSync(p);
    say('REMOVED ' + p + ' (mhw created it and only its deny-floor rules were in it; kept as ' + p + BACKUP + ')');
  } else if (!drop.size) {
    say('OK      ' + p + ' holds no deny rule mhw added');
  } else {
    const newText = ctx.ops.emit(newDoc, stamp, floorFrom, false);
    try {
      verify(newText, newDoc);
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      say('REFUSE  ' + p + ': ' + e.message);
      return 3;
    }
    privateCopy(realpath(p, ctx), p + BACKUP);
    ctx.ops.write(p, newText, ctx);
    say('UNMERGED ' + p + ' (the deny rules mhw added removed, your rules kept; previous version kept as ' + p + BACKUP + ')');
  }
  fs.unlinkSync(ownedPath(ctx));
  say('REMOVED ' + ownedPath(ctx));
  return 0;
}

// --- the command line -------------------------------------------------------------------------------

const PROG = 'kiro-permissions.js';
const OPTIONS = new Set(['--mode', '--stamp', '--floor', '--floor-from', '--admin', '--from-yaml', '--file']);
const MODES = new Set(['install', 'check', 'dry-run', 'uninstall', 'report']);

/** @param {Io} [io] @returns {Ctx} */
export function context(io = {}) {
  /** @type {Ops} */
  const ops = { run, uninstall, write, writeOwned, emit, ...io.ops };
  return {
    out: io.out || ((s) => process.stdout.write(s)),
    err: io.err || ((s) => process.stderr.write(s)),
    env: io.env || process.env,
    platform: io.platform || process.platform,
    cwd: io.cwd || process.cwd(),
    changed: [],
    held: [],
    appended: 0,
    ops,
  };
}

/** @param {string[]} argv @returns {Record<string, string> | null} */
function options(argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (const a of argv) {
    const at = a.indexOf('=');
    const k = at < 0 ? '' : a.slice(0, at);
    if (!OPTIONS.has(k) || Object.hasOwn(opts, k)) return null;
    opts[k] = a.slice(at + 1);
  }
  return opts;
}

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv
 * @param {Io} [io]
 */
export function main(argv, io = {}) {
  const ctx = context(io);
  const opts = options(argv) || {};
  const has = (/** @type {string} */ k) => Object.hasOwn(opts, k);
  const only = (/** @type {string[]} */ ks) => Object.keys(opts).length === ks.length && ks.every(has);
  if (opts['--mode'] === 'admin-validate') {
    // The admin installer's check of a staged admin document (mhw install-admin calls adminValidate itself since
    // #496; global/install-managed.sh ran this mode until then), before it is installed as root.
    if (!only(['--mode', '--file'])) {
      ctx.err('usage: ' + PROG + ' --mode=admin-validate --file=FILE (the JSON admin document)\n');
      return 2;
    }
    try {
      adminValidate(opts['--file']);
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      ctx.err('REFUSE  Kiro admin document ' + opts['--file'] + ': ' + e.message + '\n');
      return 3;
    }
    return 0;
  }
  if (opts['--mode'] === 'admin-json') {
    // The admin document (mhw install-admin calls adminDoc itself since #496; global/install-managed.sh ran this
    // mode until then), from the permissions.yaml the user-layer installer rendered into a
    // throwaway home: printed on stdout, nothing written.
    if (!opts['--stamp'] || !opts['--from-yaml'] || !only(['--mode', '--stamp', '--from-yaml'])) {
      ctx.err('usage: ' + PROG + ' --mode=admin-json --stamp=STAMP --from-yaml=FILE\n');
      return 2;
    }
    let doc;
    try {
      doc = adminDoc(wantFromYaml(opts['--from-yaml']), opts['--stamp']);
    } catch (e) {
      if (!(e instanceof Refuse || e instanceof PyOSError)) throw e;
      ctx.err('REFUSE  Kiro admin document: ' + e.message + '\n');
      return 3;
    }
    ctx.out(dumps(doc, { indent: 2, sortKeys: false, ensureAscii: true }) + '\n');
    return 0;
  }
  const mode = opts['--mode'];
  if (!MODES.has(mode) || !opts['--stamp'] || !opts['--floor'] || has('--from-yaml') || has('--file')
      || (has('--admin') && mode !== 'report')) {
    ctx.err('usage: ' + PROG + ' --mode=install|check|dry-run|uninstall|report --stamp=STAMP '
      + '--floor=FILE [--floor-from=TEXT] [--admin=FILE, report only]\n'
      + '       ' + PROG + ' --mode=admin-json --stamp=STAMP --from-yaml=FILE\n');
    return 2;
  }
  const stamp = opts['--stamp'];
  const floorFrom = opts['--floor-from'] || 'global/deny-floor.conf';
  let want;
  try {
    want = loadFloor(opts['--floor']);
  } catch (e) {
    if (!(e instanceof FloorError || e instanceof PyOSError)) throw e;
    ctx.err('REFUSE  Kiro deny floor: ' + e.message + '\n');
    return 2;
  }
  if (mode !== 'install' && mode !== 'uninstall') {
    const code = ctx.ops.run(mode, stamp, want, floorFrom, ctx);
    if (opts['--admin']) adminReport(opts['--admin'], want, ctx);
    return code;
  }
  // A writing mode holds Kiro's own lock from before the read until after the rename, so while both honour
  // it a consent rule Kiro writes meanwhile is not lost (best effort).
  try {
    return withKiroLock(target(ctx), ctx, () => (mode === 'uninstall'
      ? ctx.ops.uninstall(stamp, floorFrom, ctx)
      : ctx.ops.run(mode, stamp, want, floorFrom, ctx)));
  } catch (e) {
    if (!(e instanceof Refuse)) throw e;
    ctx.out('REFUSE  ' + target(ctx) + ': ' + e.message + '\n');
    return 3;
  }
}

/** True when this file is the program node was started with. */
function isEntry() {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) process.exitCode = main(process.argv.slice(2));
