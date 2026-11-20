// mhw docs-baseline check and mhw onboard (#523). Each case builds a throwaway git repository under a
// throwaway HOME (test/helpers/home.js) and runs the command in this process, except the cases marked
// cli, which go through bin/mhw.js. Nothing here reads or writes the real HOME.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  globMatches, badPath, manifestErrors, parseBody, decide, defaultManifest, scaffoldFiles, runCheck, runOnboard,
  validate, MANIFEST,
} from '../../src/commands/docs-baseline.js';
import { throwawayHome, which } from '../helpers/home.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const GIT = which('git');
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/**
 * @typedef {{ dir: string, env: Record<string, string>, git: (...a: string[]) => string,
 *   write: (rel: string, text: string) => void, commit: (msg: string) => void }} Repo
 */

/** @returns {Repo} */
function repo() {
  const h = throwawayHome('docs-baseline', {
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@example.invalid', GIT_COMMITTER_NAME: 't',
    GIT_COMMITTER_EMAIL: 't@example.invalid', GIT_CONFIG_NOSYSTEM: '1',
  });
  cleanups.push(h.cleanup);
  const dir = path.join(h.dir, 'repo');
  fs.mkdirSync(dir);
  const git = (/** @type {string[]} */ ...a) => {
    const p = spawnSync(/** @type {string} */ (GIT), a, { cwd: dir, env: h.env, encoding: 'utf8' });
    assert.equal(p.status, 0, a.join(' ') + ': ' + p.stderr);
    return p.stdout;
  };
  git('init', '-q', '-b', 'main');
  const write = (/** @type {string} */ rel, /** @type {string} */ text) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  };
  const commit = (/** @type {string} */ msg) => {
    git('add', '-A');
    git('commit', '-q', '--allow-empty', '-m', msg);
  };
  return { dir, env: h.env, git, write, commit };
}

const MANIFEST_DOC = {
  schema_version: 1,
  baseline: { readme: 'README.md', prd: 'docs/demo-product-requirements-document-project.md', adr_library: 'docs/adr',
    architecture: 'docs/architecture.md', sequences: { not_applicable: 'A command-line tool with one flow.' } },
  capabilities: [
    { id: 'api', code: ['src/api/**'], docs: ['docs/api.md'] },
    { id: 'core', code: ['src/**', 'package.json'], docs: ['README.md', 'docs/demo-product-requirements-document-project.md'] },
  ],
};

/** A repository on main with the manifest and docs, and a branch `change` checked out. */
function baseRepo() {
  const r = repo();
  r.write(MANIFEST, JSON.stringify(MANIFEST_DOC, null, 2));
  r.write('README.md', '# demo\n\nIt does one thing.\n');
  r.write('docs/demo-product-requirements-document-project.md', '# demo PRD\n');
  r.write('docs/api.md', '# API\n\nOne endpoint.\n');
  r.write('src/api/a.js', 'export const a = 1;\n');
  r.write('src/core.js', 'export const c = 1;\n');
  r.write('package.json', '{}\n');
  r.commit('base');
  r.git('checkout', '-q', '-b', 'change');
  return r;
}

/**
 * @param {Repo} r
 * @param {string | null} body
 * @param {string[]} [extra]
 */
function check(r, body, extra = []) {
  const out = /** @type {string[]} */ ([]);
  const err = /** @type {string[]} */ ([]);
  const args = ['check', '--base=main', ...extra];
  if (body !== null) {
    const f = path.join(path.dirname(r.dir), 'body.md');
    fs.writeFileSync(f, body);
    args.push('--body-file=' + f);
  }
  const code = runCheck(args, { cwd: r.dir, env: r.env, out: (s) => out.push(s), err: (s) => err.push(s) });
  return { code, out: out.join(''), err: err.join('') };
}

// -- units -------------------------------------------------------------------------------------------

test('globs: ** spans whole segments, * and ? stay inside one', () => {
  for (const [g, f, want] of /** @type {Array<[string, string, boolean]>} */ ([
    ['**', 'a/b/c.md', true], ['src/**', 'src', true], ['src/**', 'src/a/b.js', true], ['src/**', 'srcx/a', false],
    ['src/*.js', 'src/a.js', true], ['src/*.js', 'src/a/b.js', false], ['docs/adr/0042-*.md', 'docs/adr/0042-x.md', true],
    ['docs/adr/0042-*.md', 'docs/adr/0043-x.md', false], ['test/render/mcp*', 'test/render/mcp-golden.test.js', true],
    ['a/**/z', 'a/z', true], ['a/**/z', 'a/b/c/z', true], ['a/**/z', 'a/b/c/y', false], ['?.md', 'a.md', true],
    ['?.md', 'ab.md', false], ['*', '.hidden', true], ['a*b*c', 'axxbyyc', true], ['a*b*c', 'axxbyy', false],
  ])) assert.equal(globMatches(g, f), want, g + ' ~ ' + f);
});

test('globs: a pathological glob stays fast (no regular expression is compiled from the manifest)', () => {
  const t = Date.now();
  assert.equal(globMatches('**/' + 'a*'.repeat(30) + 'b', 'x/' + 'a'.repeat(5000)), false);
  assert.ok(Date.now() - t < 2000);
});

test('paths and globs refuse escapes and syntax this matcher does not implement', () => {
  for (const p of ['/etc/x', '../x', 'a/../b', 'a//b', './a', 'a/{b,c}', 'a/[ab]', '!a', 'a\\b', 'a/x**', '']) {
    assert.notEqual(badPath(p, true), null, p);
  }
  assert.equal(badPath('docs/**/*.md', true), null);
  assert.notEqual(badPath('docs/*.md', false), null, 'a plain path takes no wildcard');
});

test('the manifest: the default is valid, and each defect is named', () => {
  assert.deepEqual(manifestErrors(defaultManifest('demo')), []);
  assert.deepEqual(manifestErrors(MANIFEST_DOC), []);
  const bad = (/** @type {(d: any) => void} */ edit) => {
    const d = structuredClone(MANIFEST_DOC);
    edit(d);
    return manifestErrors(d);
  };
  for (const [edit, needle] of /** @type {Array<[(d: any) => void, string]>} */ ([
    [(d) => { d.schema_version = 2; }, 'schema_version'],
    [(d) => { d.extra = 1; }, 'unknown key extra'],
    [(d) => { delete d.baseline.readme; }, 'baseline.readme is missing'],
    [(d) => { d.baseline.readme = { not_applicable: 'no' }; }, 'baseline.readme'],
    [(d) => { d.baseline.sequences = { not_applicable: ' ' }; }, 'not applicable needs'],
    [(d) => { d.baseline.prd = 'docs/prd.md'; }, 'product-requirements-document'],
    [(d) => { d.capabilities = []; }, 'non-empty array'],
    [(d) => { d.capabilities[1].id = 'api'; }, 'repeated'],
    [(d) => { d.capabilities[0].code = []; }, 'code must be'],
    [(d) => { d.capabilities[0].docs = ['../x.md']; }, 'docs[0]'],
    [(d) => { d.capabilities[0].skip = true; }, 'unknown key skip'],
  ])) assert.ok(bad(edit).some((e) => e.includes(needle)), needle + ' in ' + JSON.stringify(bad(edit)));
});

test('the body: only a column-0 line outside a fence declares an escape', () => {
  assert.equal(parseBody('x\ndocs-baseline: none — docs move in the next slice\n').waiver,
    'docs-baseline: none — docs move in the next slice');
  assert.equal(parseBody('docs-baseline: none - a hyphen is accepted\r\n').waiver, 'docs-baseline: none — a hyphen is accepted');
  assert.equal(parseBody('docs-baseline: in #42').waiver, 'docs-baseline: in #42');
  for (const body of [' docs-baseline: in #42', '> docs-baseline: in #42', '```\ndocs-baseline: in #42\n```',
    '`docs-baseline: in #42`', 'docs-baseline: none — ', 'docs-baseline: none — -', 'docs-baseline: in #0',
    'docs-baseline: in #12a', 'docs-baseline: none']) {
    assert.equal(parseBody(body).waiver, null, JSON.stringify(body));
  }
  assert.deepEqual(parseBody('docs-baseline: maybe\n').malformed, ['docs-baseline: maybe']);
});

test('decide: first match owns a path; a doc changed by whitespace only does not count', () => {
  const m = /** @type {any} */ (MANIFEST_DOC);
  const r1 = decide(m, ['src/api/a.js', 'README.md'], new Set(['src/api/a.js', 'README.md']), null);
  assert.equal(r1.code, 1, 'src/api/a.js belongs to api (first match), and README.md is core\'s doc');
  assert.match(r1.lines.join('\n'), /FAIL {2}api: touched by src\/api\/a\.js/);
  const r2 = decide(m, ['src/api/a.js', 'docs/api.md'], new Set(['src/api/a.js']), null);
  assert.equal(r2.code, 1, 'docs/api.md is not in the substantive set');
  const r3 = decide(m, ['docs/api.md'], new Set(['docs/api.md']), null);
  assert.deepEqual([r3.code, r3.lines[0]], [0, 'OK    no capability is touched']);
});

// -- the check, end to end on a git repository --------------------------------------------------------

test('check: a code change with a doc change passes', { skip: !GIT }, () => {
  const r = baseRepo();
  r.write('src/core.js', 'export const c = 2;\n');
  r.write('README.md', '# demo\n\nIt does two things.\n');
  r.commit('change');
  const res = check(r, '');
  assert.equal(res.code, 0, res.out + res.err);
  assert.match(res.out, /OK {4}core: README\.md changed/);
});

test('check: the whitespace rule, mutation-calibrated on the doc', { skip: !GIT }, () => {
  const r = baseRepo();
  r.write('src/core.js', 'export const c = 2;\n');
  r.write('README.md', '#   demo\n\n\nIt   does one thing.  \n\n');
  r.commit('whitespace only');
  const ws = check(r, '');
  assert.equal(ws.code, 1, ws.out);
  assert.match(ws.out, /FAIL {2}core: touched by src\/core\.js, and none of its documents/);
  // The same change plus one real word goes green: the red above is the whitespace rule, nothing else.
  r.write('README.md', '#   demo\n\n\nIt   does one thing, faster.  \n\n');
  r.commit('a real word');
  assert.equal(check(r, '').code, 0);
});

test('check: no doc change fails, and each escape waives it', { skip: !GIT }, () => {
  const r = baseRepo();
  r.write('src/core.js', 'export const c = 3;\n');
  r.commit('code only');
  const none = check(r, null);
  assert.equal(none.code, 1);
  assert.match(none.out, /no pull-request body was read/);
  assert.equal(check(r, 'Summary.\n\ndocs-baseline: none — a refactor with no behaviour change\n').code, 0);
  assert.equal(check(r, 'docs-baseline: in #77\n').code, 0);
  for (const body of ['  docs-baseline: in #77\n', '```\ndocs-baseline: in #77\n```\n', 'docs-baseline: none —  \n']) {
    assert.equal(check(r, body).code, 1, JSON.stringify(body));
  }
  const waived = check(r, 'docs-baseline: in #77\n');
  assert.match(waived.out, /WAIVED core: no document of it changed; the body declares docs-baseline: in #77/);
});

test('check: a path outside every glob fails, and no escape waives it', { skip: !GIT }, () => {
  const r = baseRepo();
  r.write('tools/x.sh', 'echo\n');
  r.commit('stray');
  const res = check(r, 'docs-baseline: none — not a doc change\n');
  assert.equal(res.code, 1);
  assert.match(res.out, /FAIL {2}tools\/x\.sh: outside every capability of the manifest/);
});

test('check: a deleted code file touches its capability too', { skip: !GIT }, () => {
  const r = baseRepo();
  r.git('rm', '-q', 'src/api/a.js');
  r.commit('delete');
  assert.equal(check(r, '').code, 1);
});

test('check: usage, an invalid manifest and a git failure are exit 2, never a pass', { skip: !GIT }, () => {
  const r = baseRepo();
  r.commit('nothing');
  const io = { cwd: r.dir, env: r.env, out: () => {}, err: () => {} };
  assert.equal(runCheck(['check'], io), 2, '--base is required');
  assert.equal(runCheck(['check', '--base=-x'], io), 2, 'an option is not a ref');
  assert.equal(runCheck(['check', '--base=main..x'], io), 2);
  assert.equal(runCheck(['check', '--base=no-such-branch'], io), 2, 'git fails');
  assert.equal(runCheck(['check', '--base=main', '--bogus'], io), 2);
  assert.equal(runCheck(['nope'], io), 2);
  fs.writeFileSync(path.join(r.dir, MANIFEST), '{"schema_version": 1}');
  assert.equal(runCheck(['check', '--base=main'], io), 2, 'an invalid manifest');
});

test('check: cli, through bin/mhw.js', { skip: !GIT }, () => {
  const r = baseRepo();
  r.write('src/core.js', 'export const c = 4;\n');
  r.commit('code only');
  const run = (/** @type {string[]} */ args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), ...args],
    { cwd: r.dir, env: r.env, encoding: 'utf8' });
  assert.equal(run(['docs-baseline', 'check', '--base=main']).status, 1);
  assert.equal(run(['docs-baseline']).status, 2);
  assert.equal(run(['onboard', '--nope']).status, 2);
});

// -- onboard ---------------------------------------------------------------------------------------

/** @param {string} dir */
function snapshot(dir) {
  /** @type {Record<string, string>} */
  const out = {};
  const walk = (/** @type {string} */ d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.name === '.git') continue;
      if (e.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

/** @param {string} dir */
function onboard(dir, /** @type {string[]} */ args = []) {
  const out = /** @type {string[]} */ ([]);
  const code = runOnboard(['--project=' + dir, ...args], { cwd: dir, env: { PATH: process.env.PATH || '' }, out: (s) => out.push(s), err: (s) => out.push(s) });
  return { code, out: out.join('') };
}

test('onboard: validating is read-only and reports every gap', () => {
  const h = throwawayHome('onboard');
  cleanups.push(h.cleanup);
  const dir = path.join(h.dir, 'empty');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'mine\n');
  const before = snapshot(dir);
  const res = onboard(dir);
  assert.equal(res.code, 1);
  assert.deepEqual(snapshot(dir), before, 'nothing written without --scaffold');
  for (const needle of ['GAP   no manifest', 'GAP   requirements document', 'GAP   ADR library index', 'GAP   ADR template',
    'GAP   architecture diagram', 'GAP   sequences diagram', 'OK    README: README.md']) assert.ok(res.out.includes(needle), needle);
});

test('onboard --scaffold: writes only the missing files, never a record, never over one that exists', () => {
  const h = throwawayHome('onboard');
  cleanups.push(h.cleanup);
  const dir = path.join(h.dir, 'New Project');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'README.md'), 'mine\n');
  const res = onboard(dir, ['--scaffold']);
  assert.equal(res.code, 0, res.out);
  assert.equal(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'), 'mine\n', 'an existing file is never overwritten');
  assert.deepEqual(fs.readdirSync(path.join(dir, 'docs', 'adr')).sort(), ['README.md', 'template.md'], 'no ADR record (ADR-0020)');
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'new-project-product-requirements-document-project.md')));
  assert.match(fs.readFileSync(path.join(dir, 'docs', 'architecture.md'), 'utf8'), /```mermaid\nblock-beta\n {2}columns 1/);
  assert.match(fs.readFileSync(path.join(dir, 'docs', 'sequences.md'), 'utf8'), /```mermaid\nflowchart LR/);
  assert.deepEqual(manifestErrors(JSON.parse(fs.readFileSync(path.join(dir, MANIFEST), 'utf8'))), []);
  assert.match(res.out, /NOTE {2}coverage not checked/);
  const again = onboard(dir, ['--scaffold']);
  assert.match(again.out, /NOTE {2}nothing to write/);
});

test('onboard --scaffold: a not-applicable item is not scaffolded, and a symlinked docs directory is refused', () => {
  const h = throwawayHome('onboard');
  cleanups.push(h.cleanup);
  const dir = path.join(h.dir, 'p');
  fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
  const m = structuredClone(MANIFEST_DOC);
  fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m));
  onboard(dir, ['--scaffold']);
  assert.equal(fs.existsSync(path.join(dir, 'docs', 'sequences.md')), false);
  assert.ok(fs.existsSync(path.join(dir, 'docs', 'architecture.md')));
  if (process.platform === 'win32') return; // a symlink needs a privilege a Windows runner may lack
  const outside = path.join(h.dir, 'outside');
  fs.mkdirSync(outside);
  const q = path.join(h.dir, 'q');
  fs.mkdirSync(q);
  fs.symlinkSync(outside, path.join(q, 'docs'));
  assert.equal(onboard(q, ['--scaffold']).code, 2);
  assert.deepEqual(fs.readdirSync(outside), [], 'nothing was written through the link');
});

test('the scaffold refuses to put anything but the index and the template in the ADR library', () => {
  const m = structuredClone(MANIFEST_DOC);
  m.baseline.readme = 'docs/adr/0001-first.md';
  assert.throws(() => scaffoldFiles(/** @type {any} */ (m), 'demo', false), /refusing to scaffold a decision record/);
});

test('onboard: a project-policy additional document that is missing is a gap', { skip: !GIT }, () => {
  const r = baseRepo();
  r.write('docs/adr/README.md', '# x\n');
  r.write('docs/adr/template.md', '# t\n');
  r.write('docs/architecture.md', '```mermaid\nblock-beta\n```\n');
  r.write('project-policy.json', JSON.stringify({ baseline_override: { documentation: { additional_docs: [
    { path: 'docs/runbooks/rollback.md', description: 'kept current' }] } } }));
  r.commit('docs');
  const res = validate(fs.realpathSync(r.dir), r.env);
  assert.ok(res.lines.some((l) => l.startsWith('GAP   additional document (project-policy.json): docs/runbooks/rollback.md')), res.lines.join('\n'));
  // The fixture's manifest covers src/** and package.json only, so the docs and project-policy.json
  // are tracked files outside every capability.
  assert.ok(res.lines.some((l) => /^GAP {3}[0-9]+ tracked file\(s\) outside every capability, first: .*project-policy\.json/.test(l)),
    res.lines.join('\n'));
});

// -- this repository passes its own baseline --------------------------------------------------------

test('mhw itself: its manifest is valid and every tracked file belongs to a capability', { skip: !GIT }, () => {
  const res = validate(fs.realpathSync(ROOT), { PATH: process.env.PATH || '' });
  assert.equal(res.gaps, 0, res.lines.join('\n'));
  assert.ok(res.lines.some((l) => /^OK {4}every one of [0-9]+ tracked files belongs to a capability$/.test(l)), res.lines.join('\n'));
});

test('docs-baseline.yml runs the check on every body edit, with the body never interpolated into the script', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'docs-baseline.yml'), 'utf8').replaceAll('\r\n', '\n');
  assert.match(yml, /types: \[opened, synchronize, reopened, edited\]/);
  assert.match(yml, /PR_BODY: \$\{\{ github\.event\.pull_request\.body \}\}/);
  assert.match(yml, /node bin\/mhw\.js docs-baseline check "--base=origin\/\$BASE_REF" "--body-file=\$RUNNER_TEMP\/pr-body\.md"/);
  const script = yml.slice(yml.indexOf('run: |'));
  assert.doesNotMatch(script, /\$\{\{/, 'no expression inside the script: the body reaches it only through the environment');
  assert.match(yml, /^permissions: \{\}$/m);
});
