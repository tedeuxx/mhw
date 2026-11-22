// S25 (#503): the acceptance criteria the golden scenarios do not pin by name, and the declared differences
// of test/golden/S25/expected-differences.json that no scenario exercises. POSIX only, as the user layer is.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { USAGE, parseFloor, pasteWrap, isManaged } from '../../src/commands/install-user.js';
import { readGolden } from '../helpers/golden.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MHW = path.join(ROOT, 'bin', 'mhw.js');
const MARKER = 'managed-by: personal-multi-harness-workstation-configuration';
const POSIX = process.platform !== 'win32';
const skip = !POSIX && 'POSIX only';
const T = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's25-declared-')));
after(() => fs.rmSync(T, { recursive: true, force: true }));

/** @param {string} home @param {string[]} args @param {Record<string, string>} [extra] */
function inst(home, args, extra = {}) {
  fs.mkdirSync(home, { recursive: true });
  const env = { PATH: process.env.PATH || '', HOME: home, LANG: 'C', SHELL: '/bin/zsh', TMPDIR: T, MHW_NODE: process.execPath, ...extra };
  return spawnSync(process.execPath, [MHW, 'install-user', ...args, '--managed-root=' + path.join(T, 'admin')], { env, encoding: 'utf8', timeout: 120000 });
}

/** A hash of every path, kind, mode and content under dir. @param {string} dir */
function treeHash(dir) {
  const h = crypto.createHash('sha256');
  const walk = (/** @type {string} */ rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort((a, b) => (a < b ? -1 : Number(a > b)))) {
      const r = path.join(rel, name);
      const st = fs.lstatSync(path.join(dir, r));
      h.update(r + '\0' + st.mode + '\0');
      if (st.isDirectory()) walk(r);
      else if (st.isSymbolicLink()) h.update(fs.readlinkSync(path.join(dir, r)));
      else h.update(fs.readFileSync(path.join(dir, r)));
    }
  };
  walk('');
  return h.digest('hex');
}

test('declared: --help prints the usage text and exits 0', { skip }, () => {
  const h = path.join(T, 'help');
  for (const args of [['--help'], ['-h'], ['--help', '--bogus'], ['--dry-run', '--help']]) {
    const p = inst(h, args);
    assert.equal(p.status, 0, args.join(' '));
    assert.equal(p.stdout, USAGE);
  }
  const p = inst(h, ['--bogus', '--help']);
  assert.equal(p.status, 2);
  assert.equal(p.stderr, 'unknown argument: --bogus\n');
  assert.deepEqual(fs.readdirSync(h), []);
  assert.ok(readGolden('S25', 'expected-differences.json').some((/** @type {{ name: string }} */ e) => e.name === '--help prints the Node usage text'));
});

test('dry-run writes nothing: the file tree hashes the same before and after, on a fresh HOME and an installed one', { skip }, () => {
  const h = path.join(T, 'dry');
  fs.mkdirSync(path.join(h, '.claude'), { recursive: true });
  fs.writeFileSync(path.join(h, '.claude', 'settings.json'), '{"theme": "dark"}\n');
  fs.writeFileSync(path.join(h, '.zshrc'), 'export MINE=1\n');
  for (const step of ['fresh', 'installed']) {
    const before = treeHash(h);
    const p = inst(h, ['--dry-run']);
    assert.equal(p.status, 0, p.stderr);
    assert.equal(treeHash(h), before, step + ': dry-run changed the tree');
    if (step === 'fresh') assert.equal(inst(h, []).status, 0);
  }
});

test('exit codes 0, 1, 2 and 3 keep their meanings', { skip }, () => {
  const table = [
    { code: 0, why: 'ok: a fresh install', setup: () => {}, args: [] },
    { code: 1, why: 'drift, stamp or missing under --check', setup: () => {}, args: ['--check'] },
    { code: 2, why: 'usage', setup: () => {}, args: ['--bogus'] },
    { code: 2, why: 'an invalid floor entry', setup: (/** @type {string} */ h) => fs.writeFileSync(path.join(h, 'ov', 'deny-floor.conf'), 'cmd a*\n'), args: ['--overlay=OV'] },
    { code: 2, why: 'a missing dependency (no node)', setup: () => {}, args: [], env: { MHW_NODE: '/nonexistent/node' } },
    // QA R3 on PR #546: a retired file of ours still on disk is drift under --check (STALE), never a clean 0.
    { code: 1, why: 'a stale retired file under --check, on an otherwise clean install', setup: (/** @type {string} */ h) => {
      assert.equal(inst(h, ['--overlay=none']).status, 0);
      assert.equal(inst(h, ['--check', '--overlay=none']).status, 0, 'calibration: the install alone checks clean');
      const d = path.join(h, '.local', 'share', 'personal-multi-harness-workstation-configuration');
      fs.writeFileSync(path.join(d, 'hitl.conf'), '# ' + MARKER + '; source: x\n');
    }, args: ['--check'] },
    { code: 3, why: 'something unmanaged in the way', setup: (/** @type {string} */ h) => fs.writeFileSync(path.join(h, '.claude', 'CLAUDE.md'), 'mine\n'), args: [] },
    { code: 3, why: 'something unreadable in the way', setup: (/** @type {string} */ h) => fs.writeFileSync(path.join(h, '.claude', 'settings.json'), '{ "x": \n'), args: [] },
  ];
  for (const [i, row] of table.entries()) {
    const h = path.join(T, 'exit-' + i);
    fs.mkdirSync(path.join(h, '.claude'), { recursive: true });
    fs.mkdirSync(path.join(h, 'ov'), { recursive: true });
    row.setup(h);
    const args = row.args.map((a) => a.replace('OV', path.join(h, 'ov')));
    if (!args.some((a) => a.startsWith('--overlay'))) args.push('--overlay=none');
    const p = inst(h, args, row.env);
    assert.equal(p.status, row.code, row.why + ': ' + p.stdout + p.stderr);
  }
});

test('a file is managed only with the marker in its first five lines', () => {
  const dir = fs.mkdtempSync(path.join(T, 'marker-'));
  for (const [n, want] of [[1, true], [5, true], [6, false]]) {
    const f = path.join(dir, 'f' + n);
    fs.writeFileSync(f, 'x\n'.repeat(Number(n) - 1) + '# ' + MARKER + '\n');
    assert.equal(isManaged(f), want, 'marker on line ' + n);
  }
  assert.equal(isManaged(path.join(dir, 'absent')), false);
  assert.equal(isManaged(dir), false, 'a directory is never managed');
});

test('the deny floor parser renders and refuses as install.sh\'s awk did', () => {
  const ok = parseFloor('# c\n\ncmd git push --force\r\nglob terraform -chdir=*\nfile ~/.ssh/id_*\n');
  assert.deepEqual(ok, { claude: ['Bash(git push --force:*)', 'Bash(terraform -chdir=*)', 'Read(~/.ssh/id_*)', 'Edit(~/.ssh/id_*)'], codex: ['git push --force'], errors: [] });
  assert.deepEqual(parseFloor('# only\n').errors, ['the deny floor has no entry']);
  // QA F8 on PR #546: the kind list is exactly cmd, file and glob; every other first word is refused.
  for (const kind of ['deny', 'allow', 'path', 'read', 'edit', 'Cmd', 'CMD', 'File', 'GLOB', 'cmd:', 'cmds', 'globs', '-', '#cmd']) {
    const r = parseFloor(kind + ' x\n');
    if (kind.startsWith('#')) assert.deepEqual(r.errors, ['the deny floor has no entry'], kind);
    else assert.deepEqual(r.errors, ['invalid deny-floor entry (kind must be cmd, file or glob): ' + kind + ' x'], kind);
  }
  for (const kind of ['cmd', 'glob', 'file']) {
    assert.deepEqual(parseFloor(kind + (kind === 'glob' ? ' a b*' : ' x') + '\n').errors, [], kind + ' is a kind');
  }
  assert.deepEqual(parseFloor('path x\ncmd\nfile a b\nglob t\ncmd a"b\ncmd a*\nglob a *b\nglob a b**\nglob a b:*\n').errors, [
    'invalid deny-floor entry (kind must be cmd, file or glob): path x', 'invalid deny-floor entry (no words): cmd',
    'invalid deny-floor entry (a file entry takes one path): file a b', 'invalid deny-floor entry (a glob entry takes a program and at least one word): glob t',
    'invalid deny-floor entry (word outside the allowed set): cmd a"b', 'invalid deny-floor entry (a cmd word may not hold *): cmd a*',
    'invalid deny-floor entry (a glob holds * only at the end of its last word): glob a *b', 'invalid deny-floor entry (a glob holds * only at the end of its last word): glob a b**',
    'invalid deny-floor entry (a glob may not end in :* (that is a cmd entry)): glob a b:*']);
});

test('the start fallback means the same through a shell: Kiro exits 2 with the notice, the others print it and exit 0', { skip }, () => {
  for (const [harness, code, out, err] of [['kiro', 2, '', 'NOT checked'], ['claude', 0, 'systemMessage', '']]) {
    const p = spawnSync('/bin/sh', ['-c', pasteWrap(/** @type {string} */ (harness), '/nonexistent/node')], { encoding: 'utf8' });
    assert.equal(p.status, code, String(harness));
    if (out) assert.equal(JSON.parse(p.stdout).systemMessage, 'Paste filter (ADR-0033): internal error (HookStartError); this prompt was NOT checked.');
    else assert.equal(p.stdout, '');
    if (err) assert.ok(p.stderr.includes(String(err)));
  }
  const pass = spawnSync('/bin/sh', ['-c', pasteWrap('kiro', 'exit 2')], { encoding: 'utf8' });
  assert.equal(pass.status, 2);
  assert.equal(pass.stderr, '');
});
