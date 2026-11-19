// The forge and version-control tools the delivery route runs: gh and git (#474, S03 of #470).
// node: modules only.
//
// These two are TOOLS the owner installs, not interpreters this package ships, so they are found on PATH,
// as workspace/delivery.py found them. What is kept from run.js's rule is the form: the PATH entry is
// resolved here to one absolute file, and that file is run directly, never through a shell. A relative
// PATH entry is skipped, so the current directory can never supply the program. On Windows only a .exe
// or .com qualifies: a .cmd or .bat cannot be run without a shell, so it is not looked for.
import fs from 'node:fs';
import path from 'node:path';
import { runAbsolute } from './run.js';

/**
 * @typedef {{ code: number, stdout: string, stderr: string, error?: Error }} ToolResult
 * @typedef {(tool: string, args: string[]) => ToolResult} ToolRunner
 */

/**
 * The first file called name on PATH, as an absolute path, or null.
 * @param {string} name
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 */
export function resolveTool(name, env, platform) {
  const win = platform === 'win32';
  const delimiter = win ? ';' : ':';
  const isAbs = win ? path.win32.isAbsolute : path.posix.isAbsolute;
  const join = win ? path.win32.join : path.posix.join;
  const exts = win ? ['.exe', '.com'] : [''];
  const value = win ? env.PATH ?? env.Path ?? '' : env.PATH ?? '';
  for (const dir of value.split(delimiter)) {
    if (!dir || !isAbs(dir)) continue;
    for (const ext of exts) {
      const p = join(dir, name + ext);
      try {
        if (!fs.statSync(p).isFile()) continue;
        if (!win) fs.accessSync(p, fs.constants.X_OK);
        return p;
      } catch {
        // not here
      }
    }
  }
  return null;
}

/**
 * A runner for gh and git in cwd. A tool missing from PATH, or one that cannot start or exceeds the
 * timeout (60 s, as delivery.py had), comes back with `error` set; the caller decides what that means.
 * @param {string} cwd
 * @param {Record<string, string | undefined>} env
 * @param {string} platform
 * @returns {ToolRunner}
 */
export function toolRunner(cwd, env, platform) {
  /** @type {Map<string, string | null>} */
  const found = new Map();
  return (tool, args) => {
    if (!found.has(tool)) found.set(tool, resolveTool(tool, env, platform));
    const exe = found.get(tool);
    if (!exe) return { code: 2, stdout: '', stderr: '', error: new Error(tool + ' was not found on PATH') };
    return runAbsolute(exe, args, { cwd, env, timeout: 60000 });
  };
}
