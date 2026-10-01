#!/bin/sh
# Test global/install.sh against throwaway HOME directories (never the real one).
#   install.test.sh <empty-or-new base directory for the fake HOMEs>
set -u

base=${1:?usage: install.test.sh <base dir>}
inst="$(cd "$(dirname "$0")" && pwd)/install.sh"
unset CODEX_HOME
pass=0
fail=0

ok() { pass=$((pass + 1)); echo "PASS  $1"; }
ko() { fail=$((fail + 1)); echo "FAIL  $1"; }
expect() { # $1 description, $2 expected exit, $3 actual exit
  if [ "$2" -eq "$3" ]; then ok "$1 (exit $3)"; else ko "$1 (expected $2, got $3)"; fi
}

targets() { echo "$1/.claude/CLAUDE.md $1/.codex/AGENTS.md $1/.kiro/steering/workstation-global-brief.md"; }
fingerprint() { for f in $(targets "$1"); do cksum "$f" 2>/dev/null || echo "absent $f"; done; }

# 1. dry-run writes nothing
h="$base/home-dry"; mkdir -p "$h"
HOME="$h" sh "$inst" --dry-run > "$base/dry.out"; expect "dry-run exits 0" 0 $?
n=$(find "$h" -type f | wc -l | tr -d ' ')
if [ "$n" -eq 0 ]; then ok "dry-run wrote no file"; else ko "dry-run wrote $n file(s)"; fi
if grep -q '^WOULD WRITE' "$base/dry.out"; then ok "dry-run prints targets"; else ko "dry-run printed no target"; fi

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

# 5. refuse an unmanaged file
h="$base/home-unmanaged"; mkdir -p "$h/.claude"
echo "my own hand-written brief" > "$h/.claude/CLAUDE.md"
mine=$(cksum < "$h/.claude/CLAUDE.md")
HOME="$h" sh "$inst"; expect "install refuses unmanaged" 3 $?
if [ "$(cksum < "$h/.claude/CLAUDE.md")" = "$mine" ]; then ok "unmanaged file untouched"; else ko "unmanaged file was modified"; fi
HOME="$h" sh "$inst" --check; expect "check flags unmanaged" 3 $?

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
