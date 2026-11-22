// S23 parity of the live-prose reading (#494, convention 3 of #470): the Issue's main risk is that the
// exclusions of merge_authority.py (struck spans, fences, blockquotes, comments, quotes) are regex work, and
// a port that excludes less produces false findings while one that excludes more fails open. This holds the
// Node reading (src/lib/merge-authority.js) to the Python one over a corpus: the method's four operational
// copies as they stood at the recording base (frozen under test/golden/S23/inputs/consumers/), each with
// planted phrases, and synthetic edge cases for the Unicode word boundaries, case folding, whitespace and
// fence forms. SYNTHETIC text only.
//   golden: the Node answers against test/golden/S23/prose.json, recorded from the base's merge_authority.py.
//   The golden is frozen: the live arm and its recorder (test/helpers/s23-prose.py) were deleted by #502
//           (S32 of #470, one Node runtime).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { readGolden, goldenPath, UPDATE } from '../helpers/golden.js';
import * as ma from '../../src/lib/merge-authority.js';
import { BLOCK, CORRECTED_SECTION, HISTORY, LEGACY_SECTION, RC_BRIEF } from './briefs.js';

const SLICE = 'S23';

const CONTRACT_TEXT = fs.readFileSync(goldenPath(SLICE, 'inputs/merge-authority-SKILL.md'), 'utf8');
const CONSUMERS = fs.readdirSync(goldenPath(SLICE, 'inputs/consumers')).sort().map((f) => fs.readFileSync(goldenPath(SLICE, 'inputs/consumers/' + f), 'utf8'));

const PLANTS = [
  'The gate escalates the **boundary class** to the owner.',
  'Boundary class merges under `APPROVE-AND-MERGE-BOUNDARY` again.',
  'Where a platform skill and this file disagree, this file wins.',
  'The boundary class is handed up. It never merges the boundary.',
  '```\nThe gate escalates the boundary class.\n```',
  '> The gate escalates the boundary class.',
  '~~The gate escalates the boundary class.~~',
  '«The gate escalates the boundary class.»',
  '“The gate escalates the boundary class.”',
  '"The gate escalates the boundary class."',
  '<!-- The gate escalates the boundary class. -->',
];

/** Edge cases: word boundaries next to non-ASCII letters and digits, case folding, whitespace, fences. */
const EDGES = [
  'açescalates the boundary', 'escalatesé boundary', 'ESCALATES THE BOUNDARY', 'eſcalates the boundary',
  'escalates the boundary', 'escalates\tthe\nboundary', 'boundary class is Keld', 'boundary class goes to the owner',
  "the gate doesn't merge the boundary", 'never  merge   boundary', 'This File Wins.', 'this file wins about merge-authority.',
  'this file wins; merge authority stays the method\'s', 'the release candidate waits', 'release candidates', 'xrc/next and /rc/x and rc/Ok',
  'Rc/Next', 'İrc/next', 'loop model: TRUNK-single-env', 'Loop Model:   gitflow-multi-env', 'loop model: trunk', 'loop model: Krunk-x',
  '~~~\nescalates the boundary\n~~~~\nescalates the boundary', '   ````\nx\n```\nescalates the boundary\n````\nlive', '　```\nescalates the boundary\n```',
  '~~a\n\nb~~ escalates the boundary ~~c', '<!-- a --> escalates the boundary <!-- b', '"a\nescalates the boundary" "x"', '«a» escalates the boundary «b',
  '> quoted\n >quoted\n > quoted\nescalates the boundary', '**escalates** _the_ `boundary`', 'escalat́es the boundary', 'escalates the boundary x',
  BLOCK, ' ' + BLOCK, BLOCK.replace('- loop-model: trunk-single-env', '\t* loop-model : trunk-single-env '),
  BLOCK.replace('merge-authority v1', 'merge-authority v١'), BLOCK.replace('merge-authority v1', 'merge-authority  v01'),
  BLOCK.replace('merge-authority v1', 'merge-authority v9'), BLOCK.replace('- loop-model: trunk-single-env', '- Loop-Model: trunk-single-env\n- integration-branch: `rc/next`'),
  BLOCK.replace('- loop-model: trunk-single-env', '- loop-model: trunk-single-env\n- integration-branch: -bad\n- integration-branch: rc/é'),
  BLOCK.replace('- boundary-trigger: any change', '- boundary-trigger: Pending-Human review\n- boundary-trigger: go/no-go\n- boundary-trigger: a HOLD\n- boundary-trigger: any change'),
  BLOCK.replace('- boundary-trigger: any change', '- boundary-trigger: holding\n- boundary-trigger: unratified\n- boundary-trigger: merger\n- boundary-trigger: any change'),
  BLOCK.replace('- boundary-trigger: any change', '- EXECUTOR: x\n- class-a: y\n- classes: z\n- who-merges: w\n- approve: v\n- humans: u\n- boundary-trigger: any change'),
  '```\n' + BLOCK + '```\n' + BLOCK, BLOCK + BLOCK, BLOCK.replace('<!-- merge-authority:end -->', '<!-- merge-authority:end -->   '),
  BLOCK.replace('<!-- merge-authority:end -->\n', ''), '~~~\n' + BLOCK + '~~~\n', '  ```\n' + BLOCK + '\n',
];

/** Every text of the corpus, in a fixed order. */
function corpus() {
  /** @type {string[]} */
  const texts = [LEGACY_SECTION, LEGACY_SECTION + '\n' + BLOCK, CORRECTED_SECTION, CORRECTED_SECTION + HISTORY, RC_BRIEF + BLOCK, ...EDGES];
  for (const c of CONSUMERS) {
    texts.push(c);
    for (const p of PLANTS) texts.push(c + '\n\n' + p + '\n');
    // Planted above every second-level heading: a fence or strike that inverts a pairing shows here.
    const heads = [...c.matchAll(/^## /gm)].map((m) => m.index);
    for (const pos of heads.slice(0, 40)) texts.push(c.slice(0, pos) + PLANTS[0] + '\n\n' + c.slice(pos));
  }
  return texts;
}

/** @param {string} s */
const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');

/** The Node answers, shaped as test/helpers/s23-prose.py (deleted by #502) printed them. */
function nodeAnswers() {
  const contract = ma.parseContract(CONTRACT_TEXT, 'corpus');
  return {
    projection: sha(ma.projection(contract)),
    answers: corpus().map((text) => {
      const live = ma.liveProse(text);
      const blocks = ma.declarationBlocks(text);
      return {
        live: sha(live), flat: sha(ma.flatten(live)), legacy: ma.legacyFindings(text), blocks,
        declarations: blocks.map((b) => {
          if (b === null) return null;
          const d = ma.checkDeclaration(b, contract);
          return { findings: d.findings, unsupported: d.unsupported, model: d.model, branch: d.branch };
        }),
        copy: ma.methodCopyFindings(text, contract, contract.verdicts),
      };
    }),
  };
}

/** The first answers that differ, by index, for a readable failure. @param {any} want @param {any} got */
function firstDiffs(want, got) {
  assert.equal(got.projection, want.projection, 'the projection');
  assert.equal(got.answers.length, want.answers.length, 'corpus size');
  /** @type {string[]} */
  const diffs = [];
  for (const [i, a] of want.answers.entries()) {
    const b = got.answers[i];
    for (const k of Object.keys(a)) {
      if (!isDeepStrictEqual(a[k], b[k])) diffs.push('text ' + i + ' ' + k + ': python ' + JSON.stringify(a[k]).slice(0, 300) + ' | node ' + JSON.stringify(b[k]).slice(0, 300));
    }
  }
  return diffs.slice(0, 20);
}

test('the corpus plants every phrase in every copy and reaches the Unicode edges', () => {
  const texts = corpus();
  assert.ok(texts.length > 150, 'corpus size ' + texts.length);
  assert.equal(CONSUMERS.length, 4);
});

test('golden: the Node live-prose reading answers the corpus as merge_authority.py did', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, () => {
  assert.deepEqual(firstDiffs(readGolden(SLICE, 'prose.json'), nodeAnswers()), []);
});
