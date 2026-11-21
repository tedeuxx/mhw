// The term lists' salt, read without a prompt (#486; shared with the paste wrapper since #487, and with the
// prompt hook since #488). A file store is read here. The macOS Keychain is read by src/lib/keychain.js's
// SaltStore in its non-interactive mode: the lock probe first, then a bounded `/usr/bin/security` read. The
// salt reaches this process on a pipe from `security`, never in an argument, the environment or a file.
// clipboard_guard.py read it this way in process until #488 deleted it. node: modules only.
import * as core from './clean.js';
import { SaltStore } from './keychain.js';

/**
 * The salt for the term lists, or null, read without a prompt; noPython when the Keychain's lock probe had
 * no python3 to run it.
 * @param {import('./keychain.js').KeychainCtx} ctx  python: an absolute path, or null
 * @param {Record<string, string>} conf
 * @returns {{ salt: string | null, noPython?: boolean }}
 */
export function readSalt(ctx, conf) {
  if (conf.salt_store !== 'keychain') return { salt: core.fileSalt(conf.salt_file) };
  // Off macOS there is no Security.framework: the probe answers "unknown" there.
  if (ctx.platform !== 'darwin') return { salt: null };
  if (!ctx.python && !ctx.probe) return { salt: null, noPython: true };
  return { salt: new SaltStore(conf, ctx, { interactive: false }).get() };
}
