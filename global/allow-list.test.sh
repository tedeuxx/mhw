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
n_narrow=$(awk '$1 == "narrow" { n++ } END { print n + 0 }' "$conf")
n_wide_cmd=$(awk '$1 == "wide" && $2 == "cmd" { n++ } END { print n + 0 }' "$conf")
n_wide_all=$(awk '$1 == "wide" { n++ } END { print n + 0 }' "$conf")
n_narrow_cmd=$(awk '$1 == "narrow" && $2 == "cmd" { n++ } END { print n + 0 }' "$conf")
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
if ! jq -e '.permissions.allow[] | select(test("^Bash\\((git add|git commit|npm test):"))' "$s" > /dev/null; then
  ok "no wide rule (git add, git commit, npm test) is rendered without the admin floor"
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
   && ! grep -q '"npm", "test"' "$h/.codex/rules/workstation-allow-list.rules"; then
  ok "Codex: wide allow rules without test runners, workspace-write profile"
else
  ko "Codex wide tier wrong"
fi
if [ "$(jq '.toolsSettings.execute_bash.allowedCommands | length' "$k")" -eq "$n_narrow_cmd" ]; then
  ok "Kiro stays narrow: it carries no deny floor"
else
  ko "Kiro was widened without a floor"
fi
HOME="$h" sh "$inst" --check --managed-root="$root" > /dev/null 2>&1; expect "check clean on the wide tier" 0 $?

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
if [ "$(jq '[.permissions.deny[]? | select(startswith("Bash("))] | length' "$s")" -eq "$(wc -l < "$base/floor.words" | tr -d ' ')" ]; then
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
for bad in "wide cmd git push" "narrow cmd sudo -n" "narrow cmd git *" "loose cmd git status" "wide tool Edit"; do
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
good = ["git status", "git status --short", "gh pr view 12 --json body", "./workstation status --verbose"]
bad = ["git status; touch x", "git status && touch x", "git status | sh", "git status $(touch x)",
       "git status\ntouch x", "Xgit status", "a/workstation status", "git statusx", "git commit -m x"]
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
  if [ "$bad" -eq 0 ]; then ok "codex: every floor prefix stays forbidden with the allow list loaded"; else ko "codex: a floor prefix is not forbidden"; fi
else
  echo "SKIP  codex not found; the execpolicy arm did not run"
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
