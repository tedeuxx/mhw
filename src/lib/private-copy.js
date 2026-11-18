// privateCopy: the Node form of global/private_copy.py (Issue #145), the helper behind every
// .pmhwc-*backup. Owner-only from the first byte, never written through whatever sits at the
// destination. test/lib/private-copy.test.js runs this form and the Python one on the Python suite's
// own cases and requires the same result. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { runAbsolute } from './run.js';

const C = fs.constants;
/** The Python form's FLAGS: write-only, create, exclusive, and no link followed where the OS has it. */
export const FLAGS = C.O_WRONLY | C.O_CREAT | C.O_EXCL | (C.O_NOFOLLOW || 0);

/** @param {string} p */
function lexists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * Windows: 0600 is not a Windows mode, so the new, still empty file gets an access list that grants
 * the current user alone, inheritance removed (icacls, by SID). whoami and icacls run by absolute path
 * from System32. A failure throws: no backup is written readable by more than its owner.
 * @param {string} file
 * @param {Record<string, string | undefined>} env
 */
function ownerOnlyAcl(file, env) {
  const sys32 = path.join(env.SystemRoot || 'C:\\Windows', 'System32');
  const who = runAbsolute(path.join(sys32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
  const sid = (who.stdout.trim().split(',').pop() || '').trim().replace(/^"|"$/g, '');
  if (who.code !== 0 || !sid.startsWith('S-1-')) throw new Error("cannot read the current user's SID");
  const acl = runAbsolute(path.join(sys32, 'icacls.exe'), [file, '/inheritance:r', '/grant:r', '*' + sid + ':F']);
  if (acl.code !== 0) throw new Error('icacls exited ' + acl.code);
}

/**
 * Copy src to dst, owner-only from its first byte, whatever src's mode. Whatever is already at dst (a
 * file, a hard link, a symbolic link, a FIFO) is unlinked first and never written through; dst is then
 * created exclusively and without following a link, so anything planted at dst between the unlink and
 * the create makes the copy throw instead of being opened. POSIX: mode 0600. Windows: owner-only ACL
 * before a byte is written.
 * @param {string} src
 * @param {string} dst
 * @param {{ lexists?: (p: string) => boolean, platform?: string, env?: Record<string, string | undefined> }} [opts]
 *   lexists is a test seam: the race tests plant something at dst from inside it.
 */
export function privateCopy(src, dst, opts = {}) {
  const exists = opts.lexists || lexists;
  const platform = opts.platform || process.platform;
  if (exists(dst)) fs.unlinkSync(dst);
  const fd = fs.openSync(dst, FLAGS, 0o600);
  try {
    if (platform === 'win32') {
      try {
        ownerOnlyAcl(dst, opts.env || process.env);
      } catch (e) {
        fs.closeSync(fd);
        fs.unlinkSync(dst);
        throw new Error('could not make ' + dst + ' owner-only (' + (e instanceof Error ? e.message : String(e)) + '); no backup written');
      }
    }
    const data = fs.readFileSync(src);
    let off = 0;
    while (off < data.length) off += fs.writeSync(fd, data, off, data.length - off);
    if (platform !== 'win32') fs.fchmodSync(fd, 0o600);
  } finally {
    try {
      fs.closeSync(fd);
    } catch {
      // closed above on the Windows failure path
    }
  }
}
