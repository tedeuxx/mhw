// mhw milestone read|create|update|close (#475, S04 of #470; the routes of #537): the Node form of
// method/scripts/milestone-{read,create,update,close}.py and milestone_common.py, which this slice
// deletes. gh has no milestone subcommand, so each verb calls the milestone endpoint through `gh api`.
//
//   mhw milestone read   <number> [--repo <owner>/<repo>]
//   mhw milestone create <title>  [--repo <owner>/<repo>] [--description-file <path>]
//   mhw milestone update <number> [--repo <owner>/<repo>] --description-file <path> --expect-file <path>
//   mhw milestone close  <number> [--repo <owner>/<repo>]
//
// THE WRITE VERBS WORK BECAUSE A HOLE IS OPEN. Neither the permission matcher nor the deny floor reads
// inside this program, so create, update and close reach the forge's write API although "gh api" writes
// are denied as a command prefix. These are reviewed, single-purpose routes; they do not mean the raw-API
// route is closed. A description arrives by file only, never inline: tracker text can hold shell syntax,
// and the shorter unsafe form must not exist for a later caller to choose.
//
// update's prior-text check is a preflight before an unconditional PATCH, not compare-and-swap: it
// refuses a value already stale when read and can overwrite a write landing after that read.
//
// The same output as the Python routes (sorted keys, two-space indent, non-ASCII as is), the same gh
// argv, the same refusals and exit codes (1 for a refusal or a gh failure); test/method/milestone.test.js
// holds that against the Python originals' golden transcripts. Intended differences are listed in
// test/golden/S04/expected-differences.json. gh is found on PATH, as the Python did, and run by absolute
// path with no shell. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { runAbsolute } from '../lib/run.js';
import { onPath } from '../lib/onpath.js';
import { confined, ConfineError } from '../lib/confine.js';

// mhw #170 (Sonar S8705): a repository or a number shaped like a flag never reaches the gh argv.
const REPO_RE = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
const INT_RE = /^\s*[+-]?\d+(?:_\d+)*\s*$/;
export const VERBS = ['read', 'create', 'update', 'close'];
const USAGE = {
  read: 'mhw milestone read <number> [--repo <owner>/<repo>]',
  create: 'mhw milestone create <title> [--repo <owner>/<repo>] [--description-file <path>]',
  update: 'mhw milestone update <number> [--repo <owner>/<repo>] --description-file <path> --expect-file <path>',
  close: 'mhw milestone close <number> [--repo <owner>/<repo>]',
};
/** @type {Record<string, string[]>} */
const OPTIONS = {
  read: ['--repo'],
  create: ['--repo', '--description-file'],
  update: ['--repo', '--description-file', '--expect-file'],
  close: ['--repo'],
};

export class MilestoneError extends Error {}
class UsageError extends Error {}

/**
 * @typedef {{ code: number, stdout: string, stderr: string, error?: Error }} GhResult
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, platform?: string,
 *   out: (s: string) => void, err: (s: string) => void, gh?: (args: string[]) => GhResult }} Io
 */

/**
 * gh with the arguments, found on PATH and run by absolute path; its stdout, or a MilestoneError.
 * @param {Io} io
 * @param {string[]} args
 */
function runGh(io, args) {
  let r;
  if (io.gh) {
    r = io.gh(args);
  } else {
    const gh = onPath('gh', io.env, io.platform);
    if (!gh) throw new MilestoneError('gh failed: gh was not found on PATH');
    r = runAbsolute(gh, args, { cwd: io.cwd, env: io.env });
  }
  if (r.error) throw new MilestoneError('gh failed: ' + r.error.message);
  if (r.code) {
    const detail = r.stderr.trim() || r.stdout.trim() || 'exit ' + r.code;
    throw new MilestoneError('gh failed: ' + detail);
  }
  return r.stdout;
}

/** @param {string} repo */
export function checkRepo(repo) {
  if (!REPO_RE.test(repo || '') || repo.startsWith('-') || repo.split('/').some((p) => /^\.+$/.test(p))) {
    throw new MilestoneError("the repository must be <owner>/<repo>, letters, digits, '.', '_' and '-' only");
  }
  return repo;
}

/** @param {number} n */
export function checkNumber(n) {
  if (!Number.isSafeInteger(n) || n < 1) throw new MilestoneError('the milestone number must be a positive integer');
  return n;
}

/**
 * @param {Io} io
 * @param {string | undefined} repo
 */
function resolveRepo(io, repo) {
  // An empty --repo resolves from the checkout, as Python's `if repo:` did.
  if (repo) return checkRepo(repo);
  const value = runGh(io, ['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner']).trim();
  if (!value) throw new MilestoneError('gh returned an empty repository; pass --repo <owner>/<repo>');
  return checkRepo(value);
}

/**
 * @param {string} raw
 * @param {string} operation
 * @returns {any}
 */
function parseJson(raw, operation) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch (e) {
    throw new MilestoneError('gh returned invalid JSON while ' + operation + ': ' + (e instanceof Error ? e.message : String(e)));
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new MilestoneError('gh returned a non-object while ' + operation);
  }
  return value;
}

/**
 * @param {Io} io
 * @param {string} repo
 * @param {number} number
 */
function readMilestone(io, repo, number) {
  const value = parseJson(runGh(io, ['api', 'repos/' + checkRepo(repo) + '/milestones/' + checkNumber(number)]), 'reading the milestone');
  const missing = ['number', 'title', 'description', 'state', 'open_issues', 'closed_issues'].filter((f) => !Object.hasOwn(value, f));
  if (missing.length) throw new MilestoneError('gh milestone response is missing: ' + missing.join(', '));
  return value;
}

/**
 * @param {Io} io
 * @param {string} repo
 * @param {number} number
 * @param {Record<string, string>} fields
 */
function updateMilestone(io, repo, number, fields) {
  const args = ['api', 'repos/' + checkRepo(repo) + '/milestones/' + checkNumber(number), '-X', 'PATCH'];
  for (const [k, v] of Object.entries(fields)) args.push('-f', k + '=' + v);
  return parseJson(runGh(io, args), 'updating the milestone');
}

/**
 * The text of a file the caller wrote, confined first (mhw #170, Sonar S8707: it is posted to the
 * forge). Read as Python's Path.read_text did: UTF-8, a byte-order mark kept, CRLF and CR read as LF;
 * then one terminal LF dropped, which a text file carries and GitHub's description value does not.
 * @param {Io} io
 * @param {string} p
 * @param {string} purpose
 */
function textFromFile(io, p, purpose) {
  let real;
  try {
    real = confined(p, io);
  } catch (e) {
    if (e instanceof ConfineError) throw new MilestoneError(purpose + ' file: ' + e.message);
    throw e;
  }
  let value;
  try {
    const bytes = fs.readFileSync(real);
    value = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch (e) {
    throw new MilestoneError('cannot read ' + purpose + ' file ' + p + ': ' + (e instanceof Error ? e.message : String(e)));
  }
  value = value.replace(/\r\n?/g, '\n');
  return value.endsWith('\n') ? value.slice(0, -1) : value;
}


/**
 * Every object's keys sorted, recursively, as Python's json.dumps(sort_keys=True) orders them.
 * @param {unknown} v
 * @returns {unknown}
 */
function sortKeys(v) {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === 'object') {
    /** @type {Record<string, unknown>} */
    const out = {};
    for (const k of Object.keys(v).sort()) out[k] = sortKeys(/** @type {Record<string, unknown>} */ (v)[k]);
    return out;
  }
  return v;
}

/**
 * @param {Io} io
 * @param {unknown} value
 */
function printJson(io, value) {
  io.out(JSON.stringify(sortKeys(value), null, 2) + '\n');
}

/**
 * The verb's arguments, argparse-like: one positional, the verb's options as `--opt value` or
 * `--opt=value` (the last one wins), `--` ending the options, and -h/--help. Unlike argparse, an
 * abbreviated option is not accepted.
 * @param {string} verb
 * @param {string[]} argv
 * @returns {{ help: boolean, positional?: string, opts: Record<string, string> }}
 */
export function parseArgs(verb, argv) {
  /** @type {Record<string, string>} */
  const opts = {};
  /** @type {string | undefined} */
  let positional;
  let ended = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const isOption = !ended && a.startsWith('-') && a !== '-' && !/^-\d/.test(a);
    if (!ended && a === '--') {
      ended = true;
    } else if (isOption && (a === '-h' || a === '--help')) {
      return { help: true, opts };
    } else if (isOption) {
      const eq = a.indexOf('=');
      const name = eq > 0 ? a.slice(0, eq) : a;
      if (!OPTIONS[verb].includes(name)) throw new UsageError('unrecognized argument: ' + a);
      if (eq > 0) opts[name] = a.slice(eq + 1);
      else if (i + 1 < argv.length && !(argv[i + 1].startsWith('-') && !/^-\d/.test(argv[i + 1]))) opts[name] = argv[++i];
      else throw new UsageError('argument ' + name + ': expected one argument');
    } else if (positional === undefined) {
      positional = a;
    } else {
      throw new UsageError('unrecognized argument: ' + a);
    }
  }
  if (positional === undefined) throw new UsageError('the following argument is required: ' + (verb === 'create' ? 'title' : 'number'));
  if (verb === 'update') {
    const missing = ['--description-file', '--expect-file'].filter((o) => !Object.hasOwn(opts, o));
    if (missing.length) throw new UsageError('the following arguments are required: ' + missing.join(', '));
  }
  return { help: false, positional, opts };
}

/** Python's int() over a decimal string, refused beyond JavaScript's safe integers. @param {string} s */
function toInt(s) {
  if (!INT_RE.test(s)) throw new UsageError("argument number: invalid int value: '" + s + "'");
  const n = Number(s.trim().replace(/_/g, ''));
  if (!Number.isSafeInteger(n)) throw new MilestoneError('the milestone number must be a positive integer');
  return n;
}

/**
 * @param {Io} io
 * @param {string} verb
 * @param {{ positional?: string, opts: Record<string, string> }} a
 */
function execute(io, verb, a) {
  const pos = /** @type {string} */ (a.positional);
  const repoOpt = a.opts['--repo'];
  if (verb === 'read') {
    const number = toInt(pos);
    const repo = resolveRepo(io, repoOpt);
    const m = readMilestone(io, repo, number);
    printJson(io, {
      number: m.number, title: m.title, description: m.description, state: m.state,
      open_issues: m.open_issues, closed_issues: m.closed_issues, repository: repo,
    });
  } else if (verb === 'create') {
    const repo = resolveRepo(io, repoOpt);
    let pages;
    const raw = runGh(io, ['api', 'repos/' + repo + '/milestones?state=all&per_page=100', '--paginate', '--slurp']);
    try {
      pages = JSON.parse(raw);
    } catch (e) {
      throw new MilestoneError('gh returned invalid JSON while listing milestones: ' + (e instanceof Error ? e.message : String(e)));
    }
    if (!Array.isArray(pages) || pages.some((p) => !Array.isArray(p))) throw new MilestoneError('gh returned an invalid milestone list');
    const isObj = (/** @type {unknown} */ x) => x !== null && typeof x === 'object' && !Array.isArray(x);
    if (pages.some((page) => page.some((/** @type {any} */ item) => isObj(item) && item.title === pos))) {
      throw new MilestoneError('a milestone titled "' + pos + '" already exists in ' + repo);
    }
    const command = ['api', 'repos/' + repo + '/milestones', '-X', 'POST', '-f', 'title=' + pos];
    const descFile = a.opts['--description-file'];
    // Python's `if arguments.description_file:` skipped an empty value.
    if (descFile) command.push('-f', 'description=' + textFromFile(io, descFile, 'description'));
    const created = parseJson(runGh(io, command), 'creating the milestone');
    printJson(io, { action: 'created', repository: repo, milestone: created });
  } else if (verb === 'update') {
    const number = toInt(pos);
    const repo = resolveRepo(io, repoOpt);
    const current = readMilestone(io, repo, number);
    const expected = textFromFile(io, a.opts['--expect-file'], 'expected-description');
    const currentDescription = current.description || '';
    if (currentDescription !== expected) throw new MilestoneError('milestone description was already stale when read; refusing to overwrite');
    const description = textFromFile(io, a.opts['--description-file'], 'description');
    const updated = updateMilestone(io, repo, number, { description });
    printJson(io, { action: 'updated-description', repository: repo, number, previous_description: currentDescription, milestone: updated });
  } else {
    const number = toInt(pos);
    const repo = resolveRepo(io, repoOpt);
    const current = readMilestone(io, repo, number);
    if (current.state !== 'open') throw new MilestoneError('milestone #' + number + ' is ' + current.state + '; refusing to close it again');
    const updated = updateMilestone(io, repo, number, { state: 'closed' });
    printJson(io, { action: 'closed', repository: repo, number, previous_state: current.state, milestone: updated });
  }
}

/**
 * mhw milestone <verb> ...: 0 on success, 1 on a refusal or a gh failure, 2 on a usage error.
 * @param {string[]} argv the arguments after "milestone"
 * @param {Io} io
 * @returns {number}
 */
export function run(argv, io) {
  const [verb, ...rest] = argv;
  if (!verb || verb === '-h' || verb === '--help') {
    io[verb ? 'out' : 'err'](['usage:', ...VERBS.map((v) => '  ' + USAGE[/** @type {keyof typeof USAGE} */ (v)])].join('\n') + '\n');
    return verb ? 0 : 2;
  }
  if (!VERBS.includes(verb)) {
    io.err('mhw milestone: unknown verb ' + JSON.stringify(verb) + ' (read, create, update, close)\n');
    return 2;
  }
  const usage = 'usage: ' + USAGE[/** @type {keyof typeof USAGE} */ (verb)] + '\n';
  try {
    const a = parseArgs(verb, rest);
    if (a.help) {
      io.out(usage);
      return 0;
    }
    execute(io, verb, a);
    return 0;
  } catch (e) {
    if (e instanceof UsageError) {
      io.err(usage + 'mhw milestone ' + verb + ': error: ' + e.message + '\n');
      return 2;
    }
    if (e instanceof MilestoneError) {
      io.err(e.message + '\n');
      return 1;
    }
    throw e;
  }
}

/**
 * The process form: the real working directory, environment and streams.
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 */
export function main(argv, env) {
  return run(argv, {
    cwd: path.resolve(process.cwd()),
    env,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
