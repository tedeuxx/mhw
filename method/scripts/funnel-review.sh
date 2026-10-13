#!/usr/bin/env bash
# funnel-review.sh — the ANALYSIS half of the content-funnel rite (#401).
#
# ── WHAT IT IS, AND THE ONE SENTENCE IT MUST NOT BE READ PAST ────────────────────────────────────
#
# It is a REPORT WRITER over a committed collection file. It reads no network, holds no credential,
# and reaches no external surface — every figure it prints was put in the collection file by a human
# or by a driver reading the owner's own already-authenticated browser. It returns no verdict, it
# gates nothing, and every exit path but a caller error is success.
#
# THIS IS NOT A HOOK AND IS NOT IN `hooks/scripts/` FOR A REASON — the same reason
# `scripts/milestone-create.py` states in its own header: nothing registers it in `hooks/hooks.json`,
# and any `*.sh` under `hooks/scripts/` declaring a `# purpose:` line is read by the inventory gate as
# a mechanism that must be registered, so an unregistered script there is either an orphan (red) or a
# mechanism pretending not to be one.
#
# ── THE DISTINCTION THIS FILE EXISTS FOR ─────────────────────────────────────────────────────────
#
# The rite's collection route is the owner's authenticated Chrome (owner ruling, 2026-09-10:
# «hoje o chrome do host esta autenticado. o claude in chrome consegue acessar.»). So the rite is
# CONDITIONALLY collectable: with no authenticated browser it reads nothing. A rite that quietly does
# nothing is indistinguishable from a rite that ran and found nothing — this repository's own named
# worst shape — so the two states print DIFFERENT LITERALS at column 0:
#
#   FUNNEL-REVIEW-NOT-COLLECTED   nothing was read. There is no findings section at all.
#   FUNNEL-REVIEW-RAN             the surfaces were read. The findings section exists, and may say it
#                                 is empty — an empty section that says so is a result.
#
# Neither literal is a substring of the other, so a grep for one cannot be satisfied by the other.
#
# ── WHAT IT CANNOT DO, SAID BEFORE ANY GREEN IS READ ─────────────────────────────────────────────
#
#   * It cannot tell a TRUE collection file from a plausible one. `collected: yes` is an assertion by
#     whoever wrote the file; nothing here verifies that a browser was ever opened. A driver that
#     invented its figures produces a byte-identical run to one that read them.
#   * It cannot fire. Nothing dispatches this rite — see `commands/funnel-review.md`'s own last
#     section. `hooks/scripts/cadence-notice.sh` NOTICES that the artifact is stale; noticing is not
#     firing, and a hook cannot dispatch.
#   * It cannot count findings in prose. The cap below is printed into the report; the arm that
#     enforces it reads the LANDED artifact (`scripts/funnel-review.test.sh`), so a run that never
#     wrote a file is invisible to it.
#
# Contract: prints the report body on stdout, exits 0. Exits 2 only on a caller error (no period).
#
# Usage: bash scripts/funnel-review.sh <period> [--root <dir>]

set -uo pipefail

# The cap, as a NUMBER, the way `commands/sprint-retrospective.md` caps a persona at two. Two and not
# three: the prototype session produced three tracked items from one sitting, and a rite producing
# three items per period is a machine for generating work — which is the failure this loop names
# first. The cap is the ceiling, never a quota.
MAX_FINDINGS=2

# The consent ceiling rides with EVERY figure rather than being stated once under the table. A clause
# stated once is read once; a reader quoting a single line out of this report into a slide takes the
# number and leaves the bound behind.
#
# IT IS SURFACE-AWARE, AND THAT IS A DELIBERATE NARROWING OF #401's CRITERION 7 RATHER THAN A MISS.
# The criterion says every figure carries "the consent-ceiling clause". Pasting the site's clause onto
# a platform-reported figure would be FALSE: the consent banner gates this site's analytics and gates
# nothing on LinkedIn. So the literal `consent-ceiling:` is on every figure — the criterion's
# checkable half — and its TEXT states the bound that actually applies to that surface. A true clause
# on the wrong surface is a false bound wearing the right word, which is worse than a missing one
# because it reads as having been thought about.
#
# THE VOCABULARY IS CLOSED AND THE DEFAULT REFUSES — both, and the second is the one that matters.
# The first form of this function gave the site's clause to two names and asserted "the consent banner
# gates nothing there" for EVERY other string, which is a **fail-open default**: `ga`, `site-analytics`
# and `gsc` are all plausible spellings of a site-side surface, and each of them would have been
# published with a positive claim that no consent gate applies. Found by the gate on #459. A default
# that asserts a bound it cannot know is worse than one that declines to state a bound, because only
# the first is quotable.
ceiling_for() {
  case "$1" in
    ga4|site)
      printf 'consent-ceiling: consenting sessions only — the consent banner gates analytics on this site, so a reader who declined is invisible by design' ;;
    linkedin|x)
      printf 'consent-ceiling: does not apply to %s — this figure is platform-reported, the consent banner gates nothing there, and the platform'"'"'s own sampling is unstated and unverifiable from here' "$1" ;;
    *)
      printf 'consent-ceiling: UNDECLARED for surface %s — it is not in this store'"'"'s closed surface vocabulary, so nothing here knows whether a consent gate applies to it. Read the figure as unbounded, and declare the surface before quoting it' "$1" ;;
  esac
}

period="${1:-}"
if [ -z "$period" ]; then
  printf 'usage: funnel-review.sh <period> [--root <dir>]\n' >&2
  exit 2
fi
shift

ROOT=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --root) ROOT="${2:-}"; shift 2 || exit 2 ;;
    *) printf 'unknown argument: %s\n' "$1" >&2; exit 2 ;;
  esac
done

if [ -z "$ROOT" ]; then
  here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  ROOT="$(git -C "$here" rev-parse --show-toplevel 2>/dev/null || true)"
  [ -n "$ROOT" ] || ROOT="$(cd "$here/.." && pwd)"
fi

STORE="$ROOT/docs/funnel-review"
COLLECTED_DIR="$STORE/collected"
collection="$COLLECTED_DIR/$period.tsv"

# `git rev-parse` is a LOCAL read of a local object database. It is the only external command this
# script runs, and it is named here so that "no network" is a claim a reader can check against the
# source rather than against this comment.
sha="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || true)"
[ -n "$sha" ] || sha="unknown"

printf '# %s — funnel review\n\n' "$period"
printf 'commit: %s\n' "$sha"
printf 'collection: %s\n' "${collection#"$ROOT"/}"
printf 'cap: %s findings, the ceiling and not a quota\n\n' "$MAX_FINDINGS"

# ── the NOT-COLLECTED branch ─────────────────────────────────────────────────────────────────────
# Reached two ways, and both are reported with their reason: no collection file at all, or a file
# whose own `collected:` declaration says the surfaces were not read. The second exists because the
# ruled route depends on a browser being open and authenticated, which is a condition the driver can
# observe and this script cannot.
not_collected() {
  printf 'FUNNEL-REVIEW-NOT-COLLECTED\n\n'
  printf 'Nothing was read this period. Reason: %s\n\n' "$1"
  printf 'This is NOT "the funnel is healthy" and it is NOT "no findings". No surface was reached,\n'
  printf 'so this report makes no claim about the funnel at all. The collection route is the owner'"'"'s\n'
  printf 'own authenticated browser (owner ruling, 2026-09-10); with no authenticated session there is\n'
  printf 'nothing to read, and nothing in this harness can open one.\n\n'
  printf 'There is deliberately no findings section below — a findings section that is absent and one\n'
  printf 'that is empty are different claims, and only the second means the surfaces were read.\n'
  exit 0
}

declared=""
if [ -r "$collection" ]; then
  declared="$(sed -nE 's/^collected:[[:space:]]+(.+)$/\1/p' "$collection" | head -1)"
fi

if [ ! -r "$collection" ]; then
  not_collected "no collection file at that path"
fi

case "$declared" in
  yes*) : ;;
  no*)  not_collected "the collection file declares 'collected: ${declared}'" ;;
  *)    not_collected "the collection file declares no 'collected:' line at column 0, so it asserts nothing about whether the surfaces were read" ;;
esac

# ── the RAN branch ───────────────────────────────────────────────────────────────────────────────
printf 'FUNNEL-REVIEW-RAN\n\n'
printf 'The surfaces were read and this report is the analysis of what came back. Every figure below\n'
printf 'carries its sample size and its consent ceiling; a figure that arrived without a sample size is\n'
printf 'listed as unusable rather than printed as a figure.\n\n'

# The prior period: the greatest collected period name lexically BELOW this one. Lexical rather than
# chronological on purpose — period names in this store are sortable by construction (`sprint-02`,
# `2026-09`), and a date parser here would be a second contract nobody declared.
prior=""
for f in "$COLLECTED_DIR"/*.tsv; do
  [ -r "$f" ] || continue
  b="$(basename "$f" .tsv)"
  [ "$b" = "$period" ] && continue
  if [ "$b" \< "$period" ]; then
    [ -z "$prior" ] && prior="$b"
    [ "$b" \> "$prior" ] && prior="$b"
  fi
done

# ── PATHNAME EXPANSION OFF, FROM HERE TO THE END OF THE SCRIPT ───────────────────────────────────
# The two `set --` splits below are how a `figure:` line is cut into fields, and `set -- $rest` does
# TWO things in bash, not one: word splitting, which is wanted, and pathname expansion, which is not.
# A field containing `*`, `?` or a bracket class is replaced by whatever filenames happen to match in
# the process's working directory — so the published figure becomes a function of where the script was
# run from, both paths exit 0, and nothing warns.
#
# THIS NEEDS NO ATTACKER, which is why it is a defect and not a hypothetical: a `*` in an analytics
# page path or a campaign name is ordinary, and this collection file is authored by whoever read those
# surfaces. Found by the gate on #459; the disable comment that used to sit on those two lines is the
# tell it named — the splitting was decided and the globbing was not, which is an unconscious fail-open
# rather than a trade.
#
# `set -f` must come AFTER the prior-period loop above, which needs its glob, and it stays on to the
# end because nothing below expands a path.
set -f

printf '## Figures\n\n'

figures=0
unusable=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  rest="${line#figure: }"
  # shellcheck disable=SC2086   # splitting is wanted; globbing is off (`set -f` above)
  set -- $rest
  if [ "$#" -lt 4 ]; then
    unusable="$unusable
- $line"
    continue
  fi
  surface="$1"; metric="$2"; value="$3"; n="$4"
  case "$n" in ''|*[!0-9]*) unusable="$unusable
- $line   (sample size is not a number)"; continue ;; esac

  delta="no prior period on record"
  if [ -n "$prior" ]; then
    pv="$(sed -nE "s/^figure:[[:space:]]+$surface[[:space:]]+$metric[[:space:]]+([^[:space:]]+)[[:space:]]+([^[:space:]]+).*$/\1 \2/p" "$COLLECTED_DIR/$prior.tsv" 2>/dev/null | head -1)"
    if [ -n "$pv" ]; then
      # shellcheck disable=SC2086   # splitting is wanted; globbing is off (`set -f` above)
      set -- $pv
      delta="prior $prior = $1 (n=$2)"
    else
      delta="not measured in $prior"
    fi
  fi

  printf -- '- %s · %s = %s · n=%s · %s · %s\n' "$surface" "$metric" "$value" "$n" "$delta" "$(ceiling_for "$surface")"
  figures=$((figures + 1))
done <<EOF
$(grep -E '^figure:[[:space:]]' "$collection" 2>/dev/null || true)
EOF

if [ "$figures" -eq 0 ]; then
  printf 'None. The surfaces were read and returned no usable figure — which is a result, and is not\n'
  printf 'the same as not having read them.\n'
fi
printf '\n'

if [ -n "$unusable" ]; then
  printf '## Unusable collection lines\n\n'
  printf 'A line here is NOT a figure and must not be quoted as one. It arrived without a sample size,\n'
  printf 'or with one that is not a number, and this repository publishes no figure without its n.\n'
  printf '%s\n\n' "$unusable"
fi

printf '## Findings\n\n'
printf 'At most %s, the driver choosing which. Each: what the numbers show · the figure that shows it ·\n' "$MAX_FINDINGS"
printf 'what it costs · the change proposed, or the price of leaving it. An empty section that says it\n'
printf 'is empty is a result; write "None this period" rather than deleting the heading.\n\n'
# The candidate-rule shape (#473) is printed here, in the only branch that has findings, so the path
# from a finding to the ruler is in front of the driver at the moment it writes one. It is a shape,
# not a check: nothing below reads it back.
printf 'A finding MAY carry a candidate rule for published-voice, in this shape, and only when every\n'
printf 'evidence line is a figure: line quoted verbatim from a committed collection file:\n\n'
printf '    Candidate rule: <one sentence, in the ruler'"'"'s own register>\n'
printf '    Evidence: <figure: line(s), verbatim, n included>\n\n'
printf 'A candidate is not a ruling. It reaches published-voice only if the owner rules on it.\n'
# The owner's ruling on #473 (2026-09-25, «Fila no planning»): candidates queue in their reports and
# are ruled together at /sprint-planning. The shape above is indented on purpose — the queue is read
# by COLUMN-0 lines, so this template can never be counted as an open candidate.
printf 'Write both lines at column 0. The candidate then waits here, open, until /sprint-planning\n'
printf 'writes a Ruled: line under it (commands/funnel-review.md step 4).\n\n'

printf '## What I would leave alone\n\n'

printf -- '---\n\n'
printf 'This rite returns no verdict and gates nothing. It produces observations for the owner and\n'
printf 'nothing else — the same constraint `/sprint-review` carries, for the same reason: marketing\n'
printf 'judgement has no ruler, and a gate with no ruler grades taste.\n'
printf 'Nothing here files an Issue. Only the owner opens work.\n'

exit 0
