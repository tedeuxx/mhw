// The parts of the MCP parity tests (S13 test/render/mcp-golden.test.js, S14 test/mcp/active-golden.test.js)
// that are the same for both: applying a slice's expected differences, comparing two transcripts, the
// catalogue checks, and finding the base revision's tree (convention 3 of #470).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { readGolden } from './golden.js';
import { which } from './home.js';
import { extractRevision } from './parity.js';

/** @typedef {{ case: string[], stream: string[], base?: string, head: string, replace: string, why: string }} Expected */

/** @param {string} name */
export const goldenName = (name) => 'transcripts/' + name + '.json';

/**
 * The expected differences of one case and stream, applied to one side.
 * @param {Expected[]} expected @param {string} name @param {string} stream @param {string} text @param {'base' | 'head'} side
 */
export function allow(expected, name, stream, text, side) {
  let t = text;
  for (const e of expected) {
    const streamHit = e.stream.includes('*') || e.stream.some((s) => stream === s || stream.endsWith(' ' + s));
    if (!streamHit || !(e.case.includes(name) || e.case.includes('*'))) continue;
    const pattern = side === 'head' ? e.head : e.base;
    if (pattern !== undefined) t = t.replaceAll(new RegExp(pattern, 'g'), e.replace);
  }
  return t;
}

/**
 * Every difference between two transcripts of one case, after the expected ones are applied.
 * @param {Expected[]} expected @param {string} name @param {Record<string, any>} base @param {Record<string, any>} head
 */
export function differences(expected, name, base, head) {
  /** @type {string[]} */
  const diffs = [];
  /** @param {unknown} v */
  const text = (v) => (typeof v === 'string' ? v : JSON.stringify(v, null, 1));
  /** @param {string} a @param {string} b */
  const byName = (a, b) => a.localeCompare(b);
  /** @param {string} label @param {string} a @param {string} b */
  const compare = (label, a, b) => {
    if (a !== b) diffs.push(name + ': ' + label + ' differs\n--- original\n' + a + '\n--- head\n' + b);
  };
  for (const k of [...new Set([...Object.keys(base), ...Object.keys(head)])].sort(byName)) {
    if (k !== 'files') {
      compare(k, allow(expected, name, k, text(base[k]), 'base'), allow(expected, name, k, text(head[k]), 'head'));
      continue;
    }
    for (const f of [...new Set([...Object.keys(base.files || {}), ...Object.keys(head.files || {})])].sort(byName)) {
      const stream = 'file ' + f;
      compare(stream, allow(expected, name, stream, text(base.files?.[f] ?? '<absent>'), 'base'), allow(expected, name, stream, text(head.files?.[f] ?? '<absent>'), 'head'));
    }
  }
  return diffs;
}

/**
 * The two catalogue checks every MCP parity slice carries: a golden per case and a case per golden, every
 * expected difference naming a case and saying why; and no golden printing the canary.
 * @param {{ root: string, slice: string, cases: Array<{ name: string }>, expected: Expected[], canary: string }} o
 */
export function catalogueTests({ root, slice, cases, expected, canary }) {
  test('every case has a golden transcript, every golden a case, and every expected difference names a case', () => {
    const names = new Set(cases.map((c) => c.name));
    assert.equal(names.size, cases.length, 'case names are unique');
    const dir = path.join(root, 'test', 'golden', slice, 'transcripts');
    for (const n of names) assert.ok(fs.existsSync(path.join(dir, n + '.json')), 'no golden for ' + n);
    for (const f of fs.readdirSync(dir)) assert.ok(names.has(f.replace(/\.json$/, '')), 'golden without a case: ' + f);
    for (const e of expected) {
      for (const n of e.case) assert.ok(n === '*' || names.has(n), 'unknown case ' + n);
      assert.ok(e.why && e.why.length > 40, 'an expected difference states why');
      assert.doesNotThrow(() => new RegExp(e.head));
    }
  });

  test('no golden transcript carries a synthetic value outside the files the fixture put it in', () => {
    for (const c of cases) {
      const g = readGolden(slice, goldenName(c.name));
      assert.ok(!JSON.stringify(Object.entries(g).filter(([k]) => k !== 'files')).includes(canary), c.name);
    }
  });
}

/** python3 3.11 or later is on PATH (POSIX only). */
export function python311() {
  const py = process.platform === 'win32' ? null : which('python3');
  const ok = !!py && spawnSync(py, ['-c', 'import sys; sys.exit(0 if sys.version_info >= (3, 11) else 1)']).status === 0;
  return ok ? py : null;
}

/**
 * The base revision's tree, extracted under dir, or the reason it is not readable here (a string that is
 * not an absolute path). holds: the repository-relative file the original lives in.
 * @param {{ root: string, dir: string, holds: string }} o
 */
export function baseTree({ root, dir, holds }) {
  if (process.platform === 'win32') return 'POSIX only';
  const git = which('git');
  if (!git) return 'needs git on PATH';
  if (!python311()) return 'needs python3 3.11+';
  const base = process.env.MHW_PARITY_BASE || (() => {
    const p = spawnSync(git, ['-C', root, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
    return p.status === 0 ? p.stdout.trim() : '';
  })();
  if (!base) return 'no base revision (MHW_PARITY_BASE unset, no merge-base with origin/rc/next)';
  const dest = path.join(fs.mkdtempSync(path.join(dir, 'base-')), 'tree');
  if (!extractRevision(root, base, dest)) return 'base revision ' + base + ' is not readable here';
  if (!fs.existsSync(path.join(dest, holds))) return 'the base revision no longer holds ' + path.basename(holds) + ' (this slice has merged)';
  return dest;
}
