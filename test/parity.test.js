// S01 parity (convention 3 of #470): the head's mhw against the original, on throwaway HOMEs.
//   golden: the head against the original's committed transcripts (always runs).
//   live:   the head against the base revision itself, extracted with git archive (runs where git can
//           read the base commit; CI fetches full history for it).
// The live base is derived at run time (parityBase below), never pinned. MHW_UPDATE_GOLDEN=1 rewrites
// the golden files from that base revision, never from the head.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { transcript, withoutExpected, differences, extractRevision, copyWorkingTree } from './helpers/parity.js';
import { readGolden, writeGolden, UPDATE } from './helpers/golden.js';
import { which } from './helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SLICE = 'S01';
const spec = readGolden(SLICE, 'cases.json');
const expected = readGolden(SLICE, 'expected-differences.json');
/** @type {Array<import('./helpers/parity.js').Case & { posix?: boolean, golden?: boolean }>} */
const cases = spec.cases.filter((/** @type {{ posix?: boolean, golden?: boolean }} */ c) => !c.posix || process.platform !== 'win32');

// The head runs from a copy of this working tree with no .git beside it, as the base revision does:
// both sides then answer as an installed package, and nothing here can check out a tag in the checkout.
const headDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-parity-head-'));
const HEAD = path.join(headDir, 'tree');
copyWorkingTree(ROOT, HEAD);
after(() => fs.rmSync(headDir, { recursive: true, force: true }));

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

/**
 * The revision the head is compared with, derived at run time so it is always the tree this change
 * lands on: MHW_PARITY_BASE when set; else the merge-base of HEAD with the integration branch
 * (origin/<GITHUB_BASE_REF>, default origin/rc/next), which on CI's merge ref is that branch's tip;
 * else HEAD^1 when HEAD is a merge commit. A pinned commit went stale as soon as rc/next moved.
 * @returns {string | null}
 */
function parityBase() {
  if (process.env.MHW_PARITY_BASE) return process.env.MHW_PARITY_BASE;
  const git = which('git');
  if (!git) return null;
  /** @param {string[]} args */
  const out = (args) => {
    const p = spawnSync(git, ['-C', ROOT, ...args], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : null;
  };
  const branch = 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next');
  const mb = out(['merge-base', 'HEAD', branch]);
  if (mb) return mb;
  const parents = (out(['rev-list', '--parents', '-n', '1', 'HEAD']) || '').split(' ');
  return parents.length > 2 ? parents[1] : null;
}

/** @returns {string | null} the extracted base tree, or null when it cannot be read here */
function baseTree() {
  const base = parityBase();
  if (!base) return null;
  const dest = fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-parity-base-'));
  if (!extractRevision(ROOT, base, path.join(dest, 'tree'))) {
    fs.rmSync(dest, { recursive: true, force: true });
    return null;
  }
  return path.join(dest, 'tree');
}

test('every expected difference names a case and is a valid pattern', () => {
  const names = new Set(spec.cases.map((/** @type {{ name: string }} */ c) => c.name));
  for (const e of expected) {
    assert.ok(e.case === '*' || names.has(e.case), 'unknown case ' + e.case);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
    assert.doesNotThrow(() => new RegExp(e.pattern));
  }
});

test('golden: the head matches the original transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, () => {
  const diffs = [];
  for (const c of cases.filter((x) => x.golden !== false)) {
    const golden = readGolden(SLICE, goldenName(c.name));
    diffs.push(...differences(golden, withoutExpected(transcript(HEAD, c), expected)));
  }
  assert.deepEqual(diffs, []);
});

test('live: the head matches the base revision run on its own throwaway HOMEs', (t) => {
  const base = baseTree();
  if (!base) {
    t.skip('no base revision is readable here (MHW_PARITY_BASE unset, no origin/rc/next merge-base, HEAD not a merge; or a shallow clone, or no git/tar)');
    return;
  }
  try {
    const diffs = [];
    for (const c of cases) {
      const original = transcript(base, c);
      // The base tree and the head tree sit at different paths; transcript() replaced each with <ROOT>.
      if (UPDATE && c.golden !== false) writeGolden(SLICE, goldenName(c.name), original);
      diffs.push(...differences(original, withoutExpected(transcript(HEAD, c), expected)));
    }
    assert.deepEqual(diffs, []);
  } finally {
    fs.rmSync(path.dirname(base), { recursive: true, force: true });
  }
});

test('the expected difference is real: status adds exactly one NODE line', () => {
  const c = cases.find((x) => x.name === 'windows-status-relative-powershell');
  assert.ok(c);
  const head = transcript(HEAD, c);
  const golden = readGolden(SLICE, goldenName(c.name));
  const added = head.stdout.split('\n').filter((l) => !golden.stdout.split('\n').includes(l));
  assert.equal(added.length, 1, head.stdout);
  assert.match(added[0], /^NODE    /);
});
