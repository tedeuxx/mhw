// src/vendor/ carries third-party code shipped inside the package (#472): a git install of mhw left npm
// runtime dependencies unmet, so mhw has none. Each vendored package must be byte-identical to the same
// version installed as a devDependency, which npm ci fetched against the integrity in
// npm-shrinkwrap.json and npm audit covers. So the vendored copy is exactly the audited, pinned one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

test('mhw has no npm runtime dependency; every vendored package is a pinned devDependency', () => {
  assert.equal(pkg.dependencies, undefined);
  assert.deepEqual(vendored, ['smol-toml']);
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
    const mine = files(path.join(VENDOR, name)).filter((rel) => rel !== 'package.json');
    assert.ok(mine.includes('dist/index.js'), name);
    for (const rel of mine) {
      assert.ok(fs.readFileSync(path.join(VENDOR, name, rel)).equals(fs.readFileSync(path.join(installed, rel))), name + '/' + rel + ' differs from the installed package');
    }
  }
});
