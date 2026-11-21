// The workspace status reports on (#493, S22 of #470; moved from global/workstation.py): its root, the
// agent harness carriers in it, and what stops its root AGENTS.md from reaching every agent harness
// whole (ADR-0037). An instruction check: it reports and changes nothing, and no hook runs it.
// git is the first on PATH, run by absolute path. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { KEY_FILE, exists, isFile, resolvePath, parents, homeOf, baseName, splitlines } from './common.js';
import { onPath } from '../onpath.js';
import { runAbsolute } from '../run.js';
import { pyStrip } from '../py.js';

/** @typedef {import('./common.js').Env} Env */
/** @typedef {{ name: string, root: string | null, carriers: string[], brief?: string[] }} Workspace */

// Measured on Claude Code 2.1.296 (2026-10-11): a root AGENTS.md is loaded natively only when none of
// these exists, in the root or in any ancestor directory; any one of them replaces it entirely. Codex cuts
// project docs at project_doc_max_bytes, 32768 bytes by default.
export const SHADOWS = ['CLAUDE.md', '.claude/CLAUDE.md', 'CLAUDE.local.md'];
export const CODEX_DOC_MAX_BYTES = 32768;
const CARRIERS = [KEY_FILE, 'AGENTS.md', 'CLAUDE.md', '.claude', '.codex', '.kiro', '.agents'];

/**
 * The main checkout's root when top is a LINKED git worktree (its git dir differs from the common dir),
 * else null. A linked worktree does not load its main checkout's instruction files (measured).
 * @param {string} top
 * @param {Env} env
 */
export function mainCheckoutOf(top, env) {
  const git = onPath('git', env);
  if (!git) return null;
  /** @type {string[]} */
  const dirs = [];
  for (const flag of ['--git-dir', '--git-common-dir']) {
    const r = runAbsolute(git, ['-C', top, 'rev-parse', flag], { env, stdio: ['inherit', 'pipe', 'pipe'] });
    const out = pyStrip(r.stdout);
    if (r.error || r.code !== 0 || !out) return null;
    dirs.push(resolvePath(path.isAbsolute(out) ? out : path.join(top, out)));
  }
  const [gitDir, common] = dirs;
  return gitDir !== common ? path.dirname(common) : null;
}

/**
 * What stops the workspace's root AGENTS.md from reaching every agent harness whole: a shadowing file in
 * the root or in an ancestor directory, and an AGENTS.md Codex truncates. The user-level
 * ~/.claude/CLAUDE.md is not a shadow (measured). A linked worktree skips its main checkout's root;
 * ancestors above that root are still named, as not measured.
 * @param {string} top
 * @param {Env} env
 */
export function rootBriefFindings(top, env) {
  const found = SHADOWS.filter((n) => isFile(path.join(top, n)))
    .map((n) => n + ': AGENTS.md is the root brief; this file makes Claude Code ignore AGENTS.md');
  const userBrief = path.join(resolvePath(homeOf(env)), '.claude', 'CLAUDE.md');
  const main = mainCheckoutOf(top, env);
  const seen = new Set([userBrief, ...(main !== null ? SHADOWS.map((n) => path.join(main, n)) : [])]);
  let above = false;
  for (const parent of parents(resolvePath(top))) {
    if (parent === main) above = true;
    const label = above && parent !== main ? 'ancestor above the main checkout, not measured' : 'ancestor';
    for (const n of SHADOWS) {
      const p = path.join(parent, n);
      if (!seen.has(p) && isFile(p)) {
        seen.add(p);
        found.push(p + ' (' + label + '): this file makes Claude Code ignore AGENTS.md');
      }
    }
  }
  let size = 0;
  try {
    size = fs.statSync(path.join(top, 'AGENTS.md')).size;
  } catch {
    size = 0;
  }
  if (size > CODEX_DOC_MAX_BYTES) found.push('AGENTS.md is ' + size + ' bytes, over ' + CODEX_DOC_MAX_BYTES + ': Codex truncates it');
  return found;
}

/**
 * The workspace: --project=DIR, or the git root of the current directory.
 * @param {string | null} project
 * @param {Env} env
 * @param {string} cwd
 * @returns {Workspace}
 */
export function workspace(project, env, cwd) {
  let top;
  if (project !== null) {
    top = resolvePath(path.resolve(cwd, project));
  } else {
    const git = onPath('git', env);
    if (!git) return { name: '', root: null, carriers: [] };
    const r = runAbsolute(git, ['rev-parse', '--show-toplevel'], { env, cwd, stdio: ['inherit', 'pipe', 'pipe'] });
    const code = r.error ? 2 : r.code;
    const out = splitlines(r.stdout + r.stderr);
    if (code !== 0 || !out.length) return { name: '', root: null, carriers: [] };
    top = out[0];
  }
  const carriers = CARRIERS.filter((c) => exists(path.join(top, c)));
  return { name: baseName(top), root: top, carriers, brief: rootBriefFindings(top, env) };
}
