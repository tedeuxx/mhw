// src/lib/confine.js (#475, S04 of #470) on the confinement cases of the deleted milestone.test.py
// (test_description_file_is_confined_to_the_work_tree_or_temp and
// test_confinement_is_by_path_component_and_follows_symlinks), plus the cases a component-wise realpath
// exists for. Where python3 is on PATH, each case also runs method/scripts/confine.py itself (still
// shipped for worklog.py and launch-line.py, until S05) and the two must give the same answer.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { confined, ConfineError, realpathLoose, under } from '../../src/lib/confine.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
// The comparison with confine.py runs on POSIX: Windows Python's realpath was not measured against this one.
const PY = POSIX ? which('python3') : null;
const GIT = which('git');
const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-confine-')));
after(() => fs.rmSync(base, { recursive: true, force: true }));
const underTmp = POSIX && (base + '/').startsWith(fs.realpathSync('/tmp') + '/');

/** @type {Record<string, string>} */
const ENV = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) ENV[k] = v;

/**
 * The Node answer and, where python3 runs, confine.py's answer: { real } or { refused }.
 * @param {string} p
 * @param {string} cwd
 * @param {Record<string, string>} env
 */
function both(p, cwd, env) {
  /** @type {{ real?: string, refused?: string }} */
  let node;
  try {
    node = { real: confined(p, { cwd, env }) };
  } catch (e) {
    assert.ok(e instanceof ConfineError, String(e));
    node = { refused: e.message };
  }
  /** @type {{ real?: string, refused?: string } | null} */
  let py = null;
  if (PY) {
    const r = spawnSync(PY, ['-B', path.join(ROOT, 'test', 'helpers', 'confine-driver.py'), path.join(ROOT, 'method', 'scripts'), p], { cwd, env, encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    py = JSON.parse(r.stdout);
  }
  return { node, py };
}

/** @param {string} p @param {string} cwd @param {Record<string, string>} env @param {boolean} accepted */
function check(p, cwd, env, accepted) {
  const { node, py } = both(p, cwd, env);
  if (accepted) assert.ok(node.real, p + ' refused: ' + node.refused);
  else assert.match(node.refused || '', /is outside the repository work tree and the temporary directory; refusing to read it$/, p);
  if (py) assert.deepEqual(node, py, 'Node and confine.py disagree on ' + p);
}

test('a file in the temporary directory or the work tree is accepted; /etc, ~ and a .. walk are refused', { skip: !GIT && 'needs git' }, () => {
  const tmpd = path.join(base, 'a-tmp');
  const tree = path.join(base, 'a-tree');
  fs.mkdirSync(tmpd);
  fs.mkdirSync(path.join(tree, 'doc'), { recursive: true });
  assert.equal(spawnSync(/** @type {string} */ (GIT), ['init', '-q', tree]).status, 0);
  fs.writeFileSync(path.join(tmpd, 'description.txt'), 'ok\n');
  fs.writeFileSync(path.join(tree, 'doc', 'description.txt'), 'ok\n');
  const env = { ...ENV, TMPDIR: tmpd };
  const inTree = path.join(tree, 'doc', 'description.txt');
  check(path.join(tmpd, 'description.txt'), tmpd, env, true);
  check(inTree, tree, env, true);
  check('doc/description.txt', tree, env, true); // relative to the working directory
  if (!underTmp) check(inTree, path.parse(base).root, env, false); // the same file, from outside its tree and temp
  check('/etc/hosts', tree, env, false);
  check('~/.ssh/config', tree, env, false);
  check(path.join(tmpd, 'missing.txt'), tmpd, env, true); // confinement reads nothing; a missing file is the reader's error
  if (!underTmp) check(base + '/' + '../'.repeat(12) + 'etc/hosts', base, env, false);
});

test('confinement is by path component and follows symbolic links, component by component', { skip: (!POSIX && 'needs POSIX symbolic links') || (underTmp && 'the test directory is under /tmp, an allowed root') }, () => {
  const root = path.join(base, 'tmpx');
  const sibling = path.join(base, 'tmpxX');
  fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
  fs.mkdirSync(sibling);
  fs.writeFileSync(path.join(root, 'ok.txt'), 'ok\n');
  fs.writeFileSync(path.join(sibling, 'evil.txt'), 'evil\n');
  fs.symlinkSync('/etc/hosts', path.join(root, 'out.txt'));
  // A link to a directory outside, then "..": the kernel reads from the link's target's parent, so a
  // lexical normalisation (which drops "link/..") would accept a path that reads outside the root.
  fs.symlinkSync(path.join(sibling), path.join(root, 'away'));
  fs.symlinkSync('sub', path.join(root, 'here'));
  const env = { ...ENV, TMPDIR: root };
  check(path.join(root, 'ok.txt'), root, env, true);
  check(path.join(sibling, 'evil.txt'), root, env, false);
  check(path.join(root, 'out.txt'), root, env, false);
  check(path.join(root, 'away') + '/../tmpxX/evil.txt', root, env, false);
  check(path.join(root, 'here') + '/../ok.txt', root, env, true);
  assert.equal(realpathLoose(path.join(root, 'away') + '/../x', { cwd: root, env }), path.join(base, 'x'));
});

test('under: strict, by whole components, case-insensitive on Windows only', () => {
  const posix = { cwd: '/', env: {}, platform: 'linux' };
  assert.equal(under('/a/tmp', '/a/tmp/x', posix), true);
  assert.equal(under('/a/tmp', '/a/tmp', posix), false);
  assert.equal(under('/a/tmp', '/a/tmpX/x', posix), false);
  assert.equal(under('/a/tmp', '/a/TMP/x', posix), false);
  assert.equal(under('/a/tmp', '/a/..x', posix), false);
  const win = { cwd: 'C:\\', env: {}, platform: 'win32' };
  assert.equal(under('C:\\Temp', 'c:\\temp\\x', win), true);
  assert.equal(under('C:\\Temp', 'D:\\Temp\\x', win), false);
});
