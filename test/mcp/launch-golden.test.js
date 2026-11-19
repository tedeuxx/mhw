// S12 parity (#483, convention 3 of #470): `mhw mcp launch` against the deleted global/mcp/mcp-launch.sh,
// and global/mcp/mcp_render.py's output against the base revision's, whose rendered command named the
// shell launcher. Throwaway HOMEs and SYNTHETIC values only; keychain: cases use the Node security stub
// on both sides (the base launcher through a copy whose /usr/bin/security is the stub, the head through
// test/helpers/mcp-launch-driver.js), never the real binary or Keychain.
//   golden: each case runs on the head and is compared with the transcript recorded from the original:
//           exit code, signal, stdout and stderr (and, for the renderer, every rendered config's text).
//   live:   where the base revision still holds mcp-launch.sh, the original runs beside the head on the
//           same case. MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from the original side only.
// POSIX only: the original is a POSIX sh script and the signal cases are POSIX signals. The intended
// differences are in test/golden/S12/expected-differences.json, with their reasons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S12';
const POSIX = process.platform !== 'win32';
const NODE = process.execPath;
const BIN = path.join(ROOT, 'bin', 'mhw.js');
const STUB = path.join(ROOT, 'test', 'helpers', 'security-stub.js');
const DRIVER = path.join(ROOT, 'test', 'helpers', 'mcp-launch-driver.js');
const FAKE = path.join(ROOT, 'test', 'helpers', 'mcp-fake-server.js');
const GIT = which('git');
const PY = POSIX ? which('python3') : null;
const PROJECT = 'personal-multi-harness-workstation-configuration';
const h = throwawayHome('mcp-golden');
after(() => h.cleanup());
const BASE_ENV = { ...h.env, PATH: path.dirname(NODE) + path.delimiter + h.env.PATH };
/** @type {Array<{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
// Synthetic, fixed so the transcripts are stable; nothing here is a credential.
const VALUE = 'synthetic-golden-value-0f3e9a';
const KC_VALUE = 'synthetic-golden-keychain-77c1';
const BYTES = Buffer.concat([Buffer.from(Array.from({ length: 256 }, (_, i) => i)), Buffer.from('{"jsonrpc":"2.0"}\r\n\r\0\n')]);

/**
 * @typedef {{ name: string, args: string[], env?: Record<string, string>, input?: 'bytes', keychain?: boolean, signal?: boolean }} LaunchCase
 * @typedef {{ code: number | null, signal: string | null, stdout: string, stderr: string }} Run
 */
const X = ['--', '<NODE>', '<FAKE>', 'exit', '0'];
/** @type {LaunchCase[]} */
const LAUNCH = [
  { name: 'no-command', args: [] },
  { name: 'dashdash-only', args: ['--'] },
  { name: 'secret-then-no-command', args: ['--secret', 'A=env:SET_ONE'], env: { SET_ONE: VALUE } },
  { name: 'keychain-missing-path', args: ['--keychain'] },
  { name: 'keychain-relative', args: ['--keychain', 'relative.keychain-db', ...X] },
  { name: 'keychain-root-only', args: ['--keychain', '/', ...X] },
  { name: 'keychain-after-secret', args: ['--secret', 'A=env:SET_ONE', '--keychain', '/k.keychain-db', ...X], env: { SET_ONE: VALUE } },
  { name: 'secret-missing-spec', args: ['--secret'] },
  { name: 'secret-no-equals', args: ['--secret', 'NOEQUALS', ...X] },
  { name: 'secret-bad-name', args: ['--secret', '1BAD=env:SET_ONE', ...X], env: { SET_ONE: VALUE } },
  { name: 'secret-empty-name', args: ['--secret', '=env:SET_ONE', ...X], env: { SET_ONE: VALUE } },
  { name: 'secret-unknown-source', args: ['--secret', 'OK=file:/x', ...X] },
  { name: 'secret-env-without-var', args: ['--secret', 'OK=env:', ...X] },
  { name: 'secret-keychain-without-service', args: ['--secret', 'OK=keychain:', ...X] },
  { name: 'secret-env-bad-var', args: ['--secret', 'OK=env:BAD-NAME', ...X] },
  { name: 'secret-env-unset', args: ['--secret', 'OK=env:UNSET_ONE', ...X] },
  { name: 'secret-env-empty', args: ['--secret', 'OK=env:EMPTY_ONE', ...X], env: { EMPTY_ONE: '' } },
  { name: 'secret-env-only-newlines', args: ['--secret', 'OK=env:NL_ONE', ...X], env: { NL_ONE: '\n\n' } },
  { name: 'unexpected-argument', args: ['--bogus'] },
  { name: 'env-secrets-reach-the-server', args: ['--secret', 'A_TOKEN=env:SRC_VAR', '--secret', 'B_TOKEN=env:A_TOKEN', '--', '<NODE>', '<FAKE>', 'env', '-', 'A_TOKEN', 'B_TOKEN', 'SRC_VAR', 'UNSET_X'], env: { SRC_VAR: VALUE + '\n' } },
  { name: 'stdio-passthrough', args: ['--', '<NODE>', '<FAKE>', 'echo'], input: 'bytes' },
  { name: 'exit-1', args: ['--', '<NODE>', '<FAKE>', 'exit', '1'] },
  { name: 'exit-137', args: ['--', '<NODE>', '<FAKE>', 'exit', '137'] },
  { name: 'killed-by-sigkill', args: ['--', '<NODE>', '<FAKE>', 'signal', 'SIGKILL'] },
  { name: 'killed-by-sigterm', args: ['--', '<NODE>', '<FAKE>', 'signal', 'SIGTERM'] },
  { name: 'command-not-found', args: ['--', '<DIR>/no-such-server'] },
  { name: 'keychain-value-reaches-the-server', keychain: true, args: ['--keychain', '<KC>', '--secret', 'K_TOKEN=keychain:svc.ok', '--', '<NODE>', '<FAKE>', 'env', '-', 'K_TOKEN'] },
  { name: 'keychain-absent-item', keychain: true, args: ['--keychain', '<KC>', '--secret', 'K_TOKEN=keychain:svc.none', ...X] },
  { name: 'keychain-hex-value', keychain: true, args: ['--keychain', '<KC>', '--secret', 'K_TOKEN=keychain:svc.hex', ...X] },
  { name: 'keychain-empty-value', keychain: true, args: ['--keychain', '<KC>', '--secret', 'K_TOKEN=keychain:svc.blank', ...X] },
];

/** The stub keychain the keychain cases read, items added on stdin. @param {string} dir */
function makeKeychain(dir) {
  const kc = path.join(dir, 'golden.keychain-db');
  const lines = ['create-keychain "' + kc + '"',
    'add-generic-password -s "svc.ok" -a "t" -w "' + KC_VALUE + '" "' + kc + '"',
    'add-generic-password -s "svc.hex" -a "t" -X "0001ff41" "' + kc + '"',
    'add-generic-password -s "svc.blank" -a "t" -w "" "' + kc + '"'];
  const p = spawnSync(STUB, ['-i'], { input: lines.join('\n') + '\n', env: BASE_ENV });
  assert.equal(p.status, 0, String(p.stderr));
  return kc;
}

/** @param {string} text @param {Array<[string, string]>} subs */
function normalise(text, subs) {
  let t = text;
  for (const [a, b] of [...subs].sort((x, y) => y[0].length - x[0].length)) t = t.replaceAll(a, b);
  return t;
}

/**
 * Run argv; stdout is kept as base64 when it is not UTF-8 text.
 * @param {string} cmd @param {string[]} argv @param {Record<string, string>} env @param {Buffer} input
 * @returns {Promise<{ code: number | null, signal: string | null, stdout: Buffer, stderr: string }>}
 */
function exec(cmd, argv, env, input) {
  return new Promise((resolve) => {
    const c = spawn(cmd, argv, { env, stdio: ['pipe', 'pipe', 'pipe'] });
    /** @type {Buffer[]} */ const o = [];
    /** @type {Buffer[]} */ const e = [];
    c.stdout.on('data', (b) => o.push(b));
    c.stderr.on('data', (b) => e.push(b));
    c.stdin.on('error', () => {});
    c.stdin.end(input);
    c.on('close', (code, signal) => resolve({ code, signal, stdout: Buffer.concat(o), stderr: Buffer.concat(e).toString('utf8') }));
  });
}

/**
 * One launcher case on one side.
 * @param {LaunchCase} c @param {'head' | { script: string }} side
 * @returns {Promise<Run>}
 */
async function playLaunch(c, side) {
  const dir = fs.mkdtempSync(path.join(h.dir, 'case-'));
  const kc = c.keychain ? makeKeychain(dir) : '';
  /** @type {Array<[string, string]>} */
  const subs = [[NODE, '<NODE>'], [FAKE, '<FAKE>'], [dir, '<DIR>'], [STUB, '<STUB>']];
  const args = c.args.map((a) => a.replaceAll('<NODE>', NODE).replaceAll('<FAKE>', FAKE).replaceAll('<DIR>', dir).replaceAll('<KC>', kc));
  const env = { ...BASE_ENV, ...(c.env || {}) };
  const input = c.input === 'bytes' ? BYTES : Buffer.alloc(0);
  let r;
  if (side === 'head') {
    r = await exec(NODE, c.keychain ? [DRIVER, STUB, ...args] : [BIN, 'mcp', 'launch', ...args], env, input);
  } else {
    let script = side.script;
    if (c.keychain) {
      script = path.join(dir, 'mcp-launch.stub.sh');
      fs.writeFileSync(script, fs.readFileSync(side.script, 'utf8').replaceAll('/usr/bin/security', STUB), { mode: 0o700 });
      subs.push([script, '<SCRIPT>']);
    }
    subs.push([side.script, '<SCRIPT>']);
    r = await exec('/bin/sh', [script, ...args], env, input);
  }
  for (const v of [VALUE, KC_VALUE]) {
    assert.ok(!r.stdout.includes(v) && !r.stderr.includes(v), c.name + ': a synthetic secret was printed');
  }
  const text = r.stdout.toString('utf8');
  const stdout = Buffer.from(text, 'utf8').equals(r.stdout) ? normalise(text, subs) : 'base64:' + r.stdout.toString('base64');
  return { code: r.code, signal: r.signal, stdout, stderr: normalise(r.stderr, subs) };
}

/** The expected differences of one case and stream, applied to one side. @param {string} name @param {string} stream @param {string} text @param {'base' | 'head'} side */
function allow(name, stream, text, side) {
  let t = text;
  for (const e of expected) {
    if (!(e.stream.includes(stream) || e.stream.includes('*')) || !(e.case.includes(name) || e.case.includes('*'))) continue;
    const pattern = side === 'head' ? e.head : e.base;
    if (pattern !== undefined) t = t.replaceAll(new RegExp(pattern, 'g'), e.replace);
  }
  return t;
}

/** @param {string} name @param {Record<string, unknown>} base @param {Record<string, unknown>} head */
function differences(name, base, head) {
  /** @type {string[]} */
  const diffs = [];
  for (const k of Object.keys(base).sort((a, b) => a.localeCompare(b))) {
    /** @param {unknown} v */
    const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v));
    const a = allow(name, k, text(base[k]), 'base');
    const b = allow(name, k, text(head[k]), 'head');
    if (a !== b) diffs.push(name + ': ' + k + ' differs\n--- original\n' + a + '\n--- head\n' + b);
  }
  return diffs;
}

// ------------------------------------------------------------------------------------------- renderer

/**
 * @typedef {{ name: string, steps: string[][], source: object }} RenderCase
 */
const SOURCE = {
  version: 1,
  servers: {
    'fake-plain': { command: '/bin/echo', args: ['hello'], env: { FAKE_REGION: 'zz-1' } },
    'fake-secret': { command: '/bin/cat', args: ['-u'], secrets: { FAKE_API_TOKEN: 'env:FAKE_SRC_VAR' } },
    'fake-codex-only': { command: '/bin/cat', surfaces: ['codex'] },
  },
};
/** @type {RenderCase[]} */
const RENDER = [
  { name: 'render-dry-run', steps: [['--dry-run']], source: SOURCE },
  { name: 'render-install-check-reinstall', steps: [[], ['--check'], []], source: SOURCE },
  { name: 'render-without-secrets', steps: [[], ['--check']], source: { version: 1, servers: { 'fake-plain': SOURCE.servers['fake-plain'] } } },
];

/**
 * Run the renderer's steps on a fresh throwaway HOME; each step's output, then the rendered configs.
 * @param {RenderCase} c @param {string} renderer
 */
function playRender(c, renderer) {
  const dir = fs.mkdtempSync(path.join(h.dir, 'render-'));
  const home = path.join(dir, 'home');
  for (const d of ['.codex', '.claude', '.kiro']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const data = path.join(home, '.local', 'share', PROJECT);
  fs.mkdirSync(path.join(data, 'local-overlay'), { recursive: true });
  fs.writeFileSync(path.join(data, 'local-overlay', 'mcp-servers.json'), JSON.stringify(c.source));
  const env = { PATH: BASE_ENV.PATH, HOME: home, LANG: 'C.UTF-8', MHW_NODE: NODE };
  /** @type {Array<[string, string]>} */
  const subs = [[path.join(data, 'mcp-launch.sh'), '<LAUNCHER>'], [path.join(data, 'mcp-launch.mjs'), '<LAUNCHER>'], [home, '<HOME>'], [NODE, '<NODE>']];
  const stamp = /release: [^;\n]*; commit: [^;\n")]*/g;
  /** @type {Record<string, unknown>} */
  const out = {};
  c.steps.forEach((step, i) => {
    const p = spawnSync(/** @type {string} */ (PY), ['-B', renderer, ...step], { env, encoding: 'utf8' });
    out['step' + i + ' ' + (step.join(' ') || 'install')] = { code: p.status };
    // The Claude desktop app is skipped for an OS-specific reason (absent on macOS, unpublished on Linux).
    out['step' + i + ' stdout'] = normalise(p.stdout, subs).replaceAll(stamp, '<STAMP>').replaceAll(/^SKIP {4}claude-desktop: .*$/gm, 'SKIP    claude-desktop: <skipped>');
    out['step' + i + ' stderr'] = normalise(p.stderr, subs).replaceAll(stamp, '<STAMP>');
  });
  for (const f of ['.codex/config.toml', '.claude.json', '.kiro/settings/mcp.json']) {
    const p = path.join(home, f);
    out[f] = fs.existsSync(p) ? normalise(fs.readFileSync(p, 'utf8'), subs).replaceAll(stamp, '<STAMP>') : '<absent>';
  }
  const launcher = ['mcp-launch.sh', 'mcp-launch.mjs'].map((n) => path.join(data, n)).find((p) => fs.existsSync(p));
  out.launcher = launcher ? { mode: (fs.statSync(launcher).mode & 0o777).toString(8) } : '<absent>';
  return out;
}

const pyOk = (() => {
  if (!PY) return false;
  const p = spawnSync(PY, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)']);
  return p.status === 0;
})();

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

test('every case has a golden transcript, every golden a case, and every expected difference names a case', () => {
  const names = new Set([...LAUNCH, ...RENDER].map((c) => c.name));
  assert.equal(names.size, LAUNCH.length + RENDER.length, 'case names are unique');
  const dir = path.join(ROOT, 'test', 'golden', SLICE, 'transcripts');
  for (const n of names) assert.ok(fs.existsSync(path.join(dir, n + '.json')), 'no golden for ' + n);
  for (const f of fs.readdirSync(dir)) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
  for (const e of expected) {
    for (const n of e.case) assert.ok(n === '*' || names.has(n), 'unknown case ' + n);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
    assert.doesNotThrow(() => new RegExp(e.head));
  }
});

test('no golden transcript carries a synthetic secret value', () => {
  for (const c of [...LAUNCH, ...RENDER]) {
    const text = fs.readFileSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name)), 'utf8');
    assert.ok(!text.includes(VALUE) && !text.includes(KC_VALUE), c.name);
  }
});

test('golden: mhw mcp launch matches the shell launcher\'s transcripts', { skip: (!POSIX && 'POSIX only') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, async () => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of LAUNCH) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), await playLaunch(c, 'head')));
  assert.deepEqual(diffs, []);
});

test('golden: mcp_render.py renders what it rendered before, but for the launcher it names', { skip: (!pyOk && 'needs python3 3.11+, POSIX') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of RENDER) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), playRender(c, path.join(ROOT, 'global', 'mcp', 'mcp_render.py'))));
  assert.deepEqual(diffs, []);
});

/** The base revision's tree, or a reason it is not readable here. */
function baseTree() {
  if (!POSIX) return 'POSIX only';
  if (!GIT) return 'needs git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = path.join(fs.mkdtempSync(path.join(h.dir, 'base-')), 'tree');
  if (!extractRevision(ROOT, base, dest)) return 'base revision ' + base + ' is not readable here';
  if (!fs.existsSync(path.join(dest, 'global', 'mcp', 'mcp-launch.sh'))) return 'the base revision no longer holds mcp-launch.sh (this slice has merged)';
  return dest;
}

test('live: the shell launcher and the renderer of the base revision, side by side with the head', async (t) => {
  const tree = baseTree();
  if (!path.isAbsolute(tree)) {
    t.skip(tree);
    return;
  }
  /** @type {string[]} */
  const diffs = [];
  const script = path.join(tree, 'global', 'mcp', 'mcp-launch.sh');
  for (const c of LAUNCH) {
    const original = await playLaunch(c, { script });
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), original);
    diffs.push(...differences(c.name, original, await playLaunch(c, 'head')));
  }
  if (pyOk) {
    for (const c of RENDER) {
      const original = playRender(c, path.join(tree, 'global', 'mcp', 'mcp_render.py'));
      if (UPDATE) writeGolden(SLICE, goldenName(c.name), original);
      diffs.push(...differences(c.name, original, playRender(c, path.join(ROOT, 'global', 'mcp', 'mcp_render.py'))));
    }
  } else {
    t.diagnostic('renderer cases skipped: needs python3 3.11+');
  }
  assert.deepEqual(diffs, []);
});
