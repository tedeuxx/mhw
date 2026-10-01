#!/bin/sh
# Test global/hooks/hitl-escalation-guard.sh by piping payloads into it (ADR-0013).
#   hitl-escalation-guard.test.sh <empty-or-new scratch directory>
# Direct payloads prove the script, never the host's routing of the tool to the hook.
set -u

base=${1:?usage: hitl-escalation-guard.test.sh <scratch dir>}
mkdir -p "$base"
hook="$(cd "$(dirname "$0")" && pwd)/hitl-escalation-guard.sh"
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "PASS  $1"; }
ko() { fail=$((fail + 1)); echo "FAIL  $1"; [ -n "${2:-}" ] && echo "      $2"; return 0; }

generic="$base/generic.conf"
printf '%s\n' 'max_questions=1' 'max_question_chars=0' > "$generic"
owner="$base/owner.conf"
printf '%s\n' 'max_questions=1' 'max_question_chars=0' 'max_question_chars=280' > "$owner"

run() { # $1 conf, $2 payload, $3 optional extra arg
  printf '%s' "$2" | PMHWC_HITL_CONF="$1" sh "$hook" ${3:+"$3"} 2>/dev/null
}
abstain() { # $1 label, $2 conf, $3 payload
  out=$(run "$2" "$3")
  if [ -z "$out" ]; then ok "$1"; else ko "$1" "expected no decision, got: $out"; fi
}
deny() { # $1 label, $2 conf, $3 payload, $4 text the reason must carry
  out=$(run "$2" "$3")
  if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1 \
     && printf '%s' "$out" | jq -r '.hookSpecificOutput.permissionDecisionReason' | grep -qF "$4" \
     && printf '%s' "$out" | jq -e '.systemMessage | test("ADR-0013") and test("Mitigation")' >/dev/null 2>&1; then
    ok "$1"
  else
    ko "$1" "expected deny carrying '$4' plus an owner notice, got: ${out:-<empty>}"
  fi
}
q() { # build a payload of N questions whose stems are the given strings
  jq -cn --args '{tool_name: "AskUserQuestion", tool_input: {questions: [$ARGS.positional[] | {question: ., header: "h", options: [{label: "a"}, {label: "b"}]}]}}' "$@"
}
str() { # a string of $1 copies of $2
  awk -v n="$1" -v c="$2" 'BEGIN { for (i = 0; i < n; i++) printf "%s", c }'
}

# Question count: the generic policy.
abstain "zero questions pass" "$generic" '{"tool_name":"AskUserQuestion","tool_input":{"questions":[]}}'
abstain "one question passes" "$generic" "$(q 'Ship it?')"
deny "two questions are refused" "$generic" "$(q 'First?' 'Second?')" "carries 2 questions and the limit is 1"
deny "four questions are refused" "$generic" "$(q a b c d)" "carries 4 questions"

# Question length: off in the generic policy, 280 in the owner overlay (last value wins).
long281=$(str 281 x)
abstain "length is not checked when the limit is 0" "$generic" "$(q "$long281")"
abstain "a 280-character stem passes the overlay" "$owner" "$(q "$(str 280 x)")"
deny "a 281-character stem is refused by the overlay" "$owner" "$(q "$long281")" "question 1 is 281 characters and the limit is 280"
abstain "length counts characters, not bytes (280 x 'ç')" "$owner" "$(q "$(str 280 ç)")"
printf '%s\n' 'max_questions=2' 'max_question_chars=280' > "$base/two.conf"
deny "the offending question is named by position" "$base/two.conf" "$(q short "$long281")" "question 2 is 281"

# The notice and the reason never carry the question text (ADR-0005: category and mitigation only).
secret="ZQXJ-$(str 300 k)"
out=$(run "$owner" "$(q "$secret")")
if [ -n "$out" ] && ! printf '%s' "$out" | grep -qF "ZQXJ"; then ok "the refusal never echoes the question text"; else ko "the refusal never echoes the question text" "$out"; fi

# Fail-open boundary.
abstain "null questions fall through" "$generic" '{"tool_name":"AskUserQuestion","tool_input":{"questions":null}}'
abstain "absent questions fall through" "$generic" '{"tool_name":"AskUserQuestion","tool_input":{}}'
abstain "malformed JSON falls through" "$generic" '{not-json'
abstain "another tool falls through" "$generic" '{"tool_name":"Bash","tool_input":{"questions":[{},{}]}}'
printf '%s\n' 'max_questions=banana' 'max_question_chars=-5' > "$base/bad.conf"
deny "invalid config values fall back to the built-in limit of 1" "$base/bad.conf" "$(q a b)" "limit is 1"
abstain "a missing config falls back to defaults (length off)" "$base/absent.conf" "$(q "$long281")"

# Codex output vocabulary (written, not registered).
out=$(run "$generic" '{"tool_name":"request_user_input","tool_input":{"questions":[{"question":"a"},{"question":"b"}]}}' --format=codex)
if printf '%s' "$out" | jq -e '.decision == "block" and (.reason | test("limit is 1"))' >/dev/null 2>&1; then
  ok "codex format emits decision:block with a reason"
else
  ko "codex format emits decision:block with a reason" "${out:-<empty>}"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
