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
