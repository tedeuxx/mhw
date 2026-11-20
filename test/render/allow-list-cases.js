// The S19 scenarios (#490): what test/render/allow-list-golden.test.js runs on src/render/allow-list.js and,
// while the base revision still holds it, on global/allow-list.sh sourced the way install.sh sourced it, and
// what test/golden/S19/transcripts records. Each scenario is one throwaway directory:
//   T/home   the HOME (its tree is what a transcript records after each run)
//   T/pkg    the package the step runs from: global/allow-list.conf, global/allow-retired.conf and
//            overlay/allow-list.conf, frozen copies taken from the tree on 2026-11-19 (test/golden/S19/inputs);
//            under T/lib/node_modules/mhw instead when the scenario is an npm layout
//   T/admin  the throwaway admin root (--managed-root): never the real one
// A step is a run, or a fixture change before it. Paths in a fixture change start with H/ (HOME), P/ (the
// package) or A/ (the admin root).

export const STAMP = 'release: v9.9.9; commit: ' + 'a'.repeat(40);
export const OTHER = 'release: v9.9.8; commit: ' + 'b'.repeat(40);

/**
 * @typedef {{ write: string, text: string } | { rm: string } | { symlink: string, to: string } | { mkdir: string }
 *   | { chmod: string, mode: number } | { admin: string }} Change
 * @typedef {{ phase: 'parse' | 'step' | 'uninstall', mode?: 'install' | 'check' | 'dry-run', stamp?: string,
 *   overlay?: boolean, before?: Change[], label?: string }} Run
 * @typedef {{ name: string, layout?: 'plain' | 'npm', codexHome?: string, cmd?: string, admin?: string,
 *   setup?: Change[], runs: Run[] }} Scenario
 */

const install = /** @type {Run} */ ({ phase: 'step', mode: 'install' });
const check = /** @type {Run} */ ({ phase: 'step', mode: 'check' });
const dry = /** @type {Run} */ ({ phase: 'step', mode: 'dry-run' });

const OWNER = '{\n    "env": {\n        "2": "two",\n        "1": "one"\n    },\n    "permissions": {\n'
  + '        "allow": [\n            "Bash(make lint:*)",\n            "Bash(git status:*)"\n        ],\n'
  + '        "deny": [\n            "Bash(rm -rf:*)"\n        ],\n        "defaultMode": "plan"\n    },\n'
  + '    "cleanupPeriodDays": 30,\n    "ratio": 1.0,\n    "big": 1e2,\n    "small": 0.00000012,\n'
  + '    "text": "caf\\u00e9 \\u007f tab\\t",\n    "hooks": {}\n}\n';

const RETIRED = '{\n  "permissions": {\n    "allow": ["Bash(find:*)", "Bash(git status:*)", "Bash(awk *)", "Bash(find:*)", 7],\n'
  + '    "ask": ["Bash(awk*)"]\n  }\n}\n';

/** @type {Scenario[]} */
export const SCENARIOS = [
  { name: 'narrow-fresh', runs: [install, check, { ...install, label: 'install again (idempotent)' }, dry,
    { phase: 'uninstall' }, { ...check, label: 'check after uninstall' }] },
  { name: 'narrow-dry-run-fresh', runs: [dry, check] },
  { name: 'wide-fresh', admin: 'full', runs: [install, check, dry, { phase: 'uninstall' }] },
  { name: 'narrow-then-wide-then-narrow', runs: [install,
    { ...check, before: [{ admin: 'full' }], label: 'check under a complete admin floor' },
    { ...dry, label: 'dry run of the widening' }, { ...install, label: 'install widens' },
    { ...check, before: [{ admin: 'none' }], label: 'check without the floor is drift' },
    { ...install, label: 'install narrows again' }] },
  { name: 'admin-claude-only', admin: 'claude', runs: [install, check] },
  { name: 'admin-codex-only', admin: 'codex', runs: [install, check] },
  { name: 'admin-claude-missing-one-entry', admin: 'claude-missing', runs: [install] },
  { name: 'admin-codex-unmanaged', admin: 'codex-unmanaged', runs: [install] },
  { name: 'admin-claude-not-json', admin: 'claude-bad', runs: [install] },
  { name: 'owner-settings-wide', admin: 'full', setup: [{ write: 'H/.claude/settings.json', text: OWNER }],
    runs: [check, dry, install, check, { phase: 'uninstall' }] },
  { name: 'owner-settings-narrow', setup: [{ write: 'H/.claude/settings.json', text: OWNER }],
    runs: [install, { phase: 'uninstall' }] },
  { name: 'owner-mode-accept-edits', admin: 'full',
    setup: [{ write: 'H/.claude/settings.json', text: '{"permissions": {"defaultMode": "acceptEdits"}}\n' }],
    runs: [install, { phase: 'uninstall' }] },
  { name: 'owner-mode-set-after-install', admin: 'full', runs: [install,
    { ...install, before: [{ write: 'H/.claude/settings.json', text: '{"permissions": {"defaultMode": "plan"}}\n' }], label: 'install over the owner mode' }] },
  { name: 'retired-allows', setup: [{ write: 'H/.claude/settings.json', text: RETIRED }],
    runs: [check, dry, install, { ...install, label: 'install again' }, { phase: 'uninstall' }] },
  { name: 'retired-only-allows', setup: [{ write: 'H/.claude/settings.json', text: '{"permissions": {"allow": ["Bash(find *)"]}}\n' }],
    runs: [install] },
  { name: 'retired-source-missing', setup: [{ rm: 'P/global/allow-retired.conf' }, { write: 'H/.claude/settings.json', text: RETIRED }],
    runs: [install] },
  { name: 'unmanaged-profile-refused', setup: [{ write: 'H/.codex/workstation.config.toml', text: 'sandbox_mode = "read-only"\n' }],
    runs: [install, check, { phase: 'uninstall' }] },
  { name: 'directory-at-the-kiro-agent', setup: [{ mkdir: 'H/.kiro/agents/workstation.json' }], runs: [install] },
  { name: 'stale-stamp', runs: [install, { ...check, stamp: OTHER, label: 'check with another stamp' },
    { ...dry, stamp: OTHER, label: 'dry run with another stamp' }, { ...install, stamp: OTHER, label: 'install with another stamp' }] },
  { name: 'drifted-rules', runs: [install,
    { ...check, before: [{ write: 'H/.codex/rules/workstation-allow-list.rules', text: '# managed-by: personal-multi-harness-workstation-configuration; ' + STAMP + ';\nprefix_rule(pattern=["sh"], decision="allow")\n' }], label: 'check a drifted rules file' },
    { ...install, label: 'install rewrites it' }] },
  { name: 'missing-file-check', runs: [install, { ...check, before: [{ rm: 'H/.kiro/agents/workstation.json' }], label: 'check a missing agent' }] },
  { name: 'permissions-not-an-object', setup: [{ write: 'H/.claude/settings.json', text: '{"permissions": "x"}\n' }], runs: [install, check] },
  { name: 'allow-not-an-array', setup: [{ write: 'H/.claude/settings.json', text: '{"permissions": {"allow": "x"}}\n' }], runs: [install] },
  { name: 'hooks-not-an-object', setup: [{ write: 'H/.claude/settings.json', text: '{"hooks": []}\n' }], runs: [install] },
  { name: 'settings-not-json', setup: [{ write: 'H/.claude/settings.json', text: '{not json\n' }], runs: [install, { phase: 'uninstall' }] },
  { name: 'settings-an-array', setup: [{ write: 'H/.claude/settings.json', text: '[1, 2]\n' }], runs: [install] },
  { name: 'settings-mode-kept', setup: [{ write: 'H/.claude/settings.json', text: '{}\n' }, { chmod: 'H/.claude/settings.json', mode: 0o600 }],
    runs: [install] },
  { name: 'settings-a-symbolic-link', setup: [{ write: 'H/real-settings.json', text: '{"permissions": {"allow": ["Bash(find:*)"]}}\n' },
    { symlink: 'H/.claude/settings.json', to: '../real-settings.json' }], runs: [install] },
  { name: 'codex-home-inside-home', codexHome: 'H/codex-here', runs: [install, { phase: 'uninstall' }] },
  { name: 'codex-home-outside-home', codexHome: 'T/elsewhere-codex', runs: [install] },
  { name: 'mhw-command-named', cmd: 'mhw', admin: 'full', runs: [{ ...install, before: [{ admin: 'none' }] }, { ...check, before: [{ admin: 'full' }] }] },
  { name: 'npm-layout', layout: 'npm', runs: [install] },
  { name: 'npm-layout-with-git', layout: 'npm', setup: [{ write: 'P/.git', text: 'gitdir: /nowhere\n' }], runs: [install] },
  { name: 'no-overlay', runs: [{ ...install, overlay: false }] },
  { name: 'uninstall-keeps-the-backup-note', setup: [{ write: 'H/.claude/settings.json', text: RETIRED }],
    runs: [install, { phase: 'uninstall' }, { ...install, label: 'install after uninstall' }] },
  { name: 'uninstall-unmanaged-files', setup: [{ write: 'H/.kiro/agents/workstation.json', text: '{}\n' }],
    runs: [{ phase: 'uninstall' }] },
  { name: 'parse-refusals', runs: [{ phase: 'parse', before: [{ write: 'P/overlay/allow-list.conf',
    text: 'wide cmd git push\nnarrow cmd sudo -n\r\n  # a comment\n\n\twide runner sh global/../x.sh\nloose cmd x\nwide\nwide route mhw milestone read\n'
      + 'narrow cmd gh pr -Rx\nwide cmd GIT_PAGER=x git diff\nwide runner python3 -X global/x.py\nnarrow cmd git log\n'
      + 'wide cmd git add\nwide cmd git commit -F\nwide cmd gh api\nwide cmd python3.12 -m x\nwide cmd mhw x\nwide cmd git -C x\n'
      + 'narrow cmd café\nwide deny git diff --no-index\nwide runner bash a/b.c/d-e_f.py\n' }] }] },
  { name: 'parse-source-missing', runs: [{ phase: 'parse', before: [{ rm: 'P/global/allow-list.conf' }] }] },
  { name: 'parse-no-entry', runs: [{ phase: 'parse', before: [{ write: 'P/global/allow-list.conf', text: '# nothing\n' },
    { write: 'P/overlay/allow-list.conf', text: 'wide deny git log --output\n' }] }] },
  { name: 'parse-unterminated-source', runs: [{ phase: 'step', mode: 'install', before: [
    { write: 'P/global/allow-list.conf', text: 'narrow cmd git status\nnarrow cmd git rev-parse' },
    { write: 'P/overlay/allow-list.conf', text: '\nnarrow cmd gh pr view\n' }] }] },
];

/** The four admin fixtures besides 'none'. @type {string[]} */
export const ADMIN_KINDS = ['full', 'claude', 'codex', 'claude-missing', 'codex-unmanaged', 'claude-bad'];
