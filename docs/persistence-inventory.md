# Local persistence inventory, per agent surface

**What this is.** For each agent surface in scope ([ADR-0006](adr/0006-coverage-scope-all-agent-surfaces.md)),
what it stores on the local disk, where (as a category), how long it is kept, and which setting
controls that. It is the inventory that
[ADR-0008](adr/0008-personal-workstation-no-confidential-persistence.md) asks for: "persistence" is
read broadly, and each store must be inventoried per surface, measured rather than assumed. Its
conflicts with ADR-0008 and ADR-0005, and the candidate controls, are in ADR-0008's 2026-10-01
amendment on this inventory.

**Measured on the reference workstation (macOS, see the README) on 2026-10-01.** Sizes, counts and
dates describe that day and drift every session. They are evidence that a store exists and holds
data. They are not a claim about what the data is.

**What this does not say.** No store's content was opened. So this document cannot say whether any
store holds employer or client confidential data. It says which stores **would** keep such data if
it ever reached a prompt, a tool result, an upload or a working folder, and for how long.

## Evidence levels

Each row carries two evidence levels, because they are often different:

- **Store:** *measured* means the store was seen to exist through directory listings and file
  metadata (counts, sizes, modification dates). *documented* means the vendor's documentation names it.
  *assumed* means neither.
- **Retention:** *documented* means the vendor states the rule (the URL is given). *measured* means
  the modification dates are consistent, or inconsistent, with a rule (for example "no file older than
  30 days survives"). *assumed* means neither, and *none found* means the documentation checked does
  not state one.

"Location" is a category, never a path. Where the vendor documents an exact path, the cited page has it.

## Claude Code (CLI), version 2.1.286

The vendor documents this surface's local data in detail:
[Application data](https://code.claude.com/docs/en/claude-directory#application-data). Its stores are
plaintext, "not encrypted at rest. OS file permissions are the only protection"
([Plaintext storage](https://code.claude.com/docs/en/claude-directory#plaintext-storage)).

| Store | Location (category) | Observed 2026-10-01 | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| Session transcripts: every message, tool call and tool result, including subagent transcripts and spilled large tool outputs | per-project directories under the CLI's user config directory | ~1.1 GB; 192 session transcripts, 710 subagent transcripts, 318 spilled tool outputs, across 36 project directories. Oldest session transcript 28 days old | Deleted after `cleanupPeriodDays` days (default `30`, minimum `1`, `0` is invalid) by a background sweep at session start. Writing can be stopped per session with `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1`, or `--no-session-persistence` with `-p`. [settings](https://code.claude.com/docs/en/settings-reference#cleanupperioddays), [env vars](https://code.claude.com/docs/en/env-vars) | measured / documented, and measured consistent: no session transcript older than 30 days was found. The key is unset on this machine, so the default applies |
| Prompt history: every prompt typed, with project path | one JSONL file in the CLI's user config directory | ~800 KB, 3,203 lines | **Kept until deleted.** Not part of the sweep. `CLAUDE_CODE_SKIP_PROMPT_HISTORY=1` stops new writes; `claude project purge` removes one project's lines. [Kept until you delete them](https://code.claude.com/docs/en/claude-directory#kept-until-you-delete-them) | measured / documented |
| Auto memory: notes the agent writes for future sessions | a memory directory per project (on this machine, one shared directory set by `autoMemoryDirectory`) | 91 files; files older than 30 days present | **Never swept**; the directory is removed only after it has been empty for a whole retention period. Off with `autoMemoryEnabled: false` or `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`. [memory](https://code.claude.com/docs/en/memory#auto-memory), [settings](https://code.claude.com/docs/en/settings-reference#automemoryenabled) | measured / documented, and measured consistent |
| File checkpoints: pre-edit copies of every file the agent changed | per-session directories under the CLI's user config directory | 577 files, ~7.6 MB | Swept with `cleanupPeriodDays`; capped at the 100 most recent checkpoints. Off with `fileCheckpointingEnabled: false`. [settings](https://code.claude.com/docs/en/settings-reference#filecheckpointingenabled) | measured / documented |
| Paste cache: contents of large pastes | directory under the CLI's user config directory | 7 files | Swept with `cleanupPeriodDays` | measured / documented |
| Shell snapshots, session environment, task lists, plan files, debug logs | directories under the CLI's user config directory | small; debug logs present (2 files) | Swept with `cleanupPeriodDays`; shell snapshots removed on clean exit | measured / documented |
| Per-project state in the main state file, including the **first prompt of the last session** and per-project file examples | the CLI's main state file in the home directory | ~95 KB; 13 project entries; key names include a last-session first-prompt field | **None found** for this field; the entry is removed by `claude project purge`. Five rotated backups of the file are kept | measured (key names only) / assumed |
| Backups of that state file | directory under the CLI's user config directory | 5 files | The five newest are kept. [Cleaned up automatically](https://code.claude.com/docs/en/claude-directory#cleaned-up-automatically) | measured / documented, and measured consistent |
| MCP server logs | per-working-directory folders in the user's OS cache directory | ~95 MB, 15,471 JSONL files across ~5,500 per-server log folders; oldest from May 2026; 6,650 files older than 30 days | **None found.** These are not in the documented sweep list, and files far older than 30 days are present | measured / measured: not swept |
| Session scratchpad: files the agent writes for itself | per-session directory under the OS temp directory | not counted | Deleted with the transcript; the OS may clear it earlier | documented / documented |
| Images pasted or attached | per-session directory under the OS temp directory | not checked | Swept with `cleanupPeriodDays` | documented / documented |
| Working folders the agent can reach | the session's working directory and any added directories | — | Not a harness store: what the agent writes there is kept by the user's own files and version control | documented / not applicable |

Plugins, skills and the managed configuration also live under the user config directory. They are
code and configuration, not session data, and are left out.

## Claude desktop app, including Cowork

The desktop app is an Electron application. Its own data directory sits in the user's OS
application-support directory.

| Store | Location (category) | Observed 2026-10-01 | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| **Cowork session store**: per-session transcripts (JSONL), per-session agent configuration, **uploads**, **outputs**, tool results, subagent transcripts, plugin data | a sessions directory inside the desktop app's application-support directory | **~600 MB, 2,302 files, ~123 sessions**; 68 uploaded files, 121 output files, 67 CSV files; oldest from May 2026; **1,447 files older than 30 days** | **None found.** Claude Code's docs give Desktop and Cowork transcripts their own key, `desktopSessionCleanupPeriodDays` (user or managed scope, default `0` = no age limit, Claude Code 2.1.248 or later) ([settings](https://code.claude.com/docs/en/settings-reference#desktopsessioncleanupperioddays)). Whether that key reaches this store was not verified | measured / measured: not pruned at 30 days |
| Cowork virtual-machine images | a VM bundle directory inside the app's application-support directory | ~8.5 GB, 14 files | None found | measured / assumed |
| Cowork user-files root and trusted folders: the folders a Cowork agent can work over | user-chosen folders in the home directory, recorded in the app's config | 1 user-files root (33 files); 3 trusted-folder entries: the user-files root, and two that point at one larger folder (~12,600 files); 4 remote-session folder grants; 1 routine folder grant | Not a harness store: these are the user's own files. The grants persist in the app config until revoked | measured (counts, not names) / not applicable |
| Chromium web storage: cache, code cache, local storage, session storage, IndexedDB, partitions | directories inside the app's application-support directory | HTTP cache ~740 MB (30,606 files) and code cache ~235 MB, both from May 2026 | None found; ordinary Chromium cache behaviour assumed | measured / assumed |
| App logs, including **per-MCP-server logs** | the app's folder in the user's OS log directory | ~72 MB, 41 log files, 22 of them MCP server logs; oldest from June 2026; 9 files older than 30 days | None found | measured / measured: not pruned at 30 days |
| Crash reports | Crashpad and an error-reporting directory inside the app's application-support directory | 1 crash file, 2 error-reporting files | None found | measured / assumed |
| MCP and preferences config, plus **10 timestamped backups** of it | the app's config file and backups in its application-support directory | 12 MCP servers; 4 environment keys whose names indicate a credential | Backups are never pruned (backups from July 2026 present) | measured (key names only) / measured |
| Account token cache | the app's internal config file | key names show an OAuth token cache | Not a session store; it is a credential, outside ADR-0008 and inside the workstation-security category | measured (key names only) / not applicable |
| Desktop extensions and their settings | directories inside the app's application-support directory | ~220 MB of extension code, 6 settings files | Code, not session data | measured / not applicable |

## Codex (CLI and the app inside the ChatGPT desktop app), CLI 0.155.0-alpha.16.4

The Codex CLI on this machine is bundled with the ChatGPT desktop app, and both use one state
directory, `CODEX_HOME` ([state locations](https://developers.openai.com/codex/config-advanced#config-and-state-locations)).

| Store | Location (category) | Observed 2026-10-01 | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| **Session rollouts**: full per-session event logs, one JSONL file per session, in date folders | a sessions directory under `CODEX_HOME` | **~800 MB, 443 files**; oldest 24 days old (the directory dates from the install, so 30-day behaviour is not observable yet) | **None found.** The documented history keys cover `history.jsonl` only | measured / none found |
| Prompt history | one JSONL file under `CODEX_HOME` | 38 lines | Kept by default. `[history] persistence = "none"` turns it off; `history.max_bytes` caps it by dropping the oldest entries. [history persistence](https://developers.openai.com/codex/config-advanced#history-persistence) | measured / documented. The key is unset here, so it is on |
| **Thread history, state, queue and goals databases** (SQLite) | database files under `CODEX_HOME` | thread history ~170 MB, state ~20 MB; table names only were listed (threads, thread items, thread turns, thread attachments) | **None found.** `sqlite_home` relocates them and is only a managed requirement; it does not limit retention. [config reference](https://developers.openai.com/codex/config-reference) | measured (schema names only) / none found |
| **Log database** (SQLite) | one database file under `CODEX_HOME` | ~180 MB | None found. `log_dir` relocates file logs (managed requirement only) | measured / none found |
| **Memories**: summaries, durable entries, recent inputs and evidence from prior chats; the directory is itself a **git repository**, so earlier versions persist | a memories directory and a memories database under `CODEX_HOME` | 205 files including 81 rollout summaries; a git history is present | Memories are **off by default** and **on here** (`[features] memories = true`). Inputs are threads up to `memories.max_rollout_age_days` old (default `30`); `memories.generate_memories = false` stops new inputs; `memories.disable_on_external_context = true` keeps threads that used MCP or web search out (default `false`). No retention for the memory files themselves. [memories](https://developers.openai.com/codex/memories), [config reference](https://developers.openai.com/codex/config-reference) | measured / documented for the inputs, none found for the files |
| **Imports of another surface's transcripts** | a Cowork-transcript import directory and import-history files under `CODEX_HOME` | import history files present; the import directory is empty today; a key named `external-agent-import-sync-enabled` is set to on | None found. The key is **not in the configuration reference** checked | measured / none found |
| Attachments | an attachments directory under `CODEX_HOME` | 3 files | None found | measured / none found |
| Computer-use sessions, including **screenshots** | a computer-use directory under `CODEX_HOME` | 90 PNG files among 169 | None found. The vendor states that "Appshots" (frontmost-window screenshots) are stored "locally in the session file". [Appshots](https://learn.chatgpt.com/docs/appshots) | measured / none found |
| Generated images | a generated-images directory under `CODEX_HOME` | 10 PNG files | None found | measured / none found |
| Scratch and temporary trees (plugin syncs and git checkouts) | a hidden temp directory under `CODEX_HOME` | ~225 MB, 7,784 files | None found | measured / none found |
| Embedded browser profile: cookies, local storage, autofill, sync data | the Codex app's directory in the user's OS application-support directory | ~145 MB, 667 files | None found | measured / none found |
| App logs and caches | the Codex app's folders in the user's OS log and cache directories | logs ~8.6 MB (49 files); caches ~2 GB, mostly bundled code | None found | measured / none found |
| Persona and browser snapshots, app global state (and a full backup of it) | files under `CODEX_HOME` | global state ~2.6 MB, plus a same-size backup | None found | measured / none found |
| Credentials, and **MCP environment entries with credential-named keys** | the auth file and the user config file under `CODEX_HOME` | the config carries 25 MCP server tables; several environment keys are named as tokens, API keys or client secrets | Not session data. Recorded because a plaintext credential in a config file is in the workstation-security category ([`AGENTS.md`](../AGENTS.md)) | measured (key names only) / not applicable |
| Working folders the agent can reach | trusted projects and the sandbox's writable roots (`sandbox_mode = "workspace-write"`) | 5 trusted project entries | Not a harness store | measured (counts) / not applicable |

## ChatGPT desktop app

The app now hosts Codex too (above). What is listed here is the chat surface's own store.

| Store | Location (category) | Observed 2026-10-01 | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| **Local conversation cache**, including project conversations and drafts | per-account directories in the app's application-support directory | 137 conversation files (123 plus 14 in projects); oldest January 2026 | **None found.** The vendor itself warns: "Do not assume hosted-conversation retention settings apply to every local artifact." [ChatGPT Work local security](https://learn.chatgpt.com/docs/enterprise/chatgpt-work-local-security) | measured / none found |
| Account workspace data, including a **health-related hints directory** | the app's application-support directory | the directory exists and holds no files | None found | measured (empty) / none found |
| Pairing extensions, models and assistant ("GPTs") caches | the app's application-support directory | 42 pairing-extension files; small caches | None found | measured / none found |
| HTTP storage and crash reports | the app's HTTP storage directory; an error-reporting directory | one HTTP-storage database; 2 crash-report files | None found | measured / assumed |
| Computer Use and Appshots | shared with the Codex stores above | see Codex | see Codex | — |

A separate OpenAI browser app is also installed. It is outside ADR-0006's scope and was not
inventoried; its data directory was last written in April 2026.

## Kiro IDE, version 1.0.437

Kiro IDE is a VS Code-based editor. On this machine it has **no active subscription** (ADR-0003); its
newest session data dates from September 2026.

| Store | Location (category) | Observed 2026-10-01 | Retention: default, and the setting | Evidence (store / retention) |
| --- | --- | --- | --- | --- |
| **Agent chat sessions** | the Kiro agent's global-storage directory in the IDE's application-support directory | **2,656 chat files**, oldest January 2026, **all older than 30 days** | **None found.** The docs say compaction keeps a summary "in the IDE's internal session storage" but give no retention. [compaction](https://kiro.dev/docs/ide/whats-new-v1/compaction) | measured / measured: not pruned |
| **Workspace code index**: vector-database files in an index directory. That it indexes workspace code is inferred from the format and the directory name, not read | the Kiro agent's global-storage directory | ~630 index files | None found | measured / none found |
| Files with workspace-file extensions, a diffs directory and per-workspace session folders. That these are agent copies of workspace files is an inference, not read | the Kiro agent's global-storage directory | ~840 infrastructure-as-code files among others | None found | measured / none found |
| Editor local history: earlier versions of every file saved in the editor | the editor's user history directory | 631 files in 90 entries; 629 older than 30 days | Not checked against docs; inherited from the VS Code base | measured / assumed |
| Workspace storage, web storage, cache | the IDE's application-support directory | ~25 MB web storage, ~93 MB cache | None found | measured / assumed |
| Logs | the IDE's log directory and a small logs folder in the user's Kiro directory | 416 log files from February 2026; 344 older than 30 days | None found | measured / measured: not pruned |
| User configuration, steering (the global brief), extensions | the user's Kiro directory | extensions ~900 MB; one steering file | Configuration, not session data | measured / not applicable |

## Kiro CLI

**Not installed** on the reference workstation: no binary was found on the `PATH` or in the usual
install locations, and the CLI's data directory does not exist. Its documentation states that it saves
every chat turn to a local per-directory database under the user's Kiro directory, and that sessions
are deleted one at a time (`kiro-cli chat --delete-session <id>`) or swept when empty
([session management](https://kiro.dev/docs/cli/chat/session-management)). No retention period is
documented. Evidence: **documented only**.

## Method

Every number above comes from metadata. The commands were of these forms, run against each
surface's directories (paths are given here as placeholders):

```sh
find <store> -type f | wc -l                       # file count
du -sk <store>                                     # size
find <store> -type f -exec stat -f %m {} +         # modification times, reduced to oldest and newest
find <store> -type f -mtime +30 | wc -l            # files older than 30 days
jq 'keys' <settings.json>                          # key names, never values
grep -E '^\s*(\[|[A-Za-z0-9_.-]+\s*=)' <config.toml> | sed -E 's/\s*=.*//'   # TOML key names only
sqlite3 -readonly <db> '.tables'                   # table names only
```

Values were read only for non-secret retention and feature switches (for example whether
`cleanupPeriodDays` is set, and whether Codex memories are on). Directory names that could reveal a
project, a person or an account were collapsed to counts before they were recorded.

Vendor documentation was fetched on 2026-10-01 from the URLs cited in each row.

## What was not checked

- **Content.** No transcript, memory, upload, cache, log or database row was opened, read, searched or
  hashed. Whether any store holds employer or client confidential data is therefore **unknown**.
- **Whether `desktopSessionCleanupPeriodDays` reaches the Cowork session store.** The Cowork store
  contains per-session Claude Code configuration directories, which suggests Cowork runs Claude Code
  with its own configuration per session. The key may then never apply to it. Settling it needs a
  measurement in a throwaway session.
- **Whether Codex `history.persistence = "none"` also stops the session rollouts and the thread
  database.** The documentation names `history.jsonl` only.
- **The Codex `chronicle` feature switch**, which is on, and the `external-agent-import-sync-enabled`
  key. Neither was found in the documentation checked.
- **Vendor-side (cloud) retention.** Out of scope: this is a local inventory.
- **The OS layer**: Spotlight indexes, Time Machine or other backups, iCloud sync of any of these
  directories, and swap. Any of them can copy a store out of reach of a harness setting.
- **The Cowork virtual-machine images and the Codex embedded browser profile**, which were sized but
  not opened, so what they hold beyond their own files is unknown.
- **Windows and Linux.** Only the macOS reference install was measured.
- **This inventory's own trace.** The session that produced it ran the listings above, so its Claude
  Code transcript holds those listings (names and numbers, no store content). It is subject to the
  30-day sweep like any other transcript.
