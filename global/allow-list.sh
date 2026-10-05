# shellcheck shell=sh disable=SC2154
# (SC2154: the variables named below are assigned by install.sh, which sources this file.)
# The allow-list rendering step (Issue #83, ADR-0031). Sourced by install.sh after the deny floor is
# parsed; it uses install.sh's variables (mode, work, stamp, settings, managed_root, overlay, script_dir,
# floor_claude, floor_codex, MARKER_ID) and helpers (is_managed, same, stamp_of, raise).
#
# One source (allow-list.conf, plus overlay/allow-list.conf when present) is rendered natively at USER
# level: Claude Code permissions.allow and permissions.defaultMode, a Codex rules file of allow prefix
# rules and a profile file ($CODEX_HOME/workstation.config.toml, used with codex --profile workstation;
# Codex 0.160.0 refuses a [profiles.*] table in config.toml as legacy), and a Kiro agent file. The WIDE tier is
# rendered for a harness only while the admin deny floor is complete for it; otherwise NARROW, and one
# RISK line says so. Nothing here writes the admin layer, and deny always beats allow (ADR-0031).

ALLOW_OWN_KEY="personal-multi-harness-workstation-configuration-owned-allow"
ALLOW_PROFILE="workstation"
allow_src="$script_dir/allow-list.conf"
allow_codex_rules="${CODEX_HOME:-$HOME/.codex}/rules/workstation-allow-list.rules"
allow_codex_profile="${CODEX_HOME:-$HOME/.codex}/workstation.config.toml"
allow_kiro_agent="$HOME/.kiro/agents/workstation.json"

# Parse and validate. Output: $work/allow.<tier>.<kind>, one word list per line. An entry that is a word
# prefix of a floor entry, or that a floor entry covers, stops the run before anything is written.
allow_parse() {
  [ -f "$allow_src" ] || { echo "source not found: $allow_src" >&2; exit 2; }
  cat "$allow_src" > "$work/allow.conf"
  if [ -n "$overlay" ] && [ -f "$overlay/allow-list.conf" ]; then
    cat "$overlay/allow-list.conf" >> "$work/allow.conf"
  fi
  for t in narrow wide; do for k in cmd runner deny; do : > "$work/allow.$t.$k"; done; done
  if ! awk -v dir="$work" -v floor="$floor_codex" '
      BEGIN { while ((getline line < floor) > 0) { nf++; fl[nf] = line } }
      function prefix(a, b,   na, nb, x, y, i) { # 1 when word list a is a word prefix of b
        na = split(a, x, " "); nb = split(b, y, " ")
        if (na > nb) return 0
        for (i = 1; i <= na; i++) if (x[i] != y[i]) return 0
        return 1
      }
      function listed(list, w,   e, k, n) { # the first member of list that is a word prefix of w, or ""
        n = split(list, e, "|")
        for (k = 1; k <= n; k++) if (prefix(e[k], w)) return e[k]
        return ""
      }
      { sub(/\r$/, "") }
      /^[ \t]*(#|$)/ { next }
      {
        why = ""
        if ($1 != "narrow" && $1 != "wide") why = "tier must be narrow or wide"
        else if ($2 != "cmd" && $2 != "runner" && $2 != "deny") why = "kind must be cmd, runner or deny"
        else if (NF < 3) why = "no words"
        w = $3; for (i = 4; i <= NF; i++) w = w " " $i
        if (why == "" && $2 == "runner") {
          # A runner names ONE repository script, by relative path, through sh, bash or python3, with
          # no option but -B or -I: an exact suite, never the interpreter (ADR-0031, owner 2026-10-05).
          if ($1 != "wide") why = "a runner runs repository code, so it belongs to the wide tier only"
          else if ($3 !~ /^(sh|bash|python3)$/) why = "a runner starts with sh, bash or python3"
          else if ($NF !~ /^[A-Za-z0-9_-][A-Za-z0-9._-]*(\/[A-Za-z0-9_-][A-Za-z0-9._-]*)*\.(sh|py)$/ || $NF ~ /(^|\/)\.\.(\/|$)/)
            why = "a runner ends with one relative .sh or .py script path"
          for (i = 4; i < NF && why == ""; i++) if ($i != "-B" && $i != "-I") why = "a runner takes no option but -B or -I"
        } else {
          for (i = 3; i <= NF && why == ""; i++)
            if ($i !~ /^[A-Za-z0-9._~=:@+-]+$/) why = "word outside the allowed set (no path, no wildcard)"
        }
        if (why == "" && $2 == "cmd") {
          # A shell, an interpreter or a dispatcher runs anything it is handed: an allow on one is an
          # allow on everything, and an agent able to edit this list would grant itself the world.
          if ($3 ~ /^(bash|sh|dash|zsh|ksh|mksh|fish|csh|tcsh|busybox|env|xargs|eval|exec|source|command|builtin|nohup|time|nice|timeout|watch|script|sudo|doas|su|python[0-9.]*|pypy[0-9.]*|node|nodejs|deno|bun|perl[0-9.]*|ruby|irb|php|lua|tclsh|osascript|awk|gawk|nawk|find|make|npm|npx|pnpm|yarn|pytest|cargo|go)$/)
            why = "the program \"" $3 "\" runs whatever it is given (a shell, an interpreter, a dispatcher or a project-code runner)"
          # An option before the subcommand reaches every subcommand, and "git -c" sets core.pager,
          # core.sshCommand or an alias that runs any program: the second word must be a subcommand
          # (Issue #65; "git -C" and "gh -R" widen the prefix past every per-subcommand pin).
          else if (($3 == "git" || $3 == "gh") && NF >= 4 && $4 ~ /^-/)
            why = "\"" $3 " " $4 "\" is an option before the subcommand: it reaches every subcommand (and \"git -c\" can run any program)"
          # Never in any tier: each runs, publishes or writes through its own options or arguments.
          else if ((e = listed("git worktree add|git config|git archive|git format-patch|git am|git apply|git pull|gh issue comment|gh issue create|gh issue edit|gh pr comment|gh pr create|gh pr edit|gh pr review|gh gist|gh api|gh extension|gh alias", w)) != "")
            why = "\"" e "\" takes an option or argument that reads or writes any path, runs a program or publishes"
          # The read and build routes are the WIDE tier only (owner, 2026-10-05): the narrow tier stays read-only.
          else if ($1 == "narrow" && (e = listed("git diff|git log|git show|git grep|git blame|git ls-files|git branch|git fetch|git add|git commit", w)) != "")
            why = "\"" e "\" has options that read or write any path, so it is wide-tier only"
          # Pinned natively: "git add --" ends option parsing; "git commit -m" makes git refuse -F/--file.
          else if (prefix("git add", w) && w != "git add --") why = "git add is pre-authorised only as \"git add --\""
          else if (prefix("git commit", w) && w != "git commit -m") why = "git commit is pre-authorised only as \"git commit -m\""
        }
        if (why == "" && $2 != "deny")
          for (j = 1; j <= nf && why == ""; j++) {
            if (prefix(w, fl[j])) why = "it covers the floor entry \"" fl[j] "\", which denies only part of that family"
            else if (prefix(fl[j], w)) why = "the floor entry \"" fl[j] "\" denies it, so it could never apply"
          }
        if (why != "") { printf "invalid allow-list entry (%s): %s\n", why, $0 > "/dev/stderr"; err = 1; next }
        print w >> (dir "/allow." $1 "." $2)
        if ($2 != "deny") n++
      }
      END { if (err) exit 1; if (!n) { print "the allow list has no entry" > "/dev/stderr"; exit 1 } }
    ' "$work/allow.conf"; then
    exit 2
  fi
}

# Is the admin deny floor complete for each harness? Same reading as report_floor in install.sh.
allow_admin_state() {
  if [ "$(uname -s)" = Darwin ]; then
    a_claude="$managed_root/Library/Application Support/ClaudeCode/managed-settings.d/50-personal-multi-harness-workstation-configuration.json"
  else
    a_claude="$managed_root/etc/claude-code/managed-settings.d/50-personal-multi-harness-workstation-configuration.json"
  fi
  a_codex="$managed_root/etc/codex/requirements.toml"
  allow_tier_claude=narrow
  allow_tier_codex=narrow
  a_want=$(jq -cR -s 'split("\n") | map(select(length > 0)) | unique' "$floor_claude")
  if [ -f "$a_claude" ] && [ "$(jq --argjson f "$a_want" '[(.permissions.deny? // [])[] | select(. as $r | $f | index($r))] | unique | length' "$a_claude" 2>/dev/null || echo 0)" -eq "$(printf '%s' "$a_want" | jq length)" ]; then
    allow_tier_claude=wide
  fi
  if [ -f "$a_codex" ] && is_managed "$a_codex"; then
    sed -n 's/^ *{ pattern = \[\(.*\)\], decision = "forbidden".*/\1/p' "$a_codex" \
      | sed -e 's/{ token = "\([^"]*\)" }/\1/g' -e 's/, / /g' > "$work/allow.codex.admin"
    if [ "$(grep -cxF -f "$floor_codex" "$work/allow.codex.admin" || true)" -eq "$(grep -c . "$floor_codex" || true)" ]; then
      allow_tier_codex=wide
    fi
  fi
}

allow_words() { # $1 tier, $2 kind(s): the word lists rendered for that tier (narrow is always included)
  for k in $2; do
    cat "$work/allow.narrow.$k"
    [ "$1" = wide ] && cat "$work/allow.wide.$k"
  done
  return 0
}

# ---- Claude Code: a union merge into ~/.claude/settings.json, with ownership like the deny floor's.
# The files that decide what is pre-authorised. An Edit/Write deny for each, in every tier, so an agent
# cannot widen its own list with an edit (Claude Code only: Codex has no file rule, Kiro no floor).
# "//" is Claude Code's absolute-path form, "~/" its home form; the checkout's path is resolved here,
# so the source rules cover only the checkout that ran this installer, never another clone or worktree.
# shellcheck disable=SC2088 # the tilde is Claude Code rule syntax, written literally, never expanded
allow_protect() {
  codex_dir="${CODEX_HOME:-$HOME/.codex}"
  case $codex_dir in "$HOME"/*) codex_rule="~/${codex_dir#"$HOME"/}" ;; *) codex_rule="/$codex_dir" ;; esac
  for r in "~/.claude/settings.json" "$codex_rule/rules/**" "$codex_rule/config.toml" "$codex_rule/*.config.toml" \
      "~/.kiro/agents/**" "/$repo_root/global/allow-list.conf" "/$repo_root/overlay/**" \
      "**/.git/config" "**/.git/hooks/**"; do
    printf 'Edit(%s)\n' "$r"
  done
}

allow_claude_render() { # $1 tier, $2 input settings, $3 output
  ac_want=$(allow_words "$1" "cmd runner" | jq -cR -s 'split("\n") | map(select(length > 0) | "Bash(" + . + ":*)")')
  ac_protect=$({ allow_protect; allow_words "$1" deny | sed 's/.*/Bash(&:*)/'; } | jq -cR -s 'split("\n") | map(select(length > 0))')
  ac_mode=null
  [ "$1" = wide ] && ac_mode='"acceptEdits"'
  jq --indent 4 --arg ok "$ALLOW_OWN_KEY" --argjson w "$ac_want" --argjson m "$ac_mode" --argjson pd "$ac_protect" '
    if (.permissions != null and (.permissions | type) != "object")
       or (.permissions.allow? != null and (.permissions.allow | type) != "array")
       or (.permissions.deny? != null and (.permissions.deny | type) != "array")
       or (.hooks != null and (.hooks | type) != "object")
    then error("permissions has an unexpected shape") else . end
    | ((.[$ok] // {}) | if type == "object" then . else {} end) as $o
    | ($o.allow // []) as $prev
    | ($o.defaultMode // null) as $pmode
    | ((.permissions.allow // []) | map(select(. as $r | (($prev | index($r)) and (($w | index($r)) | not)) | not))) as $a1
    | ([$w[] | . as $r | select(($a1 | index($r)) | not)]) as $add
    | ([$prev[] | . as $r | select($w | index($r))] + $add) as $own
    | (.permissions.defaultMode // null) as $cur
    | (if $m != null and ($cur == null or $cur == $pmode) then $m
       elif $m == null and $cur != null and $cur == $pmode then null
       else $cur end) as $mode
    | (if $m != null and $mode == $m and ($cur == null or $cur == $pmode) then $m else null end) as $omode
    | .permissions = ((.permissions // {}) | .allow = ($a1 + $add)
        | if .allow == [] then del(.allow) else . end
        | if $mode == null then del(.defaultMode) else .defaultMode = $mode end)
    | ($o.deny // []) as $pdeny
    | ((.permissions.deny // []) | map(select(. as $r | (($pdeny | index($r)) and (($pd | index($r)) | not)) | not))) as $d1
    | ([$pd[] | . as $r | select(($d1 | index($r)) | not)]) as $dadd
    | ([$pdeny[] | . as $r | select($pd | index($r))] + $dadd) as $downs
    | .permissions = (.permissions // {}) | .permissions.deny = ($d1 + $dadd)
    | if .permissions.deny == [] then del(.permissions.deny) else . end
    | if .permissions == {} then del(.permissions) else . end
    | if $own == [] and $omode == null and $downs == [] then del(.[$ok])
      else .[$ok] = {allow: $own, defaultMode: $omode, deny: $downs} end
  ' "$2" > "$3" 2>/dev/null
}

allow_claude() {
  cur="$work/allow.settings.json"
  if [ -e "$settings" ]; then
    jq -e 'type == "object"' "$settings" >/dev/null 2>&1 || return 0   # merge_settings already refused it
    cat "$settings" > "$cur"
  else
    echo '{}' > "$cur"
  fi
  if ! allow_claude_render "$allow_tier_claude" "$cur" "$work/allow.settings.want.json"; then
    echo "REFUSE  $settings: its permissions section has an unexpected shape; allow list not merged" >&2
    raise 3
    return 0
  fi
  allow_claude_render narrow "$cur" "$work/allow.settings.narrow.json"
  n_allow=$(jq '[.permissions.allow[]?] | length' "$work/allow.settings.want.json")
  mode_now=$(jq -r '.permissions.defaultMode // "default (none set)"' "$work/allow.settings.want.json")
  if [ "$allow_tier_claude" = wide ] && [ "$(jq -r '.permissions.defaultMode // ""' "$cur")" != "" ] \
     && [ "$(jq -r --arg ok "$ALLOW_OWN_KEY" '.[$ok].defaultMode // ""' "$cur")" = "" ] \
     && [ "$(jq -r '.permissions.defaultMode' "$cur")" != acceptEdits ]; then
    echo "NOTE    $settings: your own permissions.defaultMode ($(jq -r '.permissions.defaultMode' "$cur")) is kept; the recommended one is acceptEdits"
  fi
  if [ -e "$settings" ] && jq -e --slurpfile a "$work/allow.settings.want.json" '. == $a[0]' "$cur" >/dev/null 2>&1; then
    echo "OK      $settings (allow list: $allow_tier_claude tier, $n_allow allow rules; permission mode $mode_now)"
    return 0
  fi
  case $mode in
    check)
      if [ "$allow_tier_claude" = wide ] && jq -e --slurpfile a "$work/allow.settings.narrow.json" '. == $a[0]' "$cur" >/dev/null 2>&1; then
        echo "NOTE    $settings: the narrow allow list is installed; the admin floor is complete, so ./workstation install widens it"
      elif [ -e "$settings" ]; then
        echo "DRIFT   $settings (allow list or permission mode differs from the $allow_tier_claude tier)"
        raise 1
      fi
      ;;
    dry-run)
      echo "WOULD MERGE $settings: the $allow_tier_claude allow list ($n_allow rules) and permission mode $mode_now"
      jq -S . "$cur" > "$work/allow.before.json"
      jq -S . "$work/allow.settings.want.json" > "$work/allow.after.json"
      diff -u "$work/allow.before.json" "$work/allow.after.json" | sed '1,2d' || true
      ;;
    install)
      mkdir -p "$(dirname "$settings")"
      if [ -e "$settings" ]; then
        cp -p "$settings" "$settings.new.$$"
      fi
      cat "$work/allow.settings.want.json" > "$settings.new.$$"
      mv "$settings.new.$$" "$settings"
      echo "MERGED  $settings (allow list: $allow_tier_claude tier, $n_allow allow rules; permission mode $mode_now)"
      ;;
  esac
}

# ---- A managed file of ours (Codex rules, Kiro agent): written whole, never over an unmanaged file.
allow_place() { # $1 rendered file, $2 destination, $3 narrow rendering (for the widen note)
  if [ -e "$2" ] && ! is_managed "$2"; then
    echo "REFUSE  $2: exists and is NOT managed by this project; move it aside or merge it by hand" >&2
    raise 3
    return 0
  fi
  if [ -e "$2" ] && same "$1" "$2" && [ "$(stamp_of "$2")" = "$stamp" ]; then
    echo "OK      $2 ($stamp)"
    return 0
  fi
  case $mode in
    check)
      if [ -e "$2" ] && same "$1" "$2"; then
        echo "STAMP   $2: content matches, but it carries ($(stamp_of "$2")) and the source is ($stamp)"; raise 1
      elif [ -e "$2" ] && [ -n "$3" ] && same "$3" "$2"; then
        echo "NOTE    $2: the narrow allow list is installed; the admin floor is complete, so ./workstation install widens it"
      elif [ -e "$2" ]; then
        echo "DRIFT   $2 ($(stamp_of "$2"))"; raise 1
      else
        echo "MISSING $2"; raise 1
      fi
      ;;
    dry-run)
      echo "WOULD WRITE $2:"
      echo "----- begin $2"; cat "$1"; echo "----- end $2"
      ;;
    install)
      mkdir -p "$(dirname "$2")"
      cp "$1" "$2.new.$$"
      mv "$2.new.$$" "$2"
      echo "WROTE   $2 ($stamp)"
      ;;
  esac
}

allow_codex_rules_render() { # $1 tier, $2 output
  {
    printf '# %s; source: global/allow-list.conf; %s; do not edit, re-run the installer\n' "$MARKER_ID" "$stamp"
    printf '# The workstation allow list, %s tier (ADR-0031). A forbidden rule (the deny floor) beats an allow\n' "$1"
    printf '# rule whatever file holds it (measured, codex execpolicy check). Test runners have no rule here:\n'
    printf '# they run inside the workspace-write sandbox of the "%s" profile without one.\n' "$ALLOW_PROFILE"
    allow_words "$1" cmd | awk '{ printf "prefix_rule(pattern=["; for (i = 1; i <= NF; i++) printf "%s\"%s\"", (i > 1 ? ", " : ""), $i; print "], decision=\"allow\")" }'
    allow_words "$1" deny | awk '{ printf "prefix_rule(pattern=["; for (i = 1; i <= NF; i++) printf "%s\"%s\"", (i > 1 ? ", " : ""), $i; print "], decision=\"forbidden\")" }'
  } > "$2"
}

allow_codex_profile_render() { # $1 tier, $2 output
  sandbox=read-only
  [ "$1" = wide ] && sandbox=workspace-write
  {
    printf '# %s; source: global/allow-list.conf; %s; do not edit, re-run the installer\n' "$MARKER_ID" "$stamp"
    printf '# The workstation permission profile, %s tier (ADR-0031). Use it with: codex --profile %s\n' "$1" "$ALLOW_PROFILE"
    printf 'approval_policy = "on-request"\n'
    printf 'sandbox_mode = "%s"\n' "$sandbox"
  } > "$2"
}

allow_kiro_render() { # $2 output. Kiro carries no deny floor (ADR-0016), so it never gets the wide tier.
  allow_words narrow cmd | jq -R -s --arg d "$MARKER_ID; source: global/allow-list.conf; $stamp; do not edit, re-run the installer" '
    split("\n") | map(select(length > 0)) as $w
    | {name: "workstation",
       description: $d,
       tools: ["*"],
       allowedTools: ["fs_read"],
       toolsSettings: {execute_bash: {
         allowedCommands: [$w[] | "^" + gsub("(?<c>[.+])"; "\\\(.c)") + "( [^;&|<>$`(){}\\n\\r]*)?$"],
         autoAllowReadonly: false}}}' > "$1"
}

allow_step() {
  command -v jq >/dev/null 2>&1 || { echo "REFUSE  allow list: jq is required" >&2; raise 2; return 0; }
  allow_admin_state
  if [ "$allow_tier_claude" = narrow ] || [ "$allow_tier_codex" = narrow ]; then
    echo "RISK    admin deny floor incomplete (Claude Code: $allow_tier_claude, Codex: $allow_tier_codex tier): an allow list without the admin barrier is limited to reading; ./workstation install --admin, then install again, widens it"
  fi
  allow_claude
  allow_codex_rules_render "$allow_tier_codex" "$work/allow.rules"
  narrow_rules=
  if [ "$allow_tier_codex" = wide ]; then allow_codex_rules_render narrow "$work/allow.rules.narrow"; narrow_rules="$work/allow.rules.narrow"; fi
  allow_place "$work/allow.rules" "$allow_codex_rules" "$narrow_rules"
  allow_codex_profile_render "$allow_tier_codex" "$work/allow.profile"
  narrow_profile=
  if [ "$allow_tier_codex" = wide ]; then allow_codex_profile_render narrow "$work/allow.profile.narrow"; narrow_profile="$work/allow.profile.narrow"; fi
  allow_place "$work/allow.profile" "$allow_codex_profile" "$narrow_profile"
  allow_kiro_render "$work/allow.kiro.json"
  allow_place "$work/allow.kiro.json" "$allow_kiro_agent" ""
  echo "ALLOW   Claude Code: $allow_tier_claude tier · Codex: $allow_tier_codex tier, profile $ALLOW_PROFILE · Kiro: narrow tier, agent workstation (no deny floor there)"
}

# Uninstall: our files go, and only the allow rules and permission mode this
# installer added leave settings.json (a rule the owner wrote himself stays).
allow_uninstall() {
  for u in "$allow_codex_rules" "$allow_codex_profile" "$allow_kiro_agent"; do
    if [ -f "$u" ] && is_managed "$u"; then rm -f "$u"; echo "REMOVED $u"
    elif [ -e "$u" ]; then echo "NOTE    $u exists and is NOT managed by this project; left alone"; fi
  done
  [ -f "$settings" ] && command -v jq >/dev/null 2>&1 || return 0
  if jq -e --arg ok "$ALLOW_OWN_KEY" 'type == "object" and has($ok)' "$settings" >/dev/null 2>&1; then
    jq --indent 4 --arg ok "$ALLOW_OWN_KEY" '
      (.[$ok].allow // []) as $mine | (.[$ok].defaultMode // null) as $m | (.[$ok].deny // []) as $mdeny
      | if (.permissions.allow? | type) == "array" then
          .permissions.allow |= map(select(. as $r | $mine | index($r) | not))
          | if .permissions.allow == [] then del(.permissions.allow) else . end
        else . end
      | if $m != null and .permissions.defaultMode? == $m then del(.permissions.defaultMode) else . end
      | if (.permissions.deny? | type) == "array" then
          .permissions.deny |= map(select(. as $r | $mdeny | index($r) | not))
          | if .permissions.deny == [] then del(.permissions.deny) else . end
        else . end
      | if .permissions == {} then del(.permissions) else . end
      | del(.[$ok])' "$settings" > "$settings.new.$$" && mv "$settings.new.$$" "$settings"
    echo "UNMERGED $settings (the allow rules and permission mode this installer added)"
  fi
}
