// File helpers every renderer shares: a write that never leaves a half-written file, and the
// backup-beside-write convention (`<file>.pmhwc-backup`, owner-only, through privateCopy).
// node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { privateCopy } from './private-copy.js';

export const BACKUP_SUFFIX = '.pmhwc-backup';

/**
 * Write data to file through a temporary file in the same directory and a rename, so a reader sees
 * the old file or the new one, never a partial one. The temporary file is created exclusively and
 * without following a link; mode applies to the new file (default 0644 before the umask).
 * @param {string} file
 * @param {string | Uint8Array} data
 * @param {{ mode?: number }} [opts]
 */
export function writeFileAtomic(file, data, opts = {}) {
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(file) + '.mhw-' + crypto.randomBytes(6).toString('hex'));
  const C = fs.constants;
  const fd = fs.openSync(tmp, C.O_WRONLY | C.O_CREAT | C.O_EXCL | (C.O_NOFOLLOW || 0), opts.mode ?? 0o644);
  try {
    fs.writeFileSync(fd, data);
    if (opts.mode !== undefined && process.platform !== 'win32') fs.fchmodSync(fd, opts.mode);
  } catch (e) {
    fs.closeSync(fd);
    fs.rmSync(tmp, { force: true });
    throw e;
  }
  fs.closeSync(fd);
  try {
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    throw e;
  }
}

/**
 * Copy file to the backup beside it (owner-only), when it exists as a regular file. Returns the backup
 * path, or null when there was nothing to back up. A symbolic link at file is not followed: there is
 * nothing of ours to keep behind it.
 * @param {string} file
 * @param {string} [suffix]
 * @returns {string | null}
 */
export function backupBeside(file, suffix = BACKUP_SUFFIX) {
  let st;
  try {
    st = fs.lstatSync(file);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const backup = file + suffix;
  privateCopy(file, backup);
  return backup;
}

/**
 * Back up what is at file (when it is a regular file), then write data atomically.
 * @param {string} file
 * @param {string | Uint8Array} data
 * @param {{ mode?: number, backup?: boolean, suffix?: string }} [opts] backup defaults to true
 * @returns {{ backup: string | null }}
 */
export function writeWithBackup(file, data, opts = {}) {
  const backup = opts.backup === false ? null : backupBeside(file, opts.suffix);
  writeFileAtomic(file, data, { mode: opts.mode });
  return { backup };
}
