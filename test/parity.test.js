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
// A case with "retired" (#497) tests a behaviour a later slice removed; it is kept in cases.json, with the
// reason, and runs in neither arm.
const cases = spec.cases.filter((/** @type {{ posix?: boolean, retired?: string }} */ c) => (!c.posix || process.platform !== 'win32') && !c.retired);

/**
 * The original's transcript with each "replace" entry applied (#497): a line the head prints differently,
 * by declaration, is rewritten on the original's side to what the head prints, so the new text is still
 * compared. The other streams of entries only remove lines the head added (withoutExpected).
 * @param {any} original @param {Array<{ case: string, stream: string, pattern: string, replace?: string }>} rules
 */
function replaced(original, rules) {
  const out = { ...original };
  for (const e of rules) {
    if (e.replace === undefined || (e.case !== '*' && e.case !== original.name)) continue;
    if (e.stream === 'stdout' || e.stream === 'stderr') out[e.stream] = out[e.stream].replace(new RegExp(e.pattern, 'gm'), e.replace);
  }
  return out;
}
/** The entries withoutExpected applies: every one but a "replace". @param {any[]} rules */
const removals = (rules) => rules.filter((e) => e.replace === undefined);

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
    diffs.push(...differences(replaced(golden, expected), withoutExpected(transcript(HEAD, c), removals(expected))));
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
    // An entry with whenBaseHas applies only while the base tree still holds that file, so it expires on
    // its own once the change that needed it has merged (#475).
    // whenBaseLacks (#588) is the mirror: it applies only while the base does not hold that file yet, so it
    // expires once the change that added it has merged.
    const live = expected.filter((/** @type {{ whenBaseHas?: string, whenBaseLacks?: string }} */ e) => (!e.whenBaseHas || fs.existsSync(path.join(base, e.whenBaseHas)))
      && (!e.whenBaseLacks || !fs.existsSync(path.join(base, e.whenBaseLacks))));
    const diffs = [];
    for (const c of cases) {
      const original = transcript(base, c);
      // The base tree and the head tree sit at different paths; transcript() replaced each with <ROOT>.
      if (UPDATE && c.golden !== false) writeGolden(SLICE, goldenName(c.name), original);
      // Once S01 itself is in the base (every slice after it, #473), the base prints the S01 intended
      // difference too, so it is taken out of both sides here. The golden arm above still holds it
      // against the pre-S01 transcripts.
      diffs.push(...differences(withoutExpected(replaced(original, live), removals(live)), withoutExpected(transcript(HEAD, c), removals(live))));
    }
    assert.deepEqual(diffs, []);
  } finally {
    fs.rmSync(path.dirname(base), { recursive: true, force: true });
  }
});

// The status case is retired since S27 (#497): it ran install.ps1 -Check, which is gone, so what follows the
// NODE line is now mhw install-windows --check (test/install/windows.test.js). The PASTE line S16 (#487) added
// after it left with the paste wrapper (#590).
test('the expected difference is real: status prints a NODE line first, and no PASTE line since #590', () => {
  const c = spec.cases.find((/** @type {{ name: string }} */ x) => x.name === 'windows-status-relative-powershell');
  assert.ok(c);
  const head = transcript(HEAD, c);
  const golden = readGolden(SLICE, goldenName(c.name));
  assert.equal(golden.stdout, '');
  const lines = head.stdout.split('\n');
  assert.match(lines[0], /^NODE    /);
  assert.ok(!lines.some((l) => l.startsWith('PASTE')), head.stdout);
});
