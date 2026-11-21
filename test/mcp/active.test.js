// src/commands/mcp-active.js (#485, S14 of #470): the cases the deleted mcp_render_test.py and S13's
// test/render/mcp.test.js held for global/mcp/mcp_active.py, now on the Node form, per agent harness, on
// throwaway HOMEs: switch on, switch off, check. Every server, command and value is SYNTHETIC. No test runs
// the real `security` binary, reads a real Keychain or a real HOME. The parity transcripts are
// test/mcp/active-golden.test.js; this file holds the behaviour rows and the unit rows behind them.
import { test, after, describe as group } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { throwawayHome, which } from '../helpers/home.js';
import { mcpHomes } from '../helpers/mcp-home.js';
import * as M from '../../src/render/mcp.js';
import * as A from '../../src/commands/mcp-active.js';
import { loads } from '../../src/lib/py.js';
import { PROJECT, put, putJson, activeHome, policyCopy } from '../render/mcp-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER = path.join(ROOT, 'src', 'render', 'mcp.js');
const POSIX = process.platform !== 'win32';
const DARWIN = process.platform === 'darwin';
const GIT = which('git');
const STAMP = 'release: v0.0.0-test; commit: synthetic';
const box = throwawayHome('mcp-active');
after(() => box.cleanup());
const BASE = box.dir;
const POSIX_ONLY = !POSIX && 'the active set is not applied on Windows';

const { mkHome, data, targets, writeSource, cleanEnv, run, manifest } = mcpHomes(BASE, RENDER);
/** @param {string} h @param {string} m @param {string[]} [more] @param {Record<string, string>} [env] */
const active = (h, m, more = [], env = undefined) => run(h, ['--active', '--mode=' + m, '--stamp=' + STAMP, ...more], env);
/** @param {string} h @param {string} m */
const policy = (h, m) => run(h, ['--policy', '--mode=' + m, '--stamp=' + STAMP]);
/** @param {string} p */
const read = (p) => fs.readFileSync(p, 'utf8');
/** @param {string} p */
const jload = (p) => JSON.parse(read(p));
/** @param {string} p */
const tload = (p) => /** @type {any} */ (M.tomlLoads(read(p)));
/** @param {string} p */
const mode = (p) => fs.statSync(p).mode & 0o777;
/** @param {string} h */
function fingerprint(h) {
  /** @type {Record<string, string>} */
  const out = {};
  /** @param {string} d */
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.lstatSync(p).isDirectory()) walk(p);
      else out[p] = fs.readFileSync(p).toString('base64');
    }
  };
  walk(h);
  return out;
}
/** An ordered dict, as the renderer reads JSON. @param {Array<[string, any]>} pairs @returns {Map<string, any>} */
const map = (pairs) => new Map(pairs);
/** A Map tree as plain JSON. @param {unknown} v */
const plain = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x)));
const policyEntry = () => M.entry('claude-code', M.get(M.loadPolicy(), 'servers').get('chrome-devtools'), null);
/** A Ctx on a throwaway HOME whose output is collected. @param {string} h @param {Partial<M.Ctx>} [over] */
function ctxOf(h, over = {}) {
  const out = { stdout: '', stderr: '' };
  /** @type {M.Ctx} */
  const ctx = { env: cleanEnv(h), platform: process.platform, cwd: BASE, out: (s) => { out.stdout += s; }, err: (s) => { out.stderr += s; }, ...over };
  return { ctx, out };
}

// ------------------------------------------------------------------------------- per agent harness

group('the active set, through the CLI', { skip: POSIX_ONLY }, () => {
  /** @param {string} name */
  const home = (name) => {
    const h = mkHome(name);
    activeHome({ home: h, data: data(h), base: BASE });
    if (DARWIN) putJson(targets(h)['claude-desktop'], { mcpServers: { 'set-a': { command: '/bin/echo' }, 'desk-out': { command: '/bin/echo' } } });
    return { h, settings: path.join(h, '.claude', 'settings.json') };
  };

  test('validation: parity and connectors', () => {
    const base = { version: 1, servers: { a: { command: 'x' } } };
    assert.deepEqual(M.validate({ ...base, active_set: {} }, 'darwin'), []);
    assert.deepEqual(M.validate({ ...base, active_set: { connectors: { Synth: 'on', Other: 'off' } } }, 'darwin'), []);
    const narrow = { version: 1, servers: { a: { command: 'x', surfaces: ['codex', 'claude-code'] } } };
    assert.deepEqual(M.validate(narrow, 'darwin'), []);
    assert.ok(M.validate({ ...narrow, active_set: {} }, 'darwin').some((e) => e.includes('parity')));
    for (const bad of [[], { connectors: [] }, { connectors: { Synth: 'maybe' } }, { connectors: { ' Synth': 'on' } }, { connectors: { '': 'on' } }, { unknown: 1 }, { description: 3 }]) {
      assert.notDeepEqual(M.validate({ ...base, active_set: bad }, 'darwin'), [], JSON.stringify(bad));
    }
    const doc = { version: 1, active_set: {}, servers: { 'chrome-devtools': policyCopy({ surfaces: ['codex', 'kiro', 'claude-desktop'] }) } };
    assert.ok(M.validate(doc, 'darwin').some((e) => e.includes('parity')));
    assert.deepEqual(M.validate(doc, 'darwin', M.policySurfaces(M.loadPolicy())), []);
  });

  test('undeclared turns nothing off; no definition turns nothing off', () => {
    const { h } = home('home-active-undeclared');
    writeSource(h, { version: 1, servers: { 'set-a': { command: '/bin/echo' } } });
    const before = fingerprint(h);
    for (const m of ['check', 'install']) {
      const p = active(h, m);
      assert.equal(p.code, 0, p.all);
      assert.match(p.stdout, /SKIP {4}MCP active set: not declared/);
    }
    assert.deepEqual(fingerprint(h), before);
    fs.rmSync(path.join(data(h), 'local-overlay', 'mcp-servers.json'));
    const p = active(h, 'install');
    assert.equal(p.code, 0);
    assert.match(p.stdout, /no local MCP definition/);
  });

  test('switch off, check, switch on: install turns off, check is clean, uninstall restores byte for byte', () => {
    const { h, settings } = home('home-active');
    const t = targets(h);
    const seed = Object.fromEntries(Object.entries(t).map(([k, v]) => [k, read(v)]));
    const seedSettings = read(settings);
    let p = active(h, 'check');
    assert.equal(p.code, 1, p.all);
    assert.ok(p.stdout.includes('DRIFT   codex: on outside the set: out-b, out-c (2)'));
    assert.ok(p.stdout.includes('DRIFT   kiro: on outside the set: out-k, out-k2 (2)'));
    assert.ok(p.stdout.includes('DRIFT   claude-code: on outside the set: out-u, plugin:plug2:local, plugin:plug1:web, claude.ai Synth Off (4)'));
    if (DARWIN) assert.ok(p.stdout.includes('desk-out (1)'));
    for (const kept of ['node_repl', 'claude-in-chrome', 'own-off', 'chrome-devtools', 'owners-own']) assert.ok(!p.stdout.includes(kept), kept);
    p = active(h, 'install');
    assert.equal(p.code, 0, p.all);
    assert.ok(!p.all.includes('synth.example'));
    const codex = tload(t.codex).mcp_servers;
    assert.deepEqual(Object.fromEntries(Object.entries(codex).map(([n, s]) => [n, /** @type {any} */ (s).enabled])), { 'set-a': undefined, 'out-b': false, 'out-c': false, 'own-off': false, node_repl: undefined });
    assert.equal(jload(t.kiro).mcpServers['out-k'].disabled, true, 'Kiro: the server is switched off');
    assert.deepEqual(jload(settings).deniedMcpServers, [{ serverName: 'owners-own' }, { serverName: 'out-u' }, { serverCommand: ['/bin/cat', '-u'] }, { serverUrl: 'https://synth.example/mcp' }, { serverName: 'claude.ai Synth Off' }]);
    assert.equal(read(t['claude-code']), seed['claude-code'], '~/.claude.json is read, never written');
    for (const f of [t.codex, t.kiro, settings]) assert.equal(mode(f + '.pmhwc-mcp-active-backup'), 0o600, f);
    assert.deepEqual(plain(loads(read(manifest(h)), { ordered: true })).active.codex, { 'out-b': null, 'out-c': 'enabled = true # kept as written' });
    assert.ok(!active(h, 'check').stdout.includes('DRIFT'));
    assert.ok(!active(h, 'install').stdout.includes('CHANGED'));
    p = active(h, 'uninstall');
    assert.equal(p.code, 0, p.all);
    assert.equal(read(t.codex), seed.codex);
    assert.deepEqual(jload(t.kiro), JSON.parse(seed.kiro));
    assert.deepEqual(jload(settings), JSON.parse(seedSettings));
    assert.ok(!fs.existsSync(manifest(h)));
  });

  test('a server that joins the set, or an undeclared set, is turned back on', () => {
    const { h, settings } = home('home-active-join');
    const seedCodex = read(targets(h).codex);
    assert.equal(active(h, 'install').code, 0);
    writeSource(h, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo' }, 'out-b': { command: '/bin/echo' } } });
    assert.ok(active(h, 'install').stdout.includes('CHANGED codex: turned back on out-b (1)'));
    writeSource(h, { version: 1, servers: { 'set-a': { command: '/bin/echo' } } });
    assert.equal(active(h, 'install').code, 0);
    assert.equal(read(targets(h).codex), seedCodex);
    assert.deepEqual(jload(settings).deniedMcpServers, [{ serverName: 'owners-own' }]);
  });

  test('a server not written as a table is refused and the rest still applies', () => {
    const { h } = home('home-active-inline');
    fs.appendFileSync(targets(h).codex, '\n[mcp_servers]\ninline-x = { command = "/bin/echo" }\n');
    const p = active(h, 'install');
    assert.equal(p.code, 3, p.all);
    assert.match(p.stderr, /inline-x/);
    assert.equal(jload(targets(h).kiro).mcpServers['out-k'].disabled, true);
  });

  test('policy uninstall keeps the active record; a managed-block server is never switched', () => {
    const { h, settings } = home('home-active-policy');
    fs.appendFileSync(targets(h).codex, '\n' + M.BLOCK_BEGIN + '\n[mcp_servers.rendered-z]\ncommand = "/bin/echo"\n' + M.BLOCK_END + '\n');
    assert.equal(active(h, 'install').code, 0);
    assert.equal(tload(targets(h).codex).mcp_servers['rendered-z'].enabled, undefined);
    assert.equal(policy(h, 'uninstall').code, 0);
    assert.ok('active' in jload(manifest(h)));
    assert.equal(active(h, 'uninstall').code, 0);
    assert.deepEqual(jload(settings).deniedMcpServers, [{ serverName: 'owners-own' }]);
  });

  test('a plugin deny that would block a kept server is reported, not written', () => {
    const pc = plain(policyEntry());
    const cases = [[{ command: '/bin/cat', args: ['-u'] }, false], [{ command: '/usr/bin/synth-rendered', args: ['--x'] }, false], [{ type: 'http', url: 'https://SET.example:443/other' }, false],
      [{ command: pc.command, args: pc.args }, false], [{ command: '/bin/synth-chrome' }, false], [{ command: '/bin/cat', args: ['-n'] }, true], [{ type: 'http', url: 'https://other.example/mcp' }, true]];
    cases.forEach(([server, denied], i) => {
      const h = mkHome('home-active-collide-' + i);
      putJson(targets(h)['claude-code'], { mcpServers: { 'set-a': { type: 'stdio', command: '/bin/cat', args: ['-u'] }, 'set-web': { type: 'http', url: 'https://set.example/mcp' }, 'claude-in-chrome': { command: '/bin/synth-chrome' } } });
      writeSource(h, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/cat', args: ['-u'] }, 'set-r': { command: '/usr/bin/synth-rendered', args: ['--x'] }, 'set-web': { command: '/bin/echo' } } });
      putJson(path.join(h, '.claude', 'plugins', 'synced', 'src', 'plug', '.mcp.json'), { mcpServers: { p: server } });
      const p = active(h, 'install');
      assert.equal(p.code, 0, p.all);
      const s = path.join(h, '.claude', 'settings.json');
      const written = fs.existsSync(s) ? jload(s).deniedMcpServers || [] : [];
      assert.equal(written.length > 0, denied, 'case ' + i);
      assert.equal(p.stdout.includes('as a server kept on'), !denied, 'case ' + i);
    });
  });

  test("check names a set member an owner's deny entry blocks; an owner's empty deny list stays on uninstall", () => {
    const h = mkHome('home-active-blocked');
    writeSource(h, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/cat', args: ['-u'] } } });
    putJson(targets(h)['claude-code'], { mcpServers: { 'set-a': { command: '/bin/cat', args: ['-u'] } } });
    putJson(path.join(h, '.claude', 'settings.json'), { deniedMcpServers: [{ serverCommand: ['/bin/cat', '-u'] }] });
    assert.ok(active(h, 'check').stdout.includes('ABSENT  claude-code: set member(s) blocked by a deniedMcpServers entry mhw did not write: set-a (1)'));
    const { h: h2, settings } = home('home-active-empty-deny');
    putJson(settings, { deniedMcpServers: [] });
    assert.equal(active(h2, 'install').code, 0);
    assert.ok(jload(settings).deniedMcpServers.length);
    assert.equal(active(h2, 'uninstall').code, 0);
    assert.deepEqual(jload(settings), { deniedMcpServers: [] });
  });

  test('a committable definition is refused, through the renderer', { skip: !GIT && 'git not available' }, () => {
    const h = mkHome('home-active-git');
    const repo = path.join(BASE, 'an-active-git-repo');
    fs.rmSync(repo, { recursive: true, force: true });
    fs.mkdirSync(repo);
    spawnSync(/** @type {string} */ (GIT), ['init', '-q', repo]);
    const src = path.join(repo, 'mcp-servers.json');
    putJson(src, { version: 1, servers: {}, active_set: {} });
    const p = active(h, 'check', ['--source=' + src]);
    assert.equal(p.code, 2, p.all);
    assert.match(p.stderr, /could be committed/);
  });

  test('python3 is not needed: with no python3 and no node on PATH the active set runs', () => {
    const h = mkHome('home-active-nopython');
    writeSource(h, { version: 1, active_set: {}, servers: {} });
    const empty = path.join(BASE, 'empty-path');
    fs.mkdirSync(empty, { recursive: true });
    const p = run(h, ['--active', '--mode=check'], cleanEnv(h, { PATH: empty }));
    assert.equal(p.code, 0, p.all);
    assert.ok(!p.all.includes('python3'), p.all);
    assert.match(p.stdout, /OK {6}kiro: nothing on outside the set \(0 turned off by mhw\)/);
  });

  test('the --lib bridge is gone: it is an unknown argument', () => {
    const p = run(BASE, ['--lib=paths']);
    assert.equal(p.code, 2);
    assert.match(p.stderr, /unknown argument: --lib=paths/);
  });

  test('policy extension: the active set agrees with the render; a differing copy is reported', () => {
    const h = mkHome('home-ext-active');
    writeSource(h, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo', surfaces: ['codex', 'claude-code', 'kiro'] }, 'chrome-devtools': policyCopy() } });
    assert.equal(policy(h, 'install').code, 0);
    assert.equal(run(h, []).code, 0);
    let p = active(h, 'check');
    assert.equal(p.code, 0, p.all);
    assert.ok(!p.stdout.includes('ABSENT') && !p.stdout.includes('REPORT'));
    const h2 = mkHome('home-ext-divergent');
    writeSource(h2, { version: 1, active_set: {}, servers: { 'chrome-devtools': policyCopy({ args: ['-c', 'exec /bin/echo synthetic-divergent'], surfaces: ['codex', 'kiro'] }) } });
    assert.equal(policy(h2, 'install').code, 0);
    assert.equal(run(h2, []).code, 0);
    p = active(h2, 'check');
    for (const s of ['codex', 'kiro']) assert.ok(p.stdout.includes('REPORT  ' + s + ": set member(s) whose local copy here runs another command, args or env than the policy server's copy on claude-code"));
    assert.ok(!p.all.includes('synthetic-divergent'));
    const h3 = mkHome('home-ext-active-conflict');
    writeSource(h3, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo', surfaces: ['codex', 'claude-code', 'kiro'] }, 'chrome-devtools': policyCopy({ args: ['-c', 'exec /bin/echo synthetic'] }) } });
    assert.equal(policy(h3, 'install').code, 0);
    assert.equal(run(h3, []).code, 3);
    p = active(h3, 'check');
    assert.ok(p.stdout.includes("REPORT  claude-code: set member(s) whose local copy differs from the policy server's here, so the policy's copy runs and mhw mcp render refuses the local copy: chrome-devtools (1)"));
    assert.ok(p.stdout.includes('ABSENT  codex: set member(s) not configured: chrome-devtools (1); render them with mhw mcp render'));
  });

  test('a write that fails refuses the run with exit 3 and names the file', { skip: (process.getuid?.() === 0) && 'root writes anywhere' }, () => {
    const { h } = home('home-active-readonly');
    const kiroDir = path.dirname(targets(h).kiro);
    fs.chmodSync(kiroDir, 0o500);
    try {
      const p = active(h, 'install');
      assert.equal(p.code, 3, p.all);
      assert.match(p.stderr, /cannot write .*mcp\.json/);
    } finally {
      fs.chmodSync(kiroDir, 0o700);
    }
  });
});

// ------------------------------------------------------------------------------------- the unit rows

test('Windows: the active set is not applied, and says so', () => {
  const { ctx, out } = ctxOf(BASE, { platform: 'win32' });
  assert.equal(A.activeRun('install', STAMP, null, ctx), 0);
  assert.equal(out.stdout, 'SKIP    MCP active set: not applied on Windows (MCP active set)\n');
});

test('an unexpected manifest record is refused before anything is read', () => {
  const h = mkHome('home-unit-manifest');
  putJson(manifest(h), { version: 1, surfaces: {}, active: { 'claude-code': 'x' } });
  const { ctx } = ctxOf(h, { platform: 'linux' }); // on Windows the run says SKIP before it reads the manifest
  assert.throws(() => A.activeRun('check', STAMP, null, ctx), (e) => e instanceof M.Refuse && e.code === 3 && /unexpected shape/.test(e.message));
  for (const [rec, ok] of /** @type {Array<[unknown, boolean]>} */ ([[new Map(), true], [[], false], [map([['codex', map([['a', 'x']])]]), true], [map([['kiro', map([['a', []]])]]), true], [map([['claude-code', [map([['entry', new Map()], ['label', 'l']])]]]), true], [map([['claude-code', [3]]]), false]])) {
    assert.equal(A.validRecord(rec), ok, JSON.stringify(plain(rec)));
  }
});

test('names, the exempt list and the switch line', () => {
  assert.equal(A.names(['a', 'b']), 'a, b (2)');
  assert.equal(A.names([]), ' (0)');
  assert.deepEqual(A.EXEMPT, ['node_repl', 'claude-in-chrome']);
  assert.equal(A.DISABLE_LINE, 'enabled = false  # managed-by: ' + PROJECT + ' (mcp active set)\n');
  assert.equal(A.BACKUP, '.pmhwc-mcp-active-backup');
});

test('the Codex layout: headers by every key form, the managed block, the mark and the enabled key', () => {
  const lines = M.splitKeep('[mcp_servers."q"] # c\nenabled = true\n[mcp_servers.\'l\']\n' + A.MARK + '\n' + M.BLOCK_BEGIN + '\n[mcp_servers.b]\n' + M.BLOCK_END + '\n[other]\nenabled = 1\n[mcp_servers."e\\"x"]\n');
  const lay = A.codexLayout(lines);
  assert.deepEqual([...lay.keys()], ['q', 'l', 'b']);
  assert.deepEqual(lay.get('q'), { header: 0, block: false, enabled: 1, mark: null });
  assert.deepEqual(lay.get('l'), { header: 2, block: false, enabled: null, mark: 3 });
  assert.equal(lay.get('b')?.block, true);
});

test('planCodex: an invalid file and an edit that does not parse back are refused', () => {
  const set = new A.ActiveSet(M.activeFacts(map([['servers', new Map()], ['active_set', new Map()]]), ctxOf(BASE).ctx));
  assert.throws(() => A.planCodex('model = \n', set, new Map()), A.TomlInvalid);
  // A recorded original line that is not TOML: restoring it would break the file, so nothing is written.
  const text = '[mcp_servers.x]\ncommand = "a"\n' + A.MARK + '\n';
  const prior = map([['x', 'enabled = = 1']]);
  const undeclared = new A.ActiveSet(M.activeFacts(null, ctxOf(BASE).ctx));
  assert.throws(() => A.planCodex(text, undeclared, prior), (e) => e instanceof M.Refuse && e.code === 3 && /does not parse back/.test(e.message));
  // A recorded value that TOML reads restores it; one it cannot read drops the key.
  const back = A.planCodex('[mcp_servers.x]\nenabled = false  ' + A.MARK + '\n', undeclared, map([['x', 'enabled = "yes" # mine']]));
  assert.equal(back.newText, '[mcp_servers.x]\nenabled = "yes" # mine\n');
  const gone = A.planCodex('[mcp_servers.x]\nenabled = false  ' + A.MARK + '\n', undeclared, map([['x', null]]));
  assert.equal(gone.newText, '[mcp_servers.x]\n');
  // A header on the last line, with no newline: the switch goes on its own line after it.
  const declared = new A.ActiveSet(M.activeFacts(map([['servers', map([['set-a', map([['command', '/bin/echo']])]])], ['active_set', new Map()]]), ctxOf(BASE).ctx));
  const tail = A.planCodex('[mcp_servers.z]', declared, new Map());
  assert.equal(tail.newText, '[mcp_servers.z]\n' + A.DISABLE_LINE);
  assert.deepEqual([...tail.record], [['z', null]]);
});

test('planKiro and planClaude on their own', () => {
  const declared = new A.ActiveSet(M.activeFacts(map([['servers', map([['set-a', map([['command', '/bin/echo']])]])], ['active_set', new Map()]]), ctxOf(BASE).ctx));
  const data = loads('{"mcpServers": {"set-a": {"disabled": true}, "o": {"disabled": 0}, "p": {"disabled": true}, "q": {"disabled": true}}}', { ordered: true });
  const k = A.planKiro(/** @type {Map<string, any>} */ (data), declared, map([['set-a', [false]], ['p', []]]));
  assert.deepEqual(k.add, ['o']);
  assert.deepEqual(plain(k.record), { o: [0], p: [] });
  assert.deepEqual(k.back, ['set-a']);
  assert.equal(plain(k.next).mcpServers['set-a'].disabled, false);
  assert.equal(plain(k.next).mcpServers.q.disabled, true, "the owner's own switch is never recorded or changed");
  assert.throws(() => A.planClaude(map([['deniedMcpServers', 'x']]), [], []), (e) => e instanceof M.Refuse && /not a list/.test(e.message));
  const e1 = map([['serverName', 'a']]);
  const c = A.planClaude(map([['deniedMcpServers', [map([['serverName', 'mine']]), map([['serverName', 'old']])]]]), [[e1, 'a']], [map([['entry', map([['serverName', 'old']])], ['label', 'old']])]);
  assert.deepEqual(plain(c.next).deniedMcpServers, [{ serverName: 'mine' }, { serverName: 'a' }]);
  assert.deepEqual(c.gone.map((p) => M.get(p, 'label')), ['old']);
  assert.deepEqual(plain(A.planClaude(new Map(), [], []).next), {}, 'no key is added for nothing');
});

test('deny matching: names, commands with and without ${VAR}, wildcards and hosts', () => {
  const kept = map([['command', '${SYNTH_MCP_DIR}/bin/x'], ['args', ['-q']]]);
  const env = { SYNTH_MCP_DIR: '/synth' };
  /** @param {Record<string, unknown>} o */
  const m = (o) => new Map(Object.entries(o));
  assert.equal(A.denyMatches(m({ serverCommand: ['/synth/bin/x', '-q'] }), 'k', kept, env), true);
  assert.equal(A.denyMatches(m({ serverCommand: ['/other/bin/x', '-q'] }), 'k', kept, env), false);
  assert.equal(A.denyMatches(m({ serverCommand: ['${SYNTH_MCP_DIR}/bin/x', '-q'] }), 'k', kept, {}), true);
  const w = m({ serverUrl: 'https://*.synth.example/*' });
  assert.equal(A.denyMatches(w, 'k', m({ url: 'https://A.Synth.Example/mcp' }), env), true);
  assert.equal(A.denyMatches(w, 'k', m({ url: 'https://other.example/mcp' }), env), false);
  assert.equal(A.denyMatches(w, 'k', m({ command: '/bin/echo' }), env), false);
  assert.equal(A.denyMatches(m({ serverName: 'k' }), 'k', m({}), env), true);
  assert.equal(A.denyMatches(m({ serverUrl: 'https://H.example./a' }), 'k', m({ url: 'https://h.example:8443/b' }), env), true);
  assert.equal(A.denyMatches(m({ serverUrl: 'no host' }), 'k', m({ url: 'no host' }), env), false);
  assert.equal(A.denyMatches('x', 'k', m({}), env), false);
  assert.equal(A.denyMatches(m({ serverCommand: ['/bin/x'] }), 'k', m({ command: '/bin/x', args: [1] }), env), false);
});

test('expandvars as os.path.expandvars reads it on POSIX', () => {
  const env = { A: 'x', B_1: 'y', E: '' };
  /** @type {Array<[string, string]>} */
  const rows = [['$A/${B_1}', 'x/y'], ['$Z ${Z} ${} $ $$A', '$Z ${Z} ${} $ $x'], ['${A', '${A'], ['plain', 'plain'], ['$E-', '-'], ['${A}${A}', 'xx'], ['$A_', '$A_']];
  for (const [i, o] of rows) assert.equal(A.expandvars(i, env), o, i);
});

test('fnmatchcase as Python reads a pattern', () => {
  /** @type {Array<[string, string, boolean]>} */
  const rows = [['abc', 'a*', true], ['abc', '*c', true], ['abc', 'a?c', true], ['abc', 'a?', false], ['', '*', true], ['', '', true], ['a', '', false],
    ['abc', '**c', true], ['a[b', 'a[b', true], ['ab', 'a[!c]', true], ['ac', 'a[!c]', false], ['a-', 'a[-]', true], ['ab', 'a[a-c]', true], ['ad', 'a[a-c]', false],
    ['a]', 'a[]]', true], ['ax', 'a[!]', false], ['a!', 'a[!]', false], ['a[!]', 'a[!]', true], ['a-', 'a[a-]', true], ['az', 'a[z-a]', false],
    ['a\\', 'a[\\]', true], ['ab', 'a[^b]', true], ['a^', 'a[^b]', true], ['aXbXc', 'a*b*c', true], ['abcabd', '*abd', true], ['https://a.b/x', 'https://*.b/*', true]];
  for (const [n, p, want] of rows) assert.equal(A.fnmatchcase(n, p), want, n + ' ~ ' + p);
});

test('the URL host as urlsplit().hostname reads it, and its ValueErrors', () => {
  /** @type {Array<[string, string | null]>} */
  const rows = [['https://U:P@Host.Example:443/x', 'host.example'], ['https://[::1]:8/x', '::1'], ['https://[fe80::1%25eth0]/', 'fe80::1%25eth0'], ['//h/p', 'h'], ['h/p', null],
    ['https:///p', null], ['  https://h', 'h'], ['ht\ttps://h', 'h'], ['1http://h', null], ['https://[v1.x]/', 'v1.x'], ['https://h:x?q', 'h']];
  for (const [u, want] of rows) assert.equal(A.urlHostname(u), want, u);
  for (const bad of ['https://[::1/x', 'https://::1]/', 'https://x[::1]/', 'https://[::1]x/', 'https://[1.2.3.4]/', 'https://[vz.x]/', 'https://[zz]/', 'https://a＃b/']) {
    assert.throws(() => A.urlHostname(bad), Error, bad);
    assert.equal(A.hostOf(bad), null, bad);
  }
  assert.equal(A.hostOf('https://h.example../x'), 'h.example');
});

test('plugin servers: installed and synced roots, hidden names skipped, .mcp.json flat or nested, plugin.json inline', () => {
  const h = mkHome('home-unit-plugins');
  const base = path.join(h, '.claude', 'plugins');
  putJson(path.join(base, 'synced', 's', 'p1', '.mcp.json'), { a: { command: 'x' } });
  putJson(path.join(base, 'synced', 's', 'p2', '.mcp.json'), { mcpServers: { b: { command: 'x' }, n: 1 } });
  putJson(path.join(base, 'synced', 's', '.h', '.mcp.json'), { c: { command: 'x' } });
  putJson(path.join(base, 'synced', '.hid', 'p3', '.mcp.json'), { d: { command: 'x' } });
  put(path.join(base, 'synced', 's', 'file'), 'x');
  const inst = path.join(BASE, 'plugin-inst');
  putJson(path.join(inst, '.claude-plugin', 'plugin.json'), { mcpServers: { e: { command: 'x' } } });
  putJson(path.join(base, 'installed_plugins.json'), { plugins: { 'pi@m': [{ installPath: inst }] } });
  const { ctx } = ctxOf(h);
  assert.deepEqual(A.pluginServers(h, ctx).map(([l]) => l), ['plugin:pi:e', 'plugin:p1:a', 'plugin:p2:b']);
  /** @param {Record<string, unknown>} o */
  const m = (o) => new Map(Object.entries(o));
  assert.equal(A.pluginEntry(m({ url: '' })), null);
  assert.equal(A.pluginEntry(m({ url: 'https://h/*' })), null);
  assert.deepEqual(plain(A.pluginEntry(m({ url: 'https://h/x' }))), { serverUrl: 'https://h/x' });
  assert.equal(A.pluginEntry(m({ command: '' })), null);
  assert.equal(A.pluginEntry(m({ command: 'x', args: 'no' })), null);
  assert.deepEqual(plain(A.pluginEntry(m({ command: 'x' }))), { serverCommand: ['x'] });
});

test('readJsonObject: absent, unreadable, not an object', () => {
  const d = path.join(BASE, 'unit-json');
  fs.mkdirSync(d, { recursive: true });
  assert.deepEqual(A.readJsonObject(path.join(d, 'absent.json'))[0], false);
  put(path.join(d, 'bad.json'), '{');
  assert.throws(() => A.readJsonObject(path.join(d, 'bad.json')), /not readable JSON \(JSONDecodeError\)/);
  put(path.join(d, 'list.json'), '[]');
  assert.throws(() => A.readJsonObject(path.join(d, 'list.json')), /not a JSON object/);
  if (POSIX) assert.throws(() => A.readJsonObject(d), /not readable JSON \(IsADirectoryError\)/);
});
