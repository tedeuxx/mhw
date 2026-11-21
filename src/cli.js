// The mhw command line (#470). S01 (#472) is the strangler's first step: every command still runs its
// current implementation, so mhw behaves exactly as before. One addition: `mhw status` prints a NODE
// line first (D11), naming the running node against engines.node.
//   macOS and Linux: runs the package's ./mhw with the same arguments.
//   Windows:         runs global\install.ps1 (install, install --method, check, status = check) and
//                    answers update itself; install --admin and uninstall do not exist there.
// Moved commands (the strangler's later steps) are answered here on every OS: `mhw delivery` (#474),
// `mhw milestone` (#475), `mhw worklog` and `mhw launch-line` (#476), `mhw rite-cadence` (#477),
// `mhw funnel-review` (#478), `mhw profile` (#479), `mhw chrome-debugging` (#480), `mhw mcp launch` (#483)
// `mhw scan` (#486) and `mhw status` (#493, after its NODE and PASTE lines; macOS and Linux); new in Node:
// `mhw docs-baseline check` and `mhw onboard` (#523).
// Every path is resolved from this file's own location, never from the current directory. Interpreters
// this file runs go by absolute path, never looked up on PATH. A moved command may look a program up on
// PATH through src/lib/onpath.js (absolute entries only) and then run it by that absolute path: mhw scan
// does so for python3, which it runs isolated (-I) for the Keychain salt read (#486). node: modules only
// (convention 5 of #470: this file is
// on the hook path once `mhw hook prompt` moves here; test/deps-graph.test.js holds that).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enginesNode, nodeLine, releaseOf } from './lib/version.js';
import { runAbsolute } from './lib/run.js';
import { delivery } from './commands/delivery.js';
import { main as milestoneMain } from './commands/milestone.js';
import { main as worklogMain } from './commands/worklog.js';
import { main as launchLineMain } from './commands/launch-line.js';
import { main as riteCadenceMain } from './commands/rite-cadence.js';
import { main as funnelReviewMain } from './commands/funnel-review.js';
import { main as profileMain } from './commands/profile.js';
import { main as chromeDebuggingMain } from './render/chrome-debugging.js';
import { main as mcpLaunchMain } from './commands/mcp-launch.js';
import { main as scanMain } from './commands/scan.js';
import { main as pasteWrapperMain, statusLine as pasteStatusLine } from './commands/paste-wrapper.js';
import { checkMain as docsBaselineMain, onboardMain } from './commands/docs-baseline.js';
import { main as statusMain } from './commands/status.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'tedeuxx/mhw';
const RELEASE = /^v(\d+)\.(\d+)\.(\d+)$/;
const USAGE = [
  'mhw install [--method] [--overlay=DIR|none] | check | status | update [vX.Y.Z] | scan [--base=REF | PATH... | --file=PATH]',
  '(Windows: install.ps1; install --admin, scan and uninstall are macOS and Linux only)',
];

/**
 * @typedef {{ code: number, out?: string[], err?: string, ps?: string[] }} Plan
 */

/**
 * The npm update for this package: the tag asked for, or the newest release in the installed major
 * (major = breaking, Issue #52), which npm resolves from the repository's tags. Same text as
 * global/workstation.py's npm_update_lines(); global/npm_package_test.py holds the two together.
 * @param {string | undefined} wanted
 * @param {string} root
 * @returns {Plan}
 */
export function updateLines(wanted, root) {
  let ref;
  if (wanted === undefined) {
    const v = releaseOf(root);
    ref = v ? 'semver:^' + v.join('.') : 'semver:*';
  } else {
    const m = RELEASE.exec(wanted);
    if (!m) return { code: 2, err: 'REFUSE  the tag must be a numeric release, vX.Y.Z' };
    ref = 'v' + m[1] + '.' + m[2] + '.' + m[3];
  }
  return {
    code: 0,
    out: [
      'UPDATE  run this npm line, then mhw install:',
      'RUN     npm install -g github:' + REPO + '#' + ref,
    ],
  };
}

/**
 * install.ps1's parameters for install, check and status, or a refusal.
 * @param {string} command
 * @param {string[]} rest
 * @returns {Plan}
 */
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

/**
 * Windows: the subcommand mapped onto install.ps1, an answer printed here, or a refusal.
 * @param {string[]} argv
 * @returns {Plan}
 */
export function windowsPlan(argv) {
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

/**
 * PowerShell 7 where installed, else the Windows PowerShell 5.1 every Windows ships; absolute paths.
 * @param {Record<string, string | undefined>} env
 */
function powershell(env) {
  const candidates = [
    path.join(env.ProgramFiles || 'C:\\Program Files', 'PowerShell', '7', 'pwsh.exe'),
    path.join(env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
  ];
  return candidates.find((exe) => fs.existsSync(exe)) || null;
}

/**
 * @param {{ code: number, error?: Error }} r
 */
function exitWith(r) {
  if (r.error) {
    console.error('mhw: ' + r.error.message);
    return 2;
  }
  return r.code;
}

/**
 * The NODE line, on stdout, before status runs (D11). It never changes the exit code.
 * @param {string} nodeVersion
 */
function printNodeLine(nodeVersion) {
  fs.writeSync(1, nodeLine(nodeVersion, enginesNode(ROOT)).line + '\n');
}

/**
 * The commands moved to Node: answered here on every OS, never forwarded.
 * @type {Record<string, (argv: string[], env: Record<string, string | undefined>) => number>}
 */
const MOVED = {
  milestone: milestoneMain, // #475, S04
  worklog: worklogMain, // #476, S05
  'launch-line': launchLineMain, // #476, S05
  'rite-cadence': riteCadenceMain, // #477, S06
  'funnel-review': funnelReviewMain, // #478, S07
  profile: profileMain, // #479, S08
  // #480, S09: the install step install.sh spawns, and the status line workstation.py reads.
  'chrome-debugging': chromeDebuggingMain,
  // #483, S12: `mhw mcp launch`, the MCP launcher the renderer installs a copy of; #484, S13: `mhw mcp render`.
  mcp: mcpMain,
  scan: scanMain, // #486, S15: the outbound scan, on the cleaning core (src/lib/clean.js)
  // #487, S16: the paste wrapper the shell functions run. A relayed session resolves later and exits
  // by itself (process.exit); the 0 returned here is replaced then.
  'paste-wrapper': (argv, env) => {
    const r = pasteWrapperMain(argv, env);
    return typeof r === 'number' ? r : 0;
  },
  // #523: the documentation baseline's pull-request check, and the onboarding entry point.
  'docs-baseline': docsBaselineMain,
  onboard: onboardMain,
};

/**
 * `mhw mcp launch ...` (#483) and `mhw mcp render ...` (#484); anything else is a usage error.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
function mcpMain(argv, env) {
  if (argv[0] === 'launch') return mcpLaunchMain(argv.slice(1), env);
  // A child process, not an import: the renderer loads the vendored TOML parser, which must stay off the
  // import graph of `mhw hook prompt` (convention 5 of #470, test/deps-graph.test.js).
  if (argv[0] === 'render') {
    return exitWith(runAbsolute(process.execPath, [path.join(ROOT, 'src', 'render', 'mcp.js'), ...argv.slice(1)], { stdio: 'inherit', env }));
  }
  console.error('usage: mhw mcp launch [--keychain PATH] [--secret NAME=SOURCE]... -- command [args...]\n'
    + '       mhw mcp render [--dry-run | --check | --scan | --policy ... | --active ...] (mhw mcp render --help)');
  return 2;
}

/**
 * @param {string[]} argv
 * @param {string} platform
 * @param {Record<string, string | undefined>} env
 * @param {{ stdio?: import('node:child_process').StdioOptions, nodeVersion?: string }} [opts]
 * @returns {number}
 */
export function main(argv, platform, env, opts = {}) {
  const stdio = opts.stdio || 'inherit';
  // The first moved command (#474, S03): mhw delivery runs here on every platform, never forwarded.
  if (argv[0] === 'delivery') {
    const r = delivery(argv.slice(1), { cwd: process.cwd(), env, platform: process.platform });
    if (r.stdout) fs.writeSync(1, r.stdout);
    if (r.stderr) fs.writeSync(2, r.stderr);
    return r.code;
  }
  // own keys only, so `mhw constructor` is forwarded like any unknown word
  if (argv.length && Object.hasOwn(MOVED, argv[0])) return MOVED[argv[0]](argv.slice(1), env);
  if (argv[0] === 'status') {
    printNodeLine(opts.nodeVersion || process.version);
    // #487: whether the paste wrapper's pty library loads here; a FAIL names the reason. Never the exit code.
    fs.writeSync(1, pasteStatusLine(env, platform) + '\n');
    // #493 (S22): the status view itself is Node on macOS and Linux; Windows keeps install.ps1 -Check.
    if (platform !== 'win32') return statusMain(argv.slice(1), env);
  }
  if (platform !== 'win32') {
    // MHW_NODE: the node running this file, so `mhw update` finds npm beside it by absolute path.
    const childEnv = Object.assign({}, env, { MHW_NODE: process.execPath });
    return exitWith(runAbsolute('/bin/sh', [path.join(ROOT, 'mhw'), ...argv], { stdio, env: childEnv }));
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
  const args = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps1, ...(plan.ps || [])];
  return exitWith(runAbsolute(exe, args, { stdio }));
}
