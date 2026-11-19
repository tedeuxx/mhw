// One program found on PATH, as an absolute path (#475, S04 of #470). The milestone routes run gh and
// confine runs git the way their Python originals did: the first match on PATH. This is the one place
// runtime code looks a program up on PATH; the result is then run by absolute path, never through a
// shell. Windows: only <name>.exe is accepted, because Node refuses to spawn a .cmd or .bat without a
// shell (and a shell is what this code never uses). node: modules only.
import fs from 'node:fs';
import path from 'node:path';

/**
 * Is p a regular file this process may execute (POSIX: X_OK; Windows has no execute bit)?
 * @param {string} p
 * @param {boolean} win
 */
function runnable(p, win) {
  try {
    if (!win) fs.accessSync(p, fs.constants.X_OK);
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * @param {string} name a bare program name
 * @param {Record<string, string | undefined>} env
 * @param {string} [platform]
 * @returns {string | null}
 */
export function onPath(name, env, platform = process.platform) {
  const win = platform === 'win32';
  const value = env.PATH ?? env.Path ?? '';
  for (const dir of value.split(win ? ';' : ':')) {
    // A relative PATH entry would let the current directory decide which program runs.
    if (!dir || !path.isAbsolute(dir)) continue;
    const p = path.join(dir, win ? name + '.exe' : name);
    if (runnable(p, win)) return p;
  }
  return null;
}
