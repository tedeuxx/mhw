// The carry-forward's history against the two fail-open classes QA (B2, B3) and the lens (round 1) found
// on PR #508: a path git C-quotes, and a criss-cross history. B2 is table-driven through the synthetic
// git, which C-quotes as git does without -z; B3 is a real git repository with pinned dates.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import * as d from '../../src/commands/delivery.js';
import { HEAD, OLD_HEAD, gate, lens, cases } from '../helpers/delivery-cases.js';
import { inProcess } from '../helpers/delivery-run.js';
import { quotePath } from '../helpers/delivery-fake.js';
import { toolRunner } from '../../src/lib/gh.js';
import { which } from '../helpers/home.js';

// QA B2's rows: every harness path git would C-quote, and a non-harness control.
const QUOTED_HARNESS = ['.github/workflows/dé.yml', 'dé/AGENTS.md', '.claude/a"b.md', '.kiro/a\tb.md'];
const CONTROL = 'docs/é.md';

/** @param {{ calls: string[][] }} r */
const merged = (r) => r.calls.some((c) => c[1] === 'pr' && c[2] === 'merge');

test('the synthetic git C-quotes these paths without -z, as git does', () => {
  assert.equal(quotePath('.github/workflows/dé.yml'), '".github/workflows/d\\303\\251.yml"');
  for (const p of [...QUOTED_HARNESS, CONTROL]) assert.ok(quotePath(p).startsWith('"'), p);
  assert.equal(quotePath('docs/x.md'), 'docs/x.md');
});

test('B2, hold-2 trigger: each C-quotable harness path requires the lens; the control does not', () => {
  const c = cases().find((x) => x.name === 'slice-merge-is-a-pinned-merge-commit');
  assert.ok(c);
  for (const p of QUOTED_HARNESS) {
    const r = inProcess({ ...c, scenario: { ...c.scenario, changed: ['docs/x.md', p] } });
    assert.equal(r.stderr, 'PENDING: harness paths changed and no agents-lead lens marker is on the PR\n', JSON.stringify(p));
    assert.ok(!merged(r));
  }
  const ok = inProcess({ ...c, scenario: { ...c.scenario, changed: ['docs/x.md', CONTROL] } });
  assert.equal(ok.code, 0, ok.stderr);
});

test('B2, limb (c): each C-quotable harness path in the delta refuses the carry; the control carries', () => {
  const c = cases().find((x) => x.name === 'harness-lens-closed-merges');
  assert.ok(c);
  /** @param {string[]} delta */
  const run = (delta) => inProcess({ ...c, scenario: { ...c.scenario,
    pr: { ...c.scenario.pr, comments: [gate(), lens({ commit: OLD_HEAD })] },
    ancestors: { [OLD_HEAD]: 0 }, mergeBases: { [OLD_HEAD]: 'e'.repeat(40), [HEAD]: 'e'.repeat(40) },
    deltas: { [OLD_HEAD]: delta } } });
  for (const p of QUOTED_HARNESS) {
    const r = run(['src/x.js', p]);
    assert.match(r.stderr, /\(c\) the delta since its commit touches a harness path: /, JSON.stringify(p));
    assert.ok(!merged(r));
  }
  assert.equal(run(['src/x.js', CONTROL]).code, 0);
});

/**
 * A throwaway repository with a criss-cross history (QA B3), every commit at a pinned date:
 *   R; trunk C adds .github/c.yml; side A edits docs; rc/next = merge(C, A).
 *   The PR starts at A, the lens is marked at P1, then P2 merges C and deletes .github/c.yml.
 * The marker's merge-bases with rc/next are {A}; the head's are {A, C}. The delta P1..P2 is empty, so
 * only limb (b) can refuse, and only when it reads every merge-base.
 * @param {string} git
 */
function crissCross(git) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-test-crisscross-')));
  let t = 1700000000;
  /** @param {string[]} args */
  const g = (...args) => {
    t += 60;
    const date = '@' + t + ' +0000';
    const env = { PATH: process.env.PATH || '', HOME: dir, GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date,
      GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };
    const p = spawnSync(git, ['-C', dir, '-c', 'commit.gpgsign=false', ...args], { encoding: 'utf8', env });
    assert.equal(p.status, 0, args.join(' ') + ': ' + p.stderr);
    return p.stdout.trim();
  };
  /** @param {string} rel @param {string} text */
  const write = (rel, text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  g('init', '-q', '-b', 'trunk');
  write('README.md', 'r\n');
  g('add', '.');
  g('commit', '-q', '-m', 'R');
  const R = g('rev-parse', 'HEAD');
  write('.github/c.yml', 'c\n');
  g('add', '.');
  g('commit', '-q', '-m', 'C');
  const C = g('rev-parse', 'HEAD');
  g('checkout', '-q', '-b', 'side', R);
  write('docs/a.md', 'a\n');
  g('add', '.');
  g('commit', '-q', '-m', 'A');
  const A = g('rev-parse', 'HEAD');
  g('checkout', '-q', 'trunk');
  g('merge', '-q', '--no-ff', '-m', 'trunk merges A', A);
  g('update-ref', 'refs/remotes/origin/rc/next', 'HEAD');
  g('checkout', '-q', '-b', 'pr', A);
  write('docs/p.md', 'p\n');
  g('add', '.');
  g('commit', '-q', '-m', 'P1: the lens is marked here');
  const P1 = g('rev-parse', 'HEAD');
  g('merge', '-q', '--no-ff', '--no-commit', C);
  g('rm', '-q', '-f', '.github/c.yml');
  g('commit', '-q', '-m', 'P2: merge C and delete .github/c.yml');
  const P2 = g('rev-parse', 'HEAD');
  return { dir, A, C, P1, P2, git: g, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

test('B3: in a criss-cross history limb (b) refuses, because the merge-base sets differ', { skip: !which('git') && 'no git' }, () => {
  const h = crissCross(/** @type {string} */ (which('git')));
  try {
    // The fixture is what it claims: plain merge-base names the same base for both, --all does not.
    assert.equal(h.git('merge-base', 'origin/rc/next', h.P1), h.A);
    assert.equal(h.git('merge-base', 'origin/rc/next', h.P2), h.A, 'plain merge-base hides C');
    assert.deepEqual(h.git('merge-base', '--all', 'origin/rc/next', h.P2).split('\n').sort(), [h.A, h.C].sort());
    assert.equal(h.git('diff', '--name-only', h.P1, h.P2), '', 'the delta is empty');
    const history = d.gitHistory(toolRunner(h.dir, process.env, process.platform), 'rc/next');
    assert.equal(history.isAncestor(h.P1, h.P2), 0);
    assert.deepEqual(history.delta(h.P1, h.P2), []);
    assert.equal(d.carryForward(h.P1, h.P2, history), '(b) the merge-base with rc/next moved since its commit');
  } finally {
    h.cleanup();
  }
});

test('the real history reads a C-quotable harness path whole, through -z', { skip: !which('git') && 'no git' }, () => {
  const h = crissCross(/** @type {string} */ (which('git')));
  try {
    fs.mkdirSync(path.join(h.dir, '.github', 'workflows'), { recursive: true });
    fs.writeFileSync(path.join(h.dir, '.github', 'workflows', 'dé.yml'), 'x\n');
    h.git('add', '.');
    h.git('commit', '-q', '-m', 'P3');
    const P3 = h.git('rev-parse', 'HEAD');
    const history = d.gitHistory(toolRunner(h.dir, process.env, process.platform), 'rc/next');
    assert.deepEqual(history.delta(h.P2, P3), ['.github/workflows/dé.yml']);
    assert.match(String(d.carryForward(h.P2, P3, history)), /\(c\) .*: \.github\/workflows\/dé\.yml$/);
  } finally {
    h.cleanup();
  }
});
