// Versions mhw reads: its own release (.bumpversion.toml) and the Node floor (package.json engines.node,
// D11 of #470). node: modules only, because the CLI entry imports it (convention 5 of #470).
import fs from 'node:fs';
import path from 'node:path';

const TRIPLE = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?$/;

/**
 * '26', 'v26.13.1' or '26.13' -> [26, 13, 1] (missing parts are 0), or null.
 * @param {string} text
 * @returns {[number, number, number] | null}
 */
export function parseVersion(text) {
  const m = TRIPLE.exec(String(text).trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2] || 0), Number(m[3] || 0)];
}

/**
 * The floor of an engines range. Only the one form mhw declares is read, '>=X[.Y[.Z]]'; anything else
 * is null, so a range this code cannot read is reported as unreadable rather than as met.
 * @param {string | undefined} range
 */
export function floorOf(range) {
  const m = /^>=\s*(\S+)$/.exec(String(range || '').trim());
  return m ? parseVersion(m[1]) : null;
}

/**
 * @param {[number, number, number]} a
 * @param {[number, number, number]} b
 */
function compare(a, b) {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1;
  return 0;
}

/**
 * The engines.node range of the package at root, or undefined.
 * @param {string} root
 * @returns {string | undefined}
 */
export function enginesNode(root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  return pkg.engines && pkg.engines.node;
}

/**
 * The NODE line `mhw status` prints (D11): the running node against engines.node. A report, like the
 * rest of status: it never changes the exit code.
 * @param {string} running process.version, e.g. 'v26.13.1'
 * @param {string | undefined} range engines.node, e.g. '>=26'
 * @returns {{ ok: boolean, line: string }}
 */
export function nodeLine(running, range) {
  const have = parseVersion(running);
  const floor = floorOf(range);
  if (!have || !floor) {
    return { ok: false, line: 'NODE    FAIL  cannot compare node ' + running + ' with engines.node ' + JSON.stringify(range) };
  }
  if (compare(have, floor) < 0) {
    return {
      ok: false,
      line: 'NODE    FAIL  node ' + running + ' is older than engines.node ' + range +
        '; install the Node ' + floor[0] + ' LTS line or later',
    };
  }
  return { ok: true, line: 'NODE    ok    node ' + running + ' meets engines.node ' + range };
}

/**
 * mhw's own release from .bumpversion.toml, as ['10', '1', '0'], or null.
 * @param {string} root
 * @returns {[string, string, string] | null}
 */
export function releaseOf(root) {
  const text = fs.readFileSync(path.join(root, '.bumpversion.toml'), 'utf8');
  const m = /^current_version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m.exec(text);
  return m ? [m[1], m[2], m[3]] : null;
}
