#!/bin/sh
# Render the global brief to each harness, install the user-level deny floor (Kiro's too, ADR-0036), and
# install the paste filter at the harness-CLI prompt (ADR-0010, ADR-0016, ADR-0011), and render the inner-loop allow
# list (allow-list.conf; ADR-0031: wide only while the admin deny floor is complete), and set each harness's
# session-start default model and effort from overlay/model-defaults.json (ADR-0007, ADR-0035;
# src/render/model-defaults.js). The stale-session restart guard
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
#   --shell-rc=FILE             the shell start-up file that gets the paste wrapper's managed block (an
#                               absolute path). Default (Issue #145): from $SHELL, zsh ${ZDOTDIR:-~}/.zshrc,
#                               bash ~/.bashrc, plus on macOS the login file (~/.bash_profile, see
#                               src/render/shell-rc.js); another shell gets none. --shell-rc=none writes none.
#                               --check reports it; --dry-run writes nothing; --uninstall removes the block
#   --method                    opt-in (Issue #61): render the working method (method/) too. Off by default
#                               until the plugin cutover (#63, #64); once rendered, later runs keep it
#                               current and --uninstall removes it (src/render/method.js, Node since #489)
#
# Exit codes: 0 ok · 1 drift, stamp or missing (--check) · 2 usage, invalid floor entry or missing dependency ·
# 3 something UNMANAGED or unreadable is in the way. A file is managed when its marker line (below) is in
# its first five lines; an unmanaged file is never overwritten. ~/.claude/settings.json is never
# replaced: the paste filter's hook entry and the deny floor's entries are merged into it by
# src/render/settings-merge.js (Node since #491; jq until then, and its output is kept byte for byte), every
# other key, hook and permission rule is kept (no existing deny entry is ever removed), and a backup is
# left beside it.
# The paste filter is a UserPromptSubmit hook: one entry merged into ~/.claude/settings.json and a
# managed ${CODEX_HOME:-~/.codex}/hooks.json. Codex runs it only after the owner trusts it in /hooks.
# Kiro CLI V3 gets the same core in its own mode (Issue #455, ADR-0033 amendment 2026-11-08): one managed
# ~/.kiro/hooks/<name>.json, a UserPromptSubmit hook that blocks with exit 2 and the redacted copy on
# stderr, and ignores the wrapper's marker (on V3 the wrapper cleans pastes, measured once on 3.1.0,
# but never checks typed text). Kiro has no admin layer for
# hooks (hypothesis), so it stays at user level under --hooks=managed too. Kiro runs no hook in a
# workspace the owner did not trust. Every link is read from the bundle and NOT measured.
# The always-on clipboard watcher is WITHDRAWN (ADR-0011): no LaunchAgent is written any more, and a
# managed plist left by an earlier version is removed on install. launchctl is never run: the installer
# prints the bootout command for the owner. The term list is never written by this installer (only
# `mhw add-term` does).
# The paste wrapper (ADR-0011, automatic cleaning at the paste boundary) is `mhw paste-wrapper`, Node since
# #487 (S16 of #470), run from this package by the node that runs mhw; a managed shell snippet defines
# claude, codex and kiro-cli functions that run the CLIs through it. The Python copy an earlier install
# put beside the core is retired. The installer never sources that snippet. Since Issue #145 it adds one marked block that sources it to the
# shell start-up file (see startup_step), with a backup; uninstall removes exactly that block.
# The wrapper exports a session marker; the prompt hook stays as the safety net and blocks only where
# the marker is absent (sessions not opened through the wrapper; ADR-0011, 2026-10-05 amendment).
set -eu

MARKER_ID="managed-by: personal-multi-harness-workstation-configuration"
# The stamp key, the deny-floor ownership record and the hook ids of settings.json (the prompt hook, Node
# since #488, the Python core an earlier install merged, and the removed hooks) are
# src/render/settings-merge.js's (#491).

script_dir=$(cd "$(dirname "$0")" && pwd)
repo_root=$(dirname "$script_dir")
src="$script_dir/AGENTS.md"
floor_src="$script_dir/deny-floor.conf"
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
    --shell-rc=none) shell_rc=none ;;
    --shell-rc=?*) shell_rc=${arg#--shell-rc=} ;;
    -h|--help) sed -n '2,36p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

case $shell_rc in
  ''|none|/*) ;;
  *) echo "--shell-rc needs an absolute path, got: $shell_rc" >&2; exit 2 ;;
esac

for f in "$src" "$floor_src" "$clip_conf_src"; do
  [ -f "$f" ] || { echo "source not found: $f" >&2; exit 2; }
done
if [ -n "$overlay" ] && [ ! -d "$overlay" ]; then
  echo "overlay directory not found: $overlay" >&2
  exit 2
fi

# Structured profiles must be compiled and current before any target is written (ADR-0018).
# Hand-authored overlays and --overlay=none retain the previous installation path.
# The compiler is `mhw profile check` in Node (#479, S08 of #470): the node that runs mhw (MHW_NODE,
# set by bin/mhw.js), else node on PATH, by absolute path.
if [ "$mode" != uninstall ] && [ -n "$overlay" ] && [ -f "$overlay/profile.json" ]; then
  profile_node=${MHW_NODE:-}
  case $profile_node in
    /*) ;;
    *) profile_node=$(command -v node 2>/dev/null || true) ;;
  esac
  case $profile_node in
    /*) ;;
    *) echo "profile overlay requires node (26 or later); no target was written" >&2
       exit 2 ;;
  esac
  (cd "$overlay" && "$profile_node" "$script_dir/../bin/mhw.js" profile check --source profile.json --output .)
fi

data_dir="${XDG_DATA_HOME:-$HOME/.local/share}/personal-multi-harness-workstation-configuration"
hook_dest="$data_dir/hitl-escalation-guard.sh"   # removed (ADR-0013, 2026-10-05); retired below
hook_conf_dest="$data_dir/hitl.conf"             # removed (ADR-0013, 2026-10-05); retired below
restart_dest="$data_dir/restart_guard.py"        # removed (ADR-0028); retired below
glass_dest="$data_dir/breaking_glass.py"         # removed (ADR-0028); retired below
glasscmd_dest="$HOME/.claude/commands/breaking-glass.md"   # removed (ADR-0028); retired below
settings="$HOME/.claude/settings.json"
clip_dest="$data_dir/clipboard_guard.py"        # the Python hook core, removed (#488); retired below
clip_conf_dest="$data_dir/clipboard.conf"
wrap_dest="$data_dir/paste_wrapper.py"            # the Python wrapper, removed (#487); retired below
snippet_dest="$data_dir/paste-filter.sh"
clip_plist="$HOME/Library/LaunchAgents/$CLIP_LABEL.plist"
codex_rules="${CODEX_HOME:-$HOME/.codex}/rules/workstation-deny-floor.rules"
codex_hooks="${CODEX_HOME:-$HOME/.codex}/hooks.json"
# Kiro CLI V3's user-level hook file (Issue #455): the engine loads every *.json in ~/.kiro/hooks (read
# from the bundle, kas 2.35.2; not measured). The name is KIRO_HOOK_FILE in src/commands/paste-wrapper.js.
kiro_hook="$HOME/.kiro/hooks/personal-multi-harness-workstation-configuration-paste-filter.json"

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

# The allow list (Issue #83, ADR-0031): parsed and checked against the floor before anything is written,
# by src/render/allow-list.js in Node (#490, S19 of #470; global/allow-list.sh, sourced here, until then).
# Every value it needs is passed on its command line. The node is the one running mhw (MHW_NODE, an
# absolute path), else the first node on PATH; an absolute MHW_NODE that is not an executable file is
# refused, never replaced by another node (PR #515 lens A1). Without a node the list is neither checked
# nor rendered: allow_step and allow_uninstall say so and nothing is written for it.
allow_js="$script_dir/../src/render/allow-list.js"
ALLOW_OWN_KEY="personal-multi-harness-workstation-configuration-owned-allow"
allow_codex_rules="${CODEX_HOME:-$HOME/.codex}/rules/workstation-allow-list.rules"
allow_codex_profile="${CODEX_HOME:-$HOME/.codex}/workstation.config.toml"
allow_kiro_agent="$HOME/.kiro/agents/workstation.json"
allow_node=${MHW_NODE:-}
allow_why=
case $allow_node in
  /*) if [ ! -f "$allow_node" ] || [ ! -x "$allow_node" ]; then
        allow_why="REFUSE  the allow list: MHW_NODE ($allow_node) is not an executable file; nothing written"
      fi ;;
  *) allow_node=$(command -v node 2>/dev/null || true) ;;
esac
case $allow_why$allow_node in
  REFUSE*|/*) ;;
  *) allow_why="SKIP    the allow list: node (26 or later) is required" ;;
esac
# The node must answer as node, so a program that exits 0 and prints nothing (MHW_NODE=/usr/bin/true)
# never reads as an allow step that ran (PR #519 lens A1).
if [ -z "$allow_why" ] && [ "$("$allow_node" -e 'process.stdout.write("mhw-node-ok")' 2>/dev/null || true)" != mhw-node-ok ]; then
  allow_why="REFUSE  the allow list: $allow_node did not run as node; nothing written"
fi
# The settings merge and the floor report (#491, S20 of #470): src/render/settings-merge.js and
# src/render/floor-report.js, Node since then (they were jq programs), run by this same node. Without one,
# settings.json is left as it is and the floor is not reported; the line says which node was refused.
settings_js="$script_dir/../src/render/settings-merge.js"
floor_js="$script_dir/../src/render/floor-report.js"
case $allow_why in
  '') settings_why= ;;
  *'is not an executable file'*) settings_why="MHW_NODE ($allow_node) is not an executable file" ;;
  *'did not run as node'*) settings_why="$allow_node did not run as node" ;;
  *) settings_why="node (26 or later) is required" ;;
esac
# Set when merge_settings refused (exit 2 or 3): the deny floor is then not in settings.json, so allow_step
# writes no allow list beside it (#491; jq's absence held this until then, and a refused merge did not).
merge_refused=
# Set when the Codex deny-floor file or the Kiro floor was refused: that harness's allow files are then not
# written either, so no harness gets an allow list without its floor (#491, PR #539 lens F3).
codex_floor_refused=
kiro_floor_refused=
if [ -z "$allow_why" ]; then
  "$allow_node" "$allow_js" --phase=parse "--source=$script_dir/allow-list.conf" "--overlay=$overlay" \
    "--floor-codex=$floor_codex" || exit 2
fi

# The clipboard guard's settings: generic defaults, then the overlay's (last value of a key wins).
clip_conf="$work/clipboard.conf"
cat "$clip_conf_src" > "$clip_conf"
if [ -n "$overlay" ] && [ -f "$overlay/clipboard.conf" ]; then cat "$overlay/clipboard.conf" >> "$clip_conf"; fi

# The paste filter's hook command (ADR-0011; Node since #488): `mhw hook prompt`, run by the same node the
# paste wrapper uses (wrap_node below), by absolute path, with NODE_OPTIONS, NODE_ICU_DATA, NODE_PATH and
# NODE_COMPILE_CACHE cleared by /usr/bin/env, so no variable of the session can make node load other code,
# other Unicode data or a compiled cache from elsewhere first (the Node counterpart of python3 -I). A node in a directory the owner can write (Homebrew,
# nvm) is not root-owned, as /usr/bin/python3 was: mhw status names that. Paths go inside double quotes,
# so a path holding a character that is special there, or in JSON, is refused rather than mis-quoted.
paste_ok=1
# The paste wrapper's command (#487): the node that runs mhw (MHW_NODE, set by bin/mhw.js; an absolute
# path), else the first node on PATH, and this package's bin/mhw.js, both by absolute path. The rule of
# ADR-0017 for the MCP launcher (PR #516 lens A1): MHW_NODE is process.execPath, the resolved, versioned
# path (a Homebrew Cellar directory an upgrade removes), so node on PATH is rendered when it is the same
# file. An absolute MHW_NODE that is not an executable file is refused, never replaced by another node
# (the models_step lookup, PR #515 lens A1); the snippet is then not written.
wrap_node=${MHW_NODE:-}
wrap_path_node=$(command -v node 2>/dev/null || true)
wrap_refused=0
case $wrap_node in
  /*)
    if [ ! -f "$wrap_node" ] || [ ! -x "$wrap_node" ]; then
      wrap_refused=1
      wrap_node=
    else
      case $wrap_path_node in
        /*)
          # The same file: node itself compares the two resolved paths (test -ef is not POSIX sh).
          if "$wrap_node" -e 'const f = require("node:fs"); process.exit(f.realpathSync(process.argv[1]) === f.realpathSync(process.argv[2]) ? 0 : 1)' \
              "$wrap_path_node" "$wrap_node" 2>/dev/null; then
            wrap_node=$wrap_path_node
          fi
          ;;
        *) ;;
      esac
    fi
    ;;
  *) wrap_node=$wrap_path_node ;;
esac
wrap_mhw="$repo_root/bin/mhw.js"
case "$clip_dest$clip_conf_dest$wrap_dest$wrap_node$wrap_mhw" in *[\"\\\$\`\']*) paste_ok=0 ;; esac   # a single quote too: the hook command is a /bin/sh -c '...' (#488)
# The start fallback (#488, PR #536 lens B3): when node or the entry is missing or does not start, the
# hook still says the prompt was NOT checked, in the harness's own protocol. Claude Code and Codex: the
# notice as {"systemMessage": ...} and exit 0 (the hook itself always exits 0 there). Kiro: exit 2 with the
# notice on stderr, the only answer Kiro shows; the hook's own exit 2 (a block) passes through. A healthy
# hook's output and exit code are unchanged. The whole command is an explicit /bin/sh -c '...', so it means
# the same whether the agent harness runs it through a shell (Claude Code, documented) or splits it into
# words itself (Codex's hook runner and Kiro were read from their bundles, not measured).
PASTE_START_NOTICE='Paste filter (ADR-0033): internal error (HookStartError); this prompt was NOT checked.'
paste_wrap() { # $1 harness, $2 the hook command (no single quote in it)
  case $1 in
    kiro) printf '%s' "/bin/sh -c '$2 || { [ \$? -eq 2 ] && exit 2; printf \"%s\\n\" \"$PASTE_START_NOTICE\" >&2; exit 2; }'" ;;
    *) printf '%s' "/bin/sh -c '$2 || { printf \"%s\\n\" \"{\\\"systemMessage\\\": \\\"$PASTE_START_NOTICE\\\"}\"; exit 0; }'" ;;
  esac
}
# A rendered command as a JSON string's body: backslashes first, then double quotes.
json_body() { sed -e 's/\\/\\\\/g' -e 's/"/\\"/g'; }
paste_cmd() {
  paste_wrap "$1" "$(printf '/usr/bin/env -u NODE_OPTIONS -u NODE_ICU_DATA -u NODE_PATH -u NODE_COMPILE_CACHE "%s" "%s" hook prompt --harness %s --config "%s"' "$wrap_node" "$wrap_mhw" "$1" "$clip_conf_dest")"
}
if [ "$paste_ok" = 0 ]; then
  echo "REFUSE  paste filter: the data directory, node or package path holds a quote (single or double), backslash, dollar sign or backtick" >&2
else
  case $wrap_node in
    /*) ;;
    *)
      paste_ok=0
      if [ "$wrap_refused" = 1 ]; then
        echo "REFUSE  paste filter: MHW_NODE (${MHW_NODE:-}) is not an executable file; the hook is not registered" >&2
      else
        echo "REFUSE  paste filter: node (26 or later) not found; the hook is not registered" >&2
      fi
      ;;
  esac
fi
if [ "$paste_ok" = 1 ] && [ ! -x /usr/bin/env ]; then
  paste_ok=0
  echo "REFUSE  paste filter: /usr/bin/env not found; the hook is not registered" >&2
fi

status=0
raise() { [ "$1" -gt "$status" ] && status=$1; return 0; }
# private_copy SRC DST: every .pmhwc-*backup of a harness config is owner-only (0600) from its first byte,
# whatever the original's mode: a backup can hold what install removed, such as an MCP server's environment
# values (PR #146 QA advisory). Whatever is at DST (a file, a link, a FIFO) is unlinked first, never written
# through, and anything still there after the unlink is refused. DST itself is never opened: the bytes go into
# a fresh file mktemp made beside it (O_EXCL, 0600), which is then hard-linked to DST. link(2) creates DST
# exclusively and never follows a link already there, so anything planted at DST after the check (a link to a
# FIFO or a device included) makes ln fail and nothing is fed to it. DST must then be a regular file, not a
# link, or the copy is refused. The Node renderers share one form, src/lib/private-copy.js. This one stays in
# shell because install.sh needs no node for it; test/lib/private-copy.test.js runs both forms on the same cases and
# requires the same result.
private_copy() {
  pc_src=$1
  pc_dst=$2
  rm -f "$pc_dst"
  if [ -e "$pc_dst" ] || [ -L "$pc_dst" ]; then
    echo "REFUSE  $pc_dst: something is still there after the unlink; no backup written" >&2
    return 1
  fi
  pc_tmp=$(umask 077 && mktemp "$pc_dst.XXXXXX") || return 1
  if ! { [ -f "$pc_tmp" ] && [ ! -L "$pc_tmp" ] && chmod 600 "$pc_tmp" && cat "$pc_src" > "$pc_tmp" \
         && ln "$pc_tmp" "$pc_dst"; }; then
    rm -f "$pc_tmp"
    echo "REFUSE  $pc_dst: the backup could not be created exclusively; no backup written" >&2
    return 1
  fi
  rm -f "$pc_tmp"
  if [ -d "$pc_dst" ]; then
    # A directory (or a link to one) planted at DST after the check: POSIX ln put the link inside it. Take
    # that one name back out (it is ours, by the random name mktemp chose) and refuse.
    rm -f "$pc_dst/${pc_tmp##*/}"
    echo "REFUSE  $pc_dst: a directory appeared there; no backup written" >&2
    return 1
  fi
  if [ ! -f "$pc_dst" ] || [ -L "$pc_dst" ]; then
    echo "REFUSE  $pc_dst: not a regular file after the copy" >&2
    return 1
  fi
}

# The shell start-up block that activates the paste wrapper (Issue #145; it was opt-in under Issue #58).
# install writes it into the shell's own start-up file, chosen from $SHELL (zsh: ${ZDOTDIR:-~}/.zshrc;
# bash: ~/.bashrc, and on macOS also the file a bash login shell reads), or into --shell-rc=FILE only;
# --shell-rc=none writes none. It is one marked block per file, replaced whole when it differs, never
# duplicated; an earlier one-line form is replaced by it. Every write keeps the previous file as
# <file>.pmhwc-backup and prints old -> new; uninstall removes exactly the block (and an earlier form).
# Damaged markers are refused, nothing written. A file chosen by default must be inside $HOME, and
# ~/.profile is never written. The step is src/render/shell-rc.js (Node since #492, S21 of #470; shell
# and awk functions until then), run by the node the settings merge runs (allow_node); without one, no
# start-up file is changed and the line says which node was refused. Its exit code: 1 is drift under
# --check only (elsewhere node's own exit for an uncaught exception, so a refusal), 3 a refused file,
# 4 a write that failed, which stops the installer as set -e did.
startup_body="[ -r \"$snippet_dest\" ] && . \"$snippet_dest\""
shell_rc_js="$script_dir/../src/render/shell-rc.js"
startup_step() {
  if [ -n "$settings_why" ]; then
    echo "REFUSE  the shell start-up block: $settings_why; no start-up file changed"
    raise 2
    return 0
  fi
  startup_rc=0
  "$allow_node" "$shell_rc_js" "--mode=$mode" "--shell-rc=$shell_rc" "--shell=${SHELL:-}" \
    "--snippet=$snippet_dest" "--data-dir=$data_dir" "--uname=$(uname -s)" || startup_rc=$?
  case $mode:$startup_rc in
    *:0) ;;
    check:1) raise 1 ;;
    *:4) exit 1 ;;
    *:1) raise 3 ;;
    *) raise "$startup_rc" ;;
  esac
}

render() {
  # $1 = kind (plain|kiro|codexrules|clipscript|clipconf|snippet|codexhooks|kirohook), $2 = output file
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
    clipconf)
      {
        printf '# %s; source: global/clipboard.conf + overlay; %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$stamp"
        cat "$clip_conf"
      } > "$2"
      ;;
    snippet)
      # Shell functions for zsh and bash. Sourcing this file is the owner's act; nothing here runs it.
      {
        printf '# %s; source: global/install.sh (paste wrapper, ADR-0011); %s; do not edit, re-run the installer\n' \
          "$MARKER_ID" "$stamp"
        printf '# The paste filter at the harness-CLI paste boundary (ADR-0011). install.sh sources it from a\n'
        printf '# managed block in your shell start-up file (~/.zshrc, or ~/.bashrc and on macOS ~/.bash_profile;\n'
        printf '# Issue #145), which reads:\n'
        printf '#   %s\n' "$startup_body"
        printf '# Then claude, codex and kiro-cli run through the wrapper, which cleans bracketed pastes before the\n'
        printf '# CLI sees them and marks the session (%s=1), so the prompt hook lets its prompts\n' "PMHWC_PASTE_WRAPPER"
        printf '# through. "command claude" (or codex, kiro-cli) runs a CLI without it, and the hook then checks.\n'
        for cli in claude codex kiro-cli; do
          printf '%s() { "%s" "%s" paste-wrapper run --config "%s" -- %s "$@"; }\n' \
            "$cli" "$wrap_node" "$wrap_mhw" "$clip_conf_dest" "$cli"
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
        printf '          {"type": "command", "command": "%s", "timeout": 30}\n' "$(paste_cmd codex | json_body)"
        printf '        ]\n      }\n    ]\n  }\n}\n'
      } > "$2"
      ;;
    kirohook)
      # Kiro CLI V3's hook file format, read from the bundle (kas 2.35.2): {"version": "v1", "hooks": [{
      # "name", "description", "trigger", "action": {"type": "command", "command"}, "timeout"}]}, the
      # timeout in seconds (default 60). The marker and the stamp sit in "description", which the schema
      # defines as optional text, and land on line 5, inside is_managed's first five lines.
      {
        printf '{\n  "version": "v1",\n  "hooks": [\n    {\n'
        printf '      "description": "%s; source: global/install.sh (paste filter, ADR-0033); %s; do not edit, re-run the installer",\n' \
          "$MARKER_ID" "$stamp"
        printf '      "name": "paste filter (personal-multi-harness-workstation-configuration)",\n'
        printf '      "trigger": "UserPromptSubmit",\n'
        printf '      "action": {"type": "command", "command": "%s"},\n' "$(paste_cmd kiro | json_body)"
        printf '      "timeout": 30\n    }\n  ]\n}\n'
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
  process_refused=   # set when the destination is refused (unmanaged): the caller can tell
  kind=$1
  dest=$2
  keep_backup=${3:-}   # "backup": install keeps the file it replaces as <dest>.pmhwc-backup, 0600
  tmp="$work/render"
  render "$kind" "$tmp"

  if [ -e "$dest" ] && ! is_managed "$dest"; then
    echo "REFUSE  $dest: exists and is NOT managed by this project; move it aside or merge it by hand" >&2
    process_refused=1
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
      kept=
      if [ "$keep_backup" = backup ] && [ -z "$restamp" ] && [ -f "$dest" ]; then   # a restamp changes no content
        private_copy "$dest" "$dest.pmhwc-backup" || { raise 3; return 0; }
        kept=" (previous version kept as $dest.pmhwc-backup)"
      fi
      cp "$tmp" "$dest.new.$$"
      mv "$dest.new.$$" "$dest"
      if [ -n "$restamp" ]; then echo "RESTAMPED $dest ($stamp)$kept"; else echo "WROTE   $dest ($stamp)$kept"; fi
      ;;
  esac
}

# Merge one UserPromptSubmit entry (the paste filter, ADR-0011) and the deny floor into the user's
# Claude Code settings: src/render/settings-merge.js (Node since #491, S20 of #470; a jq program until then).
# When the paste filter cannot run here (paste_ok=0), or the admin layer registers the hooks
# (--hooks=managed, ADR-0025), its entry is removed instead of written. An entry of a removed hook (the
# restart guard, the HITL picker guard) is always removed. Idempotent, per event: when exactly one hook
# entry of ours exists, it is the wanted one, and every floor rule is already in permissions.deny, nothing
# is written. The deny floor is a UNION: a missing floor rule is appended, every existing deny entry is kept
# in its place, none is removed. A file jq or strict JSON cannot read is refused and left untouched (exit 3);
# so is one whose hooks or permissions section has another shape. Any refusal, and any exit but 0 outside
# --check (where 1 is drift), sets merge_refused, and allow_step then writes no allow list. A backup or
# write that fails stops the installer (exit 1).
merge_settings() {
  if [ -n "$settings_why" ]; then
    echo "REFUSE  $settings: $settings_why to merge the hook entry and the deny floor; left untouched" >&2
    merge_refused=1
    raise 2
    return 0
  fi
  merge_paste=
  if [ "$paste_ok" = 1 ] && [ "$hooks_mode" != managed ]; then merge_paste="--paste-cmd=$(paste_cmd claude)"; fi
  merge_rc=0
  "$allow_node" "$settings_js" --phase=merge "--mode=$mode" "--settings=$settings" "--floor-claude=$floor_claude" \
    "--stamp=$stamp" ${merge_paste:+"$merge_paste"} || merge_rc=$?
  # Exit 1 is drift only under --check: elsewhere it is node's own exit code for an uncaught exception,
  # so it is a refusal like 2 and 3 (PR #539 lens F1), and allow_step writes nothing beside it.
  case $mode:$merge_rc in
    *:0) ;;
    check:1) raise 1 ;;
    *:4) exit 1 ;;
    *) merge_refused=1; raise "$merge_rc" ;;
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
      "$clip_dest" "$clip_conf_dest" "$codex_hooks" "$kiro_hook" "$wrap_dest" "$snippet_dest" "$restart_dest" \
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
  [ -f "$kiro_hook.pmhwc-backup" ] && echo "NOTE    $kiro_hook.pmhwc-backup kept (a 0600 copy of a hook file install replaced; Kiro does not load it)"
  [ -e "$settings" ] || { echo "ABSENT  $settings"; return 0; }
  if [ -n "$settings_why" ]; then
    echo "REFUSE  $settings: $settings_why to remove our entries; left untouched" >&2
    raise 2
    return 0
  fi
  # The settings half: src/render/settings-merge.js --phase=uninstall (Node since #491).
  unmerge_rc=0
  "$allow_node" "$settings_js" --phase=uninstall "--settings=$settings" "--floor-claude=$floor_claude" || unmerge_rc=$?
  case $unmerge_rc in
    0) ;;
    4) exit 1 ;;
    *) raise "$unmerge_rc" ;;
  esac
}
# The working method (Issue #61, ADR-0032): agents, skills and commands from <repo>/method, rendered into
# each agent harness's user-level native carrier by its own step, src/render/method.js (Node since #489,
# S18 of #470; global/method/method_render.py until then). It receives this script's mode and stamp, so the
# stamp is derived once (ADR-0029). It writes only files carrying the managed-by line with "source:
# method/", and never an unmanaged one. It installs no script any more (the rites run mhw commands); a
# script an earlier version installed is reported STALE by --check and removed by install. The node is
# the models_step lookup (PR #515 lens A1): MHW_NODE, an absolute path, else the first node on PATH; an
# absolute MHW_NODE that is not an executable file is refused, never replaced by another node.
method_step() {
  method_node=${MHW_NODE:-}
  case $method_node in
    /*) if [ ! -f "$method_node" ] || [ ! -x "$method_node" ]; then
          echo "REFUSE  the working method (method/): MHW_NODE ($method_node) is not an executable file; nothing written"
          raise 2
          return 0
        fi ;;
    *) method_node=$(command -v node 2>/dev/null || true) ;;
  esac
  case $method_node in
    /*) ;;
    *) echo "SKIP    the working method (method/): node (26 or later) is required to render it"
       raise 2
       return 0 ;;
  esac
  # shellcheck disable=SC2086 # $method_optin is empty or the single word --opt-in
  method_rc=0
  "$method_node" "$script_dir/../src/render/method.js" "--mode=$mode" "--stamp=$stamp" $method_optin || method_rc=$?
  [ "$method_rc" -eq 0 ] || raise "$method_rc"
  # The plugin cutover step (plugin_retire.py, #130) was removed in v7 (Issue #206): a plugin still
  # enabled is reported by mhw status and disabled by hand with the agent harness's own command.
}
# The session-start default model and reasoning effort per agent harness (ADR-0007, ADR-0035), from
# the overlay's model-defaults.json, written into each harness's own user-level key by
# src/render/model-defaults.js (Node since #481, S10 of #470; global/models/model_defaults.py until then).
# The pinned value is written whatever the key holds (Issue #145), reported old -> new; a value of the
# owner's it replaces is recorded, so uninstall restores it, and removes the keys that had none. With no
# overlay file the policy is empty: keys it set earlier are undone the same way while they still hold its
# value. node: the one bin/mhw.js runs on (MHW_NODE, an absolute path), else the first node on PATH. An
# absolute MHW_NODE that is not an executable file is refused, never replaced by another node (PR #515
# lens A1): the run names the node it was given. The version (26 or later) is not checked here.
models_step() {
  models_node=${MHW_NODE:-}
  case $models_node in
    /*) if [ ! -f "$models_node" ] || [ ! -x "$models_node" ]; then
          echo "REFUSE  the session-start model defaults: MHW_NODE ($models_node) is not an executable file; nothing written"
          raise 2
          return 0
        fi ;;
    *) models_node=$(command -v node 2>/dev/null || true) ;;
  esac
  case $models_node in
    /*) ;;
    *) echo "SKIP    the session-start model defaults: node (26 or later) is required"
       raise 2
       return 0 ;;
  esac
  models_policy=none
  if [ -n "$overlay" ] && [ -f "$overlay/model-defaults.json" ]; then models_policy="$overlay/model-defaults.json"; fi
  "$models_node" "$script_dir/../src/render/model-defaults.js" "--mode=$mode" "--stamp=$stamp" "--policy=$models_policy" || raise $?
}
# The deny floor for Kiro IDE and Kiro CLI V3 (ADR-0036, Issue #144): the same validated floor, merged into
# ~/.kiro/settings/permissions.yaml by src/render/kiro-permissions.js in Node (#482, S11 of #470), run by the
# node that runs mhw (MHW_NODE, set by bin/mhw.js), else node on PATH, by absolute path. The owner's own
# rules are kept and a 0600 backup is left beside it; uninstall removes only the deny rules it appended, as
# it appended them, never one of the owner's, unless his rule is byte-identical to the one it appended,
# which it cannot tell apart. Its report mode runs inside src/render/floor-report.js (#491).
kiro_step() {
  # The node lookup of models_step (PR #515 lens A1): an absolute MHW_NODE that is not an executable file
  # is refused, never replaced by another node.
  kiro_floor_refused=1   # until the renderer says otherwise
  kiro_node=${MHW_NODE:-}
  case $kiro_node in
    /*) if [ ! -f "$kiro_node" ] || [ ! -x "$kiro_node" ]; then
          echo "REFUSE  the Kiro deny floor: MHW_NODE ($kiro_node) is not an executable file; nothing written"
          raise 2
          return 0
        fi ;;
    *) kiro_node=$(command -v node 2>/dev/null || true) ;;
  esac
  case $kiro_node in
    /*) ;;
    *) echo "SKIP    the Kiro deny floor: node (26 or later) is required"
       raise 2
       return 0 ;;
  esac
  kiro_rc=0
  "$kiro_node" "$script_dir/../src/render/kiro-permissions.js" "--mode=$mode" "--stamp=$stamp" "--floor=$floor" \
    "--floor-from=$floor_from" || kiro_rc=$?
  raise "$kiro_rc"
  # The Kiro allow agent is not written beside a floor that was not (#491): any exit but 0, outside --check.
  case $mode:$kiro_rc in *:0|check:*) kiro_floor_refused= ;; *) ;; esac
}
# The retired-server removal (mcp_retire.py, ADR-0035 decision 2, #145) was removed in v7 (Issue #206):
# an aws-api table still in the Codex configuration is removed by hand.
mcp_step() {
  # The MCP renderer is Node since #484 (S13 of #470): src/render/mcp.js, run by the node lookup of
  # models_step and kiro_step (an absolute MHW_NODE that is not an executable file is refused, never
  # replaced by another node).
  mcp_node=${MHW_NODE:-}
  case $mcp_node in
    /*) if [ ! -f "$mcp_node" ] || [ ! -x "$mcp_node" ]; then
          echo "REFUSE  the MCP servers: MHW_NODE ($mcp_node) is not an executable file; nothing written"
          raise 2
          return 0
        fi ;;
    *) mcp_node=$(command -v node 2>/dev/null || true) ;;
  esac
  case $mcp_node in
    /*) ;;
    *) echo "SKIP    the policy MCP servers and the MCP active set: node (26 or later) is required"
       raise 2
       return 0 ;;
  esac
  # The policy MCP servers (ADR-0038, Issue #174): chrome-devtools in the Claude Code user configuration
  # (~/.claude.json), with no origin bound since ADR-0038 amendment D8. old -> new, a 0600 backup, removed
  # on uninstall.
  "$mcp_node" "$script_dir/../src/render/mcp.js" --policy "--mode=$mode" "--stamp=$stamp" || raise $?
  # The MCP active set (Issue #219, ADR-0041): once the local MCP definition declares "active_set", every
  # server outside it is turned off through each agent harness's own switch (Codex enabled = false,
  # Claude Code deniedMcpServers, Kiro "disabled"); the Claude desktop app is reported only. Undeclared,
  # nothing is turned off, and uninstall turns back on what install turned off. Node since S14 (#485):
  # src/commands/mcp-active.js, run by the renderer's --active mode; no python3 is needed.
  "$mcp_node" "$script_dir/../src/render/mcp.js" --active "--mode=$mode" "--stamp=$stamp" || raise $?
}
# Chrome's remote-debugging toggle (Issue #224, ADR-0038 amendment 2026-10-24): the chrome-devtools server
# attaches to the owner's Chrome, so `mhw chrome-debugging` (src/render/chrome-debugging.js, Node since
# #480) sets devtools.remote_debugging.user-enabled in Chrome's Local State, only while Chrome is not
# running, changing that one key and printing none of the file. Chrome still asks him to allow a
# connection. Uninstall leaves the key as it is. The node is the one running mhw (MHW_NODE, an absolute
# path), else the first node on PATH, run by the absolute path command -v reports.
chrome_step() {
  chrome_node=${MHW_NODE:-}
  case "$chrome_node" in
    /*) { [ -f "$chrome_node" ] && [ -x "$chrome_node" ]; } || chrome_node= ;;
    *) chrome_node= ;;
  esac
  if [ -z "$chrome_node" ]; then
    chrome_node=$(command -v node 2>/dev/null) || chrome_node=
    case "$chrome_node" in /*) ;; *) chrome_node= ;; esac
  fi
  if [ -z "$chrome_node" ]; then
    echo "SKIP    Chrome remote debugging: node 26 or later is required"
    raise 2
    return 0
  fi
  "$chrome_node" "$script_dir/../bin/mhw.js" chrome-debugging "--mode=$mode" || raise $?
}
# The allow-list step (ADR-0031): Claude Code permissions.allow and defaultMode, the Codex rules and profile,
# and the Kiro agent, wide only while the admin deny floor is complete for that harness (src/render/allow-list.js).
# A missing or empty tier input reads as narrow, never wide. An allow list must never land without the floor
# beside it: the step runs only where merge_settings did not refuse (merge_refused, #491).
allow_step() {
  if [ -n "$allow_why" ]; then echo "$allow_why"; raise 2; return 0; fi
  # An allow list never lands without the deny floor beside it: where merge_settings refused, the floor
  # is not in settings.json, so nothing is written for the allow list either (#491; until then jq's
  # absence held this, and a merge refused on the file's shape did not). --check only reads.
  if [ -n "$merge_refused" ] && [ "$mode" != check ]; then
    echo "REFUSE  the allow list: the deny floor was not merged into $settings (see above), and an allow list never lands without it; nothing written" >&2
    raise 2
    return 0
  fi
  allow_refused=
  if [ "$mode" != check ]; then
    [ -n "$codex_floor_refused" ] && allow_refused=codex
    [ -n "$kiro_floor_refused" ] && allow_refused=${allow_refused:+$allow_refused,}kiro
  fi
  "$allow_node" "$allow_js" --phase=step "--mode=$mode" "--stamp=$stamp" "--source=$script_dir/allow-list.conf" \
    "--overlay=$overlay" "--retired=$script_dir/allow-retired.conf" "--floor-codex=$floor_codex" \
    "--floor-claude=$floor_claude" "--managed-root=${managed_root:-/}" "--settings=$settings" "--home=$HOME" \
    "--codex-home=${CODEX_HOME:-}" "--repo-root=$repo_root" "--cmd=${MHW_CMD:-./mhw}" "--refused-floor=$allow_refused" || raise $?
}
# Uninstall: our files go, and only the allow rules and permission mode this installer added leave
# settings.json (a rule the owner wrote himself stays).
allow_uninstall() {
  if [ -n "$allow_why" ]; then
    # Nothing to remove: say why the step did not run, and go on. Something of ours left: uninstall_user
    # would take the deny floor out from beside our allow rules (PR #519 lens B1), so nothing is
    # uninstalled at all.
    if { [ -f "$settings" ] && grep -qF "\"$ALLOW_OWN_KEY\"" "$settings"; } \
       || { [ -f "$allow_codex_rules" ] && is_managed "$allow_codex_rules"; } \
       || { [ -f "$allow_codex_profile" ] && is_managed "$allow_codex_profile"; } \
       || { [ -f "$allow_kiro_agent" ] && is_managed "$allow_kiro_agent"; }; then
      echo "$allow_why" >&2
      echo "REFUSE  uninstall: the allow list this installer wrote cannot be removed without node, and the deny floor must not leave from beside it; nothing uninstalled. Re-run with node 26 or later on PATH (or MHW_NODE)" >&2
      exit 2
    fi
    echo "$allow_why"
    raise 2
    return 0
  fi
  # A failed allow step (a hand-edited ownership record, exit 3) may have left our allow rules in
  # settings.json: stop here, before uninstall_user takes the deny floor out from beside them (PR #519 lens A3).
  allow_rc=0
  "$allow_node" "$allow_js" --phase=uninstall "--settings=$settings" "--home=$HOME" "--codex-home=${CODEX_HOME:-}" || allow_rc=$?
  if [ "$allow_rc" -ne 0 ]; then
    echo "REFUSE  uninstall: the allow-list step failed (exit $allow_rc), and the deny floor must not leave from beside its allow rules; nothing else uninstalled. Fix $settings (or move it aside) and re-run" >&2
    exit "$allow_rc"
  fi
}
if [ "$mode" = uninstall ]; then
  allow_uninstall
  models_step
  mcp_step
  chrome_step
  kiro_step
  startup_step   # before uninstall_user, which removes the data directory once it is empty
  uninstall_user
  method_step
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
codex_floor_refused=$process_refused   # the Codex allow list is not written beside a refused floor (#491)
retire "$clip_dest" "the Python prompt hook core, replaced by mhw hook prompt (Node, #488)"
process clipconf "$clip_conf_dest"
# The term lists' salt is a 0600 file since #488 (owner ruling, 2026-11-21: no Keychain). A list that
# holds hashes while no salt file exists was hashed with the macOS Keychain salt of an earlier install.
# It is NOT migrated: reading the Keychain without risking an unlock dialog is what Node cannot do (on a
# locked keychain the read blocked until killed, CI run 44858243105). The owner re-adds the terms; the
# hook and mhw scan say term matching is off until then, and add-term moves the old list aside.
salt_lo="$data_dir/local-overlay"
if [ "$mode" != uninstall ] && [ ! -f "$salt_lo/clipboard-salt" ]; then
  for salt_list in clipboard-terms clipboard-terms-health clipboard-terms-colleague; do
    if [ -f "$salt_lo/$salt_list" ] && grep -Eq '^[0-9a-f]{64}$' "$salt_lo/$salt_list"; then
      echo "SKIP    $salt_lo/$salt_list: its hashes were made with the macOS Keychain salt, which mhw no longer reads (#488); nothing was migrated. Re-add each term with mhw add-term; until then term matching is off and every prompt says so"
    fi
  done
fi
if [ "$paste_ok" = 1 ]; then
  if [ "$hooks_mode" = user ]; then
    process codexhooks "$codex_hooks"
  else
    retire "$codex_hooks" "the user-level Codex hooks, now registered in the admin layer (ADR-0025)"
  fi
  process kirohook "$kiro_hook" backup
  retire "$wrap_dest" "the Python paste wrapper, replaced by mhw paste-wrapper (Node, #487)"
  case $wrap_node in
    /*)
      process snippet "$snippet_dest"
      startup_step
      ;;
    *)
      raise 2
      if [ "$wrap_refused" = 1 ]; then
        echo "REFUSE  $snippet_dest: MHW_NODE (${MHW_NODE:-}) is not an executable file; the paste wrapper's snippet is not written, the prompt hook still checks"
      else
        echo "SKIP    $snippet_dest: the paste wrapper needs node (26 or later), and none was found; the prompt hook still checks"
      fi
      ;;
  esac
else
  raise 2
  echo "SKIP    $codex_hooks: the paste filter cannot run here (see the REFUSE line above)"
  echo "SKIP    $kiro_hook: the paste filter cannot run here either"
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
kiro_step
mcp_step
chrome_step
models_step
allow_step
method_step

# Which layer carries the deny floor (ADR-0016, 2026-10-05 amendment). A report, never a status change:
# the admin copy is the owner's sudo act (install-managed.sh), and its drift is install-managed.sh
# --check's to report. The user copy is kept as a fallback until the admin copy is verified. The lines,
# Kiro's included, are src/render/floor-report.js (Node since #491, S20 of #470; jq counted until then).
report_floor() {
  if [ -n "$settings_why" ]; then
    echo "FLOOR   not reported: $settings_why"
    raise 2
    return 0
  fi
  "$allow_node" "$floor_js" "--settings=$settings" "--floor-claude=$floor_claude" "--floor-codex=$floor_codex" \
    "--floor=$floor" "--floor-from=$floor_from" "--stamp=$stamp" "--codex-rules=$codex_rules" \
    "--managed-root=$managed_root" "--cmd=${MHW_CMD:-./mhw}" || raise $?
}
report_floor

if [ "$mode" = install ]; then
  echo "RESTART REQUIRED: open fresh Claude Code, Codex and Kiro sessions before further work; Codex hook trust remains an owner action in /hooks."
fi

exit "$status"
