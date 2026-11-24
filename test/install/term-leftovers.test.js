// #589, QA advisory A2 on PR #614: moving an earlier install's term list or salt aside never overwrites an
// existing backup, and a failure says exactly which step failed and where the file now is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { moveAside, asideNotice } from '../../src/commands/install-user.js';

const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-589-aside-')));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

/** A fresh directory holding f with text. @param {string} name @param {string} text */
function fixture(name, text) {
  const d = path.join(BASE, name);
  fs.mkdirSync(d);
  const f = path.join(d, 'clipboard-salt');
  fs.writeFileSync(f, text, { mode: 0o644 });
  return f;
}

test('an existing backup is never overwritten: the next free numbered name is used', () => {
  const f = fixture('taken', 'new\n');
  fs.writeFileSync(f + '.pmhwc-backup', 'older\n');
  fs.writeFileSync(f + '.pmhwc-backup.1', 'oldest\n');
  const r = moveAside(f);
  assert.deepEqual([r.stage, r.bak], ['done', f + '.pmhwc-backup.2']);
  assert.equal(fs.readFileSync(f + '.pmhwc-backup', 'utf8'), 'older\n', 'the earlier backup was overwritten');
  assert.equal(fs.readFileSync(f + '.pmhwc-backup.1', 'utf8'), 'oldest\n');
  assert.equal(fs.readFileSync(r.bak, 'utf8'), 'new\n');
  assert.ok(!fs.existsSync(f), 'the file was not moved');
  if (process.platform !== 'win32') assert.equal(fs.statSync(r.bak).mode & 0o777, 0o600);
});

test('a free name is the plain backup name', () => {
  const f = fixture('free', 'x\n');
  assert.deepEqual(moveAside(f), { stage: 'done', bak: f + '.pmhwc-backup' });
});

test('a chmod failure is reported as such: the file is moved, and the backup is named', () => {
  const f = fixture('chmod', 'x\n');
  const r = moveAside(f, { linkSync: fs.linkSync, unlinkSync: fs.unlinkSync, chmodSync: () => { throw new Error('EPERM: synthetic'); } });
  assert.equal(r.stage, 'chmod');
  assert.equal(r.bak, f + '.pmhwc-backup');
  assert.ok(!fs.existsSync(f) && fs.existsSync(r.bak), 'chmod stage means the move already happened');
});

test('a move failure leaves the file where it was and no backup behind', () => {
  const f = fixture('move', 'x\n');
  const r = moveAside(f, { linkSync: fs.linkSync, unlinkSync: (/** @type {fs.PathLike} */ p) => {
    if (String(p) === f) throw new Error('EBUSY: synthetic');
    fs.unlinkSync(p);
  }, chmodSync: fs.chmodSync });
  assert.equal(r.stage, 'move');
  assert.ok(fs.existsSync(f) && !fs.existsSync(f + '.pmhwc-backup'));
});

test('the notice says exactly what failed: a chmod failure names the moved backup, a move failure says nothing moved', () => {
  const err = new Error('EPERM: synthetic');
  const [ok1, chmod] = asideNotice('/d/clipboard-salt', { stage: 'chmod', bak: '/d/clipboard-salt.pmhwc-backup.1', error: err }, 'w');
  assert.equal(ok1, false);
  assert.equal(chmod, 'REFUSE  /d/clipboard-salt: moved aside to /d/clipboard-salt.pmhwc-backup.1, but setting its mode to 0600 failed '
    + '(EPERM: synthetic); the backup may be readable by others: run chmod 600 on it, or delete it');
  assert.doesNotMatch(chmod, /left as it is/);
  const [ok2, move] = asideNotice('/d/clipboard-salt', { stage: 'move', bak: '/d/clipboard-salt.pmhwc-backup', error: err }, 'w');
  assert.equal(ok2, false);
  assert.match(move, /could not be moved aside \(EPERM: synthetic\); left as it is, nothing was backed up$/);
  assert.deepEqual(asideNotice('/d/x', { stage: 'done', bak: '/d/x.pmhwc-backup' }, 'w'),
    [true, 'REMOVED /d/x (w; backup kept as /d/x.pmhwc-backup, 0600: delete it when you no longer need it)']);
});
