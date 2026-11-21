// The prompt hook and add-term (#488, S17 of #470), beyond the parity golden (hook-golden.test.js): the
// fail-open class pinned OUT OF PROCESS (a hook that cannot load, a stalled read, a planted NODE_OPTIONS),
// the salt file's modes and secrecy, the migration away from the Keychain salt, add-term's refusals and its
// terminal handling on a real pty. Throwaway HOMEs and directories only; the Keychain is never touched.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import * as core from '../../src/lib/clean.js';
import * as hook from '../../src/commands/hook-prompt.js';
import * as addTerm from '../../src/commands/add-term.js';
import { pasteWrap, pasteCmd } from '../../src/commands/install-user.js';
import { saltOrCreate, readSalt, orphanedLists, addTermHashes } from '../../src/lib/salt.js';
import { loadPty } from '../../src/lib/pty.js';
import { ROOT } from '../helpers/s15.js';
import { SALT, TERM, EMAIL, CREDENTIALS } from '../helpers/s17.js';

const POSIX = process.platform !== 'win32';
const MHW = path.join(ROOT, 'bin', 'mhw.js');
const PTY = loadPty({ env: {} });
const LIVE_REQUIRED = process.env.MHW_S17_LIVE_REQUIRED === '1';
/** @type {Array<() => void>} */
const cleanups = [];
after(() => cleanups.forEach((f) => f()));

function fresh() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s17h-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A throwaway home with a clipboard.conf naming files under it. @param {Record<string, string>} [over] */
function box(over = {}) {
  const dir = fresh();
  const home = path.join(dir, 'home');
  fs.mkdirSync(home);
  const lo = path.join(dir, 'lo');
  const lines = ['terms_file=' + path.join(lo, 'terms'), 'salt_file=' + path.join(lo, 'salt'),
    'health_terms_file=' + path.join(lo, 'th'), 'colleague_terms_file=' + path.join(lo, 'tc'),
    ...Object.entries(over).map(([k, v]) => k + '=' + v)];
  const confPath = path.join(dir, 'clipboard.conf');
  fs.writeFileSync(confPath, lines.join('\n') + '\n');
  const conf = hook.loadConfig(confPath);
  /** @type {Record<string, string>} */
  const env = { HOME: home, PATH: '/usr/bin:/bin', LC_ALL: 'C' };
  return { dir, home, lo, confPath, conf, env };
}

/** A term list hashed with the box's salt file (created). @param {ReturnType<typeof box>} b */
function withTerm(b) {
  const { salt } = saltOrCreate(b.conf);
  addTermHashes(b.conf.terms_file, core.termForms(TERM).map((f) => core.termHash(salt, f)));
  return salt;
}

/** @param {string} prompt */
const payload = (prompt) => JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt });

/**
 * The hook as a process, through bin/mhw.js. @param {string[]} args @param {string} input @param {Record<string, string>} env
 */
function hookProcess(args, input, env) {
  return spawnSync(process.execPath, [MHW, 'hook', 'prompt', ...args], { input, env, encoding: 'utf8', timeout: 60000 });
}

/** Every file under d with its size and mtime: what "nothing was written" is checked against. @param {string} d */
function tree(d) {
  /** @type {string[]} */
  const out = [];
  for (const e of fs.readdirSync(d, { recursive: true, withFileTypes: true })) {
    const p = path.join(e.parentPath, e.name);
    const st = fs.lstatSync(p);
    out.push(p + ' ' + st.size + ' ' + st.mtimeMs);
  }
  return out.sort((a, b) => (a < b ? -1 : Number(a > b)));
}

// ------------------------------------------------------------------- the hook, out of process

test('a hook process blocks a finding, passes a clean prompt silently, and follows the wrapper marker', { skip: !POSIX && 'POSIX' }, () => {
  const b = box();
  withTerm(b);
  const dirty = payload('deploy for ' + TERM + ' with ' + CREDENTIALS.github + ', mail ' + EMAIL);
  for (const harness of ['claude', 'codex']) {
    let r = hookProcess(['--harness', harness, '--config', b.confPath], dirty, b.env);
    assert.equal(r.status, 0);
    assert.equal(r.stderr, '');
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block');
    assert.match(out.reason, /employer-client-term, credential, email/);
    assert.ok(!r.stdout.toLowerCase().includes('quillon') && !r.stdout.includes(CREDENTIALS.github) && !r.stdout.includes(EMAIL));
    r = hookProcess(['--harness', harness, '--config', b.confPath], payload('ship it'), b.env);
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], 'a clean prompt printed something');
    r = hookProcess(['--harness', harness, '--config', b.confPath], dirty, { ...b.env, [hook.WRAPPER_MARKER]: '1' });
    assert.deepEqual([r.status, r.stdout, r.stderr], [0, '', ''], 'a wrapped session is passed silently');
    r = hookProcess(['--harness', harness, '--config', b.confPath], dirty, { ...b.env, [hook.WRAPPER_MARKER]: 'yes' });
    assert.equal(JSON.parse(r.stdout).decision, 'block', 'only the exact marker value counts');
  }
  // Kiro: exit 2, the redacted copy on stderr, nothing on stdout, and the marker does not silence it.
  for (const env of [b.env, { ...b.env, [hook.WRAPPER_MARKER]: '1' }]) {
    const r = hookProcess(['--harness', 'kiro', '--config', b.confPath], dirty, env);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /It was NOT sent/);
    assert.match(r.stderr, /\[REDACTED:credential\]/);
  }
});

test('the hook writes nothing, starts no process, and the salt reaches no output', { skip: !POSIX && 'POSIX' }, () => {
  const b = box();
  const salt = withTerm(b);
  const fakes = path.join(b.dir, 'fakebin');
  fs.mkdirSync(fakes);
  const calls = path.join(b.dir, 'calls');
  for (const tool of ['pbcopy', 'pbpaste', 'osascript', 'security', 'launchctl', 'python3', 'stty']) {
    fs.writeFileSync(path.join(fakes, tool), '#!/bin/sh\necho "' + tool + '" >> "' + calls + '"\n', { mode: 0o755 });
  }
  const env = { ...b.env, PATH: fakes + ':/usr/bin:/bin', TMPDIR: b.home };
  const snap = tree(b.dir);
  for (const [prompt, blocked] of /** @type {Array<[string, boolean]>} */ ([['ship it for ' + TERM, true], ['ship it', false]])) {
    for (const harness of ['claude', 'codex', 'kiro']) {
      const r = hookProcess(['--harness', harness, '--config', b.confPath], payload(prompt), env);
      assert.ok(!(r.stdout + r.stderr).includes(salt), 'the salt reached the output');
      if (blocked) assert.match(r.stdout + r.stderr, /employer-client-term/, harness);
      else assert.equal(r.stdout + r.stderr, '', harness);
    }
  }
  assert.deepEqual(tree(b.dir), snap, 'the hook wrote to disk');
  assert.ok(!fs.existsSync(calls), 'the hook started a process: ' + (fs.existsSync(calls) ? fs.readFileSync(calls, 'utf8') : ''));
});

test('a hook that cannot load its cleaner warns visibly, never passes silently (missing file, syntax error)', { skip: !POSIX && 'POSIX' }, () => {
  for (const [label, body, cls] of /** @type {Array<[string, string | null, RegExp]>} */ ([
    ['missing', null, /internal error \(Error\)/],
    ['syntax', 'export const x = ;\n', /internal error \(SyntaxError\)/],
    ['throws', 'throw new TypeError("boom");\n', /internal error \(TypeError\)/],
  ])) {
    const d = path.join(fresh(), 'hook');
    fs.mkdirSync(d);
    fs.writeFileSync(path.join(d, 'package.json'), '{"type": "module"}\n');
    fs.copyFileSync(path.join(ROOT, 'src', 'commands', 'hook-entry.js'), path.join(d, 'hook-entry.js'));
    if (body !== null) fs.writeFileSync(path.join(d, 'hook-prompt.js'), body);
    for (const harness of ['claude', 'codex']) {
      const r = spawnSync(process.execPath, [path.join(d, 'hook-entry.js'), '--harness', harness], { input: payload('mail ' + EMAIL), encoding: 'utf8', timeout: 30000 });
      assert.equal(r.status, 0, label);
      const out = JSON.parse(r.stdout);
      assert.deepEqual(Object.keys(out), ['systemMessage'], label);
      assert.match(out.systemMessage, /this prompt was NOT checked/, label);
      assert.match(out.systemMessage, cls, label);
      assert.ok(!r.stdout.includes(EMAIL) && !r.stderr.includes('boom'), 'the error message or the input reached the output');
    }
    const k = spawnSync(process.execPath, [path.join(d, 'hook-entry.js'), '--harness', 'kiro'], { input: payload('x'), encoding: 'utf8', timeout: 30000 });
    assert.deepEqual([k.status, k.stdout], [0, ''], label + ' kiro');
    assert.match(k.stderr, /this prompt was NOT checked/, label + ' kiro');
  }
});

test('a stalled payload read gives the error notice at the deadline, not the harness timeout', { skip: !POSIX && 'POSIX' }, async () => {
  const b = box();
  for (const harness of ['claude', 'kiro']) {
    const t0 = Date.now();
    const child = spawn(process.execPath, [MHW, 'hook', 'prompt', '--harness', harness, '--config', b.confPath],
      { env: { ...b.env, MHW_HOOK_TEST: '1', MHW_HOOK_DEADLINE_MS: '300' }, stdio: ['pipe', 'pipe', 'pipe'] });
    child.stdin.write('{"prompt": "never closed'); // stdin stays open
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => { out += c; });
    child.stderr.on('data', (c) => { err += c; });
    const code = await new Promise((resolve) => child.on('exit', resolve));
    child.stdin.destroy();
    assert.ok(Date.now() - t0 < 15000, 'the hook did not give up by itself');
    assert.equal(code, 0);
    if (harness === 'kiro') {
      assert.equal(out, '');
      assert.match(err, /internal error \(TimeoutError\); this prompt was NOT checked/);
    } else {
      assert.deepEqual(JSON.parse(out), { systemMessage: 'Paste filter (ADR-0033): internal error (TimeoutError); this prompt was NOT checked.' });
    }
  }
  assert.equal(hook.deadlineOf({ MHW_HOOK_TEST: '1', MHW_HOOK_DEADLINE_MS: '999999999' }), hook.DEADLINE_MS, 'the variable cannot lengthen the wait');
  assert.equal(hook.deadlineOf({ MHW_HOOK_TEST: '1', MHW_HOOK_DEADLINE_MS: 'x' }), hook.DEADLINE_MS);
  assert.equal(hook.deadlineOf({ MHW_HOOK_TEST: '1', MHW_HOOK_DEADLINE_MS: '50' }), 50);
  assert.equal(hook.deadlineOf({ MHW_HOOK_DEADLINE_MS: '1' }), hook.DEADLINE_MS, 'the session variable alone is ignored');
});

/** The user-layer installer's start fallback (mhw install-user's pasteWrap; install.sh's paste_wrap until #503). */
const wrap = pasteWrap;
/** The hook command the user-layer installer renders, for a node and an entry. @param {string} harness @param {string} conf @param {string} [node] @param {string} [entry] */
const rendered = (harness, conf, node = process.execPath, entry = MHW) => pasteCmd(harness, node, entry, conf);
/** install-managed.sh's own start-fallback function (paste_wrap), read from it, so the test runs the real thing. */
const MANAGED_SH = fs.readFileSync(path.join(ROOT, 'global', 'install-managed.sh'), 'utf8');
const WRAP_FN = MANAGED_SH.slice(MANAGED_SH.indexOf("PASTE_START_NOTICE='"), MANAGED_SH.indexOf('\n}\n', MANAGED_SH.indexOf('paste_wrap() {')) + 3);
/** The command as install-managed.sh renders it. @param {string} harness @param {string} cmd */
function managedWrap(harness, cmd) {
  const p = spawnSync('/bin/sh', ['-c', WRAP_FN + '\npaste_wrap "$1" "$2"', 'sh', harness, cmd], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout;
}

// PR #536 lens B3: an entry or node that is missing or does not start still gives the NOT-checked answer in
// the harness's protocol (Claude Code and Codex: the notice JSON, exit 0; Kiro: exit 2 with the notice on
// stderr), and a healthy hook's output and exit code pass through unchanged.
test('the rendered command\'s start fallback: a hook that cannot start says NOT checked; a healthy one is unchanged', { skip: !POSIX && 'POSIX' }, () => {
  const b = box();
  withTerm(b);
  const notice = 'Paste filter (ADR-0033): internal error (HookStartError); this prompt was NOT checked.';
  const broken = path.join(b.dir, 'broken.js');
  fs.writeFileSync(broken, 'this is not javascript (\n');
  const starts = [['entry missing', process.execPath, path.join(b.dir, 'gone', 'bin', 'mhw.js')], ['node missing', path.join(b.dir, 'no-node'), MHW],
    ['entry does not parse', process.execPath, broken]];
  for (const harness of ['claude', 'codex', 'kiro']) {
    for (const [label, node, entry] of starts) {
      const r = spawnSync('/bin/sh', ['-c', rendered(harness, b.confPath, node, entry)], { input: payload('mail ' + EMAIL), env: b.env, encoding: 'utf8' });
      if (harness === 'kiro') {
        assert.equal(r.status, 2, label + '/kiro: a start failure blocks');
        assert.ok(r.stderr.includes(notice), label + '/kiro: ' + r.stderr);
        assert.equal(r.stdout, '', label + '/kiro writes nothing to stdout');
      } else {
        assert.equal(r.status, 0, label + '/' + harness);
        assert.deepEqual(JSON.parse(r.stdout), { systemMessage: notice }, label + '/' + harness);
      }
    }
    // Healthy: exactly what the hook itself answers, for a block, a clean prompt and a warning.
    for (const prompt of ['notes for ' + TERM, 'ship it', 'see [REDACTED:email]']) {
      const direct = hookProcess(['--harness', harness, '--config', b.confPath], payload(prompt), b.env);
      const viaShell = spawnSync('/bin/sh', ['-c', rendered(harness, b.confPath)], { input: payload(prompt), env: b.env, encoding: 'utf8' });
      assert.deepEqual([viaShell.status, viaShell.stdout, viaShell.stderr], [direct.status, direct.stdout, direct.stderr], harness + ': ' + prompt);
    }
  }
  // The command splits into the same words with a shell-like splitter (a harness that does not use a shell):
  // /bin/sh, -c and one script.
  const cmd = rendered('claude', b.confPath);
  assert.ok(cmd.startsWith("/bin/sh -c '") && cmd.endsWith("'") && cmd.slice(12, -1).indexOf("'") < 0, cmd);
  // The exact forms, which .github/scripts/prod_canary.py spells out for Kiro rather than run the installer's code.
  assert.equal(wrap('kiro', 'X'), "/bin/sh -c 'X || { [ $? -eq 2 ] && exit 2; printf \"%s\\n\" \"" + notice + "\" >&2; exit 2; }'");
  assert.equal(wrap('claude', 'X'), "/bin/sh -c 'X || { printf \"%s\\n\" \"{\\\"systemMessage\\\": \\\"" + notice + "\\\"}\"; exit 0; }'");
  const canary = fs.readFileSync(path.join(ROOT, '.github', 'scripts', 'prod_canary.py'), 'utf8');
  assert.ok(canary.includes(`want = "/bin/sh -c '%s || { [ $? -eq 2 ] && exit 2; printf \\"%%s\\\\n\\" \\"%s\\" >&2; exit 2; }'" % (inner, notice)`)
    && canary.includes('notice = "' + notice + '"'), 'prod_canary.py no longer spells out the Kiro fallback the installer renders');
  // install-managed.sh's shell function renders exactly what the user-layer installer renders.
  assert.ok(WRAP_FN.startsWith("PASTE_START_NOTICE='" + notice + "'") && WRAP_FN.includes('paste_wrap() {'), 'install-managed.sh lost its paste_wrap');
  for (const harness of ['claude', 'codex', 'kiro']) {
    for (const cmd of ['X', rendered(harness, b.confPath).slice(12, -1).split(' || ')[0]]) assert.equal(managedWrap(harness, cmd), wrap(harness, cmd), harness);
  }
});

test('the rendered hook command names node by absolute path and clears NODE_OPTIONS: a planted --require never runs', { skip: !POSIX && 'POSIX' }, () => {
  const b = box();
  const marker = path.join(b.dir, 'planted-ran');
  const plant = path.join(b.dir, 'plant.cjs');
  fs.writeFileSync(plant, 'require("fs").writeFileSync(' + JSON.stringify(marker) + ', "x");\n');
  const env = { ...b.env, NODE_OPTIONS: '--require ' + plant };
  // Calibration: without the clearing, the plant runs.
  const raw = spawnSync('/bin/sh', ['-c', '"' + process.execPath + '" "' + MHW + '" hook prompt --harness claude --config "' + b.confPath + '"'],
    { input: payload('ship it'), env, encoding: 'utf8' });
  assert.equal(raw.status, 0);
  assert.ok(fs.existsSync(marker), 'calibration: the planted file did not run without the clearing');
  fs.rmSync(marker);
  for (const harness of ['claude', 'codex', 'kiro']) {
    const cmd = rendered(harness, b.confPath);
    assert.ok(path.isAbsolute(process.execPath) && cmd.startsWith("/bin/sh -c '/usr/bin/env -u NODE_OPTIONS "));
    const r = spawnSync('/bin/sh', ['-c', cmd], { input: payload('mail ' + EMAIL), env, encoding: 'utf8' });
    assert.ok(!fs.existsSync(marker), harness + ': the planted --require ran');
    assert.match(r.stdout + r.stderr, /email in this prompt/, harness);
  }
  // NODE_COMPILE_CACHE (PR #536 lens): node writes and reads a compiled cache there when it is set; cleared,
  // nothing is written. Calibrated: without the clearing, the cache directory fills.
  const cache = path.join(b.dir, 'compile-cache');
  const cenv = { ...b.env, NODE_COMPILE_CACHE: cache };
  spawnSync('/bin/sh', ['-c', '"' + process.execPath + '" "' + MHW + '" hook prompt --harness claude --config "' + b.confPath + '"'], { input: payload('x'), env: cenv });
  assert.ok(fs.existsSync(cache) && fs.readdirSync(cache).length > 0, 'calibration: node wrote no compile cache without the clearing');
  fs.rmSync(cache, { recursive: true, force: true });
  spawnSync('/bin/sh', ['-c', rendered('claude', b.confPath)], { input: payload('x'), env: cenv });
  assert.ok(!fs.existsSync(cache), 'the rendered command let node use NODE_COMPILE_CACHE');
  // The user-layer installer renders exactly this form.
  assert.equal(pasteCmd('claude', '/N', '/E', '/C'), pasteWrap('claude', '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "/N" "/E" hook prompt --harness claude --config "/C"'),
    'the installer no longer renders the hook command this test runs');
});

test('the hook source names no clipboard, dialog, notification or launchd tool, and no Keychain', () => {
  for (const f of ['src/commands/hook-prompt.js', 'src/commands/hook-entry.js', 'src/lib/salt.js', 'src/lib/clean.js', 'src/commands/add-term.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const name of ['pbcopy', 'pbpaste', 'osascript', 'NSPasteboard', 'launchctl', 'display dialog', 'display notification', 'LaunchAgents',
      '/usr/bin/security', 'python3', 'child_process']) {
      if (name === 'child_process' && f === 'src/commands/add-term.js') continue; // add-term runs /bin/stty on the terminal
      assert.ok(!src.includes(name), f + ' names ' + name);
    }
  }
});

// PR #536 QA B1: a term list or the salt file holding a byte that is not ASCII. The original raised
// UnicodeDecodeError into its handler and said NOT checked; the hook must never pass such a prompt silently.
test('an undecodable term list or salt file gives the NOT-checked notice on every harness, never a silent pass', { skip: !POSIX && 'POSIX' }, () => {
  for (const key of ['terms_file', 'health_terms_file', 'colleague_terms_file', 'salt_file']) {
    const b = box();
    withTerm(b);
    fs.appendFileSync(b.conf[key], Buffer.from([0x23, 0x0a, 0xe9, 0x0a]));
    for (const harness of ['claude', 'codex', 'kiro']) {
      const r = hookProcess(['--harness', harness, '--config', b.confPath], payload('notes for ' + TERM), b.env);
      assert.notEqual(r.stdout + r.stderr, '', key + '/' + harness + ': a silent pass');
      assert.match(r.stdout + r.stderr, /internal error \(UnicodeDecodeError\); this prompt was NOT checked\./, key + '/' + harness);
      assert.equal(r.status, 0, key + '/' + harness);
    }
  }
});

// PR #536 QA B2: every branch that turns an exception into the notice, one row each, out of process where
// it can be. Each row: the notice, the class name only, and neither the message nor the input in the output.
test('every error branch of the hook prints the notice by class, never the message or the input', { skip: !POSIX && 'POSIX' }, async () => {
  const secret = 'SECRET-' + TERM;
  const input = payload('mail ' + EMAIL);
  /** @param {string} out @param {RegExp} cls @param {string} label */
  const check = (out, cls, label) => {
    assert.match(out, /this prompt was NOT checked\./, label);
    assert.match(out, cls, label);
    assert.ok(!out.includes('SECRET') && !out.includes(EMAIL) && !out.toLowerCase().includes('quillon'), label + ': the message or the input leaked');
  };
  // 1. main() throws, with a message that quotes the input (hook-entry.js, the catch around main()).
  const d = path.join(fresh(), 'hook');
  fs.mkdirSync(d);
  fs.writeFileSync(path.join(d, 'package.json'), '{"type": "module"}\n');
  fs.copyFileSync(path.join(ROOT, 'src', 'commands', 'hook-entry.js'), path.join(d, 'hook-entry.js'));
  fs.writeFileSync(path.join(d, 'hook-prompt.js'), 'export async function main() { throw new RangeError(' + JSON.stringify(secret) + '); }\n');
  for (const harness of ['claude', 'kiro']) {
    const r = spawnSync(process.execPath, [path.join(d, 'hook-entry.js'), '--harness', harness], { input, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, 'main throws/' + harness);
    check(r.stdout + r.stderr, /internal error \(RangeError\)/, 'main throws/' + harness);
    if (harness === 'kiro') assert.equal(r.stdout, '');
  }
  // 2. bin/mhw.js cannot import hook-entry.js (its own catch).
  const pkg = path.join(fresh(), 'pkg');
  fs.mkdirSync(path.join(pkg, 'bin'), { recursive: true });
  fs.writeFileSync(path.join(pkg, 'package.json'), '{"type": "module"}\n');
  fs.copyFileSync(MHW, path.join(pkg, 'bin', 'mhw.js'));
  for (const harness of ['claude', 'codex', 'kiro']) {
    const r = spawnSync(process.execPath, [path.join(pkg, 'bin', 'mhw.js'), 'hook', 'prompt', '--harness', harness], { input, encoding: 'utf8', timeout: 30000 });
    assert.equal(r.status, 0, 'no entry/' + harness);
    check(r.stdout + r.stderr, /internal error \(Error\)/, 'no entry/' + harness);
    if (harness === 'kiro') assert.equal(r.stdout, '');
    else assert.deepEqual(Object.keys(JSON.parse(r.stdout)), ['systemMessage']);
  }
  // 3. stdin emits an error (hook-prompt.js, the catch around the payload read).
  const b = box();
  const { Readable } = await import('node:stream');
  for (const harness of ['claude', 'kiro']) {
    const stdin = new Readable({ read() { this.destroy(new TypeError(secret)); } });
    const r = await hook.run(['--harness', harness, '--config', b.confPath], b.env, { stdin });
    check(r.stdout + r.stderr, /internal error \(TypeError\)/, 'stdin error/' + harness);
  }
  // 4. a plain Error whose message quotes the input (errorClass's fallback: the class, never the message).
  for (const harness of ['claude', 'kiro']) {
    withTerm(b);
    const r = await hook.run(['--harness', harness, '--config', b.confPath], b.env,
      { stdin: Readable.from([Buffer.from(payload('notes for ' + TERM))]), salts: { get: () => { throw new Error(secret); } } });
    check(r.stdout + r.stderr, /internal error \(Error\)/, 'plain Error/' + harness);
  }
  assert.equal(hook.errorClass(new Error(secret)), 'Error');
  assert.equal(hook.errorClass({ message: secret }), 'Error');
});

// ------------------------------------------------------------------- the salt file

test('the salt is a 0600 file in a 0700 directory, created atomically, and a bad salt is no salt', { skip: !POSIX && 'POSIX file modes' }, () => {
  const b = box();
  assert.equal(readSalt(b.conf).salt, null);
  const first = saltOrCreate(b.conf);
  assert.equal(first.created, true);
  assert.match(first.salt, /^[0-9a-f]{64}$/);
  assert.equal(fs.statSync(b.conf.salt_file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(b.conf.salt_file)).mode & 0o777, 0o700);
  assert.deepEqual(saltOrCreate(b.conf), { salt: first.salt, created: false });
  assert.deepEqual(fs.readdirSync(path.dirname(b.conf.salt_file)), ['salt'], 'a temporary file was left behind');
  fs.writeFileSync(b.conf.salt_file, 'not-a-salt\n');
  assert.equal(readSalt(b.conf).salt, null);
  fs.writeFileSync(b.conf.salt_file, SALT + '\n');
  fs.chmodSync(b.conf.salt_file, 0o000);
  if (spawnSync('/usr/bin/id', ['-u'], { encoding: 'utf8' }).stdout.trim() !== '0') assert.equal(readSalt(b.conf).salt, null, 'an unreadable salt file');
  fs.chmodSync(b.conf.salt_file, 0o600);
});

test('a missing or unreadable salt file gives the visible notice; generic categories still block', { skip: !POSIX && 'POSIX' }, () => {
  const b = box();
  addTermHashes(b.conf.terms_file, core.termForms(TERM).map((f) => core.termHash(SALT, f)));
  for (const state of ['missing', 'unreadable']) {
    if (state === 'unreadable') {
      fs.writeFileSync(b.conf.salt_file, SALT + '\n', { mode: 0o000 });
      fs.chmodSync(b.conf.salt_file, 0o000);
      if (spawnSync('/usr/bin/id', ['-u'], { encoding: 'utf8' }).stdout.trim() === '0') continue;
    }
    let r = hookProcess(['--harness', 'claude', '--config', b.confPath], payload('notes for ' + TERM), b.env);
    assert.match(JSON.parse(r.stdout).systemMessage, /salt file could not be read .* term matching was NOT checked/, state);
    r = hookProcess(['--harness', 'claude', '--config', b.confPath], payload('key ' + CREDENTIALS.aws), b.env);
    const out = JSON.parse(r.stdout);
    assert.equal(out.decision, 'block', state);
    assert.match(out.reason, /term matching was NOT checked/, state);
  }
});

test('the migration: a term list hashed with the old Keychain salt is named, moved aside, and re-added terms match', { skip: !POSIX && 'POSIX' }, () => {
  const b = box();
  const old = 'ab'.repeat(32); // a salt this machine no longer has
  addTermHashes(b.conf.terms_file, core.termForms('Old Zyxw').map((f) => core.termHash(old, f)));
  addTermHashes(b.conf.health_terms_file, core.termForms('Old Quillonitis').map((f) => core.termHash(old, f)));
  assert.deepEqual(orphanedLists(b.conf), [[b.conf.terms_file, 2], [b.conf.health_terms_file, 2]]);
  const r = addTerm.addEntered(b.conf, TERM, TERM, 'employer-client-term');
  assert.equal(r.code, 0);
  assert.match(r.out, /NOTE {4}2 hash\(es\) in .*terms were made with a salt mhw no longer has .*moved to .*terms\.old-salt\. Re-add each/);
  assert.match(r.out, /NOTE {4}2 hash\(es\) in .*th were made with a salt/);
  assert.match(r.out, /added: 2 new hash\(es\) to /);
  assert.ok(fs.existsSync(b.conf.terms_file + '.old-salt') && fs.existsSync(b.conf.health_terms_file + '.old-salt'));
  assert.equal(core.readTerms(b.conf.terms_file).size, 2, 'only the re-added term is in the list');
  assert.equal(core.readTerms(b.conf.health_terms_file).size, 0);
  assert.deepEqual(orphanedLists(b.conf), []);
  const salt = /** @type {string} */ (readSalt(b.conf).salt);
  assert.ok(!r.out.includes(salt), 'the salt reached the output');
  const h = hookProcess(['--harness', 'claude', '--config', b.confPath], payload('notes for ' + TERM), b.env);
  assert.equal(JSON.parse(h.stdout).decision, 'block');
  // A second add with the salt in place moves nothing.
  const again = addTerm.addEntered(b.conf, 'Quillonx', 'Quillonx', 'employer-client-term');
  assert.doesNotMatch(again.out, /NOTE/);
});

// ------------------------------------------------------------------- add-term

test('add-term refuses a term in argv, a pipe, and an agent session, and validates --list first', { skip: !POSIX && 'POSIX' }, () => {
  const b = box();
  const base = [MHW, 'add-term', '--config', b.confPath];
  let r = spawnSync(process.execPath, [...base, TERM], { input: '', env: b.env, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /unknown or incomplete argument: .* \(no term is ever taken from arguments\)/);
  r = spawnSync(process.execPath, base, { input: TERM + '\n' + TERM + '\n', env: b.env, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stdout, /refused: stdin is not a terminal/);
  for (const marker of addTerm.AGENT_MARKERS) {
    r = spawnSync(process.execPath, base, { input: '', env: { ...b.env, [marker]: '1' }, encoding: 'utf8' });
    assert.equal(r.status, 2, marker);
    assert.match(r.stdout, new RegExp('refused: an agent session marker is set \\(' + marker + '\\)'), marker);
  }
  r = spawnSync(process.execPath, [...base, '--list', 'medical'], { input: '', env: b.env, encoding: 'utf8' });
  assert.equal(r.status, 2);
  assert.match(r.stderr, /add-term: --list must be employer-client-term, health or colleague-name/);
  assert.ok(!fs.existsSync(b.lo), 'a refused add-term wrote something');
});

/** add-term on a real pty this suite owns. @param {ReturnType<typeof box>} b @param {string[]} extra @param {string} [stty] */
function ptyAddTerm(b, extra = [], stty = '') {
  const p = /** @type {any} */ (PTY).pty;
  // trap: the shell survives the Ctrl+C its child receives (a caught signal is reset to default on exec,
  // so add-term itself still gets SIGINT), and reports the exit code and the modes after.
  const script = 'trap : INT; ' + (stty ? '/bin/stty ' + stty + '; ' : '') + '/bin/stty -g > "$1/before"; "$2" "$3" add-term --config "$4" "$@"; echo "RC=$?"; /bin/stty -g > "$1/after"';
  const term = p.spawn('/bin/sh', ['-c', script.replace('"$@"', extra.map((a) => '"' + a + '"').join(' ')), 'sh', b.dir, process.execPath, MHW, b.confPath],
    { cols: 100, rows: 30, cwd: b.dir, env: b.env, encoding: null });
  cleanups.unshift(() => {
    try {
      term.kill('SIGKILL');
    } catch {
      // already gone
    }
  });
  const s = { out: Buffer.alloc(0), term, exited: /** @type {Promise<void>} */ (new Promise((resolve) => term.onExit(() => resolve()))) };
  term.onData((/** @type {Buffer} */ d) => { s.out = Buffer.concat([s.out, d]); });
  return s;
}

/** @param {{ out: Buffer }} s @param {string} needle */
async function waitFor(s, needle) {
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    if (s.out.includes(needle)) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail('never saw ' + JSON.stringify(needle) + ' in ' + JSON.stringify(s.out.toString('latin1').slice(-300)));
}

const ptySkip = !POSIX ? 'POSIX' : !PTY.ok && !LIVE_REQUIRED ? 'the pty library does not load here: ' + /** @type {any} */ (PTY).reason : false;

test('live: add-term reads the term twice with nothing echoed, writes only hashes, and restores the terminal', { skip: ptySkip }, async () => {
  if (!PTY.ok) assert.fail('MHW_S17_LIVE_REQUIRED=1: ' + /** @type {any} */ (PTY).reason);
  for (const [label, enter, stty] of /** @type {Array<[string, string, string]>} */ ([['lf', '\n', ''], ['cr with icrnl off', '\r', '-icrnl'], ['echonl on', '\r', 'echonl']])) {
    const b = box();
    const s = ptyAddTerm(b, [], stty);
    await waitFor(s, 'Term (not shown): ');
    s.term.write(TERM + enter);
    await waitFor(s, 'Again: ');
    s.term.write(TERM + enter);
    await waitFor(s, 'RC=');
    await s.exited;
    const text = s.out.toString('utf8');
    assert.match(text, /added: 2 new hash\(es\) to /, label);
    assert.match(text, /RC=0/, label);
    assert.ok(!text.toLowerCase().includes('quillon'), label + ': the term was echoed');
    assert.equal(fs.readFileSync(path.join(b.dir, 'before'), 'utf8'), fs.readFileSync(path.join(b.dir, 'after'), 'utf8'), label + ': the terminal modes were not restored');
    const body = fs.readFileSync(b.conf.terms_file, 'utf8');
    assert.ok(!body.toLowerCase().includes('quillon') && body.startsWith(core.TERMS_HEADER), label);
    assert.equal(fs.statSync(b.conf.terms_file).mode & 0o777, 0o600, label);
    assert.equal(fs.statSync(b.lo).mode & 0o777, 0o700, label);
    assert.equal(fs.statSync(b.conf.salt_file).mode & 0o777, 0o600, label);
  }
});

test('live: Ctrl+C and Ctrl+D cancel add-term cleanly, write nothing, and restore the terminal', { skip: ptySkip }, async () => {
  if (!PTY.ok) assert.fail('MHW_S17_LIVE_REQUIRED=1: ' + /** @type {any} */ (PTY).reason);
  for (const [label, key] of /** @type {Array<[string, string]>} */ ([['ctrl-c', '\x03'], ['ctrl-d', '\x04'], ['ctrl-c after a partial term', 'Zyx\x03']])) {
    const b = box();
    const s = ptyAddTerm(b);
    await waitFor(s, 'Term (not shown): ');
    s.term.write(key);
    await waitFor(s, 'RC=');
    await s.exited;
    const text = s.out.toString('utf8');
    assert.match(text, /not added: entry cancelled\. Nothing was written\./, label);
    assert.match(text, /RC=130/, label);
    assert.equal(fs.readFileSync(path.join(b.dir, 'before'), 'utf8'), fs.readFileSync(path.join(b.dir, 'after'), 'utf8'), label + ': modes');
    assert.ok(!fs.existsSync(b.lo), label + ': something was written');
  }
  // Two entries that differ: nothing written.
  const b = box();
  const s = ptyAddTerm(b);
  await waitFor(s, 'Term (not shown): ');
  s.term.write('Zyxw one\n');
  await waitFor(s, 'Again: ');
  s.term.write('Zyxw two\n');
  await waitFor(s, 'RC=');
  assert.match(s.out.toString('utf8'), /not added: the two entries differ\.[\s\S]*RC=1/);
  assert.ok(!fs.existsSync(b.conf.terms_file));
});

// ------------------------------------------------------------------- units

test('the admin layer copies exactly the files the hook imports', () => {
  const seen = new Set();
  const queue = [path.join(ROOT, 'src', 'commands', 'hook-entry.js')];
  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8').replaceAll(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/(?:from\s*|import\s*\(\s*|=\s*')'(\.{1,2}\/[^']+)'/g)) queue.push(path.resolve(path.dirname(file), m[1]));
    for (const m of code.matchAll(/mod(?:ule)? = '(\.{1,2}\/[^']+)'/g)) queue.push(path.resolve(path.dirname(file), m[1]));
  }
  const closure = [...seen].map((p) => path.relative(ROOT, p).split(path.sep).join('/')).sort();
  const sh = fs.readFileSync(path.join(ROOT, 'global', 'install-managed.sh'), 'utf8');
  const listed = /** @type {RegExpMatchArray} */ (sh.match(/^HOOK_FILES="([^"]*)"/m))[1].split(' ').filter((x) => x !== 'hook/package.json').map((x) => x.slice(5)).sort();
  assert.ok(closure.includes('src/commands/hook-prompt.js') && closure.includes('src/lib/clean.js'), closure.join(' '));
  assert.deepEqual(listed, closure);
});

test('stripPasteMarkers drops whole marker lines only, as the Python pattern did', () => {
  assert.equal(hook.stripPasteMarkers('a\n<pasted_content id="1">\nb\n</pasted_content>\nc'), 'a\nb\nc');
  assert.equal(hook.stripPasteMarkers('<pasted_contentX>\nkeep'), '<pasted_contentX>\nkeep', 'no word boundary');
  assert.equal(hook.stripPasteMarkers('x <pasted_content>\n'), 'x <pasted_content>\n', 'not at a line start');
  assert.equal(hook.stripPasteMarkers('\r<pasted_content>\n'), '\r<pasted_content>\n', 'a \\r is not a line start');
  assert.equal(hook.stripPasteMarkers('<pasted_content a>b\ntail'), 'b\ntail', 'up to the last > on the line');
  assert.equal(hook.stripPasteMarkers('<pasted_content>'), '', 'at the end, no newline');
  assert.equal(hook.stripPasteMarkers('<pasted_content no close\n'), '<pasted_content no close\n');
});

test('the settings no longer name a Keychain: salt_store is always file', () => {
  const b = box({ salt_store: 'keychain', keychain_service: 'x', keychain_path: 'relative' });
  assert.equal(b.conf.salt_store, 'file');
  assert.ok(!('keychain_service' in b.conf) && !('keychain_path' in b.conf));
});
