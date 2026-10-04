# Restart guard diagnosis and native verification

## Evidence from the 2026-10-02 bugfix investigation

The reported first-tool refusal cannot be attributed retrospectively to either a missing baseline
or a changed fingerprint. The affected session ID was unavailable. The old refusal combined both
conditions, and the persisted state contains only an aggregate hash. No changed path can be recovered
from that hash. Plugin version differences are an unproven hypothesis, not an established cause.

Read-only inspection on the reference macOS workstation found:

- Claude Code `2.1.287`.
- Exactly one managed restart command for each of `SessionStart` and `PreToolUse`, in each native
  Claude Code and Codex user configuration; command hooks, no matcher, no asynchronous flag.
- Seven valid Claude Code baseline files; none matched the current bugfix workspace fingerprint.
  This is an inventory across unidentified sessions/workspaces, not evidence of seven stale sessions.
- Two Codex baselines; one matched. The current session's environment identifiers selected that
  matching baseline. Successful tool calls alone do not establish native Codex app hook routing.
- The installed guard matched the source after removing the installer's generated marker line.
- Available Claude diagnostic logs predated the incident. Session-file metadata in the two named
  workspaces did not identify the reported session. No transcript contents were read or copied.

No existing baseline was deleted, reset or replaced. No real configuration contents, session IDs,
transcripts or native hook trust were copied into this report or changed for diagnosis.

The confirmed bugs are diagnostic ambiguity and malformed-state handling. A JSON list in a baseline
raised `AttributeError` in the old implementation, rather than producing the required native denial.
The regression `test_malformed_state_denies_instead_of_raising` failed against the pre-fix source.
This malformed-state defect was reproduced with synthetic data; it is **not** the established cause
of the owner's incident, whose available state files were valid. No false-positive fingerprint
comparison has been demonstrated, so the watched set and restart policy are unchanged.

## Reproducible read-only diagnosis

Run from the exact workspace used by the native hook, using the same user/data environment. The
process working directory is authoritative; the event's `cwd` is intentionally ignored. An aggregate
mismatch can result from a different execution directory or metadata as well as a configuration edit.
It does not, on its own, prove which setting changed or whether the block is a false positive.

After installing this fix, the native refusal contains one of these stable reason codes:

| Code | Observation and next investigation |
| --- | --- |
| `missing_baseline` | No file for the supplied session ID; check exact session identity, native SessionStart routing, startup source, environment and write failures. Absence does not establish which of these failed. |
| `fingerprint_mismatch` | Valid baseline exists but the current aggregate differs; establish an independently observed change or reproduce with synthetic configuration. Do not infer a path from the hash. |
| `invalid_baseline` | Stored JSON or fingerprint shape is invalid; refuse without replacing it. |
| `invalid_session` | Session ID is missing or invalid in the event. |
| `unsafe_state` | The state directory or file is a symbolic link. |
| `guard_error` | Verification or baseline creation could not complete; error details and private paths are not emitted. |

`SessionStart` emits `Restart guard: baseline_created.` only after writing the baseline, or
`Restart guard: baseline_match.` when validating an existing one. A generic success message from
another hook is not evidence for this guard. A manually injected event tests the command only;
only a message observed through the native lifecycle establishes native routing.

For a known session, copy only its ID from the native session status. This shell pipeline reads it
without echo or a literal ID in shell history. It outputs only a reason code and never creates state,
even if passed a startup event. Exit 0 means match; exit 1 means another diagnostic outcome.

```sh
python3 -B -c 'import getpass,json; print(json.dumps({"session_id":getpass.getpass("Session ID: ")}))' |
  python3 -B global/hooks/restart_guard.py --harness claude-code --diagnose
```

Use `--harness codex` for Codex. After installation the equivalent standalone command uses
`"${XDG_DATA_HOME:-$HOME/.local/share}/personal-multi-harness-workstation-configuration/restart_guard.py"`
as the script path. Do not invoke a synthetic `SessionStart` against real state to establish or repair
a baseline. Do not delete state, change session IDs on a running session, disable hooks, or change
configuration to unblock work. If the affected agent session is refused, stop there; use the next
genuinely new session for investigation, not an alternate tool route from the blocked session.

Reproduce the portable synthetic regressions without reading real configuration:

```sh
python3 -B global/hooks/restart_guard_test.py
sh global/install.test.sh "$(mktemp -d)/installer"
```

These tests exercise missing/matching/changed/invalid baselines, read-only diagnosis, no reset through
resume/clear/compact/startup, and registered installed commands in temporary homes. They are not a
native loading, trust or enforcement measurement.

## Fresh native pass / block / fresh pass procedure

1. Finish validation and the authorized release, verify delivery, and save the sanitized handoff.
   Install last and stop the affected session. Start a genuinely new session; restart a desktop app
   when required. Resume, clear, compact and fork are not substitutes.
2. Use a disposable directory with a `.git` directory and a synthetic `CLAUDE.md` (Claude) or
   `AGENTS.md` (Codex), created **before** launch. Record only OS, native version, surface and outcomes.
   Do not copy personal configuration or transcripts into it, enable debug logging, or change real
   plugin registrations for this test.
3. In the native `/hooks` interface, verify that the managed command is loaded for both events.
   Any native trust/approval is the owner's act. For Codex, the owner grants any required `/hooks`
   trust; the agent never changes trust. Registration on disk alone proves neither loading nor trust.
   If granting trust requires another launch to run SessionStart, start another genuinely new session.
4. Observe the **guard-specific** `baseline_created` message during native startup. Correlate the
   session ID with read-only diagnosis in the exact workspace: expect `baseline_match`. A baseline
   file without lifecycle observation is not proof that the native SessionStart command created it.
5. Ask the agent to run exactly `pwd`: expect a harmless covered tool to pass. Have the owner append
   a synthetic comment to the canary instruction file from a separate terminal; this is the deliberate
   stale-session trigger, confined to the disposable canary. Ask for `pwd` once more: expect the native
   guard's `fingerprint_mismatch` denial. Stop that session immediately; do not try another tool.
6. Open a genuinely new session in that same disposable directory. Observe `baseline_created`, a
   matching read-only diagnostic, and `pwd` passing again. Record pass/block/fresh-pass independently
   for each tested surface. A direct command replay or another harness's result does not satisfy it.

If the first read is denied again, retain only the reason code and lifecycle outcome. Missing
baseline means startup provenance remains unresolved; mismatch means comparison succeeded but the
aggregate changed. Do not claim a specific file unless a separate controlled observation proves it.

Claude documents command hooks running concurrently and from the current directory, and distinguishes
SessionStart context from PreToolUse decisions. Those are vendor contracts, not measurements of this
workstation: [Claude Code hooks reference](https://code.claude.com/docs/en/hooks).
