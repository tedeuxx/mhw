// S15 (#486): what the scan transcripts cannot show. The declared differences from the Python original
// (test/golden/S15/expected-differences.json) each with a test; that no term list is read (#589); that the file
// opened is always git's own entry; that no matched text reaches stdout or stderr; the entries that
// reach the script (outbound-scan.yml; since #600 no `mhw scan` and no ./mhw route); and unit tests of the
// helpers.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run, addedBlocks, withoutAttributionTrailer, pyRealpath, validBase, scanText } from '../../.github/scripts/outbound-scan.js';
import * as core from '../../src/lib/clean.js';
import { readGolden } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { ROOT } from '../helpers/s15.js';
import { AWS, EMAIL, CPF, TERM, VENDOR, NEW_FIXTURES, NEW_SPANS } from './cases.js';
import { SALT } from '../clean/corpus.js';

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
  /**
   * The installed settings, and what an earlier install's add-term left: a salt and a list holding the hash of
   * TERM as add-term computed it (HMAC-SHA256 of its one normalised word), so a reader would have matched it.
   * @param {string} conf
   */
  const configure = (conf) => {
    fs.mkdirSync(overlay, { recursive: true });
    fs.writeFileSync(path.join(data, 'clipboard.conf'), conf);
    fs.writeFileSync(path.join(overlay, 'clipboard-salt'), SALT + '\n', { mode: 0o600 });
    const hash = crypto.createHmac('sha256', Buffer.from(SALT, 'hex')).update(TERM.toLowerCase(), 'utf8').digest('hex');
    for (const list of ['clipboard-terms', 'clipboard-terms-health', 'clipboard-terms-colleague']) {
      fs.writeFileSync(path.join(overlay, list), '# terms\n' + hash + '\n', { mode: 0o600 });
    }
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
    assert.deepEqual([r.code, r.stdout, r.stderr], [2, '', 'outbound-scan: git was not found on PATH; outbound-scan needs it in this mode\n'], JSON.stringify(args));
  }
  const r = run(['--file=' + path.join(b.dir, 'post.txt')], { cwd: b.repo, env });
  assert.equal(r.code, 0);
  assert.match(r.stdout, /post\.txt:1: email, 33 chars\n/);
});

// #589: the term lists and their salt are gone; an earlier install's are never opened, and no NOTE names them.
test('no term list and no salt is read, and no term NOTE is printed (#589)', { skip: !GIT && 'needs git' }, () => {
  const b = box();
  b.configure('terms_file=' + path.join(b.overlay, 'clipboard-terms') + '\nsalt_store=file\n');
  fs.writeFileSync(path.join(b.repo, 'm.txt'), 'one\nmet ' + TERM + ' and ' + EMAIL + '\n');
  const opened = /** @type {string[]} */ ([]);
  const real = fs.readFileSync;
  fs.readFileSync = /** @type {any} */ ((/** @type {any} */ p, /** @type {any} */ o) => {
    opened.push(String(p));
    return real(p, o);
  });
  let r;
  try {
    r = run(['m.txt'], { cwd: b.repo, env: b.env });
  } finally {
    fs.readFileSync = real;
  }
  assert.equal(r.code, 0);
  assert.match(r.stdout, /m\.txt:2: email, \d+ chars\n/);
  assert.doesNotMatch(r.stdout, /employer-client-term/);
  assert.doesNotMatch(r.stdout, /term list|salt/);
  assert.deepEqual(opened.filter((f) => f.startsWith(b.overlay)), [], 'a term list or the salt was opened');
});

test('every process the scan starts is git, and an earlier salt reaches none of them', { skip: (!POSIX || !GIT) && 'POSIX, git' }, () => {
  const b = box();
  b.configure('');
  fs.writeFileSync(path.join(b.repo, 'm.txt'), 'one\nmet ' + EMAIL + '\n');
  b.git(['add', '-A']);
  b.git(['commit', '-q', '-m', 'add m']);
  // Every program scan.js starts is git: replaced by a logger on PATH that runs the real git. A python3
  // logger sits beside it, to show nothing else is started.
  const bin = path.join(b.dir, 'loggers');
  fs.mkdirSync(bin);
  const log = path.join(b.dir, 'spawns.jsonl');
  const logLine = 'require("fs").appendFileSync(' + JSON.stringify(log) + ', JSON.stringify({ argv: process.argv.slice(1), env: process.env }) + "\\n");\n';
  fs.writeFileSync(path.join(bin, 'git'), '#!' + process.execPath + '\n' + logLine
    + 'const r = require("child_process").spawnSync(' + JSON.stringify(GIT) + ', process.argv.slice(2), { stdio: "inherit" });\n'
    + 'process.exit(r.status === null ? 1 : r.status);\n', { mode: 0o755 });
  for (const tool of ['python3', 'security']) fs.writeFileSync(path.join(bin, tool), '#!' + process.execPath + '\n' + logLine, { mode: 0o755 });
  const env = { ...b.env, PATH: bin + path.delimiter + b.env.PATH };
  for (const args of [[], ['m.txt'], ['--base=base']]) {
    const r = run(args, { cwd: b.repo, env, platform: 'darwin' });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /m\.txt:2: email, \d+ chars\n/, JSON.stringify(args));
  }
  const spawns = fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(spawns.length > 5 && spawns.every((s) => s.argv[0].endsWith('git')), 'scan started something other than git');
  for (const s of spawns) {
    assert.ok(!JSON.stringify(s.argv).includes(SALT), 'the salt reached the argv of ' + s.argv[0]);
    assert.ok(!JSON.stringify(s.env).includes(SALT), 'the salt reached the environment of ' + s.argv[0]);
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
  assert.match(outs[0].stdout, /outbound-scan: 17 finding\(s\)/);
  for (const r of outs.slice(0, 3)) {
    for (const v of values) {
      for (let i = 0; i + 5 <= v.length; i++) assert.ok(!(r.stdout + r.stderr).includes(v.slice(i, i + 5)), 'an excerpt of ' + v.length + ' chars');
    }
  }
  // The one place a value is echoed is the --base error, and it is the caller's own argument, not a file's text.
  assert.equal(outs[3].code, 2);
});

test('mhw scan and mhw hook are unknown commands; the CLI carries neither module (#600)', { skip: !POSIX && './mhw is the POSIX entry' }, () => {
  const b = box();
  fs.writeFileSync(path.join(b.dir, 'post.txt'), 'x ' + CPF + '\n');
  for (const args of [['scan', '--file=' + path.join(b.dir, 'post.txt')], ['scan'], ['hook', 'prompt', '--harness', 'claude'], ['hook', 'check-config'], ['hook']]) {
    for (const entry of [[path.join(ROOT, 'mhw')], [process.execPath, path.join(ROOT, 'bin', 'mhw.js')]]) {
      const r = spawnSync(entry[0], [...entry.slice(1), ...args], { input: '{"prompt": "x"}', env: b.env, encoding: 'utf8' });
      assert.equal(r.status, 2, args.join(' ') + ': ' + r.stderr);
      assert.equal(r.stdout, '', args.join(' '));
      assert.match(r.stderr, /^mhw: unknown (subcommand|argument for) (scan|hook)\b/, args.join(' '));
      assert.doesNotMatch(r.stderr, /cpf|finding/, args.join(' '));
    }
  }
  for (const f of ['src/commands/scan.js', 'src/commands/hook-entry.js', 'src/commands/hook-prompt.js']) assert.ok(!fs.existsSync(path.join(ROOT, f)), f);
  const cli = fs.readFileSync(path.join(ROOT, 'src', 'cli.js'), 'utf8');
  assert.doesNotMatch(cli, /commands\/(scan|hook-entry|hook-prompt)\.js/);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'bin', 'mhw.js'), 'utf8'), /hook-entry/);
  // The script runs as the workflow runs it, outside the CLI, and reports the fixture's finding.
  const r = spawnSync(process.execPath, [path.join(ROOT, '.github', 'scripts', 'outbound-scan.js'), '--file=' + path.join(b.dir, 'post.txt')], { env: b.env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /post\.txt:1: cpf, 14 chars\n/);
  assert.ok(!r.stdout.includes(CPF));
});

test('the program names itself outbound-scan where mhw scan named itself (#600)', { skip: !GIT && 'needs git' }, () => {
  const b = box();
  const r = run(['--base=no-such-ref'], { cwd: b.repo, env: b.env });
  assert.deepEqual([r.code, r.stderr], [2, 'outbound-scan: --base=no-such-ref is not a commit\n']);
  assert.match(run([], { cwd: b.repo, env: b.env }).stdout, /^outbound-scan: 0 finding\(s\);/m);
});

test('workstation.py, which once forwarded scan, is gone (#495)', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'global', 'workstation.py')));
});

test('outbound-scan.yml runs the engine script on Node 26, not the CLI, and never blocks on a finding', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'outbound-scan.yml'), 'utf8').replaceAll('\r\n', '\n');
  assert.match(yml, /uses: actions\/setup-node@[0-9a-f]{40}\n\s+with:\n\s+node-version: 26\.\d+\.\d+/);
  assert.match(yml, /run: node \.github\/scripts\/outbound-scan\.js "--base=origin\/\$BASE_REF"/);
  assert.doesNotMatch(yml.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n'), /python|bin\/mhw|mhw scan|continue-on-error/);
});

test('the workflow command reports a synthetic fixture finding on a pull-request-shaped branch, calling the engine without the CLI', { skip: !GIT && 'needs git' }, () => {
  // The run: line of outbound-scan.yml, taken from the workflow itself, against a branch over `base`.
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'outbound-scan.yml'), 'utf8').replaceAll('\r\n', '\n');
  const line = /run: node (\S+) "--base=origin\/\$BASE_REF"/.exec(yml);
  assert.ok(line, 'no run line');
  const b = box();
  fs.writeFileSync(path.join(b.repo, 'notes.txt'), 'write to ' + EMAIL + '\n');
  b.git(['add', '-A']);
  b.git(['commit', '-q', '-m', 'notes']);
  b.git(['update-ref', 'refs/remotes/origin/base', 'base']);
  const r = spawnSync(process.execPath, [path.join(ROOT, line[1]), '--base=origin/base'], { cwd: b.repo, env: { ...b.env, BASE_REF: 'base' }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^notes\.txt:1: email, \d+ chars$/m);
  assert.match(r.stdout, /^[0-9a-f]{7,}:notes\.txt:1: email, \d+ chars$/m);
  assert.match(r.stdout, /^outbound-scan: 2 finding\(s\);/m);
  assert.ok(!r.stdout.includes(EMAIL) && !r.stderr.includes(EMAIL));
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
