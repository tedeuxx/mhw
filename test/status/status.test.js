// mhw status in Node (#493, S22 of #470): the cases global/workstation_test.py and its OwnerActions
// class held for the status view, moved with it. Pure rendering from hand-built facts, the readers on
// throwaway HOMEs and admin roots, and the owner-action count against a stand-in gh only (never the real
// one, never the network). The end-to-end parity is test/status/status-golden.test.js.
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as st from '../../src/commands/status.js';
import { keyVerdict, readKey, mismatchLine } from '../../src/lib/readers/version-key.js';
import { readHooks, hooksText, LEFTOVER, GUARD, OLD_PASTE, KIRO_HOOK, OLD_KIRO_HOOK, oldPasteLeftover, hookPromptLeftover, hookNodeText, termListsState } from '../../src/lib/readers/hooks.js';
import { adminState, adminInstalled, adminDropin, adminStamp, adminPresent, issues } from '../../src/lib/readers/admin.js';
import { readSettings, methodState, permissionsText, unreadSources } from '../../src/lib/readers/settings.js';
import { rootBriefFindings, mainCheckoutOf, workspace } from '../../src/lib/readers/workspace.js';
import * as oa from '../../src/lib/readers/owner-actions.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const NAME = 'personal-multi-harness-workstation-configuration';
const MARKER = 'managed-by: ' + NAME;
st.useWordsOf(ROOT);
const W = st.words();
const STAMP = 'release: v3.1.0; commit: ' + 'a'.repeat(40);
const USER_FLOOR = 'the user layer only; a session flag can drop it (--setting-sources project, measured); install the admin copy with ./mhw install --admin';
const ENV = { HOME: '/h' };

/** A throwaway directory, removed after the test. */
function tmp(label = 's22') {
  // .native: on Windows it expands an 8.3 short name (RUNNER~1), as the paths git prints are expanded.
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-' + label + '-')));
}
/** @param {string} file @param {string | Buffer} text */
function write(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** @param {Partial<st.Facts>} [over] @returns {st.Facts} */
function facts(over = {}) {
  return /** @type {st.Facts} */ ({
    source: STAMP, user_stamps: { 'Claude Code': STAMP, Codex: STAMP }, admin: false, admin_stamp: 'none', user_issues: 0,
    admin_issues: 0, user_lines: ['OK      /h/.claude/CLAUDE.md (x)'], admin_lines: [],
    harnesses: { 'Claude Code': '2.1.0', Codex: null, Kiro: null },
    workspace: { name: 'proj', root: '/proj', carriers: ['.workstation-version'] }, plugins: [],
    brief: 'installed in 2/3 agent harnesses (an instruction)', floor: USER_FLOOR, admin_state: 'absent',
    hooks: 'user layer (paste filter)', key: { required: '>=3.1 <4', state: 'match', line: '' },
    runtime: 'host (Linux x86_64; no container marker found)',
    chrome_debugging: 'off (devtools.remote_debugging.user-enabled absent; no DevToolsActivePort)', ...over,
  });
}

/** @param {string[]} out @param {string} label */
function row(out, label) {
  const hits = out.filter((l) => l.startsWith('  ' + label.padEnd(16) + ' '));
  assert.equal(hits.length, 1, label + ': ' + out.join('\n'));
  return hits[0].slice(19);
}

describe('version key', () => {
  /** @param {string} r @param {string} rel */
  const verdict = (r, rel) => keyVerdict(r, rel)[0];
  test('range bounds', () => {
    for (const [r, rel, want] of [['>=3.1 <4', 'v3.1.0', 'match'], ['>=3.1 <4', 'v3.9.12', 'match'], ['>=3.1 <4', 'v3.0.9', 'mismatch'],
      ['>=3.1 <4', 'v4.0.0', 'mismatch'], ['>=3.1,<4', 'v3.2.0', 'match'], ['>3.1 <=3.2', 'v3.1.0', 'mismatch'], ['>3.1 <=3.2', 'v3.2.0', 'match'],
      ['>3.1 <=3.2', 'v3.2.1', 'mismatch'], ['=3.1.2', 'v3.1.2', 'match'], ['=3.1.2', 'v3.1.3', 'mismatch'], ['>=v3', 'v3.0.0', 'match']]) {
      assert.equal(verdict(r, rel), want, r + ' ' + rel);
    }
  });
  test('installed release forms', () => {
    assert.equal(verdict('>=3.1 <4', 'unreleased, after v3.1.0'), 'match');
    assert.equal(verdict('>=3.1 <4', 'unreleased, after v3.0.0'), 'mismatch');
    for (const rel of ['none', '', 'unreleased, no tag reachable', 'mixed', 'unknown, not a git checkout (.bumpversion.toml says 3.1.0)',
      'v3.1', '3.1.0', 'v3.1.0-rc1', 'not v3.1.0']) assert.equal(verdict('>=0', rel), 'mismatch', rel);
  });
  test('invalid ranges', () => {
    for (const r of ['', '~3.1', '>=a', '3.1', '>= 3.1', '>=3.1.2.4']) assert.equal(verdict(r, 'v3.1.0'), 'invalid', r);
    assert.equal(keyVerdict('', 'v3.1.0')[1], 'Workstation version key: .workstation-version holds no valid range (empty range).');
    assert.equal(keyVerdict('~3.1', 'v3.1.0')[1], 'Workstation version key: .workstation-version holds no valid range (not a comparator: ~3.1).');
  });
  test('Unicode decimal digits count, as Python\'s \\d and int() read them', () => {
    assert.equal(verdict('>=٣', 'v3.0.0'), 'match');
    assert.equal(verdict('>=3', 'v٣.0.0'), 'match');
  });
  test('the key file: its first meaningful line', () => {
    assert.equal(readKey('# comment\n\n  >=3.1 <4  # why\n<9\n'), '>=3.1 <4');
    assert.equal(readKey('# only a comment\n'), '');
  });
  test('the mismatch line is the brief\'s line', () => {
    const brief = fs.readFileSync(path.join(ROOT, 'global', 'AGENTS.md'), 'utf8');
    const m = /^`(Workstation version key: required <range>.*)`$/m.exec(brief);
    assert.ok(m);
    const want = m[1].replace('<range>', '>=3.1 <4').replace('<release>', 'v3.0.0');
    assert.deepEqual(keyVerdict('>=3.1 <4', 'v3.0.0'), ['mismatch', want]);
    assert.deepEqual(keyVerdict('>=3.1 <4', 'v3.1.0'), ['match', '']);
  });
});

describe('the status view', () => {
  test('short view', () => {
    const out = st.renderStatus(facts());
    assert.ok(out.length <= 17); // 16 since the hook node and 17 since the term lists (#488)
    assert.ok(out.includes('  source           v3.1.0 @ aaaaaaa (this checkout)'));
    assert.ok(out.includes('  installed        user: v3.1.0 @ aaaaaaa · admin: not installed'));
    assert.ok(out.includes('  check            matches this checkout'));
    assert.ok(out.includes('  agent harnesses  Claude Code'));
    assert.ok(out.includes('  version key      >=3.1 <4: match'));
    assert.ok(out.some((l) => l.startsWith('  layers           managed: absent · user: installed · workspace: proj (.workstation-version) · plugin: none')));
    assert.ok(!out.some((l) => l.startsWith('  |')));
  });
  test('a mismatch prints the line', () => {
    const line = mismatchLine('>=3.1 <4', 'v3.0.0');
    const out = st.renderStatus(facts({ key: { required: '>=3.1 <4', state: 'mismatch', line } }));
    assert.ok(out.includes('  version key      >=3.1 <4: mismatch'));
    assert.ok(out.includes('                   ' + line));
  });
  test('differences, the admin layer and an absent key', () => {
    const out = st.renderStatus(facts({ admin: true, admin_stamp: STAMP, user_issues: 1, admin_issues: 2, key: null }));
    assert.ok(out.includes('  check            3 target(s) differ (admin layer: 2); run ./mhw install'));
    assert.ok(out.includes('  installed        user: v3.1.0 @ aaaaaaa · admin: v3.1.0 @ aaaaaaa'));
    assert.ok(out.some((l) => l.includes('managed: installed')));
    assert.ok(out.includes('  version key      none (.workstation-version absent in the workspace)'));
  });
  test('two user stamps are both shown', () => {
    const other = 'release: unreleased, after v3.0.0; commit: ' + 'b'.repeat(40) + '-dirty';
    const out = st.renderStatus(facts({ user_stamps: { 'Claude Code': STAMP, Codex: other } }));
    assert.ok(out.includes('  installed        user: unreleased, after v3.0.0 @ bbbbbbb-dirty / v3.1.0 @ aaaaaaa · admin: not installed'));
  });
  test('verbose adds detail', () => {
    const out = st.renderStatus(facts({ plugins: ['p@m'] }), true);
    assert.ok(out.includes('  agent harness    Codex: not on PATH'));
    assert.ok(out.includes('  plugin           p@m'));
    assert.ok(out.includes('  | OK      /h/.claude/CLAUDE.md (x)'));
  });
  test('the permissions line, and the chrome debugging line', () => {
    assert.ok(st.renderStatus(facts({ permissions: 'Claude Code: acceptEdits (user), 37 allow rules' })).includes('  permissions      Claude Code: acceptEdits (user), 37 allow rules'));
    assert.ok(!st.renderStatus(facts()).some((l) => l.startsWith('  permissions')));
    assert.ok(st.renderStatus(facts()).includes('  chrome debugging off (devtools.remote_debugging.user-enabled absent; no DevToolsActivePort)'));
    assert.ok(!st.renderStatus(facts({ chrome_debugging: null })).some((l) => l.startsWith('  chrome debugging')));
  });
  test('the issue count: neither OK nor SKIP', () => {
    assert.equal(issues(['OK      a', 'STAMP   b', 'DRIFT   c', 'MISSING d', 'STALE   e', 'SKIP    f', 'FLOOR   g', 'NOTE    h', 'SOURCE  i']), 4);
  });
  test('stamps: the short form and the release field', () => {
    assert.equal(st.shortStamp(STAMP), 'v3.1.0 @ aaaaaaa');
    assert.equal(st.shortStamp('none'), 'none');
    assert.equal(st.shortStamp(''), 'none');
    assert.equal(st.shortStamp('release: a; commit: x; commit: y'), 'a; commit: x @ y');
    assert.equal(st.shortStamp('release: a; commit: b c'), 'release: a; commit: b c');
    assert.equal(st.releaseOf(STAMP), 'v3.1.0');
    assert.equal(st.releaseOf('other'), 'other');
    assert.equal(st.releaseOf(''), 'none');
  });
  test('the admin layer report names each entry and removed control', () => {
    const lines = ['STALE   /r/bin/restart_guard.py: x', 'STALE   /r/breaking-glass/', 'DRIFT   /r/bin/clipboard_guard.py (stamp)', 'MISSING /r/m.json'];
    assert.deepEqual(st.renderStatus(facts({ admin_lines: lines, admin_code: 1, admin_issues: 4 })).filter((l) => l.startsWith('  admin layer')), [
      '  admin layer      the admin layer differs from this checkout: 4 target(s)',
      '  admin layer      STALE restart_guard.py, breaking-glass',
      '  admin layer      DRIFT clipboard_guard.py',
      '  admin layer      MISSING m.json',
      '  admin layer      removed controls still installed: restart guard, timed breaking-glass',
      '  admin layer      ' + W.adminNext]);
  });
});

describe('the runtime summary', () => {
  const OTHER = 'release: v3.0.0; commit: ' + 'b'.repeat(40);
  const STAMP_LINE = 'STAMP   /h/.codex/AGENTS.md: content matches, but it carries (' + OTHER + ') and the source is (' + STAMP + ')';
  const brief = st.briefPaths(ENV)['Claude Code'];
  test('user drift is named by category with the next step', () => {
    const lines = ['SOURCE  release: v3.1.0; commit: aaaaaaa', 'OK      /h/.codex/AGENTS.md (x)', 'DRIFT   ' + brief + ' (release: v3.0.0; commit: bbbbbbb)', 'FLOOR   carried by: the user layer only'];
    const out = st.renderSummary(facts({ user_lines: lines, user_issues: 1 }), ENV);
    assert.ok(out.length <= 10);
    const r = row(out, 'protections');
    assert.ok(r.includes('drift: 1 target(s) in brief — next: ' + W.cmd + ' install'));
    assert.ok(!r.includes(brief));
    assert.ok(!r.includes('bbbbbbb'));
  });
  test('a clean check shows no drift text', () => {
    const r = row(st.renderSummary(facts({ user_lines: ['OK      ' + brief + ' (x)', 'SKIP    something', 'FLOOR   carried by: the admin layer'] }), ENV), 'protections');
    for (const w of ['drift', 'stamp:', 'next:']) assert.ok(!r.includes(w));
  });
  test('a STAMP-only user check is not clean, and is worded apart from content drift', () => {
    assert.equal(st.driftText([STAMP_LINE], [], 0, ENV), 'stamp: 1 target(s) from v3.0.0 @ bbbbbbb, content matches — next: ' + W.cmd + ' install');
    const r = row(st.renderSummary(facts({ user_lines: ['OK      /h/x (y)', STAMP_LINE] }), ENV), 'protections');
    assert.ok(r.includes(' · stamp: 1 target(s) from v3.0.0 @ bbbbbbb'));
    assert.ok(!r.includes('/h/.codex'));
    const drift = 'DRIFT   ' + brief + ' (' + OTHER + ')';
    assert.equal(st.driftText([drift, STAMP_LINE, STAMP_LINE.replace('codex', 'kiro')], [], 0, ENV),
      'drift: 1 target(s) in brief; stamp: 2 target(s) from v3.0.0 @ bbbbbbb, content matches — next: ' + W.cmd + ' install');
  });
  test('the summary names the compared source', () => {
    const out = st.renderSummary(facts({ user_stamps: { Codex: OTHER } }), ENV);
    assert.equal(row(out, 'workstation'), 'v3.0.0 @ bbbbbbb · source: checkout v3.1.0 @ aaaaaaa · version key: >=3.1 <4 match');
    assert.equal(st.sourceText(STAMP), 'checkout v3.1.0 @ aaaaaaa');
  });
  test('an admin STAMP is a stamp, not admin drift', () => {
    const admin = [STAMP_LINE.replace('/h/.codex/AGENTS.md', '/Library/x/managed-settings.d/50-x.json')];
    for (const code of [0, 1]) assert.equal(st.driftText([], admin, code, ENV), 'stamp: 1 target(s) from admin v3.0.0 @ bbbbbbb, content matches — next: ' + W.cmd + ' install');
    assert.equal(st.stampOrigin('STAMP   /h/x: other'), 'another source');
    assert.equal(st.stampOrigin('STAMP   /h/.claude.json: policy MCP server(s) match, but recorded under (' + OTHER + ') and the source is (' + STAMP + ')'), 'v3.0.0 @ bbbbbbb');
    assert.equal(st.stampOrigin('STAMP   x carries (none) y'), 'another source');
  });
  test('categories and the admin layer', () => {
    const user = ['MISSING /h/.zshrc: no paste-wrapper start-up block; install adds it',
      'DRIFT   /h/.claude/settings.json (2 deny-floor rule(s) missing; or a hook entry is missing)',
      'STALE   /h/.local/share/x/restart-state: the removed restart guard\'s baselines',
      'REFUSE  /h/.codex/hooks.json: exists and is NOT managed by this project',
      'MISSING /h/.claude/skills/shell/SKILL.md', 'DRIFT   /h/somewhere/else.txt'];
    const admin = ['DRIFT   /Library/Application Support/ClaudeCode/managed-settings.d/50-x.json (stamp)'];
    assert.ok(row(st.renderSummary(facts({ user_lines: user, admin_lines: admin, admin_code: 1 }), ENV), 'protections')
      .includes('drift: 7 target(s) in paste wrapper, deny floor, removed controls, hooks, method, other, admin deny floor — next: ' + W.cmd + ' install'));
    assert.equal(st.driftText([], ['NOTE    could not read'], 3, ENV), 'drift: 1 target(s) in admin layer — next: ' + W.cmd + ' install');
    assert.equal(st.driftText([], [], 0, ENV), '');
  });
  test('every item in ten lines', () => {
    const out = st.renderSummary(facts(), ENV);
    assert.ok(out.length <= 10);
    assert.equal(row(out, 'agent harness'), 'Claude Code 2.1.0');
    assert.equal(row(out, 'model, effort'), 'Claude Code: default; the session\'s own values: Claude Code /status');
    assert.equal(row(out, 'workstation'), 'v3.1.0 @ aaaaaaa · source: checkout v3.1.0 @ aaaaaaa · version key: >=3.1 <4 match');
    assert.equal(row(out, 'layers'), 'managed: absent · user: installed · workspace: proj · plugin: none');
    assert.equal(row(out, 'overrides'), 'no workspace setting overrides a user default');
    assert.equal(row(out, 'cannot override'), 'nothing (no admin layer) · deny floor NOT locked: ' + USER_FLOOR);
    assert.ok(row(out, 'protections').includes('brief installed in 2/3 agent harnesses (an instruction)'));
    assert.ok(row(out, 'protections').includes('evidence: installed; loaded and enforced need a session canary'));
    assert.equal(row(out, 'permission mode'), 'Claude Code: default; session flags: Claude Code /status');
    assert.equal(row(out, 'runtime'), 'host (Linux x86_64; no container marker found)');
  });
  test('a workspace value overrides the user one, and hooks off is named', () => {
    /** @type {import('../../src/lib/readers/settings.js').Setting[]} */
    const settings = [['Claude Code', 'user', 'permissions.defaultMode', 'default'], ['Claude Code', 'workspace', 'permissions.defaultMode', 'acceptEdits'],
      ['Claude Code', 'user', 'model', 'opus'], ['Claude Code', 'user', 'disableAllHooks', 'true'], ['Codex', 'user', 'approval_policy', 'on-request'],
      ['Codex', 'workspace', 'sandbox_mode', 'workspace-write'], ['Codex', 'user', 'model_reasoning_effort', 'high']];
    const out = st.renderSummary(facts({ settings, admin: true, harnesses: { 'Claude Code': '2.1.0', Codex: '0.1', Kiro: null } }), ENV);
    assert.equal(row(out, 'overrides'), 'HOOKS OFF: disableAllHooks in Claude Code user; Claude Code permissions.defaultMode = acceptEdits; Codex sandbox_mode = workspace-write');
    assert.equal(row(out, 'permission mode'), 'Claude Code: permissions.defaultMode acceptEdits (workspace) · Codex: approval_policy on-request (user), sandbox_mode workspace-write (workspace); session flags: Claude Code /status, Codex /status');
    assert.equal(row(out, 'model, effort'), 'Claude Code: model opus (user) · Codex: model_reasoning_effort high (user); the session\'s own values: Claude Code /status, Codex /status');
    assert.equal(row(out, 'cannot override'), 'managed layer (admin-owned) · deny floor NOT locked: ' + USER_FLOOR);
  });
  test('the floor is locked only in the admin layer', () => {
    const adminFloor = 'the admin layer; the user copy stays as a fallback until it is retired (ADR-0016)';
    assert.equal(row(st.renderSummary(facts({ admin: true, admin_state: 'installed', floor: adminFloor }), ENV), 'cannot override'), 'managed layer (admin-owned) · deny floor: ' + adminFloor);
    const none = 'NO complete layer; run ./mhw install, then ./mhw install --admin';
    assert.equal(row(st.renderSummary(facts({ floor: none }), ENV), 'cannot override'), 'nothing (no admin layer) · deny floor NOT locked: ' + none);
  });
  test('a legacy drop-in is never absent', () => {
    for (const [state, want] of [['legacy', 'installed (legacy, pre-#66; reinstall to update)'], ['unreadable', 'present, not read'], ['absent', 'absent']]) {
      assert.ok(row(st.renderSummary(facts({ admin_state: state }), ENV), 'layers').startsWith('managed: ' + want + ' · '));
      assert.ok(st.renderStatus(facts({ admin_state: state })).some((l) => l.startsWith('  layers           managed: ' + want + ' · ')));
    }
    assert.ok(st.renderStatus(facts({ admin_state: 'legacy' })).includes('  installed        user: v3.1.0 @ aaaaaaa · admin: installed (legacy, pre-#66; reinstall to update)'));
    assert.ok(row(st.renderSummary(facts({ admin_state: 'legacy' }), ENV), 'cannot override').startsWith('managed layer (admin-owned) · deny floor NOT locked: '));
  });
  test('a mismatch and no agent harness', () => {
    const line = mismatchLine('>=3.1 <4', 'v3.0.0');
    const out = st.renderSummary(facts({ key: { required: '>=3.1 <4', state: 'mismatch', line }, harnesses: { 'Claude Code': null, Codex: null, Kiro: null } }), ENV);
    assert.equal(out[out.length - 1], '  ' + line);
    assert.ok(out.length <= 11);
    assert.equal(row(out, 'agent harness'), 'none detected on PATH');
    assert.ok(row(out, 'model, effort').includes('Kiro: default'));
    assert.ok(row(out, 'model, effort').includes('Kiro /context show, /tools'));
  });
});

describe('the models and MCP lines', () => {
  /** @param {string[]} lines */
  function mcp(lines) {
    const out = st.renderStatus(facts({ user_lines: lines }));
    const start = out.findIndex((l) => l.startsWith('  mcp active set   '));
    assert.ok(start >= 0);
    const rest = [];
    for (const l of out.slice(start + 1)) {
      if (!l.startsWith(st.MCP_INDENT) || l.startsWith(st.MCP_INDENT + ' ')) break;
      rest.push(l.slice(19));
    }
    return /** @type {[string, string[]]} */ ([out[start].slice(19), rest]);
  }
  const tag = ' (MCP active set)';
  test('the active set names what is on outside and what is missing', () => {
    assert.equal(mcp([])[0], 'not read (the check printed no MCP active-set line)');
    const skip = 'SKIP    MCP active set: not declared in /d/mcp-servers.json (no "active_set"), so nothing is turned off';
    assert.equal(mcp([skip + tag])[0], 'not declared in /d/mcp-servers.json (no "active_set"), so nothing is turned off');
    const ok = ['OK      codex: nothing on outside the set (2 turned off by mhw) (/h/.codex/config.toml)' + tag];
    assert.deepEqual(mcp(ok), ['declared; nothing on outside the set and no set member missing', []]);
    const lines = [...ok,
      'DRIFT   kiro: on outside the set: synth-b (1); install turns them off (/h/.kiro/settings/mcp.json)' + tag,
      'ABSENT  claude-code: set member(s) not configured: synth-a (1); render them with mhw mcp render (/h/.claude.json)' + tag,
      'REPORT  claude-desktop: on outside the set, no native switch for one server (remove it by hand): synth-c (1) (/h/Library/Application Support/Claude/claude_desktop_config.json)' + tag,
      'NOTE    claude-code: 1 claude.ai connector(s) declared on (/h/.claude/settings.json)' + tag];
    const [head, rest] = mcp(lines);
    assert.equal(head, '3 finding(s); ' + W.fix + ' turns off what is on outside the set in 1 agent harness(es)');
    assert.equal(mcp(lines.slice(2, 4))[0], '2 finding(s)');
    assert.deepEqual(rest, ['kiro: on outside the set: synth-b (1); install turns them off',
      'claude-code: set member(s) not configured: synth-a (1); render them with mhw mcp render',
      'claude-desktop: on outside the set, no native switch for one server (remove it by hand): synth-c (1)']);
    assert.equal(issues(lines), 1);
  });
  test('the active set never reads clean when an agent harness was not read', () => {
    const skip = 'SKIP    codex: needs Python 3.11+ (tomllib) to edit config.toml (/h/.codex/config.toml)' + tag;
    const absent = 'SKIP    kiro: not installed (/h/.kiro absent)' + tag;
    const ok = 'OK      claude-code: nothing on outside the set (0 turned off by mhw) (/h/.claude/settings.json)' + tag;
    assert.deepEqual(mcp([skip, absent, ok]), ['declared; not read for codex', ['codex: not read: needs Python 3.11+ (tomllib) to edit config.toml']]);
    assert.equal(mcp([absent, ok])[0], 'declared; nothing on outside the set and no set member missing');
    assert.ok(mcp([skip, 'DRIFT   kiro: on outside the set: synth-b (1); install turns them off (/h/k.json)' + tag])[0].startsWith('not read for codex; 1 finding(s); '));
  });
  test('--mcp-connect is an unknown option of status, in every form, and names mhw mcp check (#595)', () => {
    // The connection test moved to mhw mcp check (test/mcp/check.test.js): status starts no process.
    for (const bad of ['--mcp-connect', '--mcp-connect=2', '--mcp-connect=30', '--mcp-connect=0', '--mcp-connect=x', '--mcp-connect=99999']) {
      /** @type {string[]} */
      const err = [];
      /** @type {string[]} */
      const out = [];
      assert.equal(st.main(['--overlay=none', bad], {}, { err: (l) => err.push(l), out: (l) => out.push(l) }), 2, bad);
      assert.deepEqual(err, ['mhw: unknown argument for status: ' + bad + ' (the MCP connection test is now mhw mcp check [--timeout=SECONDS])']);
      assert.deepEqual(out, [], bad + ': nothing is printed or run');
    }
    assert.equal(typeof (/** @type {Record<string, unknown>} */ (st)).mcpConnectStatus, 'undefined', 'status no longer carries the connection test');
  });
  const SETTINGS = /** @type {import('../../src/lib/readers/settings.js').Setting[]} */ ([['Claude Code', 'user', 'model', 'claude-opus-5-5[1m]'],
    ['Claude Code', 'user', 'effortLevel', 'medium'], ['Codex', 'user', 'model', 'gpt-5.6-sol'], ['Codex', 'user', 'model_reasoning_effort', 'high'],
    ['Kiro', 'user', 'chat.defaultModel', 'claude-sonnet-4.5']]);
  /** @param {string[]} lines @param {typeof SETTINGS} [settings] */
  const models = (lines, settings = SETTINGS) => row(st.renderStatus(facts({ settings, user_lines: lines })), 'models');
  const values = 'Claude Code: model claude-opus-5-5[1m] (user), effortLevel medium (user) · Codex: model gpt-5.6-sol (user), model_reasoning_effort high (user) · Kiro: chat.defaultModel claude-sonnet-4.5 (user)';
  const ok = ['OK      /h/.claude/settings.json: x (model defaults claude-code)'];
  test('values and the policy state', () => {
    assert.equal(models([]), values + '; policy: none (no model-defaults.json in the overlay)');
    assert.equal(models(ok), values + '; policy: matches');
    const differ = [...ok, 'DRIFT   /h/.codex/config.toml: install would change model_reasoning_effort "high" -> "medium" (model defaults codex)',
      'MISSING /h/.kiro/settings/cli.json: install would change (model defaults kiro-cli)'];
    assert.equal(models(differ), values + '; policy: 2 harness(es) differ; mhw install sets them');
  });
  test('a workspace override is never reported as matching', () => {
    const line = models(ok, [...SETTINGS, ['Claude Code', 'workspace', 'model', 'claude-haiku-x']]);
    assert.ok(line.includes('Claude Code: model claude-haiku-x (workspace)'));
    assert.ok(!line.includes('policy: matches'));
    assert.ok(line.includes('policy: user layer matches; overridden by the workspace: Claude Code model'));
  });
});

describe('the root brief', () => {
  const SHADOW = (/** @type {string} */ n) => n + ': AGENTS.md is the root brief; this file makes Claude Code ignore AGENTS.md';
  /** @type {string} */
  let top;
  /** @type {string} */
  let dir;
  beforeEach(() => {
    dir = tmp('root-brief');
    top = path.join(dir, 'parent', 'repo');
    fs.mkdirSync(top, { recursive: true });
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  const env = () => ({ HOME: path.join(dir, 'nohome'), PATH: process.env.PATH || '' });
  const local = () => rootBriefFindings(top, env()).filter((f) => !f.includes('(ancestor)'));
  /** @param {number} n */
  const agents = (n) => fs.writeFileSync(path.join(top, 'AGENTS.md'), 'x'.repeat(n));
  test('a clean workspace has no finding; each shadowing file is named; a directory is not', () => {
    agents(100);
    assert.deepEqual(local(), []);
    for (const n of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
      write(path.join(top, n), '@AGENTS.md\n');
      assert.deepEqual(local(), [SHADOW(n)]);
      fs.unlinkSync(path.join(top, n));
    }
    fs.mkdirSync(path.join(top, 'CLAUDE.md'));
    assert.deepEqual(local(), []);
  });
  test('each ancestor shadow is named, and the user-level brief is not one', () => {
    agents(100);
    for (const n of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) {
      const p = path.join(path.dirname(top), n);
      write(p, 'x\n');
      assert.ok(rootBriefFindings(top, env()).includes(p + ' (ancestor): this file makes Claude Code ignore AGENTS.md'));
      fs.unlinkSync(p);
    }
    const home = path.dirname(top);
    write(path.join(home, '.claude', 'CLAUDE.md'), 'x\n');
    assert.deepEqual(rootBriefFindings(top, { HOME: home, PATH: process.env.PATH || '' }).filter((f) => f.includes(home + path.sep)), []);
  });
  test('the Codex limit is exclusive, and no AGENTS.md is no size finding', () => {
    assert.deepEqual(local(), []);
    agents(32768);
    assert.deepEqual(local(), []);
    agents(32769);
    assert.deepEqual(local(), ['AGENTS.md is 32769 bytes, over 32768: Codex truncates it']);
  });
  test('the workspace carries the findings; status and summary report them', () => {
    agents(100);
    write(path.join(top, 'CLAUDE.md'), 'x\n');
    assert.ok(/** @type {string[]} */ (workspace(top, env(), dir).brief).includes(SHADOW('CLAUDE.md')));
    const found = [SHADOW('CLAUDE.md'), 'AGENTS.md is 40000 bytes, over 32768: Codex truncates it'];
    const space = { name: 'proj', root: '/proj', carriers: ['AGENTS.md', 'CLAUDE.md'], brief: found };
    assert.deepEqual(st.renderStatus(facts({ workspace: space })).filter((l) => l.startsWith('  root brief       ')).map((l) => l.slice(19)), found);
    const summary = st.renderSummary(facts({ workspace: space }), ENV);
    assert.ok(summary.length <= 10);
    assert.ok(row(summary, 'layers').includes('workspace: proj (root brief: 2 finding(s); ' + W.cmd + ' status)'));
    const clean = { ...space, brief: [] };
    assert.ok(!st.renderStatus(facts({ workspace: clean })).some((l) => l.startsWith('  root brief')));
    assert.ok(!st.renderSummary(facts({ workspace: clean }), ENV).join(' ').includes('root brief'));
  });
});

describe('the root brief in git worktrees', { skip: !which('git') && 'needs git' }, () => {
  /** @type {string} */
  let outer;
  /** @type {string} */
  let dir;
  const GIT = /** @type {string} */ (which('git'));
  /** @param {string} cwd @param {string[]} args */
  const git = (cwd, ...args) => assert.equal(spawnSync(GIT, ['-c', 'user.email=t@example.invalid', '-c', 'user.name=t', '-C', cwd, ...args]).status, 0, args.join(' '));
  const env = () => ({ HOME: path.join(dir, 'nohome'), PATH: process.env.PATH || '' });
  beforeEach(() => {
    dir = tmp('root-brief-wt');
    outer = path.join(dir, 'outer');
    for (const n of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md', 'AGENTS.md']) write(path.join(outer, n), 'x\n');
    git(outer, 'init', '-q');
    git(outer, 'add', '-A');
    git(outer, 'commit', '-q', '-m', 'init');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  /** @param {string} t */
  const outerHits = (t) => rootBriefFindings(t, env()).filter((f) => f.startsWith(outer + path.sep) && f.includes('(ancestor'));
  /** @param {string} rel */
  function worktree(rel) {
    const t = path.join(outer, rel);
    fs.mkdirSync(path.dirname(t), { recursive: true });
    git(outer, 'worktree', 'add', '-q', '--detach', t);
    for (const n of ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']) fs.unlinkSync(path.join(t, n));
    return t;
  }
  test('a linked worktree skips its main checkout, under .claude or elsewhere', () => {
    const w = worktree('.claude/worktrees/w');
    assert.equal(mainCheckoutOf(w, env()), outer);
    assert.deepEqual(outerHits(w), []);
    assert.deepEqual(outerHits(worktree('sub/f')), []);
  });
  test('a separate repository nested in a checkout inherits its shadows', () => {
    const t = path.join(outer, '.claude', 'worktrees', 'e');
    write(path.join(t, 'AGENTS.md'), 'x\n');
    git(t, 'init', '-q');
    assert.equal(mainCheckoutOf(t, env()), null);
    assert.deepEqual(outerHits(t).sort(), ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md']
      .map((n) => path.join(outer, n) + ' (ancestor): this file makes Claude Code ignore AGENTS.md').sort());
  });
  test('an ancestor above the main checkout is named as not measured', () => {
    const above = path.join(dir, 'CLAUDE.md');
    write(above, 'x\n');
    assert.ok(rootBriefFindings(worktree('sub/f'), env()).includes(above + ' (ancestor above the main checkout, not measured): this file makes Claude Code ignore AGENTS.md'));
  });
});

describe('the settings readers', () => {
  /** @type {string} */
  let dir;
  beforeEach(() => { dir = tmp('settings'); });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  test('user and workspace layers', () => {
    const home = path.join(dir, 'home');
    write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'opus', permissions: { defaultMode: 'plan', deny: ['x'] } }));
    write(path.join(dir, 'proj', '.claude', 'settings.json'), JSON.stringify({ disableAllHooks: true }));
    write(path.join(home, '.codex', 'config.toml'), 'model = "gpt-x"  # note\napproval_policy = \'never\'\n[profiles.a]\nsandbox_mode = "x"\n');
    assert.deepEqual(readSettings({ HOME: home }, path.join(dir, 'proj')), [['Claude Code', 'user', 'model', 'opus'],
      ['Claude Code', 'user', 'permissions.defaultMode', 'plan'], ['Claude Code', 'workspace', 'disableAllHooks', 'true'],
      ['Codex', 'user', 'approval_policy', 'never'], ['Codex', 'user', 'model', 'gpt-x']]);
  });
  test('the Kiro default model, and values as json.dumps printed them', () => {
    const home = path.join(dir, 'home');
    write(path.join(home, '.kiro', 'settings', 'cli.json'), JSON.stringify({ 'chat.defaultModel': 'claude-sonnet-4.5', 'chat.enableThinking': true }));
    write(path.join(home, '.claude', 'settings.json'), '{"model": "café\\"", "effortLevel": 1.0, "disableAllHooks": [1]}');
    const got = readSettings({ HOME: home }, null);
    assert.ok(got.some((s) => JSON.stringify(s) === JSON.stringify(['Kiro', 'user', 'chat.defaultModel', 'claude-sonnet-4.5'])));
    assert.ok(got.some((s) => s[2] === 'model' && s[3] === 'caf\\u00e9\\'));
    assert.ok(got.some((s) => s[2] === 'effortLevel' && s[3] === '1.0'));
    assert.ok(!got.some((s) => s[2] === 'disableAllHooks'));
  });
  test('the permissions line counts each agent harness\'s allow rules', () => {
    const home = path.join(dir, 'home');
    write(path.join(home, '.claude', 'settings.json'), JSON.stringify({ permissions: { allow: ['a', 'b'], defaultMode: 'acceptEdits' } }));
    write(path.join(home, '.codex', 'rules', 'workstation-allow-list.rules'), 'x(decision="allow")\ny(decision="forbidden")\nz(decision="allow")\n');
    write(path.join(home, '.codex', 'workstation.config.toml'), 'a = 1\nsandbox_mode = "read-only"\n');
    write(path.join(home, '.kiro', 'agents', 'workstation.json'), JSON.stringify({ toolsSettings: { execute_bash: { allowedCommands: 'abc' } } }));
    assert.equal(permissionsText({ HOME: home, WORKSTATION_MANAGED_ROOT: path.join(dir, 'root') }, null),
      'Claude Code: acceptEdits (user), 2 allow rules · Codex: profile workstation (on-request, read-only; with --profile workstation), 2 allow rules · Kiro: agent workstation, 3 trusted commands');
  });
  test('the method: opt-in, and a duplicate named per agent harness', () => {
    const home = path.join(dir, 'home');
    const env = { HOME: home };
    const m = methodState(env, ['METHOD  not installed (opt-in: ...)'], ['tadeumendonca-skills@tadeumendonca']);
    assert.deepEqual(m, { installed: false, duplicate: [] });
    assert.ok(st.methodText(m).includes('opt-in: ./mhw install --method'));
    write(path.join(home, '.codex', 'config.toml'), '[plugins."tadeumendonca-skills@tadeumendonca"]\nenabled = true\n');
    const d = methodState(env, ['METHOD  installed: 8 agents'], ['tadeumendonca-skills@tadeumendonca']);
    assert.deepEqual(d.duplicate, ['Claude Code', 'Codex']);
    assert.ok(st.methodText(d).includes('DUPLICATE'));
    write(path.join(home, '.codex', 'config.toml'), '[plugins."tadeumendonca-skills@tadeumendonca"]\nenabled = false\n');
    assert.deepEqual(methodState(env, ['METHOD  installed: 8 agents'], []).duplicate, []);
    write(path.join(home, '.codex', 'config.toml'), '[plugins.tadeumendonca-skills]\nenabled = falsey\n');
    assert.deepEqual(methodState(env, ['METHOD  installed: 8 agents'], []).duplicate, ['Codex']);
    assert.equal(st.methodText(undefined), 'not reported');
  });
});

describe('the hooks reader', () => {
  /** @type {string} */
  let dir;
  /** @type {Record<string, string>} */
  let env;
  /** @type {string} */
  let data;
  beforeEach(() => {
    dir = tmp('hooks');
    env = { HOME: path.join(dir, 'home'), WORKSTATION_MANAGED_ROOT: path.join(dir, 'root') };
    data = path.join(env.HOME, '.local', 'share', NAME);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  /** @param {string} event @param {string} command */
  const entry = (event, command) => ({ hooks: { [event]: [{ hooks: [{ type: 'command', command }] }] } });
  test('nothing installed', () => {
    assert.deepEqual(readHooks(env), { user: [], admin: [] });
    assert.equal(hooksText(readHooks(env)), 'admin: none · user: none');
  });
  /**
   * The prompt hook command as mhw install-user renders it since #600: the fixed-pattern check's prompt half.
   * @param {string} node @param {string} script @param {string} harness
   */
  const nodeCmd = (node, script, harness) => '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "' + node + '" "'
    + script + '" prompt --harness ' + harness + ' --config "' + path.join(data, 'clipboard.conf') + '"';
  /** `mhw hook prompt`'s command, as installers rendered it from #488 until #600. @param {string} node @param {string} mhwJs @param {string} harness */
  const oldCmd = (node, mhwJs, harness) => '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "' + node + '" "'
    + mhwJs + '" hook prompt --harness ' + harness + ' --config "' + path.join(data, 'clipboard.conf') + '"';
  const script = () => path.join(data, 'pattern-check', 'src', 'hooks', 'pattern-check.js');
  test('user entries count only with their node and entry (#488)', () => {
    const node = path.join(data, 'node');
    const mhw = script();
    write(path.join(env.HOME, '.claude', 'settings.json'), JSON.stringify(entry('UserPromptSubmit', nodeCmd(node, mhw, 'claude'))));
    // PR #536 lens B3: a registered hook that cannot start is a FAIL item, never just absent.
    assert.deepEqual(readHooks(env).user, ['paste filter (Claude Code) FAIL: ' + node + ' and ' + mhw + ' not found, the prompt hook cannot start']);
    write(node, '#\n');
    assert.deepEqual(readHooks(env).user, ['paste filter (Claude Code) FAIL: ' + mhw + ' not found, the prompt hook cannot start'], 'the entry it runs is missing');
    assert.match(hooksText(readHooks(env)), /user: paste filter \(Claude Code\) FAIL: .*pattern-check\.js not found/);
    write(mhw, '#\n');
    write(path.join(env.HOME, '.codex', 'hooks.json'), JSON.stringify(entry('UserPromptSubmit', nodeCmd(node, mhw, 'codex'))));
    assert.deepEqual(readHooks(env).user, ['paste filter (Claude Code)', 'paste filter (Codex)']);
    assert.ok(hookNodeText(env).startsWith(node + ' ('), hookNodeText(env));
    if (process.getuid && process.getuid() !== 0) assert.match(hookNodeText(env), /owner-writable: a process running as you can replace it, or the libraries it loads/);
    fs.unlinkSync(node);
    assert.equal(hookNodeText(env), 'FAIL ' + node + ' not found: the prompt hook cannot run');
  });
  test('the command wrapped in the start fallback is read as the prompt hook (#488)', () => {
    const node = path.join(data, 'node');
    const mhw = script();
    const wrapped = "/bin/sh -c '" + nodeCmd(node, mhw, 'claude') + ' || { printf "%s\\n" "{}"; exit 0; }\'';
    write(path.join(env.HOME, '.claude', 'settings.json'), JSON.stringify(entry('UserPromptSubmit', wrapped)));
    write(node, '#\n');
    write(mhw, '#\n');
    assert.deepEqual(readHooks(env).user, ['paste filter (Claude Code)']);
    fs.unlinkSync(mhw);
    assert.match(String(readHooks(env).user), /FAIL: .*pattern-check\.js not found/);
  });
  test('a `mhw hook prompt` entry or Kiro file an earlier install left is named as a leftover, never as the prompt hook (#600)', () => {
    const node = path.join(data, 'node');
    const mhw = path.join(data, 'pkg', 'bin', 'mhw.js');
    write(node, '#\n');
    write(mhw, '#\n');
    write(path.join(env.HOME, '.claude', 'settings.json'), JSON.stringify(entry('UserPromptSubmit', oldCmd(node, mhw, 'claude'))));
    write(path.join(env.HOME, '.codex', 'hooks.json'), JSON.stringify(entry('UserPromptSubmit', "/bin/sh -c '" + oldCmd(node, mhw, 'codex') + " || exit 0'")));
    assert.deepEqual(readHooks(env).user, [hookPromptLeftover('Claude Code'), hookPromptLeftover('Codex')]);
    assert.equal(hookNodeText(env), 'no prompt hook registered');
    fs.rmSync(path.join(env.HOME, '.claude'), { recursive: true });
    fs.rmSync(path.join(env.HOME, '.codex'), { recursive: true });
    const old = path.join(env.HOME, '.kiro', 'hooks', OLD_KIRO_HOOK);
    write(old, '{"description": "someone else"}');
    assert.deepEqual(readHooks(env).user, [], 'a file of that name that is not ours is not named');
    write(old, '{"description": "' + MARKER + '; old"}');
    assert.deepEqual(readHooks(env).user, [hookPromptLeftover('Kiro CLI V3')]);
  });
  test('the Python hook an earlier install left registered is named (#488)', () => {
    write(path.join(env.HOME, '.claude', 'settings.json'), JSON.stringify(entry('UserPromptSubmit', 'python3 ' + path.join(data, OLD_PASTE) + ' prompt-hook')));
    write(path.join(data, OLD_PASTE), '#\n');
    assert.deepEqual(readHooks(env).user, [oldPasteLeftover('Claude Code')]);
    assert.equal(hookNodeText(env), 'no prompt hook registered');
  });
  test('the Kiro hook file is present, modified or absent', () => {
    const kiro = path.join(env.HOME, '.kiro', 'hooks', KIRO_HOOK);
    const node = path.join(data, 'node');
    const mhw = script();
    const cmd = nodeCmd(node, mhw, 'kiro');
    // The fixed-pattern check's file (#600): its prompt half, then its outbound half, which status does not read.
    const doc = { version: 'v1', hooks: [{ description: MARKER + '; source: src/hooks/pattern-check.js', name: 'fixed-pattern check, prompt', trigger: 'UserPromptSubmit', action: { type: 'command', command: cmd }, timeout: 30 },
      { description: MARKER + '; source: src/hooks/pattern-check.js', name: 'fixed-pattern check, outbound', trigger: 'PreToolUse', action: { type: 'command', command: cmd.replace('" prompt --harness', '" pre-tool --harness') }, timeout: 30 }] };
    write(kiro, JSON.stringify(doc));
    assert.deepEqual(readHooks(env).user, ['paste filter (Kiro CLI V3) FAIL: ' + node + ' and ' + mhw + ' not found, the prompt hook cannot start'], 'its node and entry are missing');
    write(node, '#\n');
    write(mhw, '#\n');
    assert.deepEqual(readHooks(env).user, ['paste filter (Kiro CLI V3)']);
    doc.hooks[0].action.command = cmd.replace('--harness kiro', '--harness codex');
    write(kiro, JSON.stringify(doc));
    assert.deepEqual(readHooks(env).user, ['paste filter (Kiro CLI V3, modified)']);
    write(kiro, '{not json');
    assert.deepEqual(readHooks(env).user, ['paste filter (Kiro CLI V3, modified: not JSON)', 'a file not read']);
    write(kiro, '[1]');
    assert.deepEqual(readHooks(env).user, ['paste filter (Kiro CLI V3, modified)']);
    fs.unlinkSync(kiro);
    assert.deepEqual(readHooks(env).user, []);
    assert.equal(KIRO_HOOK, NAME + '-pattern-check.json');
    assert.equal(OLD_KIRO_HOOK, NAME + '-paste-filter.json');
  });
  // #488 (PR #536 lens O2): a hashed term list the salt file does not cover is named, never silent.
  const HASH = 'ab'.repeat(32);
  const lists = () => path.join(data, 'local-overlay');
  test('term lists: none, and a covered list, read ok', () => {
    assert.deepEqual(termListsState(env), [true, 'no term list']);
    write(path.join(lists(), 'clipboard-terms'), '# header\n' + HASH + '\n');
    write(path.join(lists(), 'clipboard-salt'), 'cd'.repeat(32) + '\n');
    assert.deepEqual(termListsState(env), [true, '1 hash(es), salt file present']);
  });
  test('term lists: a list without its salt file is named in both views', () => {
    write(path.join(lists(), 'clipboard-terms-health'), '# header\n' + HASH + '\n' + 'ef'.repeat(32) + '\n');
    let [ok, text] = termListsState(env);
    assert.equal(ok, false);
    assert.match(text, /clipboard-terms-health holds 2 hash\(es\) and the salt file .* term matching off: re-add with mhw add-term/);
    write(path.join(lists(), 'clipboard-salt'), 'not a salt\n');
    [ok] = termListsState(env);
    assert.equal(ok, false, 'an unreadable salt is the same as none');
    const fx = facts({ terms: termListsState(env) });
    assert.ok(st.renderStatus(fx).some((l) => l.startsWith('  term lists       ') && l.includes('term matching off')));
    assert.match(st.renderSummary(fx, ENV).join('\n'), /protections .* · TERMS .*term matching off: re-add with mhw add-term/);
  });
  test('term lists: an .old-salt list is named with its count', () => {
    write(path.join(lists(), 'clipboard-salt'), 'cd'.repeat(32) + '\n');
    write(path.join(lists(), 'clipboard-terms.old-salt'), '# header\n' + HASH + '\n');
    const [ok, text] = termListsState(env);
    assert.equal(ok, false);
    assert.match(text, /clipboard-terms\.old-salt holds 1 hash\(es\) made with a salt mhw no longer has: .*re-add with mhw add-term, then delete .*clipboard-terms\.old-salt/);
  });
  test('term lists: the installed clipboard.conf names the paths', () => {
    const other = path.join(dir, 'elsewhere');
    write(path.join(data, 'clipboard.conf'), 'terms_file=' + path.join(other, 't') + '\nsalt_file=' + path.join(other, 's') + '\n');
    write(path.join(other, 't'), HASH + '\n');
    assert.equal(termListsState(env)[0], false);
    write(path.join(other, 's'), 'cd'.repeat(32) + '\n');
    assert.deepEqual(termListsState(env), [true, '1 hash(es), salt file present']);
  });
  test('a removed picker guard entry is named; an unreadable file is not read', () => {
    write(path.join(env.HOME, '.claude', 'settings.json'), JSON.stringify(entry('PreToolUse', '"' + path.join(data, GUARD) + '"')));
    assert.deepEqual(readHooks(env).user, [LEFTOVER]);
    write(path.join(env.HOME, '.claude', 'settings.json'), 'not json');
    assert.equal(readHooks(env).user, 'not read');
    assert.equal(hooksText(readHooks(env)), 'admin: none · user: not read');
  });
  test('the admin drop-in\'s state', () => {
    assert.equal(adminState(env), 'absent');
    /** @type {Record<string, unknown>} */
    const legacy = { hooks: { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/bin/sh "/x/' + NAME + '/bin/' + GUARD + '"', timeout: 5 }] }] }, permissions: { deny: ['Bash(sudo:*)'] } };
    write(adminDropin(env), JSON.stringify(legacy));
    assert.equal(adminState(env), 'legacy');
    assert.equal(adminInstalled(env), false);
    write(adminDropin(env), '{not json');
    assert.equal(adminState(env), 'unreadable');
    legacy[NAME] = 'stamp';
    write(adminDropin(env), JSON.stringify(legacy));
    assert.equal(adminState(env), 'installed');
    assert.equal(adminInstalled(env), true);
  });
  test('the admin layer', () => {
    const bin = env.WORKSTATION_MANAGED_ROOT + (process.platform === 'darwin' ? '/Library/Application Support/' : '/etc/') + NAME + '/bin';
    const doc = /** @type {Record<string, any>} */ (entry('PreToolUse', '/bin/sh "' + path.join(bin, GUARD) + '"'));
    const node = path.join(data, 'node');
    const entryJs = path.join(bin, 'hook', 'src', 'hooks', 'pattern-check.js');
    const adminCmd = '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "' + node + '" "' + entryJs + '" prompt --harness claude --config "x"';
    Object.assign(doc.hooks, entry('UserPromptSubmit', adminCmd).hooks);
    doc[NAME] = 'stamp';
    write(adminDropin(env), JSON.stringify(doc));
    const req = env.WORKSTATION_MANAGED_ROOT + '/etc/codex/requirements.toml';
    const codexCmd = JSON.stringify(adminCmd.replace('--harness claude', '--harness codex'));
    write(req, '[[hooks.UserPromptSubmit]]\ncommand = ' + codexCmd + '\n');
    write(node, '#\n');
    write(entryJs, '#\n');
    assert.deepEqual(readHooks(env).admin, [LEFTOVER, 'paste filter (Claude Code)']);
    write(req, '# ' + MARKER + '\n[[hooks.UserPromptSubmit]]\ncommand = ' + codexCmd + '\n');
    assert.deepEqual(readHooks(env).admin, [LEFTOVER, 'paste filter (Claude Code)', 'paste filter (Codex)']);
    // #600: an admin layer from before #600 still registers hook-entry.js; it is a leftover, not the prompt hook.
    const oldEntry = path.join(bin, 'hook', 'src', 'commands', 'hook-entry.js');
    const oldAdmin = '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "' + node + '" "' + oldEntry + '" --harness codex --config "x"';
    write(oldEntry, '#\n');
    write(req, '# ' + MARKER + '\n[[hooks.UserPromptSubmit]]\ncommand = ' + JSON.stringify(oldAdmin) + '\n');
    assert.deepEqual(readHooks(env).admin, [LEFTOVER, 'paste filter (Claude Code)', hookPromptLeftover('Codex')]);
  });
});

describe('inputs on which workstation.py stopped with a traceback read as unreadable (expected-differences.json)', () => {
  /** @type {string} */
  let dir;
  /** @type {Record<string, string>} */
  let env;
  beforeEach(() => {
    dir = tmp('no-traceback');
    env = { HOME: path.join(dir, 'home'), WORKSTATION_MANAGED_ROOT: path.join(dir, 'root'), PATH: process.env.PATH || '' };
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  test('a drop-in stamp key that is not a string reads as no stamp', () => {
    write(adminDropin(env), JSON.stringify({ [NAME]: 5 }));
    assert.equal(adminInstalled(env), true);
    assert.equal(adminStamp(env), 'none');
  });
  test('a drop-in that is JSON but not an object is present, not read: never installed (PR #535 lens 2)', () => {
    for (const doc of [[NAME], [], NAME, 5, null]) {
      write(adminDropin(env), JSON.stringify(doc));
      assert.equal(adminInstalled(env), false, JSON.stringify(doc));
      assert.equal(adminState(env), 'unreadable', JSON.stringify(doc));
      assert.equal(adminStamp(env), 'none');
      const f = facts({ admin: adminInstalled(env), admin_state: adminState(env) });
      assert.ok(row(st.renderSummary(f, ENV), 'layers').startsWith('managed: present, not read · '));
      assert.ok(st.renderStatus(f).includes('  installed        user: v3.1.0 @ aaaaaaa · admin: not installed'));
    }
  });
  test('a requirements.toml that is there and not UTF-8 counts as present, so the admin check runs (PR #535 lens 1)', () => {
    write(env.WORKSTATION_MANAGED_ROOT + '/etc/codex/requirements.toml', Buffer.concat([Buffer.from('# ' + MARKER + '\n'), Buffer.from([0xff, 0x0a])]));
    assert.equal(adminPresent(env), true);
    write(env.WORKSTATION_MANAGED_ROOT + '/etc/codex/requirements.toml', '# not ours\n');
    assert.equal(adminPresent(env), false);
  });
  test('the permissions line says not read for a file that is there and cannot be read, never 0 (PR #535 lens 1)', () => {
    const codex = path.join(env.HOME, '.codex');
    write(path.join(codex, 'rules', 'workstation-allow-list.rules'), Buffer.concat([Buffer.from('x(decision="allow")\n'), Buffer.from([0xff, 0x0a])]));
    write(path.join(codex, 'workstation.config.toml'), Buffer.concat([Buffer.from('sandbox_mode = "read-only"\n'), Buffer.from([0xff])]));
    write(path.join(env.HOME, '.claude', 'settings.json'), 'not json');
    write(path.join(env.HOME, '.kiro', 'agents', 'workstation.json'), '{');
    const line = permissionsText(env, null);
    assert.equal(line, 'Claude Code: mode not read (' + path.join(env.HOME, '.claude', 'settings.json') + ' is not readable UTF-8 JSON), allow rules not read (' +
      path.join(env.HOME, '.claude', 'settings.json') + ' is not readable UTF-8 JSON) · Codex: workstation profile not read (' + path.join(codex, 'workstation.config.toml') +
      ' is not readable UTF-8), allow rules not read (' + path.join(codex, 'rules', 'workstation-allow-list.rules') + ' is not readable UTF-8) · Kiro: agent workstation, trusted commands not read (' +
      path.join(env.HOME, '.kiro', 'agents', 'workstation.json') + ' is not readable UTF-8 JSON)');
    assert.ok(!/\b0 (allow rules|trusted commands)|no workstation profile|default \(none set\)/.test(line), line);
  });
  test('a setting source that is there and cannot be read never reads as default (PR #535 lens 1)', () => {
    write(path.join(env.HOME, '.codex', 'config.toml'), Buffer.from([0x6d, 0x3d, 0xff, 0x0a]));
    write(path.join(env.HOME, '.claude', 'settings.json'), '{');
    const unread = unreadSources(env, null);
    assert.deepEqual(unread.map((u) => u.harness + ' ' + u.layer), ['Claude Code user', 'Codex user']);
    const f = facts({ settings: [], unread, harnesses: { 'Claude Code': '1', Codex: '1', Kiro: '1' }, plugins: [] });
    const models = row(st.renderStatus(f), 'models');
    assert.ok(models.startsWith('Claude Code: not read (' + path.join(env.HOME, '.claude', 'settings.json') + ' is not readable UTF-8 JSON) · Codex: not read ('), models);
    assert.ok(models.includes('Kiro: default'), models);
    assert.ok(row(st.renderStatus(f), 'layers').endsWith('plugin: not read (' + path.join(env.HOME, '.claude', 'settings.json') + ' is not readable UTF-8 JSON)'));
    assert.ok(row(st.renderSummary(f, ENV), 'permission mode').startsWith('Claude Code: not read ('));
    assert.ok(!row(st.renderSummary(f, ENV), 'model, effort').includes('Claude Code: default'));
    const ws = path.join(dir, 'proj');
    write(path.join(ws, '.codex', 'config.toml'), Buffer.from([0xff]));
    const wsUnread = unreadSources(env, ws).filter((u) => u.layer === 'workspace');
    assert.equal(row(st.renderSummary(facts({ settings: [], unread: wsUnread }), ENV), 'overrides'),
      'Codex not read (' + path.join(ws, '.codex', 'config.toml') + ' is not readable UTF-8)');
    const m = methodState(env, ['METHOD  installed: 1'], []);
    assert.ok(st.methodText(m).endsWith('; whether the plugin is also enabled in Codex is not read (' + path.join(env.HOME, '.codex', 'config.toml') + ' is not readable UTF-8)'));
    assert.equal(methodState(env, ['METHOD  not installed'], []).unread, undefined);
  });
  test('a hooks value that is truthy but not an object counts no hook', () => {
    write(path.join(env.HOME, '.claude', 'settings.json'), JSON.stringify({ hooks: ['x'] }));
    assert.deepEqual(readHooks(env).user, []);
  });
  test('a Codex config.toml that is not UTF-8 is not read', () => {
    write(path.join(env.HOME, '.codex', 'config.toml'), Buffer.from([0x6d, 0x6f, 0x64, 0x65, 0x6c, 0x20, 0x3d, 0x20, 0x22, 0xff, 0x22, 0x0a]));
    assert.deepEqual(readSettings(env, null).filter((s) => s[0] === 'Codex'), []);
    assert.deepEqual(methodState(env, ['METHOD  installed: 1'], []).duplicate, []);
  });
  test('settings nested past any recursion limit are not read', () => {
    write(path.join(env.HOME, '.claude', 'settings.json'), '['.repeat(200000));
    assert.deepEqual(readSettings(env, null), []);
    assert.equal(readHooks(env).user, 'not read');
  });
  test('no git on PATH and no --project: not in a git repository', () => {
    assert.deepEqual(workspace(null, { PATH: path.join(dir, 'nothing') }, dir), { name: '', root: null, carriers: [] });
    assert.deepEqual(workspace('', { PATH: path.join(dir, 'nothing') }, dir), { name: '', root: null, carriers: [] });
  });
  test('QA ST2: an admin --check that fails with no counted line is still a difference, never `matches`', () => {
    const out = st.renderStatus(facts({ admin_code: 3, admin_issues: 0, admin_lines: ['NOTE    could not read'] }));
    assert.ok(out.includes('  check            1 target(s) differ (admin layer: 1); run ./mhw install'), out.join('\n'));
    assert.ok(!out.some((l) => l.includes('matches this checkout')));
    assert.ok(st.renderStatus(facts({ admin_code: 0, admin_issues: 0 })).includes('  check            matches this checkout'));
  });
  test('QA ST7: briefs carrying different stamps compare as mixed, which matches no range', () => {
    const other = 'release: v3.2.0; commit: ' + 'b'.repeat(40);
    assert.equal(st.keyRelease({ 'Claude Code': STAMP, Codex: other }), 'mixed');
    assert.equal(keyVerdict('>=3.1 <4', st.keyRelease({ 'Claude Code': STAMP, Codex: other }))[0], 'mismatch');
    assert.equal(st.keyRelease({ 'Claude Code': STAMP, Codex: STAMP }), 'v3.1.0');
    assert.equal(st.keyRelease({}), 'none');
  });
  test('QA AD3: a requirements.toml without our managed-by line is not an admin layer of ours', () => {
    write(env.WORKSTATION_MANAGED_ROOT + '/etc/codex/requirements.toml', '[hooks]\n# someone else\'s\n');
    assert.equal(adminPresent(env), false);
    write(env.WORKSTATION_MANAGED_ROOT + '/etc/codex/requirements.toml', '# ' + MARKER + '\n');
    assert.equal(adminPresent(env), true);
  });
  test('QA B1: --project= reads as no --project, outside a git repository too', () => {
    const outside = { PATH: process.env.PATH || '', HOME: env.HOME };
    assert.deepEqual(workspace('', outside, dir), workspace(null, outside, dir));
  });
  test('an empty --project= is unset: the git root of the current directory, as Python read it (PR #535 lens 3)', { skip: (!POSIX && 'POSIX only: the readers name paths as pathlib does on POSIX, and on Windows mhw status is install.ps1 -Check') || (!which('git') && 'needs git') }, () => {
    const repo = path.join(dir, 'repo');
    const sub = path.join(repo, 'src', 'lib');
    fs.mkdirSync(sub, { recursive: true });
    assert.equal(spawnSync(/** @type {string} */ (which('git')), ['-C', repo, 'init', '-q']).status, 0);
    const wenv = { PATH: process.env.PATH || '', HOME: env.HOME };
    const top = workspace('', wenv, sub);
    assert.equal(top.name, 'repo');
    assert.equal(fs.realpathSync.native(/** @type {string} */ (top.root)), fs.realpathSync.native(repo));
    assert.deepEqual(workspace('', wenv, sub), workspace(null, wenv, sub));
    assert.equal(workspace('.', wenv, sub).name, 'lib');
  });
});

describe('the command', () => {
  test('--overlay takes none or an existing directory, and refuses before anything runs', () => {
    const dir = tmp('overlay');
    try {
      fs.mkdirSync(path.join(dir, 'prof'));
      fs.writeFileSync(path.join(dir, 'file'), 'x');
      assert.equal(st.validOverlay('none', {}, dir), 'none');
      assert.equal(st.validOverlay('prof', {}, dir), path.join(dir, 'prof'));
      assert.equal(st.validOverlay('~/prof', { HOME: dir }, '/'), path.join(dir, 'prof'));
      for (const bad of ['file', 'missing', '', '-x', '--hooks=user', 'a\0b']) assert.equal(st.validOverlay(bad, {}, dir), null, bad);
      /** @type {string[]} */
      const err = [];
      /** @type {string[]} */
      const out = [];
      assert.equal(st.main(['--overlay=/nonexistent/overlay/dir'], {}, { err: (l) => err.push(l), out: (l) => out.push(l) }), 2);
      assert.deepEqual([err, out], [["mhw: --overlay takes 'none' or an existing directory"], []]);
      assert.equal(st.main(['--yes'], {}, { err: (l) => err.push(l), out: (l) => out.push(l) }), 2);
      assert.equal(err[1], 'mhw: unknown argument for status: --yes');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('the words follow the copy: a checkout says ./mhw, a package mhw', () => {
    const dir = tmp('words');
    try {
      fs.writeFileSync(path.join(dir, 'package.json'), '{}');
      assert.deepEqual([st.wordsOf(dir).cmd, st.wordsOf(dir).source], ['mhw', 'this package']);
      fs.mkdirSync(path.join(dir, '.git'));
      assert.deepEqual([st.wordsOf(dir).cmd, st.wordsOf(dir).source], ['./mhw', 'this checkout']);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  test('npm notes: a package not set up yet, and the package before the rename beside it', () => {
    const dir = tmp('npm');
    try {
      const pkg = path.join(dir, 'node_modules', 'mhw');
      write(path.join(pkg, 'package.json'), '{}');
      assert.deepEqual(st.npmNotes(STAMP, {}, pkg), [st.NOT_RUN + ': this package is v3.1.0 @ aaaaaaa, the user layer carries nothing; run mhw install']);
      assert.deepEqual(st.npmNotes(STAMP, { Codex: STAMP }, pkg), []);
      write(path.join(dir, 'node_modules', NAME, 'package.json'), '{"version": "4.1.0"}');
      assert.deepEqual(st.npmNotes(STAMP, { Codex: STAMP }, pkg), ['the v4.1.0 package (the name before mhw) is still installed beside mhw; ' + st.UPGRADE_FIRST + ', then run mhw update (the user layer stays)']);
      fs.mkdirSync(path.join(pkg, '.git'));
      assert.deepEqual(st.npmNotes(STAMP, {}, pkg), []);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// A stand-in gh (ADR-0035, decision 9). It logs its arguments and answers per STUB_* variables; never the
// real gh, never the network. `exec sleep` so a timeout kills the process holding the pipes.
const STUB_GH = `#!/bin/sh
printf '%s\\n' "$*" >> "$STUB_LOG"
case "$1" in
  issue) [ -n "$STUB_SLEEP" ] && exec sleep "$STUB_SLEEP"
         [ -n "$STUB_ERR" ] && printf '%s\\n' "$STUB_ERR" >&2
         [ -n "$STUB_DEPTH" ] && { head -c "$STUB_DEPTH" /dev/zero | tr '\\0' '['; exit 0; }
         [ -n "$STUB_BYTES" ] && { printf '\\377\\376[]'; exit 0; }
         printf '%s' "$STUB_ISSUES"; exit "\${STUB_CODE:-0}" ;;
  label) printf '%s' "\${STUB_LABELS:-[]}"; exit "\${STUB_LABEL_CODE:-0}" ;;
esac
exit 99
`;

describe('the owner-action count: read with gh, read-only; not read (<reason>) and never a false 0', { skip: !POSIX && 'the stand-in gh is a POSIX sh script' }, () => {
  /** @type {string} */
  let dir;
  /** @type {string} */
  let gh;
  /** @type {string} */
  let log;
  beforeEach(() => {
    dir = tmp('owner');
    fs.mkdirSync(path.join(dir, 'bin'));
    gh = path.join(dir, 'bin', 'gh');
    log = path.join(dir, 'gh.log');
    fs.writeFileSync(gh, STUB_GH);
    fs.chmodSync(gh, 0o755);
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));
  /** @param {Record<string, string>} stub @param {number} [timeout] */
  const read = (stub, timeout) => oa.read({ gh, timeout, env: { PATH: '/usr/bin:/bin', STUB_LOG: log, STUB_ISSUES: '', ...stub } });
  const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) : []);
  test('a count above zero reads open issues with the label only', () => {
    const r = read({ STUB_ISSUES: '[{"number":1},{"number":7},{"number":9}]' });
    assert.deepEqual(r, [3, '']);
    assert.equal(oa.text(r), '3 open');
    assert.deepEqual(calls(), ['issue list --repo tedeuxx/mhw --label owner-action --state open --limit 1000 --json number']);
  });
  test('zero only after the label is confirmed; an absent label is not a zero', () => {
    const r = read({ STUB_ISSUES: '[]', STUB_LABELS: '[{"name":"loop"},{"name":"owner-action"}]' });
    assert.deepEqual(r, [0, '']);
    assert.equal(oa.text(r), '0 open');
    assert.equal(calls()[1], 'label list --repo tedeuxx/mhw --limit 1000 --json name');
    assert.equal(oa.text(read({ STUB_ISSUES: '[]', STUB_LABELS: '[{"name":"owner-actions"},{"name":"loop"}]' })), 'not read (label owner-action absent in tedeuxx/mhw)');
  });
  test('gh missing from PATH', () => {
    assert.equal(oa.text(oa.read({ env: { PATH: path.join(dir, 'nothing') } })), 'not read (gh not found)');
    assert.deepEqual(calls(), []);
  });
  test('gh errors are classified, never printed', () => {
    for (const [stub, reason] of /** @type {Array<[Record<string, string>, string]>} */ ([
      [{ STUB_CODE: '4', STUB_ERR: 'To get started with GitHub CLI, please run: gh auth login' }, 'gh not authenticated'],
      [{ STUB_CODE: '1', STUB_ERR: 'HTTP 401: Bad credentials (https://api.github.com/graphql)' }, 'gh not authenticated'],
      [{ STUB_CODE: '1', STUB_ERR: 'error connecting to api.github.com' }, 'offline, GitHub unreachable'],
      [{ STUB_CODE: '1', STUB_ERR: 'secret-ish detail' }, 'gh exited 1'],
      [{ STUB_ISSUES: 'not json' }, 'gh output not understood'],
      [{ STUB_ISSUES: '{"number": 1}' }, 'gh output not understood'],
      [{ STUB_ISSUES: '[1]' }, 'gh output not understood'],
      [{ STUB_ISSUES: '[]', STUB_LABEL_CODE: '1' }, 'gh exited 1'],
      [{ STUB_BYTES: '1' }, 'gh output not understood'],
      [{ STUB_DEPTH: '1000000' }, 'gh output not understood']])) {
      const r = read(stub);
      assert.equal(r[0], null, reason);
      assert.equal(oa.text(r), 'not read (' + reason + ')');
      assert.ok(!oa.text(r).includes('secret-ish'));
    }
  });
  test('the timeout is bounded; an unrunnable gh; the limit says or more', () => {
    assert.equal(oa.text(read({ STUB_SLEEP: '5' }, 0.5)), 'not read (gh timed out after 0.5s)');
    fs.chmodSync(gh, 0o644);
    assert.equal(oa.text(read({ STUB_ISSUES: '[]' })), 'not read (gh could not run)');
    assert.equal(oa.text([oa.LIMIT, '']), '1000 or more open');
    assert.equal(oa.text([null, '']), 'not read (unknown)');
  });
  test('both views show it, and a not read never shows a zero', () => {
    for (const value of ['3 open', 'not read (gh not found)']) {
      assert.ok(st.renderStatus(facts({ owner_actions: value })).includes('  owner actions    ' + value + ' · label owner-action in tedeuxx/mhw'));
      const summary = st.renderSummary(facts({ owner_actions: value }), ENV);
      assert.ok(summary.length <= 10);
      assert.ok(summary.some((l) => l.startsWith('  workstation      ') && l.endsWith(' · owner actions: ' + value)));
    }
    for (const out of [st.renderStatus(facts({ owner_actions: 'not read (gh not found)' })), st.renderSummary(facts({ owner_actions: 'not read (gh not found)' }), ENV)]) {
      assert.deepEqual(out.filter((l) => /owner actions.*\b0 open/.test(l)), []);
    }
  });
});
