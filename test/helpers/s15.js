// Shared by the S15 tests (#486): the recorder of the Python original and the CPython it was recorded from.
// Since #488 (S17) deleted global/clipboard/clipboard_guard.py, the live arms read it from the base revision
// while the base still holds it (clipboardDir below), as the S16 live arm reads paste_wrapper.py.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { which } from './home.js';
import { extractRevision } from './parity.js';

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

/** @type {Map<string, { dir?: string, why?: string, fail?: boolean }>} */
const bases = new Map();

/**
 * The directory holding the Python original `name` (in global/clipboard): this tree's, else the base
 * revision's (MHW_PARITY_BASE, else the merge-base with origin/<GITHUB_BASE_REF or rc/next>), or why not.
 * fail: the reason should fail a run that requires the live arm (a missing base is a failure, a base that
 * no longer holds the file is not: the slice that deleted it has merged).
 * @param {string} name e.g. clipboard_guard.py
 * @param {boolean} required
 * @returns {{ dir?: string, why?: string, fail?: boolean }}
 */
export function clipboardDir(name, required) {
  if (fs.existsSync(path.join(CLIPBOARD, name))) return { dir: CLIPBOARD };
  if (process.platform === 'win32') return { why: 'POSIX only' };
  const key = name + String(required);
  const cached = bases.get(key);
  if (cached) return cached;
  const git = which('git');
  /** @type {{ dir?: string, why?: string, fail?: boolean }} */
  let r;
  const base = process.env.MHW_PARITY_BASE || (git ? (() => {
    const p = spawnSync(git, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })() : '');
  if (!git) r = { why: 'needs git on PATH', fail: required };
  else if (!base) r = { why: 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)', fail: required };
  else {
    const work = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s17-base-')));
    process.once('exit', () => fs.rmSync(work, { recursive: true, force: true }));
    const dest = path.join(work, 'tree');
    if (!extractRevision(ROOT, base, dest)) r = { why: 'base revision ' + base + ' is not readable here', fail: required };
    else if (!fs.existsSync(path.join(dest, 'global', 'clipboard', name))) r = { why: 'the base revision no longer holds ' + name + ' (the slice that deleted it has merged)' };
    else r = { dir: path.join(dest, 'global', 'clipboard') };
  }
  bases.set(key, r);
  return r;
}
