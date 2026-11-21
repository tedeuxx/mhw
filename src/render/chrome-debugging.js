// mhw chrome-debugging --mode=install|check|dry-run|uninstall|status (#480, S09 of #470): the Node form of
// global/chrome_debugging.py, which this slice deletes. Issue #224; ADR-0038, amendment 2026-10-24.
//
// The chrome-devtools MCP server attaches to the owner's running Chrome (--autoConnect), which needs the
// remote-debugging server he would otherwise turn on at chrome://inspect/#remote-debugging. That toggle is
// one Chrome preference, devtools.remote_debugging.user-enabled, kept in the browser's Local State file
// for all of Chrome. Chrome reads it at startup and then runs the server in its approval-only mode: Chrome
// still asks the owner to allow a connection, and nothing here changes that, the port or its binding.
//
// The rules the owner gave on #224, unchanged by the move:
//   - write only while Chrome is not running; if it runs, skip with one line;
//   - change only that key: a JSON round-trip that keeps every other field, its key order and the file's
//     mode, written atomically (a temporary file in Chrome's own directory, fsync, a rename, then an fsync
//     of the directory);
//   - never print, log or copy the file's contents; no backup is made anywhere;
//   - a no-op when the key is already true;
//   - only when the chrome-devtools server in its attach form (--autoConnect) is in the Claude Code user
//     configuration; otherwise the key is left as it is (a SKIP line).
// Uninstall leaves the key alone: it is the owner's browser setting, and turning it off is his click.
//
// A concurrent write by Chrome: the file is read twice, as the original read it (once for the value, once
// for the write), and nothing is written while pgrep finds Chrome running. An unknown answer from pgrep
// (missing, an error, a signal) counts as running, so it never leads to a write. Nothing here locks the
// file: a Chrome started between the pgrep and the rename can still write over it, as with the original.
//
// The JSON round-trip is CPython's (src/lib/py.js, ordered): a float keeps its `1.0`, an int its digits,
// NaN and Infinity are read and written back, integer-like keys keep their place, and a key or string that
// would need a lone surrogate written refuses, as CPython's UTF-8 encoder does. Not reproduced, as in
// py.js: nesting deep enough to raise CPython's RecursionError and an int literal past CPython's 4300-digit
// limit (Chrome's own writer limits nesting to 200 and stores 64-bit ints as strings).
//
// Paths: macOS ~/Library/Application Support/Google/Chrome/Local State; Linux ~/.config/google-chrome/Local
// State. Other systems are skipped. Output lines use install.sh's words. Exit codes: 0 ok or skipped;
// 1 the key is not on (--check), or a chrome-devtools entry whose args are a number, a boolean or null;
// 2 usage; 3 the file
// cannot be read as JSON or cannot be written. The home is $HOME; no path comes from the command line.
//
// --mode=status prints the `mhw status` line (the key's value, never the file's contents); mhw status
// (src/commands/status.js) reads it. node: modules only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { onPath } from '../lib/onpath.js';
import { loads, dumps, isPyWs, pyStr } from '../lib/py.js';

const KEY = ['devtools', 'remote_debugging', 'user-enabled'];
export const KEY_NAME = KEY.join('.');
/** @type {Record<string, string[]>} */
const USER_DATA = { Darwin: ['Library', 'Application Support', 'Google', 'Chrome'], Linux: ['.config', 'google-chrome'] };
/** The process names pgrep -x matches for the stable channel. @type {Record<string, string>} */
const PROCESS = { Darwin: 'Google Chrome', Linux: 'chrome' };
const LABEL = '(Chrome remote debugging)';
const SERVER = 'chrome-devtools';
export const MODES = ['install', 'check', 'dry-run', 'uninstall', 'status'];
export const USAGE = 'usage: mhw chrome-debugging --mode=install|check|dry-run|uninstall|status';

/** The new file is in place, but fsync of its directory failed: the rename may not survive a crash. */
export class NotSynced extends Error {}
/** A value CPython would raise TypeError on (the original's uncaught case). */
export class ArgsTypeError extends Error {}

/** platform.system()'s answer: uname's sysname, and Windows for Windows_NT. */
export function systemName() {
  const t = os.type();
  return t === 'Windows_NT' ? 'Windows' : t;
}

/**
 * Path.home() as the original read it: posixpath.expanduser('~'), which is $HOME with its trailing
 * slashes stripped, or '/' when that leaves nothing (so HOME="" and HOME="//" both read as '/').
 * Windows keeps the value as it is.
 * @param {Record<string, string | undefined>} env
 */
export function homeOf(env) {
  const h = env.HOME !== undefined ? env.HOME : os.homedir();
  if (process.platform === 'win32') return h;
  let end = h.length;
  while (end > 0 && h[end - 1] === '/') end--;
  return h.slice(0, end) || '/';
}

/**
 * pathlib's join on POSIX: repeated slashes collapse, a `.` component drops, `..` stays, and exactly two
 * leading slashes are kept (pathlib keeps them, path.join would collapse them or resolve `..`).
 * @param {string} home
 * @param {string[]} parts
 */
export function pathlibJoin(home, parts) {
  if (process.platform === 'win32') return path.join(home, ...parts);
  let lead = '';
  if (/^\/\/(?!\/)/.test(home)) lead = '//';
  else if (home.startsWith('/')) lead = '/';
  const comps = [...home.split('/'), ...parts].filter((c) => c !== '' && c !== '.');
  return lead + comps.join('/');
}

/** @param {string} system @param {string} home @returns {string | null} */
export function localState(system, home) {
  const parts = USER_DATA[system];
  return parts ? pathlibJoin(home, [...parts, 'Local State']) : null;
}

/** pathlib's is_file(): a regular file after links, any error read as no. @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** The file read as strict UTF-8, its BOM kept (so it refuses as CPython's json does). @param {string} p */
function readText(p) {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(p));
}

/** isinstance(v, dict) for an ordered parse. @param {unknown} v @returns {v is Map<string, unknown>} */
const isMap = (v) => v instanceof Map;

/**
 * True when Claude Code's user configuration holds the chrome-devtools server in its attach form
 * (--autoConnect). Only that one entry's args are looked at; nothing is printed. As the original, an
 * unreadable file, a non-object on the way and an absent entry are false; args that are a number, a
 * boolean or null throw ArgsTypeError (CPython's TypeError, which the original did not catch). A dict's
 * keys are its items and a string's characters are, as iterating them in Python gives. As the original,
 * str() of every item is joined with spaces and split on Python's whitespace: a list or dict item's repr
 * keeps the spaces of a string inside it, so `[["x --autoConnect y"]]` attaches while a tab, which the
 * repr escapes, does not.
 * @param {string} home
 */
export function attachRendered(home) {
  let doc;
  try {
    doc = loads(readText(pathlibJoin(home, ['.claude.json'])), { ordered: true });
  } catch {
    return false;
  }
  if (!isMap(doc)) return false;
  const servers = doc.has('mcpServers') ? doc.get('mcpServers') : new Map();
  if (!isMap(servers)) return false;
  const entry = servers.has(SERVER) ? servers.get(SERVER) : new Map();
  if (!isMap(entry)) return false;
  const args = entry.has('args') ? entry.get('args') : [];
  /** @type {unknown[]} */
  let items;
  if (Array.isArray(args)) items = args;
  else if (isMap(args)) items = [...args.keys()];
  else if (typeof args === 'string') items = Array.from(args);
  else throw new ArgsTypeError("'" + (args === null ? 'NoneType' : typeof args) + "' object is not iterable");
  return splitPy(items.map((a) => pyStr(a)).join(' ')).includes('--autoConnect');
}

/** Python str.split() with no argument. @param {string} s */
function splitPy(s) {
  /** @type {string[]} */
  const words = [];
  let w = '';
  for (const ch of s) {
    if (isPyWs(ch)) {
      if (w) words.push(w);
      w = '';
    } else w += ch;
  }
  if (w) words.push(w);
  return words;
}

/**
 * True when Chrome runs, or when that cannot be told: only pgrep's exit 1 means "not running".
 * @param {string} system
 * @param {Record<string, string | undefined>} env
 */
export function chromeRunning(system, env) {
  if (!Object.hasOwn(PROCESS, system)) return true;
  const name = PROCESS[system];
  const exe = onPath('pgrep', env);
  if (!exe) return true;
  const p = spawnSync(exe, ['-x', name], { env, stdio: 'ignore', shell: false, windowsHide: true });
  return !(p.error === undefined && p.status === 1);
}

/**
 * The key's value: true, false, null (absent), or 'unreadable'. Only that one key leaves this function.
 * @param {string} p
 * @returns {true | false | null | 'unreadable'}
 */
export function readValue(p) {
  let node;
  try {
    node = loads(readText(p), { ordered: true });
  } catch {
    return 'unreadable';
  }
  for (const part of KEY) {
    if (!isMap(node) || !node.has(part)) return null;
    node = node.get(part);
  }
  return typeof node === 'boolean' ? node : 'unreadable';
}

/**
 * @typedef {{ readFileSync: (p: string) => Buffer, statSync: (p: string) => { mode: number },
 *   openSync: (p: string, flags: number, mode?: number) => number,
 *   writeSync: (fd: number, b: Buffer, off: number, len: number) => number, fsyncSync: (fd: number) => void,
 *   closeSync: (fd: number) => void, chmodSync: (p: string, mode: number) => void,
 *   renameSync: (a: string, b: string) => void, unlinkSync: (p: string) => void,
 *   existsSync: (p: string) => boolean }} Io
 */

/** The file system calls setOn makes, replaceable by a test. @type {Io} */
export const IO = {
  readFileSync: (p) => fs.readFileSync(p),
  statSync: (p) => fs.statSync(p),
  openSync: (p, flags, mode) => fs.openSync(p, flags, mode),
  writeSync: (fd, b, off, len) => fs.writeSync(fd, b, off, len),
  fsyncSync: (fd) => fs.fsyncSync(fd),
  closeSync: (fd) => fs.closeSync(fd),
  chmodSync: (p, mode) => fs.chmodSync(p, mode),
  renameSync: (a, b) => fs.renameSync(a, b),
  unlinkSync: (p) => fs.unlinkSync(p),
  existsSync: (p) => fs.existsSync(p),
};

/** A UTF-16 unit of a surrogate pair standing alone, which UTF-8 cannot encode. */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

/**
 * The file's text with the key set to true, every other field and key order kept. Throws when the file
 * is not a JSON object or an intermediate key is not an object.
 * @param {string} p
 * @param {Io} io
 */
function withKeyOn(p, io) {
  const doc = loads(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(io.readFileSync(p)), { ordered: true });
  if (!isMap(doc)) throw new Error('not a JSON object');
  let node = doc;
  for (const part of KEY.slice(0, -1)) {
    if (!node.has(part)) node.set(part, new Map());
    const child = node.get(part);
    if (!isMap(child)) throw new Error('an intermediate key is not an object');
    node = child;
  }
  node.set(/** @type {string} */ (KEY.at(-1)), true);
  return dumps(doc, { sortKeys: false, separators: [',', ':'] });
}

/**
 * Write text to a new file beside p, sync it, give it p's mode and rename it over p. On any failure the
 * temporary file is removed and p is untouched.
 * @param {string} p
 * @param {string} text
 * @param {Io} io
 */
function replaceBeside(p, text, io) {
  const mode = io.statSync(p).mode & 0o777;
  const tmp = path.join(path.dirname(p), '.Local State.mhw-' + crypto.randomBytes(6).toString('base64url'));
  let fd = io.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    // CPython's UTF-8 encoder refuses a lone surrogate, after the temporary file exists.
    if (LONE_SURROGATE.test(text)) throw new Error('surrogates not allowed');
    const data = Buffer.from(text, 'utf8');
    for (let off = 0; off < data.length;) off += io.writeSync(fd, data, off, data.length - off);
    io.fsyncSync(fd);
    io.closeSync(fd);
    fd = -1;
    io.chmodSync(tmp, mode);
    io.renameSync(tmp, p);
  } catch (e) {
    if (fd !== -1) closeQuietly(fd, io);
    if (io.existsSync(tmp)) io.unlinkSync(tmp);
    throw e;
  }
}

/** @param {number} fd @param {Io} io */
function closeQuietly(fd, io) {
  try {
    io.closeSync(fd);
  } catch {
    // already closed by the failing call
  }
}

/**
 * Set the key to true, keeping every other field and key order. Atomic: write beside, then rename.
 * Throws an Error when nothing was written, NotSynced when the file is in place but its directory was not
 * synced.
 * @param {string} p
 * @param {Io} [io]
 */
export function setOn(p, io = IO) {
  replaceBeside(p, withKeyOn(p, io), io);
  // Durability of the rename itself: fsync the directory that holds it. The file is already replaced
  // here, so a failure is reported as such, never as "nothing was written".
  try {
    const dfd = io.openSync(path.dirname(p), fs.constants.O_RDONLY);
    try {
      io.fsyncSync(dfd);
    } finally {
      io.closeSync(dfd);
    }
  } catch {
    throw new NotSynced();
  }
}

/**
 * The mhw status line: the key's value, never the file's contents.
 * @param {string} system
 * @param {string} home
 */
export function statusText(system, home) {
  const p = localState(system, home);
  if (p === null) return 'not read (no default Chrome profile path for ' + system + ')';
  if (!isFile(p)) return 'no Chrome Local State found';
  const value = readValue(p);
  const port = isFile(path.join(path.dirname(p), 'DevToolsActivePort')) ? 'DevToolsActivePort present' : 'no DevToolsActivePort';
  if (value === true) return 'on (' + KEY_NAME + ' = true; ' + port + '; Chrome asks to allow a connection)';
  if (value === false || value === null) {
    return 'off (' + KEY_NAME + ' ' + (value === false ? '= false' : 'absent') + '; ' + port + '); mhw install turns it on while Chrome is closed';
  }
  return 'not read (' + KEY_NAME + ': Local State is not readable JSON, or the key is not a boolean)';
}

/**
 * @typedef {{ system?: string, home?: string, env?: Record<string, string | undefined>,
 *   running?: (system: string) => boolean, io?: Io, out?: (line: string) => void,
 *   err?: (line: string) => void }} Options
 */

/**
 * One mode; prints its line through out and returns the exit code.
 * @param {string} mode install | check | dry-run | uninstall
 * @param {Options} [o]
 */
export function run(mode, o = {}) {
  const env = o.env || process.env;
  const system = o.system || systemName();
  const home = o.home !== undefined ? o.home : homeOf(env);
  const out = o.out || ((/** @type {string} */ line) => fs.writeSync(1, line + '\n'));
  const p = localState(system, home);
  if (p === null) {
    out('SKIP    Chrome remote debugging: no default Chrome profile path on ' + system + ' ' + LABEL);
    return 0;
  }
  if (!isFile(p)) {
    out('SKIP    ' + p + ': no Chrome Local State (Chrome not installed or never started) ' + LABEL);
    return 0;
  }
  const value = readValue(p);
  if (value === 'unreadable') {
    out('REFUSE  ' + p + ': not readable JSON, or ' + KEY_NAME + ' is not a boolean; left as it is ' + LABEL);
    return 3;
  }
  if (value === true) {
    out('OK      ' + p + ': ' + KEY_NAME + ' = true ' + LABEL);
    return 0;
  }
  const old = value === false ? 'false' : 'absent';
  if (mode !== 'uninstall' && !attachRendered(home)) {
    out('SKIP    ' + p + ': ' + KEY_NAME + ' ' + old + ', left as it is: no ' + SERVER + ' server in its attach form is in the Claude Code user '
      + 'configuration (refused or not rendered), so nothing would attach ' + LABEL);
    return 0;
  }
  if (mode === 'check') {
    out('DRIFT   ' + p + ': ' + KEY_NAME + ' ' + old + ', want true ' + LABEL);
    return 1;
  }
  if (mode === 'uninstall') {
    out('NOTE    ' + p + ': ' + KEY_NAME + ' ' + old + '; uninstall never changes it ' + LABEL);
    return 0;
  }
  if (mode === 'dry-run') {
    out('WOULD   ' + p + ': ' + KEY_NAME + ' ' + old + ' -> true ' + LABEL);
    return 0;
  }
  if ((o.running || ((/** @type {string} */ s) => chromeRunning(s, env)))(system)) {
    out('SKIP    ' + p + ': Chrome is running, so ' + KEY_NAME + ' was not set; quit Chrome and run mhw install again ' + LABEL);
    return 0;
  }
  try {
    setOn(p, o.io);
  } catch (e) {
    if (e instanceof NotSynced) {
      out('CHANGED ' + p + ': ' + KEY_NAME + ' ' + old + ' -> true, but the directory was not synced, so the change may not survive a crash ' + LABEL);
      return 3;
    }
    out('REFUSE  ' + p + ': ' + KEY_NAME + ' could not be set; nothing was written ' + LABEL);
    return 3;
  }
  out('CHANGED ' + p + ': ' + KEY_NAME + ' ' + old + ' -> true ' + LABEL);
  return 0;
}

/**
 * The command line takes the mode only; the home is $HOME, as every install step reads it.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {Options} [o]
 */
export function main(argv, env, o = {}) {
  const err = o.err || ((/** @type {string} */ line) => fs.writeSync(2, line + '\n'));
  const modes = argv.filter((a) => a.startsWith('--mode=')).map((a) => a.slice('--mode='.length));
  if (modes.length !== 1 || !MODES.includes(modes[0]) || argv.some((a) => !a.startsWith('--mode='))) {
    err(USAGE);
    return 2;
  }
  const opts = { ...o, env };
  if (modes[0] === 'status') {
    const line = statusText(opts.system || systemName(), opts.home !== undefined ? opts.home : homeOf(env));
    (opts.out || ((/** @type {string} */ l) => fs.writeSync(1, l + '\n')))(line);
    return 0;
  }
  try {
    return run(modes[0], opts);
  } catch (e) {
    if (!(e instanceof ArgsTypeError)) throw e;
    err('chrome-debugging: TypeError: ' + e.message);
    return 1;
  }
}
