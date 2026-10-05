#!/bin/sh
# Test the allow-list rendering step (Issue #83, ADR-0031) against throwaway HOMEs and a throwaway admin
# root (never the real ones).
#   allow-list.test.sh <empty-or-new base directory>
# Optional: CODEX=<path to a codex binary> runs the credential-free `codex execpolicy check` arm against
# the rendered rules files (it is skipped, and says so, when no codex is found).
set -u

base=${1:?usage: allow-list.test.sh <base dir>}
mkdir -p "$base"
here="$(cd "$(dirname "$0")" && pwd)"
inst="$here/install.sh"
mgr="$here/install-managed.sh"
conf="$here/allow-list.conf"
floor_src="$here/deny-floor.conf"
overlay_floor="$here/../overlay/deny-floor.conf"
[ -f "$overlay_floor" ] || overlay_floor=/dev/null
unset CODEX_HOME XDG_DATA_HOME
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "PASS  $1"; }
ko() { fail=$((fail + 1)); echo "FAIL  $1"; }
expect() { if [ "$2" -eq "$3" ]; then ok "$1 (exit $3)"; else ko "$1 (expected $2, got $3)"; fi; }

# Expected sizes, counted from the source independently of the installer's awk.
# The default install appends the repository overlay's entries (its test runners), so they count too.
overlay_allow="$here/../overlay/allow-list.conf"
[ -f "$overlay_allow" ] || overlay_allow=/dev/null
n_narrow=$(awk '$1 == "narrow" && $2 != "deny" { n++ } END { print n + 0 }' "$conf" "$overlay_allow")
n_wide_cmd=$(awk '$1 == "wide" && $2 == "cmd" { n++ } END { print n + 0 }' "$conf" "$overlay_allow")
n_wide_all=$(awk '$1 == "wide" && $2 != "deny" { n++ } END { print n + 0 }' "$conf" "$overlay_allow")
n_wide_deny=$(awk '$1 == "wide" && $2 == "deny" { n++ } END { print n + 0 }' "$conf" "$overlay_allow")
n_narrow_cmd=$(awk '$1 == "narrow" && $2 == "cmd" { n++ } END { print n + 0 }' "$conf" "$overlay_allow")
owned_deny() { jq '[.["personal-multi-harness-workstation-configuration-owned-allow"].deny[]? | select(startswith("Bash("))] | length' "$1"; }
allow_n() { jq '[.permissions.allow[]?] | length' "$1"; }
mode_of() { jq -r '.permissions.defaultMode // "none"' "$1"; }
rules_n() { grep -c 'decision="allow")$' "$1"; }
sandbox_of() { sed -n 's/^sandbox_mode = "\(.*\)"$/\1/p' "$1"; }

# 1. No admin floor: the narrow tier everywhere, and one RISK line.
h="$base/home-narrow"; empty="$base/root-empty"; mkdir -p "$h" "$empty"
HOME="$h" sh "$inst" --managed-root="$empty" > "$base/n.out" 2>&1; expect "install without an admin floor" 0 $?
s="$h/.claude/settings.json"
if [ "$(allow_n "$s")" -eq "$n_narrow" ] && [ "$(mode_of "$s")" = none ]; then
  ok "Claude Code: $n_narrow narrow allow rules, no permission mode set"
else
  ko "Claude Code narrow tier wrong: $(allow_n "$s") rules, mode $(mode_of "$s"); expected $n_narrow, none"
fi
if ! jq -e '.permissions.allow[] | select(test("^Bash\\((git switch|git diff|git commit|git add|python3|sh) "))' "$s" > /dev/null \
   && ! jq -e '.permissions.deny[]? | select(test("^Bash\\(git diff --no-index"))' "$s" > /dev/null; then
  ok "no wide rule, runner or escape deny is rendered without the admin floor"
else
  ko "a wide rule was rendered without the admin floor"
fi
if [ "$(grep -c '^RISK ' "$base/n.out")" -eq 1 ]; then ok "the narrowing is stated in exactly one RISK line"; else ko "no single RISK line"; fi
if [ "$(rules_n "$h/.codex/rules/workstation-allow-list.rules")" -eq "$n_narrow_cmd" ] \
   && [ "$(sandbox_of "$h/.codex/workstation.config.toml")" = read-only ]; then
  ok "Codex: $n_narrow_cmd narrow allow rules and a read-only workstation profile"
else
  ko "Codex narrow tier wrong"
fi
k="$h/.kiro/agents/workstation.json"
if [ "$(jq '.toolsSettings.execute_bash.allowedCommands | length' "$k")" -eq "$n_narrow_cmd" ] \
   && [ "$(jq -c .allowedTools "$k")" = '["fs_read"]' ]; then
  ok "Kiro: $n_narrow_cmd trusted commands and fs_read only"
else
  ko "Kiro agent wrong"
fi
HOME="$h" sh "$inst" --check --managed-root="$empty" > /dev/null 2>&1; expect "check clean on the narrow tier" 0 $?
snap=$(cksum "$s" "$h/.codex/workstation.config.toml" "$h/.codex/rules/workstation-allow-list.rules" "$k")
HOME="$h" sh "$inst" --managed-root="$empty" > /dev/null 2>&1
if [ "$(cksum "$s" "$h/.codex/workstation.config.toml" "$h/.codex/rules/workstation-allow-list.rules" "$k")" = "$snap" ]; then
  ok "re-run leaves every allow-list target byte-identical"
else
  ko "re-run changed an allow-list target"
fi

# 1b. The files that decide the allow list are protected from an agent's edit, in every tier (Claude Code).
protect_ok() { # $1 settings file
  for r in "Edit(~/.claude/settings.json)" "Edit(~/.codex/rules/**)" "Edit(~/.codex/*.config.toml)" \
      "Edit(~/.kiro/agents/**)" "Edit(/$(cd "$here/.." && pwd)/global/allow-list.conf)" \
      "Edit(/$(cd "$here/.." && pwd)/overlay/**)" "Edit(**/.git/config)" "Edit(**/.git/hooks/**)"; do
    [ "$(jq --arg r "$r" '[.permissions.deny[]? | select(. == $r)] | length' "$1")" -eq 1 ] || { echo "  missing: $r"; return 1; }
  done
}
if protect_ok "$s"; then ok "narrow tier: Edit denies protect the allow-list source, overlay, rendered files and .git config/hooks"; else ko "a protecting Edit deny is missing (narrow)"; fi

# 2. The admin floor installed under a throwaway root: check notes it, install widens.
root="$base/root-admin"; mkdir -p "$root"
TMPDIR="$base" HOME="$h" sh "$mgr" --root="$root" > "$base/mr.out" 2>&1
line=$(sed -n 's/^RUN     //p' "$base/mr.out")
stage=$(printf '%s' "$line" | sed -n 's/.*--apply="\([^"]*\)".*/\1/p')
sha=$(printf '%s' "$line" | sed -n 's/.*--sha256=\([0-9a-f]*\).*/\1/p')
TMPDIR="$base" sh "$mgr" --apply="$stage" --sha256="$sha" --root="$root" > /dev/null 2>&1; expect "admin floor applied under a throwaway root" 0 $?
HOME="$h" sh "$inst" --check --managed-root="$root" > "$base/c.out" 2>&1; expect "a narrow list under a complete admin floor is not drift" 0 $?
if grep -q '^NOTE .*settings.json: the narrow allow list is installed' "$base/c.out"; then ok "check says install would widen"; else ko "check did not note the widening"; fi
HOME="$h" sh "$inst" --managed-root="$root" > "$base/w.out" 2>&1; expect "install with the admin floor" 0 $?
if [ "$(allow_n "$s")" -eq $((n_narrow + n_wide_all)) ] && [ "$(mode_of "$s")" = acceptEdits ] \
   && ! grep -q '^RISK ' "$base/w.out"; then
  ok "Claude Code: wide tier, $((n_narrow + n_wide_all)) rules and acceptEdits, no RISK line"
else
  ko "Claude Code wide tier wrong: $(allow_n "$s") rules, mode $(mode_of "$s")"
fi
if [ "$(rules_n "$h/.codex/rules/workstation-allow-list.rules")" -eq $((n_narrow_cmd + n_wide_cmd)) ] \
   && [ "$(sandbox_of "$h/.codex/workstation.config.toml")" = workspace-write ] \
   && ! grep -q '"python3"' "$h/.codex/rules/workstation-allow-list.rules" \
   && [ "$(grep -c 'decision="forbidden")$' "$h/.codex/rules/workstation-allow-list.rules")" -eq "$n_wide_deny" ]; then
  ok "Codex: wide allow rules, $n_wide_deny escaping options forbidden, no test runner, workspace-write profile"
else
  ko "Codex wide tier wrong"
fi
if [ "$(jq '.toolsSettings.execute_bash.allowedCommands | length' "$k")" -eq "$n_narrow_cmd" ]; then
  ok "Kiro stays narrow: it carries no deny floor"
else
  ko "Kiro was widened without a floor"
fi
HOME="$h" sh "$inst" --check --managed-root="$root" > /dev/null 2>&1; expect "check clean on the wide tier" 0 $?
if protect_ok "$s"; then ok "wide tier keeps the protecting Edit denies"; else ko "a protecting Edit deny is missing (wide)"; fi
# The owner's wide tier (2026-10-05): the read/build routes, pinned add and commit, the repository's
# suites, and each escaping option denied as a prefix. Expected entries named here, not derived.
miss=0
for r in "Bash(git diff:*)" "Bash(git log:*)" "Bash(git show:*)" "Bash(git grep:*)" "Bash(git blame:*)" \
    "Bash(git ls-files:*)" "Bash(git branch:*)" "Bash(git fetch:*)" "Bash(git add --:*)" "Bash(git commit -m:*)"; do
  [ "$(jq --arg r "$r" '[.permissions.allow[]? | select(. == $r)] | length' "$s")" -eq 1 ] || { miss=1; echo "  allow missing: $r"; }
done
for r in "Bash(git diff --no-index:*)" "Bash(git diff --output:*)" "Bash(git log --output:*)" "Bash(git show --output:*)" \
    "Bash(git grep --no-index:*)" "Bash(git grep -O:*)" "Bash(git blame --contents:*)" "Bash(git ls-files --exclude-from:*)" \
    "Bash(git fetch --upload-pack:*)"; do
  [ "$(jq --arg r "$r" '[.permissions.deny[]? | select(. == $r)] | length' "$s")" -eq 1 ] || { miss=1; echo "  deny missing: $r"; }
done
if [ "$overlay_allow" != /dev/null ] && [ "$(jq '[.permissions.allow[]? | select(startswith("Bash(python3 -B global/") or startswith("Bash(sh global/"))] | length' "$s")" -lt 1 ]; then
  miss=1; echo "  no repository suite in the wide allow list"
fi
if [ "$miss" -eq 0 ]; then ok "wide tier: read/build routes, pinned add and commit, suites, escaping options denied"; else ko "wide tier entries wrong"; fi

# 3. The admin floor gone again: a wide list without the barrier is drift, and install narrows it.
HOME="$h" sh "$inst" --check --managed-root="$empty" > "$base/g.out" 2>&1; expect "wide list without the admin floor is drift" 1 $?
HOME="$h" sh "$inst" --managed-root="$empty" > /dev/null 2>&1
if [ "$(allow_n "$s")" -eq "$n_narrow" ] && [ "$(mode_of "$s")" = none ] \
   && [ "$(sandbox_of "$h/.codex/workstation.config.toml")" = read-only ]; then
  ok "install narrows again and removes the permission mode it set"
else
  ko "install did not narrow: $(allow_n "$s") rules, mode $(mode_of "$s")"
fi

# 4. Deny beats allow, by construction: no rendered allow rule is a word prefix of a floor rule, and
# no floor rule covers an allow rule (so a variant spelling of a floor family is never pre-authorised).
HOME="$h" sh "$inst" --managed-root="$root" > /dev/null 2>&1
jq -r '.permissions.allow[] | select(startswith("Bash(")) | sub("^Bash\\("; "") | sub(":\\*\\)$"; "")' "$s" > "$base/allow.words"
awk '$1 == "cmd" { $1 = ""; sub(/^ /, ""); print }' "$floor_src" "$overlay_floor" > "$base/floor.words"
if awk 'NR == FNR { f[++n] = $0; next }
        { for (i = 1; i <= n; i++) {
            a = $0 " "; b = f[i] " "
            if (index(b, a) == 1 || index(a, b) == 1) { print "overlap: " $0 " / " f[i]; bad = 1 } } }
        END { exit bad }' "$base/floor.words" "$base/allow.words"; then
  ok "no allow rule overlaps a floor family ($(wc -l < "$base/allow.words" | tr -d ' ') rules against $(wc -l < "$base/floor.words" | tr -d ' ') floor prefixes)"
else
  ko "an allow rule overlaps the floor"
fi
if [ "$(jq '[.permissions.deny[]? | select(startswith("Bash("))] | length' "$s")" -eq $(($(wc -l < "$base/floor.words" | tr -d ' ') + $(owned_deny "$s"))) ]; then
  ok "the deny floor is still merged beside the allow list"
else
  ko "the deny floor is missing beside the allow list"
fi

# 4b. Issue #83: the trunk-push forms the owner overlay denies, each with a Claude Code deny rule that
# matches it as a word prefix (the overlay is the default install's; skipped with --overlay=none).
if [ "$overlay_floor" != /dev/null ]; then
  missing=0
  for b in main master; do
    for form in "git push -u origin $b" "git push origin $b" "git push origin $b:$b" "git push origin HEAD:$b" \
                "git push --set-upstream origin $b" "git push -u origin HEAD:$b"; do
      n=$(jq --arg f "$form " '[.permissions.deny[] | select(startswith("Bash(")) | sub("^Bash\\("; "") | sub(":\\*\\)$"; "")
            | select(. as $p | $f | startswith($p + " "))] | length' "$s")
      [ "$n" -ge 1 ] || { missing=1; echo "  no deny rule for: $form"; }
    done
  done
  if [ "$missing" -eq 0 ]; then ok "every trunk-push form has a deny rule beside the allow list"; else ko "a trunk-push form has no deny rule"; fi
fi

# 5. Invalid or floor-overlapping entries stop the run before anything is written.
for bad in "wide cmd git push" "narrow cmd sudo -n" "narrow cmd git *" "loose cmd git status" "wide tool Edit" \
           "wide cmd python3" "wide cmd python3.12 -m pytest" "narrow cmd bash" "narrow cmd sh -c" "wide cmd env" \
           "wide cmd xargs" "wide cmd node" "wide cmd perl" "wide cmd ruby" "wide cmd zsh" "wide runner npm test" \
           "wide runner make test" "narrow cmd ./workstation status" "wide cmd /bin/sh" \
           "narrow cmd git diff" "narrow cmd git log --oneline" "narrow cmd git show" "narrow cmd git grep" \
           "narrow cmd git blame" "narrow cmd git ls-files" "narrow cmd git branch --list" "narrow cmd git fetch" \
           "wide cmd git add" "wide cmd git commit" "wide cmd git commit -F" "wide cmd git worktree add" \
           "wide cmd gh issue comment" "wide cmd gh pr comment" "wide cmd python3 -B global/x.py" \
           "wide runner python3 -c x.py" "wide runner python3 -m pytest" "wide runner python3 global/../x.py" \
           "wide runner sh /abs/x.sh" "narrow runner sh global/x.sh" "wide runner node x.js" \
           "wide runner python3 x.py y.py" "wide runner sh global/x.txt" \
           "wide runner node global/x.py" "wide runner perl global/x.sh" "wide runner env global/x.sh" \
           "wide cmd git -c" "wide cmd git -c core.pager=less" "wide cmd git -C" "wide cmd git --exec-path" \
           "narrow cmd gh -R"; do
  ov="$base/ov-$(printf '%s' "$bad" | tr -c '[:lower:]' '_')"; hb="$base/home-bad-$(printf '%s' "$bad" | tr -c '[:lower:]' '_')"
  mkdir -p "$ov" "$hb"
  printf '%s\n' "$bad" > "$ov/allow-list.conf"
  HOME="$hb" sh "$inst" --overlay="$ov" --managed-root="$root" > /dev/null 2> "$base/bad.err"
  code=$?
  if [ "$code" -eq 2 ] && [ -z "$(find "$hb" -type f -print)" ] && grep -q '^invalid allow-list entry' "$base/bad.err"; then
    ok "refused before writing anything: $bad"
  else
    ko "not refused cleanly (exit $code): $bad"
  fi
done

# 6. The owner's own rules and permission mode survive install and uninstall.
h="$base/home-own"; mkdir -p "$h/.claude"
printf '{ "permissions": { "allow": ["Bash(make lint:*)", "Bash(git status:*)"], "defaultMode": "plan" } }\n' > "$h/.claude/settings.json"
HOME="$h" sh "$inst" --managed-root="$root" > "$base/own.out" 2>&1; expect "install over the owner's own settings" 0 $?
s="$h/.claude/settings.json"
if [ "$(mode_of "$s")" = plan ] && grep -q "your own permissions.defaultMode (plan) is kept" "$base/own.out" \
   && [ "$(jq '[.permissions.allow[] | select(. == "Bash(git status:*)")] | length' "$s")" -eq 1 ]; then
  ok "the owner's permission mode is kept and an equal rule is not duplicated"
else
  ko "the owner's mode or rules were changed"
fi
HOME="$h" sh "$inst" --uninstall > /dev/null 2>&1; expect "uninstall" 0 $?
if [ "$(jq -c '.permissions.allow' "$s")" = '["Bash(make lint:*)","Bash(git status:*)"]' ] && [ "$(mode_of "$s")" = plan ] \
   && ! jq -e '.permissions.deny[]? | select(startswith("Edit("))' "$s" > /dev/null \
   && [ "$(jq -r 'keys | join(",")' "$s")" = permissions ]; then
  ok "uninstall keeps every rule and the mode the owner wrote, removes only ours"
else
  ko "uninstall removed the owner's content or left ours: $(jq -c . "$s")"
fi
if [ ! -e "$h/.codex/workstation.config.toml" ] && [ ! -e "$h/.codex/rules/workstation-allow-list.rules" ] \
   && [ ! -e "$h/.kiro/agents/workstation.json" ]; then
  ok "uninstall removes the Codex profile, the Codex allow rules and the Kiro agent"
else
  ko "uninstall left an allow-list file"
fi

# 7. A workstation profile file the owner wrote is refused, never overwritten.
h="$base/home-clash"; mkdir -p "$h/.codex"
printf 'sandbox_mode = "read-only"\n' > "$h/.codex/workstation.config.toml"
before=$(cksum < "$h/.codex/workstation.config.toml")
HOME="$h" sh "$inst" --managed-root="$root" > /dev/null 2>&1; expect "an unmanaged workstation profile is refused" 3 $?
if [ "$(cksum < "$h/.codex/workstation.config.toml")" = "$before" ]; then ok "the owner's profile file is untouched"; else ko "the owner's profile file was changed"; fi

# 8. Kiro patterns: anchored, an argument tail allowed, a chained or expanded command refused.
kpat="$base/home-narrow/.kiro/agents/workstation.json"
if python3 - "$kpat" <<'PY'
import json, re, sys
pats = [re.compile(p) for p in json.load(open(sys.argv[1]))["toolsSettings"]["execute_bash"]["allowedCommands"]]
def ok(c):
    return any(p.fullmatch(c) for p in pats)
good = ["git status", "git status --short", "gh pr view 12 --json body", "git rev-parse --show-toplevel"]
bad = ["git status; touch x", "git status && touch x", "git status | sh", "git status $(touch x)",
       "git status\ntouch x", "Xgit status", "git statusx", "git commit -m x", "xgit status"]
sys.exit(0 if all(ok(c) for c in good) and not any(ok(c) for c in bad) else 1)
PY
then ok "Kiro patterns admit the inner loop and refuse chaining, expansion and lookalikes"; else ko "a Kiro pattern is too broad or too narrow"; fi

# 9. Codex itself: deny beats allow across the two rendered rules files (credential-free).
cx=${CODEX:-$(command -v codex 2>/dev/null || true)}
h="$base/home-narrow"
if [ -n "$cx" ] && [ -x "$cx" ]; then
  mkdir -p "$base/cx"
  r1="$h/.codex/rules/workstation-allow-list.rules"; r2="$h/.codex/rules/workstation-deny-floor.rules"
  d=$(HOME="$base/cx" CODEX_HOME="$base/cx" "$cx" execpolicy check -r "$r1" -r "$r2" -- git status --short 2>/dev/null | jq -r .decision)
  if [ "$d" = allow ]; then ok "codex: git status is allowed"; else ko "codex: git status is $d"; fi
  bad=0
  while read -r words; do
    # shellcheck disable=SC2086
    d=$(HOME="$base/cx" CODEX_HOME="$base/cx" "$cx" execpolicy check -r "$r1" -r "$r2" -- $words x 2>/dev/null | jq -r .decision)
    [ "$d" = forbidden ] || { bad=1; echo "  not forbidden: $words ($d)"; }
  done < "$base/floor.words"
  if [ "$overlay_floor" != /dev/null ]; then
    for b in main master; do
      for form in "git push -u origin $b" "git push origin $b:$b" "git push -u origin HEAD:$b" "git push --set-upstream origin $b"; do
        # shellcheck disable=SC2086
        d=$(HOME="$base/cx" CODEX_HOME="$base/cx" "$cx" execpolicy check -r "$r1" -r "$r2" -- $form 2>/dev/null | jq -r .decision)
        [ "$d" = forbidden ] || { bad=1; echo "  trunk form not forbidden: $form ($d)"; }
      done
    done
  fi
  # The wide tier's escaping options are forbidden while their command is allowed.
  for pair in "allow:git commit -m msg" "allow:git add -- a" "allow:git diff HEAD" "forbidden:git diff --no-index a b" \
              "forbidden:git log --output x" "forbidden:git fetch --upload-pack x" "forbidden:git grep -O less x"; do
    want=${pair%%:*}; form=${pair#*:}
    # shellcheck disable=SC2086
    d=$(HOME="$base/cx" CODEX_HOME="$base/cx" "$cx" execpolicy check -r "$r1" -r "$r2" -- $form 2>/dev/null | jq -r .decision)
    [ "$d" = "$want" ] || { bad=1; echo "  $form: $d, expected $want"; }
  done
  # The allow rules load in every session, not only under --profile: the model-visible prompt lists them.
  mkdir -p "$base/cxw"
  if (cd "$base/cxw" && HOME="$h" CODEX_HOME="$h/.codex" "$cx" debug prompt-input hi 2>/dev/null) \
       | grep -qF '[\"gh\", \"pr\", \"view\"]'; then
    ok "codex: the allow rules are approved prefixes without --profile"
  else
    ko "codex: the allow rules are not listed without --profile"
  fi
  if [ "$bad" -eq 0 ]; then ok "codex: every floor prefix stays forbidden with the allow list loaded"; else ko "codex: a floor prefix is not forbidden"; fi
else
  echo "SKIP  codex not found; the execpolicy arm did not run"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
