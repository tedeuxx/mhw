// The fixed-pattern check (#588): src/hooks/pattern-check.js run as the agent harnesses run it, one JSON
// payload on stdin, per harness payload shape, block and pass. The outbound half runs against throwaway git
// repositories (global and system configuration off) whose remote-tracking refs are written with
// update-ref, so nothing is ever pushed. Every fixture is assembled at run time (J), so this file carries no
// literal finding. The mutation checks for each assertion are recorded in the pull request.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { J } from '../clean/corpus.js';
import { which } from '../helpers/home.js';
import { Readable } from 'node:stream';
import { simpleCommands, actionsOf, pushRevisions, bodyFiles, addedBlocks, patchPath, headerPath, run } from '../../src/hooks/pattern-check.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'src', 'hooks', 'pattern-check.js');
const MHW = path.join(ROOT, 'bin', 'mhw.js');
const GIT = which('git');
const TOKEN = J('gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8');
const EMAIL = J('synthetic.person', '@', 'fixture-mail.dev');
const VENDOR = J('noreply', '@', 'anthropic.com');
const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-588-')));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

/** Run the script with one payload. @param {string[]} args @param {unknown} payload @param {Record<string, string>} [env] */
function hook(args, payload, env = {}) {
  const p = spawnSync(process.execPath, [SCRIPT, ...args], {
    input: typeof payload === 'string' ? payload : JSON.stringify(payload), encoding: 'utf8',
    env: { PATH: process.env.PATH || '', HOME: path.join(BASE, 'nohome'), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}), ...env },
    timeout: 30000,
  });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
}

// ------------------------------------------------------------------------------------------- prompt

test('prompt: a synthetic token blocks, in each harness protocol, with a redacted copy and never the token', () => {
  const prompt = 'please use ' + TOKEN + ' for the call';
  const c = hook(['prompt', '--harness', 'claude'], { session_id: 's', hook_event_name: 'UserPromptSubmit', prompt });
  assert.equal(c.code, 0);
  const cj = JSON.parse(c.stdout);
  assert.equal(cj.decision, 'block');
  assert.deepEqual(cj.hookSpecificOutput, { hookEventName: 'UserPromptSubmit', suppressOriginalPrompt: true });
  assert.match(cj.reason, /credential in this prompt/);
  assert.match(cj.reason, /please use \[REDACTED:credential\] for the call/);
  assert.ok(!c.stdout.includes(TOKEN) && !c.stderr.includes(TOKEN));

  const x = hook(['prompt', '--harness', 'codex'], { session_id: 's', turn_id: 't', hook_event_name: 'UserPromptSubmit', cwd: BASE, prompt });
  assert.equal(x.code, 0);
  const xj = JSON.parse(x.stdout);
  assert.equal(xj.decision, 'block');
  assert.equal(xj.hookSpecificOutput, undefined);
  assert.ok(!x.stdout.includes(TOKEN));

  const k = hook(['prompt', '--harness', 'kiro'], { hook_event_name: 'userPromptSubmit', cwd: BASE, prompt });
  assert.equal(k.code, 2);
  assert.equal(k.stdout, '');
  assert.match(k.stderr, /\[REDACTED:credential\]/);
  assert.ok(!k.stderr.includes(TOKEN));
});

test('prompt: a clean prompt passes silently on every harness', () => {
  for (const harness of ['claude', 'codex', 'kiro']) {
    const r = hook(['prompt', '--harness', harness], { prompt: 'a clean prompt about git push and ' + J('example', '@', 'example.com') });
    assert.deepEqual(r, { code: 0, stdout: '', stderr: '' }, harness);
  }
});

test('prompt: an e-mail address blocks; a term category is not this hook\'s', () => {
  const r = hook(['prompt', '--harness', 'claude'], { prompt: 'write to ' + EMAIL });
  assert.match(JSON.parse(r.stdout).reason, /email in this prompt/);
  // A health code is a pattern of a term category (health), left to `mhw hook prompt`.
  assert.deepEqual(hook(['prompt', '--harness', 'claude'], { prompt: J('CID F', '32.1') + ' only' }), { code: 0, stdout: '', stderr: '' });
});

test('prompt: a payload that cannot be read is said, and passes (Claude Code and Codex) or is stderr (Kiro)', () => {
  const c = hook(['prompt', '--harness', 'claude'], 'not json');
  assert.equal(c.code, 0);
  assert.match(JSON.parse(c.stdout).systemMessage, /NOT checked/);
  const k = hook(['prompt', '--harness', 'kiro'], 'not json');
  assert.equal(k.code, 0);
  assert.match(k.stderr, /NOT checked/);
});

test('prompt: the configured block_categories and notices apply', () => {
  const conf = path.join(BASE, 'clipboard.conf');
  fs.writeFileSync(conf, 'block_categories=credential\nnotice_blocked=BLOQUEADO {categories}\n');
  assert.deepEqual(hook(['prompt', '--harness', 'claude', '--config', conf], { prompt: 'write to ' + EMAIL }), { code: 0, stdout: '', stderr: '' });
  assert.match(JSON.parse(hook(['prompt', '--harness', 'claude', '--config', conf], { prompt: TOKEN }).stdout).reason, /^BLOQUEADO credential/);
});

test('one prompt yields one block message while `mhw hook prompt` still runs beside this hook', () => {
  const payload = { prompt: 'key ' + TOKEN + ' and ' + EMAIL };
  const env = { PATH: process.env.PATH || '', HOME: path.join(BASE, 'nohome') };
  /** @param {string} harness @param {{ code: number | null, stdout: string }} r */
  const blocks = (harness, r) => (harness === 'kiro' ? r.code === 2 : /"decision": "block"/.test(r.stdout));
  for (const harness of ['claude', 'codex', 'kiro']) {
    // Outside a wrapped session, and on Kiro with the marker set too: `mhw hook prompt` blocks, this one defers.
    for (const marker of /** @type {Array<Record<string, string>>} */ (harness === 'kiro' ? [{}, { PMHWC_PASTE_WRAPPER: '1' }] : [{}])) {
      const o = spawnSync(process.execPath, [MHW, 'hook', 'prompt', '--harness', harness], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...env, ...marker } });
      const now = hook(['prompt', '--harness', harness, '--defer-to-paste-filter'], payload, marker);
      assert.ok(blocks(harness, { code: o.status, stdout: o.stdout }), harness + ': the paste filter blocks');
      assert.deepEqual(now, { code: 0, stdout: '', stderr: '' }, harness + ': the fixed-pattern check defers to it');
    }
    // Without the flag the fixed-pattern check blocks too: the flag is what keeps it to one message.
    assert.ok(blocks(harness, hook(['prompt', '--harness', harness], payload)), harness + ': the check alone blocks');
  }
  // In a session the paste wrapper started, the paste filter lets the prompt through on Claude Code and
  // Codex; the fixed-pattern check then still blocks what was typed. Still one message.
  for (const harness of ['claude', 'codex']) {
    const marker = { PMHWC_PASTE_WRAPPER: '1' };
    const o = spawnSync(process.execPath, [MHW, 'hook', 'prompt', '--harness', harness], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...env, ...marker } });
    assert.equal(o.stdout + o.stderr, '', harness + ': the paste filter is silent in a wrapped session');
    assert.ok(blocks(harness, hook(['prompt', '--harness', harness, '--defer-to-paste-filter'], payload, marker)), harness + ': the check blocks there');
  }
});

// ------------------------------------------------------------------------------------------- parsing

test('the command reading finds git push (with -C, -c and wrappers) and gh pr create, and nothing else', () => {
  assert.deepEqual(simpleCommands("a 'b c' \"d\\\"e\" f\\ g; h && i | j"), [['a', 'b c', 'd"e', 'f g'], ['h'], ['i'], ['j']]);
  const cwd = path.resolve('/w');
  const at = (/** @type {string} */ p) => path.resolve(cwd, p);
  assert.deepEqual(actionsOf('git push', cwd), [{ kind: 'push', dir: cwd, gitDir: null, args: [] }]);
  assert.deepEqual(actionsOf('git -C repo -c a=b push origin HEAD', cwd), [{ kind: 'push', dir: at('repo'), gitDir: null, args: ['origin', 'HEAD'] }]);
  assert.deepEqual(actionsOf('cd x && FOO=1 env -i git -C "/abs dir" push', cwd)[0].dir, path.resolve('/abs dir'));
  assert.deepEqual(actionsOf('gh pr create --base rc/next --body-file b.md', cwd), [{ kind: 'pr', dir: cwd, args: ['--base', 'rc/next', '--body-file', 'b.md'] }]);
  assert.deepEqual(actionsOf('gh --repo o/r pr create -t x', cwd)[0].kind, 'pr');
  assert.deepEqual(actionsOf('git log --oneline', cwd), []);
  assert.deepEqual(actionsOf('gh pr view 3', cwd), []);
  assert.deepEqual(actionsOf('echo "$(git push)"', cwd), [{ kind: 'push', dir: cwd, gitDir: null, args: [] }], 'the text-level trigger');
  assert.deepEqual(pushRevisions(['-u', 'origin', 'feat', '+a:b', ':gone']), ['feat', 'a']);
  assert.deepEqual(pushRevisions(['origin']), ['HEAD']);
  assert.deepEqual(pushRevisions(['--all', 'origin']), ['--branches']);
  assert.deepEqual(bodyFiles(['--body-file', 'a', '-Fb', '--body-file=c', '-F', '-'], cwd), [at('a'), at('b'), at('c')]);
});

test('an option with no value at the end of a git command is read without failing (Sonar: the !== undefined that read as always true)', () => {
  const cwd = path.resolve('/w');
  // A trailing -C or --git-dir has no value: before #588's fix the missing word reached path.resolve and threw.
  assert.deepEqual(actionsOf('git -C', cwd), []);
  assert.deepEqual(actionsOf('git --git-dir', cwd), []);
  assert.deepEqual(actionsOf('git push origin main; git -C', cwd), [{ kind: 'push', dir: cwd, gitDir: null, args: ['origin', 'main'] }]);
  // With its value, each still applies; an attached value too.
  assert.deepEqual(actionsOf('git --git-dir .g -C r push', cwd), [{ kind: 'push', dir: path.resolve(cwd, 'r'), gitDir: path.resolve(cwd, '.g'), args: [] }]);
  assert.deepEqual(actionsOf('git -C=r push', cwd), [{ kind: 'push', dir: path.resolve(cwd, 'r'), gitDir: null, args: [] }]);
});

test('a backslash that ends the command text escapes nothing (Sonar: the !== undefined that read as always true)', () => {
  assert.deepEqual(simpleCommands('git push origin\\'), [['git', 'push', 'origin']]);
  assert.deepEqual(simpleCommands('\\'), []);
  // A backslash before a newline continues the line; before anything else it keeps that character.
  assert.deepEqual(simpleCommands('git \\\npush a\\ b'), [['git', 'push', 'a b']]);
});

test('the patch reader cuts trailing tabs in linear time (no backtracking on attacker-controlled commit text)', () => {
  assert.equal(patchPath('b/f.txt\t\t'), 'f.txt');
  assert.equal(patchPath('"b/a b"\t'), 'a b');
  assert.equal(patchPath('/dev/null'), null);
  assert.equal(headerPath('diff --git a/x b/x'), 'x');
  assert.equal(headerPath('diff --git "a/x y" "b/x y"'), 'x y');
  assert.equal(headerPath('diff --git weird'), null);
  // 100 000 tabs followed by one more character: a trailing-tab regular expression backtracks over each
  // start position (seconds); a scan is microseconds.
  const evil = '+++ b/f' + '\t'.repeat(100000) + 'x';
  const t0 = process.hrtime.bigint();
  const blocks = addedBlocks('diff --git a/f b/f\n' + evil + '\n@@ -0,0 +1 @@\n+line\n');
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  assert.equal(blocks.length, 1);
  assert.ok(ms < 500, 'took ' + ms + ' ms');
});

// ------------------------------------------------------------------------------------------- outbound

/** git in repo, with the global and system configuration off and fixed identities. @param {string} repo @param {string[]} args */
function g(repo, args) {
  const p = spawnSync(/** @type {string} */ (GIT), ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '', HOME: path.join(BASE, 'nohome'), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: J('fixture', '@', 'example.com'), GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: J('fixture', '@', 'example.com'),
    },
  });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout;
}

/**
 * A repository with one commit already on its remote-tracking ref, then the given unpushed commits.
 * @param {string} name @param {Array<{ file?: string, text?: string, message: string }>} unpushed
 */
function repo(name, unpushed) {
  const r = path.join(BASE, name);
  fs.mkdirSync(r);
  g(r, ['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(r, 'README.md'), 'start\n');
  g(r, ['add', '.']);
  g(r, ['commit', '-q', '-m', 'start']);
  g(r, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  for (const [i, c] of unpushed.entries()) {
    fs.writeFileSync(path.join(r, c.file || 'f' + i + '.txt'), c.text ?? 'line ' + i + '\n');
    g(r, ['add', '.']);
    g(r, ['commit', '-q', '-m', c.message]);
  }
  return r;
}

/** The pre-tool payload of one harness for a command run in cwd. @param {string} harness @param {string} command @param {string} cwd */
function toolPayload(harness, command, cwd) {
  if (harness === 'claude') return { session_id: 's', hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command, description: 'd' } };
  if (harness === 'codex') return { session_id: 's', turn_id: 't', hook_event_name: 'PreToolUse', cwd, model: 'm', tool_name: 'Bash', tool_use_id: 'u', tool_input: { command } };
  return { hook_event_name: 'preToolUse', cwd, tool_name: 'execute_bash', tool_input: { command, summary: 's' } };
}

const HARNESSES = ['claude', 'codex', 'kiro'];
// The outbound half runs from POSIX hooks only: mhw install-windows registers no hook (#588), so these cases are POSIX.
const skipGit = (!GIT && 'git is not on PATH') || (process.platform === 'win32' && 'Windows carries no hook (#588)');

test('pre-tool: a token in an unpushed commit\'s added line blocks git push, on every harness payload shape', { skip: skipGit }, () => {
  const r = repo('token-line', [{ file: 'config.txt', text: 'one\ntoken=' + TOKEN + '\n', message: 'add config' }]);
  const short = g(r, ['rev-parse', '--short', 'HEAD']).trim();
  for (const harness of HARNESSES) {
    const out = hook(['pre-tool', '--harness', harness], toolPayload(harness, 'git push origin main', r));
    assert.equal(out.code, 2, harness);
    assert.equal(out.stdout, '');
    assert.match(out.stderr, new RegExp('  ' + short + ':config.txt:2: credential, \\d+ chars'), harness);
    assert.ok(!out.stderr.includes(TOKEN));
  }
});

test('pre-tool: an e-mail address in an unpushed commit\'s message blocks git push', { skip: skipGit }, () => {
  const r = repo('email-message', [{ message: 'fix\n\nreported by ' + EMAIL }]);
  for (const harness of HARNESSES) {
    const out = hook(['pre-tool', '--harness', harness], toolPayload(harness, 'git push', r));
    assert.equal(out.code, 2, harness);
    assert.match(out.stderr, /:message: email, \d+ chars/, harness);
  }
});

test('pre-tool: git -C <dir> push is checked in <dir>, from any working directory', { skip: skipGit }, () => {
  const r = repo('dash-c', [{ file: 'a.txt', text: TOKEN + '\n', message: 'a' }]);
  const elsewhere = repo('dash-c-clean', []);
  for (const harness of HARNESSES) {
    const out = hook(['pre-tool', '--harness', harness], toolPayload(harness, 'git -C ' + r + ' push origin main', elsewhere));
    assert.equal(out.code, 2, harness);
    assert.match(out.stderr, /:a\.txt:1: credential/);
    // The same command against the clean repository passes.
    assert.deepEqual(hook(['pre-tool', '--harness', harness], toolPayload(harness, 'git -C ' + elsewhere + ' push', r)), { code: 0, stdout: '', stderr: '' }, harness);
  }
});

test('pre-tool: a clean push passes; a pushed commit, the attribution trailer and a non-push command are not findings', { skip: skipGit }, () => {
  const r = repo('clean', [{ message: 'feat: x\n\nCo-Authored-By: Claude <' + VENDOR + '>' }]);
  for (const harness of HARNESSES) {
    assert.deepEqual(hook(['pre-tool', '--harness', harness], toolPayload(harness, 'git push -u origin main', r)), { code: 0, stdout: '', stderr: '' }, harness);
  }
  // A finding already on the remote-tracking ref is not sent again.
  const sent = repo('already-sent', [{ file: 'x.txt', text: TOKEN + '\n', message: 'x' }]);
  g(sent, ['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  fs.writeFileSync(path.join(sent, 'y.txt'), 'clean\n');
  g(sent, ['add', '.']);
  g(sent, ['commit', '-q', '-m', 'y']);
  assert.deepEqual(hook(['pre-tool', '--harness', 'claude'], toolPayload('claude', 'git push', sent)), { code: 0, stdout: '', stderr: '' });
  // Not an outbound act: passes even over a dirty history.
  const dirty = repo('not-push', [{ file: 'z.txt', text: TOKEN + '\n', message: 'z' }]);
  assert.deepEqual(hook(['pre-tool', '--harness', 'claude'], toolPayload('claude', 'git log --oneline', dirty)), { code: 0, stdout: '', stderr: '' });
  assert.deepEqual(hook(['pre-tool', '--harness', 'kiro'], { hook_event_name: 'preToolUse', cwd: dirty, tool_name: 'fs_read', tool_input: { path: 'z.txt' } }), { code: 0, stdout: '', stderr: '' });
});

test('pre-tool: gh pr create is checked in its text, its body file and the commits it may push', { skip: skipGit }, () => {
  const r = repo('pr', []);
  const text = hook(['pre-tool', '--harness', 'claude'], toolPayload('claude', 'gh pr create --title t --body "mail ' + EMAIL + '"', r));
  assert.equal(text.code, 2);
  assert.match(text.stderr, /  command:1: email/);
  fs.writeFileSync(path.join(r, 'body.md'), 'line\nkey ' + TOKEN + '\n');
  const body = hook(['pre-tool', '--harness', 'codex'], toolPayload('codex', 'gh pr create --base main --body-file body.md', r));
  assert.equal(body.code, 2);
  assert.match(body.stderr, /body\.md:2: credential/);
  fs.writeFileSync(path.join(r, 'clean.md'), 'a clean body\n');
  assert.deepEqual(hook(['pre-tool', '--harness', 'kiro'], toolPayload('kiro', 'gh pr create --body-file clean.md', r)), { code: 0, stdout: '', stderr: '' });
  const dirty = repo('pr-dirty', [{ file: 'k.txt', text: TOKEN + '\n', message: 'k' }]);
  assert.equal(hook(['pre-tool', '--harness', 'claude'], toolPayload('claude', 'gh pr create --fill', dirty)).code, 2);
});

test('pre-tool: a check that cannot run blocks the outbound act (fail closed) and says why', { skip: skipGit }, () => {
  const r = repo('no-git', [{ message: 'clean' }]);
  const out = hook(['pre-tool', '--harness', 'claude'], toolPayload('claude', 'git push', r), { PATH: '/nonexistent' });
  assert.equal(out.code, 2);
  assert.match(out.stderr, /could not run \(GitNotFound\)/);
  const bad = hook(['pre-tool', '--harness', 'claude'], 'not json');
  assert.equal(bad.code, 2);
  assert.match(bad.stderr, /could not run/);
});

// ------------------------------------------------------------------------------------------- the deadline

// QA on PR #605: synchronous work cannot be interrupted by the asynchronous deadline, so each place that can
// run long is bounded where it runs. Each row: what is slow or endless, the expected answer, and a wall-clock
// ceiling well under the harness's 30 s. The deadline is shortened to 1.5 s (MHW_HOOK_TEST=1 only).
test('the pre-tool deadline holds where synchronous work could outlast it (table)', { skip: (!GIT && 'git is not on PATH') || (process.platform === 'win32' && 'POSIX: a FIFO and a shell-script git') }, () => {
  const dir = path.join(BASE, 'deadline');
  fs.mkdirSync(dir);
  const r = repo('deadline-repo', [{ message: 'clean' }]);
  // A git that answers only after 10 s: the hook must kill it and block, not wait and pass.
  const slow = path.join(dir, 'slowbin');
  fs.mkdirSync(slow);
  fs.writeFileSync(path.join(slow, 'git'), '#!/bin/sh\nsleep 10\nexec ' + JSON.stringify(GIT) + ' "$@"\n', { mode: 0o755 });
  const fifo = path.join(r, 'body.fifo');
  assert.equal(spawnSync('mkfifo', [fifo]).status, 0);
  const huge = path.join(r, 'huge.md');
  fs.writeFileSync(huge, '');
  fs.truncateSync(huge, 2_000_000); // over max_bytes (1 000 000), sparse
  const env = { MHW_HOOK_TEST: '1', MHW_HOOK_DEADLINE_MS: '1500' };
  /** @type {Array<{ name: string, command: string, env?: Record<string, string>, code: number, stderr: RegExp, ms: number }>} */
  const rows = [
    { name: 'a slow git is killed at the deadline', command: 'git push', env: { PATH: slow + ':' + (process.env.PATH || '') }, code: 2, stderr: /could not run \(TimeoutError\)/, ms: 6000 },
    { name: 'a FIFO body file is refused unread', command: 'gh pr create --body-file body.fifo', code: 2, stderr: /could not run \(NotARegularFile\)/, ms: 6000 },
    { name: 'a device body file is refused unread', command: 'gh pr create --body-file /dev/zero', code: 2, stderr: /could not run \(NotARegularFile\)/, ms: 6000 },
    { name: 'a body file over max_bytes is refused unread', command: 'gh pr create --body-file huge.md', code: 2, stderr: /could not run \(TooLargeToCheck\)/, ms: 6000 },
    { name: 'a long command text is read in linear time', command: 'echo ' + 'gh pr '.repeat(4000), code: 0, stderr: /^$/, ms: 6000 },
  ];
  for (const row of rows) {
    const t0 = Date.now();
    const out = hook(['pre-tool', '--harness', 'claude'], toolPayload('claude', row.command, r), { ...env, ...(row.env || {}) });
    const ms = Date.now() - t0;
    assert.equal(out.code, row.code, row.name + ': ' + out.stderr);
    assert.match(out.stderr, row.stderr, row.name);
    assert.ok(ms < row.ms, row.name + ': took ' + ms + ' ms');
  }
});

// The table's late-pass row, run in process so the payload arrives at once (QA round 2 on PR #605): a
// 4.8 MB non-push command text takes longer than a 40 ms deadline to read, and the pass it reaches comes in
// late, so it must turn into a block. With the late-pass rule removed the answer is a pass (code 0).
test('the pre-tool deadline: a pass that comes in after the deadline is a block (late-pass row)', async () => {
  const payload = Buffer.from(JSON.stringify({ hook_event_name: 'PreToolUse', cwd: BASE, tool_name: 'Bash', tool_input: { command: 'echo ' + 'a '.repeat(2_400_000) } }));
  const r = await run(['pre-tool', '--harness', 'claude'], { PATH: process.env.PATH || '' }, { stdin: Readable.from([payload]), deadlineMs: 40 });
  assert.equal(r.code, 2);
  assert.match(r.stderr, /could not run \(TimeoutError\)/);
});

// ------------------------------------------------------------------------------------------- self-contained

test('the script imports only node: modules and its two core files', () => {
  const seen = new Set();
  const queue = [SCRIPT];
  const foreign = [];
  while (queue.length) {
    const f = /** @type {string} */ (queue.shift());
    if (seen.has(f)) continue;
    seen.add(f);
    const code = fs.readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const m of code.matchAll(/(?:^|[\s;}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm)) {
      const spec = m[1] || m[2];
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('./') || spec.startsWith('../')) queue.push(path.resolve(path.dirname(f), spec));
      else foreign.push(spec);
    }
  }
  assert.deepEqual(foreign, []);
  assert.deepEqual([...seen].map((f) => path.relative(ROOT, f).split(path.sep).join('/')).sort(),
    ['src/hooks/pattern-check.js', 'src/lib/clean-unicode.js', 'src/lib/clean.js']);
});
