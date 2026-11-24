// mhw install, update, uninstall and postinstall in Node (#495, S24 of #470): the cases of the deleted
// global/workstation_test.py that the parity golden (lifecycle-golden.test.js) does not already hold, as
// node:test. Throwaway HOMEs and admin roots only (WORKSTATION_MANAGED_ROOT, so no sudo ever runs); never a
// real configuration. The pty arm runs a real terminal through test/helpers/pty-run.py (CPython's pty module),
// since #590 removed the vendored node-pty with the paste wrapper, its only runtime user.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { throwawayHome, which } from '../helpers/home.js';
import { issues, ownerSteps, show, adminAccess, asRoot, SUDO, confirm } from '../../src/lib/lifecycle.js';
import { install } from '../../src/commands/install.js';
import { uninstall } from '../../src/commands/uninstall.js';
import { latestRelease, updateLines, npmBinary, update } from '../../src/commands/update.js';
import { main, parse } from '../../src/commands/lifecycle.js';
import { adminPresent } from '../../src/lib/readers/admin.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const JQ = !!which('jq');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** An Io that keeps what it is given. */
function sink() {
  const s = { text: '', err: '', io: /** @type {import('../../src/lib/lifecycle.js').Io} */ ({ out: (t) => { s.text += t; }, err: (t) => { s.err += t; }, tty: false }) };
  return s;
}

/** A throwaway HOME and admin root, with an environment that names nothing of the real one. @param {string} label */
function box(label) {
  const h = throwawayHome(label);
  cleanups.push(h.cleanup);
  // The installers' own rule: a start-up file is written for $SHELL; /bin/sh is one they know no file for.
  const env = { PATH: process.env.PATH || '', HOME: h.home, TMPDIR: path.join(h.dir, 'tmp'), WORKSTATION_MANAGED_ROOT: h.root, SHELL: '/bin/sh',
    LANG: 'C.UTF-8', WORKSTATION_OVERLAY: 'none', MHW_NODE: process.execPath, MHW_CMD: './mhw' };
  return { ...h, env };
}

/** Files under dir, relative. @param {string} dir */
const filesUnder = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((d) => d.isFile()) : []);

test('install lines: an owner value is a pending write and no owner step; CHANGED lines are always shown (Issue #145)', () => {
  const drift = ['DRIFT   /h/.claude/settings.json: install would change model "opus[1m]" -> "claude-opus-5-5[1m]" (model defaults claude-code)',
    'OK      /h/.codex/config.toml: x (model defaults codex)'];
  assert.equal(issues(drift), 1);
  const changed = ['CHANGED /h/.claude/settings.json: model "opus[1m]" -> "claude-opus-5-5[1m]" (model defaults claude-code; previous file kept as /h/.claude/settings.json.pmhwc-models-backup)'];
  assert.equal(issues(changed), 0);
  assert.deepEqual(ownerSteps([...drift, ...changed]), []);
  const s = sink();
  show(['OK      /h/a', 'CHANGED /h/.zshrc: paste-wrapper start-up block present -> absent (previous file kept as /h/.zshrc.pmhwc-backup)', 'WROTE   /h/b'], false, s.io);
  assert.deepEqual(s.text.split('\n').filter(Boolean), ['    CHANGED /h/.zshrc: paste-wrapper start-up block present -> absent (previous file kept as /h/.zshrc.pmhwc-backup)']);
});

test("owner steps: install's own acts become next steps; a start-up line is no longer one (#590)", () => {
  const steps = ownerSteps([
    'NOTE    automatic paste cleaning: no shell start-up file is written (--shell-rc=none); add this line to yours:',
    '        [ -r "/h/snippet.sh" ] && . "/h/snippet.sh"',
    'RESTART REQUIRED: open fresh Claude Code and Codex sessions before further work; Codex hook trust remains an owner action in /hooks.']);
  // The paste wrapper is removed: even an old installer's NOTE asks the owner to add nothing.
  assert.deepEqual(steps, ['In Codex, approve the mhw hooks once: type /hooks in a new session.']);
  assert.deepEqual(ownerSteps(['OK      something']), []);
});

test('sudo never runs without a terminal, and is one call that asks for the password itself (Issue #113)', () => {
  const s = sink();
  assert.equal(adminAccess(false, {}, s.io), false);
  assert.equal(s.text, '');
  assert.equal(adminAccess(true, {}, s.io), true);
  assert.match(s.text, /==> Administrator access\n/);
  assert.equal(adminAccess(false, { WORKSTATION_MANAGED_ROOT: '/tmp/x' }, s.io), true);
  const [exe, args] = asRoot(['/bin/sh', 'x.sh', '--remove'], {});
  assert.equal(exe, SUDO);
  assert.equal(args[0], '-k');
  assert.ok(!args.includes('-n') && !args.includes('-v'));
  assert.deepEqual(args.slice(-3), ['/bin/sh', 'x.sh', '--remove']);
  assert.deepEqual(asRoot(['/bin/sh', 'x.sh', '--remove'], { WORKSTATION_MANAGED_ROOT: '/tmp/r' }), ['/bin/sh', ['x.sh', '--remove', '--root=/tmp/r']]);
});

test('latest release: numeric order and strictness', () => {
  assert.equal(latestRelease(['v3.0.0', 'v3.10.0', 'v3.9.9', 'v4.0.0-rc1', 'v10', 'latest', 'v3.2.1']), 'v3.10.0');
  assert.equal(latestRelease(['v1', 'rc', 'v2.0.0-beta']), null);
  assert.equal(latestRelease([' v1.0.0 ', 'v1.0.0']), 'v1.0.0');
});

test('update lines: the npm line for no tag, a tag, and a refused tag', () => {
  const major = /^current_version\s*=\s*"(\d+\.\d+\.\d+)"/m.exec(fs.readFileSync(path.join(ROOT, '.bumpversion.toml'), 'utf8'));
  assert.deepEqual(updateLines(undefined, ROOT).out, ['UPDATE  run this npm line, then mhw install:', 'RUN     npm install -g github:tedeuxx/mhw#semver:^' + major?.[1]]);
  assert.deepEqual(updateLines('v4.2.0', ROOT).out?.[1], 'RUN     npm install -g github:tedeuxx/mhw#v4.2.0');
  for (const bad of ['4.2.0', 'v4.2', 'main', 'v4.2.0;x']) assert.deepEqual(updateLines(bad, ROOT), { code: 2, err: 'REFUSE  the tag must be a numeric release, vX.Y.Z' });
  assert.deepEqual(updateLines(undefined, path.join(ROOT, 'no-such-dir')).out?.[1], 'RUN     npm install -g github:tedeuxx/mhw#semver:*');
});

test('npm is found beside the running node by absolute path, never on PATH', { skip: !POSIX && 'POSIX: mhw update in an npm install is macOS and Linux' }, () => {
  const b = box('npm-binary');
  const node = path.join(b.dir, 'n', 'node');
  fs.mkdirSync(path.dirname(node));
  fs.writeFileSync(node, '');
  assert.equal(npmBinary({}, node), null);
  fs.writeFileSync(path.join(b.dir, 'n', 'npm'), '#!/bin/sh\n', { mode: 0o755 });
  assert.equal(npmBinary({}, node), path.join(b.dir, 'n', 'npm'));
  assert.equal(npmBinary({ MHW_NPM: '/abs/npm' }, node), '/abs/npm');
  assert.equal(npmBinary({ MHW_NPM: 'rel/npm' }, 'node'), null);
});

test('update without git on PATH refuses with a line, before anything runs', { skip: !POSIX && 'POSIX' }, () => {
  const b = box('nogit');
  const root = path.join(b.dir, 'checkout');
  fs.mkdirSync(path.join(root, '.git'), { recursive: true });
  const s = sink();
  assert.equal(update(undefined, {}, { PATH: path.join(b.dir, 'empty') }, s.io, { root }), 2);
  assert.equal(s.err, 'REFUSE  git was not found on PATH; update needs it\n');
  assert.equal(s.text, '');
});

test('main refuses a bad --overlay before running anything, for install, update and uninstall', () => {
  for (const cmd of ['install', 'uninstall', 'update']) {
    const s = sink();
    assert.equal(main([cmd, '--overlay=/nonexistent/overlay/dir'], { PATH: '' }, { io: s.io }), 2);
    assert.equal(s.err, "mhw: --overlay takes 'none' or an existing directory\n");
    assert.equal(s.text, '');
  }
  assert.deepEqual(parse('update', ['v1.0.0', '--yes']), { command: 'update', overlay: null, verbose: false, admin: false, wanted: 'v1.0.0', method: false, yes: true, noAdmin: false });
  assert.deepEqual(parse('install', ['--yes', 'x']), { err: 'mhw: unknown argument for install: x' });
});

test('RETURN reads one key; anything else aborts (no terminal: the first character of a line)', { skip: !POSIX && 'POSIX' }, () => {
  // Without a terminal on fd 0, confirm() reads a line; the parity golden never reaches it (no terminal).
  const probe = 'import { confirm } from ' + JSON.stringify(path.join(ROOT, 'src', 'lib', 'lifecycle.js')) + ';\n'
    + 'process.exitCode = confirm({}, { out: () => {}, err: () => {}, tty: false }) ? 0 : 1;\n';
  for (const [input, code] of /** @type {Array<[string, number]>} */ ([['\n', 0], ['n\n', 1], ['', 1], ['yes\n', 1], ['x', 1], ['\r\n', 0]])) {
    const p = spawnSync(process.execPath, ['--input-type=module', '-e', probe], { input, encoding: 'utf8', timeout: 20000 });
    assert.equal(p.status, code, JSON.stringify(input) + ': ' + p.stderr);
  }
  assert.equal(typeof confirm, 'function');
});

test('an admin layer that was planned and not installed is not a success (PR #114 lens)', { skip: (!POSIX || !JQ) && 'POSIX sh and jq' }, () => {
  const b = box('partial');
  const s = sink();
  const code = install({ yes: true }, b.env, s.io, { asking: false, access: () => false });
  assert.equal(code, 1, s.text);
  assert.ok(s.text.includes('Partly installed: your settings are in place; the system-wide protections are not.'), s.text);
  assert.ok(!s.text.includes('Installation successful!'));
  assert.match(s.text, /^1\. Run `\S+ install` in a terminal to install the system-wide protections/m);
  assert.ok(fs.existsSync(path.join(b.home, '.claude', 'CLAUDE.md')));
  assert.deepEqual(filesUnder(b.root), []);
});

test('a failed admin-layer removal still removes the user layer, and the uninstall is incomplete (QA U2 on PR #542)', { skip: !POSIX && 'the admin layer is macOS and Linux only' }, () => {
  // workstation.py went on to install.sh --uninstall after install-managed.sh --remove failed; so does Node, with
  // the installers that replaced them (mhw install-admin, #496, and mhw install-user, #503).
  const b = box('remove-fails');
  const dropin = b.root + (process.platform === 'darwin' ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code')
    + '/managed-settings.d/50-personal-multi-harness-workstation-configuration.json';
  fs.mkdirSync(path.dirname(dropin), { recursive: true });
  fs.writeFileSync(dropin, '{"personal-multi-harness-workstation-configuration": "x"}');
  /** @type {string[][]} */
  const calls = [];
  const s = sink();
  const code = uninstall({ yes: true }, b.env, s.io, {
    asking: false, access: () => true,
    run: (exe, args) => {
      calls.push([exe, ...args]);
      return args.includes('--remove') ? [5, ['REFUSE  stand-in: the removal failed']] : [0, ['REMOVED stand-in user layer']];
    },
  });
  assert.equal(code, 1, s.text);
  assert.equal(calls.length, 2, JSON.stringify(calls));
  assert.ok(calls[0].includes('--remove') && calls[0].includes('install-admin') && calls[0][0] === process.execPath, JSON.stringify(calls[0]));
  assert.ok(calls[1].includes('--uninstall') && calls[1].includes('install-user') && calls[1][0] === process.execPath, JSON.stringify(calls[1]));
  assert.ok(s.text.includes('==> Removing your settings\n'), s.text);
  assert.ok(s.text.includes('Uninstall incomplete:\n  - System-wide protections (exit 5; `'), s.text);
  assert.ok(!s.text.includes('Uninstall complete.'), s.text);
});

test('an uninstall that leaves the admin layer is partly removed, and names no npm uninstall (PR #114 lens)', { skip: (!POSIX || !JQ) && 'POSIX sh and jq' }, () => {
  const b = box('partial-un');
  const s = sink();
  assert.equal(install({ yes: true }, b.env, s.io, { asking: false }), 0, s.text);
  assert.ok(adminPresent(b.env));
  const u = sink();
  const code = uninstall({ yes: true }, b.env, u.io, { asking: false, access: () => false, npm: true });
  assert.equal(code, 1, u.text);
  assert.ok(adminPresent(b.env));
  assert.ok(u.text.includes('Partly removed: your settings are gone; the system-wide protections are still installed.'), u.text);
  assert.ok(!u.text.includes('Uninstall complete.'));
  assert.ok(!u.text.includes('npm uninstall'));
  assert.match(u.text, /^1\. Run `\S+ uninstall` in a terminal to remove the system-wide protections/m);
});

/** @param {string} section */
function briefSection(section) {
  const brief = fs.readFileSync(path.join(ROOT, 'global', 'AGENTS.md'), 'utf8').replaceAll('\r\n', '\n');
  assert.ok(brief.includes('\n## ' + section + '\n'), section);
  return brief.split('\n## ' + section + '\n')[1].split('\n## ')[0].split(/\s+/).filter(Boolean).join(' ');
}

test("the user-level brief's session-start, goal, close and hook sections (Issues #80, #11, #65; ADR-0035)", () => {
  const cases = /** @type {Array<[string, string[]]>} */ ([
    ['Session-start runtime summary', ['mhw status --summary', 'mhw status --verbose', 'Claude Code `/status`', 'Codex `/status`', 'Kiro `/context show` and `/tools`', 'agent harness']],
    ['Session goal anchor', ['objective with the owner in one line', 'Claude Code `/goal`', 'Codex `/goal`', 'Kiro CLI `/goal`', 'first reply', 'not a hook']],
    ['Session close', ['`Objective reached: <objective>`', 'evidence', 'Never ask him whether to close', 'what is left', 'not a hook']],
    ['Hooks only for existential risk', ['Use hooks on this workstation only to mitigate existential risk', 'The one declared exception', '`cc-status`', 'make no permission decision',
      "one-line output is added to the model's context on", 'each prompt submit and at session start (measured 2026-10-10)', 'leftover to remove, not an exception; `mhw status` lists it', 'not enforcement']],
  ]);
  for (const [section, needles] of cases) {
    const text = briefSection(section);
    for (const n of needles) assert.ok(text.includes(n), section + ': ' + n);
  }
});

// ------------------------------------------------------------------- the conversation in a real terminal

const PY = which('python3');
const ptySkip = (!POSIX && 'POSIX') || (!JQ && 'needs jq') || (!PY && 'needs python3 for the pty driver') || false;

/** `./mhw install --overlay=none` on a pty, answering the prompt with key. @param {ReturnType<typeof box>} b @param {string} key */
function inTerminal(b, key) {
  /** @type {Record<string, string>} */
  const env = { ...b.env, TERM: 'dumb', NO_COLOR: '1' };
  delete env.WORKSTATION_OVERLAY;
  const p = spawnSync(/** @type {string} */ (PY), ['-I', '-B', path.join(ROOT, 'test', 'helpers', 'pty-run.py'), Buffer.from(key).toString('hex'), '120', '--',
    process.execPath, path.join(ROOT, 'mhw'), 'install', '--overlay=none'], { cwd: b.dir, env, encoding: 'utf8', timeout: 150000 });
  assert.equal(p.status, 0, p.stderr);
  const r = JSON.parse(p.stdout.trim().split('\n').pop() || '{}');
  assert.notEqual(r.code, null, 'no exit within 120 s: ' + String(r.text).slice(-400));
  return { code: /** @type {number} */ (r.code), text: String(r.text).replaceAll('\r\n', '\n') };
}

test('live: in a real terminal, RETURN installs and another key aborts (Issue #113)', { skip: ptySkip }, () => {
  const b = box('pty');
  const brief = path.join(b.home, '.claude', 'CLAUDE.md');
  const no = inTerminal(b, 'n');
  assert.equal(no.code, 1, no.text);
  assert.ok(no.text.includes('Aborted; nothing was changed.'), no.text);
  assert.ok(!fs.existsSync(brief));
  const ctrlC = inTerminal(b, '\x03');
  assert.equal(ctrlC.code, 1, ctrlC.text);
  assert.ok(!fs.existsSync(brief));
  const yes = inTerminal(b, '\r');
  assert.equal(yes.code, 0, yes.text);
  assert.ok(yes.text.includes('Installation successful!'), yes.text);
  assert.match(yes.text, /^1\. Open new Claude Code, Codex and Kiro sessions/m);
  assert.ok(fs.existsSync(brief));
  // Short: the result and the next steps, not the installers' lines.
  assert.ok(yes.text.trim().split('\n').length <= 20, yes.text);
});
