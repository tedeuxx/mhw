// S22 parity (#493, convention 3 of #470): `mhw status` in Node (src/commands/status.js) against the
// deleted status view of global/workstation.py and global/owner_actions.py. Throwaway HOMEs, a throwaway
// admin root and SYNTHETIC values only; gh is always a stand-in (test/status/cases.js), never the real one.
// Each case (test/status/cases.js) runs its steps on a fresh HOME through `node <tree>/bin/mhw.js`, on a
// copy of the tree with a synthetic provenance stamp (.workstation-archive) so both sides print the same
// stamp, and a PATH holding only the tools the installers need, the stand-ins, /usr/bin and /bin.
//   golden: each case runs on the head and is compared with the transcript recorded from the original
//           (macOS, where the transcripts were recorded: the installers' target lists differ per OS).
//   live:   where the base revision still holds owner_actions.py, the original runs beside the head on
//           the same case (macOS and Linux). MHW_UPDATE_GOLDEN=1 rewrites the transcripts from the
//           original side only. MHW_S22_LIVE_REQUIRED=1 turns a skip into a failure while the base
//           still holds it.
// Every status step is also held read-only: the HOME and admin root are the same before and after it.
// The intended differences are in test/golden/S22/expected-differences.json, with reasons.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { throwawayHome, which } from '../helpers/home.js';
import { copyWorkingTree, snapshotTree } from '../helpers/parity.js';
import { goldenName, differences as diffsOf, baseTree } from '../helpers/mcp-golden.js';
import { CASES, STUB_GH } from './cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S22';
const POSIX = process.platform !== 'win32';
const DARWIN = process.platform === 'darwin';
const NODE = process.execPath;
/** @type {Array<{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const RECORDED = readGolden(SLICE, 'recorded-from.json');
const COMMIT = 'c'.repeat(40);
const TOOLS = ['node', 'python3', 'jq', 'git'];
const h = throwawayHome('status-golden');
// Development only: MHW_S22_ONLY=<case,...> plays (and with MHW_UPDATE_GOLDEN=1 records) those cases.
const ONLY = (process.env.MHW_S22_ONLY || '').split(',').filter(Boolean);
const PLAYED = CASES.filter((c) => !ONLY.length || ONLY.includes(c.name));
after(() => h.cleanup());

/** Why the cases cannot run here, or ''. */
function missing() {
  if (!POSIX) return 'POSIX only: on Windows mhw status is install.ps1 -Check';
  for (const t of TOOLS) if (!which(t)) return t + ' is not on PATH';
  return '';
}

/** @param {string} tree @param {string} describe */
function archive(tree, describe) {
  fs.writeFileSync(path.join(tree, '.workstation-archive'), 'commit: ' + COMMIT + '\ndescribe: ' + describe + '\n');
}

/**
 * A copy of tree under the test's directory, stamped v3.1.0 and with a .git marker, so mhw reads it as a
 * checkout (./mhw) while install.sh, finding no repository there, takes the stamp from the archive.
 * @param {string} from @param {string} label
 */
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
  return t.replaceAll(/^NODE {4}(ok|FAIL) .*$/gm, 'NODE    <the NODE line>')
    .replaceAll(/^ {2}runtime {10}.*$/gm, '  runtime          <host or container>')
    .replaceAll(/Traceback \(most recent call last\):\n(?: [^\n]*\n)*/g, '<traceback>\n');
}

/** A directory of links to the tools and the stand-ins, the only PATH entry besides /usr/bin and /bin. @param {string} dir @param {Record<string, string>} stubs */
function binDir(dir, stubs) {
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  for (const t of TOOLS) fs.symlinkSync(t === 'node' ? NODE : /** @type {string} */ (which(t)), path.join(bin, t));
  for (const [name, text] of Object.entries({ gh: STUB_GH, ...stubs })) {
    fs.writeFileSync(path.join(bin, name), text);
    fs.chmodSync(path.join(bin, name), 0o755);
  }
  return bin;
}

/** @param {string} dir @returns {import('../helpers/parity.js').Entry[]} */
const tree0 = (dir) => snapshotTree(dir);

/**
 * One case on one side: every step's exit code and, for a status step, its stdout and stderr.
 * @param {import('./cases.js').Case} c @param {string} tree @param {{ readOnly?: boolean }} [o]
 */
function play(c, tree, o = {}) {
  const base = fs.mkdtempSync(path.join(h.dir, 'case-'));
  const home = path.join(base, 'home');
  const root = path.join(base, 'root');
  const tmp = path.join(base, 'tmp');
  for (const d of [home, root, tmp]) fs.mkdirSync(d);
  const w = { home, root, dir: base, tree };
  const bin = binDir(base, c.stubs || {});
  c.setup?.(w);
  const git = path.join(tree, '.git');
  if (c.package) fs.rmSync(git, { recursive: true, force: true });
  /** @type {Array<[string, string]>} */
  const subs = [[tree, '<ROOT>'], [home, '<HOME>'], [root, '<ADMIN>'], [base, '<TMP>'], [NODE, '<NODE>'], [bin, '<BIN>']];
  /** @type {Record<string, unknown>} */
  const out = {};
  try {
    for (const [i, step] of c.steps.entries()) {
      archive(tree, step.archive || 'v3.1.0');
      step.pre?.(w);
      /** @type {Record<string, string>} */
      const env = { PATH: bin + ':/usr/bin:/bin', HOME: home, TMPDIR: tmp, WORKSTATION_MANAGED_ROOT: root, LANG: 'C.UTF-8', SHELL: '/bin/sh', ...(step.env || {}) };
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
      if (before) assert.equal(JSON.stringify([tree0(home), tree0(root)]), before, c.name + ' ' + label + ': status wrote a file');
    }
  } finally {
    archive(tree, 'v3.1.0');
    if (c.package) fs.mkdirSync(git, { recursive: true });
  }
  const printed = JSON.stringify(out);
  assert.ok(!printed.includes('secret-ish'), c.name + ': gh\'s own error text was printed');
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

test('golden: the Node status view matches the transcripts of workstation.py', { skip: (!DARWIN && 'the transcripts were recorded on macOS; the live arm runs on Linux') || missing() || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  const tree = prepare(ROOT, 'head');
  /** @type {string[]} */
  const diffs = [];
  for (const c of PLAYED) diffs.push(...differences(c.name, readGolden(SLICE, goldenName(c.name)), play(c, tree, { readOnly: true })));
  assert.deepEqual(diffs, []);
});

test('live: the status view of the base revision\'s workstation.py, side by side with the head', (t) => {
  const why = missing();
  const py = which('python3');
  const version = py ? spawnSync(py, ['-c', 'import platform; print(platform.python_version())'], { encoding: 'utf8' }).stdout.trim() : '';
  const holds = why || (version !== RECORDED.cpython && 'needs CPython ' + RECORDED.cpython + ' (found ' + (version || 'none') + ')') || '';
  const base = holds || baseTree({ root: ROOT, dir: h.dir, holds: path.join('global', 'owner_actions.py') });
  if (!path.isAbsolute(base)) {
    if (process.env.MHW_S22_LIVE_REQUIRED === '1' && !base.includes('has merged')) assert.fail('the live arm is required here: ' + base);
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

test('the PATH the cases run on holds no gh but the stand-in', { skip: missing() || false }, () => {
  const dir = fs.mkdtempSync(path.join(h.dir, 'bin-'));
  const bin = binDir(dir, {});
  const p = spawnSync('/bin/sh', ['-c', 'command -v gh'], { env: { PATH: bin + ':/usr/bin:/bin' }, encoding: 'utf8' });
  assert.equal(p.stdout.trim(), path.join(bin, 'gh'));
});
