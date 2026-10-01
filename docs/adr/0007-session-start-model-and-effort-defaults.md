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

| Surface | Default model | Default effort |
| --- | --- | --- |
| Claude Code | `opus[1m]` | `effortLevel` = `medium` |
| Codex | a top-tier GPT model (`model`) | `model_reasoning_effort` = `medium` |
| Kiro | not yet observed | not yet observed |
| Claude desktop app / Cowork | not yet observed | not yet observed |
| ChatGPT desktop app | not yet observed | not yet observed |

For the last three, **whether the surface exposes a configurable default at all** still has to be
measured.

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

- **The policy** is one declared default per surface, expressed as a class: *the vendor's top model
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
- Bad: three surfaces have no measured baseline, and may expose no default to configure.
- Bad: the cut mapping files a lowered default as minor, although a lowered default may matter to an
  adopter. This is to be weighed at ratification.

## Links

- `AGENTS.md`, "Principles", item 1. ADR-0002 (cut policy). ADR-0003 (access modes). ADR-0006 (surfaces).
