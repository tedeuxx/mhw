// What an earlier install left of the term lists (#589). Since #589 third-party terms (employer, client,
// colleague, health) are judged by the model: the global brief's instruction and, on Claude Code, a
// `prompt`-type UserPromptSubmit hook. `mhw add-term`, the hashed term lists and their salt are removed, and
// nothing reads them. Install, reinstall and uninstall move these files aside (a 0600 <file>.pmhwc-backup
// beside each, named in a notice), and `mhw status` names any that is still there. Only the default paths
// are covered: a list an owner pointed elsewhere with terms_file= (and the like) in his clipboard.conf is
// not found here. node: modules only.
import fs from 'node:fs';
import path from 'node:path';

/** The salt and the three lists add-term wrote, and the .old-salt copies it moved a list aside as (#488). */
export const LEFTOVER_NAMES = Object.freeze(['clipboard-salt', 'clipboard-terms', 'clipboard-terms-health', 'clipboard-terms-colleague',
  'clipboard-terms.old-salt', 'clipboard-terms-health.old-salt', 'clipboard-terms-colleague.old-salt']);

/**
 * The leftover files that exist as regular files in the local overlay directory, in LEFTOVER_NAMES order.
 * @param {string} localOverlay <data dir>/local-overlay
 * @returns {string[]}
 */
export function termLeftovers(localOverlay) {
  return LEFTOVER_NAMES.map((n) => path.join(localOverlay, n)).filter((f) => {
    try {
      return fs.lstatSync(f).isFile();
    } catch {
      return false;
    }
  });
}
