// The settings status reads from each agent harness's own files (#493, S22 of #470; moved from
// global/workstation.py): the session defaults each layer sets, the Claude Code plugins enabled, the
// working method and where the plugin duplicates it, and the pre-authorisation (permission mode and
// allow-list size). Read-only. node: modules only.
import { pathlibJoin, inHome, codexHome, readJson, readText, get, truthy, isDict, splitlines } from './common.js';
import { adminDropin } from './admin.js';
import { dumps, pyStrip, isPyWs, cmpStr, pyLen } from '../py.js';
import { inRanges } from '../clean.js';
import { WORD } from '../clean-unicode.js';

/** @typedef {import('./common.js').Env} Env */
/** @typedef {[string, string, string, string]} Setting [agent harness, layer, key, value] */

/** @param {string | undefined} ch one code point */
const isWord = (ch) => ch !== undefined && inRanges(WORD, /** @type {number} */ (ch.codePointAt(0)));

/** str.strip('"'). @param {string} s */
function stripQuotes(s) {
  let a = 0;
  let b = s.length;
  while (a < b && s[a] === '"') a++;
  while (b > a && s[b - 1] === '"') b--;
  return s.slice(a, b);
}

/**
 * re.match(r"""([A-Za-z_][\w-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^#\s]+))""", line) -> [key, value].
 * @param {string} line
 * @returns {[string, string] | null}
 */
export function tomlKey(line) {
  const cps = Array.from(line);
  if (!cps.length || !/[A-Za-z_]/.test(cps[0])) return null;
  let i = 1;
  while (i < cps.length && (isWord(cps[i]) || cps[i] === '-')) i++;
  const key = cps.slice(0, i).join('');
  while (i < cps.length && isPyWs(cps[i])) i++;
  if (cps[i] !== '=') return null;
  i++;
  while (i < cps.length && isPyWs(cps[i])) i++;
  const q = cps[i];
  if (q === '"' || q === "'") {
    const end = cps.indexOf(q, i + 1);
    if (end >= 0) return [key, cps.slice(i + 1, end).join('')];
    // No closing quote: the bare form, which may begin with the quote, is what matches.
  }
  const start = i;
  while (i < cps.length && cps[i] !== '#' && !isPyWs(cps[i])) i++;
  if (i === start) return null;
  return [key, cps.slice(start, i).join('')];
}

/**
 * Top-level string or bare values of the given keys in a TOML file, before its first table.
 * Not a TOML parser: enough for the few scalar keys a session default lives in.
 * @param {string} p
 * @param {string[]} keys
 * @returns {Record<string, string>}
 */
export function tomlTop(p, keys) {
  /** @type {Record<string, string>} */
  const out = {};
  const text = readText(p);
  if (text === null) return out;
  for (const raw of splitlines(text)) {
    const line = pyStrip(raw);
    if (line.startsWith('[')) break;
    const m = tomlKey(line);
    if (m && keys.includes(m[0])) out[m[0]] = m[1];
  }
  return out;
}

/** json.dumps(value).strip('"') of a scalar setting. @param {unknown} value */
function settingText(value) {
  return stripQuotes(dumps(value, { ensureAscii: true, sortKeys: false }));
}

/**
 * Session-default settings each layer sets, as [agent harness, layer, key, value]. Claude Code: user and
 * workspace settings.json (+ settings.local.json); Codex: user and workspace config.toml; Kiro: user and
 * workspace .kiro/settings/cli.json (chat.defaultModel). The admin layer is reported as a layer.
 * @param {Env} env
 * @param {string | null} wsRoot
 * @returns {Setting[]}
 */
export function readSettings(env, wsRoot) {
  /** @type {Setting[]} */
  const out = [];
  const claude = [['user', inHome(env, '.claude', 'settings.json')]];
  const codex = [['user', pathlibJoin(codexHome(env), ['config.toml'])]];
  if (wsRoot) {
    claude.push(['workspace', pathlibJoin(wsRoot, ['.claude', 'settings.json'])],
      ['workspace', pathlibJoin(wsRoot, ['.claude', 'settings.local.json'])]);
    codex.push(['workspace', pathlibJoin(wsRoot, ['.codex', 'config.toml'])]);
  }
  for (const [layer, p] of claude) {
    const [doc] = readJson(p);
    if (!isDict(doc)) continue;
    const permsRaw = get(doc, 'permissions');
    const perms = isDict(permsRaw) ? permsRaw : {};
    for (const [key, value] of /** @type {Array<[string, unknown]>} */ ([['model', get(doc, 'model')],
      ['effortLevel', get(doc, 'effortLevel')], ['permissions.defaultMode', get(perms, 'defaultMode')],
      ['disableAllHooks', get(doc, 'disableAllHooks')]])) {
      if (value !== null && value !== undefined && !isDict(value) && !Array.isArray(value)) {
        out.push(['Claude Code', layer, key, settingText(value)]);
      }
    }
  }
  for (const [layer, p] of codex) {
    const found = tomlTop(p, ['model', 'model_reasoning_effort', 'approval_policy', 'sandbox_mode']);
    for (const key of Object.keys(found).sort(cmpStr)) out.push(['Codex', layer, key, found[key]]);
  }
  const kiro = [['user', inHome(env, '.kiro', 'settings', 'cli.json')]];
  if (wsRoot) kiro.push(['workspace', pathlibJoin(wsRoot, ['.kiro', 'settings', 'cli.json'])]);
  for (const [layer, p] of kiro) {
    const [doc] = readJson(p);
    const model = get(doc, 'chat.defaultModel');
    if (typeof model === 'string') out.push(['Kiro', layer, 'chat.defaultModel', model]);
  }
  return out;
}

/**
 * Claude Code plugins enabled in the user settings, minus those a project settings file disables.
 * @param {Env} env
 * @param {string | null} wsRoot
 */
export function enabledPlugins(env, wsRoot) {
  /** @type {Map<string, boolean>} */
  const enabled = new Map();
  const sources = [inHome(env, '.claude', 'settings.json')];
  if (wsRoot) sources.push(pathlibJoin(wsRoot, ['.claude', 'settings.json']), pathlibJoin(wsRoot, ['.claude', 'settings.local.json']));
  for (const src of sources) {
    const [doc, state] = readJson(src);
    if (state !== 'read') continue;
    const plugins = get(doc, 'enabledPlugins');
    if (isDict(plugins)) {
      for (const [name, on] of Object.entries(/** @type {Record<string, unknown>} */ (plugins))) enabled.set(name, truthy(on));
    }
  }
  return [...enabled].filter(([, on]) => on).map(([n]) => n).sort(cmpStr);
}

export const METHOD_PLUGIN = 'tadeumendonca-skills';

/**
 * True when Codex's config.toml carries a [plugins."<name>@..."] section not set enabled = false.
 * @param {Env} env
 * @param {string} name
 */
export function codexPluginEnabled(env, name) {
  const text = readText(pathlibJoin(codexHome(env), ['config.toml']));
  if (text === null) return false;
  let found = false;
  let inside = false;
  for (const raw of splitlines(text)) {
    const s = pyStrip(raw);
    if (s.startsWith('[')) {
      inside = s === '[plugins.' + name + ']' || (s.startsWith('[plugins."' + name + '@') && s.endsWith('"]')
        && !s.slice(('[plugins."' + name + '@').length, -2).includes('"'));
      found = found || inside;
    } else if (inside && enabledFalse(s)) {
      return false;
    }
  }
  return found;
}

/** re.match(r"enabled\s*=\s*false\b", s). @param {string} s */
function enabledFalse(s) {
  const cps = Array.from(s);
  if (cps.slice(0, 7).join('') !== 'enabled') return false;
  let i = 7;
  while (i < cps.length && isPyWs(cps[i])) i++;
  if (cps[i] !== '=') return false;
  i++;
  while (i < cps.length && isPyWs(cps[i])) i++;
  if (cps.slice(i, i + 5).join('') !== 'false') return false;
  return !isWord(cps[i + 5]);
}

/**
 * The working method's state from install.sh --check, and where the plugin duplicates it (#61).
 * @param {Env} env
 * @param {string[]} userLines
 * @param {string[]} claudePlugins
 * @returns {{ installed: boolean | null, duplicate: string[] }}
 */
export function methodState(env, userLines, claudePlugins) {
  /** @type {boolean | null} */
  let installed = null;
  for (const line of userLines) {
    if (line.startsWith('METHOD  installed: ')) installed = true;
    else if (line.startsWith('METHOD  not installed')) installed = false;
  }
  /** @type {string[]} */
  const dup = [];
  if (claudePlugins.some((p) => p.split('@')[0] === METHOD_PLUGIN)) dup.push('Claude Code');
  if (codexPluginEnabled(env, METHOD_PLUGIN)) dup.push('Codex');
  return { installed, duplicate: installed ? dup : [] };
}

export const PROFILE = 'workstation';

/**
 * [mode, layer]: the first permissions.defaultMode found in precedence order, managed first.
 * @param {Env} env
 * @param {string | null} wsRoot
 */
export function claudeMode(env, wsRoot) {
  const layers = [['admin', adminDropin(env)]];
  if (wsRoot) {
    layers.push(['project local', pathlibJoin(wsRoot, ['.claude', 'settings.local.json'])],
      ['project', pathlibJoin(wsRoot, ['.claude', 'settings.json'])]);
  }
  layers.push(['user', inHome(env, '.claude', 'settings.json')]);
  for (const [name, p] of layers) {
    const [doc] = readJson(p);
    const mode = get(get(doc, 'permissions'), 'defaultMode');
    if (typeof mode === 'string') return [mode, name];
  }
  return ['default', 'none set'];
}

/** Python's len() of a parsed JSON value, or null where len() raises TypeError. @param {unknown} v */
function pyLength(v) {
  if (typeof v === 'string') return pyLen(v);
  if (Array.isArray(v)) return v.length;
  if (isDict(v)) return Object.keys(/** @type {object} */ (v)).length;
  return null;
}

/**
 * doc["toolsSettings"]["execute_bash"]["allowedCommands"] as Python indexed it: a dict's key, or null
 * where that raised KeyError or TypeError.
 * @param {unknown} doc
 */
function kiroAllowed(doc) {
  let cur = doc;
  for (const key of ['toolsSettings', 'execute_bash', 'allowedCommands']) {
    if (!isDict(cur) || !Object.hasOwn(/** @type {object} */ (cur), key)) return null;
    cur = /** @type {Record<string, unknown>} */ (cur)[key];
  }
  return cur;
}

/**
 * re.search(r'^sandbox_mode = "([^"]*)"', text, re.M): the first value, or null.
 * @param {string} text
 */
function sandboxMode(text) {
  const head = 'sandbox_mode = "';
  let i = 0;
  while (i <= text.length) {
    if (text.startsWith(head, i)) {
      const end = text.indexOf('"', i + head.length);
      if (end >= 0) return text.slice(i + head.length, end);
    }
    const nl = text.indexOf('\n', i);
    if (nl < 0) break;
    i = nl + 1;
  }
  return null;
}

/**
 * The pre-authorisation (Issue #83, ADR-0031): the permission mode in effect and the allow-list size,
 * read from the installed files. A command-line flag or a session-level change can still differ.
 * @param {Env} env
 * @param {string | null} wsRoot
 */
export function permissionsText(env, wsRoot) {
  const [mode, layer] = claudeMode(env, wsRoot);
  const [doc] = readJson(inHome(env, '.claude', 'settings.json'));
  const allow = get(get(doc, 'permissions'), 'allow');
  const nClaude = Array.isArray(allow) ? allow.length : 0;
  const home = codexHome(env);
  const rules = readText(pathlibJoin(home, ['rules', 'workstation-allow-list.rules']));
  const nCodex = rules === null ? 0 : splitlines(rules).filter((l) => l.endsWith('decision="allow")')).length;
  const profile = readText(pathlibJoin(home, [PROFILE + '.config.toml'])) ?? '';
  const sandbox = sandboxMode(profile);
  const codex = sandbox !== null
    ? 'profile ' + PROFILE + ' (on-request, ' + sandbox + '; with --profile ' + PROFILE + ')'
    : 'no ' + PROFILE + ' profile';
  const [kdoc] = readJson(inHome(env, '.kiro', 'agents', 'workstation.json'));
  const nKiro = pyLength(kiroAllowed(kdoc)) ?? 0;
  return 'Claude Code: ' + mode + ' (' + layer + '), ' + nClaude + ' allow rules · Codex: ' + codex + ', ' + nCodex +
    ' allow rules · Kiro: agent workstation, ' + nKiro + ' trusted commands';
}
