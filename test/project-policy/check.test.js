// `mhw policy check`, the fail-closed validator of the project-policy contract (ADR-0015 lock 3 of 5,
// Issue #245). The node:test form of the deleted global/project-policy/project_policy_check_test.py
// (#498, S28 of #470), case for case, with the regressions #523 added (the coverage floor of 85 through
// the command, a baseline override that tries to remove).
//
// One test per failure class: the three the Issue names (missing, malformed, unknown version) and the five
// #192 names (missing or invalid risk classification, missing mandatory evidence, medium-or-higher
// findings, unknown severity, inconclusive evidence), plus the validator's own refusal to answer when it
// cannot evaluate. Each asserts a non-zero exit AND the class in the reason, so a red cannot come from the
// wrong branch.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { check, checkMain, main, SCHEMA, KNOWN_PATTERNS } from '../../src/commands/project-policy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = path.join(ROOT, 'global', 'project-policy');
const EXAMPLE = path.join(HERE, 'project-policy.example.json');
const VALID = JSON.parse(fs.readFileSync(EXAMPLE, 'utf8'));
const TODAY = { year: 2026, month: 11, day: 7 };
const MHW = path.join(ROOT, 'bin', 'mhw.js');
/** Code-unit order, explicit. @param {string} a @param {string} b */
const byString = (a, b) => Number(a > b) - Number(a < b);

/** @type {string} */
let dir;
/** @type {string} */
let file;
beforeEach(() => {
  dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s28-check-')));
  file = path.join(dir, 'project-policy.json');
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

/** @param {any} v @returns {any} */
const clone = (v) => structuredClone(v);

/** @param {any} doc */
function manual(doc) {
  const out = clone(doc);
  out.recovery = {
    mode: 'manual',
    recovery_time_objective_minutes: 30,
    runbook: { path: 'docs/runbooks/rollback.md', last_tested: '2026-10-30' },
    operator: '@example-operator',
  };
  return out;
}

/** @param {any} doc @param {Array<string | number>} trail @param {any} value */
function put(doc, trail, value) {
  const out = clone(doc);
  let parent = out;
  for (const step of trail.slice(0, -1)) parent = parent[step];
  parent[trail[trail.length - 1]] = value;
  return out;
}

/** @param {any} doc @param {Array<string | number>} trail */
function drop(doc, trail) {
  const out = clone(doc);
  let parent = out;
  for (const step of trail.slice(0, -1)) parent = parent[step];
  delete parent[trail[trail.length - 1]];
  return out;
}

/**
 * Run a main with fd 1 and 2 captured: { code, out, err }.
 * @param {() => number} fn
 */
function captured(fn) {
  const orig = fs.writeSync;
  let out = '';
  let err = '';
  // @ts-ignore: the two descriptors the command writes, captured
  fs.writeSync = (fd, data) => {
    if (fd === 1) out += data;
    else if (fd === 2) err += data;
    else return orig(fd, /** @type {string} */ (data));
    return String(data).length;
  };
  try {
    return { code: fn(), out, err };
  } finally {
    fs.writeSync = orig;
  }
}

/** @param {string[]} argv */
const runMain = (argv) => captured(() => main(argv, {}, { today: TODAY }));

/** @param {string | Buffer} raw @param {{ today?: any, schema?: string }} [kw] */
function checkBytes(raw, kw = {}) {
  fs.writeFileSync(file, raw);
  return check(file, kw.schema || SCHEMA, kw.today || TODAY);
}

/** @param {any} doc @param {{ today?: any, schema?: string }} [kw] */
const checkDoc = (doc, kw) => checkBytes(JSON.stringify(doc), kw);

/** @param {{ code: number, lines: string[] }} result @param {string} reason @param {number} [code] */
function assertFails(result, reason, code = 1) {
  assert.equal(result.code, code, result.lines.join('\n'));
  assert.ok(result.lines.some((l) => l.includes(reason)), 'no ' + JSON.stringify(reason) + ' in ' + JSON.stringify(result.lines));
  assert.ok(!result.lines.some((l) => l.startsWith('OK')), result.lines.join('\n'));
}

// -- passes ---------------------------------------------------------------------------------------

test('the valid example passes through --project and --file', () => {
  fs.writeFileSync(file, JSON.stringify(VALID));
  let r = runMain(['check', '--project=' + dir]);
  assert.deepEqual([r.code, r.err], [0, '']);
  assert.ok(r.out.startsWith('OK  '), r.out);
  r = runMain(['check', '--file=' + EXAMPLE]);
  assert.equal(r.code, 0, r.err);
});

test('manual recovery with everything it needs passes', () => {
  assert.equal(checkDoc(manual(VALID)).code, 0);
  assert.equal(checkDoc(put(manual(VALID), ['recovery', 'runbook', 'last_tested'], '2026-11-08')).code, 0, 'one day of time-zone slack');
});

// -- the Issue's three classes --------------------------------------------------------------------

test('missing fails', () => {
  const r = runMain(['check', '--project=' + dir]);
  assert.equal(r.code, 1);
  assert.ok(r.err.includes('missing'), r.err);
  assertFails(check(dir, SCHEMA, TODAY), 'missing'); // a directory
});

test('a directory is missing on every OS, whatever reading it raises', () => {
  // Windows refuses to read a directory with EPERM rather than EISDIR (CPython: PermissionError, run
  // 42402521059); the directory is tested before the read, so the reason is "missing" there too.
  assertFails(check(dir, SCHEMA, TODAY), 'missing: ');
  assertFails(check(dir, SCHEMA, TODAY), 'is a directory, not a file');
});

test('a directory is missing even where reading one is refused as EPERM (Windows)', () => {
  // Simulated on every OS, as the original's suite did: a read that fails the way Windows fails it.
  const orig = fs.readFileSync;
  // @ts-ignore: the one read this test replaces
  fs.readFileSync = (p, ...rest) => {
    if (typeof p === 'string' && fs.statSync(p, { throwIfNoEntry: false })?.isDirectory()) {
      throw Object.assign(new Error('EPERM: operation not permitted'), { code: 'EPERM' });
    }
    return orig(p, ...rest);
  };
  try {
    assertFails(check(dir, SCHEMA, TODAY), 'missing: ' + dir + ' is a directory, not a file');
  } finally {
    fs.readFileSync = orig;
  }
});

test('true is not 1 and 1 is 1.0 when items are compared for repeats', () => {
  // The original's same(): JSON true is not the number 1; the numbers 1 and 1.0 are equal.
  const controls = VALID.mandatory_scenarios.security_controls;
  let r = checkDoc(put(VALID, ['mandatory_scenarios', 'security_controls'], [...controls, true, 1]));
  assert.equal(r.code, 1);
  assert.ok(!r.lines.some((l) => l.includes('uniqueItems')), r.lines.join('\n'));
  r = checkBytes(JSON.stringify(put(VALID, ['mandatory_scenarios', 'security_controls'], [...controls, 1])).replace(',1]', ',1,1.0]'));
  assert.ok(r.lines.includes('FAIL  $.mandatory_scenarios.security_controls: uniqueItems (missing mandatory evidence)'), r.lines.join('\n'));
});

test('malformed fails', () => {
  const text = JSON.stringify(VALID);
  for (const [name, raw] of /** @type {Array<[string, string | Buffer]>} */ ([
    ['not JSON', '{"schema_version": 1,'],
    ['empty', ''],
    ['not UTF-8', Buffer.from([0xff, 0xfe, 0x7b, 0x7d])],
    ['NaN', text.replace('"threshold_percent":85', '"threshold_percent":NaN')],
    ['Infinity', text.replace('"threshold_percent":85', '"threshold_percent":Infinity')],
    ['repeated key', text.replace('"approval":{', '"approval":{"high_risk":"automatic-after-all-gates",')],
  ])) {
    if (name === 'NaN' || name === 'Infinity' || name === 'repeated key') assert.notEqual(raw, text, name + ': the edit landed');
    assertFails(checkBytes(raw), 'malformed');
  }
  for (const value of [[VALID], 'x', 1, null]) assertFails(checkDoc(value), 'malformed');
});

test('unknown version fails, before the version-1 schema is applied', () => {
  for (const doc of [drop(VALID, ['schema_version']), put(VALID, ['schema_version'], 2), put(VALID, ['schema_version'], true),
    put(VALID, ['schema_version'], '1'), put(VALID, ['schema_version'], 1.5)]) {
    const result = checkDoc(doc);
    assertFails(result, 'unknown version');
    assert.equal(result.lines.length, 1, result.lines.join('\n'));
  }
});

// -- the classes #192 names -----------------------------------------------------------------------

test('missing or invalid risk classification fails', () => {
  for (const doc of [drop(VALID, ['risk_classification']),
    put(VALID, ['risk_classification', 'unclassified'], 'low'),
    put(VALID, ['risk_classification', 'rules'], []),
    put(VALID, ['risk_classification', 'rules'], [{ class: 'low', when: 'Always.' }]),
    put(VALID, ['risk_classification', 'rules'], [{ class: 'medium', when: 'x' }]),
    put(VALID, ['risk_classification', 'rules'], [{ class: 'high', when: '' }])]) {
    assertFails(checkDoc(doc), 'missing or invalid risk classification');
  }
});

test('missing mandatory evidence fails', () => {
  const controls = VALID.mandatory_scenarios.security_controls;
  for (const doc of [drop(VALID, ['mandatory_scenarios']),
    put(VALID, ['mandatory_scenarios', 'security_controls'], controls.filter((/** @type {string} */ c) => c !== 'sast')),
    put(VALID, ['mandatory_scenarios', 'critical_user_journeys'], []),
    put(VALID, ['mandatory_scenarios', 'risk_scenarios'], []),
    drop(VALID, ['coverage']),
    put(VALID, ['coverage', 'threshold_percent'], '85')]) {
    assertFails(checkDoc(doc), 'missing mandatory evidence');
  }
});

test('coverage below 85 fails through the command', () => {
  // Issue #523, the measured weakening: `check` printed OK for threshold_percent 5. It now exits 1 with its
  // own class, and 85 itself still passes, through main() as CI calls it.
  for (const threshold of [5, 0, 84.9]) {
    assertFails(checkDoc(put(VALID, ['coverage', 'threshold_percent'], threshold)),
      '$.coverage.threshold_percent: minimum (coverage below the mhw floor of 85 percent)');
  }
  fs.writeFileSync(file, JSON.stringify(put(VALID, ['coverage', 'threshold_percent'], 5)));
  const r = runMain(['check', '--project=' + dir]);
  assert.deepEqual([r.code, r.out], [1, ''], r.err);
  assert.ok(r.err.includes('coverage below the mhw floor of 85 percent'), r.err);
  assert.equal(checkDoc(put(VALID, ['coverage', 'threshold_percent'], 85)).code, 0);
});

test('a baseline override that tries to remove fails with its own reason', () => {
  const override = { definition_of_done: { additional_criteria: [{ id: 'a11y', description: 'Pages pass an accessibility audit.' }] } };
  assert.equal(checkDoc(put(VALID, ['baseline_override'], override)).code, 0);
  for (const bad of [{ waive: ['docs'] }, { definition_of_done: { additional_criteria: [] } },
    { documentation: { additional_docs: [{ path: 'README.md', description: ' ' }] } }]) {
    assertFails(checkDoc(put(VALID, ['baseline_override'], bad)), 'baseline override invalid (it may only add)');
  }
});

test('medium-or-higher findings fail', () => {
  for (const tolerated of [['medium'], ['high'], ['critical'], ['low', 'medium']]) {
    assertFails(checkDoc(put(VALID, ['severity', 'tolerated'], tolerated)), 'medium-or-higher findings tolerated');
  }
});

test('unknown severity fails', () => {
  for (const doc of [put(VALID, ['severity', 'tolerated'], ['moderate']), put(VALID, ['severity', 'tolerated'], ['LOW']),
    put(VALID, ['severity', 'unclassified'], 'tolerate'), drop(VALID, ['severity'])]) {
    assertFails(checkDoc(doc), 'unknown severity');
  }
});

test('inconclusive evidence that does not block fails', () => {
  for (const value of ['tolerate', 'pass', null]) {
    assertFails(checkDoc(put(VALID, ['severity', 'inconclusive'], value)), 'inconclusive evidence does not block');
  }
});

// -- the rest of the floor ------------------------------------------------------------------------

test('the rest of the floor fails with its own reason', () => {
  for (const [doc, reason] of [
    [put(VALID, ['approval', 'high_risk'], 'automatic-after-all-gates'), 'risk-based approval weakened'],
    [put(VALID, ['low_findings', 'bug_issue_required'], false), 'low finding without a bug Issue'],
    [put(VALID, ['madr', 'status'], 'proposed'), 'project MADR not ratified'],
    [drop(manual(VALID), ['recovery', 'operator']), 'recovery not prepared'],
    [put(VALID, ['skip_gates'], true), 'contract invalid'],
  ]) assertFails(checkDoc(doc), reason);
});

test('the invalid example fails', () => {
  const r = runMain(['check', '--file=' + path.join(HERE, 'project-policy.invalid.json')]);
  assert.equal(r.code, 1);
  for (const reason of ['medium-or-higher findings tolerated', 'missing mandatory evidence',
    'missing or invalid risk classification', 'recovery not prepared', 'coverage below the mhw floor of 85 percent']) {
    assert.ok(r.err.includes(reason), reason);
  }
});

test('last_tested must be a real past date', () => {
  for (const [value, keyword] of [['2026-02-30', 'date'], ['2026-13-01', 'date'], ['2026-11-09', 'future']]) {
    assertFails(checkDoc(put(manual(VALID), ['recovery', 'runbook', 'last_tested'], value)),
      'last_tested: ' + keyword + ' (recovery not prepared)');
  }
});

test('patterns are full matches through the command', () => {
  for (const [trail, value, base] of /** @type {Array<[string[], string, any]>} */ ([
    [['project'], 'example-owner/example-app\n', VALID],
    [['madr', 'path'], 'docs/adr/0007-quality-bar-and-deployment-risk.md\n', VALID],
    [['recovery', 'operator'], '@example-operator\n', manual(VALID)],
    [['recovery', 'runbook', 'last_tested'], '2026-10-30\n', manual(VALID)],
  ])) assertFails(checkDoc(put(base, trail, value)), ': pattern (');
});

test('a team is not an identified operator', () => {
  // ADR-0015 asks for an identified operator; @org/team names a group, so it stays refused.
  assertFails(checkDoc(put(manual(VALID), ['recovery', 'operator'], '@org/oncall')), '$.recovery.operator: pattern');
});

// -- cannot validate: refuse to answer, never pass ------------------------------------------------

test('an unusable schema is exit 2, not a pass', () => {
  const bad = path.join(dir, 'schema.json');
  fs.writeFileSync(bad, JSON.stringify({ type: 'object', oneOf: [] }));
  assertFails(checkDoc(VALID, { schema: bad }), 'cannot evaluate', 2);
  fs.writeFileSync(bad, JSON.stringify({ type: 'object', properties: { project: { pattern: 'e' } } }));
  assertFails(checkDoc(VALID, { schema: bad }), 'only patterns anchored', 2);
  fs.writeFileSync(bad, '{');
  assertFails(checkDoc(VALID, { schema: bad }), 'cannot read the contract schema', 2);
  assertFails(checkDoc(VALID, { schema: path.join(dir, 'absent.json') }), 'cannot read the contract schema', 2);
});

test('a broken schema is exit 2 with a reason, not a stack', () => {
  const bad = path.join(dir, 'schema.json');
  for (const [name, schema] of /** @type {Array<[string, any]>} */ ([
    ['unknown type', { type: 'null' }],
    ['type as a list', { type: ['object', 'null'] }],
    ['non-string pattern', { type: 'object', properties: { project: { pattern: 7 } } }],
    ['anchored but invalid regex', { type: 'object', properties: { project: { pattern: '^(a$' } } }],
    ['anchored, unknown regex', { type: 'object', properties: { project: { pattern: '^.*$' } } }],
    ['not an object', [1]],
  ])) {
    fs.writeFileSync(bad, JSON.stringify(schema));
    assertFails(checkDoc(VALID, { schema: bad }), 'cannot evaluate', 2);
    if (name.includes('regex')) assertFails(checkDoc(VALID, { schema: bad }), "not in the validator's known set", 2);
  }
});

test('a defect anywhere in the schema is exit 2, whatever the file reaches', () => {
  // QA B1 on #448: evaluate() refuses only where the document goes. The rows come from walking the shipped
  // schema, so every subschema location is covered, and the document is the automatic-rollback example,
  // which skips every manual-recovery branch.
  const shipped = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  /** @param {any} node @param {Array<string | number>} trail @returns {Array<Array<string | number>>} */
  const locations = (node, trail) => {
    const out = [trail];
    for (const [key, sub] of Object.entries(node.properties || {})) out.push(...locations(sub, [...trail, 'properties', key]));
    for (const key of ['items', 'contains', 'if', 'then']) if (key in node) out.push(...locations(node[key], [...trail, key]));
    (node.allOf || []).forEach((/** @type {any} */ sub, /** @type {number} */ i) => out.push(...locations(sub, [...trail, 'allOf', i])));
    return out;
  };
  const defects = [
    ['unknown keyword', 'dependentRequired', {}],
    ['type null', 'type', 'null'],
    ['type as a list', 'type', ['string', 'null']],
    ['unknown anchored pattern', 'pattern', '^(a+)+$'],
    ['additionalProperties not a boolean', 'additionalProperties', { type: 'string' }],
    ['keyword value of the wrong type', 'minLength', '1'],
  ];
  const rows = locations(shipped, []);
  assert.ok(rows.filter((r) => r.includes('recovery')).length > 4, 'the walk reaches recovery');
  const bad = path.join(dir, 'schema.json');
  assert.equal(checkDoc(VALID).code, 0, 'control: the shipped schema passes');
  for (const trail of rows) {
    for (const [name, key, value] of defects) {
      const schema = clone(shipped);
      let node = schema;
      for (const step of trail) node = node[step];
      node[/** @type {string} */ (key)] = value;
      fs.writeFileSync(bad, JSON.stringify(schema));
      // The reason names the walk's location, so a row passes only when the up-front walk refused it.
      const where = '$' + trail.map((s) => (typeof s === 'number' ? '[' + s + ']' : '.' + s)).join('');
      const r = checkDoc(VALID, { schema: bad });
      assert.equal(r.code, 2, where + ' ' + name);
      assert.ok(r.lines.some((l) => l.includes('SchemaError: ' + where + ': ')), where + ' ' + name + ': ' + r.lines.join('\n'));
    }
  }
});

test('the schema is parsed as strictly as the file', () => {
  // Lens finding on #448 at ae8f19c: a plain parse let these loosen coverage.maximum, and a file with
  // threshold_percent 1000 then exited 0. The control, the shipped schema, exits 1.
  const doc = put(VALID, ['coverage', 'threshold_percent'], 1000);
  assertFails(checkDoc(doc), '$.coverage.threshold_percent: maximum');
  const text = fs.readFileSync(SCHEMA, 'utf8');
  const needle = '"maximum": 100 }';
  assert.equal(text.split(needle).length - 1, 1, 'the schema still carries the bound this test edits');
  const bad = path.join(dir, 'schema.json');
  for (const [edited, reason] of [
    [text.replace(needle, '"maximum": NaN }'), 'NaN is not JSON'],
    [text.replace(needle, '"maximum": Infinity }'), 'Infinity is not JSON'],
    [text.replace(needle, '"maximum": 100, "maximum": 1e9 }'), 'repeated key "maximum"'],
  ]) {
    fs.writeFileSync(bad, edited);
    assertFails(checkDoc(doc, { schema: bad }), 'cannot read the contract schema', 2);
    assertFails(checkDoc(doc, { schema: bad }), reason, 2);
  }
});

test('then without if in an unvisited branch is exit 2', () => {
  const schema = JSON.parse(fs.readFileSync(SCHEMA, 'utf8'));
  schema.properties.recovery.properties.runbook.then = { required: ['path'] };
  const bad = path.join(dir, 'schema.json');
  fs.writeFileSync(bad, JSON.stringify(schema));
  assertFails(checkDoc(VALID, { schema: bad }), 'SchemaError: $.properties.recovery.properties.runbook: then without if', 2);
});

test('every schema pattern is in the known set, and each known form agrees with the schema text', () => {
  // The validator compiles no pattern from a file; the shipped schema must use only known ones.
  /** @param {any} node @returns {string[]} */
  const patterns = (node) => {
    if (Array.isArray(node)) return node.flatMap(patterns);
    if (node && typeof node === 'object') {
      return [...(typeof node.pattern === 'string' ? [node.pattern] : []), ...Object.values(node).flatMap(patterns)];
    }
    return [];
  };
  const used = new Set(patterns(JSON.parse(fs.readFileSync(SCHEMA, 'utf8'))));
  assert.deepEqual([...used].sort(byString), [...KNOWN_PATTERNS.keys()].sort(byString));
});

test('usage errors are exit 2', () => {
  for (const argv of [['check', '--project=a', '--file=b'], ['check', '--projects=a'], ['check', '--file=']]) {
    assert.equal(runMain(argv).code, 2, argv.join(' '));
  }
  assert.equal(runMain([]).code, 2);
  assert.equal(captured(() => checkMain(['x'])).code, 2);
});

test('the delivery gates Action\'s engine reaches the validator on every OS (#592)', () => {
  const ENGINE = path.join(ROOT, 'src', 'action', 'gates.js');
  let p = spawnSync(process.execPath, [ENGINE, 'policy', 'check', '--file=' + EXAMPLE], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.ok(p.stdout.startsWith('OK  '), p.stdout);
  p = spawnSync(process.execPath, [ENGINE, 'policy', 'check', '--project=' + dir], { encoding: 'utf8' });
  assert.equal(p.status, 1);
  assert.ok(p.stderr.includes('missing: no file at'), p.stderr);
  p = spawnSync(process.execPath, [ENGINE, 'policy'], { encoding: 'utf8' });
  assert.equal(p.status, 2);
});

test('mhw policy left the CLI (#592): bin/mhw.js answers it as an unknown subcommand', () => {
  for (const argv of [['policy'], ['policy', 'check', '--file=' + EXAMPLE]]) {
    const p = spawnSync(process.execPath, [MHW, ...argv], { encoding: 'utf8' });
    assert.equal(p.status, 2, argv.join(' '));
    assert.equal(p.stdout, '', argv.join(' '));
    assert.match(p.stderr, /^mhw: unknown (subcommand|argument for) policy/, argv.join(' '));
  }
});

test('workstation.py, which once forwarded policy, is gone (#495)', () => {
  assert.ok(!fs.existsSync(path.join(ROOT, 'global', 'workstation.py')));
});
