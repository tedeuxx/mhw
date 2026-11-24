// S29 parity (#499, convention 3 of #470): `mhw delivery-gate` in Node (src/commands/delivery-gate.js)
// against the deleted global/project-policy/delivery_gate.py, on the cases of test/helpers/s29-cases.js.
// The harness (golden arm on every OS, live arm on POSIX, MHW_S29_LIVE_REQUIRED, MHW_UPDATE_GOLDEN) is
// test/helpers/policy-golden.js, shared with S28. Every run is in a throwaway directory, the case's HOME
// and, unless it names one under it, its working directory. The live arm's original runs the base's
// `node bin/mhw.js policy check` with PATH's node, as the reference workflow did.
// The intended differences are test/golden/S29/expected-differences.json.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { which } from '../helpers/home.js';
import { harness, POSIX, under, writeFiles, restoreModes, caseRun, normalised } from '../helpers/policy-golden.js';
import { CASES, FIXTURE } from '../helpers/s29-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MADR_PATH = 'docs/adr/0001-fixture-quality-bar.md';
const MADR = '# 0001 — Fixture quality bar and deployment-risk model\n\n- **Status:** accepted\n- **Date:** 2026-11-07\n';
const ROOTLESS = !POSIX || (typeof process.getuid === 'function' && process.getuid() !== 0);
const IN_A_CONTAINER = fs.existsSync('/.dockerenv');
const h = harness({
  root: ROOT, slice: 'S29', original: 'global/project-policy/delivery_gate.py',
  baseCheck: () => (which('node') ? null : 'the original runs `node` from PATH, and there is none'),
});

/**
 * @typedef {import('../helpers/s29-cases.js').Case} Case
 * @typedef {import('../helpers/policy-golden.js').Runner} Runner
 * @typedef {import('../helpers/policy-golden.js').Transcript} Transcript
 */

/**
 * Write the case's project (the frozen fixture, its contract edit and MADR) and files, and run it with
 * runner; the transcript.
 * @param {Case} c @param {Runner} runner @returns {Transcript}
 */
function transcript(c, runner) {
  const base = path.join(h.freshDir('case'), 'case');
  fs.mkdirSync(path.join(base, 'project', 'docs', 'adr'), { recursive: true });
  fs.writeFileSync(path.join(base, 'project', 'project-policy.json'), JSON.stringify(c.contract || FIXTURE, null, 2) + '\n');
  fs.writeFileSync(under(base, 'project/' + MADR_PATH), MADR);
  const modes = writeFiles(base, c.files || {});
  const { args, env } = caseRun(c.args, base, { onlyPaths: true });
  const r = runner(args, env, c.cwd ? under(base, c.cwd) : base);
  restoreModes(modes);
  return { name: c.name, args: c.args, run: normalised(r, base) };
}

/** The Node command, as the delivery gates Action runs it (#592: `mhw delivery-gate` left the CLI). @type {Runner} */
const nodeRunner = (args, env, cwd) => {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'src', 'action', 'gates.js'), 'delivery-gate', ...args], { env, cwd, encoding: 'utf8', timeout: 60000 });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

/** The base tree's delivery_gate.py, its python3 first on PATH. @param {string} py @param {string} tree @returns {Runner} */
const pythonRunner = (py, tree) => (args, env, cwd) => {
  const p = spawnSync(py, ['-B', path.join(tree, 'global', 'project-policy', 'delivery_gate.py'), ...args], {
    env: { ...env, PATH: path.dirname(py) + path.delimiter + env.PATH, PYTHONIOENCODING: 'utf-8' }, cwd, encoding: 'utf8', timeout: 120000,
  });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

/** @param {Case} c */
const skipReason = (c) => {
  if (c.posix && !POSIX) return 'POSIX only';
  if (c.notRoot && !ROOTLESS) return 'a mode-000 file is readable by root';
  if (c.host && IN_A_CONTAINER) return 'it asserts the host answer, and this run is in a container';
  return '';
};

h.inventoryTest(CASES);
h.goldenTest(CASES, transcript, nodeRunner, skipReason);

test('golden: the recording exercised every exit, every gate and every class of block', () => {
  // A guard against a recording that silently checked nothing: all three exits occur, every gate passed once
  // and blocked once, and every reason the original could give appears in some transcript.
  const runs = h.runs(CASES);
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

h.liveTest(CASES, transcript, nodeRunner, pythonRunner, skipReason);
