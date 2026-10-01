#!/bin/sh
# Render global/AGENTS.md into each harness's user-level brief (ADR-0010).
#
#   install.sh             install or update every managed target
#   install.sh --dry-run   print exactly what would be written where; write nothing
#   install.sh --check     exit non-zero if any target is missing, drifted or unmanaged
#
# Exit codes: 0 ok · 1 drift or missing (--check) · 2 usage · 3 an UNMANAGED file is in the way.
# A file is managed when its marker line (below) is in its first five lines. An unmanaged file is
# never overwritten.
set -eu

MARKER_ID="managed-by: personal-multi-harness-workstation-configuration"

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(dirname "$script_dir")
src="$script_dir/AGENTS.md"

mode=install
for arg in "$@"; do
  case $arg in
    --dry-run) mode=dry-run ;;
    --check) mode=check ;;
    -h|--help) sed -n '2,10p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

[ -f "$src" ] || { echo "source not found: $src" >&2; exit 2; }

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

version=$(sed -n 's/^current_version[[:space:]]*=[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' "$repo_root/.bumpversion.toml")
[ -n "$version" ] || { echo "cannot read current_version from .bumpversion.toml" >&2; exit 2; }
sha=$(sha256_of "$src")

status=0
raise() { [ "$1" -gt "$status" ] && status=$1; return 0; }

render() {
  # $1 = kind (plain|kiro), $2 = output file
  {
    if [ "$1" = kiro ]; then
      printf '%s\n' '---' 'inclusion: always' '---'
    fi
    printf '<!-- %s; source: global/AGENTS.md; version: %s; sha256: %s; do not edit, re-run the installer -->\n\n' \
      "$MARKER_ID" "$version" "$sha"
    cat "$src"
  } > "$2"
}

is_managed() { head -n 5 "$1" | grep -qF "$MARKER_ID"; }

process() {
  kind=$1
  dest=$2
  tmp=$(mktemp)
  render "$kind" "$tmp"

  if [ -e "$dest" ] && ! is_managed "$dest"; then
    echo "REFUSE  $dest: exists and is NOT managed by this project; move it aside or merge it by hand" >&2
    rm -f "$tmp"
    raise 3
    return 0
  fi

  if [ -e "$dest" ] && cmp -s "$tmp" "$dest"; then
    echo "OK      $dest"
    rm -f "$tmp"
    return 0
  fi

  case $mode in
    check)
      if [ -e "$dest" ]; then echo "DRIFT   $dest"; else echo "MISSING $dest"; fi
      raise 1
      ;;
    dry-run)
      echo "WOULD WRITE $dest ($(wc -c < "$tmp" | tr -d ' ') bytes):"
      echo "----- begin $dest"
      cat "$tmp"
      echo "----- end $dest"
      ;;
    install)
      mkdir -p "$(dirname "$dest")"
      cp "$tmp" "$dest.new.$$"
      mv "$dest.new.$$" "$dest"
      echo "WROTE   $dest"
      ;;
  esac
  rm -f "$tmp"
}

process plain "$HOME/.claude/CLAUDE.md"
process plain "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
process kiro "$HOME/.kiro/steering/workstation-global-brief.md"

exit "$status"
