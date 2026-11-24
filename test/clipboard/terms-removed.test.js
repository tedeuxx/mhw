// #589 (CLI native baseline PRD, section 5): third-party terms are judged by the model, so `mhw add-term`,
// the hashed term lists and their salt are removed. `add-term` is an unknown subcommand, and no shipped
// code reads a term list or a salt. The sweep runs over the tracked JavaScript of the npm package and the CI
// scripts (bin/, src/, .github/scripts/), and it is calibrated: its patterns are first shown to match the
// readers the base revision carried, so a dead pattern cannot pass silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/** What reading a term list or a salt looked like in code: the readers, their settings and the hashing. */
export const READER = /\b(?:readTermLists|readTermsStrict|readTerms|termHash|termForms|readSalt|fileSaltStrict|fileSalt|saltOrCreate|addTermHashes|orphanedLists|TERMS_HEADER|TERM_LISTS|LIST_FILES)\b|\b(?:terms_file|health_terms_file|colleague_terms_file|salt_file|salt_store)\b|createHmac\(|['"][^'"]*\/(?:salt|add-term)\.js['"]/;

/** The one module that names the leftover files, to find and move them aside (it never opens one). */
const ALLOWED = new Set(['src/lib/term-leftovers.js']);

/** Every .js file under the roots, repository-relative with POSIX separators. @param {string[]} roots */
function jsFiles(roots) {
  /** @type {string[]} */
  const out = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'vendor' && e.name !== 'node_modules') walk(p);
      } else if (e.name.endsWith('.js') || e.name.endsWith('.mjs')) out.push(path.relative(ROOT, p).split(path.sep).join('/'));
    }
  };
  for (const r of roots) walk(path.join(ROOT, r));
  return out.sort();
}

/** The code lines of a file: block and line comments taken out, so a sentence about the removal is not a reader. @param {string} text */
const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !/^\s*\/\//.test(l)).map((l) => l.replace(/\s\/\/.*$/, ''));

test('calibration: the sweep\'s pattern matches each reader the term lists had', () => {
  for (const line of ['const [terms, lists] = core.readTermLists(conf);', "import { readSalt } from '../lib/salt.js';", 'core.termHash(SALT, f)',
    "conf.terms_file = path.join(overlay, 'clipboard-terms');", 'crypto.createHmac(\'sha256\', key)', "import { main } from './commands/add-term.js';",
    'return { salt: core.fileSalt(conf.salt_file) };']) assert.match(line, READER, line);
  for (const line of ['const spans = core.findSpans(text);', "say(ctx, 'REMOVED ' + f);"]) assert.doesNotMatch(line, READER, line);
});

test('no shipped code reads a term list or a salt (bin/, src/, .github/scripts/)', () => {
  const files = jsFiles(['bin', 'src', '.github/scripts']);
  assert.ok(files.includes('src/lib/clean.js') && files.includes('.github/scripts/outbound-scan.js'), 'the sweep reached the cleaning core and the CI scan');
  /** @type {string[]} */
  const hits = [];
  for (const f of files) {
    if (ALLOWED.has(f)) continue;
    code(fs.readFileSync(path.join(ROOT, f), 'utf8')).forEach((l, i) => {
      if (READER.test(l)) hits.push(f + ': ' + l.trim().slice(0, 120) + ' (code line ' + (i + 1) + ')');
    });
  }
  assert.deepEqual(hits, []);
  for (const gone of ['src/commands/add-term.js', 'src/lib/salt.js']) assert.ok(!fs.existsSync(path.join(ROOT, gone)), gone + ' still exists');
});

test('`mhw add-term` is an unknown subcommand', () => {
  const p = spawnSync(process.execPath, [path.join(ROOT, 'bin', 'mhw.js'), 'add-term'], { encoding: 'utf8', env: { ...process.env, MHW_NODE: process.execPath } });
  assert.equal(p.status, 2, p.stdout + p.stderr);
  assert.match(p.stderr, /^mhw: unknown subcommand add-term /);
  assert.equal(p.stdout, '');
});
