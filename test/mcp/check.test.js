// mhw mcp check (#595): the MCP connection test, `mhw status --mcp-connect[=SECONDS]` until v11, moved
// to its own command with the same lines and exit contract: 0 when every set member answers, 1 when one
// fails, 2 on a usage error. The check itself (src/commands/mcp-connect.js) is held by connect.test.js; this
// file holds the command around it. Throwaway HOMEs; every server is the synthetic stub
// test/helpers/mcp-connect-stub.js; no value printed.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { throwawayHome } from '../helpers/home.js';
import { mcpHomes } from '../helpers/mcp-home.js';
import * as K from '../../src/commands/mcp-check.js';
import { MCP_INDENT } from '../../src/commands/status.js';
import { USAGE } from '../../src/commands/usage.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER = path.join(ROOT, 'src', 'render', 'mcp.js');
const MHW = path.join(ROOT, 'bin', 'mhw.js');
const STUB = path.join(ROOT, 'test', 'helpers', 'mcp-connect-stub.js');
const NODE = process.execPath;
const POSIX_ONLY = process.platform === 'win32' && 'the connection check is not available on Windows';
const box = throwawayHome('mcp-check');
after(() => box.cleanup());
const { mkHome, writeSource, cleanEnv } = mcpHomes(box.dir, RENDER);
/** @param {string[]} args @param {Record<string, string>} env */
const mhw = (args, env) => spawnSync(NODE, [MHW, ...args], { env, cwd: box.dir, encoding: 'utf8', timeout: 120000 });
// Codex, Claude Code and Kiro, and the Claude desktop app where it is published (macOS here).
const SURFACES = process.platform === 'darwin' ? 4 : 3;

test('the connection lines show a name and a result only, under one heading', () => {
  const t = ' (MCP connect)';
  assert.deepEqual(K.mcpConnectLines(['OK      codex: s-a: ok' + t, 'FAIL    kiro: s-b: fail: timeout' + t, 'an untagged line'], 1),
    ['  mcp connect      codex: s-a: ok', MCP_INDENT + 'kiro: s-b: fail: timeout']);
  assert.ok(K.mcpConnectLines([], 2)[0].startsWith('  mcp connect      no result (exit 2)'));
});

test('a bad argument is a usage error (exit 2) that starts nothing', () => {
  for (const bad of ['--timeout=0', '--timeout=x', '--timeout=99999', '--timeout=', '--mcp-connect=2', '--bogus', 'check']) {
    /** @type {string[]} */
    const err = [];
    /** @type {string[]} */
    const out = [];
    assert.equal(K.main([bad], {}, { err: (l) => err.push(l), out: (l) => out.push(l) }), 2, bad);
    assert.deepEqual(err, ['mhw: unknown argument for mcp check: ' + bad, K.USAGE], bad);
    assert.deepEqual(out, [], bad);
  }
});

test('mhw mcp check: all set members ok exits 0; a failing member exits 1; --timeout bounds a hung one', { skip: POSIX_ONLY }, () => {
  const h = mkHome('home-check');
  const ok = { command: NODE, args: [STUB, 'ok', path.join(h, 'pid-ok')] };
  writeSource(h, { version: 1, active_set: {}, servers: { 's-ok': ok } });
  assert.equal(spawnSync(NODE, [RENDER], { env: cleanEnv(h), cwd: box.dir }).status, 0);
  let p = mhw(['mcp', 'check'], cleanEnv(h));
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const lines = p.stdout.trimEnd().split('\n');
  assert.equal(lines.length, SURFACES, p.stdout);
  assert.match(lines[0], /^ {2}mcp connect {6}[a-z-]+: s-ok: ok$/);
  for (const l of lines.slice(1)) assert.match(l, new RegExp('^' + MCP_INDENT + '[a-z-]+: s-ok: ok$'));
  assert.equal(p.stderr, '');

  writeSource(h, { version: 1, active_set: {}, servers: { 's-ok': ok, 's-exit': { command: NODE, args: [STUB, 'exit', path.join(h, 'pid-exit')] } } });
  assert.equal(spawnSync(NODE, [RENDER], { env: cleanEnv(h), cwd: box.dir }).status, 0);
  p = mhw(['mcp', 'check', '--timeout=5'], cleanEnv(h));
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.ok(p.stdout.includes('s-exit: fail: exited 3'), p.stdout);
  assert.ok(p.stdout.includes('s-ok: ok'), p.stdout);

  writeSource(h, { version: 1, active_set: {}, servers: { 's-hang': { command: NODE, args: [STUB, 'hang', path.join(h, 'pid-hang')] } } });
  assert.equal(spawnSync(NODE, [RENDER], { env: cleanEnv(h), cwd: box.dir }).status, 0);
  const t0 = Date.now();
  p = mhw(['mcp', 'check', '--timeout=1'], cleanEnv(h));
  assert.equal(p.status, 1, p.stdout + p.stderr);
  assert.ok(p.stdout.includes('s-hang: fail: timeout'), p.stdout);
  assert.ok(Date.now() - t0 < 30000, 'the 1-second timeout held');
});

test('mhw mcp check with no active set declared checks nothing and exits 0', { skip: POSIX_ONLY }, () => {
  const h = mkHome('home-check-none');
  writeSource(h, { version: 1, servers: { 's-ok': { command: '/bin/echo' } } });
  const p = mhw(['mcp', 'check'], cleanEnv(h));
  assert.equal(p.status, 0, p.stdout + p.stderr);
  assert.equal(p.stdout, '  mcp connect      MCP connect: no active set is declared, so there is nothing to check\n');
});

test('the help tells mcp check (connection) from mcp render --check (drift)', () => {
  const h = mkHome('home-check-help');
  const p = mhw(['mcp'], cleanEnv(h));
  assert.equal(p.status, 2);
  assert.match(p.stderr, /mhw mcp check \[--timeout=SECONDS\] +connection test/);
  assert.match(p.stderr, /mhw mcp render --check +drift check/);
  assert.match(USAGE, /\.\/mhw mcp check \[--timeout=SECONDS\] connection test/);
  assert.match(USAGE, /\.\/mhw mcp render --check +drift check/);
  assert.ok(!USAGE.includes('--mcp-connect['), 'the help no longer offers status --mcp-connect');
  const help = mhw(['--help'], cleanEnv(h));
  assert.equal(help.status, 0);
  if (process.platform === 'win32') {
    // The Windows usage names only what works there. The connection check is not available on Windows
    // (mcp-connect.js prints its SKIP line and exits 0), so the Windows help does not offer it, nor the
    // removed status --mcp-connect.
    assert.ok(!help.stdout.includes('mcp check') && !help.stdout.includes('--mcp-connect'), help.stdout);
  } else {
    assert.ok(help.stdout.includes('./mhw mcp check [--timeout=SECONDS] connection test'), help.stdout);
  }
});
