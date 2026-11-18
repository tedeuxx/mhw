// mhw delivery's gate (#474): the harness-path table, the merge command, the lens carry-forward the owner
// ruled on 2026-11-18 (red on each of its three conditions), and the Python semantics the port keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as d from '../../src/commands/delivery.js';
import { SLICE, HEAD, OLD_HEAD, gate, lens, cases } from '../helpers/delivery-cases.js';
import { inProcess } from '../helpers/delivery-run.js';
import { resolveTool } from '../../src/lib/gh.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SOURCE = fs.readFileSync(path.join(ROOT, 'src', 'commands', 'delivery.js'), 'utf8');
const MERGE_BASE = 'e'.repeat(40);

test('the harness-path predicate, table-driven: the same members as delivery.py, at any depth', () => {
  assert.deepEqual([...d.HARNESS_DIRS].sort(), ['.agents', '.claude', '.codex', '.github', '.kiro']);
  assert.deepEqual([...d.HARNESS_FILES].sort(), ['AGENTS.md', 'CLAUDE.md']);
  /** @type {Array<[string, boolean]>} */
  const table = [
    ['AGENTS.md', true], ['docs/CLAUDE.md', true], ['.github/workflows/tests.yml', true], ['.claude/x.md', true],
    ['.codex/hooks.json', true], ['.kiro/steering/a.md', true], ['.agents/skills/x/SKILL.md', true],
    ['test/golden/.github/x', true], ['a/b/AGENTS.md', true],
    ['workspace/delivery.py', false], ['docs/adr/0001-x.md', false], ['global/a.sh', false], ['docs/CLAUDE.md.bak', false],
    ['x.claude/a', false], ['AGENTS.mdx', false], ['.claude', false], ['.github', false], ['', false],
  ];
  for (const [p, harness] of table) assert.equal(d.harnessPaths([p]).length === 1, harness, p);
});

test('the merge is one real merge commit pinned to the head, spelled once in the source', () => {
  const argv = d.mergeCommand('82', 'o/r', HEAD);
  assert.deepEqual(argv.slice(0, 4), ['gh', 'pr', 'merge', '82']);
  assert.ok(argv.includes('--merge'));
  for (const banned of ['--squash', '-s', '--rebase', '-r', '--auto', '--admin']) assert.ok(!argv.includes(banned), banned);
  assert.equal(argv[argv.indexOf('--match-head-commit') + 1], HEAD);
  assert.equal(SOURCE.split("'pr', 'merge'").length - 1, 1);
  assert.ok(!SOURCE.includes("'--squash'"));
  assert.deepEqual(d.MERGE_LITERALS, ['APPROVE-AND-MERGE']);
  assert.deepEqual(d.RETIRED_LITERALS, ['APPROVE-AND-MERGE-BOUNDARY']);
});

/**
 * A slice merge on a harness path whose newest lens marker is CLOSED at OLD_HEAD; knobs set the history.
 * @param {{ ancestor?: number, markerBase?: string | string[], headBase?: string | string[], delta?: string[],
 *   closed?: boolean, later?: Array<{ authorAssociation: string, body: string }> }} o
 */
function carried(o) {
  const c = cases().find((x) => x.name === 'harness-lens-closed-merges');
  assert.ok(c);
  return inProcess({ ...c, scenario: {
    ...c.scenario,
    pr: { ...c.scenario.pr, comments: [gate(), lens({ commit: OLD_HEAD, closed: o.closed ?? true }), ...(o.later || [])] },
    ancestors: o.ancestor === undefined ? { [OLD_HEAD]: 0 } : { [OLD_HEAD]: o.ancestor },
    mergeBases: { [OLD_HEAD]: o.markerBase ?? MERGE_BASE, [HEAD]: o.headBase ?? MERGE_BASE },
    deltas: { [OLD_HEAD]: o.delta ?? ['src/commands/delivery.js', 'docs/x.md'] },
  } });
}

/** @param {{ calls: string[][] }} r */
const merged = (r) => r.calls.some((c) => c[1] === 'pr' && c[2] === 'merge');

test('carry-forward: a CLOSED lens at an earlier head merges when (a), (b) and (c) all hold', () => {
  const r = carried({});
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^MERGED: /);
  assert.deepEqual(r.calls.filter((c) => c[1] === 'merge-base' || (c[1] === 'diff' && c.length === 7)), [
    ['git', 'merge-base', '--is-ancestor', OLD_HEAD, HEAD],
    ['git', 'merge-base', '--all', 'origin/rc/next', OLD_HEAD],
    ['git', 'merge-base', '--all', 'origin/rc/next', HEAD],
    ['git', 'diff', '--no-renames', '--name-only', '-z', OLD_HEAD, HEAD],
  ]);
});

// Lens round 1 on PR #508, finding 1: git quotes a non-ASCII path ("...\303\251..."), so its first
// component no longer reads .github. Both diffs run with -z, which quotes nothing; a path that still
// starts with a double quote counts as a harness path, failing closed.
const QUOTED = '".github/workflows/d\\303\\251.yml"';

test('both diffs run with -z, so git never quotes a path the gate reads', () => {
  const r = carried({});
  const diffs = r.calls.filter((c) => c[1] === 'diff');
  assert.equal(diffs.length, 2);
  for (const c of diffs) assert.ok(c.includes('-z'), c.join(' '));
});

test('the hold-2 trigger counts a quoted path as a harness path', () => {
  assert.deepEqual(d.harnessPaths([QUOTED, '"docs/x y.md"']), [QUOTED, '"docs/x y.md"']);
  const c = cases().find((x) => x.name === 'slice-merge-is-a-pinned-merge-commit');
  assert.ok(c);
  const r = inProcess({ ...c, scenario: { ...c.scenario, changed: ['docs/x.md', QUOTED] } });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'PENDING: harness paths changed and no agents-lead lens marker is on the PR\n');
  assert.ok(!merged(r));
});

test('a NUL-separated diff with a non-ASCII harness path triggers hold 2', () => {
  const c = cases().find((x) => x.name === 'slice-merge-is-a-pinned-merge-commit');
  assert.ok(c);
  const r = inProcess({ ...c, scenario: { ...c.scenario, changed: ['docs/x.md', '.github/workflows/dé.yml'] } });
  assert.equal(r.code, 1);
  assert.ok(!merged(r));
});

test('carry-forward is red on (c) for a quoted harness path in the delta', () => {
  const r = carried({ delta: ['src/x.js', QUOTED] });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\(c\) the delta since its commit touches a harness path: "\.github/);
  assert.ok(!merged(r));
});

// Lens round 1 on PR #508, finding 2: a newer marker whose envelope is not on line 1 must still be the
// newest marker; it is then refused for its format, so it withdraws the older CLOSED one.
test('a newer OPEN marker with a preamble withdraws an older CLOSED one', () => {
  const preamble = { authorAssociation: 'OWNER', body: 'Round 2 below.\n<!-- harness-lead-verdict: blocking -->\ncommit: ' + HEAD + '\nthe lens is OPEN' };
  const r = carried({ later: [preamble] });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'PENDING: the newest agents-lead lens marker is not in the strict header format\n');
  assert.ok(!merged(r));
  // Still not a marker: one quoted inside a fence, one indented, one in a gate verdict.
  for (const body of ['context:\n```\n<!-- harness-lead-verdict: x -->\ncommit: ' + HEAD + '\nthe lens is OPEN\n```',
    '    <!-- harness-lead-verdict: x -->', gate().body + '\n<!-- harness-lead-verdict: x -->\ncommit: ' + HEAD + '\nthe lens is OPEN']) {
    const ok = carried({ later: [{ authorAssociation: 'OWNER', body }] });
    assert.equal(ok.code, 0, body + ': ' + ok.stderr);
  }
});

test('limb (b) compares the merge-base --all sets, in any order', () => {
  const two = ['1'.repeat(40), '2'.repeat(40)];
  assert.equal(carried({ markerBase: two, headBase: [...two].reverse() }).code, 0);
  const r = carried({ markerBase: two, headBase: [two[0]] });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\(b\) the merge-base with rc\/next moved/);
});

test('carry-forward is red on (a): the marker commit is not an ancestor, or cannot be read', () => {
  for (const [ancestor, why] of /** @type {Array<[number, RegExp]>} */ ([[1, /\(a\) its commit is not an ancestor/], [128, /\(a\) its commit cannot be read/]])) {
    const r = carried({ ancestor });
    assert.equal(r.code, 1);
    assert.match(r.stderr, why);
    assert.ok(!r.calls.some((c) => c[2] === 'merge'), 'no merge');
  }
});

test('carry-forward is red on (b): the merge-base with rc/next moved since the marker', () => {
  const r = carried({ markerBase: 'f'.repeat(40) });
  assert.equal(r.code, 1);
  assert.match(r.stderr, /\(b\) the merge-base with rc\/next moved/);
  assert.ok(!r.calls.some((c) => c[2] === 'merge'));
});

test('carry-forward is red on (c): the delta since the marker touches a harness path', () => {
  for (const p of ['.github/workflows/tests.yml', 'AGENTS.md', 'method/.agents/x', '.kiro/steering/a.md']) {
    const r = carried({ delta: ['src/x.js', p] });
    assert.equal(r.code, 1, p);
    assert.match(r.stderr, new RegExp('\\(c\\) the delta since its commit touches a harness path: ' + p.replace(/\./g, '\\.')));
    assert.ok(!r.calls.some((c) => c[2] === 'merge'));
  }
});

test('an OPEN lens at an earlier head never carries forward, and asks git nothing', () => {
  const r = carried({ closed: false });
  assert.equal(r.code, 1);
  assert.equal(r.stderr, 'PENDING: the newest agents-lead lens marker does not name the current head\n');
  assert.ok(!r.calls.some((c) => c[1] === 'merge-base'));
});

test('a non-harness slice reads no lens and asks git nothing about one', () => {
  const r = inProcess(/** @type {any} */ (cases().find((x) => x.name === 'slice-merge-is-a-pinned-merge-commit')));
  assert.equal(r.code, 0);
  assert.ok(!r.calls.some((c) => c[1] === 'merge-base'));
  assert.equal(SLICE.headRefOid, HEAD);
});

test('Python semantics kept where gh data could make JavaScript differ', () => {
  assert.equal(d.truthy([]), false);
  assert.equal(d.truthy({}), false);
  assert.equal(d.truthy('0'), true);
  assert.equal(d.strip('\x85 x 　'), 'x');
  assert.equal(d.strip('﻿x'), '﻿x', 'BOM is not Python whitespace');
  assert.equal(d.pyDumps({ a: 'é', b: null, c: [1, true] }), '{"a": "\\u00e9", "b": null, "c": [1, true]}');
  assert.equal(d.currentVersion('x = 1\ncurrent_version = "1.2.3"\n'), '1.2.3');
  assert.equal(d.currentVersion('#current_version = "1.2.3"'), null);
  assert.equal(d.currentVersion('current_version\n=\n"4.5.6"'), '4.5.6', "Python's \\s crosses a line break");
  // owner-check: a value ending in a non-breaking space is malformed, as in Python; one ending in a BOM is not.
  const at = (/** @type {string} */ oc) => () => d.gateApproves([gate({ ownerCheck: oc })], HEAD);
  assert.throws(at('owner-check: none '), d.Pending);
  assert.doesNotThrow(at('owner-check: none﻿'));
  assert.deepEqual(d.parseArgs(['merge', '--pr', '+0_7']), { action: 'merge', pr: 7n });
  assert.deepEqual(d.parseArgs(['--pr=7', 'verify']), { action: 'verify', pr: 7n });
  assert.ok('error' in d.parseArgs(['merge', '--pr', '٧']), 'a non-ASCII digit is refused (stricter than Python)');
});

test('gh and git are found on PATH as one absolute file; a relative PATH entry is never used', () => {
  // Inside the checkout, beside the current directory: on Windows the system temporary directory can sit
  // on another drive, where path.relative returns an absolute path (QA B1 on PR #508).
  const dir = fs.mkdtempSync(path.join(process.cwd(), '.tmp-mhw-tool-'));
  try {
    const exe = path.join(dir, process.platform === 'win32' ? 'gh.exe' : 'gh');
    fs.writeFileSync(exe, '');
    fs.chmodSync(exe, 0o700);
    const sep = process.platform === 'win32' ? ';' : ':';
    assert.equal(resolveTool('gh', { PATH: dir }, process.platform), exe);
    const relative = path.relative(process.cwd(), dir);
    assert.ok(!path.isAbsolute(relative), relative);
    assert.ok(fs.existsSync(path.join(relative, path.basename(exe))), 'the relative entry names the file from here');
    assert.equal(resolveTool('gh', { PATH: relative + sep }, process.platform), null);
    if (process.platform !== 'win32') {
      fs.chmodSync(exe, 0o644);
      assert.equal(resolveTool('gh', { PATH: dir }, process.platform), null, 'not executable');
    }
    fs.writeFileSync(path.join(dir, 'git.cmd'), '');
    assert.equal(resolveTool('git', { PATH: dir }, 'win32'), null, 'a .cmd is not run');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('outside a checkout, and with a tool missing, the route refuses and merges nothing', () => {
  const c = /** @type {any} */ (cases().find((x) => x.name === 'slice-merge-is-a-pinned-merge-commit'));
  const outside = d.delivery(c.args, { cwd: path.parse(ROOT).root, exec: () => ({ code: 0, stdout: '', stderr: '' }) });
  assert.equal(outside.code, 1);
  assert.equal(outside.stderr, 'PENDING: run this from a git checkout of the repository\n');
  const missing = d.delivery(c.args, { cwd: ROOT, env: { PATH: '' }, platform: process.platform });
  assert.equal(missing.code, 1);
  assert.equal(missing.stderr, 'PENDING: verification unavailable; details omitted\n');
});
