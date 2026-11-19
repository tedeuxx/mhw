// mhw funnel-review (#478, S07 of #470): the Node form of method/scripts/funnel-review.sh, which this slice
// deletes. It is the ANALYSIS half of the content-funnel rite (#401): a report writer over a committed
// collection file.
//
//   mhw funnel-review <period> [--root <dir>]
//
// It reads no network, holds no credential and reaches no external surface: every figure it prints was
// put in the collection file by whoever read those surfaces. It returns no verdict, gates nothing, writes
// no file, and every exit path but a caller error is success. The one external program it runs is git, a
// LOCAL read (`rev-parse`), found on PATH and run by absolute path (src/lib/onpath.js); with no git the
// root is the working directory and the commit is `unknown`, as the shell original did.
//
// Two states print DIFFERENT literals at column 0, and neither is a substring of the other:
//   FUNNEL-REVIEW-NOT-COLLECTED   nothing was read. There is no findings section at all.
//   FUNNEL-REVIEW-RAN             the surfaces were read. The findings section exists, and may say it is
//                                 empty; an empty section that says so is a result.
//
// What it cannot do: tell a TRUE collection file from a plausible one (`collected: yes` is an assertion by
// whoever wrote the file), fire (nothing dispatches the rite), or count findings in prose (the cap is
// printed; the check over LANDED reports is test/method/funnel-review.test.js).
//
// The collection file it reads is declared in method/scripts/funnel-review-contract/README.md. The same
// bytes and exit codes as the shell original, on the cases of its own suite (test/golden/S07); the
// differences are listed in test/golden/S07/expected-differences.json. node: modules only.
import fs from 'node:fs';
import path from 'node:path';
import { onPath } from '../lib/onpath.js';
import { runAbsolute } from '../lib/run.js';

// The cap, as a NUMBER. Two and not three: a rite producing three items per period is a machine for
// generating work. The cap is the ceiling, never a quota.
export const MAX_FINDINGS = 2;

export const USAGE = 'usage: mhw funnel-review <period> [--root <dir>]\n';

// The shell's word splitting (default IFS) and awk's default field splitting: space, tab, newline.
const BLANKS = /[ \t\n]+/;
// sed's and grep's [[:space:]]: space, tab, newline, vertical tab, form feed, carriage return.
const SPACE = '[ \\t\\n\\v\\f\\r]';
const COLLECTED_RE = new RegExp('^collected:' + SPACE + '+([^\\n]+)$');
const INTERNAL_RE = new RegExp('^internal-traffic:' + SPACE + '+([^\\n]+)$');
const FIGURE_RE = new RegExp('^figure:' + SPACE);
// awk's strnum: a field (or an ENVIRON value) that looks like a number compares numerically.
const AWK_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

// The consent ceiling rides with EVERY figure. It is surface-aware, the vocabulary is closed, and the
// default REFUSES: an unknown surface gets UNDECLARED rather than a claim nothing here can know.
/** @param {string} surface */
function ceilingFor(surface) {
  if (surface === 'ga4' || surface === 'site') {
    return 'consent-ceiling: consenting sessions only — the consent banner gates analytics on this site, so a reader who declined is invisible by design';
  }
  if (surface === 'linkedin' || surface === 'x') {
    return 'consent-ceiling: does not apply to ' + surface + ' — this figure is platform-reported, the consent banner gates nothing there, and the platform\'s own sampling is unstated and unverifiable from here';
  }
  return 'consent-ceiling: UNDECLARED for surface ' + surface + ' — it is not in this store\'s closed surface vocabulary, so nothing here knows whether a consent gate applies to it. Read the figure as unbounded, and declare the surface before quoting it';
}

// The language caveat (#181): a metric spelled <metric>:<piece>:<language>, exactly three non-empty parts.
const LOCALE_CAVEAT = 'locale-caveat: a link pinned to one language sets this value by the link, not by the reader';
/** @param {string} metric */
function caveatFor(metric) {
  const parts = metric.split(':');
  return parts.length === 3 && parts.every((p) => p !== '') ? ' · ' + LOCALE_CAVEAT : '';
}

const INTERNAL_UNDECLARED = 'internal-traffic: UNDECLARED — figures may include the owner\'s own sessions';
const INTERNAL_STATES = new Set(['none', 'testing-excluded-by-query', 'active']);

/**
 * bash's `read -r a b c <<< "$s"` with the default IFS: the first two fields, and the rest of the line
 * with its leading and trailing blanks removed.
 * @param {string} s
 * @returns {[string, string, string]}
 */
function read3(s) {
  let rest = s.replace(/^[ \t\n]+/, '');
  const out = /** @type {string[]} */ ([]);
  for (let i = 0; i < 2; i++) {
    const m = /^([^ \t\n]*)[ \t\n]*/.exec(rest);
    out.push(m ? m[1] : '');
    rest = rest.slice(m ? m[0].length : rest.length);
  }
  out.push(rest.replace(/[ \t\n]+$/, ''));
  return /** @type {[string, string, string]} */ (out);
}

/**
 * The first capture of re over the file's lines (sed -n 's/re/\1/p' | head -1), or ''.
 * @param {string[]} lines
 * @param {RegExp} re
 */
function firstMatch(lines, re) {
  for (const line of lines) {
    const m = re.exec(line);
    if (m) return m[1];
  }
  return '';
}

/**
 * @param {string} decl the file's internal-traffic declaration, or ''
 */
function internalTrafficLine(decl) {
  const [state, date, how] = read3(decl);
  if (INTERNAL_STATES.has(state) && date !== '' && how !== '') return 'internal-traffic: ' + decl;
  if (decl !== '') {
    return INTERNAL_UNDECLARED + ' (the file declares \'' + decl + '\', which is not <none|testing-excluded-by-query|active> <effective-date> <how>)';
  }
  return INTERNAL_UNDECLARED;
}

/** awk's `==` between a field and an ENVIRON value. @param {string} a @param {string} b */
function awkEqual(a, b) {
  if (AWK_NUMBER.test(a) && AWK_NUMBER.test(b)) return Number(a) === Number(b);
  return a === b;
}

/** @param {string} a @param {string} b strcmp order, as the test builtin's `<` */
function byteLess(a, b) {
  return Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')) < 0;
}

/**
 * @typedef {{ cwd: string, env: Record<string, string | undefined>, out: (s: string) => void,
 *   err: (s: string) => void, git?: string | null }} Io
 */

/**
 * The report for one period. Returns the exit code.
 * @param {string[]} argv
 * @param {Io} io
 * @returns {number}
 */
export function run(argv, io) {
  const period = argv[0] ?? '';
  if (period === '-h' || period === '--help') {
    io.out(USAGE);
    return 0;
  }
  if (period === '') {
    io.err(USAGE);
    return 2;
  }
  let root = '';
  for (let i = 1; i < argv.length;) {
    if (argv[i] === '--root') {
      // The shell's `shift 2 || exit 2`: --root with no value after it is a silent exit 2.
      if (i + 1 >= argv.length) return 2;
      root = argv[i + 1];
      i += 2;
    } else {
      io.err('unknown argument: ' + argv[i] + '\n');
      return 2;
    }
  }

  const git = io.git === undefined ? onPath('git', io.env) : io.git;
  /** A command substitution of `git <args>`: its stdout with trailing newlines removed, any exit code. */
  const gitOut = (/** @type {string[]} */ args) => {
    if (!git) return '';
    const r = runAbsolute(git, args, { cwd: io.cwd, env: io.env });
    return r.stdout.replace(/\n+$/, '');
  };
  // A path as the shell sees it: relative to the working directory, never normalised (the kernel resolves
  // `..` and links the way it did for the shell).
  const abs = (/** @type {string} */ p) => (path.isAbsolute(p) ? p : io.cwd + path.sep + p);
  const readable = (/** @type {string} */ p) => {
    try {
      fs.accessSync(abs(p), fs.constants.R_OK);
      return true;
    } catch {
      return false;
    }
  };
  const lines = (/** @type {string} */ p) => {
    try {
      const text = fs.readFileSync(abs(p), 'utf8');
      const ls = text.split('\n');
      if (ls.length && ls[ls.length - 1] === '') ls.pop();
      return ls;
    } catch {
      return [];
    }
  };

  if (root === '') {
    // mhw #170: the default root is the repository of the WORKING DIRECTORY, never the command's own place.
    root = gitOut(['rev-parse', '--show-toplevel']);
    if (root === '') root = io.cwd;
  }
  const collectedDir = root + '/docs/funnel-review/collected';
  const collection = collectedDir + '/' + period + '.tsv';
  const sha = gitOut(['-C', root, 'rev-parse', 'HEAD']) || 'unknown';

  const o = /** @type {string[]} */ ([]);
  const isReadable = readable(collection);
  const body = isReadable ? lines(collection) : [];
  o.push('# ' + period + ' — funnel review\n\n');
  o.push('commit: ' + sha + '\n');
  o.push('collection: ' + (collection.startsWith(root + '/') ? collection.slice(root.length + 1) : collection) + '\n');
  o.push('cap: ' + MAX_FINDINGS + ' findings, the ceiling and not a quota\n');
  o.push(internalTrafficLine(isReadable ? firstMatch(body, INTERNAL_RE) : '') + '\n\n');

  const declared = isReadable ? firstMatch(body, COLLECTED_RE) : '';
  let reason = '';
  if (!isReadable) reason = 'no collection file at that path';
  else if (declared.startsWith('yes')) reason = '';
  else if (declared.startsWith('no')) reason = 'the collection file declares \'collected: ' + declared + '\'';
  else reason = 'the collection file declares no \'collected:\' line at column 0, so it asserts nothing about whether the surfaces were read';

  if (reason) {
    o.push('FUNNEL-REVIEW-NOT-COLLECTED\n\n');
    o.push('Nothing was read this period. Reason: ' + reason + '\n\n');
    o.push('This is NOT "the funnel is healthy" and it is NOT "no findings". No surface was reached,\n');
    o.push('so this report makes no claim about the funnel at all. The collection route is the owner\'s\n');
    o.push('own authenticated browser (owner ruling, 2026-09-10); with no authenticated session there is\n');
    o.push('nothing to read, and nothing in this harness can open one.\n\n');
    o.push('There is deliberately no findings section below — a findings section that is absent and one\n');
    o.push('that is empty are different claims, and only the second means the surfaces were read.\n');
    io.out(o.join(''));
    return 0;
  }

  o.push('FUNNEL-REVIEW-RAN\n\n');
  o.push('The surfaces were read and this report is the analysis of what came back. Every figure below\n');
  o.push('carries its sample size and its consent ceiling; a figure that arrived without a sample size is\n');
  o.push('listed as unusable rather than printed as a figure.\n\n');

  // The prior period: the greatest collected period name below this one, in byte order (the shell's
  // `[ a \< b ]`). Lexical rather than chronological on purpose: period names are sortable by construction.
  let prior = '';
  let names = /** @type {string[]} */ ([]);
  try {
    names = fs.readdirSync(abs(collectedDir));
  } catch {
    names = [];
  }
  for (const name of names) {
    // The glob `*.tsv`: no leading dot, the suffix in this case.
    if (name.startsWith('.') || !name.endsWith('.tsv') || name.length <= 4) continue;
    if (!readable(collectedDir + '/' + name)) continue;
    const b = name.slice(0, -4);
    if (b === period) continue;
    if (byteLess(b, period) && (prior === '' || byteLess(prior, b))) prior = b;
  }
  const priorLines = prior ? lines(collectedDir + '/' + prior + '.tsv') : [];

  o.push('## Figures\n\n');
  let figures = 0;
  let unusable = '';
  for (const line of body) {
    if (!FIGURE_RE.test(line)) continue;
    // `${line#figure: }`, then word splitting with pathname expansion OFF: a `*` or `?` stays literal.
    const rest = line.startsWith('figure: ') ? line.slice('figure: '.length) : line;
    const f = rest.split(BLANKS).filter((w) => w !== '');
    if (f.length < 4) {
      unusable += '\n- ' + line;
      continue;
    }
    const [surface, metric, value, n] = f;
    if (!/^[0-9]+$/.test(n)) {
      unusable += '\n- ' + line + '   (sample size is not a number)';
      continue;
    }
    let delta = 'no prior period on record';
    if (prior) {
      // LITERAL comparison of surface and metric (#181), as awk compares a field with an ENVIRON value.
      let pv = null;
      for (const pl of priorLines) {
        if (!FIGURE_RE.test(pl)) continue;
        const pf = pl.split(BLANKS).filter((w) => w !== '');
        if (pf.length >= 5 && awkEqual(pf[1], surface) && awkEqual(pf[2], metric)) {
          pv = [pf[3], pf[4]];
          break;
        }
      }
      delta = pv ? 'prior ' + prior + ' = ' + pv[0] + ' (n=' + pv[1] + ')' : 'not measured in ' + prior;
    }
    o.push('- ' + surface + ' · ' + metric + ' = ' + value + ' · n=' + n + ' · ' + delta + ' · ' + ceilingFor(surface) + caveatFor(metric) + '\n');
    figures += 1;
  }
  if (figures === 0) {
    o.push('None. The surfaces were read and returned no usable figure — which is a result, and is not\n');
    o.push('the same as not having read them.\n');
  }
  o.push('\n');

  if (unusable) {
    o.push('## Unusable collection lines\n\n');
    o.push('A line here is NOT a figure and must not be quoted as one. It arrived without a sample size,\n');
    o.push('or with one that is not a number, and this repository publishes no figure without its n.\n');
    o.push(unusable + '\n\n');
  }

  o.push('## Findings\n\n');
  o.push('At most ' + MAX_FINDINGS + ', the driver choosing which. Each: what the numbers show · the figure that shows it ·\n');
  o.push('what it costs · the change proposed, or the price of leaving it. An empty section that says it\n');
  o.push('is empty is a result; write "None this period" rather than deleting the heading.\n\n');
  // The candidate-rule shape (#473) rides only on the branch that has findings. It is indented on purpose:
  // the planning queue reads COLUMN-0 lines, so this template can never be counted as an open candidate.
  o.push('A finding MAY carry a candidate rule for published-voice, in this shape, and only when every\n');
  o.push('evidence line is a figure: line quoted verbatim from a committed collection file:\n\n');
  o.push('    Candidate rule: <one sentence, in the ruler\'s own register>\n');
  o.push('    Evidence: <figure: line(s), verbatim, n included>\n\n');
  o.push('A candidate is not a ruling. It reaches published-voice only if the owner rules on it.\n');
  o.push('Write both lines at column 0. The candidate then waits here, open, until /sprint-planning\n');
  o.push('writes a Ruled: line under it (skills/funnel-review/SKILL.md step 4).\n\n');

  o.push('## What I would leave alone\n\n');
  o.push('---\n\n');
  o.push('This rite returns no verdict and gates nothing. It produces observations for the owner and\n');
  o.push('nothing else — the same constraint `/sprint-review` carries, for the same reason: marketing\n');
  o.push('judgement has no ruler, and a gate with no ruler grades taste.\n');
  o.push('Nothing here files an Issue. Only the owner opens work.\n');
  io.out(o.join(''));
  return 0;
}

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @returns {number}
 */
export function main(argv, env) {
  return run(argv, {
    cwd: process.cwd(),
    env,
    out: (s) => process.stdout.write(s),
    err: (s) => process.stderr.write(s),
  });
}
