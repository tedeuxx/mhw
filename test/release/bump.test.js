// S02 parity (#473, convention 3 of #470): src/commands/release-bump.js against bump-my-version 1.5.1.
//   golden: on a throwaway git repository holding the base revision's real .bumpversion.toml and
//           package.json (test/golden/S02/input), the Node bump must produce the commit message, tag
//           name, tag type, tag message and file diff bump-my-version produced, for major, minor and
//           patch (test/golden/S02/transcripts, recorded from bump-my-version itself).
//   live:   with MHW_BUMP_MY_VERSION naming a bump-my-version 1.5.1 executable, the two run side by side,
//           on the golden inputs and on this tree's current files. Skipped otherwise, saying why.
//   MHW_UPDATE_GOLDEN=1 (with MHW_BUMP_MY_VERSION) rewrites the transcripts from bump-my-version, never
//   from the Node script.
// Plus the refusals, the current files, and a scratch clone of this checkout (the release path's dry run).
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { throwawayHome, which } from '../helpers/home.js';
import { goldenPath, readGolden, writeGolden, UPDATE } from '../helpers/golden.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SCRIPT = path.join(ROOT, 'src', 'commands', 'release-bump.js');
const SLICE = 'S02';
const GIT = which('git');
const BMV = process.env.MHW_BUMP_MY_VERSION || '';
const PARTS = ['major', 'minor', 'patch'];
const homes = /** @type {Array<() => void>} */ ([]);
after(() => homes.forEach((c) => c()));

/** Line endings normalised, so a Windows checkout's CRLF never reads as a difference. @param {string} s */
const lf = (s) => s.replace(/\r\n/g, '\n');
/** @param {string} name */
const input = (name) => lf(fs.readFileSync(goldenPath(SLICE, 'input/' + name), 'utf8'));
const INPUTS = { '.bumpversion.toml': input('bumpversion.toml'), 'package.json': input('package.json') };

/** A fixed identity and clock, so two runs differ only in what the tool under test did. */
const IDENTITY = {
  GIT_AUTHOR_NAME: 'test', GIT_AUTHOR_EMAIL: 'test@example.invalid',
  GIT_COMMITTER_NAME: 'test', GIT_COMMITTER_EMAIL: 'test@example.invalid',
  GIT_AUTHOR_DATE: '2000-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2000-01-01T00:00:00Z',
};

/**
 * @param {string} cwd
 * @param {string[]} args
 * @param {Record<string, string>} env
 */
function git(cwd, args, env) {
  const p = spawnSync(/** @type {string} */ (GIT), args, { cwd, env, encoding: 'utf8' });
  if (p.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + p.stderr);
  return p.stdout;
}

/**
 * A throwaway repository on branch main holding files, committed once.
 * @param {Record<string, string>} files
 */
function fixture(files) {
  const h = throwawayHome('bump', IDENTITY);
  homes.push(h.cleanup);
  const repo = path.join(h.dir, 'repo');
  fs.mkdirSync(repo);
  git(repo, ['init', '-q', '-b', 'main'], h.env);
  for (const [k, v] of [['core.autocrlf', 'false'], ['commit.gpgsign', 'false'], ['tag.gpgsign', 'false']]) {
    git(repo, ['config', k, v], h.env);
  }
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(repo, name), text);
  git(repo, ['add', '-A'], h.env);
  git(repo, ['commit', '-q', '-m', 'base'], h.env);
  return { repo, env: h.env };
}

/**
 * Run the Node bump.
 * @param {string} repo
 * @param {Record<string, string>} env
 * @param {string[]} args
 */
function node(repo, env, args) {
  return spawnSync(process.execPath, [SCRIPT, ...args, '--git=' + GIT], { cwd: repo, env, encoding: 'utf8' });
}

/**
 * Run bump-my-version.
 * @param {string} repo
 * @param {Record<string, string>} env
 * @param {string} part
 */
function original(repo, env, part) {
  return spawnSync(BMV, ['bump', part], { cwd: repo, env, encoding: 'utf8' });
}

/**
 * What a bump left behind that the release path depends on.
 * @param {string} repo
 * @param {Record<string, string>} env
 */
function observe(repo, env) {
  const tags = git(repo, ['tag', '-l'], env).split('\n').filter(Boolean);
  const body = (/** @type {string} */ obj) => lf(obj).split('\n\n').slice(1).join('\n\n');
  const tag = tags[0];
  return {
    commitMessage: body(git(repo, ['cat-file', 'commit', 'HEAD'], env)),
    parents: git(repo, ['rev-list', '--parents', '-n', '1', 'HEAD'], env).trim().split(' ').length - 1,
    tags,
    tagType: tag ? git(repo, ['cat-file', '-t', tag], env).trim() : null,
    tagMessage: tag ? body(git(repo, ['cat-file', 'tag', tag], env)) : null,
    tagPointsAtHead: tag ? git(repo, ['rev-parse', tag + '^{commit}'], env) === git(repo, ['rev-parse', 'HEAD'], env) : null,
    diff: lf(git(repo, ['diff', '--no-color', '--no-ext-diff', 'HEAD^', 'HEAD'], env)),
    status: git(repo, ['status', '--porcelain'], env),
  };
}

/** @param {string} part @param {string} [variant] */
const transcriptName = (part, variant = '') => 'transcripts/' + variant + part + '.json';

// The same real files at a synthetic version with no zero part (10.3.7), so a minor that forgot to
// reset the patch, or a major that forgot the minor, cannot pass on 10.1.0's zero patch by luck.
const ALT = {
  '.bumpversion.toml': INPUTS['.bumpversion.toml'].replace('current_version = "10.1.0"', 'current_version = "10.3.7"'),
  'package.json': INPUTS['package.json'].replace('"version": "10.1.0"', '"version": "10.3.7"'),
};
const VARIANTS = /** @type {Array<[string, Record<string, string>]>} */ ([['', INPUTS], ['alt-', ALT]]);

for (const [variant, files] of VARIANTS) for (const part of PARTS) {
  test('golden: the Node bump matches bump-my-version 1.5.1 for ' + variant + part, { skip: !GIT && 'git is not on PATH' }, () => {
    if (UPDATE) {
      assert.ok(BMV, 'MHW_UPDATE_GOLDEN=1 needs MHW_BUMP_MY_VERSION: the transcripts come from bump-my-version only');
      const o = fixture(files);
      const p = original(o.repo, o.env, part);
      assert.equal(p.status, 0, p.stderr);
      writeGolden(SLICE, transcriptName(part, variant), observe(o.repo, o.env));
    }
    const want = readGolden(SLICE, transcriptName(part, variant));
    const f = fixture(files);
    const p = node(f.repo, f.env, [part]);
    assert.equal(p.status, 0, p.stderr);
    assert.equal(p.stdout, want.tags[0] + '\n');
    assert.equal(p.stderr, '');
    assert.deepEqual(observe(f.repo, f.env), want);
  });
}

test('golden: the transcripts are what a numeric cut of 10.1.0 means', () => {
  const tag = (/** @type {string} */ part) => readGolden(SLICE, transcriptName(part)).tags[0];
  assert.deepEqual(PARTS.map(tag), ['v11.0.0', 'v10.2.0', 'v10.1.1']);
  const alt = (/** @type {string} */ part) => readGolden(SLICE, transcriptName(part, 'alt-')).tags[0];
  assert.deepEqual(PARTS.map(alt), ['v11.0.0', 'v10.4.0', 'v10.3.8']);
  const patch = readGolden(SLICE, transcriptName('patch'));
  assert.equal(patch.commitMessage, 'bump: 10.1.0 \u2192 10.1.1\n');
  assert.equal(patch.tagMessage, 'bump: 10.1.0 \u2192 10.1.1\n');
  assert.equal(patch.tagType, 'tag');
  const files = [...patch.diff.matchAll(/^diff --git a\/(\S+) /gm)].map((m) => m[1]);
  assert.deepEqual(files, ['.bumpversion.toml', 'package.json']);
});

/** This tree's current configuration files, whatever version they now carry. */
function currentFiles() {
  return {
    '.bumpversion.toml': lf(fs.readFileSync(path.join(ROOT, '.bumpversion.toml'), 'utf8')),
    'package.json': lf(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')),
  };
}

test('live: bump-my-version and the Node bump agree, side by side', { skip: (!BMV && 'MHW_BUMP_MY_VERSION is not set') || (!GIT && 'git is not on PATH') }, () => {
  for (const files of [INPUTS, ALT, currentFiles()]) {
    for (const part of PARTS) {
      const a = fixture(files);
      const pa = original(a.repo, a.env, part);
      assert.equal(pa.status, 0, pa.stderr);
      const b = fixture(files);
      const pb = node(b.repo, b.env, [part]);
      assert.equal(pb.status, 0, pb.stderr);
      assert.deepEqual(observe(b.repo, b.env), observe(a.repo, a.env), part);
    }
  }
});

test('the current files bump: one line in each, the tag one patch up', { skip: !GIT && 'git is not on PATH' }, () => {
  const files = currentFiles();
  const cur = /** @type {RegExpExecArray} */ (/^current_version\s*=\s*"(\d+)\.(\d+)\.(\d+)"/m.exec(files['.bumpversion.toml']));
  assert.ok(cur, 'current_version is numeric');
  const next = cur[1] + '.' + cur[2] + '.' + (Number(cur[3]) + 1);
  const f = fixture(files);
  const p = node(f.repo, f.env, ['patch']);
  assert.equal(p.status, 0, p.stderr);
  const seen = observe(f.repo, f.env);
  assert.deepEqual(seen.tags, ['v' + next]);
  assert.equal(seen.commitMessage, 'bump: ' + cur.slice(1).join('.') + ' \u2192 ' + next + '\n');
  const changed = seen.diff.split('\n').filter((l) => /^[-+][^-+]/.test(l));
  assert.deepEqual(changed, [
    '-current_version = "' + cur.slice(1).join('.') + '"', '+current_version = "' + next + '"',
    '-  "version": "' + cur.slice(1).join('.') + '",', '+  "version": "' + next + '",',
  ]);
});

test('a scratch clone of this checkout bumps clean (the release path, run before the merge)', { skip: (!GIT && 'git is not on PATH') || (!fs.existsSync(path.join(ROOT, '.git')) && 'not a git checkout') }, () => {
  const h = throwawayHome('bump-clone', IDENTITY);
  homes.push(h.cleanup);
  const clone = path.join(h.dir, 'clone');
  // A plain local clone: the checkout's own line-ending settings apply, so on Windows (core.autocrlf
  // true on the runners) the files are CRLF in the working tree, as they are in a real checkout there.
  // --no-tags: the checkout may hold the tag of a release its own .bumpversion.toml has not reached yet
  // (rc/next before main's bump commit merges back), which the script rightly refuses to re-cut.
  git(h.dir, ['clone', '-q', '--no-tags', ROOT, clone], h.env);
  git(clone, ['config', 'commit.gpgsign', 'false'], h.env);
  git(clone, ['config', 'tag.gpgsign', 'false'], h.env);
  const before = git(clone, ['rev-parse', 'HEAD'], h.env).trim();
  const p = node(clone, h.env, ['patch']);
  assert.equal(p.status, 0, p.stderr);
  assert.match(p.stdout, /^v\d+\.\d+\.\d+\n$/);
  assert.equal(git(clone, ['status', '--porcelain'], h.env), '');
  assert.equal(git(clone, ['rev-parse', 'HEAD^'], h.env).trim(), before);
  const names = git(clone, ['diff', '--name-only', 'HEAD^', 'HEAD'], h.env).split('\n').filter(Boolean);
  assert.deepEqual(names, ['.bumpversion.toml', 'package.json']);
  assert.equal(git(clone, ['cat-file', '-t', p.stdout.trim()], h.env).trim(), 'tag');
  // The working tree's line endings survive the rewrite: only the version lines changed.
  assert.equal(git(clone, ['diff', '--numstat', 'HEAD^', 'HEAD'], h.env).trim().split('\n').map((l) => l.split('\t').slice(0, 2).join(' ')).join(','), '1 1,1 1');
});

/**
 * A refusal: non-zero exit, REFUSE on stderr, nothing committed, tagged or rewritten.
 * @param {{ repo: string, env: Record<string, string> }} f
 * @param {string[]} args
 * @param {RegExp} why
 */
function refuses(f, args, why) {
  const files = Object.fromEntries(['.bumpversion.toml', 'package.json'].map((n) => [n, fs.readFileSync(path.join(f.repo, n), 'utf8')]));
  const head = git(f.repo, ['rev-parse', 'HEAD'], f.env);
  const tags = git(f.repo, ['tag', '-l'], f.env);
  const p = node(f.repo, f.env, args);
  assert.equal(p.status, 2, p.stdout + p.stderr);
  assert.equal(p.stdout, '');
  assert.match(p.stderr, /^REFUSE {2}/);
  assert.match(p.stderr, why);
  assert.equal(git(f.repo, ['rev-parse', 'HEAD'], f.env), head);
  assert.equal(git(f.repo, ['tag', '-l'], f.env), tags);
  for (const [n, t] of Object.entries(files)) assert.equal(fs.readFileSync(path.join(f.repo, n), 'utf8'), t, n);
}

const g = { skip: !GIT && 'git is not on PATH' };

test('refuses a dirty tree: a modified tracked file', g, () => {
  const f = fixture(INPUTS);
  fs.appendFileSync(path.join(f.repo, 'package.json'), '\n');
  refuses(f, ['patch'], /not clean[\s\S]*M package\.json/);
});

test('refuses a dirty tree: a staged new file', g, () => {
  const f = fixture(INPUTS);
  fs.writeFileSync(path.join(f.repo, 'new.txt'), 'x\n');
  git(f.repo, ['add', 'new.txt'], f.env);
  refuses(f, ['patch'], /not clean[\s\S]*A {2}new\.txt/);
});

test('an untracked file is not dirt (bump-my-version ignored ?? lines too)', g, () => {
  const f = fixture(INPUTS);
  fs.writeFileSync(path.join(f.repo, 'new.txt'), 'x\n');
  const p = node(f.repo, f.env, ['patch']);
  assert.equal(p.status, 0, p.stderr);
  assert.equal(git(f.repo, ['status', '--porcelain'], f.env), '?? new.txt\n');
});

test('refuses a non-numeric current version (bump-my-version 1.5.1 dropped the suffix)', g, () => {
  for (const v of ['10.1.0-rc1', '10.1', 'v10.1.0', '10.1.0.1']) {
    const f = fixture({ ...INPUTS, '.bumpversion.toml': INPUTS['.bumpversion.toml'].replace('"10.1.0"', JSON.stringify(v)) });
    refuses(f, ['patch'], /not a numeric MAJOR\.MINOR\.PATCH/);
  }
});

test('refuses an unknown part, a missing part and a second part', g, () => {
  const f = fixture(INPUTS);
  refuses(f, ['build'], /unknown part "build"/);
  refuses(f, ['Patch'], /unknown part "Patch"/);
  refuses(f, [], /usage:/);
  refuses(f, ['patch', 'minor'], /one part only/);
});

test('refuses a tag that already exists, before committing', g, () => {
  const f = fixture(INPUTS);
  git(f.repo, ['tag', 'v10.1.1'], f.env);
  refuses(f, ['patch'], /tag v10\.1\.1 already exists/);
});

test('refuses a configured file that does not carry the current version, before writing any file', g, () => {
  const f = fixture({ ...INPUTS, 'package.json': INPUTS['package.json'].replace('"version": "10.1.0"', '"version": "9.9.9"') });
  refuses(f, ['patch'], /did not find "\\"version\\": \\"10\.1\.0\\"" in package\.json/);
});

test('refuses configuration it does not implement', g, () => {
  /** @type {Array<[string, string, RegExp]>} */
  const cases = [
    ['allow_dirty     = false', 'allow_dirty     = true', /allow_dirty = false/],
    ['tag             = true', 'tag             = false', /tag = true/],
    ['commit          = true', 'commit          = true\nsign_tags = true', /unsupported key sign_tags/],
    ['serialize       = ["{major}.{minor}.{patch}"]', 'serialize       = ["{major}.{minor}.{patch}", "{major}.{minor}"]', /exactly one format/],
    ['tag_name        = "v{new_version}"', 'tag_name        = "v{new_version!r}"', /unsupported placeholder/],
  ];
  for (const [from, to, why] of cases) {
    assert.ok(INPUTS['.bumpversion.toml'].includes(from), from);
    const f = fixture({ ...INPUTS, '.bumpversion.toml': INPUTS['.bumpversion.toml'].replace(from, to) });
    refuses(f, ['patch'], why);
  }
});

test('refuses git named by a relative path', g, () => {
  const f = fixture(INPUTS);
  const p = spawnSync(process.execPath, [SCRIPT, 'patch', '--git=git'], { cwd: f.repo, env: f.env, encoding: 'utf8' });
  assert.equal(p.status, 2);
  assert.match(p.stderr, /absolute path/);
});
