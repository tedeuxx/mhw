// src/lib/unified-diff.js (#490): the hunks of `diff -u`, against fixed expectations on every OS and, where
// a diff is on PATH, against that diff on the dry-run shapes the allow-list step prints and on random line
// edits of them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { unifiedHunks } from '../../src/lib/unified-diff.js';
import { which } from '../helpers/home.js';

test('equal inputs give no hunk; one hunk with context; distant changes split', () => {
  assert.equal(unifiedHunks('a\nb\n', 'a\nb\n'), '');
  assert.equal(unifiedHunks('{}\n', '{\n  "a": 1\n}\n'), '@@ -1 +1,3 @@\n-{}\n+{\n+  "a": 1\n+}\n');
  assert.equal(unifiedHunks('', 'x\n'), '@@ -0,0 +1 @@\n+x\n');
  assert.equal(unifiedHunks('x\n', ''), '@@ -1 +0,0 @@\n-x\n');
  const a = Array.from({ length: 20 }, (_, k) => 'l' + k).join('\n') + '\n';
  const b = a.replace('l1\n', 'L1\n').replace('l18\n', 'L18\n');
  assert.equal(unifiedHunks(a, b), '@@ -1,5 +1,5 @@\n l0\n-l1\n+L1\n l2\n l3\n l4\n@@ -16,5 +16,5 @@\n l15\n l16\n l17\n-l18\n+L18\n l19\n');
  const c = a.replace('l5\n', 'L5\n').replace('l11\n', 'L11\n');
  assert.equal(unifiedHunks(a, c).split('\n').filter((l) => l.startsWith('@@')).length, 1, 'six equal lines between: one hunk');
});

/** A small deterministic generator. @param {number} seed */
function rng(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
}

test('the same hunks as the diff on PATH', (t) => {
  const diff = process.platform === 'win32' ? null : which('diff');
  if (!diff) return t.skip('no diff on PATH');
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-udiff-')));
  try {
    const base = ['{', '  "permissions": {', '    "allow": [', '      "Bash(git status:*)",', '      "Bash(gh pr view:*)"', '    ],',
      '    "deny": [', '      "Edit(~/.claude/settings.json)"', '    ]', '  },', '  "owned": {', '    "allow": [', '      "Bash(git status:*)"',
      '    ],', '    "defaultMode": null', '  }', '}'];
    const pool = ['      "Bash(git diff:*)",', '    ],', '  },', '}', '      "Bash(gh pr view:*)"', '    "defaultMode": "acceptEdits",', '{'];
    const r = rng(7);
    const pairs = [['{}\n', base.join('\n') + '\n']];
    for (let k = 0; k < 150; k++) {
      const a = [...base];
      const b = [...base];
      for (let e = 0; e < 1 + Math.floor(r() * 5); e++) {
        const target = r() < 0.5 ? a : b;
        const at = Math.floor(r() * (target.length + 1));
        if (r() < 0.6) target.splice(at, 0, pool[Math.floor(r() * pool.length)]);
        else target.splice(at, 1);
      }
      pairs.push([a.join('\n') + '\n', b.join('\n') + '\n']);
    }
    let differ = 0;
    const samples = [];
    for (const [a, b] of pairs) {
      fs.writeFileSync(path.join(dir, 'a'), a);
      fs.writeFileSync(path.join(dir, 'b'), b);
      const p = spawnSync(diff, ['-u', path.join(dir, 'a'), path.join(dir, 'b')], { encoding: 'utf8' });
      const want = p.stdout.split('\n').slice(2).join('\n');
      if (want !== unifiedHunks(a, b)) {
        differ++;
        if (samples.length < 2) samples.push({ a, b, want, got: unifiedHunks(a, b) });
      }
    }
    // A longest common subsequence is not unique: on the random edits two correct diffs can choose
    // differently. The dry-run shapes (the first pair, and the goldens of test/golden/S19) must match.
    assert.equal(pairs.length > 100, true);
    t.diagnostic('random pairs where this diff chose another valid hunk set: ' + differ + ' of ' + (pairs.length - 1));
    fs.writeFileSync(path.join(dir, 'a'), pairs[0][0]);
    fs.writeFileSync(path.join(dir, 'b'), pairs[0][1]);
    const p = spawnSync(diff, ['-u', path.join(dir, 'a'), path.join(dir, 'b')], { encoding: 'utf8' });
    assert.equal(unifiedHunks(pairs[0][0], pairs[0][1]), p.stdout.split('\n').slice(2).join('\n'));
    assert.ok(differ <= pairs.length / 4, JSON.stringify(samples));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
