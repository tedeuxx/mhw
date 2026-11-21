// mhw install (Issue #113), moved from global/workstation.py by #495 (S24 of #470): the one door,
// Homebrew-style. It says what will change, waits for RETURN, asks for the administrator password once
// and only when the admin layer changes, installs the admin layer and then the user layer, and ends with
// the result and numbered next steps. Without a terminal it only says what it would do, unless --yes.
//
//   mhw install [--yes] [--verbose]   the admin layer (when it changes) and the user layer
//   mhw install --no-admin            the user layer only, no password asked
//   mhw install --admin               the admin layer only
//   mhw install --method              also render the working method (method/)
//
// The parts it shares with update and uninstall are src/lib/lifecycle.js. node: modules only.
import { adminInstalled, adminPresent } from '../lib/readers/admin.js';
import { darwin } from '../lib/readers/common.js';
import {
  SH, FRESH, capture, installArgs, managedArgs, issues, isProblem, show, heading, nextSteps, styled, interactive,
  confirm, adminAccess, adminApply, ownerSteps,
} from '../lib/lifecycle.js';
import { wordsOf } from './status.js';
import { ROOT, packageVersion } from './postinstall.js';

/** @typedef {import('../lib/readers/common.js').Env} Env */
/** @typedef {import('../lib/lifecycle.js').Io} Io */
/** @typedef {import('../lib/lifecycle.js').Runner} Runner */
/** @typedef {{ user: number, admin: 'skipped' | 'absent' | 'current' | 'differs', admin_count: number }} Plan */

/** The admin layer exists on macOS and Linux only. */
export function adminSupported() {
  return darwin() || process.platform === 'linux';
}

/** @param {Env} env */
const hooksMode = (env) => (adminInstalled(env) ? 'managed' : 'user');

/**
 * What `mhw install` would change, read-only: the user-layer targets that differ, and the admin layer's
 * state ('current', 'absent', 'differs' or 'skipped').
 * @param {boolean} adminWanted @param {boolean} userWanted @param {Env} env @param {Runner} [run]
 * @returns {Plan}
 */
export function installPlan(adminWanted, userWanted, env, run = capture) {
  /** @type {Plan} */
  const plan = { user: 0, admin: 'skipped', admin_count: 0 };
  if (userWanted) {
    const [code, lines] = run(SH, installArgs(['--check', '--hooks=' + hooksMode(env)], env), env);
    plan.user = issues(lines) || (code ? 1 : 0);
  }
  if (adminWanted && adminSupported()) {
    if (!adminPresent(env)) {
      plan.admin = 'absent';
    } else {
      const [acode, alines] = run(SH, managedArgs(['--check'], env), env);
      plan.admin = acode === 0 ? 'current' : 'differs';
      plan.admin_count = acode ? Math.max(issues(alines), 1) : 0;
    }
  }
  return plan;
}

/** @param {Plan} plan */
export function planLines(plan) {
  /** @type {string[]} */
  const out = [];
  if (plan.user) out.push('Your settings in Claude Code, Codex and Kiro: ' + plan.user + ' file(s) to write (no password needed)');
  if (plan.admin === 'absent') {
    out.push('System-wide protections that no session can switch off: install them (needs your administrator password, once)');
  } else if (plan.admin === 'differs') {
    out.push('System-wide protections: ' + plan.admin_count + ' file(s) to update (needs your administrator password, once)');
  }
  return out;
}

/**
 * @param {{ adminOnly?: boolean, method?: boolean, verbose?: boolean, yes?: boolean, noAdmin?: boolean }} o
 * @param {Env} env the environment the installers get (MHW_CMD, MHW_NODE and the overlay already set)
 * @param {Io} io
 * @param {{ asking?: boolean, access?: typeof adminAccess, confirm?: typeof confirm, run?: Runner, root?: string }} [t]
 *   tests only: a terminal or not, the admin-access and RETURN answers, the runner, the copy's root
 * @returns {number}
 */
export function install(o, env, io, t = {}) {
  const { adminOnly = false, method = false, verbose = false, yes = false, noAdmin = false } = o;
  const run = t.run || capture;
  const w = wordsOf(t.root || ROOT);
  const cmd = w.cmd;
  const version = w.npm ? packageVersion(t.root || ROOT) : 'this checkout';
  const asking = t.asking ?? interactive();
  const plan = installPlan(!noAdmin, !adminOnly, env, run);
  const changes = planLines(plan);
  if (!changes.length && !method) {
    heading(w.npm ? 'mhw ' + version.replace(/^v+/, '') + ' is already installed and up to date' : 'This workstation already matches this checkout', env, io);
    nextSteps(['Run `' + cmd + ' status` to see what is installed.'], env, io);
    return 0;
  }
  heading(w.npm ? 'mhw ' + version.replace(/^v+/, '') + ' will change this workstation:' : 'mhw will change this workstation from this checkout:', env, io);
  for (const line of changes.length ? changes : ['Your settings: render the working method']) io.out('  - ' + line + '\n');
  if (!asking && !yes) {
    io.out('\nNothing was changed: no terminal to confirm in.\n');
    nextSteps(['Run `' + cmd + ' install` in a terminal (or `' + cmd + ' install --yes` to skip the question).'], env, io);
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
  /** @type {string[]} */
  let owner = [];
  let pending = false;
  if (plan.admin === 'absent' || plan.admin === 'differs') {
    if ((t.access || adminAccess)(asking, env, io)) {
      heading('Installing the system-wide protections', env, io);
      const [code] = adminApply(verbose, env, io, run);
      if (code !== 0) failed.push('System-wide protections (exit ' + code + '; `' + cmd + ' install --verbose` shows why)');
    } else {
      pending = true;
      steps.push('Run `' + cmd + ' install` in a terminal to install the system-wide protections; it asks for your administrator password.');
    }
  }
  if (!adminOnly) {
    heading('Installing your settings', env, io);
    const [code, lines] = run(SH, installArgs(['--hooks=' + hooksMode(env), ...(method ? ['--method'] : [])], env), env);
    show(lines, verbose, io);
    if (code !== 0) failed.push('Your settings (exit ' + code + '; `' + cmd + ' install --verbose` shows why)');
    owner = ownerSteps(lines);
  }
  heading('Checking', env, io);
  const [ccode, clines] = run(SH, installArgs(['--check', '--hooks=' + hooksMode(env)], env), env);
  if (!adminOnly && ccode !== 0) {
    show(clines.filter(isProblem), verbose, io);
    failed.push('Your settings still differ in ' + Math.max(issues(clines), 1) + ' file(s)');
  }
  if (adminPresent(env) && !noAdmin) {
    const [acode, alines] = run(SH, managedArgs(['--check'], env), env);
    if (acode !== 0 && (plan.admin === 'absent' || plan.admin === 'differs') && !steps.length) {
      failed.push('System-wide protections still differ in ' + Math.max(issues(alines), 1) + ' file(s)');
    }
  }
  io.out('\n');
  if (failed.length) {
    io.out(styled('31;1', 'Installation incomplete:', env, io) + '\n');
    for (const f of failed) io.out('  - ' + f + '\n');
    steps.unshift('Fix what is named above, then run `' + cmd + ' install` again.');
  } else if (pending) {
    // The plan listed the system-wide protections and they were not installed: not a success.
    io.out(styled('33;1', 'Partly installed:', env, io) + ' your settings are in place; the system-wide protections are not.\n');
  } else {
    io.out(styled('32;1', 'Installation successful!', env, io) + '\n');
  }
  steps.push(FRESH, ...owner, 'Run `' + cmd + ' status` to see what is installed.');
  nextSteps(steps, env, io);
  return failed.length || pending ? 1 : 0;
}
