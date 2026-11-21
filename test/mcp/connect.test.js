// src/commands/mcp-connect.js (#485, S14 of #470): the MCP connection check in Node. The behaviour table the
// deleted mcp_connect.py was held to (#225 QA, pinned again on #484): one row per behaviour the ADR-0041
// amendment, the README row or the usage text states, now on the Node form: the process-group kill, the
// timeout, ${VAR} expansion per agent harness and "no configured header sent". Throwaway HOMEs; every
// server is the synthetic stub test/helpers/mcp-connect-stub.js or a local HTTP stub; no value printed.
import { test, after, before, describe as group } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { throwawayHome } from '../helpers/home.js';
import { mcpHomes } from '../helpers/mcp-home.js';
import * as M from '../../src/render/mcp.js';
import * as C from '../../src/commands/mcp-connect.js';
import { ActiveSet } from '../../src/commands/mcp-active.js';
import { put, putJson } from '../render/mcp-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RENDER = path.join(ROOT, 'src', 'render', 'mcp.js');
const STUB = path.join(ROOT, 'test', 'helpers', 'mcp-connect-stub.js');
const NODE = process.execPath;
const POSIX = process.platform !== 'win32';
const POSIX_ONLY = !POSIX && 'the connection check is not available on Windows';
const box = throwawayHome('mcp-connect');
after(() => box.cleanup());
const BASE = box.dir;
const synth = () => 'synthetic-' + crypto.randomBytes(12).toString('hex');

const { mkHome, targets, writeSource, cleanEnv } = mcpHomes(BASE, RENDER);
/** @param {string} p */
const jload = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
/** A child run while this process keeps serving the HTTP stub. @param {string[]} args @param {Record<string, string>} env */
const runAsync = (args, env) => /** @type {Promise<{ code: number | null, stdout: string, stderr: string, ms: number }>} */ (new Promise((resolve) => {
  const t0 = Date.now();
  const c = spawn(NODE, [RENDER, ...args], { env, cwd: BASE });
  let stdout = '';
  let stderr = '';
  c.stdout.on('data', (b) => { stdout += b; });
  c.stderr.on('data', (b) => { stderr += b; });
  c.stdin.end();
  c.on('close', (code) => resolve({ code, stdout, stderr, ms: Date.now() - t0 }));
}));
/** node with these arguments, while this process keeps serving its stubs. @param {string[]} args @param {Record<string, string>} env */
const nodeAsync = (args, env) => /** @type {Promise<{ code: number | null, stdout: string, stderr: string }>} */ (new Promise((resolve) => {
  const c = spawn(NODE, args, { env, cwd: BASE, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  c.stdout.on('data', (b) => { stdout += b; });
  c.stderr.on('data', (b) => { stderr += b; });
  c.on('close', (code) => resolve({ code, stdout, stderr }));
}));
/** @param {string} pidfile */
function alive(pidfile) {
  try {
    process.kill(Number(fs.readFileSync(pidfile, 'utf8')), 0);
    return true;
  } catch {
    return false;
  }
}
/** Dead within five seconds (a killed process is reaped by its parent, init, a moment later). @param {string} pidfile */
async function dead(pidfile) {
  const until = Date.now() + 5000;
  while (alive(pidfile) && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
  return !alive(pidfile);
}
/** A Ctx on a HOME. @param {string} h @param {Record<string, string>} [extra] @returns {M.Ctx & { lines: string[] }} */
function ctxOf(h, extra = {}) {
  /** @type {string[]} */
  const lines = [];
  return { env: cleanEnv(h, extra), platform: process.platform, cwd: BASE, out: (s) => { lines.push(s); }, err: (s) => { lines.push(s); }, lines };
}
/** A stub server's entry. @param {string} d @param {string} m @param {string[]} [more] */
const stubEntry = (d, m, more = []) => new Map(Object.entries({ command: NODE, args: [STUB, m, path.join(d, m), ...more] }));

/** @type {http.Server} */
let server;
let URL_BASE = '';
/** Where /toform redirects to: set by the row that uses it. */
let redirectTo = '/ok';
/** @type {Record<string, unknown>[]} */
const seen = [];
before(async () => {
  server = http.createServer((req, res) => {
    seen.push({ method: req.method, url: req.url, ...req.headers });
    /** @type {Record<string, number>} */
    const codes = { '/ok': 200, '/login': 401, '/bare401': 401, '/missing': 404, '/boom': 500, '/sse': req.method === 'GET' ? 200 : 405, '/redir303': 303, '/redir308': 308, '/far': 301, '/slow': 200, '/noloc': 302, '/toftp': 302, '/touser': 302, '/toform': 302 };
    const code = codes[String(req.url).split('?')[0]] || 404;
    if (req.url === '/login') res.setHeader('WWW-Authenticate', 'Bearer resource_metadata="x"');
    if (req.url === '/redir303' || req.url === '/redir308') res.setHeader('Location', '/ok');
    if (String(req.url).startsWith('/far')) res.setHeader('Location', '/far?' + seen.length);
    if (req.url === '/toftp') res.setHeader('Location', 'ftp://127.0.0.1/x');
    if (req.url === '/toform') res.setHeader('Location', redirectTo);
    if (req.url === '/touser') res.setHeader('Location', URL_BASE.replace('//', '//SYNTHUSER:synthetic-pass@') + '/ok');
    req.resume();
    if (req.url === '/slow') return; // never answers: the per-operation timeout ends it
    res.writeHead(code);
    res.end('BODY-CANARY');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(undefined)));
  URL_BASE = 'http://127.0.0.1:' + /** @type {import('node:net').AddressInfo} */ (server.address()).port;
});
after(() => {
  server.closeAllConnections();
  server.close();
});

group('the behaviour table', { skip: POSIX_ONLY }, () => {
  test('the process group is killed, whether the leader answered or exited first', async () => {
    const d = fs.mkdtempSync(path.join(BASE, 'group-'));
    const ctx = ctxOf(d);
    for (const [m, want] of [['fork-ok', 'ok'], ['fork-exit', 'fail: exited 3']]) {
      const e = stubEntry(d, m);
      const got = await C.probeStdio([NODE, ...M.get(e, 'args')], /** @type {Record<string, string>} */ (ctx.env), 10, ctx);
      assert.equal(got, want, m);
      assert.ok(await dead(path.join(d, m + '.child')), m + ': the child the server left was killed with its group');
      assert.ok(await dead(path.join(d, m)), m + ': the leader is gone');
    }
  });

  test('the timeout is honoured: a server that never answers fails at the timeout and is killed', async () => {
    const d = fs.mkdtempSync(path.join(BASE, 'hang-'));
    const ctx = ctxOf(d);
    const t0 = Date.now();
    assert.equal(await C.probeStdio([NODE, STUB, 'hang', path.join(d, 'hang')], /** @type {Record<string, string>} */ (ctx.env), 1, ctx), 'fail: timeout');
    const ms = Date.now() - t0;
    assert.ok(ms >= 900 && ms < 4000, 'took ' + ms + ' ms for a 1 s timeout');
    assert.ok(await dead(path.join(d, 'hang')));
    assert.equal(C.DEFAULT_TIMEOUT, 30);
  });

  test('the exit, end-of-output and start results', async () => {
    const d = fs.mkdtempSync(path.join(BASE, 'exit-'));
    const ctx = ctxOf(d);
    const env = /** @type {Record<string, string>} */ (ctx.env);
    assert.equal(await C.probeStdio([NODE, STUB, 'exit', path.join(d, 'exit')], env, 5, ctx), 'fail: exited 3');
    assert.equal(await C.probeStdio([NODE, STUB, 'sigterm', path.join(d, 'sigterm')], env, 5, ctx), 'fail: exited -15');
    assert.equal(await C.probeStdio([NODE, STUB, 'eof-exit', path.join(d, 'eof-exit')], env, 5, ctx), 'fail: exited 7');
    const t0 = Date.now();
    assert.equal(await C.probeStdio([NODE, STUB, 'eof', path.join(d, 'eof')], env, 1, ctx), 'fail: exited -1', 'a closed stdout and a leader still running');
    assert.ok(Date.now() - t0 < 4000);
    assert.equal(await C.probeStdio([path.join(d, 'no-such-synthetic-binary')], env, 5, ctx), 'fail: could not start');
    assert.equal(await C.probeStdio([NODE, STUB, 'error', path.join(d, 'error')], env, 5, ctx), 'fail: error response');
    assert.equal(await C.probeStdio([NODE, STUB, 'float-id', path.join(d, 'float-id')], env, 5, ctx), 'ok', 'id 1.0 is the initialize id');
    const missingHome = { ...ctx, env: { ...ctx.env, HOME: path.join(d, 'no-such-home') } };
    assert.equal(await C.probeStdio([NODE, STUB, 'ok', path.join(d, 'ok')], env, 5, missingHome), 'fail: could not start', 'it starts in HOME, and a missing HOME cannot start it');
  });

  test('${VAR} expansion: Claude Code and Kiro expand command, args and env; Codex does not', async () => {
    const d = fs.mkdtempSync(path.join(BASE, 'expand-'));
    const ctx = ctxOf(d, { SYNTH_X: 'expanded-value' });
    const entry = new Map(Object.entries({ command: NODE, args: [STUB, 'argcheck', path.join(d, 'argcheck'), '${SYNTH_X}'], env: new Map([['SYNTH_E', '${SYNTH_X}']]) }));
    for (const [surface, want] of [['claude-code', 'ok'], ['kiro', 'ok'], ['codex', 'fail: exited 5']]) assert.equal(await C.probe(surface, entry, 10, ctx), want, surface);
    assert.equal(C.expand('${SYNTH_UNSET_X:-value}', {}), 'value');
    assert.equal(C.expand('${SYNTH_SET_X:-value}', { SYNTH_SET_X: 'mine' }), 'mine');
    assert.equal(C.expand('${SYNTH_EMPTY:-value}', { SYNTH_EMPTY: '' }), 'value', 'an empty value takes the default, as the original read it');
    assert.equal(C.expand('${SYNTH_UNSET_X}|$SYNTH_X|${1BAD}', { SYNTH_X: 'x' }), '|$SYNTH_X|${1BAD}');
    // A later env value sees an earlier one; a value that is not a string is its Python str().
    const later = C.stdioCommand('kiro', new Map(Object.entries({ command: 'c', args: [1, true, null], env: new Map(Object.entries({ A: 'a', B: '${A}b', N: 2.5 })) })), {});
    assert.deepEqual(later?.[0], ['c', '1', 'True', 'None']);
    assert.equal(later?.[1].B, 'ab');
    assert.equal(C.stdioCommand('codex', new Map(Object.entries({ command: 'c', env: new Map([['B', '${A}']]) })), { A: 'a' })?.[1].B, '${A}');
    assert.equal(C.stdioCommand('kiro', new Map(Object.entries({ command: '' })), {}), null);
    assert.equal(C.stdioCommand('kiro', new Map(Object.entries({ command: 'c', args: 'x' })), {}), null);
  });

  test('no configured header is sent (a header can carry a credential); the probe names itself', async () => {
    const canary = synth();
    const ctx = ctxOf(BASE);
    const before = seen.length;
    assert.equal(await C.probe('claude-code', new Map(Object.entries({ type: 'http', url: URL_BASE + '/ok', headers: new Map([['X-Synth-Auth', canary]]) })), 5, ctx), 'ok');
    const sent = seen.slice(before);
    assert.equal(sent.length, 1);
    assert.ok(!JSON.stringify(sent).includes(canary), 'a configured header was sent');
    assert.ok(String(sent[0]['user-agent']).startsWith('mhw-mcp-connect/1 '));
    assert.equal(sent[0]['accept-encoding'], 'identity');
    assert.equal(sent[0].connection, 'close');
  });

  test('http results map to ok, needs login and fail; redirects follow urllib', async () => {
    /** @type {Array<[string, string, string]>} */
    const rows = [['/ok', 'http', 'ok'], ['/login', 'http', 'needs login'], ['/bare401', 'http', 'fail: http 401'], ['/missing', 'http', 'fail: http 404'], ['/boom', 'http', 'fail: http 500'],
      ['/sse', 'sse', 'ok'], ['/sse', 'http', 'fail: http 405'], ['/redir303', 'http', 'ok'], ['/redir308', 'http', 'fail: http 308'], ['/redir308', 'sse', 'ok'],
      ['/far', 'sse', 'fail: http 301'], ['/noloc', 'http', 'fail: http 302'], ['/toftp', 'sse', 'fail: http 302']];
    for (const [p, kind, want] of rows) assert.equal(await C.probeHttp(URL_BASE + p, kind, 5), want, kind + ' ' + p);
    const t0 = Date.now();
    assert.equal(await C.probeHttp(URL_BASE + '/slow', 'http', 1), 'fail: unreachable', 'a server that never answers times out');
    assert.ok(Date.now() - t0 < 4000);
    assert.equal(await C.probeHttp('http://127.0.0.1:9/mcp', 'http', 3), 'fail: unreachable');
    assert.equal(await C.probeHttp('no-scheme-here', 'http', 3), 'fail: unreachable');
    assert.equal(await C.probeHttp('file:///etc/hosts', 'http', 3), 'fail: unreachable', 'only http and https are opened');
  });

  test('a URL with userinfo is never sent, first or after a redirect: no Authorization header (lens F1, PR #530)', async () => {
    const before = seen.length;
    const withUser = URL_BASE.replace('//', '//SYNTHUSER:synthetic-pass@') + '/ok';
    for (const u of [withUser, URL_BASE.replace('//', '//SYNTHUSER@') + '/ok', URL_BASE.replace('//', '//@') + '/ok']) {
      for (const kind of ['http', 'sse']) assert.equal(await C.probeHttp(u, kind, 5), 'fail: unreachable', kind + ' ' + u.replace(/\/\/[^@]*@/, '//<userinfo>@'));
    }
    assert.equal(seen.length, before, 'a URL with userinfo reached the server');
    for (const kind of ['http', 'sse']) assert.equal(await C.probeHttp(URL_BASE + '/touser', kind, 5), 'fail: unreachable', kind + ' redirect');
    const sent = seen.slice(before);
    assert.deepEqual(sent.map((r) => r.url), ['/touser', '/touser'], 'the redirect target with userinfo was requested');
    assert.ok(sent.every((r) => !('authorization' in r)), 'an Authorization header was sent');
    // Through the CLI on Claude Code: a ${VAR} expanded into userinfo stays on this machine.
    const h = mkHome('home-connect-userinfo');
    writeSource(h, { version: 1, active_set: {}, servers: { 'h-u': { command: '/bin/echo' } } });
    assert.equal(spawnSync(NODE, [RENDER], { env: cleanEnv(h), cwd: BASE }).status, 0);
    const cc = jload(targets(h)['claude-code']);
    cc.mcpServers['h-u'] = { type: 'http', url: URL_BASE.replace('//', '//${SYNTH_SECRET_VAR}@') + '/ok' };
    putJson(targets(h)['claude-code'], cc);
    const n = seen.length;
    const p = await runAsync(['--active', '--mode=connect', '--timeout=3'], cleanEnv(h, { SYNTH_SECRET_VAR: 'synthetic-value-' + synth() }));
    assert.ok(p.stdout.includes('FAIL    claude-code: h-u: fail: unreachable (MCP connect)'), p.stdout);
    assert.ok(seen.slice(n).every((r) => !('authorization' in r)), 'the expanded value left in a header');
    assert.equal(C.hasUserinfo('https://a@b/c@d'), true);
    assert.equal(C.hasUserinfo('https://b/c@d?e@f#g@h'), false);
    assert.equal(C.hasUserinfo('//u@h/x'), true);
    assert.equal(C.hasUserinfo('/path@x'), false);
    assert.equal(C.hasUserinfo('mailto:a@b'), false);
    assert.equal(C.hasUserinfo('x y://u@h'), false, 'not a scheme: not an authority');
    assert.equal(C.hasUserinfo('mailto://u@h'), true);
    assert.equal(C.hasUserinfo('http:\\\\h\\x@y'), false, 'a backslash ends a special authority');
  });

  test('userinfo without //: http:U:P@h, http:/U:P@h and http:\\\\U:P@h, first or in a redirect (QA B1, PR #530)', async () => {
    const hostPort = URL_BASE.slice('http://'.length);
    const forms = ['http:U:P@' + hostPort, 'http:/U:P@' + hostPort, 'http:\\\\U:P@' + hostPort];
    for (const f of forms) assert.equal(C.hasUserinfo(f + '/ok'), true, f);
    const before = seen.length;
    for (const f of forms) {
      for (const kind of ['http', 'sse']) {
        assert.equal(await C.probeHttp(f + '/ok', kind, 5), 'fail: unreachable', kind + ' first ' + f.replace('U:P', '<u>'));
        redirectTo = f + '/ok';
        assert.equal(await C.probeHttp(URL_BASE + '/toform', kind, 5), 'fail: unreachable', kind + ' redirect ' + f.replace('U:P', '<u>'));
      }
    }
    const sent = seen.slice(before);
    assert.ok(sent.every((r) => r.url === '/toform'), 'a URL with userinfo was requested: ' + JSON.stringify(sent.map((r) => r.url)));
    assert.ok(sent.every((r) => !('authorization' in r)), 'an Authorization header reached the stub');
     // The second layer, on the parsed URL, each half alone.
    assert.equal(C.credentialFree(new URL('http://h/x')), true);
    assert.equal(C.credentialFree(new URL('http://U@h/x')), false, 'a username alone');
    assert.equal(C.credentialFree(new URL('http://:P@h/x')), false, 'a password alone');
    assert.equal(C.credentialFree(new URL('http:\\\\U:P@h/x')), false, 'the spelling with no //');
  });

  test('Codex URLs are never ${VAR}-expanded; Claude Code and Kiro URLs are (QA B2, PR #530)', async () => {
    const ctx = ctxOf(BASE, { SYNTH_PATH: 'ok' });
    const entry = new Map(Object.entries({ type: 'http', url: URL_BASE + '/${SYNTH_PATH}' }));
    for (const [surface, want] of [['codex', 'fail: http 404'], ['claude-code', 'ok'], ['kiro', 'ok']]) assert.equal(await C.probe(surface, entry, 5, ctx), want, surface);
  });

  test('the proxy environment is not used, on the engine this runs on (declared difference 6)', async () => {
    /** @type {string[]} */
    const proxied = [];
    const proxy = http.createServer((req, res) => {
      proxied.push(String(req.url));
      res.writeHead(502);
      res.end();
    });
    await new Promise((resolve) => proxy.listen(0, '127.0.0.1', () => resolve(undefined)));
    const proxyUrl = 'http://127.0.0.1:' + /** @type {import('node:net').AddressInfo} */ (proxy.address()).port;
    /** @type {Record<string, string>} */
    const env = { ...cleanEnv(BASE), HTTP_PROXY: proxyUrl, http_proxy: proxyUrl, HTTPS_PROXY: proxyUrl, NODE_USE_ENV_PROXY: '1' };
    delete env.NO_PROXY;
    delete env.no_proxy;
    try {
      // The control: on this node, does a default http request honour the proxy environment?
      const control = await nodeAsync(['-e', 'require("http").get(process.argv[1], (r) => { r.resume(); }).on("error", () => {})', URL_BASE + '/ok'], env);
      assert.equal(control.code, 0, control.stderr);
      const honoured = proxied.length > 0;
      assert.ok(honoured, 'the control request did not use the proxy, so the probe row would prove nothing on this node');
      // The probe, in a child with the same environment.
      const script = 'import(' + JSON.stringify(new URL('../../src/commands/mcp-connect.js', import.meta.url).href) + ').then(async (C) => { process.stdout.write(await C.probeHttp(process.argv[1], "http", 5)); })';
      const before = seen.length;
      const n = proxied.length;
      const probe = await nodeAsync(['--input-type=module', '-e', script, URL_BASE + '/ok'], env);
      assert.equal(probe.stdout, 'ok', probe.stderr);
      assert.equal(proxied.length, n, 'the probe went through the proxy');
      assert.equal(seen.length, before + 1, 'the probe went straight to the server');
      process.stdout.write('# node ' + process.version + ': a default request ' + (honoured ? 'honours' : 'ignores') + ' NODE_USE_ENV_PROXY; the probe ignores it\n');
    } finally {
      proxy.close();
    }
  });

  test('the verdict of one line: the initialize id only, CPython JSON', () => {
    /** @type {Array<[string, string | null]>} */
    const rows = [['{"id": 1, "result": {}}', 'ok'], ['{"id": 1, "error": {}}', 'fail: error response'], ['{"id": 2, "result": {}}', null], ['{"id": true, "result": {}}', 'ok'],
      ['{"id": 1.0, "result": NaN}', 'ok'], ['{"id": "1", "result": {}}', null], ['[1]', null], ['not json', null], ['{"id": 1}', 'fail: error response']];
    for (const [line, want] of rows) assert.equal(C.verdict(Buffer.from(line)), want, line);
    assert.equal(C.verdict(Buffer.from([0x7b, 0xff, 0x7d])), null, 'not UTF-8');
    assert.equal(C.INITIALIZE_TEXT, JSON.stringify(C.INITIALIZE).replaceAll('":', '": ').replaceAll(',"', ', "'), 'json.dumps of the initialize request');
  });

  test('configured(): enabled only per agent harness; unreadable is null', () => {
    const h = mkHome('home-configured');
    const ctx = ctxOf(h);
    put(targets(h).codex, '[mcp_servers.on-a]\ncommand = "/bin/echo"\n\n[mcp_servers.off-b]\nenabled = false\ncommand = "/bin/echo"\n');
    assert.deepEqual([...(C.configured('codex', ctx)?.keys() ?? [])], ['on-a']);
    putJson(targets(h).kiro, { mcpServers: { a: {}, b: { disabled: true }, c: 3 } });
    assert.deepEqual([...(C.configured('kiro', ctx)?.keys() ?? [])], ['a']);
    putJson(targets(h)['claude-code'], { mcpServers: { a: { disabled: true } } });
    assert.deepEqual([...(C.configured('claude-code', ctx)?.keys() ?? [])], ['a'], 'Claude Code has no per-server switch in this file');
    put(targets(h).codex, '﻿x = 1\n');
    assert.equal(C.configured('codex', ctx), null, 'a byte-order mark is not TOML');
    put(targets(h).codex, 'mcp_servers = 3\n');
    assert.equal(C.configured('codex', ctx), null);
    put(targets(h).kiro, '{');
    assert.equal(C.configured('kiro', ctx), null);
    fs.rmSync(targets(h).kiro);
    assert.deepEqual(C.configured('kiro', ctx), new Map());
  });
});

group('the connection check, through the CLI', { skip: POSIX_ONLY }, () => {
  test('stdio members are started as each harness has them, nothing is printed but names, every server is killed', async () => {
    const canary = synth();
    const h = mkHome('home-connect');
    const pids = path.join(h, 'pids');
    fs.mkdirSync(pids);
    const server = (/** @type {string} */ m, more = {}) => ({ command: NODE, args: [STUB, m, path.join(pids, m)], ...more });
    writeSource(h, { version: 1, active_set: {}, servers: { 's-ok': server('ok'), 's-err': server('error'), 's-hang': server('hang'), 's-secret': server('needenv', { secrets: { SYNTH_TOKEN: 'env:SYNTH_SRC' } }), 's-web': { command: '/bin/echo' } } });
    assert.equal(spawnSync(NODE, [RENDER], { env: cleanEnv(h), cwd: BASE }).status, 0, 'the renderer writes every surface');
    const started = path.join(h, 'not-a-member-started');
    const cc = jload(targets(h)['claude-code']);
    cc.mcpServers['s-web'] = { type: 'http', url: URL_BASE + '/login' };
    cc.mcpServers['chrome-devtools'] = { command: '/usr/bin/touch', args: [started] };
    cc.mcpServers['claude-in-chrome'] = { command: '/usr/bin/touch', args: [started] };
    delete cc.mcpServers['s-hang'];
    putJson(targets(h)['claude-code'], cc);
    const kiro = jload(targets(h).kiro);
    kiro.mcpServers['s-hang'].disabled = true;
    putJson(targets(h).kiro, kiro);
    const p = await runAsync(['--active', '--mode=connect', '--timeout=2'], cleanEnv(h, { SYNTH_SRC: 'synthetic-token-' + canary, SYNTH_CANARY: canary }));
    const out = p.stdout + p.stderr;
    assert.equal(p.code, 1, out);
    for (const surface of ['codex', 'claude-code', 'kiro']) {
      assert.ok(p.stdout.includes('OK      ' + surface + ': s-ok: ok (MCP connect)'), surface);
      assert.ok(p.stdout.includes('FAIL    ' + surface + ': s-err: fail: error response (MCP connect)'), surface);
      assert.ok(p.stdout.includes('OK      ' + surface + ': s-secret: ok (MCP connect)'), surface + ': the secret reaches the server through the launcher');
    }
    assert.ok(p.stdout.includes('FAIL    codex: s-hang: fail: timeout (MCP connect)'));
    assert.ok(!p.stdout.includes('kiro: s-hang'), 'a member turned off on an agent harness is not checked there');
    assert.ok(p.stdout.includes('OK      claude-code: s-web: needs login (MCP connect)'));
    assert.ok(!out.includes(canary), 'neither stderr nor a value is printed');
    assert.ok(!out.includes('127.0.0.1') && !out.includes(STUB), 'no URL and no command is printed');
    assert.ok(!fs.existsSync(started), 'the policy server and an exempt server are not started');
    for (const m of ['ok', 'error', 'hang', 'needenv']) assert.ok(await dead(path.join(pids, m)), m + ' was killed');
    assert.ok(p.ms < 20000, 'the run took ' + p.ms + ' ms');
  });

  test('all ok exits 0 at the default timeout; an undeclared set checks nothing', async () => {
    const h = mkHome('home-connect-ok');
    writeSource(h, { version: 1, active_set: {}, servers: { 's-ok': { command: NODE, args: [STUB, 'ok', path.join(h, 'pid')] } } });
    assert.equal(spawnSync(NODE, [RENDER], { env: cleanEnv(h), cwd: BASE }).status, 0);
    let p = await runAsync(['--active', '--mode=connect'], cleanEnv(h));
    assert.equal(p.code, 0, p.stdout + p.stderr);
    // Codex, Claude Code and Kiro, and the Claude desktop app where it is published (macOS here).
    assert.equal(p.stdout.split(': s-ok: ok (MCP connect)').length - 1, process.platform === 'darwin' ? 4 : 3);
    writeSource(h, { version: 1, servers: { 's-ok': { command: '/bin/echo' } } });
    p = await runAsync(['--active', '--mode=connect'], cleanEnv(h));
    assert.equal(p.code, 0);
    assert.match(p.stdout, /SKIP {4}MCP connect: no active set is declared/);
  });

  test('connect starts a policy server in the set where each harness has it', async () => {
    const h = mkHome('home-ext-connect');
    const ok = { command: NODE, args: [STUB, 'ok', path.join(h, 'pid')] };
    writeSource(h, { version: 1, active_set: {}, servers: { 'chrome-devtools': { ...ok, surfaces: ['codex', 'kiro'] } } });
    assert.equal(spawnSync(NODE, [RENDER], { env: cleanEnv(h), cwd: BASE }).status, 0);
    putJson(targets(h)['claude-code'], { mcpServers: { 'chrome-devtools': { ...ok, type: 'stdio' } } });
    const p = await runAsync(['--active', '--mode=connect', '--timeout=5'], cleanEnv(h));
    assert.equal(p.code, 0, p.stdout + p.stderr);
    for (const surface of ['codex', 'kiro', 'claude-code']) assert.ok(p.stdout.includes('OK      ' + surface + ': chrome-devtools: ok (MCP connect)'), surface);
  });
});

test('Windows: the connection check is not available, and says so', async () => {
  const lines = /** @type {string[]} */ ([]);
  const ctx = { env: {}, platform: 'win32', cwd: BASE, out: (/** @type {string} */ s) => { lines.push(s); }, err: () => {} };
  const aset = new ActiveSet(M.activeFacts(null, ctx));
  assert.equal(await C.connect(aset, 30, ctx), 0);
  assert.deepEqual(lines, ['SKIP    MCP connect: not available on Windows (MCP connect)\n']);
});
