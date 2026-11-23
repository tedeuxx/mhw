// The semver-label check's guidance (#587): when a pull request into main carries not exactly one
// semver label, the workflow prints the three rows of ADR-0002's current cut table. This test reads the
// table from the ADR's 2026-11-23 amendment and the lines from .github/workflows/semver-label.yml, both
// as text (no YAML or Markdown library), and fails when either drifts from the other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (/** @type {string} */ rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const ADR = read('docs/adr/0002-automatic-semver-cut-policy.md');
const YAML = read('.github/workflows/semver-label.yml');
/** The workflow without its comment lines, so a comment never satisfies an assertion. */
const CODE = YAML.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

const PARTS = ['major', 'minor', 'patch'];

/** The unstruck rows of the cut table in the 2026-11-23 amendment, as [part, text] pairs. */
function adrRows() {
  const start = ADR.indexOf('\n## Amendment 2026-11-23');
  assert.ok(start >= 0, 'ADR-0002 carries the 2026-11-23 amendment');
  const next = ADR.indexOf('\n## ', start + 1);
  const section = ADR.slice(start, next < 0 ? undefined : next);
  const table = section.indexOf('\n### Cut policy');
  assert.ok(table >= 0, 'the amendment carries a "Cut policy" table');
  return [...section.slice(table).matchAll(/^\| \*\*(major|minor|patch)\*\* \| (.+?) \|$/gm)].map((m) => [m[1], m[2]]);
}

/** The guidance lines the workflow prints, as [part, text] pairs. */
function workflowRows() {
  return [...CODE.matchAll(/^\s*echo 'semver:(major|minor|patch): (.+)'$/gm)].map((m) => [m[1], m[2]]);
}

test('the ADR amendment has exactly the three rows, in order, with plain text the shell can print', () => {
  const rows = adrRows();
  assert.deepEqual(rows.map((r) => r[0]), PARTS);
  for (const [part, text] of rows) {
    assert.doesNotMatch(text, /['`$~*]/, `${part}: no quote, backtick, $, strike or emphasis in the cell`);
  }
});

test('the label check prints the same three rows as the ADR table', () => {
  assert.deepEqual(workflowRows(), adrRows());
});

test('the rows are printed on the failure path, between the error and the exit', () => {
  const err = CODE.indexOf('echo "::error::expected exactly one semver:major|minor|patch label');
  assert.ok(err >= 0, 'the error line');
  const exit = CODE.indexOf('exit 1', err);
  assert.ok(exit > err, 'an exit 1 after the error');
  const between = CODE.slice(err, exit);
  for (const part of PARTS) assert.match(between, new RegExp(`echo 'semver:${part}: `), part);
  assert.match(between, /ADR-0002, 2026-11-23 amendment/);
});
