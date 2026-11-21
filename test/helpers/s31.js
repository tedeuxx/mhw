// The S31 harness (#501, convention 3 of #470): one case of the prod canary run in a fresh fixture
// repository. The fixture is a git repository built from test/helpers/s31-fixture/ with fixed identities
// and dates, so its commits have the same SHA on every machine; its package is a fake mhw (s31-fixture/
// bin/mhw.js) that installs into the canary's throwaway HOME and admin root in seconds, offline. The canary
// script under test is copied into the fixture's .github/scripts/ (untracked, so git archive never sees
// it): pack reads the checkout the script sits in, as in mhw. What is recorded: each step's exit code,
// stdout and stderr, and the files of each tarball a case names (path, mode, sha256). The case directory
// becomes <D> and each fixture commit <sha:TAG>. POSIX only: the canary runs hooks through /bin/sh.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { which } from './home.js';
import { readTar } from '../../.github/scripts/prod-canary.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, '..', '..');
export const FIXTURE = path.join(HERE, 's31-fixture');
export const SCRIPT = path.join(ROOT, '.github', 'scripts', 'prod-canary.js');
/** The files of src/lib the Node canary imports (copied beside it into the fixture). */
export const LIBS = ['py.js', 'py-text.js', 'onpath.js'];
export const TAGS = ['fx-old', 'fx-good', 'fx-broken', 'fx-install-fails'];

/**
 * @typedef {import('./s31-cases.js').Case} Case
 * @typedef {{ code: number | null, stdout: string, stderr: string }} Result
 * @typedef {{ path: string, mode: string, sha256: string }} TarEntry
 * @typedef {{ steps: Result[], tarballs: Record<string, TarEntry[]> }} Transcript
 * @typedef {{ install: (repo: string) => void, argv: (repo: string) => string[] }} Runner
 * @typedef {{ case: string[], stream: Array<'stdout' | 'stderr'>, base?: string, head?: string, replace: string, why: string }} ExpectedDifference
 */

/** @param {string} dir @param {string} dest */
function copyDir(dir, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const s = path.join(dir, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

/** git with no user or system configuration and a fixed identity and date. @param {string} repo @param {string[]} args */
export function git(repo, args) {
  const g = which('git');
  if (!g) throw new Error('git is not on PATH');
  const when = '2026-01-01T00:00:00Z';
  const p = spawnSync(g, ['-C', repo, ...args], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH || '', HOME: repo, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_AUTHOR_DATE: when,
      GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_DATE: when,
    },
  });
  if (p.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + p.stderr);
  return p.stdout.trim();
}

/**
 * The fixture repository, its four tagged commits, and the script under test beside it.
 * @param {string} repo
 * @param {Runner} runner
 * @returns {Record<string, string>} tag -> commit
 */
export function buildFixture(repo, runner) {
  copyDir(FIXTURE, repo);
  fs.writeFileSync(path.join(repo, '.gitattributes'), '.workstation-archive export-subst\n');
  fs.writeFileSync(path.join(repo, '.workstation-archive'), 'commit: $Format:%H$\n');
  git(repo, ['init', '-q', '-b', 'main']);
  const commit = (/** @type {string} */ msg, /** @type {string[]} */ tags) => {
    git(repo, ['add', '-A']);
    git(repo, ['commit', '-q', '-m', msg]);
    for (const t of tags) git(repo, ['tag', t]);
  };
  commit('fixture: the old floor', ['fx-old', 'rel/x']);
  fs.appendFileSync(path.join(repo, 'global', 'deny-floor.conf'), 'cmd git reset --hard\n');
  commit('fixture: one more floor line', ['fx-good']);
  fs.writeFileSync(path.join(repo, 'variant.json'), '{"broken": true}\n');
  commit('fixture: a broken package', ['fx-broken']);
  fs.writeFileSync(path.join(repo, 'variant.json'), '{"installExit": 1}\n');
  commit('fixture: an install that fails', ['fx-install-fails']);
  /** @type {Record<string, string>} */
  const shas = {};
  for (const t of TAGS) shas[t] = git(repo, ['rev-parse', t + '^{commit}']);
  runner.install(repo);
  return shas;
}

/** The Node canary, copied with the src/lib files it imports. @type {Runner} */
export const nodeRunner = {
  install(repo) {
    fs.mkdirSync(path.join(repo, '.github', 'scripts'), { recursive: true });
    fs.copyFileSync(SCRIPT, path.join(repo, '.github', 'scripts', 'prod-canary.js'));
    fs.mkdirSync(path.join(repo, 'src', 'lib'), { recursive: true });
    for (const f of LIBS) fs.copyFileSync(path.join(ROOT, 'src', 'lib', f), path.join(repo, 'src', 'lib', f));
    // The checkout's package.json makes the copied files ES modules, as in mhw. Untracked like the rest.
    fs.writeFileSync(path.join(repo, '.github', 'package.json'), '{"type": "module"}\n');
    fs.writeFileSync(path.join(repo, 'src', 'package.json'), '{"type": "module"}\n');
  },
  argv: (repo) => [process.execPath, path.join(repo, '.github', 'scripts', 'prod-canary.js')],
};

/**
 * The Python original, from a file's text.
 * @param {string} py
 * @param {string} text
 * @returns {Runner}
 */
export function pythonRunner(py, text) {
  return {
    install(repo) {
      fs.mkdirSync(path.join(repo, '.github', 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(repo, '.github', 'scripts', 'prod_canary.py'), text);
    },
    argv: (repo) => [py, '-B', path.join(repo, '.github', 'scripts', 'prod_canary.py')],
  };
}

/** A PATH holding node, npm, git and jq, and the system directories. */
export function toolPath() {
  const dirs = [path.dirname(process.execPath)];
  for (const n of ['npm', 'git', 'jq']) {
    const p = which(n);
    if (p && !dirs.includes(path.dirname(p))) dirs.push(path.dirname(p));
  }
  return [...dirs, '/usr/bin', '/bin'].join(':');
}

/**
 * @param {string} text
 * @param {Array<[string, string]>} subs
 */
export function normalise(text, subs) {
  let out = text;
  for (const [lit, ph] of [...subs].sort((a, b) => b[0].length - a[0].length)) out = out.split(lit).join(ph);
  // npm names its debug log by the time it started, and prints its path with any part it takes for a
  // secret masked, so the line is replaced whole.
  return out.replace(/^npm error A complete log of this run can be found in: .*$/gm, 'npm error A complete log of this run can be found in: <NPMLOG>');
}

/**
 * The files of a gzipped tarball, normalised like the streams when they are UTF-8 text.
 * @param {string} file
 * @param {Array<[string, string]>} subs
 * @returns {TarEntry[]}
 */
export function tarballListing(file, subs) {
  if (!fs.existsSync(file)) return [];
  return readTar(zlib.gunzipSync(fs.readFileSync(file)))
    .map((e) => {
      const text = e.data.toString('utf8');
      const body = Buffer.from(text, 'utf8').equals(e.data) ? Buffer.from(normalise(text, subs), 'utf8') : e.data;
      return { path: e.name, mode: e.mode.toString(8) + ':' + e.type, sha256: crypto.createHash('sha256').update(body).digest('hex') };
    })
    .sort((a, b) => Number(a.path > b.path) - Number(a.path < b.path));
}

/**
 * Run one case with one implementation in a fresh directory, and return its normalised transcript.
 * @param {Case} c
 * @param {Runner} runner
 * @returns {Transcript}
 */
export function transcript(c, runner) {
  const D = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 's31-case-')));
  try {
    const repo = path.join(D, 'repo');
    const shas = buildFixture(repo, runner);
    for (const d of ['home', 'tmp']) fs.mkdirSync(path.join(D, d));
    /** @type {Array<[string, string]>} */
    const subs = [[D, '<D>'], ...Object.entries(shas).flatMap(([t, s]) => /** @type {Array<[string, string]>} */ ([[s, '<sha:' + t + '>'], [s.slice(0, 12), '<sha12:' + t + '>']]))];
    /** @param {string} s */
    const fill = (s) => s.replaceAll('{D}', D).replace(/\{sha:([a-z-]+)\}/g, (_, t) => shas[t]);
    const env = { PATH: toolPath(), HOME: path.join(D, 'home'), TMPDIR: path.join(D, 'tmp'), LANG: 'C.UTF-8' };
    /** @type {Result[]} */
    const steps = [];
    for (const s of c.steps) {
      if ('write' in s) {
        const p = path.join(D, s.write);
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, s.text);
      } else if ('mkdir' in s) fs.mkdirSync(path.join(D, s.mkdir), { recursive: true });
      else if ('symlink' in s) fs.symlinkSync(fill(s.target), path.join(D, s.symlink));
      else {
        const [exe, ...pre] = runner.argv(repo);
        const p = spawnSync(exe, [...pre, ...s.canary.map(fill)], { cwd: D, env, encoding: 'utf8', timeout: 600_000 });
        steps.push({ code: p.status, stdout: normalise(p.stdout, subs), stderr: normalise(p.stderr, subs) });
      }
    }
    /** @type {Record<string, TarEntry[]>} */
    const tarballs = {};
    for (const t of c.tarballs || []) tarballs[t] = tarballListing(path.join(D, t), subs);
    return { steps, tarballs };
  } finally {
    fs.rmSync(D, { recursive: true, force: true });
  }
}

/**
 * The differences between a recorded and a fresh transcript, after the declared differences.
 * @param {string} name
 * @param {Transcript} base the original's
 * @param {Transcript} head the Node script's
 * @param {ExpectedDifference[]} expected
 * @returns {string[]}
 */
export function differences(name, base, head, expected) {
  const mine = expected.filter((e) => e.case.includes(name) || e.case.includes('*'));
  /** @param {Transcript} t @param {'base' | 'head'} side */
  const apply = (t, side) => ({
    tarballs: t.tarballs,
    steps: t.steps.map((r) => {
      const out = { ...r };
      for (const e of mine) {
        const pat = e[side];
        if (!pat) continue;
        for (const stream of e.stream) out[stream] = out[stream].replace(new RegExp(pat, 'gm'), e.replace);
      }
      return out;
    }),
  });
  const a = apply(base, 'base');
  const b = apply(head, 'head');
  const diffs = [];
  if (a.steps.length !== b.steps.length) diffs.push(name + ': ' + a.steps.length + ' steps recorded, ' + b.steps.length + ' run');
  a.steps.forEach((r, i) => {
    const h = b.steps[i];
    if (!h) return;
    for (const k of /** @type {const} */ (['code', 'stdout', 'stderr'])) {
      if (r[k] !== h[k]) diffs.push(name + ' step ' + i + ' ' + k + ':\n--- original\n' + r[k] + '\n--- node\n' + h[k]);
    }
  });
  if (JSON.stringify(a.tarballs) !== JSON.stringify(b.tarballs)) diffs.push(name + ': the tarballs differ');
  return diffs;
}
