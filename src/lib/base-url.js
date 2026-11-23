// Issue #27 (ADR-0003 h1): a workspace's Claude Code settings can route the subscription bearer to another host
// through `env.ANTHROPIC_BASE_URL`. `mhw status` and `mhw scan` name it as file:line and a category, never the
// value. It informs only: no caller changes its exit code because of a finding (owner ruling, 2026-11-17).
import fs from 'node:fs';
import path from 'node:path';

export const CATEGORY = 'anthropic-base-url';
export const VARIABLE = 'ANTHROPIC_BASE_URL';
/** The workspace files Claude Code reads an `env` block from, relative to the workspace root. */
export const SETTINGS_FILES = ['.claude/settings.json', '.claude/settings.local.json'];

/** @param {string} rel a path as the caller names it (either separator) */
export function isSettingsPath(rel) {
  return /(^|[\\/])\.claude[\\/]settings(\.local)?\.json$/.test(rel);
}

/**
 * [line, length] when the text is a JSON object whose `env` object sets ANTHROPIC_BASE_URL; length is the
 * value's when it is a string, else that of its JSON form. The line is the first line naming the key as a
 * member at or after the line that opens `"env"`, or 1 when none can be located. Text JSON cannot parse
 * (comments, a trailing comma) still reports every line naming the key as a member, with the length of a
 * string value on that line, or 0: a check that informs must not go silent on a file it cannot parse.
 * @param {string} text
 * @returns {Array<[number, number]>}
 */
export function findInSettings(text) {
  const lines = text.split('\n');
  const member = new RegExp('"' + VARIABLE + '"\\s*:\\s*("(?:[^"\\\\]|\\\\.)*")?');
  let doc;
  try {
    doc = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    /** @type {Array<[number, number]>} */
    const raw = [];
    lines.forEach((l, i) => {
      const m = member.exec(l);
      if (!m) return;
      let length = 0;
      try {
        length = m[1] ? String(JSON.parse(m[1])).length : 0;
      } catch {
        length = 0;
      }
      raw.push([i + 1, length]);
    });
    return raw;
  }
  const env = doc && typeof doc === 'object' && !Array.isArray(doc) ? doc.env : undefined;
  if (!env || typeof env !== 'object' || Array.isArray(env) || !Object.hasOwn(env, VARIABLE)) return [];
  const value = env[VARIABLE];
  const length = typeof value === 'string' ? value.length : JSON.stringify(value ?? null).length;
  const envAt = Math.max(0, lines.findIndex((l) => /"env"\s*:/.test(l)));
  const at = lines.findIndex((l, i) => i >= envAt && member.test(l));
  return [[at >= 0 ? at + 1 : 1, length]];
}

/**
 * Each finding in a workspace's settings files, as `file:line: category, N chars`. Never the value.
 * @param {string | null | undefined} root the workspace root
 * @returns {string[]}
 */
export function workspaceFindings(root) {
  if (!root) return [];
  /** @type {string[]} */
  const out = [];
  for (const rel of SETTINGS_FILES) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, rel), 'utf8');
    } catch {
      continue;
    }
    for (const [line, length] of findInSettings(text)) out.push(rel + ':' + line + ': ' + CATEGORY + ', ' + length + ' chars');
  }
  return out;
}
