# ADR-0047: Third-party terms are judged by the model; no term list, no salt, no `mhw add-term`

- **Status:** ~~proposed~~ accepted 2026-11-24, ratified by the owner ([«Ratifico»](https://github.com/tedeuxx/mhw/issues/589#issuecomment-7132828476)); it was proposed (the direction is the owner's ruling in the
  [CLI native baseline PRD](../mhw-product-requirements-document-cli-native-baseline.md), sections 5 and 6;
  the mechanism below is the agents', for his ratification at the release candidate)
- **Date:** 2026-11-24
- **Deciders:** the owner (written by agents-lead)
- **Supersedes:** the term part of [ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md):
  the hashed employer, client, health and colleague lists, their salt and `mhw add-term`. ADR-0033's
  paste-wrapper part is not touched here; slice 4 ([#590](https://github.com/tedeuxx/mhw/issues/590))
  removes the wrapper and amends this record for it.
- **Issue:** [#589](https://github.com/tedeuxx/mhw/issues/589) (slice 3 of 10 of the PRD)

## Context and problem

Until this record, the owner registered the names to catch with `mhw add-term`. Each was stored as a
salted hash in `<data dir>/local-overlay/clipboard-terms` (and `-health`, `-colleague`), keyed by a 0600
salt file beside them (ADR-0033, 2026-11-21 amendment). The paste wrapper, `mhw scan` and `mhw hook prompt`
matched text against those lists. #600 already removed `mhw scan` and `mhw hook prompt`, so after it only
the wrapper still read a list.

The owner rejected the list itself, in his words: *"I never thought of keeping this based on a list of
values."* A list catches only the spellings someone typed into it beforehand, and keeping it means storing
material about his employers and clients on the machine, even as hashes. The PRD's section 6 gives the
direction: **third-party terms (employer, client, colleague, health) are judged by the model**, through
the brief and, on Claude Code, a `prompt`-type hook, as a best-effort check. Fixed formats (credentials,
e-mail addresses, identity numbers) stay with the pattern hook of
[#588](https://github.com/tedeuxx/mhw/issues/588).

## Decision drivers

- The owner's ruling: no list of values.
- Native first (commandment 1): use the harness's own judging hook, with no mhw code at prompt time.
- Keep the minimum on the machine (ADR-0008): a list of hashes, and the salt that makes them testable,
  are material to remove.
- Report at the real evidence level: a model judgement is best effort, and the record says so.

## Considered options

1. **The model judges (chosen).** The global brief tells every agent to judge third-party terms, and on
   Claude Code install renders one `prompt`-type `UserPromptSubmit` hook whose text asks a pinned small model
   whether the prompt carries third-party material. The list, the salt and `mhw add-term` are removed.
   Trade-off: a judgement is best effort. A term can pass, and a common word can be flagged. Codex and Kiro
   get no hook: the brief is all they have.
2. **Keep the hashed lists and add the model on top.** The list catches exactly what was registered.
   Rejected: it is the list the owner ruled out. It keeps third-party material on the machine, and it
   catches nothing that was not typed into it beforehand.
3. **The model in a command hook calling an API.** Possible on every harness that runs command hooks.
   Rejected: custom code, a credential and a paid call per prompt, which is everything commandment 1
   avoids, where Claude Code already has a native judging hook.

## Decision outcome

Chosen: option 1.

- **The instruction, every harness.** `global/AGENTS.md`, rule 4: third-party terms are the agent's to
  judge, no list exists, and the Claude Code hook does not replace that judgement.
- **The hook, Claude Code only, on macOS and Linux; `mhw install-windows` installs no hook, so Claude
  Code on Windows has the brief only.** `mhw install` merges into `~/.claude/settings.json` one entry
  `{"type": "prompt", "prompt": <src/render/term-judge.js JUDGE_PROMPT>, "model": "claude-haiku-5-5",
  "timeout": 30}` under
  `UserPromptSubmit`, in a group of its own. It is found again by the text `JUDGE_ID` at the start of its
  prompt: install keeps exactly one, replaces a stale wording, and `--check` reports a missing one as
  drift. Uninstall removes it. A foreign prompt hook is left alone. It needs no node and no script, so it
  is rendered whatever the paste filter's node and in either `--hooks` mode. The admin layer carries none
  (named below). The prompt asks the model to answer `ok false` only for material the prompt itself ties
  to his employer or client, a colleague named in a work context, or health data. In its reason it gives
  only the category, never the words.
- **Codex and Kiro get none, at their evidence level.** Codex 0.163 parses a `prompt`-type hook and skips
  it (documented, PRD section 6). Kiro's "Agent Prompt" only adds context (documented). Kiro CLI V3 also
  does not block on a command hook's exit 2 at prompt submit (measured once on #588, PRD open question 2).
  On both, the brief's instruction is the whole control.
- **Removed.** `mhw add-term` is an unknown subcommand. `src/commands/add-term.js` and `src/lib/salt.js` are
  deleted. The cleaning core no longer exports a term reader, a hash or a salt reader, and no longer reads
  `terms_file=`, `health_terms_file=`, `colleague_terms_file=`, `salt_file=` or `salt_store=`. The CI scan
  (`.github/scripts/outbound-scan.js`) and the paste wrapper match patterns only, with no term NOTE. The
  `employer-client-term` category name stays valid in `block_categories`, so an owner setting naming it
  still reads, but nothing produces it.
- **Leftovers.** Install, reinstall and uninstall move each of `clipboard-salt`, `clipboard-terms`,
  `clipboard-terms-health`, `clipboard-terms-colleague` and their `.old-salt` copies found in
  `<data dir>/local-overlay/` to `<file>.pmhwc-backup` (0600) beside it. Each is named in a `REMOVED ...
  backup kept as ...` line, and the directory is removed if nothing else is left in it. `--check` names
  each as STALE (drift) and `--dry-run` as WOULD REMOVE. Their content is never read or printed.
  `mhw status` names any that is still there. The backup is the owner's to delete; it is a salt and
  salted hashes, never plain text.

## Consequences

- Good: no list of third-party terms and no salt stays on the machine once he deletes the backups. A
  term is judged however it is spelled. There is no command to remember, and no mhw code runs at prompt
  time.
- Bad: **best effort, stated plainly.** A real model's judgement is not measured, so the hook may let a
  term pass or block a harmless prompt.
- Bad: **it fails open.** When the evaluator's answer is not the expected JSON, or its call fails, Claude
  Code lets the prompt through (measured for a bad answer, see below; an API error is read from the
  bundle).
- Bad: **a model call on every prompt.** Each prompt costs one judge call on Claude Code, on the
  owner's account. The entry pins `model: claude-haiku-5-5`, because without the field Claude Code
  2.1.331 sent the judge request to the session's main model (measured by the gate against the local
  stand-in: `claude-opus-5-5`, and `claude-sonnet-5-5` under `--model sonnet`). With the field the judge
  request names `claude-haiku-5-5` while the main request keeps the session's model (measured the same
  way, 2026-11-24). Whether the owner's account serves that model, and what a call costs, are not
  measured.
- Bad: **Codex, Kiro and Windows have no mechanical term check.** Between #600 and this record only the
  paste wrapper still read a list. From this record on, nothing on Codex, on Kiro, or on Claude Code on
  Windows (where `mhw install-windows` installs no hook) checks a term at all.
- Bad: **not in the admin layer.** Under `--hooks=managed` the term check stays a user-level entry, which
  a process running as the owner can remove. Rendering it into the managed drop-in is not built here.
- Bad: the block message Claude Code shows begins with the hook's own prompt text in brackets, so it is
  long.
- Neutral: the CI scan can no longer report a term in a pull request. In CI it never could (no list
  there); on the workstation it could only after `mhw add-term`.

### Evidence level

- **Written and tested** in throwaway homes: the entry rendered by install, kept by a second install,
  replaced when stale, removed by uninstall. No entry on Codex or Kiro. The leftovers moved aside with
  their backup notice (install, check, dry-run, uninstall). A tree sweep, checked against a known-present
  reader first, finds no term-list or salt reader in `bin/`, `src/` and `.github/scripts/`.
  `mhw add-term` exits 2 as unknown.
- **Measured** on Claude Code 2.1.331, macOS, 2026-11-24, with no real model call. A throwaway
  `CLAUDE_CONFIG_DIR` held only the rendered entry. `ANTHROPIC_BASE_URL` pointed at a local stand-in for
  the Messages API, which answered the judge request `{"ok": false, ...}` when the prompt held a synthetic
  probe word, and `{"ok": true, ...}` otherwise. Run with `claude -p "<prompt>" --output-format json`:
  - **Block:** an `ok false` answer stopped the prompt. The result was `Operation stopped by hook: <the
    reason>` with `num_turns` 0, and the stand-in received the judge request only, never a main-model
    request.
  - **Pass:** an `ok true` answer let the prompt through, and the main model answered.
  - **Fail open:** an answer that was not JSON let the prompt with the probe word through to the main
    model.
- **Read from the bundle** (2.1.331), not measured: the evaluator's system prompt and answer schema, the
  `model` field, the 30-second default timeout, and an API error becoming a non-blocking error. The model
  the request names is measured (above).
- **Not measured:** what a real model answers for a real prompt, whether the account serves the pinned
  model, and its cost. Not installed on
  the reference machine.

## What this replaced

ADR-0033's 2026-11-01 and 2026-11-21 amendments: employer and client terms, and the term halves of health
and colleague-name, matched against hashed lists that `mhw add-term` wrote, keyed by a 0600 salt file
(before #488, a Keychain item). Their one consequence that still shapes this design: a list catches only
registered spellings, which is why the replacement judges instead of matching.

## Links

- [CLI native baseline PRD](../mhw-product-requirements-document-cli-native-baseline.md), sections 5, 6
  and 7. The cloud environments PRD's *"terms via variable"* is amended as without object in the same
  pull request.
- [ADR-0033](0033-paste-cleaning-wrapper-primary-hook-safety-net.md) (the paste wrapper; its term part
  superseded here). [ADR-0008](0008-personal-workstation-no-confidential-persistence.md) (no
  persistence). [ADR-0025](0025-hook-layers-in-the-native-admin-layer.md) (admin layer).
- Issues: [#589](https://github.com/tedeuxx/mhw/issues/589), [#588](https://github.com/tedeuxx/mhw/issues/588)
  (fixed patterns), [#590](https://github.com/tedeuxx/mhw/issues/590) (the wrapper), and
  [#563](https://github.com/tedeuxx/mhw/issues/563) and [#583](https://github.com/tedeuxx/mhw/issues/583),
  which lose their object.
