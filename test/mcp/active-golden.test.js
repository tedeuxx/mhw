// S14 parity (#485, convention 3 of #470): the MCP active set and its connection check in Node
// (src/commands/mcp-active.js, mcp-connect.js) against the deleted global/mcp/mcp_active.py and
// mcp_connect.py. Throwaway HOMEs and SYNTHETIC values only. Every case (test/mcp/active-cases.js) runs its
// steps on a fresh HOME through `node src/render/mcp.js`, and records each step's exit code, stdout and
// stderr, then every file under that HOME (text and mode).
//   golden: each case runs on the head and is compared with the transcript recorded from the original.
//   live:   where the base revision still holds mcp_active.py, the original runs beside the head on the same
//           case. MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from the original side only.
// POSIX only: the original does not run the active set or the check on Windows (it says SKIP there, and
// test/mcp/active.test.js holds that line). The intended differences are in
// test/golden/S14/expected-differences.json, with reasons.
import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';
import { CASES, CANARY } from './active-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S14';
const PROJECT = 'personal-multi-harness-workstation-configuration';
const POSIX = process.platform !== 'win32';
const NODE = process.execPath;
const GIT = which('git');
const PY = POSIX ? which('python3') : null;
const PATH_NODE = which('node');
const STABLE_NODE = PATH_NODE && PATH_NODE !== NODE && fs.realpathSync(PATH_NODE) === fs.realpathSync(NODE) ? PATH_NODE : null;
const h = throwawayHome('mcp-active-golden');
after(() => h.cleanup());
/** @type {Array<{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const STAMP_RE = /release: [^;\n]*; commit: [^;\n")]*/g;
const pyOk = !!PY && spawnSync(PY, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)']).status === 0;

// The HTTP stub every connect case reaches, and a port nothing listens on.
/** @type {http.Server} */
let server;
let URL_BASE = '';
let CLOSED = '';
/** @type {Record<string, unknown>[]} */
const seenHeaders = [];
before(async () => {
  server = http.createServer((req, res) => {
    seenHeaders.push({ ...req.headers });
    /** @type {Record<string, number>} */
    const codes = { '/ok': 200, '/login': 401, '/bare401': 401, '/empty401': 401, '/missing': 404, '/boom': 500, '/sse': req.method === 'GET' ? 200 : 405, '/redir302': 302, '/redir307': 307, '/loop': 302 };
    const code = codes[String(req.url)] || 404;
    if (req.url === '/login') res.setHeader('WWW-Authenticate', 'Bearer resource_metadata="x"');
    if (req.url === '/empty401') res.setHeader('WWW-Authenticate', '');
    if (req.url === '/redir302' || req.url === '/redir307') res.setHeader('Location', '/ok');
    if (req.url === '/loop') res.setHeader('Location', '/loop');
    req.resume();
    res.writeHead(code);
    res.end('BODY-CANARY-' + CANARY);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  URL_BASE = 'http://127.0.0.1:' + /** @type {net.AddressInfo} */ (server.address()).port;
  const probe = net.createServer();
  await new Promise((resolve) => probe.listen(0, '127.0.0.1', () => resolve(undefined)));
  CLOSED = 'http://127.0.0.1:' + /** @type {net.AddressInfo} */ (probe.address()).port;
  await new Promise((resolve) => probe.close(() => resolve(undefined)));
});
after(() => server?.close());

/** @param {string} text @param {Array<[string, string]>} subs */
function normalise(text, subs) {
  let t = text;
  for (const [a, b] of [...subs].sort((x, y) => y[0].length - x[0].length)) if (a) t = t.replaceAll(a, b);
  // A Python traceback's frames name the interpreter's own install path: only its last line is kept.
  return t.replaceAll(STAMP_RE, '<STAMP>').replaceAll(/Traceback \(most recent call last\):\n(?: [^\n]*\n)*/g, '<traceback>\n');
}

/** Every file under dir: its text (normalised) and mode; the launcher as a marker. @param {string} dir @param {Array<[string, string]>} subs */
function snapshot(dir, subs) {
  /** @type {Record<string, unknown>} */
  const out = {};
  /** @param {string} d */
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort((a, b) => (a < b ? -1 : Number(a > b)))) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else {
        const rel = path.relative(dir, p);
        let text = fs.readFileSync(p, 'utf8');
        if (name === 'mcp-launch.mjs' && text.includes(PROJECT)) text = '<the launcher>';
        out[rel] = { mode: (st.mode & 0o777).toString(8), text: normalise(text, subs) };
      }
    }
  };
  walk(dir);
  return out;
}

/** One child run, while this process keeps serving the HTTP stub. @param {string[]} argv @param {Record<string, string>} env @param {string} cwd */
function runAsync(argv, env, cwd) {
  return /** @type {Promise<{ code: number | null, stdout: string, stderr: string }>} */ (new Promise((resolve) => {
    const c = spawn(argv[0], argv.slice(1), { env, cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    c.stdout.on('data', (b) => { stdout += b; });
    c.stderr.on('data', (b) => { stderr += b; });
    c.on('close', (code) => resolve({ code, stdout, stderr }));
  }));
}

/**
 * One case on one side.
 * @param {import('./active-cases.js').Case} c @param {{ argv: string[], root: string }} side
 */
async function play(c, side) {
  const base = fs.mkdtempSync(path.join(h.dir, 'case-'));
  const home = path.join(base, 'home');
  const data = path.join(home, '.local', 'share', PROJECT);
  fs.mkdirSync(home, { recursive: true });
  for (const d of c.dirs ?? ['.codex', '.claude', '.kiro']) fs.mkdirSync(path.join(home, d), { recursive: true });
  const w = { home, data, base, url: URL_BASE, closed: CLOSED };
  c.setup?.(w);
  /** @type {Array<[string, string]>} */
  const subs = [[home, '<HOME>'], [base, '<BASE>'], [NODE, '<NODE>'], [side.root, '<ROOT>'], [URL_BASE, '<URL>'], [CLOSED, '<CLOSED>']];
  if (STABLE_NODE) subs.push([STABLE_NODE, '<NODE>']);
  /** @param {string} s */
  const fill = (s) => s.replaceAll('<BASE>', base).replaceAll('<DATA>', data).replaceAll('<URL>', URL_BASE);
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [i, step] of c.steps.entries()) {
    step.pre?.(w);
    /** @type {Record<string, string>} */
    const env = { PATH: path.dirname(NODE) + path.delimiter + (process.env.PATH || ''), HOME: home, LANG: 'C.UTF-8', MHW_NODE: NODE, TMPDIR: h.env.TMPDIR };
    for (const [k, v] of Object.entries(step.env || {})) env[k] = fill(v);
    for (const k of step.unset || []) delete env[k];
    const p = await runAsync([...side.argv, ...step.args.map(fill)], env, base);
    const label = 'step' + i + ' ' + (step.args.join(' ') || 'install');
    out[label] = { code: p.code };
    // The Claude desktop app is skipped for an OS-specific reason (absent on macOS, unpublished on Linux).
    const desk = /^SKIP {4}claude-desktop: .*\n/gm;
    out[label + ' stdout'] = normalise(p.stdout, subs).replaceAll(desk, '').replaceAll(/\(the credential launcher, \d+ bytes\)/g, '(the credential launcher, <N> bytes)');
    out[label + ' stderr'] = normalise(p.stderr, subs);
  }
  out.files = snapshot(home, subs);
  const printed = JSON.stringify(Object.entries(out).filter(([k]) => k !== 'files'));
  assert.ok(!printed.includes(CANARY), c.name + ': a synthetic value was printed');
  assert.ok(!fs.existsSync(path.join(base, 'started')), c.name + ': a server outside the set was started');
  return out;
}

const HEAD = { argv: [NODE, path.join(ROOT, 'src', 'render', 'mcp.js')], root: ROOT };

/** @param {string} name @param {string} stream @param {string} text @param {'base' | 'head'} sideName */
function allow(name, stream, text, sideName) {
  let t = text;
  for (const e of expected) {
    const streamHit = e.stream.includes('*') || e.stream.some((s) => stream === s || stream.endsWith(' ' + s));
    if (!streamHit || !(e.case.includes(name) || e.case.includes('*'))) continue;
    const pattern = sideName === 'head' ? e.head : e.base;
    if (pattern !== undefined) t = t.replaceAll(new RegExp(pattern, 'g'), e.replace);
  }
  return t;
}

/** @param {string} name @param {Record<string, any>} base @param {Record<string, any>} head */
function differences(name, base, head) {
  /** @type {string[]} */
  const diffs = [];
  /** @param {unknown} v */
  const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort((a, b) => (a < b ? -1 : Number(a > b)));
  for (const k of keys) {
    if (k === 'files') {
      const files = [...new Set([...Object.keys(base.files || {}), ...Object.keys(head.files || {})])].sort((a, b) => (a < b ? -1 : Number(a > b)));
      for (const f of files) {
        const a = allow(name, 'file ' + f, text(base.files?.[f] ?? '<absent>'), 'base');
        const b = allow(name, 'file ' + f, text(head.files?.[f] ?? '<absent>'), 'head');
        if (a !== b) diffs.push(name + ': file ' + f + ' differs\n--- original\n' + a + '\n--- head\n' + b);
      }
      continue;
    }
    const a = allow(name, k, text(base[k]), 'base');
    const b = allow(name, k, text(head[k]), 'head');
    if (a !== b) diffs.push(name + ': ' + k + ' differs\n--- original\n' + a + '\n--- head\n' + b);
  }
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

test('every case has a golden transcript, every golden a case, and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  const dir = path.join(ROOT, 'test', 'golden', SLICE, 'transcripts');
  for (const n of names) assert.ok(fs.existsSync(path.join(dir, n + '.json')), 'no golden for ' + n);
  for (const f of fs.readdirSync(dir)) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
  for (const e of expected) {
    for (const n of e.case) assert.ok(n === '*' || names.has(n), 'unknown case ' + n);
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
    assert.doesNotThrow(() => new RegExp(e.head));
  }
});

test('no golden transcript carries a synthetic value outside the files the fixture put it in', () => {
  for (const c of CASES) {
    const g = readGolden(SLICE, goldenName(c.name));
    assert.ok(!JSON.stringify(Object.entries(g).filter(([k]) => k !== 'files')).includes(CANARY), c.name);
  }
});

test('golden: the Node active set and connection check match the transcripts of mcp_active.py and mcp_connect.py', { skip: (!POSIX && 'POSIX only') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, async () => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), await play(c, HEAD)));
  assert.deepEqual(diffs, []);
  assert.ok(!JSON.stringify(seenHeaders).includes(CANARY), 'a configured header was sent');
});

/** The base revision's tree, or a reason it is not readable here. */
function baseTree() {
  if (!POSIX) return 'POSIX only';
  if (!GIT) return 'needs git on PATH';
  if (!pyOk) return 'needs python3 3.11+';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = path.join(fs.mkdtempSync(path.join(h.dir, 'base-')), 'tree');
  if (!extractRevision(ROOT, base, dest)) return 'base revision ' + base + ' is not readable here';
  if (!fs.existsSync(path.join(dest, 'global', 'mcp', 'mcp_active.py'))) return 'the base revision no longer holds mcp_active.py (this slice has merged)';
  return dest;
}

test('live: mcp_active.py and mcp_connect.py of the base revision, side by side with the head', async (t) => {
  const tree = baseTree();
  if (!path.isAbsolute(tree)) {
    if (process.env.MHW_S14_LIVE_REQUIRED === '1' && !tree.includes('has merged')) assert.fail('the live arm is required here: ' + tree);
    t.skip(tree);
    return;
  }
  const original = { argv: [NODE, path.join(tree, 'src', 'render', 'mcp.js')], root: tree };
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) {
    const was = await play(c, original);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), was);
    diffs.push(...differences(c.name, was, await play(c, HEAD)));
  }
  assert.deepEqual(diffs, []);
});
