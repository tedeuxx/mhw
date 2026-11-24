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
  validate, MANIFEST, inAdrLibrary, loosenings,
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

test('check: through the delivery gates Action\'s engine; onboard through bin/mhw.js (#592)', { skip: !GIT }, () => {
  const r = baseRepo();
  r.write('src/core.js', 'export const c = 4;\n');
  r.commit('code only');
  /** @param {string} entry @param {string[]} args */
  const run = (entry, args) => spawnSync(process.execPath, [path.join(ROOT, ...entry.split('/')), ...args],
    { cwd: r.dir, env: r.env, encoding: 'utf8' });
  assert.equal(run('src/action/gates.js', ['docs-baseline', 'check', '--base=main']).status, 1);
  assert.equal(run('src/action/gates.js', ['docs-baseline']).status, 2);
  assert.equal(run('bin/mhw.js', ['onboard', '--nope']).status, 2);
  // `mhw docs-baseline check` left the CLI: an unknown subcommand, and nothing ran.
  const gone = run('bin/mhw.js', ['docs-baseline', 'check', '--base=main']);
  assert.equal(gone.status, 2);
  assert.equal(gone.stdout, '');
  assert.match(gone.stderr, /^mhw: (?:unknown (?:subcommand|argument for) docs-baseline|docs-baseline is not available on Windows)/);
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
      if (e.isSymbolicLink()) out[path.relative(dir, p)] = '-> ' + fs.readlinkSync(p);
      else if (e.isDirectory()) walk(p);
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

// QA B1 on PR #528: mkdir ran before the confinement check, so a baseline directory linked outside the
// project got directories created through the link before the refusal. One row per baseline directory;
// each row links the item's top directory outside, and nothing may appear there, nor anything inside.
test('onboard --scaffold: a baseline directory linked outside the project creates nothing, anywhere', { skip: process.platform === 'win32' }, () => {
  /** @type {Array<[string, (m: any) => void, string]>} */
  const rows = [
    ['adr_library', (m) => { m.baseline.adr_library = 'decisions/adr'; }, 'decisions'],
    ['prd', (m) => { m.baseline.prd = 'docs/demo-product-requirements-document-project.md'; }, 'docs'],
    ['readme', (m) => { m.baseline.readme = 'top/README.md'; }, 'top'],
    ['architecture', (m) => { m.baseline.architecture = 'arch/view/architecture.md'; }, 'arch'],
    ['sequences', (m) => { m.baseline.sequences = 'seq/flows/sequences.md'; }, 'seq'],
  ];
  for (const [item, edit, linked] of rows) {
    const h = throwawayHome('onboard-link');
    cleanups.push(h.cleanup);
    const dir = path.join(h.dir, 'p');
    const outside = path.join(h.dir, 'outside');
    fs.mkdirSync(path.join(dir, 'docs'), { recursive: true });
    fs.mkdirSync(outside);
    const m = structuredClone(/** @type {any} */ (MANIFEST_DOC));
    edit(m);
    assert.deepEqual(manifestErrors(m), [], item);
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m));
    if (linked === 'docs') {
      // docs itself holds the manifest, so link a fresh project's docs instead.
      fs.rmSync(path.join(dir, 'docs'), { recursive: true });
      fs.symlinkSync(outside, path.join(dir, 'docs'));
    } else {
      fs.symlinkSync(outside, path.join(dir, linked));
    }
    const before = snapshot(dir);
    const res = onboard(dir, ['--scaffold']);
    assert.equal(res.code, 2, item + ': ' + res.out);
    assert.match(res.out, /its directory resolves outside the project/, item);
    assert.deepEqual(fs.readdirSync(outside), [], item + ': nothing created through the link');
    assert.deepEqual(snapshot(dir), before, item + ': nothing written inside either, before the refusal');
  }
});

test('onboard: an architecture or sequences file without a mermaid block is a gap', () => {
  const h = throwawayHome('onboard');
  cleanups.push(h.cleanup);
  const dir = path.join(h.dir, 'p');
  fs.mkdirSync(dir);
  onboard(dir, ['--scaffold']);
  assert.equal(onboard(dir).code, 0);
  fs.writeFileSync(path.join(dir, 'docs', 'architecture.md'), '# Architecture\n\n```\nblock-beta\n```\n\n`mermaid`\n');
  const res = onboard(dir);
  assert.equal(res.code, 1);
  assert.match(res.out, /GAP {3}architecture diagram: docs\/architecture\.md carries no ```mermaid block/);
  fs.writeFileSync(path.join(dir, 'docs', 'architecture.md'), '# A\n\n```mermaid\r\nblock-beta\n```\n');
  assert.equal(onboard(dir).code, 0, 'a CRLF fence line still counts');
});

test('check: a malformed escape line is fatal even when every capability is satisfied', { skip: !GIT }, () => {
  const r = baseRepo();
  r.write('src/core.js', 'export const c = 5;\n');
  r.write('README.md', '# demo\n\nIt does five things.\n');
  r.commit('code and doc');
  assert.equal(check(r, '').code, 0, 'control: satisfied without the line');
  const res = check(r, 'docs-baseline: maybe later\n');
  assert.equal(res.code, 1);
  assert.match(res.out, /FAIL {2}malformed escape line \(it waives nothing\): docs-baseline: maybe later/);
});

test('check: a ref carrying .. is refused before git runs', { skip: !GIT }, () => {
  const r = baseRepo();
  r.commit('nothing');
  const err = /** @type {string[]} */ ([]);
  const io = { cwd: r.dir, env: r.env, out: () => {}, err: (/** @type {string} */ s) => { err.push(s); } };
  for (const ref of ['main..HEAD', 'a..b', 'main...x']) {
    err.length = 0;
    assert.equal(runCheck(['check', '--base=' + ref], io), 2, ref);
    assert.match(err.join(''), /not a ref this check accepts/, ref);
  }
  err.length = 0;
  assert.equal(runCheck(['check', '--base=main', '--head=HEAD..x'], io), 2);
  assert.match(err.join(''), /not a ref this check accepts/);
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
  assert.match(yml, /^ {8}run: printf '%s\\n' "\$PR_BODY" > "\$RUNNER_TEMP\/pr-body\.md"$/m);
  // #592: the check is the delivery gates Action at this pull request's ref, fed the body file.
  assert.match(yml, /^ {8}uses: \.\/actions\/delivery-gates\n {8}with:\n {10}gate: docs-baseline\n {10}base: origin\/\$\{\{ github\.base_ref \}\}\n {10}body-file: \$\{\{ runner\.temp \}\}\/pr-body\.md$/m);
  for (const line of yml.split('\n').filter((l) => /^\s*(?:- )?run:/.test(l))) {
    assert.doesNotMatch(line, /\$\{\{/, 'no expression inside a script: the body reaches it only through the environment');
  }
  assert.match(yml, /^permissions: \{\}$/m);
});

// -- PR #528 lens: the ADR library guard, fences and comments, the base manifest, the delivery route --

test('the ADR library guard: case-folded, and a subdirectory is the library too', () => {
  for (const [file, want] of /** @type {Array<[string, boolean]>} */ ([
    ['docs/adr/0001-use-x.md', true], ['docs/ADR/0001-use-x.md', true], ['Docs/Adr/0001.md', true],
    ['docs/adr/sub/0001-x.md', true], ['docs/adr/README.md', false], ['docs/adr/template.md', false],
    ['docs/ADR/README.md', false], ['docs/adr/sub/README.md', true], ['docs/adrx/0001.md', false], ['docs/architecture.md', false],
  ])) assert.equal(inAdrLibrary(file, 'docs/adr'), want, file);
  for (const architecture of ['docs/ADR/0001-use-x.md', 'docs/adr/sub/0001-x.md']) {
    const m = structuredClone(/** @type {any} */ (MANIFEST_DOC));
    m.baseline.architecture = architecture;
    assert.throws(() => scaffoldFiles(m, 'demo', false), /refusing to scaffold a decision record/, architecture);
  }
});

test('onboard --scaffold: a record-shaped item exits 2 and writes nothing; a link into the library is refused', () => {
  /** @type {Array<[string, string | null]>} */
  const rows = [['docs/ADR/0001-use-x.md', null], ['docs/adr/sub/0001-x.md', null]];
  if (process.platform !== 'win32') rows.push(['notes/0001-use-x.md', 'notes']);
  for (const [architecture, link] of rows) {
    const h = throwawayHome('onboard-adr');
    cleanups.push(h.cleanup);
    const dir = path.join(h.dir, 'p');
    fs.mkdirSync(path.join(dir, 'docs', 'adr'), { recursive: true });
    const m = structuredClone(/** @type {any} */ (MANIFEST_DOC));
    m.baseline.architecture = architecture;
    fs.writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m));
    if (link) fs.symlinkSync(path.join(dir, 'docs', 'adr'), path.join(dir, link));
    const before = snapshot(dir);
    const res = onboard(dir, ['--scaffold']);
    assert.equal(res.code, 2, architecture + ': ' + res.out);
    assert.match(res.out, /decision record|resolves into the ADR library/, architecture);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'docs', 'adr')), [], architecture + ': nothing in the library');
    assert.deepEqual(snapshot(dir), before, architecture + ': nothing written anywhere');
  }
});

test('the body: CommonMark fences and HTML comments hide an escape line', () => {
  const esc = 'docs-baseline: none — only a quoted example';
  for (const body of [
    '````\n```\n' + esc + '\n````\n',            // a three-backtick line does not close a four-backtick fence
    '~~~\n```\n' + esc + '\n~~~\n',              // nor a backtick line a tilde fence
    '   ```\n' + esc + '\n```\n',                // an opener indented three spaces
    '```\n' + esc + '\n',                         // an unclosed fence runs to the end
    '<!-- ' + esc + ' -->\n',                     // a one-line comment
    '<!--\n' + esc + '\n-->\n',                   // a block comment
    'text <!-- never closed\n' + esc + '\n',      // an unclosed comment hides the rest
  ]) assert.equal(parseBody(body).waiver, null, JSON.stringify(body));
  for (const body of [
    '````\n```\n````\n' + esc + '\n',             // after the fence closes, the line counts
    '```\ncode\n`````  \n' + esc + '\n',          // a longer closing run with trailing blanks closes
    '<!-- hidden -->\n' + esc + '\n',             // after the comment closes
    '``` js `x`\n' + esc + '\n',                  // a backtick info string with a backtick opens nothing
    '    ```\n' + esc + '\n',                     // indented four spaces: not a fence
  ]) assert.equal(parseBody(body).waiver, esc, JSON.stringify(body));
  assert.equal(parseBody('docs-baseline: manifest — a capability merged into another\n').manifestWaiver,
    'docs-baseline: manifest — a capability merged into another');
  assert.deepEqual(parseBody('docs-baseline: manifest — \n').malformed, ['docs-baseline: manifest — ']);
});

test('loosenings: a dropped capability, code glob or document is named', () => {
  const base = /** @type {any} */ (structuredClone(MANIFEST_DOC));
  assert.deepEqual(loosenings(base, base), []);
  const head = structuredClone(base);
  head.capabilities = head.capabilities.filter((/** @type {any} */ c) => c.id !== 'api');
  head.capabilities[0].code = ['src/**'];
  head.capabilities[0].docs = ['README.md', 'docs/**'];
  assert.deepEqual(loosenings(base, head), ['drops the capability api', 'core drops the code glob package.json',
    'core drops the document docs/demo-product-requirements-document-project.md']);
});

test('check: a change that loosens its own manifest is judged by the base manifest too', { skip: !GIT }, () => {
  const r = baseRepo();
  // The lens's probe: change code alone, and list that code file as its own capability's document.
  r.write('src/api/a.js', 'export const a = 9;\n');
  const m = structuredClone(/** @type {any} */ (MANIFEST_DOC));
  m.capabilities[0].docs.push('src/api/a.js', MANIFEST);
  r.write(MANIFEST, JSON.stringify(m, null, 2));
  r.commit('self-loosening');
  const res = check(r, '');
  assert.equal(res.code, 1, res.out);
  assert.match(res.out, /^OK {4}api: \S+ changed \(touched by src\/api\/a\.js\)$/m, 'the head manifest alone would pass');
  assert.match(res.out, /FAIL {2}\[base manifest\] api: touched by src\/api\/a\.js/);
  // A manifest that drops a document fails, and only the manifest escape waives that line.
  const r2 = baseRepo();
  const m2 = structuredClone(/** @type {any} */ (MANIFEST_DOC));
  m2.capabilities[0].docs = ['docs/**'];
  r2.write(MANIFEST, JSON.stringify(m2, null, 2));
  r2.commit('drop a doc');
  const dropped = check(r2, '');
  assert.equal(dropped.code, 1, dropped.out);
  assert.match(dropped.out, /FAIL {2}the manifest api drops the document docs\/api\.md that the base revision had/);
  assert.equal(check(r2, 'docs-baseline: none — not this one\n').code, 1, 'the ordinary escape does not waive it');
  const waived = check(r2, 'docs-baseline: manifest — api documents now live under docs/\n');
  assert.equal(waived.code, 0, waived.out);
  assert.match(waived.out, /WAIVED the manifest api drops the document docs\/api\.md; the body declares docs-baseline: manifest/);
});

test('check: a base revision without a manifest is noted, and the head manifest alone judges', { skip: !GIT }, () => {
  const r = repo();
  r.write('README.md', '# demo\n');
  r.commit('base without a manifest');
  r.git('checkout', '-q', '-b', 'change');
  r.write(MANIFEST, JSON.stringify(defaultManifest('demo'), null, 2));
  r.write('src/core.js', 'x\n');
  r.write('README.md', '# demo\n\nNow with a core.\n');
  r.commit('adopt the baseline');
  const res = check(r, '');
  assert.match(res.out, /^NOTE {2}the merge base has no manifest at this path/m);
  assert.equal(res.code, 0, res.out);
});

