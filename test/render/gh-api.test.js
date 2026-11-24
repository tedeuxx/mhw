// The baseline's gh api rule set (Issue #593, ADR-0048), end to end in throwaway homes: the allow-list step
// renders global/gh-api.conf (passed with --gh-api) into ~/.claude/settings.json, the Codex rules file and the Kiro agent, and each
// rendered file is evaluated with a model of its harness's matcher (test/helpers/harness-rules.js). Codex's
// own instrument, `codex execpolicy check`, runs beside the model when codex is on PATH. The retirement of
// the owner's hand-kept "Bash(gh api:*)" deny and its restore on uninstall run in throwaway homes too.
//
// The expected table names, per harness, what a prefix rule cannot separate: those rows are the residuals
// ADR-0048 states ("What the rules hold, and what they do not"), and a change that closes or widens one
// turns this test red until the record and the table move together.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fields } from '../../src/render/allow-list.js';
import * as ghApi from '../../src/render/gh-api.js';
import { claudeDecision, codexRulesOf, codexDecision, kiro2Decision, kiroV3Decision } from '../helpers/harness-rules.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'src', 'render', 'allow-list.js');
const STAMP = 'release: v9.9.9; commit: ' + 'a'.repeat(40);
const POSIX = process.platform !== 'win32';
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));
const SOURCE = path.join(ROOT, 'global', 'gh-api.conf');
const gh = ghApi.rules(ghApi.parseSpec(fs.readFileSync(SOURCE, 'utf8')).spec);

/** @param {string} label */
function fresh(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-ghapi-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The repository floor's cmd entries, rendered the way install-user hands them to the step. @param {string} dir */
function floorFiles(dir) {
  const words = fs.readFileSync(path.join(ROOT, 'global', 'deny-floor.conf'), 'utf8').split('\n')
    .map((l) => fields(l.replace(/\r$/, ''))).filter((f) => f[0] === 'cmd').map((f) => f.slice(1).join(' '));
  fs.writeFileSync(path.join(dir, 'floor.codex'), words.join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'floor.claude'), words.map((w) => 'Bash(' + w + ':*)').join('\n') + '\n');
  return words;
}

/**
 * Run the allow-list step (or uninstall) against a throwaway home.
 * @param {string} T @param {{ phase?: string, mode?: string, gh?: boolean, source?: string }} [o]
 */
function run(T, o = {}) {
  const home = path.join(T, 'home');
  const settings = path.join(home, '.claude', 'settings.json');
  const args = o.phase === 'uninstall'
    ? ['--phase=uninstall', '--settings=' + settings, '--home=' + home]
    : ['--phase=step', '--mode=' + (o.mode || 'install'), '--stamp=' + STAMP, '--source=' + path.join(ROOT, 'global', 'allow-list.conf'),
      '--retired=' + path.join(ROOT, 'global', 'allow-retired.conf'), '--floor-codex=' + path.join(T, 'floor.codex'),
      '--floor-claude=' + path.join(T, 'floor.claude'), '--managed-root=' + path.join(T, 'no-admin'), '--settings=' + settings,
      '--home=' + home, '--repo-root=' + ROOT, ...(o.gh === false ? [] : ['--gh-api=' + (o.source || SOURCE)])];
  const p = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', env: { PATH: process.env.PATH || '', HOME: home, LANG: 'C' } });
  return { code: p.status, out: p.stdout, err: p.stderr, settings, home };
}

/** A throwaway home, optionally with a settings.json. @param {string} label @param {unknown} [doc] */
function home(label, doc) {
  const T = fresh(label);
  fs.mkdirSync(path.join(T, 'home', '.claude'), { recursive: true });
  floorFiles(T);
  if (doc !== undefined) fs.writeFileSync(path.join(T, 'home', '.claude', 'settings.json'), JSON.stringify(doc, null, 4) + '\n');
  return T;
}

const MS = 'repos/o/r/milestones';
// The commands, in the spellings the method skills use (sprint-planning, step 4a) and the ones they do not.
// Columns: Claude Code, Codex (none = no rule applies: the approval policy asks), Kiro CLI 2.x, Kiro V3.
/** @type {Array<[string, string, 'allow'|'deny'|'ask', 'allow'|'forbidden'|'none', 'allow'|'ask', 'allow'|'ask']>} */
const TABLE = [
  ['a milestone read', 'gh api ' + MS + '/3', 'allow', 'none', 'allow', 'allow'],
  ['the milestone list', 'gh api ' + MS + ' -X GET -f state=all -f per_page=100 --paginate', 'allow', 'none', 'allow', 'allow'],
  ['a milestone create', 'gh api ' + MS + ' -X POST -f title=sprint-07 -F description=@/s/body.md', 'allow', 'none', 'allow', 'allow'],
  ['a milestone update', 'gh api ' + MS + '/3 -X PATCH -F description=@/s/body.md', 'allow', 'none', 'allow', 'allow'],
  ['a milestone close', 'gh api ' + MS + '/3 -X PATCH -f state=closed', 'allow', 'none', 'allow', 'allow'],
  ['another read', 'gh api repos/o/r/branches/main/protection', 'ask', 'none', 'ask', 'ask'],
  ['another write, method first', 'gh api -X POST repos/o/r/issues -f title=x', 'deny', 'forbidden', 'ask', 'ask'],
  ['another write, --method= first', 'gh api --method=DELETE repos/o/r/git/refs/heads/x', 'deny', 'forbidden', 'ask', 'ask'],
  // Residuals ADR-0048 names: a prefix rule cannot separate these spellings.
  ['RESIDUAL another write, endpoint first: asked, not denied', 'gh api repos/o/r/issues -X POST -f title=x', 'ask', 'none', 'ask', 'ask'],
  ['RESIDUAL another write by -f alone (gh sends POST): asked', 'gh api repos/o/r/issues -f title=x', 'ask', 'none', 'ask', 'ask'],
  ['RESIDUAL a milestone write spelled method first: denied', 'gh api -X PATCH ' + MS + '/3 -f state=closed', 'deny', 'forbidden', 'ask', 'ask'],
  ['RESIDUAL a write whose text carries /milestones: the wildcard admits it', 'gh api repos/o/r/issues -f body=x/milestones -X POST', 'allow', 'none', 'ask', 'allow'],
];

test('the rendered gh api rule set, per harness, in a throwaway home (Claude Code and Kiro modelled; Codex modelled and, when present, measured)', () => {
  const T = home('table', { permissions: { deny: ['Bash(gh api:*)'] } });
  const r = run(T);
  assert.equal(r.code, 0, r.out + r.err);
  const perms = JSON.parse(fs.readFileSync(r.settings, 'utf8')).permissions;
  const rulesFile = path.join(r.home, '.codex', 'rules', 'workstation-allow-list.rules');
  const rules = codexRulesOf(fs.readFileSync(rulesFile, 'utf8'));
  const agent = JSON.parse(fs.readFileSync(path.join(r.home, '.kiro', 'agents', 'workstation.json'), 'utf8'));
  const codex = spawnSync('codex', ['--version'], { encoding: 'utf8' }).status === 0;
  for (const [name, cmd, claude, cx, k2, k3] of TABLE) {
    assert.equal(claudeDecision(perms, cmd), claude, 'Claude Code: ' + name);
    const tokens = cmd.split(' ');
    assert.equal(codexDecision(rules, tokens), cx, 'Codex model: ' + name);
    if (codex) {
      const m = spawnSync('codex', ['execpolicy', 'check', '--rules', rulesFile, ...tokens], { encoding: 'utf8' });
      assert.equal(m.status, 0, m.stderr);
      assert.equal(JSON.parse(m.stdout).decision ?? 'none', cx, 'Codex execpolicy check: ' + name);
    }
    assert.equal(kiro2Decision(agent, cmd), k2, 'Kiro CLI 2.x: ' + name);
    assert.equal(kiroV3Decision(agent, cmd), k3, 'Kiro V3: ' + name);
  }
  // Every method-first write spelling is denied in Claude Code and forbidden in Codex, on any endpoint.
  for (const w of gh.writePrefixes) {
    const cmd = w + ' repos/o/r/issues/1';
    assert.equal(claudeDecision(perms, cmd), 'deny', cmd);
    assert.equal(codexDecision(rules, cmd.split(' ')), 'forbidden', cmd);
  }
  assert.equal(gh.writePrefixes.length, 16);
});

test('the rule set is rendered in the narrow tier too, and nothing of it without --gh-api', () => {
  const T = home('tiers', {});
  const r = run(T);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^RISK /m, 'no admin floor: this is the narrow tier');
  const perms = JSON.parse(fs.readFileSync(r.settings, 'utf8')).permissions;
  for (const a of gh.claudeAllow) assert.ok(perms.allow.includes(a), a);
  for (const d of gh.claudeDeny) assert.ok(perms.deny.includes(d), d);
  const T2 = home('off', {});
  const r2 = run(T2, { gh: false });
  assert.equal(r2.code, 0, r2.out + r2.err);
  const text = fs.readFileSync(r2.settings, 'utf8') + fs.readFileSync(path.join(r2.home, '.codex', 'rules', 'workstation-allow-list.rules'), 'utf8')
    + fs.readFileSync(path.join(r2.home, '.kiro', 'agents', 'workstation.json'), 'utf8');
  assert.doesNotMatch(text, /gh api/, 'without the option nothing of the gh api rule set is rendered');
});

test('install retires the hand-kept Bash(gh api:*) deny with a backup; uninstall restores it', { skip: !POSIX && '0600 backups are POSIX here' }, () => {
  const before = { permissions: { deny: ['Bash(gh api:*)', 'Bash(rm -rf:*)'], allow: ['Bash(ls:*)'] }, other: 1 };
  const T = home('retire', before);
  const backup = path.join(T, 'home', '.claude', 'settings.json' + ghApi.BACKUP_SUFFIX);
  const original = fs.readFileSync(path.join(T, 'home', '.claude', 'settings.json'), 'utf8');

  let r = run(T, { mode: 'check' });
  assert.equal(r.code, 1);
  assert.match(r.out, /^DRIFT .*permissions\.deny Bash\(gh api:\*\) present -> absent/m);
  r = run(T, { mode: 'dry-run' });
  assert.match(r.out, /^WOULD CHANGE .*permissions\.deny Bash\(gh api:\*\) present -> absent/m);
  assert.ok(!fs.existsSync(backup), 'a dry run writes no backup');

  r = run(T);
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^CHANGED .*permissions\.deny Bash\(gh api:\*\) present -> absent/m);
  assert.equal(fs.readFileSync(backup, 'utf8'), original, 'the backup is the file as it was');
  assert.equal(fs.statSync(backup).mode & 0o777, 0o600);
  let doc = JSON.parse(fs.readFileSync(r.settings, 'utf8'));
  assert.ok(!doc.permissions.deny.includes('Bash(gh api:*)'));
  assert.ok(doc.permissions.deny.includes('Bash(rm -rf:*)'), 'the owner\'s other denies stay');
  assert.equal(doc.other, 1);
  assert.equal(claudeDecision(doc.permissions, 'gh api ' + MS + '/3 -X PATCH -f state=closed'), 'allow');

  r = run(T);
  assert.equal(r.code, 0);
  assert.match(r.out, /^OK .*no hand-kept Bash\(gh api:\*\) deny/m, 'a second install has nothing to retire');
  assert.equal(run(T, { mode: 'check' }).code, 0, 'check is clean after install');

  r = run(T, { phase: 'uninstall' });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^RESTORED .*permissions\.deny Bash\(gh api:\*\)/m);
  assert.ok(!fs.existsSync(backup), 'the backup leaves once the entry is back');
  doc = JSON.parse(fs.readFileSync(r.settings, 'utf8'));
  assert.ok(doc.permissions.deny.includes('Bash(gh api:*)'));
  assert.ok(doc.permissions.deny.includes('Bash(rm -rf:*)'));
  assert.ok(!(doc.permissions.allow || []).includes(gh.claudeAllow[0]), 'our milestone allow left');
  assert.equal(claudeDecision(doc.permissions, 'gh api ' + MS + '/3'), 'deny', 'after uninstall the broad deny holds again');
});

test('an existing backup is never overwritten: install refuses and leaves the entry', () => {
  const T = home('keep-backup', { permissions: { deny: ['Bash(gh api:*)'] } });
  const backup = path.join(T, 'home', '.claude', 'settings.json' + ghApi.BACKUP_SUFFIX);
  fs.writeFileSync(backup, 'an earlier backup\n');
  const r = run(T);
  assert.equal(r.code, 1, r.out + r.err);
  assert.match(r.err, /^REFUSE .*Bash\(gh api:\*\) left in permissions\.deny, because .* already exists and is never overwritten/m);
  assert.equal(fs.readFileSync(backup, 'utf8'), 'an earlier backup\n');
  assert.ok(JSON.parse(fs.readFileSync(r.settings, 'utf8')).permissions.deny.includes('Bash(gh api:*)'));
});

test('uninstall with a backup that holds no such entry leaves it and the settings alone', () => {
  const T = home('odd-backup', { permissions: { deny: ['Bash(x:*)'] } });
  const backup = path.join(T, 'home', '.claude', 'settings.json' + ghApi.BACKUP_SUFFIX);
  fs.writeFileSync(backup, '{"permissions": {"deny": []}}\n');
  const r = run(T, { phase: 'uninstall' });
  assert.equal(r.code, 0, r.out + r.err);
  assert.match(r.out, /^NOTE .*holds no Bash\(gh api:\*\) deny to restore/m);
  assert.ok(fs.existsSync(backup));
  assert.deepEqual(JSON.parse(fs.readFileSync(r.settings, 'utf8')).permissions.deny, ['Bash(x:*)']);
});

test('the source is a closed set: an unknown kind, a value outside it, a repeat or a missing file refuses the step', () => {
  for (const bad of ['deny-method GET', 'deny-method post', 'allow-endpoint issues', 'allow-endpoint milestones/3',
    'retire-deny Bash(gh api *)', 'allow gh api', 'deny-method POST\ndeny-method POST', '# only a comment']) {
    const T = home('bad', {});
    const src = path.join(T, 'gh-api.conf');
    fs.writeFileSync(src, bad + '\n');
    const r = run(T, { source: src });
    assert.equal(r.code, 2, bad);
    assert.match(r.err, /^(invalid gh-api entry \(.+\): |the gh-api source has no entry)/m, bad);
    assert.ok(!fs.existsSync(r.settings) || !fs.readFileSync(r.settings, 'utf8').includes('gh api'), bad + ': nothing written');
    assert.ok(!fs.existsSync(path.join(r.home, '.codex')), bad + ': nothing written');
  }
  const T = home('missing', {});
  const r = run(T, { source: path.join(T, 'nope.conf') });
  assert.equal(r.code, 2);
  assert.match(r.err, /^gh-api source not found: /m);
});

test('the source file is Edit-denied beside the other sources it decides', () => {
  const T = home('protect', {});
  const r = run(T);
  assert.equal(r.code, 0, r.out + r.err);
  assert.ok(JSON.parse(fs.readFileSync(r.settings, 'utf8')).permissions.deny.includes('Edit(/' + SOURCE + ')'));
});

test('mhw milestone is an unknown command', () => {
  const mhw = (/** @type {string[]} */ args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), ...args], { encoding: 'utf8' });
  // Answered exactly as an unknown word, bare and with arguments, on each platform's own routing.
  for (const rest of [[], ['read', '3', '--repo', 'o/r'], ['create', 'sprint-07']]) {
    const got = mhw(['milestone', ...rest]);
    const unknown = mhw(['nope', ...rest]);
    assert.equal(got.status, 2, rest.join(' '));
    assert.equal(unknown.status, 2);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, unknown.stderr.split('nope').join('milestone'), rest.join(' '));
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'commands', 'milestone.js')), 'src/commands/milestone.js still exists');
});

test('the floor no longer lists a gh api write, and the allow list no route', () => {
  const words = floorFiles(fresh('floor'));
  assert.deepEqual(words.filter((w) => w.startsWith('gh api')), []);
  assert.doesNotMatch(fs.readFileSync(path.join(ROOT, 'global', 'allow-list.conf'), 'utf8'), /^[a-z]+ route /m);
});
