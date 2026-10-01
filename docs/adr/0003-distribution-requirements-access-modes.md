# 0003 — Distribution requirements: supported access modes

- **Status:** proposed
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

This repository is an LLM firewall. It sanitises external and internal prompts of secrets, personal
data, PII, client and employer confidential data, and sensitive personal data (see `AGENTS.md`,
"Fundamental purpose"). Where a sanitiser can sit depends on **how each harness reaches its model**,
and that is a distribution requirement: someone replicating this set must know which access modes it
supports.

**Fact (owner, 2026-10-01):** the reference install reaches Claude (through Claude Code) and Codex
through the owner's **top-tier subscriptions**, signed in with a subscription login rather than an API
key.

## Requirement

- **Every control must work under subscription login.**
- API-key mode is **optional and never assumed**. A control that works only with an API key does not
  satisfy this requirement.
- Each control declares the access modes it works under, alongside the OS × harness enforcement
  declaration required by `AGENTS.md`, Principle 1. Any access mode a control does not reach is stated
  as a gap.

### Recognised access-mode states

- **subscription login**: the reference mode for Claude and Codex. Every control must work under it.
- **API key**: optional, never assumed.
- **no active subscription**: a target distribution the policy set supports for adopters, with no
  active subscription on the reference install. This is the state of **Kiro IDE and Kiro CLI**. The
  owner: *"considere kiro-ide/cli como uma distribuicao alvo valida embora nao tenhamos subscription
  ativa no tier pessoal"*.

**What the "no active subscription" state costs.** Controls for these targets can be authored and
statically checked, but on the reference install they will likely not be exercised end-to-end in a live
session. Their evidence level is therefore **capped at *documented* or *installed***, never *measured*,
until a subscription or a test account exists. Reporting them as measured would claim the stronger
evidence on the weaker, which `AGENTS.md`'s hard rules forbid.

## Hypotheses to be measured

None of these is asserted. Each one is unverified until it is **measured** on the reference install,
with the harness version recorded. A vendor document that settles one is cited as *documented*, which
is weaker evidence than *measured*. No vendor document was cited when this record was written.

- **h1:** under subscription OAuth, Claude Code may not forward credentials to a custom
  `ANTHROPIC_BASE_URL` gateway.
- **h2:** Codex signed in with a ChatGPT account may not support a custom model provider without an API
  key.
- **h3:** intercepting subscription traffic may conflict with the vendors' terms of use, which would be
  a civil risk in itself, the very class of risk this repository exists to avoid.
- **h4:** traffic from the claude.ai web and desktop apps, and from their connectors, never passes
  through this workstation, so it is outside any local firewall.

## Decision drivers

- Subscription login is how the reference install actually works.
- A sanitiser that breaks the owner's access, or breaches vendor terms, creates the liability it is
  meant to remove.
- Controls must be portable across OS × harness × access mode (Principle 1).

## Considered options

1. **Hook-layer barrier.** Each harness's pre-tool and pre-prompt hooks inspect content and **block**
   it. They cannot rewrite it. Expected to work under subscription login, since it does not touch the
   transport, but this is still to be measured per harness.
2. **Local proxy sanitiser.** A local gateway **rewrites** outbound prompts. It is acceptable only on a
   harness and access mode where h1–h3 are measured to be clear.
3. **Both, layered.** Hooks as the floor everywhere. The proxy is added only where measurement clears
   it.

## Decision outcome

**Proposed: option 3, layered, with the proxy contingent on measurement.** No final choice until the
hypotheses are measured and the owner ratifies.

## Consequences

- Good: the hook floor does not depend on any unmeasured transport assumption.
- Bad: hooks only block, so a prompt that the proxy would have cleaned is refused instead, unless the
  proxy is cleared.
- Bad: h4, if confirmed, means a whole access surface (claude.ai web and desktop, and their connectors)
  is outside this firewall. That gap must be stated, not hidden.
- Bad: until h1–h3 are measured, external-prompt rewriting is not offered on the reference install.

## Links

- `AGENTS.md`, "Fundamental purpose" and "Principles", item 1.
- ADR-0001: the MADR discipline this record follows.
