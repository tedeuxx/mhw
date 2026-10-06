#!/usr/bin/env node
// The npm postinstall of mhw (Issue #68, ADR-0034): `npm install -g --foreground-scripts github:<repo>#vX.Y.Z` installs and
// updates every user-level resource, the same path as `mhw install`. Non-interactive (stdin is closed),
// idempotent (install.sh is), never sudo and never an admin path: for the admin layer it prints the one
// sudo line the owner runs himself.
//
// npm runs this script in three situations, and only the third installs anything:
//   1. npm's own preparation of a git dependency (pacote): it runs `npm install` inside a temporary
//      clone before packing it, with the outer --global inherited. That inner run links the temporary
//      clone into the global prefix and the outer install then unpacks through the link into a
//      directory npm deletes (measured with npm 11.13.0: a dangling install, Issue #68). This script
//      puts an empty directory back where the link was and installs nothing.
//   2. Not a global install (a local dependency, a CI checkout, npm ci): nothing to do; it says why.
//   3. A global install, running from the installed copy: install, then print the admin sudo line when
//      the admin layer is absent or stale, the fresh-session reminder and the runtime summary. It exits
//      0 even when the install refuses a target: npm would otherwise remove the package (Issue #110).
// Opt-in: MHW_METHOD=1 in the environment also renders the working method (as `mhw install --method`).
// npm shows a lifecycle script's output only when it fails or with --foreground-scripts (measured), so
// the report goes to the terminal (/dev/tty) when there is one. Standard library only.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const mhw = require('./mhw.js');

const ROOT = mhw.ROOT;

function packageName(root) {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).name;
}

function real(p) {
  try {
    return fs.realpathSync(p);
  } catch (e) {
    return null;
  }
}

// The global node_modules directory npm installs into: <prefix>/lib/node_modules, or
// <prefix>\node_modules on Windows.
function globalModules(env, platform) {
  const prefix = env.npm_config_global_prefix || env.npm_config_prefix;
  if (!prefix) return null;
  return platform === 'win32' ? path.join(prefix, 'node_modules') : path.join(prefix, 'lib', 'node_modules');
}

// -> { action: 'prepare' | 'skip' | 'install', reason }
function decide(env, platform, root, name) {
  if (env._PACOTE_NO_PREPARE_ !== undefined) {
    return { action: 'prepare', reason: "npm's preparation of the git dependency in a temporary clone" };
  }
  if (env.npm_config_global !== 'true') {
    return { action: 'skip', reason: 'not a global install (a local dependency, a CI checkout or npm ci); run mhw install yourself if you mean it' };
  }
  const modules = globalModules(env, platform);
  const expected = modules ? real(path.join(modules, name)) : null;
  const here = real(root);
  if (path.basename(path.dirname(here || root)) !== 'node_modules' || (expected !== null && expected !== here)) {
    return { action: 'skip', reason: 'this copy is not the installed package (' + root + ')' };
  }
  return { action: 'install', reason: 'global install' };
}

// Case 1: the inner preparation run left <global modules>/<name> as a link to this temporary clone.
// Put an empty directory there so the outer install unpacks into a real directory. Only a link that
// resolves to this very directory is touched.
function undoPrepareLink(env, platform, root, name) {
  if (env.npm_config_global !== 'true') return 'not global; nothing linked';
  const modules = globalModules(env, platform);
  if (!modules) return 'no global prefix in the environment; nothing touched';
  const link = path.join(modules, name);
  let st;
  try {
    st = fs.lstatSync(link);
  } catch (e) {
    return 'no link at ' + link;
  }
  if (!st.isSymbolicLink() || real(link) !== real(root)) return 'the entry at ' + link + ' is not a link to this clone; untouched';
  fs.unlinkSync(link);
  fs.mkdirSync(link);
  return 'replaced the link to the temporary clone at ' + link + ' with an empty directory';
}

// The report goes to the terminal when there is one, because npm hides a successful script's output.
// MHW_POSTINSTALL_TTY=0 keeps it on stdout (tests, and anyone capturing it with --foreground-scripts).
function reportStream(platform, env) {
  if (platform === 'win32' || process.stdout.isTTY || env.MHW_POSTINSTALL_TTY === '0') return 'inherit';
  try {
    return fs.openSync('/dev/tty', 'w');
  } catch (e) {
    return 'inherit';
  }
}

function run(env, platform) {
  const name = packageName(ROOT);
  const d = decide(env, platform, ROOT, name);
  if (d.action === 'prepare') {
    console.log('mhw postinstall: SKIP ' + d.reason + '; ' + undoPrepareLink(env, platform, ROOT, name));
    return 0;
  }
  if (d.action === 'skip') {
    console.log('mhw postinstall: SKIP ' + d.reason);
    return 0;
  }
  const method = env.MHW_METHOD === '1' || env.MHW_METHOD === 'true';
  const out = reportStream(platform, env);
  const stdio = ['ignore', out, out];
  if (out !== 'inherit') console.log('mhw postinstall: the report is written to the terminal');
  let code;
  if (platform === 'win32') {
    code = mhw.main(['install'].concat(method ? ['--method'] : []), platform, env, { stdio });
    console.log('THEN    open fresh agent harness sessions; mhw status reports what is installed');
  } else {
    code = mhw.main(['postinstall'].concat(method ? ['--method'] : []), platform, env, { stdio });
  }
  return keep(code, out);
}

// Issue #110: npm rolls a global install back on any non-zero lifecycle exit, which deletes the package
// whose mhw command and install-managed.sh path the report just printed. A refused or partial install is
// a next step for the owner, so it is said in the report and the exit stays 0: the package is kept.
function keep(code, out) {
  if (code !== 0) {
    const line = 'ACTION  the install exited ' + code + ' (see the REFUSE or SKIP lines above); the package is kept: ' +
      'fix what they name, then run mhw install, and mhw check to confirm\n';
    if (out === 'inherit') process.stdout.write(line);
    else fs.writeSync(out, line);
  }
  return 0;
}

module.exports = { decide, undoPrepareLink, globalModules, keep };

if (require.main === module) {
  process.exitCode = run(process.env, process.env.WORKSTATION_LAUNCHER_PLATFORM || process.platform);
}
