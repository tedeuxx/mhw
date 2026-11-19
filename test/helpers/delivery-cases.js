// The delivery route's parity cases (#474): every case of the deleted workspace/delivery_test.py, each
// as a whole run of the command against a synthetic git and gh, so its decision (merge, refuse, pending
// and the message) can be compared with workspace/delivery.py's own transcript in test/golden/S03/.
// A unit assertion of the old suite becomes the run in which that gate is the one that decides.
// Synthetic values only: example.invalid, o/r, and SHAs made of one repeated hex digit.

export const HEAD = 'a'.repeat(40);
export const OLD_HEAD = 'b'.repeat(40);
export const MERGE_COMMIT = 'c'.repeat(40);

export const TESTS_RUN = [
  'shellcheck', 'profiles (ubuntu-latest)', 'profiles (macos-latest)', 'profiles (windows-latest)',
  'suites (ubuntu-latest)', 'suites (macos-latest)',
  'node (ubuntu-latest)', 'node (macos-latest)', 'node (windows-latest)',
  'git-route (ubuntu-latest)', 'git-route (macos-latest)', 'windows (powershell)', 'windows (pwsh)',
  'isolation-smoke', 'prod-canary-installed-not-enforced (linux-container, ubuntu-latest)',
  'prod-canary-installed-not-enforced (macos-throwaway-home, macos-latest)',
].map((name) => ({ name, workflowName: 'tests', conclusion: 'SUCCESS' }));

/**
 * @param {{ head?: string, literal?: string, author?: string, prose?: string, ownerCheck?: string }} [o]
 */
export function gate(o = {}) {
  const { head = HEAD, literal = 'APPROVE-AND-MERGE', author = 'OWNER', prose = '\n\nverdict table', ownerCheck = 'owner-check: none' } = o;
  return { authorAssociation: author, body: '<!-- gatekeeper-verdict: quality-assurance -->\n' + literal + '\nhead: ' + head + '\n' + ownerCheck + prose };
}

/** @param {{ commit?: string, closed?: boolean, author?: string, fenced?: boolean, state?: string }} [o] */
export function lens(o = {}) {
  const { commit = HEAD, closed = true, author = 'OWNER', fenced = false } = o;
  const state = o.state ?? (closed ? 'the lens is CLOSED' : 'the lens is OPEN');
  let body = '<!-- harness-lead-verdict: probe -->\ncommit: ' + commit + '\n' + state + '\n\nfindings';
  if (fenced) body = 'earlier round:\n```\n' + body + '\n```';
  return { authorAssociation: author, body };
}

/** @param {string} body @param {string} [author] */
export const raw = (body, author = 'OWNER') => ({ authorAssociation: author, body });

// The release candidate: rc/next -> main.
export const RC = {
  headRefOid: HEAD, baseRefName: 'main', headRefName: 'rc/next', isCrossRepository: false, mergeStateStatus: 'CLEAN',
  labels: [{ name: 'semver:minor' }],
  statusCheckRollup: [...TESTS_RUN,
    { name: 'delivery-ci', workflowName: 'tests', conclusion: 'SUCCESS' },
    { name: 'semver-label', workflowName: 'semver-label', conclusion: 'SUCCESS' },
    { name: 'SonarCloud Code Analysis', conclusion: 'SUCCESS' }],
};
// A slice: feature branch -> rc/next. semver-label never runs there.
export const SLICE = { ...RC, baseRefName: 'rc/next', headRefName: 'feat/x', comments: [gate()],
  statusCheckRollup: RC.statusCheckRollup.filter((c) => c.name !== 'semver-label') };
export const RELEASE = { tag_name: 'v1.2.0', draft: false, prerelease: false, published_at: '2026-10-02T00:00:00Z',
  html_url: 'https://example.invalid/releases/v1.2.0' };
const NON_HARNESS = ['workspace/delivery.py'];
const HARNESS = ['workspace/delivery.py', '.agents/skills/x/SKILL.md'];

/**
 * @typedef {import('./delivery-fake.js').Scenario} Scenario
 * @typedef {{ name: string, args: string[], scenario: Scenario, from: string, codeOnly?: string }} Case
 */

/**
 * A merge run, as delivery_test.py's drive() set it up: the PR view is OPEN with no merge commit.
 * @param {Record<string, any>} pr @param {{ branch?: string, changed?: string[], remoteHead?: string, behind?: number }} [o]
 * @returns {Scenario}
 */
function merging(pr, o = {}) {
  const branch = o.branch ?? (pr.baseRefName === 'main' ? 'rc/next' : 'feat/x');
  return {
    head: HEAD, remote: 'https://github.com/o/r.git', branch, remoteHead: o.remoteHead ?? HEAD,
    changed: o.changed ?? NON_HARNESS,
    pr: { ...pr, number: 7, url: 'https://example.invalid/pr/7', state: 'OPEN', mergeCommit: null },
    api: { ['compare/' + pr.baseRefName + '...' + HEAD]: { behind_by: o.behind ?? 0 } },
  };
}

/**
 * A verify run of a merged PR.
 * @param {Record<string, any>} pr @param {{ release?: Record<string, any>, comparison?: Record<string, any>, runs?: any[] }} [o]
 * @returns {Scenario}
 */
function verifying(pr, o = {}) {
  const release = o.release ?? RELEASE;
  return {
    head: HEAD, remote: 'git@github.com:o/r.git', branch: pr.headRefName,
    pr: { ...pr, number: 7, url: 'https://example.invalid/pr/7', state: 'MERGED', mergeCommit: { oid: MERGE_COMMIT } },
    api: {
      'releases/latest': release,
      ['compare/' + MERGE_COMMIT + '...' + release.tag_name]: o.comparison ?? { status: 'ahead' },
      'actions/workflows/version-main.yml/runs?per_page=100': { workflow_runs: o.runs ?? [
        { id: 1, head_sha: HEAD, event: 'pull_request', conclusion: 'failure' },
        { id: 2, head_sha: HEAD, event: 'pull_request', conclusion: 'success' }] },
    },
  };
}

const MERGE = ['merge', '--pr', '7'];
const VERIFY = ['verify', '--pr', '7'];

/** @returns {Case[]} */
export function cases() {
  /** @type {Case[]} */
  const out = [];
  /** @param {string} from @param {string} name @param {string[]} args @param {Scenario} scenario @param {string} [codeOnly] */
  const add = (from, name, args, scenario, codeOnly) => {
    /** @type {Case} */
    const c = { name, args, scenario, from };
    if (codeOnly) c.codeOnly = codeOnly;
    out.push(c);
  };

  let from = 'test_merge_is_a_real_merge_commit_never_squash / test_good_exact_head_and_required_checks';
  add(from, 'rc-merge-is-a-pinned-merge-commit', MERGE, merging(RC));

  from = 'test_stale_head_fork_wrong_base_and_labels_block';
  for (const [n, ch] of /** @type {Array<[string, Record<string, any>]>} */ ([['stale-head', { headRefOid: OLD_HEAD }],
    ['fork', { isCrossRepository: true }], ['wrong-base', { baseRefName: 'other' }], ['no-label', { labels: [] }],
    ['two-labels', { labels: [{ name: 'semver:minor' }, { name: 'semver:patch' }] }]])) {
    add(from, 'rc-' + n, MERGE, merging({ ...RC, ...ch }));
  }

  from = 'test_missing_failed_and_pending_checks_block';
  /** @type {Array<[string, any[]]>} */
  const bad = [['no-checks', []], ['only-delivery-ci', [{ name: 'delivery-ci', conclusion: 'SUCCESS' }]],
    ['extra-failed', [...RC.statusCheckRollup, { name: 'extra', conclusion: 'FAILURE' }]],
    ['extra-pending', [...RC.statusCheckRollup, { name: 'extra', conclusion: '' }]]];
  for (const [n, checks] of bad) add(from, 'rc-checks-' + n, MERGE, merging({ ...RC, statusCheckRollup: checks }));

  from = 'test_only_the_latest_run_of_each_check_counts';
  const old = { name: 'semver-label', workflowName: 'semver', conclusion: 'FAILURE', startedAt: '2026-10-04T10:00:00Z', completedAt: '2026-10-04T10:00:05Z' };
  const nu = { ...old, conclusion: 'SUCCESS', startedAt: '2026-10-04T10:01:00Z', completedAt: '2026-10-04T10:01:05Z' };
  const others = RC.statusCheckRollup.filter((c) => c.name !== 'semver-label');
  add(from, 'rc-latest-old-then-new', MERGE, merging({ ...RC, statusCheckRollup: [...others, old, nu] }));
  add(from, 'rc-latest-new-then-old', MERGE, merging({ ...RC, statusCheckRollup: [...others, nu, old] }));
  add(from, 'rc-latest-later-failure', MERGE, merging({ ...RC, statusCheckRollup: [...others, nu, { ...nu, startedAt: '2026-10-04T10:02:00Z', conclusion: 'FAILURE' }] }));
  add(from, 'rc-latest-later-running', MERGE, merging({ ...RC, statusCheckRollup: [...others, nu, { ...nu, startedAt: '2026-10-04T10:02:00Z', completedAt: null, conclusion: '' }] }));
  add(from, 'rc-latest-foreign-workflow', MERGE, merging({ ...RC, statusCheckRollup: [...others, nu, { ...old, workflowName: 'other', startedAt: '2026-10-04T09:00:00Z' }] }));

  from = 'test_slice_to_rc_next_passes_without_semver_label_check / test_slice_merge_route_end_to_end_is_a_pinned_merge_commit';
  add(from, 'slice-merge-is-a-pinned-merge-commit', MERGE, merging(SLICE));

  from = 'test_slice_pr_to_main_is_refused / test_slice_to_main_end_to_end_never_merges';
  for (const h of ['feat/x', 'main', '', null, 'rc/nextx']) add(from, 'main-from-' + String(h || 'empty-' + h), MERGE, merging({ ...RC, headRefName: h }, { branch: 'feat/x' }));
  for (const h of ['rc/next', 'main']) add(from, 'slice-head-is-' + h.replace('/', '-'), MERGE, merging({ ...SLICE, headRefName: h }));

  from = 'test_missing_tests_run_is_refused';
  const sonarOnly = SLICE.statusCheckRollup.filter((c) => c.name === 'SonarCloud Code Analysis');
  add(from, 'slice-tests-sonar-only', MERGE, merging({ ...SLICE, statusCheckRollup: sonarOnly }));
  add(from, 'slice-tests-foreign-delivery-ci', MERGE, merging({ ...SLICE, statusCheckRollup: [...sonarOnly, { name: 'delivery-ci', workflowName: 'other', conclusion: 'SUCCESS' }] }));
  add(from, 'slice-tests-partial', MERGE, merging({ ...SLICE, statusCheckRollup: SLICE.statusCheckRollup.filter((c) => !c.name.startsWith('windows')) }));
  add(from, 'slice-tests-renamed', MERGE, merging({ ...SLICE, statusCheckRollup: SLICE.statusCheckRollup.map((/** @type {Record<string, any>} */ c) => (c.workflowName === 'tests' ? { ...c, workflowName: 'other' } : c)) }));

  from = 'test_pending_tests_or_dirty_merge_state_is_refused';
  add(from, 'slice-tests-pending-rerun', MERGE, merging({ ...SLICE, statusCheckRollup: [...SLICE.statusCheckRollup, { name: 'shellcheck', workflowName: 'tests', conclusion: '', startedAt: '9' }] }));
  for (const st of ['DIRTY', 'BEHIND', 'BLOCKED', 'UNKNOWN', 'UNSTABLE', null]) add(from, 'slice-state-' + String(st), MERGE, merging({ ...SLICE, mergeStateStatus: st }));

  from = 'test_slice_without_a_verdict_is_refused';
  add(from, 'slice-no-comments', MERGE, merging({ ...SLICE, comments: [] }));
  add(from, 'slice-untrusted-verdict', MERGE, merging({ ...SLICE, comments: [gate({ author: 'NONE' })] }));
  add(from, 'slice-lens-only', MERGE, merging({ ...SLICE, comments: [lens()] }));

  from = 'test_slice_verdict_for_an_older_head_or_not_approving_is_refused';
  /** @type {Array<[string, any[]]>} */
  const verdicts = [['old-head', [gate({ head: OLD_HEAD })]], ['newer-old-head', [gate(), gate({ head: OLD_HEAD })]],
    ['request-changes', [gate({ literal: 'REQUEST-CHANGES' })]], ['pending-human', [gate({ literal: 'APPROVE-PENDING-HUMAN' })]],
    ['later-request-changes', [gate(), gate({ literal: 'REQUEST-CHANGES' })]]];
  for (const [n, comments] of verdicts) add(from, 'slice-verdict-' + n, MERGE, merging({ ...SLICE, comments }));

  from = 'test_slice_on_harness_paths_needs_the_closed_lens_at_head';
  /** @type {Array<[string, any[]]>} */
  const lenses = [['no-lens', [gate()]], ['lens-old-head', [gate(), lens({ commit: OLD_HEAD })]],
    ['lens-open', [gate(), lens({ closed: false })]], ['lens-fenced', [gate(), lens({ fenced: true })]],
    ['lens-untrusted', [gate(), lens({ author: 'NONE' })]], ['lens-withdrawn', [gate(), lens(), lens({ closed: false })]],
    ['lens-abbreviated', [gate(), lens({ commit: HEAD.slice(0, 12) })]], ['lens-closed-merges', [gate(), lens()]]];
  for (const [n, comments] of lenses) add(from, 'harness-' + n, MERGE, merging({ ...SLICE, comments }, { changed: HARNESS }));
  // Each member of the harness-path list alone, with no lens: delivery.py refused every one, so a
  // member dropped from the Node list turns its case red here too.
  for (const p of ['.claude/x.md', '.codex/hooks.json', '.github/workflows/tests.yml', '.agents/skills/x/SKILL.md',
    '.kiro/steering/a.md', 'AGENTS.md', 'docs/CLAUDE.md']) {
    add(from, 'harness-only-' + p.split('/')[0].replace(/^\./, '').replace(/\.md$/, ''), MERGE, merging(SLICE, { changed: ['docs/x.md', p] }));
  }

  from = 'test_plugin_brief_shapes_against_this_repository_contract';
  const pluginLens = '<!-- harness-lead-verdict: PR #93 rc/next route - nothing falsifiable-and-false remains -->\ncommit: ' + HEAD + '\n\nScenarios: none open.\n\nthe lens is CLOSED';
  const pl = pluginLens.split('\n');
  add(from, 'plugin-lens-refused', MERGE, merging({ ...SLICE, comments: [gate(), raw(pluginLens)] }, { changed: HARNESS }));
  add(from, 'plugin-lens-with-line-3-merges', MERGE, merging({ ...SLICE, comments: [gate(), raw([...pl.slice(0, 2), 'the lens is CLOSED', ...pl.slice(2, 5)].join('\n'))] }, { changed: HARNESS }));
  const pluginGate = '<!-- gatekeeper-verdict: quality-assurance -->\nAPPROVE-AND-MERGE\nhead: ' + HEAD + '\ncloses: 52\n\n| criterion | verdict |';
  const pg = pluginGate.split('\n');
  add(from, 'plugin-gate-refused', MERGE, merging({ ...SLICE, comments: [raw(pluginGate)] }));
  add(from, 'plugin-gate-with-owner-check-merges', MERGE, merging({ ...SLICE, comments: [raw([...pg.slice(0, 3), 'owner-check: none', ...pg.slice(3)].join('\n'))] }));

  from = 'test_strict_header_spoofs_are_refused';
  const marker = '<!-- harness-lead-verdict: x -->\ncommit: ' + HEAD + '\nthe lens is CLOSED';
  const verdict = '<!-- gatekeeper-verdict: quality-assurance -->\nAPPROVE-AND-MERGE\nhead: ' + HEAD + '\nowner-check: none';
  /** @type {Record<string, any>} */
  const lensSpoofs = {
    'mixed-fences': raw('quoting round 1:\n~~~\n```\n' + marker + '\n~~~'),
    'plain-fence': raw('```\n' + marker + '\n```'),
    blockquote: raw('> ' + marker.replaceAll('\n', '\n> ')),
    indented: raw('    ' + marker.replaceAll('\n', '\n    ')),
    'after-blank-line': raw('\n' + marker),
    negated: lens({ state: 'I cannot say the lens is CLOSED yet' }),
    quoted: lens({ state: '> round 1 said: the lens is CLOSED' }),
    'trailing-text': lens({ state: 'the lens is CLOSED.' }),
    'lower-case': lens({ state: 'the lens is closed' }),
    'closed-below-line-3': raw(marker.replace('the lens is CLOSED', '\nthe lens is CLOSED')),
    'envelope-trailing-text': raw(marker.replace('x -->', 'x --> extra')),
    'envelope-closed-early': raw(marker.replace('x -->', 'x --> y -->')),
    'uppercase-sha': lens({ commit: HEAD.toUpperCase() }),
    'abbreviated-sha': lens({ commit: HEAD.slice(0, 12) }),
    'commit-trailing-text': lens({ commit: HEAD + ' (approx)' }),
    'newer-open-withdraws': [lens(), lens({ closed: false })],
    'newer-malformed': [lens(), raw('<!-- harness-lead-verdict: x -->\ncommit: tbd')],
  };
  for (const [n, s] of Object.entries(lensSpoofs)) add(from, 'lens-spoof-' + n, MERGE, merging({ ...SLICE, comments: [gate(), ...(Array.isArray(s) ? s : [s])] }, { changed: HARNESS }));
  /** @type {Record<string, any>} */
  const gateSpoofs = {
    'prose-approve-under-request-changes': gate({ literal: 'REQUEST-CHANGES', prose: '\nAPPROVE-AND-MERGE would be premature' }),
    'literal-trailing-prose': gate({ literal: 'APPROVE-AND-MERGE would be premature' }),
    'unknown-literal': gate({ literal: 'APPROVE' }),
    'literal-on-line-3': raw(verdict.replace('\nAPPROVE-AND-MERGE\nhead: ' + HEAD, '\nhead: ' + HEAD + '\nAPPROVE-AND-MERGE')),
    'one-line-verdict': raw('<!-- gatekeeper-verdict: quality-assurance --> APPROVE-AND-MERGE\nhead: ' + HEAD + '\nowner-check: none'),
    'fenced': raw('see:\n```\n' + verdict + '\n```'),
    blockquoted: raw('> ' + verdict.replaceAll('\n', '\n> ')),
    'head-trailing-text': gate({ head: HEAD + ' (approx)' }),
    'other-persona': raw(verdict.replace('quality-assurance', 'developer')),
    'later-request-changes': [gate(), gate({ literal: 'REQUEST-CHANGES' })],
    'later-malformed': [gate(), raw('<!-- gatekeeper-verdict: quality-assurance -->\nTBD')],
  };
  for (const [n, s] of Object.entries(gateSpoofs)) add(from, 'gate-spoof-' + n, MERGE, merging({ ...SLICE, comments: Array.isArray(s) ? s : [s] }));
  add(from, 'strict-lf-merges', MERGE, merging({ ...SLICE, comments: [raw(verdict), raw(marker)] }, { changed: HARNESS }));
  add(from, 'strict-crlf-merges', MERGE, merging({ ...SLICE, comments: [raw(verdict.replaceAll('\n', '\r\n')), raw(marker.replaceAll('\n', '\r\n'))] }, { changed: HARNESS }));
  add(from, 'later-approval-supersedes', MERGE, merging({ ...SLICE, comments: [gate({ literal: 'REQUEST-CHANGES' }), gate()] }));
  const quoting = raw('context:\n```\n' + verdict.replace('APPROVE-AND-MERGE', 'REQUEST-CHANGES') + '\n' + marker.replace('CLOSED', 'OPEN') + '\n```');
  add(from, 'quoting-comment-is-no-verdict', MERGE, merging({ ...SLICE, comments: [raw(verdict), raw(marker), quoting] }, { changed: HARNESS }));

  from = 'test_the_retired_boundary_literal_is_refused_at_a_new_head';
  add(from, 'retired-literal', MERGE, merging({ ...SLICE, comments: [gate({ literal: 'APPROVE-AND-MERGE-BOUNDARY' })] }));
  add(from, 'retired-literal-after-approval', MERGE, merging({ ...SLICE, comments: [gate(), gate({ literal: 'APPROVE-AND-MERGE-BOUNDARY' })] }));

  from = 'test_a_verdict_without_its_owner_check_line_is_malformed';
  /** @type {Record<string, string>} */
  const ownerBad = { absent: '', 'blank-line-4': '\nowner-check: none', empty: 'owner-check:', 'empty-space': 'owner-check: ',
    'double-space': 'owner-check:  none', 'trailing-space': 'owner-check: none ', capitalised: 'Owner-check: none',
    'other-key': 'owner check: none', 'closes-on-line-4': 'closes: 52\nowner-check: none', fenced: '```\nowner-check: none\n```' };
  for (const [n, line] of Object.entries(ownerBad)) {
    for (const literal of ['APPROVE-AND-MERGE', 'APPROVE-AND-MERGE-BOUNDARY']) {
      add(from, 'owner-check-' + n + '-' + literal, MERGE, merging({ ...SLICE, comments: [gate({ literal, ownerCheck: line })] }));
    }
  }
  for (const [n, line] of [['none', 'owner-check: none'], ['act', 'owner-check: open /en/ and confirm the new card renders']]) {
    add(from, 'owner-check-good-' + n, MERGE, merging({ ...SLICE, comments: [gate({ ownerCheck: line })] }));
    add(from, 'owner-check-good-' + n + '-crlf', MERGE, merging({ ...SLICE, comments: [raw(gate({ ownerCheck: line }).body.replaceAll('\n', '\r\n'))] }));
  }

  from = 'test_main_calls_every_gate_before_merging';
  const both = ['workspace/delivery.py', 'AGENTS.md'];
  add(from, 'every-gate-stale-head', MERGE, merging({ ...SLICE, headRefOid: OLD_HEAD }));
  add(from, 'every-gate-no-delivery-ci', MERGE, merging({ ...SLICE, statusCheckRollup: SLICE.statusCheckRollup.filter((c) => c.name !== 'delivery-ci') }));
  add(from, 'every-gate-dirty', MERGE, merging({ ...SLICE, mergeStateStatus: 'DIRTY' }));
  add(from, 'every-gate-no-verdict', MERGE, merging({ ...SLICE, comments: [] }));
  add(from, 'every-gate-harness-no-lens', MERGE, merging(SLICE, { changed: both }));
  add(from, 'every-gate-other-branch', MERGE, merging(SLICE, { branch: 'other' }));
  add(from, 'every-gate-not-pushed', MERGE, merging(SLICE, { remoteHead: OLD_HEAD }));
  add(from, 'every-gate-behind', MERGE, merging(SLICE, { behind: 1 }));
  add(from, 'every-gate-calibration-merges', MERGE, merging({ ...SLICE, comments: [gate(), lens()] }, { changed: both }));

  from = 'test_main_still_requires_semver_label_check';
  add(from, 'rc-no-semver-label-check', MERGE, merging({ ...RC, statusCheckRollup: RC.statusCheckRollup.filter((c) => c.name !== 'semver-label') }));

  from = 'test_new_release_with_ancestry_passes';
  add(from, 'rc-verify-published', VERIFY, verifying(RC));
  add(from, 'slice-verify-integrated', VERIFY, verifying(SLICE));

  from = 'test_old_draft_prerelease_and_unrelated_release_block';
  add(from, 'release-old-tag', VERIFY, verifying(RC, { release: { ...RELEASE, tag_name: 'v1.1.0' } }));
  add(from, 'release-prerelease-tag', VERIFY, verifying(RC, { release: { ...RELEASE, tag_name: 'v1.2.0-rc.1' } }));
  add(from, 'release-draft', VERIFY, verifying(RC, { release: { ...RELEASE, draft: true } }));
  add(from, 'release-prerelease', VERIFY, verifying(RC, { release: { ...RELEASE, prerelease: true } }));
  add(from, 'release-unpublished', VERIFY, verifying(RC, { release: { ...RELEASE, published_at: null } }));
  add(from, 'release-diverged', VERIFY, verifying(RC, { comparison: { status: 'diverged' } }));
  add(from, 'release-workflow-failed', VERIFY, verifying(RC, { runs: [{ id: 3, head_sha: HEAD, event: 'pull_request', conclusion: 'failure' }] }));

  // Paths of main() the old suite reached only through a mock, run here through the command itself.
  from = 'main() (no unit case in delivery_test.py)';
  add(from, 'invalid-pr-number', ['merge', '--pr', '0'], merging(SLICE));
  add(from, 'dirty-workspace', MERGE, { ...merging(SLICE), porcelain: ' M AGENTS.md' });
  add(from, 'unsupported-remote', MERGE, { ...merging(SLICE), remote: 'https://example.invalid/o/r.git' });
  add(from, 'gh-fails', MERGE, { ...merging(SLICE), fail: ['gh pr view'] });
  add(from, 'already-merged', MERGE, { ...merging(SLICE), pr: { ...merging(SLICE).pr, state: 'MERGED' } });
  add(from, 'closed-pr', MERGE, { ...merging(SLICE), pr: { ...merging(SLICE).pr, state: 'CLOSED' } });
  add(from, 'verify-not-merged', VERIFY, merging(SLICE));
  add(from, 'usage-no-action', ['--pr', '7'], merging(SLICE), 'argparse usage text is Python-specific');
  add(from, 'usage-bad-action', ['nope', '--pr', '7'], merging(SLICE), 'argparse usage text is Python-specific');
  add(from, 'usage-no-pr', ['merge'], merging(SLICE), 'argparse usage text is Python-specific');
  add(from, 'usage-pr-not-int', ['merge', '--pr', 'x'], merging(SLICE), 'argparse usage text is Python-specific');
  return out;
}
