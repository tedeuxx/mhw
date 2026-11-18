// One program found on PATH, as an absolute path (#475, S04 of #470). The milestone routes run gh and
// confine runs git the way their Python originals did: the first match on PATH. This is the one place
// runtime code looks a program up on PATH; the result is then run by absolute path, never through a
// shell. Windows: only <name>.exe is accepted, because Node refuses to spawn a .cmd or .bat without a
// shell (and a shell is what this code never uses). node: modules only.
import fs from 'node:fs';
import path from 'node:path';

/**
 * @param {string} name a bare program name
 * @param {Record<string, string | undefined>} env
 * @param {string} [platform]
 * @returns {string | null}
 */
export function onPath(name, env, platform = process.platform) {
  const exts = platform === 'win32' ? ['.exe'] : [''];
  const value = env.PATH ?? env.Path ?? '';
  for (const dir of value.split(platform === 'win32' ? ';' : ':')) {
    // A relative PATH entry would let the current directory decide which program runs.
    if (!dir || !path.isAbsolute(dir)) continue;
    for (const ext of exts) {
      const p = path.join(dir, name + ext);
      try {
        if (platform !== 'win32') fs.accessSync(p, fs.constants.X_OK);
        if (fs.statSync(p).isFile()) return p;
      } catch {
        // not here
      }
    }
  }
  return null;
}
