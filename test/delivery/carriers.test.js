// The repository-content cases of the deleted workspace/delivery_test.py (#474), unchanged in what they
// assert, plus what the move adds: the carriers name `./mhw delivery`, no live instruction names the
// Python route, the launcher routes the command to Node, and the real tests workflow parses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { testsJobs } from '../../src/commands/delivery.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
/** @param {string} rel */
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));
/** @param {string} rel */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
/** Whitespace collapsed, as the old suite's " ".join(text.split()). @param {string} rel */
const flat = (rel) => read(rel).split(/\s+/).filter(Boolean).join(' ');

test('the delivery-ci job list is read from the real tests workflow', () => {
  assert.deepEqual(testsJobs(ROOT), ['shellcheck', 'profiles', 'suites', 'node', 'git-route', 'windows',
    'isolation-smoke', 'prod-canary-installed-not-enforced']);
});

test('no session-type intake is registered anywhere (Issue #60)', () => {
  assert.ok(!exists('workspace/startup.py'));
  assert.ok(!exists('.claude/commands/session-start.md'));
  assert.ok(!exists('.agents/skills/source-command-session-start'));
  for (const file of ['.claude/settings.json', '.claude/settings.local.json', '.codex/hooks.json']) {
    if (!exists(file)) continue;
    const hooks = JSON.parse(read(file)).hooks || {};
    assert.ok(!('SessionStart' in hooks), file);
    assert.ok(!JSON.stringify(hooks).includes('startup.py'), file);
  }
  const policy = JSON.parse(read('workspace/session-policy.json'));
  assert.deepEqual(Object.keys(policy).filter((k) => k.startsWith('entry_')), []);
  assert.equal(policy.integration_branch, 'rc/next');
  // #133 (owner decision 2026-11-01): his comment is the go, the gate executes the release merge.
  assert.equal(policy.release_merge, 'quality-assurance-on-owner-comment');
  for (const carrier of ['AGENTS.md', 'global/AGENTS.md', 'workspace/README.md', '.kiro/steering/workspace-session.md',
    'overlay/AGENTS.md', 'overlay/desktop-instructions.md']) {
    for (const phrase of ['Melhoria de harness', 'Session type', 'improvement session']) {
      assert.ok(!flat(carrier).includes(phrase), carrier + ': ' + phrase);
    }
  }
});

test('the Kiro steering forbids inferring a session type', () => {
  const text = flat('.kiro/steering/workspace-session.md');
  assert.ok(text.startsWith('--- inclusion: always ---'));
  assert.ok(text.includes('Do not infer or announce a type for the session (bugfix or any other) from the task; this workspace has none.'));
});

test('the brief declares the personal sphere (ADR-0035 decision 1)', () => {
  const brief = read('AGENTS.md');
  const head = brief.split('\n## ')[0];
  assert.deepEqual(brief.match(/^sphere: .*$/gm), ['sphere: personal']);
  assert.match(head, /^sphere: personal$/m);
  assert.ok(head.split(/\s+/).join(' ').includes('stop-on-undeclared default is not adopted'));
});

test('AGENTS.md is the only root brief, under Codex\'s limit (ADR-0037)', () => {
  for (const name of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) assert.ok(!exists(name), name);
  const size = fs.statSync(path.join(ROOT, 'AGENTS.md')).size;
  assert.ok(size <= 30000, 'AGENTS.md is ' + size + " bytes; condense it before Codex's 32768");
  assert.ok(flat('AGENTS.md').includes('the root instruction file is `AGENTS.md` alone'));
});

test('the carriers state who merges (Issue #60)', () => {
  for (const carrier of ['AGENTS.md', 'workspace/README.md', '.kiro/steering/workspace-session.md']) {
    assert.ok(flat(carrier).includes('rc/next'), carrier);
    assert.match(flat(carrier), /owner/i, carrier);
  }
});

test('the session-finish skill stays removed (PR #233)', () => {
  for (const rel of ['.claude/skills/session-finish', '.agents/skills/session-finish', '.kiro/skills/session-finish',
    '.claude/commands/session-finish.md', '.agents/skills/source-command-session-finish']) {
    assert.ok(!exists(rel), rel);
  }
  assert.ok(!flat('AGENTS.md').includes('/session-finish'));
  assert.ok(!flat('AGENTS.md').includes('$session-finish'));
});

test('the carriers route slices through mhw delivery, never a hand merge', () => {
  for (const carrier of ['workspace/README.md', 'AGENTS.md', '.kiro/steering/workspace-session.md']) {
    assert.ok(flat(carrier).includes('./mhw delivery merge --pr'), carrier);
    assert.ok(!flat(carrier).includes('gh pr merge NUMBER'), carrier);
  }
  assert.ok(!exists('workspace/delivery.py'));
  assert.ok(!exists('workspace/delivery_test.py'));
  assert.ok(!read('overlay/allow-list.conf').includes('delivery_test.py'));
});

test('no live instruction names the Python route: every remaining mention is struck', { skip: !which('git') && 'no git' }, () => {
  const git = /** @type {string} */ (which('git'));
  const p = spawnSync(git, ['-C', ROOT, 'grep', '-n', '-F', 'python3 -B workspace/delivery.py'], { encoding: 'utf8' });
  assert.ok(p.status === 0 || p.status === 1, p.stderr);
  const live = p.stdout.split('\n').filter(Boolean).filter((l) => !l.includes('~~`python3 -B workspace/delivery.py'))
    .filter((l) => !l.startsWith('test/delivery/carriers.test.js:'));
  assert.deepEqual(live, []);
});

test('./mhw routes delivery to Node, and the CLI answers it on the Windows mapping too', { skip: process.platform === 'win32' && './mhw is the POSIX launcher' }, () => {
  const sh = spawnSync(path.join(ROOT, 'mhw'), ['delivery', '--help'], { encoding: 'utf8', env: { PATH: path.dirname(process.execPath) + ':/usr/bin:/bin' } });
  assert.equal(sh.status, 0, sh.stderr);
  assert.equal(sh.stdout, 'usage: mhw delivery {merge,verify} --pr N\n');
  const win = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'delivery', 'nope'], { encoding: 'utf8', env: { ...process.env, WORKSTATION_LAUNCHER_PLATFORM: 'win32' } });
  assert.equal(win.status, 2);
  assert.match(win.stderr, /invalid choice: 'nope'/);
});
