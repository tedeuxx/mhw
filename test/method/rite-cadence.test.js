// S06 parity (#477, convention 3 of #470): `mhw rite-cadence` against the deleted
// method/scripts/rite-cadence.py, on the cases of its own suite (rite-cadence.test.py, one case per test
// method and subTest), plus argument forms and a git that is not on PATH.
//   golden: each case builds a throwaway git repository and runs the Node command in this process (and, on
//           the cases marked cli, through bin/mhw.js and, POSIX, ./mhw); every run is compared with the transcript recorded from
//           the Python original (stdout, stderr, exit code), and each case's own assertions, ported from
//           the Python suite, hold on every run. Runs on every OS.
//   live:   where the base revision still holds rite-cadence.py (until this slice merges) and python3 is
//           on PATH, the original runs on the same repository beside the Node command, and the ported
//           assertions hold on both. POSIX only. MHW_UPDATE_GOLDEN=1 rewrites the golden transcripts from
//           the Python side, never from the Node side.
// Normalised before comparing: the case's directory (<BASE>), a short commit (its subject and committer
// date, so a hash that differs by git build cannot break the comparison while naming the wrong commit
// still does), and git's own text after "git <cmd> failed: ", which differs between git versions.
// Intended differences are in test/golden/S06/expected-differences.json, each with its reason.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { run } from '../../src/commands/rite-cadence.js';
import { readGolden, writeGolden, UPDATE } from '../helpers/golden.js';
import { which } from '../helpers/home.js';
import { extractRevision } from '../helpers/parity.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SLICE = 'S06';
const POSIX = process.platform !== 'win32';
const GIT = which('git');
const PY = which('python3');
const RAN = 'FUNNEL-REVIEW-RAN';
const NOT_COLLECTED = 'FUNNEL-REVIEW-NOT-COLLECTED';
const STORE = 'docs/funnel-review';
/** @type {Array<{ case: string[], stream: 'stdout' | 'stderr', base: string, replace?: string, head?: string, why: string }>} */
const expected = readGolden(SLICE, 'expected-differences.json');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {{ code: number, stdout: string, stderr: string }} Result
 * @typedef {{ name: string, run: (args: string[], cwd: string, env: Record<string, string>) => Result }} Runner
 * @typedef {{ args: string[], code: number, stdout: string, stderr: string }} Run
 */

/** A fresh, resolved directory under the OS temporary directory. */
function freshBase() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s06-')));
  cleanups.push(() => {
    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // a chmod-0 fixture file is restored by its case; anything left is the OS temp dir's
    }
  });
  return dir;
}

/** One throwaway repository; every run of a case goes through every runner on the same state. */
class Fixture {
  /** @param {Runner[]} runners */
  constructor(runners) {
    this.runners = runners;
    this.base = '';
    this.repo = '';
    this.store = '';
    /** @type {Record<string, string>} */
    this.env = {};
    this.n = 0;
    /** @type {Run[][]} one list per runner */
    this.runs = [];
    this.reset();
  }

  reset() {
    this.base = freshBase();
    this.repo = path.join(this.base, 'repo');
    fs.mkdirSync(this.repo);
    const empty = path.join(this.base, 'gitconfig');
    fs.writeFileSync(empty, '');
    /** @type {Record<string, string>} */
    const env = {};
    for (const [k, v] of Object.entries(process.env)) if (v !== undefined) env[k] = v;
    for (const k of Object.keys(env)) if (k.startsWith('GIT_') || k === 'FORCE_COLOR') delete env[k];
    Object.assign(env, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: empty, GIT_AUTHOR_NAME: 't',
      GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@example.invalid',
      NO_COLOR: '1', PYTHON_COLORS: '0', PYTHONDONTWRITEBYTECODE: '1' });
    this.env = env;
    this.n = 0;
    this.git(['init', '-q']);
    this.store = path.join(this.repo, ...STORE.split('/'));
    fs.mkdirSync(this.store, { recursive: true });
    this.runs = this.runners.map(() => []);
  }

  /**
   * @param {string[]} args
   * @param {{ date?: string, env?: Record<string, string> }} [o]
   */
  git(args, o = {}) {
    const env = { ...this.env, ...(o.env || {}) };
    if (o.date) env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = o.date + 'T12:00:00+00:00';
    const p = spawnSync(/** @type {string} */ (GIT), ['-C', this.repo, ...args], { env, encoding: 'utf8' });
    assert.equal(p.status, 0, 'git ' + args.join(' ') + ': ' + p.stderr);
    return p.stdout;
  }

  /** A commit subject unique in the case, so a short hash maps to one commit. @param {string} what */
  subject(what) {
    this.n += 1;
    return 'c' + this.n + ' ' + what;
  }

  /** @param {string} name @param {string} text */
  write(name, text) {
    fs.writeFileSync(path.join(this.store, name), text);
  }

  /** @param {string} name @param {string} text @param {string} date */
  commit(name, text, date) {
    this.write(name, text);
    this.git(['add', '--', path.join(this.store, name)]);
    this.git(['commit', '-q', '-m', this.subject('add ' + name)], { date });
  }

  /** @param {string} name @param {string} text @param {string} date */
  append(name, text, date) {
    fs.appendFileSync(path.join(this.store, name), text);
    this.git(['add', '--', path.join(this.store, name)]);
    this.git(['commit', '-q', '-m', this.subject('edit ' + name)], { date });
  }

  shortHead() {
    return this.git(['rev-parse', '--short', 'HEAD']).trim();
  }

  /** What the struck check-3 command printed. @param {string} root */
  struck(root) {
    return this.git(['log', '-1', '--format=%cs %h', '--', root]).trim();
  }

  /**
   * Run the command through every runner; check each result; record it.
   * @param {string[]} args
   * @param {(r: Result) => void} [check]
   * @param {{ cwd?: string, env?: Record<string, string> }} [o]
   */
  run(args, check, o = {}) {
    const env = { ...this.env, ...(o.env || {}) };
    const cwd = o.cwd || this.repo;
    const labels = this.labels();
    this.runners.forEach((runner, i) => {
      const r = runner.run(args, cwd, env);
      if (check) {
        try {
          check(r);
        } catch (e) {
          if (e instanceof Error) e.message = runner.name + ' ' + JSON.stringify(args) + ': ' + e.message;
          throw e;
        }
      }
      this.runs[i].push({ args: args.map((a) => norm(a, this.base, labels)), code: r.code,
        stdout: norm(r.stdout, this.base, labels), stderr: norm(r.stderr, this.base, labels) });
    });
  }

  /** full hash -> "<subject | committer date>", over every commit any ref or reflog reaches. */
  labels() {
    const p = spawnSync(/** @type {string} */ (GIT), ['-C', this.repo, 'log', '--all', '--reflog', '--format=%H%x09%s | %cs'], { env: this.env, encoding: 'utf8' });
    /** @type {Map<string, string>} */
    const m = new Map();
    if (p.status !== 0) return m;
    for (const line of p.stdout.split('\n').filter(Boolean)) {
      const [hash, label] = line.split('\t');
      m.set(hash, '<' + label + '>');
    }
    return m;
  }
}

/**
 * Normalise one stream or argument.
 * @param {string} s
 * @param {string} base
 * @param {Map<string, string>} labels
 */
function norm(s, base, labels) {
  let out = s.replace(/\r\n/g, '\n').split(base).join('<BASE>');
  if (!POSIX) out = out.split(base.replace(/\\/g, '/')).join('<BASE>').replace(/<BASE>[^\s"']*/g, (p) => p.replace(/\\/g, '/'));
  out = out.replace(/\(([0-9a-f]{4,40})\)/g, (whole, h) => {
    const hits = [...labels.keys()].filter((k) => k.startsWith(h));
    return hits.length === 1 ? '(' + labels.get(hits[0]) + ')' : whole;
  });
  return out.replace(/^(rite-cadence: git \S+ failed: ).*$/gm, '$1<git stderr>');
}

// Assertions ported from rite-cadence.test.py.
/** @param {string} root @param {string} [marker] */
const neverLine = (root, marker = RAN) => root + ': never landed a file carrying ' + marker + '\n';
/** @param {Result} r */
const never = (r) => {
  assert.equal(r.code, 0, r.stderr);
  assert.equal(r.stdout, neverLine(STORE));
};
/** @param {string} s @returns {(r: Result) => void} */
const has = (s) => (r) => assert.ok(r.stdout.includes(s), JSON.stringify(r));
/** @param {string} s @returns {(r: Result) => void} */
const is = (s) => (r) => assert.equal(r.stdout, s, r.stderr);
/** @param {number} code @returns {(r: Result) => void} */
const usage = (code) => (r) => {
  assert.equal(r.code, code, r.stderr);
  assert.equal(r.stdout, '');
};
/** @param {string} stderr @returns {(r: Result) => void} */
const headFailure = (stderr = 'rite-cadence: HEAD names no readable commit\n') => (r) => {
  assert.equal(r.code, 1);
  assert.equal(r.stdout, '');
  assert.equal(r.stderr, stderr);
};

/**
 * The no-marker date equals the struck command's.
 * @param {Fixture} f
 * @param {string} root
 * @param {string} date the date the case expects
 */
function asStruck(f, root, date) {
  const struck = f.struck(root);
  assert.ok(struck, 'the fixture must give the struck command a date');
  const [d, commit] = struck.split(' ');
  assert.equal(d, date);
  f.run([root], (r) => {
    assert.equal(r.code, 0, r.stderr);
    assert.equal(r.stdout, root + ': last changed ' + d + ' (' + commit + '), no ran-marker declared\n');
  });
}

/**
 * @typedef {{ name: string, skip?: () => string, noGit?: boolean, cli?: boolean, build: (f: Fixture) => void }} Case
 */

/** @type {Case[]} */
const CASES = [
  { name: 'calibration-readme-then-not-collected-then-ran', cli: true, build: (f) => {
    f.commit('README.md', '# The store\n\nReports land here.\n', '2026-01-01');
    f.run([STORE, RAN], never);
    f.run([STORE], (r) => {
      assert.equal(r.code, 0, r.stderr);
      assert.ok(r.stdout.startsWith(STORE + ': last changed 2026-01-01 ('), r.stdout);
    });
    f.commit('sprint-01.md', '# sprint-01\n\n' + NOT_COLLECTED + '\n\nNothing was read.\n', '2026-02-02');
    f.run([STORE, RAN], never);
    f.run([STORE], (r) => assert.ok(r.stdout.startsWith(STORE + ': last changed 2026-02-02 ('), r.stdout));
    f.commit('sprint-02.md', '# sprint-02\n\n' + RAN + '\n\n## Findings\n\nNone.\n', '2026-03-03');
    f.run([STORE, RAN], (r) => {
      assert.equal(r.code, 0, r.stderr);
      assert.match(r.stdout, /^docs\/funnel-review: last ran 2026-03-03 \([0-9a-f]+\), dated by files carrying FUNNEL-REVIEW-RAN\n$/);
    });
  } },
  { name: 'later-scaffolding-does-not-move-the-date', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.commit('README.md', '# The store\n', '2026-04-04');
    f.commit('sprint-03.md', NOT_COLLECTED + '\n', '2026-05-05');
    f.run([STORE, RAN], has('last ran 2026-03-03 ('));
    f.run([STORE], has('last changed 2026-05-05 ('));
  } },
  { name: 'marker-must-be-a-whole-line', build: (f) => {
    f.commit('README.md', 'A ran report prints ' + RAN + ' at column 0.\n  ' + RAN + '\n' + RAN + '-NOT\n', '2026-01-01');
    f.run([STORE, RAN], never);
  } },
  { name: 'crlf-report-counts', build: (f) => {
    f.commit('sprint-02.md', '# sprint-02\r\n' + RAN + '\r\n', '2026-03-03');
    f.run([STORE, RAN], has('last ran 2026-03-03 ('));
  } },
  { name: 'untracked-or-uncommitted-ran-report-not-dated', build: (f) => {
    f.commit('README.md', '# The store\n', '2026-01-01');
    f.write('sprint-02.md', RAN + '\n');
    f.run([STORE, RAN], never);
    f.git(['add', '--', path.join(f.store, 'sprint-02.md')]);
    f.run([STORE, RAN], never);
  } },
  { name: 'file-outside-the-root-not-dated', build: (f) => {
    fs.writeFileSync(path.join(f.repo, 'other.md'), RAN + '\n');
    f.git(['add', 'other.md']);
    f.git(['commit', '-q', '-m', f.subject('outside')], { date: '2026-03-03' });
    f.commit('README.md', '# The store\n', '2026-01-01');
    f.run([STORE, RAN], never);
  } },
  { name: 'empty-root-is-never', cli: true, build: (f) => {
    f.commit('README.md', 'x\n', '2026-01-01');
    f.run(['docs/nothing-here', RAN], is(neverLine('docs/nothing-here')));
    f.run(['docs/nothing-here'], is('docs/nothing-here: never changed\n'));
  } },
  { name: 'runs-from-a-subdirectory-with-repo', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.run(['--repo', f.store, STORE, RAN], has('last ran 2026-03-03 ('), { cwd: f.base });
  } },
  { name: 'git-failure-is-an-error-not-never', cli: true, build: (f) => {
    const outside = path.join(f.base, 'not-a-repo');
    fs.mkdirSync(outside);
    f.run(['--repo', outside, STORE, RAN], (r) => {
      assert.equal(r.code, 1);
      assert.equal(r.stdout, '');
      assert.ok(r.stderr.includes('rite-cadence: git rev-parse failed'), r.stderr);
    }, { cwd: f.base, env: { GIT_CEILING_DIRECTORIES: f.base } });
  } },
  { name: 'ruled-line-at-planning-does-not-move-the-date', build: (f) => {
    f.commit('sprint-02.md', '# sprint-02\n\n' + RAN + '\n\nCandidate rule: x\n', '2026-10-10');
    f.append('sprint-02.md', 'Ruled: not adopted at /sprint-planning sprint-06\n', '2026-10-24');
    f.run([STORE, RAN], has('last ran 2026-10-10 ('));
    f.run([STORE], has('last changed 2026-10-24 ('));
  } },
  { name: 'marker-only-in-working-copy-not-dated', build: (f) => {
    f.commit('old.md', 'plain\n', '2026-02-02');
    f.write('old.md', RAN + '\n');
    f.run([STORE, RAN], never);
    f.git(['add', '--', path.join(f.store, 'old.md')]);
    f.run([STORE, RAN], never);
  } },
  { name: 'lose-and-regain-dated-by-the-regain', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.commit('sprint-02.md', 'withdrawn\n', '2026-04-04');
    f.run([STORE, RAN], never);
    f.commit('sprint-02.md', RAN + '\n', '2026-05-05');
    f.run([STORE, RAN], has('last ran 2026-05-05 ('));
  } },
  { name: 'only-removing-a-marker-line-does-not-date', build: (f) => {
    f.commit('sprint-02.md', RAN + '\nbody\n' + RAN + '\n', '2026-03-03');
    f.commit('sprint-02.md', RAN + '\nbody\n', '2026-04-04');
    f.run([STORE, RAN], has('last ran 2026-03-03 ('));
  } },
  { name: 'glob-character-in-a-marked-name-literal', skip: () => (POSIX ? '' : '[ab].md is a valid name, but kept POSIX as the original ran it'), build: (f) => {
    f.commit('[ab].md', RAN + '\n', '2026-01-20');
    f.commit('a.md', RAN + '\n', '2026-07-07');
    f.commit('a.md', 'plain\n', '2026-08-08');
    f.run([STORE, RAN], has('last ran 2026-01-20 ('));
  } },
  { name: 'author-date-for-a-run-committer-date-for-a-change', cli: true, build: (f) => {
    f.write('sprint-02.md', RAN + '\n');
    f.git(['add', '--', path.join(f.store, 'sprint-02.md')]);
    f.git(['commit', '-q', '-m', f.subject('ran')], { env: { GIT_AUTHOR_DATE: '2026-03-03T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-01-01T12:00:00+00:00' } });
    const commit = f.shortHead();
    f.run([STORE, RAN], is(STORE + ': last ran 2026-03-03 (' + commit + '), dated by files carrying ' + RAN + '\n'));
    f.run([STORE], is(STORE + ': last changed 2026-01-01 (' + commit + '), no ran-marker declared\n'));
  } },
  { name: 'rewriting-the-commit-does-not-move-the-date', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.git(['commit', '-q', '--amend', '--no-edit'], { env: { GIT_COMMITTER_DATE: '2026-09-09T12:00:00+00:00' } });
    f.run([STORE, RAN], has('last ran 2026-03-03 (' + f.shortHead() + ')'));
  } },
  { name: 'crlf-to-lf-normalisation-does-not-move-the-date', build: (f) => {
    f.commit('sprint-02.md', '# sprint-02\r\n' + RAN + '\r\nbody\r\n', '2026-03-03');
    f.commit('sprint-02.md', '# sprint-02\n' + RAN + '\nbody\n', '2026-06-06');
    f.run([STORE, RAN], has('last ran 2026-03-03 ('));
  } },
  { name: 'reorder-moving-the-marker-does-not-move-the-date', build: (f) => {
    f.commit('sprint-02.md', '# sprint-02\n' + RAN + '\n\nfirst\nsecond\n', '2026-03-03');
    f.commit('sprint-02.md', '# sprint-02\n\nfirst\nsecond\n' + RAN + '\n', '2026-06-06');
    f.run([STORE, RAN], has('last ran 2026-03-03 ('));
  } },
  { name: 'latest-date-wins-when-history-order-differs', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-05-05');
    f.commit('sprint-03.md', RAN + '\n', '2026-02-02');
    f.run([STORE, RAN], has('last ran 2026-05-05 ('));
  } },
  { name: 'each-file-of-a-commit-counted-on-its-own', build: (f) => {
    f.commit('sprint-02.md', RAN + '\nbody\n' + RAN + '\n', '2026-03-03');
    f.write('sprint-02.md', RAN + '\nbody\n');
    f.write('sprint-03.md', RAN + '\n');
    f.git(['add', '--', f.store]);
    f.git(['commit', '-q', '-m', f.subject('both')], { date: '2026-06-06' });
    f.run([STORE, RAN], has('last ran 2026-06-06 ('));
  } },
  { name: 'withdrawn-marker-restored-only-locally-not-dated', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.commit('sprint-02.md', 'withdrawn\n', '2026-04-04');
    f.run([STORE, RAN], never);
    f.write('sprint-02.md', RAN + '\n');
    f.run([STORE, RAN], never);
    f.git(['add', '--', path.join(f.store, 'sprint-02.md')]);
    f.run([STORE, RAN], never);
  } },
  { name: 'committed-marker-deleted-locally-still-dated', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.write('sprint-02.md', 'withdrawn\n');
    f.run([STORE, RAN], has('last ran 2026-03-03 ('));
    fs.unlinkSync(path.join(f.store, 'sprint-02.md'));
    f.run([STORE, RAN], has('last ran 2026-03-03 ('));
  } },
  { name: 'repository-with-no-commit-is-never', build: (f) => {
    f.write('sprint-02.md', RAN + '\n');
    f.git(['add', '--', path.join(f.store, 'sprint-02.md')]);
    f.run([STORE, RAN], never);
  } },
  { name: 'dangling-head-is-a-git-failure', cli: true, build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    const ref = f.git(['symbolic-ref', 'HEAD']).trim();
    const refFile = path.join(f.repo, '.git', ...ref.split('/'));
    assert.ok(fs.statSync(refFile).isFile(), 'the fixture needs a loose branch ref to overwrite');
    fs.writeFileSync(refFile, '1'.repeat(40) + '\n');
    f.run([STORE, RAN], headFailure());
    f.run([STORE], headFailure());
  } },
  ...malformedRefCases(),
  { name: 'unreadable-working-copy-does-not-hide-a-run',
    skip: () => {
      if (!POSIX) return 'file modes do not make a file unreadable here';
      return process.getuid && process.getuid() === 0 ? 'root reads any file' : '';
    },
    build: (f) => {
      f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
      const target = path.join(f.store, 'sprint-02.md');
      fs.chmodSync(target, 0);
      try {
        f.run([STORE, RAN], has('last ran 2026-03-03 ('));
      } finally {
        fs.chmodSync(target, 0o600);
      }
    } },
  { name: 'option-like-value-is-a-literal-path', cli: true, build: (f) => {
    const odd = path.join(f.repo, '--output=x');
    fs.mkdirSync(odd);
    fs.writeFileSync(path.join(odd, 'r.md'), RAN + '\n-' + RAN + '\n');
    f.git(['add', '--', path.join(odd, 'r.md')]);
    f.git(['commit', '-q', '-m', f.subject('odd')], { date: '2026-03-03' });
    f.run(['--', '--output=x', RAN], is('--output=x: last ran 2026-03-03 (' + f.shortHead() + '), dated by files carrying ' + RAN + '\n'));
    f.run(['--', '--output=x'], has('--output=x: last changed 2026-03-03 ('));
    f.run(['--', '--output=x', '-' + RAN], has('last ran 2026-03-03 ('));
    f.run(['--', '-p', RAN], is('-p: never landed a file carrying ' + RAN + '\n'));
    assert.ok(!fs.existsSync(path.join(f.repo, 'x')), 'no file x was written');
    for (const argv of [['--output=x', RAN], ['-p', RAN], ['--repo', f.repo, '-r', RAN]]) f.run(argv, usage(2));
    f.run(['--repo=-p', STORE, RAN], (r) => {
      assert.equal(r.code, 1, r.stderr);
      assert.equal(r.stdout, '');
      assert.ok(r.stderr.includes('rite-cadence: not a directory: '), r.stderr);
    });
  } },
  { name: 'root-not-a-repository-path-is-a-usage-error', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    for (const root of ['', '/docs/funnel-review', '../x', 'docs/../..']) f.run(['--', root, RAN], usage(2));
  } },
  { name: 'no-marker-dates-a-rebased-commit-as-struck', build: (f) => {
    f.commit('README.md', 'x\n', '2026-01-01');
    f.commit('a.md', 'a\n', '2026-09-01');
    f.write('b.md', 'b\n');
    f.git(['add', '--', path.join(f.store, 'b.md')]);
    f.git(['commit', '-q', '-m', f.subject('rebased')], { env: { GIT_AUTHOR_DATE: '2026-03-01T12:00:00+00:00', GIT_COMMITTER_DATE: '2026-09-09T12:00:00+00:00' } });
    asStruck(f, STORE, '2026-09-09');
  } },
  { name: 'no-marker-dates-a-deletion-as-struck', build: (f) => {
    f.commit('README.md', 'x\n', '2026-01-01');
    f.git(['rm', '-q', '--', path.join(f.store, 'README.md')]);
    f.git(['commit', '-q', '-m', f.subject('gone')], { date: '2026-05-05' });
    asStruck(f, STORE, '2026-05-05');
  } },
  { name: 'no-marker-dates-the-first-commit-whatever-log-showroot', build: (f) => {
    f.git(['config', 'log.showRoot', 'false']);
    f.commit('README.md', 'x\n', '2026-01-01');
    asStruck(f, STORE, '2026-01-01');
  } },
  { name: 'no-marker-dates-a-file-only-a-merge-added-as-struck', build: (f) => {
    fs.writeFileSync(path.join(f.repo, 'base.md'), 'x\n');
    f.git(['add', 'base.md']);
    f.git(['commit', '-q', '-m', f.subject('base')], { date: '2026-01-01' });
    f.git(['checkout', '-q', '-b', 'side']);
    fs.writeFileSync(path.join(f.repo, 'side.md'), 's\n');
    f.git(['add', 'side.md']);
    f.git(['commit', '-q', '-m', f.subject('side')], { date: '2026-02-02' });
    f.git(['checkout', '-q', '-']);
    fs.writeFileSync(path.join(f.repo, 'main.md'), 'm\n');
    f.git(['add', 'main.md']);
    f.git(['commit', '-q', '-m', f.subject('main')], { date: '2026-03-03' });
    f.git(['merge', '-q', '--no-commit', 'side']);
    f.write('merged.md', 'only the merge adds this\n');
    f.git(['add', '--', path.join(f.store, 'merged.md')]);
    f.git(['commit', '-q', '-m', f.subject('merge')], { date: '2026-04-04' });
    asStruck(f, STORE, '2026-04-04');
  } },
  { name: 'no-marker-reads-a-glob-character-in-the-root-literally', skip: () => (POSIX ? '' : 'a directory named f[q] is kept POSIX as the original ran it'), build: (f) => {
    for (const [dir, text, date] of /** @type {Array<[string, string, string]>} */ ([['f[q]', 'a\n', '2026-01-01'], ['fq', 'b\n', '2026-03-03']])) {
      const p = path.join(f.repo, 'docs', dir, 'a.md');
      fs.mkdirSync(path.dirname(p));
      fs.writeFileSync(p, text);
      f.git(['add', '--', p]);
      f.git(['commit', '-q', '-m', f.subject('add ' + dir)], { date });
    }
    f.run(['docs/f[q]'], has('docs/f[q]: last changed 2026-01-01 ('));
  } },
  { name: 'ran-report-merged-no-ff-dated-by-its-author-commit', build: (f) => {
    f.git(['commit', '-q', '--allow-empty', '-m', f.subject('base')], { date: '2026-01-01' });
    f.git(['checkout', '-q', '-b', 'slice']);
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    const authored = f.shortHead();
    f.git(['checkout', '-q', '-']);
    f.git(['commit', '-q', '--allow-empty', '-m', f.subject('trunk moves')], { date: '2026-04-04' });
    f.git(['merge', '-q', '--no-ff', '--no-edit', 'slice'], { date: '2026-05-05' });
    f.run([STORE, RAN], is(STORE + ': last ran 2026-03-03 (' + authored + '), dated by files carrying ' + RAN + '\n'));
  } },
  { name: 'root-is-a-literal-path-by-whole-components', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    for (const root of ['docs/*', 'docs/funnel']) {
      f.run([root, RAN], is(neverLine(root)));
      f.run([root], is(root + ': never changed\n'));
    }
    f.run(['docs/funnel-review/', RAN], has('last ran 2026-03-03 ('));
    f.run(['./docs//funnel-review', RAN], has('last ran 2026-03-03 ('));
  } },
  // The POSIX half of the original's test_a_root_is_a_literal_path_matched_by_whole_components, its own
  // case so that a Windows run (where '*' is no file name) holds the same number of runs as its golden.
  { name: 'root-named-star-is-that-directory', skip: () => (POSIX ? '' : "'*' is not a file name on Windows"), build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    const star = path.join(f.repo, 'docs', '*');
    fs.mkdirSync(star);
    fs.writeFileSync(path.join(star, 'r.md'), RAN + '\n');
    f.git(['add', '--', path.join(star, 'r.md')]);
    f.git(['commit', '-q', '-m', f.subject('star')], { date: '2026-06-06' });
    f.run(['docs/*', RAN], has('docs/*: last ran 2026-06-06 ('));
  } },
  { name: 'symlink-whose-target-is-the-marker-is-not-a-run', skip: () => (POSIX ? '' : 'symlinks need privileges here'), build: (f) => {
    fs.symlinkSync(RAN, path.join(f.store, 'link.md'));
    f.git(['add', '--', path.join(f.store, 'link.md')]);
    f.git(['commit', '-q', '-m', f.subject('link')], { date: '2026-03-03' });
    f.run([STORE, RAN], never);
  } },
  { name: 'submodule-under-the-root-is-skipped', build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.git(['update-index', '--add', '--cacheinfo', '160000,' + '1'.repeat(40) + ',docs/funnel-review/sub']);
    f.git(['commit', '-q', '-m', f.subject('submodule')], { date: '2026-04-04' });
    f.run([STORE, RAN], (r) => {
      assert.equal(r.code, 0, r.stderr);
      assert.ok(r.stdout.includes('last ran 2026-03-03 ('), r.stdout);
    });
  } },
  { name: 'blob-missing-from-the-store-is-a-git-failure', cli: true, build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    const oid = f.git(['rev-parse', 'HEAD:docs/funnel-review/sprint-02.md']).trim();
    fs.unlinkSync(path.join(f.repo, '.git', 'objects', oid.slice(0, 2), oid.slice(2)));
    f.run([STORE, RAN], headFailure('rite-cadence: git cat-file could not read blob ' + oid + '\n'));
  } },
  { name: 'report-marked-minus-diff-is-still-read', build: (f) => {
    fs.writeFileSync(path.join(f.repo, '.gitattributes'), '*.md -diff\n');
    f.git(['add', '.gitattributes']);
    f.git(['commit', '-q', '-m', f.subject('attributes')], { date: '2026-01-01' });
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.run([STORE, RAN], has('last ran 2026-03-03 ('));
  } },
  { name: 'empty-marker-is-a-usage-error', build: (f) => {
    f.run([STORE, ' '], usage(2));
  } },
  // Added: argument forms argparse reads the same way on every Python this suite meets.
  { name: 'argument-forms', cli: true, build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    f.run([], usage(2));
    f.run(['--repo'], usage(2));
    f.run([STORE, '--repo'], usage(2));
    f.run(['a', 'b', 'c'], usage(2));
    f.run([STORE, '-x'], usage(2));
    f.run([STORE, '-5'], is(neverLine(STORE, '-5')));
    f.run(['--re', f.repo, STORE], has(STORE + ': last changed 2026-03-03 ('), { cwd: f.base });
    f.run(['--repo=' + f.repo, STORE, RAN], has('last ran 2026-03-03 ('), { cwd: f.base });
    f.run(['--repo', '.', '--repo', f.repo, STORE, RAN], has('last ran 2026-03-03 ('), { cwd: f.base });
    f.run(['.', RAN], is('.: last ran 2026-03-03 (' + f.shortHead() + '), dated by files carrying ' + RAN + '\n'));
  } },
  // Added: git not on PATH is a git failure (exit 1), never "never".
  { name: 'git-not-on-path', cli: true, noGit: true, build: (f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    const empty = path.join(f.base, 'empty-bin');
    fs.mkdirSync(empty);
    f.run([STORE, RAN], (r) => {
      assert.equal(r.code, 1, r.stderr);
      assert.equal(r.stdout, '');
      assert.ok(r.stderr.startsWith('rite-cadence: git could not run: '), r.stderr);
    }, { env: { PATH: empty, Path: empty } });
  } },
];

/** The subTests of test_a_malformed_branch_ref_is_a_git_failure_and_an_orphan_branch_is_never. */
function malformedRefCases() {
  /** @param {Fixture} f */
  const refOf = (f) => f.git(['symbolic-ref', 'HEAD']).trim();
  /** @param {Fixture} f @param {string} ref */
  const refFile = (f, ref) => path.join(f.repo, '.git', ...ref.split('/'));
  /** @param {string} text @returns {(f: Fixture, ref: string) => void} */
  const loose = (text) => (f, ref) => fs.writeFileSync(refFile(f, ref), text);
  /** @param {string} extra @param {string | null} mainLine @returns {(f: Fixture, ref: string) => void} */
  const packed = (extra, mainLine) => (f, ref) => {
    f.git(['pack-refs', '--all']);
    const packedRefs = path.join(f.repo, '.git', 'packed-refs');
    assert.ok(!fs.existsSync(refFile(f, ref)), 'the ref must be packed only');
    let text = fs.readFileSync(packedRefs, 'utf8');
    if (mainLine !== null) text = '# pack-refs with: peeled fully-peeled sorted \n' + mainLine + ' ' + ref + '\n';
    fs.writeFileSync(packedRefs, text + extra);
  };
  /** @type {Array<[string, (f: Fixture, ref: string) => void, number]>} */
  const subs = [
    ['empty-loose-ref', loose(''), 1],
    ['loose-ref-zzz', loose('zzz\n'), 1],
    ['garbage-packed-refs-line', packed('garbage line\n', null), 1],
    ['packed-branch-ref-zzz', packed('', 'zzz'), 1],
    ['orphan-branch', (f) => { f.git(['checkout', '-q', '--orphan', 'other']); }, 0],
  ];
  return subs.map(([name, mutate, code]) => ({ name: 'malformed-ref-' + name, build: (/** @type {Fixture} */ f) => {
    f.commit('sprint-02.md', RAN + '\n', '2026-03-03');
    mutate(f, refOf(f));
    if (code) {
      f.run([STORE, RAN], headFailure());
      f.run([STORE], headFailure());
    } else {
      f.run([STORE, RAN], never);
      f.run([STORE], is(STORE + ': never changed\n'));
    }
  } }));
}

/** @type {Runner} */
const inProcess = { name: 'node', run: (args, cwd, env) => {
  let out = '';
  let err = '';
  const code = run(args, { cwd, env, out: (x) => { out += x; }, err: (x) => { err += x; } });
  return { code, stdout: out, stderr: err };
} };

/**
 * A runner spawning a program.
 * @param {string} name
 * @param {string} exe
 * @param {string[]} pre
 * @returns {Runner}
 */
const spawned = (name, exe, pre) => ({ name, run: (args, cwd, env) => {
  const p = spawnSync(exe, [...pre, ...args], { cwd, env, encoding: 'utf8' });
  return { code: p.status ?? 1, stdout: p.stdout, stderr: p.stderr };
} });

const binRunner = spawned('bin/mhw.js', process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'rite-cadence']);
const shRunner = spawned('./mhw', '/bin/sh', [path.join(ROOT, 'mhw'), 'rite-cadence']);

/**
 * The runners for a case: the in-process command always; the two entries (bin/mhw.js, ./mhw) on the
 * cases marked cli, which cover every output form and exit code (each spawn costs a node start, and the
 * whole set through three runners took over 80 s on a laptop). ./mhw needs node and dirname on PATH, so
 * a case with no git on PATH skips it.
 * @param {Case} c
 * @param {Runner[]} [extra] runners before the Node ones (the Python original, live)
 */
function runnersFor(c, extra = []) {
  if (!c.cli) return [...extra, inProcess];
  return [...extra, inProcess, binRunner, ...(POSIX && !c.noGit ? [shRunner] : [])];
}

/**
 * Each run of head compared with original, after the expected differences rewrite the original.
 * @param {string} name
 * @param {Run[]} original
 * @param {Run[]} head
 * @param {string} runner
 */
function differences(name, original, head, runner) {
  if (original.length !== head.length) return [name + ' (' + runner + '): run count ' + original.length + ' -> ' + head.length];
  /** @type {string[]} */
  const diffs = [];
  original.forEach((o, i) => {
    const h = head[i];
    const where = name + ' (' + runner + ') run ' + (i + 1) + ' ' + JSON.stringify(h.args);
    if (JSON.stringify(o.args) !== JSON.stringify(h.args)) diffs.push(where + ': args differ ' + JSON.stringify(o.args));
    if (o.code !== h.code) diffs.push(where + ': exit ' + o.code + ' -> ' + h.code);
    for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
      let a = o[stream];
      let b = h[stream];
      for (const e of expected.filter((x) => x.case.includes(name) && x.stream === stream)) {
        a = a.replace(new RegExp(e.base, 'gm'), e.replace ?? '<expected>');
        if (e.head) b = b.replace(new RegExp(e.head, 'gm'), e.replace ?? '<expected>');
      }
      if (a !== b) diffs.push(where + ': ' + stream + ' differs\n--- original\n' + a + '\n--- head\n' + b);
    }
  });
  return diffs;
}

/** @param {string} name */
const goldenName = (name) => 'transcripts/' + name + '.json';

/** Why case c cannot run here, or ''. @param {Case} c */
const skipReason = (c) => {
  if (!GIT) return 'needs git on PATH';
  return c.skip ? c.skip() : '';
};

test('every case has a golden transcript, every golden a case, and every expected difference names a case', () => {
  const names = new Set(CASES.map((c) => c.name));
  assert.equal(names.size, CASES.length, 'case names are unique');
  for (const c of CASES) assert.ok(fs.existsSync(path.join(ROOT, 'test', 'golden', SLICE, goldenName(c.name))), 'no golden for ' + c.name);
  for (const f of fs.readdirSync(path.join(ROOT, 'test', 'golden', SLICE, 'transcripts'))) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
  for (const e of expected) {
    for (const n of e.case) assert.ok(names.has(n), 'unknown case ' + n);
    assert.ok(e.why && e.why.length > 20, 'an expected difference states why');
    new RegExp(e.base);
    if (e.head) new RegExp(e.head);
  }
});

test('golden: the Node command, in process, through bin/mhw.js and ./mhw, matches the original\'s transcripts', { skip: UPDATE && 'MHW_UPDATE_GOLDEN=1' }, (t) => {
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    const runners = runnersFor(c);
    const f = new Fixture(runners);
    c.build(f);
    const golden = readGolden(SLICE, goldenName(c.name)).runs;
    runners.forEach((r, i) => diffs.push(...differences(c.name, golden, f.runs[i], r.name)));
  }
  assert.deepEqual(diffs, []);
});

/** The base revision's rite-cadence.py, or a reason it is not readable here. */
function pythonBase() {
  if (!POSIX) return 'POSIX only, as the S04 live arm';
  if (!PY || !GIT) return 'needs python3 and git on PATH';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(GIT, ['-C', ROOT, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = path.join(freshBase(), 'tree');
  if (!extractRevision(ROOT, base, dest)) return 'base revision ' + base + ' is not readable here';
  const script = path.join(dest, 'method', 'scripts', 'rite-cadence.py');
  if (!fs.existsSync(script)) return 'the base revision no longer holds rite-cadence.py (this slice has merged)';
  return script;
}

test('live: the Python original and the Node command side by side on the same repositories', (t) => {
  const script = pythonBase();
  if (!path.isAbsolute(script)) {
    t.skip(script);
    return;
  }
  const python = spawned('python', /** @type {string} */ (PY), ['-B', script]);
  /** @type {string[]} */
  const diffs = [];
  for (const c of CASES) {
    const why = skipReason(c);
    if (why) {
      t.diagnostic(c.name + ' skipped: ' + why);
      continue;
    }
    const runners = runnersFor(c, [python]);
    const f = new Fixture(runners);
    c.build(f);
    if (UPDATE) writeGolden(SLICE, goldenName(c.name), { name: c.name, runs: f.runs[0] });
    runners.slice(1).forEach((r, i) => diffs.push(...differences(c.name, f.runs[0], f.runs[i + 1], r.name)));
  }
  assert.deepEqual(diffs, []);
});

test('-h prints the usage and exits 0; an option before -h still parses', () => {
  for (const argv of [['-h'], ['--help'], ['--he'], ['--repo', '.', '-h']]) {
    const r = inProcess.run(argv, ROOT, {});
    assert.equal(r.code, 0, JSON.stringify(argv));
    assert.match(r.stdout, /^usage: mhw rite-cadence \[-h\] \[--repo REPO\] root \[marker\]\n/);
  }
});

test('./mhw without node on PATH says so and never falls through to workstation.py', { skip: !POSIX && './mhw is the POSIX entry' }, (t) => {
  if (fs.existsSync('/usr/bin/node') || fs.existsSync('/bin/node')) {
    t.skip('a node in /usr/bin or /bin is on the reduced PATH');
    return;
  }
  const p = spawnSync('/bin/sh', [path.join(ROOT, 'mhw'), 'rite-cadence', STORE], { cwd: ROOT, env: { PATH: '/usr/bin:/bin' }, encoding: 'utf8' });
  assert.equal(p.status, 2);
  assert.equal(p.stderr, 'mhw: node (26 or later) is required for mhw rite-cadence\n');
});

test('the Python original and its suite are gone', () => {
  for (const f of ['rite-cadence.py', 'rite-cadence.test.py']) assert.ok(!fs.existsSync(path.join(ROOT, 'method', 'scripts', f)), f + ' still exists');
});

test('session check 3 and /funnel-review name mhw rite-cadence and the marker, never the deleted script', () => {
  const text = fs.readFileSync(path.join(ROOT, 'method', 'skills', 'agents-configuration', 'SKILL.md'), 'utf8');
  const start = text.indexOf('3. **The rite cadence.**');
  assert.ok(start >= 0);
  const check = text.slice(start, text.indexOf('4. **Finished worktrees.**', start));
  assert.ok(check.includes('`mhw rite-cadence --repo <repo> <root> <marker>`'), check);
  assert.ok(check.includes(RAN));
  assert.ok(check.includes('never landed a file carrying'));
  const funnel = fs.readFileSync(path.join(ROOT, 'method', 'skills', 'funnel-review', 'SKILL.md'), 'utf8');
  assert.ok(funnel.includes('`mhw rite-cadence --repo <repo> docs/funnel-review FUNNEL-REVIEW-RAN`'));
  for (const [name, body] of [['agents-configuration', check], ['funnel-review', funnel]]) {
    assert.ok(!/python3 \{\{method-scripts\}\}\/rite-cadence\.py/.test(body), name + ' still runs the deleted script');
  }
});
