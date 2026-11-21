// The S28 golden cases (#498, S28 of #470): what the deleted global/project-policy/project_policy.py
// answered through `./mhw policy ...`, on synthetic contracts in throwaway directories, so the Node
// validator is held to it after the deletion. Every value is synthetic.
//
// A case writes its files under {BASE} (the case's directory, also its working directory and HOME), then
// runs `mhw policy <args>`; {BASE} in an argument is that directory. A file is `doc` (written as JSON with
// two-space indent), `text` (UTF-8, verbatim) or `hex` (bytes). `mode` makes a file unreadable (POSIX, and
// not as root). Each case's transcript is the exit code, stdout and stderr.
//
// VALID is a frozen copy of global/project-policy/project-policy.example.json at the recording, so a later
// edit to the example does not move these goldens; the contract and check suites read the live file.

export const VALID = Object.freeze({
  schema_version: 1,
  project: 'example-owner/example-app',
  madr: { path: 'docs/adr/0007-quality-bar-and-deployment-risk.md', status: 'accepted' },
  coverage: { threshold_percent: 85, metric: 'line' },
  mandatory_scenarios: {
    critical_user_journeys: [
      { id: 'sign-in', description: 'A registered reader signs in and reaches the home page.' },
      { id: 'read-article', description: 'A visitor opens a published article from the index.' },
    ],
    security_controls: ['quality-scan', 'sast', 'owasp-vulnerability-coverage', 'authentication', 'authorization',
      'encryption-in-transit', 'encryption-at-rest', 'dependency-scan'],
    risk_scenarios: [
      { id: 'unpublished-draft-exposed', description: 'A draft not yet approved is never served to an anonymous visitor.' },
    ],
  },
  severity: { tolerated: ['low'], unclassified: 'block', inconclusive: 'block' },
  low_findings: { bug_issue_required: true, issue_label: 'bug' },
  risk_classification: {
    rules: [
      { class: 'high', when: 'The change touches infrastructure, authentication, data migrations or a public contract.' },
      { class: 'low', when: 'Every other change.' },
    ],
    unclassified: 'block',
  },
  approval: { low_risk: 'automatic-after-all-gates', high_risk: 'owner-exact-revision' },
  recovery: { mode: 'automatic-rollback' },
});

// A frozen copy of global/project-policy/project-policy.invalid.json at the recording, for the same reason.
const INVALID = "{\n  \"schema_version\": 1,\n  \"project\": \"example-owner/example-app\",\n  \"madr\": {\n    \"path\": \"docs/adr/0007-quality-bar-and-deployment-risk.md\",\n    \"status\": \"proposed\"\n  },\n  \"coverage\": {\n    \"threshold_percent\": 5,\n    \"metric\": \"line\"\n  },\n  \"mandatory_scenarios\": {\n    \"critical_user_journeys\": [\n      { \"id\": \"sign-in\", \"description\": \"A registered reader signs in and reaches the home page.\" }\n    ],\n    \"security_controls\": [\"quality-scan\", \"authentication\", \"authorization\"],\n    \"risk_scenarios\": [\n      { \"id\": \"unpublished-draft-exposed\", \"description\": \"A draft not yet approved is never served to an anonymous visitor.\" }\n    ]\n  },\n  \"severity\": {\n    \"tolerated\": [\"low\", \"medium\"],\n    \"unclassified\": \"block\",\n    \"inconclusive\": \"block\"\n  },\n  \"low_findings\": {\n    \"bug_issue_required\": false,\n    \"issue_label\": \"bug\"\n  },\n  \"risk_classification\": {\n    \"rules\": [\n      { \"class\": \"low\", \"when\": \"Every change.\" }\n    ],\n    \"unclassified\": \"block\"\n  },\n  \"approval\": {\n    \"low_risk\": \"automatic-after-all-gates\",\n    \"high_risk\": \"automatic-after-all-gates\"\n  },\n  \"recovery\": {\n    \"mode\": \"manual\",\n    \"recovery_time_objective_minutes\": 30\n  }\n}\n";

const MANUAL = {
  mode: 'manual',
  recovery_time_objective_minutes: 30,
  runbook: { path: 'docs/runbooks/rollback.md', last_tested: '2026-10-30' },
  operator: '@example-operator',
};

/** @param {any} v @returns {any} */
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * VALID with each [path, value] set (value undefined deletes the key).
 * @param {Array<[string, any]>} edits a dotted path, numbers for array items
 */
export function edit(edits, base = VALID) {
  const doc = clone(base);
  for (const [where, value] of edits) {
    const trail = where.split('.').map((s) => (/^\d+$/.test(s) ? Number(s) : s));
    let parent = doc;
    for (const step of trail.slice(0, -1)) parent = parent[step];
    const last = trail[trail.length - 1];
    if (value === undefined) delete parent[last];
    else parent[last] = value;
  }
  return doc;
}

/** @param {any} doc */
const text = (doc) => JSON.stringify(doc, null, 2) + '\n';
/** The valid file with one literal replaced: a number form JSON.stringify cannot write. @param {string} from @param {string} to */
const raw = (from, to) => {
  const t = text(VALID);
  if (!t.includes(from)) throw new Error('s28-cases: ' + from + ' is not in the valid text');
  return t.replace(from, to);
};

/**
 * @typedef {{ doc?: any, text?: string, hex?: string, mode?: number }} File
 * @typedef {{ name: string, files?: Record<string, File>, args: string[], posix?: boolean, notRoot?: boolean }} Case
 */

const F = 'project-policy.json';
/** One case: the file at {BASE}/project-policy.json, checked with --file. @param {string} name @param {File} file @returns {Case} */
const one = (name, file) => ({ name, files: { [F]: file }, args: ['check', '--file={BASE}/' + F] });
/** @param {string} name @param {Array<[string, any]>} edits @param {any} [base] */
const doc = (name, edits, base) => one(name, { doc: edit(edits, base) });

const manual = edit([['recovery', MANUAL]]);
const override = edit([['baseline_override', {
  definition_of_done: { additional_criteria: [{ id: 'accessibility-audit', description: 'Every new page passes an audit.' }] },
  documentation: { additional_docs: [{ path: 'docs/runbooks/rollback.md', description: 'The rollback runbook is current.' }] },
}]]);

/** @type {Case[]} */
export const CASES = [
  // -- passes, and the forms of the command ------------------------------------------------------
  one('valid-by-file', { doc: VALID }),
  { name: 'valid-by-project', files: { ['proj/' + F]: { doc: VALID } }, args: ['check', '--project={BASE}/proj'] },
  { name: 'valid-by-project-trailing-separators', files: { ['proj/' + F]: { doc: VALID } }, args: ['check', '--project={BASE}/./proj//'] },
  { name: 'valid-in-the-working-directory', files: { [F]: { doc: VALID } }, args: ['check'] },
  { name: 'valid-relative-project', files: { ['a/b/' + F]: { doc: VALID } }, args: ['check', '--project=a/./b'] },
  { name: 'valid-relative-file', files: { [F]: { doc: VALID } }, args: ['check', '--file=' + F] },
  { name: 'valid-the-last-project-wins', files: { ['b/' + F]: { doc: VALID } }, args: ['check', '--project=a', '--project=b'] },
  { name: 'valid-project-dot', files: { [F]: { doc: VALID } }, args: ['check', '--project=.'] },
  doc('valid-manual-recovery', [['recovery', MANUAL]]),
  doc('valid-manual-recovery-tested-tomorrow-is-slack', [['recovery.runbook.last_tested', '2026-11-08']], manual),
  doc('valid-leap-day', [['recovery.runbook.last_tested', '2024-02-29']], manual),
  doc('valid-stricter-values', [['coverage.threshold_percent', 100], ['severity.tolerated', []],
    ['approval.low_risk', 'owner-exact-revision'], ['risk_classification.rules', [{ class: 'high', when: 'Every change.' }]]]),
  doc('valid-coverage-as-a-float', [['coverage.threshold_percent', 85.5]]),
  one('valid-coverage-written-85.0', { text: raw('"threshold_percent": 85', '"threshold_percent": 85.0') }),
  one('valid-coverage-written-8.5e1', { text: raw('"threshold_percent": 85', '"threshold_percent": 8.5e1') }),
  one('valid-full-baseline-override', { doc: override }),
  doc('valid-empty-baseline-override', [['baseline_override', {}]]),
  doc('valid-free-text-ending-in-a-newline', [['low_findings.issue_label', 'bug\n']]),
  one('valid-crlf-and-a-surrogate-pair-escape', { text: text(edit([['low_findings.issue_label', 'bug 😀']])).replaceAll('\n', '\r\n').replace('😀', '\\ud83d\\ude00') }),

  // -- usage -------------------------------------------------------------------------------------
  { name: 'usage-no-subcommand', args: [] },
  { name: 'usage-another-subcommand', args: ['validate'] },
  { name: 'usage-an-option-first', args: ['--project=.'] },
  { name: 'usage-check-twice', args: ['check', 'check'] },
  { name: 'usage-both-options', args: ['check', '--project=a', '--file=b'] },
  { name: 'usage-an-unknown-option', args: ['check', '--projects=a'] },
  { name: 'usage-an-empty-file', args: ['check', '--file='] },
  { name: 'usage-an-empty-project', args: ['check', '--project='] },
  { name: 'usage-a-positional', args: ['check', 'project-policy.json'] },

  // -- missing and unreadable --------------------------------------------------------------------
  { name: 'missing-in-a-project', files: { 'proj/README.md': { text: 'x\n' } }, args: ['check', '--project={BASE}/proj'] },
  { name: 'missing-in-the-working-directory', args: ['check'] },
  { name: 'missing-file', args: ['check', '--file={BASE}/absent.json'] },
  { name: 'missing-a-directory-by-file', files: { 'dir/x': { text: 'x' } }, args: ['check', '--file={BASE}/dir'] },
  { name: 'missing-a-directory-named-like-the-file', files: { [F + '/x']: { text: 'x' } }, args: ['check', '--project={BASE}'] },
  { name: 'unreadable-through-a-file', posix: true, files: { [F]: { doc: VALID } }, args: ['check', '--file={BASE}/' + F + '/x'] },
  { name: 'unreadable-permission', posix: true, notRoot: true, files: { [F]: { doc: VALID, mode: 0o000 } }, args: ['check', '--file={BASE}/' + F] },

  // -- malformed ---------------------------------------------------------------------------------
  one('malformed-truncated', { text: '{"schema_version": 1,' }),
  one('malformed-empty', { text: '' }),
  one('malformed-whitespace-only', { text: ' \n\t' }),
  one('malformed-not-utf-8', { hex: 'fffe7b7d' }),
  one('malformed-an-encoded-surrogate', { hex: '7b22eda080223a317d' }),
  one('malformed-a-byte-order-mark', { text: '\uFEFF' + text(VALID) }),
  one('malformed-nan', { text: raw('"threshold_percent": 85', '"threshold_percent": NaN') }),
  one('malformed-infinity', { text: raw('"threshold_percent": 85', '"threshold_percent": Infinity') }),
  one('malformed-minus-infinity', { text: raw('"threshold_percent": 85', '"threshold_percent": -Infinity') }),
  one('malformed-repeated-key-at-the-top', { text: raw('"schema_version": 1,', '"schema_version": 1,\n  "schema_version": 1,') }),
  one('malformed-repeated-keys-nested', { text: raw('"high_risk": "owner-exact-revision"', '"high_risk": "owner-exact-revision", "low_risk": "x", "high_risk": "automatic-after-all-gates"') }),
  one('malformed-repeated-non-ascii-key', { text: '{"é": 1, "é": 2, "\\u00e9x": 3, "b": 1, "b": 2}' }),
  one('malformed-trailing-comma-object', { text: '{"a": 1,\n}' }),
  one('malformed-trailing-comma-array', { text: '[1, 2,]' }),
  one('malformed-missing-colon', { text: '{"a" 1}' }),
  one('malformed-missing-comma', { text: '{"a": 1 "b": 2}' }),
  one('malformed-single-quotes', { text: "{'a': 1}" }),
  one('malformed-bad-escape', { text: '{"a": "\\x"}' }),
  one('malformed-bad-unicode-escape', { text: '{"a": "\\u12G4"}' }),
  one('malformed-control-character', { text: '{"a": "tab\there"}' }),
  one('malformed-unterminated-string', { text: '{"a": "open' }),
  one('malformed-extra-data', { text: '{}\n\n{}' }),
  one('malformed-leading-zero', { text: '{"a": 01}' }),
  one('malformed-plus-sign', { text: '{"a": +1}' }),
  one('malformed-a-bare-word', { text: '{"a": yes}' }),
  one('malformed-an-integer-past-4300-digits', { text: '{"schema_version": ' + '9'.repeat(4301) + '}' }),
  one('malformed-nested-deeper-than-the-stack', { text: '['.repeat(1000001) + ']'.repeat(1000001) }),
  one('not-an-object-array', { text: '[' + text(VALID) + ']' }),
  one('not-an-object-string', { text: '"x"' }),
  one('not-an-object-number', { text: '1' }),
  one('not-an-object-null', { text: 'null' }),
  one('not-an-object-true', { text: 'true' }),

  // -- unknown version ---------------------------------------------------------------------------
  doc('version-absent', [['schema_version', undefined]]),
  doc('version-2', [['schema_version', 2]]),
  doc('version-true', [['schema_version', true]]),
  doc('version-a-string', [['schema_version', '1']]),
  doc('version-1.5', [['schema_version', 1.5]]),
  doc('version-null', [['schema_version', null]]),
  doc('version-a-list', [['schema_version', [1, 'é']]]),
  doc('version-an-object', [['schema_version', { b: 1, a: [true, null], é: '\n' }]]),
  one('version-written-1.0', { text: raw('"schema_version": 1,', '"schema_version": 1.0,') }),
  one('version-a-big-integer', { text: raw('"schema_version": 1,', '"schema_version": 123456789012345678901234567890,') }),
  one('version-1e16', { text: raw('"schema_version": 1,', '"schema_version": 1e16,') }),
  one('version-minus-zero-float', { text: raw('"schema_version": 1,', '"schema_version": -0.0,') }),
  one('version-minus-zero-integer', { text: raw('"schema_version": 1,', '"schema_version": -0,') }),
  one('version-a-small-float', { text: raw('"schema_version": 1,', '"schema_version": 1.5e-7,') }),

  // -- the #192 classes and the rest of the floor --------------------------------------------------
  one('the-invalid-example', { text: INVALID }),
  doc('risk-classification-absent', [['risk_classification', undefined]]),
  doc('risk-classification-unclassified-low', [['risk_classification.unclassified', 'low']]),
  doc('risk-classification-no-rules', [['risk_classification.rules', []]]),
  doc('risk-classification-all-low', [['risk_classification.rules', [{ class: 'low', when: 'Always.' }]]]),
  doc('risk-classification-medium', [['risk_classification.rules', [{ class: 'medium', when: 'x' }]]]),
  doc('risk-classification-blank-when', [['risk_classification.rules.0.when', ' \t']]),
  doc('evidence-scenarios-absent', [['mandatory_scenarios', undefined]]),
  doc('evidence-no-sast', [['mandatory_scenarios.security_controls', ['quality-scan', 'owasp-vulnerability-coverage',
    'authentication', 'authorization', 'encryption-in-transit', 'encryption-at-rest']]]),
  doc('evidence-a-repeated-and-unknown-control', [['mandatory_scenarios.security_controls',
    [...VALID.mandatory_scenarios.security_controls, 'sast', 'made-up']]]),
  // true is not 1 in JSON (the original's same()), so true and 1 are two items, not one repeated.
  doc('evidence-true-and-one-are-not-repeats', [['mandatory_scenarios.security_controls',
    [...VALID.mandatory_scenarios.security_controls, true, 1]]]),
  one('evidence-one-and-one-point-zero-are-repeats', { text: raw('"dependency-scan"', '"dependency-scan", 1, 1.0') }),
  doc('evidence-no-journeys', [['mandatory_scenarios.critical_user_journeys', []]]),
  doc('evidence-no-risk-scenarios', [['mandatory_scenarios.risk_scenarios', []]]),
  doc('evidence-coverage-absent', [['coverage', undefined]]),
  doc('evidence-coverage-a-string', [['coverage.threshold_percent', '85']]),
  doc('coverage-5', [['coverage.threshold_percent', 5]]),
  doc('coverage-84.99', [['coverage.threshold_percent', 84.99]]),
  doc('coverage-0', [['coverage.threshold_percent', 0]]),
  doc('coverage-101', [['coverage.threshold_percent', 101]]),
  doc('coverage-1000', [['coverage.threshold_percent', 1000]]),
  one('coverage-1e400', { text: raw('"threshold_percent": 85', '"threshold_percent": 1e400') }),
  doc('coverage-an-unknown-metric', [['coverage.metric', 'lines']]),
  doc('severity-medium', [['severity.tolerated', ['medium']]]),
  doc('severity-high', [['severity.tolerated', ['high']]]),
  doc('severity-critical', [['severity.tolerated', ['critical']]]),
  doc('severity-low-and-medium', [['severity.tolerated', ['low', 'medium']]]),
  doc('severity-a-string', [['severity.tolerated', 'medium']]),
  doc('severity-moderate', [['severity.tolerated', ['moderate']]]),
  doc('severity-upper-case', [['severity.tolerated', ['LOW']]]),
  doc('severity-unclassified-tolerated', [['severity.unclassified', 'tolerate']]),
  doc('severity-absent', [['severity', undefined]]),
  doc('severity-an-extra-key-starting-tolerated', [['severity.toleratedLater', 'high']]),
  doc('inconclusive-tolerate', [['severity.inconclusive', 'tolerate']]),
  doc('inconclusive-pass', [['severity.inconclusive', 'pass']]),
  doc('inconclusive-null', [['severity.inconclusive', null]]),
  doc('approval-high-risk-automatic', [['approval.high_risk', 'automatic-after-all-gates']]),
  doc('low-findings-no-bug-issue', [['low_findings.bug_issue_required', false]]),
  doc('low-findings-one-for-true', [['low_findings.bug_issue_required', 1]]),
  doc('low-findings-empty-label', [['low_findings.issue_label', '']]),
  doc('low-findings-blank-label', [['low_findings.issue_label', '- . -']]),
  doc('low-findings-non-ascii-letters-only', [['low_findings.issue_label', 'ção']]),
  doc('madr-proposed', [['madr.status', 'proposed']]),
  doc('madr-outside-the-repository', [['madr.path', '../other/adr.md']]),
  doc('madr-absolute', [['madr.path', '/etc/adr.md']]),
  doc('madr-not-markdown', [['madr.path', 'docs/adr/0007.txt']]),
  doc('recovery-no-operator', [['recovery.operator', undefined]], manual),
  doc('recovery-nothing-but-the-mode', [['recovery', { mode: 'manual' }]]),
  doc('recovery-an-unknown-mode', [['recovery.mode', 'none']]),
  doc('recovery-rto-zero', [['recovery.recovery_time_objective_minutes', 0]], manual),
  one('recovery-rto-a-float', { text: text(manual).replace('"recovery_time_objective_minutes": 30', '"recovery_time_objective_minutes": 30.0') }),
  doc('recovery-a-team-operator', [['recovery.operator', '@org/oncall']], manual),
  doc('recovery-untested', [['recovery.runbook.last_tested', 'untested']], manual),
  doc('recovery-february-30', [['recovery.runbook.last_tested', '2026-02-30']], manual),
  doc('recovery-month-13', [['recovery.runbook.last_tested', '2026-13-01']], manual),
  doc('recovery-year-zero', [['recovery.runbook.last_tested', '0000-01-01']], manual),
  doc('recovery-1900-is-not-a-leap-year', [['recovery.runbook.last_tested', '1900-02-29']], manual),
  doc('recovery-the-future', [['recovery.runbook.last_tested', '2999-01-01']], manual),
  doc('recovery-runbook-outside', [['recovery.runbook.path', '../runbook.md']], manual),
  doc('patterns-trailing-newline', [['project', 'example-owner/example-app\n'], ['madr.path', 'docs/adr/0007.md\n'],
    ['mandatory_scenarios.critical_user_journeys.0.id', 'sign-in\n'], ['recovery.operator', '@example-operator\n'],
    ['recovery.runbook.last_tested', '2026-10-30\n']], manual),
  doc('patterns-project-not-owner-slash-name', [['project', 'example-app']]),
  doc('patterns-upper-case-id', [['mandatory_scenarios.risk_scenarios.0.id', 'Draft']]),
  doc('patterns-astral-description-length', [['mandatory_scenarios.risk_scenarios.0.description', '😀']]),
  doc('override-waive', [['baseline_override', { waive: ['docs'] }]]),
  doc('override-empty-criteria', [['baseline_override', { definition_of_done: { additional_criteria: [] } }]]),
  doc('override-blank-description', [['baseline_override', { documentation: { additional_docs: [{ path: 'README.md', description: ' ' }] } }]]),
  doc('override-a-path-outside', [['baseline_override.documentation.additional_docs.0.path', '/etc/x.md']], override),
  doc('override-an-item-missing-its-id', [['baseline_override.definition_of_done.additional_criteria.0.id', undefined]], override),
  doc('unknown-key-at-the-top', [['skip_gates', true]]),
  doc('unknown-keys-everywhere', [['skip_gates', true], ['madr.x', 1], ['coverage.x', 1], ['severity.x', 1],
    ['recovery.runbook.x', 1], ['mandatory_scenarios.risk_scenarios.0.x', 1], ['zz', 1], ['é', 1], ['😀', 1], ['\uFFFF', 1]], manual),
  doc('everything-wrong', [['project', 1], ['madr', []], ['coverage', null], ['mandatory_scenarios', 'x'], ['severity', 1.5],
    ['low_findings', true], ['risk_classification', {}], ['approval', { low_risk: 'never' }], ['recovery', { mode: 'manual', x: 1 }]]),
];

