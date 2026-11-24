// src/render/shell-rc.js since #590: the retired paste wrapper's start-up block is only ever removed. Every
// mode takes it (and its two earlier forms) out of every start-up file it may be in, keeps the previous file
// as a 0600 backup and never overwrites an existing backup; a fresh HOME gets nothing. Until #590 this file
// held the cases of the step that wrote the block (#492, S21 of #470); its parity golden against the shell
// functions (shell-rc-golden.test.js, test/golden/S21) left with that behaviour. scan() runs on every OS; the
// file cases are POSIX only, as the user-layer installer is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, scan, block, freeBackup, WHAT, BEGIN, END, TAG, LEG2_COMMENT, LEG2_SOURCE, CREATED_LIST } from '../../src/render/shell-rc.js';

const POSIX = process.platform !== 'win32';
const ROOT_USER = POSIX && process.getuid?.() === 0;
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** A throwaway HOME, with its data directory and the snippet path the old block sourced. */
function home() {
  const H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's590-rc-')));
  cleanups.push(() => {
    for (const d of [H, path.join(H, 'ro')]) try { fs.chmodSync(d, 0o755); } catch { /* absent */ }
    fs.rmSync(H, { recursive: true, force: true });
  });
  const data = path.join(H, '.local', 'share', 'personal-multi-harness-workstation-configuration');
  return { H, data, snippet: path.join(data, 'paste-filter.sh') };
}

/**
 * Run the step. @param {ReturnType<typeof home>} h @param {string} mode
 * @param {{ shellRc?: string, shell?: string, uname?: string, zdotdir?: string }} [o]
 */
function run(h, mode, o = {}) {
  let out = '';
  let err = '';
  /** @type {Record<string, string>} */
  const env = { HOME: h.H };
  if (o.zdotdir !== undefined) env.ZDOTDIR = o.zdotdir;
  const code = main(['--mode=' + mode, '--shell-rc=' + (o.shellRc ?? ''), '--shell=' + (o.shell ?? '/bin/zsh'),
    '--data-dir=' + h.data, '--uname=' + (o.uname ?? 'Darwin')],
  { out: (s) => { out += s; }, err: (s) => { err += s; }, env });
  return { code, out, err };
}

const read = (/** @type {string} */ f) => fs.readFileSync(f, 'utf8');
/** Every name under dir, sorted. @param {string} dir */
const names = (dir) => fs.readdirSync(dir).sort();
/** The CHANGED line install and uninstall print. @param {string} rc @param {string} bak */
const changed = (rc, bak) => 'CHANGED ' + rc + ': paste-wrapper start-up block present -> absent (' + WHAT + '; previous file kept as ' + bak + ')\n';

test('scan: the block, the earlier forms and the counts', () => {
  const ours = BEGIN + '\nbody\n' + END + '\n';
  assert.deepEqual(scan(''), { stripped: '', block: '', nb: 0, ne: 0, bad: false, leg: 0, leg2: 0, leg2k: 0 });
  assert.deepEqual(scan('a\n' + ours + 'b'), { stripped: 'a\nb\n', block: ours, nb: 1, ne: 1, bad: false, leg: 0, leg2: 0, leg2k: 0 });
  assert.equal(scan('x  ' + TAG + '\ny\n').leg, 1);
  assert.equal(scan('x  ' + TAG + '\ny\n').stripped, 'y\n');
  const pair = LEG2_COMMENT + '\n' + LEG2_SOURCE + '\n';
  assert.deepEqual(scan('a\n' + pair), { stripped: 'a\n', block: '', nb: 0, ne: 0, bad: false, leg: 1, leg2: 1, leg2k: 0 });
  assert.equal(scan('if x; then\n' + pair + 'fi\n').leg2k, 1);
  assert.equal(scan(BEGIN + '\n').bad, true);
  assert.equal(scan(END + '\n' + BEGIN + '\n' + END + '\n').bad, true);
  assert.equal(scan(ours + ours).nb, 2);
});

test('a fresh HOME: no mode writes anything, prints anything or fails (a fresh install writes no block)', { skip: !POSIX && 'POSIX only' }, () => {
  for (const shell of ['/bin/zsh', '/bin/bash', '/usr/local/bin/fish', '']) {
    const h = home();
    for (const mode of ['install', 'check', 'dry-run', 'uninstall']) {
      assert.deepEqual(run(h, mode, { shell }), { code: 0, out: '', err: '' }, shell + ' ' + mode);
    }
    assert.deepEqual(names(h.H), [], shell);
  }
});

test('install removes the block from an owner file, byte for byte, with a 0600 backup of the file it changed', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  // Bytes that are not UTF-8, a CR, a tab, a NUL: kept as bytes.
  const owner = Buffer.from([0x65, 0x78, 0x70, 0x00, 0x41, 0x3d, 0xff, 0xfe, 0x0d, 0x0a, 0x09, 0x61, 0x0a]);
  const before = Buffer.concat([owner, Buffer.from(block(h.snippet))]);
  fs.writeFileSync(h.H + '/.zshrc', before);
  fs.chmodSync(h.H + '/.zshrc', 0o640);
  const r = run(h, 'install');
  assert.deepEqual(r, { code: 0, out: changed(h.H + '/.zshrc', h.H + '/.zshrc.pmhwc-backup'), err: '' });
  assert.deepEqual(fs.readFileSync(h.H + '/.zshrc'), owner);
  assert.deepEqual(fs.readFileSync(h.H + '/.zshrc.pmhwc-backup'), before, 'the backup is the file as it was');
  assert.equal(fs.statSync(h.H + '/.zshrc.pmhwc-backup').mode & 0o777, 0o600);
  assert.equal(fs.statSync(h.H + '/.zshrc').mode & 0o777, 0o640, 'mode kept');
  // A second install, and an uninstall, find nothing left.
  assert.deepEqual(run(h, 'install'), { code: 0, out: '', err: '' });
  assert.deepEqual(run(h, 'uninstall'), { code: 0, out: '', err: '' });
  assert.deepEqual(names(h.H), ['.zshrc', '.zshrc.pmhwc-backup']);
});

test('an existing backup is never overwritten: the next free .pmhwc-backup.N is used', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const rc = h.H + '/.zshrc';
  fs.writeFileSync(rc + '.pmhwc-backup', 'the owner kept this\n');
  fs.writeFileSync(rc + '.pmhwc-backup.1', 'and this\n');
  fs.writeFileSync(rc, 'export A=1\n' + block(h.snippet));
  assert.equal(freeBackup(rc), rc + '.pmhwc-backup.2');
  assert.equal(run(h, 'dry-run').out, 'WOULD CHANGE ' + rc + ': paste-wrapper start-up block present -> absent (backup ' + rc + '.pmhwc-backup.2)\n');
  assert.deepEqual(run(h, 'install'), { code: 0, out: changed(rc, rc + '.pmhwc-backup.2'), err: '' });
  assert.equal(read(rc + '.pmhwc-backup'), 'the owner kept this\n');
  assert.equal(read(rc + '.pmhwc-backup.1'), 'and this\n');
  assert.equal(read(rc + '.pmhwc-backup.2'), 'export A=1\n' + block(h.snippet));
  assert.equal(read(rc), 'export A=1\n');
  // A dangling link at the backup's name is taken too, never written through.
  const h2 = home();
  fs.symlinkSync(h2.H + '/nowhere', h2.H + '/.zshrc.pmhwc-backup');
  fs.writeFileSync(h2.H + '/.zshrc', block(h2.snippet) + 'x\n');
  assert.equal(run(h2, 'install').out, changed(h2.H + '/.zshrc', h2.H + '/.zshrc.pmhwc-backup.1'));
  assert.equal(fs.existsSync(h2.H + '/nowhere'), false);
});

test('check names a block still there as STALE (exit 1); dry-run changes nothing', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const text = 'export A=1\n' + block(h.snippet);
  fs.writeFileSync(h.H + '/.bashrc', text);
  assert.deepEqual(run(h, 'check'), { code: 1, out: 'STALE   ' + h.H + '/.bashrc: ' + WHAT + ' is still there; install removes it\n', err: '' });
  assert.equal(run(h, 'dry-run').code, 0);
  assert.equal(read(h.H + '/.bashrc'), text);
  assert.deepEqual(names(h.H), ['.bashrc']);
});

test('every default start-up file is cleaned whatever SHELL says; ~/.profile is never read', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const files = ['.zshrc', '.bashrc', '.bash_profile', '.bash_login'];
  for (const f of files) fs.writeFileSync(path.join(h.H, f), 'export ' + f.slice(1).replace('.', '_') + '=1\n' + block(h.snippet));
  fs.writeFileSync(h.H + '/.profile', 'export P=1\n' + block(h.snippet));
  assert.equal(run(h, 'install', { shell: '/usr/local/bin/fish', uname: 'Linux' }).code, 0);
  for (const f of files) assert.equal(read(path.join(h.H, f)), 'export ' + f.slice(1).replace('.', '_') + '=1\n', f);
  assert.equal(read(h.H + '/.profile'), 'export P=1\n' + block(h.snippet), '~/.profile was never written, so it is never touched');
  assert.equal(fs.existsSync(h.H + '/.profile.pmhwc-backup'), false);
});

test('the earlier one-line and unmarked two-line forms go too; a two-line form opening a body stays, with a NOTE', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.writeFileSync(h.H + '/.zshrc', 'a\n. x  ' + TAG + '\nb\n' + LEG2_COMMENT + '\n' + LEG2_SOURCE + '\nc\n');
  assert.equal(run(h, 'install').code, 0);
  assert.equal(read(h.H + '/.zshrc'), 'a\nb\nc\n');
  const pair = 'if x; then\n' + LEG2_COMMENT + '\n' + LEG2_SOURCE + '\nfi\n';
  fs.writeFileSync(h.H + '/.bashrc', pair);
  const r = run(h, 'install');
  assert.match(r.out, /^NOTE {4}.*\/\.bashrc: an unmarked two-line paste-filter source inside a compound command's body is left in place/);
  assert.equal(read(h.H + '/.bashrc'), pair);
});

test('a file an earlier install created and that holds only the block is removed, and the created list with it', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.mkdirSync(h.data, { recursive: true });
  fs.writeFileSync(path.join(h.data, CREATED_LIST), h.H + '/.zshrc\n' + h.H + '/.bashrc\n');
  fs.writeFileSync(h.H + '/.zshrc', block(h.snippet));
  fs.writeFileSync(h.H + '/.bashrc', '\n' + block(h.snippet)); // a blank line is the owner's
  assert.equal(run(h, 'dry-run').out.split('\n')[0], 'WOULD REMOVE ' + h.H + '/.zshrc (an earlier install created it and only the paste-wrapper block is in it)');
  const r = run(h, 'install');
  assert.equal(r.code, 0);
  assert.ok(r.out.includes('REMOVED ' + h.H + '/.zshrc (an earlier install created it and only the paste-wrapper block was in it)\n'), r.out);
  assert.equal(fs.existsSync(h.H + '/.zshrc'), false);
  assert.equal(read(h.H + '/.bashrc'), '\n');
  assert.equal(fs.existsSync(path.join(h.data, CREATED_LIST)), false);
});

test('a symlinked start-up file stays a link; its target loses the block', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.mkdirSync(h.H + '/dotfiles');
  fs.writeFileSync(h.H + '/dotfiles/zshrc', 'export DOT=1\n' + block(h.snippet));
  fs.symlinkSync('dotfiles/zshrc', h.H + '/.zshrc');
  assert.equal(run(h, 'install').code, 0);
  assert.equal(fs.lstatSync(h.H + '/.zshrc').isSymbolicLink(), true);
  assert.equal(read(h.H + '/dotfiles/zshrc'), 'export DOT=1\n');
});

test('ZDOTDIR outside HOME is never touched; inside HOME it is cleaned', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const zs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's590-zdot-')));
  cleanups.push(() => fs.rmSync(zs, { recursive: true, force: true }));
  const sentinel = 'export OWNER_ZSH=1\n' + block(h.snippet);
  fs.writeFileSync(zs + '/.zshrc', sentinel);
  for (const zdotdir of [zs, h.H + '/../' + path.basename(zs)]) {
    for (const mode of ['install', 'uninstall']) assert.deepEqual(run(h, mode, { zdotdir }), { code: 0, out: '', err: '' });
  }
  assert.equal(read(zs + '/.zshrc'), sentinel);
  assert.deepEqual(names(zs), ['.zshrc']);
  fs.mkdirSync(h.H + '/zdot');
  fs.writeFileSync(h.H + '/zdot/.zshrc', sentinel);
  run(h, 'install', { zdotdir: h.H + '/zdot' });
  assert.equal(read(h.H + '/zdot/.zshrc'), 'export OWNER_ZSH=1\n');
});

test('--shell-rc names one more file to clean; --shell-rc=none still cleans the default files', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.writeFileSync(h.H + '/myrc', 'm\n' + block(h.snippet));
  fs.writeFileSync(h.H + '/.bashrc', 'b\n' + block(h.snippet));
  assert.equal(run(h, 'install', { shellRc: h.H + '/myrc' }).code, 0);
  assert.equal(read(h.H + '/myrc'), 'm\n');
  assert.equal(read(h.H + '/.bashrc'), 'b\n');
  fs.writeFileSync(h.H + '/.bash_login', 'l\n' + block(h.snippet));
  assert.equal(run(h, 'install', { shellRc: 'none' }).code, 0);
  assert.equal(read(h.H + '/.bash_login'), 'l\n');
});

test('damaged markers are refused in every mode; nothing changed and no backup written', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const rc = h.H + '/.zshrc';
  for (const text of [block(h.snippet) + 'between\n' + block(h.snippet), 'x\n' + BEGIN + '\nmine\n', END + '\n' + BEGIN + '\n' + END + '\n', 'a\n' + END + '\n']) {
    fs.writeFileSync(rc, text);
    for (const mode of ['install', 'check', 'dry-run', 'uninstall']) {
      const r = run(h, mode);
      assert.equal(r.code, 3, mode);
      assert.equal(r.out, 'REFUSE  ' + rc + ": the paste-wrapper block's markers are damaged (missing, repeated or out of order); nothing removed. Fix or remove them, then run install again\n");
      assert.equal(read(rc), text);
    }
    assert.equal(fs.existsSync(rc + '.pmhwc-backup'), false);
  }
});

test('a refused file keeps the created list, so a later run still deletes what an earlier install created', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.mkdirSync(h.data, { recursive: true });
  fs.writeFileSync(path.join(h.data, CREATED_LIST), h.H + '/.bashrc\n');
  fs.writeFileSync(h.H + '/.bashrc', block(h.snippet));
  fs.writeFileSync(h.H + '/.zshrc', 'x\n' + BEGIN + '\n');
  assert.equal(run(h, 'install').code, 3);
  assert.equal(fs.existsSync(path.join(h.data, CREATED_LIST)), true, 'kept beside a damaged file');
  fs.writeFileSync(h.H + '/.zshrc', 'x\n');
  fs.writeFileSync(h.H + '/.bashrc', block(h.snippet));
  assert.equal(run(h, 'install').code, 0);
  assert.equal(fs.existsSync(h.H + '/.bashrc'), false);
  assert.equal(fs.existsSync(path.join(h.data, CREATED_LIST)), false);
});

test('an unreadable start-up file is refused, exit 3, and left as it was', { skip: (!POSIX && 'POSIX only') || (ROOT_USER && 'root reads every file') }, () => {
  const h = home();
  fs.writeFileSync(h.H + '/.zshrc', 'secret\n' + block(h.snippet));
  fs.chmodSync(h.H + '/.zshrc', 0o000);
  for (const mode of ['install', 'uninstall']) {
    const r = run(h, mode);
    assert.equal(r.code, 3, mode);
    assert.match(r.out, /^REFUSE {2}.*\/\.zshrc: cannot be read \(EACCES\); nothing removed\n$/, mode);
  }
  fs.chmodSync(h.H + '/.zshrc', 0o600);
  assert.equal(read(h.H + '/.zshrc'), 'secret\n' + block(h.snippet));
});

test('a backup or a write that fails: one REFUSE line on stderr, exit 4, the file left as it was', { skip: (!POSIX && 'POSIX only') || (ROOT_USER && 'root writes every file') }, () => {
  const h = home();
  fs.mkdirSync(h.H + '/ro');
  const text = 'export A=1\n' + block(h.snippet);
  fs.writeFileSync(h.H + '/ro/rc', text);
  fs.chmodSync(h.H + '/ro', 0o555);
  const r = run(h, 'install', { shellRc: h.H + '/ro/rc' });
  assert.deepEqual([r.code, r.out, r.err], [4, '', 'REFUSE  ' + h.H + '/ro/rc.pmhwc-backup: the backup could not be created exclusively; no backup written\n']);
  assert.equal(read(h.H + '/ro/rc'), text);
  fs.chmodSync(h.H + '/ro', 0o755);
  fs.chmodSync(h.H + '/ro/rc', 0o444);
  const w = run(h, 'install', { shellRc: h.H + '/ro/rc' });
  assert.equal(w.code, 4);
  assert.match(w.err, /^REFUSE {2}.*\/ro\/rc: could not be written \(EACCES/);
  assert.equal(read(h.H + '/ro/rc'), text);
});

test('usage: every option once, a known mode, an absolute --shell-rc, HOME set; --snippet is gone', () => {
  /** @param {string[]} argv @param {Record<string, string>} [env] */
  const code = (argv, env = { HOME: '/nonexistent-s590' }) => main(argv, { out: () => {}, err: () => {}, env });
  const ok = ['--mode=check', '--shell-rc=none', '--shell=/bin/zsh', '--data-dir=/d', '--uname=Linux'];
  assert.equal(code(ok), 0);
  assert.equal(code(ok.slice(1)), 2);
  assert.equal(code([...ok, '--mode=check']), 2);
  assert.equal(code(['--mode=other', ...ok.slice(1)]), 2);
  assert.equal(code([ok[0], '--shell-rc=relative', ...ok.slice(2)]), 2);
  assert.equal(code([...ok, '--snippet=/s']), 2);
  assert.equal(code(ok, {}), 2);
});
