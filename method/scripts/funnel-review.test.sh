#!/usr/bin/env bash
# funnel-review.test.sh — does the analysis half distinguish NOT-COLLECTED from RAN, refuse to print
# a figure without its sample size, stay inside the cap, reach no network, and get named by the
# cadence carrier?
#
# Mutation-checked: every assertion below was verified to fail against a deliberately broken version
# of `scripts/funnel-review.sh` — not of this file — because an assertion that cannot fail is worse
# than none, and editing the checker only proves the checker responds to being edited. The mutations
# and the reds they produced are recorded in the pull request rather than here, where they would go
# stale.
#
# THE NETWORK TOOLS ARE STUBBED TO A RECORDER RATHER THAN REMOVED, deliberately — the same technique
# `hooks/scripts/cadence-notice.test.sh` uses and for the same reason. Removing `curl` and `gh` from
# PATH would make "the analysis half reaches no network" pass vacuously, which is the shape of a check
# whose pattern is dead. The recorder appends every invocation to a file, so the assertion reads a
# file that CAN be non-empty, and one case proves it can by invoking a stub directly.
#
# WHAT THIS SUITE CANNOT ASSERT, said here so no green is over-read:
#   * that a collection file is TRUE. `collected: yes` is an assertion by whoever wrote it; a driver
#     that invented its figures produces a byte-identical run to one that read them.
#   * that the rite RAN. Nothing observes a dispatch. The cap arm reads the LANDED artifacts, so a
#     period that was never reported is indistinguishable here from one that produced no findings.
#   * that the cadence line means the rite happens. The carrier NOTICES; it cannot dispatch.
#
# Run: bash scripts/funnel-review.test.sh

set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
SCRIPT="$HERE/funnel-review.sh"
FIXTURES="$HERE/fixtures/funnel-review"
STORE="$ROOT/docs/funnel-review"
CMD="$ROOT/commands/funnel-review.md"
RECORD="$ROOT/docs/loop-cadence.md"

pass=0
fail=0
ok()  { printf 'ok    %s\n' "$1"; pass=$((pass + 1)); }
bad() { printf 'FAIL  %s\n     %s\n' "$1" "$2"; fail=$((fail + 1)); }

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/root/docs/funnel-review/collected"
cp "$FIXTURES"/*.tsv "$work/root/docs/funnel-review/collected/" 2>/dev/null || true

# The recorder. Every stub writes its own name into one file; the file is what the no-network
# assertion reads, so the assertion has something that can be non-empty.
mkdir -p "$work/bin"
for tool in curl wget gh nc ssh open osascript; do
  printf '#!/usr/bin/env bash\nprintf "%s %%s\\n" "$*" >> "%s/calls"\nexit 0\n' "$tool" "$work" \
    > "$work/bin/$tool"
  chmod +x "$work/bin/$tool"
done

run() { ( export PATH="$work/bin:$PATH"; bash "$SCRIPT" "$1" --root "$work/root" 2>&1 ); }

ran_out="$(run 2000-02)"
nc_out="$(run 2000-03)"
absent_out="$(run 2999-99)"
first_out="$(run 2000-01)"
# #181: the internal-traffic states (2000-06 none, 2000-07 testing, 2000-08 active, 2000-09 outside the
# closed set), the language caveat and the literal lookup (2000-07 against 2000-06). Run here so the
# no-network arm covers them too.
none_out="$(run 2000-06)"
testing_out="$(run 2000-07)"
active_out="$(run 2000-08)"
bogus_out="$(run 2000-09)"

# The glob probe's run happens HERE, with the other four, so that the no-network assertion below
# covers it too — it is the run most likely to reach for something, since it is the only one executed
# from a foreign working directory. Its own assertions are arms 11 and 12, further down.
trap_dir="$work/trap"
mkdir -p "$trap_dir"
: > "$trap_dir/12345"
: > "$trap_dir/345"
ctl_star="$( cd "$trap_dir" && bash -c 'set -- 12*; printf %s "$1"' )"
ctl_qmark="$( cd "$trap_dir" && bash -c 'set -- 34?; printf %s "$1"' )"
glob_out="$( cd "$trap_dir" && export PATH="$work/bin:$PATH"; bash "$SCRIPT" 2000-05 --root "$work/root" 2>&1 )"

# ── 1 · the two literals, and a run of each in the same suite ─────────────────────────────────────
# This is #401's criterion 2 and it is the criterion that matters most: a rite that silently does
# nothing is indistinguishable from one that ran and found nothing unless the two print DIFFERENT
# strings. Both directions are asserted on both runs — presence AND absence — because a branch that
# prints both literals would satisfy a presence-only check on either.
lit_problems=""
printf '%s' "$ran_out" | grep -qx 'FUNNEL-REVIEW-RAN' \
  || lit_problems="$lit_problems
    the collected fixture did not print FUNNEL-REVIEW-RAN at column 0"
printf '%s' "$ran_out" | grep -q 'FUNNEL-REVIEW-NOT-COLLECTED' \
  && lit_problems="$lit_problems
    the collected fixture ALSO printed FUNNEL-REVIEW-NOT-COLLECTED"
printf '%s' "$absent_out" | grep -qx 'FUNNEL-REVIEW-NOT-COLLECTED' \
  || lit_problems="$lit_problems
    an absent collection file did not print FUNNEL-REVIEW-NOT-COLLECTED at column 0"
printf '%s' "$absent_out" | grep -q 'FUNNEL-REVIEW-RAN' \
  && lit_problems="$lit_problems
    an absent collection file ALSO printed FUNNEL-REVIEW-RAN"
if [ -z "$lit_problems" ]; then
  ok "literals — a collected period prints FUNNEL-REVIEW-RAN and only that; an absent one prints FUNNEL-REVIEW-NOT-COLLECTED and only that"
else
  bad "literals — did-not-run and ran-and-found-nothing are not distinguishable:$lit_problems" \
      "this is the whole residual the owner's route ruling named; without it the rite is silent on the one case it must not be silent on"
fi

# ── 2 · the findings section is ABSENT on the not-collected branch, not merely empty ──────────────
# An absent section and an empty one are different claims. Only the second means the surfaces were
# read, so the not-collected branch must not print the heading at all.
sec_problems=""
printf '%s' "$ran_out" | grep -q '^## Findings' \
  || sec_problems="$sec_problems
    the collected run printed no '## Findings' heading"
printf '%s' "$absent_out" | grep -q '^## Findings' \
  && sec_problems="$sec_problems
    the absent-collection run printed a '## Findings' heading, which reads as 'read and found nothing'"
printf '%s' "$nc_out" | grep -q '^## Findings' \
  && sec_problems="$sec_problems
    the 'collected: no' run printed a '## Findings' heading"
if [ -z "$sec_problems" ]; then
  ok "findings section — present when the surfaces were read, absent when they were not"
else
  bad "findings section — absent and empty have been collapsed:$sec_problems" "an empty section that says it is empty is a result; a missing one is a step that did not run"
fi

# ── 3 · a declared `collected: no` wins over anything else in the file ─────────────────────────────
# The 2000-03 fixture carries a figure line BELOW its `collected: no` declaration on purpose. If the
# declaration did not win, that number would be printed as a figure read from a surface nobody
# reached — a fabricated measurement, which is the worst output this script could produce.
nc_problems=""
printf '%s' "$nc_out" | grep -qx 'FUNNEL-REVIEW-NOT-COLLECTED' \
  || nc_problems="$nc_problems
    'collected: no' did not print FUNNEL-REVIEW-NOT-COLLECTED"
printf '%s' "$nc_out" | grep -q 'chrome-not-authenticated' \
  || nc_problems="$nc_problems
    the declared reason was not reported"
printf '%s' "$nc_out" | grep -q '999' \
  && nc_problems="$nc_problems
    a figure below a 'collected: no' declaration was printed anyway"
if [ -z "$nc_problems" ]; then
  ok "collected: no — the declaration wins, its reason is reported, and no figure below it is printed"
else
  bad "collected: no — the declaration is decoration:$nc_problems" "the driver is the only actor that can observe an unauthenticated browser; if its declaration does not win, nothing records that state"
fi

# ── 4 · every printed figure carries its sample size AND a ceiling clause ──────────────────────────
# #401's criterion 7. The ceiling clause is surface-aware — see the script's own header for why
# pasting the site's consent clause onto a platform-reported figure would be a false bound — so what
# is asserted is the LITERAL on every figure, not one fixed sentence.
fig_problems=""
fig_count=0
while IFS= read -r line; do
  case "$line" in
    '- figure:'*) continue ;;   # an unusable line, quoted verbatim under its own heading
  esac
  fig_count=$((fig_count + 1))
  printf '%s' "$line" | grep -q ' n=[0-9]' \
    || fig_problems="$fig_problems
    no sample size: $line"
  printf '%s' "$line" | grep -q 'consent-ceiling:' \
    || fig_problems="$fig_problems
    no ceiling clause: $line"
done < <(printf '%s\n' "$ran_out" | grep '^- ')

if [ "$fig_count" -lt 3 ]; then
  bad "figures — only $fig_count figure line(s) were read from the collected run" "the extraction broke; nothing was judged, and a green here would be an artifact of that"
elif [ -z "$fig_problems" ]; then
  ok "figures — all $fig_count printed figures carry 'n=<digits>' and a 'consent-ceiling:' clause"
else
  bad "figures — a figure was published without its bound:$fig_problems" "this repository's rule is that a number ships with what bounds it, or not at all"
fi

# ── 5 · an unusable line is reported as unusable, never as a figure ────────────────────────────────
# The 2000-02 fixture carries one line with no sample size and one whose sample size is not a number.
# Both must land under the unusable heading. A figure with no n is exactly the thing criterion 7
# forbids, and the silent way to satisfy criterion 7 is to drop such lines — which would delete
# evidence that a collection run came back malformed.
un_problems=""
printf '%s' "$ran_out" | grep -q '^## Unusable collection lines' \
  || un_problems="$un_problems
    no unusable-lines heading, although the fixture carries two malformed lines"
printf '%s' "$ran_out" | grep -q '^- figure: ga4 share-opens 5$' \
  || un_problems="$un_problems
    the line with no sample size was not quoted under the unusable heading"
printf '%s' "$ran_out" | grep -q 'sample size is not a number' \
  || un_problems="$un_problems
    the line whose sample size is not a number was not reported as such"
printf '%s' "$ran_out" | grep -E '^- (ga4|linkedin) · (share-opens|reactions) ' | grep -q . \
  && un_problems="$un_problems
    a malformed line was printed as a figure"
if [ -z "$un_problems" ]; then
  ok "unusable lines — reported verbatim under their own heading, and never promoted to a figure"
else
  bad "unusable lines — a malformed collection line was dropped or printed as a figure:$un_problems" "dropping it hides a malformed collection run; printing it publishes a number with no n"
fi

# ── 6 · the prior period is read, and its absence is REPORTED rather than implied ─────────────────
prior_problems=""
printf '%s' "$ran_out" | grep -q 'prior 2000-01 = 100 (n=100)' \
  || prior_problems="$prior_problems
    the 2000-02 report did not carry 2000-01's value for a metric present in both"
printf '%s' "$ran_out" | grep -q 'not measured in 2000-01' \
  || prior_problems="$prior_problems
    a metric absent from the prior period was not reported as absent from it"
printf '%s' "$first_out" | grep -q 'no prior period on record' \
  || prior_problems="$prior_problems
    the earliest period did not report that it has no baseline"
if [ -z "$prior_problems" ]; then
  ok "prior period — read from the store when it exists, and its absence is stated rather than left to be inferred"
else
  bad "prior period — the baseline is silent:$prior_problems" "a figure with no baseline that does not say so reads as a trend"
fi

# ── 7 · NO NETWORK, and the zero is a real zero ───────────────────────────────────────────────────
net_problems=""
if [ -s "$work/calls" ]; then
  net_problems="the recorder caught: $(tr '\n' ' ' < "$work/calls")"
fi
( export PATH="$work/bin:$PATH"; curl https://example.invalid >/dev/null 2>&1 )
if [ -n "$net_problems" ]; then
  bad "no network — the analysis half reached an external surface" "$net_problems"
elif [ -s "$work/calls" ]; then
  ok "no network — nine runs, one of them from a foreign working directory, made zero calls to curl/wget/gh/nc/ssh/open/osascript (recorder proven live by a direct invocation)"
else
  bad "no network — the recorder never records" "the emptiness above proves nothing; this is the vacuity case, not a pass"
fi

# ── 8 · the cap is a NUMBER, it is stated, and no landed artifact exceeds it ───────────────────────
# The half a shell CAN check. Nothing in this harness can count findings inside a model's prose; what
# it can count is `## Finding` headings in the artifacts that actually landed under the store root.
# A period that was never reported is invisible to this arm, and that is stated rather than implied.
cap="$(grep -m1 '^MAX_FINDINGS=' "$SCRIPT" | sed 's/^MAX_FINDINGS=//')"
cap_problems=""
case "$cap" in
  ''|*[!0-9]*) cap_problems="$cap_problems
    the cap is not a number: '$cap'" ;;
esac
printf '%s' "$ran_out" | grep -qE "^cap: $cap findings" \
  || cap_problems="$cap_problems
    the report does not state the cap"
if [ -d "$STORE" ] && [ -n "$cap" ]; then
  for f in "$STORE"/*.md; do
    [ -r "$f" ] || continue
    case "$(basename "$f")" in README.md) continue ;; esac
    n="$(grep -cE '^## Finding( |$)' "$f" || true)"
    [ "$n" -le "$cap" ] || cap_problems="$cap_problems
    ${f#"$ROOT"/} carries $n findings, above the cap of $cap"
  done
fi
if [ -z "$cap_problems" ]; then
  ok "cap — declared as the number $cap, stated in every report, and no landed artifact under docs/funnel-review/ exceeds it"
else
  bad "cap — the bound on how much work this rite can generate is not held:$cap_problems" "the rite's named failure is becoming a machine for generating work; the cap is the only thing standing against it"
fi

# ── 9 · no verdict, no decision field ─────────────────────────────────────────────────────────────
# #401's criterion 8. The literals below are this loop's own verdict vocabulary; a rite that emitted
# one would be a gate wearing a report's name.
verdict_problems=""
for lit in APPROVE-AND-MERGE APPROVE-PENDING-HUMAN APPROVE-EXECUTOR-BLOCKED REQUEST-CHANGES \
           gatekeeper-verdict harness-lead-verdict CONTENT-REVIEW-CLEAR permissionDecision; do
  for f in "$SCRIPT" "$CMD"; do
    [ -r "$f" ] || continue
    grep -qF -- "$lit" "$f" && verdict_problems="$verdict_problems
    ${f#"$ROOT"/} carries the verdict literal '$lit'"
  done
done
for f in "$SCRIPT" "$CMD"; do
  [ -r "$f" ] || continue
  grep -qE '^[[:space:]]*(decision|"decision")[[:space:]]*[:=]' "$f" \
    && verdict_problems="$verdict_problems
    ${f#"$ROOT"/} declares a 'decision' field"
done
if [ ! -r "$CMD" ]; then
  bad "no verdict — commands/funnel-review.md is not readable" "the command file is half the subject of this assertion; it did NOT run over it"
elif [ -z "$verdict_problems" ]; then
  ok "no verdict — neither the script nor the rite declares a verdict literal or a decision field"
else
  bad "no verdict — this rite is emitting something a gate would read:$verdict_problems" "marketing judgement has no ruler, and a gate with no ruler grades taste"
fi

# ── 11 · a glob metacharacter in a collected field is printed LITERALLY ────────────────────────────
# The blocker the gate found on #459, and the input class no arm here pointed at: `set -- $rest` does
# word splitting AND pathname expansion, so a field carrying `*`, `?` or a bracket class was replaced
# by whatever filenames matched in the process's working directory. The published figure became a
# function of where the script ran from, both paths exited 0, and nothing warned.
#
# THE TRAP IS PROVEN LIVE BEFORE THE INVARIANCE IS CLAIMED. Running from a directory with no matching
# file would pass whether or not the script is protected — the same vacuity as a check whose pattern is
# dead. So the probe directory is seeded with files that DO match, and a control split in that
# directory is asserted to expand, before the script's own output is read.
glob_problems=""
if [ "$ctl_star" != "12345" ] || [ "$ctl_qmark" != "345" ]; then
  bad "glob metacharacters — the probe directory does NOT expand a bare glob (control: '$ctl_star' '$ctl_qmark')" \
      "the trap is not live, so any invariance below would be vacuous; this assertion did NOT run"
else
  printf '%s' "$glob_out" | grep -q 'click-through-rate = 34?' \
    || glob_problems="$glob_problems
    the CURRENT period's value was not printed literally (the 'set -- \$rest' split)"
  printf '%s' "$glob_out" | grep -q 'prior 2000-04 = 12\*' \
    || glob_problems="$glob_problems
    the PRIOR period's value was not printed literally (the 'set -- \$pv' split)"
  printf '%s' "$glob_out" | grep -qE '(= |prior 2000-04 = )(12345|345)( |$)' \
    && glob_problems="$glob_problems
    a filename from the working directory was published as a figure"
  if [ -z "$glob_problems" ]; then
    ok "glob metacharacters — a '*' and a '?' in collected fields survive both splits verbatim, run from a directory where both DO expand (control proven)"
  else
    bad "glob metacharacters — the published figure is a function of the working directory:$glob_problems" \
        "no attacker is needed: a '*' in an analytics page path or a campaign name is ordinary, and the collection file is authored by whoever read those surfaces"
  fi
fi

# ── 12 · an unknown surface's ceiling REFUSES rather than asserting ────────────────────────────────
# The second defect the gate found: the ceiling default gave every unrecognised surface a positive
# claim — "the consent banner gates nothing there" — which is false for any site-side spelling outside
# the two the vocabulary knew. A default that asserts a bound it cannot know is worse than one that
# declines, because only the first is quotable.
unk_problems=""
printf '%s' "$glob_out" | grep -q 'gsc · clicks' \
  || unk_problems="$unk_problems
    the unknown-surface figure was not printed at all, so nothing was judged"
printf '%s' "$glob_out" | grep 'gsc · clicks' | grep -q 'consent-ceiling: UNDECLARED' \
  || unk_problems="$unk_problems
    an unrecognised surface did not get the UNDECLARED ceiling"
printf '%s' "$glob_out" | grep 'gsc · clicks' | grep -q 'gates nothing there' \
  && unk_problems="$unk_problems
    an unrecognised surface was told the consent banner gates nothing there, which nothing here knows"
printf '%s' "$glob_out" | grep 'ga4 · click-through-rate' | grep -q 'consenting sessions only' \
  || unk_problems="$unk_problems
    a KNOWN site-side surface lost its true clause, so the refusal was bought by weakening the vocabulary"
if [ -z "$unk_problems" ]; then
  ok "ceiling default — the surface vocabulary is closed, a known surface keeps its true clause, and an unknown one gets UNDECLARED rather than a claim"
else
  bad "ceiling default — it asserts a bound it cannot know:$unk_problems" "a fail-open default publishes a positive claim about a surface nothing here recognises"
fi

# ── 10 · (removed in mhw, #170) ────────────────────────────────────────────────────────────────
# The plugin's arm fired its `cadence-notice.sh` hook against the plugin's `docs/loop-cadence.md`.
# The workstation method carries no hooks (hooks only for existential risk), so there is no carrier
# here to fire; the rite's cadence is the retrospective's, by instruction.

# ── 12 · the candidate-rule shape rides only on the branch that has findings (#473) ──────────────
if printf '%s' "$ran_out" | grep -q '^    Candidate rule: ' \
   && printf '%s' "$ran_out" | grep -q '^    Evidence: ' \
   && ! printf '%s' "$nc_out" | grep -q 'Candidate rule' \
   && ! printf '%s' "$absent_out" | grep -q 'Candidate rule'; then
  ok "candidate rule — its shape is printed under Findings when the surfaces were read, and nowhere when they were not"
else
  bad "candidate rule — the shape is missing from RAN, or leaks into a not-collected report" \
      "a not-collected report carries no findings, so it cannot carry a candidate either"
fi

# ── 13 · (removed in mhw, #170) ────────────────────────────────────────────────────────────────
# The plugin's arm checked its cadence hook dates a RAN report. No hook here; see arm 10.

# ── 14 · the planning queue reads COLUMN-0 candidates, and a generated report holds none (#473) ────
# The owner ruled that candidates queue in their reports and are ruled at /sprint-planning, which reads
# them with the selector below. A report this script wrote must contain NO match (the printed template
# is indented, so it is guidance and not an open candidate), and the same report with one real
# column-0 candidate appended must match exactly TWO lines under the SAME selector: its `Candidate
# rule:` line and its `Evidence:` line. Both counts use "$q_sel" — the before-count alone cannot tell a
# real zero from a dead pattern, so the after-count is what calibrates it. That makes the "prints
# nothing" zero published in commands/funnel-review.md a real zero, and it fails in both directions.
# The selector is also asserted VERBATIM in both rites that publish it, so the string this arm
# calibrates is the string a reader runs, and the three copies cannot drift apart in silence.
q_sel='^(Candidate rule|Evidence|Ruled):'
q_report="$work/queue-2000-02.md"
printf '%s\n' "$ran_out" > "$q_report"
q_before="$(grep -cE "$q_sel" "$q_report" || true)"
printf 'Candidate rule: probe\nEvidence: figure: ga4 sessions 10 10\n' >> "$q_report"
q_after="$(grep -cE "$q_sel" "$q_report" || true)"
if printf '%s' "$ran_out" | grep -q 'until /sprint-planning' \
   && [ "$q_before" = "0" ] && [ "$q_after" = "2" ]; then
  ok "candidate queue — a generated report holds no column-0 candidate, the published selector finds an appended one's two lines, and the report names /sprint-planning"
else
  bad "candidate queue — the template reads as an open candidate, the selector is dead, or the queue is unnamed" \
      "before=$q_before after=$q_after (expected 0 and 2)"
fi
q_pub="grep -nE '$q_sel' docs/funnel-review/*.md"
q_missing=""
for q_doc in "$ROOT/commands/funnel-review.md" "$ROOT/commands/sprint-planning.md"; do
  grep -qF -- "$q_pub" "$q_doc" 2>/dev/null || q_missing="$q_missing ${q_doc#"$ROOT"/}"
done
if [ -z "$q_missing" ]; then
  ok "candidate queue — the selector this arm calibrates is published verbatim in both rites"
else
  bad "candidate queue — a rite no longer publishes the calibrated selector verbatim" "missing in:$q_missing"
fi

# ── 15 · with no --root, the root is the WORKING DIRECTORY's repository (mhw #170) ───────────────
# The method installs this script at user level, outside any repository. A default keyed on the
# script's own place would report on no repository at all, or on the wrong one; this arm runs a COPY of
# the script from outside every repository, with the working directory inside a throwaway one, and
# reads the commit line back.
mkdir -p "$work/elsewhere" "$work/consumer/docs/funnel-review/collected"
cp "$SCRIPT" "$work/elsewhere/funnel-review.sh"
git -C "$work/consumer" init -q 2>/dev/null
git -C "$work/consumer" config user.email t@example.invalid
git -C "$work/consumer" config user.name Tester
printf 'seed\n' > "$work/consumer/README.md"
git -C "$work/consumer" add -A >/dev/null 2>&1
git -C "$work/consumer" commit -q -m seed >/dev/null 2>&1
consumer_sha="$(git -C "$work/consumer" rev-parse HEAD)"
cwd_out="$( cd "$work/consumer" && export PATH="$work/bin:$PATH"; bash "$work/elsewhere/funnel-review.sh" 2999-99 2>&1 )"
if printf '%s' "$cwd_out" | grep -qx "commit: $consumer_sha"; then
  ok "default root — an installed copy reports on the working directory's repository"
else
  bad "default root — the report is not about the working directory's repository" \
      "expected commit $consumer_sha, got: $(printf '%s' "$cwd_out" | grep '^commit:' | head -1)"
fi

# ── 16 · the prior-period lookup matches surface and metric LITERALLY (#181) ────────────────────────
# The lookup used to interpolate the metric into a regular expression, so a metric carrying `.` matched
# a different metric in the prior period and published that metric's value as this one's baseline.
# 2000-06 measures only `readXdepth`; 2000-07 measures `read.depth`. The CONTROL proves the trap is
# live: read as a regular expression, the metric does match the prior line.
lit_ctl="$(grep -cE '^figure:[[:space:]]+ga4[[:space:]]+read.depth[[:space:]]' "$FIXTURES/2000-06.tsv" || true)"
if [ "$lit_ctl" != "1" ]; then
  bad "literal lookup — the control does not match, so the probe is not live (control: '$lit_ctl')" \
      "the fixture no longer carries a metric a regex reading would confuse; this assertion did NOT run"
elif printf '%s' "$testing_out" | grep 'ga4 · read.depth' | grep -q 'not measured in 2000-06' \
     && ! printf '%s' "$testing_out" | grep 'ga4 · read.depth' | grep -q 'prior 2000-06 = 7'; then
  ok "literal lookup — a metric carrying '.' does not take another metric's value as its baseline (regex control proven live)"
else
  bad "literal lookup — the baseline of one metric was read from another" \
      "$(printf '%s' "$testing_out" | grep 'ga4 · read.depth')"
fi

# ── 17 · a figure qualified by language carries the language caveat, and only such a figure (#181) ──
# `<metric>:<piece>:<language>` is the qualified spelling. A link pinned to one language sets that
# value by the link, not by the reader, so the caveat rides on the line, beside the consent ceiling.
caveat='locale-caveat: a link pinned to one language sets this value by the link, not by the reader'
cav_problems=""
printf '%s' "$testing_out" | grep 'ga4 · reads:piece-a:en ' | grep -qF -- "$caveat" \
  || cav_problems="$cav_problems
    the language-qualified figure did not carry the caveat"
printf '%s' "$testing_out" | grep 'ga4 · reads:piece-a:en ' | grep -q 'consent-ceiling:' \
  || cav_problems="$cav_problems
    the language-qualified figure lost its consent ceiling"
printf '%s' "$testing_out" | grep -q 'ga4 · sessions ' \
  || cav_problems="$cav_problems
    the unqualified figure was not printed, so its absence of a caveat proves nothing"
printf '%s' "$testing_out" | grep 'ga4 · sessions ' | grep -q 'locale-caveat:' \
  && cav_problems="$cav_problems
    a whole-site, unqualified figure carried the language caveat"
if [ -z "$cav_problems" ]; then
  ok "language caveat — present on a <metric>:<piece>:<language> figure, absent on an unqualified one"
else
  bad "language caveat — the per-language bound is missing or misplaced:$cav_problems" \
      "a per-language figure read off a pinned link measures the link, and the line must say so where it is quoted"
fi

# ── 18 · the internal-traffic state is DECLARED in the header, or the header says it is not (#181) ──
# Three declared states, an absent line, and a line outside the closed set. Each is read off the
# report header, i.e. above the RAN/NOT-COLLECTED literal.
header() { printf '%s\n' "$1" | sed -n '1,/^FUNNEL-REVIEW-/p'; }
undeclared="internal-traffic: UNDECLARED — figures may include the owner's own sessions"
it_problems=""
header "$none_out" | grep -qx 'internal-traffic: none 2000-06-01 no internal-traffic marking exists on the property (synthetic)' \
  || it_problems="$it_problems
    the 'none' declaration was not printed verbatim in the header"
header "$testing_out" | grep -qx 'internal-traffic: testing-excluded-by-query 2000-07-01 the query excludes marked sessions while the filter is in Testing (synthetic)' \
  || it_problems="$it_problems
    the 'testing-excluded-by-query' declaration was not printed verbatim in the header"
header "$active_out" | grep -qx 'internal-traffic: active 2000-08-15 the property'"'"'s data filter excludes marked sessions (synthetic)' \
  || it_problems="$it_problems
    the 'active' declaration was not printed verbatim in the header"
header "$ran_out" | grep -qxF -- "$undeclared" \
  || it_problems="$it_problems
    a collection file with no internal-traffic line did not print the UNDECLARED line in the header"
header "$bogus_out" | grep -qF -- "$undeclared" \
  || it_problems="$it_problems
    a state outside the closed set was not reported as UNDECLARED"
header "$bogus_out" | grep -qx 'internal-traffic: probably-filtered.*' \
  && it_problems="$it_problems
    a state outside the closed set was printed as if it were a declaration"
for o in "$none_out" "$testing_out" "$active_out"; do
  header "$o" | grep -q 'UNDECLARED' && it_problems="$it_problems
    a declared state was ALSO reported as UNDECLARED"
done
if [ -z "$it_problems" ]; then
  ok "internal traffic — none, testing-excluded-by-query and active print verbatim in the header; an absent or unknown state prints UNDECLARED"
else
  bad "internal traffic — the filter state is assumed rather than declared:$it_problems" \
      "a figure that may include the owner's own sessions must say so where it is read"
fi

# ── 18b · a valid state with a missing part, and a four-part metric, are not declarations (#181) ─────
# Table-driven. Each row is one collection file written into its own throwaway root, so no reserved
# fixture name is used and no row is another row's prior period. A row reads: the label, what the
# report must show (`undeclared` in the header, or `no-caveat` on the named figure while a three-part
# control in the same file keeps its caveat), and the collection lines. These runs come after arm 7,
# so the no-network arm does not cover them; they reach for nothing the earlier runs did not.
rows=(
  "a valid state with no effective date|undeclared|internal-traffic: active"
  "a valid state with a date but no <how>|undeclared|internal-traffic: active 2000-08-15"
  "a four-part metric <metric>:<piece>:<language>:extra|no-caveat|figure: ga4 reads:piece-a:en:extra 4 6"
)
row_problems=""
row_n=0
for row in "${rows[@]}"; do
  row_n=$((row_n + 1))
  label="${row%%|*}"; rest_row="${row#*|}"
  expect="${rest_row%%|*}"; body="${rest_row#*|}"
  row_root="$work/rows/$row_n"
  mkdir -p "$row_root/docs/funnel-review/collected"
  printf 'collected: yes 2000-10-31 synthetic row\n%s\nfigure: ga4 reads:piece-a:en 4 6\n' "$body" \
    > "$row_root/docs/funnel-review/collected/row.tsv"
  row_out="$( export PATH="$work/bin:$PATH"; bash "$SCRIPT" row --root "$row_root" 2>&1 )"
  case "$expect" in
    undeclared)
      header "$row_out" | grep -q '^internal-traffic: UNDECLARED' \
        || row_problems="$row_problems
    row $row_n ($label): the header did not print UNDECLARED"
      ;;
    no-caveat)
      metric="$(printf '%s' "$body" | awk '{print $3}')"
      printf '%s\n' "$row_out" | grep -qF "ga4 · $metric " \
        || row_problems="$row_problems
    row $row_n ($label): the figure was not printed, so its missing caveat proves nothing"
      printf '%s\n' "$row_out" | grep -F "ga4 · $metric " | grep -q 'locale-caveat:' \
        && row_problems="$row_problems
    row $row_n ($label): a four-part metric carried the language caveat"
      printf '%s\n' "$row_out" | grep -F 'ga4 · reads:piece-a:en ' | grep -q 'locale-caveat:' \
        || row_problems="$row_problems
    row $row_n ($label): the three-part control in the same file lost its caveat"
      ;;
  esac
done
if [ -z "$row_problems" ]; then
  ok "incomplete declarations — a state with no date or no <how> prints UNDECLARED; a four-part metric carries no language caveat"
else
  bad "incomplete declarations — a partial line was read as a declaration:$row_problems" \
      "the contract requires the date and the <how>, and declares only the three-part metric spelling"
fi

# ── 19 · the store contract ships with the method, and the rite cites it (#181) ─────────────────────
contract="$HERE/funnel-review-contract/README.md"
ct_problems=""
[ -r "$contract" ] || ct_problems="$ct_problems
    $contract is missing"
grep -qF 'method/scripts/funnel-review-contract/README.md' "$CMD" \
  || ct_problems="$ct_problems
    the rite does not cite the contract"
# Spelled in two halves so that AC1's own check, a git grep for the whole string under method/, can
# return nothing while this arm still looks for it.
grep -qF 'docs/funnel-review/README''.md' "$CMD" \
  && ct_problems="$ct_problems
    the rite still names the consumer store's README as the contract"
for lit in 'collected:' 'figure:' 'internal-traffic:' 'locale-caveat:' '<metric>:<piece>:<language>' \
           'testing-excluded-by-query' 'UNDECLARED' '2000-01'; do
  grep -qF -- "$lit" "$contract" 2>/dev/null || ct_problems="$ct_problems
    the contract does not declare '$lit'"
done
if [ -z "$ct_problems" ]; then
  ok "contract — method/scripts/funnel-review-contract/README.md declares every line the script reads, and the rite cites it"
else
  bad "contract — the parsing contract is missing, incomplete or not cited:$ct_problems" \
      "a store whose contract lives only in a deprecated repository has no contract an installed rite can read"
fi

printf '\n%s passed, %s failed\n' "$pass" "$fail"
[ "$fail" -eq 0 ]
