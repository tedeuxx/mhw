// Render the working method (method/) into each agent harness's user-level native carrier (ADR-0032), the
// Node form of the deleted global/method/method_render.py (#489, S18 of #470). Same arguments, same output
// lines, same exit codes, same files written byte for byte, with one intended difference: no method
// script is installed (D9: the scripts the rites ran are mhw commands now). test/golden/S18 holds the
// transcripts recorded from the Python original and expected-differences.json names what differs.
//
//   node src/render/method.js --mode=install|check|dry-run|uninstall [--stamp="release: R; commit: C"]
//                             [--source=DIR] [--home=DIR] [--opt-in] [--project=DIR]
//
// --project=DIR also renders DIR/.mhw/method/{agents,skills} into DIR's project carriers, first: see
// "The project target" below (#576).
//
// Off by default (#61, until the plugin cutover #63 and #64): without --opt-in, and with no rendered file
// of the method present, it writes nothing and prints one METHOD line saying so. With --opt-in, or once a
// rendered file is present, it renders and checks every target.
//
// mhw install-user and mhw install-windows (install.sh and install.ps1 until #503 and #497) run this as
// their own rendering step and pass the provenance stamp they derived (ADR-0029), so the stamp is derived
// once. ./mhw install, check, status and uninstall reach it
// through them.
//
// Carriers (ADR-0027 matrix, ADR-0032):
//     Claude Code  ~/.claude/agents/<n>.md (tools, disallowedTools, skills), ~/.claude/skills/<n>/SKILL.md,
//                  ~/.claude/commands/<n>.md
//     Codex        ${CODEX_HOME:-~/.codex}/agents/<n>.toml (no tool list exists: an instruction, plus a
//                  read-only sandbox for an agent granted no tool), ~/.agents/skills/<n>/SKILL.md, and each
//                  command as a skill with agents/openai.yaml policy.allow_implicit_invocation false
//     Kiro         ~/.kiro/agents/<n>.json (tools, excludedTools, preloaded skills as files; no allowedTools,
//                  so nothing is auto-approved: Kiro carries no deny floor),
//                  ~/.kiro/skills/<n>/SKILL.md, and each command as a skill (a slash command in CLI and IDE)
//     Fields       each source kind accepts only the front-matter fields it uses; any other field stops the
//                  render, so a retired field (deprecated-aliases, removed at #524) cannot be ignored silently
//     Documents    a Markdown document one directory down (method/scripts/<dir>/<name>.md, such as a store
//                  contract) is installed in ${XDG_DATA_HOME:-~/.local/share}/personal-multi-harness-
//                  workstation-configuration/method/scripts/ (with --home, always under that home's
//                  .local/share) only when a rendered body names it as {{method-scripts}}/<dir>/<name>.md,
//                  so a rite carries the contract its driver reads (#181). In a rendered body,
//                  {{method-scripts}} becomes that directory; a {{method-scripts}}/<name> naming no such
//                  document stops the render.
//     Scripts      none since #489. The rites run mhw commands (mhw milestone, worklog, rite-cadence,
//                  funnel-review, launch-line), so no method/scripts/*.py or *.sh is read or installed.
//                  A copy an earlier version installed carries the managed-by line with "source: method/",
//                  so check reports it STALE and install removes it, as for any file no longer rendered.
//     Harness      in a command body, {{agent-harness}} becomes the id of the agent harness that copy is for
//                  (claude-code, codex, kiro), so /handoff defaults to its own harness's launch line (#198).
//                  The Kiro copy serves the CLI and the IDE alike. In a skill or agent body the token stops
//                  the render.
//
// Every rendered file carries the managed-by line with the stamp, "source: method/...", in its own format's
// comment (Markdown front matter, TOML, YAML, an HTML comment) or, in the Kiro agent JSON, as the first line
// of its prompt. A file without that line is never overwritten or removed. Output lines use install.sh's
// words: OK, WROTE, RESTAMPED, STAMP, DRIFT, MISSING, STALE, REFUSE, REMOVED.
// Exit codes: 0 ok; 1 a target differs (--check); 2 usage or invalid source; 3 an unmanaged file is in the way.
//
// Python semantics are reproduced where they change bytes or order: a file is read as strict UTF-8 (a
// byte-order mark kept) with \r\n and a lone \r read as \n, and written with \r\n on Windows, as Python's
// text mode does; str(Path) spellings (no "." part, ".." kept); pathlib's glob (dot names matched, a
// symbolic link to a directory followed) and its sort (part by part, by code point); Python's whitespace
// set in strip() and \s; json.dumps(ensure_ascii=False) and Path.as_uri(). node: modules and the vendored
// TOML parser only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER_ID } from '../lib/marker.js';
import { loads, dumps, pyStrip, pyRepr, pyLen, isPyWs, isDict, cmpStr } from '../lib/py.js';
import { pyPath } from './model-defaults.js';
import { parse as parseToml } from '../vendor/smol-toml/dist/index.js';

const SOURCE_TAG = 'source: method/';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SOURCE = path.join(HERE, '..', '..', 'method');
const NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const TOOL_RE = /^[A-Za-z][A-Za-z0-9_*-]*$/;
// Claude Code tool names -> Kiro tool tags (Kiro agent configuration reference: read, write, shell, web,
// @server). Anything not listed here stops the render rather than being dropped silently.
/** @type {Record<string, string>} */
export const KIRO_TOOLS = {
  Read: 'read', Grep: 'read', Glob: 'read', Write: 'write', Edit: 'write', Bash: 'shell', WebFetch: 'web', WebSearch: 'web',
};
const WRITING_TOOLS = new Set(['Write', 'Edit', 'Bash']);
const DESCRIPTION_MAX = 1024; // Agent Skills standard limit, read by Codex and Kiro
export const SCRIPTS_TOKEN = '{{method-scripts}}';
// A command's body may name the agent harness its copy is rendered for (#198): each carrier writer is passed
// its harness explicitly and substitutes this token, so one source text yields three different copies. Only
// a command body may carry it: a skill or an agent is one text for every harness, so there it stops the render.
export const HARNESS_TOKEN = '{{agent-harness}}';
export const HARNESSES = ['claude-code', 'codex', 'kiro'];
const TOKEN_REF_RE = /\{\{method-scripts\}\}\/([A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*)/g;
const SEGMENT_HEAD = /^\w$/;
const SEGMENT_REST = /^[\w-]*$/;
const FILE_REST = /^[\w.-]*$/;
const MODES = new Set(['install', 'check', 'dry-run', 'uninstall']);

export class SourceError extends Error {}

/**
 * @typedef {string | string[]} Field
 * @typedef {Map<string, Field>} Fields
 * @typedef {{ description: string, purpose: Field, body: string, where: string }} Skill
 * @typedef {{ description: string, purpose: Field, hint: Field, body: string, where: string }} Command
 * @typedef {{ description: string, purpose: Field, tools: string[], excluded: string[], skills: string[], body: string, where: string }} Agent
 * @typedef {{ claude: string, codex: string, agents: string, kiro: string, scripts: string }} Homes
 * @typedef {{ env: Record<string, string | undefined>, platform: string, cwd: string, home: string | null }} Ctx
 * @typedef {[string, string, string] | [string, string, string, string]} Target path, text, format, and the source tag
 *   a project target carries (#576); a user-level target omits it
 */

// --------------------------------------------------------------------------------------------------
// Python text and path semantics.

/** Python's %r of a str. @param {string} s */
const repr = (s) => pyRepr(s);

/**
 * Path.read_text(encoding="utf-8"): strict UTF-8, the byte-order mark kept, universal newlines.
 * @param {string} file
 */
export function readText(file) {
  const raw = fs.readFileSync(file);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw).replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

/**
 * Path.write_text(text, encoding="utf-8"): \n becomes \r\n on Windows.
 * @param {string} file @param {string} text @param {string} platform
 */
function writeText(file, text, platform) {
  fs.writeFileSync(file, platform === 'win32' ? text.replaceAll('\n', '\r\n') : text);
}

/** @param {string} platform */
const sepOf = (platform) => (platform === 'win32' ? '\\' : '/');

/**
 * str(Path(a) / b / ...), for b free of separators.
 * @param {string} platform @param {string} base @param {...string} parts
 */
function join(platform, base, ...parts) {
  const sep = sepOf(platform);
  let out = base;
  for (const p of parts) out = out.endsWith(sep) ? out + p : out + sep + p;
  return out;
}

/** @param {string} p @param {string} platform */
function isAbs(p, platform) {
  if (platform === 'win32') return /^(?:[A-Za-z]:\\|\\\\)/.test(p);
  return p.startsWith('/');
}

/**
 * str(Path(p).absolute()): no "." part, ".." kept, relative paths joined to the working directory.
 * @param {string} p @param {Ctx} ctx
 */
function pyAbsolute(p, ctx) {
  const n = pyPath(p, ctx.platform);
  if (isAbs(n, ctx.platform)) return n;
  const cwd = pyPath(ctx.cwd, ctx.platform);
  return n === '.' ? cwd : join(ctx.platform, cwd, n);
}

/** The lexical parent of a str(Path). @param {string} p @param {string} platform */
function parentOf(p, platform) {
  const sep = sepOf(platform);
  const i = p.lastIndexOf(sep);
  if (i < 0) return '.';
  const head = p.slice(0, i);
  if (platform === 'win32') return /^[A-Za-z]:$/.test(head) || head === '' ? head + sep : head;
  if (head === '' || head === '/') return p.startsWith('//') && !p.startsWith('///') ? '//' : '/';
  return head;
}

/** Path equality key: case-insensitive on Windows. @param {string} p @param {string} platform */
const key = (p, platform) => (platform === 'win32' ? p.toLowerCase() : p);

/** `stop in Path(p).parents`. @param {string} stop @param {string} p @param {string} platform */
function isUnder(stop, p, platform) {
  const sep = sepOf(platform);
  const s = key(stop, platform);
  const q = key(p, platform);
  if (s === q) return false;
  return s.endsWith(sep) ? q.startsWith(s) : q.startsWith(s + sep);
}

/** Python's `Path.parents` order of two paths under one base: part by part, by code point. */
function comparePaths(/** @type {string[]} */ a, /** @type {string[]} */ b, /** @type {string} */ platform) {
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = platform === 'win32' ? a[i].toLowerCase() : a[i];
    const y = platform === 'win32' ? b[i].toLowerCase() : b[i];
    const d = cmpStr(x, y);
    if (d) return d;
  }
  return a.length - b.length;
}

/** @param {string} p */
const lexists = (p) => {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
};
/** @param {string} p */
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
/** @param {string} p */
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
/** @param {string} p */
const isLink = (p) => {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
};
/** @param {string} p @returns {string[]} */
const entries = (p) => {
  try {
    return fs.readdirSync(p);
  } catch {
    return [];
  }
};

/**
 * sorted(Path(base).glob(pattern)) for the patterns this renderer uses: "*" (every name, dot names
 * included), "*.ext", and literal parts. A wildcard part that is not the last one keeps directories
 * (a symbolic link to one is followed); the trailing literal parts are matched as lexists does, so a
 * broken link is yielded. Matching is case-sensitive on POSIX, as pathlib's is.
 * @param {string} base @param {string} pattern @param {string} platform
 * @returns {string[]}
 */
function glob(base, pattern, platform) {
  const segs = pattern.split('/');
  /** @param {string} name @param {string} seg */
  const match = (name, seg) => {
    if (seg === '*') return true;
    const ext = seg.slice(1);
    return platform === 'win32' ? name.toLowerCase().endsWith(ext.toLowerCase()) : name.endsWith(ext);
  };
  /** @type {string[][]} */
  let found = [[]];
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    const last = i === segs.length - 1;
    /** @type {string[][]} */
    const next = [];
    for (const parts of found) {
      const dir = join(platform, base, ...parts);
      if (!seg.startsWith('*')) {
        // a literal tail: lexists for the last part, a directory before it
        const p = join(platform, dir, seg);
        if (last ? lexists(p) : isDir(p)) next.push([...parts, seg]);
        continue;
      }
      for (const name of entries(dir)) {
        if (!match(name, seg)) continue;
        if (!last && !isDir(join(platform, dir, name))) continue;
        next.push([...parts, name]);
      }
    }
    found = next;
  }
  return found.toSorted((a, b) => comparePaths(a, b, platform)).map((parts) => join(platform, base, ...parts));
}

/** The name of the last part of a str(Path). @param {string} p @param {string} platform */
const basename = (p, platform) => p.slice(p.lastIndexOf(sepOf(platform)) + 1);

/** Path.stem of a name ending in ".md". @param {string} name */
const stemOfMd = (name) => (name.length > 3 ? name.slice(0, -3) : name);

/**
 * Path.as_uri(): file:// and the path, percent-encoded as urllib's quote() does (only letters, digits,
 * "_.-~" and "/" kept). On Windows: file:///<drive>:/<path>.
 * @param {string} p an absolute str(Path) @param {string} platform
 */
export function asUri(p, platform) {
  /** @param {string} s */
  const quote = (s) => {
    let out = '';
    for (const b of Buffer.from(s, 'utf8')) {
      const c = String.fromCodePoint(b);
      out += /[A-Za-z0-9_.~/-]/.test(c) && b < 0x80 ? c : '%' + b.toString(16).toUpperCase().padStart(2, '0');
    }
    return out;
  };
  if (platform === 'win32') {
    const posix = p.replaceAll('\\', '/');
    if (/^[A-Za-z]:/.test(posix)) return 'file:///' + posix.slice(0, 2) + quote(posix.slice(2));
    return 'file:' + quote(posix);
  }
  return 'file://' + quote(p);
}

/** Python's \s, negated: one code point that is not whitespace. @param {string} ch */
const notWs = (ch) => !isPyWs(ch);

/** json.dumps(value, ensure_ascii=False) on one line, Python's default separators. @param {unknown} v */
const q = (v) => dumps(v, { sortKeys: false, separators: [', ', ': '] });

// --------------------------------------------------------------------------------------------------
// Source parsing: a restricted front matter (key: scalar, or key: followed by "  - item" lines).

/** `\s+-\s+(\S+)` fullmatch; the item or null. @param {string} line */
function listItem(line) {
  const cps = Array.from(line);
  let i = 0;
  while (i < cps.length && isPyWs(cps[i])) i++;
  if (i === 0 || cps[i] !== '-') return null;
  let j = i + 1;
  while (j < cps.length && isPyWs(cps[j])) j++;
  if (j === i + 1 || j >= cps.length) return null;
  const rest = cps.slice(j);
  return rest.every(notWs) ? rest.join('') : null;
}

/**
 * @param {string} text
 * @param {string} where
 * @returns {{ fields: Fields, body: string }}
 */
export function splitFrontMatter(text, where) {
  const lines = text.split('\n');
  if (lines[0] !== '---') throw new SourceError(where + ': no front matter');
  const end = lines.indexOf('---', 1);
  if (end < 0) throw new SourceError(where + ': unterminated front matter');
  /** @type {Fields} */
  const fields = new Map();
  /** @type {string | null} */
  let current = null;
  for (const line of lines.slice(1, end)) {
    if (!pyStrip(line)) continue;
    const m = /^([a-z][a-z-]*):([^\n]*)$/.exec(line);
    if (m) {
      current = m[1];
      if (fields.has(current)) throw new SourceError(where + ': duplicate key ' + current);
      const value = pyStrip(m[2]);
      if (value === '[]' || value === '') {
        fields.set(current, []);
      } else if (value.startsWith('"')) {
        try {
          fields.set(current, /** @type {string} */ (loads(value)));
        } catch {
          throw new SourceError(where + ': invalid quoted value for ' + current);
        }
      } else {
        fields.set(current, value);
      }
      continue;
    }
    const item = listItem(line);
    const list = current === null ? undefined : fields.get(current);
    if (item !== null && Array.isArray(list)) {
      list.push(item);
      continue;
    }
    throw new SourceError(where + ': unsupported front matter line: ' + line);
  }
  return { fields, body: lines.slice(end + 1).join('\n') };
}

/** @param {Fields} fields @param {string} k @param {string} where */
function need(fields, k, where) {
  const value = fields.get(k);
  if (typeof value !== 'string' || !pyStrip(value)) throw new SourceError(where + ': missing ' + k);
  if (value.includes('\n')) throw new SourceError(where + ': ' + k + ' must be one line');
  return value;
}

// The front-matter fields each source kind may carry. Any other field stops the render: a field the
// renderer does not read would otherwise be ignored without a word (#524 removed deprecated-aliases).
/** @type {Record<string, Set<string>>} */
export const FIELDS = {
  skills: new Set(['name', 'description', 'purpose']),
  commands: new Set(['name', 'description', 'purpose', 'argument-hint']),
  agents: new Set(['name', 'description', 'purpose', 'tools', 'disallowed-tools', 'skills']),
};

/** @param {Fields} fields @param {string} kind @param {string} where */
function knownFields(fields, kind, where) {
  const unknown = [...fields.keys()].filter((f) => !FIELDS[kind].has(f)).sort(cmpStr);
  if (unknown.length) throw new SourceError(where + ': unknown front matter field ' + unknown.join(', '));
}

/** A tool list: a list as it is, or a comma-separated string. @param {Field} raw */
const toolList = (raw) => (Array.isArray(raw) ? raw : raw.split(',').map((t) => pyStrip(t)).filter(Boolean));

/** `mcp__([A-Za-z0-9_-]+?)__([A-Za-z0-9_-]+)` fullmatch: [server, tool] or null. @param {string} t */
export function mcpTool(t) {
  if (!t.startsWith('mcp__')) return null;
  const r = t.slice(5);
  if (!/^[A-Za-z0-9_-]+$/.test(r)) return null;
  for (let i = 1; i + 2 < r.length; i++) {
    if (r[i] === '_' && r[i + 1] === '_') return [r.slice(0, i), r.slice(i + 2)];
  }
  return null;
}

/**
 * @param {string} source the directory (a path the file system reads)
 * @param {string} shown the same path as str(Path(arg)), for the message
 * @param {string} platform
 * @param {{ prefix?: string, external?: Map<string, Skill>, project?: boolean }} [opts] a project source (#576):
 *   its own prefix for messages and markers, the user-level skills its agents may also preload, and the
 *   project rules (agents and skills only, at least one of them, no {{method-scripts}})
 * @returns {{ skills: Map<string, Skill>, agents: Map<string, Agent>, commands: Map<string, Command> }}
 */
export function load(source, shown, platform, opts = {}) {
  const prefix = opts.prefix ?? 'method/';
  /** @type {Map<string, Skill>} */
  const external = opts.external ?? new Map();
  if (!isDir(source)) throw new SourceError('source not found: ' + shown);
  /** @type {Map<string, Skill>} */
  const skills = new Map();
  /** @type {Map<string, Agent>} */
  const agents = new Map();
  /** @type {Map<string, Command>} */
  const commands = new Map();
  for (const file of glob(join(platform, source, 'skills'), '*/SKILL.md', platform)) {
    const name = basename(parentOf(file, platform), platform);
    const where = prefix + 'skills/' + name + '/SKILL.md';
    const { fields, body } = splitFrontMatter(readText(file), where);
    if (fields.get('name') !== name || !NAME_RE.test(name) || pyLen(name) > 64) {
      throw new SourceError(where + ': name must equal the directory name (lowercase, hyphens, 64 at most)');
    }
    knownFields(fields, 'skills', where);
    if (body.includes(HARNESS_TOKEN)) throw new SourceError(where + ': ' + HARNESS_TOKEN + ' is for command bodies only');
    skills.set(name, { description: need(fields, 'description', where), purpose: fields.get('purpose') ?? '', body, where });
  }
  for (const file of glob(join(platform, source, 'commands'), '*.md', platform)) {
    const name = stemOfMd(basename(file, platform));
    const where = prefix + 'commands/' + name + '.md';
    const { fields, body } = splitFrontMatter(readText(file), where);
    if (fields.get('name') !== name || !NAME_RE.test(name)) throw new SourceError(where + ': name must equal the file name');
    knownFields(fields, 'commands', where);
    commands.set(name, {
      description: need(fields, 'description', where), purpose: fields.get('purpose') ?? '',
      hint: fields.get('argument-hint') ?? '', body, where,
    });
  }
  for (const file of glob(join(platform, source, 'agents'), '*.md', platform)) {
    const name = stemOfMd(basename(file, platform));
    const where = prefix + 'agents/' + name + '.md';
    const { fields, body } = splitFrontMatter(readText(file), where);
    if (fields.get('name') !== name || !NAME_RE.test(name)) throw new SourceError(where + ': name must equal the file name');
    knownFields(fields, 'agents', where);
    const raw = fields.get('tools');
    // Absence inherits every tool of the parent in Claude Code, so a missing key is refused.
    if (raw === undefined) throw new SourceError(where + ': tools must be declared (an explicit [] for none)');
    if (body.includes(HARNESS_TOKEN)) throw new SourceError(where + ': ' + HARNESS_TOKEN + ' is for command bodies only');
    const tools = toolList(raw);
    for (const t of tools) {
      if (!TOOL_RE.test(t)) throw new SourceError(where + ': invalid tool name ' + repr(t));
      if (!Object.hasOwn(KIRO_TOOLS, t) && !t.startsWith('mcp__')) throw new SourceError(where + ': tool ' + t + ' has no Kiro mapping');
    }
    const excluded = toolList(fields.get('disallowed-tools') ?? []);
    for (const t of excluded) {
      // An exclusion narrows a granted MCP server to fewer of its tools: mcp__<server>__<tool>.
      const m = mcpTool(t);
      if (!m || !tools.includes('mcp__' + m[0])) {
        throw new SourceError(where + ': disallowed tool ' + repr(t) + ' must be mcp__<server>__<tool> of a granted server');
      }
    }
    const preload = fields.get('skills') ?? [];
    if (!Array.isArray(preload)) throw new SourceError(where + ': skills must be a list');
    for (const s of preload) if (!skills.has(s) && !external.has(s)) throw new SourceError(where + ': preloads unknown skill ' + s);
    agents.set(name, {
      description: need(fields, 'description', where), purpose: fields.get('purpose') ?? '',
      tools, excluded, skills: preload, body, where,
    });
  }
  const clash = [...skills.keys()].filter((s) => commands.has(s)).sort(cmpStr);
  if (clash.length) throw new SourceError('a skill and a command share a name: ' + clash.join(', '));
  if (opts.project) {
    // A project source renders agents and skills only (#576); commands stay user level.
    if (commands.size || isDir(join(platform, source, 'commands'))) throw new SourceError(prefix + 'commands/: the project target renders agents and skills only');
    if (!skills.size && !agents.size) throw new SourceError(prefix + ' must hold agents or skills');
    for (const group of [skills, agents]) {
      for (const item of group.values()) {
        if (item.body.includes(SCRIPTS_TOKEN)) throw new SourceError(item.where + ': ' + SCRIPTS_TOKEN + ' is for the user-level method only');
      }
    }
    return { skills, agents, commands };
  }
  if (!skills.size || !agents.size || !commands.size) throw new SourceError('method/ must hold agents, skills and commands');
  return { skills, agents, commands };
}

/** `[A-Za-z0-9_][A-Za-z0-9_-]*\/[A-Za-z0-9_][A-Za-z0-9_.-]*\.md` fullmatch. @param {string} name */
function documentName(name) {
  const parts = name.split('/');
  if (parts.length !== 2) return false;
  const [dir, file] = parts;
  if (!dir || !SEGMENT_HEAD.test(dir[0]) || !SEGMENT_REST.test(dir.slice(1))) return false;
  if (!file.endsWith('.md') || file.length < 4) return false;
  const stem = file.slice(0, -3);
  return SEGMENT_HEAD.test(stem[0]) && FILE_REST.test(stem.slice(1));
}

/**
 * name -> text for the Markdown documents one directory down: method/scripts/<dir>/<name>.md. Only the
 * ones a rendered body names are installed (targets). A document that is a symbolic link, or sits in a
 * directory that is one, is not loaded, so a body naming it stops the render.
 * @param {string} source @param {string} platform
 * @returns {Map<string, string>}
 */
export function loadDocuments(source, platform) {
  /** @type {Map<string, string>} */
  const documents = new Map();
  const base = join(platform, source, 'scripts');
  if (!isDir(base)) return documents;
  for (const file of glob(base, '*/*.md', platform)) {
    const name = file.slice(base.length + 1).replaceAll('\\', '/');
    if (isFile(file) && !isLink(file) && !isLink(parentOf(file, platform)) && documentName(name)) {
      documents.set(name, readText(file));
    }
  }
  return documents;
}

/**
 * Replace {{method-scripts}} with the installed directory; every name it prefixes must be a document in
 * method/scripts/<dir>/, which is then recorded in `used` so it is installed.
 * @param {string} text @param {string} where @param {string} directory
 * @param {Map<string, string>} documents @param {Set<string>} used
 */
export function resolveScripts(text, where, directory, documents, used) {
  for (const m of text.matchAll(TOKEN_REF_RE)) {
    const name = m[1];
    if (!documents.has(name)) throw new SourceError(where + ': ' + SCRIPTS_TOKEN + '/' + name + ' names no file in method/scripts/');
    used.add(name);
  }
  return text.replaceAll(SCRIPTS_TOKEN, directory);
}

// --------------------------------------------------------------------------------------------------
// Rendering. Every function returns the file text.

/** @param {string} where @param {string} stamp */
export const marker = (where, stamp) => MARKER_ID + '; source: ' + where + '; ' + stamp + '; do not edit, re-run the installer';

/** The document with the managed-by line as an HTML comment first (invisible when rendered). */
const documentFile = (/** @type {string} */ name, /** @type {string} */ text, /** @type {string} */ stamp) =>
  '<!-- ' + marker('method/scripts/' + name, stamp) + ' -->\n' + text;

/**
 * @param {string} name @param {string} description @param {Field} purpose @param {string} body
 * @param {string} where @param {string} stamp
 */
export function skillMd(name, description, purpose, body, where, stamp) {
  const n = pyLen(description);
  if (n > DESCRIPTION_MAX) throw new SourceError(where + ': description is ' + n + ' characters; the limit is ' + DESCRIPTION_MAX);
  const head = ['---', '# ' + marker(where, stamp), 'name: ' + q(name), 'description: ' + q(description)];
  if (purpose.length) head.push('metadata:', '  purpose: ' + q(purpose));
  return [...head, '---'].join('\n') + '\n' + body;
}

/** @param {string} invoke */
const commandPreface = (invoke) => '> **Owner-typed command `' + invoke + '`.** Run it only when the owner invokes it by name. Its arguments are the '
  + 'text he typed after the name; where this text says `$ARGUMENTS`, read that text.\n\n';

/** The command body for one agent harness. @param {string} body @param {string} harness */
export function forHarness(body, harness) {
  if (!HARNESSES.includes(harness)) throw new SourceError('unknown agent harness ' + repr(harness));
  return body.replaceAll(HARNESS_TOKEN, harness);
}

/** @param {Command} c @param {string} stamp @param {string} harness */
export function claudeCommand(c, stamp, harness) {
  const head = ['---', '# ' + marker(c.where, stamp), 'description: ' + q(c.description)];
  if (c.hint.length) head.push('argument-hint: ' + q(c.hint));
  return [...head, '---'].join('\n') + '\n' + forHarness(c.body, harness);
}

/** @param {string} s str.lstrip("\n") */
const lstripNl = (s) => s.replace(/^\n+/, '');

/** @param {Command} c @param {string} name @param {string} invoke @param {string} stamp @param {string} harness */
export function commandAsSkill(c, name, invoke, stamp, harness) {
  const description = 'Owner-typed command ' + invoke + '; run it only when the owner invokes it. ' + c.description;
  const body = forHarness(c.body, harness);
  return skillMd(name, description, c.purpose, '\n' + commandPreface(invoke) + lstripNl(body), c.where, stamp);
}

/** @param {string} where @param {string} stamp */
export const codexPolicy = (where, stamp) => '# ' + marker(where, stamp) + '\npolicy:\n  allow_implicit_invocation: false\n';

/** @param {Agent} a @param {string} name @param {string} stamp */
export function claudeAgent(a, name, stamp) {
  const head = ['---', '# ' + marker(a.where, stamp), 'name: ' + name, 'description: ' + q(a.description)];
  head.push('tools: ' + (a.tools.length ? a.tools.join(', ') : '[]'));
  if (a.excluded.length) head.push('disallowedTools: ' + a.excluded.join(', '));
  if (a.skills.length) head.push('skills:', ...a.skills.map((s) => '  - ' + s));
  return [...head, '---'].join('\n') + '\n' + a.body;
}

/** @param {string} name */
const codexRole = (name) => name.replaceAll('-', '_');

/** @param {Agent} a @param {string} name @param {string} stamp */
export function codexAgent(a, name, stamp) {
  const tools = a.tools.length ? a.tools.join(', ') : 'none';
  const preload = a.skills.length ? a.skills.map((s) => '$' + s).join(', ') : 'none';
  const readOnly = !a.tools.some((t) => WRITING_TOOLS.has(t));
  const excluded = a.excluded.length ? ' Excluded tools, even within a granted server: ' + a.excluded.join(', ') + '.' : '';
  const instructions = 'You are the `' + name + '` agent of the owner\'s working method (source: ' + a.where + ').\n\n'
    + 'Preloaded skills: ' + preload + '. In Claude Code and Kiro these are loaded into your context before you start. '
    + 'A Codex custom agent has no preload field, so load each of them by name before you act and follow it.\n\n'
    + 'Allowed tools for this agent: ' + tools + '.' + excluded + ' A Codex custom agent carries no tool list (ADR-0027): here this '
    + 'limit is an instruction, not a control. Do not use a tool outside it. Codex documents a per-agent '
    + '`mcp_servers` narrowing that this method does not render, so you inherit the parent session\'s MCP '
    + 'servers: use none that your tool list does not name.' + (readOnly ? ' This agent also runs in a read-only sandbox.' : '')
    + '\n\n---\n' + a.body;
  const lines = ['# ' + marker(a.where, stamp), 'name = ' + q(codexRole(name)), 'description = ' + q(a.description)];
  if (readOnly) lines.push('sandbox_mode = "read-only"');
  lines.push('developer_instructions = ' + q(instructions));
  const text = lines.join('\n') + '\n';
  // The original read the text back with tomllib (Python 3.11+); the vendored TOML parser does it here.
  const parsed = /** @type {Record<string, unknown>} */ (parseToml(text));
  if (parsed.developer_instructions !== instructions || parsed.name !== codexRole(name)) {
    throw new SourceError(a.where + ': the Codex TOML serialisation changed the text');
  }
  return text;
}

/** @param {string[]} tools */
function kiroTools(tools) {
  /** @type {string[]} */
  const out = [];
  for (const t of tools) {
    const tag = t.startsWith('mcp__') ? '@' + t.slice(5) : KIRO_TOOLS[t];
    if (!out.includes(tag)) out.push(tag);
  }
  return out;
}

/**
 * @param {Agent} a @param {string} name @param {string} stamp @param {string} kiroSkills @param {string} platform
 * @param {((skill: string) => string) | null} [resource] how a preloaded skill is referenced; the default is
 *   the user-level file:// URI of kiroSkills/<skill>/SKILL.md
 */
export function kiroAgent(a, name, stamp, kiroSkills, platform, resource = null) {
  /** @type {Map<string, unknown>} */
  const doc = new Map();
  doc.set('name', name);
  doc.set('description', a.description);
  doc.set('prompt', '<!-- ' + marker(a.where, stamp) + ' -->\n\n' + lstripNl(a.body));
  doc.set('tools', kiroTools(a.tools));
  doc.set('resources', a.skills.map((s) => (resource ? resource(s) : asUri(join(platform, kiroSkills, s, 'SKILL.md'), platform))));
  if (a.excluded.length) {
    // mcp__<server>__<tool> -> @<server>/<tool>; documented for Kiro IDE 1.x and CLI V3.
    doc.set('excludedTools', a.excluded.map((t) => {
      const m = /** @type {string[]} */ (mcpTool(t));
      return '@' + m[0] + '/' + m[1];
    }));
  }
  return dumps(doc, { indent: 2, sortKeys: false }) + '\n';
}

// --------------------------------------------------------------------------------------------------
// Targets.

/** @param {Ctx} ctx @returns {Homes} */
export function homes(ctx) {
  const { env, platform } = ctx;
  let raw = ctx.home || env.HOME || '';
  if (!raw) {
    // Path.home(): USERPROFILE on Windows; on POSIX HOME (an empty one is "/") or the password database.
    if (platform === 'win32') raw = env.USERPROFILE || (env.HOMEDRIVE || '') + (env.HOMEPATH || '') || os.homedir();
    else raw = env.HOME === undefined ? os.userInfo().homedir : '/';
  }
  const home = pyAbsolute(raw, ctx);
  const codex = pyAbsolute(env.CODEX_HOME || join(platform, home, '.codex'), ctx);
  const data = ctx.home ? join(platform, home, '.local', 'share') : pyAbsolute(env.XDG_DATA_HOME || join(platform, home, '.local', 'share'), ctx);
  return {
    claude: join(platform, home, '.claude'),
    codex,
    agents: join(platform, home, '.agents'),
    kiro: join(platform, home, '.kiro'),
    scripts: join(platform, data, 'personal-multi-harness-workstation-configuration', 'method', 'scripts'),
  };
}

/**
 * Every file the method renders.
 * @param {ReturnType<typeof load>} src @param {Map<string, string>} documents @param {string} stamp @param {Ctx} ctx
 * @returns {Target[]}
 */
export function targets(src, documents, stamp, ctx) {
  const { platform } = ctx;
  const h = homes(ctx);
  const kiroSkills = join(platform, h.kiro, 'skills');
  /** @type {Set<string>} */
  const used = new Set();
  for (const group of [src.skills, src.commands, src.agents]) {
    for (const item of group.values()) item.body = resolveScripts(item.body, item.where, h.scripts, documents, used);
  }
  /** @type {Target[]} */
  const out = [];
  for (const name of [...used].sort(cmpStr)) {
    out.push([join(platform, h.scripts, ...name.split('/')), documentFile(name, /** @type {string} */ (documents.get(name)), stamp), 'doc']);
  }
  for (const [name, s] of src.skills) {
    const text = skillMd(name, s.description, s.purpose, s.body, s.where, stamp);
    out.push(
      [join(platform, h.claude, 'skills', name, 'SKILL.md'), text, 'md'],
      [join(platform, h.agents, 'skills', name, 'SKILL.md'), text, 'md'],
      [join(platform, kiroSkills, name, 'SKILL.md'), text, 'md'],
    );
  }
  for (const [name, c] of src.commands) {
    out.push(
      [join(platform, h.claude, 'commands', name + '.md'), claudeCommand(c, stamp, 'claude-code'), 'md'],
      [join(platform, h.agents, 'skills', name, 'SKILL.md'), commandAsSkill(c, name, '$' + name, stamp, 'codex'), 'md'],
      [join(platform, h.agents, 'skills', name, 'agents', 'openai.yaml'), codexPolicy(c.where, stamp), 'md'],
      [join(platform, kiroSkills, name, 'SKILL.md'), commandAsSkill(c, name, '/' + name, stamp, 'kiro'), 'md'],
    );
  }
  for (const [name, a] of src.agents) {
    out.push(
      [join(platform, h.claude, 'agents', name + '.md'), claudeAgent(a, name, stamp), 'md'],
      [join(platform, h.codex, 'agents', name + '.toml'), codexAgent(a, name, stamp), 'md'],
      [join(platform, h.kiro, 'agents', name + '.json'), kiroAgent(a, name, stamp, kiroSkills, platform), 'json'],
    );
  }
  return out;
}

/**
 * Every file in the carriers' directories that could be one of ours (for STALE and uninstall). The
 * scripts directory is still read: a script an earlier version installed there is found and removed.
 * @param {Ctx} ctx
 */
export function candidateFiles(ctx) {
  const { platform } = ctx;
  const h = homes(ctx);
  /** @type {Array<[string, string]>} */
  const patterns = [
    [join(platform, h.claude, 'agents'), '*.md'], [join(platform, h.claude, 'commands'), '*.md'],
    [join(platform, h.claude, 'skills'), '*/SKILL.md'], [join(platform, h.agents, 'skills'), '*/SKILL.md'],
    [join(platform, h.agents, 'skills'), '*/agents/openai.yaml'], [join(platform, h.codex, 'agents'), '*.toml'],
    [join(platform, h.kiro, 'agents'), '*.json'], [join(platform, h.kiro, 'skills'), '*/SKILL.md'],
    [h.scripts, '*'], [h.scripts, '*/*.md'],
  ];
  /** @type {string[]} */
  const found = [];
  for (const [base, pattern] of patterns) {
    if (!isDir(base)) continue;
    for (const p of glob(base, pattern, platform)) if (isFile(p) && !isLink(p)) found.push(p);
  }
  return found;
}

// --------------------------------------------------------------------------------------------------
// The project target (#576): a consuming project's own agents and skills, from one source in the project,
// <project>/.mhw/method/{agents,skills}, in the same format as method/, rendered into the project carriers
// of all three agent harnesses. Loading was measured on each harness in a throwaway project (#576):
//     Claude Code  <project>/.claude/agents/<n>.md, <project>/.claude/skills/<n>/SKILL.md (listed, 2.1.330)
//     Codex        <project>/.codex/agents/<n>.toml, read ONLY in a trusted project (0.163.0), and
//                  <project>/.agents/skills/<n>/SKILL.md (model-visible, trusted or not)
//     Kiro         <project>/.kiro/agents/<n>.json (listed as Workspace, CLI 3.1.0) and
//                  <project>/.kiro/skills/<n>/SKILL.md (read from binary strings, not measured)
// A Kiro project agent references a preloaded skill by a skill:// path, never by the absolute user-level
// file:// URI the user carrier uses, so no home path lands in a tracked project file: a project skill as
// skill://.kiro/skills/<n>/SKILL.md (relative to the project), a user-level method skill as
// skill://~/.kiro/skills/<n>/SKILL.md. Whether Kiro resolves either form was not measured (it needs a
// logged-in session); the post-install canary settles it. Dispatch as a subagent is not measured on any
// harness. Commands stay user level. A project file carries "source: .mhw/method/..." in its managed-by
// line, so the user-level STALE and uninstall passes never treat it as theirs, and the reverse.

export const PROJECT_PREFIX = '.mhw/method/';
const PROJECT_TAG = 'source: ' + PROJECT_PREFIX;

/** @param {string} project @param {string} platform */
export function projectCarriers(project, platform) {
  return {
    claude: join(platform, project, '.claude'),
    codex: join(platform, project, '.codex'),
    agents: join(platform, project, '.agents'),
    kiro: join(platform, project, '.kiro'),
  };
}

/**
 * Every file the project target renders, each tagged with the project source tag.
 * @param {ReturnType<typeof load>} src the project source @param {Map<string, Skill>} userSkills
 * @param {string} stamp @param {string} project @param {string} platform
 * @returns {Target[]}
 */
export function projectTargets(src, userSkills, stamp, project, platform) {
  const c = projectCarriers(project, platform);
  /** @param {string} s */
  const resource = (s) => (src.skills.has(s) ? 'skill://.kiro/skills/' : 'skill://~/.kiro/skills/') + s + '/SKILL.md';
  /** @type {Target[]} */
  const out = [];
  for (const [name, s] of src.skills) {
    const text = skillMd(name, s.description, s.purpose, s.body, s.where, stamp);
    out.push(
      [join(platform, c.claude, 'skills', name, 'SKILL.md'), text, 'md', PROJECT_TAG],
      [join(platform, c.agents, 'skills', name, 'SKILL.md'), text, 'md', PROJECT_TAG],
      [join(platform, c.kiro, 'skills', name, 'SKILL.md'), text, 'md', PROJECT_TAG],
    );
  }
  for (const [name, a] of src.agents) {
    for (const s of a.skills) if (!src.skills.has(s) && !userSkills.has(s)) throw new SourceError(a.where + ': preloads unknown skill ' + s);
    out.push(
      [join(platform, c.claude, 'agents', name + '.md'), claudeAgent(a, name, stamp), 'md', PROJECT_TAG],
      [join(platform, c.codex, 'agents', name + '.toml'), codexAgent(a, name, stamp), 'md', PROJECT_TAG],
      [join(platform, c.kiro, 'agents', name + '.json'), kiroAgent(a, name, stamp, '', platform, resource), 'json', PROJECT_TAG],
    );
  }
  return out;
}

/** Every file in the project carriers that could be one of the project target's. @param {string} project @param {string} platform */
export function projectCandidates(project, platform) {
  const c = projectCarriers(project, platform);
  /** @type {Array<[string, string]>} */
  const patterns = [
    [join(platform, c.claude, 'agents'), '*.md'], [join(platform, c.claude, 'skills'), '*/SKILL.md'],
    [join(platform, c.agents, 'skills'), '*/SKILL.md'], [join(platform, c.codex, 'agents'), '*.toml'],
    [join(platform, c.kiro, 'agents'), '*.json'], [join(platform, c.kiro, 'skills'), '*/SKILL.md'],
  ];
  /** @type {string[]} */
  const found = [];
  for (const [base, pattern] of patterns) {
    if (!isDir(base)) continue;
    for (const p of glob(base, pattern, platform)) if (isFile(p) && !isLink(p) && ours(p, null, PROJECT_TAG)) found.push(p);
  }
  return found;
}

/**
 * Codex reads a project's .codex/agents only when the project is trusted (measured on 0.163.0, #576), and
 * says nothing when it is not. This reads the trust entry from ${CODEX_HOME:-~/.codex}/config.toml and
 * never writes it: trusting a project is the owner's act. It matches the project's path as given and its
 * real path, not a trusted parent directory (whether Codex lets a parent's trust cover it was not measured).
 * @param {string} project @param {Ctx} ctx
 * @returns {{ trusted: boolean, config: string, why: string }}
 */
export function codexTrust(project, ctx) {
  const config = join(ctx.platform, homes(ctx).codex, 'config.toml');
  let doc;
  try {
    doc = /** @type {Record<string, unknown>} */ (parseToml(readText(config)));
  } catch (e) {
    return { trusted: false, config, why: lexists(config) ? 'unreadable (' + /** @type {Error} */ (e).message.split('\n', 1)[0] + ')' : 'absent' };
  }
  const projects = isDict(doc.projects) ? /** @type {Record<string, unknown>} */ (doc.projects) : {};
  const names = new Set([project, real(project)]);
  for (const n of names) {
    const entry = projects[n];
    if (isDict(entry) && /** @type {Record<string, unknown>} */ (entry).trust_level === 'trusted') return { trusted: true, config, why: 'trusted' };
  }
  return { trusted: false, config, why: 'no trusted entry' };
}

// --------------------------------------------------------------------------------------------------
// Managed detection and stamp comparison.

/**
 * The first managed-by line of a file, or null. For JSON, the first line of its prompt.
 * @param {string} file @param {string | null} fmt
 */
export function markerLine(file, fmt) {
  let text;
  try {
    text = readText(file);
  } catch {
    return null;
  }
  if (fmt === 'json' || (fmt === null && file.endsWith('.json'))) {
    let doc;
    try {
      doc = loads(text);
    } catch {
      return null;
    }
    if (!isDict(doc)) return null;
    const prompt = Object.hasOwn(/** @type {object} */ (doc), 'prompt') ? /** @type {Record<string, unknown>} */ (doc).prompt : '';
    const first = typeof prompt === 'string' ? prompt.split('\n', 1)[0] : '';
    return first.includes(MARKER_ID) ? first : null;
  }
  for (const line of text.split('\n').slice(0, 5)) if (line.includes(MARKER_ID)) return line;
  return null;
}

/** @param {string} file @param {string | null} fmt @param {string} [tag] the source tag of the target's kind */
export function ours(file, fmt, tag = SOURCE_TAG) {
  const line = markerLine(file, fmt);
  return line !== null && line.includes(tag);
}

/** @param {string} text */
const unstamp = (text) => text.split('\n')
  .map((line) => (line.includes(MARKER_ID) ? line.replace(/; (?:version|release|commit): [^;"\\]*/g, '') : line))
  .join('\n');

/** @param {string | null} line */
function stampOf(line) {
  const m = /; (release: [^;"\\]*; commit: [^;"\\]*);/.exec(line || '');
  return m ? m[1] : 'none';
}

/** `source: (\S+);` searched: the first source a rendered text names. @param {string} text */
function sourceOf(text) {
  let at = text.indexOf('source: ');
  while (at >= 0) {
    const cps = Array.from(text.slice(at + 8));
    let n = 0;
    while (n < cps.length && notWs(cps[n])) n++;
    const run = cps.slice(0, n).join('');
    const semi = run.lastIndexOf(';');
    if (semi > 0) return run.slice(0, semi);
    at = text.indexOf('source: ', at + 1);
  }
  return '';
}

// --------------------------------------------------------------------------------------------------
// Modes.

/**
 * @param {{ status: number }} st @param {string} mode @param {Target} target @param {string} stamp
 * @param {(s: string) => void} say @param {(s: string) => void} warn @param {string} platform
 */
function processTarget(st, mode, [file, text, fmt, tag = SOURCE_TAG], stamp, say, warn, platform) {
  const link = isLink(file);
  const exists = fs.existsSync(file) || link;
  if (exists && (link || !ours(file, fmt, tag))) {
    warn('REFUSE  ' + file + ': exists and is NOT managed by this project\'s method step; move it aside or merge it by hand');
    st.status = Math.max(st.status, 3);
    return;
  }
  let restamp = false;
  if (exists) {
    const current = readText(file);
    if (current === text) {
      say('OK      ' + file + ' (' + stamp + ')');
      return;
    }
    if (unstamp(current) === unstamp(text)) restamp = true;
  }
  if (mode === 'check') {
    if (restamp) say('STAMP   ' + file + ': content matches, but it carries (' + stampOf(markerLine(file, fmt)) + ') and the source is (' + stamp + ')');
    else if (exists) say('DRIFT   ' + file + ' (' + stampOf(markerLine(file, fmt)) + ')');
    else say('MISSING ' + file);
    st.status = Math.max(st.status, 1);
  } else if (mode === 'dry-run') {
    say('WOULD WRITE ' + file + ' (' + Buffer.byteLength(text, 'utf8') + ' bytes, from ' + sourceOf(text) + ')');
  } else {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.new.' + process.pid;
    writeText(tmp, text, platform);
    fs.renameSync(tmp, file);
    say((restamp ? 'RESTAMPED' : 'WROTE  ') + ' ' + file + ' (' + stamp + ')');
  }
}

/** Remove empty directories from file's parent up to, not including, stop. @param {string} file @param {string} stop @param {string} platform */
function prune(file, stop, platform) {
  let d = parentOf(file, platform);
  while (key(d, platform) !== key(stop, platform) && isUnder(stop, d, platform)) {
    try {
      fs.rmdirSync(d);
    } catch {
      return;
    }
    d = parentOf(d, platform);
  }
}

/** @param {string} file @param {Ctx} ctx @param {string[] | null} [stops] the carrier roots to prune up to */
function remove(file, ctx, stops = null) {
  fs.unlinkSync(file);
  const h = homes(ctx);
  for (const stop of stops ?? [h.claude, h.codex, h.agents, h.kiro, h.scripts]) {
    if (isUnder(stop, file, ctx.platform)) {
      prune(file, stop, ctx.platform);
      return;
    }
  }
}

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, cwd?: string, platform?: string,
 *   out?: (s: string) => void, err?: (s: string) => void }} [opts]
 * @returns {number} the exit code
 */
export function run(argv, opts = {}) {
  /** @param {string} s */
  const say = (s) => (opts.out || ((x) => process.stdout.write(x)))(s + '\n');
  /** @param {string} s */
  const warn = (s) => (opts.err || ((x) => process.stderr.write(x)))(s + '\n');
  /** @type {Ctx} */
  const ctx = { env: opts.env || process.env, platform: opts.platform || process.platform, cwd: opts.cwd || process.cwd(), home: null };
  const { platform } = ctx;
  /** @type {string | null} */
  let mode = null;
  /** @type {string | null} */
  let stamp = null;
  let sourceArg = null;
  /** @type {string | null} */
  let projectArg = null;
  let optIn = false;
  for (const arg of argv) {
    if (arg.startsWith('--mode=')) mode = arg.slice(7);
    else if (arg.startsWith('--stamp=')) stamp = arg.slice(8);
    else if (arg.startsWith('--source=')) sourceArg = arg.slice(9);
    else if (arg.startsWith('--home=')) ctx.home = arg.slice(7);
    else if (arg.startsWith('--project=')) projectArg = arg.slice(10);
    else if (arg === '--opt-in') optIn = true;
    else {
      warn('method_render: unknown argument ' + arg);
      return 2;
    }
  }
  if (mode === null || !MODES.has(mode)) {
    warn('method_render: --mode must be install, check, dry-run or uninstall');
    return 2;
  }
  /** @type {string | null} */
  let project = null;
  if (projectArg !== null) {
    project = pyAbsolute(projectArg, ctx);
    if (!projectArg || !isDir(project)) {
      warn('method_render: --project must name an existing directory');
      return 2;
    }
    const h = homes(ctx);
    const pk = key(project, platform);
    if ([h.claude, h.codex, h.agents, h.kiro].some((d) => key(parentOf(d, platform), platform) === pk)) {
      warn('method_render: --project must not be the home directory: its carriers are the user-level ones');
      return 2;
    }
  }
  const st = { status: 0 };
  if (mode === 'uninstall' && project !== null) {
    const stops = Object.values(projectCarriers(project, platform));
    for (const file of projectCandidates(project, platform)) {
      remove(file, ctx, stops);
      say('REMOVED ' + file);
    }
  }
  if (mode === 'uninstall') {
    for (const file of candidateFiles(ctx)) {
      if (ours(file, null)) {
        remove(file, ctx);
        say('REMOVED ' + file);
      }
    }
    return st.status;
  }
  if (!optIn && !candidateFiles(ctx).some((p) => ours(p, null))) {
    // Off by default until the plugin cutover (#63, #64): with the plugin enabled, every agent, skill
    // and command would appear twice, and the plugin's still-running hooks refuse the bare-named
    // agents. Once installed by opt-in, later runs keep the files current; uninstall removes them.
    say('METHOD  not installed (opt-in: ' + (ctx.env.MHW_CMD || './mhw') + ' install --method; '
      + 'off by default until the plugin cutover, #63 #64)');
    return 0;
  }
  if (!stamp || !stampShape(stamp)) {
    warn('method_render: --stamp must be \'release: R; commit: C\' as install.sh derives it');
    return 2;
  }
  const shown = sourceArg === null ? DEFAULT_SOURCE : pyPath(sourceArg, platform);
  const source = sourceArg === null ? DEFAULT_SOURCE : path.resolve(ctx.cwd, sourceArg);
  /** @type {Target[]} */
  let wanted;
  /** @type {Target[]} */
  let projectWanted = [];
  const counts = { agents: 0, skills: 0, commands: 0 };
  const projectCounts = { agents: 0, skills: 0 };
  try {
    const src = load(source, shown, platform);
    Object.assign(counts, { agents: src.agents.size, skills: src.skills.size, commands: src.commands.size });
    if (project !== null) {
      // Loaded before anything is written, so a bad project source writes nothing at either level.
      const psrc = load(join(platform, project, ...PROJECT_PREFIX.slice(0, -1).split('/')), PROJECT_PREFIX.slice(0, -1), platform,
        { prefix: PROJECT_PREFIX, external: src.skills, project: true });
      Object.assign(projectCounts, { agents: psrc.agents.size, skills: psrc.skills.size });
      projectWanted = projectTargets(psrc, src.skills, stamp, project, platform);
    }
    wanted = targets(src, loadDocuments(source, platform), stamp, ctx);
  } catch (e) {
    if (!(e instanceof SourceError)) throw e;
    warn('REFUSE  the working method: ' + e.message + '; nothing of it was written');
    return 2;
  }
  // The order a moved agent needs (#576): the project copies are in place, and the project's own stale
  // files gone, before any user-level copy is removed. A refused project file holds every user-level removal.
  let holdRemovals = false;
  if (project !== null) {
    const pst = { status: 0 };
    for (const t of projectWanted) processTarget(pst, mode, t, stamp, say, warn, platform);
    const pkeep = new Set(projectWanted.map((t) => key(t[0], platform)));
    const stops = Object.values(projectCarriers(project, platform));
    for (const file of projectCandidates(project, platform)) {
      if (pkeep.has(key(file, platform))) continue;
      if (mode === 'check') {
        say('STALE   ' + file + ': rendered by an earlier project source; install removes it');
        pst.status = Math.max(pst.status, 1);
      } else if (mode === 'dry-run') {
        say('WOULD REMOVE ' + file + ' (no longer in ' + PROJECT_PREFIX + ')');
      } else {
        remove(file, ctx, stops);
        say('REMOVED ' + file + ' (no longer in ' + PROJECT_PREFIX + ')');
      }
    }
    holdRemovals = pst.status >= 3;
    st.status = Math.max(st.status, pst.status);
    if (projectCounts.agents) {
      const t = codexTrust(project, ctx);
      if (t.trusted) say('CODEX   ' + project + ' is trusted in ' + t.config + ': Codex reads its project agents');
      else {
        say('UNTRUSTED ' + project + ' is not trusted by Codex (' + t.config + ': ' + t.why + '): Codex skips its '
          + '.codex/agents without a word, while its .agents/skills still load. The owner trusts it: open codex in it and '
          + 'accept, or add [projects."' + project + '"] trust_level = "trusted" to that file');
      }
    }
  }
  for (const t of wanted) processTarget(st, mode, t, stamp, say, warn, platform);
  const keep = new Set(wanted.map((t) => key(t[0], platform)));
  for (const file of candidateFiles(ctx)) {
    if (keep.has(key(file, platform)) || !ours(file, null)) continue;
    if (holdRemovals && mode !== 'check' && mode !== 'dry-run') {
      say('HELD    ' + file + ': a project file was refused, so this user-level copy stays until the project copy is in place');
      continue;
    }
    if (mode === 'check') {
      say('STALE   ' + file + ': rendered by an earlier method; install removes it');
      st.status = Math.max(st.status, 1);
    } else if (mode === 'dry-run') {
      say('WOULD REMOVE ' + file + ' (no longer in method/)');
    } else {
      remove(file, ctx);
      say('REMOVED ' + file + ' (no longer in method/)');
    }
  }
  say('METHOD  installed: ' + counts.agents + ' agents, ' + counts.skills + ' skills, ' + counts.commands + ' commands from method/ into '
    + 'Claude Code (agents, skills, commands), '
    + 'Codex (custom agents without a tool list, skills; commands as skills with implicit invocation off) '
    + 'and Kiro (agents, skills; commands as skills); the documents its rites name in ' + homes(ctx).scripts
    + ' (no scripts: the rites run mhw commands)');
  if (project !== null) {
    say('PROJECT installed: ' + projectCounts.agents + ' agents, ' + projectCounts.skills + ' skills from ' + PROJECT_PREFIX + ' into '
      + project + ' (.claude, .codex and .agents, .kiro); commands stay user level');
  }
  return st.status;
}

/** `release: [^;"\\]+; commit: [^;"\\\s]+` fullmatch (\s: Python's whitespace). @param {string} stamp */
function stampShape(stamp) {
  const m = /^release: ([^;"\\]+); commit: ([^;"\\]+)$/.exec(stamp);
  return m !== null && Array.from(m[2]).every(notWs);
}

/** @param {string} p */
const real = (p) => {
  try {
    return fs.realpathSync(p);
  } catch {
    return path.resolve(p);
  }
};
if (process.argv[1] && real(process.argv[1]) === real(fileURLToPath(import.meta.url))) {
  process.exitCode = run(process.argv.slice(2));
}
