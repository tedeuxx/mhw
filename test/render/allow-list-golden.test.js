// S19 parity (#490, convention 3 of #470): src/render/allow-list.js against the deleted global/allow-list.sh.
//   golden: transcripts/<scenario>.json holds, per run of the step in each scenario of allow-list-cases.js,
//           the exit code, stdout, stderr and the throwaway HOME's tree (path, kind, mode, and each file's
//           text), recorded from the shell original sourced the way install.sh sourced it: install.sh's own
//           helpers (raise, private_copy, is_managed, unstamp, same, stamp_of) cut out of the base
//           revision's install.sh, then allow_parse, then allow_step or allow_uninstall.
//   live:   where the base revision still holds global/allow-list.sh (until this slice merges), both run on
//           the same inputs. MHW_UPDATE_GOLDEN=1 rewrites the goldens from the shell side, never from Node.
// POSIX only: install.sh, the only caller, never runs on Windows (mhw install-windows, #497, renders no allow list). The
// pure functions are tested on every OS in allow-list.test.js. Normalised before comparing: the scenario's
// directory (<T>) and CRLF. Intended differences: test/golden/S19/expected-differences.json; one pattern
// (a head diagnostic on stderr) is applied, and the live arm compares dry-run hunks as sets of lines.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGolden, writeGolden, goldenPath, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { writeAdmin as adminFixture, apply as applyChange, at, tree, hunksAsSets, baseRevision, assertTranscriptInventory }
  from '../helpers/install-golden.js';
import { extractRevision } from '../helpers/parity.js';
import { SCENARIOS, STAMP } from './allow-list-cases.js';

const SLICE = 'S19';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const INPUTS = goldenPath(SLICE, 'inputs');
const NODE_SCRIPT = path.join(ROOT, 'src', 'render', 'allow-list.js');
const MARKER = 'managed-by: personal-multi-harness-workstation-configuration';
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

// The shell side: install.sh's helpers, then the original step, as install.sh ran it (set -eu).
const DRIVER = [
  'set -eu',
  'MARKER_ID="' + MARKER + '"',
  'eval "$(awk \'/^(raise|private_copy|is_managed|unstamp|same|stamp_of)\\(\\) *\\{/ { print; if ($0 !~ /; *\\}$/) p = 1; next }',
  '  p { print; if ($0 ~ /^}/) p = 0 }\' "$A_INSTALL_SH")"',
  'status=0',
  'mode=$A_MODE; stamp=$A_STAMP; script_dir=$A_SCRIPT_DIR; repo_root=$A_REPO_ROOT; overlay=$A_OVERLAY',
  'managed_root=$A_MANAGED_ROOT; floor_claude=$A_FLOOR_CLAUDE; floor_codex=$A_FLOOR_CODEX; settings=$HOME/.claude/settings.json',
  'work=$(mktemp -d)',
  "trap 'rm -rf \"$work\"' EXIT",
  '. "$A_ALLOW_SH"',
  'allow_parse',
  'case $A_PHASE in step) allow_step ;; uninstall) allow_uninstall ;; esac',
  'exit "$status"',
].join('\n');

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s19-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The admin fixtures, under both platform paths so the scenario reads the same on macOS and Linux. @param {string} root @param {string} kind */
const writeAdmin = (root, kind) => adminFixture(root, kind, { inputs: INPUTS, stamp: STAMP,
  claude: ['full', 'claude', 'claude-missing', 'claude-bad'], codex: ['full', 'codex', 'codex-unmanaged'] });

/** @param {{ T: string, H: string, P: string, A: string }} d @param {import('./allow-list-cases.js').Change} c */
const apply = (d, c) => applyChange(d, c, (kind) => writeAdmin(d.A, kind));

/**
 * Run one scenario with the given side: 'node', or a base tree holding allow-list.sh.
 * @param {import('./allow-list-cases.js').Scenario} sc
 * @param {string | null} base
 */
function runScenario(sc, base) {
  const T = freshDir(sc.name);
  const P = sc.layout === 'npm' ? path.join(T, 'lib', 'node_modules', 'mhw') : path.join(T, 'pkg');
  const d = { T, H: path.join(T, 'home'), P, A: path.join(T, 'admin') };
  fs.mkdirSync(d.H);
  fs.mkdirSync(path.join(T, 'tmp'));
  fs.cpSync(INPUTS + '/global', path.join(P, 'global'), { recursive: true });
  fs.cpSync(INPUTS + '/overlay', path.join(P, 'overlay'), { recursive: true });
  fs.writeFileSync(path.join(P, 'package.json'), '{"name": "mhw"}\n');
  if (base) fs.copyFileSync(path.join(base, 'global', 'allow-list.sh'), path.join(P, 'global', 'allow-list.sh'));
  writeAdmin(d.A, sc.admin || 'none');
  for (const c of sc.setup || []) apply(d, c);
  const norm = (/** @type {string} */ s) => s.replaceAll('\r\n', '\n').split(T).join('<T>');
  const runs = [];
  for (const r of sc.runs) {
    for (const c of r.before || []) apply(d, c);
    const stamp = r.stamp || STAMP;
    const overlay = r.overlay === false ? '' : path.join(P, 'overlay');
    const codexHome = sc.codexHome ? at(d, sc.codexHome) : '';
    /** @type {Record<string, string>} */
    const env = { PATH: process.env.PATH || '', HOME: d.H, TMPDIR: path.join(T, 'tmp'), LANG: 'C' };
    if (codexHome) env.CODEX_HOME = codexHome;
    if (sc.cmd) env.MHW_CMD = sc.cmd;
    let p;
    if (base) {
      p = spawnSync('/bin/sh', ['-c', DRIVER], {
        encoding: 'utf8',
        env: { ...env, A_INSTALL_SH: path.join(base, 'global', 'install.sh'), A_ALLOW_SH: path.join(P, 'global', 'allow-list.sh'),
          A_MODE: r.mode || 'uninstall', A_STAMP: stamp, A_SCRIPT_DIR: path.join(P, 'global'), A_REPO_ROOT: P, A_OVERLAY: overlay,
          A_MANAGED_ROOT: d.A, A_FLOOR_CLAUDE: path.join(INPUTS, 'floor.claude'), A_FLOOR_CODEX: path.join(INPUTS, 'floor.codex'),
          A_PHASE: r.phase },
      });
    } else {
      const args = r.phase === 'uninstall'
        ? ['--phase=uninstall', '--settings=' + d.H + '/.claude/settings.json', '--home=' + d.H, '--codex-home=' + codexHome]
        : ['--phase=' + r.phase, '--mode=' + (r.mode || 'install'), '--stamp=' + stamp, '--source=' + P + '/global/allow-list.conf',
          '--overlay=' + overlay, '--retired=' + P + '/global/allow-retired.conf', '--floor-codex=' + path.join(INPUTS, 'floor.codex'),
          '--floor-claude=' + path.join(INPUTS, 'floor.claude'), '--managed-root=' + d.A, '--settings=' + d.H + '/.claude/settings.json',
          '--home=' + d.H, '--codex-home=' + codexHome, '--repo-root=' + P, '--cmd=' + (sc.cmd || './mhw')];
      if (r.phase === 'uninstall') {
        // install.sh parses the list in every mode before anything else.
        const parse = spawnSync(process.execPath, [NODE_SCRIPT, '--phase=parse', '--source=' + P + '/global/allow-list.conf',
          '--overlay=' + overlay, '--floor-codex=' + path.join(INPUTS, 'floor.codex')], { encoding: 'utf8', env });
        assert.equal(parse.status, 0, parse.stderr);
      }
      p = spawnSync(process.execPath, [NODE_SCRIPT, ...args], { encoding: 'utf8', env });
    }
    runs.push({ run: r.label || (r.phase + (r.mode ? ' ' + r.mode : '')), code: p.status, stdout: norm(p.stdout), stderr: norm(p.stderr), tree: tree(d.H, norm) });
  }
  return runs;
}

/** @type {Array<{ name: string, stream: string, pattern: string | null, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');

/**
 * Each expected difference that names a pattern, applied to a transcript from either side: the matching
 * lines are removed, so everything around them is still compared.
 * @param {Array<{ run: string, code: number | null, stdout: string, stderr: string, tree: unknown }>} runs
 */
function intended(runs) {
  const rules = expected.filter((e) => e.pattern).map((e) => new RegExp(/** @type {string} */ (e.pattern)));
  return runs.map((r) => ({ ...r, stderr: r.stderr.split('\n').filter((l) => !rules.some((x) => x.test(l))).join('\n') }));
}

/** The golden a scenario's Node side is held to: the shell's, or its own for a declared one. @param {import('./allow-list-cases.js').Scenario} sc */
const nodeGolden = (sc) => 'transcripts/' + sc.name + (sc.declared ? '.node.json' : '.json');

test('golden: the Node step matches the transcripts recorded from allow-list.sh', { skip: (!POSIX && 'POSIX only') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  for (const sc of SCENARIOS) {
    assert.deepEqual(intended(runScenario(sc, null)), readGolden(SLICE, nodeGolden(sc)), sc.name);
  }
});

test('declared: each declared scenario refuses visibly, leaves settings.json as it was, and the shell acted on it', { skip: !POSIX && 'POSIX only' }, () => {
  for (const sc of SCENARIOS.filter((s) => s.declared)) {
    /** @type {Array<{ run: string, code: number, stdout: string, stderr: string, tree: Array<{ path: string, data: string }> }>} */
    const node = readGolden(SLICE, nodeGolden(sc));
    /** @type {Array<{ stdout: string }>} */
    const shell = readGolden(SLICE, 'transcripts/' + sc.name + '.json');
    const text = /** @type {{ text: string }} */ ((sc.setup || [])[0]).text;
    for (const r of node) {
      assert.equal(r.code, 3, sc.name + ' ' + r.run);
      assert.match(r.stderr, /^REFUSE  <T>\/home\/\.claude\/settings\.json: not readable by the allow-list step/m, sc.name + ' ' + r.run);
      const settings = r.tree.find((e) => e.path === '.claude/settings.json');
      assert.equal(settings && settings.data, text.replaceAll('\r\n', '\n'), sc.name + ' ' + r.run);
    }
    // The record of what the shell did instead, on the machine the goldens were recorded on.
    const acted = shell.some((r) => /^(DRIFT|WOULD|CHANGED|MERGED|UNMERGED) /m.test(r.stdout));
    assert.equal(acted, sc.shellActs !== false, sc.name);
  }
});

test('live: the Node step matches allow-list.sh of the base revision on the same inputs', (t) => {
  if (!POSIX) return t.skip('POSIX only');
  const rev = baseRevision(ROOT);
  const dest = freshDir('base');
  if (!rev || !extractRevision(ROOT, rev, path.join(dest, 'tree')) || !fs.existsSync(path.join(dest, 'tree', 'global', 'allow-list.sh'))) {
    return t.skip('the base revision holds no global/allow-list.sh (this slice has merged), or it is not readable here');
  }
  if (!which('jq')) return t.skip('jq is not on PATH; the shell original needs it');
  const failed = [];
  for (const sc of SCENARIOS) {
    const shell = intended(runScenario(sc, path.join(dest, 'tree')));
    if (UPDATE) writeGolden(SLICE, 'transcripts/' + sc.name + '.json', shell);
    const node = intended(runScenario(sc, null));
    // A declared scenario's Node side is its own golden (written here from the Node side, the one
    // exception, since no shell transcript can be its reference).
    if (UPDATE && sc.declared) writeGolden(SLICE, nodeGolden(sc), node);
    try {
      if (sc.declared) assert.deepEqual(node, readGolden(SLICE, nodeGolden(sc)), sc.name);
      else assert.deepEqual(hunksAsSets(node), hunksAsSets(shell), sc.name);
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  assert.deepEqual(failed, []);
});

test('every scenario has a golden transcript, and every transcript a scenario', { skip: !POSIX && 'POSIX only' }, () => {
  assertTranscriptInventory(SLICE, SCENARIOS);
});
