// S05 parity (#476, convention 3 of #470): `mhw worklog` and `mhw launch-line` against the deleted
// method/scripts/worklog.py and launch-line.py, on test/helpers/s05-cases.js.
//   golden: bin/mhw.js against the transcripts recorded from the Python (stdout, stderr, exit code), byte
//           for byte after the case directory is replaced by <D>. Runs on every OS (a case marked posix
//           needs /etc or prints a native path inside a repr).
//   live:   where the base revision still holds the Python (until this slice merges) and python3 is on
//           PATH, the Python and the Node side by side. POSIX only. MHW_UPDATE_GOLDEN=1 rewrites the golden
//           transcripts from the Python side, never from the Node side.
//   entry:  ./mhw worklog and ./mhw launch-line forward to bin/mhw.js (POSIX).
// Intended differences are in test/golden/S05/expected-differences.json, each with its reason.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CASES, CHECKOUT_NAME } from '../helpers/s05-cases.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision, snapshotTree } from '../helpers/parity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S05';
const POSIX = process.platform !== 'win32';
const PY = POSIX ? which('python3') : null;
const GIT = which('git');
/** @type {Array<{ case: string, stream: 'stdout' | 'stderr', base: string, head: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** @typedef {import('../helpers/s05-cases.js').Case} Case */
/** @typedef {{ code: number | null, stdout: string, stderr: string, written?: string }} Result */
/** @typedef {(c: Case, args: string[], cwd: string, env: Record<string, string>) => Result} Runner */

/** A fresh, resolved directory for one case. */
function fresh() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s05-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Lay out one case, run it, normalise: CRLF to LF, the checkout and the case directory to <CO> and <D>.
 * @param {Case} c
 * @param {Runner} runner
 * @returns {Result}
 */
function transcript(c, runner) {
  const d = fresh();
  const co = path.join(d, CHECKOUT_NAME);
  /** @param {string} s */
  const fill = (s) => s.split('{CO}').join(co).split('{D}').join(d);
  for (const dir of c.dirs || []) fs.mkdirSync(fill(dir.includes('{') ? dir : '{D}/' + dir), { recursive: true });
  for (const [name, content] of Object.entries(c.files || {})) fs.writeFileSync(path.join(d, name), content);
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  // AC 4 of #476: every command runs on a fresh throwaway HOME, never the real one, and nothing it runs
  // may write: the whole case directory (the HOME inside it) is compared, content and mode, before and after.
  const home = path.join(d, 'home');
  fs.mkdirSync(home);
  Object.assign(env, { HOME: home, USERPROFILE: home, TMPDIR: d, TEMP: d, TMP: d, PYTHONDONTWRITEBYTECODE: '1', PYTHONIOENCODING: 'utf-8', LC_ALL: 'C.UTF-8' });
  const before = JSON.stringify(snapshotTree(d));
  const r = runner(c, c.args.map(fill), d, env);
  const after = JSON.stringify(snapshotTree(d));
  /** @param {string} s */
  const norm = (s) => {
    let out = s.replace(/\r\n/g, '\n').split(co).join('<CO>').split(d).join('<D>');
    if (!POSIX) {
      out = out.split(co.replace(/\\/g, '\\\\')).join('<CO>').split(d.replace(/\\/g, '\\\\')).join('<D>');
      // A Windows separator after a placeholder (one backslash, or two inside a repr) reads as "/".
      out = out.replace(/<(D|CO)>\\{1,2}/g, '<$1>/');
    }
    return out;
  };
  return { code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr), written: before === after ? '' : 'the command changed the case directory or its HOME\n--- before\n' + before + '\n--- after\n' + after };
}

/** @type {Runner} */
const node = (c, args, cwd, env) => {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), c.cmd, ...args], { cwd, env, encoding: 'utf8' });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

/**
 * The transcripts compared, after each expected difference drops its lines from both sides.
 * @param {string} name
 * @param {Result} original
 * @param {Result} head
 */
function differences(name, original, head) {
  const diffs = [];
  if (head.written) diffs.push(name + ': ' + head.written);
  if (original.written) diffs.push(name + ' (original): ' + original.written);
  if (original.code !== head.code) diffs.push(name + ': exit ' + original.code + ' -> ' + head.code);
  for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
    const rules = expected.filter((e) => (e.case === name || e.case === '*') && e.stream === stream);
    /** @param {string} text @param {'base' | 'head'} side */
    const keep = (text, side) => text.split('\n').filter((l) => !rules.some((r) => new RegExp(r[side]).test(l))).join('\n');
    if (keep(original[stream], 'base') !== keep(head[stream], 'head')) diffs.push(name + ': ' + stream + ' differs\n--- original\n' + original[stream] + '\n--- head\n' + head[stream]);
  }
  return diffs;
}

/** @param {Case} c */
const skip = (c) => (c.posix && !POSIX ? 'needs POSIX paths' : '');

test('every case has a golden transcript and every expected difference names a case', () => {
  const golden = readGolden(SLICE, 'transcripts.json');
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(golden[c.name], 'no golden for ' + c.name);
  for (const e of expected) {
    assert.ok(names.has(e.case) || e.case === '*', 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
    new RegExp(e.base);
    new RegExp(e.head);
  }
});

test('golden: mhw worklog and mhw launch-line match the Python transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  const golden = readGolden(SLICE, 'transcripts.json');
  const diffs = [];
  for (const c of CASES) {
    if (skip(c)) {
      t.diagnostic(c.name + ' skipped: ' + skip(c));
      continue;
    }
    diffs.push(...differences(c.name, golden[c.name], transcript(c, node)));
  }
  assert.deepEqual(diffs, []);
});

/** The base revision's method/scripts directory, or why it is not readable here. */
function pythonBase() {
  if (!PY || !GIT) return 'needs POSIX, python3 and git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = fresh();
  if (!extractRevision(ROOT, base, path.join(dest, 'tree'))) return 'base revision ' + base + ' is not readable here';
  const scripts = path.join(dest, 'tree', 'method', 'scripts');
  if (!fs.existsSync(path.join(scripts, 'worklog.py'))) return 'the base revision no longer holds the Python (this slice has merged)';
  // The golden is the binding oracle, recorded from one CPython (QA on PR #510: another patch release
  // answered "+00:99" differently); any other python3 is not compared, and says so.
  const recorded = readGolden(SLICE, 'recorded-from.json').cpython;
  const v = spawnSync(PY, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim();
  if (v !== recorded) return 'python3 on PATH is ' + (v || 'unknown') + '; the golden was recorded from CPython ' + recorded + ', and only that one is compared';
  return scripts;
}

test('live: the Python and the Node side by side', (t) => {
  const scripts = pythonBase();
  if (!path.isAbsolute(scripts)) {
    t.skip(scripts);
    return;
  }
  /** @type {Runner} */
  const python = (c, args, cwd, env) => {
    const p = spawnSync(/** @type {string} */ (PY), ['-B', path.join(scripts, c.cmd + '.py'), ...args], { cwd, env, encoding: 'utf8' });
    // A traceback names the extracted base tree, which is a temporary path; it is not recorded.
    const scrub = (/** @type {string} */ s) => s.split(scripts).join('<SCRIPTS>');
    return { code: p.status, stdout: scrub(p.stdout), stderr: scrub(p.stderr) };
  };
  /** @type {Record<string, Result>} */
  const recorded = {};
  const diffs = [];
  for (const c of CASES) {
    const original = transcript(c, python);
    recorded[c.name] = original;
    diffs.push(...differences(c.name, original, transcript(c, node)));
  }
  if (UPDATE) writeGolden(SLICE, 'transcripts.json', Object.fromEntries(Object.entries(recorded).map(([k, v]) => [k, { code: v.code, stdout: v.stdout, stderr: v.stderr }])));
  assert.deepEqual(diffs, []);
});

test('./mhw worklog and ./mhw launch-line forward to bin/mhw.js', { skip: !POSIX && './mhw is the POSIX entry' }, () => {
  const golden = readGolden(SLICE, 'transcripts.json');
  /** @type {Runner} */
  const entry = (c, args, cwd, env) => {
    const p = spawnSync(path.join(ROOT, 'mhw'), [c.cmd, ...args], { cwd, env: { ...env, PATH: path.dirname(process.execPath) + ':' + env.PATH }, encoding: 'utf8' });
    return { code: p.status, stdout: p.stdout, stderr: p.stderr };
  };
  const diffs = [];
  for (const name of ['report-usage-json', 'prepare-handoff-without-next-act', 'block-codex', 'refuse-controls', 'resolve-consumed-alias']) {
    const c = /** @type {Case} */ (CASES.find((k) => k.name === name));
    diffs.push(...differences(name, golden[name], transcript(c, entry)));
  }
  assert.deepEqual(diffs, []);
  // Without node on PATH, ./mhw (a Node file since #495) fails at its #! line and runs nothing.
  if (!fs.existsSync('/usr/bin/node') && !fs.existsSync('/bin/node')) {
    for (const cmd of ['worklog', 'launch-line']) {
      const p = spawnSync(path.join(ROOT, 'mhw'), [cmd, '--help'], { env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
      assert.notEqual(p.status, 0);
      assert.equal(p.stdout, '');
    }
  }
});

test('the Python originals, their suite and confine.py (their last importer gone with S04) are deleted', () => {
  for (const f of ['worklog.py', 'worklog.test.py', 'launch-line.py', 'confine.py']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'method', 'scripts', f)), f + ' still exists');
  }
});
