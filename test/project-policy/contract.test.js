// The project-policy contract (ADR-0015 lock 2 of 5, Issue #244): schema, examples and field docs. The
// node:test form of the deleted global/project-policy/project_policy_test.py (#498, S28 of #470), case for
// case, with the regressions #523 added (the coverage floor of 85, non-blank free text, the add-only
// baseline_override).
//
// This suite checks the contract's SHAPE. Its JSON Schema subset evaluator is the validator's own
// (src/commands/project-policy.js; its fail-closed command is tested in check.test.js), so the schema this
// suite passes is the schema `mhw policy check` applies. The evaluator refuses any schema keyword it does
// not implement, so the schema cannot grow a rule this suite silently ignores.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluate, strictLoads, SchemaError } from '../../src/commands/project-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = path.join(ROOT, 'global', 'project-policy');
const SCHEMA_TEXT = fs.readFileSync(path.join(HERE, 'project-policy.schema.json'), 'utf8');
const SCHEMA = JSON.parse(SCHEMA_TEXT);
const SCHEMA_MAP = strictLoads(SCHEMA_TEXT);
const VALID = JSON.parse(fs.readFileSync(path.join(HERE, 'project-policy.example.json'), 'utf8'));
const INVALID = JSON.parse(fs.readFileSync(path.join(HERE, 'project-policy.invalid.json'), 'utf8'));
const DOC = path.join(ROOT, 'docs', 'project-policy-contract.md');
/** Code-unit order, explicit. @param {string} a @param {string} b */
const byString = (a, b) => Number(a > b) - Number(a < b);

// The fields Issue #244 names, pinned here rather than read from the schema, so that dropping one from
// the schema's "required" list turns this suite red instead of quietly shrinking what it checks.
const ISSUE_FIELDS = [
  'schema_version', 'project', 'madr', 'coverage', 'mandatory_scenarios', 'severity', 'low_findings',
  'risk_classification', 'approval', 'recovery',
];

// Every required field at every depth, pinned for the same reason; "[]" stands for any array item and
// the last three recovery fields are required only when recovery.mode is "manual".
const REQUIRED_PATHS = [...ISSUE_FIELDS,
  'madr.path', 'madr.status',
  'coverage.threshold_percent', 'coverage.metric',
  'mandatory_scenarios.critical_user_journeys', 'mandatory_scenarios.security_controls',
  'mandatory_scenarios.risk_scenarios',
  'mandatory_scenarios.critical_user_journeys[].id',
  'mandatory_scenarios.critical_user_journeys[].description',
  'mandatory_scenarios.risk_scenarios[].id', 'mandatory_scenarios.risk_scenarios[].description',
  'severity.tolerated', 'severity.unclassified', 'severity.inconclusive',
  'low_findings.bug_issue_required', 'low_findings.issue_label',
  'risk_classification.rules', 'risk_classification.unclassified',
  'risk_classification.rules[].class', 'risk_classification.rules[].when',
  'approval.low_risk', 'approval.high_risk',
  'recovery.mode', 'recovery.recovery_time_objective_minutes', 'recovery.runbook', 'recovery.operator',
  'recovery.runbook.path', 'recovery.runbook.last_tested',
].sort(byString);

// Issue #523: the pattern that makes a free-text field carry a letter or digit. It accepts a trailing
// newline on purpose (prose may end in one), so it has its own test instead of a trailing-newline case.
const NONBLANK = '^[\\s\\S]*[A-Za-z0-9][\\s\\S]*$';

/** @param {any} v @returns {any} */
const clone = (v) => structuredClone(v);
/** The value as the validator reads it (integers stay integers). @param {any} v */
const asJson = (v) => strictLoads(JSON.stringify(v));
/** @param {any} doc */
const errors = (doc) => evaluate(asJson(doc), SCHEMA_MAP);
/** @param {string} haystack @param {string} needle */
const count = (haystack, needle) => haystack.split(needle).length - 1;

/** @param {any} doc */
function manualRecovery(doc) {
  const out = clone(doc);
  out.recovery = {
    mode: 'manual',
    recovery_time_objective_minutes: 30,
    runbook: { path: 'docs/runbooks/rollback.md', last_tested: '2026-10-30' },
    operator: '@example-operator',
  };
  return out;
}

/** doc with a full baseline_override section (Issue #523), every optional object present. @param {any} doc */
function withOverride(doc) {
  const out = clone(doc);
  out.baseline_override = {
    definition_of_done: { additional_criteria: [
      { id: 'accessibility-audit', description: 'Every new page passes an automated accessibility audit.' }] },
    documentation: { additional_docs: [
      { path: 'docs/runbooks/rollback.md', description: 'The rollback runbook is current.' }] },
  };
  return out;
}

/** @param {Array<string | number>} trail @param {any} value @param {any} [base] */
function mutate(trail, value, base = VALID) {
  const doc = clone(base);
  let parent = doc;
  for (const step of trail.slice(0, -1)) parent = parent[step];
  parent[trail[trail.length - 1]] = value;
  return doc;
}

/** @param {any} doc @param {string} where @param {string} [keyword] */
function assertRejects(doc, where, keyword) {
  const got = errors(doc);
  const hits = got.filter((e) => e[0] === where && (keyword === undefined || e[1] === keyword));
  assert.ok(hits.length, 'expected a failure at ' + where + ' (' + keyword + '); got ' + JSON.stringify(got));
}

/**
 * Every required key reachable in value, including one a satisfied if/then makes required.
 * @param {any} value @param {any} schema @param {Array<string | number>} [trail]
 * @returns {Array<Array<string | number>>}
 */
function requiredPaths(value, schema, trail = []) {
  /** @type {Array<Array<string | number>>} */
  const found = [];
  if (value && typeof value === 'object' && !Array.isArray(value) && schema.type === 'object') {
    const required = [...(schema.required || [])];
    if (schema.if && evaluate(asJson(value), asJson(schema.if)).length === 0) required.push(...((schema.then || {}).required || []));
    for (const key of required) if (Object.hasOwn(value, key)) found.push([...trail, key]);
    for (const [key, sub] of Object.entries(schema.properties || {})) {
      if (Object.hasOwn(value, key)) found.push(...requiredPaths(value[key], sub, [...trail, key]));
    }
  }
  if (Array.isArray(value) && schema.items) value.forEach((item, i) => found.push(...requiredPaths(item, schema.items, [...trail, i])));
  return found;
}

/** Every property name the schema declares, at any depth. @param {any} schema @returns {Set<string>} */
function propertyNames(schema) {
  const names = new Set();
  for (const [key, sub] of Object.entries(schema.properties || {})) {
    names.add(key);
    for (const n of propertyNames(sub)) names.add(n);
  }
  if (schema.items) for (const n of propertyNames(schema.items)) names.add(n);
  return names;
}

// -- the issue's acceptance criteria ----------------------------------------------------------------

test('the schema is versioned and requires every field the Issue names', () => {
  assert.deepEqual(SCHEMA.properties.schema_version, { type: 'integer', const: 1 });
  assert.deepEqual(SCHEMA.required, ISSUE_FIELDS);
  assert.equal(VALID.schema_version, 1);
  assert.equal(INVALID.schema_version, 1);
});

test('the valid example passes', () => assert.deepEqual(errors(VALID), []));

test('the valid example with manual recovery passes', () => assert.deepEqual(errors(manualRecovery(VALID)), []));

test('removing any required field fails', () => {
  const covered = new Set();
  for (const base of [VALID, manualRecovery(VALID)]) {
    const paths = requiredPaths(base, SCHEMA);
    for (const trail of paths) {
      covered.add(trail.map((p) => (typeof p === 'number' ? '[]' : p)).join('.').replaceAll('.[]', '[]'));
      const doc = clone(base);
      let parent = doc;
      for (const step of trail.slice(0, -1)) parent = parent[step];
      delete parent[trail[trail.length - 1]];
      assert.notDeepEqual(errors(doc), [], trail.join('.') + ' (' + base.recovery.mode + ')');
    }
  }
  assert.deepEqual([...covered].sort(byString), REQUIRED_PATHS);
});

test('every top-level field removed fails at that field', () => {
  for (const field of ISSUE_FIELDS) {
    const doc = clone(VALID);
    delete doc[field];
    assertRejects(doc, '$.' + field, 'required');
  }
});

test('the invalid example fails for each floor it weakens', () => {
  const got = errors(INVALID).map((e) => e.join(' '));
  for (const [where, keyword] of [
    ['$.madr.status', 'const'],
    ['$.mandatory_scenarios.security_controls', 'contains'],
    ['$.severity.tolerated', 'maxItems'],
    ['$.severity.tolerated[1]', 'const'],
    ['$.low_findings.bug_issue_required', 'const'],
    ['$.approval.high_risk', 'const'],
    ['$.risk_classification.rules', 'contains'],
    ['$.recovery.runbook', 'required'],
    ['$.recovery.operator', 'required'],
    ['$.coverage.threshold_percent', 'minimum'],
  ]) assert.ok(got.includes(where + ' ' + keyword), where);
});

// -- the common floor, which a project file cannot weaken -------------------------------------------

test('only low findings are tolerated', () => {
  for (const tolerated of [['medium'], ['low', 'medium'], ['high'], ['critical']]) {
    assert.notDeepEqual(errors(mutate(['severity', 'tolerated'], tolerated)), [], JSON.stringify(tolerated));
  }
  assert.deepEqual(errors(mutate(['severity', 'tolerated'], [])), [], 'stricter is allowed');
});

test('unclassified and inconclusive findings block', () => {
  for (const key of ['unclassified', 'inconclusive']) assertRejects(mutate(['severity', key], 'tolerate'), '$.severity.' + key, 'const');
});

test('low findings always need a bug Issue', () => {
  assertRejects(mutate(['low_findings', 'bug_issue_required'], false), '$.low_findings.bug_issue_required', 'const');
  assertRejects(mutate(['low_findings', 'bug_issue_required'], 1), '$.low_findings.bug_issue_required', 'type');
  assertRejects(mutate(['low_findings', 'issue_label'], ''), '$.low_findings.issue_label', 'minLength');
});

test('high risk needs the owner for the exact revision', () => {
  assertRejects(mutate(['approval', 'high_risk'], 'automatic-after-all-gates'), '$.approval.high_risk', 'const');
  assert.deepEqual(errors(mutate(['approval', 'low_risk'], 'owner-exact-revision')), [], 'owner approval for low risk is stricter');
});

test('an unclassified change blocks', () => {
  assertRejects(mutate(['risk_classification', 'unclassified'], 'low'), '$.risk_classification.unclassified', 'const');
  assertRejects(mutate(['risk_classification', 'rules'], []), '$.risk_classification.rules', 'minItems');
  assertRejects(mutate(['risk_classification', 'rules'], [{ class: 'medium', when: 'x' }]), '$.risk_classification.rules[0].class', 'enum');
});

test('the risk model names at least one high-risk rule', () => {
  // An all-low model would make approval.high_risk a constant that gates nothing.
  const allLow = [{ class: 'low', when: 'Every change.' }, { class: 'low', when: 'Docs only.' }];
  assertRejects(mutate(['risk_classification', 'rules'], allLow), '$.risk_classification.rules', 'contains');
  assert.deepEqual(errors(mutate(['risk_classification', 'rules'], [{ class: 'high', when: 'Every change.' }])), [],
    'an all-high model is stricter and allowed');
});

test('patterns refuse a trailing newline', () => {
  // One negative case per pattern in the schema. ECMA-262 $ does not match before a final newline.
  const manual = manualRecovery(VALID);
  /** @type {Array<[Array<string | number>, string, any, string]>} */
  const cases = [
    [['project'], 'example-owner/example-app\n', VALID, '$.project'],
    [['madr', 'path'], 'docs/adr/0007-quality-bar-and-deployment-risk.md\n', VALID, '$.madr.path'],
    [['mandatory_scenarios', 'critical_user_journeys', 0, 'id'], 'sign-in\n', VALID,
      '$.mandatory_scenarios.critical_user_journeys[0].id'],
    [['mandatory_scenarios', 'risk_scenarios', 0, 'id'], 'unpublished-draft-exposed\n', VALID,
      '$.mandatory_scenarios.risk_scenarios[0].id'],
    [['recovery', 'runbook', 'path'], 'docs/runbooks/rollback.md\n', manual, '$.recovery.runbook.path'],
    [['recovery', 'runbook', 'last_tested'], '2026-10-30\n', manual, '$.recovery.runbook.last_tested'],
    [['recovery', 'operator'], '@example-operator\n', manual, '$.recovery.operator'],
    [['baseline_override', 'definition_of_done', 'additional_criteria', 0, 'id'], 'accessibility-audit\n',
      withOverride(VALID), '$.baseline_override.definition_of_done.additional_criteria[0].id'],
    [['baseline_override', 'documentation', 'additional_docs', 0, 'path'], 'docs/runbooks/rollback.md\n',
      withOverride(VALID), '$.baseline_override.documentation.additional_docs[0].path'],
  ];
  const text = JSON.stringify(SCHEMA);
  assert.equal(cases.length, count(text, '"pattern"') - count(text, JSON.stringify(NONBLANK)), 'one case per pattern other than the non-blank one');
  for (const [trail, value, base, where] of cases) assertRejects(mutate(trail, value, base), where, 'pattern');
});

test('the minimum security evidence is present', () => {
  const floor = ['quality-scan', 'sast', 'owasp-vulnerability-coverage', 'authentication', 'authorization',
    'encryption-in-transit', 'encryption-at-rest'];
  for (const control of floor) {
    const kept = VALID.mandatory_scenarios.security_controls.filter((/** @type {string} */ c) => c !== control);
    assertRejects(mutate(['mandatory_scenarios', 'security_controls'], kept), '$.mandatory_scenarios.security_controls', 'contains');
  }
  assertRejects(mutate(['mandatory_scenarios', 'security_controls'], [...floor, 'made-up']), '$.mandatory_scenarios.security_controls[7]', 'enum');
});

test('both coverage dimensions are required', () => {
  for (const key of ['critical_user_journeys', 'risk_scenarios']) {
    assertRejects(mutate(['mandatory_scenarios', key], []), '$.mandatory_scenarios.' + key, 'minItems');
  }
  for (const threshold of [0, -1, 101]) assert.notDeepEqual(errors(mutate(['coverage', 'threshold_percent'], threshold)), []);
});

test('coverage cannot go below the mhw floor of 85', () => {
  // Issue #523, measured on 2026-11-20: the schema accepted threshold_percent 5 while the DoD asks for at
  // least 85. A project may tighten the number, never lower it.
  for (const threshold of [5, 50, 84, 84.99]) {
    assertRejects(mutate(['coverage', 'threshold_percent'], threshold), '$.coverage.threshold_percent', 'minimum');
  }
  for (const threshold of [85, 85.5, 90, 100]) {
    assert.deepEqual(errors(mutate(['coverage', 'threshold_percent'], threshold)), [], '85 or more is the floor or stricter');
  }
  assert.equal(SCHEMA.properties.coverage.properties.threshold_percent.minimum, 85);
});

test('free text must carry a letter or digit', () => {
  // Issue #523: minLength 1 let a blank "when" on the one required high-risk rule through, which makes the
  // high-risk approval apply to nothing, and a blank label that finds no bug Issue.
  const override = withOverride(VALID);
  /** @type {Array<[Array<string | number>, any, string]>} */
  const cases = [
    [['mandatory_scenarios', 'critical_user_journeys', 0, 'description'], VALID, '$.mandatory_scenarios.critical_user_journeys[0].description'],
    [['mandatory_scenarios', 'risk_scenarios', 0, 'description'], VALID, '$.mandatory_scenarios.risk_scenarios[0].description'],
    [['low_findings', 'issue_label'], VALID, '$.low_findings.issue_label'],
    [['risk_classification', 'rules', 0, 'when'], VALID, '$.risk_classification.rules[0].when'],
    [['baseline_override', 'definition_of_done', 'additional_criteria', 0, 'description'], override,
      '$.baseline_override.definition_of_done.additional_criteria[0].description'],
    [['baseline_override', 'documentation', 'additional_docs', 0, 'description'], override,
      '$.baseline_override.documentation.additional_docs[0].description'],
  ];
  assert.equal(cases.length, count(JSON.stringify(SCHEMA), JSON.stringify(NONBLANK)), 'one case per use');
  for (const [trail, base, where] of cases) {
    for (const blank of [' ', '\t\n', '- . -']) assertRejects(mutate(trail, blank, base), where, 'pattern');
    assert.deepEqual(errors(mutate(trail, 'Ends in a newline.\n', base)), [], where);
  }
});

// -- the baseline override (Issue #523): optional, and it may only add ------------------------------

test('the baseline override is optional and valid when full', () => {
  assert.ok(!SCHEMA.required.includes('baseline_override'));
  assert.deepEqual(errors(withOverride(VALID)), []);
  assert.deepEqual(errors(mutate(['baseline_override'], {})), []);
});

test('the baseline override carries no key that lowers or waives', () => {
  const override = SCHEMA.properties.baseline_override;
  assert.deepEqual([...propertyNames(override)].sort(byString), ['additional_criteria', 'additional_docs', 'definition_of_done',
    'description', 'documentation', 'id', 'path']);
  for (const [trail, key] of /** @type {Array<[string[], string]>} */ ([[[], 'waive'], [[], 'coverage_threshold_percent'],
    [['definition_of_done'], 'skip'], [['documentation'], 'not_applicable']])) {
    const doc = withOverride(VALID);
    let parent = doc.baseline_override;
    for (const step of trail) parent = parent[step];
    parent[key] = true;
    assertRejects(doc, '$.baseline_override' + trail.map((t) => '.' + t).join('') + '.' + key, 'additionalProperties');
  }
});

test('the baseline override lists are not empty and fully described', () => {
  for (const [section, key] of [['definition_of_done', 'additional_criteria'], ['documentation', 'additional_docs']]) {
    let doc = withOverride(VALID);
    doc.baseline_override[section][key] = [];
    assertRejects(doc, '$.baseline_override.' + section + '.' + key, 'minItems');
    doc = withOverride(VALID);
    delete doc.baseline_override[section][key];
    assertRejects(doc, '$.baseline_override.' + section + '.' + key, 'required');
    for (const field of Object.keys(withOverride(VALID).baseline_override[section][key][0])) {
      doc = withOverride(VALID);
      delete doc.baseline_override[section][key][0][field];
      assertRejects(doc, '$.baseline_override.' + section + '.' + key + '[0].' + field, 'required');
    }
  }
  for (const p of ['/etc/x.md', '../x.md', 'docs/x.txt']) {
    const doc = withOverride(VALID);
    doc.baseline_override.documentation.additional_docs[0].path = p;
    assertRejects(doc, '$.baseline_override.documentation.additional_docs[0].path', 'pattern');
  }
});

test('the MADR must be ratified and inside the repository', () => {
  assertRejects(mutate(['madr', 'status'], 'proposed'), '$.madr.status', 'const');
  for (const p of ['/etc/adr.md', '../other/adr.md', 'docs/../../adr.md', 'docs/adr/0007.txt']) {
    assertRejects(mutate(['madr', 'path'], p), '$.madr.path', 'pattern');
  }
});

test('manual recovery needs an RTO, a tested runbook and an operator', () => {
  const manual = manualRecovery(VALID);
  for (const key of ['recovery_time_objective_minutes', 'runbook', 'operator']) {
    const doc = clone(manual);
    delete doc.recovery[key];
    assertRejects(doc, '$.recovery.' + key, 'required');
  }
  assertRejects(mutate(['recovery', 'runbook', 'last_tested'], 'untested', manual), '$.recovery.runbook.last_tested', 'pattern');
  assertRejects(mutate(['recovery', 'mode'], 'none'), '$.recovery.mode', 'enum');
});

test('unknown versions and fields fail', () => {
  assertRejects(mutate(['schema_version'], 2), '$.schema_version', 'const');
  assertRejects(mutate(['schema_version'], true), '$.schema_version', 'type');
  assertRejects(mutate(['skip_gates'], true), '$.skip_gates', 'additionalProperties');
});

test('every object rejects an unknown key', () => {
  // QA advisory A1 on #447: dropping additionalProperties false from one nested object left the suite
  // green. Each object is pinned here, not read from the schema, so dropping it turns red.
  const manual = manualRecovery(VALID);
  /** @type {Array<Array<string | number>>} */
  const objects = [
    [], ['madr'], ['coverage'], ['mandatory_scenarios'],
    ['mandatory_scenarios', 'critical_user_journeys', 0], ['mandatory_scenarios', 'risk_scenarios', 0],
    ['severity'], ['low_findings'], ['risk_classification'], ['risk_classification', 'rules', 0],
    ['approval'], ['recovery'], ['recovery', 'runbook'],
    ['baseline_override'], ['baseline_override', 'definition_of_done'],
    ['baseline_override', 'definition_of_done', 'additional_criteria', 0],
    ['baseline_override', 'documentation'], ['baseline_override', 'documentation', 'additional_docs', 0],
  ];
  assert.equal(objects.length, count(SCHEMA_TEXT, '"additionalProperties": false'), 'one case per object that declares it');
  for (const trail of objects) {
    const where = '$' + trail.map((s) => (typeof s === 'number' ? '[' + s + ']' : '.' + s)).join('');
    const doc = withOverride(manual);
    let parent = doc;
    for (const step of trail) parent = parent[step];
    parent.skip_gates = true;
    assertRejects(doc, where + '.skip_gates', 'additionalProperties');
  }
});

// -- calibration of the evaluator itself, and the field reference -----------------------------------

test('the evaluator refuses keywords it does not implement', () => {
  assert.throws(() => evaluate(asJson({}), asJson({ type: 'object', oneOf: [] })), SchemaError);
});

test('every schema field is described in the docs page', () => {
  const text = fs.readFileSync(DOC, 'utf8');
  for (const name of [...propertyNames(SCHEMA)].sort(byString)) assert.ok(text.includes('`' + name + '`'), name);
  for (const p of ['global/project-policy/project-policy.schema.json', 'global/project-policy/project-policy.example.json',
    'global/project-policy/project-policy.invalid.json']) assert.ok(text.includes(p), p);
});
