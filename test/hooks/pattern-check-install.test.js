// The fixed-pattern check as `mhw install-user` installs it (#588), in a throwaway HOME: the hook entries of
// Claude Code, Codex and Kiro point at the installed script, never at mhw (since #600 nothing renders
// `mhw hook prompt`, and an earlier install's entries are removed), and the INSTALLED commands, run
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
import { JUDGE_PROMPT } from '../../src/render/term-judge.js';

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

/** Every command hook's command of one event in a Claude Code or Codex hooks document. @param {any} doc @param {string} ev */
const commandsOf = (/** @type {any} */ doc, /** @type {string} */ ev) => /** @type {string[]} */ (doc.hooks?.[ev] || []).flatMap((/** @type {any} */ g) => (g.hooks || []).filter((/** @type {any} */ h) => h.type !== 'prompt').map((/** @type {any} */ h) => h.command));
/** Every `prompt`-type hook of one event (#589), as written. @param {any} doc @param {string} ev */
const promptHooksOf = (/** @type {any} */ doc, /** @type {string} */ ev) => /** @type {any[]} */ (doc.hooks?.[ev] || []).flatMap((/** @type {any} */ g) => (g.hooks || []).filter((/** @type {any} */ h) => h.type === 'prompt'));

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
  // #600: `mhw hook prompt` left the CLI. No rendered hook names it, its module or the deferral flag, and the
  // check's entry is the only prompt hook of each harness.
  const promptCmds = { claude: commandsOf(settings, 'UserPromptSubmit'), codex: commandsOf(codex, 'UserPromptSubmit'),
    kiro: kiro.hooks.filter((/** @type {any} */ h) => h.trigger === 'UserPromptSubmit').map((/** @type {any} */ h) => h.action.command) };
  const everything = [JSON.stringify(settings), JSON.stringify(codex), JSON.stringify(kiro)].join('\n');
  for (const gone of ['hook prompt', 'hook-entry', 'hook-prompt', 'defer-to-paste-filter', 'bin/mhw.js']) assert.ok(!everything.includes(gone), 'a rendered hook names ' + gone);
  // #589: the third-party term check is one `prompt`-type UserPromptSubmit entry, on Claude Code only, in a
  // group of its own; Codex parses a prompt hook and skips it, and Kiro has none, so neither gets one.
  assert.deepEqual(promptHooksOf(settings, 'UserPromptSubmit'), [{ type: 'prompt', prompt: JUDGE_PROMPT, timeout: 30 }]);
  assert.ok(settings.hooks.UserPromptSubmit.some((/** @type {any} */ g) => g.hooks.length === 1 && g.hooks[0].type === 'prompt' && !('matcher' in g)));
  assert.deepEqual(promptHooksOf(settings, 'PreToolUse'), []);
  assert.deepEqual([...promptHooksOf(codex, 'UserPromptSubmit'), ...promptHooksOf(codex, 'PreToolUse')], [], 'codex: no prompt hook');
  assert.ok(!kiro.hooks.some((/** @type {any} */ h) => h.action?.type !== 'command'), 'kiro: command hooks only');
  assert.ok(!everything.replace(JSON.stringify(JUDGE_PROMPT), '').includes('third-party term check'), 'the term check is rendered once, on Claude Code');
  assert.ok(!fs.existsSync(path.join(home, '.kiro', 'hooks', NAME + '-paste-filter.json')), 'the retired Kiro hook file was written');

  const dirty = repo('dirty', 'key ' + TOKEN + '\n');
  const clean = repo('clean', 'nothing here\n');
  /** @param {string} harness @param {{ code: number | null, stdout: string }} r */
  const blocked = (harness, r) => (harness === 'kiro' ? r.code === 2 : r.stdout.includes('"decision": "block"'));
  for (const [harness, c] of Object.entries(cmds)) {
    assert.deepEqual(promptCmds[/** @type {'claude'} */ (harness)], [c.prompt], harness + ': the check is the only prompt hook');
    // The check blocks a dirty prompt with and without the paste wrapper's session marker: nothing defers now.
    for (const marker of /** @type {Array<Record<string, string>>} */ ([{}, { PMHWC_PASTE_WRAPPER: '1' }])) {
      const r = runHook(c.prompt, { prompt: 'use ' + TOKEN }, BASE, marker);
      assert.ok(blocked(harness, r), harness + ' ' + JSON.stringify(marker) + ': blocked');
      assert.ok(!(r.stdout + r.stderr).includes(TOKEN));
    }
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
  assert.ok(!JSON.stringify(after).includes('third-party term check'), 'uninstall removes the term check');
});

test('install over a home an earlier release set up removes every `mhw hook prompt` entry and its Kiro file (#600)', { skip }, () => {
  const home = path.join(BASE, 'home-upgrade');
  fs.mkdirSync(home);
  const data = path.join(home, '.local', 'share', NAME);
  const old = (/** @type {string} */ h) => "/bin/sh -c '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE \"" + process.execPath
    + '" "' + path.join(ROOT, 'bin', 'mhw.js') + '" hook prompt --harness ' + h + ' --config "' + path.join(data, 'clipboard.conf') + "\" || exit 0'";
  const owner = { type: 'command', command: '/bin/echo the owner own hook' };
  fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [owner, { type: 'command', command: old('claude'), timeout: 30 }] }] } }, null, 2) + '\n');
  fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
  fs.writeFileSync(path.join(home, '.codex', 'hooks.json'), JSON.stringify({ description: 'managed-by: ' + NAME + '; old', hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: old('codex') }] }] } }, null, 2) + '\n');
  const oldKiro = path.join(home, '.kiro', 'hooks', NAME + '-paste-filter.json');
  fs.mkdirSync(path.dirname(oldKiro), { recursive: true });
  fs.writeFileSync(oldKiro, '{\n  "version": "v1",\n  "hooks": [\n    {\n      "description": "managed-by: ' + NAME + '; old",\n      "trigger": "UserPromptSubmit",\n'
    + '      "action": {"type": "command", "command": ' + JSON.stringify(old('kiro')) + '}\n    }\n  ]\n}\n');
  const before = install(home, ['--check']);
  assert.notEqual(before.code, 0, 'check sees the old layer');
  assert.match(before.out, new RegExp('STALE   ' + oldKiro.replaceAll('/', '\\/').replaceAll('.', '\\.') + ': the Kiro prompt hook that ran mhw hook prompt'));
  const r = install(home, []);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /REMOVED .*-paste-filter\.json \(the Kiro prompt hook that ran mhw hook prompt, removed \(#600\)\)/);
  assert.ok(!fs.existsSync(oldKiro));
  const settings = JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8'));
  const codex = JSON.parse(fs.readFileSync(path.join(home, '.codex', 'hooks.json'), 'utf8'));
  for (const doc of [settings, codex]) assert.ok(!JSON.stringify(doc).includes('hook prompt'), JSON.stringify(doc.hooks));
  assert.ok(commandsOf(settings, 'UserPromptSubmit').includes(owner.command), "the owner's own hook is kept");
  assert.equal(install(home, ['--check']).code, 0, 'check is clean after the upgrade');
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
