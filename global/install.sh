#!/bin/sh
# Render the global brief to each harness, install the HITL escalation guard, install the user-level
# deny floor, and install the paste filter at the harness-CLI prompt (ADR-0010, ADR-0013, ADR-0016,
# ADR-0011), and the stale-session restart guard (ADR-0022).
#
#   install.sh                  install or update every managed target
#   install.sh --dry-run        print exactly what would be written or merged where; write nothing
#   install.sh --check          exit non-zero if any target is missing, drifted or unmanaged
#   install.sh --overlay=DIR    owner overlay directory (default: <repo>/overlay); --overlay=none for none
#   install.sh --hooks=managed  the hooks run from the admin layer (install-managed.sh, ADR-0025): remove
#                               this project's hook entries from the user settings and its Codex
#                               hooks.json instead of writing them (default --hooks=user)
#
# Exit codes: 0 ok · 1 drift or missing (--check) · 2 usage, invalid floor entry or missing dependency ·
# 3 something UNMANAGED or unreadable is in the way. A file is managed when its marker line (below) is in
# its first five lines; an unmanaged file is never overwritten. ~/.claude/settings.json is never
# replaced: one hook entry and the deny floor's entries are merged into it with jq, every other key, hook
# and permission rule is kept (no existing deny entry is ever removed), and a backup is left beside it.
# The paste filter is a UserPromptSubmit hook: one entry merged into ~/.claude/settings.json and a
# managed ${CODEX_HOME:-~/.codex}/hooks.json. Codex runs it only after the owner trusts it in /hooks.
# The always-on clipboard watcher is WITHDRAWN (ADR-0011): no LaunchAgent is written any more, and a
# managed plist left by an earlier version is removed on install. launchctl is never run: the installer
# prints the bootout command for the owner. The term list is never written by this installer (only
# `clipboard_guard.py add-term` does).
# The paste wrapper (ADR-0011, automatic cleaning at the paste boundary) is installed beside the core with
# a managed shell snippet defining claude, codex and kiro-cli functions that run the CLIs through it. The
# installer never sources that snippet and never edits a shell rc: activating it is the owner's act.
set -eu

MARKER_ID="managed-by: personal-multi-harness-workstation-configuration"
HOOK_ID="personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"
PASTE_ID="personal-multi-harness-workstation-configuration/clipboard_guard.py"
RESTART_ID="personal-multi-harness-workstation-configuration/restart_guard.py"

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(dirname "$script_dir")
src="$script_dir/AGENTS.md"
hook_src="$script_dir/hooks/hitl-escalation-guard.sh"
restart_src="$script_dir/hooks/restart_guard.py"
glass_src="$script_dir/hooks/breaking_glass.py"
glasscmd_src="$script_dir/commands/breaking-glass.md"
conf_src="$script_dir/hitl.conf"
floor_src="$script_dir/deny-floor.conf"
clip_src="$script_dir/clipboard/clipboard_guard.py"
wrap_src="$script_dir/clipboard/paste_wrapper.py"
clip_conf_src="$script_dir/clipboard.conf"
CLIP_LABEL="local.personal-multi-harness-workstation-configuration.clipboard-guard"

mode=install
hooks_mode=user
overlay="$repo_root/overlay"
for arg in "$@"; do
  case $arg in
    --dry-run) mode=dry-run ;;
    --check) mode=check ;;
    --hooks=user) hooks_mode=user ;;
    --hooks=managed) hooks_mode=managed ;;
    --overlay=none) overlay= ;;
    --overlay=*) overlay=${arg#--overlay=} ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

for f in "$src" "$hook_src" "$restart_src" "$glass_src" "$glasscmd_src" "$conf_src" "$floor_src" "$clip_src" "$clip_conf_src" "$wrap_src"; do
  [ -f "$f" ] || { echo "source not found: $f" >&2; exit 2; }
done
if [ -n "$overlay" ] && [ ! -d "$overlay" ]; then
  echo "overlay directory not found: $overlay" >&2
  exit 2
fi

# Structured profiles must be compiled and current before any target is written (ADR-0018).
# Hand-authored overlays and --overlay=none retain the previous installation path.
if [ -n "$overlay" ] && [ -f "$overlay/profile.json" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "profile overlay requires Python 3.9+; no target was written" >&2
    exit 2
  fi
  (cd "$overlay" && python3 -B "$script_dir/profile/profile.py" check --source profile.json --output .)
fi

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/personal-multi-harness-workstation-configuration"
hook_dest="$data_dir/hitl-escalation-guard.sh"
restart_dest="$data_dir/restart_guard.py"
glass_dest="$data_dir/breaking_glass.py"
settings="$HOME/.claude/settings.json"
clip_dest="$data_dir/clipboard_guard.py"
clip_conf_dest="$data_dir/clipboard.conf"
wrap_dest="$data_dir/paste_wrapper.py"
snippet_dest="$data_dir/paste-filter.sh"
clip_plist="$HOME/Library/LaunchAgents/$CLIP_LABEL.plist"
codex_rules="${CODEX_HOME:-$HOME/.codex}/rules/workstation-deny-floor.rules"
codex_hooks="${CODEX_HOME:-$HOME/.codex}/hooks.json"

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

# The paste filter's hook command (ADR-0011): the installed core, on the stock python3, isolated (-I)
# and writing no bytecode (-B). Paths go inside double quotes, so a path holding a character that is
# special there, or in JSON, is refused rather than mis-quoted.
paste_ok=1
case "$clip_dest$clip_conf_dest$wrap_dest" in *[\"\\\$\`]*) paste_ok=0 ;; esac
paste_cmd() {
  printf '/usr/bin/python3 -I -B "%s" prompt-hook --harness %s --config "%s"' "$clip_dest" "$1" "$clip_conf_dest"
}
if [ "$paste_ok" = 0 ]; then
  echo "REFUSE  paste filter: the data directory path holds a quote, backslash, dollar sign or backtick" >&2
elif [ ! -e /usr/bin/python3 ]; then
  paste_ok=0
  echo "REFUSE  paste filter: /usr/bin/python3 not found; the hook is not registered" >&2
elif [ "$(uname -s)" = Darwin ] && ! xcode-select -p >/dev/null 2>&1; then
  # /usr/bin/python3 is a Command Line Tools shim: without them it opens an install prompt instead of
  # running, which would be an OS dialog on every prompt submission.
  paste_ok=0
  echo "REFUSE  paste filter: the Command Line Tools (which provide /usr/bin/python3) are not installed" >&2
fi

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
    glassscript)
      {
        sed -n 1p "$glass_src"
        printf '# %s; source: global/hooks/breaking_glass.py; version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$version"
        sed 1d "$glass_src"
      } > "$2"
      ;;
    glasscommand)
      # /breaking-glass (ADR-0024) for every workspace: it calls the installed module, not a checkout.
      sed -e "s|@MARKER@|$MARKER_ID|" -e "s|@GLASS@|$glass_dest|g" "$glasscmd_src" > "$2"
      ;;
    restartscript)
      restart_output=$2
      {
        sed -n 1p "$restart_src"
        printf '# %s; source: global/hooks/restart_guard.py; do not edit, re-run the installer\n' "$MARKER_ID"
        sed 1d "$restart_src"
      } > "$restart_output"
      ;;
    clipconf)
      {
        printf '# %s; source: global/clipboard.conf + overlay; version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$version"
        cat "$clip_conf"
      } > "$2"
      ;;
    wrapscript)
      {
        sed -n 1p "$wrap_src"
        printf '# %s; source: global/clipboard/paste_wrapper.py; version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$version"
        sed 1d "$wrap_src"
      } > "$2"
      ;;
    snippet)
      # Shell functions for zsh and bash. Sourcing this file is the owner's act; nothing here runs it.
      {
        printf '# %s; source: global/install.sh (paste wrapper, ADR-0011); version: %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$version"
        printf '# The paste filter at the harness-CLI paste boundary (ADR-0011). To activate it, add this line to\n'
        printf '# your ~/.zshrc or ~/.bashrc yourself (the installer never edits a shell rc):\n'
        printf '#   . "%s"\n' "$snippet_dest"
        printf '# Then claude, codex and kiro-cli run through the wrapper, which cleans bracketed pastes before the\n'
        printf '# CLI sees them. "command claude" (or codex, kiro-cli) runs a CLI without it.\n'
        for cli in claude codex kiro-cli; do
          printf '%s() { /usr/bin/python3 -I -B "%s" run --config "%s" -- %s "$@"; }\n' \
            "$cli" "$wrap_dest" "$clip_conf_dest" "$cli"
        done
      } > "$2"
      ;;
    codexhooks)
      # The marker sits in the file's "description" (documented as metadata that does not change which
      # hooks run). No version in it: Codex records trust against the hook's hash, so a file that changed
      # on every release could ask the owner to re-trust it each time (whether description is part of
      # that hash is NOT measured).
      {
        printf '{\n  "description": "%s; source: global/install.sh (paste filter, ADR-0011); do not edit, re-run the installer",\n' "$MARKER_ID"
        printf '  "hooks": {\n    "UserPromptSubmit": [\n      {\n        "hooks": [\n'
        printf '          {"type": "command", "command": "%s", "timeout": 30}\n' "$(paste_cmd codex | sed 's/"/\\"/g')"
        printf '        ]\n      }\n    ],\n'
        printf '    "SessionStart": [{"hooks": [{"type": "command", "command": "%s", "timeout": 10}]}],\n' \
          "$(printf '/usr/bin/python3 -I -B "%s" --harness codex' "$restart_dest" | sed 's/"/\\"/g')"
        printf '    "PreToolUse": [{"hooks": [{"type": "command", "command": "%s", "timeout": 10}]}]\n  }\n}\n' \
          "$(printf '/usr/bin/python3 -I -B "%s" --harness codex' "$restart_dest" | sed 's/"/\\"/g')"
      } > "$2"
      ;;
  esac
}

retire() { # $1 a managed file this mode no longer wants, $2 what it is
  if [ -f "$1" ] && is_managed "$1"; then
    case $mode in
      check) echo "STALE   $1: $2; install removes it"; raise 1 ;;
      dry-run) echo "WOULD REMOVE $1 ($2)" ;;
      install) rm -f "$1"; echo "REMOVED $1 ($2)" ;;
    esac
  elif [ -e "$1" ] || [ -L "$1" ]; then
    echo "NOTE    $1 exists and is NOT managed by this project; left alone"
  fi
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

# Merge one PreToolUse(AskUserQuestion) entry, one UserPromptSubmit entry (the paste filter, ADR-0011)
# and the deny floor into the user's Claude Code settings. When the paste filter cannot run here
# (paste_ok=0), its entry is removed instead of written.
# Idempotent, per event: when exactly one hook entry of ours exists, it is the wanted one, and every floor rule is
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
  if [ "$paste_ok" = 1 ]; then
    want_paste=$(jq -cn --arg cmd "$(paste_cmd claude)" '{hooks: [{type: "command", command: $cmd, timeout: 30}]}')
    want_restart=$(jq -cn --arg cmd "/usr/bin/python3 -I -B \"$restart_dest\" --harness claude-code" \
      '{hooks: [{type: "command", command: $cmd, timeout: 10}]}')
  else
    want_paste=null
    want_restart=null
  fi
  if [ "$hooks_mode" = managed ]; then
    # ADR-0025: the admin layer registers the hooks; a user-level copy would run them twice.
    want=null
    want_paste=null
    want_restart=null
  fi
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
  if ! jq --indent 4 --arg id "$HOOK_ID" --arg pid "$PASTE_ID" --argjson w "$want" --argjson p "$want_paste" \
      --arg rid "$RESTART_ID" --argjson r "$want_restart" \
      --argjson f "$deny" '
      # One hook entry of ours per event: keep it when it is exactly the wanted one; otherwise drop every
      # entry of ours (and a group left empty by that) and append the wanted one, unless it is null.
      def place($ev; $id; $want):
        def ours: (.command? // "") | tostring | contains($id);
        ([.hooks[$ev][]?.hooks[]? | select(ours)] | length) as $n
        | if ($want != null and $n == 1 and ([.hooks[$ev][]? | select(. == $want)] | length) == 1)
             or ($want == null and $n == 0)
          then .
          else
            .hooks = (.hooks // {})
            | .hooks[$ev] = (
                [ (.hooks[$ev] // [])[]
                  | if any(.hooks[]?; ours)
                    then (.hooks |= map(select(ours | not))) | select(.hooks | length > 0)
                    else . end ]
                + (if $want == null then [] else [$want] end))
          end;
      if (.permissions != null and (.permissions | type) != "object")
         or (.permissions.deny? != null and (.permissions.deny | type) != "array")
      then error("permissions has an unexpected shape") else . end
      | place("PreToolUse"; $id; $w)
      | place("UserPromptSubmit"; $pid; $p)
      | place("SessionStart"; $rid; $r)
      | place("PreToolUse"; $rid; $r)
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
    echo "OK      $settings (hook entries and all $(printf '%s' "$deny" | jq length) deny-floor rules present)"
    return 0
  fi

  case $mode in
    check)
      if [ -e "$settings" ]; then
        echo "DRIFT   $settings ($missing deny-floor rule(s) missing; or a hook entry is missing or stale)"
      else
        echo "MISSING $settings"
      fi
      raise 1
      ;;
    dry-run)
      echo "WOULD MERGE $settings: the PreToolUse(AskUserQuestion) and UserPromptSubmit (paste filter) entries and $missing deny-floor rule(s); every other key and rule is kept."
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
process glassscript "$glass_dest"
process glasscommand "$HOME/.claude/commands/breaking-glass.md"
process conf "$data_dir/hitl.conf"
process codexrules "$codex_rules"
process clipscript "$clip_dest"
process clipconf "$clip_conf_dest"
if [ "$paste_ok" = 1 ]; then
  process restartscript "$restart_dest"
  if [ "$hooks_mode" = user ]; then
    process codexhooks "$codex_hooks"
  else
    retire "$codex_hooks" "the user-level Codex hooks, now registered in the admin layer (ADR-0025)"
  fi
  process wrapscript "$wrap_dest"
  process snippet "$snippet_dest"
  if [ "$mode" = install ]; then
    echo "NOTE    automatic paste cleaning starts only once you add this line to your shell rc yourself:"
    echo "        . \"$snippet_dest\""
  fi
else
  raise 2
  echo "SKIP    $codex_hooks: the paste filter cannot run here (see the REFUSE line above)"
  echo "SKIP    $wrap_dest and $snippet_dest: the paste wrapper cannot run here either"
fi

# The always-on clipboard watcher is withdrawn (ADR-0011, owner correction on Issue #5). A LaunchAgent
# plist this project wrote earlier is removed; launchctl is the owner's act, so its unload is printed.
if [ -e "$clip_plist" ] || [ -L "$clip_plist" ]; then
  if [ -f "$clip_plist" ] && is_managed "$clip_plist"; then
    case $mode in
      check)
        echo "STALE   $clip_plist: the withdrawn clipboard watcher's LaunchAgent; install removes it"
        raise 1
        ;;
      dry-run)
        echo "WOULD REMOVE $clip_plist (the withdrawn clipboard watcher's LaunchAgent)"
        ;;
      install)
        rm -f "$clip_plist"
        echo "REMOVED $clip_plist (the withdrawn clipboard watcher's LaunchAgent, ADR-0011)"
        echo "NOTE    if the watcher is still loaded, unload it yourself (this installer never runs launchctl):"
        echo "        launchctl bootout gui/\$(id -u)/$CLIP_LABEL"
        ;;
    esac
  else
    echo "NOTE    $clip_plist exists and is NOT managed by this project; left alone"
  fi
fi
merge_settings

if [ "$mode" = install ]; then
  echo "RESTART REQUIRED: open fresh Claude Code and Codex sessions before further work; Codex hook trust remains an owner action in /hooks."
fi

exit "$status"
