// S13 parity (#484, convention 3 of #470): src/render/mcp.js against the deleted global/mcp/mcp_render.py.
// Throwaway HOMEs and SYNTHETIC values only. Every case (test/render/mcp-cases.js) runs its steps on a fresh
// HOME and records each step's exit code, stdout and stderr, then every file under that HOME (text and
// mode); the installed launcher is recorded as its header plus whether the rest is the side's own
// src/commands/mcp-launch.js.
//   golden: each case runs on the head and is compared with the transcript recorded from the original.
//   live:   where the base revision still holds mcp_render.py, the original runs beside the head on the
//           same case. MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from the original side only.
// POSIX only: the original's active set and policy modes do not run on Windows, and the cases use
// POSIX modes. The intended differences are in test/golden/S13/expected-differences.json, with reasons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';
import { CASES, CANARY, PROJECT } from './mcp-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S13';
const POSIX = process.platform !== 'win32';
const NODE = process.execPath;
const GIT = which('git');
const PY = POSIX ? which('python3') : null;
const PATH_NODE = which('node');
const STABLE_NODE = PATH_NODE && PATH_NODE !== NODE && fs.realpathSync(PATH_NODE) === fs.realpathSync(NODE) ? PATH_NODE : null;
const h = throwawayHome('mcp-render-golden');
after(() => h.cleanup());
/** @type {Array<{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const STAMP_RE = /release: [^;\n]*; commit: [^;\n")]*/g;

const pyOk = (() => {
  if (!PY) return false;
  return spawnSync(PY, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)']).status === 0;
})();

/** @param {string} text @param {Array<[string, string]>} subs */
function normalise(text, subs) {
  let t = text;
  for (const [a, b] of [...subs].sort((x, y) => y[0].length - x[0].length)) t = t.replaceAll(a, b);
  // A token-shaped synthetic value a fixture planted (assembled at run time there) is kept out of the goldens.
  return t.replaceAll(STAMP_RE, '<STAMP>').replaceAll('gh' + 'p_' + 'W'.repeat(36), '<TOKEN-SHAPED>');
}

/** Every file under dir: its text (normalised) and mode; the launcher as its header. @param {string} dir @param {string} side @param {Array<[string, string]>} subs */
function snapshot(dir, side, subs) {
  /** @type {Record<string, unknown>} */
  const out = {};
  const launcherBody = fs.readFileSync(path.join(side, 'src', 'commands', 'mcp-launch.js'), 'utf8').split('\n').slice(1).join('\n');
  /** @param {string} d */
  const walk = (d) => {
    for (const name of fs.readdirSync(d).sort((a, b) => a.localeCompare(b))) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else {
        const rel = path.relative(dir, p);
        let text = fs.readFileSync(p, 'utf8');
        if (name === 'mcp-launch.mjs' && text.includes(PROJECT)) {
          const lines = text.split('\n');
          text = lines.slice(0, 2).join('\n') + '\n' + (lines.slice(2).join('\n') === launcherBody ? '<the launcher source>' : '<NOT the launcher source>');
        }
        out[rel] = { mode: (st.mode & 0o777).toString(8), text: normalise(text, subs) };
      }
    }
  };
  walk(dir);
  return out;
}

/**
 * One case on one side.
 * @param {import('./mcp-cases.js').Case} c @param {{ argv: string[], root: string }} side
 */
function play(c, side) {
  const base = fs.mkdtempSync(path.join(h.dir, 'case-'));
  const home = path.join(base, 'home');
  const data = path.join(home, '.local', 'share', PROJECT);
  for (const d of c.dirs ?? ['.codex', '.claude', '.kiro']) fs.mkdirSync(path.join(home, d), { recursive: true });
  fs.mkdirSync(home, { recursive: true });
  const w = { home, data, base };
  c.setup?.(w);
  /** @type {Array<[string, string]>} */
  const subs = [[home, '<HOME>'], [base, '<BASE>'], [NODE, '<NODE>'], [side.root, '<ROOT>']];
  if (STABLE_NODE) subs.push([STABLE_NODE, '<NODE>']);
  /** @param {string} s */
  const fill = (s) => s.replaceAll('<BASE>', base).replaceAll('<DATA>', data);
  /** @type {Record<string, unknown>} */
  const out = {};
  c.steps.forEach((step, i) => {
    step.pre?.(w);
    /** @type {Record<string, string>} */
    const env = { PATH: path.dirname(NODE) + path.delimiter + (process.env.PATH || ''), HOME: home, LANG: 'C.UTF-8', MHW_NODE: NODE, TMPDIR: h.env.TMPDIR };
    for (const [k, v] of Object.entries(step.env || {})) env[k] = fill(v);
    for (const k of step.unset || []) delete env[k];
    const p = spawnSync(side.argv[0], [...side.argv.slice(1), ...step.args.map(fill)], { env, encoding: 'utf8', cwd: base });
    const label = 'step' + i + ' ' + (step.args.join(' ') || 'install');
    out[label] = { code: p.status };
    // The Claude desktop app is skipped for an OS-specific reason (absent on macOS, unpublished on Linux).
    const desk = /^SKIP {4}claude-desktop: .*\n/gm;
    // The launcher's size counts the provenance stamp in its header, which differs per checkout; the
    // launcher's text is compared in the files of every case that installs it.
    out[label + ' stdout'] = normalise(p.stdout, subs).replaceAll(desk, '').replaceAll(/\(the credential launcher, \d+ bytes\)/g, '(the credential launcher, <N> bytes)');
    out[label + ' stderr'] = normalise(p.stderr, subs);
  });
  out.files = snapshot(home, side.root, subs);
  for (const v of [CANARY]) {
    const all = JSON.stringify(Object.entries(out).filter(([k]) => k !== 'files'));
    assert.ok(!all.includes(v), c.name + ': a synthetic value was printed');
  }
  return out;
}

const HEAD = { argv: [NODE, path.join(ROOT, 'src', 'render', 'mcp.js')], root: ROOT };

/** The expected differences of one case and stream, applied to one side. @param {string} name @param {string} stream @param {string} text @param {'base' | 'head'} sideName */
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
  const keys = [...new Set([...Object.keys(base), ...Object.keys(head)])].sort((a, b) => a.localeCompare(b));
  for (const k of keys) {
    if (k === 'files') {
      const files = [...new Set([...Object.keys(base.files || {}), ...Object.keys(head.files || {})])].sort((a, b) => a.localeCompare(b));
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
    const printed = JSON.stringify(Object.entries(g).filter(([k]) => k !== 'files'));
    assert.ok(!printed.includes(CANARY), c.name);
  }
});

test('golden: src/render/mcp.js matches the transcripts of mcp_render.py', { skip: (!POSIX && 'POSIX only') || (!pyOk && 'the active set still runs on python3 3.11+') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), play(c, HEAD)));
  assert.deepEqual(diffs, []);
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
  if (!fs.existsSync(path.join(dest, 'global', 'mcp', 'mcp_render.py'))) return 'the base revision no longer holds mcp_render.py (this slice has merged)';
  return dest;
}

test('live: mcp_render.py of the base revision, side by side with the head', (t) => {
  const tree = baseTree();
  if (!path.isAbsolute(tree)) {
    if (process.env.MHW_S13_LIVE_REQUIRED === '1' && !tree.includes('has merged')) assert.fail('the live arm is required here: ' + tree);
    t.skip(tree);
    return;
  }
  const original = { argv: [/** @type {string} */ (PY), '-B', path.join(tree, 'global', 'mcp', 'mcp_render.py')], root: tree };
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) {
    const was = play(c, original);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), was);
    diffs.push(...differences(c.name, was, play(c, HEAD)));
  }
  assert.deepEqual(diffs, []);
});
