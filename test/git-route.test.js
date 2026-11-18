// The git install route (ADR-0034: `npm install -g github:tedeuxx/mhw#<ref>` is a git dependency to
// npm), exercised with git+file:// of a commit made from this working tree, into a throwaway prefix,
// cache and HOME. It fails when `npm ls -g --all` reports a problem (an UNMET DEPENDENCY among them),
// when the installed package cannot load its TOML module, or when a devDependency is installed.
// It runs by default. The install is --offline with an empty cache, so the route is shown to need
// nothing from the registry; it took about 2.2 to 2.8 seconds (measured with npm 11.13.0, git+file://
// only: the github: route itself was not measured).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { copyWorkingTree } from './helpers/parity.js';
import { which } from './helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const POSIX = process.platform !== 'win32';
const NPM = path.join(path.dirname(process.execPath), 'npm');
const GIT = which('git');

test('a git install resolves every runtime dependency and installs no devDependency', {
  skip: !POSIX ? 'POSIX (npm by absolute path beside node)' : !GIT ? 'needs git' : false,
  timeout: 600000,
}, () => {
  const t = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-git-route-')));
  try {
    const src = path.join(t, 'src');
    copyWorkingTree(ROOT, src);
    const git = /** @type {string} */ (GIT);
    for (const args of [['init', '-q', src], ['-C', src, 'add', '-A'],
      ['-C', src, '-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'src']]) {
      assert.equal(spawnSync(git, args).status, 0, 'git ' + args.join(' '));
    }
    const home = path.join(t, 'home');
    fs.mkdirSync(home);
    const env = {
      PATH: [path.dirname(process.execPath), path.dirname(git), '/usr/bin', '/bin'].join(path.delimiter),
      HOME: home, TMPDIR: t, npm_config_cache: path.join(t, 'cache'), npm_config_prefix: path.join(t, 'prefix'),
      npm_config_userconfig: path.join(t, 'npmrc'), npm_config_update_notifier: 'false', npm_config_fund: 'false',
      npm_config_audit: 'false', MHW_POSTINSTALL_TTY: '0',
    };
    // --offline with an empty cache: the route must need nothing from the registry.
    const install = spawnSync(NPM, ['install', '-g', '--offline', 'git+file://' + src], { env, cwd: t, encoding: 'utf8' });
    assert.equal(install.status, 0, install.stdout + install.stderr);
    const ls = spawnSync(NPM, ['ls', '-g', '--all'], { env, cwd: t, encoding: 'utf8' });
    assert.doesNotMatch(ls.stdout, /UNMET|missing|invalid|extraneous/, ls.stdout);
    assert.equal(ls.status, 0, 'npm ls -g --all reports a problem:\n' + ls.stdout + ls.stderr);
    const pkg = path.join(t, 'prefix', 'lib', 'node_modules', 'mhw');
    assert.ok(fs.statSync(pkg).isDirectory() && !fs.lstatSync(pkg).isSymbolicLink());
    const load = spawnSync(process.execPath, ['--input-type=module', '-e',
      'const m = await import(' + JSON.stringify(pathToFileURL(path.join(pkg, 'src', 'lib', 'toml.js')).href) + ');' +
      'process.stdout.write(JSON.stringify(m.parseToml("a = 1\\n")));'], { env, encoding: 'utf8' });
    assert.equal(load.status, 0, 'the installed package cannot load its TOML module:\n' + load.stderr);
    assert.equal(load.stdout, '{"a":1}');
    const dev = Object.keys(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).devDependencies || {});
    for (const name of dev) assert.ok(!fs.existsSync(path.join(pkg, 'node_modules', name)), name + ' (a devDependency) was installed');
  } finally {
    fs.rmSync(t, { recursive: true, force: true });
  }
});
