// Which of our hooks each layer actually registers, read from the installed files (#493, S22 of #470;
// moved from global/workstation.py). A hook counts only when its entry is registered AND the script it
// runs is present; a removed hook's entry is named whenever it is still registered, script or not.
// node: modules only.
import { NAME, MARKER, darwin, managedRoot, pathOf, pathlibJoin, inHome, codexHome, exists, isFile, readJson,
  readText, get, truthy, isDict } from './common.js';
import { adminDropin, codexRequirements } from './admin.js';
import { pyStr } from '../py.js';

/** @typedef {import('./common.js').Env} Env */

// The HITL picker guard was removed (ADR-0013, 2026-10-05 amendment, Issue #60); its name is kept so
// status can name an entry an earlier install left registered.
export const GUARD = 'hitl-escalation-guard.sh';
export const LEFTOVER = 'removed picker guard still registered (Claude Code)';
export const PASTE = 'clipboard_guard.py';
// The restart guard was removed (ADR-0028); a v2 admin layer still registers it (Issue #52).
export const RESTART = 'restart_guard.py';
export const KIRO_HOOK = NAME + '-paste-filter.json';

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
 * present: managed, and a UserPromptSubmit command running the installed core in its kiro mode;
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
  const first = ours[0];
  const action = get(first, 'action');
  /** @param {unknown} v */
  const str = (v) => pyStr(v === undefined ? '' : v);
  const good = isDict(doc) && get(doc, 'version') === 'v1' && ours.length === 1
    && str(get(first, 'description')).includes(MARKER)
    && ['UserPromptSubmit', 'promptSubmit'].includes(/** @type {string} */ (get(first, 'trigger')))
    && isDict(action) && get(action, 'type') === 'command'
    && str(get(action, 'command')).includes(PASTE)
    && str(get(action, 'command')).includes('--harness kiro')
    && isFile(pathlibJoin(data, [PASTE]));
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
  const paste = isFile(pathlibJoin(data, [PASTE]));
  const adminPaste = isFile(pathlibJoin(adminBin, [PASTE]));
  /** @type {Record<string, string[] | string>} */
  const result = {};

  /** @type {string[]} */
  let found = [];
  let unread = false;
  let [doc, state] = readJson(inHome(env, '.claude', 'settings.json'));
  unread ||= state === 'not read';
  if (commands(doc, 'PreToolUse').some((c) => c.includes(GUARD))) found.push(LEFTOVER);
  if (restartRegistered(doc)) found.push(restartLeftover('Claude Code'));
  if (commands(doc, 'UserPromptSubmit').some((c) => c.includes(PASTE)) && paste) found.push('paste filter (Claude Code)');
  [doc, state] = readJson(pathlibJoin(codexHome(env), ['hooks.json']));
  unread ||= state === 'not read';
  if (restartRegistered(doc)) found.push(restartLeftover('Codex'));
  if (commands(doc, 'UserPromptSubmit').some((c) => c.includes(PASTE)) && paste) found.push('paste filter (Codex)');
  const [kiro, kstate] = kiroHookState(env, data);
  unread ||= kstate === 'not read';
  if (kiro) found.push(kiro);
  result.user = unread && !found.length ? 'not read' : [...found, ...(unread ? ['a file not read'] : [])];

  found = [];
  unread = false;
  [doc, state] = readJson(adminDropin(env));
  unread ||= state === 'not read';
  if (commands(doc, 'PreToolUse').some((c) => c.includes(GUARD))) found.push(LEFTOVER);
  if (restartRegistered(doc)) found.push(restartLeftover('Claude Code'));
  if (commands(doc, 'UserPromptSubmit').some((c) => c.includes(PASTE)) && adminPaste) found.push('paste filter (Claude Code)');
  const req = codexRequirements(env);
  let text = '';
  if (exists(req)) {
    const t = readText(req);
    if (t === null) unread = true;
    else text = t;
  }
  if (text.includes(MARKER) && text.includes('[[hooks.UserPromptSubmit') && text.includes(PASTE) && adminPaste) found.push('paste filter (Codex)');
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
