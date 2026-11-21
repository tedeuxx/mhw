#!/usr/bin/env node
// The only route the method-issue-sync agent has to GitHub (Issue #62, ADR-0032 2026-10-12 amendment).
// The Node form of the deleted .github/scripts/method_issue_sync.py (#500, S30 of #470): same commands,
// same refusals, same exit codes and the same bytes on stdout and stderr, except where
// test/golden/S30/expected-differences.json says otherwise.
//
// .github/workflows/method-issue-sync.yml runs anthropics/claude-code-action with one Bash rule, this
// script, and no other shell. The script is therefore the boundary, and it is deliberately narrow:
//
// - it reads exactly one mhw Issue, the one the run is for (MHW_ISSUE), with MHW_TOKEN;
// - it writes only to tedeuxx/tadeumendonca-skills, with MHW_SKILLS_TOKEN (the GitHub App token), and
//   only to the twin of that mhw Issue: the App-authored -skills Issue (author TWIN_AUTHOR) whose body
//   carries the hidden marker <!-- mhw-issue: tedeuxx/mhw#N -->. -skills is public, so anyone can open an
//   Issue carrying the marker: such an Issue is ignored, named in a warning, and never edited. It cannot
//   touch any other -skills Issue;
// - a twin it creates or edits must carry the marker and the link back; a body file must be a regular
//   file under MHW_SYNC_DIR (so /proc/self/environ is refused), and a body or title that looks like a
//   credential, or contains 12 or more characters of a token held in its environment, is refused;
// - a refusal names the argument's position or kind, never its value;
// - it closes the twin only while the mhw Issue is closed, and reopens it only while it is open.
//
// `verify` runs after the agent in the sync job and fails the run when no twin exists or its state
// differs from the mhw Issue's, so a refused or abandoned sync is red, not green. `backlink` is not for
// the agent: the separate backlink job runs it with an issues:write MHW_TOKEN to comment the twin's URL on
// the mhw Issue once; only a comment by GitHub Actions counts as an existing back-link. In the agent's job
// MHW_TOKEN is read-only.
//
// The token values are never printed. gh is the first gh on PATH (absolute entries only) and is run by
// absolute path, never through a shell. Imports: node: modules and two files of src/lib, which import
// nothing else (the workflow's sparse checkout carries .github/scripts and src/lib). POSIX: the sync
// runs on ubuntu-latest.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { loads, dumps, pyStr, pyLen, pyStrip, codePoints, isInt, PyFloat } from '../../src/lib/py.js';
import { onPath } from '../../src/lib/onpath.js';

export const MHW_REPO = 'tedeuxx/mhw';
export const SKILLS_REPO = 'tedeuxx/tadeumendonca-skills';
const TWIN_LIST_LIMIT = '2000';
const MAX_BODY_BYTES = 60000;
const MAX_TITLE = 256;
const BACKLINK_MARKER = '<!-- mhw-twin: ';
// The login gh reports for an Issue the mirror App opened. A hypothesis until the canary confirms it
// (docs/runbooks/method-issue-sync.md); if it is wrong, verify fails red because no twin is found.
const TWIN_AUTHOR = 'app/tedeuxx-mhw-mirror';
// Logins gh may report for a comment posted with the workflow's GITHUB_TOKEN.
const BACKLINK_AUTHORS = new Set(['github-actions', 'app/github-actions', 'github-actions[bot]']);
// Token values a title or body must never contain any 12-character run of.
const TOKEN_NAMES = ['MHW_SKILLS_TOKEN', 'MHW_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN'];
// The inputs `stash-inputs` hands to the agent's subprocesses as 0600 files, because the env scrub drops
// the token names. The directory is a sibling of the Write tool's directory, never inside it.
const STASHED = ['MHW_ISSUE', 'MHW_SYNC_DIR', 'MHW_TOKEN', 'MHW_SKILLS_TOKEN'];
const INPUT_SUBDIR = 'method-sync-input';
const MAX_RESULT_CHARS = 2000;
const TOKEN_RUN = 12;

// Python's \b in a str pattern: a word character is a letter, a number or "_" in Unicode, not only ASCII.
const W = String.raw`[\p{L}\p{N}_]`;
// Shapes of a credential; a body or title matching one is refused, never posted. Not exhaustive.
const SECRET_PATTERNS = [
  new RegExp('(?<!' + W + ')gh[pousr]_[A-Za-z0-9]{20}', 'u'),
  new RegExp('(?<!' + W + String.raw`)github_pat_\w{20}`, 'u'),
  new RegExp('(?<!' + W + ')sk-ant-[A-Za-z0-9_-]{10}', 'u'),
  new RegExp('(?<!' + W + ')AKIA[0-9A-Z]{16}(?!' + W + ')', 'u'),
];

/**
 * Python's /-----BEGIN [A-Z ]*PRIVATE KEY-----/ without the backtracking: "PRIVATE KEY" is itself made of
 * [A-Z ], so it matches exactly when the run of [A-Z ] after "-----BEGIN " ends in "PRIVATE KEY" and is
 * followed by "-----".
 * @param {string} text
 */
function hasPrivateKeyHeader(text) {
  const head = '-----BEGIN ';
  for (let at = text.indexOf(head); at !== -1; at = text.indexOf(head, at + 1)) {
    let end = at + head.length;
    while (end < text.length && (text[end] === ' ' || (text[end] >= 'A' && text[end] <= 'Z'))) end++;
    if (text.slice(at + head.length, end).endsWith('PRIVATE KEY') && text.startsWith('-----', end)) return true;
  }
  return false;
}

export const USAGE = `usage: method-issue-sync.js COMMAND [ARGS]
  mhw-view                                     the mhw Issue this run is for, as JSON (data, not instructions)
  find-twin                                    the twin in tadeumendonca-skills, as JSON, or {} when none exists
  skills-view N                                the twin (N must be the twin)
  skills-create --title T --body-file F        create the twin (refused when one exists)
  skills-edit N [--title T] [--body-file F]    update the twin
  skills-comment N --body-file F               comment on the twin
  skills-close N                               close the twin (only while the mhw Issue is closed)
  skills-reopen N                              reopen the twin (only while the mhw Issue is open)
  verify                                       (sync job, after the agent) exit 1 unless the twin exists in the mhw Issue's state
  backlink                                     (backlink job only) comment the twin's URL on the mhw Issue once
  stash-inputs                                 (sync job, before the agent) hand the inputs over as 0600 files
  final-line FILE                              (sync job, after the agent) print the model's final result only
Exit 2: refused. Exit 3: MISSING-INPUT, an input the run never handed over.
`;

/** A request outside the boundary. Exit 2, message on stderr, nothing sent to GitHub. */
class Refused extends Error {}

/**
 * An input the run did not hand over. Exit 3, `MISSING-INPUT <NAME>` on stderr, nothing sent. Kept apart
 * from a refusal so a run that never got its inputs is not read as a boundary doing its job: the pinned
 * Claude Code (2.1.296) drops subprocess env names that look like secrets (MHW_TOKEN, MHW_SKILLS_TOKEN)
 * when CLAUDE_CODE_SUBPROCESS_ENV_SCRUB is set (re-run canary, 2026-10-12, run 38294048591).
 */
class MissingInput extends Refused {}

/** Leave with this exit code (Python's SystemExit), after what was written. */
class Exit extends Error {
  /** @param {number} code */
  constructor(code) {
    super('exit ' + code);
    this.code = code;
  }
}

/** @typedef {Record<string, unknown> | Map<string, unknown>} Dict */

/** @param {unknown} v @returns {v is Map<string, unknown>} */
const isMap = (v) => v instanceof Map;

/** dict.get(key, fallback) on a parsed JSON object. @param {unknown} obj @param {string} key @param {unknown} [fallback] */
function get(obj, key, fallback) {
  if (isMap(obj)) return obj.has(key) ? obj.get(key) : fallback;
  if (obj && typeof obj === 'object' && !Array.isArray(obj) && !(obj instanceof PyFloat)) {
    return Object.hasOwn(obj, key) ? /** @type {Record<string, unknown>} */ (obj)[key] : fallback;
  }
  throw new TypeError("'" + typeName(obj) + "' object has no attribute 'get'");
}

/** @param {unknown} v */
function typeName(v) {
  if (v === null || v === undefined) return 'NoneType';
  if (Array.isArray(v)) return 'list';
  if (typeof v === 'string') return 'str';
  if (typeof v === 'boolean') return 'bool';
  if (v instanceof PyFloat) return 'float';
  if (typeof v === 'number' || typeof v === 'bigint') return 'int';
  return 'dict';
}

/** Python truthiness of a parsed JSON value. @param {unknown} v */
function truthy(v) {
  if (v === null || v === undefined || v === false || v === '' || v === 0 || v === 0n) return false;
  if (v instanceof PyFloat) return v.v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isMap(v)) return v.size > 0;
  if (typeof v === 'object') return Object.keys(v).length > 0;
  return true;
}

/** `x or ""` of a value Python then tests with `in`: a str, or "" for anything falsy. @param {unknown} v */
function textOr(v) {
  if (!truthy(v)) return '';
  if (typeof v === 'string') return v;
  throw new TypeError("argument of type '" + typeName(v) + "' is not iterable");
}

/** @param {string} issue */
const marker = (issue) => '<!-- mhw-issue: ' + MHW_REPO + '#' + issue + ' -->';
/** @param {string} issue */
const mhwUrl = (issue) => 'https://github.com/' + MHW_REPO + '/issues/' + issue;

/** Text read as Python's open(encoding="utf-8").read() reads it: strict UTF-8, a BOM kept, newlines universal. @param {string} file */
function readText(file) {
  const raw = fs.readFileSync(file);
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(raw).replace(/\r\n?/g, '\n');
}

/** Where the sync job's `stash-inputs` step left the inputs: MHW_INPUT_DIR, else RUNNER_TEMP/INPUT_SUBDIR. */
function inputDir() {
  const explicit = process.env.MHW_INPUT_DIR || '';
  if (explicit) return explicit;
  const runnerTemp = process.env.RUNNER_TEMP || '';
  return runnerTemp ? path.join(runnerTemp, INPUT_SUBDIR) : '';
}

/** @param {string} p */
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/** @param {string} p */
function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** An input from the environment, else from the stashed file of the same name; "" when neither. @param {string} name */
function readInput(name) {
  const value = process.env[name] || '';
  if (value) return value;
  const folder = inputDir();
  const file = folder ? path.join(folder, name) : '';
  if (file && isFile(file)) return pyStrip(readText(file));
  return '';
}

/** @param {string} name */
function requireInput(name) {
  const value = readInput(name);
  if (!value) {
    throw new MissingInput('MISSING-INPUT ' + name + ': not in the environment and not in the input directory '
      + '(the subprocess env scrub drops names that look like secrets; the sync job stashes them with stash-inputs)');
  }
  return value;
}

const ISSUE_NUMBER = /^[1-9]\d{0,6}$/;

function envIssue() {
  const value = requireInput('MHW_ISSUE');
  if (!ISSUE_NUMBER.test(value)) throw new Refused('MHW_ISSUE is not an Issue number');
  return value;
}

/** Universal newlines, as Python's text-mode pipe reads them. @param {string} s */
const universal = (s) => s.replace(/\r\n?/g, '\n');

/**
 * Run gh with exactly one token. GITHUB_TOKEN is dropped so it can never win over GH_TOKEN.
 * @param {string[]} args
 * @param {string} tokenName
 */
function gh(args, tokenName) {
  /** @type {Record<string, string | undefined>} */
  const env = { ...process.env };
  delete env.GITHUB_TOKEN;
  delete env.GH_ENTERPRISE_TOKEN;
  env.GH_TOKEN = requireInput(tokenName);
  env.GH_PROMPT_DISABLED = '1';
  const exe = onPath('gh', process.env);
  if (!exe) {
    process.stderr.write('gh is not on PATH (absolute entries only)\n');
    throw new Exit(1);
  }
  const p = spawnSync(exe, args, { env, encoding: 'utf8', shell: false, maxBuffer: 64 * 1024 * 1024 });
  if (p.error) {
    process.stderr.write('gh could not run: ' + p.error.message + '\n');
    throw new Exit(1);
  }
  if (p.status !== 0) {
    process.stderr.write(universal(p.stderr || ''));
    // A death by signal is Python's negative return code, which sys.exit masks to one byte.
    const signal = p.signal ? os.constants.signals[p.signal] : 0;
    throw new Exit(p.status ?? (256 - (signal || 255)) % 256);
  }
  return universal(p.stdout || '');
}

/** @param {string[]} args */
const skills = (args) => gh([...args, '--repo', SKILLS_REPO], 'MHW_SKILLS_TOKEN');

/** @param {string} text the output of a gh --json call */
function parse(text) {
  return loads(text, { ordered: true });
}

/** @param {string} issue */
function mhwIssueJson(issue) {
  return parse(gh(['issue', 'view', issue, '--repo', MHW_REPO, '--json', 'number,title,body,state,url,labels'], 'MHW_TOKEN'));
}

/** @param {unknown} item */
function authorLogin(item) {
  const author = get(item, 'author');
  const login = truthy(author) ? get(author, 'login') : undefined;
  return truthy(login) ? /** @type {string} */ (login) : '';
}

/** @param {unknown} v */
function asList(v) {
  if (!Array.isArray(v)) throw new TypeError("'" + typeName(v) + "' object is not iterable");
  return v;
}

/** @param {unknown} item */
const hashNumber = (item) => '#' + pyStr(get(item, 'number'));

/**
 * The twin: number, title, state and url, or null.
 * @param {string} issue
 * @returns {Map<string, unknown> | null}
 */
function findTwin(issue) {
  const out = skills(['issue', 'list', '--state', 'all', '--limit', TWIN_LIST_LIMIT, '--json', 'number,title,state,url,body,author']);
  const needle = marker(issue);
  const marked = asList(parse(out)).filter((i) => textOr(get(i, 'body')).includes(needle));
  const found = marked.filter((i) => authorLogin(i) === TWIN_AUTHOR);
  const ignored = marked.filter((i) => authorLogin(i) !== TWIN_AUTHOR);
  if (ignored.length) {
    process.stderr.write('::warning::ignored ' + ignored.map(hashNumber).join(', ') + ' in ' + SKILLS_REPO
      + ': carries the marker of ' + mhwUrl(issue) + ' but was not opened by the mirror App\n');
  }
  if (found.length > 1) {
    throw new Refused('more than one App-authored Issue in ' + SKILLS_REPO + ' carries ' + needle + ': ' + found.map(hashNumber).join(', '));
  }
  if (!found.length) return null;
  const twin = found[0];
  /** @param {string} k */
  const field = (k) => {
    const v = get(twin, k, undefined);
    if (v === undefined) throw new Error("KeyError: '" + k + "'");
    return v;
  };
  return new Map([['number', field('number')], ['title', field('title')], ['state', field('state')], ['url', field('url')]]);
}

/** @param {string} issue @param {string} number */
function requireTwin(issue, number) {
  if (!ISSUE_NUMBER.test(number || '')) throw new Refused('the Issue number argument is not a number');
  const twin = findTwin(issue);
  if (twin === null) throw new Refused(mhwUrl(issue) + ' has no twin in ' + SKILLS_REPO + ' yet');
  if (pyStr(twin.get('number')) !== number) {
    throw new Refused('the Issue number argument is not the twin of ' + mhwUrl(issue) + ' (the twin is #' + pyStr(twin.get('number')) + ')');
  }
  return twin;
}

/** @param {string} text @param {string} what */
function checkSecrets(text, what) {
  for (const pattern of SECRET_PATTERNS) {
    if (pattern.test(text)) throw new Refused('the ' + what + ' looks like it carries a credential; nothing was sent');
  }
  if (hasPrivateKeyHeader(text)) throw new Refused('the ' + what + ' looks like it carries a credential; nothing was sent');
  for (const name of TOKEN_NAMES) {
    const value = codePoints(readInput(name));
    for (let start = 0; start <= value.length - TOKEN_RUN; start++) {
      if (text.includes(value.slice(start, start + TOKEN_RUN).join(''))) {
        throw new Refused('the ' + what + ' contains part of a token held by this run; nothing was sent');
      }
    }
  }
}

/** @param {string} title */
function checkTitle(title) {
  if (!title || pyLen(title) > MAX_TITLE || title.includes('\n') || title.includes('\r')) {
    throw new Refused('the title must be one line of 1 to ' + MAX_TITLE + ' characters');
  }
  checkSecrets(title, 'title');
}

/**
 * One component of realpath: the link's target to resolve, or the path to keep (not a link, missing, or a
 * link already resolved or being resolved, which is a loop and is kept as it is).
 * @param {string} newpath
 * @param {Map<string, string | null>} seen
 * @returns {string | { path: string }}
 */
function linkTarget(newpath, seen) {
  try {
    if (!fs.lstatSync(newpath).isSymbolicLink()) return { path: newpath };
    if (seen.has(newpath)) return { path: seen.get(newpath) ?? newpath };
    return fs.readlinkSync(newpath);
  } catch {
    return { path: newpath };
  }
}

/**
 * os.path.realpath(p) of CPython 3.14 (POSIX, strict=False): each component in order, a link replaced by
 * its target, ".." applied to what is already resolved, a missing component or a loop kept as it is.
 * @param {string} filename
 */
export function pyRealpath(filename) {
  const rest = /** @type {Array<string | null>} */ (filename.split('/').reverse());
  let partCount = rest.length;
  let p = filename.startsWith('/') ? '/' : process.cwd();
  /** @type {Map<string, string | null>} */
  const seen = new Map();
  while (partCount) {
    const name = rest.pop();
    if (name === null) {
      seen.set(/** @type {string} */ (rest.pop()), p);
      continue;
    }
    partCount -= 1;
    if (!name || name === '.') continue;
    if (name === '..') {
      p = p.slice(0, p.lastIndexOf('/')) || '/';
      continue;
    }
    const newpath = p === '/' ? p + name : p + '/' + name;
    const target = linkTarget(newpath, seen);
    if (typeof target !== 'string') {
      p = target.path;
      continue;
    }
    if (target.startsWith('/')) p = '/';
    seen.set(newpath, null);
    rest.push(newpath, null);
    const parts = target.split('/').reverse();
    rest.push(...parts);
    partCount += parts.length;
  }
  return p;
}

/** os.path.commonpath([root, p]) === root, for two absolute paths. @param {string} root @param {string} p */
function within(root, p) {
  const split = (/** @type {string} */ s) => s.split('/').filter((c) => c && c !== '.');
  const a = split(root);
  const b = split(p);
  return a.length <= b.length && a.every((c, i) => c === b[i]);
}

/**
 * The body file, refused unless it is a regular file under MHW_SYNC_DIR, small, not empty and free of
 * credentials; a twin body must also carry the marker and the link back. Returns the resolved path.
 * @param {string} file
 * @param {string} issue
 * @param {boolean} twinBody
 */
function readBody(file, issue, twinBody) {
  const root = readInput('MHW_SYNC_DIR');
  if (!root || !isDir(root)) throw new Refused('MHW_SYNC_DIR is not a directory');
  const realRoot = pyRealpath(root);
  const real = pyRealpath(file);
  if (!within(realRoot, real) || real === realRoot) throw new Refused('a body file must be under MHW_SYNC_DIR');
  if (!isFile(real)) throw new Refused('a body file must be a regular file');
  if (fs.statSync(real).size > MAX_BODY_BYTES) throw new Refused('a body file must be at most ' + MAX_BODY_BYTES + ' bytes');
  const body = readText(real);
  if (!pyStrip(body)) throw new Refused('the body is empty');
  checkSecrets(body, 'body');
  if (twinBody) {
    if (!body.includes(marker(issue))) throw new Refused('the twin body must carry ' + marker(issue));
    if (!body.includes(mhwUrl(issue))) throw new Refused('the twin body must link back to ' + mhwUrl(issue));
  }
  return real;
}

/**
 * --flag VALUE pairs only, each at most once, from the allowed set; anything else is refused.
 * @param {string[]} args
 * @param {Set<string>} allowed
 * @returns {Map<string, string>}
 */
function parseFlags(args, allowed) {
  const flags = new Map();
  const rest = [...args];
  let position = 0;
  while (rest.length) {
    position += 1;
    const flag = /** @type {string} */ (rest.shift());
    if (!allowed.has(flag)) throw new Refused('the argument at position ' + position + ' is not an allowed flag here');
    if (flags.has(flag)) throw new Refused(flag + ' is given twice');
    if (!rest.length) throw new Refused(flag + ' has no value');
    flags.set(flag, rest.shift());
    position += 1;
  }
  return flags;
}

/** @param {string[]} args */
function oneNumber(args) {
  if (args.length !== 1) throw new Refused('expected exactly one Issue number');
  return args[0];
}

/** print(): the text and a newline, on stdout. @param {string} text */
const print = (text) => process.stdout.write(text + '\n');

/** @param {string} issue @param {string[]} args */
function cmdMhwView(issue, args) {
  if (args.length) throw new Refused('mhw-view takes no arguments: it reads only the Issue this run is for');
  print(dumps(mhwIssueJson(issue), { indent: 2, sortKeys: false, ensureAscii: true }));
}

/** @param {string} issue @param {string[]} args */
function cmdFindTwin(issue, args) {
  if (args.length) throw new Refused('find-twin takes no arguments');
  print(dumps(findTwin(issue) ?? new Map(), { sortKeys: false, ensureAscii: true, separators: [', ', ': '] }));
}

/** @param {string} issue @param {string[]} args */
function cmdView(issue, args) {
  const number = oneNumber(args);
  requireTwin(issue, number);
  process.stdout.write(skills(['issue', 'view', number, '--json', 'number,title,body,state,url']));
}

const TITLE_AND_BODY = new Set(['--title', '--body-file']);

/** @param {string} issue @param {string[]} args */
function cmdCreate(issue, args) {
  const flags = parseFlags(args, TITLE_AND_BODY);
  if (flags.size !== 2) throw new Refused('skills-create needs --title and --body-file');
  const title = /** @type {string} */ (flags.get('--title'));
  checkTitle(title);
  const body = readBody(/** @type {string} */ (flags.get('--body-file')), issue, true);
  const existing = findTwin(issue);
  if (existing !== null) throw new Refused('the twin already exists: ' + pyStr(existing.get('url')) + '; use skills-edit');
  process.stdout.write(skills(['issue', 'create', '--title', title, '--body-file', body]));
}

/** @param {string} issue @param {string[]} args */
function cmdEdit(issue, args) {
  if (!args.length) throw new Refused("skills-edit needs the twin's number");
  const number = args[0];
  const flags = parseFlags(args.slice(1), TITLE_AND_BODY);
  if (!flags.size) throw new Refused('skills-edit needs --title or --body-file');
  const out = ['issue', 'edit', number];
  if (flags.has('--title')) {
    const title = /** @type {string} */ (flags.get('--title'));
    checkTitle(title);
    out.push('--title', title);
  }
  if (flags.has('--body-file')) out.push('--body-file', readBody(/** @type {string} */ (flags.get('--body-file')), issue, true));
  requireTwin(issue, number);
  process.stdout.write(skills(out));
}

/** @param {string} issue @param {string[]} args */
function cmdComment(issue, args) {
  if (!args.length) throw new Refused("skills-comment needs the twin's number");
  const number = args[0];
  const flags = parseFlags(args.slice(1), new Set(['--body-file']));
  if (!flags.has('--body-file')) throw new Refused('skills-comment needs --body-file');
  const body = readBody(/** @type {string} */ (flags.get('--body-file')), issue, false);
  requireTwin(issue, number);
  process.stdout.write(skills(['issue', 'comment', number, '--body-file', body]));
}

/** @param {string} issue @param {string[]} args @param {'close' | 'reopen'} want */
function cmdState(issue, args, want) {
  const number = oneNumber(args);
  const state = get(mhwIssueJson(issue), 'state', '');
  const shown = truthy(state) ? pyStr(state) : 'unreadable';
  if (want === 'close' && state !== 'CLOSED') throw new Refused('the mhw Issue is ' + shown + ', so its twin stays open');
  if (want === 'reopen' && state !== 'OPEN') throw new Refused('the mhw Issue is ' + shown + ', so its twin stays closed');
  requireTwin(issue, number);
  process.stdout.write(skills(['issue', want, number]));
}

/**
 * The sync job's post-condition, run after the agent: a twin exists and its state is the mhw Issue's.
 * Exit 1 otherwise, so an agent that stopped early, or was refused, turns the run red instead of green.
 * @param {string} issue
 * @param {string[]} args
 */
function cmdVerify(issue, args) {
  if (args.length) throw new Refused('verify takes no arguments');
  const mhwState = get(mhwIssueJson(issue), 'state', '');
  const twin = findTwin(issue);
  if (twin === null) {
    print('FAIL  ' + mhwUrl(issue) + ' has no twin in ' + SKILLS_REPO);
    throw new Exit(1);
  }
  if (!sameValue(twin.get('state'), mhwState)) {
    print('FAIL  the twin ' + pyStr(twin.get('url')) + ' is ' + pyStr(twin.get('state')) + ' while ' + mhwUrl(issue) + ' is ' + pyStr(mhwState));
    throw new Exit(1);
  }
  print('PASS  ' + pyStr(twin.get('url')) + ' mirrors ' + mhwUrl(issue) + ' (' + pyStr(mhwState) + ')');
}

/** Python == of two parsed scalars (the states gh reports are strings). @param {unknown} a @param {unknown} b */
function sameValue(a, b) {
  if (typeof a === 'string' || typeof b === 'string') return a === b;
  return dumps(a, { sortKeys: true }) === dumps(b, { sortKeys: true });
}

/** @param {string} issue @param {string[]} args */
function cmdBacklink(issue, args) {
  if (args.length) throw new Refused('backlink takes no arguments');
  const twin = findTwin(issue);
  if (twin === null) {
    // The backlink job runs only after a successful sync, so a missing twin is a failure, never a
    // green "nothing to link" (first canary, 2026-10-12).
    print('FAIL  no twin for ' + mhwUrl(issue) + '; nothing was linked');
    throw new Exit(1);
  }
  const comments = parse(gh(['issue', 'view', issue, '--repo', MHW_REPO, '--json', 'comments'], 'MHW_TOKEN'));
  const listed = asList(get(comments, 'comments', []));
  if (listed.some((c) => textOr(get(c, 'body')).includes(BACKLINK_MARKER) && BACKLINK_AUTHORS.has(authorLogin(c)))) {
    print('the back-link is already on ' + mhwUrl(issue));
    return;
  }
  const root = process.env.MHW_SYNC_DIR || '';
  if (!root || !isDir(root)) throw new Refused('MHW_SYNC_DIR is not a directory');
  const file = path.join(root, 'backlink-' + issue + '.md');
  const number = pyStr(twin.get('number'));
  fs.writeFileSync(file, BACKLINK_MARKER + SKILLS_REPO + '#' + number + ' -->\nMirrored to ' + SKILLS_REPO + ' as '
    + pyStr(twin.get('url')) + ' (method backlog sync, #62).\n', 'utf8');
  process.stdout.write(gh(['issue', 'comment', issue, '--repo', MHW_REPO, '--body-file', file], 'MHW_TOKEN'));
}

/**
 * (sync job, before the agent) write STASHED from the environment into the input directory, 0600.
 * Refuses when the directory already holds a file, so it cannot be used to replace an input; and when the
 * directory is inside MHW_SYNC_DIR, where the agent's Write tool reaches.
 * @param {string[]} args
 */
function cmdStashInputs(args) {
  if (args.length) throw new Refused('stash-inputs takes no arguments');
  const folder = inputDir();
  if (!folder) throw new MissingInput('MISSING-INPUT MHW_INPUT_DIR: neither it nor RUNNER_TEMP is set');
  /** @type {Map<string, string>} */
  const values = new Map();
  for (const name of STASHED) {
    const value = process.env[name] || '';
    if (!value) throw new MissingInput('MISSING-INPUT ' + name + ': stash-inputs reads it from the environment');
    values.set(name, value);
  }
  const syncRoot = pyRealpath(/** @type {string} */ (values.get('MHW_SYNC_DIR')));
  if (within(syncRoot, pyRealpath(folder))) throw new Refused('the input directory must not be inside MHW_SYNC_DIR');
  // os.makedirs(folder, mode=0o700, exist_ok=True): the parents with the default mode, the leaf 0700.
  fs.mkdirSync(path.dirname(path.resolve(folder)), { recursive: true });
  try {
    fs.mkdirSync(folder, 0o700);
  } catch (e) {
    if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST' || !isDir(folder)) throw e;
  }
  fs.chmodSync(folder, 0o700);
  if (fs.readdirSync(folder).length) throw new Refused('the input directory is not empty; nothing was replaced');
  for (const [name, value] of values) {
    const fd = fs.openSync(path.join(folder, name), fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL, 0o600);
    try {
      fs.writeSync(fd, value, null, 'utf8');
    } finally {
      fs.closeSync(fd);
    }
  }
  print('stashed ' + values.size + ' inputs in the input directory');
}

/**
 * (sync job, after the agent) print the model's final result, never the tool input or output. Reads the
 * action's execution file (a JSON list of SDK messages) and prints, from its last `result` message only:
 * subtype, turns, is_error, the count of permission denials, and the `result` text, capped. Exit 0 whatever
 * it finds: it reports, the verify step decides.
 * @param {string[]} args
 */
function cmdFinalLine(args) {
  if (args.length !== 1) throw new Refused("final-line takes the execution file's path");
  let messages;
  try {
    messages = loads(readText(args[0]), { ordered: true });
  } catch {
    print('final-line: no readable execution file');
    return;
  }
  const results = Array.isArray(messages) ? messages.filter((m) => isMap(m) && m.get('type') === 'result') : [];
  if (!results.length) {
    print('final-line: the execution file holds no result message');
    return;
  }
  const last = /** @type {Map<string, unknown>} */ (results.at(-1));
  // The SDK result carries a list; the action's own log line carries permission_denials_count.
  /** @type {unknown} */
  let denials = last.get('permission_denials_count');
  if (!isInt(denials)) {
    const listed = last.get('permission_denials');
    denials = Array.isArray(listed) ? listed.length : '?';
  }
  /** @param {string} k */
  const field = (k) => pyStr(last.has(k) ? last.get(k) : '?');
  print('subtype: ' + field('subtype') + '  turns: ' + field('num_turns') + '  is_error: ' + field('is_error')
    + '  permission_denials: ' + pyStr(denials));
  const result = last.get('result');
  let text = codePoints(truthy(result) ? pyStr(result) : '(none)');
  let shown = text.join('');
  if (text.length > MAX_RESULT_CHARS) {
    text = text.slice(0, MAX_RESULT_CHARS);
    shown = text.join('') + ' [cut at ' + MAX_RESULT_CHARS + ' characters]';
  }
  try {
    checkSecrets(shown, 'result');
  } catch (e) {
    if (!(e instanceof Refused)) throw e;
    shown = '(withheld: the result text carries something shaped like a credential)';
  }
  print('result: ' + shown);
}

// Commands that run before an Issue is known or without one.
/** @type {Record<string, (args: string[]) => void>} */
const NO_ISSUE_COMMANDS = { 'stash-inputs': cmdStashInputs, 'final-line': cmdFinalLine };

/** @type {Record<string, (issue: string, args: string[]) => void>} */
const COMMANDS = {
  'mhw-view': cmdMhwView,
  'find-twin': cmdFindTwin,
  'skills-view': cmdView,
  'skills-create': cmdCreate,
  'skills-edit': cmdEdit,
  'skills-comment': cmdComment,
  'skills-close': (issue, args) => cmdState(issue, args, 'close'),
  'skills-reopen': (issue, args) => cmdState(issue, args, 'reopen'),
  verify: cmdVerify,
  backlink: cmdBacklink,
};

/** The commands, so the workflow's prompt can be held to them. */
export const COMMAND_NAMES = [...Object.keys(COMMANDS), ...Object.keys(NO_ISSUE_COMMANDS)];

/** @param {string[]} argv @returns {number} the exit code */
export function main(argv) {
  if (!argv.length || (!Object.hasOwn(COMMANDS, argv[0]) && !Object.hasOwn(NO_ISSUE_COMMANDS, argv[0]))) {
    process.stderr.write(USAGE);
    return 2;
  }
  try {
    if (Object.hasOwn(NO_ISSUE_COMMANDS, argv[0])) NO_ISSUE_COMMANDS[argv[0]](argv.slice(1));
    else COMMANDS[argv[0]](envIssue(), argv.slice(1));
  } catch (e) {
    if (e instanceof Exit) return e.code;
    if (e instanceof Refused) {
      process.stderr.write('REFUSED  ' + e.message + '\n');
      return e instanceof MissingInput ? 3 : 2;
    }
    // An input gh never gives (a reply that is not JSON, or not the shape asked for): no traceback, exit 1.
    process.stderr.write('method-issue-sync: ' + (e instanceof Error ? e.message : String(e)) + '\n');
    return 1;
  }
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
