// runAbsolute (process run by absolute path) and the version helpers behind the NODE line (D11).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runAbsolute } from '../../src/lib/run.js';
import { parseVersion, floorOf, nodeLine, enginesNode, releaseOf } from '../../src/lib/version.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

test('runAbsolute refuses a bare or relative program before running anything', () => {
  for (const exe of ['node', './node', 'bin/node', '']) {
    const r = runAbsolute(exe, ['-e', 'process.exit(0)']);
    assert.equal(r.code, 2, exe);
    assert.match(String(r.error), /not an absolute path/);
  }
});

test('runAbsolute returns the exit code, the output, and 2 with an error when the program is missing', () => {
  const ok = runAbsolute(process.execPath, ['-e', 'process.stdout.write("out"); process.stderr.write("err"); process.exit(7)']);
  assert.deepEqual([ok.code, ok.stdout, ok.stderr], [7, 'out', 'err']);
  const arg = runAbsolute(process.execPath, ['-e', 'process.stdout.write(process.argv[1])', 'a; rm -rf x $(y)']);
  assert.equal(arg.stdout, 'a; rm -rf x $(y)', 'arguments are passed as they are, never through a shell');
  const missing = runAbsolute(path.join(ROOT, 'no-such-program'), []);
  assert.equal(missing.code, 2);
  assert.ok(missing.error);
});

test('parseVersion and floorOf read only the forms they know', () => {
  assert.deepEqual(parseVersion('v26.13.1'), [26, 13, 1]);
  assert.deepEqual(parseVersion('26'), [26, 0, 0]);
  assert.equal(parseVersion('v26.13.1-pre'), null);
  assert.deepEqual(floorOf('>=26'), [26, 0, 0]);
  assert.deepEqual(floorOf('>= 26.13.0'), [26, 13, 0]);
  for (const r of ['^26', '26.x', '>=26 <28', '', undefined]) assert.equal(floorOf(r), null, String(r));
});

test('nodeLine: ok at and above the floor, FAIL below it or when unreadable', () => {
  assert.deepEqual(nodeLine('v26.0.0', '>=26'), { ok: true, line: 'NODE    ok    node v26.0.0 meets engines.node >=26' });
  assert.equal(nodeLine('v27.1.0', '>=26').ok, true);
  const old = nodeLine('v25.9.0', '>=26');
  assert.equal(old.ok, false);
  assert.equal(old.line, 'NODE    FAIL  node v25.9.0 is older than engines.node >=26; install the Node 26 LTS line or later');
  assert.equal(nodeLine('v18.20.0', '>=26').ok, false);
  assert.equal(nodeLine('v26.13.1', '^26').ok, false, 'a range this code cannot read is never reported as met');
  assert.match(nodeLine('v26.13.1', '^26').line, /^NODE    FAIL  cannot compare/);
});

test('the package declares the Active LTS floor, and the release reads from .bumpversion.toml', () => {
  // D11 of #470, measured for #472 from https://nodejs.org/dist/index.json and nodejs/Release
  // schedule.json on 2026-11-17: 26 (Lithium) has been Active LTS since 2026-10-28.
  assert.equal(enginesNode(ROOT), '>=26');
  const r = releaseOf(ROOT);
  assert.ok(r && r.every((x) => /^\d+$/.test(x)));
});
