# 0008 — The reference workstation is personal: no persistence of employer or client confidential data

- **Status:** accepted
- **Date:** 2026-10-01
- **Deciders:** the owner

## Context and problem

The owner's current policy: *"essa maquina é pessoal e nunca pode ter persistencia de dados
confidenciais de empregador e clientes. essa minha politica atual."* ("this machine is personal and must
never persist employer or client confidential data. That is my current policy.")

The owner currently has **no freelance clients**, because of current engagement constraints. No further
detail is recorded here, because this repository is portable and may be published.

## Decision drivers

- Confidential material that is never stored cannot leak from storage.
- `AGENTS.md`, "Fundamental purpose", protection 1 (client and employer confidentiality).

## Considered options

1. **Personal by policy: never persist employer or client confidential data.** The firewall prevents
   ingress and persistence. Trade-off: it gives no help to a machine that legitimately holds such
   material.
2. **Containment posture**: the material may be present but is fenced off from agents and egress. This
   suits a mixed-use machine, but it does not describe this one, and it is much harder to make complete.

## Decision outcome

**Chosen: option 1.** The reference workstation is **personal by policy** and must **never persist**
employer- or client-confidential data.

## Consequences

- The firewall's job for this category is **ingress prevention and non-persistence**. It is not
  containment of material that is legitimately present, because on this machine none is.
- **"Persistence" is read broadly.** It includes:
  - harness session transcripts and caches. Claude Code keeps full session transcripts locally
    (ADR-0005);
  - app-local data directories;
  - working folders an agent can reach;
  - clipboard and scratch directories.

  Each must be **inventoried per surface (ADR-0006), measured, not assumed**.
- **Open question, deliberately left open (the owner has not yet been asked):** is **transient transit**
  permitted, meaning material read in passing but not stored? Until it is answered, no control may
  assume either answer.
- **For adopters:** this is the reference posture. An adopter whose machine legitimately holds employer
  or client material needs a **containment posture, which this ADR does not provide**. Adopting this one
  would give them a false sense of coverage.
- Bad: a broad reading of "persistence" combined with harness-native transcripts (ADR-0005) means the
  harness itself can persist anything that reaches a prompt. Ingress prevention is therefore the
  primary control here, not a secondary one.

## Amendment 2026-10-01: the per-surface persistence inventory

The inventory this record asked for is [`docs/persistence-inventory.md`](../persistence-inventory.md)
(Issue #6). It covers Claude Code, the Claude desktop app including Cowork, Codex, the ChatGPT desktop
app and Kiro IDE. It records Kiro CLI as not installed. It was measured from metadata only, and no
store's content was read. **So it cannot say whether any store holds confidential data. It says
which stores would keep such data, and for how long, if the data ever reached them.** Ingress
prevention is the primary control here (see the consequence above), so a store that keeps everything
indefinitely turns any single ingress failure into permanent persistence.

**Stores that conflict with this record.** Each one keeps whatever reaches a prompt, a tool result, an
upload or a working folder, and none has a documented retention:

1. **Cowork's session store** in the Claude desktop app. It holds transcripts, uploads and outputs, at
   the order of hundreds of megabytes, with files older than 30 days. Cowork VM images sit beside it
   at the order of gigabytes. Their contents were not inspected.
2. **Codex**: session rollouts and SQLite thread and log databases, each at the order of hundreds of
   megabytes, plus memories. Memories are on here, though off by default. They ingest threads that
   used MCP tools, and they keep their own git history. A switch that imports another surface's
   transcripts is also on, so one surface's data can be copied into a second store.
3. **Claude Code's stores outside its 30-day sweep.** These are the prompt history (every typed
   prompt, kept until deleted), auto memory (never swept), the last session's first prompt (kept per
   project in the main state file), and MCP server logs in the OS cache directory, which hold files
   older than 30 days. The transcripts themselves are swept at 30 days, and that sweep was measured.
4. **Kiro IDE** agent chat sessions and its agent index store, both with files older than 30 days.
5. **ChatGPT desktop's local conversation cache**, which holds files older than 30 days. The vendor
   states that hosted retention settings should not be assumed to apply to local records.

**Conflict with ADR-0005.** That record already noted that "No auditable record" binds the firewall
but not the harness. The inventory extends that observation from Claude Code to every surface. Each
surface writes its own transcript of an intervention notice, and Codex can also turn one into memory.
That is why the category-only notice is the only part of a detection this repository controls on
disk.

**Candidate controls: proposals only; none is decided or installed.** Setting names were checked
against vendor documentation on 2026-10-01; the URLs are in the inventory. Each control is a setting
inside one harness, and none of them can delete a store that a different harness writes.

| Store | Candidate control | Evidence for the control |
| --- | --- | --- |
| Claude Code transcripts | Lower `cleanupPeriodDays` from its default of 30 (the minimum is 1) | documented; the default sweep was measured working |
| Claude Code transcripts and prompt history, for a sensitive session | `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1`, or `--no-session-persistence` with `-p` | documented |
| Claude Code prompt history | No retention key exists. Use `claude project purge`, or a scheduled truncation rendered by this repository | documented (purge); the scheduled job is a proposal |
| Claude Code auto memory | `autoMemoryEnabled: false` | documented |
| Claude Code file checkpoints | `fileCheckpointingEnabled: false` (this loses `/rewind` code restore) | documented |
| Desktop and Cowork transcripts kept by Claude Code | `desktopSessionCleanupPeriodDays` (user or managed scope, Claude Code 2.1.248+) | documented; **whether it reaches the Cowork session store is unverified** |
| Cowork session store, VM images, desktop app logs, MCP server logs | None documented. Candidate: an OS-level scheduled sweep by age, rendered by this repository | assumed; it would first need a measurement that the app tolerates it |
| Codex prompt history | `[history] persistence = "none"` or `history.max_bytes` | documented |
| Codex memories | `[features] memories = false`, or keep memories on and set `memories.disable_on_external_context = true` with a lower `memories.max_rollout_age_days` | documented |
| Codex rollouts and databases | None documented. `sqlite_home` and `log_dir` relocate the data and do not limit retention | none found |
| Codex cross-surface import | Turn off `external-agent-import-sync-enabled` | the key was observed in config; **it is not in the documentation checked** |
| Kiro IDE, ChatGPT desktop | None documented. Candidate: the same OS-level sweep | assumed |

**Still open:** the transient-transit question above. These controls shorten how long data persists.
None of them stops a store from holding something for the length of its retention window. Whether
that window is acceptable is the same open question.

## Links

- `AGENTS.md`, "Fundamental purpose". ADR-0005 (transcripts observation). ADR-0006 (surfaces).
- [`docs/persistence-inventory.md`](../persistence-inventory.md) (2026-10-01 amendment).
