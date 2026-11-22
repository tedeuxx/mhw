// privateCopy: the Node form of the deleted global/private_copy.py (Issue #145; #484 removed it), the helper behind every
// .pmhwc-*backup. Owner-only from the first byte, never written through whatever sits at the
// destination. test/lib/private-copy.test.js runs this form and install.sh's shell form on the deleted
// Python suite's cases and requires the same result. node: modules only.
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
  const icacls = path.join(sys32, 'icacls.exe');
  const who = runAbsolute(path.join(sys32, 'whoami.exe'), ['/user', '/fo', 'csv', '/nh']);
  const fields = who.stdout.trim().split('","').map((f) => f.replaceAll('"', '').trim());
  const sid = fields[fields.length - 1] || '';
  const me = (fields.length > 1 ? fields[0] : '').toLowerCase();
  if (who.code !== 0 || !sid.startsWith('S-1-') || !me) throw new Error("cannot read the current user's SID");
  const acl = runAbsolute(icacls, [file, '/inheritance:r', '/grant:r', '*' + sid + ':F']);
  if (acl.code !== 0) throw new Error('icacls exited ' + acl.code);
  // #497: removing inheritance leaves any entry that is not inherited. A file created where the directory
  // passes nothing down gets the process's default access list (SYSTEM, Administrators, the user) as entries
  // of its own (measured on the Windows runner, in the user's temporary directory), so every entry but the
  // user's is removed by the name icacls itself prints, and the result is read back: one entry, the user's.
  const others = aces(icacls, file).filter((a) => a.name.toLowerCase() !== me);
  if (others.length) {
    const rm = runAbsolute(icacls, [file, '/remove:g', ...others.map((a) => a.name)]);
    if (rm.code !== 0) throw new Error('icacls /remove exited ' + rm.code);
  }
  const left = aces(icacls, file);
  if (left.length !== 1 || left[0].name.toLowerCase() !== me || left[0].inherited) {
    throw new Error('the access list is not the current user alone (' + left.length + ' entries)');
  }
}

/**
 * The access entries icacls prints for one file: the account name, and whether it is inherited.
 * @param {string} icacls @param {string} file
 * @returns {Array<{ name: string, inherited: boolean }>}
 */
function aces(icacls, file) {
  const r = runAbsolute(icacls, [file]);
  if (r.code !== 0) throw new Error('icacls exited ' + r.code);
  return r.stdout.split(/\r?\n/)
    .map((l) => (l.startsWith(file) ? l.slice(file.length) : l).trim())
    .filter((l) => l.includes(':('))
    .map((l) => ({ name: l.slice(0, l.indexOf(':(')), inherited: l.includes('(I)') }));
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
