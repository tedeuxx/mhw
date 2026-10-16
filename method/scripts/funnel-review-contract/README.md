# The funnel-review store contract

**This is the parsing contract for the store `/funnel-review` writes and reads.** It ships with the
method (#181), next to the script that parses it, `method/scripts/funnel-review.sh`. Before #181 it
lived only in the deprecated plugin repository, so a rite installed from the method named a contract
it did not carry. The store itself belongs to the **consuming repository**: `docs/funnel-review/` at
that repository's root. New periods are collected and reported there; a store kept elsewhere stays
where it is, as history.

**The render installs this file beside the script**, at
`funnel-review-contract/README.md` in the installed scripts directory, because the rite names it
through the scripts-directory token and the render installs a document a rite names. A session running the installed rite in a consuming repository reads it there. The worklog
contract beside it is not installed: no rite names it, and its only reader is a test in this
source tree.

## Two files per period, and they are different kinds of thing

| path, under the consumer's `docs/funnel-review/` | what it is | who writes it |
|---|---|---|
| `collected/<period>.tsv` | **what was read off the surfaces**, verbatim, one figure per line with its sample size | the rite's driver, or the owner by hand |
| `<period>.md` | **the report**: the analysis, the comparison against the prior period, and at most two findings | the rite's driver, from `funnel-review.sh` |

**The split is not tidiness.** The report is derived and can be regenerated; the collection is the
only record that a surface was ever read, and it is what the next period compares against. A store
that kept only the prose would have a baseline nobody could recompute.

**The consumer declares what the method does not name.** Beside the store, the consuming repository
records its own declarations: the analytics dimensions that carry the piece and the language, how an
edition's key is derived from them, the name of its internal-traffic marking and filter, and any saved
reports the driver reads. The method names none of them, so this contract stays the same for every
consumer.

## The collection file's parsing contract

Positional, at column 0, read literally. A token that can also occur inside wrapped prose is not a
declaration; a **position** is.

```
collected: yes <date> <provenance>                                   the surfaces were read
collected: no  <reason>                                              they were not, and this is NOT "no findings"
internal-traffic: <none|testing-excluded-by-query|active> <effective-date> <how>
figure: <surface> <metric> <value> <sample-size>
```

Lines starting with `#` and blank lines are ignored. Only the first `collected:` and the first
`internal-traffic:` line count.

### `collected:` is the line the whole rite turns on

The collection route is the owner's own already-authenticated browser (owner ruling, 2026-09-10), so
the rite is **conditionally collectable**: with no authenticated session there is nothing to read, and
nothing in the harness can open one. A driver that could not read writes `collected: no <reason>`, and
the report prints `FUNNEL-REVIEW-NOT-COLLECTED` with no findings section at all. A file whose
`collected:` line is absent, or says neither `yes` nor `no`, is reported the same way.

Two spellings, neither of which changes the parser:

- **a skipped period** is `collected: no skipped by the owner on <date>: <reason>`, one line, so a
  skip leaves a record with a reason instead of an absent file;
- **a file the owner filled in himself** declares `collected: yes <date> owner` and carries `figure:`
  lines as usual. Nothing here can tell it from a driver's file, and nothing needs to: both are
  assertions by whoever wrote them.

### `internal-traffic:` declares whether the owner's own sessions are in the figures

The state is a **closed set**, and the report header prints the line verbatim:

| state | what it asserts |
|---|---|
| `none` | no internal-traffic marking exists on the property, so the figures include any internal sessions |
| `testing-excluded-by-query` | the marking exists and its filter is in **Testing**: the property still keeps marked sessions, and the queries behind every figure excluded them |
| `active` | the filter is **Active** from `<effective-date>`: the property drops marked sessions before any query sees them |

`<effective-date>` is the date the state took effect, and `<how>` says in words how the figures were
filtered. **A line that is absent, names a state outside the set, or lacks the date or the `<how>`
prints, in the header:**

```
internal-traffic: UNDECLARED — figures may include the owner's own sessions
```

with the declared text quoted after it when there was one. The state is declared, never assumed.

**What the states imply for collection** (the rite's step 1 says the same to the driver):

- **While the filter is in Testing**, exclude marked sessions in every query **and** collect the
  count of marked sessions in the window as a `figure:` line of its own. It is the calibration figure:
  it says how much the exclusion removed.
- **Once the filter is Active**, that count can no longer be observed: the property no longer keeps
  the sessions it would count. A window that starts before `<effective-date>` is only partly filtered,
  and its figures mix both regimes.

### `figure:` lines, and the per-piece, per-language spelling

```
figure: <surface> <metric> <value> <sample-size>
```

**A `figure:` line with no numeric sample size is printed as UNUSABLE and never as a figure.** A
number ships with what bounds it or not at all; dropping the malformed line instead would hide that a
collection run came back wrong.

**`<metric>` is either a whole-site name or a qualified one.** The qualified spelling is

```
<metric>:<piece>:<language>
```

with `<piece>` the edition key the consumer derives and `<language>` the language value its analytics
dimension reports. Neither part may contain a space or a `:`. A whole-site figure is unqualified.

**Every figure with a language qualifier carries a `locale-caveat:` clause** beside its
`consent-ceiling:` clause:

```
locale-caveat: a link pinned to one language sets this value by the link, not by the reader
```

The sample size is mandatory on every figure, qualified or not, exactly as before.

### The prior-period lookup is literal

The report compares each figure with the line of the **same surface and the same metric** in the
prior period. Both are compared as plain strings: a `.` or any other character in a metric matches
only itself. A metric absent from the prior period is reported as `not measured in <prior>`, and the
earliest period says it has no prior period on record.

### `<surface>` is a CLOSED vocabulary, and an unknown one is refused rather than described

| surface | the ceiling that rides with every one of its figures |
|---|---|
| `ga4` · `site` | consenting sessions only: the site's consent banner gates its analytics, so a reader who declined is invisible by design |
| `linkedin` · `x` | the banner gates nothing there; the figure is platform-reported, with the platform's own unstated sampling |
| anything else | **`UNDECLARED`**: nothing here knows whether a consent gate applies, so nothing here says |

The default refuses rather than asserting. A default that asserts a bound it cannot know is worse than
one that declines, because only the first is quotable. **Adding a surface means adding a row here and
a case in `funnel-review.sh`, in the same change**; until then its figures print as unbounded.

### A `*`, `?` or bracket class in any field is a plain character

The script sets `set -f` before it splits a line, so a field is never replaced by filenames in
whatever directory it ran from. This is not a defence against an attacker: a `*` in an analytics page
path or a campaign name is ordinary.

## The period name

Any string that sorts. The script finds the prior period by taking the greatest collected name
lexically below this one: lexical rather than chronological on purpose, because a date parser would be
a second contract nobody declared. `sprint-02` and `2026-09` both work; mixing the two conventions in
one store does not, and nothing stops you.

**`2000-01` through `2000-09` are reserved**, and every `2000-0N` name with them. They are the
synthetic fixtures under `method/scripts/fixtures/funnel-review/`, kept outside every store so a test
period is never mistaken for a reading of a real funnel.

## What nothing here enforces

| decision | what actually holds it |
|---|---|
| a period is collected at all | **nothing.** No layer reads an external surface |
| `collected: yes` is TRUE | **nothing.** A driver that invented its figures produces a byte-identical file to one that read them |
| a figure that should be split per piece and per language was split | **nothing.** An unqualified figure prints without the caveat, whatever it measured |
| the declared `internal-traffic:` state is TRUE | **nothing.** The header prints what the file declares |
| a report lands for a period that was collected | **nothing.** `funnel-review.test.sh` reads the artifacts that landed |
| the cap of two findings | **the test, over LANDED artifacts only** |
| the store's two halves stay paired | **nothing.** A report with no collection file beside it passes every check |

**By this loop's own test, *would something stop me, or only my memory?*, this store is a record and
not a control.**
