# 0013 — HITL escalation calibration: one generic policy, an owner overlay, and a user-level guard where a harness can carry one

- **Status:** accepted for the decision (the owner's request, below). The concrete rules and limits
  marked *proposed* go beyond his stated preferences and await his ratification. ~~The user-level
  guard~~ removed, and every limit ratified as an instruction, on the owner's interview of 2026-10-05
  (amendment at the end).
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

The owner's request, verbatim:

> *"implemente a calibracao de escalacao de pendencia hitl no nivel de usuario de acordo com
> preferencias multiharness dos existentes nessa workstation e ativos com algum mecanismo de
> enforcement de harness nivel pessoal individual."*

("Implement the calibration of how pending HITL items are escalated, at user level, according to the
multi-harness preferences of the harnesses on this workstation, and active through some personal,
individual harness-level enforcement mechanism.")

Two additions, verbatim: *"mantido por esse repositorio."* ("maintained by this repository.") and
*"como adr"* ("as an ADR").

So the calibration is **owned and maintained here**. Anything that already exists elsewhere on the
workstation is input to learn from, not the owner of this control.

### His preferences, and where each one comes from

These come from his long-standing instructions to agents. He gave them in his own sessions, and the
tadeumendonca-skills plugin records them as its "HITL escalation format" and its "escalation
standard". They were re-read for this record, not inherited from the brief that requested it.

| Preference | Status here |
| --- | --- |
| One decision per activation; never a list of decisions | his |
| The activation is tweet-length at most; reasoning goes in an artifact, not the interruption | his |
| Anything needed from him goes first and is labelled; decide what is reversible and evidenced, ask only what is his | his |
| A decision is a picker with at most four options; an action is one line, the act and the link, with no options | his |
| Converse in Portuguese; published artifacts in English | his |
| Every firewall intervention is reported with category and mitigation, never the content | his (ADR-0005 amendment) |
| "Tweet-length" read as **280 characters of question stem** | **proposed** (X's post limit; not his number) |
| ~~Question **count** and question **length** are the only parts a hook checks~~ | **proposed**, extended by ADR-0019 on 2026-10-02 |

### What already exists on this workstation (learned, not owned)

- **The plugin's count guard.** tadeumendonca-skills 2.0.102 ships `hitl-one-question-guard.sh`, a
  Claude Code `PreToolUse` hook on the exact `AskUserQuestion` matcher. It denies a `questions` array
  of length ≥ 2 and does nothing else. The plugin is enabled in the user-level settings of the
  reference install (`enabledPlugins`), so this guard fires in every Claude Code session today.
- **It is routed live, and that is measured.** On Claude Code 2.1.285, a real session transcript
  carries the tool result `PreToolUse:AskUserQuestion hook error: Blocked: AskUserQuestion carries 2
  questions…`. That is the plugin's hook. ~~This repository's own registration has not fired yet,
  because it is not installed yet.~~ *(Struck 2026-10-01: the guard and its settings hook entry were
  installed on the reference machine, with `install.sh --check` clean (Issue #4, <https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/4#issuecomment-5937083996>). Whether this
  repository's registration has fired there is not measured.)*
- **The plugin's five rules are text in two other repositories' root `CLAUDE.md` files.** In a
  session rooted anywhere else, no brief carried them. The user-level brief rendered from this
  repository is the first carrier that reaches every session.
- **A semantic guard was built there and deleted.** A hook that told decisions from actions by
  option-label spelling refused genuine decisions, and it did so before the owner saw anything. Its
  false positives were invisible to the person it protected. That lesson governs what is built here.

### Base rates, measured 2026-10-01 over this machine's Claude Code transcripts

```
rg --files ~/.claude/projects -g '*.jsonl' | xargs jq -c 'select(.type=="assistant")|.message.content[]?
  |select(.type=="tool_use" and .name=="AskUserQuestion")|.input.questions' \
  | jq -s '{activations:length, two_plus:(map(select(type=="array" and length>=2))|length),
            opts_over4:([.[]|select(type=="array")|.[]|(.options//[]|length)]|map(select(.>4))|length)}'
# -> {"activations":138,"two_plus":2,"opts_over4":0}

rg --files ~/.claude/projects -g '*.jsonl' | xargs jq -c 'select(.type=="assistant")|.message.content[]?
  |select(.type=="tool_use" and .name=="AskUserQuestion")|.input.questions' \
  | jq -s '[.[]|select(type=="array")|.[]|(.question//""|length)]
           | {n:length, over280:(map(select(.>280))|length), max:max, p50:(sort|.[length/2|floor])}'
# -> {"n":139,"over280":2,"max":296,"p50":104}
```

The commands print counts only, never question text. The corpus grows, so these are a snapshot.
Both limits can go red on real data, at about 1.5% of activations each. An options ceiling of 4 has
never been exceeded, because the runtime's own schema already holds it: Claude Code 2.1.286's bundle
declares *"Questions to ask the user (1-4 questions)"* and *"Must have 2-4 options"* (read from the
shipped binary's strings, not documented).

## Decision drivers

- Owned here and portable (Principle 1): adopters do not have the plugin, and owner values (language,
  limits) live in an overlay, not in the generic policy.
- Report at the real evidence level. A hook that cannot enforce must not read as if it does.
- A preventive control whose false positives the owner cannot see is worse than none.
- Every intervention is reported to the owner: category and mitigation, never the content (ADR-0005).
- Never clobber the owner's `~/.claude/settings.json`.

## Considered options

1. **Generic rules in the global brief, owner values in an overlay, and a user-level guard holding
   only the countable parts (question count, question length) where a harness can run one.** Chosen.
   Trade-off: most of the calibration (ask first, decision versus action, language, what is his) stays
   at instruction level, because no layer can check it without classifying language.
2. **Rely on the plugin's guard.** Zero new code. Rejected: the owner said this repository maintains
   the control, the plugin is not part of what an adopter installs, and it carries no length limit
   and no owner notice.
3. **A semantic classifier**: decision versus action, the conversation language, or a `Stop` hook
   counting asks in prose. Rejected. The decision/action classifier was built and deleted for
   invisible false positives. Language detection would misfire on code and English terms. The plugin
   measured that the only prose proxy (lines starting `! `) counts command blocks, not asks. A `Stop`
   hook could only warn, one turn late, on a predicate known to be wrong.
4. **A user-level permission `deny` on `AskUserQuestion`.** Deny rules from user settings cannot be
   carved out by a project (*documented*, <https://code.claude.com/docs/en/permissions>), which would
   make this the robust layer. Rejected all the same. A permission rule on this tool matches the tool
   name, not the content of its input, so it cannot express "more than one question" or "longer than
   280 characters". It could only remove the picker entirely, which pushes every decision into prose
   numbering, the exact form his rules forbid.
5. **Managed-layer settings** (organisation policy, which no user or project layer can disable).
   Recorded as the **proposed hardening**, not done here. It is the subject of ADR-0014 (proposed in a
   parallel pull request, not on `main` when this record was written).

## Decision outcome

**Chosen: option 1.**

### The rules (global brief, "Escalating to the owner")

One ask per activation or message. The ask goes first and is labelled, with reasoning in an artifact.
A decision gets a picker with at most four options; an action gets one line, the act and the link.
Decide what is reversible and evidenced; ask only what is his. Language and limits come from the
overlay.

### Generic policy and owner overlay

| File | Holds | Rendered to |
| --- | --- | --- |
| `global/AGENTS.md` | the generic rules | every harness's user-level brief (ADR-0010) |
| `overlay/AGENTS.md` | his language rule and his limits, in words | appended to that brief |
| ~~`global/hitl.conf`~~ | ~~`max_questions=1`, `max_question_chars=0` (length off)~~ | ~~the guard's config~~ |
| ~~`overlay/hitl.conf`~~ | ~~`max_question_chars=280` (*proposed* reading of "tweet"), and the owner notice in Portuguese (`notice_count`, `notice_length`)~~ | ~~appended; the last value wins~~ |

`max_questions=1` is generic rather than personal, because a second question can be lost on some
surfaces without anything reporting the loss. How short an interruption must be is personal, so the
length check is off unless an overlay sets it. **For both limits, `0` means the check is off.** The
owner notice defaults to built-in English; an overlay sets it in the owner's language, with the
placeholders `{count}`, `{chars}` and `{max}`. An adopter replaces `overlay/`, or installs with
`--overlay=none`.

The config format is `key=value`, one per line. Spaces around keys and numbers are ignored, `#`
starts a comment, and a last line with no trailing newline is read. A numeric value that is not a
non-negative integer is ignored, and the built-in default applies. Tests cover each of these cases,
because a value the parser drops silently turns a check off.

### ~~The guard: `global/hooks/hitl-escalation-guard.sh`~~

*Removed 2026-10-05 (amendment at the end). The section below is the record of what was built.*

- It refuses a structured picker whose question count exceeds `max_questions`, or whose question stem
  exceeds `max_question_chars` (counted in characters, not bytes).
- It reads nothing semantic: not meaning, language, options or decision versus action.
- It **fails open** on a missing `jq`, invalid JSON, another tool, or a non-array `questions` value.
  It returns no decision and leaves those to the runtime's schema.
- **Claude Code output:** a `deny`, whose reason tells the agent how to re-ask (first question only,
  or a shorter stem, never prose). It also carries a **`systemMessage` for the owner** stating the
  category and the mitigation, never the question text, in the overlay's language. That is the
  ADR-0005 intervention report, issued by the hook instead of left to the model's memory. A test
  asserts the text is never echoed. The deny reason addressed to the agent stays in English.
- **Codex output** (`--format=codex`): `{"decision":"block","reason":…}`, the vocabulary the plugin's
  Codex probe measured. Written and tested; **not registered** (below).

The installer copies the guard and its rendered config to
`${XDG_DATA_HOME:-~/.local/share}/personal-multi-harness-workstation-configuration/`, not to the
checkout, so a branch switch cannot change what runs. It then **merges** one
`PreToolUse(AskUserQuestion)` entry into `~/.claude/settings.json` with `jq`:

- it keeps every other key and hook;
- it collapses stale or duplicate entries of its own;
- it refuses an unreadable file (exit 3) and leaves it untouched;
- it leaves `settings.json.pmhwc-backup` beside the file;
- `--dry-run` prints the semantic diff and writes nothing;
- `--check` reports a missing or stale entry.

CI (`.github/workflows/tests.yml`) runs both suites on Ubuntu and macOS, plus `shellcheck`, on every
pull request into `main`. It uses read-only permissions and the same pinned checkout commit as
`version-main.yml`. On Ubuntu `sh` is `dash`, so the suites also run under a second POSIX shell
there. On the reference Mac they run under its `sh`.

### Per harness: what is enforced, warned, or instruction only

| Harness / surface | Mechanism | Evidence level |
| --- | --- | --- |
| **Claude Code** (macOS, Linux) | user-level `PreToolUse(AskUserQuestion)` hook: **refuses** over-count and over-length pickers before display, and notifies the owner | the script and the settings merge are **tested** in throwaway HOMEs. ~~**Not installed** on the reference machine until the owner's go.~~ **Installed** on the reference machine 2026-10-01, `--check` clean (Issue #4, <https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/4#issuecomment-5937083996>); firing there not re-measured. Hook routing for this matcher is **measured** for the plugin's registration on 2.1.285, not yet for this one. That `systemMessage` reaches the owner is **read from the 2.1.286 bundle's hook schema** (*"Warning message shown to the user"*), not watched live. |
| Claude Code, headless (`claude -p`) | none | `AskUserQuestion` is absent there (plugin's measurement), so the hook never fires and prose numbering is not caught |
| **Codex** (CLI and IDE extension) | instruction, through `~/.codex/AGENTS.md` | *instruction only*. Codex has user-level hooks with a trust hash in `config.toml` (*documented* by the plugin's Codex probe on an earlier build). Codex 0.159.2 has a `request_user_input` tool (*"one to three short questions"*, payload `questions[].question`, read from binary strings, which is the same field the guard reads). **Not registered**, for two reasons. Whether that tool is routed to a pre-tool hook is unmeasured, and it is gated to some modes. Registering would also mean writing a `trusted_hash` into the owner's `config.toml`, which grants trust without a human checkpoint. |
| **Kiro IDE** | instruction, through the global steering file | *instruction only*. The 1.0.437 bundle has a global hooks directory (`getGlobalHooksDirectory` → `~/.kiro/hooks`, `*.json`), a `preToolUse` event and a `userInput` tool (*read from the shipped bundle*). The hook output schema and whether it can refuse `userInput` are not established, and nothing can be exercised without a subscription (ADR-0003). |
| **Kiro CLI** | ~~none~~ instruction, through the same global steering file as Kiro IDE | ~~its user-level brief location is undetermined (ADR-0010), so not even the instruction is known to load~~ *documented* (ADR-0010, the 2026-10-01 amendment on Windows, Linux and Kiro CLI): the CLI reads `~/.kiro/steering/`, except in a custom agent that does not list it in `resources`. Not installed, not measured |
| Claude desktop / Cowork, ChatGPT desktop | none | no local user-level brief (ADR-0010); outside reach (ADR-0004, dichotomy of control) |
| Windows | brief and overlay only (`install.ps1`, ~~**untested**~~ tested on a Windows CI runner, ADR-0010's 2026-10-01 amendment on Windows, Linux and Kiro CLI) | the guard and ~~the settings merge~~ its settings hook entry are not ported (the deny-floor merge is, ADR-0016) |

~~**Nothing here only warns.** Where a hook exists it refuses. Everywhere else the rules are
instructions, and say so.~~ Since 2026-10-05 no hook exists on any row: every rule is an instruction.

### Coexistence with the plugin's guard

~~On the reference install, both guards fire on `AskUserQuestion` and both deny two or more questions.
The duplication is deliberate for now.~~ Since 2026-10-05 this repository's guard is removed; the
plugin's duplicate is the plugin's to remove, under #63. ~~This repository's guard is the owned one, and it adds the
length limit and the owner notice.~~ Retiring the plugin's copy is a decision for the owner in that
repository; it is named here, not filed. ~~If either is removed, the other still holds the count.~~
*(Struck 2026-10-05, Issue #65: this repository's guard is removed, so it adds nothing and holds no
count; only the plugin's copy, while that plugin is enabled, still checks the count.)*

## Consequences

- Good: one source for the calibration, rendered to every harness that has a user-level brief. The
  rules now reach sessions that the plugin's per-repository text never reached.
- Good: the only checked predicates are counts, so a false positive costs the agent one re-ask that
  the owner is told about. It never silently suppresses a decision.
- Good: every refusal produces its own category-and-mitigation notice (ADR-0005), with no content.
- Bad, **documented, not measured** (per ADR-0014's research in a parallel pull request): a project's
  `.claude/settings.json` with `disableAllHooks: true` disables user, project, local and plugin hooks;
  only managed-layer hooks survive
  (<https://code.claude.com/docs/en/settings-reference#disableallhooks>). **Any repository the owner
  opens can switch this guard off**, and nothing reports it. Option 4 shows that no user-level deny
  rule can take its place. The proposed hardening is managed-layer promotion (ADR-0014).
- Bad: the guard fails open without `jq`, and nothing reports that. The installer needs `jq` to merge
  the settings, so `jq` is present at install time; its later removal is silent.
- Bad: the agent can evade a refusal by asking in prose. The deny reason forbids it, but only the
  instruction holds it. Two asks in prose are caught by no layer, on any harness.
- Bad: 280 characters is a proposed reading. The Portuguese notice text is the agent's wording, not
  his.
- Bad: the first merge re-serializes `~/.claude/settings.json`. It currently uses a non-jq layout
  (4-space indent, `" : "`, escaped `\/`), so whitespace and escaping change. The dry-run says so and
  shows the semantic diff. Later runs that find the entry in place write nothing.
- Bad: two guards fire on the same picker on this machine until the plugin's copy is retired, so a
  two-question picker returns two refusal reasons.
- Version cut (ADR-0002): **minor**. It is a new protection; existing adopters re-run the installer
  to get it, and nothing they had is weakened.

## Links

- `AGENTS.md`, "Principles", item 1 (overlay; per-combination declaration) and item 2.
- ADR-0003 (Kiro access mode). ADR-0004 (Courage; dichotomy of control). ADR-0005 and its amendments
  (HITL; every intervention reported, never the content). ADR-0010 (rendering to each harness).
  ADR-0012 (stop-and-ask only in the residual case: this record governs how that ask is shaped).
  ADR-0014 (managed-layer hardening; parallel pull request).
- `global/hooks/hitl-escalation-guard.sh` and its test; `global/install.sh` and its test.

## Amendment — 2026-10-02: three paths and paced clarification

The owner now selects exactly three authored options for path decisions, each with risk and benefit,
with space for clarification before deciding. [ADR-0019](0019-paced-conversation-and-three-path-decisions.md)
adds the overlay's structural `exact_options=3` check. The generic at-most-four instruction remains
the ceiling; the owner's more specific three-option preference applies within it. Cadence and
meaning are instructions, not semantic hook classifiers. The one-line action rule is unchanged.

## Amendment 2026-10-04: intake exception independent of the working directory (ADR-0025)

The two-option session-intake exception was gated on the event `cwd` resolving to a repository with
`workspace/session-policy.json`, so a session started at a multi-folder root was refused its own
intake. `global/hitl.conf` now declares `intake_exception=Session type|Melhoria de harness|Bugfix`,
exact on header, labels and order, single-select, valid in any directory. The guard reads its
breaking-glass switch (ADR-0024) and, from v2, is registered in the admin layer (ADR-0025).

## Amendment 2026-10-05: the picker guard is removed; every rule is an instruction ([Issue #60](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/60))

**The owner's interview of 2026-10-05**, recorded verbatim on [Issue #60](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/60):

- decision format: *"eu quero 3 opcoes da seguinte forma: extremo 1, extremo 2, meio termo."* A decision always gets three options: one extreme, the opposite extreme,
  and the middle ground.
- the session-type intake: *"eu removeria. achei que traz mais problemas do que solucao."*
- one question per message, a stem of at most 280 characters, reasoning in a linked artifact:
  *"mantém como está"* (keep it). The interview record adds that it becomes an instruction in the owner overlay
  and that no hook enforces it.
- Portuguese with him, English for everything published: *"mantém como está"*

**What changes.**

- `global/hooks/hitl-escalation-guard.sh`, its suite, `global/hitl.conf` and the generated
  `overlay/hitl.conf` are deleted. The profile compiler no longer generates `hitl.conf`.
- `install.sh` no longer installs the guard or merges its `PreToolUse(AskUserQuestion)` entry. A run
  deletes the managed guard script and limits an earlier version installed, and every settings entry
  of its own; `--check` reports each of them as `STALE` and exits 1 until then.
  `install-managed.sh` drops the entry from the Claude Code drop-in and treats the two files as
  legacy: `--apply` and `--remove` delete them, `--check` reports them. `./workstation status`
  names a still-registered entry as a leftover, never as a protection.
- The rules stay, as instructions: the generic ones in the global brief's "Escalating to the owner"
  (one question per message, the question first, reasoning in a linked artifact, decision or
  action), and the owner's in the generated overlay (the 280-character stem, three options as above,
  his language split). The superseded parts of this record are struck in place above: the two
  `hitl.conf` rows, the guard section, "Nothing here only warns" and the coexistence paragraph.
- The 2026-10-04 intake exception below no longer has a guard to exempt it from, and the intake
  itself is removed (ADR-0021, 2026-10-05 amendment).
- The plugin's duplicate one-question guard is out of scope for this repository. Its removal belongs
  to the plugin and is tracked under #63.

**Why.** The guard refused legitimate pickers (the PRD's problem statement names yes/no questions),
and its intake exception needed two defect fixes in three days (ADR-0023, ADR-0025). The owner chose
instructions over a hook for every interaction standard.

**Consequences.**

- Good: no false refusal reaches the agent or the owner, and no picker shape needs an exception.
- Good: one hook, its `jq` dependency at run time and its notice localization leave the installers.
- Bad: no layer now refuses a two-question picker or an over-length stem on Claude Code. A prose
  second question was never caught by any layer; a structured one is not caught either now.
- Bad: a machine whose user or admin layer predates this change keeps refusing until the owner
  reinstalls both layers; `--check` names the leftovers in the meantime.
- Evidence level: *written and tested* (`global/install.test.sh`, `global/install-managed.test.sh`,
  `global/workstation_test.py`, `global/profile/profile_test.py`, `workspace/delivery_test.py`; each
  regression assertion was mutation-checked against its source). Probed in a throwaway home and admin
  root: a planted guard script, limits file and settings entry were reported `STALE` and then deleted
  by one install, and the three rendered briefs carry the rules. **Not installed** on the reference
  machine; whether a model follows the rules is not measured.
- Version cut (ADR-0002): **major**, because it removes a control.
