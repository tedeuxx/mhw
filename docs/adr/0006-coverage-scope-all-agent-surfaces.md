# 0006 — Coverage scope: every agent surface of both vendor families, not only the CLIs

- **Status:** accepted
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

Until now the firewall's scope was implicitly the CLI harnesses: Claude Code, Codex and Kiro. The owner
extended it: *"lembre-se de aplicar essa padronizacao de configuracao de harness nivel wokstation tbm
com demais apps da familia claude como cowork"* ("remember to apply this workstation-level harness
standardisation to the other Claude-family apps too, such as Cowork") and *"para codex o mesmo com
chatgpt work tbm"* ("for Codex, the same, with ChatGPT work too").

**Observed on the reference install, 2026-10-01.** The orchestrating session observed these facts,
which this record's author did not re-measure. They are described by category only; no path, server
name, account or folder is recorded here.

- The Claude desktop app keeps its own MCP server list in a per-user application-support config,
  separate from Claude Code's settings.
- On this machine that list registers the same 12 local MCP servers as Codex's config. The same tool
  reach is configured in at least two independent places, with no shared source.
- Cowork has a configured user-files root directory on the local disk that the agent can work over.

## Decision drivers

- A protection that covers the CLI but not the desktop app on the same machine, with the same tool
  reach, is a gap that reads as coverage.
- Principle 1 requires enforcement to be declared per combination, not assumed.

## Considered options

1. **Every agent surface of both families is in scope.** Complete, but the inventory cost multiplies
   with the number of surfaces.
2. **CLIs only, with apps declared out of scope.** Cheaper, but it leaves the same tool reach and the
   same local files unprotected through a second door. Rejected by the owner's decision.

## Decision outcome

**Chosen: option 1.** In scope:

- **Claude family:** Claude Code (CLI and IDE), the Claude desktop app including Cowork, and its local
  MCP and extension configuration.
- **OpenAI family:** Codex (CLI and app), and the agentic or "work" surfaces of the ChatGPT desktop app.
- ~~**Kiro:** remains in scope, as before.~~ Struck by the 2026-10-01 amendment below: Kiro is two
  surfaces, not one.
- **Kiro:** Kiro IDE and Kiro CLI, as two separate surfaces.

## Consequences

- Each surface needs its own **enforcement-point inventory** under Principle 1 (OS × surface × access
  mode), **measured, not assumed**.
- Hypothesis, to be measured: desktop apps may expose fewer interception points than the CLIs.
- ADR-0003's h4 is re-examined **per surface**: some app traffic may not pass through any local hook,
  which would put it outside the firewall's reach (ADR-0004, dichotomy of control).
- Bad: the same tool reach is configured independently per surface, so a control applied in one place
  can silently miss another.
- **Candidate control, proposed only:** a single source for MCP configuration across surfaces, rendered
  into each surface's config. Not decided.

## Amendment 2026-10-01: Kiro IDE and Kiro CLI are two target surfaces

The owner: *"considere kiro-ide/cli como uma distribuicao alvo valida embora nao tenhamos subscription
ativa no tier pessoal"* ("consider Kiro IDE/CLI a valid target distribution, even though we have no
active personal-tier subscription").

Kiro IDE and Kiro CLI are each in scope, as separate surfaces, each with its own inventory of
enforcement points. On the reference install their access mode is **no active subscription**
(ADR-0003). Their controls can be authored and statically checked, but their evidence level is capped
at *documented* or *installed* until a subscription or a test account exists.

## Links

- `AGENTS.md`, "Fundamental purpose" and "Principles", item 1.
- ADR-0003 (access modes, h4). ADR-0004 (dichotomy of control).
