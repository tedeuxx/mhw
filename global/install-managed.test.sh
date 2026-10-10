#!/bin/sh
# Test global/install-managed.sh under a throwaway --root (ADR-0025). Never touches a system path and
# never needs root: --root is the test-only prefix that also lifts the root check.
#   install-managed.test.sh <empty-or-new scratch directory>
set -u

base=${1:?usage: install-managed.test.sh <scratch dir>}
mkdir -p "$base"
inst="$(cd "$(dirname "$0")" && pwd)/install-managed.sh"
unset CODEX_HOME XDG_DATA_HOME
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "PASS  $1"; }
ko() { fail=$((fail + 1)); echo "FAIL  $1"; [ -n "${2:-}" ] && echo "      $2"; return 0; }
expect() { if [ "$3" -eq "$2" ]; then ok "$1"; else ko "$1 (expected $2, got $3)"; fi; }

r="$base/root"
mkdir -p "$r"
NAME=personal-multi-harness-workstation-configuration
if [ "$(uname -s)" = Darwin ]; then
  bin="$r/Library/Application Support/$NAME/bin"
  dropin="$r/Library/Application Support/ClaudeCode/managed-settings.d/50-$NAME.json"
else
  bin="$r/etc/$NAME/bin"
  dropin="$r/etc/claude-code/managed-settings.d/50-$NAME.json"
fi
req="$r/etc/codex/requirements.toml"
switches="$(dirname "$bin")/breaking-glass"
export TMPDIR="$base/tmp"
mkdir -p "$TMPDIR"

# 1. render: validated stage, ONE sudo line, nothing installed
sh "$inst" --root="$r" > "$base/render.out" 2>&1; expect "render exits 0" 0 $?
line=$(sed -n 's/^RUN     //p' "$base/render.out")
stage=$(printf '%s' "$line" | sed -n 's/.*--apply="\([^"]*\)".*/\1/p')
sha=$(printf '%s' "$line" | sed -n 's/.*--sha256=\([0-9a-f]*\).*/\1/p')
case $line in "sudo /bin/sh "*) ok "render prints a sudo line" ;; *) ko "render prints a sudo line" "$line" ;; esac
if [ -d "$stage" ] && [ ${#sha} -eq 64 ] && [ ! -e "$bin" ] && [ ! -e "$dropin" ] && [ ! -e "$req" ]; then
  ok "render stages and installs nothing"
else
  ko "render stages and installs nothing"
fi
sh "$inst" --check --root="$r" > /dev/null 2>&1; expect "check before apply reports missing" 1 $?

# 2. the hash binds every staged file: a wrong hash or a changed file installs nothing
sh "$inst" --apply="$stage" --sha256=0000 --root="$r" > /dev/null 2>&1; expect "apply refuses a wrong hash" 3 $?
for f in bin/clipboard_guard.py bin/clipboard.conf claude.json requirements.toml; do
  cp "$stage/$f" "$base/keep"
  printf '\n' >> "$stage/$f"
  sh "$inst" --apply="$stage" --sha256="$sha" --root="$r" > /dev/null 2>&1; expect "apply refuses a changed $f" 3 $?
  cp "$base/keep" "$stage/$f"
done
[ ! -e "$dropin" ] && [ ! -e "$req" ] && ok "a refused apply installs nothing" || ko "a refused apply installs nothing"

# 3. apply installs the admin documents and the scripts
sh "$inst" --apply="$stage" --sha256="$sha" --root="$r" > /dev/null 2>&1; expect "apply exits 0" 0 $?
if jq -e --arg b "$bin" '
    (.hooks | keys == ["UserPromptSubmit"])
    and ([.hooks[][] .hooks[] .command | contains($b)] | all)' "$dropin" >/dev/null 2>&1; then
  ok "the Claude Code drop-in registers the paste filter from the admin bin, and no other hook"
else
  ko "the Claude Code drop-in registers the paste filter from the admin bin, and no other hook"
fi
# Regression (Issue #60, ADR-0013 2026-10-05 amendment): the removed HITL picker guard stays removed
# from the admin layer: no AskUserQuestion entry, no PreToolUse event, no guard script or limits.
if ! jq -e '[.hooks.PreToolUse[]?] | length > 0' "$dropin" >/dev/null 2>&1 \
   && ! grep -qs -e AskUserQuestion -e hitl-escalation-guard "$dropin" "$req" \
   && [ ! -e "$bin/hitl-escalation-guard.sh" ] && [ ! -e "$bin/hitl.conf" ]; then
  ok "no HITL picker guard is registered or installed in the admin layer"
else
  ko "a HITL picker guard artefact is in the admin layer"
fi
if head -n 1 "$req" | grep -q "managed-by: $NAME" && ! grep -qE '^[[:space:]]*(allow_managed_hooks_only|\[features\])' "$req" \
   && [ "$(grep -c '^\[\[hooks\.[A-Za-z]*\.hooks\]\]' "$req")" -eq 1 ] && grep -q '^\[\[hooks\.UserPromptSubmit\.hooks\]\]' "$req"; then
  ok "the Codex requirements carry our marker, the paste filter hook only and no hooks-only lock"
else
  ko "the Codex requirements carry our marker, the paste filter hook only and no hooks-only lock"
fi
if python3 -c 'import tomllib' 2>/dev/null; then
  python3 -c 'import sys, tomllib; d = tomllib.load(open(sys.argv[1], "rb")); assert set(d["hooks"]) == {"managed_dir", "UserPromptSubmit"}' "$req"
  expect "the Codex requirements parse as TOML" 0 $?
fi
# 3b. the deny floor in the admin layer (ADR-0016, 2026-10-05 amendment): the same rules install.sh
# renders at user level, global entries plus the repository overlay's.
here="$(cd "$(dirname "$0")" && pwd)"
ofloor="$here/../overlay/deny-floor.conf"; [ -f "$ofloor" ] || ofloor=/dev/null
want_rules=$(awk '$1 == "cmd" || $1 == "glob" { n++ } $1 == "file" { n += 2 } END { print n }' "$here/deny-floor.conf" "$ofloor")
want_cmds=$(awk '$1 == "cmd" { n++ } END { print n }' "$here/deny-floor.conf" "$ofloor")
if jq -e --argjson n "$want_rules" '(.permissions | keys == ["deny"]) and (.permissions.deny | length == $n)
    and (.permissions.deny | index("Bash(sudo:*)") != null)
    and (.permissions.deny | index("Bash(gh workflow run:*)") != null)
    and (.permissions.deny | index("Read(~/.ssh/id_*)") != null)' "$dropin" >/dev/null 2>&1; then
  ok "the Claude Code drop-in carries every deny-floor rule ($want_rules) in permissions.deny"
else
  ko "the Claude Code drop-in carries every deny-floor rule ($want_rules) in permissions.deny" \
    "got $(jq '.permissions.deny | length' "$dropin" 2>/dev/null)"
fi
if [ "$ofloor" = /dev/null ] || jq -e '.permissions.deny | index("Bash(git push origin main:*)") != null' "$dropin" >/dev/null 2>&1; then
  ok "the overlay's floor entries reach the admin drop-in"
else
  ko "the overlay's floor entries reach the admin drop-in"
fi
# The 2026-10-10 classes (ADR-0035) reach the admin drop-in; the glob is Claude Code only, so it reaches
# the drop-in and never the Codex requirements.
if jq -e '.permissions.deny as $d | ["Bash(terraform plan:*)", "Bash(terraform -chdir=*)", "Bash(git commit --no-verify:*)",
      "Bash(aws ssm get-parameter --with-decryption:*)", "Bash(aws sso login:*)", "Read(**/.env)", "Edit(**/credentials*)"]
      | all(. as $r | $d | index($r) != null)' "$dropin" >/dev/null 2>&1 \
   && grep -qF '{ pattern = [{ token = "terraform" }, { token = "plan" }], decision = "forbidden"' "$req" \
   && ! grep -q -e '-chdir' -e 'token = "[^"]*\*' "$req"; then
  ok "the 2026-10-10 floor classes reach the admin drop-in, and the glob stays out of the Codex requirements"
else
  ko "the 2026-10-10 floor classes reach the admin drop-in, and the glob stays out of the Codex requirements"
fi
# The installer's own validate() program, run under a python that has tomllib (3.11+). The installer
# runs it under /usr/bin/python3, which on macOS is 3.9 and skips the TOML half, so a count mismatch
# between the two admin documents passed there and broke the render on Ubuntu (PR #118, round 1).
# The program is read from install-managed.sh itself, so this tests the source, not a copy of it.
if python3 -c 'import tomllib' 2>/dev/null; then
  vs="$base/validate-stage"; mkdir -p "$vs"
  cp "$dropin" "$vs/claude.json"; cp "$req" "$vs/requirements.toml"
  awk '/^validate\(\) \{/ { inf = 1; next }
       inf && /-c .$/ { body = 1; next }
       body && /^assert .*. "\$1" "\$NAME"/ { sub(/. "\$1" "\$NAME".*$/, ""); print; exit }
       body { print }' "$here/install-managed.sh" > "$base/validate.py"
  if grep -q "import tomllib" "$base/validate.py" && grep -q "^assert len(rules) == " "$base/validate.py" && python3 -I -B "$base/validate.py" "$vs" "$NAME"; then
    ok "the installer's validate() accepts the rendered admin documents under python $(python3 -c 'import sys; print(sys.version.split()[0])')"
  else
    ko "the installer's validate() refuses the rendered admin documents under a tomllib python"
  fi
else
  echo "SKIP  no python3 with tomllib on PATH: validate()'s TOML half was not exercised here"
fi
nrules=$(grep -c '^  { pattern = \[.*\], decision = "forbidden", justification = ' "$req")
if [ "$nrules" -eq "$want_cmds" ] && grep -q '^\[rules\]$' "$req" \
   && grep -qF '{ pattern = [{ token = "git" }, { token = "push" }, { token = "--force" }], decision = "forbidden"' "$req" \
   && ! grep -q 'decision = "allow"' "$req"; then
  ok "the Codex requirements carry one forbidden prefix rule per cmd entry ($want_cmds)"
else
  ko "the Codex requirements carry one forbidden prefix rule per cmd entry ($want_cmds)" "got $nrules"
fi
if command -v codex >/dev/null 2>&1; then
  # Credential-free: the same token lists, written as a user .rules file, through Codex's own evaluator.
  # This proves the lists, not that Codex loads them from the admin path (that needs root).
  sed -n 's/^  { pattern = \[\(.*\)\], decision = "forbidden".*/\1/p' "$req" \
    | sed -e 's/{ token = \("[^"]*"\) }/\1/g' -e 's/^/prefix_rule(pattern=[/' -e 's/$/], decision="forbidden")/' > "$base/admin.rules"
  d1=$(codex execpolicy check --rules "$base/admin.rules" gh workflow run deploy | jq -r '.decision // "none"')
  d2=$(codex execpolicy check --rules "$base/admin.rules" git push --force origin x | jq -r '.decision // "none"')
  d3=$(codex execpolicy check --rules "$base/admin.rules" git push origin feature/x | jq -r '.decision // "none"')
  if [ "$d1" = forbidden ] && [ "$d2" = forbidden ] && [ "$d3" = none ]; then
    ok "codex execpolicy: the admin token lists forbid workflow run and force-push, and leave a branch push alone"
  else
    ko "codex execpolicy on the admin token lists" "workflow=$d1 force=$d2 branch=$d3"
  fi
else
  echo "SKIP  codex not on PATH: the admin token lists were not evaluated by Codex here"
fi

modes_ok=1
[ -x "$bin/clipboard_guard.py" ] || modes_ok=0
[ -f "$bin/clipboard.conf" ] && [ ! -x "$bin/clipboard.conf" ] || modes_ok=0
[ "$modes_ok" = 1 ] && ok "the script is executable, the conf is not" || ko "the script is executable, the conf is not"
sh "$inst" --check --root="$r" > "$base/check-clean.out" 2>&1; expect "check after apply is clean" 0 $?
# The provenance stamp (Issue #66, ADR-0029): every installed admin file carries the source's stamp,
# the one --check prints on its SOURCE line, and that names this checkout's HEAD.
src_stamp=$(sed -n 's/^SOURCE  //p' "$base/check-clean.out")
head_sha=$(git -C "$here/.." rev-parse --verify HEAD 2>/dev/null || echo unknown)
case $src_stamp in
  "release: "*"; commit: $head_sha" | "release: "*"; commit: $head_sha-dirty") ok "the source stamp names HEAD" ;;
  *) ko "the source stamp names HEAD" "'$src_stamp' vs $head_sha" ;;
esac
unstamped=""
for f in "$dropin" "$req" "$bin/clipboard_guard.py" "$bin/clipboard.conf"; do
  got=$(grep -m 1 -F "managed-by: $NAME" "$f" | sed -n 's/.*; \(release: [^;"]*; commit: [^;"]*\);.*/\1/p')
  [ -n "$src_stamp" ] && [ "$got" = "$src_stamp" ] || unstamped="$unstamped $f"
done
if [ -z "$unstamped" ]; then ok "every installed admin file carries the source's stamp"; else ko "every installed admin file carries the source's stamp" "missing in:$unstamped"; fi
if [ "$(grep -c '^OK .*(release: ' "$base/check-clean.out")" -eq 4 ]; then ok "check reports each admin file's stamp"; else ko "check reports each admin file's stamp"; fi
other=0123456789abcdef0123456789abcdef01234567
for f in "$req" "$dropin"; do
  sed "s/; commit: [^;\"]*;/; commit: $other;/" "$f" > "$f.t" && cat "$f.t" > "$f" && rm "$f.t"
done
sh "$inst" --check --root="$r" > "$base/check-stamp.out" 2>&1; expect "check flags a stamp other than the source's" 1 $?
if [ "$(grep -c "^STAMP .*commit: $other" "$base/check-stamp.out")" -eq 2 ] && ! grep -q '^DRIFT' "$base/check-stamp.out"; then
  ok "both restamped admin documents are named STAMP, not DRIFT"
else
  ko "both restamped admin documents are named STAMP, not DRIFT" "$(cat "$base/check-stamp.out")"
fi
sh "$inst" --apply="$stage" --sha256="$sha" --root="$r" > /dev/null 2>&1
sh "$inst" --check --root="$r" > /dev/null 2>&1; expect "apply restores the source's stamp" 0 $?
printf '\n' >> "$bin/clipboard.conf"
sh "$inst" --check --root="$r" > /dev/null 2>&1; expect "check flags a drifted script or conf" 1 $?
cp "$dropin" "$base/dropin.keep"
jq '.permissions.deny |= map(select(. != "Bash(sudo:*)"))' "$base/dropin.keep" > "$dropin"
sh "$inst" --check --root="$r" > "$base/check-floor.out" 2>&1; expect "check flags a deny-floor rule removed from the admin drop-in" 1 $?
if grep -q '^DRIFT .*managed-settings.d' "$base/check-floor.out"; then ok "the drift names the drop-in"; else ko "the drift names the drop-in"; fi
cp "$base/dropin.keep" "$dropin"

# 4. the registered commands run from the admin bin (direct payloads: proves the commands, not routing)
h="$base/home"; mkdir -p "$h/project/.git"
if ! grep -qs -e restart_guard -e breaking_glass "$dropin" "$req" && [ ! -e "$bin/restart_guard.py" ] \
   && [ ! -e "$bin/breaking_glass.py" ] && [ ! -e "$switches" ]; then
  ok "no restart guard and no breaking-glass switch is installed (ADR-0028)"
else
  ko "no restart guard and no breaking-glass switch is installed (ADR-0028)"
fi
paste=$(jq -r '.hooks.UserPromptSubmit[0].hooks[0].command' "$dropin")
out=$(printf '%s' '{"hook_event_name":"UserPromptSubmit","prompt":"a clean prompt"}' | HOME="$h" sh -c "$paste")
[ -z "$out" ] && ok "the managed paste filter passes a clean prompt" || ko "the managed paste filter passes a clean prompt" "$out"

# 4b. what an earlier release installed for the restart guard and the switches (ADR-0028) and for the
# HITL picker guard (ADR-0013, 2026-10-05): --check reports it, the next --apply deletes it, and only it. Start from a clean install, so the leftovers
# are the only thing --check can report.
sh "$inst" --apply="$stage" --sha256="$sha" --root="$r" > /dev/null 2>&1
sh "$inst" --check --root="$r" > /dev/null 2>&1; expect "check is clean before the leftovers are planted" 0 $?
for f in restart_guard.py breaking_glass.py hitl-escalation-guard.sh hitl.conf; do printf '# old\n' > "$bin/$f"; done
mkdir -p "$switches"
printf '{}' > "$switches/paste-filter.json"
sh "$inst" --check --root="$r" > "$base/check-legacy.out" 2>&1; expect "check flags the removed guard's leftovers" 1 $?
if [ "$(grep -c '^STALE' "$base/check-legacy.out")" -eq 5 ] && grep -q '^STALE .*hitl-escalation-guard.sh' "$base/check-legacy.out" \
   && grep -q '^STALE .*hitl.conf' "$base/check-legacy.out"; then ok "check names each leftover"; else ko "check names each leftover" "$(cat "$base/check-legacy.out")"; fi
sh "$inst" --apply="$stage" --sha256="$sha" --root="$r" > /dev/null 2>&1; expect "apply over an earlier release exits 0" 0 $?
if [ ! -e "$bin/restart_guard.py" ] && [ ! -e "$bin/breaking_glass.py" ] && [ ! -e "$switches" ] \
   && [ ! -e "$bin/hitl-escalation-guard.sh" ] && [ ! -e "$bin/hitl.conf" ] \
   && [ -x "$bin/clipboard_guard.py" ] && [ -f "$dropin" ]; then
  ok "apply deletes the restart guard, the switches and the picker guard, keeps the current layers"
else
  ko "apply deletes the restart guard, the switches and the picker guard, keeps the current layers"
fi
sh "$inst" --check --root="$r" > /dev/null 2>&1; expect "check is clean after the cleanup" 0 $?
for f in restart_guard.py breaking_glass.py hitl-escalation-guard.sh hitl.conf; do printf '# old\n' > "$bin/$f"; done
mkdir -p "$switches"; printf '{}' > "$switches/hitl-guard.json"

# 5. a foreign requirements.toml is never overwritten or removed
r2="$base/root2"; mkdir -p "$r2/etc/codex"
printf '%s\n' '# owned by someone else' > "$r2/etc/codex/requirements.toml"
sh "$inst" --root="$r2" > /dev/null 2>&1; expect "render refuses beside a foreign Codex requirements file" 3 $?
sh "$inst" --apply="$stage" --sha256="$sha" --root="$r2" > /dev/null 2>&1; expect "apply refuses beside a foreign Codex requirements file" 3 $?
sh "$inst" --remove --root="$r2" > /dev/null 2>&1
grep -q 'someone else' "$r2/etc/codex/requirements.toml" && ok "remove keeps a foreign Codex requirements file" || ko "remove keeps a foreign Codex requirements file"

# 6. remove takes away exactly what apply installed
sh "$inst" --remove --root="$r" > /dev/null 2>&1; expect "remove exits 0" 0 $?
[ ! -e "$dropin" ] && [ ! -e "$req" ] && [ ! -e "$bin" ] && ok "remove leaves no admin-layer file of ours" || ko "remove leaves no admin-layer file of ours"
if [ "$(id -u)" != 0 ]; then
  # A wrong hash: even a broken root check then stops at the hash (3), never at a system path.
  sh "$inst" --apply="$stage" --sha256=0000 > /dev/null 2>&1; expect "apply without --root refuses a non-root run" 2 $?
fi

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
