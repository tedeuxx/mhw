// The S14 parity cases (#485, convention 3 of #470): the MCP active set and its connection check, each
// case on a throwaway HOME, every step through `node src/render/mcp.js`, whose --active mode ran the deleted
// global/mcp/mcp_active.py and mcp_connect.py at the base revision and runs src/commands/mcp-active.js and
// mcp-connect.js at the head. The S13 cases (test/render/mcp-cases.js) keep their four active-set cases;
// these add the shapes and refusals they do not reach. Every name, command and value here is SYNTHETIC.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { put, putJson, source, sourcePath, targets as t, activeHome, policyCopy, CANARY, STAMP } from '../render/mcp-cases.js';

export { CANARY };
export const STUB_SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'helpers', 'mcp-connect-stub.js');

/**
 * @typedef {{ home: string, data: string, base: string, url: string, closed: string }} Where
 * @typedef {{ args: string[], pre?: (w: Where) => void, env?: Record<string, string>, unset?: string[] }} Step
 * @typedef {{ name: string, setup?: (w: Where) => void, steps: Step[], dirs?: string[] }} Case
 */

const A = (/** @type {string} */ mode, /** @type {string[]} */ ...more) => ({ args: ['--active', '--mode=' + mode, '--stamp=' + STAMP, ...more] });
const C = (/** @type {string[]} */ ...more) => ({ args: ['--active', '--mode=connect', '--timeout=2', ...more] });
/** @param {Where} _w @param {string} file */
const readJ = (_w, file) => JSON.parse(fs.readFileSync(file, 'utf8'));
/** @param {Where} w @param {unknown} doc */
const settings = (w, doc) => putJson(t(w).settings, doc);
const SET = { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo' } } };

const CODEX_LAYOUTS = `model = "m"

[mcp_servers."q-x"]   # a quoted name and a comment
command = "/bin/echo"

[mcp_servers.'lit-y']
command = "/bin/echo"
enabled = "yes"

[mcp_servers.set-a]
command = "/bin/echo"

[mcp_servers."esc\\u0041pe"]
command = "/bin/echo"

[mcp_servers.sub-z]
command = "/bin/echo"

[mcp_servers.sub-z.env]
LEVEL = "1"

[mcp_servers.own-off]
enabled = false
command = "/bin/echo"

[projects."/tmp/p"]
trust_level = "trusted"

[mcp_servers.last-w]
command = "/bin/echo"`;

/** A stub server's entry: node runs the stub copied under <BASE>. @param {Where} w @param {string} mode @param {Record<string, unknown>} [more] */
function stub(w, mode, more = {}) {
  return { command: process.execPath, args: [path.join(w.base, 'stub.mjs'), mode, path.join(w.base, 'pid-' + mode)], ...more };
}
/** @param {Where} w */
const copyStub = (w) => fs.copyFileSync(STUB_SRC, path.join(w.base, 'stub.mjs'));

/** Turn a rendered server off on one agent harness, so a slow mode is checked once. @param {Where} w @param {string} name @param {string[]} where */
function offOn(w, name, where) {
  if (where.includes('codex')) put(t(w).codex, fs.readFileSync(t(w).codex, 'utf8').replace('[mcp_servers.' + name + ']\n', '[mcp_servers.' + name + ']\nenabled = false\n'));
  if (where.includes('kiro')) {
    const d = readJ(w, t(w).kiro);
    d.mcpServers[name].disabled = true;
    putJson(t(w).kiro, d);
  }
  if (where.includes('claude-code')) {
    const d = readJ(w, t(w).cc);
    delete d.mcpServers[name];
    putJson(t(w).cc, d);
  }
}

/** @type {Case[]} */
export const CASES = [
  {
    name: 'active-codex-layouts',
    setup: (w) => {
      source(w, SET);
      put(t(w).codex, CODEX_LAYOUTS);
    },
    steps: [A('check'), A('dry-run'), A('install'), A('check'), A('install'), A('uninstall'), A('check')],
  },
  {
    name: 'active-codex-inline-block-and-joins',
    setup: (w) => {
      source(w, SET);
      put(t(w).codex, '[mcp_servers]\ninline-x = { command = "/bin/echo" }\n\n[mcp_servers.tab-t]\ncommand = "/bin/echo"\n\n'
        + '# >>> managed-by: personal-multi-harness-workstation-configuration (mcp servers); generated\n[mcp_servers.rendered-r]\ncommand = "/bin/echo"\n'
        + '# <<< managed-by: personal-multi-harness-workstation-configuration (mcp servers)\n');
    },
    steps: [
      A('install'),
      A('check'),
      { args: A('install').args, pre: (w) => source(w, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo' }, 'tab-t': { command: '/bin/echo' } } }) },
      { args: A('install').args, pre: (w) => source(w, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo' }, 'tab-t': { command: '/bin/echo' }, 'inline-x': { command: '/bin/echo' } } }) },
      A('uninstall'),
    ],
  },
  {
    name: 'active-codex-unreadable',
    setup: (w) => source(w, SET),
    steps: [
      { args: A('check').args, pre: (w) => fs.mkdirSync(t(w).codex, { recursive: true }) },
      { args: A('check').args, pre: (w) => { fs.rmSync(t(w).codex, { recursive: true }); put(t(w).codex, 'model = \n'); } },
      { args: A('check').args, pre: (w) => fs.writeFileSync(t(w).codex, Buffer.from([0x6d, 0x3d, 0x22, 0xff, 0x22, 0x0a])) },
      { args: A('check').args, pre: (w) => fs.rmSync(t(w).codex) },
      { args: A('install').args },
    ],
  },
  {
    name: 'active-kiro-shapes',
    setup: (w) => {
      source(w, SET);
      putJson(t(w).kiro, { other: { keep: [1, 2.5, 'x'] }, mcpServers: { 'set-a': { command: '/bin/echo' }, 'k-false': { command: '/bin/echo', disabled: false }, 'k-one': { command: '/bin/echo', disabled: 1 }, 'k-none': { command: '/bin/echo' }, 'k-owner': { command: '/bin/echo', disabled: true }, 'k-str': 'not a server', 'node_repl': { command: '/bin/echo' } } });
    },
    steps: [A('check'), A('install'), A('check'), { args: A('check').args, pre: (w) => { const d = readJ(w, t(w).kiro); d.mcpServers['set-a'].disabled = true; putJson(t(w).kiro, d); } }, A('uninstall'), A('check')],
  },
  {
    name: 'active-kiro-refusals',
    setup: (w) => source(w, SET),
    steps: [
      { args: A('install').args, pre: (w) => putJson(t(w).kiro, { mcpServers: ['x'] }) },
      { args: A('install').args, pre: (w) => put(t(w).kiro, '{ nope') },
      { args: A('install').args, pre: (w) => putJson(t(w).kiro, [1, 2]) },
      { args: A('install').args, pre: (w) => put(t(w).kiro, '﻿{"mcpServers": {}}') },
      { args: A('install').args, pre: (w) => put(t(w).kiro, '{"mcpServers": {"k-nan": {"command": "/bin/echo", "x": NaN, "y": 1e400}}}') },
      A('uninstall'),
    ],
  },
  {
    name: 'active-claude-plugins',
    setup: (w) => {
      source(w, { version: 1, active_set: { connectors: { 'Synth A': 'on', 'Synth B': 'on', 'Synth Z': 'off' } }, servers: { 'set-a': { command: '/bin/cat', args: ['-u'] }, 'set-web': { command: '/bin/echo' } } });
      putJson(t(w).cc, { mcpServers: { 'set-a': { type: 'stdio', command: '/bin/cat', args: ['-u'] }, 'set-web': { type: 'http', url: 'https://Set.Example./mcp' }, 'u-out': { command: '/bin/echo' } } });
      const synced = path.join(w.home, '.claude', 'plugins', 'synced');
      putJson(path.join(synced, 'src-b', 'pb', '.mcp.json'), { flat: { command: '/bin/date' }, 'same-host': { type: 'http', url: 'https://set.example:443/other' }, wild: { type: 'http', url: 'https://*.synth.example/mcp' } });
      putJson(path.join(synced, 'src-a', 'pa', '.mcp.json'), { mcpServers: { dup: { command: '/bin/date' }, cred: { type: 'http', url: 'https://u:' + CANARY + '@synth.example/mcp' }, argcred: { command: '/bin/x', args: ['--token', 'Bearer ' + CANARY] } } });
      putJson(path.join(synced, 'src-a', 'pa', '.claude-plugin', 'plugin.json'), { name: 'pa', mcpServers: { inl: { command: '/bin/inline' }, bad: 3 } });
      putJson(path.join(synced, '.hidden', 'ph', '.mcp.json'), { mcpServers: { hidden: { command: '/bin/hidden' } } });
      put(path.join(synced, 'src-a', 'not-a-dir'), 'x');
      put(path.join(synced, 'src-c', 'pc', '.mcp.json'), '{ broken');
      const inst = path.join(w.base, 'installed', 'pi');
      putJson(path.join(inst, '.mcp.json'), { mcpServers: { inst: { command: '/bin/inst', args: ['${CLAUDE_PLUGIN_ROOT}'] }, plain: { command: '/bin/plain' } } });
      putJson(path.join(w.home, '.claude', 'plugins', 'installed_plugins.json'), { version: 2, plugins: { 'pi@mkt': [{ installPath: inst }, { installPath: '' }, 'x'], 'gone@mkt': [{ installPath: path.join(w.base, 'no-such') }], weird: 3 } });
      settings(w, { model: 'synthetic', deniedMcpServers: [{ serverUrl: 'https://*.example/*' }, { serverName: 'owners-own' }, 'odd', { serverCommand: ['/bin/cat', '-u'] }] });
    },
    steps: [A('check'), A('install'), A('check'), A('dry-run'), A('uninstall'), A('check')],
  },
  {
    name: 'active-claude-refusals',
    setup: (w) => source(w, SET),
    steps: [
      { args: A('install').args, pre: (w) => settings(w, { deniedMcpServers: { a: 1 } }) },
      { args: A('install').args, pre: (w) => settings(w, [1]) },
      { args: A('install').args, pre: (w) => { settings(w, {}); put(t(w).cc, '{ nope'); } },
      { args: A('install').args, pre: (w) => putJson(t(w).cc, { mcpServers: ['x'] }) },
      { args: A('install').args, pre: (w) => fs.rmSync(t(w).settings) },
      A('uninstall'),
    ],
  },
  {
    name: 'active-manifest-shapes',
    setup: (w) => source(w, SET),
    steps: [
      { args: A('check').args, pre: (w) => putJson(path.join(w.data, 'mcp-managed.json'), { version: 1, surfaces: {}, active: { kiro: { a: [1, 2] } } }) },
      { args: A('check').args, pre: (w) => putJson(path.join(w.data, 'mcp-managed.json'), { version: 1, surfaces: {}, active: { codex: { a: 3 } } }) },
      { args: A('check').args, pre: (w) => putJson(path.join(w.data, 'mcp-managed.json'), { version: 1, surfaces: {}, active: { 'claude-code': [{ entry: {}, label: 3 }] } }) },
      { args: A('check').args, pre: (w) => putJson(path.join(w.data, 'mcp-managed.json'), { version: 1, surfaces: {}, active: [] }) },
      { args: A('check').args, pre: (w) => put(path.join(w.data, 'mcp-managed.json'), '{ nope') },
      { args: A('install').args, pre: (w) => putJson(path.join(w.data, 'mcp-managed.json'), { version: 1, surfaces: { codex: ['x'] }, stamps: {}, active: { codex: { gone: null } } }) },
      A('uninstall'),
    ],
  },
  { name: 'active-not-installed', dirs: [], setup: (w) => source(w, SET), steps: [A('check'), A('install'), { args: A('check').args, pre: (w) => source(w, { version: 1, servers: {} }) }] },
  {
    name: 'active-source-option',
    setup: (w) => {
      activeHome(w);
      putJson(path.join(w.base, 'elsewhere.json'), SET);
    },
    steps: [
      A('check', '--source=<BASE>/elsewhere.json'),
      A('check', '--source=<BASE>/absent.json'),
      { args: A('check', '--source=<BASE>/broken.json').args, pre: (w) => put(path.join(w.base, 'broken.json'), '{ nope') },
      A('check', '--source=<BASE>/elsewhere.json', '--mode=install'),
      A('uninstall', '--source=<BASE>/absent.json'),
    ],
  },
  {
    name: 'active-policy-member-and-desktop',
    setup: (w) => {
      source(w, { version: 1, active_set: {}, servers: { 'set-a': { command: '/bin/echo' }, 'chrome-devtools': policyCopy({ surfaces: ['codex', 'kiro'] }) } });
      putJson(t(w).cc, { mcpServers: { 'chrome-devtools': { command: '/bin/sh' } } });
    },
    steps: [A('check'), { args: [] }, A('check'), A('install'), A('check')],
  },
  // ---------------------------------------------------------------------------- the connection check
  {
    name: 'connect-stdio',
    setup: (w) => {
      copyStub(w);
      /** @type {Record<string, unknown>} */
      const servers = Object.fromEntries(['ok', 'error', 'exit', 'sigterm', 'fork-ok', 'fork-exit', 'float-id', 'hang', 'eof', 'eof-exit'].map((m) => ['s-' + m, stub(w, m)]));
      servers['s-secret'] = stub(w, 'needenv', { secrets: { SYNTH_TOKEN: 'env:SYNTH_SRC' } });
      servers['s-nocmd'] = { command: '/bin/echo' };
      source(w, { version: 1, active_set: {}, servers });
    },
    steps: [
      { args: [] },
      {
        ...C(),
        env: { SYNTH_SRC: 'synthetic-token-' + CANARY, SYNTH_CANARY: CANARY },
        pre: (w) => {
          for (const slow of ['s-hang', 's-eof']) offOn(w, slow, ['kiro', 'claude-code']);
          for (const once of ['s-fork-ok', 's-fork-exit', 's-sigterm', 's-eof-exit', 's-float-id']) offOn(w, once, ['codex', 'kiro']);
          const cc = readJ(w, t(w).cc);
          cc.mcpServers['s-nocmd'] = { type: 'stdio' };
          cc.mcpServers['not-a-member'] = { command: '/usr/bin/touch', args: [path.join(w.base, 'started')] };
          cc.mcpServers['claude-in-chrome'] = { command: '/usr/bin/touch', args: [path.join(w.base, 'started')] };
          putJson(t(w).cc, cc);
          const kiro = readJ(w, t(w).kiro);
          kiro.mcpServers['s-nocmd'] = { command: '/no/such/synthetic-binary' };
          putJson(t(w).kiro, kiro);
        },
      },
    ],
  },
  {
    name: 'connect-expansion',
    setup: (w) => {
      copyStub(w);
      const ac = { command: process.execPath, args: [path.join(w.base, 'stub.mjs'), 'argcheck', path.join(w.base, 'pid-argcheck'), 'expanded-value'], env: { SYNTH_E: 'expanded-value' } };
      source(w, { version: 1, active_set: {}, servers: { 's-arg': ac } });
    },
    steps: [
      { args: [] },
      {
        ...C(),
        env: { SYNTH_X: 'expanded-value', SYNTH_EMPTY: '' },
        pre: (w) => {
          // ${VAR} in each harness's entry: Claude Code and Kiro expand it, Codex does not.
          const swap = (/** @type {string} */ s) => s.replaceAll('"expanded-value"', '"${SYNTH_X}"');
          put(t(w).codex, swap(fs.readFileSync(t(w).codex, 'utf8')));
          for (const f of [t(w).cc, t(w).kiro]) {
            const d = readJ(w, f);
            d.mcpServers['s-arg'].args[3] = '${SYNTH_EMPTY:-expanded-value}';
            d.mcpServers['s-arg'].env = { SYNTH_E: '${SYNTH_UNSET:-expanded}-${SYNTH_EMPTY}value', SYNTH_LATER: '${SYNTH_E}' };
            putJson(f, d);
          }
        },
      },
    ],
  },
  {
    name: 'connect-http',
    setup: (w) => source(w, { version: 1, active_set: {}, servers: Object.fromEntries(['h-ok', 'h-login', 'h-bare', 'h-empty', 'h-404', 'h-500', 'h-sse', 'h-sse-post', 'h-302', 'h-307', 'h-loop', 'h-closed', 'h-env', 'h-header'].map((n) => [n, { command: '/bin/echo' }])) }),
    steps: [
      { args: [] },
      {
        ...C(),
        env: { SYNTH_HOST_URL: '<URL>' },
        pre: (w) => {
          /** @type {Record<string, unknown>} */
          const http = {
            'h-ok': { type: 'http', url: w.url + '/ok' },
            'h-login': { type: 'http', url: w.url + '/login' },
            'h-bare': { type: 'http', url: w.url + '/bare401' },
            'h-empty': { type: 'http', url: w.url + '/empty401' },
            'h-404': { url: w.url + '/missing' },
            'h-500': { type: 'http', url: w.url + '/boom' },
            'h-sse': { type: 'sse', url: w.url + '/sse' },
            'h-sse-post': { transport: 'http', url: w.url + '/sse' },
            'h-302': { type: 'http', url: w.url + '/redir302' },
            'h-307': { type: 'http', url: w.url + '/redir307' },
            'h-loop': { type: 'sse', url: w.url + '/loop' },
            'h-closed': { type: 'http', url: w.closed + '/mcp' },
            'h-env': { type: 'http', url: '${SYNTH_HOST_URL}/ok' },
            'h-header': { type: 'http', url: w.url + '/ok', headers: { 'X-Synth-Auth': CANARY } },
          };
          for (const f of [t(w).cc, t(w).kiro]) {
            const d = readJ(w, f);
            for (const [n, e] of Object.entries(http)) d.mcpServers[n] = e;
            putJson(f, d);
          }
          // Codex does not expand ${VAR}, and an unexpanded URL is not a URL: its h-env stays /bin/echo here
          // (the not-a-URL case is connect-not-a-url).
          let codex = fs.readFileSync(t(w).codex, 'utf8');
          for (const [n, e] of Object.entries(http)) if (n !== 'h-env') codex = codex.replace('[mcp_servers.' + n + ']\ncommand = "/bin/echo"\nargs = []\n', '[mcp_servers.' + n + ']\nurl = ' + JSON.stringify(/** @type {any} */ (e).url) + '\n');
          put(t(w).codex, codex);
        },
      },
    ],
  },
  {
    // A URL with no scheme: the original's urllib refused it outside its try, so a traceback ended the run
    // at the first such server (exit 1); declared in test/golden/S14/expected-differences.json.
    name: 'connect-not-a-url',
    setup: (w) => source(w, { version: 1, active_set: {}, servers: { 'h-noscheme': { command: '/bin/echo' } } }),
    steps: [
      { args: [] },
      {
        ...C(),
        pre: (w) => {
          for (const f of [t(w).cc, t(w).kiro]) {
            const d = readJ(w, f);
            d.mcpServers['h-noscheme'] = { type: 'http', url: 'no-scheme-here' };
            putJson(f, d);
          }
          put(t(w).codex, fs.readFileSync(t(w).codex, 'utf8').replace('command = "/bin/echo"\nargs = []\n', 'url = "${SYNTH_UNEXPANDED}/mcp"\n'));
        },
      },
    ],
  },
  {
    name: 'connect-unreadable-and-undeclared',
    setup: (w) => {
      copyStub(w);
      source(w, { version: 1, active_set: {}, servers: { 's-ok': stub(w, 'ok') } });
    },
    steps: [
      { args: [] },
      { ...C(), pre: (w) => { put(t(w).kiro, '{ broken'); put(t(w).codex, 'model = \n'); } },
      { ...C(), pre: (w) => { putJson(t(w).kiro, { mcpServers: [] }); putJson(t(w).cc, ['x']); } },
      { ...C(), pre: (w) => { putJson(t(w).cc, { mcpServers: {} }); fs.rmSync(t(w).kiro); put(t(w).codex, ''); } },
      { ...C(), pre: (w) => source(w, { version: 1, servers: {} }) },
      { ...C(), pre: (w) => fs.rmSync(sourcePath(w)) },
      { ...C('--source=<BASE>/broken.json'), pre: (w) => put(path.join(w.base, 'broken.json'), '{ nope') },
    ],
  },
];
