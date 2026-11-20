#!/usr/bin/env node
// `mhw mcp launch` (#483, S12 of #470; it replaces global/mcp/mcp-launch.sh, ADR-0017). It starts one local
// MCP server with its credentials taken from the OS secret store at process start. The harness config
// that starts it holds only secret NAMES, never a value.
//
//   mhw mcp launch [--keychain PATH] [--secret NAME=SOURCE]... -- <server command> [server args...]
//
// global/mcp/mcp_render.py installs a copy of this file beside its other managed files and renders
// `<node> <that copy> --secret ... -- <command>`, so the file must run on its own: node: modules only.
//
// --keychain PATH names one keychain FILE that every keychain: read uses instead of the default search
// list. The renderer never writes it, so in use the launcher reads the login Keychain. It exists for the
// test suites, which must never touch the real Keychain (issue #58). It must come before any --secret
// and be an absolute path.
//
// SOURCE is one of:
//   keychain:<service>   macOS login Keychain, generic password with that service name, read with
//                        /usr/bin/security at launch. The value travels on that tool's stdout into this
//                        process, never through any process's argv.
//   env:<VAR>            the value of VAR in this process's own environment (indirection: the harness must
//                        forward VAR; Codex does it through env_vars, which the renderer writes).
//
// Each value is put into the server's environment as NAME. A missing or empty secret stops the launch,
// before the server starts, with a message naming NAME and its source, never the value. So does a set
// NODE_DEBUG, which would make node print the server's environment (see plan).
//
// Node cannot exec in place, so this process stays as the server's parent. The server inherits stdin,
// stdout and stderr themselves (no copy in between), so the server is still the process the harness
// talks to, byte for byte. The catchable signals exec used to deliver to the server are forwarded to it
// (FORWARDED, SIGUSR1); its exit code is this process's exit code, and a server killed by a signal makes
// this process die of the same signal, except SIGUSR1 and SIGPIPE (exit 128+n; see NOT_RERAISED). A
// small watcher process, holding nothing but a pipe from this process and the server's pid, stops the
// server if this process is killed in a way no handler sees (SIGKILL), so the server is never orphaned.
import fs from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { constants as osConstants } from 'node:os';
import { pathToFileURL } from 'node:url';

export const SECURITY = '/usr/bin/security';
const USAGE = 'mhw mcp launch [--secret NAME=SOURCE]... -- command [args...]';
const NAME_RE = /^[A-Za-z_]\w*$/;
// Under exec the server owned the harness's pid and received every signal sent to it. These are the
// catchable ones a sender uses; they are forwarded (SIGUSR1 too, by its own listener below). Not forwarded,
// declared in test/golden/S12/expected-differences.json: the job-control signals (SIGTSTP, SIGTTIN, SIGTTOU
// and SIGCONT stop or continue the launcher, not the server), and the ones a process raises against itself
// (SIGSEGV, SIGBUS, SIGFPE, SIGILL, SIGABRT, SIGTRAP, SIGSYS, SIGXCPU, SIGXFSZ) or a profiler or timer
// sends (SIGVTALRM, SIGPROF). Windows has three of them only.
export const FORWARDED = /** @type {NodeJS.Signals[]} */ (process.platform === 'win32'
  ? ['SIGINT', 'SIGTERM', 'SIGHUP']
  : ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGUSR2', 'SIGWINCH', 'SIGALRM', 'SIGPIPE']);
// SIGUSR1 is node's inspector trigger: with no listener, node opens a debugger on 127.0.0.1:9229 in the
// process that read the secrets (measured, PR #516 lens B1). The launcher always listens for it, so the
// inspector never opens, and forwards it to the server, which is where exec delivered it.
// SIGUSR1 and SIGPIPE are never re-raised on the launcher: node opens the inspector on the one and ignores
// the other, so a server that died of either makes the launcher exit 128+n instead.
export const NOT_RERAISED = new Set(['SIGUSR1', 'SIGPIPE']);
// How long the watcher waits after SIGTERM before SIGKILL, when this process died without a handler.
const GRACE_MS = 2000;
// The watcher: its stdin is a pipe from this process. A "d" byte means the server exited and this
// process is done; end of input without it means this process died, so the server is stopped.
const WATCHER = [
  'const pid = Number(process.argv[1]); let done = false;',
  'const stop = (s) => { try { process.kill(pid, s); } catch {} };',
  'process.stdin.on("data", (b) => { if (b.includes(100)) done = true; });',
  'process.stdin.on("error", () => {});',
  'const gone = () => { try { process.kill(pid, 0); return false; } catch { return true; } };',
  'process.stdin.on("close", () => { if (done) return; stop("SIGTERM");',
  ' const end = Date.now() + Number(process.argv[2]);',
  // Poll, so a server that stopped on SIGTERM is not sent SIGKILL (its pid could be reused).
  ' const t = setInterval(() => { if (gone()) clearInterval(t); else if (Date.now() >= end) { stop("SIGKILL"); clearInterval(t); } }, 50); });',
].join('\n');

class Refusal extends Error {
  /** @param {string} message @param {number} code */
  constructor(message, code) {
    super(message);
    this.code = code;
  }
}

/** @param {string} message @param {number} [code] @returns {never} */
function die(message, code = 2) {
  throw new Refusal(message, code);
}

/** Every trailing newline removed, as the shell's $(...) did. @param {string} s */
function chompAll(s) {
  let end = s.length;
  while (end > 0 && s[end - 1] === '\n') end--;
  return s.slice(0, end);
}

/** @param {string} path */
function executable(path) {
  try {
    fs.accessSync(path, fs.constants.X_OK);
    return fs.statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * One keychain: value, read with security by absolute path. The value is only on security's stdout.
 * @param {string} name @param {string} service @param {string} keychain '' for the default search list
 * @param {Record<string, string | undefined>} env @param {string} security
 */
function readKeychain(name, service, keychain, env, security) {
  if (!executable(security)) die('secret ' + name + ': keychain: needs macOS (' + SECURITY + ' not found)');
  const kc = keychain ? [keychain] : [];
  const absent = 'secret ' + name + ": no readable Keychain item for service '" + service + "' (absent, or the Keychain is locked)";
  // `-w` prints a non-printable value as hex, byte-identical to a printable value that happens to be hex
  // (measured), so the form is read first with -g, which marks the hex case "0x" on stderr.
  const form = spawnSync(security, ['find-generic-password', '-s', service, '-g', ...kc], { env, stdio: ['ignore', 'ignore', 'pipe'] });
  if (form.status !== 0) die(absent, 3);
  if (String(form.stderr).includes('password: 0x')) {
    die('secret ' + name + ": the Keychain value for '" + service + "' is not printable text, and security would hand it over hex-encoded; store it as text", 3);
  }
  const value = spawnSync(security, ['find-generic-password', '-s', service, '-w', ...kc], { env, stdio: ['ignore', 'pipe', 'ignore'] });
  if (value.status !== 0) die(absent, 3);
  return chompAll(String(value.stdout));
}

/**
 * The server's environment and command line, or a Refusal. Nothing is started here but security.
 * @param {string[]} argv @param {Record<string, string | undefined>} env @param {string} security
 * @returns {{ childEnv: Record<string, string | undefined>, command: string[] }}
 */
export function plan(argv, env, security = SECURITY) {
  // No prototype: a NAME or VAR from the contract may be any variable name, constructor and __proto__
  // included, and must read and write an own entry, never Object.prototype (PR #516 QA B1).
  /** @type {Record<string, string | undefined>} */
  const childEnv = Object.assign(Object.create(null), env);
  let keychain = '';
  let seenSecret = false;
  let i = 0;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '--keychain') {
      if (i + 1 >= argv.length) die('--keychain needs an absolute path');
      if (seenSecret) die('--keychain must come before every --secret');
      const p = argv[i + 1];
      if (!(p.startsWith('/') && p.length > 1)) die("--keychain '" + p + "' is not an absolute path");
      keychain = p;
      i += 2;
    } else if (arg === '--secret') {
      seenSecret = true;
      // Node's own tracing: NODE_DEBUG=child_process prints every spawn's environment, the server's and
      // its secrets included, on stderr, which harnesses keep in their MCP server logs (measured on node
      // 26). The shell launcher switched xtrace off for the same reason; Node reads NODE_DEBUG at startup,
      // so it cannot be switched off from here, and the launch is refused instead.
      if (env.NODE_DEBUG) die('NODE_DEBUG is set, and node would print every secret passed to the server on stderr; unset it for the launcher');
      if (i + 1 >= argv.length) die('--secret needs NAME=SOURCE');
      const spec = argv[i + 1];
      i += 2;
      const eq = spec.indexOf('=');
      if (eq < 0) die("--secret '" + spec + "' is not NAME=SOURCE");
      const name = spec.slice(0, eq);
      const src = spec.slice(eq + 1);
      if (!NAME_RE.test(name)) die("secret name '" + name + "' is not a valid environment variable name");
      let value;
      if (src.startsWith('keychain:') && src.length > 'keychain:'.length) {
        // security gets the launcher's own environment, without any value read so far.
        value = readKeychain(name, src.slice('keychain:'.length), keychain, env, security);
      } else if (src.startsWith('env:') && src.length > 'env:'.length) {
        const v = src.slice('env:'.length);
        if (!NAME_RE.test(v)) die('secret ' + name + ": '" + v + "' is not a valid environment variable name");
        // An earlier --secret is already in this environment, as the shell's export put it there.
        const found = Object.hasOwn(childEnv, v) ? childEnv[v] : undefined;
        if (found === undefined) die('secret ' + name + ': environment variable ' + v + " is not set in the launcher's environment", 3);
        value = chompAll(found);
      } else {
        die('secret ' + name + ": unknown source '" + src + "' (use keychain:<service> or env:<VAR>)");
      }
      if (!value) die('secret ' + name + ': the source ' + src + ' is empty', 3);
      childEnv[name] = value;
    } else if (arg === '--') {
      i += 1;
      break;
    } else {
      die("unexpected argument '" + arg + "' (usage: " + USAGE + ')');
    }
  }
  const command = argv.slice(i);
  if (!command.length) die('no server command after --');
  return { childEnv, command };
}

/** @param {string} message */
function say(message) {
  fs.writeSync(2, 'mcp-launch: ' + message + '\n');
}

/**
 * The shell's exit status for a process killed by signal, for the rare case re-raising it does not end
 * this process. @param {NodeJS.Signals} signal
 */
function signalStatus(signal) {
  const n = /** @type {Record<string, number>} */ (osConstants.signals)[signal];
  return 128 + (n || 0);
}

/**
 * Start the server and stay its parent until it exits. Returns the exit status of a refusal, or 0 once
 * the server is started; the real status is set (process.exitCode, or a re-raised signal) when it exits.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ security?: string }} [opts] security: tests only, a stub
 * @returns {number}
 */
export function main(argv, env, opts = {}) {
  // Installed first and never removed (see NOT_RERAISED): no SIGUSR1 can open the inspector.
  /** @type {{ child?: import('node:child_process').ChildProcess }} */
  const live = {};
  if (process.platform !== 'win32') {
    process.on('SIGUSR1', () => {
      try {
        if (live.child && live.child.exitCode === null && live.child.signalCode === null) live.child.kill('SIGUSR1');
      } catch {
        // the server is gone
      }
    });
  }
  let p;
  try {
    p = plan(argv, env, opts.security || SECURITY);
  } catch (e) {
    if (e instanceof Refusal) {
      say(e.message);
      return e.code;
    }
    throw e;
  }
  const [cmd, ...args] = p.command;
  const child = spawn(cmd, args, { env: p.childEnv, stdio: 'inherit' });
  live.child = child;
  /** @type {Array<[NodeJS.Signals, () => void]>} */
  const handlers = FORWARDED.map((s) => [s, () => {
    try {
      child.kill(s);
    } catch {
      // Windows: a signal it does not have; the server has been asked to stop already or is gone
    }
  }]);
  const unhook = () => { for (const [s, h] of handlers) process.removeListener(s, h); };
  child.once('error', (/** @type {NodeJS.ErrnoException} */ err) => {
    unhook();
    const missing = err.code === 'ENOENT';
    say("cannot start '" + cmd + "': " + (missing ? 'not found' : err.code || err.message));
    process.exitCode = missing ? 127 : 126;
  });
  if (child.pid === undefined) return 0; // the error event above sets the status
  for (const [s, h] of handlers) process.on(s, h);
  // The watcher gets the launcher's environment without any secret, and only the server's pid.
  const watcher = spawn(process.execPath, ['-e', WATCHER, String(child.pid), String(GRACE_MS)], {
    env, stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true,
  });
  watcher.unref();
  watcher.on('error', () => {});
  const toWatcher = /** @type {import('node:stream').Writable} */ (watcher.stdin);
  toWatcher.on('error', () => {});
  child.once('exit', (code, signal) => {
    unhook();
    const finish = () => {
      if (signal) {
        process.exitCode = signalStatus(signal);
        if (!NOT_RERAISED.has(signal)) process.kill(process.pid, signal);
      } else {
        process.exitCode = code === null ? 1 : code;
      }
    };
    // Tell the watcher the server is gone, then finish once its pipe is closed (or broken).
    let finished = false;
    const once = () => {
      if (finished) return;
      finished = true;
      finish();
    };
    toWatcher.once('close', once);
    if (toWatcher.destroyed) once();
    else toWatcher.end('d');
  });
  return 0;
}

/** True when this file is the program node was started with (also as the renderer's installed copy). */
function isProgram() {
  const meta = /** @type {{ main?: boolean, url: string }} */ (import.meta);
  if (typeof meta.main === 'boolean') return meta.main;
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return pathToFileURL(fs.realpathSync(entry)).href === meta.url;
  } catch {
    return false;
  }
}

if (isProgram()) process.exitCode = main(process.argv.slice(2), process.env);
