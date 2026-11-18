// TOML read and write for the Codex configuration (D2 of #470): smol-toml 1.9.1, a pure-JavaScript
// TOML 1.0 parser and writer with no dependencies (BSD-3-Clause, its LICENSE beside it). It is VENDORED
// under src/vendor/smol-toml, not an npm dependency: a git install (`npm install -g github:...`) left
// every runtime dependency unmet (measured, npm 11.13.0; #472). The same version is a devDependency,
// pinned with its integrity in npm-shrinkwrap.json and covered by npm audit, and
// test/vendor.test.js requires the vendored files to be byte-identical to it.
// This module is NOT on the hook path (convention 5): test/deps-graph.test.js keeps it off that path.
import fs from 'node:fs';
import { parse, stringify } from '../vendor/smol-toml/dist/index.js';
import { writeWithBackup } from './fsx.js';

/**
 * @param {string} text
 * @param {string} [where] named in the error
 * @returns {Record<string, any>}
 */
export function parseToml(text, where = 'TOML') {
  try {
    return parse(text);
  } catch (e) {
    throw new Error(where + ': not valid TOML (' + (e instanceof Error ? e.message.split('\n')[0] : String(e)) + ')');
  }
}

/** @param {Record<string, any>} value */
export function stringifyToml(value) {
  const text = stringify(value);
  return text.endsWith('\n') ? text : text + '\n';
}

/**
 * A missing file reads as `fallback`; a malformed one throws with the path.
 * @param {string} file
 * @param {Record<string, any> | null} [fallback]
 */
export function readToml(file, fallback = null) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && /** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return fallback;
    throw e;
  }
  return parseToml(text, file);
}

/**
 * @param {string} file
 * @param {Record<string, any>} value
 * @param {{ mode?: number, backup?: boolean }} [opts]
 */
export function writeToml(file, value, opts = {}) {
  return writeWithBackup(file, stringifyToml(value), opts);
}
