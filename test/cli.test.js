// src/cli.js: the NODE line of `mhw status` (D11) under a stubbed process.version, on the real entry
// (bin/mhw.js), and the ESM entry's module shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { throwawayHome } from './helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUB = pathToFileURL(path.join(ROOT, 'test', 'helpers', 'stub-node-version.js')).href;

/**
 * bin/mhw.js under a stubbed process.version, on the Windows launcher path so no ./mhw runs.
 * @param {string[]} args
 * @param {string} version
 * @param {Record<string, string>} env
 */
function mhw(args, version, env) {
  const h = throwawayHome('cli', { WORKSTATION_LAUNCHER_PLATFORM: 'win32', MHW_TEST_NODE_VERSION: version, ...env });
  try {
    const p = spawnSync(process.execPath, ['--import', STUB, path.join(ROOT, 'bin', 'mhw.js'), ...args], { env: h.env, cwd: h.dir, encoding: 'utf8' });
    return { code: p.status, out: p.stdout.split(/\r?\n/), err: p.stderr };
  } finally {
    h.cleanup();
  }
}

test('mhw status prints a NODE line that fails visibly on an older node, and keeps its exit code', () => {
  const env = {};
  const old = mhw(['status', '--overlay=none'], 'v20.11.1', env);
  assert.equal(old.out[0], 'NODE    FAIL  node v20.11.1 is older than engines.node >=26; install the Node 26 LTS line or later');
  const cur = mhw(['status', '--overlay=none'], 'v26.13.1', env);
  assert.equal(cur.out[0], 'NODE    ok    node v26.13.1 meets engines.node >=26');
  // A report, like the rest of status: the exit code is status's own (here the check of an empty profile, #497).
  assert.equal(old.code, 1);
  assert.equal(cur.code, 1);
  assert.equal(old.err, '');
});

test('the NODE line is printed by status alone', () => {
  for (const args of [['--help'], ['update', 'v4.2.0'], ['install', '--admin']]) {
    const r = mhw(args, 'v20.11.1', {});
    assert.ok(!r.out.some((l) => l.startsWith('NODE ')), args.join(' ') + ': ' + r.out.join('|'));
  }
});

test('status on Windows runs mhw install-windows --check after the NODE and PASTE lines, and its exit code is the check\'s (#497)', () => {
  const r = mhw(['status', '--overlay=none'], 'v20.11.1', {});
  assert.equal(r.code, 1);
  assert.match(r.out[0], /^NODE    FAIL  /);
  assert.match(r.out[1], /^PASTE   n\/a   the paste wrapper is not installed on Windows; whether it works there is not measured \(D7\)$/);
  assert.match(r.out[2], /^MISSING .*CLAUDE\.md$/);
  assert.ok(r.out.some((l) => /^MISSING .*settings\.json$/.test(l)), r.out.join('\n'));
  assert.ok(!r.out.some((l) => l.includes('install.ps1') || l.includes('PowerShell')), r.out.join('\n'));
});

test('the entry points are ES modules with the exports the Python suites import', async () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  const cli = await import(pathToFileURL(path.join(ROOT, 'src', 'cli.js')).href);
  for (const name of ['main', 'updateLines', 'windowsPlan', 'ROOT']) assert.ok(name in cli, name);
  assert.equal(cli.ROOT, ROOT);
  const post = await import(pathToFileURL(path.join(ROOT, 'bin', 'postinstall.js')).href);
  for (const name of ['decide', 'undoPrepareLink', 'globalModules']) assert.ok(name in post, name);
});
