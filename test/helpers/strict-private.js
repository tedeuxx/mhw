// The worklog continuity contract's strict filter (#514): the reference the worklog skill's check block and
// the schema's next_act pattern are held to (test/method/worklog-skill.test.js). It moved from
// src/commands/worklog.js to src/commands/launch-line.js at #594, and here at #599, when `mhw launch-line`
// left the CLI: that test is its only remaining user. node: modules only.
//
// Any of these anywhere, case-insensitively as CPython's re.IGNORECASE matches an ASCII letter: also
// U+0130 and U+0131 for i, U+017F for s and U+212A for k (measured over every code point on CPython 3.14).
// The Windows drive form needs a word boundary before the letter.
const STRICT_TOKENS = ['/tmp/', '~/', '/var/folders/', '/home/', '/users/', '/private/', 'file://']; // NOSONAR javascript:S5443 - literals that REFUSE machine-local paths in published text; nothing opens a directory
/** @type {Record<string, string>} */
const FOLD_EXTRA = { 'İ': 'i', 'ı': 'i', 'ſ': 's', 'K': 'k' };
/** The ASCII letter c matches case-insensitively, or c. @param {string} c */
const fold = (c) => FOLD_EXTRA[c] || (c >= 'A' && c <= 'Z' ? c.toLowerCase() : c);
const WORD = /[\p{L}\p{N}_]/u;
const BRAND_NEXT = /[A-Za-z0-9_-]/;
/** STRICT_PRIVATE.search(text) of the deleted worklog.py. @param {string} text */
export function strictPrivate(text) {
  const cps = Array.from(text);
  const low = cps.map(fold);
  const at = (/** @type {number} */ i, /** @type {string} */ t) => low.slice(i, i + t.length).join('') === t;
  for (let i = 0; i < cps.length; i++) {
    for (const t of STRICT_TOKENS) if (at(i, t)) return true;
    // \.brand(?![A-Za-z0-9_-]), the class matched case-insensitively too
    if (at(i, '.brand') && !(i + 6 < cps.length && (BRAND_NEXT.test(cps[i + 6]) || FOLD_EXTRA[cps[i + 6]]))) return true;
    // \b[A-Za-z]:\\
    if (/^[a-z]$/.test(low[i]) && cps[i + 1] === ':' && cps[i + 2] === '\\' && (i === 0 || !WORD.test(cps[i - 1]))) return true;
  }
  return false;
}
