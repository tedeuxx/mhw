// The host status names (#493, S22 of #470; moved from global/workstation.py): host or container, and
// the version of each agent harness CLI found on PATH. Each CLI is the first on PATH, run by absolute
// path with --version and a 10-second bound. node: modules only.
import fs from 'node:fs';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { systemName, splitlines } from './common.js';
import { onPath } from '../onpath.js';
import { pyStrip } from '../py.js';

/** @typedef {import('./common.js').Env} Env */

export const HARNESSES = /** @type {const} */ ([['Claude Code', 'claude'], ['Codex', 'codex'], ['Kiro', 'kiro-cli']]);

/**
 * {agent harness: first line of `<cli> --version`, 'version unknown', or null when not on PATH}.
 * @param {Env} env
 * @returns {Record<string, string | null>}
 */
export function harnessVersions(env) {
  /** @type {Record<string, string | null>} */
  const out = {};
  for (const [name, exe] of HARNESSES) {
    const p = onPath(exe, env);
    if (!p) {
      out[name] = null;
      continue;
    }
    const r = spawnSync(p, ['--version'], { env, stdio: ['inherit', 'pipe', 'pipe'], timeout: 10000, encoding: 'utf8', shell: false, windowsHide: true });
    if (r.error) {
      out[name] = 'version unknown';
      continue;
    }
    out[name] = splitlines(pyStrip(r.stdout || ''))[0] ?? 'version unknown';
  }
  return out;
}

/** @param {string} p */
const present = (p) => {
  try {
    fs.statSync(p);
    return true;
  } catch {
    return false;
  }
};

/**
 * Host or container, and the system: "host (Darwin arm64; no container marker found)".
 * @param {Env} env
 */
export function runtime(env) {
  const system = systemName() + ' ' + os.machine();
  if (present('/run/.containerenv')) return 'container (Podman marker /run/.containerenv) on ' + system;
  if (present('/.dockerenv')) return 'container (Docker marker /.dockerenv) on ' + system;
  if (env.container) return 'container (' + env.container + ', from $container) on ' + system;
  let cgroup = null;
  try {
    cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
  } catch {
    cgroup = null;
  }
  if (cgroup !== null) {
    for (const word of ['docker', 'podman', 'containerd', 'kubepods']) {
      if (cgroup.includes(word)) return 'container (' + word + ' in /proc/1/cgroup) on ' + system;
    }
  }
  return 'host (' + system + '; no container marker found)';
}
