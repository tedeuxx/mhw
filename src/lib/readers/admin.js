// The admin layer as status reads it (#493, S22 of #470), moved from global/workstation.py: where our
// Claude Code drop-in, our admin directory and the Codex requirements file live, whether one is present,
// and what the admin installer's --check said about it (`mhw install-admin`; global/install-managed.sh until #496). mhw check, install, update and uninstall use the
// same readers since #494 and #495 (S23, S24), when workstation.py's own copy went. node: modules only.
import { NAME, MARKER, darwin, managedRoot, pathOf, exists, readJson, readText, baseName, isDict, unreadable } from './common.js';
import { isPyWs, loads } from '../py.js';
import { readTextPy } from '../clean.js';

/** @typedef {import('./common.js').Env} Env */

/** Our Claude Code managed-settings drop-in. @param {Env} env */
export function adminDropin(env) {
  const base = darwin() ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code';
  return pathOf(managedRoot(env) + base + '/managed-settings.d/50-' + NAME + '.json');
}

/** Our admin directory. @param {Env} env */
export function adminBase(env) {
  return pathOf(managedRoot(env) + (darwin() ? '/Library/Application Support/' : '/etc/') + NAME);
}

/** The Codex requirements file. @param {Env} env */
export function codexRequirements(env) {
  return pathOf(managedRoot(env) + '/etc/codex/requirements.toml');
}

/**
 * Python's `NAME in doc` for a parsed document: a key of a dict, an element of a list, a substring of a
 * string. Anything else raised TypeError in the original (a traceback); here it is false.
 * @param {unknown} doc
 */
export function holdsName(doc) {
  if (isDict(doc)) return Object.hasOwn(/** @type {object} */ (doc), NAME);
  if (Array.isArray(doc)) return doc.some((x) => x === NAME);
  if (typeof doc === 'string') return doc.includes(NAME);
  return false;
}

/**
 * installed (our stamped drop-in), legacy (our filename, no stamp key: written before #66), unreadable
 * (present, not JSON), or absent. A present drop-in is never reported as absent.
 * @param {Env} env
 */
export function adminState(env) {
  const p = adminDropin(env);
  if (!exists(p)) return 'absent';
  const [doc, state] = readJson(p);
  // A JSON value that is not an object sets no Claude Code setting, so it is not read as ours (PR #535
  // lens): workstation.py called it legacy, or stopped on it when it was a list naming the project.
  if (state !== 'read' || !isDict(doc)) return 'unreadable';
  return holdsName(doc) ? 'installed' : 'legacy';
}

/**
 * True only for a drop-in carrying the #66 stamp key. Decides the hooks mode.
 * @param {Env} env
 */
export function adminInstalled(env) {
  try {
    const doc = loads(readTextPy(adminDropin(env), 'utf-8'));
    return isDict(doc) && holdsName(doc);
  } catch {
    return false;
  }
}

/**
 * True when any admin layer of ours is on disk, stamped or from an earlier release: our drop-in, our
 * admin directory, or a Codex requirements file carrying our managed-by line (Issue #52).
 * @param {Env} env
 */
export function adminPresent(env) {
  if (exists(adminDropin(env)) || exists(adminBase(env))) return true;
  const req = codexRequirements(env);
  // A requirements file that is there and cannot be read may be ours: it counts as present, so the admin
  // --check runs and names it, rather than the view saying the admin layer is absent (PR #535 lens).
  if (unreadable(req, 'text')) return true;
  const text = readText(req);
  return text !== null && text.includes(MARKER);
}

/**
 * The release and commit the drop-in's stamp key names, or 'none'.
 * @param {Env} env
 */
export function adminStamp(env) {
  const [doc, state] = readJson(adminDropin(env));
  if (state !== 'read' || !isDict(doc) || !Object.hasOwn(/** @type {object} */ (doc), NAME)) return 'none';
  const value = /** @type {Record<string, unknown>} */ (doc)[NAME];
  if (typeof value !== 'string') return 'none';
  const m = /; (release: [^;]*; commit: [^;]*);/.exec(value);
  return m ? m[1] : 'none';
}

// Files an earlier release's admin layer installed for controls this release removed, by the name of the
// control (ADR-0028; ADR-0013, 2026-10-05). mhw install-admin --check reports them as STALE.
export const REMOVED_CONTROLS = /** @type {const} */ ([
  ['restart_guard.py', 'restart guard'],
  ['hitl-escalation-guard.sh', 'picker guard'],
  ['hitl.conf', "session intake (the picker guard's intake exception)"],
  ['breaking_glass.py', 'timed breaking-glass'],
  ['breaking-glass', 'timed breaking-glass'],
]);

const TARGET = ['OK', 'STAMP', 'DRIFT', 'MISSING', 'STALE', 'REFUSE', 'SKIP'];
const ENTRY = ['STALE', 'DRIFT', 'MISSING', 'STAMP', 'REFUSE'];

/**
 * re.match(r"(K1|K2|...)\s", line): the keyword when the line starts with one followed by whitespace.
 * @param {string} line
 * @param {readonly string[]} words
 */
export function leadingWord(line, words) {
  for (const w of words) {
    if (line.startsWith(w) && isPyWs(Array.from(line.slice(w.length))[0])) return w;
  }
  return null;
}

/** The target lines install fixes: neither OK nor SKIP. @param {string[]} lines */
export function issues(lines) {
  return lines.filter((l) => leadingWord(l, TARGET) && !l.startsWith('OK') && !l.startsWith('SKIP')).length;
}

/**
 * re.match(r"(STALE|DRIFT|MISSING|STAMP|REFUSE)\s+(.*?)(?::\s.*| \([^()]*\))?$", line) -> [kind, entry].
 * @param {string} line
 * @returns {[string, string] | null}
 */
export function entryOf(line) {
  const kind = leadingWord(line, ENTRY);
  if (!kind) return null;
  const cps = Array.from(line.slice(kind.length));
  let i = 0;
  while (i < cps.length && isPyWs(cps[i])) i++;
  const rest = cps.slice(i);
  for (let k = 0; k <= rest.length; k++) {
    const tail = rest.slice(k);
    const t = tail.join('');
    if (!tail.length || (tail[0] === ':' && isPyWs(tail[1])) || /^ \([^()]*\)$/.test(t)) return [kind, rest.slice(0, k).join('')];
  }
  return null;
}

/**
 * -> [{kind: [file name]}, [removed control]] from mhw install-admin --check output.
 * @param {string[]} lines
 * @returns {[Record<string, string[]>, string[]]}
 */
export function adminFindings(lines) {
  /** @type {Record<string, string[]>} */
  const entries = {};
  /** @type {string[]} */
  const removed = [];
  for (const line of lines) {
    const m = entryOf(line);
    if (!m) continue;
    const name = baseName(m[1].replace(/\/+$/, '')) || m[1];
    (entries[m[0]] ||= []).push(name);
    if (m[0] === 'STALE') {
      for (const [file, control] of REMOVED_CONTROLS) {
        if (name === file && !removed.includes(control)) removed.push(control);
      }
    }
  }
  /** @type {string[]} */
  const order = REMOVED_CONTROLS.map(([, c]) => c);
  removed.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return [entries, removed];
}

/**
 * The lines that name what differs in the admin layer, each entry and removed control by name, and the
 * exact next step. Empty when the admin --check exits 0 with nothing to fix.
 * @param {string[]} lines
 * @param {number} code
 * @param {string} prefix
 * @param {{ source: string, next: string }} words SOURCE_NAME and ADMIN_NEXT
 */
export function adminReport(lines, code, prefix, words) {
  if (code === 0 && issues(lines) === 0) return [];
  const [entries, removed] = adminFindings(lines);
  const count = Math.max(issues(lines), 1);
  const out = [prefix + 'the admin layer differs from ' + words.source + ': ' + count + ' target(s)'];
  for (const kind of ENTRY) {
    if (entries[kind]?.length) out.push(prefix + kind + ' ' + entries[kind].join(', '));
  }
  if (removed.length) out.push(prefix + 'removed controls still installed: ' + removed.join(', '));
  out.push(prefix + words.next);
  return out;
}
