// mhw uninstall [--yes] [--verbose] (Issue #113), moved from global/workstation.py by #495 (S24 of #470):
// the same conversation as install. It says what goes, waits for RETURN, asks for the administrator
// password once when the system-wide protections are installed, removes them, then the user layer.
// Without a terminal it only says what it would do, unless --yes. In an npm install it runs before
// `npm uninstall -g mhw` (npm runs no uninstall script, measured with npm 11.13.0), and it names that step
// only when the admin layer is gone: the package holds the only tool able to remove it. node: modules only.
import { adminPresent } from '../lib/readers/admin.js';
import {
  SH, FRESH, INSTALL_MANAGED, capture, installArgs, show, heading, nextSteps, styled, interactive, confirm, adminAccess, asRoot,
} from '../lib/lifecycle.js';
import { adminSupported } from './install.js';
import { wordsOf } from './status.js';
import { ROOT, packageName } from './postinstall.js';

/** @typedef {import('../lib/readers/common.js').Env} Env */
/** @typedef {import('../lib/lifecycle.js').Io} Io */
/** @typedef {import('../lib/lifecycle.js').Runner} Runner */

/**
 * @param {{ verbose?: boolean, yes?: boolean }} o
 * @param {Env} env the environment the installers get
 * @param {Io} io
 * @param {{ asking?: boolean, access?: typeof adminAccess, confirm?: typeof confirm, run?: Runner, root?: string, npm?: boolean }} [t]
 *   tests only
 * @returns {number}
 */
export function uninstall(o, env, io, t = {}) {
  const { verbose = false, yes = false } = o;
  const run = t.run || capture;
  const root = t.root || ROOT;
  const w = wordsOf(root);
  const cmd = w.cmd;
  const npm = t.npm ?? w.npm;
  const asking = t.asking ?? interactive();
  const admin = adminPresent(env) && adminSupported();
  heading('mhw will remove from this workstation:', env, io);
  io.out('  - Your settings in Claude Code, Codex and Kiro that mhw wrote (your own entries stay)\n');
  if (admin) io.out('  - The system-wide protections (needs your administrator password, once)\n');
  if (!asking && !yes) {
    io.out('\nNothing was changed: no terminal to confirm in.\n');
    nextSteps(['Run `' + cmd + ' uninstall` in a terminal (or `' + cmd + ' uninstall --yes`).'], env, io);
    return 0;
  }
  if (asking && !yes) {
    io.out('\n');
    if (!(t.confirm || confirm)(env, io)) {
      io.out('Aborted; nothing was changed.\n');
      return 1;
    }
  }
  /** @type {string[]} */
  const failed = [];
  /** @type {string[]} */
  const steps = [];
  if (admin) {
    if ((t.access || adminAccess)(asking, env, io)) {
      heading('Removing the system-wide protections', env, io);
      const [exe, args] = asRoot([SH, INSTALL_MANAGED, '--remove'], env);
      const [acode, alines] = run(exe, args, env);
      show(alines, verbose, io);
      if (acode !== 0) failed.push('System-wide protections (exit ' + acode + '; `' + cmd + ' uninstall --verbose` shows why)');
    } else {
      steps.push('Run `' + cmd + ' uninstall` in a terminal to remove the system-wide protections; it asks for your administrator password.');
    }
  }
  heading('Removing your settings', env, io);
  const [code, lines] = run(SH, installArgs(['--uninstall'], env), env);
  show(lines, verbose, io);
  if (code !== 0) failed.push('Your settings (exit ' + code + '; `' + cmd + ' uninstall --verbose` shows why)');
  // The admin layer still on disk (skipped or failed): not a success, and the package that holds the only
  // tool able to remove it (install-managed.sh --remove) must stay (PR #114 lens).
  const left = admin && adminPresent(env);
  io.out('\n');
  if (failed.length) {
    io.out(styled('31;1', 'Uninstall incomplete:', env, io) + '\n');
    for (const f of failed) io.out('  - ' + f + '\n');
  } else if (left) {
    io.out(styled('33;1', 'Partly removed:', env, io) + ' your settings are gone; the system-wide protections are still installed.\n');
  } else {
    io.out(styled('32;1', 'Uninstall complete.', env, io) + '\n');
  }
  steps.push(FRESH);
  if (npm && !left) steps.push('Run `npm uninstall -g ' + packageName(root) + '` to remove the mhw command itself.');
  nextSteps(steps, env, io);
  return failed.length || left ? 1 : 0;
}
