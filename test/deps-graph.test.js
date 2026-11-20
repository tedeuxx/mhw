// Convention 5 of #470: the hook and core path stay dependency-free. Everything statically reachable
// (import ... from, export ... from, bare import, and import() of a string literal) from the CLI entry
// imports only node: modules and files of this repository. The pty library (D2) is the one exception
// (#487): src/lib/pty.js loads the vendored node-pty at run time with createRequire, never by a static
// import, so the graph below stays package-free and the paste wrapper's redaction path (clean.js) with
// it; test/vendor.test.js holds pty.js as the one file that names it. A vendored package (src/vendor/)
// counts as a package. A renderer may import one; the entry may not reach it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// The entries on the hook path: what a harness hook runs (`mhw hook prompt` will enter here) and what
// npm runs at install time, before the package's own dependencies are guaranteed to be there.
export const CORE_ENTRIES = ['bin/mhw.js', 'bin/postinstall.js'];
/** A repository-relative path with POSIX separators, the same on every OS. @param {string} f */
const posix = (f) => path.relative(ROOT, f).split(path.sep).join('/');
const ALLOWED_PACKAGES = new Set(/** @type {string[]} */ ([]));

const SPEC = /(?:^|[\s;}])(?:import|export)\s*(?:[^'"`;]*?\sfrom\s*)?['"]([^'"]+)['"]|\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/gm;

/**
 * The specifiers a JavaScript file imports, comments stripped first.
 * @param {string} text
 */
export function specifiers(text) {
  const code = text.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  return [...code.matchAll(SPEC)].map((m) => m[1] || m[2]);
}

/**
 * Walk from the entries; return [file, specifier] pairs that are neither node: nor a repository file.
 * @param {string[]} entries repository-relative
 */
export function foreignImports(entries) {
  const seen = new Set();
  /** @type {Array<[string, string]>} */
  const bad = [];
  const queue = entries.map((e) => path.join(ROOT, e));
  while (queue.length) {
    const file = /** @type {string} */ (queue.shift());
    if (seen.has(file)) continue;
    seen.add(file);
    for (const spec of specifiers(fs.readFileSync(file, 'utf8'))) {
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('./') || spec.startsWith('../')) {
        const next = path.resolve(path.dirname(file), spec);
        if (!fs.existsSync(next)) bad.push([posix(file), spec + ' (missing)']);
        else if (posix(next).startsWith('src/vendor/')) bad.push([posix(file), spec + ' (vendored package)']);
        else queue.push(next);
        continue;
      }
      if (!ALLOWED_PACKAGES.has(spec)) bad.push([posix(file), spec]);
    }
  }
  return { bad, seen: [...seen].map(posix).sort() };
}

test('the scanner finds every import form', () => {
  const sample = [
    "import fs from 'node:fs';",
    "import { a, b } from './a.js';",
    "import * as ns from \"pkg-one\";",
    "import 'pkg-two';",
    "export { x } from 'pkg-three';",
    "const m = await import('pkg-four');",
    "// import 'commented-out';",
    "/* import 'block-commented'; */",
  ].join('\n');
  assert.deepEqual(specifiers(sample), ['node:fs', './a.js', 'pkg-one', 'pkg-two', 'pkg-three', 'pkg-four']);
});

test('the hook and core path imports only node: modules', () => {
  const { bad, seen } = foreignImports(CORE_ENTRIES);
  assert.deepEqual(bad, []);
  assert.ok(seen.includes('src/cli.js'), 'the walk reached the CLI');
  assert.ok(!seen.includes('src/lib/toml.js'), 'the TOML library module is off the hook path');
  // #487: the paste wrapper and its redaction path are on the walk, and the pty reaches none of it statically.
  for (const f of ['src/commands/paste-wrapper.js', 'src/lib/clean.js', 'src/lib/pty.js']) assert.ok(seen.includes(f), f);
  assert.ok(!seen.some((f) => f.startsWith('src/vendor/')), 'a vendored file is statically reachable');
});

test('the TOML module imports its vendored library, so the walk would see it if it were reachable', () => {
  assert.deepEqual(foreignImports(['src/lib/toml.js']).bad, [['src/lib/toml.js', '../vendor/smol-toml/dist/index.js (vendored package)']]);
});
