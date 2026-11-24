// The baseline's `gh api` rule set (Issue #593, ADR-0048, owner decisions of 2026-11-23): mhw renders the
// `gh api` rules itself, the same intent in Claude Code, Codex and Kiro, and retires the owner's hand-kept
// "Bash(gh api:*)" deny from the Claude Code user settings. The source is global/gh-api.conf, read here;
// src/render/allow-list.js renders it when run with --gh-api=<that file> (mhw install-user passes it
// whenever the file is beside the other sources). A tree without the file renders none of it, so the
// recorded transcripts whose frozen inputs predate it (test/golden/S19, S25) still apply unchanged.
//
// The intent: a `gh api` read is not denied; a write is denied, except to the allowed endpoint, which is
// pre-authorised. What a prefix rule can hold of that, per harness (ADR-0048, "What the rules hold"):
//
//   Claude Code  allow "Bash(gh api repos/*/milestones*)": the milestone family, read and write, in the
//                spelling the method skills use (the endpoint first, then -X). A wildcard crosses spaces
//                and slashes, so a write to another endpoint whose text carries "/milestones" after
//                "repos/" (a field value, say) matches it too.
//                deny the method-first write spellings. A deny beats an allow, so a milestone write spelled
//                method-first ("gh api -X PATCH repos/o/r/milestones/3") is denied: the skills spell the
//                endpoint first.
//   Codex        forbidden: the same method-first spellings. No allow: a prefix_rule token is exact, and
//                the owner, the repository and the milestone number vary, so a milestone call is left to
//                the sandbox and the approval policy.
//   Kiro         an allowedCommands pattern (CLI 2.x) and a V3 match list for the milestone family, the
//                2.x pattern pinned to one owner/repository pair and an optional number. No deny: the Kiro
//                agent carries none, and the floor no longer lists gh api (permissions.yaml keeps what an
//                earlier install appended; install never removes a Kiro floor rule).
//
// In every harness a write spelled endpoint-first to another endpoint ("gh api repos/o/r/issues -X POST",
// or with only -f/-F/--input, which switches gh to POST) matches no rule of ours and is ASKED: the
// harness's own permission decision, which under Claude Code's auto mode is its classifier, not a person.
// node: modules only.

/** The write methods the source may deny. */
export const METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];
/** The endpoints the source may allow: a closed set, reviewed one by one. */
export const ENDPOINTS = ['milestones'];
/** The hand-kept denies the source may retire: a closed set. */
export const RETIRABLE = ['Bash(gh api:*)'];
/** Beside settings.json: the file as it was before install removed a retired deny. */
export const BACKUP_SUFFIX = '.pmhwc-gh-api-backup';

// One owner or repository name: GitHub's own character set.
const NAME = '[A-Za-z0-9_.-]+';

/**
 * @typedef {{ methods: string[], endpoints: string[], retire: string[] }} Spec
 * @typedef {{ writePrefixes: string[], claudeAllow: string[], claudeDeny: string[], codexForbidden: string[],
 *   kiroAllowed: string[], kiroMatch: string[], retire: string[] }} Rules
 */

/**
 * The source, parsed; errors are the lines the step prints. One entry per line:
 *   deny-method <POST|PUT|PATCH|DELETE>   the method-first spellings of that write
 *   allow-endpoint milestones             the endpoint family repos/<owner>/<repo>/milestones[/<number>]
 *   retire-deny Bash(gh api:*)            a hand-kept Claude Code deny that install removes, with a backup
 * @param {string} text
 * @returns {{ spec: Spec, errors: string[] }}
 */
export function parseSpec(text) {
  /** @type {Spec} */
  const spec = { methods: [], endpoints: [], retire: [] };
  const errors = [];
  for (let line of text.split('\n')) {
    if (line.endsWith('\r')) line = line.slice(0, -1);
    const t = line.trim();
    if (t === '' || t.startsWith('#')) continue;
    const at = t.indexOf(' ');
    const key = at < 0 ? t : t.slice(0, at);
    const value = at < 0 ? '' : t.slice(at + 1).trim();
    /** @type {[string[], string[]] | null} */
    const slot = key === 'deny-method' ? [METHODS, spec.methods] : key === 'allow-endpoint' ? [ENDPOINTS, spec.endpoints]
      : key === 'retire-deny' ? [RETIRABLE, spec.retire] : null;
    if (!slot || !slot[0].includes(value) || slot[1].includes(value)) {
      errors.push('invalid gh-api entry (' + (!slot ? 'unknown kind' : slot[1].includes(value) ? 'repeated' : 'not in the reviewed set') + '): ' + line + '\n');
      continue;
    }
    slot[1].push(value);
  }
  if (!errors.length && !spec.methods.length && !spec.endpoints.length && !spec.retire.length) errors.push('the gh-api source has no entry\n');
  return { spec, errors };
}

/**
 * The per-harness rules of a source.
 * @param {Spec} spec
 * @returns {Rules}
 */
export function rules(spec) {
  // gh reads pflag options, so "-XPOST" and "--method=POST" are the same request as the spaced forms.
  const writePrefixes = spec.methods.flatMap((m) => ['-X ' + m, '-X' + m, '--method ' + m, '--method=' + m]).map((w) => 'gh api ' + w);
  const e = spec.endpoints;
  return {
    writePrefixes,
    claudeAllow: e.map((x) => 'Bash(gh api repos/*/' + x + '*)'),
    claudeDeny: writePrefixes.map((w) => 'Bash(' + w + ':*)'),
    codexForbidden: writePrefixes,
    kiroAllowed: e.map((x) => '^gh api repos/' + NAME + '/' + NAME + '/' + x + '(/[0-9]+)?( [^;&|<>$`(){}\\n\\r]*)?$'),
    kiroMatch: e.flatMap((x) => ['gh api repos/*/' + x, 'gh api repos/*/' + x + ' *', 'gh api repos/*/' + x + '/*']),
    retire: spec.retire,
  };
}

/** No rules at all: the step without --gh-api. */
export const NONE = rules({ methods: [], endpoints: [], retire: [] });
