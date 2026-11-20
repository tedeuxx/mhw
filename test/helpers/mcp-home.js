// Throwaway HOMEs for the MCP suites (test/render/mcp.test.js, test/mcp/*.test.js): a HOME with each agent
// harness's directory, its config paths, the local definition and an environment that names only that HOME.
// Never a real HOME; the base directory is the suite's own throwaway one.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AGENT_ENV } from '../../src/render/mcp.js';
import { putJson, PROJECT } from '../render/mcp-cases.js';

const NODE = process.execPath;
const DARWIN = process.platform === 'darwin';

/**
 * @param {string} base the suite's throwaway directory
 * @param {string} render the renderer the suite runs (src/render/mcp.js)
 */
export function mcpHomes(base, render) {
  /** @param {string} name */
  function mkHome(name) {
    const h = path.join(base, name);
    fs.rmSync(h, { recursive: true, force: true });
    for (const d of ['.codex', '.claude', '.kiro']) fs.mkdirSync(path.join(h, d), { recursive: true });
    if (DARWIN) fs.mkdirSync(path.join(h, 'Library', 'Application Support', 'Claude'), { recursive: true });
    return h;
  }
  /** @param {string} h */
  const data = (h) => path.join(h, '.local', 'share', PROJECT);
  /** @param {string} h */
  function targets(h) {
    /** @type {Record<string, string>} */
    const t = { codex: path.join(h, '.codex', 'config.toml'), 'claude-code': path.join(h, '.claude.json'), kiro: path.join(h, '.kiro', 'settings', 'mcp.json') };
    if (DARWIN) t['claude-desktop'] = path.join(h, 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
    return t;
  }
  /** @param {string} h @param {unknown} doc */
  function writeSource(h, doc) {
    const p = path.join(data(h), 'local-overlay', 'mcp-servers.json');
    putJson(p, doc);
    return p;
  }
  /** @param {string} h @param {Record<string, string>} [extra] @returns {Record<string, string>} */
  function cleanEnv(h, extra = {}) {
    /** @type {Record<string, string>} */
    const env = {};
    const drop = new Set([...AGENT_ENV, 'CODEX_HOME', 'XDG_DATA_HOME', 'APPDATA', 'MHW_NODE', 'MHW_MCP_RENDER_NODE']);
    for (const [k, v] of Object.entries(process.env)) if (!drop.has(k) && v !== undefined) env[k] = v;
    return { ...env, HOME: h, USERPROFILE: h, MHW_NODE: NODE, ...extra };
  }
  /** @param {string} h @param {string[]} args @param {Record<string, string>} [env] */
  function run(h, args, env) {
    const p = spawnSync(NODE, [render, ...args], { env: env || cleanEnv(h), encoding: 'utf8', cwd: base });
    return { code: p.status, stdout: p.stdout, stderr: p.stderr, all: p.stdout + p.stderr };
  }
  /** @param {string} h */
  const manifest = (h) => path.join(data(h), 'mcp-managed.json');
  return { mkHome, data, targets, writeSource, cleanEnv, run, manifest };
}
