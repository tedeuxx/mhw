// S15 parity (#486, convention 3 of #470): the outbound scan (.github/scripts/outbound-scan.js; it was
// `mhw scan`, src/commands/scan.js, until #600) against the deleted global/scan.py, on the cases of its own suite (the deleted global/scan_test.py) plus the port's edges
// (test/scan/cases.js).
//   golden: each case builds a throwaway repository and runs the Node script in this process and as a
//           process (node .github/scripts/outbound-scan.js, as the workflow runs it); every run is compared with the transcript recorded from the Python
//           original (stdout, stderr, exit code). Every OS (a case marked posix is skipped on Windows).
//   live:   where the base revision still holds scan.py (until this slice merges) and the recorded
//           CPython is on PATH, the original runs on the same repository beside the Node command. POSIX
//           only. MHW_S15_LIVE_REQUIRED=1 (CI) turns a missing base or python3 into a failure.
//           MHW_UPDATE_GOLDEN=1 rewrites the goldens from the Python side, never from the Node side.
// Every run, on every side, is also checked for a leak: no five characters in a row of any fixture
// value that is a finding reach stdout or stderr.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { run } from '../../.github/scripts/outbound-scan.js';
import * as core from '../../src/lib/clean.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';
import { ROOT, recordedPython } from '../helpers/s15.js';
import { CASES, SECRETS, NEW_SPANS, TERM, HEALTH_TERM, COLLEAGUE_TERM, VENDOR, CODEX } from './cases.js';

const SLICE = 'S15';
const POSIX = process.platform !== 'win32';
const GIT = which('git');
const LIVE_REQUIRED = process.env.MHW_S15_LIVE_REQUIRED === '1';
const ROOT_USER = POSIX && typeof process.getuid === 'function' && process.getuid() === 0;
const LEAKS = [...SECRETS, ...NEW_SPANS, TERM, HEALTH_TERM, COLLEAGUE_TERM, VENDOR, CODEX];
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {{ code: number, stdout: string, stderr: string }} Result
 * @typedef {{ name: string, run: (args: string[], cwd: string, env: Record<string, string>) => Result }} Runner
 * @typedef {{ args: string[], code: number, stdout: string, stderr: string }} Run
 */

function freshBase() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s15-')));
  cleanups.push(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // left to the OS temp directory
    }
  });
  return dir;
}

/** @param {string} s @param {string} base */
function norm(s, base) {
  let out = s.split(base).join('<BASE>');
  if (!POSIX) out = out.split(base.replaceAll('\\', '/')).join('<BASE>').replace(/<BASE>[^\s:"']*/g, (p) => p.replaceAll('\\', '/'));
  return out;
}

/** No five characters in a row of a fixture finding reach either stream. @param {Result} r @param {string} label */
function assertNoLeak(r, label) {
  const both = r.stdout + r.stderr;
  // The terms are matched in any case, so a printed excerpt of one is looked for in any case too.
  const terms = new Set([TERM, HEALTH_TERM, COLLEAGUE_TERM]);
  for (const value of LEAKS) {
    for (let i = 0; i + 5 <= value.length; i++) {
      const w = value.slice(i, i + 5);
      const hit = terms.has(value) ? both.toLowerCase().includes(w.toLowerCase()) : both.includes(w);
      assert.ok(!hit, label + ': an excerpt of a finding was printed (' + JSON.stringify(w) + ')');
    }
  }
}

/**
 * Build the case and run every scan step through every runner.
 * @param {import('./cases.js').Case} c
 * @param {Runner[]} runners
 * @returns {Run[][]} one list per runner
 */
function play(c, runners) {
  const base = freshBase();
  const home = path.join(base, 'home');
  const data = path.join(home, 'data', core.PROJECT);
  fs.mkdirSync(path.join(base, 'repo'), { recursive: true });
  fs.mkdirSync(home);
  const empty = path.join(base, 'gitconfig');
  fs.writeFileSync(empty, '');
  /** @type {Record<string, string>} */
  const env = { PATH: process.env.PATH || '', HOME: home, USERPROFILE: home, XDG_DATA_HOME: path.join(home, 'data'),
    GIT_CONFIG_GLOBAL: empty, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.com',
    GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.com', GIT_AUTHOR_DATE: '2026-01-01T00:00:00+00:00',
    GIT_COMMITTER_DATE: '2026-01-01T00:00:00+00:00', LC_ALL: 'C', PYTHONDONTWRITEBYTECODE: '1', TMPDIR: base };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const at = (/** @type {string} */ p) => path.join(base, ...p.split('/'));
  /** @type {Run[][]} */
  const runs = runners.map(() => []);
  for (const step of c.steps) {
    if (step.git) {
      const p = spawnSync(/** @type {string} */ (GIT), ['-C', at('repo'), ...step.git], { env, encoding: 'utf8' });
      assert.equal(p.status, 0, c.name + ': git ' + step.git.join(' ') + ': ' + p.stderr);
    } else if (step.write) {
      fs.writeFileSync(at(step.write), step.b64 !== undefined ? Buffer.from(step.b64, 'base64') : /** @type {string} */ (step.text));
    } else if (step.mkdir) {
      fs.mkdirSync(at(step.mkdir), { recursive: true });
    } else if (step.symlink) {
      fs.symlinkSync(step.symlink[0].replace('{BASE}', base), at(step.symlink[1]));
    } else if (step.rm) {
      fs.rmSync(at(step.rm));
    } else if (step.chmod) {
      fs.chmodSync(at(step.chmod[0]), step.chmod[1]);
    } else if (step.conf !== undefined || step.confBytes !== undefined) {
      fs.mkdirSync(data, { recursive: true });
      fs.writeFileSync(path.join(data, 'clipboard.conf'), step.confBytes !== undefined ? Buffer.from(step.confBytes, 'base64') : /** @type {string} */ (step.conf));
    } else if (step.scan) {
      if (step.chmod === undefined && ROOT_USER && c.name === 'unreadable-file') continue;
      const args = step.scan.map((a) => a.replace('{BASE}', base));
      const cwd = at(step.cwd || 'repo');
      const e = step.outsideGit ? { ...env, GIT_CEILING_DIRECTORIES: base } : env;
      runners.forEach((runner, i) => {
        const r = runner.run(args, cwd, e);
        assertNoLeak(r, c.name + ' ' + runner.name + ' ' + JSON.stringify(step.scan));
        runs[i].push({ args: /** @type {string[]} */ (step.scan), code: r.code, stdout: norm(r.stdout, base), stderr: norm(r.stderr, base) });
      });
    }
  }
  return runs;
}

/** @type {Runner} */
const inProcess = { name: 'node', run: (args, cwd, env) => run(args, { cwd, env }) };
/** @type {Runner} */
const cli = {
  name: '.github/scripts/outbound-scan.js',
  run: (args, cwd, env) => {
    const p = spawnSync(process.execPath, [path.join(ROOT, '.github', 'scripts', 'outbound-scan.js'), ...args], { cwd, env, encoding: 'utf8' });
    return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
  },
};

/** @param {string} name */
const goldenName = (name) => 'scan/' + name + '.json';

// #488 (S17): the salt became a file, so the original's salt NOTE changed wording. The S15 transcripts
// stay as the original wrote them; the declared replacements of test/golden/S17/expected-differences.json
// (section "scan") are applied to them here.
const S17_SCAN = readGolden('S17', 'expected-differences.json').differences.filter((/** @type {any} */ d) => d.section === 'scan');
// #600: the command became a CI script, and its own name in its output changed with it (`mhw scan` ->
// `outbound-scan`). The declared replacement is test/golden/S15/expected-differences.json's entry with a
// "replace" field, applied to both streams of the original's transcripts here.
const S15_RENAMES = readGolden(SLICE, 'expected-differences.json').differences.filter((/** @type {any} */ d) => d.replace);
// #589: no term list and no salt exist, so the original's term-list NOTE lines are gone from stdout. The
// declared pattern is test/golden/S15/expected-differences.json's entry with a "drop" field; every line of
// the original's stdout that matches it is removed here, and nothing else.
const S15_DROPS = readGolden(SLICE, 'expected-differences.json').differences.filter((/** @type {any} */ d) => d.drop)
  .map((/** @type {any} */ d) => new RegExp(d.drop));
/** @param {Run[]} runs @returns {Run[]} */
function s17Expected(runs) {
  return runs.map((r) => {
    let { stdout, stderr } = r;
    for (const d of S17_SCAN) stdout = stdout.replaceAll(d.replace.base, d.replace.head);
    for (const d of S15_RENAMES) {
      stdout = stdout.replaceAll(d.replace.base, d.replace.head);
      stderr = stderr.replaceAll(d.replace.base, d.replace.head);
    }
    stdout = stdout.split(/(?<=\n)/).filter((l) => !S15_DROPS.some((/** @type {RegExp} */ re) => re.test(l))).join('');
    return { ...r, stdout, stderr };
  });
}

/** @param {import('./cases.js').Case} c */
const skipped = (c) => (c.posix && !POSIX ? 'POSIX only (symlinks, a tab in a file name, file modes)' : null);

test('every case has a golden transcript and every golden a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length);
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const f of fs.readdirSync(path.join(ROOT, 'test', 'golden', SLICE, 'scan'))) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
});

test('golden: the Node script, in process and as a process, matches the original\'s transcripts', { skip: (UPDATE && 'MHW_UPDATE_GOLDEN=1') || (!GIT && 'needs git') }, (t) => {
  const diffs = [];
  for (const c of CASES) {
    const why = skipped(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    const golden = /** @type {Run[]} */ (s17Expected(readGolden(SLICE, goldenName(c.name)).runs));
    const runs = play(c, [inProcess, cli]);
    for (const [i, side] of runs.entries()) {
      if (JSON.stringify(side) !== JSON.stringify(golden)) diffs.push(c.name + ' (' + [inProcess, cli][i].name + ')\n' + JSON.stringify(golden, null, 1) + '\n--- node\n' + JSON.stringify(side, null, 1));
    }
  }
  assert.deepEqual(diffs, []);
});

/** The base revision's scan.py and the recorded CPython, or why not. @returns {{ py?: string, script?: string, why?: string, fail?: boolean }} */
function pythonBase() {
  if (!POSIX) return { why: 'POSIX only' };
  if (!GIT) return { why: 'needs git on PATH', fail: LIVE_REQUIRED };
  const own = path.join(ROOT, 'global', 'scan.py');
  let script = own;
  if (!fs.existsSync(own)) {
    const base = process.env.MHW_PARITY_BASE || (() => {
      const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
      return p.status === 0 ? p.stdout.trim() : '';
    })();
    if (!base) return { why: 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)', fail: LIVE_REQUIRED };
    const dest = path.join(freshBase(), 'tree');
    if (!extractRevision(ROOT, base, dest)) return { why: 'base revision ' + base + ' is not readable here', fail: LIVE_REQUIRED };
    script = path.join(dest, 'global', 'scan.py');
    if (!fs.existsSync(script)) return { why: 'the base revision no longer holds scan.py (this slice has merged)' };
  }
  const p = recordedPython();
  if (!p.py) return { why: /** @type {string} */ (p.why), fail: LIVE_REQUIRED };
  return { py: p.py, script };
}

test('live: the Python original and the Node command side by side on the same repositories', (t) => {
  const b = pythonBase();
  if (!b.py || !b.script) {
    if (b.fail) assert.fail('MHW_S15_LIVE_REQUIRED=1: ' + b.why);
    t.skip(b.why);
    return;
  }
  const { py, script } = b;
  /** @type {Runner} */
  const python = {
    name: 'python',
    run: (args, cwd, env) => {
      const p = spawnSync(py, ['-B', script, ...args], { cwd, env, encoding: 'utf8' });
      return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
    },
  };
  const diffs = [];
  for (const c of CASES) {
    const [original, node] = play(c, [python, inProcess]);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), { name: c.name, runs: original });
    if (JSON.stringify(original) !== JSON.stringify(node)) diffs.push(c.name + '\n' + JSON.stringify(original, null, 1) + '\n--- node\n' + JSON.stringify(node, null, 1));
  }
  assert.deepEqual(diffs, []);
});
