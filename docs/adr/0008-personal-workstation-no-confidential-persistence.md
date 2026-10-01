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
app and Kiro IDE, and records that Kiro CLI is not installed. It was measured from metadata only:
no store's content was read. **So it cannot say whether any store holds confidential data. It
says which stores would keep such data, and for how long, if it ever reached them.** Because ingress
prevention is the primary control here (consequence above), a store that keeps everything indefinitely
turns any single ingress failure into permanent persistence.

**Stores that conflict with this record**, ordered by how much they keep and how long. Each keeps
whatever reaches a prompt, a tool result, an upload or a working folder, with no retention found:

1. **Cowork's session store** (Claude desktop app): ~600 MB across ~123 sessions, with uploaded
   files and generated outputs, and 1,447 files older than 30 days. No documented retention for this
   store. Next to it, ~8.5 GB of VM images whose contents were not inspected.
2. **Codex session rollouts, thread and log databases, and memories**: ~800 MB of rollouts and ~370 MB
   of SQLite, none with a documented retention. Memories are on here (off by default), ingest threads
   that used MCP tools, and keep their own git history. A switch that imports another surface's
   transcripts is on, so one surface's data can be copied into a second store.
3. **Claude Code's stores outside its 30-day sweep**: the prompt history (every typed prompt, kept
   until deleted), auto memory (never swept), the last session's first prompt kept per project in the
   main state file, and MCP server logs in the OS cache directory, which go back to May 2026. The
   transcripts themselves are swept at 30 days, and that was measured.
4. **Kiro IDE**: 2,656 chat files back to January 2026, a workspace code index, and editor local
   history, with no documented retention. Kiro is not in use, so this store is old rather than growing.
5. **ChatGPT desktop's local conversation cache**, back to January 2026. The vendor states that hosted
   retention settings should not be assumed to apply to local records.

**Conflict with ADR-0005.** "No auditable record" binds the firewall, and ADR-0005 already recorded
that it does not bind the harness. The inventory widens that observation from Claude Code to every
surface: each one writes its own transcript of an intervention notice, and Codex can also distil it
into memory. So a category-only notice is the only part of a detection that this repository controls
on disk.

**Candidate controls. Proposals only, none decided or installed.** Setting names were checked against
vendor documentation on 2026-10-01 (URLs in the inventory). Each is an instruction to a harness. None
can delete a store that a different harness writes.

| Store | Candidate control | Evidence for the control |
| --- | --- | --- |
| Claude Code transcripts | Lower `cleanupPeriodDays` from the default 30 (minimum 1) | documented; the default sweep measured working |
| Claude Code transcripts and prompt history, for a sensitive session | `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1`; `--no-session-persistence` with `-p` | documented |
| Claude Code prompt history | No retention key exists. `claude project purge`, or a scheduled truncation rendered by this repository | documented (purge); the scheduled job is a proposal |
| Claude Code auto memory | `autoMemoryEnabled: false`, or a reviewed memory directory | documented |
| Claude Code file checkpoints | `fileCheckpointingEnabled: false` (loses `/rewind` code restore) | documented |
| Claude Desktop and Cowork transcripts kept by Claude Code | `desktopSessionCleanupPeriodDays` (user or managed scope, Claude Code 2.1.248+) | documented; **whether it reaches the Cowork session store is unverified** |
| Cowork session store, VM images, desktop app logs, MCP server logs | None documented. Candidate: an OS-level scheduled sweep by age, rendered by this repository | assumed; it would need a measurement that the app tolerates it |
| Codex prompt history | `[history] persistence = "none"`, or `history.max_bytes` | documented |
| Codex memories | `[features] memories = false`; or keep them and set `memories.disable_on_external_context = true` and a lower `memories.max_rollout_age_days` | documented |
| Codex rollouts and databases | None documented (`sqlite_home` and `log_dir` relocate; they do not limit) | none found |
| Codex cross-surface import | turn off `external-agent-import-sync-enabled` | the key was observed in the config; **not in the documentation checked** |
| Kiro IDE, ChatGPT desktop | None documented. Candidate: the same OS-level sweep | assumed |

**Still open:** the transient-transit question above. These controls shorten persistence. None of them
prevents a store from holding something for the length of its retention window. Whether that window is
acceptable is the same question.

## Links

- `AGENTS.md`, "Fundamental purpose". ADR-0005 (transcripts observation). ADR-0006 (surfaces).
- [`docs/persistence-inventory.md`](../persistence-inventory.md) (2026-10-01 amendment).
