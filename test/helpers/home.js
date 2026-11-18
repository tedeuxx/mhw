// Throwaway HOMEs for tests: a fresh directory under the OS temporary directory (TMPDIR, which CI points
// at RUNNER_TEMP), never a real HOME. The environment it returns names only that directory.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/**
 * @typedef {{ dir: string, home: string, root: string, env: Record<string, string>, cleanup: () => void }} Home
 */

/**
 * @param {string} [label]
 * @param {Record<string, string>} [extra] added to the environment
 * @returns {Home}
 */
export function throwawayHome(label = 'home', extra = {}) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-test-' + label + '-')));
  const home = path.join(dir, 'home');
  const root = path.join(dir, 'root');
  const tmp = path.join(dir, 'tmp');
  for (const d of [home, root, tmp]) fs.mkdirSync(d);
  /** @type {Record<string, string>} */
  const env = {
    PATH: process.env.PATH || '',
    HOME: home,
    USERPROFILE: home,
    CODEX_HOME: path.join(home, '.codex'),
    TMPDIR: tmp,
    WORKSTATION_MANAGED_ROOT: root,
    LANG: 'C.UTF-8',
    ...extra,
  };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return { dir, home, root, env, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/**
 * The first executable called name on PATH, as an absolute path, or null. Tests only: runtime code
 * never looks a program up on PATH.
 * @param {string} name
 */
export function which(name) {
  const exts = process.platform === 'win32' ? ['.exe', '.cmd', ''] : [''];
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        fs.accessSync(p, fs.constants.X_OK);
        if (fs.statSync(p).isFile()) return p;
      } catch {
        // not here
      }
    }
  }
  return null;
}
