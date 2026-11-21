// The owner-action queue (ADR-0035, decision 9), moved from global/owner_actions.py (#493, S22 of #470):
// how many OPEN issues in the mhw repository carry the `owner-action` label, for `mhw status` and
// `mhw status --summary`.
//
// Read-only: `gh issue list`, and `gh label list` only when the count is zero. Each call is bounded by a
// timeout. When the count cannot be read (gh missing, not authenticated, offline, timed out, output not
// understood, or the label itself absent) the answer is "not read (<reason>)", never a 0: a false 0 would
// tell the owner his queue is empty when nobody looked. gh's own error text is classified, never printed.
// gh is the first on PATH, run by absolute path, never through a shell. node: modules only.
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { onPath } from '../onpath.js';
import { loads, isDict } from '../py.js';

export const REPO = 'tedeuxx/mhw';
export const LABEL = 'owner-action';
export const TIMEOUT = 5; // seconds, per gh call
export const LIMIT = 1000; // gh issue list pages at 30 by default; a count at the limit is shown as "or more"
export const AUTH_EXIT = 4; // gh's documented exit code for "authentication required" (measured with gh 2.93.0)

/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {[number | null, string]} Result [count, reason] */

class Timeout extends Error {}
class CouldNotRun extends Error {}

/**
 * One gh call: [exit code, stdout, stderr]. A child killed by a signal reads as minus its number, as
 * Python's returncode did. Throws Timeout or CouldNotRun.
 * @param {string} gh
 * @param {string[]} args
 * @param {number} timeout seconds
 * @param {Env} env
 * @returns {[number, string, string]}
 */
function call(gh, args, timeout, env) {
  const p = spawnSync(gh, args, {
    env: { ...env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: timeout * 1000,
    maxBuffer: 256 * 1024 * 1024,
    shell: false,
    windowsHide: true,
  });
  const err = /** @type {NodeJS.ErrnoException | undefined} */ (p.error);
  if (err?.code === 'ETIMEDOUT') throw new Timeout();
  if (err) throw new CouldNotRun();
  // Bytes that are not UTF-8 become U+FFFD, as errors="replace" made them.
  const stdout = (p.stdout || Buffer.alloc(0)).toString('utf8');
  const stderr = (p.stderr || Buffer.alloc(0)).toString('utf8');
  const sig = p.signal ? os.constants.signals[p.signal] : undefined;
  return [p.status === null ? -(sig || 1) : p.status, stdout, stderr];
}

/** @param {number} code @param {string} err */
function failure(code, err) {
  const low = err.toLowerCase();
  if (code === AUTH_EXIT || low.includes('http 401') || low.includes('bad credentials')) return 'gh not authenticated';
  if (low.includes('error connecting') || low.includes('could not resolve') || low.includes('no such host')) return 'offline, GitHub unreachable';
  return 'gh exited ' + code;
}

/** The list of JSON objects gh printed, or null when it is not that. @param {string} out */
function names(out) {
  let data;
  try {
    data = loads(out);
  } catch {
    return null;
  }
  if (!Array.isArray(data) || !data.every((x) => isDict(x))) return null;
  return /** @type {Array<Record<string, unknown>>} */ (data);
}

/**
 * [count, reason]. count is a number when read, else null and reason says why. Never throws: `mhw status`
 * must exit 0 whatever gh does. Anything not classified (for example output nested deep enough to
 * exhaust the parser) reads as "gh output not understood"; the error text is never shown.
 * @param {{ gh?: string | null, timeout?: number, env?: Env }} [o]
 * @returns {Result}
 */
export function read(o = {}) {
  try {
    return readOrThrow(o);
  } catch {
    return [null, 'gh output not understood'];
  }
}

/** @param {{ gh?: string | null, timeout?: number, env?: Env }} o @returns {Result} */
function readOrThrow(o) {
  const env = o.env || process.env;
  const timeout = o.timeout ?? TIMEOUT;
  const gh = o.gh || onPath('gh', env);
  if (!gh) return [null, 'gh not found'];
  let code;
  let out;
  let err;
  try {
    [code, out, err] = call(gh, ['issue', 'list', '--repo', REPO, '--label', LABEL, '--state', 'open',
      '--limit', String(LIMIT), '--json', 'number'], timeout, env);
    if (code !== 0) return [null, failure(code, err)];
    const issues = names(out);
    if (issues === null) return [null, 'gh output not understood'];
    if (issues.length) return [issues.length, ''];
    // An absent label also lists nothing, with exit 0 (measured): confirm it exists before saying 0.
    [code, out, err] = call(gh, ['label', 'list', '--repo', REPO, '--limit', String(LIMIT), '--json', 'name'], timeout, env);
  } catch (e) {
    if (e instanceof Timeout) return [null, 'gh timed out after ' + String(timeout) + 's'];
    if (e instanceof CouldNotRun) return [null, 'gh could not run'];
    throw e;
  }
  if (code !== 0) return [null, failure(code, err)];
  const labels = names(out);
  if (labels === null) return [null, 'gh output not understood'];
  if (!labels.some((x) => x.name === LABEL)) return [null, 'label ' + LABEL + ' absent in ' + REPO];
  return [0, ''];
}

/**
 * The short form both views print: '3 open', '0 open' or 'not read (<reason>)'.
 * @param {Result} result
 */
export function text(result) {
  const [count, reason] = result;
  if (count === null) return 'not read (' + (reason || 'unknown') + ')';
  return count >= LIMIT ? LIMIT + ' or more open' : count + ' open';
}
