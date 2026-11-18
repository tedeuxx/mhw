// Path confinement for the files whose content is read and may be published (mhw #170), the Node form
// of method/scripts/confine.py (#475, S04 of #470). A milestone description is posted to the forge, so
// a path an agent passes is resolved (symlinks and `..` included, component by component, as Python's
// os.path.realpath does) and refused unless it lies inside the work tree of the repository the command
// runs in, or the system temporary directory. Nothing is read here.
//
// confine.py stays until its last Python importer moves (worklog.py and launch-line.py, S05); until
// then the two forms must agree, and test/lib/confine.test.js runs this one on the Python suite's cases.
// Every input (cwd, environment, git) is passed in, so a test can vary it without touching the process.
// node: modules only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runAbsolute } from './run.js';
import { onPath } from './onpath.js';

export class ConfineError extends Error {}

/**
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, platform?: string }} Context
 */

/** @param {Context} ctx */
const pathMod = (ctx) => ((ctx.platform || process.platform) === 'win32' ? path.win32 : path.posix);

/** @param {string} p */
function lstat(p) {
  try {
    return fs.lstatSync(p);
  } catch {
    return null;
  }
}

/**
 * Python's os.path.expanduser for "~" and "~/..." (and "~\\..." on Windows): HOME on POSIX, USERPROFILE
 * on Windows, else the OS home. "~user" is left as it is (Python would look the user up).
 * @param {string} p
 * @param {Context} ctx
 */
export function expandUser(p, ctx) {
  const win = (ctx.platform || process.platform) === 'win32';
  if (p !== '~' && !p.startsWith('~/') && !(win && p.startsWith('~\\'))) return p;
  const home = (win ? ctx.env.USERPROFILE : ctx.env.HOME) || os.homedir();
  return home + p.slice(1);
}

/**
 * The real path of p, resolved component by component like Python's non-strict os.path.realpath: a
 * symbolic link is replaced by its target before the next component (so `link/..` leaves the link's
 * target, not the link's directory), `..` drops the last resolved component, and once a component does
 * not exist the rest is joined as written. On Windows the existing prefix is then canonicalised
 * (8.3 short names expanded), as Python's realpath does there.
 * @param {string} p
 * @param {Context} ctx
 * @returns {string}
 */
export function realpathLoose(p, ctx) {
  const P = pathMod(ctx);
  const abs = P.isAbsolute(p) ? p : ctx.cwd + P.sep + p;
  const root = P.parse(abs).root;
  let depth = 0;
  /**
   * @param {string} base an already resolved directory
   * @param {string} rest the components still to walk
   * @returns {string}
   */
  const walk = (base, rest) => {
    let cur = base;
    for (const comp of rest.split(/[\\/]+/)) {
      if (!comp || comp === '.') continue;
      if (comp === '..') {
        cur = P.dirname(cur);
        continue;
      }
      const next = P.join(cur, comp);
      const st = lstat(next);
      if (st && st.isSymbolicLink()) {
        if (++depth > 40) throw new ConfineError(p + ': too many levels of symbolic links');
        const target = fs.readlinkSync(next);
        cur = P.isAbsolute(target) ? walk(P.parse(target).root, target.slice(P.parse(target).root.length)) : walk(cur, target);
      } else {
        cur = next;
      }
    }
    return cur;
  };
  const resolved = walk(root, abs.slice(root.length));
  if ((ctx.platform || process.platform) !== 'win32') return resolved;
  // The longest existing prefix, canonicalised by the OS; the missing remainder appended as written.
  let head = resolved;
  const tail = [];
  while (!lstat(head) && P.dirname(head) !== head) {
    tail.unshift(P.basename(head));
    head = P.dirname(head);
  }
  try {
    head = fs.realpathSync.native(head);
  } catch {
    // keep the walked form
  }
  return tail.length ? P.join(head, ...tail) : head;
}

/**
 * Python's tempfile.gettempdir(): TMPDIR, TEMP, TMP, then the platform's defaults; the first that is a
 * writable directory, as an absolute path (not resolved further).
 * @param {Context} ctx
 */
export function tempDir(ctx) {
  const P = pathMod(ctx);
  const win = (ctx.platform || process.platform) === 'win32';
  const e = ctx.env;
  /** @type {string[]} */
  const candidates = [e.TMPDIR, e.TEMP, e.TMP].filter((v) => typeof v === 'string' && v !== '').map(String);
  if (win) {
    const home = e.USERPROFILE || os.homedir();
    candidates.push(P.join(home, 'AppData', 'Local', 'Temp'));
    if (e.SYSTEMROOT || e.SystemRoot) candidates.push(P.join(String(e.SYSTEMROOT || e.SystemRoot), 'Temp'));
    candidates.push('c:\\temp', 'c:\\tmp', '\\temp', '\\tmp');
  } else {
    candidates.push('/tmp', '/var/tmp', '/usr/tmp');
  }
  for (const c of candidates) {
    const abs = P.resolve(ctx.cwd, c);
    try {
      if (fs.statSync(abs).isDirectory()) {
        fs.accessSync(abs, fs.constants.W_OK);
        return abs;
      }
    } catch {
      // not usable
    }
  }
  return ctx.cwd;
}

/**
 * The roots a readable input may live under: the current work tree, then the temporary directories,
 * each resolved, without repeats.
 * @param {Context} ctx
 * @returns {string[]}
 */
export function allowedRoots(ctx) {
  /** @type {string[]} */
  const candidates = [];
  const git = onPath('git', ctx.env, ctx.platform);
  if (git) {
    const r = runAbsolute(git, ['rev-parse', '--show-toplevel'], { cwd: ctx.cwd, env: ctx.env });
    const top = r.stdout.trim();
    if (top) candidates.push(top);
  }
  candidates.push(tempDir(ctx));
  try {
    if (fs.statSync('/tmp').isDirectory()) candidates.push('/tmp');
  } catch {
    // no /tmp
  }
  /** @type {string[]} */
  const roots = [];
  for (const c of candidates) {
    const real = realpathLoose(c, ctx);
    if (!roots.includes(real)) roots.push(real);
  }
  return roots;
}

/**
 * Is real strictly under root, by whole path components (case-insensitively on Windows)?
 * @param {string} root
 * @param {string} real
 * @param {Context} ctx
 */
export function under(root, real, ctx) {
  const P = pathMod(ctx);
  const win = (ctx.platform || process.platform) === 'win32';
  const a = win ? root.toLowerCase() : root;
  const b = win ? real.toLowerCase() : real;
  if (win && P.parse(a).root !== P.parse(b).root) return false;
  const rel = P.relative(a, b);
  return rel !== '' && !P.isAbsolute(rel) && rel.split(P.sep)[0] !== '..';
}

/**
 * The real path of p when it lies under an allowed root; a ConfineError otherwise. Nothing is read.
 * @param {string} p
 * @param {Context} ctx
 */
export function confined(p, ctx) {
  const real = realpathLoose(expandUser(String(p), ctx), ctx);
  for (const root of allowedRoots(ctx)) {
    if (under(root, real, ctx)) return real;
  }
  throw new ConfineError(p + ' is outside the repository work tree and the temporary directory; refusing to read it');
}
