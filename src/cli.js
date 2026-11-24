// The mhw command line (#470). S01 (#472) was the strangler's first step; since S24 (#495) every command
// on macOS and Linux is answered in Node, and the package's ./mhw is a Node file that runs bin/mhw.js.
// `mhw status` prints a NODE line first (D11), naming the running node against engines.node.
//   macOS and Linux: install, update, uninstall, postinstall and the usage text are
//                    src/commands/lifecycle.js (#495), moved from global/workstation.py.
//   Windows:         install, install --method, check and status (= check) run `mhw install-windows`
//                    (src/commands/install-windows.js, #497, S27; it was global\install.ps1); update is
//                    answered here; install --admin and uninstall do not exist there.
// Moved commands (the strangler's later steps) are answered here on every OS: `mhw rite-cadence` (#477),
// `mhw profile` (#479), `mhw chrome-debugging` (#480), `mhw mcp launch` (#483)
// `mhw status` (#493, after its NODE line; macOS and Linux; the PASTE line left with the paste wrapper, #590), `mhw check`
// (#494; macOS and Linux; on Windows both run `mhw install-windows --check`, #497); new in Node:
// `mhw install-user` (#503, S25; macOS and Linux), the user-layer installer install, update, uninstall,
// check and status run (it was global/install.sh), `mhw install-admin` (#496, S26; macOS and Linux), the
// admin-layer installer mhw install, update, uninstall, check and status run (it was global/install-managed.sh),
// and `mhw install-windows` (#497, S27), the user layer on Windows (it was global/install.ps1).
// Every path is resolved from this file's own location, never from the current directory. Interpreters
// this file runs go by absolute path, never looked up on PATH. A moved command may look a program up on
// PATH through src/lib/onpath.js (absolute entries only) and then run it by that absolute path. node: modules
// only (convention 5 of #470; test/deps-graph.test.js holds that).
// `mhw scan` and `mhw hook` left the CLI at #600 (CLI native baseline PRD, section 5): the outbound check is
// the fixed-pattern check's hook (src/hooks/pattern-check.js, #588), and CI runs the scan's engine from
// .github/scripts/outbound-scan.js. Both words are unknown subcommands like any other. `mhw worklog` (#476)
// left at #594 (section 5 too): the worklog method skill records the event from each agent harness's own
// usage data, and the contract stays method/scripts/worklog-contract/event.schema.json.
// `mhw add-term` left the CLI at #589 (the same section): third-party terms are judged by the model, with no
// term list and no salt, so `add-term` is an unknown subcommand too.
// `mhw launch-line` (#476), `mhw funnel-review` (#478) and `mhw onboard` (#523) left at #599 (the same
// section): /handoff writes the launch command itself or uses the harness's native resume, the
// funnel-review skill writes the report with each figure citing its source, and onboarding is the
// method skill `onboard`. All three are unknown subcommands.
// `mhw milestone` (#475) left at #593 (the same section, ADR-0048): the method skills call `gh api` under
// the baseline's gh api rule set, so `milestone` is an unknown subcommand as well.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { enginesNode, nodeLine } from './lib/version.js';
import { runAbsolute } from './lib/run.js';
import { main as riteCadenceMain } from './commands/rite-cadence.js';
import { main as profileMain } from './commands/profile.js';
import { main as chromeDebuggingMain } from './render/chrome-debugging.js';
import { main as installUserMain } from './commands/install-user.js';
import { main as installWindowsMain } from './commands/install-windows.js';
import { main as mcpLaunchMain } from './commands/mcp-launch.js';
import { main as mcpCheckMain } from './commands/mcp-check.js';
import { main as statusMain } from './commands/status.js';
import { main as checkMain } from './commands/check.js';
import { main as lifecycleMain } from './commands/lifecycle.js';
import { updateLines } from './commands/update.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const USAGE = [
  'mhw install [--method] [--overlay=DIR|none] | check | status | update [vX.Y.Z]',
  '(Windows: install --admin and uninstall are macOS and Linux only)',
];

/**
 * @typedef {{ code: number, out?: string[], err?: string, argv?: string[] }} Plan
 */

export { updateLines };

/**
 * `mhw install-windows`'s arguments for install, check and status, or a refusal (install.ps1's -Check,
 * -Method and -Overlay until #497).
 * @param {string} command
 * @param {string[]} rest
 * @returns {Plan}
 */
function windowsArgs(command, rest) {
  const argv = command === 'install' ? [] : ['--check'];
  for (const arg of rest) {
    if (arg === '--method' && command === 'install') {
      argv.push('--method');
    } else if (arg.startsWith('--overlay=') && arg.length > '--overlay='.length) {
      argv.push(arg);
    } else {
      const note = arg === '--admin' ? ' (macOS and Linux only)' : '';
      return { code: 2, err: 'mhw: unknown argument for ' + command + ': ' + arg + note };
    }
  }
  return { code: 0, argv };
}

/**
 * Windows: the subcommand mapped onto `mhw install-windows`, an answer printed here, or a refusal.
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
  return windowsArgs(command, rest);
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
  'rite-cadence': riteCadenceMain, // #477, S06
  profile: profileMain, // #479, S08
  // #480, S09: the install step install.sh spawns, and the status line mhw status reads.
  'chrome-debugging': chromeDebuggingMain,
  // #503, S25: the user-layer installer, moved from global/install.sh; mhw install, update, uninstall,
  // check and status run it.
  'install-user': installUserMain,
  // #497, S27: the same layer on Windows, moved from global/install.ps1; mhw install, check and status run
  // it there.
  'install-windows': installWindowsMain,
  // #496, S26: the admin-layer installer, moved from global/install-managed.sh. A child process, not an
  // import: it loads the vendored TOML parser, which must stay off the import graph of the hook path
  // (convention 5 of #470, test/deps-graph.test.js).
  'install-admin': (argv, env) => exitWith(runAbsolute(process.execPath, [path.join(ROOT, 'src', 'commands', 'install-admin.js'), ...argv], { stdio: 'inherit', env })),
  // #483, S12: `mhw mcp launch`, the MCP launcher the renderer installs a copy of; #484, S13: `mhw mcp render`;
  // #595: `mhw mcp check`, the connection test (`mhw status --mcp-connect` until v11).
  mcp: mcpMain,
  // `mhw paste-wrapper` (#487) left the CLI at #590 with the wrapper itself: a pasted credential is caught by
  // the fixed-pattern check on submit (#588), which blocks and shows a redacted copy, so the word is unknown.
  // `mhw docs-baseline check`, `mhw policy check` and `mhw delivery-gate` left the CLI at #592 (ADR-0046):
  // they are the delivery gates Action (actions/delivery-gates/). `mhw onboard` (#523) left at #599: it is
  // the method skill `onboard`. Each word is an unknown subcommand like any other.
};

// `mcp check` tests connections (it starts processes); `mcp render --check` checks drift (it starts none).
export const MCP_USAGE = 'usage: mhw mcp check [--timeout=SECONDS]   connection test: start each MCP active-set server and say\n'
  + '                                          whether it answers (default 30 seconds per server; exit 1 when one fails)\n'
  + '       mhw mcp render --check             drift check: exit 1 when an installed MCP configuration differs from the\n'
  + '                                          definition; it starts nothing (mhw mcp render --help)\n'
  + '       mhw mcp render [--dry-run | --scan | --policy ... | --active ...]\n'
  + '       mhw mcp launch [--keychain PATH] [--secret NAME=SOURCE]... -- command [args...]';

/**
 * `mhw mcp launch ...` (#483), `mhw mcp render ...` (#484) and `mhw mcp check ...` (#595); anything else is a
 * usage error.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
function mcpMain(argv, env) {
  if (argv[0] === 'launch') return mcpLaunchMain(argv.slice(1), env);
  // A child process, not an import: the renderer loads the vendored TOML parser, which must stay off the
  // import graph of the hook path (convention 5 of #470, test/deps-graph.test.js).
  if (argv[0] === 'render') {
    return exitWith(runAbsolute(process.execPath, [path.join(ROOT, 'src', 'render', 'mcp.js'), ...argv.slice(1)], { stdio: 'inherit', env }));
  }
  if (argv[0] === 'check') return mcpCheckMain(argv.slice(1), env);
  console.error(MCP_USAGE);
  return 2;
}

/**
 * @param {string[]} argv
 * @param {string} platform
 * @param {Record<string, string | undefined>} env
 * @param {{ nodeVersion?: string }} [opts]
 * @returns {number}
 */
export function main(argv, platform, env, opts = {}) {
  // `mhw delivery` (#474) left the CLI at #591 (ADR-0045): GitHub rulesets and the merge-pull-request skill
  // carry the delivery route, so the word is an unknown subcommand like any other; so did `mhw scan` and
  // `mhw hook` at #600, and `mhw worklog` at #594.
  // own keys only, so `mhw constructor` is forwarded like any unknown word
  if (argv.length && Object.hasOwn(MOVED, argv[0])) return MOVED[argv[0]](argv.slice(1), env);
  if (argv[0] === 'status') {
    printNodeLine(opts.nodeVersion || process.version);
    // #493 (S22): the status view itself is Node on macOS and Linux; on Windows it is install-windows --check (#497).
    if (platform !== 'win32') return statusMain(argv.slice(1), env);
  }
  // #494 (S23): mhw check is Node on macOS and Linux; on Windows it is install-windows --check (#497).
  if (argv[0] === 'check' && platform !== 'win32') return checkMain(argv.slice(1), env);
  // #495 (S24): install, update, uninstall, postinstall and the usage text are Node on macOS and Linux.
  if (platform !== 'win32') return lifecycleMain(argv, env);
  const plan = windowsPlan(argv);
  if (plan.err) {
    console.error(plan.err);
    return plan.code;
  }
  if (plan.out) {
    console.log(plan.out.join('\n'));
    return plan.code;
  }
  // #497 (S27): its steps run on the node running this file, as mhw install's do on macOS and Linux.
  return installWindowsMain(plan.argv || [], { ...env, MHW_NODE: process.execPath });
}
