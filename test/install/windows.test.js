// The Windows user-layer installer (`mhw install-windows`, src/commands/install-windows.js; #497, S27 of #470):
// every case of the deleted global/install.test.ps1, as node:test, against this checkout's own sources and
// overlay, in throwaway profile directories (USERPROFILE; HOME points at the same directory, so the
// renderers find it on every OS). The cases run on every runner; what only Windows has (the owner-only
// access list of a backup, the CRLF checkout) is asserted where it exists. Parity with install.ps1 itself is
// test/install/windows-golden.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { BAD_FLOOR } from './windows-cases.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WIN = process.platform === 'win32';
const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's27-cases-')));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

let n = 0;
/** A new, empty profile directory. @param {string} label */
function profile(label) {
  const h = path.join(BASE, label + '-' + ++n);
  fs.mkdirSync(h, { recursive: true });
  return h;
}

// Sections 1-13 seed settings of their own (a "model" among them), which the model defaults would overwrite
// (Issue #145), so they run with a copy of the repository overlay minus model-defaults.json; section 14 runs
// the repository overlay itself, as install.test.ps1 did.
const REPO_OVERLAY = path.join(ROOT, 'overlay');
const MODELS_OFF = path.join(BASE, 'overlay-without-model-defaults');
fs.cpSync(REPO_OVERLAY, MODELS_OFF, { recursive: true });
fs.rmSync(path.join(MODELS_OFF, 'model-defaults.json'), { force: true });

/**
 * Run mhw install-windows on a profile; the overlay defaults to MODELS_OFF.
 * @param {string} h @param {string[]} [args] @param {Record<string, string | undefined>} [extra]
 */
function run(h, args = [], extra = {}) {
  const a = args.some((x) => x.startsWith('--overlay=')) ? args : [...args, '--overlay=' + MODELS_OFF];
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, USERPROFILE: h, HOME: h, ...extra };
  for (const k of ['CODEX_HOME', 'XDG_DATA_HOME', 'WORKSTATION_LAUNCHER_PLATFORM', 'WORKSTATION_OVERLAY']) delete env[k];
  if (!('MHW_NODE' in extra)) delete env.MHW_NODE;
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-windows', ...a], { env, encoding: 'utf8' });
  return { code: p.status, out: p.stdout.split(/\r?\n/), err: p.stderr };
}

/** Every file under a directory, relative. @param {string} dir */
function files(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile())
    .map((e) => path.relative(dir, path.join(e.parentPath, e.name)));
}

/** @param {string} h */
const targets = (h) => [
  path.join(h, '.claude', 'CLAUDE.md'), path.join(h, '.codex', 'AGENTS.md'), path.join(h, '.kiro', 'steering', 'workstation-global-brief.md'),
  path.join(h, '.codex', 'rules', 'workstation-deny-floor.rules'), path.join(h, '.claude', 'settings.json'), path.join(h, '.kiro', 'settings', 'permissions.yaml'),
];
/** @param {string} p */
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
/** @param {string} h */
const fingerprint = (h) => targets(h).map((f) => (fs.existsSync(f) ? sha(f) : 'absent ' + f)).join('\n');
/** @param {string} h */
const settings = (h) => JSON.parse(fs.readFileSync(path.join(h, '.claude', 'settings.json'), 'utf8'));
/** @param {string} h @param {string} r */
const countRule = (h, r) => settings(h).permissions.deny.filter((/** @type {string} */ x) => x === r).length;
/** @param {string} p */
const readLF = (p) => Buffer.from(fs.readFileSync(p).toString('latin1').replaceAll('\r\n', '\n'), 'latin1');

/**
 * Windows: the access list grants the current user alone, nothing inherited (icacls by absolute path).
 * Elsewhere: mode 0600.
 * @param {string} p
 */
function ownerOnly(p) {
  if (!WIN) return (fs.statSync(p).mode & 0o777) === 0o600;
  const sys32 = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32');
  const me = spawnSync(path.join(sys32, 'whoami.exe'), [], { encoding: 'utf8' }).stdout.trim().toLowerCase();
  const acl = spawnSync(path.join(sys32, 'icacls.exe'), [p], { encoding: 'utf8' }).stdout;
  // icacls prints the path, then one access entry per line ("DOMAIN\user:(F)"), then a summary line.
  const aces = acl.split(/\r?\n/).map((l) => (l.startsWith(p) ? l.slice(p.length) : l).trim()).filter((l) => l.includes(':('));
  const ok = aces.length === 1 && aces[0].toLowerCase().startsWith(me + ':') && !aces[0].includes('(I)');
  if (!ok) console.log('# acl of ' + p + ' (whoami ' + me + '): ' + JSON.stringify(aces));
  return ok;
}

// Expected counts from the sources, independently of the installer: a cmd line is one Claude rule and one
// Codex rule, a glob one Claude rule, a file line two (Read and Edit).
const floorLines = [path.join(ROOT, 'global', 'deny-floor.conf'), path.join(REPO_OVERLAY, 'deny-floor.conf')]
  .filter((f) => fs.existsSync(f)).flatMap((f) => fs.readFileSync(f, 'utf8').split(/\r?\n/));
let floorRules = 0;
let floorCmds = 0;
for (const l of floorLines) {
  const k = l.trim().split(/\s+/)[0];
  if (k === 'cmd') {
    floorRules++;
    floorCmds++;
  } else if (k === 'glob') floorRules++;
  else if (k === 'file') floorRules += 2;
}
const briefLF = Buffer.concat([readLF(path.join(ROOT, 'global', 'AGENTS.md')), readLF(path.join(REPO_OVERLAY, 'AGENTS.md'))]);
const briefSha = crypto.createHash('sha256').update(briefLF).digest('hex');

test('1. dry run writes nothing and prints the targets, the merge and the floor for both harnesses', () => {
  const h = profile('dry');
  const r = run(h, ['--dry-run']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(files(h), []);
  assert.ok(r.out.some((l) => l.startsWith('WOULD WRITE')));
  assert.ok(r.out.some((l) => l.startsWith('WOULD MERGE') && l.includes('re-serialized')));
  assert.ok(r.out.includes('+ Bash(git push --force:*)'));
  assert.ok(r.out.some((l) => /^WOULD WRITE .*workstation-deny-floor\.rules/.test(l)));
});

test('2. a fresh install writes every target; the brief is the LF source, byte for byte, with no BOM', () => {
  const h = profile('fresh');
  assert.equal(run(h).code, 0);
  for (const f of targets(h)) assert.ok(fs.statSync(f).isFile(), f);
  assert.ok(!fs.existsSync(path.join(h, '.claude', 'agents', 'developer.md')), 'a plain install renders no agent');
  const kiro = fs.readFileSync(path.join(h, '.kiro', 'steering', 'workstation-global-brief.md'), 'utf8').split('\n');
  assert.deepEqual(kiro.slice(0, 3), ['---', 'inclusion: always', '---']);
  const raw = fs.readFileSync(path.join(h, '.claude', 'CLAUDE.md'));
  const text = raw.toString('utf8');
  assert.ok(/^## Escalating to the owner/m.test(text) && /^## Owner overlay/m.test(text));
  assert.ok(!raw.includes(13), 'no CR byte');
  assert.ok(!(raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf), 'no BOM');
  assert.ok(text.split('\n').slice(0, 3).some((l) => l.includes('sha256: ' + briefSha + ';')), 'the marker hashes the LF source');
  assert.ok(raw.subarray(raw.length - briefLF.length).equals(briefLF), 'the brief ends with the LF source');
  if (WIN) console.log('# source checkout carries CRLF: ' + fs.readFileSync(path.join(ROOT, 'global', 'AGENTS.md')).includes(13));
  assert.equal(run(h, ['--check']).code, 0);

  // 2b. the deny floor, for Claude Code and Codex
  const deny = settings(h).permissions.deny;
  assert.ok(floorRules > 0 && deny.length === floorRules, deny.length + ' vs ' + floorRules);
  for (const r of ['Bash(rm -rf:*)', 'Bash(git push --force:*)', 'Bash(gh auth token:*)', 'Read(~/.ssh/id_*)', 'Edit(~/.aws/credentials)',
    'Bash(terraform plan:*)', 'Bash(terraform env:*)', 'Bash(tofu init:*)', 'Bash(terraform -chdir=*)', 'Bash(aws ssm get-parameter --with-decryption:*)',
    'Bash(git commit --no-verify:*)', 'Bash(git push --no-verify:*)', 'Bash(aws sso login:*)', 'Read(**/.env)', 'Edit(**/*.pem)']) {
    assert.equal(countRule(h, r), 1, r);
  }
  const rules = fs.readFileSync(path.join(h, '.codex', 'rules', 'workstation-deny-floor.rules'), 'utf8').split('\n');
  assert.ok(rules.includes('prefix_rule(pattern=["git", "push", "--force"], decision="forbidden")'));
  assert.ok(!rules.some((l) => l.startsWith('prefix_rule(') && (l.includes('*') || l.includes('-chdir'))));
  assert.equal(rules.filter((l) => l.startsWith('prefix_rule(')).length, floorCmds);
  assert.ok(!rules.some((l) => l.includes('decision="allow"')));

  // 3. an idempotent re-run
  const before = fingerprint(h);
  assert.equal(run(h).code, 0);
  assert.equal(fingerprint(h), before);

  // 4. drift is found, then repaired
  fs.appendFileSync(path.join(h, '.codex', 'AGENTS.md'), 'local edit\n');
  assert.equal(run(h, ['--check']).code, 1);
  assert.equal(run(h).code, 0);
  assert.equal(run(h, ['--check']).code, 0);

  // 4b. the provenance stamp names this checkout's HEAD, and a foreign one is STAMP, not DRIFT
  const ok = run(h, ['--check']);
  assert.equal(ok.code, 0);
  const first = ok.out.find((l) => /^OK {6}.*CLAUDE\.md \(release: /.test(l)) || '';
  const srcStamp = (/\((release: [^)]*)\)$/.exec(first) || [])[1] || '';
  const gitExe = which('git');
  const git = gitExe ? spawnSync(gitExe, ['-C', ROOT, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }) : { status: 1, stdout: '' };
  if (git.status === 0) assert.match(srcStamp, new RegExp('^release: [^;]+; commit: ' + git.stdout.trim() + '(-dirty)?$'));
  const other = '0123456789abcdef0123456789abcdef01234567';
  for (const f of [path.join(h, '.codex', 'AGENTS.md'), path.join(h, '.claude', 'settings.json')]) {
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/; commit: [^;"]*;/g, '; commit: ' + other + ';'));
  }
  const st = run(h, ['--check']);
  assert.equal(st.code, 1);
  assert.equal(st.out.filter((l) => l.startsWith('STAMP ') && l.includes('commit: ' + other)).length, 2, st.out.join('\n'));
  assert.ok(!st.out.some((l) => l.startsWith('DRIFT')));
  assert.equal(run(h).code, 0);
  assert.equal(run(h, ['--check']).code, 0);
  const s = settings(h);
  s.permissions.deny = s.permissions.deny.filter((/** @type {string} */ r) => r !== 'Bash(rm -rf:*)');
  fs.writeFileSync(path.join(h, '.claude', 'settings.json'), JSON.stringify(s));
  const missing = run(h, ['--check']);
  assert.equal(missing.code, 1);
  assert.ok(missing.out.some((l) => l.includes('(1 deny-floor rule(s) missing)')));
  assert.equal(run(h).code, 0);
  assert.equal(countRule(h, 'Bash(rm -rf:*)'), 1);
  fs.unlinkSync(path.join(h, '.codex', 'rules', 'workstation-deny-floor.rules'));
  assert.equal(run(h, ['--check']).code, 1);
  assert.equal(run(h).code, 0);
});

test('2c. a CRLF checkout (core.autocrlf=true) renders the LF brief, on every OS', () => {
  const tree = path.join(BASE, 'crlf-tree');
  for (const p of ['src', 'bin', 'package.json', '.bumpversion.toml']) fs.cpSync(path.join(ROOT, p), path.join(tree, p), { recursive: true });
  fs.cpSync(path.join(ROOT, 'test', 'golden', 'S27', 'inputs', 'method'), path.join(tree, 'method'), { recursive: true });
  fs.mkdirSync(path.join(tree, 'global'));
  for (const f of ['AGENTS.md', 'deny-floor.conf', 'allow-retired.conf']) {
    fs.writeFileSync(path.join(tree, 'global', f), readLF(path.join(ROOT, 'global', f)).toString('latin1').replaceAll('\n', '\r\n'), 'latin1');
  }
  const h = profile('crlf');
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env, USERPROFILE: h, HOME: h };
  for (const k of ['CODEX_HOME', 'XDG_DATA_HOME', 'MHW_NODE']) delete env[k];
  const p = spawnSync(process.execPath, [path.join(tree, 'bin', 'mhw.js'), 'install-windows', '--overlay=none'], { env, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stdout + p.stderr);
  const raw = fs.readFileSync(path.join(h, '.claude', 'CLAUDE.md'));
  assert.ok(!raw.includes(13), 'no CR byte in the rendered brief');
  const lf = readLF(path.join(ROOT, 'global', 'AGENTS.md'));
  assert.ok(raw.subarray(raw.length - lf.length).equals(lf), 'the brief ends with the LF source');
  assert.ok(raw.toString('utf8').includes('sha256: ' + crypto.createHash('sha256').update(lf).digest('hex') + ';'), 'the marker hashes the LF source');
  assert.equal(countRule(h, 'Bash(rm -rf:*)'), 1, 'a CRLF floor parses');
});

test('2b. the working method: off by default, rendered with --method, and a failed render exits non-zero', () => {
  const h = profile('method');
  fs.mkdirSync(path.join(h, '.claude'));
  fs.writeFileSync(path.join(h, '.claude', 'settings.json'), '{ "enabledPlugins": { "tadeumendonca-skills@tadeumendonca": true, "a@b": true } }');
  const r = run(h, ['--method']);
  assert.equal(r.code, 0, r.err);
  const kept = settings(h);
  assert.equal(kept.enabledPlugins['tadeumendonca-skills@tadeumendonca'], true);
  assert.equal(kept.enabledPlugins['a@b'], true);
  assert.ok(!fs.existsSync(path.join(h, '.claude', 'settings.json.pmhwc-plugin-backup')));
  assert.ok(r.out.some((l) => /^METHOD {2}installed: .*agents.*skills.*commands/.test(l)), r.out.join('\n'));
  const agent = fs.readFileSync(path.join(h, '.claude', 'agents', 'developer.md'), 'utf8');
  assert.match(agent, /^tools: Read, Grep, Glob, Write, Edit, Bash$/m);
  assert.match(agent, /managed-by: personal-multi-harness-workstation-configuration; source: method\/agents\/developer\.md; release: /);
  assert.ok(fs.existsSync(path.join(h, '.codex', 'agents', 'scrum-master.toml')));
  assert.match(fs.readFileSync(path.join(h, '.agents', 'skills', 'autonomy', 'agents', 'openai.yaml'), 'utf8'), /allow_implicit_invocation: false/);
  const kiro = JSON.parse(fs.readFileSync(path.join(h, '.kiro', 'agents', 'developer.json'), 'utf8'));
  assert.equal(kiro.tools.join(','), 'read,write,shell');
  assert.ok(!('allowedTools' in kiro));
  assert.equal(run(h, ['--check']).code, 0);
  const hf = profile('method-refused');
  fs.mkdirSync(path.join(hf, '.claude', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(hf, '.claude', 'agents', 'developer.md'), "the owner's own agent\n");
  assert.notEqual(run(hf, ['--method']).code, 0);
});

test('5. an unmanaged file is refused and left untouched', () => {
  const h = profile('unmanaged');
  fs.mkdirSync(path.join(h, '.claude'));
  const mine = path.join(h, '.claude', 'CLAUDE.md');
  fs.writeFileSync(mine, 'my own hand-written brief\n');
  const before = sha(mine);
  const r = run(h);
  assert.equal(r.code, 3);
  assert.match(r.err, /^REFUSE {2}.*CLAUDE\.md: exists and is NOT managed by this project/m);
  assert.equal(sha(mine), before);
  assert.equal(run(h, ['--check']).code, 3);
});

test('6. the merge into an existing settings file keeps everything else; the backup is owner-only', () => {
  const h = profile('settings');
  fs.mkdirSync(path.join(h, '.claude'));
  const sf = path.join(h, '.claude', 'settings.json');
  fs.writeFileSync(sf, `{
    "model" : "some-model",
    "enabledPlugins" : { "a@b" : true },
    "permissions" : { "allow" : [ "Bash(ls:*)" ], "ask" : [ "Edit(\\/x)" ], "deny" : [ "Bash(my-own-rule:*)", "Bash(rm -rf:*)" ] },
    "hooks" : {
        "PreToolUse" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ],
        "Stop" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ]
    }
}`);
  const orig = sha(sf);
  const dry = run(h, ['--dry-run']);
  assert.equal(dry.code, 0);
  assert.equal(sha(sf), orig);
  assert.ok(dry.out.some((l) => l.includes('re-serialized')));
  assert.equal(run(h).code, 0);
  const s = settings(h);
  assert.equal(s.model, 'some-model');
  assert.equal(s.enabledPlugins['a@b'], true);
  assert.deepEqual(s.permissions.allow, ['Bash(ls:*)']);
  assert.deepEqual(s.permissions.ask, ['Edit(/x)']);
  assert.equal(s.hooks.PreToolUse.length, 1);
  assert.equal(s.hooks.PreToolUse[0].hooks[0].command, '/opt/status');
  assert.equal(s.hooks.Stop[0].hooks[0].command, '/opt/status');
  const d = s.permissions.deny;
  assert.deepEqual(d.slice(0, 2), ['Bash(my-own-rule:*)', 'Bash(rm -rf:*)'], 'existing entries keep their place at the head');
  assert.equal(d.length, floorRules + 1, 'a union: a floor rule already there is not duplicated, a foreign one is kept');
  assert.equal(countRule(h, 'Bash(rm -rf:*)'), 1);
  assert.equal(sha(sf + '.pmhwc-backup'), orig, 'the backup holds the previous settings byte for byte');
  assert.ok(ownerOnly(sf + '.pmhwc-backup'), 'the settings backup is owner-only');
  if (WIN) assert.ok(!ownerOnly(sf), 'the control: the settings file itself still inherits its access list');
  const snap = sha(sf);
  assert.equal(run(h).code, 0);
  assert.equal(sha(sf), snap, 're-merge leaves the settings byte-identical');
});

test('8 and 10. a settings file that is not a JSON object, or whose deny is not a list, is refused and left untouched', () => {
  for (const [label, text] of [['badjson', '{ "model": \n'], ['badperms', '{ "permissions": { "deny": "Bash(rm -rf:*)" } }']]) {
    const h = profile(label);
    fs.mkdirSync(path.join(h, '.claude'));
    const sf = path.join(h, '.claude', 'settings.json');
    fs.writeFileSync(sf, text);
    const before = sha(sf);
    const r = run(h);
    assert.equal(r.code, 3, label);
    assert.match(r.err, /^REFUSE {2}.*settings\.json: /m);
    assert.equal(sha(sf), before, label);
  }
});

test('9. --overlay=none renders the generic policy only', () => {
  const h = profile('generic');
  assert.equal(run(h, ['--overlay=none']).code, 0);
  assert.ok(!/^## Owner overlay/m.test(fs.readFileSync(path.join(h, '.claude', 'CLAUDE.md'), 'utf8')));
});

test('11. an overlay adds floor entries; an invalid entry stops the run before anything is written', () => {
  const ov = path.join(BASE, 'overlay-floor');
  fs.mkdirSync(ov, { recursive: true });
  fs.writeFileSync(path.join(ov, 'deny-floor.conf'), '# owner extra\ncmd terraform destroy\n');
  const h = profile('overlay');
  assert.equal(run(h, ['--overlay=' + ov]).code, 0);
  assert.equal(countRule(h, 'Bash(terraform destroy:*)'), 1);
  assert.ok(fs.readFileSync(path.join(h, '.codex', 'rules', 'workstation-deny-floor.rules'), 'utf8').split('\n')
    .includes('prefix_rule(pattern=["terraform", "destroy"], decision="forbidden")'));
  for (const e of BAD_FLOOR) {
    fs.writeFileSync(path.join(ov, 'deny-floor.conf'), e + '\n');
    const hb = profile('badfloor');
    const r = run(hb, ['--overlay=' + ov]);
    assert.deepEqual([r.code, files(hb).length], [2, 0], e + ': ' + r.err);
    assert.match(r.err, /^invalid deny-floor entry \(/, e);
  }
});

test('12. usage errors exit 2 and write nothing', () => {
  const h = profile('usage');
  assert.equal(run(h, ['--dry-run', '--check']).code, 2);
  assert.equal(run(h, ['--overlay=' + path.join(BASE, 'no-such-overlay')]).code, 2);
  assert.equal(run(h, ['--no-such-flag']).code, 2);
  assert.deepEqual(files(h), []);
});

test('13. a structured profile whose source changed is refused before any target is written', () => {
  const dir = path.join(BASE, 'profile-stale');
  fs.mkdirSync(dir);
  for (const f of ['profile.json', 'AGENTS.md', 'clipboard.conf', 'desktop-instructions.md', 'profile-plan.json']) {
    fs.copyFileSync(path.join(REPO_OVERLAY, f), path.join(dir, f));
  }
  const doc = JSON.parse(fs.readFileSync(path.join(dir, 'profile.json'), 'utf8'));
  doc.session_start.priority = 'speed';
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(doc, null, 2));
  const h = profile('profile-stale');
  assert.equal(run(h, ['--overlay=' + dir]).code, 1);
  assert.deepEqual(files(h), []);
});

test('14. Issue #145 on Windows: model pins over the owner values, the retired allows removed, the Kiro floor merged, owner-only backups', () => {
  const pins = JSON.parse(fs.readFileSync(path.join(REPO_OVERLAY, 'model-defaults.json'), 'utf8'));
  const h = profile('145');
  for (const d of ['.claude', '.codex', path.join('.kiro', 'settings')]) fs.mkdirSync(path.join(h, d), { recursive: true });
  const sf = path.join(h, '.claude', 'settings.json');
  fs.writeFileSync(sf, '{ "model": "owner-model", "permissions": { "allow": [ "Bash(find:*)", "Bash(awk *)", "Bash(ls:*)" ] } }');
  const cf = path.join(h, '.codex', 'config.toml');
  const canary = 'canary-' + 'value-' + '5150';
  fs.writeFileSync(cf, 'model_reasoning_effort = "high"\n\n[mcp_servers.aws-api]\ncommand = "uvx"\n\n[mcp_servers.aws-api.env]\nAWS_PROFILE = "' + canary + '"\n\n[mcp_servers.keep-me]\ncommand = "x"\n');
  const kf = path.join(h, '.kiro', 'settings', 'permissions.yaml');
  fs.writeFileSync(kf, 'rules:\n  - capability: shell\n    match:\n      - git *\n    effect: allow\n');
  const r = run(h, ['--overlay=' + REPO_OVERLAY]);
  assert.equal(r.code, 0, r.out.join('\n') + r.err);
  const s = settings(h);
  assert.equal(s.model, pins['claude-code'].model);
  assert.equal(s.effortLevel, pins['claude-code'].effort);
  assert.deepEqual(s.permissions.allow, ['Bash(ls:*)']);
  assert.ok(fs.readFileSync(sf + '.pmhwc-allow-backup', 'utf8').includes('Bash(find:*)'));
  assert.ok(r.out.some((l) => l.startsWith('CHANGED ') && l.includes('settings.json: permissions.allow Bash(find:*) present -> absent; Bash(awk *) present -> absent (retired, ADR-0035 decision 4;')), r.out.join('\n'));
  const toml = fs.readFileSync(cf, 'utf8');
  assert.ok(toml.includes('[mcp_servers.aws-api]') && toml.includes('[mcp_servers.keep-me]') && !fs.existsSync(cf + '.pmhwc-mcp-backup'));
  assert.ok(toml.includes('model = "' + pins.codex.model + '"') && toml.includes('model_reasoning_effort = "' + pins.codex.effort + '"') && !toml.includes('"high"'));
  assert.ok(!r.out.some((l) => l.includes(canary)), 'no MCP server value is printed');
  assert.equal(JSON.parse(fs.readFileSync(path.join(h, '.kiro', 'settings', 'cli.json'), 'utf8'))['chat.defaultModel'], pins['kiro-cli'].model);
  const ky = fs.readFileSync(kf, 'utf8');
  assert.ok(ky.includes('"git *"') && ky.includes('"sudo *"') && ky.includes('"~/.ssh/id_*"') && fs.existsSync(kf + '.pmhwc-backup'));
  for (const b of [sf + '.pmhwc-backup', sf + '.pmhwc-allow-backup', sf + '.pmhwc-models-backup', cf + '.pmhwc-models-backup', kf + '.pmhwc-backup']) {
    assert.ok(ownerOnly(b), 'owner-only backup: ' + path.relative(h, b));
  }
  assert.ok(r.out.some((l) => l.startsWith('NOTE    the paste wrapper and the paste filter are not installed on Windows')));
  const snap = [sf, cf, kf].map(sha).join(',');
  const c = run(h, ['--check', '--overlay=' + REPO_OVERLAY]);
  assert.equal(c.code, 0, c.out.join('\n'));
  assert.ok(c.out.some((l) => /^OK {6}.*permissions\.yaml \(all .* deny-floor patterns present;/.test(l)));
  assert.equal(run(h, ['--overlay=' + REPO_OVERLAY]).code, 0);
  assert.equal([sf, cf, kf].map(sha).join(','), snap, 'a re-run leaves settings, config.toml and permissions.yaml byte-identical');
  const s2 = settings(h);
  s2.permissions.allow = ['Bash(ls:*)', 'Bash(find *)'];
  fs.writeFileSync(sf, JSON.stringify(s2));
  const d = run(h, ['--check', '--overlay=' + REPO_OVERLAY]);
  assert.equal(d.code, 1);
  assert.ok(d.out.some((l) => l.startsWith('DRIFT   ') && l.includes('settings.json: install would change permissions.allow Bash(find *) present -> absent')));
});

test('15. an absolute MHW_NODE that is not a file is refused by name, and no other node runs the step', () => {
  const only = path.join(BASE, 'overlay-model-defaults-only');
  fs.mkdirSync(only);
  fs.copyFileSync(path.join(REPO_OVERLAY, 'model-defaults.json'), path.join(only, 'model-defaults.json'));
  const h = profile('481');
  const bogus = path.join(BASE, WIN ? 'no-such-node.exe' : 'no-such-node');
  const r = run(h, ['--check', '--overlay=' + only], { MHW_NODE: bogus });
  assert.equal(r.code, 2);
  assert.ok(r.out.includes('REFUSE  the session-start model defaults: MHW_NODE (' + bogus + ') is not a file; nothing written'), r.out.join('\n'));
  assert.ok(!r.out.some((l) => l.includes('(model defaults ')));
  const ok = run(h, ['--check', '--overlay=' + only], { MHW_NODE: process.execPath });
  assert.ok(ok.out.some((l) => /^MISSING .*settings\.json: install would change model \(absent\) -> .*\(model defaults claude-code\)/.test(l)), ok.out.join('\n'));
});
