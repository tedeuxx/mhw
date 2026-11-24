// The third-party term check (#589, CLI native baseline PRD section 6): on Claude Code, a `prompt`-type
// UserPromptSubmit hook. Claude Code sends each prompt to a small model with this text and blocks the prompt
// when the model answers {"ok": false, ...}. It replaces the hashed term lists and `mhw add-term`: terms
// (employer, client, colleague, health) are judged, never matched against a list. The global brief carries
// the same instruction for every harness (global/AGENTS.md).
//
// Evidence, at its real level (ADR-0047):
// - The entry's shape ({"type": "prompt", "prompt": ..., "timeout": 30}) and the answer's ({"ok": true|false,
//   "reason": ...}) are documented (code.claude.com/docs/en/hooks, 2026-11-23) and read from the Claude Code
//   2.1.331 bundle. The wiring is MEASURED on 2.1.331 against a local stand-in for the Messages API (no real
//   model call): with this entry, an {"ok": false} answer stopped the prompt before any main-model request,
//   {"ok": true} let it through, and an answer that is not that JSON let it through too (fail open). What a
//   real small model answers for a real prompt is NOT measured: that is a model call on the owner's account.
// - Best effort. A term can pass, and a common word can be flagged.
// - Codex parses a prompt hook and skips it; Kiro's "Agent Prompt" only adds context. Neither gets one.
//
// node: modules only (none needed).

/** What marks the entry as ours: the merge and uninstall find it by this string in its prompt. */
export const JUDGE_ID = 'mhw third-party term check (#589)';

/**
 * The prompt the hook model judges with. $ARGUMENTS is Claude Code's placeholder for the hook input JSON,
 * which carries the user's prompt. The reason is shown to the user, so it must never repeat the term.
 */
export const JUDGE_PROMPT = JUDGE_ID + '. Decide whether the user prompt below may be sent to an AI agent. '
  + 'Answer ok false only when the prompt carries third-party confidential material: something the prompt '
  + "itself ties to the user's own employer or client, current or past (its name with internal context, its "
  + 'customers, internal code names, internal tooling or terminology, internal metrics, unreleased plans, '
  + 'code or documents), a colleague named in a work context, or health data about a person. A well-known '
  + 'public company or product named as public knowledge, the user himself, and ordinary technical words '
  + 'are not third-party material: answer ok true. Secrets and fixed formats (keys, e-mail addresses, '
  + 'identity numbers) are checked elsewhere; ignore them here. In reason, give only the category '
  + '(employer or client, colleague, health) and ask the user to rephrase in abstract terms and resend; '
  + 'never quote, repeat or hint at the matched words. Hook input: $ARGUMENTS';

/** The hook's timeout in seconds, as the command hooks of this project carry. */
export const JUDGE_TIMEOUT = 30;
