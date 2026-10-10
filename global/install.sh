#!/bin/sh
# Render the global brief to each harness, install the user-level deny floor, and install the paste
# filter at the harness-CLI prompt (ADR-0010, ADR-0016, ADR-0011), and render the inner-loop allow
# list (allow-list.conf; ADR-0031: wide only while the admin deny floor is complete), and set each harness's
# session-start default model and effort from overlay/model-defaults.json (ADR-0007, ADR-0035;
# global/models/model_defaults.py). The stale-session restart guard
# (ADR-0022) and the /breaking-glass switches (ADR-0024) were removed (ADR-0028), and so was the HITL
# picker guard (ADR-0013, 2026-10-05 amendment, Issue #60): a run of this installer deletes what an
# earlier version wrote for them, and --check reports it as STALE.
#
#   install.sh                  install or update every managed target
#   install.sh --dry-run        print exactly what would be written or merged where; write nothing
#   install.sh --uninstall      remove every file this script placed (only files carrying its marker) and
#                               its hook entries, deny-floor rules and stamp key from ~/.claude/settings.json
#   install.sh --check          exit non-zero if any target is missing, drifted, unmanaged, or carries a
#                               provenance stamp (release and commit) other than the source's; each
#                               line names the stamp the installed file carries (Issue #66, ADR-0029)
#   install.sh --overlay=DIR    owner overlay directory (default: <repo>/overlay); --overlay=none for none.
#                               WORKSTATION_OVERLAY=DIR|none in the environment sets the same default
#                               (./mhw passes it that way); an --overlay argument wins over it
#   install.sh --hooks=managed  the hooks run from the admin layer (install-managed.sh, ADR-0025): remove
#                               this project's hook entries from the user settings and its Codex
#                               hooks.json instead of writing them (default --hooks=user)
#   --managed-root=DIR          read the admin layer under DIR instead of / (tests only); this script
#                               never writes the admin layer, it only reports which layer carries the
#                               deny floor (FLOOR lines; install-managed.sh installs the admin copy)
#   --shell-rc=FILE             opt-in (Issue #58): append the one line that activates the paste wrapper
#                               to FILE (an absolute path, e.g. your ~/.zshrc), printing it; idempotent.
#                               Without it the line is only printed. --check reports FILE; --dry-run writes nothing
#   --method                    opt-in (Issue #61): render the working method (method/) too. Off by default
#                               until the plugin cutover (#63, #64); once rendered, later runs keep it
#                               current and --uninstall removes it (global/method/method_render.py)
#
# Exit codes: 0 ok · 1 drift, stamp or missing (--check) · 2 usage, invalid floor entry or missing dependency ·
# 3 something UNMANAGED or unreadable is in the way. A file is managed when its marker line (below) is in
# its first five lines; an unmanaged file is never overwritten. ~/.claude/settings.json is never
# replaced: the paste filter's hook entry and the deny floor's entries are merged into it with jq, every
# other key, hook and permission rule is kept (no existing deny entry is ever removed), and a backup is
# left beside it.
# The paste filter is a UserPromptSubmit hook: one entry merged into ~/.claude/settings.json and a
# managed ${CODEX_HOME:-~/.codex}/hooks.json. Codex runs it only after the owner trusts it in /hooks.
# The always-on clipboard watcher is WITHDRAWN (ADR-0011): no LaunchAgent is written any more, and a
# managed plist left by an earlier version is removed on install. launchctl is never run: the installer
# prints the bootout command for the owner. The term list is never written by this installer (only
# `clipboard_guard.py add-term` does).
# The paste wrapper (ADR-0011, automatic cleaning at the paste boundary) is installed beside the core with
# a managed shell snippet defining claude, codex and kiro-cli functions that run the CLIs through it. The
# installer never sources that snippet. It edits a shell rc only when the owner names one with
# --shell-rc=FILE (opt-in, Issue #58): one guarded line is appended, printed, and never duplicated.
# The wrapper exports a session marker; the prompt hook stays as the safety net and blocks only where
# the marker is absent (sessions not opened through the wrapper; ADR-0011, 2026-10-05 amendment).
set -eu

MARKER_ID="managed-by: personal-multi-harness-workstation-configuration"
PASTE_ID="personal-multi-harness-workstation-configuration/clipboard_guard.py"
# The top-level key that carries the provenance stamp in a JSON file with no comment syntax (Issue #66).
STAMP_KEY="personal-multi-harness-workstation-configuration"
# The deny-floor rules THIS installer appended to ~/.claude/settings.json (absent before it merged them),
# so uninstall removes those and keeps a rule the owner wrote himself, even one equal to a floor rule.
OWN_KEY="personal-multi-harness-workstation-configuration-owned-deny"
# Removed hooks (ADR-0028; ADR-0013 2026-10-05): kept only so an entry an earlier version merged is
# found and deleted.
RESTART_ID="personal-multi-harness-workstation-configuration/restart_guard.py"
HOOK_ID="personal-multi-harness-workstation-configuration/hitl-escalation-guard.sh"

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(dirname "$script_dir")
src="$script_dir/AGENTS.md"
floor_src="$script_dir/deny-floor.conf"
clip_src="$script_dir/clipboard/clipboard_guard.py"
wrap_src="$script_dir/clipboard/paste_wrapper.py"
clip_conf_src="$script_dir/clipboard.conf"
CLIP_LABEL="local.personal-multi-harness-workstation-configuration.clipboard-guard"

mode=install
hooks_mode=user
method_optin=
overlay="$repo_root/overlay"
if [ "${WORKSTATION_OVERLAY+set}" = set ]; then
  case $WORKSTATION_OVERLAY in none) overlay= ;; *) overlay=$WORKSTATION_OVERLAY ;; esac
fi
managed_root=
shell_rc=
for arg in "$@"; do
  case $arg in
    --managed-root=*) managed_root=${arg#--managed-root=} ;;
    --dry-run) mode=dry-run ;;
    --check) mode=check ;;
    --uninstall) mode=uninstall ;;
    --hooks=user) hooks_mode=user ;;
    --hooks=managed) hooks_mode=managed ;;
    --method) method_optin=--opt-in ;;
    --overlay=none) overlay= ;;
    --overlay=*) overlay=${arg#--overlay=} ;;
    --shell-rc=?*) shell_rc=${arg#--shell-rc=} ;;
    -h|--help) sed -n '2,35p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

case $shell_rc in
  ''|/*) ;;
  *) echo "--shell-rc needs an absolute path, got: $shell_rc" >&2; exit 2 ;;
esac

for f in "$src" "$floor_src" "$clip_src" "$clip_conf_src" "$wrap_src"; do
  [ -f "$f" ] || { echo "source not found: $f" >&2; exit 2; }
done
if [ -n "$overlay" ] && [ ! -d "$overlay" ]; then
  echo "overlay directory not found: $overlay" >&2
  exit 2
fi

# Structured profiles must be compiled and current before any target is written (ADR-0018).
# Hand-authored overlays and --overlay=none retain the previous installation path.
if [ "$mode" != uninstall ] && [ -n "$overlay" ] && [ -f "$overlay/profile.json" ]; then
  if ! command -v python3 >/dev/null 2>&1; then
    echo "profile overlay requires Python 3.9+; no target was written" >&2
    exit 2
  fi
  (cd "$overlay" && python3 -B "$script_dir/profile/profile.py" check --source profile.json --output .)
fi

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/personal-multi-harness-workstation-configuration"
hook_dest="$data_dir/hitl-escalation-guard.sh"   # removed (ADR-0013, 2026-10-05); retired below
hook_conf_dest="$data_dir/hitl.conf"             # removed (ADR-0013, 2026-10-05); retired below
restart_dest="$data_dir/restart_guard.py"        # removed (ADR-0028); retired below
glass_dest="$data_dir/breaking_glass.py"         # removed (ADR-0028); retired below
glasscmd_dest="$HOME/.claude/commands/breaking-glass.md"   # removed (ADR-0028); retired below
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

# The provenance stamp (Issue #66, PRD 9a): every file this script renders names the commit and the
# release it came from, in its own format's comment or a documented key. The rule:
#   release: vX.Y.Z                       HEAD is exactly that numeric SemVer tag and nothing tracked is modified
#   release: unreleased, after vX.Y.Z     any other commit (rc/next, a branch, between releases): the nearest tag
#   release: unreleased, no tag reachable a checkout without tags (a shallow CI clone)
#   commit:  the full HEAD SHA, with "-dirty" appended when a tracked file differs from HEAD
# Outside a git checkout (a GitHub source archive, which is what an npm install downloads; Issue #68,
# ADR-0034) the same fields come from .workstation-archive, which git archive filled in; otherwise
# both fields say unknown and name the .bumpversion.toml version instead.
# Only a strictly numeric tag is a release (ADR-0002), and only such a string ever enters a stamp.
tag_glob='v[0-9]*.[0-9]*.[0-9]*'
numeric_tag() { printf '%s\n' "$1" | grep -Eqx 'v[0-9]+\.[0-9]+\.[0-9]+'; }
# The checkout must be this repository itself: an npm package installed under some other git work tree
# (a home directory kept in git, say) must not borrow that tree's HEAD (Issue #68).
if git -C "$repo_root" rev-parse --is-inside-work-tree >/dev/null 2>&1 \
   && [ "$(git -C "$repo_root" rev-parse --show-toplevel 2>/dev/null)" = "$(cd "$repo_root" && pwd -P)" ] \
   && commit=$(git -C "$repo_root" rev-parse --verify HEAD 2>/dev/null); then
  dirty=
  [ -n "$(git -C "$repo_root" status --porcelain --untracked-files=no 2>/dev/null)" ] && dirty=-dirty
  if [ -z "$dirty" ] && exact=$(git -C "$repo_root" describe --tags --exact-match --match "$tag_glob" HEAD 2>/dev/null) \
     && numeric_tag "$exact"; then
    release=$exact
  elif near=$(git -C "$repo_root" describe --tags --abbrev=0 --match "$tag_glob" HEAD 2>/dev/null) \
     && numeric_tag "$near"; then
    release="unreleased, after $near"
  else
    release="unreleased, no tag reachable"
  fi
  commit="$commit$dirty"
  stamp="release: $release; commit: $commit"
elif archive_commit=$(sed -n 's/^commit: \([0-9a-f]\{40\}\)$/\1/p' "$repo_root/.workstation-archive" 2>/dev/null | head -n 1) \
   && [ -n "$archive_commit" ] \
   && archive_describe=$(sed -n 's/^describe: //p' "$repo_root/.workstation-archive" | head -n 1) \
   && if numeric_tag "$archive_describe"; then release=$archive_describe
      elif printf '%s\n' "$archive_describe" | grep -Eqx 'v[0-9]+\.[0-9]+\.[0-9]+-[0-9]+-g[0-9a-f]+'; then
        release="unreleased, after $(printf '%s\n' "$archive_describe" | sed -E 's/-[0-9]+-g[0-9a-f]+$//')"
      elif [ -z "$archive_describe" ]; then release="unreleased, no tag reachable"
      else false; fi; then
  # A source archive has no .git: an npm install from GitHub (Issue #68, ADR-0034). git archive filled
  # .workstation-archive in (export-subst, .gitattributes) with the commit and its git describe, which
  # maps onto the same three release forms. Taken only in exactly that shape; anything else, such as a
  # copy that still carries the placeholders, falls through to unknown.
  stamp="release: $release; commit: $archive_commit"
else
  stamp="release: unknown, not a git checkout (.bumpversion.toml says $version); commit: unknown"
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The brief: the generic source, then the overlay's fragment when there is one.
brief="$work/brief.md"
cat "$src" > "$brief"
if [ -n "$overlay" ] && [ -f "$overlay/AGENTS.md" ]; then cat "$overlay/AGENTS.md" >> "$brief"; fi
brief_sha=$(sha256_of "$brief")
brief_from="global/AGENTS.md"
[ -n "$overlay" ] && [ -f "$overlay/AGENTS.md" ] && brief_from="global/AGENTS.md + overlay"

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
      if ($1 != "cmd" && $1 != "file" && $1 != "glob") why = "kind must be cmd, file or glob"
      else if (NF < 2) why = "no words"
      else if ($1 == "file" && NF != 2) why = "a file entry takes one path"
      else if ($1 == "glob" && NF < 3) why = "a glob entry takes a program and at least one word"
      for (i = 2; i <= NF && why == ""; i++) {
        if ($i !~ /^[A-Za-z0-9._\/~=:@+*-]+$/) why = "word outside the allowed set"
        else if ($1 == "cmd" && $i ~ /\*/) why = "a cmd word may not hold *"
      }
      # A glob is Claude Code only (no Codex form): exactly one "*", the last character of the last
      # word, after at least one other character.
      if (why == "" && $1 == "glob") {
        for (i = 2; i < NF; i++) if ($i ~ /\*/) why = "a glob holds * only at the end of its last word"
        if (why == "" && $NF !~ /^[^*]+\*$/) why = "a glob holds * only at the end of its last word"
        # "Bash(<words>:*)" is the shape of a prefix rule: install-managed.sh would render it for Codex.
        if (why == "" && $NF ~ /:\*$/) why = "a glob may not end in :* (that is a cmd entry)"
      }
      if (why != "") { printf "invalid deny-floor entry (%s): %s\n", why, $0 > "/dev/stderr"; err = 1; next }
      if ($1 == "cmd") {
        w = $2; for (i = 3; i <= NF; i++) w = w " " $i
        print "Bash(" w ":*)" > claude
        print w > codex
      } else if ($1 == "glob") {
        w = $2; for (i = 3; i <= NF; i++) w = w " " $i
        print "Bash(" w ")" > claude
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

# The allow list (Issue #83, ADR-0031): parsed and checked against the floor before anything is written.
# shellcheck source=global/allow-list.sh
. "$script_dir/allow-list.sh"
allow_parse

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

# The shell start-up line that activates the paste wrapper (Issue #58). Opt-in: it is written only with
# --shell-rc=FILE, only into that file, only when absent, and printed as it is written. Without the flag
# it is printed for the owner to add himself. A line carrying our tag but differing is never rewritten.
rc_tag="# personal-multi-harness-workstation-configuration: paste wrapper (ADR-0011)"
rc_line="[ -r \"$snippet_dest\" ] && . \"$snippet_dest\"  $rc_tag"
shell_rc_line() {
  if [ -z "$shell_rc" ]; then
    if [ "$mode" = install ]; then
      echo "NOTE    automatic paste cleaning starts only once this line is in your shell rc; add it yourself:"
      echo "        $rc_line"
      echo "        or re-run with --shell-rc=<absolute path of your rc> to have it appended (opt-in)"
    fi
    return 0
  fi
  if [ -e "$shell_rc" ] && [ ! -f "$shell_rc" ]; then
    echo "REFUSE  $shell_rc is not a regular file; nothing written. Add this line yourself:"
    echo "        $rc_line"
    raise 3
    return 0
  fi
  if [ -f "$shell_rc" ] && grep -qxF "$rc_line" "$shell_rc"; then
    echo "OK      $shell_rc activates the paste wrapper"
    return 0
  fi
  if [ -f "$shell_rc" ] && grep -qF "$rc_tag" "$shell_rc"; then
    echo "STALE   $shell_rc carries a different paste-wrapper line; left alone. Replace it yourself with:"
    echo "        $rc_line"
    raise 1
    return 0
  fi
  case $mode in
    check)
      echo "MISSING $shell_rc: no paste-wrapper start-up line; install --shell-rc=$shell_rc appends it"
      raise 1
      ;;
    dry-run)
      echo "WOULD APPEND to $shell_rc: $rc_line"
      ;;
    install)
      if [ -s "$shell_rc" ] && [ -n "$(tail -c 1 "$shell_rc")" ]; then
        printf '\n' >> "$shell_rc"
      fi
      printf '%s\n' "$rc_line" >> "$shell_rc"
      echo "APPENDED to $shell_rc (opt-in, --shell-rc): $rc_line"
      echo "NOTE    it takes effect in new shells; delete that one line to deactivate the wrapper"
      ;;
  esac
}

render() {
  # $1 = kind (plain|kiro|codexrules|clipscript|clipconf|wrapscript|snippet|codexhooks), $2 = output file
  case $1 in
    plain|kiro)
      {
        [ "$1" = kiro ] && printf '%s\n' '---' 'inclusion: always' '---'
        printf '<!-- %s; source: %s; %s; sha256: %s; do not edit, re-run the installer -->\n\n' \
          "$MARKER_ID" "$brief_from" "$stamp" "$brief_sha"
        cat "$brief"
      } > "$2"
      ;;
    codexrules)
      {
        printf '# %s; source: %s; %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$floor_from" "$stamp"
        printf '# The workstation deny floor (ADR-0016). A prefix rule matches the command words from the\n'
        printf '# program name on; another spelling, a wrapper or a script is not matched.\n'
        awk '{ printf "prefix_rule(pattern=["; for (i = 1; i <= NF; i++) printf "%s\"%s\"", (i > 1 ? ", " : ""), $i; print "], decision=\"forbidden\")" }' "$floor_codex"
      } > "$2"
      ;;
    clipscript)
      {
        sed -n 1p "$clip_src"
        printf '# %s; source: global/clipboard/clipboard_guard.py; %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$stamp"
        sed 1d "$clip_src"
      } > "$2"
      ;;
    clipconf)
      {
        printf '# %s; source: global/clipboard.conf + overlay; %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$stamp"
        cat "$clip_conf"
      } > "$2"
      ;;
    wrapscript)
      {
        sed -n 1p "$wrap_src"
        printf '# %s; source: global/clipboard/paste_wrapper.py; %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$stamp"
        sed 1d "$wrap_src"
      } > "$2"
      ;;
    snippet)
      # Shell functions for zsh and bash. Sourcing this file is the owner's act; nothing here runs it.
      {
        printf '# %s; source: global/install.sh (paste wrapper, ADR-0011); %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$stamp"
        printf '# The paste filter at the harness-CLI paste boundary (ADR-0011). To activate it, add this line to\n'
        printf '# your ~/.zshrc or ~/.bashrc yourself, or run install.sh --shell-rc=<that file> (opt-in):\n'
        printf '#   %s\n' "$rc_line"
        printf '# Then claude, codex and kiro-cli run through the wrapper, which cleans bracketed pastes before the\n'
        printf '# CLI sees them and marks the session (%s=1), so the prompt hook lets its prompts\n' "PMHWC_PASTE_WRAPPER"
        printf '# through. "command claude" (or codex, kiro-cli) runs a CLI without it, and the hook then checks.\n'
        for cli in claude codex kiro-cli; do
          printf '%s() { /usr/bin/python3 -I -B "%s" run --config "%s" -- %s "$@"; }\n' \
            "$cli" "$wrap_dest" "$clip_conf_dest" "$cli"
        done
      } > "$2"
      ;;
    codexhooks)
      # The marker and the provenance stamp sit in the file's "description" (documented as metadata that
      # does not change which hooks run). Codex records trust against each hook's hash; measured on Codex
      # 0.160.0 (app-server hooks/list, Issue #66): changing "description" leaves the hook's currentHash
      # unchanged, while changing its timeout changes it. So a new stamp does not ask for re-trust.
      {
        printf '{\n  "description": "%s; source: global/install.sh (paste filter, ADR-0011); %s; do not edit, re-run the installer",\n' \
          "$MARKER_ID" "$stamp"
        printf '  "hooks": {\n    "UserPromptSubmit": [\n      {\n        "hooks": [\n'
        printf '          {"type": "command", "command": "%s", "timeout": 30}\n' "$(paste_cmd codex | sed 's/"/\\"/g')"
        printf '        ]\n      }\n    ]\n  }\n}\n'
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

# The managed-by line carries the provenance stamp (release and commit; "version" in files an earlier
# release wrote). Content is compared without those fields, so a file whose content matches but whose
# stamp names another source reads as STAMP, not DRIFT: --check flags it, install rewrites it.
unstamp() {
  unstamp_file=$1
  sed -E "/$MARKER_ID/s/; (version|release|commit): [^;\"]*//g" "$unstamp_file"
}
same() {
  same_rendered=$1
  same_installed=$2
  cmp -s "$same_rendered" "$same_installed" || {
    unstamp "$same_rendered" > "$work/same.a" && unstamp "$same_installed" > "$work/same.b" &&
      cmp -s "$work/same.a" "$work/same.b"; }
}
# The stamp a file carries: the release and commit fields of its first managed-by line, or "none".
stamp_of() {
  stamp_line=$(grep -m 1 -F "$MARKER_ID" "$1" 2>/dev/null || true)
  stamp_rel=$(printf '%s' "$stamp_line" | sed -n 's/.*; release: \([^;"]*\);.*/\1/p')
  stamp_com=$(printf '%s' "$stamp_line" | sed -n 's/.*; commit: \([^;"]*\);.*/\1/p')
  if [ -n "$stamp_rel" ] && [ -n "$stamp_com" ]; then
    printf 'release: %s; commit: %s' "$stamp_rel" "$stamp_com"
  else
    printf 'none'
  fi
}

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

  restamp=
  if [ -e "$dest" ] && same "$tmp" "$dest"; then
    if [ "$(stamp_of "$dest")" = "$stamp" ]; then
      echo "OK      $dest ($stamp)"
      return 0
    fi
    restamp=1
  fi

  case $mode in
    check)
      if [ -n "$restamp" ]; then
        echo "STAMP   $dest: content matches, but it carries ($(stamp_of "$dest")) and the source is ($stamp)"
      elif [ -e "$dest" ]; then
        echo "DRIFT   $dest ($(stamp_of "$dest"))"
      else
        echo "MISSING $dest"
      fi
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
      if [ -n "$restamp" ]; then echo "RESTAMPED $dest ($stamp)"; else echo "WROTE   $dest ($stamp)"; fi
      ;;
  esac
}

# Merge one UserPromptSubmit entry (the paste filter, ADR-0011) and the deny floor into the user's
# Claude Code settings. When the paste filter cannot run here (paste_ok=0), its entry is removed instead
# of written. An entry of a removed hook (the restart guard, the HITL picker guard) is always removed.
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

  # The HITL picker guard is removed (ADR-0013, 2026-10-05 amendment): an entry an earlier version
  # merged is always dropped.
  want=null
  if [ "$paste_ok" = 1 ]; then
    want_paste=$(jq -cn --arg cmd "$(paste_cmd claude)" '{hooks: [{type: "command", command: $cmd, timeout: 30}]}')
  else
    want_paste=null
  fi
  if [ "$hooks_mode" = managed ]; then
    # ADR-0025: the admin layer registers the hooks; a user-level copy would run them twice.
    want_paste=null
  fi
  # The restart guard is removed (ADR-0028): an entry an earlier version merged is always dropped.
  want_restart=null
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
  stamp_val="$MARKER_ID; source: global/install.sh (only the hook entries and deny-floor rules merged into this file; every other key is yours); $stamp; do not edit, re-run the installer"
  if ! jq --indent 4 --arg id "$HOOK_ID" --arg pid "$PASTE_ID" --argjson w "$want" --argjson p "$want_paste" \
      --arg rid "$RESTART_ID" --argjson r "$want_restart" --arg sk "$STAMP_KEY" --arg sv "$stamp_val" \
      --arg ok "$OWN_KEY" --argjson f "$deny" '
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
      # Ownership (Issue #67): the floor rules missing before this merge are ours. An earlier record is
      # kept; a file stamped by an install that predates the record counts every floor rule present as
      # ours, because nothing can tell those apart any more.
      ((.permissions.deny? // []) | if type == "array" then . else [] end) as $d0
      | (if (.[$ok] | type) == "array" then .[$ok]
         elif .[$sk] != null then [$f[] | . as $x | select(any($d0[]; . == $x))]
         else [] end) as $prev
      | ($prev + [$f[] | . as $x | select(any($d0[]; . == $x) | not)]) as $own0
      | ([$f[] | . as $x | select(any($own0[]; . == $x))]) as $own
      | if (.permissions != null and (.permissions | type) != "object")
         or (.permissions.deny? != null and (.permissions.deny | type) != "array")
      then error("permissions has an unexpected shape") else . end
      | place("PreToolUse"; $id; $w)
      | place("UserPromptSubmit"; $pid; $p)
      | place("SessionStart"; $rid; $r)
      | place("PreToolUse"; $rid; $r)
      | (.permissions.deny // []) as $d
      | if all($f[]; . as $r | any($d[]; . == $r)) then .
        else .permissions = ((.permissions // {}) | .deny = ($d + [$f[] | . as $r | select(any($d[]; . == $r) | not)]))
        end
      # The provenance stamp (Issue #66): JSON has no comment, so one top-level key of ours carries it.
      # Claude Code ignores a key it does not know: measured on 2.1.289, a user settings file holding
      # this key still applied its permissions.deny (see ADR-0029).
      | .[$sk] = $sv
      | .[$ok] = $own' "$current" > "$merged" 2>/dev/null; then
    echo "REFUSE  $settings: its hooks or permissions section has an unexpected shape; left untouched" >&2
    raise 3
    return 0
  fi

  missing=$(jq --argjson f "$deny" '(.permissions.deny // []) as $d | [$f[] | . as $r | select(any($d[]; . == $r) | not)] | length' "$current")
  jq -S --arg sk "$STAMP_KEY" --arg ok "$OWN_KEY" 'del(.[$sk], .[$ok])' "$current" > "$work/before.json"
  jq -S --arg sk "$STAMP_KEY" --arg ok "$OWN_KEY" 'del(.[$sk], .[$ok])' "$merged" > "$work/after.json"
  jq -r --arg sk "$STAMP_KEY" '.[$sk] // "" | tostring' "$current" > "$work/settings.stamp"
  settings_stamp=$(stamp_of "$work/settings.stamp")
  settings_restamp=
  # A removed hook's entry still registered is named on its own line, so --check says what it is.
  if [ -e "$settings" ] && [ "$mode" = check ] \
     && jq -e --arg id "$HOOK_ID" '[.hooks.PreToolUse[]?.hooks[]? | select((.command? // "") | tostring | contains($id))] | length > 0' \
          "$current" >/dev/null 2>&1; then
    echo "STALE   $settings: the removed HITL picker guard's PreToolUse(AskUserQuestion) entry; install removes it"
  fi
  if [ -e "$settings" ] && cmp -s "$work/before.json" "$work/after.json"; then
    if [ "$settings_stamp" = "$stamp" ]; then
      echo "OK      $settings (hook entries and all $(printf '%s' "$deny" | jq length) deny-floor rules present; $stamp)"
      return 0
    fi
    settings_restamp=1
  fi

  case $mode in
    check)
      if [ -n "$settings_restamp" ]; then
        echo "STAMP   $settings: our entries match, but its \"$STAMP_KEY\" key carries ($settings_stamp) and the source is ($stamp)"
      elif [ -e "$settings" ]; then
        echo "DRIFT   $settings ($missing deny-floor rule(s) missing; or a hook entry is missing or stale; $settings_stamp)"
      else
        echo "MISSING $settings"
      fi
      raise 1
      ;;
    dry-run)
      echo "WOULD MERGE $settings: the UserPromptSubmit (paste filter) entry and $missing deny-floor rule(s), removing any entry of a removed hook; every other key and rule is kept."
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

# Uninstall (Issue #67): every file of ours goes, wherever a hooks mode put it; a file without the marker
# is never touched. In the settings file only our hook entries, the deny-floor rules rendered from this
# checkout and the stamp key are removed; every other key and rule stays, and a backup is left beside it.
# Of the deny rules, only those recorded under OWN_KEY are removed, so a rule the owner wrote himself stays
# even when it equals a floor rule. A file from an install that predates the record has none: then the
# floor rules present are removed, as before, and the backup keeps the previous file.
uninstall_user() {
  for u_dest in "$HOME/.claude/CLAUDE.md" "${CODEX_HOME:-$HOME/.codex}/AGENTS.md" \
      "$HOME/.kiro/steering/workstation-global-brief.md" "$hook_dest" "$hook_conf_dest" "$codex_rules" \
      "$clip_dest" "$clip_conf_dest" "$codex_hooks" "$wrap_dest" "$snippet_dest" "$restart_dest" \
      "$glass_dest" "$glasscmd_dest" "$clip_plist"; do
    if [ -f "$u_dest" ] && is_managed "$u_dest"; then
      rm -f "$u_dest"
      echo "REMOVED $u_dest"
    elif [ -e "$u_dest" ] || [ -L "$u_dest" ]; then
      echo "NOTE    $u_dest exists and is NOT managed by this project; left alone"
    fi
  done
  if [ -d "$data_dir/restart-state" ] && [ ! -L "$data_dir/restart-state" ]; then
    rm -f "$data_dir/restart-state"/*.json
    rmdir "$data_dir/restart-state" 2>/dev/null && echo "REMOVED $data_dir/restart-state"
  fi
  rmdir "$data_dir" 2>/dev/null && echo "REMOVED $data_dir (empty)"
  [ -e "$settings" ] || { echo "ABSENT  $settings"; return 0; }
  command -v jq >/dev/null 2>&1 || { echo "REFUSE  $settings: jq is required to remove our entries" >&2; raise 2; return 0; }
  deny=$(jq -cR -s 'split("\n") | map(select(length > 0))' "$floor_claude")
  if ! jq --indent 4 --arg id "$HOOK_ID" --arg pid "$PASTE_ID" --arg rid "$RESTART_ID" --arg sk "$STAMP_KEY" \
      --arg ok "$OWN_KEY" --argjson f "$deny" '
      def drop($ev; $id):
        if (.hooks[$ev]? | type) == "array" then
          .hooks[$ev] = [ .hooks[$ev][]
            | if any(.hooks[]?; (.command? // "") | tostring | contains($id))
              then (.hooks |= map(select((.command? // "") | tostring | contains($id) | not)))
                   | select(.hooks | length > 0)
              else . end ]
          | if (.hooks[$ev] | length) == 0 then del(.hooks[$ev]) else . end
        else . end;
      if type != "object" then error("not an object") else . end
      | (if (.[$ok] | type) == "array" then .[$ok] elif .[$sk] != null then $f else [] end) as $mine
      | drop("PreToolUse"; $id) | drop("UserPromptSubmit"; $pid) | drop("SessionStart"; $rid)
      | drop("PreToolUse"; $rid)
      | if .hooks == {} then del(.hooks) else . end
      | if (.permissions.deny? | type) == "array" then
          .permissions.deny |= map(select(. as $r | $mine | index($r) | not))
          | if .permissions.deny == [] then del(.permissions.deny) else . end
          | if .permissions == {} then del(.permissions) else . end
        else . end
      | del(.[$sk], .[$ok])' "$settings" > "$work/settings.unmerged.json" 2>/dev/null; then
    echo "REFUSE  $settings: not a readable JSON object of the expected shape; left untouched" >&2
    raise 3
    return 0
  fi
  if jq -e --slurpfile a "$work/settings.unmerged.json" '. == $a[0]' "$settings" >/dev/null 2>&1; then
    echo "OK      $settings holds no entry of ours"
    return 0
  fi
  cp -p "$settings" "$settings.pmhwc-backup"
  cat "$work/settings.unmerged.json" > "$settings.new.$$"
  mv "$settings.new.$$" "$settings"
  echo "UNMERGED $settings (our hook entries, the deny-floor rules this installer added, and our two keys removed; previous version kept as $settings.pmhwc-backup)"
}
# The working method (Issue #61, ADR-0032): agents, skills and commands from <repo>/method, rendered into
# each agent harness's user-level native carrier by its own step, global/method/method_render.py. It
# receives this script's mode and stamp, so the stamp is derived once (ADR-0029). It writes only files
# carrying the managed-by line with "source: method/", and never an unmanaged one.
method_step() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP    the working method (method/): python3 3.9 or later is required to render it"
    raise 2
    return 0
  fi
  # shellcheck disable=SC2086 # $method_optin is empty or the single word --opt-in
  python3 -B "$script_dir/method/method_render.py" "--mode=$mode" "--stamp=$stamp" $method_optin || raise $?
}
# The session-start default model and reasoning effort per agent harness (ADR-0007, ADR-0035), from
# the overlay's model-defaults.json, written into each harness's own user-level key by
# global/models/model_defaults.py. The keys it sets are recorded, so an owner's own value is never
# overwritten (KEPT, which changes no exit code) and uninstall removes only what it set. With no overlay file the policy is
# empty: keys it set earlier are removed while they still hold its value.
models_step() {
  if ! command -v python3 >/dev/null 2>&1; then
    echo "SKIP    the session-start model defaults: python3 3.9 or later is required"
    raise 2
    return 0
  fi
  models_policy=none
  if [ -n "$overlay" ] && [ -f "$overlay/model-defaults.json" ]; then models_policy="$overlay/model-defaults.json"; fi
  python3 -B "$script_dir/models/model_defaults.py" "--mode=$mode" "--stamp=$stamp" "--policy=$models_policy" || raise $?
}
if [ "$mode" = uninstall ]; then
  allow_uninstall
  models_step
  uninstall_user
  method_step
  if [ -n "$shell_rc" ] && [ -f "$shell_rc" ] && grep -qF "$rc_tag" "$shell_rc"; then
    echo "NOTE    $shell_rc still carries the paste-wrapper line; it is guarded and now does nothing. Delete it yourself"
  fi
  echo "NOTE    the admin layer is not touched here; ${MHW_CMD:-./mhw} uninstall prints its sudo line"
  exit "$status"
fi

echo "SOURCE  $stamp"
process plain "$HOME/.claude/CLAUDE.md"
process plain "${CODEX_HOME:-$HOME/.codex}/AGENTS.md"
process kiro "$HOME/.kiro/steering/workstation-global-brief.md"
retire "$hook_dest" "the removed HITL picker guard (ADR-0013, 2026-10-05 amendment)"
retire "$hook_conf_dest" "the removed HITL picker guard's limits (ADR-0013, 2026-10-05 amendment)"
retire "$glass_dest" "the removed breaking-glass switch module (ADR-0028)"
retire "$glasscmd_dest" "the removed /breaking-glass command (ADR-0028)"
retire "$restart_dest" "the removed restart guard (ADR-0028)"
# The removed restart guard's per-session baselines: opaque aggregate hashes, one JSON file each.
restart_state="$data_dir/restart-state"
if [ -L "$restart_state" ]; then
  echo "NOTE    $restart_state is a symbolic link; left alone"
elif [ -d "$restart_state" ]; then
  case $mode in
    check) echo "STALE   $restart_state: the removed restart guard's baselines; install removes them"; raise 1 ;;
    dry-run) echo "WOULD REMOVE $restart_state (the removed restart guard's baselines)" ;;
    install)
      rm -f "$restart_state"/*.json
      if rmdir "$restart_state" 2>/dev/null; then
        echo "REMOVED $restart_state (the removed restart guard's baselines, ADR-0028)"
      else
        echo "NOTE    $restart_state still holds files this project did not write; left alone"
      fi
      ;;
  esac
fi
process codexrules "$codex_rules"
process clipscript "$clip_dest"
process clipconf "$clip_conf_dest"
if [ "$paste_ok" = 1 ]; then
  if [ "$hooks_mode" = user ]; then
    process codexhooks "$codex_hooks"
  else
    retire "$codex_hooks" "the user-level Codex hooks, now registered in the admin layer (ADR-0025)"
  fi
  process wrapscript "$wrap_dest"
  process snippet "$snippet_dest"
  shell_rc_line
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
models_step
allow_step
method_step

# Which layer carries the deny floor (ADR-0016, 2026-10-05 amendment). A report, never a status change:
# the admin copy is the owner's sudo act (install-managed.sh), and its drift is install-managed.sh
# --check's to report. The user copy is kept as a fallback until the admin copy is verified.
report_floor() {
  if [ "$(uname -s)" = Darwin ]; then
    m_claude="$managed_root/Library/Application Support/ClaudeCode/managed-settings.d/50-personal-multi-harness-workstation-configuration.json"
  else
    m_claude="$managed_root/etc/claude-code/managed-settings.d/50-personal-multi-harness-workstation-configuration.json"
  fi
  m_codex="$managed_root/etc/codex/requirements.toml"
  command -v jq >/dev/null 2>&1 || { echo "FLOOR   not reported: jq is required"; return 0; }
  want=$(jq -cR -s 'split("\n") | map(select(length > 0)) | unique' "$floor_claude")
  n_want=$(printf '%s' "$want" | jq length)
  n_codex=$(grep -c . "$floor_codex" || true)
  n_user=0
  [ -f "$settings" ] && n_user=$(jq --argjson f "$want" '[(.permissions.deny? // [])[] | select(. as $r | $f | index($r))] | unique | length' "$settings" 2>/dev/null || echo 0)
  n_admin=0
  [ -f "$m_claude" ] && n_admin=$(jq --argjson f "$want" '[(.permissions.deny? // [])[] | select(. as $r | $f | index($r))] | unique | length' "$m_claude" 2>/dev/null || echo 0)
  n_codex_admin=0
  if [ -f "$m_codex" ] && is_managed "$m_codex"; then
    sed -n 's/^ *{ pattern = \[\(.*\)\], decision = "forbidden".*/\1/p' "$m_codex" \
      | sed -e 's/{ token = "\([^"]*\)" }/\1/g' -e 's/, / /g' > "$work/codex.admin"
    n_codex_admin=$(grep -cxF -f "$floor_codex" "$work/codex.admin" || true)
  fi
  codex_user=absent
  [ -f "$codex_rules" ] && is_managed "$codex_rules" && codex_user=present
  echo "FLOOR   Claude Code: user layer $n_user/$n_want rules; admin layer $n_admin/$n_want rules"
  echo "FLOOR   Codex: user rules file $codex_user; admin requirements $n_codex_admin/$n_codex prefix rules"
  echo "FLOOR   Kiro: none (no rendering; ADR-0016)"
  if [ "$n_admin" -eq "$n_want" ] && [ "$n_codex_admin" -eq "$n_codex" ]; then
    echo "FLOOR   carried by: the admin layer; the user copy stays as a fallback until it is retired (ADR-0016)"
  elif [ "$n_user" -ne "$n_want" ] || [ "$codex_user" != present ]; then
    echo "FLOOR   carried by: NO complete layer; run ${MHW_CMD:-./mhw} install"
  elif [ "$n_admin" -gt 0 ] || [ "$n_codex_admin" -gt 0 ]; then
    echo "FLOOR   carried by: the user layer; the admin copy is INCOMPLETE (run ${MHW_CMD:-./mhw} install)"
  else
    echo "FLOOR   carried by: the user layer only; a session flag can drop it (--setting-sources project, measured); install the admin copy with ${MHW_CMD:-./mhw} install"
  fi
}
report_floor

if [ "$mode" = install ]; then
  echo "RESTART REQUIRED: open fresh Claude Code and Codex sessions before further work; Codex hook trust remains an owner action in /hooks."
fi

exit "$status"
