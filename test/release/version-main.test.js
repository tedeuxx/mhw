// The release workflow itself (#473): .github/workflows/version-main.yml, read as text. No YAML library
// (the hook-path rule keeps dependencies out), so each assertion names the lines it reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const YAML = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'version-main.yml'), 'utf8').replace(/\r\n/g, '\n');
/** The workflow without its comment lines, so a comment never satisfies or fails an assertion. */
const CODE = YAML.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');

test('no Python remains in the release path', () => {
  for (const banned of [/setup-python/, /\bpip\b/, /python3? -c/, /\bpython3?\b/, /bump-my-version/]) {
    assert.doesNotMatch(CODE, banned, String(banned));
  }
});

test('the bump is the Node script, and the tag output is what it printed', () => {
  assert.match(CODE, /tag="\$\(node src\/commands\/release-bump\.js "\$PART" --git="\$\(command -v git\)"\)"/);
  assert.match(CODE, /echo "tag=\$tag" >> "\$GITHUB_OUTPUT"/);
  assert.match(CODE, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/, 'a non-numeric tag stops the job before the push');
  assert.match(CODE, /TAG: \$\{\{ steps\.version\.outputs\.tag \}\}\n\s+run: git push --atomic origin HEAD:main "refs\/tags\/\$TAG"/);
});

test('every action is pinned by a full commit SHA', () => {
  const uses = [...CODE.matchAll(/^\s*-?\s*uses:\s*(\S+)/gm)].map((m) => m[1]);
  assert.ok(uses.length >= 2, 'checkout and setup-node');
  for (const u of uses) assert.match(u, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, u);
  assert.ok(uses.some((u) => u.startsWith('actions/setup-node@')));
});

// The loop guard. This workflow never runs on a push: it runs when a pull request into main is closed
// and merged, so the bump commit it pushes cannot start it again. That is what keeps it from looping,
// unchanged by #473; a `bump:`-prefix skip on a pushed head commit does not exist here because no
// push trigger does.
test('the loop guard: only a merged pull request into main starts a cut', () => {
  const on = /** @type {RegExpExecArray} */ (/^on:\n((?: {2}.*\n)+)/m.exec(YAML));
  assert.ok(on, 'an on: block');
  const triggers = on[1].split('\n').filter((l) => /^ {2}\S/.test(l)).map((l) => l.trim());
  assert.deepEqual(triggers, ['pull_request:']);
  assert.match(on[1], /branches: \[main\]/);
  assert.match(on[1], /types: \[closed\]/);
  assert.match(CODE, /if: github\.event\.pull_request\.merged == true/);
  assert.match(CODE, /concurrency:\n\s+group: version-main\n\s+cancel-in-progress: false/);
});
