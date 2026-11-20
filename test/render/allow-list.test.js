// The allow-list step (Issue #83, ADR-0031) in Node (#490, S19 of #470): the cases of the deleted
// global/allow-list.test.sh, plus the narrow default of every tier input, and the overlap test over both
// sources (the allow list and the deny floor). Throwaway HOMEs and a throwaway admin root only.
//   units      every OS: the parser's refusals, the overlap test, the tier inputs, the declared differences
//              (test/golden/S19/expected-differences.json), the Kiro patterns.
//   install.sh macOS and Linux, where jq is on PATH: install.sh and install-managed.sh end to end, as the
//              shell suite ran them. CODEX=<path> (or codex on PATH) adds the execpolicy arm; skipped and
//              said so otherwise.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  parseList, why, fields, prefix, words, adminState, adminPaths, codexAdminWords, claudeRender, unmerged, main, shellCount,
  codexRules, kiroAgent, retiredRules, stampOf, npmPackage,
} from '../../src/render/allow-list.js';
import { parse as parseJson, stringify, codepointCompare } from '../../src/lib/jq-json.js';
import { which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const POSIX = process.platform !== 'win32';
const MARKER = 'managed-by: personal-multi-harness-workstation-configuration';
const STAMP = 'release: v9.9.9; commit: ' + 'a'.repeat(40);
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** @param {string} label */
function freshDir(label) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-allow-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** @param {string} rel */
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

/** The deny floor as install.sh validates it: cmd word lists, glob word lists, and the Claude Code rules. */
function floorOf() {
  const text = read('global/deny-floor.conf') + read('overlay/deny-floor.conf');
  const cmd = [];
  const glob = [];
  const claude = [];
  for (const line of text.split('\n')) {
    const f = fields(line.replace(/\r$/, ''));
    if (!f.length || f[0].startsWith('#')) continue;
    const w = f.slice(1).join(' ');
    if (f[0] === 'cmd') {
      cmd.push(w);
      claude.push('Bash(' + w + ':*)');
    } else if (f[0] === 'glob') {
      glob.push(w);
      claude.push('Bash(' + w + ')');
    } else claude.push('Read(' + f[1] + ')', 'Edit(' + f[1] + ')');
  }
  return { cmd, glob, claude };
}
const FLOOR = floorOf();
const SOURCE = read('global/allow-list.conf') + read('overlay/allow-list.conf');

/** Capture a run of main(). @param {string[]} argv @param {string} [platform] */
function run(argv, platform) {
  let out = '';
  let err = '';
  const code = main(argv, {
    out: (s) => { out += s.toString(); },
    err: (s) => { err += s.toString(); },
    platform,
  });
  return { code, out, err };
}

// ---- the parser ------------------------------------------------------------------------------------

test('the repository allow list parses against the repository floor', () => {
  const { parsed, errors } = parseList(SOURCE, FLOOR.cmd);
  assert.deepEqual(errors, []);
  assert.ok(parsed.narrow.cmd.length > 0 && parsed.wide.cmd.length > 0 && parsed.wide.deny.length > 0);
  assert.deepEqual(parsed.wide.route, ['mhw milestone read']);
  assert.deepEqual(parsed.narrow.runner, []);
  assert.deepEqual(parsed.narrow.route, []);
});

// Every entry the shell suite required refused before anything was written.
const BAD = ['wide cmd git push', 'narrow cmd sudo -n', 'narrow cmd git *', 'loose cmd git status', 'wide tool Edit',
  'wide cmd python3', 'wide cmd python3.12 -m pytest', 'narrow cmd bash', 'narrow cmd sh -c', 'wide cmd env',
  'wide cmd xargs', 'wide cmd node', 'wide cmd perl', 'wide cmd ruby', 'wide cmd zsh', 'wide runner npm test',
  'wide runner make test', 'narrow cmd ./workstation status', 'narrow cmd mhw status', 'wide cmd workstation', 'wide cmd /bin/sh',
  'narrow cmd git diff', 'narrow cmd git log --oneline', 'narrow cmd git show', 'narrow cmd git grep',
  'narrow cmd git blame', 'narrow cmd git ls-files', 'narrow cmd git branch --list', 'narrow cmd git fetch',
  'wide cmd git add', 'wide cmd git commit', 'wide cmd git commit -F', 'wide cmd git worktree add',
  'wide cmd gh issue comment', 'wide cmd gh pr comment', 'wide cmd python3 -B global/x.py',
  'wide runner python3 -c x.py', 'wide runner python3 -m pytest', 'wide runner python3 global/../x.py',
  'wide runner sh /abs/x.sh', 'narrow runner sh global/x.sh', 'wide runner node x.js',
  'wide runner python3 x.py y.py', 'wide runner sh global/x.txt',
  'wide runner node global/x.py', 'wide runner perl global/x.sh', 'wide runner env global/x.sh',
  'wide cmd git -c', 'wide cmd git -c core.pager=less', 'wide cmd git -C', 'wide cmd git --exec-path',
  'narrow cmd gh -R', 'wide cmd gh pr -R', 'narrow cmd gh issue -R', 'wide cmd gh pr --repo',
  'wide cmd gh pr --repo=o', 'wide cmd gh pr view -Ro',
  'wide cmd GIT_CONFIG_PARAMETERS=x git log', 'narrow cmd GIT_PAGER=x git status',
  'wide deny GIT_PAGER=x git diff',
  'wide script python3 milestone-read.py', 'narrow route mhw milestone read',
  'wide route mhw milestone create', 'wide route mhw milestone', 'wide route mhw',
  'wide route mhw install', 'wide route workstation milestone read', 'wide route mhw milestone read 7',
  'wide route mhw milestone read --repo', 'wide cmd mhw milestone read',
  // Added in the port: each remaining branch of the checks.
  'wide', 'narrow cmd', 'wide runner sh .x.sh', 'wide runner sh a//b.sh', 'wide runner sh .sh', 'wide runner bash a/./b.sh',
  'wide runner python3 -I -X x.py', 'narrow cmd pypy3 x', 'narrow cmd perl5.30 x', 'narrow cmd gh api x', 'wide cmd git pull',
  'wide cmd git add -A', 'narrow cmd café', 'narrow cmd git status\tx|y', 'wide cmd A_1=b c'];

test('every invalid or floor-overlapping entry is refused, with the reason', () => {
  for (const bad of BAD) {
    const { errors } = parseList(bad + '\n', FLOOR.cmd);
    assert.equal(errors.length, 1, bad);
    assert.match(errors[0], /^invalid allow-list entry \(.+\): /, bad);
  }
});

test('an option before the gh or git subcommand is refused for that reason (QA B3)', () => {
  for (const [line, opt] of [['narrow cmd gh --hostname x', 'gh --hostname'], ['wide cmd gh --help', 'gh --help'],
    ['narrow cmd git --no-pager log', 'git --no-pager'], ['wide cmd gh -h', 'gh -h']]) {
    assert.equal(why(fields(line), FLOOR.cmd), '"' + opt + '" is an option before the subcommand: it reaches every subcommand (and "git -c" can run any program)', line);
  }
});

test('valid entries of each kind are accepted', () => {
  for (const good of ['narrow cmd git status', 'wide cmd git add --', 'wide cmd git commit -m', 'wide runner sh global/x.sh',
    'wide runner python3 -B -I a/b-c/d_e.f.py', 'wide runner bash -x.sh', 'wide route mhw milestone read', 'wide deny git diff --no-index',
    'narrow cmd pythonic x', 'wide cmd gh pr view']) {
    assert.deepEqual(parseList(good + '\nnarrow cmd git status\n', FLOOR.cmd).errors, [], good);
  }
});

test('a line covering a floor entry, and a line a floor entry covers, are both refused', () => {
  const floor = ['git push', 'gh secret set'];
  assert.match(why(fields('narrow cmd git'), floor), /covers the floor entry "git push"/);
  assert.match(why(fields('narrow cmd gh secret set x'), floor), /the floor entry "gh secret set" denies it/);
  assert.equal(why(fields('wide deny git push'), floor), '', 'a deny entry may repeat a floor family');
});

test('comments, blank lines, CRLF and the no-entry case', () => {
  assert.deepEqual(parseList('# c\n\n  \t# x\r\nnarrow cmd git status\r\n', []).parsed.narrow.cmd, ['git status']);
  assert.deepEqual(parseList('# nothing\nwide deny git log --output\n', []).errors, ['the allow list has no entry\n']);
  assert.deepEqual(parseList('narrow cmd git status', []).parsed.narrow.cmd, ['git status'], 'an unterminated last line');
});

test('prefix is word-wise', () => {
  assert.ok(prefix('git push', 'git push origin'));
  assert.ok(!prefix('git pus', 'git push'));
  assert.ok(!prefix('git push origin', 'git push'));
  assert.ok(prefix('', 'x'));
});

// ---- the overlap test, over both sources -----------------------------------------------------------

test('no rendered allow entry is a word prefix of a deny-floor entry, nor covered by one (both sources, every tier)', () => {
  const { parsed } = parseList(SOURCE, FLOOR.cmd);
  const allow = words(parsed, 'wide', ['cmd', 'runner', 'route']);
  assert.ok(allow.length > words(parsed, 'narrow', ['cmd', 'runner', 'route']).length);
  const floors = [...FLOOR.cmd, ...FLOOR.glob.map((g) => g.replace(/\*$/, ''))];
  const bad = [];
  for (const a of allow) {
    for (const f of floors) {
      const x = a + ' ';
      const y = f + ' ';
      if (y.startsWith(x) || x.startsWith(y)) bad.push(a + ' / ' + f);
    }
  }
  assert.deepEqual(bad, []);
  // Calibration: the test finds an overlap that is planted.
  const planted = ['git', ...allow];
  assert.ok(planted.some((a) => floors.some((f) => (f + ' ').startsWith(a + ' '))));
});

// ---- the tier inputs: missing or empty is narrow ---------------------------------------------------

/** A complete admin floor under a throwaway root, under both platform paths. @param {string} root @param {string[]} claude @param {string[]} codex */
function writeAdmin(root, claude, codex, { marker = true } = {}) {
  for (const platform of ['darwin', 'linux']) {
    const p = adminPaths(root, platform).claude;
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify({ permissions: { deny: claude } }));
  }
  const p = adminPaths(root, 'linux').codex;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, (marker ? '# ' + MARKER + '\n' : '') + codex.map((w) => '  { pattern = ['
    + w.split(' ').map((t) => '{ token = "' + t + '" }').join(', ') + '], decision = "forbidden" },\n').join(''));
}

/** @param {string} dir */
function floorFiles(dir) {
  const claude = path.join(dir, 'floor.claude');
  const codex = path.join(dir, 'floor.codex');
  fs.writeFileSync(claude, FLOOR.claude.join('\n') + '\n');
  fs.writeFileSync(codex, FLOOR.cmd.join('\n') + '\n');
  return { claude, codex };
}

/** @param {Record<string, string>} opts */
const ctxOf = (opts) => ({ out: () => {}, err: () => {}, platform: 'linux', status: 0, opts });

test('the tier is wide only with every tier input present and the admin floor complete', () => {
  const d = freshDir('tier');
  const f = floorFiles(d);
  const root = path.join(d, 'admin');
  writeAdmin(root, FLOOR.claude, FLOOR.cmd);
  const full = { '--managed-root': root, '--floor-claude': f.claude, '--floor-codex': f.codex };
  assert.deepEqual(adminState(ctxOf(full)), { claude: 'wide', codex: 'wide' });
  const empty = path.join(d, 'empty');
  fs.writeFileSync(empty, '');
  /** @type {Array<[string, Record<string, string | undefined>, { claude: string, codex: string }]>} */
  const cases = [
    ['--managed-root missing', { '--managed-root': undefined }, { claude: 'narrow', codex: 'narrow' }],
    ['--managed-root empty', { '--managed-root': '' }, { claude: 'narrow', codex: 'narrow' }],
    ['--managed-root a directory with nothing', { '--managed-root': d + '/nowhere' }, { claude: 'narrow', codex: 'narrow' }],
    ['--floor-claude missing', { '--floor-claude': undefined }, { claude: 'narrow', codex: 'wide' }],
    ['--floor-claude empty', { '--floor-claude': '' }, { claude: 'narrow', codex: 'wide' }],
    ['--floor-claude names no file', { '--floor-claude': d + '/none' }, { claude: 'narrow', codex: 'wide' }],
    ['--floor-claude an empty file', { '--floor-claude': empty }, { claude: 'narrow', codex: 'wide' }],
    ['--floor-codex missing', { '--floor-codex': undefined }, { claude: 'wide', codex: 'narrow' }],
    ['--floor-codex empty', { '--floor-codex': '' }, { claude: 'wide', codex: 'narrow' }],
    ['--floor-codex names no file', { '--floor-codex': d + '/none' }, { claude: 'wide', codex: 'narrow' }],
    ['--floor-codex an empty file', { '--floor-codex': empty }, { claude: 'wide', codex: 'narrow' }],
  ];
  for (const [name, change, want] of cases) {
    /** @type {Record<string, string>} */
    const opts = { ...full };
    for (const [k, v] of Object.entries(change)) {
      if (v === undefined) delete opts[k];
      else opts[k] = v;
    }
    assert.deepEqual(adminState(ctxOf(opts)), want, name);
  }
});

test('the Claude Code admin floor reads wide only where the shell read wide (QA B2)', () => {
  const floor = ['Bash(a:*)', 'Bash(b:*)'];
  // The shell's count, as jq computed it (measured with jq 1.7.1): a nested array that is a run of the
  // floor list counts, an empty one, a non-string or a run in the wrong order does not.
  assert.equal(shellCount(floor, /** @type {any} */ (['Bash(a:*)', 'Bash(b:*)', ['Bash(a:*)'], ['Bash(a:*)'], [], 5, null])), 3);
  assert.equal(shellCount(floor, ['Bash(a:*)', 'Bash(b:*)', ['Bash(a:*)', 'Bash(b:*)']]), 3);
  assert.equal(shellCount(floor, /** @type {any} */ (['Bash(a:*)', 'Bash(b:*)', ['Bash(b:*)', 'Bash(a:*)'], [['Bash(a:*)']], {}, true])), 2);
  const d = freshDir('b2');
  const fc = path.join(d, 'floor.claude');
  fs.writeFileSync(fc, floor.join('\n') + '\n');
  const root = path.join(d, 'admin');
  const opts = { '--managed-root': root, '--floor-claude': fc, '--floor-codex': path.join(d, 'none') };
  const admin = (/** @type {unknown[]} */ deny) => {
    for (const platform of ['darwin', 'linux']) {
      const p = adminPaths(root, platform).claude;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ permissions: { deny } }));
    }
  };
  admin([...floor, 'Bash(other:*)']);
  assert.equal(adminState(ctxOf(opts)).claude, 'wide', 'every floor rule, plus one the floor does not name');
  admin([...floor, ['Bash(a:*)']]);
  assert.equal(adminState(ctxOf(opts)).claude, 'narrow', 'every floor rule plus a nested run of it: the shell counted 3 and read narrow');
  admin([floor]);
  assert.equal(adminState(ctxOf(opts)).claude, 'narrow', 'the floor as one nested array: the shell counted 1');
});

test('the shell counted against the floor as jq unique sorts it, not in file order (PR #519 lens, round 3)', (t) => {
  // A floor file out of code-point order: the shell's $floor was jq's unique of it, so "Bash(a:*)" came first.
  const fileOrder = ['Bash(b:*)', 'Bash(a:*)'];
  const d = freshDir('b2-order');
  const fc = path.join(d, 'floor.claude');
  fs.writeFileSync(fc, fileOrder.join('\n') + '\n');
  const root = path.join(d, 'admin');
  const opts = { '--managed-root': root, '--floor-claude': fc, '--floor-codex': path.join(d, 'none') };
  /** @type {Array<[unknown[], 'wide' | 'narrow', string]>} */
  const rows = [
    [[...fileOrder, ['Bash(a:*)', 'Bash(b:*)']], 'narrow', 'a pair adjacent in sorted order: the shell counted 3'],
    [[...fileOrder, ['Bash(b:*)', 'Bash(a:*)']], 'wide', 'a pair adjacent in file order only: the shell counted 2'],
  ];
  const jq = POSIX ? which('jq') : null;
  for (const [deny, want, name] of rows) {
    for (const platform of ['darwin', 'linux']) {
      const p = adminPaths(root, platform).claude;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, JSON.stringify({ permissions: { deny } }));
    }
    assert.equal(adminState(ctxOf(opts)).claude, want, name);
    if (!jq) continue;
    // The shell's own two jq programs (allow-list.sh's allow_admin_state), run on the same files.
    const f = spawnSync(jq, ['-cR', '-s', 'split("\\n") | map(select(length > 0)) | unique', fc], { encoding: 'utf8' }).stdout.trim();
    const n = spawnSync(jq, ['--argjson', 'f', f, '[(.permissions.deny? // [])[] | select(. as $r | $f | index($r))] | unique | length',
      adminPaths(root, 'linux').claude], { encoding: 'utf8' }).stdout.trim();
    assert.equal(Number(n) === fileOrder.length ? 'wide' : 'narrow', want, name + ': jq itself');
  }
  if (!jq) t.diagnostic('jq is not on PATH: the rows were not also run through jq');
  // The lens's measurement on the repository floor: every rule as a string, plus a pair adjacent in sorted
  // order and not in the file's. The shell counted one more than the floor and read narrow.
  const sorted = [...new Set(FLOOR.claude)].sort(codepointCompare);
  const k = sorted.findIndex((r, j) => j + 1 < sorted.length && FLOOR.claude.indexOf(sorted[j + 1]) !== FLOOR.claude.indexOf(r) + 1);
  assert.ok(k >= 0, 'the repository floor is not in sorted order');
  fs.writeFileSync(fc, FLOOR.claude.join('\n') + '\n');
  for (const platform of ['darwin', 'linux']) {
    fs.writeFileSync(adminPaths(root, platform).claude, JSON.stringify({ permissions: { deny: [...FLOOR.claude, [sorted[k], sorted[k + 1]]] } }));
  }
  assert.equal(adminState(ctxOf(opts)).claude, 'narrow', 'the repository floor plus a pair adjacent only in sorted order');
});

test('an incomplete or unmanaged admin floor is narrow (declared differences: stricter than the shell)', () => {
  const d = freshDir('admin');
  const f = floorFiles(d);
  const root = path.join(d, 'admin');
  const opts = { '--managed-root': root, '--floor-claude': f.claude, '--floor-codex': f.codex };
  writeAdmin(root, FLOOR.claude.slice(1), FLOOR.cmd.slice(1));
  assert.deepEqual(adminState(ctxOf(opts)), { claude: 'narrow', codex: 'narrow' }, 'one entry missing');
  writeAdmin(root, FLOOR.claude, FLOOR.cmd, { marker: false });
  assert.equal(adminState(ctxOf(opts)).codex, 'narrow', 'no managed-by marker');
  // The shell counted admin lines matching the floor: one entry twice and another missing read as complete.
  writeAdmin(root, FLOOR.claude, [FLOOR.cmd[0], ...FLOOR.cmd.slice(0, -1)]);
  assert.equal(adminState(ctxOf(opts)).codex, 'narrow', 'a repeated entry does not stand for a missing one');
  // The shell's jq also counted a matching value inside a deny object.
  for (const platform of ['darwin', 'linux']) {
    fs.writeFileSync(adminPaths(root, platform).claude, JSON.stringify({ permissions: { deny: Object.fromEntries(FLOOR.claude.map((r, k) => [String(k), r])) } }));
  }
  assert.equal(adminState(ctxOf(opts)).claude, 'narrow', 'a deny object is not a deny list');
  for (const platform of ['darwin', 'linux']) fs.writeFileSync(adminPaths(root, platform).claude, '{"permissions": ');
  assert.equal(adminState(ctxOf(opts)).claude, 'narrow', 'not JSON');
  // An empty floor read as complete in the shell (0 = 0).
  const empty = path.join(d, 'empty');
  fs.writeFileSync(empty, '\n');
  writeAdmin(root, [], []);
  assert.deepEqual(adminState(ctxOf({ '--managed-root': root, '--floor-claude': empty, '--floor-codex': empty })), { claude: 'narrow', codex: 'narrow' });
});

test('the Codex admin rules are read as allow-list.sh read them', () => {
  assert.deepEqual(codexAdminWords('# x\n  { pattern = [{ token = "git" }, { token = "push" }], decision = "forbidden", justification = "a" },\n'
    + '{ pattern = [{ token = "sudo" }], decision = "forbidden" }\r\n  { pattern = [{ token = "x" }], decision = "allow" },\n'
    + '  pattern = [{ token = "y" }], decision = "forbidden"\n'), ['git push', 'sudo']);
});

// ---- the step through main(): required values, and the narrow default end to end ------------------

/** The arguments of a step run on a fresh HOME. @param {string} d */
function stepArgs(d) {
  const f = floorFiles(d);
  const home = path.join(d, 'home');
  fs.mkdirSync(home, { recursive: true });
  const conf = path.join(d, 'allow-list.conf');
  fs.writeFileSync(conf, SOURCE);
  fs.writeFileSync(path.join(d, 'allow-retired.conf'), read('global/allow-retired.conf'));
  const root = path.join(d, 'admin');
  writeAdmin(root, FLOOR.claude, FLOOR.cmd);
  return {
    home,
    args: /** @type {Record<string, string>} */ ({ '--phase': 'step', '--mode': 'install', '--stamp': STAMP, '--source': conf,
      '--retired': path.join(d, 'allow-retired.conf'), '--floor-codex': f.codex, '--floor-claude': f.claude, '--managed-root': root,
      '--settings': home + '/.claude/settings.json', '--home': home, '--codex-home': '', '--repo-root': d, '--cmd': './mhw' }),
  };
}

/** @param {Record<string, string>} a */
const argv = (a) => Object.entries(a).map(([k, v]) => k + '=' + v);

/** Every file under dir. @param {string} dir @returns {string[]} */
function filesUnder(dir) {
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

test('a required value missing or empty refuses the run before anything is written', () => {
  for (const k of ['--mode', '--stamp', '--source', '--retired', '--floor-codex', '--settings', '--home', '--repo-root', '--phase']) {
    for (const value of [undefined, '']) {
      const d = freshDir('req');
      const { home, args } = stepArgs(d);
      if (value === undefined) delete args[k];
      else args[k] = value;
      const r = run(argv(args), 'linux');
      assert.equal(r.code, 2, k);
      assert.match(r.err, /^usage: allow-list\.js /, k);
      assert.equal(r.out, '', k);
      assert.deepEqual(filesUnder(home), [], k);
    }
  }
  assert.equal(run(['--phase=step', '--mode=uninstall'], 'linux').code, 2, 'the step takes no uninstall mode');
  assert.equal(run(['--phase=parse', '--source=x', '--floor-codex=y', '--nope=1'], 'linux').code, 2, 'an unknown option');
  assert.equal(run(['--phase=parse', '--source=x', '--source=x', '--floor-codex=y'], 'linux').code, 2, 'a repeated option');
  assert.equal(run(['--phase=parse', 'bare'], 'linux').code, 2, 'a bare word');
});

test('each tier input missing renders the narrow tier and the RISK line (the main risk of #490)', { skip: !POSIX && 'POSIX paths' }, () => {
  const d0 = freshDir('wide');
  const full = stepArgs(d0);
  const wide = run(argv(full.args), 'linux');
  assert.equal(wide.code, 0, wide.err);
  assert.doesNotMatch(wide.out, /^RISK /m);
  assert.match(wide.out, /^ALLOW   Claude Code: wide tier · Codex: wide tier/m);
  const wideSettings = parseJson(fs.readFileSync(full.home + '/.claude/settings.json', 'utf8'));
  assert.ok(wideSettings instanceof Map);
  for (const [k, value] of [['--managed-root', undefined], ['--managed-root', ''], ['--floor-claude', undefined], ['--floor-claude', ''],
    ['--floor-codex', '/nonexistent/floor']]) {
    const d = freshDir('narrow');
    const { home, args } = stepArgs(d);
    if (value === undefined) delete args[/** @type {string} */ (k)];
    else args[/** @type {string} */ (k)] = value;
    const r = run(argv(args), 'linux');
    const where = k + '=' + String(value);
    if (k === '--floor-codex') {
      assert.equal(r.code, 2, where + ': the floor is needed to check the list');
      assert.deepEqual(filesUnder(home), [], where);
      continue;
    }
    assert.equal(r.code, 0, where + r.err);
    assert.equal(r.out.split('\n').filter((l) => l.startsWith('RISK ')).length, 1, where);
    const s = parseJson(fs.readFileSync(home + '/.claude/settings.json', 'utf8'));
    const perms = /** @type {Map<string, any>} */ (/** @type {Map<string, any>} */ (s).get('permissions'));
    assert.ok(!perms.has('defaultMode'), where + ': no permission mode');
    const allow = /** @type {string[]} */ (perms.get('allow'));
    assert.ok(!allow.some((a) => /^Bash\((git diff|git commit|git add|python3|sh|mhw) /.test(a)), where + ': no wide rule');
    if (k === '--managed-root') {
      assert.match(fs.readFileSync(home + '/.codex/workstation.config.toml', 'utf8'), /sandbox_mode = "read-only"/, where);
      assert.doesNotMatch(fs.readFileSync(home + '/.codex/rules/workstation-allow-list.rules', 'utf8'), /\["git", "diff"\]/, where);
    }
  }
});

test('a floor of no entry is a narrow tier for both harnesses, not the shell 0 = 0 wide', { skip: !POSIX && 'POSIX paths' }, () => {
  const d = freshDir('emptyfloor');
  const { home, args } = stepArgs(d);
  fs.writeFileSync(path.join(d, 'nofloor'), '');
  writeAdmin(args['--managed-root'], [], []);
  const r = run(argv({ ...args, '--floor-claude': path.join(d, 'nofloor'), '--floor-codex': path.join(d, 'nofloor') }), 'linux');
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^RISK    admin deny floor incomplete \(Claude Code: narrow, Codex: narrow tier\)/m);
  assert.match(fs.readFileSync(home + '/.codex/workstation.config.toml', 'utf8'), /read-only/);
});

// ---- the jq programs: shapes refused ---------------------------------------------------------------

/** @param {string} text */
const doc = (text) => /** @type {Map<string, any>} */ (parseJson(text));
const KEY = 'personal-multi-harness-workstation-configuration-owned-allow';

test('an ownership record or permissions of another shape is refused (declared difference)', () => {
  for (const t of ['{"' + KEY + '": {"allow": "Bash(x:*)"}}', '{"' + KEY + '": {"deny": {"a": 1}}}', '{"permissions": "x"}',
    '{"permissions": {"deny": "x"}}', '{"hooks": 1}']) {
    assert.throws(() => claudeRender(doc(t), ['Bash(git status:*)'], null, []), Error, t);
  }
  assert.doesNotThrow(() => claudeRender(doc('{"' + KEY + '": "not an object"}'), ['Bash(git status:*)'], null, []));
  for (const t of ['{"' + KEY + '": "x"}', '{"' + KEY + '": {"allow": "x"}}', '{"permissions": 3, "' + KEY + '": {}}']) {
    assert.throws(() => unmerged(doc(t)), Error, t);
  }
});

test('uninstall removes only what the record names, and the mode only while it is still ours', () => {
  const out = unmerged(doc('{"permissions": {"allow": ["a", "b"], "defaultMode": "acceptEdits", "deny": ["d", "e"]}, "x": 1, "'
    + KEY + '": {"allow": ["a"], "defaultMode": "acceptEdits", "deny": ["d", "e"]}}'));
  assert.equal(stringify(out), '{\n  "permissions": {\n    "allow": [\n      "b"\n    ]\n  },\n  "x": 1\n}');
  const kept = unmerged(doc('{"permissions": {"defaultMode": "plan"}, "' + KEY + '": {"defaultMode": "acceptEdits"}}'));
  assert.equal(stringify(kept, { indent: 0 }).replaceAll('\n', ''), '{"permissions": {"defaultMode": "plan"}}');
  assert.equal(stringify(unmerged(doc('{"permissions": {}, "' + KEY + '": {}}'))), '{}');
});

test('the retired list skips blank and comment lines, and keeps a carriage return', () => {
  assert.deepEqual(retiredRules('# c\n \t\n  # x\nBash(find:*)\nBash(awk*)\r\n\v\n'), ['Bash(find:*)', 'Bash(awk*)\r']);
});

test('stampOf takes the last release and commit fields followed by a semicolon', () => {
  const d = freshDir('stamp');
  const f = path.join(d, 'f');
  fs.writeFileSync(f, 'x\n# ' + MARKER + '; release: a; commit: b; release: c; commit: d; x\n');
  assert.equal(stampOf(f), 'release: c; commit: d');
  fs.writeFileSync(f, '# ' + MARKER + '; release: a; commit: b\n');
  assert.equal(stampOf(f), 'none', 'a commit field with no semicolon after it');
  assert.equal(stampOf(path.join(d, 'none')), 'none');
});

test('npmPackage: a real directory under node_modules with package.json and no .git', { skip: !POSIX && 'POSIX paths' }, () => {
  const d = freshDir('npm');
  const pkg = path.join(d, 'lib', 'node_modules', 'mhw');
  fs.mkdirSync(pkg, { recursive: true });
  assert.equal(npmPackage(pkg), null, 'no package.json');
  fs.writeFileSync(path.join(pkg, 'package.json'), '{}');
  assert.equal(npmPackage(pkg), pkg);
  fs.symlinkSync('/nowhere', path.join(pkg, '.git'));
  assert.equal(npmPackage(pkg), null, 'a dangling .git link');
  fs.rmSync(path.join(pkg, '.git'));
  const link = path.join(d, 'node_modules', 'mhw');
  fs.mkdirSync(path.dirname(link));
  fs.symlinkSync(path.join(d, 'checkout'), link);
  fs.mkdirSync(path.join(d, 'checkout'));
  fs.writeFileSync(path.join(d, 'checkout', 'package.json'), '{}');
  assert.equal(npmPackage(link), null, 'npm link: the real path is the checkout');
  assert.equal(npmPackage(path.join(d, 'gone')), null);
});

// ---- the rendered files ----------------------------------------------------------------------------

const PARSED = parseList(SOURCE, FLOOR.cmd).parsed;

test('Codex: the wide rules forbid each escaping option and name no test runner', () => {
  const wide = codexRules(PARSED, 'wide', STAMP);
  assert.equal(wide.split('\n').filter((l) => l.endsWith('decision="forbidden")')).length, PARSED.wide.deny.length);
  assert.doesNotMatch(wide, /"python3"|milestone/);
  const narrow = codexRules(PARSED, 'narrow', STAMP);
  assert.equal(narrow.split('\n').filter((l) => l.endsWith('decision="allow")')).length, PARSED.narrow.cmd.length);
  assert.doesNotMatch(narrow, /decision="forbidden"/);
});

test('Kiro patterns admit the inner loop and refuse chaining, expansion and lookalikes', () => {
  const agent = JSON.parse(kiroAgent(PARSED, STAMP));
  const pats = agent.toolsSettings.execute_bash.allowedCommands.map((/** @type {string} */ p) => new RegExp(p));
  const ok = (/** @type {string} */ c) => pats.some((/** @type {RegExp} */ p) => p.test(c));
  for (const c of ['git status', 'git status --short', 'gh pr view 12 --json body', 'git rev-parse --show-toplevel']) assert.ok(ok(c), c);
  for (const c of ['git status; touch x', 'git status && touch x', 'git status | sh', 'git status $(touch x)',
    'git status\ntouch x', 'Xgit status', 'git statusx', 'git commit -m x', 'xgit status']) assert.ok(!ok(c), c);
  assert.deepEqual(agent.allowedTools, ['fs_read']);
  assert.equal(agent.toolsSettings.execute_bash.allowedCommands.length, PARSED.narrow.cmd.length);
});

test('Kiro V3 permissions admit what the 2.x patterns admit (an emulation of the matcher, not a Kiro run)', () => {
  const agent = JSON.parse(kiroAgent(PARSED, STAMP));
  const n = PARSED.narrow.cmd.length;
  const rules = agent.permissions.rules;
  assert.deepEqual(rules.map((/** @type {{ capability: string }} */ r) => r.capability), ['shell', 'fs_read']);
  const [sh, fr] = rules;
  assert.deepEqual(fr, { capability: 'fs_read', effect: 'allow' });
  assert.deepEqual(Object.keys(sh).sort((a, b) => (a < b ? -1 : 1)), ['capability', 'effect', 'exclude', 'match']);
  assert.equal(sh.match.length, 2 * n);
  for (const r of rules) assert.ok(1 + (r.exclude || []).length + (r.effect === 'ask' ? 1 : 0) <= 32);
  const esc = (/** @type {string} */ s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const glob = (/** @type {string} */ p) => (p.endsWith(' *')
    ? new RegExp('^' + esc(p.slice(0, -2)) + '( [\\s\\S]*)?$')
    : new RegExp('^' + p.split('*').map(esc).join('[\\s\\S]*') + '$'));
  const inc = sh.match.map(glob);
  const exc = sh.exclude.map(glob);
  const v3 = (/** @type {string} */ c) => inc.some((/** @type {RegExp} */ p) => p.test(c)) && !exc.some((/** @type {RegExp} */ p) => p.test(c));
  const legacy = agent.toolsSettings.execute_bash.allowedCommands.map((/** @type {string} */ p) => new RegExp(p));
  const v2 = (/** @type {string} */ c) => legacy.some((/** @type {RegExp} */ p) => p.test(c));
  const samples = ['git status', 'git status --short', 'gh pr view 12 --json body', 'git rev-parse --show-toplevel',
    'git status > x', 'git status < x', 'git status $(touch x)', 'git status `touch x`', 'git status (x)',
    'git status {x}', 'git status; touch x', 'git status && touch x', 'git status | sh',
    'Xgit status', 'git statusx', 'git commit -m x', 'xgit status',
    'git status --short\ntouch x', 'git status --short\rtouch x', 'git status\n', 'git status\r'];
  assert.ok(sh.exclude.includes('*\n*') && sh.exclude.includes('*\r*'));
  assert.deepEqual(samples.filter((c) => v2(c) !== v3(c)), []);
  assert.ok(v3('git status --short') && !v3('git status > x') && !v3('git commit -m x'));
});

// ---- install.sh end to end (the shell suite's cases 1 to 7 and 9) ----------------------------------

const JQ = which('jq');
const INSTALL = path.join(ROOT, 'global', 'install.sh');
const MANAGED = path.join(ROOT, 'global', 'install-managed.sh');
const E2E = !POSIX ? 'POSIX only (install.sh)' : (!JQ && 'jq is not on PATH');

/** @param {string} home @param {Record<string, string>} [extra] */
function env(home, extra = {}) {
  /** @type {Record<string, string>} */
  const e = { PATH: process.env.PATH || '', HOME: home, SHELL: '/bin/sh', TMPDIR: process.env.TMPDIR || os.tmpdir(),
    MHW_NODE: process.execPath, LANG: 'C', ...extra };
  return e;
}

/** @param {string} home @param {string[]} args @param {Record<string, string>} [extra] */
function install(home, args, extra) {
  fs.mkdirSync(home, { recursive: true });
  const p = spawnSync('/bin/sh', [INSTALL, ...args], { encoding: 'utf8', env: env(home, extra), timeout: 600000 });
  return { code: p.status, out: p.stdout + p.stderr, stdout: p.stdout };
}

/** @param {string} file @returns {Map<string, any>} */
const settingsOf = (file) => /** @type {Map<string, any>} */ (parseJson(fs.readFileSync(file, 'utf8')));
/** @param {string} file */
const permsOf = (file) => /** @type {Map<string, any>} */ (settingsOf(file).get('permissions') || new Map());
/** @param {string} file @returns {string[]} */
const allowOf = (file) => permsOf(file).get('allow') || [];
/** @param {string} file @returns {string[]} */
const denyOf = (file) => permsOf(file).get('deny') || [];

/** The admin floor installed under a throwaway root by install-managed.sh itself. @param {string} home @param {string} root */
function adminFloor(home, root) {
  fs.mkdirSync(root, { recursive: true });
  const tmp = freshDir('mgr-tmp');
  const st = spawnSync('/bin/sh', [MANAGED, '--root=' + root], { encoding: 'utf8', env: env(home, { TMPDIR: tmp }) });
  const line = (st.stdout.split('\n').find((l) => l.startsWith('RUN     ')) || '');
  const stage = (/--apply="([^"]*)"/.exec(line) || [])[1];
  const sha = (/--sha256=([0-9a-f]*)/.exec(line) || [])[1];
  assert.ok(stage && sha, st.stdout + st.stderr);
  const ap = spawnSync('/bin/sh', [MANAGED, '--apply=' + stage, '--sha256=' + sha, '--root=' + root], { encoding: 'utf8', env: env(home, { TMPDIR: tmp }) });
  assert.equal(ap.status, 0, ap.stdout + ap.stderr);
}

const parsedRepo = parseList(SOURCE, FLOOR.cmd).parsed;
const N_NARROW = words(parsedRepo, 'narrow', ['cmd', 'runner', 'route']).length;
const N_WIDE = words(parsedRepo, 'wide', ['cmd', 'runner', 'route']).length;

test('install.sh: narrow without an admin floor, wide with it, narrow again without it', { skip: E2E }, () => {
  const d = freshDir('e2e');
  const h = path.join(d, 'home-narrow');
  const empty = path.join(d, 'root-empty');
  fs.mkdirSync(empty);
  let r = install(h, ['--managed-root=' + empty]);
  assert.equal(r.code, 0, r.out);
  const s = h + '/.claude/settings.json';
  assert.equal(allowOf(s).filter((a) => a.startsWith('Bash(') && !a.startsWith('Bash(/')).length >= N_NARROW, true);
  assert.equal(allowOf(s).length, N_NARROW, r.out);
  assert.ok(!permsOf(s).has('defaultMode'));
  assert.ok(!allowOf(s).some((a) => /^Bash\((git switch|git diff|git commit|git add|python3|sh) /.test(a)));
  assert.ok(!denyOf(s).some((a) => a.startsWith('Bash(git diff --no-index')));
  assert.equal(r.stdout.split('\n').filter((l) => l.startsWith('RISK ')).length, 1);
  assert.match(fs.readFileSync(h + '/.codex/workstation.config.toml', 'utf8'), /^sandbox_mode = "read-only"$/m);
  // The protecting Edit denies, in the narrow tier too; a checkout denies no edit to itself.
  for (const rule of ['Edit(~/.claude/settings.json)', 'Edit(~/.codex/rules/**)', 'Edit(~/.codex/*.config.toml)', 'Edit(~/.kiro/agents/**)',
    'Edit(/' + ROOT + '/global/allow-list.conf)', 'Edit(/' + ROOT + '/overlay/**)', 'Edit(**/.git/config)', 'Edit(**/.git/hooks/**)']) {
    assert.equal(denyOf(s).filter((x) => x === rule).length, 1, rule);
  }
  assert.ok(!denyOf(s).includes('Edit(/' + ROOT + '/**)'));
  assert.equal(install(h, ['--check', '--managed-root=' + empty]).code, 0, 'check clean on the narrow tier');
  const targets = [s, h + '/.codex/workstation.config.toml', h + '/.codex/rules/workstation-allow-list.rules', h + '/.kiro/agents/workstation.json'];
  const snap = targets.map((f) => fs.readFileSync(f, 'utf8'));
  install(h, ['--managed-root=' + empty]);
  assert.deepEqual(targets.map((f) => fs.readFileSync(f, 'utf8')), snap, 're-run leaves every target byte-identical');

  const root = path.join(d, 'root-admin');
  adminFloor(h, root);
  r = install(h, ['--check', '--managed-root=' + root]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /^NOTE .*settings\.json: the narrow allow list is installed/m);
  r = install(h, ['--managed-root=' + root]);
  assert.equal(r.code, 0, r.out);
  assert.equal(allowOf(s).length, N_WIDE);
  assert.equal(permsOf(s).get('defaultMode'), 'acceptEdits');
  assert.doesNotMatch(r.stdout, /^RISK /m);
  const rules = fs.readFileSync(h + '/.codex/rules/workstation-allow-list.rules', 'utf8');
  assert.match(fs.readFileSync(h + '/.codex/workstation.config.toml', 'utf8'), /workspace-write/);
  assert.doesNotMatch(rules, /"python3"/);
  assert.equal(JSON.parse(fs.readFileSync(h + '/.kiro/agents/workstation.json', 'utf8')).toolsSettings.execute_bash.allowedCommands.length,
    parsedRepo.narrow.cmd.length, 'Kiro stays narrow');
  assert.equal(install(h, ['--check', '--managed-root=' + root]).code, 0, 'check clean on the wide tier');
  for (const a of ['Bash(git diff:*)', 'Bash(git add --:*)', 'Bash(git commit -m:*)', 'Bash(mhw milestone read:*)']) assert.ok(allowOf(s).includes(a), a);
  for (const x of ['Bash(git diff --no-index:*)', 'Bash(git fetch --upload-pack:*)']) assert.ok(denyOf(s).includes(x), x);
  assert.equal(allowOf(s).filter((a) => a.startsWith('Bash(mhw') || a.startsWith('Bash(workstation')).length, 1);

  // Deny beats allow: no rendered allow rule overlaps a floor family, and the floor is still merged.
  const allowWords = allowOf(s).filter((a) => a.startsWith('Bash(')).map((a) => a.slice(5, -3));
  for (const a of allowWords) {
    for (const f of FLOOR.cmd) assert.ok(!((f + ' ').startsWith(a + ' ') || (a + ' ').startsWith(f + ' ')), a + ' / ' + f);
  }
  for (const rule of FLOOR.claude.filter((x) => x.startsWith('Bash('))) assert.ok(denyOf(s).includes(rule), rule);

  r = install(h, ['--check', '--managed-root=' + empty]);
  assert.equal(r.code, 1, 'a wide list without the admin floor is drift');
  install(h, ['--managed-root=' + empty]);
  assert.equal(allowOf(s).length, N_NARROW);
  assert.ok(!permsOf(s).has('defaultMode'));
  assert.match(fs.readFileSync(h + '/.codex/workstation.config.toml', 'utf8'), /read-only/);
});

test('install.sh: invalid entries stop the run before anything is written', { skip: E2E }, () => {
  for (const bad of ['wide cmd git push', 'narrow cmd sh -c', 'wide route mhw install', 'narrow cmd GIT_PAGER=x git status']) {
    const d = freshDir('bad');
    const ov = path.join(d, 'ov');
    fs.mkdirSync(ov);
    fs.writeFileSync(path.join(ov, 'allow-list.conf'), bad + '\n');
    const h = path.join(d, 'home');
    const r = install(h, ['--overlay=' + ov, '--managed-root=' + path.join(d, 'root')]);
    assert.equal(r.code, 2, bad + r.out);
    assert.match(r.out, /^invalid allow-list entry/m, bad);
    assert.deepEqual(filesUnder(h), [], bad);
  }
});

/** A PATH with no node on it, or null when that would also lose jq (PR #519 lens B1). */
function pathWithoutNode() {
  const dirs = (process.env.PATH || '').split(path.delimiter).filter((d) => d && !fs.existsSync(path.join(d, 'node')));
  const p = dirs.join(path.delimiter);
  return dirs.some((d) => fs.existsSync(path.join(d, 'jq'))) ? p : null;
}

/** Every file under dir with its bytes. @param {string} dir */
function snapshot(dir) {
  return Object.fromEntries(filesUnder(dir).sort((a, b) => (a < b ? -1 : Number(a > b))).map((f) => [f, fs.readFileSync(f, 'latin1')]));
}

const NO_NODE = POSIX ? pathWithoutNode() : null;
/** @type {Array<[string, () => Record<string, string>, string | false]>} */
const NODELESS = [
  ['MHW_NODE is not node', () => ({ MHW_NODE: '/usr/bin/true' }), false],
  ['no node on PATH', () => ({ MHW_NODE: '', PATH: /** @type {string} */ (NO_NODE) }),
    NO_NODE ? false : 'jq shares its directory with node on this machine, so PATH cannot hold one without the other'],
];
for (const tier of ['narrow', 'wide']) for (const [how, extra, cannot] of NODELESS) {
  test('install.sh: an uninstall without a usable node never removes the floor from beside the allow list (' + tier + ', ' + how + ', lens B1)', { skip: E2E || cannot }, () => {
    const d = freshDir('b1-' + tier);
    const h = path.join(d, 'home');
    const root = path.join(d, 'root');
    if (tier === 'wide') adminFloor(path.join(d, 'mgr'), root);
    else fs.mkdirSync(root);
    let r = install(h, ['--managed-root=' + root]);
    assert.equal(r.code, 0, r.out);
    assert.equal(permsOf(h + '/.claude/settings.json').has('defaultMode'), tier === 'wide');
    const before = snapshot(h);
    r = install(h, ['--uninstall'], extra());
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /^REFUSE  uninstall: the allow list this installer wrote cannot be removed without node, .*nothing uninstalled\. Re-run with node 26 or later on PATH \(or MHW_NODE\)$/m);
    assert.deepEqual(snapshot(h), before, 'nothing uninstalled');
    // With a node, the same uninstall removes both.
    r = install(h, ['--uninstall']);
    assert.equal(r.code, 0, r.out);
    const s = h + '/.claude/settings.json';
    if (fs.existsSync(s)) {
      assert.ok(!allowOf(s).some((a) => a.startsWith('Bash(git ')), 'our allows left');
      assert.ok(!settingsOf(s).has('personal-multi-harness-workstation-configuration-owned-allow'));
    }
    assert.ok(!fs.existsSync(h + '/.codex/rules/workstation-allow-list.rules'));
  });
}

// QA B4: one row per artefact the no-node guard reads, each left alone after install, so each arm of the
// guard is the only thing that can refuse.
const OWN_KEY = 'personal-multi-harness-workstation-configuration-owned-allow';
const ARTEFACTS = ['the ownership key', '.codex/rules/workstation-allow-list.rules', '.codex/workstation.config.toml', '.kiro/agents/workstation.json'];
for (const keep of ARTEFACTS) {
  test('install.sh: the no-node uninstall guard refuses with only ' + keep + ' left (QA B4)', { skip: E2E }, () => {
    const d = freshDir('b4');
    const h = path.join(d, 'home');
    fs.mkdirSync(path.join(d, 'root'));
    let r = install(h, ['--managed-root=' + path.join(d, 'root')]);
    assert.equal(r.code, 0, r.out);
    const s = h + '/.claude/settings.json';
    if (keep !== 'the ownership key') {
      const doc = settingsOf(s);
      doc.delete(OWN_KEY);
      fs.writeFileSync(s, stringify(doc, { indent: 4 }) + '\n');
    }
    for (const f of ARTEFACTS.slice(1)) if (f !== keep) fs.rmSync(path.join(h, f));
    const before = snapshot(h);
    r = install(h, ['--uninstall'], { MHW_NODE: '/usr/bin/true' });
    assert.equal(r.code, 2, r.out);
    assert.match(r.out, /^REFUSE  uninstall: the allow list this installer wrote cannot be removed without node/m);
    assert.deepEqual(snapshot(h), before);
  });
}

test('the allow step stops after a backup it cannot write, and touches nothing (declared difference 7, QA A6)', { skip: !POSIX && 'POSIX paths' }, () => {
  const d = freshDir('a6');
  const { home, args } = stepArgs(d);
  fs.mkdirSync(home + '/.claude', { recursive: true });
  const s = home + '/.claude/settings.json';
  fs.writeFileSync(s, '{"permissions": {"allow": ["Bash(find *)"]}}\n');
  fs.mkdirSync(s + '.pmhwc-allow-backup');
  fs.writeFileSync(s + '.pmhwc-allow-backup/keep', 'x');
  const r = run(argv(args), 'linux');
  assert.equal(r.code, 1, r.err);
  assert.match(r.err, /^REFUSE  .*settings\.json\.pmhwc-allow-backup: the backup could not be created exclusively; no backup written$/m);
  assert.equal(fs.readFileSync(s, 'utf8'), '{"permissions": {"allow": ["Bash(find *)"]}}\n');
  assert.ok(!fs.existsSync(home + '/.codex/rules/workstation-allow-list.rules'));
  assert.doesNotMatch(r.out, /^ALLOW /m);
});

/** Inputs jq 1.7.1 reads and strict JSON does not (QA B1 d), each in an installed-looking settings.json. */
const JQ_ONLY = [['NaN', '{"permissions": {"allow": ["Bash(find:*)"]}, "n": NaN}\n'],
  ['a byte-order mark', '﻿{"permissions": {"allow": ["Bash(find:*)"]}}\n'],
  ['a leading zero', '{"permissions": {"allow": ["Bash(find:*)"]}, "n": 01}\n'],
  ['two documents', '{"permissions": {"allow": ["Bash(find:*)"]}} {}\n'],
  ['a trailing NUL', '{"permissions": {"allow": ["Bash(find:*)"]}}\n\u0000']];
for (const [name, text] of JQ_ONLY) {
  test('a settings.json jq reads and strict JSON does not is refused visibly and left untouched: ' + name + ' (QA B1)', { skip: !POSIX && 'POSIX paths' }, () => {
    for (const mode of ['check', 'dry-run', 'install', 'uninstall']) {
      const d = freshDir('b1d');
      const { home, args } = stepArgs(d);
      fs.mkdirSync(home + '/.claude', { recursive: true });
      const s = home + '/.claude/settings.json';
      fs.writeFileSync(s, text);
      /** @type {Record<string, string>} */
      const a = mode === 'uninstall'
        ? { '--phase': 'uninstall', '--settings': s, '--home': home, '--codex-home': '' }
        : { ...args, '--mode': mode };
      const r = run(argv(a), 'linux');
      assert.equal(r.code, 3, mode + r.err);
      assert.match(r.err, /^REFUSE  .*settings\.json: not readable by the allow-list step .*; left untouched$/m, mode);
      assert.equal(fs.readFileSync(s, 'utf8'), text, mode);
      assert.ok(!fs.existsSync(s + '.pmhwc-allow-backup'), mode);
    }
  });
}

test('install.sh: where merge_settings refuses the file, no allow rule lands in it (QA B1 a, b, c)', { skip: E2E }, () => {
  for (const [name, text] of [['a lone high surrogate', '{"permissions": {"allow": ["Bash(find:*)"]}, "x": "\\ud800"}\n'],
    ['300 levels', '{"permissions": {"allow": ["Bash(find:*)"]}, "x": ' + '['.repeat(299) + ']'.repeat(299) + '}\n'],
    ['10,000 levels', '{"permissions": {"allow": ["Bash(find:*)"]}, "x": ' + '['.repeat(10000) + ']'.repeat(10000) + '}\n']]) {
    const d = freshDir('b1a');
    const h = path.join(d, 'home');
    fs.mkdirSync(h + '/.claude', { recursive: true });
    fs.writeFileSync(h + '/.claude/settings.json', text);
    fs.mkdirSync(path.join(d, 'root'));
    // --overlay=none: the overlay's model defaults (src/render/model-defaults.js, S10) rewrite such a file
    // with a parser of their own, which is that step's behaviour, not this one's.
    const r = install(h, ['--overlay=none', '--managed-root=' + path.join(d, 'root')]);
    assert.doesNotMatch(r.out, /RangeError|^MERGED  .*settings\.json \(allow list/m, name);
    const after = fs.readFileSync(h + '/.claude/settings.json', 'utf8');
    if (name === 'a lone high surrogate') {
      // Every jq build refuses it: merge_settings left it untouched, and so did the allow step.
      assert.match(r.out, /^ALLOW   /m, name + ': the rest of the step still runs');
      assert.match(r.out, /settings\.json: .*left untouched/, name);
      assert.equal(after, text, name);
    } else {
      // Apple's jq refuses it (merge_settings leaves it untouched). On the Ubuntu runner an earlier
      // install.sh step ends the run before the allow step (CI of PR #519; not this step's code). Either
      // way nothing of the allow list lands in it, and where the allow step runs it refuses visibly.
      if (/^ALLOW   /m.test(r.out)) assert.match(r.out, /^REFUSE  .*settings\.json: not readable by the allow-list step/m, name);
      assert.ok(!after.includes('"' + OWN_KEY + '"') && !after.includes('Edit(~/.kiro/agents/**)'), name + ': ' + r.out.slice(-2000));
    }
  }
});

test('install.sh: an uninstall over a settings.json jq reads and strict JSON does not keeps the floor (QA B1 d, lens A3)', { skip: E2E }, () => {
  const d = freshDir('b1d-e2e');
  const h = path.join(d, 'home');
  fs.mkdirSync(path.join(d, 'root'));
  let r = install(h, ['--managed-root=' + path.join(d, 'root')]);
  assert.equal(r.code, 0, r.out);
  const s = h + '/.claude/settings.json';
  fs.writeFileSync(s, fs.readFileSync(s, 'utf8').replace(/^\{/, '{\n    "n": NaN,'));
  const before = fs.readFileSync(s, 'utf8');
  r = install(h, ['--uninstall']);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /^REFUSE  .*settings\.json: not readable by the allow-list step/m);
  assert.match(r.out, /^REFUSE  uninstall: the allow-list step failed \(exit 3\)/m);
  assert.equal(fs.readFileSync(s, 'utf8'), before, 'settings.json, its floor and its allow rules, untouched');
  assert.ok(fs.existsSync(h + '/.codex/rules/workstation-allow-list.rules'));
});

test('install.sh: a failed allow uninstall stops the uninstall, so the floor stays beside the allow rules (lens A3)', { skip: E2E }, () => {
  const d = freshDir('a3');
  const h = path.join(d, 'home');
  fs.mkdirSync(path.join(d, 'root'));
  let r = install(h, ['--managed-root=' + path.join(d, 'root')]);
  assert.equal(r.code, 0, r.out);
  const s = h + '/.claude/settings.json';
  const doc = settingsOf(s);
  doc.set('personal-multi-harness-workstation-configuration-owned-allow', 'edited by hand');
  fs.writeFileSync(s, stringify(doc, { indent: 4 }) + '\n');
  const denyBefore = denyOf(s).length;
  const allowBefore = allowOf(s);
  r = install(h, ['--uninstall']);
  assert.equal(r.code, 3, r.out);
  assert.match(r.out, /^REFUSE  uninstall: the allow-list step failed \(exit 3\), and the deny floor must not leave from beside its allow rules; nothing else uninstalled\. Fix .*settings\.json \(or move it aside\) and re-run$/m);
  assert.equal(denyOf(s).length, denyBefore, 'the deny floor is still there');
  assert.ok(denyBefore > FLOOR.claude.filter((x) => x.startsWith('Bash(')).length);
  assert.deepEqual(allowOf(s), allowBefore);
});

test('install.sh: an uninstall without node and nothing of the allow list left says so and goes on', { skip: E2E }, () => {
  const d = freshDir('b1-none');
  const h = path.join(d, 'home');
  fs.mkdirSync(h + '/.claude', { recursive: true });
  fs.writeFileSync(h + '/.claude/settings.json', '{"permissions": {"allow": ["Bash(make:*)"]}}\n');
  const r = install(h, ['--uninstall'], { MHW_NODE: '/usr/bin/true' });
  assert.equal(r.code, 2, r.out);
  assert.match(r.out, /^REFUSE  the allow list: \/usr\/bin\/true did not run as node; nothing written$/m);
  assert.doesNotMatch(r.out, /^REFUSE  uninstall:/m);
});

test('install.sh: a MHW_NODE that does not run as node is refused, never a silent success (lens A1)', { skip: E2E }, () => {
  const d = freshDir('a1');
  const h = path.join(d, 'home');
  const r = install(h, ['--overlay=none', '--managed-root=' + d], { MHW_NODE: '/usr/bin/true' });
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /^REFUSE  the allow list: \/usr\/bin\/true did not run as node; nothing written$/m);
  assert.ok(!fs.existsSync(h + '/.codex/rules/workstation-allow-list.rules'));
  assert.ok(!fs.existsSync(h + '/.kiro/agents/workstation.json'));
});

test('install.sh: an absolute MHW_NODE that is not executable is refused and no allow file is written', { skip: E2E }, () => {
  const d = freshDir('badnode');
  const h = path.join(d, 'home');
  const r = install(h, ['--overlay=none', '--managed-root=' + d], { MHW_NODE: path.join(d, 'no-node') });
  assert.notEqual(r.code, 0);
  assert.match(r.out, /^REFUSE  the allow list: MHW_NODE \(.*no-node\) is not an executable file; nothing written$/m);
  assert.ok(!fs.existsSync(h + '/.codex/rules/workstation-allow-list.rules'));
  assert.ok(!fs.existsSync(h + '/.kiro/agents/workstation.json'));
});

test('install.sh: the owner\'s rules and mode survive install and uninstall; an unmanaged profile is refused', { skip: E2E }, () => {
  const d = freshDir('own');
  const root = path.join(d, 'root');
  adminFloor(path.join(d, 'mgr-home'), root);
  const h = path.join(d, 'home');
  fs.mkdirSync(h + '/.claude', { recursive: true });
  fs.writeFileSync(h + '/.claude/settings.json', '{ "permissions": { "allow": ["Bash(make lint:*)", "Bash(git status:*)"], "defaultMode": "plan" } }\n');
  const r = install(h, ['--managed-root=' + root]);
  assert.equal(r.code, 0, r.out);
  const s = h + '/.claude/settings.json';
  assert.equal(permsOf(s).get('defaultMode'), 'plan');
  assert.match(r.out, /your own permissions\.defaultMode \(plan\) is kept/);
  assert.equal(allowOf(s).filter((a) => a === 'Bash(git status:*)').length, 1);
  assert.equal(install(h, ['--uninstall']).code, 0);
  assert.deepEqual(allowOf(s), ['Bash(make lint:*)', 'Bash(git status:*)']);
  assert.equal(permsOf(s).get('defaultMode'), 'plan');
  assert.ok(!denyOf(s).some((x) => x.startsWith('Edit(')));
  assert.deepEqual([...settingsOf(s).keys()], ['permissions']);
  for (const f of ['/.codex/workstation.config.toml', '/.codex/rules/workstation-allow-list.rules', '/.kiro/agents/workstation.json']) {
    assert.ok(!fs.existsSync(h + f), f);
  }
  const c = path.join(d, 'home-clash');
  fs.mkdirSync(c + '/.codex', { recursive: true });
  fs.writeFileSync(c + '/.codex/workstation.config.toml', 'sandbox_mode = "read-only"\n');
  assert.equal(install(c, ['--managed-root=' + root]).code, 3);
  assert.equal(fs.readFileSync(c + '/.codex/workstation.config.toml', 'utf8'), 'sandbox_mode = "read-only"\n');
});

test('install.sh: an npm layout Edit-denies its own package directory, a checkout or a copy does not', { skip: E2E }, () => {
  for (const layout of ['npm', 'copy', 'npm-with-git']) {
    const d = freshDir(layout);
    const pkg = layout === 'copy' ? path.join(d, 'plain-copy', 'mhw') : path.join(d, 'lib', 'node_modules', 'mhw');
    fs.mkdirSync(pkg, { recursive: true });
    for (const x of ['global', 'overlay', 'bin', 'src']) fs.cpSync(path.join(ROOT, x), path.join(pkg, x), { recursive: true });
    for (const x of ['.bumpversion.toml', 'package.json', '.workstation-archive']) fs.copyFileSync(path.join(ROOT, x), path.join(pkg, x));
    if (layout === 'npm-with-git') fs.writeFileSync(path.join(pkg, '.git'), 'gitdir: /nowhere\n');
    const h = path.join(d, 'home');
    fs.mkdirSync(h);
    const p = spawnSync('/bin/sh', [path.join(pkg, 'global', 'install.sh'), '--managed-root=' + path.join(d, 'root')], { encoding: 'utf8', env: env(h) });
    assert.equal(p.status, 0, layout + p.stdout + p.stderr);
    const whole = denyOf(h + '/.claude/settings.json').filter((x) => /^Edit\(\/\/.*\/\*\*\)$/.test(x) && !x.endsWith('/overlay/**)'));
    assert.deepEqual(whole, layout === 'npm' ? ['Edit(/' + fs.realpathSync(pkg) + '/**)'] : [], layout);
  }
});

test('install.sh: the retired allows are removed with a backup, and uninstall leaves the note', { skip: E2E }, () => {
  const d = freshDir('retired');
  const h = path.join(d, 'home');
  fs.mkdirSync(h + '/.claude', { recursive: true });
  fs.writeFileSync(h + '/.claude/settings.json', '{"permissions": {"allow": ["Bash(find:*)", "Bash(make:*)"]}}\n');
  let r = install(h, ['--check', '--managed-root=' + d]);
  assert.match(r.out, /^DRIFT   .*settings\.json: install would change permissions\.allow Bash\(find:\*\) present -> absent/m);
  r = install(h, ['--managed-root=' + d]);
  assert.match(r.out, /^CHANGED .*previous file kept as .*settings\.json\.pmhwc-allow-backup\)$/m);
  assert.ok(!allowOf(h + '/.claude/settings.json').includes('Bash(find:*)'));
  assert.ok(allowOf(h + '/.claude/settings.json').includes('Bash(make:*)'));
  assert.equal(fs.statSync(h + '/.claude/settings.json.pmhwc-allow-backup').mode & 0o777, 0o600);
  r = install(h, ['--uninstall']);
  assert.match(r.out, /uninstall does not re-add them \(ADR-0035 decision 4\)/);
});

test('codex execpolicy: deny beats allow across the two rendered rules files (credential-free)', { skip: E2E }, (t) => {
  const cx = process.env.CODEX || which('codex');
  if (!cx) return t.skip('codex not found; the execpolicy arm did not run');
  const d = freshDir('codex');
  const h = path.join(d, 'home');
  const root = path.join(d, 'root');
  adminFloor(path.join(d, 'mgr'), root);
  assert.equal(install(h, ['--managed-root=' + root]).code, 0);
  const r1 = h + '/.codex/rules/workstation-allow-list.rules';
  const r2 = h + '/.codex/rules/workstation-deny-floor.rules';
  const cxHome = path.join(d, 'cx');
  fs.mkdirSync(cxHome);
  const decide = (/** @type {string[]} */ words) => {
    const p = spawnSync(cx, ['execpolicy', 'check', '-r', r1, '-r', r2, '--', ...words], { encoding: 'utf8', env: { ...env(cxHome), CODEX_HOME: cxHome } });
    try {
      return JSON.parse(p.stdout).decision || 'none';
    } catch {
      return 'unreadable';
    }
  };
  assert.equal(decide(['git', 'status', '--short']), 'allow');
  for (const w of FLOOR.cmd) assert.equal(decide([...w.split(' '), 'x']), 'forbidden', w);
  for (const [want, form] of [['allow', 'git commit -m msg'], ['allow', 'git add -- a'], ['forbidden', 'git diff --no-index a b'],
    ['forbidden', 'git log --output x'], ['forbidden', 'git fetch --upload-pack x']]) {
    assert.equal(decide(form.split(' ')), want, form);
  }
});
