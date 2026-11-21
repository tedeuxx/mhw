// S20 parity (#491, convention 3 of #470): install.sh's merge_settings, uninstall_user and report_floor, now
// src/render/settings-merge.js and src/render/floor-report.js, against the jq programs they replaced.
//   golden: transcripts/<scenario>.json holds, per run in each scenario of settings-merge-cases.js, the exit
//           code, stdout, stderr and the throwaway HOME's tree (path, kind, mode, and each file's text),
//           recorded from the base revision's install.sh: its functions cut out of it and run the way
//           install.sh ran them (set -eu), on frozen floor inputs (test/golden/S20/inputs).
//   head:   the same functions cut out of this tree's install.sh, which run the Node steps, so the shell
//           wiring is held to the golden too.
//   live:   where the base revision still holds the jq programs (until this slice merges), both run on the
//           same inputs. MHW_UPDATE_GOLDEN=1 rewrites the goldens from the base side, never from Node.
// POSIX only: install.sh never runs on Windows (install.ps1 merges its own settings). The pure functions are
// tested on every OS in settings-merge.test.js. Normalised before comparing: the scenario's directory (<T>)
// and CRLF. Intended differences: test/golden/S20/expected-differences.json.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readGolden, writeGolden, goldenPath, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { writeAdmin as adminFixture, apply as applyChange, tree, hunksAsSets, baseRevision, assertTranscriptInventory }
  from '../helpers/install-golden.js';
import { extractRevision } from '../helpers/parity.js';
import { SCENARIOS, STAMP } from './settings-merge-cases.js';

const SLICE = 'S20';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const INPUTS = goldenPath(SLICE, 'inputs');
const NAME = 'personal-multi-harness-workstation-configuration';
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** The marker the base revision's install.sh carries while it still merges with jq. */
const BASE_MARKER = 'jq is required to merge the hook entry and the deny floor';

// install.sh's functions, cut out of the given install.sh, then the phase, as install.sh ran it (set -eu).
// The variables both forms read are set here: the base's jq programs read the ids and keys, the head's Node
// steps read the node, its scripts and the reason (empty) a node was refused.
const FUNCTIONS = 'raise|private_copy|is_managed|stamp_of|paste_wrap|json_body|paste_cmd|merge_settings|uninstall_user|report_floor|kiro_step';
const DRIVER = [
  'set -eu',
  'MARKER_ID="managed-by: ' + NAME + '"',
  "PASTE_ID='/bin/mhw.js\" hook prompt --harness '; OLD_PASTE_ID=\"" + NAME + '/clipboard_guard.py"',
  'STAMP_KEY="' + NAME + '"; OWN_KEY="' + NAME + '-owned-deny"',
  // The prompt hook's command (#488) names the node and the package: fixed paths, so both trees render the same.
  "wrap_node=/opt/s20/bin/node; wrap_mhw=/opt/s20/mhw/bin/mhw.js",
  "PASTE_START_NOTICE='Paste filter (ADR-0033): internal error (HookStartError); this prompt was NOT checked.'",
  'RESTART_ID="' + NAME + '/restart_guard.py"; HOOK_ID="' + NAME + '/hitl-escalation-guard.sh"',
  'eval "$(awk \'/^(' + FUNCTIONS + ')\\(\\) *\\{/ { print; if ($0 !~ /; *\\}$/) p = 1; next }',
  '  p { print; if ($0 ~ /^}/) p = 0 }\' "$A_INSTALL_SH")"',
  'status=0',
  'mode=$A_MODE; hooks_mode=$A_HOOKS; paste_ok=$A_PASTE_OK; stamp=$A_STAMP; script_dir=$A_SCRIPT_DIR',
  'managed_root=$A_MANAGED_ROOT; floor=$A_FLOOR; floor_from=global/deny-floor.conf; floor_claude=$A_FLOOR_CLAUDE; floor_codex=$A_FLOOR_CODEX',
  'settings=$HOME/.claude/settings.json',
  'data_dir=$HOME/.local/share/' + NAME,
  'hook_dest=$data_dir/hitl-escalation-guard.sh; hook_conf_dest=$data_dir/hitl.conf; restart_dest=$data_dir/restart_guard.py',
  'glass_dest=$data_dir/breaking_glass.py; glasscmd_dest=$HOME/.claude/commands/breaking-glass.md',
  'clip_dest=$data_dir/clipboard_guard.py; clip_conf_dest=$data_dir/clipboard.conf; wrap_dest=$data_dir/paste_wrapper.py',
  'snippet_dest=$data_dir/paste-filter.sh; clip_plist=$HOME/Library/LaunchAgents/local.' + NAME + '.clipboard-guard.plist',
  'codex_rules=$HOME/.codex/rules/workstation-deny-floor.rules; codex_hooks=$HOME/.codex/hooks.json',
  'kiro_hook=$HOME/.kiro/hooks/' + NAME + '-paste-filter.json',
  'allow_node=$A_NODE; settings_why=; merge_refused=',
  'settings_js=$A_SCRIPT_DIR/../src/render/settings-merge.js; floor_js=$A_SCRIPT_DIR/../src/render/floor-report.js',
  'work=$(mktemp -d)',
  "trap 'rm -rf \"$work\"' EXIT",
  'case $A_PHASE in merge) merge_settings ;; uninstall) uninstall_user ;; report) report_floor ;; esac',
  'exit "$status"',
].join('\n');

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's20-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The admin fixtures: Claude Code's for the claude kinds, Codex's for the others and the incomplete ones. @param {string} root @param {string} kind */
const writeAdmin = (root, kind) => adminFixture(root, kind, { inputs: INPUTS, stamp: STAMP,
  claude: ['full', 'claude-missing', 'claude-bad'], codex: ['full', 'codex', 'codex-unmanaged', 'claude-missing', 'claude-bad'] });

/** @param {{ T: string, H: string, A: string }} d @param {import('./settings-merge-cases.js').Change} c */
const apply = (d, c) => applyChange(d, c, (kind) => writeAdmin(d.A, kind));

/**
 * Run one scenario through the install.sh of the given tree (the head's runs the Node steps).
 * @param {import('./settings-merge-cases.js').Scenario} sc
 * @param {string} tree_ the tree whose install.sh (and src/render) runs
 */
function runScenario(sc, tree_) {
  const T = freshDir(sc.name);
  const d = { T, H: path.join(T, 'home'), A: path.join(T, 'admin') };
  fs.mkdirSync(d.H);
  fs.mkdirSync(path.join(T, 'tmp'));
  writeAdmin(d.A, sc.admin || 'none');
  for (const c of sc.setup || []) apply(d, c);
  const norm = (/** @type {string} */ s) => s.replaceAll('\r\n', '\n').split(T).join('<T>');
  const runs = [];
  for (const r of sc.runs) {
    for (const c of r.before || []) apply(d, c);
    const p = spawnSync('/bin/sh', ['-c', DRIVER], {
      encoding: 'utf8',
      env: { PATH: process.env.PATH || '', HOME: d.H, TMPDIR: path.join(T, 'tmp'), LANG: 'C', MHW_NODE: process.execPath,
        A_INSTALL_SH: path.join(tree_, 'global', 'install.sh'), A_SCRIPT_DIR: path.join(tree_, 'global'),
        A_MODE: r.mode || 'install', A_HOOKS: r.hooks || 'user', A_PASTE_OK: r.paste === false ? '0' : '1', A_STAMP: r.stamp || STAMP,
        A_MANAGED_ROOT: d.A, A_FLOOR: path.join(INPUTS, 'deny-floor.conf'),
        A_FLOOR_CLAUDE: path.join(INPUTS, sc.floor === 'dup' ? 'floor-dup.claude' : 'floor.claude'),
        A_FLOOR_CODEX: path.join(INPUTS, 'floor.codex'), A_NODE: process.execPath, A_PHASE: r.phase },
    });
    runs.push({ run: r.label || (r.phase + (r.mode && r.phase === 'merge' ? ' ' + r.mode : '')), code: p.status, stdout: norm(p.stdout), stderr: norm(p.stderr), tree: tree(d.H, norm) });
  }
  return runs;
}

/** @type {Array<{ name: string, stream: string, pattern: string | null, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');

/**
 * Each expected difference that names a pattern, applied to a transcript from either side: the matching
 * lines are removed or rewritten, so everything around them is still compared.
 * @param {Array<{ run: string, code: number | null, stdout: string, stderr: string, tree: unknown }>} runs
 */
function intended(runs) {
  const rules = expected.filter((e) => e.pattern).map((e) => ({ re: new RegExp(/** @type {string} */ (e.pattern)), stream: e.stream }));
  const strip = (/** @type {string} */ text, /** @type {string} */ stream) => text.split('\n')
    .filter((l) => !rules.some((x) => x.stream === stream && x.re.test(l))).join('\n');
  return runs.map((r) => ({ ...r, stdout: strip(r.stdout, 'stdout'), stderr: strip(r.stderr, 'stderr') }));
}

// CI sets MHW_S20_LIVE_REQUIRED=1 in its S20 step: there, a base that still merges with jq and cannot be
// run (no base, not readable, no jq) is a failure, not a skip.
const LIVE_REQUIRED = process.env.MHW_S20_LIVE_REQUIRED === '1';

/** @param {import('node:test').TestContext} t @param {string} why */
function skipOrFail(t, why) {
  if (LIVE_REQUIRED) assert.fail('MHW_S20_LIVE_REQUIRED=1: ' + why);
  t.skip(why);
}

/** The golden a scenario's Node side is held to: the shell's, or its own for a declared one. @param {import('./settings-merge-cases.js').Scenario} sc */
const nodeGolden = (sc) => 'transcripts/' + sc.name + (sc.declared ? '.node.json' : '.json');

test('golden: the Node steps, through install.sh, match the transcripts recorded from the jq programs', { skip: (!POSIX && 'POSIX only') || (UPDATE && 'MHW_UPDATE_GOLDEN=1') }, () => {
  const failed = [];
  for (const sc of SCENARIOS) {
    try {
      assert.deepEqual(hunksAsSets(intended(runScenario(sc, ROOT))), hunksAsSets(intended(readGolden(SLICE, nodeGolden(sc)))), sc.name);
    } catch (e) {
      failed.push(e instanceof Error ? e.message : String(e));
    }
  }
  assert.deepEqual(failed, []);
});

test('declared: each declared scenario refuses visibly and leaves settings.json as it was', { skip: !POSIX && 'POSIX only' }, () => {
  for (const sc of SCENARIOS.filter((s) => s.declared)) {
    /** @type {Array<{ run: string, code: number, stdout: string, stderr: string, tree: Array<{ path: string, data: string }> }>} */
    const node = readGolden(SLICE, nodeGolden(sc));
    /** @type {Array<{ stdout: string, tree: Array<{ path: string, data: string }> }>} */
    const shell = readGolden(SLICE, 'transcripts/' + sc.name + '.json');
    const text = /** @type {{ text: string }} */ ((sc.setup || [])[0]).text;
    for (const r of node) {
      if (r.run === 'report') continue;
      assert.equal(r.code, 3, sc.name + ' ' + r.run);
      assert.match(r.stderr, /^REFUSE  <T>\/home\/\.claude\/settings\.json: not (readable by the settings merge|a readable JSON object of the expected shape)/m, sc.name + ' ' + r.run);
      const settings = r.tree.find((e) => e.path === '.claude/settings.json');
      assert.equal(settings && settings.data, text, sc.name + ' ' + r.run);
    }
    // The record of what the shell did instead, on the machine the goldens were recorded on.
    const acted = shell.some((r) => /^(DRIFT|WOULD|MERGED|UNMERGED|OK) /m.test(r.stdout));
    assert.equal(acted, sc.shellActs !== false, sc.name);
  }
});

test('live: the Node steps match the base revision\'s jq programs on the same inputs', (t) => {
  if (!POSIX) return t.skip('POSIX only');
  const rev = baseRevision(ROOT);
  const base = path.join(freshDir('base'), 'tree');
  if (!rev) return skipOrFail(t, 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)');
  if (!extractRevision(ROOT, rev, base)) return skipOrFail(t, 'base revision ' + rev + ' is not readable here');
  if (!fs.readFileSync(path.join(base, 'global', 'install.sh'), 'utf8').includes(BASE_MARKER)) {
    return t.skip('the base revision merges settings.json without jq (this slice has merged)');
  }
  if (!which('jq')) return skipOrFail(t, 'jq is not on PATH; the base revision needs it');
  const failed = [];
  for (const sc of SCENARIOS) {
    const shell = intended(runScenario(sc, base));
    if (UPDATE) writeGolden(SLICE, 'transcripts/' + sc.name + '.json', shell);
    const node = intended(runScenario(sc, ROOT));
    // A declared scenario's Node side is its own golden (written here from the Node side, the one
    // exception, since no shell transcript can be its reference).
    if (UPDATE && sc.declared) writeGolden(SLICE, nodeGolden(sc), node);
    try {
      if (sc.declared) assert.deepEqual(node, intended(readGolden(SLICE, nodeGolden(sc))), sc.name);
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
