// The S25 parity scenarios (#503): full install, check, dry run and uninstall runs of the user-layer installer
// on a throwaway HOME, each run recorded with its exit code, stdout, stderr and the HOME's tree. A path in a
// fixture names the scenario's directories: H the HOME, T the scenario's directory. Tests only.

const NAME = 'personal-multi-harness-workstation-configuration';
const MARKER = 'managed-by: ' + NAME;
const DATA = 'H/.local/share/' + NAME;

/**
 * @typedef {import('../helpers/install-golden.js').Change} Change
 * @typedef {{ args: string[], before?: Change[], label?: string, env?: Record<string, string | null> }} Run
 * @typedef {{ name: string, setup?: Change[], env?: Record<string, string | null>, overlay?: boolean, runs: Run[], declared?: boolean }} Scenario
 */

const deep = '{"a":'.repeat(300) + '1' + '}'.repeat(300) + '\n';

/** @type {Scenario[]} */
export const SCENARIOS = [
  {
    // The whole life of an install with the generic policy: install, check, dry run, a second install,
    // uninstall, and a check after it.
    name: 'lifecycle-generic',
    runs: [{ args: [] }, { args: ['--check'] }, { args: ['--dry-run'] }, { args: [] }, { args: ['--uninstall'] }, { args: ['--check'] }],
  },
  {
    // The same with an owner overlay (brief fragment, extra floor entry, clipboard notices, allow list and
    // model defaults), in its frozen form.
    name: 'lifecycle-overlay',
    overlay: true,
    runs: [{ args: [] }, { args: ['--check'] }, { args: ['--dry-run'] }, { args: ['--uninstall'] }, { args: ['--check'] }],
  },
  { name: 'dry-run-fresh', declared: true, runs: [{ args: ['--dry-run'] }] }, // #588: the semantic diff carries the check's entries
  {
    // --hooks=managed (ADR-0025): the user layer drops the hook entries and the Codex hooks.json; --method.
    name: 'hooks-managed-and-method',
    runs: [{ args: ['--hooks=managed'] }, { args: ['--check', '--hooks=managed'] }, { args: ['--check'] }, { args: [] },
      { args: ['--hooks=managed', '--method'] }, { args: ['--check', '--hooks=managed', '--method'] }, { args: ['--uninstall'] }],
  },
  {
    // An unmanaged file in the way is never overwritten (exit 3); a marker on line six does not make it ours.
    name: 'unmanaged-in-the-way',
    setup: [{ write: 'H/.codex/AGENTS.md', text: 'my own hand-written brief\n' },
      { write: 'H/.claude/CLAUDE.md', text: 'a\nb\nc\nd\ne\n<!-- ' + MARKER + ' -->\n' },
      { write: 'H/.kiro/steering/workstation-global-brief.md', text: 'a\nb\nc\nd\n<!-- ' + MARKER + ' -->\n' }],
    runs: [{ args: [] }, { args: ['--check'] }, { args: ['--dry-run'] }, { args: ['--uninstall'] }],
  },
  {
    // DRIFT on a content change, STAMP on another stamp with the same content, both repaired by install.
    name: 'drift-and-stamp',
    runs: [{ args: [] },
      { args: ['--check'], before: [{ write: 'H/.codex/rules/workstation-deny-floor.rules', text: '# ' + MARKER + '; source: x; release: v1.0.0; commit: abc; do not edit\nprefix_rule(pattern=["x"], decision="forbidden")\n' }] },
      { args: [] }, { args: ['--check'] }],
  },
  {
    // Every retirement: the removed guards and switches, the restart guard's state, the Python cores and the
    // withdrawn watcher's plist; the salt notice for a term list hashed with the Keychain salt.
    name: 'retirements',
    declared: true, // #588: its dry run's semantic diff carries the check's entries
    setup: [
      ...['hitl-escalation-guard.sh', 'hitl.conf', 'restart_guard.py', 'breaking_glass.py', 'clipboard_guard.py', 'paste_wrapper.py']
        .map((f) => ({ write: DATA + '/' + f, text: '#!/bin/sh\n# ' + MARKER + '; source: x\n' })),
      { write: 'H/.claude/commands/breaking-glass.md', text: '---\n---\n<!-- ' + MARKER + '; source: x -->\n' },
      { write: DATA + '/restart-state/claude-code-0123.json', text: '{}' },
      { write: 'H/Library/LaunchAgents/local.' + NAME + '.clipboard-guard.plist', text: '<?xml version="1.0"?>\n<!-- ' + MARKER + '; version: 0.7.2 -->\n<plist/>\n' },
      { write: DATA + '/local-overlay/clipboard-terms', text: '# header\n' + 'ab'.repeat(32) + '\n' },
    ],
    runs: [{ args: ['--check'] }, { args: ['--dry-run'] }, { args: [] }, { args: ['--check'] }, { args: ['--uninstall'] }],
  },
  {
    // An unmanaged file at a retired path is left alone; a restart-state directory holding a foreign file stays.
    name: 'retirements-foreign',
    setup: [{ write: 'H/.claude/commands/breaking-glass.md', text: 'mine\n' }, { write: DATA + '/restart-state/notes.txt', text: 'mine\n' },
      { write: DATA + '/restart-state/a.json', text: '{}' }, { write: 'H/Library/LaunchAgents/local.' + NAME + '.clipboard-guard.plist', text: 'my own agent\n' }],
    runs: [{ args: ['--check'] }, { args: [] }, { args: ['--uninstall'] }],
  },
  {
    // A settings.json no parser reads is refused visibly by every step and left untouched (#502, 3b).
    name: 'settings-unparseable',
    overlay: true,
    setup: [{ write: 'H/.claude/settings.json', text: '{ "model": \n' }],
    runs: [{ args: [] }, { args: ['--check'] }, { args: ['--uninstall'] }],
  },
  {
    // Nested 300 levels deep: refused uniformly, the model-defaults step included, never a crash (#502, 3b, 3c).
    name: 'settings-nested-300-deep',
    overlay: true,
    declared: true,
    setup: [{ write: 'H/.claude/settings.json', text: deep }],
    runs: [{ args: [] }, { args: ['--check'] }, { args: ['--uninstall'] }],
  },
  {
    // Uninstall leaves valid JSON, never a 0-byte file, for {"permissions": []} (#502, 4).
    name: 'settings-permissions-array',
    setup: [{ write: 'H/.claude/settings.json', text: '{"permissions": []}\n' }],
    runs: [{ args: ['--uninstall'] }, { args: [] }, { args: ['--uninstall'] }],
  },
  {
    // The owner's settings: every key and rule kept, our entries merged, then taken back out.
    name: 'settings-owner',
    declared: true, // #588: its dry run's semantic diff carries the check's entries
    setup: [{ write: 'H/.claude/settings.json', text: '{"theme": "dark", "permissions": {"allow": ["Bash(ls:*)", "Bash(find:*)"], "deny": ["Bash(mine:*)", "Bash(rm -rf:*)"]}, "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "/opt/x"}]}]}}\n' }],
    runs: [{ args: ['--dry-run'] }, { args: [] }, { args: ['--check'] }, { args: ['--uninstall'] }],
  },
  { name: 'node-missing', env: { MHW_NODE: null }, runs: [{ args: [] }, { args: ['--check'] }, { args: ['--uninstall'] }] },
  { name: 'node-not-executable', env: { MHW_NODE: '/nonexistent/node' }, runs: [{ args: [] }, { args: ['--check'] }, { args: ['--uninstall'] }] },
  { name: 'node-that-is-not-node', env: { MHW_NODE: '/usr/bin/true' }, runs: [{ args: [] }, { args: ['--uninstall'] }] },
  {
    // Without a node while our allow list is installed, uninstall removes nothing at all (PR #519 lens B1).
    name: 'uninstall-without-node-after-install',
    runs: [{ args: [] }, { args: ['--uninstall'], env: { MHW_NODE: null } }, { args: ['--check'], env: { MHW_NODE: null } }],
  },
  {
    // XDG_DATA_HOME and CODEX_HOME are honoured; a quote in the data directory refuses the paste filter.
    name: 'xdg-and-codex-home',
    env: { XDG_DATA_HOME: 'T/xdg', CODEX_HOME: 'T/codex' },
    runs: [{ args: [] }, { args: ['--check'] }, { args: ['--uninstall'] }],
  },
  { name: 'quote-in-data-dir', env: { XDG_DATA_HOME: 'T/xd$g' }, runs: [{ args: [] }, { args: ['--check'] }, { args: ['--uninstall'] }] },
  {
    // The Kiro hook: a managed file of another content is replaced with a 0600 backup that uninstall names.
    name: 'kiro-hook-backup',
    setup: [{ write: 'H/.kiro/hooks/' + NAME + '-paste-filter.json', text: '{\n  "version": "v1",\n  "hooks": [\n    {\n      "description": "' + MARKER + '; source: x",\n      "timeout": 1\n    }\n  ]\n}\n' }],
    runs: [{ args: ['--check'] }, { args: [] }, { args: ['--uninstall'] }],
  },
  {
    // The start-up file named on the command line, none, and a relative one (a usage error).
    name: 'shell-rc-explicit',
    setup: [{ write: 'H/rc', text: 'export MINE=1\n' }],
    runs: [{ args: ['--shell-rc=T/home/rc'] }, { args: ['--check', '--shell-rc=T/home/rc'] }, { args: ['--uninstall', '--shell-rc=T/home/rc'] },
      { args: ['--shell-rc=none'] }, { args: ['--shell-rc=relative'] }],
  },
  {
    // Usage errors: exit 2, nothing written.
    name: 'usage-errors',
    runs: [{ args: ['--bogus'] }, { args: ['--shell-rc='] }, { args: ['--overlay=T/missing'] }, { args: ['--dry-run', '--hooks=other'] }],
  },
  {
    // An invalid overlay floor entry stops the run before anything is written.
    name: 'invalid-floor-entry',
    setup: [{ write: 'T/bad-overlay/deny-floor.conf', text: '# bad\ncmd git push --force*\nglob terraform *\nfile ~/a ~/b\n' }],
    runs: [{ args: ['--overlay=T/bad-overlay'] }, { args: ['--overlay=T/bad-overlay', '--uninstall'] }],
  },
  {
    // The overlay named by WORKSTATION_OVERLAY, and none.
    name: 'workstation-overlay-env',
    env: { WORKSTATION_OVERLAY: 'none' },
    runs: [{ args: [] }, { args: ['--check', '--overlay=T/empty-overlay'], before: [{ mkdir: 'T/empty-overlay' }] }],
  },
];

// #600: `mhw hook prompt` left the CLI; these scenarios' output and hashed trees moved with it, and the originals are
// deleted, so each is declared and its Node transcript, recorded at #600's head, is <scenario>.node.json
// (expected-differences.json names why).
const DECLARED_600 = new Set([
  'drift-and-stamp',
  'dry-run-fresh',
  'hooks-managed-and-method',
  'kiro-hook-backup',
  'lifecycle-generic',
  'lifecycle-overlay',
  'node-missing',
  'node-not-executable',
  'node-that-is-not-node',
  'quote-in-data-dir',
  'retirements-foreign',
  'retirements',
  'settings-nested-300-deep',
  'settings-owner',
  'settings-permissions-array',
  'settings-unparseable',
  'shell-rc-explicit',
  'uninstall-without-node-after-install',
  'unmanaged-in-the-way',
  'workstation-overlay-env',
  'xdg-and-codex-home',
]);
for (const sc of SCENARIOS) if (DECLARED_600.has(sc.name)) sc.declared = true;
