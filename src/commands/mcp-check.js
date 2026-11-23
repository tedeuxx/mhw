// mhw mcp check (#595, slice 9 of the CLI native baseline PRD, section 4): the MCP connection test, which
// was `mhw status --mcp-connect[=SECONDS]` until v11. `mhw status` starts no process any more; this command
// does, on purpose.
//
//   mhw mcp check [--timeout=SECONDS]   start each MCP active-set server as each agent harness has it
//                                       configured and say whether it answers an MCP initialize
//                                       (SECONDS 1 to 9999, default 30, per server)
//
// The check itself is src/commands/mcp-connect.js, run as `mhw mcp render --active --mode=connect` in a child
// process (the renderer loads the vendored TOML parser, which stays off the import graph of `mhw hook prompt`,
// convention 5 of #470). This file shows its lines under one heading, as status did. Exit 0 when every set
// member answers, 1 when one fails (or the check could not run), 2 on a usage error.
//
// Not to be confused with `mhw mcp render --check`, which compares the rendered MCP configuration with what is
// installed (drift) and starts nothing. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { splitlines } from '../lib/readers/common.js';
import { runAbsolute } from '../lib/run.js';
import { isPyWs } from '../lib/py.js';
import { MCP_INDENT } from './status.js';

/** @typedef {Record<string, string | undefined>} Env */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DEFAULT_TIMEOUT = 30;
export const USAGE = 'usage: mhw mcp check [--timeout=SECONDS]   start each MCP active-set server and say whether it answers (SECONDS 1 to 9999, default 30)';

/**
 * The connection check's own lines, under one heading; its tag and its word are dropped. Untagged lines
 * (a refusal) are not shown: the exit code is, with where to read the reason.
 * @param {string[]} lines
 * @param {number} code
 */
export function mcpConnectLines(lines, code = 0) {
  /** @type {string[]} */
  let out = [];
  for (const line of lines) {
    if (line.endsWith(' (MCP connect)')) {
      const t = line.slice(0, -' (MCP connect)'.length);
      out.push(splitFirstWord(t));
    }
  }
  if (!out.length) out = ['no result (exit ' + code + '); run mhw mcp render --active --mode=connect for the reason'];
  return ['  mcp connect      ' + out[0], ...out.slice(1).map((x) => MCP_INDENT + x)];
}

/**
 * str.split(None, 1)[-1]: what follows the first word and the whitespace after it, or the word itself
 * when it is the only one ('' where Python raised IndexError on a line of whitespace only).
 * @param {string} t
 */
function splitFirstWord(t) {
  const cps = Array.from(t);
  let i = 0;
  while (i < cps.length && isPyWs(cps[i])) i++;
  const start = i;
  while (i < cps.length && !isPyWs(cps[i])) i++;
  const word = cps.slice(start, i).join('');
  while (i < cps.length && isPyWs(cps[i])) i++;
  return i < cps.length ? cps.slice(i).join('') : word;
}

/**
 * Run the connection check and print its lines. @param {number} timeout @param {Env} env
 * @param {(line: string) => void} out @returns {number}
 */
export function connectCheck(timeout, env, out) {
  const r = runAbsolute(process.execPath, [path.join(ROOT, 'src', 'render', 'mcp.js'), '--active', '--mode=connect', '--timeout=' + timeout],
    { env: { ...env, MHW_NODE: process.execPath }, stdio: ['inherit', 'pipe', 'pipe'] });
  for (const line of mcpConnectLines(splitlines(r.stdout + r.stderr), r.code)) out(line);
  return r.code ? 1 : 0;
}

/**
 * @param {string[]} argv the arguments after `mcp check`
 * @param {Env} env
 * @param {{ out?: (line: string) => void, err?: (line: string) => void }} [o]
 * @returns {number}
 */
export function main(argv, env, o = {}) {
  const out = o.out || ((/** @type {string} */ l) => fs.writeSync(1, l + '\n'));
  const err = o.err || ((/** @type {string} */ l) => fs.writeSync(2, l + '\n'));
  let timeout = DEFAULT_TIMEOUT;
  for (const arg of argv) {
    if (/^--timeout=[1-9][0-9]{0,3}$/.test(arg)) timeout = Number(arg.slice('--timeout='.length));
    else if (arg === '-h' || arg === '--help') {
      out(USAGE);
      return 0;
    } else {
      err('mhw: unknown argument for mcp check: ' + arg);
      err(USAGE);
      return 2;
    }
  }
  return connectCheck(timeout, env, out);
}
