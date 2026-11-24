// The reference CI/CD's evidence gates and the recovery reference (ADR-0015 locks 4 and 5 of 5, Issues
// #246 and #247), in Node since #499 (S29 of #470): the cases of the deleted delivery_gate_test.py and
// recovery_test.py, as node:test.
//
// A benign pass for each gate, then one test per blocking class: exact-revision binding, the container,
// coverage, each mandatory scenario, each severity rule, the installed STG, risk classification, the
// owner-approval environment, both recovery paths and PROD validation. Each blocking test asserts the
// block AND its reason, so a red cannot come from the wrong branch. Then the validator's own answer, held
// to its three exits (each exit-2 branch has its own test), and the workflows themselves: every action
// pinned by SHA, no job that names an environment in the reusable gate or the dry run, least privilege per
// job, no Python step, and the caller template's recovery jobs. Every run is in a throwaway directory.
import { test, describe, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as gate from '../../src/commands/delivery-gate.js';
import { pyStrip } from '../../src/lib/py.js';
import { splitLines, utf8ErrorText } from '../../src/lib/py-text.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HERE = path.join(ROOT, 'global', 'project-policy');
const FIXTURE = path.join(HERE, 'reference', 'fixture');
const RUNBOOK_TEMPLATE = path.join(HERE, 'reference', 'runbook-template.md');
const GATE_WORKFLOW = path.join(ROOT, '.github', 'workflows', 'reference-delivery-gate.yml');
const DRY_RUN = path.join(ROOT, '.github', 'workflows', 'reference-delivery-dry-run.yml');
const TEMPLATE = path.join(HERE, 'reference', 'caller-workflow.yml');
const WORKFLOWS = [GATE_WORKFLOW, DRY_RUN];
const REV = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const IMAGE = 'python@sha256:' + 'c'.repeat(64);
const TESTED = '2026-01-15';
const RUNBOOK = 'docs/recovery-runbook.md';
const POSIX = process.platform !== 'win32';
/** Code-unit order, explicit. @param {string} a @param {string} b */
const byString = (a, b) => Number(a > b) - Number(a < b);

const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** A file's text with LF line ends: a Windows checkout writes CRLF. @param {string} p */
const text = (p) => fs.readFileSync(p, 'utf8').replaceAll('\r\n', '\n');

function containerEvidence() {
  return {
    layer: 'container', revision: REV, container_image: IMAGE,
    test_layers: { unit: 'pass' },
    coverage: { metric: 'line', percent: 90 },
    critical_user_journeys: { 'greet-reader': 'pass' },
    risk_scenarios: { 'no-unescaped-name': 'pass' },
    security_controls: Object.fromEntries(['quality-scan', 'sast', 'owasp-vulnerability-coverage', 'authentication',
      'authorization', 'encryption-in-transit', 'encryption-at-rest'].map((n) => [n, 'pass'])),
    findings: /** @type {any[]} */ ([]),
  };
}

function installedEvidence() {
  return {
    layer: 'installed-stg', revision: REV, stg_deployed_revision: /** @type {any} */ (REV),
    test_layers: { 'end-to-end': 'pass' },
    critical_user_journeys: { 'greet-reader': 'pass' },
    risk_scenarios: { 'no-unescaped-name': 'pass' },
    security_controls: /** @type {Record<string, string>} */ ({ authentication: 'pass' }),
    findings: [],
  };
}

function prodEvidence() {
  return {
    layer: 'prod', revision: REV, prod_deployed_revision: /** @type {any} */ (REV),
    critical_user_journeys: /** @type {Record<string, string>} */ ({ 'greet-reader': 'pass' }),
    risk_scenarios: { 'no-unescaped-name': 'pass' },
  };
}

/** The fixture copied into a throwaway directory, and helpers on it. */
function workspace() {
  const tmp = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s29-unit-')));
  cleanups.push(() => fs.rmSync(tmp, { recursive: true, force: true }));
  const project = path.join(tmp, 'project');
  fs.cpSync(FIXTURE, project, { recursive: true });
  const dockerenv = path.join(tmp, 'dockerenv');
  fs.writeFileSync(dockerenv, '');
  const w = {
    tmp, project, dockerenv,
    /** @param {(doc: any) => void} change */
    contract(change) {
      const p = path.join(project, 'project-policy.json');
      const doc = JSON.parse(fs.readFileSync(p, 'utf8'));
      change(doc);
      fs.writeFileSync(p, JSON.stringify(doc));
    },
    /** @param {string} name @param {any} doc */
    write(name, doc) {
      const p = path.join(tmp, name);
      fs.writeFileSync(p, typeof doc === 'string' ? doc : JSON.stringify(doc));
      return p;
    },
    /** @param {any} evidence @param {{ revision?: string, head?: string, image?: string, inContainer?: boolean }} [o] */
    container(evidence, o = {}) {
      return gate.gateContainer(project, w.write('ev.json', evidence), o.revision ?? REV, o.head ?? REV, o.image ?? IMAGE, true,
        { dockerenv: o.inContainer === false ? path.join(tmp, 'absent') : dockerenv });
    },
    /** @param {any} evidence @param {string} [revision] @param {string} [head] */
    installed(evidence, revision = REV, head = REV) {
      return gate.gateInstalled(project, w.write('stg.json', evidence), revision, head);
    },
    /** @param {number} [rto] @param {string | null} [runbook] @param {string} [rel] */
    manual(rto = 30, runbook = null, rel = RUNBOOK) {
      w.contract((d) => {
        d.recovery = { mode: 'manual', recovery_time_objective_minutes: rto, runbook: { path: rel, last_tested: TESTED }, operator: '@operator-one' };
      });
      if (runbook !== null) {
        fs.mkdirSync(path.join(project, 'docs'), { recursive: true });
        fs.writeFileSync(path.join(project, ...RUNBOOK.split('/')), runbook);
      }
    },
    /** @param {string} [prod] @param {string} [revision] @param {gate.Opts} [opts] */
    plan(prod = OTHER, revision = REV, opts = {}) {
      return gate.recoveryPlan(project, revision, prod, opts);
    },
    /** @param {any} evidence @param {string} [revision] @param {string} [head] */
    validate(evidence, revision = REV, head = REV) {
      return gate.gateProdValidation(project, w.write('prod.json', evidence), revision, head);
    },
  };
  return w;
}

/** @param {string[]} blocks @param {string} fragment */
function assertBlocks(blocks, fragment) {
  assert.ok(blocks.length, 'expected a block containing ' + JSON.stringify(fragment) + ', got a pass');
  assert.ok(blocks.some((b) => b.includes(fragment)), JSON.stringify(fragment) + ' not in ' + JSON.stringify(blocks));
}

/** The gate, as the delivery gates Action runs it (#592). @param {string[]} args @param {Record<string, string>} [env] */
function cli(args, env = { PATH: process.env.PATH || '' }) {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'src', 'action', 'gates.js'), 'delivery-gate', ...args], { encoding: 'utf8', env, timeout: 60000 });
  return { code: p.status, out: p.stdout, err: p.stderr };
}

/** A runbook from the template, filled. */
function filledRunbook(date = TESTED, minutes = '20', handle = '@operator-one') {
  return text(RUNBOOK_TEMPLATE).replace('<YYYY-MM-DD>', date).replace('<minutes> minutes;', minutes + ' minutes;').replace('by <@handle>', 'by ' + handle);
}

/** @type {ReturnType<typeof workspace>} */
let w;
beforeEach(() => { w = workspace(); });

describe('contract', () => {
  test('the fixture passes', () => assert.deepEqual(gate.gateContract(w.project, 'tedeuxx/mhw'), []));
  test('an invalid contract blocks', () => {
    w.contract((d) => { d.severity.tolerated = ['medium']; });
    assertBlocks(gate.gateContract(w.project, undefined), 'medium-or-higher');
  });
  test('the contract of another repository blocks', () => assertBlocks(gate.gateContract(w.project, 'someone/else'), 'it governs tedeuxx/mhw'));
  test('a missing MADR blocks', () => {
    fs.unlinkSync(path.join(w.project, 'docs', 'adr', '0001-fixture-quality-bar.md'));
    assertBlocks(gate.gateContract(w.project, undefined), 'is missing, unreadable or outside');
  });
  /** @param {string} body */
  const brokenSchema = (body) => ({ schema: w.write('schema.json', body) });
  test('a schema with an unknown keyword cannot decide', () => {
    assert.throws(() => gate.gateContract(w.project, undefined, brokenSchema('{"type": "object", "properties": {"x": {"format": "date"}}}')), gate.Usage);
  });
  test('a schema with a NaN bound cannot decide', () => {
    assert.throws(() => gate.gateContract(w.project, undefined, brokenSchema('{"type": "object", "maximum": NaN}')), gate.Usage);
  });
  test('a contract with a repeated key blocks', () => {
    const p = path.join(w.project, 'project-policy.json');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"schema_version": 1,', '"schema_version": 1,\n  "schema_version": 1,'));
    assertBlocks(gate.gateContract(w.project, undefined), 'malformed');
  });
  test('the gates read the contract strictly, even after a looser validator passed it', () => {
    const p = path.join(w.project, 'project-policy.json');
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"schema_version": 1,', '"schema_version": 1,\n  "schema_version": 1,'));
    const loose = () => ({ code: 0, lines: ['OK  fine'] });
    assertBlocks(gate.loadContract(w.project, { check: loose })[1], 'contract: FAIL  malformed: repeated key "schema_version"');
    fs.writeFileSync(p, '{"x": 1,');
    assertBlocks(gate.loadContract(w.project, { check: loose })[1], 'contract: FAIL  unreadable or malformed: Expecting');
    fs.writeFileSync(p, Buffer.from('7bff7d', 'hex'));
    assertBlocks(gate.loadContract(w.project, { check: loose })[1], "contract: FAIL  unreadable or malformed: 'utf-8' codec can't decode byte 0xff");
  });
  test('a MADR linked outside the project blocks', { skip: !POSIX && 'a symbolic link needs privilege on Windows' }, () => {
    const outside = w.write('elsewhere.md', '- **Status:** accepted\n');
    const madr = path.join(w.project, 'docs', 'adr', '0001-fixture-quality-bar.md');
    fs.unlinkSync(madr);
    fs.symlinkSync(outside, madr);
    assertBlocks(gate.gateContract(w.project, undefined), 'outside the project');
  });
  test('a MADR path in another case blocks', () => {
    w.contract((d) => { d.madr.path = 'docs/ADR/0001-fixture-quality-bar.md'; });
    assertBlocks(gate.gateContract(w.project, undefined), 'is missing, unreadable or outside');
  });
  test('a runbook that is a directory blocks', () => {
    w.manual();
    fs.mkdirSync(path.join(w.project, 'docs', 'recovery-runbook.md'), { recursive: true });
    assertBlocks(gate.gateContract(w.project, undefined), 'runbook docs/recovery-runbook.md');
  });
  test('a MADR not accepted blocks', () => {
    fs.writeFileSync(path.join(w.project, 'docs', 'adr', '0001-fixture-quality-bar.md'), '- **Status:** ~~accepted~~ proposed\n');
    assertBlocks(gate.gateContract(w.project, undefined), 'no status line');
  });
  test('the MADR status is an exact match', () => {
    assert.equal(gate.madrStatusAccepted('- **Status:** Accepted.\n'), true);
    for (const t of ['Status: accepted later', 'Status: accepted, then superseded', 'Status: acceptedx', 'Status:']) {
      assert.equal(gate.madrStatusAccepted(t), false, t);
    }
  });
  test('the MADR status reading', () => {
    assert.equal(gate.madrStatusAccepted('status: accepted\n'), true);
    assert.equal(gate.madrStatusAccepted('- **Status:** ~~proposed~~ **Accepted.**'), true);
    assert.equal(gate.madrStatusAccepted('Status: proposed, accepted later'), false);
    assert.equal(gate.madrStatusAccepted('no status here'), false);
    // Python's lstrip("-") is left only: a trailing dash stays, so the value is not accepted.
    assert.equal(gate.madrStatusAccepted('--- Status: accepted'), true);
    assert.equal(gate.madrStatusAccepted('Status: accepted -'), false);
  });
  test('manual recovery without a runbook blocks, and with one passes', () => {
    w.manual();
    assertBlocks(gate.gateContract(w.project, undefined), 'runbook docs/recovery-runbook.md');
    fs.writeFileSync(path.join(w.project, 'docs', 'recovery-runbook.md'), '# runbook\n');
    assert.deepEqual(gate.gateContract(w.project, undefined), []);
  });
});

describe('container', () => {
  test('complete green evidence passes', () => assert.deepEqual(w.container(containerEvidence()), []));
  test('the container check is on by default', () => {
    // No requireContainer argument at all: a run without the marker file still blocks.
    const blocks = gate.gateContainer(w.project, w.write('ev.json', containerEvidence()), REV, REV, IMAGE, undefined, { dockerenv: path.join(w.tmp, 'absent') });
    assertBlocks(blocks, 'not running in a container');
    assert.equal(gate.DOCKERENV, '/.dockerenv');
  });
  test('not in a container blocks', () => assertBlocks(w.container(containerEvidence(), { inContainer: false }), 'not running in a container'));
  test('an image by tag blocks', () => {
    const ev = { ...containerEvidence(), container_image: 'python:3.12' };
    assertBlocks(w.container(ev, { image: 'python:3.12' }), 'not pinned by digest');
  });
  test('evidence from another image blocks', () => assertBlocks(w.container({ ...containerEvidence(), container_image: 'python@sha256:' + 'd'.repeat(64) }), 'the evidence names image'));
  test('evidence for another revision blocks', () => assertBlocks(w.container({ ...containerEvidence(), revision: OTHER }), 'the evidence names revision'));
  test('a checkout at another revision blocks', () => assertBlocks(w.container(containerEvidence(), { head: OTHER }), 'the checkout is at'));
  test('an abbreviated revision cannot decide', () => {
    assert.throws(() => w.container(containerEvidence(), { revision: REV.slice(0, 8), head: REV.slice(0, 8) }), gate.Usage);
  });
  test('coverage below the threshold blocks', () => {
    const ev = containerEvidence();
    ev.coverage.percent = 84.9;
    assertBlocks(w.container(ev), 'below the threshold');
  });
  test('coverage of another metric blocks', () => {
    const ev = containerEvidence();
    ev.coverage.metric = 'branch';
    assertBlocks(w.container(ev), 'the contract counts line');
  });
  test('coverage outside 0 to 100 blocks, and 100 passes', () => {
    for (const percent of [100.5, -1]) {
      const ev = containerEvidence();
      ev.coverage.percent = percent;
      assertBlocks(w.container(ev), 'not a percentage from 0 to 100');
    }
    const ev = containerEvidence();
    ev.coverage.percent = 100;
    assert.deepEqual(w.container(ev), []);
  });
  test('non-finite coverage blocks', () => {
    // The JSON read refuses NaN and Infinity; 1e400 reads as infinity, and the bound holds for it.
    for (const percent of ['1e400', '-1e400']) {
      const raw = JSON.stringify(containerEvidence()).replace('"percent":90', '"percent":' + percent);
      assertBlocks(gate.gateContainer(w.project, w.write('ev.json', raw), REV, REV, IMAGE, false), 'not a percentage from 0 to 100');
    }
  });
  test('coverage missing or boolean blocks', () => {
    const ev = /** @type {any} */ (containerEvidence());
    delete ev.coverage;
    assertBlocks(w.container(ev), 'coverage missing');
    const ev2 = /** @type {any} */ (containerEvidence());
    ev2.coverage.percent = true;
    assertBlocks(w.container(ev2), 'not a percentage');
  });
  test('a journey without a result blocks', () => assertBlocks(w.container({ ...containerEvidence(), critical_user_journeys: {} }), 'greet-reader has no result'));
  test('a failed journey blocks', () => assertBlocks(w.container({ ...containerEvidence(), critical_user_journeys: { 'greet-reader': 'fail' } }), 'greet-reader is "fail"'));
  test('an inconclusive scenario blocks', () => assertBlocks(w.container({ ...containerEvidence(), risk_scenarios: { 'no-unescaped-name': 'inconclusive' } }), 'inconclusive evidence blocks'));
  test('a result not in the contract blocks', () => {
    assertBlocks(w.container({ ...containerEvidence(), critical_user_journeys: { 'greet-reader': 'pass', invented: 'pass' } }), 'invented is not in the contract');
  });
  test('a missing security control blocks', () => {
    const ev = containerEvidence();
    delete ev.security_controls.sast;
    assertBlocks(w.container(ev), 'security_controls sast has no result');
  });
  test('a failed test layer blocks', () => assertBlocks(w.container({ ...containerEvidence(), test_layers: { unit: 'pass', api: 'fail' } }), 'test_layers api is "fail"'));
  test('no test layer blocks', () => assertBlocks(w.container({ ...containerEvidence(), test_layers: {} }), 'test_layers missing or empty'));
  test('an unknown evidence key blocks', () => assertBlocks(w.container({ ...containerEvidence(), skipped: true }), 'unknown key(s) skipped'));
  test('the wrong layer blocks', () => assertBlocks(w.container({ ...containerEvidence(), layer: 'local' }), 'not container'));
});

describe('findings', () => {
  /** @param {any} finding */
  const runWith = (finding) => w.container({ ...containerEvidence(), findings: [finding] });
  test('low with a bug Issue passes', () => {
    assert.deepEqual(runWith({ id: 'x', severity: 'low', bug_issue: '#12' }), []);
    assert.deepEqual(runWith({ id: 'x', severity: 'low', bug_issue: 'https://github.com/o/r/issues/3' }), []);
  });
  test('low without a bug Issue blocks', () => {
    assertBlocks(runWith({ id: 'x', severity: 'low' }), 'without a bug Issue');
    assertBlocks(runWith({ id: 'x', severity: 'low', bug_issue: '#12\n' }), 'without a bug Issue');
  });
  test('medium blocks', () => assertBlocks(runWith({ id: 'x', severity: 'medium', bug_issue: '#1' }), 'does not tolerate'));
  test('an unknown severity blocks', () => assertBlocks(runWith({ id: 'x', severity: 'info' }), 'unknown severity'));
  test('an unclassified finding blocks', () => assertBlocks(runWith({ id: 'x' }), 'unclassified findings block'));
  test('low when nothing is tolerated blocks', () => {
    w.contract((d) => { d.severity.tolerated = []; });
    assertBlocks(runWith({ id: 'x', severity: 'low', bug_issue: '#1' }), 'does not tolerate');
  });
  test('findings missing blocks', () => {
    const ev = /** @type {any} */ (containerEvidence());
    delete ev.findings;
    assertBlocks(w.container(ev), 'findings missing');
  });
});

describe('the evidence file', () => {
  test('a missing file blocks', () => {
    assertBlocks(gate.gateContainer(w.project, path.join(w.tmp, 'none.json'), REV, REV, IMAGE, false), 'missing or unreadable');
  });
  test('a repeated key blocks', () => {
    assertBlocks(gate.gateContainer(w.project, w.write('dup.json', '{"layer": "container", "layer": "container"}'), REV, REV, IMAGE, false), 'malformed');
  });
  test('NaN blocks', () => {
    assertBlocks(gate.gateContainer(w.project, w.write('nan.json', '{"coverage": {"metric": "line", "percent": NaN}}'), REV, REV, IMAGE, false), 'malformed');
  });
  test('the UTF-8 errors are CPython\'s', () => {
    /** @param {string} hex */
    const e = (hex) => utf8ErrorText(Buffer.from(hex, 'hex'));
    assert.equal(e('7b7d'), null);
    assert.equal(e('e282ac'), null);
    assert.equal(e('f09f9880'), null);
    assert.equal(e('ff'), "'utf-8' codec can't decode byte 0xff in position 0: invalid start byte");
    assert.equal(e('80'), "'utf-8' codec can't decode byte 0x80 in position 0: invalid start byte");
    assert.equal(e('c0af'), "'utf-8' codec can't decode byte 0xc0 in position 0: invalid start byte");
    assert.equal(e('41e228'), "'utf-8' codec can't decode byte 0xe2 in position 1: invalid continuation byte");
    assert.equal(e('e28228'), "'utf-8' codec can't decode bytes in position 0-1: invalid continuation byte");
    assert.equal(e('e282'), "'utf-8' codec can't decode bytes in position 0-1: unexpected end of data");
    assert.equal(e('f0'), "'utf-8' codec can't decode byte 0xf0 in position 0: unexpected end of data");
    assert.equal(e('eda080'), "'utf-8' codec can't decode byte 0xed in position 0: invalid continuation byte");
    assert.equal(e('f4908080'), "'utf-8' codec can't decode byte 0xf4 in position 0: invalid continuation byte");
    assert.equal(e('f09f9828'), "'utf-8' codec can't decode bytes in position 0-2: invalid continuation byte");
  });
});

describe('installed-stg', () => {
  test('STG at the revision passes', () => assert.deepEqual(w.installed(installedEvidence()), []));
  test('STG running another revision blocks', () => assertBlocks(w.installed({ ...installedEvidence(), stg_deployed_revision: OTHER }), 'STG reports it runs'));
  test('an unreadable STG revision blocks', () => assertBlocks(w.installed({ ...installedEvidence(), stg_deployed_revision: null }), 'STG reports it runs null'));
  test('an STG journey failure blocks', () => assertBlocks(w.installed({ ...installedEvidence(), critical_user_journeys: { 'greet-reader': 'fail' } }), 'greet-reader is "fail"'));
  test('no installed security validation blocks', () => assertBlocks(w.installed({ ...installedEvidence(), security_controls: {} }), 'installed security validation'));
  test('an installed control not in the contract blocks', () => {
    assertBlocks(w.installed({ ...installedEvidence(), security_controls: { authentication: 'pass', dast: 'pass' } }), 'security_controls dast is not in the contract');
  });
  test('container evidence is not installed evidence', () => assertBlocks(w.installed(containerEvidence()), 'not installed-stg'));
});

describe('classify', () => {
  test('a low rule is automatic', () => assert.deepEqual(gate.classify(w.project, '1'), ['low', 'automatic-after-all-gates', []]));
  test('a high rule wins a conflict', () => assert.deepEqual(gate.classify(w.project, '1,0'), ['high', 'owner-exact-revision', []]));
  test('no rule blocks', () => {
    for (const rules of ['', ' , ']) assertBlocks(gate.classify(w.project, rules)[2], 'unclassified change blocks');
  });
  test('a rule outside the contract blocks', () => {
    for (const rules of ['2', '-1', 'x', '1,9', '١']) assertBlocks(gate.classify(w.project, rules)[2], 'is not a rule index');
  });
  test('a stricter low-risk approval is honoured', () => {
    w.contract((d) => { d.approval.low_risk = 'owner-exact-revision'; });
    assert.deepEqual(gate.classify(w.project, '1'), ['low', 'owner-exact-revision', []]);
  });
});

describe('environment', () => {
  /** @param {any} doc */
  const run = (doc) => gate.gateEnvironment('production-owner-approval', w.write('env.json', doc));
  test('a required reviewer passes', () => {
    assert.deepEqual(run({ name: 'production-owner-approval', protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { login: 'o' } }] }] }), []);
  });
  test('a missing environment blocks', () => assertBlocks(run({}), 'created unprotected'));
  test('no reviewer blocks', () => {
    assertBlocks(run({ name: 'production-owner-approval', protection_rules: [{ type: 'wait_timer', wait_timer: 5 }] }), 'no required reviewer');
    assertBlocks(run({ name: 'production-owner-approval', protection_rules: [{ type: 'required_reviewers', reviewers: [] }] }), 'no required reviewer');
  });
  test('reviewers on a rule of another type are not a required reviewer (QA B2)', () => {
    for (const type of ['wait_timer', 'branch_policy', 'Required_reviewers', null]) {
      assertBlocks(run({ name: 'production-owner-approval', protection_rules: [{ type, reviewers: [{ id: 1 }] }] }), 'no required reviewer');
    }
    assertBlocks(run({ name: 'production-owner-approval', protection_rules: [{ reviewers: [{ id: 1 }] }] }), 'no required reviewer');
  });
  test('an unreadable protection names the environment gate', () => {
    assert.deepEqual(gate.gateEnvironment('x', path.join(w.tmp, 'none.json')).map((b) => b.split(' ')[0]), ['environment:']);
  });
});

describe('recovery-plan: automatic rollback', () => {
  test('the previous revision is the rollback target', () => assert.deepEqual(w.plan(), [['mode=automatic-rollback', 'rollback_target=' + OTHER], []]));
  test('the first deployment withdraws', () => assert.deepEqual(w.plan('none'), [['mode=automatic-rollback', 'rollback_target=none'], []]));
  test('an unreadable PROD revision blocks', () => {
    for (const value of ['unknown', 'NONE', OTHER.slice(0, 12), OTHER + '\n', OTHER.toUpperCase(), '']) {
      const [outputs, blocks] = w.plan(value);
      assert.equal(outputs, null, value);
      assertBlocks(blocks, 'not a full commit SHA or none');
    }
  });
  test('PROD already at the revision blocks', () => assertBlocks(w.plan(REV)[1], 'no previous version to return to'));
  test('a revision that is not a full SHA cannot decide', () => assert.throws(() => w.plan(OTHER, REV.slice(0, 7)), gate.Usage));
  test('a broken contract blocks', () => {
    w.contract((d) => { d.recovery = { mode: 'manual' }; });
    assertBlocks(w.plan()[1], 'recovery not prepared');
  });
});

describe('recovery-plan: manual recovery', () => {
  test('a tested runbook within the objective passes', () => {
    w.manual(30, filledRunbook());
    assert.deepEqual(w.plan(), [['mode=manual', 'rollback_target=' + OTHER, 'runbook=' + RUNBOOK, 'recovery_time_objective_minutes=30', 'operator=@operator-one'], []]);
  });
  test('a CRLF runbook passes', () => {
    w.manual(30, filledRunbook().replaceAll('\n', '\r\n'));
    assert.deepEqual(w.plan()[1], []);
  });
  test('a Windows separator in the path passes', () => {
    w.manual(30, filledRunbook());
    const viaBackslash = (/** @type {string} */ project, /** @type {string} */ rel) => gate.inside(project, rel.replaceAll('/', '\\'));
    assert.deepEqual(w.plan(OTHER, REV, { inside: viaBackslash })[1], []);
  });
  test('a missing runbook blocks', () => {
    w.manual();
    assertBlocks(w.plan()[1], 'is missing, unreadable or outside the project');
  });
  test('a runbook linked outside the project blocks', { skip: !POSIX && 'a symbolic link needs privilege on Windows' }, () => {
    const outside = w.write('elsewhere.md', filledRunbook());
    w.manual();
    fs.mkdirSync(path.join(w.project, 'docs'), { recursive: true });
    fs.symlinkSync(outside, path.join(w.project, ...RUNBOOK.split('/')));
    assertBlocks(w.plan()[1], 'outside the project');
  });
  test('a runbook that is not UTF-8 blocks', () => {
    w.manual();
    fs.writeFileSync(path.join(w.project, ...RUNBOOK.split('/')), Buffer.from('fffe2054657374656', 'hex'));
    assertBlocks(w.plan()[1], 'is missing, unreadable or outside the project');
  });
  test('the untested template blocks', () => {
    // The template as shipped carries a placeholder record, not a test.
    w.manual(30, text(RUNBOOK_TEMPLATE));
    assertBlocks(w.plan()[1], 'no test record dated ' + TESTED);
  });
  test('a record of another date blocks', () => {
    w.manual(30, filledRunbook('2026-01-14'));
    assertBlocks(w.plan()[1], 'no test record dated ' + TESTED);
  });
  test('a record over the objective blocks', () => {
    w.manual(30, filledRunbook(TESTED, '31'));
    assertBlocks(w.plan()[1], 'recovered in 31 minutes, over the recovery-time objective of 30');
  });
  test('a record at the objective passes', () => {
    w.manual(30, filledRunbook(TESTED, '30'));
    assert.deepEqual(w.plan()[1], []);
  });
  test('any record of the date over the objective blocks', () => {
    w.manual(30, filledRunbook() + '- Tested: ' + TESTED + '; recovered in 45 minutes; by @someone\n');
    assertBlocks(w.plan()[1], 'recovered in 45 minutes');
  });
  test('a struck record is not read', () => {
    let runbook = filledRunbook('2026-01-14').replace('- Tested: 2026-01-14', '~~- Tested: 2026-01-14').replace('by @operator-one', 'by @operator-one~~');
    runbook += '~~- Tested: ' + TESTED + '; recovered in 5 minutes; by @someone~~\n';
    w.manual(30, runbook);
    assertBlocks(w.plan()[1], 'no test record dated ' + TESTED);
  });
  test('a record is matched whole-line', () => {
    for (const line of [
      '- Tested: ' + TESTED + '; recovered in 5 minutes; by @someone, more',
      'Not Tested: ' + TESTED + '; recovered in 5 minutes; by @someone',
      '  - Tested: ' + TESTED + '; recovered in 5 minutes; by @someone',
      '- Tested: ' + TESTED + '; recovered in 5 minutes; by @someone ',
      '- Tested: ' + TESTED + '; recovered in 5 minutes; by @someone ~~old~~',
      '- Tested: ' + TESTED + '; recovered in ٥ minutes; by @someone',
    ]) {
      w.manual(30, '# runbook\n' + line + '\n');
      assertBlocks(w.plan()[1], 'no test record dated');
    }
  });
  test('an unreadable PROD revision blocks manual recovery too', () => {
    w.manual(30, filledRunbook());
    assertBlocks(w.plan('')[1], 'not a full commit SHA or none');
  });
});

describe('prod-validation', () => {
  test('a validated PROD passes', () => assert.deepEqual(w.validate(prodEvidence()), []));
  test('a failed journey blocks', () => assertBlocks(w.validate({ ...prodEvidence(), critical_user_journeys: { 'greet-reader': 'fail' } }), 'greet-reader is "fail", not pass'));
  test('an inconclusive risk scenario blocks', () => assertBlocks(w.validate({ ...prodEvidence(), risk_scenarios: { 'no-unescaped-name': 'inconclusive' } }), 'inconclusive evidence blocks'));
  test('a missing journey blocks', () => assertBlocks(w.validate({ ...prodEvidence(), critical_user_journeys: {} }), 'greet-reader has no result'));
  test('PROD running another revision blocks', () => assertBlocks(w.validate({ ...prodEvidence(), prod_deployed_revision: OTHER }), 'PROD reports it runs'));
  test('an unreadable PROD revision blocks', () => assertBlocks(w.validate({ ...prodEvidence(), prod_deployed_revision: null }), 'PROD reports it runs null'));
  test('evidence for another revision blocks', () => {
    assertBlocks(w.validate(prodEvidence(), REV, OTHER), 'the checkout is at');
    assertBlocks(w.validate({ ...prodEvidence(), revision: OTHER }), 'the evidence names revision');
  });
  test('the wrong layer and an unknown key block', () => {
    const blocks = w.validate({ ...prodEvidence(), layer: 'installed-stg', extra: 1 });
    assertBlocks(blocks, 'not prod');
    assertBlocks(blocks, 'unknown key(s) extra');
  });
  test('malformed evidence blocks (exit 1), it does not fail to decide', () => {
    for (const raw of ['', '{', '[]', '{"layer": NaN}', '{"layer": "prod", "layer": "prod"}']) assert.ok(w.validate(raw).length, raw);
  });
  test('missing evidence blocks', () => {
    assertBlocks(gate.gateProdValidation(w.project, path.join(w.tmp, 'absent.json'), REV, REV), 'missing or unreadable');
  });
});

describe('the validator\'s answer, held to its three exits (#498, kept by #499)', () => {
  const file = () => path.join(w.project, 'project-policy.json');
  // Fail closed, one test per exit-2 branch of policyCheck. Each turns a `code: 2` -> `code: 0` mutant red.
  test('a validator that throws cannot decide', () => {
    const r = gate.policyCheck(file(), { check: () => { throw new TypeError('boom'); } });
    assert.deepEqual(r, { code: 2, lines: ['ERROR  mhw policy check could not run: TypeError'] });
  });
  test('an exit other than 0, 1 or 2 cannot decide', () => {
    for (const code of [3, -1, 255]) {
      const r = gate.policyCheck(file(), { check: () => ({ code, lines: ['OK  fine'] }) });
      assert.equal(r.code, 2, String(code));
      assert.match(r.lines[0], /^ERROR {2}mhw policy check gave no answer \(exit /);
    }
  });
  test('silence cannot decide, whatever the exit', () => {
    for (const code of [0, 1, 2]) {
      const r = gate.policyCheck(file(), { check: () => ({ code, lines: [] }) });
      assert.deepEqual(r, { code: 2, lines: ['ERROR  mhw policy check gave no answer (exit ' + code + ')'] }, String(code));
    }
  });
  test('no answer at all cannot decide', () => {
    const r = gate.policyCheck(file(), { check: () => /** @type {any} */ (undefined) });
    assert.equal(r.code, 2);
  });
  test('a 0 without the OK line cannot decide', () => {
    for (const lines of [['pass'], ['OK fine'], ['FAIL  x']]) {
      const r = gate.policyCheck(file(), { check: () => ({ code: 0, lines }) });
      assert.deepEqual(r, { code: 2, lines: ['ERROR  mhw policy check exited 0 without its OK line', ...lines] });
    }
  });
  test('a validator that cannot decide is the gate\'s exit 2', () => {
    assert.throws(() => gate.gateContract(w.project, undefined, { check: () => ({ code: 2, lines: ['ERROR  schema'] }) }),
      (e) => e instanceof gate.Usage && /the validator cannot decide on .*project-policy\.json: ERROR {2}schema$/.test(e.message));
  });
  test('controls: an OK is a pass, and a FAIL is relayed', () => {
    assert.deepEqual(gate.policyCheck(file(), { check: () => ({ code: 0, lines: ['OK  fine'] }) }), { code: 0, lines: ['OK  fine'] });
    assert.deepEqual(gate.policyCheck(file(), { check: () => ({ code: 1, lines: ['FAIL  x'] }) }), { code: 1, lines: ['FAIL  x'] });
    assert.deepEqual(gate.policyCheck(file()), { code: 0, lines: ['OK  ' + file() + ' is a valid project-policy contract, schema_version 1'] });
  });
  test('the validator is the Node command\'s own, run in this process', () => {
    // #498: the contract gate reaches `mhw policy check`; its answer is the gate's.
    assert.deepEqual(gate.loadContract(w.project)[1], []);
    const p = file();
    fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace('"accepted"', '"proposed"'));
    assert.ok(gate.loadContract(w.project)[1].includes('contract: FAIL  $.madr.status: const (project MADR not ratified)'));
  });
  test('no program on PATH and no environment variable stands in for the validator', () => {
    // The gate spawns nothing: with an empty PATH and MHW_NODE naming a program that would answer OK for a
    // broken contract, the gate still reads the contract itself.
    const fake = w.write('fake-node', '#!/bin/sh\necho "OK  fine"\n');
    fs.chmodSync(fake, 0o755);
    const env = { PATH: path.join(w.tmp, 'empty'), MHW_NODE: fake };
    assert.equal(cli(['contract', '--project=' + w.project], env).code, 0);
    fs.writeFileSync(file(), '{"schema_version": 1}');
    const r = cli(['contract', '--project=' + w.project], env);
    assert.equal(r.code, 1);
    assert.match(r.err, /^BLOCK {2}contract: FAIL {2}\$\.madr: required/m);
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'src', 'commands', 'delivery-gate.js'), 'utf8'), /child_process|process\.env/);
  });
});

describe('an argument that is not valid UTF-8 (QA B3)', () => {
  // Python kept an undecodable argv byte as a surrogate (\udcff); Node decodes it to U+FFFD, so the same
  // bytes could name another file, or equal another name, and pass where the original blocked. Every
  // argument of every gate is refused instead (exit 2). Each row is a gate whose clean arguments decide
  // (exit 0 or 1), with one argument poisoned.
  const FFFD = '\uFFFD';
  /** @returns {Array<[string, string[]]>} */
  const rows = () => {
    const ev = w.write('ev.json', containerEvidence());
    const st = w.write('stg.json', installedEvidence());
    const pr = w.write('prod.json', prodEvidence());
    const env = w.write('env.json', { name: 'production-owner-approval', protection_rules: [{ type: 'required_reviewers', reviewers: [{ id: 1 }] }] });
    const p = '--project=' + w.project;
    return [
      ['contract', [p, '--repository=tedeuxx/mhw']],
      ['container', [p, '--evidence=' + ev, '--revision=' + REV, '--checkout-head=' + REV, '--container-image=' + IMAGE, '--no-container-check']],
      ['installed-stg', [p, '--evidence=' + st, '--revision=' + REV, '--checkout-head=' + REV]],
      ['classify', [p, '--rules=1']],
      ['environment', ['--name=production-owner-approval', '--protection=' + env]],
      ['recovery-plan', [p, '--revision=' + REV, '--prod-revision=' + OTHER]],
      ['prod-validation', [p, '--evidence=' + pr, '--revision=' + REV, '--checkout-head=' + REV]],
    ];
  };
  test('every argument of every gate is refused when it holds U+FFFD, and the clean call decides', () => {
    let poisoned = 0;
    for (const [g, args] of rows()) {
      assert.equal(cli([g, ...args]).code, 0, g + ': control, the clean call passes');
      for (let k = 0; k < args.length; k++) {
        const bad = [...args];
        bad[k] = bad[k].includes('=') ? bad[k].replace('=', '=' + FFFD) : bad[k] + FFFD;
        const r = cli([g, ...bad]);
        assert.deepEqual(r, { code: 2, out: '', err: 'mhw delivery-gate: ' + gate.NOT_UTF8 + '\n' }, g + ' ' + bad[k]);
        poisoned++;
      }
      assert.equal(cli([g + FFFD, ...args]).code, 2, g + ': the gate name');
    }
    assert.equal(poisoned, 23, 'every argument of the table was poisoned once');
  });
  test('the bytes themselves: 0xff in --name, --container-image and an --evidence path', { skip: !POSIX && 'POSIX shell' }, () => {
    const env = w.write('env.json', { name: 'production-owner-approval', protection_rules: [{ type: 'required_reviewers', reviewers: [{ id: 1 }] }] });
    const ev = w.write('ev.json', containerEvidence());
    const bin = path.join(ROOT, 'src', 'action', 'gates.js');
    /** @param {string} script */
    const sh = (script) => spawnSync('/bin/sh', ['-c', script, process.execPath, bin, env, ev, w.project, REV, IMAGE], { encoding: 'utf8', env: { PATH: process.env.PATH || '' } });
    const ff = '"$(printf \'\\377\')"';
    for (const script of [
      'exec "$0" "$1" delivery-gate environment --name=' + ff + ' "--protection=$2"',
      'exec "$0" "$1" delivery-gate container "--project=$4" "--evidence=$3" "--revision=$5" "--checkout-head=$5" --container-image=' + ff + ' --no-container-check',
      'exec "$0" "$1" delivery-gate container "--project=$4" --evidence=' + ff + ' "--revision=$5" "--checkout-head=$5" "--container-image=$6" --no-container-check',
    ]) {
      const r = sh(script);
      assert.equal(r.status, 2, script);
      assert.ok(r.stderr.includes(gate.NOT_UTF8), script);
    }
    assert.equal(sh('exec "$0" "$1" delivery-gate environment --name=production-owner-approval "--protection=$2"').status, 0, 'control');
  });
});

describe('the command line', () => {
  test('the container command checks the container unless told not to', { skip: fs.existsSync('/.dockerenv') && 'this run is in a container' }, () => {
    const args = ['container', '--project=' + w.project, '--evidence=' + w.write('ev.json', containerEvidence()),
      '--revision=' + REV, '--checkout-head=' + REV, '--container-image=' + IMAGE];
    const r = cli(args);
    assert.equal(r.code, 1);
    assert.match(r.err, /not running in a container/);
    assert.equal(cli([...args, '--no-container-check']).code, 0);
    assert.equal(cli([...args, '--require-container']).code, 2); // the old flag is gone
  });
  test('exit codes', () => {
    const project = '--project=' + w.project;
    assert.equal(cli(['contract', project]).code, 0);
    assert.deepEqual(cli(['classify', project, '--rules=0']), { code: 0, out: 'class=high\napproval=owner-exact-revision\n', err: '' });
    const blocked = cli(['classify', project, '--rules=']);
    assert.equal(blocked.code, 1);
    assert.match(blocked.err, /BLOCK {2}classify/);
    assert.equal(cli(['classify', project]).code, 2);
    assert.equal(cli(['container', project]).code, 2);
    assert.equal(cli(['contract', '--bogus=1']).code, 2);
    assert.deepEqual(cli(['nothing']), { code: 2, out: '', err: 'mhw delivery-gate: a gate: contract, container, installed-stg, classify, environment, recovery-plan or prod-validation\n' });
  });
  test('recovery-plan exit codes', () => {
    const project = '--project=' + w.project;
    assert.deepEqual(cli(['recovery-plan', project, '--revision=' + REV, '--prod-revision=' + OTHER]),
      { code: 0, out: 'mode=automatic-rollback\nrollback_target=' + OTHER + '\n', err: '' });
    const r = cli(['recovery-plan', project, '--revision=' + REV, '--prod-revision=' + REV]);
    assert.equal(r.code, 1);
    assert.equal(r.out, '');
    assert.match(r.err, /BLOCK {2}recovery-plan/);
    assert.equal(cli(['recovery-plan', project, '--revision=' + REV]).code, 2);
    assert.equal(cli(['recovery-plan', project, '--revision=x', '--prod-revision=none']).code, 2);
  });
  test('prod-validation exit codes', () => {
    const args = ['prod-validation', '--project=' + w.project, '--evidence=' + w.write('prod.json', prodEvidence()), '--revision=' + REV];
    assert.equal(cli([...args, '--checkout-head=' + REV]).code, 0);
    const r = cli([...args, '--checkout-head=' + OTHER]);
    assert.equal(r.code, 1);
    assert.match(r.err, /BLOCK {2}prod-validation/);
    assert.equal(cli(args).code, 2);
  });
  test('Python\'s strip and splitlines, as the gate reads a MADR and a runbook', () => {
    assert.equal(pyStrip('\u001c\u0085 x 　'), 'x');
    assert.equal(pyStrip('﻿x'), '﻿x');
    assert.deepEqual(splitLines('a\r\nb\rc\nd e\u000bf\u001cg\n'), ['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    assert.deepEqual(splitLines(''), []);
    assert.deepEqual(splitLines('a\n\nb'), ['a', '', 'b']);
  });
});

describe('the workflows', () => {
  const USES = /^\s*-?\s*uses:\s*(\S+)/gm;
  test('every action is pinned by SHA', () => {
    for (const p of [...WORKFLOWS, TEMPLATE]) {
      const refs = [...text(p).matchAll(USES)].map((m) => m[1]);
      assert.ok(refs.length, p);
      for (const ref of refs) {
        if (ref.startsWith('./') || ref === 'tedeuxx/mhw/.github/workflows/reference-delivery-gate.yml@<mhw-commit-sha>'
          || ref === 'tedeuxx/mhw/actions/delivery-gates@<mhw-commit-sha>') continue;
        assert.match(ref, /^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/, path.basename(p) + ': ' + ref);
      }
    }
  });
  test('the gate and the dry run name no environment', () => {
    // A job that names a missing environment creates it, unprotected: neither file may name one.
    for (const p of WORKFLOWS) assert.doesNotMatch(text(p), /^\s+environment:/m, path.basename(p));
  });
  test('the workflow never turns the container check off', () => {
    for (const p of [...WORKFLOWS, TEMPLATE]) assert.ok(!text(p).includes('--no-container-check'), path.basename(p));
  });

  // Least privilege, pinned per job (QA advisory A1 on #449): a scope added to any job, or a job added with
  // any permission, fails here. null means the job declares none and inherits the top level, which must be
  // `permissions: {}`.
  /** @type {Array<[string, Record<string, Record<string, string> | null>]>} */
  const PERMISSIONS = [
    [GATE_WORKFLOW, { contract: { contents: 'read' }, containerised: { contents: 'read' }, 'installed-stg': { contents: 'read' },
      authorisation: { contents: 'read', actions: 'read' } }],
    [DRY_RUN, { 'before-stg': { contents: 'read', actions: 'read' }, 'before-prod': { contents: 'read', actions: 'read' }, report: null }],
    [TEMPLATE, { 'gates-before-stg': { contents: 'read', actions: 'read' }, 'deploy-stg': { contents: 'read', 'id-token': 'write' },
      'risk-rules': { contents: 'read', 'pull-requests': 'read' }, 'gates-before-prod': { contents: 'read', actions: 'read' },
      'recovery-plan': { contents: 'read' }, 'deploy-prod': { contents: 'read', 'id-token': 'write' }, 'validate-prod': { contents: 'read' },
      recover: { contents: 'read', 'id-token': 'write' } }],
  ];

  /**
   * [top level, { job: permissions or null }, count of permissions keys] from the file's text: a small reader
   * for this repository's own layout (two-space jobs, four-space job keys); any permissions key it does not
   * place is still counted, so one hidden elsewhere fails.
   * @param {string} body
   */
  function permissions(body) {
    /** @param {string[]} lines @param {number} start @param {number} indent @returns {any} */
    const value = (lines, start, indent) => {
      const inline = lines[start].split('permissions:')[1].trim();
      if (inline) {
        if (inline === '{}') return {};
        const m = /^\{(.*)\}$/.exec(inline);
        if (!m) return inline; // write-all, read-all: never equal to a pinned mapping
        return Object.fromEntries(m[1].split(',').map((part) => part.trim().split(': ')));
      }
      /** @type {Record<string, string>} */
      const scopes = {};
      const scope = new RegExp('^ {' + (indent + 2) + '}([\\w-]+): (\\S+)$');
      for (const line of lines.slice(start + 1)) {
        const m = scope.exec(line);
        if (!m) break;
        scopes[m[1]] = m[2];
      }
      return scopes;
    };
    const lines = body.split('\n');
    /** @type {any} */
    let top = null;
    /** @type {Record<string, any>} */
    const jobs = {};
    /** @type {string | null} */
    let job = null;
    let inJobs = false;
    lines.forEach((line, index) => {
      if (line === 'jobs:') inJobs = true;
      else if (inJobs && /^ {2}[\w-]+:$/.test(line)) {
        job = line.trim().slice(0, -1);
        jobs[job] = null;
      } else if (line.startsWith('permissions:')) top = value(lines, index, 0);
      else if (inJobs && job && line.startsWith('    permissions:')) jobs[job] = value(lines, index, 4);
    });
    return [top, jobs, (body.match(/^\s*permissions:/gm) || []).length];
  }

  test('every job has least privilege', () => {
    for (const [p, pinned] of PERMISSIONS) {
      const [top, jobs, count] = permissions(text(p));
      assert.deepEqual(top, {}, path.basename(p));
      assert.deepEqual(jobs, pinned, path.basename(p));
      assert.equal(count, 1 + Object.values(pinned).filter((v) => v !== null).length, path.basename(p));
    }
  });
  test('the gate runs every gate through the delivery gates Action, at the pinned mhw checkout (#592)', () => {
    const body = text(GATE_WORKFLOW);
    // The contract gate is the validator and then the contract gate (src/action/gates.js, plan()).
    for (const g of ['contract', 'container', 'installed-stg', 'classify', 'environment']) {
      assert.match(body, new RegExp('^ {8}uses: \\./mhw/actions/delivery-gates\\n {8}with:\\n {10}gate: ' + g + '$', 'm'), g);
    }
    assert.doesNotMatch(body, /bin\/mhw\.js/);
  });
  test('no workflow step runs Python; only the dry run names the fixture\'s own test commands', () => {
    // Comments may name the old line (the template's pin-move note does); no YAML line may.
    /** @param {string} p */
    const yamlLines = (p) => text(p).split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
    for (const p of [GATE_WORKFLOW, TEMPLATE]) assert.doesNotMatch(yamlLines(p), /python3? |delivery_gate|setup-python|bin\/mhw\.js/, path.basename(p));
    assert.match(text(TEMPLATE), /^# .*`node mhw\/bin\/mhw\.js delivery-gate <gate> --flag=value \.\.\.` to the Action with `gate: <gate>` and one$/m);
    const dry = text(DRY_RUN);
    assert.doesNotMatch(dry, /^\s+(?:- )?run:.*python|delivery_gate|setup-python/m);
    assert.deepEqual([...dry.matchAll(/python3 -B (\S+)/g)].map((m) => m[1]).sort(byString), ['container_tests.py', 'container_tests.py', 'stg_stand_in_tests.py']);
  });
  test('every job that runs a gate checks out the mhw it runs, or names it by its pin (#592)', () => {
    // The Action sets up Node itself. The reusable workflow runs it from its mhw checkout at mhw-revision,
    // which must come before the first gate step of the job; the template names it by its pin.
    const jobs = text(GATE_WORKFLOW).split('\njobs:\n')[1].split(/^ {2}(?=[\w-]+:$)/m).slice(1);
    const gating = jobs.filter((j) => j.includes('uses: ./mhw/actions/delivery-gates'));
    assert.equal(gating.length, 4);
    for (const job of gating) {
      const checkout = job.indexOf('repository: tedeuxx/mhw\n          ref: ${{ inputs.mhw-revision }}\n          path: mhw');
      assert.ok(checkout >= 0 && checkout < job.indexOf('uses: ./mhw/actions/delivery-gates'), job.split(':')[0]);
    }
    const template = text(TEMPLATE);
    assert.equal([...template.matchAll(/uses: tedeuxx\/mhw\/actions\/delivery-gates@<mhw-commit-sha>$/gm)].length, 2);
    assert.doesNotMatch(template, /repository: tedeuxx\/mhw$/m, 'no job of the template checks out mhw any more');
  });
  test('the dry run has no deployment job', () => {
    const body = text(DRY_RUN).split('\njobs:\n')[1];
    assert.deepEqual([...body.matchAll(/^ {2}([\w-]+):$/gm)].map((m) => m[1]).sort(byString), ['before-prod', 'before-stg', 'report']);
  });
});

describe('the caller template', () => {
  const jobs = () => text(TEMPLATE).split('\njobs:\n')[1];
  /** @param {string} name */
  const job = (name) => {
    const m = new RegExp('^ {2}' + name + ':\\n([\\s\\S]*?)(?=^ {2}[\\w-]+:\\n|(?![\\s\\S]))', 'm').exec(jobs());
    assert.ok(m, name);
    return m[1];
  };
  test('recovery is planned before the PROD deployment', () => {
    assert.match(job('recovery-plan'), /uses: tedeuxx\/mhw\/actions\/delivery-gates@<mhw-commit-sha>\n {8}with:\n {10}gate: recovery-plan$/m);
    assert.match(job('deploy-prod'), /needs: \[[^\]]*\brecovery-plan\b/);
  });
  test('PROD is validated after the deployment', () => {
    const validate = job('validate-prod');
    assert.ok(validate.includes('needs: deploy-prod'));
    assert.match(validate, /uses: tedeuxx\/mhw\/actions\/delivery-gates@<mhw-commit-sha>\n {8}with:\n {10}gate: prod-validation$/m);
  });
  test('recovery runs on any failure after exposure', () => {
    const recover = job('recover');
    const condition = /^ {4}if: (.*)$/m.exec(recover);
    assert.ok(condition);
    for (const fragment of ['always()', "needs.recovery-plan.result == 'success'", "needs.deploy-prod.result != 'skipped'", "needs.validate-prod.result != 'success'"]) {
      assert.ok(condition[1].includes(fragment), fragment);
    }
    // The automatic path never waits for a reviewer: it names the environment with none.
    assert.match(recover, /^ {4}environment: <the PROD environment with no required reviewer>$/m);
    assert.ok(recover.includes('automatic-rollback'));
    assert.ok(recover.includes('manual'));
  });
  test('no step interpolates an output into a script', () => {
    // Outputs reach a script through env:, never ${{ }} inside run:, so a value cannot inject.
    const lines = jobs().split('\n');
    let scripts = 0;
    lines.forEach((line, index) => {
      const m = /^( *)(?:- )?run:(.*)$/.exec(line);
      if (!m) return;
      scripts++;
      const indent = m[1].length;
      const script = [m[2]];
      for (const following of lines.slice(index + 1)) {
        if (following.trim() && following.length - following.trimStart().length <= indent) break;
        script.push(following);
      }
      assert.ok(!script.join('\n').includes('${{'), line);
    });
    assert.ok(scripts >= 6);
  });
});

describe('the declared fixtures (D5 of the Node runtime requirements)', () => {
  const declared = JSON.parse(fs.readFileSync(path.join(ROOT, 'test', 'declared-fixtures.json'), 'utf8')).fixtures;
  test('every declared fixture exists and states why', () => {
    for (const f of declared) {
      assert.ok(fs.statSync(path.join(ROOT, ...f.path.split('/'))).isFile(), f.path);
      assert.ok(f.why.length > 40 && f.slice, f.path);
    }
  });
  test('every .py under global/project-policy/ is a declared fixture', () => {
    /** @type {string[]} */
    const found = [];
    /** @param {string} dir */
    const walk = (dir) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (e.name.endsWith('.py')) found.push(path.relative(ROOT, p).split(path.sep).join('/'));
      }
    };
    walk(HERE);
    assert.deepEqual(found.sort(byString), declared.map((/** @type {{ path: string }} */ f) => f.path).filter((/** @type {string} */ p) => p.startsWith('global/project-policy/')).sort(byString));
  });
});
