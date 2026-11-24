// The delivery gates Action (#592, ADR-0046): actions/delivery-gates/action.yml and its engine,
// src/action/gates.js. The three commands' own cases are the S28 and S29 golden transcripts, which run
// against the engine (test/project-policy/*-golden.test.js); this file holds the Action's input mapping,
// its step (`--action`) on the reference fixture project, the Action file's security properties, and that
// the three commands left the CLI. Every run is in a throwaway directory.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { plan, inputs, outputLines, runOne, writeOutputs, GATES, OUTPUT_GATES } from '../../src/action/gates.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const ENGINE = path.join(ROOT, 'src', 'action', 'gates.js');
const ACTION = path.join(ROOT, 'actions', 'delivery-gates', 'action.yml');
const FIXTURE = path.join(ROOT, 'global', 'project-policy', 'reference', 'fixture');
const SHA = 'a'.repeat(40);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-action-'));
/** A minimal environment; Windows needs SystemRoot for a child node. @type {Record<string, string>} */
const ENV = { PATH: process.env.PATH || '', HOME: tmp, USERPROFILE: tmp };
if (process.env.SystemRoot) ENV.SystemRoot = process.env.SystemRoot;
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

/** @param {Record<string, string>} values */
const from = (values) => inputs(Object.fromEntries(Object.entries(values).map(([k, v]) => ['MHW_INPUT_' + k.toUpperCase().replaceAll('-', '_'), v])));

/** A plan's runs; a plan that is an error fails. @param {(name: string) => string} input @returns {string[][]} */
function runsOf(input) {
  const p = plan(input);
  if ('error' in p) assert.fail(p.error);
  return p.runs;
}

/** The Action's step, as action.yml runs it. @param {Record<string, string>} values @param {Record<string, string>} [extra] */
function step(values, extra = {}) {
  /** @type {Record<string, string>} */
  const env = { ...ENV, ...extra };
  for (const [k, v] of Object.entries(values)) env['MHW_INPUT_' + k.toUpperCase().replaceAll('-', '_')] = v;
  const p = spawnSync(process.execPath, [ENGINE, '--action'], { cwd: ROOT, env, encoding: 'utf8', timeout: 60000 });
  return { code: p.status, out: p.stdout, err: p.stderr };
}

test('each gate maps its inputs to the arguments the command took', () => {
  const all = { 'project-dir': 'p', repository: 'o/n', evidence: 'e.json', revision: SHA, 'checkout-head': SHA,
    'container-image': 'i@sha256:' + 'b'.repeat(64), rules: '0,2', name: 'env', protection: 'prot.json',
    'prod-revision': 'none', base: 'origin/rc/next', head: 'h', 'body-file': 'b.md', manifest: 'm.json' };
  /** @type {Record<string, string[][]>} */
  const want = {
    contract: [['policy', 'check', '--project=p'], ['delivery-gate', 'contract', '--project=p', '--repository=o/n']],
    container: [['delivery-gate', 'container', '--project=p', '--evidence=e.json', '--revision=' + SHA, '--checkout-head=' + SHA,
      '--container-image=i@sha256:' + 'b'.repeat(64)]],
    'installed-stg': [['delivery-gate', 'installed-stg', '--project=p', '--evidence=e.json', '--revision=' + SHA, '--checkout-head=' + SHA]],
    classify: [['delivery-gate', 'classify', '--project=p', '--rules=0,2']],
    environment: [['delivery-gate', 'environment', '--name=env', '--protection=prot.json']],
    'recovery-plan': [['delivery-gate', 'recovery-plan', '--project=p', '--revision=' + SHA, '--prod-revision=none']],
    'prod-validation': [['delivery-gate', 'prod-validation', '--project=p', '--evidence=e.json', '--revision=' + SHA, '--checkout-head=' + SHA]],
    'docs-baseline': [['docs-baseline', 'check', '--base=origin/rc/next', '--head=h', '--body-file=b.md', '--manifest=m.json', '--project=p']],
  };
  assert.deepEqual(Object.keys(want), GATES);
  for (const gate of GATES) assert.deepEqual(plan(from({ ...all, gate })), { runs: want[gate] }, gate);
});

test('a required flag is passed empty, an optional one only when set', () => {
  assert.deepEqual(plan(from({ gate: 'classify' })), { runs: [['delivery-gate', 'classify', '--project=.', '--rules=']] });
  assert.deepEqual(runsOf(from({ gate: 'contract' }))[1], ['delivery-gate', 'contract', '--project=.']);
  assert.deepEqual(plan(from({ gate: 'docs-baseline' })), { runs: [['docs-baseline', 'check', '--base=', '--project=.']] });
  assert.equal(runsOf(from({ gate: 'container', 'no-container-check': 'true' }))[0].at(-1), '--no-container-check');
  assert.ok(!runsOf(from({ gate: 'container', 'no-container-check': 'false' }))[0].includes('--no-container-check'));
  for (const gate of ['', 'nope', 'Contract', 'policy']) assert.ok('error' in plan(from({ gate })), JSON.stringify(gate));
});

test('only key=value lines become outputs', () => {
  assert.deepEqual(outputLines('class=low\napproval=automatic-after-all-gates\nOK  something\nmode=manual\n'), ['class=low', 'approval=automatic-after-all-gates', 'mode=manual']);
  assert.deepEqual([...OUTPUT_GATES].sort(), ['classify', 'recovery-plan']);
});

test('the step: the fixture project\'s valid contract passes and a broken one blocks', () => {
  const ok = step({ gate: 'contract', 'project-dir': FIXTURE, repository: 'tedeuxx/mhw' });
  assert.equal(ok.code, 0, ok.err);
  assert.match(ok.out, /is a valid project-policy contract, schema_version 1\n/);
  assert.match(ok.out, /^OK  contract: valid, bound to this repository, MADR accepted$/m);

  const broken = path.join(tmp, 'broken');
  fs.cpSync(FIXTURE, broken, { recursive: true });
  const file = path.join(broken, 'project-policy.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace('"schema_version": 1,', '"schema_version": 2,'));
  const bad = step({ gate: 'contract', 'project-dir': broken, repository: 'tedeuxx/mhw' });
  assert.equal(bad.code, 1);
  assert.match(bad.out + bad.err, /unknown version/);
  // The validator ran first and blocked: the contract gate never ran.
  assert.doesNotMatch(bad.out + bad.err, /contract: valid/);

  const elsewhere = step({ gate: 'contract', 'project-dir': FIXTURE, repository: 'someone/else' });
  assert.equal(elsewhere.code, 1);
  assert.match(elsewhere.err, /^BLOCK  contract: it governs tedeuxx\/mhw, this run is in someone\/else$/m);
});

test('the step: classify writes its outputs, an unknown gate and a missing input fail', () => {
  const out = path.join(tmp, 'github-output');
  fs.writeFileSync(out, 'before=1\n');
  const r = step({ gate: 'classify', 'project-dir': FIXTURE, rules: '1' }, { GITHUB_OUTPUT: out });
  assert.equal(r.code, 0, r.err);
  assert.equal(fs.readFileSync(out, 'utf8'), 'before=1\nclass=low\napproval=automatic-after-all-gates\n');

  const none = step({ gate: 'classify', 'project-dir': FIXTURE, rules: '' }, { GITHUB_OUTPUT: out });
  assert.notEqual(none.code, 0);
  assert.equal(fs.readFileSync(out, 'utf8'), 'before=1\nclass=low\napproval=automatic-after-all-gates\n', 'a blocked gate writes no output');

  const unknown = step({ gate: 'deploy' });
  assert.equal(unknown.code, 2);
  assert.match(unknown.err, /^BLOCK  delivery gates action: unknown gate "deploy" \(contract, /m);

  const missing = step({ gate: 'container', 'project-dir': FIXTURE });
  assert.notEqual(missing.code, 0, 'a container gate with no evidence never passes');
});

// #599: onboard left too, with launch-line and funnel-review (CLI native baseline PRD, section 5).
test('the three commands are unknown to the CLI, and so are onboard, launch-line and funnel-review', () => {
  for (const argv of [['policy', 'check'], ['delivery-gate', 'contract'], ['docs-baseline', 'check'], ['policy'],
    ['onboard'], ['onboard', '--project=' + path.join(tmp, 'absent')], ['launch-line', '--resolve', 'codex'], ['funnel-review', 'sprint-01']]) {
    const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), ...argv], { cwd: tmp, env: ENV, encoding: 'utf8' });
    assert.equal(p.status, 2, argv.join(' '));
    assert.equal(p.stdout, '', argv.join(' '));
    // POSIX: the lifecycle parser's refusal; Windows: the Windows plan's (src/cli.js, windowsPlan).
    assert.match(p.stderr, new RegExp('^mhw: (?:unknown (?:subcommand|argument for) ' + argv[0] + '\\b|' + argv[0] + ' is not available on Windows)'), argv.join(' '));
  }
  const usage = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), '--help'], { cwd: tmp, env: ENV, encoding: 'utf8' });
  assert.doesNotMatch(usage.stdout, /policy check|delivery-gate|docs-baseline|onboard|launch-line|funnel-review/);
});

test('the Action: pinned, no secret, no token, inputs only through env', () => {
  // A Windows checkout writes CRLF (core.autocrlf); the YAML is read as LF.
  const body = fs.readFileSync(ACTION, 'utf8').replaceAll('\r\n', '\n');
  const yaml = body.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  const uses = [...yaml.matchAll(/^\s*- uses: (\S+)$/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 1);
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
  assert.doesNotMatch(yaml, /secrets\.|github\.token|GITHUB_TOKEN|GH_TOKEN/);
  assert.match(yaml, /^ {2}using: composite$/m);
  // Every run block carries no expression.
  // There is exactly one run block (QA A5 on #611: every one is read, not only the first).
  const runs = [...yaml.matchAll(/^\s*(?:- )?run:(.*)$/gm)].map((m) => m[1].trim());
  assert.deepEqual(runs, ['node "$GITHUB_ACTION_PATH/../../src/action/gates.js" --action']);
  // Every declared input but node-version reaches the engine as MHW_INPUT_<NAME>, and nothing else does.
  const declared = [...yaml.split('\noutputs:\n')[0].matchAll(/^ {2}([a-z-]+):$/gm)].map((m) => m[1]).filter((n) => n !== 'node-version');
  const env = [...yaml.matchAll(/^ {8}MHW_INPUT_([A-Z_]+): \$\{\{ inputs\.([a-z-]+) \}\}$/gm)];
  assert.deepEqual(env.map((m) => m[2]), declared);
  for (const m of env) assert.equal(m[1], m[2].toUpperCase().replaceAll('-', '_'));
  // Every output the gates print is declared.
  for (const key of ['class', 'approval', 'mode', 'rollback_target', 'runbook', 'recovery_time_objective_minutes', 'operator']) {
    assert.match(yaml, new RegExp('^ {2}' + key + ':\\n(?: {4}.*\\n)*? {4}value: \\$\\{\\{ steps\\.gate\\.outputs\\.' + key + ' \\}\\}$', 'm'), key);
  }
});

test('this repository\'s workflows call the Action at their own ref', () => {
  /** @param {string} f */
  const wf = (f) => fs.readFileSync(path.join(ROOT, '.github', 'workflows', f), 'utf8').replaceAll('\r\n', '\n');
  assert.match(wf('docs-baseline.yml'), /^ {8}uses: \.\/actions\/delivery-gates\n {8}with:\n {10}gate: docs-baseline$/m);
  assert.doesNotMatch(wf('docs-baseline.yml'), /bin\/mhw\.js/);
  const gate = wf('reference-delivery-gate.yml');
  assert.doesNotMatch(gate.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n'), /mhw\/bin\/mhw\.js|setup-node/);
  for (const g of ['contract', 'container', 'installed-stg', 'classify', 'environment']) {
    assert.match(gate, new RegExp('uses: \\./mhw/actions/delivery-gates\\n {8}with:\\n {10}gate: ' + g + '$', 'm'), g);
  }
  const fixture = wf('delivery-gates-action.yml');
  assert.match(fixture, /^permissions: \{\}$/m);
  assert.match(fixture, /^ {4}permissions:\n {6}contents: read$/m);
  assert.match(fixture, /^ {8}continue-on-error: true\n {8}uses: \.\/actions\/delivery-gates$/m);
  assert.match(fixture, /\[ "\$BROKEN" = failure \]/);
});

test('a passing gate appends only its key=value lines to $GITHUB_OUTPUT (QA A2 on #611)', () => {
  const out = path.join(tmp, 'output-filter');
  /** @type {string[]} */
  const seen = [];
  const io = { out: (/** @type {string} */ s) => { seen.push(s); }, err: () => {}, cwd: ROOT };
  fs.writeFileSync(out, '');
  // The validator prints an OK line and no key=value line: nothing reaches the output file.
  const example = path.join(ROOT, 'global', 'project-policy', 'project-policy.example.json');
  assert.equal(runOne(['policy', 'check', '--file=' + example], ENV, io, out), 0);
  assert.match(seen.join(''), /^OK {2}/);
  assert.equal(fs.readFileSync(out, 'utf8'), '');
  // classify prints only key=value lines, and they arrive.
  assert.equal(runOne(['delivery-gate', 'classify', '--project=' + FIXTURE, '--rules=1'], ENV, io, out), 0);
  assert.equal(fs.readFileSync(out, 'utf8'), 'class=low\napproval=automatic-after-all-gates\n');
  // No output file named: nothing is written anywhere.
  assert.equal(runOne(['delivery-gate', 'classify', '--project=' + FIXTURE, '--rules=1'], ENV, io, undefined), 0);
  // A stdout that mixes lines: only the key=value ones are appended, after what the file held.
  fs.writeFileSync(out, 'before=1\n');
  writeOutputs(out, 'OK  something\nmode=manual\nNOTE  more\nrollback_target=none\n');
  assert.equal(fs.readFileSync(out, 'utf8'), 'before=1\nmode=manual\nrollback_target=none\n');
  writeOutputs(out, 'OK  nothing to output\n');
  assert.equal(fs.readFileSync(out, 'utf8'), 'before=1\nmode=manual\nrollback_target=none\n');
});

// QA B1 on #611: live text that presents a removed command (`mhw policy check`, `mhw delivery-gate`,
// `mhw docs-baseline check`) as current. One row per member file the verdict named; every line there
// that names one must also mark it as history. The S28/S29-pinned messages of src/commands/ are the
// exit contract and are not members; the onboard skill's output lines (mhw onboard's until #599) are
// checked below.
const REMOVED = /(?:mhw|bin\/mhw\.js) (?:policy|delivery-gate|docs-baseline)/;
const HISTORY = /#592|until|left the CLI|~~|it was|was `|were three|removed|no longer|replaces/;
for (const file of ['docs/project-policy-contract.md', 'docs/recovery-reference.md', 'README.md',
  'docs/native-enforcement-matrix.md', 'global/project-policy/project-policy.schema.json',
  'docs/deployment-lock-coverage.md', 'method/skills/documentation-standard/SKILL.md', 'method/skills/onboard/SKILL.md']) {
  test('no live instruction names a removed command: ' + file, () => {
    const lines = fs.readFileSync(path.join(ROOT, ...file.split('/')), 'utf8').split(/\r?\n/);
    const live = lines.map((l, i) => [i + 1, l]).filter(([, l]) => REMOVED.test(String(l)) && !HISTORY.test(String(l)));
    assert.deepEqual(live, []);
  });
}

test('the onboard skill names the Action\'s contract gate for project-policy.json, and no removed command', () => {
  // mhw onboard printed these two lines until #599; the skill now carries them as the lines it reports.
  const text = fs.readFileSync(path.join(ROOT, 'method', 'skills', 'onboard', 'SKILL.md'), 'utf8').replaceAll('\r\n', '\n');
  const flat = text.replace(/\n\s*/g, ' ');
  assert.ok(flat.includes("`GAP   project-policy.json is not JSON; validate it with the delivery gates Action's contract gate`"));
  assert.ok(flat.includes("`NOTE  project-policy.json is present; the delivery gates Action's contract gate validates it, this skill does not`"));
  assert.ok(flat.includes("the delivery gates Action's docs-baseline gate will refuse it"));
  assert.doesNotMatch(text, REMOVED);
});
