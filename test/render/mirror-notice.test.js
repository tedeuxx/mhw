// The agent briefs name tadeumendonca-skills as the method's plugin-form mirror (Issue #579, ADR-0046).
// mhw's method/ is the source; tadeumendonca-skills is a Claude Code plugin that mirrors it. This suite
// fails when a brief in method/agents/ carries the old "text moved from the plugin" notice, describes the
// mirror as retired, archived or deprecated, or keeps the evidence command that no longer runs. Each
// pattern is calibrated against a known-present hit, so a dead pattern fails instead of passing quietly.
// It checks wording, not truth: it cannot tell whether the mirror really carries what mhw maintains.
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { SOURCE, read, methodFiles } from '../helpers/method-home.js';

const AGENTS = methodFiles('.md', path.join(SOURCE, 'agents')).map((rel) => path.join(SOURCE, 'agents', ...rel.split('/')));

/** A brief as one line: blockquote markers dropped, whitespace collapsed, so a rewrap cannot hide a phrase. */
const flat = (/** @type {string} */ text) => text.split('\n').map((l) => l.replace(/^>\s?/, '')).join(' ').replace(/\s+/g, ' ');

const NAME = String.raw`\x60?(?:tedeuxx\/)?tadeumendonca-skills\x60?`;
const RETIRED = String.raw`(?:retired|archived|deprecated|decommissioned|no longer maintained)`;
/** @type {[string, RegExp, string][]} label, pattern, a known-present hit that must match */
const FORBIDDEN = [
  ['the old notice', /text moved from the `tadeumendonca-skills` plugin/i,
    'This text moved from the `tadeumendonca-skills` plugin. Where it names'],
  ['the retired plugin', /\bretired plugin\b/i,
    "hooks named below are the retired plugin's, not controls you have"],
  ["the plugin's hooks retired", /\bplugin's hooks (?:were |are |have )?retired\b/i,
    "Since the plugin's hooks retired (#61), product-lead holds"],
  ['the mirror named, then retired', new RegExp(NAME + String.raw`[^.]{0,60}\b` + RETIRED + String.raw`\b`, 'i'),
    'The `tadeumendonca-skills` repository is retired'],
  ['retired, then the mirror named', new RegExp(String.raw`\b` + RETIRED + String.raw`\b[^.]{0,30}` + NAME, 'i'),
    'the retired tadeumendonca-skills plugin'],
  ['the evidence command that no longer runs', /gh issue view 393 --repo tedeuxx\/tadeumendonca-skills/,
    'Read that report with `gh issue view 393 --repo tedeuxx/tadeumendonca-skills --json body --jq .body`.'],
];

describe('the plugin mirror notice in the agent briefs (#579)', () => {
  test('every forbidden pattern catches its known-present hit', () => {
    for (const [label, re, hit] of FORBIDDEN) assert.match(flat(hit), re, label);
  });
  test('the agent briefs are found', () => {
    assert.ok(AGENTS.length >= 8, String(AGENTS.length));
  });
  test('no agent brief carries the old notice or calls the mirror retired', () => {
    const found = [];
    for (const f of AGENTS) {
      const text = flat(read(f));
      for (const [label, re] of FORBIDDEN) {
        const m = text.match(re);
        if (m) found.push(path.basename(f) + ': ' + label + ': ' + m[0]);
      }
    }
    assert.deepEqual(found, []);
  });
  test('every brief that names plugin hooks says mhw is the source and the plugin its mirror', () => {
    const missing = [];
    let noticed = 0;
    for (const f of AGENTS) {
      const text = flat(read(f));
      if (!text.includes('hooks named below')) continue;
      noticed += 1;
      if (!text.includes("hooks named below are the plugin mirror's, not controls you have")) missing.push(path.basename(f) + ': heading');
      if (!text.includes('The source of this text is the `method/` directory of `tedeuxx/mhw`; `tedeuxx/tadeumendonca-skills` is its plugin-form mirror')) missing.push(path.basename(f) + ': source line');
    }
    assert.deepEqual(missing, []);
    // Seven briefs carried the notice on 2026-11-23 (tech-lead never did); fewer means one lost it.
    assert.ok(noticed >= 7, String(noticed));
  });
});
