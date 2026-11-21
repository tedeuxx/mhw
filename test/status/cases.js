// The S22 parity cases (#493, convention 3 of #470): `mhw status`, `--summary` and `--verbose`, each case
// on a fresh throwaway HOME and admin root, every step through `node <tree>/bin/mhw.js`. At the base
// revision status ran global/workstation.py; at the head it runs src/commands/status.js. Steps marked
// setup (an install, a hand edit) run the same code on both sides and record only their exit code.
// Every name, value and file here is SYNTHETIC; gh is always a stand-in, never the real one.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { which } from '../helpers/home.js';

export const NAME = 'personal-multi-harness-workstation-configuration';

/**
 * @typedef {{ home: string, root: string, dir: string, tree: string }} Where
 * @typedef {{ args: string[], setup?: boolean, env?: Record<string, string>, archive?: string, cwd?: string, pre?: (w: Where) => void }} Step
 * @typedef {{ name: string, package?: boolean, stubs?: Record<string, string>, setup?: (w: Where) => void, steps: Step[] }} Case
 */

/** @param {string} file @param {string | Buffer} text */
export function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}
/** @param {string} file @param {unknown} doc */
const putJson = (file, doc) => put(file, JSON.stringify(doc, null, 2) + '\n');
/** @param {string} file @param {(doc: any) => void} edit */
function editJson(file, edit) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
  edit(doc);
  putJson(file, doc);
}

const darwin = process.platform === 'darwin';
/** @param {Where} w */
export const adminDir = (w) => w.root + (darwin ? '/Library/Application Support/' : '/etc/') + NAME;
/** @param {Where} w */
export const dropin = (w) => w.root + (darwin ? '/Library/Application Support/ClaudeCode' : '/etc/claude-code') + '/managed-settings.d/50-' + NAME + '.json';
/** @param {Where} w @param {string} name */
const proj = (w, name) => path.join(w.dir, 'work', name);

const NONE = '--overlay=none';
/** A status step. @param {string[]} args @param {Partial<Step>} [more] */
const S = (args, more = {}) => ({ args: ['status', ...args], ...more });
/** A setup step. @param {string[]} args @param {Partial<Step>} [more] */
const U = (args, more = {}) => ({ args, setup: true, ...more });
const INSTALL_USER = U(['install', '--yes', '--no-admin', NONE]);

/** @param {Where} w @param {string} name @param {string | null} key */
function project(w, name, key) {
  const d = proj(w, name);
  fs.mkdirSync(d, { recursive: true });
  if (key !== null) put(path.join(d, '.workstation-version'), key);
  return d;
}

// Each project a case names is created before its first step, so a step can name it as an argument.
/** @type {Record<string, string | null>} */
const PROJECTS = { key: '# synthetic\n>=3.1 <4\n', nokey: null, mismatch: '>=999 <1000\n', invalid: '~3.1\n', empty: '# nothing\n\n' };

/** @param {(w: Where) => void} [more] */
const withProjects = (more) => (/** @type {Where} */ w) => {
  for (const [n, k] of Object.entries(PROJECTS)) project(w, n, k);
  more?.(w);
};

/** The stand-in gh: it answers per STUB_* variables (by default: no open issue, the label present). */
export const STUB_GH = `#!/bin/sh
[ -n "\${STUB_ISSUES+x}" ] || STUB_ISSUES='[]'
[ -n "\${STUB_LABELS+x}" ] || STUB_LABELS='[{"name":"owner-action"}]'
case "$1" in
  issue) [ -n "$STUB_ERR" ] && printf '%s\\n' "$STUB_ERR" >&2
         printf '%s' "$STUB_ISSUES"; exit "\${STUB_CODE:-0}" ;;
  label) printf '%s' "$STUB_LABELS"; exit "\${STUB_LABEL_CODE:-0}" ;;
esac
exit 99
`;

const HARNESS_STUBS = {
  claude: '#!/bin/sh\necho "9.9.1 (Claude Code)"\n',
  codex: '#!/bin/sh\nprintf \'codex-cli 9.9.2\\nsecond line\\n\'\n',
  'kiro-cli': '#!/bin/sh\nexit 3\n',
};

/** @type {Case[]} */
export const CASES = [
  {
    name: 'nothing-installed',
    setup: withProjects(),
    steps: [S([NONE]), S(['--summary', NONE]), S(['--verbose', NONE]), S(['--summary', NONE, '-v']),
      S([NONE, '--project=work/key']), S(['--summary', NONE, '--project=work/missing'])],
  },
  {
    name: 'user-only',
    setup: withProjects(),
    steps: [INSTALL_USER, S([NONE]), S(['--summary', NONE])],
  },
  {
    name: 'user-only-projects',
    setup: withProjects(),
    steps: [INSTALL_USER,
      ...['key', 'nokey', 'mismatch', 'invalid', 'empty'].map((n) => S([NONE, '<P:' + n + '>'])),
      ...['key', 'nokey', 'mismatch', 'invalid', 'empty'].map((n) => S(['--summary', NONE, '<P:' + n + '>'])),
      S(['--verbose', NONE, '<P:key>'])],
  },
  {
    name: 'admin-present',
    setup: withProjects(),
    steps: [U(['install', '--yes', NONE]), S([NONE, '<P:key>']), S(['--summary', NONE, '<P:key>']), S(['--verbose', NONE])],
  },
  {
    name: 'drift',
    setup: withProjects(),
    steps: [INSTALL_USER,
      U(['status', NONE], { pre: (w) => {
        const b = path.join(w.home, '.claude', 'CLAUDE.md');
        fs.appendFileSync(b, 'edited\n');
        fs.rmSync(path.join(w.home, '.kiro', 'steering', 'workstation-global-brief.md'), { force: true });
      } }),
      S([NONE, '<P:key>']), S(['--summary', NONE, '<P:key>'])],
  },
  {
    name: 'stamp-from-another-source',
    setup: withProjects(),
    steps: [U(['install', '--yes', '--no-admin', NONE], { archive: 'v3.0.0' }),
      S([NONE, '<P:key>'], { archive: 'v3.1.0' }), S(['--summary', NONE, '<P:key>'], { archive: 'v3.1.0' })],
  },
  {
    name: 'stale-hooks-and-legacy-dropin',
    setup: withProjects(),
    steps: [INSTALL_USER,
      U(['status', NONE], { pre: (w) => {
        editJson(path.join(w.home, '.claude', 'settings.json'), (d) => {
          d.hooks ||= {};
          d.hooks.PreToolUse = [...(d.hooks.PreToolUse || []), { hooks: [{ type: 'command', command: '/bin/sh "/x/hitl-escalation-guard.sh"' }] }];
          d.hooks.SessionStart = [{ hooks: [{ type: 'command', command: '/usr/bin/python3 /x/restart_guard.py' }] }];
        });
        // The pre-#66 drop-in shape: hooks and deny, no stamp key.
        putJson(dropin(w), { hooks: { PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ type: 'command', command: '/bin/sh /x/hitl-escalation-guard.sh', timeout: 5 }] }] }, permissions: { deny: ['Bash(sudo:*)'] } });
      } }),
      S([NONE, '<P:key>']), S(['--summary', NONE, '<P:key>'])],
  },
  {
    name: 'stale-admin-layer',
    setup: withProjects((w) => {
      const bin = path.join(adminDir(w), 'bin');
      fs.mkdirSync(path.join(adminDir(w), 'breaking-glass'), { recursive: true });
      for (const n of ['restart_guard.py', 'breaking_glass.py', 'hitl-escalation-guard.sh', 'hitl.conf', 'clipboard_guard.py', 'clipboard.conf']) put(path.join(bin, n), '# v2.1.0\n');
      /** @param {string} cmd */
      const hook = (cmd) => [{ hooks: [{ type: 'command', command: cmd }] }];
      const restart = '/usr/bin/python3 -I -B "' + path.join(bin, 'restart_guard.py') + '" --harness claude-code';
      putJson(dropin(w), { hooks: { SessionStart: hook(restart), PreToolUse: [...hook(restart), ...hook('/bin/sh "' + path.join(bin, 'hitl-escalation-guard.sh') + '"')],
        UserPromptSubmit: hook('/usr/bin/python3 -I -B "' + path.join(bin, 'clipboard_guard.py') + '" prompt-hook') } });
      put(w.root + '/etc/codex/requirements.toml', '# managed-by: ' + NAME + '; source: global/install-managed.sh; version: 2.1.0\n[hooks]\n' +
        '[[hooks.SessionStart]]\n[[hooks.SessionStart.hooks]]\ntype = "command"\ncommand = "/usr/bin/python3 -I -B \\"' + path.join(bin, 'restart_guard.py') + '\\" --harness codex"\n');
    }),
    steps: [S([NONE, '<P:key>']), S(['--summary', NONE, '<P:key>'])],
  },
  {
    name: 'package-layout',
    package: true,
    setup: withProjects(),
    steps: [S([NONE, '<P:key>']), S(['--summary', NONE]), INSTALL_USER, S([NONE, '<P:key>']), S(['--summary', NONE])],
  },
  {
    name: 'harnesses-settings-and-plugins',
    stubs: HARNESS_STUBS,
    setup: withProjects((w) => {
      putJson(path.join(w.home, '.claude', 'settings.json'), { model: 'synth-opus', effortLevel: 'high', disableAllHooks: true,
        permissions: { defaultMode: 'plan', allow: ['Bash(ls:*)', 'Bash(pwd)'] }, enabledPlugins: { 'tadeumendonca-skills@synth': true, 'p-off@synth': false, 'p-on@synth': 1 } });
      put(path.join(w.home, '.codex', 'config.toml'), 'model = "synth-gpt"  # note\napproval_policy = \'never\'\nmodel_reasoning_effort = high\n[plugins."tadeumendonca-skills@synth"]\nenabled = true\n');
      put(path.join(w.home, '.codex', 'workstation.config.toml'), 'approval_policy = "on-request"\nsandbox_mode = "workspace-write"\n');
      put(path.join(w.home, '.codex', 'rules', 'workstation-allow-list.rules'), 'prefix_rule(pattern=["ls"], decision="allow")\nprefix_rule(pattern=["rm"], decision="forbidden")\n');
      putJson(path.join(w.home, '.kiro', 'settings', 'cli.json'), { 'chat.defaultModel': 'synth-sonnet' });
      putJson(path.join(w.home, '.kiro', 'agents', 'workstation.json'), { toolsSettings: { execute_bash: { allowedCommands: ['ls', 'pwd', 'git status'] } } });
      const p = proj(w, 'key');
      putJson(path.join(p, '.claude', 'settings.json'), { model: 'synth-haiku', permissions: { defaultMode: 'acceptEdits' }, enabledPlugins: { 'p-on@synth': false } });
      putJson(path.join(p, '.claude', 'settings.local.json'), { effortLevel: 'low' });
      put(path.join(p, '.codex', 'config.toml'), 'sandbox_mode = "workspace-write"\n[x]\nmodel = "ignored"\n');
      putJson(path.join(p, '.kiro', 'settings', 'cli.json'), { 'chat.defaultModel': 'synth-ws' });
      fs.mkdirSync(path.join(p, '.agents'), { recursive: true });
    }),
    steps: [S([NONE, '<P:key>']), S(['--summary', NONE, '<P:key>']), S(['--verbose', NONE, '<P:key>']), S(['--summary', NONE, '<P:nokey>'])],
  },
  {
    name: 'method-duplicate',
    setup: withProjects((w) => {
      put(path.join(w.home, '.codex', 'config.toml'), '[plugins."tadeumendonca-skills@synth"]\nenabled = true\n');
    }),
    steps: [U(['install', '--yes', '--no-admin', '--method', NONE]),
      U(['status', NONE], { pre: (w) => editJson(path.join(w.home, '.claude', 'settings.json'), (d) => { d.enabledPlugins = { 'tadeumendonca-skills@synth': true }; }) }),
      S([NONE, '<P:key>']), S(['--summary', NONE, '<P:key>'])],
  },
  {
    name: 'root-brief-findings',
    setup: withProjects((w) => {
      const p = proj(w, 'key');
      put(path.join(p, 'AGENTS.md'), 'x'.repeat(40000));
      put(path.join(p, 'CLAUDE.md'), '@AGENTS.md\n');
      put(path.join(p, 'CLAUDE.local.md'), 'x\n');
      put(path.join(w.dir, 'work', '.claude', 'CLAUDE.md'), 'x\n');
      put(path.join(proj(w, 'nokey'), 'AGENTS.md'), 'x'.repeat(32768));
    }),
    steps: [S([NONE, '<P:key>']), S(['--summary', NONE, '<P:key>']), S([NONE, '<P:nokey>'])],
  },
  {
    name: 'owner-actions',
    setup: withProjects(),
    steps: [
      S(['--summary', NONE], { env: { STUB_ISSUES: '[{"number":1},{"number":7},{"number":9}]' } }),
      S([NONE], { env: { STUB_ISSUES: '[]' } }),
      S(['--summary', NONE], { env: { STUB_ISSUES: '[]', STUB_LABELS: '[{"name":"owner-actions"}]' } }),
      S(['--summary', NONE], { env: { STUB_CODE: '4', STUB_ERR: 'synthetic: please run gh auth login' } }),
      S(['--summary', NONE], { env: { STUB_CODE: '1', STUB_ERR: 'HTTP 401: Bad credentials (synthetic)' } }),
      S(['--summary', NONE], { env: { STUB_CODE: '1', STUB_ERR: 'error connecting to api.github.com' } }),
      S(['--summary', NONE], { env: { STUB_CODE: '1', STUB_ERR: 'secret-ish synthetic detail' } }),
      S(['--summary', NONE], { env: { STUB_ISSUES: 'not json' } }),
      S(['--summary', NONE], { env: { STUB_ISSUES: '{"number": 1}' } }),
      S(['--summary', NONE], { env: { STUB_ISSUES: '[]', STUB_LABEL_CODE: '1' } }),
    ],
  },
  {
    name: 'models-policy',
    setup: withProjects((w) => {
      putJson(path.join(w.dir, 'overlay', 'model-defaults.json'), { version: 1, 'claude-code': { model: 'synth-opus', effort: 'medium' },
        codex: { model: 'synth-gpt', effort: 'medium' }, 'kiro-cli': { model: 'synth-sonnet' } });
    }),
    steps: [U(['install', '--yes', '--no-admin', '<OVERLAY>']), S(['<OVERLAY>', '<P:key>']),
      U(['status', NONE], { pre: (w) => editJson(path.join(w.home, '.claude', 'settings.json'), (d) => { d.model = 'synth-other'; }) }),
      S(['<OVERLAY>', '<P:key>']), S(['--summary', '<OVERLAY>', '<P:key>'])],
  },
  {
    name: 'unreadable-files',
    setup: withProjects((w) => {
      put(path.join(w.home, '.claude', 'settings.json'), 'not json\n');
      put(path.join(w.home, '.kiro', 'hooks', NAME + '-paste-filter.json'), '{not json');
      put(dropin(w), '{not json');
      put(path.join(w.home, '.claude', 'CLAUDE.md'), Buffer.from([0x23, 0xff, 0xfe, 0x0a]));
    }),
    steps: [S([NONE, '<P:key>']), S(['--summary', NONE, '<P:key>'])],
  },
  {
    name: 'mcp-active-set',
    setup: withProjects((w) => {
      const data = path.join(w.home, '.local', 'share', NAME);
      putJson(path.join(data, 'local-overlay', 'mcp-servers.json'), { version: 1, active_set: { 'claude-code': ['set-a'] }, servers: { 'set-a': { command: '/bin/echo' } } });
      putJson(path.join(w.home, '.claude.json'), { mcpServers: { 'synth-outside': { command: '/bin/echo' } } });
    }),
    steps: [S([NONE]), S([NONE, '--mcp-connect=2']), S(['--summary', NONE, '--mcp-connect=3'])],
  },
  {
    // PR #535 (QA B1, lens finding 3): an empty --project= is no --project, as workstation.py's `if project:`
    // read it: from a subdirectory of a repository the workspace is its git root, where the version key is.
    name: 'empty-project-value',
    setup: withProjects((w) => {
      const git = which('git');
      if (!git) throw new Error('needs git on PATH');
      const repo = proj(w, 'key');
      fs.mkdirSync(path.join(repo, 'sub', 'deeper'), { recursive: true });
      const r = spawnSync(git, ['-C', repo, 'init', '-q'], { encoding: 'utf8' });
      if (r.status !== 0) throw new Error('git init failed: ' + r.stderr);
    }),
    steps: [S([NONE, '--project='], { cwd: 'work/key/sub/deeper' }), S(['--summary', NONE, '--project='], { cwd: 'work/key/sub/deeper' }),
      S(['--summary', NONE], { cwd: 'work/key/sub/deeper' }), S(['--summary', NONE, '--project='])],
  },
  {
    name: 'usage-errors',
    steps: [S(['--bogus']), S(['--mcp-connect=0']), S(['--mcp-connect=99999']), S(['--mcp-connect=x']), S(['--overlay=/nonexistent/s22']),
      S(['--overlay=-x']), S(['--overlay=']), S(['--yes']), S(['--project'])],
  },
];
