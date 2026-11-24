// S25 parity (#503, convention 3 of #470): the user-layer installer, global/install.sh until this slice and
// `mhw install-user` (src/commands/install-user.js) since, end to end on a throwaway HOME.
//   golden: transcripts/<scenario>.json holds, per run of each scenario in cases.js (install, check, dry run,
//           uninstall), the exit code, stdout, stderr and the HOME's tree (path, kind, mode, and each file's
//           text, or its sha256 past 2 KiB), recorded from the base revision's install.sh.
//   head:   the same runs of this tree's `mhw install-user`. A declared scenario has its Node transcript as
//           <scenario>.node.json, and the difference is named in expected-differences.json.
//   live:   while the base revision still holds install.sh (until this slice merges), both run on the same
//           inputs. MHW_UPDATE_GOLDEN=1 rewrites the goldens from the base side (and the declared Node ones).
// Both sides run a tree assembled in the scenario's directory from their own src/ and bin/ and the
// frozen inputs of test/golden/S25/inputs (the global brief, the floor, the allow list, the clipboard
// defaults, the policy MCP servers, an owner overlay and the method), so a later change to those sources
// does not move the goldens. POSIX only: the user layer is macOS and Linux (mhw install-windows on Windows, test/install/windows.test.js; #497).
// Normalised: the scenario's directory (<T>), the node (<NODE>), the stamp, Chrome's Local State path (it is
// per OS) and the byte counts of WOULD WRITE lines (they carry the stamp).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGolden, writeGolden, goldenPath, UPDATE } from '../helpers/golden.js';
import { apply as applyChange, baseRevision, assertTranscriptInventory } from '../helpers/install-golden.js';
import { extractRevision, normalise } from '../helpers/parity.js';
import { SCENARIOS } from './cases.js';
import { patternPath, stripFile, stripOutput } from '../helpers/s588.js';
import { stripWrapper } from '../helpers/s590.js';

const SLICE = 'S25';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const INPUTS = goldenPath(SLICE, 'inputs');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** @param {string} label */
function freshDir(label) {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's25-' + label + '-')));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/**
 * The tree a side runs: its own code and the frozen inputs; the base keeps its global/install.sh.
 * @param {string} source a checkout or an extracted revision @param {string} dest @param {boolean} shell
 */
export function assemble(source, dest, shell) {
  for (const p of ['src', 'bin', 'package.json', '.bumpversion.toml']) fs.cpSync(path.join(source, p), path.join(dest, p), { recursive: true });
  fs.cpSync(path.join(INPUTS, 'global'), path.join(dest, 'global'), { recursive: true });
  // The method is a frozen input too: hooks-managed-and-method installs it and the tree pins each file's sha256,
  // so the checkout's own method/ would move the golden on every method change, and with install.sh retired
  // the golden can no longer be re-recorded. Copied from origin/rc/next at 7cfb551, the method the goldens hold.
  fs.cpSync(path.join(INPUTS, 'method'), path.join(dest, 'method'), { recursive: true });
  fs.cpSync(path.join(INPUTS, 'overlay'), path.join(dest, 'overlay'), { recursive: true });
  if (shell) fs.copyFileSync(path.join(source, 'global', 'install.sh'), path.join(dest, 'global', 'install.sh'));
}

/**
 * Every entry under dir: a link's target, a file's normalised text (its sha256 past 2 KiB), a directory.
 * @param {string} dir @param {(s: string) => string} norm
 */
function tree(dir, norm) {
  /** @type {Array<{ path: string, kind: string, mode: string, data: string }>} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort((a, b) => (a < b ? -1 : Number(a > b)))) {
      const r = rel ? rel + '/' + name : name;
      if (patternPath(r)) continue; // #588's own files: test/hooks/pattern-check-install.test.js holds them
      const st = fs.lstatSync(path.join(dir, r));
      const mode = (st.mode & 0o777).toString(8);
      if (st.isSymbolicLink()) out.push({ path: r, kind: 'link', mode: '-', data: norm(fs.readlinkSync(path.join(dir, r))) });
      else if (st.isDirectory()) {
        out.push({ path: r, kind: 'dir', mode, data: '' });
        walk(r);
      } else {
        const text = norm(stripFile(r, fs.readFileSync(path.join(dir, r), 'utf8')));
        out.push({ path: r, kind: 'file', mode, data: text.length > 2048 ? 'sha256:' + crypto.createHash('sha256').update(text).digest('hex') : text });
      }
    }
  };
  walk('');
  return out;
}

/**
 * Run one scenario on the given tree: its install.sh (shell) or its `mhw install-user` (node).
 * @param {import('./cases.js').Scenario} sc @param {string} source @param {'shell' | 'node'} side
 */
export function runScenario(sc, source, side) {
  const T = freshDir(sc.name);
  const treeDir = path.join(T, 'tree');
  assemble(source, treeDir, side === 'shell');
  const d = { T, H: path.join(T, 'home') };
  fs.mkdirSync(d.H);
  fs.mkdirSync(path.join(T, 'tmp'));
  fs.mkdirSync(path.join(T, 'admin'));
  /** @param {import('../helpers/install-golden.js').Change} c */
  const apply = (c) => applyChange(d, c, () => {});
  for (const c of sc.setup || []) apply(c);
  const nodeReal = fs.realpathSync(process.execPath);
  const norm = (/** @type {string} */ s) => {
    let out = normalise(s, [[T, '<T>'], [process.execPath, '<NODE>'], [nodeReal, '<NODE>']]);
    out = out.replaceAll('<T>/home/Library/Application Support/Google/Chrome/Local State', '<CHROME_LOCAL_STATE>')
      .replaceAll('<T>/home/.config/google-chrome/Local State', '<CHROME_LOCAL_STATE>');
    return out.replace(/^(WOULD WRITE .* \()\d+( bytes\):)$/gm, '$1<N>$2');
  };
  /** @param {string} v */
  const at = (v) => v.replace(/^T\//, T + '/');
  const runs = [];
  for (const r of sc.runs) {
    for (const c of r.before || []) apply(c);
    /** @type {Record<string, string>} */
    const env = { PATH: '/usr/bin:/bin', HOME: d.H, LANG: 'C', TMPDIR: path.join(T, 'tmp'), SHELL: '/bin/zsh', MHW_NODE: process.execPath };
    for (const [k, v] of Object.entries({ ...sc.env, ...r.env })) {
      if (v === null) delete env[k];
      else env[k] = at(v);
    }
    const args = r.args.map((a) => a.replace('=T/', '=' + T + '/'));
    if (!sc.overlay && !args.some((a) => a.startsWith('--overlay')) && !('WORKSTATION_OVERLAY' in env)) args.push('--overlay=none');
    args.push('--managed-root=' + path.join(T, 'admin'));
    const p = side === 'shell'
      ? spawnSync('/bin/sh', [path.join(treeDir, 'global', 'install.sh'), ...args], { encoding: 'utf8', env, cwd: T, timeout: 120000 })
      : spawnSync(process.execPath, [path.join(treeDir, 'bin', 'mhw.js'), 'install-user', ...args], { encoding: 'utf8', env, cwd: T, timeout: 120000 });
    runs.push({ run: r.label || r.args.join(' ') || 'install', code: p.status, stdout: stripOutput(norm(p.stdout)), stderr: stripOutput(norm(p.stderr)), tree: tree(d.H, norm) });
  }
  return runs;
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
      out[k] = out[k].replace(new RegExp(/** @type {string} */ (e.pattern), 'g'), e.replace ?? '<DECLARED>');
    }
    return out;
  });
}

// CI sets MHW_S25_LIVE_REQUIRED=1 in its S25 step: there, a base that still holds install.sh and cannot be
// run (no base, not extractable) is a failure, not a skip. A base without install.sh retires the live arm.
const LIVE_REQUIRED = process.env.MHW_S25_LIVE_REQUIRED === '1';

/** @param {import('node:test').TestContext} t @param {string} why */
function skipOrFail(t, why) {
  if (LIVE_REQUIRED) assert.fail('MHW_S25_LIVE_REQUIRED=1: ' + why);
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

test('golden: mhw install-user matches the transcripts recorded from install.sh', { skip: (!POSIX && 'POSIX only') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  assertTranscriptInventory(SLICE, SCENARIOS);
  for (const sc of SCENARIOS) {
    const want = readGolden(SLICE, 'transcripts/' + sc.name + (sc.declared ? '.node.json' : '.json'));
    // #590: the paste wrapper's snippet and start-up block, taken out of both sides (test/helpers/s590.js).
    assert.deepEqual(fold(stripWrapper(runScenario(sc, ROOT, 'node')), sc.name), fold(stripWrapper(want), sc.name), sc.name);
  }
});

test('live: install.sh at the base revision, and mhw install-user here, on the same inputs', { skip: !POSIX && 'POSIX only', timeout: 1800000 }, (t) => {
  const [base, why] = baseTree();
  if (!base) return skipOrFail(t, why);
  if (!fs.existsSync(path.join(base, 'global', 'install.sh'))) {
    t.skip('the base revision ' + why + ' no longer holds install.sh: the live arm is retired');
    return;
  }
  for (const sc of SCENARIOS) {
    const shell = runScenario(sc, base, 'shell');
    if (UPDATE) {
      writeGolden(SLICE, 'transcripts/' + sc.name + '.json', shell);
      if (sc.declared) writeGolden(SLICE, 'transcripts/' + sc.name + '.node.json', runScenario(sc, ROOT, 'node'));
      continue;
    }
    assert.deepEqual(shell, readGolden(SLICE, 'transcripts/' + sc.name + '.json'), sc.name + ': the base no longer matches its golden');
    if (!sc.declared) assert.deepEqual(fold(stripWrapper(runScenario(sc, ROOT, 'node')), sc.name), fold(stripWrapper(shell), sc.name), sc.name);
  }
});

test('every declared scenario names its difference in expected-differences.json', () => {
  for (const e of expected) assert.ok(e.why.length > 40 && (!e.case || SCENARIOS.some((x) => x.name === e.case)), e.name);
  for (const sc of SCENARIOS.filter((s) => s.declared)) {
    assert.ok(expected.some((e) => e.case === sc.name), sc.name + ' has no expected-differences entry');
  }
});
