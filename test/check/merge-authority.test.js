// The merge-authority contract (#195), moved from global/merge_authority_test.py with the check (#494, S23
// of #470): the method's operational copies against the canonical contract, and `mhw check --project=DIR`
// against a project brief. Throwaway HOMEs and project directories only; nothing outside TMPDIR is written.
//
// Every negative case mutates the SUBJECT (a method file's text, a project brief, an installed copy),
// asserts red, restores it and asserts green. These are checks over strings and one bounded block: they
// cannot observe a gate follow the contract, and a paraphrase outside the parsed surface stays a false
// negative (asserted below, so the limit is visible).
import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ma from '../../src/lib/merge-authority.js';
import { splitFrontMatter } from '../../src/render/method.js';
import { MERGE_LITERALS, RETIRED_LITERALS } from '../../.github/scripts/review-status.js';
import { throwawayHome } from '../helpers/home.js';
import { BLOCK, CORRECTED_SECTION, HISTORY, LEGACY_SECTION, RC_BRIEF, brief } from './briefs.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = path.join(REPO, 'method', 'skills', 'merge-authority', 'SKILL.md');
/** A file as Python's read_text read it: universal newlines (a Windows checkout has CRLF). @param {string} p */
const readText = (p) => fs.readFileSync(p, 'utf8').replaceAll('\r\n', '\n');
/** @param {string} rel */
const read = (rel) => readText(path.join(REPO, rel));
const CONTRACT = ma.parseContract(readText(SKILL), 'source');
const TRUNK = CONTRACT.models['trunk-single-env'];
// Each operational copy, and the verdicts it must still name outside its projection block. quality-gates
// names only the clearance literal in its prose; the projection block carries the rest.
/** @type {Record<string, string[]>} */
const CONSUMERS = {
  'method/agents/quality-assurance.md': CONTRACT.verdicts,
  'method/skills/agents-configuration/SKILL.md': CONTRACT.verdicts,
  'method/commands/autonomy.md': CONTRACT.verdicts,
  'method/skills/quality-gates/SKILL.md': [TRUNK.boundary],
};
/** Every .md under a directory, recursively. @param {string} dir @returns {string[]} */
function markdown(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return markdown(p);
    return e.name.endsWith('.md') ? [p] : [];
  });
}
/** The source files the acceptance greps read: every method/*.md and workspace/README.md. */
const SOURCES = [...markdown(path.join(REPO, 'method')), path.join(REPO, 'workspace', 'README.md')];

/**
 * A method source's front matter, read by the renderer's own parser (src/render/method.js, Node since
 * #489), as the rendered agent metadata is.
 * @param {string} text
 * @returns {Record<string, string | string[]>}
 */
const frontMatter = (text) => Object.fromEntries(splitFrontMatter(text, 'qa').fields);

describe('the method copies match the contract', () => {
  test('the contract maps both models', () => {
    assert.deepEqual(Object.keys(CONTRACT.models).sort(), ['gitflow-multi-env', 'trunk-single-env']);
    assert.equal(TRUNK.executor, 'quality-assurance');
    assert.deepEqual(TRUNK.holds, ['gate-authority', 'harness-marker', 'iac', 'lens-escalate']);
    // #134 (contract v3): one clearance literal for both classes; the boundary literal is retired.
    assert.equal(TRUNK.boundary, 'APPROVE-AND-MERGE');
    assert.equal(TRUNK.safe, TRUNK.boundary);
    assert.deepEqual(CONTRACT['retired-verdicts'], ['APPROVE-AND-MERGE-BOUNDARY']);
    assert.ok(!CONTRACT.verdicts.includes('APPROVE-AND-MERGE-BOUNDARY'));
    const gitflow = CONTRACT.models['gitflow-multi-env'];
    // The trunk executor rule is not imported: in gitflow the boundary class is itself a hold.
    assert.equal(gitflow.boundary, 'APPROVE-PENDING-HUMAN');
    assert.ok(gitflow.holds.includes('boundary-class'));
    // #133 (contract v2): held merges, the promotion included, are executed by the gate on the owner's cited comment.
    assert.equal(gitflow['promotion-executor'], 'quality-assurance');
    assert.equal(gitflow['hold-executor'], 'quality-assurance');
    assert.equal(TRUNK['hold-executor'], 'quality-assurance');
    // The rc/next variant (scm): a declared integration branch adds the release-candidate hold.
    assert.deepEqual(TRUNK['with-integration-branch'], { holds: ['release-candidate'], 'promotion-executor': 'quality-assurance' });
    assert.ok(ma.projection(CONTRACT).includes('release candidate'));
  });

  test('every operational copy is green: its projection block is the one Node generates from the contract', () => {
    for (const [rel, verdicts] of Object.entries(CONSUMERS)) {
      const text = read(rel);
      assert.deepEqual(ma.methodCopyFindings(text, CONTRACT, verdicts), [], rel);
      assert.equal(ma.projectionBlock(text), ma.projection(CONTRACT), rel);
    }
  });

  test('every copy goes red on each mutation and green on restore', () => {
    // Scenario 6: an executor, a verdict literal and a hold, mutated in each copy independently.
    const mutations = [
      ['`quality-assurance` merges what it clears', '`owner` merges what it clears', 'executor'],
      ['boundary class -> `APPROVE-AND-MERGE`', 'boundary class -> `APPROVE-PENDING-HUMAN`', 'verdict'],
      ['(3) anything in `iac/`; ', '', 'hold removed'],
      ['4 holds -> ', '5 holds -> ', 'hold count'],
    ];
    for (const [rel, verdicts] of Object.entries(CONSUMERS)) {
      const original = read(rel);
      for (const [old, now, what] of mutations) {
        assert.ok(original.includes(old), rel + ' ' + what);
        assert.ok(ma.methodCopyFindings(original.replace(old, now), CONTRACT, verdicts).length, rel + ' ' + what + ' stayed green');
        assert.deepEqual(ma.methodCopyFindings(original, CONTRACT, verdicts), []);
      }
      const v = verdicts[verdicts.length - 1];
      const block = /** @type {string} */ (ma.projectionBlock(original));
      const prose = original.replace(block, '@@BLOCK@@');
      const mutated = prose.replaceAll(v, 'DELETED').replace('@@BLOCK@@', block);
      assert.ok(ma.methodCopyFindings(mutated, CONTRACT, verdicts).includes('no longer names ' + v), rel);
      assert.ok(ma.methodCopyFindings(original + '\n\nThe gate escalates the boundary class to the owner.\n', CONTRACT, verdicts).length, rel);
    }
  });

  test('the gate preloads the contract and its description carries the mapping', () => {
    const fields = frontMatter(read('method/agents/quality-assurance.md'));
    assert.ok(fields.skills.includes('merge-authority'));
    const desc = String(fields.description).toLowerCase();
    for (const key of ['safe', 'boundary', 'on-hold']) assert.ok(desc.includes(TRUNK[key].toLowerCase()), key);
    assert.ok(desc.includes('the ' + { 4: 'four', 5: 'five' }[/** @type {4 | 5} */ (TRUNK.holds.length)] + ' holds'));
  });

  test('the delivery route merges on exactly the trunk clearances', () => {
    assert.deepEqual([...MERGE_LITERALS], [...new Set([TRUNK.safe, TRUNK.boundary])]);
    assert.deepEqual([...RETIRED_LITERALS], CONTRACT['retired-verdicts']);
  });
});

describe('one clearance literal (#134)', () => {
  test('the contract is version 3 and carries the owner-check rule', () => {
    assert.equal(CONTRACT.version, 3);
    const rule = CONTRACT['owner-check'];
    for (const needle of ['`owner-check:` line directly under its `head:` line', '`none`', 'exactly one live act',
      'each Issue the pull request references', 'malformed']) assert.ok(rule.includes(needle), needle);
    const text = ma.projection(CONTRACT);
    assert.ok(text.includes('- Owner check: ' + rule + '.'));
    assert.ok(text.includes('- Retired verdicts, refused by every reader: `APPROVE-AND-MERGE-BOUNDARY`.'));
  });

  test('each copy goes red when the retired literal returns to its live prose, and history stays green', () => {
    for (const [rel, verdicts] of Object.entries(CONSUMERS)) {
      const original = read(rel);
      const live = original + '\n\nBoundary class merges under `APPROVE-AND-MERGE-BOUNDARY`.\n';
      const fenced = original + '\n\n```\nBoundary class merged under `APPROVE-AND-MERGE-BOUNDARY`.\n```\n';
      const quoted = original + '\n\n> Boundary class merged under `APPROVE-AND-MERGE-BOUNDARY`.\n';
      assert.ok(ma.methodCopyFindings(live, CONTRACT, verdicts).includes('its live prose names the retired verdict APPROVE-AND-MERGE-BOUNDARY'), rel);
      assert.deepEqual(ma.methodCopyFindings(fenced, CONTRACT, verdicts), [], rel);
      assert.deepEqual(ma.methodCopyFindings(quoted, CONTRACT, verdicts), [], rel);
      assert.deepEqual(ma.methodCopyFindings(original, CONTRACT, verdicts), [], rel);
    }
  });

  test('a retired literal planted above any heading of any copy goes red', () => {
    // Gate round 2 on PR #423 (B2): a list-indented fence once inverted every strike pairing after it.
    const plant = 'Boundary class merges under `APPROVE-AND-MERGE-BOUNDARY` again.\n\n';
    for (const [rel, verdicts] of Object.entries(CONSUMERS)) {
      const original = read(rel);
      const positions = [...original.matchAll(/^## /gm)].map((m) => /** @type {number} */ (m.index));
      assert.ok(positions.length, rel);
      for (const pos of positions) {
        const mutated = original.slice(0, pos) + plant + original.slice(pos);
        assert.ok(ma.methodCopyFindings(mutated, CONTRACT, verdicts).includes('its live prose names the retired verdict APPROVE-AND-MERGE-BOUNDARY'),
          rel + ' ' + original.slice(pos, original.indexOf('\n', pos)).slice(0, 50));
      }
    }
  });

  test('each copy goes red when the owner-check rule is dropped or weakened in its block', () => {
    const line = '- Owner check: ' + CONTRACT['owner-check'] + '.\n';
    for (const [rel, verdicts] of Object.entries(CONSUMERS)) {
      const original = read(rel);
      assert.ok(original.includes(line), rel);
      const weakened = line.replace('A verdict without the line is malformed', 'A verdict without the line is fine');
      for (const mutated of [original.replace(line, ''), original.replace(line, weakened)]) {
        assert.ok(ma.methodCopyFindings(mutated, CONTRACT, verdicts).includes('the projection block differs from the contract'), rel);
      }
    }
  });

  test('no method or workspace file names the retired literal in live prose', () => {
    for (const p of SOURCES) {
      const text = readText(p);
      if (!text.includes('APPROVE-AND-MERGE-BOUNDARY')) continue;
      const block = ma.projectionBlock(text);
      const rest = block ? text.replaceAll(block, '') : text;
      assert.doesNotMatch(ma.liveProse(rest), /(?<![A-Z-])APPROVE-AND-MERGE-BOUNDARY(?![A-Z-])/, path.relative(REPO, p));
    }
  });

  test('the gate template and rules carry the owner-check line', () => {
    const text = read('method/agents/quality-assurance.md');
    let template = text.slice(text.indexOf('<!-- gatekeeper-verdict: quality-assurance -->'));
    template = template.slice(0, template.indexOf('```'));
    const lines = template.split('\n');
    assert.ok(lines[2].startsWith('head: '), lines[2]);
    assert.ok(lines[3].startsWith('owner-check: none'), lines[3]);
    const flat = ma.flatten(text);
    for (const needle of ['The owner-check: line is mandatory, on line 4, in every verdict whatever its literal (#134).',
      'When the value is not none, post it verbatim on each Issue the PR references, before you merge',
      'A verdict without the line is malformed, and the review/quality-assurance status refuses it']) assert.ok(flat.includes(needle), needle.slice(0, 40));
    assert.ok(read('workspace/README.md').includes('APPROVE-AND-MERGE\n   head: <the full 40-character head SHA>\n   owner-check: none\n'));
  });

  test('every fenced verdict template carries owner-check on line 4', () => {
    let total = 0;
    for (const rel of ['method/agents/quality-assurance.md', 'workspace/README.md']) {
      const lines = read(rel).split('\n');
      /** @type {string | null} */
      let fence = null;
      let found = 0;
      for (const [i, line] of lines.entries()) {
        const m = /^\s*(`{3,}|~{3,})/.exec(line);
        if (m) {
          fence = fence ? null : m[1];
          continue;
        }
        if (fence && line.trim() === '<!-- gatekeeper-verdict: quality-assurance -->') {
          const four = lines.slice(i, i + 4).map((x) => x.trim());
          assert.ok(four[2].startsWith('head: ') && four[3].startsWith('owner-check:'), rel + ':' + (i + 1));
          found++;
        }
      }
      assert.ok(found, rel);
      total += found;
    }
    // The QA brief carries two templates (the verdict shape and the copy-verdict relay), the README one.
    assert.ok(total >= 3);
  });

  test('no live prose claims the literal records the class', () => {
    const claims = /sets the verdict literal|verdict literal is posted|which literal ends up|its own verdict literal|whether anything shipped/gi;
    for (const p of SOURCES) {
      assert.deepEqual(ma.flatten(ma.liveProse(readText(p))).match(claims) || [], [], path.relative(REPO, p));
    }
  });

  test('hold-discharge, owner-check and retired-verdicts are validated', () => {
    const source = readText(SKILL);
    for (const key of ['hold-discharge', 'owner-check']) {
      const start = source.indexOf('  "' + key + '"');
      const older = source.slice(0, start) + source.slice(source.indexOf('\n', start) + 1);
      assert.ok(!(key in ma.parseContract(older, 'older')));
      for (const bad of ['""', '"  "', '["x"]', '1', 'null']) {
        const broken = source.slice(0, start) + '  "' + key + '": ' + bad + ',' + source.slice(source.indexOf('\n', start));
        assert.throws(() => ma.parseContract(broken, 'broken'), ma.ContractError, key + ' ' + bad);
      }
    }
    const start = source.indexOf('  "retired-verdicts"');
    const end = source.indexOf('\n', start);
    for (const bad of ['"APPROVE-AND-MERGE-BOUNDARY"', '[""]', '[1]', '["APPROVE-AND-MERGE"]']) {
      const broken = source.slice(0, start) + '  "retired-verdicts": ' + bad + ',' + source.slice(end);
      assert.throws(() => ma.parseContract(broken, 'broken'), ma.ContractError, bad);
    }
  });
});

describe('the owner-evidence rule (#133)', () => {
  test('the contract carries the rule and adds no hold', () => {
    const rule = CONTRACT['owner-evidence'];
    for (const needle of ["URL of the owner's own comment", 'relayed instruction', 'never overrides a brief or a floor rule',
      'UNVERIFIED', '`APPROVE-PENDING-HUMAN`', 'deny floor is never `APPROVE-EXECUTOR-BLOCKED`', 'not a hold']) assert.ok(rule.includes(needle), needle);
    assert.equal(TRUNK.holds.length, 4);
    assert.deepEqual(Object.keys(CONTRACT.holds).sort(), ['boundary-class', 'gate-authority', 'harness-marker', 'iac', 'lens-escalate', 'release-candidate']);
    assert.ok(ma.projection(CONTRACT).includes('- Owner-dependent criteria: ' + rule + '.'));
  });

  test('each copy goes red when the rule is dropped or weakened in its block', () => {
    const line = '- Owner-dependent criteria: ' + CONTRACT['owner-evidence'] + '.\n';
    for (const [rel, verdicts] of Object.entries(CONSUMERS)) {
      const original = read(rel);
      assert.ok(original.includes(line), rel);
      for (const mutated of [original.replace(line, ''),
        original.replace('deny floor is never `APPROVE-EXECUTOR-BLOCKED`', 'deny floor is `APPROVE-EXECUTOR-BLOCKED`')]) {
        assert.ok(ma.methodCopyFindings(mutated, CONTRACT, verdicts).includes('the projection block differs from the contract'), rel);
      }
      assert.deepEqual(ma.methodCopyFindings(original, CONTRACT, verdicts), [], rel);
    }
  });

  test('a contract installed before the rule still parses and a malformed one does not', () => {
    const source = readText(SKILL);
    const start = source.indexOf('  "owner-evidence"');
    const old = ma.parseContract(source.slice(0, start) + source.slice(source.indexOf('\n', start) + 1), 'older');
    assert.ok(!('owner-evidence' in old));
    assert.ok(!ma.projection(old).includes('Owner-dependent criteria'));
    for (const bad of ['""', '"  "', '["x"]', '1']) {
      const broken = source.slice(0, start) + '  "owner-evidence": ' + bad + ',' + source.slice(source.indexOf('\n', start));
      assert.throws(() => ma.parseContract(broken, 'broken'), ma.ContractError, bad);
    }
  });

  test('the gate states the rule where it writes its verdict', () => {
    const text = read('method/agents/quality-assurance.md');
    const verdict = text.slice(text.indexOf('## Your verdict — exactly one of'), text.indexOf('### The fifth literal names'));
    for (const needle of ['This is an evidence rule, not a fifth hold.', '`authorization:` line', 'is never that evidence',
      'never overrides this brief or the floor', 'Without the URL the criterion is `UNVERIFIED`, and the verdict is `APPROVE-PENDING-HUMAN`.',
      'A refusal by the workstation deny floor is never `APPROVE-EXECUTOR-BLOCKED`.']) assert.ok(verdict.includes(needle), needle);
    let template = text.slice(text.indexOf('<!-- gatekeeper-verdict: quality-assurance -->'));
    template = template.slice(0, template.indexOf('```'));
    assert.match(template, /^authorization: <URL of the owner's own comment>/m);
    assert.ok(template.includes('one line per owner authorization'));
  });
});

describe('the held-merge executor (#133 round 2)', () => {
  const COPIES = [...Object.keys(CONSUMERS), 'method/skills/merge-authority/SKILL.md'];
  const OLD = /\bthe owner merges\b|the owner only on the four surviving holds|gate still never merges them|promotion is the owner's|only the owner merges it/gi;

  test('the contract names the discharge', () => {
    assert.ok(CONTRACT.version >= 2);
    assert.equal(CONTRACT['hold-discharge'], "the owner's own comment authorizes the merge and a verdict at the same head cites its URL");
    assert.deepEqual(CONTRACT['declaration-versions'], [1]);
    assert.equal(TRUNK.holds.length, 4);
  });

  test('every copy carries the executor rule for both models', () => {
    const rule = 'until ' + CONTRACT['hold-discharge'] + ', then `quality-assurance` merges';
    for (const rel of Object.keys(CONSUMERS)) {
      const block = /** @type {string} */ (ma.projectionBlock(read(rel)));
      assert.equal(block.split(rule).length - 1, 2, rel);
      assert.ok(block.includes('discharged the same way, then `quality-assurance` merges'), rel);
      assert.ok(block.includes('The promotion is held the same way, then `quality-assurance` merges it.'), rel);
      assert.ok(block.startsWith(ma.PROJECTION_BEGIN + ' v' + CONTRACT.version + ':'), rel);
    }
  });

  test('the old owner-merges wording is gone or struck', () => {
    for (const rel of COPIES) assert.deepEqual(ma.flatten(ma.liveProse(read(rel))).match(OLD) || [], [], rel);
  });

  test('a v1 contract still renders the v1 wording', () => {
    /** @type {Record<string, any>} */
    const old = { ...CONTRACT, version: 1 };
    delete old['hold-discharge'];
    const text = ma.projection(old);
    assert.ok(text.includes('the quality-assurance merges'));
    assert.ok(!text.includes("until the owner's own comment"));
  });

  test('the gate and the states table say who executes', () => {
    const gate = ma.flatten(read('method/agents/quality-assurance.md'));
    assert.ok(gate.includes('His go is his own comment authorizing the merge; the act stays yours'));
    assert.ok(gate.includes("It means waiting for the owner's comment, not a merge by the owner"));
    let blocked = gate.slice(gate.indexOf('APPROVE-EXECUTOR-BLOCKED — DoD green'));
    blocked = blocked.slice(0, blocked.indexOf('REQUEST-CHANGES — one or more'));
    assert.ok(blocked.includes('Never for a refusal by the workstation deny floor.'));
    const conf = ma.flatten(read('method/skills/agents-configuration/SKILL.md'));
    for (const needle of ["on the four surviving holds, quality-assurance too, once the owner's own comment authorizes the merge",
      "until the owner's own comment authorizes the merge; then it re-verdicts at the same head",
      'A refusal by the workstation deny floor is never this state (#133)',
      'only a cited URL of his own comment counts, and without it the verdict is APPROVE-PENDING-HUMAN',
      'With the URL cited, the gate executes the held merge itself.']) assert.ok(conf.includes(needle), needle.slice(0, 40));
    const auto = ma.flatten(read('method/commands/autonomy.md'));
    assert.ok(auto.includes("what it waits for is his own comment authorizing the merge, after which the gate "
      + "re-verdicts citing that comment's URL and executes the merge itself"));
  });
});

describe('a project brief against the installed contract', () => {
  /** @type {import('../helpers/home.js').Home} */
  let h;
  /** @type {string} */
  let project;
  const skillText = readText(SKILL);
  /** @param {string[]} [harnesses] */
  const install = (harnesses = ['Claude Code', 'Codex', 'Kiro']) => {
    for (const [name, p] of ma.installedSkillPaths(h.home)) {
      if (!harnesses.includes(name)) continue;
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, '---\nmanaged-by: x\n---\n' + skillText);
    }
  };
  /** @param {string} text */
  const writeBrief = (text) => fs.writeFileSync(path.join(project, 'AGENTS.md'), brief(text));
  const check = () => ma.checkProject(project, h.home);
  /** @param {string | null} needle @param {number} [code] */
  const red = (needle, code = 1) => {
    const [got, lines] = check();
    assert.equal(got, code, lines.join('\n'));
    if (needle) assert.ok(lines.some((l) => l.includes(needle)), needle + ' in ' + lines.join('\n'));
  };
  const green = () => {
    const [got, lines] = check();
    assert.equal(got, 0, lines.join('\n'));
  };
  /** @param {string} line */
  const withLine = (line) => CORRECTED_SECTION.replace('- loop-model:', line + '\n- loop-model:');
  beforeEach(() => {
    h = throwawayHome('merge-authority');
    project = path.join(h.dir, 'project');
    fs.mkdirSync(project);
    install();
  });
  afterEach(() => h.cleanup());

  test('scenario 1: the legacy brief is red and the corrected one green', () => {
    writeBrief(LEGACY_SECTION + '\n' + BLOCK);
    red('changes method-owned merge authority: the gate escalates the boundary class');
    red('claims it wins over the method');
    writeBrief(LEGACY_SECTION);
    red('no `<!-- merge-authority:begin -->` block');
    writeBrief(CORRECTED_SECTION);
    green();
  });

  test('scenario 2: an executor override is named', () => {
    for (const line of ['- executor: owner', '- merged-by: developer', '- merges: orchestrator']) {
      writeBrief(withLine(line));
      red('executor override');
      writeBrief(CORRECTED_SECTION);
      green();
    }
  });

  test('scenario 3: a hold added, removed or replaced is red', () => {
    for (const [line, needle] of [['- hold: owner ratification for all published content', 'hold override'],
      ['- holds-removed: iac', 'hold override'], ['- holds: (1) iac (2) articles', 'hold override'],
      ['- verdict: APPROVE-PENDING-HUMAN for boundary', 'verdict override'], ['- boundary: owner', 'class relationship override'],
      ['- boundary-trigger: published content, which the owner ratifies before merge', 'may classify, not assign authority'],
      ['- reviewer: product-lead', 'unknown key']]) {
      writeBrief(withLine(line));
      red(needle);
      writeBrief(CORRECTED_SECTION);
      green();
    }
  });

  test('scenario 4: a project boundary trigger is green', () => {
    writeBrief(CORRECTED_SECTION.replace('<!-- merge-authority:end -->', "- boundary-trigger: any change under `apps/edge/` or to a public route's metadata\n<!-- merge-authority:end -->"));
    green();
  });

  test('scenario 5: each model validates and an unknown one does not', () => {
    writeBrief(CORRECTED_SECTION.replaceAll('trunk-single-env', 'gitflow-multi-env'));
    green();
    writeBrief(CORRECTED_SECTION.replace('- loop-model: trunk-single-env', '- loop-model: trunk-multi-env'));
    red('not one the contract maps');
    writeBrief(CORRECTED_SECTION.replace('- loop-model: trunk-single-env', '- loop-model: gitflow-multi-env'));
    red('the prose names loop model `trunk-single-env`');
    writeBrief(CORRECTED_SECTION);
    green();
  });

  test('scenario 7: history, quotes and fences stay green', () => {
    writeBrief(CORRECTED_SECTION + HISTORY);
    green();
    // The calibration: the same sentence outside the struck span is red.
    writeBrief(CORRECTED_SECTION + HISTORY + '\nThe gate escalates the **boundary class** to the owner.\n');
    red('escalates the boundary class');
  });

  test('scenario 8: a paraphrase outside the block is a known false negative', () => {
    // Documented limit, asserted so it stays visible: this paraphrase overrides the executor in words the
    // check does not know, and it passes.
    writeBrief(CORRECTED_SECTION + "\nEvery boundary diff waits for the owner's own click.\n");
    green();
  });

  test('scenario 9: an absent or older method fails closed', () => {
    writeBrief(CORRECTED_SECTION);
    for (const [, p] of ma.installedSkillPaths(h.home)) fs.rmSync(p);
    red('CANNOT VALIDATE (fail closed)', 2);
    red('mhw install --method', 2);
    install();
    writeBrief(CORRECTED_SECTION.replace('merge-authority v1', 'merge-authority v2'));
    red('understands only v1', 2);
    writeBrief(CORRECTED_SECTION);
    green();
  });

  test('installed copies that disagree or do not parse fail closed (exit 2)', () => {
    writeBrief(CORRECTED_SECTION);
    const kiro = ma.installedSkillPaths(h.home)[2][1];
    const original = readText(kiro);
    fs.writeFileSync(kiro, original.replace('"version": ' + CONTRACT.version, '"version": 0'));
    red('disagree', 2);
    fs.writeFileSync(kiro, original.replace('```merge-authority-contract', '```json'));
    red('expected one', 2);
    fs.writeFileSync(kiro, original);
    green();
  });

  test('a missing, duplicated or unclosed block is red', () => {
    writeBrief(CORRECTED_SECTION.replace(BLOCK, ''));
    red('no `<!-- merge-authority:begin -->` block');
    writeBrief(CORRECTED_SECTION + '\n' + BLOCK);
    red('2 declaration blocks');
    writeBrief(CORRECTED_SECTION.replace('<!-- merge-authority:end -->', ''));
    red('never closed');
    writeBrief(CORRECTED_SECTION.replace('- contract: merge-authority v1\n', ''));
    red('exactly one `contract');
    // B2 (PR #423): a fence opened inside a list item, indented past three spaces, is still a fence.
    writeBrief(CORRECTED_SECTION + '\n- an example, quoted:\n\n    ```\n' + BLOCK + '    ```\n');
    green();
    // A marker not at column 0 (here inside a list item) is not a declaration.
    writeBrief(CORRECTED_SECTION.replace(BLOCK, BLOCK.split('\n').map((l) => '  ' + l).join('\n')));
    red('no `<!-- merge-authority:begin -->` block');
    writeBrief(CORRECTED_SECTION);
    green();
  });

  test('an integration-branch brief keeps the release-candidate hold', () => {
    // Lens on PR #419: the rc/next variant's release-candidate hold must be the contract's. This repository's
    // own brief is the subject, as global/merge_authority_test.py had it.
    const own = read('AGENTS.md');
    const declared = BLOCK.replace('- loop-model: trunk-single-env\n', '- loop-model: trunk-single-env\n- integration-branch: rc/next\n');
    fs.writeFileSync(path.join(project, 'AGENTS.md'), own + '\n' + declared);
    green();
    fs.writeFileSync(path.join(project, 'AGENTS.md'), own + '\n' + BLOCK);
    red('no `integration-branch`');
    fs.writeFileSync(path.join(project, 'AGENTS.md'), RC_BRIEF + '\n' + BLOCK);
    red('no `integration-branch`');
    fs.writeFileSync(path.join(project, 'AGENTS.md'), own + '\n' + declared);
    green();
  });

  test('the release-candidate hold cannot be turned off', () => {
    const rc = CORRECTED_SECTION.replace('- loop-model: trunk-single-env\n', '- loop-model: trunk-single-env\n- integration-branch: rc/next\n');
    for (const [line, needle] of [['- rc-hold: none', 'hold override'], ['- promotion-executor: quality-assurance', 'executor override'],
      ['- integration-branch: rc/other', 'at most one']]) {
      writeBrief(rc.replace('- loop-model:', line + '\n- loop-model:'));
      red(needle);
      writeBrief(rc);
      green();
    }
    writeBrief(rc.replaceAll('trunk-single-env', 'gitflow-multi-env'));
    red('no integration-branch variant');
    writeBrief(rc + '\nSlices merge into rc/next; the release candidate waits for the owner.\n');
    green();
  });

  test('an undecodable copy or empty declaration-versions fails closed', () => {
    writeBrief(CORRECTED_SECTION);
    const kiro = ma.installedSkillPaths(h.home)[2][1];
    const original = fs.readFileSync(kiro);
    fs.writeFileSync(kiro, Buffer.from([0xff, 0xfe, 0x00, 0x6e]));
    red('cannot be read', 2);
    fs.writeFileSync(kiro, Buffer.from(original.toString('utf8').replace('"declaration-versions": [1]', '"declaration-versions": []')));
    red('non-empty list', 2);
    fs.writeFileSync(kiro, original);
    green();
  });

  test('no AGENTS.md is red, and one that is not UTF-8 is a finding, not a crash', () => {
    red('no AGENTS.md');
    fs.writeFileSync(path.join(project, 'AGENTS.md'), Buffer.from([0x23, 0x20, 0xff, 0x0a]));
    red('is not readable UTF-8');
  });
});
