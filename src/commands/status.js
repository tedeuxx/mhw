// mhw status (#493, S22 of #470), moved from global/workstation.py: what is installed, which layers and
// protections, the version key, and the owner-action queue, each at the evidence level this view has.
//
//   mhw status [--verbose]              the status view
//   mhw status --summary                the session-start runtime summary an agent harness relays (#80)
//   (The MCP connection test, --mcp-connect until v11, is `mhw mcp check` since #595: status starts no process.)
//   Options: --overlay=DIR|none, --project=DIR (default: the git root of the current directory).
//
// Read-only. It runs `mhw install-user --check` (global/install.sh until #503) and, when an admin layer of ours is on disk,
// `mhw install-admin --check` on this node (global/install-managed.sh until #496), and summarises their lines; it renders nothing
// itself. The validated --overlay reaches the installers through WORKSTATION_OVERLAY, never their argv.
// git, gh and the agent harness CLIs are the first on PATH, run by absolute path (src/lib/onpath.js).
// Status never fails on what it reads: exit 0, 2 on a usage error.
// macOS and Linux; on Windows `mhw status` is `mhw install-windows --check` after its NODE and PASTE lines (src/cli.js, #497). node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NAME, KEY_FILE, MARKER, inHome, codexHome, managedRoot, isFile, readText, runLines, resolvePath, homeOf,
  readJson, get, pathlibJoin } from '../lib/readers/common.js';
import { keyVerdict, readKey, mismatchLine } from '../lib/readers/version-key.js';
import { adminDropin, adminState, adminInstalled, adminPresent, adminStamp, adminReport, issues, leadingWord } from '../lib/readers/admin.js';
import { readHooks, hooksText, hookNodeText, termListsState } from '../lib/readers/hooks.js';
import { readSettings, enabledPlugins, methodState, permissionsText, unreadSources, METHOD_PLUGIN } from '../lib/readers/settings.js';
import { workspace } from '../lib/readers/workspace.js';
import { harnessVersions, runtime } from '../lib/readers/host.js';
import * as ownerActions from '../lib/readers/owner-actions.js';
import { statusText as chromeStatus, systemName } from '../render/chrome-debugging.js';
import { cmpStr, isPyWs } from '../lib/py.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export { MARKER };

/** @typedef {import('../lib/readers/common.js').Env} Env */
/** @typedef {import('../lib/readers/settings.js').Setting} Setting */
/** @typedef {import('../lib/readers/workspace.js').Workspace} Workspace */
/**
 * @typedef {{ source: string, user_stamps: Record<string, string>, admin: boolean, admin_stamp: string,
 *   user_issues: number, admin_issues: number, user_lines: string[], admin_lines: string[],
 *   harnesses: Record<string, string | null>, workspace: Workspace, plugins: string[], brief: string,
 *   floor: string, hooks: string, key: { required: string, state: string, line: string } | null,
 *   runtime: string, admin_state?: string, admin_code?: number, settings?: Setting[], permissions?: string,
 *   method?: { installed: boolean | null, duplicate: string[], unread?: string }, npm?: string[], chrome_debugging?: string | null,
 *   unread?: import('../lib/readers/settings.js').Unread[],
 *   owner_actions?: string, hook_node?: string, terms?: [boolean, string] }} Facts
 *   hook_node, terms: #488 (the prompt hook's node, and the term lists the salt file does not cover)
 */

/** An npm install of this repository (Issue #68, ADR-0034): package.json present, no .git. @param {string} root */
export function npmPackage(root = ROOT) {
  return isFile(path.join(root, 'package.json')) && !fs.existsSync(path.join(root, '.git'));
}

/**
 * The words that depend on how this copy was installed: the command an instruction names (mhw after an
 * npm install, ./mhw in a checkout) and what the installed targets are compared with.
 * @param {string} root
 */
export function wordsOf(root = ROOT) {
  const npm = npmPackage(root);
  const cmd = npm ? 'mhw' : './mhw';
  return { npm, cmd, fix: cmd + ' install', source: npm ? 'this package' : 'this checkout',
    adminNext: 'next: ' + cmd + ' install (it asks for your administrator password once)' };
}

let W = wordsOf();
/** Tests only: render as another copy would (a checkout or a package). @param {string} root */
export function useWordsOf(root) {
  W = wordsOf(root);
  return W;
}
export const words = () => W;

export const LEGACY = 'installed (legacy, pre-#66; reinstall to update)';
export const ADMIN_FLOOR = 'the admin layer';
export const LEGACY_PACKAGE = NAME;
export const UPGRADE_FIRST = 'remove the v4.1.0 package first: `npm uninstall -g ' + LEGACY_PACKAGE + '`';
export const NOT_RUN = 'installed by npm; the workstation is not set up from it yet';
export const MCP_ACTIVE_TAG = '(MCP active set)';
export const MCP_INDENT = ' '.repeat(19);
export const MODELS_TAG = '(model defaults ';
// Where each agent harness shows what this view cannot see (the session's model, effort and flags).
/** @type {Record<string, string>} */
export const NATIVE_VIEW = { 'Claude Code': '/status', Codex: '/status', Kiro: '/context show, /tools' };
/** @type {Record<string, string[]>} */
export const MODE_KEYS = { 'Claude Code': ['permissions.defaultMode'], Codex: ['approval_policy', 'sandbox_mode'] };
/** @type {Record<string, string[]>} */
export const MODEL_KEYS = { 'Claude Code': ['model', 'effortLevel'], Codex: ['model', 'model_reasoning_effort'], Kiro: ['chat.defaultModel'] };

// ---------------------------------------------------------------------------------------------------
// Stamps.

/**
 * re.fullmatch(r"release: (.*); commit: (\S+)", s) -> [release, commit], or null. The release is the
 * longest that leaves a commit of non-whitespace.
 * @param {string} s
 * @returns {[string, string] | null}
 */
function stampParts(s) {
  if (!s.startsWith('release: ') || s.includes('\n')) return null;
  const sep = '; commit: ';
  for (let j = s.lastIndexOf(sep); j >= 'release: '.length; j = j > 0 ? s.lastIndexOf(sep, j - 1) : -1) {
    const commit = s.slice(j + sep.length);
    if (commit && !Array.from(commit).some((c) => isPyWs(c))) return [s.slice('release: '.length, j), commit];
    if (j === 0) break;
  }
  return null;
}

/** 'release: v3.1.0; commit: <40 hex>' -> 'v3.1.0 @ <7 hex>'; anything else unchanged. @param {string | null | undefined} stamp */
export function shortStamp(stamp) {
  if (!stamp || stamp === 'none') return 'none';
  const m = stampParts(stamp);
  if (!m) return stamp;
  let commit = m[1];
  if (/^[0-9a-f]{40}/.test(commit)) commit = commit.slice(0, 7) + commit.slice(40);
  return m[0] + ' @ ' + commit;
}

/** The release field of a stamp, or the stamp itself ('none' when empty). @param {string | null | undefined} stamp */
export function releaseOf(stamp) {
  const m = stampParts(stamp || '');
  return m ? m[0] : (stamp || 'none');
}

/**
 * The release and commit of the first managed-by line in a file, or 'none'.
 * @param {string} p
 */
export function stampIn(p) {
  let raw;
  try {
    raw = fs.readFileSync(p);
  } catch {
    return 'none';
  }
  // errors="replace", universal newlines: a line ends at \n, \r or \r\n.
  const text = raw.toString('utf8');
  for (const line of text.split(/\r\n|\r|\n/)) {
    if (line.includes(MARKER)) {
      const m = /; (release: [^;"]*; commit: [^;"]*);/.exec(line);
      return m ? m[1] : 'none';
    }
  }
  return 'none';
}

/** The three user-level briefs. @param {Env} env @returns {Record<string, string>} */
export function briefPaths(env) {
  return { 'Claude Code': inHome(env, '.claude', 'CLAUDE.md'), Codex: pathlibJoin(codexHome(env), ['AGENTS.md']),
    Kiro: inHome(env, '.kiro', 'steering', 'workstation-global-brief.md') };
}

/** @param {Iterable<string>} values */
const sortedSet = (values) => [...new Set(values)].sort(cmpStr);

// ---------------------------------------------------------------------------------------------------
// The status view: pure, from a facts object gathered below.

/**
 * The MCP active set as the user-layer --check reported it: every server on outside the set, every set
 * member missing on an agent harness, and what has no native switch. Names and counts only.
 * @param {Facts} f
 */
export function mcpActiveLines(f) {
  const head = '  mcp active set   ';
  const hits = (f.user_lines || []).filter((l) => l.endsWith(MCP_ACTIVE_TAG));
  if (!hits.length) return [head + 'not read (the check printed no MCP active-set line)'];
  const skip = 'SKIP    MCP active set: ';
  for (const line of hits) {
    if (line.startsWith(skip)) return [head + line.slice(skip.length, line.length - (' ' + MCP_ACTIVE_TAG).length)];
  }
  /** @type {string[]} */
  const findings = [];
  /** @type {string[]} */
  const unread = [];
  let drift = 0;
  for (const line of hits) {
    const m = activeLine(line);
    if (m && ['DRIFT', 'REPORT', 'ABSENT', 'REFUSE'].includes(m[0])) {
      findings.push(m[1] + ': ' + m[2]);
      drift += m[0] === 'DRIFT' ? 1 : 0;
    } else if (m && m[0] === 'SKIP' && !m[2].startsWith('not installed')) {
      // An agent harness installed here whose files were not read: its servers are unknown (#222 lens).
      unread.push(m[1]);
      findings.push(m[1] + ': not read: ' + m[2]);
    }
  }
  const prefix = unread.length ? 'not read for ' + unread.join(', ') + '; ' : '';
  if (!findings.length) return [head + 'declared; nothing on outside the set and no set member missing'];
  if (findings.length === unread.length) return [head + 'declared; ' + rstripChars(prefix, '; '), ...findings.map((x) => MCP_INDENT + x)];
  const fix = drift ? '; ' + W.fix + ' turns off what is on outside the set in ' + drift + ' agent harness(es)' : '';
  return [head + prefix + (findings.length - unread.length) + ' finding(s)' + fix, ...findings.map((x) => MCP_INDENT + x)];
}

/** str.rstrip(chars). @param {string} s @param {string} chars */
function rstripChars(s, chars) {
  let end = s.length;
  while (end > 0 && chars.includes(s[end - 1])) end--;
  return s.slice(0, end);
}

/**
 * re.match(r"^([A-Z]+)\s+(\S+): (.*) \([^()]*\) \(MCP active set\)$", line) -> [word, surface, text].
 * @param {string} line
 * @returns {[string, string, string] | null}
 */
export function activeLine(line) {
  const cps = Array.from(line);
  let i = 0;
  while (i < cps.length && cps[i] >= 'A' && cps[i] <= 'Z') i++;
  if (i === 0 || !isPyWs(cps[i])) return null;
  const word = cps.slice(0, i).join('');
  while (i < cps.length && isPyWs(cps[i])) i++;
  const start = i;
  while (i < cps.length && !isPyWs(cps[i])) i++;
  // (\S+): the run of non-whitespace must end in ':' and be followed by one space.
  if (i - start < 2 || cps[i - 1] !== ':' || cps[i] !== ' ') return null;
  const surface = cps.slice(start, i - 1).join('');
  const body = cps.slice(i + 1).join('');
  const tail = ' ' + MCP_ACTIVE_TAG;
  if (!body.endsWith(tail)) return null;
  const s = body.slice(0, body.length - tail.length);
  if (!s.endsWith(')')) return null;
  const open = s.lastIndexOf('(');
  if (open < 1 || s[open - 1] !== ' ' || /[()]/.test(s.slice(open + 1, -1))) return null;
  return [word, surface, s.slice(0, open - 1)];
}

/**
 * [value, layer] of the lowest layer that sets the key (workspace beats user), or null.
 * @param {Setting[]} settings @param {string} harness @param {string} key
 * @returns {[string, string] | null}
 */
function setting(settings, harness, key) {
  /** @type {[string, string] | null} */
  let found = null;
  for (const [h, layer, k, value] of settings) {
    if (h === harness && k === key && (found === null || layer === 'workspace')) found = [value, layer];
  }
  return found;
}

/**
 * @param {Setting[]} settings @param {Record<string, string[]>} keysBy @param {string[]} harnesses
 * @param {import('../lib/readers/settings.js').Unread[]} [unread] the sources there and not readable
 */
export function settingsText(settings, keysBy, harnesses, unread = []) {
  /** @type {string[]} */
  const parts = [];
  for (const h of harnesses) {
    const missed = unread.filter((u) => u.harness === h).map((u) => u.reason);
    const notRead = missed.length ? 'not read (' + missed.join('; ') + ')' : '';
    const keys = keysBy[h] || [];
    /** @type {string[]} */
    const values = [];
    for (const key of keys) {
      const hit = setting(settings, h, key);
      if (hit) values.push(key + ' ' + hit[0] + ' (' + hit[1] + ')');
    }
    if (!keys.length) parts.push(h + ': not read by this view');
    else if (values.length) parts.push(h + ': ' + values.join(', ') + (notRead ? ', ' + notRead : ''));
    else parts.push(h + ': ' + (notRead || 'default'));
  }
  return parts.join(' · ');
}

/**
 * The session-start model and effort in effect per agent harness (a workspace value beats the user one),
 * and whether the user layer matches the versioned policy, as the user-layer --check reported it.
 * @param {Facts} f
 */
export function modelsText(f) {
  const settings = f.settings || [];
  const values = settingsText(settings, MODEL_KEYS, Object.keys(MODEL_KEYS), f.unread);
  const overridden = settings.filter(([h, layer, k]) => layer === 'workspace' && (MODEL_KEYS[h] || []).includes(k)).map(([h, , k]) => h + ' ' + k);
  const override = overridden.length ? '; overridden by the workspace: ' + overridden.join(', ') : '';
  const lines = (f.user_lines || []).filter((l) => l.includes(MODELS_TAG));
  if (!lines.length) return values + '; policy: none (no model-defaults.json in the overlay)' + override;
  const differ = lines.filter((l) => !l.startsWith('OK'));
  if (!differ.length) return values + '; policy: ' + (overridden.length ? 'user layer matches' : 'matches') + override;
  // Issue #145: install writes the pinned value whatever the key holds, so a differing harness is a
  // pending write for `mhw install`, never a value of the owner's held back from it.
  return values + '; policy: ' + differ.length + ' harness(es) differ; mhw install sets them' + override;
}

/** The managed layer as a layer list shows it. Never 'absent' while a drop-in of ours is present. @param {Facts} f */
export function managedText(f) {
  if (f.admin) return 'installed';
  return /** @type {Record<string, string>} */ ({ legacy: LEGACY, unreadable: 'present, not read' })[f.admin_state || ''] || 'absent';
}

/**
 * Only what sits in the admin layer can be named here. The floor's own words come from the installer,
 * verbatim: a user-level floor is dropped by a session flag, so it is never listed as locked.
 * @param {Facts} f
 */
export function cannotOverride(f) {
  const admin = f.admin || ['legacy', 'unreadable'].includes(f.admin_state || '');
  if (f.floor.startsWith(ADMIN_FLOOR)) return ['managed layer (admin-owned)', 'deny floor: ' + f.floor].join(' · ');
  const parts = admin ? ['managed layer (admin-owned)'] : ['nothing (no admin layer)'];
  parts.push('deny floor NOT locked: ' + f.floor);
  return parts.join(' · ');
}

// Issue #38: the summary names --check drift by CATEGORY only, never a path or a file's content.
const DRIFT_CATEGORIES = /** @type {Array<[string, string[]]>} */ ([
  ['paste wrapper', ['paste']],
  ['allow list', ['allow list', 'permissions.allow', 'allow-list']],
  ['deny floor', ['deny-floor', 'deny floor', '/.claude/settings.json', 'permissions.yaml', 'managed-settings', 'requirements.toml']],
  ['hooks', ['hooks.json', 'clipboard', 'hook', 'pattern-check']], // pattern-check: the fixed-pattern check's files (#588)
  ['MCP', ['mcp', 'claude.json', 'codex:', 'kiro:', 'claude-code:']],
  ['models', ['model']],
  ['method', ['/skills/', '/agents/', '/commands/', '/prompts/', '/method/']],
]);
const DRIFT_WORDS = ['DRIFT', 'MISSING', 'STALE', 'REFUSE', 'STAMP'];

/**
 * The category of one --check problem line: removed controls, brief, paste wrapper, ..., or other.
 * @param {string} line
 * @param {Env} env
 */
export function driftCategory(line, env) {
  if (line.startsWith('STALE')) return 'removed controls';
  if (Object.values(briefPaths(env)).some((p) => line.includes(p))) return 'brief';
  const low = line.toLowerCase();
  for (const [name, needles] of DRIFT_CATEGORIES) {
    if (needles.some((n) => low.includes(n.toLowerCase()))) return name;
  }
  return 'other';
}

/**
 * The stamp a STAMP line says its target carries, short, or 'another source'.
 * re.search(r"(?:carries|recorded under) \(([^()]*)\)", line).
 * @param {string} line
 */
export function stampOrigin(line) {
  for (let i = 0; i < line.length; i++) {
    for (const w of ['carries (', 'recorded under (']) {
      if (!line.startsWith(w, i)) continue;
      const from = i + w.length;
      let j = from;
      while (j < line.length && line[j] !== '(' && line[j] !== ')') j++;
      if (line[j] === ')') {
        const g = line.slice(from, j);
        return g !== 'none' ? shortStamp(g) : 'another source';
      }
    }
  }
  return 'another source';
}

/**
 * 'drift: <n> target(s) in <categories>' for content drift and, apart from it (Issue #453), 'stamp: <n>
 * target(s) from <other source>', then ' — next: <CMD> install'; '' when both layers are clean.
 * @param {string[]} userLines @param {string[]} adminLines @param {number} adminCode @param {Env} env
 */
export function driftText(userLines, adminLines, adminCode, env) {
  /** @type {string[]} */
  const cats = [];
  /** @type {string[]} */
  const origins = [];
  let count = 0;
  let stamped = 0;
  for (const [prefix, lines] of /** @type {Array<[string, string[]]>} */ ([['', userLines], ['admin ', adminLines]])) {
    const hits = lines.filter((l) => leadingWord(l, DRIFT_WORDS));
    const stamps = hits.filter((l) => l.startsWith('STAMP'));
    /** @type {Array<string | null>} */
    let content = hits.filter((l) => !l.startsWith('STAMP'));
    let names;
    if (prefix && !hits.length && adminCode) {
      content = [null];
      names = ['admin layer'];
    } else {
      names = content.map((l) => prefix + driftCategory(/** @type {string} */ (l), env));
    }
    count += content.length;
    for (const n of names) if (!cats.includes(n)) cats.push(n);
    stamped += stamps.length;
    for (const l of stamps) {
      const o = prefix + stampOrigin(l);
      if (!origins.includes(o)) origins.push(o);
    }
  }
  /** @type {string[]} */
  const parts = [];
  if (count) parts.push('drift: ' + count + ' target(s) in ' + cats.join(', '));
  if (stamped) parts.push('stamp: ' + stamped + ' target(s) from ' + origins.join(' / ') + ', content matches');
  if (!parts.length) return '';
  return parts.join('; ') + ' — next: ' + W.cmd + ' install';
}

/** The source --check compared with (Issue #453): 'package <stamp>' or 'checkout <stamp>'. @param {string} source */
export function sourceText(source) {
  const word = W.source.split(' ');
  return word[word.length - 1] + ' ' + shortStamp(source);
}

/**
 * The Claude Code plugin count, with the settings files there and not readable named.
 * @param {Facts} f @param {string} suffix @param {string} none
 */
function pluginWords(f, suffix, none) {
  const missed = (f.unread || []).filter((u) => u.harness === 'Claude Code').map((u) => u.reason);
  const notRead = missed.length ? 'not read (' + missed.join('; ') + ')' : '';
  if (f.plugins.length) return f.plugins.length + suffix + (notRead ? ', ' + notRead : '');
  return notRead || none;
}

/** @param {{ installed: boolean | null, duplicate: string[], unread?: string } | undefined} m */
export function methodText(m) {
  if (!m || m.installed === null) return 'not reported';
  if (!m.installed) return 'not installed (opt-in: ' + W.cmd + ' install --method, until the plugin cutover #63 #64)';
  let text = 'installed in the user layer';
  if (m.duplicate.length) {
    text += '; DUPLICATE: the ' + METHOD_PLUGIN + ' plugin is also enabled in ' + m.duplicate.join(' and ') +
      ', so every agent, skill and command appears twice and its hooks refuse the bare-named agents; ' + W.cmd +
      ' install --method retires it at user scope (#130), and a project that enables it changes its own settings';
  }
  if (m.unread) text += '; whether the plugin is also enabled in Codex is not read (' + m.unread + ')';
  return text;
}

/**
 * The status view. Short by default; verbose adds the per-target lines and versions.
 * @param {Facts} f
 * @param {boolean} [verbose]
 */
export function renderStatus(f, verbose = false) {
  const lines = ['Workstation status'];
  lines.push('  source           ' + shortStamp(f.source) + ' (' + W.source + ')');
  const user = sortedSet(Object.values(f.user_stamps));
  const userText = user.length ? user.map(shortStamp).join(' / ') : 'none';
  const adminText = f.admin ? shortStamp(f.admin_stamp) : (f.admin_state === 'legacy' ? LEGACY : 'not installed');
  lines.push('  installed        user: ' + userText + ' · admin: ' + adminText);
  const adminCode = f.admin_code || 0;
  const adminFix = Math.max(f.admin_issues, adminCode ? 1 : 0);
  const fix = f.user_issues + adminFix;
  let check;
  if (fix === 0) check = 'matches ' + W.source;
  else if (adminFix) check = fix + ' target(s) differ (admin layer: ' + adminFix + '); run ' + W.fix;
  else check = fix + ' target(s) differ; run ' + W.fix;
  lines.push('  check            ' + check);
  lines.push(...adminReport(f.admin_lines, adminCode, '  admin layer      ', { source: W.source, next: W.adminNext }));
  if (!f.admin && (f.admin_state ?? 'absent') === 'absent' && !f.admin_lines.length) {
    // Repeats the step a missed npm postinstall printed (Issue #68): absent is a next step, not silence.
    lines.push('  admin layer      not installed; ' + W.adminNext);
  }
  const harnesses = Object.entries(f.harnesses).filter(([, v]) => v !== null).map(([h]) => h);
  lines.push('  agent harnesses  ' + (harnesses.length ? harnesses.join(', ') : 'none detected on PATH'));
  const ws = f.workspace;
  const wsText = ws.name ? ws.name + ' (' + (ws.carriers.length ? ws.carriers.join(', ') : 'no carrier') + ')' : 'none (not in a git repository)';
  const plugins = f.plugins;
  const pluginText = pluginWords(f, ' enabled in Claude Code', 'none enabled in Claude Code');
  lines.push('  layers           managed: ' + managedText(f) + ' · user: ' + (user.length ? 'installed' : 'absent') +
    ' · workspace: ' + wsText + ' · plugin: ' + pluginText);
  for (const finding of ws.brief || []) lines.push('  root brief       ' + finding);
  lines.push('  protections      brief: ' + f.brief + ' · deny floor: ' + f.floor + ' · hooks registered: ' + f.hooks);
  // #488: the node the prompt hook runs, and any hashed term list the salt file does not cover.
  lines.push('  hook node        ' + (f.hook_node ?? 'not read'));
  lines.push('  term lists       ' + (f.terms ? f.terms[1] : 'not read'));
  lines.push('  method           ' + methodText(f.method));
  lines.push('  models           ' + modelsText(f));
  lines.push(...mcpActiveLines(f));
  if (f.chrome_debugging) lines.push('  chrome debugging ' + f.chrome_debugging);
  if (f.permissions) lines.push('  permissions      ' + f.permissions);
  const key = f.key;
  if (key === null) lines.push('  version key      none (' + KEY_FILE + ' absent in the workspace)');
  else {
    lines.push('  version key      ' + key.required + ': ' + key.state);
    if (key.line) lines.push('                   ' + key.line);
  }
  lines.push('  runtime          ' + f.runtime);
  if (f.owner_actions) lines.push('  owner actions    ' + f.owner_actions + ' · label ' + ownerActions.LABEL + ' in ' + ownerActions.REPO);
  for (const note of f.npm || []) lines.push('  npm              ' + note);
  lines.push('  evidence         installed is the most this view observes; loaded and enforced need a session canary');
  if (verbose) {
    for (const [h, layer, k, value] of f.settings || []) lines.push('  setting          ' + h + ' ' + layer + ': ' + k + ' = ' + value);
    for (const [h, v] of Object.entries(f.harnesses)) lines.push('  agent harness    ' + h + ': ' + (v !== null ? v : 'not on PATH'));
    for (const p of plugins) lines.push('  plugin           ' + p);
    for (const line of [...f.user_lines, ...f.admin_lines]) lines.push('  | ' + line);
  }
  return lines;
}

/**
 * At most ten lines: what is in effect, each item at the evidence level this view has (Issue #80).
 * @param {Facts} f
 * @param {Env} env
 */
export function renderSummary(f, env) {
  const present = Object.entries(f.harnesses).filter(([, v]) => v !== null).map(([h]) => h);
  const shown = present.length ? present : Object.keys(f.harnesses);
  const settings = f.settings || [];
  const lines = ['Runtime summary (' + W.cmd + ' status --summary; detail: ' + W.cmd + ' status --verbose)'];
  lines.push('  agent harness    ' + (present.length ? present.map((h) => h + ' ' + f.harnesses[h]).join(' · ') : 'none detected on PATH'));
  lines.push('  model, effort    ' + settingsText(settings, MODEL_KEYS, shown, f.unread) + "; the session's own values: " +
    shown.map((h) => h + ' ' + NATIVE_VIEW[h]).join(', '));
  const user = sortedSet(Object.values(f.user_stamps));
  const stamp = user.length ? user.map(shortStamp).join(' / ') : 'none';
  const key = f.key;
  const keyText = key === null ? 'no ' + KEY_FILE + ' in the workspace' : key.required + ' ' + key.state;
  const owner = f.owner_actions ? ' · owner actions: ' + f.owner_actions : '';
  lines.push('  workstation      ' + stamp + ' · source: ' + sourceText(f.source || 'none') + ' · version key: ' + keyText + owner);
  const ws = f.workspace;
  // The root-brief check rides on the workspace item, so the summary keeps its ten-line limit.
  const brief = (ws.brief || []).length;
  const wsText = brief ? ws.name + ' (root brief: ' + brief + ' finding(s); ' + W.cmd + ' status)' : ws.name;
  lines.push('  layers           managed: ' + managedText(f) + ' · user: ' + (user.length ? 'installed' : 'absent') +
    ' · workspace: ' + (wsText || 'none') + ' · plugin: ' + pluginWords(f, ' in Claude Code', 'none'));
  const overrides = settings.filter(([, layer]) => layer === 'workspace').map(([h, , k, v]) => h + ' ' + k + ' = ' + v);
  const off = settings.filter(([, , k, v]) => k === 'disableAllHooks' && v === 'true').map(([h, layer]) => h + ' ' + layer);
  if (off.length) overrides.unshift('HOOKS OFF: disableAllHooks in ' + off.join(', '));
  for (const u of (f.unread || []).filter((x) => x.layer === 'workspace')) overrides.push(u.harness + ' not read (' + u.reason + ')');
  lines.push('  overrides        ' + (overrides.length ? overrides.join('; ') : 'no workspace setting overrides a user default'));
  lines.push('  cannot override  ' + cannotOverride(f));
  // The installers' --check drift rides on the protections item (Issue #38).
  const drift = driftText(f.user_lines || [], f.admin_lines || [], f.admin_code || 0, env);
  // #488: a term list the salt no longer covers rides on the protections item too, so it is never silent.
  const terms = f.terms && !f.terms[0] ? ' · TERMS ' + f.terms[1] : '';
  lines.push('  protections      brief ' + f.brief + ' · hooks ' + f.hooks + (drift ? ' · ' + drift : '') + terms +
    ' · evidence: installed; loaded and enforced need a session canary');
  lines.push('  permission mode  ' + settingsText(settings, MODE_KEYS, shown, f.unread) + '; session flags: ' +
    shown.map((h) => h + ' ' + NATIVE_VIEW[h]).join(', '));
  lines.push('  runtime          ' + f.runtime);
  if (key !== null && key.line) lines.push('  ' + key.line);
  for (const note of f.npm || []) lines.push('  npm              ' + note);
  return lines;
}

// ---------------------------------------------------------------------------------------------------
// Facts gathering: reads installed files and runs the installers' own --check.

/** @param {string[]} lines @param {Env} env */
function summariseProtections(lines, env) {
  const briefs = Object.values(briefPaths(env));
  const brief = lines.filter((l) => (l.startsWith('OK') || l.startsWith('STAMP')) && briefs.some((p) => l.includes(p))).length;
  let floor = 'not reported';
  for (const l of lines) if (l.startsWith('FLOOR   carried by: ')) floor = l.slice('FLOOR   carried by: '.length);
  return { brief: 'installed in ' + brief + '/3 agent harnesses (an instruction)', floor, hooks: hooksText(readHooks(env)) };
}

/**
 * The release the version key is compared with: the one release every user-level brief carries, 'none'
 * when none carries a stamp, and 'mixed' when they carry different stamps, which matches no range.
 * @param {Record<string, string>} userStamps
 */
export function keyRelease(userStamps) {
  const stamps = sortedSet(Object.values(userStamps));
  if (stamps.length === 1) return releaseOf(stamps[0]);
  return stamps.length ? 'mixed' : 'none';
}

/** The version of the package at root ('v1.2.3'), or why not. @param {string} root */
function packageVersion(root) {
  const [doc, state] = readJson(path.join(root, 'package.json'));
  if (state !== 'read') return '(version not read)';
  const v = get(doc, 'version');
  return 'v' + (v === undefined ? '?' : String(v));
}

/**
 * Lines about the npm install itself; none for a checkout (Issue #68). A package `mhw install` has not
 * set up yet, and the v4.1.0 package, under its old name, still installed beside mhw.
 * @param {string} source @param {Record<string, string>} userStamps @param {string} root
 */
export function npmNotes(source, userStamps, root = ROOT) {
  if (!npmPackage(root)) return [];
  /** @type {string[]} */
  const out = [];
  const stamps = sortedSet(Object.values(userStamps));
  if (!stamps.includes(source)) {
    out.push(NOT_RUN + ': this package is ' + shortStamp(source) + ', the user layer carries ' +
      (stamps.length ? stamps.map(shortStamp).join(' / ') : 'nothing') + '; run mhw install');
  }
  const parent = path.dirname(root);
  const old = path.join(parent, LEGACY_PACKAGE);
  if (path.basename(parent) === 'node_modules' && path.basename(root) !== LEGACY_PACKAGE && isFile(path.join(old, 'package.json'))) {
    out.push('the ' + packageVersion(old) + ' package (the name before mhw) is still installed beside mhw; ' + UPGRADE_FIRST +
      ', then run mhw update (the user layer stays)');
  }
  return out;
}


/**
 * Everything the two views print, read from the installed files and the installers' --check.
 * @param {string | null} project
 * @param {Env} env the environment the children get (MHW_CMD and the overlay already set)
 * @param {string} cwd
 * @returns {Facts}
 */
export function gather(project, env, cwd) {
  const admin = adminInstalled(env);
  const managedState = adminState(env);
  const hooksMode = admin ? 'managed' : 'user';
  // The user layer's --check is `mhw install-user` on this node (#503; global/install.sh until then).
  const userArgs = [path.join(ROOT, 'bin', 'mhw.js'), 'install-user', '--check', '--hooks=' + hooksMode];
  if (managedRoot(env)) userArgs.push('--managed-root=' + managedRoot(env));
  const [, userLines] = runLines(process.execPath, userArgs, env);
  let source = 'none';
  for (const l of userLines) if (l.startsWith('SOURCE  ')) source = l.slice('SOURCE  '.length);
  /** @type {string[]} */
  let adminLines = [];
  let adminCode = 0;
  // The admin layer's --check is `mhw install-admin` on this node (#496; global/install-managed.sh until then).
  const adminArgs = [path.join(ROOT, 'bin', 'mhw.js'), 'install-admin', '--check'];
  if (managedRoot(env)) adminArgs.push('--root=' + managedRoot(env));
  if (adminPresent(env)) [adminCode, adminLines] = runLines(process.execPath, adminArgs, env);
  const stamp = admin ? adminStamp(env) : 'none';
  /** @type {Record<string, string>} */
  const userStamps = {};
  for (const [h, p] of Object.entries(briefPaths(env))) {
    const s = stampIn(p);
    if (s !== 'none') userStamps[h] = s;
  }
  const ws = workspace(project, env, cwd);
  let key = null;
  if (ws.root && isFile(path.join(ws.root, KEY_FILE))) {
    // Python read it as UTF-8 and stopped on bytes that are not; here they read as U+FFFD (declared).
    const raw = fs.readFileSync(path.join(ws.root, KEY_FILE)).toString('utf8').replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const required = readKey(raw);
    const release = keyRelease(userStamps);
    const [state, line] = keyVerdict(required, release);
    key = { required: required || '(empty)', state, line };
  }
  const { brief, floor, hooks } = summariseProtections(userLines, env);
  const plugins = enabledPlugins(env, ws.root);
  return {
    source, user_stamps: userStamps, admin, admin_stamp: stamp,
    user_issues: issues(userLines), admin_issues: issues(adminLines),
    user_lines: userLines, admin_lines: adminLines, harnesses: harnessVersions(env),
    workspace: ws, plugins, brief, floor, hooks, hook_node: hookNodeText(env), terms: termListsState(env), key, runtime: runtime(env), admin_state: managedState,
    admin_code: adminCode, settings: readSettings(env, ws.root), unread: unreadSources(env, ws.root),
    permissions: permissionsText(env, ws.root),
    method: methodState(env, userLines, plugins), npm: npmNotes(source, userStamps),
    chrome_debugging: chromeStatus(systemName(), homeOf(env)),
    owner_actions: ownerActions.text(ownerActions.read({ env })),
  };
}

// ---------------------------------------------------------------------------------------------------
// The command.

export const OVERLAY_ENV = 'WORKSTATION_OVERLAY';

/**
 * The --overlay value an installer may receive: 'none', or an existing directory as an absolute,
 * resolved path. Anything else is null, and status refuses before anything runs.
 * @param {string} value @param {Env} env @param {string} cwd
 */
export function validOverlay(value, env, cwd) {
  if (value === 'none') return value;
  if (!value || value.startsWith('-') || value.includes('\0')) return null;
  let p = value;
  if (p === '~' || p.startsWith('~/')) p = homeOf(env) + p.slice(1);
  const resolved = resolvePath(path.resolve(cwd, p));
  try {
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

/**
 * @param {string[]} argv the arguments after `status`
 * @param {Env} env
 * @param {{ cwd?: string, out?: (line: string) => void, err?: (line: string) => void }} [o]
 * @returns {number}
 */
export function main(argv, env, o = {}) {
  const out = o.out || ((/** @type {string} */ l) => fs.writeSync(1, l + '\n'));
  const err = o.err || ((/** @type {string} */ l) => fs.writeSync(2, l + '\n'));
  const cwd = o.cwd || process.cwd();
  /** @type {string | null} */
  let overlay = null;
  /** @type {string | null} */
  let project = null;
  let verbose = false;
  let summary = false;
  for (const arg of argv) {
    if (arg.startsWith('--overlay=')) overlay = arg.slice('--overlay='.length);
    else if (arg.startsWith('--project=')) project = arg.slice('--project='.length);
    else if (arg === '-v' || arg === '--verbose') verbose = true;
    else if (arg === '--summary') summary = true;
    else if (arg === '--mcp-connect' || arg.startsWith('--mcp-connect=')) {
      // Removed in v11 (#595): the connection test starts processes, and status never does.
      err('mhw: unknown argument for status: ' + arg + ' (the MCP connection test is now mhw mcp check [--timeout=SECONDS])');
      return 2;
    } else {
      err('mhw: unknown argument for status: ' + arg);
      return 2;
    }
  }
  // The installers' messages name the same command this process was reached by (Issue #68).
  /** @type {Env} */
  const child = { ...env, MHW_CMD: W.cmd, MHW_NODE: process.execPath };
  if (overlay !== null) {
    const valid = validOverlay(overlay, env, cwd);
    if (valid === null) {
      err("mhw: --overlay takes 'none' or an existing directory");
      return 2;
    }
    child[OVERLAY_ENV] = valid;
  }
  const facts = gather(project, child, cwd);
  for (const line of summary && !verbose ? renderSummary(facts, child) : renderStatus(facts, verbose)) out(line);
  return 0;
}

// Re-exported for the tests, which build facts by hand.
export { keyVerdict, readKey, mismatchLine, issues, adminDropin, managedRoot, readText };
