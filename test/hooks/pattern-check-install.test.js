// The fixed-pattern check as `mhw install-user` installs it (#588), in a throwaway HOME: the hook entries of
// Claude Code, Codex and Kiro point at the installed script, never at mhw, and the INSTALLED commands, run
// the way each harness runs a command hook (through a shell, one payload on stdin), block a synthetic
// finding and pass a clean one. Then --check is clean and uninstall removes every file. POSIX only: the user
// layer is macOS and Linux (#497). Fixtures are assembled at run time (J).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { J } from '../clean/corpus.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NAME = 'personal-multi-harness-workstation-configuration';
const POSIX = process.platform !== 'win32';
const GIT = which('git');
const skip = (!POSIX && 'the user layer is POSIX') || (!GIT && 'git is not on PATH');
const TOKEN = J('gh', 'p_', 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8');
const BASE = POSIX ? fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-588-install-'))) : '';
after(() => {
  if (BASE) fs.rmSync(BASE, { recursive: true, force: true });
});

/** @param {string} home @param {string[]} args @param {Record<string, string>} [extra] */
function install(home, args, extra = {}) {
  const env = { PATH: '/usr/bin:/bin', HOME: home, TMPDIR: path.join(BASE, 'tmp'), SHELL: '/bin/zsh', LANG: 'C', MHW_NODE: process.execPath, ...extra };
  fs.mkdirSync(env.TMPDIR, { recursive: true });
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-user', '--overlay=none',
    '--managed-root=' + path.join(BASE, 'admin'), ...args], { env, encoding: 'utf8', timeout: 120000 });
  return { code: p.status, out: p.stdout + p.stderr };
}

/** Every command of one event in a Claude Code or Codex hooks document. @param {any} doc @param {string} ev */
const commandsOf = (/** @type {any} */ doc, /** @type {string} */ ev) => /** @type {string[]} */ (doc.hooks?.[ev] || []).flatMap((/** @type {any} */ g) => (g.hooks || []).map((/** @type {any} */ h) => h.command));

/** Run an installed hook command as a harness does: through a shell, the payload on stdin. @param {string} cmd @param {unknown} payload @param {string} cwd @param {Record<string, string>} [extra] */
function runHook(cmd, payload, cwd, extra = {}) {
  const p = spawnSync('/bin/sh', ['-c', cmd], { input: JSON.stringify(payload), encoding: 'utf8', cwd, env: { PATH: process.env.PATH || '', HOME: BASE, ...extra }, timeout: 30000 });
  return { code: p.status, stdout: p.stdout, stderr: p.stderr };
}

/** A repository with one pushed commit and one unpushed commit carrying text. @param {string} name @param {string} text */
function repo(name, text) {
  const r = path.join(BASE, name);
  fs.mkdirSync(r);
  const env = { PATH: process.env.PATH || '', HOME: BASE, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'F',
    GIT_AUTHOR_EMAIL: J('f', '@', 'example.com'), GIT_COMMITTER_NAME: 'F', GIT_COMMITTER_EMAIL: J('f', '@', 'example.com') };
  const g = (/** @type {string[]} */ a) => assert.equal(spawnSync(/** @type {string} */ (GIT), ['-C', r, ...a], { env }).status, 0, a.join(' '));
  g(['init', '-q', '-b', 'main']);
  fs.writeFileSync(path.join(r, 'a.txt'), 'a\n');
  g(['add', '.']);
  g(['commit', '-q', '-m', 'a']);
  g(['update-ref', 'refs/remotes/origin/main', 'HEAD']);
  fs.writeFileSync(path.join(r, 'b.txt'), text);
  g(['add', '.']);
  g(['commit', '-q', '-m', 'b']);
  return r;
}

test('install writes each harness\'s hook entries at the installed script; the installed commands block and pass', { skip }, () => {
  const home = path.join(BASE, 'home');
  fs.mkdirSync(home);
  const r = install(home, []);
  assert.equal(r.code, 0, r.out);
  const data = path.join(home, '.local', 'share', NAME);
  const script = path.join(data, 'pattern-check', 'src', 'hooks', 'pattern-check.js');
  for (const f of ['package.json', 'src/hooks/pattern-check.js', 'src/lib/clean.js', 'src/lib/clean-unicode.js']) {
    assert.ok(fs.statSync(path.join(data, 'pattern-check', f)).isFile(), f);
  }
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  const codex = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'));
  const kiro = JSON.parse(fs.readFileSync(path.join(home, '.kiro', 'hooks', NAME + '-pattern-check.json'), 'utf8'));
  /** @type {Record<string, { prompt: string, tool: string }>} */
  const cmds = {
    claude: {
      prompt: /** @type {string} */ (commandsOf(settings, 'UserPromptSubmit').find((c) => c.includes('pattern-check.js'))),
      tool: /** @type {string} */ (commandsOf(settings, 'PreToolUse').find((c) => c.includes('pattern-check.js'))),
    },
    codex: {
      prompt: /** @type {string} */ (commandsOf(codex, 'UserPromptSubmit').find((c) => c.includes('pattern-check.js'))),
      tool: /** @type {string} */ (commandsOf(codex, 'PreToolUse').find((c) => c.includes('pattern-check.js'))),
    },
    kiro: {
      prompt: kiro.hooks.find((/** @type {any} */ h) => h.trigger === 'UserPromptSubmit').action.command,
      tool: kiro.hooks.find((/** @type {any} */ h) => h.trigger === 'PreToolUse').action.command,
    },
  };
  assert.equal(settings.hooks.PreToolUse.find((/** @type {any} */ g) => g.hooks.some((/** @type {any} */ h) => h.command === cmds.claude.tool)).matcher, 'Bash');
  for (const [harness, c] of Object.entries(cmds)) {
    for (const cmd of [c.prompt, c.tool]) {
      assert.ok(cmd && cmd.includes('"' + script + '"'), harness + ': names the installed script');
      assert.ok(!cmd.includes('mhw.js') && !/\bmhw\b(?!-)/.test(cmd.replaceAll(NAME, '')), harness + ': never mhw');
      assert.ok(cmd.includes('--harness ' + harness), harness);
    }
  }
  // The paste filter's prompt hook stays registered beside it, unchanged (until #600).
  const paste = {
    claude: commandsOf(settings, 'UserPromptSubmit').filter((c) => c.includes('hook prompt --harness claude')),
    codex: commandsOf(codex, 'UserPromptSubmit').filter((c) => c.includes('hook prompt --harness codex')),
    kiro: [JSON.parse(fs.readFileSync(path.join(home, '.kiro', 'hooks', NAME + '-paste-filter.json'), 'utf8')).hooks[0].action.command],
  };

  const dirty = repo('dirty', 'key ' + TOKEN + '\n');
  const clean = repo('clean', 'nothing here\n');
  /** @param {string} harness @param {{ code: number | null, stdout: string }} r */
  const blocked = (harness, r) => (harness === 'kiro' ? r.code === 2 : r.stdout.includes('"decision": "block"'));
  for (const [harness, c] of Object.entries(cmds)) {
    const own = paste[/** @type {'claude'} */ (harness)];
    assert.equal(own.length, 1, harness + ': one paste filter entry');
    // Every installed prompt hook of this harness, on one dirty prompt: exactly one block message, never the token.
    for (const marker of /** @type {Array<Record<string, string>>} */ (harness === 'kiro' ? [{}] : [{}, { PMHWC_PASTE_WRAPPER: '1' }])) {
      const runs = [own[0], c.prompt].map((cmd) => runHook(cmd, { prompt: 'use ' + TOKEN }, BASE, marker));
      assert.equal(runs.filter((r) => blocked(harness, r)).length, 1, harness + ' ' + JSON.stringify(marker) + ': one block message');
      assert.ok(runs.every((r) => !(r.stdout + r.stderr).includes(TOKEN)));
    }
    // In a wrapped session the block comes from the fixed-pattern check (Claude Code and Codex).
    if (harness !== 'kiro') assert.ok(blocked(harness, runHook(c.prompt, { prompt: 'use ' + TOKEN }, BASE, { PMHWC_PASTE_WRAPPER: '1' })), harness);
    assert.deepEqual(runHook(c.prompt, { prompt: 'a clean prompt' }, BASE), { code: 0, stdout: '', stderr: '' }, harness);
    const tool = (/** @type {string} */ command, /** @type {string} */ cwd) => runHook(c.tool, { hook_event_name: 'PreToolUse', cwd, tool_name: 'Bash', tool_input: { command } }, cwd);
    assert.equal(tool('git push origin main', dirty).code, 2, harness + ': a dirty push');
    assert.equal(tool('git -C ' + dirty + ' push', clean).code, 2, harness + ': git -C <dir> push');
    assert.deepEqual(tool('git push origin main', clean), { code: 0, stdout: '', stderr: '' }, harness + ': a clean push');
  }

  // A hook whose script is gone still answers in the harness protocol: the prompt passes visibly, a push is blocked.
  fs.renameSync(script, script + '.moved');
  const gone = runHook(cmds.claude.prompt, { prompt: 'x' }, BASE);
  assert.match(JSON.parse(gone.stdout).systemMessage, /NOT checked/);
  const goneTool = runHook(cmds.codex.tool, { cwd: clean, tool_input: { command: 'git push' } }, clean);
  assert.equal(goneTool.code, 2);
  assert.match(goneTool.stderr, /HookStartError/);
  fs.renameSync(script + '.moved', script);

  assert.equal(install(home, ['--check']).code, 0, 'check is clean after install');
  const u = install(home, ['--uninstall']);
  assert.ok(!fs.existsSync(path.join(data, 'pattern-check')), u.out);
  assert.ok(!fs.existsSync(path.join(home, '.kiro', 'hooks', NAME + '-pattern-check.json')));
  const after = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  assert.ok(!JSON.stringify(after).includes('pattern-check.js'));
});

test('--hooks=managed leaves the Claude Code and Codex entries to the admin layer; Kiro keeps its file', { skip }, () => {
  const home = path.join(BASE, 'home-managed');
  fs.mkdirSync(home);
  assert.equal(install(home, ['--hooks=managed']).code, 0);
  const settings = fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8');
  assert.ok(!settings.includes('pattern-check.js'));
  assert.ok(!fs.existsSync(path.join(home, '.codex', 'hooks.json')));
  assert.ok(fs.existsSync(path.join(home, '.kiro', 'hooks', NAME + '-pattern-check.json')));
});

// The settings merge's half (src/render/settings-merge.js), on every OS: the check's two entries are placed
// once, kept on a second merge, and removed again without leaving an emptied PreToolUse list behind, while an
// owner's own PreToolUse entry stays.
test('the settings merge places the check\'s entries once, and removes them without a trace', async () => {
  const { merged, unmerged, pasteGroup, toolGroup } = await import('../../src/render/settings-merge.js');
  const { parse } = await import('../../src/lib/jq-json.js');
  const promptCmd = '/bin/sh -c \'"/n" "/d/pattern-check/src/hooks/pattern-check.js" prompt --harness claude\'';
  const toolCmd = '/bin/sh -c \'"/n" "/d/pattern-check/src/hooks/pattern-check.js" pre-tool --harness claude\'';
  const paste = pasteGroup('/bin/sh -c \'"/n" "/m/bin/mhw.js" hook prompt --harness claude\'');
  const on = { prompt: pasteGroup(promptCmd), tool: toolGroup(toolCmd) };
  const off = { prompt: null, tool: null };
  const floor = ['Bash(sudo:*)'];
  /** @param {any} doc */
  const hooks = (doc) => JSON.parse(JSON.stringify(Object.fromEntries([...doc.get('hooks')].map(([k, v]) => [k, v.map((/** @type {any} */ g) => Object.fromEntries([...g].map(([a, b]) => [a, b instanceof Array ? b.map((/** @type {any} */ h) => Object.fromEntries(h)) : b])))]))));
  const fresh = merged(new Map(), floor, paste, 'release: x; commit: y', on);
  const h = hooks(fresh);
  assert.deepEqual(Object.keys(h), ['UserPromptSubmit', 'PreToolUse']);
  assert.equal(h.UserPromptSubmit.length, 2);
  assert.equal(h.UserPromptSubmit[1].hooks[0].command, promptCmd);
  assert.equal(h.PreToolUse.length, 1);
  assert.equal(h.PreToolUse[0].matcher, 'Bash');
  assert.deepEqual(h.PreToolUse[0].hooks.map((/** @type {any} */ x) => [x.type, x.command]), [['command', toolCmd]]);
  assert.deepEqual(hooks(merged(fresh, floor, paste, 'release: x; commit: y', on)), h, 'a second merge changes nothing');
  // Off again: back to exactly what a merge without the check writes, with no PreToolUse left.
  assert.deepEqual(hooks(merged(fresh, floor, paste, 'release: x; commit: y', off)), hooks(merged(new Map(), floor, paste, 'release: x; commit: y', off)));
  assert.ok(!(/** @type {any} */ (merged(fresh, floor, paste, 'release: x; commit: y', off).get('hooks'))).has('PreToolUse'));
  // An owner's own PreToolUse group is kept, before ours, and stays when ours goes.
  const owner = /** @type {Map<string, any>} */ (parse('{"hooks": {"PreToolUse": [{"matcher": "Edit", "hooks": [{"type": "command", "command": "/opt/mine"}]}]}}'));
  const withOwner = merged(owner, floor, paste, 'release: x; commit: y', on);
  assert.deepEqual(hooks(withOwner).PreToolUse.map((/** @type {any} */ g) => g.matcher), ['Edit', 'Bash']);
  assert.deepEqual(hooks(merged(withOwner, floor, paste, 'release: x; commit: y', off)).PreToolUse.map((/** @type {any} */ g) => g.matcher), ['Edit']);
  // Uninstall takes both entries out.
  const gone = unmerged(fresh, floor);
  assert.ok(!gone.has('hooks') || !JSON.stringify(hooks(gone)).includes('pattern-check'));
});
