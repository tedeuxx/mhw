// The --key=value command lines of the installer's Node steps (allow-list.js, settings-merge.js): every
// argument one known key, each at most once. node: modules only.

/**
 * The options, or null for an argument that is not --key=value, an unknown key or a repeated one.
 * @param {string[]} argv
 * @param {Set<string>} known
 * @returns {Record<string, string> | null}
 */
export function keyOptions(argv, known) {
  /** @type {Record<string, string>} */
  const opts = {};
  for (const a of argv) {
    const at = a.indexOf('=');
    const k = at < 0 ? a : a.slice(0, at);
    if (at < 0 || !known.has(k) || Object.hasOwn(opts, k)) return null;
    opts[k] = a.slice(at + 1);
  }
  return opts;
}
