#!/bin/sh
# Check or apply the workstation's GitHub repository merge standard (global/github-repo-settings.json):
# a real merge commit only; squash and rebase merges off (owner, 2026-10-05: "nao podemos trabalhar com
# squash"). ADR-0016, 2026-10-05 amendment.
#
#   github-repo-settings.sh --check OWNER/REPO   read-only; exit 0 when every setting matches
#   github-repo-settings.sh --apply OWNER/REPO   the owner's act: one PATCH of the repository, then a check
#
# Exit codes: 0 ok · 1 a setting differs or cannot be read (a token without admin rights reads none of
# them) · 2 usage or missing dependency. Needs gh (authenticated) and jq.
set -eu

script_dir=$(cd "$(dirname "$0")" && pwd)
std="$script_dir/github-repo-settings.json"
mode=${1:-}
repo=${2:-}
case $mode in --check|--apply) ;; *) echo "usage: $0 --check|--apply OWNER/REPO" >&2; exit 2 ;; esac
printf '%s' "$repo" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' || { echo "usage: OWNER/REPO, got '$repo'" >&2; exit 2; }
command -v gh >/dev/null 2>&1 || { echo "REFUSE  gh is required" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "REFUSE  jq is required" >&2; exit 2; }

check() {
  current=$(gh api "repos/$repo") || { echo "UNREADABLE repos/$repo"; return 1; }
  rc=0
  for key in $(jq -r '.settings | keys[]' "$std"); do
    want=$(jq -r --arg k "$key" '.settings[$k]' "$std")
    have=$(printf '%s' "$current" | jq -r --arg k "$key" 'if has($k) then .[$k] | tostring else "unknown" end')
    if [ "$have" = "$want" ]; then echo "OK      $repo $key=$have"
    else echo "DIFF    $repo $key=$have (standard: $want)"; rc=1; fi
  done
  return "$rc"
}

if [ "$mode" = --apply ]; then
  set --
  for key in $(jq -r '.settings | keys[]' "$std"); do
    set -- "$@" -F "$key=$(jq -r --arg k "$key" '.settings[$k]' "$std")"
  done
  gh api --method PATCH "repos/$repo" "$@" > /dev/null || { echo "REFUSE  the PATCH of repos/$repo failed (admin rights needed)" >&2; exit 1; }
  echo "APPLIED $repo"
fi
check
