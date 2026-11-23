// The gate's hold 2 (mhw#574). The quality-assurance brief tells the gate which class of paths owes an
// agents-lead marker by asking which kind of repository it is in, then selects the PR's paths of that
// class. Until #574 the repository test looked only for the retired plugin's manifest, which the method
// repository does not have, and every command of the hold compared against origin/main, although slices
// in the method repository merge into rc/next. Owner rulings on PR #586 (2026-11-23): a method repository
// is one carrying, at its root, method/agents/quality-assurance.md (mhw) or .claude-plugin/plugin.json (the
// plugin mirror, tadeumendonca-skills), both under the strict class; and compare against the PR's own base. This suite runs the
// commands AS WRITTEN IN THE BRIEF against throwaway repositories, so reverting either change turns it
// red. It measures the commands the brief prints, never whether a gate session follows them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, tempDir } from '../helpers/method-home.js';

const BRIEF = path.join(ROOT, 'method', 'agents', 'quality-assurance.md');
const BASE = 'rc/next';
const ENV = { PATH: process.env.PATH || '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid' };

const briefLines = () => fs.readFileSync(BRIEF, 'utf8').split('\n').map((l) => l.trim());

/** The two `ls-tree` lines of hold 2's repository test, read from the brief. */
function detectionCalls() {
  const calls = briefLines().filter((l) => /^git -C <repo> ls-tree --name-only \S+ -- /.test(l));
  assert.equal(calls.length, 2, 'hold 2 states exactly one base call and one head call:\n' + calls.join('\n'));
  assert.ok(calls[1].includes(' <headRefOid> '), calls[1]);
  return calls;
}

/**
 * A class selector of hold 2, its two lines joined, read from the brief: the method repository's
 * exclusion-list selector (`| grep -vE `) or the consuming repository's harness-path one (`| grep -E `).
 * @param {string} grep
 */
function selector(grep) {
  const lines = briefLines();
  const i = lines.findIndex((l, k) => /^git -C <repo> diff --no-renames --name-only \S+\.\.\.<headRefOid> \\$/.test(l)
    && (lines[k + 1] || '').startsWith(grep));
  assert.ok(i >= 0, 'the selector piping into ' + grep + ' is in the brief');
  return lines[i].replace(/\\$/, '') + lines[i + 1];
}
const methodSelector = () => selector('| grep -vE ');
const consumerSelector = () => selector("| grep -E '(^|/)");

/** @param {string[]} args @param {string} [cwd] */
function git(args, cwd) {
  return spawnSync('git', ['-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8', env: ENV });
}

/** @param {string} dir @param {string[]} files @param {string} msg */
function commit(dir, files, msg) {
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), msg + '\n');
  }
  assert.equal(git(['-C', dir, 'add', '-A']).status, 0);
  assert.equal(git(['-C', dir, 'commit', '-q', '-m', msg]).status, 0);
  return git(['-C', dir, 'rev-parse', 'HEAD']).stdout.trim();
}

/** A throwaway repository holding `files`, with origin/main and origin/<BASE> at its one commit. @param {string} label @param {string[]} files */
function repo(label, files) {
  const dir = tempDir('hold2-' + label);
  assert.equal(git(['init', '-q', dir]).status, 0);
  const head = commit(dir, files, 'seed');
  for (const ref of ['refs/remotes/origin/main', 'refs/remotes/origin/' + BASE]) assert.equal(git(['-C', dir, 'update-ref', ref, head]).status, 0);
  return { dir, head };
}

/** Fill the brief's placeholders. @param {string} cmd @param {string} dir @param {string} head */
const fill = (cmd, dir, head) => cmd.replaceAll('<repo>', dir).replaceAll('<headRefOid>', head).replaceAll('<base>', BASE);

/** Run one `ls-tree` call of the brief against `r`. @param {string} call @param {{dir: string}} r @param {string} head */
function run(call, r, head) {
  const words = fill(call, r.dir, head).split(/\s+/);
  assert.equal(words[0], 'git');
  return git(words.slice(1));
}

/** @param {string} label @param {string[]} files */
function detects(label, files) {
  const r = repo(label, files);
  return detectionCalls().map((call) => {
    const p = run(call, r, r.head);
    assert.equal(p.status, 0, call + '\n' + p.stderr);
    return p.stdout;
  });
}

describe("hold 2's repository test (mhw#574)", () => {
  test('the method repository is recognised by a path it has', () => {
    for (const out of detects('method', ['method/agents/quality-assurance.md', 'src/x.js', 'global/y.conf'])) {
      assert.equal(out.trim(), 'method/agents/quality-assurance.md');
    }
  });

  test('the plugin mirror (a root manifest) is a method repository too', () => {
    for (const out of detects('plugin', ['.claude-plugin/plugin.json', 'agents/quality-assurance.md'])) {
      assert.equal(out.trim(), '.claude-plugin/plugin.json');
    }
  });

  test('a consuming repository prints nothing and exits 0, so it keeps the harness-path class', () => {
    for (const out of detects('consumer', ['apps/fed/src/main.ts', 'AGENTS.md', '.claude/settings.json', 'docs/adr/README.md', 'agents/x.md'])) {
      assert.equal(out, '');
    }
  });

  test('a nested manifest or method path does not make a consumer the method repository', () => {
    // Anchored at the root: tadeumendonca-io tracks apps/fed/scripts/__fixtures__/*/.claude-plugin/plugin.json.
    for (const out of detects('nested', ['apps/fed/scripts/__fixtures__/a/.claude-plugin/plugin.json',
      'vendor/x/method/agents/quality-assurance.md', 'AGENTS.md'])) assert.equal(out, '');
  });

  test('an unreadable ref fails, so the repository stays unclassified and the union applies', () => {
    const r = repo('badref', ['method/agents/quality-assurance.md']);
    const p = run(detectionCalls()[1], r, 'nosuchref');
    assert.notEqual(p.status, 0, 'an unreadable head must not read as "consuming repository"');
    assert.equal(p.stdout, '');
    const brief = fs.readFileSync(BRIEF, 'utf8');
    assert.ok(brief.includes('**Either call fails** (a non-zero exit — an unreadable ref) → you have NOT classified the'));
    assert.ok(brief.includes('UNION of both classes'));
  });
});

describe("hold 2 compares against the PR's own base (mhw#574)", () => {
  test('the brief reads the base, and fails closed when it cannot', () => {
    const brief = fs.readFileSync(BRIEF, 'utf8');
    assert.ok(brief.includes('gh pr view <n> --repo <owner/repo> --json baseRefName --jq .baseRefName'));
    assert.ok(brief.includes('this hold — so HOLD 2 APPLIES:** a marker whose `commit:` line names the `headRefOid` is'));
    assert.ok(briefLines().includes('git -C <repo> fetch origin <base> "pull/<n>/head"'));
  });

  test('the carry-forward base checks read the base', () => {
    const mb = briefLines().filter((l) => /^git -C <repo> merge-base --all /.test(l));
    assert.equal(mb.length, 2, mb.join('\n'));
    for (const l of mb) assert.ok(l.startsWith('git -C <repo> merge-base --all origin/<base> '), l);
  });

  test("a consumer slice into an integration branch owes nothing for the branch's own harness paths", () => {
    // main is behind the integration branch by a workflow change; the slice changes application code only.
    const dir = tempDir('hold2-cbase');
    assert.equal(git(['init', '-q', '-b', 'main', dir]).status, 0);
    const m = commit(dir, ['apps/fed/src/main.ts', 'AGENTS.md'], 'seed');
    assert.equal(git(['-C', dir, 'update-ref', 'refs/remotes/origin/main', m]).status, 0);
    const rc = commit(dir, ['.github/workflows/app.yml'], 'rc');
    assert.equal(git(['-C', dir, 'update-ref', 'refs/remotes/origin/' + BASE, rc]).status, 0);
    const head = commit(dir, ['apps/fed/src/page.ts'], 'slice');
    const p = spawnSync('sh', ['-c', fill(consumerSelector(), dir, head)], { encoding: 'utf8', env: ENV });
    assert.ok(p.status === 0 || p.status === 1, p.stderr);
    assert.equal(p.stdout, '', 'an application-only slice owes no marker; got:\n' + p.stdout);
    // Calibration: the same selector over the slice's own workflow change does print it.
    const head2 = commit(dir, ['.github/workflows/slice.yml'], 'slice2');
    const q = spawnSync('sh', ['-c', fill(consumerSelector(), dir, head2)], { encoding: 'utf8', env: ENV });
    assert.equal(q.stdout.trim(), '.github/workflows/slice.yml');
  });

  test("a slice into an integration branch owes nothing for the branch's own unreleased paths", () => {
    // main is behind rc/next by a src/ change; the slice, cut from rc/next, changes docs only.
    const dir = tempDir('hold2-base');
    assert.equal(git(['init', '-q', '-b', 'main', dir]).status, 0);
    const m = commit(dir, ['method/agents/quality-assurance.md', 'README.md'], 'seed');
    assert.equal(git(['-C', dir, 'update-ref', 'refs/remotes/origin/main', m]).status, 0);
    const rc = commit(dir, ['src/unreleased.js'], 'rc');
    assert.equal(git(['-C', dir, 'update-ref', 'refs/remotes/origin/' + BASE, rc]).status, 0);
    const head = commit(dir, ['docs/note.md'], 'slice');
    const p = spawnSync('sh', ['-c', fill(methodSelector(), dir, head)], { encoding: 'utf8', env: ENV });
    assert.ok(p.status === 0 || p.status === 1, p.stderr);
    assert.equal(p.stdout, '', 'a docs-only slice owes no marker; got:\n' + p.stdout);
    // Calibration: the same selector over the slice's own src/ change does print it.
    const head2 = commit(dir, ['src/slice.js'], 'slice2');
    const q = spawnSync('sh', ['-c', fill(methodSelector(), dir, head2)], { encoding: 'utf8', env: ENV });
    assert.equal(q.stdout.trim(), 'src/slice.js');
  });
});
