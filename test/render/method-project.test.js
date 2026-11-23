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

test('--project must be an existing directory other than the home', () => {
  const h = methodHome();
  assert.equal(h.run(['--mode=install', '--project=' + path.join(h.root, 'nope')]).code, 2);
  assert.equal(h.run(['--mode=install', '--project=' + h.root]).code, 2);
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
