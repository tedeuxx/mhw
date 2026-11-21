// What every status reader shares (#493, S22 of #470): the project's name and marker, the paths a
// reader builds the way pathlib built them in global/workstation.py, reading a file the way Python read
// it, and running a program by absolute path with its output as Python's run() returned it.
// Read-only: nothing here writes. node: modules and files of this repository only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { homeOf, pathlibJoin, systemName } from '../../render/chrome-debugging.js';
import { readTextPy } from '../clean.js';
import { loads, isDict, PyFloat } from '../py.js';
import { splitlines } from '../yaml-subset.js';
import { runAbsolute } from '../run.js';

export const NAME = 'personal-multi-harness-workstation-configuration';
export const MARKER = 'managed-by: ' + NAME;
export const KEY_FILE = '.workstation-version';

export { homeOf, pathlibJoin, systemName, splitlines, readTextPy, isDict };

/** @typedef {Record<string, string | undefined>} Env */

/**
 * Path.home() / parts, as pathlib joins them. @param {Env} env @param {string[]} parts
 */
export function inHome(env, ...parts) {
  return pathlibJoin(homeOf(env), parts);
}

/** $CODEX_HOME, or ~/.codex when it is unset or empty. @param {Env} env */
export function codexHome(env) {
  return env.CODEX_HOME ? pathlibJoin(env.CODEX_HOME, []) : inHome(env, '.codex');
}

/** WORKSTATION_MANAGED_ROOT (tests and probes only), or ''. @param {Env} env */
export function managedRoot(env) {
  return env.WORKSTATION_MANAGED_ROOT || '';
}

/** platform.system() == "Darwin". */
export function darwin() {
  return systemName() === 'Darwin';
}

/** Path(text): pathlib's normal form of a string (Path("") is "."). @param {string} text */
export function pathOf(text) {
  return pathlibJoin(text, []) || '.';
}

/** Path.exists(): follows a link; any error is false. @param {string} p */
export function exists(p) {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
}

/** Path.is_file(). @param {string} p */
export function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** Path(p).name: the last component, or ''. @param {string} p */
export function baseName(p) {
  const parts = p.split('/').filter((c) => c !== '' && c !== '.');
  return parts.length ? parts[parts.length - 1] : '';
}

/**
 * Path.resolve() (not strict): absolute, with every link of the part that exists resolved.
 * @param {string} p
 * @returns {string}
 */
export function resolvePath(p) {
  const abs = path.resolve(p);
  try {
    return fs.realpathSync(abs);
  } catch {
    const parent = path.dirname(abs);
    if (parent === abs) return abs;
    return path.join(resolvePath(parent), path.basename(abs));
  }
}

/** Path.parents of an absolute path: its ancestors, nearest first, ending at '/'. @param {string} p */
export function parents(p) {
  /** @type {string[]} */
  const out = [];
  let cur = p;
  for (;;) {
    const up = path.dirname(cur);
    if (up === cur) break;
    out.push(up);
    cur = up;
  }
  return out;
}

/**
 * workstation.py's _json(path): [document, state], state 'absent', 'read' or 'not read' (unreadable,
 * not UTF-8, or not JSON as Python's json reads it).
 * @param {string} p
 * @returns {[unknown, 'absent' | 'read' | 'not read']}
 */
export function readJson(p) {
  if (!exists(p)) return [null, 'absent'];
  try {
    return [loads(readTextPy(p, 'utf-8')), 'read'];
  } catch {
    return [null, 'not read'];
  }
}

/** Path.read_text(encoding="utf-8"), or null on any error. @param {string} p */
export function readText(p) {
  try {
    return readTextPy(p, 'utf-8');
  } catch {
    return null;
  }
}

/** dict.get(key) of a parsed JSON value, or undefined when it is not a dict. @param {unknown} doc @param {string} key */
export function get(doc, key) {
  return isDict(doc) && Object.hasOwn(/** @type {object} */ (doc), key) ? /** @type {Record<string, unknown>} */ (doc)[key] : undefined;
}

/**
 * Python's truthiness of a parsed JSON value.
 * @param {unknown} v
 */
export function truthy(v) {
  if (v === null || v === undefined || v === false || v === 0 || v === '' || v === 0n) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isDict(v)) return Object.keys(/** @type {object} */ (v)).length > 0;
  if (v instanceof PyFloat) return v.v !== 0;
  return true;
}

/**
 * Run exe (absolute) and return [exit code, lines]: stdout then stderr, split as str.splitlines() does,
 * which is what workstation.py's run() returned. stdin is inherited, as Python's was.
 * @param {string} exe
 * @param {string[]} args
 * @param {Env} env
 * @returns {[number, string[]]}
 */
export function runLines(exe, args, env) {
  const r = runAbsolute(exe, args, { env, stdio: ['inherit', 'pipe', 'pipe'] });
  return [r.code, splitlines(r.stdout + r.stderr)];
}

/** os.type() lower-level name for the runtime line, e.g. arm64. */
export function machine() {
  return os.machine();
}
