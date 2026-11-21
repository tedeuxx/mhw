// What the install.sh parity tests share (S19 allow list, #490; S20 settings merge, #491): the throwaway
// admin fixtures, fixture changes, the HOME tree a transcript records, the dry-run hunks as sets of
// lines, the base revision, and the transcript inventory check. Tests only.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { goldenPath } from './golden.js';
import { which } from './home.js';

const NAME = 'personal-multi-harness-workstation-configuration';
const MARKER = 'managed-by: ' + NAME;

/**
 * @typedef {{ write: string, text: string } | { rm: string } | { symlink: string, to: string } | { mkdir: string }
 *   | { chmod: string, mode: number } | { admin: string }} Change
 * @typedef {{ run: string, code: number | null, stdout: string, stderr: string, tree: unknown }} Run
 */

/** @param {string[]} kinds @param {string} kind */
const one = (kinds, kind) => kinds.includes(kind);

/**
 * The admin fixtures, under both platform paths so a scenario reads the same on macOS and Linux.
 * claude-missing drops the floor's first rule; claude-bad is not JSON; codex-unmanaged lacks the marker.
 * @param {string} root the throwaway admin root
 * @param {string} kind
 * @param {{ inputs: string, stamp: string, claude: string[], codex: string[] }} o which kinds write each file
 */
export function writeAdmin(root, kind, o) {
  fs.rmSync(root, { recursive: true, force: true });
  fs.mkdirSync(root, { recursive: true });
  if (kind === 'none') return;
  const claude = fs.readFileSync(path.join(o.inputs, 'floor.claude'), 'utf8').split('\n').filter(Boolean);
  const codex = fs.readFileSync(path.join(o.inputs, 'floor.codex'), 'utf8').split('\n').filter(Boolean);
  if (one(o.claude, kind)) {
    const deny = kind === 'claude-missing' ? claude.slice(1) : claude;
    const text = kind === 'claude-bad' ? '{"permissions": ' : JSON.stringify({ permissions: { deny: [...deny, 'Bash(extra:*)'] } }, null, 2) + '\n';
    for (const rel of ['Library/Application Support/ClaudeCode/managed-settings.d', 'etc/claude-code/managed-settings.d']) {
      fs.mkdirSync(path.join(root, rel), { recursive: true });
      fs.writeFileSync(path.join(root, rel, '50-' + NAME + '.json'), text);
    }
  }
  if (one(o.codex, kind)) {
    const head = kind === 'codex-unmanaged' ? '# hand written\n' : '# ' + MARKER + '; ' + o.stamp + '\n';
    const rules = codex.map((w) => '  { pattern = [' + w.split(' ').map((t) => '{ token = "' + t + '" }').join(', ')
      + '], decision = "forbidden", justification = "workstation deny floor (ADR-0016)" },\n').join('');
    fs.mkdirSync(path.join(root, 'etc', 'codex'), { recursive: true });
    fs.writeFileSync(path.join(root, 'etc', 'codex', 'requirements.toml'), head + '[rules]\nprefix_rules = [\n' + rules + ']\n');
  }
}

/** A fixture path: its first segment names a directory of d (H, P, A, T). @param {Record<string, string>} d @param {string} p */
export function at(d, p) {
  const [k, ...rest] = p.split('/');
  return path.join(d[k], ...rest);
}

/**
 * One fixture change. A write replaces whatever is there.
 * @param {Record<string, string>} d @param {Change} c @param {(kind: string) => void} admin
 */
export function apply(d, c, admin) {
  if ('write' in c) {
    fs.mkdirSync(path.dirname(at(d, c.write)), { recursive: true });
    fs.rmSync(at(d, c.write), { force: true });
    fs.writeFileSync(at(d, c.write), c.text);
  } else if ('rm' in c) fs.rmSync(at(d, c.rm), { recursive: true, force: true });
  else if ('symlink' in c) {
    fs.mkdirSync(path.dirname(at(d, c.symlink)), { recursive: true });
    fs.symlinkSync(c.to, at(d, c.symlink));
  } else if ('mkdir' in c) fs.mkdirSync(at(d, c.mkdir), { recursive: true });
  else if ('chmod' in c) fs.chmodSync(at(d, c.chmod), c.mode);
  else admin(c.admin);
}

/** Every entry under dir: a link's target, a file's text, a directory; with its mode. @param {string} dir @param {(s: string) => string} norm */
export function tree(dir, norm) {
  /** @type {Array<{ path: string, kind: string, mode: string, data: string }>} */
  const out = [];
  /** @param {string} rel */
  const walk = (rel) => {
    for (const name of fs.readdirSync(path.join(dir, rel)).sort((a, b) => (a < b ? -1 : Number(a > b)))) {
      const r = rel ? rel + '/' + name : name;
      const st = fs.lstatSync(path.join(dir, r));
      const mode = (st.mode & 0o777).toString(8);
      if (st.isSymbolicLink()) out.push({ path: r, kind: 'link', mode: '-', data: norm(fs.readlinkSync(path.join(dir, r))) });
      else if (st.isDirectory()) {
        out.push({ path: r, kind: 'dir', mode, data: '' });
        walk(r);
      } else out.push({ path: r, kind: 'file', mode, data: norm(fs.readFileSync(path.join(dir, r), 'utf8')) });
    }
  };
  walk('');
  return out;
}

/**
 * A dry run's diff as sets: each run of hunk lines replaced by its removed lines and its added lines, each
 * sorted, with the context and the hunk headers dropped. Two diff programs may align a repeated line
 * differently and both be right (Apple diff, GNU diff, src/lib/unified-diff.js).
 * @template {Run} R
 * @param {R[]} runs
 * @returns {R[]}
 */
export function hunksAsSets(runs) {
  return runs.map((r) => {
    const out = [];
    /** @type {string[] | null} */
    let block = null;
    const flush = () => {
      if (!block) return;
      const by = (/** @type {string} */ c) => (/** @type {string[]} */ (block)).filter((l) => l[0] === c).sort((a, b) => (a < b ? -1 : Number(a > b)));
      out.push('<hunks>', ...by('-'), ...by('+'), '</hunks>');
      block = null;
    };
    for (const line of r.stdout.split('\n')) {
      if (line.startsWith('@@ ') || (block && /^[ +-]/.test(line))) (block ??= []).push(line);
      else {
        flush();
        out.push(line);
      }
    }
    flush();
    return { ...r, stdout: out.join('\n') };
  });
}

/** The revision the head is compared with (test/parity.test.js's parityBase). @param {string} root */
export function baseRevision(root) {
  if (process.env.MHW_PARITY_BASE) return process.env.MHW_PARITY_BASE;
  const git = which('git');
  if (!git) return null;
  const p = spawnSync(git, ['-C', root, 'merge-base', 'HEAD', 'origin/' + (process.env.GITHUB_BASE_REF || 'rc/next')], { encoding: 'utf8' });
  return p.status === 0 ? p.stdout.trim() : null;
}

/**
 * Every scenario has a golden transcript (and a declared one its Node golden too), and every transcript a scenario.
 * @param {string} slice @param {Array<{ name: string, declared?: boolean }>} scenarios
 */
export function assertTranscriptInventory(slice, scenarios) {
  const byName = (/** @type {string} */ a, /** @type {string} */ b) => (a < b ? -1 : Number(a > b));
  const files = fs.readdirSync(goldenPath(slice, 'transcripts')).sort(byName);
  const want = scenarios.flatMap((s) => (s.declared ? [s.name + '.json', s.name + '.node.json'] : [s.name + '.json']));
  assert.deepEqual(files, want.sort(byName));
}
