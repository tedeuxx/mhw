// The managed-by marker and the provenance stamp (ADR-0029), against the forms install.sh writes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MARKER_ID, isManaged, unstamp, markerLine } from '../../src/lib/marker.js';
import { formatStamp, stampOf, setStamp } from '../../src/lib/stamp.js';

const SHA = '0123456789abcdef0123456789abcdef01234567';
// A synthetic brief opening, in the shape install.sh renders it.
const BRIEF = '<!-- ' + MARKER_ID + '; source: global/AGENTS.md + overlay; release: v10.1.0; commit: ' + SHA +
  '; sha256: ' + 'a'.repeat(64) + '; do not edit, re-run the installer -->\n\n# A brief\n';

test('isManaged reads the marker in the first five lines only, as install.sh is_managed() does', () => {
  assert.equal(isManaged(BRIEF), true);
  assert.equal(isManaged('---\nfront: matter\n---\n\n<!-- ' + MARKER_ID + ' -->\n'), true);
  assert.equal(isManaged('1\n2\n3\n4\n5\n# ' + MARKER_ID + '\n'), false);
  assert.equal(isManaged('# managed-by: some-other-project\n'), false);
  assert.equal(isManaged(''), false);
});

test('unstamp drops version, release and commit from marker lines only', () => {
  const other = 'text; release: v1.0.0; commit: x; kept\n';
  const out = unstamp(BRIEF + other);
  assert.ok(!markerLine(out)?.includes('release:'));
  assert.ok(!markerLine(out)?.includes('commit:'));
  assert.ok(markerLine(out)?.includes('; sha256: '));
  assert.ok(out.endsWith(other), 'a line without the marker is untouched');
  assert.equal(unstamp('# ' + MARKER_ID + '; version: 1.2.3; source: x\n'), '# ' + MARKER_ID + '; source: x\n');
  // Two renderings that differ only in their stamp compare equal.
  assert.equal(unstamp(setStamp(BRIEF, { release: 'v9.0.0', commit: 'b'.repeat(40) })), unstamp(BRIEF));
});

test('stampOf reads the first marker line, both fields or none', () => {
  assert.deepEqual(stampOf(BRIEF), { release: 'v10.1.0', commit: SHA });
  assert.deepEqual(stampOf('# ' + MARKER_ID + '; release: unreleased, after v10.1.0; commit: ' + SHA + '-dirty; x\n'),
    { release: 'unreleased, after v10.1.0', commit: SHA + '-dirty' });
  assert.equal(stampOf('# ' + MARKER_ID + '; release: v1.0.0; x\n'), null, 'no commit field');
  assert.equal(stampOf('# ' + MARKER_ID + '; version: 3.0.0; x\n'), null, 'an older version-only line');
  assert.equal(stampOf('no marker; release: v1.0.0; commit: ' + SHA + ';\n'), null);
  // JSON carriers end the field with a quote; the quote is never part of the value.
  assert.deepEqual(stampOf('{"description": "' + MARKER_ID + '; release: v2.0.0; commit: ' + SHA + '; x"}'),
    { release: 'v2.0.0', commit: SHA });
});

test('setStamp writes the fields after source:, replacing any old ones, and round-trips', () => {
  const s = { release: 'v11.0.0', commit: 'c'.repeat(40) };
  const out = setStamp(BRIEF, s);
  assert.deepEqual(stampOf(out), s);
  assert.equal(out.split('\n').length, BRIEF.split('\n').length);
  assert.match(markerLine(out) || '', /; source: global\/AGENTS\.md \+ overlay; release: v11\.0\.0; commit: c{40}; sha256: /);
  assert.equal((markerLine(out) || '').split('release:').length, 2, 'one release field');
  const bare = '# ' + MARKER_ID + '; version: 1.0.0; do not edit\n';
  assert.equal(setStamp(bare, s), '# ' + MARKER_ID + '; ' + formatStamp(s) + '; do not edit\n');
  assert.equal(setStamp('no marker here\n', s), 'no marker here\n');
});

test('a stamp value carrying a separator is refused', () => {
  for (const bad of ['a;b', 'a"b', 'a\nb', '']) {
    assert.throws(() => formatStamp({ release: bad, commit: 'x' }));
    assert.throws(() => setStamp(BRIEF, { release: 'v1.0.0', commit: bad }));
  }
});
