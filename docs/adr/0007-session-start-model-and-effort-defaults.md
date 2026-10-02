# 0007 — Standardise the session-start default model and reasoning effort per surface

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

The owner asked that this repository also standardise, in user/workstation-level harness configuration
and within his currently active subscriptions, the default model and effort a session starts with:
*"tambem preciso que esse projeto gerenciador de workstation pessoal quanto configuracao multiharness
dentro das minhas assinaturas atualmente ativas tbm padronize em configuracao de harness nivel
usuario/wokstation os padroes de model effort de inicio de sessao"*.

**Observed baseline on the reference install, 2026-10-01**, from the user-level configs. The values
were re-read by this record's author.

**The default is declared for each supported harness**: *"para cada harness suportado"* (owner). The
table has one row per supported harness or surface (ADR-0006), and none is omitted. A row not yet
measured says so. A harness that cannot honour a configurable default says so in its row, and is never
dropped from the table.

| Harness / surface | Honours a configurable default? | Default model | Default effort |
| --- | --- | --- | --- |
| Claude Code | yes (user-level settings) | `opus[1m]` | `effortLevel` = `medium` |
| Codex | yes (user-level config) | a top-tier GPT model (`model`) | `model_reasoning_effort` = ~~`medium`~~ `high` (re-read 2026-10-01, see the amendment below) |
| Kiro IDE | ~~to be measured~~ see the amendment below (no active subscription, ADR-0003) | ~~to be measured~~ see below | ~~to be measured~~ see below |
| Kiro CLI | ~~to be measured~~ see the amendment below (no active subscription, ADR-0003) | ~~to be measured~~ see below | ~~to be measured~~ see below |
| Claude desktop app / Cowork | ~~to be measured~~ see the amendment below: three tabs, three answers | ~~to be measured~~ see below | ~~to be measured~~ see below |
| ChatGPT desktop app ("work" surfaces) | ~~to be measured~~ see the amendment below | ~~to be measured~~ see below | ~~to be measured~~ see below |

## Decision drivers

- Every in-scope surface (ADR-0006) should start sessions the same way, without depending on
  per-session choices.
- The policy must hold only within the active subscriptions and their access modes (ADR-0003).
- Model identifiers change with vendor releases, so a policy written as an id goes stale.

## Considered options

1. **An equivalence class as the policy, with the concrete id as a rendering per surface.** Survives
   model releases. Trade-off: the class needs a judgement ("top model available") each time a vendor
   ships.
2. **Concrete model ids as the policy.** Exact and checkable, but stale after every release.
3. **No standard; per-surface defaults left as installed.** No cost, but surfaces drift silently.

## Decision outcome

**Proposed: option 1.**

- **The policy** is one declared default for each supported harness, one table row each, expressed as a class: *the vendor's top model
  available on the active subscription, at medium effort.*
- **The rendering** is the concrete value per surface, recorded beside the class and updated when the
  vendor's identifiers change.
- A surface that exposes no configurable default is declared as a gap (Principle 1). It is not assumed
  to be covered.

**Proposed version-cut mapping** (it extends ADR-0002, which is itself proposed):

- raising or lowering a default → **minor**;
- a surface losing the ability to honour the default → **major**.

## Consequences

- Good: the policy survives vendor model releases; only the rendering changes.
- Bad: "top model available on the subscription" needs a human judgement at each vendor release.
- Bad: ~~three surfaces have no measured baseline, and may expose no default to configure.~~ Settled
  per surface by the 2026-10-01 amendment below. Three surfaces expose no local default key. Kiro IDE
  keeps its default only in its UI, where this repository does not render.
- Bad: the cut mapping files a lowered default as minor, although a lowered default may matter to an
  adopter. This is to be weighed at ratification.

## Amendment 2026-10-01: the open rows, settled per surface

Issue #7 asked for each open row to be settled as *measured*, *documented* (with a URL) or a
hypothesis with its reason. Values were read only for the non-secret model and effort switches.
Vendor pages were fetched on 2026-10-01. **No configuration was changed**, and no installer renders
these keys yet.

**A correction to the baseline above.** Codex's `model_reasoning_effort` reads **`high`** on the
reference install today, not `medium`. The table is struck in place. Either the value changed after
the record was written, or the first reading was wrong; nothing distinguishes the two. The proposed
policy says *medium effort*, so **the Codex rendering now diverges from the proposed policy.** Whether
to move the value back, or to change the policy, is the owner's call at ratification.

| Surface | Configurable user-level default? | Model key, and its value class on this machine | Effort key, and its value class | Evidence |
| --- | --- | --- | --- | --- |
| Claude Code CLI | yes | `model` in `~/.claude/settings.json`: `opus[1m]`, the vendor's top model alias with the long context window | `effortLevel`: `medium` | measured (read) |
| Claude desktop app, **Code** tab | yes, through the same file: *"Settings in ~/.claude.json and ~/.claude/settings.json are shared"*. The tab also has its own model and effort menus | same key and value as the CLI | same | documented ([Desktop, "Shared configuration"](https://code.claude.com/docs/en/desktop)). That this tab starts on those values was not measured |
| Claude desktop app, **Chat** tab | **no local key found.** The model is picked per conversation | none in the desktop app's config files (key paths searched for model, effort and reasoning) | none found | measured (key paths only). That the default is held on the account side is a hypothesis: no vendor page was found that states it |
| **Cowork** | **no local default-model key found** | The desktop config holds only a per-account Cowork *model auto-fallback* preference. No default-model key exists. Local Cowork reads device-level managed policy, not `~/.claude` (ADR-0003's 2026-10-01 amendment, h4), so the CLI's `model` is not shown to reach it | none found | measured (key paths only), and documented ([managed settings](https://code.claude.com/docs/en/managed-settings)). Whether a **managed-level** `model` would reach local Cowork is a hypothesis |
| Codex CLI | yes | `model` in `~/.codex/config.toml`: a top-tier GPT model id | `model_reasoning_effort`: **`high`** | measured (read) |
| Codex app inside the ChatGPT desktop app (the "work" surfaces) | yes, through the same `config.toml`. The app and the bundled CLI share `CODEX_HOME` | same | same | documented ([state locations](https://developers.openai.com/codex/config-advanced#config-and-state-locations)). Not measured in the app |
| ChatGPT desktop app, **chat** surface | **no local key found** | none documented | none documented | hypothesis: it is held on the account side. No vendor page states it, and the app's local stores were not searched for one |
| Kiro IDE (1.0.437, agent extension 1.0.794) | yes, in the UI: *"To choose which model new sessions use by default, open Settings → Chat → Models"* | **unset.** The user settings file has no model or agent key. The agent extension contributes **no** model or effort setting. Its code takes the session's selected model, then the **service-supplied** default, then the first listed model | **no persisted IDE default.** *"In the IDE, the choice applies to subsequent messages in the conversation."* Effort levels and their default come from the service, per model | documented ([Models](https://kiro.dev/docs/models), [Reasoning effort](https://kiro.dev/docs/models/effort)). The fallback order is read from the shipped bundle. Not exercised (ADR-0003: no active subscription) |
| Kiro CLI | yes | `chat.defaultModel` in `~/.kiro/settings/cli.json` (`kiro-cli settings chat.defaultModel <id>`, or `/model set-current-as-default`). **Not installed here**, so there is no value | `chat.modelDefaults`, per model (`/effort set-current-as-default`). No value | documented ([Models](https://kiro.dev/docs/models), [Reasoning effort](https://kiro.dev/docs/models/effort)). Capped at *documented* (ADR-0003) |

**What this means for the decision.** Option 1 survives, with three kinds of surface instead of one:

- **Renderable**, where a user-level file key exists: Claude Code (and with it the desktop Code tab),
  Codex (and with it the Codex app), and Kiro CLI.
- **UI-only**: Kiro IDE. A default exists, but nothing found shows it stored in a user-level file this
  repository could render.
- **Declared gaps** (Principle 1): the Claude Chat tab, Cowork and the ChatGPT chat surface. No local
  key was found, so their row states the gap and does not claim coverage.

Status stays **proposed**.

## Links

- `AGENTS.md`, "Principles", item 1. ADR-0002 (cut policy). ADR-0003 (access modes). ADR-0006 (surfaces).
- ADR-0003's 2026-10-01 amendment (h4: which surfaces load user-level configuration). Issue #7.

## Amendment 2026-10-02: owner selects balanced intent

The owner selected **balanced** for new sessions: good quality, moderate latency and restrained use
of the subscription allowance. The concrete model and effort mapping for each harness is still to be
established; this does not ratify the earlier top-model/medium-effort pairing as equivalent to that
intent. No default was changed in a real harness.

The preference is versioned in `overlay/profile.json`, under `session_start.priority`, and compiled
into instruction text by `global/profile/profile.py` (ADR-0018). That text records intent and grants
no extra spending or paid API use. Native configuration and fresh-session verification remain pending.
