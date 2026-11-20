// The MCP active set (Issue #219, ADR-0041): the Node form of the deleted global/mcp/mcp_active.py (#485,
// S14 of #470). The servers of the local MCP definition are the set, and every other MCP server an agent
// harness would start is turned off through that harness's own switch.
//
//   mhw mcp render --active --mode=install|check|dry-run|uninstall [--stamp=S] [--source=FILE]
//
// src/render/mcp.js checks the arguments and calls run() here; global/install.sh runs it on every mhw
// install, check and uninstall. Per agent harness:
//
//   Codex        enabled = false on the server's [mcp_servers.<name>] table in config.toml
//   Claude Code  a deniedMcpServers entry in ~/.claude/settings.json: serverName for a server in
//                ~/.claude.json and for a claude.ai connector declared "off"; serverUrl (or serverCommand)
//                for a server a plugin provides, read from the plugins' own files
//   Kiro         "disabled": true on the server in ~/.kiro/settings/mcp.json
//   Claude app   report only: its configuration has no switch for one server
//
// Nothing happens until the definition declares "active_set": with no definition, or one without that key,
// nothing is turned off, and what an earlier install turned off is turned back on. Exempt, never touched and
// never reported (decision 2): the servers an agent harness app writes for its own built-in browser or
// computer use (EXEMPT). Only names and counts are printed, never a command, a URL or any other value.
// Each change keeps the previous file as <config>.pmhwc-mcp-active-backup (0600); what was changed is
// recorded in the manifest (mcp-managed.json, "active"), so uninstall restores exactly that.
//
// Same lines, exit codes and files as the original; test/golden/S14 holds the transcripts recorded from it,
// and test/golden/S14/expected-differences.json names every intended difference. Python semantics are kept
// where they change bytes or decisions: str.splitlines(), sorted() by code point, == on dicts, the
// os.path.expandvars, fnmatch and urlsplit rules a deny entry is matched with. node: modules and the
// renderer's own helpers only.
import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { MARKER_ID } from '../lib/marker.js';
import { dumps, cmpStr } from '../lib/py.js';
import { PyOSError } from '../render/kiro-permissions.js';
import {
  Refuse, SURFACES, MANIFEST_KEYS, BLOCK_BEGIN_PREFIX, BLOCK_END, ACTIVE_BACKUP, isD, get, pyEq, home, surfaceTarget,
  defaultSource, manifestPath, loadManifestDoc, writeManifest, provenance, atomicWrite, looksLikeCredentialValue,
  committable, loadSource, activeFacts, tomlLoads, splitKeep, readText, readJson, entries, keysOf, has, dict,
  deepCopyTree, exists, isDir, clsOf, msgOf, truthy,
} from '../render/mcp.js';

/** @typedef {import('../render/mcp.js').Ctx} Ctx @typedef {import('../render/mcp.js').Dict} Dict */

export const TAG = '(MCP active set)';
// Decision 2 of Issue #219: an agent harness app's own browser or computer-use server. node_repl is the
// one the Codex app writes into config.toml (named in the Issue); claude-in-chrome is Claude Code's
// built-in Chrome server (named in the Claude Code settings reference). Matched by name, so a server of
// the owner's under one of these names is exempt too.
export const EXEMPT = ['node_repl', 'claude-in-chrome'];
const CONNECTOR = 'claude.ai '; // the documented serverName of a claude.ai connector is "claude.ai <Name>"
export const MARK = '# ' + MARKER_ID + ' (mcp active set)';
export const DISABLE_LINE = 'enabled = false  ' + MARK + '\n';
export const BACKUP = ACTIVE_BACKUP;
const BARE_KEY = /^[A-Za-z0-9_-]$/;
const TABLE_RE = /^[ \t]*\[/;
const ENABLED_RE = /^[ \t]*enabled[ \t]*=/;

/** tomllib.TOMLDecodeError of the file as read: the caller refuses it as not valid TOML. */
export class TomlInvalid extends Error {}

/** str.rstrip("\r\n"). @param {string} s */
function rstripNewlines(s) {
  let e = s.length;
  while (e > 0 && (s[e - 1] === '\n' || s[e - 1] === '\r')) e--;
  return s.slice(0, e);
}

/**
 * The server name of an [mcp_servers.<name>] header line, or null: what the original's pattern
 * ^[ \t]*\[[ \t]*mcp_servers[ \t]*\.[ \t]*("[^"\\]*"|'[^']*'|[A-Za-z0-9_-]+)[ \t]*\][ \t]*(#.*)?$ matched,
 * read in one pass (a basic-string name with an escape is not matched, as there).
 * @param {string} text one line, its newline removed
 */
export function headerName(text) {
  let i = 0;
  const blanks = () => {
    while (text[i] === ' ' || text[i] === '\t') i++;
  };
  /** @param {string} word */
  const expect = (word) => {
    if (!text.startsWith(word, i)) return false;
    i += word.length;
    return true;
  };
  blanks();
  if (!expect('[')) return null;
  blanks();
  if (!expect('mcp_servers')) return null;
  blanks();
  if (!expect('.')) return null;
  blanks();
  let name;
  const quote = text[i];
  if (quote === '"' || quote === "'") {
    const close = text.indexOf(quote, i + 1);
    if (close < 0) return null;
    name = text.slice(i + 1, close);
    if (quote === '"' && name.includes('\\')) return null;
    i = close + 1;
  } else {
    const start = i;
    while (i < text.length && BARE_KEY.test(text[i])) i++;
    if (i === start) return null;
    name = text.slice(start, i);
  }
  blanks();
  if (!expect(']')) return null;
  blanks();
  return i === text.length || text[i] === '#' ? name : null;
}

/** sorted() of strings, by code point. @param {Iterable<string>} xs */
const sorted = (xs) => [...xs].sort(cmpStr);
/** d[k] = v on a dict tree (a Map, or a plain object holding any key, __proto__ included). @param {Dict} d @param {string} k @param {unknown} v */
function setKey(d, k, v) {
  if (d instanceof Map) d.set(k, v);
  else Object.defineProperty(d, k, { value: v, writable: true, enumerable: true, configurable: true });
}
/** d.pop(k, None). @param {Dict} d @param {string} k */
function popKey(d, k) {
  if (d instanceof Map) d.delete(k);
  else delete d[k];
}
/** x in list, by Python ==. @param {unknown} x @param {unknown[]} list */
const pyIn = (x, list) => list.some((v) => pyEq(v, x));

/** The declared set, or none: an undeclared set turns nothing off. */
export class ActiveSet {
  /** @param {Map<string, any>} facts what the renderer computed (activeFacts) */
  constructor(facts) {
    this.declared = /** @type {boolean} */ (facts.get('declared'));
    this.servers = new Set(/** @type {string[]} */ (facts.get('servers')));
    /** @type {string[]} */
    this.on = facts.get('on');
    /** @type {string[]} */
    this.off = facts.get('off');
    /** @type {Map<string, Set<string>>} */
    this.policy = new Map(entries(facts.get('policy')).map(([s, names]) => [s, new Set(names)]));
    // name -> the surfaces a set member is configured on: its own, and a policy server's (ADR-0038
    // amendment, Issue #219: the local copy extends a policy server to the surfaces the policy does not name).
    /** @type {Map<string, Set<string>>} */
    this.where = new Map(entries(facts.get('where')).map(([n, v]) => [n, new Set(v)]));
    // Set members whose local copy differs from the policy's on a surface both name: name -> those surfaces.
    /** @type {Map<string, string[]>} */
    this.conflicts = facts.get('conflicts');
    // Set members whose local copy differs from the policy's and is rendered only where the policy is not:
    // name -> the surfaces where the local copy runs another command, args or env. Reported, not refused.
    /** @type {Map<string, string[]>} */
    this.divergent = facts.get('divergent');
    // name -> the Claude Code entries a kept server is rendered as. A deny that matches one would block it too.
    /** @type {Map<string, Dict[]>} */
    this.kept = facts.get('kept');
  }

  /** The surfaces the policy servers file renders this server on. @param {string} name */
  policyWhere(name) {
    return SURFACES.filter((s) => (this.policy.get(s) || new Set()).has(name));
  }

  /** The set members configured on this surface. @param {string} surface */
  members(surface) {
    return sorted([...this.servers].filter((n) => (this.where.get(n) || new Set(SURFACES)).has(surface)));
  }

  /** True when a declared set leaves this server out and it is not exempt. @param {string} surface @param {string} name */
  outside(surface, name) {
    return this.declared && !EXEMPT.includes(name) && !this.servers.has(name) && !(this.policy.get(surface) || new Set()).has(name);
  }
}

/** "a, b (2)". @param {Iterable<string>} items */
export function names(items) {
  const list = [...items];
  return list.join(', ') + ' (' + list.length + ')';
}

/** -> [exists, data]. Refuse(3) when the file is not a readable JSON object. @param {string} file @returns {[boolean, Map<string, any>]} */
export function readJsonObject(file) {
  let data;
  try {
    data = readJson(file);
  } catch (e) {
    if (e instanceof PyOSError && e.cls === 'FileNotFoundError') return [false, dict()];
    throw new Refuse(3, 'not readable JSON (' + clsOf(e) + '); left untouched');
  }
  if (!isD(data)) throw new Refuse(3, 'not a JSON object; left untouched');
  return [true, /** @type {Map<string, any>} */ (data)];
}

/** A plugin's own file: the data, or null when it is absent or unreadable (never a refusal). @param {string} file */
function quietJson(file) {
  try {
    return readJsonObject(file)[1];
  } catch (e) {
    if (e instanceof Refuse) return null;
    throw e;
  }
}

// ------------------------------------------------------------------------------------------- Codex

/**
 * name -> the line numbers of its [mcp_servers.<name>] header, its enabled key and our mark, and whether
 * the table sits inside the renderer's managed block (ADR-0017).
 * @param {string[]} lines
 * @returns {Map<string, { header: number, block: boolean, enabled: number | null, mark: number | null }>}
 */
export function codexLayout(lines) {
  const tables = new Map();
  /** @type {string | null} */
  let current = null;
  let inBlock = false;
  lines.forEach((line, i) => {
    const text = rstripNewlines(line);
    if (text.startsWith(BLOCK_BEGIN_PREFIX) || text === BLOCK_END) {
      inBlock = text !== BLOCK_END;
      current = null;
      return;
    }
    const name = headerName(text);
    if (name !== null) {
      current = name;
      if (!tables.has(current)) tables.set(current, { header: i, block: inBlock, enabled: null, mark: null });
    } else if (TABLE_RE.test(text)) current = null;
    else if (current !== null && text.includes(MARK)) tables.get(current).mark = i;
    else if (current !== null && ENABLED_RE.test(text)) tables.get(current).enabled = i;
  });
  return tables;
}

/** The enabled value a recorded original line carried, or null to drop the key. @param {string | null | undefined} original */
function restoredEnabled(original) {
  if (!original) return null;
  try {
    return get(tomlLoads(original), 'enabled', null);
  } catch {
    return null;
  }
}

/**
 * -> the new text, turned off, turned back on, not editable, the new record, the servers and the layout.
 * Throws TomlInvalid on a file that does not parse (the caller refuses it), and Refuse(3) when the edited text
 * does not parse back to the intended content.
 * @param {string} text @param {ActiveSet} aset @param {Dict} prior
 */
export function planCodex(text, aset, prior) {
  let parsed;
  try {
    parsed = tomlLoads(text);
  } catch (e) {
    throw new TomlInvalid(msgOf(e));
  }
  let servers = get(parsed, 'mcp_servers', {});
  servers = isD(servers) ? servers : {};
  const lines = splitKeep(text);
  const lay = codexLayout(lines);
  const off = new Set(keysOf(servers).filter((n) => isD(get(servers, n)) && aset.outside('codex', n) && !lay.get(n)?.block));
  const marked = new Set([...lay].filter(([, t]) => t.mark !== null).map(([n]) => n));
  const pending = sorted([...off].filter((n) => !marked.has(n) && get(get(servers, n), 'enabled', true) !== false));
  const stuck = pending.filter((n) => !lay.has(n));
  const add = pending.filter((n) => lay.has(n));
  const restore = sorted([...marked].filter((n) => !off.has(n)));
  // The original iterated a set here (hash order); sorted, so the manifest's order is stable.
  /** @type {Map<string, string | null>} */
  const record = new Map(sorted([...marked].filter((n) => off.has(n))).map((n) => [n, get(prior, n, null)]));
  /** @type {Map<number, string>} */
  const replace = new Map();
  /** @type {Map<number, string>} */
  const after = new Map();
  for (const n of add) {
    const t = /** @type {{ header: number, enabled: number | null }} */ (lay.get(n));
    if (t.enabled === null) {
      record.set(n, null);
      after.set(t.header, DISABLE_LINE);
    } else {
      record.set(n, rstripNewlines(lines[t.enabled]));
      replace.set(t.enabled, DISABLE_LINE);
    }
  }
  for (const n of restore) {
    const original = get(prior, n, null);
    replace.set(/** @type {number} */ (lay.get(n)?.mark), original ? original + '\n' : '');
  }
  const out = lines.map((ln, i) => {
    let l = replace.has(i) ? /** @type {string} */ (replace.get(i)) : ln;
    if (after.has(i) && !l.endsWith('\n')) l += '\n';
    return l + (after.get(i) ?? '');
  });
  const newText = out.join('');
  const expected = deepCopyTree(parsed);
  for (const n of add) setKey(get(get(expected, 'mcp_servers'), n), 'enabled', false);
  for (const n of restore) {
    const value = restoredEnabled(get(prior, n, null));
    const s = get(get(expected, 'mcp_servers'), n);
    if (value === null) popKey(s, 'enabled');
    else setKey(s, 'enabled', value);
  }
  let same;
  try {
    same = pyEq(tomlLoads(newText), expected);
  } catch {
    same = false;
  }
  if (!same) throw new Refuse(3, 'the edited TOML does not parse back to the intended content; nothing written');
  return { newText, add, restore, stuck, record, servers, lay };
}

// -------------------------------------------------------------------------------------------- Kiro

/**
 * -> the new mcp.json data, turned off, turned back on, the new record. The record keeps, per server mhw
 * turned off, the "disabled" value it replaced: [] when there was none.
 * @param {Map<string, any>} data @param {ActiveSet} aset @param {Dict} prior
 */
export function planKiro(data, aset, prior) {
  const next = deepCopyTree(data);
  const servers = get(next, 'mcpServers', dict());
  /** @type {Map<string, unknown[]>} */
  const record = new Map();
  /** @type {string[]} */
  const add = [];
  /** @type {string[]} */
  const back = [];
  for (const n of sorted(keysOf(servers).filter((x) => isD(get(servers, x)) && aset.outside('kiro', x)))) {
    const s = get(servers, n);
    if (get(s, 'disabled') === true) {
      if (has(prior, n)) record.set(n, get(prior, n));
      continue; // off already: by mhw (kept on record) or by the owner (his own, never recorded)
    }
    record.set(n, has(s, 'disabled') ? [get(s, 'disabled')] : []);
    setKey(s, 'disabled', true);
    add.push(n);
  }
  for (const n of sorted(keysOf(prior))) {
    const was = get(prior, n);
    const s = get(servers, n);
    if (record.has(n) || !isD(s) || get(s, 'disabled') !== true) continue;
    if (truthy(was)) setKey(s, 'disabled', was[0]);
    else popKey(s, 'disabled');
    back.push(n);
  }
  return { next, add, back, record };
}

// ------------------------------------------------------------------------------------- Claude Code

/** The names a glob `*` lists in a directory: every entry not starting with a dot. @param {string} dir */
function globNames(dir) {
  try {
    return fs.readdirSync(dir).filter((n) => !n.startsWith('.'));
  } catch {
    return [];
  }
}

/**
 * [plugin, directory] for each installed plugin (installed_plugins.json) and each plugin claude.ai synced
 * (plugins/synced/<source>/<plugin>).
 * @param {string} h @param {Ctx} ctx
 */
export function pluginRoots(h, ctx) {
  const base = path.join(h, '.claude', 'plugins');
  /** @type {Array<[string, string]>} */
  const roots = [];
  const installed = quietJson(path.resolve(ctx.cwd, base, 'installed_plugins.json')) || dict();
  const plugins = get(installed, 'plugins', dict());
  for (const [key, installs] of isD(plugins) ? entries(plugins) : []) {
    for (const inst of Array.isArray(installs) ? installs : []) {
      const p = isD(inst) ? get(inst, 'installPath') : null;
      if (typeof p === 'string' && p) roots.push([key.split('@')[0], p]);
    }
  }
  const synced = path.join(base, 'synced');
  /** @type {string[]} */
  const dirs = [];
  for (const a of globNames(path.resolve(ctx.cwd, synced))) {
    for (const b of globNames(path.resolve(ctx.cwd, synced, a))) dirs.push(path.join(synced, a, b));
  }
  for (const d of sorted(dirs)) if (isDir(path.resolve(ctx.cwd, d))) roots.push([path.basename(d), d]);
  return roots;
}

/**
 * [label, server] for each MCP server a plugin provides, from its .mcp.json and from an inline mcpServers
 * object in its .claude-plugin/plugin.json. The label is plugin:<plugin>:<server>.
 * @param {string} h @param {Ctx} ctx
 */
export function pluginServers(h, ctx) {
  /** @type {Array<[string, Dict]>} */
  const found = [];
  for (const [plugin, root] of pluginRoots(h, ctx)) {
    for (const [rel, inline] of /** @type {Array<[string, boolean]>} */ ([['.mcp.json', false], [path.join('.claude-plugin', 'plugin.json'), true]])) {
      const read = quietJson(path.resolve(ctx.cwd, root, rel));
      const doc = read?.size ? read : dict();
      const servers = inline || doc.has('mcpServers') ? doc.get('mcpServers') : doc;
      for (const [name, s] of isD(servers) ? entries(servers) : []) {
        if (isD(s)) found.push(['plugin:' + plugin + ':' + name, s]);
      }
    }
  }
  return found;
}

/**
 * The documented deniedMcpServers entry matching one plugin server, or null. A URL or command that carries
 * a ${VAR}, a wildcard or a credential-looking value is never copied into the settings.
 * @param {Dict} server
 */
export function pluginEntry(server) {
  const url = get(server, 'url');
  if (typeof url === 'string') {
    if (url && !url.includes('${') && !url.includes('*') && !looksLikeCredentialValue(url)) return dict([['serverUrl', url]]);
    return null;
  }
  const parts = commandOf(server);
  if (parts === null || parts.some((p) => p.includes('${') || looksLikeCredentialValue(p))) return null;
  return dict([['serverCommand', parts]]);
}

/** [command, ...args] when both are strings, else null. @param {Dict} server */
function commandOf(server) {
  const command = get(server, 'command');
  const args = get(server, 'args', []);
  if (typeof command === 'string' && command && Array.isArray(args) && args.every((a) => typeof a === 'string')) return [command, ...args];
  return null;
}

/**
 * os.path.expandvars on POSIX: $name and ${name} replaced by the environment's value; an unknown name,
 * ${} and a lone $ are left as written.
 * @param {string} s @param {Record<string, string | undefined>} env
 */
export function expandvars(s, env) {
  if (!s.includes('$')) return s;
  return s.replaceAll(/\$(\w+|\{[^}]*\})/g, (m, /** @type {string} */ name) => {
    const key = name.startsWith('{') && name.endsWith('}') ? name.slice(1, -1) : name;
    return Object.hasOwn(env, key) && env[key] !== undefined ? /** @type {string} */ (env[key]) : m;
  });
}

/**
 * fnmatch.fnmatchcase(name, pat): * any run, ? one character, [seq] [!seq] and ranges as Python's
 * fnmatch.translate reads them; a [ with no closing ] is literal. A linear scan, no regular expression.
 * @param {string} name @param {string} pat
 */
export function fnmatchcase(name, pat) {
  const s = Array.from(name);
  const p = Array.from(pat);
  /** One pattern item at pi: [matcher, next index]. @param {number} pi @returns {[(c: string) => boolean, number]} */
  const item = (pi) => {
    if (p[pi] === '?') return [() => true, pi + 1];
    if (p[pi] !== '[') return [(c) => c === p[pi], pi + 1];
    let j = pi + 1;
    if (p[j] === '!') j++;
    if (p[j] === ']') j++;
    while (j < p.length && p[j] !== ']') j++;
    if (j >= p.length) return [(c) => c === '[', pi + 1];
    let body = p.slice(pi + 1, j);
    const negate = body[0] === '!';
    if (negate) body = body.slice(1);
    if (!body.length) return [negate ? () => true : () => false, j + 1];
    /** @type {Array<[string, string]>} */
    const ranges = [];
    for (let k = 0; k < body.length; k++) {
      if (k + 2 < body.length && body[k + 1] === '-') {
        ranges.push([body[k], body[k + 2]]);
        k += 2;
      } else ranges.push([body[k], body[k]]);
    }
    const inClass = (/** @type {string} */ c) => ranges.some(([lo, hi]) => cmpStr(lo, c) <= 0 && cmpStr(c, hi) <= 0);
    return [(c) => inClass(c) !== negate, j + 1];
  };
  let si = 0;
  let pi = 0;
  let starP = -1;
  let starS = 0;
  while (si < s.length) {
    if (pi < p.length && p[pi] === '*') {
      while (pi < p.length && p[pi] === '*') pi++;
      starP = pi;
      starS = si;
      continue;
    }
    if (pi < p.length) {
      const [ok, nextP] = item(pi);
      if (ok(s[si])) {
        si++;
        pi = nextP;
        continue;
      }
    }
    if (starP < 0) return false;
    starS++;
    si = starS;
    pi = starP;
  }
  while (pi < p.length && p[pi] === '*') pi++;
  return pi === p.length;
}

const SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/;
const WHATWG_C0_OR_SPACE = /^[\x00-\x20]+/;

/**
 * urllib.parse.urlsplit(url).hostname with the ValueErrors it raises: the lower-cased host, or null when
 * the URL has none; throws on an unbalanced or invalid bracketed host, and on a netloc whose NFKC form
 * gains a URL delimiter.
 * @param {string} input
 */
export function urlHostname(input) {
  let url = input.replace(WHATWG_C0_OR_SPACE, '').replaceAll(/[\t\r\n]/g, '');
  const colon = url.indexOf(':');
  if (colon > 0 && SCHEME.test(url.slice(0, colon))) url = url.slice(colon + 1);
  if (!url.startsWith('//')) return null;
  let end = url.length;
  for (const d of '/?#') {
    const k = url.indexOf(d, 2);
    if (k >= 0 && k < end) end = k;
  }
  const netloc = url.slice(2, end);
  if (netloc.includes('[') !== netloc.includes(']')) throw new Error('Invalid IPv6 URL');
  const hostinfo = netloc.slice(netloc.lastIndexOf('@') + 1);
  if (netloc.includes('[')) {
    const open = hostinfo.indexOf('[');
    if (open >= 0) {
      if (open > 0) throw new Error('Invalid IPv6 URL');
      const close = hostinfo.indexOf(']', open);
      const inner = close < 0 ? hostinfo.slice(open + 1) : hostinfo.slice(open + 1, close);
      const port = close < 0 ? '' : hostinfo.slice(close + 1);
      if (port && !port.startsWith(':')) throw new Error('Invalid IPv6 URL');
      bracketed(inner);
    }
  }
  checkNetloc(netloc);
  let host;
  const open = hostinfo.indexOf('[');
  if (open >= 0) {
    const rest = hostinfo.slice(open + 1);
    const close = rest.indexOf(']');
    host = close < 0 ? rest : rest.slice(0, close);
  } else {
    const c = hostinfo.indexOf(':');
    host = c < 0 ? hostinfo : hostinfo.slice(0, c);
  }
  if (!host) return null;
  const pct = host.indexOf('%');
  return pct < 0 ? host.toLowerCase() : host.slice(0, pct).toLowerCase() + host.slice(pct);
}

/** urllib.parse._check_bracketed_host: IPvFuture, or an IPv6 address (an IPv4 one is refused). @param {string} h */
function bracketed(h) {
  if (h.startsWith('v')) {
    if (!/^v[a-fA-F0-9]+\.[\s\S]+$/.test(h)) throw new Error('IPvFuture address is invalid');
    return;
  }
  const at = h.indexOf('%');
  const addr = at < 0 ? h : h.slice(0, at);
  if (at === 0 || (at >= 0 && at === h.length - 1)) throw new Error('not a valid IP address');
  if (!net.isIPv6(addr)) throw new Error('not a valid IPv6 address');
}

/** urllib.parse._checknetloc: a non-ASCII netloc may not gain a URL delimiter under NFKC. @param {string} netloc */
function checkNetloc(netloc) {
  if (/^[\x00-\x7f]*$/.test(netloc)) return;
  const n = netloc.replaceAll('@', '').replaceAll(':', '').replaceAll('#', '').replaceAll('?', '');
  const nfkc = n.normalize('NFKC');
  if (n === nfkc) return;
  for (const c of '/?#@:') if (nfkc.includes(c)) throw new Error("netloc contains invalid characters under NFKC normalization");
}

/** The lower-cased host of a URL, its trailing dots removed, or null when it has none. @param {string} url */
export function hostOf(url) {
  let h;
  try {
    h = urlHostname(url);
  } catch {
    return null;
  }
  if (!h) return null;
  let e = h.length;
  while (e > 0 && h[e - 1] === '.') e--;
  return h.slice(0, e).toLowerCase();
}

/**
 * Whether a deniedMcpServers entry would block this server, read conservatively: a URL entry blocks every
 * server on its host (the documented match also folds case, the default port and, for a pattern with no
 * path, every path), and a command entry is compared with and without ${VAR} expanded.
 * @param {unknown} entry @param {string} name @param {unknown} server @param {Record<string, string | undefined>} env
 */
export function denyMatches(entry, name, server, env) {
  if (!isD(entry) || !isD(server)) return false;
  if (has(entry, 'serverName')) return pyEq(get(entry, 'serverName'), name);
  if (has(entry, 'serverCommand')) {
    const cmd = commandOf(server);
    return cmd !== null && (pyEq(get(entry, 'serverCommand'), cmd) || pyEq(get(entry, 'serverCommand'), cmd.map((p) => expandvars(p, env))));
  }
  const url = get(server, 'url');
  const pattern = get(entry, 'serverUrl');
  if (typeof url !== 'string' || typeof pattern !== 'string') return false;
  if (pattern.includes('*')) return fnmatchcase(url.toLowerCase(), pattern.toLowerCase());
  return hostOf(pattern) !== null && hostOf(pattern) === hostOf(url);
}

/**
 * [name, server] for every server Claude Code keeps on: a set member or policy server as rendered and as
 * configured, and an exempt one as configured.
 * @param {ActiveSet} aset @param {Dict} userServers
 */
function keptServers(aset, userServers) {
  /** @type {Array<[string, Dict]>} */
  const kept = [];
  for (const n of sorted(aset.kept.keys())) for (const e of /** @type {Dict[]} */ (aset.kept.get(n))) kept.push([n, e]);
  for (const n of sorted(keysOf(userServers))) if (!aset.outside('claude-code', n)) kept.push([n, get(userServers, n)]);
  return kept;
}

/**
 * -> [[entry, label]], the labels with no documented match, the labels that would block a kept server.
 * @param {ActiveSet} aset @param {Dict} userServers @param {Array<[string, Dict]>} plugins @param {Ctx} ctx
 */
export function wantedDenies(aset, userServers, plugins, ctx) {
  /** @type {Array<[Map<string, any>, string]>} */
  const want = [];
  /** @type {string[]} */
  const stuck = [];
  /** @type {string[]} */
  const collide = [];
  const seen = new Set();
  /** @param {Map<string, any>} entry @param {string} label */
  const add = (entry, label) => {
    const key = dumps(entry, { sortKeys: true, separators: [', ', ': '] });
    if (!seen.has(key)) {
      seen.add(key);
      want.push([entry, label]);
    }
  };
  if (!aset.declared) return { want, stuck, collide };
  const kept = keptServers(aset, userServers);
  for (const n of sorted(keysOf(userServers))) if (aset.outside('claude-code', n)) add(dict([['serverName', n]]), n);
  for (const [label, server] of plugins) {
    const entry = pluginEntry(server);
    if (entry === null) stuck.push(label);
    else if (kept.some(([n, s]) => denyMatches(entry, n, s, ctx.env))) collide.push(label); // the deny would block the kept server too
    else add(entry, label);
  }
  for (const c of aset.off) add(dict([['serverName', CONNECTOR + c]]), CONNECTOR + c);
  return { want, stuck, collide };
}

/** Set members and policy servers one of these deny entries blocks (the owner's own included). @param {ActiveSet} aset @param {Dict} userServers @param {unknown[]} denied @param {Ctx} ctx */
function blockedMembers(aset, userServers, denied, ctx) {
  const members = new Set([...aset.servers, ...(aset.policy.get('claude-code') || [])]);
  return sorted(new Set(keptServers(aset, userServers).filter(([n, s]) => members.has(n) && denied.some((e) => denyMatches(e, n, s, ctx.env))).map(([n]) => n)));
}

/**
 * -> the new settings, the entries to add, the records to remove, the new record.
 * @param {Map<string, any>} data @param {Array<[Map<string, any>, string]>} want @param {Dict[]} prior
 */
export function planClaude(data, want, prior) {
  const denied = get(data, 'deniedMcpServers', []);
  if (!Array.isArray(denied)) throw new Refuse(3, 'its deniedMcpServers is not a list; left untouched');
  const ours = prior.map((p) => get(p, 'entry'));
  const wanted = want.map(([e]) => e);
  const keep = denied.filter((e) => pyIn(e, wanted) || !pyIn(e, ours));
  const add = want.filter(([e]) => !pyIn(e, denied));
  const gone = prior.filter((p) => !pyIn(get(p, 'entry'), wanted) && pyIn(get(p, 'entry'), denied));
  const record = want.filter(([e]) => pyIn(e, ours) || !pyIn(e, denied)).map(([e, label]) => dict([['entry', e], ['label', label]]));
  const next = dict(entries(data));
  const list = [...keep, ...add.map(([e]) => e)];
  // The key stays once present, empty or not: an owner's own [] is kept as written, and a list mhw emptied
  // stays as [], which blocks nothing (the meaning is restored, not the absence of the key).
  if (list.length || has(data, 'deniedMcpServers')) next.set('deniedMcpServers', list);
  return { next, add, gone, record };
}

// ------------------------------------------------------------------------------------------- the run

/** One write the original made through the renderer: an I/O error refuses the run (exit 3). @param {() => void} act @param {string} what */
function writing(act, what) {
  try {
    act();
  } catch (e) {
    if (e instanceof Refuse) throw e;
    throw new Refuse(3, 'cannot write ' + what + ' (' + msgOf(e) + ')');
  }
}

/** "%-7s %s: %s (%s) %s". @param {string} word */
const pad = (word) => word.padEnd(7);

class Run {
  /** @param {string} mode @param {ActiveSet} aset @param {string} stamp @param {Ctx} ctx */
  constructor(mode, aset, stamp, ctx) {
    this.mode = mode;
    this.aset = aset;
    this.stamp = stamp;
    this.ctx = ctx;
    this.status = 0;
    this.writing = mode === 'install' || mode === 'uninstall';
  }

  /** @param {string} word @param {string} surface @param {string} text @param {string} cfg */
  say(word, surface, text, cfg) {
    this.ctx.out(pad(word) + ' ' + surface + ': ' + text + ' (' + cfg + ') ' + TAG + '\n');
  }

  /** @param {string} surface @param {string} cfg @param {string} msg @param {number} [code] */
  refuse(surface, cfg, msg, code = 3) {
    this.ctx.err('REFUSE  ' + surface + ': ' + msg + ' (' + cfg + ') ' + TAG + '\n');
    this.status = Math.max(this.status, code);
  }

  /** Report or apply one surface's change. @param {string} surface @param {string} cfg @param {string} newText @param {string[]} off @param {string[]} back */
  change(surface, cfg, newText, off, back) {
    let parts;
    if (this.writing) {
      parts = [...(off.length ? ['turned off ' + names(off)] : []), ...(back.length ? ['turned back on ' + names(back)] : [])];
    } else {
      parts = [...(off.length ? ['on outside the set: ' + names(off) + '; install turns them off'] : []),
        ...(back.length ? ['turned off by mhw and no longer outside the set: ' + names(back) + '; install turns them back on'] : [])];
    }
    const text = parts.join('; ');
    if (this.mode === 'check') {
      this.say('DRIFT', surface, text, cfg);
      this.status = Math.max(this.status, 1);
    } else if (this.mode === 'dry-run') {
      this.say('WOULD', surface, 'would change: ' + text + '; backup ' + path.basename(cfg) + BACKUP, cfg);
    } else {
      const file = path.resolve(this.ctx.cwd, cfg);
      const existed = exists(file);
      writing(() => atomicWrite(file, newText, true, BACKUP, this.ctx), cfg);
      this.say('CHANGED', surface, text + (existed ? '; previous file kept as ' + cfg + BACKUP : ''), cfg);
    }
  }

  /** @param {string} surface @param {string} cfg @param {string[]} missing @param {string[]} offByHand @param {string[]} [blocked] */
  absent(surface, cfg, missing, offByHand, blocked = []) {
    if (this.mode === 'uninstall' || !this.aset.declared) return;
    const parts = [...(missing.length ? ['set member(s) not configured: ' + names(missing) + '; render them with mhw mcp render'] : []),
      ...(offByHand.length ? ['set member(s) turned off outside mhw: ' + names(offByHand)] : []),
      ...(blocked.length ? ['set member(s) blocked by a deniedMcpServers entry mhw did not write: ' + names(blocked)] : [])];
    if (parts.length) this.say('ABSENT', surface, parts.join('; '), cfg);
  }

  /** Report a set member whose local copy differs from the policy server's on this surface. @param {string} surface @param {string} cfg */
  conflict(surface, cfg) {
    if (this.mode === 'uninstall' || !this.aset.declared) return;
    const here = sorted([...this.aset.conflicts].filter(([, where]) => where.includes(surface)).map(([n]) => n));
    if (here.length) {
      this.say('REPORT', surface, "set member(s) whose local copy differs from the policy server's here, so the policy's copy runs "
        + 'and mhw mcp render refuses the local copy: ' + names(here), cfg);
    }
    const apart = sorted([...this.aset.divergent].filter(([, where]) => where.includes(surface)).map(([n]) => n));
    if (apart.length) {
      const on = sorted(new Set(apart.flatMap((n) => this.aset.policyWhere(n))));
      this.say('REPORT', surface, "set member(s) whose local copy here runs another command, args or env than the policy server's copy on "
        + on.join(', ') + ' (rendered, not refused; ADR-0038): ' + names(apart), cfg);
    }
  }

  /** The surface's config file, or null when the agent harness is not installed here. @param {string} surface */
  installed(surface) {
    const target = surfaceTarget(surface, this.ctx);
    if (target === null) return null;
    const [cfg, directory] = target;
    if (!isDir(path.resolve(this.ctx.cwd, directory)) && !exists(path.resolve(this.ctx.cwd, cfg))) {
      if (this.aset.declared) this.ctx.out('SKIP    ' + surface + ': not installed (' + directory + ' absent) ' + TAG + '\n');
      return null;
    }
    return cfg;
  }

  /** @param {string} surface @param {string} cfg @param {number} count */
  ok(surface, cfg, count) {
    if (this.aset.declared || count) this.say('OK', surface, 'nothing on outside the set (' + count + ' turned off by mhw)', cfg);
  }

  /** @param {Dict} prior */
  codex(prior) {
    const cfg = this.installed('codex');
    if (cfg === null) return prior;
    let text;
    try {
      text = readText(path.resolve(this.ctx.cwd, cfg));
    } catch (e) {
      if (e instanceof PyOSError && e.cls === 'FileNotFoundError') {
        this.absent('codex', cfg, this.aset.members('codex'), []);
        return dict();
      }
      this.refuse('codex', cfg, 'unreadable (' + clsOf(e) + '); left untouched');
      return prior;
    }
    let plan;
    try {
      plan = planCodex(text, this.aset, prior);
    } catch (e) {
      if (e instanceof TomlInvalid) this.refuse('codex', cfg, 'not valid TOML; left untouched');
      else if (e instanceof Refuse) this.refuse('codex', cfg, e.message, e.code);
      else throw e;
      return prior;
    }
    const { newText, add, restore, stuck, record, servers, lay } = plan;
    if (stuck.length) {
      this.refuse('codex', cfg, 'server(s) ' + names(stuck) + ' are not written as an [mcp_servers.<name>] table, so the switch '
        + 'cannot be added; turn them off by hand');
    }
    const missing = this.aset.members('codex').filter((n) => !has(servers, n));
    const byHand = sorted([...this.aset.servers].filter((n) => has(servers, n) && isD(get(servers, n))
      && get(get(servers, n), 'enabled', true) === false && (lay.get(n)?.mark ?? null) === null));
    this.absent('codex', cfg, missing, byHand);
    this.conflict('codex', cfg);
    if (newText === text) {
      this.ok('codex', cfg, record.size);
      return record;
    }
    this.change('codex', cfg, newText, add, restore);
    return this.writing ? record : prior;
  }

  /** @param {Dict} prior */
  kiro(prior) {
    const cfg = this.installed('kiro');
    if (cfg === null) return prior;
    let existed;
    let data;
    try {
      [existed, data] = readJsonObject(path.resolve(this.ctx.cwd, cfg));
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      this.refuse('kiro', cfg, e.message, e.code);
      return prior;
    }
    const servers = get(data, 'mcpServers', dict());
    if (!isD(servers)) {
      this.refuse('kiro', cfg, 'its mcpServers is not an object; left untouched');
      return prior;
    }
    const { next, add, back, record } = planKiro(data, this.aset, prior);
    const missing = this.aset.members('kiro').filter((n) => !has(servers, n));
    const byHand = sorted([...this.aset.servers].filter((n) => isD(get(servers, n)) && get(get(servers, n), 'disabled') === true && !has(prior, n)));
    this.absent('kiro', cfg, missing, byHand);
    this.conflict('kiro', cfg);
    if (!(add.length || back.length) || !existed) {
      this.ok('kiro', cfg, record.size);
      return record;
    }
    this.change('kiro', cfg, dumps(next, { indent: 2, sortKeys: false }) + '\n', add, back);
    return this.writing ? record : prior;
  }

  /** @param {Dict[]} prior */
  claude(prior) {
    const h = home(this.ctx);
    const userCfg = this.installed('claude-code');
    if (userCfg === null) return prior;
    const cfg = path.join(h, '.claude', 'settings.json');
    let user;
    let data;
    try {
      user = readJsonObject(path.resolve(this.ctx.cwd, userCfg))[1];
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      this.refuse('claude-code', userCfg, e.message, e.code);
      return prior;
    }
    try {
      data = readJsonObject(path.resolve(this.ctx.cwd, cfg))[1];
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      this.refuse('claude-code', cfg, e.message, e.code);
      return prior;
    }
    let userServers = get(user, 'mcpServers', dict());
    userServers = isD(userServers) ? userServers : dict();
    const { want, stuck, collide } = wantedDenies(this.aset, userServers, pluginServers(h, this.ctx), this.ctx);
    let plan;
    try {
      plan = planClaude(data, want, prior);
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      this.refuse('claude-code', cfg, e.message, e.code);
      return prior;
    }
    const { next, add, gone, record } = plan;
    if (stuck.length && this.mode !== 'uninstall') {
      this.say('REPORT', 'claude-code', 'on outside the set, a plugin server with no documented match (a ${VAR}, a wildcard or a '
        + 'credential-looking value in its URL or command), so it is not denied: ' + names(stuck), cfg);
    }
    if (collide.length && this.mode !== 'uninstall') {
      this.say('REPORT', 'claude-code', 'on outside the set, a plugin server with the same command, or a URL on the same host, as a '
        + 'server kept on, so it is not denied (the deny would block both): ' + names(collide), cfg);
    }
    const blocked = blockedMembers(this.aset, userServers, next.get('deniedMcpServers') ?? [], this.ctx);
    this.absent('claude-code', userCfg, this.aset.members('claude-code').filter((n) => !has(userServers, n)), [], blocked);
    this.conflict('claude-code', userCfg);
    if (this.aset.on.length && this.mode !== 'uninstall') {
      this.ctx.out('NOTE    claude-code: ' + this.aset.on.length + ' claude.ai connector(s) declared on; connectors are account-level, so '
        + 'whether they are connected cannot be read here (' + cfg + ') ' + TAG + '\n');
    }
    if (!(add.length || gone.length)) {
      this.ok('claude-code', cfg, record.length);
      return record;
    }
    this.change('claude-code', cfg, dumps(next, { indent: 2, sortKeys: false }) + '\n', add.map(([, label]) => label), gone.map((p) => get(p, 'label')));
    return this.writing ? record : prior;
  }

  desktop() {
    if (this.mode === 'uninstall' || !this.aset.declared) return;
    const cfg = this.installed('claude-desktop');
    if (cfg === null) return;
    let data;
    try {
      data = readJsonObject(path.resolve(this.ctx.cwd, cfg))[1];
    } catch (e) {
      if (!(e instanceof Refuse)) throw e;
      this.refuse('claude-desktop', cfg, e.message, e.code);
      return;
    }
    const raw = get(data, 'mcpServers', dict());
    const servers = isD(raw) ? raw : dict();
    const outside = sorted(keysOf(servers).filter((n) => this.aset.outside('claude-desktop', n)));
    if (outside.length) this.say('REPORT', 'claude-desktop', 'on outside the set, no native switch for one server (remove it by hand): ' + names(outside), cfg);
    this.absent('claude-desktop', cfg, this.aset.members('claude-desktop').filter((n) => !has(servers, n)), []);
    this.conflict('claude-desktop', cfg);
  }
}

/**
 * The renderer's facts about the declared set, for the definition at source, or with none (source null):
 * a committable or invalid definition is refused (exit 2).
 * @param {string | null} source @param {Ctx} ctx
 */
function facts(source, ctx) {
  let doc = null;
  if (source !== null) {
    if (committable(source, ctx)) {
      throw new Refuse(2, source + ' is inside a git work tree and not ignored, so it could be committed. The definition '
        + 'lives only in the untracked local overlay');
    }
    doc = loadSource(source, ctx);
  }
  return activeFacts(doc, ctx);
}

/** os.path.lexists. @param {string} p */
function lexists(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/** The set the run works on: none on uninstall or with no definition. @param {string} mode @param {string | null} source @param {Ctx} ctx */
export function loadSet(mode, source, ctx) {
  if (mode === 'uninstall') return new ActiveSet(facts(null, ctx));
  const p = source || defaultSource(ctx);
  if (!lexists(path.resolve(ctx.cwd, p))) {
    ctx.out('SKIP    MCP active set: no local MCP definition at ' + p + ', so nothing is turned off ' + TAG + '\n');
    return new ActiveSet(facts(null, ctx));
  }
  const f = facts(p, ctx);
  if (!f.get('declared')) ctx.out('SKIP    MCP active set: not declared in ' + p + ' (no "active_set"), so nothing is turned off ' + TAG + '\n');
  return new ActiveSet(f);
}

/** The manifest's "active" record has the shape this file writes. @param {unknown} prior */
export function validRecord(prior) {
  if (!isD(prior)) return false;
  const codex = get(prior, 'codex', dict());
  const kiro = get(prior, 'kiro', dict());
  const claude = get(prior, 'claude-code', []);
  return isD(codex) && entries(codex).every(([, v]) => v === null || typeof v === 'string')
    && isD(kiro) && entries(kiro).every(([, v]) => Array.isArray(v) && v.length <= 1)
    && Array.isArray(claude) && claude.every((p) => isD(p) && isD(get(p, 'entry')) && typeof get(p, 'label') === 'string');
}

/**
 * One run of the active set, as global/install.sh reads its exit code.
 * @param {string} mode @param {string | null} stamp @param {string | null} source @param {Ctx} ctx @returns {number}
 */
export function activeRun(mode, stamp, source, ctx) {
  if (ctx.platform === 'win32') {
    ctx.out('SKIP    MCP active set: not applied on Windows ' + TAG + '\n');
    return 0;
  }
  const mdoc = loadManifestDoc(ctx);
  const prior = get(mdoc, 'active', dict());
  if (!validRecord(prior)) throw new Refuse(3, 'the managed-server manifest ' + manifestPath(ctx) + ' has an unexpected shape');
  const aset = loadSet(mode, source, ctx);
  const run = new Run(mode, aset, stamp || provenance(ctx), ctx);
  /** @type {Map<string, any>} */
  let record = dict([
    ['codex', run.codex(get(prior, 'codex', dict()))],
    ['kiro', run.kiro(get(prior, 'kiro', dict()))],
    ['claude-code', run.claude(get(prior, 'claude-code', []))],
  ]);
  run.desktop();
  if (run.writing) {
    record = dict(entries(record).filter(([, v]) => truthy(v)));
    if (record.size) record.set('stamp', run.stamp);
    if (!pyEq(record, prior)) {
      if (record.size) mdoc.set('active', record);
      else mdoc.delete('active');
      const file = path.resolve(ctx.cwd, manifestPath(ctx));
      if (MANIFEST_KEYS.some((k) => truthy(get(mdoc, k)))) writing(() => writeManifest(mdoc, ctx), manifestPath(ctx));
      else if (exists(file)) {
        writing(() => fs.unlinkSync(file), manifestPath(ctx));
        ctx.out('REMOVED ' + manifestPath(ctx) + ' (it recorded only what the MCP active set turned off)\n');
      }
    }
  }
  return run.status;
}

