// S28 parity (#498, convention 3 of #470): `mhw policy` in Node (src/commands/project-policy.js) against
// the deleted global/project-policy/project_policy.py, reached as `./mhw policy ...` (global/workstation.py),
// on the cases of test/helpers/s28-cases.js. Every run is in a throwaway directory, which is the case's
// working directory and HOME.
//   golden: `node bin/mhw.js policy <args>` against the transcripts recorded from the Python original (exit
//           code, stdout, stderr). Every OS; cases marked posix on POSIX only.
//   live:   where the base revision still holds project_policy.py and the recorded CPython is on PATH, the
//           Python original and the Node command side by side on every case. POSIX only.
//           MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from the Python side, never the Node side.
// The intended differences are test/golden/S28/expected-differences.json; each is applied to both sides,
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
import { CASES } from '../helpers/s28-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S28';
/** Code-unit order, explicit. @param {string} a @param {string} b */
const byString = (a, b) => Number(a > b) - Number(a < b);
const POSIX = process.platform !== 'win32';
const ROOTLESS = !POSIX || (typeof process.getuid === 'function' && process.getuid() !== 0);
const declared = readGolden(SLICE, 'expected-differences.json');
/** @type {Array<{ case: string, stream: string, pattern: string, flags?: string, replace?: string, why: string }>} */
const expected = declared.differences;
const recordedFrom = readGolden(SLICE, 'recorded-from.json');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {import('../helpers/s28-cases.js').Case} Case
 * @typedef {{ code: number | null, stdout: string, stderr: string }} Run
 * @typedef {{ name: string, args: string[], run: Run }} Transcript
 * @typedef {(args: string[], env: Record<string, string>, cwd: string) => Run} Runner
 */

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s28-' + label + '-')));
  cleanups.push(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // a mode-000 file under a read-only parent; the next chmod pass removes it
    }
  });
  return dir;
}

/**
 * The normaliser: the case directory becomes <BASE>.
 * @param {string} base
 */
function normaliser(base) {
  return (/** @type {string} */ s) => s.split(base).join('<BASE>');
}

/**
 * On Windows every backslash compares as /, on both sides: the recording is macOS, where a joined or
 * relative path is written with /, and pathlib on Windows writes it with a backslash.
 * @param {string} s
 */
const separators = (s) => (POSIX ? s : s.replaceAll('\\', '/'));

/**
 * Write the case's files and run it with runner; the transcript.
 * @param {Case} c
 * @param {Runner} runner
 * @returns {Transcript}
 */
function transcript(c, runner) {
  const base = path.join(freshDir('case'), 'case');
  fs.mkdirSync(base, { recursive: true });
  const modes = [];
  for (const [rel, f] of Object.entries(c.files || {})) {
    const p = path.join(base, ...rel.split('/'));
    fs.mkdirSync(path.dirname(p), { recursive: true });
    if (f.doc !== undefined) fs.writeFileSync(p, JSON.stringify(f.doc, null, 2) + '\n');
    else if (f.hex !== undefined) fs.writeFileSync(p, Buffer.from(f.hex, 'hex'));
    else fs.writeFileSync(p, /** @type {string} */ (f.text));
    if (f.mode !== undefined) {
      fs.chmodSync(p, f.mode);
      modes.push(p);
    }
  }
  const args = ['policy', ...c.args.map((a) => a.split('{BASE}').join(base).split('/').join(POSIX ? '/' : path.sep))];
  /** @type {Record<string, string>} */
  const env = { PATH: process.env.PATH || '', HOME: base, USERPROFILE: base, LANG: 'en_US.UTF-8' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  const r = runner(args, env, base);
  for (const p of modes) fs.chmodSync(p, 0o600);
  const norm = normaliser(base);
  return { name: c.name, args: c.args, run: { code: r.code, stdout: norm(r.stdout), stderr: norm(r.stderr) } };
}

/** The Node command, as a user runs it. @type {Runner} */
const nodeRunner = (args, env, cwd) => {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), ...args], { env, cwd, encoding: 'utf8', timeout: 60000 });
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
  return '';
};

test('every case has a golden transcript and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const e of expected) {
    assert.ok(e.case === '*' || names.has(e.case), 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
    assert.ok(new RegExp(e.pattern, e.flags || 'g'));
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

test('golden: the recording exercised every exit and every class', () => {
  // A guard against a recording that silently checked nothing: all three exits occur, and every reason the
  // original could give appears in some transcript.
  const runs = CASES.map((c) => readGolden(SLICE, goldenName(c.name)).run);
  assert.deepEqual([...new Set(runs.map((/** @type {Run} */ r) => r.code))].sort((a, b) => Number(a) - Number(b)), [0, 1, 2]);
  const all = runs.map((/** @type {Run} */ r) => r.stdout + r.stderr).join('\n');
  for (const reason of ['unknown version', 'missing or invalid risk classification', 'risk-based approval weakened',
    'coverage below the mhw floor of 85 percent', 'baseline override invalid (it may only add)', 'missing mandatory evidence',
    'project MADR not ratified', 'inconclusive evidence does not block', 'medium-or-higher findings tolerated', 'unknown severity',
    'low finding without a bug Issue', 'recovery not prepared', 'contract invalid', 'FAIL  missing: ', 'FAIL  unreadable: ',
    'FAIL  malformed: not JSON (', 'FAIL  malformed: repeated key', 'FAIL  malformed: NaN is not JSON', 'FAIL  malformed: not UTF-8',
    'is a valid project-policy contract', 'unknown argument', 'exclude each other', 'policy takes one subcommand']) {
    assert.ok(all.includes(reason), reason);
  }
});

// CI sets MHW_S28_LIVE_REQUIRED=1 in a step that installs the recorded CPython: there, a base that still
// holds project_policy.py with any other python3 (or none) is a failure, not a skip.
const LIVE_REQUIRED = process.env.MHW_S28_LIVE_REQUIRED === '1';

/**
 * The base revision's tree and the recorded CPython; or why they are not here, and whether that is a
 * failure (MHW_S28_LIVE_REQUIRED=1 and the base still holds project_policy.py).
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
  if (!fs.existsSync(path.join(tree, 'global', 'project-policy', 'project_policy.py'))) {
    return { why: 'the base revision no longer holds project_policy.py (this slice has merged)' };
  }
  const py = which('python3');
  if (!py) return { why: 'needs python3 on PATH', fail: LIVE_REQUIRED };
  const version = spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim();
  if (version !== recordedFrom.cpython) {
    return { why: 'the goldens were recorded from CPython ' + recordedFrom.cpython + ', python3 here is ' + version, fail: LIVE_REQUIRED };
  }
  return { py, tree };
}

/** `./mhw policy ...` of the base tree, its python3 first on PATH. @param {string} py @param {string} tree @returns {Runner} */
const pythonRunner = (py, tree) => (args, env, cwd) => {
  const p = spawnSync('/bin/sh', [path.join(tree, 'mhw'), ...args], {
    env: { ...env, PATH: path.dirname(py) + path.delimiter + env.PATH, PYTHONIOENCODING: 'utf-8' }, cwd, encoding: 'utf8', timeout: 120000,
  });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

test('live: the Python original and the Node command side by side', (t) => {
  const b = pythonBase();
  if (!b.tree || !b.py) {
    if (b.fail) assert.fail('MHW_S28_LIVE_REQUIRED=1: ' + b.why);
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
