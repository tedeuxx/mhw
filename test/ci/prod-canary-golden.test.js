// S31 parity (#501, convention 3 of #470): .github/scripts/prod-canary.js against the deleted
// .github/scripts/prod_canary.py, on test/helpers/s31-cases.js, in a fixture repository whose package is
// a fake mhw (test/helpers/s31-fixture/).
//   golden: the Node script against the transcripts recorded from the Python script: each step's exit
//           code, stdout and stderr, and the files of every tarball pack wrote.
//   live:   while the base revision still holds the Python (until this slice merges), on the CPython the
//           goldens were recorded from: the original beside the Node script. MHW_UPDATE_GOLDEN=1 rewrites
//           the goldens from the original, never from the Node side. MHW_S31_LIVE_REQUIRED=1 turns a skip
//           into a failure while the base holds it.
// POSIX only: the canary runs hooks through /bin/sh, and runs on ubuntu-latest and macos-latest. Each case
// installs the fake package with npm, offline (about a minute for all of them).
// Intended differences are in test/golden/S31/expected-differences.json, each with its reason.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CASES } from '../helpers/s31-cases.js';
import { ROOT, transcript, nodeRunner, pythonRunner, differences } from '../helpers/s31.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';

const SLICE = 'S31';
const POSIX = process.platform !== 'win32';
const REQUIRED = process.env.MHW_S31_LIVE_REQUIRED === '1';
/** @type {{ differences: import('../helpers/s31.js').ExpectedDifference[], residuals: Array<{ what: string, why: string, pinned: string }> }} */
const declared = readGolden(SLICE, 'expected-differences.json');
const expected = declared.differences;
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));
const TOOLS = POSIX && which('npm') && which('git') && which('jq') ? '' : 'needs npm, git and jq on PATH';

test('every case has a golden transcript and every expected difference names a case', () => {
  const golden = readGolden(SLICE, 'transcripts.json');
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(golden[c.name], 'no golden for ' + c.name);
  assert.deepEqual(Object.keys(golden).sort((a, b) => a.localeCompare(b)), [...names].sort((a, b) => a.localeCompare(b)), 'no golden without its case');
  for (const e of expected) {
    for (const name of e.case) assert.ok(names.has(name) || name === '*', 'unknown case ' + name);
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
    for (const side of /** @type {const} */ (['base', 'head'])) if (e[side]) new RegExp(e[side]);
  }
  const suite = fs.readFileSync(path.join(ROOT, 'test', 'ci', 'prod-canary.test.js'), 'utf8');
  for (const r of declared.residuals) {
    assert.ok(r.what && r.why && r.why.length > 40, 'a residual states why');
    const cut = r.pinned.indexOf(': ');
    const [file, title] = [r.pinned.slice(0, cut), r.pinned.slice(cut + 2)];
    assert.equal(file, 'test/ci/prod-canary.test.js');
    assert.ok(suite.includes("test('" + title + "'"), 'no test named ' + title);
  }
  // The goldens are not vacuous: the good runs pass every check, and the broken run fails.
  const good = golden['run-good'].steps;
  assert.equal(good[2].code, 0, 'a fresh install of the good package passes');
  assert.equal(good[3].code, 0, 'an upgrade passes');
  assert.match(good[2].stdout, /==> fresh: 0 failure\(s\)\n$/);
  assert.ok((good[2].stdout.match(/^PASS {2}/gm) || []).length >= 30, 'the good run printed its PASS lines');
  assert.equal(good[4].code, 1, 'a stamp naming another commit fails');
  const broken = golden['run-broken'].steps[1];
  assert.equal(broken.code, 1);
  assert.ok((broken.stdout.match(/^FAIL {2}/gm) || []).length >= 10, 'the broken package fails many checks');
  for (const c of Object.values(golden)) for (const s of c.steps) assert.doesNotMatch(s.stdout + s.stderr, /Traceback/);
});

test('golden: the Node script matches the recorded transcripts', { skip: (!POSIX && 'the canary runs hooks through /bin/sh') || TOOLS || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  const golden = readGolden(SLICE, 'transcripts.json');
  const diffs = [];
  for (const c of CASES) diffs.push(...differences(c.name, golden[c.name], transcript(c, nodeRunner), expected));
  assert.deepEqual(diffs, []);
});

/** The base revision's prod_canary.py, or why it is not here. */
function pythonBase() {
  if (!POSIX) return 'needs POSIX';
  if (TOOLS) return TOOLS;
  const py = which('python3');
  const git = which('git');
  if (!py || !git) return 'needs python3 and git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(git, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 's31-base-')));
  cleanups.push(() => fs.rmSync(dest, { recursive: true, force: true }));
  if (!extractRevision(ROOT, base, path.join(dest, 'tree'))) return 'base revision ' + base + ' is not readable here';
  const script = path.join(dest, 'tree', '.github', 'scripts', 'prod_canary.py');
  if (!fs.existsSync(script)) return 'retired: the base revision no longer holds prod_canary.py (this slice has merged)';
  const recorded = readGolden(SLICE, 'recorded-from.json').cpython;
  const v = spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim();
  if (v !== recorded) return 'python3 on PATH is ' + (v || 'unknown') + '; the goldens were recorded from CPython ' + recorded + ', and only that one is compared';
  return { py, text: fs.readFileSync(script, 'utf8') };
}

test('live: the original beside the Node script', (t) => {
  const base = pythonBase();
  if (typeof base === 'string') {
    if (REQUIRED && !base.startsWith('retired:')) assert.fail('MHW_S31_LIVE_REQUIRED=1 and the live arm cannot run: ' + base);
    t.skip(base);
    return;
  }
  const python = pythonRunner(base.py, base.text);
  /** @type {Record<string, unknown>} */
  const recorded = {};
  const diffs = [];
  for (const c of CASES) {
    const original = transcript(c, python);
    recorded[c.name] = original;
    if (!UPDATE) diffs.push(...differences(c.name, original, transcript(c, nodeRunner), expected));
  }
  if (UPDATE) writeGolden(SLICE, 'transcripts.json', recorded);
  assert.deepEqual(diffs, []);
});

test('the originals are deleted', () => {
  for (const f of ['prod_canary.py', 'prod-canary-container.sh']) {
    assert.ok(!fs.existsSync(path.join(ROOT, '.github', 'scripts', f)), f + ' still exists');
  }
});
