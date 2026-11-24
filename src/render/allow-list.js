// The allow-list rendering step (Issue #83, ADR-0031), the Node form of the deleted global/allow-list.sh
// (#490, S19 of #470). install.sh used to source the shell file and let it read its own variables; this
// program receives every value on its command line, and a missing or empty value never widens anything:
//
//   node src/render/allow-list.js --phase=parse     --source=F [--overlay=D] --floor-codex=F
//   node src/render/allow-list.js --phase=step      --mode=install|check|dry-run --stamp=S --source=F
//        [--overlay=D] --retired=F --floor-codex=F [--floor-claude=F] [--managed-root=D] --settings=F
//        --home=D [--codex-home=D] --repo-root=D [--cmd=TEXT]
//   node src/render/allow-list.js --phase=uninstall --settings=F --home=D [--codex-home=D]
//
// --gh-api=FILE (step only; mhw install-user passes global/gh-api.conf whenever it is there) also renders
// the baseline's gh api rule set (read by src/render/gh-api.js, Issue #593, ADR-0048) into every tier, and retires
// the hand-kept deny it names ("Bash(gh api:*)") from settings.json with a backup. Without it neither
// happens; a FILE that is missing or holds an invalid entry refuses the step (exit 2) before anything is
// written. Uninstall restores a retired deny from the backup whenever the backup is there.
//
// The tier inputs are --managed-root (the admin layer's root; install.sh passes "/" on a real machine),
// --floor-claude and --floor-codex (the validated deny floor). With any of them missing, empty, or naming
// a file that is missing or holds no entry, the harness it decides stays NARROW, and one RISK line says so.
// Every other required value missing refuses the run (exit 2) before anything is read or written.
//
// One source (allow-list.conf, plus <overlay>/allow-list.conf when present) is rendered natively at USER
// level: Claude Code permissions.allow and permissions.defaultMode, a Codex rules file of allow prefix
// rules and a profile file ($CODEX_HOME/workstation.config.toml, used with codex --profile workstation;
// Codex 0.160.0 refuses a [profiles.*] table in config.toml as legacy), and a Kiro agent file. The WIDE
// tier is rendered for a harness only while the admin deny floor is complete for it; otherwise NARROW.
// Nothing here writes the admin layer, and deny always beats allow (ADR-0031).
//
// Same output lines, exit codes and files as the shell form, byte for byte; test/golden/S19 holds the
// transcripts recorded from it, and test/golden/S19/expected-differences.json names what differs and why.
// node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MARKER_ID, isManaged, unstamp, stampOfLine } from '../lib/marker.js';
import { keyOptions } from '../lib/key-options.js';
import { privateCopy } from '../lib/private-copy.js';
import { parse as parseJson, classify, stringify, equal, contains, alt, get, codepointCompare } from '../lib/jq-json.js';
import { unifiedHunks } from '../lib/unified-diff.js';
import * as ghApi from './gh-api.js';

/** @typedef {import('../lib/jq-json.js').JqValue} JqValue */
/** @typedef {Map<string, JqValue>} JqObject */
/** @typedef {'narrow' | 'wide'} Tier */
/** @typedef {'cmd' | 'runner' | 'route' | 'deny'} Kind */
/** @typedef {import('./gh-api.js').Rules} GhRules */
/** @typedef {Record<Tier, Record<Kind, string[]>>} Parsed */
/**
 * @typedef {{ out: (s: string | Buffer) => void, err: (s: string | Buffer) => void, platform: string,
 *   status: number, opts: Record<string, string>, gh?: GhRules }} Ctx
 */

export const ALLOW_OWN_KEY = 'personal-multi-harness-workstation-configuration-owned-allow';
export const ALLOW_PROFILE = 'workstation';
const PROG = 'allow-list.js';
const KINDS = new Set(['cmd', 'runner', 'route', 'deny']);

// A shell, an interpreter or a dispatcher runs anything it is handed: an allow on one is an allow on
// everything, and an agent able to edit this list would grant itself the world.
const RUNS_ANYTHING = new Set(['bash', 'sh', 'dash', 'zsh', 'ksh', 'mksh', 'fish', 'csh', 'tcsh', 'busybox', 'env',
  'xargs', 'eval', 'exec', 'source', 'command', 'builtin', 'nohup', 'time', 'nice', 'timeout', 'watch', 'script',
  'sudo', 'doas', 'su', 'node', 'nodejs', 'deno', 'bun', 'ruby', 'irb', 'php', 'lua', 'tclsh', 'osascript', 'awk',
  'gawk', 'nawk', 'find', 'make', 'npm', 'npx', 'pnpm', 'yarn', 'pytest', 'cargo', 'go']);
// The families with a version suffix: python[0-9.]*, pypy[0-9.]*, perl[0-9.]*.
const VERSIONED = ['python', 'pypy', 'perl'];
// Never in any tier: each runs, publishes or writes through its own options or arguments.
const NEVER = ['git worktree add', 'git config', 'git archive', 'git format-patch', 'git am', 'git apply', 'git pull',
  'gh issue comment', 'gh issue create', 'gh issue edit', 'gh pr comment', 'gh pr create', 'gh pr edit',
  'gh pr review', 'gh gist', 'gh api', 'gh extension', 'gh alias'];
// The read and build routes are the WIDE tier only (owner, 2026-10-05): the narrow tier stays read-only.
const WIDE_ONLY = ['git diff', 'git log', 'git show', 'git grep', 'git blame', 'git ls-files', 'git branch',
  'git fetch', 'git add', 'git commit'];

/** @param {string} s @param {RegExp} re */
const all = (s, re) => s.length > 0 && [...s].every((c) => re.test(c));
const WORD_CHAR = /[A-Za-z0-9._~=:@+-]/;
const SEG_FIRST = /[A-Za-z0-9_-]/;
const SEG_REST = /[A-Za-z0-9._-]/;

/** awk's default field splitting: runs of blanks (space, tab), leading and trailing ignored. @param {string} s */
export function fields(s) {
  return s.split(/[ \t]+/).filter((f) => f.length > 0);
}

/** 1 when word list a is a word prefix of word list b (allow-list.sh's prefix()). @param {string} a @param {string} b */
export function prefix(a, b) {
  const x = fields(a);
  const y = fields(b);
  if (x.length > y.length) return false;
  return x.every((w, k) => w === y[k]);
}

/** The first member of list that is a word prefix of w, or ''. @param {string[]} list @param {string} w */
function listed(list, w) {
  return list.find((e) => prefix(e, w)) ?? '';
}

/** A program that runs whatever it is handed. @param {string} p */
function runsAnything(p) {
  if (RUNS_ANYTHING.has(p)) return true;
  return VERSIONED.some((v) => p.startsWith(v) && all(p.slice(v.length) || '0', /[0-9.]/));
}

/** One relative .sh or .py script path, no '..' segment. @param {string} p */
function runnerPath(p) {
  const segs = p.split('/');
  const last = segs.at(-1) || '';
  if (!last.endsWith('.sh') && !last.endsWith('.py')) return false;
  const ok = (/** @type {string} */ s) => s.length > 0 && SEG_FIRST.test(s[0]) && all(s.slice(1) || '-', SEG_REST);
  if (!segs.slice(0, -1).every(ok) || !ok(last.slice(0, -3))) return false;
  return !segs.includes('..');
}

/**
 * Why one allow-list line is refused, or '' (allow-list.sh's awk, check by check, in its order).
 * @param {string[]} f the line's fields
 * @param {string[]} floor the floor's word lists
 */
export function why(f, floor) {
  const w = f.slice(2).join(' ');
  // Each check runs only while every earlier one passed, in the shell's order.
  const checks = [
    () => shapeWhy(f),
    () => kindWhy(f, w),
    // A leading VAR=value runs the command with that environment: GIT_CONFIG_PARAMETERS=... git log is
    // "git -c", GIT_PAGER=... runs any program (Issue #65, lens finding on PR #100).
    () => (envAssignment(f[2] ?? '') ? '"' + f[2] + '" is an environment assignment before the command; it can run any program' : ''),
    () => repoWhy(f),
    () => (f[1] === 'cmd' ? cmdWhy(f, w) : ''),
    () => (f[1] === 'deny' ? '' : floorWhy(w, floor)),
  ];
  for (const check of checks) {
    const reason = check();
    if (reason) return reason;
  }
  return '';
}

/** The tier, the kind and at least one word. @param {string[]} f */
function shapeWhy(f) {
  if (f[0] !== 'narrow' && f[0] !== 'wide') return 'tier must be narrow or wide';
  if (!KINDS.has(f[1])) return 'kind must be cmd, runner, route or deny';
  return f.length < 3 ? 'no words' : '';
}

/** The route and runner rules, or the word set of every other kind. @param {string[]} f @param {string} w */
function kindWhy(f, w) {
  if (f[1] === 'route') {
    // A route names ONE reviewed, read-only subcommand of the mhw CLI, by its words (Issue #475; it
    // replaced the "script" kind of #242 when the milestone routes moved to Node). Wide tier only,
    // Claude Code only. The set is closed and written here: every other mhw subcommand installs,
    // removes or writes, and stays never pre-authorised.
    // Since #593 `mhw milestone` is gone (ADR-0048) and global/allow-list.conf carries no route. The one
    // member is still accepted so the S19 parity inputs, recorded from the deleted shell step, parse as
    // they did; such an entry now pre-authorises an unknown subcommand (exit 2). test/render/gh-api.test.js
    // holds that the repository list has no route.
    if (f[0] !== 'wide') return 'a route runs installed code, so it belongs to the wide tier only';
    return w === 'mhw milestone read' ? '' : 'a route names a reviewed read-only mhw subcommand, and the only one is "mhw milestone read"';
  }
  if (f[1] === 'runner') return runnerWhy(f);
  return f.slice(2).every((x) => all(x, WORD_CHAR)) ? '' : 'word outside the allowed set (no path, no wildcard)';
}

/**
 * A runner names ONE repository script, by relative path, through sh, bash or python3, with no option
 * but -B or -I: an exact suite, never the interpreter (ADR-0031, owner 2026-10-05).
 * @param {string[]} f
 */
function runnerWhy(f) {
  if (f[0] !== 'wide') return 'a runner runs repository code, so it belongs to the wide tier only';
  if (!['sh', 'bash', 'python3'].includes(f[2])) return 'a runner starts with sh, bash or python3';
  if (!runnerPath(f.at(-1) ?? '')) return 'a runner ends with one relative .sh or .py script path';
  return f.slice(3, -1).every((x) => x === '-B' || x === '-I') ? '' : 'a runner takes no option but -B or -I';
}

/**
 * -R/--repo, in any position and any spelling, retargets gh at any repository and widens the prefix past
 * every per-subcommand pin: "gh pr -R o/r merge" (Issue #65, lens finding on PR #100).
 * @param {string[]} f
 */
function repoWhy(f) {
  const x = f.slice(2).find((y) => y.startsWith('-R') || y === '--repo' || y.startsWith('--repo='));
  return x === undefined ? '' : '"' + x + '" (-R/--repo) retargets the command at another repository and reaches every subcommand';
}

/** A line that covers a floor entry, or that a floor entry covers. @param {string} w @param {string[]} floor */
function floorWhy(w, floor) {
  for (const fl of floor) {
    if (prefix(w, fl)) return 'it covers the floor entry "' + fl + '", which denies only part of that family';
    if (prefix(fl, w)) return 'the floor entry "' + fl + '" denies it, so it could never apply';
  }
  return '';
}

/** @param {string} s */
function envAssignment(s) {
  const eq = s.indexOf('=');
  if (eq < 1) return false;
  const name = s.slice(0, eq);
  return /[A-Za-z_]/.test(name[0]) && all(name, /\w/);
}

/** The cmd kind's own checks. @param {string[]} f @param {string} w */
function cmdWhy(f, w) {
  const p = f[2];
  if (runsAnything(p)) {
    return 'the program "' + p + '" runs whatever it is given (a shell, an interpreter, a dispatcher or a project-code runner)';
  }
  // The workstation command itself, on PATH after an npm install (Issue #68): it installs and removes
  // the configuration this list is part of (ADR-0031: never pre-authorised, like ./mhw).
  if (p === 'mhw' || p === 'workstation') return 'the program "' + p + '" installs or removes this configuration; it is never pre-authorised';
  // An option before the subcommand reaches every subcommand, and "git -c" sets core.pager,
  // core.sshCommand or an alias that runs any program: the second word must be a subcommand.
  if ((p === 'git' || p === 'gh') && f.length >= 4 && f[3].startsWith('-')) {
    return '"' + p + ' ' + f[3] + '" is an option before the subcommand: it reaches every subcommand (and "git -c" can run any program)';
  }
  let e = listed(NEVER, w);
  if (e) return '"' + e + '" takes an option or argument that reads or writes any path, runs a program or publishes';
  e = f[0] === 'narrow' ? listed(WIDE_ONLY, w) : '';
  if (e) return '"' + e + '" has options that read or write any path, so it is wide-tier only';
  // Pinned natively: "git add --" ends option parsing; "git commit -m" makes git refuse -F/--file.
  if (prefix('git add', w) && w !== 'git add --') return 'git add is pre-authorised only as "git add --"';
  if (prefix('git commit', w) && w !== 'git commit -m') return 'git commit is pre-authorised only as "git commit -m"';
  return '';
}

/** Lines as awk reads them: split on newline, a final unterminated line kept. @param {string} text */
export function records(text) {
  const l = text.split('\n');
  if (l.at(-1) === '') l.pop();
  return l;
}

/**
 * Parse and validate the concatenated source. Errors are the lines allow-list.sh printed.
 * @param {string} conf the source text, latin1-decoded
 * @param {string[]} floor
 * @returns {{ parsed: Parsed, errors: string[] }}
 */
export function parseList(conf, floor) {
  /** @type {Parsed} */
  const parsed = { narrow: { cmd: [], runner: [], route: [], deny: [] }, wide: { cmd: [], runner: [], route: [], deny: [] } };
  const errors = [];
  let n = 0;
  for (let line of records(conf)) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const lead = line.replace(/^[ \t]*/, '');
    if (lead === '' || lead.startsWith('#')) continue;
    const f = fields(line);
    const reason = why(f, floor);
    if (reason) {
      errors.push('invalid allow-list entry (' + reason + '): ' + line + '\n');
      continue;
    }
    parsed[/** @type {Tier} */ (f[0])][/** @type {Kind} */ (f[1])].push(f.slice(2).join(' '));
    if (f[1] !== 'deny') n++;
  }
  if (!errors.length && !n) errors.push('the allow list has no entry\n');
  return { parsed, errors };
}

/** The word lists rendered for a tier (narrow always included). @param {Parsed} p @param {Tier} tier @param {Kind[]} kinds */
export function words(p, tier, kinds) {
  const out = [];
  for (const k of kinds) {
    out.push(...p.narrow[k]);
    if (tier === 'wide') out.push(...p.wide[k]);
  }
  return out;
}

/** @param {string} file */
function isFile(file) {
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/** [ -e ] (follows links). @param {string} file */
function exists(file) {
  try {
    fs.statSync(file);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} file */
function lexists(file) {
  try {
    fs.lstatSync(file);
    return true;
  } catch {
    return false;
  }
}

/** The text of a file, or null when it cannot be read. @param {string} file @param {BufferEncoding} [enc] */
function readOrNull(file, enc = 'utf8') {
  try {
    return fs.readFileSync(file, enc);
  } catch {
    return null;
  }
}

/** is_managed: one of the first five lines carries the marker. @param {string} file */
function managed(file) {
  const t = readOrNull(file, 'latin1');
  return t !== null && isManaged(t);
}

/** The source, then the overlay's: the text allow-list.sh's `cat` built, or null when the source is missing. @param {Ctx} ctx */
function source(ctx) {
  const src = ctx.opts['--source'];
  if (!isFile(src)) {
    ctx.err('source not found: ' + src + '\n');
    return null;
  }
  let text = readOrNull(src, 'latin1') ?? '';
  const ov = ctx.opts['--overlay'] || '';
  if (ov && isFile(ov + '/allow-list.conf')) text += readOrNull(ov + '/allow-list.conf', 'latin1') ?? '';
  return text;
}

/** The floor's word lists, one per line. @param {string} text */
function floorLines(text) {
  return records(text);
}

/**
 * Parse the source against the floor. Returns the parsed list, or null after printing why (exit 2).
 * @param {Ctx} ctx
 * @returns {Parsed | null}
 */
function parseStep(ctx) {
  const floorFile = ctx.opts['--floor-codex'];
  const floorText = readOrNull(floorFile, 'latin1');
  if (floorText === null) {
    ctx.err('floor not found: ' + floorFile + '\n');
    return null;
  }
  const text = source(ctx);
  if (text === null) return null;
  const { parsed, errors } = parseList(text, floorLines(floorText));
  if (errors.length) {
    for (const e of errors) ctx.err(Buffer.from(e, 'latin1'));
    return null;
  }
  return parsed;
}

// ---- The admin floor ---------------------------------------------------------------------------------

/** @param {string} root @param {string} platform */
export function adminPaths(root, platform) {
  const r = root.endsWith('/') ? root.slice(0, -1) : root;
  const claude = platform === 'darwin'
    ? r + '/Library/Application Support/ClaudeCode/managed-settings.d/50-personal-multi-harness-workstation-configuration.json'
    : r + '/etc/claude-code/managed-settings.d/50-personal-multi-harness-workstation-configuration.json';
  return { claude, codex: r + '/etc/codex/requirements.toml' };
}

/**
 * The word lists of the Codex admin requirements' forbidden prefix rules (allow-list.sh's two seds).
 * @param {string} text
 */
export function codexAdminWords(text) {
  const out = [];
  const head = /^ *\{ pattern = \[/;
  const tail = '], decision = "forbidden"';
  for (const line of records(text)) {
    const m = head.exec(line);
    if (!m) continue;
    const end = line.lastIndexOf(tail);
    if (end < m[0].length) continue;
    out.push(line.slice(m[0].length, end).replaceAll(/\{ token = "([^"]*)" \}/g, '$1').replaceAll(', ', ' '));
  }
  return out;
}

/**
 * Is the admin deny floor complete for each harness? Any tier input missing, empty or unreadable is narrow.
 * @param {Ctx} ctx
 * @returns {{ claude: Tier, codex: Tier }}
 */
export function adminState(ctx) {
  const root = ctx.opts['--managed-root'] || '';
  if (!root) return { claude: 'narrow', codex: 'narrow' };
  const a = adminPaths(root, ctx.platform);
  return {
    claude: claudeComplete(a.claude, tierInput(ctx, '--floor-claude')) ? 'wide' : 'narrow',
    codex: codexComplete(a.codex, tierInput(ctx, '--floor-codex')) ? 'wide' : 'narrow',
  };
}

/** A tier input file's text: '' when the option is missing or empty, or the file cannot be read. @param {Ctx} ctx @param {string} key */
function tierInput(ctx, key) {
  const file = ctx.opts[key] || '';
  return (file && readOrNull(file)) || '';
}

/** Does the Claude Code admin file deny every rule of the floor? @param {string} file @param {string} floorText */
function claudeComplete(file, floorText) {
  const want = [...new Set(records(floorText).filter((l) => l.length > 0))];
  if (!want.length || !isFile(file)) return false;
  let deny;
  try {
    const perms = get(parseJson(fs.readFileSync(file, 'utf8')), 'permissions');
    deny = alt(perms instanceof Map ? get(perms, 'deny') : null, []);
  } catch {
    return false;
  }
  if (!Array.isArray(deny)) return false;
  // Wide only where the shell read wide (its jq count equals the floor's size) AND every floor rule is
  // there as a string, so this never reads wide where the shell read narrow (PR #519 QA B2).
  const strings = new Set(deny.filter((r) => typeof r === 'string' && want.includes(r)));
  // The shell's $floor came through jq's unique, which sorts by code point: its subarray index ran over
  // that order, not the file's (PR #519 lens, round 3).
  return strings.size === want.length && shellCount([...want].sort(codepointCompare), deny) === want.length;
}

/**
 * allow-list.sh's count: the distinct deny elements e for which jq's `$floor | index(e)` is not null, floor
 * being the list as jq's unique left it (deduplicated, sorted by code point; the caller passes it so). A
 * string matches a floor rule equal to it; a non-empty array of strings matches where it is a contiguous
 * run of the floor list (jq's subarray index), so it counts too; anything else matches nothing.
 * @param {string[]} floor @param {JqValue[]} deny
 */
export function shellCount(floor, deny) {
  /** @param {JqValue} e */
  const matches = (e) => {
    if (typeof e === 'string') return floor.includes(e);
    if (!Array.isArray(e) || !e.length || !e.every((x) => typeof x === 'string')) return false;
    for (let k = 0; k + e.length <= floor.length; k++) if (e.every((x, j) => floor[k + j] === x)) return true;
    return false;
  };
  const seen = new Set(deny.filter(matches).map((e) => stringify(e, { indent: 0, sortKeys: true })));
  return seen.size;
}

/**
 * Does the Codex admin requirements file forbid every floor entry? The shell's count (grep -cxF -f floor
 * against grep -c .) and every floor entry present: wide only when both hold, so this never reads wide
 * where the shell read narrow.
 * @param {string} file @param {string} floorText
 */
function codexComplete(file, floorText) {
  const patterns = records(floorText);
  const entries = patterns.filter((l) => l.length > 0);
  if (!entries.length || !isFile(file) || !managed(file)) return false;
  const admin = codexAdminWords(readOrNull(file) ?? '');
  return admin.filter((l) => patterns.includes(l)).length === entries.length && entries.every((l) => admin.includes(l));
}

// ---- Claude Code -------------------------------------------------------------------------------------

/** Is the installer running from an npm install of the package? Returns its real path, or null. @param {string} repoRoot */
export function npmPackage(repoRoot) {
  let dir;
  try {
    dir = fs.realpathSync(repoRoot);
  } catch {
    return null;
  }
  if (!isFile(dir + '/package.json') || lexists(dir + '/.git')) return null;
  return path.posix.basename(path.posix.dirname(dir)) === 'node_modules' ? dir : null;
}

/**
 * The files that decide what is pre-authorised: an Edit deny for each, in every tier, so an agent cannot
 * widen its own list with an edit (Claude Code only). "//" is Claude Code's absolute-path form, "~/" its
 * home form.
 * @param {Ctx} ctx
 */
export function protect(ctx) {
  const home = ctx.opts['--home'];
  const codexDir = ctx.opts['--codex-home'] || home + '/.codex';
  const codexRule = codexDir.startsWith(home + '/') ? '~/' + codexDir.slice(home.length + 1) : '/' + codexDir;
  const repo = ctx.opts['--repo-root'];
  const rules = ['~/.claude/settings.json', codexRule + '/rules/**', codexRule + '/config.toml', codexRule + '/*.config.toml',
    '~/.kiro/agents/**', '/' + repo + '/global/allow-list.conf', '/' + repo + '/overlay/**', '**/.git/config', '**/.git/hooks/**'];
  // The installed npm package, in every tier (Issue #475, owner ruling 2026-11-19 on PR #509): its src/
  // is the code a route ran without a prompt. No route is left since #593; the deny stays, since the
  // package also renders this list. Never from a checkout.
  const pkg = npmPackage(repo);
  if (pkg) rules.push('/' + pkg + '/**');
  // The gh api rule set's source (#593, ADR-0048): taking a deny-method line out of it weakens the set.
  if (ctx.opts['--gh-api']) rules.push('/' + path.resolve(ctx.opts['--gh-api']));
  return rules.map((r) => 'Edit(' + r + ')');
}

/** @param {JqValue | undefined} v */
function asList(v) {
  if (Array.isArray(v)) return v;
  if (v === null || v === false || v === undefined) return [];
  throw new Error('unexpected shape');
}

/** The shape allow_claude_render refused. @param {JqObject} doc @param {JqValue} perms */
function badShape(doc, perms) {
  if (perms === null) return get(doc, 'hooks') !== null && !(get(doc, 'hooks') instanceof Map);
  if (!(perms instanceof Map)) return true;
  const notList = (/** @type {JqValue} */ v) => v !== null && !Array.isArray(v);
  return notList(get(perms, 'allow')) || notList(get(perms, 'deny')) || (get(doc, 'hooks') !== null && !(get(doc, 'hooks') instanceof Map));
}

/**
 * One list merged with what the ownership record holds: a rule we added and no longer want leaves, a
 * wanted rule missing is appended. Returns the list and the record's new list.
 * @param {JqValue[]} list @param {JqValue[]} prev @param {string[]} want
 */
function mergeOwned(list, prev, want) {
  const kept = list.filter((r) => !(contains(prev, r) && !contains(want, r)));
  const add = want.filter((r) => !contains(kept, r));
  return { list: [...kept, ...add], owns: [...prev.filter((r) => contains(want, r)), ...add] };
}

/** key = list, or no key when the list is empty. @param {JqObject} p @param {string} key @param {JqValue[]} list */
function setList(p, key, list) {
  p.set(key, list);
  if (!list.length) p.delete(key);
}

/**
 * allow-list.sh's allow_claude_render jq program. Throws when the permissions section has an unexpected shape.
 * @param {JqObject} doc
 * @param {string[]} w the allow rules
 * @param {string | null} m the permission mode the tier sets
 * @param {string[]} pd the protecting deny rules
 * @returns {JqObject}
 */
export function claudeRender(doc, w, m, pd) {
  const perms = doc.get('permissions') ?? null;
  if (badShape(doc, perms)) throw new Error('permissions has an unexpected shape');
  const own = alt(get(doc, ALLOW_OWN_KEY), new Map());
  const o = own instanceof Map ? own : new Map();
  const allow = mergeOwned(asList(alt(get(perms, 'allow'), [])), asList(get(o, 'allow')), w);
  const pmode = alt(get(o, 'defaultMode'), null);
  const cur = alt(get(perms, 'defaultMode'), null);
  const ours = cur === null || equal(cur, pmode);
  let mode = cur;
  if (m !== null && ours) mode = m;
  else if (m === null && cur !== null && equal(cur, pmode)) mode = null;
  const omode = m !== null && equal(mode, m) && ours ? m : null;
  const out = new Map(doc);
  /** @type {JqObject} */
  const p = new Map(perms instanceof Map ? perms : []);
  setList(p, 'allow', allow.list);
  if (mode === null) p.delete('defaultMode');
  else p.set('defaultMode', mode);
  out.set('permissions', p);
  const deny = mergeOwned(asList(alt(get(p, 'deny'), [])), asList(get(o, 'deny')), pd);
  setList(p, 'deny', deny.list);
  const owns = allow.owns;
  const downs = deny.owns;
  if (p.size === 0) out.delete('permissions');
  if (owns.length === 0 && omode === null && downs.length === 0) out.delete(ALLOW_OWN_KEY);
  else out.set(ALLOW_OWN_KEY, new Map(/** @type {Array<[string, JqValue]>} */ ([['allow', owns], ['defaultMode', omode], ['deny', downs]])));
  return out;
}

/** jq -r of a value (a string raw, anything else as JSON). @param {JqValue} v */
function raw(v) {
  return typeof v === 'string' ? v : stringify(v, { indent: 2 });
}

/** The jq --indent 4 document, with its newline. @param {JqValue} v */
const indent4 = (v) => stringify(v, { indent: 4 }) + '\n';

/** The settings file as a jq object, or null when it is not one (merge_settings already refused it). @param {string} file */
function readObject(file) {
  const t = readOrNull(file);
  if (t === null) return null;
  const c = classify(t);
  return c.kind === 'json' && c.value instanceof Map ? c.value : null;
}

/**
 * A settings file jq 1.7.1 reads and this step does not (NaN, a byte-order mark, several documents ...):
 * the shell acted on it, this step cannot, so it says so and touches nothing (PR #519 QA B1). Returns
 * true when the step must leave settings.json alone.
 * @param {Ctx} ctx
 */
function jqOnlySettings(ctx) {
  const settings = ctx.opts['--settings'];
  const t = isFile(settings) ? readOrNull(settings) : null;
  if (t === null || classify(t).kind !== 'jq-only') return false;
  ctx.err('REFUSE  ' + settings + ': not readable by the allow-list step (jq reads it, strict JSON does not: NaN, a byte-order mark, several documents or the like); left untouched\n');
  raise(ctx, 3);
  return true;
}

/** @param {Ctx} ctx @param {number} n */
function raise(ctx, n) {
  if (n > ctx.status) ctx.status = n;
}

/** Write file through a temporary beside it and a rename; keepMode copies the old file's mode first. @param {string} file @param {string} text @param {boolean} keepMode */
function replaceFile(file, text, keepMode) {
  const tmp = file + '.new.' + process.pid;
  let mode = null;
  if (keepMode) {
    try {
      mode = fs.statSync(file).mode & 0o7777;
    } catch {
      mode = null;
    }
  }
  fs.writeFileSync(tmp, text);
  if (mode !== null) fs.chmodSync(tmp, mode);
  fs.renameSync(tmp, file);
}

/** The wide tier keeps a permission mode the owner set himself, and says so. @param {Ctx} ctx @param {JqObject} cur */
function ownModeNote(ctx, cur) {
  const curPerms = get(cur, 'permissions');
  const curMode = raw(alt(get(curPerms, 'defaultMode'), ''));
  const ownMode = raw(alt(get(get(cur, ALLOW_OWN_KEY), 'defaultMode'), ''));
  if (curMode !== '' && ownMode === '' && raw(get(curPerms, 'defaultMode')) !== 'acceptEdits') {
    ctx.out('NOTE    ' + ctx.opts['--settings'] + ': your own permissions.defaultMode (' + raw(get(curPerms, 'defaultMode')) + ') is kept; the recommended one is acceptEdits\n');
  }
}

/** @param {Ctx} ctx @param {Parsed} parsed @param {Tier} tier */
function claudeStep(ctx, parsed, tier) {
  const settings = ctx.opts['--settings'];
  const cmd = ctx.opts['--cmd'] || './mhw';
  const has = exists(settings);
  let cur;
  if (has) {
    cur = readObject(settings);
    if (!cur) return;
  } else cur = new Map();
  const gh = ghRules(ctx);
  const render = (/** @type {Tier} */ t) => claudeRender(cur,
    [...words(parsed, t, ['cmd', 'runner', 'route']).map((x) => 'Bash(' + x + ':*)'), ...gh.claudeAllow],
    t === 'wide' ? 'acceptEdits' : null,
    [...protect(ctx), ...words(parsed, t, ['deny']).map((x) => 'Bash(' + x + ':*)'), ...gh.claudeDeny]);
  let want;
  try {
    want = render(tier);
  } catch {
    ctx.err('REFUSE  ' + settings + ': its permissions section has an unexpected shape; allow list not merged\n');
    raise(ctx, 3);
    return;
  }
  const narrow = render('narrow');
  const wantPerms = get(want, 'permissions');
  const nAllow = asList(get(wantPerms, 'allow')).length;
  const modeNow = raw(alt(get(wantPerms, 'defaultMode'), 'default (none set)'));
  if (tier === 'wide') ownModeNote(ctx, cur);
  if (has && equal(cur, want)) {
    ctx.out('OK      ' + settings + ' (allow list: ' + tier + ' tier, ' + nAllow + ' allow rules; permission mode ' + modeNow + ')\n');
    return;
  }
  const mode = ctx.opts['--mode'];
  if (mode === 'check') {
    if (tier === 'wide' && equal(cur, narrow)) {
      ctx.out('NOTE    ' + settings + ': the narrow allow list is installed; the admin floor is complete, so ' + cmd + ' install widens it\n');
    } else if (has) {
      ctx.out('DRIFT   ' + settings + ' (allow list or permission mode differs from the ' + tier + ' tier)\n');
      raise(ctx, 1);
    }
  } else if (mode === 'dry-run') {
    ctx.out('WOULD MERGE ' + settings + ': the ' + tier + ' allow list (' + nAllow + ' rules) and permission mode ' + modeNow + '\n');
    const s = (/** @type {JqValue} */ v) => stringify(v, { indent: 2, sortKeys: true }) + '\n';
    ctx.out(unifiedHunks(s(cur), s(want)));
  } else {
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    replaceFile(settings, indent4(want), has);
    ctx.out('MERGED  ' + settings + ' (allow list: ' + tier + ' tier, ' + nAllow + ' allow rules; permission mode ' + modeNow + ')\n');
  }
}

/** The retired rules: every line that is not blank or a comment. @param {string} text */
export function retiredRules(text) {
  return records(text).filter((l) => !/^[ \t\n\v\f\r]*(#|$)/.test(l));
}

/**
 * The user-level allow entries the policy retired (Issue #145; ADR-0035 decision 4): removed by name from
 * permissions.allow only, the previous file kept as settings.json.pmhwc-allow-backup. Returns false when
 * the step must stop (the backup could not be written).
 * @param {Ctx} ctx
 */
function retireStep(ctx) {
  const settings = ctx.opts['--settings'];
  const src = ctx.opts['--retired'];
  if (!isFile(src)) {
    ctx.err('source not found: ' + src + '\n');
    raise(ctx, 2);
    return true;
  }
  if (!isFile(settings)) return true;
  const doc = readObject(settings);
  if (!doc) return true;
  const list = retiredRules(readOrNull(src) ?? '');
  const perms = get(doc, 'permissions');
  const allow = perms instanceof Map ? get(perms, 'allow') : null;
  const hits = [...new Set((Array.isArray(allow) ? allow : []).filter((x) => typeof x === 'string' && list.includes(x)))]
    .map(String).sort(codepointCompare);
  if (!hits.length) {
    ctx.out('OK      ' + settings + ': no allow entry the policy retired\n');
    return true;
  }
  const what = hits.map((h) => h + ' present -> absent').join('; ');
  const backup = settings + '.pmhwc-allow-backup';
  const mode = ctx.opts['--mode'];
  if (mode === 'check') {
    ctx.out('DRIFT   ' + settings + ': install would change permissions.allow ' + what + ' (retired, ADR-0035 decision 4)\n');
    raise(ctx, 1);
    return true;
  }
  if (mode === 'dry-run') {
    ctx.out('WOULD CHANGE ' + settings + ': permissions.allow ' + what + ' (backup ' + backup + ')\n');
    return true;
  }
  const p = new Map(/** @type {JqObject} */ (perms));
  const kept = /** @type {JqValue[]} */ (allow).filter((x) => !(typeof x === 'string' && list.includes(x)));
  if (kept.length) p.set('allow', kept);
  else p.delete('allow');
  const out = new Map(doc);
  if (p.size) out.set('permissions', p);
  else out.delete('permissions');
  try {
    privateCopy(settings, backup);
  } catch {
    ctx.err('REFUSE  ' + backup + ': the backup could not be created exclusively; no backup written\n');
    raise(ctx, 1);
    return false;
  }
  fs.writeFileSync(settings, indent4(out));
  ctx.out('CHANGED ' + settings + ': permissions.allow ' + what + ' (retired, ADR-0035 decision 4; previous file kept as ' + backup + ')\n');
  return true;
}

/** The gh api rules of this run: what --gh-api named, or none. @param {Ctx} ctx */
const ghRules = (ctx) => ctx.gh || ghApi.NONE;

/**
 * Read and check the --gh-api source into ctx.gh. Returns false (exit 2) when it is missing or invalid.
 * @param {Ctx} ctx
 */
function ghSource(ctx) {
  // An option given is a string (an empty one is a usage error, refused in usable()); an option not given
  // is no key at all, which the Record<string, string> type cannot say, so ask for the key itself.
  if (!Object.hasOwn(ctx.opts, '--gh-api')) return true;
  const file = ctx.opts['--gh-api'];
  const text = isFile(file) ? readOrNull(file) : null;
  if (text === null) {
    ctx.err('gh-api source not found: ' + file + '\n');
    raise(ctx, 2);
    return false;
  }
  const { spec, errors } = ghApi.parseSpec(text);
  if (errors.length) {
    for (const e of errors) ctx.err(e);
    raise(ctx, 2);
    return false;
  }
  ctx.gh = ghApi.rules(spec);
  return true;
}

/** permissions.deny of a settings document, or null when it is not a list. @param {JqObject} doc */
function denyList(doc) {
  const perms = get(doc, 'permissions');
  const deny = perms instanceof Map ? get(perms, 'deny') : null;
  return Array.isArray(deny) ? deny : null;
}

/**
 * The owner's hand-kept "Bash(gh api:*)" deny (mhw#242), retired by #593 (ADR-0048): the baseline renders
 * the gh api rules itself. Removed from permissions.deny only, the previous file kept as
 * settings.json.pmhwc-gh-api-backup, owner-only. An existing backup is never overwritten: install then
 * refuses and leaves the entry. Returns false when the step must stop (the backup could not be written).
 * @param {Ctx} ctx
 */
function retireGhApiStep(ctx) {
  const settings = ctx.opts['--settings'];
  if (!isFile(settings)) return true;
  const doc = readObject(settings);
  if (!doc) return true;
  const deny = denyList(doc);
  const retire = ghRules(ctx).retire;
  if (!retire.length) return true;
  const hits = retire.filter((r) => (deny || []).some((x) => x === r));
  if (!deny || !hits.length) {
    ctx.out('OK      ' + settings + ': no hand-kept ' + retire.join(', ') + ' deny (the baseline renders the gh api rules, ADR-0048)\n');
    return true;
  }
  const rule = hits.join(', ');
  const what = hits.map((h) => h + ' present -> absent').join('; ');
  const backup = settings + ghApi.BACKUP_SUFFIX;
  const mode = ctx.opts['--mode'];
  if (mode === 'check') {
    ctx.out('DRIFT   ' + settings + ': install would change permissions.deny ' + what + ' (moved into the baseline, ADR-0048)\n');
    raise(ctx, 1);
    return true;
  }
  if (mode === 'dry-run') {
    ctx.out('WOULD CHANGE ' + settings + ': permissions.deny ' + what + ' (backup ' + backup + ')\n');
    return true;
  }
  if (lexists(backup)) {
    ctx.err('REFUSE  ' + settings + ': ' + rule + ' left in permissions.deny, because ' + backup
      + ' already exists and is never overwritten; move it aside and re-run the installer. Until then the milestone allow has no effect\n');
    raise(ctx, 1);
    return true;
  }
  const p = new Map(/** @type {JqObject} */ (get(doc, 'permissions')));
  const kept = deny.filter((x) => !(typeof x === 'string' && hits.includes(x)));
  if (kept.length) p.set('deny', kept);
  else p.delete('deny');
  const out = new Map(doc);
  if (p.size) out.set('permissions', p);
  else out.delete('permissions');
  try {
    privateCopy(settings, backup);
  } catch {
    ctx.err('REFUSE  ' + backup + ': the backup could not be created exclusively; no backup written\n');
    raise(ctx, 1);
    return false;
  }
  replaceFile(settings, indent4(out), true);
  ctx.out('CHANGED ' + settings + ': permissions.deny ' + what + ' (moved into the baseline, ADR-0048; previous file kept as ' + backup + ')\n');
  return true;
}

/**
 * Uninstall: the hand-kept deny goes back into permissions.deny when the backup holds it, and the backup
 * is removed once it is back (so a later install can take a fresh one). A backup that holds no such
 * entry, or a settings file of the wrong shape, is left alone and said.
 * @param {Ctx} ctx
 */
function restoreGhApi(ctx) {
  const settings = ctx.opts['--settings'];
  const backup = settings + ghApi.BACKUP_SUFFIX;
  if (!isFile(backup)) return;
  const held = ghApi.RETIRABLE.filter((r) => (denyList(readObject(backup) ?? new Map()) || []).some((x) => x === r));
  if (!held.length) {
    ctx.out('NOTE    ' + backup + ': holds no ' + ghApi.RETIRABLE.join(', ') + ' deny to restore; left in place\n');
    return;
  }
  const rule = held.join(', ');
  const doc = isFile(settings) ? readObject(settings) : new Map();
  const perms = doc ? (get(doc, 'permissions') ?? null) : null;
  const deny = perms instanceof Map ? (get(perms, 'deny') ?? null) : null;
  if (!doc || (perms !== null && !(perms instanceof Map)) || (deny !== null && !Array.isArray(deny))) {
    ctx.err('REFUSE  ' + settings + ': ' + rule + ' not restored (unexpected shape); it is in ' + backup + '\n');
    raise(ctx, 3);
    return;
  }
  const list = Array.isArray(deny) ? deny : [];
  const missing = held.filter((r) => !list.some((x) => x === r));
  if (missing.length) {
    const p = new Map(perms instanceof Map ? perms : []);
    p.set('deny', [...list, ...missing]);
    const out = new Map(doc);
    out.set('permissions', p);
    const there = isFile(settings);
    fs.mkdirSync(path.dirname(settings), { recursive: true });
    replaceFile(settings, indent4(out), there);
  }
  fs.rmSync(backup, { force: true });
  ctx.out('RESTORED ' + settings + ': permissions.deny ' + rule + ' (from ' + backup + ', now removed; ADR-0048)\n');
}

// ---- Managed files of ours (Codex rules and profile, Kiro agent) -----------------------------------

/** The release and commit fields of a file's first managed-by line, or 'none' (install.sh's stamp_of). @param {string} file */
export function stampOf(file) {
  const t = readOrNull(file, 'latin1');
  const line = t === null ? null : (t.split('\n').find((l) => l.includes(MARKER_ID)) ?? null);
  return line === null ? 'none' : stampOfLine(line);
}

/** install.sh's same(): byte-equal, or equal once the stamp fields are removed. @param {string} text @param {string} file */
function same(text, file) {
  const t = readOrNull(file, 'latin1');
  if (t === null) return false;
  const a = Buffer.from(text, 'utf8').toString('latin1');
  return a === t || unstamp(a) === unstamp(t);
}

/** @param {Ctx} ctx @param {string} rendered @param {string} dest @param {string | null} narrow */
function place(ctx, rendered, dest, narrow) {
  const stamp = ctx.opts['--stamp'];
  const cmd = ctx.opts['--cmd'] || './mhw';
  const there = exists(dest);
  if (there && !managed(dest)) {
    ctx.err('REFUSE  ' + dest + ': exists and is NOT managed by this project; move it aside or merge it by hand\n');
    raise(ctx, 3);
    return;
  }
  if (there && same(rendered, dest) && stampOf(dest) === stamp) {
    ctx.out('OK      ' + dest + ' (' + stamp + ')\n');
    return;
  }
  const mode = ctx.opts['--mode'];
  if (mode === 'check') {
    if (there && same(rendered, dest)) {
      ctx.out('STAMP   ' + dest + ': content matches, but it carries (' + stampOf(dest) + ') and the source is (' + stamp + ')\n');
      raise(ctx, 1);
    } else if (there && narrow !== null && same(narrow, dest)) {
      ctx.out('NOTE    ' + dest + ': the narrow allow list is installed; the admin floor is complete, so ' + cmd + ' install widens it\n');
    } else if (there) {
      ctx.out('DRIFT   ' + dest + ' (' + stampOf(dest) + ')\n');
      raise(ctx, 1);
    } else {
      ctx.out('MISSING ' + dest + '\n');
      raise(ctx, 1);
    }
  } else if (mode === 'dry-run') {
    ctx.out('WOULD WRITE ' + dest + ':\n----- begin ' + dest + '\n' + rendered + '----- end ' + dest + '\n');
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    replaceFile(dest, rendered, false);
    ctx.out('WROTE   ' + dest + ' (' + stamp + ')\n');
  }
}

/** @param {string} stamp */
const header = (stamp) => '# ' + MARKER_ID + '; source: global/allow-list.conf; ' + stamp + '; do not edit, re-run the installer\n';

/** @param {string} w a word list @param {string} decision */
const prefixRule = (w, decision) => 'prefix_rule(pattern=[' + fields(w).map((x) => '"' + x + '"').join(', ') + '], decision="' + decision + '")\n';

/** The Codex rules file. @param {Parsed} p @param {Tier} tier @param {string} stamp @param {GhRules} [gh] the gh api rule set */
export function codexRules(p, tier, stamp, gh = ghApi.NONE) {
  return header(stamp)
    + '# The workstation allow list, ' + tier + ' tier (ADR-0031). A forbidden rule (the deny floor) beats an allow\n'
    + '# rule whatever file holds it (measured, codex execpolicy check). Test runners have no rule here:\n'
    + '# they run inside the workspace-write sandbox of the "' + ALLOW_PROFILE + '" profile without one.\n'
    + words(p, tier, ['cmd']).map((w) => prefixRule(w, 'allow')).join('')
    + words(p, tier, ['deny']).map((w) => prefixRule(w, 'forbidden')).join('')
    + (gh.codexForbidden.length ? '# The gh api rule set (ADR-0048): the method-first write spellings. No milestone allow: a token is exact.\n'
      + gh.codexForbidden.map((w) => prefixRule(w, 'forbidden')).join('') : '');
}

/** The Codex profile file. @param {Tier} tier @param {string} stamp */
export function codexProfile(tier, stamp) {
  return header(stamp)
    + '# The workstation permission profile, ' + tier + ' tier (ADR-0031). Use it with: codex --profile ' + ALLOW_PROFILE + '\n'
    + 'approval_policy = "on-request"\n'
    + 'sandbox_mode = "' + (tier === 'wide' ? 'workspace-write' : 'read-only') + '"\n';
}

/**
 * The Kiro agent, always narrow: this CLI 2.x agent reads no deny floor (the Kiro floor in permissions.yaml
 * reaches only the IDE and CLI V3, ADR-0036). One file, both engines: the 2.0 fields (allowedTools,
 * toolsSettings) are what CLI 2.x reads; "permissions" is the V3 form, with an exclude list carrying the
 * 2.x pattern's refused characters, newline and CR included (PR #153 QA advisory A1).
 * With gh, the gh api rule set's milestone family is allowed too (ADR-0048).
 * @param {Parsed} p @param {string} stamp @param {GhRules} [gh]
 */
export function kiroAgent(p, stamp, gh = ghApi.NONE) {
  const w = words(p, 'narrow', ['cmd']);
  const esc = (/** @type {string} */ s) => [...s].map((c) => (c === '.' || c === '+' ? '\\' + c : c)).join('');
  /** @type {Array<[string, JqValue]>} */
  const shell = [
    ['capability', 'shell'],
    ['match', [...w.flatMap((x) => [x + ' *', x]), ...gh.kiroMatch]],
    ['exclude', [';', '&', '|', '<', '>', '$', '`', '(', ')', '{', '}', '\n', '\r'].map((c) => '*' + c + '*')],
    ['effect', 'allow'],
  ];
  const doc = new Map(/** @type {Array<[string, JqValue]>} */ ([
    ['name', 'workstation'],
    ['description', MARKER_ID + '; source: global/allow-list.conf; ' + stamp + '; do not edit, re-run the installer'],
    ['tools', ['*']],
    ['allowedTools', ['fs_read']],
    ['toolsSettings', new Map([['execute_bash', new Map(/** @type {Array<[string, JqValue]>} */ ([
      ['allowedCommands', [...w.map((x) => '^' + esc(x) + '( [^;&|<>$`(){}\\n\\r]*)?$'), ...gh.kiroAllowed]],
      ['autoAllowReadonly', false]]))]])],
    ['permissions', new Map([['rules', [new Map(shell), new Map([['capability', 'fs_read'], ['effect', 'allow']])]]])],
  ]));
  return stringify(doc, { indent: 2 }) + '\n';
}

/** @param {Ctx} ctx */
function targets(ctx) {
  const home = ctx.opts['--home'];
  const codex = ctx.opts['--codex-home'] || home + '/.codex';
  return { rules: codex + '/rules/workstation-allow-list.rules', profile: codex + '/workstation.config.toml', kiro: home + '/.kiro/agents/workstation.json' };
}

/** The whole step (allow_step). @param {Ctx} ctx @param {Parsed} parsed */
export function step(ctx, parsed) {
  const tier = adminState(ctx);
  const cmd = ctx.opts['--cmd'] || './mhw';
  const stamp = ctx.opts['--stamp'];
  if (tier.claude === 'narrow' || tier.codex === 'narrow') {
    ctx.out('RISK    admin deny floor incomplete (Claude Code: ' + tier.claude + ', Codex: ' + tier.codex + ' tier): an allow list without the admin barrier is limited to reading; '
      + cmd + ' install (it asks for your administrator password once) widens it\n');
  }
  if (!jqOnlySettings(ctx)) {
    if (!retireStep(ctx)) return;
    if (!retireGhApiStep(ctx)) return;
    claudeStep(ctx, parsed, tier.claude);
  }
  const t = targets(ctx);
  const wide = tier.codex === 'wide';
  // A harness whose deny floor install.sh could not write gets no allow list either (#491, PR #539 lens F3).
  const refused = (ctx.opts['--refused-floor'] || '').split(',').filter(Boolean);
  const without = (/** @type {string} */ name) => {
    ctx.err('REFUSE  the ' + name + ' allow list: its deny floor was not written (see above), and an allow list never lands without it; nothing written for ' + name + '\n');
    raise(ctx, 2);
  };
  if (refused.includes('codex')) without('Codex');
  else {
    const gh = ghRules(ctx);
    place(ctx, codexRules(parsed, tier.codex, stamp, gh), t.rules, wide ? codexRules(parsed, 'narrow', stamp, gh) : null);
    place(ctx, codexProfile(tier.codex, stamp), t.profile, wide ? codexProfile('narrow', stamp) : null);
  }
  if (refused.includes('kiro')) without('Kiro');
  else place(ctx, kiroAgent(parsed, stamp, ghRules(ctx)), t.kiro, null);
  ctx.out('ALLOW   Claude Code: ' + tier.claude + ' tier · Codex: ' + tier.codex + ' tier, profile ' + ALLOW_PROFILE
    + ' · Kiro: narrow tier, agent workstation (Kiro CLI 2.x reads no deny floor; the floor is in permissions.yaml, IDE and CLI V3, ADR-0036)\n');
}

/** Uninstall: our files go, and only the allow rules and permission mode this installer added leave settings.json. @param {Ctx} ctx */
export function uninstall(ctx) {
  // Nothing is removed while settings.json cannot be read: install.sh then stops the uninstall, so the
  // deny floor stays beside whatever allow rules the file holds (PR #519 QA B1, lens A3).
  if (jqOnlySettings(ctx)) return;
  const t = targets(ctx);
  for (const u of [t.rules, t.profile, t.kiro]) {
    if (isFile(u) && managed(u)) {
      fs.rmSync(u, { force: true });
      ctx.out('REMOVED ' + u + '\n');
    } else if (exists(u)) ctx.out('NOTE    ' + u + ' exists and is NOT managed by this project; left alone\n');
  }
  const settings = ctx.opts['--settings'];
  if (isFile(settings + '.pmhwc-allow-backup')) {
    ctx.out('NOTE    ' + settings + ': the allow entries the policy retired are in ' + settings + '.pmhwc-allow-backup; uninstall does not re-add them (ADR-0035 decision 4)\n');
  }
  if (isFile(settings)) {
    const doc = readObject(settings);
    if (doc?.has(ALLOW_OWN_KEY)) {
      let out;
      try {
        out = unmerged(doc);
      } catch {
        ctx.err('REFUSE  ' + settings + ': its permissions section or the allow-list ownership record has an unexpected shape; left untouched\n');
        raise(ctx, 3);
        return;
      }
      replaceFile(settings, indent4(out), false);
      ctx.out('UNMERGED ' + settings + ' (the allow rules and permission mode this installer added)\n');
    }
  }
  // After the unmerge: the milestone allow has left, so the owner's broad deny comes back beside nothing of ours.
  restoreGhApi(ctx);
}

/** allow_uninstall's jq program. @param {JqObject} doc @returns {JqObject} */
export function unmerged(doc) {
  const own = doc.get(ALLOW_OWN_KEY) ?? null;
  if (own !== null && !(own instanceof Map)) throw new Error('unexpected shape');
  const mine = asList(alt(get(own, 'allow'), []));
  const m = alt(get(own, 'defaultMode'), null);
  const mdeny = asList(alt(get(own, 'deny'), []));
  const perms = doc.get('permissions') ?? null;
  if (perms !== null && !(perms instanceof Map)) throw new Error('unexpected shape');
  const out = new Map(doc);
  if (perms instanceof Map) {
    const p = new Map(perms);
    withoutOurs(p, 'allow', mine);
    if (m !== null && equal(p.get('defaultMode') ?? null, m)) p.delete('defaultMode');
    withoutOurs(p, 'deny', mdeny);
    if (p.size) out.set('permissions', p);
    else out.delete('permissions');
  }
  out.delete(ALLOW_OWN_KEY);
  return out;
}

/** The list at key without the rules in ours; no key when nothing is left. @param {JqObject} p @param {string} key @param {JqValue[]} ours */
function withoutOurs(p, key, ours) {
  const v = p.get(key);
  if (!Array.isArray(v)) return;
  setList(p, key, v.filter((r) => !contains(ours, r)));
}

// ---- The command line --------------------------------------------------------------------------------

const OPTIONS = new Set(['--phase', '--mode', '--stamp', '--source', '--overlay', '--retired', '--floor-codex',
  '--floor-claude', '--managed-root', '--settings', '--home', '--codex-home', '--repo-root', '--cmd', '--refused-floor', '--gh-api']);
const REQUIRED = {
  parse: ['--source', '--floor-codex'],
  step: ['--mode', '--stamp', '--source', '--retired', '--floor-codex', '--settings', '--home', '--repo-root'],
  uninstall: ['--settings', '--home'],
};
const USAGE = 'usage: ' + PROG + ' --phase=parse --source=FILE [--overlay=DIR] --floor-codex=FILE\n'
  + '       ' + PROG + ' --phase=step --mode=install|check|dry-run --stamp=STAMP --source=FILE [--overlay=DIR]\n'
  + '           --retired=FILE --floor-codex=FILE [--floor-claude=FILE] [--managed-root=DIR] --settings=FILE\n'
  + '           --home=DIR [--codex-home=DIR] --repo-root=DIR [--cmd=TEXT] [--refused-floor=codex,kiro] [--gh-api=FILE]\n'
  + '       ' + PROG + ' --phase=uninstall --settings=FILE --home=DIR [--codex-home=DIR]\n';

/** @param {string[]} argv */
const options = (argv) => keyOptions(argv, OPTIONS);

/**
 * The phase, when the command line is complete for it; '' for a usage error.
 * @param {string[]} argv @param {Record<string, string>} opts
 * @returns {'' | keyof typeof REQUIRED}
 */
function usable(argv, opts) {
  if (options(argv) === null) return '';
  const phase = opts['--phase'] ?? '';
  if (phase !== 'parse' && phase !== 'step' && phase !== 'uninstall') return '';
  if (REQUIRED[phase].some((k) => !opts[k])) return '';
  if (!(opts['--refused-floor'] || '').split(',').filter(Boolean).every((h) => h === 'codex' || h === 'kiro')) return '';
  if (opts['--gh-api'] === '') return '';
  return phase === 'step' && !['install', 'check', 'dry-run'].includes(opts['--mode']) ? '' : phase;
}

/**
 * The command line. Returns the exit code.
 * @param {string[]} argv
 * @param {{ out?: (s: string | Buffer) => void, err?: (s: string | Buffer) => void, platform?: string }} [io]
 */
export function main(argv, io = {}) {
  const opts = options(argv) ?? {};
  /** @type {Ctx} */
  const ctx = {
    out: io.out || ((s) => process.stdout.write(s)),
    err: io.err || ((s) => process.stderr.write(s)),
    platform: io.platform || process.platform,
    status: 0,
    opts,
  };
  const phase = usable(argv, opts);
  if (!phase) {
    ctx.err(USAGE);
    return 2;
  }
  if (phase === 'uninstall') {
    uninstall(ctx);
    return ctx.status;
  }
  const parsed = parseStep(ctx);
  if (!parsed) return 2;
  if (phase === 'step' && !ghSource(ctx)) return ctx.status;
  if (phase === 'step') step(ctx, parsed);
  return ctx.status;
}

/** True when this file is the program node was started with. */
function isEntry() {
  try {
    return fs.realpathSync(process.argv[1] || '') === fs.realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntry()) process.exitCode = main(process.argv.slice(2));
