#!/bin/sh
# Test global/install.sh against throwaway HOME directories (never the real one).
#   install.test.sh <empty-or-new base directory for the fake HOMEs>
set -u

base=${1:?usage: install.test.sh <base dir>}
mkdir -p "$base"
inst="$(cd "$(dirname "$0")" && pwd)/install.sh"
unset CODEX_HOME XDG_DATA_HOME
pass=0
fail=0

ok() { pass=$((pass + 1)); echo "PASS  $1"; }
ko() { fail=$((fail + 1)); echo "FAIL  $1"; }
expect() { # $1 description, $2 expected exit, $3 actual exit
  if [ "$2" -eq "$3" ]; then ok "$1 (exit $3)"; else ko "$1 (expected $2, got $3)"; fi
}

data() { echo "$1/.local/share/personal-multi-harness-workstation-configuration"; }
targets() {
  echo "$1/.claude/CLAUDE.md $1/.codex/AGENTS.md $1/.kiro/steering/workstation-global-brief.md"
  echo "$(data "$1")/hitl-escalation-guard.sh $(data "$1")/hitl.conf $1/.claude/settings.json"
}
fingerprint() { for f in $(targets "$1"); do cksum "$f" 2>/dev/null || echo "absent $f"; done; }
ours() { # number of hook entries of ours in a settings file
  jq '[.hooks.PreToolUse[]?.hooks[]? | select(.command | contains("personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"))] | length' "$1"
}

# 1. dry-run writes nothing
h="$base/home-dry"; mkdir -p "$h"
HOME="$h" sh "$inst" --dry-run > "$base/dry.out"; expect "dry-run exits 0" 0 $?
n=$(find "$h" -type f | wc -l | tr -d ' ')
if [ "$n" -eq 0 ]; then ok "dry-run wrote no file"; else ko "dry-run wrote $n file(s)"; fi
if grep -q '^WOULD WRITE' "$base/dry.out"; then ok "dry-run prints targets"; else ko "dry-run printed no target"; fi
if grep -q '^WOULD MERGE' "$base/dry.out" && grep -q '^+.*AskUserQuestion' "$base/dry.out"; then
  ok "dry-run prints the settings diff"
else
  ko "dry-run printed no settings diff"
fi

# 2. fresh install
h="$base/home-fresh"; mkdir -p "$h"
HOME="$h" sh "$inst"; expect "fresh install" 0 $?
for f in $(targets "$h"); do
  if [ -f "$f" ]; then ok "written: ${f#"$h"/}"; else ko "missing: ${f#"$h"/}"; fi
done
if [ "$(head -n 1 "$h/.kiro/steering/workstation-global-brief.md")" = "---" ] \
   && sed -n 2p "$h/.kiro/steering/workstation-global-brief.md" | grep -qx 'inclusion: always'; then
  ok "kiro file opens with inclusion: always front matter"
else
  ko "kiro front matter wrong"
fi
if grep -q '^## Escalating to the owner' "$h/.claude/CLAUDE.md" && grep -q '^## Owner overlay' "$h/.claude/CLAUDE.md"; then
  ok "brief carries the escalation section and the owner overlay"
else
  ko "brief lacks the escalation section or the overlay"
fi
hook="$(data "$h")/hitl-escalation-guard.sh"
if [ -x "$hook" ] && [ "$(head -n 1 "$hook")" = "#!/bin/sh" ]; then ok "hook installed executable with its shebang first"; else ko "hook not executable or shebang moved"; fi
if [ "$(ours "$h/.claude/settings.json")" -eq 1 ]; then ok "settings carry exactly one entry of ours"; else ko "settings entry count wrong"; fi
out=$(jq -cn '{tool_name:"AskUserQuestion",tool_input:{questions:[{question:"a"},{question:"b"}]}}' | sh "$hook")
if printf '%s' "$out" | jq -e '.hookSpecificOutput.permissionDecision == "deny"' >/dev/null 2>&1; then
  ok "the installed hook denies two questions"
else
  ko "the installed hook did not deny two questions"
fi
long=$(awk 'BEGIN { for (i = 0; i < 281; i++) printf "x" }')
out=$(jq -cn --arg l "$long" '{tool_name:"AskUserQuestion",tool_input:{questions:[{question:$l}]}}' | sh "$hook")
if printf '%s' "$out" | grep -q 'limit is 280'; then ok "the installed hook reads the overlay's 280 limit"; else ko "overlay limit not applied"; fi
if printf '%s' "$out" | jq -r .systemMessage | grep -q '^Guarda HITL (ADR-0013)'; then ok "the owner notice is in the overlay's language"; else ko "owner notice not from overlay"; fi
HOME="$h" sh "$inst" --check; expect "check after install" 0 $?

# 3. idempotent re-run
before=$(fingerprint "$h")
HOME="$h" sh "$inst"; expect "re-run" 0 $?
after=$(fingerprint "$h")
if [ "$before" = "$after" ]; then ok "re-run left every file byte-identical"; else ko "re-run changed a file"; fi

# 4. drift detection, then repair
echo "local edit" >> "$h/.codex/AGENTS.md"
HOME="$h" sh "$inst" --check; expect "check detects drift" 1 $?
HOME="$h" sh "$inst"; expect "install repairs drift" 0 $?
HOME="$h" sh "$inst" --check; expect "check clean after repair" 0 $?
jq 'del(.hooks.PreToolUse)' "$h/.claude/settings.json" > "$base/s.json" && cp "$base/s.json" "$h/.claude/settings.json"
HOME="$h" sh "$inst" --check; expect "check detects a removed hook entry" 1 $?

# 5. refuse an unmanaged file
h="$base/home-unmanaged"; mkdir -p "$h/.claude"
echo "my own hand-written brief" > "$h/.claude/CLAUDE.md"
mine=$(cksum < "$h/.claude/CLAUDE.md")
HOME="$h" sh "$inst"; expect "install refuses unmanaged" 3 $?
if [ "$(cksum < "$h/.claude/CLAUDE.md")" = "$mine" ]; then ok "unmanaged file untouched"; else ko "unmanaged file was modified"; fi
HOME="$h" sh "$inst" --check; expect "check flags unmanaged" 3 $?

# 6. merge into an existing settings file keeps everything else
h="$base/home-settings"; mkdir -p "$h/.claude"
cat > "$h/.claude/settings.json" <<'EOF'
{
    "model" : "some-model",
    "enabledPlugins" : { "a@b" : true },
    "permissions" : { "ask" : [ "Edit(\/x)" ], "deny" : [ "Bash(rm -rf:*)" ] },
    "hooks" : {
        "PreToolUse" : [ { "hooks" : [ { "type" : "command", "command" : "\/opt\/status" } ] } ],
        "Stop" : [ { "hooks" : [ { "type" : "command", "command" : "\/opt\/status" } ] } ]
    }
}
EOF
chmod 600 "$h/.claude/settings.json"
orig=$(jq -S . "$h/.claude/settings.json")
HOME="$h" sh "$inst" --dry-run > "$base/dry6.out"; expect "dry-run on existing settings" 0 $?
if [ "$(jq -S . "$h/.claude/settings.json")" = "$orig" ]; then ok "dry-run left existing settings untouched"; else ko "dry-run modified settings"; fi
if grep -q 're-serialized' "$base/dry6.out"; then ok "dry-run warns that formatting changes"; else ko "dry-run did not warn about formatting"; fi
HOME="$h" sh "$inst"; expect "merge into existing settings" 0 $?
s="$h/.claude/settings.json"
if [ "$(jq -S 'del(.hooks.PreToolUse[-1])' "$s")" = "$orig" ]; then
  ok "every pre-existing key and hook survives; only our entry was appended"
else
  ko "pre-existing content changed"
fi
if [ "$(jq -S . "$s.pmhwc-backup")" = "$orig" ]; then ok "backup holds the previous settings"; else ko "backup missing or wrong"; fi
if [ "$(stat -c %a "$s" 2>/dev/null || stat -f %Lp "$s")" = 600 ]; then ok "file mode preserved (600)"; else ko "file mode changed"; fi
snap=$(cksum < "$s")
HOME="$h" sh "$inst" > /dev/null; expect "re-merge" 0 $?
if [ "$(cksum < "$s")" = "$snap" ]; then ok "re-merge left settings byte-identical"; else ko "re-merge rewrote settings"; fi

# 7. stale and duplicate entries of ours collapse to one; foreign hooks in the same group survive
jq '.hooks.PreToolUse += [
      {matcher: "AskUserQuestion", hooks: [{type: "command", command: "/old/path/personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"}]},
      {matcher: "AskUserQuestion", hooks: [
        {type: "command", command: "/old2/personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"},
        {type: "command", command: "/someone/else.sh"}]}]' "$s" > "$base/s.json" && cp "$base/s.json" "$s"
HOME="$h" sh "$inst" > /dev/null; expect "merge with stale entries" 0 $?
if [ "$(ours "$s")" -eq 1 ]; then ok "stale and duplicate entries collapsed to one"; else ko "entries of ours: $(ours "$s")"; fi
if jq -e '[.hooks.PreToolUse[].hooks[] | select(.command == "/someone/else.sh")] | length == 1' "$s" >/dev/null; then
  ok "a foreign hook sharing a group with a stale entry survives"
else
  ko "foreign hook lost"
fi

# 7b. a group that held only a stale entry of ours is removed, not left empty
groups=$(jq '.hooks.PreToolUse | length' "$s")
jq '.hooks.PreToolUse += [{matcher: "AskUserQuestion", hooks: [{type: "command", command: "/stale/personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"}]}]' "$s" > "$base/s.json" && cp "$base/s.json" "$s"
HOME="$h" sh "$inst" > /dev/null; expect "merge with a stale-only group" 0 $?
if [ "$(jq '.hooks.PreToolUse | length' "$s")" -eq "$groups" ] && jq -e 'all(.hooks.PreToolUse[]; (.hooks | length) > 0)' "$s" >/dev/null; then
  ok "the emptied group is removed and no empty group remains"
else
  ko "group count $(jq '.hooks.PreToolUse | length' "$s"), expected $groups"
fi

# 8. invalid settings are refused and left untouched
h="$base/home-badjson"; mkdir -p "$h/.claude"
echo '{ "model": ' > "$h/.claude/settings.json"
bad=$(cksum < "$h/.claude/settings.json")
HOME="$h" sh "$inst"; expect "install refuses invalid settings" 3 $?
if [ "$(cksum < "$h/.claude/settings.json")" = "$bad" ]; then ok "invalid settings untouched"; else ko "invalid settings modified"; fi

# 9. --overlay=none renders the generic policy only
h="$base/home-generic"; mkdir -p "$h"
HOME="$h" sh "$inst" --overlay=none > /dev/null; expect "install without overlay" 0 $?
if grep -q '^## Owner overlay' "$h/.claude/CLAUDE.md"; then ko "overlay leaked into generic brief"; else ok "generic brief has no owner overlay"; fi
out=$(jq -cn --arg l "$long" '{tool_name:"AskUserQuestion",tool_input:{questions:[{question:$l}]}}' | sh "$(data "$h")/hitl-escalation-guard.sh")
if [ -z "$out" ]; then ok "generic install does not check question length"; else ko "generic install checked length"; fi
out=$(jq -cn '{tool_name:"AskUserQuestion",tool_input:{questions:[{question:"a"},{question:"b"}]}}' | sh "$(data "$h")/hitl-escalation-guard.sh")
if printf '%s' "$out" | jq -r .systemMessage | grep -q '^HITL guard (ADR-0013)'; then ok "generic install notifies in the default English"; else ko "generic notice wrong"; fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
