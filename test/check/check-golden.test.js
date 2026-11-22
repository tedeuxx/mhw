// S23 parity (#494, convention 3 of #470): `mhw check` in Node (src/commands/check.js, src/lib/prerequisites.js,
// src/lib/merge-authority.js) against the deleted check of global/workstation.py, prerequisites.py and
// merge_authority.py. Throwaway HOMEs, a throwaway admin root and SYNTHETIC values only: gh is a stand-in,
// the services are test/check/fake-service.js on 127.0.0.1, and every token is fake.
// Each case (test/check/cases.js) runs its steps on a fresh HOME through `node <tree>/bin/mhw.js`, on a copy
// of the tree with a synthetic provenance stamp (.workstation-archive) so both sides print the same stamp.
// A 'bare' case runs on a PATH holding only its stand-ins (and python3, dirname and cat, which the base's
// ./mhw and the stand-in gh need); a 'full' case on the tools the installers need, the stand-ins, /usr/bin
// and /bin.
//   golden: each case runs on the head and is compared with the transcript recorded from the original
//           (macOS, where the transcripts were recorded: the installers' target lists differ per OS).
//   live:   where the base revision still holds merge_authority.py, the original runs beside the head on
//           the same case (macOS and Linux). MHW_UPDATE_GOLDEN=1 rewrites the transcripts from the
//           original side only. MHW_S23_LIVE_REQUIRED=1 turns a skip into a failure while the base still
//           holds it.
// Every check step is also held read-only: the HOME and admin root are the same before and after it.
// The intended differences are in test/golden/S23/expected-differences.json, with reasons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { readGolden, writeGolden, goldenPath, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { copyWorkingTree, snapshotTree } from '../helpers/parity.js';
import { goldenName, differences as diffsOf, baseTree } from '../helpers/mcp-golden.js';
import { CASES, LOGIN, TOKEN } from './cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S23';
const POSIX = process.platform !== 'win32';
const DARWIN = process.platform === 'darwin';
const NODE = process.execPath;
/** @type {Array<{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const RECORDED = readGolden(SLICE, 'recorded-from.json');
const COMMIT = 'c'.repeat(40);
const FULL_TOOLS = ['node', 'python3', 'jq', 'git'];
const BARE_TOOLS = ['python3', 'dirname', 'cat'];
const h = throwawayHome('check-golden');
// Development only: MHW_S23_ONLY=<case,...> plays (and with MHW_UPDATE_GOLDEN=1 records) those cases.
const ONLY = (process.env.MHW_S23_ONLY || '').split(',').filter(Boolean);
const PLAYED = CASES.filter((c) => !ONLY.length || ONLY.includes(c.name));
after(() => h.cleanup());

/** Why the cases cannot run here, or ''. */
function missing() {
  if (!POSIX) return 'POSIX only: on Windows mhw check is mhw install-windows --check (#497)';
  for (const t of [...FULL_TOOLS, ...BARE_TOOLS]) if (!which(t)) return t + ' is not on PATH';
  return '';
}

/** @param {string} tree @param {string} describe */
function archive(tree, describe) {
  fs.writeFileSync(path.join(tree, '.workstation-archive'), 'commit: ' + COMMIT + '\ndescribe: ' + describe + '\n');
}

/** A copy of a tree, stamped v3.1.0 and with a .git marker (a checkout to mhw, no repository to git). @param {string} from @param {string} label */
function prepare(from, label) {
  const tree = path.join(fs.mkdtempSync(path.join(h.dir, label + '-')), 'tree');
  if (from === ROOT) copyWorkingTree(ROOT, tree);
  else fs.cpSync(from, tree, { recursive: true, verbatimSymlinks: true });
  archive(tree, 'v3.1.0');
  fs.mkdirSync(path.join(tree, '.git'));
  return tree;
}

/** @param {string} text @param {Array<[string, string]>} subs */
function normalise(text, subs) {
  let t = text.replaceAll('\r\n', '\n');
  for (const [a, b] of [...subs].sort((x, y) => y[0].length - x[0].length)) if (a) t = t.replaceAll(a, b);
  // The python3 the base's ./mhw runs is on the bare PATH, so the repository declaration finds it; its
  // version is this machine's, not the code's.
  return t.replaceAll(/^(OK|DRIFT) +python3 \[required\]: present \(python3 [^)]*\).*$/gm, '<the python3 item: present, this machine\'s version>')
    .replaceAll(/Traceback \(most recent call last\):\n(?:[ \t][^\n]*\n|\^+\n)*[A-Za-z.]+Error[^\n]*\n/g, '<traceback>\n');
}

/** The PATH directory of a case: links to its tools and the case's own shims. @param {string} dir @param {'bare' | 'full'} mode */
function binDir(dir, mode) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const t of mode === 'full' ? FULL_TOOLS : BARE_TOOLS) {
    fs.symlinkSync(t === 'node' ? NODE : /** @type {string} */ (which(t)), path.join(bin, t));
  }
  if (mode === 'full') {
    fs.writeFileSync(path.join(bin, 'gh'), '#!/bin/sh\nexit 99\n');
    fs.chmodSync(path.join(bin, 'gh'), 0o700);
  }
  return bin;
}

/** Sleep without the event loop (the cases run with spawnSync). @param {number} ms */
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

/** A stand-in of a case (the service, or with mode 'proxy' a refusing proxy): its URL and a stop function. @param {string} dir @param {string} [mode] */
function startService(dir, mode = 'service') {
  const portFile = path.join(dir, mode + '.port');
  const log = path.join(dir, mode + '.log');
  fs.writeFileSync(log, '');
  const child = spawn(NODE, [path.join(ROOT, 'test', 'check', 'fake-service.js'), portFile, log, mode], { stdio: 'ignore' });
  for (let i = 0; i < 200 && !fs.existsSync(portFile); i++) sleep(25);
  const port = fs.readFileSync(portFile, 'utf8');
  return { url: 'http://127.0.0.1:' + port, stop: () => child.kill('SIGTERM') };
}

/** @param {string} dir @returns {import('../helpers/parity.js').Entry[]} */
const tree0 = (dir) => snapshotTree(dir);

/**
 * One case on one side: every step's exit code and, for a check step, its stdout and stderr.
 * @param {import('./cases.js').Case} c @param {string} tree @param {{ readOnly?: boolean }} [o]
 */
function play(c, tree, o = {}) {
  const base = fs.mkdtempSync(path.join(h.dir, 'case-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'root');
  const tmp = path.join(base, 'tmp');
  for (const d of [home, root, tmp, path.join(base, 'overlay'), path.join(base, 'work')]) fs.mkdirSync(d, { recursive: true });
  const w = { home, root, dir: base, tree };
  const bin = binDir(base, c.mode);
  c.setup?.(w);
  const service = c.service ? startService(base) : null;
  const proxy = c.proxy ? startService(base, 'proxy') : null;
  const git = path.join(tree, '.git');
  if (c.package) fs.rmSync(git, { recursive: true, force: true });
  /** @type {Array<[string, string]>} */
  const subs = [[tree, '<ROOT>'], [home, '<HOME>'], [root, '<ADMIN>'], [base, '<TMP>'], [NODE, '<NODE>'], [bin, '<BIN>']];
  if (service) subs.push([service.url, '<SERVICE>'], [service.url.slice('http://'.length), '<SERVICE-HOST>']);
  if (proxy) subs.push([proxy.url, '<PROXY>']);
  /** @param {string} v */
  const fill = (v) => v.replaceAll('<SERVICE>', service ? service.url : '').replaceAll('<PROXY>', proxy ? proxy.url : '').replaceAll('<BASE>', base)
    .replaceAll('<FROZEN>', goldenPath(SLICE, 'inputs/prerequisites-base.json'));
  /** @type {Record<string, unknown>} */
  const out = {};
  try {
    for (const [i, step] of c.steps.entries()) {
      archive(tree, step.archive || 'v3.1.0');
      step.pre?.(w);
      /** @type {Record<string, string>} */
      const env = { PATH: (c.pathPrefix || '') + (c.mode === 'full' ? bin + ':/usr/bin:/bin' : bin), HOME: home, TMPDIR: tmp, WORKSTATION_MANAGED_ROOT: root, LANG: 'C.UTF-8', SHELL: '/bin/sh',
        STUB_LOG: path.join(base, 'gh.log'), STUB_REPO: path.join(base, 'repo.json'), FAKE_LOGIN: LOGIN, WORKSTATION_OVERLAY: path.join(base, 'overlay'),
        WORKSTATION_PREREQUISITES: path.join(base, 'decl.json') };
      for (const [k, v] of Object.entries({ ...(c.env || {}), ...(step.env || {}) })) env[k] = fill(v);
      const args = step.args.map((a) => (a.startsWith('<P:') ? '--project=' + path.join(base, 'work', a.slice(3, -1)) : a === '<OVERLAY>' ? '--overlay=' + path.join(base, 'overlay') : a));
      /** @type {string} */
      const before = !step.setup && o.readOnly ? JSON.stringify([tree0(home), tree0(root)]) : '';
      const p = spawnSync(NODE, [path.join(tree, 'bin', 'mhw.js'), ...args], { env, cwd: step.cwd ? path.join(base, step.cwd) : base, encoding: 'utf8', timeout: 600000 });
      const label = 'step' + i + ' ' + step.args.join(' ');
      out[label] = { code: p.status };
      if (step.setup) {
        assert.equal(p.status, 0, c.name + ' ' + label + ': ' + p.stdout + p.stderr);
        continue;
      }
      out[label + ' stdout'] = normalise(p.stdout, subs);
      out[label + ' stderr'] = normalise(p.stderr, subs);
      const recorded = step.post?.(w);
      if (recorded) out[label + ' recorded'] = normalise(recorded, subs);
      if (before) assert.equal(JSON.stringify([tree0(home), tree0(root)]), before, c.name + ' ' + label + ': check wrote a file');
    }
  } finally {
    service?.stop();
    proxy?.stop();
    archive(tree, 'v3.1.0');
    if (c.package) fs.mkdirSync(git, { recursive: true });
  }
  const printed = JSON.stringify(out);
  assert.ok(!printed.includes(LOGIN), c.name + ': the gh login was printed');
  assert.ok(!printed.includes(TOKEN), c.name + ': a token was printed');
  return out;
}

/** @param {string} name @param {Record<string, any>} base @param {Record<string, any>} head */
const differences = (name, base, head) => diffsOf(expected, name, base, head);

test('every case has a golden transcript, every golden a case, and every expected difference names a case and says why', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  const dir = path.join(ROOT, 'test', 'golden', SLICE, 'transcripts');
  for (const n of names) assert.ok(fs.existsSync(path.join(dir, n + '.json')), 'no golden for ' + n);
  for (const f of fs.readdirSync(dir)) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
  for (const e of expected) {
    for (const n of e.case) assert.ok(n === '*' || names.has(n), 'unknown case ' + n);
    assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
    assert.doesNotThrow(() => new RegExp(e.head));
  }
});

test('golden: the Node check matches the transcripts of workstation.py', { skip: (!DARWIN && 'the transcripts were recorded on macOS; the live arm runs on Linux') || missing() || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  const tree = prepare(ROOT, 'head');
  /** @type {string[]} */
  const diffs = [];
  for (const c of PLAYED) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), play(c, tree, { readOnly: true })));
  assert.deepEqual(diffs, []);
});

test('live: the check of the base revision\'s workstation.py, side by side with the head', (t) => {
  const why = missing();
  const py = which('python3');
  const version = py ? spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim() : '';
  const holds = why || (version !== RECORDED.cpython && 'needs CPython ' + RECORDED.cpython + ' (found ' + (version || 'none') + ')') || '';
  const base = holds || baseTree({ root: ROOT, dir: h.dir, holds: path.join('global', 'merge_authority.py') });
  if (!path.isAbsolute(base)) {
    if (process.env.MHW_S23_LIVE_REQUIRED === '1' && !base.includes('has merged')) assert.fail('the live arm is required here: ' + base);
    t.skip(base);
    return;
  }
  const original = prepare(base, 'base');
  const head = prepare(ROOT, 'head');
  /** @type {string[]} */
  const diffs = [];
  for (const c of PLAYED) {
    const was = play(c, original);
    if (UPDATE) {
      assert.ok(DARWIN, 'the transcripts are recorded on macOS');
      writeGolden(SLICE, goldenName(c.name), was);
    }
    diffs.push(...differences(c.name, was, play(c, head, { readOnly: true })));
  }
  assert.deepEqual(diffs, []);
});
