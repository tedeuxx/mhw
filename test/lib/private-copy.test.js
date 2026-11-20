// privateCopy against install.sh's shell form, private_copy(), on the cases of the deleted
// global/private_copy_test.py (#484 deleted it with global/private_copy.py, its last Python user, S13 of
// #470): both forms run on identical fixtures and must leave identical outcomes (exit, and every entry in
// the directory: kind, mode, bytes or link target). POSIX only, like the fixtures (FIFOs, symlinks, modes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { FLAGS } from '../../src/lib/private-copy.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SH = which('sh');
const POSIX = process.platform !== 'win32';
const skip = !POSIX ? 'POSIX fixtures (FIFOs, modes)' : !SH ? 'needs sh for the shell half' : false;
const INSTALL_SH = path.join(ROOT, 'global', 'install.sh');

// The CASES of the deleted global/private_copy_test.py's SameBehaviour, by the same names.
/** @type {Record<string, { srcBytes?: string, srcMode?: number, atDst?: string }>} */
const CASES = {
  'nothing at the destination': {},
  'a 0600 empty source': { srcBytes: '', srcMode: 0o600 },
  'a 0444 source': { srcMode: 0o444 },
  'an older backup': { atDst: 'file' },
  'a read-only older backup': { atDst: 'readonly' },
  'a hard link at the destination': { atDst: 'hardlink' },
  'a symbolic link at the destination': { atDst: 'symlink' },
  'a dangling symbolic link at the destination': { atDst: 'dangling' },
  'a FIFO at the destination': { atDst: 'fifo' },
  'a symbolic link to a FIFO at the destination': { atDst: 'link-to-fifo' },
  'a symbolic link to /dev/null at the destination': { atDst: 'link-to-device' },
};
const SRC = Buffer.from('rules: [mine]\n\xff\x00 not utf-8\n', 'latin1');

/**
 * @param {string} base
 * @param {{ srcBytes?: string, srcMode?: number, atDst?: string }} kw
 */
function fixture(base, kw) {
  const dir = fs.mkdtempSync(path.join(base, 'case-'));
  const src = path.join(dir, 'settings.json');
  fs.writeFileSync(src, kw.srcBytes === undefined ? SRC : Buffer.from(kw.srcBytes));
  fs.chmodSync(src, kw.srcMode ?? 0o644);
  const dst = path.join(dir, 'settings.json.pmhwc-backup');
  const victim = path.join(dir, 'victim');
  const mkfifo = (/** @type {string} */ p) => assert.equal(spawnSync(/** @type {string} */ (which('mkfifo')), ['-m', '644', p]).status, 0);
  switch (kw.atDst) {
    case 'file': fs.writeFileSync(dst, 'an older backup\n'); fs.chmodSync(dst, 0o644); break;
    case 'readonly': fs.writeFileSync(dst, 'an older backup\n'); fs.chmodSync(dst, 0o400); break;
    case 'hardlink': fs.writeFileSync(victim, 'the other name of the same file\n'); fs.linkSync(victim, dst); break;
    case 'symlink': fs.writeFileSync(victim, 'a file the link points at\n'); fs.symlinkSync('victim', dst); break;
    case 'dangling': fs.symlinkSync('victim', dst); break;
    case 'fifo': mkfifo(dst); break;
    case 'link-to-fifo': mkfifo(victim); fs.symlinkSync('victim', dst); break;
    case 'link-to-device': fs.symlinkSync('/dev/null', dst); break;
    default: break;
  }
  return { dir, src, dst, victim };
}

/** Everything a form can change: every entry in the directory. @param {string} dir */
function outcome(dir) {
  /** @type {Record<string, [string, string, string]>} */
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    const mode = (st.mode & 0o777).toString(8);
    if (st.isSymbolicLink()) out[name] = ['link', mode, fs.readlinkSync(p)];
    else if (st.isFIFO()) out[name] = ['fifo', mode, ''];
    else if (st.isDirectory()) out[name] = ['dir', mode, fs.readdirSync(p).sort().join('|')];
    else out[name] = ['file', mode, fs.readFileSync(p).toString('base64')];
  }
  return out;
}

/** @param {string} src @param {string} dst @param {string} [plant] shell run when the destination is checked */
// In its own process with a timeout, like the Python form: a copy that opened a FIFO for writing would
// block, and a blocked child fails the test instead of hanging the runner.
function runNode(src, dst, plant) {
  const driver = path.join(ROOT, 'test', 'helpers', 'private-copy-driver.js');
  const p = spawnSync(process.execPath, [driver, src, dst, plant ?? '-'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(p.status, 0, 'the Node form blocked or crashed: ' + (p.signal || p.stderr));
  return Number(p.stdout.trim());
}

/** install.sh's private_copy() function: the text between its header and its closing brace. */
function shellForm() {
  const m = /^private_copy\(\) \{\n[\s\S]*?^\}\n/m.exec(fs.readFileSync(INSTALL_SH, 'utf8'));
  assert.ok(m, 'install.sh defines no private_copy() function');
  return m[0];
}

// The shell form, with the same plant: run inside mktemp, after the absence check and before the
// exclusive link, which is where the Node form's plant runs too (inside its lexists check). The shell form
// calls mktemp under umask 077; the plant runs under this process's own umask, as the Node form's does.
/** @param {string} src @param {string} dst @param {string} [plant] */
function runShell(src, dst, plant) {
  const umask = process.umask().toString(8).padStart(3, '0');
  const prelude = plant ? 'mktemp() { (umask ' + umask + ' && cd "${PC_DST%/*}" && ' + plant + ') || exit 3; command mktemp "$@"; }\n' : '';
  const script = shellForm() + prelude + 'if private_copy "$1" "$2" 2>/dev/null; then echo 0; else echo 1; fi\n';
  const p = spawnSync(/** @type {string} */ (SH), ['-c', script, 'sh', src, dst], { encoding: 'utf8', timeout: 20000, env: { ...process.env, PC_DST: dst } });
  assert.equal(p.status, 0, 'the shell form blocked or crashed: ' + (p.signal || p.stderr));
  return Number(p.stdout.trim());
}

function base() {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-private-copy-')));
}

test('the Node form opens write-only, create, exclusive and no-follow', { skip: !POSIX && 'POSIX' }, () => {
  const C = fs.constants;
  assert.equal(FLAGS, C.O_WRONLY | C.O_CREAT | C.O_EXCL | C.O_NOFOLLOW);
});

test('the Node form and the shell form give the same result on every case', { skip, timeout: 60000 }, () => {
  const b = base();
  try {
    for (const [name, kw] of Object.entries(CASES)) {
      const n = fixture(b, kw);
      const codeNode = runNode(n.src, n.dst);
      const py = fixture(b, kw);
      const codePy = runShell(py.src, py.dst);
      assert.deepEqual([codeNode, outcome(n.dir)], [codePy, outcome(py.dir)], name + ': node and shell differ');
      assert.equal(codeNode, 0, name);
      const got = outcome(n.dir)['settings.json.pmhwc-backup'];
      assert.deepEqual(got, ['file', '600', fs.readFileSync(n.src).toString('base64')], name);
      if (kw.atDst === 'hardlink' || kw.atDst === 'symlink') {
        assert.notEqual(outcome(n.dir).victim[2], fs.readFileSync(n.src).toString('base64'), name + ': written through');
      }
      if (kw.atDst === 'dangling') assert.ok(!('victim' in outcome(n.dir)), name + ': the dangling target was created');
    }
  } finally {
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('anything planted between the check and the create is refused by both forms, and left as it was', { skip, timeout: 60000 }, () => {
  const plants = {
    'a link to a FIFO': 'mkfifo victim-fifo && ln -s victim-fifo "$PC_DST"',
    'a link to /dev/null': 'ln -s /dev/null "$PC_DST"',
    'a link to a directory': 'mkdir victim-dir && ln -s victim-dir "$PC_DST"',
    'a FIFO': 'mkfifo "$PC_DST"',
    'a directory': 'mkdir "$PC_DST"',
    'a file': 'echo planted > "$PC_DST"',
  };
  const b = base();
  try {
    for (const [name, plant] of Object.entries(plants)) {
      const n = fixture(b, {});
      const codeNode = runNode(n.src, n.dst, plant);
      const py = fixture(b, {});
      const codePy = runShell(py.src, py.dst, plant);
      assert.deepEqual([codeNode, outcome(n.dir)], [codePy, outcome(py.dir)], name + ': node and shell differ');
      assert.equal(codeNode, 1, name + ': the copy was not refused');
    }
  } finally {
    fs.rmSync(b, { recursive: true, force: true });
  }
});

test('install.sh holds the one shell form, and no Python file of this repository defines a copy of its own', () => {
  /** @type {string[]} */
  const hits = [];
  for (const name of fs.readdirSync(path.join(ROOT, 'global')).filter((n) => n.endsWith('.sh') && !n.endsWith('.test.sh'))) {
    if (/^\s*private_copy\(\)/m.test(fs.readFileSync(path.join(ROOT, 'global', name), 'utf8'))) hits.push(name);
  }
  assert.deepEqual(hits, ['install.sh']);
  /** @param {string} d @returns {string[]} */
  const py = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? py(path.join(d, e.name)) : e.name.endsWith('.py') ? [path.join(d, e.name)] : []));
  const own = py(path.join(ROOT, 'global')).filter((f) => /^\s*def private_copy\(/m.test(fs.readFileSync(f, 'utf8')));
  assert.deepEqual(own, [], 'a Python step defines its own private copy');
});
