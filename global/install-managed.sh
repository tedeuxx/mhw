#!/bin/sh
# Install the hook layers in each harness's native admin layer (ADR-0025), so no process running as the
# owner can switch them off. Only an administrator can change or remove them, with sudo, as with any
# OS-managed policy; there is no per-request or expiring waiver (ADR-0028, which removed the restart
# guard and the ADR-0024 breaking-glass switches; --apply and --remove delete what they left behind).
# The HITL picker guard is removed too (ADR-0013, 2026-10-05 amendment, Issue #60): --apply and
# --remove delete its script and limits, and --check reports them as STALE.
# The same admin documents carry the deny floor (ADR-0016, 2026-10-05 amendment): the Claude Code
# drop-in's permissions.deny and the Codex requirements' [rules] prefix_rules, both rendered from the
# rules install.sh renders, so the floor has one source. No session flag drops the admin layer.
#
#   install-managed.sh                       render and validate into a fresh stage, print the ONE sudo
#                                            line for the owner; writes nothing outside the stage
#   install-managed.sh --check               exit 0 when the installed admin layer matches a fresh render (stamp too)
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
# Exit codes: 0 ok · 1 drift, stamp or missing (--check) · 2 usage or missing dependency · 3 something
# unmanaged in the way, or a stage that fails validation or its hash.
set -eu

NAME="personal-multi-harness-workstation-configuration"
MARKER_ID="managed-by: $NAME"
DROPIN="50-$NAME.json"
FILES="clipboard_guard.py clipboard.conf"
# Removed by ADR-0028 (restart guard, switches) and by ADR-0013's 2026-10-05 amendment (HITL picker
# guard); an earlier --apply installed them. Deleted by --apply and --remove, reported by --check.
LEGACY="restart_guard.py breaking_glass.py hitl-escalation-guard.sh hitl.conf"

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
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
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
switches="$base/breaking-glass"   # removed (ADR-0028): an earlier --apply created it
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
assert isinstance(d, dict) and set(d) == {"hooks", "permissions", sys.argv[2]}
assert isinstance(d[sys.argv[2]], str) and "; release: " in d[sys.argv[2]] and "; commit: " in d[sys.argv[2]]
assert set(d["permissions"]) == {"deny"}
deny = d["permissions"]["deny"]
assert isinstance(deny, list) and deny and all(isinstance(r, str) and r for r in deny)
try:
    import tomllib
except ImportError:
    sys.exit(0)
t = tomllib.load(open(sys.argv[1] + "/requirements.toml", "rb"))
rules = t["rules"]["prefix_rules"]
assert rules and all(r["decision"] == "forbidden" and r["pattern"] for r in rules)
# One Codex rule per Claude PREFIX rule: a glob entry is Claude Code only (ADR-0035), the same
# selector the requirements renderer uses.
assert len(rules) == sum(r.startswith("Bash(") and r.endswith(":*)") for r in deny)' "$1" "$NAME" 2>/dev/null
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
  paste_claude="$py \"$bin/clipboard_guard.py\" prompt-hook --harness claude --config \"$bin/clipboard.conf\""
  paste_codex="$py \"$bin/clipboard_guard.py\" prompt-hook --harness codex --config \"$bin/clipboard.conf\""
  # The deny floor exactly as install.sh rendered it (global entries, then the overlay's), so the admin
  # copy cannot drift from the user copy: the throwaway home started empty, so its deny list is the floor
  # plus the allow list's own Edit protections (ADR-0031), which are user-level and named by their owner key.
  jq -c '.permissions.deny - (.["personal-multi-harness-workstation-configuration-owned-allow"].deny // [])' \
    "$st/home/.claude/settings.json" > "$st/floor.json"
  # The provenance stamp (Issue #66, ADR-0029) exactly as install.sh derived it for the same checkout,
  # read back from a file it rendered, so the admin documents and the scripts cannot name two sources.
  stamp=$(grep -m 1 -F "$MARKER_ID" "$st/bin/clipboard.conf" | sed -n 's/.*; \(release: [^;]*; commit: [^;]*\);.*/\1/p')
  [ -n "$stamp" ] || { echo "REFUSE  install.sh rendered no provenance stamp" >&2; exit 2; }
  # JSON has no comment: one top-level key of ours carries the stamp. Claude Code ignores a key it does
  # not know (measured on 2.1.289 through --settings; see ADR-0029).
  jq -n --arg ps "$paste_claude" --slurpfile f "$st/floor.json" --arg sk "$NAME" \
      --arg sv "$MARKER_ID; source: global/install-managed.sh; $stamp; do not edit, re-run the installer" '
    def hook($c; $t): {type: "command", command: $c, timeout: $t};
    {($sk): $sv,
     hooks: {UserPromptSubmit: [{hooks: [hook($ps; 30)]}]},
     permissions: {deny: $f[0]}}' > "$st/claude.json"
  {
    printf '# %s; source: global/install-managed.sh; %s; do not edit, re-run the installer\n' "$MARKER_ID" "$stamp"
    printf '# ADR-0025. No allow_managed_hooks_only and no [features] pin: user and plugin hooks keep running.\n'
    printf '[hooks]\nmanaged_dir = %s\n' "$(jq -n --arg v "$bin" '$v')"
    # One hook since ADR-0028 removed the restart guard: the paste filter.
    printf '\n[[hooks.UserPromptSubmit]]\n\n[[hooks.UserPromptSubmit.hooks]]\ntype = "command"\ncommand = %s\ntimeout = 30\n' \
      "$(jq -n --arg v "$paste_codex" '$v')"
    # The deny floor's command entries as admin prefix rules (ADR-0016, 2026-10-05 amendment). They
    # merge with every .rules file and the most restrictive decision wins, so "codex exec
    # --ignore-rules" cannot skip them. A file or glob entry has no Codex form (ADR-0016).
    printf '\n# The workstation deny floor (ADR-0016). One rule per line; a prefix matches the command words\n'
    printf '# from the program name on, so another spelling, a wrapper or a script is not matched.\n'
    printf '[rules]\nprefix_rules = [\n'
    jq -r '.[] | select(startswith("Bash(") and endswith(":*)")) | .[5:-3] | split(" ")
      | "  { pattern = [" + (map("{ token = " + tojson + " }") | join(", "))
        + "], decision = \"forbidden\", justification = \"workstation deny floor (ADR-0016)\" },"' "$st/floor.json"
    printf ']\n'
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
    echo "THEN    ${MHW_CMD:-./mhw} install   (detects the admin layer and removes the user-level duplicates), then open fresh sessions"
    ;;
  uninstall)
    echo "RUN     sudo /bin/sh \"$script_dir/install-managed.sh\" --remove${root:+ --root=\"$root\"}"
    echo "THEN    ${MHW_CMD:-./mhw} install   (restores the user-level hooks), then open fresh sessions"
    ;;
  check)
    st=$(mktemp -d "${TMPDIR:-/tmp}/pmhwc-managed.XXXXXX")
    render "$st"
    status=0
    # The managed-by line carries the provenance stamp (Issue #66, ADR-0029; "version" in files an
    # earlier release installed). Content is compared without it; a stamp other than the source's on
    # matching content is STAMP, not DRIFT. Both fail the check, and --apply rewrites both.
    unstamp() {
      unstamp_file=$1
      sed -E "/$MARKER_ID/s/; (version|release|commit): [^;\"]*//g" "$unstamp_file"
    }
    stamp_of() {
      stamp_line=$(grep -m 1 -F "$MARKER_ID" "$1" 2>/dev/null || true)
      stamp_got=$(printf '%s' "$stamp_line" | sed -n 's/.*; \(release: [^;"]*; commit: [^;"]*\);.*/\1/p')
      printf '%s' "${stamp_got:-none}"
    }
    echo "SOURCE  $(stamp_of "$st/bin/clipboard.conf")"
    compare() {
      rendered=$1
      installed=$2
      if [ ! -f "$installed" ]; then echo "MISSING $installed"; status=1
      elif cmp -s "$rendered" "$installed"; then echo "OK      $installed ($(stamp_of "$installed"))"
      else
        unstamp "$rendered" > "$st/same.a"; unstamp "$installed" > "$st/same.b"
        if cmp -s "$st/same.a" "$st/same.b"; then
          echo "STAMP   $installed: content matches, but it carries ($(stamp_of "$installed")) and the source is ($(stamp_of "$rendered"))"
        else
          echo "DRIFT   $installed ($(stamp_of "$installed"))"
        fi
        status=1
      fi
    }
    for f in $FILES; do compare "$st/bin/$f" "$bin/$f"; done
    for f in $LEGACY; do
      if [ -e "$bin/$f" ]; then echo "STALE   $bin/$f: a removed hook's file (ADR-0028, ADR-0013); --apply deletes it"; status=1; fi
    done
    if [ -e "$switches" ]; then echo "STALE   $switches: removed by ADR-0028; --apply deletes it"; status=1; fi
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
    mkdir -p "$bin" "$claude_dir" "$(dirname "$codex_file")"
    chmod 755 "$base" "$bin"
    put() { # $1 source, $2 destination, $3 mode: atomic replace, root-owned on a real run
      cp "$1" "$2.new.$$"
      chmod "$3" "$2.new.$$"
      [ -n "$root" ] || chown 0:0 "$2.new.$$"
      mv "$2.new.$$" "$2"
    }
    [ -n "$root" ] || chown 0:0 "$base" "$bin"
    for f in $FILES; do
      case $f in *.sh|*.py) m=755 ;; *) m=644 ;; esac
      put "$work/bin/$f" "$bin/$f" "$m"
    done
    put "$work/claude.json" "$claude_file" 644
    put "$work/requirements.toml" "$codex_file" 644
    # What an earlier release installed for the restart guard, the breaking-glass switches (ADR-0028)
    # and the HITL picker guard (ADR-0013, 2026-10-05 amendment).
    for f in $LEGACY; do rm -f "$bin/$f"; done
    rm -f "$switches"/*.json
    rmdir "$switches" 2>/dev/null || true
    echo "INSTALLED $bin, $claude_file, $codex_file"
    echo "THEN    as yourself: mhw install (./mhw install in a checkout); then open fresh Claude Code and Codex sessions"
    ;;
  remove)
    is_root_run || { echo "REFUSE  --remove needs administrator privilege (sudo)" >&2; exit 2; }
    for f in $FILES $LEGACY; do rm -f "$bin/$f"; done
    rm -f "$switches"/*.json "$claude_file"
    if [ -e "$codex_file" ] && ! codex_foreign; then rm -f "$codex_file"; fi
    rmdir "$switches" "$bin" "$base" 2>/dev/null || true
    echo "REMOVED the admin-layer hooks; run install.sh as yourself to restore the user-level ones"
    ;;
esac
