# 0019 — Paced conversation and three-path decisions at user level

- **Status:** accepted for the owner's explicitly requested preferences (2026-10-02). The mechanism
  below implements the countable subset; it does not establish universal runtime enforcement.
- **Date:** 2026-10-02
- **Deciders:** the owner

## Context and problem

The owner wants time to ask questions about an agent's proposals before deciding, less information
at once, and input/output token discipline. He then specified exactly three multiple-choice paths,
each showing risk and expected return, as a user preference across projects on this workstation.
This supplements ADR-0013 and ADR-0018 without moving workflow ownership out of the skills plugin.

## Decision drivers

- One question and one pending decision at a time, with clarification before commitment.
- Three meaningful paths, with concise risk and benefit descriptions; no artificial unsafe choices.
- Cross-project user-level distribution from one source, separate from generic adopter defaults.
- Reduce attention and context costs without discarding governing instructions or material evidence.
- Distinguish installed instructions, tested code, runtime routing and semantic compliance.

## Considered options

1. **Profile instructions plus a structural picker hook where supported.** Selected: portable pacing
   instructions and a deterministic check of three authored options and single selection. Trade-off:
   most behavior still depends on instruction following; surfaces have unequal hook support.
2. **A mandatory proxy or terminal output filter with hard token ceilings.** Strongest alternative for
   interception, but requires a new transport/control architecture. It cannot safely govern all native
   account connectors or GUI responses, and blind truncation can hide evidence or break tool calls.
3. **Stop-hook semantic classification.** Rejected: a response may already have reached the owner,
   continuing generation adds tokens, and classification can mistake clarification for approval.

## Decision outcome

The owner's profile selects `conversation.cadence=paced`,
`conversation.context_discipline=minimum-sufficient` and `interaction.decision_options=3`.
These fields are optional in schema v1 so existing adopters keep their previous behavior.
The compiler distributes the same instructions to user-level briefs and the desktop handoff.

For a path decision, show a concise proposal and leave space for doubts. At the decision point, use
one native picker with three mutually exclusive authored choices, risk and benefit per choice, and
an evidence-based recommendation. ~~Conservative/balanced/ambitious is useful when those paths really
exist, not a mandatory fiction. Deferral or reversible investigation may supply a legitimate third
path.~~ The three are one extreme, the opposite extreme and the middle ground (2026-10-05 amendment). Native free text is available for clarification and is not an authored fourth option.
When no picker exists, use three numbered choices. Native security approvals keep their own UI.
An action already decided remains an action line, without invented alternatives.

A clarification is not consent. Answer it and pause rather than immediately repeating the picker.
Silence is not approval. Continue already-authorized reversible work without adding artificial gates.
Use progressive disclosure and scoped input retrieval, expanding when accuracy or the owner requires
it. No arbitrary numeric token ceiling, model change or new spending permission was selected.

### Mechanical boundary and compatibility

| Surface / OS | Distribution | Mechanical coverage in this change |
| --- | --- | --- |
| Claude Code / macOS, Linux | User `CLAUDE.md`, ~~existing `PreToolUse:AskUserQuestion` hook~~ | ~~`exact_options=3` rejects missing, two/four options and multi-selection; keeps question count/length checks~~ Instructions only since 2026-10-05 |
| Claude Code / Windows | User `CLAUDE.md` via PowerShell installer | Instructions only; POSIX hook not installed by that installer |
| Codex CLI / app | User `AGENTS.md` | Instructions only; guard's standalone Codex serialization is not registered and native picker hook routing is unmeasured |
| Kiro CLI / IDE | User global steering | Instructions only; actual resource loading depends on the agent; CLI absent from reference PATH during inspection |
| Claude desktop / Cowork | Generated owner-overlay block appended through account **Instructions for Claude** | UI reported **Saved**; no automated account sync or mechanical enforcement; local MCP configuration is not a conversation-preference carrier |

The hook counts authored choices, not the runtime's automatic free-text entry. It checks no option
meaning, risk/return quality, language, total prose length, billing tokens, dialogue state or tool-input
token totals. Direct synthetic tests prove its decisions, not harness routing. User instructions can
be superseded by higher-priority native layers; they are not a non-overridable managed policy.

Native verbosity settings and styles also have narrower meanings. Codex documents `model_verbosity`
as a model-dependent output preference and `tool_output_token_limit` as the history budget of individual
tool results. Claude Code documents output styles as instructions without enforcement. These are not
equivalent hard caps over the whole conversation, and this change does not write them.

## Consequences

### Good

- The preference follows the user across repositories through existing installers.
- The option count is checked before the Claude Code picker where the registered hook executes.
- The source, generated outputs, tests and gaps are versioned; generic adopters are not forced into
  this owner's three-path preference.

### Bad

- Complete mechanical multiharness enforcement remains unavailable in this implementation.
- A three-choice guard can require reformulation of a naturally binary decision; the agent must
  offer a legitimate defer/investigate path rather than make up an unsafe choice.
- New sessions are needed to validate loading; account surfaces require their supported settings.

## Links

- [HITL calibration](0013-hitl-escalation-calibration.md)
- [Portable profile](0018-portable-personal-profile-and-unified-harness-management.md)
- [Profile compiler](../../global/profile/README.md)
- [Claude Code output styles](https://code.claude.com/docs/en/output-styles)
- [Codex configuration reference](https://learn.chatgpt.com/docs/config-file/config-reference)

Vendor references inspected 2026-10-02; no new minimum supported harness version is claimed.

## Verification and installation — 2026-10-02

- Profile suite: 17 tests passed; guard suite: 32 checks passed; installer suite: 128 checks passed
  in synthetic homes on macOS. ShellCheck passed. Windows/Linux CI is configured, not run here.
- `global/install.sh` installed the briefs, updated the existing guard and its configuration, and
  refreshed generated notice headers. Existing native permission rules and hook trust were unchanged.
  `global/install.sh --check` passed against the reference workstation.
- The current Codex app session received the generated brief, demonstrating **loaded** here. No
  fresh Claude Code or Kiro conversation canary was run. Direct guard tests do not establish runtime
  picker routing or semantic compliance; the updated hook is **installed and tested**, not claimed
  as measured enforcement in a live reference session.
- Claude desktop UI preserved the previous instruction text and reported **Saved** after appending
  the generated `overlay/AGENTS.md` block. Conversation behavior remains unmeasured. This was a
  user-authorized manual UI application, not a new account-sync adapter. The separate full-floor
  `desktop-instructions.md` handoff was not uploaded in its entirety.

## Amendment 2026-10-05: three options are two extremes and the middle; no hook checks them ([Issue #60](https://github.com/tedeuxx/personal-multi-harness-workstation-configuration/issues/60))

**Owner, interview of 2026-10-05, verbatim:** *"eu quero 3 opcoes da seguinte forma: extremo 1, extremo 2, meio termo."*

- A decision always gets exactly three options: one extreme, the opposite extreme, and the middle
  ground between them. This replaces "conservative, balanced and ambitious when meaningful" and the
  deferral-as-third-path allowance, both struck in place above. Never invent an unsafe or misleading
  option to fill a position; an action already decided remains one action line.
- The `exact_options=3` check is removed with the Claude Code picker guard (ADR-0013, 2026-10-05
  amendment). The Claude Code row of the mechanical-boundary table is struck in place: every surface
  now carries this rule as an instruction only. `profile-plan.json` says so in its
  `decision_options` limit.
- The "Bad" consequence that a three-choice guard can force a binary decision into a made-up third
  option no longer has a guard behind it; the instruction itself still asks for three options, and
  the middle ground is the third.
- Evidence level: *written* in the compiler and the regenerated overlay, *tested* by
  `global/profile/profile_test.py` and `global/install.test.sh` (the three rendered briefs carry the
  rule). Not installed; compliance is not measured.
