// `mhw install-admin` (#496, S26 of #470), global/install-managed.test.sh's cases as node:test. Everything runs
// under a throwaway --root and throwaway HOMEs: never a system path, never root, never sudo (ADR-0025). The
// golden arm (admin-golden.test.js) holds the transcripts against the deleted install-managed.sh; this file
// holds what the documents say, that the installed hook runs, and the cases a transcript cannot show (the NODE
// line, --help, validate()'s halves, the status flag on an owner-writable node).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { which } from '../helpers/home.js';
import { parseToml } from '../../src/lib/toml.js';
import { main as adminMain, validate, USAGE, HOOK_FILES, FILES, renderedNode } from '../../src/commands/install-admin.js';
import { pasteWrap } from '../../src/commands/install-user.js';
import { hookNodeText, nodeOwnership } from '../../src/lib/readers/hooks.js';
import { stageDigest, targetsOf } from './admin-cases.js';
import { EMAIL } from '../helpers/s17.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = 'personal-multi-harness-workstation-configuration';
const POSIX = process.platform !== 'win32';
const SKIP = (!POSIX && 'the admin layer is macOS and Linux only') || (typeof process.getuid === 'function' && process.getuid() === 0 && 'never as root');
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's26-admin-')));
after(() => fs.rmSync(base, { recursive: true, force: true }));
const r = path.join(base, 'root');
const t = targetsOf(r);

/** A clean environment for an installer run under a throwaway HOME. @param {Record<string, string>} [more] */
const envFor = (more = {}) => ({ HOME: path.join(base, 'home'), PATH: path.dirname(process.execPath) + ':/usr/bin:/bin', SHELL: '/bin/sh',
  TMPDIR: path.join(base, 'tmp'), LANG: 'C', MHW_NODE: process.execPath, ...more });

/** `mhw install-admin ARGS` on this checkout. @param {string[]} args @param {Record<string, string>} [env] */
function admin(args, env = envFor()) {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-admin', ...args], { env, encoding: 'utf8', timeout: 300000 });
  return { code: p.status, out: p.stdout, err: p.stderr };
}

/** The floor's entry counts: [all Claude Code rules, cmd entries]. */
function floorCounts() {
  let all = 0;
  let cmd = 0;
  for (const f of [path.join(ROOT, 'global', 'deny-floor.conf'), path.join(ROOT, 'overlay', 'deny-floor.conf')]) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const k = line.trim().split(/\s+/)[0];
      if (k === 'cmd') cmd++;
      if (k === 'cmd' || k === 'glob') all++;
      if (k === 'file') all += 2;
    }
  }
  return [all, cmd];
}

/** @type {{ code: number | null, out: string, err: string }} */
let render = { code: -1, out: '', err: '' };
let stage = '';
let sha = '';
before(() => {
  if (SKIP) return;
  for (const d of ['home', 'tmp', 'root']) fs.mkdirSync(path.join(base, d));
  render = admin(['--root=' + r]);
  const m = /^RUN {5}.* --apply="([^"]+)" --sha256=([0-9a-f]+)/m.exec(render.out);
  if (m) [, stage, sha] = m;
  const a = admin(['--apply=' + stage, '--sha256=' + sha, '--root=' + r]);
  assert.equal(a.code, 0, a.out + a.err);
});

test('render validates a stage, prints ONE sudo line on this node and bin/mhw.js, and installs nothing until --apply', { skip: SKIP }, () => {
  assert.equal(render.code, 0, render.err);
  const runs = render.out.split('\n').filter((l) => l.startsWith('RUN '));
  assert.equal(runs.length, 1);
  assert.ok(runs[0].startsWith('RUN     sudo "' + process.execPath + '" "' + path.join(ROOT, 'bin', 'mhw.js') + '" install-admin --apply="'), runs[0]);
  assert.ok(runs[0].endsWith(' --root="' + r + '"'), runs[0]);
  assert.equal(sha.length, 64);
  assert.equal(stageDigest(stage), sha, 'the printed hash is the digest of the stage');
});

test('the NODE line records the node the admin hook runs and its ownership (#536: accepted until S32)', { skip: SKIP }, () => {
  const line = render.out.split('\n').find((l) => l.startsWith('NODE    ')) || '';
  assert.equal(line, 'NODE    the admin hook runs ' + nodeOwnership(process.execPath) + '; the owner accepted an owner-writable node until S32 (#536)');
  // The node of this test run lives under a directory the test user owns or can write (a toolcache, nvm,
  // Homebrew or the scratch copy): the line says owner-writable, as status does.
  assert.match(line, /\(owner-writable: a process running as you can replace it, or the libraries it loads\)/);
  // A root-owned, non-writable program reads as not writable (the shape S32's lock-in will need).
  assert.equal(nodeOwnership('/bin/sh'), '/bin/sh (not writable by you)');
});

test('mhw status flags an owner-writable node in the installed admin hook', { skip: SKIP }, () => {
  const env = { HOME: path.join(base, 'status-home'), WORKSTATION_MANAGED_ROOT: r };
  fs.mkdirSync(env.HOME, { recursive: true });
  const text = hookNodeText(env);
  assert.equal(text, process.execPath + ' (owner-writable: a process running as you can replace it, or the libraries it loads)');
  // The same drop-in naming a root-owned program reads as not writable; one naming nothing that exists, as FAIL.
  const keep = fs.readFileSync(t.claude, 'utf8');
  try {
    fs.writeFileSync(t.claude, keep.replaceAll(process.execPath, '/bin/sh'));
    assert.equal(hookNodeText(env), '/bin/sh (not writable by you)');
    fs.writeFileSync(t.claude, keep.replaceAll(process.execPath, path.join(base, 'gone', 'node')));
    assert.match(hookNodeText(env), /^FAIL .*gone\/node not found: the prompt hook cannot run$/);
  } finally {
    fs.writeFileSync(t.claude, keep);
  }
});

test('the Claude Code drop-in registers the fixed-pattern check from the admin bin, and no other hook; no HITL guard, no mhw hook prompt', { skip: SKIP }, () => {
  const d = JSON.parse(fs.readFileSync(t.claude, 'utf8'));
  assert.deepEqual(Object.keys(d).sort(), ['hooks', 'permissions', NAME].sort());
  // #588: the fixed-pattern check before the prompt, and before the Bash tool.
  assert.deepEqual(Object.keys(d.hooks), ['UserPromptSubmit', 'PreToolUse']);
  for (const ev of ['UserPromptSubmit', 'PreToolUse']) {
    assert.ok(d.hooks[ev].every((/** @type {any} */ g) => g.hooks.every((/** @type {any} */ h) => h.command.includes(t.bin))), ev);
  }
  // #600: `mhw hook prompt`'s entry (hook-entry.js) is gone; the check's prompt half is the only prompt hook.
  assert.deepEqual(d.hooks.UserPromptSubmit[0].hooks.map((/** @type {any} */ h) => /hook-entry\.js|pattern-check\.js/.exec(h.command)?.[0]), ['pattern-check.js']);
  assert.equal(d.hooks.PreToolUse.length, 1);
  assert.equal(d.hooks.PreToolUse[0].matcher, 'Bash');
  assert.ok(d.hooks.PreToolUse[0].hooks[0].command.includes(t.bin + '/hook/src/hooks/pattern-check.js" pre-tool --harness claude'));
  const req = fs.readFileSync(t.codex, 'utf8');
  for (const s of ['AskUserQuestion', 'hitl-escalation-guard', 'restart_guard', 'breaking_glass', 'hook-entry', 'hook-prompt', 'hook prompt', 'defer-to-paste-filter']) {
    assert.ok(!JSON.stringify(d).includes(s) && !req.includes(s), s);
  }
  for (const f of ['hitl-escalation-guard.sh', 'hitl.conf', 'restart_guard.py', 'breaking_glass.py', 'clipboard_guard.py', 'hook/src/commands']) assert.ok(!fs.existsSync(t.bin + '/' + f), f);
  assert.ok(!fs.existsSync(t.switches));
});

test('the admin hook command is the user layer\'s start-fallback form, on the node install-user rendered', { skip: SKIP }, () => {
  const d = JSON.parse(fs.readFileSync(t.claude, 'utf8'));
  const cmd = d.hooks.UserPromptSubmit[0].hooks[0].command;
  // The fixed-pattern check's prompt half (#600: no --defer-to-paste-filter, no hook-entry.js beside it).
  const want = pasteWrap('claude', '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "' + process.execPath + '" "'
    + t.bin + '/hook/src/hooks/pattern-check.js" prompt --harness claude --config "' + t.bin + '/clipboard.conf"');
  assert.equal(cmd, want);
  const codex = parseToml(fs.readFileSync(t.codex, 'utf8'));
  assert.equal(codex.hooks.UserPromptSubmit[0].hooks[0].command, pasteWrap('codex', '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "'
    + process.execPath + '" "' + t.bin + '/hook/src/hooks/pattern-check.js" prompt --harness codex --config "' + t.bin + '/clipboard.conf"'));
  assert.equal(renderedNode(path.join(base, 'no-such-settings.json')), '');
});

test('the Codex requirements carry our marker, the fixed-pattern hooks only, no hooks-only lock, and parse as TOML', { skip: SKIP }, () => {
  const req = fs.readFileSync(t.codex, 'utf8');
  assert.ok(req.split('\n')[0].includes('managed-by: ' + NAME));
  assert.ok(!/^\s*(allow_managed_hooks_only|\[features\])/m.test(req));
  // The fixed-pattern check before the prompt and before a tool call (#588); since #600 no paste filter entry.
  assert.equal(req.match(/^\[\[hooks\.[A-Za-z]*\.hooks\]\]/gm)?.length, 2);
  assert.ok(!req.includes('hook-entry') && !req.includes('defer-to-paste-filter'));
  const d = parseToml(req);
  assert.deepEqual(Object.keys(d.hooks).sort(), ['PreToolUse', 'UserPromptSubmit', 'managed_dir']);
  assert.equal(d.hooks.UserPromptSubmit[0].hooks.length, 1);
  assert.ok(d.hooks.UserPromptSubmit[0].hooks[0].command.includes('/hook/src/hooks/pattern-check.js" prompt --harness codex'));
  assert.ok(d.hooks.PreToolUse[0].hooks[0].command.includes('/hook/src/hooks/pattern-check.js" pre-tool --harness codex'));
  assert.equal(d.hooks.PreToolUse[0].matcher, undefined, 'no matcher: the script passes any call that is not an outbound act');
  assert.equal(d.hooks.managed_dir, t.bin);
});

test('the admin layer carries every deny-floor rule: the drop-in all of them, Codex one forbidden prefix rule per cmd entry', { skip: SKIP }, () => {
  const [all, cmd] = floorCounts();
  const deny = JSON.parse(fs.readFileSync(t.claude, 'utf8')).permissions.deny;
  assert.equal(deny.length, all);
  for (const rule of ['Bash(sudo:*)', 'Bash(gh workflow run:*)', 'Read(~/.ssh/id_*)', 'Bash(terraform plan:*)', 'Bash(terraform -chdir=*)',
    'Bash(git commit --no-verify:*)', 'Bash(aws ssm get-parameter --with-decryption:*)', 'Bash(aws sso login:*)', 'Read(**/.env)', 'Edit(**/credentials*)']) {
    assert.ok(deny.includes(rule), rule);
  }
  if (fs.existsSync(path.join(ROOT, 'overlay', 'deny-floor.conf'))) assert.ok(deny.includes('Bash(git push origin main:*)'), 'the overlay\'s floor entries reach the drop-in');
  const req = fs.readFileSync(t.codex, 'utf8');
  const rules = req.split('\n').filter((l) => /^ {2}\{ pattern = \[.*\], decision = "forbidden", justification = /.test(l));
  assert.equal(rules.length, cmd);
  assert.ok(req.includes('{ pattern = [{ token = "git" }, { token = "push" }, { token = "--force" }], decision = "forbidden"'));
  assert.ok(req.includes('{ pattern = [{ token = "terraform" }, { token = "plan" }], decision = "forbidden"'));
  assert.ok(!req.includes('-chdir') && !/token = "[^"]*\*/.test(req) && !req.includes('decision = "allow"'), 'a glob stays out of the Codex requirements');
  assert.equal(parseToml(req).rules.prefix_rules.length, cmd);
});

test('the Kiro admin copy is 0644 and carries every floor pattern as deny rules Kiro\'s schema accepts (emulated)', { skip: SKIP }, () => {
  const [all] = floorCounts();
  const raw = fs.readFileSync(t.kiro);
  assert.notDeepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  const d = JSON.parse(raw.toString('utf8'));
  assert.deepEqual(Object.keys(d).sort(), ['rules', NAME].sort());
  assert.ok(d[NAME].includes('managed-by: ' + NAME));
  /** @type {Record<string, string[]>} */
  const caps = {};
  for (const rule of d.rules) {
    assert.ok(Object.keys(rule).every((k) => ['capability', 'effect', 'match', 'exclude'].includes(k)), 'Kiro rejects an unknown rule field');
    assert.equal(rule.effect, 'deny');
    assert.ok(Array.isArray(rule.match) && rule.match.every((/** @type {unknown} */ x) => typeof x === 'string'));
    caps[rule.capability] = rule.match;
  }
  assert.deepEqual(Object.keys(caps).sort(), ['fs_read', 'fs_write', 'shell']);
  assert.equal(Object.values(caps).reduce((n, m) => n + m.length, 0), all);
  for (const p of ['sudo *', 'gh workflow run *', 'terraform -chdir=*']) assert.ok(caps.shell.includes(p), p);
  assert.ok(caps.fs_read.includes('~/.ssh/id_*') && caps.fs_write.includes('~/.ssh/id_*') && caps.fs_read.includes('**/.env'));
  assert.equal((fs.statSync(t.kiro).mode & 0o777).toString(8), '644');
});

test('the Node hook\'s files and the conf are installed, none executable, root-owned shape (0644, dirs 0755)', { skip: SKIP }, () => {
  assert.deepEqual(FILES, ['clipboard.conf', ...HOOK_FILES]);
  for (const f of FILES) {
    const st = fs.statSync(t.bin + '/' + f);
    assert.ok(st.isFile() && (st.mode & 0o777) === 0o644, f);
  }
  for (const d of [t.base, t.bin, t.bin + '/hook', t.bin + '/hook/src', t.bin + '/hook/src/lib', t.bin + '/hook/src/hooks']) {
    assert.equal(fs.statSync(d).mode & 0o777, 0o755, d);
  }
  // Each hook file is its source with one stamp line before it.
  const entry = fs.readFileSync(t.bin + '/hook/src/hooks/pattern-check.js', 'utf8');
  assert.equal(entry.slice(entry.indexOf('\n') + 1), fs.readFileSync(path.join(ROOT, 'src', 'hooks', 'pattern-check.js'), 'utf8'));
});

test('the installed admin hook blocks a finding, passes a clean prompt, and a planted NODE_OPTIONS --require never runs', { skip: SKIP }, () => {
  const cmd = JSON.parse(fs.readFileSync(t.claude, 'utf8')).hooks.UserPromptSubmit[0].hooks[0].command;
  const plant = path.join(base, 'plant.cjs');
  const ran = path.join(base, 'planted-ran');
  fs.writeFileSync(plant, 'require("fs").writeFileSync(' + JSON.stringify(ran) + ', "x")\n');
  const hookHome = path.join(base, 'hook-home');
  fs.mkdirSync(hookHome, { recursive: true });
  const env = { HOME: hookHome, PATH: '/usr/bin:/bin', NODE_OPTIONS: '--require ' + plant };
  const blocked = spawnSync('/bin/sh', ['-c', cmd], { input: JSON.stringify({ prompt: 'mail ' + EMAIL }), env, encoding: 'utf8' });
  assert.match(blocked.stdout, /"decision": "block".*email/s);
  assert.ok(!fs.existsSync(ran), 'a planted NODE_OPTIONS --require ran in the admin hook');
  const clean = spawnSync('/bin/sh', ['-c', cmd], { input: '{"hook_event_name":"UserPromptSubmit","prompt":"a clean prompt"}', env, encoding: 'utf8' });
  assert.equal(clean.stdout, '');
});

// #588: the admin layer's copy of the fixed-pattern check, run as Claude Code and Codex run it from the drop-in
// and the requirements: a push carrying a synthetic credential in an unpushed commit is blocked, a clean
// one passes. The repository's remote-tracking ref is written with update-ref, so nothing is pushed.
test('the admin layer\'s fixed-pattern check blocks a dirty push and passes a clean one (Claude Code and Codex)', { skip: SKIP || (!which('git') && 'git') }, () => {
  const git = /** @type {string} */ (which('git'));
  const token = 'gh' + 'p_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8N7m6L5k4J3i2';
  const genv = { PATH: '/usr/bin:/bin', HOME: base, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'F',
    GIT_AUTHOR_EMAIL: 'f' + '@' + 'example.com', GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: 'f' + '@' + 'example.com' };
  /** @param {string} name @param {string} text */
  const repo = (name, text) => {
    const d = path.join(base, 'repo-' + name);
    fs.mkdirSync(d);
    const g = (/** @type {string[]} */ a) => assert.equal(spawnSync(git, ['-C', d, ...a], { env: genv }).status, 0, a.join(' '));
    g(['init', '-q', '-b', 'main']);
    fs.writeFileSync(path.join(d, 'a.txt'), 'a\n');
    g(['add', '.']);
    g(['commit', '-q', '-m', 'a']);
    g(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
    fs.writeFileSync(path.join(d, 'b.txt'), text);
    g(['add', '.']);
    g(['commit', '-q', '-m', 'b']);
    return d;
  };
  const dirty = repo('dirty', 'key ' + token + '\n');
  const clean = repo('clean', 'clean\n');
  const claude = JSON.parse(fs.readFileSync(t.claude, 'utf8')).hooks.PreToolUse[0].hooks[0].command;
  const codex = parseToml(fs.readFileSync(t.codex, 'utf8')).hooks.PreToolUse[0].hooks[0].command;
  for (const cmd of [claude, codex]) {
    /** @param {string} cwd */
    const run = (cwd) => spawnSync('/bin/sh', ['-c', cmd], { input: JSON.stringify({ hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command: 'git push origin main' } }),
      env: { PATH: '/usr/bin:/bin', HOME: base }, encoding: 'utf8', cwd });
    const blocked = run(dirty);
    assert.equal(blocked.status, 2, blocked.stderr);
    assert.match(blocked.stderr, /b\.txt:1: credential/);
    assert.ok(!blocked.stderr.includes(token));
    const passed = run(clean);
    assert.equal(passed.status, 0, passed.stderr);
    assert.equal(passed.stdout + passed.stderr, '');
  }
});

test('check after apply is clean, names each of the ten files with the source\'s stamp, and the stamp names HEAD', { skip: SKIP }, () => {
  const c = admin(['--check', '--root=' + r]);
  assert.equal(c.code, 0, c.out + c.err);
  const src = (/^SOURCE {2}(.*)$/m.exec(c.out) || [])[1] || '';
  const git = which('git');
  const head = git ? spawnSync(git, ['-C', ROOT, 'rev-parse', '--verify', 'HEAD'], { encoding: 'utf8' }).stdout.trim() : 'unknown';
  assert.match(src, new RegExp('^release: .*; commit: ' + head + '(-dirty)?$'));
  assert.equal(c.out.split('\n').filter((l) => /^OK .*\(release: /.test(l)).length, 8); // #588 added the check's file; #600 removed hook-entry.js and hook-prompt.js
  for (const f of [t.claude, t.codex, t.kiro, t.bin + '/hook/src/hooks/pattern-check.js', t.bin + '/hook/package.json', t.bin + '/clipboard.conf']) {
    assert.ok(fs.readFileSync(f, 'utf8').includes('; ' + src + ';'), f);
  }
});

test('mhw install-user\'s FLOOR report reads the admin Kiro copy (complete, a pattern missing, absent)', { skip: SKIP }, () => {
  const [all] = floorCounts();
  const hk = path.join(base, 'home-kiro-report');
  fs.mkdirSync(hk, { recursive: true });
  const report = (/** @type {string} */ root) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-user', '--check', '--managed-root=' + root],
    { env: envFor({ HOME: hk }), encoding: 'utf8', timeout: 300000 }).stdout;
  assert.ok(report(r).includes('FLOOR   Kiro: admin managed-settings.json ' + all + '/' + all + ' floor patterns'));
  const keep = fs.readFileSync(t.kiro, 'utf8');
  try {
    fs.writeFileSync(t.kiro, keep.replace('        "sudo *",\n', ''));
    assert.ok(report(r).includes('FLOOR   Kiro: admin managed-settings.json ' + (all - 1) + '/' + all + ' floor patterns'));
  } finally {
    fs.writeFileSync(t.kiro, keep);
  }
  assert.ok(report(path.join(base, 'no-admin')).includes('FLOOR   Kiro: admin managed-settings.json absent'));
});

test('validate() checks both halves on every OS: the Codex rule count, and a Kiro document Kiro accepts', { skip: SKIP }, () => {
  const v = path.join(base, 'validate');
  fs.cpSync(stage, v, { recursive: true });
  assert.equal(validate(v), true);
  const req = fs.readFileSync(path.join(v, 'requirements.toml'), 'utf8');
  // One prefix rule too few: install-managed.sh's validate() let this through under macOS's python 3.9.
  fs.writeFileSync(path.join(v, 'requirements.toml'), req.replace(/^ {2}\{ pattern = .*\n/m, ''));
  assert.equal(validate(v), false);
  fs.writeFileSync(path.join(v, 'requirements.toml'), req.replace('decision = "forbidden"', 'decision = "allow"'));
  assert.equal(validate(v), false);
  fs.writeFileSync(path.join(v, 'requirements.toml'), req + 'not toml [[\n');
  assert.equal(validate(v), false);
  fs.writeFileSync(path.join(v, 'requirements.toml'), req);
  const claude = fs.readFileSync(path.join(v, 'claude.json'), 'utf8');
  const d = JSON.parse(claude);
  fs.writeFileSync(path.join(v, 'claude.json'), JSON.stringify({ ...d, extra: 1 }));
  assert.equal(validate(v), false, 'an extra top-level key');
  fs.writeFileSync(path.join(v, 'claude.json'), JSON.stringify({ ...d, [NAME]: 'no stamp' }));
  assert.equal(validate(v), false, 'no stamp');
  fs.writeFileSync(path.join(v, 'claude.json'), claude);
  const kiro = JSON.parse(fs.readFileSync(path.join(v, 'kiro.json'), 'utf8'));
  kiro.rules[0].exclude = Array.from({ length: 40 }, (_, i) => 'x' + i);
  fs.writeFileSync(path.join(v, 'kiro.json'), JSON.stringify(kiro));
  assert.equal(validate(v), false, 'a Kiro rule over the condition ceiling');
});

test('--help prints the usage text and exits 0; an earlier unknown argument wins over it', () => {
  const h = admin(['--help']);
  assert.equal(h.code, 0);
  assert.equal(h.out, USAGE);
  assert.match(USAGE, /mhw install-admin --apply=STAGE --sha256=HEX/);
  const u = admin(['--nope', '--help']);
  assert.equal(u.code, 2);
  assert.equal(u.err, 'unknown argument: --nope\n');
});

test('an admin layer from before #600: --check names hook-entry.js and hook-prompt.js STALE, --apply deletes them and their directory', { skip: SKIP }, () => {
  // Its own root, so the shared layer the other tests read stays as installed.
  const own = path.join(base, 'root-600');
  fs.mkdirSync(own);
  const ot = targetsOf(own);
  const rr = admin(['--root=' + own]);
  const m = /^RUN {5}.* --apply="([^"]+)" --sha256=([0-9a-f]+)/m.exec(rr.out);
  assert.ok(m, rr.out + rr.err);
  assert.equal(admin(['--apply=' + m[1], '--sha256=' + m[2], '--root=' + own]).code, 0);
  const old = ['hook-entry.js', 'hook-prompt.js'].map((f) => ot.bin + '/hook/src/commands/' + f);
  fs.mkdirSync(path.dirname(old[0]), { recursive: true });
  for (const f of old) fs.writeFileSync(f, '// managed-by: ' + NAME + '; source: src/commands/x; old\n');
  const c = admin(['--check', '--root=' + own]);
  assert.equal(c.code, 1, c.out);
  for (const f of old) assert.ok(c.out.includes('STALE   ' + f + ": a removed hook's file (#600); --apply deletes it"), c.out);
  const r2 = admin(['--root=' + own]);
  const m2 = /^RUN {5}.* --apply="([^"]+)" --sha256=([0-9a-f]+)/m.exec(r2.out);
  assert.ok(m2, r2.out + r2.err);
  assert.equal(admin(['--apply=' + m2[1], '--sha256=' + m2[2], '--root=' + own]).code, 0);
  for (const f of old) assert.ok(!fs.existsSync(f), f);
  assert.ok(!fs.existsSync(ot.bin + '/hook/src/commands'), 'the emptied directory is left behind');
  assert.equal(admin(['--check', '--root=' + own]).code, 0, 'check is clean after the cleanup');
});

test('codex execpolicy: the admin token lists forbid workflow run and force-push, and leave a branch push alone', { skip: SKIP || (!which('codex') && 'codex not on PATH') }, () => {
  // Credential-free: the same token lists, written as a user .rules file, through Codex's own evaluator. This
  // proves the lists, not that Codex loads them from the admin path (that needs root).
  const lines = fs.readFileSync(t.codex, 'utf8').split('\n').filter((l) => l.startsWith('  { pattern = ['));
  const rules = lines.map((l) => 'prefix_rule(pattern=[' + (/pattern = \[(.*)\], decision/.exec(l) || [])[1].replaceAll(/\{ token = ("[^"]*") \}/g, '$1') + '], decision="forbidden")');
  const f = path.join(base, 'admin.rules');
  fs.writeFileSync(f, rules.join('\n') + '\n');
  const codex = /** @type {string} */ (which('codex'));
  const decide = (/** @type {string[]} */ words) => JSON.parse(spawnSync(codex, ['execpolicy', 'check', '--rules', f, ...words], { encoding: 'utf8' }).stdout).decision ?? 'none';
  assert.deepEqual([decide(['gh', 'workflow', 'run', 'deploy']), decide(['git', 'push', '--force', 'origin', 'x']), decide(['git', 'push', 'origin', 'feature/x'])],
    ['forbidden', 'forbidden', 'none']);
});

// QA B1 on PR #548: the refusal predicates of --apply and --remove, in process. Each row was calibrated red on
// its source mutant: (a) hashing the stage instead of root's copy, or installing from the stage; (b) accepting a
// hash prefix; (c) reading a Kiro file that holds our key without the marker as ours.
const APPLY_ROWS = /** @type {Array<{ name: string, run: () => void }>} */ ([
  {
    name: 'a stage rewritten after the copy installs the verified copy, not the change (TOCTOU)',
    run: () => {
      const r2 = path.join(base, 'root-toctou');
      const t2 = targetsOf(r2);
      const want = fs.readFileSync(path.join(stage, 'claude.json'), 'utf8');
      const real = fs.copyFileSync;
      let done = false;
      fs.copyFileSync = (from, to, mode) => {
        real(from, to, mode);
        if (!done && String(from) === path.join(stage, 'kiro.json')) {
          done = true;
          fs.writeFileSync(path.join(stage, 'claude.json'), want.replace('"deny": [', '"deny": ["Bash(tampered:*)", '));
        }
      };
      let code;
      try {
        code = adminMain(['--apply=' + stage, '--sha256=' + sha, '--root=' + r2], envFor(), { out: () => {}, err: () => {} });
      } finally {
        fs.copyFileSync = real;
        fs.writeFileSync(path.join(stage, 'claude.json'), want);
      }
      assert.equal(done, true, 'the stage was rewritten after its copy');
      assert.equal(code, 0);
      assert.equal(fs.readFileSync(t2.claude, 'utf8'), want);
    },
  },
  {
    name: 'a hash that is only a prefix of the stage digest is refused, and nothing is installed',
    run: () => {
      const r2 = path.join(base, 'root-prefix');
      assert.equal(adminMain(['--apply=' + stage, '--sha256=' + sha.slice(0, 8), '--root=' + r2], envFor(), { out: () => {}, err: () => {} }), 3);
      assert.ok(!fs.existsSync(targetsOf(r2).claude));
    },
  },
  {
    name: 'a Kiro file holding our key without the marker is foreign: --apply refuses it, --remove leaves it',
    run: () => {
      const r2 = path.join(base, 'root-kiro-key');
      const t2 = targetsOf(r2);
      fs.mkdirSync(path.dirname(t2.kiro), { recursive: true });
      const theirs = '{"' + NAME + '": "theirs"}\n';
      fs.writeFileSync(t2.kiro, theirs);
      const io = { out: () => {}, err: () => {} };
      assert.equal(adminMain(['--apply=' + stage, '--sha256=' + sha, '--root=' + r2], envFor(), io), 3);
      assert.equal(adminMain(['--remove', '--root=' + r2], envFor(), io), 0);
      assert.equal(fs.readFileSync(t2.kiro, 'utf8'), theirs);
    },
  },
]);
for (const row of APPLY_ROWS) test('--apply and --remove refusals: ' + row.name, { skip: SKIP }, row.run);

// Lens finding on PR #548 at 59f9fac5: the words of the owner's sudo line are pasted inside double quotes into an
// interactive shell, where `!` is history expansion. A node path or a stage path that line cannot carry is
// refused (exit 2, nothing staged); a space, and the usual nvm and Homebrew paths, pass.
const SUDO_ROWS = /** @type {Array<{ name: string, args: string[], tmp?: string, execPath?: string, code: number, err?: RegExp }>} */ ([
  { name: 'a node path holding ! is refused by render', args: [], execPath: '/opt/bang!x/bin/node', code: 2, err: /^REFUSE {2}the node path \/opt\/bang!x\/bin\/node holds .*exclamation mark/m },
  { name: 'a node path holding ! is refused by --uninstall', args: ['--uninstall'], execPath: '/opt/bang!x/bin/node', code: 2, err: /^REFUSE {2}the node path .*exclamation mark/m },
  { name: 'a node path holding a double quote is refused', args: ['--uninstall'], execPath: '/opt/q"x/bin/node', code: 2, err: /^REFUSE {2}the node path/m },
  { name: 'a stage path holding ! is refused before anything is staged', args: [], tmp: 'tmp-bang!x', code: 2, err: /^REFUSE {2}the stage path .*tmp-bang!x.*exclamation mark/m },
  { name: 'a stage path holding a backtick is refused', args: [], tmp: 'tmp-tick`x', code: 2, err: /^REFUSE {2}the stage path/m },
  { name: 'a stage path holding a dollar sign is refused', args: [], tmp: 'tmp-dollar$x', code: 2, err: /^REFUSE {2}the stage path .*tmp-dollar\$x/m },
  { name: 'an nvm node path passes', args: ['--uninstall'], execPath: '/Users/someone/.nvm/versions/node/v26.13.1/bin/node', code: 0 },
  { name: 'a Homebrew node path passes', args: ['--uninstall'], execPath: '/opt/homebrew/bin/node', code: 0 },
  { name: 'a username holding a space passes', args: ['--uninstall'], execPath: '/Users/Some One/.nvm/versions/node/v26.13.1/bin/node', code: 0 },
]);
for (const row of SUDO_ROWS) {
  test('the sudo line\'s words: ' + row.name, { skip: SKIP }, () => {
    const tmp = path.join(base, row.tmp || 'tmp');
    fs.mkdirSync(tmp, { recursive: true });
    const before = fs.readdirSync(tmp);
    let out = '';
    let err = '';
    const code = adminMain([...row.args, '--root=' + path.join(base, 'root-sudo')], envFor({ TMPDIR: tmp }),
      { out: (s) => { out += s; }, err: (s) => { err += s; } }, row.execPath ? { execPath: row.execPath } : {});
    assert.equal(code, row.code, out + err);
    if (row.err) {
      assert.match(err, row.err);
      assert.doesNotMatch(out, /^RUN /m);
      assert.deepEqual(fs.readdirSync(tmp), before, 'a stage was created');
    } else assert.ok(out.includes('RUN     sudo "' + row.execPath + '" "'), out);
  });
}

// QA B2 on PR #548: the same refusal, end to end in a real process, for the two words the program itself
// supplies. The package path is a copy of src/ and bin/ under a directory named pk$g or pk!g; the node path is a
// hard link to this node in a directory named n$x or n!x (process.execPath is the link's own path; a copy when
// the link cannot be made). Each of render and --uninstall: exit 2, a REFUSE line naming the word, no RUN line.
const WORDS = /** @type {const} */ (['$', '!']);
/** @type {Map<string, string>} */
const made = new Map();
/** A tree holding this package's src/ and bin/ under pk<c>g. @param {string} c */
function packageTree(c) {
  const key = 'pkg' + c;
  if (!made.has(key)) {
    const tree = path.join(base, 'pk' + c + 'g');
    for (const d of ['src', 'bin']) fs.cpSync(path.join(ROOT, d), path.join(tree, d), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'package.json'), path.join(tree, 'package.json'));
    made.set(key, tree);
  }
  return /** @type {string} */ (made.get(key));
}
/** This node, reached through n<c>x/node. @param {string} c */
function linkedNode(c) {
  const key = 'node' + c;
  if (!made.has(key)) {
    const dir = path.join(base, 'n' + c + 'x');
    fs.mkdirSync(dir, { recursive: true });
    const node = path.join(dir, 'node');
    try {
      fs.linkSync(process.execPath, node);
    } catch {
      fs.copyFileSync(process.execPath, node);
      fs.chmodSync(node, 0o755);
    }
    made.set(key, node);
  }
  return /** @type {string} */ (made.get(key));
}
for (const mode of [[], ['--uninstall']]) {
  for (const c of WORDS) {
    for (const word of ['package path', 'node path']) {
      const name = (mode.length ? '--uninstall' : 'render') + ' refuses a ' + word + ' holding ' + c;
      test('the sudo line\'s words, end to end: ' + name, { skip: SKIP }, () => {
        const node = word === 'node path' ? linkedNode(c) : process.execPath;
        const tree = word === 'package path' ? packageTree(c) : ROOT;
        const tmp = path.join(base, 'tmp-e2e');
        fs.mkdirSync(tmp, { recursive: true });
        const before = fs.readdirSync(tmp);
        const r = spawnSync(node, [path.join(tree, 'src', 'commands', 'install-admin.js'), ...mode, '--root=' + path.join(base, 'root-e2e')],
          { env: envFor({ TMPDIR: tmp }), encoding: 'utf8', timeout: 300000 });
        assert.equal(r.status, 2, r.stdout + r.stderr);
        assert.match(r.stderr, new RegExp('^REFUSE {2}the ' + word + ' \\S*' + (c === '$' ? '\\$' : '!') + '.* exclamation mark, which the sudo line cannot carry$', 'm'));
        assert.doesNotMatch(r.stdout, /^RUN /m);
        assert.deepEqual(fs.readdirSync(tmp), before, 'a stage was created');
      });
    }
  }
}

