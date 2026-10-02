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
  echo "$1/.codex/rules/workstation-deny-floor.rules"
  echo "$(data "$1")/clipboard_guard.py $(data "$1")/clipboard.conf $1/.codex/hooks.json"
  echo "$(data "$1")/paste_wrapper.py $(data "$1")/paste-filter.sh"
}
plist() { echo "$1/Library/LaunchAgents/local.personal-multi-harness-workstation-configuration.clipboard-guard.plist"; }
clip_src="$(cd "$(dirname "$0")" && pwd)/clipboard/clipboard_guard.py"
wrap_src="$(cd "$(dirname "$0")" && pwd)/clipboard/paste_wrapper.py"
fingerprint() { for f in $(targets "$1"); do cksum "$f" 2>/dev/null || echo "absent $f"; done; }
ours() { # number of hook entries of ours in a settings file
  jq '[.hooks.PreToolUse[]?.hooks[]? | select(.command | contains("personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"))] | length' "$1"
}
pours() { # number of paste-filter entries of ours (UserPromptSubmit) in a settings file
  jq '[.hooks.UserPromptSubmit[]?.hooks[]? | select(.command | contains("personal-multi-harness-workstation-configuration/clipboard_guard.py"))] | length' "$1"
}
# A synthetic AWS-shaped key, assembled at run time so this file holds no scanner-shaped string.
synthetic_key="AKI""AQQQQRRRRSSSSTTTT"
payload() { jq -cn --arg p "$1" '{hook_event_name: "UserPromptSubmit", prompt: $p}'; }
# Run the hook command exactly as a harness would: through sh -c, payload on stdin, under HOME=$1.
run_paste() { # $1 home, $2 command, $3 prompt
  payload "$3" | HOME="$1" sh -c "$2"
}
floor_src="$(cd "$(dirname "$0")" && pwd)/deny-floor.conf"
# Expected Claude rules, derived from the source independently of the installer's awk: a cmd line is
# one rule, a file line is two (Read and Edit).
floor_rules=$(awk '$1 == "cmd" { n++ } $1 == "file" { n += 2 } END { print n }' "$floor_src")
floor_cmds=$(awk '$1 == "cmd" { n++ } END { print n }' "$floor_src")
has_rule() { # $1 settings file, $2 rule; prints how many times the rule is in permissions.deny
  jq --arg r "$2" '[.permissions.deny[]? | select(. == $r)] | length' "$1"
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
if grep -q '^+ *"Bash(git push --force:\*)"' "$base/dry.out" && grep -q '^WOULD WRITE .*/.codex/rules/workstation-deny-floor.rules' "$base/dry.out"; then
  ok "dry-run prints the deny floor for both harnesses"
else
  ko "dry-run did not print the deny floor"
fi

# 2. fresh install
h="$base/home-fresh"; mkdir -p "$h"
HOME="$h" sh "$inst" > "$base/fresh.out"; expect "fresh install" 0 $?
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

# 2b. the deny floor, rendered for Claude Code and Codex
s="$h/.claude/settings.json"
if [ "$(jq '.permissions.deny | length' "$s")" -eq "$floor_rules" ] && [ "$floor_rules" -gt 0 ]; then
  ok "settings carry every deny-floor rule ($floor_rules), nothing else"
else
  ko "deny count $(jq '.permissions.deny | length' "$s"), expected $floor_rules"
fi
for r in 'Bash(rm -rf:*)' 'Bash(git push --force:*)' 'Bash(gh auth token:*)' 'Read(~/.ssh/id_*)' 'Edit(~/.aws/credentials)'; do
  if [ "$(has_rule "$s" "$r")" -eq 1 ]; then ok "deny holds $r once"; else ko "deny lacks $r"; fi
done
rules="$h/.codex/rules/workstation-deny-floor.rules"
if grep -qxF 'prefix_rule(pattern=["git", "push", "--force"], decision="forbidden")' "$rules"; then
  ok "codex rules carry a forbidden prefix_rule"
else
  ko "codex rules lack the force-push rule"
fi
if [ "$(grep -c '^prefix_rule(' "$rules")" -eq "$floor_cmds" ] && ! grep -q 'decision="allow"' "$rules"; then
  ok "codex rules: one forbidden rule per cmd entry ($floor_cmds), no allow"
else
  ko "codex rule count $(grep -c '^prefix_rule(' "$rules"), expected $floor_cmds"
fi
if command -v codex >/dev/null 2>&1; then
  # Credential-free: execpolicy only evaluates the rules file against argv; nothing is run.
  d1=$(codex execpolicy check --rules "$rules" git push --force origin x | jq -r '.decision // "none"')
  d2=$(codex execpolicy check --rules "$rules" git push origin x | jq -r '.decision // "none"')
  if [ "$d1" = forbidden ] && [ "$d2" = none ]; then
    ok "codex execpolicy: rendered file forbids the force-push and leaves a plain push alone"
  else
    ko "codex execpolicy decisions: force=$d1 plain=$d2"
  fi
else
  echo "SKIP  codex not on PATH: the rendered rules file was not parsed by Codex here"
fi

# 2c. the paste filter (ADR-0011): the core, its settings, a UserPromptSubmit entry for Claude Code and
# a managed hooks.json for Codex; and NO LaunchAgent: the always-on watcher is withdrawn
cg="$(data "$h")/clipboard_guard.py"
if sed 2d "$cg" | cmp -s - "$clip_src" && sed -n 2p "$cg" | grep -q '^# managed-by: personal-multi-harness-workstation-configuration'; then
  ok "paste filter core installed: the source plus a marker on line 2"
else
  ko "installed paste filter core differs from its source"
fi
cc="$(data "$h")/clipboard.conf"
if grep -qx 'block_categories=employer-client-term,credential,email,payment-card,cpf,cnpj' "$cc" && grep -q '^notice_blocked=Filtro de colagem' "$cc"; then
  ok "paste filter settings carry the generic categories and the overlay's notices"
else
  ko "paste filter settings wrong"
fi
if [ -e "$(data "$h")/local-overlay" ]; then ko "the installer created the local overlay (term list or salt)"; else ok "the installer wrote no term list and no salt"; fi
s="$h/.claude/settings.json"
want_claude="/usr/bin/python3 -I -B \"$cg\" prompt-hook --harness claude --config \"$cc\""
if [ "$(pours "$s")" -eq 1 ] && jq -e --arg c "$want_claude" '[.hooks.UserPromptSubmit[].hooks[] | select(.command == $c and .timeout == 30)] | length == 1' "$s" >/dev/null; then
  ok "settings carry exactly one UserPromptSubmit entry running the installed core for claude"
else
  ko "the Claude Code paste-filter entry is missing or wrong"
fi
ch="$h/.codex/hooks.json"
want_codex="/usr/bin/python3 -I -B \"$cg\" prompt-hook --harness codex --config \"$cc\""
if jq -e --arg c "$want_codex" '(.description | startswith("managed-by: personal-multi-harness-workstation-configuration"))
      and ([.hooks.UserPromptSubmit[].hooks[] | select(.command == $c and .type == "command")] | length == 1)
      and (.hooks | keys == ["UserPromptSubmit"])' "$ch" >/dev/null; then
  ok "codex hooks.json is valid JSON, managed, and runs the installed core for codex"
else
  ko "codex hooks.json wrong"
fi
if grep -q 'version' "$ch"; then ko "codex hooks.json carries a version (every release would ask for re-trust)"; else ok "codex hooks.json carries no version"; fi
# The registered commands, run as a harness runs them: a hit blocks, a clean prompt prints nothing.
cmd=$(jq -r '.hooks.UserPromptSubmit[0].hooks[0].command' "$s")
out=$(run_paste "$h" "$cmd" "deploy with $synthetic_key please")
if printf '%s' "$out" | jq -e '.decision == "block" and .hookSpecificOutput.suppressOriginalPrompt == true' >/dev/null 2>&1 \
   && ! printf '%s' "$out" | grep -q "$synthetic_key" && printf '%s' "$out" | grep -q 'REDACTED:credential'; then
  ok "the installed Claude Code entry blocks a credential, suppresses the original, shows only a redacted copy"
else
  ko "the installed Claude Code entry did not block correctly: $out"
fi
out=$(run_paste "$h" "$cmd" "refactor the parser")
if [ -z "$out" ]; then ok "the installed Claude Code entry prints nothing for a clean prompt"; else ko "clean prompt produced output: $out"; fi
cmd=$(jq -r '.hooks.UserPromptSubmit[0].hooks[0].command' "$ch")
out=$(run_paste "$h" "$cmd" "deploy with $synthetic_key please")
if printf '%s' "$out" | jq -e '.decision == "block" and (has("hookSpecificOutput") | not)' >/dev/null 2>&1 \
   && ! printf '%s' "$out" | grep -q "$synthetic_key"; then
  ok "the installed Codex entry blocks a credential with the Codex output shape"
else
  ko "the installed Codex entry did not block correctly: $out"
fi
if [ -e "$(plist "$h")" ] || [ -d "$h/Library/LaunchAgents" ]; then ko "a LaunchAgent was written"; else ok "no LaunchAgent written (the watcher is withdrawn)"; fi

# 2c'. the paste wrapper (ADR-0011, automatic cleaning at the paste boundary): installed beside the core,
# with a managed snippet of shell functions. The installer sources nothing and writes no shell rc.
pw="$(data "$h")/paste_wrapper.py"
if sed 2d "$pw" | cmp -s - "$wrap_src" && sed -n 2p "$pw" | grep -q '^# managed-by: personal-multi-harness-workstation-configuration'; then
  ok "paste wrapper installed: the source plus a marker on line 2"
else
  ko "installed paste wrapper differs from its source"
fi
sn="$(data "$h")/paste-filter.sh"
want_fn="claude() { /usr/bin/python3 -I -B \"$pw\" run --config \"$cc\" -- claude \"\$@\"; }"
if head -n 1 "$sn" | grep -q '^# managed-by: personal-multi-harness-workstation-configuration' && grep -qxF "$want_fn" "$sn" \
   && [ "$(grep -c '^[a-z-]*() { /usr/bin/python3 -I -B ' "$sn")" -eq 3 ] && grep -q '^kiro-cli() ' "$sn" && grep -q '^codex() ' "$sn"; then
  ok "the snippet defines claude, codex and kiro-cli through the installed wrapper"
else
  ko "the snippet is wrong"
fi
found=""
for rc in .zshrc .bashrc .bash_profile .profile .zprofile .zshenv; do [ -e "$h/$rc" ] && found="$found $rc"; done
if [ -z "$found" ]; then ok "no shell rc was written"; else ko "shell rc written:$found"; fi
if grep -qF ". \"$sn\"" "$base/fresh.out"; then ok "install tells the owner the line to add himself"; else ko "install printed no activation line"; fi
# The snippet's function, sourced by a real zsh and bash: it reaches the real program through the wrapper
# (stdin is not a terminal here, so the wrapper execs straight through) with the arguments and exit status
# intact. A fake claude on PATH stands in for the CLI.
fb="$base/fakebin"; mkdir -p "$fb"
printf '#!/bin/sh\nprintf "fake-claude:"\nprintf "%%s|" "$@"\nexit 5\n' > "$fb/claude"
chmod 755 "$fb/claude"
for shl in zsh bash; do
  if command -v "$shl" >/dev/null 2>&1; then
    out=$(HOME="$h" PATH="$fb:$PATH" "$shl" -c ". \"$sn\"; claude a 'b c' < /dev/null"); rc=$?
    if [ "$out" = "fake-claude:a|b c|" ] && [ "$rc" -eq 5 ]; then
      ok "$shl: the snippet's claude runs the real program through the wrapper, args and exit kept"
    else
      ko "$shl: snippet function gave '$out' exit $rc"
    fi
  else
    echo "SKIP  $shl not installed: the snippet was not sourced by it here"
  fi
done

# 2d. a managed watcher plist left by an earlier version is removed on install; launchctl never runs
h2="$base/home-oldplist"; mkdir -p "$h2/Library/LaunchAgents"
printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>' \
  '<!-- managed-by: personal-multi-harness-workstation-configuration; source: global/install.sh (clipboard guard, ADR-0011); version: 0.7.2 -->' \
  '<plist version="1.0"><dict/></plist>' > "$(plist "$h2")"
fakebin="$base/fakebin"; mkdir -p "$fakebin"
printf '#!/bin/sh\necho launchctl >> "%s"\n' "$base/launchctl.calls" > "$fakebin/launchctl"; chmod 755 "$fakebin/launchctl"
HOME="$h2" PATH="$fakebin:$PATH" sh "$inst" --check > "$base/oldplist-check.out"; expect "check flags the withdrawn watcher's plist" 1 $?
if grep -q '^STALE .*clipboard-guard.plist' "$base/oldplist-check.out" && [ -f "$(plist "$h2")" ]; then ok "check names the stale plist and leaves it"; else ko "check did not name the stale plist"; fi
HOME="$h2" PATH="$fakebin:$PATH" sh "$inst" --dry-run > "$base/oldplist-dry.out"; expect "dry-run with the old plist" 0 $?
if grep -q '^WOULD REMOVE .*clipboard-guard.plist' "$base/oldplist-dry.out" && [ -f "$(plist "$h2")" ]; then ok "dry-run says it would remove the plist, and does not"; else ko "dry-run plist handling wrong"; fi
HOME="$h2" PATH="$fakebin:$PATH" sh "$inst" > "$base/oldplist.out"; expect "install with the old plist" 0 $?
if [ ! -e "$(plist "$h2")" ]; then ok "install removed the managed plist"; else ko "the managed plist survived install"; fi
# shellcheck disable=SC2016  # the literal $(id -u) is what the owner is meant to run
if grep -qF 'launchctl bootout gui/$(id -u)/local.personal-multi-harness-workstation-configuration.clipboard-guard' "$base/oldplist.out"; then
  ok "install prints the bootout command for the owner"
else
  ko "install did not print the bootout command"
fi
if [ -e "$base/launchctl.calls" ]; then ko "the installer ran launchctl"; else ok "the installer never ran launchctl"; fi
HOME="$h2" sh "$inst" --check > /dev/null; expect "check clean once the plist is gone" 0 $?
printf 'my own agent\n' > "$(plist "$h2")"
HOME="$h2" sh "$inst" > "$base/oldplist-foreign.out"; expect "install with an unmanaged file at the plist path" 0 $?
if [ "$(cat "$(plist "$h2")")" = "my own agent" ] && grep -q 'NOT managed by this project; left alone' "$base/oldplist-foreign.out"; then
  ok "an unmanaged file at the plist path is left alone"
else
  ko "an unmanaged plist was touched"
fi

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
HOME="$h" sh "$inst" > /dev/null; expect "install restores the hook entry" 0 $?
jq '.permissions.deny -= ["Bash(rm -rf:*)"]' "$h/.claude/settings.json" > "$base/s.json" && cp "$base/s.json" "$h/.claude/settings.json"
HOME="$h" sh "$inst" --check > "$base/check-deny.out"; expect "check detects a removed deny-floor rule" 1 $?
if grep -q '1 deny-floor rule(s) missing' "$base/check-deny.out"; then ok "check names how many floor rules are missing"; else ko "check did not count the missing rule"; fi
HOME="$h" sh "$inst" > /dev/null; expect "install restores the removed rule" 0 $?
if [ "$(has_rule "$h/.claude/settings.json" 'Bash(rm -rf:*)')" -eq 1 ]; then ok "the removed rule is back, once"; else ko "the removed rule was not restored"; fi
rm "$h/.codex/rules/workstation-deny-floor.rules"
HOME="$h" sh "$inst" --check; expect "check detects a missing codex rules file" 1 $?
HOME="$h" sh "$inst" > /dev/null
echo "block_categories=email" >> "$(data "$h")/clipboard.conf"
HOME="$h" sh "$inst" --check; expect "check detects a hand-edited paste filter setting" 1 $?
HOME="$h" sh "$inst" > /dev/null
jq 'del(.hooks.UserPromptSubmit)' "$h/.claude/settings.json" > "$base/s.json" && cp "$base/s.json" "$h/.claude/settings.json"
HOME="$h" sh "$inst" --check; expect "check detects a removed paste-filter entry" 1 $?
HOME="$h" sh "$inst" > /dev/null; expect "install restores the paste-filter entry" 0 $?
if [ "$(pours "$h/.claude/settings.json")" -eq 1 ]; then ok "the paste-filter entry is back, once"; else ko "paste-filter entry not restored"; fi
jq '.hooks.UserPromptSubmit = []' "$h/.codex/hooks.json" > "$base/c.json" && cp "$base/c.json" "$h/.codex/hooks.json"
HOME="$h" sh "$inst" --check; expect "check detects an emptied codex hooks.json" 1 $?
HOME="$h" sh "$inst" > /dev/null; expect "install repairs codex hooks.json" 0 $?

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
    "permissions" : { "allow" : [ "Bash(ls:*)" ], "ask" : [ "Edit(\/x)" ], "deny" : [ "Bash(my-own-rule:*)", "Bash(rm -rf:*)" ] },
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
if [ "$(jq -S 'del(.hooks.PreToolUse[-1]) | del(.hooks.UserPromptSubmit) | .permissions.deny |= .[0:2]' "$s")" = "$orig" ]; then
  ok "every pre-existing key, hook and rule survives in place; only our entries were appended"
else
  ko "pre-existing content changed"
fi
if [ "$(jq '.permissions.deny | length' "$s")" -eq $((floor_rules + 1)) ] \
   && [ "$(has_rule "$s" 'Bash(rm -rf:*)')" -eq 1 ] && [ "$(has_rule "$s" 'Bash(my-own-rule:*)')" -eq 1 ]; then
  ok "deny is a union: a floor rule already present is not duplicated, a foreign rule is kept"
else
  ko "deny union wrong: $(jq '.permissions.deny | length' "$s") entries, expected $((floor_rules + 1))"
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

jq '.hooks.UserPromptSubmit += [
      {hooks: [{type: "command", command: "/usr/bin/python3 /old/personal-multi-harness-workstation-configuration/clipboard_guard.py prompt-hook"}]},
      {hooks: [{type: "command", command: "/usr/bin/python3 /old2/personal-multi-harness-workstation-configuration/clipboard_guard.py prompt-hook"},
               {type: "command", command: "/someone/prompt-logger.sh"}]}]' "$s" > "$base/s.json" && cp "$base/s.json" "$s"
HOME="$h" sh "$inst" > /dev/null; expect "merge with stale paste-filter entries" 0 $?
if [ "$(pours "$s")" -eq 1 ] && jq -e '[.hooks.UserPromptSubmit[].hooks[] | select(.command == "/someone/prompt-logger.sh")] | length == 1' "$s" >/dev/null; then
  ok "stale paste-filter entries collapsed to one; a foreign UserPromptSubmit hook survives"
else
  ko "paste-filter entries of ours: $(pours "$s")"
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
if grep -q '^notice_blocked=' "$(data "$h")/clipboard.conf"; then ko "overlay leaked into generic paste filter settings"; else ok "generic paste filter settings carry no owner overlay"; fi

# 10. a permissions section of the wrong shape is refused and left untouched
h="$base/home-badperms"; mkdir -p "$h/.claude"
echo '{ "permissions": { "deny": "Bash(rm -rf:*)" } }' > "$h/.claude/settings.json"
bad=$(cksum < "$h/.claude/settings.json")
HOME="$h" sh "$inst" > /dev/null 2>&1; expect "install refuses a non-array permissions.deny" 3 $?
if [ "$(cksum < "$h/.claude/settings.json")" = "$bad" ]; then ok "malformed permissions untouched"; else ko "malformed permissions modified"; fi

# 11. an overlay adds floor entries; an invalid entry stops the run before anything is written
ov="$base/overlay-floor"; mkdir -p "$ov"
printf '# owner extra\ncmd terraform destroy\n' > "$ov/deny-floor.conf"
h="$base/home-overlay"; mkdir -p "$h"
HOME="$h" sh "$inst" --overlay="$ov" > /dev/null; expect "install with an overlay floor" 0 $?
if [ "$(has_rule "$h/.claude/settings.json" 'Bash(terraform destroy:*)')" -eq 1 ] \
   && grep -qxF 'prefix_rule(pattern=["terraform", "destroy"], decision="forbidden")' "$h/.codex/rules/workstation-deny-floor.rules"; then
  ok "the overlay's entry reaches both harnesses"
else
  ko "the overlay's entry is missing"
fi
i=0
for e in 'cmd rm "-rf"' 'cmd git push --force*' 'path ~/.ssh' 'file ~/a ~/b' 'cmd'; do
  i=$((i + 1))
  printf '%s\n' "$e" > "$ov/deny-floor.conf"
  h="$base/home-badfloor-$i"; mkdir -p "$h"
  HOME="$h" sh "$inst" --overlay="$ov" > /dev/null 2>&1; rc=$?
  n=$(find "$h" -type f | wc -l | tr -d ' ')
  if [ "$rc" -eq 2 ] && [ "$n" -eq 0 ]; then ok "invalid entry refused, nothing written: $e"; else ko "invalid entry '$e': exit $rc, $n file(s)"; fi
done

# 12. XDG_DATA_HOME is honoured: the hook and its data go there, and the settings entry points there
h="$base/home-xdg"; x="$base/xdg-data"; mkdir -p "$h" "$x"
HOME="$h" XDG_DATA_HOME="$x" sh "$inst" > /dev/null; expect "install with XDG_DATA_HOME set" 0 $?
xd="$x/personal-multi-harness-workstation-configuration"
if [ -x "$xd/hitl-escalation-guard.sh" ] && [ -f "$xd/hitl.conf" ] && [ ! -e "$(data "$h")" ]; then
  ok "the hook and its config are under XDG_DATA_HOME, nothing under ~/.local/share"
else
  ko "XDG_DATA_HOME not honoured"
fi
if jq -e --arg c "\"$xd/hitl-escalation-guard.sh\"" '[.hooks.PreToolUse[].hooks[] | select(.command == $c)] | length == 1' "$h/.claude/settings.json" >/dev/null; then
  ok "the settings entry runs the hook from XDG_DATA_HOME"
else
  ko "the settings entry does not point at XDG_DATA_HOME"
fi
if jq -e --arg d "$xd/clipboard_guard.py" '[.hooks.UserPromptSubmit[].hooks[] | select(.command | contains($d))] | length == 1' "$h/.claude/settings.json" >/dev/null \
   && grep -qF "$xd/clipboard_guard.py" "$h/.codex/hooks.json"; then
  ok "both paste-filter entries run the core from XDG_DATA_HOME"
else
  ko "the paste-filter entries do not point at XDG_DATA_HOME"
fi
HOME="$h" XDG_DATA_HOME="$x" sh "$inst" --check > /dev/null; expect "check with XDG_DATA_HOME set" 0 $?

# 13. a data path the hook command cannot quote safely: the paste filter is refused, not mis-quoted,
# and an entry of ours already in the settings is removed rather than left pointing at a stale path
h="$base/home-quote"; x="$base/xdg-q\"uote"; mkdir -p "$h/.claude" "$x"
printf '%s\n' '{"hooks":{"UserPromptSubmit":[{"hooks":[{"type":"command","command":"/usr/bin/python3 /old/personal-multi-harness-workstation-configuration/clipboard_guard.py prompt-hook"}]}]}}' > "$h/.claude/settings.json"
HOME="$h" XDG_DATA_HOME="$x" sh "$inst" > "$base/quote.out" 2>&1; expect "install refuses the paste filter on an unquotable path" 2 $?
if grep -q '^REFUSE  paste filter' "$base/quote.out" && [ ! -e "$h/.codex/hooks.json" ] && [ "$(pours "$h/.claude/settings.json")" -eq 0 ]; then
  ok "no codex hooks.json, and the stale Claude Code entry was removed"
else
  ko "the unquotable path was not refused cleanly"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
