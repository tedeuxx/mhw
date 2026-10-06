#!/usr/bin/env node
// The npm postinstall of mhw (Issue #68, ADR-0034; Issue #113). Since #113 it installs nothing: npm
// installs mhw silently, like any global package, and `mhw install` is the one door to the workstation.
//
// npm runs this script in three situations:
//   1. npm's own preparation of a git dependency (pacote): it runs `npm install` inside a temporary
//      clone before packing it, with the outer --global inherited. That inner run links the temporary
//      clone into the global prefix and the outer install then unpacks through the link into a
//      directory npm deletes (measured with npm 11.13.0: a dangling install, Issue #68). This script
//      puts an empty directory back where the link was. Silent.
//   2. Not a global install (a local dependency, a CI checkout, npm ci): nothing to do. Silent.
//   3. A global install, running from the installed copy: one line, on the terminal when there is one,
//      naming the next step (`mhw install`). It always exits 0, so npm keeps the package (Issue #110).
// npm shows a lifecycle script's output only when it fails or with --foreground-scripts (measured), so
// the line goes to the terminal (/dev/tty) when there is one. Standard library only.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const ROOT = path.resolve(__dirname, '..');

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

// The line goes to the terminal when there is one, because npm hides a successful script's output.
// MHW_POSTINSTALL_TTY=0 keeps it on stdout (tests, and anyone capturing it with --foreground-scripts).
function say(line, platform, env) {
  if (platform !== 'win32' && !process.stdout.isTTY && env.MHW_POSTINSTALL_TTY !== '0') {
    try {
      const fd = fs.openSync('/dev/tty', 'w');
      fs.writeSync(fd, line + '\n');
      fs.closeSync(fd);
      return;
    } catch (e) {
      // no terminal: stdout, which npm shows only with --foreground-scripts
    }
  }
  process.stdout.write(line + '\n');
}

function run(env, platform) {
  const name = packageName(ROOT);
  const d = decide(env, platform, ROOT, name);
  if (d.action === 'prepare') {
    undoPrepareLink(env, platform, ROOT, name);
    return 0;
  }
  if (d.action === 'install') {
    const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;
    say('mhw ' + v + ' is ready. Run `mhw install` to set up or update this workstation.', platform, env);
  }
  return 0;
}

module.exports = { decide, undoPrepareLink, globalModules };

if (require.main === module) {
  process.exitCode = run(process.env, process.env.WORKSTATION_LAUNCHER_PLATFORM || process.platform);
}
