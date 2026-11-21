// The S20 scenarios (#491): what test/render/settings-merge-golden.test.js runs through install.sh's
// merge_settings, uninstall_user and report_floor, cut out of the head's install.sh (which runs
// src/render/settings-merge.js and src/render/floor-report.js) and, while the base revision still holds them,
// out of the base's install.sh (jq programs). test/golden/S20/transcripts records the base's. Each scenario
// is one throwaway directory:
//   T/home   the HOME (its tree is what a transcript records after each run)
//   T/admin  the throwaway admin root (--managed-root): never the real one
// A run is one of merge (install, check or dry-run), uninstall or report. Paths in a fixture change start
// with H/ (HOME) or A/ (the admin root).

export const STAMP = 'release: v9.9.9; commit: ' + 'a'.repeat(40);
export const OTHER = 'release: v9.9.8; commit: ' + 'b'.repeat(40);
export const NAME = 'personal-multi-harness-workstation-configuration';
export const MARKER = 'managed-by: ' + NAME;

/**
 * @typedef {{ write: string, text: string } | { rm: string } | { symlink: string, to: string } | { mkdir: string }
 *   | { chmod: string, mode: number } | { admin: string }} Change
 * @typedef {{ phase: 'merge' | 'uninstall' | 'report', mode?: 'install' | 'check' | 'dry-run', stamp?: string,
 *   paste?: boolean, hooks?: 'user' | 'managed', before?: Change[], label?: string }} Run
 * @typedef {{ name: string, floor?: 'dup', admin?: string, setup?: Change[], runs: Run[], declared?: boolean,
 *   shellActs?: boolean }} Scenario
 */

const install = /** @type {Run} */ ({ phase: 'merge', mode: 'install' });
const check = /** @type {Run} */ ({ phase: 'merge', mode: 'check' });
const dry = /** @type {Run} */ ({ phase: 'merge', mode: 'dry-run' });
const uninstall = /** @type {Run} */ ({ phase: 'uninstall' });
const report = /** @type {Run} */ ({ phase: 'report' });
const S = 'H/.claude/settings.json';
/** @param {string} text @returns {Change} */
const settings = (text) => ({ write: S, text });

const PASTE = '/usr/bin/python3 /old/' + NAME + '/clipboard_guard.py prompt-hook';
const GUARD = '/old/path/' + NAME + '/hitl-escalation-guard.sh';
const RESTART = '/usr/bin/python3 /old/' + NAME + '/restart_guard.py';
/** The codex rules file of ours, as process codexrules leaves it: the marker is all the report reads. */
const CODEX_RULES = { write: 'H/.codex/rules/workstation-deny-floor.rules', text: '# ' + MARKER + '; source: global/deny-floor.conf; ' + STAMP + '; do not edit\n' };

// install.test.sh case 6: an owner's file, escaped slashes, a floor rule already present, a foreign rule.
const OWNER = '{\n    "model" : "some-model",\n    "enabledPlugins" : { "a@b" : true },\n'
  + '    "permissions" : { "allow" : [ "Bash(ls:*)" ], "ask" : [ "Edit(\\/x)" ], "deny" : [ "Bash(my-own-rule:*)", "Bash(rm -rf:*)" ] },\n'
  + '    "hooks" : {\n        "PreToolUse" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ],\n'
  + '        "Stop" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ]\n    }\n}\n';

// What jq keeps literally: key order (integer-like keys too), a repeated key, number literals, escapes.
const LITERALS = '{"env": {"2": "two", "1": "one", "2": "again"}, "ratio": 1.0, "big": 1e2, "small": 0.00000012, "neg": -0.0,'
  + ' "huge": 123456789012345678901234567890, "text": "caf\\u00e9 \\u007f tab\\t \\/ \\ud83d\\ude00 \\udc00", "raw": "é",'
  + ' "permissions": {"deny": ["Bash(rm -rf:*)", 7, null, {"a": 1}], "ask": []}}\n';

/** @type {Scenario[]} */
export const SCENARIOS = [
  { name: 'fresh', runs: [install, check, { ...install, label: 'install again (idempotent)' }, dry, report, uninstall,
    { ...check, label: 'check after uninstall' }, { ...report, label: 'report after uninstall' }] },
  { name: 'fresh-dry-run', runs: [dry, check, report] },
  { name: 'owner-settings', setup: [settings(OWNER), { chmod: S, mode: 0o600 }],
    runs: [dry, check, install, { ...install, label: 'install again' }, report, uninstall] },
  { name: 'literals-kept', setup: [settings(LITERALS)], runs: [dry, install, check, uninstall] },
  { name: 'stale-picker-guard', setup: [settings(JSON.stringify({ hooks: { PreToolUse: [
    { matcher: 'Bash', hooks: [{ type: 'command', command: '/foreign/pre.sh' }] },
    { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: GUARD }] },
    { matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/old2/' + NAME + '/hitl-escalation-guard.sh' }, { type: 'command', command: '/someone/else.sh' }] }] } }) + '\n')],
  runs: [check, dry, install, check] },
  { name: 'stale-paste-entries', setup: [settings(JSON.stringify({ hooks: { UserPromptSubmit: [
    { hooks: [{ type: 'command', command: PASTE }] },
    { hooks: [{ type: 'command', command: PASTE + ' --x' }, { type: 'command', command: '/someone/prompt-logger.sh' }] }] } }, null, 2) + '\n')],
  runs: [install, { ...install, label: 'install again' }, uninstall] },
  { name: 'legacy-restart-guard', setup: [settings(JSON.stringify({ hooks: {
    SessionStart: [{ hooks: [{ type: 'command', command: RESTART, timeout: 10 }] }],
    PreToolUse: [{ hooks: [{ type: 'command', command: RESTART + ' pre' }, { type: 'command', command: '/foreign/pre.sh' }] }] } }) + '\n')],
  runs: [check, install, uninstall] },
  { name: 'paste-refused', setup: [settings(JSON.stringify({ hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: PASTE }] }] } }) + '\n')],
    runs: [{ ...install, paste: false }, { ...check, paste: false }, { ...check, label: 'check with the paste filter' }] },
  { name: 'paste-refused-fresh', runs: [{ ...install, paste: false }, uninstall] },
  { name: 'hooks-managed', setup: [settings('{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/foreign/guard.sh"}]}]}}\n')],
    runs: [install, { ...check, hooks: 'managed' }, { ...install, hooks: 'managed' }, { ...check, hooks: 'managed' }, check] },
  { name: 'exactly-ours-kept', setup: [settings('{"hooks": {"UserPromptSubmit": [{"timeout": 30.0, "hooks": []}]}}\n')], runs: [install, install] },
  { name: 'record-kept', setup: [settings('{"permissions": {"deny": ["Bash(sudo:*)", "Bash(mine:*)"]}}\n')],
    runs: [install, { ...uninstall, label: 'uninstall keeps the owner rule equal to a floor rule' }] },
  { name: 'pre-record-stamped', setup: [settings(JSON.stringify({ [NAME]: MARKER + '; ' + OTHER + '; do not edit', permissions: { deny: ['Bash(sudo:*)', 'Bash(mine:*)'] } }) + '\n')],
    runs: [check, install, uninstall] },
  { name: 'pre-record-uninstall', setup: [settings(JSON.stringify({ [NAME]: 'x', permissions: { deny: ['Bash(sudo:*)', 'Bash(mine:*)'] } }) + '\n')],
    runs: [uninstall] },
  { name: 'record-not-an-array', setup: [settings(JSON.stringify({ [NAME]: 'x', [NAME + '-owned-deny']: 'Bash(sudo:*)', permissions: { deny: ['Bash(sudo:*)'] } }) + '\n')],
    runs: [install, uninstall] },
  { name: 'record-hand-edited', setup: [settings(JSON.stringify({ [NAME + '-owned-deny']: ['Bash(sudo:*)', 5, ['Bash(mine:*)', 'Bash(two:*)']],
    permissions: { deny: ['Bash(mine:*)', 'Bash(two:*)', ['Bash(mine:*)', 'Bash(two:*)'], 5, 'Bash(sudo:*)'] } }) + '\n')], runs: [uninstall] },
  { name: 'stale-stamp', runs: [install, { ...check, stamp: OTHER, label: 'check with another stamp' },
    { ...dry, stamp: OTHER, label: 'dry run with another stamp' }, { ...install, stamp: OTHER, label: 'install with another stamp' }] },
  { name: 'stamp-not-a-string', runs: [install, { ...check, label: 'check a numeric stamp', before: [{ write: S, text: '{"' + NAME + '": 5}\n' }] }] },
  { name: 'floor-rule-removed', runs: [install, { ...check, label: 'check after a floor rule went', before: [{ write: S, text: '{"permissions": {"deny": []}}\n' }] },
    { ...install, label: 'install restores it' }] },
  { name: 'duplicate-floor-lines', floor: 'dup', runs: [install, check, uninstall] },
  { name: 'odd-hook-shapes', setup: [settings(JSON.stringify({ hooks: {
    UserPromptSubmit: { a: { hooks: { k: { command: PASTE } } }, b: { hooks: [3, 'ID', { command: [NAME + '/clipboard_guard.py'] }, { command: false }] } },
    PreToolUse: [null, { x: 1 }, { hooks: 'ID' }, { hooks: [{ command: 30 }] }] } }) + '\n')], runs: [install, uninstall] },
  { name: 'hooks-false', setup: [settings('{"hooks": false, "permissions": null}\n')], runs: [install] },
  { name: 'hooks-empty-object', setup: [settings('{"hooks": {}}\n')], runs: [{ ...install, paste: false }, uninstall] },
  { name: 'no-entry-of-ours', setup: [settings('{"theme": "dark"}\n')], runs: [uninstall] },
  { name: 'deny-not-an-array', setup: [settings('{ "permissions": { "deny": "Bash(rm -rf:*)" } }\n')], runs: [install, check, dry, uninstall, report] },
  { name: 'deny-false', setup: [settings('{"permissions": {"deny": false}}\n')], runs: [install, report] },
  { name: 'deny-an-object', setup: [settings('{"permissions": {"deny": {"a": "Bash(sudo:*)", "b": "Bash(sudo:*)"}}}\n')], runs: [install, report] },
  { name: 'group-a-string', setup: [settings('{"hooks": {"UserPromptSubmit": ["x"]}}\n')], runs: [install, check, uninstall] },
  { name: 'event-a-string', setup: [settings('{"hooks": {"UserPromptSubmit": "x", "PreToolUse": "y"}}\n')], runs: [install, uninstall] },
  { name: 'settings-not-json', setup: [settings('{ "model": \n')], runs: [install, check, dry, uninstall, report] },
  { name: 'settings-an-array', setup: [settings('[1, 2]\n')], runs: [install, uninstall, report] },
  { name: 'settings-a-directory', setup: [{ mkdir: S }], runs: [install, uninstall, report] },
  { name: 'settings-lone-high-surrogate', setup: [settings('{"x": "\\ud800"}\n')], runs: [install, uninstall] },
  { name: 'settings-a-symbolic-link', setup: [{ write: 'H/real-settings.json', text: '{"theme": "dark"}\n' }, { chmod: 'H/real-settings.json', mode: 0o640 },
    { symlink: S, to: '../real-settings.json' }], runs: [install, uninstall] },
  { name: 'settings-a-dangling-link', setup: [{ symlink: S, to: '../nowhere.json' }], runs: [check, install] },
  { name: 'stale-backup-kept-note', setup: [{ write: S + '.pmhwc-backup', text: 'old\n' }], runs: [install] },
  // The floor report: user layer only, admin complete, admin incomplete, none, and the admin file unreadable.
  { name: 'report-user-only', setup: [CODEX_RULES], runs: [install, report] },
  { name: 'report-admin-complete', admin: 'full', setup: [CODEX_RULES], runs: [install, report] },
  { name: 'report-admin-complete-no-user', admin: 'full', runs: [report] },
  { name: 'report-admin-incomplete', admin: 'claude-missing', setup: [CODEX_RULES], runs: [install, report] },
  { name: 'report-admin-codex-only', admin: 'codex', setup: [CODEX_RULES], runs: [install, report] },
  { name: 'report-admin-not-json', admin: 'claude-bad', setup: [CODEX_RULES], runs: [install, report] },
  { name: 'report-codex-unmanaged', admin: 'codex-unmanaged', setup: [{ write: 'H/.codex/rules/workstation-deny-floor.rules', text: 'prefix_rule(pattern=["x"])\n' }],
    runs: [install, report] },
  { name: 'report-none', runs: [report] },
  { name: 'report-odd-deny', setup: [settings('{"permissions": {"deny": ["Bash(sudo:*)", "Bash(sudo:*)", ["Bash(sudo:*)"], [], 5, {"a": 1}]}}\n')], runs: [report] },
  // Declared (expected-differences.json): what the shell acted on or emptied and the Node step refuses.
  ...[['uninstall-hooks-a-string', '{"hooks": "x", "permissions": {"deny": ["Bash(sudo:*)"]}, "' + NAME + '": "x"}\n'],
    ['uninstall-hooks-an-array', '{"hooks": [], "theme": "dark"}\n'],
    ['uninstall-permissions-a-string', '{"permissions": "x", "theme": "dark"}\n']].map(([name, text]) => (/** @type {Scenario} */ ({
    name, declared: true, setup: [settings(text)], runs: [uninstall] }))),
  ...[['jq-only-nan', '{"permissions": {"deny": ["Bash(sudo:*)"]}, "n": NaN}\n'],
    ['jq-only-byte-order-mark', '﻿{"permissions": {"deny": ["Bash(sudo:*)"]}}\n'],
    ['jq-only-leading-zero', '{"n": 01}\n'],
    ['jq-only-two-documents', '{"permissions": {"deny": ["Bash(sudo:*)"]}} {"theme": "dark"}\n'],
    ['jq-only-trailing-nul', '{"theme": "dark"}\n\u0000']].map(([name, text]) => (/** @type {Scenario} */ ({
    name, declared: true, setup: [settings(text)], runs: [check, dry, install, uninstall, report] }))),
  // Nesting past 256: Apple's jq (the goldens were recorded with it) refuses it; the Ubuntu build reads it
  // and the shell merged it (#502: the S10 models step rewrote such a file). The Node step refuses it on
  // every build. shellActs false: the recording machine's shell refused too.
  ...[['jq-deep-300-levels', 299], ['jq-deep-10000-levels', 10000]].map(([name, n]) => (/** @type {Scenario} */ ({
    name: String(name), declared: true, shellActs: false,
    setup: [settings('{"permissions": {"deny": ["Bash(sudo:*)"]}, "x": ' + '['.repeat(Number(n)) + ']'.repeat(Number(n)) + '}\n')],
    runs: [check, install, uninstall, report] }))),
];
