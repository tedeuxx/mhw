// The worklog skill (#594, CLI native baseline PRD section 5): `mhw worklog` left the CLI and the method
// skill method/skills/worklog/SKILL.md records the event from each agent harness's own session log. This
// suite runs the skill's own blocks, read out of SKILL.md, on synthetic logs in a throwaway HOME, and
// validates what they produce against method/scripts/worklog-contract/event.schema.json (the contract,
// unchanged) with test/helpers/json-schema.js. Every value is synthetic.
//
// Mutation calibration (#594, one time, on a scratch copy of the tree: each mutation applied, the suite run
// red, the source restored, the suite run green again; nothing re-runs them). Each mutates the SOURCE:
//   1. SKILL.md claude-code block: `group_by(.message.id) | map(last.message)` -> `map(.message)` (no dedupe)
//   2. SKILL.md claude-code block: `+ (.cache_read_input_tokens // 0)` dropped
//   3. SKILL.md codex block: usage_provenance always "native" (the total-only check dropped)
//   4. SKILL.md kiro block: credits `($c | add)` -> `($c | length)`
//   5. SKILL.md event template: `"schema_version": 1` -> `"schema_version": "1"`
//   6. src/cli.js: a `worklog` entry put back in MOVED
//   7. SKILL.md sum block: `native` counts every record
//   8. SKILL.md claude-code block: effort always null
//   9. src/commands/launch-line.js (test/helpers/strict-private.js since #599): '/tmp/' dropped from the strict filter
//  10. test/helpers/json-schema.js: additionalProperties no longer asserted (the negative controls go red)
//  11. test/helpers/json-schema.js: the keys compared unsorted in `const` (the key-order control goes red)
//  12. SKILL.md check block: '/tmp/|' dropped from the pattern (the check-block test goes red)
//  13. SKILL.md check block: the corrected_event fields dropped from the list (same test)
//  14. SKILL.md kiro block: `select(.unit == "credit")` dropped (the Kiro test goes red: a request unit is summed)
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { validate } from '../helpers/json-schema.js';
import { which } from '../helpers/home.js';
import { strictPrivate } from '../helpers/strict-private.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// Read with LF line ends: the Windows runners check out with core.autocrlf=true, so the file arrives with
// CRLF there and the block and template boundaries below are LF-delimited.
const SKILL = fs.readFileSync(path.join(ROOT, 'method', 'skills', 'worklog', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
const SCHEMA = JSON.parse(fs.readFileSync(path.join(ROOT, 'method', 'scripts', 'worklog-contract', 'event.schema.json'), 'utf8'));
const FIXTURES = path.join(ROOT, 'method', 'scripts', 'fixtures', 'worklog');
const MARKER = '<!-- worklog-event:v1 -->';
const JQ = which('jq');
const SH = process.platform === 'win32' ? null : which('sh');
const NEED = !JQ || !SH ? 'needs sh and jq on PATH (POSIX)' : false;
const cleanups = /** @type {Array<() => void>} */ ([]);
after(() => cleanups.forEach((c) => c()));

/** The body of the fenced block whose first line is `first` (that line excluded). @param {string} first */
function block(first) {
  const lines = SKILL.split('\n');
  const at = lines.indexOf(first);
  assert.ok(at > 0 && /^```/.test(lines[at - 1]), 'SKILL.md has no block opening with ' + first);
  const end = lines.indexOf('```', at);
  return lines.slice(at + 1, end).join('\n');
}

/** The skill's event template: the one ```json block. */
function template() {
  const m = /\n```json\n(\{[\s\S]*?\n\})\n```\n/.exec(SKILL);
  assert.ok(m, 'SKILL.md has no json event template');
  return m[1];
}

function fresh() {
  const d = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-594-')));
  cleanups.push(() => fs.rmSync(d, { recursive: true, force: true }));
  return d;
}

/** @param {string} file @param {string} text */
function put(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
}

/** Run a skill block under sh with a throwaway HOME. @param {string} script @param {Record<string, string>} env @param {string} home */
function run(script, env, home) {
  const p = spawnSync(/** @type {string} */ (SH), ['-c', script], {
    encoding: 'utf8', cwd: home,
    env: { PATH: process.env.PATH || '', HOME: home, ...env },
  });
  assert.equal(p.status, 0, 'block failed: ' + p.stderr);
  return JSON.parse(p.stdout);
}

/** @param {unknown} usage @param {string} type */
const withUsage = (usage, type = 'checkpoint') => ({ ...JSON.parse(fill(template())), event_type: type, usage });

/** Fill the template's placeholders with synthetic values. @param {string} t */
function fill(t) {
  const values = {
    '<repo>-<n>-<event type>-<UTC time, digits only>': 'site-7-checkpoint-20261124t100000z',
    '<owner/repo>#<n>': 'acme/site#7',
    '<UTC time, RFC 3339, such as 2026-11-24T10:00:00Z>': '2026-11-24T10:00:00Z',
    '<the stage: build, review, intake, ...>': 'build',
    '<the session id>': 'run-a',
    '<initial, or the retry\'s name>': 'initial',
    '<Claude Code, Codex or Kiro>': 'Claude Code',
    '<the harness version it reports>': '2.1.331',
    '<the workstation release>': '11.0.0',
    '<its commit, or unknown>': 'unknown',
    '<the persona, or orchestrator>': 'orchestrator',
    '<owner/repo>': 'acme/site',
    '<branch>': 'loop/7-example',
    '<the full or short SHA>': '0123abc',
    '<a public reference: the pull request URL, a check run, a verdict comment>': 'https://github.com/acme/site/pull/8',
    '<where the item is>': 'in review',
  };
  let out = t;
  for (const [k, v] of Object.entries(values)) out = out.split(k).join(v);
  assert.ok(!/<[^>]+>/.test(out), 'a placeholder is left unfilled: ' + out);
  return out;
}

/** A Claude Code assistant log line. @param {string} id @param {string} model @param {Record<string, number>} usage */
const ccLine = (id, model, usage) => JSON.stringify({ type: 'assistant', message: { id, model, role: 'assistant', content: [{ type: 'text', text: 'SECRET-PROSE' }], usage } }) + '\n';

test('Claude Code: deduplicated by message, cache tokens counted, subagent logs summed, effort read', { skip: NEED }, () => {
  const home = fresh();
  const dir = path.join(home, '.claude', 'projects', '-x-site');
  const u1 = { input_tokens: 3, cache_creation_input_tokens: 100, cache_read_input_tokens: 1000, output_tokens: 20 };
  const u2 = { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 500, output_tokens: 7 };
  // m1 is written twice (one line per content block): it must count once.
  put(path.join(dir, 'sess-1.jsonl'), ccLine('m1', 'claude-opus-5-5', u1) + ccLine('m1', 'claude-opus-5-5', u1) + JSON.stringify({ type: 'user', message: { content: 'x' } }) + '\n'
    + ccLine('m0', '<synthetic>', { input_tokens: 0, output_tokens: 0 }));
  put(path.join(dir, 'sess-1', 'subagents', 'agent-a1.jsonl'), ccLine('m2', 'claude-opus-5-5', u2));
  put(path.join(dir, 'other-session.jsonl'), ccLine('m9', 'claude-opus-5-5', { input_tokens: 999999, output_tokens: 999999 }));
  const usage = run(block('# worklog-usage: claude-code'), { CLAUDE_CODE_SESSION_ID: 'sess-1', CLAUDE_EFFORT: 'medium' }, home);
  assert.deepEqual(usage, { usage_provenance: 'native', model: 'claude-opus-5-5', effort: 'medium', tokens_input: 1605, tokens_output: 27, credits: null });
  assert.deepEqual(validate(SCHEMA, withUsage(usage)), []);
  assert.ok(!JSON.stringify(usage).includes('SECRET-PROSE'), 'prose left the log');
});

test('Claude Code: two models leave the model null; no session id is unavailable', { skip: NEED }, () => {
  const home = fresh();
  const dir = path.join(home, '.claude', 'projects', '-x-site');
  put(path.join(dir, 's2.jsonl'), ccLine('a', 'claude-opus-5-5', { input_tokens: 1, output_tokens: 1 }));
  put(path.join(dir, 's2', 'subagents', 'agent-b.jsonl'), ccLine('b', 'claude-haiku-4-5', { input_tokens: 1, output_tokens: 1 }));
  const two = run(block('# worklog-usage: claude-code'), { CLAUDE_CODE_SESSION_ID: 's2' }, home);
  assert.equal(two.model, null);
  assert.equal(two.effort, null);
  assert.equal(two.tokens_input, 2);
  const none = run(block('# worklog-usage: claude-code'), {}, home);
  assert.deepEqual(none, { usage_provenance: 'unavailable', model: null, effort: null, tokens_input: null, tokens_output: null, credits: null });
  assert.deepEqual(validate(SCHEMA, withUsage(none, 'outcome')).filter((e) => e.includes('usage')), []);
});

/** A Codex rollout. @param {Record<string, number>} total */
const rollout = (total) => [
  { type: 'session_meta', payload: { id: 't-1', cli_version: '0.163.0' } },
  { type: 'turn_context', payload: { model: 'gpt-old', effort: 'low' } },
  { type: 'event_msg', payload: { type: 'token_count', info: null } },
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 10, cached_input_tokens: 5, output_tokens: 1, total_tokens: 11 } } } },
  { type: 'turn_context', payload: { model: 'gpt-5.6-sol', effort: 'medium' } },
  { type: 'event_msg', payload: { type: 'token_count', info: { total_token_usage: total } } },
].map((o) => JSON.stringify(o)).join('\n') + '\n';

test('Codex: the last total and the last turn, read from the thread\'s own rollout', { skip: NEED }, () => {
  const home = fresh();
  const s = path.join(home, '.codex', 'sessions', '2026', '11', '24');
  put(path.join(s, 'rollout-2026-11-24T10-00-00-t-1.jsonl'), rollout({ input_tokens: 254357, cached_input_tokens: 215552, output_tokens: 1819, total_tokens: 256176 }));
  put(path.join(s, 'rollout-2026-11-24T11-00-00-t-2.jsonl'), rollout({ input_tokens: 9, output_tokens: 9, total_tokens: 18 }));
  const usage = run(block('# worklog-usage: codex'), { CODEX_THREAD_ID: 't-1' }, home);
  assert.deepEqual(usage, { usage_provenance: 'native', model: 'gpt-5.6-sol', effort: 'medium', tokens_input: 254357, tokens_output: 1819, credits: null });
  assert.deepEqual(validate(SCHEMA, withUsage(usage, 'handoff')).filter((e) => e.includes('usage')), []);
  const viaHome = run(block('# worklog-usage: codex'), { CODEX_THREAD_ID: 't-2', CODEX_HOME: path.join(home, '.codex') }, home);
  assert.equal(viaHome.tokens_input, 9);
});

test('Codex: a total-only rollout and a missing thread id are unavailable, never a guess', { skip: NEED }, () => {
  const home = fresh();
  const s = path.join(home, '.codex', 'sessions', '2026', '11', '24');
  put(path.join(s, 'rollout-x-t-3.jsonl'), rollout({ input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 8352 }));
  const unavailable = { usage_provenance: 'unavailable', model: 'gpt-5.6-sol', effort: 'medium', tokens_input: null, tokens_output: null, credits: null };
  assert.deepEqual(run(block('# worklog-usage: codex'), { CODEX_THREAD_ID: 't-3' }, home), unavailable);
  const none = run(block('# worklog-usage: codex'), {}, home);
  assert.equal(none.usage_provenance, 'unavailable');
  assert.deepEqual(validate(SCHEMA, withUsage(unavailable)), []);
});

test('Kiro: credits summed over the turns of the named session, model from session.json, no tokens', { skip: NEED }, () => {
  const home = fresh();
  /** @param {string} id @param {number[]} credits */
  const session = (id, credits) => {
    const d = path.join(home, '.kiro', 'sessions', 'abc123', 'sess_' + id);
    put(path.join(d, 'session.json'), JSON.stringify({ id: 'sess_' + id, modelId: 'claude-sonnet-4.5', workspacePaths: ['/w'] }));
    put(path.join(d, 'messages.jsonl'), [{ id: 1, payload: { type: 'user', content: 'SECRET-PROSE' } },
      ...credits.map((c) => ({ id: 2, payload: { type: 'usage_summary', promptTurnSummaries: [{ unit: 'credit', unitPlural: 'credits', usage: c }, { unit: 'request', unitPlural: 'requests', usage: 100 }] } }))]
      .map((o) => JSON.stringify(o)).join('\n') + '\n');
  };
  session('k-1', [0.25, 0.5]);
  session('k-2', [7]);
  const want = { usage_provenance: 'native', model: 'claude-sonnet-4.5', effort: null, tokens_input: null, tokens_output: null, credits: 0.75 };
  assert.deepEqual(run(block('# worklog-usage: kiro'), { KIRO_SESSION_ID: 'sess_k-1' }, home), want);
  assert.deepEqual(run(block('# worklog-usage: kiro'), { KIRO_SESSION_ID: 'k-1' }, home), want);
  assert.equal(run(block('# worklog-usage: kiro'), {}, home).usage_provenance, 'unavailable');
  assert.deepEqual(validate(SCHEMA, withUsage(want, 'outcome')).filter((e) => e.includes('usage')), []);
});

test('the template, joined with a usage record by the skill\'s join block, is a valid event', { skip: NEED }, () => {
  const scratch = fresh();
  const usage = { usage_provenance: 'native', model: 'claude-opus-5-5', effort: 'medium', tokens_input: 1605, tokens_output: 27, credits: null };
  put(path.join(scratch, 'worklog-usage.json'), JSON.stringify(usage, null, 2) + '\n');
  put(path.join(scratch, 'worklog-event.json'), fill(template()));
  const joined = run(block('# worklog-join').split('<scratchpad>').join(scratch), {}, scratch);
  assert.deepEqual(validate(SCHEMA, joined), []);
  assert.deepEqual(joined.usage, usage);
  assert.equal(joined.event_type, 'checkpoint');
  const handoff = { ...joined, event_type: 'handoff', next_act: 'Run the suite on the pull request head.' };
  assert.deepEqual(validate(SCHEMA, handoff), []);
});

test('the sum block reads the posted envelopes and ignores prose and other comments', { skip: NEED }, () => {
  const home = fresh();
  const event = (/** @type {unknown} */ usage) => MARKER + '\n```json\n' + JSON.stringify(withUsage(usage), null, 2) + '\n```\n';
  const comments = [
    { body: event({ usage_provenance: 'native', model: 'm', effort: null, tokens_input: 100, tokens_output: 10, credits: null }) },
    { body: event({ usage_provenance: 'native', model: 'k', effort: null, tokens_input: null, tokens_output: null, credits: 0.5 }) },
    { body: event({ usage_provenance: 'unavailable', model: null, effort: null, tokens_input: null, tokens_output: null, credits: null }) },
    { body: 'the `' + MARKER + '` marker in prose, and a {"usage": {"tokens_input": 999}} object' },
    { body: MARKER + '\n```json\n{ not json }\n```\n' },
  ];
  const bin = path.join(home, 'bin');
  put(path.join(bin, 'gh'), '#!/bin/sh\ncat "' + path.join(home, 'comments.json') + '"\n');
  fs.chmodSync(path.join(bin, 'gh'), 0o755);
  put(path.join(home, 'comments.json'), JSON.stringify({ comments }));
  const script = block('# worklog-sum').split('<n>').join('7').split('<owner/repo>').join('acme/site');
  const p = spawnSync(/** @type {string} */ (SH), ['-c', script], { encoding: 'utf8', env: { PATH: bin + ':' + (process.env.PATH || ''), HOME: home } });
  assert.equal(p.status, 0, p.stderr);
  assert.deepEqual(JSON.parse(p.stdout), { records: 3, native: 2, tokens_input: 100, tokens_output: 10, credits: 0.5 });
});

test('the validator refuses what the contract refuses (negative controls)', () => {
  const ok = JSON.parse(fill(template()));
  assert.deepEqual(validate(SCHEMA, ok), []);
  const native = { usage_provenance: 'native', model: null, effort: null, tokens_input: 1, tokens_output: null, credits: null };
  /** @type {Array<[string, unknown]>} */
  const bad = [
    ['usage on implementation_start', { ...ok, event_type: 'implementation_start', frozen_estimate: { points: 3, provenance: 'p', commitment_points: 3 }, usage: native }],
    ['unavailable with a number', { ...ok, usage: { ...native, usage_provenance: 'unavailable' } }],
    ['native with no number', { ...ok, usage: { ...native, tokens_input: null } }],
    ['a key the usage object does not have', { ...ok, usage: { ...native, note: 'x' } }],
    ['tokens as a string', { ...ok, usage: { ...native, tokens_input: '1' } }],
    ['a model with a space', { ...ok, usage: { ...native, model: 'two words' } }],
    ['a machine-local path in evidence', { ...ok, evidence: ['see /Users/someone/x'] }],
    ['next_act on an outcome', { ...ok, event_type: 'outcome', outcome: 'cancelled', next_act: 'x' }],
    ['schema_version as a string', { ...ok, schema_version: '1' }],
    ['a missing handoff', Object.fromEntries(Object.entries(ok).filter(([k]) => k !== 'handoff'))],
  ];
  for (const [why, event] of bad) assert.notDeepEqual(validate(SCHEMA, event), [], why + ' was accepted');
  // const compares JSON values: key order does not matter, a different key or value does.
  assert.deepEqual(validate({ const: { a: 1, b: 2 } }, { b: 2, a: 1 }), []);
  assert.notDeepEqual(validate({ const: { a: 1, b: 2 } }, { a: 1, c: 2 }), []);
  assert.notDeepEqual(validate({ const: { a: 1, b: 2 } }, { a: 1, b: 3 }), []);
});

test('the published events (retained history) are valid against the schema', () => {
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.md'));
  assert.ok(files.length >= 2);
  let n = 0;
  for (const f of files) {
    const body = fs.readFileSync(path.join(FIXTURES, f), 'utf8');
    for (const m of body.matchAll(/<!-- worklog-event:v1 -->\s*```json\s*(\{[\s\S]*?\})\s*```/g)) {
      assert.deepEqual(validate(SCHEMA, JSON.parse(m[1])), [], f);
      n++;
    }
  }
  assert.ok(n >= 3, 'read ' + n + ' events');
});

// Ported from the deleted test/method/worklog.test.js (#476): the schema's two privacy patterns refuse
// these spellings, and the strict filter's reference copy (test/helpers/strict-private.js since #599) agrees with the schema's next_act pattern.
const PRIVATE_SPELLINGS = ['resume from /tmp/x/c.md', 'resume from ~/notes/c.md', 'resume from /var/folders/ab/T/c.md',
  'resume from (/Users/someone/x)', 'resume from /home/someone/c.md', 'resume from /private/var/x', 'open file:///x/y',
  'read site/.brand/positioning.md first', 'read ../.brand/positioning.md first', 'read .BRAND/positioning.md', 'look in the .brand',
  'resume from C:\\Users\\x\\notes.md'];
const PUBLIC_SPELLINGS = ['open the merge request for the branch at the named commit', 're-run the suite',
  'read docs/worklog/README.md', 'the branding section of README.md, and the .branded-x fixture'];

test('the schema refuses machine-local next_act spellings, and the strict filter agrees with it', () => {
  const ok = JSON.parse(fill(template()));
  const strict = new RegExp(SCHEMA.properties.next_act.allOf[2].not.pattern, 'u');
  for (const text of PRIVATE_SPELLINGS) {
    assert.notDeepEqual(validate(SCHEMA, { ...ok, event_type: 'handoff', next_act: text }), [], text);
    assert.equal(strictPrivate(text), true, text);
  }
  for (const text of PUBLIC_SPELLINGS) {
    assert.deepEqual(validate(SCHEMA, { ...ok, event_type: 'handoff', next_act: text, evidence: [text] }), [], text);
    assert.equal(strictPrivate(text), false, text);
  }
  for (const text of [...PRIVATE_SPELLINGS, ...PUBLIC_SPELLINGS]) assert.equal(strictPrivate(text), strict.test(text), text);
});

// B1 of the gate on PR #613: the check block between the join and the post refuses the strict
// private-path filter in every free-text field that is posted, in the event and in a correction's
// corrected_event, and passes public text. Table-driven: every spelling through every field.
const CHECK_FIELDS = /** @type {Array<[string, (e: Record<string, any>, t: string) => void]>} */ ([
  ['evidence', (e, t) => { e.evidence = ['https://github.com/acme/site/pull/8', t]; }],
  ['acceptance_evidence', (e, t) => { e.acceptance_evidence = [t]; }],
  ['next_act', (e, t) => { e.next_act = t; }],
  ['corrected_event.evidence', (e, t) => { e.corrected_event = { evidence: [t] }; }],
  ['corrected_event.acceptance_evidence', (e, t) => { e.corrected_event = { acceptance_evidence: [t] }; }],
  ['corrected_event.next_act', (e, t) => { e.corrected_event = { next_act: t }; }],
]);

test('the check block refuses private spellings in every posted field and passes public ones', { skip: NEED }, () => {
  const scratch = fresh();
  const script = block('# worklog-check').split('<scratchpad>').join(scratch);
  const base = JSON.parse(fill(template()));
  const check = (/** @type {Record<string, any>} */ event) => {
    put(path.join(scratch, 'worklog-event.json'), JSON.stringify(event));
    return spawnSync(/** @type {string} */ (SH), ['-c', script], { encoding: 'utf8', env: { PATH: process.env.PATH || '', HOME: scratch } });
  };
  assert.equal(check(base).status, 0, 'the clean template is refused');
  for (const [field, set] of CHECK_FIELDS) {
    for (const text of PRIVATE_SPELLINGS) {
      const e = structuredClone(base);
      set(e, text);
      const r = check(e);
      assert.equal(r.status, 5, field + ': ' + text + ' was not refused');
      assert.ok(!r.stderr.includes(text) && !r.stdout.includes(text), 'the refusal names the matched text');
    }
    for (const text of PUBLIC_SPELLINGS) {
      const e = structuredClone(base);
      set(e, text);
      assert.equal(check(e).status, 0, field + ': ' + text + ' was refused');
    }
  }
  // The block's pattern agrees with the reference strictPrivate on both lists.
  for (const text of [...PRIVATE_SPELLINGS, ...PUBLIC_SPELLINGS]) {
    const e = structuredClone(base);
    e.next_act = text;
    assert.equal(check(e).status !== 0, strictPrivate(text), text);
  }
});

test('mhw worklog is an unknown command', () => {
  const mhw = (/** @type {string[]} */ args) => spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), ...args], { encoding: 'utf8' });
  // `worklog` is answered exactly as an unknown word, bare and with arguments, on each platform's own
  // routing: macOS and Linux name the unknown subcommand, Windows says it is not available there.
  for (const rest of [[], ['prepare-event', 'e.json']]) {
    const got = mhw(['worklog', ...rest]);
    const unknown = mhw(['nope', ...rest]);
    assert.equal(got.status, 2, rest.join(' '));
    assert.equal(unknown.status, 2);
    assert.equal(got.stdout, '');
    assert.equal(got.stderr, unknown.stderr.split('nope').join('worklog'), rest.join(' '));
    assert.ok(!/\(.*\bworklog\b.*\)/.test(got.stderr), 'the subcommand list names worklog');
  }
  assert.ok(!fs.existsSync(path.join(ROOT, 'src', 'commands', 'worklog.js')), 'src/commands/worklog.js still exists');
});
