// #588: the fixed-pattern check's additions, taken out of a head-side transcript before it is compared with
// a golden recorded before #588 (the S25, S26 and S24 installer goldens, and S01's live arm). Each golden's
// expected-differences.json names this as a declared difference; what is taken out is exactly what #588
// adds, and test/hooks/pattern-check-install.test.js holds those additions themselves.
//   - every path of the check's own files (the user layer's pattern-check directory and Kiro hook file, the
//     admin layer's hook/src/hooks directory);
//   - every output line that names one of them, and a dry run's whole WOULD WRITE block for one;
//   - the check's hook entries inside the shared files: Claude Code's settings (UserPromptSubmit, and the
//     PreToolUse group), the Codex hooks.json and the Codex admin requirements.toml.
// Anything else #588 changed is still compared. It never rewrites a text that holds no entry of ours.
import { parse, stringify } from '../../src/lib/jq-json.js';

const ID = '/pattern-check.js" ';

/** A path of the check's own files. @param {string} p */
export const patternPath = (p) => /pattern-check|\/hook\/src\/hooks(?:\/|$)/.test(p);

/**
 * Output without the check: a dry run's WOULD WRITE block for one of its files goes, a block of a shared file
 * (the Codex hooks.json) loses the check's entries, and then every line naming one of its files goes.
 * @param {string} text
 */
export function stripOutput(text) {
  if (!text.includes('pattern-check')) return text;
  const out = text.replace(/^WOULD WRITE ([^\n]*) \((\d+|<N>) bytes\):\n----- begin \1\n([\s\S]*?)----- end \1\n/gm,
    (whole, file, n, body) => {
      if (patternPath(file)) return '';
      const kept = stripFile(file, body);
      if (kept === body) return whole;
      return 'WOULD WRITE ' + file + ' (' + (n === '<N>' ? n : String(Buffer.byteLength(kept, 'utf8'))) + ' bytes):\n----- begin ' + file + '\n' + kept + '----- end ' + file + '\n';
    });
  return out.split('\n').filter((l) => !l.includes('pattern-check')).join('\n');
}

/** @param {any} v */
const isMap = (v) => v instanceof Map;
/** @param {any} h */
const ours = (h) => isMap(h) && typeof h.get('command') === 'string' && h.get('command').includes(ID);

/**
 * A Claude Code settings document without the check's entries: its hook entries dropped from every group
 * (a group left empty goes), and an event left with no group goes.
 * @param {string} text
 */
function stripClaudeJson(text) {
  const doc = parse(text);
  if (!isMap(doc) || !isMap(doc.get('hooks'))) return text;
  const hooks = new Map(doc.get('hooks'));
  for (const [ev, groups] of hooks) {
    if (!Array.isArray(groups)) continue;
    const kept = [];
    let touched = false;
    for (const g of groups) {
      const hs = isMap(g) ? g.get('hooks') : null;
      if (!Array.isArray(hs) || !hs.some(ours)) {
        kept.push(g);
        continue;
      }
      touched = true;
      const left = hs.filter((h) => !ours(h));
      if (left.length) kept.push(new Map([...g].map(([k, v]) => [k, k === 'hooks' ? left : v])));
    }
    if (!touched) continue;
    if (kept.length) hooks.set(ev, kept);
    else hooks.delete(ev);
  }
  const out = new Map([...doc].map(([k, v]) => [k, k === 'hooks' ? hooks : v]));
  const indent = /^\{\n( +)"/.exec(text)?.[1].length ?? 2;
  return stringify(/** @type {any} */ (out), { indent }) + (text.endsWith('\n') ? '\n' : '');
}

/**
 * A file's text without the check's entries, by its kind; any other text unchanged.
 * @param {string} p the path (or its label) @param {string} text
 */
export function stripFile(p, text) {
  if (!/pattern-check\.js\\?" /.test(text)) return text; // in JSON text the quote is escaped
  if (/hooks\.json$/.test(p)) {
    // The Codex user hooks.json is rendered as text (src/commands/install-user.js, kind codexhooks).
    return text.replace(/\},\n {10}\{"type": "command", "command": "[^\n]*pattern-check\.js[^\n]*", "timeout": 30\}\n/, '}\n')
      .replace(/\n {4}\],\n {4}"PreToolUse": \[\n[\s\S]*?pattern-check\.js[\s\S]*?\n {4}\]\n/, '\n    ]\n');
  }
  if (/\.toml$/.test(p)) {
    // The Codex admin requirements.toml (src/commands/install-admin.js): the check's two hook tables.
    return text
      .replace(/\n\[\[hooks\.UserPromptSubmit\.hooks\]\]\ntype = "command"\ncommand = "[^\n]*pattern-check\.js[^\n]*"\ntimeout = 30\n/, '')
      .replace(/\n\[\[hooks\.PreToolUse\]\]\n\n\[\[hooks\.PreToolUse\.hooks\]\]\ntype = "command"\ncommand = "[^\n]*pattern-check\.js[^\n]*"\ntimeout = 30\n/, '');
  }
  try {
    return stripClaudeJson(text);
  } catch {
    return text;
  }
}

/**
 * A recorded tree (path, kind, mode, data) without the check's own entries, its shared files' text without
 * the check's entries. A data field that is a hash is left as it is (strip the text before hashing it).
 * @template {{ path: string, kind: string, data: string }} E
 * @param {E[]} entries
 * @returns {E[]}
 */
export function stripTree(entries) {
  return entries.filter((e) => !patternPath(e.path))
    .map((e) => (e.kind === 'file' && !e.data.startsWith('sha256:') ? { ...e, data: stripFile(e.path, e.data) } : e));
}
