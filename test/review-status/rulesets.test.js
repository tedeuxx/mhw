// The delivery rulesets (Issue #591, ADR-0045): global/github-repo-settings.json validates against
// global/github-repo-settings.schema.json (applied with the project-policy evaluator, the one JSON Schema
// subset this repository implements), the schema refuses each weakening, and every required context names
// a check that something here actually posts. Applying the rulesets is the owner's act; nothing here
// calls GitHub.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { strictLoads, validateSchema, evaluate } from '../../src/commands/project-policy.js';
import { CONTEXT } from '../../.github/scripts/review-status.js';
import { repoStandard } from '../../src/lib/prerequisites.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// LF whatever the checkout: the Windows runners check out with core.autocrlf=true.
const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replaceAll('\r\n', '\n');
const DECLARATION = 'global/github-repo-settings.json';
const SCHEMA = strictLoads(read('global/github-repo-settings.schema.json'));
// GitHub Actions' app id, documented by GitHub; the review statuses are posted by its GITHUB_TOKEN.
const ACTIONS = 15368;

/** The declaration as plain JSON, to mutate. @returns {any} */
const doc = () => JSON.parse(read(DECLARATION));
/** Schema findings for a plain-JSON document. @param {unknown} d */
const findings = (d) => evaluate(strictLoads(JSON.stringify(d)), SCHEMA);
/** @param {any} d @param {string} branch @returns {any} */
const ruleset = (d, branch) => d.rulesets.find((/** @type {any} */ x) => x.conditions.ref_name.include[0] === 'refs/heads/' + branch);
/** @param {any} rs @param {string} type @returns {any} */
const rule = (rs, type) => rs.rules.find((/** @type {any} */ x) => x.type === type);
/** @param {any} rs @returns {string[]} */
const contexts = (rs) => rule(rs, 'required_status_checks').parameters.required_status_checks.map((/** @type {any} */ c) => c.context);

test('the declaration validates against its schema, and the schema is one the evaluator implements', () => {
  validateSchema(SCHEMA);
  assert.deepEqual(findings(doc()), []);
  assert.deepEqual(repoStandard().map(([k, , v]) => [k, v]), [['allow_merge_commit', true], ['allow_rebase_merge', false], ['allow_squash_merge', false]],
    'mhw check still reads the settings beside the rulesets');
});

test('the schema refuses each weakening of the delivery route', () => {
  /** @type {Array<[string, (d: any) => void]>} */
  const weakenings = [
    ['squash allowed', (d) => { d.settings.allow_squash_merge = true; }],
    ['a squash merge method', (d) => { rule(ruleset(d, 'rc/next'), 'pull_request').parameters.allowed_merge_methods = ['merge', 'squash']; }],
    ['a rebase merge method on main', (d) => { rule(ruleset(d, 'main'), 'pull_request').parameters.allowed_merge_methods = ['rebase']; }],
    ['a bypass on rc/next', (d) => { ruleset(d, 'rc/next').bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]; }],
    ['the lens dropped on rc/next', (d) => {
      const p = rule(ruleset(d, 'rc/next'), 'required_status_checks').parameters;
      p.required_status_checks = p.required_status_checks.filter((/** @type {any} */ c) => c.context !== 'review/agents-lead');
    }],
    ['the verdict dropped on main', (d) => {
      const p = rule(ruleset(d, 'main'), 'required_status_checks').parameters;
      p.required_status_checks = p.required_status_checks.filter((/** @type {any} */ c) => c.context !== 'review/quality-assurance');
    }],
    ['the route dropped', (d) => {
      const p = rule(ruleset(d, 'rc/next'), 'required_status_checks').parameters;
      p.required_status_checks = p.required_status_checks.filter((/** @type {any} */ c) => c.context !== 'review/route');
    }],
    ['a stale head accepted', (d) => { rule(ruleset(d, 'main'), 'required_status_checks').parameters.strict_required_status_checks_policy = false; }],
    ['evaluation mode', (d) => { ruleset(d, 'rc/next').enforcement = 'evaluate'; }],
    ['the pull request rule removed', (d) => { const rs = ruleset(d, 'main'); rs.rules = rs.rules.filter((/** @type {any} */ x) => x.type !== 'pull_request'); }],
    ['linear history required', (d) => { ruleset(d, 'rc/next').rules.push({ type: 'required_linear_history' }); }],
    ['a third ruleset', (d) => { d.rulesets.push(d.rulesets[0]); }],
    ['main missing', (d) => { d.rulesets = [ruleset(d, 'rc/next'), ruleset(d, 'rc/next')]; }],
    ['a branch excluded', (d) => { ruleset(d, 'main').conditions.ref_name.exclude = ['refs/heads/x']; }],
    ['a wildcard branch', (d) => { ruleset(d, 'main').conditions.ref_name.include = ['~ALL']; }],
  ];
  for (const [name, weaken] of weakenings) {
    const d = doc();
    weaken(d);
    assert.notDeepEqual(findings(d), [], name);
  }
});

test('every required context is a check something here posts, from GitHub Actions where it can be pinned', () => {
  const d = doc();
  const rc = contexts(ruleset(d, 'rc/next'));
  const main = contexts(ruleset(d, 'main'));
  assert.deepEqual(rc, ['delivery-ci', 'scan', 'docs-baseline', 'semver-label', 'SonarCloud Code Analysis', ...Object.values(CONTEXT)]);
  assert.deepEqual(main, rc.filter((c) => c !== CONTEXT.lens), 'the release candidate is not lens-gated, as the removed route did not gate it');
  for (const rs of d.rulesets) {
    for (const c of rule(rs, 'required_status_checks').parameters.required_status_checks) {
      if (c.context === 'SonarCloud Code Analysis') assert.equal(c.integration_id, undefined, 'the SonarCloud app id is not pinned');
      else assert.equal(c.integration_id, ACTIONS, c.context);
    }
  }
  // Each Actions context is a job of a workflow that runs on pull requests into both delivery branches.
  /** @type {Record<string, string>} */
  const job = { 'delivery-ci': 'tests.yml', scan: 'outbound-scan.yml', 'docs-baseline': 'docs-baseline.yml', 'semver-label': 'semver-label.yml' };
  for (const [context, file] of Object.entries(job)) {
    const wf = read('.github/workflows/' + file);
    assert.match(wf, new RegExp('^ {2}' + (context === 'scan' ? 'scan' : context) + ':$', 'm'), context);
    const trigger = /^ {2}pull_request:\n(?: {4}branches: \[([^\]]*)\]\n)?/m.exec(wf);
    assert.ok(trigger, file + ' runs on pull requests');
    if (trigger[1] !== undefined) for (const b of ['main', 'rc/next']) assert.ok(trigger[1].split(', ').includes(b), file + ' on ' + b);
  }
});

test('main keeps the one admin bypass the version workflow\'s bump push needs; rc/next has none', () => {
  const d = doc();
  assert.deepEqual(ruleset(d, 'rc/next').bypass_actors, []);
  assert.deepEqual(ruleset(d, 'main').bypass_actors, [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }]);
  assert.match(read('.github/workflows/version-main.yml'), /git push --atomic origin HEAD:main/);
});
