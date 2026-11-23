// The working-method renderer's suite (Issue #61, ADR-0032): the node:test form of the deleted
// global/method/method_render_test.py (#489, S18 of #470), one test per Python test method, on throwaway
// homes only. The two regressions it exists for: a rendered agent that loses its tool list, and a rendered
// file that loses its provenance stamp (ADR-0029). Both are asserted per file, in every agent harness.
// Most of the rest are drift checks over STRINGS of method/: they assert a rule is WRITTEN, never that a
// session follows it.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { claudeCommand, commandAsSkill, codexPolicy, marker, SourceError, HARNESS_TOKEN } from '../../src/render/method.js';
import { parseToml } from '../../src/lib/toml.js';
import { asUri } from '../../src/render/method.js';
import {
  ROOT, SOURCE, MARKER, STAMP, OTHER, SCRIPTS_DIR, SKILLS, COMMANDS, byCode, methodHome, sourceCopy, tempDir, read, frontMatter,
  fieldsOf, markerLine, flatten, unstruckParagraphs, liveText, methodFiles, sourceAgents, filesUnder,
} from '../helpers/method-home.js';

const POSIX = process.platform !== 'win32';
/** @type {Record<string, string>} */
const KIRO = { Read: 'read', Grep: 'read', Glob: 'read', Write: 'write', Edit: 'write', Bash: 'shell' };
// Stated, not derived from the renderer: the documents a rite names and the render installs (#181).
const DOCUMENTS = ['funnel-review-contract/README.md'];
// The old command names, kept for one release as deprecated aliases (2026-10-26) and removed at #524 once
// that release had shipped. Stated, so the regression below names exactly what an earlier install left.
/** @type {Record<string, string>} */
const RETIRED_ALIASES = { 'new-idea': 'new-prd', 'idea-to-issues': 'prd-to-issues' };
const AGENTS = sourceAgents();
const ALL_MD = methodFiles('.md');

/** Every file the method renders into a home, relative. */
function allTargets() {
  /** @type {string[]} */
  const out = [];
  for (const s of SKILLS) out.push('.claude/skills/' + s + '/SKILL.md', '.agents/skills/' + s + '/SKILL.md', '.kiro/skills/' + s + '/SKILL.md');
  for (const c of COMMANDS) {
    out.push('.claude/commands/' + c + '.md', '.agents/skills/' + c + '/SKILL.md', '.agents/skills/' + c + '/agents/openai.yaml', '.kiro/skills/' + c + '/SKILL.md');
  }
  for (const a of Object.keys(AGENTS)) out.push('.claude/agents/' + a + '.md', '.codex/agents/' + a + '.toml', '.kiro/agents/' + a + '.json');
  out.push(...DOCUMENTS.map((d) => SCRIPTS_DIR + '/' + d));
  return out;
}

/** @param {string} file */
const src = (file) => path.join(SOURCE, ...file.split('/'));
/** @param {string} text @param {RegExp} re */
const count = (text, re) => (text.match(re) || []).length;

describe('the source shape', () => {
  test('the target set', () => {
    assert.deepEqual(Object.keys(AGENTS).sort(byCode), ['agents-lead', 'content-reviewer', 'content-writer', 'developer', 'product-lead',
      'quality-assurance', 'scrum-master', 'tech-lead']);
    assert.deepEqual(SKILLS, ['agents-configuration', 'shell', 'documentation-standard', 'engineering-standards', 'definition-of-ready',
      'definition-of-done', 'quality-gates', 'published-voice', 'scm', 'ci', 'provisioning', 'planning-poker', 'code-review',
      'content-publishing', 'orchestration',
      // #195: the canonical merge-authority contract.
      'merge-authority',
      // #591: the merge act on the delivery rulesets, which replaced mhw delivery.
      'merge-pull-request',
      // #567: the positioning-sync procedure, moved out of a private note.
      'positioning-sync',
      // The four rites moved at #130 (owner, 2026-10-12) and became skills on 2026-10-26 (owner: "para mim sao skills").
      'sprint-planning', 'sprint-review', 'sprint-retrospective', 'funnel-review'].sort(byCode));
    // #198 added /handoff; #522 added /backlog-grooming.
    assert.deepEqual(COMMANDS, ['autonomy', 'new-issue', 'new-prd', 'prd-to-issues', 'what-else', 'blueprint', 'handoff', 'need-me',
      'backlog-grooming'].sort(byCode));
  });

  test('no old command name is left', () => {
    // #524: the one-release aliases are gone; no command name carries "idea" (owner, 2026-10-26 and
    // 2026-11-20: "isso nao deveria existir depois do /new-prd").
    assert.deepEqual(COMMANDS.filter((c) => c.includes('idea')), []);
    for (const c of COMMANDS) {
      const file = src('commands/' + c + '.md');
      assert.ok(!frontMatter(file).join('\n').includes('deprecated-aliases'), c);
      assert.ok(!read(file).includes('is the old name of'), c);
    }
  });

  test('planning-poker no longer says reference pattern only', () => {
    const d = String(fieldsOf(src('skills/planning-poker/SKILL.md')).get('description'));
    assert.ok(!d.toLowerCase().includes('reference pattern'));
    assert.ok(d.includes('agents'));
  });

  test('every agent declares tools and preloads known skills', () => {
    for (const [name, a] of Object.entries(AGENTS)) for (const s of a.skills) assert.ok(SKILLS.includes(s), name);
    assert.deepEqual(AGENTS['scrum-master'].tools, []);
    // the browser grant stays read-only natively: the input-carrying tools are excluded
    assert.ok(AGENTS['product-lead'].excluded.includes('mcp__chrome-devtools__evaluate_script'));
  });
});

// Issue #97: the former devops skill is split by capability. Each capability skill names the tool it is
// written for in an opening disclaimer, and keeps every tool-specific word in one closing section, so a
// tool switch replaces that section only. Vendor words outside both are the regression.
/** @type {Record<string, [string, RegExp]>} */
const CAPABILITY_SKILLS = {
  scm: ['GitHub', /\bGitHub\b|\bgh\b/],
  ci: ['GitHub Actions', /\bGitHub\b|\.github\/|workflow_dispatch|\buses:/],
  'quality-gates': ['SonarCloud', /Sonar|SONAR_/],
  provisioning: ['Terraform Cloud', /[Tt]erraform|\bTFC\b|TF_WORKSPACE/],
};
const DISCLAIMER_RE = /^> \*\*Written for the selected tool: (.+?)\.\*\*/;

/** (tool in the disclaimer, disclaimer lines, tool-section lines, every other line, section starts) of one skill. @param {string} name */
function capabilityParts(name) {
  const lines = read(src('skills/' + name + '/SKILL.md')).split('\n');
  const end = lines.indexOf('---', 1);
  const body = lines.slice(end + 1);
  const first = body.findIndex((l) => l.trim());
  const m = DISCLAIMER_RE.exec(body[first]);
  const tool = m ? m[1] : null;
  let last = first;
  while (last < body.length && body[last].startsWith('>')) last++;
  const disclaimer = m ? body.slice(first, last) : [];
  const starts = body.map((l, i) => (l.startsWith('## Tool section') ? i : -1)).filter((i) => i >= 0);
  const section = starts.length === 1 ? body.slice(starts[0]) : [];
  const rest = [...lines.slice(0, end + 1), ...body.slice(0, first), ...(m && starts.length === 1 ? body.slice(last, starts[0]) : body)];
  return { tool, disclaimer, section, rest, starts };
}

describe('capability skills', () => {
  test('devops is gone and no agent preloads it', () => {
    assert.ok(!SKILLS.includes('devops'));
    for (const [name, a] of Object.entries(AGENTS)) assert.ok(!a.skills.includes('devops'), name);
    for (const name of Object.keys(CAPABILITY_SKILLS)) assert.ok(SKILLS.includes(name));
  });
  test('each opens with the disclaimer naming its tool', () => {
    for (const [name, [tool]] of Object.entries(CAPABILITY_SKILLS)) {
      const p = capabilityParts(name);
      assert.equal(p.tool, tool, name + ': the body must open with the selected-tool disclaimer');
      assert.ok(p.disclaimer.map((l) => l.replace(/^[> ]+/, '')).join(' ').includes('replace that section only'), name);
    }
  });
  test('one closing tool section holds the tool', () => {
    for (const [name, [tool]] of Object.entries(CAPABILITY_SKILLS)) {
      const p = capabilityParts(name);
      assert.equal(p.starts.length, 1, name + ': exactly one tool section');
      assert.equal(p.section[0], '## Tool section — ' + tool, name);
      assert.deepEqual(p.section.slice(1).filter((l) => l.startsWith('## ')), [], name + ': the tool section must be the last section');
    }
  });
  test('scm keeps the two layers and deny wins', () => {
    const text = capabilityParts('scm').rest.join('\n');
    assert.ok(text.includes('Deny from any layer wins'));
    assert.ok(text.includes('settings.local.json'));
  });
  test('no tool word outside the disclaimer and the tool section', () => {
    for (const [name, [, pattern]] of Object.entries(CAPABILITY_SKILLS)) {
      assert.deepEqual(capabilityParts(name).rest.filter((l) => pattern.test(l)), [], name + ': tool-specific text outside its tool section');
    }
  });
});

// Issue #176 (owner, 2026-10-13: "Mover pro mhw"): the review routing, the loop-mode contract and the ask
// rules live in the method's `orchestration` skill, not in a project's root brief.
const ORCHESTRATION = src('skills/orchestration/SKILL.md');
const ROOT_BRIEF_BLOCKS = /loop-mode-contract|hitl-escalation-format|review-chain-routing/;
const CONSUMER_WORDS = /tadeumendonca|tedeuxx|apps\/fed|\.brand\b|-io\b/gi;
// The prose forms the pointers took before #176, when they sent a reader to a project's root brief.
const ROOT_BRIEF_PROSE = /root brief's \(`AGENTS\.md`\)|each repository's root brief \(`AGENTS\.md`\)|the root brief \(`AGENTS\.md`\), or the record|`AGENTS\.md`'s escalation section|`AGENTS\.md` wins|The root brief is where those rules bind/g;
// Every pointer site #176 wrote: ten repointed from a root brief, one added (new-issue.md).
const FORMER_POINTERS = [
  ['commands/autonomy.md', 'it lives in `docs/loop-mode.md`, and it is READ before the pool predicate', "the `orchestration` skill's *The loop-mode contract* section", 'The loop-mode contract'],
  ['commands/autonomy.md', 'surfaces what is missing', "the `orchestration` skill's *How to ask the owner* section", 'How to ask the owner'],
  ['skills/funnel-review/SKILL.md', 'rule 4, that makes it a decision', "the `orchestration` skill's *How to ask the owner*", 'How to ask the owner'],
  ['skills/funnel-review/SKILL.md', 'PR #528 found that it contradicts his own escalation rules', '(the root brief then, the `orchestration` skill since #176), so they win', 'How to ask the owner'],
  // Added by #176, not repointed: before it this site named only the user-level brief.
  ['commands/new-issue.md', 'This is the interview half of the HITL escalation format', "the method's `orchestration` skill, *How to ask the owner*", 'How to ask the owner'],
  ['skills/sprint-planning/SKILL.md', 'It is not an independent source', "the `orchestration` skill's *How to ask the owner*", 'How to ask the owner'],
  ['agents/scrum-master.md', 'and `scrum` is one value of a closed enum of two', '*The loop-mode contract* in the `orchestration` skill', 'The loop-mode contract'],
  ['agents/scrum-master.md', 'two branches whose verdicts each attest a head', '*The loop-mode contract* of the `orchestration` skill', 'The loop-mode contract'],
  ['skills/agents-configuration/SKILL.md', 'Two artifacts carry it and neither is this file.', '*The loop-mode contract* in the `orchestration` skill', 'The loop-mode contract'],
  ['skills/agents-configuration/SKILL.md', 'These rows route INTAKE. The REVIEW chain is routed too', 'It lives in the `orchestration` skill, *Review is routed by type*', 'Review is routed by type'],
  ['skills/agents-configuration/SKILL.md', 'THE REVIEW GATE DOES NOT', '*The loop-mode contract* of the `orchestration` skill', 'The loop-mode contract'],
];

/** One `## heading` section of the orchestration skill; whitespace-flattened unless flat is false. @param {string} heading */
function orchestrationSection(heading, flat = true) {
  const text = read(ORCHESTRATION);
  const start = text.indexOf('\n## ' + heading + '\n');
  assert.ok(start >= 0, heading);
  const end = text.indexOf('\n## ', start + 1);
  const section = text.slice(start, end === -1 ? text.length : end);
  return flat ? flatten(section) : section;
}

/** @param {RegExp} re a global pattern @param {(text: string) => string[]} parts */
function hitsIn(re, parts) {
  /** @type {string[]} */
  const hits = [];
  for (const rel of ALL_MD) for (const p of parts(src(rel))) for (const m of p.matchAll(re)) hits.push(rel + ': ' + m[0]);
  return hits;
}

describe('orchestration owns the blocks', () => {
  test('no method file points at a root-brief block', () => {
    /** @type {string[]} */
    const hits = [];
    for (const rel of ALL_MD) read(src(rel)).split('\n').forEach((l, n) => { if (ROOT_BRIEF_BLOCKS.test(l)) hits.push(rel + ':' + (n + 1)); });
    assert.deepEqual(hits, [], 'a method file still names a root-brief block');
  });
  test('the review route has one row per type and keeps the gate', () => {
    const section = orchestrationSection('Review is routed by type');
    for (const row of ['| `loop` | one `agents-lead` lens pass, plus the gate |',
      "| `product` | the leads' lenses as the change warrants, plus the gate |",
      '| `content` | `content-writer` drafts, `content-reviewer` repairs the draft in place (two rounds at most), plus the gate |']) {
      assert.ok(section.includes(row), row);
    }
    for (const clause of ['The gate runs on every merge request, under both of its lenses.', 'never removes a hold and never changes a verdict literal',
      'The reader-facing copy criterion fires whatever the type.', 'No rule keys on a round count.',
      '`loop` by `agents-lead` alone, `content` by `product-lead` alone']) {
      assert.ok(section.includes(clause), clause);
    }
  });
  test('the loop-mode contract keeps every untouchable', () => {
    const section = orchestrationSection('The loop-mode contract');
    for (const clause of ['never a permission rule', 'the permission floor', 'the gate and its lenses', 'head-scoped verdicts', 'only-the-owner-opens-work',
      '(`sp:N` in both modes)', "the routing labels or the container's existence", '`content` has no second mode', 'never on an empty pool',
      'Development parallelises; review does not.', 'Rebase onto the current trunk before the gate.', '`docs/loop-mode.md`', 'this contract wins',
      'One issue, one git worktree; no count bounds development.', 'At most one merge request is in review at a time',
      "Remove a slice's worktree after its merge."]) {
      assert.ok(section.includes(clause), clause);
    }
  });
  test('no method file reads the retired wip count', () => {
    // Issue #216 (owner, 2026-10-19): the numeric work-in-progress ceiling is retired. The record's field may
    // still be NAMED inside a struck span, never outside one.
    assert.deepEqual(hitsIn(/`wip:?`|\bwip: ?(?:\d|N\b)/g, unstruckParagraphs), [], 'a method file still names the retired wip count outside a struck span');
  });
  test('/autonomy off assumes no single slice in flight', () => {
    const text = read(src('commands/autonomy.md')).replace(/~~.*?~~/gs, '');
    const row = /** @type {RegExpExecArray} */ (/^\| `off` \|.*$/m.exec(text))[0];
    const reading = text.slice(text.indexOf('\n## Ratified reading (B)'), text.indexOf('\n## What this does NOT do'));
    let summary = text.slice(text.indexOf('\n## The closing summary'));
    summary = summary.slice(0, summary.indexOf('\n\n', summary.indexOf('\n\n') + 2));
    const singular = /\b(?:the|whatever|this) (?:in-flight|current) slice\b|\bwhatever slice\b|\bthe slice (?:is )?(?:already )?in flight\b|\bafter the current slice\b/gi;
    const hits = [row, reading, summary].flatMap((part) => [...flatten(part).matchAll(singular)].map((m) => m[0]));
    assert.deepEqual(hits, [], '`/autonomy off` still assumes a single slice in flight');
  });
  test('/autonomy on drains without a slice count', () => {
    const text = read(src('commands/autonomy.md')).replace(/~~.*?~~/gs, '');
    const row = /** @type {RegExpExecArray} */ (/^\| `on` \|.*$/m.exec(text))[0];
    const start = text.indexOf('\n# Mode: `on`\n') + '\n# Mode: `on`\n'.length;
    const opening = text.slice(start, text.indexOf('\n\n', start + 2));
    const hits = [row, opening].flatMap((part) => [...flatten(part).matchAll(/\bone (?:slice|issue|item|branch) at a time\b/gi)].map((m) => m[0]));
    assert.deepEqual(hits, [], '`/autonomy on` still drains one slice at a time');
  });
  test('How to ask carries the five rules', () => {
    assert.deepEqual([...orchestrationSection('How to ask the owner', false).matchAll(/^(\d)\. \*\*/gm)].map((m) => m[1]), ['1', '2', '3', '4', '5']);
    const section = orchestrationSection('How to ask the owner');
    for (const clause of ['One owner ask per activation or message.', 'Never move the remainder into a prose or numbered list',
      'the context lives in the options', 'four is a ceiling', 'is an order and a link, not a question',
      'An interview takes no options; an escalation always does.', 'Do not rebuild it.']) {
      assert.ok(section.includes(clause), clause);
    }
  });
  test('the skill names no consumer', () => {
    assert.deepEqual(read(ORCHESTRATION).split('\n').filter((l) => new RegExp(CONSUMER_WORDS.source, 'i').test(l)), []);
  });
  test('every former pointer names the skill', () => {
    // Per pointer, not per file; struck spans are removed first, so a struck pointer does not count.
    for (const [rel, anchor, pointer, heading] of FORMER_POINTERS) {
      assert.ok(read(ORCHESTRATION).includes('\n## ' + heading + '\n'), heading);
      const paragraphs = unstruckParagraphs(src(rel)).filter((p) => p.includes(anchor));
      assert.equal(paragraphs.length, 1, rel + ': anchor ' + anchor);
      assert.ok(paragraphs[0].includes(pointer), rel + ': the pointer at ' + anchor + ' no longer names the skill');
    }
  });
  test('no method file keeps a root-brief pointer in prose', () => {
    assert.deepEqual(hitsIn(ROOT_BRIEF_PROSE, unstruckParagraphs), [], 'a method file still points at a root brief for an orchestration rule');
  });
  test('the description carries the trigger', () => {
    assert.ok(String(fieldsOf(ORCHESTRATION).get('description')).includes('Use before dispatching a review, before any pool query or rite, and before any question, '
      + 'decision or action you put to the owner.'));
  });
  test('the tool-less profile and the lens preload it', () => {
    for (const name of ['scrum-master', 'agents-lead']) assert.ok(AGENTS[name].skills.includes('orchestration'), name);
  });
});

// Issue #180 (owner, 2026-10-16): the owner reads a piece in the application's preview mode before it
// publishes, never a Claude Artifact. Drift checks over STRINGS.
const OWNER_READ = "The owner reads a piece in the application's preview mode before it publishes: a new piece at "
  + "its held preview, a correction to a published piece as a pending revision at the piece's own URL. "
  + 'Never a Claude Artifact, a paste, a file or a screenshot. Where the preview mode cannot render the '
  + 'case, say so to the owner and stop: nothing goes live, and the change waits. This governs his read '
  + 'of a publication only, not an Artifact he asked for elsewhere, such as a closing-rite report.';
const OWNER_READ_SURFACES = ['agents/product-lead.md', 'skills/content-publishing/SKILL.md', 'skills/orchestration/SKILL.md'];
const CONTENT_PUBLISHING = src('skills/content-publishing/SKILL.md');
// An instruction that routes the owner's read to an Artifact (method_render_test.py's ARTIFACT_READ, with
// its case-insensitive spans spelled out, since JavaScript has no inline flag). "Artifact" is case-sensitive.
const ARTIFACT_READ = /\b(?:[Vv][Aa][Ll][Ii][Dd][Aa][Tt]|[Rr][Ee][Aa][Dd]|[Rr][Ee][Vv][Ii][Ee][Ww]|[Aa][Pp][Pp][Rr][Oo][Vv]|[Cc][Hh][Ee][Cc][Kk])\w*\b[^.]{0,120}?\b[Aa][Ss] [Aa][Nn]? ?(?:[Rr][Ee][Nn][Dd][Ee][Rr][Ee][Dd] |[Cc][Ll][Aa][Uu][Dd][Ee] )?Artifact\b|\bArtifact\b[^.]{0,40}\b[Ff][Oo][Rr] (?:[Hh][Ii][Mm]|[Tt][Hh][Ee] [Oo][Ww][Nn][Ee][Rr]) [Tt][Oo] (?:[Rr][Ee][Aa][Dd]|[Vv][Aa][Ll][Ii][Dd][Aa][Tt][Ee]|[Rr][Ee][Vv][Ii][Ee][Ww])\b/g;

/** One `### heading` section, flattened, up to the next heading of level 2 or 3. @param {string} file @param {string} heading */
function markdownSection(file, heading) {
  const text = read(file);
  const start = text.indexOf('\n### ' + heading);
  assert.ok(start >= 0, heading);
  const ends = [text.indexOf('\n## ', start + 1), text.indexOf('\n### ', start + 1)].filter((i) => i !== -1);
  return flatten(text.slice(start, ends.length ? Math.min(...ends) : text.length));
}

describe('the owner reads in the preview mode', () => {
  test('the sentence is on one line in exactly the three surfaces', () => {
    /** @type {Record<string, number[]>} */
    const found = {};
    for (const rel of ALL_MD) {
      const lines = read(src(rel)).split('\n').map((l, n) => (l.includes(OWNER_READ) && !l.includes('~~') ? n + 1 : 0)).filter(Boolean);
      if (lines.length) found[rel] = lines;
    }
    assert.deepEqual(Object.keys(found).sort(byCode), OWNER_READ_SURFACES, 'the owner-read sentence drifted or moved');
    for (const [rel, lines] of Object.entries(found)) assert.equal(lines.length, 1, rel + ': exactly one copy');
  });
  test('the Artifact pattern still matches the phrasings it was written for', () => {
    // Calibration: a pattern that matches nothing passes every file.
    for (const s of ['validate it as a rendered Artifact', 'Review the draft as an Artifact', 'an Artifact for the owner to read']) {
      assert.ok(new RegExp(ARTIFACT_READ.source).test(s), s);
    }
  });
  test('no method file routes the owner read to an Artifact', () => {
    assert.deepEqual(hitsIn(ARTIFACT_READ, unstruckParagraphs), [], "a method file routes the owner's read to an Artifact");
  });
  test('the correction case is specified', () => {
    const section = markdownSection(CONTENT_PUBLISHING, 'A correction to an already-published piece');
    for (const clause of ['*«Construir modo revisão»*', '**The public enumeration** drops a flagged piece', 'to the locale home', 'to the root redirect',
      '**The mechanism: a pending revision.**', 'It is **body-only**', 'it is two merges', '**The revision merge.**', '**His read.**',
      '**The release merge.**', '**His comment on this merge request, naming the URLs he read, records his read**',
      'nothing goes live, and the correction waits.']) {
      assert.ok(section.includes(clause), clause);
    }
    assert.deepEqual(section.match(CONSUMER_WORDS) || [], [], 'the method names no consumer path');
  });
  test('the conflicting-criterion rule and step 8 artifact', () => {
    assert.ok(flatten(read(CONTENT_PUBLISHING)).includes('**An acceptance criterion that contradicts it is a conflict to name, not an instruction.**'));
    assert.ok(markdownSection(CONTENT_PUBLISHING, '8 · His validation').includes('**What records his validation is his comment on the release merge request, naming the '
      + 'preview URLs he read.**'));
  });
  test('published needs the social pair', () => {
    // Issue #238 (owner, 2026-10-30): a content piece is not published until both social posts exist.
    const step10 = markdownSection(CONTENT_PUBLISHING, '10 · The social pair');
    for (const clause of ['**A new piece is published when its release is live AND both posts exist, each with its URL.**', '"released, social pair pending"',
      '**A `content` Issue closes only with a comment that records both post URLs.**', "Each post's text is SCANNED before it is posted"]) {
      assert.ok(step10.includes(clause), clause);
    }
    const step9 = markdownSection(CONTENT_PUBLISHING, '9 · Release');
    for (const clause of ['**Before the release merge**, draft the text of both posts', 'never with a closing keyword', 'Only then is the piece published.']) {
      assert.ok(step9.includes(clause), clause);
    }
    const section = orchestrationSection('How to ask the owner');
    assert.ok(section.includes('**Do not report a new `content` piece as published, done or reached until both of its social post URLs exist;'));
    assert.ok(section.includes('The definition is `content-publishing` step 10'));
  });
  test('the descriptions carry the owner read', () => {
    for (const file of [CONTENT_PUBLISHING, ORCHESTRATION]) {
      const d = String(fieldsOf(file).get('description'));
      assert.ok(d.includes('what the owner reads before a content merge'), file);
      assert.ok(d.includes('never a Claude Artifact'), file);
    }
  });
});

// Issue #197: the reader-facing lens leaves its artifact on the PR before the gate is dispatched, and the gate
// verifies it and refuses rather than relaying. Drift checks over STRINGS, at the *written* level.
const PRE_GATE_HEADING = 'Before the gate: the reader-facing lens leaves its artifact';
const PRE_GATE_CLAUSES = [
  'Do not dispatch `quality-assurance` before it is.',
  'Read the actual diff at its full current head.',
  'a path list and a file extension are signals only',
  'output visible only in a preview',
  'When you cannot tell, it is reader-facing.',
  'dispatch `product-lead` as the copy lens, whatever the type, `loop` included.',
  'You relay its returned verdict verbatim into one pull request comment, before you dispatch the gate.',
  'That comment is the canonical copy artifact; the gate verifies and references it and does not post a second copy.',
  'On a `content` diff, no copy verdict is owed.',
  'never paraphrase it in transit.',
  'If the comment cannot be posted, the phase is incomplete and the gate waits.',
  'A moved head needs a new artifact at the new head.',
  'prove the reader-facing projection byte-identical: `git diff --quiet <prior-head> <head> -- <reader-facing paths>` exits 0, where `<reader-facing paths>` is the union of the reader-facing paths in both heads\' diffs, so a reader-facing file first touched at the new head cannot escape the check.',
  "**Only the envelope's line-3 `verdict:` is the literal**",
  '**When two `copy-verdict` comments name the same head, the newest wins.**',
  'the round is complete only when the pull request carries a `gatekeeper-verdict` comment whose `head:` line names the current full head.',
  'No available layer can intercept an agent dispatch.',
  'a relay by the orchestrator has failed before.',
];
const PRE_GATE_TEMPLATE = ['<!-- copy-verdict: product-lead -->',
  'head: <the full 40-character head this artifact attests (on a carry-forward, the new head)>',
  'verdict: <exactly one of APPROVE, ADJUST, ESCALATE>',
  'carried-from: <only on a carry-forward: the prior head, then the comparison evidence>',
  '<!-- /copy-verdict -->'];
/** @type {Array<[string, string[], string[]]>} per consumer: file, clauses its live prose carries, clauses it no longer carries */
const PRE_GATE_CONSUMERS = [
  ['commands/autonomy.md',
    ['the lens runs, and leaves its artifact, before the gate.', '**before you dispatch `quality-assurance`**', 'the `orchestration` skill, *' + PRE_GATE_HEADING + '*',
      "the gate's refusal of criterion 10 is the backstop."],
    ['so an undispatched lens fails silently']],
  ['agents/quality-assurance.md',
    ['### Since mhw#197: verify the pre-gate copy artifact; refuse, do not relay', '**The relay is no longer yours.**',
      'Re-derive the trigger yourself, from the diff at the head you review.', 'your verdict is `REQUEST-CHANGES`**', '**Refuse, do not relay.**',
      'do not dispatch the lens yourself, do not post its verdict',
      '**An `APPROVE` or `ADJUST` artifact whose findings are all `ADVISORY` does not hold the merge; any `BLOCKING` finding does. An `ESCALATE` holds the merge through hold 4, whatever its severities**',
      '`git diff --quiet <prior-head> <head> -- <reader-facing paths>` exits 0', 'When two such comments name the current head, the newest wins;',
      "where `<reader-facing paths>` is the union of the reader-facing paths in both heads' diffs, so a reader-facing file first touched at the new head cannot escape the check",
      '10 · copy-artifact: <URL of the canonical pre-gate copy-verdict comment',
      '*its text is on the PR* means the canonical pre-gate copy artifact at the current head'],
    ['So you relay it, and the relay is now mandatory rather than permitted.', 'This adds no comment and no marker vocabulary',
      'you quote it **verbatim inside the `copy-verdict` fence**']],
  ['agents/product-lead.md',
    ['Since mhw#197 the ORCHESTRATOR quotes your verdict onto the PR VERBATIM', 'BEFORE it dispatches `quality-assurance`', 'You still post nothing.'],
    ['`quality-assurance` quotes your verdict onto the PR VERBATIM', "verbatim quote inside the gate's own marker"]],
  ['agents/agents-lead.md',
    ["the orchestrator's pre-gate copy artifact, one comment per head under the `copy-verdict` envelope."],
    ["verbatim quote inside the gate's own marker"]],
];

/** Per agent harness: the installed orchestration skill and quality-assurance agent, flattened. @param {import('../helpers/method-home.js').Home} home */
function preGateCarriers(home) {
  /** @type {Record<string, [string, string]>} */
  const out = {};
  for (const [harness, skill, agent] of [['claude-code', '.claude/skills/orchestration/SKILL.md', '.claude/agents/quality-assurance.md'],
    ['codex', '.agents/skills/orchestration/SKILL.md', '.codex/agents/quality-assurance.toml'],
    ['kiro', '.kiro/skills/orchestration/SKILL.md', '.kiro/agents/quality-assurance.json']]) {
    let text = read(home.p(agent));
    if (agent.endsWith('.toml')) text = parseToml(text).developer_instructions;
    else if (agent.endsWith('.json')) text = JSON.parse(text).prompt;
    out[harness] = [flatten(read(home.p(skill))), flatten(text)];
  }
  return out;
}

describe('the reader-facing lens before the gate', () => {
  test('the skill carries the pre-gate phase', () => {
    const section = orchestrationSection('Review is routed by type');
    assert.ok(section.includes('### ' + PRE_GATE_HEADING + ' (#197)'));
    for (const clause of PRE_GATE_CLAUSES) assert.ok(section.includes(clause), clause);
  });
  test('the artifact template keeps its lines in order', () => {
    const lines = orchestrationSection('Review is routed by type', false).split('\n').map((l) => l.trim());
    const at = PRE_GATE_TEMPLATE.map((want) => lines.indexOf(want));
    assert.ok(at.every((i) => i >= 0), 'a template line is missing');
    assert.deepEqual(at, [...at].sort((a, b) => a - b), 'the copy artifact template lines are out of order');
    assert.equal(at[1], at[0] + 1, 'head: must be the line directly under the envelope');
  });
  test('every consumer carries the rule and drops the gate relay', () => {
    for (const [rel, keep, drop] of PRE_GATE_CONSUMERS) {
      const text = liveText(src(rel));
      for (const clause of keep) assert.ok(text.includes(clause), rel + ' keeps ' + clause);
      for (const clause of drop) assert.ok(!text.includes(clause), rel + ' drops ' + clause);
    }
  });
  test('the rule reaches every agent harness carrier', () => {
    const home = methodHome();
    const r = home.run(['--mode=install']);
    assert.equal(r.code, 0, r.out);
    for (const [harness, [skill, agent]] of Object.entries(preGateCarriers(home))) {
      for (const clause of PRE_GATE_CLAUSES) assert.ok(skill.includes(clause), harness + ': ' + clause);
      for (const clause of PRE_GATE_CONSUMERS[1][1]) assert.ok(agent.includes(clause), harness + ' agent: ' + clause);
    }
  });
  test('a clause deleted from the source is missing from all three carriers', () => {
    // The source-mutation pair, run inside the suite: delete one clause from a copy of method/, install,
    // and each of the three carriers loses it; the unmutated install above carries it in all three.
    const copy = sourceCopy();
    const clause = 'Do not dispatch `quality-assurance` before it is.';
    const skill = path.join(copy, 'skills', 'orchestration', 'SKILL.md');
    const text = fs.readFileSync(skill, 'utf8');
    assert.equal(text.split(clause).length - 1, 1);
    fs.writeFileSync(skill, text.replace(clause, ''));
    const home = methodHome();
    const r = home.run(['--mode=install', '--source=' + copy]);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(Object.entries(preGateCarriers(home)).filter(([, [rendered]]) => !rendered.includes(clause)).map(([h]) => h), ['claude-code', 'codex', 'kiro']);
  });
});

// Issue #564 (owner, 2026-11-23): published-voice carries a closed catalog of social-post formats, and
// funnel-review compares posts by its code. Drift checks over strings: they assert the rule is WRITTEN.
const PUBLISHED_VOICE = src('skills/published-voice/SKILL.md');
const CATALOG_HEADING = '## The social-post catalog — rule 26, five formats, and the digest is one of them';
/** The catalog section, raw, up to the next level-2 heading. */
function catalogSection() {
  const text = read(PUBLISHED_VOICE);
  const start = text.indexOf('\n' + CATALOG_HEADING + '\n');
  assert.ok(start >= 0, 'the catalog section is missing');
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? text.length : end);
}
const CATALOG_CLAUSES = [
  'Every LinkedIn or X post is drafted in exactly ONE format from the closed catalog below',
  'it never judges the merit of the owner\'s idea.',
  '**`F1` runs outside the rotation.**', '**Otherwise alternate `F2` and an `F3` variant.**',
  '**The code is recorded with every published post**', '**A post published with no code is `unlabelled`.**',
  '**A reviewer who disagrees with the idea has no finding.**', 'never originate a thesis to fill a rotation slot.',
  // The vehicle rule in full (agents-lead A2 on PR #573): the prohibition list, the surviving bounds, F2's question.
  '**What neither may do, ever:** call the thesis wrong, weak, obvious, unoriginal, risky or not ready; swap it for a '
    + 'stronger one; soften it to be safer; or add a counter-argument he did not make.',
  '**Three bounds survive the merit rule, because none of them is about merit:** *The subject is bounded*',
  'every rule about third-party property; and **fidelity to the source**',
  'a claim false against the source is still repaired',
  '**one thesis, the owner\'s**, stated in the first line, and **one question to the audience**, closing the post.',
  '**Poll positions he does not hold are the format, not a counter-argument:**',
  '**Today that comparison reads LinkedIn only:**',
];
// The pointers that make the drafting, reviewing and publishing actors reach rule 26.
const CATALOG_POINTERS = [
  ['agents/content-writer.md', '**Pick its format code first, from `published-voice` rule 26\'s closed catalog**'],
  ['agents/content-reviewer.md', '**On any social post, check its format code against `published-voice` rule 26**'],
  // The reviewer keeps the truth repair and the merit ban (agents-lead B2 and A5 on PR #573).
  ['agents/content-reviewer.md', 'Repair the vehicle, and a claim false against the source under ground 2;'],
  ['agents/content-reviewer.md', 'disagreeing with his idea is never a finding.'],
  ['skills/content-publishing/SKILL.md', '**Both posts of this pair are format `F1`, the article digest**'],
  ['skills/funnel-review/SKILL.md', '**never with a guessed code**'],
];
describe('the social-post format catalog', () => {
  test('the drafting, reviewing, publishing and funnel surfaces point at rule 26', () => {
    for (const [rel, clause] of CATALOG_POINTERS) assert.ok(flatten(read(src(rel))).includes(clause), rel + ': ' + clause);
  });
  test('the skill carries no open question to the owner about the goal', () => {
    assert.ok(!flatten(catalogSection()).includes('that is his to say'));
  });
  test('the catalog lists the five codes, one row each, with their link rule', () => {
    const rows = catalogSection().split('\n').filter((l) => /^\| `F[0-9a-z]+` \|/.test(l));
    assert.deepEqual(rows.map((l) => l.split('|')[1].trim()), ['`F1`', '`F2`', '`F3a`', '`F3b`', '`F3c`']);
    assert.ok(rows[0].includes('| yes,'), 'F1 carries the canonical link');
    for (const row of rows.slice(1)) assert.ok(row.includes('| no |'), row);
  });
  test('the rotation, the label and the vehicle rule are written', () => {
    const section = flatten(catalogSection());
    for (const clause of CATALOG_CLAUSES) assert.ok(section.includes(clause), clause);
  });
  test('the catalog names no consumer', () => {
    assert.deepEqual(catalogSection().split('\n').filter((l) => new RegExp(CONSUMER_WORDS.source, 'i').test(l)), []);
  });
  test('funnel-review and its contract read the format code', () => {
    const rite = flatten(read(src('skills/funnel-review/SKILL.md')));
    for (const clause of ['**Each post figure carries the post\'s format code**', '`<metric>.<format>.<post>`',
      '**When the report compares posts, it compares them BY FORMAT CODE (mhw#564).**',
      '**`unlabelled` posts are reported as such and left out of every per-format comparison.**']) assert.ok(rite.includes(clause), clause);
    assert.ok(read(src('scripts/funnel-review-contract/README.md')).includes('<metric>.<format>.<post>'));
  });
  test('the catalog reaches every agent harness carrier', () => {
    const home = methodHome();
    const r = home.run(['--mode=install']);
    assert.equal(r.code, 0, r.out);
    for (const rendered of ['.claude/skills/published-voice/SKILL.md', '.agents/skills/published-voice/SKILL.md', '.kiro/skills/published-voice/SKILL.md']) {
      const text = flatten(read(home.p(rendered)));
      for (const clause of CATALOG_CLAUSES) assert.ok(text.includes(clause), rendered + ': ' + clause);
    }
  });
});

// Issue #439: the head the builder reported is the head under review, and nothing it started is still running.
// Drift checks over STRINGS, at the *written* level: they assert the rule is carried, never that a session followed it.
const HEAD_CHECK_HEADING = 'Before the gate: the head the builder reported is the head under review';
const HEAD_CHECK_CLAUSES = [
  "**Do not dispatch `quality-assurance` until the builder's reported head is the pull request's current head.**",
  'declares that no background process it started is still running',
  '**They differ, or the report names no head: do not dispatch the gate.**',
  '**The report does not declare that nothing it started is still running: do not dispatch the gate.**',
  'The SHA-pinned verdict and merge are unchanged',
  'Run this first, before the reader-facing phase below, so no copy artifact is posted at a head that moves.',
];
const BUILDER_CLAUSE = '**Your report of done names the full forty-character head your work is on, and declares that no background process you started is still running** (mhw#439).';
const BUILDER_BRIEFS = ['agents/developer.md', 'agents/content-writer.md'];

describe('the builder reports a head and nothing running', () => {
  test('the skill carries the head check before the gate', () => {
    const section = orchestrationSection('Review is routed by type');
    assert.ok(section.includes('### ' + HEAD_CHECK_HEADING + ' (#439)'));
    for (const clause of HEAD_CHECK_CLAUSES) assert.ok(section.includes(clause), clause);
  });
  test('every builder brief requires the head and the nothing-running declaration', () => {
    for (const rel of BUILDER_BRIEFS) assert.ok(liveText(src(rel)).includes(BUILDER_CLAUSE), rel);
  });
  test('the rule reaches every agent harness carrier of the skill and of each builder brief', () => {
    const home = methodHome();
    const r = home.run(['--mode=install']);
    assert.equal(r.code, 0, r.out);
    for (const [harness, [skill]] of Object.entries(preGateCarriers(home))) {
      for (const clause of HEAD_CHECK_CLAUSES) assert.ok(skill.includes(clause), harness + ': ' + clause);
    }
    for (const name of ['developer', 'content-writer']) {
      for (const [harness, rel] of [['claude-code', '.claude/agents/' + name + '.md'], ['codex', '.codex/agents/' + name + '.toml'], ['kiro', '.kiro/agents/' + name + '.json']]) {
        let text = read(home.p(rel));
        if (rel.endsWith('.toml')) text = parseToml(text).developer_instructions;
        else if (rel.endsWith('.json')) text = JSON.parse(text).prompt;
        assert.ok(flatten(text).includes(BUILDER_CLAUSE), harness + ' ' + name);
      }
    }
  });
});

describe('render', () => {
  /** @type {import('../helpers/method-home.js').Home} */
  let h;
  /** @type {{ code: number, out: string }} */
  let first;
  before(() => {
    h = methodHome();
    first = h.run(['--mode=install']);
  });

  test('install writes every target', () => {
    assert.equal(first.code, 0, first.out);
    for (const rel of allTargets()) assert.ok(fs.statSync(h.p(rel)).isFile(), rel);
    assert.ok(first.out.includes('METHOD  installed: ' + Object.keys(AGENTS).length + ' agents, ' + SKILLS.length + ' skills, ' + COMMANDS.length + ' commands'));
  });

  test('no method script is installed, and the summary says so (#489)', () => {
    // D9 of #470: the rites run mhw commands, so the scripts directory receives the documents a rite names
    // and nothing else.
    const dir = h.p(SCRIPTS_DIR);
    assert.deepEqual(filesUnder(dir).map((f) => path.relative(dir, f).split(path.sep).join('/')), DOCUMENTS);
    assert.ok(first.out.includes('; the documents its rites name in ' + dir + ' (no scripts: the rites run mhw commands)'), first.out.slice(-300));
  });

  test('every rendered file carries the stamp', () => {
    const missing = allTargets().filter((rel) => {
      const line = markerLine(h.p(rel));
      return !(line.includes(MARKER) && line.includes('; source: method/') && line.includes('; ' + STAMP + ';'));
    });
    assert.deepEqual(missing, []);
  });

  test('a Claude Code agent carries its tool list and preloads', () => {
    for (const [name, a] of Object.entries(AGENTS)) {
      const fm = frontMatter(h.p('.claude/agents/' + name + '.md'));
      assert.deepEqual(fm.filter((l) => l.startsWith('tools:')), ['tools: ' + (a.tools.length ? a.tools.join(', ') : '[]')], name);
      assert.deepEqual(fm.filter((l) => l.startsWith('disallowedTools:')), a.excluded.length ? ['disallowedTools: ' + a.excluded.join(', ')] : [], name);
      assert.deepEqual(fm.filter((l) => l.startsWith('  - ')).map((l) => l.trim().slice(2)), a.skills, name);
    }
  });

  test('a Kiro agent carries its tool list', () => {
    for (const [name, a] of Object.entries(AGENTS)) {
      const doc = JSON.parse(read(h.p('.kiro/agents/' + name + '.json')));
      /** @type {string[]} */
      const want = [];
      for (const t of a.tools) {
        const tag = t.startsWith('mcp__') ? '@' + t.slice(5) : KIRO[t];
        if (!want.includes(tag)) want.push(tag);
      }
      assert.deepEqual(doc.tools, want, name);
      // Kiro carries no deny floor, so nothing may be auto-approved (agents-lead lens, PR #94).
      assert.ok(!('allowedTools' in doc), name);
      assert.deepEqual(doc.excludedTools || [], a.excluded.map((t) => '@' + t.slice(5).split('__').slice(0, 1)[0] + '/' + t.slice(5).split('__').slice(1).join('__')), name);
      assert.deepEqual(doc.resources, a.skills.map((s) => asUri(h.p('.kiro/skills/' + s + '/SKILL.md'), process.platform)), name);
      // The URI is the one Node's own file-URL builder gives for these plain paths.
      assert.deepEqual(doc.resources, a.skills.map((s) => pathToFileURL(h.p('.kiro/skills/' + s + '/SKILL.md')).href), name);
    }
  });

  test('a Codex agent carries its tool list as an instruction', () => {
    for (const [name, a] of Object.entries(AGENTS)) {
      const doc = parseToml(read(h.p('.codex/agents/' + name + '.toml')));
      assert.equal(doc.name, name.replaceAll('-', '_'));
      const di = String(doc.developer_instructions);
      assert.ok(di.includes('Allowed tools for this agent: ' + (a.tools.length ? a.tools.join(', ') : 'none') + '.'), name);
      assert.ok(di.includes('carries no tool list'), name);
      assert.ok(di.includes("inherit the parent session's MCP"), name);
      assert.ok(!di.includes('the one native narrowing'), name);
      if (a.excluded.length) assert.ok(di.includes('Excluded tools, even within a granted server: ' + a.excluded.join(', ') + '.'), name);
      const writes = a.tools.some((t) => ['Write', 'Edit', 'Bash'].includes(t));
      assert.equal(doc.sandbox_mode, writes ? undefined : 'read-only', name);
    }
  });

  test('commands per agent harness', () => {
    for (const c of COMMANDS) {
      assert.ok(read(h.p('.agents/skills/' + c + '/agents/openai.yaml')).includes('\npolicy:\n  allow_implicit_invocation: false\n'));
      assert.ok(read(h.p('.agents/skills/' + c + '/SKILL.md')).includes('Owner-typed command $' + c));
      assert.ok(read(h.p('.kiro/skills/' + c + '/SKILL.md')).includes('Owner-typed command /' + c));
      // #196: argument-hint only on the plugin standard's allowlisted owner-typed commands.
      const hinted = !['prd-to-issues', 'new-prd', 'what-else', 'need-me', 'backlog-grooming'].includes(c);
      assert.equal(frontMatter(h.p('.claude/commands/' + c + '.md')).join('\n').includes('argument-hint:'), hinted, c);
    }
  });

  test('the retired aliases an earlier install left are removed', () => {
    // #524: a home carrying the eight stamped alias files from an earlier release.
    const home = methodHome();
    assert.equal(home.run(['--mode=install']).code, 0);
    /** @type {Record<string, string>} */
    const planted = {};
    for (const [alias, target] of Object.entries(RETIRED_ALIASES)) {
      const where = 'method/commands/' + target + '.md';
      const md = '---\n# ' + marker(where, OTHER) + '\nname: "' + alias + '"\ndescription: "Deprecated name of ' + target + '."\n---\nold body\n';
      planted['.claude/commands/' + alias + '.md'] = md;
      planted['.agents/skills/' + alias + '/SKILL.md'] = md;
      planted['.agents/skills/' + alias + '/agents/openai.yaml'] = codexPolicy(where, OTHER);
      planted['.kiro/skills/' + alias + '/SKILL.md'] = md;
    }
    assert.equal(Object.keys(planted).length, 8);
    for (const [rel, text] of Object.entries(planted)) {
      fs.mkdirSync(path.dirname(home.p(rel)), { recursive: true });
      fs.writeFileSync(home.p(rel), text);
    }
    let r = home.run(['--mode=check']);
    assert.equal(r.code, 1, r.out);
    /** @param {string} s */
    const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    for (const rel of Object.keys(planted)) assert.match(r.out, new RegExp('^STALE   .*' + esc(home.p(rel)) + ': ', 'm'), rel);
    r = home.run(['--mode=install']);
    assert.equal(r.code, 0, r.out);
    for (const rel of Object.keys(planted)) {
      assert.match(r.out, new RegExp('^REMOVED .*' + esc(home.p(rel)) + ' ', 'm'), rel);
      assert.ok(!fs.existsSync(home.p(rel)), rel);
    }
    for (const alias of Object.keys(RETIRED_ALIASES)) {
      assert.ok(!fs.existsSync(home.p('.agents/skills/' + alias)), alias);
      assert.ok(!fs.existsSync(home.p('.kiro/skills/' + alias)), alias);
    }
    for (const target of Object.values(RETIRED_ALIASES)) {
      for (const rel of ['.claude/commands/' + target + '.md', '.agents/skills/' + target + '/SKILL.md', '.agents/skills/' + target + '/agents/openai.yaml', '.kiro/skills/' + target + '/SKILL.md']) {
        assert.ok(fs.statSync(home.p(rel)).isFile(), rel);
      }
    }
    assert.equal(home.run(['--mode=check']).code, 0);
  });

  test('an unstamped copy of a retired alias is left alone', () => {
    // A copy whose managed-by line was edited away is the owner's file: never removed, never reported.
    const home = methodHome();
    assert.equal(home.run(['--mode=install']).code, 0);
    const f = home.p('.claude/commands/new-idea.md');
    const text = '---\ndescription: "my own copy"\n---\nedited by hand\n';
    fs.writeFileSync(f, text);
    for (const mode of ['check', 'install']) {
      const r = home.run(['--mode=' + mode]);
      assert.equal(r.code, 0, r.out);
      assert.ok(!r.out.includes('new-idea'), mode);
    }
    assert.equal(fs.readFileSync(f, 'utf8'), text);
  });

  test('an unknown front-matter field stops the render', () => {
    // #524: the retired field, restored, is refused rather than ignored; so is any other unknown field.
    for (const [rel, extra, field] of [['commands/new-prd.md', 'deprecated-aliases:\n  - new-idea\n', 'deprecated-aliases'],
      ['skills/shell/SKILL.md', 'colour: blue\n', 'colour'], ['agents/developer.md', 'colour: blue\n', 'colour']]) {
      const copy = sourceCopy();
      const f = path.join(copy, ...rel.split('/'));
      fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace('\n---\n', '\n' + extra + '---\n'));
      const home = methodHome();
      const r = home.run(['--mode=install', '--source=' + copy]);
      assert.equal(r.code, 2, rel + ' ' + r.out);
      assert.ok(r.out.includes('method/' + rel + ': unknown front matter field ' + field), r.out);
      assert.ok(!fs.existsSync(home.p('.claude/commands')), rel);
    }
  });

  test('skill front matter is what Codex and Kiro read', () => {
    for (const s of [...SKILLS, ...COMMANDS]) {
      const fm = frontMatter(h.p('.kiro/skills/' + s + '/SKILL.md'));
      assert.ok(fm.includes('name: ' + JSON.stringify(s)), s);
      const desc = fm.filter((l) => l.startsWith('description: '));
      assert.equal(desc.length, 1);
      assert.ok(Array.from(JSON.parse(desc[0].slice('description: '.length))).length <= 1024);
    }
  });

  test('check is clean, then names each difference', () => {
    const home = methodHome();
    assert.equal(home.run(['--mode=install']).code, 0);
    let r = home.run(['--mode=check']);
    assert.equal(r.code, 0, r.out);
    assert.equal(count(r.out, /^OK /gm), allTargets().length);
    // another commit's stamp on unchanged content -> STAMP; a content change -> DRIFT; absent -> MISSING
    const f1 = home.p('.claude/agents/developer.md');
    fs.writeFileSync(f1, fs.readFileSync(f1, 'utf8').replace(STAMP, OTHER));
    const f2 = home.p('.kiro/agents/developer.json');
    fs.writeFileSync(f2, fs.readFileSync(f2, 'utf8').replace('"read"', '"web"'));
    fs.unlinkSync(home.p('.agents/skills/shell/SKILL.md'));
    r = home.run(['--mode=check']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^STAMP {3}.*[\\/]\.claude[\\/]agents[\\/]developer\.md: .*commit: fedcba98/m);
    assert.match(r.out, /^DRIFT {3}.*[\\/]\.kiro[\\/]agents[\\/]developer\.json/m);
    assert.match(r.out, /^MISSING .*[\\/]\.agents[\\/]skills[\\/]shell[\\/]SKILL\.md/m);
    r = home.run(['--mode=install']);
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /^RESTAMPED .*developer\.md/m);
    assert.equal(home.run(['--mode=check']).code, 0);
  });

  test('dry-run writes nothing', () => {
    const home = methodHome();
    const r = home.run(['--mode=dry-run']);
    assert.equal(r.code, 0, r.out);
    assert.deepEqual(home.files(), []);
    assert.equal(count(r.out, /^WOULD WRITE /gm), allTargets().length);
  });

  test('off by default, then kept current', () => {
    const home = methodHome();
    for (const mode of ['install', 'check', 'dry-run']) {
      const r = home.run(['--mode=' + mode], { optIn: false });
      assert.equal(r.code, 0, r.out);
      assert.ok(r.out.includes('METHOD  not installed'));
    }
    assert.deepEqual(home.files(), []);
    assert.equal(home.run(['--mode=install']).code, 0);
    const f = home.p('.claude/agents/developer.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(STAMP, OTHER));
    const r = home.run(['--mode=check'], { optIn: false }); // once present, it is checked without the flag
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /^STAMP {3}.*developer\.md/m);
  });

  test('the home argument wins over HOME', () => {
    // mhw install-windows (install.ps1 until #497) passes --home=<profile> so a HOME set on Windows is never written to.
    const home = methodHome();
    const other = methodHome('other');
    const r = home.run(['--mode=install', '--home=' + other.root]);
    assert.equal(r.code, 0, r.out);
    assert.ok(fs.statSync(other.p('.claude/agents/developer.md')).isFile());
    assert.deepEqual(home.files(), []);
  });

  test('an unmanaged file is refused and kept', () => {
    const home = methodHome();
    const mine = home.p('.claude/agents/developer.md');
    fs.mkdirSync(path.dirname(mine), { recursive: true });
    fs.writeFileSync(mine, "owner's own agent\n");
    const r = home.run(['--mode=install']);
    assert.equal(r.code, 3, r.out);
    assert.match(r.out, /REFUSE {2}.*developer\.md/);
    assert.equal(fs.readFileSync(mine, 'utf8'), "owner's own agent\n");
  });

  test('STALE and uninstall touch only method files', () => {
    const home = methodHome();
    assert.equal(home.run(['--mode=install']).code, 0);
    const stale = home.p('.claude/agents/retired-persona.md');
    fs.writeFileSync(stale, '---\n# ' + MARKER + '; source: method/agents/retired-persona.md; ' + STAMP + '; do not edit\n---\n');
    const other = home.p('.claude/commands/breaking-glass.md'); // install.sh's own managed file, not the method's
    fs.writeFileSync(other, '<!-- ' + MARKER + '; source: global/x; ' + STAMP + ' -->\n');
    const owner = home.p('.claude/skills/owner-skill/SKILL.md');
    fs.mkdirSync(path.dirname(owner), { recursive: true });
    fs.writeFileSync(owner, '---\nname: owner-skill\n---\n');
    let r = home.run(['--mode=check']);
    assert.equal(r.code, 1);
    assert.match(r.out, /^STALE {3}.*retired-persona\.md/m);
    assert.ok(!r.out.includes('breaking-glass'));
    assert.equal(home.run(['--mode=install']).code, 0);
    assert.ok(!fs.existsSync(stale));
    r = home.run(['--mode=uninstall'], { stamp: null, optIn: false });
    assert.equal(r.code, 0, r.out);
    for (const rel of allTargets()) assert.ok(!fs.existsSync(home.p(rel)), rel);
    assert.ok(fs.existsSync(other) && fs.existsSync(owner));
  });

  test('a script an earlier version installed is reported STALE and removed (#489)', () => {
    // The Issue's criterion: no method/scripts/*.py copy is installed, and one left by an earlier version
    // is removed on install and reported STALE by check, as are its siblings in the other carriers.
    const home = methodHome();
    assert.equal(home.run(['--mode=install']).code, 0);
    const dir = home.p(SCRIPTS_DIR);
    const left = path.join(dir, 'milestone-read.py');
    fs.writeFileSync(left, '#!/usr/bin/env python3\n# ' + marker('method/scripts/milestone-read.py', OTHER) + '\nprint(1)\n', { mode: 0o700 });
    const hand = path.join(dir, 'my-tool.py');
    fs.writeFileSync(hand, 'print("mine")\n');
    let r = home.run(['--mode=check']);
    assert.equal(r.code, 1, r.out);
    assert.ok(r.out.includes('STALE   ' + left + ': rendered by an earlier method; install removes it'), r.out);
    assert.ok(!r.out.includes('my-tool.py'));
    r = home.run(['--mode=install']);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.out.includes('REMOVED ' + left + ' (no longer in method/)'), r.out);
    assert.ok(!fs.existsSync(left));
    assert.ok(fs.existsSync(hand), 'a file without the managed-by line is the owner\'s');
    assert.equal(home.run(['--mode=check']).code, 0);
  });

  test('the store contract ships with the installed rite', () => {
    // Issue #181 AC1: the funnel-review store contract is installed beside the scripts, and the rendered rite
    // names a path that exists there. The worklog contract is read only by a test in this source tree.
    const scripts = h.p(SCRIPTS_DIR);
    for (const directory of ['worklog-contract', 'funnel-review-contract']) assert.ok(fs.statSync(src('scripts/' + directory + '/README.md')).isFile(), directory);
    assert.ok(!fs.existsSync(path.join(scripts, 'worklog-contract')), 'the worklog contract was installed');
    const installed = path.join(scripts, 'funnel-review-contract', 'README.md');
    assert.ok(fs.statSync(installed).isFile(), 'the funnel-review contract was not installed');
    const lines = read(installed).split('\n');
    assert.ok(lines[0].includes(MARKER));
    assert.ok(lines[0].includes('source: method/scripts/funnel-review-contract/README.md'));
    assert.equal(lines.slice(1).join('\n'), read(src('scripts/funnel-review-contract/README.md')));
    // #478: the report is `mhw funnel-review` now, so no funnel-review script is installed.
    assert.ok(!fs.existsSync(path.join(scripts, 'funnel-review.sh')));
    assert.ok(read(src('skills/funnel-review/SKILL.md')).includes('`{{method-scripts}}/funnel-review-contract/README.md`'));
    for (const rendered of ['.claude/skills/funnel-review/SKILL.md', '.agents/skills/funnel-review/SKILL.md', '.kiro/skills/funnel-review/SKILL.md']) {
      // The token is replaced by the directory and the source's own /: on Windows the path mixes both, as
      // the original's text did.
      assert.ok(read(h.p(rendered)).includes('`' + scripts + '/funnel-review-contract/README.md`'), rendered);
    }
    const old = 'docs/funnel-review/' + 'README.md';
    const named = filesUnder(SOURCE).filter((f) => ['.md', '.sh', '.py', '.tsv'].includes(path.extname(f)) && read(f).includes(old));
    assert.deepEqual(named, [], "a method file still names the consumer store's README as the contract");
  });

  test('the installed document is not executable', { skip: !POSIX && 'POSIX file modes' }, () => {
    // ADR-0032, amendment 2026-10-16.
    const installed = path.join(h.p(SCRIPTS_DIR), 'funnel-review-contract', 'README.md');
    assert.equal(fs.statSync(installed).mode & 0o111, 0);
  });

  test('a document through a symbolic link stops the render', { skip: !POSIX && 'symbolic links' }, () => {
    // ADR-0032, amendment 2026-10-16: a named document that is a symbolic link, or sits in a symlinked
    // directory, is not loaded, so the body naming it stops the render with nothing written.
    const outside = tempDir('outside');
    fs.writeFileSync(path.join(outside, 'README.md'), '# outside\n');
    for (const kind of ['file', 'directory']) {
      const home = methodHome();
      const copy = sourceCopy('link-source');
      if (kind === 'file') {
        fs.mkdirSync(path.join(copy, 'scripts', 'linked'));
        fs.symlinkSync(path.join(outside, 'README.md'), path.join(copy, 'scripts', 'linked', 'README.md'));
      } else {
        fs.symlinkSync(outside, path.join(copy, 'scripts', 'linked'), 'dir');
      }
      const rite = path.join(copy, 'skills', 'funnel-review', 'SKILL.md');
      fs.appendFileSync(rite, '\nSee `{{method-scripts}}/linked/README.md`.\n');
      const r = home.run(['--mode=install', '--source=' + copy]);
      assert.equal(r.code, 2, kind + ' ' + r.out);
      assert.ok(r.out.includes('linked/README.md names no file'), kind);
      assert.deepEqual(home.files(), [], kind);
    }
  });

  test('a source agent without tools is refused', () => {
    const home = methodHome();
    const copy = sourceCopy('bad-source');
    const f = path.join(copy, 'agents', 'developer.md');
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(/^tools:.*\n/m, ''));
    const r = home.run(['--mode=install', '--source=' + copy]);
    assert.equal(r.code, 2, r.out);
    assert.ok(r.out.includes('tools must be declared'));
    assert.deepEqual(home.files(), []);
  });
});

describe('the harness token', () => {
  // #198: {{agent-harness}} is substituted per carrier writer, with the harness passed explicitly, and stops
  // the render anywhere but a command body.
  const COMMAND = { description: 'd', purpose: '', hint: '', where: 'method/commands/x.md', body: '\nThis copy is for {{agent-harness}}.\n' };

  test('each writer substitutes its own harness', () => {
    assert.ok(claudeCommand(COMMAND, STAMP, 'claude-code').includes('This copy is for claude-code.'));
    assert.ok(commandAsSkill(COMMAND, 'x', '$x', STAMP, 'codex').includes('This copy is for codex.'));
    assert.ok(commandAsSkill(COMMAND, 'x', '/x', STAMP, 'kiro').includes('This copy is for kiro.'));
    assert.throws(() => claudeCommand(COMMAND, STAMP, 'claude'), SourceError);
  });

  test('the rendered carriers differ only where the token was', () => {
    const home = methodHome();
    assert.equal(home.run(['--mode=install']).code, 0);
    for (const [rel, harness] of [['.claude/commands/handoff.md', 'claude-code'], ['.agents/skills/handoff/SKILL.md', 'codex'], ['.kiro/skills/handoff/SKILL.md', 'kiro']]) {
      const text = read(home.p(rel));
      assert.ok(!text.includes(HARNESS_TOKEN), rel);
      assert.ok(text.includes('rendered for the agent harness `' + harness + '`'), rel);
    }
  });

  test('the token in a skill or agent body stops the render', () => {
    for (const rel of ['skills/shell/SKILL.md', 'agents/developer.md']) {
      const copy = sourceCopy();
      fs.appendFileSync(path.join(copy, ...rel.split('/')), '\n{{agent-harness}}\n');
      const home = methodHome();
      const r = home.run(['--mode=install', '--source=' + copy]);
      assert.equal(r.code, 2, r.out);
      assert.ok(r.out.includes('{{agent-harness}} is for command bodies only'));
      assert.deepEqual(home.files(), [], rel);
    }
  });
});

describe('through the installer', { skip: !POSIX && 'the user-layer installer is POSIX; test/install/windows.test.js holds mhw install-windows (#497)' }, () => {
  // mhw install-user (install.sh until #503) runs the method as its own step, with its own stamp, by the
  // node that runs mhw; uninstall removes it. The admin root is a throwaway directory, as every installer run here.
  /** @param {string} home @param {string[]} args */
  function installer(home, args) {
    const env = { PATH: process.env.PATH || '', HOME: home, MHW_NODE: process.execPath, WORKSTATION_MANAGED_ROOT: path.join(home, '..', 'admin'), TMPDIR: path.join(home, '..', 'tmp') };
    fs.mkdirSync(env.TMPDIR, { recursive: true });
    const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-user', ...args, '--managed-root=' + env.WORKSTATION_MANAGED_ROOT], { env, encoding: 'utf8' });
    return { code: p.status, out: p.stdout + p.stderr, stdout: p.stdout };
  }

  test('install, check, uninstall', () => {
    const root = tempDir('installer');
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    let r = installer(home, []);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.stdout.includes('METHOD  not installed'), r.out); // off by default until the plugin cutover
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'agents', 'developer.md')));
    r = installer(home, ['--method']);
    assert.equal(r.code, 0, r.out);
    const source = /** @type {RegExpExecArray} */ (/^SOURCE {2}(.*)$/m.exec(r.stdout))[1];
    assert.ok(markerLine(path.join(home, '.kiro', 'agents', 'quality-assurance.json')).includes('; ' + source + ';'));
    assert.ok(r.stdout.includes('METHOD  installed: '));
    assert.ok(!fs.existsSync(path.join(home, SCRIPTS_DIR, 'milestone-read.py')));
    r = installer(home, ['--check']);
    assert.equal(r.code, 0, r.out);
    r = installer(home, ['--uninstall']);
    assert.equal(r.code, 0, r.out);
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'agents', 'developer.md')));
    assert.ok(!fs.existsSync(path.join(home, '.codex', 'agents', 'developer.toml')));
  });

  test('the installer no longer edits the plugin settings', () => {
    // #206: install.sh --method renders the method and leaves an enabled tadeumendonca-skills plugin, and the
    // file holding it, exactly as they were.
    const root = tempDir('installer');
    const home = path.join(root, 'home');
    fs.mkdirSync(path.join(home, '.claude'), { recursive: true });
    fs.writeFileSync(path.join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { 'tadeumendonca-skills@tadeumendonca': true } }) + '\n');
    const r = installer(home, ['--method']);
    assert.equal(r.code, 0, r.out);
    assert.ok(r.stdout.includes('METHOD  installed: '));
    assert.ok(!r.stdout.includes('tadeumendonca-skills@tadeumendonca'));
    assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.claude', 'settings.json'), 'utf8')).enabledPlugins['tadeumendonca-skills@tadeumendonca'], true);
    assert.deepEqual(filesUnder(home).filter((f) => f.endsWith('.pmhwc-plugin-backup')), [], 'nothing was retired, so no backup');
    assert.ok(!fs.existsSync(path.join(ROOT, 'global', 'method', 'plugin_retire.py')));
  });

  test('without node, the method step is skipped and says so', () => {
    const root = tempDir('installer');
    const home = path.join(root, 'home');
    fs.mkdirSync(home);
    const env = { PATH: process.env.PATH || '', HOME: home, MHW_NODE: path.join(root, 'no-node'), WORKSTATION_MANAGED_ROOT: path.join(root, 'admin'), TMPDIR: root };
    const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'install-user', '--method', '--overlay=none', '--managed-root=' + path.join(root, 'admin')], { env, encoding: 'utf8' });
    assert.ok(p.stdout.includes('REFUSE  the working method (method/): MHW_NODE (' + env.MHW_NODE + ') is not an executable file; nothing written'), p.stdout + p.stderr);
    assert.ok(!fs.existsSync(path.join(home, '.claude', 'agents')));
  });
});

// Issue #567: the positioning-sync procedure is a method skill, so every agent harness runs the same steps.
// A rule that lived only in a consumer's private, untracked note reached no agent. These are drift checks
// over the skill's STRINGS: they assert the procedure is written, never that a session followed it.
describe('the positioning-sync skill', () => {
  const POSITIONING_SYNC = src('skills/positioning-sync/SKILL.md');
  test('it carries the procedure and its key clauses', () => {
    const text = flatten(read(POSITIONING_SYNC));
    for (const clause of [
      'a positioning change propagates to every public surface in one batch, or it does not propagate.',
      'a read-only connector cannot write a profile',
      'Nothing is typed or saved on any surface before his ok.',
      '**Headline coherent across surfaces**',
      '**Years of experience consistent**',
      '**Contact address consistent**',
      '**The portfolio points at existing, non-empty repositories**',
      '**No client name on any surface**',
      '## Choices and their trade-offs',
      '**All of this is an instruction.**',
      // The lens on PR #575: order, the single ask, the relay, the record step and the consumer's surface list.
      '**No browser write starts until every gated change in the batch has merged.**',
      'a held site merge holds the whole batch.',
      '**Put the whole batch to the owner as one activation**',
      '**His ok on the text is not merge authorisation**',
      '**it posts nothing. The main session relays that result verbatim onto the Issue**',
      '**The batch is every surface the consuming project\'s surfaces list in `<private-dir>` names**',
      // The owner's ruling on #567: no record of what shipped; the live surfaces are the truth.
      '**There is no record of what shipped (owner\'s ruling on #567).**',
      'the coherence check below reads them live.',
      // The lens at 29c3475 (A7, A8): the drafts are not a record, and step 4's prose carries the order.
      'The drafts in `<private-dir>` are a working location for his read, not a record; they are not updated to match what shipped.',
      'The main session writes the drafts, in an attended session, in `<private-dir>`',
      '**The professional-network profile.** Once steps 1 to 3 have merged,',
    ]) assert.ok(text.includes(clause), clause);
    // A9: a blank line keeps the no-record ruling out of step 6's list item.
    assert.ok(read(POSITIONING_SYNC).includes('with the new positioning.\n\n**There is no record of what shipped'), 'the ruling renders inside step 6');
    const rows = read(POSITIONING_SYNC).split('\n').filter((l) => /^\| \d+ \|/.test(l));
    assert.deepEqual(rows.map((l) => l.split('|')[2].trim()), ['gated', 'gated', 'gated', 'browser', 'browser', 'browser'],
      'gated steps come before browser writes, and no record step follows them');
    // A record of what shipped, by any of its likely wordings: a copy step, a write-back to what shipped,
    // or live text written into the private directory. The one negated sentence above is removed first.
    const negated = 'they are not updated to match what shipped.';
    assert.deepEqual(text.replace(negated, '').match(
      /canonical[- ]copy|record step|update the record|(?:updated?|copied|written|brought) (?:back )?to (?:match )?what (?:actually )?shipped|to what (?:actually )?shipped|(?:update|write|copy)[^.]*<private-dir>[^.]*live text|live text[^.]*into[^.]*<private-dir>/gi) || [], [],
      'a step that keeps a record of what shipped is back');
  });
  test('it points at the skills that own the rest instead of restating them', () => {
    const text = read(POSITIONING_SYNC);
    for (const skill of ['published-voice', 'content-publishing', 'orchestration', 'merge-authority']) {
      assert.ok(text.includes('the `' + skill + '` skill'), skill);
    }
  });
  test('it names no consumer', () => {
    assert.deepEqual(read(POSITIONING_SYNC).split('\n').filter((l) => new RegExp(CONSUMER_WORDS.source, 'i').test(l)), []);
  });
  test('product-lead points at it', () => {
    const text = read(src('agents/product-lead.md'));
    assert.equal(count(text, /the `positioning-sync` skill/g), 2);
    assert.ok(!text.includes('and a sync playbook'));
  });
});
