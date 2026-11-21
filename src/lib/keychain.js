// The salt store of the term lists (#488, S17 of #470): clipboard_guard.py's SaltStore, ported to Node.
// The salt keys every term hash. macOS: the login Keychain (generic password), written through
// `security -i` on stdin so the value never appears in a process's argv. Elsewhere, or by choice: a
// user-only file (0600) in the local overlay directory, outside every repository.
//
// interactive=false is the prompt hook's mode (and mhw scan's, and the paste wrapper's): the Keychain is
// read only when the lock probe says the keychain is unlocked, and the `security` read is bounded by
// KEYCHAIN_READ_SECONDS with no stdin. A locked, unknown or slow keychain yields null, which each caller
// reports visibly; nothing here waits on an unlock dialog. add-term keeps interactive=true: the owner is at
// his own terminal.
//
// The lock probe is the one step that is not Node. Node has no foreign-function interface, and the probe
// must ask Security.framework for the keychain's STATUS with user interaction switched off for the asking
// process, which only an in-process call can do. So it runs as a short Python program (LOCK_PROBE below,
// the ctypes probe clipboard_guard.py ran in process, measured 2026-10-01): an absolute python3, isolated
// (-I: no current directory, PYTHONPATH, user site or PYTHON* variable) and writing no bytecode (-B), from
// the root directory. It imports only ctypes and sys, receives the keychain FILE path (or nothing, for the
// default keychain) as its one argument, and prints one word. It never sees the salt: the salt is read by
// Node from `/usr/bin/security`, which the Keychain item trusts (the item was created by that tool, so a
// read by any other program would ask the owner for access). Without a python3 the probe answers unknown,
// and every caller then says term matching is off. A Node-native probe is the open step (#488 report).
// node: modules only (convention 5 of #470: the prompt hook runs this file).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import * as core from './clean.js';

export const SECURITY = '/usr/bin/security';
export const KEYCHAIN_READ_SECONDS = 2;
const PROBE_SECONDS = 5;
const SALT = /^[0-9a-f]{64}$/;

/** The Security.framework status probe, verbatim from clipboard_guard.keychain_unlocked(). */
export const LOCK_PROBE = [
  'import sys',
  'def probe(path):',
  '    try:',
  '        import ctypes',
  '        sec = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/Security.framework/Security")',
  '        cf = ctypes.cdll.LoadLibrary("/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation")',
  '        sec.SecKeychainSetUserInteractionAllowed.argtypes = [ctypes.c_ubyte]',
  '        sec.SecKeychainSetUserInteractionAllowed.restype = ctypes.c_int32',
  '        sec.SecKeychainCopyDefault.argtypes = [ctypes.POINTER(ctypes.c_void_p)]',
  '        sec.SecKeychainCopyDefault.restype = ctypes.c_int32',
  '        sec.SecKeychainOpen.argtypes = [ctypes.c_char_p, ctypes.POINTER(ctypes.c_void_p)]',
  '        sec.SecKeychainOpen.restype = ctypes.c_int32',
  '        sec.SecKeychainGetStatus.argtypes = [ctypes.c_void_p, ctypes.POINTER(ctypes.c_uint32)]',
  '        sec.SecKeychainGetStatus.restype = ctypes.c_int32',
  '        cf.CFRelease.argtypes = [ctypes.c_void_p]',
  '        if sec.SecKeychainSetUserInteractionAllowed(0) != 0:',
  '            return None',
  '        ref = ctypes.c_void_p()',
  '        rc = sec.SecKeychainOpen(path.encode(), ctypes.byref(ref)) if path else sec.SecKeychainCopyDefault(ctypes.byref(ref))',
  '        if rc != 0 or not ref.value:',
  '            return None',
  '        status = ctypes.c_uint32()',
  '        try:',
  '            rc = sec.SecKeychainGetStatus(ref, ctypes.byref(status))',
  '        finally:',
  '            cf.CFRelease(ref)',
  '        return bool(status.value & 1) if rc == 0 else None',
  '    except (OSError, AttributeError):',
  '        return None',
  'r = probe(sys.argv[1] if len(sys.argv) > 1 else "")',
  'sys.stdout.write("unlocked" if r is True else "locked" if r is False else "unknown")',
  '',
].join('\n');

/**
 * @typedef {{ status: number | null, stdout: string }} RunResult
 * @typedef {(file: string, args: string[], opts: { input?: string, interactive?: boolean, timeoutMs?: number }) => RunResult} Runner
 * @typedef {{ platform: string, env: Record<string, string | undefined>, python?: string | null,
 *   security?: string, run?: Runner, probe?: (kc: string) => boolean | null }} KeychainCtx
 *   python: an absolute python3 for the lock probe, or null; security, run and probe: tests only, in process
 */

/** The account the salt item is filed under: $USER, else the uid, as clipboard_guard._account(). @param {Record<string, string | undefined>} env */
export function account(env) {
  return env.USER || String(typeof process.getuid === 'function' ? process.getuid() : '');
}

/**
 * The stock python3 of macOS, /usr/bin/python3, when it can run without an install prompt: it is a shim
 * of the developer tools, and without them it opens an install dialog instead of running. Read from the
 * file system (the active developer directory and the Command Line Tools), never by running anything.
 * @param {string} [platform]
 * @returns {string | null}
 */
export function stockPython(platform = process.platform) {
  if (platform !== 'darwin' || !fs.existsSync('/usr/bin/python3')) return null;
  const dirs = [];
  try {
    dirs.push(fs.realpathSync('/var/db/xcode_select_link'));
  } catch {
    // no active developer directory selected: xcode-select falls back to the Command Line Tools
  }
  dirs.push('/Library/Developer/CommandLineTools');
  return dirs.some((d) => fs.existsSync(path.join(d, 'usr', 'bin', 'python3'))) ? '/usr/bin/python3' : null;
}

/** @type {Runner} */
function defaultRun(file, args, opts) {
  const p = spawnSync(file, args, {
    input: opts.input,
    stdio: [opts.input !== undefined ? 'pipe' : opts.interactive ? 'inherit' : 'ignore', 'pipe', 'pipe'],
    timeout: opts.timeoutMs,
    killSignal: 'SIGKILL',
    shell: false,
    windowsHide: true,
    encoding: 'utf8',
  });
  return { status: p.error ? null : p.status, stdout: typeof p.stdout === 'string' ? p.stdout : '' };
}

/**
 * True when the keychain FILE at kc (or the default keychain) is unlocked, false when locked, null when
 * that cannot be determined (no python3, not macOS, a slow or failed probe).
 * @param {KeychainCtx} ctx
 * @param {string} kc
 * @returns {boolean | null}
 */
export function lockProbe(ctx, kc) {
  if (ctx.probe) return ctx.probe(kc);
  if (ctx.platform !== 'darwin' || !ctx.python || !path.isAbsolute(ctx.python)) return null;
  const p = spawnSync(ctx.python, ['-I', '-B', '-c', LOCK_PROBE, ...(kc ? [kc] : [])], {
    cwd: '/', env: ctx.env, stdio: ['ignore', 'pipe', 'ignore'], timeout: PROBE_SECONDS * 1000, killSignal: 'SIGKILL',
    shell: false, windowsHide: true, encoding: 'utf8',
  });
  if (p.error || p.status !== 0) return null;
  return p.stdout === 'unlocked' ? true : p.stdout === 'locked' ? false : null;
}

export class SaltStore {
  /**
   * @param {Record<string, string>} conf
   * @param {KeychainCtx} ctx
   * @param {{ interactive?: boolean }} [opts]
   */
  constructor(conf, ctx, opts = {}) {
    this.conf = conf;
    this.ctx = ctx;
    this.interactive = opts.interactive !== false;
  }

  /** @returns {string | null} */
  get() {
    let value = '';
    if (this.conf.salt_store === 'keychain') {
      const kc = this.conf.keychain_path || '';
      const argv = ['find-generic-password', '-s', this.conf.keychain_service, '-a', account(this.ctx.env), '-w', ...(kc ? [kc] : [])];
      const run = this.ctx.run || defaultRun;
      const security = this.ctx.security || SECURITY;
      /** @type {RunResult} */
      let r;
      if (this.interactive) {
        r = run(security, argv, { interactive: true });
      } else {
        if (lockProbe(this.ctx, kc) !== true) return null;
        try {
          r = run(security, argv, { timeoutMs: KEYCHAIN_READ_SECONDS * 1000 });
        } catch {
          return null;
        }
      }
      value = r.status === 0 ? core.strip(r.stdout) : '';
    } else {
      return core.fileSalt(this.conf.salt_file);
    }
    return SALT.test(value) ? value : null;
  }

  /** A new salt, stored and read back. @returns {string} */
  create() {
    const value = crypto.randomBytes(32).toString('hex');
    if (this.conf.salt_store === 'keychain') {
      const kc = this.conf.keychain_path || '';
      const cmd = 'add-generic-password -s "' + this.conf.keychain_service + '" -a "' + account(this.ctx.env) + '" -w "' + value + '"'
        + (kc ? ' "' + kc + '"' : '') + '\n';
      const r = (this.ctx.run || defaultRun)(this.ctx.security || SECURITY, ['-i'], { input: cmd });
      if (r.status !== 0) throw new Error('could not store the salt in the Keychain');
    } else {
      privateDir(path.dirname(this.conf.salt_file));
      atomicWrite(this.conf.salt_file, value + '\n');
    }
    if (this.get() !== value) throw new Error('the salt was written but does not read back');
    return value;
  }

  getOrCreate() {
    return this.get() || this.create();
  }
}

/** A user-only directory (0700), created when missing. @param {string} dir */
export function privateDir(dir) {
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
}

/** Write by rename: a 0600 file created exclusively beside it. @param {string} file @param {string} content */
export function atomicWrite(file, content) {
  const tmp = file + '.new.' + process.pid;
  const fd = fs.openSync(tmp, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
  try {
    fs.writeSync(fd, content);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/**
 * Add salted hashes to a term list (0600 in a 0700 directory), keeping it sorted and unique, with the header.
 * @param {string} file
 * @param {string[]} hashes
 * @returns {number} how many were new
 */
export function addTermHashes(file, hashes) {
  privateDir(path.dirname(file));
  const current = core.readTerms(file);
  const fresh = hashes.filter((h) => !current.has(h)); // counted as clipboard_guard.add_term_hashes() counts
  const lines = [...new Set([...current, ...fresh])].sort((a, b) => (a < b ? -1 : Number(a > b)));
  atomicWrite(file, core.TERMS_HEADER + lines.map((h) => h + '\n').join(''));
  return fresh.length;
}
