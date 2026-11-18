// The provenance stamp (ADR-0029): `release: <r>; commit: <c>` inside the managed-by line, read and
// written the way global/install.sh's stamp_of() and workstation.py's stamp_in() read it. Deriving a
// stamp from git stays in install.sh until the installer moves (#470); this module reads and writes one.
// node: modules only.
import { MARKER_ID, markerLine } from './marker.js';

/** @typedef {{ release: string, commit: string }} Stamp */

const FIELD = /; (version|release|commit): [^;"]*/g;

/**
 * 'release: R; commit: C'.
 * @param {Stamp} stamp
 */
export function formatStamp(stamp) {
  check(stamp);
  return 'release: ' + stamp.release + '; commit: ' + stamp.commit;
}

/**
 * The stamp of a text's first managed-by line, or null when it has none (install.sh prints 'none').
 * Both fields must be present, as stamp_of() requires.
 * @param {string} text
 * @returns {Stamp | null}
 */
export function stampOf(text) {
  const line = markerLine(text);
  if (line === null) return null;
  const release = /; release: ([^;"]*);/.exec(line);
  const commit = /; commit: ([^;"]*);/.exec(line);
  if (!release || !commit || !release[1] || !commit[1]) return null;
  return { release: release[1], commit: commit[1] };
}

/**
 * The text with its first managed-by line carrying `stamp`: any version, release and commit fields are
 * removed and the two fields are written after the `source:` field, or right after the marker when
 * there is none (the order every installed file carries). A text without a marker line is returned
 * unchanged.
 * @param {string} text
 * @param {Stamp} stamp
 */
export function setStamp(text, stamp) {
  const fields = '; ' + formatStamp(stamp);
  const lines = text.split('\n');
  const i = lines.findIndex((line) => line.includes(MARKER_ID));
  if (i < 0) return text;
  const bare = lines[i].replace(FIELD, '');
  const source = /; source: [^;"]*/.exec(bare);
  const at = source ? source.index + source[0].length : bare.indexOf(MARKER_ID) + MARKER_ID.length;
  lines[i] = bare.slice(0, at) + fields + bare.slice(at);
  return lines.join('\n');
}

/**
 * A field value may not carry the separators the line is parsed by.
 * @param {Stamp} stamp
 */
function check(stamp) {
  for (const [k, v] of Object.entries(stamp)) {
    if (typeof v !== 'string' || v === '' || /[;"\n]/.test(v)) throw new Error('invalid stamp ' + k + ': ' + JSON.stringify(v));
  }
}
