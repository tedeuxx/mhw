// The cases of the deleted method/scripts/worklog.test.py (#476, S05 of #470), one test per Python test
// method, the subTests inside it, on the same fixture data (method/scripts/fixtures/worklog/, unchanged).
// The source mutations each Python docstring names were re-run against src/commands/worklog.js; the PR
// body records which one was shown red. The CLI's byte-for-byte parity with the Python is held by
// test/method/worklog-golden.test.js; this file holds the behaviour.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  ContractError, validateEvent, validatePrepared, validateSnapshot, report, buildExport, markdown, harnessKey,
  retainedGraph, EVENT_MARKER, FREE_TEXT_LIMIT, CONTINUITY_TYPES, USAGE_FIELDS, USAGE_PROVENANCE, USAGE_TYPES,
  IDENTIFIER_RE, EVENT_TYPES, OUTCOMES, PROVENANCE, privateEvidence, strictPrivate,
} from '../../src/commands/worklog.js';
import { deepCopy, dumps, loads, PyFloat, num } from '../../src/lib/py.js';
import {
  ROOT, CONTRACT, FIXTURE, fixture, trackerExport, CLEAN_SNAPSHOT, CLEAN_EVENTS, withComment, ghCaptures,
  changed, merge, without, PRIVATE_SPELLINGS, PUBLIC_SPELLINGS, NATIVE_TOKENS, sha, liveExport, usageEvents, pick,
} from '../helpers/worklog-fixture.js';
import { which } from '../helpers/home.js';
import { tempDir } from '../../src/lib/confine.js';

/** @typedef {Record<string, any>} Obj */

const CLI = path.join(ROOT, 'bin', 'mhw.js');
/** @param {RegExp | string} re */
const refused = (re) => (/** @type {unknown} */ e) => {
  assert.ok(e instanceof ContractError, 'not a ContractError: ' + String(e));
  assert.match(e.message, typeof re === 'string' ? new RegExp(re) : re);
  return true;
};
/** @param {Obj} exp */
const rep = (exp, snapshot = FIXTURE.snapshot) => report(deepCopy(snapshot), exp, 'reproduce');
/** @param {Obj[]} items @param {string} issue */
const item = (items, issue) => /** @type {Obj} */ (items.find((i) => i.issue === issue));
/** @param {string[]} args @param {{ cwd?: string }} [o] */
const cli = (args, o = {}) => spawnSync(process.execPath, [CLI, 'worklog', ...args], { cwd: o.cwd || ROOT, encoding: 'utf8' });
// The temporary directory the command itself allows: CPython's gettempdir order (TMPDIR, TEMP, TMP), which
// confine.js follows. On Windows os.tmpdir() reads TEMP and ignores TMPDIR, so a file made there is outside
// the allowed root whenever the two differ (the windows-latest runner sets TMPDIR to D:\a\_temp).
const TEMP_ROOT = tempDir({ cwd: ROOT, env: process.env });
function tmp() {
  return fs.mkdtempSync(path.join(TEMP_ROOT, 'mhw-worklog-'));
}

function baseline() {
  const snapshot = validateSnapshot(deepCopy(FIXTURE.snapshot));
  const events = deepCopy(FIXTURE.events);
  events.push(deepCopy(events[0])); // repeated delivery of one identical event
  return report(snapshot, trackerExport(events), 'python3 scripts/worklog.py report ...');
}

test('cross-repository mixed-harness counts each issue once', () => {
  const r = baseline();
  assert.equal(r.partial, true);
  assert.equal(r.totals.completed_points, 13);
  assert.equal(r.totals.carryover_points, 3);
  assert.deepEqual(r.totals.cohort_points, { sole: 5, mixed: 8, unknown: 0 });
  assert.deepEqual(r.totals.cohort_items, { sole: 1, mixed: 1, unknown: 1 });
  assert.equal(r.items.filter((/** @type {Obj} */ i) => i.credited).reduce((/** @type {number} */ a, /** @type {Obj} */ i) => a + i.points, 0), 13);
  assert.ok(r.warnings.includes('incomplete attribution coverage: acme/site#8'));
});

test('one delivery retains revisions from sibling repositories', () => {
  const events = deepCopy(FIXTURE.events.slice(0, 3));
  const sibling = merge(deepCopy(events[1]), { event_id: 'skills-7-site-checkpoint', timestamp: '2026-09-02T12:00:00Z', event_type: 'checkpoint', stage: 'build', predecessor_event_id: 'skills-7-start' });
  sibling.revision = { repository: 'acme/site', branch: 'feat/7-counterpart', commit: 'ccccccc' };
  sibling.handoff = { state: 'active', to: null };
  events.push(sibling);
  const r = rep(trackerExport(events));
  const it = item(r.items, 'acme/skills#7');
  assert.equal(r.items.filter((/** @type {Obj} */ i) => i.issue === 'acme/skills#7').length, 1);
  assert.equal(it.points, 8);
  assert.deepEqual(new Set(it.segments.map((/** @type {Obj} */ s) => s.revision.repository)), new Set(['acme/skills', 'acme/site']));
  const invalid = trackerExport(events);
  invalid.comments[0].repository = 'acme/site';
  assert.throws(() => rep(invalid), refused('issue disagrees with repository'));
});

test('a conflicting duplicate fails', () => {
  const events = deepCopy(FIXTURE.events);
  events.push(merge(deepCopy(events[0]), { stage: 'different' }));
  assert.throws(() => rep(trackerExport(events)), refused('conflicting content'));
});

test('credit is the frozen estimate, not the current label', () => {
  const relabelled = deepCopy(FIXTURE.snapshot);
  relabelled.counting_units[0].planned_points = 13;
  const r = rep(trackerExport(FIXTURE.events), relabelled);
  assert.equal(item(r.items, 'acme/skills#7').points, 8);
  assert.equal(r.totals.completed_points, 13);
  assert.equal(r.totals.scope_changes, 1);
});

test('duplicates and a reopen do not inflate credit', () => {
  const r = baseline();
  assert.equal(r.totals.completed_points, 13);
  assert.equal(r.totals.carryover_points, 3);
  const site8 = item(r.items, 'acme/site#8');
  assert.deepEqual([site8.outcome, site8.credited], ['reopened', false]);
});

test('a sprint mismatch is named and makes the report partial', () => {
  const clean = rep(trackerExport(CLEAN_EVENTS), CLEAN_SNAPSHOT);
  assert.equal(clean.partial, false, clean.warnings.join('; '));
  assert.equal(clean.totals.completed_points, 13);
  assert.deepEqual(clean.totals.completion_sprint_mismatches, []);
  const r = rep(trackerExport(CLEAN_EVENTS), merge(deepCopy(CLEAN_SNAPSHOT), { sprint: 'sprint-other' }));
  assert.equal(r.totals.completed_points, 0);
  assert.equal(r.partial, true);
  assert.deepEqual(r.totals.completion_sprint_mismatches, [{ issue: 'acme/site#7', completion_sprint: 'sprint-fixture' }, { issue: 'acme/skills#7', completion_sprint: 'sprint-fixture' }]);
  assert.ok(r.warnings.includes('completion sprint mismatch: acme/skills#7 was accepted in sprint-fixture, not sprint-other; no credit here'));
  assert.equal(r.totals.carryover_points, 13);
  assert.ok(markdown(r).includes('completion sprint mismatches: `[{'));
});

test('non-delivery outcomes are excluded, not carried over', async (t) => {
  for (const reason of ['cancelled', 'superseded', 'no_longer_relevant']) {
    await t.test(reason, () => {
      const events = deepCopy(CLEAN_EVENTS);
      const late = without(merge(deepCopy(pick(events, (e) => e.event_id === 'site-7-accepted')), { event_id: 'site-7-' + reason, timestamp: '2026-09-06T11:00:00Z', outcome: reason }), 'completion_sprint', 'acceptance_evidence');
      events.push(late);
      const r = rep(trackerExport(events), CLEAN_SNAPSHOT);
      assert.deepEqual(r.excluded, [{ issue: 'acme/site#7', reason }]);
      assert.equal(r.totals.carryover_points, 0);
      assert.equal(r.totals.completed_points, 8);
    });
  }
});

test('accepted work without a frozen estimate is listed', () => {
  const r = rep(trackerExport(CLEAN_EVENTS.filter((e) => e.event_id !== 'site-7-start')), CLEAN_SNAPSHOT);
  assert.deepEqual(r.totals.unestimated_completions, ['acme/site#7']);
  assert.equal(r.totals.completed_points, 8);
  assert.equal(r.totals.carryover_points, 0);
  assert.equal(r.partial, true);
});

test('points per week is completed points over measured weeks', async (t) => {
  for (const [endsAt, days, expected] of /** @type {Array<[string, number, number]>} */ ([['2026-09-08T00:00:00Z', 7, 13], ['2026-09-15T00:00:00Z', 14, 6.5], ['2026-09-11T00:00:00Z', 10, 9.1]])) {
    await t.test(endsAt, () => {
      const totals = rep(trackerExport(CLEAN_EVENTS), merge(deepCopy(CLEAN_SNAPSHOT), { ends_at: endsAt })).totals;
      assert.equal(totals.completed_points, 13);
      assert.ok(totals.duration_days instanceof PyFloat && totals.points_per_week instanceof PyFloat, 'both are floats');
      assert.deepEqual([totals.duration_days.v, totals.points_per_week.v], [days, expected]);
    });
  }
});

test('harness spellings are one cohort', async (t) => {
  /** @param {string} harness */
  const withCheckpoint = (harness) => {
    const events = deepCopy(CLEAN_EVENTS);
    const cp = without(merge(deepCopy(pick(events, (e) => e.event_id === 'site-7-start')), { event_id: 'site-7-checkpoint', event_type: 'checkpoint', timestamp: '2026-09-02T11:00:00Z' }), 'frozen_estimate');
    cp.attribution.harness = harness;
    events.push(cp);
    const r = rep(trackerExport(events), CLEAN_SNAPSHOT);
    return [item(r.items, 'acme/site#7').cohort, r.partial];
  };
  assert.equal(pick(CLEAN_EVENTS, (e) => e.event_id === 'site-7-start').attribution.harness, 'Kiro');
  for (const spelling of ['kiro', 'KIRO', ' Kiro ', 'ki-ro']) {
    await t.test(spelling, () => assert.deepEqual(withCheckpoint(spelling), ['sole', false]));
  }
  assert.deepEqual(withCheckpoint('Codex'), ['mixed', false]);
  assert.equal(withCheckpoint('---')[0], 'unknown');
  assert.equal(harnessKey('Claude Code'), harnessKey('claude-code'));
  assert.ok(dumps(rep(trackerExport(CLEAN_EVENTS), CLEAN_SNAPSHOT).items, { separators: [', ', ': '] }).includes('"harness": "Kiro"'));
});

test('a marker quoted in prose is not an event', async (t) => {
  const prose = ['the `' + EVENT_MARKER + '` marker opens an event', 'a later `<!-- worklog-event:v2 -->` would be refused',
    'quoted twice: ' + EVENT_MARKER + ' and ' + EVENT_MARKER];
  const expected = rep(trackerExport(CLEAN_EVENTS), CLEAN_SNAPSHOT).totals;
  for (const body of prose) {
    await t.test(body, () => assert.deepEqual(rep(withComment(trackerExport(CLEAN_EVENTS), 'acme/skills#7', 900, body), CLEAN_SNAPSHOT).totals, expected));
  }
  const broken = withComment(trackerExport(CLEAN_EVENTS), 'acme/skills#7', 901, EVENT_MARKER + '\nthe fence is missing');
  assert.throws(() => rep(broken, CLEAN_SNAPSHOT), refused('malformed worklog event body'));
});

test('the export producer composes what the report reads', async (t) => {
  const [captures, ids] = ghCaptures(FIXTURE.events);
  const exp = buildExport(captures, '2026-10-01T00:00:00Z');
  assert.deepEqual(exp.comments.map((/** @type {Obj} */ c) => c.comment_id).sort((/** @type {number} */ a, /** @type {number} */ b) => a - b), ids);
  const r = rep(exp);
  assert.deepEqual(r.totals, rep(trackerExport(FIXTURE.events)).totals);
  assert.ok(r.warnings.includes('incomplete pagination: acme/skills'));
  assert.ok(r.warnings.includes('historical integrity unknown: prior inventory is absent or incomplete'));
  const prior = buildExport([...captures, { url: 'https://github.com/acme/site/issues/99', comments: [
    { url: 'https://github.com/acme/site/issues/99#issuecomment-777', createdAt: '2026-09-01T00:00:00Z', includesCreatedEdit: false, body: 'not an event' }] }], '2026-10-01T00:00:00Z', null, true);
  const declared = buildExport(captures, '2026-10-01T00:00:00Z', prior, true);
  assert.deepEqual(declared.prior_inventory, { complete: true, comment_ids: [...ids].sort((a, b) => (String(a) < String(b) ? -1 : 1)) });
  const clean = rep(buildExport(ghCaptures(CLEAN_EVENTS)[0], '2026-10-01T00:00:00Z', buildExport(ghCaptures(CLEAN_EVENTS)[0], '2026-10-01T00:00:00Z', null, true), true), CLEAN_SNAPSHOT);
  assert.equal(clean.partial, false, clean.warnings.join('; '));
  const [edited] = ghCaptures(CLEAN_EVENTS);
  edited[0].comments[0].includesCreatedEdit = true;
  assert.ok(rep(buildExport(edited, '2026-10-01T00:00:00Z'), CLEAN_SNAPSHOT).warnings.some((/** @type {string} */ w) => w.startsWith('comment edit timestamp unavailable: ')));
  /** @type {Array<[string, (c: Obj[]) => void, string]>} */
  const bad = [
    ['duplicate capture', (c) => c.push(deepCopy(c[0])), 'captured twice'],
    ['not an issue url', (c) => { c[0].url = 'https://github.com/acme/site/pull/7'; }, 'must be a GitHub issue URL'],
    ['comment from another issue', (c) => { c[0].comments[0].url = 'https://github.com/acme/site/issues/8#issuecomment-5'; }, 'must be a comment URL on'],
  ];
  for (const [label, mutate, needle] of bad) {
    await t.test(label, () => {
      const [c] = ghCaptures(FIXTURE.events);
      mutate(c);
      assert.throws(() => buildExport(c, '2026-10-01T00:00:00Z'), refused(needle));
    });
  }
});

test('the export prior inventory is only as complete as the prior capture', () => {
  const [captures] = ghCaptures(CLEAN_EVENTS);
  const truncated = deepCopy(captures);
  for (const c of truncated) c.comments = c.comments.slice(0, 1);
  const undeclared = buildExport(truncated, '2026-10-01T00:00:00Z');
  const current = buildExport(captures, '2026-10-01T00:00:00Z', undeclared, true);
  assert.equal(current.prior_inventory.complete, false);
  const r = rep(current, CLEAN_SNAPSHOT);
  assert.equal(r.partial, true);
  assert.ok(r.warnings.includes('historical integrity unknown: prior inventory is absent or incomplete'));
  const mixed = deepCopy(buildExport(captures, '2026-10-01T00:00:00Z', null, true));
  mixed.repositories[0].pagination_complete = false;
  assert.equal(buildExport(captures, '2026-10-01T00:00:00Z', mixed, true).prior_inventory.complete, false);
  const repos = [...new Set(captures.map((c) => c.url.split('/issues/')[0]))].sort();
  assert.ok(repos.length > 1);
  const oneRepo = captures.filter((c) => c.url.startsWith(repos[0] + '/'));
  assert.equal(buildExport(captures, '2026-10-01T00:00:00Z', buildExport(oneRepo, '2026-10-01T00:00:00Z', null, true), true).prior_inventory.complete, false);
  assert.equal(buildExport(captures, '2026-10-01T00:00:00Z', buildExport(truncated, '2026-10-01T00:00:00Z', null, true), true).prior_inventory.complete, true);
});

test('the export CLI feeds the report CLI', () => {
  const d = tmp();
  try {
    /** @type {string[]} */
    const paths = [];
    ghCaptures(CLEAN_EVENTS)[0].forEach((capture, i) => {
      const f = path.join(d, 'capture-' + i + '.json');
      fs.writeFileSync(f, dumps(capture));
      paths.push('--capture', f);
    });
    const produced = cli(['export', '--cutoff', '2026-10-01T00:00:00Z', ...paths]);
    assert.equal(produced.status, 0, produced.stderr);
    fs.writeFileSync(path.join(d, 'export.json'), produced.stdout);
    fs.writeFileSync(path.join(d, 'snapshot.json'), dumps(CLEAN_SNAPSHOT));
    const reported = cli(['report', '--snapshot', path.join(d, 'snapshot.json'), '--export', path.join(d, 'export.json'), '--format', 'json', '--reproduction-command', 'r']);
    assert.equal(reported.status, 0, reported.stderr);
    assert.equal(/** @type {Obj} */ (loads(reported.stdout)).totals.completed_points, 13);
    const failed = cli(['export', '--cutoff', 'not-a-time', ...paths]);
    assert.equal(failed.status, 2);
    assert.doesNotMatch(failed.stderr, /Traceback|at .*\.js:/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('incomplete and edited inputs are partial or invalid', () => {
  assert.equal(rep(trackerExport(FIXTURE.events, false)).partial, true);
  const corrupt = trackerExport(FIXTURE.events);
  corrupt.comments[0].body += 'edited';
  assert.throws(() => rep(corrupt), refused('hash mismatch'));
  const deleted = trackerExport(FIXTURE.events);
  deleted.comments.pop();
  const r = rep(deleted);
  assert.equal(r.partial, true);
  assert.ok(r.warnings.some((/** @type {string} */ w) => w.includes('deleted historical')));
  const missing = trackerExport(FIXTURE.events);
  missing.repositories = missing.repositories.slice(0, 1);
  assert.ok(rep(missing).warnings.includes('missing repository: acme/site'));
});

test('the cutoff is an as-of boundary for acceptance, reopen and correction', async (t) => {
  const events = deepCopy(FIXTURE.events);
  for (const [cutoff, expected] of /** @type {Array<[string, number]>} */ ([['2026-09-01T00:00:00Z', 0], ['2026-09-03T23:00:00Z', 8], ['2026-09-05T23:00:00Z', 16], ['2026-09-07T00:00:00Z', 13]])) {
    await t.test(cutoff, () => assert.equal(rep(trackerExport(events, true, cutoff)).totals.completed_points, expected));
  }
  const corrected = merge(deepCopy(events[0]), { event_id: 'skills-7-start-backdated-corrected' });
  corrected.frozen_estimate.points = 13;
  events.push(merge(deepCopy(events[1]), { event_id: 'late-correction', timestamp: '2026-09-07T12:00:00Z', event_type: 'correction', supersedes_event_id: events[0].event_id, corrected_event: corrected }));
  assert.equal(rep(trackerExport(events, true, '2026-09-07T11:00:00Z')).totals.completed_points, 13);
  assert.equal(rep(trackerExport(events, true, '2026-09-07T13:00:00Z')).totals.completed_points, 18);
});

test('the correction graph rejects collisions and supports chains', () => {
  const events = deepCopy(FIXTURE.events);
  const bad = merge(deepCopy(events[1]), { event_id: 'cross-correction', event_type: 'correction', supersedes_event_id: events[0].event_id, corrected_event: deepCopy(events[4]) });
  assert.throws(() => rep(trackerExport([...events, bad])), refused('replacement event_id collision'));
  bad.corrected_event.event_id = 'cross-issue-unique';
  assert.throws(() => rep(trackerExport([...events, bad])), refused('target and replacement must belong'));
  const r1 = merge(deepCopy(events[0]), { event_id: 'skills-7-start-r1' });
  r1.frozen_estimate.points = 13;
  const first = merge(deepCopy(events[1]), { event_id: 'correction-r1', timestamp: '2026-09-07T10:00:00Z', event_type: 'correction', supersedes_event_id: events[0].event_id, corrected_event: r1 });
  const r2 = merge(deepCopy(r1), { event_id: 'skills-7-start-r2' });
  r2.frozen_estimate.points = 21;
  const second = merge(deepCopy(first), { event_id: 'correction-r2', timestamp: '2026-09-08T10:00:00Z', supersedes_event_id: r1.event_id, corrected_event: r2 });
  assert.equal(item(rep(trackerExport([...events, first, second])).items, 'acme/skills#7').points, 21);
});

test('missing history and unknown participation are partial', () => {
  const empty = rep(trackerExport([]));
  assert.equal(empty.partial, true);
  assert.equal(empty.warnings.filter((/** @type {string} */ w) => w.startsWith('missing worklog history:')).length, 3);
  const noWork = deepCopy(FIXTURE.snapshot);
  noWork.counting_units = [];
  assert.equal(rep(trackerExport([]), noWork).partial, false);
  const knownUnknown = deepCopy(FIXTURE.events);
  const unknown = without(merge(deepCopy(knownUnknown[3]), { event_id: 'site-7-unknown-checkpoint', timestamp: '2026-09-02T12:00:00Z', event_type: 'checkpoint', stage: 'build' }), 'frozen_estimate');
  Object.assign(unknown.attribution, { harness: 'unknown', provenance: 'declared' });
  knownUnknown.push(unknown);
  let r = rep(trackerExport(knownUnknown));
  assert.equal(item(r.items, 'acme/site#7').cohort, 'unknown');
  assert.equal(r.partial, true);
  const mixedUnknown = deepCopy(FIXTURE.events);
  unknown.issue = 'acme/skills#7';
  unknown.event_id = 'skills-7-unknown-checkpoint';
  unknown.revision.repository = 'acme/skills';
  mixedUnknown.push(unknown);
  r = rep(trackerExport(mixedUnknown));
  assert.equal(item(r.items, 'acme/skills#7').cohort, 'mixed');
  assert.equal(r.partial, true);
});

test('malformed contract values and marker versions fail', async (t) => {
  for (const [label, message, changes] of /** @type {Array<[string, string, Obj]>} */ ([['boolean schema', 'unsupported schema_version', { schema_version: true }], ['blank acceptance evidence', 'entries must be non-empty strings', { acceptance_evidence: [' \t'] }]])) {
    await t.test(label, () => assert.throws(() => validateEvent(merge(deepCopy(FIXTURE.events[2]), changes)), refused(message)));
  }
  for (const [field, at] of /** @type {Array<[string, string[]]>} */ ([['event_type', ['event_type']], ['provenance', ['attribution', 'provenance']], ['outcome', ['outcome']]])) {
    for (const [kind, value] of /** @type {Array<[string, unknown]>} */ ([['object', {}], ['array', []], ['null', null], ['boolean', true], ['number', 7]])) {
      await t.test(field + ' ' + kind, () => assert.throws(() => validateEvent(changed(FIXTURE.events[2], at, value)), refused('must be a non-empty string')));
    }
  }
  const snapshot = deepCopy(FIXTURE.snapshot);
  snapshot.counting_units[0].planned_points = true;
  assert.throws(() => rep(trackerExport(FIXTURE.events), snapshot), refused('positive integer'));
  let exp = trackerExport(FIXTURE.events);
  exp.repositories[0].pagination_complete = 'false';
  assert.throws(() => rep(exp), refused('must be a boolean'));
  exp = trackerExport(FIXTURE.events);
  exp.prior_inventory.complete = 'false';
  assert.throws(() => rep(exp), refused('must be a boolean'));
  exp = trackerExport(FIXTURE.events);
  exp.prior_inventory.comment_ids = [{}];
  assert.throws(() => rep(exp), refused('entries must be strings or integers'));
  let event = deepCopy(FIXTURE.events[0]);
  event.frozen_estimate.points = true;
  assert.throws(() => validateEvent(event), refused('positive integer'));
  event = deepCopy(FIXTURE.events[0]);
  event.attribution.harness = { invented: 'identity' };
  assert.throws(() => validateEvent(event), refused('non-empty string'));
  let accepted = deepCopy(FIXTURE.events[2]);
  accepted.acceptance_evidence = [{ invented: 'proof' }];
  assert.throws(() => validateEvent(accepted), refused('string array'));
  accepted = deepCopy(FIXTURE.events[2]);
  accepted.acceptance_evidence = ['/Users/example/private.txt'];
  assert.throws(() => validateEvent(accepted), refused('private or machine-local'));
  exp = trackerExport(FIXTURE.events);
  exp.comments[0].body = exp.comments[0].body.replace('worklog-event:v1', 'worklog-event:v2');
  exp.comments[0].body_sha256 = sha(exp.comments[0].body);
  assert.throws(() => rep(exp), refused('unsupported worklog marker version'));
});

test('the contract rejects malformed fields at their boundaries', async (t) => {
  const [start, checkpoint, accepted] = FIXTURE.events;
  /** @type {Array<[string, unknown]>} */
  const eventCases = [
    ['not object', null], ['bad issue', changed(start, ['issue'], 'missing-number')], ['non-UTC timestamp', changed(start, ['timestamp'], '2026-09-01')],
    ['invalid timestamp', changed(start, ['timestamp'], 'not-a-dateZ')], ['unknown event type', changed(start, ['event_type'], 'invented')],
    ['blank stage', changed(start, ['stage'], ' ')], ['blank predecessor', changed(checkpoint, ['predecessor_event_id'], '')],
    ['attribution not object', changed(start, ['attribution'], [])], ['bad provenance', changed(start, ['attribution', 'provenance'], 'inferred')],
    ['plugin not object', changed(start, ['attribution', 'plugin'], [])], ['revision not object', changed(start, ['revision'], [])],
    ['bad revision repo', changed(start, ['revision', 'repository'], 'bad')], ['blank branch', changed(start, ['revision', 'branch'], '')],
    ['bad commit', changed(start, ['revision', 'commit'], 'not-a-sha')], ['blank evidence', changed(start, ['evidence'], [' '])],
    ['handoff not object', changed(start, ['handoff'], [])], ['blank handoff target', changed(start, ['handoff', 'to'], '')],
    ['estimate not object', changed(start, ['frozen_estimate'], [])], ['bad commitment', changed(start, ['frozen_estimate', 'commitment_points'], true)],
    ['estimate on checkpoint', changed(checkpoint, ['frozen_estimate'], start.frozen_estimate)], ['invalid outcome', changed(accepted, ['outcome'], 'done')],
    ['empty acceptance list', changed(accepted, ['acceptance_evidence'], [])], ['completion on reopened', changed(FIXTURE.events[7], ['completion_sprint'], 'sprint-03')],
    ['outcome on checkpoint', changed(checkpoint, ['outcome'], 'accepted')], ['correction field on checkpoint', changed(checkpoint, ['supersedes_event_id'], 'event-1')],
  ];
  for (const [label, event] of eventCases) await t.test('event ' + label, () => assert.throws(() => validateEvent(event), ContractError));
  const snapshot = FIXTURE.snapshot;
  const dupRepo = deepCopy(snapshot);
  dupRepo.repositories.push(deepCopy(dupRepo.repositories[0]));
  const dupUnit = deepCopy(snapshot);
  dupUnit.counting_units.push(deepCopy(dupUnit.counting_units[0]));
  /** @type {Array<[string, unknown]>} */
  const snapshotCases = [
    ['not object', null], ['no repositories', changed(snapshot, ['repositories'], [])], ['repo not object', changed(snapshot, ['repositories', 0], [])],
    ['bad repo', changed(snapshot, ['repositories', 0, 'repository'], 'bad')], ['duplicate repo', dupRepo],
    ['bad milestone', changed(snapshot, ['repositories', 0, 'milestone_number'], true)], ['units not array', changed(snapshot, ['counting_units'], {})],
    ['unit not object', changed(snapshot, ['counting_units', 0], [])], ['bad unit issue', changed(snapshot, ['counting_units', 0, 'issue'], 'bad')],
    ['undeclared unit repo', changed(snapshot, ['counting_units', 0, 'issue'], 'other/repo#1')], ['bad parent', changed(snapshot, ['counting_units', 0, 'parent'], 'bad')],
    ['duplicate unit', dupUnit],
  ];
  for (const [label, value] of snapshotCases) await t.test('snapshot ' + label, () => assert.throws(() => validateSnapshot(value), ContractError));
});


test('live correction segments and markdown are auditable', () => {
  const r = report(fixture('sprint-03.worklog.json'), liveExport(), 'python3 scripts/worklog.py report ...');
  assert.ok(!r.warnings.some((/** @type {string} */ w) => w.includes('missing predecessor_event_id')));
  assert.equal(r.partial, true);
  assert.equal(r.warnings.filter((/** @type {string} */ w) => w.startsWith('comment edit timestamp unavailable:')).length, 2);
  const it = r.items[0];
  const serialized = dumps(it, { separators: [', ', ': '] });
  for (const needle of ['2.0.74', '2.0.77', '"runtime_version": "unknown"', 'skills-499-implementation-start-20260923t224133z-corrected']) assert.ok(serialized.includes(needle), needle);
  const combined = it.segments.filter((/** @type {Obj} */ s) => ['skills-499-correct-start-plugin-20260923t230719z', 'skills-499-resume-plugin-2077-20260923t230719z'].includes(s.event_id)).map((/** @type {Obj} */ s) => s.source.comment_id);
  assert.deepEqual(combined, [5804452881, 5804452881]);
  const rendered = markdown(r);
  for (const needle of ['report version', 'schema version', 'cohort points', 'work-type points', 'comment IDs', 'Items and retained segments', '2.0.74', '2.0.77', 'unknown']) assert.ok(rendered.includes(needle), needle);
});

test('parent/child overlap and an unsupported schema fail', () => {
  const snapshot = deepCopy(FIXTURE.snapshot);
  snapshot.counting_units[1].parent = 'acme/skills#7';
  assert.throws(() => validateSnapshot(snapshot), refused('parent/child overlap'));
  assert.throws(() => validateEvent(merge(deepCopy(FIXTURE.events[0]), { schema_version: 2 })), refused('unsupported'));
  assert.throws(() => validateEvent(merge(deepCopy(FIXTURE.events[0]), { evidence: ['/Users/example/private.txt'] })), refused('private or machine-local'));
});

test('a correction replaces the original without erasing it', () => {
  const events = deepCopy(FIXTURE.events);
  const corrected = merge(deepCopy(events[0]), { event_id: 'skills-7-start-corrected' });
  corrected.frozen_estimate.points = 13;
  events.push(merge(deepCopy(events[1]), { event_id: 'correction-1', event_type: 'correction', supersedes_event_id: 'skills-7-start', corrected_event: corrected }));
  const r = rep(trackerExport(events));
  assert.equal(item(r.items, 'acme/skills#7').points, 13);
  assert.equal(r.totals.scope_changes, 1);
});

test('the CLI is deterministic and prepare is file-backed', () => {
  const d = tmp();
  try {
    const [snapshot, exp, event] = ['snapshot.json', 'export.json', 'event.json'].map((n) => path.join(d, n));
    fs.writeFileSync(snapshot, dumps(FIXTURE.snapshot));
    fs.writeFileSync(exp, dumps(trackerExport(FIXTURE.events)));
    fs.writeFileSync(event, dumps(FIXTURE.events[0]));
    const command = ['report', '--snapshot', snapshot, '--export', exp, '--format', 'json', '--reproduction-command', 'same command'];
    const first = cli(command);
    assert.equal(first.status, 0, first.stderr);
    assert.equal(cli(command).stdout, first.stdout);
    assert.ok(cli(['prepare-event', event]).stdout.startsWith(EVENT_MARKER));
    const invalid = trackerExport(FIXTURE.events);
    invalid.repositories[0].pagination_complete = 'false';
    fs.writeFileSync(exp, dumps(invalid));
    const failed = cli(command);
    assert.equal(failed.status, 2);
    assert.match(failed.stderr, /must be a boolean/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the CLI entry covers both formats, validation and clean errors', async (t) => {
  const d = tmp();
  try {
    const [snapshot, exp, event] = ['snapshot.json', 'export.json', 'event.json'].map((n) => path.join(d, n));
    fs.writeFileSync(snapshot, dumps(FIXTURE.snapshot));
    fs.writeFileSync(exp, dumps(trackerExport(FIXTURE.events)));
    fs.writeFileSync(event, dumps(FIXTURE.events[0]));
    for (const [args, needle] of /** @type {Array<[string[], string]>} */ ([
      [['validate-event', event], '"event_id":"skills-7-start"'], [['prepare-event', event], EVENT_MARKER],
      [['report', '--snapshot', snapshot, '--export', exp, '--format', 'json', '--reproduction-command', 'reproduce'], '"report_version"'],
      [['report', '--snapshot', snapshot, '--export', exp, '--format', 'markdown', '--reproduction-command', 'reproduce'], 'report version:']])) {
      await t.test(args[0] + ' ' + (args[6] || ''), () => {
        const p = cli(args);
        assert.equal(p.status, 0, p.stderr);
        assert.ok(p.stdout.includes(needle));
      });
    }
    const missing = cli(['validate-event', path.join(d, 'missing.json')]);
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /cannot read JSON/);
    for (const changes of [{ schema_version: true }, { acceptance_evidence: [''] }]) {
      fs.writeFileSync(event, dumps(merge(deepCopy(FIXTURE.events[2]), changes)));
      assert.equal(cli(['validate-event', event]).status, 2);
    }
    for (const at of [['event_type'], ['attribution', 'provenance'], ['outcome']]) {
      for (const value of [{}, [], null, true, 7]) {
        fs.writeFileSync(event, dumps(changed(FIXTURE.events[2], at, value)));
        const p = cli(['validate-event', event]);
        assert.equal(p.status, 2);
        assert.match(p.stderr, /must be a non-empty string/);
      }
    }
    const invalid = trackerExport(FIXTURE.events);
    invalid.prior_inventory.comment_ids = [{}];
    fs.writeFileSync(exp, dumps(invalid));
    assert.equal(cli(['report', '--snapshot', snapshot, '--export', exp, '--format', 'json', '--reproduction-command', 'reproduce']).status, 2);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('a continuity record is bounded, public and producer-strict', async (t) => {
  const handoff = deepCopy(pick(FIXTURE.events, (e) => e.event_type === 'handoff'));
  assert.ok(!Object.hasOwn(handoff, 'next_act'));
  validateEvent(deepCopy(handoff));
  const withAct = merge(handoff, { next_act: 'open the merge request for the branch at the named commit' });
  validateEvent(deepCopy(withAct));
  validatePrepared(validateEvent(deepCopy(withAct)));
  validatePrepared(validateEvent(deepCopy(merge(handoff, { event_type: 'checkpoint', event_id: 'skills-7-checkpoint' }))));
  for (const [label, event, needle] of /** @type {Array<[string, Obj, string]>} */ ([
    ['start-carries-next-act', merge(FIXTURE.events[0], { next_act: 'x' }), 'only valid on checkpoint'],
    ['outcome-carries-next-act', merge(FIXTURE.events[2], { next_act: 'x' }), 'only valid on checkpoint'],
    ['multi-line', merge(handoff, { next_act: 'first\nsecond' }), 'single line'], ['carriage-return', merge(handoff, { next_act: 'first\rsecond' }), 'single line'],
    ['over-limit', merge(handoff, { next_act: 'a'.repeat(FREE_TEXT_LIMIT + 1) }), 'at most 280'],
    ['machine-local', merge(handoff, { next_act: 'resume from /private/tmp/x/continuation-5.md' }), 'private'],
    ['private-source', merge(handoff, { next_act: 'read .brand/positioning first' }), 'private'],
    ['blank', merge(handoff, { next_act: '   ' }), 'non-empty'], ['not-a-string', merge(handoff, { next_act: ['open the PR'] }), 'non-empty']])) {
    await t.test(label, () => assert.throws(() => validateEvent(deepCopy(event)), refused(needle)));
  }
  validateEvent(merge(handoff, { next_act: 'a'.repeat(FREE_TEXT_LIMIT) }));
  assert.throws(() => validatePrepared(validateEvent(deepCopy(handoff))), refused('missing next_act'));
  for (const [evidence, needle] of /** @type {Array<[string[], string]>} */ ([[['b'.repeat(FREE_TEXT_LIMIT + 1)], 'at most 280'], [['a notes\ndump'], 'single line']])) {
    assert.throws(() => validatePrepared(validateEvent(merge(withAct, { evidence }))), refused(needle));
  }
  validateEvent(merge(withAct, { evidence: ['b'.repeat(FREE_TEXT_LIMIT + 1)] }));
  const d = tmp();
  try {
    const f = path.join(d, 'handoff.json');
    fs.writeFileSync(f, dumps(handoff));
    const r = cli(['prepare-event', f]);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /missing next_act/);
    assert.equal(cli(['validate-event', f]).status, 0);
    fs.writeFileSync(f, dumps(withAct));
    assert.match(cli(['prepare-event', f]).stdout, /"next_act": "open the merge request/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

test('the privacy filter is strict for producers and for next_act', () => {
  const handoff = deepCopy(pick(FIXTURE.events, (e) => e.event_type === 'handoff'));
  for (const text of PRIVATE_SPELLINGS) {
    assert.throws(() => validateEvent(merge(handoff, { next_act: text })), refused('private'), text);
    const event = merge(handoff, { next_act: 'open the pull request', evidence: [text] });
    if (!privateEvidence(text)) validateEvent(deepCopy(event));
    assert.throws(() => validatePrepared(validateEvent(deepCopy(event))), refused('private'), text);
  }
  for (const text of PUBLIC_SPELLINGS) validatePrepared(validateEvent(merge(handoff, { next_act: text, evidence: [text] })));
  const outcome = deepCopy(FIXTURE.events[2]);
  validatePrepared(validateEvent(deepCopy(outcome)));
  assert.throws(() => validatePrepared(validateEvent(merge(outcome, { acceptance_evidence: ['/tmp/x'] }))), refused(/acceptance_evidence.*private/));
});

test('prepare-event recurses into a corrected event', () => {
  const handoff = deepCopy(pick(FIXTURE.events, (e) => e.event_type === 'handoff'));
  const wrapped = merge(handoff, { event_id: 'skills-7-handoff-v2', evidence: ['b'.repeat(FREE_TEXT_LIMIT + 1)] });
  const correction = merge(handoff, { event_type: 'correction', event_id: 'skills-7-correction', supersedes_event_id: handoff.event_id, corrected_event: wrapped });
  validateEvent(deepCopy(correction));
  assert.throws(() => validatePrepared(validateEvent(deepCopy(correction))), refused('corrected_event: missing next_act'));
  const withAct = merge(correction, { corrected_event: merge(wrapped, { next_act: 'open the pull request' }) });
  assert.throws(() => validatePrepared(validateEvent(deepCopy(withAct))), refused(/corrected_event\.evidence\[0\]: must be at most 280/));
  assert.throws(() => validateEvent(deepCopy(merge(correction, { corrected_event: merge(handoff, { event_id: 'skills-7-handoff-v2', next_act: 'resume from /tmp/x' }) }))), refused('corrected_event.next_act: contains private'));
  validatePrepared(validateEvent(deepCopy(merge(correction, { corrected_event: merge(handoff, { event_id: 'skills-7-handoff-v2', next_act: 'open the pull request' }) }))));
  const d = tmp();
  try {
    const f = path.join(d, 'correction.json');
    fs.writeFileSync(f, dumps(correction));
    const r = cli(['prepare-event', f]);
    assert.equal(r.status, 2);
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /corrected_event: missing next_act/);
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

const JQ = which('jq');
test('the README resume command agrees with the report', { skip: !JQ && 'jq is not installed' }, async (t) => {
  // CRLF on a Windows checkout (core.autocrlf): the command is read as the text the README carries.
  const readme = fs.readFileSync(path.join(CONTRACT, 'README.md'), 'utf8').replaceAll('\r\n', '\n');
  const m = /--json comments --jq '([\s\S]*?)'\n```/.exec(readme);
  assert.ok(m, 'resume command not found in the README');
  const filter = m[1];
  const base = deepCopy(pick(FIXTURE.events, (e) => e.event_type === 'handoff'));
  /** @param {number} minute */
  const at = (minute) => '2026-09-02T10:' + String(minute).padStart(2, '0') + ':00Z';
  /** @param {string} id @param {number} minute @param {string} [act] */
  const handoff = (id, minute, act) => {
    const e = merge(deepCopy(base), { event_id: id, timestamp: at(minute) });
    return act ? merge(e, { next_act: act }) : e;
  };
  /** @param {string} id @param {number} minute */
  const checkpoint = (id, minute) => merge(handoff(id, minute), { event_type: 'checkpoint' });
  /** @param {string} id @param {number} minute @param {string} target @param {Obj} replacement */
  const correction = (id, minute, target, replacement) => merge(handoff(id, minute), { event_type: 'correction', supersedes_event_id: target, corrected_event: replacement });
  /** @param {Obj} e */
  const block = (e) => EVENT_MARKER + '\n```json\n' + dumps(e, { indent: 2, sortKeys: false, ensureAscii: true }) + '\n```\n';
  /** @param {Obj[]} events */
  const oracle = (events) => {
    const [effective] = retainedGraph(events.map((e) => ({ event: e, source: {}, available_at: e.timestamp })));
    const acts = effective.map((r) => r.event.next_act).filter(Boolean);
    return acts.length ? acts[acts.length - 1] : '';
  };
  const malformed = EVENT_MARKER + '\n```json\n{"event_id": "broken",}\n```\n';
  /** @type {Record<string, [Obj[], string]>} */
  const scenarios = {
    'handoff corrected into a checkpoint': [[handoff('x', 1, 'act A'), correction('c', 2, 'x', checkpoint('x2', 1))], ''],
    'old handoff corrected after a newer one': [[handoff('y', 1, 'act OLD'), handoff('x', 2, 'act NEW'), correction('c', 3, 'y', handoff('y2', 1, 'act OLD-FIXED'))], 'act NEW'],
    'handoff corrected into a handoff': [[handoff('x', 1, 'act A'), correction('c', 2, 'x', handoff('x2', 1, 'act B'))], 'act B'],
    'correction chain': [[handoff('x', 1, 'act A'), correction('c', 2, 'x', handoff('x2', 1, 'act B')), correction('d', 3, 'x2', handoff('x3', 1, 'act C'))], 'act C'],
    'no next_act anywhere': [[checkpoint('k', 1)], ''],
  };
  for (const [name, [events, expected]] of Object.entries(scenarios)) {
    for (const e of events) validateEvent(deepCopy(e));
    await t.test(name, () => {
      assert.equal(oracle(events), expected);
      for (const extra of [[], [malformed]]) {
        const payload = JSON.stringify({ comments: [...events.map(block), ...extra].map((body) => ({ body })) });
        const r = spawnSync(/** @type {string} */ (JQ), ['-r', filter], { input: payload, encoding: 'utf8' });
        assert.equal(r.status, 0, r.stderr);
        assert.equal(r.stdout.trim(), expected);
      }
    });
  }
});

/** @returns {Obj} */
const schema = () => /** @type {Obj} */ (JSON.parse(fs.readFileSync(path.join(CONTRACT, 'event.schema.json'), 'utf8')));

test('the schema documents the continuity field', () => {
  const s = schema();
  const field = s.properties.next_act;
  const strict = field.allOf.filter((/** @type {Obj} */ p) => Object.keys(p).length === 1 && p.not).map((/** @type {Obj} */ p) => new RegExp(p.not.pattern, 'u'));
  assert.equal(strict.length, 1);
  for (const text of PRIVATE_SPELLINGS) assert.ok(strict[0].test(text), text);
  for (const text of PUBLIC_SPELLINGS) assert.ok(!strict[0].test(text), text);
  assert.deepEqual(field.allOf.find((/** @type {Obj} */ p) => p.maxLength), { maxLength: FREE_TEXT_LIMIT, not: { pattern: '[\\r\\n]' } });
  assert.ok(s.allOf.some((/** @type {Obj} */ c) => JSON.stringify(c) === JSON.stringify({ if: { required: ['next_act'] }, then: { properties: { event_type: { enum: [...CONTINUITY_TYPES].sort() } } } })));
});

test('usage is a closed object of numbers and fixed identifiers', async (t) => {
  const accepted = FIXTURE.events[2];
  const handoff = FIXTURE.events[1];
  for (const [label, event] of /** @type {Array<[string, Obj]>} */ ([
    ['native tokens on outcome', changed(accepted, ['usage'], NATIVE_TOKENS)], ['native tokens on handoff', changed(handoff, ['usage'], NATIVE_TOKENS)],
    ['credits only, as Kiro reports', changed(accepted, ['usage'], { usage_provenance: 'native', model: null, credits: new PyFloat(1.25) })],
    ['unavailable with empty values', changed(accepted, ['usage'], { usage_provenance: 'unavailable', model: 'model-a-1', tokens_input: null, tokens_output: null, credits: null })],
    ['minimal unavailable', changed(accepted, ['usage'], { usage_provenance: 'unavailable' })]])) {
    await t.test('valid ' + label, () => assert.equal(validateEvent(event), event));
  }
  for (const [label, usage, message] of /** @type {Array<[string, unknown, string]>} */ ([
    ['added free-text key', merge(NATIVE_TOKENS, { note: 'the session summarised the prompt' }), 'unknown field note'],
    ['non-numeric token value', merge(NATIVE_TOKENS, { tokens_input: '1200' }), 'non-negative integer'],
    ['boolean token value', merge(NATIVE_TOKENS, { tokens_output: true }), 'non-negative integer'],
    ['fractional token value', merge(NATIVE_TOKENS, { tokens_output: new PyFloat(1.5) }), 'non-negative integer'],
    ['negative token value', merge(NATIVE_TOKENS, { tokens_input: -1 }), 'non-negative integer'],
    ['non-numeric credits', merge(NATIVE_TOKENS, { credits: '3' }), 'non-negative number'],
    ['non-finite credits', merge(NATIVE_TOKENS, { credits: new PyFloat(Number.NaN) }), 'non-negative number'],
    ['free-text model', merge(NATIVE_TOKENS, { model: 'the large one, I think' }), 'fixed identifier'],
    ['path as effort', merge(NATIVE_TOKENS, { effort: 'notes/effort.md' }), 'fixed identifier'],
    ['unknown provenance', merge(NATIVE_TOKENS, { usage_provenance: 'estimated' }), 'native or unavailable'],
    ['missing provenance', { tokens_input: 1 }, 'missing usage_provenance'],
    ['unavailable with numbers', { usage_provenance: 'unavailable', tokens_input: 10 }, 'carries no numbers'],
    ['native with no numbers', { usage_provenance: 'native', model: 'model-a-1' }, 'at least one'],
    ['not an object', '1200 tokens', 'must be an object']])) {
    await t.test('invalid ' + label, () => assert.throws(() => validateEvent(changed(accepted, ['usage'], usage)), refused(message)));
  }
  assert.throws(() => validateEvent(changed(FIXTURE.events[0], ['usage'], NATIVE_TOKENS)), refused('usage is only valid on'));
});

test('events without usage stay valid', () => {
  for (const event of FIXTURE.events) {
    assert.ok(!Object.hasOwn(event, 'usage'));
    validateEvent(deepCopy(event));
  }
  const r = rep(trackerExport(CLEAN_EVENTS), CLEAN_SNAPSHOT);
  assert.equal(r.partial, false, r.warnings.join('; '));
  for (const it of r.items) {
    assert.equal(it.usage.coverage, 'none');
    assert.equal(it.usage.tokens_input.sum, null, 'nothing reported is null, never zero');
  }
});

test('the report sums usage per Issue and per harness and marks partial coverage', () => {
  const { events, byId } = usageEvents();
  let r = rep(trackerExport(events), CLEAN_SNAPSHOT);
  assert.equal(r.partial, false, 'usage coverage does not change sprint evidence');
  const items = Object.fromEntries(r.items.map((/** @type {Obj} */ i) => [i.issue, i.usage]));
  assert.equal(items['acme/skills#7'].coverage, 'partial');
  assert.deepEqual(['runs', 'native_runs', 'unavailable_runs', 'unrecorded_runs'].map((k) => items['acme/skills#7'][k]), [2, 1, 0, 1]);
  assert.deepEqual(items['acme/skills#7'].tokens_input, { sum: 1200, runs: 1 });
  assert.deepEqual(items['acme/skills#7'].tokens_output, { sum: 300, runs: 1 });
  assert.equal(items['acme/site#7'].coverage, 'complete');
  assert.deepEqual(items['acme/site#7'].tokens_input, { sum: null, runs: 0 });
  assert.equal(num(items['acme/site#7'].credits.sum), 1.25);
  assert.equal(items['acme/site#7'].credits.runs, 1);
  const harness = r.totals.usage_by_harness;
  assert.deepEqual(Object.keys(harness).sort(), ['claudecode', 'codex', 'kiro']);
  assert.equal(harness.claudecode.coverage, 'none');
  assert.equal(harness.codex.coverage, 'complete');
  assert.equal(harness.codex.tokens_input.sum, 1200);
  assert.equal(num(harness.kiro.credits.sum), 1.25);
  byId['skills-7-accepted'].usage = { usage_provenance: 'unavailable' };
  const extra = without(merge(deepCopy(byId['skills-7-accepted']), { event_id: 'skills-7-second-run', run_id: 'run-z', attempt_id: 'attempt-z', event_type: 'checkpoint', timestamp: '2026-09-02T12:00:00Z', usage: merge(NATIVE_TOKENS, { tokens_input: 50, tokens_output: 5 }) }), 'outcome', 'completion_sprint', 'acceptance_evidence');
  events.push(extra);
  r = rep(trackerExport(events), CLEAN_SNAPSHOT);
  const codex = r.totals.usage_by_harness.codex;
  assert.equal(codex.coverage, 'partial');
  assert.deepEqual(['runs', 'native_runs', 'unavailable_runs', 'unrecorded_runs'].map((k) => codex[k]), [2, 1, 1, 0]);
  assert.deepEqual(codex.tokens_input, { sum: 50, runs: 1 });
  assert.ok(markdown(r).includes('usage by harness'));
});

test('two usage records on one run fail', () => {
  const events = deepCopy(CLEAN_EVENTS);
  for (const e of events) if (e.run_id === 'run-b') e.usage = { ...NATIVE_TOKENS };
  assert.throws(() => rep(trackerExport(events), CLEAN_SNAPSHOT), refused('more than one usage record'));
});

test('the schema documents the usage object', () => {
  const s = schema();
  const usage = s.$defs.usage;
  assert.deepEqual(s.properties.usage, { $ref: '#/$defs/usage' });
  assert.equal(usage.additionalProperties, false);
  assert.deepEqual(new Set(Object.keys(usage.properties)), USAGE_FIELDS);
  assert.deepEqual([...USAGE_PROVENANCE].sort(), [...usage.properties.usage_provenance.enum].sort());
  assert.equal(IDENTIFIER_RE.source, s.$defs.identifier.pattern);
  for (const field of ['tokens_input', 'tokens_output']) assert.deepEqual(usage.properties[field].type, ['integer', 'null']);
  assert.ok(s.allOf.some((/** @type {Obj} */ c) => JSON.stringify(c) === JSON.stringify({ if: { required: ['usage'] }, then: { properties: { event_type: { enum: [...USAGE_TYPES].sort() } } } })));
});

test('inputs are confined to the work tree or the temporary directory', async (t) => {
  for (const [label, p] of [['/etc/hosts', '/etc/hosts'], ['~/.ssh/config', path.join(os.homedir(), '.ssh', 'config')], ['a .. walk out of the temporary directory', path.join(TEMP_ROOT, '..', '..', '..', '..', 'etc', 'hosts')]]) {
    await t.test(label, () => {
      const r = cli(['prepare-event', p]);
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /outside the repository work tree and the temporary directory/);
    });
  }
  const d = tmp();
  try {
    const inside = path.join(d, 'not-json.json');
    fs.writeFileSync(inside, '{');
    const r = cli(['prepare-event', inside]);
    assert.doesNotMatch(r.stderr, /outside the repository work tree/, 'a temp file is read, then fails as JSON');
  } finally {
    fs.rmSync(d, { recursive: true, force: true });
  }
});

// #476: the hand validator is the schema's enforcement. Its enums and patterns are the schema's, and a
// fixture that violates the schema is refused (AC 2 of #476).
test('the validator\'s enums and patterns are the schema\'s', () => {
  const s = schema();
  assert.deepEqual([...EVENT_TYPES].sort(), [...s.properties.event_type.enum].sort());
  assert.deepEqual([...OUTCOMES].sort(), [...s.properties.outcome.enum].sort());
  assert.deepEqual([...PROVENANCE].sort(), [...s.$defs.identity.properties.provenance.enum].sort());
  const reader = new RegExp(s.$defs.publicString.not.pattern, 'u');
  for (const text of [...PRIVATE_SPELLINGS, ...PUBLIC_SPELLINGS, '`/Users/x', 'x /private/tmp/y', 'file://z', 'a .brand/b']) {
    assert.equal(privateEvidence(text), reader.test(text), text);
  }
  const strict = new RegExp(s.properties.next_act.allOf[2].not.pattern, 'u');
  for (const text of [...PRIVATE_SPELLINGS, ...PUBLIC_SPELLINGS]) assert.equal(strictPrivate(text), strict.test(text), text);
});

test('a fixture violating the schema is refused', async (t) => {
  // Each one breaks one schema rule: a required property, a const, an enum, a pattern, a type, an if/then.
  for (const [label, event] of /** @type {Array<[string, Obj]>} */ ([
    ['required evidence', without(deepCopy(FIXTURE.events[0]), 'evidence')], ['schema_version const', merge(deepCopy(FIXTURE.events[0]), { schema_version: 2 })],
    ['event_type enum', merge(deepCopy(FIXTURE.events[0]), { event_type: 'deploy' })], ['issue pattern', merge(deepCopy(FIXTURE.events[0]), { issue: 'acme/skills#0' })],
    ['points integer', changed(FIXTURE.events[0], ['frozen_estimate', 'points'], new PyFloat(8))], ['next_act if/then', merge(deepCopy(FIXTURE.events[0]), { next_act: 'open it' })],
    ['usage additionalProperties', changed(FIXTURE.events[2], ['usage'], merge(NATIVE_TOKENS, { prompt: 'x' }))]])) {
    await t.test(label, () => assert.throws(() => validateEvent(event), ContractError));
  }
});
