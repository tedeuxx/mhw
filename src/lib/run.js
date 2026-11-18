// Run a process by absolute path, never looked up on PATH and never through a shell. node: modules only.
import path from 'node:path';
import { spawnSync } from 'node:child_process';

/**
 * @typedef {{ code: number, stdout: string, stderr: string, error?: Error, signal?: string | null }} RunResult
 */

/**
 * Run exe (an absolute path) with args. The exit code is the child's, 1 when it died on a signal, and
 * 2 with `error` set when it could not be started; a relative or bare exe is refused before anything
 * runs, so a PATH entry can never decide which program executes.
 * @param {string} exe
 * @param {string[]} args
 * @param {{ stdio?: import('node:child_process').StdioOptions, env?: Record<string, string | undefined>,
 *   cwd?: string, input?: string, timeout?: number }} [opts]
 * @returns {RunResult}
 */
export function runAbsolute(exe, args, opts = {}) {
  if (typeof exe !== 'string' || !path.isAbsolute(exe)) {
    return { code: 2, stdout: '', stderr: '', error: new Error('refused to run ' + JSON.stringify(exe) + ': not an absolute path') };
  }
  const p = spawnSync(exe, args, {
    stdio: opts.stdio || 'pipe',
    env: opts.env,
    cwd: opts.cwd,
    input: opts.input,
    timeout: opts.timeout,
    encoding: 'utf8',
    shell: false,
    windowsHide: true,
  });
  const stdout = typeof p.stdout === 'string' ? p.stdout : '';
  const stderr = typeof p.stderr === 'string' ? p.stderr : '';
  if (p.error) return { code: 2, stdout, stderr, error: p.error, signal: p.signal };
  return { code: p.status === null ? 1 : p.status, stdout, stderr, signal: p.signal };
}
