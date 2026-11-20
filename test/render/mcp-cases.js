// The S13 parity cases (#484, convention 3 of #470): each one builds a throwaway HOME, runs the MCP renderer
// through a list of steps and records what it printed and every file under that HOME. The golden test
// (test/render/mcp-golden.test.js) plays them on the head (node src/render/mcp.js) and on the base
// revision's deleted global/mcp/mcp_render.py. Every name, command and value here is SYNTHETIC.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PROJECT = 'personal-multi-harness-workstation-configuration';
export const STAMP = 'release: v0.0.0-test; commit: synthetic';
// A synthetic value placed where a credential would sit, so a transcript can show it is never printed or
// copied. Fixed, so the transcripts are stable; nothing here is a credential.
export const CANARY = 'synthetic-s13-canary-4b1d7e';

/**
 * @typedef {{ home: string, data: string, base: string }} Where
 * @typedef {{ args: string[], pre?: (w: Where) => void, env?: Record<string, string>, unset?: string[] }} Step
 * @typedef {{ name: string, setup?: (w: Where) => void, steps: Step[], dirs?: string[] }} Case
 */

/** Write a fixture file, owner-only (0600) whatever the umask, so a transcript records the same mode on every runner. @param {string} file @param {string} text */
export function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  fs.chmodSync(file, 0o600);
}
/** @param {string} file @param {unknown} doc */
export const putJson = (file, doc) => put(file, JSON.stringify(doc));
/** @param {Where} w */
export const sourcePath = (w) => path.join(w.data, 'local-overlay', 'mcp-servers.json');
/** @param {Where} w @param {unknown} doc */
export const source = (w, doc) => putJson(sourcePath(w), doc);
/** @param {Where} w */
const t = (w) => ({
  codex: path.join(w.home, '.codex', 'config.toml'),
  cc: path.join(w.home, '.claude.json'),
  kiro: path.join(w.home, '.kiro', 'settings', 'mcp.json'),
  settings: path.join(w.home, '.claude', 'settings.json'),
});
export const targets = t;

/** The standard definition: a plain server, a secret-bearing one (env: source) and a Codex-only one. @param {Record<string, unknown>} [extra] */
export function sourceDoc(extra = {}) {
  return {
    version: 1,
    servers: {
      'fake-plain': { command: '/bin/echo', args: ['hello'], env: { FAKE_REGION: 'zz-1' } },
      'fake-secret': { command: '/bin/cat', args: ['-u'], secrets: { FAKE_API_TOKEN: 'env:FAKE_SRC_VAR' } },
      'fake-codex-only': { command: '/bin/cat', surfaces: ['codex'] },
      ...extra,
    },
  };
}

/** The policy server's command and args, every surface by default, as the local definition copies it. @param {Record<string, unknown>} [change] */
export function policyCopy(change = {}) {
  const p = JSON.parse(fs.readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'global', 'mcp', 'policy-servers.json'), 'utf8'));
  const s = p.servers['chrome-devtools'];
  return { command: s.command, args: [...s.args], ...change };
}

const ACTIVE_CODEX = `approval_policy = "on-request"

[mcp_servers.set-a]
command = "/bin/echo"

[mcp_servers.out-b]
command = "/bin/echo"

[mcp_servers.out-b.env]
SYNTH = "${CANARY}"

[mcp_servers.out-c]
enabled = true # kept as written
command = "/bin/echo"

[mcp_servers.own-off]
enabled = false
command = "/bin/echo"

[mcp_servers.node_repl]
command = "/bin/echo"
`;

/** A HOME with every kind of server the active set meets (mcp_render_test.py's active_home). @param {Where} w */
export function activeHome(w) {
  const x = t(w);
  source(w, { version: 1, servers: { 'set-a': { command: '/bin/echo' } }, active_set: { connectors: { 'Synth On': 'on', 'Synth Off': 'off' } } });
  put(x.codex, ACTIVE_CODEX);
  putJson(x.kiro, { mcpServers: { 'set-a': { command: '/bin/echo' }, 'out-k': { command: '/bin/echo', env: { SYNTH: CANARY } }, 'out-k2': { command: '/bin/echo', disabled: false }, 'own-off': { command: '/bin/echo', disabled: true } } });
  putJson(x.cc, { numStartups: 3, mcpServers: { 'set-a': { type: 'stdio', command: '/bin/echo' }, 'out-u': { type: 'stdio', command: '/bin/echo' }, 'chrome-devtools': { command: '/bin/sh' }, 'claude-in-chrome': { command: '/bin/echo' } } });
  putJson(x.settings, { model: 'synthetic', deniedMcpServers: [{ serverName: 'owners-own' }] });
  const synced = path.join(w.home, '.claude', 'plugins', 'synced', 'src1', 'plug1');
  putJson(path.join(synced, '.mcp.json'), { mcpServers: { web: { type: 'http', url: 'https://synth.example/mcp' }, varred: { command: '${CLAUDE_PLUGIN_ROOT}/bin/x' }, leaky: { type: 'http', url: 'https://synth.example/mcp?token=' + CANARY }, envurl: { type: 'http', url: 'https://${SYNTH_HOST}/mcp' } } });
  const inst = path.join(w.home, '.claude', 'plugins', 'cache', 'mkt', 'plug2', '1.0.0');
  putJson(path.join(inst, '.claude-plugin', 'plugin.json'), { name: 'plug2', mcpServers: { local: { command: '/bin/cat', args: ['-u'] } } });
  putJson(path.join(w.home, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'plug2@mkt': [{ installPath: inst, scope: 'user' }] } });
}

const P = (/** @type {string} */ mode, /** @type {string[]} */ ...more) => ({ args: ['--policy', '--mode=' + mode, '--stamp=' + STAMP, ...more] });
const A = (/** @type {string} */ mode, /** @type {string[]} */ ...more) => ({ args: ['--active', '--mode=' + mode, '--stamp=' + STAMP, ...more] });
const legacy = (/** @type {Where} */ w) => put(path.join(w.data, 'mcp-launch.sh'), '#!/bin/sh\n# managed-by: ' + PROJECT + '; source: global/mcp/mcp-launch.sh; x; do not edit\nexec "$@"\n');

/** @type {Case[]} */
export const CASES = [
  { name: 'render-dry-run', setup: (w) => source(w, sourceDoc()), steps: [{ args: ['--dry-run'] }] },
  { name: 'render-install-check-reinstall', setup: (w) => source(w, sourceDoc()), steps: [{ args: [] }, { args: ['--check'] }, { args: [] }] },
  {
    name: 'render-keeps-other-keys-and-hand-servers',
    setup: (w) => {
      put(t(w).codex, '# my own comment\nmodel = "m"\n\n[mcp_servers.hand-made]\ncommand = "x"\nenv = { HAND_TOKEN = "' + CANARY + '" }\n\n[projects."/tmp/p"]\ntrust_level = "trusted"\n');
      fs.chmodSync(t(w).codex, 0o640);
      for (const f of [t(w).cc, t(w).kiro]) putJson(f, { preferences: { theme: 'dark' }, numStartups: 3, mcpServers: { 'hand-made': { command: 'x', args: [] } } });
      source(w, sourceDoc());
    },
    steps: [{ args: ['--dry-run'] }, { args: [] }, { args: ['--check'] }],
  },
  {
    name: 'render-drift-and-repair',
    setup: (w) => source(w, sourceDoc()),
    steps: [
      { args: [] },
      { args: ['--check'], pre: (w) => put(t(w).codex, fs.readFileSync(t(w).codex, 'utf8').replace('args = ["hello"]', 'args = ["hello"]\nenabled = false')) },
      { args: [] },
      {
        args: ['--check'],
        pre: (w) => {
          const d = JSON.parse(fs.readFileSync(t(w).kiro, 'utf8'));
          d.mcpServers['fake-plain'].args = ['tampered'];
          putJson(t(w).kiro, d);
        },
      },
      { args: [] },
      { args: ['--check'] },
    ],
  },
  {
    name: 'render-a-removed-server-leaves',
    setup: (w) => {
      putJson(t(w).kiro, { mcpServers: { 'hand-made': { command: 'x' } } });
      source(w, sourceDoc());
    },
    steps: [
      { args: [] },
      { args: ['--check'], pre: (w) => { const d = sourceDoc(); delete (/** @type {any} */ (d.servers))['fake-plain']; source(w, d); } },
      { args: [] },
      { args: [], pre: (w) => source(w, { version: 1, servers: {} }) },
      { args: ['--check'] },
    ],
  },
  {
    name: 'render-hand-server-codex-refused',
    setup: (w) => {
      put(t(w).codex, '[mcp_servers.fake-plain]\ncommand = "mine"\n');
      source(w, sourceDoc());
    },
    steps: [{ args: ['--surfaces=codex'] }, { args: ['--surfaces=codex', '--adopt'] }],
  },
  {
    name: 'render-hand-server-json-adopted',
    setup: (w) => {
      putJson(t(w).kiro, { mcpServers: { 'fake-plain': { command: 'mine' } } });
      source(w, sourceDoc());
    },
    steps: [{ args: ['--surfaces=kiro'] }, { args: ['--surfaces=kiro', '--adopt'] }, { args: ['--surfaces=kiro', '--check'] }],
  },
  {
    name: 'render-codex-content-after-the-block',
    setup: (w) => source(w, sourceDoc()),
    steps: [
      { args: ['--surfaces=codex'] },
      { args: ['--surfaces=codex'], pre: (w) => fs.appendFileSync(t(w).codex, 'startup_timeout_sec = 30\n') },
      { args: ['--surfaces=codex'], pre: (w) => put(t(w).codex, fs.readFileSync(t(w).codex, 'utf8').replace('# <<< managed-by: ' + PROJECT + ' (mcp servers)', '')) },
    ],
  },
  {
    name: 'render-invalid-definitions',
    setup: (w) => source(w, { version: 1, servers: { s: { command: 'x', env: { MY_SECRET: 'v' } } } }),
    steps: [
      { args: [] },
      { args: ['--dry-run'], pre: (w) => source(w, { version: 1, servers: { s: { command: 'x', env: { SETTING: 'gh' + 'p_' + 'Q'.repeat(36) } } } }) },
      {
        args: ['--check'],
        pre: (w) => source(w, {
          version: 2,
          extra: 1,
          servers: {
            'bad name': { command: 'x' },
            k: { command: 'x', commandd: 'y', args: ['--auth-token=v', 'a\nb'], secrets: { T: 'file:/x', V: 'env:BAD-NAME' }, surfaces: ['vim'] },
            e: { command: ' ', env: { T: 'v' }, not_secret: ['T'], secrets: { T: 'env:V' } },
          },
          active_set: { connectors: { ' Synth': 'maybe' }, unknown: 1, description: 3 },
        }),
      },
      { args: ['--dry-run'], pre: (w) => put(sourcePath(w), '{ "version": 1, ') },
      { args: ['--dry-run'], pre: (w) => fs.rmSync(sourcePath(w)) },
      { args: ['--dry-run', '--source=' + '<BASE>/a-directory'], pre: (w) => fs.mkdirSync(path.join(w.base, 'a-directory'), { recursive: true }) },
    ],
  },
  {
    name: 'render-invalid-existing-configs',
    setup: (w) => {
      put(t(w).cc, '{ "numStartups": ');
      put(t(w).codex, 'model = \n');
      putJson(t(w).kiro, ['not', 'an', 'object']);
      source(w, sourceDoc());
    },
    steps: [{ args: [] }, { args: ['--check'] }],
  },
  {
    name: 'render-foreign-launcher',
    setup: (w) => {
      put(path.join(w.data, 'mcp-launch.mjs'), "#!/usr/bin/env node\nconsole.log('someone else')\n");
      source(w, sourceDoc());
    },
    steps: [{ args: [] }],
  },
  {
    name: 'render-retired-shell-launcher',
    setup: (w) => source(w, sourceDoc()),
    steps: [
      { args: [] },
      { args: ['--check'], pre: legacy },
      { args: ['--dry-run'] },
      { args: [] },
      { args: ['--check'] },
      { args: [], pre: (w) => put(path.join(w.data, 'mcp-launch.sh'), '#!/bin/sh\necho someone else\n') },
    ],
  },
  {
    name: 'render-retired-launcher-kept-while-named',
    setup: (w) => source(w, sourceDoc()),
    steps: [
      { args: [] },
      {
        args: [],
        pre: (w) => {
          legacy(w);
          const d = JSON.parse(fs.readFileSync(t(w).kiro, 'utf8'));
          d.mcpServers['hand-made'] = { command: path.join(w.data, 'mcp-launch.sh'), args: ['--', '/bin/true'] };
          putJson(t(w).kiro, d);
        },
      },
      { args: [], pre: (w) => put(t(w).cc, '{ not json') },
    ],
  },
  {
    name: 'render-stamp-only-difference',
    setup: (w) => source(w, sourceDoc()),
    steps: [
      { args: [] },
      {
        args: ['--check'],
        pre: (w) => {
          const other = 'release: v0.0.1; commit: 0123456789abcdef0123456789abcdef01234567';
          const re = /release: [^;\n]*; commit: [^;\n")]*/g;
          for (const f of [path.join(w.data, 'mcp-launch.mjs'), t(w).codex]) {
            const mode = fs.statSync(f).mode & 0o777;
            fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replaceAll(re, other));
            fs.chmodSync(f, mode);
          }
          const m = JSON.parse(fs.readFileSync(path.join(w.data, 'mcp-managed.json'), 'utf8'));
          m.stamps.kiro = other;
          putJson(path.join(w.data, 'mcp-managed.json'), m);
        },
      },
      { args: [] },
      { args: ['--check'] },
    ],
  },
  {
    name: 'render-secrets-without-node',
    setup: (w) => source(w, sourceDoc()),
    steps: [
      { args: [], env: { PATH: '<BASE>/empty-path' }, unset: ['MHW_NODE'], pre: (w) => fs.mkdirSync(path.join(w.base, 'empty-path'), { recursive: true }) },
      { args: [], env: { MHW_NODE: '<BASE>/no-such-node' } },
      {
        args: [],
        env: { PATH: '<BASE>/empty-path' },
        unset: ['MHW_NODE'],
        pre: (w) => {
          const d = sourceDoc();
          delete (/** @type {any} */ (d.servers))['fake-secret'];
          source(w, d);
        },
      },
    ],
  },
  {
    name: 'render-agent-session',
    setup: (w) => source(w, sourceDoc()),
    steps: [
      { args: [], env: { CLAUDECODE: '1', XDG_DATA_HOME: '<BASE>/elsewhere-data' }, pre: (w) => fs.mkdirSync(path.join(w.base, 'elsewhere-data'), { recursive: true }) },
      { args: ['--source=<DATA>/local-overlay/mcp-servers.json'], env: { CLAUDECODE: '1', CODEX_HOME: '<BASE>/elsewhere-codex' }, pre: (w) => fs.mkdirSync(path.join(w.base, 'elsewhere-codex'), { recursive: true }) },
      { args: [], env: { CLAUDECODE: '1' } },
      { args: ['--scan'], env: { CLAUDECODE: '1' } },
    ],
  },
  {
    name: 'render-usage',
    steps: [{ args: ['--bogus'] }, { args: ['--surfaces=vim,codex'] }, { args: ['--surfaces='] }, { args: ['--policy', '--active'] }, P('report'), { args: ['--policy', '--stamp='] }, { args: ['--policy', '--adopt'] }, A('report'), { args: ['--active', '--stamp='] }, { args: ['--active', '--adopt'] }, { args: ['--active', '--mode=connect', '--timeout=0'] }, { args: ['--active', '--mode=check', '--timeout=5'] }],
  },
  {
    name: 'render-policy-extension-identical',
    setup: (w) => source(w, sourceDoc({ 'chrome-devtools': policyCopy() })),
    steps: [{ args: [] }, P('install'), { args: [] }, { args: ['--check'] }, P('check'), P('uninstall'), { args: ['--check'] }],
  },
  {
    name: 'render-policy-extension-conflict',
    setup: (w) => source(w, sourceDoc({ 'chrome-devtools': policyCopy({ args: ['-c', 'exec /bin/echo synthetic'] }) })),
    steps: [
      { args: [] },
      { args: [], pre: (w) => source(w, sourceDoc({ 'chrome-devtools': policyCopy() })) },
      { args: [], pre: (w) => source(w, sourceDoc({ 'chrome-devtools': policyCopy({ args: ['-c', 'exec /bin/echo synthetic'] }), 'fake-new': { command: '/bin/echo' } })) },
      { args: ['--check'] },
      { args: [], pre: (w) => source(w, sourceDoc({ 'chrome-devtools': policyCopy({ args: ['-c', 'exec /bin/echo synthetic'], surfaces: ['codex', 'kiro'] }) })) },
    ],
  },
  {
    name: 'scan',
    setup: (w) => {
      put(t(w).codex, '[mcp_servers.svc-a]\ncommand = "x"\nargs = ["--api-key", "' + CANARY + '-0"]\nenv = { SVC_TOKEN = "' + CANARY + '-1", REGION = "eu" }\n\n[mcp_servers.svc-r]\nurl = "https://h/mcp"\nbearer_token = "' + CANARY + '-2"\n');
      putJson(t(w).kiro, { mcpServers: { 'svc-b': { command: 'x', args: ['--password=' + CANARY + '-3'], headers: { Authorization: CANARY + '-4' } }, 'svc-u': { url: 'https://h/mcp?access_token=' + CANARY + '-5' } } });
      fs.copyFileSync(t(w).kiro, t(w).kiro + '.pmhwc-backup');
      fs.copyFileSync(t(w).kiro, t(w).kiro + '.new.4242');
      putJson(t(w).cc, { mcpServers: { 'svc-c': { command: 'x', env: { SETTING: 'gh' + 'p_' + 'W'.repeat(36) } } } });
      put(t(w).cc + '.pmhwc-mcp-policy-backup', '{ broken');
    },
    steps: [{ args: ['--scan'] }, { args: ['--scan', '--surfaces=kiro'] }],
  },
  {
    name: 'policy-install-check-uninstall',
    setup: (w) => putJson(t(w).cc, { numStartups: 7, mcpServers: { mine: { command: '/bin/echo' } } }),
    steps: [P('check'), P('dry-run'), P('install'), P('install'), P('check'), { args: ['--policy', '--mode=check', '--stamp=release: other; commit: other'] }, { args: ['--policy', '--mode=dry-run', '--stamp=release: other; commit: other'] }, P('uninstall'), P('uninstall')],
  },
  {
    name: 'policy-refusals',
    setup: (w) => putJson(t(w).cc, { mcpServers: { 'chrome-devtools': { command: 'npx', args: ['chrome-devtools-mcp@latest'] } } }),
    steps: [P('install'), P('install', '--stamp=x'), { args: P('install').args, pre: (w) => put(t(w).cc, '[1, 2]') }, { args: P('install').args, pre: (w) => put(t(w).cc, '{"mcpServers": []}') }, { args: P('install').args, pre: (w) => put(t(w).cc, '{ nope') }],
  },
  { name: 'policy-not-installed', dirs: [], steps: [P('install'), P('check')] },
  {
    name: 'active-install-check-uninstall',
    setup: activeHome,
    steps: [A('check'), A('dry-run'), A('install'), A('check'), A('install'), A('uninstall'), A('check')],
  },
  {
    name: 'active-undeclared-and-absent',
    setup: (w) => {
      activeHome(w);
      source(w, { version: 1, servers: { 'set-a': { command: '/bin/echo' } } });
    },
    steps: [A('check'), A('install'), { args: A('install').args, pre: (w) => fs.rmSync(sourcePath(w)) }],
  },
  {
    name: 'active-a-server-joins-the-set',
    setup: activeHome,
    steps: [
      A('install'),
      { args: A('install').args, pre: (w) => source(w, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo' }, 'out-b': { command: '/bin/echo' } } }) },
      { args: A('install').args, pre: (w) => source(w, { version: 1, servers: { 'set-a': { command: '/bin/echo' } } }) },
    ],
  },
  {
    name: 'active-with-the-render-and-the-policy',
    setup: (w) => source(w, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo', surfaces: ['codex', 'claude-code', 'kiro'] }, 'chrome-devtools': policyCopy({ args: ['-c', 'exec /bin/echo synthetic'], surfaces: ['codex', 'kiro'] }), 'fake-secret': { command: '/bin/cat', secrets: { S_TOKEN: 'env:S_SRC' } } } }),
    steps: [P('install'), { args: [] }, A('check'), A('install'), A('check'), { args: A('check').args, pre: (w) => source(w, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo' }, 'chrome-devtools': policyCopy({ args: ['-c', 'exec /bin/echo other'] }) } }) }],
  },
];
