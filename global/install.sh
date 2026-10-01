#!/bin/sh
# Render the global brief to each harness, install the HITL escalation guard, install the user-level
# deny floor, and install the clipboard guard (ADR-0010, ADR-0013, ADR-0016, ADR-0011).
#
#   install.sh                  install or update every managed target
#   install.sh --dry-run        print exactly what would be written or merged where; write nothing
#   install.sh --check          exit non-zero if any target is missing, drifted or unmanaged
#   install.sh --overlay=DIR    owner overlay directory (default: <repo>/overlay); --overlay=none for none
#
# Exit codes: 0 ok · 1 drift or missing (--check) · 2 usage, invalid floor entry or missing dependency ·
# 3 something UNMANAGED or unreadable is in the way. A file is managed when its marker line (below) is in
# its first five lines; an unmanaged file is never overwritten. ~/.claude/settings.json is never
# replaced: one hook entry and the deny floor's entries are merged into it with jq, every other key, hook
# and permission rule is kept (no existing deny entry is ever removed), and a backup is left beside it.
# On macOS the clipboard guard's LaunchAgent plist is WRITTEN, never loaded: launchctl is the owner's act.
# The clipboard term list is never written by this installer (only `clipboard_guard.py add-term` does).
set -eu

MARKER_ID="managed-by: personal-multi-harness-workstation-configuration"
HOOK_ID="personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(dirname "$script_dir")
src="$script_dir/AGENTS.md"
hook_src="$script_dir/hooks/hitl-escalation-guard.sh"
conf_src="$script_dir/hitl.conf"
floor_src="$script_dir/deny-floor.conf"
clip_src="$script_dir/clipboard/clipboard_guard.py"
clip_conf_src="$script_dir/clipboard.conf"
CLIP_LABEL="local.personal-multi-harness-workstation-configuration.clipboard-guard"

mode=install
overlay="$repo_root/overlay"
for arg in "$@"; do
  case $arg in
    --dry-run) mode=dry-run ;;
    --check) mode=check ;;
    --overlay=none) overlay= ;;
    --overlay=*) overlay=${arg#--overlay=} ;;
    -h|--help) sed -n '2,16p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

for f in "$src" "$hook_src" "$conf_src" "$floor_src" "$clip_src" "$clip_conf_src"; do
  [ -f "$f" ] || { echo "source not found: $f" >&2; exit 2; }
done
if [ -n "$overlay" ] && [ ! -d "$overlay" ]; then
  echo "overlay directory not found: $overlay" >&2
  exit 2
fi

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/personal-multi-harness-workstation-configuration"
hook_dest="$data_dir/hitl-escalation-guard.sh"
settings="$HOME/.claude/settings.json"
clip_dest="$data_dir/clipboard_guard.py"
clip_conf_dest="$data_dir/clipboard.conf"
clip_plist="$HOME/Library/LaunchAgents/$CLIP_LABEL.plist"
codex_rules="${CODEX_HOME:-$HOME/.codex}/rules/workstation-deny-floor.rules"

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

# The deny floor: generic entries, then the overlay's (ADR-0016). Every line is validated before
# anything is rendered, so an entry the parser would drop or mangle stops the run instead of silently
# leaving a hole. Outputs: one rendered Claude Code rule per line, and one Codex word list per line.
floor="$work/deny-floor.conf"
cat "$floor_src" > "$floor"
floor_from="global/deny-floor.conf"
if [ -n "$overlay" ] && [ -f "$overlay/deny-floor.conf" ]; then
  cat "$overlay/deny-floor.conf" >> "$floor"
  floor_from="global/deny-floor.conf + overlay"
fi
floor_claude="$work/floor.claude"
floor_codex="$work/floor.codex"
if ! awk -v claude="$floor_claude" -v codex="$floor_codex" '
    { sub(/\r$/, "") }
    /^[ \t]*(#|$)/ { next }
    {
      why = ""
      if ($1 != "cmd" && $1 != "file") why = "kind must be cmd or file"
      else if (NF < 2) why = "no words"
      else if ($1 == "file" && NF != 2) why = "a file entry takes one path"
      for (i = 2; i <= NF && why == ""; i++) {
        if ($i !~ /^[A-Za-z0-9._\/~=:@+*-]+$/) why = "word outside the allowed set"
        else if ($1 == "cmd" && $i ~ /\*/) why = "a cmd word may not hold *"
      }
      if (why != "") { printf "invalid deny-floor entry (%s): %s\n", why, $0 > "/dev/stderr"; err = 1; next }
      if ($1 == "cmd") {
        w = $2; for (i = 3; i <= NF; i++) w = w " " $i
        print "Bash(" w ":*)" > claude
        print w > codex
      } else {
        print "Read(" $2 ")" > claude
        print "Edit(" $2 ")" > claude
      }
      n++
    }
    END { if (err) exit 1; if (!n) { print "the deny floor has no entry" > "/dev/stderr"; exit 1 } }
  ' "$floor"; then
  exit 2
fi
: >> "$floor_codex"

# The clipboard guard's settings: generic defaults, then the overlay's (last value of a key wins).
clip_conf="$work/clipboard.conf"
cat "$clip_conf_src" > "$clip_conf"
if [ -n "$overlay" ] && [ -f "$overlay/clipboard.conf" ]; then cat "$overlay/clipboard.conf" >> "$clip_conf"; fi

xml_escape() { printf '%s' "$1" | sed -e 's/&/\&amp;/g' -e 's/</\&lt;/g' -e 's/>/\&gt;/g'; }

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
    codexrules)
      {
        printf '# %s; source: %s; version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$floor_from" "$version"
        printf '# The workstation deny floor (ADR-0016). A prefix rule matches the command words from the\n'
        printf '# program name on; another spelling, a wrapper or a script is not matched.\n'
        awk '{ printf "prefix_rule(pattern=["; for (i = 1; i <= NF; i++) printf "%s\"%s\"", (i > 1 ? ", " : ""), $i; print "], decision=\"forbidden\")" }' "$floor_codex"
      } > "$2"
      ;;
    clipscript)
      {
        sed -n 1p "$clip_src"
        printf '# %s; source: global/clipboard/clipboard_guard.py; version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$version"
        sed 1d "$clip_src"
      } > "$2"
      ;;
    clipconf)
      {
        printf '# %s; source: global/clipboard.conf + overlay; version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$version"
        cat "$clip_conf"
      } > "$2"
      ;;
    plist)
      # No log: launchd's stdout and stderr go to /dev/null, and the guard itself writes nothing.
      script_x=$(xml_escape "$clip_dest")
      conf_x=$(xml_escape "$clip_conf_dest")
      {
        printf '%s\n' '<?xml version="1.0" encoding="UTF-8"?>'
        printf '<!-- %s; source: global/install.sh (clipboard guard, ADR-0011); version: %s; do not edit, re-run the installer -->\n' \
          "$MARKER_ID" "$version"
        printf '%s\n' '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">' \
          '<plist version="1.0">' '<dict>' \
          '  <key>Label</key>' "  <string>$CLIP_LABEL</string>" \
          '  <key>ProgramArguments</key>' '  <array>' \
          '    <string>/usr/bin/python3</string>' '    <string>-I</string>' '    <string>-B</string>' \
          "    <string>$script_x</string>" '    <string>watch</string>' '    <string>--config</string>' \
          "    <string>$conf_x</string>" '  </array>' \
          '  <key>RunAtLoad</key>' '  <true/>' '  <key>KeepAlive</key>' '  <true/>' \
          '  <key>ThrottleInterval</key>' '  <integer>30</integer>' \
          '  <key>LimitLoadToSessionType</key>' '  <string>Aqua</string>' \
          '  <key>StandardOutPath</key>' '  <string>/dev/null</string>' \
          '  <key>StandardErrorPath</key>' '  <string>/dev/null</string>' \
          '</dict>' '</plist>'
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

# Merge one PreToolUse(AskUserQuestion) entry and the deny floor into the user's Claude Code settings.
# Idempotent: when exactly one hook entry of ours exists, it is the wanted one, and every floor rule is
# already in permissions.deny, nothing is written. Any other hook entry of ours (stale path, duplicate)
# is removed; a hook group is dropped only if it held ours and is now empty. The deny floor is a UNION:
# a missing floor rule is appended, every existing deny entry is kept in its place, none is removed.
merge_settings() {
  if ! command -v jq >/dev/null 2>&1; then
    echo "REFUSE  $settings: jq is required to merge the hook entry and the deny floor" >&2
    raise 2
    return 0
  fi

  want=$(jq -cn --arg cmd "\"$hook_dest\"" \
    '{matcher: "AskUserQuestion", hooks: [{type: "command", command: $cmd, timeout: 5}]}')
  deny=$(jq -cR -s 'split("\n") | map(select(length > 0))
                    | reduce .[] as $r ([]; if any(.[]; . == $r) then . else . + [$r] end)' "$floor_claude")

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
  if ! jq --indent 4 --arg id "$HOOK_ID" --argjson w "$want" --argjson f "$deny" '
      def ours: (.command? // "") | tostring | contains($id);
      if (.permissions != null and (.permissions | type) != "object")
         or (.permissions.deny? != null and (.permissions.deny | type) != "array")
      then error("permissions has an unexpected shape") else . end
      | if ([.hooks.PreToolUse[]?.hooks[]? | select(ours)] | length) == 1
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
        end
      | (.permissions.deny // []) as $d
      | if all($f[]; . as $r | any($d[]; . == $r)) then .
        else .permissions = ((.permissions // {}) | .deny = ($d + [$f[] | . as $r | select(any($d[]; . == $r) | not)]))
        end' "$current" > "$merged" 2>/dev/null; then
    echo "REFUSE  $settings: its hooks or permissions section has an unexpected shape; left untouched" >&2
    raise 3
    return 0
  fi

  missing=$(jq --argjson f "$deny" '(.permissions.deny // []) as $d | [$f[] | . as $r | select(any($d[]; . == $r) | not)] | length' "$current")
  jq -S . "$current" > "$work/before.json"
  jq -S . "$merged" > "$work/after.json"
  if [ -e "$settings" ] && cmp -s "$work/before.json" "$work/after.json"; then
    echo "OK      $settings (hook entry and all $(printf '%s' "$deny" | jq length) deny-floor rules present)"
    return 0
  fi

  case $mode in
    check)
      if [ -e "$settings" ]; then
        echo "DRIFT   $settings ($missing deny-floor rule(s) missing; or the hook entry is missing or stale)"
      else
        echo "MISSING $settings"
      fi
      raise 1
      ;;
    dry-run)
      echo "WOULD MERGE $settings: one PreToolUse(AskUserQuestion) entry and $missing deny-floor rule(s); every other key and rule is kept."
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
process codexrules "$codex_rules"
process clipscript "$clip_dest"
process clipconf "$clip_conf_dest"
if [ "$(uname -s)" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then
  # /usr/bin/python3 is a Command Line Tools shim: without them it opens an install prompt instead of
  # running, and a KeepAlive agent would raise that prompt again after every throttle interval.
  echo "REFUSE  $clip_plist: the Command Line Tools (which provide /usr/bin/python3) are not installed" >&2
  raise 2
elif [ "$(uname -s)" = Darwin ]; then
  process plist "$clip_plist"
  if [ "$mode" = install ]; then
    echo "NOTE    the clipboard guard is not loaded by this installer. To start it (or restart after an update):"
    echo "        launchctl bootstrap gui/\$(id -u) $clip_plist   then   launchctl kickstart -k gui/\$(id -u)/$CLIP_LABEL"
  fi
else
  echo "SKIP    clipboard watcher: macOS only; Linux and Windows are design notes in ADR-0011"
fi
merge_settings

exit "$status"
