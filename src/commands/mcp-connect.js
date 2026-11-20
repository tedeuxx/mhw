// The MCP connection check (Issue #219, ADR-0041 amendment of 2026-10-24): the Node form of the deleted
// global/mcp/mcp_connect.py (#485, S14 of #470). Start each server of the declared active set as each agent
// harness has it configured, and say whether it answers an MCP initialize.
//
//   mhw mcp render --active --mode=connect [--timeout=SECONDS] [--source=FILE]
//   mhw status --mcp-connect[=SECONDS]
//
// Opt-in, never part of the default status: starting a server has side effects (a package fetch, a sign-in
// prompt, a process) and costs time. Per server and agent harness where it is enabled:
//
//   stdio   the configured command, args and env, spawned as the agent harness would (a secret-bearing server
//           through the Node launcher, mhw mcp launch (#483), which reads the secret itself; this probe never
//           reads one), in a new session, so it leads its own process group. One initialize request on stdin;
//           ok on the matching result, "fail: error response" on the matching error, "fail: exited <code>" or
//           "fail: timeout" otherwise. Then the whole process group is killed (SIGKILL), always.
//   http    a POST of the initialize request with a client User-Agent and no configured header (a header can
//           carry a credential, and this probe sends none): 2xx is ok, 401 with WWW-Authenticate is "needs
//           login" (reachable), anything else, or a network error, fails.
//   sse     a GET of the event stream, headers only: 2xx is ok, 401 as above.
//
// One line per server per agent harness, its name and its result. Never stderr, never a response body, never
// a URL or a command: they can carry values. Exit 1 when a set member fails, 0 otherwise. Only the set members
// are checked: a policy server outside the set and the exempt ones are not started (a policy server fetches a
// package at every start, and an exempt one belongs to its app).
//
// ${VAR} and ${VAR:-default} are expanded in a Claude Code or Kiro entry's command, args, env and URL, as those
// harnesses expand them; never in a Codex entry. The timeout is SECONDS (default 30) per server: a stdio
// server's whole run, and every connect or read of an http one. node: modules only.
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { pyStr, loads, cmpStr, PyFloat } from '../lib/py.js';
import { PROJECT, SURFACES, isD, get, home, surfaceTarget, tomlLoads, readJson, entries, keysOf } from '../render/mcp.js';

/** @typedef {import('../render/mcp.js').Ctx} Ctx @typedef {import('../render/mcp.js').Dict} Dict */
/** @typedef {import('./mcp-active.js').ActiveSet} ActiveSet */

export const TAG = '(MCP connect)';
export const DEFAULT_TIMEOUT = 30;
export const USER_AGENT = 'mhw-mcp-connect/1 (+' + PROJECT + ')';
export const INITIALIZE = {
  jsonrpc: '2.0', id: 1, method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mhw-mcp-connect', version: '1' } },
};
// json.dumps(INITIALIZE): CPython's default separators.
export const INITIALIZE_TEXT = '{"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", '
  + '"capabilities": {}, "clientInfo": {"name": "mhw-mcp-connect", "version": "1"}}}';
const VAR_RE = /\$\{([A-Za-z_]\w*)(?::-([^}]*))?\}/g;
// How long a server that exited may stay silent on stdout before its exit is the result (a child it left
// behind can hold stdout open): the original's poll interval.
const QUIET_MS = 500;
// How long the kill waits for the leader to be reaped.
const REAP_MS = 5000;
// urllib's redirect limits (HTTPRedirectHandler.max_redirections and max_repeats).
const MAX_REDIRECTIONS = 10;
const MAX_REPEATS = 4;

/** ${VAR} and ${VAR:-default}, as Claude Code and Kiro expand a configured value. @param {string} value @param {Record<string, string | undefined>} env */
export function expand(value, env) {
  return value.replaceAll(VAR_RE, (_m, /** @type {string} */ name, /** @type {string | undefined} */ dflt) => {
    const v = Object.hasOwn(env, name) ? env[name] : undefined;
    return v || dflt || '';
  });
}

/** A JSON file's object, or null when it is absent, unreadable, not JSON or not an object. @param {string} file */
function quietObject(file) {
  let data;
  try {
    data = readJson(file);
  } catch {
    return null;
  }
  return isD(data) ? data : null;
}

/** tomllib.load(open(p, "rb")): the bytes decoded strictly, no newline translation; null on any failure. @param {string} file */
function quietToml(file) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(fs.readFileSync(file));
    return tomlLoads(text);
  } catch {
    return null;
  }
}

/**
 * name -> the entry this agent harness has, enabled only; null when its file cannot be read.
 * @param {string} surface @param {Ctx} ctx @returns {Map<string, Dict> | null}
 */
export function configured(surface, ctx) {
  const target = surfaceTarget(surface, ctx);
  if (target === null) return new Map();
  const file = path.resolve(ctx.cwd, target[0]);
  if (!fs.existsSync(file)) return new Map();
  /** @type {unknown} */
  let servers;
  /** @type {[string | null, unknown]} */
  let off;
  if (surface === 'codex') {
    const doc = quietToml(file);
    if (doc === null) return null;
    servers = get(doc, 'mcp_servers', {});
    off = ['enabled', false];
  } else {
    const data = quietObject(file);
    if (data === null) return null;
    servers = get(data, 'mcpServers', new Map());
    off = surface === 'kiro' ? ['disabled', true] : [null, null];
  }
  if (!isD(servers)) return null;
  const [key, value] = off;
  return new Map(entries(servers).filter(([, s]) => isD(s) && (key === null || get(s, key) !== value)));
}

/**
 * [argv, env] for a stdio entry, or null when it has no command.
 * @param {string} surface @param {Dict} entry @param {Record<string, string | undefined>} base
 * @returns {[string[], Record<string, string>] | null}
 */
export function stdioCommand(surface, entry, base) {
  const command = get(entry, 'command');
  const args = get(entry, 'args', []);
  if (typeof command !== 'string' || !command || !Array.isArray(args)) return null;
  /** @type {Record<string, string>} */
  const env = Object.create(null);
  for (const [k, v] of Object.entries(base)) if (v !== undefined) env[k] = v;
  const raw = get(entry, 'env');
  const extra = isD(raw) ? raw : new Map();
  const expanding = surface === 'claude-code' || surface === 'kiro';
  for (const k of keysOf(extra)) {
    const v = pyStr(get(extra, k));
    env[k] = expanding ? expand(v, env) : v;
  }
  let argv = [command, ...args.map((a) => pyStr(a))];
  if (expanding) argv = argv.map((a) => expand(a, env));
  return [argv, env];
}

/**
 * The verdict of one stdout line, when it answers the initialize: "ok", "fail: error response", or null.
 * The line is read as json.loads reads bytes: strict UTF-8, and CPython's JSON (NaN and Infinity included).
 * @param {Buffer} line
 */
export function verdict(line) {
  let m;
  try {
    m = loads(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(line));
  } catch {
    return null;
  }
  if (!isD(m) || !idIsOne(get(m, 'id'))) return null;
  return keysOf(m).includes('result') ? 'ok' : 'fail: error response';
}
/** m.get("id") == 1 in Python: 1, 1.0 and True are all equal to 1. @param {unknown} id */
const idIsOne = (id) => id === 1 || id === 1n || id === true || (id instanceof PyFloat && id.v === 1);

/**
 * Kill the server's whole process group, always: a leader that exited first can leave a child behind in its
 * group (the new session gave the group the leader's pid, which stays the group's id while a member lives).
 * An empty group is not an error.
 * @param {import('node:child_process').ChildProcess} p @param {Ctx} ctx
 */
async function stop(p, ctx) {
  try {
    if (ctx.platform === 'win32') throw new Error('no process groups');
    process.kill(-/** @type {number} */ (p.pid), 'SIGKILL');
  } catch (e) {
    const code = /** @type {NodeJS.ErrnoException} */ (e).code;
    // An empty group (ESRCH) or one this user may not signal (EPERM) is left as it is, as the original did.
    if (code !== 'ESRCH' && code !== 'EPERM' && p.exitCode === null && p.signalCode === null) p.kill('SIGKILL');
  }
  if (p.exitCode === null && p.signalCode === null) {
    await new Promise((resolve) => {
      const t = setTimeout(resolve, REAP_MS);
      p.once('exit', () => {
        clearTimeout(t);
        resolve(undefined);
      });
    });
  }
  for (const s of [p.stdin, p.stdout]) s?.destroy();
  p.unref(); // a server that outlived the kill does not hold this process open
}

/** The exit code as Python's Popen.returncode gives it: the status, or -N for a signal. @param {import('node:child_process').ChildProcess} p */
function returncode(p) {
  if (p.exitCode !== null) return p.exitCode;
  const sig = p.signalCode;
  const n = sig ? /** @type {Record<string, number>} */ (constants.signals)[sig] : undefined;
  return n ? -n : -1;
}

/**
 * -> "ok" or "fail: ...". stderr is discarded; stdout is read for the matching response only.
 * @param {string[]} argv @param {Record<string, string>} env @param {number} timeout seconds @param {Ctx} ctx
 * @returns {Promise<string>}
 */
export async function probeStdio(argv, env, timeout, ctx) {
  /** @type {import('node:child_process').ChildProcess} */
  let p;
  try {
    p = spawn(argv[0], argv.slice(1), { stdio: ['pipe', 'pipe', 'ignore'], env, cwd: home(ctx), detached: ctx.platform !== 'win32' });
  } catch {
    return 'fail: could not start';
  }
  const started = await new Promise((resolve) => {
    p.once('spawn', () => resolve(true));
    p.once('error', () => resolve(false));
  });
  if (!started) {
    for (const s of [p.stdin, p.stdout]) s?.destroy();
    return 'fail: could not start';
  }
  try {
    return await awaitResponse(p, Date.now() + timeout * 1000);
  } finally {
    await stop(p, ctx);
  }
}

/**
 * One initialize line on stdin, then the first matching line on stdout, a timeout, or the leader's exit.
 * @param {import('node:child_process').ChildProcess} p @param {number} deadline epoch ms @returns {Promise<string>}
 */
function awaitResponse(p, deadline) {
  return new Promise((resolve) => {
    /** @type {NodeJS.Timeout[]} */
    const timers = [];
    let done = false;
    let buf = Buffer.alloc(0);
    let exited = p.exitCode !== null || p.signalCode !== null;
    /** @type {NodeJS.Timeout | null} */
    let quiet = null;
    /** @param {string} v */
    const finish = (v) => {
      if (done) return;
      done = true;
      for (const t of timers) clearTimeout(t);
      if (quiet) clearTimeout(quiet);
      resolve(v);
    };
    const armQuiet = () => {
      if (quiet) clearTimeout(quiet);
      if (exited) quiet = setTimeout(() => finish('fail: exited ' + returncode(p)), Math.max(0, Math.min(QUIET_MS, deadline - Date.now())));
    };
    timers.push(setTimeout(() => finish('fail: timeout'), Math.max(0, deadline - Date.now())));
    const stdin = /** @type {import('node:stream').Writable} */ (p.stdin);
    stdin.on('error', () => {}); // it exited before reading: reported from its exit code
    stdin.write(INITIALIZE_TEXT + '\n');
    const stdout = /** @type {import('node:stream').Readable} */ (p.stdout);
    stdout.on('data', (/** @type {Buffer} */ chunk) => {
      buf = Buffer.concat([buf, chunk]);
      let nl;
      while (!done && (nl = buf.indexOf(0x0a)) >= 0) {
        const line = buf.subarray(0, nl);
        buf = buf.subarray(nl + 1);
        const v = verdict(line);
        if (v) finish(v);
      }
      armQuiet();
    });
    stdout.on('error', () => {});
    stdout.on('end', () => {
      if (done) return;
      if (exited) {
        finish('fail: exited ' + returncode(p));
        return;
      }
      // End of output before the leader exited: wait for its exit until the deadline (at least 0.1 s), and
      // a leader still running then is "exited -1", not a timeout (the original's Popen.wait).
      for (const t of timers.splice(0)) clearTimeout(t);
      timers.push(setTimeout(() => finish('fail: exited -1'), Math.max(100, deadline - Date.now())));
      p.once('exit', () => finish('fail: exited ' + returncode(p)));
    });
    p.once('exit', () => {
      exited = true;
      armQuiet();
    });
    if (exited) armQuiet();
  });
}

/**
 * One HTTP request, headers only: [status, WWW-Authenticate value, Location value]. Rejects on a network
 * error or when the socket is idle for the timeout.
 * @param {URL} url @param {string} method @param {Record<string, string>} headers @param {string | null} body @param {number} timeout seconds
 * @returns {Promise<[number, string, string]>}
 */
function request(url, method, headers, body, timeout) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(url, { method, headers, agent: false });
    req.setTimeout(timeout * 1000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
    req.on('response', (res) => {
      const auth = res.headers['www-authenticate'];
      const loc = res.headers.location ?? res.headers.uri;
      resolve([res.statusCode ?? 0, Array.isArray(auth) ? auth.join(', ') : auth ?? '', Array.isArray(loc) ? loc[0] : loc ?? '']);
      res.destroy();
      req.destroy();
    });
    req.end(body ?? undefined);
  });
}

/**
 * -> "ok", "needs login" or "fail: ...". Only the status line and two header names are read. Redirects are
 * followed as urllib follows them: a GET on 301, 302, 303, 307 and 308, a POST on 301, 302 and 303 (as a GET,
 * no body); a POST on 307 or 308, a loop, or more than ten fail with that status.
 * @param {string} url @param {string} kind "http" or "sse" @param {number} timeout seconds
 */
export async function probeHttp(url, kind, timeout) {
  /** @type {URL} */
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'fail: unreachable';
  }
  let method = kind === 'sse' ? 'GET' : 'POST';
  /** @type {Record<string, string>} */
  let headers = kind === 'sse'
    ? { Accept: 'text/event-stream', 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity', Connection: 'close' }
    : { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'User-Agent': USER_AGENT, 'Accept-Encoding': 'identity', Connection: 'close' };
  /** @type {string | null} */
  let body = kind === 'sse' ? null : INITIALIZE_TEXT;
  /** @type {Map<string, number>} */
  const visited = new Map();
  for (;;) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'fail: unreachable';
    if (body !== null) headers = { ...headers, 'Content-Length': String(Buffer.byteLength(body)) };
    let status;
    let auth;
    let location;
    try {
      [status, auth, location] = await request(u, method, headers, body, timeout);
    } catch {
      return 'fail: unreachable';
    }
    if (status === 401 && auth) return 'needs login';
    if (status >= 200 && status < 300) return 'ok';
    const redirect = [301, 302, 303, 307, 308].includes(status);
    if (!redirect || !location) return 'fail: http ' + status;
    if (method === 'POST' && (status === 307 || status === 308)) return 'fail: http ' + status;
    let next;
    try {
      next = new URL(location, u);
    } catch {
      return 'fail: http ' + status;
    }
    if (next.protocol !== 'http:' && next.protocol !== 'https:') return 'fail: http ' + status;
    const key = next.href;
    if ((visited.get(key) ?? 0) >= MAX_REPEATS || visited.size >= MAX_REDIRECTIONS) return 'fail: http ' + status;
    visited.set(key, (visited.get(key) ?? 0) + 1);
    if (method === 'POST') {
      method = 'GET';
      body = null;
      const { 'Content-Type': _type, 'Content-Length': _length, ...rest } = headers;
      headers = rest;
    }
    u = next;
  }
}

/**
 * One server on one agent harness.
 * @param {string} surface @param {Dict} entry @param {number} timeout @param {Ctx} ctx @returns {Promise<string>}
 */
export async function probe(surface, entry, timeout, ctx) {
  const url = get(entry, 'url');
  const kind = pyTruthy(get(entry, 'type')) ? get(entry, 'type') : pyTruthy(get(entry, 'transport')) ? get(entry, 'transport') : typeof url === 'string' ? 'http' : 'stdio';
  if (typeof url === 'string' && url) {
    const u = surface === 'claude-code' || surface === 'kiro' ? expand(url, ctx.env) : url;
    return probeHttp(u, kind === 'sse' ? 'sse' : 'http', timeout);
  }
  const spawnArgs = stdioCommand(surface, entry, ctx.env);
  if (spawnArgs === null) return 'fail: no command or URL';
  return probeStdio(spawnArgs[0], spawnArgs[1], timeout, ctx);
}

/** Truthiness of a JSON or TOML value. @param {unknown} v */
function pyTruthy(v) {
  if (v === null || v === undefined || v === false || v === '' || v === 0 || v === 0n) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (isD(v)) return keysOf(v).length > 0;
  if (v instanceof PyFloat) return v.v !== 0;
  return true;
}

/**
 * -> exit code: 1 when a set member fails, 0 otherwise (an undeclared set has nothing to check).
 * @param {ActiveSet} aset @param {number} timeout seconds @param {Ctx} ctx @returns {Promise<number>}
 */
export async function connect(aset, timeout, ctx) {
  if (ctx.platform === 'win32') {
    ctx.out('SKIP    MCP connect: not available on Windows ' + TAG + '\n');
    return 0;
  }
  if (!aset.declared) {
    ctx.out('SKIP    MCP connect: no active set is declared, so there is nothing to check ' + TAG + '\n');
    return 0;
  }
  let status = 0;
  for (const surface of SURFACES) {
    const servers = configured(surface, ctx);
    if (servers === null) {
      ctx.out('SKIP    ' + surface + ': its configuration could not be read ' + TAG + '\n');
      continue;
    }
    const members = [...aset.servers].filter((n) => servers.has(n)).sort(cmpStr);
    for (const n of members) {
      const result = await probe(surface, /** @type {Dict} */ (servers.get(n)), timeout, ctx);
      const failed = result.startsWith('fail');
      ctx.out((failed ? 'FAIL' : 'OK').padEnd(7) + ' ' + surface + ': ' + n + ': ' + result + ' ' + TAG + '\n');
      if (failed) status = 1;
    }
    const target = surfaceTarget(surface, ctx);
    if (!members.length && target !== null && fs.existsSync(path.resolve(ctx.cwd, target[0]))) {
      ctx.out('NOTE    ' + surface + ': no set member is enabled here ' + TAG + '\n');
    }
  }
  return status;
}
