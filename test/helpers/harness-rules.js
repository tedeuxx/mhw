// Models of the three harnesses' command-rule matchers, for evaluating RENDERED rule files in a test
// (Issue #593). A model is not the harness: what it answers is "written and tested against a model". Where
// a harness ships an instrument (Codex: `codex execpolicy check`), the test runs it beside the model.
//
//   Claude Code  permissions.deny, then permissions.ask, then permissions.allow: the first list holding a
//                matching rule decides; no match asks. "Bash(<p>:*)" matches <p> alone or <p> followed by a
//                space (a token boundary, measured on 2.1.261: "BOUND:*" did not match "BOUNDX"); any other
//                "*" matches any run of characters, spaces and slashes included (documented); a rule with no
//                "*" matches the command exactly.
//   Codex        prefix_rule(pattern=[...], decision=...): a rule applies when its tokens are the first tokens
//                of the command, each equal; the strictest applying decision wins (forbidden, prompt, allow);
//                no rule is "none", and the sandbox and approval policy then decide.
//   Kiro         CLI 2.x: toolsSettings.execute_bash.allowedCommands, each an anchored regular expression;
//                a match allows, anything else asks. V3: a shell rule's match globs ("*" any run) with its
//                exclude globs; a match with no exclude match allows.
// node: modules only.

/** @param {string} glob */
const globRe = (glob) => new RegExp('^' + glob.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*') + '$', 's');

/**
 * Whether one Claude Code Bash rule matches a command.
 * @param {string} rule @param {string} cmd
 */
export function claudeMatches(rule, cmd) {
  const m = /^Bash\((.*)\)$/s.exec(rule);
  if (!m) return false;
  const inner = m[1];
  if (inner.endsWith(':*')) {
    const p = inner.slice(0, -2);
    if (cmd === p || cmd.startsWith(p + ' ')) return true;
    return p.includes('*') && (globRe(p).test(cmd) || globRe(p + ' *').test(cmd));
  }
  return inner.includes('*') ? globRe(inner).test(cmd) : inner === cmd;
}

/**
 * The Claude Code decision for a command under a settings document's permissions.
 * @param {{ allow?: string[], deny?: string[], ask?: string[] }} perms @param {string} cmd
 * @returns {'deny' | 'ask' | 'allow'}
 */
export function claudeDecision(perms, cmd) {
  if ((perms.deny || []).some((r) => claudeMatches(r, cmd))) return 'deny';
  if ((perms.ask || []).some((r) => claudeMatches(r, cmd))) return 'ask';
  if ((perms.allow || []).some((r) => claudeMatches(r, cmd))) return 'allow';
  return 'ask';
}

/**
 * The prefix rules of a Codex rules file.
 * @param {string} text
 * @returns {Array<{ pattern: string[], decision: string }>}
 */
export function codexRulesOf(text) {
  const out = [];
  for (const line of text.split('\n')) {
    const m = /^prefix_rule\(pattern=\[(.*)\], decision="(allow|prompt|forbidden)"\)$/.exec(line);
    if (m) out.push({ pattern: [...m[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]), decision: m[2] });
  }
  return out;
}

/**
 * The Codex decision for a command's tokens: forbidden, prompt, allow, or none when no rule applies.
 * @param {Array<{ pattern: string[], decision: string }>} rules @param {string[]} tokens
 */
export function codexDecision(rules, tokens) {
  const hit = rules.filter((r) => r.pattern.length <= tokens.length && r.pattern.every((t, i) => t === tokens[i])).map((r) => r.decision);
  for (const d of ['forbidden', 'prompt', 'allow']) if (hit.includes(d)) return d;
  return 'none';
}

/**
 * The Kiro CLI 2.x decision under an agent document: allow when an allowedCommands pattern matches.
 * @param {any} agent @param {string} cmd
 * @returns {'allow' | 'ask'}
 */
export function kiro2Decision(agent, cmd) {
  const pats = agent.toolsSettings.execute_bash.allowedCommands;
  return pats.some((/** @type {string} */ p) => new RegExp(p).test(cmd)) ? 'allow' : 'ask';
}

/**
 * The Kiro V3 decision under the same agent document's permissions rules.
 * @param {any} agent @param {string} cmd
 * @returns {'allow' | 'ask'}
 */
export function kiroV3Decision(agent, cmd) {
  for (const r of agent.permissions.rules) {
    if (r.capability !== 'shell' || r.effect !== 'allow') continue;
    if ((r.exclude || []).some((/** @type {string} */ g) => globRe(g).test(cmd))) continue;
    if (r.match.some((/** @type {string} */ g) => globRe(g).test(cmd))) return 'allow';
  }
  return 'ask';
}
