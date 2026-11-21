// The lifecycle commands of mhw on macOS and Linux, read from argv the way global/workstation.py read them
// (#495, S24 of #470): mhw install, update, uninstall and postinstall, the usage text, and the answer to an
// unknown subcommand. src/cli.js sends here every POSIX command that no other module answers.
//
// Every argument is read before any command runs, in workstation.py's order: a word the command does not
// take is refused (exit 2), then --overlay is validated (exit 2 unless 'none' or an existing directory),
// then the command runs. The validated overlay reaches the installers through WORKSTATION_OVERLAY, never
// their argv; MHW_CMD (the command an instruction names: mhw in an npm install, ./mhw in a checkout) and
// MHW_NODE (the node running this file) go with it. node: modules only.
import { STDIO } from '../lib/lifecycle.js';
import { install } from './install.js';
import { update } from './update.js';
import { uninstall } from './uninstall.js';
import { postinstall, ROOT } from './postinstall.js';
import { wordsOf, validOverlay, OVERLAY_ENV } from './status.js';
import { USAGE, DOC } from './usage.js';

/** @typedef {import('../lib/readers/common.js').Env} Env */
/** @typedef {import('../lib/lifecycle.js').Io} Io */

const UX = new Set(['install', 'update', 'uninstall']);

/**
 * @typedef {{ command: string, overlay: string | null, verbose: boolean, admin: boolean, wanted: string | undefined,
 *   method: boolean, yes: boolean, noAdmin: boolean }} Parsed
 */

/**
 * The arguments after the command, or the refusal of the first one it does not take.
 * @param {string} command @param {string[]} rest
 * @returns {Parsed | { err: string }}
 */
export function parse(command, rest) {
  /** @type {Parsed} */
  const p = { command, overlay: null, verbose: false, admin: false, wanted: undefined, method: false, yes: false, noAdmin: false };
  for (const arg of rest) {
    if (arg.startsWith('--overlay=')) p.overlay = arg.slice('--overlay='.length);
    else if ((arg === '-v' || arg === '--verbose') && UX.has(command)) p.verbose = true;
    else if (arg === '--admin' && command === 'install') p.admin = true;
    else if ((arg === '-y' || arg === '--yes') && UX.has(command)) p.yes = true;
    else if (arg === '--no-admin' && command === 'install') p.noAdmin = true;
    else if (arg === '--method' && (command === 'install' || command === 'postinstall')) p.method = true;
    else if (command === 'update' && p.wanted === undefined && !arg.startsWith('-')) p.wanted = arg;
    else return { err: 'mhw: unknown argument for ' + command + ': ' + arg };
  }
  return p;
}

/**
 * @param {string[]} argv the whole argument list (the command first)
 * @param {Env} env
 * @param {{ io?: Io, cwd?: string }} [o]
 * @returns {number}
 */
export function main(argv, env, o = {}) {
  const io = o.io || STDIO;
  const cwd = o.cwd || process.cwd();
  if (!argv.length || ['-h', '--help', 'help'].includes(argv[0])) {
    io.out((argv.length ? USAGE : DOC) + '\n');
    return argv.length ? 0 : 2;
  }
  const p = parse(argv[0], argv.slice(1));
  if ('err' in p) {
    io.err(p.err + '\n');
    return 2;
  }
  // The installers' messages name the same command this process was reached by (Issue #68).
  /** @type {Env} */
  const child = { ...env, MHW_CMD: wordsOf(ROOT).cmd, MHW_NODE: process.execPath };
  if (p.overlay !== null) {
    const valid = validOverlay(p.overlay, env, cwd);
    if (valid === null) {
      io.err("mhw: --overlay takes 'none' or an existing directory\n");
      return 2;
    }
    child[OVERLAY_ENV] = valid;
  }
  if (p.command === 'install') {
    if (p.admin && p.noAdmin) {
      io.err('mhw: --admin and --no-admin exclude each other\n');
      return 2;
    }
    return install({ adminOnly: p.admin, method: p.method, verbose: p.verbose, yes: p.yes, noAdmin: p.noAdmin }, child, io);
  }
  if (p.command === 'postinstall') return postinstall(io);
  if (p.command === 'update') return update(p.wanted, { verbose: p.verbose, yes: p.yes }, child, io);
  if (p.command === 'uninstall') return uninstall({ verbose: p.verbose, yes: p.yes }, child, io);
  io.err('mhw: unknown subcommand ' + p.command + ' (install, install --admin, status, check, scan, policy check, update, uninstall)\n');
  return 2;
}
