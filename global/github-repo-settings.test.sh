#!/bin/sh
# Test global/github-repo-settings.sh against a stub gh on PATH: no network, no real repository.
#   github-repo-settings.test.sh <scratch directory>
set -u

base=${1:?usage: github-repo-settings.test.sh <scratch dir>}
mkdir -p "$base/bin"
tool="$(cd "$(dirname "$0")" && pwd)/github-repo-settings.sh"
pass=0
fail=0
ok() { pass=$((pass + 1)); echo "PASS  $1"; }
ko() { fail=$((fail + 1)); echo "FAIL  $1"; }
expect() { if [ "$3" -eq "$2" ]; then ok "$1"; else ko "$1 (expected $2, got $3)"; fi; }

# The stub: GET prints $STUB_REPO; a PATCH is logged and rewrites $STUB_REPO with its -F fields.
cat "$(dirname "$tool")/github-repo-settings.test.stub" > "$base/bin/gh"
chmod 755 "$base/bin/gh"
export STUB_REPO="$base/repo.json" STUB_LOG="$base/gh.log"
run() { PATH="$base/bin:$PATH" sh "$tool" "$@"; }

printf '%s\n' '{"allow_merge_commit":true,"allow_squash_merge":true,"allow_rebase_merge":true}' > "$STUB_REPO"
: > "$STUB_LOG"
run --check o/r > "$base/c1.out" 2>&1; expect "check flags a repository that allows squash" 1 $?
grep -q '^DIFF    o/r allow_squash_merge=true (standard: false)' "$base/c1.out" && ok "the difference names squash" || ko "the difference names squash"
if grep -q PATCH "$STUB_LOG"; then ko "check wrote nothing"; else ok "check wrote nothing"; fi

run --apply o/r > "$base/a.out" 2>&1; expect "apply then check exits 0" 0 $?
if grep -q -- '--method PATCH repos/o/r' "$STUB_LOG" && grep -q 'allow_squash_merge=false' "$STUB_LOG" \
   && grep -q 'allow_merge_commit=true' "$STUB_LOG"; then
  ok "apply sends one PATCH with squash off and merge commit on"
else
  ko "apply sends one PATCH with squash off and merge commit on"
fi
jq -e '.allow_squash_merge == false and .allow_merge_commit == true and .allow_rebase_merge == false' "$STUB_REPO" > /dev/null \
  && ok "the repository ends on the standard" || ko "the repository ends on the standard"

printf '%s\n' '{"name":"r"}' > "$STUB_REPO"
run --check o/r > "$base/c2.out" 2>&1; expect "unreadable settings (no admin rights) are not credited" 1 $?
grep -q 'allow_squash_merge=unknown' "$base/c2.out" && ok "an unreadable setting reads unknown" || ko "an unreadable setting reads unknown"

run --check 'o/r;x' > /dev/null 2>&1; expect "a malformed repository name is refused" 2 $?
run --merge o/r > /dev/null 2>&1; expect "an unknown mode is refused" 2 $?

echo "$pass passed, $fail failed"
[ "$fail" -eq 0 ]
