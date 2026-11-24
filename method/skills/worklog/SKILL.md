---
name: "worklog"
description: "Record one worklog event on an Issue from the agent harness's own usage data: tokens, model and effort (Claude Code, Codex) or credits (Kiro), read from the session's own log by the commands below, never estimated. Use when your work on an Issue ends (a checkpoint, a handoff or the outcome), when the owner asks what an Issue cost, or when a rite sums consumption per Issue. It posts one comment on the Issue and nothing else."
purpose: "track agent harness consumption per Issue (commandment 8) from each harness's native usage data, recorded on the issue tracker, with no CLI in the path"
---

# Worklog: one event on the Issue, from the harness's own usage data

**What this records.** One worklog event, in the contract's envelope, as a comment on the Issue the work
was for. The event carries a `usage` object: numbers and fixed identifiers only, copied from the agent
harness's own session log. Never a prompt, an output, a summary or a note. The contract is the JSON Schema
[`event.schema.json`](https://github.com/tedeuxx/mhw/blob/main/method/scripts/worklog-contract/event.schema.json)
and its [README](https://github.com/tedeuxx/mhw/blob/main/method/scripts/worklog-contract/README.md) in
the workstation repository. Since mhw#594 nothing else produces the event: `mhw worklog` is gone.

**Who records it: the session that talks to the owner**, when its work on the Issue ends. A dispatched
agent does not record usage; its consumption is in the main session's log already (Claude Code) or is not
attributable (Codex, Kiro). **One `usage` object per run** (`run_id`) on an Issue, on the event that ends
the run's work there: a `checkpoint`, a `handoff` or the `outcome`. Never on `implementation_start`.

**What the numbers are.** Each harness reports a running total for the whole session. So the record is
what the session consumed up to the moment you read it. If one session worked on more than one Issue,
record the total on the Issue it was opened for and say so in `evidence`; never split a total by guess.
A number the harness did not show is never estimated and never written as zero:
`usage_provenance` is then `unavailable` and every number is null.

## Step 1. Read the usage

Run the block for your agent harness. It prints one `usage` object as JSON and writes nothing. Each reads
only numbers and identifiers out of the session log; the log itself holds the conversation and must never
be copied, quoted or posted.

**Claude Code.** The main session's log and every subagent log under it, deduplicated by message (the log
writes one line per content block, with the same usage on each). `tokens_input` counts every input token
processed: uncached, written to the cache and read from it. The effort is the session's `CLAUDE_EFFORT`.

```sh
# worklog-usage: claude-code
find "$HOME/.claude/projects" \( -name "${CLAUDE_CODE_SESSION_ID:-none}.jsonl" -o -path "*/${CLAUDE_CODE_SESSION_ID:-none}/subagents/agent-*.jsonl" \) -exec cat {} + | jq -s --arg effort "${CLAUDE_EFFORT:-}" '
  [.[] | select(.type == "assistant" and (.message.usage | type) == "object" and ((.message.model // "") | test("^[A-Za-z0-9]")))]
  | group_by(.message.id) | map(last.message)
  | (length > 0) as $any
  | { usage_provenance: (if $any then "native" else "unavailable" end),
      model: ([.[].model] | unique | if length == 1 then .[0] else null end),
      effort: (if $effort == "" then null else $effort end),
      tokens_input: (if $any then (map(.usage | .input_tokens + (.cache_creation_input_tokens // 0) + (.cache_read_input_tokens // 0)) | add) else null end),
      tokens_output: (if $any then (map(.usage.output_tokens) | add) else null end),
      credits: null }'
```

**Codex.** The thread's own rollout: the last `token_count` total and the last turn's model and effort.
`input_tokens` includes the cached input. A rollout whose total is not the sum of its input and output (some
app sessions write the total only) is recorded as `unavailable`, because the contract has no field for an
undivided total.

```sh
# worklog-usage: codex
find "${CODEX_HOME:-$HOME/.codex}/sessions" -name "rollout-*-${CODEX_THREAD_ID:-none}.jsonl" -exec cat {} + | jq -s '
  ([.[] | select(.type == "turn_context") | .payload] | last) as $turn
  | ([.[] | select(.type == "event_msg" and .payload.type == "token_count" and .payload.info != null) | .payload.info.total_token_usage] | last) as $u
  | ($u != null and $u.total_tokens > 0 and ($u.input_tokens + $u.output_tokens) == $u.total_tokens) as $split
  | { usage_provenance: (if $split then "native" else "unavailable" end),
      model: ($turn.model // null), effort: ($turn.effort // null),
      tokens_input: (if $split then $u.input_tokens else null end),
      tokens_output: (if $split then $u.output_tokens else null end),
      credits: null }'
```

**Kiro CLI.** The session's credits, summed over its turns, and its model. Kiro shows no token count and
no effort, so both stay null.

```sh
# worklog-usage: kiro
find "$HOME/.kiro/sessions" -path "*${KIRO_SESSION_ID:-none}/*" \( -name session.json -o -name messages.jsonl \) -exec cat {} + | jq -s '
  ([.[] | select(type == "object" and has("modelId")) | .modelId] | last) as $model
  | [.[] | select(.payload.type? == "usage_summary") | .payload.promptTurnSummaries[]? | select(.unit == "credit") | .usage] as $c
  | { usage_provenance: (if ($c | length) > 0 then "native" else "unavailable" end),
      model: $model, effort: null, tokens_input: null, tokens_output: null,
      credits: (if ($c | length) > 0 then ($c | add) else null end) }'
```

If `CODEX_THREAD_ID` or `KIRO_SESSION_ID` is empty in your shell, the block prints an `unavailable`
record. Find the session by hand only from its own id: the Codex rollout's `session_meta` id, or the Kiro
session directory (`sess_<id>`) whose `session.json` lists your working directory. Never take the newest
log on the machine: it may be another session's.

Save the printed object with the `Write` tool, in the session scratchpad, as `worklog-usage.json`.

## Step 2. Write the event

Write the event with the `Write` tool, in the session scratchpad, as `worklog-event.json`. This is a
`checkpoint`. For a `handoff`, set `event_type` to `handoff` and add `next_act` (one line, at most 280
characters). For the `outcome`, set `event_type` to `outcome`, `stage` to the stage that ended, and add
`outcome`, plus `completion_sprint` and `acceptance_evidence` when it is `accepted` (the contract's
README, *Accounting*). Every `<…>` is a value you fill; nothing else changes shape.

```json
{
  "schema_version": 1,
  "event_id": "<repo>-<n>-<event type>-<UTC time, digits only>",
  "issue": "<owner/repo>#<n>",
  "timestamp": "<UTC time, RFC 3339, such as 2026-11-24T10:00:00Z>",
  "event_type": "checkpoint",
  "stage": "<the stage: build, review, intake, ...>",
  "run_id": "<the session id>",
  "attempt_id": "<initial, or the retry's name>",
  "attribution": {
    "harness": "<Claude Code, Codex or Kiro>",
    "runtime_version": "<the harness version it reports>",
    "plugin": { "version": "<the workstation release>", "source_revision": "<its commit, or unknown>" },
    "persona": "<the persona, or orchestrator>",
    "provenance": "declared"
  },
  "revision": { "repository": "<owner/repo>", "branch": "<branch>", "commit": "<the full or short SHA>" },
  "evidence": ["<a public reference: the pull request URL, a check run, a verdict comment>"],
  "handoff": { "state": "<where the item is>", "to": null }
}
```

**Public only.** `evidence` and `next_act` never carry a machine-local path (`/Users/`, `/private/`,
`/tmp/`, `~/`, `file://`), a `.brand` reference or copied private content; the schema refuses the paths
and nothing can see copied content.

## Step 3. Post it

Join the two files; the output is the event with its `usage`, keys sorted:

```sh
# worklog-join
jq -S --slurpfile usage "<scratchpad>/worklog-usage.json" '. + {usage: $usage[0]}' "<scratchpad>/worklog-event.json"
```

Write the comment body with the `Write` tool, in the session scratchpad, as `worklog-comment.md`: the
marker alone on the first line, then a `json` fence holding the joined event, exactly:

````
<!-- worklog-event:v1 -->
```json
<the joined event>
```
````

Read it back once. Then post it:

```sh
gh issue comment <n> --repo <owner/repo> --body-file "<scratchpad>/worklog-comment.md"
```

## Summing an Issue's consumption

What an Issue cost, from its own comments: the number of `usage` records, how many are native, and each
metric's sum over the records that report it. A sum is a lower bound whenever a record is `unavailable`
or a run has none. Corrections are not applied here: a corrected usage record counts as it was posted.

```sh
# worklog-sum
gh issue view <n> --repo <owner/repo> --json comments | jq '[.comments[].body
  | capture("<!-- worklog-event:v1 -->\\s*\\x60{3}json\\s*(?<j>\\{[\\s\\S]*?\\})\\s*\\x60{3}"; "g").j
  | fromjson? | select(type == "object") | .usage // empty]
  | { records: length, native: (map(select(.usage_provenance == "native")) | length),
      tokens_input: (map(.tokens_input // empty) | if length > 0 then add else null end),
      tokens_output: (map(.tokens_output // empty) | if length > 0 then add else null end),
      credits: (map(.credits // empty) | if length > 0 then add else null end) }'
```

## Evidence level, and what nothing enforces

| Agent harness | Where the numbers come from | Evidence |
| --- | --- | --- |
| Claude Code | `~/.claude/projects/<project>/<CLAUDE_CODE_SESSION_ID>.jsonl` and its `subagents/agent-*.jsonl`: `message.usage` and `message.model`; effort from `CLAUDE_EFFORT` | measured, 2.1.331: the variables set in a dispatched agent's shell, the fields read from a real log |
| Codex | `$CODEX_HOME/sessions/<date>/rollout-*-<thread id>.jsonl`: `token_count` totals, `turn_context` model and effort | log fields measured on 0.160.0, 0.163.0 and 0.167.0 logs; `CODEX_THREAD_ID` read from the 0.163.0 binary, not measured in a Codex shell |
| Kiro CLI | `~/.kiro/sessions/<hash>/sess_<id>/`: `usage_summary` credits in `messages.jsonl`, `modelId` in `session.json` | log fields measured on 3.5.0 (V3) logs; `KIRO_SESSION_ID` read from the 3.5.0 binary, not measured in a Kiro shell; Kiro IDE not measured |

**Instructions, held by you.** Nothing makes a session record usage, and nothing compares the numbers
with the harness. The shape is fixed by the blocks above, and mhw's test
(`test/method/worklog-skill.test.js`) runs them on synthetic logs and validates the result against the
schema; an event edited by hand after that is checked by nothing. The log layouts are each vendor's
undocumented files: a release can change them silently, and the block then records `unavailable` or a
wrong number with nothing to notice.
