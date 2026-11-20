// `mhw mcp launch` (#483, S12 of #470): the MCP launcher's behaviour, on throwaway HOMEs and SYNTHETIC
// secrets only. Every keychain: read goes to test/helpers/security-stub.js (a JSON file it creates under
// the throwaway directory), never to the real security binary or the real Keychain: in process through
// plan()'s security argument, and as a process through test/helpers/mcp-launch-driver.js, which refuses
// any other path. The entries that use the real binary (bin/mhw.js and the file itself) are only ever
// run here with env: sources; run() refuses a keychain: source on them.
// Parity with the deleted global/mcp/mcp-launch.sh is test/mcp/launch-golden.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { plan, SECURITY, FORWARDED } from '../../src/commands/mcp-launch.js';
import { throwawayHome } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SRC = path.join(ROOT, 'src', 'commands', 'mcp-launch.js');
const BIN = path.join(ROOT, 'bin', 'mhw.js');
const STUB = path.join(ROOT, 'test', 'helpers', 'security-stub.js');
const DRIVER = path.join(ROOT, 'test', 'helpers', 'mcp-launch-driver.js');
const FAKE = path.join(ROOT, 'test', 'helpers', 'mcp-fake-server.js');
const NODE = process.execPath;
const POSIX = process.platform !== 'win32';
const posixOnly = POSIX ? {} : { skip: 'POSIX signals, the stub run as a program, and ps' };
// A launcher or server that hangs (a signal not forwarded, an orphan holding the pipes) is red, not stuck.
const bounded = { ...posixOnly, timeout: 30000 };
const h = throwawayHome('mcp-launch');
/** @type {import('node:child_process').ChildProcess[]} */
const started = [];
after(() => {
  for (const c of started) if (c.exitCode === null && c.signalCode === null) c.kill('SIGKILL');
  h.cleanup();
});
// The node running the suite first on PATH, so the stub's #!/usr/bin/env node finds it.
const BASE_ENV = { ...h.env, PATH: path.dirname(NODE) + path.delimiter + h.env.PATH };
/** A fresh synthetic secret value. */
const synthetic = () => 'synthetic-' + crypto.randomBytes(12).toString('hex');
/** @param {string} s */
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let seq = 0;
/** A fresh path under the throwaway directory. @param {string} name */
const fresh = (name) => path.join(h.dir, String(++seq) + '-' + name);

/**
 * The stub's keychain FILE under the throwaway directory, with items added through -i on stdin (so no
 * value is ever in the stub's argv). @param {Array<{ s: string, text?: string, hex?: string }>} items
 */
function keychain(items) {
  const kc = fresh('test.keychain-db');
  const lines = ['create-keychain "' + kc + '"'];
  for (const it of items) {
    lines.push('add-generic-password -s "' + it.s + '" -a "t" ' + (it.hex ? '-X "' + it.hex + '"' : '-w "' + it.text + '"') + ' "' + kc + '"');
  }
  const p = spawnSync(STUB, ['-i'], { input: lines.join('\n') + '\n', env: BASE_ENV });
  assert.equal(p.status, 0, String(p.stderr));
  return kc;
}

/**
 * @typedef {{ code: number | null, signal: NodeJS.Signals | null, stdout: Buffer, stderr: string, pid: number }} Result
 * @typedef {'driver' | 'cli' | 'file'} Entry
 */

/**
 * Start the launcher through one entry. Returns the child and a promise of its result.
 * @param {Entry} entry @param {string[]} args
 * @param {{ env?: Record<string, string>, input?: Buffer | string }} [o]
 */
function start(entry, args, o = {}) {
  if (entry !== 'driver' && args.some((a) => a.includes('=keychain:'))) {
    throw new Error('a keychain: source reaches the real security binary through ' + entry + '; use the driver');
  }
  const head = { driver: [DRIVER, STUB], cli: [BIN, 'mcp', 'launch'], file: [SRC] }[entry];
  const child = spawn(NODE, [...head, ...args], { env: o.env || BASE_ENV, stdio: ['pipe', 'pipe', 'pipe'] });
  started.push(child);
  /** @type {Buffer[]} */
  const out = [];
  /** @type {Buffer[]} */
  const err = [];
  child.stdout.on('data', (b) => out.push(b));
  child.stderr.on('data', (b) => err.push(b));
  if (o.input !== undefined) child.stdin.end(o.input);
  const done = /** @type {Promise<Result>} */ (new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({
      code, signal, stdout: Buffer.concat(out), stderr: Buffer.concat(err).toString('utf8'), pid: child.pid || 0,
    }));
  }));
  return { child, done };
}

/** @param {Entry} entry @param {string[]} args @param {{ env?: Record<string, string>, input?: Buffer | string }} [o] */
const run = (entry, args, o = {}) => start(entry, args, { input: '', ...o }).done;

/** Wait until file exists (a fake server's start mark). @param {string} file */
async function until(file, ms = 10000) {
  const end = Date.now() + ms;
  while (!fs.existsSync(file) || !fs.readFileSync(file, 'utf8')) {
    if (Date.now() > end) throw new Error('timed out waiting for ' + file);
    await new Promise((r) => setTimeout(r, 20));
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

/** @param {number} pid */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** @param {string[]} argv @param {Record<string, string | undefined>} env @param {string} [security] */
function refusal(argv, env, security) {
  try {
    plan(argv, env, security);
  } catch (e) {
    const r = /** @type {{ code: number, message: string }} */ (e);
    return { code: r.code, message: r.message };
  }
  return null;
}

// ------------------------------------------------------------------------------------------- refusals

test('every argument and source refusal stops before anything starts, naming NAME and SOURCE, never a value', () => {
  const env = { ...BASE_ENV, SET_ONE: 'x', EMPTY_ONE: '', NEWLINES: '\n\n' };
  const usage = "unexpected argument '--bogus' (usage: mhw mcp launch [--secret NAME=SOURCE]... -- command [args...])";
  /** @type {Array<[string[], number, string]>} */
  const cases = [
    [[], 2, 'no server command after --'],
    [['--'], 2, 'no server command after --'],
    [['--secret', 'A=env:SET_ONE'], 2, 'no server command after --'],
    [['--keychain'], 2, '--keychain needs an absolute path'],
    [['--keychain', 'relative.keychain-db', '--', 'x'], 2, "--keychain 'relative.keychain-db' is not an absolute path"],
    [['--keychain', '/', '--', 'x'], 2, "--keychain '/' is not an absolute path"],
    [['--secret', 'A=env:SET_ONE', '--keychain', '/k.keychain-db', '--', 'x'], 2, '--keychain must come before every --secret'],
    [['--secret', 'A=env:SET_ONE', '--keychain'], 2, '--keychain needs an absolute path'],
    [['--secret'], 2, '--secret needs NAME=SOURCE'],
    [['--secret', 'NOEQUALS', '--', 'x'], 2, "--secret 'NOEQUALS' is not NAME=SOURCE"],
    [['--secret', '1BAD=env:SET_ONE', '--', 'x'], 2, "secret name '1BAD' is not a valid environment variable name"],
    [['--secret', '=env:SET_ONE', '--', 'x'], 2, "secret name '' is not a valid environment variable name"],
    [['--secret', 'A-B=env:SET_ONE', '--', 'x'], 2, "secret name 'A-B' is not a valid environment variable name"],
    [['--secret', 'OK=file:/x', '--', 'x'], 2, "secret OK: unknown source 'file:/x' (use keychain:<service> or env:<VAR>)"],
    [['--secret', 'OK=env:', '--', 'x'], 2, "secret OK: unknown source 'env:' (use keychain:<service> or env:<VAR>)"],
    [['--secret', 'OK=keychain:', '--', 'x'], 2, "secret OK: unknown source 'keychain:' (use keychain:<service> or env:<VAR>)"],
    [['--secret', 'OK=env:BAD-NAME', '--', 'x'], 2, "secret OK: 'BAD-NAME' is not a valid environment variable name"],
    [['--secret', 'OK=env:UNSET_ONE', '--', 'x'], 3, "secret OK: environment variable UNSET_ONE is not set in the launcher's environment"],
    [['--secret', 'OK=env:EMPTY_ONE', '--', 'x'], 3, 'secret OK: the source env:EMPTY_ONE is empty'],
    [['--secret', 'OK=env:NEWLINES', '--', 'x'], 3, 'secret OK: the source env:NEWLINES is empty'],
    [['--bogus'], 2, usage],
    [['--secret', 'OK=keychain:svc', '--', 'x'], 2, 'secret OK: keychain: needs macOS (/usr/bin/security not found)'],
  ];
  for (const [argv, code, message] of cases) {
    const sec = argv.includes('OK=keychain:svc') ? path.join(h.dir, 'no-such-security') : STUB;
    assert.deepEqual(refusal(argv, env, sec), { code, message }, JSON.stringify(argv));
  }
});

// The names Object.prototype owns that a variable name can be (QA on PR #516, B1).
const PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).filter((n) => /^[A-Za-z_]\w*$/.test(n)).sort((a, b) => a.localeCompare(b));

test('a NAME or VAR that Object.prototype owns is an ordinary variable: set as NAME, unset as VAR', () => {
  assert.equal(PROTO_NAMES.length, 12, 'the reachable names: ' + PROTO_NAMES.join(' '));
  const v = synthetic();
  for (const n of PROTO_NAMES) {
    const p = plan(['--secret', n + '=env:SRC_VAR', '--', 'srv'], { ...BASE_ENV, SRC_VAR: v }, STUB);
    assert.ok(Object.hasOwn(p.childEnv, n), n + ': the secret was dropped');
    assert.equal(p.childEnv[n], v, n);
    assert.deepEqual(refusal(['--secret', 'X=env:' + n, '--', 'srv'], BASE_ENV, STUB), {
      code: 3, message: 'secret X: environment variable ' + n + " is not set in the launcher's environment",
    }, n);
  }
});

test('the server receives __proto__ and constructor as variables, by name', async () => {
  const v = synthetic();
  const r = await run('cli', ['--secret', '__proto__=env:SRC_VAR', '--secret', 'constructor=env:SRC_VAR', '--', NODE, FAKE, 'env', '-', '__proto__', 'constructor'], { env: { ...BASE_ENV, SRC_VAR: v } });
  assert.equal(r.code, 0, r.stderr);
  const got = JSON.parse(r.stdout.toString('utf8')).env;
  assert.ok(Object.hasOwn(got, '__proto__'), 'the server did not get __proto__');
  assert.equal(Object.getOwnPropertyDescriptor(got, '__proto__')?.value, sha(v));
  assert.equal(got.constructor, sha(v));
});

test('NODE_DEBUG refuses a launch that carries a secret, since node would print its environment', () => {
  const env = { ...BASE_ENV, SET_ONE: synthetic(), NODE_DEBUG: 'child_process' };
  const r = refusal(['--secret', 'A=env:SET_ONE', '--', 'x'], env, STUB);
  assert.equal(r && r.code, 2);
  assert.match(String(r && r.message), /^NODE_DEBUG is set/);
  assert.ok(!String(r && r.message).includes(env.SET_ONE));
  assert.equal(refusal(['--', 'x'], env, STUB), null, 'no secret, nothing to print: NODE_DEBUG is not refused');
  assert.equal(refusal(['--secret', 'A=env:SET_ONE', '--', 'x'], { ...env, NODE_DEBUG: '' }, STUB), null);
});

test('env: values reach the server environment, trailing newlines removed as $(...) did, in order', () => {
  const v = synthetic();
  /** @type {Record<string, string>} */
  const env = { ...BASE_ENV, SRC_ONE: v + '\n\n', INNER: 'a\nb' };
  const p = plan(['--secret', 'A=env:SRC_ONE', '--secret', 'B=env:A', '--secret', 'C=env:INNER', '--', 'srv', '--flag'], env, STUB);
  assert.equal(p.childEnv.A, v);
  assert.equal(p.childEnv.B, v, 'a later env: source sees an earlier secret, as the shell export did');
  assert.equal(p.childEnv.C, 'a\nb');
  assert.deepEqual(p.command, ['srv', '--flag']);
  assert.equal(env.A, undefined, "the launcher's own environment is not changed");
  const again = plan(['--secret', 'A=env:SRC_ONE', '--secret', 'A=env:INNER', '--', 'srv'], env, STUB);
  assert.equal(again.childEnv.A, 'a\nb', 'the last --secret of a name wins');
  assert.deepEqual(plan(['--keychain', '/a', '--keychain', '/b', '--', 'srv', '--', 'x'], env, STUB).command, ['srv', '--', 'x']);
});

// ------------------------------------------------------------------------- keychain:, on the Node stub

test('keychain: reads through security with --keychain on every call; absent, locked or hex stops', posixOnly, () => {
  const v = synthetic();
  const kc = keychain([{ s: 'svc.ok', text: v }, { s: 'svc.hex', hex: '0001ff41' }]);
  const log = fresh('security.log');
  const env = { ...BASE_ENV, SECURITY_STUB_LOG: log };
  const p = plan(['--keychain', kc, '--secret', 'TOKEN=keychain:svc.ok', '--', 'srv'], env, STUB);
  assert.equal(p.childEnv.TOKEN, v);
  const calls = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(calls.length, 2, 'the form (-g), then the value (-w)');
  assert.deepEqual(calls.map((c) => c.argv), [
    ['find-generic-password', '-s', 'svc.ok', '-g', kc],
    ['find-generic-password', '-s', 'svc.ok', '-w', kc],
  ]);
  assert.ok(calls.every((c) => c.home === h.home), 'security runs under the throwaway HOME');
  const absent = "secret TOKEN: no readable Keychain item for service 'svc.none' (absent, or the Keychain is locked)";
  assert.deepEqual(refusal(['--keychain', kc, '--secret', 'TOKEN=keychain:svc.none', '--', 'x'], env, STUB), { code: 3, message: absent });
  assert.deepEqual(refusal(['--keychain', kc, '--secret', 'TOKEN=keychain:svc.hex', '--', 'x'], env, STUB), {
    code: 3,
    message: "secret TOKEN: the Keychain value for 'svc.hex' is not printable text, and security would hand it over hex-encoded; store it as text",
  });
  // Without --keychain no keychain path is passed at all (production: the default search list). The stub
  // refuses a call with no keychain file, which the launcher reports as an absent item.
  const r = refusal(['--secret', 'TOKEN=keychain:svc.ok', '--', 'x'], env, STUB);
  assert.equal(r && r.code, 3);
  assert.deepEqual(JSON.parse(fs.readFileSync(log, 'utf8').trim().split('\n').at(-1) || '{}').argv, ['find-generic-password', '-s', 'svc.ok', '-g']);
  // A value that is only newlines is empty.
  const kc2 = keychain([{ s: 'svc.blank', text: '' }]);
  assert.deepEqual(refusal(['--keychain', kc2, '--secret', 'T=keychain:svc.blank', '--', 'x'], env, STUB), {
    code: 3, message: 'secret T: the source keychain:svc.blank is empty',
  });
  // Locked: the value read fails, so it stops.
  assert.equal(spawnSync(STUB, ['lock-keychain', kc], { env: BASE_ENV }).status, 0);
  assert.deepEqual(refusal(['--keychain', kc, '--secret', 'TOKEN=keychain:svc.ok', '--', 'x'], env, STUB), {
    code: 3, message: "secret TOKEN: no readable Keychain item for service 'svc.ok' (absent, or the Keychain is locked)",
  });
});

test('a -g form that succeeds while -w fails stops too (the second read is checked on its own)', posixOnly, () => {
  // A stand-in security: -g succeeds with a printable form, -w fails.
  const fake = fresh('security');
  fs.writeFileSync(fake, '#!/bin/sh\ncase "$*" in *" -g"*) echo \'password: "x"\' >&2; exit 0 ;; esac\nexit 44\n', { mode: 0o700 });
  assert.deepEqual(refusal(['--secret', 'T=keychain:svc', '--', 'x'], BASE_ENV, fake), {
    code: 3, message: "secret T: no readable Keychain item for service 'svc' (absent, or the Keychain is locked)",
  });
});

test('the launcher names security in one place and hands --keychain to every call it makes', () => {
  const code = fs.readFileSync(SRC, 'utf8').split('\n').filter((l) => !l.trimStart().startsWith('//'));
  assert.equal(code.join('\n').split(SECURITY).length - 1, 1, 'security is named once, as SECURITY');
  const reads = code.filter((l) => l.includes('spawnSync(security,'));
  assert.equal(reads.length, 2, 'the launcher\'s security calls changed; re-check the stub guard');
  for (const l of reads) assert.ok(l.includes('...kc'), 'a security call ignores --keychain: ' + l.trim());
  assert.equal(SECURITY, '/usr/bin/security');
});

// ------------------------------------------------------------------------- the process the harness sees

test('the argv rule: no secret value is in any child\'s argv, nor on stdout or stderr', bounded, async () => {
  const fromEnv = synthetic();
  const fromKc = synthetic();
  const kc = keychain([{ s: 'svc.argv', text: fromKc }]);
  const log = fresh('security.log');
  const mark = fresh('server.json');
  const env = { ...BASE_ENV, SECURITY_STUB_LOG: log, SRC_VAR: fromEnv };
  const { child, done } = start('driver', ['--keychain', kc, '--secret', 'A_TOKEN=env:SRC_VAR', '--secret', 'B_TOKEN=keychain:svc.argv', '--', NODE, FAKE, 'wait', mark], { env });
  const server = await until(mark);
  // Every process on the machine while the server runs: the launcher, the watcher, the server.
  const ps = spawnSync('ps', ['-A', '-o', 'args='], { encoding: 'utf8' });
  assert.equal(ps.status, 0);
  assert.ok(ps.stdout.includes(FAKE), 'calibration: ps lists the running server\'s argv');
  for (const v of [fromEnv, fromKc]) {
    assert.ok(!ps.stdout.includes(v), 'a secret value is in a running process\'s argv');
    assert.ok(!JSON.stringify(server.argv).includes(v), 'a secret value is in the server\'s argv');
  }
  child.kill('SIGTERM');
  const r = await done;
  const calls = fs.readFileSync(log, 'utf8');
  assert.ok(calls.includes('find-generic-password'), 'calibration: the stub logged the launcher\'s calls');
  for (const v of [fromEnv, fromKc]) {
    assert.ok(!calls.includes(v), 'a secret value is in security\'s argv');
    assert.ok(!r.stdout.includes(v) && !r.stderr.includes(v), 'the launcher printed a secret');
  }
  // Calibration: the same check sees a value that IS in an argv.
  const leak = synthetic();
  const mark2 = fresh('leak.json');
  const l = start('cli', ['--', NODE, FAKE, 'wait', mark2, leak]);
  await until(mark2);
  assert.ok(spawnSync('ps', ['-A', '-o', 'args='], { encoding: 'utf8' }).stdout.includes(leak), 'ps cannot see an argv value');
  l.child.kill('SIGTERM');
  await l.done;
});

test('the server gets the values by name, and its argv is exactly the command after --', async () => {
  const v = synthetic();
  const out = fresh('env.json');
  const r = await run('cli', ['--secret', 'A_TOKEN=env:SRC_VAR', '--', NODE, FAKE, 'env', out, 'A_TOKEN', 'SRC_VAR', 'UNSET_X'], { env: { ...BASE_ENV, SRC_VAR: v } });
  assert.equal(r.code, 0, r.stderr);
  const got = JSON.parse(fs.readFileSync(out, 'utf8'));
  assert.deepEqual(got.env, { A_TOKEN: sha(v), SRC_VAR: sha(v), UNSET_X: null });
  assert.deepEqual(got.argv, [FAKE, 'env', out, 'A_TOKEN', 'SRC_VAR', 'UNSET_X']);
  assert.equal(r.stderr, '');
  assert.equal(r.stdout.length, 0);
});

/** Every byte value, a CRLF, a lone CR and a NUL: what a text-mode copy would change. */
const BYTES = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from('{"jsonrpc":"2.0"}\r\n\r\0\n')]);

for (const entry of /** @type {Entry[]} */ (['cli', 'file', 'driver'])) {
  test('stdin and stdout pass through byte for byte (' + entry + ')', async () => {
    const r = await run(entry, ['--', NODE, FAKE, 'echo'], { input: BYTES });
    assert.equal(r.code, 0, r.stderr);
    assert.deepEqual(r.stdout, BYTES);
    assert.equal(r.stderr, '', 'the launcher wrote nothing of its own');
  });
}

test('the server\'s exit code is the launcher\'s: 0, 1 and 137', async () => {
  for (const n of [0, 1, 137]) {
    const r = await run('cli', ['--', NODE, FAKE, 'exit', String(n)]);
    assert.equal(r.code, n);
    assert.equal(r.signal, null);
  }
});

test('a server killed by a signal makes the launcher die of the same signal', bounded, async () => {
  for (const s of /** @type {NodeJS.Signals[]} */ (['SIGKILL', 'SIGTERM', 'SIGINT', 'SIGHUP'])) {
    const r = await run('cli', ['--', NODE, FAKE, 'signal', s]);
    assert.equal(r.signal, s, s + ': ' + r.stderr);
    assert.equal(r.code, null);
  }
});

test('SIGINT, SIGTERM and SIGHUP sent to the launcher reach the server, and its exit is the launcher\'s', bounded, async () => {
  // Every catchable signal exec used to deliver to the server (PR #516 QA B2a), SIGUSR1 by its own listener.
  assert.deepEqual([...FORWARDED], ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'SIGUSR2', 'SIGWINCH', 'SIGALRM', 'SIGPIPE']);
  for (const s of [...FORWARDED, /** @type {NodeJS.Signals} */ ('SIGUSR1')]) {
    const mark = fresh('trap.json');
    const { child, done } = start('file', ['--', NODE, FAKE, 'trap', mark]);
    await until(mark);
    child.kill(s);
    const r = await done;
    assert.equal(r.code, 0, s + ': the trapping server exits 0, and so does the launcher');
    assert.equal(fs.readFileSync(mark + '.sig', 'utf8'), s + '\n', s + ' reached the server once');
  }
  // With no handler in the server, the forwarded signal ends it, and the launcher dies of it too.
  const mark = fresh('wait.json');
  const { child, done } = start('cli', ['--', NODE, FAKE, 'wait', mark]);
  const server = await until(mark);
  child.kill('SIGTERM');
  const r = await done;
  assert.equal(r.signal, 'SIGTERM');
  assert.ok(!alive(server.pid), 'the server is gone');
});

test('a server dying of SIGUSR1 or SIGPIPE: the launcher exits 128+n and never opens the inspector', bounded, async () => {
  for (const s of /** @type {NodeJS.Signals[]} */ (['SIGUSR1', 'SIGPIPE'])) {
    // A shell, not the node fake: node itself opens the inspector on SIGUSR1 and ignores SIGPIPE.
    const r = await run('cli', ['--secret', 'T=env:SRC_VAR', '--', '/bin/sh', '-c', 'kill -' + s.slice(3) + ' $$'], { env: { ...BASE_ENV, SRC_VAR: synthetic() } });
    assert.equal(r.signal, null, s + ': not re-raised');
    assert.equal(r.code, 128 + os.constants.signals[s], s);
    assert.ok(!r.stderr.includes('Debugger listening'), s + ': the inspector opened: ' + r.stderr);
    assert.equal(r.stderr, '', s);
  }
});

test('SIGUSR1 sent to the launcher reaches the server and never opens the inspector', bounded, async () => {
  for (const entry of /** @type {Entry[]} */ (['cli', 'file'])) {
    const mark = fresh('usr1.json');
    const { child, done } = start(entry, ['--secret', 'T=env:SRC_VAR', '--', NODE, FAKE, 'trap', mark], { env: { ...BASE_ENV, SRC_VAR: synthetic() } });
    await until(mark);
    child.kill('SIGUSR1');
    const r = await done;
    assert.equal(r.code, 0, entry + ': ' + r.stderr);
    assert.equal(fs.readFileSync(mark + '.sig', 'utf8'), 'SIGUSR1\n', entry);
    assert.ok(!r.stderr.includes('Debugger listening'), entry + ': the inspector opened');
  }
});

test('no orphan: a server that ignores SIGTERM is killed once the grace period is over', bounded, async () => {
  const mark = fresh('stubborn.json');
  const { child, done } = start('cli', ['--', NODE, FAKE, 'stubborn', mark]);
  const server = await until(mark);
  const exited = new Promise((resolve) => child.once('exit', (_c, s) => resolve(s)));
  child.kill('SIGKILL');
  assert.equal(await exited, 'SIGKILL');
  await new Promise((res) => setTimeout(res, 500));
  assert.ok(alive(server.pid), 'calibration: the server outlives SIGTERM');
  const end = Date.now() + 8000;
  while (alive(server.pid) && Date.now() < end) await new Promise((res) => setTimeout(res, 50));
  const orphan = alive(server.pid);
  if (orphan) process.kill(server.pid, 'SIGKILL');
  assert.ok(!orphan, 'a server ignoring SIGTERM outlived its launcher: the SIGKILL escalation is gone');
  await done;
});

test('no orphan: a launcher killed with SIGKILL takes the server down with it', bounded, async () => {
  const mark = fresh('orphan.json');
  const { child, done } = start('cli', ['--', NODE, FAKE, 'wait', mark]);
  const server = await until(mark);
  assert.ok(alive(server.pid));
  // 'exit', not 'close': an orphan would hold the launcher's pipes open, and close would never come.
  const exited = new Promise((resolve) => child.once('exit', (_c, s) => resolve(s)));
  child.kill('SIGKILL');
  assert.equal(await exited, 'SIGKILL');
  const end = Date.now() + 10000;
  while (alive(server.pid) && Date.now() < end) await new Promise((res) => setTimeout(res, 25));
  const orphan = alive(server.pid);
  if (orphan) process.kill(server.pid, 'SIGKILL'); // never leave it behind, even when the test fails
  assert.ok(!orphan, 'the server outlived its launcher');
  await done;
});

test('a command that cannot start exits 127 with one line, and starts nothing', async () => {
  const r = await run('cli', ['--', path.join(h.dir, 'no-such-server')]);
  assert.equal(r.code, 127);
  assert.equal(r.stderr, "mcp-launch: cannot start '" + path.join(h.dir, 'no-such-server') + "': not found\n");
});

test('a file that is not executable exits 126', posixOnly, async () => {
  const f = fresh('not-executable');
  fs.writeFileSync(f, '#!/bin/sh\n', { mode: 0o600 });
  const r = await run('cli', ['--', f]);
  assert.equal(r.code, 126);
  assert.match(r.stderr, /^mcp-launch: cannot start '.*': EACCES\n$/);
});

test('a refusal through each entry prints one line and exits with its code, starting nothing', async () => {
  const mark = fresh('never.json');
  for (const entry of /** @type {Entry[]} */ (['cli', 'file', 'driver'])) {
    const r = await run(entry, ['--secret', 'OK=env:UNSET_ONE', '--', NODE, FAKE, 'wait', mark]);
    assert.equal(r.code, 3, entry);
    assert.equal(r.stderr, "mcp-launch: secret OK: environment variable UNSET_ONE is not set in the launcher's environment\n", entry);
    assert.equal(r.stdout.length, 0);
  }
  assert.ok(!fs.existsSync(mark), 'a server started after a refusal');
});

test('the copy the renderer installs (one marker line added, .mjs, anywhere) runs on its own', async () => {
  const dir = fresh('data');
  fs.mkdirSync(dir);
  const text = fs.readFileSync(SRC, 'utf8');
  const nl = text.indexOf('\n');
  const [first, rest] = [text.slice(0, nl), text.slice(nl + 1)];
  const copy = path.join(dir, 'mcp-launch.mjs');
  fs.writeFileSync(copy, first + '\n// managed-by: test; source: src/commands/mcp-launch.js\n' + rest, { mode: 0o700 });
  const child = spawnSync(NODE, [copy, '--', NODE, FAKE, 'echo'], { input: BYTES, env: BASE_ENV });
  assert.equal(child.status, 0, String(child.stderr));
  assert.deepEqual(child.stdout, BYTES);
  // Imported rather than run, it starts nothing.
  const imported = spawnSync(NODE, ['--input-type=module', '-e', 'await import(' + JSON.stringify(pathToFileURL(copy).href) + ')', '--', NODE, FAKE, 'exit', '9'], { env: BASE_ENV });
  assert.equal(imported.status, 0, String(imported.stderr));
});

test('mhw mcp without launch or render is a usage error', async () => {
  for (const args of [[], ['launchx'], ['--', 'x']]) {
    const p = spawnSync(NODE, [BIN, 'mcp', ...args], { env: BASE_ENV, encoding: 'utf8' });
    assert.equal(p.status, 2, JSON.stringify(args));
    assert.equal(p.stderr, 'usage: mhw mcp launch [--keychain PATH] [--secret NAME=SOURCE]... -- command [args...]\n'
      + '       mhw mcp render [--dry-run | --check | --scan | --policy ... | --active ...] (mhw mcp render --help)\n');
  }
});

test('the stub refuses a call without an absolute keychain path, and logs -i values redacted', posixOnly, () => {
  const log = fresh('stub.log');
  const env = { ...BASE_ENV, SECURITY_STUB_LOG: log };
  assert.equal(spawnSync(STUB, ['find-generic-password', '-s', 'x', '-w'], { env }).status, 64);
  assert.equal(spawnSync(STUB, ['find-generic-password', '-s', 'x', '-w', 'relative'], { env }).status, 64);
  const v = synthetic();
  const kc = fresh('k.keychain-db');
  assert.equal(spawnSync(STUB, ['-i'], { env, input: 'create-keychain "' + kc + '"\nadd-generic-password -s "s" -w "' + v + '" "' + kc + '"\n' }).status, 0);
  assert.ok(!fs.readFileSync(log, 'utf8').includes(v), 'the stub logged a value given on stdin');
  assert.equal(spawnSync(STUB, ['frobnicate', kc], { env }).status, 64, 'an unknown verb');
  assert.equal(spawnSync(STUB, [], { env }).status, 64, 'no verb');
  assert.equal(spawnSync(STUB, ['add-generic-password', '-s', 's', '-w', 'again', kc], { env }).status, 45, 'a duplicate item');
  assert.equal(spawnSync(STUB, ['delete-generic-password', '-s', 's', kc], { env }).status, 0);
  assert.equal(spawnSync(STUB, ['delete-generic-password', '-s', 's', kc], { env }).status, 44);
  assert.equal(spawnSync(STUB, ['delete-keychain', kc], { env }).status, 0);
  assert.ok(!fs.existsSync(kc));
  assert.equal(spawnSync(STUB, ['delete-keychain', kc], { env }).status, 50);
  assert.equal(spawnSync(STUB, ['find-generic-password', '-s', 's', '-w', kc], { env }).status, 50);
});
