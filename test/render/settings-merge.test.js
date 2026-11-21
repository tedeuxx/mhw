// src/render/settings-merge.js and src/render/floor-report.js (#491, S20 of #470): install.test.sh's merge
// cases as node:test, the deny floor's own invariants, and the allow-list floor invariant in both directions.
// The pure functions run on every OS; the install.sh arms are POSIX only (install.ps1 merges its own
// settings), each in a throwaway HOME and admin root, with --overlay=none and --shell-rc=none.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse, stringify, equal, compact, JqNumber } from '../../src/lib/jq-json.js';
import { merged, unmerged, jqIndexed, pasteGroup, dedupe, stampOf, stampValue, main, OWN_KEY, STAMP_KEY, HOOK_ID, PASTE_ID, OLD_PASTE_ID }
  from '../../src/render/settings-merge.js';
import { denied, report } from '../../src/render/floor-report.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const SCRIPT = path.join(ROOT, 'src', 'render', 'settings-merge.js');
const STAMP = 'release: v9.9.9; commit: ' + 'a'.repeat(40);
const ALLOW_KEY = 'personal-multi-harness-workstation-configuration-owned-allow';
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 's20-unit-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** @param {string} text */
const obj = (text) => /** @type {Map<string, any>} */ (parse(text));

/**
 * The floor the deny-floor source renders to, derived here independently of install.sh's awk: cmd ->
 * Bash(<words>:*), glob -> Bash(<words>), file -> Read(<path>) and Edit(<path>).
 * @param {string} conf
 */
function expectedRules(conf) {
  const out = [];
  for (const raw of conf.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^[ \t]*(#|$)/.test(line)) continue;
    const f = line.trim().split(/[ \t]+/);
    if (f[0] === 'cmd') out.push('Bash(' + f.slice(1).join(' ') + ':*)');
    else if (f[0] === 'glob') out.push('Bash(' + f.slice(1).join(' ') + ')');
    else if (f[0] === 'file') out.push('Read(' + f[1] + ')', 'Edit(' + f[1] + ')');
    else throw new Error('unexpected floor line: ' + line);
  }
  return out;
}

/**
 * Run the whole install.sh in a fresh throwaway HOME and admin root.
 * @param {string} dir the scenario directory (holds home/ and admin/)
 * @param {string[]} args
 * @param {Record<string, string>} [extra]
 */
function installer(dir, args, extra = {}) {
  fs.mkdirSync(path.join(dir, 'home'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'admin'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tmp'), { recursive: true });
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-user', '--overlay=none', '--shell-rc=none',
    '--managed-root=' + path.join(dir, 'admin'), ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH || '', HOME: path.join(dir, 'home'), TMPDIR: path.join(dir, 'tmp'), LANG: 'C', MHW_NODE: process.execPath, ...extra },
  });
  return { code: p.status, out: p.stdout, err: p.stderr };
}

const settingsOf = (/** @type {string} */ dir) => path.join(dir, 'home', '.claude', 'settings.json');

// ---- Pure functions (every OS) ---------------------------------------------------------------------

test('merged: a missing floor rule is appended, every deny entry is kept in its place, none is removed', () => {
  const doc = obj('{"permissions": {"deny": ["Bash(mine:*)", "Bash(b:*)", 5]}, "x": 1}');
  const out = /** @type {any} */ (merged(doc, ['Bash(a:*)', 'Bash(b:*)'], null, STAMP));
  assert.deepEqual(out.get('permissions').get('deny').map((/** @type {any} */ v) => (v instanceof JqNumber ? v.raw : v)), ['Bash(mine:*)', 'Bash(b:*)', '5', 'Bash(a:*)']);
  assert.deepEqual(out.get(OWN_KEY), ['Bash(a:*)']);
  assert.equal(out.get(STAMP_KEY), stampValue(STAMP));
  assert.deepEqual([...out.keys()], ['permissions', 'x', STAMP_KEY, OWN_KEY]);
});

test('merged: an earlier record is kept; a stamped file without one counts every floor rule present as ours', () => {
  const recorded = obj('{"permissions": {"deny": ["Bash(a:*)", "Bash(b:*)"]}, "' + OWN_KEY + '": ["Bash(a:*)"]}');
  assert.deepEqual(merged(recorded, ['Bash(a:*)', 'Bash(b:*)', 'Bash(c:*)'], null, STAMP).get(OWN_KEY), ['Bash(a:*)', 'Bash(c:*)']);
  const stamped = obj('{"permissions": {"deny": ["Bash(a:*)", "Bash(b:*)"]}, "' + STAMP_KEY + '": false}');
  assert.deepEqual(merged(stamped, ['Bash(a:*)', 'Bash(c:*)'], null, STAMP).get(OWN_KEY), ['Bash(a:*)', 'Bash(c:*)']);
  const owners = obj('{"permissions": {"deny": ["Bash(a:*)"]}}');
  assert.deepEqual(merged(owners, ['Bash(a:*)', 'Bash(c:*)'], null, STAMP).get(OWN_KEY), ['Bash(c:*)']);
});

test('merged: one hook entry of ours per event; a foreign hook in the same group stays; a group left empty goes', () => {
  const cmd = '/x/' + PASTE_ID + ' prompt-hook';
  const doc = obj(JSON.stringify({ hooks: {
    UserPromptSubmit: [{ hooks: [{ command: '/old/' + PASTE_ID }] }, { hooks: [{ command: '/old2/' + PASTE_ID }, { command: '/foreign' }] }],
    PreToolUse: [{ matcher: 'AskUserQuestion', hooks: [{ command: '/s/' + HOOK_ID }] }, { hooks: [{ command: '/foreign/pre' }] }] } }));
  const out = /** @type {any} */ (merged(doc, ['Bash(a:*)'], pasteGroup(cmd), STAMP));
  const ups = out.get('hooks').get('UserPromptSubmit');
  assert.equal(ups.length, 2);
  assert.equal(ups[0].get('hooks')[0].get('command'), '/foreign');
  assert.ok(equal(ups[1], pasteGroup(cmd)));
  assert.equal(out.get('hooks').get('PreToolUse').length, 1);
  // Idempotent: exactly the wanted entry, once, is left alone.
  const again = merged(out, ['Bash(a:*)'], pasteGroup(cmd), STAMP);
  assert.equal(stringify(again), stringify(out));
});

test('merged: hooks or permissions of another shape throw, so the step refuses', () => {
  for (const text of ['{"permissions": "x"}', '{"permissions": {"deny": "x"}}', '{"permissions": {"deny": false}}', '{"hooks": "x"}',
    '{"hooks": []}', '{"hooks": {"UserPromptSubmit": "x"}}', '{"hooks": {"UserPromptSubmit": ["x"]}}']) {
    assert.throws(() => merged(obj(text), ['Bash(a:*)'], pasteGroup('c'), STAMP), text);
  }
});

test('unmerged: only what install merged leaves; an owner rule equal to a floor rule stays where the record says so', () => {
  const original = obj('{"permissions": {"deny": ["Bash(a:*)", "Bash(mine:*)"]}, "theme": "dark"}');
  const install = merged(original, ['Bash(a:*)', 'Bash(b:*)'], pasteGroup('/x/' + PASTE_ID), STAMP);
  const back = unmerged(install, ['Bash(a:*)', 'Bash(b:*)']);
  assert.ok(equal(back, original), stringify(back));
});

test('unmerged: a hooks or permissions section jq would have emptied the file on is refused instead', () => {
  for (const text of ['{"hooks": "x"}', '{"hooks": []}', '{"hooks": false}', '{"permissions": "x"}', '{"permissions": [1]}']) {
    assert.throws(() => unmerged(obj(text), ['Bash(a:*)']), text);
  }
});

test('jqIndexed: jq\'s index, a subarray for an array, nothing for an empty one', () => {
  const list = /** @type {any[]} */ (['A', 'B', new JqNumber('5')]);
  assert.ok(jqIndexed(list, 'A'));
  assert.ok(jqIndexed(list, ['A', 'B']));
  assert.ok(!jqIndexed(list, ['B', 'A']));
  assert.ok(jqIndexed(list, new JqNumber('5.0')));
  assert.ok(!jqIndexed(list, []));
  assert.ok(!jqIndexed(list, 'Z'));
});

test('dedupe keeps the first occurrence; stampOf reads the last release and commit fields', () => {
  assert.deepEqual(dedupe(['a', 'b', 'a', 'c', 'b']), ['a', 'b', 'c']);
  assert.equal(stampOf(stampValue(STAMP)), STAMP);
  assert.equal(stampOf('no marker'), 'none');
});

test('the command line refuses a usage it does not know', () => {
  const err = /** @type {string[]} */ ([]);
  assert.equal(main(['--phase=merge'], { err: (s) => err.push(s) }), 2);
  assert.equal(main(['--phase=uninstall', '--settings=x', '--floor-claude=y', '--stamp=z'], { err: (s) => err.push(s) }), 2);
  assert.match(err.join(''), /^usage: /);
});

test('the floor report: user-only, admin complete, admin incomplete and none', () => {
  const dir = freshDir('report');
  const floorClaude = path.join(dir, 'floor.claude');
  const floorCodex = path.join(dir, 'floor.codex');
  const floor = path.join(dir, 'deny-floor.conf');
  fs.writeFileSync(floorClaude, 'Bash(a:*)\nBash(b:*)\n');
  fs.writeFileSync(floorCodex, 'a\nb\n');
  fs.writeFileSync(floor, 'cmd a\ncmd b\n');
  const settings = path.join(dir, 'settings.json');
  const rules = path.join(dir, 'rules');
  const root = path.join(dir, 'admin');
  const adminClaude = path.join(root, 'etc', 'claude-code', 'managed-settings.d', '50-personal-multi-harness-workstation-configuration.json');
  const adminCodex = path.join(root, 'etc', 'codex', 'requirements.toml');
  fs.mkdirSync(path.dirname(adminClaude), { recursive: true });
  fs.mkdirSync(path.dirname(adminCodex), { recursive: true });
  const run = () => {
    const out = /** @type {string[]} */ ([]);
    report({ '--settings': settings, '--floor-claude': floorClaude, '--floor-codex': floorCodex, '--floor': floor, '--stamp': STAMP,
      '--codex-rules': rules, '--managed-root': root, '--cmd': 'mhw' },
      // The Kiro report reads its HOME from env: a throwaway one, never the real ~/.kiro.
      { out: (s) => out.push(s), err: () => {}, platform: 'linux', env: { HOME: dir, USERPROFILE: dir } });
    return out.filter((l) => l.startsWith('FLOOR   carried by')).join('');
  };
  assert.match(run(), /NO complete layer; run mhw install/);
  fs.writeFileSync(settings, '{"permissions": {"deny": ["Bash(a:*)", "Bash(b:*)"]}}');
  fs.writeFileSync(rules, '# managed-by: personal-multi-harness-workstation-configuration\n');
  assert.match(run(), /the user layer only/);
  fs.writeFileSync(adminClaude, '{"permissions": {"deny": ["Bash(a:*)"]}}');
  assert.match(run(), /the admin copy is INCOMPLETE/);
  fs.writeFileSync(adminClaude, '{"permissions": {"deny": ["Bash(a:*)", "Bash(b:*)"]}}');
  fs.writeFileSync(adminCodex, '# managed-by: personal-multi-harness-workstation-configuration\n  { pattern = [{ token = "a" }], decision = "forbidden" },\n  { pattern = [{ token = "b" }], decision = "forbidden" },\n');
  assert.match(run(), /carried by: the admin layer;/);
  // A deep file reads as none of the floor, never as all of it.
  fs.writeFileSync(settings, '{"permissions": {"deny": ["Bash(a:*)"]}, "x": ' + '['.repeat(300) + ']'.repeat(300) + '}');
  assert.deepEqual(denied(settings, ['Bash(a:*)']), { n: 0, note: ' (not read: not strict JSON)' });
});

// ---- install.sh, end to end (POSIX) ----------------------------------------------------------------

test('every line of deny-floor.conf is in settings.json after install, and every one is removed by uninstall', { skip: !POSIX && 'POSIX only' }, () => {
  const dir = freshDir('floor');
  const want = expectedRules(fs.readFileSync(path.join(ROOT, 'global', 'deny-floor.conf'), 'utf8'));
  assert.ok(want.length > 100, 'the floor has its entries');
  const r = installer(dir, []);
  assert.match(r.out, /^MERGED  .*settings\.json/m, r.err);
  const deny = obj(fs.readFileSync(settingsOf(dir), 'utf8')).get('permissions').get('deny');
  for (const rule of want) assert.ok(deny.includes(rule), 'missing after install: ' + rule);
  assert.equal(new Set(deny).size, deny.length, 'no deny rule twice');
  assert.match(r.out, new RegExp('^FLOOR   Claude Code: user layer ' + new Set(want).size + '/' + new Set(want).size + ' rules', 'm'));
  const u = installer(dir, ['--uninstall']);
  assert.match(u.out, /^UNMERGED /m, u.err);
  assert.equal(fs.readFileSync(settingsOf(dir), 'utf8'), '{}\n');
});

test('install.test.sh case 6: every key, hook and rule kept, deny a union, a backup left, the mode kept, a re-merge writes nothing', { skip: !POSIX && 'POSIX only' }, () => {
  const dir = freshDir('owner');
  const s = settingsOf(dir);
  fs.mkdirSync(path.dirname(s), { recursive: true });
  const original = '{\n    "model" : "some-model",\n    "enabledPlugins" : { "a@b" : true },\n'
    + '    "permissions" : { "allow" : [ "Bash(ls:*)" ], "ask" : [ "Edit(\\/x)" ], "deny" : [ "Bash(my-own-rule:*)", "Bash(rm -rf:*)" ] },\n'
    + '    "hooks" : { "PreToolUse" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ],'
    + ' "Stop" : [ { "hooks" : [ { "type" : "command", "command" : "\\/opt\\/status" } ] } ] }\n}\n';
  fs.writeFileSync(s, original);
  fs.chmodSync(s, 0o600);
  const dry = installer(dir, ['--dry-run']);
  assert.equal(fs.readFileSync(s, 'utf8'), original, 'a dry run writes nothing');
  assert.match(dry.out, /re-serialized/);
  installer(dir, []);
  const after = obj(fs.readFileSync(s, 'utf8'));
  const before = obj(original);
  for (const k of before.keys()) if (k !== 'permissions' && k !== 'hooks') assert.ok(equal(after.get(k), before.get(k)), k);
  const deny = after.get('permissions').get('deny');
  assert.deepEqual(deny.slice(0, 2), ['Bash(my-own-rule:*)', 'Bash(rm -rf:*)']);
  assert.equal(deny.filter((/** @type {string} */ r) => r === 'Bash(rm -rf:*)').length, 1);
  assert.equal(after.get('hooks').get('Stop').length, 1);
  assert.equal(fs.readFileSync(s + '.pmhwc-backup', 'utf8'), original);
  assert.equal(fs.statSync(s + '.pmhwc-backup').mode & 0o777, 0o600);
  assert.equal(fs.statSync(s).mode & 0o777, 0o600);
  const snap = fs.readFileSync(s);
  const again = installer(dir, []);
  assert.match(again.out, /^OK      .*settings\.json \(hook entries and all/m);
  assert.ok(fs.readFileSync(s).equals(snap), 're-merge left settings byte-identical');
  // The round trip: uninstall gives back what was there, less the allow list it also removes.
  installer(dir, ['--uninstall']);
  const back = obj(fs.readFileSync(s, 'utf8'));
  assert.ok(equal(back, before), stringify(back));
});

test('an invalid, unreadable or jq-only settings.json is refused with exit 3 and left byte for byte', { skip: !POSIX && 'POSIX only' }, () => {
  const cases = [['invalid', '{ "model": \n'], ['deny-not-an-array', '{ "permissions": { "deny": "Bash(rm -rf:*)" } }\n'],
    ['deep', '{"x": ' + '['.repeat(300) + ']'.repeat(300) + '}\n'], ['nan', '{"n": NaN}\n'], ['unreadable', '{}\n']];
  for (const [name, text] of cases) {
    const dir = freshDir(name);
    const s = settingsOf(dir);
    fs.mkdirSync(path.dirname(s), { recursive: true });
    fs.writeFileSync(s, text);
    if (name === 'unreadable') {
      if (process.getuid && process.getuid() === 0) continue;
      fs.chmodSync(s, 0);
    }
    const r = installer(dir, []);
    assert.equal(r.code, 3, name + ': ' + r.err);
    assert.match(r.err, /^REFUSE  .*settings\.json: (not a readable JSON object|not readable by the settings merge|its hooks or permissions section has an unexpected shape)/m, name);
    if (name === 'unreadable') fs.chmodSync(s, 0o600);
    assert.equal(fs.readFileSync(s, 'utf8'), text, name);
    assert.ok(!fs.existsSync(s + '.pmhwc-backup'), name);
  }
});

test('an allow list never lands without the deny floor: a refused merge writes no allow rule anywhere', { skip: !POSIX && 'POSIX only' }, () => {
  for (const text of ['{"hooks": {"UserPromptSubmit": "x"}}\n', '{"x": ' + '['.repeat(300) + ']'.repeat(300) + '}\n']) {
    const dir = freshDir('gate');
    const s = settingsOf(dir);
    fs.mkdirSync(path.dirname(s), { recursive: true });
    fs.writeFileSync(s, text);
    const r = installer(dir, []);
    assert.match(r.err, /^REFUSE  the allow list: the deny floor was not merged into /m, r.err);
    assert.equal(fs.readFileSync(s, 'utf8'), text);
    assert.ok(!fs.existsSync(path.join(dir, 'home', '.codex', 'rules', 'workstation-allow-list.rules')));
    assert.ok(!fs.existsSync(path.join(dir, 'home', '.kiro', 'agents', 'workstation.json')));
  }
  // Without a node neither runs: the floor is not merged and no allow rule is written.
  const dir = freshDir('no-node');
  const r = installer(dir, [], { MHW_NODE: path.join(dir, 'not-node') });
  assert.match(r.err, /^REFUSE  .*settings\.json: MHW_NODE \(.*not-node\) is not an executable file to merge the hook entry and the deny floor; left untouched$/m);
  assert.ok(!fs.existsSync(settingsOf(dir)));
  assert.match(r.out, /^FLOOR   not reported: MHW_NODE/m);
});

test('the deny floor never leaves while an allow list of ours remains', { skip: !POSIX && 'POSIX only' }, () => {
  const dir = freshDir('keep-floor');
  installer(dir, []);
  const s = settingsOf(dir);
  const doc = obj(fs.readFileSync(s, 'utf8'));
  assert.ok(doc.has(ALLOW_KEY), 'the allow list was installed');
  const floorCount = doc.get('permissions').get('deny').length;
  // A hand-edited allow-list record makes its uninstall refuse: the whole uninstall then stops before
  // the deny floor is taken out.
  doc.set(ALLOW_KEY, 'hand edited');
  fs.writeFileSync(s, stringify(doc, { indent: 4 }) + '\n');
  const u = installer(dir, ['--uninstall']);
  assert.notEqual(u.code, 0);
  assert.equal(obj(fs.readFileSync(s, 'utf8')).get('permissions').get('deny').length, floorCount);
  assert.doesNotMatch(u.out, /UNMERGED .*settings\.json \(our hook entries/);
  // Without a node the uninstall stops too, before anything is removed.
  const n = installer(dir, ['--uninstall'], { MHW_NODE: path.join(dir, 'not-node') });
  assert.equal(n.code, 2);
  assert.equal(obj(fs.readFileSync(s, 'utf8')).get('permissions').get('deny').length, floorCount);
});

test('a backup that cannot be written stops the installer with exit 1 and leaves settings.json as it was', { skip: !POSIX && 'POSIX only' }, () => {
  const dir = freshDir('backup');
  const s = settingsOf(dir);
  fs.mkdirSync(s + '.pmhwc-backup', { recursive: true });
  fs.writeFileSync(path.join(s + '.pmhwc-backup', 'keep'), 'x');
  fs.writeFileSync(s, '{"theme": "dark"}\n');
  const r = installer(dir, []);
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /^REFUSE  .*settings\.json\.pmhwc-backup: the backup could not be created exclusively; no backup written$/m);
  assert.equal(fs.readFileSync(s, 'utf8'), '{"theme": "dark"}\n');
  assert.doesNotMatch(r.out, /^FLOOR /m, 'the installer stopped there');
});

test('prerequisites: jq is no longer required by the workstation', () => {
  const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'global', 'prerequisites.json'), 'utf8'));
  const jq = doc.items.find((/** @type {{ id: string }} */ i) => i.id === 'jq');
  assert.ok(jq, 'jq is still declared, as optional');
  assert.equal(jq.required, 'optional');
  assert.ok(Object.values(jq.lanes || {}).every((v) => v !== 'required'), JSON.stringify(jq.lanes));
  assert.ok(!fs.readFileSync(path.join(ROOT, 'src', 'commands', 'install-user.js'), 'utf8').match(/\bjq (-|--)/), 'the user-layer installer runs no jq');
});

test('the settings step is a script run by node (it runs as its own program)', { skip: !POSIX && 'POSIX only' }, () => {
  const dir = freshDir('cli');
  const floor = path.join(dir, 'floor');
  fs.writeFileSync(floor, 'Bash(a:*)\n');
  const s = path.join(dir, 'settings.json');
  const p = spawnSync(process.execPath, [SCRIPT, '--phase=merge', '--mode=install', '--settings=' + s, '--floor-claude=' + floor, '--stamp=' + STAMP], { encoding: 'utf8' });
  assert.equal(p.status, 0, p.stderr);
  assert.equal(p.stdout, 'MERGED  ' + s + '\n');
  assert.deepEqual(obj(fs.readFileSync(s, 'utf8')).get('permissions').get('deny'), ['Bash(a:*)']);
});

test('an unexpected failure of the settings step is a refusal (exit 3), never the exit 1 of drift', () => {
  const dir = freshDir('throw');
  const floor = path.join(dir, 'floor');
  fs.writeFileSync(floor, 'Bash(a:*)\n');
  const err = /** @type {string[]} */ ([]);
  const code = main(['--phase=merge', '--mode=install', '--settings=' + path.join(dir, 's.json'), '--floor-claude=' + floor, '--stamp=' + STAMP],
    { out: () => { throw new TypeError('probe'); }, err: (s) => err.push(s) });
  assert.equal(code, 3);
  assert.match(err.join(''), /^REFUSE  .*s\.json: the settings step failed \(probe\); left untouched$/m);
});

/** The Claude, Codex and Kiro allow files of a scenario directory that exist. @param {string} dir */
function allowFiles(dir) {
  const h = path.join(dir, 'home');
  const found = [h + '/.codex/rules/workstation-allow-list.rules', h + '/.codex/workstation.config.toml', h + '/.kiro/agents/workstation.json']
    .filter((f) => fs.existsSync(f));
  const s = settingsOf(dir);
  if (fs.existsSync(s) && fs.readFileSync(s, 'utf8').includes('"' + ALLOW_KEY + '"')) found.push(s);
  return found;
}

test('a settings step that exits 1 outside --check (node\'s exit for an uncaught exception) writes no allow list for any harness', { skip: !POSIX && 'POSIX only' }, () => {
  const dir = freshDir('exit1');
  // A node that is node for everything but the settings step, which fails as an uncaught exception does.
  const stub = path.join(dir, 'node-stub');
  fs.writeFileSync(stub, '#!/bin/sh\ncase "$1" in */settings-merge.js) echo "TypeError: probe" >&2; exit 1 ;; esac\nexec "'
    + process.execPath + '" "$@"\n');
  fs.chmodSync(stub, 0o755);
  const r = installer(dir, [], { MHW_NODE: stub });
  assert.match(r.err, /^REFUSE  the allow list: the deny floor was not merged into /m, r.err);
  assert.deepEqual(allowFiles(dir), []);
  // --check still reads a 1 as drift there.
  const c = installer(dir, ['--check'], { MHW_NODE: stub });
  assert.doesNotMatch(c.err, /^REFUSE  the allow list/m);
});

test('no Codex or Kiro allow list beside a refused Codex or Kiro floor', { skip: !POSIX && 'POSIX only' }, () => {
  const codex = freshDir('codex-floor');
  const rules = path.join(codex, 'home', '.codex', 'rules', 'workstation-deny-floor.rules');
  fs.mkdirSync(path.dirname(rules), { recursive: true });
  fs.writeFileSync(rules, 'prefix_rule(pattern=["mine"], decision="forbidden")\n');
  let r = installer(codex, []);
  assert.match(r.err, /^REFUSE  .*workstation-deny-floor\.rules: exists and is NOT managed/m);
  assert.match(r.err, /^REFUSE  the Codex allow list: its deny floor was not written/m);
  const h = path.join(codex, 'home');
  assert.ok(!fs.existsSync(h + '/.codex/rules/workstation-allow-list.rules') && !fs.existsSync(h + '/.codex/workstation.config.toml'));
  assert.ok(fs.existsSync(h + '/.kiro/agents/workstation.json'), 'the Kiro allow agent still lands beside its floor');
  assert.ok(fs.readFileSync(settingsOf(codex), 'utf8').includes('"' + ALLOW_KEY + '"'), 'the Claude allow list lands beside its floor');
  const kiro = freshDir('kiro-floor');
  const yaml = path.join(kiro, 'home', '.kiro', 'settings', 'permissions.yaml');
  fs.mkdirSync(path.dirname(yaml), { recursive: true });
  fs.writeFileSync(yaml, 'rules: [unclosed\n');
  r = installer(kiro, []);
  assert.match(r.out + r.err, /^REFUSE  .*permissions\.yaml/m, r.out);
  assert.match(r.err, /^REFUSE  the Kiro allow list: its deny floor was not written/m);
  assert.ok(!fs.existsSync(path.join(kiro, 'home', '.kiro', 'agents', 'workstation.json')));
  assert.ok(fs.existsSync(path.join(kiro, 'home', '.codex', 'rules', 'workstation-allow-list.rules')), 'the Codex allow list still lands beside its floor');
});

test('the FLOOR report, every carried-by branch and every count, on a partial or foreign layer (QA B2)', () => {
  const dir = freshDir('carried');
  const floorClaude = path.join(dir, 'floor.claude');
  const floorCodex = path.join(dir, 'floor.codex');
  const floor = path.join(dir, 'deny-floor.conf');
  // Listed twice: the report counts each rule once (jq's unique).
  fs.writeFileSync(floorClaude, 'Bash(a:*)\nBash(a:*)\nBash(b:*)\n');
  fs.writeFileSync(floorCodex, 'a\nb\n');
  fs.writeFileSync(floor, 'cmd a\ncmd b\n');
  const MARK = '# managed-by: personal-multi-harness-workstation-configuration\n';
  const rulesOf = (/** @type {string[]} */ words) => MARK + words.map((w) => '  { pattern = [{ token = "' + w + '" }], decision = "forbidden" },\n').join('');
  const deny = (/** @type {string[]} */ rules) => JSON.stringify({ permissions: { deny: rules } });
  const full = deny(['Bash(a:*)', 'Bash(b:*)']);
  const deep = '{"permissions": {"deny": ["Bash(a:*)", "Bash(b:*)"]}, "x": ' + '['.repeat(300) + ']'.repeat(300) + '}';
  /**
   * @type {Array<{ name: string, user?: string, codexUser?: boolean, adminClaude?: string, adminCodex?: string[],
   *   claude: string, codex: string, carried: RegExp }>}
   */
  const cases = [
    { name: 'none', claude: 'user layer 0/2 rules; admin layer 0/2 rules', codex: 'user rules file absent; admin requirements 0/2', carried: /NO complete layer/ },
    { name: 'user layer only', user: full, codexUser: true, claude: 'user layer 2/2 rules; admin layer 0/2 rules',
      codex: 'user rules file present; admin requirements 0/2', carried: /the user layer only;/ },
    { name: 'user layer missing a rule', user: deny(['Bash(a:*)']), codexUser: true, claude: 'user layer 1/2 rules; admin layer 0/2 rules',
      codex: 'user rules file present; admin requirements 0/2', carried: /NO complete layer/ },
    { name: 'no Codex user file', user: full, claude: 'user layer 2/2 rules; admin layer 0/2 rules', codex: 'user rules file absent; admin requirements 0/2',
      carried: /NO complete layer/ },
    { name: 'admin complete', adminClaude: full, adminCodex: ['a', 'b'], claude: 'user layer 0/2 rules; admin layer 2/2 rules',
      codex: 'user rules file absent; admin requirements 2/2', carried: /carried by: the admin layer;/ },
    { name: 'Codex admin incomplete', user: full, codexUser: true, adminClaude: full, adminCodex: ['a'], claude: 'user layer 2/2 rules; admin layer 2/2 rules',
      codex: 'user rules file present; admin requirements 1/2', carried: /the user layer; the admin copy is INCOMPLETE/ },
    { name: 'Codex admin words that are not floor rules', user: full, codexUser: true, adminClaude: full, adminCodex: ['x', 'y'],
      claude: 'user layer 2/2 rules; admin layer 2/2 rules', codex: 'user rules file present; admin requirements 0/2', carried: /the admin copy is INCOMPLETE/ },
    { name: 'Claude admin incomplete', user: full, codexUser: true, adminClaude: deny(['Bash(b:*)']), adminCodex: ['a', 'b'],
      claude: 'user layer 2/2 rules; admin layer 1/2 rules', codex: 'user rules file present; admin requirements 2/2', carried: /the admin copy is INCOMPLETE/ },
    { name: 'files deeper than 256 levels', user: deep, codexUser: true, adminClaude: deep, adminCodex: ['a', 'b'],
      claude: 'user layer 0/2 rules (not read: not strict JSON); admin layer 0/2 rules (not read: not strict JSON)',
      codex: 'user rules file present; admin requirements 2/2', carried: /NO complete layer/ },
  ];
  for (const c of cases) {
    const d = path.join(dir, c.name.replaceAll(' ', '-'));
    const root = path.join(d, 'admin');
    fs.mkdirSync(root, { recursive: true });
    const settings = path.join(d, 'settings.json');
    if (c.user) fs.writeFileSync(settings, c.user);
    const rules = path.join(d, 'rules');
    if (c.codexUser) fs.writeFileSync(rules, MARK);
    if (c.adminClaude) {
      const f = path.join(root, 'etc', 'claude-code', 'managed-settings.d', '50-personal-multi-harness-workstation-configuration.json');
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, c.adminClaude);
    }
    if (c.adminCodex) {
      fs.mkdirSync(path.join(root, 'etc', 'codex'), { recursive: true });
      fs.writeFileSync(path.join(root, 'etc', 'codex', 'requirements.toml'), rulesOf(c.adminCodex));
    }
    const out = /** @type {string[]} */ ([]);
    report({ '--settings': settings, '--floor-claude': floorClaude, '--floor-codex': floorCodex, '--floor': floor, '--stamp': STAMP,
      '--codex-rules': rules, '--managed-root': root, '--cmd': 'mhw' },
    { out: (s) => out.push(s), err: () => {}, platform: 'linux', env: { HOME: d, USERPROFILE: d } });
    const text = out.join('');
    assert.ok(text.includes('FLOOR   Claude Code: ' + c.claude + '\n'), c.name + ':\n' + text);
    assert.ok(text.includes('FLOOR   Codex: ' + c.codex + ' prefix rules\n'), c.name + ':\n' + text);
    assert.match(text.split('\n').filter((l) => l.startsWith('FLOOR   carried by:')).join('\n'), c.carried, c.name + ':\n' + text);
  }
});

test('compact: jq\'s tostring form (no whitespace, keys in order, number literals and escapes kept)', () => {
  assert.equal(compact(parse('{"b": [1.50, {"k": "v\\u007f"}], "a": null, "t": true, "f": false, "n": 1e2}')),
    '{"b":[1.50,{"k":"v\\u007f"}],"a":null,"t":true,"f":false,"n":1E+2}');
  assert.equal(compact(parse('[]')), '[]');
  assert.equal(compact(parse('{}')), '{}');
  assert.equal(compact('café\n'), '"café\\n"');
});

test('the prompt hook: from the Python core\'s id or a stale Node one, install leaves exactly one group of ours, again is a no-op, uninstall removes both (QA B1)', () => {
  const cmd = '/usr/bin/env "/n/node" "/p/bin/mhw.js" hook prompt --harness claude --config "/c"';
  const start = obj(JSON.stringify({ hooks: { UserPromptSubmit: [
    { hooks: [{ type: 'command', command: '/usr/bin/python3 /old/' + OLD_PASTE_ID + ' prompt-hook' }] },
    { hooks: [{ type: 'command', command: '"/old/node" "/old/bin/mhw.js" hook prompt --harness claude' }, { type: 'command', command: '/foreign' }] }] } }));
  const once = merged(start, ['Bash(a:*)'], pasteGroup(cmd), STAMP);
  const ups = /** @type {any} */ (once).get('hooks').get('UserPromptSubmit');
  const oursIn = (/** @type {any[]} */ groups) => groups.flatMap((g) => g.get('hooks')).filter((h) => {
    const c = String(h.get('command'));
    return c.includes(PASTE_ID) || c.includes(OLD_PASTE_ID);
  }).length;
  assert.equal(oursIn(ups), 1, stringify(once));
  assert.ok(equal(ups.at(-1), pasteGroup(cmd)));
  assert.equal(ups[0].get('hooks')[0].get('command'), '/foreign');
  const twice = merged(once, ['Bash(a:*)'], pasteGroup(cmd), STAMP);
  assert.equal(stringify(twice), stringify(once), 'install again changes nothing');
  const back = /** @type {any} */ (unmerged(once, ['Bash(a:*)']));
  assert.equal(oursIn(back.get('hooks').get('UserPromptSubmit')), 0);
  // Uninstall straight from the start removes the old and the stale Node entries too.
  const fromStart = /** @type {any} */ (unmerged(start, ['Bash(a:*)']));
  assert.equal(oursIn(fromStart.get('hooks').get('UserPromptSubmit')), 0);
});
