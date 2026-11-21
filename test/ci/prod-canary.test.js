// The Node prod canary's own behaviours (#501, S31 of #470), beside its parity test
// (test/ci/prod-canary-golden.test.js): the check #501 adds (no .py, .sh or .ps1 in the installed package,
// but the --legacy ones), the container subcommand that replaces prod-canary-container.sh, and the
// residuals of test/golden/S31/expected-differences.json. Every value is synthetic; the container runtime
// is a stub on PATH; nothing reaches a registry, a container or the real HOME. POSIX only.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { buildFixture, nodeRunner, git, toolPath, SCRIPT } from '../helpers/s31.js';
import { readTar, extractData, runText, kiroHookCommand, KIRO_NOTICE } from '../../.github/scripts/prod-canary.js';
import { which } from '../helpers/home.js';

const POSIX = process.platform !== 'win32';
const SKIP = (!POSIX && 'the canary runs hooks through /bin/sh') || (!(which('npm') && which('git') && which('jq')) && 'needs npm, git and jq on PATH');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

function tmp() {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 's31-unit-')));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  fs.mkdirSync(path.join(d, 'home'));
  fs.mkdirSync(path.join(d, 'tmp'));
  return d;
}

/** @param {string} d */
const envOf = (d) => ({ PATH: toolPath(), HOME: path.join(d, 'home'), TMPDIR: path.join(d, 'tmp'), LANG: 'C.UTF-8' });

/**
 * The canary copied into the fixture at repo, run with args.
 * @param {string} repo @param {string[]} args @param {Record<string, string>} env
 */
function canary(repo, args, env) {
  return spawnSync(process.execPath, [path.join(repo, '.github', 'scripts', 'prod-canary.js'), ...args], { env, encoding: 'utf8', timeout: 300_000 });
}

/** A fixture with one more tagged commit made by change, packed under name. @param {(repo: string) => void} change */
function packed(change) {
  const d = tmp();
  const repo = path.join(d, 'repo');
  buildFixture(repo, nodeRunner);
  change(repo);
  git(repo, ['add', '-A', 'bin', 'variant.json']);
  git(repo, ['commit', '-q', '-m', 'unit']);
  git(repo, ['tag', 'fx-unit']);
  const p = canary(repo, ['pack', '--ref', 'fx-unit', '--name', 'unit', '--out', path.join(d, 'pkg')], envOf(d));
  assert.equal(p.status, 0, p.stdout + p.stderr);
  return { d, repo };
}

/** @param {{ d: string, repo: string }} f @param {string} work @param {string[]} more */
const runIn = (f, work, more = []) => canary(f.repo, ['run', '--source', path.join(f.d, 'pkg', 'src-unit'), '--tgz', path.join(f.d, 'pkg', 'mhw-unit.tgz'),
  '--work', path.join(f.d, work), ...more], envOf(f.d));

test('a .py, .sh or .ps1 file in the installed package is a FAIL; a --legacy one passes; a --legacy one no longer carried is a FAIL', { skip: SKIP }, () => {
  const f = packed((repo) => {
    fs.writeFileSync(path.join(repo, 'variant.json'), '{}\n');
    fs.writeFileSync(path.join(repo, 'bin', 'helper.sh'), '#!/bin/sh\necho synthetic\n');
  });
  let p = runIn(f, 'w-none');
  assert.equal(p.status, 1, p.stdout);
  assert.match(p.stdout, /^FAIL {2}the installed package carries no \.py, \.sh or \.ps1 file\n {6}carried: \['bin\/helper\.sh'\]$/m);
  assert.match(p.stdout, /==> fresh: 1 failure\(s\): the installed package carries no \.py, \.sh or \.ps1 file\n$/);
  p = runIn(f, 'w-legacy', ['--legacy', 'bin/helper.sh']);
  assert.equal(p.status, 0, p.stdout);
  assert.match(p.stdout, /^PASS {2}the installed package carries no \.py, \.sh or \.ps1 file but the 1 --legacy one\(s\) still to be retired$/m);
  assert.match(p.stdout, /^PASS {2}every --legacy file is still in the installed package/m);
  p = runIn(f, 'w-stale', ['--legacy=bin/helper.sh global/install.sh']);
  assert.equal(p.status, 1, p.stdout);
  assert.match(p.stdout, /^FAIL {2}every --legacy file is still in the installed package \(remove a retired one from --legacy\)\n {6}no longer carried: \['global\/install\.sh'\]$/m);
  p = runIn(f, 'w-unsafe', ['--legacy', 'bin/../x']);
  assert.equal(p.status, 2);
  assert.match(p.stdout, /^ERROR refusing --legacy entry 'bin\/\.\.\/x'$/m);
});

test('a carrier that is not JSON is exit 1 with one line, never a stack trace', { skip: SKIP }, () => {
  const f = packed((repo) => fs.writeFileSync(path.join(repo, 'variant.json'), '{"badSettings": true}\n'));
  const p = runIn(f, 'w');
  assert.equal(p.status, 1);
  assert.equal(p.stderr.split('\n').filter(Boolean).length, 1, p.stderr);
  assert.match(p.stderr, /^prod-canary: /);
  assert.doesNotMatch(p.stderr, /\n\s+at /);
});

test('programs are looked up on absolute PATH entries only', { skip: SKIP }, () => {
  const d = tmp();
  const repo = path.join(d, 'repo');
  buildFixture(repo, nodeRunner);
  const bin = path.join(d, 'rel');
  fs.mkdirSync(bin);
  fs.symlinkSync(process.execPath, path.join(bin, 'node'));
  // A relative PATH entry naming a directory that holds node: Python's shutil.which would have used it.
  const p = spawnSync(process.execPath, [path.join(repo, '.github', 'scripts', 'prod-canary.js'), 'run', '--source', repo,
    '--tgz', path.join(d, 'x.tgz'), '--work', path.join(d, 'w')], { cwd: d, env: { PATH: 'rel', HOME: path.join(d, 'home') }, encoding: 'utf8' });
  assert.equal(p.status, 2, p.stdout + p.stderr);
  assert.equal(p.stdout, 'ERROR node is not on PATH\n');
});

/** One ustar header and its data. @param {string} name @param {string} flag @param {string} [data] @param {string} [link] */
function member(name, flag, data = '', link = '') {
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100);
  h.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('        ', 148);
  h.write(flag, 156);
  h.write(link, 157);
  h.write('ustar\u000000', 257, 'latin1');
  let sum = 0;
  for (const b of h) sum += b;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  const body = Buffer.alloc(Math.ceil(data.length / 512) * 512);
  body.write(data);
  return Buffer.concat([h, body]);
}

test('pack refuses an archive member outside the tree, a link out of it, and a special file', () => {
  const good = readTar(Buffer.concat([member('a/b.txt', '0', 'hi\n'), Buffer.alloc(1024)]));
  assert.deepEqual(good.map((m) => [m.name, m.type, m.data.toString()]), [['a/b.txt', 'file', 'hi\n']]);
  for (const [bad, why] of /** @type {Array<[Buffer, RegExp]>} */ ([
    [member('../escape.txt', '0', 'x'), /outside the destination/],
    [member('l', '2', '', '/etc/passwd'), /link out of the destination/],
    [member('l', '2', '', '../../x'), /link out of the destination/],
    [member('fifo', '6'), /not a regular file/],
  ])) {
    const d = tmp();
    const dest = path.join(d, 'src');
    fs.mkdirSync(dest);
    /** @type {string[]} */
    const lines = [];
    const write = process.stdout.write;
    process.stdout.write = /** @type {typeof process.stdout.write} */ ((/** @type {string} */ s) => lines.push(s) > 0);
    try {
      assert.throws(() => extractData(readTar(Buffer.concat([bad, Buffer.alloc(1024)])), dest), /exit 2/);
    } finally {
      process.stdout.write = write;
    }
    assert.match(lines.join(''), why);
    assert.deepEqual(fs.readdirSync(d).sort((a, b) => a.localeCompare(b)), ['home', 'src', 'tmp'], 'nothing written outside');
  }
});

test('a hook killed by a signal is reported with the negative exit code Python gave', { skip: !POSIX && 'POSIX' }, () => {
  // The canary's hook calls time out after 60 seconds and are then killed (SIGTERM): the FAIL names exit
  // -15 where Python stopped with a TimeoutExpired traceback. The timeout itself is not exercised here.
  assert.equal(runText('/bin/sh', ['-c', 'kill -TERM $$']).returncode, -15);
  assert.equal(runText('/bin/sh', ['-c', 'exit 3']).returncode, 3);
});

test('options are spelled in full: an abbreviation and -h are usage errors, never a guess', () => {
  /** @param {string[]} args */
  const run = (args) => spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin' } });
  let p = run(['run', '--sou', 'x', '--tgz', 'y', '--work', 'z']);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /^prod-canary\.js run: error: the following arguments are required: --source$/m);
  p = run(['pack', '-h']);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /^prod-canary\.js pack: error: the following arguments are required: --ref, --out$/m);
  p = run(['pack', '--ref', 'HEAD', '--out', 'o', '--extra']);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /^prod-canary\.js pack: error: unrecognized arguments: --extra$/m);
});

test('the Kiro hook command is install.sh\'s start fallback around the inner command', () => {
  assert.equal(kiroHookCommand('X'), "/bin/sh -c 'X || { [ $? -eq 2 ] && exit 2; printf \"%s\\n\" \"" + KIRO_NOTICE + "\" >&2; exit 2; }'");
});

/** A stub container runtime on PATH that records its argv. */
function stubRuntime() {
  const d = tmp();
  const bin = path.join(d, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(d, 'argv.json');
  fs.writeFileSync(path.join(bin, 'fake-runtime'), '#!' + process.execPath + '\nrequire("fs").writeFileSync(' + JSON.stringify(log)
    + ', JSON.stringify(process.argv.slice(2)));\nprocess.exit(7);\n');
  fs.chmodSync(path.join(bin, 'fake-runtime'), 0o700);
  fs.mkdirSync(path.join(d, 'pkg'));
  const env = { PATH: bin + ':/usr/bin:/bin', HOME: path.join(d, 'home'), CONTAINER_RUNTIME: 'fake-runtime' };
  return { d, log, env };
}

const IMAGE = 'docker.io/library/node@sha256:' + 'b'.repeat(64);
const COMMIT = 'a'.repeat(40);

test('container refuses an image not pinned by digest, a short commit, an unknown mode, an unsafe --legacy entry and a wrong argument count', { skip: !POSIX && 'POSIX' }, () => {
  const s = stubRuntime();
  /** @param {string[]} args */
  const run = (args) => spawnSync(process.execPath, [SCRIPT, 'container', ...args], { env: s.env, encoding: 'utf8' });
  let p = run(['node:26', path.join(s.d, 'pkg'), COMMIT, 'fresh']);
  assert.equal(p.status, 2);
  assert.equal(p.stderr, 'BLOCK  the image is not pinned by digest: node:26\n');
  p = run([IMAGE, path.join(s.d, 'pkg'), COMMIT.slice(0, 12), 'fresh']);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /full lower-case SHA/);
  p = run([IMAGE, path.join(s.d, 'pkg'), COMMIT, 'sideways']);
  assert.equal(p.status, 2);
  assert.equal(p.stderr, 'mode must be fresh or upgrade\n');
  p = run([IMAGE, path.join(s.d, 'pkg'), COMMIT, 'fresh', '--legacy', "x' ; rm -rf /tmp/y '"]);
  assert.equal(p.status, 2);
  assert.match(p.stdout, /^ERROR refusing --legacy entry /);
  p = run([IMAGE, path.join(s.d, 'pkg'), COMMIT]);
  assert.equal(p.status, 2);
  assert.match(p.stderr, /^usage: prod-canary\.js container IMAGE PKG_DIR COMMIT fresh\|upgrade/);
  assert.ok(!fs.existsSync(s.log), 'the runtime never ran');
});

test('container runs the runtime with the packages read-only and the head\'s own canary inside, as the node user', { skip: !POSIX && 'POSIX' }, () => {
  const s = stubRuntime();
  const pkg = path.join(s.d, 'pkg');
  const p = spawnSync(process.execPath, [SCRIPT, 'container', IMAGE, pkg, COMMIT, 'upgrade', '--legacy', 'global/install.sh global/install.ps1'],
    { env: s.env, encoding: 'utf8' });
  assert.equal(p.status, 7, 'the runtime\'s exit code is the canary\'s: ' + p.stderr);
  const argv = JSON.parse(fs.readFileSync(s.log, 'utf8'));
  assert.deepEqual(argv.slice(0, 6), ['run', '--rm', '--network=bridge', '-v', pkg + ':/pkg:ro', IMAGE]);
  assert.deepEqual(argv.slice(6, 8), ['sh', '-euc']);
  assert.deepEqual(argv.slice(9), ['canary', COMMIT, 'upgrade', '--from-tgz /pkg/mhw-from.tgz', 'global/install.sh global/install.ps1']);
  const script = argv[8];
  assert.match(script, /apt-get install -y -qq --no-install-recommends jq/);
  assert.match(script, /exec su node -s \/bin\/sh -c "node \/pkg\/src-HEAD\/\.github\/scripts\/prod-canary\.js run --source \/pkg\/src-HEAD/);
  assert.match(script, /--tgz \/pkg\/mhw-HEAD\.tgz \$3 --work \/tmp\/prod-canary-\$2 --commit \$1 --legacy '\$4'"/);
  assert.doesNotMatch(script, /python/);
});
