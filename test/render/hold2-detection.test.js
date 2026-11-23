// The gate's hold 2 repository test (mhw#574). The quality-assurance brief tells the gate which class of
// paths owes an agents-lead marker by asking which kind of repository it is in, with two `git ls-tree`
// calls. Until #574 those calls looked only for the retired plugin's manifest, which the method
// repository does not have, so a method diff classified as a consuming repository. This suite runs the
// two calls AS WRITTEN IN THE BRIEF against throwaway repositories, so reverting the brief to the
// manifest-only test turns it red. It measures the commands the brief prints, never whether a gate
// session follows them.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT, tempDir } from '../helpers/method-home.js';

const BRIEF = path.join(ROOT, 'method', 'agents', 'quality-assurance.md');

/** The two `ls-tree` lines of hold 2's repository test, read from the brief. */
function detectionCalls() {
  const lines = fs.readFileSync(BRIEF, 'utf8').split('\n').map((l) => l.trim());
  const calls = lines.filter((l) => /^git -C <repo> ls-tree --name-only (origin\/main|<headRefOid>) -- /.test(l));
  assert.equal(calls.length, 2, 'hold 2 states exactly one trunk call and one head call:\n' + calls.join('\n'));
  assert.ok(calls[0].includes(' origin/main '), calls[0]);
  assert.ok(calls[1].includes(' <headRefOid> '), calls[1]);
  return calls;
}

/** @param {string[]} args @param {string} [cwd] */
function git(args, cwd) {
  return spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd, encoding: 'utf8', env: { PATH: process.env.PATH || '', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' } });
}

/** A throwaway repository holding `files`, with `origin/main` at its one commit. @param {string} label @param {string[]} files */
function repo(label, files) {
  const dir = tempDir('hold2-' + label);
  assert.equal(git(['init', '-q', dir]).status, 0);
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'x\n');
  }
  assert.equal(git(['-C', dir, 'add', '-A']).status, 0);
  assert.equal(git(['-C', dir, 'commit', '-q', '-m', 'seed']).status, 0);
  const head = git(['-C', dir, 'rev-parse', 'HEAD']).stdout.trim();
  assert.equal(git(['-C', dir, 'update-ref', 'refs/remotes/origin/main', head]).status, 0);
  return { dir, head };
}

/** Run one brief call against `r`, with `<headRefOid>` replaced by `head`. @param {string} call @param {{dir: string}} r @param {string} head */
function run(call, r, head) {
  const words = call.replace('<repo>', r.dir).replace('<headRefOid>', head).split(/\s+/);
  assert.equal(words[0], 'git');
  return git(words.slice(1));
}

describe("hold 2's repository test (mhw#574)", () => {
  test('the method repository is recognised by a path it has', () => {
    const r = repo('method', ['method/agents/quality-assurance.md', 'src/x.js', 'global/y.conf']);
    for (const call of detectionCalls()) {
      const p = run(call, r, r.head);
      assert.equal(p.status, 0, call + '\n' + p.stderr);
      assert.equal(p.stdout.trim(), 'method/agents/quality-assurance.md', call);
    }
  });

  test('the retired plugin repository is still recognised, so its class does not narrow', () => {
    const r = repo('plugin', ['.claude-plugin/plugin.json', 'agents/quality-assurance.md']);
    for (const call of detectionCalls()) {
      const p = run(call, r, r.head);
      assert.equal(p.status, 0, call + '\n' + p.stderr);
      assert.equal(p.stdout.trim(), '.claude-plugin/plugin.json', call);
    }
  });

  test('a consuming repository prints nothing and exits 0, so it keeps the harness-path class', () => {
    const r = repo('consumer', ['apps/fed/src/main.ts', 'AGENTS.md', '.claude/settings.json', 'docs/adr/README.md', 'agents/x.md']);
    for (const call of detectionCalls()) {
      const p = run(call, r, r.head);
      assert.equal(p.status, 0, call + '\n' + p.stderr);
      assert.equal(p.stdout, '', call);
    }
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
