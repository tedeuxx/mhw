// The term lists' salt, read without a prompt (#486; shared with the paste wrapper since #487). A file
// store is read here. The macOS Keychain is read the way the prompt hook reads it, by clipboard_guard.py's
// own SaltStore(interactive=False): a non-interactive lock probe through Security.framework, then a
// bounded `security` read. Node has no such probe, so until the hook moves to Node this one step runs
// clipboard_guard.py: an absolute python3, isolated (-I) and from clipboard_guard.py's own directory, so
// nothing in the current directory or on PYTHONPATH is imported. The salt reaches this process on a
// pipe, never in an argument or a file. node: modules only.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as core from './clean.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const CLIPBOARD_DIR = path.join(ROOT, 'global', 'clipboard');
const KEYCHAIN_READ = 'import sys\nsys.path.insert(0, sys.argv[1])\nimport clipboard_guard as g\n'
  + 'conf = dict(g.DEFAULTS, salt_store="keychain", keychain_service=sys.argv[2], keychain_path=sys.argv[3])\n'
  + 'v = g.SaltStore(conf, interactive=False).get()\nsys.stdout.write(v or "")\n';

/**
 * The salt for the term lists, or null, read without a prompt; noPython when the Keychain read had no
 * python3 to run it.
 * @param {{ platform: string, python: string | null, env: Record<string, string | undefined> }} ctx
 *   python: an absolute path, or null
 * @param {Record<string, string>} conf
 * @returns {{ salt: string | null, noPython?: boolean }}
 */
export function readSalt(ctx, conf) {
  if (conf.salt_store !== 'keychain') return { salt: core.fileSalt(conf.salt_file) };
  // Off macOS there is no Security.framework, and clipboard_guard.py's probe answers "unknown" there.
  if (ctx.platform !== 'darwin') return { salt: null };
  if (!ctx.python) return { salt: null, noPython: true };
  // -I (isolated: no current directory, no PYTHONPATH, no user site on sys.path, no PYTHON* variable):
  // the child imports hashlib, hmac, json, re, secrets, subprocess and unicodedata, and without it a
  // module of one of those names in the current directory, or on PYTHONPATH, would run. The child also
  // runs in clipboard_guard.py's own directory.
  const p = spawnSync(ctx.python, ['-I', '-B', '-c', KEYCHAIN_READ, CLIPBOARD_DIR, conf.keychain_service, conf.keychain_path || ''],
    { cwd: CLIPBOARD_DIR, env: ctx.env, stdio: ['ignore', 'pipe', 'ignore'], timeout: 15000, shell: false, windowsHide: true, encoding: 'utf8' });
  const value = p.status === 0 && typeof p.stdout === 'string' ? p.stdout : '';
  return { salt: /^[0-9a-f]{64}$/.test(value) ? value : null };
}
