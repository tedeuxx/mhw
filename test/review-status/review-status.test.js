// The review verdicts as commit statuses (Issue #591, ADR-0045): .github/scripts/review-status.js against
// synthetic payloads only (o/r, example.invalid, SHAs of one repeated hex digit). The verdict and lens
// cases are the removed `mhw delivery merge` gate's, now read as statuses instead of a merge decision.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as r from '../../.github/scripts/review-status.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const HEAD = 'a'.repeat(40);
const OLD = 'b'.repeat(40);
const BASE_SHA = 'e'.repeat(40);

/** @param {{ head?: string, literal?: string, author?: string, ownerCheck?: string, crlf?: boolean }} [o] */
function gate(o = {}) {
  const { head = HEAD, literal = 'APPROVE-AND-MERGE', author = 'OWNER', ownerCheck = 'owner-check: none' } = o;
  const nl = o.crlf ? '\r\n' : '\n';
  return { authorAssociation: author, body: ['<!-- gatekeeper-verdict: quality-assurance -->', literal, 'head: ' + head, ownerCheck, '', 'table'].join(nl) };
}
/** @param {{ commit?: string, state?: string, author?: string }} [o] */
function lens(o = {}) {
  const { commit = HEAD, state = 'the lens is CLOSED', author = 'OWNER' } = o;
  return { authorAssociation: author, body: '<!-- harness-lead-verdict: probe -->\ncommit: ' + commit + '\n' + state + '\n\nfindings' };
}
/** @param {string} body @param {string} [author] */
const raw = (body, author = 'OWNER') => ({ authorAssociation: author, body });

/** @param {Partial<{ ancestor: number, markerBase: string, headBase: string, delta: string[] }>} [o] @returns {r.History} */
function history(o = {}) {
  return {
    base: 'rc/next',
    isAncestor: () => o.ancestor ?? 0,
    mergeBase: (ref) => (ref === HEAD ? o.headBase ?? BASE_SHA : o.markerBase ?? BASE_SHA),
    delta: () => o.delta ?? ['src/x.js', 'docs/x.md'],
  };
}

/** @param {() => string} f @param {'pending' | 'failure'} state @param {RegExp} why */
function refuses(f, state, why) {
  assert.throws(f, (e) => e instanceof r.Refusal && e.state === state && why.test(e.message));
}

test('the harness-path predicate, table-driven, at any depth', () => {
  assert.deepEqual([...r.HARNESS_DIRS].sort(), ['.agents', '.claude', '.codex', '.github', '.kiro']);
  assert.deepEqual([...r.HARNESS_FILES].sort(), ['AGENTS.md', 'CLAUDE.md']);
  /** @type {Array<[string, boolean]>} */
  const table = [
    ['AGENTS.md', true], ['docs/CLAUDE.md', true], ['.github/workflows/tests.yml', true], ['.claude/x.md', true],
    ['.codex/hooks.json', true], ['.kiro/steering/a.md', true], ['.agents/skills/x/SKILL.md', true],
    ['test/golden/.github/x', true], ['a/b/AGENTS.md', true], ['".github/d\\303\\251.yml"', true],
    ['docs/adr/0001-x.md', false], ['global/a.sh', false], ['docs/CLAUDE.md.bak', false],
    ['x.claude/a', false], ['AGENTS.mdx', false], ['.claude', false], ['.github', false], ['', false],
  ];
  for (const [p, harness] of table) assert.equal(r.harnessPaths([p]).length === 1, harness, p);
});

test('the quality-assurance status: APPROVE-AND-MERGE at this head, in the strict header, is success', () => {
  assert.equal(r.gateDecision([gate()], HEAD), 'APPROVE-AND-MERGE at this head');
  assert.equal(r.gateDecision([gate({ crlf: true })], HEAD), 'APPROVE-AND-MERGE at this head', 'a CRLF body');
  assert.equal(r.gateDecision([gate({ ownerCheck: 'owner-check: open the site' })], HEAD), 'APPROVE-AND-MERGE at this head');
  for (const author of ['MEMBER', 'COLLABORATOR']) assert.ok(r.gateDecision([gate({ author })], HEAD));
});

test('the quality-assurance status refuses each way the removed route refused', () => {
  refuses(() => r.gateDecision([], HEAD), 'pending', /^no quality-assurance gatekeeper-verdict/);
  refuses(() => r.gateDecision([gate({ head: OLD })], HEAD), 'pending', /does not name the current head/);
  refuses(() => r.gateDecision([gate({ literal: 'REQUEST-CHANGES' })], HEAD), 'failure', /does not authorize a merge: REQUEST-CHANGES/);
  refuses(() => r.gateDecision([gate({ literal: 'APPROVE-PENDING-HUMAN' })], HEAD), 'failure', /does not authorize/);
  refuses(() => r.gateDecision([gate({ literal: 'APPROVE-AND-MERGE-BOUNDARY' })], HEAD), 'failure', /retired literal APPROVE-AND-MERGE-BOUNDARY/);
  refuses(() => r.gateDecision([gate({ literal: ' APPROVE-AND-MERGE' })], HEAD), 'failure', /does not authorize/);
  for (const oc of ['', 'owner-check:', 'owner-check: ', 'owner-check: none ', 'owner-check:none', 'closes: 1']) {
    refuses(() => r.gateDecision([gate({ ownerCheck: oc })], HEAD), 'failure', /no owner-check line on line 4/);
  }
  refuses(() => r.gateDecision([raw('<!-- gatekeeper-verdict: security -->\nAPPROVE-AND-MERGE\nhead: ' + HEAD + '\nowner-check: none')], HEAD),
    'failure', /strict header/);
  refuses(() => r.gateDecision([raw(gate().body.replace('head: ', 'head:  '))], HEAD), 'failure', /strict header/);
  refuses(() => r.gateDecision([raw(gate().body.replace(HEAD, HEAD.slice(0, 12)))], HEAD), 'failure', /strict header/);
});

test('newest trusted gate verdict wins; an untrusted or quoted one never counts', () => {
  refuses(() => r.gateDecision([gate(), gate({ literal: 'REQUEST-CHANGES' })], HEAD), 'failure', /REQUEST-CHANGES/);
  assert.ok(r.gateDecision([gate({ literal: 'REQUEST-CHANGES' }), gate()], HEAD));
  for (const author of ['NONE', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', '']) {
    refuses(() => r.gateDecision([raw(gate().body, /** @type {any} */ (author))], HEAD), 'pending', /^no quality-assurance/);
    assert.ok(r.gateDecision([gate(), raw(gate({ literal: 'REQUEST-CHANGES' }).body, /** @type {any} */ (author))], HEAD), String(author));
  }
  for (const body of ['quoted:\n' + gate().body, '> ' + gate().body, '```\n' + gate().body + '\n```', ' ' + gate().body]) {
    refuses(() => r.gateDecision([raw(body)], HEAD), 'pending', /^no quality-assurance/);
  }
});

test('the agents-lead status: no harness path needs no lens', () => {
  assert.match(r.lensDecision([], HEAD, ['src/x.js', 'docs/a.md'], history()), /no harness path changed/);
});

test('the agents-lead status: CLOSED at this head, OPEN, absent, malformed', () => {
  const paths = ['src/x.js', '.github/workflows/x.yml'];
  assert.equal(r.lensDecision([lens()], HEAD, paths, history()), 'the lens is CLOSED at this head');
  refuses(() => r.lensDecision([], HEAD, paths, history()), 'pending', /no agents-lead lens marker/);
  refuses(() => r.lensDecision([lens({ state: 'the lens is OPEN' })], HEAD, paths, history()), 'failure', /does not say the lens is CLOSED/);
  refuses(() => r.lensDecision([lens({ state: 'the lens is closed' })], HEAD, paths, history()), 'failure', /does not say the lens is CLOSED/);
  refuses(() => r.lensDecision([raw('<!-- harness-lead-verdict: x -->\ncommit:' + HEAD + '\nthe lens is CLOSED')], HEAD, paths, history()),
    'failure', /strict header/);
  refuses(() => r.lensDecision([lens({ author: 'NONE' })], HEAD, paths, history()), 'pending', /no agents-lead lens marker/);
  // A newer open marker withdraws an older closed one, even with a preamble.
  const preamble = raw('Round 2 below.\n<!-- harness-lead-verdict: blocking -->\ncommit: ' + HEAD + '\nthe lens is OPEN');
  refuses(() => r.lensDecision([lens(), preamble], HEAD, paths, history()), 'failure', /strict header/);
  // Not markers: one in a fence, one indented, one inside a gate verdict.
  for (const body of ['context:\n```\n<!-- harness-lead-verdict: x -->\ncommit: ' + HEAD + '\nthe lens is OPEN\n```',
    '    <!-- harness-lead-verdict: x -->', gate().body + '\n<!-- harness-lead-verdict: x -->\ncommit: ' + HEAD + '\nthe lens is OPEN']) {
    assert.equal(r.lensDecision([lens(), raw(body)], HEAD, paths, history()), 'the lens is CLOSED at this head', body.slice(0, 20));
  }
});

test('carry-forward: a CLOSED lens at an earlier commit is success only when (a), (b) and (c) hold', () => {
  const paths = ['.github/workflows/x.yml'];
  const old = [lens({ commit: OLD })];
  assert.match(r.lensDecision(old, HEAD, paths, history()), /^the lens is CLOSED at b{12} and carries forward$/);
  refuses(() => r.lensDecision(old, HEAD, paths, history({ ancestor: 1 })), 'pending', /\(a\) its commit is not an ancestor/);
  refuses(() => r.lensDecision(old, HEAD, paths, history({ ancestor: 128 })), 'pending', /\(a\) its commit cannot be read/);
  refuses(() => r.lensDecision(old, HEAD, paths, history({ markerBase: 'f'.repeat(40) })), 'pending', /\(b\) the merge-base with rc\/next moved/);
  for (const p of ['.github/workflows/tests.yml', 'AGENTS.md', 'method/.agents/x', '"docs/\\303.md"']) {
    refuses(() => r.lensDecision(old, HEAD, paths, history({ delta: ['src/x.js', p] })), 'pending', /\(c\) the delta since its commit touches a harness path/);
  }
  refuses(() => r.lensDecision([lens({ commit: OLD, state: 'the lens is OPEN' })], HEAD, paths, history()), 'pending',
    /does not name the current head/);
});

test('the merge-base sets are compared as sets: git\'s order never decides limb (b)', () => {
  const one = '1'.repeat(40);
  const two = '2'.repeat(40);
  const three = '3'.repeat(40);
  /** @type {Record<string, string>} */
  const printed = { [OLD]: [three, one, two].join('\n') + '\n', [HEAD]: [two, three, one].join('\r\n') + '\r\n' };
  /** @type {import('../../src/lib/gh.js').ToolRunner} */
  const exec = (_tool, args) => ({ code: 0, stdout: printed[args[args.length - 1]] ?? '', stderr: '' });
  const h = r.gitHistory(exec, 'rc/next');
  assert.equal(h.mergeBase(OLD), [one, two, three].join(' '));
  assert.equal(h.mergeBase(OLD), h.mergeBase(HEAD));
  assert.throws(() => h.mergeBase('c'.repeat(40)), /cannot read the merge-base/);
});

test('the route status: slices into rc/next from their own branch, main only from rc/next', () => {
  const pr = (/** @type {string} */ baseRefName, /** @type {string} */ headRefName, isCrossRepository = false) => ({ baseRefName, headRefName, isCrossRepository });
  assert.ok(r.routeDecision(pr('rc/next', 'loop/1-x')));
  assert.ok(r.routeDecision(pr('main', 'rc/next')));
  assert.throws(() => r.routeDecision(pr('main', 'loop/1-x')), /only the rc\/next release candidate may target main/);
  assert.throws(() => r.routeDecision(pr('rc/next', 'rc/next')), /its own feature branch/);
  assert.throws(() => r.routeDecision(pr('rc/next', 'main')), /its own feature branch/);
  assert.throws(() => r.routeDecision(pr('rc/next', 'loop/1-x', true)), /another repository/);
  assert.throws(() => r.routeDecision(pr('main', 'rc/next', true)), /another repository/);
  assert.throws(() => r.routeDecision({ baseRefName: 'rc/next', headRefName: 'x' }), /another repository/, 'an absent field refuses');
  assert.throws(() => r.routeDecision(pr('develop', 'x')), /neither rc\/next nor main/);
});

test('evaluate: three statuses on a slice, two on the release candidate (no lens there, as before)', () => {
  const slice = { headRefOid: HEAD, baseRefName: 'rc/next', headRefName: 'loop/1', isCrossRepository: false, comments: [gate()] };
  const s = r.evaluate({ pr: slice, paths: () => ['src/x.js'], history: history() });
  assert.deepEqual(s.map((x) => [x.context, x.state]), [['review/route', 'success'], ['review/quality-assurance', 'success'], ['review/agents-lead', 'success']]);
  let read = false;
  const rc = r.evaluate({ pr: { ...slice, baseRefName: 'main', headRefName: 'rc/next' }, paths: () => { read = true; return []; }, history: history() });
  assert.deepEqual(rc.map((x) => x.context), ['review/route', 'review/quality-assurance']);
  assert.equal(read, false, 'the release candidate reads no diff');
  assert.throws(() => r.evaluate({ pr: { ...slice, headRefOid: 'abc' }, paths: () => [], history: history() }), /no readable head/);
  for (const x of r.evaluate({ pr: { ...slice, comments: [gate({ literal: 'X'.repeat(300) })] }, paths: () => [], history: history() })) {
    assert.ok(x.description.length <= r.DESCRIPTION_MAX, x.context);
  }
});

/**
 * A synthetic gh and git for main(): calls are recorded; the PR view and the fetched head are set here.
 * @param {{ pr?: Record<string, any>, fetched?: string, changed?: string[] }} [o]
 */
function fakeExec(o = {}) {
  /** @type {string[][]} */
  const calls = [];
  const pr = o.pr ?? { headRefOid: HEAD, headRefName: 'loop/1', baseRefName: 'rc/next', isCrossRepository: false, state: 'OPEN', comments: [gate()] };
  /** @type {import('../../src/lib/gh.js').ToolRunner} */
  const exec = (tool, args) => {
    calls.push([tool, ...args]);
    const ok = (/** @type {string} */ stdout) => ({ code: 0, stdout, stderr: '' });
    if (tool === 'gh' && args[0] === 'pr') return ok(JSON.stringify(pr));
    if (tool === 'gh' && args[0] === 'api') return ok('{}');
    if (tool === 'git' && args[0] === 'fetch') return ok('');
    if (tool === 'git' && args[0] === 'rev-parse') return ok((o.fetched ?? pr.headRefOid) + '\n');
    if (tool === 'git' && args[0] === 'diff') return ok((o.changed ?? ['src/x.js']).map((p) => p + '\0').join(''));
    if (tool === 'git' && args[0] === 'merge-base') return args[1] === '--is-ancestor' ? { code: 0, stdout: '', stderr: '' } : ok(BASE_SHA + '\n');
    if (tool === 'git' && args[0] === 'remote') return ok('https://github.com/o/r.git\n');
    return { code: 1, stdout: '', stderr: '' };
  };
  return { exec, calls };
}

/** @param {unknown} event @param {ReturnType<typeof fakeExec>} fake @param {string[]} [argv] */
function runEvent(event, fake, argv = []) {
  return r.main({
    argv, cwd: ROOT, exec: fake.exec, readEvent: () => JSON.stringify(event),
    env: { GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_PATH: '/event.json', GITHUB_SERVER_URL: 'https://example.invalid', GITHUB_RUN_ID: '9' },
  });
}
/** @param {string[][]} calls */
const posts = (calls) => calls.filter((c) => c[0] === 'gh' && c[1] === 'api');
/** @param {string[]} call @param {string} key */
const field = (call, key) => {
  const at = call.findIndex((a, i) => call[i - 1] === '-f' && a.startsWith(key + '='));
  return at < 0 ? undefined : call[at].slice(key.length + 1);
};

test('a pull_request_target event posts each status on the head the forge reports, not the event commit', () => {
  const fake = fakeExec();
  const res = runEvent({ pull_request: { number: 7, head: { sha: OLD } } }, fake);
  assert.equal(res.code, 0, res.lines.join('\n'));
  const p = posts(fake.calls);
  assert.deepEqual(p.map((c) => field(c, 'context')), ['review/route', 'review/quality-assurance', 'review/agents-lead']);
  for (const c of p) {
    assert.deepEqual(c.slice(1, 5), ['api', '--method', 'POST', 'repos/o/r/statuses/' + HEAD]);
    assert.equal(field(c, 'state'), 'success');
    assert.equal(field(c, 'target_url'), 'https://example.invalid/o/r/actions/runs/9');
  }
  const view = fake.calls.find((c) => c[1] === 'pr');
  assert.deepEqual(view?.slice(0, 5), ['gh', 'pr', 'view', '7', '--repo']);
  // The head is fetched as objects into a review ref; nothing is checked out.
  assert.ok(fake.calls.some((c) => c[1] === 'fetch' && c.includes('+refs/pull/7/head:refs/remotes/review/7')));
  assert.ok(!fake.calls.some((c) => c[1] === 'checkout' || c[1] === 'switch'));
});

test('an issue_comment on a pull request re-judges; one on an Issue and a closed PR post nothing', () => {
  const fake = fakeExec({ pr: { headRefOid: HEAD, headRefName: 'loop/1', baseRefName: 'rc/next', isCrossRepository: false, state: 'OPEN',
    comments: [gate(), gate({ literal: 'REQUEST-CHANGES' })] } });
  const res = runEvent({ issue: { number: 7, pull_request: { url: 'https://example.invalid' } }, comment: { body: 'x' } }, fake);
  assert.equal(res.code, 1);
  assert.equal(field(posts(fake.calls)[1], 'state'), 'failure');
  const issue = fakeExec();
  assert.equal(runEvent({ issue: { number: 7 }, comment: { body: gate().body } }, issue).code, 0);
  assert.deepEqual(issue.calls, [], 'an Issue comment reads nothing');
  const closed = fakeExec({ pr: { headRefOid: HEAD, baseRefName: 'rc/next', state: 'MERGED', comments: [] } });
  runEvent({ pull_request: { number: 7 } }, closed);
  assert.deepEqual(posts(closed.calls), []);
  const other = fakeExec({ pr: { headRefOid: HEAD, baseRefName: 'develop', state: 'OPEN', comments: [] } });
  runEvent({ pull_request: { number: 7 } }, other);
  assert.deepEqual(posts(other.calls), []);
});

test('a head that moved while it was read gets no status; the next event judges it', () => {
  const fake = fakeExec({ fetched: OLD });
  const res = runEvent({ pull_request: { number: 7 } }, fake);
  assert.equal(res.code, 1);
  assert.deepEqual(posts(fake.calls), []);
});

test('the dry run judges from a checkout and posts nothing', () => {
  const fake = fakeExec({ changed: ['AGENTS.md'] });
  const res = r.main({ argv: ['--pr', '7', '--dry-run'], cwd: ROOT, exec: fake.exec, env: {} });
  assert.deepEqual(posts(fake.calls), []);
  assert.equal(res.code, 1, 'a harness path with no lens marker');
  assert.deepEqual(res.lines.slice(0, 3), [
    'review/route success: a slice from its own branch into rc/next',
    'review/quality-assurance success: APPROVE-AND-MERGE at this head',
    'review/agents-lead pending: harness paths changed and no agents-lead lens marker is on the PR',
  ]);
  assert.equal(res.lines[3], 'dry run, nothing posted: ' + HEAD);
  assert.throws(() => r.main({ argv: ['--pr', '0'], cwd: ROOT, exec: fake.exec, env: {} }), /--pr needs/);
});

test('the workflow runs the base or default branch copy of the evaluator, never the pull request\'s', () => {
  // The Windows runners check out with core.autocrlf=true, so the file may carry CRLF; read it as LF.
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'review-status.yml'), 'utf8').replaceAll('\r\n', '\n');
  const live = wf.split('\n').filter((l) => !l.trimStart().startsWith('#')).join('\n');
  assert.match(live, /^on:\n {2}pull_request_target:\n {4}branches: \[main, rc\/next\]\n/m);
  assert.match(live, /^ {2}issue_comment:\n {4}types: \[created, edited, deleted\]$/m);
  assert.ok(!/^ {2}pull_request:/m.test(live), 'a pull_request trigger would run the PR\'s own copy');
  assert.ok(!/\bref:/.test(live), 'the checkout never names the PR head');
  assert.ok(!live.includes('github.event.pull_request.head'), 'nothing from the PR head is used');
  assert.match(live, /^permissions: \{\}$/m);
  assert.match(live, / {6}statuses: write\n/);
  assert.ok(!/contents: write|pull-requests: write|id-token/.test(live));
  assert.match(live, /run: node \.github\/scripts\/review-status\.js$/m);
  for (const u of live.match(/- uses: \S+/g) || []) assert.match(u, /@[0-9a-f]{40}$/, u);
});

test('the merge-authority literals the status accepts are the contract\'s', () => {
  assert.deepEqual([...r.MERGE_LITERALS], ['APPROVE-AND-MERGE']);
  assert.deepEqual([...r.RETIRED_LITERALS], ['APPROVE-AND-MERGE-BOUNDARY']);
  assert.deepEqual(Object.values(r.CONTEXT), ['review/route', 'review/quality-assurance', 'review/agents-lead']);
});
