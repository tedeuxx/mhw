// The term lists' salt (#486, #487, #488). The salt keys every term hash. Since #488 it is a file and only a
// file, on every operating system. The owner ruled on 2026-11-21 (#488): «voce nao precisa nada disso num
// cofre acredito. é over engineering». The salt lives at conf.salt_file, by default
// <data dir>/local-overlay/clipboard-salt, mode 0600 in a 0700 directory, created atomically on first use
// by add-term. The terms stay salted hashes, never plain text (ADR-0008).
//
// The macOS Keychain store is gone, and with it the lock probe and every call to the macOS security tool for the
// salt. A Node probe could not read the lock state without risking an unlock dialog: on a locked keychain,
// `security show-keychain-info` and the `-w` read both blocked until killed (CI, run 44858243105). The
// trade-off: any process running as the owner, agents included, can read the salt and so test guesses
// against the hashed lists. The lists themselves stay unreadable.
//
// Nothing here prints, logs or passes the salt on: it is returned to the caller in process. node: modules
// only (convention 5 of #470: the prompt hook runs this file).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import * as core from './clean.js';

/**
 * The salt for the term lists, or null (absent, unreadable, or not 64 lowercase hex digits). Never prompts.
 * @param {Record<string, string>} conf
 * @returns {{ salt: string | null }}
 */
export function readSalt(conf) {
  return { salt: core.fileSalt(conf.salt_file) };
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
  fs.chmodSync(tmp, 0o600);
  fs.renameSync(tmp, file);
}

/**
 * The salt, created when there is none: 32 random bytes as hex, written atomically with mode 0600 in a
 * 0700 directory, then read back. created: whether this call wrote it.
 * @param {Record<string, string>} conf
 * @returns {{ salt: string, created: boolean }}
 */
export function saltOrCreate(conf) {
  const have = core.fileSalt(conf.salt_file);
  if (have) return { salt: have, created: false };
  const value = crypto.randomBytes(32).toString('hex');
  privateDir(path.dirname(conf.salt_file));
  atomicWrite(conf.salt_file, value + '\n');
  if (core.fileSalt(conf.salt_file) !== value) throw new Error('the salt was written but does not read back');
  return { salt: value, created: true };
}

/**
 * Add salted hashes to a term list (0600 in a 0700 directory), keeping it sorted and unique, with the header.
 * @param {string} file
 * @param {string[]} hashes
 * @returns {number} how many were new, counted as clipboard_guard.add_term_hashes() counted them
 */
export function addTermHashes(file, hashes) {
  privateDir(path.dirname(file));
  const current = core.readTerms(file);
  const fresh = hashes.filter((h) => !current.has(h));
  const lines = [...new Set([...current, ...fresh])].sort((a, b) => (a < b ? -1 : Number(a > b)));
  atomicWrite(file, core.TERMS_HEADER + lines.map((h) => h + '\n').join(''));
  return fresh.length;
}

/** The three term list files a configuration names. @param {Record<string, string>} conf */
export function listFiles(conf) {
  return [conf.terms_file, ...Object.values(core.TERM_LISTS).map((k) => conf[k])];
}

/**
 * Term lists that hold hashes while no salt file exists: hashed with a salt mhw no longer has (before #488
 * the macOS default was the Keychain). Their hashes can never match again.
 * @param {Record<string, string>} conf
 * @returns {Array<[string, number]>} [file, hash count]
 */
export function orphanedLists(conf) {
  if (core.fileSalt(conf.salt_file)) return [];
  /** @type {Array<[string, number]>} */
  const out = [];
  for (const f of listFiles(conf)) {
    const n = core.readTerms(f).size;
    if (n > 0) out.push([f, n]);
  }
  return out;
}
