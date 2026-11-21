// mhw check (#494, S23 of #470), moved from global/workstation.py: exit non-zero when an installed target
// differs from this copy (the admin layer included, stamped or from an earlier release) or a required
// prerequisite is missing.
//
//   mhw check                    the installers' --check, then the prerequisites (global/prerequisites.json)
//   mhw check --prerequisites    the prerequisites section only (Issue #89); never applies anything
//   mhw check --project=DIR      also check DIR's root AGENTS.md merge-authority declaration against the
//                                installed method contract (Issue #195): exit 1 on a finding, 2 when the
//                                installed method cannot validate it (fail closed)
//   Options: --overlay=DIR|none (default: the repository's overlay/).
//
// Read-only. It runs global/install.sh --check (its lines go straight to this process's stdout and stderr)
// and, when an admin layer of ours is on disk, global/install-managed.sh --check, under /bin/sh, and names
// what differs there. The validated --overlay reaches the installers and the prerequisites through
// WORKSTATION_OVERLAY, never their argv. The exit code is the largest of the sections'. macOS and Linux;
// on Windows `mhw check` stays install.ps1 -Check (src/cli.js). node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { managedRoot, homeOf, resolvePath, runLines } from '../lib/readers/common.js';
import { adminInstalled, adminPresent, adminReport } from '../lib/readers/admin.js';
import { runAbsolute } from '../lib/run.js';
import { ROOT, words, npmNotes, stampIn, briefPaths, validOverlay, OVERLAY_ENV } from './status.js';
import * as prerequisites from '../lib/prerequisites.js';
import { checkProject } from '../lib/merge-authority.js';

/** @typedef {import('../lib/readers/common.js').Env} Env */
/** @typedef {(line: string) => void} Out */

/** The installers' argv: the script, its flags, and the managed root when one is set. @param {string} script @param {string[]} extra @param {string} flag @param {Env} env */
export function installer(script, extra, flag, env) {
  const args = [path.join(ROOT, 'global', script), ...extra];
  if (managedRoot(env)) args.push(flag + managedRoot(env));
  return args;
}

/**
 * This copy's provenance stamp, as install.sh --check computes it (its SOURCE line).
 * @param {Env} env
 */
function sourceStamp(env) {
  const mode = adminInstalled(env) ? 'managed' : 'user';
  const [, lines] = runLines('/bin/sh', installer('install.sh', ['--check', '--hooks=' + mode], '--managed-root=', env), env);
  for (const l of lines) if (l.startsWith('SOURCE  ')) return l.slice('SOURCE  '.length);
  return 'none';
}

/**
 * The --project section: exit 0, 1 (findings) or 2 (cannot validate, fail closed).
 * @param {string} project @param {Env} env @param {string} cwd @param {Out} out
 */
export function checkProjectBrief(project, env, cwd, out) {
  let p = project;
  if (p === '~' || p.startsWith('~/')) p = homeOf(env) + p.slice(1);
  const root = resolvePath(path.resolve(cwd, p));
  let dir = false;
  try {
    dir = fs.statSync(root).isDirectory();
  } catch {
    dir = false;
  }
  if (!dir) {
    out('PROJECT ' + project + ' is not a directory');
    return 2;
  }
  const [code, lines] = checkProject(root, homeOf(env));
  for (const l of lines) out(l);
  return code;
}

/**
 * Every section of mhw check, in order, and the largest exit code.
 * @param {{ prerequisitesOnly: boolean, project: string | null }} o
 * @param {Env} env the environment the children get (MHW_CMD and the overlay already set)
 * @param {string} cwd @param {Out} out
 */
export function check(o, env, cwd, out) {
  let code = 0;
  if (!o.prerequisitesOnly) {
    const mode = adminInstalled(env) ? 'managed' : 'user';
    const r = runAbsolute('/bin/sh', installer('install.sh', ['--check', '--hooks=' + mode], '--managed-root=', env), { env, stdio: 'inherit' });
    code = r.error ? 2 : r.code;
    if (adminPresent(env)) {
      // Every admin layer of ours, stamped or from an earlier release (Issue #52), read-only.
      const [acode, alines] = runLines('/bin/sh', installer('install-managed.sh', ['--check'], '--root=', env), env);
      const W = words();
      for (const l of [...alines, ...adminReport(alines, acode, 'ADMIN   ', { source: W.source, next: W.adminNext })]) out(l);
      code = Math.max(code, acode);
    }
    if (words().npm) {
      /** @type {Record<string, string>} */
      const stamps = {};
      for (const [h, p] of Object.entries(briefPaths(env))) {
        const s = stampIn(p);
        if (s !== 'none') stamps[h] = s;
      }
      for (const note of npmNotes(sourceStamp(env), stamps)) out('NPM     ' + note);
    }
  }
  // Issue #89: present or missing, authenticated or not, drift from the preferred settings. Read-only.
  const [pcode, lines] = prerequisites.report(env);
  for (const l of lines) out(l);
  code = Math.max(code, pcode);
  if (o.project !== null) {
    // Issue #195: the project brief against the installed merge-authority contract. Read-only.
    code = Math.max(code, checkProjectBrief(o.project, env, cwd, out));
  }
  return code;
}

/**
 * The arguments after `check`, read: what to run and the environment the children get, or a usage error.
 * The validated --overlay goes into that environment (WORKSTATION_OVERLAY), never into an argv.
 * @param {string[]} argv @param {Env} env @param {string} cwd
 * @returns {{ err: string } | { err?: undefined, prerequisitesOnly: boolean, project: string | null, child: Env }}
 */
export function parse(argv, env, cwd) {
  /** @type {string | null} */
  let overlay = null;
  /** @type {string | null} */
  let project = null;
  let prerequisitesOnly = false;
  for (const arg of argv) {
    if (arg.startsWith('--overlay=')) overlay = arg.slice('--overlay='.length);
    else if (arg.startsWith('--project=')) project = arg.slice('--project='.length);
    else if (arg === '--prerequisites') prerequisitesOnly = true;
    else return { err: 'mhw: unknown argument for check: ' + arg };
  }
  // The installers' messages name the same command this process was reached by (Issue #68).
  /** @type {Env} */
  const child = { ...env, MHW_CMD: words().cmd, MHW_NODE: process.execPath };
  if (overlay !== null) {
    const valid = validOverlay(overlay, env, cwd);
    if (valid === null) return { err: "mhw: --overlay takes 'none' or an existing directory" };
    child[OVERLAY_ENV] = valid;
  }
  return { prerequisitesOnly, project, child };
}

/**
 * @param {string[]} argv the arguments after `check`
 * @param {Env} env
 * @param {{ cwd?: string, out?: Out, err?: Out }} [o]
 * @returns {number}
 */
export function main(argv, env, o = {}) {
  const out = o.out || ((/** @type {string} */ l) => fs.writeSync(1, l + '\n'));
  const err = o.err || ((/** @type {string} */ l) => fs.writeSync(2, l + '\n'));
  const cwd = o.cwd || process.cwd();
  const p = parse(argv, env, cwd);
  if (p.err !== undefined) {
    err(p.err);
    return 2;
  }
  return check({ prerequisitesOnly: p.prerequisitesOnly, project: p.project }, p.child, cwd, out);
}
