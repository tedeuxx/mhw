// mhw update [vX.Y.Z] [--yes] [--verbose], moved from global/workstation.py by #495 (S24 of #470).
//   In a checkout: fetch tags, check out the newest numeric release (or the one given), detached, then
//   install with the code of the release just checked out. Refuses on a working tree with a tracked
//   change, so nothing uncommitted is carried into or lost by the checkout.
//   In an npm install (package.json, no .git; Issue #68): run the npm update itself, by absolute path
//   (npm beside the node running mhw), then the new package's own `mhw install` (Issue #113). Without npm
//   beside node it prints the one npm line to run instead.
// The tag passed to git is always the repository's own tag name, never the CLI string. git and python3
// are looked up on PATH through src/lib/onpath.js (absolute entries only) and run by that absolute path.
// node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { adminInstalled } from '../lib/readers/admin.js';
import { onPath } from '../lib/onpath.js';
import { releaseOf } from '../lib/version.js';
import { SH, capture, installArgs, passThrough, show, heading, nextSteps, styled, uxFlags } from '../lib/lifecycle.js';
import { wordsOf, OVERLAY_ENV } from './status.js';
import { ROOT } from './postinstall.js';

/** @typedef {import('../lib/readers/common.js').Env} Env */
/** @typedef {import('../lib/lifecycle.js').Io} Io */
/** @typedef {import('../lib/lifecycle.js').Runner} Runner */
/** @typedef {{ code: number, out?: string[], err?: string }} Lines */

export const REPO = 'tedeuxx/mhw';
const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;

/**
 * The npm update for this package, never run here: the tag asked for, or the newest release in the
 * installed major (major = breaking, Issue #52), which npm resolves from the repository's tags.
 * @param {string | undefined} wanted
 * @param {string} root
 * @returns {Lines}
 */
export function updateLines(wanted, root) {
  let ref;
  if (wanted === undefined) {
    let v = null;
    try {
      v = releaseOf(root);
    } catch {
      v = null;
    }
    ref = v ? 'semver:^' + v.join('.') : 'semver:*';
  } else {
    const m = RELEASE.exec(wanted);
    if (!m) return { code: 2, err: 'REFUSE  the tag must be a numeric release, vX.Y.Z' };
    ref = 'v' + m[1] + '.' + m[2] + '.' + m[3];
  }
  return { code: 0, out: ['UPDATE  run this npm line, then mhw install:', 'RUN     npm install -g github:' + REPO + '#' + ref] };
}

/**
 * The highest strictly numeric vX.Y.Z tag in a list of tag names, or null. The first of equals wins.
 * @param {string[]} tags
 */
export function latestRelease(tags) {
  /** @type {[number[], string] | null} */
  let best = null;
  for (const tag of tags) {
    const t = tag.trim();
    const m = RELEASE.exec(t);
    if (!m) continue;
    const version = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (best === null || compareVersions(version, best[0]) > 0) best = [version, t];
  }
  return best ? best[1] : null;
}

/** Tuple order of two [major, minor, patch]. @param {number[]} a @param {number[]} b */
function compareVersions(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/**
 * npm beside the node that runs mhw, by absolute path, never looked up on PATH; null when there is none.
 * MHW_NPM (tests only) is an absolute path to a stand-in npm.
 * @param {Env} env @param {string} [node]
 */
export function npmBinary(env, node = process.execPath) {
  if (env.MHW_NPM && path.isAbsolute(env.MHW_NPM)) return env.MHW_NPM;
  if (!path.isAbsolute(node)) return null;
  const npm = path.join(path.dirname(node), 'npm');
  try {
    fs.accessSync(npm, fs.constants.X_OK);
    return fs.statSync(npm).isFile() ? npm : null;
  } catch {
    return null;
  }
}

/**
 * Issue #113: mhw runs the npm update itself, then `mhw install` from the new package, so the owner meets
 * one conversation. Without npm beside node, it says the one npm line to run instead.
 * @param {string | undefined} wanted @param {boolean} verbose @param {boolean} yes @param {Env} env @param {Io} io
 * @param {string} root
 */
function updateNpm(wanted, verbose, yes, env, io, root) {
  const r = updateLines(wanted, root);
  if (r.code !== 0) {
    io.err(r.err + '\n');
    return r.code;
  }
  const lines = /** @type {string[]} */ (r.out);
  const npm = npmBinary(env);
  if (npm === null) {
    io.out(lines.join('\n') + '\n');
    return 0;
  }
  const spec = /** @type {string} */ (lines.at(-1)?.split(/\s+/).pop());
  heading('Updating mhw (' + (wanted ? 'to ' + wanted : 'to the newest release of this major version') + ')', env, io);
  const args = ['install', '-g', '--no-fund', '--no-audit', '--loglevel=error', spec];
  if (verbose) io.out('    ' + args.join(' ') + '\n');
  const [ncode, nlines] = capture(npm, args, env);
  show(nlines, true, io);
  if (ncode !== 0) {
    io.out('\n' + styled('31;1', 'Update failed:', env, io) + ' npm exited ' + ncode + '.\n');
    nextSteps(['Check your network and run `mhw update` again.'], env, io);
    return ncode;
  }
  // The package on disk is the new one now: its own mhw runs the install conversation. bin/mhw.js is the
  // npm entry of every release since #68, whatever it runs behind it.
  return passThrough(process.execPath, [path.join(root, 'bin', 'mhw.js'), 'install', ...uxFlags(verbose, yes)], env, io);
}

/**
 * Fetch tags, check out the newest release (or the one asked for), then install from it.
 * @param {string | undefined} wanted @param {{ verbose?: boolean, yes?: boolean }} o @param {Env} env @param {Io} io
 * @param {{ root?: string }} [t] tests only: the copy's root
 */
export function update(wanted, o, env, io, t = {}) {
  const root = t.root || ROOT;
  const { verbose = false, yes = false } = o;
  if (wordsOf(root).npm) return updateNpm(wanted, verbose, yes, env, io, root);
  const gitExe = onPath('git', env);
  if (!gitExe) {
    io.err('REFUSE  git was not found on PATH; update needs it\n');
    return 2;
  }
  /** @param {string[]} args */
  const git = (...args) => capture(gitExe, ['-C', root, ...args], env);
  const [scode, dirty] = git('status', '--porcelain', '--untracked-files=no');
  if (scode !== 0) {
    io.err('REFUSE  ' + root + ' is not a git checkout; update needs one\n');
    return 2;
  }
  if (dirty.length) {
    io.err('REFUSE  the working tree has ' + dirty.length + ' tracked change(s); commit or stash them, then run update\n');
    return 3;
  }
  const [fcode, fout] = git('fetch', '--tags', '--quiet');
  if (fcode !== 0) {
    io.err('REFUSE  git fetch --tags failed: ' + fout.slice(-1).join(' ') + '\n');
    return 2;
  }
  const [, tags] = git('tag', '--list', 'v*');
  let target;
  if (wanted !== undefined) {
    const known = tags.filter((tag) => RELEASE.test(tag) && tag === wanted);
    if (!known.length) {
      io.err('REFUSE  ' + wanted + ' is not a numeric release tag of this repository (vX.Y.Z)\n');
      return 2;
    }
    target = known[0];
  } else {
    target = latestRelease(tags);
    if (target === null) {
      io.err('REFUSE  no numeric release tag found\n');
      return 2;
    }
  }
  // A release that can receive --overlay has an mhw entry that reads it: workstation.py until #495, the
  // Node install command since.
  const newEntry = git('cat-file', '-e', target + ':global/workstation.py')[0] === 0
    || git('cat-file', '-e', target + ':src/commands/install.js')[0] === 0;
  if (!newEntry && env[OVERLAY_ENV] !== undefined) {
    io.err('REFUSE  ' + target + ' predates ./mhw (then ./workstation) and cannot receive --overlay; nothing checked out\n');
    return 2;
  }
  let [, before] = git('rev-parse', '--abbrev-ref', 'HEAD');
  if (before.length === 1 && before[0] === 'HEAD') [, before] = git('rev-parse', '--short', 'HEAD');
  const [ccode, cout] = git('checkout', '--quiet', '--detach', target);
  if (ccode !== 0) {
    io.err('REFUSE  git checkout ' + target + ' failed: ' + cout.slice(-1).join(' ') + '\n');
    return 2;
  }
  io.out('UPDATE  checked out ' + target + ' (detached; was ' + (before.length ? before[0] : '?') + ')\n');
  return installCheckedOut(root, verbose, yes, env, io);
}

/**
 * Install with the code of the release just checked out, not with this process's copy: a release whose
 * entry is global/workstation.py (before #495) runs it with python3; one whose entry is Node runs its
 * bin/mhw.js; an older one runs install.sh directly.
 * @param {string} root @param {boolean} verbose @param {boolean} yes @param {Env} env @param {Io} io
 */
function installCheckedOut(root, verbose, yes, env, io) {
  const py = path.join(root, 'global', 'workstation.py');
  if (isFile(py)) {
    const python = onPath('python3', env);
    if (!python) {
      io.err('REFUSE  the release checked out runs on python3, which was not found on PATH; run its ./mhw install yourself\n');
      return 2;
    }
    // A release from before Issue #113 knows neither --yes nor --verbose for install.
    const flags = fs.readFileSync(py, 'utf8').includes('def install_plan(') ? uxFlags(verbose, yes) : [];
    return passThrough(python, ['-B', py, 'install', ...flags], env, io);
  }
  if (isFile(path.join(root, 'src', 'commands', 'install.js'))) {
    return passThrough(process.execPath, [path.join(root, 'bin', 'mhw.js'), 'install', ...uxFlags(verbose, yes)], env, io);
  }
  const args = installArgs(['--hooks=' + (adminInstalled(env) ? 'managed' : 'user')], env);
  args[0] = path.join(root, 'global', 'install.sh');
  return passThrough(SH, args, env, io);
}

/** @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
