// The release bump (#473, S02 of #470; ADR-0002): the Node replacement for bump-my-version 1.5.1 in
// .github/workflows/version-main.yml. It reads .bumpversion.toml (the file keeps that name until S32,
// because other readers parse it), bumps the part it is given, rewrites the configured files, and makes
// one commit and one annotated tag with the configured messages. On success it prints the new tag, and
// nothing else, on stdout.
//
//   node src/commands/release-bump.js major|minor|patch --git=/absolute/path/to/git [--repo=DIR]
//
// It produces the same commit message, tag name, tag message and file diff as bump-my-version 1.5.1 on
// this repository's configuration (test/release/bump.test.js holds that against golden transcripts).
// It is stricter where bump-my-version was lenient, each difference refusing before anything is written:
//   - a current version that is not exactly MAJOR.MINOR.PATCH is refused (bump-my-version 1.5.1 matched
//     the parse pattern as a prefix and dropped a suffix: "10.1.0-rc1" became "10.1.1");
//   - a tag that already exists is refused before the commit (bump-my-version committed, then failed);
//   - a configuration key it does not implement is refused, rather than silently ignored.
// git is run by the absolute path given, never looked up on PATH and never through a shell. node:
// modules and this repository's own files only.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseToml } from '../lib/toml.js';
import { runAbsolute } from '../lib/run.js';

export const PARTS = ['major', 'minor', 'patch'];
const CONFIG = '.bumpversion.toml';
const NUMERIC = /^(\d+)\.(\d+)\.(\d+)$/;
const TOP_KEYS = new Set(['current_version', 'parse', 'serialize', 'commit', 'tag', 'tag_name', 'message',
  'tag_message', 'allow_dirty', 'files']);
const FILE_KEYS = new Set(['filename', 'search', 'replace']);

export class Refusal extends Error {}

/**
 * Python str.format with named fields only, as bump-my-version uses it: {name} from ctx. Any other
 * brace form is refused, so a template this script does not understand never renders half-right.
 * @param {string} template
 * @param {Record<string, string>} ctx
 * @param {string} where
 */
export function format(template, ctx, where) {
  return template.replace(/\{([^{}]*)\}|[{}]/g, (m, name) => {
    if (name === undefined || !Object.hasOwn(ctx, name)) {
      throw new Refusal(where + ': unsupported placeholder ' + JSON.stringify(m) + ' in ' + JSON.stringify(template));
    }
    return ctx[name];
  });
}

/**
 * The [tool.bumpversion] table of the configuration text, validated against what this script implements.
 * @param {string} text
 */
export function readConfig(text) {
  const doc = parseToml(text, CONFIG);
  const cfg = doc.tool && doc.tool.bumpversion;
  if (!cfg || typeof cfg !== 'object') throw new Refusal(CONFIG + ': no [tool.bumpversion] table');
  for (const k of Object.keys(cfg)) {
    if (!TOP_KEYS.has(k)) throw new Refusal(CONFIG + ': unsupported key ' + k);
  }
  for (const k of ['current_version', 'parse', 'tag_name', 'message', 'tag_message']) {
    if (typeof cfg[k] !== 'string') throw new Refusal(CONFIG + ': ' + k + ' must be a string');
  }
  if (!Array.isArray(cfg.serialize) || cfg.serialize.length !== 1 || typeof cfg.serialize[0] !== 'string') {
    throw new Refusal(CONFIG + ': serialize must hold exactly one format');
  }
  if (cfg.commit !== true || cfg.tag !== true || cfg.allow_dirty !== false) {
    throw new Refusal(CONFIG + ': only commit = true, tag = true and allow_dirty = false are implemented');
  }
  const files = cfg.files === undefined ? [] : cfg.files;
  if (!Array.isArray(files)) throw new Refusal(CONFIG + ': files must be an array of tables');
  for (const f of files) {
    for (const k of Object.keys(f)) {
      if (!FILE_KEYS.has(k)) throw new Refusal(CONFIG + ': unsupported files key ' + k);
    }
    for (const k of FILE_KEYS) {
      if (typeof f[k] !== 'string' || !f[k]) throw new Refusal(CONFIG + ': every files entry needs ' + k);
    }
    if (path.isAbsolute(f.filename) || f.filename.split(/[\\/]/).includes('..')) {
      throw new Refusal(CONFIG + ': files entry outside the repository: ' + f.filename);
    }
  }
  return {
    current: /** @type {string} */ (cfg.current_version),
    parse: /** @type {string} */ (cfg.parse),
    serialize: /** @type {string} */ (cfg.serialize[0]),
    tagName: /** @type {string} */ (cfg.tag_name),
    message: /** @type {string} */ (cfg.message),
    tagMessage: /** @type {string} */ (cfg.tag_message),
    files: /** @type {Array<{ filename: string, search: string, replace: string }>} */ (files),
  };
}

/**
 * The next version: the current one parsed whole by the configured pattern and the numeric rule, the
 * part incremented, every lower part reset to 0, serialized with the configured format.
 * @param {ReturnType<typeof readConfig>} cfg
 * @param {string} part
 */
export function nextVersion(cfg, part) {
  if (!PARTS.includes(part)) throw new Refusal('unknown part ' + JSON.stringify(part) + '; use major, minor or patch');
  if (!NUMERIC.test(cfg.current)) {
    throw new Refusal('current_version ' + JSON.stringify(cfg.current) + ' is not a numeric MAJOR.MINOR.PATCH');
  }
  let re;
  try {
    // Python's named group (?P<name>...) is (?<name>...) in JavaScript. The match must cover the whole
    // version: bump-my-version accepted a prefix match.
    re = new RegExp('^(?:' + cfg.parse.replace(/\(\?P</g, '(?<') + ')$');
  } catch (e) {
    throw new Refusal(CONFIG + ': parse is not a valid pattern (' + (e instanceof Error ? e.message : String(e)) + ')');
  }
  const m = re.exec(cfg.current);
  const g = m && m.groups;
  if (!g || PARTS.some((p) => !/^\d+$/.test(g[p] || ''))) {
    throw new Refusal('current_version ' + JSON.stringify(cfg.current) + ' does not match parse as major, minor and patch');
  }
  const n = PARTS.map((p) => Number(g[p]));
  const i = PARTS.indexOf(part);
  const next = n.map((v, j) => (j < i ? v : j === i ? v + 1 : 0));
  /** @type {Record<string, string>} */
  const ctx = { major: String(next[0]), minor: String(next[1]), patch: String(next[2]) };
  const version = format(cfg.serialize, ctx, 'serialize');
  if (!NUMERIC.test(version)) throw new Refusal('serialize produced ' + JSON.stringify(version) + ', not MAJOR.MINOR.PATCH');
  return version;
}

/**
 * Every file change, computed in memory before anything is written: the configuration's own
 * current_version line, then each configured file with every occurrence of search replaced (Python's
 * str.replace). A search that is not found refuses, as bump-my-version did.
 * @param {string} repo
 * @param {string} configText
 * @param {ReturnType<typeof readConfig>} cfg
 * @param {string} next
 * @returns {Array<{ filename: string, before: string, after: string }>}
 */
export function plannedChanges(repo, configText, cfg, next) {
  const esc = cfg.current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const line = new RegExp('^(current_version[ \\t]*=[ \\t]*")' + esc + '"', 'gm');
  const hits = configText.match(line) || [];
  if (hits.length !== 1) throw new Refusal(CONFIG + ': expected one current_version line, found ' + hits.length);
  /** @type {Array<{ filename: string, before: string, after: string }>} */
  const changes = [{ filename: CONFIG, before: configText, after: configText.replace(line, '$1' + next + '"') }];
  const ctx = { current_version: cfg.current, new_version: next };
  for (const f of cfg.files) {
    const search = format(f.search, ctx, f.filename + ' search');
    const replace = format(f.replace, ctx, f.filename + ' replace');
    const prior = changes.find((c) => c.filename === f.filename);
    let before;
    try {
      before = prior ? prior.after : fs.readFileSync(path.join(repo, f.filename), 'utf8');
    } catch (e) {
      throw new Refusal('cannot read ' + f.filename + ' (' + (e instanceof Error ? e.message : String(e)) + ')');
    }
    if (!before.includes(search)) throw new Refusal('did not find ' + JSON.stringify(search) + ' in ' + f.filename);
    const after = before.split(search).join(replace);
    if (prior) prior.after = after;
    else changes.push({ filename: f.filename, before, after });
  }
  return changes;
}

/**
 * @param {string[]} argv
 * @returns {{ part: string, git: string, repo: string }}
 */
export function parseArgs(argv) {
  /** @type {string | undefined} */
  let part;
  let git = '';
  let repo = process.cwd();
  for (const a of argv) {
    if (a.startsWith('--git=')) git = a.slice('--git='.length);
    else if (a.startsWith('--repo=')) repo = path.resolve(a.slice('--repo='.length));
    else if (a.startsWith('-')) throw new Refusal('unknown option ' + a);
    else if (part === undefined) part = a;
    else throw new Refusal('one part only');
  }
  if (part === undefined) throw new Refusal('usage: release-bump.js major|minor|patch --git=/absolute/path/to/git [--repo=DIR]');
  if (!PARTS.includes(part)) throw new Refusal('unknown part ' + JSON.stringify(part) + '; use major, minor or patch');
  if (!git || !path.isAbsolute(git)) throw new Refusal('--git must name git by an absolute path');
  return { part, git, repo };
}

/**
 * The bump, end to end. Every refusal happens before the first write.
 * @param {{ part: string, git: string, repo: string, env?: Record<string, string | undefined> }} o
 * @returns {string} the new tag
 */
export function bump(o) {
  const env = o.env || process.env;
  /** @param {string[]} args @param {string} [input] @param {Record<string, string | undefined>} [extra] */
  const git = (args, input, extra) => {
    const r = runAbsolute(o.git, args, { cwd: o.repo, input, env: { ...env, ...extra } });
    if (r.code !== 0) {
      throw new Error('git ' + args.join(' ') + ' failed (' + r.code + '): ' + (r.error ? r.error.message : r.stderr.trim()));
    }
    return r.stdout;
  };
  let configText;
  try {
    configText = fs.readFileSync(path.join(o.repo, CONFIG), 'utf8');
  } catch (e) {
    throw new Refusal('cannot read ' + CONFIG + ' (' + (e instanceof Error ? e.message : String(e)) + ')');
  }
  const cfg = readConfig(configText);
  const next = nextVersion(cfg, o.part);
  // allow_dirty = false: bump-my-version's rule, git status --porcelain without untracked (??) lines.
  const dirty = git(['status', '--porcelain']).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('??'));
  if (dirty.length) throw new Refusal('git working directory is not clean:\n' + dirty.join('\n'));
  const ctx = { current_version: cfg.current, new_version: next };
  const tagName = format(cfg.tagName, ctx, 'tag_name');
  const message = format(cfg.message, ctx, 'message');
  const tagMessage = format(cfg.tagMessage, ctx, 'tag_message');
  const exists = runAbsolute(o.git, ['rev-parse', '--quiet', '--verify', 'refs/tags/' + tagName], { cwd: o.repo, env });
  if (exists.code === 0) throw new Refusal('tag ' + tagName + ' already exists');
  const changes = plannedChanges(o.repo, configText, cfg, next);
  for (const c of changes) fs.writeFileSync(path.join(o.repo, c.filename), c.after, 'utf8');
  git(['add', '--update', '--', ...changes.map((c) => c.filename)]);
  // The same commit command as bump-my-version (git commit -F), the message on stdin, and the same two
  // variables it exports to git hooks.
  git(['commit', '-F', '-'], message, { BUMPVERSION_CURRENT_VERSION: cfg.current, BUMPVERSION_NEW_VERSION: next });
  // bump-my-version ran `git tag <name> --message <msg>`, an annotated tag; -F - is the same tag with
  // the message on stdin, which keeps a non-ASCII message off the Windows command line.
  git(['tag', tagName, '-F', '-'], tagMessage);
  return tagName;
}

/** @param {string[]} argv */
export function main(argv) {
  try {
    const tag = bump(parseArgs(argv));
    process.stdout.write(tag + '\n');
    return 0;
  } catch (e) {
    const refused = e instanceof Refusal;
    process.stderr.write((refused ? 'REFUSE  ' : 'FAIL    ') + (e instanceof Error ? e.message : String(e)) + '\n');
    return refused ? 2 : 1;
  }
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
  process.exitCode = main(process.argv.slice(2));
}
