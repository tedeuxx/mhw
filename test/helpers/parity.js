// The parity harness (convention 3 of #470, D5). It runs one command of two mhw trees, each on its own
// throwaway HOME, and records what a user could observe: stdout, stderr, the exit code and the file tree
// written under HOME (content, mode, symlink-ness). A normaliser replaces what legitimately differs
// between two runs (the trees' and HOMEs' paths, stamps, timestamps) before the two are compared.
// Every other difference is a failure unless an expected-differences entry names it.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { throwawayHome, which } from './home.js';

/**
 * @typedef {{ name: string, args: string[], env?: Record<string, string> }} Case
 * @typedef {{ path: string, kind: string, mode: string, data: string }} Entry
 * @typedef {{ name: string, args: string[], code: number | null, stdout: string, stderr: string, tree: Entry[] }} Transcript
 * @typedef {{ case: string, stream: 'stdout' | 'stderr' | 'tree' | 'tree-drop', pattern: string, why: string, whenBaseHas?: string }} ExpectedDifference
 */

/**
 * Every entry under dir, sorted: a link's target, a file's sha256, a directory's kind; with its mode.
 * A file that is UTF-8 text is hashed after normalise(text, subs), so a path or stamp written into it
 * compares like the same path or stamp on stdout.
 * @param {string} dir
 * @param {Array<[string, string]>} [subs]
 * @returns {Entry[]}
 */
export function snapshotTree(dir, subs = []) {
  /** @type {Entry[]} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort()) {
      const r = rel ? rel + '/' + name : name;
      const p = path.join(dir, r);
      const st = fs.lstatSync(p);
      const mode = process.platform === 'win32' ? '-' : (st.mode & 0o777).toString(8);
      if (st.isSymbolicLink()) out.push({ path: r, kind: 'link', mode, data: fs.readlinkSync(p) });
      else if (st.isDirectory()) {
        out.push({ path: r, kind: 'dir', mode, data: '' });
        walk(r);
      } else if (st.isFile()) {
        const raw = fs.readFileSync(p);
        const text = raw.toString('utf8');
        const body = Buffer.from(text, 'utf8').equals(raw) ? Buffer.from(normalise(text, subs), 'utf8') : raw;
        out.push({ path: r, kind: 'file', mode, data: crypto.createHash('sha256').update(body).digest('hex') });
      } else out.push({ path: r, kind: 'other', mode, data: '' });
    }
  };
  walk('');
  return out;
}

/**
 * The normaliser: paths first (longest first, so a HOME inside a temporary root is replaced whole),
 * then stamps, ISO timestamps and the running node's own path.
 * @param {string} text
 * @param {Array<[string, string]>} subs [literal, placeholder]
 */
export function normalise(text, subs) {
  let out = text.replace(/\r\n/g, '\n');
  for (const [lit, ph] of [...subs].sort((a, b) => b[0].length - a[0].length)) {
    if (lit) out = out.split(lit).join(ph);
  }
  return out
    // A stamp names the source tree, which is the one thing two compared trees always differ in.
    .replace(/release: [^;"\n]*; commit: [^;"\s]*/g, 'release: <RELEASE>; commit: <COMMIT>')
    .replace(/\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:?\d{2})?/g, '<TIMESTAMP>');
}

/**
 * Run one case of the tree at root on a fresh throwaway HOME, and normalise the transcript.
 * @param {string} root an mhw tree (a checkout, or a revision extracted with extractRevision)
 * @param {Case} c
 * @returns {Transcript}
 */
export function transcript(root, c) {
  const h = throwawayHome('parity', c.env || {});
  try {
    const p = spawnSync(process.execPath, [path.join(root, 'bin', 'mhw.js'), ...c.args], {
      env: h.env, cwd: h.dir, encoding: 'utf8', timeout: 120000,
    });
    const subs = /** @type {Array<[string, string]>} */ ([
      [root, '<ROOT>'], [h.home, '<HOME>'], [h.root, '<ADMIN>'], [h.dir, '<TMP>'], [process.execPath, '<NODE>'],
    ]);
    const tree = snapshotTree(h.home, subs).map((e) => (e.kind === 'link' ? { ...e, data: normalise(e.data, subs) } : e));
    return { name: c.name, args: c.args, code: p.status, stdout: normalise(p.stdout || '', subs), stderr: normalise(p.stderr || '', subs), tree };
  } finally {
    h.cleanup();
  }
}

/**
 * The head transcript with the lines expected-differences allows it to add removed, so it can be
 * compared with the original's. Only additions are allowed: a line the original printed and the head
 * dropped is still a difference.
 * @param {Transcript} head
 * @param {ExpectedDifference[]} expected
 * @returns {Transcript}
 */
export function withoutExpected(head, expected) {
  const out = { ...head };
  for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
    const rules = expected.filter((e) => (e.case === '*' || e.case === head.name) && e.stream === stream).map((e) => new RegExp(e.pattern));
    if (rules.length) out[stream] = head[stream].split('\n').filter((line) => !rules.some((r) => r.test(line))).join('\n');
  }
  // stream "tree" (#475): a written file whose path the pattern matches is compared by kind and mode
  // only, its content hash blanked on the side this is applied to. Used for a file whose content an
  // installer change legitimately alters, and only while the base still holds the old code (whenBaseHas).
  const treeRules = expected.filter((e) => (e.case === '*' || e.case === head.name) && e.stream === 'tree').map((e) => new RegExp(e.pattern));
  if (treeRules.length) out.tree = head.tree.map((e) => (e.kind === 'file' && treeRules.some((r) => r.test(e.path)) ? { ...e, data: '<CONTENT>' } : e));
  // stream "tree-drop" (#487): a written path the pattern matches is left out of the comparison, for a
  // file one side writes and the other no longer does. Applied to both sides, so it is never one-sided.
  const dropRules = expected.filter((e) => (e.case === '*' || e.case === head.name) && e.stream === 'tree-drop').map((e) => new RegExp(e.pattern));
  if (dropRules.length) out.tree = out.tree.filter((e) => !dropRules.some((r) => r.test(e.path)));
  return out;
}

/**
 * The differences between the original's transcript and the head's, as readable strings ([] = parity).
 * @param {Transcript} base
 * @param {Transcript} head
 */
export function differences(base, head) {
  /** @type {string[]} */
  const diffs = [];
  if (base.code !== head.code) diffs.push(head.name + ': exit ' + base.code + ' -> ' + head.code);
  for (const stream of /** @type {const} */ (['stdout', 'stderr'])) {
    if (base[stream] !== head[stream]) diffs.push(head.name + ': ' + stream + ' differs\n--- original\n' + base[stream] + '\n--- head\n' + head[stream]);
  }
  const a = JSON.stringify(base.tree, null, 1);
  const b = JSON.stringify(head.tree, null, 1);
  if (a !== b) diffs.push(head.name + ': written tree differs\n--- original\n' + a + '\n--- head\n' + b);
  return diffs;
}

/**
 * Copy the working tree at repo (tracked and new files, as git lists them; never .git or node_modules)
 * into dest. Both sides of a comparison then run as a package does, with no .git beside them: a
 * checkout makes ./mhw answer differently (and `update` would check out a tag in it).
 * @param {string} repo
 * @param {string} dest
 */
export function copyWorkingTree(repo, dest) {
  const git = which('git');
  if (!git) throw new Error('copyWorkingTree needs git on PATH');
  const p = spawnSync(git, ['-C', repo, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8', maxBuffer: 64 << 20 });
  if (p.status !== 0) throw new Error('git ls-files failed: ' + p.stderr);
  for (const rel of p.stdout.split('\0').filter(Boolean)) {
    const from = path.join(repo, rel);
    let st;
    try {
      st = fs.lstatSync(from);
    } catch {
      continue; // deleted in the working tree
    }
    if (!st.isFile() && !st.isSymbolicLink()) continue;
    const to = path.join(dest, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (st.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
    else fs.copyFileSync(from, to);
    if (!st.isSymbolicLink()) fs.chmodSync(to, st.mode & 0o777);
  }
}

/**
 * Extract revision rev of the repository at repo into dest, the way GitHub serves a tag (git archive),
 * with git and tar by absolute path. Returns false when either is missing or rev is not readable here
 * (a shallow clone), so a caller can skip with that reason.
 * @param {string} repo
 * @param {string} rev
 * @param {string} dest
 */
export function extractRevision(repo, rev, dest) {
  const git = which('git');
  const tar = process.platform === 'win32' ? null : which('tar');
  if (!git || !tar) return false;
  if (spawnSync(git, ['-C', repo, 'cat-file', '-e', rev + '^{commit}']).status !== 0) return false;
  fs.mkdirSync(dest, { recursive: true });
  const archive = path.join(dest, '..', path.basename(dest) + '.tar');
  if (spawnSync(git, ['-C', repo, 'archive', '--format=tar', '-o', archive, rev]).status !== 0) return false;
  const ok = spawnSync(tar, ['-xf', archive, '-C', dest]).status === 0;
  fs.rmSync(archive, { force: true });
  return ok;
}
