// The deleted global/profile/profile_test.py, case by case, as node:test against src/commands/profile.js
// (#479, S08 of #470), plus the assertions the Node reader and equality need of their own. The CLI-level
// transcripts are compared with the original's in profile-golden.test.js; these hold the meaning.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  run, readJson, validate, pyEq, loadProfile, plain, plan, compileProfile, writeOrCheck, isManaged, confinedPath,
  readText, Refuse, MANAGED, MAX_BYTES, SPEC,
} from '../../src/commands/profile.js';
import { helpText, usageText, parse } from '../../src/lib/argparse.js';
import { PyFloat } from '../../src/lib/py.js';
import { ROOT, POSIX, doc } from './cases.js';

const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));
const SCHEMA = /** @type {any} */ (readJson(fs.readFileSync(path.join(ROOT, 'global', 'profile', 'profile.schema.json'), 'utf8'), false));

function base() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s08u-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A readJson value of a JavaScript value. @param {unknown} v */
const parsed = (v) => readJson(JSON.stringify(v), true);

/** @param {string} cwd @param {string[]} args */
function cli(cwd, args) {
  let out = '';
  let err = '';
  const code = run(args, { cwd, env: {}, out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, stdout: out, stderr: err };
}

/** A working directory holding profile.json. @param {unknown} [d] */
function workdir(d = doc()) {
  const dir = base();
  fs.writeFileSync(path.join(dir, 'profile.json'), JSON.stringify(d));
  return dir;
}

test('example and reference profiles validate', () => {
  assert.deepEqual(validate(parsed(doc()), SCHEMA), []);
  const ref = plain(loadProfile(path.join('overlay', 'profile.json'), { cwd: ROOT, platform: process.platform }));
  assert.equal(ref.session_start.priority, 'balanced');
  assert.equal(ref.conversation.decision_tone, 'executive-concise');
});

test('native grants are rejected without echo, and nothing is written', () => {
  const sentinel = 'synthetic-private-input-do-not-echo';
  const dir = workdir({ ...doc(), [sentinel]: { allow: ['all'] } });
  const r = cli(dir, ['render', '--source', 'profile.json', '--output', 'output']);
  assert.equal(r.code, 2);
  assert.ok(!(r.stdout + r.stderr).includes(sentinel));
  assert.ok(!fs.existsSync(path.join(dir, 'output')));
});

test('an unknown nested field and an invalid choice are redacted', () => {
  const sentinel = 'synthetic-private-value-do-not-echo';
  const d = doc();
  d.conversation.language = sentinel;
  d.conversation[sentinel] = sentinel;
  const r = cli(workdir(d), ['validate', '--source', 'profile.json']);
  assert.equal(r.code, 2);
  assert.ok(!(r.stdout + r.stderr).includes(sentinel));
  assert.ok(r.stderr.includes('conversation.language'));
});

test('malformed, duplicate, non-finite, oversized and unbalanced JSON is rejected', () => {
  for (const data of ['{"private":"synthetic-input",', '{"version":1,"version":1}', '{"version":NaN}',
    ' '.repeat(MAX_BYTES + 1), '['.repeat(2000)]) {
    const dir = base();
    fs.writeFileSync(path.join(dir, 'profile.json'), data);
    const r = cli(dir, ['validate', '--source', 'profile.json']);
    assert.equal(r.code, 2, String(data.length));
    assert.ok(!r.stderr.includes('synthetic-input'));
  }
});

test('missing fields, booleans, integers and bounds are each refused', () => {
  /** @type {Array<(d: any) => void>} */
  const mutations = [
    (d) => { delete d.conversation; },
    (d) => { d.version = true; },
    (d) => { d.version = 2; },
    (d) => { d.interaction.max_question_chars = true; },
    (d) => { d.interaction.max_question_chars = -1; },
    (d) => { d.interaction.max_question_chars = 10001; },
    (d) => { d.interaction.decision_options = 4; },
    (d) => { d.interaction.decision_options = true; },
    (d) => { d.desktop = { notifications: 'all' }; },
    (d) => { d.desktop = {}; },
    (d) => { d.surfaces = []; },
    (d) => { d.surfaces = ['codex', 'codex']; },
    (d) => { d.surfaces = [{}]; },
  ];
  for (const m of mutations) {
    const d = doc();
    m(d);
    assert.ok(validate(parsed(d), SCHEMA).length, m.toString());
  }
});

test('plan is read-only and claims no installation', () => {
  const dir = workdir();
  const before = fs.readdirSync(dir);
  const r = cli(dir, ['plan', '--source', 'profile.json']);
  assert.equal(r.code, 0, r.stderr);
  const report = JSON.parse(r.stdout);
  assert.deepEqual(fs.readdirSync(dir), before);
  assert.equal(report.surfaces.length, 4);
  assert.ok(report.surfaces.every((/** @type {any} */ s) => s.runtime_verification === 'not-performed'));
  assert.equal(report.limits.financial_authorization, 'not-granted');
  assert.ok(report.limits.native_model_and_effort.includes('not-written'));
});

test('render preserves unrelated files and is idempotent (bytes and mtimes)', () => {
  const dir = workdir();
  const out = path.join(dir, 'output');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'keep.txt'), 'keep');
  const args = ['render', '--source', 'profile.json', '--output', 'output'];
  assert.equal(cli(dir, args).code, 0);
  const state = () => Object.fromEntries(fs.readdirSync(out).map((n) => {
    const p = path.join(out, n);
    return [n, [fs.readFileSync(p, 'hex'), fs.statSync(p, { bigint: true }).mtimeNs]];
  }));
  const before = state();
  const second = cli(dir, args);
  assert.equal(second.code, 0);
  assert.ok(second.stdout.includes('0 generated files updated'));
  assert.deepEqual(state(), before);
  assert.equal(cli(dir, ['check', '--source', 'profile.json', '--output', 'output']).code, 0);
  if (POSIX) for (const n of ['AGENTS.md', 'clipboard.conf', 'desktop-instructions.md', 'profile-plan.json']) {
    assert.equal(fs.statSync(path.join(out, n)).mode & 0o777, 0o600, n);
  }
});

test('drift is observed, left alone by check, then repaired by render', () => {
  const dir = workdir();
  const r = ['render', '--source', 'profile.json', '--output', 'output'];
  const c = ['check', '--source', 'profile.json', '--output', 'output'];
  assert.equal(cli(dir, r).code, 0);
  const file = path.join(dir, 'output', 'AGENTS.md');
  fs.appendFileSync(file, 'synthetic drift\n');
  const before = fs.readFileSync(file);
  const drift = cli(dir, c);
  assert.equal(drift.code, 1);
  assert.equal(drift.stdout, 'DRIFT: AGENTS.md\n');
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(cli(dir, r).code, 0);
  assert.equal(cli(dir, c).code, 0);
});

test('check of a missing output writes nothing', () => {
  const dir = workdir();
  assert.equal(cli(dir, ['check', '--source', 'profile.json', '--output', 'output']).code, 1);
  assert.ok(!fs.existsSync(path.join(dir, 'output')));
});

test('an unmanaged target refuses every write', () => {
  const dir = workdir();
  const out = path.join(dir, 'output');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(out, 'clipboard.conf'), 'unmanaged');
  assert.equal(cli(dir, ['render', '--source', 'profile.json', '--output', 'output']).code, 3);
  assert.deepEqual(fs.readdirSync(out), ['clipboard.conf']);
  assert.equal(fs.readFileSync(path.join(out, 'clipboard.conf'), 'utf8'), 'unmanaged');
});

test('a symlinked target refuses every write', { skip: !POSIX && 'symlinks, POSIX' }, () => {
  const dir = workdir();
  const out = path.join(dir, 'output');
  fs.mkdirSync(out);
  fs.writeFileSync(path.join(dir, 'other'), 'untouched');
  fs.symlinkSync(path.join(dir, 'other'), path.join(out, 'clipboard.conf'));
  assert.equal(cli(dir, ['render', '--source', 'profile.json', '--output', 'output']).code, 3);
  assert.equal(fs.readFileSync(path.join(dir, 'other'), 'utf8'), 'untouched');
  assert.ok(!fs.existsSync(path.join(out, 'AGENTS.md')));
});

test('mentioning the marker does not establish ownership', () => {
  const dir = workdir();
  fs.mkdirSync(path.join(dir, 'output'));
  fs.writeFileSync(path.join(dir, 'output', 'AGENTS.md'), 'Notes about ' + MANAGED);
  assert.equal(cli(dir, ['render', '--source', 'profile.json', '--output', 'output']).code, 3);
  assert.ok(!fs.existsSync(path.join(dir, 'output', 'clipboard.conf')));
  assert.equal(isManaged('AGENTS.md', '<!-- managed-by: ' + MANAGED + '; x'), true);
  assert.equal(isManaged('clipboard.conf', '# managed-by: ' + MANAGED + '; x'), true);
  assert.equal(isManaged('clipboard.conf', '<!-- managed-by: ' + MANAGED + '; x'), false);
  assert.equal(isManaged('profile-plan.json', '{"managed_by":"' + MANAGED + '"}'), true);
  assert.equal(isManaged('profile-plan.json', '["' + MANAGED + '"]'), false);
  assert.equal(isManaged('profile-plan.json', '{"managed_by":"' + MANAGED + '"'), false);
});

test('a pt-BR profile localises the notices and keeps the floor', () => {
  const d = doc();
  Object.assign(d.conversation, { language: 'pt-BR', decision_tone: 'executive-concise' });
  d.interaction.max_question_chars = 280;
  d.session_start.priority = 'balanced';
  const compiled = compileProfile(plain(parsed(d)));
  assert.ok(compiled['clipboard.conf'].includes('notice_paste_redacted='));
  assert.ok(!compiled['clipboard.conf'].includes('block_categories='));
  assert.ok(compiled['AGENTS.md'].includes('moderate latency'));
  assert.ok(compiled['AGENTS.md'].includes('one question per message; a question stem is at most 280 characters; '
    + 'the reasoning goes in a linked artifact, not in the message.'));
  const floor = readText(path.join(ROOT, 'global', 'AGENTS.md')).trimEnd();
  assert.ok(compiled['desktop-instructions.md'].includes(floor));
});

test('every supported preference validates and compiles', () => {
  const props = SCHEMA.get('properties');
  for (const [group, key] of [['conversation', 'language'], ['conversation', 'publication_language'],
    ['conversation', 'decision_tone'], ['interaction', 'command_preference'], ['session_start', 'priority']]) {
    for (const choice of props.get(group).get('properties').get(key).get('enum')) {
      const d = doc();
      d[group][key] = choice;
      assert.deepEqual(validate(parsed(d), SCHEMA), []);
      assert.ok('AGENTS.md' in compileProfile(plain(parsed(d))));
    }
  }
});

test('pacing is opt-in, and the reference owner selects it', () => {
  const generic = compileProfile(plain(parsed(doc())));
  assert.ok(!generic['AGENTS.md'].includes('**Path decisions:**'));
  assert.ok(!generic['AGENTS.md'].includes('**Paced conversation:**'));
  const owner = plain(loadProfile(path.join('overlay', 'profile.json'), { cwd: ROOT, platform: process.platform }));
  const compiled = compileProfile(owner);
  const a = compiled['AGENTS.md'];
  assert.ok(!('hitl.conf' in compiled));
  assert.ok(a.includes('one extreme, the opposite extreme, and the middle ground'));
  assert.ok(a.includes('talk to the owner in Brazilian Portuguese in everything made for the owner to read: chat, reports, artifacts and pickers. Only text for an outside audience is in English'));
  assert.ok(!a.includes('Anything published is in'));
  assert.ok(a.includes("Site copy and social posts follow their own surface's language rule"));
  assert.ok(!a.includes('site copy and social posts.'));
  assert.ok(plan(owner).limits.decision_options.includes('no hook checks it'));
  assert.ok(a.includes('silence or elapsed time is not approval'));
  assert.ok(a.includes('risk and expected benefit'));
  assert.ok(a.includes('not a hard token or spending cap'));
  assert.ok(compiled['desktop-instructions.md'].includes('Continue routine work already authorized'));
  assert.ok(plan(owner).limits.conversation_cadence.includes('instruction-only'));
  assert.ok(a.includes('one point at a time'));
  assert.ok(plan(owner).limits.desktop_notifications.includes('intent=essential'));
});

test('CRLF output is not false drift', () => {
  const dir = base();
  const compiled = compileProfile(plain(parsed(doc())));
  const ctx = { cwd: dir, platform: process.platform };
  writeOrCheck('output', compiled, ctx);
  for (const [n, v] of Object.entries(compiled)) fs.writeFileSync(path.join(dir, 'output', n), v.replace(/\n/g, '\r\n'));
  assert.deepEqual(writeOrCheck('output', compiled, ctx, { check: true }), []);
});

test('the CLI cannot read or write outside the working directory', () => {
  const dir = workdir();
  for (const args of [['validate', '--source', path.join(ROOT, 'global', 'profile', 'profile.example.json')],
    ['render', '--source', 'profile.json', '--output', path.join(path.dirname(dir), 'escape')]]) {
    const r = cli(dir, args);
    assert.equal(r.code, 3);
    assert.ok(r.stderr.includes('escapes the working directory'));
  }
});

test('a symlinked ancestor cannot escape the working directory', { skip: !POSIX && 'symlinks, POSIX' }, () => {
  const dir = base();
  fs.symlinkSync(path.dirname(dir), path.join(dir, 'outside'), 'dir');
  assert.throws(() => writeOrCheck('outside/escape', compileProfile(plain(parsed(doc()))), { cwd: dir, platform: process.platform }), Refuse);
  assert.throws(() => confinedPath('outside/x', { cwd: dir, platform: process.platform }), /escapes/);
});

test('output is required only for render and check', () => {
  const dir = workdir();
  assert.equal(cli(dir, ['render', '--source', 'profile.json']).code, 2);
  assert.equal(cli(dir, ['validate', '--source', 'profile.json', '--output', 'output']).code, 2);
});

// The Node reader and equality, beyond the Python suite.

test('readJson keeps int, float and bool apart, and accepts any depth inside the cap', () => {
  assert.equal(readJson('1', true), 1n);
  assert.ok(readJson('1.0', true) instanceof PyFloat);
  assert.ok(readJson('1e0', true) instanceof PyFloat);
  assert.equal(readJson('true', true), true);
  assert.equal(readJson('"\\ud83d\\ude00"', true), '\u{1f600}');
  assert.equal(readJson('"\\ud800"', true), '\ud800');
  const deep = '['.repeat(30000) + ']'.repeat(30000);
  assert.ok(Array.isArray(readJson(deep, true)));
  assert.throws(() => readJson('{"a":1,"a":2}', true));
  assert.equal(/** @type {Map<string, unknown>} */ (readJson('{"a":1,"a":2}', false)).get('a'), 2n);
  assert.throws(() => readJson('NaN', true));
  assert.ok(readJson('-Infinity', false) instanceof PyFloat);
  assert.throws(() => readJson('1'.repeat(4301), true));
  assert.equal(readJson('-' + '1'.repeat(4300), true), -BigInt('1'.repeat(4300)));
  for (const bad of ['', '01', '1.', '.1', '+1', '[1,]', '{"a":1,}', '{"a" 1}', '"\t"', '"\\x"', '{} {}', '\ufeff{}', '[', '{"a":', '{"a"']) {
    assert.throws(() => readJson(bad, false), JSON.stringify(bad));
  }
  assert.deepEqual([...(/** @type {Map<string, unknown>} */ (readJson('{"__proto__":1}', true))).keys()], ['__proto__']);
});

test('pyEq is Python ==: numbers across int, float and bool; deep containers without recursion', () => {
  assert.ok(pyEq(1n, true));
  assert.ok(pyEq(0n, false));
  assert.ok(pyEq(1n, new PyFloat(1)));
  assert.ok(!pyEq(9007199254740993n, new PyFloat(9007199254740992)));
  assert.ok(pyEq(new PyFloat(Infinity), new PyFloat(Infinity)));
  assert.ok(!pyEq(new PyFloat(NaN), new PyFloat(NaN)));
  assert.ok(!pyEq('1', 1n));
  assert.ok(!pyEq(null, false));
  assert.ok(pyEq(null, null));
  assert.ok(!pyEq([1n], [1n, 2n]));
  assert.ok(pyEq(readJson('{"a":[1,{"b":2}]}', true), readJson('{"a":[1.0,{"b":true}]}'.replace('true', '2'), true)));
  assert.ok(!pyEq(readJson('{"a":1}', true), readJson('{"b":1}', true)));
  assert.ok(!pyEq(readJson('{"a":1}', true), [1n]));
  const deep = '['.repeat(20000) + ']'.repeat(20000);
  assert.ok(pyEq(readJson(deep, true), readJson(deep, true)));
});

test('the help is argparse\'s: required option unbracketed, choices as the metavar, unhelped actions unpadded', () => {
  const h = helpText(SPEC, 80);
  assert.ok(h.startsWith('usage: mhw profile [-h] --source SOURCE [--output OUTPUT]\n                   {validate,plan,render,check}\n\nValidate'));
  assert.ok(h.includes('\npositional arguments:\n  {validate,plan,render,check}\n\noptions:\n  -h, --help            show this help message and exit\n  --source SOURCE\n  --output OUTPUT\n'));
  assert.equal(usageText(SPEC, 200), 'usage: mhw profile [-h] --source SOURCE [--output OUTPUT] {validate,plan,render,check}\n');
  assert.deepEqual(parse(SPEC, ['bogus', '-h']), { kind: 'error', message: "argument command: invalid choice: 'bogus' (choose from validate, plan, render, check)" });
  assert.deepEqual(parse(SPEC, ['-h', 'bogus']), { kind: 'help' });
  assert.deepEqual(parse(SPEC, ['plan']), { kind: 'error', message: 'the following arguments are required: --source' });
  assert.deepEqual(parse(SPEC, []), { kind: 'error', message: 'the following arguments are required: command, --source' });
});

test('./mhw and bin/mhw.js route profile to Node, never to workstation.py', () => {
  const dir = workdir();
  const viaBin = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'profile', 'validate', '--source', 'profile.json'], { cwd: dir, encoding: 'utf8' });
  assert.equal(viaBin.status, 0, viaBin.stderr);
  assert.equal(viaBin.stdout, 'OK: valid preference profile; no installation or permission grant\n');
  if (POSIX) {
    const viaSh = spawnSync('/bin/sh', [path.join(ROOT, 'mhw'), 'profile', '--help'], { cwd: dir, encoding: 'utf8' });
    assert.equal(viaSh.status, 0, viaSh.stderr);
    assert.ok(viaSh.stdout.startsWith('usage: mhw profile '));
  }
});

test('install.sh with no node reachable refuses a profile overlay before writing anything', { skip: !POSIX && 'install.sh is POSIX' }, (t) => {
  if (fs.existsSync('/usr/bin/node') || fs.existsSync('/bin/node')) {
    t.skip('a node in /usr/bin or /bin is on the reduced PATH');
    return;
  }
  for (const MHW_NODE of [undefined, 'relative/node']) {
    const home = base();
    /** @type {Record<string, string>} */
    const env = { HOME: home, PATH: '/usr/bin:/bin' };
    if (MHW_NODE) env.MHW_NODE = MHW_NODE;
    const p = spawnSync('/bin/sh', [path.join(ROOT, 'global', 'install.sh'), '--dry-run'], { env, encoding: 'utf8' });
    assert.equal(p.status, 2, p.stderr);
    assert.equal(p.stderr, 'profile overlay requires node (26 or later); no target was written\n');
    assert.deepEqual(fs.readdirSync(home), []);
  }
});

test('install.sh runs the check with the node MHW_NODE names, by absolute path', { skip: !POSIX && 'install.sh is POSIX' }, () => {
  const home = base();
  const bin = base();
  // A node that records it ran and then exits 1, so install stops right after the profile check.
  const fake = path.join(bin, 'fake-node');
  fs.writeFileSync(fake, '#!/bin/sh\necho "fake node: $*" >&2\nexit 1\n', { mode: 0o755 });
  const p = spawnSync('/bin/sh', [path.join(ROOT, 'global', 'install.sh'), '--dry-run'],
    { env: { HOME: home, PATH: '/usr/bin:/bin', MHW_NODE: fake }, encoding: 'utf8' });
  assert.equal(p.status, 1, p.stderr);
  assert.equal(p.stderr, 'fake node: ' + ROOT + '/global/../bin/mhw.js profile check --source profile.json --output .\n');
  assert.deepEqual(fs.readdirSync(home), []);
});

test('the committed overlay is current: check exits 0 and writes nothing', () => {
  const r = cli(ROOT, ['check', '--source', 'overlay/profile.json', '--output', 'overlay']);
  assert.deepEqual(r, { code: 0, stdout: 'OK: generated overlay is current\n', stderr: '' });
});
