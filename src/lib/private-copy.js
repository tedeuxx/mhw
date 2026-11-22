// privateCopy: the Node form of the deleted global/private_copy.py (Issue #145; #484 removed it), the helper behind every
// .pmhwc-*backup. Owner-only from the first byte, never written through whatever sits at the
// destination. test/lib/private-copy.test.js runs this form and install.sh's shell form on the deleted
// Python suite's cases and requires the same result. node: modules only.
import fs from 'node:fs';
import os from 'node:os';
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
  const sid = fields.length > 1 ? fields[fields.length - 1] : '';
  const me = fields.length > 1 ? fields[0].toLowerCase() : '';
  if (who.code !== 0 || !/^S-1-[0-9-]+$/.test(sid)) throw new Error("cannot read the current user's SID");
  const acl = runAbsolute(icacls, [file, '/inheritance:r', '/grant:r', '*' + sid + ':F']);
  if (acl.code !== 0) throw new Error('icacls exited ' + acl.code);
  // #497: removing inheritance leaves any entry that is not inherited. A file created where the directory
  // passes nothing down gets the process's default access list (SYSTEM, Administrators, the user) as entries
  // of its own (measured on the Windows runner, in the user's temporary directory). Every entry whose printed
  // name is not the user's is removed, grant and deny alike, by that name (a best effort: icacls prints names
  // only); the decision is then made by SID, on the access list icacls /save writes as SDDL.
  const others = names(icacls, file).filter((n) => n.toLowerCase() !== me);
  if (others.length) {
    const rm = runAbsolute(icacls, [file, '/remove', ...others]);
    if (rm.code !== 0) throw new Error('icacls /remove exited ' + rm.code);
  }
  const left = dacl(icacls, file);
  // The computer's name is a fact of the machine: a narrowed env (a renderer run by a test with SystemRoot
  // alone, measured on the runner) falls back to the host name, cut to the 15 characters of a NetBIOS name.
  const mine = (/** @type {string} */ s) => isSid(s, sid, me, env.COMPUTERNAME || process.env.COMPUTERNAME || os.hostname().split('.')[0].slice(0, 15));
  const own = left.length === 1 && left[0].type === 'A' && !left[0].flags.includes('ID') && mine(left[0].sid);
  if (!own) {
    // The entries, as SDDL shapes, with the user's SID as "you" and any other full SID as "another".
    const shapes = left.map((e) => e.type + ';' + e.flags + ';' + (mine(e.sid) ? 'you' : (/^S-/i.test(e.sid) ? 'another' : e.sid)));
    throw new Error('the access list is not the current user alone (' + left.length + ' entries: ' + shapes.join(' ') + ')');
  }
}

/**
 * Is an SDDL trustee the user? Its full SID, or one of the aliases SDDL writes for this machine's own
 * accounts with a well-known RID: LA (its Administrator, RID 500) and LG (its Guest, 501). An alias counts
 * only when the user is an account of this machine: the domain whoami prints before the backslash is the
 * computer's name (COMPUTERNAME). A domain account with RID 500 or 501 is not this machine's LA or LG, so
 * an LA or LG entry is never counted as theirs.
 * @param {string} trustee @param {string} sid @param {string} name whoami's DOMAIN\user, lower case @param {string} computer
 */
function isSid(trustee, sid, name, computer) {
  const t = trustee.toUpperCase();
  const s = sid.toUpperCase();
  if (t === s) return true;
  const local = computer !== '' && name.split('\\')[0] === computer.toLowerCase() && s.startsWith('S-1-5-21-');
  return local && ((t === 'LA' && s.endsWith('-500')) || (t === 'LG' && s.endsWith('-501')));
}

/**
 * The account names icacls prints for one file's access entries.
 * @param {string} icacls @param {string} file
 * @returns {string[]}
 */
function names(icacls, file) {
  const r = runAbsolute(icacls, [file]);
  if (r.code !== 0) throw new Error('icacls exited ' + r.code);
  return r.stdout.split(/\r?\n/)
    .map((l) => (l.startsWith(file) ? l.slice(file.length) : l).trim())
    .filter((l) => l.includes(':('))
    .map((l) => l.slice(0, l.indexOf(':(')));
}

/**
 * One file's discretionary access list, read by SID: icacls /save writes the file's name and its
 * security descriptor as SDDL (UTF-16LE) into a file of its own, in a directory made for it and removed.
 * @param {string} icacls @param {string} file
 * @returns {Array<{ type: string, flags: string, sid: string }>}
 */
export function dacl(icacls, file) {
  const dir = fs.mkdtempSync(path.join(path.dirname(file), '.pmhwc-acl-'));
  try {
    const out = path.join(dir, 'acl');
    const r = runAbsolute(icacls, [file, '/save', out]);
    if (r.code !== 0) throw new Error('icacls /save exited ' + r.code);
    const raw = fs.readFileSync(out);
    const utf16 = (raw[0] === 0xff && raw[1] === 0xfe) || (raw.length > 1 && raw[1] === 0);
    const text = raw.toString(utf16 ? 'utf16le' : 'utf8').replace(/^\uFEFF/, '');
    const sddl = text.split(/\r?\n/).find((l) => l.startsWith('D:')) || '';
    const d = sddl.slice(sddl.indexOf('D:') + 2);
    const body = d.includes('S:') ? d.slice(0, d.indexOf('S:')) : d;
    return [...body.matchAll(/\(([^()]*)\)/g)].map((m) => {
      const f = m[1].split(';');
      return { type: f[0] || '', flags: f[1] || '', sid: f[5] || '' };
    });
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
