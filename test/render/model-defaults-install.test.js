// install.sh's models_step (#481, S10 of #470): which node runs src/render/model-defaults.js. The function
// is read out of install.sh as it ships and run alone in /bin/sh, with a throwaway HOME, a recording stand-in
// node on PATH and install.sh's own raise(). POSIX only: install.ps1's lookup is held by
// global/install.test.ps1, section 15.
//   - no MHW_NODE and no node on PATH: SKIP, status 2, nothing run;
//   - an absolute MHW_NODE that is not an executable file: REFUSE naming it, status 2, and the node on PATH
//     is NOT run in its place (PR #515 lens A1);
//   - an absolute MHW_NODE that is node: it runs, ahead of the node on PATH;
//   - a relative MHW_NODE: ignored, the node on PATH runs.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** The text of a function of install.sh, from its header to the closing brace at column 0 (or its one line). @param {string} name */
function shellFunction(name) {
  const lines = fs.readFileSync(path.join(ROOT, 'global', 'install.sh'), 'utf8').split('\n');
  const start = lines.findIndex((l) => l.startsWith(name + '() {'));
  assert.ok(start >= 0, 'install.sh defines ' + name);
  if (lines[start].trimEnd().endsWith('}')) return lines[start]; // a one-line function
  const end = lines.indexOf('}', start);
  assert.ok(end > start, name + ' closes');
  return lines.slice(start, end + 1).join('\n');
}

/**
 * Run models_step with the given MHW_NODE and PATH.
 * @param {{ mhwNode?: string, fakeNode: boolean }} o
 */
function step(o) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s10-step-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin');
  const home = path.join(dir, 'home');
  fs.mkdirSync(bin);
  fs.mkdirSync(home);
  const calls = path.join(dir, 'fake-node-ran');
  if (o.fakeNode) {
    fs.writeFileSync(path.join(bin, 'node'), '#!/bin/sh\necho ran > \'' + calls + '\'\necho FAKE-NODE\n');
    fs.chmodSync(path.join(bin, 'node'), 0o755);
  }
  const script = [
    'set -eu',
    'status=0',
    shellFunction('raise'),
    shellFunction('models_step'),
    'mode=check; stamp="release: v0.0.0; commit: x"; overlay=; script_dir=\'' + path.join(ROOT, 'global') + '\'',
    'models_step',
    'echo "STATUS $status"',
  ].join('\n');
  /** @type {Record<string, string>} */
  const env = { PATH: bin + ':/usr/bin:/bin', HOME: home };
  if (o.mhwNode !== undefined) env.MHW_NODE = o.mhwNode;
  const p = spawnSync('/bin/sh', ['-c', script], { env, encoding: 'utf8', cwd: dir });
  return { code: p.status, out: p.stdout + p.stderr, fakeRan: fs.existsSync(calls), dir };
}

const systemNode = ['/usr/bin/node', '/bin/node'].some((p) => fs.existsSync(p));

test('install.sh carries raise and models_step as this test reads them', () => {
  assert.match(shellFunction('raise'), /^raise\(\) \{/);
  assert.match(shellFunction('models_step'), /src\/render\/model-defaults\.js/);
});

test('no node at all: SKIP, status 2', { skip: (!POSIX && 'POSIX sh') || (systemNode && 'a node in /usr/bin or /bin') }, () => {
  const r = step({ fakeNode: false });
  assert.equal(r.code, 0);
  assert.match(r.out, /^SKIP {4}the session-start model defaults: node \(26 or later\) is required$/m);
  assert.match(r.out, /^STATUS 2$/m);
});

test('an absolute MHW_NODE that is not executable is refused, and the node on PATH is not run', { skip: !POSIX && 'POSIX sh' }, () => {
  const r0 = step({ fakeNode: true, mhwNode: '/nonexistent/node' });
  assert.match(r0.out, /^REFUSE {2}the session-start model defaults: MHW_NODE \(\/nonexistent\/node\) is not an executable file; nothing written$/m);
  assert.match(r0.out, /^STATUS 2$/m);
  assert.equal(r0.fakeRan, false);
  const plain = path.join(r0.dir, 'plain-node');
  fs.writeFileSync(plain, '#!/bin/sh\necho PLAIN\n');
  fs.chmodSync(plain, 0o644);
  const r1 = step({ fakeNode: true, mhwNode: plain });
  assert.match(r1.out, /is not an executable file; nothing written$/m);
  assert.doesNotMatch(r1.out, /FAKE-NODE|PLAIN/);
  assert.equal(r1.fakeRan, false);
  const r2 = step({ fakeNode: true, mhwNode: r0.dir });
  assert.match(r2.out, /is not an executable file; nothing written$/m, 'a directory is not a node');
  assert.equal(r2.fakeRan, false);
});

test('an absolute MHW_NODE that is node runs the step, ahead of the node on PATH', { skip: !POSIX && 'POSIX sh' }, () => {
  const r = step({ fakeNode: true, mhwNode: process.execPath });
  assert.equal(r.fakeRan, false);
  assert.doesNotMatch(r.out, /FAKE-NODE|REFUSE|SKIP/);
  assert.match(r.out, /^STATUS 0$/m);
});

test('a relative MHW_NODE is ignored: the node on PATH runs', { skip: !POSIX && 'POSIX sh' }, () => {
  const r = step({ fakeNode: true, mhwNode: 'node' });
  assert.equal(r.fakeRan, true);
  assert.match(r.out, /FAKE-NODE/);
  assert.match(r.out, /^STATUS 0$/m);
});
