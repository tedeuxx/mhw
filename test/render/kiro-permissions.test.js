// The cases of global/kiro/kiro_permissions_test.py (#482, S11 of #470), as node:test, on the Node renderer
// (src/render/kiro-permissions.js) and its reader (src/lib/yaml-subset.js), in throwaway HOMEs only
// (ADR-0036, Issue #144). No Kiro runs here; the rule engine is outside this suite. Where the Python suite
// replaced a module function to land a step at a chosen moment (a lock Kiro reclaims, a release that
// fails, a serialiser that breaks), this one passes the same function through main's ops seam.
// kiro-permissions-golden.test.js holds the same renderer to the original's recorded transcripts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, scalar, Refuse, splitlines, notAString } from '../../src/lib/yaml-subset.js';
import * as kp from '../../src/render/kiro-permissions.js';
import { STAMP, OTHER, FLOOR, OWNER, OWNER_RULES, kiroStyle, FOLDED } from './kiro-cases.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'src', 'render', 'kiro-permissions.js');
const REPO_FLOOR = path.join(ROOT, 'global', 'deny-floor.conf');
const POSIX = process.platform !== 'win32';
const NAME = 'personal-multi-harness-workstation-configuration';
const MARKER_ID = 'managed-by: ' + NAME;
/** @param {string} p */
const mode = (p) => fs.statSync(p).mode & 0o777;

/**
 * @typedef {{ home: string, path: string, floor: string, owned: string, lock: string,
 *   env: Record<string, string> }} Home
 */

/** A fresh throwaway HOME with the test floor. @returns {Home} */
function fresh() {
  const home = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-kiro-')));
  test.after?.(() => fs.rmSync(home, { recursive: true, force: true }));
  const p = path.join(home, '.kiro', 'settings', 'permissions.yaml');
  fs.writeFileSync(path.join(home, 'floor.conf'), FLOOR);
  return {
    home, path: p, floor: path.join(home, 'floor.conf'), lock: p + '.lock',
    owned: path.join(home, '.local', 'share', NAME, 'kiro-permissions-owned.json'),
    env: { HOME: home, USERPROFILE: home },
  };
}

/**
 * main() in process. -> [exit code, stdout + stderr]
 * @param {Home} h @param {string} m @param {{ stamp?: string, floor?: string, ops?: Partial<kp.Ops>, extra?: string[] }} [o]
 * @returns {[number, string]}
 */
function runMode(h, m, o = {}) {
  let out = '';
  const code = kp.main(['--mode=' + m, '--stamp=' + (o.stamp || STAMP), '--floor=' + (o.floor || h.floor), ...(o.extra || [])],
    { out: (s) => { out += s; }, err: (s) => { out += s; }, env: h.env, ops: o.ops });
  return [code, out];
}

/** @param {Home} h */
const rules = (h) => parse(fs.readFileSync(h.path, 'utf8')).rules;
/** @param {Home} h @param {string} [text] */
function ownerFile(h, text = OWNER) {
  fs.mkdirSync(path.dirname(h.path), { recursive: true });
  fs.writeFileSync(h.path, text);
  fs.chmodSync(h.path, 0o644);
}
/** @param {Home} h @param {import('../../src/lib/yaml-subset.js').Rule[]} r */
const put = (h, r) => fs.writeFileSync(h.path, kp.emit({ rules: r, policies: null }, STAMP, 'x', false));
/** @param {Home} h */
const record = (h) => JSON.parse(fs.readFileSync(h.owned, 'utf8')).appended;
/** @param {Home} h */
const ctx = (h) => kp.context({ env: h.env, out: () => {}, err: () => {} });

const FLOOR_RULES = [
  { capability: 'shell', effect: 'deny', match: ['sudo *', 'gh auth token *', 'terraform -chdir=*'] },
  { capability: 'fs_read', effect: 'deny', match: ['~/.ssh/id_*', '**/.env'] },
  { capability: 'fs_write', effect: 'deny', match: ['~/.ssh/id_*', '**/.env'] },
];

// --- Floor ----------------------------------------------------------------------------------------------

test('floor: entries render to Kiro patterns', () => {
  const h = fresh();
  const want = kp.loadFloor(h.floor);
  assert.deepEqual(want.shell, ['sudo *', 'gh auth token *', 'terraform -chdir=*']);
  assert.deepEqual(want.fs_read, ['~/.ssh/id_*', '**/.env']);
  assert.deepEqual(want.fs_write, want.fs_read);
});

test('floor: the repository floor loads whole', () => {
  const want = kp.loadFloor(REPO_FLOOR);
  const lines = fs.readFileSync(REPO_FLOOR, 'utf8').split(/\r?\n/).filter((l) => l.trim() && !l.trimStart().startsWith('#')).map((l) => l.trim().split(/\s+/));
  assert.equal(want.shell.length, new Set(lines.filter((f) => f[0] === 'cmd' || f[0] === 'glob').map((f) => f.slice(1).join(' '))).size);
  assert.equal(want.fs_read.length, new Set(lines.filter((f) => f[0] === 'file').map((f) => f[1])).size);
  assert.ok(want.shell.every((p) => p.endsWith('*')));
});

test('floor: an invalid entry, a cmd word with a star, a two-path file entry and an empty floor are refused', () => {
  const h = fresh();
  for (const [text, msg] of [['cmd rm -rf $HOME\n', 'invalid deny-floor entry: cmd rm -rf $HOME'], ['cmd rm -rf *\n', 'a cmd word may not hold *: cmd rm -rf *'],
    ['file a b\n', 'a file entry takes one path: file a b'], ['# none\n', 'the deny floor has no entry']]) {
    fs.writeFileSync(h.floor, text);
    assert.throws(() => kp.loadFloor(h.floor), (e) => e instanceof kp.FloorError && e.message === msg, text);
  }
});

// --- Reader ---------------------------------------------------------------------------------------------

test('reader: the owner style reads', () => {
  assert.deepEqual(parse(OWNER).rules, OWNER_RULES);
});

test('reader: the vendor examples read (kiro.dev/docs/permissions, 2026-10-11)', () => {
  const doc = parse('rules:\n  - capability: fs_write\n    match: ["*.env", "*.pem", "*.key"]\n    effect: deny\n'
    + '  - capability: shell\n    match: ["rm -rf *", "sudo *"]\n    effect: deny\n  - capability: fs_read\n    effect: allow\n');
  assert.deepEqual(doc.rules[1], { capability: 'shell', effect: 'deny', match: ['rm -rf *', 'sudo *'] });
  assert.deepEqual(doc.rules[2], { capability: 'fs_read', effect: 'allow' });
});

test('reader: compact sequences read', () => {
  assert.deepEqual(parse('rules:\n- capability: shell\n  match:\n  - git *\n  effect: allow\n').rules,
    [{ capability: 'shell', effect: 'allow', match: ['git *'] }]);
});

test('reader: an empty file, and policies', () => {
  assert.deepEqual(parse(''), { rules: [], policies: null });
  assert.deepEqual(parse('policies: [read-only]\nrules: []\n'), { rules: [], policies: ['read-only'] });
});

test('reader: a document round-trips through emit', () => {
  const doc = parse(OWNER);
  assert.deepEqual(parse(kp.emit(doc, STAMP, 'x')), doc);
  const withPolicies = parse('policies: [a, "b c"]\nrules: []\n');
  assert.deepEqual(parse(kp.emit(withPolicies, STAMP, 'x', false)), withPolicies);
});

test('reader: what Kiro would reject, and what is outside the subset, is refused', () => {
  for (const bad of ['rules:\n  - capability: shell\n    effect: deny\n    note: x\n', 'rules:\n  - capability: shell\n    effect: block\n',
    'rules:\n  - effect: deny\n', 'rules:\n  - &a capability: shell\n    effect: deny\n', 'rules:\n  - capability: shell\n    match: [*x]\n    effect: deny\n',
    'rules:\n  - {capability: shell, effect: deny}\n', 'rules:\n  - capability: shell\n    match: |\n      x\n    effect: deny\n',
    'rules:\n  - capability: true\n    effect: deny\n', 'other: 1\nrules: []\n', 'rules: 3\n']) {
    assert.throws(() => parse(bad), Refuse, bad);
  }
});

test('reader: every YAML 1.1 implicit type is refused, never re-quoted (PR #150 QA B1)', () => {
  const rows = [['bool', 'Yes'], ['bool', 'OFF'], ['float', '1.5e3'], ['float', '-.INF'], ['float', '190:20:30.15'], ['int', '0x1F'],
    ['int', '0b1010'], ['int', '190:20:30'], ['int', '685_230'], ['int', '02472256'], ['merge', '<<'], ['null', '~'], ['null', 'NULL'],
    ['timestamp', '2026-10-11'], ['timestamp', '2001-12-14t21:59:43.10-05:00'], ['timestamp', '2001-12-14T21:59:43.10Z'],
    ['timestamp', '2001-12-14 21:59:43.10 -5'], ['value', '=']];
  for (const [typ, tok] of rows) {
    assert.throws(() => scalar(tok, 1), Refuse, typ + ' ' + tok);
    assert.throws(() => parse('rules:\n  - capability: shell\n    match:\n      - ' + tok + '\n    effect: deny\n'), Refuse, typ + ' ' + tok + ' in a document');
  }
  assert.equal(scalar('git *', 1), 'git *');
});

test('reader: a plain scalar that is not a string is refused in every position; a string is kept (PR #150 advisory 2)', () => {
  for (const tok of ['.5', '1e3', '0x1F', '0o7', '0b101', '.inf', '-.INF', '.nan', '.NaN', '~', 'null', 'NULL', 'nUlL', 'true', 'TrUe', 'FALSE', 'yes',
    'Off', '1_000', '-1', '+.5', '1.', '12:30', '3E-2']) {
    for (const doc of ['rules:\n  - capability: ' + tok + '\n    effect: deny\n', 'rules:\n  - capability: shell\n    match: [' + tok + ']\n    effect: deny\n',
      'rules:\n  - capability: shell\n    match:\n      - ' + tok + '\n    effect: deny\n']) {
      assert.throws(() => parse(doc), Refuse, doc);
    }
  }
  for (const tok of ['git *', 'e5', 'v1.2', 'true-ish', '1a', '.', 'nullx', '~/x']) {
    assert.deepEqual(parse('rules:\n  - capability: shell\n    match:\n      - ' + tok + '\n    effect: deny\n').rules[0].match, [tok]);
  }
});

test('reader: splitlines and the implicit-type check follow Python', () => {
  assert.deepEqual(splitlines('a\r\nb\rc\nd\x85e f g\vh\fi\x1cj\x1dk\x1el\x1fm\n'), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k', 'l\x1fm']);
  assert.deepEqual(splitlines(''), []);
  assert.deepEqual(splitlines('\n'), ['']);
  assert.deepEqual(splitlines('a\n\n'), ['a', '']);
  assert.equal(notAString('2026-01-01t01:00:00'), true);
  assert.equal(notAString('2026-01-01 01:00:00'), true);
  assert.equal(notAString('2026-01-01x01:00:00'), false);
});

// --- Install --------------------------------------------------------------------------------------------

test('install: a fresh home checks MISSING, dry-runs, installs 0600, settles and reports', () => {
  const h = fresh();
  assert.deepEqual(runMode(h, 'check'), [1, 'MISSING ' + h.path + '\n']);
  const [dc, dout] = runMode(h, 'dry-run');
  assert.equal(dc, 0, dout);
  assert.ok(dout.includes('  + shell deny sudo *'));
  assert.ok(!fs.existsSync(h.path));
  const [ic, iout] = runMode(h, 'install');
  assert.equal(ic, 0, iout);
  assert.ok(iout.includes('MERGED  ' + h.path + ' (new file; 7 deny-floor patterns)'), iout);
  if (POSIX) {
    assert.equal(mode(h.path), 0o600);
    assert.equal(mode(path.dirname(h.path)), 0o700);
  }
  assert.deepEqual(rules(h), FLOOR_RULES);
  assert.ok(fs.readFileSync(h.path, 'utf8').split('\n')[0].includes(STAMP));
  const [cc, cout] = runMode(h, 'check');
  assert.equal(cc, 0);
  assert.ok(cout.startsWith('OK      '), cout);
  const before = fs.readFileSync(h.path);
  assert.equal(runMode(h, 'install')[0], 0);
  assert.deepEqual(fs.readFileSync(h.path), before);
  assert.ok(runMode(h, 'report')[1].includes('FLOOR   Kiro: user permissions.yaml 7/7 floor patterns'));
});

test('install: the owner\'s rules are kept, the backup is 0600, uninstall removes only ours', () => {
  const h = fresh();
  ownerFile(h);
  const [cc, cout] = runMode(h, 'check');
  assert.equal(cc, 1);
  assert.ok(cout.includes('DRIFT   ' + h.path + ' (6 deny-floor pattern(s) missing; none)'), cout);
  const [ic, iout] = runMode(h, 'install');
  assert.equal(ic, 0, iout);
  assert.ok(iout.includes('6 deny-floor pattern(s) added'));
  const r = rules(h);
  assert.deepEqual(r.slice(0, 3), OWNER_RULES);
  assert.deepEqual(r[3].match, ['gh auth token *', 'terraform -chdir=*']); // sudo * was his already
  const backup = h.path + '.pmhwc-backup';
  assert.equal(fs.readFileSync(backup, 'utf8'), OWNER);
  if (POSIX) {
    assert.equal(mode(h.path), 0o644);
    assert.equal(mode(backup), 0o600);
  }
  assert.deepEqual(record(h)[0], { capability: 'shell', match: ['gh auth token *', 'terraform -chdir=*'] });
  const [uc, uout] = runMode(h, 'uninstall');
  assert.equal(uc, 0, uout);
  assert.ok(uout.includes('UNMERGED'));
  assert.deepEqual(rules(h), OWNER_RULES); // his own "sudo *" deny stays
  assert.ok(!fs.existsSync(h.owned));
});

test('install: a plain Kiro rewrite reads STAMP, then install restamps', () => {
  const h = fresh();
  runMode(h, 'install');
  fs.writeFileSync(h.path, kiroStyle('      - ls *\n'));
  const [cc, cout] = runMode(h, 'check');
  assert.equal(cc, 1);
  assert.ok(cout.includes('STAMP   ' + h.path + ': the deny-floor patterns match, but it carries (none)'), cout);
  assert.ok(runMode(h, 'install')[1].includes('RESTAMPED'));
  assert.equal(runMode(h, 'check')[0], 0);
  assert.ok(rules(h).some((x) => JSON.stringify(x) === JSON.stringify({ capability: 'shell', effect: 'allow', match: ['ls *'] })));
});

test('install: a folded or unquoted-yes Kiro rewrite is refused with its cause and the remedy', () => {
  for (const tail of [FOLDED, '      - yes\n']) {
    const h = fresh();
    runMode(h, 'install');
    fs.writeFileSync(h.path, kiroStyle(tail));
    const before = fs.readFileSync(h.path);
    for (const m of ['check', 'install']) {
      const [code, out] = runMode(h, m);
      assert.equal(code, 3, out);
      assert.ok(out.includes('Kiro probably rewrote this file'));
      assert.ok(out.includes('Put each pattern on one line, quoted'));
    }
    assert.deepEqual(fs.readFileSync(h.path), before);
  }
});

test('lock: a held Kiro lock refuses, writes nothing and is never taken away', () => {
  const h = fresh();
  ownerFile(h);
  fs.mkdirSync(h.lock);
  const before = fs.readFileSync(h.path);
  for (const m of ['install', 'uninstall']) {
    const [code, out] = runMode(h, m);
    assert.equal(code, 3, out);
    assert.ok(out.includes('lock ' + h.lock + ' is held'), out);
  }
  assert.deepEqual(fs.readFileSync(h.path), before);
  assert.ok(!fs.existsSync(h.owned));
  assert.ok(fs.statSync(h.lock).isDirectory());
  fs.rmdirSync(h.lock);
  assert.equal(runMode(h, 'install')[0], 0);
  assert.ok(!fs.existsSync(h.lock)); // ours is released
});

/** Kiro reclaims the lock: a new directory, made before ours is removed, so its inode differs. @param {Home} h */
function reclaim(h) {
  const other = path.join(h.home, 'kiro-made-this');
  fs.mkdirSync(other);
  fs.rmdirSync(h.lock);
  fs.renameSync(other, h.lock);
}

test('lock: a lock Kiro reclaimed is never removed (PR #150 QA L1)', () => {
  const h = fresh();
  ownerFile(h);
  let out = '';
  const c = kp.context({ env: h.env, out: (s) => { out += s; } });
  kp.withKiroLock(h.path, c, () => {
    assert.ok(fs.statSync(h.lock).isDirectory());
    reclaim(h);
  });
  assert.ok(fs.statSync(h.lock).isDirectory(), out);
  assert.ok(out.includes('is no longer the one mhw took'), out);
});

test('lock: a lock gone before the release is a NOTE', () => {
  const h = fresh();
  ownerFile(h);
  let out = '';
  const c = kp.context({ env: h.env, out: (s) => { out += s; } });
  assert.equal(kp.withKiroLock(h.path, c, () => {
    fs.rmdirSync(h.lock);
    return 7;
  }), 7);
  assert.ok(out.includes("NOTE    Kiro's lock " + h.lock + ' was gone before mhw released it; nothing removed'), out);
});

test('lock: no settings directory, no lock and no directory made', () => {
  const h = fresh();
  assert.equal(kp.withKiroLock(h.path, ctx(h), () => fs.existsSync(path.dirname(h.path))), false);
  assert.ok(!fs.existsSync(path.dirname(h.path)));
});

test('lock: a failed release after a good write is a NOTE, not a crash (PR #150 QA L2)', () => {
  const h = fresh();
  ownerFile(h);
  const [code, out] = runMode(h, 'install', { ops: { run: (...a) => {
    const r = kp.run(...a);
    fs.writeFileSync(path.join(h.lock, 'kiro-pid'), 'x');
    return r;
  } } });
  assert.equal(code, 0, out);
  assert.ok(out.includes('MERGED'));
  assert.ok(out.includes("NOTE    could not release Kiro's lock " + h.lock + ' (OSError)'), out);
});

test('lock: a reclaim before the write refuses and renames nothing (PR #150 agents-lead lens)', () => {
  const h = fresh();
  ownerFile(h);
  const before = fs.readFileSync(h.path);
  const [code, out] = runMode(h, 'install', { ops: { run: (...a) => {
    reclaim(h);
    return kp.run(...a);
  } } });
  assert.equal(code, 3, out);
  assert.ok(out.includes('REFUSE  ' + h.path + ": Kiro's lock " + h.lock + ' is no longer the one mhw took'), out);
  assert.deepEqual(fs.readFileSync(h.path), before);
  assert.ok(fs.statSync(h.lock).isDirectory());
  assert.ok(!fs.existsSync(h.owned));
  assert.deepEqual(fs.readdirSync(path.dirname(h.path)).sort(), ['permissions.yaml', 'permissions.yaml.lock', 'permissions.yaml.pmhwc-backup']);
});

/**
 * main() in m with ops[name] wrapped so Kiro reclaims the lock just before it runs.
 * @param {Home} h @param {'write' | 'writeOwned' | 'uninstall'} name @param {string} m
 */
function reclaimInside(h, name, m) {
  /** @type {any} */
  const real = kp[name];
  const [code, out] = runMode(h, m, { ops: { [name]: (/** @type {any[]} */ ...a) => {
    reclaim(h);
    return real(...a);
  } } });
  assert.ok(fs.statSync(h.lock).isDirectory()); // Kiro's lock stays
  return /** @type {[number, string]} */ ([code, out]);
}

test('lock: a reclaim after the yaml rename says the yaml was changed and what that means for uninstall', () => {
  const h = fresh();
  ownerFile(h);
  const [code, out] = reclaimInside(h, 'writeOwned', 'install');
  assert.equal(code, 3, out);
  assert.ok(out.includes('REFUSE  ' + h.path + ": Kiro's lock " + h.lock + ' is no longer the one mhw took'), out);
  assert.ok(out.includes('; ' + h.path + ' was already changed before that, and ' + h.owned + ' was not'), out);
  assert.ok(out.includes('uninstall will leave them in place'));
  assert.ok(!out.includes('nothing written') && !out.includes('not changed'), out);
  assert.deepEqual(rules(h).slice(0, 3), OWNER_RULES);
  assert.equal(rules(h).length, 6); // the floor went in
  assert.ok(!fs.existsSync(h.owned));
});

test('lock: a reclaim before any rename says the file was not changed', () => {
  const h = fresh();
  ownerFile(h);
  const before = fs.readFileSync(h.path);
  const [code, out] = reclaimInside(h, 'write', 'install');
  assert.equal(code, 3, out);
  assert.ok(out.includes('; ' + h.path + ' not changed, so no rule Kiro is writing is lost. Re-run'), out);
  assert.ok(!out.includes('already changed'));
  assert.deepEqual(fs.readFileSync(h.path), before);
  assert.deepEqual(fs.readdirSync(path.dirname(h.path)).sort(), ['permissions.yaml', 'permissions.yaml.lock', 'permissions.yaml.pmhwc-backup']);
});

test('lock: a reclaim after the yaml rename of a run that appended nothing names no record consequence', () => {
  const h = fresh();
  runMode(h, 'install');
  fs.writeFileSync(h.path, kiroStyle('      - ls *\n')); // the floor is whole: a restamp appends nothing
  const [code, out] = reclaimInside(h, 'writeOwned', 'install');
  assert.equal(code, 3, out);
  assert.ok(out.includes('was already changed before that'), out);
  assert.ok(!out.includes('uninstall will leave them in place'), out);
});

test('lock: uninstall never removes the file once Kiro reclaimed the lock (PR #150 residual b)', () => {
  const h = fresh();
  assert.equal(runMode(h, 'install')[0], 0);
  const before = fs.readFileSync(h.path);
  const [code, out] = reclaimInside(h, 'uninstall', 'uninstall');
  assert.equal(code, 3, out);
  assert.ok(out.includes('REFUSE  ' + h.path + ": Kiro's lock"), out);
  assert.ok(out.includes(h.path + ' not changed'), out);
  assert.ok(!out.includes('REMOVED'));
  assert.deepEqual(fs.readFileSync(h.path), before);
  assert.ok(fs.existsSync(h.owned));
});

test('lock: a held lock is refreshed before the rename', () => {
  const h = fresh();
  ownerFile(h);
  const c = ctx(h);
  kp.withKiroLock(h.path, c, () => {
    fs.utimesSync(h.lock, 1000000000, 1000000000);
    kp.write(h.path, 'rules: []\n', c);
    assert.ok(fs.statSync(h.lock).mtimeMs > Date.now() - 60000);
  });
  assert.ok(!fs.existsSync(h.lock));
});

test('lock: install waits for a lock released in time', async () => {
  const h = fresh();
  ownerFile(h);
  fs.mkdirSync(h.lock);
  const child = spawn(process.execPath, [SCRIPT, '--mode=install', '--stamp=' + STAMP, '--floor=' + h.floor], { env: { ...process.env, ...h.env, XDG_DATA_HOME: '' } });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  await new Promise((resolve) => setTimeout(resolve, 500));
  fs.rmdirSync(h.lock);
  const code = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(code, 0, out);
  assert.ok(out.includes('MERGED'), out);
});

test('install: a new stamp reads STAMP', () => {
  const h = fresh();
  runMode(h, 'install');
  const [code, out] = runMode(h, 'check', { stamp: OTHER });
  assert.equal(code, 1);
  assert.ok(out.includes('STAMP   '));
});

test('uninstall: a rule that gained a consent pattern is left whole, and said', () => {
  const h = fresh();
  runMode(h, 'install');
  const doc = parse(fs.readFileSync(h.path, 'utf8'));
  /** @type {string[]} */ (doc.rules[0].match).push('curl *');
  fs.writeFileSync(h.path, kp.emit(doc, STAMP, 'x'));
  const [code, out] = runMode(h, 'uninstall');
  assert.equal(code, 0, out);
  assert.ok(out.includes('NOTE    ' + h.path + ': the shell deny rule mhw appended (3 pattern(s)) was not found'), out);
  assert.deepEqual(rules(h), [doc.rules[0]]);
});

test('uninstall: a file mhw created is removed', () => {
  const h = fresh();
  runMode(h, 'install');
  const [code, out] = runMode(h, 'uninstall');
  assert.equal(code, 0, out);
  assert.ok(!fs.existsSync(h.path));
  assert.ok(out.includes('REMOVED ' + h.path));
});

test('install: an allow, or a deny under an exclude list, does not count as the floor', () => {
  const h = fresh();
  ownerFile(h, "rules:\n  - capability: shell\n    match: ['sudo *']\n    effect: allow\n"
    + "  - capability: shell\n    match: ['gh auth token *']\n    exclude: ['gh auth token x']\n    effect: deny\n");
  runMode(h, 'install');
  assert.deepEqual(rules(h)[2].match, ['sudo *', 'gh auth token *', 'terraform -chdir=*']);
});

test('uninstall: his empty file stays', () => {
  const h = fresh();
  ownerFile(h, 'rules: []\n');
  runMode(h, 'install');
  const [code, out] = runMode(h, 'uninstall');
  assert.equal(code, 0, out);
  assert.ok(fs.existsSync(h.path), out);
  assert.deepEqual(rules(h), []);
});

test('verify: a merge that does not read back is refused', () => {
  const doc = parse(OWNER);
  assert.throws(() => kp.verify(kp.emit(doc, STAMP, 'x'), { rules: doc.rules.slice(0, 1), policies: null }), Refuse);
  assert.throws(() => kp.verify('rules: 3\n', doc), (e) => e instanceof Refuse && e.message.startsWith('the merged file would not read back (line 1:'));
  kp.verify(kp.emit(doc, STAMP, 'x'), doc);
});

test('uninstall: no record removes nothing', () => {
  const h = fresh();
  ownerFile(h);
  runMode(h, 'install');
  fs.unlinkSync(h.owned);
  const before = fs.readFileSync(h.path);
  const [code, out] = runMode(h, 'uninstall');
  assert.equal(code, 0, out);
  assert.ok(out.includes('nothing removed'));
  assert.deepEqual(fs.readFileSync(h.path), before);
});

test('install: a grown floor appends only the new pattern, and uninstall takes both back', () => {
  const h = fresh();
  runMode(h, 'install');
  const grown = path.join(h.home, 'grown.conf');
  fs.writeFileSync(grown, FLOOR + 'cmd git push --force\n');
  assert.ok(runMode(h, 'install', { floor: grown })[1].includes('1 deny-floor pattern(s) added'));
  assert.deepEqual(rules(h).at(-1), { capability: 'shell', effect: 'deny', match: ['git push --force *'] });
  assert.deepEqual(record(h).at(-1), { capability: 'shell', match: ['git push --force *'] });
  const [code, out] = runMode(h, 'uninstall', { floor: grown });
  assert.equal(code, 0, out);
  assert.ok(!fs.existsSync(h.path), out);
});

test('uninstall: his rules holding the patterns mhw appended are untouched (PR #150 advisory 4)', () => {
  const h = fresh();
  const hisBefore = [{ capability: 'shell', effect: 'allow', match: ['sudo *', 'gh auth token *', 'terraform -chdir=*'] },
    { capability: 'fs_read', effect: 'deny', match: ['~/.ssh/id_*', '**/.env'], exclude: ['a/.env'] }];
  ownerFile(h, kp.emit({ rules: hisBefore, policies: null }, STAMP, 'x', false));
  runMode(h, 'install');
  const doc = parse(fs.readFileSync(h.path, 'utf8'));
  assert.deepEqual(doc.rules[2], { ...hisBefore[0], effect: 'deny' });
  const hisLater = [{ capability: 'shell', effect: 'deny', match: ['sudo *', 'gh auth token *', 'terraform -chdir=*', 'curl *'] }];
  doc.rules.push(...hisLater);
  fs.writeFileSync(h.path, kp.emit(doc, STAMP, 'x'));
  const [code, out] = runMode(h, 'uninstall');
  assert.equal(code, 0, out);
  assert.deepEqual(rules(h), [...hisBefore, ...hisLater]);
});

test('install: a stale record never claims his rule (PR #150 re-review)', () => {
  const h = fresh();
  fs.writeFileSync(h.floor, 'cmd sudo\n');
  runMode(h, 'install');
  put(h, [{ capability: 'shell', effect: 'allow', match: ['ls *'] }]); // mhw's rule deleted
  const [code, out] = runMode(h, 'install');
  assert.equal(code, 0, out);
  assert.ok(out.includes('NOTE    ' + h.owned + ': 1 recorded mhw rule(s) no longer in'), out);
  assert.deepEqual(record(h), [{ capability: 'shell', match: ['sudo *'] }]);
  const his = { capability: 'shell', effect: 'deny', match: ['sudo *', 'curl *'] };
  put(h, [...rules(h), his]);
  const [uc, uout] = runMode(h, 'uninstall');
  assert.equal(uc, 0, uout);
  assert.deepEqual(rules(h), [{ capability: 'shell', effect: 'allow', match: ['ls *'] }, his]);
});

test('install: the record is reconciled even when nothing is missing', () => {
  const h = fresh();
  fs.writeFileSync(h.floor, 'cmd sudo\n');
  runMode(h, 'install');
  const his = { capability: 'shell', effect: 'deny', match: ['sudo *', 'curl *'] };
  fs.writeFileSync(h.path, kp.emit({ rules: [his], policies: null }, STAMP, 'x'));
  const [code, out] = runMode(h, 'install');
  assert.equal(code, 0, out);
  assert.ok(out.includes('OK      '));
  assert.deepEqual(record(h), []);
  assert.equal(runMode(h, 'uninstall')[0], 0);
  assert.deepEqual(rules(h), [his]);
});

test('uninstall: each recorded entry is matched to a distinct rule', () => {
  const h = fresh();
  fs.writeFileSync(h.floor, 'cmd sudo\n');
  runMode(h, 'install');
  const body = JSON.parse(fs.readFileSync(h.owned, 'utf8'));
  body.appended = [...body.appended, ...body.appended];
  fs.writeFileSync(h.owned, JSON.stringify(body));
  const his = { capability: 'shell', effect: 'allow', match: ['sudo *'] };
  put(h, [...rules(h), his]);
  const [code, out] = runMode(h, 'uninstall');
  assert.equal(code, 0, out);
  assert.ok(out.includes('was not found as its own rule'));
  assert.deepEqual(rules(h), [his]);
});

test('uninstall: the exact rule is preferred over his earlier rule that starts the same', () => {
  const h = fresh();
  fs.writeFileSync(h.floor, 'cmd sudo\n');
  runMode(h, 'install');
  const his = { capability: 'shell', effect: 'deny', match: ['sudo *', 'curl *'] };
  put(h, [his, ...rules(h)]);
  assert.equal(runMode(h, 'uninstall')[0], 0);
  assert.deepEqual(rules(h), [his]);
});

test('uninstall: a recorded rule edited by hand is left alone, and said', () => {
  const h = fresh();
  runMode(h, 'install');
  const doc = parse(fs.readFileSync(h.path, 'utf8'));
  /** @type {string[]} */ (doc.rules[0].match).reverse();
  fs.writeFileSync(h.path, kp.emit(doc, STAMP, 'x'));
  const [code, out] = runMode(h, 'uninstall');
  assert.equal(code, 0, out);
  assert.ok(out.includes('NOTE    ' + h.path + ': the shell deny rule mhw appended (3 pattern(s)) was not found'), out);
  assert.deepEqual(rules(h), [doc.rules[0]]);
});

test('install: a merge that does not read back is never written (PR #150 advisory 5)', () => {
  const h = fresh();
  ownerFile(h);
  const before = fs.readFileSync(h.path);
  const c = kp.context({ env: h.env, out: () => {}, ops: { emit: () => 'rules: []\n' } });
  assert.equal(kp.run('install', STAMP, kp.loadFloor(h.floor), 'x', c), 3);
  assert.deepEqual(fs.readFileSync(h.path), before);
  assert.ok(!fs.existsSync(h.path + '.pmhwc-backup'));
  assert.ok(!fs.existsSync(h.owned));
});

test('uninstall: a merge that does not read back is never written', () => {
  const h = fresh();
  ownerFile(h);
  runMode(h, 'install');
  const before = fs.readFileSync(h.path);
  const [code, out] = runMode(h, 'uninstall', { ops: { emit: () => 'rules: []\n' } });
  assert.equal(code, 3, out);
  assert.ok(out.includes('REFUSE  ' + h.path + ': the merged file would not read back as your rules plus the floor'), out);
  assert.deepEqual(fs.readFileSync(h.path), before);
  assert.ok(fs.existsSync(h.owned));
});

test('write: a link planted at a temporary name is not followed (PR #150 advisory 1)', { skip: !POSIX && 'symbolic links' }, () => {
  const h = fresh();
  ownerFile(h);
  const victim = path.join(h.home, 'victim');
  fs.writeFileSync(victim, 'untouched\n');
  const planted = h.path + '.new.' + process.pid;
  fs.symlinkSync(victim, planted);
  kp.write(h.path, 'rules: []\n', ctx(h));
  assert.equal(fs.readFileSync(victim, 'utf8'), 'untouched\n');
  assert.equal(fs.readFileSync(h.path, 'utf8'), 'rules: []\n');
  assert.deepEqual(fs.readdirSync(path.dirname(h.path)).sort(), ['permissions.yaml', path.basename(planted)].sort());
});

test('write: a failed rename leaves no temporary file behind', () => {
  const h = fresh();
  fs.mkdirSync(h.path, { recursive: true }); // a directory where the file goes: the rename fails
  assert.throws(() => kp.write(h.path, 'rules: []\n', ctx(h)));
  assert.deepEqual(fs.readdirSync(path.dirname(h.path)), ['permissions.yaml']);
});

test('write: text is written as Python\'s text mode writes it, CRLF on Windows only', () => {
  const h = fresh();
  for (const [platform, want] of [['win32', 'a\r\nb\r\n'], ['linux', 'a\nb\n']]) {
    const c = kp.context({ env: h.env, platform });
    const f = path.join(h.home, platform + '.txt');
    kp.write(f, 'a\nb\n', c);
    assert.equal(fs.readFileSync(f, 'utf8'), want);
    assert.deepEqual(c.changed, [fs.realpathSync(f)]);
  }
});

test('home: HOME on POSIX, USERPROFILE (then HOMEDRIVE and HOMEPATH) on Windows, XDG_DATA_HOME for the record', () => {
  const t = (/** @type {Record<string, string>} */ env, /** @type {string} */ platform) => kp.target(kp.context({ env, platform }));
  assert.equal(t({ HOME: '/h', USERPROFILE: '/u' }, 'linux'), path.join('/h', '.kiro', 'settings', 'permissions.yaml'));
  assert.equal(t({ HOME: '/h', USERPROFILE: '/u' }, 'win32'), path.join('/u', '.kiro', 'settings', 'permissions.yaml'));
  assert.equal(t({ HOMEDRIVE: '/d', HOMEPATH: '/p' }, 'win32'), path.join('/d/p', '.kiro', 'settings', 'permissions.yaml'));
  assert.equal(t({ HOMEPATH: '/p' }, 'win32'), path.join('/p', '.kiro', 'settings', 'permissions.yaml'));
  assert.equal(t({}, 'win32'), path.join(os.homedir(), '.kiro', 'settings', 'permissions.yaml'));
  assert.equal(t({}, 'linux'), path.join(os.homedir(), '.kiro', 'settings', 'permissions.yaml'));
  assert.equal(kp.ownedPath(kp.context({ env: { HOME: '/h', XDG_DATA_HOME: '/x' }, platform: 'linux' })), path.join('/x', NAME, 'kiro-permissions-owned.json'));
  assert.equal(kp.ownedPath(kp.context({ env: { HOME: '/h', XDG_DATA_HOME: '' }, platform: 'linux' })), path.join('/h', '.local', 'share', NAME, 'kiro-permissions-owned.json'));
});

test('install: a symbolic link is written through', { skip: !POSIX && 'symbolic links' }, () => {
  const h = fresh();
  const real = path.join(h.home, 'dotfiles', 'permissions.yaml');
  fs.mkdirSync(path.dirname(real));
  fs.writeFileSync(real, OWNER);
  fs.mkdirSync(path.dirname(h.path), { recursive: true });
  fs.symlinkSync(real, h.path);
  assert.equal(runMode(h, 'install')[0], 0);
  assert.ok(fs.lstatSync(h.path).isSymbolicLink());
  assert.deepEqual(parse(fs.readFileSync(real, 'utf8')).rules.slice(0, 3), OWNER_RULES);
});

// --- Refusals -------------------------------------------------------------------------------------------

test('refuse: a non-empty permissions.json without a permissions.yaml', () => {
  const h = fresh();
  fs.mkdirSync(path.dirname(h.path), { recursive: true });
  fs.writeFileSync(path.join(path.dirname(h.path), 'permissions.json'), '{"rules": []}');
  for (const m of ['install', 'check']) {
    const [code, out] = runMode(h, m);
    assert.equal(code, 3, out);
    assert.ok(out.includes('REFUSE'));
  }
  assert.ok(!fs.existsSync(h.path));
});

test('refuse: a file Kiro would reject is left untouched, with no backup', () => {
  const h = fresh();
  const bad = 'rules:\n  - capability: shell\n    effect: deny\n    comment: mine\n';
  ownerFile(h, bad);
  const [code, out] = runMode(h, 'install');
  assert.equal(code, 3, out);
  assert.ok(out.includes('drops every rule in the file'));
  assert.equal(fs.readFileSync(h.path, 'utf8'), bad);
  assert.ok(!fs.existsSync(h.path + '.pmhwc-backup'));
});

test('usage: the command line exits 2', () => {
  const p = spawnSync(process.execPath, [SCRIPT, '--mode=install'], { encoding: 'utf8' });
  assert.equal(p.status, 2);
  assert.ok(p.stderr.startsWith('usage: kiro-permissions.js --mode=install|check|dry-run|uninstall|report'), p.stderr);
});

// --- AdminCopy ------------------------------------------------------------------------------------------

/** @param {string} yamlPath @param {...string} extra */
function adminJson(yamlPath, ...extra) {
  let out = '';
  let err = '';
  const code = kp.main(['--mode=admin-json', '--stamp=' + STAMP, '--from-yaml=' + yamlPath, ...extra], { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return /** @type {[number, string, string]} */ ([code, out, err]);
}

test('admin: admin-json is the floor install rendered', () => {
  const h = fresh();
  assert.equal(runMode(h, 'install')[0], 0);
  const [code, out] = adminJson(h.path);
  assert.equal(code, 0);
  const doc = JSON.parse(out);
  assert.deepEqual(Object.keys(doc).sort(), ['rules', NAME].sort());
  assert.ok(doc[NAME].includes(MARKER_ID) && doc[NAME].includes(STAMP));
  assert.deepEqual(doc.rules, FLOOR_RULES);
});

test('admin: admin-json refuses a file that is not only the floor', () => {
  const h = fresh();
  ownerFile(h);
  const [code, out, err] = adminJson(h.path);
  assert.equal(code, 3);
  assert.equal(out, '');
  assert.ok(err.includes('not a plain floor deny rule'));
});

test('admin: admin-json usage', () => {
  const h = fresh();
  const [code, , err] = adminJson(h.path, '--floor=' + h.floor);
  assert.equal(code, 2);
  assert.ok(err.includes('usage'));
});

/** @param {Home} h @param {string} admin */
function report(h, admin) {
  const [code, out] = runMode(h, 'report', { extra: ['--admin=' + admin] });
  assert.equal(code, 0);
  return out.split('\n').filter((l) => l.includes('admin managed-settings.json'));
}

test('admin: report counts the admin copy', () => {
  const h = fresh();
  const admin = path.join(h.home, 'managed-settings.json');
  assert.deepEqual(report(h, admin), ['FLOOR   Kiro: admin managed-settings.json absent (read by Kiro IDE 1.2.56 and the Kiro CLI V3 engine '
    + 'as the administration scope, read from their bundles; Kiro CLI 2.x does not read it; not enforced-measured; ADR-0036)']);
  const want = kp.loadFloor(h.floor);
  /** @type {any} */
  let doc = kp.adminDoc(want, STAMP);
  fs.writeFileSync(admin, JSON.stringify(doc));
  assert.ok(report(h, admin)[0].includes('admin managed-settings.json 7/7 floor patterns'));
  doc.rules[0].match = doc.rules[0].match.filter((/** @type {string} */ p) => p !== 'sudo *');
  fs.writeFileSync(admin, JSON.stringify(doc));
  assert.ok(report(h, admin)[0].includes('admin managed-settings.json 6/7 floor patterns'));
  doc = kp.adminDoc(want, STAMP);
  doc.rules[0].exclude = ['x']; // a pattern under an exclude does not count, as in the user file
  fs.writeFileSync(admin, JSON.stringify(doc));
  assert.ok(report(h, admin)[0].includes('admin managed-settings.json 4/7 floor patterns'));
  fs.writeFileSync(admin, JSON.stringify({ rules: doc.rules }));
  assert.ok(report(h, admin)[0].includes('present and NOT managed by this project'));
  fs.writeFileSync(admin, 'not json');
  assert.ok(report(h, admin)[0].includes('not read ('));
});

/** @param {Home} h @param {unknown} doc @param {Buffer} [raw] */
function validateFile(h, doc, raw) {
  const f = path.join(h.home, 'kiro.json');
  fs.writeFileSync(f, raw || Buffer.from(JSON.stringify(doc)));
  let err = '';
  const code = kp.main(['--mode=admin-validate', '--file=' + f], { out: () => {}, err: (s) => { err += s; } });
  return /** @type {[number, string]} */ ([code, err]);
}

test('admin: conditions follow Kiro\'s compiler', () => {
  assert.equal(kp.conditions({ effect: 'deny', match: Array(184).fill('a *') }), 1);
  assert.equal(kp.conditions({ effect: 'deny', match: ['a'], exclude: Array(5).fill('x') }), 6);
  assert.equal(kp.conditions({ effect: 'ask', match: ['a'], exclude: ['x'] }), 3);
  assert.equal(kp.conditions({ effect: 'deny', match: ['*'], exclude: ['x'] }), 1);
  assert.equal(kp.conditions({ effect: 'deny' }), 0);
});

test('admin: admin-validate accepts the render with many patterns', () => {
  const h = fresh();
  const want = { shell: Array.from({ length: 300 }, (_, i) => 'p' + i + ' *'), fs_read: ['~/.x'], fs_write: ['~/.x'] };
  assert.equal(validateFile(h, kp.adminDoc(want, STAMP))[0], 0);
});

test('admin: admin-validate refuses a statement over the ceiling', () => {
  const h = fresh();
  /** @type {any} */
  const doc = kp.adminDoc(kp.loadFloor(h.floor), STAMP);
  doc.rules[0].exclude = Array.from({ length: kp.CONDITION_CEILING - 1 }, (_, i) => 'x' + i);
  assert.equal(validateFile(h, doc)[0], 0); // 1 + 31 = 32: at the ceiling
  doc.rules[0].exclude.push('one more');
  const [code, err] = validateFile(h, doc); // 33: over it
  assert.equal(code, 3);
  assert.ok(err.includes('over the ceiling of 32'), err);
  assert.throws(() => kp.adminCheck(doc), Refuse);
});

test('admin: admin-validate refuses what Kiro rejects', () => {
  const h = fresh();
  const good = kp.adminDoc(kp.loadFloor(h.floor), STAMP);
  /** @param {(d: any) => void} f */
  const variant = (f) => {
    const d = JSON.parse(JSON.stringify(good));
    f(d);
    return d;
  };
  for (const doc of [variant((d) => { d.rules[0].extra = 1; }), variant((d) => { d.rules[0].effect = 'allow'; }), variant((d) => { d.rules = []; }),
    variant((d) => { d.rules[0].match = []; }), variant((d) => { d.settings = {}; }), variant((d) => { delete d[NAME]; })]) {
    assert.equal(validateFile(h, doc)[0], 3, JSON.stringify(doc));
  }
  assert.equal(validateFile(h, null, Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(good))]))[0], 3);
  assert.equal(validateFile(h, null, Buffer.from('{not json'))[0], 3);
  assert.equal(validateFile(h, good)[0], 0);
});

test('admin: report names the deny-all of an invalid file', () => {
  const h = fresh();
  const admin = path.join(h.home, 'managed-settings.json');
  /** @type {any} */
  const doc = kp.adminDoc(kp.loadFloor(h.floor), STAMP);
  doc.rules[0].extra = 1;
  fs.writeFileSync(admin, JSON.stringify(doc));
  const line = report(h, admin)[0];
  assert.ok(line.includes('INVALID ('));
  assert.ok(line.includes('deny every tool call'));
  assert.ok(line.includes('mhw install-admin --uninstall and the sudo line it prints'));
  fs.writeFileSync(admin, '{not json');
  assert.ok(report(h, admin)[0].includes('deny every tool call'));
});

test('admin: --admin is accepted on report only', () => {
  const h = fresh();
  assert.equal(runMode(h, 'check', { extra: ['--admin=/x'] })[0], 2);
});

// --- the Python messages ----------------------------------------------------------------------------------

test('errors: an OSError and a UnicodeDecodeError print as CPython prints them', () => {
  assert.equal(kp.pyOSError({ code: 'ENOENT' }, '/a\'b').message, '[Errno 2] No such file or directory: "/a\'b"');
  assert.equal(kp.pyOSError({ code: 'EACCES' }).cls, 'PermissionError');
  assert.equal(kp.pyOSError({ code: 'ENOTEMPTY', errno: -66, message: 'm' }).message, '[Errno 66] m');
  assert.equal(kp.pyOSError({ code: 'ENOTEMPTY', message: 'm' }).message, '[Errno 0] m');
  for (const [bytes, msg] of /** @type {Array<[number[], string]>} */ ([
    [[0xe2, 0x82], "bytes in position 0-1: unexpected end of data"], [[0xe2], 'byte 0xe2 in position 0: unexpected end of data'],
    [[0xe2, 0x28], 'byte 0xe2 in position 0: invalid continuation byte'], [[0xe2, 0x82, 0x28], 'bytes in position 0-1: invalid continuation byte'],
    [[0xed, 0xa0, 0x80], 'byte 0xed in position 0: invalid continuation byte'], [[0xf0, 0x80, 0x80], 'byte 0xf0 in position 0: invalid continuation byte'],
    [[0xc0], 'byte 0xc0 in position 0: invalid start byte'], [[0x61, 0x62, 0xff], 'byte 0xff in position 2: invalid start byte'],
    [[0xf0, 0x90], 'bytes in position 0-1: unexpected end of data'], [[0xf4, 0x90, 0x80, 0x80], 'byte 0xf4 in position 0: invalid continuation byte'],
    [[0xe0, 0x9f, 0x80], 'byte 0xe0 in position 0: invalid continuation byte'], [[0xe0, 0xa0], 'bytes in position 0-1: unexpected end of data'],
    [[0xc3, 0xa9, 0xf4, 0x8f, 0xbf, 0xbf, 0xf4, 0x8f, 0xc0], 'bytes in position 6-7: invalid continuation byte'],
    [[0x61], ''],
  ])) {
    assert.equal(kp.utf8Error(Uint8Array.from(bytes)), "'utf-8' codec can't decode" + (msg ? ' ' + msg : ''), JSON.stringify(bytes));
  }
});

test('read: universal newlines, a BOM kept as a character', () => {
  const h = fresh();
  const f = path.join(h.home, 't');
  fs.writeFileSync(f, '﻿a\r\nb\rc\n');
  assert.equal(kp.readText(f), '﻿a\nb\nc\n');
});
