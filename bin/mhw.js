#!/usr/bin/env node
// mhw, the command of the npm package (Issue #68, ADR-0034). npm links this file onto PATH;
// every path below is resolved from this file's own location (npm resolves the link, so __dirname is
// the installed package), never from the current directory.
//   macOS and Linux: runs the package's ./mhw with the same arguments.
//   Windows:         runs global\install.ps1 (install, install --method, check, status = check) and
//                    answers update itself; install --admin and uninstall do not exist there.
// Standard library only, no runtime dependency. Interpreters are run by absolute path, never looked
// up on PATH. bin/workstation.js is the deprecated alias; bin/postinstall.js reuses main().
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');
const REPO = 'tedeuxx/mhw';
const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;
const USAGE = [
  'mhw install [--method] [--overlay=DIR|none] | check | status | update [vX.Y.Z]',
  '(Windows: install.ps1; install --admin and uninstall are macOS and Linux only)',
];

function version(root) {
  const text = fs.readFileSync(path.join(root, '.bumpversion.toml'), 'utf8');
  const m = /^current_version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m.exec(text);
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
      'UPDATE  this is an npm install (no .git); update it with npm, whose postinstall installs:',
      'RUN     npm install -g --foreground-scripts github:' + REPO + '#' + ref,
    ],
  };
}

// install.ps1's parameters for install, check and status, or a refusal.
function powershellArgs(command, rest) {
  const ps = command === 'install' ? [] : ['-Check'];
  for (const arg of rest) {
    if (arg === '--method' && command === 'install') {
      ps.push('-Method');
    } else if (arg.startsWith('--overlay=') && arg.length > '--overlay='.length) {
      ps.push('-Overlay', arg.slice('--overlay='.length));
    } else {
      const note = arg === '--admin' ? ' (macOS and Linux only)' : '';
      return { code: 2, err: 'mhw: unknown argument for ' + command + ': ' + arg + note };
    }
  }
  return { code: 0, ps };
}

// Windows: the subcommand mapped onto install.ps1, an answer printed here, or a refusal.
function windowsPlan(argv) {
  const [command, ...rest] = argv;
  if (!command || ['-h', '--help', 'help'].includes(command)) {
    return { code: command ? 0 : 2, out: USAGE };
  }
  if (command === 'update') {
    if (rest.length > 1 || (rest[0] || '').startsWith('-')) {
      return { code: 2, err: 'mhw: update takes at most one tag' };
    }
    return updateLines(rest[0], ROOT);
  }
  if (!['install', 'check', 'status'].includes(command)) {
    return { code: 2, err: 'mhw: ' + command + ' is not available on Windows (install, check, status, update)' };
  }
  return powershellArgs(command, rest);
}

// PowerShell 7 where installed, else the Windows PowerShell 5.1 every Windows ships; absolute paths.
function powershell(env) {
  const candidates = [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  return candidates.find((exe) => fs.existsSync(exe)) || null;
}

function exitWith(p) {
  if (p.error) {
    console.error('mhw: ' + p.error.message);
    return 2;
  }
  return p.status === null ? 1 : p.status;
}

function main(argv, platform, env, opts = {}) {
  if (platform !== 'win32') {
    return exitWith(spawnSync('/bin/sh', [path.join(ROOT, 'mhw'), ...argv], { stdio: opts.stdio || 'inherit' }));
  }
  const plan = windowsPlan(argv);
  if (plan.err) {
    console.error(plan.err);
    return plan.code;
  }
  if (plan.out) {
    console.log(plan.out.join('\n'));
    return plan.code;
  }
  // WORKSTATION_POWERSHELL: tests and CI only, to pin one PowerShell; an absolute path.
  const exe = env.WORKSTATION_POWERSHELL || powershell(env);
  if (!exe || !path.isAbsolute(exe)) {
    console.error('mhw: PowerShell was not found (pwsh 7 or Windows PowerShell 5.1)');
    return 2;
  }
  const ps1 = path.join(ROOT, 'global', 'install.ps1');
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...plan.ps];
  return exitWith(spawnSync(exe, args, { stdio: opts.stdio || 'inherit' }));
}

module.exports = { updateLines, windowsPlan, main, ROOT };

if (require.main === module) {
  // WORKSTATION_LAUNCHER_PLATFORM: tests only, so the Windows mapping is exercised on every runner.
  const env = process.env;
  process.exitCode = main(process.argv.slice(2), env.WORKSTATION_LAUNCHER_PLATFORM || process.platform, env);
}
