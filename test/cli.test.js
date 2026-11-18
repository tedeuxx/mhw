// src/cli.js: the NODE line of `mhw status` (D11) under a stubbed process.version, on the real entry
// (bin/mhw.js), and the ESM entry's module shape.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { throwawayHome } from './helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STUB = pathToFileURL(path.join(ROOT, 'test', 'helpers', 'stub-node-version.js')).href;
const POSIX = process.platform !== 'win32';

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
  const env = { WORKSTATION_POWERSHELL: 'pwsh.exe' };
  const old = mhw(['status'], 'v20.11.1', env);
  assert.equal(old.out[0], 'NODE    FAIL  node v20.11.1 is older than engines.node >=26; install the Node 26 LTS line or later');
  const cur = mhw(['status'], 'v26.13.1', env);
  assert.equal(cur.out[0], 'NODE    ok    node v26.13.1 meets engines.node >=26');
  // A report, like the rest of status: the exit code is status's own (here the PowerShell refusal).
  assert.equal(old.code, 2);
  assert.equal(cur.code, 2);
  assert.match(old.err, /PowerShell was not found/);
});

test('the NODE line is printed by status alone', () => {
  for (const args of [['--help'], ['update', 'v4.2.0'], ['install', '--admin']]) {
    const r = mhw(args, 'v20.11.1', {});
    assert.ok(!r.out.some((l) => l.startsWith('NODE ')), args.join(' ') + ': ' + r.out.join('|'));
  }
});

test('status forwards to install.ps1 after the NODE line, and its exit code is the forwarded one', { skip: !POSIX && 'the stub PowerShell is a POSIX script' }, () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-cli-stub-'));
  try {
    const stub = path.join(dir, 'ps');
    fs.writeFileSync(stub, '#!/bin/sh\nfor a in "$@"; do printf \'%s\\n\' "$a"; done\nexit 0\n');
    fs.chmodSync(stub, 0o755);
    const r = mhw(['status'], 'v20.11.1', { WORKSTATION_POWERSHELL: stub });
    assert.equal(r.code, 0);
    assert.match(r.out[0], /^NODE    FAIL  /);
    assert.deepEqual(r.out.slice(1, -1), ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(ROOT, 'global', 'install.ps1'), '-Check']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
