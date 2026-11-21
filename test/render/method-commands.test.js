// Regression suite for the workflow commands (Issues #71-#75): the node:test form of the deleted
// global/method/method_commands_test.py (#489, S18 of #470), one test per Python test method. It renders
// method/ into throwaway homes (src/render/method.js, in this process) and asserts, per command and per
// agent harness, that the command is present in that harness's native carrier, that the Codex skill keeps
// implicit invocation off, and that every required section of the command reaches the rendered text. For
// /handoff (#198) it runs `mhw launch-line` (bin/mhw.js) with the harness each carrier names and checks the
// line it prints. The text checks for secret-shaped and personal data run on the paste filter's detector,
// src/lib/clean.js, called directly: the Python suite reached it through clipboard_guard.py, and (S17, #536)
// through a shim; here no shim is needed. Each check is calibrated against a known-present hit.
import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findSpans, categories, sanitise } from '../../src/lib/clean.js';
import { ROOT, SOURCE, byCode, methodHome, sourceCopy, tempDir, read, filesUnder, methodFiles, flatten, unstruckFlat } from '../helpers/method-home.js';
import { which } from '../helpers/home.js';

const POSIX = process.platform !== 'win32';
// The sections each command must carry. "What this command never does" holds the merge, publish and hook
// prohibitions.
const SHARED = ['## What this command never does'];
/** @type {Record<string, string[]>} */
const REQUIRED = {
  'new-prd': [...SHARED, '## When to use', '## Steps', '## Interview rounds', '## The requirements document'],
  'prd-to-issues': [...SHARED, '## When to use', '## Steps', '## Vertical slices', '## Definition of ready', '## Opening the Issues'],
  'what-else': [...SHARED, '## The anchored objective', '## Read the bus', '## The answer'],
  blueprint: [...SHARED, '## export', '## import', '## Alignment interview'],
  handoff: [...SHARED, '## Continuation or ask', '## The arguments', '## When to use', '## Build the prompt', '## The prompt', '## The ask prompt', '## Print it'],
  'need-me': [...SHARED, '## The rules this command runs', '## Gather what is pending', '## When nothing is pending', '## Ask one at a time', '## After he answers'],
  // #522 (owner, 2026-11-20): one bounded refinement pass, one confirmation, then the handoff.
  'backlog-grooming': [...SHARED, '## When to use', '## The shape: unattended, then ONE confirmation, then the writes', '## Steps',
    '### 6 · ONE owner activation, before any write', '### 8 · Hand off to sprint-planning', '## What nothing enforces'],
};
// The four rites moved from the plugin at #130 and became skills on 2026-10-26 ("para mim sao skills").
/** @type {Record<string, string[]>} */
const RITES = {
  'sprint-planning': ['## The trigger', '## What this rite does NOT do', '## What nothing enforces, said before any green is read'],
  'sprint-review': ['## The trigger, and where it sits among the three rites', '## What this rite cannot see'],
  'sprint-retrospective': ['## The trigger', '## What this cannot catch'],
  'funnel-review': ['## The steps', '## What this rite cannot see'],
};
const RITE_RE = '(sprint-planning|sprint-review|sprint-retrospective|funnel-review)';
// The only lines in method/ that may still name a rite's retired command path, keyed by file and phrase.
const RITE_COMMAND_HISTORY = [
  ['commands/autonomy.md', 'git cat-file -e 5cfea0b:commands/sprint-retrospective.md'],
  ['skills/sprint-planning/SKILL.md', "`grep -c 'loop-mode' commands/sprint-planning.md` returned"],
  ['skills/funnel-review/SKILL.md', "The original wording is in the plugin's `commands/funnel-review.md` at"],
  ['skills/funnel-review/SKILL.md', "Both are in the plugin's `commands/funnel-review.md` at `4882b911`"],
];
// The old names, removed at #524. None may render in any carrier.
/** @type {Record<string, string>} */
const RETIRED = { 'new-idea': 'new-prd', 'idea-to-issues': 'prd-to-issues' };
const RETIRED_NOTE = "> **Read this first: hooks named below are the retired plugin's, not controls you have (#61).**";
// Phrases that carry the behaviour the Issues require, beyond the headings.
/** @type {Record<string, string[]>} */
const PHRASES = {
  'new-prd': ['product-requirements-document-<subject>.md', 'recommended answer', 'Mermaid'],
  'prd-to-issues': ['--body-file', 'Blocked by #N', 'definition-of-ready', 'acceptance criteria'],
  'what-else': ['native goal command (`/goal`)', 'gh pr list --state open', 'owner decisions'],
  blueprint: ['product-requirements-document-agent-harness-setup.md', 'Mermaid', 'Nothing is changed before the alignment interview is complete'],
  handoff: ['re-derive the state from the tracker', 'It prints only', 'mhw launch-line', 'at most 280 characters', 'Then stop working in this session',
    '--resolve', '--env NAME=VALUE', 'and nothing after it', '--cd <the checkout>',
    // #454: the ask mode, its fallback and the owner-only routing.
    '**For an ask, do not stop:**', 'When any of these is in doubt, it is a continuation.', 'only its most recent unanswered ask', '*Hypothesis, not measured:*'],
  'need-me': ['**Escalating to the owner**', '**owner overlay**', 'Exactly **three** authored, mutually exclusive', 'one line, the act and the link',
    'Put **only the first** to him', '**Never manufacture an ask**', '--state open --label owner-action', 'queue was **not read**', '--body-file', 'quoting his'],
  'backlog-grooming': ['*Product Backlog refinement*', '--limit 200', '**If the count equals 200, stop and say so**', 'partitioned read-only dispatches',
    '**exactly one** verdict', '**"Premise no longer holds" needs a measured command and its output.**', 'never consolidate across repositories',
    '`docs/backlog-grooming/<YYYY-MM-DD>.md`', 'verbatim', '**No comment, label, edit or close happens before step 6.**', '## Consolidated from #N',
    "grep -F -- '<line>'", '/blob/<commit SHA>/', '`quality-assurance` dispatches, the median', '`loop-mode-repos`',
    '**This command creates no milestone and admits nothing to one**', '`/sprint-planning <iteration title>`', '--body-file'],
};

/** A throwaway home with method/ rendered into it. */
function rendered() {
  const home = methodHome();
  const r = home.run(['--mode=install', '--source=' + SOURCE]);
  return { home, ...r };
}

/** agent harness -> the rendered file that carries a method skill there. @param {string} root @param {string} name */
const skillCarriers = (root, name) => ({
  claude: path.join(root, '.claude', 'skills', name, 'SKILL.md'),
  codex: path.join(root, '.agents', 'skills', name, 'SKILL.md'),
  kiro: path.join(root, '.kiro', 'skills', name, 'SKILL.md'),
});
/** agent harness -> the rendered file that carries the command there. @param {string} root @param {string} name */
const carriers = (root, name) => ({
  claude: path.join(root, '.claude', 'commands', name + '.md'),
  codex: path.join(root, '.agents', 'skills', name, 'SKILL.md'),
  kiro: path.join(root, '.kiro', 'skills', name, 'SKILL.md'),
});
/** The text before the closing front-matter fence. @param {string} file */
const head = (file) => read(file).split('\n---\n', 1)[0];
/** @param {string} text */
const spans = (text) => findSpans(text);

// The detector's calibration: a text it must flag, built at run time so no secret-shaped literal is stored.
const PLANTED_TOKEN = 'gh' + 'p_' + 'Q7'.repeat(18);
const PLANTED_MAIL = 'ana.person' + '@' + 'zyxw-mail.zyxw';

test('the detector the text checks run on flags a known-present hit', () => {
  // Without this, an empty-span assertion below would pass on a detector that finds nothing.
  assert.deepEqual(categories(spans('Token: ' + PLANTED_TOKEN + '\nContact: ' + PLANTED_MAIL + '\n')), ['credential', 'email']);
});

describe('commands', () => {
  /** @type {ReturnType<typeof rendered>} */
  let r;
  before(() => { r = rendered(); });

  test('render succeeds', () => assert.equal(r.code, 0, r.out));
  test('every command is in every carrier', () => {
    for (const name of Object.keys(REQUIRED)) for (const [h, p] of Object.entries(carriers(r.home.root, name))) assert.ok(fs.statSync(p).isFile(), name + ' missing in ' + h);
  });
  test('Codex keeps implicit invocation off', () => {
    for (const name of Object.keys(REQUIRED)) {
      assert.ok(read(path.join(r.home.root, '.agents', 'skills', name, 'agents', 'openai.yaml')).includes('\npolicy:\n  allow_implicit_invocation: false\n'), name);
    }
  });
  test('invocation names per harness', () => {
    for (const name of Object.keys(REQUIRED)) {
      const c = carriers(r.home.root, name);
      // #196: argument-hint only on the owner-typed commands that take a typed argument.
      assert.equal(head(c.claude).includes('argument-hint:'), ['blueprint', 'handoff'].includes(name), name);
      assert.ok(read(c.codex).includes('Owner-typed command $' + name), name);
      assert.ok(read(c.kiro).includes('Owner-typed command /' + name), name);
      for (const h of /** @type {const} */ (['codex', 'kiro'])) assert.ok(head(c[h]).includes('name: ' + JSON.stringify(name)), name + ' ' + h);
    }
  });
  test('required sections reach every carrier', () => {
    const missing = [];
    for (const [name, headings] of Object.entries(REQUIRED)) {
      for (const [h, p] of Object.entries(carriers(r.home.root, name))) {
        const text = read(p);
        const lines = text.split('\n');
        missing.push(...headings.filter((x) => !lines.includes(x)).map((x) => name + '/' + h + ': ' + x));
        missing.push(...PHRASES[name].filter((x) => !text.includes(x)).map((x) => name + '/' + h + ': ' + x));
      }
    }
    assert.deepEqual(missing, []);
  });
  test('retired names are not rendered', () => {
    const found = [];
    for (const [old, now] of Object.entries(RETIRED)) {
      for (const [h, p] of Object.entries(carriers(r.home.root, old))) if (fs.existsSync(p)) found.push(old + '/' + h);
      if (fs.existsSync(path.join(r.home.root, '.agents', 'skills', old))) found.push(old + '/codex skill directory');
      for (const [h, p] of Object.entries(carriers(r.home.root, now))) if (!fs.existsSync(p)) found.push(now + '/' + h + ': the current name is not rendered');
    }
    assert.deepEqual(found, []);
  });
  test('the never section forbids merge, publish and hooks', () => {
    for (const name of Object.keys(REQUIRED)) {
      const never = read(carriers(r.home.root, name).claude).split('## What this command never does')[1];
      for (const word of ['merges', 'publishes', 'hook']) assert.ok(never.includes(word), name + ' ' + word);
    }
  });
  test('rendered commands carry no secret or personal data', () => {
    for (const name of Object.keys(REQUIRED)) {
      for (const [h, p] of Object.entries(carriers(r.home.root, name))) {
        const text = read(p);
        assert.deepEqual(spans(text), [], name + ' ' + h);
        // The same carrier with a planted credential is flagged, so the empty result above is not a blind check.
        assert.deepEqual(categories(spans(text + '\n' + PLANTED_TOKEN + '\n')), ['credential'], name + ' ' + h);
      }
    }
  });
});

describe('/need-me', () => {
  // The owner's /need-me (2026-10-26): it runs the escalation rules in force and restates none of them in a
  // weaker form, asks one item at a time, and writes only the record of his answer.
  const text = read(path.join(SOURCE, 'commands', 'need-me.md'));
  const body = text.split('\n---\n').slice(1).join('\n---\n');
  test('defers to the rules in force', () => {
    assert.ok(body.includes('This command adds no escalation rule of its own'));
    assert.ok(body.includes('it follows the stricter'));
  });
  test('no weaker option count', () => {
    const flat = text.replaceAll('*', '').replaceAll('`', '').replace(/\s+/g, ' ').toLowerCase();
    assert.doesNotMatch(flat, /\b(at most|up to|no more than|maximum of) (four|4)\b/);
    assert.doesNotMatch(flat, /\b(two|four|five|2|4|5) (authored |direct |answer )?(options|choices)\b/);
    assert.ok(flat.includes('exactly three authored, mutually exclusive options'));
  });
  test('an empty list is not an empty queue', () => {
    const flat = body.replace(/\s+/g, ' ');
    assert.ok(flat.includes('gh label list --repo tedeuxx/mhw --limit 1000 --json name'));
    assert.ok(flat.includes('An empty list is not yet an empty queue'));
    assert.ok(flat.includes('If `owner-action` is not among the names, or either call fails, say the queue was **not read**'));
    assert.ok(flat.includes('mhw status --summary'));
    // The repository and label the status line reads (src/lib/readers/owner-actions.js) are the ones named here.
    const reader = read(path.join(ROOT, 'src', 'lib', 'readers', 'owner-actions.js'));
    const repo = /** @type {RegExpExecArray} */ (/^export const REPO = '([^']+)';$/m.exec(reader))[1];
    const label = /** @type {RegExpExecArray} */ (/^export const LABEL = '([^']+)';$/m.exec(reader))[1];
    const queue = flat.split('**The owner-action queue**')[1].split('Then filter')[0];
    assert.deepEqual([...new Set([...queue.matchAll(/--repo (\S+)/g)].map((m) => m[1]))], [repo]);
    assert.equal((queue.match(/--repo /g) || []).length, 2);
    assert.ok(flat.includes('--label ' + label + ' '));
  });
  test('writes only the record', () => {
    const never = body.split('## What this command never does')[1];
    assert.ok(never.includes('It writes nothing except the comment that records his answer'));
    assert.ok(never.includes('It never asks two things in one message'));
    assert.ok(!body.includes('gh issue create'));
    assert.ok(!body.includes('--add-label'));
  });
});

describe('/backlog-grooming', () => {
  // The owner's /backlog-grooming (#522, 2026-11-20). Text checks over the source.
  const text = read(path.join(SOURCE, 'commands', 'backlog-grooming.md'));
  const body = text.split('\n---\n').slice(1).join('\n---\n');
  /** @param {string} from @param {string} to */
  const between = (from, to) => body.split(from)[1].split(to)[0];
  test('no milestone write and no Issue creation', () => {
    for (const needle of ['--milestone', 'milestone-create', 'milestone-update', 'milestone-close', 'gh issue create', 'gh pr merge']) assert.ok(!text.includes(needle), needle);
  });
  test('the activation comes before every write', () => {
    const steps = between('## Steps', '## What this command never does');
    const [beforeIt, afterIt] = steps.split('### 6 · ONE owner activation, before any write');
    for (const write of ['gh issue comment', 'gh issue close', 'gh issue edit', '--add-label', '--body-file']) assert.ok(!beforeIt.includes(write), write);
    assert.ok(afterIt.includes('gh issue edit'));
    assert.ok(afterIt.includes('--body-file'));
  });
  test('the criteria grep ends its options', () => {
    // The lens on PR #526: a criterion line starts with "- [ ]", so a grep without "--" reads it as an option.
    const adr = read(path.join(ROOT, 'docs', 'adr', '0043-backlog-grooming-batch-confirmation-and-scrum-for-mhw.md'));
    for (const [name, t] of [['command', body], ['ADR-0043', adr]]) {
      const uses = t.match(/grep -F[^`]*/g) || [];
      assert.ok(uses.length, name);
      assert.deepEqual(uses.filter((u) => !u.startsWith('grep -F -- ')), [], name);
    }
  });
  test('the ruling comment follows the check that can stop a merge', () => {
    const apply = between('### 7 · Apply, only after confirmation', '### 8');
    assert.ok(apply.indexOf('grep -F -- ') < apply.indexOf('quoting his ruling'));
  });
  test('a missed criterion stops the merge', () => {
    assert.ok(flatten(between('### 7 · Apply, only after confirmation', '### 8')).includes('Any miss, or any exit other than 0, stops that merge. Then close the source'));
  });
  test('the loop-mode record reads scrum', () => {
    const record = read(path.join(ROOT, 'docs', 'loop-mode.md'));
    assert.deepEqual([...record.matchAll(/^loop-mode: (\S+)$/gm)].map((m) => m[1]).slice(0, 1), ['scrum']);
    assert.deepEqual([...record.matchAll(/^loop-mode-since: (\S+)$/gm)].map((m) => m[1]).slice(0, 1), ['2026-11-20']);
    assert.deepEqual([...record.matchAll(/^loop-mode-repos: (.+)$/gm)].map((m) => m[1]).slice(0, 1), ['tedeuxx/mhw']);
    assert.ok(record.includes('issues/522#issuecomment-7049476494'));
  });
  test('exactly three options', () => {
    const activation = between('### 6 · ONE owner activation, before any write', '### 7');
    assert.deepEqual([...activation.matchAll(/^\| \*\*([a-z ]+)\*\* \|/gm)].map((m) => m[1]), ['confirm', 'confirm with changes', 'discard']);
  });
  test('the handoff and the owner name', () => {
    assert.ok(body.includes('/backlog-grooming'));
    assert.ok(body.includes('Scrum Guide'));
  });
  test('planning and the drain read the scope from the record', () => {
    const readLine = "grep -m1 '^loop-mode-repos: ' docs/loop-mode.md";
    const planning = read(path.join(SOURCE, 'skills', 'sprint-planning', 'SKILL.md'));
    const step0 = planning.split('\n## Step 0')[1].split('\n## Step 1')[0];
    const step1 = planning.split('\n## Step 1')[1].split('\n## Step 2')[0];
    assert.ok(step0.includes(readLine));
    assert.ok(step0.includes('is refused by name'));
    assert.ok(step1.includes('named on the `loop-mode-repos:` line step 0 read'));
    const autonomy = read(path.join(SOURCE, 'commands', 'autonomy.md'));
    assert.ok(autonomy.includes(readLine));
    for (const t of [step0, step1, autonomy]) assert.ok(!t.replace(/~~.*?~~/g, '').includes('BOTH repositories'));
  });
});

describe('rites', () => {
  /** @type {ReturnType<typeof rendered>} */
  let r;
  before(() => { r = rendered(); });

  test('render succeeds', () => assert.equal(r.code, 0, r.out));
  test('every rite is a skill in every carrier', () => {
    for (const name of Object.keys(RITES)) {
      assert.ok(fs.statSync(path.join(SOURCE, 'skills', name, 'SKILL.md')).isFile(), name);
      assert.ok(!fs.existsSync(path.join(SOURCE, 'commands', name + '.md')), name);
      for (const [h, p] of Object.entries(skillCarriers(r.home.root, name))) assert.ok(fs.statSync(p).isFile(), name + ' missing in ' + h);
    }
  });
  test('no command carrier and no implicit-off policy', () => {
    for (const name of Object.keys(RITES)) {
      assert.ok(!fs.existsSync(path.join(r.home.root, '.claude', 'commands', name + '.md')), name);
      assert.ok(!fs.existsSync(path.join(r.home.root, '.agents', 'skills', name, 'agents', 'openai.yaml')), name);
      for (const p of Object.values(skillCarriers(r.home.root, name))) assert.ok(!read(p).includes('Owner-typed command'), name);
    }
  });
  test('invocation by name and the argument', () => {
    for (const name of Object.keys(RITES)) {
      const [front, ...rest] = read(path.join(SOURCE, 'skills', name, 'SKILL.md')).split('\n---\n');
      const body = rest.join('\n---\n');
      for (const k of ['name', 'description', 'purpose']) assert.match(front, new RegExp('^' + k + ': "', 'm'), name + ' ' + k);
      assert.ok(front.includes('name: "' + name + '"'));
      assert.ok(!front.includes('argument-hint:'), name);
      // The argument still reaches the rite: the description says it takes one, and the body reads the text
      // typed after the name instead of a placeholder only Claude Code substitutes.
      assert.match(front, /^description: ".* as its argument, typed after its name/m, name);
      assert.ok(!body.includes('$ARGUMENTS'), name);
      assert.ok(body.includes('Claude Code `/' + name + '`, Codex `$' + name + '`, Kiro `/' + name + '`'), name);
      for (const [h, p] of Object.entries(skillCarriers(r.home.root, name))) assert.ok(head(p).includes('name: ' + JSON.stringify(name)), name + ' ' + h);
    }
  });
  test('headings and the retired note reach every carrier', () => {
    const missing = [];
    for (const [name, headings] of Object.entries(RITES)) {
      for (const [h, p] of Object.entries(skillCarriers(r.home.root, name))) {
        const text = read(p);
        const lines = text.split('\n');
        missing.push(...headings.filter((x) => !lines.includes(x)).map((x) => name + '/' + h + ': ' + x));
        if (!text.includes(RETIRED_NOTE)) missing.push(name + '/' + h + ': the retired-hooks note');
      }
    }
    assert.deepEqual(missing, []);
  });
  test('no plugin-namespaced invocation', () => {
    for (const name of Object.keys(RITES)) {
      const text = read(path.join(SOURCE, 'skills', name, 'SKILL.md'));
      const after = text.split(RETIRED_NOTE)[1];
      const body = after.slice(after.indexOf('\n\n') + 2);
      assert.doesNotMatch(body, /\/tadeumendonca-skills:[a-z]/, name);
    }
    assert.doesNotMatch(read(path.join(SOURCE, 'commands', 'autonomy.md')), /\/tadeumendonca-skills:(sprint|funnel)/);
  });
  test('pointers to the rites resolve', () => {
    /** @type {string[]} */
    const unresolved = [];
    const history = [];
    for (const rel of filesUnder(SOURCE).map((f) => path.relative(SOURCE, f).split(path.sep).join('/')).filter((f) => f.endsWith('.md') || f.endsWith('.sh')).sort(byCode)) {
      read(path.join(SOURCE, rel)).split('\n').forEach((line, n) => {
        const names = new Set([
          ...[...line.matchAll(new RegExp('skills/' + RITE_RE + '/SKILL\\.md', 'g'))].map((m) => m[1]),
          ...[...line.matchAll(new RegExp('`/' + RITE_RE + '\\b', 'g'))].map((m) => m[1]),
          ...[...line.matchAll(new RegExp('`\\$' + RITE_RE + '\\b', 'g'))].map((m) => m[1]),
        ]);
        for (const name of names) if (!fs.existsSync(path.join(SOURCE, 'skills', name, 'SKILL.md'))) unresolved.push(rel + ':' + (n + 1) + ' -> ' + name);
        if (new RegExp('commands/' + RITE_RE + '\\.md').test(line)) {
          history.push([rel, line]);
          if (!RITE_COMMAND_HISTORY.some(([f, phrase]) => rel === f && line.includes(phrase))) unresolved.push(rel + ':' + (n + 1) + ' names the retired command path: ' + line.trim().slice(0, 100));
        }
      });
    }
    assert.deepEqual(unresolved, []);
    assert.equal(history.length, RITE_COMMAND_HISTORY.length, 'a history line is gone; shrink the list');
  });
  test('a command-rendered rite is retired on install', () => {
    // An install from the earlier shape (the rites as commands) followed by one from this source leaves each
    // rite only as a skill.
    const old = sourceCopy('old-src');
    for (const name of Object.keys(RITES)) {
      const skill = path.join(old, 'skills', name, 'SKILL.md');
      const [front, ...rest] = fs.readFileSync(skill, 'utf8').split('\n---\n');
      fs.writeFileSync(path.join(old, 'commands', name + '.md'), front + '\nargument-hint: "[iteration]"\n---\n' + rest.join('\n---\n'));
      fs.rmSync(path.dirname(skill), { recursive: true });
    }
    const home = methodHome();
    const first = home.run(['--mode=install', '--source=' + old]);
    assert.equal(first.code, 0, first.out);
    for (const name of Object.keys(RITES)) {
      assert.ok(fs.statSync(home.p('.claude/commands/' + name + '.md')).isFile(), name);
      assert.ok(fs.statSync(home.p('.agents/skills/' + name + '/agents/openai.yaml')).isFile(), name);
    }
    const second = home.run(['--mode=install', '--source=' + SOURCE]);
    assert.equal(second.code, 0, second.out);
    for (const name of Object.keys(RITES)) {
      assert.ok(!fs.existsSync(home.p('.claude/commands/' + name + '.md')), name);
      assert.ok(!fs.existsSync(home.p('.agents/skills/' + name + '/agents/openai.yaml')), name);
      for (const p of Object.values(skillCarriers(home.root, name))) {
        const text = read(p);
        assert.ok(text.includes('source: method/skills/' + name + '/SKILL.md'), name);
        assert.ok(!text.includes('Owner-typed command'), name);
      }
    }
  });
  test('rendered rites carry no secret or personal data', () => {
    for (const name of Object.keys(RITES)) for (const [h, p] of Object.entries(skillCarriers(r.home.root, name))) assert.deepEqual(spans(read(p)), [], name + ' ' + h);
  });
});

const SCRIPTS_REL = '.local/share/personal-multi-harness-workstation-configuration/method/scripts';
const TOKEN = '{{method-scripts}}';
// QA's selector on #170: a repository `scripts/` executable named in prose, not a `hooks/scripts/` one.
const SCRIPT_SELECTOR = /(?<!hooks\/)(?<![a-z/])scripts\/([a-z_-]+\.(?:py|sh))/g;

/** method/**\/*.md outside method/scripts/, as paths. */
const methodMarkdown = () => methodFiles('.md').filter((rel) => !rel.startsWith('scripts/')).map((rel) => path.join(SOURCE, ...rel.split('/')));

/** The `scripts/<name>` the file's retired-plugin note lists as not shipped. @param {string} text */
function notShipped(text) {
  const out = new Set();
  for (const block of text.match(/^> \*\*Not shipped by this method:\*\*.*(?:\n>.*)*/gm) || []) {
    for (const m of block.matchAll(SCRIPT_SELECTOR)) out.add(m[1]);
  }
  return out;
}

describe('method scripts', () => {
  // #170 shipped the rites' executables with the method; #489 (D9 of #470) ships none: the rites run mhw
  // commands, and the directory receives only the documents a rite names. Every rendered rite's path into
  // it exists after a throwaway-home install.
  /** @type {ReturnType<typeof rendered>} */
  let r;
  let dir = '';
  before(() => {
    r = rendered();
    dir = r.home.p(SCRIPTS_REL);
  });
  const sourceScripts = fs.readdirSync(path.join(SOURCE, 'scripts')).filter((n) => /\.(?:py|sh)$/.test(n));

  test('render succeeds', () => assert.equal(r.code, 0, r.out));
  test('no script is installed, only the documents a rite names', () => {
    // The source holds no script since #478; one added back is not installed either (#489).
    assert.deepEqual(sourceScripts, [], 'method/scripts/ holds a script again; a rite runs an mhw command instead');
    assert.deepEqual(filesUnder(dir).map((f) => path.relative(dir, f).split(path.sep).join('/')), ['funnel-review-contract/README.md']);
  });
  test('rendered paths into the scripts directory exist', () => {
    const files = ['.claude', '.agents', '.kiro', '.codex'].flatMap((d) => filesUnder(r.home.p(d)));
    assert.ok(files.length);
    const prefix = dir + '/'; // the directory, then the source's own / (on Windows too)
    let refs = 0;
    const missing = [];
    for (const f of files) {
      const text = read(f);
      assert.ok(!text.includes(TOKEN), f);
      for (let at = text.indexOf(prefix); at >= 0; at = text.indexOf(prefix, at + 1)) {
        const name = /** @type {RegExpExecArray} */ (/^[A-Za-z0-9_.-]+(?:[\\/][A-Za-z0-9_.-]+)*/.exec(text.slice(at + prefix.length)))[0];
        refs++;
        if (!fs.existsSync(path.join(dir, name))) missing.push(path.relative(r.home.root, f) + ' -> ' + name);
      }
    }
    assert.deepEqual(missing, []);
    assert.ok(refs > 0, 'no rendered file points into the scripts directory');
    const planning = read(r.home.p('.claude/skills/sprint-planning/SKILL.md'));
    // #475, #476: the milestone routes and the worklog are mhw commands; the rite names no installed script.
    assert.ok(planning.includes('`mhw worklog`'));
    assert.ok(!planning.includes(prefix + 'worklog.py'));
    assert.ok(planning.includes('mhw milestone create "<iteration>"'));
    assert.ok(!planning.includes(prefix + 'milestone-'));
  });
  test('source references are shipped or listed', () => {
    // QA's table on #170: every `{{method-scripts}}/<name>` names a shipped document, and every remaining
    // `scripts/<name>` (QA's selector) is listed in that file's not-shipped note.
    const problems = [];
    let tokens = 0;
    for (const md of methodMarkdown()) {
      const text = read(md);
      const rel = path.relative(ROOT, md);
      for (const m of text.matchAll(/\{\{method-scripts\}\}\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/g)) {
        tokens++;
        if (!(m[1].includes('/') && fs.existsSync(path.join(SOURCE, 'scripts', ...m[1].split('/'))))) problems.push(rel + ': ' + TOKEN + '/' + m[1] + ' is not in method/scripts/');
      }
      const listed = notShipped(text);
      for (const m of text.matchAll(SCRIPT_SELECTOR)) if (!listed.has(m[1])) problems.push(rel + ': scripts/' + m[1] + ' is neither shipped nor listed as not shipped');
    }
    assert.deepEqual(problems, []);
    assert.ok(tokens > 0);
  });
  test('no live instruction runs an installed method script with python3 (#489)', () => {
    // The Issue's criterion: `git grep -nE 'python3 .*method/scripts' method/` returns no live instruction.
    // A struck span (~~...~~) is history, so it is removed first; what is left must name none.
    const live = [];
    for (const md of methodMarkdown()) {
      for (const p of read(md).split('\n\n')) {
        const text = unstruckFlat(p);
        if (/python3 .*method\/scripts/.test(text)) live.push(path.relative(ROOT, md) + ': ' + text.slice(0, 120));
      }
    }
    assert.deepEqual(live, []);
    // Calibration: the same check flags such a line when it is live, and passes it when struck.
    assert.match(unstruckFlat('Run `python3 <installed method/scripts>/milestone-read.py`.'), /python3 .*method\/scripts/);
    assert.doesNotMatch(unstruckFlat('~~Run `python3 <installed method/scripts>/milestone-read.py`.~~'), /python3 .*method\/scripts/);
  });
  test('a token naming no document stops the render', () => {
    const copy = sourceCopy();
    fs.appendFileSync(path.join(copy, 'commands', 'autonomy.md'), '\nRun `python3 ' + TOKEN + '/nope.py`.\n');
    const home = methodHome();
    const out = home.run(['--mode=install', '--source=' + copy]);
    assert.equal(out.code, 2, out.out);
    assert.ok(out.stderr.includes('nope.py names no file in method/scripts/'));
    assert.ok(!fs.existsSync(home.p(SCRIPTS_REL)), 'nothing is written when the source is invalid');
  });
  test('a script in the source is neither installed nor nameable (#489)', () => {
    const copy = sourceCopy();
    fs.writeFileSync(path.join(copy, 'scripts', 'tool.py'), 'print(1)\n');
    const home = methodHome();
    let out = home.run(['--mode=install', '--source=' + copy]);
    assert.equal(out.code, 0, out.out);
    assert.ok(!fs.existsSync(home.p(SCRIPTS_REL + '/tool.py')));
    fs.appendFileSync(path.join(copy, 'commands', 'autonomy.md'), '\nRun `python3 ' + TOKEN + '/tool.py`.\n');
    out = home.run(['--mode=install', '--source=' + copy]);
    assert.equal(out.code, 2, out.out);
    assert.ok(out.stderr.includes('{{method-scripts}}/tool.py names no file in method/scripts/'), out.stderr);
  });
  test('uninstall removes the documents', () => {
    const home = rendered().home;
    assert.ok(filesUnder(home.p(SCRIPTS_REL)).length);
    home.run(['--mode=uninstall'], { stamp: null, optIn: false });
    assert.deepEqual(filesUnder(home.p(SCRIPTS_REL)), []);
  });
});

// B2 on #170: every `CLAUDE.md` left in method/ is on this list, keyed by file and by a phrase of the line.
const CLAUDE_MD_ALLOWED = [
  ['agents/quality-assurance.md', '`CLAUDE.md`, `AGENTS.md`, `.claude/`, `.codex/` and `.github/` at any depth'],
  ['agents/quality-assurance.md', '`docs/CLAUDE.md` is in the consuming class'],
  ['agents/quality-assurance.md', '`AGENTS.md` · `CLAUDE.md`, **at any depth**'],
  ['agents/quality-assurance.md', '`apps/<unit>/CLAUDE.md` and `apps/<unit>/.claude/settings.json`'],
  ['agents/quality-assurance.md', '`CLAUDE.md` when it works in that subtree'],
  ['agents/quality-assurance.md', 'a product diff that edits `.github/workflows/` or `CLAUDE.md`'],
  ['agents/quality-assurance.md', '`-io` #667 (`CLAUDE.md`,'],
  ['agents/quality-assurance.md', '`apps/fed/CLAUDE.md`), #647'],
  ['agents/quality-assurance.md', '`.mcp.json`, `AGENTS.md`, `CLAUDE.md` and the rite'],
  ['agents/quality-assurance.md', '`apps/café/CLAUDE.md` each carried'],
  ['agents/quality-assurance.md', 'a quoted `.claude/`, `.codex/`, `.github/`, `AGENTS.md` or `CLAUDE.md`'],
  ['agents/quality-assurance.md', 'corrected in `CLAUDE.md` this round'],
  ['agents/scrum-master.md', '# 5 issues -> README.md · CLAUDE.md'],
  ['skills/funnel-review/SKILL.md', '`CLAUDE.md` until #562'],
  ['commands/new-issue.md', '`apps/*/AGENTS.md` or `apps/*/CLAUDE.md`'],
];

test('the root brief is AGENTS.md: every CLAUDE.md left in method/ is allowlisted', () => {
  // #170 B2: a CLAUDE.md that remains is a path in a class list, a dated measurement or history.
  const found = [];
  /** @type {string[]} */
  const unlisted = [];
  for (const md of methodMarkdown()) {
    const rel = path.relative(SOURCE, md).split(path.sep).join('/');
    read(md).split('\n').forEach((line, n) => {
      if (!line.includes('CLAUDE.md')) return;
      found.push(rel + ':' + (n + 1));
      if (!CLAUDE_MD_ALLOWED.some(([f, phrase]) => rel === f && line.includes(phrase))) unlisted.push(rel + ':' + (n + 1) + ' ' + line.trim().slice(0, 120));
    });
  }
  assert.deepEqual(unlisted, []);
  assert.equal(found.length, CLAUDE_MD_ALLOWED.length, 'an allowlisted line is gone; shrink the list');
});

/** @type {Record<string, string>} */
const LAUNCH_PREFIX = { 'claude-code': "claude '", codex: "codex '", kiro: "kiro-cli chat '" };
const IDE_PHRASE = 'For the Kiro IDE, replace `kiro-cli chat` with `kiro chat`';
const TOKEN_RE = /\{\{[a-z][a-z-]*\}\}/;
// A prompt the template could produce, with the characters that break a hand-quoted line. Synthetic values.
const PROMPT = "Objective: ship the owner's handoff command\n"
  + 'Continue owner/repo#12 in this fresh session; the session that printed this prompt stops now.\n'
  + "Next act: run the suite; it's green when 'OK' prints, not $HOME or $(date) or `id`.\n"
  + 'Evidence: ```fence``` and \\n and "quoted" and !! and \\\'\' stay as typed.\n'
  + 'Before acting, re-derive the state from the tracker: gh issue view 12 --repo owner/repo --comments.';
const SHELLS = ['sh', 'bash', ...(which('zsh') ? ['zsh'] : [])];
const PROBE_VAR = 'MHW_PROBE_LAUNCH_VAR';
const LAUNCH_LINE = [process.execPath, path.join(ROOT, 'bin', 'mhw.js'), 'launch-line'];
// The checkout the block changes into (#198). Its name carries a space, a single quote, `$` and backticks.
const CHECKOUT_NAME = "it's a $HOME `id` checkout";

describe('/handoff', { skip: !POSIX && 'the launch line is POSIX shell; Windows ends with the prompt instead (QA B1 on #230)' }, () => {
  /** @type {ReturnType<typeof rendered>} */
  let r;
  let checkout = '';
  let base = '';
  before(() => {
    r = rendered();
    base = tempDir('handoff');
    checkout = path.join(tempDir('checkouts'), CHECKOUT_NAME);
    fs.mkdirSync(path.join(checkout, '.git'), { recursive: true });
  });

  /** @param {string} harness @param {string} prompt @param {string[]} extra @param {boolean} [cd] */
  function launch(harness, prompt, extra = [], cd = true) {
    const f = path.join(fs.mkdtempSync(path.join(base, 'prompt-')), 'prompt.txt');
    fs.writeFileSync(f, prompt);
    return spawnSync(LAUNCH_LINE[0], [...LAUNCH_LINE.slice(1), harness, f, ...(cd ? ['--cd', checkout] : []), ...extra], { encoding: 'utf8' });
  }
  /** @param {string[]} argv */
  const resolve = (...argv) => spawnSync(LAUNCH_LINE[0], [...LAUNCH_LINE.slice(1), '--resolve', ...argv], { encoding: 'utf8' });

  /** (the lines before the fenced block, the block's command line); fails unless stdout ENDS with one block. @param {string} stdout */
  function theBlock(stdout) {
    const lines = stdout.replace(/\n+$/, '').split('\n');
    const fences = lines.map((l, n) => (/^`{3,}$/.test(l) ? n : -1)).filter((n) => n >= 0);
    if (fences.length !== 2 || fences[1] !== lines.length - 1 || lines[fences[0]] !== lines[fences[1]]) assert.fail('not one fenced block at the end: ' + stdout.slice(0, 200));
    return { before: lines.slice(0, fences[0]), line: lines.slice(fences[0] + 1, fences[1]).join('\n') };
  }
  /** The block's line with its leading cd removed; fails unless it opens with it. @param {string} line */
  function afterCd(line) {
    const cd = "cd '" + checkout.replaceAll("'", "'\\''") + "' && ";
    assert.ok(line.startsWith(cd), line.slice(0, 80));
    return line.slice(cd.length);
  }
  /**
   * Run the block's line with the agent harness's command defined as a shell function printing each argument
   * NUL-separated, after PWD=<the directory it runs in>.
   * @param {string} shell @param {string} line @param {string} command
   */
  function argvThrough(shell, line, command) {
    const headWord = command.split(' ')[0] + ' ';
    assert.ok(line.includes(headWord), 'the command ' + headWord + ' is not in the line');
    const script = 'harness_argv() { printf "PWD=%s\\0" "$PWD"; printf \'%s\\0\' "$@"; }\n' + line.replace(headWord, 'harness_argv ');
    return spawnSync(shell, ['-c', script], { encoding: 'utf8' });
  }
  /** @param {string} out */
  const fields = (out) => out.split('\0').slice(0, -1);
  /** The template under a heading. @param {string} text @param {string} heading */
  function template(text, heading) {
    const found = new RegExp('\\n' + heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\n[\\s\\S]*?```\\n([\\s\\S]*?)```').exec(text);
    if (!found) assert.fail('no template under ' + heading);
    return found[1];
  }
  const handoffTexts = () => ({ source: read(path.join(SOURCE, 'commands', 'handoff.md')), ...Object.fromEntries(Object.entries(carriers(r.home.root, 'handoff')).map(([c, p]) => [c, read(p)])) });

  test('render succeeds', () => assert.equal(r.code, 0, r.out));

  test('each carrier defaults to its own harness', () => {
    for (const [carrier, harness] of Object.entries({ claude: 'claude-code', codex: 'codex', kiro: 'kiro' })) {
      const p = carriers(r.home.root, 'handoff')[/** @type {'claude'} */ (carrier)];
      assert.deepEqual([...new Set([...read(p).matchAll(/mhw launch-line --resolve (\S+) /g)].map((m) => m[1]))], [harness], carrier);
      for (const words of [[], ['ship'], ['Claude'], ['$x']]) assert.equal(resolve(harness, ...words).stdout, harness + '\nkept\n', carrier + ' ' + words);
      const out = launch(harness, PROMPT);
      assert.equal(out.status, 0, out.stderr);
      assert.ok(afterCd(theBlock(out.stdout).line).startsWith(LAUNCH_PREFIX[harness]), carrier);
      assert.ok(!out.stdout.includes(IDE_PHRASE), carrier);
    }
  });

  test('an explicit target overrides the current harness', () => {
    /** @type {Record<string, string>} */
    const names = { 'claude-code': 'claude-code', claude: 'claude-code', codex: 'codex', kiro: 'kiro', 'kiro-cli': 'kiro' };
    for (const current of Object.keys(LAUNCH_PREFIX)) for (const [word, target] of Object.entries(names)) assert.equal(resolve(current, word).stdout, target + '\nconsumed\n', current + ' ' + word);
    for (const [word, target] of Object.entries(names)) {
      const out = launch(word, PROMPT);
      assert.equal(out.status, 0, out.stderr);
      const line = afterCd(theBlock(out.stdout).line);
      assert.ok(line.startsWith(LAUNCH_PREFIX[target]), word);
      for (const [other, prefix] of Object.entries(LAUNCH_PREFIX)) if (other !== target) assert.ok(!line.startsWith(prefix), word + ' ' + other);
    }
    assert.equal(resolve('cursor').status, 2);
    assert.equal(resolve().status, 2);
  });

  test('the block carries the prompt inline and exactly', () => {
    for (const [target, prefix] of Object.entries(LAUNCH_PREFIX)) {
      const out = launch(target, PROMPT);
      assert.equal(out.status, 0, out.stderr);
      const { before: pre, line } = theBlock(out.stdout);
      assert.deepEqual(pre, [], target);
      const command = prefix.slice(0, -2);
      for (const shell of SHELLS) {
        assert.equal(spawnSync(shell, ['-n', '-c', line]).status, 0, target + ' ' + shell);
        const p = argvThrough(shell, line, command);
        assert.equal(p.status, 0, target + ' ' + shell + ' ' + p.stderr);
        assert.deepEqual(fields(p.stdout), ['PWD=' + checkout, ...command.split(' ').slice(1), PROMPT], target + ' ' + shell);
      }
    }
  });

  test('the block is exactly one command', () => {
    for (const [target, prefix] of Object.entries(LAUNCH_PREFIX)) {
      const out = launch(target, PROMPT);
      assert.equal(out.status, 0, out.stderr);
      const { before: pre, line } = theBlock(out.stdout);
      assert.deepEqual(pre, [], target);
      assert.ok(afterCd(line).startsWith(prefix), target);
      for (const shell of SHELLS) assert.deepEqual(fields(argvThrough(shell, line, prefix.slice(0, -2)).stdout).filter((f) => f.startsWith('PWD=')), ['PWD=' + checkout], target + ' ' + shell);
    }
  });

  test('the cd is required and checked', () => {
    assert.equal(launch('codex', PROMPT, [], false).status, 2);
    assert.equal(launch('codex', PROMPT, ['--cd', checkout]).status, 2);
    const plain = tempDir('plain');
    for (const [label, p, needle] of [['relative', 'some/checkout', 'not an absolute path'], ['missing', path.join(plain, 'absent'), 'not an existing directory'],
      ['no .git', plain, 'not a git checkout'], ['newline', checkout + '\nid', 'control character or a line break']]) {
      const out = launch('codex', PROMPT, ['--cd', p], false);
      assert.equal(out.status, 1, label);
      assert.equal(out.stdout, '', label);
      assert.ok(out.stderr.includes(needle), label);
    }
  });

  test('a prompt opening with /goal is refused', () => {
    assert.ok(!PROMPT.startsWith('/goal'));
    assert.equal(launch('codex', PROMPT).status, 0);
    for (const prompt of ['/goal ship it\nNext act: run it.', '/goal', '/goal  x']) {
      const out = launch('codex', prompt);
      assert.equal(out.status, 1, prompt);
      assert.equal(out.stdout, '', prompt);
    }
    assert.ok(launch('codex', '/goal ship it').stderr.includes('the first line opens with /goal'));
    assert.equal(launch('codex', 'Objective: x\nmention /goal here').status, 0);
  });

  test('terminal and bidi controls are refused without echo', () => {
    const secret = 'SENTINELTEXT';
    for (const [label, ch] of Object.entries({ '^C': '\x03', 'ESC[201~': '\x1b[201~', '^U': '\x15', TAB: '\t', CR: '\r', DEL: '\x7f', 'U+202E': String.fromCodePoint(0x202e), 'U+2066': String.fromCodePoint(0x2066) })) {
      const out = launch('claude-code', 'Objective: fix it\nNext act: ' + ch + ' ' + secret + '; touch pwned');
      assert.equal(out.status, 1, label);
      assert.equal(out.stdout, '', label);
      assert.ok(out.stderr.includes('line 2 carries a control character'), label);
      assert.ok(!out.stderr.includes(secret), label);
    }
    assert.equal(launch('codex', PROMPT).status, 0);
  });

  test('the method declares no launch variable', () => {
    for (const name of ['HARNESS_SWEEP_ORIGIN', PROBE_VAR, 'CODEX_HOME']) {
      const out = launch('codex', PROMPT, ['--env', name + '=https://example.org']);
      assert.equal(out.status, 1, name);
      assert.equal(out.stdout, '', name);
      assert.ok(out.stderr.includes('--env 1: the name is not a declared launch variable (none is declared)'), name);
    }
  });

  test('a backtick run cannot close the fence', () => {
    const prompt = 'Objective: keep ```` four and ````` five backticks';
    const out = launch('codex', prompt);
    assert.equal(out.status, 0, out.stderr);
    assert.ok(out.stdout.startsWith('``````\n'));
    assert.deepEqual(fields(argvThrough('sh', theBlock(out.stdout).line, 'codex').stdout), ['PWD=' + checkout, prompt]);
  });

  test('no rendering token survives', () => {
    const left = ['.claude', '.agents', '.kiro', '.codex'].flatMap((d) => filesUnder(r.home.p(d))).filter((f) => TOKEN_RE.test(read(f)));
    assert.deepEqual(left, []);
  });

  test('the Claude command carries the argument hint', () => {
    assert.ok(read(carriers(r.home.root, 'handoff').claude).split('\n---\n')[0].includes('argument-hint: "[claude-code|claude|codex|kiro|kiro-cli] '));
  });

  test('the old two-step rules survive only struck', () => {
    for (const [where, text] of Object.entries(handoffTexts())) {
      const body = unstruckFlat(text);
      for (const old of ['does not open with `/goal`', 'carries its own `/goal` line', '/goal <the objective', 'open the terminal in a different checkout',
        'output opens with one line for the Kiro IDE', 'Do not work in the same checkout as the old session']) {
        assert.ok(!body.includes(old), where + ' ' + old);
      }
      assert.ok(body.includes('The block is exactly one command: `cd` into the checkout'), where);
      assert.ok(body.includes('prompt whose first line opens with `/goal`'), where);
    }
  });

  test('Windows ends with the prompt in one fenced block', () => {
    const rule = '**On Windows, end your reply instead with the filled prompt in one fenced block, and nothing after it.**';
    for (const [where, text] of Object.entries(handoffTexts())) {
      const body = flatten(text);
      assert.ok(body.includes(rule), where);
      assert.ok(body.includes('do not print its output'), where);
      assert.ok(!body.includes('paste the prompt into a new session instead'), where);
    }
  });

  test('unsafe prompts are refused without echo', () => {
    const local = '/Use' + 'rs/someone/notes.txt';
    for (const [label, prompt] of Object.entries({ 'goal first': '/goal continue owner/repo#12.', long: 'Objective: ' + 'x'.repeat(300),
      'local path': 'Objective: fix it\nEvidence: ' + local, empty: '\n' })) {
      const out = launch('codex', prompt);
      assert.equal(out.status, 1, label);
      assert.equal(out.stdout, '', label);
      assert.ok(!out.stderr.includes('someone'), label);
    }
    assert.equal(launch('cursor', PROMPT).status, 2);
  });

  test('a prompt file outside the allowed roots is refused', () => {
    const inside = fs.mkdtempSync(path.join(base, 'prompt-'));
    const big = path.join(inside, 'big.txt');
    fs.writeFileSync(big, 'Objective: x\n' + ('y'.repeat(200) + '\n').repeat(400));
    for (const [label, p, needle] of [['traversal', inside + '/..'.repeat(40) + '/etc/hosts', 'outside the repository work tree'],
      ['directory', inside, 'not a regular file'], ['size', big, 'over 65536 bytes']]) {
      const out = spawnSync(LAUNCH_LINE[0], [...LAUNCH_LINE.slice(1), 'codex', p, '--cd', checkout], { encoding: 'utf8' });
      assert.equal(out.status, 1, label);
      assert.equal(out.stdout, '', label);
      assert.ok(out.stderr.includes(needle), label);
    }
  });

  test('both templates and the fallback are in every carrier', () => {
    /** @type {Record<string, string>} */
    const own = { source: '{{agent-harness}}', claude: 'claude-code', codex: 'codex', kiro: 'kiro' };
    for (const [where, text] of Object.entries(handoffTexts())) {
      const cont = template(text, '## The prompt');
      const ask = template(text, '## The ask prompt');
      assert.ok(cont.includes('the session that printed this prompt stops now.'), where);
      assert.ok(!cont.includes('keeps running'), where);
      assert.ok(!ask.includes('stops now'), where);
      for (const line of ['the session that printed this prompt keeps running and waits for the result.',
        'Owner-only: <the acts in the ask only the owner may perform, or none>; guide the owner to each one and never perform it yourself.',
        'Change no file in this checkout: the session that printed this prompt works in it.',
        'Return: post the result on <owner/repo>#<n> with gh issue comment <n> --repo <owner/repo> --body-file <a file>, then tell the owner it is posted.']) {
        assert.ok(ask.includes(line), where + ' ' + line.slice(0, 40));
      }
      assert.ok(ask.startsWith('Objective: '), where);
      const body = unstruckFlat(text);
      assert.ok(body.includes('1. `$ARGUMENTS` is empty. Any argument gives a continuation, and `/handoff ' + own[where] + '` (this agent harness named as the target) forces one.'), where);
      assert.ok(body.includes('mhw launch-line --resolve ' + own[where] + ' <its id>'), where);
      assert.ok(body.includes('When any of these is in doubt, it is a continuation.'), where);
      assert.ok(body.includes('**For an ask, do not stop:**'), where);
      assert.ok(body.includes('Then stop working in this session, for a continuation.'), where);
    }
  });

  test('the ask template, filled, passes the launch line for every target', () => {
    const ask = template(read(path.join(SOURCE, 'commands', 'handoff.md')), '## The ask prompt').replace(/\n+$/, '');
    const filled = ask.replaceAll('<owner/repo>', 'owner/repo').replaceAll('<n>', '12')
      .replaceAll('<the ask, one act, one line>', 'approve the Codex prompt hook')
      .replaceAll('<branch> <commit>', 'loop/12-x ' + 'a'.repeat(40))
      .replaceAll('<the act the printing session asked the owner to carry out in this agent harness, one line>', 'open /hooks and approve the workstation prompt hook')
      .replaceAll('<the acts in the ask only the owner may perform, or none>', 'approving the hook')
      .replaceAll('<a file>', 'result.md');
    assert.ok(!filled.includes('<'));
    assert.deepEqual(spans(filled), []);
    for (const [target, prefix] of Object.entries(LAUNCH_PREFIX)) {
      const out = launch(target, filled);
      assert.equal(out.status, 0, target + ' ' + out.stderr);
      const { before: pre, line } = theBlock(out.stdout);
      assert.deepEqual(pre, [], target);
      assert.deepEqual(fields(argvThrough('sh', line, prefix.slice(0, -2)).stdout), ['PWD=' + checkout, ...prefix.slice(0, -2).split(' ').slice(1), filled], target);
      assert.equal(resolve(target, target).stdout, target + '\nconsumed\n', target);
    }
    for (const word of ['kiro-ide', 'desktop', 'cursor']) assert.equal(resolve('codex', word).stdout, 'codex\nkept\n', word);
  });

  test('the prompt template carries no secret or personal data', () => {
    const t = template(read(path.join(SOURCE, 'commands', 'handoff.md')), '## The prompt');
    assert.ok(t.startsWith('Objective: '));
    assert.ok(!t.includes('/goal'));
    assert.deepEqual(spans(t), []);
    assert.deepEqual(spans(PROMPT), []);
  });
});

describe('handover sanitisation', () => {
  // #73: a synthetic handover prompt with planted secret-shaped and personal data is caught by the paste
  // filter's detector, and the same prompt without them passes. The planted values are built at run time.
  const CLEAN = 'Session type: Bugfix\nObjective: fix the release script.\nIssue: owner/repo#12\n'
    + 'Context: read scripts/release.sh and the comments on #12.\nConstraints: no merge.\n'
    + "Done when: the release check passes.\nWhen done, comment on #12 under '## Return to the parent "
    + "session' with the result and evidence, and print the same text as a return prompt.\n";
  test('a clean prompt has no finding', () => assert.deepEqual(spans(CLEAN), []));
  test('planted values are caught and redacted', () => {
    const dirty = CLEAN + 'Token: ' + PLANTED_TOKEN + '\nContact: ' + PLANTED_MAIL + '\n';
    const found = spans(dirty);
    assert.deepEqual(categories(found), ['credential', 'email']);
    const cleaned = sanitise(dirty, found);
    assert.ok(!cleaned.includes(PLANTED_TOKEN));
    assert.ok(!cleaned.includes(PLANTED_MAIL));
    assert.deepEqual(spans(cleaned), []);
  });
});
