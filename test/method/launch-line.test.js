// mhw launch-line (#476, S05 of #470; /handoff of #198): the behaviour the deleted Python suite measured
// through a probe COPY of launch-line.py that declared one launch variable. The Node command reads its
// allowlist from io.launchEnv in-process (tests only; the command line has no way to set it), so the
// accepted-variable path is measured without a second copy of the code. The rest of /handoff's checks run
// against the real CLI in global/method/method_commands_test.py; the bytes are held by s05-golden.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run, LAUNCH, LAUNCH_ENV } from '../../src/commands/launch-line.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const PROBE_VAR = 'MHW_PROBE_LAUNCH_VAR';
const base = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-launch-')));
after(() => fs.rmSync(base, { recursive: true, force: true }));
// The checkout's name carries the characters that break a hand-quoted path: a space, ', $ and backticks.
const CHECKOUT = path.join(base, "it's a $HOME `id` checkout");
fs.mkdirSync(path.join(CHECKOUT, '.git'), { recursive: true });
const PROMPT = ["Objective: ship the owner's handoff command", 'Next act: not $HOME or $(date) or `id`.', 'Evidence: \\n and "quoted" and !!'].join('\n');
const SHELLS = POSIX ? ['sh', 'bash', 'zsh'].map((s) => which(s)).filter((s) => s !== null) : [];
/** @type {Record<string, string>} */
const ENV = {};
for (const [k, v] of Object.entries(process.env)) if (v !== undefined) ENV[k] = v;
ENV.TMPDIR = base;
ENV.TEMP = base;

/**
 * @param {string} target
 * @param {string} prompt
 * @param {string[]} [extra]
 * @param {readonly string[]} [launchEnv]
 */
function launch(target, prompt, extra = [], launchEnv) {
  const f = path.join(fs.mkdtempSync(path.join(base, 'p-')), 'prompt.txt');
  fs.writeFileSync(f, prompt);
  let out = '';
  let err = '';
  const code = run([target, f, '--cd', CHECKOUT, ...extra], { cwd: base, env: ENV, out: (s) => { out += s; }, err: (s) => { err += s; }, launchEnv });
  return { code, out, err };
}

/** The block's one command line; fails unless stdout is exactly one fenced block. @param {string} stdout */
function theLine(stdout) {
  const lines = stdout.replace(/\n$/, '').split('\n');
  assert.ok(/^`{3,}$/.test(lines[0]) && lines[lines.length - 1] === lines[0], 'not one fenced block');
  return lines.slice(1, -1).join('\n');
}

/**
 * Run the block's line with the harness command defined as a function printing PWD, the named variables
 * and each argument, NUL-separated: what the agent harness would receive.
 * @param {string} shell
 * @param {string} line
 * @param {string} command
 * @param {string[]} [names]
 */
function argvThrough(shell, line, command, names = []) {
  const printer = 'printf "PWD=%s\\0" "$PWD"; ' + names.map((n) => 'printf "%s=%s\\0" ' + n + ' "$' + n + '"; ').join('');
  const head = command.split(' ')[0] + ' ';
  assert.ok(line.includes(head), 'the command is not in the line');
  const script = 'harness_argv() { ' + printer + 'printf \'%s\\0\' "$@"; }\n' + line.replace(head, 'harness_argv ');
  const p = spawnSync(shell, ['-c', script], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  return p.stdout.split('\0').slice(0, -1);
}

test('the method declares no launch variable, so every --env is refused, naming none', () => {
  assert.deepEqual([...LAUNCH_ENV], []);
  for (const name of ['HARNESS_SWEEP_ORIGIN', PROBE_VAR, 'CODEX_HOME']) {
    const r = launch('codex', PROMPT, ['--env', name + '=https://example.org']);
    assert.equal(r.code, 1, name);
    assert.equal(r.out, '');
    assert.match(r.err, /--env 1: the name is not a declared launch variable \(none is declared\)/);
  }
});

test('a declared launch variable becomes part of the block, exactly, through every shell', { skip: !SHELLS.length && 'needs a POSIX shell' }, () => {
  for (const value of ['https://example.org', 'it\'s $x `y` \\ "q" !!']) {
    const r = launch('claude', PROMPT, ['--env', PROBE_VAR + '=' + value], [PROBE_VAR]);
    assert.equal(r.code, 0, r.err);
    const line = theLine(r.out);
    const cd = "cd '" + CHECKOUT.replaceAll("'", "'\\''") + "' && ";
    assert.ok(line.startsWith(cd + PROBE_VAR + "='"), line.slice(0, 80));
    for (const shell of SHELLS) assert.deepEqual(argvThrough(/** @type {string} */ (shell), line, 'claude', [PROBE_VAR]), ['PWD=' + CHECKOUT, PROBE_VAR + '=' + value, PROMPT], shell);
  }
  for (const bad of ['1X=a', 'X-Y=a', PROBE_VAR + '=/Use' + 'rs/someone', PROBE_VAR + '=a\nb']) {
    const r = launch('codex', PROMPT, ['--env', bad], [PROBE_VAR]);
    assert.equal(r.code, 1, bad);
    assert.equal(r.out, '');
    assert.doesNotMatch(r.err, /someone/);
  }
});

test('only declared launch variables are accepted, and a refused value is never echoed', () => {
  const secret = 'SENTINELVALUE';
  for (const name of ['CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'KIRO_HOME', 'XDG_CONFIG_HOME', 'ANTHROPIC_BASE_URL', 'OPENAI_BASE_URL', 'GIT_CONFIG_COUNT',
    'GIT_CONFIG_PARAMETERS', 'EDITOR', 'GIT_ASKPASS', 'PATH', 'NODE_OPTIONS', 'DYLD_INSERT_LIBRARIES', 'LD_PRELOAD', PROBE_VAR.toLowerCase(), PROBE_VAR + '_X', PROBE_VAR.slice(0, -1)]) {
    const r = launch('codex', PROMPT, ['--env', name + '=' + secret], [PROBE_VAR]);
    assert.equal(r.code, 1, name);
    assert.equal(r.out, '');
    assert.match(r.err, new RegExp('--env 1: the name is not a declared launch variable \\(' + PROBE_VAR + '\\)'));
    assert.doesNotMatch(r.err, new RegExp(secret));
  }
  assert.equal(launch('codex', PROMPT, ['--env', PROBE_VAR + '=https://example.org'], [PROBE_VAR]).code, 0);
});

test('terminal and bidi controls in an --env value are refused without echo', () => {
  const secret = 'SENTINELTEXT';
  for (const ch of ['\x03', '\x1b[201~', '\x15', '\t', '\r', '\x7f', String.fromCodePoint(0x202e), String.fromCodePoint(0x2066), '\n']) {
    const r = launch('codex', PROMPT, ['--env', PROBE_VAR + '=a' + ch + secret], [PROBE_VAR]);
    assert.equal(r.code, 1, JSON.stringify(ch));
    assert.equal(r.out, '');
    assert.match(r.err, /--env 1: the value carries a control character/);
    assert.doesNotMatch(r.err, new RegExp(secret));
  }
});

test('the command line cannot widen the allowlist: an environment variable named like the probe does nothing', () => {
  const f = path.join(base, 'cli-prompt.txt');
  fs.writeFileSync(f, PROMPT);
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'launch-line', 'codex', f, '--cd', CHECKOUT, '--env', PROBE_VAR + '=x'],
    { cwd: base, env: { ...ENV, [PROBE_VAR]: 'x', LAUNCH_ENV: PROBE_VAR, MHW_LAUNCH_ENV: PROBE_VAR }, encoding: 'utf8' });
  assert.equal(p.status, 1);
  assert.match(p.stderr, /none is declared/);
  const src = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'launch-line.js'), 'utf8');
  assert.doesNotMatch(src, /process\.env|io\.env\.[A-Z]|env\[['"][A-Z]/, 'launch-line.js reads no variable of its own environment');
});

test('each target prints its own start command, and the block runs once, inside the checkout', { skip: !SHELLS.length && 'needs a POSIX shell' }, () => {
  for (const [target, command] of Object.entries(LAUNCH)) {
    const r = launch(target, PROMPT);
    assert.equal(r.code, 0, r.err);
    const line = theLine(r.out);
    for (const shell of SHELLS) {
      assert.equal(spawnSync(/** @type {string} */ (shell), ['-n', '-c', line]).status, 0, shell);
      assert.deepEqual(argvThrough(/** @type {string} */ (shell), line, command), ['PWD=' + CHECKOUT, ...command.split(' ').slice(1), PROMPT], target + ' ' + shell);
    }
  }
});

test('the usage lines name mhw launch-line', () => {
  let err = '';
  const io = { cwd: base, env: ENV, out: () => {}, err: (/** @type {string} */ s) => { err += s; } };
  assert.equal(run(['cursor', 'x', '--cd', CHECKOUT], io), 2);
  assert.equal(err, 'usage: mhw launch-line <claude|claude-code|codex|kiro|kiro-cli> <prompt-file> --cd <checkout> [--env NAME=VALUE]...\n');
  err = '';
  assert.equal(run(['--resolve'], io), 2);
  assert.equal(err, 'usage: mhw launch-line --resolve <claude-code|codex|kiro> [<first word>]\n');
});
