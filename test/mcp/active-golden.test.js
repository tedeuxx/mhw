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
import { spawn } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { goldenName, differences as diffsOf, catalogueTests, baseTree as baseTreeOf } from '../helpers/mcp-golden.js';
import { CASES, CANARY } from './active-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S14';
const PROJECT = 'personal-multi-harness-workstation-configuration';
const POSIX = process.platform !== 'win32';
const NODE = process.execPath;
const PATH_NODE = which('node');
const STABLE_NODE = PATH_NODE && PATH_NODE !== NODE && fs.realpathSync(PATH_NODE) === fs.realpathSync(NODE) ? PATH_NODE : null;
const h = throwawayHome('mcp-active-golden');
after(() => h.cleanup());
/** @type {Array<{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const STAMP_RE = /release: [^;\n]*; commit: [^;\n")]*/g;

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
    const codes = { '/ok': 200, '/login': 401, '/bare401': 401, '/empty401': 401, '/missing': 404, '/boom': 500, '/sse': req.method === 'GET' ? 200 : 405, '/redir302': 302, '/redir307': 307, '/loop': 302, '/touser': 302 };
    const code = codes[String(req.url)] || 404;
    if (req.url === '/login') res.setHeader('WWW-Authenticate', 'Bearer resource_metadata="x"');
    if (req.url === '/empty401') res.setHeader('WWW-Authenticate', '');
    if (req.url === '/redir302' || req.url === '/redir307') res.setHeader('Location', '/ok');
    if (req.url === '/loop') res.setHeader('Location', '/loop');
    if (req.url === '/touser') res.setHeader('Location', URL_BASE.replace('//', '//synthuser:' + CANARY + '@') + '/ok');
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
  const subs = [[home, '<HOME>'], [base, '<BASE>'], [NODE, '<NODE>'], [side.root, '<ROOT>'], [URL_BASE, '<URL>'], [CLOSED, '<CLOSED>'], [URL_BASE.slice('http://'.length), '<HOST:PORT>']];
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

/** @param {string} name @param {Record<string, any>} base @param {Record<string, any>} head */
const differences = (name, base, head) => diffsOf(expected, name, base, head);

catalogueTests({ root: ROOT, slice: SLICE, cases: CASES, expected, canary: CANARY });

test('golden: the Node active set and connection check match the transcripts of mcp_active.py and mcp_connect.py', { skip: (!POSIX && 'POSIX only') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, async () => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), await play(c, HEAD)));
  assert.deepEqual(diffs, []);
  assert.ok(!JSON.stringify(seenHeaders).includes(CANARY), 'a configured header was sent');
  assert.ok(seenHeaders.every((r) => !('authorization' in r)), 'an Authorization header was sent (lens F1, PR #530)');
});

test('live: mcp_active.py and mcp_connect.py of the base revision, side by side with the head', async (t) => {
  const tree = baseTreeOf({ root: ROOT, dir: h.dir, holds: path.join('global', 'mcp', 'mcp_active.py') });
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
