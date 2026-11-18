// mhw delivery's gate (#474): the harness-path table, the merge command, the lens carry-forward the owner
// ruled on 2026-11-18 (red on each of its three conditions), and the Python semantics the port keeps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
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
 * @param {{ ancestor?: number, markerBase?: string, delta?: string[], closed?: boolean }} o
 */
function carried(o) {
  const c = cases().find((x) => x.name === 'harness-lens-closed-merges');
  assert.ok(c);
  return inProcess({ ...c, scenario: {
    ...c.scenario,
    pr: { ...c.scenario.pr, comments: [gate(), lens({ commit: OLD_HEAD, closed: o.closed ?? true })] },
    ancestors: o.ancestor === undefined ? { [OLD_HEAD]: 0 } : { [OLD_HEAD]: o.ancestor },
    mergeBases: { [OLD_HEAD]: o.markerBase ?? MERGE_BASE, [HEAD]: MERGE_BASE },
    deltas: { [OLD_HEAD]: o.delta ?? ['src/commands/delivery.js', 'docs/x.md'] },
  } });
}

test('carry-forward: a CLOSED lens at an earlier head merges when (a), (b) and (c) all hold', () => {
  const r = carried({});
  assert.equal(r.code, 0, r.stderr);
  assert.match(r.stdout, /^MERGED: /);
  assert.deepEqual(r.calls.filter((c) => c[1] === 'merge-base' || (c[1] === 'diff' && c.length === 6)), [
    ['git', 'merge-base', '--is-ancestor', OLD_HEAD, HEAD],
    ['git', 'merge-base', 'origin/rc/next', OLD_HEAD],
    ['git', 'merge-base', 'origin/rc/next', HEAD],
    ['git', 'diff', '--no-renames', '--name-only', OLD_HEAD, HEAD],
  ]);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-test-tool-'));
  try {
    const exe = path.join(dir, process.platform === 'win32' ? 'gh.exe' : 'gh');
    fs.writeFileSync(exe, '');
    fs.chmodSync(exe, 0o755);
    const sep = process.platform === 'win32' ? ';' : ':';
    assert.equal(resolveTool('gh', { PATH: dir }, process.platform), exe);
    assert.equal(resolveTool('gh', { PATH: path.relative(process.cwd(), dir) + sep }, process.platform), null);
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
