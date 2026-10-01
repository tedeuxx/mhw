#!/bin/sh
# Render the global brief to each harness and install the HITL escalation guard (ADR-0010, ADR-0013).
#
#   install.sh                  install or update every managed target
#   install.sh --dry-run        print exactly what would be written or merged where; write nothing
#   install.sh --check          exit non-zero if any target is missing, drifted or unmanaged
#   install.sh --overlay=DIR    owner overlay directory (default: <repo>/overlay); --overlay=none for none
#
# Exit codes: 0 ok · 1 drift or missing (--check) · 2 usage or missing dependency · 3 something
# UNMANAGED or unreadable is in the way. A file is managed when its marker line (below) is in its first
# five lines; an unmanaged file is never overwritten. ~/.claude/settings.json is never replaced: one hook
# entry is merged into it with jq, every other key and hook is kept, and a backup is left beside it.
set -eu

MARKER_ID="managed-by: personal-multi-harness-workstation-configuration"
HOOK_ID="personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(dirname "$script_dir")
src="$script_dir/AGENTS.md"
hook_src="$script_dir/hooks/hitl-escalation-guard.sh"
conf_src="$script_dir/hitl.conf"

mode=install
overlay="$repo_root/overlay"
for arg in "$@"; do
  case $arg in
    --dry-run) mode=dry-run ;;
    --check) mode=check ;;
    --overlay=none) overlay= ;;
    --overlay=*) overlay=${arg#--overlay=} ;;
    -h|--help) sed -n '2,13p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

for f in "$src" "$hook_src" "$conf_src"; do
  [ -f "$f" ] || { echo "source not found: $f" >&2; exit 2; }
done
if [ -n "$overlay" ] && [ ! -d "$overlay" ]; then
  echo "overlay directory not found: $overlay" >&2
  exit 2
fi

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/personal-multi-harness-workstation-configuration"
hook_dest="$data_dir/hitl-escalation-guard.sh"
settings="$HOME/.claude/settings.json"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d ' ' -f 1
  else
    shasum -a 256 "$1" | cut -d ' ' -f 1
  fi
}

version=$(sed -n 's/^current_version[[:space:]]*=[[:space:]]*"\([0-9][0-9.]*\)".*/\1/p' "$repo_root/.bumpversion.toml")
[ -n "$version" ] || { echo "cannot read current_version from .bumpversion.toml" >&2; exit 2; }

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The brief: the generic source, then the overlay's fragment when there is one.
brief="$work/brief.md"
cat "$src" > "$brief"
if [ -n "$overlay" ] && [ -f "$overlay/AGENTS.md" ]; then cat "$overlay/AGENTS.md" >> "$brief"; fi
brief_sha=$(sha256_of "$brief")
brief_from="global/AGENTS.md"
[ -n "$overlay" ] && [ -f "$overlay/AGENTS.md" ] && brief_from="global/AGENTS.md + overlay"

# The guard's limits: generic defaults, then the overlay's values (last value of a key wins).
conf="$work/hitl.conf"
cat "$conf_src" > "$conf"
if [ -n "$overlay" ] && [ -f "$overlay/hitl.conf" ]; then cat "$overlay/hitl.conf" >> "$conf"; fi

status=0
raise() { [ "$1" -gt "$status" ] && status=$1; return 0; }

render() {
  # $1 = kind (plain|kiro|hook|conf), $2 = output file
  case $1 in
    plain|kiro)
      {
        [ "$1" = kiro ] && printf '%s\n' '---' 'inclusion: always' '---'
        printf '<!-- %s; source: %s; version: %s; sha256: %s; do not edit, re-run the installer -->\n\n' \
          "$MARKER_ID" "$brief_from" "$version" "$brief_sha"
        cat "$brief"
      } > "$2"
      ;;
    hook)
      {
        sed -n 1p "$hook_src"
        printf '# %s; source: global/hooks/hitl-escalation-guard.sh; version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$version"
        sed 1d "$hook_src"
      } > "$2"
      ;;
    conf)
      {
        printf '# %s; source: global/hitl.conf + overlay; version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$version"
        cat "$conf"
      } > "$2"
      ;;
  esac
}

is_managed() { head -n 5 "$1" | grep -qF "$MARKER_ID"; }

process() {
  kind=$1
  dest=$2
  tmp="$work/render"
  render "$kind" "$tmp"

  if [ -e "$dest" ] && ! is_managed "$dest"; then
    echo "REFUSE  $dest: exists and is NOT managed by this project; move it aside or merge it by hand" >&2
    raise 3
    return 0
  fi

  if [ -e "$dest" ] && cmp -s "$tmp" "$dest" && { [ "$kind" != hook ] || [ -x "$dest" ]; }; then
    echo "OK      $dest"
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
      [ "$kind" = hook ] && chmod 755 "$dest.new.$$"
      mv "$dest.new.$$" "$dest"
      echo "WROTE   $dest"
      ;;
  esac
}

# Merge one PreToolUse(AskUserQuestion) entry into the user's Claude Code settings. Idempotent: when
# exactly one entry of ours exists and it is the wanted one, nothing is written. Any other entry of
# ours (stale path, duplicate) is removed; a hook group is dropped only if it held ours and is now empty.
merge_settings() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "REFUSE  $settings: jq is required to merge the hook entry" >&2
    raise 2
    return 0
  fi

  want=$(jq -cn --arg cmd "\"$hook_dest\"" \
    '{matcher: "AskUserQuestion", hooks: [{type: "command", command: $cmd, timeout: 5}]}')

  current="$work/settings.current.json"
  if [ -e "$settings" ]; then
    if ! jq -e 'type == "object"' "$settings" >/dev/null 2>&1; then
      echo "REFUSE  $settings: not a readable JSON object; left untouched" >&2
      raise 3
      return 0
    fi
    cat "$settings" > "$current"
  else
    echo '{}' > "$current"
  fi

  merged="$work/settings.merged.json"
  if ! jq --indent 4 --arg id "$HOOK_ID" --argjson w "$want" '
      def ours: (.command? // "") | tostring | contains($id);
      if ([.hooks.PreToolUse[]?.hooks[]? | select(ours)] | length) == 1
         and ([.hooks.PreToolUse[]? | select(. == $w)] | length) == 1
      then .
      else
        .hooks = (.hooks // {})
        | .hooks.PreToolUse = (
            [ (.hooks.PreToolUse // [])[]
              | if any(.hooks[]?; ours)
                then (.hooks |= map(select(ours | not))) | select(.hooks | length > 0)
                else . end ]
            + [$w])
      end' "$current" > "$merged" 2>/dev/null; then
    echo "REFUSE  $settings: its hooks section has an unexpected shape; left untouched" >&2
    raise 3
    return 0
  fi

  jq -S . "$current" > "$work/before.json"
  jq -S . "$merged" > "$work/after.json"
  if [ -e "$settings" ] && cmp -s "$work/before.json" "$work/after.json"; then
    echo "OK      $settings (hook entry present)"
    return 0
  fi

  case $mode in
    check)
      if [ -e "$settings" ]; then echo "DRIFT   $settings (hook entry missing or stale)"; else echo "MISSING $settings"; fi
      raise 1
      ;;
    dry-run)
      echo "WOULD MERGE $settings: one PreToolUse(AskUserQuestion) entry; every other key is kept."
      if [ -e "$settings" ] && ! cmp -s "$settings" "$merged"; then
        echo "  note: the file is re-serialized by jq (4-space indent), so whitespace and escaping may change;"
        echo "  the semantic diff below (keys sorted) is the whole content change."
      fi
      echo "----- semantic diff of $settings"
      diff -u "$work/before.json" "$work/after.json" | sed '1,2d' || true
      echo "----- end"
      ;;
    install)
      mkdir -p "$(dirname "$settings")"
      tmp="$settings.new.$$"
      if [ -e "$settings" ]; then
        cp -p "$settings" "$settings.pmhwc-backup"
        cp -p "$settings" "$tmp"
      fi
      cat "$merged" > "$tmp"
      mv "$tmp" "$settings"
      if [ -e "$settings.pmhwc-backup" ]; then
        echo "MERGED  $settings (previous version kept as $settings.pmhwc-backup)"
      else
        echo "MERGED  $settings"
      fi
      ;;
  esac
}

process plain "$HOME/.claude/CLAUDE.md"
process plain "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
process kiro "$HOME/.kiro/steering/workstation-global-brief.md"
process hook "$hook_dest"
process conf "$data_dir/hitl.conf"
merge_settings

exit "$status"
