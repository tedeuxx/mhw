// The funnel-review rite (#401; #599, CLI native baseline PRD section 5). `mhw funnel-review`, its S07
// goldens, its fixtures and its store contract left with #599: the driver computes the figures itself,
// each citing its source line, and the owner accepted losing byte-for-byte determinism there (2026-11-23:
// «Aceito, com fonte»). What is left to check is TEXT: that the skill carries the procedure the command
// ran, its two report templates and the collection file's shape. These assert the rules are WRITTEN,
// never that a session followed them. Every value is synthetic.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RITE = path.join(ROOT, 'method', 'skills', 'funnel-review', 'SKILL.md');
const PLANNING = path.join(ROOT, 'method', 'skills', 'sprint-planning', 'SKILL.md');
const CAP = 2;
// Read with LF line ends: a Windows checkout writes CRLF (core.autocrlf).
const read = (/** @type {string} */ f) => fs.readFileSync(f, 'utf8').replaceAll('\r\n', '\n');
const rite = read(RITE);
/** The skill's text with line breaks and their indentation folded to one space. */
const flat = rite.replace(/\n[ \t]*/g, ' ');
/** @param {string} text */
const lines = (text) => text.split('\n');

/** The fenced block right after a bold label in the report section. @param {string} label */
function template(label) {
  const section = rite.slice(rite.indexOf('### The report — two templates, one per state'));
  const m = new RegExp('\\*\\*' + label + '\\*\\*[^\\n]*\\n\\n```\\n([\\s\\S]*?)```').exec(section);
  assert.ok(m, 'no ' + label + ' template');
  return m[1];
}

test('the two templates: each carries its own literal at column 0 and not the other, and the cap', () => {
  const nc = template('NOT-COLLECTED');
  const ran = template('RAN');
  assert.deepEqual(lines(nc).filter((l) => /^FUNNEL-REVIEW-/.test(l)), ['FUNNEL-REVIEW-NOT-COLLECTED']);
  assert.deepEqual(lines(ran).filter((l) => /^FUNNEL-REVIEW-/.test(l)), ['FUNNEL-REVIEW-RAN']);
  assert.ok(!nc.includes('FUNNEL-REVIEW-RAN') && !ran.includes('FUNNEL-REVIEW-NOT-COLLECTED'));
  // No findings section at all when nothing was read; one when the surfaces were read.
  assert.ok(!nc.includes('## Findings'));
  assert.ok(lines(ran).includes('## Findings'));
  for (const t of [nc, ran]) assert.ok(lines(t).includes('cap: ' + CAP + ' findings, the ceiling and not a quota'));
  assert.ok(flat.includes('**The cap is two findings**'));
});

test('every figure cites its source line, and a derived figure names every line it used', () => {
  assert.ok(rite.includes('· source: collected/<period>.tsv line <L>'));
  assert.ok(flat.includes('**`source:` is the line number in the committed collection file**'));
  assert.ok(flat.includes('A figure with no source line is not written.'));
  assert.ok(flat.includes('`derived from collected/<period>.tsv lines <L1>, <L2>`'));
  assert.ok(flat.includes('«Aceito, com fonte»'));
});

test('the state turns on the collected: line only', () => {
  for (const phrase of ['No collection file at that path, a file with no column-0 `collected:` line, or one that says neither `yes` nor `no` → **NOT-COLLECTED**',
    '`collected: no …` → **NOT-COLLECTED**', '`collected: yes …` → **RAN**']) assert.ok(flat.includes(phrase), phrase);
});

test('the ceilings: the four known surfaces keep their clause, any other surface is UNDECLARED', () => {
  assert.ok(flat.includes('`ga4`, `site`: `consent-ceiling: consenting sessions only'));
  assert.ok(flat.includes('`linkedin`, `x`: `consent-ceiling: does not apply to <surface>'));
  assert.ok(flat.includes('anything else: `consent-ceiling: UNDECLARED for surface <surface>'));
  assert.ok(flat.includes('`locale-caveat: a link pinned to one language sets this value by the link, not by the reader`'));
});

test('the baseline lookup is literal, and an unusable line is quoted, never a figure', () => {
  assert.ok(flat.includes('**the same surface and the same metric, compared as plain strings**'));
  for (const s of ['`not measured in <prior>`', '`no prior period on record`', '**A `figure:` line with fewer than four fields, or a sample size that is not digits, is UNUSABLE**']) {
    assert.ok(flat.includes(s), s);
  }
});

test('the collection file: its shape is in the skill, and no installed contract is named', () => {
  for (const lit of ['collected: yes <date> <provenance>', 'collected: no  <reason>',
    'internal-traffic: <none|testing-excluded-by-query|active> <effective-date> <how>', 'figure: <surface> <metric> <value> <sample-size>']) {
    assert.ok(rite.includes(lit), lit);
  }
  for (const s of ['`<metric>:<piece>:<language>`', '`<metric>.<format>.<post>`', '**`<sample-size>` is mandatory and is digits only.**']) assert.ok(flat.includes(s), s);
  assert.ok(!/\{\{method-scripts\}\}\//.test(rite), 'the rite names an installed document');
  assert.ok(!rite.includes('docs/funnel-review/README' + '.md'));
});

test('the command, its fixtures and its contract are gone, and the word is unknown to the CLI', () => {
  for (const f of ['src/commands/funnel-review.js', 'method/scripts/funnel-review-contract', 'method/scripts/fixtures/funnel-review', 'test/golden/S07']) {
    assert.ok(!fs.existsSync(path.join(ROOT, ...f.split('/'))), f + ' still exists');
  }
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'funnel-review', 'sprint-01'], { encoding: 'utf8' });
  assert.equal(p.status, 2);
  assert.equal(p.stdout, '');
  // Every live mention of the command is marked as history.
  const live = lines(rite).filter((l) => l.includes('mhw funnel-review') && !/~~|until mhw#599|left the CLI|mhw#599|in place of/.test(l));
  assert.deepEqual(live, []);
});

test('cap: no landed report under method/docs/funnel-review exceeds it', () => {
  // mhw holds no store there, so this loop is vacuous here; a consumer repository's landed reports are
  // not in this tree.
  const store = path.join(ROOT, 'method', 'docs', 'funnel-review');
  if (fs.existsSync(store)) {
    for (const f of fs.readdirSync(store)) {
      if (!f.endsWith('.md') || f === 'README.md') continue;
      const n = lines(read(path.join(store, f))).filter((l) => /^## Finding( |$)/.test(l)).length;
      assert.ok(n <= CAP, f + ' carries ' + n + ' findings');
    }
  }
});

test('no verdict: the rite declares no verdict literal and no decision field', () => {
  // Spelled in halves so this file does not carry the literals it forbids elsewhere.
  const lits = ['APPROVE-AND-' + 'MERGE', 'APPROVE-PENDING-' + 'HUMAN', 'APPROVE-EXECUTOR-' + 'BLOCKED', 'REQUEST-' + 'CHANGES',
    'gatekeeper-' + 'verdict', 'harness-lead-' + 'verdict', 'CONTENT-REVIEW-' + 'CLEAR', 'permission' + 'Decision'];
  for (const lit of lits) assert.ok(!rite.includes(lit), 'the rite carries ' + lit);
  assert.ok(!/^[ \t]*(decision|"decision")[ \t]*[:=]/m.test(rite), 'the rite declares a decision field');
});

test('candidate queue: the templates hold no column-0 candidate; the published selector finds one in a report', () => {
  const sel = '^(Candidate rule|Evidence|Ruled):';
  const re = new RegExp(sel);
  for (const t of [template('NOT-COLLECTED'), template('RAN')]) assert.equal(lines(t).filter((l) => re.test(l)).length, 0);
  const report = template('RAN') + 'Candidate rule: probe\nEvidence: figure: ga4 sessions 10 10\n';
  assert.equal(lines(report).filter((l) => re.test(l)).length, 2);
  const pub = "grep -nE '" + sel + "' docs/funnel-review/*.md";
  for (const doc of [RITE, PLANNING]) assert.ok(read(doc).includes(pub), path.relative(ROOT, doc) + ' does not publish the selector verbatim');
});
