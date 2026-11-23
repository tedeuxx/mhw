// S09 parity (#480, convention 3 of #470): `mhw chrome-debugging` against the deleted
// global/chrome_debugging.py, on the cases of its own suite (chrome_debugging_test.py) plus the JSON
// round-trip, path and argument forms it depends on. Every case runs on a throwaway HOME with a synthetic
// Local State; the real Chrome profile is never read or written.
//   golden: each case is run by the Node command in process (system pinned, "is Chrome running" answered
//           by the case) on every OS, and through bin/mhw.js with a pgrep stub on PATH (POSIX, the
//           running system). Each run is compared with the transcript recorded from the Python original:
//           stdout, stderr, exit code, and every file under HOME after the run (its bytes and its mode).
//   The live arm and its probe (test/helpers/chrome-debugging-probe.py) were deleted by #502 (S32 of
//           #470, one Node runtime): the original left the tree with #480, so the transcripts are frozen.
// Windows: a case that writes the file is skipped (the original's directory fsync fails there, as Node's
// does, and the step never reaches a write on Windows anyway), and modes are not compared.
// Normalised before comparing: the HOME (<HOME>) and the Chrome profile directory (<PROFILE>). The
// intended differences are in test/golden/S09/expected-differences.json, with their reasons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import * as cd from '../../src/render/chrome-debugging.js';
import { loads, dumps } from '../../src/lib/py.js';
import { readGolden, UPDATE } from '../helpers/golden.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S09';
const POSIX = process.platform !== 'win32';
const SECRET = 'fixture-private-value-7f3a';
const PROFILE_PARTS = { Darwin: ['Library', 'Application Support', 'Google', 'Chrome'], Linux: ['.config', 'google-chrome'] };
/** @type {Array<{ case: string[], stream: 'stdout' | 'stderr', base: string, head: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** A fresh, resolved directory under the OS temporary directory. */
function freshDir() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s09-')));
  cleanups.push(() => {
    try {
      fs.chmodSync(dir, 0o700);
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // the OS temp dir's to clean
    }
  });
  return dir;
}

const DOC = '{"profile":{"info_cache":{"Default":{"name":"' + SECRET + '"}}},"browser":{"enabled_labs_experiments":[]},'
  + '"devtools":{"other":1},"zeta":"ünïcode"}';
const ATTACH = JSON.stringify({ mcpServers: { 'chrome-devtools': { command: '/bin/sh', args: ['-c', 'exec npx chrome-devtools-mcp@1.8.0 --autoConnect'] } } });
/** @param {unknown} args */
const server = (args) => JSON.stringify({ mcpServers: { 'chrome-devtools': { command: '/bin/sh', args } } });
const ON = '{"devtools":{"remote_debugging":{"user-enabled":true}}}';
const ALL = ['--mode=dry-run', '--mode=check', '--mode=install', '--mode=check', '--mode=install', '--mode=uninstall'];

/**
 * @typedef {{ name: string, ls?: string | Buffer, lsMode?: number, claude?: string | null, port?: boolean,
 *   running?: boolean, system?: string, suffix?: string, writes?: boolean, cli?: boolean,
 *   runs: Array<string[] | string>, setup?: (profile: string, home: string) => void }} Case
 */

/** @type {Case[]} */
const CASES = [
  { name: 'sets-the-key-and-keeps-every-other-field', ls: DOC, writes: true, cli: true, runs: [...ALL, 'status'] },
  { name: 'false-becomes-true', ls: '{"devtools":{"remote_debugging":{"user-enabled":false}}}', writes: true, cli: true,
    runs: ['status', '--mode=check', '--mode=install', 'status'] },
  { name: 'noop-when-already-on', ls: '{"devtools":{"remote_debugging":{"user-enabled":true}},"x":1}', running: true, cli: true,
    runs: [...ALL, 'status'] },
  { name: 'chrome-running-skips-and-writes-nothing', ls: DOC, running: true, cli: true, runs: ['--mode=install', '--mode=check'] },
  { name: 'unreadable-is-refused-and-untouched', ls: '{not json ' + SECRET, cli: true, runs: [...ALL, 'status'] },
  { name: 'non-boolean-key-is-refused', ls: '{"devtools":{"remote_debugging":{"user-enabled":"yes"}}}', runs: ['--mode=install', '--mode=check', 'status'] },
  { name: 'null-key-is-refused', ls: '{"devtools":{"remote_debugging":{"user-enabled":null}}}', runs: ['--mode=install', 'status'] },
  { name: 'integer-key-is-refused', ls: '{"devtools":{"remote_debugging":{"user-enabled":1}}}', runs: ['--mode=install', 'status'] },
  { name: 'no-local-state-is-a-skip', cli: true, runs: [...ALL, 'status'] },
  { name: 'local-state-a-directory-is-a-skip', runs: ['--mode=install', 'status'],
    setup: (profile) => fs.mkdirSync(path.join(profile, 'Local State')) },
  { name: 'devtools-active-port-present', ls: ON, port: true, runs: ['status'] },
  { name: 'devtools-active-port-present-key-off', ls: '{}', port: true, runs: ['status'] },
  { name: 'empty-object-gains-the-key', ls: '{}', writes: true, runs: ['--mode=install', 'status'] },
  { name: 'remote-debugging-object-keeps-its-keys', ls: '{"devtools":{"remote_debugging":{"a":1,"user-enabled":false,"z":[1,2]},"b":2}}',
    writes: true, runs: ['--mode=install'] },
  { name: 'top-level-array-drifts-and-refuses', ls: '[1,2]', writes: true, runs: ['status', '--mode=check', '--mode=dry-run', '--mode=install', '--mode=uninstall'] },
  { name: 'intermediate-not-an-object-refuses', ls: '{"devtools":5}', writes: true, runs: ['status', '--mode=check', '--mode=install'] },
  { name: 'intermediate-remote-debugging-a-list-refuses', ls: '{"devtools":{"remote_debugging":[]}}', writes: true, runs: ['--mode=install'] },
  { name: 'top-level-string-refuses', ls: '"x"', writes: true, runs: ['--mode=install'] },
  // The CPython round-trip, byte for byte.
  { name: 'numbers-round-trip-as-cpython', writes: true, runs: ['--mode=install'],
    ls: '{"f":[1.0,1e5,1E-7,0.0001,0.00001,1e16,1e15,-0.0,123.456e-10,1.5e300,2.5,0.1,1e400,-1e400,1e-400],'
      + '"i":[0,-0,12345678901234567890123,-42,9007199254740993],"s":[NaN,Infinity,-Infinity],"t":[true,false,null]}' },
  { name: 'integer-like-keys-keep-their-order', writes: true, runs: ['--mode=install'],
    ls: '{"b":1,"10":2,"1":3,"__proto__":{"0":0},"constructor":4,"":5}' },
  { name: 'strings-round-trip-as-cpython', writes: true, runs: ['--mode=install'],
    ls: '{"esc":"\\u00e9\\/\\"\\\\\\b\\f\\n\\r\\t\\u0001\\u001f\\u007f\\u2028\\ud83d\\ude00","raw":"é中\u{1F600}","k\\u00e9y":"v"}' },
  { name: 'duplicate-keys-last-value-first-place', writes: true, runs: ['--mode=install'],
    ls: '{"a":1,"b":2,"a":3,"devtools":{"x":1},"devtools":{"y":2}}' },
  { name: 'whitespace-and-trailing-newline', writes: true, runs: ['--mode=install'],
    ls: ' \t\r\n{ "a" : [ 1 , { } , [ ] ] ,\n "devtools" : { } }\n\n' },
  { name: 'lone-surrogate-refuses-leaving-no-temporary', writes: true, runs: ['status', '--mode=install'],
    ls: '{"a":"\\ud83d"}' },
  { name: 'lone-surrogate-in-a-key-refuses', writes: true, runs: ['--mode=install'], ls: '{"\\udc00":1}' },
  { name: 'bom-is-unreadable', ls: '﻿' + ON, runs: ['--mode=install', 'status'] },
  { name: 'invalid-utf8-is-unreadable', ls: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]), runs: ['--mode=install', 'status'] },
  { name: 'encoded-surrogate-is-unreadable', ls: Buffer.from([0x7b, 0x22, 0x61, 0x22, 0x3a, 0x22, 0xed, 0xa0, 0x80, 0x22, 0x7d]), runs: ['--mode=install'] },
  { name: 'empty-file-is-unreadable', ls: '', runs: ['--mode=install', 'status'] },
  { name: 'trailing-comma-is-unreadable', ls: '{"a":1,}', runs: ['--mode=install'] },
  { name: 'extra-data-is-unreadable', ls: '{} {}', runs: ['--mode=install'] },
  { name: 'raw-control-character-is-unreadable', ls: '{"a":"\u0001"}', runs: ['--mode=install'] },
  { name: 'mode-0600-is-kept', ls: DOC, lsMode: 0o600, writes: true, runs: ['--mode=install'] },
  { name: 'mode-0640-is-kept', ls: DOC, lsMode: 0o640, writes: true, runs: ['--mode=install'] },
  // The attach gate.
  { name: 'gate-no-server-entry', ls: DOC, claude: '{"mcpServers":{}}', runs: ['--mode=install', '--mode=dry-run', '--mode=check', '--mode=uninstall'] },
  { name: 'gate-isolated-copy', ls: DOC, claude: server(['-c', 'exec npx chrome-devtools-mcp@1.8.0 --isolated']), cli: true,
    runs: ['--mode=install', '--mode=dry-run', '--mode=check'] },
  { name: 'gate-no-claude-json', ls: DOC, claude: null, cli: true, runs: ['--mode=install', '--mode=check'] },
  { name: 'gate-on-key-reported-whatever-the-server', ls: ON, claude: null, runs: ['--mode=check', '--mode=install'] },
  { name: 'gate-older-bounded-copy-attaches', ls: DOC, writes: true, runs: ['--mode=install'],
    claude: server(['-c', 'exec npx chrome-devtools-mcp@1.8.0 --autoConnect --allowedUrlPattern "$o"']) },
  { name: 'gate-tracked-policy-server-attaches', ls: DOC, writes: true, runs: ['--mode=install'],
    claude: (() => {
      const p = JSON.parse(fs.readFileSync(path.join(ROOT, 'global', 'mcp', 'policy-servers.json'), 'utf8')).servers['chrome-devtools'];
      return JSON.stringify({ mcpServers: { 'chrome-devtools': { command: p.command, args: p.args } } });
    })() },
  { name: 'gate-word-must-be-whole', ls: DOC, claude: server(['--autoConnectX', 'x--autoConnect', '"--autoConnect"']), runs: ['--mode=check'] },
  { name: 'gate-python-whitespace-splits-words', ls: DOC, claude: server(['a\u001c--autoConnect']), runs: ['--mode=check'] },
  { name: 'gate-bom-is-not-python-whitespace', ls: DOC, claude: server(['a﻿--autoConnect']), runs: ['--mode=check'] },
  { name: 'gate-nbsp-splits-words', ls: DOC, claude: server(['a --autoConnect　b']), runs: ['--mode=check'] },
  { name: 'gate-args-a-dict-iterates-its-keys', ls: DOC, claude: server({ '--autoConnect': 1 }), runs: ['--mode=check'] },
  { name: 'gate-args-a-string-iterates-its-characters', ls: DOC, claude: server('--autoConnect'), runs: ['--mode=check'] },
  { name: 'gate-args-nested-list-is-a-repr', ls: DOC, claude: server([['--autoConnect']]), runs: ['--mode=check'] },
  // A list or dict item counts by its CPython repr, which keeps the spaces of a string inside it (QA B1 on
  // PR #514): attach when the repr carries the word between whitespace, not when the repr escapes it.
  ...(/** @type {Array<[string, unknown]>} */ ([
    ['gate-repr-list-item-attaches', [['x --autoConnect y']]],
    ['gate-repr-dict-key-attaches', [{ 'x --autoConnect y': 1 }]],
    ['gate-repr-dict-value-attaches', [{ k: 'x --autoConnect y' }]],
    ['gate-repr-double-quoted-attaches', [["it's --autoConnect now"]]],
    ['gate-repr-depth-two-attaches', [[['a --autoConnect b']]]],
    ['gate-repr-escaped-tab-does-not-attach', [['x\t--autoConnect\ty']]],
    ['gate-repr-word-then-quote-does-not-attach', [{ 'a --autoConnect': 1 }]],
    ['gate-repr-with-other-types-attaches', [[1, 2.5, true, null, 'p --autoConnect q']]],
  ])).map(([name, args]) => ({ name, ls: DOC, claude: server(args), runs: ['--mode=check'] })),
  { name: 'gate-args-absent', ls: DOC, claude: JSON.stringify({ mcpServers: { 'chrome-devtools': { command: '/bin/sh' } } }), runs: ['--mode=check'] },
  { name: 'gate-args-a-number-is-a-type-error', ls: DOC, claude: server(5), runs: ['--mode=check', '--mode=uninstall'] },
  { name: 'gate-args-null-is-a-type-error', ls: DOC, claude: server(null), runs: ['--mode=check'] },
  { name: 'gate-args-a-bool-is-a-type-error', ls: DOC, claude: server(true), runs: ['--mode=check'] },
  { name: 'gate-entry-not-an-object', ls: DOC, claude: '{"mcpServers":{"chrome-devtools":"x"}}', runs: ['--mode=check'] },
  { name: 'gate-servers-a-list', ls: DOC, claude: '{"mcpServers":[]}', runs: ['--mode=check'] },
  { name: 'gate-servers-null', ls: DOC, claude: '{"mcpServers":null}', runs: ['--mode=check'] },
  { name: 'gate-claude-json-a-list', ls: DOC, claude: '[]', runs: ['--mode=check'] },
  { name: 'gate-claude-json-unreadable', ls: DOC, claude: '{', runs: ['--mode=check'] },
  { name: 'gate-claude-json-with-bom', ls: DOC, claude: '﻿' + ATTACH, runs: ['--mode=check'] },
  { name: 'gate-claude-json-with-nan-still-reads', ls: DOC, claude: ATTACH.slice(0, -1) + ',"n":NaN}', runs: ['--mode=check'] },
  { name: 'gate-duplicate-servers-last-wins', ls: DOC, runs: ['--mode=check'],
    claude: '{"mcpServers":{"chrome-devtools":{"args":["--autoConnect"]},"chrome-devtools":{"args":[]}}}' },
  // Systems and paths.
  { name: 'windows-is-skipped', system: 'Windows', ls: DOC, runs: [...ALL, 'status'] },
  { name: 'unknown-system-is-skipped', system: 'FreeBSD', ls: DOC, runs: ['--mode=install', 'status'] },
  { name: 'linux-path', system: 'Linux', ls: DOC, writes: true, runs: ['--mode=check', '--mode=install', 'status'] },
  { name: 'home-with-a-dot-dot-is-printed-as-pathlib-does', suffix: '/x/..', ls: DOC, runs: ['--mode=check'],
    setup: (_p, home) => fs.mkdirSync(path.join(home, 'x'), { recursive: true }) },
  { name: 'home-with-a-dot-and-slashes-is-printed-as-pathlib-does', suffix: '/.//', ls: DOC, runs: ['--mode=check', 'status'] },
  // The command line.
  { name: 'usage-forms', ls: DOC,
    runs: [[], ['--mode=bogus'], ['--other'], ['--mode=check', '--home=/x'], ['--mode=check', '--mode=check'], ['--mode='],
      ['--mode=CHECK'], ['--mode=check', ''], ['-h'], ['check']] },
];

/**
 * @typedef {{ args: string[] | 'status', code: number, stdout: string, stderr: string,
 *   tree: Array<{ path: string, mode: string, data: string }> }} Run
 */

/** Every file under dir, its profile prefix normalised: bytes as text or base64, and mode. @param {string} dir */
function snapshot(dir) {
  /** @type {Run['tree']} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? rel + '/' + name : name;
      const st = fs.lstatSync(path.join(dir, r));
      if (st.isDirectory()) walk(r);
      else {
        const raw = fs.readFileSync(path.join(dir, r));
        let data;
        try {
          data = 'text:' + new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw);
        } catch {
          data = 'base64:' + raw.toString('base64');
        }
        let p = r;
        for (const parts of Object.values(PROFILE_PARTS)) {
          const pre = parts.join('/') + '/';
          if (p.startsWith(pre)) p = '<PROFILE>/' + p.slice(pre.length);
        }
        out.push({ path: p, mode: POSIX ? (st.mode & 0o777).toString(8) : '-', data });
      }
    }
  };
  walk('');
  return out;
}

/**
 * @param {string} s
 * @param {string} home the base directory (the canonical HOME)
 */
function norm(s, home) {
  let out = s.replace(/\r\n/g, '\n');
  for (const parts of Object.values(PROFILE_PARTS)) {
    out = out.split(path.join(home, ...parts) + path.sep).join('<PROFILE>/');
    out = out.split(home + '/' + parts.join('/') + '/').join('<PROFILE>/');
  }
  // A CPython traceback names the extracted base tree's files; the expected difference covers the rest.
  return out.split(home).join('<HOME>').replace(/^ {2}File "[^"\n]*"/gm, '  File "<SCRIPT>"');
}

/**
 * @typedef {{ name: string, system: (c: Case) => string, run: (c: Case, args: string[] | 'status', home: string, env: Record<string, string>) =>
 *   { code: number, stdout: string, stderr: string } }} Runner
 */

/** @type {Runner} */
const inProcess = { name: 'in-process', system: (c) => c.system || 'Darwin', run: (c, args, home, env) => {
  const out = /** @type {string[]} */ ([]);
  const err = /** @type {string[]} */ ([]);
  const system = c.system || 'Darwin';
  if (args === 'status') return { code: 0, stdout: cd.statusText(system, home) + '\n', stderr: '' };
  const code = cd.main(args, env, { system, running: () => c.running === true,
    out: (l) => out.push(l + '\n'), err: (l) => err.push(l + '\n') });
  return { code, stdout: out.join(''), stderr: err.join('') };
} };

/** A directory holding a pgrep that answers the case's running flag. @param {boolean} running */
function pgrepStub(running) {
  const d = freshDir();
  fs.writeFileSync(path.join(d, 'pgrep'), '#!/bin/sh\nexit ' + (running ? 0 : 1) + '\n', { mode: 0o700 });
  return d;
}

/** @param {string[]} cmd @param {Record<string, string>} env */
function spawn(cmd, env) {
  const p = spawnSync(cmd[0], cmd.slice(1), { env, encoding: 'utf8', timeout: 60000 });
  return { code: p.status ?? -1, stdout: p.stdout || '', stderr: p.stderr || '' };
}

/** @type {Runner} */
const binRunner = { name: 'bin/mhw.js', system: () => cd.systemName(), run: (c, args, _home, env) => {
  const stub = pgrepStub(c.running === true);
  const e = { ...env, PATH: stub + ':' + (process.env.PATH || '') };
  return spawn([process.execPath, path.join(ROOT, 'bin', 'mhw.js'), 'chrome-debugging', ...(args === 'status' ? ['--mode=status'] : args)], e);
} };

/** Why case c cannot run with runner r here, or ''. @param {Case} c @param {Runner} r */
function skipReason(c, r) {
  if (!POSIX && (c.writes || c.suffix)) return 'writes the file, or a POSIX home spelling: POSIX only';
  if (r === binRunner && (!POSIX || !c.cli || !PROFILE_PARTS[/** @type {'Darwin'} */ (cd.systemName())])) return 'not a CLI case here';
  return '';
}

/**
 * Build the case on a fresh HOME for runner r and run every step; the transcript.
 * @param {Case} c
 * @param {Runner} r
 * @returns {Run[]}
 */
function play(c, r) {
  const base = freshDir();
  const home = base + (c.suffix || '');
  const system = r.system(c);
  const parts = PROFILE_PARTS[/** @type {'Darwin'} */ (system)] || PROFILE_PARTS.Darwin;
  const profile = path.join(base, ...parts);
  fs.mkdirSync(profile, { recursive: true });
  if (c.setup) c.setup(profile, base);
  if (c.ls !== undefined) {
    fs.writeFileSync(path.join(profile, 'Local State'), c.ls);
    if (POSIX) fs.chmodSync(path.join(profile, 'Local State'), c.lsMode ?? 0o644);
  }
  if (c.port) fs.writeFileSync(path.join(profile, 'DevToolsActivePort'), '9222\n/devtools/browser/x\n');
  const claude = c.claude === undefined ? ATTACH : c.claude;
  if (claude !== null) fs.writeFileSync(path.join(base, '.claude.json'), claude);
  /** @type {Record<string, string>} */
  const env = { PATH: process.env.PATH || '', HOME: home, USERPROFILE: home, LANG: 'C.UTF-8', PYTHONDONTWRITEBYTECODE: '1', PYTHONUTF8: '1' };
  if (process.env.SystemRoot) env.SystemRoot = process.env.SystemRoot;
  return c.runs.map((step) => {
    // A bare string is one argument ('--mode=install'); 'status' is the status line.
    const args = typeof step === 'string' && step !== 'status' ? [step] : step;
    const res = r.run(c, args, home, env);
    return { args, code: res.code, stdout: norm(res.stdout, base), stderr: norm(res.stderr, base), tree: snapshot(base) };
  });
}

/**
 * Each run of head compared with original, after the expected differences rewrite both.
 * @param {string} name
 * @param {Run[]} original
 * @param {Run[]} head
 * @param {string} runner
 */
function differences(name, original, head, runner) {
  if (original.length !== head.length) return [name + ' (' + runner + '): run count ' + original.length + ' -> ' + head.length];
  /** @type {string[]} */
  const diffs = [];
  original.forEach((o, i) => {
    const h = head[i];
    const where = name + ' (' + runner + ') run ' + (i + 1) + ' ' + JSON.stringify(h.args);
    if (o.code !== h.code) diffs.push(where + ': exit ' + o.code + ' -> ' + h.code);
    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      let a = o[stream];
      let b = h[stream];
      for (const e of expected.filter((x) => (x.case.includes(name) || x.case.includes('*')) && x.stream === stream)) {
        a = a.replace(new RegExp(e.base, 'gs'), e.replace);
        b = b.replace(new RegExp(e.head, 'gs'), e.replace);
      }
      if (a !== b) diffs.push(where + ': ' + stream + ' differs\n--- original\n' + a + '\n--- head\n' + b);
    }
    const ta = JSON.stringify(o.tree.map((t) => (POSIX ? t : { ...t, mode: '-' })));
    const tb = JSON.stringify(h.tree);
    if (ta !== tb) diffs.push(where + ': written tree differs\n--- original\n' + ta + '\n--- head\n' + tb);
  });
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

test('every case has a golden transcript, every golden a case, and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const f of fs.readdirSync(path.join(ROOT, 'test', 'golden', SLICE, 'transcripts'))) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
  for (const e of expected) {
    for (const n of e.case) assert.ok(n === '*' || names.has(n), 'unknown case ' + n);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
  }
});

test('golden: the Node command, in process and through bin/mhw.js, matches the original\'s transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  /** @type {string[]} */
  const diffs = [];
  let compared = 0;
  for (const c of CASES) {
    const golden = readGolden(SLICE, goldenName(c.name)).runs;
    for (const r of [inProcess, binRunner]) {
      const why = skipReason(c, r);
      if (why) {
        if (r === inProcess) t.diagnostic(c.name + ' skipped: ' + why);
        continue;
      }
      diffs.push(...differences(c.name, golden, play(c, r), r.name));
      compared++;
    }
  }
  assert.deepEqual(diffs, []);
  assert.ok(compared >= (POSIX ? CASES.length : 1), 'cases compared: ' + compared);
});

test('no transcript carries the Local State contents', () => {
  for (const c of CASES) {
    for (const run of readGolden(SLICE, goldenName(c.name)).runs) {
      assert.ok(!run.stdout.includes(SECRET) && !run.stderr.includes(SECRET), c.name);
      assert.ok(!run.stdout.includes('info_cache'), c.name);
    }
  }
});

// The cases of chrome_debugging_test.py the transcripts cannot reach: injected failures and processes.

/** A fixture home with an attaching server and the DOC Local State, at the Darwin path. */
function fixture(text = DOC) {
  const home = freshDir();
  const ls = /** @type {string} */ (cd.localState('Darwin', home));
  fs.mkdirSync(path.dirname(ls), { recursive: true });
  fs.writeFileSync(ls, text);
  fs.writeFileSync(path.join(home, '.claude.json'), ATTACH);
  return { home, ls };
}

/** @param {string} home @param {typeof cd.IO} [io] */
function install(home, io) {
  const out = /** @type {string[]} */ ([]);
  const code = cd.run('install', { system: 'Darwin', home, running: () => false, io, out: (l) => out.push(l) });
  return { code, out: out.join('\n') };
}

test('a failed directory sync is not reported as nothing written', { skip: !POSIX && 'POSIX only' }, () => {
  const { home, ls } = fixture();
  let calls = 0;
  const io = { ...cd.IO, fsyncSync: (/** @type {number} */ fd) => {
    calls++;
    if (calls === 2) throw new Error('sync failed');
    fs.fsyncSync(fd);
  } };
  const r = install(home, io);
  assert.equal(r.code, 3);
  assert.match(r.out, /^CHANGED .*not synced/);
  assert.ok(!r.out.includes('nothing was written'));
  assert.equal(cd.readValue(ls), true);
});

test('a directory that cannot be opened for its sync is reported as not synced', { skip: !POSIX && 'POSIX only' }, () => {
  const { home } = fixture();
  let opens = 0;
  const io = { ...cd.IO, openSync: (/** @type {string} */ p, /** @type {number} */ f, /** @type {number | undefined} */ m) => {
    opens++;
    if (opens === 2) throw new Error('EACCES');
    return fs.openSync(p, f, m);
  } };
  const r = install(home, io);
  assert.equal(r.code, 3);
  assert.match(r.out, /^CHANGED /);
});

test('the directory is fsynced after the rename: two syncs, the file then its directory', { skip: !POSIX && 'POSIX only' }, () => {
  const { home, ls } = fixture();
  const seen = /** @type {string[]} */ ([]);
  const io = { ...cd.IO,
    fsyncSync: (/** @type {number} */ fd) => {
      seen.push(fs.fstatSync(fd).isDirectory() ? 'dir' : 'file');
      fs.fsyncSync(fd);
    },
    renameSync: (/** @type {string} */ a, /** @type {string} */ b) => {
      seen.push('rename');
      fs.renameSync(a, b);
    } };
  assert.equal(install(home, io).code, 0);
  assert.deepEqual(seen, ['file', 'rename', 'dir']);
  assert.equal(cd.readValue(ls), true);
});

for (const [what, patch] of /** @type {Array<[string, Partial<typeof cd.IO>]>} */ ([
  ['the write', { writeSync: () => { throw new Error('disk full'); } }],
  ['the file sync', { fsyncSync: () => { throw new Error('EIO'); } }],
  ['the chmod', { chmodSync: () => { throw new Error('EPERM'); } }],
  ['the rename', { renameSync: () => { throw new Error('EXDEV'); } }],
  ['the close', { closeSync: () => { throw new Error('EIO'); } }],
])) {
  test('a failure in ' + what + ' leaves the original and no temporary file', { skip: !POSIX && 'POSIX only' }, () => {
    const { home, ls } = fixture();
    const before = fs.readFileSync(ls);
    const r = install(home, { ...cd.IO, ...patch });
    assert.equal(r.code, 3);
    assert.match(r.out, /^REFUSE .*nothing was written/);
    assert.deepEqual(fs.readFileSync(ls), before);
    assert.deepEqual(fs.readdirSync(path.dirname(ls)), ['Local State']);
  });
}

test('a partial write is completed, not truncated', { skip: !POSIX && 'POSIX only' }, () => {
  const { home, ls } = fixture();
  const io = { ...cd.IO, writeSync: (/** @type {number} */ fd, /** @type {Buffer} */ b, /** @type {number} */ off, /** @type {number} */ len) =>
    fs.writeSync(fd, b, off, Math.min(len, 7)) };
  assert.equal(install(home, io).code, 0);
  assert.equal(cd.readValue(ls), true);
  const doc = /** @type {Map<string, unknown>} */ (loads(fs.readFileSync(ls, 'utf8'), { ordered: true }));
  assert.equal(/** @type {Map<string, unknown>} */ (doc.get('profile')) instanceof Map, true);
});

test('an unwritable directory refuses and leaves the file as it is', { skip: (!POSIX || process.getuid?.() === 0) && 'POSIX, not root' }, () => {
  const { home, ls } = fixture();
  const before = fs.readFileSync(ls);
  fs.chmodSync(path.dirname(ls), 0o500);
  try {
    const r = install(home);
    assert.equal(r.code, 3);
    assert.match(r.out, /^REFUSE /);
  } finally {
    fs.chmodSync(path.dirname(ls), 0o700);
  }
  assert.deepEqual(fs.readFileSync(ls), before);
});

test('install renames a new file over the old one', { skip: !POSIX && 'POSIX only' }, () => {
  const { home, ls } = fixture();
  const before = fs.statSync(ls).ino;
  assert.equal(install(home).code, 0);
  assert.notEqual(fs.statSync(ls).ino, before);
});

test('only pgrep\'s exit 1 means not running; an error, a signal or no pgrep count as running', { skip: !POSIX && 'POSIX only' }, () => {
  for (const [body, want] of /** @type {Array<[string | null, boolean]>} */ ([
    ['exit 0', true], ['exit 1', false], ['exit 2', true], ['kill -9 $$', true], [null, true]])) {
    const d = freshDir();
    if (body !== null) fs.writeFileSync(path.join(d, 'pgrep'), '#!/bin/sh\n' + body + '\n', { mode: 0o700 });
    assert.equal(cd.chromeRunning('Darwin', { PATH: d }), want, String(body));
  }
  assert.equal(cd.chromeRunning('Windows', { PATH: '' }), true, 'an unknown system counts as running');
});

test('pgrep is asked for the stable channel\'s exact process name', { skip: !POSIX && 'POSIX only' }, () => {
  for (const [system, name] of [['Darwin', 'Google Chrome'], ['Linux', 'chrome']]) {
    const d = freshDir();
    fs.writeFileSync(path.join(d, 'pgrep'), '#!/bin/sh\n[ "$1" = -x ] && [ "$2" = "' + name + '" ] && [ $# -eq 2 ] && exit 1\nexit 0\n', { mode: 0o700 });
    assert.equal(cd.chromeRunning(system, { PATH: d }), false, system);
  }
});

test('the default running check is pgrep, through the environment given', { skip: !POSIX && 'POSIX only' }, () => {
  const { home, ls } = fixture();
  const out = /** @type {string[]} */ ([]);
  const code = cd.run('install', { system: 'Darwin', home, env: { PATH: pgrepStub(true) }, out: (l) => out.push(l) });
  assert.equal(code, 0);
  assert.match(out[0], /Chrome is running/);
  assert.equal(cd.readValue(ls), null);
});

test('paths: Linux and Darwin, pathlib spelling, no path for another system', () => {
  assert.equal(cd.localState('Windows', '/h'), null);
  if (!POSIX) return;
  assert.equal(cd.localState('Linux', '/h'), '/h/.config/google-chrome/Local State');
  assert.equal(cd.localState('Darwin', '/h'), '/h/Library/Application Support/Google/Chrome/Local State');
  assert.equal(cd.pathlibJoin('//h/', ['a']), '//h/a');
  assert.equal(cd.pathlibJoin('///h', ['a']), '/h/a');
  assert.equal(cd.pathlibJoin('/h/./x/../', ['a']), '/h/x/../a');
  assert.equal(cd.pathlibJoin('', ['a', 'b']), 'a/b');
  assert.equal(cd.pathlibJoin('rel/', ['a']), 'rel/a');
});

test('HOME resolves as CPython\'s Path.home() does: trailing slashes stripped, empty is /', { skip: !POSIX && 'POSIX only' }, () => {
  // Measured on CPython 3.14.6 (QA B2 on PR #514):
  //   python3 -c 'from pathlib import Path; print(Path(Path.home()).joinpath("Library","Local State"))'
  for (const [home, want] of [
    ['', '/Library/Local State'],
    ['/', '/Library/Local State'],
    ['//', '/Library/Local State'],
    ['///', '/Library/Local State'],
    ['//x', '//x/Library/Local State'],
    ['//x/', '//x/Library/Local State'],
    ['.', 'Library/Local State'],
  ]) {
    assert.equal(cd.pathlibJoin(cd.homeOf({ HOME: home }), ['Library', 'Local State']), want, JSON.stringify(home));
  }
  assert.equal(cd.homeOf({}), os.homedir().replace(/\/+$/, '') || '/', 'no HOME: the account\'s home');
});

test('HOME="" reads the profile under /, never under the working directory', { skip: !POSIX && 'POSIX only' }, () => {
  assert.equal(cd.localState('Darwin', cd.homeOf({ HOME: '' })), '/Library/Application Support/Google/Chrome/Local State');
  assert.equal(cd.localState('Linux', cd.homeOf({ HOME: '' })), '/.config/google-chrome/Local State');
});

test('systemName is platform.system()\'s word', () => {
  const t = os.type();
  assert.equal(cd.systemName(), t === 'Windows_NT' ? 'Windows' : t);
});

test('--mode=status prints the status line and exits 0, through bin/mhw.js', { skip: !POSIX && 'POSIX only' }, () => {
  const system = cd.systemName();
  if (!PROFILE_PARTS[/** @type {'Darwin'} */ (system)]) return;
  const home = freshDir();
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'chrome-debugging', '--mode=status'],
    { env: { PATH: process.env.PATH || '', HOME: home }, encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stdout, 'no Chrome Local State found\n');
  assert.equal(p.stdout, cd.statusText(system, home) + '\n');
});

test('main reads HOME from the environment it is given', () => {
  const { home } = fixture(ON);
  const out = /** @type {string[]} */ ([]);
  assert.equal(cd.main(['--mode=check'], { HOME: home }, { system: 'Darwin', out: (l) => out.push(l) }), 0);
  assert.match(out[0], /^OK {6}.*= true/);
  out.length = 0;
  assert.equal(cd.main(['--mode=status'], { HOME: home }, { system: 'Darwin', out: (l) => out.push(l) }), 0);
  assert.match(out[0], /^on \(/);
});

test('an error that is not the original\'s TypeError is not swallowed', () => {
  const { home } = fixture();
  assert.throws(() => cd.main(['--mode=check'], { HOME: home }, { system: 'Darwin', out: () => { throw new RangeError('boom'); } }), RangeError);
});

test('py.js ordered loads keeps insertion order and dumps writes it back', () => {
  const text = '{"b":1,"10":2,"1":{"z":1,"0":2}}';
  const v = loads(text, { ordered: true });
  assert.ok(v instanceof Map);
  assert.deepEqual([.../** @type {Map<string, unknown>} */ (v).keys()], ['b', '10', '1']);
  assert.equal(dumps(v, { sortKeys: false }), text);
  assert.equal(dumps(v), '{"1":{"0":2,"z":1},"10":2,"b":1}', 'sorted when asked');
  assert.equal(dumps(new Map()), '{}');
  assert.ok(!(loads('{}') instanceof Map), 'a plain object without the option');
});

