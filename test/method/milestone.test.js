// S04 parity (#475, convention 3 of #470): `mhw milestone read|create|update|close` against the deleted
// method/scripts/milestone-*.py, on the cases of their own suite (test/golden/S04/cases.json).
//   golden: the Node routes, with the Node port of the suite's stub gh, against the transcripts recorded
//           from the Python routes with the Python stub (stdout, stderr, exit code, every gh argv, the
//           stub's final state). Runs on every OS.
//   live:   where the base revision still holds the Python routes (until this slice merges) and python3
//           is on PATH, the Python routes and the Node routes run side by side against the base's OWN
//           Python stub, read out of its milestone.test.py. POSIX only. MHW_UPDATE_GOLDEN=1 rewrites the
//           golden transcripts from the Python side, never from the Node side.
//   cli:    the same cases through bin/mhw.js with a stub gh on PATH (POSIX: the stub is a shell script).
// Intended differences are in test/golden/S04/expected-differences.json, each with its reason.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run } from '../../src/commands/milestone.js';
import { runAbsolute } from '../../src/lib/run.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S04';
const POSIX = process.platform !== 'win32';
const NODE_STUB = path.join(ROOT, 'test', 'helpers', 'milestone-stub.js');
const spec = readGolden(SLICE, 'cases.json');
/** @type {Array<{ case: string, stream: 'stdout' | 'stderr', base: string, head: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const GIT = which('git');
const PY = which('python3');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {{ verb: string, args: string[], env?: Record<string, string>, cwd?: string }} Step
 * @typedef {{ name: string, steps: Step[], files?: Record<string, string>, links?: Record<string, string>,
 *   milestone?: Record<string, unknown>, tree?: boolean, posix?: boolean, outsideTmp?: boolean, symlinkRoot?: boolean }} Case
 * @typedef {{ code: number, stdout: string, stderr: string, gh: string[][] }} StepResult
 * @typedef {{ name: string, steps: StepResult[], state: unknown }} Transcript
 * @typedef {(step: Step, cwd: string, env: Record<string, string>) => { code: number, stdout: string, stderr: string }} Runner
 */

/** @type {Case[]} */
const CASES = spec.cases;

/** A fresh directory for one case, resolved, and not under /tmp when the OS temp dir is elsewhere. */
function freshBase() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s04-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** @param {string} dir */
const underSlashTmp = (dir) => POSIX && fs.existsSync('/tmp') && (dir + '/').startsWith(fs.realpathSync('/tmp') + '/');

/**
 * Why c cannot run here, or ''.
 * @param {Case} c
 */
function skipReason(c) {
  if (c.posix && !POSIX) return 'needs POSIX symbolic links and /etc';
  if (c.tree && !GIT) return 'needs git on PATH';
  if (c.outsideTmp && underSlashTmp(os.tmpdir())) return 'the temporary directory is under /tmp, an allowed root; set TMPDIR elsewhere';
  return '';
}

/**
 * Lay out one case and return its placeholders and environment.
 * @param {Case} c
 */
function setup(c) {
  const base = freshBase();
  const tmpd = path.join(base, 'tmp');
  const tree = path.join(base, 'tree');
  fs.mkdirSync(tmpd);
  const subs = /** @type {Record<string, string>} */ ({ '{BASE}': base, '{TMPD}': tmpd, '{TREE}': tree, '{FSROOT}': path.parse(base).root });
  /** @param {string} s */
  const fill = (s) => Object.entries(subs).reduce((acc, [k, v]) => acc.split(k).join(v), s);
  if (c.tree) {
    fs.mkdirSync(tree);
    assert.equal(spawnSync(/** @type {string} */ (GIT), ['init', '-q', tree]).status, 0);
  }
  if (c.symlinkRoot) {
    fs.mkdirSync(path.join(base, 'tmpx'));
    fs.mkdirSync(path.join(base, 'tmpxX'));
  }
  for (const [p, content] of Object.entries(c.files || {})) {
    const f = fill(p);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
  for (const [p, target] of Object.entries(c.links || {})) fs.symlinkSync(target, fill(p));
  const state = path.join(base, 'state.json');
  fs.writeFileSync(state, JSON.stringify({ milestone: { ...spec.milestone, ...(c.milestone || {}) } }));
  const log = path.join(base, 'gh.log');
  /** @type {Record<string, string>} */
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
  Object.assign(env, { MILESTONE_STUB_STATE: state, MILESTONE_STUB_LOG: log, PYTHONDONTWRITEBYTECODE: '1',
    TMPDIR: c.symlinkRoot ? path.join(base, 'tmpx') : tmpd });
  delete env.MILESTONE_STUB_FAIL;
  delete env.MILESTONE_STUB_RACE_AFTER_GET;
  return { base, fill, env, state, log };
}

/**
 * Normalise a stream: the case's directory to <BASE>, CRLF to LF, and on Windows path separators.
 * @param {string} s
 * @param {string} base
 */
function norm(s, base) {
  let out = s.replace(/\r\n/g, '\n').split(base).join('<BASE>');
  if (!POSIX) out = out.split(base.replace(/\\/g, '/')).join('<BASE>').replace(/\\/g, '/');
  return out;
}

/**
 * Run every step of c with runner; the transcript.
 * @param {Case} c
 * @param {Runner} runner
 * @param {(env: Record<string, string>, base: string) => void} [prepare]
 * @returns {Transcript}
 */
function transcript(c, runner, prepare) {
  const s = setup(c);
  if (prepare) prepare(s.env, s.base);
  /** @type {StepResult[]} */
  const steps = [];
  for (const step of c.steps) {
    fs.rmSync(s.log, { force: true });
    const env = { ...s.env, ...(step.env || {}) };
    const filled = { ...step, args: step.args.map(s.fill) };
    const r = runner(filled, s.fill(step.cwd || '{BASE}'), env);
    const gh = fs.existsSync(s.log) ? fs.readFileSync(s.log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l).map((/** @type {string} */ a) => norm(a, s.base))) : [];
    steps.push({ code: r.code, stdout: norm(r.stdout, s.base), stderr: norm(r.stderr, s.base), gh });
  }
  return { name: c.name, steps, state: sortKeys(JSON.parse(fs.readFileSync(s.state, 'utf8'))) };
}

/** @param {unknown} v @returns {unknown} */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    return Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(/** @type {Record<string, unknown>} */ (v)[k])]));
  }
  return v;
}

/**
 * The Node routes in this process, with gh = node <stub> (or python3 <stub>).
 * @param {string[]} stub the program and its first argument
 * @returns {Runner}
 */
const nodeRunner = (stub) => (step, cwd, env) => {
  let out = '';
  let err = '';
  const code = run([step.verb, ...step.args], {
    cwd, env, out: (x) => { out += x; }, err: (x) => { err += x; },
    gh: (args) => runAbsolute(stub[0], [...stub.slice(1), ...args], { cwd, env }),
  });
  return { code, stdout: out, stderr: err };
};

/**
 * The transcripts compared, after each expected difference drops its lines from both sides.
 * @param {Transcript} original
 * @param {Transcript} head
 */
function differences(original, head) {
  const diffs = [];
  if (original.steps.length !== head.steps.length) return [head.name + ': step count differs'];
  original.steps.forEach((o, i) => {
    const h = head.steps[i];
    const where = head.name + ' step ' + (i + 1);
    if (o.code !== h.code) diffs.push(where + ': exit ' + o.code + ' -> ' + h.code);
    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      const rules = expected.filter((e) => e.case === head.name && e.stream === stream);
      /** @param {string} text @param {'base' | 'head'} side */
      const keep = (text, side) => text.split('\n').filter((l) => !rules.some((r) => new RegExp(r[side]).test(l))).join('\n');
      if (keep(o[stream], 'base') !== keep(h[stream], 'head')) diffs.push(where + ': ' + stream + ' differs\n--- original\n' + o[stream] + '\n--- head\n' + h[stream]);
    }
    if (JSON.stringify(o.gh) !== JSON.stringify(h.gh)) diffs.push(where + ': gh argv differs\n' + JSON.stringify(o.gh) + '\n' + JSON.stringify(h.gh));
  });
  if (JSON.stringify(original.state) !== JSON.stringify(head.state)) diffs.push(head.name + ': final stub state differs');
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

test('every case has a golden transcript and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const e of expected) {
    assert.ok(names.has(e.case), 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
    new RegExp(e.base);
    new RegExp(e.head);
  }
});

test('golden: the Node routes match the Python routes\' transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    diffs.push(...differences(readGolden(SLICE, goldenName(c.name)), transcript(c, nodeRunner([process.execPath, NODE_STUB]))));
  }
  assert.deepEqual(diffs, []);
});

/**
 * The base revision's Python routes and its own stub, or a reason they are not readable here.
 * @returns {{ scripts: string, stub: string } | string}
 */
function pythonBase() {
  if (!POSIX) return 'the stub gh is a script on PATH, which Windows cannot spawn without a shell';
  if (!PY || !GIT) return 'needs python3 and git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = freshBase();
  if (!extractRevision(ROOT, base, path.join(dest, 'tree'))) return 'base revision ' + base + ' is not readable here';
  const scripts = path.join(dest, 'tree', 'method', 'scripts');
  const suite = path.join(scripts, 'milestone.test.py');
  if (!fs.existsSync(suite)) return 'the base revision no longer holds the Python milestone routes (this slice has merged)';
  const m = /STUB = r'''([\s\S]*?)'''/.exec(fs.readFileSync(suite, 'utf8'));
  if (!m) return 'the base suite carries no STUB';
  const bin = path.join(dest, 'bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'gh'), m[1]);
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  return { scripts, stub: path.join(bin, 'gh') };
}

test('live: the Python routes and the Node routes side by side, on the base\'s own Python stub', (t) => {
  const pb = pythonBase();
  if (typeof pb === 'string') {
    t.skip(pb);
    return;
  }
  /** @type {Runner} */
  const python = (step, cwd, env) => {
    const e = { ...env, PATH: path.dirname(pb.stub) + path.delimiter + env.PATH };
    const r = runAbsolute(/** @type {string} */ (PY), ['-B', path.join(pb.scripts, 'milestone-' + step.verb + '.py'), ...step.args], { cwd, env: e });
    return { code: r.code, stdout: r.stdout, stderr: r.stderr };
  };
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    const original = transcript(c, python);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), original);
    diffs.push(...differences(original, transcript(c, nodeRunner([/** @type {string} */ (PY), pb.stub]))));
  }
  assert.deepEqual(diffs, []);
});

test('cli: bin/mhw.js milestone runs the same routes, with gh found on PATH', { skip: !POSIX && 'the stub gh is a shell script' }, () => {
  /** @type {Runner} */
  const cli = (step, cwd, env) => {
    const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'milestone', step.verb, ...step.args], { cwd, env, encoding: 'utf8' });
    return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
  };
  /** @param {Record<string, string>} env @param {string} base */
  const prepare = (env, base) => {
    const bin = path.join(base, 'bin');
    fs.mkdirSync(bin);
    const q = (/** @type {string} */ s) => "'" + s.replace(/'/g, "'\\''") + "'";
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexec ' + q(process.execPath) + ' ' + q(NODE_STUB) + ' "$@"\n');
    fs.chmodSync(path.join(bin, 'gh'), 0o755);
    env.PATH = bin + ':' + env.PATH;
  };
  const diffs = [];
  for (const c of CASES) {
    if (skipReason(c)) continue;
    diffs.push(...differences(readGolden(SLICE, goldenName(c.name)), transcript(c, cli, prepare)));
  }
  assert.deepEqual(diffs, []);
  // And with no gh on PATH, a refusal rather than a crash.
  const s = setup(CASES[0]);
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'milestone', 'read', '7', '--repo', 'owner/repo'],
    { cwd: s.base, env: { ...s.env, PATH: path.join(s.base, 'no-such-dir') }, encoding: 'utf8' });
  assert.equal(p.status, 1);
  assert.equal(p.stderr, 'gh failed: gh was not found on PATH\n');
});

test('no inline description option exists, on either write verb', () => {
  for (const verb of ['create', 'update']) {
    let err = '';
    const code = run([verb, '7', '--repo', 'owner/repo', '--description', 'x', '--description-file', 'f', '--expect-file', 'g'], {
      cwd: ROOT, env: {}, out: () => {}, err: (x) => { err += x; },
      gh: () => assert.fail('gh must not run'),
    });
    assert.equal(code, 2);
    assert.match(err, /unrecognized argument: --description\n/);
  }
});

test('the Python routes and their suite are gone; confine.py stays for its remaining importers', () => {
  for (const f of ['milestone-read.py', 'milestone-create.py', 'milestone-update.py', 'milestone-close.py', 'milestone_common.py', 'milestone.test.py']) {
    assert.ok(!fs.existsSync(path.join(ROOT, 'method', 'scripts', f)), f + ' still exists');
  }
  assert.ok(fs.existsSync(path.join(ROOT, 'method', 'scripts', 'confine.py')));
});
