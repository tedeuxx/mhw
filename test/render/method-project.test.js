// The project target of the working-method renderer (#576): --project=DIR renders DIR/.mhw/method/{agents,skills}
// into DIR's project carriers for Claude Code, Codex and Kiro, before any user-level copy is removed. Every
// run is on throwaway directories: HOME, CODEX_HOME and the project are under the OS temporary directory, so
// no real configuration is read or written.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { methodHome, sourceCopy, tempDir, read, filesUnder, STAMP } from '../helpers/method-home.js';

const AGENT = 'probe-project';
const SKILL = 'probe-project-skill';

/** A project with one agent (preloading a project skill and a user-level one) and one skill. */
function project(label = 'proj') {
  const dir = tempDir(label);
  const src = path.join(dir, '.mhw', 'method');
  fs.mkdirSync(path.join(src, 'agents'), { recursive: true });
  fs.mkdirSync(path.join(src, 'skills', SKILL), { recursive: true });
  fs.writeFileSync(path.join(src, 'skills', SKILL, 'SKILL.md'),
    '---\nname: ' + SKILL + '\ndescription: A project skill for the test. Use when the test asks.\n---\nSkill body.\n');
  fs.writeFileSync(path.join(src, 'agents', AGENT + '.md'),
    '---\nname: ' + AGENT + '\ndescription: A project agent for the test.\ntools: Read, Grep\nskills:\n  - ' + SKILL
    + '\n  - shell\n---\nAgent body.\n');
  return dir;
}

/** @param {string} dir */
const carriers = (dir) => ({
  claudeAgent: path.join(dir, '.claude', 'agents', AGENT + '.md'),
  codexAgent: path.join(dir, '.codex', 'agents', AGENT + '.toml'),
  kiroAgent: path.join(dir, '.kiro', 'agents', AGENT + '.json'),
  claudeSkill: path.join(dir, '.claude', 'skills', SKILL, 'SKILL.md'),
  codexSkill: path.join(dir, '.agents', 'skills', SKILL, 'SKILL.md'),
  kiroSkill: path.join(dir, '.kiro', 'skills', SKILL, 'SKILL.md'),
});

test('one project source renders the project carriers of all three agent harnesses', () => {
  const h = methodHome();
  const dir = project();
  const r = h.run(['--mode=install', '--project=' + dir]);
  assert.equal(r.code, 0, r.out);
  for (const [k, f] of Object.entries(carriers(dir))) assert.ok(fs.existsSync(f), k + ' missing\n' + r.out);
  const c = carriers(dir);
  assert.match(read(c.claudeAgent), /^tools: Read, Grep$/m);
  assert.match(read(c.claudeAgent), /source: \.mhw\/method\/agents\/probe-project\.md/);
  assert.match(read(c.codexAgent), /^name = "probe_project"$/m);
  assert.match(read(c.codexAgent), /^sandbox_mode = "read-only"$/m);
  assert.match(r.out, /PROJECT installed: 1 agents, 1 skills/);
  // The user level is rendered as before, beside it.
  assert.ok(fs.existsSync(h.p('.claude/agents/tech-lead.md')));
});

test('the Kiro project agent references its skills by skill:// paths, and no project file names the home', () => {
  const h = methodHome();
  const dir = project();
  assert.equal(h.run(['--mode=install', '--project=' + dir]).code, 0);
  const doc = JSON.parse(read(carriers(dir).kiroAgent));
  assert.deepEqual(doc.resources, ['skill://.kiro/skills/' + SKILL + '/SKILL.md', 'skill://~/.kiro/skills/shell/SKILL.md']);
  assert.deepEqual(doc.tools, ['read']);
  for (const f of filesUnder(dir)) {
    if (f.includes(path.sep + '.mhw' + path.sep)) continue;
    assert.ok(!read(f).includes(h.root), f + ' names the home directory');
  }
});

test('check reports the project carriers in sync, then the drift of one', () => {
  const h = methodHome();
  const dir = project();
  assert.equal(h.run(['--mode=install', '--project=' + dir]).code, 0);
  assert.equal(h.run(['--mode=check', '--project=' + dir]).code, 0);
  fs.appendFileSync(carriers(dir).codexSkill, 'edited\n');
  const r = h.run(['--mode=check', '--project=' + dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, new RegExp('DRIFT   ' + carriers(dir).codexSkill.replaceAll(/[\\.]/g, '\\$&')));
});

test('a moved agent: the project copy is written before the user copy is removed', () => {
  const h = methodHome();
  const src = sourceCopy();
  assert.equal(h.run(['--mode=install', '--source=' + src]).code, 0);
  const user = h.p('.claude/agents/tech-lead.md');
  assert.ok(fs.existsSync(user));
  // tech-lead leaves method/ and arrives in the project source, in one run.
  const dir = project();
  fs.renameSync(path.join(src, 'agents', 'tech-lead.md'), path.join(dir, '.mhw', 'method', 'agents', 'tech-lead.md'));
  const r = h.run(['--mode=install', '--source=' + src, '--project=' + dir]);
  assert.equal(r.code, 0, r.out);
  const lines = r.stdout.split('\n');
  const wrote = lines.findIndex((l) => l.startsWith('WROTE') && l.includes(path.join(dir, '.claude', 'agents', 'tech-lead.md')));
  const removed = lines.findIndex((l) => l.startsWith('REMOVED') && l.includes(user));
  assert.ok(wrote >= 0 && removed >= 0, r.out);
  assert.ok(wrote < removed, 'the user copy was removed before the project copy was written\n' + r.out);
  assert.ok(!fs.existsSync(user));
  assert.ok(fs.existsSync(path.join(dir, '.codex', 'agents', 'tech-lead.toml')));
  assert.ok(fs.existsSync(path.join(dir, '.kiro', 'agents', 'tech-lead.json')));
});

test('a refused project file holds every user-level removal', () => {
  const h = methodHome();
  const src = sourceCopy();
  assert.equal(h.run(['--mode=install', '--source=' + src]).code, 0);
  const dir = project();
  fs.renameSync(path.join(src, 'agents', 'tech-lead.md'), path.join(dir, '.mhw', 'method', 'agents', 'tech-lead.md'));
  const inTheWay = path.join(dir, '.claude', 'agents', 'tech-lead.md');
  fs.mkdirSync(path.dirname(inTheWay), { recursive: true });
  fs.writeFileSync(inTheWay, 'hand-written\n');
  const r = h.run(['--mode=install', '--source=' + src, '--project=' + dir]);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /REFUSE {2}.*tech-lead\.md/);
  assert.match(r.out, /HELD {4}.*tech-lead\.md/);
  assert.ok(fs.existsSync(h.p('.claude/agents/tech-lead.md')), 'the user copy was removed although the project copy is not in place');
  assert.equal(read(inTheWay), 'hand-written\n');
});

test('the Codex trust of the project is reported, read and never written', () => {
  const h = methodHome();
  const dir = project();
  const codexHome = tempDir('codex');
  const config = path.join(codexHome, 'config.toml');
  let r = h.run(['--mode=install', '--project=' + dir], { env: { CODEX_HOME: codexHome } });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /UNTRUSTED .* absent\): Codex skips its \.codex\/agents/);
  assert.ok(!fs.existsSync(config), 'the renderer wrote the Codex configuration');
  const trusted = '[projects."' + dir.replaceAll('\\', '\\\\') + '"]\ntrust_level = "trusted"\n';
  fs.writeFileSync(config, trusted);
  r = h.run(['--mode=check', '--project=' + dir], { env: { CODEX_HOME: codexHome } });
  assert.match(r.out, /CODEX {3}.* is trusted in /);
  assert.equal(read(config), trusted);
  fs.writeFileSync(config, '[projects."/elsewhere"]\ntrust_level = "trusted"\n');
  r = h.run(['--mode=check', '--project=' + dir], { env: { CODEX_HOME: codexHome } });
  assert.match(r.out, /UNTRUSTED .*no trusted entry/);
});

test('a project source the target cannot render writes nothing at either level', () => {
  for (const [label, edit, why] of /** @type {Array<[string, (src: string) => void, RegExp]>} */ ([
    ['commands', (src) => fs.mkdirSync(path.join(src, 'commands')), /renders agents and skills only/],
    ['scripts', (src) => fs.appendFileSync(path.join(src, 'skills', SKILL, 'SKILL.md'), '{{method-scripts}}/x/y.md\n'), /user-level method only/],
    ['preload', (src) => fs.writeFileSync(path.join(src, 'agents', AGENT + '.md'),
      '---\nname: ' + AGENT + '\ndescription: d\ntools: []\nskills:\n  - no-such-skill\n---\nb\n'), /preloads unknown skill no-such-skill/],
  ])) {
    const h = methodHome(label);
    const dir = project(label);
    edit(path.join(dir, '.mhw', 'method'));
    const r = h.run(['--mode=install', '--project=' + dir]);
    assert.equal(r.code, 2, label + '\n' + r.out);
    assert.match(r.out, why);
    assert.deepEqual(h.files(), [], label + ': the user level was written');
    assert.ok(!fs.existsSync(path.join(dir, '.claude')), label + ': the project was written');
  }
});

/** A home that is itself a valid project, so only the guard can refuse it. */
function homeWithSource() {
  const h = methodHome('guard');
  const src = path.join(h.root, '.mhw', 'method', 'agents');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(path.join(src, AGENT + '.md'), '---\nname: ' + AGENT + '\ndescription: d\ntools: []\n---\nb\n');
  return h;
}

const POSIX = process.platform !== 'win32';

test('--project must be an existing directory, and never the home by any spelling', () => {
  const h = homeWithSource();
  const leaked = h.p('.claude/agents/' + AGENT + '.md');
  assert.equal(h.run(['--mode=install', '--project=' + path.join(h.root, 'nope')]).code, 2);
  for (const spelling of [h.root, h.root + path.sep, path.join(h.root, 'sub') + path.sep + '..']) {
    fs.mkdirSync(h.p('sub'), { recursive: true });
    const r = h.run(['--mode=install', '--project=' + spelling]);
    assert.equal(r.code, 2, spelling + '\n' + r.out);
    assert.match(r.out, /must not be the home directory or contain it/);
    assert.ok(!fs.existsSync(leaked), spelling + ': a project file landed in the user carriers');
  }
  // A directory that contains the home is refused too.
  assert.equal(h.run(['--mode=install', '--project=' + path.dirname(h.root)]).code, 2);
});

test('a link to the home, or a carrier linked out of the project, writes nothing', { skip: !POSIX }, () => {
  const h = homeWithSource();
  const leaked = h.p('.claude/agents/' + AGENT + '.md');
  const link = path.join(tempDir('link'), 'to-home');
  fs.symlinkSync(h.root, link);
  let r = h.run(['--mode=install', '--project=' + link]);
  assert.equal(r.code, 2, r.out);
  assert.ok(!fs.existsSync(leaked));

  const outside = tempDir('outside');
  const dir = project('out');
  fs.symlinkSync(outside, path.join(dir, '.claude'));
  r = h.run(['--mode=install', '--project=' + dir]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /resolves outside the project/);
  assert.deepEqual(filesUnder(outside), []);

  const dir2 = project('touser');
  fs.mkdirSync(h.p('.claude'), { recursive: true });
  fs.symlinkSync(h.p('.claude'), path.join(dir2, '.claude'));
  r = h.run(['--mode=install', '--project=' + dir2]);
  assert.equal(r.code, 2, r.out);
  assert.ok(!fs.existsSync(h.p('.claude/agents/' + AGENT + '.md')), 'a project agent landed in the user carriers');
  assert.ok(!fs.existsSync(h.p('.claude/skills/' + SKILL)), 'a project skill landed in the user carriers');
});

test('an agent that leaves the project source is removed from the project carriers', () => {
  const h = methodHome();
  const dir = project();
  assert.equal(h.run(['--mode=install', '--project=' + dir]).code, 0);
  fs.rmSync(path.join(dir, '.mhw', 'method', 'agents', AGENT + '.md'));
  let r = h.run(['--mode=check', '--project=' + dir]);
  assert.equal(r.code, 1);
  assert.match(r.out, /STALE {3}.*probe-project\.toml: rendered by an earlier project source/);
  r = h.run(['--mode=install', '--project=' + dir]);
  assert.equal(r.code, 0, r.out);
  const c = carriers(dir);
  for (const f of [c.claudeAgent, c.codexAgent, c.kiroAgent]) {
    assert.ok(!fs.existsSync(f), f);
    assert.match(r.out, new RegExp('REMOVED ' + f.replaceAll(/[\\.]/g, '\\$&') + ' \\(no longer in'));
  }
  assert.ok(fs.existsSync(c.claudeSkill), 'the skill still in the source was removed');
});

test('a moved agent keeps its Codex user copy while Codex does not trust the project', () => {
  const h = methodHome();
  const src = sourceCopy();
  const codexHome = tempDir('codex-move');
  const env = { CODEX_HOME: codexHome };
  assert.equal(h.run(['--mode=install', '--source=' + src], { env }).code, 0);
  const codexUser = path.join(codexHome, 'agents', 'tech-lead.toml');
  const claudeUser = h.p('.claude/agents/tech-lead.md');
  assert.ok(fs.existsSync(codexUser));
  const dir = project();
  fs.renameSync(path.join(src, 'agents', 'tech-lead.md'), path.join(dir, '.mhw', 'method', 'agents', 'tech-lead.md'));
  let r = h.run(['--mode=install', '--source=' + src, '--project=' + dir], { env });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /HELD {4}.*tech-lead\.toml: Codex does not trust the project/);
  assert.ok(fs.existsSync(codexUser), 'the Codex user copy was removed while Codex cannot read the project copy');
  assert.ok(!fs.existsSync(claudeUser), 'the Claude Code user copy should go: Claude Code reads the project copy');
  const record = h.p('.local/share/personal-multi-harness-workstation-configuration/method/project-holds.json');
  assert.ok(fs.existsSync(record), 'the hold was not recorded');
  // Later runs without --project keep the hold, and check reports it as held, not stale.
  r = h.run(['--mode=install', '--source=' + src], { env });
  assert.equal(r.code, 0, r.out);
  assert.ok(fs.existsSync(codexUser), 'a later plain install removed the held Codex user copy');
  for (const args of [['--mode=check', '--source=' + src], ['--mode=check', '--source=' + src, '--project=' + dir]]) {
    r = h.run(args, { env });
    assert.match(r.out, /HELD {4}.*tech-lead\.toml/, args.join(' '));
    assert.doesNotMatch(r.out, /STALE {3}.*tech-lead\.toml/, args.join(' '));
    assert.equal(r.code, 0, r.out);
  }
  // Once the owner trusts the project, a plain install removes the user copy and the record.
  fs.writeFileSync(path.join(codexHome, 'config.toml'), '[projects."' + dir.replaceAll('\\', '\\\\') + '"]\ntrust_level = "trusted"\n');
  r = h.run(['--mode=install', '--source=' + src], { env });
  assert.equal(r.code, 0, r.out);
  assert.ok(!fs.existsSync(codexUser), 'once trusted, the Codex user copy is removed\n' + r.out);
  assert.ok(!fs.existsSync(record), 'the record outlived its last hold');
});

test('a rendered file linked out of the project is refused before anything is written', { skip: !POSIX }, () => {
  const h = methodHome();
  const dir = project('deep');
  const outside = tempDir('deep-out');
  fs.mkdirSync(path.join(dir, '.claude', 'skills'), { recursive: true });
  fs.symlinkSync(outside, path.join(dir, '.claude', 'skills', SKILL));
  const r = h.run(['--mode=install', '--project=' + dir]);
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /resolves outside the project/);
  assert.deepEqual(filesUnder(outside), []);
  assert.ok(!fs.existsSync(path.join(dir, '.claude', 'agents')), 'a project file was written');
  assert.deepEqual(h.files(), [], 'the user level was written');
});

test('uninstall --project through a carrier linked out of the project removes nothing', { skip: !POSIX }, () => {
  const h = methodHome();
  const dir = project('unlink');
  assert.equal(h.run(['--mode=install', '--project=' + dir]).code, 0);
  const outside = path.join(tempDir('unlink-out'), 'claude');
  fs.renameSync(path.join(dir, '.claude'), outside);
  fs.symlinkSync(outside, path.join(dir, '.claude'));
  const before = filesUnder(outside);
  const r = h.run(['--mode=uninstall', '--project=' + dir], { stamp: null, optIn: false });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /resolves outside the project/);
  assert.deepEqual(filesUnder(outside), before);
});

test('the trust read matches the real path and a trailing separator', { skip: !POSIX }, () => {
  const h = methodHome();
  const dir = project();
  const link = path.join(tempDir('plink'), 'proj');
  fs.symlinkSync(dir, link);
  const codexHome = tempDir('codex-real');
  const env = { CODEX_HOME: codexHome };
  fs.writeFileSync(path.join(codexHome, 'config.toml'), '[projects."' + dir + '"]\ntrust_level = "trusted"\n');
  let r = h.run(['--mode=install', '--project=' + link], { env });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /CODEX {3}.* is trusted in /);
  fs.writeFileSync(path.join(codexHome, 'config.toml'), '[projects."' + dir + '/"]\ntrust_level = "trusted"\n');
  r = h.run(['--mode=check', '--project=' + dir], { env });
  assert.match(r.out, /CODEX {3}.* is trusted in /);
});

test('uninstall --project removes the project files it rendered and nothing else', () => {
  const h = methodHome();
  const dir = project();
  assert.equal(h.run(['--mode=install', '--project=' + dir]).code, 0);
  const own = path.join(dir, '.claude', 'agents', 'hand.md');
  fs.writeFileSync(own, 'hand-written\n');
  const r = h.run(['--mode=uninstall', '--project=' + dir], { stamp: null, optIn: false });
  assert.equal(r.code, 0, r.out);
  for (const f of Object.values(carriers(dir))) assert.ok(!fs.existsSync(f), f);
  assert.equal(read(own), 'hand-written\n');
  assert.ok(fs.existsSync(path.join(dir, '.mhw', 'method', 'agents', AGENT + '.md')), 'the source was removed');
});

test('without --project the user-level output names no project', () => {
  const h = methodHome();
  const r = h.run(['--mode=install'], { stamp: STAMP });
  assert.equal(r.code, 0);
  assert.doesNotMatch(r.out, /PROJECT|UNTRUSTED|CODEX {3}/);
});

test('a project whose carrier is a user-level one (CODEX_HOME inside it) writes nothing', () => {
  const h = methodHome();
  const dir = project('codexhome');
  const r = h.run(['--mode=install', '--project=' + dir], { env: { CODEX_HOME: path.join(dir, '.codex') } });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /carriers resolve to the user-level ones/);
  assert.ok(!fs.existsSync(path.join(dir, '.codex')), 'the shared carrier was written');
});
