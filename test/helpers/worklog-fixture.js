// The helpers of the deleted method/scripts/worklog.test.py (#476, S05 of #470), ported line for line so
// its cases run as node:test on the same fixture data (method/scripts/fixtures/worklog/, unchanged), and
// so the golden cases build their inputs the way the Python suite did. Each body is rendered as the
// Python rendered it: json.dumps(event, sort_keys=True), CPython's default separators and ensure_ascii.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loads, dumps, deepCopy, PyFloat } from '../../src/lib/py.js';
import { EVENT_MARKER } from '../../src/commands/worklog.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const FIXTURES = path.join(ROOT, 'method', 'scripts', 'fixtures', 'worklog');
export const CONTRACT = path.join(ROOT, 'method', 'scripts', 'worklog-contract');

/** @typedef {Record<string, any>} Obj */

/** @param {string} name @returns {any} */
export const fixture = (name) => loads(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
/** @type {{ snapshot: Obj, events: Obj[] }} */
export const FIXTURE = /** @type {any} */ (fixture('scenario.json'));

/** json.dumps(v, sort_keys=True) with CPython's defaults. @param {unknown} v */
export const pyDumps = (v) => dumps(v, { separators: [', ', ': '], ensureAscii: true });
/** @param {string} s */
export const sha = (s) => crypto.createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');
/** @param {Obj} event */
export const envelope = (event) => EVENT_MARKER + '\n```json\n' + pyDumps(event) + '\n```';

/**
 * @param {Obj[]} events
 * @param {boolean} [complete]
 * @param {string} [cutoff]
 * @returns {Obj}
 */
export function trackerExport(events, complete = true, cutoff = '2026-10-01T00:00:00Z') {
  const comments = events.map((event, index) => {
    const body = envelope(event);
    return { repository: event.issue.split('#')[0], issue: event.issue, comment_id: index + 1, created_at: event.timestamp,
      updated_at: event.timestamp, body, body_sha256: sha(body) };
  });
  return {
    schema_version: 1, cutoff,
    repositories: [{ repository: 'acme/skills', pagination_complete: complete }, { repository: 'acme/site', pagination_complete: complete }],
    prior_inventory: { complete, comment_ids: comments.map((_, i) => i + 1) }, comments,
  };
}

/** #515: a scenario whose report is COMPLETE (acme/site#8 carries unknown attribution, so it is left out). */
export const CLEAN_SNAPSHOT = { ...deepCopy(FIXTURE.snapshot), counting_units: deepCopy(FIXTURE.snapshot.counting_units.filter((/** @type {Obj} */ u) => u.issue !== 'acme/site#8')) };
export const CLEAN_EVENTS = FIXTURE.events.filter((e) => e.issue !== 'acme/site#8').map((e) => deepCopy(e));

/** @param {Obj} exp @param {string} issue @param {number} commentId @param {string} body */
export function withComment(exp, issue, commentId, body) {
  const result = deepCopy(exp);
  result.comments.push({ repository: issue.split('#')[0], issue, comment_id: commentId, created_at: '2026-09-02T00:00:00Z',
    updated_at: '2026-09-02T00:00:00Z', body, body_sha256: sha(body) });
  result.prior_inventory.comment_ids.push(commentId);
  return result;
}

/**
 * The shape `gh issue view <n> --repo <r> --json url,comments` prints, one capture per Issue.
 * @param {Obj[]} events
 * @returns {[Obj[], number[]]}
 */
export function ghCaptures(events) {
  /** @type {Map<string, Obj>} */
  const captures = new Map();
  /** @type {number[]} */
  const ids = [];
  events.forEach((event, index) => {
    const [repo, number] = event.issue.split('#');
    const url = 'https://github.com/' + repo + '/issues/' + number;
    if (!captures.has(event.issue)) captures.set(event.issue, { url, comments: [] });
    const id = 5000 + index;
    ids.push(id);
    /** @type {Obj} */ (captures.get(event.issue)).comments.push({
      url: url + '#issuecomment-' + id, id: 'IC_' + id, createdAt: event.timestamp, includesCreatedEdit: false,
      author: { login: 'someone' }, body: envelope(event),
    });
  });
  return [[...captures.values()], ids.sort((a, b) => a - b)];
}

/** @param {Obj} source @param {Array<string | number>} at @param {unknown} value */
export function changed(source, at, value) {
  const result = deepCopy(source);
  let target = result;
  for (const key of at.slice(0, -1)) target = target[key];
  target[at[at.length - 1]] = value;
  return result;
}

/** dict(a, **b) of the Python: a shallow copy with b's keys added or replaced. @param {Obj} a @param {Obj} b */
export const merge = (a, b) => ({ ...a, ...b });

/** dict without some keys. @param {Obj} a @param {string[]} keys */
export function without(a, ...keys) {
  const out = { ...a };
  for (const k of keys) delete out[k];
  return out;
}

// #514 lens B1: each private spelling below passed the former word-start, four-token filter.
export const PRIVATE_SPELLINGS = [
  'resume from /tmp/x/continuation-6.md',
  'resume from ~/notes/continuation-6.md',
  'resume from /var/folders/ab/T/continuation-6.md',
  'resume from (/Users/someone/x)',
  'resume from /home/someone/continuation-6.md',
  'resume from /private/var/x',
  'open file:///x/y',
  'read tadeumendonca-io/.brand/positioning.md first',
  'read ../.brand/positioning.md first',
  'read .BRAND/positioning.md',
  'look in the .brand',
  'resume from C:\\Users\\x\\notes.md',
];
export const PUBLIC_SPELLINGS = [
  'open the merge request for the branch at the named commit',
  're-run hooks/scripts/inventory-counts.test.sh',
  'read docs/worklog/README.md',
  'the branding section of README.md, and the .branded-x fixture',
];

/** #76: synthetic values only; the model identifiers are invented. */
export const NATIVE_TOKENS = { usage_provenance: 'native', model: 'model-a-1', effort: 'medium', tokens_input: 1200, tokens_output: 300, credits: null };

/** The retained export of the live #499 correction: two published comments, unchanged fixture files. */
export function liveExport() {
  const published = /** @type {Array<[number, string, string]>} */ ([[5804402298, '2026-09-23T23:04:31Z', 'published-5804402298.md'], [5804452881, '2026-09-23T23:09:16Z', 'published-5804452881.md']]);
  return {
    schema_version: 1, cutoff: '2026-09-24T00:00:00Z', repositories: [{ repository: 'tedeuxx/tadeumendonca-skills', pagination_complete: true }],
    prior_inventory: { complete: true, comment_ids: published.map((p) => p[0]) },
    comments: published.map(([id, at, name]) => {
      const body = fs.readFileSync(path.join(FIXTURES, name), 'utf8').replaceAll('\r\n', '\n');
      return { repository: 'tedeuxx/tadeumendonca-skills', issue: 'tedeuxx/tadeumendonca-skills#499', comment_id: id, created_at: at, updated_at: null, body, body_sha256: sha(body) };
    }),
  };
}

/** The usage scenario of the Python suite: Codex tokens on run-b, Kiro credits on run-c. */
export function usageEvents() {
  const events = deepCopy(CLEAN_EVENTS);
  const byId = Object.fromEntries(events.map((e) => [e.event_id, e]));
  byId['skills-7-accepted'].usage = { ...NATIVE_TOKENS };
  pick(events, (e) => e.issue === 'acme/site#7' && e.event_type === 'outcome').usage = { usage_provenance: 'native', credits: new PyFloat(1.25) };
  return { events, byId };
}


/**
 * The first element pred accepts; a test failure when there is none.
 * @param {Obj[]} items
 * @param {(o: Obj) => boolean} pred
 * @returns {Obj}
 */
export function pick(items, pred) {
  const found = items.find(pred);
  if (!found) throw new Error('no element matches');
  return found;
}
