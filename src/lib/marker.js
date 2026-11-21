// The managed-by marker (ADR-0029): the line that says mhw wrote a file and carries its provenance
// stamp. The same rules as global/install.sh's is_managed() and unstamp(); node: modules only.

export const NAME = 'personal-multi-harness-workstation-configuration';
export const MARKER_ID = 'managed-by: ' + NAME;
/** How many leading lines is_managed() reads (install.sh: `head -n 5`). */
export const MARKER_LINES = 5;

/**
 * True when one of the first five lines carries the marker, as install.sh's is_managed() decides.
 * @param {string} text
 */
export function isManaged(text) {
  return text.split('\n').slice(0, MARKER_LINES).some((line) => line.includes(MARKER_ID));
}

/**
 * The text with the stamp fields (version, release, commit) removed from every marker line, so two
 * renderings that differ only in their stamp compare equal (install.sh's unstamp()).
 * @param {string} text
 */
export function unstamp(text) {
  return text
    .split('\n')
    .map((line) => (line.includes(MARKER_ID) ? line.replace(/; (version|release|commit): [^;"]*/g, '') : line))
    .join('\n');
}

/**
 * The first line carrying the marker, or null.
 * @param {string} text
 */
export function markerLine(text) {
  return text.split('\n').find((line) => line.includes(MARKER_ID)) ?? null;
}

/**
 * install.sh's stamp_of over one line: its release and commit fields (sed's greedy `.*; key: \\([^;"]*\\);.*`,
 * the last occurrence followed by a ';'), or 'none' when either is missing.
 * @param {string} line
 */
export function stampOfLine(line) {
  const rel = lastField(line, '; release: ');
  const com = lastField(line, '; commit: ');
  return rel && com ? 'release: ' + rel + '; commit: ' + com : 'none';
}

/** @param {string} line @param {string} key */
function lastField(line, key) {
  for (let at = line.lastIndexOf(key); at >= 0; at = at === 0 ? -1 : line.lastIndexOf(key, at - 1)) {
    let k = at + key.length;
    while (k < line.length && line[k] !== ';' && line[k] !== '"') k++;
    if (line[k] === ';') return line.slice(at + key.length, k);
  }
  return '';
}
