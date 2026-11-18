// TOML read and write for the Codex configuration (D2 of #470): smol-toml, a pure-JavaScript TOML 1.0
// parser and writer with no dependencies, pinned in npm-shrinkwrap.json. This module is NOT on the hook
// path (convention 5): only renderers import it, and test/deps-graph.test.js keeps it off that path.
import fs from 'node:fs';
import { parse, stringify } from 'smol-toml';
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
