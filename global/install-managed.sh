#!/bin/sh
# Install the hook layers in each harness's native admin layer (ADR-0025), so no process running as the
# owner can switch them off; only a root-owned, expiring breaking-glass switch can (ADR-0024).
#
#   install-managed.sh                       render and validate into a fresh stage, print the ONE sudo
#                                            line for the owner; writes nothing outside the stage
#   install-managed.sh --check               exit 0 when the installed admin layer matches a fresh render
#   install-managed.sh --uninstall           print the sudo line that removes what --apply installed
#   install-managed.sh --apply=STAGE --sha256=HEX   (root) copy the stage, verify its hash, install it
#   install-managed.sh --remove              (root) remove every file --apply installed
#   --overlay=DIR|none                       passed to install.sh, which renders the hook files
#   --root=DIR                               prefix every system path; for tests only, allows non-root
#
# Targets (macOS; Linux uses /etc/personal-multi-harness-workstation-configuration and /etc/claude-code):
#   /Library/Application Support/personal-multi-harness-workstation-configuration/bin/   hook scripts
#   /Library/Application Support/ClaudeCode/managed-settings.d/50-personal-multi-harness-workstation-configuration.json
#   /etc/codex/requirements.toml             refused when it exists and is not ours
# Kiro has no admin layer for hooks; Windows is not supported (ADR-0025).
# Exit codes: 0 ok · 1 drift or missing (--check) · 2 usage or missing dependency · 3 something
# unmanaged in the way, or a stage that fails validation or its hash.
set -eu

NAME="personal-multi-harness-workstation-configuration"
MARKER_ID="managed-by: $NAME"
DROPIN="50-$NAME.json"
FILES="hitl-escalation-guard.sh hitl.conf clipboard_guard.py clipboard.conf restart_guard.py breaking_glass.py"

script_dir=$(cd "$(dirname "$0")" && pwd)
mode=render
root=
stage=
sha=
overlay_arg=
for arg in "$@"; do
  case $arg in
    --check) mode=check ;;
    --uninstall) mode=uninstall ;;
    --remove) mode=remove ;;
    --apply=*) mode=apply; stage=${arg#--apply=} ;;
    --sha256=*) sha=${arg#--sha256=} ;;
    --root=*) root=${arg#--root=} ;;
    --overlay=*) overlay_arg=$arg ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

if [ "$(uname -s)" = Darwin ]; then
  base="$root/Library/Application Support/$NAME"
  claude_dir="$root/Library/Application Support/ClaudeCode/managed-settings.d"
else
  base="$root/etc/$NAME"
  claude_dir="$root/etc/claude-code/managed-settings.d"
fi
bin="$base/bin"
switches="$base/breaking-glass"
claude_file="$claude_dir/$DROPIN"
codex_file="$root/etc/codex/requirements.toml"

[ -x /usr/bin/python3 ] || { echo "REFUSE  /usr/bin/python3 is required" >&2; exit 2; }
command -v jq >/dev/null 2>&1 || { echo "REFUSE  jq is required" >&2; exit 2; }
case $bin in *\"*|*\\*|*\$*|*\`*) echo "REFUSE  $bin holds a quote, backslash, dollar sign or backtick" >&2; exit 2 ;; esac

is_root_run() { [ "$(id -u)" = 0 ] || [ -n "$root" ]; }

# A digest of everything --apply installs, in a fixed order. Python, not shasum/sha256sum: same on both OSes.
stage_hash() {
  /usr/bin/python3 -I -B -c '
import hashlib, os, sys
d, names = sys.argv[1], sys.argv[2].split() + ["../claude.json", "../requirements.toml"]
h = hashlib.sha256()
for n in names:
    p = os.path.normpath(os.path.join(d, "bin", n))
    with open(p, "rb") as f:
        data = f.read()
    h.update(n.encode() + b"\0" + str(len(data)).encode() + b"\0" + data)
print(h.hexdigest())' "$1" "$FILES"
}

validate() { # $1 stage: both admin documents must parse, or the harness may refuse to start
  /usr/bin/python3 -I -B -c '
import json, sys
d = json.load(open(sys.argv[1] + "/claude.json"))
assert isinstance(d, dict) and set(d) == {"hooks"}
try:
    import tomllib
except ImportError:
    sys.exit(0)
tomllib.load(open(sys.argv[1] + "/requirements.toml", "rb"))' "$1" 2>/dev/null
}

render() { # $1 empty stage directory
  st=$1
  mkdir -p "$st/home" "$st/bin"
  # install.sh renders every hook file (overlay included) into a throwaway home; reuse, never duplicate.
  if ! env -u CODEX_HOME -u XDG_DATA_HOME HOME="$st/home" sh "$script_dir/install.sh" ${overlay_arg:+"$overlay_arg"} \
      > "$st/install.log" 2>&1; then
    echo "REFUSE  install.sh could not render the hook files (see $st/install.log)" >&2
    exit 2
  fi
  for f in $FILES; do cp "$st/home/.local/share/$NAME/$f" "$st/bin/$f"; done
  py="/usr/bin/python3 -I -B"
  restart_claude="$py \"$bin/restart_guard.py\" --harness claude-code"
  restart_codex="$py \"$bin/restart_guard.py\" --harness codex"
  paste_claude="$py \"$bin/clipboard_guard.py\" prompt-hook --harness claude --config \"$bin/clipboard.conf\""
  paste_codex="$py \"$bin/clipboard_guard.py\" prompt-hook --harness codex --config \"$bin/clipboard.conf\""
  hitl="/bin/sh \"$bin/hitl-escalation-guard.sh\""
  jq -n --arg rs "$restart_claude" --arg ps "$paste_claude" --arg h "$hitl" '
    def hook($c; $t): {type: "command", command: $c, timeout: $t};
    {hooks: {
      SessionStart: [{hooks: [hook($rs; 10)]}],
      PreToolUse: [{hooks: [hook($rs; 10)]}, {matcher: "AskUserQuestion", hooks: [hook($h; 5)]}],
      UserPromptSubmit: [{hooks: [hook($ps; 30)]}]}}' > "$st/claude.json"
  version=$(sed -n 's/^current_version = "\(.*\)"/\1/p' "$script_dir/../.bumpversion.toml" | head -n 1)
  {
    printf '# %s; source: global/install-managed.sh; version: %s; do not edit, re-run the installer\n' "$MARKER_ID" "$version"
    printf '# ADR-0025. No allow_managed_hooks_only and no [features] pin: user and plugin hooks keep running.\n'
    printf '[hooks]\nmanaged_dir = %s\n' "$(jq -n --arg v "$bin" '$v')"
    for pair in "SessionStart|$restart_codex|10" "PreToolUse|$restart_codex|10" "UserPromptSubmit|$paste_codex|30"; do
      ev=${pair%%|*}; rest=${pair#*|}; cmd=${rest%|*}; t=${rest##*|}
      printf '\n[[hooks.%s]]\n\n[[hooks.%s.hooks]]\ntype = "command"\ncommand = %s\ntimeout = %s\n' \
        "$ev" "$ev" "$(jq -n --arg v "$cmd" '$v')" "$t"
    done
  } > "$st/requirements.toml"
  validate "$st" || { echo "REFUSE  the rendered admin documents do not validate" >&2; exit 3; }
}

codex_foreign() { [ -e "$codex_file" ] && ! head -n 5 "$codex_file" | grep -qF "$MARKER_ID"; }

case $mode in
  render)
    st=$(mktemp -d "${TMPDIR:-/tmp}/pmhwc-managed.XXXXXX")
    render "$st"
    if codex_foreign; then
      echo "REFUSE  $codex_file exists and is NOT managed by this project; nothing to apply" >&2
      exit 3
    fi
    echo "STAGED  $st (validated; nothing installed)"
    echo "RUN     sudo /bin/sh \"$script_dir/install-managed.sh\" --apply=\"$st\" --sha256=$(stage_hash "$st")${root:+ --root=\"$root\"}"
    echo "THEN    sh \"$script_dir/install.sh\" --hooks=managed   (removes the user-level duplicates), then open fresh sessions"
    ;;
  uninstall)
    echo "RUN     sudo /bin/sh \"$script_dir/install-managed.sh\" --remove${root:+ --root=\"$root\"}"
    echo "THEN    sh \"$script_dir/install.sh\"   (restores the user-level hooks), then open fresh sessions"
    ;;
  check)
    st=$(mktemp -d "${TMPDIR:-/tmp}/pmhwc-managed.XXXXXX")
    render "$st"
    status=0
    # The managed-by header stamps the release that rendered a file; a release that changes no
    # installed content is not drift.
    unstamp() {
      unstamp_file=$1
      sed "/$MARKER_ID/s/; version: [^;]*;/; version: -;/" "$unstamp_file"
    }
    compare() {
      rendered=$1
      installed=$2
      if [ ! -f "$installed" ]; then echo "MISSING $installed"; status=1
      elif ! cmp -s "$rendered" "$installed" && {
        unstamp "$rendered" > "$st/same.a"; unstamp "$installed" > "$st/same.b"
        ! cmp -s "$st/same.a" "$st/same.b"; }; then echo "DRIFT   $installed"; status=1
      else echo "OK      $installed"; fi
    }
    for f in $FILES; do compare "$st/bin/$f" "$bin/$f"; done
    compare "$st/claude.json" "$claude_file"
    compare "$st/requirements.toml" "$codex_file"
    rm -rf "$st"
    exit "$status"
    ;;
  apply)
    is_root_run || { echo "REFUSE  --apply needs administrator privilege (sudo)" >&2; exit 2; }
    [ -n "$stage" ] && [ -n "$sha" ] || { echo "REFUSE  --apply needs --sha256" >&2; exit 2; }
    # Copy first, then verify the copy: the stage is writable by the owner's account, the copy is not.
    work=$(mktemp -d "${TMPDIR:-/tmp}/pmhwc-apply.XXXXXX")
    trap 'rm -rf "$work"' EXIT
    mkdir "$work/bin"
    for f in $FILES; do cp "$stage/bin/$f" "$work/bin/$f"; done
    cp "$stage/claude.json" "$stage/requirements.toml" "$work/"
    [ "$(stage_hash "$work")" = "$sha" ] || { echo "REFUSE  the stage does not match its hash; nothing installed" >&2; exit 3; }
    validate "$work" || { echo "REFUSE  the stage does not validate; nothing installed" >&2; exit 3; }
    if codex_foreign; then echo "REFUSE  $codex_file exists and is NOT managed by this project" >&2; exit 3; fi
    umask 022
    mkdir -p "$bin" "$switches" "$claude_dir" "$(dirname "$codex_file")"
    chmod 755 "$base" "$bin" "$switches"
    put() { # $1 source, $2 destination, $3 mode: atomic replace, root-owned on a real run
      cp "$1" "$2.new.$$"
      chmod "$3" "$2.new.$$"
      [ -n "$root" ] || chown 0:0 "$2.new.$$"
      mv "$2.new.$$" "$2"
    }
    [ -n "$root" ] || chown 0:0 "$base" "$bin" "$switches"
    for f in $FILES; do
      case $f in *.sh|*.py) m=755 ;; *) m=644 ;; esac
      put "$work/bin/$f" "$bin/$f" "$m"
    done
    put "$work/claude.json" "$claude_file" 644
    put "$work/requirements.toml" "$codex_file" 644
    echo "INSTALLED $bin, $claude_file, $codex_file"
    echo "THEN    as yourself: sh \"$script_dir/install.sh\" --hooks=managed; then open fresh Claude Code and Codex sessions"
    ;;
  remove)
    is_root_run || { echo "REFUSE  --remove needs administrator privilege (sudo)" >&2; exit 2; }
    for f in $FILES; do rm -f "$bin/$f"; done
    rm -f "$switches"/*.json "$claude_file"
    if [ -e "$codex_file" ] && ! codex_foreign; then rm -f "$codex_file"; fi
    rmdir "$switches" "$bin" "$base" 2>/dev/null || true
    echo "REMOVED the admin-layer hooks; run install.sh as yourself to restore the user-level ones"
    ;;
esac
