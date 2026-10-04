#!/bin/sh
# hitl-escalation-guard.sh: pre-tool guard on the structured owner picker (ADR-0013).
#
# It holds the COUNTABLE parts of the escalation calibration and nothing semantic:
#   max_questions       a picker carries at most this many questions (one ask per activation);
#   max_question_chars  each question stem is at most this many characters (0 = off).
#   exact_options       each picker question has this many choices, single-select (0 = off).
#   intake_exception    `Header|Label 1|Label 2…`: the one picker shape exempt from exact_options,
#                       in any working directory (ADR-0021 session intake; empty = none).
# All limits: 0 means the check is OFF. Risk/benefit meaning and conversation pacing are instructions.
# It never reads what a question means, which language it is in, or whether it is a decision or an
# action: a classifier of that kind denies before the owner sees anything, so its false positives are
# invisible to the person it protects (ADR-0013, "Considered options").
#
# Limits come from hitl.conf next to this script (or $PMHWC_HITL_CONF): the generic defaults, then the
# owner overlay, last value wins. Invalid or absent values fall back to the built-in defaults below.
#
# Fail-open boundary, deliberate: no jq, invalid JSON, another tool, or a `questions` value that is not
# an array produce NO decision. The runtime's own schema decides those.
#
#   --format=claude (default)  Claude Code PreToolUse output: deny + a systemMessage for the owner
#   --format=codex             Codex hook output: {"decision":"block","reason":…}. Written, NOT
#                              registered: whether Codex routes request_user_input to a pre-tool hook
#                              is unmeasured (ADR-0013).
set -u

fmt=claude
for arg in "$@"; do
  case $arg in
    --format=claude) fmt=claude ;;
    --format=codex) fmt=codex ;;
  esac
done

max_questions=1
max_question_chars=0
exact_options=0
intake_exception=
# The owner notice. Placeholders: {count} {chars} {max}. An overlay may set them in its own language.
notice_count='HITL guard (ADR-0013) refused a picker before display: {count} questions, limit {max} (one ask per activation). Mitigation: the agent re-asks the first question only.'
notice_length='HITL guard (ADR-0013) refused a picker before display: a question of {chars} characters, limit {max} (tweet-length activation). Mitigation: the agent re-asks it shorter.'
notice_options='HITL guard (ADR-0013/0019) refused a picker outside the {max}-option format. Mitigation: the agent re-asks a single choice with risk and benefit per option.'

conf=${PMHWC_HITL_CONF:-$(dirname "$0")/hitl.conf}
if [ -r "$conf" ]; then
  # `|| [ -n "$key" ]` keeps a last line that has no trailing newline.
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in '#'*|'') continue ;; *=*) ;; *) continue ;; esac
    key=$(printf '%s' "${line%%=*}" | tr -d ' \t\r')
    value=${line#*=}
    case $key in
      max_questions|max_question_chars|exact_options)
        value=$(printf '%s' "$value" | tr -d ' \t\r')
        case $value in ''|*[!0-9]*) continue ;; esac
        ;;
      notice_count|notice_length|notice_options|intake_exception)
        value=$(printf '%s' "$value" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | tr -d '\r')
        [ -n "$value" ] || [ "$key" = intake_exception ] || continue
        ;;
    esac
    case $key in
      max_questions) max_questions=$value ;;
      max_question_chars) max_question_chars=$value ;;
      exact_options) case $value in 0|3) exact_options=$value ;; esac ;;
      notice_count) notice_count=$value ;;
      notice_length) notice_length=$value ;;
      notice_options) notice_options=$value ;;
      intake_exception) intake_exception=$value ;;
    esac
  done < "$conf"
fi

input=$(cat)

# Breaking glass (ADR-0024): the owner switched this layer off with sudo. The switch is read on every
# call and expires by itself; the SessionStart notice announces it. If the module or python3 is
# missing, the layer stays on.
glass="$(dirname "$0")/breaking_glass.py"
if [ -f "$glass" ] && [ -x /usr/bin/python3 ] && /usr/bin/python3 -I -B "$glass" check hitl-guard >/dev/null 2>&1; then
  exit 0
fi

command -v jq >/dev/null 2>&1 || exit 0
printf '%s' "$input" | jq -e . >/dev/null 2>&1 || exit 0

tool=$(printf '%s' "$input" | jq -r '.tool_name // empty' 2>/dev/null)
case $tool in AskUserQuestion|request_user_input) ;; *) exit 0 ;; esac

[ "$(printf '%s' "$input" | jq -r '.tool_input.questions | type' 2>/dev/null)" = array ] || exit 0

count=$(printf '%s' "$input" | jq -r '.tool_input.questions | length')

reason=
notice=
n_max=0
len=0
if [ "$max_questions" -gt 0 ] && [ "$count" -gt "$max_questions" ]; then
  reason="Refused by the workstation HITL guard (ADR-0013): this picker carries $count questions and the limit is $max_questions per activation. Ask only the first question now, in a picker, and wait for the owner's answer. Keep each remaining ask for its own later activation; do not move them into prose or a numbered list."
  notice=$notice_count
  n_max=$max_questions
elif [ "$max_question_chars" -gt 0 ]; then
  # 1-based index and length of the first question stem over the limit; characters, not bytes.
  over=$(printf '%s' "$input" | jq -r --argjson m "$max_question_chars" '
    [.tool_input.questions | to_entries[]
      | {i: (.key + 1), n: ((.value.question? // "") | if type == "string" then length else 0 end)}
      | select(.n > $m)] | first // empty | "\(.i) \(.n)"' 2>/dev/null)
  if [ -n "$over" ]; then
    idx=${over% *}
    len=${over#* }
    reason="Refused by the workstation HITL guard (ADR-0013): question $idx is $len characters and the limit is $max_question_chars. Re-ask it in a picker with a stem of at most $max_question_chars characters that states only the decision. Put the reasoning in each option's description or in an artifact the owner can open. Do not fall back to prose."
    notice=$notice_length
    n_max=$max_question_chars
  fi
fi

if [ -z "$reason" ] && [ "$exact_options" -gt 0 ]; then
  # Owner's workspace session intake has exactly TWO choices (ADR-0021), never a general bypass.
  # Route 1, any working directory: the configured intake_exception shape (header, then labels in
  # order). Route 2: the session-policy.json of the git repository holding the event cwd.
  # Read only the declared mode list, not transcripts, prompts or machine-local session data.
  shape=$(printf '%s' "$intake_exception" | jq -R -c 'split("|") | map(gsub("^\\s+|\\s+$"; ""))
    | if length >= 3 and all(length > 0) then {h: .[0], l: .[1:]} else empty end' 2>/dev/null)
  cwd=$(printf '%s' "$input" | jq -r '.cwd // empty')
  root=
  if [ -n "$cwd" ] && command -v git >/dev/null 2>&1; then
    root=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || root=
  fi
  policy_shape=null
  if [ -n "$root" ] && [ -f "$root/workspace/session-policy.json" ]; then
    if jq -e '.schema_version == 1 and .entry_modes == ["improvement", "bugfix"]' \
      "$root/workspace/session-policy.json" >/dev/null 2>&1; then
      policy_shape='{"h":"Session type","l":["Melhoria de harness","Bugfix"]}'
    fi
  fi
  # Count only; never classify labels, estimate risk or echo question/option content.
  # Missing/non-array options on a recognized picker are refused: the owner requires a choice.
  bad_options=$(printf '%s' "$input" | jq -r --argjson n "$exact_options" \
    --argjson shapes "[${shape:-null},$policy_shape]" '
    [.tool_input.questions[] | . as $q | select(
      (((.options | if type == "array" then length else 0 end) != $n)
        and (any($shapes[] | select(. != null);
          $q.header == .h and ([$q.options[]?.label] == .l)) | not))
      or (.multiSelect == true))] | length' 2>/dev/null)
  if [ "${bad_options:-0}" -gt 0 ]; then
    reason="Refused by the workstation HITL guard (ADR-0013/0019): each question must offer exactly $exact_options authored options and single selection. Re-ask one path decision with a concise risk and benefit description for each option. Leave native free-text clarification available. Do not invent unsafe alternatives or move extra questions into prose."
    notice=$notice_options
    n_max=$exact_options
  fi
fi

[ -n "$reason" ] || exit 0

if [ "$fmt" = codex ]; then
  jq -n --arg r "$reason" '{decision: "block", reason: $r}'
else
  jq -n --arg r "$reason" --arg t "$notice" --arg c "$count" --arg l "$len" --arg m "$n_max" '{
    systemMessage: ($t | gsub("\\{count\\}"; $c) | gsub("\\{chars\\}"; $l) | gsub("\\{max\\}"; $m)),
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $r
    }
  }'
fi
