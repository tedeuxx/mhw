// mhw check as a command (#494, S23 of #470): its arguments, where the overlay travels, the --project section
// and its fail-closed exit, and which implementation each platform reaches. Throwaway HOMEs only; the
// prerequisites section reads an empty declaration so nothing on this machine's PATH is probed.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as check from '../../src/commands/check.js';
import * as ma from '../../src/lib/merge-authority.js';
import { throwawayHome } from '../helpers/home.js';
import { CORRECTED_SECTION, brief } from './briefs.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = fs.readFileSync(path.join(REPO, 'method', 'skills', 'merge-authority', 'SKILL.md'), 'utf8');

describe('arguments', () => {
  /** @type {import('../helpers/home.js').Home} */
  let h;
  beforeEach(() => { h = throwawayHome('check-args'); });
  afterEach(() => h.cleanup());

  test('an unknown argument or a bad overlay is a usage error, before anything runs', () => {
    /** @type {Array<[string[], string]>} */
    const cases = [[['--bogus'], 'mhw: unknown argument for check: --bogus'], [['--verbose'], 'mhw: unknown argument for check: --verbose'],
      [['--project'], 'mhw: unknown argument for check: --project'], [['--overlay=/nonexistent/s23'], "mhw: --overlay takes 'none' or an existing directory"],
      [['--overlay=-x'], "mhw: --overlay takes 'none' or an existing directory"], [['--overlay='], "mhw: --overlay takes 'none' or an existing directory"]];
    for (const [argv, msg] of cases) {
      /** @type {string[]} */
      const err = [];
      /** @type {string[]} */
      const out = [];
      assert.equal(check.main(argv, h.env, { cwd: h.dir, out: (l) => out.push(l), err: (l) => err.push(l) }), 2, argv.join(' '));
      assert.deepEqual(err, [msg]);
      assert.deepEqual(out, []);
    }
  });

  test('the overlay travels in the environment, never in an installer\'s argv', () => {
    const dir = path.join(h.dir, 'prof');
    fs.mkdirSync(dir);
    const p = check.parse(['--overlay=prof', '--prerequisites', '--project=x'], h.env, h.dir);
    assert.ok(p.err === undefined);
    assert.equal(p.child.WORKSTATION_OVERLAY, fs.realpathSync(dir));
    assert.equal(p.prerequisitesOnly, true);
    assert.equal(p.project, 'x');
    const none = check.parse(['--overlay=none'], h.env, h.dir);
    const unset = check.parse([], h.env, h.dir);
    assert.ok(none.err === undefined && unset.err === undefined);
    assert.equal(none.child.WORKSTATION_OVERLAY, 'none');
    assert.equal(unset.child.WORKSTATION_OVERLAY, undefined);
    for (const args of [check.userCheck(['--check', '--hooks=user'], p.child)[1],
      check.installer('install-managed.sh', ['--check'], '--root=', p.child)]) {
      assert.ok(!args.some((a) => a.includes('overlay') || a.includes('prof')), args.join(' '));
    }
    assert.deepEqual(check.installer('install-managed.sh', ['--check'], '--root=', { WORKSTATION_MANAGED_ROOT: '/r' }).slice(-2), ['--check', '--root=/r']);
  });
});

describe('the --project section', { skip: process.platform === 'win32' && 'mhw check is install.ps1 -Check on Windows; the --project section is POSIX only' }, () => {
  /** @type {import('../helpers/home.js').Home} */
  let h;
  /** @type {string} */
  let project;
  /** @type {Record<string, string>} */
  let env;
  beforeEach(() => {
    h = throwawayHome('check-project');
    project = path.join(h.dir, 'project');
    fs.mkdirSync(project);
    fs.writeFileSync(path.join(project, 'AGENTS.md'), brief(CORRECTED_SECTION));
    for (const [, p] of ma.installedSkillPaths(h.home)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '---\nmanaged-by: x\n---\n' + SKILL);
    }
    const empty = path.join(h.dir, 'empty.json');
    fs.writeFileSync(empty, '{"lanes": {}, "items": []}');
    env = { ...h.env, WORKSTATION_PREREQUISITES: empty, PATH: '/usr/bin:/bin' };
  });
  afterEach(() => h.cleanup());

  /** @param {string[]} extra */
  const run = (...extra) => {
    const p = spawnSync(process.execPath, [path.join(REPO, 'bin', 'mhw.js'), 'check', '--prerequisites', '--overlay=none', ...extra], { env, cwd: h.dir, encoding: 'utf8' });
    return { code: p.status, out: p.stdout, err: p.stderr };
  };

  test('green, then a finding is exit 1, and the prerequisites section still prints first', () => {
    let r = run('--project=' + project);
    assert.equal(r.code, 0, r.out + r.err);
    assert.match(r.out, /^PREREQ {2}0 required item\(s\) missing; check-only, nothing was applied\nPROJECT merge authority: OK \(contract v\d+\)\n$/m);
    fs.writeFileSync(path.join(project, 'AGENTS.md'), brief(CORRECTED_SECTION.replace('- loop-model:', '- executor: owner\n- loop-model:')));
    r = run('--project=' + project);
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^PROJECT merge authority: FAIL executor override/m);
  });

  test('installed contract copies that disagree fail closed: exit 2', () => {
    const [[, claude], , [, kiro]] = ma.installedSkillPaths(h.home);
    fs.writeFileSync(kiro, fs.readFileSync(kiro, 'utf8').replace(/"version": (\d+)/, (_, v) => '"version": ' + (Number(v) + 1)));
    let r = run('--project=' + project);
    assert.equal(r.code, 2, r.out + r.err);
    assert.match(r.out, /^PROJECT merge authority: CANNOT VALIDATE \(fail closed\): the installed copies of the contract disagree \(Claude Code and Kiro\); run `mhw install --method`/m);
    // The mutation is the subject's: restored, the same check is green.
    fs.writeFileSync(kiro, fs.readFileSync(claude, 'utf8'));
    r = run('--project=' + project);
    assert.equal(r.code, 0, r.out + r.err);
  });

  test('no installed copy fails closed, and so does a project that is not a directory', () => {
    for (const [, p] of ma.installedSkillPaths(h.home)) fs.rmSync(p);
    let r = run('--project=' + project);
    assert.equal(r.code, 2);
    assert.match(r.out, /CANNOT VALIDATE \(fail closed\): no installed copy/);
    r = run('--project=' + path.join(h.dir, 'missing'));
    assert.equal(r.code, 2);
    assert.ok(r.out.includes('PROJECT ' + path.join(h.dir, 'missing') + ' is not a directory\n'));
  });

  test('the largest exit wins: a missing required prerequisite (1) under a fail-closed project (2) is 2', () => {
    const decl = path.join(h.dir, 'decl.json');
    fs.writeFileSync(decl, JSON.stringify({ lanes: {}, items: [{ id: 'x', name: 'x', category: 'c', required: 'required', manual: 'm', presence: { commands: ['codex'] } }] }));
    env.WORKSTATION_PREREQUISITES = decl;
    let r = run('--project=' + project);
    assert.equal(r.code, 1, r.out);
    for (const [, p] of ma.installedSkillPaths(h.home)) fs.rmSync(p);
    r = run('--project=' + project);
    assert.equal(r.code, 2, r.out);
  });
});

describe('where mhw check runs', () => {
  test('./mhw is the Node command (#495), and the Python check is gone', () => {
    const launcher = fs.readFileSync(path.join(REPO, 'mhw'), 'utf8').replaceAll('\r\n', '\n');
    assert.match(launcher, /^#!\/usr\/bin\/env node\n/);
    assert.match(launcher, /^import '\.\/bin\/mhw\.js';$/m);
    for (const gone of ['workstation.py', 'prerequisites.py', 'prerequisites_test.py', 'merge_authority.py', 'merge_authority_test.py']) {
      assert.ok(!fs.existsSync(path.join(REPO, 'global', gone)), gone);
    }
  });

});
