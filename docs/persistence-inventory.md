# Local persistence inventory, per agent surface

**What this is.** For each agent surface in scope ([ADR-0006](adr/0006-coverage-scope-all-agent-surfaces.md)),
this lists what the surface stores on the local disk, where it stores it (as a category), how long it
keeps it, and which setting controls that. It is the inventory that
[ADR-0008](adr/0008-personal-workstation-no-confidential-persistence.md) asks for. That record reads
"persistence" broadly and requires each store to be inventoried per surface, measured rather than
assumed. The conflicts this inventory finds with ADR-0008 and ADR-0005, and the candidate controls,
are in ADR-0008's 2026-10-01 amendment on this inventory.

**Measured on the macOS reference workstation on 2026-10-01.** Sizes are given only as rough orders
of magnitude, and the only age fact recorded is whether a store holds files older than 30 days. No
exact counts and no dates are published. The inventory needs to know that a store exists, that it
holds data, and whether that data outlives a 30-day window. It does not need a usage profile of the
owner.

**What this does not say.** No store's content was opened. So this document cannot say whether any
store holds employer or client confidential data, nor what kind of data any store holds. What it
does say is which stores **would** keep such data if it ever reached a prompt, a tool result, an
upload or a working folder, and for how long they would keep it.

## Evidence levels

Each row carries two evidence levels:

- **Store:** *measured* means directory listings and file metadata showed the store exists. *documented*
  means the vendor's documentation names it. *assumed* means neither.
- **Retention:** *documented* means the vendor states the rule (the URL is given). *measured* means
  the files' modification times are consistent with a rule, or inconsistent with it. *none found*
  means the documentation checked states no rule.

"Location" is a category, never a path. Where the vendor documents an exact path, the cited page has it.

## Claude Code (CLI)

The vendor documents this surface's local data in
[Application data](https://code.claude.com/docs/en/claude-directory#application-data). Those files are
plaintext and "not encrypted at rest. OS file permissions are the only protection"
([Plaintext storage](https://code.claude.com/docs/en/claude-directory#plaintext-storage)).

| Store | Location (category) | Observed | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| Session transcripts: every message, tool call and tool result, with subagent transcripts and spilled large tool outputs | per-project directories under the CLI's user config directory | present, order of a gigabyte; files older than 30 days: no | Deleted after `cleanupPeriodDays` days (default `30`, minimum `1`, `0` fails validation) by a background sweep. `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` stops writing; with `-p`, so does `--no-session-persistence`. See [settings](https://code.claude.com/docs/en/settings-reference#cleanupperioddays) and [env vars](https://code.claude.com/docs/en/env-vars) | measured / documented, and measured consistent. The key is unset here, so the default applies |
| Prompt history: every typed prompt, with its project path | one file in the CLI's user config directory | present | **Kept until deleted**, outside the sweep. `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` stops new writes, and `claude project purge` removes one project's lines. See [Kept until you delete them](https://code.claude.com/docs/en/claude-directory#kept-until-you-delete-them) | measured / documented |
| Auto memory: notes the agent writes for future sessions | a memory directory per project, or one directory set by `autoMemoryDirectory` (set here) | present; files older than 30 days: yes | **Never swept.** Turned off by `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. See [settings](https://code.claude.com/docs/en/settings-reference#automemoryenabled) | measured / documented, and measured consistent |
| File checkpoints: pre-edit copies of files the agent changed | per-session directories under the CLI's user config directory | present | Swept with `cleanupPeriodDays` and capped at the most recent checkpoints. Turned off by `fileCheckpointingEnabled: false`. See [settings](https://code.claude.com/docs/en/settings-reference#filecheckpointingenabled) | measured / documented |
| Paste cache, shell snapshots, session environment, debug logs | directories under the CLI's user config directory | present | Swept with `cleanupPeriodDays`; shell snapshots are also removed on a clean exit | measured / documented |
| Per-project state in the main state file, including a field holding the **last session's first prompt** | the CLI's main state file in the home directory | present (key names read, not values) | **None found** for that field. `claude project purge` removes the project's entry, and rotated backups of the file are kept | measured / none found |
| Backups of that state file | directory under the CLI's user config directory | present | The five newest are kept. See [Cleaned up automatically](https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically) | measured / documented, and measured consistent |
| MCP server logs | per-working-directory folders in the user's OS cache directory | present, order of a hundred megabytes; files older than 30 days: yes | **None found.** These logs are not in the documented sweep list | measured / measured: not swept |
| Session scratchpad, pasted or attached images | per-session directories under the OS temp directory | not measured | Deleted with the transcript; the OS may clear them earlier | documented / documented |
| Working folders the agent can reach | the session's working directory and added directories | — | Not a harness store | documented / not applicable |

## Claude desktop app, including Cowork

| Store | Location (category) | Observed | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| **Cowork session store**: per-session transcripts, agent configuration, uploads, outputs, tool results and subagent transcripts | a sessions directory inside the desktop app's application-support directory | present, order of hundreds of megabytes; files older than 30 days: **yes** | **None found.** Claude Code's docs provide `desktopSessionCleanupPeriodDays` (user or managed scope, default `0` meaning no age limit, Claude Code 2.1.248 or later) for Desktop and Cowork transcripts. See [settings](https://code.claude.com/docs/en/settings-reference#desktopsessioncleanupperioddays). Whether that key reaches this store was not verified | measured / measured: not pruned at 30 days |
| Cowork virtual-machine images | a VM bundle directory inside the app's application-support directory | present, order of gigabytes | None found | measured / none found |
| Cowork working folders: the user-files root and trusted-folder and folder-grant entries | user-chosen folders in the home directory, recorded in the app's config | present | Not a harness store; the grants persist in the app's config until revoked | measured / not applicable |
| Chromium web storage: HTTP cache, code cache, local storage, session storage, IndexedDB | inside the app's application-support directory | present, order of a gigabyte; files older than 30 days: yes | None found | measured / none found |
| App logs, including **per-MCP-server logs** | the app's folder in the user's OS log directory | present; files older than 30 days: yes | None found | measured / measured: not pruned at 30 days |
| Crash and error reports | inside the app's application-support directory | present | None found | measured / none found |
| MCP and preferences config, plus **timestamped backups** of it | the app's application-support directory | present; backups older than 30 days: yes | None found; backups are not pruned | measured / measured |
| Credentials | the app's internal config and MCP config | credential-named keys present (key names only) | Workstation-security category, outside ADR-0008 | measured / not applicable |

## Codex (CLI and the app inside the ChatGPT desktop app)

On this machine the Codex CLI is bundled with the ChatGPT desktop app, and both use the state directory
`CODEX_HOME` ([state locations](https://developers.openai.com/codex/config-advanced#config-and-state-locations)).

| Store | Location (category) | Observed | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| **Session rollouts**: one event log per session | a sessions directory under `CODEX_HOME` | present, order of hundreds of megabytes. The store is younger than 30 days, so a 30-day window cannot be observed yet | **None found.** The documented history keys cover `history.jsonl` only | measured / none found |
| Prompt history | one file under `CODEX_HOME` | present | Kept by default. `[history] persistence = "none"` turns it off, and `history.max_bytes` caps it by dropping the oldest entries. See [history persistence](https://developers.openai.com/codex/config-advanced#history-persistence) | measured / documented; the key is unset here |
| **Thread, state, queue and log databases** (SQLite) | database files under `CODEX_HOME` | present, order of hundreds of megabytes together (table names read, not rows) | **None found.** `sqlite_home` and `log_dir` relocate this data; they do not limit retention. See [config reference](https://developers.openai.com/codex/config-reference) | measured / none found |
| **Memories**: summaries, durable entries, recent inputs and evidence from prior chats. The directory is itself a **git repository**, so earlier versions persist | a memories directory and a memories database under `CODEX_HOME` | present | Off by default, **on here** (`[features] memories = true`). Inputs are threads up to `memories.max_rollout_age_days` old (default `30`). `memories.generate_memories = false` stops new inputs. `memories.disable_on_external_context = true` keeps out threads that used MCP or web search (default `false`). No retention is documented for the memory files themselves. See [memories](https://developers.openai.com/codex/memories) | measured / documented for inputs, none found for the files |
| **Imports of another surface's transcripts** | an import directory and import-history files under `CODEX_HOME` | present; the switch `external-agent-import-sync-enabled` is on | None found. The key is not in the configuration reference checked | measured / none found |
| Attachments, generated images, computer-use session data | directories under `CODEX_HOME` | present | None found. The vendor states that Appshots are stored "locally in the session file". See [Appshots](https://learn.chatgpt.com/docs/appshots) | measured / none found |
| Scratch and temporary trees | a hidden temp directory under `CODEX_HOME` | present, order of hundreds of megabytes | None found | measured / none found |
| Embedded browser profile: cookies, local storage, autofill, sync data | the Codex app's directory in the user's OS application-support directory | present | None found | measured / none found |
| App logs, caches, app global state and its backup | the app's OS log and cache directories; files under `CODEX_HOME` | present | None found | measured / none found |
| Credentials | the auth file and the user config file under `CODEX_HOME` | credential-named keys present in plaintext config (key names only) | Workstation-security category ([`AGENTS.md`](../AGENTS.md)), outside ADR-0008 | measured / not applicable |
| Working folders the agent can reach | trusted projects and the sandbox's writable roots (`sandbox_mode = "workspace-write"`) | present | Not a harness store | measured / not applicable |

## ChatGPT desktop app

The app also hosts Codex, which is covered above. This section covers the chat surface's own store.

| Store | Location (category) | Observed | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| **Local conversation cache**, including project conversations and drafts | per-account directories in the app's application-support directory | present; files older than 30 days: yes | **None found.** The vendor's own warning: "Do not assume hosted-conversation retention settings apply to every local artifact." See [ChatGPT Work local security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security) | measured / none found |
| Workspace data, pairing extensions and model caches | the app's application-support directory | present | None found | measured / none found |
| HTTP storage and crash reports | the app's HTTP storage directory and an error-reporting directory | present | None found | measured / none found |
| Computer Use and Appshots | shared with the Codex stores above | see Codex | see Codex | — |

## Kiro IDE

Kiro IDE is a VS Code-based editor. On this machine it has **no active subscription** (ADR-0003).

| Store | Location (category) | Observed | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| **Agent chat sessions** | the Kiro agent's global-storage directory in the IDE's application-support directory | present; files older than 30 days: **yes** | **None found.** The docs say compaction keeps a summary "in the IDE's internal session storage" but give no retention. See [compaction](https://kiro.dev/docs/ide/whats-new-v1/compaction) | measured / measured: not pruned at 30 days |
| Agent index store, diffs and per-workspace session folders | the Kiro agent's global-storage directory | present; files older than 30 days: yes | None found | measured / none found |
| Editor local history: earlier versions of files saved in the editor | the editor's user history directory | present; files older than 30 days: yes | Not checked against docs; it comes from the VS Code base | measured / assumed |
| Workspace storage, web storage, cache, logs | the IDE's application-support directory and the user's Kiro directory | present; log files older than 30 days: yes | None found | measured / measured: logs not pruned |

## Kiro CLI

**Not installed** on the reference workstation. No binary was found on the `PATH` or in the usual
install locations, and the CLI's data directory does not exist. Its documentation says it saves every
chat turn to a local per-directory database under the user's Kiro directory. Sessions are deleted one
at a time (`kiro-cli chat --delete-session <id>`) or swept when empty. See
[session management](https://kiro.dev/docs/cli/chat/session-management). No retention period is
documented. Evidence: **documented only**.

## Method

Everything above comes from metadata, gathered with commands of these forms (placeholders for paths).
Exact figures were reduced to `present` or an order of magnitude before anything was written here:

```sh
find <store> -type f | wc -l                       # does it hold files
du -sk <store>                                     # order of magnitude
find <store> -type f -mtime +30 | wc -l            # files older than 30 days: yes / no
jq 'keys' <settings.json>                          # key names, never values
grep -E '^\s*(\[|[A-Za-z0-9_.-]+\s*=)' <config.toml> | sed -E 's/\s*=.*//'   # TOML key names only
sqlite3 -readonly <db> '.tables'                   # table names only
```

Values were read only for retention and feature switches that are not secret, for example whether
`cleanupPeriodDays` is set and whether Codex memories are on. Vendor documentation was fetched on
2026-10-01 from the URLs cited in each row.

## What was not checked

- **Content.** No transcript, memory, upload, cache, log or database row was opened, read, searched or
  hashed. Whether any store holds employer or client confidential data, and what kind of data any
  store holds, is **unknown**.
- **Whether `desktopSessionCleanupPeriodDays` reaches the Cowork session store.** Each Cowork session
  carries its own Claude Code configuration directory, so the key may never apply there. A
  measurement in a throwaway session would settle it.
- **Whether Codex `history.persistence = "none"` also stops session rollouts and the databases.** The
  documentation names `history.jsonl` only.
- **The Codex `chronicle` and `external-agent-import-sync-enabled` keys.** Both are on, and neither
  appears in the documentation checked.
- **Vendor-side (cloud) retention.** Out of scope, because this is a local inventory.
- **The OS layer**: Spotlight, backups, iCloud sync and swap. Each can copy a store beyond the reach of
  a harness setting.
- **Windows and Linux.** Only the macOS reference install was measured.
- **This inventory's own trace.** The session that produced it holds the raw listings in its Claude
  Code transcript, which is swept at 30 days like any other transcript.
