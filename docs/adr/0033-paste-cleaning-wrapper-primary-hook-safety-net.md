# ADR-0033: Paste cleaning: the wrapper cleans first, the prompt hook is the safety net

- **Status:** proposed. The requirement is the owner's (accepted, carried from ADR-0011); the choice
  of the wrapper as primary and the hook as safety net is his decision on #58 (2026-10-05). The
  mechanism details below await ratification.
- **Date:** 2026-10-05
- **Deciders:** the owner (written by agents-lead)
- **Supersedes:** [ADR-0011](0011-clipboard-prompt-anonymisation.md), whose original decision (an
  always-on clipboard watcher) was withdrawn and whose current mechanism lived only in three amendments
- **Issue:** [#65](https://github.com/tedeuxx/mhw/issues/65)
  (consolidation); the decisions are on [#5](https://github.com/tedeuxx/mhw/issues/5)
  and [#58](https://github.com/tedeuxx/mhw/issues/58)

## Context and problem

The owner's requirement, verbatim (ADR-0011):

> *"todos prompts em area de transferencia quando processados precisam ser anonimizados e limpados de
> referencias de empregador e clientes."* · *"automaticamente."*

It was narrowed and sharpened on #5:

> *"eu so quero filtrar o copy paste ao interagir com clis de harness"* · *"nao deve impactar nenhum
> outro app ou ux do so"* · *"tem que ser limpo sozinho"*

ADR-0011 records how the mechanism got here: a watcher (withdrawn), then a prompt hook that blocks,
then a terminal wrapper that cleans, then (#58) the wrapper as primary. A reader who opens ADR-0011
meets four hundred lines about a withdrawn watcher before the decision in force. This record states
only the decision in force, so a fresh context does not infer the retired architecture.

## Decision drivers

- Clean, don't ask: a pasted secret should never reach the model (requirements document, sections 2
  and 4).
- Touch nothing outside an agent harness command-line session: no clipboard monitoring, no dialog, no
  OS permission.
- Thin protection: one justified hook at most (hook budget, requirements document section 4a).
- No per-request waiver: a hook is turned off only by an administrator with `sudo` (ADR-0028).

## Considered options

1. **Wrapper primary, prompt hook as safety net for unwrapped sessions (chosen, owner on #58).**
   Trade-off: inside a wrapped session nothing judges typed text, and anyone can set the marker by hand.
2. **Wrapper only, hook removed; the brief tells the agent not to use, repeat or store a pasted
   secret.** No custom hook at all. Rejected by the owner: sessions not opened through the wrapper
   would have no mechanical check, and once a secret is sent the provider already has it.
3. **Hook only, blocking every prompt with a finding (the 2026-10-01 state).** Rejected: a hook cannot
   rewrite a prompt in Claude Code or Codex (documented), so it can only block and offer, which is not
   *"limpo sozinho"*.
4. **The always-on clipboard watcher (ADR-0011's original decision).** Withdrawn by the owner on #5:
   too broad, and it touched the OS clipboard.

## Decision outcome

Chosen: option 1.

- **The wrapper** (`global/clipboard/paste_wrapper.py`) starts `claude`, `codex` or `kiro-cli` on a
  pseudo-terminal and replaces each finding inside a bracketed paste with `[REDACTED:<category>]`
  before the command-line tool sees it. Typed input passes byte for byte. It exports
  `PMHWC_PASTE_WRAPPER=1` only into the tool it relays for, and leaves it unset when a prompt argument
  carries a finding or cannot be checked. The installer writes a snippet of shell functions; activating
  it is the owner's act (a printed guarded line, or `install.sh --shell-rc=FILE`).
- **The prompt hook** (`clipboard_guard.py prompt-hook`, `UserPromptSubmit` in Claude Code, Codex
  `hooks.json`) passes silently when the marker is exactly `1`. Otherwise it blocks a prompt with a
  finding and shows a redacted copy. It lives in the admin layer when that layer is installed
  (ADR-0025), and is turned off only with `sudo` (ADR-0028).
- **One detection core** for both: the owner's client and employer terms as salted hashes (salt in the
  login Keychain, a user-only file as the fallback, added with `add-term` from his own terminal) plus
  five generic categories (credential, e-mail, payment card, CPF, CNPJ; `block_categories` in
  `clipboard.conf`).
- **Coverage, stated:** Claude Code and Codex command-line sessions on macOS and Linux. Kiro CLI is
  wrapped but not measured, and has no hook. Out of reach: desktop apps, IDE extensions, files read by
  path, pasted images, Windows.

## Consequences

- Good: in a wrapped session a pasted secret never reaches the agent harness, so its transcript and
  history hold only the redacted text (measured in throwaway homes, Claude Code 2.1.289 and Codex
  0.160.0).
- Good: a session not opened through the wrapper keeps the hook, which is the gap the owner kept it for.
- Bad: in a wrapped session typed text, a paste while bracketed paste is off, and anything a descendant
  process submits are not checked.
- Bad: the marker is not a secret; setting it by hand switches the hook off for that session. Accepted
  as *defend the perimeter, not the behaviour*.
- Bad: one custom hook and the admin-layer drop-in remain, with their `sudo` maintenance cost.
- Bad: Codex runs the hook only after the owner trusts it in `/hooks`.

## What this replaced

ADR-0011 decided an always-on macOS clipboard watcher (LaunchAgent, polling, dialog). It was installed
and loaded on 2026-10-01 and withdrawn the same day on the owner's correction; the installer now removes
its leftovers and `--check` reports them as `STALE`. Its detection core (`clipboard_guard.py`, the term
hashes and the salt store) is what this record keeps. The measurements, mutation checks and residuals
of each step remain in ADR-0011's amendments.

## Links

- ADR-0011 (superseded; the history). ADR-0005 (no log). ADR-0008 (no persistence). ADR-0025 (admin
  layer). ADR-0028 (OS privilege only). Requirements document, sections 4 and 4a.
