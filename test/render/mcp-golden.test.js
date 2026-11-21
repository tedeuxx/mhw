// S13 parity (#484, convention 3 of #470): src/render/mcp.js against the deleted global/mcp/mcp_render.py.
// Throwaway HOMEs and SYNTHETIC values only. Every case (test/render/mcp-cases.js) runs its steps on a fresh
// HOME and records each step's exit code, stdout and stderr, then every file under that HOME (text and
// mode); the installed launcher is recorded as its header plus whether the rest is the side's own
// src/commands/mcp-launch.js.
//   golden: each case runs on the head and is compared with the transcript recorded from the original.
//   live:   where the base revision still holds mcp_render.py, the original runs beside the head on the
//           same case. MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from the original side only.
// POSIX only: the original's active set and policy modes do not run on Windows, and the cases use
// POSIX modes. Since #485 the head's active set is Node (src/commands/mcp-active.js), so its four cases
// here need no python3; the S14 transcripts (test/golden/S14) hold the rest. The intended differences are in test/golden/S13/expected-differences.json, with reasons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { goldenName, differences as diffsOf, catalogueTests, baseTree as baseTreeOf, python311 } from '../helpers/mcp-golden.js';
import { CASES, CANARY, PROJECT } from './mcp-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S13';
const POSIX = process.platform !== 'win32';
const NODE = process.execPath;
const PATH_NODE = which('node');
const STABLE_NODE = PATH_NODE && PATH_NODE !== NODE && fs.realpathSync(PATH_NODE) === fs.realpathSync(NODE) ? PATH_NODE : null;
const h = throwawayHome('mcp-render-golden');
after(() => h.cleanup());
/** @type {Array<{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const STAMP_RE = /release: [^;\n]*; commit: [^;\n")]*/g;

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

/** @param {string} name @param {Record<string, any>} base @param {Record<string, any>} head */
const differences = (name, base, head) => diffsOf(expected, name, base, head);

catalogueTests({ root: ROOT, slice: SLICE, cases: CASES, expected, canary: CANARY });

test('golden: src/render/mcp.js matches the transcripts of mcp_render.py', { skip: (!POSIX && 'POSIX only') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), play(c, HEAD)));
  assert.deepEqual(diffs, []);
});

test('live: mcp_render.py of the base revision, side by side with the head', (t) => {
  const tree = baseTreeOf({ root: ROOT, dir: h.dir, holds: path.join('global', 'mcp', 'mcp_render.py') });
  if (!path.isAbsolute(tree)) {
    if (process.env.MHW_S13_LIVE_REQUIRED === '1' && !tree.includes('has merged')) assert.fail('the live arm is required here: ' + tree);
    t.skip(tree);
    return;
  }
  const original = { argv: [/** @type {string} */ (python311()), '-B', path.join(tree, 'global', 'mcp', 'mcp_render.py')], root: tree };
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) {
    const was = play(c, original);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), was);
    diffs.push(...differences(c.name, was, play(c, HEAD)));
  }
  assert.deepEqual(diffs, []);
});
