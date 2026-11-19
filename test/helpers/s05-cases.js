// The S05 parity cases (#476, convention 3 of #470): `mhw worklog` and `mhw launch-line` against the
// deleted method/scripts/worklog.py and launch-line.py, on the inputs their own suites used (built from
// method/scripts/fixtures/worklog/, unchanged) plus the edges a port gets wrong: float and int rendering,
// key and code-point order, CPython's json errors, naive timestamps, confinement, control characters.
// Every value is synthetic. Placeholders in files and args: {D} the case's directory (also TMPDIR, so an
// allowed root), {CO} a git checkout under it whose name carries a space, `$` and backticks.
import { dumps, deepCopy, PyFloat } from '../../src/lib/py.js';
import {
  FIXTURE, CLEAN_SNAPSHOT, CLEAN_EVENTS, trackerExport, ghCaptures, merge, without, changed, fixture, liveExport,
  usageEvents, NATIVE_TOKENS, pick, envelope, sha,
} from './worklog-fixture.js';

/** @typedef {Record<string, any>} Obj */
/**
 * @typedef {{ name: string, cmd: 'worklog' | 'launch-line', args: string[], files?: Record<string, string | Uint8Array>,
 *   dirs?: string[], cwd?: string, posix?: boolean, why?: string }} Case
 */

/** @param {unknown} v */
const j = (v) => dumps(v, { indent: 2 }) + '\n';

/** The baseline export of the Python suite: every fixture event, the first delivered twice. */
function baselineExport() {
  const events = deepCopy(FIXTURE.events);
  events.push(deepCopy(events[0]));
  return trackerExport(events);
}

/** @param {string} name @param {Obj} snapshot @param {Obj} exp @param {string} [format] @returns {Case} */
const reportCase = (name, snapshot, exp, format = 'json') => ({
  name, cmd: 'worklog', files: { 'snapshot.json': j(snapshot), 'export.json': j(exp) },
  args: ['report', '--snapshot', '{D}/snapshot.json', '--export', '{D}/export.json', '--format', format, '--reproduction-command', 'mhw worklog report --snapshot s --export e'],
});
/** @param {string} name @param {string} verb @param {unknown} event @returns {Case} */
const eventCase = (name, verb, event) => ({ name, cmd: 'worklog', files: { 'event.json': typeof event === 'string' || event instanceof Uint8Array ? event : j(event) }, args: [verb, '{D}/event.json'] });

const handoff = pick(FIXTURE.events, (e) => e.event_type === 'handoff');

function usagePartial() {
  const { events, byId } = usageEvents();
  byId['skills-7-accepted'].usage = { usage_provenance: 'unavailable' };
  events.push(without(merge(deepCopy(byId['skills-7-accepted']), { event_id: 'skills-7-second-run', run_id: 'run-z', attempt_id: 'attempt-z', event_type: 'checkpoint', timestamp: '2026-09-02T12:00:00Z', usage: merge(NATIVE_TOKENS, { tokens_input: 50, tokens_output: 5 }) }), 'outcome', 'completion_sprint', 'acceptance_evidence'));
  return events;
}

/** Floats, a big comment id and non-ASCII text: what the Python printed and hashed, byte for byte. */
function floatsAndText() {
  const events = deepCopy(CLEAN_EVENTS);
  const base = pick(events, (e) => e.event_id === 'site-7-start');
  for (const [i, credits] of [0.1, 0.1, 0.1, 2].entries()) {
    const cp = without(merge(deepCopy(base), { event_id: 'site-7-run-' + i, run_id: 'run-f' + i, event_type: 'checkpoint', timestamp: '2026-09-02T0' + i + ':00:00Z' }), 'frozen_estimate');
    cp.usage = { usage_provenance: 'native', credits: i === 3 ? 2 : new PyFloat(credits) };
    cp.attribution.harness = ['Stra\u00dfe', 'Kiro', 'KIRO', '\ufb01re'][i];
    cp.evidence = ['caf\u00e9 \u2014 \u00f1 \u201cquoted\u201d \u2713 \u{1f600}'];
    events.push(cp);
  }
  const exp = trackerExport(events);
  exp.comments[0].comment_id = 123456789012345678901234567890n;
  exp.prior_inventory.comment_ids[0] = 123456789012345678901234567890n;
  exp.comments.push({ ...deepCopy(exp.comments[1]), comment_id: 'IC_text-id' });
  exp.prior_inventory.comment_ids.push('IC_text-id', 'IC_gone');
  return exp;
}

/** @returns {Case[]} */
function worklogCases() {
  const [captures] = ghCaptures(CLEAN_EVENTS);
  const capFiles = Object.fromEntries(captures.map((c, i) => ['capture-' + i + '.json', j(c)]));
  const capArgs = captures.flatMap((_, i) => ['--capture', '{D}/capture-' + i + '.json']);
  const edited = deepCopy(captures);
  edited[0].comments[0].includesCreatedEdit = true;
  const correction = merge(deepCopy(handoff), { event_type: 'correction', event_id: 'skills-7-correction', supersedes_event_id: handoff.event_id, corrected_event: merge(deepCopy(handoff), { event_id: 'skills-7-handoff-v2' }) });
  const chainEvents = deepCopy(FIXTURE.events);
  const r1 = merge(deepCopy(chainEvents[0]), { event_id: 'skills-7-start-r1' });
  r1.frozen_estimate.points = 13;
  const first = merge(deepCopy(chainEvents[1]), { event_id: 'correction-r1', timestamp: '2026-09-07T10:00:00Z', event_type: 'correction', supersedes_event_id: chainEvents[0].event_id, corrected_event: r1 });
  const r2 = merge(deepCopy(r1), { event_id: 'skills-7-start-r2' });
  r2.frozen_estimate.points = 21;
  const second = merge(deepCopy(first), { event_id: 'correction-r2', timestamp: '2026-09-08T10:00:00Z', supersedes_event_id: r1.event_id, corrected_event: r2 });
  const cancelled = deepCopy(CLEAN_EVENTS);
  cancelled.push(without(merge(deepCopy(pick(cancelled, (e) => e.event_id === 'site-7-accepted')), { event_id: 'site-7-cancelled', timestamp: '2026-09-06T11:00:00Z', outcome: 'cancelled' }), 'completion_sprint', 'acceptance_evidence'));
  const badPagination = trackerExport(FIXTURE.events);
  badPagination.repositories[0].pagination_complete = 'false';
  const prior = (() => {
    const [c] = ghCaptures(CLEAN_EVENTS);
    return j({ schema_version: 1, cutoff: '2026-10-01T00:00:00Z', repositories: [{ repository: 'acme/site', pagination_complete: true }, { repository: 'acme/skills', pagination_complete: true }],
      prior_inventory: { complete: false, comment_ids: [] },
      comments: c.flatMap((cap) => cap.comments.map((/** @type {Obj} */ k) => {
        const [repo, num] = cap.url.replace('https://github.com/', '').split('/issues/');
        return { repository: repo, issue: repo + '#' + num, comment_id: Number(k.url.split('-').pop()), created_at: k.createdAt, updated_at: k.createdAt, body: k.body, body_sha256: sha(k.body) };
      })) });
  })();
  const twoUsage = deepCopy(CLEAN_EVENTS);
  for (const e of twoUsage) if (e.run_id === 'run-b') e.usage = { ...NATIVE_TOKENS };
  const prose = trackerExport(CLEAN_EVENTS);
  const quoted = 'the `' + envelope(CLEAN_EVENTS[0]).split('\n')[0] + '` marker\n<!-- worklog-event:v1 -->  \r\n  ```json  {"x": 1}  ```';
  prose.comments.push({ repository: 'acme/skills', issue: 'acme/skills#7', comment_id: 900, created_at: '2026-09-02T00:00:00Z', updated_at: '2026-09-02T00:00:00Z', body: quoted, body_sha256: sha(quoted) });
  prose.prior_inventory.comment_ids.push(900);
  return [
    eventCase('validate-start', 'validate-event', FIXTURE.events[0]),
    eventCase('validate-handoff', 'validate-event', handoff),
    eventCase('prepare-start', 'prepare-event', FIXTURE.events[0]),
    eventCase('prepare-handoff-without-next-act', 'prepare-event', handoff),
    eventCase('prepare-handoff-with-next-act', 'prepare-event', merge(handoff, { next_act: 'open the merge request for the branch at the named commit' })),
    eventCase('prepare-correction-recursion', 'prepare-event', correction),
    eventCase('validate-schema-version-true', 'validate-event', merge(FIXTURE.events[0], { schema_version: true })),
    eventCase('validate-schema-version-string', 'validate-event', merge(FIXTURE.events[0], { schema_version: "it's \"2\"" })),
    eventCase('validate-schema-version-float', 'validate-event', merge(FIXTURE.events[0], { schema_version: new PyFloat(1) })),
    eventCase('validate-schema-version-list', 'validate-event', merge(FIXTURE.events[0], { schema_version: [1, null, false, 'x\n', new PyFloat(1e-7)] })),
    eventCase('validate-usage-free-text-key', 'validate-event', changed(FIXTURE.events[2], ['usage'], merge(NATIVE_TOKENS, { note: 'summary', another: 1 }))),
    eventCase('validate-next-act-private', 'validate-event', merge(handoff, { next_act: 'resume from /U\u017fERS/x' })),
    eventCase('validate-next-act-kelvin-brand', 'validate-event', merge(handoff, { next_act: 'see the .bran\u212a? no: the .brand' })),
    eventCase('validate-evidence-private-backtick', 'validate-event', merge(handoff, { evidence: ['see `/Users/x'] })),
    eventCase('validate-usage-provenance-list', 'validate-event', changed(FIXTURE.events[2], ['usage'], { usage_provenance: ['native'] })),
    eventCase('validate-bad-timestamp', 'validate-event', merge(FIXTURE.events[0], { timestamp: '2026-02-30T10:00:00Z' })),
    eventCase('validate-week-date-timestamp', 'validate-event', merge(FIXTURE.events[0], { timestamp: '2026-W53-1T24:00Z' })),
    eventCase('validate-commit-int', 'validate-event', changed(FIXTURE.events[0], ['revision', 'commit'], 12345678)),
    eventCase('validate-invalid-json', 'validate-event', '{"a": 1,\n "b": [1, 2,]}'),
    eventCase('validate-bom', 'validate-event', '\ufeff' + j(FIXTURE.events[0])),
    eventCase('validate-crlf', 'validate-event', j(FIXTURE.events[0]).replaceAll('\n', '\r\n')),
    eventCase('validate-not-utf8', 'validate-event', /** @type {any} */ (Uint8Array.from([0x7b, 0xff, 0x7d]))),
    { name: 'validate-missing-file', cmd: 'worklog', args: ['validate-event', '{D}/missing.json'], posix: true },
    { name: 'validate-directory', cmd: 'worklog', dirs: ['adir'], args: ['validate-event', '{D}/adir'], posix: true },
    { name: 'validate-outside-roots', cmd: 'worklog', args: ['validate-event', '/etc/hosts'], posix: true },
    reportCase('report-baseline-json', FIXTURE.snapshot, baselineExport()),
    reportCase('report-baseline-markdown', FIXTURE.snapshot, baselineExport(), 'markdown'),
    reportCase('report-clean-json', CLEAN_SNAPSHOT, trackerExport(CLEAN_EVENTS)),
    reportCase('report-clean-markdown', CLEAN_SNAPSHOT, trackerExport(CLEAN_EVENTS), 'markdown'),
    reportCase('report-usage-json', CLEAN_SNAPSHOT, trackerExport(usageEvents().events)),
    reportCase('report-usage-markdown', CLEAN_SNAPSHOT, trackerExport(usageEvents().events), 'markdown'),
    reportCase('report-usage-partial-json', CLEAN_SNAPSHOT, trackerExport(usagePartial())),
    reportCase('report-two-usage-on-one-run', CLEAN_SNAPSHOT, trackerExport(twoUsage)),
    reportCase('report-floats-and-text-json', CLEAN_SNAPSHOT, floatsAndText()),
    reportCase('report-floats-and-text-markdown', CLEAN_SNAPSHOT, floatsAndText(), 'markdown'),
    reportCase('report-live-correction-json', /** @type {Obj} */ (fixture('sprint-03.worklog.json')), liveExport()),
    reportCase('report-live-correction-markdown', /** @type {Obj} */ (fixture('sprint-03.worklog.json')), liveExport(), 'markdown'),
    reportCase('report-points-per-week-9.1', merge(deepCopy(CLEAN_SNAPSHOT), { ends_at: '2026-09-11T00:00:00Z' }), trackerExport(CLEAN_EVENTS)),
    reportCase('report-points-per-week-fraction', merge(deepCopy(CLEAN_SNAPSHOT), { ends_at: '2026-09-04T07:13:17.123456Z' }), trackerExport(CLEAN_EVENTS), 'markdown'),
    reportCase('report-sprint-mismatch-markdown', merge(deepCopy(CLEAN_SNAPSHOT), { sprint: 'sprint-other' }), trackerExport(CLEAN_EVENTS), 'markdown'),
    reportCase('report-excluded-cancelled', CLEAN_SNAPSHOT, trackerExport(cancelled)),
    reportCase('report-unestimated', CLEAN_SNAPSHOT, trackerExport(CLEAN_EVENTS.filter((e) => e.event_id !== 'site-7-start'))),
    reportCase('report-correction-chain', FIXTURE.snapshot, trackerExport([...chainEvents, first, second])),
    reportCase('report-empty-export', FIXTURE.snapshot, trackerExport([])),
    reportCase('report-no-boundary-markdown', merge(deepCopy(CLEAN_SNAPSHOT), { starts_at: null }), trackerExport(CLEAN_EVENTS), 'markdown'),
    reportCase('report-incomplete-pagination', FIXTURE.snapshot, trackerExport(FIXTURE.events, false)),
    reportCase('report-invalid-pagination', FIXTURE.snapshot, badPagination),
    reportCase('report-prose-marker', CLEAN_SNAPSHOT, prose),
    reportCase('report-naive-and-aware-boundary', merge(deepCopy(CLEAN_SNAPSHOT), { starts_at: '2026-09-01Z' }), trackerExport(CLEAN_EVENTS)),
    reportCase('report-naive-cutoff', CLEAN_SNAPSHOT, merge(trackerExport(CLEAN_EVENTS), { cutoff: '2026-10-01Z' })),
    { ...reportCase('report-abbreviated-options', CLEAN_SNAPSHOT, trackerExport(CLEAN_EVENTS)), args: ['report', '--snap', '{D}/snapshot.json', '--export={D}/export.json', '--repro', 'r'] },
    { name: 'export-clean', cmd: 'worklog', files: capFiles, args: ['export', '--cutoff', '2026-10-01T00:00:00Z', ...capArgs] },
    { name: 'export-with-prior-complete', cmd: 'worklog', files: { ...capFiles, 'prior.json': prior }, args: ['export', '--cutoff', '2026-10-01T00:00:00Z', ...capArgs, '--prior', '{D}/prior.json', '--pagination-complete'] },
    { name: 'export-edited', cmd: 'worklog', files: Object.fromEntries(edited.map((c, i) => ['capture-' + i + '.json', j(c)])), args: ['export', '--cutoff', '2026-10-01T00:00:00Z', ...capArgs] },
    { name: 'export-bad-cutoff', cmd: 'worklog', files: capFiles, args: ['export', '--cutoff', 'not-a-time', ...capArgs] },
    { name: 'export-empty-prior-is-none', cmd: 'worklog', files: capFiles, args: ['export', '--cutoff', '2026-10-01T00:00:00Z', ...capArgs, '--prior', ''] },
    { name: 'usage-no-command', cmd: 'worklog', args: [] },
    { name: 'usage-unknown-command', cmd: 'worklog', args: ['summarise'] },
    { name: 'usage-report-missing-options', cmd: 'worklog', args: ['report', '--snapshot', 'x'] },
    { name: 'usage-report-bad-format', cmd: 'worklog', args: ['report', '--snapshot', 'x', '--export', 'y', '--reproduction-command', 'r', '--format', 'xml'] },
    { name: 'usage-validate-extra-argument', cmd: 'worklog', args: ['validate-event', 'a.json', 'b.json'] },
    { name: 'usage-export-flag-with-value', cmd: 'worklog', args: ['export', '--cutoff', 'x', '--capture', 'y', '--pagination-complete=yes'] },
    { name: 'usage-help', cmd: 'worklog', args: ['--help'] },
  ];
}

const PROMPT = ["Objective: ship the owner's handoff command",
  'Continue owner/repo#12 in this fresh session; the session that printed this prompt stops now.',
  "Next act: run the suite; it's green when 'OK' prints, not $HOME or $(date) or `id`.",
  'Evidence: ```fence``` and \\n and "quoted" and !! and \\\'\' stay as typed.',
  'Before acting, re-derive the state from the tracker: gh issue view 12 --repo owner/repo --comments.'].join('\n');

/** @param {string} name @param {string | Uint8Array} prompt @param {string[]} [extra] @param {string} [target] @returns {Case} */
const line = (name, prompt, extra = [], target = 'codex') => ({ name, cmd: 'launch-line', files: { 'prompt.txt': prompt }, dirs: ['{CO}/.git'], args: [target, '{D}/prompt.txt', '--cd', '{CO}', ...extra] });

/** @returns {Case[]} */
function launchLineCases() {
  return [
    { name: 'resolve-kept', cmd: 'launch-line', args: ['--resolve', 'claude-code'] },
    { name: 'resolve-consumed-alias', cmd: 'launch-line', args: ['--resolve', 'codex', 'kiro-cli'] },
    { name: 'resolve-kept-word', cmd: 'launch-line', args: ['--resolve', 'kiro', 'ship'] },
    { name: 'resolve-unknown-current', cmd: 'launch-line', args: ['--resolve', 'cursor'] },
    { name: 'resolve-no-argument', cmd: 'launch-line', args: ['--resolve'] },
    line('block-claude', PROMPT, [], 'claude'),
    line('block-claude-code', PROMPT, [], 'claude-code'),
    line('block-codex', PROMPT),
    line('block-kiro', PROMPT, [], 'kiro'),
    line('block-kiro-cli', PROMPT, [], 'kiro-cli'),
    line('block-backtick-fence', 'Objective: keep ```` four and ````` five backticks'),
    line('block-crlf-and-trailing-newlines', 'Objective: x\r\nNext act: y\r\n\r\n\n'),
    line('block-astral-line-at-limit', '\u{1f600}'.repeat(280)),
    line('block-bom-kept', '\ufeffObjective: x'),
    line('block-goal-in-a-later-line', 'Objective: x\nmention /goal here'),
    line('refuse-goal-first', '/goal ship it\nNext act: run it.'),
    line('refuse-goal-alone', '/goal'),
    line('refuse-long-line', 'Objective: ' + 'x'.repeat(300)),
    line('refuse-astral-line-over-limit', '\u{1f600}'.repeat(281)),
    line('refuse-private-path', 'Objective: fix it\nEvidence: /Use' + 'rs/someone/notes.txt'),
    line('refuse-private-folded', 'Objective: fix it\nEvidence: /U\u017fers/x and C:\\temp and .BRAND'),
    line('refuse-controls', 'Objective: fix it\nNext act: \x03 \x1b[201~ \x15 SENTINEL\nmore \t tab\nbidi \u202e here\nlone \r cr\ndel \x7f\nc1 \x85'),
    line('refuse-empty', '\n'),
    line('refuse-whitespace-only', ' \t\u3000\n'),
    line('refuse-env-not-declared', PROMPT, ['--env', 'CODEX_HOME=SENTINELVALUE', '--env', 'X=a\nb', '--env', 'Y=/home/x']),
    line('refuse-several-problems', '/goal\n' + 'y'.repeat(281) + '\n~/x', ['--env', 'Z=1']),
    { ...line('refuse-cd-relative', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', 'some/checkout'] },
    { ...line('refuse-cd-missing', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{D}/absent'] },
    { ...line('refuse-cd-no-git', PROMPT), dirs: ['plain'], args: ['codex', '{D}/prompt.txt', '--cd', '{D}/plain'] },
    { ...line('refuse-cd-newline', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{CO}\nid'] },
    { ...line('usage-cd-missing', PROMPT), args: ['codex', '{D}/prompt.txt'] },
    { ...line('usage-cd-twice', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{CO}', '--cd', '{CO}'] },
    { ...line('usage-env-without-equals', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{CO}', '--env', 'NOEQUALS'] },
    { ...line('usage-unknown-target', PROMPT), args: ['cursor', '{D}/prompt.txt', '--cd', '{CO}'] },
    { ...line('usage-dangling-option', PROMPT), args: ['codex', '{D}/prompt.txt', '--cd', '{CO}', '--env'] },
    { ...line('refuse-prompt-outside-roots', PROMPT), args: ['codex', '/etc/hosts', '--cd', '{CO}'], posix: true },
    { ...line('refuse-prompt-directory', PROMPT), dirs: ['{CO}/.git', 'adir'], args: ['codex', '{D}/adir', '--cd', '{CO}'] },
    { ...line('refuse-prompt-missing', PROMPT), args: ['codex', '{D}/nope.txt', '--cd', '{CO}'] },
    line('refuse-prompt-oversize', 'Objective: x\n' + ('y'.repeat(200) + '\n').repeat(400)),
    line('read-error-not-utf8', Uint8Array.from([0x4f, 0x62, 0xff, 0x0a])),
  ];
}

/** @type {Case[]} */
export const CASES = [...worklogCases(), ...launchLineCases()];
export const CHECKOUT_NAME = 'check out $HOME `id`';
