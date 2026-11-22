// S26 parity (#496, convention 3 of #470): the admin-layer installer, global/install-managed.sh until this slice
// and `mhw install-admin` (src/commands/install-admin.js) since, end to end on a throwaway --root.
//   golden: transcripts/<scenario>.json holds, per run of each scenario in admin-cases.js, the exit code,
//           stdout, stderr and the admin root's tree (path, kind, mode, and each file's normalised text, or its
//           sha256 past 2 KiB), recorded from the base revision's install-managed.sh.
//   head:   the same runs of this tree's `mhw install-admin`. Every difference is named in
//           expected-differences.json; a pattern there is folded on both sides, so the rest is compared.
//   live:   while the base revision still holds install-managed.sh (until this slice merges), both run on the
//           same inputs, and the hash each RUN line prints must be the digest of its stage on both sides.
//           MHW_UPDATE_GOLDEN=1 rewrites the goldens from the base side.
// Both sides run a tree assembled in the scenario's directory from their own src/, bin/ and method/ and the
// frozen inputs of test/golden/S25/inputs (the global brief, the floor, the allow list, the clipboard defaults
// and the policy MCP servers), with --overlay=none. Nothing runs as root and no system path is written: every
// run that installs passes --root=<a throwaway directory>, and the runs without one are refused first.
// Normalised: the scenario's directory (<T>), the node (<NODE>), the admin targets (<BASE>, <CLAUDE_DIR>,
// <CODEX_DIR>, <KIRO_FILE>: their paths differ between macOS and Linux), the stage names, the hash and the
// stamp. A hook file that is its source plus the stamp line is recorded as that, so a later change to the hook
// source does not move these goldens.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGolden, writeGolden, goldenPath, UPDATE } from '../helpers/golden.js';
import { baseRevision, assertTranscriptInventory } from '../helpers/install-golden.js';
import { extractRevision, normalise } from '../helpers/parity.js';
import { which } from '../helpers/home.js';
import { SCENARIOS, stageDigest, targetsOf } from './admin-cases.js';

const SLICE = 'S26';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const INPUTS = goldenPath('S25', 'inputs');
const ROOT_USER = typeof process.getuid === 'function' && process.getuid() === 0;
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** @param {string} label */
function freshDir(label) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's26-' + label + '-')));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/**
 * The tree a side runs: its own code and the frozen inputs; the base keeps its global/install-managed.sh.
 * @param {string} source a checkout or an extracted revision @param {string} dest @param {boolean} shell
 */
function assemble(source, dest, shell) {
  for (const p of ['src', 'bin', 'method', 'package.json', '.bumpversion.toml']) fs.cpSync(path.join(source, p), path.join(dest, p), { recursive: true });
  fs.cpSync(path.join(INPUTS, 'global'), path.join(dest, 'global'), { recursive: true });
  fs.mkdirSync(path.join(dest, 'overlay'));
  if (shell) fs.copyFileSync(path.join(source, 'global', 'install-managed.sh'), path.join(dest, 'global', 'install-managed.sh'));
}

/**
 * The admin targets' entries, each under its placeholder: a link's target, a file's normalised text (its
 * sha256 past 2 KiB; a hook file that is its source plus a stamp line, as that), a directory.
 * @param {ReturnType<typeof targetsOf>} t @param {string} treeDir @param {(s: string) => string} norm
 */
function adminTree(t, treeDir, norm) {
  /** @type {Array<{ path: string, kind: string, mode: string, data: string }>} */
  const out = [];
  /** @param {string} dir @param {string} label */
  const walk = (dir, label) => {
    if (!fs.existsSync(dir)) return;
    for (const name of fs.readdirSync(dir).sort((a, b) => (a < b ? -1 : Number(a > b)))) {
      const p = path.join(dir, name);
      const r = label + '/' + name;
      const st = fs.lstatSync(p);
      const mode = (st.mode & 0o777).toString(8);
      if (st.isSymbolicLink()) out.push({ path: r, kind: 'link', mode: '-', data: norm(fs.readlinkSync(p)) });
      else if (st.isDirectory()) {
        out.push({ path: r, kind: 'dir', mode, data: '' });
        walk(p, r);
      } else {
        const text = fs.readFileSync(p, 'utf8');
        const m = /^<BASE>\/bin\/hook\/(src\/.+\.js)$/.exec(r);
        const nl = text.indexOf('\n');
        if (m && nl > 0 && text.slice(nl + 1) === fs.readFileSync(path.join(treeDir, m[1]), 'utf8')) {
          out.push({ path: r, kind: 'file', mode, data: norm(text.slice(0, nl)) + '\n<the source of ' + m[1] + '>' });
          continue;
        }
        const n = norm(text);
        out.push({ path: r, kind: 'file', mode, data: n.length > 2048 ? 'sha256:' + crypto.createHash('sha256').update(n).digest('hex') : n });
      }
    }
  };
  walk(t.base, '<BASE>');
  walk(t.claudeDir, '<CLAUDE_DIR>');
  walk(t.codexDir, '<CODEX_DIR>');
  const st = fs.lstatSync(t.kiro, { throwIfNoEntry: false });
  if (st) out.push({ path: '<KIRO_FILE>', kind: st.isFile() ? 'file' : 'other', mode: (st.mode & 0o777).toString(8), data: st.isFile() ? norm(fs.readFileSync(t.kiro, 'utf8')) : '' });
  return out;
}

const RUN_LINE = /^RUN {5}.* --apply="([^"]+)" --sha256=([0-9a-f]+)/m;

/**
 * Run one scenario on the given tree: its install-managed.sh (shell) or its `mhw install-admin` (node).
 * -> { runs, digests }: the normalised runs, and per RUN line whether its hash is the digest of the stage it
 * names, computed here (so both installers hash a stage the same way, though their stages name two roots).
 * @param {import('./admin-cases.js').Scenario} sc @param {string} source @param {'shell' | 'node'} side
 */
export function runScenario(sc, source, side) {
  const T = freshDir(sc.name);
  const treeDir = path.join(T, 'tree');
  assemble(source, treeDir, side === 'shell');
  for (const d of ['home', 'tmp', 'root']) fs.mkdirSync(path.join(T, d));
  const root = path.join(T, 'root');
  const t = targetsOf(root);
  const clean = targetsOf(path.join(T, 'clean'));
  /** @type {import('./admin-cases.js').Paths} */
  const p = { T, root, stage: '', sha: '', t };
  const nodeReal = fs.realpathSync(process.execPath);
  const subs = /** @type {Array<[string, string]>} */ ([[t.base, '<BASE>'], [t.claudeDir, '<CLAUDE_DIR>'], [t.codexDir, '<CODEX_DIR>'], [t.kiro, '<KIRO_FILE>'],
    [clean.base, '<CLEAN>/<BASE>'], [clean.claudeDir, '<CLEAN>/<CLAUDE_DIR>'], [clean.codexDir, '<CLEAN>/<CODEX_DIR>'], [clean.kiro, '<CLEAN>/<KIRO_FILE>'],
    [T, '<T>'], [process.execPath, '<NODE>'], [nodeReal, '<NODE>']]);
  const norm = (/** @type {string} */ s) => normalise(s, subs)
    .replaceAll(/pmhwc-(managed|apply)\.[A-Za-z0-9]{6}/g, 'pmhwc-$1.<X>')
    .replaceAll(/--sha256=[0-9a-f]{64}/g, '--sha256=<SHA>');
  const jqDir = path.dirname(which('jq') || '/usr/bin/jq');
  const runs = [];
  /** @type {boolean[]} */
  const digests = [];
  for (const r of sc.runs) {
    r.before?.(p);
    /** @type {Record<string, string>} */
    const env = { PATH: (jqDir === '/usr/bin' ? '' : jqDir + ':') + '/usr/bin:/bin', HOME: path.join(T, 'home'), LANG: 'C', TMPDIR: path.join(T, 'tmp'),
      SHELL: '/bin/sh', MHW_NODE: process.execPath };
    for (const [k, v] of Object.entries(r.env || {})) {
      if (v === null) delete env[k];
      else env[k] = v.replace(/^T\//, T + '/');
    }
    const args = ['--overlay=none', ...r.args.map((a) => {
      if (a === 'R') return '--root=' + root;
      return a.replace('=T/', '=' + T + '/').replace('=STAGE', '=' + p.stage).replace('=SHA', '=' + p.sha);
    })];
    const c = side === 'shell'
      ? spawnSync('/bin/sh', [path.join(treeDir, 'global', 'install-managed.sh'), ...args], { encoding: 'utf8', env, cwd: T, timeout: 300000 })
      : spawnSync(process.execPath, [path.join(treeDir, 'bin', 'mhw.js'), 'install-admin', ...args], { encoding: 'utf8', env, cwd: T, timeout: 300000 });
    const m = RUN_LINE.exec(c.stdout);
    if (m) {
      p.stage = m[1];
      p.sha = m[2];
      digests.push(stageDigest(m[1]) === m[2]);
    }
    runs.push({ run: r.label || r.args.join(' '), code: c.status, stdout: norm(c.stdout), stderr: norm(c.stderr), tree: adminTree(t, treeDir, norm) });
  }
  return { runs, digests };
}

/** @type {Array<{ name: string, case?: string, stream: string, pattern: string | null, replace?: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');

/**
 * Each expected difference that names a pattern, applied to the runs of either side: the matches are
 * rewritten, so everything around them is still compared.
 * @param {Array<{ stdout: string, stderr: string }>} runs @param {string} name
 */
function fold(runs, name) {
  const rules = expected.filter((e) => e.pattern && (!e.case || e.case === name));
  return runs.map((r) => {
    const out = { ...r };
    for (const e of rules) {
      const k = /** @type {'stdout' | 'stderr'} */ (e.stream);
      out[k] = out[k].replace(new RegExp(/** @type {string} */ (e.pattern), 'gm'), e.replace ?? '<DECLARED>');
    }
    return out;
  });
}

// CI sets MHW_S26_LIVE_REQUIRED=1 in its S26 step: there, a base that still holds install-managed.sh and cannot
// be run (no base, not extractable) is a failure, not a skip. A base without it retires the live arm.
const LIVE_REQUIRED = process.env.MHW_S26_LIVE_REQUIRED === '1';
const SKIP = (!POSIX && 'POSIX only: the admin layer is macOS and Linux') || (ROOT_USER && 'never as root: these runs must be refused their system paths');

/** @param {import('node:test').TestContext} t @param {string} why */
function skipOrFail(t, why) {
  if (LIVE_REQUIRED) assert.fail('MHW_S26_LIVE_REQUIRED=1: ' + why);
  t.skip(why);
}

/** The base revision extracted once, or null with the reason. @returns {[string | null, string]} */
function baseTree() {
  const base = baseRevision(ROOT);
  if (!base) return [null, 'no base revision (MHW_PARITY_BASE, or the merge-base with origin/rc/next)'];
  const dest = path.join(freshDir('base'), 'rev');
  if (!extractRevision(ROOT, base, dest)) return [null, 'the base revision ' + base + ' could not be extracted'];
  return [dest, base];
}

test('golden: mhw install-admin matches the transcripts recorded from install-managed.sh', { skip: SKIP || (UPDATE && 'MHW_UPDATE_GOLDEN=1'), timeout: 1800000 }, () => {
  assertTranscriptInventory(SLICE, SCENARIOS);
  for (const sc of SCENARIOS) {
    const want = readGolden(SLICE, 'transcripts/' + sc.name + '.json');
    const node = runScenario(sc, ROOT, 'node');
    assert.deepEqual(fold(node.runs, sc.name), fold(want, sc.name), sc.name);
    assert.ok(node.digests.every(Boolean), sc.name + ': a RUN line names a hash that is not its stage\'s digest');
  }
});

test('live: install-managed.sh at the base revision, and mhw install-admin here, on the same inputs', { skip: SKIP, timeout: 1800000 }, (t) => {
  const [base, why] = baseTree();
  if (!base) return skipOrFail(t, why);
  if (!fs.existsSync(path.join(base, 'global', 'install-managed.sh'))) {
    t.skip('the base revision ' + why + ' no longer holds install-managed.sh: the live arm is retired');
    return;
  }
  for (const sc of SCENARIOS) {
    const shell = runScenario(sc, base, 'shell');
    if (UPDATE) {
      writeGolden(SLICE, 'transcripts/' + sc.name + '.json', shell.runs);
      continue;
    }
    assert.deepEqual(shell.runs, readGolden(SLICE, 'transcripts/' + sc.name + '.json'), sc.name + ': the base no longer matches its golden');
    const node = runScenario(sc, ROOT, 'node');
    assert.deepEqual(fold(node.runs, sc.name), fold(shell.runs, sc.name), sc.name);
    // The hash is the one number the owner's sudo line carries: each side's is the digest of its own stage.
    assert.ok(node.digests.length === shell.digests.length && shell.digests.every(Boolean) && node.digests.every(Boolean), sc.name + ': a stage hash is not the stage digest');
  }
});

test('every expected difference names a scenario or none and says why', () => {
  for (const e of expected) {
    assert.ok(e.why.length > 40 && (!e.case || SCENARIOS.some((x) => x.name === e.case)), e.name);
    if (e.pattern) assert.doesNotThrow(() => new RegExp(/** @type {string} */ (e.pattern), 'gm'), e.name);
  }
});
