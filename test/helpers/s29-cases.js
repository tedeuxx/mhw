// The S29 golden cases (#499, S29 of #470): what the deleted global/project-policy/delivery_gate.py answered,
// on synthetic projects, evidence and runbooks in throwaway directories, so the Node gates (`mhw
// delivery-gate`) are held to it after the deletion. Every value is synthetic.
//
// A case writes a project under {BASE}/project (FIXTURE, with the case's contract edit and files), and its
// other files under {BASE}; then runs `<gate> <args>`, {BASE} in an argument being the case's directory,
// which is also HOME and, unless the case names a `cwd` under it, the working directory. A file is `doc`
// (JSON, two-space indent), `text` (UTF-8, verbatim), `hex` (bytes), `dir` (a directory) or `link` (a
// symbolic link to that path under {BASE}, POSIX). `mode` makes a file unreadable (POSIX, and not as root).
// Each case's transcript is the exit code, stdout and stderr.
//
// FIXTURE and MADR are frozen copies of global/project-policy/reference/fixture/ at the recording, so a later
// edit to the fixture does not move these goldens; test/project-policy/delivery-gate.test.js reads the live one.

export const REV = 'a'.repeat(40);
export const OTHER = 'b'.repeat(40);
export const IMAGE = 'python@sha256:' + 'c'.repeat(64);

export const FIXTURE = Object.freeze({
  schema_version: 1,
  project: 'tedeuxx/mhw',
  madr: { path: 'docs/adr/0001-fixture-quality-bar.md', status: 'accepted' },
  coverage: { threshold_percent: 85, metric: 'line' },
  mandatory_scenarios: {
    critical_user_journeys: [{ id: 'greet-reader', description: 'The fixture app greets a reader by name.' }],
    security_controls: ['quality-scan', 'sast', 'owasp-vulnerability-coverage', 'authentication', 'authorization',
      'encryption-in-transit', 'encryption-at-rest'],
    risk_scenarios: [{ id: 'no-unescaped-name', description: 'The fixture app never echoes markup from a name unescaped.' }],
  },
  severity: { tolerated: ['low'], unclassified: 'block', inconclusive: 'block' },
  low_findings: { bug_issue_required: true, issue_label: 'bug' },
  risk_classification: {
    rules: [
      { class: 'high', when: 'The change touches how the fixture app escapes a name.' },
      { class: 'low', when: 'Every other change.' },
    ],
    unclassified: 'block',
  },
  approval: { low_risk: 'automatic-after-all-gates', high_risk: 'owner-exact-revision' },
  recovery: { mode: 'automatic-rollback' },
});
const MADR_PATH = 'docs/adr/0001-fixture-quality-bar.md';
const MADR = '# 0001 — Fixture quality bar and deployment-risk model\n\n- **Status:** accepted\n- **Date:** 2026-11-07\n';
const RUNBOOK_PATH = 'docs/recovery-runbook.md';
const TESTED = '2026-01-15';
const PLACEHOLDER = '- Tested: <YYYY-MM-DD>; recovered in <minutes> minutes; by <@handle>';

/** @param {any} v @returns {any} */
const clone = (v) => JSON.parse(JSON.stringify(v));

/**
 * @typedef {{ doc?: any, text?: string, hex?: string, dir?: true, link?: string, mode?: number }} File
 * @typedef {{ name: string, args: string[], contract?: any, files?: Record<string, File>, cwd?: string,
 *             posix?: boolean, notRoot?: boolean, host?: boolean }} Case
 */

/**
 * The fixture contract with each change applied.
 * @param {(doc: any) => void} change
 */
function contract(change) {
  const doc = clone(FIXTURE);
  change(doc);
  return doc;
}

/** @param {number} [rto] @param {string} [lastTested] */
const manual = (rto = 30, lastTested = TESTED) => contract((d) => {
  d.recovery = { mode: 'manual', recovery_time_objective_minutes: rto, runbook: { path: RUNBOOK_PATH, last_tested: lastTested },
    operator: '@operator-one' };
});

/** A runbook with these record lines. @param {...string} records */
const runbook = (...records) => '# Recovery runbook\n\n## Test log\n\n' + records.map((r) => r + '\n').join('');
/** @param {string} [date] @param {string} [minutes] */
const record = (date = TESTED, minutes = '20') => '- Tested: ' + date + '; recovered in ' + minutes + ' minutes; by @operator-one';

export function containerEvidence() {
  return {
    layer: 'container', revision: REV, container_image: IMAGE,
    test_layers: { unit: 'pass' },
    coverage: { metric: 'line', percent: 90 },
    critical_user_journeys: { 'greet-reader': 'pass' },
    risk_scenarios: { 'no-unescaped-name': 'pass' },
    security_controls: Object.fromEntries(FIXTURE.mandatory_scenarios.security_controls.map((n) => [n, 'pass'])),
    findings: [],
  };
}

export function installedEvidence() {
  return {
    layer: 'installed-stg', revision: REV, stg_deployed_revision: REV,
    test_layers: { 'end-to-end': 'pass' },
    critical_user_journeys: { 'greet-reader': 'pass' },
    risk_scenarios: { 'no-unescaped-name': 'pass' },
    security_controls: { authentication: 'pass' },
    findings: [],
  };
}

export function prodEvidence() {
  return {
    layer: 'prod', revision: REV, prod_deployed_revision: REV,
    critical_user_journeys: { 'greet-reader': 'pass' },
    risk_scenarios: { 'no-unescaped-name': 'pass' },
  };
}

/**
 * Evidence with a change applied.
 * @param {() => any} base @param {(doc: any) => void} change
 */
function ev(base, change) {
  const doc = base();
  change(doc);
  return doc;
}

const P = '--project={BASE}/project';
const E = '--evidence={BASE}/ev.json';
const R = '--revision=' + REV;
const H = '--checkout-head=' + REV;
const I = '--container-image=' + IMAGE;
const NC = '--no-container-check';
const CONTAINER = ['container', P, E, R, H, I, NC];
const INSTALLED = ['installed-stg', P, E, R, H];
const PROD = ['prod-validation', P, E, R, H];

/** @param {string} name @param {any} doc @param {Partial<Case>} [more] @returns {Case} */
const container = (name, doc, more = {}) => ({ name: 'container-' + name, args: CONTAINER, files: { 'ev.json': { doc } }, ...more });
/** @param {string} name @param {string} hex @returns {Case} */
const containerRaw = (name, hex) => ({ name: 'container-evidence-' + name, args: CONTAINER, files: { 'ev.json': { hex } } });
/** @param {string} name @param {any} doc @returns {Case} */
const installed = (name, doc) => ({ name: 'installed-' + name, args: INSTALLED, files: { 'ev.json': { doc } } });
/** @param {string} name @param {any} doc @returns {Case} */
const prod = (name, doc) => ({ name: 'prod-' + name, args: PROD, files: { 'ev.json': { doc } } });
/** @param {string} name @param {any} finding @param {any} [contractDoc] @returns {Case} */
const finding = (name, finding, contractDoc) => ({
  name: 'finding-' + name, args: CONTAINER, contract: contractDoc,
  files: { 'ev.json': { doc: ev(containerEvidence, (d) => { d.findings = [finding]; }) } },
});
/** @param {string} name @param {any} doc @returns {Case} */
const environment = (name, doc) => ({
  name: 'environment-' + name, args: ['environment', '--name=production-owner-approval', '--protection={BASE}/env.json'],
  files: { 'env.json': { doc } },
});
/** @param {string} name @param {string} prodRevision @param {Partial<Case>} [more] @returns {Case} */
const plan = (name, prodRevision, more = {}) => ({
  name: 'plan-' + name, args: ['recovery-plan', P, R, '--prod-revision=' + prodRevision], ...more,
});
/** @param {string} name @param {string} text @param {any} [contractDoc] @param {string} [prodRevision] @returns {Case} */
const manualPlan = (name, text, contractDoc = manual(), prodRevision = OTHER) => plan('manual-' + name, prodRevision, {
  contract: contractDoc, files: { ['project/' + RUNBOOK_PATH]: { text } },
});
/** @param {string} name @param {string} text @returns {Case} */
const madr = (name, text) => ({ name: 'contract-madr-' + name, args: ['contract', P], files: { ['project/' + MADR_PATH]: { text } } });
/** @param {string} name @param {string} rules @param {any} [contractDoc] @returns {Case} */
const classify = (name, rules, contractDoc) => ({ name: 'classify-' + name, args: ['classify', P, '--rules=' + rules], contract: contractDoc });

const DIGITS_4301 = '1'.repeat(4301);

/** @type {Case[]} */
export const CASES = [
  // -- the contract gate
  { name: 'contract-pass', args: ['contract', P, '--repository=tedeuxx/mhw'] },
  { name: 'contract-pass-without-repository', args: ['contract', P] },
  { name: 'contract-default-project', args: ['contract'], cwd: 'project' },
  { name: 'contract-relative-project', args: ['contract', '--project=project'] },
  { name: 'contract-trailing-separators', args: ['contract', '--project={BASE}/project//'] },
  { name: 'contract-another-repository', args: ['contract', P, '--repository=someone/else'] },
  { name: 'contract-invalid', args: ['contract', P], contract: contract((d) => { d.severity.tolerated = ['medium']; }) },
  { name: 'contract-several-findings', args: ['contract', P], contract: contract((d) => { d.coverage.threshold_percent = 5; d.madr.status = 'proposed'; }) },
  { name: 'contract-no-file', args: ['contract', '--project={BASE}'] },
  { name: 'contract-not-a-project', args: ['contract', '--project={BASE}/nowhere'] },
  { name: 'contract-repeated-key', args: ['contract', P], files: { 'project/project-policy.json': { text: '{"schema_version": 1, "schema_version": 1}\n' } } },
  { name: 'contract-not-json', args: ['contract', P], files: { 'project/project-policy.json': { text: '{"schema_version": 1,' } } },
  { name: 'contract-madr-missing', args: ['contract', P], contract: contract((d) => { d.madr.path = 'docs/adr/0002-absent.md'; }) },
  { name: 'contract-madr-other-case', args: ['contract', P], contract: contract((d) => { d.madr.path = 'docs/ADR/0001-fixture-quality-bar.md'; }) },
  { name: 'contract-madr-a-directory', args: ['contract', P], contract: contract((d) => { d.madr.path = 'docs/adr/dir.md'; }), files: { 'project/docs/adr/dir.md': { dir: true } } },
  { name: 'contract-madr-through-a-file', args: ['contract', P], contract: contract((d) => { d.madr.path = 'docs/adr/0001-fixture-quality-bar.md/x.md'; }) },
  { name: 'contract-madr-dot-segment', args: ['contract', P], contract: contract((d) => { d.madr.path = './docs/adr/0001-fixture-quality-bar.md'; }) },
  { name: 'contract-madr-double-slash', args: ['contract', P], contract: contract((d) => { d.madr.path = 'docs//adr/0001-fixture-quality-bar.md'; }) },
  { name: 'contract-madr-linked-outside', args: ['contract', P], posix: true, files: { 'elsewhere.md': { text: '- **Status:** accepted\n' }, ['project/' + MADR_PATH]: { link: 'elsewhere.md' } } },
  { name: 'contract-madr-linked-inside', args: ['contract', P], posix: true, files: { 'project/docs/real.md': { text: '- **Status:** accepted\n' }, ['project/' + MADR_PATH]: { link: 'project/docs/real.md' } } },
  { name: 'contract-madr-dangling-link', args: ['contract', P], posix: true, files: { ['project/' + MADR_PATH]: { link: 'absent.md' } } },
  { name: 'contract-madr-unreadable', args: ['contract', P], posix: true, notRoot: true, files: { ['project/' + MADR_PATH]: { text: MADR, mode: 0 } } },
  madr('proposed', '- **Status:** ~~accepted~~ proposed\n'),
  madr('accepted-with-a-period', '- **Status:** Accepted.\n'),
  madr('struck-proposed', '- **Status:** ~~proposed~~ **Accepted.**\n'),
  madr('plain', 'status: accepted\n'),
  madr('upper-case', 'STATUS : ACCEPTED\n'),
  madr('accepted-later', 'Status: accepted later\n'),
  madr('accepted-then-superseded', 'Status: accepted, then superseded\n'),
  madr('acceptedx', 'Status: acceptedx\n'),
  madr('empty-status', 'Status:\n'),
  madr('no-status', '# A record\n\nNothing here.\n'),
  madr('first-status-wins', 'Status: proposed\nStatus: accepted\n'),
  madr('crlf', '# A record\r\n\r\n- **Status:** accepted\r\n'),
  madr('cr-only', '# A record\r- **Status:** accepted\r'),
  madr('byte-order-mark', '﻿- **Status:** accepted\n'),
  madr('long-s', '- ſtatus: accepted\n'),
  madr('no-break-space', ' - Status: accepted \n'),
  madr('information-separator', '\u001f- Status: accepted\n'),
  madr('line-separator', 'Status: proposed Status: accepted\n'),
  madr('two-periods', 'Status: accepted..\n'),
  madr('dashes-then-space', '-- - Status: accepted\n'),
  madr('trailing-dash', 'Status: accepted -\n'),
  madr('open-strike', '~~Status: proposed\nStatus: accepted\n'),
  madr('unstruck-tail', '~~x~~ Status: ~~proposed~~ accepted ~~\n'),
  { name: 'contract-madr-not-utf-8', args: ['contract', P], files: { ['project/' + MADR_PATH]: { hex: '2d205374617475733a20ff0a' } } },
  { name: 'contract-manual-runbook-missing', args: ['contract', P], contract: manual() },
  { name: 'contract-manual-runbook-a-directory', args: ['contract', P], contract: manual(), files: { ['project/' + RUNBOOK_PATH]: { dir: true } } },
  { name: 'contract-manual-runbook-present', args: ['contract', P], contract: manual(), files: { ['project/' + RUNBOOK_PATH]: { text: '# runbook\n' } } },
  { name: 'contract-everything-wrong', args: ['contract', P, '--repository=someone/else'], contract: manual(30), files: { ['project/' + MADR_PATH]: { text: 'Status: proposed\n' } } },

  // -- the containerised evidence gate
  container('pass', containerEvidence()),
  container('pass-flag-twice', containerEvidence(), { args: [...CONTAINER, NC] }),
  { name: 'container-not-in-a-container', args: ['container', P, E, R, H, I], files: { 'ev.json': { doc: containerEvidence() } }, host: true },
  container('image-by-tag', ev(containerEvidence, (d) => { d.container_image = 'python:3.12'; }), { args: ['container', P, E, R, H, '--container-image=python:3.12', NC] }),
  container('image-digest-upper-case', containerEvidence(), { args: ['container', P, E, R, H, '--container-image=python@sha256:' + 'C'.repeat(64), NC] }),
  container('image-with-a-space', containerEvidence(), { args: ['container', P, E, R, H, '--container-image=py thon@sha256:' + 'c'.repeat(64), NC] }),
  container('evidence-of-another-image', ev(containerEvidence, (d) => { d.container_image = 'python@sha256:' + 'd'.repeat(64); })),
  container('evidence-without-image', ev(containerEvidence, (d) => { delete d.container_image; })),
  container('evidence-of-another-revision', ev(containerEvidence, (d) => { d.revision = OTHER; })),
  container('evidence-revision-a-number', ev(containerEvidence, (d) => { d.revision = 12; })),
  container('checkout-at-another-revision', containerEvidence(), { args: ['container', P, E, R, '--checkout-head=' + OTHER, I, NC] }),
  container('abbreviated-revision', containerEvidence(), { args: ['container', P, E, '--revision=' + REV.slice(0, 8), '--checkout-head=' + REV.slice(0, 8), I, NC] }),
  container('upper-case-revision', containerEvidence(), { args: ['container', P, E, '--revision=' + REV.toUpperCase(), H, I, NC] }),
  container('coverage-below', ev(containerEvidence, (d) => { d.coverage.percent = 84.9; })),
  container('coverage-at-the-threshold', ev(containerEvidence, (d) => { d.coverage.percent = 85; })),
  container('coverage-at-the-threshold-as-a-float', null, { files: { 'ev.json': { text: JSON.stringify(containerEvidence()).replace('"percent":90', '"percent":85.0') } } }),
  container('coverage-below-as-a-float', null, { files: { 'ev.json': { text: JSON.stringify(containerEvidence()).replace('"percent":90', '"percent":84.99999999999999') } } }),
  container('coverage-another-metric', ev(containerEvidence, (d) => { d.coverage.metric = 'branch'; })),
  container('coverage-metric-a-number', ev(containerEvidence, (d) => { d.coverage.metric = 1; })),
  container('coverage-over-100', ev(containerEvidence, (d) => { d.coverage.percent = 100.5; })),
  container('coverage-negative', ev(containerEvidence, (d) => { d.coverage.percent = -1; })),
  container('coverage-100', ev(containerEvidence, (d) => { d.coverage.percent = 100; })),
  container('coverage-zero-below', ev(containerEvidence, (d) => { d.coverage.percent = 0; })),
  container('coverage-true', ev(containerEvidence, (d) => { d.coverage.percent = true; })),
  container('coverage-a-string', ev(containerEvidence, (d) => { d.coverage.percent = '90'; })),
  container('coverage-null', ev(containerEvidence, (d) => { d.coverage.percent = null; })),
  container('coverage-a-huge-integer', containerEvidence(), { files: { 'ev.json': { text: JSON.stringify(containerEvidence()).replace('"percent":90', '"percent":' + '9'.repeat(30)) } } }),
  container('coverage-1e400', containerEvidence(), { files: { 'ev.json': { text: JSON.stringify(containerEvidence()).replace('"percent":90', '"percent":1e400') } } }),
  container('coverage-minus-1e400', containerEvidence(), { files: { 'ev.json': { text: JSON.stringify(containerEvidence()).replace('"percent":90', '"percent":-1e400') } } }),
  container('coverage-tiny', ev(containerEvidence, (d) => { d.coverage.percent = 1e-7; })),
  container('coverage-missing', ev(containerEvidence, (d) => { delete d.coverage; })),
  container('coverage-a-list', ev(containerEvidence, (d) => { d.coverage = [90]; })),
  container('coverage-an-extra-key', ev(containerEvidence, (d) => { d.coverage.branch = 80; })),
  container('coverage-without-metric', ev(containerEvidence, (d) => { delete d.coverage.metric; })),
  { name: 'container-threshold-a-float', args: CONTAINER, contract: contract((d) => { d.coverage.threshold_percent = 92.5; }), files: { 'ev.json': { doc: containerEvidence() } } },
  { name: 'container-threshold-as-written-90.0', args: CONTAINER, files: {
    'project/project-policy.json': { text: JSON.stringify(FIXTURE, null, 2).replace('"threshold_percent": 85', '"threshold_percent": 95.0') },
    'ev.json': { doc: containerEvidence() } } },
  container('journey-without-result', ev(containerEvidence, (d) => { d.critical_user_journeys = {}; })),
  container('journey-fail', ev(containerEvidence, (d) => { d.critical_user_journeys['greet-reader'] = 'fail'; })),
  container('journey-true', ev(containerEvidence, (d) => { d.critical_user_journeys['greet-reader'] = true; })),
  container('journey-null', ev(containerEvidence, (d) => { d.critical_user_journeys['greet-reader'] = null; })),
  container('journey-pass-upper-case', ev(containerEvidence, (d) => { d.critical_user_journeys['greet-reader'] = 'PASS'; })),
  container('journeys-a-list', ev(containerEvidence, (d) => { d.critical_user_journeys = ['greet-reader']; })),
  container('journeys-missing', ev(containerEvidence, (d) => { delete d.critical_user_journeys; })),
  container('scenario-inconclusive', ev(containerEvidence, (d) => { d.risk_scenarios['no-unescaped-name'] = 'inconclusive'; })),
  container('result-not-in-the-contract', ev(containerEvidence, (d) => { d.critical_user_journeys.invented = 'pass'; d.critical_user_journeys.another = 'fail'; })),
  container('control-missing', ev(containerEvidence, (d) => { delete d.security_controls.sast; })),
  container('control-fail', ev(containerEvidence, (d) => { d.security_controls.authorization = 'fail'; })),
  container('control-extra', ev(containerEvidence, (d) => { d.security_controls.dast = 'pass'; })),
  container('controls-missing', ev(containerEvidence, (d) => { delete d.security_controls; })),
  container('test-layer-fail', ev(containerEvidence, (d) => { d.test_layers.api = 'fail'; })),
  container('test-layer-inconclusive', ev(containerEvidence, (d) => { d.test_layers.api = 'inconclusive'; })),
  container('test-layers-empty', ev(containerEvidence, (d) => { d.test_layers = {}; })),
  container('test-layers-a-list', ev(containerEvidence, (d) => { d.test_layers = ['unit']; })),
  container('unknown-keys', ev(containerEvidence, (d) => { d.skipped = true; d.another = 1; })),
  container('wrong-layer', ev(containerEvidence, (d) => { d.layer = 'local'; })),
  container('layer-missing', ev(containerEvidence, (d) => { delete d.layer; })),
  container('non-ascii-ids', ev(containerEvidence, (d) => { d.critical_user_journeys['grüße'] = 'pass'; d.test_layers['é'] = 'fäil'; })),
  container('everything-wrong', { layer: 'stg', revision: OTHER, container_image: 'x', coverage: {}, findings: {}, extra: 1 },
    { args: ['container', P, E, R, '--checkout-head=' + OTHER, '--container-image=python:latest', NC] }),
  finding('low-with-an-issue-number', { id: 'x', severity: 'low', bug_issue: '#12' }),
  finding('low-with-an-issue-url', { id: 'x', severity: 'low', bug_issue: 'https://github.com/o/r/issues/3' }),
  finding('low-with-a-pull-url', { id: 'x', severity: 'low', bug_issue: 'https://github.com/o/r/pull/3' }),
  finding('low-without-an-issue', { id: 'x', severity: 'low' }),
  finding('low-issue-ends-in-a-newline', { id: 'x', severity: 'low', bug_issue: '#12\n' }),
  finding('low-issue-a-number', { id: 'x', severity: 'low', bug_issue: 12 }),
  finding('low-issue-hash-only', { id: 'x', severity: 'low', bug_issue: '#' }),
  finding('medium', { id: 'x', severity: 'medium', bug_issue: '#1' }),
  finding('critical', { id: 'x', severity: 'critical' }),
  finding('info', { id: 'x', severity: 'info' }),
  finding('upper-case-low', { id: 'x', severity: 'LOW' }),
  finding('severity-a-number', { id: 'x', severity: 1 }),
  finding('severity-a-list', { id: 'x', severity: ['low'] }),
  finding('unclassified', { id: 'x' }),
  finding('severity-null', { id: 'x', severity: null }),
  finding('unknown-keys', { id: 'x', severity: 'low', bug_issue: '#1', zeta: 1, alpha: 2 }),
  finding('low-when-nothing-is-tolerated', { id: 'x', severity: 'low', bug_issue: '#1' }, contract((d) => { d.severity.tolerated = []; })),
  { name: 'finding-not-an-object', args: CONTAINER, files: { 'ev.json': { doc: ev(containerEvidence, (d) => { d.findings = ['low', null, { severity: 'low', bug_issue: '#2' }]; }) } } },
  container('findings-missing', ev(containerEvidence, (d) => { delete d.findings; })),
  container('findings-an-object', ev(containerEvidence, (d) => { d.findings = {}; })),
  { name: 'container-evidence-missing', args: ['container', P, '--evidence={BASE}/none.json', R, H, I, NC] },
  { name: 'container-evidence-a-directory', args: ['container', P, '--evidence={BASE}/project', R, H, I, NC], posix: true },
  { name: 'container-evidence-unreadable', args: CONTAINER, posix: true, notRoot: true, files: { 'ev.json': { doc: containerEvidence(), mode: 0 } } },
  { name: 'container-evidence-through-a-file', args: ['container', P, '--evidence={BASE}/ev.json/x', R, H, I, NC], posix: true, files: { 'ev.json': { doc: containerEvidence() } } },
  { name: 'container-evidence-repeated-key', args: CONTAINER, files: { 'ev.json': { text: '{"layer": "container", "layer": "container"}' } } },
  { name: 'container-evidence-repeated-nested-key', args: CONTAINER, files: { 'ev.json': { text: '{"coverage": {"metric": "line", "metric": "line"}, "x": {"b": 1, "b": 2}}' } } },
  { name: 'container-evidence-nan', args: CONTAINER, files: { 'ev.json': { text: '{"coverage": {"metric": "line", "percent": NaN}}' } } },
  { name: 'container-evidence-infinity', args: CONTAINER, files: { 'ev.json': { text: '{"coverage": {"metric": "line", "percent": -Infinity}}' } } },
  { name: 'container-evidence-empty', args: CONTAINER, files: { 'ev.json': { text: '' } } },
  { name: 'container-evidence-truncated', args: CONTAINER, files: { 'ev.json': { text: '{"layer": "container",\n  "revision"' } } },
  { name: 'container-evidence-trailing-data', args: CONTAINER, files: { 'ev.json': { text: '{}\n{}\n' } } },
  { name: 'container-evidence-single-quotes', args: CONTAINER, files: { 'ev.json': { text: "{'layer': 'container'}" } } },
  { name: 'container-evidence-a-list', args: CONTAINER, files: { 'ev.json': { text: '[]' } } },
  { name: 'container-evidence-a-string', args: CONTAINER, files: { 'ev.json': { text: '"container"' } } },
  { name: 'container-evidence-byte-order-mark', args: CONTAINER, files: { 'ev.json': { text: '﻿{}' } } },
  { name: 'container-evidence-an-integer-past-4300-digits', args: CONTAINER, files: { 'ev.json': { text: '{"x": ' + DIGITS_4301 + '}' } } },
  containerRaw('invalid-start-byte', '7bff7d'),
  containerRaw('lone-continuation-byte', '7b227822803a20317d'),
  containerRaw('invalid-continuation-byte', '7b22e2287d'),
  containerRaw('invalid-third-byte', '7b22e282287d'),
  containerRaw('unexpected-end-of-data', '7b22e282'),
  containerRaw('unexpected-end-after-the-start-byte', '7b22f0'),
  containerRaw('encoded-surrogate', '7b22eda0807d'),
  containerRaw('overlong', '7b22c0af7d'),
  containerRaw('overlong-four-byte', '7b22f080'),
  containerRaw('past-u10ffff', '7b22f4908080'),
  containerRaw('fourth-byte-invalid', '7b22f09f9828'),
  containerRaw('latin-1', '7b226c61796572223a2022e9227d'),

  // -- the installed-STG evidence gate
  installed('pass', installedEvidence()),
  installed('another-revision', ev(installedEvidence, (d) => { d.stg_deployed_revision = OTHER; })),
  installed('revision-null', ev(installedEvidence, (d) => { d.stg_deployed_revision = null; })),
  installed('revision-missing', ev(installedEvidence, (d) => { delete d.stg_deployed_revision; })),
  installed('journey-fail', ev(installedEvidence, (d) => { d.critical_user_journeys['greet-reader'] = 'fail'; })),
  installed('no-security-validation', ev(installedEvidence, (d) => { d.security_controls = {}; })),
  installed('security-controls-a-list', ev(installedEvidence, (d) => { d.security_controls = ['authentication']; })),
  installed('control-not-in-the-contract', ev(installedEvidence, (d) => { d.security_controls.dast = 'pass'; d.security_controls.zap = 'fail'; })),
  installed('control-fail', ev(installedEvidence, (d) => { d.security_controls.authentication = 'inconclusive'; })),
  installed('every-control', ev(installedEvidence, (d) => { d.security_controls = containerEvidence().security_controls; })),
  installed('container-evidence', containerEvidence()),
  { name: 'installed-checkout-elsewhere', args: ['installed-stg', P, E, R, '--checkout-head=' + OTHER], files: { 'ev.json': { doc: installedEvidence() } } },
  { name: 'installed-usage-no-checkout-head', args: ['installed-stg', P, E, R], files: { 'ev.json': { doc: installedEvidence() } } },
  { name: 'installed-evidence-missing', args: ['installed-stg', P, '--evidence={BASE}/none.json', R, H] },

  // -- classify
  classify('low', '1'),
  classify('high', '0'),
  classify('high-wins', '1,0'),
  classify('repeated', '1,1'),
  classify('spaces', ' 1 , 0 '),
  classify('no-break-space', ' 1　'),
  classify('leading-zero', '01'),
  classify('empty', ''),
  classify('blank', ' , '),
  classify('trailing-comma', '1,'),
  classify('outside', '2'),
  classify('negative', '-1'),
  classify('a-word', 'x'),
  classify('one-outside', '1,9'),
  classify('arabic-digit', '١'),
  classify('huge', '9'.repeat(25)),
  classify('stricter-low-approval', '1', contract((d) => { d.approval.low_risk = 'owner-exact-revision'; })),
  classify('three-rules', '2', contract((d) => { d.risk_classification.rules.push({ class: 'high', when: 'A third rule.' }); })),
  { name: 'classify-usage-no-rules', args: ['classify', P] },
  { name: 'classify-usage-two-rules', args: ['classify', P, '--rules=1', '--rules=0'] },
  { name: 'classify-usage-bad-argument-first', args: ['classify', '--bogus=1'] },
  { name: 'classify-invalid-contract', args: ['classify', P, '--rules=1'], contract: contract((d) => { d.approval.high_risk = 'automatic-after-all-gates'; }) },

  // -- the environment the owner approves in
  environment('pass', { name: 'production-owner-approval', protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'o' } }] }] }),
  environment('missing', {}),
  environment('another-name', { name: 'production', protection_rules: [] }),
  environment('wait-timer-only', { name: 'production-owner-approval', protection_rules: [{ type: 'wait_timer', wait_timer: 5 }] }),
  environment('no-reviewers', { name: 'production-owner-approval', protection_rules: [{ type: 'required_reviewers', reviewers: [] }] }),
  environment('reviewers-a-string', { name: 'production-owner-approval', protection_rules: [{ type: 'required_reviewers', reviewers: 'o' }] }),
  environment('reviewers-zero', { name: 'production-owner-approval', protection_rules: [{ type: 'required_reviewers', reviewers: 0 }] }),
  environment('wait-timer-with-reviewers', { name: 'production-owner-approval', protection_rules: [{ type: 'wait_timer', reviewers: [{ id: 1 }] }] }),
  environment('reviewers-without-a-type', { name: 'production-owner-approval', protection_rules: [{ reviewers: [{ id: 1 }] }] }),
  environment('rules-not-a-list', { name: 'production-owner-approval', protection_rules: { type: 'required_reviewers', reviewers: ['o'] } }),
  environment('rule-not-an-object', { name: 'production-owner-approval', protection_rules: ['required_reviewers'] }),
  { name: 'environment-file-missing', args: ['environment', '--name=production-owner-approval', '--protection={BASE}/none.json'] },
  { name: 'environment-file-malformed', args: ['environment', '--name=production-owner-approval', '--protection={BASE}/env.json'], files: { 'env.json': { text: '{"name": ' } } },
  { name: 'environment-file-not-an-object', args: ['environment', '--name=x', '--protection={BASE}/env.json'], files: { 'env.json': { text: 'null' } } },
  { name: 'environment-usage-no-protection', args: ['environment', '--name=x'] },
  { name: 'environment-usage-a-project', args: ['environment', '--name=x', '--protection=y', P] },

  // -- recovery-plan, automatic rollback
  plan('previous-revision', OTHER),
  plan('first-deployment', 'none'),
  plan('unknown', 'unknown'),
  plan('none-upper-case', 'NONE'),
  plan('abbreviated', OTHER.slice(0, 12)),
  plan('upper-case', OTHER.toUpperCase()),
  plan('with-a-newline', OTHER + '\n', { posix: true }),
  plan('already-at-the-revision', REV),
  plan('empty', ''),
  plan('revision-abbreviated', 'none', { args: ['recovery-plan', P, '--revision=' + REV.slice(0, 7), '--prod-revision=none'] }),
  plan('usage-no-prod-revision', 'none', { args: ['recovery-plan', P, R] }),
  plan('usage-no-revision', 'none', { args: ['recovery-plan', P, '--prod-revision=none'] }),
  plan('broken-contract', OTHER, { contract: contract((d) => { d.recovery = { mode: 'manual' }; }) }),
  plan('contract-and-revision-both-bad', 'x', { args: ['recovery-plan', P, '--revision=x', '--prod-revision=x'], contract: contract((d) => { d.recovery = { mode: 'manual' }; }) }),
  // -- recovery-plan, manual recovery
  manualPlan('pass', runbook(record())),
  manualPlan('first-deployment', runbook(record()), manual(), 'none'),
  manualPlan('crlf', runbook(record()).replaceAll('\n', '\r\n')),
  manualPlan('star-bullet', runbook(record().replace('- Tested', '* Tested'))),
  manualPlan('no-bullet', runbook(record().replace('- Tested', 'Tested'))),
  manualPlan('one-minute', runbook(record(TESTED, '1').replace('1 minutes', '1 minute'))),
  manualPlan('untested-template', runbook(PLACEHOLDER)),
  manualPlan('another-date', runbook(record('2026-01-14'))),
  manualPlan('over-the-objective', runbook(record(TESTED, '31'))),
  manualPlan('at-the-objective', runbook(record(TESTED, '30'))),
  manualPlan('any-record-over', runbook(record(), '- Tested: ' + TESTED + '; recovered in 45 minutes; by @someone')),
  manualPlan('seven-digit-minutes', runbook(record(TESTED, '1234567'))),
  manualPlan('six-digit-minutes', runbook(record(TESTED, '123456')), manual(200000)),
  manualPlan('struck-records', runbook(
    '~~' + record('2026-01-14') + '~~',
    '~~- Tested: ' + TESTED + '; recovered in 5 minutes; by @someone~~',
  )),
  manualPlan('annotated-line', runbook('- Tested: ' + TESTED + '; recovered in 5 minutes; by @someone, more')),
  manualPlan('not-tested', runbook('Not Tested: ' + TESTED + '; recovered in 5 minutes; by @someone')),
  manualPlan('indented', runbook('  - Tested: ' + TESTED + '; recovered in 5 minutes; by @someone')),
  manualPlan('trailing-space', runbook('- Tested: ' + TESTED + '; recovered in 5 minutes; by @someone ')),
  manualPlan('trailing-strike', runbook('- Tested: ' + TESTED + '; recovered in 5 minutes; by @someone ~~old~~')),
  manualPlan('arabic-digit', runbook('- Tested: ' + TESTED + '; recovered in ٥ minutes; by @someone')),
  manualPlan('line-separator', runbook('# x ' + record())),
  manualPlan('byte-order-mark-first', '﻿' + record() + '\n'),
  manualPlan('with-a-bad-prod-revision', runbook(record()), manual(), 'x'),
  { name: 'plan-manual-bad-prod-revision-and-runbook', args: ['recovery-plan', P, R, '--prod-revision=x'], contract: manual() },
  { name: 'plan-manual-missing-runbook', args: ['recovery-plan', P, R, '--prod-revision=' + OTHER], contract: manual() },
  { name: 'plan-manual-runbook-a-directory', args: ['recovery-plan', P, R, '--prod-revision=' + OTHER], contract: manual(), files: { ['project/' + RUNBOOK_PATH]: { dir: true } } },
  { name: 'plan-manual-runbook-linked-outside', args: ['recovery-plan', P, R, '--prod-revision=' + OTHER], contract: manual(), posix: true,
    files: { 'elsewhere.md': { text: runbook(record()) }, ['project/' + RUNBOOK_PATH]: { link: 'elsewhere.md' } } },
  { name: 'plan-manual-runbook-not-utf-8', args: ['recovery-plan', P, R, '--prod-revision=' + OTHER], contract: manual(), files: { ['project/' + RUNBOOK_PATH]: { hex: 'fffe205465737465640a' } } },

  // -- prod-validation
  prod('pass', prodEvidence()),
  prod('journey-fail', ev(prodEvidence, (d) => { d.critical_user_journeys['greet-reader'] = 'fail'; })),
  prod('scenario-inconclusive', ev(prodEvidence, (d) => { d.risk_scenarios['no-unescaped-name'] = 'inconclusive'; })),
  prod('journey-missing', ev(prodEvidence, (d) => { d.critical_user_journeys = {}; })),
  prod('scenarios-missing', ev(prodEvidence, (d) => { delete d.risk_scenarios; })),
  prod('another-revision-deployed', ev(prodEvidence, (d) => { d.prod_deployed_revision = OTHER; })),
  prod('deployed-null', ev(prodEvidence, (d) => { d.prod_deployed_revision = null; })),
  prod('evidence-of-another-revision', ev(prodEvidence, (d) => { d.revision = OTHER; })),
  prod('wrong-layer-and-unknown-key', ev(prodEvidence, (d) => { d.layer = 'installed-stg'; d.extra = 1; d.findings = []; })),
  { name: 'prod-checkout-elsewhere', args: ['prod-validation', P, E, R, '--checkout-head=' + OTHER], files: { 'ev.json': { doc: prodEvidence() } } },
  { name: 'prod-evidence-empty', args: PROD, files: { 'ev.json': { text: '' } } },
  { name: 'prod-evidence-open-brace', args: PROD, files: { 'ev.json': { text: '{' } } },
  { name: 'prod-evidence-a-list', args: PROD, files: { 'ev.json': { text: '[]' } } },
  { name: 'prod-evidence-nan', args: PROD, files: { 'ev.json': { text: '{"layer": NaN}' } } },
  { name: 'prod-evidence-repeated-key', args: PROD, files: { 'ev.json': { text: '{"layer": "prod", "layer": "prod"}' } } },
  { name: 'prod-evidence-missing', args: ['prod-validation', P, '--evidence={BASE}/absent.json', R, H] },
  { name: 'prod-usage-no-checkout-head', args: ['prod-validation', P, E, R] },
  { name: 'prod-invalid-contract', args: PROD, contract: contract((d) => { d.severity.inconclusive = 'pass'; }), files: { 'ev.json': { doc: prodEvidence() } } },

  // -- the command line
  { name: 'usage-no-gate', args: [] },
  { name: 'usage-unknown-gate', args: ['nothing'] },
  { name: 'usage-gate-upper-case', args: ['CONTRACT', P] },
  { name: 'usage-unknown-argument', args: ['contract', '--bogus=1'] },
  { name: 'usage-positional', args: ['contract', 'project'] },
  { name: 'usage-empty-value', args: ['contract', '--project='] },
  { name: 'usage-repeated-argument', args: ['contract', P, P] },
  { name: 'usage-flag-on-another-gate', args: ['contract', P, NC] },
  { name: 'usage-the-old-require-container-flag', args: [...CONTAINER.slice(0, -1), '--require-container'] },
  { name: 'usage-flag-with-a-value', args: [...CONTAINER.slice(0, -1), '--no-container-check=1'] },
  { name: 'usage-container-without-evidence', args: ['container', P] },
  { name: 'usage-container-without-image', args: ['container', P, E, R, H] },
  { name: 'usage-value-with-an-equals-sign', args: ['contract', '--project={BASE}/project', '--repository=a=b'] },
];
