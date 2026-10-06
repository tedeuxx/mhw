#!/usr/bin/env node
// The `workstation` command of the npm package (Issue #68, ADR-0034). npm links this file onto PATH;
// every path below is resolved from this file's own location (npm resolves the link, so __dirname is
// the installed package), never from the current directory.
//   macOS and Linux: runs the package's ./workstation with the same arguments.
//   Windows:         runs global\install.ps1 (install, install --method, check, status = check) and
//                    answers update itself; install --admin and uninstall do not exist there.
// Standard library only, no runtime dependency.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'tedeuxx/personal-multi-harness-workstation-configuration';
const RELEASE = /^v([0-9]+)\.([0-9]+)\.([0-9]+)$/;

function version(root) {
  const text = fs.readFileSync(path.join(root, '.bumpversion.toml'), 'utf8');
  const m = text.match(/^current_version\s*=\s*"([0-9]+)\.([0-9]+)\.([0-9]+)"/m);
  return m ? [m[1], m[2], m[3]] : null;
}

// The npm update for this package: the tag asked for, or the newest release in the installed major
// (major = breaking, Issue #52), which npm resolves from the repository's tags. Same text as
// global/workstation.py's npm_update_lines(); global/npm_package_test.py holds the two together.
function updateLines(wanted, root) {
  let ref;
  if (wanted === undefined) {
    const v = version(root);
    ref = v ? 'semver:^' + v.join('.') : 'semver:*';
  } else {
    const m = RELEASE.exec(wanted);
    if (!m) return { code: 2, err: 'REFUSE  the tag must be a numeric release, vX.Y.Z' };
    ref = 'v' + m[1] + '.' + m[2] + '.' + m[3];
  }
  return {
    code: 0,
    out: [
      'UPDATE  this is an npm install (no .git); update it with npm, then install:',
      'RUN     npm install -g github:' + REPO + '#' + ref,
      'RUN     workstation install',
    ],
  };
}

// Windows: the subcommand and options mapped onto install.ps1's parameters, or a refusal.
function windowsPlan(argv) {
  const [command, ...rest] = argv;
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    return { code: command ? 0 : 2, out: ['workstation install [--method] [--overlay=DIR|none] | check | status | update [vX.Y.Z]',
      '(Windows: install.ps1; install --admin and uninstall are macOS and Linux only)'] };
  }
  if (command === 'update') {
    if (rest.length > 1 || (rest[0] || '').startsWith('-')) return { code: 2, err: 'workstation: update takes at most one tag' };
    return updateLines(rest[0], ROOT);
  }
  if (!['install', 'check', 'status'].includes(command)) {
    return { code: 2, err: 'workstation: ' + command + ' is not available on Windows (install, check, status, update)' };
  }
  const ps = [];
  if (command !== 'install') ps.push('-Check');
  for (const arg of rest) {
    if (arg === '--method' && command === 'install') ps.push('-Method');
    else if (arg.startsWith('--overlay=') && arg.length > '--overlay='.length) ps.push('-Overlay', arg.slice('--overlay='.length));
    else return { code: 2, err: 'workstation: unknown argument for ' + command + ': ' + arg + (arg === '--admin' ? ' (macOS and Linux only)' : '') };
  }
  return { code: 0, ps };
}

function powershell() {
  for (const exe of ['pwsh', 'powershell']) {
    const p = spawnSync(exe, ['-NoProfile', '-NonInteractive', '-Command', 'exit 0'], { stdio: 'ignore' });
    if (!p.error) return exe;
  }
  return null;
}

function exitWith(p) {
  if (p.error) { console.error('workstation: ' + p.error.message); return 2; }
  return p.status === null ? 1 : p.status;
}

function main(argv, platform) {
  if (platform !== 'win32') {
    return exitWith(spawnSync('sh', [path.join(ROOT, 'workstation'), ...argv], { stdio: 'inherit' }));
  }
  const plan = windowsPlan(argv);
  if (plan.err) { console.error(plan.err); return plan.code; }
  if (plan.out) { console.log(plan.out.join('\n')); return plan.code; }
  const exe = process.env.WORKSTATION_POWERSHELL || powershell();
  if (!exe) { console.error('workstation: PowerShell (pwsh or powershell) is required'); return 2; }
  const ps1 = path.join(ROOT, 'global', 'install.ps1');
  return exitWith(spawnSync(exe, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...plan.ps],
    { stdio: 'inherit' }));
}

module.exports = { updateLines, windowsPlan, ROOT };

if (require.main === module) {
  // WORKSTATION_LAUNCHER_PLATFORM: tests only, so the Windows mapping is exercised on every runner.
  process.exitCode = main(process.argv.slice(2), process.env.WORKSTATION_LAUNCHER_PLATFORM || process.platform);
}
