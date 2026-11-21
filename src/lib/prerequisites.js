// The prerequisites section of mhw check (Issue #89), moved from global/prerequisites.py (#494, S23 of
// #470): check-only, never applies anything.
//
// Reads the versioned declaration global/prerequisites.json and reports, per item: present or missing,
// authenticated or not, and drift from the preferred settings, with the manual step for each gap. A
// required item that is missing makes the section fail (exit 1). Authentication and drift are reported and
// do not fail it: they are the owner's acts, and this command never prompts for a credential.
//
// Every probe is read-only and comes from a closed set implemented here; the declaration can only pick
// among them. Each command may be probed only as COMMANDS below allows: its own version query, or for
// xcode-select its path query. No probe runs an agent harness in any mode but `--version`, so none can
// reach a model. Every child runs with PROBE_ENV, which turns off the auto-install and update checks the
// tools we probe are known to perform (a tfenv shim installs a missing Terraform otherwise, measured).
// Account probes: `gh auth status` (a network call; its output names the account and is only classified,
// never printed); `gh repo view OWNER/REPO --json mergeCommitAllowed,squashMergeAllowed,rebaseMergeAllowed`,
// compared with global/github-repo-settings.json; and HTTPS GETs (src/lib/http-get.js, a worker thread
// the check waits for) that send a token only when it is already in the environment (SONAR_TOKEN, TFC_API_TOKEN), plus a
// SonarCloud project lookup when the overlay names a project key. A credential is never read from anywhere
// but the environment, never printed and never written. No probe child gets one: every variable a
// declared item names as its auth.env is removed from a probe's environment (withoutTokens, #494; the
// Python original passed them on). The GET starts no process. The installers' --check that mhw check runs
// before this section inherits the caller's environment, as before.
//
// Owner-specific values live in the untracked overlay file prerequisites.local.json (gitignored by
// *.local.json): {"lanes": [...], "github_repos": ["OWNER/REPO"], "sonar_projects": ["KEY"]}. "lanes"
// names the workflow lanes whose required items also fail the section (default: none beyond the items
// required overall). With no github_repos, the GitHub merge-settings check reads this checkout's origin.
//
// Environment, tests and probes only: WORKSTATION_PREREQUISITES replaces the declaration path;
// WORKSTATION_SONAR_URL, WORKSTATION_TFC_URL and WORKSTATION_GITHUB_URL replace the service base URLs and
// are honoured only for a plain-HTTP 127.0.0.1 address with a port, so a token can never be redirected to
// another host. A program is found on PATH by src/lib/onpath.js (absolute entries only) and run by that
// absolute path. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { onPath } from './onpath.js';
import { runAbsolute } from './run.js';
import { getSync } from './http-get.js';
import { loads, isDict, pyStr, pyRepr, pyStrip, cmpStr, JsonDecodeError, PyFloat } from './py.js';
import { py, readTextPy, PyError, osErrorClass, digitValue } from './clean.js';
import { pathlibJoin, systemName } from '../render/chrome-debugging.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const DECLARATION = path.join(ROOT, 'global', 'prerequisites.json');
export const REPO_STANDARD = path.join(ROOT, 'global', 'github-repo-settings.json');
// The merge standard's keys (the REST names it declares) -> the fields `gh repo view --json` reads them by.
/** @type {Record<string, string>} */
export const GH_FIELDS = { allow_merge_commit: 'mergeCommitAllowed', allow_squash_merge: 'squashMergeAllowed', allow_rebase_merge: 'rebaseMergeAllowed' };
export const OVERLAY_FILE = 'prerequisites.local.json';
export const SONAR_URL = 'https://sonarcloud.io';
export const TFC_URL = 'https://app.terraform.io';
export const GITHUB_URL = 'https://api.github.com';
const LOOPBACK_HOST = '127.0.0.1';
// The closed probe set: every command a declaration may name, with the only arguments it may be run with.
// "version" is its version query; "path" a read-only path query. argv is built from these constants, never
// from the declaration. Agent harnesses get --version only: nothing here can reach a model.
/** @type {Record<string, { version?: string[], path?: string[] }>} */
export const COMMANDS = Object.freeze({
  claude: { version: ['--version'] }, codex: { version: ['--version'] },
  'kiro-cli': { version: ['--version'] }, gh: { version: ['--version'] },
  git: { version: ['--version'] }, jq: { version: ['--version'] },
  python3: { version: ['--version'] }, 'xcode-select': { path: ['-p'] },
  security: {}, node: { version: ['--version'] }, terraform: { version: ['version'] },
  actionlint: { version: ['--version'] }, checkov: { version: ['--version'] },
  shellcheck: { version: ['--version'] },
  pwsh: { version: ['--version'] }, uv: { version: ['--version'] },
  brew: { version: ['--version'] }, docker: { version: ['--version'] },
  podman: { version: ['--version'] },
});
// Every probe child runs with these set: no auto-install, no update or telemetry call. tfenv's shim
// installs a missing Terraform when TFENV_AUTO_INSTALL is unset (measured, tfenv 3.0.0).
export const PROBE_ENV = Object.freeze({ TFENV_AUTO_INSTALL: 'false', CHECKPOINT_DISABLE: '1', GH_NO_UPDATE_NOTIFIER: '1', HOMEBREW_NO_AUTO_UPDATE: '1' });
const PRESENCE_KINDS = new Set(['manual', 'account']);
const AUTH_KINDS = new Set(['none', 'gh-auth-status', 'sonarcloud-token', 'tfc-token']);
const PREFERRED_KINDS = new Set(['github-repo-settings', 'sonarcloud-project']);
const REQUIREMENT = new Set(['required', 'optional']);
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const SONAR_KEY = /^[A-Za-z0-9_.:-]+$/;
const ENV_NAME = /^[A-Z][A-Z0-9_]*$/;
const VERSION = new RegExp(py(String.raw`v?(\d+)(?:\.(\d+))?(?:\.(\d+))?`), 'u');
const ORIGIN = /github\.com[:/]([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+?)(?:\.git)?\/?$/;
export const TIMEOUT = 15;

export class DeclarationError extends Error {}

/** @typedef {Record<string, string | undefined>} Env */
/** @typedef {Record<string, any>} Item */
/** @typedef {{ lanes: string[], github_repos: string[], sonar_projects: string[] }} Overlay */
/** @typedef {[number, number, number]} Version */

/** Python's == between two parsed JSON values, for the few comparisons the declaration needs. @param {unknown} a @param {unknown} b @returns {boolean} */
function same(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  const n = (/** @type {unknown} */ v) => (v instanceof PyFloat ? v.v : typeof v === 'boolean' ? Number(v) : v);
  return n(a) === n(b);
}

/** str(Path(p)) on POSIX. @param {string} p */
const pathStr = (p) => (process.platform === 'win32' ? p : pathlibJoin(p, []) || '.');

// ---------------------------------------------------------------------------------------------------
// Declaration and overlay.

/** @param {Env} env */
export function declarationPath(env) {
  return env.WORKSTATION_PREREQUISITES || DECLARATION;
}

/** parse_version(text): (major, minor, patch) from the first version in a text, or null. @param {unknown} text @returns {Version | null} */
export function parseVersion(text) {
  const m = VERSION.exec(text ? pyStr(text) : '');
  if (!m) return null;
  const int = (/** @type {string | undefined} */ g) => (g ? Array.from(g).reduce((acc, ch) => acc * 10 + digitValue(/** @type {number} */ (ch.codePointAt(0))), 0) : 0);
  return [int(m[1]), int(m[2]), int(m[3])];
}

/** @param {Version} a @param {Version} b */
const less = (a, b) => a[0] !== b[0] ? a[0] < b[0] : a[1] !== b[1] ? a[1] < b[1] : a[2] < b[2];

/** @param {string} c */
const known = (c) => typeof c === 'string' && Object.hasOwn(COMMANDS, c);

/**
 * Throws DeclarationError unless every item uses only the closed probe set.
 * @param {any} doc
 */
export function validate(doc) {
  if (!isDict(doc) || !Array.isArray(doc.items)) throw new DeclarationError('no items list');
  const lanes = isDict(doc.lanes) ? doc.lanes : {};
  const seen = new Set();
  for (const item of doc.items) {
    const where = pyStr(isDict(item) ? item.id : pyRepr(item));
    if (!isDict(item) || typeof item.id !== 'string' || seen.has(item.id)) throw new DeclarationError('item without a unique id: ' + where);
    seen.add(item.id);
    for (const key of ['name', 'category', 'manual']) {
      if (typeof item[key] !== 'string' || !item[key]) throw new DeclarationError(where + ': ' + key + ' missing');
    }
    if (!REQUIREMENT.has(item.required)) throw new DeclarationError(where + ': required must be required or optional');
    const itemLanes = item.lanes || {};
    if (!isDict(itemLanes)) throw new DeclarationError(where + ': lanes must be an object');
    for (const [lane, req] of Object.entries(itemLanes)) {
      if (!Object.hasOwn(lanes, lane) || !REQUIREMENT.has(/** @type {string} */ (req))) {
        throw new DeclarationError(where + ': unknown lane or requirement ' + lane + '=' + pyStr(req));
      }
    }
    const presence = item.presence;
    if (!isDict(presence)) throw new DeclarationError(where + ': presence missing');
    if (Object.hasOwn(presence, 'commands')) {
      const cmds = presence.commands;
      if (!(Array.isArray(cmds) && cmds.length && cmds.every(known))) throw new DeclarationError(where + ': presence.commands outside the closed probe set');
      if (Object.hasOwn(presence, 'args') && !cmds.every((c) => same(COMMANDS[c].path || [], presence.args))) {
        throw new DeclarationError(where + ': presence.args is not the path query of every command');
      }
    } else if (!PRESENCE_KINDS.has(presence.kind)) throw new DeclarationError(where + ': presence kind unknown');
    const version = item.version;
    if (version !== undefined && version !== null) {
      if (!isDict(version)) throw new DeclarationError(where + ': version.args is not the version query of every command');
      if (!Object.hasOwn(presence, 'commands') || !presence.commands.every((/** @type {string} */ c) => COMMANDS[c].version && same(COMMANDS[c].version, version.args))) {
        throw new DeclarationError(where + ': version.args is not the version query of every command');
      }
      for (const bound of ['minimum', 'preferred']) {
        if (Object.hasOwn(version, bound) && parseVersion(version[bound]) === null) throw new DeclarationError(where + ': version.' + bound + ' is not a version');
      }
    }
    const auth = item.auth;
    if (auth !== undefined && auth !== null) {
      if (!isDict(auth) || !AUTH_KINDS.has(auth.kind)) throw new DeclarationError(where + ': auth kind unknown');
      if ((auth.kind === 'sonarcloud-token' || auth.kind === 'tfc-token') && !ENV_NAME.test(pyStr(Object.hasOwn(auth, 'env') ? auth.env : ''))) {
        throw new DeclarationError(where + ': auth.env must name an environment variable');
      }
    }
    const preferred = item.preferred;
    if (preferred !== undefined && preferred !== null && (!isDict(preferred) || !PREFERRED_KINDS.has(preferred.kind))) {
      throw new DeclarationError(where + ': preferred kind unknown');
    }
    const osList = item.os;
    if (osList !== undefined && osList !== null && !(Array.isArray(osList) && osList.every((o) => typeof o === 'string'))) {
      throw new DeclarationError(where + ': os must be a list of platform.system() names');
    }
  }
  return doc;
}

/** The Python class a failed read or decode would raise. @param {unknown} e */
function errorClass(e) {
  if (e instanceof PyError) return e.pyClass;
  if (e instanceof JsonDecodeError) return 'JSONDecodeError';
  return osErrorClass(e);
}

/** @param {string} p */
export function loadDeclaration(p) {
  let doc;
  try {
    doc = loads(readTextPy(p, 'utf-8'));
  } catch (e) {
    throw new DeclarationError(pathStr(p) + ' not read (' + errorClass(e) + ')');
  }
  return validate(doc);
}

/** The overlay directory, or null for none. @param {Env} env */
export function overlayDir(env) {
  const value = env.WORKSTATION_OVERLAY;
  if (value === 'none') return null;
  return value || path.join(ROOT, 'overlay');
}

/** pathlib's is_file(). @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * [overlay, note]. Invalid values are dropped and named in the note; nothing fails on them.
 * @param {unknown} lanes the declaration's lanes (an object; Python's `in` also read a list) @param {Env} env
 * @returns {[Overlay, string]}
 */
export function loadOverlay(lanes, env) {
  /** @returns {Overlay} */
  const empty = () => ({ lanes: [], github_repos: [], sonar_projects: [] });
  const base = overlayDir(env);
  if (base === null) return [empty(), ''];
  const p = path.join(base, OVERLAY_FILE);
  if (!isFile(p)) return [empty(), ''];
  /** @type {any} */
  let doc;
  try {
    doc = loads(readTextPy(p, 'utf-8'));
  } catch {
    return [empty(), OVERLAY_FILE + ' not read; ignored'];
  }
  if (!isDict(doc)) return [empty(), OVERLAY_FILE + ' is not an object; ignored'];
  const out = empty();
  /** @type {string[]} */
  const dropped = [];
  /** @type {Array<[keyof Overlay, (v: string) => boolean]>} */
  const checks = [['lanes', (v) => (Array.isArray(lanes) ? lanes.includes(v) : isDict(lanes) && Object.hasOwn(/** @type {object} */ (lanes), v))], ['github_repos', (v) => REPO_RE.test(v)], ['sonar_projects', (v) => SONAR_KEY.test(v)]];
  for (const [key, check] of checks) {
    const raw = Object.hasOwn(doc, key) ? doc[key] : [];
    const values = Array.isArray(raw) ? raw : [raw];
    out[key] = values.filter((v) => typeof v === 'string' && check(v));
    if (out[key].length !== values.length) dropped.push(key);
  }
  return [out, dropped.length ? OVERLAY_FILE + ': invalid ' + dropped.join(', ') + ' ignored' : ''];
}

// ---------------------------------------------------------------------------------------------------
// Probes: the only places a process or network call happens.

/**
 * The environment a probe child gets: env without every variable an item's auth.env names, so a
 * declared token (SONAR_TOKEN, TFC_API_TOKEN) never reaches git, gh, terraform or any --version query.
 * prerequisites.py passed them on; this narrows that (#494, declared in test/golden/S23).
 * @param {Env} env @param {Item[]} items
 */
export function withoutTokens(env, items) {
  const out = { ...env };
  for (const item of items) {
    const name = isDict(item.auth) ? item.auth.env : undefined;
    if (typeof name === 'string') delete out[name];
  }
  return out;
}

/**
 * [exit code, combined output, stripped]. 127 when the command cannot be run, 124 on timeout.
 * @param {string} exe an absolute path @param {string[]} args @param {Env} env
 * @returns {[number, string]}
 */
export function probe(exe, args, env) {
  const r = runAbsolute(exe, args, { env: { ...env, ...PROBE_ENV }, stdio: ['ignore', 'pipe', 'pipe'], timeout: TIMEOUT * 1000 });
  // FileNotFoundError -> 127; any other OSError, and the timeout, -> 124 (as subprocess.run raised them).
  if (r.error) return /** @type {NodeJS.ErrnoException} */ (r.error).code === 'ENOENT' ? [127, ''] : [124, ''];
  return [r.code, pyStrip(r.stdout + r.stderr)];
}

/**
 * The base URL a service is reached at: the default, or a plain-HTTP 127.0.0.1 address with a port.
 * @param {Env} env @param {string} name @param {string} fallback
 */
export function baseUrl(env, name, fallback) {
  const raw = env[name] || '';
  if (!raw) return fallback;
  // urllib.parse.urlsplit, as far as the check needs it. First its two sanitisations (CPython 3.14): the
  // leading C0 controls and spaces stripped, then every \t, \r and \n removed. Then the scheme
  // (lower-cased), the netloc up to the first / ? or #, and what follows, which may only be an empty
  // path, query and fragment.
  let start = 0;
  while (start < raw.length && raw.charCodeAt(start) <= 0x20) start++;
  const value = raw.slice(start).replaceAll(/[\t\r\n]/g, '');
  const sep = value.indexOf('://');
  if (sep < 1) return fallback;
  const scheme = value.slice(0, sep).toLowerCase();
  const after = value.slice(sep + 3);
  const cut = after.search(/[/?#]/);
  const netloc = cut === -1 ? after : after.slice(0, cut);
  const tail = cut === -1 ? '' : after.slice(cut);
  // The netloc must be exactly host:port: a leading zero, a sign, a user or a second host is refused; a
  // port out of range made urlsplit raise, and the default is kept.
  const portText = netloc.startsWith(LOOPBACK_HOST + ':') ? netloc.slice(LOOPBACK_HOST.length + 1) : '';
  const port = /^\d{1,5}$/.test(portText) ? Number(portText) : 0;
  if (scheme !== 'http' || port < 1 || port > 65535 || portText !== String(port) || !/^\/?\??#?$/.test(tail)) return fallback;
  return scheme + '://' + LOOPBACK_HOST + ':' + port;
}

/**
 * [status, body] for one GET; status 0 when the host could not be reached. Never follows a redirect with
 * the token, and starts no process: the token stays in this process's memory (src/lib/http-get.js).
 * @param {string} url @param {string | null} token
 * @returns {[number, string]}
 */
export function httpGet(url, token) {
  return getSync(url, token);
}

/**
 * The repository this copy came from: its git origin, or in an npm install (no .git, Issue #68) the
 * repository its package.json names.
 * @param {Env} env @param {string} root
 */
export function originRepo(env, root = ROOT) {
  const git = onPath('git', env);
  let [code, line] = git ? probe(git, ['-C', root, 'remote', 'get-url', 'origin'], env) : [127, ''];
  if (code !== 0 && !fs.existsSync(path.join(root, '.git'))) {
    try {
      const doc = /** @type {any} */ (loads(readTextPy(path.join(root, 'package.json'), 'utf-8')));
      const url = doc.repository.url;
      if (url === undefined) throw new Error('KeyError');
      line = pyStr(url);
      code = 0;
    } catch {
      // OSError, ValueError, KeyError, TypeError: no repository named
    }
  }
  const m = code === 0 ? ORIGIN.exec(line) : null;
  return m ? m[1] : null;
}

// ---------------------------------------------------------------------------------------------------
// Per item.

const NOT_AVAILABLE = 'not checked (credential not available)';
const NO_PROBE = 'authentication not checked (no read-only probe declared)';

/**
 * [state, text, command path or null, version or null]. state: present, missing, manual, account.
 * @param {Item} item @param {Env} env
 * @returns {[string, string, string | null, Version | null]}
 */
export function checkPresence(item, env) {
  const presence = item.presence;
  if (presence.kind === 'manual') return ['manual', 'not detectable here (manual)', null, null];
  if (presence.kind === 'account') return ['account', 'account, no local client to detect', null, null];
  for (const declared of presence.commands) {
    // The constant key and its constant arguments, never the declaration's own strings.
    const name = /** @type {string} */ (Object.keys(COMMANDS).find((c) => c === declared));
    const allowed = COMMANDS[name];
    const p = onPath(name, env);
    if (!p) continue;
    if (Object.hasOwn(presence, 'args') && probe(p, [...(allowed.path || [])], env)[0] !== 0) continue;
    if (isDict(item.version) && Object.keys(item.version).length && allowed.version) {
      const [code, line] = probe(p, [...allowed.version], env);
      const found = code === 0 ? parseVersion(line) : null;
      const shown = found ? found.join('.') : 'version unknown';
      return ['present', 'present (' + name + ' ' + shown + ')', p, found];
    }
    return ['present', 'present (' + name + ')', p, null];
  }
  return ['missing', 'missing (' + presence.commands.join(' or ') + ' not found)', null, null];
}

/** @param {Item} item @param {Version | null} found */
export function versionDrift(item, found) {
  const version = isDict(item.version) ? item.version : {};
  for (const bound of ['minimum', 'preferred']) {
    if (Object.hasOwn(version, bound) && found !== null && less(found, /** @type {Version} */ (parseVersion(version[bound])))) {
      return 'drift: version ' + found.join('.') + ' below ' + bound + ' ' + pyStr(version[bound]);
    }
  }
  return null;
}

/**
 * [state, text]. state: ok, no, unchecked, unreachable, or null when the item declares no auth.
 * @param {Item} item @param {string | null} presentPath @param {Env} env the caller's environment (the token
 *   is read from it) @param {Env} [probeEnv] what a probe child gets: env without the declared tokens
 * @returns {[string | null, string]}
 */
export function checkAuth(item, presentPath, env, probeEnv = env) {
  const auth = item.auth;
  if (auth === undefined || auth === null) return [null, ''];
  const kind = auth.kind;
  if (kind === 'none') return ['unchecked', NO_PROBE];
  if (kind === 'gh-auth-status') {
    if (!presentPath) return ['unchecked', 'authentication not checked (gh missing)'];
    const [code, out] = probe(presentPath, ['auth', 'status'], probeEnv); // output names the account: classified only
    if (code === 0) return ['ok', 'authenticated'];
    if (out.toLowerCase().includes('not logged in')) return ['no', 'not authenticated'];
    // gh auth status contacts GitHub: offline, it fails like a rejected token. Ask GitHub, no token.
    const [status] = httpGet(baseUrl(env, 'WORKSTATION_GITHUB_URL', GITHUB_URL) + '/zen', null);
    if (status === 0) return ['unreachable', 'authentication not checked (GitHub unreachable)'];
    return ['no', 'not authenticated (gh auth status failed with GitHub reachable)'];
  }
  const token = env[auth.env] || '';
  if (!token) return ['unchecked', 'authentication ' + NOT_AVAILABLE + '; $' + auth.env + ' unset'];
  let status;
  let valid;
  if (kind === 'sonarcloud-token') {
    let body;
    [status, body] = httpGet(baseUrl(env, 'WORKSTATION_SONAR_URL', SONAR_URL) + '/api/authentication/validate', token);
    try {
      const doc = status === 200 ? loads(body) : null;
      valid = isDict(doc) && /** @type {any} */ (doc).valid === true;
    } catch {
      valid = false;
    }
  } else {
    [status] = httpGet(baseUrl(env, 'WORKSTATION_TFC_URL', TFC_URL) + '/api/v2/account/details', token);
    valid = status === 200;
  }
  if (status === 0) return ['unreachable', 'authentication not checked (service unreachable)'];
  return valid ? ['ok', 'authenticated ($' + auth.env + ')'] : ['no', 'not authenticated ($' + auth.env + ' rejected)'];
}

/**
 * [[standard key, gh field, wanted bool]] from global/github-repo-settings.json (ADR-0016).
 * @param {string} [file]
 * @returns {Array<[string, string, boolean]>}
 */
export function repoStandard(file = REPO_STANDARD) {
  const name = path.basename(file);
  let settings;
  try {
    /** @type {any} */
    const doc = loads(readTextPy(file, 'utf-8'));
    if (!isDict(doc)) throw new PyError('TypeError');
    if (!Object.hasOwn(doc, 'settings')) throw new PyError('KeyError');
    settings = /** @type {any} */ (doc).settings;
  } catch (e) {
    throw new DeclarationError(name + ' not read (' + errorClass(e) + ')');
  }
  if (!isDict(settings) || !Object.keys(settings).length
      || Object.entries(settings).some(([k, v]) => !Object.hasOwn(GH_FIELDS, k) || typeof v !== 'boolean')) {
    throw new DeclarationError(name + ' holds a setting outside the closed set');
  }
  return Object.keys(settings).sort(cmpStr).map((k) => [k, GH_FIELDS[k], settings[k]]);
}

/**
 * [state, text] for one repository: ok, drift or unchecked. One read-only `gh repo view --json` (Issue
 * #206); never an edit. A value that is absent or not a boolean reads `unknown` and is drift, never
 * credited.
 * @param {string} gh @param {string} repo @param {Array<[string, string, boolean]>} standard @param {Env} env
 * @returns {[string, string]}
 */
export function repoSettings(gh, repo, standard, env) {
  const fields = standard.map(([, field]) => field).join(',');
  const [code, out] = probe(gh, ['repo', 'view', repo, '--json', fields], env);
  let doc = null;
  try {
    doc = code === 0 ? loads(out) : null;
  } catch {
    doc = null;
  }
  if (!isDict(doc)) return ['unchecked', 'merge settings not checked (' + repo + ' not readable with this login)'];
  /** @type {string[]} */
  const diffs = [];
  for (const [key, field, want] of standard) {
    const have = /** @type {any} */ (doc)[field];
    if (have !== want) {
      const shown = typeof have === 'boolean' ? String(have) : 'unknown';
      diffs.push(key + '=' + shown + ' (standard: ' + String(want) + ')');
    }
  }
  if (diffs.length) return ['drift', 'drift ' + repo + ': ' + diffs.join('; ')];
  return ['ok', 'merge settings match the standard (' + repo + ')'];
}

/**
 * [[state, text]]. state: ok, drift, unchecked.
 * @param {Item} item @param {string | null} authState @param {Overlay} overlay @param {string | null} gh @param {Env} env
 * @param {Env} [probeEnv] what a probe child gets: env without the declared tokens
 * @returns {Array<[string, string]>}
 */
export function checkPreferred(item, authState, overlay, gh, env, probeEnv = env) {
  const preferred = item.preferred;
  if (preferred === undefined || preferred === null) return [];
  if (preferred.kind === 'github-repo-settings') {
    if (authState !== 'ok') return [['unchecked', 'merge settings ' + NOT_AVAILABLE]];
    if (!gh) return [['unchecked', 'merge settings not checked (gh missing)']];
    let standard;
    try {
      standard = repoStandard();
    } catch (e) {
      if (!(e instanceof DeclarationError)) throw e;
      return [['unchecked', 'merge settings not checked (' + e.message + ')']];
    }
    const origin = overlay.github_repos.length ? null : originRepo(probeEnv);
    const repos = overlay.github_repos.length ? overlay.github_repos : origin ? [origin] : [];
    if (!repos.length) return [['unchecked', 'merge settings not checked (no GitHub origin and none in the overlay)']];
    return repos.map((repo) => repoSettings(gh, repo, standard, probeEnv));
  }
  const keys = overlay.sonar_projects;
  if (!keys.length) return [['unchecked', 'project not checked (no project key in the overlay)']];
  const authEnv = isDict(item.auth) ? item.auth.env : undefined;
  const token = (authEnv ? env[authEnv] : '') || null;
  /** @type {Array<[string, string]>} */
  const out = [];
  for (const key of keys) {
    const url = baseUrl(env, 'WORKSTATION_SONAR_URL', SONAR_URL) + '/api/components/show?component=' + encodeURIComponent(key);
    const [status] = httpGet(url, token);
    if (status === 200) out.push(['ok', 'project ' + key + ' reachable']);
    else if (status === 0) out.push(['unchecked', 'project ' + key + ' not checked (service unreachable)']);
    else out.push(['drift', 'project ' + key + ' not reachable (HTTP ' + status + ')']);
  }
  return out;
}

/**
 * [fatal, label]. Fatal when required overall or required in an active lane.
 * @param {Item} item @param {string[]} active
 * @returns {[boolean, string]}
 */
export function requirement(item, active) {
  const lanes = isDict(item.lanes) ? item.lanes : {};
  const requiredIn = Object.entries(lanes).filter(([, req]) => req === 'required').map(([lane]) => lane);
  const fatal = item.required === 'required' || requiredIn.some((lane) => active.includes(lane));
  if (item.required === 'required') return [fatal, 'required'];
  return [fatal, requiredIn.length ? 'optional; required for ' + requiredIn.join(', ') : 'optional'];
}

/**
 * { tag, fatal, line } for one item. Pure apart from the probes above.
 * @param {Item} item @param {Overlay} overlay @param {Env} env @param {string} [system]
 * @param {Env} [probeEnv] what a probe child gets: env without the declared tokens (report() builds it)
 */
export function evaluate(item, overlay, env, system = systemName(), probeEnv = env) {
  const [fatal, label] = requirement(item, overlay.lanes);
  const head = item.id + ' [' + label + ']';
  if (Array.isArray(item.os) && item.os.length && !item.os.includes(system)) {
    return { tag: 'SKIP', fatal: false, line: head + ': not applicable on ' + system };
  }
  const [state, presenceText, p, found] = checkPresence(item, probeEnv);
  const parts = [presenceText];
  /** @type {string | null} */
  let authState = null;
  let authText = '';
  /** @type {string | null} */
  let drift = null;
  /** @type {Array<[string, string]>} */
  let prefs = [];
  if (state !== 'missing') {
    [authState, authText] = checkAuth(item, p, env, probeEnv);
    drift = state === 'present' ? versionDrift(item, found) : null;
    prefs = checkPreferred(item, authState, overlay, p, env, probeEnv);
  }
  if (authText) parts.push(authText);
  if (drift) parts.push(drift);
  parts.push(...prefs.map(([, t]) => t));
  const drifted = !!drift || prefs.some(([s]) => s === 'drift');
  let tag;
  if (state === 'missing') tag = fatal ? 'MISSING' : 'ABSENT';
  else if (authState === 'no') tag = 'NOAUTH';
  else if (drifted) tag = 'DRIFT';
  else if (state === 'manual') tag = 'MANUAL';
  else if (authState === 'unreachable' || (state === 'account' && authState !== 'ok')) tag = 'NOCHECK';
  else tag = 'OK';
  let line = head + ': ' + parts.join(' · ');
  if (tag !== 'OK') line += ' -> ' + item.manual;
  return { tag, fatal: fatal && state === 'missing', line };
}

/**
 * [exit code, lines]. 0: no required item missing; 1: at least one; 2: declaration invalid.
 * @param {Env} env @param {{ path?: string, system?: string }} [o]
 * @returns {[number, string[]]}
 */
export function report(env, o = {}) {
  let doc;
  try {
    doc = loadDeclaration(o.path || declarationPath(env));
  } catch (e) {
    if (!(e instanceof DeclarationError)) throw e;
    return [2, ['PREREQ  declaration invalid, nothing checked: ' + e.message]];
  }
  const [overlay, note] = loadOverlay(doc.lanes || {}, env);
  const active = overlay.lanes.length ? overlay.lanes.join(', ') : 'none beyond the overall requirement';
  const lines = ['PREREQ  prerequisites (global/prerequisites.json); lanes that also fail on a missing item: ' + active];
  if (note) lines.push('PREREQ  ' + note);
  // #494: no probe child gets a token the declaration names (git, gh, terraform and every --version run
  // with them removed); the token is read from env, by this process, only.
  const probeEnv = withoutTokens(env, doc.items);
  const results = doc.items.map((/** @type {Item} */ item) => evaluate(item, overlay, env, o.system, probeEnv));
  for (const r of results) lines.push(r.tag.padEnd(7) + ' ' + r.line);
  const missing = results.filter((/** @type {{ fatal: boolean }} */ r) => r.fatal).length;
  lines.push('PREREQ  ' + missing + ' required item(s) missing; check-only, nothing was applied');
  return [missing ? 1 : 0, lines];
}
