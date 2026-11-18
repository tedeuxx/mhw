// Golden files (convention 3 of #470): the original implementation's normalised transcripts, committed
// under test/golden/<slice>/, so parity survives the original's deletion as a regression test.
// MHW_UPDATE_GOLDEN=1 writes them instead of reading them; the parity test refuses to do that against
// anything but the recorded base revision.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const GOLDEN = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'golden');

/**
 * @param {string} slice e.g. 'S01'
 * @param {string} name a file under the slice's directory
 */
export function goldenPath(slice, name) {
  return path.join(GOLDEN, slice, name);
}

/**
 * @param {string} slice
 * @param {string} name
 * @returns {any}
 */
export function readGolden(slice, name) {
  return JSON.parse(fs.readFileSync(goldenPath(slice, name), 'utf8'));
}

/**
 * @param {string} slice
 * @param {string} name
 * @param {unknown} value
 */
export function writeGolden(slice, name, value) {
  const file = goldenPath(slice, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + '\n');
}

export const UPDATE = process.env.MHW_UPDATE_GOLDEN === '1';
