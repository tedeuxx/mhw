// The S27 scenarios (#497): every case of the deleted global/install.test.ps1, each a sequence of runs of the
// Windows user-layer installer in one throwaway profile directory. Both sides run them: install.ps1 at the
// base revision (the live arm, on a Windows runner) and `mhw install-windows` (the head). A step's args are
// mhw's spelling; the live arm maps them onto install.ps1's parameters (toPowerShell).
//   ov:    which overlay the step names: a directory under <T>/ov (copied from test/golden/S27/inputs or
//          written by the scenario's setup), 'none', 'missing' (a directory that does not exist), or
//          undefined (no --overlay: the tree's own overlay).
//   node:  'bogus' sets MHW_NODE to an absolute path that is not a file; 'node' to the node running the test.
//   path:  'no-node' runs with a PATH that holds no node and no git.
//   setup: writes into the profile (h) or the scenario directory (t) before the step; fs only.
import fs from 'node:fs';
import path from 'node:path';

/** @typedef {{ args: string[], ov?: string, node?: 'bogus' | 'node', path?: 'no-node', codexHome?: boolean, setup?: (h: string, t: string) => void }} Step */
/** @typedef {{ name: string, steps: Step[] }} Scenario */

/** @param {string} p @param {string} text */
function put(p, text) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}

/** Rewrite a JSON file through a function of its object. @param {string} p @param {(o: any) => void} f */
function editJson(p, f) {
  const o = JSON.parse(fs.readFileSync(p, 'utf8'));
  f(o);
  fs.writeFileSync(p, JSON.stringify(o, null, 2));
}

const OTHER = '0123456789abcdef0123456789abcdef01234567';
/** The commit field of a managed file replaced, as install.test.ps1 4b did. @param {string} p */
function restamp(p) {
  fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replace(/; commit: [^;"]*;/g, '; commit: ' + OTHER + ';'));
}

const SETTINGS = `{
    "model" : "some-model",
    "enabledPlugins" : { "a@b" : true },
    "permissions" : { "allow" : [ "Bash(ls:*)" ], "ask" : [ "Edit(\\/x)" ], "deny" : [ "Bash(my-own-rule:*)", "Bash(rm -rf:*)" ] },
    "hooks" : {
        "PreToolUse" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ],
        "Stop" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ]
    }
}
`;

/** The invalid floor entries of install.test.ps1 section 11, each refused before anything is written. */
export const BAD_FLOOR = ['cmd rm "-rf"', 'cmd git push --force*', 'path ~/.ssh', 'file ~/a ~/b', 'cmd', 'glob terraform*',
  'glob terraform -chdir=*x', 'glob terraform -c*hdir=*', 'glob terraform -chdir=**', 'glob terraform *', 'glob terraform plan:*'];

/** @type {Scenario[]} */
export const SCENARIOS = [
  { name: 'dry-run-fresh', steps: [{ args: ['--dry-run'], ov: 'models-off' }] },
  {
    name: 'install-check-drift-stamp',
    steps: [
      { args: [], ov: 'models-off' },
      { args: ['--check'], ov: 'models-off' },
      { args: [], ov: 'models-off' },
      { args: ['--check'], ov: 'models-off', setup: (h) => fs.appendFileSync(path.join(h, '.codex', 'AGENTS.md'), 'local edit\n') },
      { args: [], ov: 'models-off' },
      { args: ['--check'], ov: 'models-off' },
      { args: ['--check'], ov: 'models-off', setup: (h) => [path.join(h, '.codex', 'AGENTS.md'), path.join(h, '.claude', 'settings.json')].forEach(restamp) },
      { args: [], ov: 'models-off' },
      { args: ['--check'], ov: 'models-off' },
      {
        args: ['--check'], ov: 'models-off',
        setup: (h) => editJson(path.join(h, '.claude', 'settings.json'), (o) => {
          o.permissions.deny = o.permissions.deny.filter((/** @type {string} */ r) => r !== 'Bash(rm -rf:*)');
        }),
      },
      { args: [], ov: 'models-off' },
      { args: ['--check'], ov: 'models-off', setup: (h) => fs.unlinkSync(path.join(h, '.codex', 'rules', 'workstation-deny-floor.rules')) },
      { args: [], ov: 'models-off' },
    ],
  },
  {
    name: 'method',
    steps: [
      { args: ['--method'], ov: 'models-off', setup: (h) => put(path.join(h, '.claude', 'settings.json'), '{ "enabledPlugins": { "tadeumendonca-skills@tadeumendonca": true, "a@b": true } }') },
      { args: ['--check'], ov: 'models-off' },
    ],
  },
  { name: 'method-refused', steps: [{ args: ['--method'], ov: 'models-off', setup: (h) => put(path.join(h, '.claude', 'agents', 'developer.md'), "the owner's own agent\n") }] },
  {
    name: 'unmanaged-brief',
    steps: [
      { args: [], ov: 'models-off', setup: (h) => put(path.join(h, '.claude', 'CLAUDE.md'), 'my own hand-written brief\n') },
      { args: ['--check'], ov: 'models-off' },
    ],
  },
  {
    name: 'settings-merge',
    steps: [
      { args: ['--dry-run'], ov: 'models-off', setup: (h) => put(path.join(h, '.claude', 'settings.json'), SETTINGS) },
      { args: [], ov: 'models-off' },
      { args: [], ov: 'models-off' },
    ],
  },
  { name: 'settings-not-json', steps: [{ args: [], ov: 'models-off', setup: (h) => put(path.join(h, '.claude', 'settings.json'), '{ "model": \n') }] },
  { name: 'overlay-none', steps: [{ args: [], ov: 'none' }] },
  { name: 'deny-not-a-list', steps: [{ args: [], ov: 'models-off', setup: (h) => put(path.join(h, '.claude', 'settings.json'), '{ "permissions": { "deny": "Bash(rm -rf:*)" } }') }] },
  { name: 'overlay-floor', steps: [{ args: [], ov: 'floor', setup: (_h, t) => put(path.join(t, 'ov', 'floor', 'deny-floor.conf'), '# owner extra\ncmd terraform destroy\n') }] },
  ...BAD_FLOOR.map((e, i) => ({
    name: 'invalid-floor-' + String(i + 1).padStart(2, '0'),
    steps: [{ args: [], ov: 'floor', setup: (/** @type {string} */ _h, /** @type {string} */ t) => put(path.join(t, 'ov', 'floor', 'deny-floor.conf'), e + '\n') }],
  })),
  { name: 'usage-dry-run-and-check', steps: [{ args: ['--dry-run', '--check'], ov: 'models-off' }] },
  { name: 'usage-missing-overlay', steps: [{ args: [], ov: 'missing' }] },
  {
    name: 'profile-stale',
    steps: [{
      args: [], ov: 'profile',
      setup: (_h, t) => editJson(path.join(t, 'ov', 'profile', 'profile.json'), (o) => {
        o.session_start.priority = 'speed';
      }),
    }],
  },
  {
    name: 'issue-145',
    steps: [
      {
        args: [], ov: 'repo',
        setup: (h) => {
          put(path.join(h, '.claude', 'settings.json'), '{ "model": "owner-model", "permissions": { "allow": [ "Bash(find:*)", "Bash(awk *)", "Bash(ls:*)" ] } }');
          put(path.join(h, '.codex', 'config.toml'), 'model_reasoning_effort = "high"\n\n[mcp_servers.aws-api]\ncommand = "uvx"\n\n[mcp_servers.aws-api.env]\nAWS_PROFILE = "canary-value-5150"\n\n[mcp_servers.keep-me]\ncommand = "x"\n');
          put(path.join(h, '.kiro', 'settings', 'permissions.yaml'), 'rules:\n  - capability: shell\n    match:\n      - git *\n    effect: allow\n');
        },
      },
      { args: ['--check'], ov: 'repo' },
      { args: [], ov: 'repo' },
      {
        args: ['--check'], ov: 'repo',
        setup: (h) => editJson(path.join(h, '.claude', 'settings.json'), (o) => {
          o.permissions.allow = ['Bash(ls:*)', 'Bash(find *)'];
        }),
      },
    ],
  },
  {
    name: 'mhw-node',
    steps: [
      { args: ['--check'], ov: 'models-only', node: 'bogus' },
      { args: ['--check'], ov: 'models-only', node: 'node' },
    ],
  },
  { name: 'no-node', steps: [{ args: [], ov: 'models-off', path: 'no-node' }] },
  { name: 'codex-home', steps: [{ args: [], ov: 'models-off', codexHome: true }, { args: ['--check'], ov: 'models-off', codexHome: true }] },
];

/**
 * install.ps1's parameters for a step's mhw-style args (the mapping bin/mhw.js made before #497).
 * @param {string[]} args
 */
export function toPowerShell(args) {
  return args.flatMap((a) => {
    if (a === '--dry-run') return ['-DryRun'];
    if (a === '--check') return ['-Check'];
    if (a === '--method') return ['-Method'];
    if (a.startsWith('--overlay=')) return ['-Overlay', a.slice('--overlay='.length)];
    throw new Error('no install.ps1 form for ' + a);
  });
}
