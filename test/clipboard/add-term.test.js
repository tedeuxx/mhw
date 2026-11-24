// add-term and the salt file (#488, S17 of #470), beyond the parity golden (add-term-golden.test.js): the
// salt file's modes and secrecy, the migration away from the Keychain salt, add-term's refusals and its
// terminal handling on a real pty, and the admin layer's copy of the hook's files. Throwaway HOMEs and
// directories only; the Keychain is never touched. Until #600 this file was hook.test.js and also held the
// prompt hook (`mhw hook prompt`) out of process; that hook left the CLI with #600, and the fixed-pattern
// check that replaced it has its own suites (test/hooks/).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as core from '../../src/lib/clean.js';
import * as addTerm from '../../src/commands/add-term.js';
import { HOOK_FILES } from '../../src/commands/install-admin.js';
import { saltOrCreate, readSalt, orphanedLists, addTermHashes } from '../../src/lib/salt.js';
import { loadPty } from '../../src/lib/pty.js';
import { ROOT } from '../helpers/s15.js';
import { SALT, TERM } from '../helpers/s17.js';

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
  const conf = addTerm.loadConfig(confPath);
  /** @type {Record<string, string>} */
  const env = { HOME: home, PATH: '/usr/bin:/bin', LC_ALL: 'C' };
  return { dir, home, lo, confPath, conf, env };
}

// ------------------------------------------------------------------- the salt

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
  // The re-added term matches under the salt in place (the core's own detection; the prompt hook that read
  // these lists left with #600).
  const spans = core.findSpans('notes for ' + TERM, core.readTerms(b.conf.terms_file), salt, {});
  assert.ok(spans.some(([, , cat]) => cat === 'employer-client-term'), JSON.stringify(spans));
  // A second add with the salt in place moves nothing.
  const again = addTerm.addEntered(b.conf, 'Quillonx', 'Quillonx', 'employer-client-term');
  assert.doesNotMatch(again.out, /NOTE/);
});

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
  // The fixed-pattern check (#588), the only hook there since #600 removed `mhw hook prompt`'s entry.
  const queue = [path.join(ROOT, 'src', 'hooks', 'pattern-check.js')];
  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);
    const code = fs.readFileSync(file, 'utf8').replaceAll(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/(?:from\s*|import\s*\(\s*|=\s*')'(\.{1,2}\/[^']+)'/g)) queue.push(path.resolve(path.dirname(file), m[1]));
    for (const m of code.matchAll(/mod(?:ule)? = '(\.{1,2}\/[^']+)'/g)) queue.push(path.resolve(path.dirname(file), m[1]));
  }
  const closure = [...seen].map((p) => path.relative(ROOT, p).split(path.sep).join('/')).sort();
  const listed = HOOK_FILES.filter((x) => x !== 'hook/package.json').map((x) => x.slice(5)).sort();
  assert.ok(closure.includes('src/hooks/pattern-check.js') && closure.includes('src/lib/clean.js'), closure.join(' '));
  assert.ok(!HOOK_FILES.some((f) => f.includes('hook-entry') || f.includes('hook-prompt')), 'the admin layer still stages a removed module');
  assert.deepEqual(listed, closure);
});

test('the settings no longer name a Keychain: salt_store is always file', () => {
  const b = box({ salt_store: 'keychain', keychain_service: 'x', keychain_path: 'relative' });
  assert.equal(b.conf.salt_store, 'file');
  assert.ok(!('keychain_service' in b.conf) && !('keychain_path' in b.conf));
});
