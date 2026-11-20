// Shared by the S15 tests (#486): the recorder of the Python original and the CPython it was recorded from.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { which } from './home.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CPYTHON = '3.14.6';
export const RECORDER = path.join(ROOT, 'test', 'helpers', 's15-record.py');
export const CLIPBOARD = path.join(ROOT, 'global', 'clipboard');

/** The python3 on PATH at the recorded version, or why there is none. @returns {{ py?: string, why?: string }} */
export function recordedPython() {
  const py = which('python3');
  if (!py) return { why: 'needs python3 on PATH' };
  const v = spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim();
  if (v !== CPYTHON) return { why: 'the goldens were recorded from CPython ' + CPYTHON + ', python3 here is ' + v };
  return { py };
}
