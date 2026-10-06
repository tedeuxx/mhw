#!/usr/bin/env node
// The provenance stamp of an npm package of this repository (Issue #68, ADR-0034), written at package
// time by the "prepare" script into .workstation-stamp, because the installed package has no .git.
// global/install.sh and global/install.ps1 read that file only when they run outside a git checkout.
//
// The rule is install.sh's (Issue #66, ADR-0029), adapted to what npm hands over:
//   in a git checkout (npm pack, or a git+file / git+https clone):
//     release: vX.Y.Z                     HEAD is exactly that numeric tag and nothing tracked is modified
//     release: unreleased, after vX.Y.Z   the nearest numeric tag otherwise
//     release: unreleased, no tag reachable
//     commit:  the full HEAD SHA, "-dirty" when a tracked file differs
//   in a hosted tarball (npm install -g github:owner/repo#ref: npm downloads an archive with no .git):
//     commit:  the full SHA npm resolved the ref to, read from the resolved URL npm passes to this
//              script's environment (an npm-internal variable, measured on npm 11.13.0, not documented)
//     release: vX.Y.Z when the repository's tag v<.bumpversion.toml version> points at that commit
//              (one read-only git ls-remote); otherwise "unreleased, after vX.Y.Z", because the version
//              in .bumpversion.toml changes only in a bump commit, and that commit is the one tagged
//   and when neither is available: "unknown, npm package (.bumpversion.toml says X.Y.Z)", commit unknown.
// Standard library only. Never fails the install: on any error it writes the unknown stamp.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, '.workstation-stamp');
const NUMERIC_TAG = /^v[0-9]+\.[0-9]+\.[0-9]+$/;
const SHA = /^[0-9a-f]{40}$/;
const GITHUB = /^(?:git\+)?(?:ssh:\/\/git@|https:\/\/|git:\/\/)github\.com[/:]([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?#([0-9a-f]{40})$/;

function git(args, cwd) {
  const p = spawnSync('git', args, {
    cwd, encoding: 'utf8', timeout: 20000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return p.status === 0 ? (p.stdout || '').trim() : null;
}

function bumpVersion(root) {
  const text = fs.readFileSync(path.join(root, '.bumpversion.toml'), 'utf8');
  const m = text.match(/^current_version\s*=\s*"([0-9]+\.[0-9]+\.[0-9]+)"/m);
  if (!m) throw new Error('cannot read current_version from .bumpversion.toml');
  return m[1];
}

function fromCheckout(root) {
  if (git(['rev-parse', '--is-inside-work-tree'], root) !== 'true') return null;
  // Only a checkout whose top level is this package counts: a tarball unpacked inside some other
  // repository must not borrow that repository's HEAD.
  const top = git(['rev-parse', '--show-toplevel'], root);
  if (!top || fs.realpathSync(top) !== fs.realpathSync(root)) return null;
  const commit = git(['rev-parse', '--verify', 'HEAD'], root);
  if (!commit || !SHA.test(commit)) return null;
  const dirty = git(['status', '--porcelain', '--untracked-files=no'], root) ? '-dirty' : '';
  const glob = 'v[0-9]*.[0-9]*.[0-9]*';
  const exact = dirty ? null : git(['describe', '--tags', '--exact-match', '--match', glob, 'HEAD'], root);
  const near = git(['describe', '--tags', '--abbrev=0', '--match', glob, 'HEAD'], root);
  let release;
  if (exact && NUMERIC_TAG.test(exact)) release = exact;
  else if (near && NUMERIC_TAG.test(near)) release = 'unreleased, after ' + near;
  else release = 'unreleased, no tag reachable';
  return 'release: ' + release + '; commit: ' + commit + dirty;
}

// The resolved URL npm passes while it prepares a git dependency: one entry per line, ours last.
function resolvedFromNpm(env) {
  const lines = String(env._PACOTE_NO_PREPARE_ || '').split('\n').filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = GITHUB.exec(lines[i].trim());
    if (m) return { owner: m[1], repo: m[2], sha: m[3] };
  }
  return null;
}

// The commit a tag points at, peeled, from `git ls-remote` output; null when absent.
function tagCommit(lsRemote, tag) {
  let plain = null;
  for (const line of String(lsRemote || '').split('\n')) {
    const [sha, ref] = line.trim().split(/\s+/);
    if (ref === 'refs/tags/' + tag + '^{}') return sha;
    if (ref === 'refs/tags/' + tag) plain = sha;
  }
  return plain;
}

function fromTarball(root, env) {
  const r = resolvedFromNpm(env);
  if (!r) return null;
  const version = bumpVersion(root);
  const tag = 'v' + version;
  const url = 'https://github.com/' + r.owner + '/' + r.repo + '.git';
  const out = git(['ls-remote', '--tags', url, 'refs/tags/' + tag + '*'], root);
  let release;
  if (out === null) release = 'unverified, ' + tag + ' or later (tags unreadable at package time)';
  else if (tagCommit(out, tag) === r.sha) release = tag;
  else release = 'unreleased, after ' + tag;
  return 'release: ' + release + '; commit: ' + r.sha;
}

function stamp(root, env) {
  try {
    const s = fromCheckout(root) || fromTarball(root, env);
    if (s) return s;
  } catch (e) { /* fall through to unknown */ }
  let version = 'unreadable';
  try { version = bumpVersion(root); } catch (e) { /* keep unreadable */ }
  return 'release: unknown, npm package (.bumpversion.toml says ' + version + '); commit: unknown';
}

const SHAPE = /^release: [A-Za-z0-9 .,()_-]+; commit: [0-9a-f]{40}(-dirty)?$/;

// npm runs prepare twice for a hosted git dependency (measured, npm 11.13.0): first inside the
// `npm install` it runs in the unpacked archive, where the resolved URL is in the environment, then
// again while packing, where it is not. The second run must not overwrite a known commit with unknown.
// Outside a checkout, a stamp file can only have been written by an earlier prepare in this same
// directory (the file is never committed), so keeping it borrows nothing.
function decide(computed, existing) {
  if (/; commit: unknown$/.test(computed) && SHAPE.test(String(existing || '').split('\n')[0])) {
    return String(existing).split('\n')[0];
  }
  return computed;
}

module.exports = { stamp, resolvedFromNpm, tagCommit, fromCheckout, decide };

if (require.main === module) {
  let existing = null;
  try { existing = fs.readFileSync(OUT, 'utf8'); } catch (e) { /* none yet */ }
  const s = decide(stamp(ROOT, process.env), existing);
  fs.writeFileSync(OUT, s + '\n');
  console.log('workstation stamp: ' + s);
}
