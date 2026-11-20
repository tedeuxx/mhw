// src/vendor/ carries third-party code shipped inside the package (#472): a git install of mhw left npm
// runtime dependencies unmet, so mhw has none. Each vendored package must be byte-identical to the same
// version installed as a devDependency, which npm ci fetched against the integrity in
// npm-shrinkwrap.json and npm audit covers. So the vendored copy is exactly the audited, pinned one.
// node-pty (#487) is vendored in part: the five lib/ files the POSIX path loads and the macOS prebuilds,
// byte-identical to the npm package (its spawn-helper is committed executable, which the npm tarball does
// not carry); and Linux pty.node files the npm package does not ship, built by this repository's CI from
// the same pinned source and held to the sha256 recorded with that run (linux-prebuilds.json).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VENDOR = path.join(ROOT, 'src', 'vendor');

/** @param {string} dir @returns {string[]} files under dir, relative, sorted */
function files(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)).split(path.sep).join('/'))
    .sort();
}

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'npm-shrinkwrap.json'), 'utf8'));
const vendored = fs.readdirSync(VENDOR).sort();
// The Linux node-pty prebuilds are not in the npm package: the CI job node-pty-linux built them from the
// pinned source (ADR-0042). Their record names the run and each file's sha256; they are held to that.
const CI_BUILT_RECORD = 'linux-prebuilds.json';
const ciBuilt = JSON.parse(fs.readFileSync(path.join(VENDOR, 'node-pty', CI_BUILT_RECORD), 'utf8'));
/** Files under a vendored package that the npm package does not carry. @param {string} name @param {string} rel */
const notFromNpm = (name, rel) => name === 'node-pty' && (rel === CI_BUILT_RECORD || Object.hasOwn(ciBuilt.sha256, rel));
/** The file each vendored package is loaded through. @type {Record<string, string>} */
const ENTRY = { 'node-pty': 'lib/index.js', 'smol-toml': 'dist/index.js' };

test('mhw has no npm runtime dependency; every vendored package is a pinned devDependency', () => {
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(vendored, ['node-pty', 'smol-toml']);
  for (const name of vendored) {
    const v = JSON.parse(fs.readFileSync(path.join(VENDOR, name, 'package.json'), 'utf8')).version;
    assert.equal(pkg.devDependencies[name], v, name + ': devDependency pins the vendored version');
    const entry = lock.packages['node_modules/' + name];
    assert.ok(entry && entry.version === v && entry.dev === true && /^sha512-/.test(entry.integrity), name + ': in the shrinkwrap with its integrity');
    assert.ok(fs.existsSync(path.join(VENDOR, name, 'LICENSE')), name + ': its license is shipped beside it');
  }
});

test('each vendored file is byte-identical to the installed devDependency', (t) => {
  for (const name of vendored) {
    const installed = path.join(ROOT, 'node_modules', name);
    if (!fs.existsSync(installed)) {
      t.skip('node_modules/' + name + ' is not installed (run npm ci)');
      return;
    }
    // package.json is mhw's own reduced manifest (no upstream author fields); everything else is copied.
    const mine = files(path.join(VENDOR, name)).filter((rel) => rel !== 'package.json' && !notFromNpm(name, rel));
    assert.ok(mine.includes(ENTRY[name]), name);
    for (const rel of mine) {
      assert.ok(fs.readFileSync(path.join(VENDOR, name, rel)).equals(fs.readFileSync(path.join(installed, rel))), name + '/' + rel + ' differs from the installed package');
    }
  }
});

test('the Linux pty.node files are the CI build of the pinned source, at their recorded sha256', () => {
  const linux = files(path.join(VENDOR, 'node-pty')).filter((rel) => rel.startsWith('prebuilds/linux-'));
  assert.deepEqual(Object.keys(ciBuilt.sha256).sort(), linux, 'every Linux file has a recorded sha256, and no record names a missing file');
  for (const [rel, sha] of Object.entries(ciBuilt.sha256)) {
    const got = crypto.createHash('sha256').update(fs.readFileSync(path.join(VENDOR, 'node-pty', rel))).digest('hex');
    assert.equal(got, sha, rel + ' is not the file the recorded CI run built');
  }
  // The build's provenance: the job in this repository, a run of it, and the pinned sources it checked.
  assert.equal(ciBuilt.workflow, '.github/workflows/node-pty-linux.yml');
  assert.ok(fs.existsSync(path.join(ROOT, ciBuilt.workflow)), 'the workflow that built them exists');
  assert.match(ciBuilt.run, /^https:\/\/github\.com\/tedeuxx\/mhw\/actions\/runs\/\d+$/);
  assert.match(ciBuilt.commit, /^[0-9a-f]{40}$/);
  assert.equal(ciBuilt.source['node-pty'].version, pkg.devDependencies['node-pty']);
  assert.equal(ciBuilt.source['node-pty'].integrity, lock.packages['node_modules/node-pty'].integrity);
  assert.equal(ciBuilt.source['node-addon-api'].integrity, lock.packages['node_modules/node-addon-api'].integrity);
  assert.equal(lock.packages['node_modules/node-addon-api'].version, ciBuilt.source['node-addon-api'].version);
  // The npm package itself carries no Linux binary, so nothing here could have come from it.
  const installed = path.join(ROOT, 'node_modules', 'node-pty', 'prebuilds');
  if (fs.existsSync(installed)) assert.deepEqual(fs.readdirSync(installed).filter((d) => d.startsWith('linux-')), []);
});

test('node-pty is vendored with the macOS prebuilds and the CI-built Linux ones, and its loader is the one file that reaches it', () => {
  const mine = files(path.join(VENDOR, 'node-pty'));
  assert.deepEqual(mine, ['LICENSE', 'lib/eventEmitter2.js', 'lib/index.js', 'lib/terminal.js', 'lib/unixTerminal.js', 'lib/utils.js',
    'linux-prebuilds.json', 'package.json', 'prebuilds/darwin-arm64/pty.node', 'prebuilds/darwin-arm64/spawn-helper',
    'prebuilds/darwin-x64/pty.node', 'prebuilds/darwin-x64/spawn-helper', 'prebuilds/linux-arm64/pty.node', 'prebuilds/linux-x64/pty.node']);
  const manifest = JSON.parse(fs.readFileSync(path.join(VENDOR, 'node-pty', 'package.json'), 'utf8'));
  assert.equal(manifest.type, 'commonjs', 'the lib/ files are CommonJS inside a "type": "module" package');
  assert.equal(lock.packages['node_modules/node-pty'].hasInstallScript, true, 'npm ci --ignore-scripts must stay the CI install');
  const users = files(path.join(ROOT, 'src')).filter((f) => f.endsWith('.js') && !f.startsWith('vendor/'))
    .filter((f) => fs.readFileSync(path.join(ROOT, 'src', f), 'utf8').includes("'vendor', 'node-pty'"));
  assert.deepEqual(users, ['lib/pty.js']);
});
