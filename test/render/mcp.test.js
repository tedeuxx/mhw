// src/render/mcp.js (#484, S13 of #470): the cases of the deleted global/mcp/mcp_render_test.py, as
// node:test. Throwaway HOMEs only; every server, command and value is SYNTHETIC and every credential-like
// value is generated at run time. No test runs the real `security` binary or reads a real Keychain: the
// keychain case runs the launcher through test/helpers/mcp-launch-driver.js on the Node security stub.
// The active set and its connection check are Node since #485 (S14): their cases are test/mcp/active.test.js,
// test/mcp/connect.test.js and the S14 transcripts, test/mcp/active-golden.test.js.
import { test, after, describe as group } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { throwawayHome, which } from '../helpers/home.js';
import { mcpHomes } from '../helpers/mcp-home.js';
import * as M from '../../src/render/mcp.js';
import { loads } from '../../src/lib/py.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { CASES, PROJECT, put, putJson, activeHome, policyCopy, sourceDoc as baseSourceDoc } from './mcp-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER = path.join(ROOT, 'src', 'render', 'mcp.js');
const NODE = process.execPath;
// The node the renderer names: node on PATH when it is the same file as MHW_NODE (the stable name, PR #516 A1).
const PATH_NODE = which('node');
const RENDERED = PATH_NODE && fs.realpathSync(PATH_NODE) === fs.realpathSync(NODE) ? PATH_NODE : NODE;
const POSIX = process.platform !== 'win32';
const DARWIN = process.platform === 'darwin';
const PY = POSIX ? which('python3') : null;
const GIT = which('git');
const STUB = path.join(ROOT, 'test', 'helpers', 'security-stub.js');
const DRIVER = path.join(ROOT, 'test', 'helpers', 'mcp-launch-driver.js');
// The parity cases include the active set's, which is not applied on Windows.
const noPy = !POSIX && 'POSIX only';
const STAMP = 'release: v0.0.0-test; commit: synthetic';
const box = throwawayHome('mcp-render');
after(() => box.cleanup());
const BASE = box.dir;
const synth = (/** @type {string} */ label = 'synthetic') => label + '-' + crypto.randomBytes(12).toString('hex');

// A fake stdio server: writes the sha256 of one environment variable to a file, so a test can show the
// launched server received a secret without the value being written anywhere by the test.
const FAKE_SERVER = path.join(BASE, 'fake-server.mjs');
fs.writeFileSync(FAKE_SERVER, "import fs from 'node:fs'; import c from 'node:crypto';\n"
  + "fs.writeFileSync(process.argv[2], c.createHash('sha256').update(process.env[process.argv[3]] || '').digest('hex'));\n");
const OUT = path.join(BASE, 'out-env.txt');
const sha = (/** @type {string} */ s) => crypto.createHash('sha256').update(s).digest('hex');

/** @param {Record<string, unknown>} [extra] */
function sourceDoc(extra = {}) {
  const d = baseSourceDoc(extra);
  /** @type {any} */ (d.servers)['fake-secret'] = { command: NODE, args: [FAKE_SERVER, OUT, 'FAKE_API_TOKEN'], secrets: { FAKE_API_TOKEN: 'env:FAKE_SRC_VAR' } };
  return d;
}

const { mkHome, data, targets, writeSource, cleanEnv, run } = mcpHomes(BASE, RENDER);
/** @param {string} p */
const read = (p) => fs.readFileSync(p, 'utf8');
/** @param {string} p */
const jload = (p) => JSON.parse(read(p));
/** @param {string} p */
const tload = (p) => /** @type {any} */ (M.tomlLoads(read(p)));
/** @param {string} h */
function fingerprint(h) {
  /** @type {Record<string, string>} */
  const out = {};
  /** @param {string} d */
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.lstatSync(p).isDirectory()) walk(p);
      else out[p] = sha(fs.readFileSync(p).toString('base64'));
    }
  };
  walk(h);
  return out;
}
/** @param {string} h */
function allBytes(h) {
  /** @type {Buffer[]} */
  const b = [];
  /** @param {string} d */
  const walk = (d) => {
    for (const n of fs.readdirSync(d)) {
      const p = path.join(d, n);
      if (fs.lstatSync(p).isDirectory()) walk(p);
      else b.push(fs.readFileSync(p));
    }
  };
  walk(h);
  return Buffer.concat(b);
}
/** @param {string} p */
const mode = (p) => fs.statSync(p).mode & 0o777;
const policyEntry = () => M.entry('claude-code', M.get(M.loadPolicy(), 'servers').get('chrome-devtools'), null);
/** A Map tree as plain JSON. @param {unknown} v */
const plain = (v) => JSON.parse(JSON.stringify(v, (_k, x) => (x instanceof Map ? Object.fromEntries(x) : x)));
/** @param {string} h @param {string} m @param {string[]} more @param {Record<string, string>} [env] */
const policy = (h, m, more = [], env = undefined) => run(h, ['--policy', '--mode=' + m, '--stamp=' + STAMP, ...more], env);
/** @param {string} h @param {string} m @param {string[]} more @param {Record<string, string>} [env] */
const active = (h, m, more = [], env = undefined) => run(h, ['--active', '--mode=' + m, '--stamp=' + STAMP, ...more], env);
const { manifest } = mcpHomes(BASE, RENDER);

// ------------------------------------------------------------------------------------------ definition

group('the definition', () => {
  const EXAMPLE = path.join(ROOT, 'global', 'mcp', 'mcp-servers.example.json');
  const SCHEMA = path.join(ROOT, 'global', 'mcp', 'mcp-servers.schema.json');

  test('the example is valid on macOS and refuses keychain: elsewhere', () => {
    const doc = jload(EXAMPLE);
    assert.deepEqual(M.validate(doc, 'darwin'), []);
    assert.ok(M.validate(doc, 'linux').some((e) => e.includes('keychain: is macOS only')));
    assert.ok(M.validate(doc, 'win32').some((e) => e.includes('secrets are not supported on Windows')));
  });

  test('the example carries no real-looking names', () => {
    const doc = jload(EXAMPLE);
    assert.ok(Object.keys(doc.servers).every((n) => n.startsWith('example-')));
    assert.ok(Object.values(doc.servers).every((s) => /** @type {any} */ (s).description.startsWith('SYNTHETIC')));
  });

  test('the schema and the renderer agree on the vocabulary', () => {
    const s = jload(SCHEMA);
    assert.deepEqual(new Set(Object.keys(s.properties)), M.SOURCE_KEYS);
    assert.deepEqual(new Set(Object.keys(s.$defs.server.properties)), M.SERVER_KEYS);
    assert.deepEqual(s.$defs.server.properties.surfaces.items.enum, [...M.SURFACES]);
    assert.deepEqual(new Set(Object.keys(s.properties.active_set.properties)), M.ACTIVE_KEYS);
  });

  test('each invalid definition is refused', () => {
    /** @type {Record<string, unknown>} */
    const cases = {
      'bad name': { 'bad name': { command: 'x' } },
      'unknown key': { s: { command: 'x', commandd: 'y' } },
      'credential-named env': { s: { command: 'x', env: { SERVICE_API_KEY: 'v' } } },
      'credential flag in args': { s: { command: 'x', args: ['--auth-token=v'] } },
      'control character': { s: { command: 'x', args: ['a\nb'] } },
      'bad secret source': { s: { command: 'x', secrets: { T: 'file:/x' } } },
      'both env and secret': { s: { command: 'x', env: { T: 'v' }, not_secret: ['T'], secrets: { T: 'env:V' } } },
      'unknown surface': { s: { command: 'x', surfaces: ['vim'] } },
      'empty command': { s: { command: ' ' } },
      'not an object': { s: 3 },
      'args not strings': { s: { command: 'x', args: [1] } },
      'env not strings': { s: { command: 'x', env: { A: 1 } } },
      'secrets not strings': { s: { command: 'x', secrets: [] } },
      'not_secret not strings': { s: { command: 'x', not_secret: 'A' } },
      'bad env name': { s: { command: 'x', env: { '1A': 'v' } } },
      'bad secret name': { s: { command: 'x', secrets: { '1A': 'env:V' } } },
      'bad keychain service': { s: { command: 'x', secrets: { A_TOKEN: 'keychain:' } } },
      'bad env source': { s: { command: 'x', secrets: { A_TOKEN: 'env:BAD-NAME' } } },
      'credential-looking command': { s: { command: 'https://u:' + 'pw'.repeat(6) + '@h/x' } },
    };
    for (const [label, servers] of Object.entries(cases)) {
      assert.notDeepEqual(M.validate({ version: 1, servers }, 'darwin'), [], label);
    }
    assert.deepEqual(M.validate(3, 'darwin'), ['the definition must be a JSON object']);
    assert.ok(M.validate({ version: 2, servers: [], x: 1 }, 'darwin').length === 3);
  });

  test('a credential is refused by its value, whatever the key is called, and never echoed', () => {
    const gh = 'gh' + 'p_' + 'Q'.repeat(36);
    /** @type {Record<string, Record<string, unknown>>} */
    const cases = {
      'token prefix under an innocuous name': { env: { SETTING: gh } },
      'url with a password': { env: { DATABASE_URL: 'postgres://u:' + 'pw'.repeat(6) + '@db.example/x' } },
      'url with a token query': { args: ['https://h.example/mcp?access_token=' + 'z'.repeat(20)] },
      'authorization header arg': { args: ['--header', 'Authorization: Bearer ' + 'y'.repeat(24)] },
      'custom header arg': { args: ['-H', 'X-Api-Key: ' + 'k'.repeat(20)] },
      'private key block': { env: { CFG: '-----BEGIN RSA ' + 'PRIVATE KEY-----' } },
      'credential-looking name, wider set': { env: { GH_PAT: 'x' } },
      'bare KEY name': { env: { STRIPE_KEY: 'x' } },
    };
    for (const [label, extra] of Object.entries(cases)) {
      const errs = M.validate({ version: 1, servers: { s: { command: 'x', ...extra } } }, 'darwin');
      assert.notDeepEqual(errs, [], label);
      for (const v of [...Object.values(/** @type {Record<string, string>} */ (extra.env || {})), .../** @type {string[]} */ (extra.args || [])]) {
        if (v.length > 4) assert.ok(!errs.some((e) => e.includes(v)), label + ': an error message echoed the value');
      }
    }
    const h = mkHome('home-value-cred');
    writeSource(h, { version: 1, servers: { s: { command: 'x', env: { SETTING: gh } } } });
    for (const m of ['--dry-run', '--check']) {
      const p = run(h, [m]);
      assert.equal(p.code, 2);
      assert.ok(!p.all.includes(gh), m);
    }
  });

  test('the credential-value patterns: each one, a near miss, and no backtracking on a long input', () => {
    for (const v of ['Bearer ' + 'a'.repeat(9), 'x-token: v', 'Cookie:v', 'xoxb-' + '1'.repeat(10), 'AKIA' + 'A'.repeat(16), 'npm_' + 'a'.repeat(30),
      'sk-' + 'a'.repeat(16), 'sk_live_' + 'a'.repeat(10), 'AIza' + 'a'.repeat(30), 'glpat-' + 'a'.repeat(16), 'github_pat_' + 'a'.repeat(20),
      '-----BEGIN ' + 'PRIVATE KEY-----', 'https://h/?key=1', 'https://a:b@h/']) {
      assert.ok(M.looksLikeCredentialValue(v), v);
    }
    for (const v of ['Bearer short', 'éBearer ' + 'a'.repeat(9), 'xghp_' + 'a'.repeat(20), '-----BEGIN ' + 'PRIVATE KEY----', '-----BEGIN rsa ' + 'PRIVATE KEY-----', 'tokenless', 'https://h/x']) {
      assert.ok(!M.looksLikeCredentialValue(v), v);
    }
    const t0 = Date.now();
    M.looksLikeCredentialValue('-----BEGIN ' + 'A '.repeat(50000));
    M.looksLikeCredentialValue('token' + ' '.repeat(50000) + 'x');
    assert.ok(Date.now() - t0 < 2000, 'a long input is searched in linear time');
  });

  test('the credential detectors answer as the original patterns did in CPython 3.14.6 (recorded oracle)', () => {
    // test/golden/S13/credential-oracle.json: the inputs and what mcp_render.py's own patterns answered for
    // each, recorded from CPython 3.14.6. Non-ASCII on purpose: Python's \s holds \x1c-\x1f and \x85 and
    // not U+FEFF; its re.I accepts U+0130 and U+0131 for i, U+212A for k and U+017F for s.
    const g = readGolden('S13', 'credential-oracle.json');
    const inputs = oracleInputs();
    // The inputs are generated here, never stored: several are token-shaped on purpose. The golden pins their digest.
    assert.equal(g.inputs_sha256, inputsDigest(inputs), 'the oracle inputs changed: re-record with MHW_UPDATE_GOLDEN=1 on CPython 3.14.6');
    /** @type {Record<string, (s: string) => boolean>} */
    const fns = { url: M.urlCredential, value: M.looksLikeCredentialValue, name: M.credentialName };
    /** @type {string[]} */
    const wrong = [];
    for (const kind of Object.keys(fns)) {
      /** @type {Record<string, string[]>} */ (inputs)[kind].forEach((/** @type {string} */ x, /** @type {number} */ i) => {
        if (fns[kind](x) !== g.answers[kind][i]) wrong.push(kind + ' ' + JSON.stringify(x) + ': CPython ' + g.answers[kind][i]);
      });
      assert.ok(g.answers[kind].includes(true) && g.answers[kind].includes(false), kind + ': the inputs hold both answers');
    }
    assert.deepEqual(wrong, []);
  });

  test('live: the recorded oracle is what CPython 3.14.6 answers now', (t) => {
    const version = PY ? spawnSync(PY, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim() : '';
    if (version !== '3.14.6') {
      t.skip('the oracle was recorded from CPython 3.14.6; python3 here is ' + (version || 'absent'));
      return;
    }
    const answers = cpythonAnswers(oracleInputs());
    if (UPDATE) writeGolden('S13', 'credential-oracle.json', { cpython: version, why: 'The answers of the patterns of the deleted global/mcp/mcp_render.py (URL_CRED_RE, VALUE_CRED_RES, CRED_RE), copied verbatim into the oracle script of test/render/mcp.test.js, on the inputs oracleInputs() generates (their digest is inputs_sha256).', inputs_sha256: inputsDigest(oracleInputs()), answers });
    assert.deepEqual(answers, readGolden('S13', 'credential-oracle.json').answers);
  });

  test('not_secret is the reviewed escape', () => {
    assert.deepEqual(M.validate({ version: 1, servers: { s: { command: 'x', env: { AUTH_MODE: 'device' }, args: ['--token-file', '/p'], not_secret: ['AUTH_MODE', '--token-file'] } } }, 'darwin'), []);
  });

  test('an invalid definition writes nothing; a missing one is a usage error', () => {
    const h = mkHome('home-invalid');
    writeSource(h, { version: 1, servers: { s: { command: 'x', env: { MY_SECRET: 'v' } } } });
    const before = fingerprint(h);
    const p = run(h, []);
    assert.equal(p.code, 2, p.stderr);
    assert.match(p.stderr, /looks like a credential/);
    assert.deepEqual(fingerprint(h), before);
    const q = run(mkHome('home-nosource'), []);
    assert.equal(q.code, 2);
    assert.match(q.stderr, /no MCP definition/);
    put(path.join(data(h), 'local-overlay', 'mcp-servers.json'), '{ "version": 1, ');
    assert.match(run(h, ['--dry-run']).stderr, /cannot read the MCP definition .*Expecting/);
  });

  test('the definition must be a regular file; a symbolic link resolves to its file', { skip: !POSIX && 'a symbolic link' }, () => {
    const h = mkHome('home-source-kind');
    const d = path.join(BASE, 'a-directory-source');
    fs.mkdirSync(d, { recursive: true });
    const p = run(h, ['--source=' + d, '--dry-run']);
    assert.equal(p.code, 2);
    assert.match(p.stderr, /not a regular file/);
    const real = writeSource(h, sourceDoc());
    const link = path.join(BASE, 'a-linked-source.json');
    fs.rmSync(link, { force: true });
    fs.symlinkSync(real, link);
    assert.equal(run(h, ['--source=' + link, '--dry-run']).code, 0);
  });

  test('a definition that could be committed is refused', { skip: (!POSIX && 'the fixture names a secret, refused on Windows') || (!GIT && 'git not available') }, () => {
    const h = mkHome('home-git');
    const repo = path.join(BASE, 'a-git-repo');
    fs.rmSync(repo, { recursive: true, force: true });
    fs.mkdirSync(repo);
    spawnSync(/** @type {string} */ (GIT), ['init', '-q', repo]);
    const src = path.join(repo, 'mcp-servers.json');
    putJson(src, sourceDoc());
    const p = run(h, ['--source=' + src, '--dry-run']);
    assert.equal(p.code, 2, p.all);
    assert.match(p.stderr, /could be committed/);
    put(path.join(repo, '.gitignore'), 'mcp-servers.json\n');
    assert.equal(run(h, ['--source=' + src, '--dry-run']).code, 0);
  });
});

// ---------------------------------------------------------------------------------------- trusted path

group('the trusted path', () => {
  /** @param {string} name */
  const fresh = (name) => {
    const d = path.join(BASE, name);
    fs.rmSync(d, { recursive: true, force: true });
    fs.mkdirSync(d);
    return fs.realpathSync.native(d);
  };

  test('an ordinary path is rebuilt unchanged', () => {
    const f = path.join(fresh('trusted-plain'), 'def.json');
    fs.writeFileSync(f, '');
    assert.equal(M.trustedPath(f), f);
  });

  test('the result is the listed name, not the argument', { skip: !POSIX && 'hard links and inodes' }, () => {
    const d = fresh('trusted-listed');
    const named = path.join(d, 'named.json');
    const listed = path.join(d, 'listed.json');
    fs.writeFileSync(named, '');
    fs.linkSync(named, listed);
    const real = fs.readdirSync;
    // @ts-ignore a test seam: hide the argument's own name from the listing of its directory
    fs.readdirSync = (p, ...rest) => real(p, ...rest).filter((/** @type {string} */ e) => !(p === d && e === 'named.json'));
    try {
      assert.equal(M.trustedPath(named), listed);
    } finally {
      fs.readdirSync = real;
    }
  });

  test('a differently spelled name resolves to the listed spelling', (t) => {
    const d = fresh('trusted-case');
    const f = path.join(d, 'Def.json');
    fs.writeFileSync(f, '');
    const other = path.join(d, 'dEF.JSON');
    if (!fs.existsSync(other)) {
      t.skip('case-sensitive filesystem');
      return;
    }
    assert.equal(M.trustedPath(other), f);
  });

  test('a missing component or a relative path raises FileNotFoundError', () => {
    const absent = path.join(fresh('trusted-missing'), 'absent', 'def.json');
    assert.throws(() => M.trustedPath(absent), (e) => /** @type {any} */ (e).cls === 'FileNotFoundError');
    assert.throws(() => M.trustedPath('relative/def.json'), (e) => /** @type {any} */ (e).cls === 'FileNotFoundError');
  });

  const unlistable = !POSIX || (typeof process.getuid === 'function' && process.getuid() === 0);
  test('a directory that cannot be listed is refused, not bypassed', { skip: unlistable && 'root lists any directory' }, () => {
    const h = mkHome('home-unlistable');
    const d = fresh('trusted-unlistable');
    const src = path.join(d, 'inner', 'mcp-servers.json');
    putJson(src, sourceDoc());
    fs.chmodSync(d, 0o311);
    let p;
    try {
      p = run(h, ['--source=' + src, '--dry-run']);
    } finally {
      fs.chmodSync(d, 0o755);
    }
    assert.equal(p.code, 2, p.all);
    assert.match(p.stderr, /cannot read the MCP definition .*Permission denied/);
  });

  test('a symbolic link under an unlistable ancestor in a work tree is refused', { skip: (unlistable && 'root lists any directory') || (!GIT && 'git not available') }, () => {
    const h = mkHome('home-unlistable-link');
    const d = fresh('trusted-unlistable-link');
    const target = path.join(d, 'outside', 'mcp-servers.json');
    putJson(target, sourceDoc());
    const repo = path.join(d, 'repo');
    fs.mkdirSync(repo);
    spawnSync(/** @type {string} */ (GIT), ['init', '-q', repo]);
    const locked = path.join(repo, 'locked');
    fs.mkdirSync(path.join(locked, 'sub'), { recursive: true });
    const link = path.join(locked, 'sub', 'mcp-servers.json');
    fs.symlinkSync(target, link);
    fs.chmodSync(locked, 0o311);
    let p;
    try {
      p = run(h, ['--source=' + link, '--dry-run']);
    } finally {
      fs.chmodSync(locked, 0o755);
    }
    assert.equal(p.code, 2, p.all);
    assert.match(p.stderr, /cannot read the MCP definition/);
  });
});

// -------------------------------------------------------------------------------------------- render

group('render', { skip: !POSIX && 'the fixture names a secret, refused on Windows; see "render on Windows"' }, () => {
  test('a dry run writes nothing and prints no current value', () => {
    const h = mkHome('home-dry');
    const planted = synth();
    putJson(targets(h).kiro, { mcpServers: { 'hand-made': { command: 'x', env: { HAND_TOKEN: planted } } } });
    writeSource(h, sourceDoc());
    const before = fingerprint(h);
    const p = run(h, ['--dry-run']);
    assert.equal(p.code, 0, p.stderr);
    assert.deepEqual(fingerprint(h), before);
    for (const t of Object.values(targets(h))) assert.ok(p.stdout.includes('WOULD WRITE ' + t), t);
    assert.ok(!p.all.includes(planted));
  });

  test('a fresh install renders every surface and is idempotent', () => {
    const h = mkHome('home-fresh');
    writeSource(h, sourceDoc());
    const p = run(h, []);
    assert.equal(p.code, 0, p.all);
    const t = targets(h);
    const launcher = path.join(data(h), M.LAUNCHER_NAME);
    const cx = tload(t.codex).mcp_servers;
    assert.deepEqual(Object.keys(cx), ['fake-plain', 'fake-secret', 'fake-codex-only']);
    assert.deepEqual(plain(cx['fake-plain']), { command: '/bin/echo', args: ['hello'], env: { FAKE_REGION: 'zz-1' } });
    assert.equal(cx['fake-secret'].command, RENDERED);
    assert.deepEqual(cx['fake-secret'].args.slice(0, 4), [launcher, '--secret', 'FAKE_API_TOKEN=env:FAKE_SRC_VAR', '--']);
    assert.deepEqual(cx['fake-secret'].env_vars, ['FAKE_SRC_VAR']);
    for (const s of ['claude-code', 'kiro', 'claude-desktop']) {
      if (!t[s]) continue;
      const servers = jload(t[s]).mcpServers;
      assert.deepEqual(Object.keys(servers), ['fake-plain', 'fake-secret'], s);
      assert.equal(servers['fake-secret'].command, RENDERED, s);
      assert.equal(servers['fake-secret'].args[0], launcher, s);
    }
    assert.equal(jload(t['claude-code']).mcpServers['fake-plain'].type, 'stdio');
    assert.ok(!('type' in jload(t.kiro).mcpServers['fake-plain']));
    const text = read(launcher);
    assert.equal(text.split('\n')[0], '#!/usr/bin/env node');
    assert.equal(text.split('\n').slice(2).join('\n'), read(M.LAUNCHER_SRC).split('\n').slice(1).join('\n'), 'the source with one marker line added');
    assert.ok(text.split('\n')[1].includes(M.MARKER_ID));
    if (POSIX) {
      assert.equal(mode(launcher), 0o700, 'the launcher is owner-only');
      for (const f of Object.values(t)) assert.equal(mode(f), 0o600, f);
    }
    assert.equal(run(h, ['--check']).code, 0);
    const before = fingerprint(h);
    assert.equal(run(h, []).code, 0);
    assert.deepEqual(fingerprint(h), before, 'a re-run changed a file');
  });

  test('every rendered file carries the source stamp, and a stamp-only difference is STAMP', { skip: !POSIX && 'POSIX modes' }, () => {
    const h = mkHome('home-stamp');
    writeSource(h, sourceDoc());
    const p = run(h, []);
    assert.equal(p.code, 0, p.all);
    const src = p.stdout.split('\n').filter((l) => l.startsWith('SOURCE  ')).map((l) => l.slice(8));
    assert.equal(src.length, 1);
    if (GIT) {
      const head = spawnSync(GIT, ['-C', ROOT, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' });
      if (head.status === 0) assert.match(src[0], new RegExp('^release: [^;]+; commit: ' + head.stdout.trim() + '(-dirty)?$'));
    }
    const launcher = path.join(data(h), M.LAUNCHER_NAME);
    const t = targets(h);
    assert.equal(M.stampOf(read(launcher)), src[0]);
    assert.equal(M.stampOf(read(t.codex)), src[0]);
    const stamps = jload(manifest(h)).stamps;
    for (const s of Object.keys(t).filter((x) => x !== 'codex')) assert.equal(stamps[s], src[0], s);
    const other = 'release: v0.0.1; commit: 0123456789abcdef0123456789abcdef01234567';
    for (const f of [launcher, t.codex]) {
      const m = mode(f);
      fs.writeFileSync(f, read(f).replace(src[0], other));
      fs.chmodSync(f, m);
    }
    const m = jload(manifest(h));
    m.stamps.kiro = other;
    putJson(manifest(h), m);
    const c = run(h, ['--check']);
    assert.equal(c.code, 1, c.stdout);
    assert.equal(c.stdout.split('\n').filter((l) => l.startsWith('STAMP') && l.includes(other)).length, 3, c.stdout);
    assert.ok(!c.stdout.includes('DRIFT'));
    assert.equal(run(h, []).code, 0);
    assert.equal(M.stampOf(read(launcher)), src[0]);
    assert.equal(run(h, ['--check']).code, 0);
  });

  test('the stamp is the one install.sh derives for this checkout', { skip: (!POSIX || !which('jq')) && 'needs sh and jq' }, () => {
    const h = mkHome('home-stamp-install');
    writeSource(h, sourceDoc());
    const src = run(h, ['--dry-run']).stdout.split('\n').find((l) => l.startsWith('SOURCE  '));
    const ih = path.join(BASE, 'home-stamp-install-sh');
    fs.mkdirSync(ih, { recursive: true });
    const q = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-user', '--dry-run', '--managed-root=' + path.join(BASE, 'managed-root')], { env: cleanEnv(ih), encoding: 'utf8' });
    assert.ok(q.stdout.includes(src + '\n'), q.stderr);
  });

  test('every other key and a hand server survive, with a backup', () => {
    const h = mkHome('home-keep');
    const t = targets(h);
    const codexBefore = '# my own comment\nmodel = "m"\n\n[mcp_servers.hand-made]\ncommand = "x"\nenv = { HAND_TOKEN = "synthetic-not-real" }\n\n[projects."/tmp/p"]\ntrust_level = "trusted"\n';
    put(t.codex, codexBefore);
    if (POSIX) fs.chmodSync(t.codex, 0o640);
    const jsonBefore = { preferences: { theme: 'dark' }, numStartups: 3, mcpServers: { 'hand-made': { command: 'x', args: [] } } };
    for (const s of ['claude-code', 'kiro', 'claude-desktop']) if (t[s]) putJson(t[s], jsonBefore);
    writeSource(h, sourceDoc());
    const p = run(h, []);
    assert.equal(p.code, 0, p.all);
    const nl = POSIX ? '\n' : '\r\n';
    assert.ok(fs.readFileSync(t.codex, 'utf8').startsWith(codexBefore.replaceAll('\n', nl)), "the owner's own TOML text changed");
    const parsed = tload(t.codex);
    assert.equal(parsed.model, 'm');
    assert.deepEqual(plain(parsed.projects), { '/tmp/p': { trust_level: 'trusted' } });
    assert.ok('hand-made' in parsed.mcp_servers);
    assert.equal(read(t.codex + '.pmhwc-backup'), codexBefore);
    if (POSIX) assert.equal(mode(t.codex), 0o640);
    for (const s of ['claude-code', 'kiro', 'claude-desktop']) {
      if (!t[s]) continue;
      const got = jload(t[s]);
      assert.deepEqual(got.preferences, { theme: 'dark' });
      assert.equal(got.numStartups, 3);
      assert.deepEqual(got.mcpServers['hand-made'], { command: 'x', args: [] });
      assert.deepEqual(jload(t[s] + '.pmhwc-backup'), jsonBefore);
    }
  });

  test('check finds drift per surface and install repairs it', () => {
    const h = mkHome('home-drift');
    writeSource(h, sourceDoc());
    assert.equal(run(h, []).code, 0);
    const t = targets(h);
    fs.writeFileSync(t.codex, read(t.codex).replace('args = ["hello"]', 'args = ["hello"]\nenabled = false'));
    const p = run(h, ['--check']);
    assert.equal(p.code, 1);
    assert.ok(p.stdout.includes('DRIFT   ' + t.codex));
    assert.equal(run(h, []).code, 0);
    assert.equal(run(h, ['--check']).code, 0);
    for (const s of ['claude-code', 'kiro', 'claude-desktop']) {
      if (!t[s]) continue;
      const d = jload(t[s]);
      d.mcpServers['fake-plain'].args = ['tampered'];
      putJson(t[s], d);
      const q = run(h, ['--check']);
      assert.equal(q.code, 1, s);
      assert.ok(q.stdout.includes('DRIFT   ' + t[s]));
      assert.equal(run(h, []).code, 0);
      assert.deepEqual(jload(t[s]).mcpServers['fake-plain'].args, ['hello']);
    }
    assert.equal(run(h, ['--check']).code, 0);
  });

  test('a server removed from the definition leaves every surface', () => {
    const h = mkHome('home-remove');
    const t = targets(h);
    putJson(t.kiro, { mcpServers: { 'hand-made': { command: 'x' } } });
    writeSource(h, sourceDoc());
    assert.equal(run(h, []).code, 0);
    const doc = sourceDoc();
    delete (/** @type {any} */ (doc.servers))['fake-plain'];
    writeSource(h, doc);
    assert.equal(run(h, ['--check']).code, 1);
    assert.equal(run(h, []).code, 0);
    assert.ok(!('fake-plain' in tload(t.codex).mcp_servers));
    for (const s of ['claude-code', 'kiro', 'claude-desktop']) if (t[s]) assert.ok(!('fake-plain' in jload(t[s]).mcpServers), s);
    writeSource(h, { version: 1, servers: {} });
    assert.equal(run(h, []).code, 0);
    assert.ok(!read(t.codex).includes(M.BLOCK_END));
    assert.deepEqual(jload(t.kiro).mcpServers, { 'hand-made': { command: 'x' } });
  });

  test('a hand server of the same name is refused and untouched; --adopt takes over a JSON one only', () => {
    let h = mkHome('home-conflict-codex');
    let t = targets(h);
    put(t.codex, '[mcp_servers.fake-plain]\ncommand = "mine"\n');
    writeSource(h, sourceDoc());
    const before = read(t.codex);
    const p = run(h, ['--surfaces=codex']);
    assert.equal(p.code, 3, p.all);
    assert.match(p.stderr, /duplicate table/);
    assert.equal(read(t.codex), before);
    assert.equal(run(h, ['--surfaces=codex', '--adopt']).code, 3);
    h = mkHome('home-conflict-json');
    t = targets(h);
    putJson(t.kiro, { mcpServers: { 'fake-plain': { command: 'mine' } } });
    const seed = read(t.kiro);
    writeSource(h, sourceDoc());
    const q = run(h, ['--surfaces=kiro']);
    assert.equal(q.code, 3, q.all);
    assert.match(q.stderr, /--adopt/);
    assert.equal(read(t.kiro), seed);
    assert.equal(run(h, ['--surfaces=kiro', '--adopt']).code, 0);
    assert.equal(jload(t.kiro).mcpServers['fake-plain'].command, '/bin/echo');
    assert.deepEqual(jload(t.kiro + '.pmhwc-backup'), { mcpServers: { 'fake-plain': { command: 'mine' } } });
    assert.equal(run(h, ['--surfaces=kiro', '--check']).code, 0);
  });

  test('Codex content that would change meaning, and damaged markers, are refused', () => {
    const h = mkHome('home-after-block');
    const t = targets(h);
    writeSource(h, sourceDoc());
    assert.equal(run(h, ['--surfaces=codex']).code, 0);
    fs.appendFileSync(t.codex, 'startup_timeout_sec = 30\n');
    const before = read(t.codex);
    const p = run(h, ['--surfaces=codex']);
    assert.equal(p.code, 3, p.all);
    assert.match(p.stderr, /after the managed block/);
    assert.equal(read(t.codex), before);
    fs.writeFileSync(t.codex, before.replace(M.BLOCK_END, ''));
    const q = run(h, ['--surfaces=codex']);
    assert.equal(q.code, 3);
    assert.match(q.stderr, /markers are damaged/);
  });

  test('an unmanaged file at the launcher path stops everything', () => {
    const h = mkHome('home-foreign-launcher');
    put(path.join(data(h), M.LAUNCHER_NAME), "#!/usr/bin/env node\nconsole.log('someone else')\n");
    writeSource(h, sourceDoc());
    assert.equal(run(h, []).code, 3);
    for (const f of Object.values(targets(h))) assert.ok(!fs.existsSync(f), f);
  });

  /** @param {string} h */
  const legacyFile = (h) => {
    const old = path.join(data(h), 'mcp-launch.sh');
    put(old, '#!/bin/sh\n# ' + M.MARKER_ID + '; source: global/mcp/mcp-launch.sh; x; do not edit\nexec "$@"\n');
    return old;
  };

  test('the retired shell launcher is removed only when managed', () => {
    const h = mkHome('home-legacy-launcher');
    writeSource(h, sourceDoc());
    assert.equal(run(h, []).code, 0);
    const old = legacyFile(h);
    const c = run(h, ['--check']);
    assert.equal(c.code, 1, c.all);
    assert.ok(c.stdout.includes('STALE   ' + old));
    const d = run(h, ['--dry-run']);
    assert.ok(d.stdout.includes('WOULD REMOVE ' + old));
    assert.ok(fs.existsSync(old));
    const p = run(h, []);
    assert.equal(p.code, 0, p.all);
    assert.ok(p.stdout.includes('REMOVED ' + old));
    assert.ok(!fs.existsSync(old));
    assert.equal(run(h, ['--check']).code, 0);
    put(old, '#!/bin/sh\necho someone else\n');
    const q = run(h, []);
    assert.equal(q.code, 0);
    assert.ok(fs.existsSync(old), 'an unmanaged file at the old launcher path was removed');
    assert.ok(!q.stdout.includes(old));
  });

  test('a refused surface, a refused server or any refusal keeps the retired launcher; so does a config that names it', () => {
    const h = mkHome('home-legacy-refused');
    writeSource(h, sourceDoc());
    assert.equal(run(h, []).code, 0);
    const old = legacyFile(h);
    const t = targets(h);
    const doc = jload(t.kiro);
    doc.mcpServers['fake-secret'].command = old;
    doc.mcpServers['hand-b'] = { command: '/bin/true' };
    putJson(t.kiro, doc);
    writeSource(h, sourceDoc({ 'hand-b': { command: '/bin/echo', secrets: { B_TOKEN: 'env:B_SRC' } } }));
    const p = run(h, []);
    assert.equal(p.code, 3, p.all);
    assert.ok(p.stdout.includes('KEPT    ' + old));
    assert.ok(fs.existsSync(old));
    writeSource(h, sourceDoc());
    const hand = jload(t.kiro);
    delete hand.mcpServers['hand-b'];
    hand.mcpServers['hand-made'] = { command: old, args: ['--', '/bin/true'] };
    putJson(t.kiro, hand);
    const q = run(h, []);
    assert.equal(q.code, 0, q.all);
    assert.ok(q.stdout.includes('KEPT    ' + old + ' (the retired shell launcher; still named by ' + t.kiro + ')'));
    delete hand.mcpServers['hand-made'];
    putJson(t.kiro, hand);
    assert.ok(run(h, []).stdout.includes('REMOVED ' + old));
  });

  test('the active set never refuses on a node condition; the render does', () => {
    const d = /** @type {Map<string, any>} */ (loads(JSON.stringify({ servers: { s: { command: 'x', secrets: { A: 'env:B' } } } }), { ordered: true }));
    const ctx = { env: { HOME: BASE, MHW_NODE: path.join(BASE, 'no-such-node'), PATH: '' }, platform: process.platform, cwd: BASE, out: () => {}, err: () => {} };
    assert.deepEqual(M.launcherFor(d, ctx, false), ['node', M.launcherDest(ctx)]);
    assert.throws(() => M.launcherFor(d, ctx), (e) => e instanceof M.Refuse && e.code === 2);
    assert.equal(M.launcherFor(new Map([['servers', new Map()]]), ctx), null);
  });

  test('the stable node on PATH is rendered for the same file; a relative PATH entry renders absolute', { skip: !POSIX && 'a symbolic link to node' }, () => {
    const d = path.join(BASE, 'stable-bin');
    fs.mkdirSync(d, { recursive: true });
    const link = path.join(d, 'node');
    if (!fs.existsSync(link)) fs.symlinkSync(fs.realpathSync(NODE), link);
    const ctx = { env: { MHW_NODE: fs.realpathSync(NODE), PATH: d }, platform: process.platform, cwd: BASE, out: () => {}, err: () => {} };
    assert.equal(M.nodeBinary(ctx), link);
    assert.equal(M.nodeBinary({ ...ctx, env: { MHW_NODE: fs.realpathSync(NODE), PATH: path.join(BASE, 'empty-path') } }), fs.realpathSync(NODE));
    const rel = M.nodeBinary({ ...ctx, env: { PATH: 'stable-bin' } });
    assert.equal(rel, link);
    assert.ok(path.isAbsolute(/** @type {string} */ (rel)));
  });

  test('secrets without node are refused and nothing is written; an MHW_NODE that is not executable is refused', () => {
    const h = mkHome('home-no-node');
    writeSource(h, sourceDoc());
    const empty = path.join(BASE, 'empty-path');
    fs.mkdirSync(empty, { recursive: true });
    const env = cleanEnv(h, { PATH: empty });
    delete env.MHW_NODE;
    const before = fingerprint(h);
    const p = run(h, [], env);
    assert.equal(p.code, 2, p.all);
    assert.match(p.stderr, /no node was found/);
    assert.deepEqual(fingerprint(h), before);
    const plainDoc = sourceDoc();
    delete (/** @type {any} */ (plainDoc.servers))['fake-secret'];
    writeSource(h, plainDoc);
    assert.equal(run(h, [], env).code, 0, 'a definition without secrets needs no node');
    writeSource(h, sourceDoc());
    const bad = path.join(BASE, 'no-such-node');
    const b2 = fingerprint(h);
    const q = run(h, [], cleanEnv(h, { MHW_NODE: bad }));
    assert.equal(q.code, 2, q.all);
    assert.ok(q.stderr.includes('MHW_NODE (' + bad + ') is not an executable file'));
    assert.deepEqual(fingerprint(h), b2);
  });

  test('an invalid existing config is refused and untouched', () => {
    const h = mkHome('home-badjson');
    const t = targets(h);
    put(t['claude-code'], '{ "numStartups": ');
    put(t.codex, 'model = \n');
    writeSource(h, sourceDoc());
    const p = run(h, ['--surfaces=claude-code,codex']);
    assert.equal(p.code, 3);
    assert.equal(read(t['claude-code']), '{ "numStartups": ');
    assert.equal(read(t.codex), 'model = \n');
    put(t.codex, Buffer.from([0xff, 0x0a]).toString('latin1'));
    fs.writeFileSync(t.codex, Buffer.from([0xff, 0x0a]));
    assert.match(run(h, ['--surfaces=codex']).stderr, /unreadable \('utf-8' codec can't decode/);
  });

  test('an agent session may not write the real home, or redirect a write outside HOME', () => {
    const ctx = { env: {}, platform: process.platform, cwd: BASE, out: () => {}, err: () => {} };
    const inside = ['/h/throwaway/.codex/config.toml', '/h/throwaway/.local/share/x/mcp-launch.mjs'];
    const agent = { CLAUDECODE: '1' };
    if (POSIX) {
      assert.notEqual(M.ownerActRefusal('/h/real', ['/h/real/.codex/config.toml'], agent, '/h/real', ctx), null);
      assert.notEqual(M.ownerActRefusal('/h/real', [], { CODEX_SANDBOX: 'seatbelt' }, '/h/real', ctx), null);
      assert.notEqual(M.ownerActRefusal('/h', ['/h/.codex/config.toml'], agent, '/h/real', ctx), null);
      assert.notEqual(M.ownerActRefusal('/h/throwaway', [...inside, '/h/real/.codex/config.toml'], agent, '/h/real', ctx), null);
      assert.equal(M.ownerActRefusal('/h/throwaway', inside, agent, '/h/real', ctx), null);
    }
    assert.equal(M.ownerActRefusal('/h/real', ['/h/real/.codex/config.toml'], {}, '/h/real', ctx), null);
    for (const [v, rel] of [['CODEX_HOME', 'elsewhere-codex'], ['XDG_DATA_HOME', 'elsewhere-data']]) {
      const h = mkHome('home-redirect-' + v);
      const elsewhere = path.join(BASE, rel);
      fs.rmSync(elsewhere, { recursive: true, force: true });
      fs.mkdirSync(elsewhere);
      const src = writeSource(h, sourceDoc());
      const p = run(h, ['--source=' + src], cleanEnv(h, { CLAUDECODE: '1', [v]: elsewhere }));
      assert.equal(p.code, 2, p.all);
      assert.match(p.stderr, /outside HOME/);
    }
    const h = mkHome('home-agent-inside');
    writeSource(h, sourceDoc());
    assert.equal(run(h, [], cleanEnv(h, { CLAUDECODE: '1' })).code, 0, 'an agent may still render into a throwaway HOME');
  });

  test('usage errors and help', () => {
    const h = mkHome('home-usage');
    for (const args of [['--bogus'], ['--surfaces=vim'], ['--surfaces='], ['--policy', '--active'], ['--policy', '--mode=report'], ['--policy', '--stamp='], ['--policy', '--adopt'],
      ['--active', '--mode=report'], ['--active', '--stamp='], ['--active', '--adopt'], ['--active', '--mode=connect', '--timeout=0'], ['--active', '--mode=connect', '--timeout=x'],
      ['--active', '--mode=check', '--timeout=5'], ['--lib=paths', '--check']]) {
      assert.equal(run(h, args).code, 2, args.join(' '));
    }
    const help = run(h, ['--help']);
    assert.equal(help.code, 0);
    assert.match(help.stdout, /^usage: mhw mcp render/);
    assert.equal(spawnSync(NODE, [path.join(ROOT, 'bin', 'mhw.js'), 'mcp', 'render', '--help'], { env: cleanEnv(h), encoding: 'utf8' }).status, 0, 'mhw mcp render');
  });
});

// ------------------------------------------------------------------------------------------- secrets

// The render on every OS, with a definition that names no secret (secrets are refused on Windows): a
// fresh install, a clean check, an idempotent re-run, every surface's entries, and a refused secret.
group('render on every OS (no secret)', () => {
  /** @param {string} h */
  const noSecret = (h) => {
    const d = sourceDoc();
    delete (/** @type {any} */ (d.servers))['fake-secret'];
    return writeSource(h, d);
  };

  test('install, check and a re-run that changes nothing', () => {
    const h = mkHome('home-every-os');
    noSecret(h);
    const p = run(h, []);
    assert.equal(p.code, 0, p.all);
    const t = targets(h);
    const cx = tload(t.codex).mcp_servers;
    assert.deepEqual(Object.keys(cx), ['fake-plain', 'fake-codex-only']);
    assert.deepEqual(plain(cx['fake-plain']), { command: '/bin/echo', args: ['hello'], env: { FAKE_REGION: 'zz-1' } });
    assert.deepEqual(jload(t['claude-code']).mcpServers, { 'fake-plain': { type: 'stdio', command: '/bin/echo', args: ['hello'], env: { FAKE_REGION: 'zz-1' } } });
    assert.deepEqual(jload(t.kiro).mcpServers, { 'fake-plain': { command: '/bin/echo', args: ['hello'], env: { FAKE_REGION: 'zz-1' } } });
    assert.ok(!fs.existsSync(path.join(data(h), M.LAUNCHER_NAME)), 'no secret, no launcher');
    if (!POSIX) assert.ok(fs.readFileSync(t.codex, 'utf8').includes('\r\n'), 'Windows text mode writes \\r\\n, as Python did');
    assert.equal(run(h, ['--check']).code, 0);
    const before = fingerprint(h);
    assert.equal(run(h, []).code, 0);
    assert.deepEqual(fingerprint(h), before, 'a re-run changed a file');
  });

  test('a secret is refused on Windows and rendered elsewhere', () => {
    const h = mkHome('home-every-os-secret');
    writeSource(h, sourceDoc());
    const p = run(h, ['--dry-run']);
    if (POSIX) assert.equal(p.code, 0, p.all);
    else {
      assert.equal(p.code, 2);
      assert.match(p.stderr, /secrets are not supported on Windows/);
    }
  });
});

group('secrets', { skip: !POSIX && 'secrets are not rendered on Windows' }, () => {
  /** The rendered command line of fake-secret: node, the installed launcher (or script), pre, its arguments. @param {string} h @param {string[]} [pre] @param {string} [script] */
  const renderedLaunch = (h, pre = [], script = undefined) => {
    const cx = tload(targets(h).codex).mcp_servers['fake-secret'];
    assert.equal(cx.command, RENDERED);
    return [cx.command, script || cx.args[0], ...pre, ...cx.args.slice(1)];
  };

  test('env indirection renders names only, and the launched server gets the value', { skip: !POSIX && 'secrets are not rendered on Windows' }, () => {
    const h = mkHome('home-env-secret');
    const value = synth();
    writeSource(h, sourceDoc());
    assert.equal(run(h, [], cleanEnv(h, { FAKE_SRC_VAR: value })).code, 0);
    assert.ok(!allBytes(h).includes(value), 'a secret value is in a rendered file');
    fs.rmSync(OUT, { force: true });
    const launch = renderedLaunch(h);
    const p = spawnSync(launch[0], launch.slice(1), { env: cleanEnv(h, { FAKE_SRC_VAR: value }), encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    assert.equal(read(OUT), sha(value), 'the server did not receive the secret');
    assert.ok(!(p.stdout + p.stderr).includes(value));
    const q = spawnSync(launch[0], launch.slice(1), { env: cleanEnv(h), encoding: 'utf8' });
    assert.notEqual(q.status, 0);
    assert.match(q.stderr, /FAKE_SRC_VAR is not set/);
  });

  test('the file check can see a value when one is written (calibration)', () => {
    const h = mkHome('home-calibration');
    const value = synth();
    writeSource(h, sourceDoc({ 'fake-leaky': { command: '/bin/echo', env: { LEAKY_TOKEN: value }, not_secret: ['LEAKY_TOKEN'] } }));
    assert.equal(run(h, []).code, 0);
    assert.ok(allBytes(h).includes(value));
  });

  test('a keychain secret renders its service name only; the launcher reads it from the stub keychain', { skip: !DARWIN && 'keychain: sources are macOS only' }, () => {
    const h = mkHome('home-keychain');
    const value = synth();
    const env = cleanEnv(h);
    const kc = path.join(BASE, 'mcp-secret.keychain-db');
    fs.rmSync(kc, { force: true });
    const service = PROJECT + '.mcp-test-' + process.pid;
    const add = spawnSync(STUB, ['-i'], { input: 'create-keychain "' + kc + '"\nadd-generic-password -s "' + service + '" -a "t" -w "' + value + '" "' + kc + '"\n', env });
    assert.equal(add.status, 0, String(add.stderr));
    const doc = sourceDoc();
    /** @type {any} */ (doc.servers)['fake-secret'].secrets = { FAKE_API_TOKEN: 'keychain:' + service };
    writeSource(h, doc);
    const p = run(h, []);
    assert.equal(p.code, 0, p.all);
    assert.ok(!p.all.includes(value));
    assert.ok(read(targets(h).codex).includes(service), 'the Keychain service NAME is rendered');
    assert.ok(!read(targets(h).codex).includes(kc), 'the renderer never writes --keychain');
    assert.ok(!allBytes(h).includes(value));
    // The launcher's own main(), with security pointed at the stub (test/helpers/mcp-launch-driver.js).
    const args = renderedLaunch(h).slice(2);
    fs.rmSync(OUT, { force: true });
    const q = spawnSync(NODE, [DRIVER, STUB, '--keychain', kc, ...args], { env, encoding: 'utf8' });
    assert.equal(q.status, 0, q.stderr);
    assert.equal(read(OUT), sha(value));
    assert.ok(!(q.stdout + q.stderr).includes(value));
  });

  test('no secret value reaches a rendered file, on every parity case', { skip: noPy, timeout: 600000 }, () => {
    // Every env: source the cases name gets a synthetic value; every case is played on the head; no file
    // under its HOME may hold one. The calibration above shows the byte search finds a value that is written.
    const names = ['FAKE_SRC_VAR', 'S_SRC', 'B_SRC', 'C_SRC', 'SYNTH_SRC', 'V'];
    /** @type {Record<string, string>} */
    const values = Object.fromEntries(names.map((n) => [n, synth('synthetic-' + n)]));
    for (const c of CASES) {
      const base = fs.mkdtempSync(path.join(BASE, 'sec-'));
      const home = path.join(base, 'home');
      for (const d of c.dirs ?? ['.codex', '.claude', '.kiro']) fs.mkdirSync(path.join(home, d), { recursive: true });
      fs.mkdirSync(home, { recursive: true });
      const w = { home, data: data(home), base };
      c.setup?.(w);
      for (const step of c.steps) {
        step.pre?.(w);
        const env = cleanEnv(home, values);
        for (const [k, v] of Object.entries(step.env || {})) env[k] = v.replaceAll('<BASE>', base).replaceAll('<DATA>', w.data);
        for (const k of step.unset || []) delete env[k];
        const p = spawnSync(NODE, [RENDER, ...step.args.map((a) => a.replaceAll('<BASE>', base).replaceAll('<DATA>', w.data))], { env, encoding: 'utf8', cwd: base });
        for (const v of Object.values(values)) assert.ok(!(p.stdout + p.stderr).includes(v), c.name + ': a secret value was printed');
      }
      const blob = allBytes(home);
      for (const v of Object.values(values)) assert.ok(!blob.includes(v), c.name + ': a secret value is in a rendered file');
    }
  });
});

test('a backup is owner-only and never written through a link at its path', { skip: !POSIX && 'POSIX modes and links' }, () => {
  const d = path.join(BASE, 'backup-mode');
  fs.mkdirSync(d, { recursive: true });
  const p = path.join(d, 'config.toml');
  fs.writeFileSync(p, 'old = 1\n');
  fs.chmodSync(p, 0o640);
  const decoy = path.join(d, 'decoy');
  fs.writeFileSync(decoy, 'decoy\n');
  fs.rmSync(p + '.pmhwc-backup', { force: true });
  fs.symlinkSync(decoy, p + '.pmhwc-backup');
  M.atomicWrite(p, 'new = 2\n', true);
  assert.ok(!fs.lstatSync(p + '.pmhwc-backup').isSymbolicLink());
  assert.equal(mode(p + '.pmhwc-backup'), 0o600);
  assert.equal(read(p + '.pmhwc-backup'), 'old = 1\n');
  assert.equal(read(decoy), 'decoy\n');
  assert.equal(mode(p), 0o640);
  assert.equal(read(p), 'new = 2\n');
});

// ---------------------------------------------------------------------------------------------- scan

group('scan', () => {
  test('scan lists key names and never a value', () => {
    const h = mkHome('home-scan');
    const t = targets(h);
    const vals = Array.from({ length: 6 }, (_, i) => synth('synthetic-' + i));
    put(t.codex, '[mcp_servers.svc-a]\ncommand = "x"\nargs = ["--api-key", "' + vals[0] + '"]\nenv = { SVC_TOKEN = "' + vals[1] + '", REGION = "eu" }\n\n[mcp_servers.svc-r]\nurl = "https://h/mcp"\nbearer_token = "' + vals[2] + '"\n');
    putJson(t.kiro, { mcpServers: { 'svc-b': { command: 'x', args: ['--password=' + vals[3]], headers: { Authorization: vals[4] } }, 'svc-u': { url: 'https://h/mcp?access_token=' + vals[5] } } });
    fs.copyFileSync(t.kiro, t.kiro + '.pmhwc-backup');
    fs.copyFileSync(t.kiro, t.kiro + '.new.4242');
    putJson(t['claude-code'], { mcpServers: { 'svc-c': { command: 'x', env: { SETTING: 'gh' + 'p_' + 'W'.repeat(36) } } } });
    put(t['claude-code'] + '.pmhwc-mcp-policy-backup', '[1]');
    const p = run(h, ['--scan']);
    assert.equal(p.code, 0, p.stderr);
    for (const v of vals) assert.ok(!p.all.includes(v));
    for (const e of ['svc-a\targs[0] --api-key <value>', 'svc-a\tenv.SVC_TOKEN', 'svc-r\tbearer_token', 'svc-b\targs[0] --password=<value>', 'svc-b\theaders.Authorization', 'svc-u\turl (', 'svc-c\tenv.SETTING']) {
      assert.ok(p.stdout.includes(e), e);
    }
    assert.ok(!p.stdout.includes('REGION'));
    assert.ok(p.stdout.includes('backup\t' + t.kiro + '.pmhwc-backup'));
    assert.ok(p.stdout.includes('temp\t' + t.kiro + '.new.4242'));
    assert.ok(p.stdout.includes('unreadable (AttributeError)'));
    assert.ok(!p.all.includes('W'.repeat(36)));
  });

  test('scan is owner-run only', () => {
    const h = mkHome('home-scan-agent');
    const p = run(h, ['--scan'], cleanEnv(h, { CLAUDECODE: '1' }));
    assert.equal(p.code, 2);
    assert.match(p.stderr, /owner-run only/);
  });

  test('scanServer and describe, unit rows', () => {
    assert.deepEqual(M.scanServer(3), []);
    assert.deepEqual(M.scanServer({ args: ['--token', '-x'], nested: { deep: { api_key: 'v' } } }), ['nested.deep.api_key']);
    assert.equal(M.describe(null), 'absent');
    assert.equal(M.describe([]), 'present (not an object)');
    assert.equal(M.describe({ command: '/bin/echo', args: ['a b'] }), "/bin/echo 'a b'");
    assert.equal(M.describe({ command: "it's", args: [''] }), "'it'\"'\"'s' ''");
    assert.equal(M.describe({ command: 'x', env: { A: 'secret-value' } }), 'x (env: 1 value(s), not shown)');
    const value = synth();
    for (const e of [{ command: 'x', args: ['--api-key', value] }, { command: 'x', args: ['--password=' + value] }, { command: 'x', args: ['gh' + 'p_' + 'Z'.repeat(36)] }, { command: 'x', args: ['https://u:' + value + '@h/'] }]) {
      const got = M.describe(e);
      assert.equal(got, 'present (not shown: it looks like it carries a credential)');
      assert.ok(!got.includes(value));
    }
  });
});

// -------------------------------------------------------------------------------------------- policy

group('the policy servers (ADR-0038)', () => {
  test('the policy file pins the package and fails closed', () => {
    const doc = plain(M.loadPolicy());
    assert.deepEqual(Object.keys(doc.servers), ['chrome-devtools']);
    const s = doc.servers['chrome-devtools'];
    assert.deepEqual(s.surfaces, ['claude-code']);
    assert.equal(s.command, '/bin/sh');
    const script = s.args[1];
    assert.match(script, /exec npx --ignore-scripts -y chrome-devtools-mcp@\d+\.\d+\.\d+ /);
    const launch = JSON.stringify([s.command, ...s.args]);
    assert.ok(!launch.includes('allowedUrlPattern'));
    assert.ok(!launch.includes('HARNESS_SWEEP_ORIGIN'));
    assert.ok(script.split(' ').includes('--autoConnect'));
    assert.ok(!script.includes('$'));
    const argv = script.split(' ');
    assert.equal(argv[argv.indexOf('--channel') + 1], 'stable');
    for (const gone of ['--isolated', '--viewport', '--browserUrl', '--wsEndpoint', '--userDataDir', '--executablePath', '--headless']) assert.ok(!script.includes(gone), gone);
    assert.ok(!JSON.stringify(s).includes('${'));
  });

  test('the launch script attaches with no origin bound, whatever the environment holds', { skip: !POSIX && '/bin/sh' }, () => {
    const d = path.join(BASE, 'policy-fake-npx');
    fs.mkdirSync(d, { recursive: true });
    const log = path.join(d, 'argv.txt');
    fs.writeFileSync(path.join(d, 'npx'), '#!/bin/sh\nfor a in "$@"; do printf "%s\\n" "$a"; done > "' + log + '"\n', { mode: 0o700 });
    const e = plain(policyEntry());
    const want = ['--ignore-scripts', '-y', 'chrome-devtools-mcp@1.8.0', '--autoConnect', '--channel', 'stable', '--no-usage-statistics', '--no-performance-crux'];
    for (const value of [null, '', 'https://site.example/*', 'https://a.example/* ; touch x', '--remote-debugging-port=9222']) {
      /** @type {Record<string, string>} */
      const env = { PATH: d + ':/usr/bin:/bin' };
      if (value !== null) env.HARNESS_SWEEP_ORIGIN = value;
      const p = spawnSync(e.command, e.args, { env, cwd: d, encoding: 'utf8' });
      assert.equal(p.status, 0, p.stderr);
      assert.deepEqual(read(log).split('\n').filter(Boolean), want, String(value));
    }
    assert.ok(!fs.existsSync(path.join(d, 'x')));
  });

  test('install writes old -> new with a private backup, and uninstall removes', { skip: !POSIX && 'not rendered on Windows' }, () => {
    const h = mkHome('home-policy');
    const cfg = targets(h)['claude-code'];
    putJson(cfg, { numStartups: 7, mcpServers: { mine: { command: '/bin/echo' } } });
    fs.chmodSync(cfg, 0o640);
    const seed = read(cfg);
    let p = policy(h, 'check');
    assert.equal(p.code, 1);
    assert.match(p.stdout, /DRIFT/);
    p = policy(h, 'install');
    assert.equal(p.code, 0, p.stderr);
    assert.ok(p.stdout.includes('CHANGED ' + cfg + ': chrome-devtools absent -> /bin/sh -c '));
    const got = jload(cfg);
    assert.deepEqual(got.mcpServers['chrome-devtools'], plain(policyEntry()));
    assert.deepEqual(got.mcpServers.mine, { command: '/bin/echo' });
    assert.equal(got.numStartups, 7);
    assert.equal(read(cfg + M.POLICY_BACKUP), seed);
    assert.equal(mode(cfg + M.POLICY_BACKUP), 0o600);
    assert.equal(mode(cfg), 0o640, 'the config keeps its own mode');
    const before = fingerprint(h);
    assert.match(policy(h, 'install').stdout, /OK {6}/);
    assert.deepEqual(fingerprint(h), before);
    assert.equal(policy(h, 'check').code, 0);
    const s = run(h, ['--policy', '--mode=check', '--stamp=release: other; commit: other']);
    assert.equal(s.code, 1);
    assert.match(s.stdout, /STAMP/);
    p = policy(h, 'uninstall');
    assert.equal(p.code, 0, p.stderr);
    assert.match(p.stdout, / -> absent/);
    assert.ok(!('chrome-devtools' in jload(cfg).mcpServers));
    assert.ok(!fs.existsSync(manifest(h)), 'a manifest that recorded only the policy goes');
    assert.equal(policy(h, 'uninstall').code, 0);
  });

  test('dry run writes nothing; a surface not installed is skipped; Windows renders nothing', () => {
    const h = mkHome('home-policy-dry');
    const before = fingerprint(h);
    const p = policy(h, 'dry-run');
    assert.equal(p.code, 0, p.stderr);
    if (POSIX) assert.match(p.stdout, /WOULD CHANGE/);
    else assert.match(p.stdout, /not rendered on Windows/);
    assert.deepEqual(fingerprint(h), before);
    const none = path.join(BASE, 'home-policy-none');
    fs.mkdirSync(none, { recursive: true });
    const q = policy(none, 'install');
    assert.equal(q.code, 0);
    assert.match(q.stdout, /SKIP/);
    assert.ok(!fs.existsSync(path.join(none, '.claude.json')));
  });

  test('a hand server of the same name, or an unreadable config, is refused and untouched', { skip: !POSIX && 'not rendered on Windows' }, () => {
    const h = mkHome('home-policy-hand');
    const cfg = targets(h)['claude-code'];
    putJson(cfg, { mcpServers: { 'chrome-devtools': { command: 'npx', args: ['chrome-devtools-mcp@latest'] } } });
    const seed = read(cfg);
    const p = policy(h, 'install');
    assert.equal(p.code, 3);
    assert.match(p.stderr, /not written by mhw/);
    assert.equal(read(cfg), seed);
    assert.ok(!fs.existsSync(cfg + M.POLICY_BACKUP));
    put(cfg, '{ nope');
    assert.match(policy(h, 'install').stderr, /not readable JSON \(JSONDecodeError\)/);
    put(cfg, '[1]');
    assert.match(policy(h, 'install').stderr, /not a JSON object with an mcpServers object/);
  });

  test('the local definition and the policy never remove each other', { skip: !POSIX && 'not rendered on Windows' }, () => {
    const h = mkHome('home-policy-both');
    const cfg = targets(h)['claude-code'];
    writeSource(h, sourceDoc());
    assert.equal(run(h, ['--surfaces=claude-code']).code, 0);
    assert.equal(policy(h, 'install').code, 0);
    assert.equal(run(h, ['--surfaces=claude-code']).code, 0);
    let names = Object.keys(jload(cfg).mcpServers);
    for (const n of ['chrome-devtools', 'fake-plain', 'fake-secret']) assert.ok(names.includes(n), n);
    assert.equal(run(h, ['--check', '--surfaces=claude-code']).code, 0);
    assert.equal(policy(h, 'check').code, 0);
    assert.equal(policy(h, 'uninstall').code, 0);
    names = Object.keys(jload(cfg).mcpServers);
    assert.ok(!names.includes('chrome-devtools'));
    assert.ok(names.includes('fake-plain'));
    assert.ok(fs.existsSync(manifest(h)));
    assert.equal(run(h, ['--check', '--surfaces=claude-code']).code, 0);
  });

  test('a policy server that names a secret, Codex or no surfaces is refused', () => {
    const d = path.join(BASE, 'policy-invalid');
    fs.mkdirSync(d, { recursive: true });
    for (const bad of [{ command: 'x', surfaces: ['claude-code'], secrets: { A_TOKEN: 'env:B' } }, { command: 'x', surfaces: ['codex'] }, { command: 'x' }]) {
      const p = path.join(d, 'p.json');
      putJson(p, { version: 1, servers: { s: bad } });
      assert.throws(() => M.loadPolicy(p), (e) => e instanceof M.Refuse && e.code === 2);
    }
    assert.throws(() => M.loadPolicy(path.join(d, 'absent.json')), /cannot read the policy MCP servers/);
  });
});

group('policy extension (render)', { skip: !POSIX && 'the policy is not rendered on Windows' }, () => {
  test('an identical copy renders on the other surfaces and never on the policy\'s', { skip: !POSIX && 'the policy is not rendered on Windows' }, () => {
    const h = mkHome('home-ext');
    writeSource(h, sourceDoc({ 'chrome-devtools': policyCopy() }));
    let p = run(h, []);
    assert.equal(p.code, 0, p.all);
    assert.ok(p.stdout.includes('POLICY  claude-code: chrome-devtools rendered here by the policy servers (mhw mcp render --policy'));
    assert.ok(!('chrome-devtools' in jload(targets(h)['claude-code']).mcpServers));
    assert.equal(policy(h, 'install').code, 0);
    p = run(h, []);
    assert.equal(p.code, 0, p.all);
    const ps = M.get(M.loadPolicy(), 'servers').get('chrome-devtools');
    assert.deepEqual(plain(tload(targets(h).codex).mcp_servers['chrome-devtools']), plain(M.entry('codex', ps, null)));
    assert.deepEqual(jload(targets(h).kiro).mcpServers['chrome-devtools'], plain(M.entry('kiro', ps, null)));
    const m = jload(manifest(h));
    assert.ok(!(m.surfaces['claude-code'] || []).includes('chrome-devtools'));
    assert.deepEqual(m.policy['claude-code'], ['chrome-devtools']);
    assert.equal(run(h, ['--check']).code, 0);
    assert.equal(policy(h, 'uninstall').code, 0);
    assert.ok('chrome-devtools' in jload(targets(h).kiro).mcpServers);
    assert.equal(run(h, ['--check']).code, 0);
  });

  test('a name recorded on a policy surface is never removed by the local mode', () => {
    const h = mkHome('home-ext-legacy');
    assert.equal(policy(h, 'install').code, 0);
    const m = jload(manifest(h));
    m.surfaces = { 'claude-code': ['chrome-devtools'] }; // recorded by the local mode of an earlier release
    putJson(manifest(h), m);
    writeSource(h, sourceDoc());
    const p = run(h, ['--surfaces=claude-code']);
    assert.equal(p.code, 0, p.all);
    assert.deepEqual(jload(targets(h)['claude-code']).mcpServers['chrome-devtools'], plain(policyEntry()));
    assert.ok(!jload(manifest(h)).surfaces['claude-code'].includes('chrome-devtools'));
    assert.equal(policy(h, 'check').code, 0);
  });

  test('a differing copy is refused alone; an earlier copy is kept; leaving the policy surface out renders it', () => {
    const h = mkHome('home-ext-conflict');
    const different = policyCopy({ args: ['-c', 'exec /bin/echo synthetic'] });
    writeSource(h, sourceDoc({ 'chrome-devtools': different }));
    let p = run(h, []);
    assert.equal(p.code, 3, p.all);
    assert.match(p.stderr, /REFUSE {2}chrome-devtools: a policy server/);
    assert.ok(!('chrome-devtools' in tload(targets(h).codex).mcp_servers));
    assert.ok('fake-plain' in jload(targets(h).kiro).mcpServers);
    writeSource(h, sourceDoc({ 'chrome-devtools': policyCopy() }));
    assert.equal(run(h, []).code, 0);
    const kiroBefore = jload(targets(h).kiro).mcpServers['chrome-devtools'];
    const codexBefore = plain(tload(targets(h).codex).mcp_servers['chrome-devtools']);
    writeSource(h, sourceDoc({ 'chrome-devtools': different, 'fake-new': { command: '/bin/echo' } }));
    p = run(h, []);
    assert.equal(p.code, 3);
    assert.deepEqual(jload(targets(h).kiro).mcpServers['chrome-devtools'], kiroBefore);
    assert.deepEqual(plain(tload(targets(h).codex).mcp_servers['chrome-devtools']), codexBefore);
    assert.ok('fake-new' in tload(targets(h).codex).mcp_servers);
    assert.equal(run(h, ['--check']).code, 3);
    writeSource(h, sourceDoc({ 'chrome-devtools': { ...different, surfaces: ['codex', 'kiro'] } }));
    assert.equal(run(h, []).code, 0);
    assert.deepEqual(plain(tload(targets(h).codex).mcp_servers['chrome-devtools']), plain(M.entry('codex', different, null)));
  });
});

// The two probes of the real Codex binary (the deleted suite skipped them where codex is not on PATH).
const CODEX = which('codex');
group('the real Codex binary reads what was rendered', { skip: !CODEX && 'codex is not on PATH: the rendered config.toml was not parsed by Codex here' }, () => {
  test('codex mcp list parses the rendered config', () => {
    const h = mkHome('home-codex');
    put(targets(h).codex, 'model = "some-model"\n\n[projects."/tmp/x"]\ntrust_level = "trusted"\n');
    writeSource(h, sourceDoc());
    assert.equal(run(h, []).code, 0);
    const p = spawnSync(/** @type {string} */ (CODEX), ['mcp', 'list', '--json'], { env: cleanEnv(h, { CODEX_HOME: path.join(h, '.codex') }), encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    const got = Object.fromEntries(JSON.parse(p.stdout).map((/** @type {any} */ x) => [x.name, x.transport]));
    assert.deepEqual(Object.keys(got).sort(cmpNames), ['fake-codex-only', 'fake-plain', 'fake-secret']);
    assert.equal(got['fake-secret'].args[0], path.join(data(h), M.LAUNCHER_NAME));
    assert.deepEqual(got['fake-secret'].env_vars, ['FAKE_SRC_VAR']);
    assert.deepEqual(got['fake-plain'].env, { FAKE_REGION: 'zz-1' });
  });

  test('codex mcp list shows the active set\'s switch', { skip: noPy }, () => {
    const h = mkHome('home-active-codex');
    activeHome({ home: h, data: data(h), base: BASE });
    assert.equal(active(h, 'install').code, 0);
    const p = spawnSync(/** @type {string} */ (CODEX), ['mcp', 'list', '--json'], { env: cleanEnv(h, { CODEX_HOME: path.join(h, '.codex') }), encoding: 'utf8' });
    assert.equal(p.status, 0, p.stderr);
    const listed = Object.fromEntries(JSON.parse(p.stdout).map((/** @type {any} */ x) => [x.name, x.enabled]));
    assert.deepEqual(listed, { 'set-a': true, 'out-b': false, 'out-c': false, 'own-off': false, node_repl: true });
  });
});
/** @param {string} a @param {string} b */
const cmpNames = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------- the real security binary (CI only)
// ADR-0017's evidence against the real /usr/bin/security (the 2026-10-05 amendment; the Python suite
// carried it until #484). It runs ONLY with PMHWC_REAL_KEYCHAIN_TESTS=1 on a GitHub Actions macOS runner,
// which is ephemeral; tests.yml sets the variable there and nowhere else. Every call is checked before it
// runs: an allowed verb only, against a throwaway keychain FILE this test creates under RUNNER_TEMP, with a
// throwaway HOME under the same directory, never the login or default keychain or the search list. The
// production launcher installed by the renderer (mcp-launch.mjs, which names /usr/bin/security itself) is
// what reads the secret.
const REAL_OPT_IN = process.env.PMHWC_REAL_KEYCHAIN_TESTS === '1' && process.env.GITHUB_ACTIONS === 'true' && DARWIN
  && !!process.env.RUNNER_TEMP && path.isAbsolute(process.env.RUNNER_TEMP);
const REAL_SECURITY = '/usr/bin/security';
const REAL_VERBS = new Set(['create-keychain', 'delete-keychain', 'add-generic-password', 'delete-generic-password']);

/**
 * Run the real security binary once, refused unless every argument stays inside the throwaway base.
 * @param {string} base @param {string[]} args @param {Record<string, string>} env @param {string} [input] for -i
 */
function realSecurity(base, args, env, input) {
  assert.ok(REAL_OPT_IN, 'the real security binary runs only under the CI opt-in');
  const why = realSecurityRefusal(base, args, env, input);
  assert.equal(why, null, 'refused before it ran: ' + why);
  return spawnSync(REAL_SECURITY, args, { env, input, encoding: 'utf8' });
}

/**
 * os.path.realpath: the longest existing prefix resolved by the OS (symbolic links followed), the rest
 * appended as written.
 * @param {string} p
 */
function realpathOf(p) {
  let head = path.resolve(p);
  /** @type {string[]} */
  const tail = [];
  for (;;) {
    try {
      return path.join(fs.realpathSync.native(head), ...tail);
    } catch {
      if (path.dirname(head) === head) return path.join(head, ...tail);
      tail.unshift(path.basename(head));
      head = path.dirname(head);
    }
  }
}

/**
 * True when p, symbolic links resolved, is base or a path below it, by whole path components (the Python
 * guard's os.path.commonpath over realpath): a sibling sharing base's prefix is outside.
 * @param {string} base @param {string | undefined} p
 */
function underBase(base, p) {
  if (!p || !path.isAbsolute(p)) return false;
  const rel = path.relative(realpathOf(base), realpathOf(p));
  return rel === '' || (rel !== '..' && !rel.startsWith('..' + path.sep) && !path.isAbsolute(rel));
}

/**
 * Why the real security binary may not run this call, or null: an allowed verb only, its keychain FILE (the
 * last argument, or each -i line's last quoted operand) under base, and a HOME under base. The guard
 * realSecurity() applies it; it runs without the opt-in, so the rules are tested everywhere.
 * @param {string} base @param {string[]} args @param {Record<string, string | undefined>} env @param {string} [input]
 * @returns {string | null}
 */
function realSecurityRefusal(base, args, env, input) {
  if (!underBase(base, env.HOME)) return 'HOME is not a throwaway one under the base';
  if (args.length === 1 && args[0] === '-i') {
    const lines = String(input ?? '').split('\n').filter(Boolean);
    if (!lines.length) return 'a -i run with no line';
    for (const l of lines) {
      if (!REAL_VERBS.has(l.split(' ')[0])) return 'a -i line with a verb outside the rules';
      if (!l.endsWith('"') || !underBase(base, l.slice(0, -1).split('"').at(-1))) return 'a -i line whose keychain is outside the base';
    }
    return null;
  }
  if (!REAL_VERBS.has(args[0])) return 'a verb outside the rules: ' + args[0];
  if (!underBase(base, args.at(-1))) return 'a keychain outside the base';
  return null;
}

group('the real security binary (PMHWC_REAL_KEYCHAIN_TESTS=1, GitHub Actions macOS only)', { skip: !REAL_OPT_IN && 'the CI opt-in is not set here: the real binary and the real Keychain are never used outside the ephemeral macOS runner' }, () => {
  test('a keychain secret reaches only the server; a deleted item exits 3; a non-printable value is refused', () => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(/** @type {string} */ (process.env.RUNNER_TEMP), 'mhw-real-keychain-')));
    const h = path.join(base, 'home');
    for (const d of ['.codex', '.claude', '.kiro']) fs.mkdirSync(path.join(h, d), { recursive: true });
    const env = cleanEnv(h);
    const kc = path.join(base, 'mcp-secret.keychain-db');
    const service = PROJECT + '.mcp-real-test-' + process.pid;
    const value = synth();
    const account = 'mhw-test';
    try {
      assert.equal(realSecurity(base, ['create-keychain', '-p', synth('throwaway-pw'), kc], env).status, 0, 'the throwaway keychain is not created');
      const add = 'add-generic-password -s "' + service + '" -a "' + account + '" -w "' + value + '" "' + kc + '"\n';
      assert.equal(realSecurity(base, ['-i'], env, add).status, 0, 'the throwaway keychain is not writable');
      const doc = sourceDoc();
      /** @type {any} */ (doc.servers)['fake-secret'].secrets = { FAKE_API_TOKEN: 'keychain:' + service };
      writeSource(h, doc);
      const p = run(h, [], env);
      assert.equal(p.code, 0, p.all);
      assert.ok(!p.all.includes(value));
      assert.ok(!allBytes(h).includes(value), 'a secret value is in a rendered file');
      const cx = tload(targets(h).codex).mcp_servers['fake-secret'];
      const launch = [cx.args[0], '--keychain', kc, ...cx.args.slice(1)];
      fs.rmSync(OUT, { force: true });
      const ok = spawnSync(cx.command, launch, { env, encoding: 'utf8' });
      assert.equal(ok.status, 0, ok.stderr);
      assert.equal(read(OUT), sha(value), 'the server did not receive the secret');
      assert.ok(!(ok.stdout + ok.stderr).includes(value), 'the launcher printed the secret');
      assert.equal(realSecurity(base, ['delete-generic-password', '-s', service, '-a', account, kc], env).status, 0);
      const gone = spawnSync(cx.command, launch, { env, encoding: 'utf8' });
      assert.equal(gone.status, 3, 'the launcher started a server after its Keychain item was deleted');
      assert.match(gone.stderr, /no readable Keychain item/);
      assert.ok(!gone.stderr.includes(value));
      // A non-printable value: the real `security -w` would hand it over hex-encoded, so the launcher refuses.
      const hex = 'add-generic-password -s "' + service + '" -a "' + account + '" -X "0001ff41" "' + kc + '"\n';
      assert.equal(realSecurity(base, ['-i'], env, hex).status, 0);
      const bin = spawnSync(cx.command, launch, { env, encoding: 'utf8' });
      assert.equal(bin.status, 3, bin.stderr);
      assert.match(bin.stderr, /not printable text/);
    } finally {
      if (fs.existsSync(kc)) realSecurity(base, ['delete-keychain', kc], env);
    }
    assert.ok(!fs.existsSync(kc), 'the throwaway keychain was not deleted');
  });
});

test('the real-binary arm refuses itself without the opt-in', { skip: REAL_OPT_IN && 'the opt-in is set here' }, () => {
  const base = path.join(BASE, 'real-guard');
  assert.throws(() => realSecurity(base, ['create-keychain', '-p', 'x', path.join(base, 'k.keychain-db')], { HOME: path.join(base, 'h') }), /only under the CI opt-in/);
});

test("the real-binary guard's rules, one row each (they run without the opt-in)", { skip: !POSIX && 'POSIX paths and symbolic links' }, () => {
  // agents-lead lens B3 on PR #520: the rules are a pure function, tested here without the real binary.
  const base = fs.realpathSync(fs.mkdtempSync(path.join(BASE, 'real-guard-')));
  const home = path.join(base, 'home');
  const kc = path.join(base, 'k.keychain-db');
  const outsideDir = fs.mkdtempSync(path.join(BASE, 'real-guard-outside-'));
  const link = path.join(base, 'escape');
  fs.symlinkSync(outsideDir, link);
  const sibling = base + '-sibling';
  const line = (/** @type {string} */ verb, /** @type {string} */ k) => verb + ' -s "svc" -a "t" -w "v" "' + k + '"\n';
  /** @type {Array<[string, string[], Record<string, string>, string | undefined, boolean]>} name, args, env, -i input, allowed */
  const rows = [
    ['an allowed call inside the base', ['create-keychain', '-p', 'x', kc], { HOME: home }, undefined, true],
    ['an allowed -i line inside the base', ['-i'], { HOME: home }, line('add-generic-password', kc), true],
    ['a keychain outside the base', ['create-keychain', '-p', 'x', path.join(outsideDir, 'k.keychain-db')], { HOME: home }, undefined, false],
    ['a -i line whose keychain is outside', ['-i'], { HOME: home }, line('add-generic-password', path.join(outsideDir, 'k.keychain-db')), false],
    ['a -i line with a verb that is not allowed', ['-i'], { HOME: home }, 'list-keychains -s "' + kc + '"\n', false],
    ['a verb that is not allowed', ['find-generic-password', '-s', 'svc', '-w', kc], { HOME: home }, undefined, false],
    ['HOME outside the base', ['create-keychain', '-p', 'x', kc], { HOME: outsideDir }, undefined, false],
    ['a symbolic link inside the base that points out', ['create-keychain', '-p', 'x', path.join(link, 'k.keychain-db')], { HOME: home }, undefined, false],
    ['HOME through a symbolic link that points out', ['create-keychain', '-p', 'x', kc], { HOME: path.join(link, 'home') }, undefined, false],
    ['a sibling directory sharing the base prefix', ['create-keychain', '-p', 'x', path.join(sibling, 'k.keychain-db')], { HOME: home }, undefined, false],
    ['a .. walk out of the base', ['create-keychain', '-p', 'x', path.join(base, '..', path.basename(outsideDir), 'k.keychain-db')], { HOME: home }, undefined, false],
    ['a relative keychain path', ['create-keychain', '-p', 'x', 'k.keychain-db'], { HOME: home }, undefined, false],
    ['a -i run with no line', ['-i'], { HOME: home }, '', false],
  ];
  for (const [name, args, env, input, allowed] of rows) {
    assert.equal(realSecurityRefusal(base, args, env, input) === null, allowed, name);
  }
});

// ------------------------------------------------------------------------- the credential oracle (#484)

/** sha256 of the inputs as JSON, so the golden pins them without holding any. @param {unknown} inputs */
function inputsDigest(inputs) {
  return crypto.createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

/** The oracle's inputs: named cases and a deterministic generated set, by detector. */
function oracleInputs() {
  const odd = ['\x1c', '\x1d', '\x1e', '\x1f', '\x85', '\ufeff', '\u00a0', '\u2028', '\u0130', '\u0131', '\u212a', '\u017f', ' ', '\t'];
  /** @param {string} alphabet @param {string} seed @param {number} n @param {number} len */
  const gen = (alphabet, seed, n, len) => {
    const chars = Array.from(alphabet);
    /** @type {string[]} */
    const out = [];
    for (let i = 0; i < n; i++) {
      const bytes = crypto.createHash('sha256').update(seed + i).digest();
      out.push([...bytes].slice(0, len).map((b) => chars[b % chars.length]).join(''));
    }
    return out;
  };
  const url = ['https://u:p@h/', 'https://u:@h/', 'https://:p@h/', 'https://u@h/', 'https://u:p/h@x', 'https://u p:q@h', 'http://a:b:c@h', 'x://:a:@h',
    'https://h/?token=1', 'https://h/?Token=1', 'https://h/?a=1&api_key=2', 'https://h/?apikey', 'https://h/?x.auth-y=1', 'https://h/?pre-passwd=1',
    'https://h/x?mytoken', '?secret=', '&k=1', '?key=', '?ke y=1', '://a:b@', ':// a:b@', 'no url at all', '',
    ...odd.flatMap((c) => ['https://u' + c + ':p@h', 'https://u:p' + c + '@h', 'https://h/?api' + c + 'key=1', 'https://h/?' + c + 'token=1', '?to' + c + 'ken=1']),
    ...gen(':/@?&=. akstpe-_\u0130\u0131\u212a\u017f\x85\ufeff', 'url', 200, 14)];
  const value = ['Bearer ' + 'a'.repeat(9), 'Bearer short', 'x-token: v', 'Cookie:v', 'authorization: x', 'api-key:\tv', 'secret :v', 'password:',
    'basic ' + 'Zm9vOmJhcg=='.repeat(2), 'token ' + 'a'.repeat(8), 'xtoken ' + 'a'.repeat(8), '-----BEGIN ' + 'PRIVATE KEY-----', '-----BEGIN RSA ' + 'PRIVATE KEY-----',
    'gh' + 'p_' + 'a'.repeat(20), 'xgh' + 'p_' + 'a'.repeat(20), '\u00e9gh' + 'p_' + 'a'.repeat(20), 'sk' + '-' + 'a'.repeat(16), 'AK' + 'IA' + 'A'.repeat(16),
    ...odd.flatMap((c) => ['Bearer' + c + 'a'.repeat(9), 'Bearer ' + c.repeat(8), 'tok' + c + 'en: v', 'secret' + c + ': v', 'authorization:' + c, 'authorization: ' + c + 'x',
      'token aaaaaaa' + c, 'bearer ' + 'b'.repeat(4) + c + 'b'.repeat(4), c + 'basic ' + 'c'.repeat(9), 'coo' + c + 'kie:x', 'pa' + c + 'ssword:x']),
    ...gen('abeknorst :\u0130\u0131\u212a\u017f\x85\ufeff\x1c=', 'value', 200, 16)];
  const name = ['API_KEY', 'api-key', 'MY_TOKEN', 'SESSION_ID', 'X_PAT', 'PAT', 'PATH', 'KEYS', 'MONKEY', 'A_KEY_B', 'KEY\n', 'REGION', 'auth_mode',
    ...odd.flatMap((c) => ['TO' + c + 'KEN', 'A' + c + 'KEY', 'KEY' + c, 'secret' + c, 'P' + c + 'T']),
    'ap\u0130_key', 'ap\u0131_key', 'to\u212aen', '\u017fecret', 'pa\u017f\u017fword', 'cooK\u0131e',
    ...gen('ACEIKNOPSTY_.-\u0130\u0131\u212a\u017f', 'name', 150, 8)];
  return { url, value, name };
}

/**
 * What the deleted mcp_render.py's own patterns answer, in the python3 on PATH. The patterns are copied
 * verbatim from global/mcp/mcp_render.py at the base revision of #484.
 * @param {{ url: string[], value: string[], name: string[] }} inputs
 */
function cpythonAnswers(inputs) {
  const script = String.raw`import json, re, sys
CRED_RE = re.compile(r"(TOKEN|SECRET|PASSW(OR)?D|PASSPHRASE|PWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|"
                     r"CLIENT[_-]?KEY|CREDENTIAL|AUTH|BEARER|COOKIE|SESSION|DSN|SIGNATURE|"
                     r"(^|[_.-])(PAT|KEY|KEYS|APIKEY|CERT)([_.-]|$))", re.I)
URL_CRED_RE = re.compile(r"(://[^/@\s]+:[^/@\s]+@)|([?&][A-Za-z0-9_.-]*(token|key|secret|passw|auth)[A-Za-z0-9_.-]*=)", re.I)
VALUE_CRED_RES = (
    URL_CRED_RE,
    re.compile(r"(authorization|proxy-authorization|x-api-key|api[-_]?key|[a-z-]*token|secret|password|cookie)"
               r"\s*:\s*\S", re.I),
    re.compile(r"\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}", re.I),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|"
               r"sk-[A-Za-z0-9_-]{16,}|(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}|xox[abposr]-[A-Za-z0-9-]{10,}|"
               r"AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|npm_[A-Za-z0-9]{30,})"),
)
d = json.load(sys.stdin)
print(json.dumps({"url": [bool(URL_CRED_RE.search(s)) for s in d["url"]],
                  "value": [any(rx.search(s) for rx in VALUE_CRED_RES) for s in d["value"]],
                  "name": [bool(CRED_RE.search(s)) for s in d["name"]]}))
`;
  const p = spawnSync(/** @type {string} */ (PY), ['-I', '-c', script], { input: JSON.stringify(inputs), encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return JSON.parse(p.stdout);
}
