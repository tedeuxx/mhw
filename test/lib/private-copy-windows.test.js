// The Windows branch of privateCopy (src/lib/private-copy.js, #497), driven on a POSIX runner: platform
// 'win32' and an env whose SystemRoot points at stand-in whoami.exe and icacls.exe (shell scripts that
// answer from a mode file). The access list is decided by SID, on the SDDL icacls /save writes, so each
// bad shape refuses the backup and leaves no file at the destination. Whether the real icacls prints
// what the stand-ins print is measured by test/install/windows.test.js on the Windows runner, not here.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { privateCopy } from '../../src/lib/private-copy.js';

const POSIX = process.platform !== 'win32';
const skip = !POSIX && 'the stand-ins are POSIX shell scripts; the Windows runner exercises the real icacls';
const BASE = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's27-acl-')));
after(() => fs.rmSync(BASE, { recursive: true, force: true }));

const ME = 'S-1-5-21-1000';
/** What the stand-ins answer, per mode: whoami's CSV line, icacls's listing names, and the SDDL /save writes. */
const MODES = {
  ok: { who: '"dom\\me","' + ME + '"', names: ['dom\\me'], sddl: 'D:PAI(A;;FA;;;' + ME + ')' },
  sticky: { who: '"dom\\me","' + ME + '"', names: ['NT AUTHORITY\\SYSTEM', 'dom\\me'], sddl: 'D:PAI(A;;FA;;;SY)(A;;FA;;;' + ME + ')' },
  inherited: { who: '"dom\\me","' + ME + '"', names: ['dom\\me'], sddl: 'D:AI(A;ID;FA;;;' + ME + ')' },
  deny: { who: '"dom\\me","' + ME + '"', names: ['dom\\me'], sddl: 'D:PAI(D;;FA;;;WD)(A;;FA;;;' + ME + ')' },
  'deny-me': { who: '"dom\\me","' + ME + '"', names: ['dom\\me'], sddl: 'D:PAI(D;;FA;;;' + ME + ')' },
  'me-first': { who: '"dom\\me","' + ME + '"', names: ['dom\\me'], sddl: 'D:PAI(A;;FA;;;' + ME + ')(A;;FA;;;BA)' },
  'other-sid': { who: '"dom\\me","' + ME + '"', names: ['dom\\me'], sddl: 'D:PAI(A;;FA;;;S-1-5-21-2000)' },
  'no-name': { who: '"' + ME + '"', names: ['dom\\me'], sddl: 'D:PAI(A;;FA;;;' + ME + ')' },
};

/** The stand-ins under <root>/System32, answering from <root>/mode.json. @param {string} root */
function standIns(root) {
  const sys = path.join(root, 'System32');
  fs.mkdirSync(sys, { recursive: true });
  const conf = path.join(root, 'mode.json');
  const log = path.join(root, 'icacls.log');
  const node = process.execPath;
  const js = (/** @type {string} */ body) => '#!/bin/sh\nexec "' + node + '" -e \'' + body + '\' -- "$@"\n';
  fs.writeFileSync(path.join(sys, 'whoami.exe'), js('const m=JSON.parse(require("fs").readFileSync("' + conf + '","utf8"));console.log(m.who)'));
  fs.writeFileSync(path.join(sys, 'icacls.exe'), js('const fs=require("fs");const m=JSON.parse(fs.readFileSync("' + conf + '","utf8"));'
    + 'const a=process.argv.slice(1);fs.appendFileSync("' + log + '",JSON.stringify(a.slice(1))+"\\n");'
    + 'if(a.length===1){console.log(m.names.map((n,i)=>(i?"       ":a[0]+" ")+n+":(F)").join("\\n"));}'
    + 'else if(a[1]==="/save"){fs.writeFileSync(a[2],Buffer.from("\\uFEFF"+require("path").basename(a[0])+"\\r\\n"+m.sddl+"\\r\\n","utf16le"));}'));
  for (const f of ['whoami.exe', 'icacls.exe']) fs.chmodSync(path.join(sys, f), 0o755);
  return { conf, log };
}

let n = 0;
/** Copy a file under one mode; the result and the icacls calls. @param {keyof typeof MODES} mode */
function copyUnder(mode) {
  const root = path.join(BASE, 'win-' + ++n);
  const { conf, log } = standIns(root);
  fs.writeFileSync(conf, JSON.stringify(MODES[mode]));
  const src = path.join(root, 'settings.json');
  const dst = src + '.pmhwc-backup';
  fs.writeFileSync(src, '{"x":1}\n');
  /** @type {string | null} */
  let error = null;
  try {
    privateCopy(src, dst, { platform: 'win32', env: { SystemRoot: root } });
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }
  const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : [];
  const leftovers = fs.readdirSync(root).filter((f) => f.startsWith('.pmhwc-acl-'));
  return { error, exists: fs.existsSync(dst), data: fs.existsSync(dst) ? fs.readFileSync(dst, 'utf8') : null, calls, leftovers };
}

test('the user alone, by SID: the backup is written, and nothing is removed', { skip }, () => {
  const r = copyUnder('ok');
  assert.equal(r.error, null);
  assert.equal(r.data, '{"x":1}\n');
  assert.ok(r.calls.some((c) => c[0] === '/inheritance:r' && c.includes('*' + ME + ':F')), JSON.stringify(r.calls));
  assert.ok(!r.calls.some((c) => c[0] === '/remove'));
  assert.deepEqual(r.leftovers, [], 'the /save directory is removed');
});

test('an entry of its own beside the user is removed by its printed name, grant and deny alike', { skip }, () => {
  const r = copyUnder('sticky');
  assert.ok(r.calls.some((c) => c[0] === '/remove' && c.includes('NT AUTHORITY\\SYSTEM') && !c.includes('dom\\me')), JSON.stringify(r.calls));
});

for (const [mode, why] of /** @type {const} */ ([
  ['sticky', 'an entry that is still there after the removal'],
  ['inherited', 'an inherited entry'],
  ['deny', 'a deny entry'],
  ['deny-me', 'the one entry denies the user'],
  ['me-first', 'a second entry after the user'],
  ['other-sid', 'an entry whose name is the user but whose SID is not'],
  ['no-name', 'whoami without an account name'],
])) {
  test('refused, and no backup is left: ' + why + ' (' + mode + ')', { skip }, () => {
    const r = copyUnder(mode);
    assert.ok(r.error && r.error.includes('no backup written'), String(r.error));
    assert.equal(r.exists, false);
    assert.deepEqual(r.leftovers, []);
  });
}
