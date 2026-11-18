// JSON configuration read and write. A missing file reads as `fallback`; a malformed one throws with
// the path, never returns something partial. Writes are two-space indented with a trailing newline,
// atomic, and back up the previous file beside it. node: modules only.
import fs from 'node:fs';
import { writeWithBackup } from './fsx.js';

/**
 * @param {string} file
 * @param {unknown} [fallback] returned when the file does not exist (default null)
 * @returns {any}
 */
export function readJson(file, fallback = null) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e && /** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') return fallback;
    throw e;
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(file + ': not valid JSON (' + (e instanceof Error ? e.message : String(e)) + ')');
  }
}

/** @param {unknown} value */
export function stringifyJson(value) {
  return JSON.stringify(value, null, 2) + '\n';
}

/**
 * @param {string} file
 * @param {unknown} value
 * @param {{ mode?: number, backup?: boolean }} [opts]
 */
export function writeJson(file, value, opts = {}) {
  return writeWithBackup(file, stringifyJson(value), opts);
}
