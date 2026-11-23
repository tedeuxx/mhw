#!/usr/bin/env node
// The review verdicts as commit statuses a GitHub ruleset can require (Issue #591, ADR-0045). It replaces
// the review half of the removed `mhw delivery merge`: the same strict-header reading of the
// quality-assurance verdict and of the agents-lead lens marker, with the same carry-forward rule, but its
// answer is a commit status on the pull request's head instead of a merge. node: modules only.
//
//   review-status.js                 in a workflow: read the event, evaluate, post the statuses
//   review-status.js --pr N --dry-run  from a checkout: evaluate the same way and print, post nothing
//
// It posts three statuses on the head commit the forge reports for the pull request, never on the commit
// of the event that woke it (a re-run after the head moved judges the new head):
//   review/route              a slice comes from its own branch into rc/next; main accepts only rc/next;
//                             a pull request from another repository is refused on both
//   review/quality-assurance  the newest trusted gatekeeper-verdict, in its strict four-line header,
//                             names this head and carries APPROVE-AND-MERGE
//   review/agents-lead        (base rc/next only) no harness path changed, or the newest trusted lens
//                             marker, in its strict three-line header, is CLOSED at this head or carries
//                             forward to it
// A head that moves gets no status until the next run, so a required status is head-scoped by
// construction. Every state is success, pending (the verdict or marker is not posted yet) or failure.
//
// Trust: a comment counts only when GitHub reports its author as OWNER, MEMBER or COLLABORATOR, that is
// anyone with write access. Every persona posts through the owner's account, so a status says "a trusted
// account posted a well-formed verdict at this head", never "this persona reviewed it". ADR-0045 states
// who else can write a status with the same name.
//
// Header formats, unchanged from the removed route (lines compared whole; only a CRLF's CR is removed;
// nothing below the header is read, so a fence, a blockquote or prose can neither supply nor override):
//   quality-assurance  line 1 <!-- gatekeeper-verdict: quality-assurance -->
//                      line 2 APPROVE-AND-MERGE (any other literal refuses; the retired boundary
//                             literal is refused by name)
//                      line 3 head: <full 40-character SHA>
//                      line 4 owner-check: none | <one live act>
//   agents-lead        line 1 <!-- harness-lead-verdict: <one-line summary> -->
//                      line 2 commit: <full 40-character SHA>
//                      line 3 the lens is CLOSED   (anything else: the lens is open)
// A CLOSED marker at an earlier commit carries forward when (a) that commit is an ancestor of the head,
// (b) its merge-bases with the base branch equal the head's, and (c) the delta from it to the head touches
// no harness path. Anything that cannot be read refuses.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toolRunner } from '../../src/lib/gh.js';

export const INTEGRATION = 'rc/next';
export const RELEASE = 'main';
export const BASES = Object.freeze([INTEGRATION, RELEASE]);
export const CONTEXT = Object.freeze({
  route: 'review/route',
  gate: 'review/quality-assurance',
  lens: 'review/agents-lead',
});
export const GATE_PREFIX = '<!-- gatekeeper-verdict';
export const GATE_HEADER = '<!-- gatekeeper-verdict: quality-assurance -->';
export const LENS_PREFIX = '<!-- harness-lead-verdict';
export const LENS_CLOSED = 'the lens is CLOSED';
// The merge-authority contract (v3): one clearance literal; #134's boundary literal is retired.
export const MERGE_LITERALS = Object.freeze(['APPROVE-AND-MERGE']);
export const RETIRED_LITERALS = Object.freeze(['APPROVE-AND-MERGE-BOUNDARY']);
export const TRUSTED_AUTHORS = Object.freeze(['OWNER', 'MEMBER', 'COLLABORATOR']);
// Hold 2's harness paths, at any depth, compared by path component.
export const HARNESS_DIRS = Object.freeze(new Set(['.claude', '.codex', '.github', '.agents', '.kiro']));
export const HARNESS_FILES = Object.freeze(new Set(['AGENTS.md', 'CLAUDE.md']));
// GitHub truncates nothing for us: a status description longer than 140 characters is refused.
export const DESCRIPTION_MAX = 140;

const LENS_HEADER = /^<!-- harness-lead-verdict: (?:(?!-->)[^\n])* -->$/;
const OWNER_CHECK_LINE = /^owner-check: \S(?:.*\S)?$/;
const HEAD_LINE = /^head: ([0-9a-f]{40})$/;
const COMMIT_LINE = /^commit: ([0-9a-f]{40})$/;
const SHA = /^[0-9a-f]{40}$/;
const REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** A refusal with a reason the status carries. `state` is pending or failure. */
export class Refusal extends Error {
  /** @param {string} message @param {'pending' | 'failure'} [state] */
  constructor(message, state = 'failure') {
    super(message);
    this.state = state;
  }
}

/** @param {unknown} v @returns {v is Record<string, any>} */
const isDict = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The body of a comment, or '' when it has none. @param {unknown} c */
const bodyOf = (c) => (isDict(c) && typeof c.body === 'string' ? c.body : '');

/** @param {unknown} c */
export const trusted = (c) => isDict(c) && TRUSTED_AUTHORS.includes(c.authorAssociation);

/**
 * The first lines of a comment, whole, with only a CRLF's trailing CR removed.
 * @param {unknown} comment @param {number} [size]
 */
export function header(comment, size = 3) {
  const lines = bodyOf(comment).split('\n').map((l) => (l.endsWith('\r') ? l.slice(0, -1) : l));
  while (lines.length < size) lines.push('');
  return lines.slice(0, size);
}

/**
 * The newest trusted comment whose FIRST line opens with the gate envelope; a quoted one never counts.
 * @param {unknown[]} comments
 */
export function newestGate(comments) {
  const found = comments.filter((c) => trusted(c) && header(c, 1)[0].startsWith(GATE_PREFIX));
  return found.length ? found[found.length - 1] : null;
}

/**
 * The newest lens marker, selected as the quality-assurance brief selects it: a trusted comment that does
 * not open with the gate envelope and has a line opening with the lens envelope at column 0 outside a
 * fenced code block. Selection is broad so a newer marker with a preamble still withdraws an older CLOSED
 * one; lensDecision then requires the strict header, so that marker refuses.
 * @param {unknown[]} comments
 */
export function newestLens(comments) {
  const found = comments.filter((c) => {
    if (!trusted(c)) return false;
    const body = bodyOf(c);
    if (body.startsWith(GATE_PREFIX)) return false;
    let fenced = false;
    for (const raw of body.split('\n')) {
      const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
      if (/^ {0,3}(```|~~~)/.test(line)) fenced = !fenced;
      else if (!fenced && line.startsWith(LENS_PREFIX)) return true;
    }
    return false;
  });
  return found.length ? found[found.length - 1] : null;
}

/**
 * The quality-assurance status: the newest verdict must be well formed, name this head and authorize it.
 * Newest wins whatever it says, so a later REQUEST-CHANGES or a malformed verdict withdraws an approval.
 * @param {unknown[]} comments @param {string} head
 * @returns {string} the success description
 */
export function gateDecision(comments, head) {
  const verdict = newestGate(comments);
  if (verdict === null) throw new Refusal('no quality-assurance gatekeeper-verdict on the PR', 'pending');
  const [envelope, literal, headLine, ownerCheck] = header(verdict, 4);
  const named = HEAD_LINE.exec(headLine);
  if (envelope !== GATE_HEADER || !named) throw new Refusal('the newest gatekeeper-verdict is not in the strict header format');
  if (!OWNER_CHECK_LINE.test(ownerCheck)) {
    throw new Refusal('the newest gatekeeper-verdict has no owner-check line on line 4 (malformed)');
  }
  if (named[1] !== head) throw new Refusal('the newest gatekeeper-verdict does not name the current head', 'pending');
  if (RETIRED_LITERALS.includes(literal)) {
    throw new Refusal('the newest gatekeeper-verdict carries the retired literal ' + literal);
  }
  if (!MERGE_LITERALS.includes(literal)) {
    throw new Refusal('the newest gatekeeper-verdict does not authorize a merge: ' + literal.slice(0, 40));
  }
  return 'APPROVE-AND-MERGE at this head';
}

/** The paths that are harness paths. @param {string[]} paths */
export function harnessPaths(paths) {
  return paths.filter((p) => {
    // A path git quoted cannot be read by component, so it counts as a harness path (fail closed). The
    // diffs run with -z, which quotes nothing, so this is defence in depth.
    if (p.startsWith('"')) return true;
    const parts = p.split('/');
    return parts.slice(0, -1).some((x) => HARNESS_DIRS.has(x)) || HARNESS_FILES.has(parts[parts.length - 1]);
  });
}

/**
 * @typedef {{ isAncestor: (commit: string, head: string) => number, mergeBase: (ref: string) => string,
 *   delta: (commit: string, head: string) => string[], base: string }} History
 */

/**
 * Whether a CLOSED lens at commit carries forward to head; null when it does, else the reason.
 * @param {string} commit @param {string} head @param {History} history
 */
export function carryForward(commit, head, history) {
  const ancestor = history.isAncestor(commit, head);
  if (ancestor === 1) return '(a) its commit is not an ancestor of the head';
  if (ancestor !== 0) return '(a) its commit cannot be read in this checkout';
  if (history.mergeBase(commit) !== history.mergeBase(head)) return '(b) the merge-base with ' + history.base + ' moved since its commit';
  const touched = harnessPaths(history.delta(commit, head));
  if (touched.length) return '(c) the delta since its commit touches a harness path: ' + touched[0];
  return null;
}

/**
 * The agents-lead status: success when no harness path changed; otherwise the newest lens marker must be
 * CLOSED at this head, or at an earlier commit it carries forward from. A newer open marker withdraws an
 * earlier closed one.
 * @param {unknown[]} comments @param {string} head @param {string[]} paths @param {History} history
 * @returns {string} the success description
 */
export function lensDecision(comments, head, paths, history) {
  if (!harnessPaths(paths).length) return 'no harness path changed; no lens is required';
  const marker = newestLens(comments);
  if (marker === null) throw new Refusal('harness paths changed and no agents-lead lens marker is on the PR', 'pending');
  const [envelope, commitLine, state] = header(marker);
  const named = COMMIT_LINE.exec(commitLine);
  if (!LENS_HEADER.test(envelope) || !named) throw new Refusal('the newest agents-lead lens marker is not in the strict header format');
  if (named[1] === head) {
    if (state !== LENS_CLOSED) throw new Refusal('the newest agents-lead lens marker at this head does not say the lens is CLOSED');
    return 'the lens is CLOSED at this head';
  }
  if (state !== LENS_CLOSED) throw new Refusal('the newest agents-lead lens marker does not name the current head', 'pending');
  const reason = carryForward(named[1], head, history);
  if (reason !== null) throw new Refusal('the lens marker does not carry forward: ' + reason, 'pending');
  return 'the lens is CLOSED at ' + named[1].slice(0, 12) + ' and carries forward';
}

/**
 * The route status: a slice into rc/next from its own branch; into main only the release candidate.
 * @param {Record<string, any>} pr
 * @returns {string} the success description
 */
export function routeDecision(pr) {
  if (pr.isCrossRepository !== false) throw new Refusal('a pull request from another repository is not delivered');
  if (pr.baseRefName === RELEASE) {
    if (pr.headRefName !== INTEGRATION) throw new Refusal('only the rc/next release candidate may target main; open the slice against rc/next');
    return 'the release candidate, rc/next into main';
  }
  if (pr.baseRefName === INTEGRATION) {
    if (BASES.includes(pr.headRefName)) throw new Refusal('a slice must come from its own feature branch');
    return 'a slice from its own branch into rc/next';
  }
  throw new Refusal('the base is neither rc/next nor main');
}

/**
 * @typedef {{ context: string, state: 'success' | 'pending' | 'failure', description: string }} Status
 */

/** @param {string} context @param {() => string} decide @returns {Status} */
function judge(context, decide) {
  try {
    return { context, state: 'success', description: fit(decide()) };
  } catch (e) {
    if (e instanceof Refusal) return { context, state: e.state, description: fit(e.message) };
    throw e;
  }
}

/** A description GitHub accepts. @param {string} s */
export const fit = (s) => (s.length <= DESCRIPTION_MAX ? s : s.slice(0, DESCRIPTION_MAX - 3) + '...');

/**
 * Every status for one pull request. paths and history are read only when the lens is evaluated.
 * @param {{ pr: Record<string, any>, paths: () => string[], history: History }} input
 * @returns {Status[]}
 */
export function evaluate({ pr, paths, history }) {
  const head = pr.headRefOid;
  if (typeof head !== 'string' || !SHA.test(head)) throw new Error('the pull request has no readable head');
  const comments = Array.isArray(pr.comments) ? pr.comments : [];
  const out = [judge(CONTEXT.route, () => routeDecision(pr)), judge(CONTEXT.gate, () => gateDecision(comments, head))];
  // Hold 2 is checked on slices, as the removed route checked it; the release candidate is not lens-gated.
  if (pr.baseRefName === INTEGRATION) out.push(judge(CONTEXT.lens, () => lensDecision(comments, head, paths(), history)));
  return out;
}

/** The paths of a NUL-terminated `--name-only -z` list. @param {string} out */
export const nulNames = (out) => out.split('\0').filter((p) => p !== '');

/**
 * @typedef {import('../../src/lib/gh.js').ToolRunner} ToolRunner
 * @typedef {{ argv: string[], env: Record<string, string | undefined>, cwd: string, exec?: ToolRunner,
 *   readEvent?: (file: string) => string }} Options
 */

/** @param {ToolRunner} exec @param {string} tool @param {string[]} args */
function run(exec, tool, args) {
  const r = exec(tool, args);
  if (r.error || r.code) throw new Error(tool + ' ' + args[0] + ' failed');
  return r.stdout;
}

/** @param {ToolRunner} exec @param {string} base @returns {History} */
export function gitHistory(exec, base) {
  return {
    base,
    isAncestor: (commit, to) => {
      const r = exec('git', ['merge-base', '--is-ancestor', commit, to]);
      return r.error ? 2 : r.code;
    },
    mergeBase: (ref) => {
      // A criss-cross history has several best ancestors and git prints them in no promised order, so the
      // set is sorted before two of them are compared.
      const set = run(exec, 'git', ['merge-base', '--all', 'origin/' + base, ref]).split('\n').map((s) => s.trim()).filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      if (!set.length) throw new Refusal('cannot read the merge-base with ' + base);
      return set.join(' ');
    },
    delta: (commit, to) => nulNames(run(exec, 'git', ['diff', '--no-renames', '--name-only', '-z', commit, to])),
  };
}

/**
 * The repository and pull request a run is about: from --pr in a dry run, else from the event payload.
 * @param {Options} o @returns {{ repo: string, number: string, dryRun: boolean } | null}
 */
export function target(o) {
  const dryRun = o.argv.includes('--dry-run');
  const at = o.argv.indexOf('--pr');
  const repo = o.env.GITHUB_REPOSITORY || '';
  if (at >= 0) {
    const n = o.argv[at + 1] || '';
    if (!/^[1-9][0-9]*$/.test(n)) throw new Error('--pr needs a pull request number');
    return { repo, number: n, dryRun };
  }
  const file = o.env.GITHUB_EVENT_PATH;
  if (!file) throw new Error('no --pr and no GITHUB_EVENT_PATH');
  const event = JSON.parse((o.readEvent || ((f) => fs.readFileSync(f, 'utf8')))(file));
  if (isDict(event.pull_request)) return { repo, number: String(event.pull_request.number), dryRun };
  // issue_comment: only a comment on a pull request is a review event.
  if (isDict(event.issue) && isDict(event.issue.pull_request)) return { repo, number: String(event.issue.number), dryRun };
  return null;
}

/** The owner/name of origin, for a dry run outside a workflow. @param {ToolRunner} exec */
function originRepo(exec) {
  const url = run(exec, 'git', ['remote', 'get-url', 'origin']).trim().replace(/\.git$/, '');
  const m = /^(?:https:\/\/github\.com\/|git@github\.com:)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/.exec(url);
  if (!m) throw new Error('origin is not a GitHub repository URL');
  return m[1];
}

/**
 * One run. Returns the exit code and the lines it printed.
 * @param {Options} o @returns {{ code: number, lines: string[] }}
 */
export function main(o) {
  const exec = o.exec || toolRunner(o.cwd, o.env, process.platform);
  /** @type {string[]} */
  const lines = [];
  const t = target(o);
  if (t === null) return { code: 0, lines: ['not a pull request event; nothing to judge'] };
  const repo = t.repo || originRepo(exec);
  if (!REPO.test(repo)) throw new Error('not a repository name');
  const pr = JSON.parse(run(exec, 'gh', ['pr', 'view', t.number, '--repo', repo, '--json',
    'headRefOid,headRefName,baseRefName,isCrossRepository,state,comments']));
  if (!isDict(pr)) throw new Error('the pull request view is not an object');
  if (pr.state !== 'OPEN') return { code: 0, lines: ['PR #' + t.number + ' is ' + pr.state + '; nothing to judge'] };
  if (!BASES.includes(pr.baseRefName)) return { code: 0, lines: ['PR #' + t.number + ' targets another base; nothing to judge'] };
  const head = String(pr.headRefOid);
  if (!SHA.test(head)) throw new Error('the pull request has no readable head');
  // Objects only: the head's commits are fetched to read the history, never checked out or run.
  run(exec, 'git', ['fetch', '--no-tags', '--quiet', 'origin', '+refs/heads/' + pr.baseRefName + ':refs/remotes/origin/' + pr.baseRefName,
    '+refs/pull/' + t.number + '/head:refs/remotes/review/' + t.number]);
  if (run(exec, 'git', ['rev-parse', 'refs/remotes/review/' + t.number]).trim() !== head) {
    return { code: 1, lines: ['the head moved while it was read; the next event judges it'] };
  }
  const statuses = evaluate({
    pr,
    paths: () => nulNames(run(exec, 'git', ['diff', '--no-renames', '--name-only', '-z', 'origin/' + pr.baseRefName + '...' + head])),
    history: gitHistory(exec, pr.baseRefName),
  });
  for (const s of statuses) {
    lines.push(s.context + ' ' + s.state + ': ' + s.description);
    if (t.dryRun) continue;
    const args = ['api', '--method', 'POST', 'repos/' + repo + '/statuses/' + head,
      '-f', 'state=' + s.state, '-f', 'context=' + s.context, '-f', 'description=' + s.description];
    if (o.env.GITHUB_SERVER_URL && o.env.GITHUB_RUN_ID) {
      args.push('-f', 'target_url=' + o.env.GITHUB_SERVER_URL + '/' + repo + '/actions/runs/' + o.env.GITHUB_RUN_ID);
    }
    run(exec, 'gh', args);
  }
  lines.push((t.dryRun ? 'dry run, nothing posted: ' : 'posted on ') + head);
  return { code: statuses.every((s) => s.state === 'success') ? 0 : 1, lines };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const r = main({ argv: process.argv.slice(2), env: process.env, cwd: process.cwd() });
    for (const l of r.lines) fs.writeSync(1, l + '\n');
    // A run that posted a refusal has done its job: the status carries it. Only a dry run exits 1 on one.
    process.exitCode = r.code && process.argv.includes('--dry-run') ? 1 : 0;
  } catch (e) {
    fs.writeSync(2, 'review-status: ' + (e instanceof Error ? e.message : 'failed') + '\n');
    process.exitCode = 2;
  }
}
