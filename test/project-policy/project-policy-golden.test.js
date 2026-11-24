// S28 parity (#498, convention 3 of #470): `mhw policy` in Node (src/commands/project-policy.js) against
// the deleted global/project-policy/project_policy.py, reached as `./mhw policy ...` (global/workstation.py),
// on the cases of test/helpers/s28-cases.js. Every run is in a throwaway directory, which is the case's
// working directory and HOME.
//   golden: `node src/action/gates.js policy <args>` (the delivery gates Action's engine since #592, when
//           `mhw policy` left the CLI) against the transcripts recorded from the Python original (exit
//           code, stdout, stderr). Every OS; cases marked posix on POSIX only.
//   live:   where the base revision still holds project_policy.py and the recorded CPython is on PATH, the
//           Python original and the Node command side by side on every case. POSIX only.
//           MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from the Python side, never the Node side.
// The harness is test/helpers/policy-golden.js (shared with S29 since #499). The intended differences are
// test/golden/S28/expected-differences.json; each is applied to both sides, so everything around it is
// still compared.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { harness, POSIX, writeFiles, restoreModes, caseRun, normalised } from '../helpers/policy-golden.js';
import { CASES } from '../helpers/s28-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ROOTLESS = !POSIX || (typeof process.getuid === 'function' && process.getuid() !== 0);
const h = harness({ root: ROOT, slice: 'S28', original: 'global/project-policy/project_policy.py' });

/**
 * @typedef {import('../helpers/s28-cases.js').Case} Case
 * @typedef {import('../helpers/policy-golden.js').Runner} Runner
 * @typedef {import('../helpers/policy-golden.js').Transcript} Transcript
 */

/**
 * Write the case's files and run it with runner; the transcript. On Windows every / of an argument is the
 * platform's separator, as when it was recorded; the comparison folds backslashes on both sides (the
 * recording is macOS, where a joined or relative path is written with /, and pathlib on Windows writes it
 * with a backslash).
 * @param {Case} c
 * @param {Runner} runner
 * @returns {Transcript}
 */
function transcript(c, runner) {
  const base = path.join(h.freshDir('case'), 'case');
  fs.mkdirSync(base, { recursive: true });
  const modes = writeFiles(base, c.files || {});
  const { args, env } = caseRun(c.args, base);
  const r = runner(['policy', ...args], env, base);
  restoreModes(modes);
  return { name: c.name, args: c.args, run: normalised(r, base) };
}

/** The Node command, as the delivery gates Action runs it (#592). @type {Runner} */
const nodeRunner = (args, env, cwd) => {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'src', 'action', 'gates.js'), ...args], { env, cwd, encoding: 'utf8', timeout: 60000 });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

/** `./mhw policy ...` of the base tree, its python3 first on PATH. @param {string} py @param {string} tree @returns {Runner} */
const pythonRunner = (py, tree) => (args, env, cwd) => {
  const p = spawnSync('/bin/sh', [path.join(tree, 'mhw'), ...args], {
    env: { ...env, PATH: path.dirname(py) + path.delimiter + env.PATH, PYTHONIOENCODING: 'utf-8' }, cwd, encoding: 'utf8', timeout: 120000,
  });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
};

/** @param {Case} c */
const skipReason = (c) => {
  if (c.posix && !POSIX) return 'POSIX only';
  if (c.notRoot && !ROOTLESS) return 'a mode-000 file is readable by root';
  return '';
};

h.inventoryTest(CASES);
h.goldenTest(CASES, transcript, nodeRunner, skipReason);

test('golden: the recording exercised every exit and every class', () => {
  // A guard against a recording that silently checked nothing: all three exits occur, and every reason the
  // original could give appears in some transcript.
  const runs = h.runs(CASES);
  assert.deepEqual([...new Set(runs.map((r) => r.code))].sort((a, b) => Number(a) - Number(b)), [0, 1, 2]);
  const all = runs.map((r) => r.stdout + r.stderr).join('\n');
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
h.liveTest(CASES, transcript, nodeRunner, pythonRunner, skipReason);
