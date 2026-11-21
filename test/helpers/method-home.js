// Throwaway homes for the working-method renderer's suites (#489, S18 of #470): test/render/method.test.js
// and test/render/method-commands.test.js, the node:test forms of the deleted method_render_test.py and
// method_commands_test.py. The renderer runs in this process (src/render/method.js run()) with an
// environment naming only the home, so no real HOME, CODEX_HOME or XDG_DATA_HOME is read or written.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, splitFrontMatter } from '../../src/render/method.js';
import { isPyWs } from '../../src/lib/py.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const SOURCE = path.join(ROOT, 'method');
export const MARKER = 'managed-by: personal-multi-harness-workstation-configuration';
export const STAMP = 'release: v9.9.9; commit: 0123456789abcdef0123456789abcdef01234567';
export const OTHER = 'release: v9.9.8; commit: fedcba9876543210fedcba9876543210fedcba98';
export const SCRIPTS_DIR = '.local/share/personal-multi-harness-workstation-configuration/method/scripts';

/** @type {Array<() => void>} */
const cleanups = [];
process.on('exit', () => cleanups.forEach((c) => c()));

/** A new directory under the OS temporary directory, removed at exit. @param {string} label */
export function tempDir(label) {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), 'mhw-s18-' + label + '-')));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/**
 * A copy of method/ to mutate; its path. Its Markdown is written with \n line ends, so an edit matching
 * "\n---\n" lands on a Windows checkout too (core.autocrlf), as on the LF source the renderer reads.
 * @param {string} [label]
 */
export function sourceCopy(label = 'src') {
  const dest = path.join(tempDir(label), 'method');
  fs.cpSync(SOURCE, dest, { recursive: true, verbatimSymlinks: true });
  for (const f of filesUnder(dest)) if (f.endsWith('.md')) fs.writeFileSync(f, read(f));
  return dest;
}

/** @param {string} p */
export const read = (p) => fs.readFileSync(p, 'utf8').replaceAll('\r\n', '\n');

/**
 * @typedef {{ root: string, p: (rel: string) => string, run: (args: string[], o?: { stamp?: string | null, optIn?: boolean, env?: Record<string, string> }) => { code: number, out: string, stdout: string, stderr: string }, files: () => string[] }} Home
 */

/** @param {string} [label] @returns {Home} */
export function methodHome(label = 'home') {
  const root = tempDir(label);
  /** @param {string} rel */
  const p = (rel) => path.join(root, ...rel.split('/'));
  return {
    root,
    p,
    run(args, o = {}) {
      const all = [...args];
      const stamp = o.stamp === undefined ? STAMP : o.stamp;
      if (stamp !== null && !all.some((a) => a.startsWith('--stamp='))) all.push('--stamp=' + stamp);
      if (o.optIn !== false) all.push('--opt-in');
      let stdout = '';
      let stderr = '';
      const env = { PATH: process.env.PATH || '', HOME: root, ...(o.env || {}) };
      const code = run(all, { env, cwd: root, out: (x) => { stdout += x; }, err: (x) => { stderr += x; } });
      return { code, out: stdout + stderr, stdout, stderr };
    },
    files: () => filesUnder(root),
  };
}

/** Every regular file under dir, recursively, as paths. @param {string} dir @returns {string[]} */
export function filesUnder(dir) {
  /** @type {string[]} */
  const out = [];
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const q = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(q));
    else out.push(q);
  }
  return out.sort();
}

/** Every file under method/ with the extension, as paths relative to method/ (posix), sorted. @param {string} ext */
export function methodFiles(ext, dir = SOURCE) {
  return filesUnder(dir).filter((f) => f.endsWith(ext)).map((f) => path.relative(dir, f).split(path.sep).join('/')).sort();
}

/** The front matter lines of a rendered or source file. @param {string} file */
export function frontMatter(file) {
  const lines = read(file).split('\n');
  return lines.slice(1, lines.indexOf('---', 1));
}

/** The source front matter fields of a method file (the renderer's own parser). @param {string} file */
export function fieldsOf(file) {
  return splitFrontMatter(read(file), path.basename(file)).fields;
}

/** The managed-by line of a rendered file (Kiro JSON: its prompt's first line). @param {string} file */
export function markerLine(file) {
  if (file.endsWith('.json')) return String(JSON.parse(read(file)).prompt).split('\n', 1)[0];
  return read(file).split('\n').slice(0, 5).find((l) => l.includes(MARKER)) || '';
}

/** Python's str.split() then ' '.join(): whitespace runs flattened. @param {string} s */
export const flatten = (s) => {
  const words = [];
  let cur = '';
  for (const ch of s) {
    if (isPyWs(ch)) {
      if (cur) words.push(cur);
      cur = '';
    } else cur += ch;
  }
  if (cur) words.push(cur);
  return words.join(' ');
};

/** Blank-line paragraphs, whitespace-flattened, with `~~struck~~` spans removed. @param {string} file */
export const unstruckParagraphs = (file) => read(file).split('\n\n').map((p) => flatten(p).replace(/~~.*?~~/g, ''));

/** A file's paragraphs with struck spans removed, flattened and joined. @param {string} file */
export const liveText = (file) => unstruckParagraphs(file).join(' ');

/** Struck spans removed (across lines), then whitespace flattened. @param {string} text */
export const unstruckFlat = (text) => flatten(text.replace(/~~.*?~~/gs, ''));

/** @typedef {{ tools: string[], excluded: string[], skills: string[] }} SourceAgent */

/** name -> the tool list, the exclusions and the preloads, from the source. @returns {Record<string, SourceAgent>} */
export function sourceAgents() {
  /** @type {Record<string, SourceAgent>} */
  const out = {};
  for (const rel of methodFiles('.md', path.join(SOURCE, 'agents'))) {
    const f = fieldsOf(path.join(SOURCE, 'agents', rel));
    /** @param {unknown} raw */
    const list = (raw) => (Array.isArray(raw) ? raw : String(raw ?? '').split(',').map((t) => t.trim()).filter(Boolean));
    out[rel.slice(0, -3)] = { tools: list(f.get('tools')), excluded: list(f.get('disallowed-tools') ?? []), skills: /** @type {string[]} */ (f.get('skills') ?? []) };
  }
  return out;
}

/** The source's skill names. */
export const SKILLS = fs.readdirSync(path.join(SOURCE, 'skills')).filter((d) => fs.existsSync(path.join(SOURCE, 'skills', d, 'SKILL.md'))).sort();
/** The source's command names. */
export const COMMANDS = fs.readdirSync(path.join(SOURCE, 'commands')).filter((f) => f.endsWith('.md')).map((f) => f.slice(0, -3)).sort();
