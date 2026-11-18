// S03 parity (#474, convention 3 of #470): mhw delivery against workspace/delivery.py's own transcripts.
//   golden:  every case, in process with the synthetic tool runner (all OSes), and one case per old test
//            through bin/mhw.js with the synthetic gh and git first on PATH (POSIX: shell scripts).
//   record:  MHW_UPDATE_GOLDEN=1 runs delivery.py from the base revision (the merge-base with
//            origin/rc/next, or MHW_PARITY_BASE) on the same cases and rewrites the golden file. It
//            refuses a base without workspace/delivery.py, so after this slice merges the file can only
//            be rewritten from a revision that still had the original.
// A difference is a failure unless test/golden/S03/expected-differences.json names it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cases } from '../helpers/delivery-cases.js';
import { inProcess, command, python } from '../helpers/delivery-run.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { extractRevision } from '../helpers/parity.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S03';
const POSIX = process.platform !== 'win32';
const ALL = cases();
/** @type {Array<{ case: string, stream: 'stderr' | 'calls', pattern: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');

/**
 * @typedef {import('../helpers/delivery-run.js').Run} Run
 * @typedef {import('../helpers/delivery-cases.js').Case} Case
 */

/**
 * The differences between the original's run and the head's ([] = parity), after the expected ones.
 * stderr: the head's line may extend the original's by a suffix the pattern matches.
 * calls:  the head may issue added calls the pattern matches; every other call is in the same order.
 * @param {Case} c @param {Run} golden @param {Run} head
 */
export function differences(c, golden, head) {
  const out = [];
  const tag = c.name + ': ';
  if (golden.code !== head.code) out.push(tag + 'exit ' + golden.code + ' != ' + head.code);
  if (c.codeOnly) return out;
  const rules = expected.filter((e) => e.case === c.name);
  if (golden.stdout !== head.stdout) out.push(tag + 'stdout ' + JSON.stringify(golden.stdout) + ' != ' + JSON.stringify(head.stdout));
  const suffix = rules.find((e) => e.stream === 'stderr');
  const g = golden.stderr.replace(/\n$/, '');
  const h = head.stderr.replace(/\n$/, '');
  const same = suffix ? h.startsWith(g) && new RegExp(suffix.pattern).test(h.slice(g.length)) && g !== h : g === h;
  if (!same) out.push(tag + 'stderr ' + JSON.stringify(golden.stderr) + ' != ' + JSON.stringify(head.stderr));
  const added = rules.filter((e) => e.stream === 'calls').map((e) => new RegExp(e.pattern));
  const calls = head.calls.filter((call) => !added.some((r) => r.test(call.join(' '))));
  if (JSON.stringify(calls) !== JSON.stringify(golden.calls)) out.push(tag + 'calls ' + JSON.stringify(golden.calls) + ' != ' + JSON.stringify(head.calls));
  return out;
}

/** @returns {string | null} */
function parityBase() {
  if (process.env.MHW_PARITY_BASE) return process.env.MHW_PARITY_BASE;
  const git = which('git');
  if (!git) return null;
  const p = spawnSync(git, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
  return p.status === 0 ? p.stdout.trim() : null;
}

test('every case of delivery_test.py is here, and every expected difference names a case with a reason', () => {
  const names = new Set(ALL.map((c) => c.name));
  assert.equal(names.size, ALL.length, 'case names are unique');
  const from = new Set(ALL.flatMap((c) => c.from.split(' / ')));
  // The gate tests of the deleted suite; its repository-content tests are in carriers.test.js.
  for (const t of ['test_merge_is_a_real_merge_commit_never_squash', 'test_good_exact_head_and_required_checks',
    'test_stale_head_fork_wrong_base_and_labels_block', 'test_missing_failed_and_pending_checks_block',
    'test_only_the_latest_run_of_each_check_counts', 'test_slice_to_rc_next_passes_without_semver_label_check',
    'test_slice_pr_to_main_is_refused', 'test_missing_tests_run_is_refused', 'test_pending_tests_or_dirty_merge_state_is_refused',
    'test_slice_merge_route_end_to_end_is_a_pinned_merge_commit', 'test_slice_without_a_verdict_is_refused',
    'test_slice_verdict_for_an_older_head_or_not_approving_is_refused', 'test_slice_on_harness_paths_needs_the_closed_lens_at_head',
    'test_plugin_brief_shapes_against_this_repository_contract', 'test_strict_header_spoofs_are_refused',
    'test_the_retired_boundary_literal_is_refused_at_a_new_head', 'test_a_verdict_without_its_owner_check_line_is_malformed',
    'test_main_calls_every_gate_before_merging', 'test_slice_to_main_end_to_end_never_merges',
    'test_main_still_requires_semver_label_check', 'test_new_release_with_ancestry_passes',
    'test_old_draft_prerelease_and_unrelated_release_block']) {
    assert.ok(from.has(t), t);
  }
  for (const e of expected) {
    assert.ok(names.has(e.case), 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
    assert.doesNotThrow(() => new RegExp(e.pattern));
  }
});

test('record: delivery.py from the base revision writes the golden transcripts', { skip: !UPDATE && 'MHW_UPDATE_GOLDEN unset' }, () => {
  const base = parityBase();
  const py = which('python3');
  assert.ok(base && py && POSIX, 'recording needs a base revision, python3 and POSIX');
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-parity-base-'));
  try {
    assert.ok(extractRevision(ROOT, base, path.join(dest, 'tree')), 'base revision readable');
    assert.ok(fs.existsSync(path.join(dest, 'tree', 'workspace', 'delivery.py')), 'the base still has workspace/delivery.py');
    /** @type {Record<string, Run>} */
    const transcripts = {};
    for (const c of ALL) transcripts[c.name] = python(c, py, path.join(dest, 'tree'));
    writeGolden(SLICE, 'transcripts.json', { goldenRecordedFrom: base, transcripts });
  } finally {
    fs.rmSync(dest, { recursive: true, force: true });
  }
});

test('golden: mhw delivery decides every case as delivery.py did (in process)', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, () => {
  const { transcripts } = readGolden(SLICE, 'transcripts.json');
  const diffs = ALL.flatMap((c) => differences(c, transcripts[c.name], inProcess(c)));
  assert.deepEqual(diffs, []);
  assert.equal(Object.keys(transcripts).length, ALL.length, 'one golden transcript per case');
});

// Through the command, one case per old test: each synthetic call is a node process, and all cases take
// minutes. The in-process arm above runs every case through the same route code.
const BY_TEST = ALL.filter((c, i) => ALL.findIndex((x) => x.from === c.from) === i);

test('golden: the same through bin/mhw.js with a synthetic gh and git on PATH (one case per old test)', { skip: (UPDATE && 'MHW_UPDATE_GOLDEN=1') || (!POSIX && 'the synthetic gh and git are POSIX shell scripts; the in-process arm covers Windows') }, () => {
  const { transcripts } = readGolden(SLICE, 'transcripts.json');
  assert.ok(BY_TEST.length >= 20, String(BY_TEST.length));
  const diffs = BY_TEST.flatMap((c) => differences(c, transcripts[c.name], command(c)));
  assert.deepEqual(diffs, []);
});

test('the golden file proves the decisions the old suite asserted', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, () => {
  const { transcripts } = readGolden(SLICE, 'transcripts.json');
  /** @param {string} n */
  const merges = (n) => transcripts[n].calls.filter((/** @type {string[]} */ c) => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'merge');
  // A merge is exactly one real merge commit pinned to the head; every refusal issues none.
  for (const c of ALL) {
    const t = transcripts[c.name];
    const m = merges(c.name);
    if (t.code === 0 && c.args[0] === 'merge' && c.scenario.pr.state === 'OPEN') {
      assert.equal(m.length, 1, c.name);
      assert.deepEqual(m[0], ['gh', 'pr', 'merge', '7', '--repo', 'o/r', '--merge', '--match-head-commit', 'a'.repeat(40)], c.name);
    } else {
      assert.equal(m.length, 0, c.name);
    }
  }
  assert.equal(transcripts['slice-merge-is-a-pinned-merge-commit'].code, 0);
  assert.match(transcripts['retired-literal'].stderr, /retired literal APPROVE-AND-MERGE-BOUNDARY/);
  assert.match(transcripts['plugin-gate-refused'].stderr, /no owner-check line/);
  assert.match(transcripts['main-from-feat/x'].stderr, /only the rc\/next release candidate may target main/);
});
