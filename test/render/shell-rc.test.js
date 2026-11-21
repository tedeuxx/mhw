// src/render/shell-rc.js (#492, S21 of #470): the paste wrapper's managed block in the shell start-up files.
// The rc_* cases of global/install.test.sh as node:test (ZDOTDIR outside HOME, a symlinked file, two blocks,
// a damaged block, --shell-rc=none, never ~/.profile), plus what the goldens cannot hold: bytes that are not
// UTF-8, an unreadable file and the writes that fail. scan() runs on every OS; the file cases are POSIX only,
// as install.sh is. Parity with the shell functions is test/render/shell-rc-golden.test.js.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { main, scan, block, handLine, BEGIN, END, TAG, LEG2_COMMENT, LEG2_SOURCE, CREATED_LIST } from '../../src/render/shell-rc.js';

const POSIX = process.platform !== 'win32';
const ROOT_USER = POSIX && process.getuid?.() === 0;
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** A throwaway HOME, with its data directory and snippet paths. */
function home() {
  const H = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's21-unit-')));
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
    '--snippet=' + h.snippet, '--data-dir=' + h.data, '--uname=' + (o.uname ?? 'Darwin')],
  { out: (s) => { out += s; }, err: (s) => { err += s; }, env });
  return { code, out, err };
}

const read = (/** @type {string} */ f) => fs.readFileSync(f, 'utf8');

test('scan: the block, the earlier forms and the counts', () => {
  const ours = BEGIN + '\nbody\n' + END + '\n';
  assert.deepEqual(scan(''), { stripped: '', block: '', nb: 0, ne: 0, bad: false, leg: 0, leg2: 0, leg2k: 0 });
  assert.deepEqual(scan('a\n' + ours + 'b'), { stripped: 'a\nb\n', block: ours, nb: 1, ne: 1, bad: false, leg: 0, leg2: 0, leg2k: 0 });
  assert.equal(scan('x  ' + TAG + '\ny\n').leg, 1);
  assert.equal(scan('x  ' + TAG + '\ny\n').stripped, 'y\n');
  const pair = LEG2_COMMENT + '\n' + LEG2_SOURCE + '\n';
  assert.deepEqual(scan('a\n' + pair), { stripped: 'a\n', block: '', nb: 0, ne: 0, bad: false, leg: 1, leg2: 1, leg2k: 0 });
  assert.equal(scan('if x; then\n' + pair + 'fi\n').leg2k, 1);
  assert.equal(scan('if x; then\n' + pair + 'fi\n').stripped, 'if x; then\n' + pair + 'fi\n');
  assert.equal(scan('if x; then \t\n  \n' + pair).leg2k, 1, 'blank lines between are skipped');
  assert.equal(scan('athen_not\n' + pair).leg2k, 0);
  assert.equal(scan(LEG2_COMMENT + '\nother\n' + LEG2_COMMENT).stripped, LEG2_COMMENT + '\nother\n' + LEG2_COMMENT + '\n');
  assert.equal(scan(BEGIN + '\n').bad, true);
  assert.equal(scan(END + '\n' + BEGIN + '\n' + END + '\n').bad, true);
  assert.equal(scan(ours + ours).nb, 2);
  assert.equal(scan(BEGIN + '\n' + LEG2_COMMENT + '\n' + END + '\n').block, BEGIN + '\n' + LEG2_COMMENT + '\n' + END + '\n', 'the comment inside the block is the block');
});

test('zsh: the block goes into ~/.zshrc only, absent -> present, and uninstall deletes the file it created', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const r = run(h, 'install');
  assert.equal(r.code, 0);
  assert.equal(r.out, 'CHANGED ' + h.H + '/.zshrc: paste-wrapper start-up block absent -> present (new file); new shells clean pastes\n');
  assert.equal(read(h.H + '/.zshrc'), block(h.snippet));
  for (const f of ['.bashrc', '.bash_profile', '.profile', '.zprofile', '.zshenv']) assert.equal(fs.existsSync(path.join(h.H, f)), false, f);
  assert.equal(read(path.join(h.data, CREATED_LIST)), h.H + '/.zshrc\n');
  assert.deepEqual(run(h, 'check'), { code: 0, out: 'OK      ' + h.H + '/.zshrc activates the paste wrapper (managed block)\n', err: '' });
  const u = run(h, 'uninstall');
  assert.equal(u.out, 'REMOVED ' + h.H + '/.zshrc (install created it and only the paste-wrapper block was in it)\n');
  assert.equal(fs.existsSync(h.H + '/.zshrc'), false);
  assert.equal(fs.existsSync(path.join(h.data, CREATED_LIST)), false);
});

test('uninstall removes exactly the block and gives the owner\'s file back byte for byte', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  // Bytes that are not UTF-8, a CR, a tab: kept as bytes, as awk kept them.
  const owner = Buffer.from([0x65, 0x78, 0x70, 0x6f, 0x72, 0x74, 0x20, 0x41, 0x3d, 0xff, 0xfe, 0x0d, 0x0a, 0x09, 0x61, 0x0a]);
  fs.writeFileSync(h.H + '/.zshrc', owner, { mode: 0o640 });
  fs.chmodSync(h.H + '/.zshrc', 0o640);
  assert.equal(run(h, 'install').code, 0);
  assert.deepEqual(fs.readFileSync(h.H + '/.zshrc'), Buffer.concat([owner, Buffer.from(block(h.snippet))]));
  assert.deepEqual(fs.readFileSync(h.H + '/.zshrc.pmhwc-backup'), owner);
  assert.equal(fs.statSync(h.H + '/.zshrc.pmhwc-backup').mode & 0o777, 0o600);
  assert.equal(fs.statSync(h.H + '/.zshrc').mode & 0o777, 0o640, 'mode kept');
  assert.equal(fs.existsSync(path.join(h.data, CREATED_LIST)), false, 'a file that was there is not recorded as created');
  const u = run(h, 'uninstall');
  assert.equal(u.out, 'CHANGED ' + h.H + '/.zshrc: paste-wrapper start-up block present -> absent (previous file kept as ' + h.H + '/.zshrc.pmhwc-backup)\n');
  assert.deepEqual(fs.readFileSync(h.H + '/.zshrc'), owner);
});

test('a final newline install added to a file that had none stays after uninstall', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.writeFileSync(h.H + '/.zshrc', 'export X=1');
  run(h, 'install');
  assert.equal(read(h.H + '/.zshrc'), 'export X=1\n' + block(h.snippet));
  run(h, 'uninstall');
  assert.equal(read(h.H + '/.zshrc'), 'export X=1\n');
});

test('ZDOTDIR outside HOME is never written, by install or uninstall; the line is printed with the reason', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const zs = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's21-zdot-')));
  cleanups.push(() => fs.rmSync(zs, { recursive: true, force: true }));
  const sentinel = 'export OWNER_ZSH=1\n' + block(h.snippet);
  fs.writeFileSync(zs + '/.zshrc', sentinel);
  const r = run(h, 'install', { zdotdir: zs });
  assert.equal(r.out, 'NOTE    automatic paste cleaning: no shell start-up file is written (ZDOTDIR=' + zs + ' is outside HOME=' + h.H + '); add this line to yours:\n'
    + '        ' + handLine(h.snippet) + '\n');
  assert.equal(run(h, 'uninstall', { zdotdir: zs }).out, '');
  assert.equal(read(zs + '/.zshrc'), sentinel);
  assert.deepEqual(fs.readdirSync(zs), ['.zshrc']);
  // Inside HOME it is honoured.
  run(h, 'install', { zdotdir: h.H + '/zdot' });
  assert.equal(read(h.H + '/zdot/.zshrc'), block(h.snippet));
  assert.equal(fs.existsSync(h.H + '/.zshrc'), false);
});

test('a symlinked start-up file stays a link; its target gets the block', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.mkdirSync(h.H + '/dotfiles');
  fs.writeFileSync(h.H + '/dotfiles/zshrc', 'export DOT=1\n');
  fs.symlinkSync('dotfiles/zshrc', h.H + '/.zshrc');
  run(h, 'install');
  assert.equal(fs.lstatSync(h.H + '/.zshrc').isSymbolicLink(), true);
  assert.equal(read(h.H + '/dotfiles/zshrc'), 'export DOT=1\n' + block(h.snippet));
  run(h, 'uninstall');
  assert.equal(fs.lstatSync(h.H + '/.zshrc').isSymbolicLink(), true);
  assert.equal(read(h.H + '/dotfiles/zshrc'), 'export DOT=1\n');
  // A link to a file that holds only the block is emptied, never deleted (it is not one install created).
  fs.writeFileSync(h.H + '/dotfiles/zshrc', '');
  run(h, 'install');
  run(h, 'uninstall');
  assert.equal(fs.lstatSync(h.H + '/.zshrc').isSymbolicLink(), true);
  assert.equal(read(h.H + '/dotfiles/zshrc'), '');
});

test('a dangling link and a directory are refused, exit 3, nothing created through them', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.symlinkSync('missing-dotfiles/zshrc', h.H + '/.zshrc');
  const r = run(h, 'install');
  assert.equal(r.code, 3);
  assert.equal(r.out, 'REFUSE  ' + h.H + '/.zshrc is a symbolic link to a missing file; nothing written. Fix or remove the link, or add this line yourself:\n'
    + '        ' + handLine(h.snippet) + '\n');
  assert.equal(fs.existsSync(h.H + '/missing-dotfiles'), false);
  fs.mkdirSync(h.H + '/rc-dir');
  const d = run(h, 'install', { shellRc: h.H + '/rc-dir' });
  assert.equal(d.code, 3);
  assert.match(d.out, /^REFUSE {2}.*\/rc-dir is not a regular file; nothing written\. Add this line yourself:\n/);
});

test('two blocks and a damaged block are refused in every mode; nothing written or removed', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const rc = h.H + '/rc';
  for (const text of [block(h.snippet) + 'between\n' + block(h.snippet), 'x\n' + BEGIN + '\nmine\n', END + '\n' + BEGIN + '\n' + END + '\n', 'a\n' + END + '\n']) {
    fs.writeFileSync(rc, text);
    for (const mode of ['install', 'check', 'dry-run']) {
      const r = run(h, mode, { shellRc: rc });
      assert.equal(r.code, 3, mode);
      assert.equal(r.out, 'REFUSE  ' + rc + ": the paste-wrapper block's markers are damaged (missing, repeated or out of order); nothing written. Fix or remove them, then run install again\n");
      assert.equal(read(rc), text);
    }
    const u = run(h, 'uninstall', { shellRc: rc });
    assert.deepEqual([u.code, u.out], [3, 'REFUSE  ' + rc + ": the paste-wrapper block's markers are damaged; nothing removed\n"]);
    assert.equal(read(rc), text);
    assert.equal(fs.existsSync(rc + '.pmhwc-backup'), false);
  }
});

test('--shell-rc=none writes nothing and says so; uninstall still clears the default files', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  const r = run(h, 'install', { shellRc: 'none' });
  assert.equal(r.code, 0);
  assert.match(r.out, /^NOTE {4}automatic paste cleaning: no shell start-up file is written \(--shell-rc=none\); add this line to yours:\n/);
  assert.deepEqual(fs.readdirSync(h.H), []);
  assert.deepEqual(run(h, 'check', { shellRc: 'none' }), { code: 0, out: '', err: '' });
  fs.writeFileSync(h.H + '/.bash_login', 'export L=1\n' + block(h.snippet));
  run(h, 'uninstall', { shellRc: 'none' });
  assert.equal(read(h.H + '/.bash_login'), 'export L=1\n');
});

test('macOS bash: the login file gets the block; ~/.profile is never written and nothing is created to hide it', { skip: !POSIX && 'POSIX only' }, () => {
  const h = home();
  fs.writeFileSync(h.H + '/.profile', 'export OWNER_PROFILE=1\n');
  const r = run(h, 'install', { shell: '/bin/bash' });
  assert.equal(r.code, 0);
  assert.match(r.out, /^NOTE {4}automatic paste cleaning: no bash login start-up file is written \(for a bash login shell: only ~\/\.profile is there/m);
  assert.equal(read(h.H + '/.profile'), 'export OWNER_PROFILE=1\n');
  for (const f of ['.profile.pmhwc-backup', '.bash_profile', '.bash_login']) assert.equal(fs.existsSync(path.join(h.H, f)), false, f);
  assert.equal(read(h.H + '/.bashrc'), block(h.snippet));
  run(h, 'uninstall', { shell: '/bin/bash' });
  assert.equal(read(h.H + '/.profile'), 'export OWNER_PROFILE=1\n');
  // Only ~/.bash_login: it gets the block, and no ~/.bash_profile is created over it.
  const h2 = home();
  fs.writeFileSync(h2.H + '/.bash_login', 'export L=1\n');
  run(h2, 'install', { shell: '/bin/bash' });
  assert.equal(fs.existsSync(h2.H + '/.bash_profile'), false);
  assert.equal(read(h2.H + '/.bash_login'), 'export L=1\n' + block(h2.snippet));
  // None of the three: a new ~/.bash_profile, which uninstall deletes; an owner's empty one stays.
  const h3 = home();
  run(h3, 'install', { shell: '/bin/bash' });
  assert.equal(read(h3.H + '/.bash_profile'), block(h3.snippet));
  run(h3, 'uninstall', { shell: '/bin/bash' });
  assert.equal(fs.existsSync(h3.H + '/.bash_profile'), false);
  const h4 = home();
  fs.writeFileSync(h4.H + '/.bash_profile', '');
  run(h4, 'install', { shell: '/bin/bash' });
  run(h4, 'uninstall', { shell: '/bin/bash' });
  assert.equal(read(h4.H + '/.bash_profile'), '');
  // Linux: only ~/.bashrc.
  const h5 = home();
  fs.writeFileSync(h5.H + '/.bash_profile', 'export P=1\n');
  run(h5, 'install', { shell: '/bin/bash', uname: 'Linux' });
  assert.equal(read(h5.H + '/.bash_profile'), 'export P=1\n');
  assert.equal(read(h5.H + '/.bashrc'), block(h5.snippet));
});

test('another shell, or an empty SHELL, gets no file', { skip: !POSIX && 'POSIX only' }, () => {
  for (const shell of ['/usr/local/bin/fish', '']) {
    const h = home();
    const r = run(h, 'install', { shell });
    assert.match(r.out, new RegExp('^NOTE {4}automatic paste cleaning: no shell start-up file is written \\(your shell \\(SHELL=' + (shell ? '/usr/local/bin/fish' : 'unset') + '\\) is neither zsh nor bash\\)'));
    assert.deepEqual(fs.readdirSync(h.H), []);
  }
});

test('an unreadable start-up file is refused, exit 3, and left as it was', { skip: (!POSIX && 'POSIX only') || (ROOT_USER && 'root reads every file') }, () => {
  const h = home();
  fs.writeFileSync(h.H + '/.zshrc', 'secret\n' + block(h.snippet));
  fs.chmodSync(h.H + '/.zshrc', 0o000);
  for (const mode of ['install', 'uninstall']) {
    const r = run(h, mode);
    assert.equal(r.code, 3, mode);
    assert.match(r.out, /^REFUSE {2}.*\/\.zshrc: cannot be read \(EACCES\); nothing (written|removed)\n$/, mode);
  }
  fs.chmodSync(h.H + '/.zshrc', 0o600);
  assert.equal(read(h.H + '/.zshrc'), 'secret\n' + block(h.snippet));
});

test('a backup or a write that fails: one REFUSE line on stderr, exit 4, the file left as it was', { skip: (!POSIX && 'POSIX only') || (ROOT_USER && 'root writes every file') }, () => {
  const h = home();
  fs.mkdirSync(h.H + '/ro');
  fs.writeFileSync(h.H + '/ro/rc', 'export A=1\n');
  fs.chmodSync(h.H + '/ro', 0o555);
  const r = run(h, 'install', { shellRc: h.H + '/ro/rc' });
  assert.deepEqual([r.code, r.out, r.err], [4, '', 'REFUSE  ' + h.H + '/ro/rc.pmhwc-backup: the backup could not be created exclusively; no backup written\n']);
  assert.equal(read(h.H + '/ro/rc'), 'export A=1\n');
  // A file that is not writable: the backup is kept, the file is not changed.
  fs.chmodSync(h.H + '/ro', 0o755);
  fs.chmodSync(h.H + '/ro/rc', 0o444);
  const w = run(h, 'install', { shellRc: h.H + '/ro/rc' });
  assert.equal(w.code, 4);
  assert.match(w.err, /^REFUSE {2}.*\/ro\/rc: could not be written \(EACCES/);
  assert.equal(read(h.H + '/ro/rc'), 'export A=1\n');
  // A parent that is a file.
  fs.writeFileSync(h.H + '/plain', 'x');
  const p = run(h, 'install', { shellRc: h.H + '/plain/rc' });
  assert.equal(p.code, 4);
  assert.match(p.err, /^REFUSE {2}.*\/plain\/rc: could not be written \(/);
});

test('usage: every option once, a known mode, an absolute --shell-rc, HOME set', () => {
  /** @param {string[]} argv @param {Record<string, string>} [env] */
  const code = (argv, env = { HOME: '/nonexistent-s21' }) => main(argv, { out: () => {}, err: () => {}, env });
  const ok = ['--mode=check', '--shell-rc=none', '--shell=/bin/zsh', '--snippet=/s', '--data-dir=/d', '--uname=Linux'];
  assert.equal(code(ok), 0);
  assert.equal(code(ok.slice(1)), 2);
  assert.equal(code([...ok, '--mode=check']), 2);
  assert.equal(code(['--mode=other', ...ok.slice(1)]), 2);
  assert.equal(code([ok[0], '--shell-rc=relative', ...ok.slice(2)]), 2);
  assert.equal(code([...ok.slice(0, 3), '--snippet=', ...ok.slice(4)]), 2);
  assert.equal(code([...ok, '--other=1']), 2);
  assert.equal(code(ok, {}), 2);
});
