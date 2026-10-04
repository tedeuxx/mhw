# 0022 — Restart after active customization changes

## Status

Accepted requirement, 2026-10-02, on the owner's explicit instruction: never continue a session
after changing user or workspace customization that requires restart; always multiharness.
The implementation below has synthetic coverage; installation is not native enforcement evidence.

## Context and problem

Writing a setting does not prove an already-running agent loaded it. Continuing with stale policy
produces different behavior across harnesses and makes installed/loaded claims unreliable.

## Decision drivers

- One user-level rule across CLI and desktop surfaces, including workspace customization.
- Stop stale work without collecting configuration contents or session transcripts.
- Preserve native trust, permissions and truthful coverage claims.
- Keep authorized delivery possible by staging, validating and publishing before installation.

## Considered options

1. Shared instructions plus native tool gates where their contract is known (chosen): practical
   protection with explicit gaps and a fresh-session canary.
2. Instructions alone: portable and simpler, but no deterministic refusal of covered stale tools.
3. Kill every application after any edit: stronger interruption but unsafe for unsaved work and
   unrelated sessions; it still does not prove correct configuration loading.

## Decision outcome

The global brief requires a sanitized handoff before changing active startup-loaded customization,
installation last, then no further task work in the affected session. Only verified hot reload can
avoid restart. Source edits in an inactive checkout do not themselves install user configuration.
Updating an active workspace instruction is itself a restart boundary when not demonstrably reloaded.
Publication can precede installation; installation evidence can be reported in the conversation.

`global/hooks/restart_guard.py` uses SessionStart with source `startup` to save an opaque metadata
fingerprint under a hashed session ID. PreToolUse compares it before covered tools. Missing or changed
baselines deny the call. Resume, clear and compaction cannot reset a stale baseline. A genuinely new
session ID establishes a new baseline. The installer registers these hooks for Claude Code and Codex
on macOS/Linux; Codex trust remains an owner action in `/hooks`. SessionStart context/stop handling
varies by vendor: **PreToolUse is the blocking mechanism**, not a claim to prevent app launch or text.

Only path metadata is inspected: modification time, size, inode and mode. Only an aggregate hash is
persisted, in private files: no paths, configuration values, tool inputs or transcript. The known
user and project paths are declared in `NATIVE`; managed helper scripts are included. Changes to
metadata alone can conservatively require restart. External symlink targets, metadata-preserving
edits, non-listed paths, tool calls the harness does not route through hooks, and disabled/untrusted
hooks are outside coverage. This is not tamper-resistant managed policy. Opaque session state is not
automatically pruned because deleting it would block a still-live session; remove it only when those
sessions have ended.

The hook process's working directory selects the workspace; a `cwd` value in the event payload is
ignored. Native verification must confirm the vendor runs hooks from that workspace. An unexpected
execution directory is a coverage gap, not evidence that a caller-supplied path should be trusted.

| Surface / OS | Carrier | Evidence / remaining boundary |
| --- | --- | --- |
| Claude Code, macOS/Linux | User brief + native hook registration | Synthetic pass/block and installer tests; fresh native canary still required |
| Codex CLI, macOS/Linux | User brief + hooks.json | Same; owner trust required |
| Codex desktop, macOS/Linux | Shared user brief/config | App hook routing not measured; instruction fallback |
| Kiro CLI/IDE | Global steering brief | Instruction only; CLI absent on reference PATH; native v3 hooks need payload/routing validation |
| Claude desktop/Cowork | Generated account-instructions handoff | Instruction only; account application is separate from file generation |
| ChatGPT desktop/work | Generated global brief for supported instruction surfaces | No automatic installation or measured hook route |
| Windows | PowerShell-installed user briefs | Instruction only; core Python tests are portable, native hooks not installed |

No minimum native version is established by these synthetic tests. Kiro's documented CLI v3/IDE 1.x
hooks are not assumed compatible with the Claude/Codex event protocol. The core's Kiro fingerprint
selector is not a registered Kiro adapter. Desktop restrictions are not bypassed with private stores.

### Fresh-session verification

1. Open a genuinely new session after installation; restart the app if it retains old configuration.
2. Inspect native hooks and ask the owner to trust changed Codex commands when required.
3. In a disposable workspace, allow a harmless read, modify a tracked synthetic configuration,
   observe the next covered read being denied, then verify a fresh session allows it again.
4. Record only version, surface and pass/block outcomes. Never use real private configuration values
   as canary input or infer another harness's result from one passing harness.

## Consequences

Good: a uniform restart obligation; deterministic stale-tool refusal on known hook routes; no
configuration-content retention; portable policy even where native gates are not yet implemented.

Bad: some surfaces remain instruction-only; metadata changes may cause extra restarts; hooks cannot
prevent the first configuration-changing tool (they detect it before the next tool), nor an agent's
unhooked prose; changing the hook registration itself may need restart before the guard is active.
An installer warning and the user-level instruction cover that bootstrap boundary without claiming
technical enforcement there.

### 2026-10-02 diagnostic correction (no change to the restart requirement)

The initial refusal did not distinguish an absent baseline from an aggregate mismatch. The guard
now emits separate stable reason codes, acknowledges its own SessionStart baseline creation or
validation, and provides a read-only `--diagnose` command. That command never creates or replaces
state. Malformed baseline JSON is explicitly refused instead of escaping as an unhandled exception.
The aggregate-only format, watched paths, native trust boundary and no-reset rule are unchanged.
The historical first-tool refusal remains unattributed: no exact affected session ID or native
startup trace was available. Plugin drift is not established as its cause. See the
[diagnostic evidence and fresh-session procedure](../restart-guard-diagnosis.md).

## Links

- [Claude hooks](https://code.claude.com/docs/en/hooks)
- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Kiro hook actions](https://kiro.dev/docs/hooks/actions/)
- [Global source](../../global/AGENTS.md)
- [Guard](../../global/hooks/restart_guard.py)
