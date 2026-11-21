// S29 parity (#499, convention 3 of #470): `mhw delivery-gate` in Node (src/commands/delivery-gate.js)
// against the deleted global/project-policy/delivery_gate.py, on the cases of test/helpers/s29-cases.js.
// Every run is in a throwaway directory, which is the case's HOME and (unless it names one under it) its
// working directory.
//   golden: `node bin/mhw.js delivery-gate <args>` against the transcripts recorded from the Python original
//           (exit code, stdout, stderr). Every OS; cases marked posix on POSIX only.
//   live:   where the base revision still holds delivery_gate.py and the recorded CPython is on PATH, the
//           Python original (which runs the base's `node bin/mhw.js policy check` with PATH's node) and the
//           Node command side by side on every case. POSIX only.
//           MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from the Python side, never the Node side.
// The intended differences are test/golden/S29/expected-differences.json; each is applied to both sides,
// so everything around it is still compared.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';
import { CASES, FIXTURE } from '../helpers/s29-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S29';
const MADR_PATH = 'docs/adr/0001-fixture-quality-bar.md';
const MADR = '# 0001 — Fixture quality bar and deployment-risk model\n\n- **Status:** accepted\n- **Date:** 2026-11-07\n';
/** Code-unit order, explicit. @param {string} a @param {string} b */
const byString = (a, b) => Number(a > b) - Number(a < b);
const POSIX = process.platform !== 'win32';
const ROOTLESS = !POSIX || (typeof process.getuid === 'function' && process.getuid() !== 0);
const IN_A_CONTAINER = fs.existsSync('/.dockerenv');
const declared = readGolden(SLICE, 'expected-differences.json');
/** @type {Array<{ case: string, stream: string, pattern: string, flags?: string, replace?: string, why: string }>} */
const expected = declared.differences;
const recordedFrom = readGolden(SLICE, 'recorded-from.json');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {import('../helpers/s29-cases.js').Case} Case
 * @typedef {{ code: number | null, stdout: string, stderr: string }} Run
 * @typedef {{ name: string, args: string[], run: Run }} Transcript
 * @typedef {(args: string[], env: Record<string, string>, cwd: string) => Run} Runner
 */

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s29-' + label + '-')));
  cleanups.push(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // a mode-000 file is chmod-ed back before this runs; anything left is the OS temp directory's
    }
  });
  return dir;
}

/**
 * On Windows every backslash compares as /, on both sides: the recording is macOS.
 * @param {string} s
 */
const separators = (s) => (POSIX ? s : s.replaceAll('\\', '/'));

/** @param {string} base @param {string} rel */
const under = (base, rel) => path.join(base, ...rel.split('/'));

/**
 * Write the case's files and run it with runner; the transcript.
 * @param {Case} c
 * @param {Runner} runner
 * @returns {Transcript}
 */
function transcript(c, runner) {
  const base = path.join(freshDir('case'), 'case');
  fs.mkdirSync(path.join(base, 'project', 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(base, 'project', 'project-policy.json'), JSON.stringify(c.contract || FIXTURE, null, 2) + '\n');
  fs.writeFileSync(under(base, 'project/' + MADR_PATH), MADR);
  const modes = [];
  for (const [rel, f] of Object.entries(c.files || {})) {
    const p = under(base, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.rmSync(p, { force: true });
    if (f.dir) fs.mkdirSync(p, { recursive: true });
    else if (f.link !== undefined) fs.symlinkSync(under(base, f.link), p);
    else if (f.doc !== undefined) fs.writeFileSync(p, JSON.stringify(f.doc, null, 2) + '\n');
    else if (f.hex !== undefined) fs.writeFileSync(p, Buffer.from(f.hex, 'hex'));
    else fs.writeFileSync(p, /** @type {string} */ (f.text));
    if (f.mode !== undefined) {
      fs.chmodSync(p, f.mode);
      modes.push(p);
    }
  }
  const args = c.args.map((a) => a.split('{BASE}').join(base).split('/').join(POSIX ? '/' : path.sep));
  /** @type {Record<string, string>} */
  const env = { PATH: process.env.PATH || '', HOME: base, USERPROFILE: base, LANG: 'en_US.UTF-8' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const r = runner(args, env, c.cwd ? under(base, c.cwd) : base);
  for (const p of modes) fs.chmodSync(p, 0o600);
  /** @param {string} s */
  const norm = (s) => s.split(base).join('<BASE>');
  return { name: c.name, args: c.args, run: { code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr) } };
}

/** The Node command, as a CI step runs it. @type {Runner} */
const nodeRunner = (args, env, cwd) => {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'delivery-gate', ...args], { env, cwd, encoding: 'utf8', timeout: 60000 });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

/** @param {string} name @param {string} stream @param {string} textIn */
function fold(name, stream, textIn) {
  let out = textIn;
  for (const e of expected) {
    if ((e.case === name || e.case === '*') && e.stream === stream) {
      out = out.replace(new RegExp(e.pattern, e.flags || 'g'), e.replace ?? '<DECLARED>');
    }
  }
  return out;
}

/** @param {Transcript} original @param {Transcript} head */
function differences(original, head) {
  /** @type {string[]} */
  const diffs = [];
  if (original.run.code !== head.run.code) diffs.push(head.name + ': exit ' + original.run.code + ' -> ' + head.run.code);
  for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
    if (separators(fold(head.name, stream, original.run[stream])) !== separators(fold(head.name, stream, head.run[stream]))) {
      diffs.push(head.name + ': ' + stream + ' differs\n--- original\n' + original.run[stream] + '\n--- head\n' + head.run[stream]);
    }
  }
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

/** @param {Case} c */
const skipReason = (c) => {
  if (c.posix && !POSIX) return 'POSIX only';
  if (c.notRoot && !ROOTLESS) return 'a mode-000 file is readable by root';
  if (c.host && IN_A_CONTAINER) return 'it asserts the host answer, and this run is in a container';
  return '';
};

test('every case has a golden transcript and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const e of expected) {
    assert.ok(e.case === '*' || names.has(e.case), 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
    assert.doesNotThrow(() => new RegExp(e.pattern, e.flags || 'g'), 'a valid pattern: ' + e.pattern);
  }
  for (const r of declared.residuals) assert.ok(r.what && r.why && r.why.length > 40, 'a residual states why');
  const golden = fs.readdirSync(path.join(ROOT, 'test', 'golden', SLICE, 'transcripts')).sort(byString);
  assert.deepEqual(golden, [...names].map((n) => n + '.json').sort(byString), 'no golden without its case');
});

test('golden: the Node command matches the Python original\'s transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    const original = readGolden(SLICE, goldenName(c.name));
    assert.deepEqual(original.args, c.args, c.name + ': the case still has the arguments it was recorded with');
    diffs.push(...differences(original, transcript(c, nodeRunner)));
  }
  assert.deepEqual(diffs, []);
});

test('golden: the recording exercised every exit, every gate and every class of block', () => {
  // A guard against a recording that silently checked nothing: all three exits occur, every gate passed once
  // and blocked once, and every reason the original could give appears in some transcript.
  const runs = CASES.map((c) => /** @type {Run} */ (readGolden(SLICE, goldenName(c.name)).run));
  assert.deepEqual([...new Set(runs.map((r) => r.code))].sort((a, b) => Number(a) - Number(b)), [0, 1, 2]);
  const all = runs.map((r) => r.stdout + r.stderr).join('\n');
  for (const line of ['OK  contract: valid', 'OK  container: complete green evidence', 'OK  installed-stg: STG runs',
    'class=low', 'class=high', 'approval=owner-exact-revision', 'approval=automatic-after-all-gates', 'OK  environment: ',
    'mode=automatic-rollback', 'rollback_target=none', 'mode=manual', 'operator=@operator-one', 'OK  prod-validation: PROD runs']) {
    assert.ok(all.includes(line), line);
  }
  for (const reason of ['BLOCK  contract: FAIL', 'it governs tedeuxx/mhw', 'is missing, unreadable or outside the project',
    'has no status line reading accepted', 'the recovery runbook', 'not pinned by digest', 'not running in a container',
    'the evidence names image', 'the checkout is at', 'the evidence names revision', 'must be a full 40-character commit SHA',
    'unknown key(s)', 'evidence layer is', 'test_layers missing or empty', 'has no result (missing mandatory evidence)',
    'is not in the contract', 'inconclusive evidence blocks', ', not pass', 'findings missing', 'is not an object',
    'carries unknown key(s)', 'unclassified findings block', 'is not on the scale (unknown severity)', 'does not tolerate',
    'tolerated low finding without a bug Issue', 'coverage missing', 'the contract counts', 'is not a percentage from 0 to 100',
    'is below the threshold', 'STG reports it runs', 'installed security validation', 'no rule matched', 'is not a rule index',
    'the protection read is for', 'has no required reviewer', 'missing or unreadable', 'is malformed (', 'is not a JSON object',
    "codec can't decode byte", "codec can't decode bytes", 'not a full commit SHA or none', 'no previous version to return to',
    'the runbook docs/recovery-runbook.md is missing', 'has no test record dated', 'over the recovery-time objective',
    'PROD reports it runs', 'not prod', 'unknown, empty or repeated argument', 'needs --', 'classify needs exactly one',
    'environment needs --name and --protection', 'a gate: contract, container']) {
    assert.ok(all.includes(reason), reason);
  }
});

// CI sets MHW_S29_LIVE_REQUIRED=1 in a step that installs the recorded CPython: there, a base that still
// holds delivery_gate.py with any other python3 (or none) is a failure, not a skip.
const LIVE_REQUIRED = process.env.MHW_S29_LIVE_REQUIRED === '1';

/**
 * The base revision's tree and the recorded CPython; or why they are not here, and whether that is a
 * failure (MHW_S29_LIVE_REQUIRED=1 and the base still holds delivery_gate.py).
 * @returns {{ py?: string, tree?: string, why?: string, fail?: boolean }}
 */
function pythonBase() {
  if (!POSIX) return { why: 'POSIX only' };
  const git = which('git');
  if (!git) return { why: 'needs git on PATH', fail: LIVE_REQUIRED };
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(git, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return { why: 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)', fail: LIVE_REQUIRED };
  const tree = path.join(freshDir('base'), 'tree');
  if (!extractRevision(ROOT, base, tree)) return { why: 'base revision ' + base + ' is not readable here', fail: LIVE_REQUIRED };
  if (!fs.existsSync(path.join(tree, 'global', 'project-policy', 'delivery_gate.py'))) {
    return { why: 'the base revision no longer holds delivery_gate.py (this slice has merged)' };
  }
  const py = which('python3');
  if (!py) return { why: 'needs python3 on PATH', fail: LIVE_REQUIRED };
  const version = spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim();
  if (version !== recordedFrom.cpython) {
    return { why: 'the goldens were recorded from CPython ' + recordedFrom.cpython + ', python3 here is ' + version, fail: LIVE_REQUIRED };
  }
  if (!which('node')) return { why: 'the original runs `node` from PATH, and there is none', fail: LIVE_REQUIRED };
  return { py, tree };
}

/** The base tree's delivery_gate.py, its python3 first on PATH. @param {string} py @param {string} tree @returns {Runner} */
const pythonRunner = (py, tree) => (args, env, cwd) => {
  const p = spawnSync(py, ['-B', path.join(tree, 'global', 'project-policy', 'delivery_gate.py'), ...args], {
    env: { ...env, PATH: path.dirname(py) + path.delimiter + env.PATH, PYTHONIOENCODING: 'utf-8' }, cwd, encoding: 'utf8', timeout: 120000,
  });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

test('live: the Python original and the Node command side by side', (t) => {
  const b = pythonBase();
  if (!b.tree || !b.py) {
    if (b.fail) assert.fail('MHW_S29_LIVE_REQUIRED=1: ' + b.why);
    t.skip(b.why);
    return;
  }
  const python = pythonRunner(b.py, b.tree);
  const diffs = [];
  for (const c of CASES) {
    if (skipReason(c)) continue;
    const original = transcript(c, python);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), original);
    diffs.push(...differences(original, transcript(c, nodeRunner)));
  }
  assert.deepEqual(diffs, []);
});
