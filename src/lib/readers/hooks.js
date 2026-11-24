// Which of our hooks each layer actually registers, read from the installed files (#493, S22 of #470;
// moved from global/workstation.py). A hook counts only when its entry is registered AND the script it
// runs is present; a removed hook's entry is named whenever it is still registered, script or not.
// node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { NAME, MARKER, darwin, managedRoot, pathOf, pathlibJoin, inHome, codexHome, exists, isFile, readJson,
  readText, get, truthy, isDict } from './common.js';
import { adminDropin, codexRequirements } from './admin.js';
import { pyStr } from '../py.js';

/** @typedef {import('./common.js').Env} Env */

// The HITL picker guard was removed (ADR-0013, 2026-10-05 amendment, Issue #60); its name is kept so
// status can name an entry an earlier install left registered.
export const GUARD = 'hitl-escalation-guard.sh';
export const LEFTOVER = 'removed picker guard still registered (Claude Code)';
// The prompt hook (ADR-0033) is the fixed-pattern check's prompt half since #600 (src/hooks/pattern-check.js,
// installed as a file by #588); it was `mhw hook prompt` (Node since #488) until then. Its command, as both
// installers render it: /usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE
// "<node>" "<.../pattern-check.js>" prompt --harness H --config "<conf>". It counts only when its entry is
// registered AND the node and the script it runs are files. Status still names it the paste filter: its
// notices are the paste filter's, and the wrapper beside it is too (until #590). An entry of `mhw hook prompt`,
// or of the Python core before it, that an earlier install left registered is named as a leftover.
export const PASTE = '--harness ';
export const OLD_PASTE = 'clipboard_guard.py';
/** @param {string} harness */
export const oldPasteLeftover = (harness) => 'removed Python paste filter still registered (' + harness + ')';
const PASTE_NODE = /^(?:\/bin\/sh -c ')?\/usr\/bin\/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "([^"]+)" "([^"]+)" prompt --harness /;
/** `mhw hook prompt`'s command (user layer: bin/mhw.js; admin layer: its hook-entry.js copy), removed by #600. */
const HOOK_PROMPT = /"[^"]*[\\/](?:bin[\\/]mhw|hook-entry)\.js" (?:hook prompt )?--harness /;
/** @param {string} harness */
export const hookPromptLeftover = (harness) => 'removed mhw hook prompt still registered (' + harness + ')';

/** [node, script] of our prompt hook command, or null. @param {string} cmd */
export function pasteParts(cmd) {
  const m = PASTE_NODE.exec(cmd);
  return m && /[\\/]pattern-check\.js$/.test(m[2]) ? [m[1], m[2]] : null; // either separator: the readers also run on Windows
}

/** True when one of cmds is `mhw hook prompt`'s entry, which #600 removed. @param {string[]} cmds */
export const hookPromptRegistered = (cmds) => cmds.some((c) => HOOK_PROMPT.test(c));

/**
 * The FAIL item for a registered prompt hook whose node or entry is gone (an npm uninstall, an nvm switch, a
 * moved checkout), or null: the hook cannot start, so the filter must not just vanish from the list (#488,
 * PR #536 lens B3). The rendered command's start fallback says NOT checked on each prompt; this says it here.
 * @param {string[]} cmds
 * @param {string} harness
 * @returns {string | null}
 */
export function pasteFail(cmds, harness) {
  if (pasteOk(cmds)) return null;
  for (const c of cmds) {
    const p = pasteParts(c);
    if (!p) continue;
    const gone = p.filter((x) => !isFile(x));
    if (gone.length) return 'paste filter (' + harness + ') FAIL: ' + gone.join(' and ') + ' not found, the prompt hook cannot start';
  }
  return null;
}

/** True when one of cmds is our prompt hook whose node and entry are both files. @param {string[]} cmds */
export function pasteOk(cmds) {
  return cmds.some((c) => {
    const p = pasteParts(c);
    return p !== null && isFile(p[0]) && isFile(p[1]);
  });
}
// The restart guard was removed (ADR-0028); a v2 admin layer still registers it (Issue #52).
export const RESTART = 'restart_guard.py';
// The fixed-pattern check's Kiro CLI V3 hook file (#588), the prompt hook there since #600; the file that ran
// `mhw hook prompt` until then is named while it is still there.
export const KIRO_HOOK = NAME + '-pattern-check.json';
export const OLD_KIRO_HOOK = NAME + '-paste-filter.json';

/** @param {string} harness */
export const restartLeftover = (harness) => 'removed restart guard still registered (' + harness + ')';

/** The paste filter's data directory: $XDG_DATA_HOME or ~/.local/share, then the project. @param {Env} env */
export function dataDir(env) {
  return env.XDG_DATA_HOME ? pathlibJoin(env.XDG_DATA_HOME, [NAME]) : inHome(env, '.local', 'share', NAME);
}

/**
 * Every hook command string registered for one event in a Claude Code or Codex JSON hooks document.
 * @param {unknown} doc
 * @param {string} event
 */
export function commands(doc, event) {
  /** @type {string[]} */
  const out = [];
  if (!isDict(doc)) return out;
  const hooks = get(doc, 'hooks');
  const groups = truthy(hooks) ? get(hooks, event) : undefined;
  for (const group of Array.isArray(groups) ? groups : []) {
    const inner = isDict(group) ? get(group, 'hooks') : undefined;
    for (const hook of Array.isArray(inner) ? inner : []) {
      const cmd = get(hook, 'command');
      if (typeof cmd === 'string') out.push(cmd);
    }
  }
  return out;
}

/** @param {unknown} doc */
const restartRegistered = (doc) => ['SessionStart', 'PreToolUse'].some((e) => commands(doc, e).some((c) => c.includes(RESTART)));

/**
 * [label or null, read state] for Kiro CLI V3's user-level hook file, ~/.kiro/hooks/<KIRO_HOOK>.
 * present: managed, and among its hooks a UserPromptSubmit command running the installed check in its kiro
 * mode (the file also carries the check's PreToolUse hook);
 * modified: the file is there but is not that; absent: null. Present is not loaded (Kiro runs it only
 * in a trusted workspace, on the V3 engine).
 * @param {Env} env
 * @param {string} data
 * @returns {[string | null, string]}
 */
export function kiroHookState(env, data) {
  const p = inHome(env, '.kiro', 'hooks', KIRO_HOOK);
  if (!exists(p)) return [null, 'absent'];
  const [doc, state] = readJson(p);
  if (state === 'not read') return ['paste filter (Kiro CLI V3, modified: not JSON)', state];
  const hooks = get(doc, 'hooks');
  const ours = Array.isArray(hooks) ? hooks.filter((h) => isDict(h)) : [];
  const first = ours.find((h) => ['UserPromptSubmit', 'promptSubmit'].includes(/** @type {string} */ (get(h, 'trigger')))) || ours[0];
  const action = get(first, 'action');
  /** @param {unknown} v */
  const str = (v) => pyStr(v === undefined ? '' : v);
  const good = isDict(doc) && get(doc, 'version') === 'v1' && ours.length >= 1
    && str(get(first, 'description')).includes(MARKER)
    && ['UserPromptSubmit', 'promptSubmit'].includes(/** @type {string} */ (get(first, 'trigger')))
    && isDict(action) && get(action, 'type') === 'command'
    && pasteOk([str(get(action, 'command'))])
    && str(get(action, 'command')).includes('--harness kiro');
  void data;
  const fail = isDict(action) ? pasteFail([str(get(action, 'command'))], 'Kiro CLI V3') : null;
  if (!good && fail) return [fail, state];
  return [good ? 'paste filter (Kiro CLI V3)' : 'paste filter (Kiro CLI V3, modified)', state];
}

/**
 * {layer: [found] | 'not read'} for the user and admin layers.
 * @param {Env} env
 * @returns {Record<string, string[] | string>}
 */
export function readHooks(env) {
  const data = dataDir(env);
  const adminBin = pathOf(managedRoot(env) + (darwin() ? '/Library/Application Support/' + NAME + '/bin' : '/etc/' + NAME + '/bin'));
  void adminBin;
  /** @type {Record<string, string[] | string>} */
  const result = {};

  /** @type {string[]} */
  let found = [];
  let unread = false;
  let [doc, state] = readJson(inHome(env, '.claude', 'settings.json'));
  unread ||= state === 'not read';
  if (commands(doc, 'PreToolUse').some((c) => c.includes(GUARD))) found.push(LEFTOVER);
  if (restartRegistered(doc)) found.push(restartLeftover('Claude Code'));
  if (pasteOk(commands(doc, 'UserPromptSubmit'))) found.push('paste filter (Claude Code)');
  const failC = pasteFail(commands(doc, 'UserPromptSubmit'), 'Claude Code');
  if (failC) found.push(failC);
  if (commands(doc, 'UserPromptSubmit').some((c) => c.includes(OLD_PASTE))) found.push(oldPasteLeftover('Claude Code'));
  if (hookPromptRegistered(commands(doc, 'UserPromptSubmit'))) found.push(hookPromptLeftover('Claude Code'));
  [doc, state] = readJson(pathlibJoin(codexHome(env), ['hooks.json']));
  unread ||= state === 'not read';
  if (restartRegistered(doc)) found.push(restartLeftover('Codex'));
  if (pasteOk(commands(doc, 'UserPromptSubmit'))) found.push('paste filter (Codex)');
  const failX = pasteFail(commands(doc, 'UserPromptSubmit'), 'Codex');
  if (failX) found.push(failX);
  if (commands(doc, 'UserPromptSubmit').some((c) => c.includes(OLD_PASTE))) found.push(oldPasteLeftover('Codex'));
  if (hookPromptRegistered(commands(doc, 'UserPromptSubmit'))) found.push(hookPromptLeftover('Codex'));
  const [kiro, kstate] = kiroHookState(env, data);
  unread ||= kstate === 'not read';
  if (kiro) found.push(kiro);
  const oldKiro = readText(inHome(env, '.kiro', 'hooks', OLD_KIRO_HOOK));
  if (oldKiro !== null && oldKiro.includes(MARKER)) found.push(hookPromptLeftover('Kiro CLI V3'));
  result.user = unread && !found.length ? 'not read' : [...found, ...(unread ? ['a file not read'] : [])];

  found = [];
  unread = false;
  [doc, state] = readJson(adminDropin(env));
  unread ||= state === 'not read';
  if (commands(doc, 'PreToolUse').some((c) => c.includes(GUARD))) found.push(LEFTOVER);
  if (restartRegistered(doc)) found.push(restartLeftover('Claude Code'));
  if (pasteOk(commands(doc, 'UserPromptSubmit'))) found.push('paste filter (Claude Code)');
  const failAC = pasteFail(commands(doc, 'UserPromptSubmit'), 'Claude Code');
  if (failAC) found.push(failAC);
  if (commands(doc, 'UserPromptSubmit').some((c) => c.includes(OLD_PASTE))) found.push(oldPasteLeftover('Claude Code'));
  if (hookPromptRegistered(commands(doc, 'UserPromptSubmit'))) found.push(hookPromptLeftover('Claude Code'));
  const req = codexRequirements(env);
  let text = '';
  if (exists(req)) {
    const t = readText(req);
    if (t === null) unread = true;
    else text = t;
  }
  /** @type {string[]} */
  const codexCmds = [];
  for (const m of text.matchAll(/^command = ("(?:[^"\\]|\\.)*")$/gm)) {
    try {
      codexCmds.push(JSON.parse(m[1]));
    } catch {
      // not a TOML basic string JSON can read: not ours
    }
  }
  if (text.includes(MARKER) && text.includes('[[hooks.UserPromptSubmit') && pasteOk(codexCmds)) found.push('paste filter (Codex)');
  const failA = text.includes(MARKER) ? pasteFail(codexCmds, 'Codex') : null;
  if (failA) found.push(failA);
  if (text.includes(MARKER) && text.includes(OLD_PASTE)) found.push(oldPasteLeftover('Codex'));
  if (text.includes(MARKER) && hookPromptRegistered(codexCmds)) found.push(hookPromptLeftover('Codex'));
  if (text.includes(MARKER) && text.includes(RESTART)) found.push(restartLeftover('Codex'));
  result.admin = unread && !found.length ? 'not read' : [...found, ...(unread ? ['a file not read'] : [])];
  return result;
}

/**
 * 'admin: … · user: …'; a layer with nothing registered reads 'none'.
 * @param {Record<string, string[] | string>} found
 */
export function hooksText(found) {
  return ['admin', 'user'].map((layer) => {
    const value = found[layer] ?? 'not read';
    if (typeof value === 'string') return layer + ': ' + value;
    return layer + ': ' + (value.length ? value.join(', ') : 'none');
  }).join(' · ');
}

/**
 * The node the prompt hook runs, read from the installed hook commands (admin first), whether a process
 * running as the owner can replace it (or the libraries it loads), and FAIL when it is missing (D6 of #470,
 * #488; the owner accepted an owner-writable node until S32, PR #536).
 * @param {Env} env
 */
export function hookNodeText(env) {
  /** @type {string[]} */
  const cmds = [];
  for (const p of [adminDropin(env), inHome(env, '.claude', 'settings.json'), pathlibJoin(codexHome(env), ['hooks.json'])]) {
    cmds.push(...commands(readJson(p)[0], 'UserPromptSubmit'));
  }
  /** @type {string[]} */
  const nodes = [];
  for (const c of cmds) {
    const p = pasteParts(c);
    if (p && !nodes.includes(p[0])) nodes.push(p[0]);
  }
  if (!nodes.length) return 'no prompt hook registered';
  return nodes.map((n) => (isFile(n) ? nodeOwnership(n) : 'FAIL ' + n + ' not found: the prompt hook cannot run')).join('; ');
}

/**
 * A node path and whether a process running as this user can replace it, or a directory above it, or the
 * libraries it loads: '<node> (owner-writable: …)' or '<node> (not writable by you)'. mhw install-admin
 * prints it on its NODE line (#496), and hookNodeText above reads it for status.
 * @param {string} n an absolute path
 */
export function nodeOwnership(n) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : -1;
  let writable = false;
  try {
    let q = fs.realpathSync(n);
    for (;;) {
      const st = fs.statSync(q);
      if (st.uid === uid) writable = true;
      try {
        fs.accessSync(q, fs.constants.W_OK);
        writable = true;
      } catch {
        // not writable by this process
      }
      const up = path.dirname(q);
      if (up === q) break;
      q = up;
    }
  } catch {
    writable = false;
  }
  return uid !== 0 && writable ? n + ' (owner-writable: a process running as you can replace it, or the libraries it loads)'
    : n + ' (not writable by you)';
}

const TERM_LIST_KEYS = ['terms_file', 'health_terms_file', 'colleague_terms_file'];
const TERM_LIST_FILES = ['clipboard-terms', 'clipboard-terms-health', 'clipboard-terms-colleague'];
const HASH_LINE = /^[0-9a-f]{64}$/;

/** Hash lines in a file, 0 when it is absent or unreadable. @param {string} p */
function hashCount(p) {
  const text = readText(p);
  return text === null ? 0 : text.split(/\r?\n/).filter((l) => HASH_LINE.test(l.trim())).length;
}

/**
 * [ok, text] for the paste filter's hashed term lists and their salt file (#488). Since #488 the salt is a
 * 0600 file; a list with hashes and no readable salt file, or a list add-term moved aside as
 * <list>.old-salt, means term matching does not cover those terms. The paths come from the installed
 * clipboard.conf (last value wins), else the defaults; the salt itself is only matched against its shape.
 * @param {Env} env
 * @returns {[boolean, string]}
 */
export function termListsState(env) {
  const data = dataDir(env);
  const local = pathlibJoin(data, ['local-overlay']);
  /** @type {Record<string, string>} */
  const paths = { salt_file: pathlibJoin(local, ['clipboard-salt']) };
  TERM_LIST_KEYS.forEach((k, i) => { paths[k] = pathlibJoin(local, [TERM_LIST_FILES[i]]); });
  for (const line of (readText(pathlibJoin(data, ['clipboard.conf'])) || '').split(/\r?\n/)) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    if (Object.hasOwn(paths, key) && value) paths[key] = value;
  }
  const salt = readText(paths.salt_file);
  const saltOk = salt !== null && /^[0-9a-f]{64}$/.test(salt.trim());
  /** @type {string[]} */
  const problems = [];
  let total = 0;
  for (const key of TERM_LIST_KEYS) {
    const n = hashCount(paths[key]);
    total += n;
    if (n && !saltOk) {
      problems.push(paths[key] + ' holds ' + n + ' hash(es) and the salt file ' + paths.salt_file
        + ' is missing or unreadable: term matching off: re-add with mhw add-term');
    }
    const old = paths[key] + '.old-salt';
    const nOld = hashCount(old);
    if (nOld) problems.push(old + ' holds ' + nOld + ' hash(es) made with a salt mhw no longer has: those terms are not matched: re-add with mhw add-term, then delete ' + old);
  }
  if (problems.length) return [false, problems.join('; ')];
  return [true, total ? total + ' hash(es), salt file present' : 'no term list'];
}
