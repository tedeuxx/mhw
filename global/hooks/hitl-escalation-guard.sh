#!/bin/sh
# hitl-escalation-guard.sh: pre-tool guard on the structured owner picker (ADR-0013).
#
# It holds the two COUNTABLE halves of the escalation calibration and nothing semantic:
#   max_questions       a picker carries at most this many questions (one ask per activation);
#   max_question_chars  each question stem is at most this many characters (0 = off).
# Both limits: 0 means the check is OFF.
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
# The owner notice. Placeholders: {count} {chars} {max}. An overlay may set them in its own language.
notice_count='HITL guard (ADR-0013) refused a picker before display: {count} questions, limit {max} (one ask per activation). Mitigation: the agent re-asks the first question only.'
notice_length='HITL guard (ADR-0013) refused a picker before display: a question of {chars} characters, limit {max} (tweet-length activation). Mitigation: the agent re-asks it shorter.'

conf=${PMHWC_HITL_CONF:-$(dirname "$0")/hitl.conf}
if [ -r "$conf" ]; then
  # `|| [ -n "$key" ]` keeps a last line that has no trailing newline.
  while IFS= read -r line || [ -n "$line" ]; do
    case $line in '#'*|'') continue ;; *=*) ;; *) continue ;; esac
    key=$(printf '%s' "${line%%=*}" | tr -d ' \t\r')
    value=${line#*=}
    case $key in
      max_questions|max_question_chars)
        value=$(printf '%s' "$value" | tr -d ' \t\r')
        case $value in ''|*[!0-9]*) continue ;; esac
        ;;
      notice_count|notice_length)
        value=$(printf '%s' "$value" | sed 's/^[[:space:]]*//; s/[[:space:]]*$//' | tr -d '\r')
        [ -n "$value" ] || continue
        ;;
    esac
    case $key in
      max_questions) max_questions=$value ;;
      max_question_chars) max_question_chars=$value ;;
      notice_count) notice_count=$value ;;
      notice_length) notice_length=$value ;;
    esac
  done < "$conf"
fi

input=$(cat)

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
