// The merge route on a large PR (PR #519, 2026-11-20): `gh api .../compare/rc/next...<head>` printed every
// file's patch, past spawnSync's 1 MiB default buffer, so runAbsolute got ENOBUFS and the route stopped
// with "verification unavailable". The fix has two halves and each has a test that turns red without it:
//   --jq        the compare call asks for .behind_by only (the in-process run where an unfiltered
//               compare overflows, as it did on #519);
//   maxBuffer   runAbsolute reads past 1 MiB (the 2 MiB child, and the command run through bin/mhw.js
//               with a synthetic gh whose PR view and unfiltered compare are each over 1 MiB).
// The behind count still fails closed: anything but a bare integer refuses.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runAbsolute, MAX_BUFFER } from '../../src/lib/run.js';
import { delivery, failureReason, BEHIND_JQ } from '../../src/commands/delivery.js';
import { cases, raw } from '../helpers/delivery-cases.js';
import { answer } from '../helpers/delivery-fake.js';
import { tree, command } from '../helpers/delivery-run.js';

const POSIX = process.platform !== 'win32';
const OVER = 2 * 1024 * 1024; // past spawnSync's 1 MiB default, well under MAX_BUFFER
const UNAVAILABLE = 'PENDING: verification unavailable; details omitted\n';

/** A fresh copy of a parity case, to change its scenario. @param {string} name @returns {any} */
function slice(name = 'slice-merge-is-a-pinned-merge-commit') {
  const c = cases().find((x) => x.name === name);
  assert.ok(c, name);
  return structuredClone(c);
}

/** @param {any} c @returns {string} */
function compareKey(c) {
  const key = Object.keys(c.scenario.api).find((k) => k.startsWith('compare/'));
  assert.ok(key, 'the case has a compare answer');
  return key;
}

/**
 * The case in process. An unfiltered compare fails as spawnSync does when its output passes the buffer,
 * which is what a real gh did on #519; everything else is the synthetic answer.
 * @param {any} c
 */
function run(c) {
  /** @type {string[][]} */
  const calls = [];
  const t = tree();
  try {
    const r = delivery(c.args, {
      cwd: t.root,
      exec: (tool, args) => {
        calls.push([tool, ...args]);
        if (tool === 'gh' && args[0] === 'api' && args[1].includes('/compare/') && !args.some((a) => a.startsWith('--jq'))) {
          const error = Object.assign(new Error('spawnSync gh ENOBUFS'), { code: 'ENOBUFS' });
          return { code: 2, stdout: 'x'.repeat(1024), stderr: '', error };
        }
        return answer(c.scenario, tool, args);
      },
    });
    return { ...r, merges: calls.filter((x) => x[0] === 'gh' && x[1] === 'pr' && x[2] === 'merge') };
  } finally {
    t.cleanup();
  }
}

test('runAbsolute reads output past 1 MiB, and an overflow past its buffer is ENOBUFS', () => {
  assert.ok(MAX_BUFFER >= 8 * 1024 * 1024, String(MAX_BUFFER));
  const big = runAbsolute(process.execPath, ['-e', 'process.stdout.write("x".repeat(' + OVER + '))']);
  assert.equal(big.error, undefined, String(big.error));
  assert.equal(big.code, 0);
  assert.equal(big.stdout.length, OVER);
  const over = runAbsolute(process.execPath, ['-e', 'process.stdout.write("x".repeat(' + OVER + '))'], { maxBuffer: 1024 });
  assert.equal(over.code, 2);
  assert.equal(/** @type {any} */ (over.error).code, 'ENOBUFS');
  assert.equal(failureReason(/** @type {Error} */ (over.error)), 'output too large');
  const missing = runAbsolute('/no-such-program-' + process.pid, []);
  assert.equal(failureReason(/** @type {Error} */ (missing.error)), 'could not run');
});

test('the merge asks gh api for .behind_by only, so a compare too large to print unfiltered still merges', () => {
  const c = slice();
  const r = run(c);
  assert.equal(r.stderr, '');
  assert.equal(r.code, 0);
  assert.equal(r.merges.length, 1);
  // The release candidate takes the same call.
  const rc = run(slice('rc-merge-is-a-pinned-merge-commit'));
  assert.equal(rc.code, 0, rc.stderr);
  assert.equal(rc.merges.length, 1);
});

test('a behind count that is not a bare integer refuses, and merges nothing', () => {
  for (const [label, body] of /** @type {Array<[string, Record<string, unknown>]>} */ ([
    ['absent', {}], ['null', { behind_by: null }], ['a word', { behind_by: 'x' }], ['negative', { behind_by: -1 }],
    ['fractional', { behind_by: 1.5 }], ['boolean', { behind_by: false }], ['leading zero', { behind_by: '00' }],
    ['an object', { behind_by: { n: 0 } }]])) {
    const c = slice();
    c.scenario.api[compareKey(c)] = body;
    const r = run(c);
    assert.equal(r.code, 1, label);
    assert.equal(r.stderr, UNAVAILABLE, label);
    assert.equal(r.merges.length, 0, label);
  }
  const behind = slice();
  behind.scenario.api[compareKey(behind)] = { behind_by: 3 };
  const r = run(behind);
  assert.equal(r.stderr, 'PENDING: head is behind rc/next; update it and rerun CI\n');
  assert.equal(r.merges.length, 0);
  assert.equal(BEHIND_JQ, '--jq=.behind_by');
});

test('through bin/mhw.js, a PR view and a compare each over 1 MiB still merge', { skip: !POSIX && 'the synthetic gh is a POSIX shell script; the in-process tests cover Windows' }, () => {
  const c = slice();
  c.scenario.pr.comments = [raw('y'.repeat(OVER)), ...c.scenario.pr.comments];
  c.scenario.api[compareKey(c)] = { behind_by: 0, files: [{ filename: 'f', patch: 'z'.repeat(OVER) }] };
  const r = command(c);
  assert.equal(r.stderr, '');
  assert.equal(r.code, 0);
  assert.match(r.stdout, /^MERGED: /);
  const compare = r.calls.find((x) => x[0] === 'gh' && x[1] === 'api' && x[2].includes('/compare/'));
  assert.deepEqual(compare && compare.slice(3), [BEHIND_JQ]);
});
