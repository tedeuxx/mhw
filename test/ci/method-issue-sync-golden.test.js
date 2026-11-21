// S30 parity (#500, convention 3 of #470): .github/scripts/method-issue-sync.js against the deleted
// .github/scripts/method_issue_sync.py, on test/helpers/s30-cases.js.
//   golden: the Node script, with the stub gh ported to JavaScript, against the transcripts recorded from
//           the Python script with the suite's own Python stub gh: each step's exit code, stdout and
//           stderr, every gh call and its token (by name), the Issues afterwards and the files written.
//           final-line and verify are among the cases, so a refused or abandoned sync stays red.
//   live:   while the base revision still holds the Python (until this slice merges), on the CPython the
//           goldens were recorded from: the original with its own Python stub beside the Node script with
//           the JavaScript stub. MHW_UPDATE_GOLDEN=1 rewrites the goldens from the original, never from
//           the Node side. MHW_S30_LIVE_REQUIRED=1 turns a skip into a failure while the base holds it.
// POSIX only: the stub gh is an executable script on PATH, and the sync runs on ubuntu-latest.
// Intended differences are in test/golden/S30/expected-differences.json, each with its reason.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { CASES } from '../helpers/s30-cases.js';
import { ROOT, transcript, nodeRunner, pythonRunner, differences } from '../helpers/s30.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';

const SLICE = 'S30';
const POSIX = process.platform !== 'win32';
const REQUIRED = process.env.MHW_S30_LIVE_REQUIRED === '1';
/** @type {import('../helpers/s30.js').ExpectedDifference[]} */
const expected = readGolden(SLICE, 'expected-differences.json');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

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
  // The verbs the acceptance criteria name are in the goldens: a refused or abandoned sync is red.
  const verify = golden.verify.steps.map((/** @type {{ code: number }} */ s) => s.code);
  assert.deepEqual(verify, [1, 1, 0, 0, 1]);
  const final = golden['final-line-never-fails-and-withholds'].steps.map((/** @type {{ code: number }} */ s) => s.code);
  assert.ok(final.every((/** @type {number} */ c) => c === 0), 'final-line reports and never fails');
});

test('golden: the Node script matches the recorded transcripts', { skip: (!POSIX && 'the stub gh is a POSIX executable; the sync runs on ubuntu-latest') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  const golden = readGolden(SLICE, 'transcripts.json');
  const diffs = [];
  for (const c of CASES) diffs.push(...differences(c.name, golden[c.name], transcript(c, nodeRunner), expected));
  assert.deepEqual(diffs, []);
});

/** The base revision's sync script and its suite's Python stub gh, or why they are not here. */
function pythonBase() {
  if (!POSIX) return 'needs POSIX';
  const py = which('python3');
  const git = which('git');
  if (!py || !git) return 'needs python3 and git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(git, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 's30-base-')));
  cleanups.push(() => fs.rmSync(dest, { recursive: true, force: true }));
  if (!extractRevision(ROOT, base, path.join(dest, 'tree'))) return 'base revision ' + base + ' is not readable here';
  const scripts = path.join(dest, 'tree', '.github', 'scripts');
  const script = path.join(scripts, 'method_issue_sync.py');
  if (!fs.existsSync(script)) return 'retired: the base revision no longer holds method_issue_sync.py (this slice has merged)';
  const suite = fs.readFileSync(path.join(scripts, 'method_issue_sync_test.py'), 'utf8');
  const m = /STUB_GH = r'''([\s\S]*?)'''/.exec(suite);
  if (!m) return 'the base revision\'s suite carries no STUB_GH';
  const recorded = readGolden(SLICE, 'recorded-from.json').cpython;
  const v = spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim();
  if (v !== recorded) return 'python3 on PATH is ' + (v || 'unknown') + '; the goldens were recorded from CPython ' + recorded + ', and only that one is compared';
  return { py, script, stub: m[1] };
}

test('live: the original with its Python stub beside the Node script with the JavaScript stub', (t) => {
  const base = pythonBase();
  if (typeof base === 'string') {
    if (REQUIRED && !base.startsWith('retired:')) assert.fail('MHW_S30_LIVE_REQUIRED=1 and the live arm cannot run: ' + base);
    t.skip(base);
    return;
  }
  const python = pythonRunner(base.py, base.script);
  /** @type {Record<string, unknown>} */
  const recorded = {};
  const diffs = [];
  for (const c of CASES) {
    const original = transcript(c, python, { pythonStub: base.stub, python: base.py });
    recorded[c.name] = original;
    diffs.push(...differences(c.name, original, transcript(c, nodeRunner), expected));
  }
  if (UPDATE) writeGolden(SLICE, 'transcripts.json', recorded);
  assert.deepEqual(diffs, []);
});

test('the Python originals are deleted', () => {
  for (const f of ['method_issue_sync.py', 'method_issue_sync_test.py']) {
    assert.ok(!fs.existsSync(path.join(ROOT, '.github', 'scripts', f)), f + ' still exists');
  }
});
