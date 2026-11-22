// The npm package mhw (Issue #68, ADR-0034), as node:test since #495 (S24 of #470; it was
// global/npm_package_test.py): the launchers (bin/mhw.js, and the checkout's ./mhw, a Node file since #495),
// the postinstall that installs nothing (Issue #113), the archive provenance stamp read when there is no .git,
// the packed file list, and npm-mode install, update and uninstall. Throwaway HOMEs, npm prefixes, caches and
// admin roots only; never a registry, never a real configuration, never sudo.
// An npm install from GitHub downloads the source archive GitHub builds with git archive. These tests build
// the same thing: this working tree's files, with .workstation-archive as `git archive HEAD` fills it in,
// then npm pack and npm install -g of that into a throwaway prefix, --offline (mhw has no npm runtime
// dependency since #472, so a runtime dependency added later fails them loudly). One test installs through
// npm's git-dependency route (git+file://), which runs pacote's preparation step.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { which } from '../helpers/home.js';
import { decide, undoPrepareLink } from '../../src/commands/postinstall.js';
import { NOT_RUN, UPGRADE_FIRST, LEGACY_PACKAGE } from '../../src/commands/status.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const NODE = process.execPath;
const NPM = which('npm');
const GIT = which('git');
const JQ = !!which('jq');
const GLOB = 'v[0-9]*.[0-9]*.[0-9]*';
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-test-npm-package-')));
after(() => fs.rmSync(base, { recursive: true, force: true }));
const PKG = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const VERSION = PKG.version;

/** @param {string[]} args */
const git = (...args) => spawnSync(/** @type {string} */ (GIT), ['-C', ROOT, ...args], { encoding: 'utf8' });
/** A fresh directory under the test's own temporary root. @param {string} label */
const fresh = (label) => fs.mkdtempSync(path.join(base, label + '-'));

/** install.sh's rule for HEAD, as an archive of HEAD (never dirty) must reproduce it. */
function expectedStamp() {
  const commit = git('rev-parse', 'HEAD').stdout.trim();
  const exact = git('describe', '--tags', '--exact-match', '--match', GLOB, 'HEAD');
  const near = git('describe', '--tags', '--abbrev=0', '--match', GLOB, 'HEAD');
  const release = exact.status === 0 ? exact.stdout.trim() : near.status === 0 ? 'unreleased, after ' + near.stdout.trim() : 'unreleased, no tag reachable';
  return 'release: ' + release + '; commit: ' + commit;
}

/** .workstation-archive exactly as git archive (and so GitHub) writes it for HEAD. */
function archiveText() {
  const p = spawnSync(/** @type {string} */ (GIT), ['-C', ROOT, 'archive', '--format=tar', 'HEAD', '.workstation-archive'], { encoding: 'buffer' });
  assert.equal(p.status, 0, String(p.stderr));
  // A tar: 512-byte headers, each followed by its data in 512-byte blocks. git archive writes a pax global
  // header (type g, the commit id) first; the member wanted is the regular file named .workstation-archive.
  for (let at = 0; at + 512 <= p.stdout.length;) {
    const header = p.stdout.subarray(at, at + 512);
    const name = header.subarray(0, 100).toString('latin1').replace(/\0.*$/s, '');
    if (!name) break;
    const size = parseInt(header.subarray(124, 136).toString('latin1').replaceAll('\0', '').trim() || '0', 8);
    const type = String.fromCharCode(header[156]);
    if (name === '.workstation-archive' && (type === '0' || type === '\0')) return p.stdout.subarray(at + 512, at + 512 + size).toString('utf8');
    at += 512 + Math.ceil(size / 512) * 512;
  }
  throw new Error('no .workstation-archive in git archive HEAD');
}

/** This working tree's tracked and new files (what GitHub would archive once committed). @param {string} dest @param {string} [archive] */
function sourceTree(dest, archive) {
  const p = spawnSync(/** @type {string} */ (GIT), ['-C', ROOT, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  for (const rel of p.stdout.split('\0').filter(Boolean)) {
    const from = path.join(ROOT, rel);
    let st;
    try {
      st = fs.statSync(from);
    } catch {
      continue; // deleted in the working tree
    }
    if (!st.isFile()) continue;
    fs.mkdirSync(path.dirname(path.join(dest, rel)), { recursive: true });
    fs.copyFileSync(from, path.join(dest, rel));
    fs.chmodSync(path.join(dest, rel), st.mode & 0o777);
  }
  if (archive !== undefined) fs.writeFileSync(path.join(dest, '.workstation-archive'), archive);
  return dest;
}

/** A throwaway HOME, admin root, npm prefix and cache, and the environment that names only them. @param {string} label */
function npmEnv(label) {
  const d = fresh(label);
  for (const sub of ['home', 'root', 'tmp', 'proj']) fs.mkdirSync(path.join(d, sub), { recursive: true });
  /** @type {Record<string, string>} */
  const env = { PATH: path.join(d, 'prefix', 'bin') + path.delimiter + path.dirname(NODE) + path.delimiter + (process.env.PATH || ''), HOME: path.join(d, 'home'),
    TMPDIR: path.join(d, 'tmp'), WORKSTATION_MANAGED_ROOT: path.join(d, 'root'), SHELL: '/bin/sh', LANG: 'C.UTF-8',
    npm_config_cache: path.join(base, 'cache'), npm_config_prefix: path.join(d, 'prefix'), npm_config_userconfig: path.join(d, 'npmrc'),
    npm_config_update_notifier: 'false', npm_config_audit: 'false', npm_config_fund: 'false', MHW_POSTINSTALL_TTY: '0' };
  return { d, env };
}

/** @param {string} p @param {string} text */
function writeExe(p, text) {
  fs.writeFileSync(p, text);
  fs.chmodSync(p, 0o755);
}

/** @param {string} tree */
function pack(tree) {
  const p = spawnSync(/** @type {string} */ (NPM), ['pack', '--pack-destination', base, '--cache', path.join(base, 'cache')], { cwd: tree, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  return path.join(base, p.stdout.trim().split('\n').pop() || '');
}

/** @param {string} cwd @param {Record<string, string>} env @param {string[]} args */
const npm = (cwd, env, ...args) => spawnSync(/** @type {string} */ (NPM), args, { cwd, env, encoding: 'utf8' });
/** @param {string} d @param {Record<string, string>} env @param {string[]} args */
const mhw = (d, env, ...args) => spawnSync(path.join(d, 'prefix', 'bin', 'mhw'), args, { cwd: path.join(d, 'proj'), env, encoding: 'utf8' });
/** The installed Claude Code brief's first line, or null. @param {string} d */
const brief = (d) => {
  const p = path.join(d, 'home', '.claude', 'CLAUDE.md');
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').split('\n')[0] : null;
};
/** @param {string} dir */
const filesUnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()) : []);

// ------------------------------------------------------------------- the launchers

test('the npm launcher resolves the package, not the current directory', { skip: !POSIX && 'POSIX: a symlink on PATH' }, () => {
  // npm puts a symlink on PATH; the launcher must find its package beside its real file, from anywhere.
  const d = fresh('launcher');
  fs.mkdirSync(path.join(d, 'bin'));
  fs.mkdirSync(path.join(d, 'elsewhere'));
  const link = path.join(d, 'bin', 'mhw');
  fs.symlinkSync(path.join(ROOT, 'bin', 'mhw.js'), link);
  let p = spawnSync(link, ['--help'], { cwd: path.join(d, 'elsewhere'), encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.ok(p.stdout.includes('./mhw install --admin'));
  assert.equal(p.stderr, '');
  p = spawnSync(link, ['no-such-subcommand'], { cwd: path.join(d, 'elsewhere'), encoding: 'utf8' });
  assert.equal(p.status, 2);
  assert.ok(p.stderr.includes('mhw: unknown subcommand no-such-subcommand'));
});

test("the checkout's ./mhw is a Node file and answers exactly as the npm mhw", { skip: !POSIX && 'POSIX: ./mhw is run by its #! line' }, () => {
  const text = fs.readFileSync(path.join(ROOT, 'mhw'), 'utf8');
  assert.equal(text.split('\n')[0], '#!/usr/bin/env node');
  assert.ok((fs.statSync(path.join(ROOT, 'mhw')).mode & 0o111) !== 0, './mhw is executable');
  const env = { PATH: path.dirname(NODE) + ':/usr/bin:/bin', HOME: fresh('same-home'), LANG: 'C.UTF-8' };
  for (const args of [['--help'], [], ['nope'], ['postinstall'], ['install', '--admin', '--no-admin'], ['update', 'v4.2'], ['install', '--overlay=/nonexistent'],
    ['delivery', '--help'], ['policy', 'check', '--file=/nonexistent/x.json']]) {
    const a = spawnSync(path.join(ROOT, 'mhw'), args, { env, encoding: 'utf8' });
    const b = spawnSync(NODE, [path.join(ROOT, 'bin', 'mhw.js'), ...args], { env, encoding: 'utf8' });
    assert.deepEqual([a.status, a.stdout, a.stderr], [b.status, b.stdout, b.stderr], args.join(' '));
    // An earlier release's `mhw update` (npm mode) runs `/bin/sh <the new package>/mhw install`: under sh,
    // line 2 execs node on bin/mhw.js, so that caller meets the same command.
    const c = spawnSync('/bin/sh', [path.join(ROOT, 'mhw'), ...args], { env, encoding: 'utf8' });
    assert.deepEqual([c.status, c.stdout, c.stderr], [b.status, b.stdout, b.stderr], 'sh ' + args.join(' '));
  }
  // Without node on PATH, ./mhw fails at its #! line, and under sh it says so; no Python behind it any more.
  const p = spawnSync(path.join(ROOT, 'mhw'), ['--help'], { env: { PATH: '/nonexistent' }, encoding: 'utf8' });
  assert.notEqual(p.status, 0);
  assert.equal(p.stdout, '');
  const q = spawnSync('/bin/sh', [path.join(ROOT, 'mhw'), '--help'], { env: { PATH: '/nonexistent' }, encoding: 'utf8' });
  assert.deepEqual([q.status, q.stdout, q.stderr], [2, '', 'mhw: node (26 or later) is required\n']);
});

test('the workstation alias is gone (Issue #206), and mhw prints no rename notice', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'workstation')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'bin', 'workstation.js')));
  for (const args of [['--help'], ['no-such-subcommand']]) {
    const p = spawnSync(NODE, [path.join(ROOT, 'bin', 'mhw.js'), ...args], { encoding: 'utf8', env: { ...process.env, WORKSTATION_LAUNCHER_PLATFORM: 'linux' } });
    assert.ok(!(p.stderr + p.stdout).includes('renamed'));
  }
});

test('the Windows mapping onto mhw install-windows (#497; install.ps1 until then)', async () => {
  const { windowsPlan } = await import(pathToFileURL(path.join(ROOT, 'src', 'cli.js')).href);
  assert.deepEqual(windowsPlan(['install']), { code: 0, argv: [] });
  assert.deepEqual(windowsPlan(['install', '--method', '--overlay=none']), { code: 0, argv: ['--method', '--overlay=none'] });
  assert.deepEqual(windowsPlan(['check']), { code: 0, argv: ['--check'] });
  assert.deepEqual(windowsPlan(['status', '--overlay=x']), { code: 0, argv: ['--check', '--overlay=x'] });
  // End to end on a throwaway profile: install, then check and status, through bin/mhw.js on the Windows path.
  const prof = fresh('win-profile');
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, WORKSTATION_LAUNCHER_PLATFORM: 'win32', USERPROFILE: prof, HOME: prof };
  delete env.CODEX_HOME;
  delete env.MHW_NODE;
  /** @param {string[]} args */
  const run = (...args) => {
    const p = spawnSync(NODE, [path.join(ROOT, 'bin', 'mhw.js'), ...args], { env, encoding: 'utf8' });
    return { code: p.status, out: p.stdout.split(/\r?\n/).filter(Boolean), err: p.stderr };
  };
  const inst = run('install', '--overlay=none');
  assert.equal(inst.code, 0, inst.out.join('\n') + inst.err);
  assert.ok(inst.out.some((l) => l.startsWith('WROTE   ') && l.includes('CLAUDE.md')), inst.out.join('\n'));
  assert.ok(fs.existsSync(path.join(prof, '.claude', 'CLAUDE.md')));
  assert.equal(run('check', '--overlay=none').code, 0);
  const st = run('status', '--overlay=none');
  assert.equal(st.code, 0, st.out.join('\n'));
  assert.match(st.out[0], /^NODE {4}(ok|FAIL) {2}/);
  assert.match(st.out[1], /^PASTE {3}n\/a {3}the paste wrapper is not installed on Windows/);
  assert.match(st.out[2], /^OK {6}.*CLAUDE\.md \(release: /);
  for (const args of [['install', '--admin'], ['uninstall'], ['check', '--method'], ['install', '--overlay=']]) {
    const r = run(...args);
    assert.deepEqual([r.code, r.out], [2, []], args.join(' '));
    assert.ok(r.err.startsWith('mhw: '), r.err);
  }
  const u = run('update', 'v4.2.0');
  assert.equal(u.code, 0);
  assert.ok(u.out.includes('RUN     npm install -g github:tedeuxx/mhw#v4.2.0'));
});

test('package.json: name, bin, ESM, no runtime dependency, one lifecycle script', () => {
  // The release bump (src/commands/release-bump.js, #473) rewrites package.json in the same commit.
  const toml = fs.readFileSync(path.join(ROOT, '.bumpversion.toml'), 'utf8');
  assert.equal(PKG.version, /^current_version\s*=\s*"([^"]+)"/m.exec(toml)?.[1]);
  assert.ok(toml.includes('filename = "package.json"'));
  assert.equal(PKG.private, true);
  assert.equal(PKG.name, 'mhw');
  assert.equal(PKG.description, 'multi-harness managed workstation');
  assert.deepEqual(PKG.bin, { mhw: 'bin/mhw.js' });
  assert.equal(PKG.type, 'module');
  // #472: no npm runtime dependency (the TOML library is vendored); devDependencies exact, locked.
  assert.ok(!('dependencies' in PKG));
  for (const [name, spec] of Object.entries(PKG.devDependencies)) assert.match(String(spec), /^\d+\.\d+\.\d+$/, name);
  assert.ok(fs.existsSync(path.join(ROOT, 'npm-shrinkwrap.json')));
  assert.ok(!fs.existsSync(path.join(ROOT, 'package-lock.json')), 'one lockfile: npm-shrinkwrap.json');
  // Any script makes npm 11 prepare a git install in a temporary clone it links into the global prefix
  // (measured); bin/postinstall.js undoes that link. typecheck and test are not lifecycle scripts.
  assert.equal(PKG.scripts.postinstall, 'node bin/postinstall.js');
  assert.deepEqual(Object.keys(PKG.scripts).sort(), ['postinstall', 'test', 'typecheck']);
  // #495: the files list names no Python test file, because there is none to keep out.
  assert.deepEqual(PKG.files.filter((/** @type {string} */ f) => /py/.test(f) && f !== '!**/__pycache__/'), []);
});

// ------------------------------------------------------------------- the postinstall, without npm

test('postinstall decides: prepare, skip or install', () => {
  const prefix = path.join(fresh('decide'), 'prefix');
  const installed = path.join(prefix, 'lib', 'node_modules', 'mhw');
  fs.mkdirSync(installed, { recursive: true });
  const clone = path.join(base, 'cache', '_cacache', 'tmp', 'git-clone1');
  fs.mkdirSync(clone, { recursive: true });
  const glob = { npm_config_global: 'true', npm_config_prefix: prefix };
  /** @param {Record<string, string>} env @param {string} root */
  const d = (env, root) => decide(env, 'darwin', root, 'mhw').action;
  assert.equal(d(glob, installed), 'install');
  assert.equal(d({ npm_config_global: 'true' }, installed), 'install');
  assert.equal(d({ ...glob, _PACOTE_NO_PREPARE_: 'git+file://x' }, clone), 'prepare');
  assert.equal(d({ ...glob, _PACOTE_NO_PREPARE_: '' }, installed), 'prepare');
  assert.equal(d({}, installed), 'skip');
  assert.equal(d({ npm_config_global: 'false', CI: 'true' }, installed), 'skip');
  assert.equal(d(glob, clone), 'skip');
  const other = path.join(base, 'other', 'node_modules', 'mhw');
  fs.mkdirSync(other, { recursive: true });
  assert.equal(d(glob, other), 'skip');
});

test("postinstall undoes the preparation run's link into the prefix, and touches nothing else", { skip: !POSIX && 'symlinks' }, () => {
  const d = fresh('undo');
  const modules = path.join(d, 'prefix', 'lib', 'node_modules');
  fs.mkdirSync(modules, { recursive: true });
  const clone = path.join(d, 'clone');
  fs.mkdirSync(clone);
  fs.writeFileSync(path.join(clone, 'keep'), 'x');
  const env = { npm_config_global: 'true', npm_config_prefix: path.join(d, 'prefix') };
  const link = path.join(modules, 'mhw');
  fs.symlinkSync(clone, link);
  assert.ok(undoPrepareLink(env, 'darwin', clone, 'mhw').includes('replaced the link'));
  assert.ok(fs.lstatSync(link).isDirectory() && !fs.lstatSync(link).isSymbolicLink());
  assert.deepEqual(fs.readdirSync(link), []);
  assert.ok(fs.existsSync(path.join(clone, 'keep')));
  assert.ok(undoPrepareLink(env, 'darwin', clone, 'mhw').includes('untouched'));
  fs.rmdirSync(link);
  fs.mkdirSync(path.join(d, 'elsewhere'));
  fs.symlinkSync(path.join(d, 'elsewhere'), link);
  assert.ok(undoPrepareLink(env, 'darwin', clone, 'mhw').includes('untouched'));
  assert.ok(fs.lstatSync(link).isSymbolicLink());
  fs.unlinkSync(link);
  fs.symlinkSync(clone, link);
  assert.ok(undoPrepareLink({ npm_config_prefix: path.join(d, 'prefix') }, 'darwin', clone, 'mhw').includes('not global'));
  assert.ok(fs.lstatSync(link).isSymbolicLink());
});

// ------------------------------------------------------------------- the archive stamp

/** install.sh --check's SOURCE line for a tree. @param {string} tree @param {Record<string, string>} env */
function sourceLine(tree, env) {
  const p = spawnSync(process.execPath, [path.join(tree, 'bin', 'mhw.js'), 'install-user', '--check', '--overlay=none'], { env, encoding: 'utf8' });
  return /^SOURCE {2}(.*)$/m.exec(p.stdout)?.[1];
}

const stampSkip = (!POSIX || !GIT || !JQ) && 'needs git, jq and a POSIX sh';

test('the archive is substituted, and install.sh reads the same stamp from it as from git', { skip: stampSkip }, () => {
  const text = archiveText();
  assert.ok(!text.includes('$Format'));
  const tree = sourceTree(fresh('arch'), text);
  assert.equal(sourceLine(tree, npmEnv('e').env), expectedStamp());
});

test('the archive stamp: describe forms, and anything else is unknown', { skip: stampSkip }, () => {
  const tree = sourceTree(fresh('forms'));
  const { env } = npmEnv('e');
  const sha = '0123456789abcdef0123456789abcdef01234567';
  for (const [describe, release] of [['v4.1.0', 'release: v4.1.0'], ['v4.1.0-12-g0123456', 'release: unreleased, after v4.1.0'], ['', 'release: unreleased, no tag reachable']]) {
    fs.writeFileSync(path.join(tree, '.workstation-archive'), 'commit: ' + sha + '\ndescribe: ' + describe + '\n');
    assert.equal(sourceLine(tree, env), release + '; commit: ' + sha, describe);
  }
  for (const bad of ['commit: $Format:%H$\ndescribe: $Format:%(describe)$\n', 'commit: ' + sha + '\ndescribe: v4.1.0-rc1\n',
    'commit: ' + sha + '\ndescribe: v4.1.0; commit: x\n', 'commit: ' + sha.slice(0, 39) + '\ndescribe: v4.1.0\n']) {
    fs.writeFileSync(path.join(tree, '.workstation-archive'), bad);
    assert.ok(sourceLine(tree, env)?.startsWith('release: unknown, not a git checkout (.bumpversion.toml says '), bad);
  }
});

test('inside another repository, the package keeps its own stamp', { skip: stampSkip }, () => {
  const outer = fresh('outer');
  spawnSync(/** @type {string} */ (GIT), ['init', '-q', outer]);
  spawnSync(/** @type {string} */ (GIT), ['-C', outer, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', 'commit', '-q', '--allow-empty', '-m', 'outer']);
  const tree = sourceTree(path.join(outer, 'pkg'), archiveText());
  assert.equal(sourceLine(tree, npmEnv('e').env), expectedStamp());
});

// ------------------------------------------------------------------- npm pack and npm install -g

const npmSkip = (!POSIX || !NPM || !GIT || !JQ) && 'needs npm, git, jq and a POSIX sh';
/** @type {string | null} */
let packed = null;
/** The packed tarball of this tree, made once. */
const tarball = () => (packed ??= pack(sourceTree(fresh('src'), archiveText())));

test('the packed file list: what mhw needs, no Python file, nothing private (npm pack --dry-run --json)', { skip: npmSkip }, () => {
  const tree = sourceTree(fresh('files'), archiveText());
  fs.writeFileSync(path.join(tree, 'overlay', 'mcp-servers.json'), '{}');
  fs.writeFileSync(path.join(tree, 'overlay', 'x.local.json'), '{}');
  const p = spawnSync(/** @type {string} */ (NPM), ['pack', '--dry-run', '--json', '--cache', path.join(base, 'cache')], { cwd: tree, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  const names = new Set(JSON.parse(p.stdout)[0].files.map((/** @type {{ path: string }} */ f) => f.path));
  for (const needed of ['mhw', '.bumpversion.toml', '.workstation-archive', 'bin/mhw.js', 'bin/postinstall.js', 'src/cli.js', 'src/lib/toml.js',
    'npm-shrinkwrap.json', 'src/vendor/smol-toml/dist/index.js', 'src/vendor/smol-toml/LICENSE', 'src/commands/install.js', 'src/commands/update.js',
    'src/commands/uninstall.js', 'src/commands/postinstall.js', 'src/commands/lifecycle.js', 'src/lib/lifecycle.js', 'src/commands/status.js',
    'src/commands/check.js', 'src/lib/prerequisites.js', 'src/lib/http-get.js', 'src/lib/merge-authority.js', 'src/commands/install-user.js', 'src/commands/install-admin.js',
    'src/commands/install-windows.js', 'global/AGENTS.md', 'global/deny-floor.conf', 'global/project-policy/project-policy.schema.json', 'overlay/profile.json', 'package.json']) {
    assert.ok(names.has(needed), needed);
  }
  const all = [...names];
  assert.deepEqual(all.filter((n) => n.endsWith('.py')), [], 'the tarball carries a Python file');
  assert.deepEqual(all.filter((n) => /\.test\.(sh|ps1|stub)$/.test(n)), []);
  for (const gone of ['workstation', 'bin/workstation.js', 'global/workstation.py', 'global/install.sh', 'global/install.test.sh', 'global/install.ps1', 'global/install.test.ps1', 'global/install-managed.sh', 'global/github-repo-settings.sh', 'global/method/plugin_retire.py', 'global/mcp/mcp_retire.py']) {
    assert.ok(!names.has(gone), gone);
  }
  assert.deepEqual(all.filter((n) => /^(docs|workspace|\.github|\.git|test|node_modules)\//.test(n)), []);
  assert.ok(!names.has('tsconfig.json'));
  // A local overlay MCP definition (untracked, ADR-0017) must never ride into a package.
  assert.ok(!names.has('overlay/mcp-servers.json'));
  assert.ok(!names.has('overlay/x.local.json'));
});

test('a global install is the pinned tree, without devDependencies', { skip: npmSkip }, () => {
  const { d, env } = npmEnv('tree');
  let p = npm(d, env, 'install', '-g', '--offline', tarball());
  assert.equal(p.status, 0, p.stdout + p.stderr);
  p = npm(d, env, 'ls', '-g', '--all', '--json');
  const tree = JSON.parse(p.stdout).dependencies.mhw.dependencies || {};
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'npm-shrinkwrap.json'), 'utf8')).packages;
  const pinned = Object.fromEntries(Object.entries(lock).filter(([k, v]) => k.startsWith('node_modules/') && !v.dev && !v.optional).map(([k, v]) => [k.slice('node_modules/'.length), v.version]));
  assert.deepEqual(Object.fromEntries(Object.entries(tree).map(([k, v]) => [k, /** @type {any} */ (v).version])), pinned);
  for (const name of Object.keys(PKG.devDependencies)) assert.ok(!fs.existsSync(path.join(d, 'prefix', 'lib', 'node_modules', 'mhw', 'node_modules', name)), name);
});

test('npm installs nothing; mhw install sets up; update runs npm, then the new install; uninstall before npm uninstall', { skip: npmSkip }, () => {
  const { d, env } = npmEnv('e2e');
  let p = npm(d, env, 'install', '-g', '--offline', '--foreground-scripts', tarball());
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const pkg = path.join(d, 'prefix', 'lib', 'node_modules', 'mhw');
  assert.ok(!fs.lstatSync(pkg).isSymbolicLink());
  assert.ok(!fs.existsSync(path.join(pkg, '.git')));
  // Issue #113: npm installs mhw like any global package; the postinstall names the next step only.
  assert.ok(p.stdout.includes('mhw ' + VERSION + ' is ready. Run `mhw install` to set up or update this workstation.\n'), p.stdout);
  assert.ok(!(p.stdout + p.stderr).includes('sudo'));
  assert.equal(brief(d), null);
  assert.deepEqual(fs.readdirSync(path.join(d, 'root')), []);
  p = mhw(d, env, 'status', '--project=' + path.join(d, 'proj'));
  assert.ok(p.stdout.includes(NOT_RUN), p.stdout);
  // No terminal: mhw install says what it would do and changes nothing.
  p = mhw(d, env, 'install');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(p.stdout.includes('Nothing was changed: no terminal to confirm in.'));
  assert.equal(brief(d), null);
  p = mhw(d, env, 'install', '--yes');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(p.stdout.includes('==> mhw ' + VERSION + ' will change this workstation:\n'), p.stdout);
  assert.ok(p.stdout.includes('\nInstallation successful!\n'), p.stdout);
  assert.doesNotMatch(p.stdout, /^(RUN|STAGED|FLOOR|ADMIN|THEN|ACTION) /m);
  assert.ok(brief(d)?.includes('; ' + expectedStamp() + ';'), String(brief(d)));
  assert.ok(filesUnder(path.join(d, 'root')).length > 0);
  // Reinstalling the same package leaves the setup untouched.
  const before = fs.readFileSync(path.join(d, 'home', '.claude', 'CLAUDE.md'));
  p = npm(d, env, 'install', '-g', '--offline', tarball());
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.deepEqual(fs.readFileSync(path.join(d, 'home', '.claude', 'CLAUDE.md')), before);
  p = mhw(d, env, 'status', '--project=' + path.join(d, 'proj'));
  assert.equal(p.status, 0, p.stderr);
  assert.ok(!p.stdout.includes(NOT_RUN));
  assert.ok(!p.stdout.includes('  npm  '));
  assert.ok(!fs.existsSync(path.join(d, 'prefix', 'bin', 'workstation')), 'Issue #206: no workstation bin');
  // mhw update runs npm itself (a stand-in here: no network), then the new package's install.
  const log = path.join(d, 'npm-args');
  const fake = path.join(d, 'fake-npm');
  writeExe(fake, "#!/bin/sh\nprintf '%s\\n' \"$@\" > '" + log + "'\n");
  p = mhw(d, { ...env, MHW_NPM: fake }, 'update', '--yes');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(fs.readFileSync(log, 'utf8').split('\n').includes('github:tedeuxx/mhw#semver:^' + VERSION));
  assert.ok(p.stdout.includes('==> Updating mhw (to the newest release of this major version)\n'));
  assert.ok(p.stdout.includes('==> mhw ' + VERSION + ' is already installed and up to date\n'), p.stdout);
  p = mhw(d, env, 'update', 'main');
  assert.equal(p.status, 2);
  // mhw uninstall first (npm runs no uninstall script), then npm uninstall -g mhw.
  p = mhw(d, env, 'uninstall', '--yes');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(p.stdout.includes('Run `npm uninstall -g mhw` to remove the mhw command itself.'));
  assert.equal(brief(d), null);
  assert.deepEqual(filesUnder(path.join(d, 'root')), []);
  p = npm(d, env, 'uninstall', '-g', 'mhw');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(!fs.existsSync(pkg));
});

test('a refused install says what to fix (Issue #110, #113)', { skip: npmSkip }, () => {
  const { d, env } = npmEnv('refuse');
  const foreign = path.join(d, 'home', '.claude', 'CLAUDE.md');
  fs.mkdirSync(path.dirname(foreign), { recursive: true });
  fs.writeFileSync(foreign, "the owner's own brief, not managed by this project\n");
  let p = npm(d, env, 'install', '-g', '--offline', '--foreground-scripts', tarball());
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(fs.existsSync(path.join(d, 'prefix', 'lib', 'node_modules', 'mhw', 'src', 'commands', 'install-admin.js')));
  p = mhw(d, env, 'install', '--yes', '--no-admin');
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.match(p.stdout, /^ {4}REFUSE {2}.*CLAUDE\.md: exists and is NOT managed/m);
  assert.ok(p.stdout.includes('Installation incomplete:'));
  assert.match(p.stdout, /^1\. Fix what is named above, then run `mhw install` again\.$/m);
  assert.equal(fs.readFileSync(foreign, 'utf8'), "the owner's own brief, not managed by this project\n");
});

test('npm uninstall -g runs no script, so the user layer stays until mhw uninstall (measured npm behaviour)', { skip: npmSkip }, () => {
  const { d, env } = npmEnv('un');
  assert.equal(npm(d, env, 'install', '-g', '--offline', tarball()).status, 0);
  assert.equal(mhw(d, env, 'install', '--yes').status, 0);
  assert.notEqual(brief(d), null);
  const p = npm(d, env, 'uninstall', '-g', 'mhw');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(!fs.existsSync(path.join(d, 'prefix', 'lib', 'node_modules', 'mhw')));
  assert.notEqual(brief(d), null);
});

test('--ignore-scripts is reported by status and check, and mhw install still sets up', { skip: npmSkip }, () => {
  const { d, env } = npmEnv('ign');
  let p = npm(d, env, 'install', '-g', '--offline', '--ignore-scripts', tarball());
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.equal(brief(d), null);
  p = mhw(d, env, 'status', '--project=' + path.join(d, 'proj'));
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /^ {2}npm {14}installed by npm; the workstation is not set up from it yet: .*the user layer carries nothing; run mhw install$/m);
  p = mhw(d, env, 'check');
  assert.notEqual(p.status, 0);
  assert.match(p.stdout, /^NPM {5}installed by npm; the workstation is not set up from it yet/m);
  p = mhw(d, env, 'install', '--yes');
  assert.equal(p.status, 0, p.stdout + p.stderr);
  p = mhw(d, env, 'status', '--project=' + path.join(d, 'proj'));
  assert.ok(!p.stdout.includes(NOT_RUN));
});

test('as a local dependency the postinstall does nothing', { skip: npmSkip }, () => {
  const { d, env } = npmEnv('local');
  fs.writeFileSync(path.join(d, 'proj', 'package.json'), '{"name":"consumer","version":"1.0.0","private":true}\n');
  const p = spawnSync(/** @type {string} */ (NPM), ['install', '--offline', '--foreground-scripts', tarball()], { env, cwd: path.join(d, 'proj'), encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(!p.stdout.includes('mhw install'));
  assert.ok(!fs.existsSync(path.join(d, 'home', '.claude')));
  assert.ok(!fs.existsSync(path.join(d, 'home', '.codex')));
});

test("npm's git-dependency preparation (git+file://) leaves a real package directory", { skip: npmSkip }, () => {
  // The github: route goes through pacote's git preparation, which runs an inner install in a temporary
  // clone and (with --global inherited) links that clone into the prefix; the postinstall undoes the link.
  const src = sourceTree(fresh('gitsrc'), archiveText());
  spawnSync(/** @type {string} */ (GIT), ['init', '-q', src]);
  spawnSync(/** @type {string} */ (GIT), ['-C', src, 'add', '-A']);
  spawnSync(/** @type {string} */ (GIT), ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'src']);
  const { d, env } = npmEnv('git');
  let p = npm(d, env, 'install', '-g', '--foreground-scripts', 'git+file://' + src);
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const pkg = path.join(d, 'prefix', 'lib', 'node_modules', 'mhw');
  assert.ok(fs.lstatSync(pkg).isDirectory() && !fs.lstatSync(pkg).isSymbolicLink());
  assert.ok(fs.existsSync(path.join(pkg, 'src', 'commands', 'install.js')));
  assert.equal(brief(d), null);
  assert.equal(mhw(d, env, 'install', '--yes').status, 0);
  assert.ok(brief(d)?.includes('; ' + expectedStamp() + ';'));
  p = mhw(d, env, 'status', '--project=' + path.join(d, 'proj'));
  assert.equal(p.status, 0, p.stderr);
  assert.ok(!p.stdout.includes(NOT_RUN));
});

test('the upgrade from the package before the rename (v4.1.0)', { skip: npmSkip }, () => {
  // v4.1.0 shipped as personal-multi-harness-workstation-configuration with the bin workstation.
  const old = fresh('old');
  fs.writeFileSync(path.join(old, 'package.json'), JSON.stringify({ name: LEGACY_PACKAGE, version: '4.1.0', private: true, bin: { workstation: 'bin/workstation.js' }, files: ['bin/'] }));
  fs.mkdirSync(path.join(old, 'bin'));
  writeExe(path.join(old, 'bin', 'workstation.js'), "#!/usr/bin/env node\nconsole.log('old');\n");
  const oldTgz = pack(old);
  let { d, env } = npmEnv('up');
  assert.equal(npm(d, env, 'install', '-g', '--offline', oldTgz).status, 0);
  // Since Issue #206 mhw has no workstation bin, so nothing collides; status names the one to remove.
  let p = npm(d, env, 'install', '-g', '--offline', tarball());
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.ok(fs.existsSync(path.join(d, 'prefix', 'lib', 'node_modules', 'mhw')));
  assert.ok(fs.existsSync(path.join(d, 'prefix', 'lib', 'node_modules', LEGACY_PACKAGE)));
  p = mhw(d, env, 'status', '--project=' + path.join(d, 'proj'));
  assert.ok(p.stdout.includes('  npm              the v4.1.0 package (the name before mhw) is still installed beside mhw; ' + UPGRADE_FIRST + ', then run mhw update'), p.stdout);
  for (const doc of ['README.md', 'docs/runbooks/npm-install.md']) assert.ok(fs.readFileSync(path.join(ROOT, doc), 'utf8').includes(UPGRADE_FIRST), doc);
  ({ d, env } = npmEnv('up2'));
  assert.equal(npm(d, env, 'install', '-g', '--offline', oldTgz).status, 0);
  assert.equal(npm(d, env, 'uninstall', '-g', LEGACY_PACKAGE).status, 0);
  p = npm(d, env, 'install', '-g', '--offline', tarball());
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.equal(mhw(d, env, 'install', '--yes').status, 0);
  assert.ok(brief(d)?.includes('; ' + expectedStamp() + ';'));
  p = mhw(d, env, 'status', '--project=' + path.join(d, 'proj'));
  assert.equal(p.status, 0, p.stderr);
  assert.ok(!p.stdout.includes('still installed beside mhw'));
  assert.ok(!fs.existsSync(path.join(d, 'prefix', 'bin', 'workstation')));
});
