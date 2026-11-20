// S15 (#486): what the scan transcripts cannot show. The declared differences from the Python original
// (test/golden/S15/expected-differences.json) each with a test; the keychain salt read; that the file
// opened is always git's own entry; that no matched text reaches stdout or stderr; the entries that
// reach the Node command (./mhw, workstation.py, outbound-scan.yml); and unit tests of the helpers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, addedBlocks, withoutAttributionTrailer, pyRealpath, validBase, scanText } from '../../src/commands/scan.js';
import * as core from '../../src/lib/clean.js';
import { readGolden } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { ROOT } from '../helpers/s15.js';
import { AWS, EMAIL, CPF, SALT, TERM, VENDOR, NEW_FIXTURES, NEW_SPANS } from './cases.js';

const POSIX = process.platform !== 'win32';
const GIT = which('git');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** A throwaway HOME and a repository with one committed file, on a feature branch over `base`. */
function box() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s15n-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'home');
  const repo = path.join(dir, 'repo');
  fs.mkdirSync(home);
  fs.mkdirSync(repo);
  const empty = path.join(dir, 'gitconfig');
  fs.writeFileSync(empty, '');
  /** @type {Record<string, string>} */
  const env = { PATH: process.env.PATH || '', HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'), GIT_CONFIG_GLOBAL: empty,
    GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'F', GIT_AUTHOR_EMAIL: 'f@example.com', GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f@example.com', LC_ALL: 'C' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const git = (/** @type {string[]} */ args) => {
    const p = spawnSync(/** @type {string} */ (GIT), ['-C', repo, ...args], { env, encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
  };
  git(['init', '-q', '-b', 'base']);
  fs.writeFileSync(path.join(repo, 'a.txt'), 'x\n');
  git(['add', '-A']);
  git(['commit', '-q', '-m', 'base']);
  git(['checkout', '-q', '-b', 'feature', '--track', 'base']);
  const data = path.join(home, 'data', core.PROJECT);
  const overlay = path.join(data, 'local-overlay');
  /** @param {string} conf @param {string[]} [terms] */
  const configure = (conf, terms = [TERM]) => {
    fs.mkdirSync(overlay, { recursive: true });
    fs.writeFileSync(path.join(data, 'clipboard.conf'), conf);
    const hashes = terms.flatMap((w) => core.termForms(w).map((f) => core.termHash(SALT, f)));
    fs.writeFileSync(path.join(overlay, 'clipboard-terms'), core.TERMS_HEADER + hashes.map((h) => h + '\n').join(''));
  };
  return { dir, home, repo, env, git, data, overlay, configure };
}

test('declared differences: every entry names a reason, and each has a test in this file', () => {
  const d = readGolden('S15', 'expected-differences.json');
  for (const e of d.differences) {
    assert.ok(e.what && e.why && e.why.length > 40 && e.test, JSON.stringify(e));
    const self = fs.readFileSync(new URL(import.meta.url), 'utf8');
    assert.ok(self.includes("test('" + e.test + "'"), 'no test named ' + e.test);
  }
});

test('without git on PATH a git mode exits 2 and says so; --file needs no git', { skip: !GIT && 'needs git' }, () => {
  const b = box();
  fs.writeFileSync(path.join(b.dir, 'post.txt'), 'write to ' + EMAIL + '\n');
  const env = { ...b.env, PATH: path.join(b.dir, 'no-such-bin') };
  for (const args of [[], ['a.txt'], ['--base=base']]) {
    const r = run(args, { cwd: b.repo, env });
    assert.deepEqual([r.code, r.stdout, r.stderr], [2, '', 'mhw scan: git was not found on PATH; mhw scan needs it in this mode\n'], JSON.stringify(args));
  }
  const r = run(['--file=' + path.join(b.dir, 'post.txt')], { cwd: b.repo, env });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /post\.txt:1: email, 33 chars\n/);
});

test('a term list or salt file that is not ASCII reads as unreadable, with its NOTE', { skip: !GIT && 'needs git' }, () => {
  const b = box();
  b.configure('salt_store=file\n');
  fs.writeFileSync(path.join(b.overlay, 'clipboard-terms'), Buffer.from([0x23, 0xe9, 0x0a]));
  fs.writeFileSync(path.join(b.repo, 'm.txt'), TERM + '\n');
  let r = run(['m.txt'], { cwd: b.repo, env: b.env });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /NOTE {4}no employer and client term list could be read/);
  b.configure('salt_store=file\n');
  fs.writeFileSync(path.join(b.overlay, 'clipboard-salt'), Buffer.from([0xe9, 0x0a]));
  r = run(['m.txt'], { cwd: b.repo, env: b.env });
  assert.match(r.stdout, /NOTE {4}the term list's salt could not be read without a prompt/);
  assert.doesNotMatch(r.stdout, /employer-client-term, \d+ chars/);
});

/** A directory on PATH holding git and nothing else. @param {string} dir */
function gitOnly(dir) {
  const bin = path.join(dir, 'git-only');
  fs.mkdirSync(bin, { recursive: true });
  fs.symlinkSync(/** @type {string} */ (GIT), path.join(bin, 'git'));
  return bin;
}

/** A fake python3 that prints a salt and records its arguments. @param {string} dir @param {string} salt */
function fakePython(dir, salt) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  const log = path.join(dir, 'argv.json');
  fs.writeFileSync(path.join(bin, 'python3'), '#!' + process.execPath + '\n'
    + 'require("fs").writeFileSync(' + JSON.stringify(log) + ', JSON.stringify(process.argv.slice(2)));\n'
    + 'process.stdout.write(' + JSON.stringify(salt) + ');\n', { mode: 0o755 });
  return { bin, log };
}

test('the Keychain salt is read through clipboard_guard.py, on a pipe, never in an argument', { skip: (!POSIX || !GIT) && 'POSIX, git' }, () => {
  const b = box();
  b.configure('salt_store=keychain\nkeychain_service=svc.test\n');
  fs.writeFileSync(path.join(b.repo, 'm.txt'), 'one\nmet ' + TERM + '\n');
  const py = fakePython(b.dir, SALT);
  const env = { ...b.env, PATH: py.bin + path.delimiter + b.env.PATH };
  const r = run(['m.txt'], { cwd: b.repo, env, platform: 'darwin' });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /m\.txt:2: employer-client-term, 12 chars\n/);
  const argv = JSON.parse(fs.readFileSync(py.log, 'utf8'));
  assert.deepEqual(argv.slice(0, 2), ['-B', '-c']);
  assert.match(argv[2], /SaltStore\(conf, interactive=False\)\.get\(\)/);
  assert.deepEqual(argv.slice(3), [path.join(ROOT, 'global', 'clipboard'), 'svc.test', '']);
  assert.ok(!argv.join(' ').includes(SALT), 'the salt reached an argument');
  // A helper answer that is not a salt, no python3, or an OS without the Keychain: the salt NOTE.
  for (const [label, e, platform] of /** @type {Array<[string, Record<string, string>, string]>} */ ([
    ['not a salt', { ...b.env, PATH: fakePython(path.join(b.dir, 'bad'), 'nope').bin + path.delimiter + b.env.PATH }, 'darwin'],
    ['no python3', { ...b.env, PATH: gitOnly(b.dir) }, 'darwin'],
    ['linux', env, 'linux'],
  ])) {
    const out = run(['m.txt'], { cwd: b.repo, env: e, platform });
    assert.match(out.stdout, /the term list's salt could not be read without a prompt/, label);
  }
});

test('a PATH argument only looks a file up in git\'s list: the file opened is git\'s entry', { skip: !GIT && 'needs git' }, () => {
  const b = box();
  fs.writeFileSync(path.join(b.repo, '.gitignore'), 'ignored.txt\n');
  fs.writeFileSync(path.join(b.repo, 'ignored.txt'), 'key ' + AWS + '\n');
  const opened = /** @type {string[]} */ ([]);
  const real = fs.readFileSync;
  fs.readFileSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any} */ o) => {
    opened.push(path.basename(String(p)));
    return real(p, o);
  });
  try {
    const r = run(['ignored.txt', './a.txt'], { cwd: b.repo, env: b.env });
    assert.equal(r.code, 0);
    assert.match(r.stdout, /SKIPPED ignored\.txt: not a file git lists \(missing or ignored\), not scanned/);
  } finally {
    fs.readFileSync = real;
  }
  assert.ok(!opened.includes('ignored.txt'));
  assert.ok(opened.includes('a.txt'));
});

test('no matched text reaches stdout or stderr, in any mode', { skip: !GIT && 'needs git' }, () => {
  const b = box();
  const values = [AWS, EMAIL, CPF, ...NEW_SPANS];
  fs.writeFileSync(path.join(b.repo, 'all.txt'), [AWS, EMAIL, CPF, ...NEW_FIXTURES].join('\n') + '\n');
  b.git(['add', '-A']);
  b.git(['commit', '-q', '-m', 'all ' + EMAIL]);
  const outs = [run([], { cwd: b.repo, env: b.env }), run(['all.txt'], { cwd: b.repo, env: b.env }),
    run(['--file=all.txt'], { cwd: b.repo, env: b.env }), run(['--base=' + AWS], { cwd: b.repo, env: b.env })];
  assert.match(outs[0].stdout, /mhw scan: 17 finding\(s\)/);
  for (const r of outs.slice(0, 3)) {
    for (const v of values) {
      for (let i = 0; i + 5 <= v.length; i++) assert.ok(!(r.stdout + r.stderr).includes(v.slice(i, i + 5)), 'an excerpt of ' + v.length + ' chars');
    }
  }
  // The one place a value is echoed is the --base error, and it is the caller's own argument, not a file's text.
  assert.equal(outs[3].code, 2);
});

test('./mhw runs the Node command for scan, and says so when node is missing', { skip: !POSIX && './mhw is the POSIX entry' }, () => {
  const b = box();
  fs.writeFileSync(path.join(b.dir, 'post.txt'), 'x ' + CPF + '\n');
  const r = spawnSync('/bin/sh', [path.join(ROOT, 'mhw'), 'scan', '--file=' + path.join(b.dir, 'post.txt')], { env: b.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /post\.txt:1: cpf, 14 chars\n/);
  if (!fs.existsSync('/usr/bin/node') && !fs.existsSync('/bin/node')) {
    const n = spawnSync('/bin/sh', [path.join(ROOT, 'mhw'), 'scan'], { env: { ...b.env, PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
    assert.equal(n.status, 2);
    assert.equal(n.stderr, 'mhw: node (26 or later) is required for mhw scan\n');
  }
});

test('a direct python3 workstation.py scan names the Node command and runs nothing', { skip: (!POSIX || !which('python3')) && 'POSIX, python3' }, () => {
  const b = box();
  fs.writeFileSync(path.join(b.dir, 'post.txt'), 'x ' + CPF + '\n');
  const r = spawnSync(/** @type {string} */ (which('python3')), ['-B', path.join(ROOT, 'global', 'workstation.py'), 'scan', '--file=' + path.join(b.dir, 'post.txt')],
    { env: { ...b.env, MHW_NODE: process.execPath }, encoding: 'utf8' });
  assert.deepEqual([r.status, r.stdout, r.stderr], [2, '', 'mhw: mhw scan is the Node command now; run ./mhw scan or node bin/mhw.js scan\n']);
});

test('outbound-scan.yml runs the Node command on Node 26 and never blocks on a finding', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'outbound-scan.yml'), 'utf8').replaceAll('\r\n', '\n');
  assert.match(yml, /uses: actions\/setup-node@[0-9a-f]{40}\n\s+with:\n\s+node-version: 26\.\d+\.\d+/);
  assert.match(yml, /run: node bin\/mhw\.js scan "--base=origin\/\$BASE_REF"/);
  assert.doesNotMatch(yml, /python|sh mhw scan|continue-on-error/);
});

test('the Python original and its suite are gone; nothing runs them', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'global', 'scan.py')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'global', 'scan_test.py')));
  const tests = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'tests.yml'), 'utf8');
  assert.doesNotMatch(tests, /global\/scan(_test)?\.py/);
  const dist = fs.readFileSync(path.join(ROOT, 'distribution.json'), 'utf8');
  assert.doesNotMatch(dist, /scan\.py/);
});

// Helpers the transcripts reach only partly.
test('addedBlocks reads quoted, spaced, deleted and binary entries of a patch', () => {
  const patch = [
    'diff --git "a/caf\\303\\251.txt" "b/caf\\303\\251.txt"', 'new file mode 100644', '--- /dev/null', '+++ "b/caf\\303\\251.txt"', '@@ -0,0 +1,2 @@', '+one', '+two',
    'diff --git a/x y.txt b/x y.txt', '--- a/x y.txt\t', '+++ b/x y.txt\t', '@@ -3 +3 @@', '-old', '+new',
    'diff --git a/gone.txt b/gone.txt', 'deleted file mode 100644', '--- a/gone.txt', '+++ /dev/null', '@@ -1 +0,0 @@', '-bye',
    'diff --git a/b.bin b/b.bin', 'new file mode 100644', 'Binary files /dev/null and b/b.bin differ',
    'diff --git broken', '@@ not a hunk @@',
  ].join('\n');
  assert.deepEqual(addedBlocks(patch), [['caf\\303\\251.txt', 1, 'one\ntwo\n'], ['x y.txt', 3, 'new\n'], ['b.bin', 0, null]]);
});

test('withoutAttributionTrailer cuts only the vendor address after a name, keeping the lines', () => {
  const m = 'subject\n\nCo-Authored-By: Claude <' + VENDOR + '>\nco-authored-by: <' + VENDOR + '>\n';
  assert.equal(withoutAttributionTrailer(m), 'subject\n\nCo-Authored-By: Claude \nco-authored-by: <' + VENDOR + '>\n');
  assert.deepEqual(scanText(withoutAttributionTrailer(m)).map((f) => f[1]), ['email']);
});

test('pyRealpath keeps a missing tail; validBase refuses an option', () => {
  const dir = fs.realpathSync.native(os.tmpdir());
  assert.equal(pyRealpath(path.join(dir, 'no-such-mhw-dir', 'x')), path.join(dir, 'no-such-mhw-dir', 'x'));
  assert.equal(validBase(''), false);
  assert.equal(validBase('-x'), false);
  assert.equal(validBase('origin/main'), true);
});
