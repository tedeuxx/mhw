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
for f in bin/restart_guard.py bin/hitl.conf claude.json requirements.toml; do
  cp "$stage/$f" "$base/keep"
  printf '\n' >> "$stage/$f"
  sh "$inst" --apply="$stage" --sha256="$sha" --root="$r" > /dev/null 2>&1; expect "apply refuses a changed $f" 3 $?
  cp "$base/keep" "$stage/$f"
done
[ ! -e "$dropin" ] && [ ! -e "$req" ] && ok "a refused apply installs nothing" || ko "a refused apply installs nothing"

# 3. apply installs the admin documents and the scripts
sh "$inst" --apply="$stage" --sha256="$sha" --root="$r" > /dev/null 2>&1; expect "apply exits 0" 0 $?
if jq -e --arg b "$bin" '
    (.hooks | keys == ["PreToolUse", "SessionStart", "UserPromptSubmit"])
    and ([.hooks[][] .hooks[] .command | contains($b)] | all)
    and ([.hooks.PreToolUse[] | select(.matcher == "AskUserQuestion")] | length == 1)' "$dropin" >/dev/null 2>&1; then
  ok "the Claude Code drop-in registers the three layers from the admin bin"
else
  ko "the Claude Code drop-in registers the three layers from the admin bin"
fi
if head -n 1 "$req" | grep -q "managed-by: $NAME" && ! grep -qE '^[[:space:]]*(allow_managed_hooks_only|\[features\])' "$req" \
   && [ "$(grep -c '^\[\[hooks\.[A-Za-z]*\.hooks\]\]' "$req")" -eq 3 ]; then
  ok "the Codex requirements carry our marker, three hooks and no hooks-only lock"
else
  ko "the Codex requirements carry our marker, three hooks and no hooks-only lock"
fi
if python3 -c 'import tomllib' 2>/dev/null; then
  python3 -c 'import sys, tomllib; d = tomllib.load(open(sys.argv[1], "rb")); assert set(d["hooks"]) >= {"managed_dir", "PreToolUse", "SessionStart", "UserPromptSubmit"}' "$req"
  expect "the Codex requirements parse as TOML" 0 $?
fi
modes_ok=1
for f in hitl-escalation-guard.sh restart_guard.py clipboard_guard.py breaking_glass.py; do
  [ -x "$bin/$f" ] || modes_ok=0
done
for f in hitl.conf clipboard.conf; do
  [ -f "$bin/$f" ] && [ ! -x "$bin/$f" ] || modes_ok=0
done
[ "$modes_ok" = 1 ] && ok "scripts are executable, confs are not" || ko "scripts are executable, confs are not"
sh "$inst" --check --root="$r" > /dev/null 2>&1; expect "check after apply is clean" 0 $?
for f in "$req" "$bin/hitl.conf"; do
  sed 's/; version: [^;]*;/; version: 0.0.1;/' "$f" > "$f.t" && cat "$f.t" > "$f" && rm "$f.t"
done
if grep -q 'version: 0.0.1;' "$req"; then ok "the stamp was rewritten for the test"; else ko "the stamp was rewritten for the test"; fi
sh "$inst" --check --root="$r" > /dev/null 2>&1; expect "check ignores an earlier release's stamp" 0 $?
printf '\n' >> "$bin/hitl.conf"
sh "$inst" --check --root="$r" > /dev/null 2>&1; expect "check flags a drifted script or conf" 1 $?

# 4. the registered commands run from the admin bin (direct payloads: proves the commands, not routing)
h="$base/home"; mkdir -p "$h/project/.git"
start=$(jq -r '.hooks.SessionStart[0].hooks[0].command' "$dropin")
out=$(printf '%s' '{"hook_event_name":"SessionStart","source":"startup","session_id":"managed-test"}' \
  | (cd "$h/project" && HOME="$h" sh -c "$start"))
printf '%s' "$out" | grep -q 'baseline_created' && ok "the managed restart guard command runs" || ko "the managed restart guard command runs" "$out"
hitl=$(jq -r '.hooks.PreToolUse[] | select(.matcher == "AskUserQuestion") | .hooks[0].command' "$dropin")
out=$(printf '%s' '{"tool_name":"AskUserQuestion","cwd":"/","tool_input":{"questions":[{"question":"q","header":"Session type","options":[{"label":"Melhoria de harness"},{"label":"Bugfix"}]}]}}' \
  | HOME="$h" sh -c "$hitl")
[ -z "$out" ] && ok "the managed HITL guard passes the intake picker from /" || ko "the managed HITL guard passes the intake picker from /" "$out"

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
