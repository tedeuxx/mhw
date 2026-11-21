// S21 parity (#492, convention 3 of #470): install.sh's shell start-up block (the paste wrapper's managed
// block in ~/.zshrc, ~/.bashrc and the macOS bash login file), now src/render/shell-rc.js, against the
// shell and awk functions it replaced (rc_* and shell_rc_*).
//   golden: transcripts/<scenario>.json holds, per run in each scenario of shell-rc-cases.js, the exit code,
//           stdout, stderr and the trees of the throwaway HOME and of a directory outside it (path, kind,
//           mode, and each file's text), recorded from the base revision's install.sh: its start-up block
//           section cut out of it and run the way install.sh ran it (set -eu).
//   head:   the same section cut out of this tree's install.sh, which runs the Node step, so the shell
//           wiring (the node, the arguments, the exit codes) is held to the golden too.
//   live:   where the base revision still holds the shell functions (until this slice merges), both run on
//           the same inputs. MHW_UPDATE_GOLDEN=1 rewrites the goldens from the base side, never from Node.
// `uname` is a stand-in on PATH that prints the scenario's system name, so the macOS login-file rule is
// exercised on Linux too, on both sides. POSIX only: install.sh never runs on Windows (install.ps1 writes no
// start-up file). Normalised before comparing: the scenario's directory (<T>). Intended differences:
// test/golden/S21/expected-differences.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { apply as applyChange, at, tree, baseRevision, assertTranscriptInventory } from '../helpers/install-golden.js';
import { extractRevision } from '../helpers/parity.js';
import { SCENARIOS, NAME } from './shell-rc-cases.js';

const SLICE = 'S21';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** The base revision's install.sh still holds the shell functions while it carries this. */
const BASE_MARKER = 'rc_scan() {';

// install.sh's raise and private_copy, and its start-up block section (from its heading comment to
// render()), cut out of the given install.sh and run as install.sh ran them (set -eu). The variables both
// forms read are set first: the base's functions read the snippet, the data directory and $work, the head's
// step reads the node and the reason (empty) a node was refused.
const DRIVER = [
  'set -eu',
  'umask 022',
  'data_dir=$HOME/.local/share/' + NAME,
  'snippet_dest=$data_dir/paste-filter.sh',
  'script_dir=$A_SCRIPT_DIR',
  'status=0',
  'mode=$A_MODE; shell_rc=$A_SHELL_RC',
  'allow_node=$A_NODE; settings_why=${A_SETTINGS_WHY:-}',
  'work=$(mktemp -d)',
  "trap 'rm -rf \"$work\"' EXIT",
  'eval "$(awk \'/^(raise|private_copy)\\(\\) *\\{/ { print; if ($0 !~ /; *\\}$/) p = 1; next }',
  '  p { print; if ($0 ~ /^}/) p = 0 }\' "$A_INSTALL_SH")"',
  'eval "$(awk \'/^# The shell start-up block that activates the paste wrapper/ { p = 1 } /^render\\(\\) *\\{/ { p = 0 } p\' "$A_INSTALL_SH")"',
  'if [ "$mode" = uninstall ]; then',
  '  if command -v shell_rc_uninstall > /dev/null 2>&1; then shell_rc_uninstall; else startup_step; fi',
  'elif command -v shell_rc_line > /dev/null 2>&1; then shell_rc_line',
  'else startup_step',
  'fi',
  'exit "$status"',
].join('\n');

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's21-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * Run one scenario through the install.sh of the given tree (the head's runs the Node step).
 * @param {import('./shell-rc-cases.js').Scenario} sc
 * @param {string} tree_ the tree whose install.sh (and src/render) runs
 * @param {{ settingsWhy?: string, node?: string, homeName?: string }} [o] a refused node's reason; another node program; the HOME directory's name
 */
function runScenario(sc, tree_, o = {}) {
  const T = freshDir(sc.name);
  const H = path.join(T, o.homeName || 'home');
  // S: a sibling of HOME whose name starts with HOME's (<T>/homex), outside HOME; recorded only when used.
  const d = { T, H, O: path.join(T, 'out'), S: H + 'x' };
  for (const dir of [d.H, d.O, path.join(T, 'tmp'), path.join(T, 'bin')]) fs.mkdirSync(dir);
  fs.writeFileSync(path.join(T, 'bin', 'uname'), '#!/bin/sh\nprintf \'%s\\n\' "$A_UNAME"\n', { mode: 0o755 });
  const sub = (/** @type {string} */ s) => s.replaceAll('@H', d.H).replaceAll('@O', d.O);
  /** @param {import('./shell-rc-cases.js').Change} c */
  const apply = (c) => applyChange(d, 'text' in c ? { ...c, text: sub(c.text) } : 'to' in c ? { ...c, to: sub(c.to) } : c, () => {});
  for (const c of sc.setup || []) apply(c);
  const norm = (/** @type {string} */ s) => s.split(T).join('<T>');
  const runs = [];
  for (const r of sc.runs) {
    for (const c of r.before || []) apply(c);
    /** @type {Record<string, string>} */
    const env = { PATH: path.join(T, 'bin') + ':' + (process.env.PATH || ''), HOME: d.H, TMPDIR: path.join(T, 'tmp'), LANG: 'C',
      A_INSTALL_SH: path.join(tree_, 'global', 'install.sh'), A_SCRIPT_DIR: path.join(tree_, 'global'), A_NODE: o.node || process.execPath,
      A_MODE: r.mode, A_SHELL_RC: r.shellRc === undefined || r.shellRc === 'none' ? r.shellRc || '' : at(d, r.shellRc),
      A_UNAME: sc.uname || 'Darwin', A_SETTINGS_WHY: o.settingsWhy || '' };
    if (sc.shell !== null) env.SHELL = sc.shell ?? '/bin/zsh';
    if (sc.zdotdir) env.ZDOTDIR = at(d, sc.zdotdir);
    const p = spawnSync('/bin/sh', ['-c', DRIVER], { encoding: 'utf8', env });
    runs.push({ run: r.label || r.mode + (r.shellRc ? ' --shell-rc' : ''), code: p.status, stdout: norm(p.stdout), stderr: norm(p.stderr),
      tree: { home: tree(d.H, norm), out: tree(d.O, norm), ...(fs.existsSync(d.S) ? { sibling: tree(d.S, norm) } : {}) } });
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
  const rules = expected.filter((e) => e.pattern).map((e) => ({ re: new RegExp(/** @type {string} */ (e.pattern)), stream: e.stream }));
  const strip = (/** @type {string} */ text, /** @type {string} */ stream) => text.split('\n')
    .filter((l) => !rules.some((x) => x.stream === stream && x.re.test(l))).join('\n');
  return runs.map((r) => ({ ...r, stdout: strip(r.stdout, 'stdout'), stderr: strip(r.stderr, 'stderr') }));
}

// CI sets MHW_S21_LIVE_REQUIRED=1 in its S21 step: there, a base that still holds the shell functions and
// cannot be run (no base, not readable) is a failure, not a skip.
const LIVE_REQUIRED = process.env.MHW_S21_LIVE_REQUIRED === '1';

/** @param {import('node:test').TestContext} t @param {string} why */
function skipOrFail(t, why) {
  if (LIVE_REQUIRED) assert.fail('MHW_S21_LIVE_REQUIRED=1: ' + why);
  t.skip(why);
}

test('golden: the Node step, through install.sh, matches the transcripts recorded from the shell functions', { skip: (!POSIX && 'POSIX only') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  const failed = [];
  for (const sc of SCENARIOS) {
    try {
      assert.deepEqual(intended(runScenario(sc, ROOT)), intended(readGolden(SLICE, 'transcripts/' + sc.name + '.json')), sc.name);
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  assert.deepEqual(failed, []);
});

test('declared: without a node the step changes no start-up file, says so and raises 2', { skip: !POSIX && 'POSIX only' }, () => {
  for (const name of ['zsh-owner-file', 'shell-rc-file-plus-defaults']) {
    const sc = /** @type {import('./shell-rc-cases.js').Scenario} */ (SCENARIOS.find((s) => s.name === name));
    const runs = runScenario({ ...sc, runs: [{ mode: 'install' }, { mode: 'check' }, { mode: 'uninstall' }] }, ROOT,
      { settingsWhy: 'node (26 or later) is required' });
    const before = runScenario({ ...sc, runs: [{ mode: 'check' }] }, ROOT, { settingsWhy: 'x' })[0].tree;
    for (const r of runs) {
      assert.equal(r.code, 2, name + ' ' + r.run);
      assert.equal(r.stdout, 'REFUSE  the shell start-up block: node (26 or later) is required; no start-up file changed\n', name + ' ' + r.run);
      assert.deepEqual(r.tree, before, name + ' ' + r.run);
    }
  }
});

test('declared: install.sh reads the step\'s exit codes; a write that fails stops it, exit 1', { skip: (!POSIX && 'POSIX only') || (process.getuid?.() === 0 && 'root writes every file') }, () => {
  // An exit 1 outside --check is node's own exit for an uncaught exception: a refusal (3), never drift.
  const T = freshDir('fake-node');
  const fake = path.join(T, 'node');
  const sc = /** @type {import('./shell-rc-cases.js').Scenario} */ ({ name: 'exit-codes', runs: [{ mode: 'install' }, { mode: 'check' }, { mode: 'uninstall' }] });
  for (const [exit, want] of [['1', [3, 1, 3]], ['3', [3, 3, 3]], ['2', [2, 2, 2]], ['5', [5, 5, 5]], ['4', [1, 1, 1]]]) {
    fs.writeFileSync(fake, '#!/bin/sh\nexit ' + exit + '\n', { mode: 0o755 });
    assert.deepEqual(runScenario(sc, ROOT, { node: fake }).map((r) => r.code), want, 'node exit ' + exit);
  }
  // The real step on a read-only directory: the backup fails, the REFUSE line, install.sh exit 1.
  const ro = runScenario({ name: 'read-only', setup: [{ write: 'H/ro/rc', text: 'export A=1\n' }, { chmod: 'H/ro', mode: 0o555 }],
    runs: [{ mode: 'install', shellRc: 'H/ro/rc' }, { mode: 'check', shellRc: 'H/ro/rc', label: 'restore', before: [{ chmod: 'H/ro', mode: 0o755 }] }] }, ROOT);
  assert.equal(ro[0].code, 1);
  assert.equal(ro[0].stderr, 'REFUSE  <T>/home/ro/rc.pmhwc-backup: the backup could not be created exclusively; no backup written\n');
  assert.equal(ro[1].code, 1, 'the block was not written');
});

test('declared: a HOME that would put code into the start-up block is refused through install.sh, exit 3 (PR #543 lens)', { skip: !POSIX && 'POSIX only' }, () => {
  for (const homeName of ['h$(touch PWNED)', 'h`touch PWNED`', 'h"q']) {
    const runs = runScenario({ name: 'unsafe-home', setup: [{ write: 'H/.zshrc', text: 'export MINE=1\n' }],
      runs: [{ mode: 'install' }, { mode: 'check' }, { mode: 'dry-run' }] }, ROOT, { homeName });
    for (const r of runs) {
      assert.equal(r.code, 3, homeName + ' ' + r.run);
      assert.match(r.stdout, /^REFUSE {2}the shell start-up block: the snippet path ".*" holds a quote, \$, a backtick, a backslash or a line break, which a start-up file would run as code; no start-up file written\n$/, homeName);
      assert.deepEqual(r.tree.home.map((e) => e.path), ['.zshrc'], homeName);
      assert.equal(r.tree.home[0].data, 'export MINE=1\n', homeName);
    }
  }
});

test('live: the Node step matches the base revision\'s shell functions on the same inputs', (t) => {
  if (!POSIX) return t.skip('POSIX only');
  const rev = baseRevision(ROOT);
  const base = path.join(freshDir('base'), 'tree');
  if (!rev) return skipOrFail(t, 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)');
  if (!extractRevision(ROOT, rev, base)) return skipOrFail(t, 'base revision ' + rev + ' is not readable here');
  if (!fs.readFileSync(path.join(base, 'global', 'install.sh'), 'utf8').includes(BASE_MARKER)) {
    return t.skip('the base revision writes the start-up block in Node (this slice has merged)');
  }
  const failed = [];
  for (const sc of SCENARIOS) {
    const shell = intended(runScenario(sc, base));
    if (UPDATE) writeGolden(SLICE, 'transcripts/' + sc.name + '.json', shell);
    try {
      assert.deepEqual(intended(runScenario(sc, ROOT)), shell, sc.name);
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  assert.deepEqual(failed, []);
});

test('every scenario has a golden transcript, and every transcript a scenario', { skip: !POSIX && 'POSIX only' }, () => {
  assertTranscriptInventory(SLICE, SCENARIOS);
});
