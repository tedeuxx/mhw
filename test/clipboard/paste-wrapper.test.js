// mhw paste-wrapper (#487, S16 of #470; ADR-0033): the port of paste_wrapper_test.py. The state machine is
// also held to the Python original's answers in paste-wrapper-golden.test.js. Here:
//   - the pty loader's refusals, the refusal itself, the straight exec off a terminal, the marker rules;
//   - "live": a real wrapper process between a pty this suite owns (the vendored node-pty) and a fake CLI
//     (test/helpers/pty-recorder.js) that records every byte it receives. Live tests run where the pty
//     library loads (macOS); elsewhere they skip and say why, and MHW_S16_LIVE_REQUIRED=1 (CI on macOS)
//     turns that skip into a failure.
// Every term, token and identifier is SYNTHETIC (test/helpers/s16.js). Nothing here reads or writes the
// system clipboard, a shell rc, terminal preferences or the real HOME, and no real CLI is started.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as core from '../../src/lib/clean.js';
import * as w from '../../src/commands/paste-wrapper.js';
import { loadPty, PTY_ROOT } from '../../src/lib/pty.js';
import { SALT, TERM, EMAIL, AWS, ADDRESS } from '../helpers/s16.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MHW = path.join(ROOT, 'bin', 'mhw.js');
const RECORDER = path.join(ROOT, 'test', 'helpers', 'pty-recorder.js');
const DRIVER = path.join(ROOT, 'test', 'helpers', 'paste-wrapper-driver.js');
const LIVE_REQUIRED = process.env.MHW_S16_LIVE_REQUIRED === '1';
const S = Buffer.from('\x1b[200~', 'latin1');
const E = Buffer.from('\x1b[201~', 'latin1');
const EXIT = Buffer.from('\x1d\x1dEXIT', 'latin1');
const POSIX = process.platform !== 'win32';
const PTY = loadPty({ env: {} });
const LIVE = PTY.ok ? false : (LIVE_REQUIRED ? false : 'the pty library does not load here: ' + PTY.reason);
/** @type {Array<() => void>} */
const cleanups = [];
/** @type {Array<{ code: number | null, term: { kill(signal?: string): void } }>} */
const sessions = [];
// A session a failed assertion left running would hold the test process open: kill it first.
after(() => {
  for (const s of sessions) {
    if (s.code === null) {
      try {
        s.term.kill('SIGKILL');
      } catch {
        // gone
      }
    }
  }
  cleanups.forEach((f) => f());
});

function fresh() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s16-pw-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A clipboard.conf and its file store in d. @param {string} d @param {Record<string, string>} [over] */
function confIn(d, over = {}) {
  fs.mkdirSync(path.join(d, 'lo'), { recursive: true });
  const lines = ['salt_store=file', 'terms_file=' + path.join(d, 'lo', 'terms'), 'salt_file=' + path.join(d, 'lo', 'salt'),
    'health_terms_file=' + path.join(d, 'lo', 'terms-health'), 'colleague_terms_file=' + path.join(d, 'lo', 'terms-colleague')];
  for (const [k, v] of Object.entries(over)) lines.push(k + '=' + v);
  const p = path.join(d, 'clipboard.conf');
  fs.writeFileSync(p, lines.join('\n') + '\n');
  return p;
}

/** The synthetic term list, salted. @param {string} d */
function withTerm(d) {
  fs.mkdirSync(path.join(d, 'lo'), { recursive: true });
  fs.writeFileSync(path.join(d, 'lo', 'salt'), SALT + '\n');
  fs.writeFileSync(path.join(d, 'lo', 'terms'), core.TERMS_HEADER + core.termForms(TERM).map((f) => core.termHash(SALT, f)).join('\n') + '\n');
}

/** An environment with no marker and a throwaway HOME. @param {string} home */
function envFor(home) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && k !== w.WRAPPER_MARKER && k !== 'MHW_PTY_MODULE') env[k] = v;
  return { ...env, HOME: home, XDG_DATA_HOME: path.join(home, 'xdg') };
}

// ------------------------------------------------------------------------------------ no pty needed

test('the pty loader names why it cannot be used, and never throws', () => {
  const linux = loadPty({ env: {}, platform: 'linux', arch: 'x64' });
  assert.equal(linux.ok, false);
  assert.match(/** @type {any} */ (linux).reason, /^node-pty 1\.1\.0 has no prebuild for linux-x64 in this package \(macOS only\)$/);
  const win = loadPty({ env: {}, platform: 'win32', arch: 'x64' });
  assert.match(/** @type {any} */ (win).reason, /no prebuild for win32-x64/);
  assert.match(/** @type {any} */ (loadPty({ env: { MHW_PTY_MODULE: 'relative.js' } })).reason, /not an absolute path/);
  const missing = loadPty({ env: { MHW_PTY_MODULE: path.join(fresh(), 'no-such.js') } });
  assert.match(/** @type {any} */ (missing).reason, /^node-pty 1\.1\.0 did not load \(/);
  const d = fresh();
  fs.writeFileSync(path.join(d, 'nospawn.cjs'), 'module.exports = {};\n');
  assert.match(/** @type {any} */ (loadPty({ env: { MHW_PTY_MODULE: path.join(d, 'nospawn.cjs') } })).reason, /no spawn function/);
});

test('a spawn-helper without its execute bit is refused, not loaded (the npm tarball carries it 0644)', { skip: !POSIX && 'no execute bit on Windows' }, () => {
  const root = path.join(fresh(), 'node-pty');
  fs.cpSync(PTY_ROOT, root, { recursive: true });
  const dir = path.join(root, 'prebuilds', 'darwin-arm64');
  fs.chmodSync(path.join(dir, 'spawn-helper'), 0o644);
  const r = loadPty({ env: {}, platform: 'darwin', arch: 'arm64', root });
  assert.equal(r.ok, false);
  assert.match(/** @type {any} */ (r).reason, /spawn-helper is not an executable file/);
});

test('the vendored macOS prebuilds carry an executable spawn-helper in the repository', { skip: !POSIX && 'no execute bit on Windows' }, () => {
  for (const a of ['darwin-arm64', 'darwin-x64']) {
    const helper = path.join(PTY_ROOT, 'prebuilds', a, 'spawn-helper');
    assert.ok(fs.statSync(helper).mode & 0o100, a);
    assert.ok(fs.existsSync(path.join(PTY_ROOT, 'prebuilds', a, 'pty.node')), a);
  }
});

test('without its pty library the wrapper refuses visibly, exit 126, and never starts the CLI', () => {
  // In its own process (test/helpers/paste-wrapper-driver.js), as if on a terminal: a wrapper that fell
  // back to running the CLI unwrapped would exec it, leave the marker file and never print its status.
  const d = fresh();
  const marker = path.join(d, 'started');
  const env = { ...envFor(d), MHW_PTY_MODULE: path.join(d, 'no-such-pty.js') };
  const r = spawnSync(process.execPath, [DRIVER, 'run', '--config', confIn(d), '--', process.execPath, '-e',
    'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "")'], { env, encoding: 'utf8' });
  assert.equal(fs.existsSync(marker), false, 'the CLI ran unwrapped');
  assert.equal(r.stdout, 'CODE ' + w.REFUSED + '\n');
  assert.equal(r.status, w.REFUSED);
  const lines = r.stderr.split('\n').filter(Boolean);
  assert.equal(lines.length, 1, r.stderr);
  assert.match(lines[0], /^Paste filter \(ADR-0033\): .*node(\.exe)? was NOT started: the paste wrapper needs its pty library and node-pty 1\.1\.0 did not load \(.*\)\. Run `command node(\.exe)?` to start it without paste cleaning/);
  assert.match(lines[0], /`mhw status` names the same reason\.$/);
});

test('mhw status names the pty library: ok here, FAIL with the reason where it cannot load', () => {
  const here = w.statusLine({});
  if (!POSIX) assert.match(here, /^PASTE   n\/a   /);
  else if (PTY.ok) assert.equal(here, 'PASTE   ok    the paste wrapper loads its pty library (node-pty 1.1.0)');
  else assert.match(here, /^PASTE   FAIL  the paste wrapper cannot run here: /);
  const bad = w.statusLine({ MHW_PTY_MODULE: '/no/such/pty.js' }, 'darwin');
  assert.match(bad, /^PASTE   FAIL  the paste wrapper cannot run here: node-pty 1\.1\.0 did not load \(.*\); claude, codex and kiro-cli started through it refuse to start \(command <cli> runs one without paste cleaning\)$/);
  assert.match(w.statusLine({}, 'win32'), /^PASTE   n\/a   .*not measured \(D7\)$/);
});

test('mhw status says PASTE FAIL when the installed shell functions name a node or an mhw that is gone (PR #521 lens A1)', { skip: !POSIX && 'no shell functions on Windows' }, () => {
  const home = fresh();
  const data = path.join(home, 'xdg', core.PROJECT);
  fs.mkdirSync(data, { recursive: true });
  const env = { HOME: home, XDG_DATA_HOME: path.join(home, 'xdg') };
  /** @param {string} node @param {string} mhw */
  const snippet = (node, mhw) => fs.writeFileSync(path.join(data, w.SNIPPET), '# managed-by: x\n'
    + ['claude', 'codex', 'kiro-cli'].map((c) => c + '() { "' + node + '" "' + mhw + '" paste-wrapper run --config "/c" -- ' + c + ' "$@"; }').join('\n') + '\n');
  assert.equal(w.snippetProblem(env, 'darwin'), null, 'no snippet: nothing to check');
  snippet(process.execPath, MHW);
  assert.equal(w.snippetProblem(env, 'darwin'), null);
  assert.doesNotMatch(w.statusLine(env, 'darwin'), /shell functions name/);
  const gone = path.join(home, 'Cellar', 'node', '25.0.0', 'bin', 'node');
  snippet(gone, MHW);
  assert.equal(w.statusLine(env, 'darwin'), 'PASTE   FAIL  the paste wrapper\'s shell functions name node ' + gone
    + ', which is not an executable file any more; claude, codex and kiro-cli started through them fail to start. Run mhw install to render them again');
  snippet(process.execPath, path.join(home, 'old', 'bin', 'mhw.js'));
  assert.match(w.statusLine(env, 'darwin'), /^PASTE   FAIL  the paste wrapper's shell functions name mhw at .*old\/bin\/mhw\.js, which is not there any more;/);
  // The Python form an earlier install rendered is not this check's subject.
  fs.writeFileSync(path.join(data, w.SNIPPET), 'claude() { /usr/bin/python3 -I -B "/gone/paste_wrapper.py" run -- claude "$@"; }\n');
  assert.equal(w.snippetProblem(env, 'darwin'), null);
});

test('a spawn that fails after the pty loads is refused, exit 126, and starts nothing', () => {
  const d = fresh();
  const stub = path.join(d, 'throwing-pty.cjs');
  fs.writeFileSync(stub, 'module.exports = { spawn() { throw new Error("posix_spawnp failed."); } };\n');
  const marker = path.join(d, 'started');
  const r = spawnSync(process.execPath, [DRIVER, 'run', '--config', confIn(d), '--', process.execPath, '-e',
    'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "")'], { env: { ...envFor(d), MHW_PTY_MODULE: stub }, encoding: 'utf8' });
  assert.equal(fs.existsSync(marker), false, 'the CLI ran unwrapped');
  assert.equal(r.status, w.REFUSED, r.stderr);
  assert.match(r.stderr, /was NOT started: the paste wrapper needs its pty library and the spawn failed \(posix_spawnp failed\.\)\. Run `command node(\.exe)?`/);
});

test('mhw paste-wrapper check answers whether the pty loads', () => {
  const ok = spawnSync(process.execPath, [MHW, 'paste-wrapper', 'check'], { encoding: 'utf8', env: envFor(fresh()) });
  assert.equal(ok.status, PTY.ok ? 0 : 1, ok.stderr);
  const bad = spawnSync(process.execPath, [MHW, 'paste-wrapper', 'check'], { encoding: 'utf8', env: { ...envFor(fresh()), MHW_PTY_MODULE: '/no/such/pty.js' } });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /^mhw paste-wrapper: node-pty 1\.1\.0 did not load/);
});

test('usage, an unknown flag, a missing program', () => {
  const help = spawnSync(process.execPath, [MHW, 'paste-wrapper', '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /^usage:\n {2}mhw paste-wrapper run /);
  assert.equal(spawnSync(process.execPath, [MHW, 'paste-wrapper'], { encoding: 'utf8' }).status, 2);
  const flag = spawnSync(process.execPath, [MHW, 'paste-wrapper', 'run', '--nope', '--', 'x'], { encoding: 'utf8' });
  assert.equal(flag.status, 2);
  assert.match(flag.stderr, /unknown or incomplete argument: --nope/);
  assert.equal(spawnSync(process.execPath, [MHW, 'paste-wrapper', 'run', '--grace', 'soon', '--', 'x'], { encoding: 'utf8' }).status, 2);
  assert.equal(spawnSync(process.execPath, [MHW, 'paste-wrapper', 'run', '--'], { encoding: 'utf8' }).status, 2);
  const r = spawnSync(process.execPath, [MHW, 'paste-wrapper', 'run', '--', 'no-such-cli-pmhwc'], { encoding: 'utf8', env: envFor(fresh()) });
  assert.equal(r.status, 127);
  assert.equal(r.stderr, 'no-such-cli-pmhwc: command not found\n');
});

test('not a terminal: the CLI runs straight through, with stdin, stdout and its exit status', () => {
  const d = fresh();
  const r = spawnSync(process.execPath, [MHW, 'paste-wrapper', 'run', '--config', confIn(d), '--', process.execPath, '-e',
    'let d="";process.stdin.on("data",(c)=>d+=c);process.stdin.on("end",()=>{process.stdout.write(d.toUpperCase());process.exit(3)})'],
  { input: 'mail ' + EMAIL, env: envFor(d) });
  assert.equal(r.status, 3);
  assert.equal(r.stdout.toString(), ('mail ' + EMAIL).toUpperCase());
});

test('not a terminal: an inherited session marker is removed', () => {
  const d = fresh();
  const env = { ...envFor(d), [w.WRAPPER_MARKER]: w.WRAPPER_MARKER_VALUE };
  const r = spawnSync(process.execPath, [MHW, 'paste-wrapper', 'run', '--config', confIn(d), '--', process.execPath, '-e',
    'console.log(JSON.stringify(process.env.' + w.WRAPPER_MARKER + ' ?? null))'], { input: '', env, encoding: 'utf8' });
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), 'null');
});

test('an unreadable settings file stops the wrapper before anything runs', { skip: !POSIX && 'POSIX modes' }, () => {
  const d = fresh();
  const conf = path.join(d, 'clipboard.conf');
  fs.writeFileSync(conf, Buffer.from([0xff, 0xfe, 0x0a]));
  /** @type {string[]} */
  const err = [];
  const code = w.main(['run', '--config', conf, '--', process.execPath], envFor(d), { stdinTTY: true, stdoutTTY: true, stderr: { write: (s) => err.push(s) } });
  assert.equal(code, 2);
  assert.match(err.join(''), /^\[paste filter \(ADR-0033\): internal error \(\w+\), the paste was NOT forwarded\]\n$/);
});

test('the argument rule and the environment a CLI gets', () => {
  const conf = core.loadConfig(confIn(fresh()));
  const clean = w.makeCleaner(conf, new Set(), null);
  assert.deepEqual(w.argsAllowMarker(clean, [], false), [true, []]);
  assert.deepEqual(w.argsAllowMarker(clean, ['mail ' + EMAIL, AWS], false), [false, ['credential', 'email']]);
  assert.deepEqual(w.argsAllowMarker(() => { throw new Error('x'); }, ['reply OK'], false), [false, []]);
  assert.deepEqual(w.argsAllowMarker(clean, ['reply OK'], true), [false, []]);
  assert.deepEqual(w.childEnv({ A: '1', [w.WRAPPER_MARKER]: 'x', U: undefined }, true), { A: '1', [w.WRAPPER_MARKER]: '1' });
  assert.deepEqual(w.childEnv({ A: '1', [w.WRAPPER_MARKER]: '1' }, false), { A: '1' });
});

test('a report-only category is forwarded and counted; a paste is cleaned around invalid UTF-8', () => {
  const blocking = core.CATEGORY_ORDER.filter((c) => c !== 'postal-address').join(',');
  const conf = core.loadConfig(confIn(fresh(), { block_categories: blocking, report_categories: 'postal-address' }));
  const clean = w.makeCleaner(conf, new Set(), null);
  const f = new w.PasteFilter(clean, 1000, { too_large: '[T]', error: '[E {error}]' });
  const paste = Buffer.concat([S, Buffer.from(ADDRESS), E]);
  assert.deepEqual(f.feed(paste), paste);
  assert.equal(clean.reportedPastes, 1);
  assert.deepEqual([...clean.reported], ['postal-address']);
  const raw = Buffer.concat([Buffer.from([0xff, 0xc3]), Buffer.from(' ' + EMAIL + ' '), Buffer.from([0xed, 0xa0, 0x80])]);
  const [out, cats] = clean(raw);
  assert.deepEqual(cats, ['email']);
  assert.deepEqual(out, Buffer.concat([Buffer.from([0xff, 0xc3]), Buffer.from(' [REDACTED:email] '), Buffer.from([0xed, 0xa0, 0x80])]));
});

test('the Python notice templates: placeholders, escapes, and the default for a bad one', () => {
  assert.equal(w.pyFormat('a {x} {{y}} }}', { x: 1 }), 'a 1 {y} }');
  for (const bad of ['{', '}', '{nosuch}', '{0}', '{x:>3}', '{x!r}']) assert.throws(() => w.pyFormat(bad, { x: 1 }), bad);
});

test('for kiro-cli the "NOT cleaned" notice says whether the Kiro prompt hook checks (Issue #455)', () => {
  const conf = core.loadConfig(confIn(fresh()));
  const home = fresh();
  for (const key of ['notice_no_bracketed_paste', 'notice_bracketed_paste_off']) {
    const plain = w.notice(conf, key, { program: 'claude' });
    assert.equal(w.noPasteNotice(conf, key, 'claude', home), plain, 'other CLIs are unchanged');
    const off = w.noPasteNotice(conf, key, 'kiro-cli', home);
    assert.match(off, /No Kiro prompt hook/);
    assert.doesNotMatch(off, /\n/);
  }
  fs.mkdirSync(path.join(home, '.kiro', 'hooks'), { recursive: true });
  fs.writeFileSync(path.join(home, '.kiro', 'hooks', w.KIRO_HOOK_FILE), '{"description": "managed-by: ' + core.PROJECT + '", "command": "x prompt-hook --harness kiro"}');
  const on = w.noPasteNotice(conf, 'notice_no_bracketed_paste', '/opt/bin/kiro-cli', home);
  assert.match(on, /has not enabled bracketed paste/);
  assert.match(on, /only in a trusted workspace/);
});

test('the source has no OS surface: no clipboard, dialog, notification or launchd tool', () => {
  for (const f of ['src/commands/paste-wrapper.js', 'src/lib/pty.js']) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const name of ['pbcopy', 'pbpaste', 'osascript', 'NSPasteboard', 'launchctl', 'display dialog', 'notify-send', 'xclip', 'wl-copy', 'iTerm', 'writeFile', 'appendFile', 'createWriteStream']) {
      assert.ok(!src.includes(name), f + ': ' + name);
    }
  }
});

// ------------------------------------------------------------------------------------------ live

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A ps state letter, or ''. @param {number} pid */
function state(pid) {
  return spawnSync('/bin/ps', ['-o', 'stat=', '-p', String(pid)], { encoding: 'utf8' }).stdout.trim();
}

/** The terminal's settable modes from `stty -g`, PENDIN masked (state the kernel sets on its own). @param {string} line */
function modes(line) {
  return line.trim().replace(/lflag=([0-9a-f]+)/, (_, v) => 'lflag=' + (Number.parseInt(v, 16) & ~0x20000000).toString(16));
}

/** A wrapper process on a pty this suite owns, running the fake CLI. */
class Session {
  /**
   * @param {string} name
   * @param {{ mode?: string, code?: number, grace?: number, conf?: string, rows?: number, cols?: number, wrap?: boolean,
   *   extra?: string[], shell?: boolean, dir?: string }} [o]
   */
  constructor(name, o = {}) {
    if (!PTY.ok) throw new Error(PTY.reason);
    this.dir = o.dir || path.join(fresh(), name);
    fs.mkdirSync(this.dir, { recursive: true });
    this.conf = o.conf || confIn(this.dir);
    this.rec = path.join(this.dir, 'received.bin');
    this.ev = path.join(this.dir, 'events.txt');
    let argv = [process.execPath, RECORDER, this.rec, this.ev, o.mode || 'bp', String(o.code ?? 0), ...(o.extra || [])];
    if (o.wrap !== false) argv = [process.execPath, MHW, 'paste-wrapper', 'run', '--config', this.conf, '--grace', String(o.grace ?? 5), '--', ...argv];
    /** @type {[string, string[]]} */
    const [file, args] = o.shell
      ? ['/bin/sh', ['-c', 'stty -g; "$@"; echo "RC=$?"; stty -g', 'sh', ...argv]]
      : [argv[0], argv.slice(1)];
    this.out = Buffer.alloc(0);
    /** @type {number | null} */ this.code = null;
    this.term = PTY.pty.spawn(file, args, { cols: o.cols || 100, rows: o.rows || 30, cwd: this.dir, env: envFor(this.dir), encoding: null });
    this.term.onData((d) => { this.out = Buffer.concat([this.out, d]); });
    sessions.push(this);
    this.exited = new Promise((resolve) => this.term.onExit((e) => { this.code = e.signal ? 128 + e.signal : e.exitCode; resolve(this.code); }));
  }

  /** @param {string | Buffer} needle @param {number} [timeout] */
  async waitOut(needle, timeout = 10000) {
    const end = Date.now() + timeout;
    while (Date.now() < end) {
      if (this.out.includes(needle)) return true;
      await sleep(5);
    }
    return false;
  }

  /** @param {Buffer | string} data */
  send(data) {
    this.term.write(Buffer.isBuffer(data) ? data : Buffer.from(data, 'latin1'));
  }

  async ready() {
    assert.ok(await this.waitOut('READY'), 'the fake CLI never started: ' + JSON.stringify(this.out.toString('latin1').slice(-300)));
  }

  received() {
    try {
      return fs.readFileSync(this.rec);
    } catch {
      return Buffer.alloc(0);
    }
  }

  events() {
    try {
      return fs.readFileSync(this.ev, 'utf8');
    } catch {
      return '';
    }
  }

  /** @param {number} [timeout] */
  async finish(timeout = 10000) {
    if (this.code === null) this.send(EXIT);
    const t = await Promise.race([this.exited, sleep(timeout).then(() => null)]);
    if (t === null) this.term.kill('SIGKILL');
    return this.exited;
  }

  /** The fake CLI's pid: the wrapper's child running the recorder. */
  child() {
    const p = spawnSync('/usr/bin/pgrep', ['-P', String(this.term.pid), '-f', 'pty-recorder'], { encoding: 'utf8' });
    return Number(p.stdout.trim().split(/\s+/)[0]);
  }
}

/** @param {import('node:test').TestContext} t */
function live(t) {
  if (LIVE_REQUIRED && !PTY.ok) assert.fail('MHW_S16_LIVE_REQUIRED=1: ' + PTY.reason);
  return t;
}

test('live: a paste arrives redacted, typing is byte exact, and the terminal mode is restored', { skip: LIVE }, async (t) => {
  live(t);
  const d = path.join(fresh(), 'redact');
  const conf = confIn(d);
  withTerm(d);
  const s = new Session('redact', { conf, dir: d, shell: true });
  await s.ready();
  assert.ok(await s.waitOut('\x1b[?2004h'), 'the mode set by the CLI must reach the terminal');
  const typed = Buffer.concat([Buffer.from([...Array(256).keys()].filter((b) => b !== 0x1b && b !== 0x1d)), Buffer.from('\x1b[A\x1b[D', 'latin1')]);
  s.send(Buffer.concat([typed, Buffer.from('\x1d\x1dTYPED', 'latin1')]));
  assert.ok(await s.waitOut('<TYPED>'));
  const paste = Buffer.from('deploy for ' + TERM.toUpperCase() + ' key ' + AWS + ' mail ' + EMAIL + '\rline two');
  s.send(Buffer.concat([S, paste, E]));
  assert.ok(await s.waitOut('<ACK1>'));
  s.send(Buffer.concat([S, Buffer.from('plain text, no finding'), E]));
  assert.ok(await s.waitOut('<ACK2>'));
  assert.equal(await s.finish(), 0);
  const got = s.received();
  assert.ok(got.subarray(0, typed.length).equals(typed), 'typed bytes changed');
  const cleaned = Buffer.from('deploy for [REDACTED:employer-client-term] key [REDACTED:credential] mail [REDACTED:email]\rline two');
  assert.ok(got.includes(Buffer.concat([S, cleaned, E])), got.toString('latin1'));
  assert.ok(got.includes(Buffer.concat([S, Buffer.from('plain text, no finding'), E])));
  for (const secret of [TERM.toUpperCase(), AWS, EMAIL]) {
    assert.ok(!got.includes(secret), 'the CLI received pasted content');
    assert.ok(!s.out.includes(secret), 'the terminal output carries pasted content');
  }
  const text = s.out.toString('latin1');
  assert.match(text, /1 paste\(s\) cleaned in this session \(employer-client-term, credential, email\)/);
  assert.match(text, /RC=0/);
  const stty = text.split(/\r?\n/).filter((l) => l.startsWith('gfmt') || /^[0-9a-f]+(:[0-9a-f]+)+$/.test(l.trim()));
  assert.equal(stty.length, 2, text.slice(-400));
  assert.equal(modes(stty[1]), modes(stty[0]), 'terminal mode not restored');
});

test('live: the paste marker split after its first byte is still cleaned', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('split1');
  await s.ready();
  s.send('\x1b');
  await sleep(150);
  s.send(Buffer.concat([Buffer.from('[200~' + EMAIL), E]));
  assert.ok(await s.waitOut('<ACK1>'));
  await s.finish();
  const got = s.received();
  assert.ok(!got.includes(EMAIL));
  assert.ok(got.subarray(0, S.length + 16 + E.length).equals(Buffer.concat([S, Buffer.from('[REDACTED:email]'), E])), got.toString('latin1'));
});

test('live: a split marker after a lone Escape', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('split');
  await s.ready();
  s.send('\x1b');
  await sleep(200);
  s.send('\x1b[20');
  await sleep(10);
  s.send('0~' + EMAIL + '\x1b[2');
  await sleep(10);
  s.send('01~');
  assert.ok(await s.waitOut('<ACK1>'));
  await s.finish();
  const want = Buffer.concat([Buffer.from([0x1b]), S, Buffer.from('[REDACTED:email]'), E]);
  assert.ok(s.received().subarray(0, want.length).equals(want), s.received().toString('latin1'));
});

test('live: the CLI\'s exit status is relayed', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('exit7', { code: 7 });
  await s.ready();
  assert.equal(await s.finish(), 7);
});

test('live: death by a signal is relayed as 128 + the signal', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('sig');
  await s.ready();
  process.kill(s.child(), 'SIGKILL');
  assert.equal(await s.finish(), 128 + os.constants.signals.SIGKILL);
});

test('live: SIGTERM to the wrapper is forwarded to the CLI', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('term');
  await s.ready();
  process.kill(s.term.pid, 'SIGTERM');
  assert.equal(await s.finish(), 128 + os.constants.signals.SIGTERM);
});

test('live: Ctrl-C reaches the CLI as SIGINT through its own terminal', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('ctrlc', { mode: 'cooked' });
  await s.ready();
  s.send('\x03');
  assert.equal(await s.finish(), 128 + os.constants.signals.SIGINT);
  assert.equal(s.received().length, 0, 'Ctrl-C arrived as a byte, not as the signal');
});

test('live: the window size is relayed', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('winch', { rows: 30, cols: 100 });
  await s.ready();
  s.term.resize(133, 41);
  const end = Date.now() + 5000;
  while (Date.now() < end && !s.events().includes('WINCH 41x133')) await sleep(20);
  await s.finish();
  assert.match(s.events(), /START 30x100/);
  assert.match(s.events(), /WINCH 41x133/);
});

test('live: job control: the CLI stops, the wrapper restores the terminal and stops; continued, it continues the CLI', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('stop');
  await s.ready();
  const child = s.child();
  const ttyName = /** @type {any} */ (s.term)._pty;
  const raw = spawnSync('/bin/stty', ['-g', '-f', ttyName], { encoding: 'utf8' }).stdout;
  s.send('\x1d\x1dSTOP');
  let end = Date.now() + 5000;
  while (Date.now() < end && !state(s.term.pid).startsWith('T')) await sleep(20);
  assert.ok(state(s.term.pid).startsWith('T'), 'the wrapper did not stop with the CLI');
  const whileStopped = spawnSync('/bin/stty', ['-g', '-f', ttyName], { encoding: 'utf8' }).stdout;
  assert.notEqual(modes(whileStopped), modes(raw), 'the terminal was left raw while stopped');
  process.kill(s.term.pid, 'SIGCONT');
  end = Date.now() + 5000;
  while (Date.now() < end && state(child).startsWith('T')) await sleep(20);
  assert.ok(!state(child).startsWith('T'), 'the CLI was not continued');
  assert.equal(modes(spawnSync('/bin/stty', ['-g', '-f', ttyName], { encoding: 'utf8' }).stdout), modes(raw), 'terminal not raw again');
  s.send(Buffer.concat([S, Buffer.from(EMAIL), E]));
  assert.ok(await s.waitOut('<ACK1>'));
  assert.equal(await s.finish(), 0);
});

test('live: a CLI that never enables bracketed paste: one warning, and nothing is cleaned', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('nobp', { mode: 'nobp', grace: 0.3 });
  await s.ready();
  assert.ok(await s.waitOut('has not enabled bracketed paste'), s.out.toString('latin1').slice(-300));
  s.send(EMAIL + '\x1d\x1dTYPED');
  assert.ok(await s.waitOut('<TYPED>'));
  await s.finish();
  assert.ok(s.received().subarray(0, EMAIL.length).equals(Buffer.from(EMAIL)));
});

test('live: bracketed paste turned off mid-session is warned about', { skip: LIVE }, async (t) => {
  live(t);
  // A grace long enough for the fake CLI to start on a loaded runner before the wrapper would warn.
  const s = new Session('off', { grace: 3 });
  await s.ready();
  assert.ok(await s.waitOut('\x1b[?2004h'));
  await sleep(3500);
  assert.ok(!s.out.includes('turned bracketed paste off'), 'warned while the mode was on');
  s.send('\x1d\x1dOFF');
  assert.ok(await s.waitOut('turned bracketed paste off', 30000), s.out.toString('latin1').slice(-300));
  await s.finish();
});

test('live: a report-only paste reaches the CLI unchanged and is summarised', { skip: LIVE }, async (t) => {
  live(t);
  const d = path.join(fresh(), 'report');
  const blocking = core.CATEGORY_ORDER.filter((c) => c !== 'postal-address').join(',');
  const s = new Session('report', { dir: d, conf: confIn(d, { block_categories: blocking, report_categories: 'postal-address' }) });
  await s.ready();
  assert.ok(await s.waitOut('\x1b[?2004h'));
  s.send(Buffer.concat([S, Buffer.from(ADDRESS), E]));
  assert.ok(await s.waitOut('<ACK1>'));
  assert.equal(await s.finish(), 0);
  assert.ok(s.received().includes(Buffer.concat([S, Buffer.from(ADDRESS), E])));
  assert.ok(!s.out.includes(ADDRESS), 'the terminal output carries pasted content');
  assert.match(s.out.toString('latin1'), /1 paste\(s\) in this session carried report-only categories \(postal-address\)/);
});

test('live: a missing salt is said at the start and at the exit', { skip: LIVE }, async (t) => {
  live(t);
  const d = path.join(fresh(), 'nosalt');
  const conf = confIn(d);
  withTerm(d);
  fs.rmSync(path.join(d, 'lo', 'salt'));
  const s = new Session('nosalt', { dir: d, conf });
  await s.ready();
  await s.finish();
  assert.equal(s.out.toString('latin1').split('its salt could not be read').length - 1, 2);
});

test('live: the wrapper writes no file', { skip: LIVE }, async (t) => {
  live(t);
  const s = new Session('nofile');
  await s.ready();
  s.send(Buffer.concat([S, Buffer.from(EMAIL), E]));
  assert.ok(await s.waitOut('<ACK1>'));
  await s.finish();
  const files = fs.readdirSync(s.dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => path.relative(s.dir, path.join(e.parentPath, e.name))).sort();
  assert.deepEqual(files, ['clipboard.conf', 'events.txt', 'received.bin']);
});

test('live: the relayed CLI gets the session marker; on a bare pty it has none', { skip: LIVE }, async (t) => {
  live(t);
  for (const [wrap, expected] of /** @type {const} */ ([[true, 'MARKER "1"'], [false, 'MARKER null']])) {
    const s = new Session('marker-' + wrap, { wrap });
    await s.ready();
    await s.finish();
    assert.deepEqual(s.events().split('\n').filter((l) => l.startsWith('MARKER')), [expected], String(wrap));
  }
});

test('live: a finding in an argument leaves the session unmarked; a clean one keeps the marker', { skip: LIVE }, async (t) => {
  live(t);
  for (const [extra, expected] of /** @type {const} */ ([[['-p', 'key ' + AWS], 'MARKER null'], [['-p', 'reply OK'], 'MARKER "1"']])) {
    const s = new Session('argmark-' + (expected === 'MARKER null'), { extra: [...extra] });
    await s.ready();
    await s.finish();
    assert.deepEqual(s.events().split('\n').filter((l) => l.startsWith('MARKER')), [expected]);
    if (expected === 'MARKER null') {
      assert.match(s.out.toString('latin1'), /NOT marked/);
      assert.match(s.out.toString('latin1'), /credential/);
      assert.ok(!s.out.includes(AWS));
    }
  }
});

test('live: wrapper-added latency, typed key and pastes (printed; loose bounds)', { skip: LIVE }, async (t) => {
  live(t);
  const d = path.join(fresh(), 'lat');
  const conf = confIn(d);
  withTerm(d);
  const line = 'mail ' + EMAIL + ' and text about ' + TERM + ' ';
  /** @type {Record<string, number>} */
  const results = {};
  for (const wrap of [false, true]) {
    const s = new Session('lat-' + wrap, { wrap, conf, dir: path.join(d, 'run-' + wrap) });
    await s.ready();
    for (const size of [0, 1000, 100000]) {
      const times = [];
      for (let i = 0; i < 7; i++) {
        const t0 = performance.now();
        if (size) {
          const acks = s.out.toString('latin1').split('<ACK').length - 1;
          s.send(Buffer.concat([S, Buffer.from(line.repeat(Math.ceil(size / line.length)).slice(0, size)), E]));
          assert.ok(await s.waitOut('<ACK' + (acks + 1) + '>', 30000));
        } else {
          const typed = s.out.toString('latin1').split('<TYPED>').length - 1;
          s.send('\x1d\x1dTYPED');
          const end = Date.now() + 10000;
          while (s.out.toString('latin1').split('<TYPED>').length - 1 <= typed && Date.now() < end) await sleep(1);
        }
        times.push(performance.now() - t0);
      }
      results[size + ':' + wrap] = times.sort((a, b) => a - b)[3];
    }
    await s.finish();
  }
  for (const size of [0, 1000, 100000]) {
    t.diagnostic('LATENCY ' + (size ? size + '-byte paste' : 'typed key') + ': bare ' + results[size + ':false'].toFixed(1)
      + ' ms, wrapped ' + results[size + ':true'].toFixed(1) + ' ms (median of 7)');
  }
  // Added latency, against the bare pty measured in the same run, so a loaded host slows both sides.
  assert.ok(results['0:true'] - results['0:false'] < 100, 'typed key: ' + results['0:true'] + ' ms wrapped');
  assert.ok(results['1000:true'] - results['1000:false'] < 500, '1 KB paste: ' + results['1000:true'] + ' ms wrapped');
});
