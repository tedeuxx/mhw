#!/bin/sh
# Test global/install.sh against throwaway HOME directories (never the real one).
#   install.test.sh <empty-or-new base directory for the fake HOMEs>
set -u

base=${1:?usage: install.test.sh <base dir>}
mkdir -p "$base"
inst="$(cd "$(dirname "$0")" && pwd)/install.sh"
unset CODEX_HOME XDG_DATA_HOME
# Sections 1-16 seed settings files with values of their own (a "model" among them), which the model
# defaults would rightly refuse to overwrite. They run with a copy of the repository overlay minus
# model-defaults.json; section 17 runs the real overlay and asserts the model defaults (ADR-0035).
models_off="$base/overlay-without-model-defaults"
mkdir -p "$models_off"
cp -R "$(cd "$(dirname "$0")/.." && pwd)/overlay/." "$models_off/"
rm -f "$models_off/model-defaults.json"
WORKSTATION_OVERLAY=$models_off
export WORKSTATION_OVERLAY
pass=0
fail=0

ok() { pass=$((pass + 1)); echo "PASS  $1"; }
ko() { fail=$((fail + 1)); echo "FAIL  $1"; }
expect() { # $1 description, $2 expected exit, $3 actual exit
  if [ "$2" -eq "$3" ]; then ok "$1 (exit $3)"; else ko "$1 (expected $2, got $3)"; fi
}

data() { echo "$1/.local/share/personal-multi-harness-workstation-configuration"; }
targets() {
  targets_home=$1
  echo "$targets_home/.claude/CLAUDE.md $targets_home/.codex/AGENTS.md $targets_home/.kiro/steering/workstation-global-brief.md"
  echo "$targets_home/.claude/settings.json"
  echo "$targets_home/.codex/rules/workstation-deny-floor.rules"
  echo "$(data "$targets_home")/clipboard_guard.py $(data "$targets_home")/clipboard.conf $targets_home/.codex/hooks.json"
  echo "$(data "$targets_home")/paste_wrapper.py $(data "$targets_home")/paste-filter.sh"
}
plist() { echo "$1/Library/LaunchAgents/local.personal-multi-harness-workstation-configuration.clipboard-guard.plist"; }
clip_src="$(cd "$(dirname "$0")" && pwd)/clipboard/clipboard_guard.py"
wrap_src="$(cd "$(dirname "$0")" && pwd)/clipboard/paste_wrapper.py"
fingerprint() { for f in $(targets "$1"); do cksum "$f" 2>/dev/null || echo "absent $f"; done; }
ours() { # number of entries of the removed HITL picker guard in a settings file (must stay 0)
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
# The default install appends the repository overlay's floor entries (ADR-0016), so they count too.
overlay_floor="$(cd "$(dirname "$0")/.." && pwd)/overlay/deny-floor.conf"
[ -f "$overlay_floor" ] || overlay_floor=/dev/null
# Expected Claude rules, derived from the source independently of the installer's awk: a cmd line is
# one rule, a glob line one (Claude Code only), a file line two (Read and Edit).
floor_rules=$(awk '$1 == "cmd" || $1 == "glob" { n++ } $1 == "file" { n += 2 } END { print n }' "$floor_src" "$overlay_floor")
floor_cmds=$(awk '$1 == "cmd" { n++ } END { print n }' "$floor_src" "$overlay_floor")
has_rule() { # $1 settings file, $2 rule; prints how many times the rule is in permissions.deny
  jq --arg r "$2" '[.permissions.deny[]? | select(. == $r)] | length' "$1"
}

# 1. dry-run writes nothing
h="$base/home-dry"; mkdir -p "$h"
HOME="$h" sh "$inst" --dry-run > "$base/dry.out"; expect "dry-run exits 0" 0 $?
n=$(find "$h" -type f | wc -l | tr -d ' ')
if [ "$n" -eq 0 ]; then ok "dry-run wrote no file"; else ko "dry-run wrote $n file(s)"; fi
if grep -q '^WOULD WRITE' "$base/dry.out"; then ok "dry-run prints targets"; else ko "dry-run printed no target"; fi
if grep -q '^WOULD MERGE' "$base/dry.out" && grep -q '^+.*clipboard_guard.py' "$base/dry.out"; then
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
# Regression (Issue #60, ADR-0013 2026-10-05 amendment): the HITL picker guard is removed. A fresh
# install writes no guard script or limits, and registers no PreToolUse hook at all.
if [ ! -e "$(data "$h")/hitl-escalation-guard.sh" ] && [ ! -e "$(data "$h")/hitl.conf" ] \
   && [ "$(ours "$h/.claude/settings.json")" -eq 0 ] \
   && jq -e '(.hooks.PreToolUse // []) | length == 0' "$h/.claude/settings.json" >/dev/null \
   && ! grep -qs AskUserQuestion "$h/.claude/settings.json" "$h/.codex/hooks.json"; then
  ok "no HITL picker guard script, limits or hook entry is installed"
else
  ko "a HITL picker guard artefact was installed"
fi
# The interaction standards (Issue #60) reach the rendered brief of every harness as instructions.
for b in "$h/.claude/CLAUDE.md" "$h/.codex/AGENTS.md" "$h/.kiro/steering/workstation-global-brief.md"; do
  if grep -q 'one extreme, the opposite extreme, and the middle ground' "$b" \
     && grep -q 'one question per message; a question stem is at most 280 characters; the reasoning goes in a linked artifact' "$b" \
     && grep -q 'talk to the owner in Brazilian Portuguese. Anything published is in English' "$b" \
     && ! grep -q 'session-policy.json' "$b" && ! grep -q 'Melhoria de harness' "$b"; then
    ok "${b#"$h"/} carries the interaction standards and no session-type intake"
  else
    ko "${b#"$h"/} lacks an interaction standard or still carries the intake"
  fi
done
HOME="$h" sh "$inst" --check; expect "check after install" 0 $?

# The restart guard and /breaking-glass are removed (ADR-0028): nothing of theirs is rendered.
if ! grep -qs -e 'restart_guard' -e 'breaking_glass' "$h/.claude/settings.json" "$h/.codex/hooks.json" \
   && [ ! -e "$(data "$h")/restart_guard.py" ] && [ ! -e "$(data "$h")/breaking_glass.py" ] \
   && [ ! -e "$h/.claude/commands/breaking-glass.md" ] \
   && [ "$(jq -c '.hooks | keys' "$h/.codex/hooks.json")" = '["UserPromptSubmit"]' ]; then
  ok "no restart guard or breaking-glass file or hook entry is installed"
else
  ko "a restart guard or breaking-glass artefact was installed"
fi

# 2a. an earlier release's restart guard and breaking glass are removed cleanly, but only by a run
# of the installer: --check reports them, install deletes what this project wrote, and nothing foreign.
hl="$base/home-legacy"; mkdir -p "$hl/.claude/commands" "$hl/.codex"
HOME="$hl" sh "$inst" > /dev/null 2>&1
mkdir -p "$(data "$hl")/restart-state"
legacy_cmd="/usr/bin/python3 -I -B \"$(data "$hl")/restart_guard.py\" --harness claude-code"
jq --arg c "$legacy_cmd" '.hooks.SessionStart = [{hooks: [{type: "command", command: $c, timeout: 10}]}]
  | .hooks.PreToolUse += [{hooks: [{type: "command", command: $c, timeout: 10}]}]
  | .hooks.PreToolUse += [{hooks: [{type: "command", command: "/foreign/pre.sh"}]}]' \
  "$hl/.claude/settings.json" > "$base/legacy.json" && cat "$base/legacy.json" > "$hl/.claude/settings.json"
jq --arg c "$legacy_cmd" '.hooks.SessionStart = [{hooks: [{type: "command", command: $c, timeout: 10}]}]
  | .hooks.PreToolUse = [{hooks: [{type: "command", command: $c, timeout: 10}]}]' \
  "$hl/.codex/hooks.json" > "$base/legacy.json" && cat "$base/legacy.json" > "$hl/.codex/hooks.json"
for f in restart_guard.py breaking_glass.py hitl-escalation-guard.sh hitl.conf; do
  printf '#!/usr/bin/env python3\n# managed-by: personal-multi-harness-workstation-configuration; source: x\n' > "$(data "$hl")/$f"
done
# The removed HITL picker guard's entry, as an earlier release merged it (ADR-0013, 2026-10-05).
jq --arg c "\"$(data "$hl")/hitl-escalation-guard.sh\"" \
  '.hooks.PreToolUse += [{matcher: "AskUserQuestion", hooks: [{type: "command", command: $c, timeout: 5}]}]' \
  "$hl/.claude/settings.json" > "$base/legacy.json" && cat "$base/legacy.json" > "$hl/.claude/settings.json"
printf -- '---\n---\n<!-- managed-by: personal-multi-harness-workstation-configuration; source: x -->\n' > "$hl/.claude/commands/breaking-glass.md"
printf '{}' > "$(data "$hl")/restart-state/claude-code-0123.json"
HOME="$hl" sh "$inst" --check > "$base/legacy-check.out" 2>&1; expect "check reports the removed guard's leftovers" 1 $?
if [ "$(grep -c '^STALE' "$base/legacy-check.out")" -eq 7 ] && grep -q '^DRIFT .*settings.json' "$base/legacy-check.out" \
   && grep -q '^STALE .*hitl-escalation-guard.sh' "$base/legacy-check.out" && grep -q '^STALE .*hitl.conf' "$base/legacy-check.out" \
   && grep -q '^STALE .*settings.json: the removed HITL picker guard' "$base/legacy-check.out" \
   && [ -f "$(data "$hl")/hitl-escalation-guard.sh" ] && [ "$(ours "$hl/.claude/settings.json")" -eq 1 ] \
   && grep -q '^DRIFT .*hooks.json' "$base/legacy-check.out" && [ -f "$(data "$hl")/restart_guard.py" ]; then
  ok "check names every leftover and changes nothing"
else
  ko "check did not name every leftover"; cat "$base/legacy-check.out"
fi
HOME="$hl" sh "$inst" > /dev/null 2>&1; expect "install over an earlier release" 0 $?
if ! grep -qs -e 'restart_guard' -e 'breaking_glass' "$hl/.claude/settings.json" "$hl/.codex/hooks.json" \
   && [ ! -e "$(data "$hl")/restart_guard.py" ] && [ ! -e "$(data "$hl")/breaking_glass.py" ] \
   && [ ! -e "$hl/.claude/commands/breaking-glass.md" ] && [ ! -e "$(data "$hl")/restart-state" ] \
   && jq -e '(.hooks.SessionStart // []) | length == 0' "$hl/.claude/settings.json" >/dev/null \
   && jq -e '[.hooks.PreToolUse[]?.hooks[]? | select(.command == "/foreign/pre.sh")] | length == 1' "$hl/.claude/settings.json" >/dev/null \
   && [ ! -e "$(data "$hl")/hitl-escalation-guard.sh" ] && [ ! -e "$(data "$hl")/hitl.conf" ] \
   && [ "$(pours "$hl/.claude/settings.json")" -eq 1 ] && [ "$(ours "$hl/.claude/settings.json")" -eq 0 ] \
   && ! grep -qs AskUserQuestion "$hl/.claude/settings.json"; then
  ok "install removes the restart guard, breaking glass and the HITL picker guard, keeps the paste filter and foreign hooks"
else
  ko "install left a restart guard or breaking-glass artefact, or removed something else"
fi
HOME="$hl" sh "$inst" --check > /dev/null 2>&1; expect "check is clean after the cleanup" 0 $?
printf 'mine\n' > "$hl/.claude/commands/breaking-glass.md"
HOME="$hl" sh "$inst" > "$base/legacy-foreign.out" 2>&1
if [ "$(cat "$hl/.claude/commands/breaking-glass.md")" = mine ] && grep -q '^NOTE .*breaking-glass.md' "$base/legacy-foreign.out"; then
  ok "an unmanaged file at a removed path is left alone"
else
  ko "an unmanaged file at a removed path was touched"
fi

# 2b. the deny floor, rendered for Claude Code and Codex
s="$h/.claude/settings.json"
if [ "$(jq '(.permissions.deny - (.["personal-multi-harness-workstation-configuration-owned-allow"].deny // [])) | length' "$s")" -eq "$floor_rules" ] && [ "$floor_rules" -gt 0 ]; then
  ok "settings carry every deny-floor rule ($floor_rules), nothing else beside the allow list's own Edit protections"
else
  ko "deny count $(jq '(.permissions.deny - (.["personal-multi-harness-workstation-configuration-owned-allow"].deny // [])) | length' "$s"), expected $floor_rules"
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
# 2b'. one named rule per class the owner added on 2026-10-10 (ADR-0035), so removing any class from the
# source turns this red (the counts above are derived from the source and would follow it down).
for r in 'Bash(terraform plan:*)' 'Bash(terraform env:*)' 'Bash(tofu env:*)' 'Bash(terraform state:*)' 'Bash(terraform init:*)' 'Bash(terraform force-unlock:*)' \
         'Bash(tofu output:*)' 'Bash(tofu apply:*)' 'Bash(terraform -chdir=*)' 'Bash(tofu -chdir=*)' \
         'Bash(aws ssm get-parameter --with-decryption:*)' 'Bash(aws ssm get-parameters-by-path --with-decryption:*)' \
         'Bash(git commit --no-verify:*)' 'Bash(git commit -n:*)' 'Bash(git push --no-verify:*)' 'Bash(aws sso login:*)' \
         'Read(**/.env)' 'Edit(**/.env)' 'Read(**/.env.*)' 'Read(**/*.pem)' 'Edit(**/*.pem)' 'Read(**/credentials*)' 'Edit(**/credentials*)'; do
  if [ "$(has_rule "$s" "$r")" -eq 1 ]; then ok "deny holds $r once"; else ko "deny lacks $r"; fi
done
for p in 'terraform plan' 'tofu state' 'terraform env' 'aws ssm get-parameter --with-decryption' 'git commit --no-verify' 'git push --no-verify' 'aws sso login'; do
  pat=$(printf '%s' "$p" | awk '{ for (i = 1; i <= NF; i++) printf "%s\"%s\"", (i > 1 ? ", " : ""), $i }')
  if grep -qxF "prefix_rule(pattern=[$pat], decision=\"forbidden\")" "$rules"; then ok "codex forbids $p"; else ko "codex lacks $p"; fi
done
# A glob and a file entry have no Codex form: nothing with "*" or "-chdir" reaches the Codex rules.
if ! grep "^prefix_rule(" "$rules" | grep -q -e "\\*" -e "-chdir"; then ok "codex rules carry no glob or file entry"; else ko "a glob or file entry leaked into the codex rules"; fi
# The subcommands the owner left open stay open: no rendered rule covers fmt, validate or version, for
# either binary. A Bash(<p>:*) rule covers a command when <p> is a word prefix of it; a glob
# Bash(<p>*) when the command starts with <p>.
open_hit=""
for c in 'terraform fmt -recursive' 'terraform validate' 'terraform version' 'tofu fmt' 'tofu validate' 'tofu version'; do
  hit=$(jq -r --arg c "$c" '.permissions.deny[] | select(startswith("Bash("))
          | .[5:-1] as $b
          | if ($b | endswith(":*")) then ($b[:-2]) as $p | select($c == $p or ($c | startswith($p + " ")))
            elif ($b | endswith("*")) then ($b[:-1]) as $p | select($c | startswith($p))
            else empty end' "$s")
  [ -n "$hit" ] && open_hit="$open_hit $c<-$hit"
done
if [ -z "$open_hit" ]; then ok "terraform/tofu fmt, validate and version stay open"; else ko "an open subcommand is denied:$open_hit"; fi
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

# 2c''. the opt-in shell start-up line (Issue #58), against THROWAWAY rc files only. It is written only
# with --shell-rc=FILE, appended once, printed, and never duplicated or rewritten.
h3="$base/home-rc"; mkdir -p "$h3"
rc="$h3/zshrc-throwaway"
printf 'export SYNTHETIC_OWNER_SETTING=1' > "$rc"          # no trailing newline, on purpose
sn3="$(data "$h3")/paste-filter.sh"
want_rc="[ -r \"$sn3\" ] && . \"$sn3\"  # personal-multi-harness-workstation-configuration: paste wrapper (ADR-0011)"
rc_before=$(cksum < "$rc")
HOME="$h3" sh "$inst" --dry-run --shell-rc="$rc" > "$base/rc-dry.out"; expect "dry-run with --shell-rc" 0 $?
if [ "$(cksum < "$rc")" = "$rc_before" ] && grep -qxF "WOULD APPEND to $rc: $want_rc" "$base/rc-dry.out"; then
  ok "dry-run prints the rc line and writes nothing"
else
  ko "dry-run with --shell-rc wrote the rc or printed the wrong line"
fi
HOME="$h3" sh "$inst" --shell-rc="$rc" > "$base/rc-1.out"; expect "install with --shell-rc" 0 $?
if [ "$(grep -cxF "$want_rc" "$rc")" -eq 1 ] && [ "$(sed -n 1p "$rc")" = "export SYNTHETIC_OWNER_SETTING=1" ] \
   && [ "$(wc -l < "$rc" | tr -d ' ')" -eq 2 ] && grep -qxF "APPENDED to $rc (opt-in, --shell-rc): $want_rc" "$base/rc-1.out"; then
  ok "install appends the line once, on its own line, keeps the owner's content and prints what it wrote"
else
  ko "install --shell-rc produced the wrong rc: $(cat "$rc")"
fi
rc_once=$(cksum < "$rc")
HOME="$h3" sh "$inst" --shell-rc="$rc" > "$base/rc-2.out"; expect "install with --shell-rc, again" 0 $?
if [ "$(cksum < "$rc")" = "$rc_once" ] && grep -qxF "OK      $rc activates the paste wrapper" "$base/rc-2.out"; then
  ok "a second install leaves the rc byte-identical (idempotent)"
else
  ko "a second install changed the rc"
fi
HOME="$h3" sh "$inst" --check --shell-rc="$rc" > "$base/rc-check.out"; expect "check with the rc line present" 0 $?
for shl in zsh bash; do
  if command -v "$shl" >/dev/null 2>&1; then
    t=$(HOME="$h3" "$shl" -c ". \"$rc\"; type claude" 2>&1 | head -n 1)
    case $t in
      *function*) ok "$shl: sourcing the rc defines the wrapper functions" ;;
      *) ko "$shl: the rc line did not define claude: $t" ;;
    esac
  fi
done
rc_new="$h3/never-created-rc"
HOME="$h3" sh "$inst" --check --shell-rc="$rc_new" > "$base/rc-miss.out"; expect "check reports a missing rc line" 1 $?
if grep -q "^MISSING $rc_new" "$base/rc-miss.out" && [ ! -e "$rc_new" ]; then ok "check names the missing line and creates nothing"; else ko "check on a missing rc line"; fi
rc_stale="$h3/stale-rc"
printf '. /old/place/paste-filter.sh  # personal-multi-harness-workstation-configuration: paste wrapper (ADR-0011)\n' > "$rc_stale"
stale_before=$(cksum < "$rc_stale")
HOME="$h3" sh "$inst" --shell-rc="$rc_stale" > "$base/rc-stale.out"; expect "install refuses to rewrite a different tagged line" 1 $?
if [ "$(cksum < "$rc_stale")" = "$stale_before" ] && grep -q "^STALE   $rc_stale" "$base/rc-stale.out"; then ok "a differing tagged line is reported and left alone"; else ko "a differing tagged line was rewritten"; fi
mkdir -p "$h3/rc-is-a-dir"
HOME="$h3" sh "$inst" --shell-rc="$h3/rc-is-a-dir" > "$base/rc-dir.out"; expect "install refuses a non-regular rc" 3 $?
HOME="$h3" sh "$inst" --shell-rc=relative-rc > /dev/null 2>&1; expect "a relative --shell-rc is a usage error" 2 $?
if [ ! -e "$h3/relative-rc" ] && [ ! -e relative-rc ]; then ok "a relative --shell-rc writes nothing"; else ko "a relative --shell-rc wrote a file"; fi

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
jq --arg c "\"$(data "$h")/hitl-escalation-guard.sh\"" \
  '.hooks.PreToolUse += [{matcher: "AskUserQuestion", hooks: [{type: "command", command: $c}]}]' \
  "$h/.claude/settings.json" > "$base/s.json" && cp "$base/s.json" "$h/.claude/settings.json"
HOME="$h" sh "$inst" --check > "$base/check-guard.out"; expect "check detects a re-registered picker guard entry" 1 $?
if grep -q '^STALE .*settings.json: the removed HITL picker guard' "$base/check-guard.out"; then ok "check names the picker guard entry as STALE"; else ko "check did not name the picker guard entry"; fi
HOME="$h" sh "$inst" > /dev/null; expect "install removes the picker guard entry" 0 $?
if [ "$(ours "$h/.claude/settings.json")" -eq 0 ]; then ok "the picker guard entry is gone"; else ko "the picker guard entry survived install"; fi
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
if [ "$(jq -S '.hooks.PreToolUse |= map(select(all(.hooks[]; (.command | contains("personal-multi-harness-workstation-configuration/") | not)))) | del(.hooks.UserPromptSubmit, .hooks.SessionStart, .["personal-multi-harness-workstation-configuration"], .["personal-multi-harness-workstation-configuration-owned-deny"], .["personal-multi-harness-workstation-configuration-owned-allow"], .permissions.defaultMode) | .permissions.deny |= .[0:2] | .permissions.allow |= .[0:1]' "$s")" = "$orig" ]; then
  ok "every pre-existing key, hook and rule survives in place; only our entries, stamp key and ownership keys were appended"
else
  ko "pre-existing content changed"
fi
if [ "$(jq '(.permissions.deny - (.["personal-multi-harness-workstation-configuration-owned-allow"].deny // [])) | length' "$s")" -eq $((floor_rules + 1)) ] \
   && [ "$(has_rule "$s" 'Bash(rm -rf:*)')" -eq 1 ] && [ "$(has_rule "$s" 'Bash(my-own-rule:*)')" -eq 1 ]; then
  ok "deny is a union: a floor rule already present is not duplicated, a foreign rule is kept"
else
  ko "deny union wrong: $(jq '(.permissions.deny - (.["personal-multi-harness-workstation-configuration-owned-allow"].deny // [])) | length' "$s") entries, expected $((floor_rules + 1))"
fi
if [ "$(jq -S . "$s.pmhwc-backup")" = "$orig" ]; then ok "backup holds the previous settings"; else ko "backup missing or wrong"; fi
if [ "$(stat -c %a "$s" 2>/dev/null || stat -f %Lp "$s")" = 600 ]; then ok "file mode preserved (600)"; else ko "file mode changed"; fi
snap=$(cksum < "$s")
HOME="$h" sh "$inst" > /dev/null; expect "re-merge" 0 $?
if [ "$(cksum < "$s")" = "$snap" ]; then ok "re-merge left settings byte-identical"; else ko "re-merge rewrote settings"; fi

# 7. stale and duplicate entries of the removed picker guard all go; foreign hooks in the same group survive
jq '.hooks.PreToolUse += [
      {matcher: "AskUserQuestion", hooks: [{type: "command", command: "/old/path/personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"}]},
      {matcher: "AskUserQuestion", hooks: [
        {type: "command", command: "/old2/personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"},
        {type: "command", command: "/someone/else.sh"}]}]' "$s" > "$base/s.json" && cp "$base/s.json" "$s"
HOME="$h" sh "$inst" > /dev/null; expect "merge with stale entries" 0 $?
if [ "$(ours "$s")" -eq 0 ]; then ok "stale and duplicate picker guard entries are all removed"; else ko "picker guard entries left: $(ours "$s")"; fi
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
if grep -q '^notice_blocked=' "$(data "$h")/clipboard.conf"; then ko "overlay leaked into generic paste filter settings"; else ok "generic paste filter settings carry no owner overlay"; fi

# 9b. A structured profile changed without regeneration is refused before writing any target.
profile_dir="$base/profile-stale"
mkdir -p "$profile_dir"
for profile_file in profile.json AGENTS.md clipboard.conf desktop-instructions.md profile-plan.json; do
  cp "$(dirname "$inst")/../overlay/$profile_file" "$profile_dir/$profile_file"
done
jq '.session_start.priority = "speed"' "$profile_dir/profile.json" > "$base/profile-next.json"
cp "$base/profile-next.json" "$profile_dir/profile.json"
h="$base/home-profile-stale"; mkdir -p "$h"
HOME="$h" sh "$inst" --overlay="$profile_dir" > /dev/null
expect "stale compiled profile refused before installation" 1 $?
if [ -z "$(find "$h" -type f -print)" ]; then ok "stale profile wrote no target"; else ko "stale profile wrote targets"; fi
(cd "$profile_dir" && python3 -B "$(dirname "$inst")/profile/profile.py" render --source profile.json --output .) > /dev/null
expect "regenerate changed profile" 0 $?
HOME="$h" sh "$inst" --overlay="$profile_dir" > /dev/null
expect "regenerated profile installs" 0 $?
if grep -q 'Prioritize lower latency' "$h/.claude/CLAUDE.md"; then ok "new preference reaches installed brief"; else ko "new preference missing"; fi

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
for e in 'cmd rm "-rf"' 'cmd git push --force*' 'path ~/.ssh' 'file ~/a ~/b' 'cmd' 'glob terraform*' 'glob terraform -chdir=*x' 'glob terraform -c*hdir=*' 'glob terraform -chdir=**' 'glob terraform *' 'glob terraform plan:*'; do
  i=$((i + 1))
  printf '%s\n' "$e" > "$ov/deny-floor.conf"
  h="$base/home-badfloor-$i"; mkdir -p "$h"
  HOME="$h" sh "$inst" --overlay="$ov" > /dev/null 2>&1; rc=$?
  n=$(find "$h" -type f | wc -l | tr -d ' ')
  if [ "$rc" -eq 2 ] && [ "$n" -eq 0 ]; then ok "invalid entry refused, nothing written: $e"; else ko "invalid entry '$e': exit $rc, $n file(s)"; fi
done

# 12. XDG_DATA_HOME is honoured: the paste filter and its data go there, and the entries point there
h="$base/home-xdg"; x="$base/xdg-data"; mkdir -p "$h" "$x"
HOME="$h" XDG_DATA_HOME="$x" sh "$inst" > /dev/null; expect "install with XDG_DATA_HOME set" 0 $?
xd="$x/personal-multi-harness-workstation-configuration"
if [ -f "$xd/clipboard_guard.py" ] && [ -f "$xd/clipboard.conf" ] && [ ! -e "$(data "$h")" ]; then
  ok "the paste filter and its config are under XDG_DATA_HOME, nothing under ~/.local/share"
else
  ko "XDG_DATA_HOME not honoured"
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

# 14. --hooks=managed (ADR-0025): the admin layer registers the hooks, so the user layer drops every
# hook entry of ours and the Codex hooks.json, keeps the deny floor and the brief, and keeps foreign hooks.
h="$base/home-managed"; mkdir -p "$h/.claude"
printf '%s\n' '{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"/foreign/guard.sh"}]}]}}' > "$h/.claude/settings.json"
HOME="$h" sh "$inst" > /dev/null 2>&1; expect "user-mode install before switching to managed" 0 $?
HOME="$h" sh "$inst" --check --hooks=managed > /dev/null 2>&1; expect "managed check flags the user-level hooks as drift" 1 $?
HOME="$h" sh "$inst" --hooks=managed > "$base/managed.out" 2>&1; expect "managed-mode install" 0 $?
s="$h/.claude/settings.json"
if [ "$(ours "$s")" -eq 0 ] && [ "$(pours "$s")" -eq 0 ] \
   && [ "$(jq '[.hooks[]?[]?.hooks[]? | select(.command | contains("personal-multi-harness-workstation-configuration/restart_guard.py"))] | length' "$s")" -eq 0 ] \
   && [ ! -e "$h/.codex/hooks.json" ] && grep -q '^REMOVED .*hooks.json' "$base/managed.out"; then
  ok "managed mode removes every user-level hook entry of ours and the Codex hooks.json"
else
  ko "managed mode left a user-level hook of ours behind"
fi
if jq -e '[.hooks.PreToolUse[]?.hooks[]? | select(.command == "/foreign/guard.sh")] | length == 1' "$s" >/dev/null \
   && jq -e '.permissions.deny | index("Bash(sudo:*)") != null' "$s" >/dev/null \
   && [ -f "$h/.claude/CLAUDE.md" ] && [ -f "$(data "$h")/clipboard_guard.py" ]; then
  ok "managed mode keeps foreign hooks, the deny floor, the brief and the hook scripts"
else
  ko "managed mode removed something that is not a user-level hook of ours"
fi
HOME="$h" sh "$inst" --check --hooks=managed > /dev/null 2>&1; expect "managed check is clean after a managed install" 0 $?
HOME="$h" sh "$inst" --check > /dev/null 2>&1; expect "user check flags the missing user-level hooks" 1 $?

# 15. the provenance stamp (Issue #66, ADR-0029): every rendered file names the release and commit it
# came from, and that is the source's own stamp, the one install prints on its SOURCE line.
STAMP_KEY=personal-multi-harness-workstation-configuration
stamp_in() { # $1 file: the release and commit fields of its first managed-by line (settings: our key)
  case $1 in
    */settings.json) jq -r --arg k "$STAMP_KEY" '.[$k] // ""' "$1" ;;
    *) grep -m 1 -F 'managed-by: personal-multi-harness-workstation-configuration' "$1" ;;
  esac | sed -n 's/.*; \(release: [^;"]*; commit: [^;"]*\);.*/\1/p'
}
hs="$base/stamp"; mkdir -p "$hs"
HOME="$hs" sh "$inst" > "$base/stamp-install.out" 2>&1; expect "install for the stamp check exits 0" 0 $?
src_stamp=$(sed -n 's/^SOURCE  //p' "$base/stamp-install.out")
repo_dir="$(cd "$(dirname "$inst")/.." && pwd)"
head_sha=$(git -C "$repo_dir" rev-parse --verify HEAD 2>/dev/null || echo unknown)
case $src_stamp in
  "release: "*"; commit: $head_sha" | "release: "*"; commit: $head_sha-dirty") ok "the source stamp names HEAD ($src_stamp)" ;;
  *) ko "the source stamp does not name HEAD $head_sha: '$src_stamp'" ;;
esac
unstamped=""
for f in $(targets "$hs"); do
  if [ -n "$src_stamp" ] && [ "$(stamp_in "$f")" = "$src_stamp" ]; then :; else unstamped="$unstamped ${f#"$hs"/}"; fi
done
if [ -z "$unstamped" ]; then ok "every rendered file carries the source's stamp"; else ko "rendered file(s) without the source's stamp:$unstamped"; fi
HOME="$hs" sh "$inst" --check > "$base/stamp-check0.out" 2>&1; expect "check is clean on a fresh install" 0 $?
if [ "$(grep -c '^OK .*release: ' "$base/stamp-check0.out")" -ge "$(targets "$hs" | wc -w)" ]; then
  ok "check reports the stamp of every installed file"
else
  ko "check did not report every file's stamp"
fi
# Another commit's stamp on unchanged content: STAMP (not DRIFT), named, and install rewrites it.
other=0123456789abcdef0123456789abcdef01234567
for f in "$hs/.claude/CLAUDE.md" "$hs/.codex/hooks.json" "$hs/.claude/settings.json"; do
  sed "s/; commit: [^;\"]*;/; commit: $other;/" "$f" > "$f.t" && cat "$f.t" > "$f" && rm "$f.t"
done
HOME="$hs" sh "$inst" --check > "$base/stamp-check1.out" 2>&1; expect "check flags a stamp that differs from the source" 1 $?
if [ "$(grep -c "^STAMP .*commit: $other" "$base/stamp-check1.out")" -eq 3 ] && ! grep -q '^DRIFT' "$base/stamp-check1.out"; then
  ok "check names each of the three restamped files as STAMP, with the stamp it carries, and no DRIFT"
else
  ko "check did not name the three stamp differences"; cat "$base/stamp-check1.out"
fi
HOME="$hs" sh "$inst" > /dev/null 2>&1; expect "install restamps" 0 $?
HOME="$hs" sh "$inst" --check > /dev/null 2>&1; expect "check is clean after the restamp" 0 $?
printf 'x\n' >> "$(data "$hs")/clipboard.conf"
HOME="$hs" sh "$inst" --check > "$base/stamp-check2.out" 2>&1; expect "check still flags a content change" 1 $?
if grep -q '^DRIFT .*clipboard.conf' "$base/stamp-check2.out"; then ok "a content change is DRIFT, not STAMP"; else ko "a content change was not reported as DRIFT"; fi

# 15b. which release a stamp names: the tag rule, in a throwaway git repository holding a copy of the
# sources (never the real repository's tags).
tr="$base/tagrepo"; mkdir -p "$tr"
cp -R "$repo_dir/global" "$repo_dir/overlay" "$repo_dir/.bumpversion.toml" "$tr/"
g() { git -C "$tr" -c user.name=t -c user.email=t@example.invalid -c commit.gpgsign=false -c tag.gpgSign=false "$@"; }
source_stamp() { HOME="$base/tag-home" sh "$tr/global/install.sh" --dry-run 2>/dev/null | sed -n 's/^SOURCE  //p'; }
mkdir -p "$base/tag-home"
g -c init.defaultBranch=main init -q && g add -A && g commit -qm one
c1=$(g rev-parse HEAD)
s=$(source_stamp)
if [ "$s" = "release: unreleased, no tag reachable; commit: $c1" ]; then ok "no tag: unreleased, no tag reachable"; else ko "no tag: '$s'"; fi
g tag v9.8.7
s=$(source_stamp)
if [ "$s" = "release: v9.8.7; commit: $c1" ]; then ok "on a release tag: the tag"; else ko "on a tag: '$s'"; fi
printf '# local edit\n' >> "$tr/global/clipboard.conf"
s=$(source_stamp)
if [ "$s" = "release: unreleased, after v9.8.7; commit: $c1-dirty" ]; then ok "tracked edit: unreleased, commit marked dirty"; else ko "dirty: '$s'"; fi
g commit -qam two
c2=$(g rev-parse HEAD)
s=$(source_stamp)
if [ "$s" = "release: unreleased, after v9.8.7; commit: $c2" ]; then ok "after the tag: nearest tag plus the SHA"; else ko "after a tag: '$s'"; fi

# 16. --check reports which layer carries the deny floor (ADR-0016, 2026-10-05 amendment). The admin
# layer is read under a throwaway --managed-root and installed there by install-managed.sh --root; no
# system path is read or written. The report never changes the exit status.
hf="$base/floor-layer"; mr="$base/floor-root"; mkdir -p "$hf" "$mr"
HOME="$hf" sh "$inst" > /dev/null 2>&1; expect "install for the floor-layer report" 0 $?
HOME="$hf" sh "$inst" --check --managed-root="$mr" > "$base/floor1.out" 2>&1; expect "check without an admin floor stays clean" 0 $?
if grep -q "^FLOOR   Claude Code: user layer $floor_rules/$floor_rules rules; admin layer 0/$floor_rules rules" "$base/floor1.out" \
   && grep -q '^FLOOR   carried by: the user layer only' "$base/floor1.out"; then
  ok "check reports the floor carried by the user layer only"
else
  ko "check did not report the user-only floor"
fi
mgr="$(dirname "$inst")/install-managed.sh"
TMPDIR="$base" HOME="$hf" sh "$mgr" --root="$mr" > "$base/floor-render.out" 2>&1
fline=$(sed -n 's/^RUN     //p' "$base/floor-render.out")
fstage=$(printf '%s' "$fline" | sed -n 's/.*--apply="\([^"]*\)".*/\1/p')
fsha=$(printf '%s' "$fline" | sed -n 's/.*--sha256=\([0-9a-f]*\).*/\1/p')
TMPDIR="$base" sh "$mgr" --apply="$fstage" --sha256="$fsha" --root="$mr" > /dev/null 2>&1; expect "admin floor applied under a throwaway root" 0 $?
HOME="$hf" sh "$inst" --check --managed-root="$mr" > "$base/floor2.out" 2>&1; expect "check with the admin floor stays clean" 0 $?
if grep -q "admin layer $floor_rules/$floor_rules rules" "$base/floor2.out" \
   && grep -q "admin requirements $floor_cmds/$floor_cmds prefix rules" "$base/floor2.out" \
   && grep -q '^FLOOR   carried by: the admin layer' "$base/floor2.out"; then
  ok "check reports the floor carried by the admin layer, every rule in both admin documents"
else
  ko "check did not report the admin floor"
fi
if [ "$(uname -s)" = Darwin ]; then
  mdrop="$mr/Library/Application Support/ClaudeCode/managed-settings.d/50-personal-multi-harness-workstation-configuration.json"
else
  mdrop="$mr/etc/claude-code/managed-settings.d/50-personal-multi-harness-workstation-configuration.json"
fi
jq '.permissions.deny |= map(select(. != "Bash(sudo:*)"))' "$mdrop" > "$base/drop.t" && cat "$base/drop.t" > "$mdrop"
HOME="$hf" sh "$inst" --check --managed-root="$mr" > "$base/floor3.out" 2>&1
if grep -q "admin layer $((floor_rules - 1))/$floor_rules rules" "$base/floor3.out" \
   && grep -q '^FLOOR   carried by: the user layer; the admin copy is INCOMPLETE' "$base/floor3.out"; then
  ok "check reports an incomplete admin floor instead of crediting it"
else
  ko "check credited an incomplete admin floor"
fi
mreq="$mr/etc/codex/requirements.toml"
grep -v '{ token = "sudo" }]' "$mreq" > "$base/req.t"; cat "$base/req.t" > "$mreq"
HOME="$hf" sh "$inst" --check --managed-root="$mr" > "$base/floor4.out" 2>&1
if grep -q "admin requirements $((floor_cmds - 1))/$floor_cmds prefix rules" "$base/floor4.out"; then
  ok "check counts the Codex admin prefix rules one by one"
else
  ko "check did not notice a Codex admin prefix rule removed"
fi

# 17. the session-start model defaults (ADR-0007, ADR-0035), through install.sh with the repository
# overlay: written into each harness's native user key, --check reports drift, install never overwrites
# an owner's value, uninstall removes only what mhw set. Per-case semantics: global/models/model_defaults_test.py.
repo_overlay="$(cd "$(dirname "$0")/.." && pwd)/overlay"
models_policy="$repo_overlay/model-defaults.json"
hm="$base/home-models"; mkdir -p "$hm/.claude"
echo '{"theme": "dark"}' > "$hm/.claude/settings.json"
HOME="$hm" sh "$inst" --overlay="$repo_overlay" > "$base/models1.out" 2>&1; expect "install with model defaults" 0 $?
if [ "$(jq -r .model "$hm/.claude/settings.json")" = "$(jq -r '."claude-code".model' "$models_policy")" ] \
   && [ "$(jq -r .effortLevel "$hm/.claude/settings.json")" = "$(jq -r '."claude-code".effort' "$models_policy")" ] \
   && [ "$(jq -r .theme "$hm/.claude/settings.json")" = dark ]; then
  ok "Claude Code: model and effortLevel set from the policy, the owner's other keys kept"
else
  ko "Claude Code model defaults: $(jq -c '{model, effortLevel, theme}' "$hm/.claude/settings.json")"
fi
if grep -qxF "model = \"$(jq -r .codex.model "$models_policy")\"" "$hm/.codex/config.toml" \
   && grep -qxF "model_reasoning_effort = \"$(jq -r .codex.effort "$models_policy")\"" "$hm/.codex/config.toml"; then
  ok "Codex: model and model_reasoning_effort set in config.toml"
else
  ko "Codex model defaults missing from config.toml"
fi
if [ "$(jq -r '."chat.defaultModel"' "$hm/.kiro/settings/cli.json")" = "$(jq -r '."kiro-cli".model' "$models_policy")" ]; then
  ok "Kiro CLI: chat.defaultModel set in cli.json"
else
  ko "Kiro CLI chat.defaultModel not set"
fi
HOME="$hm" sh "$inst" --check --overlay="$repo_overlay" > "$base/models2.out" 2>&1
expect "check after install with model defaults" 0 $?
# Drift as /model would leave it: another value replaces ours. --check names it; install never overwrites it.
jq '.model = "opus[1m]"' "$hm/.claude/settings.json" > "$base/models.t" && cat "$base/models.t" > "$hm/.claude/settings.json"
HOME="$hm" sh "$inst" --check --overlay="$repo_overlay" > "$base/models3.out" 2>&1
expect "check reports a drifted model default (the record still claims the key)" 1 $?
if grep -q '^KEPT    .*/.claude/settings.json: model is "opus\[1m\]"' "$base/models3.out"; then
  ok "check names the drifted Claude Code model as the owner's (KEPT)"
else
  ko "check did not name the drifted model"
fi
# PR #119: an owner's value is KEPT, not a failure. It adds no exit code, so a non-zero install exit
# always means another step failed, and a repeated install settles (check 0, nothing more to write).
HOME="$hm" sh "$inst" --overlay="$repo_overlay" > "$base/models3b.out" 2>&1; expect "install with an owner's model value" 0 $?
if [ "$(jq -r .model "$hm/.claude/settings.json")" = "opus[1m]" ]; then
  ok "install leaves the owner's model value alone"
else
  ko "install overwrote the owner's model value"
fi
HOME="$hm" sh "$inst" --check --overlay="$repo_overlay" > "$base/models3c.out" 2>&1
expect "check settles after install with an owner's model value" 0 $?
HOME="$hm" sh "$inst" --uninstall > "$base/models4.out" 2>&1
if [ "$(jq -c '{model, effortLevel, theme}' "$hm/.claude/settings.json")" = '{"model":"opus[1m]","effortLevel":null,"theme":"dark"}' ] \
   && ! grep -q '^model' "$hm/.codex/config.toml" \
   && [ "$(jq -r '."chat.defaultModel" // "absent"' "$hm/.kiro/settings/cli.json")" = absent ]; then
  ok "uninstall removes only the model-default keys mhw set"
else
  ko "uninstall model defaults: $(jq -c . "$hm/.claude/settings.json")"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
