---
name: "funnel-review"
description: "Read the content funnel end to end for one period — the site's own analytics and the post metrics for what was published — and return at most two findings about where the funnel breaks. Use when the retrospective runs at the close of an iteration, or when the owner types it against a period worked by hand. It returns observations for the owner, never a ruling, and it gates nothing."
purpose: "give published content a feedback loop the loop itself can run, because every gate in this harness reads a diff and not one of them can see whether anything published was reached, read or acted on"
argument-hint: "[period] (defaults to the active iteration)"
---

> **Read this first: hooks named below are the retired plugin's, not controls you have (#61).** This
> text moved from the `tadeumendonca-skills` plugin (this rite at #130, from its `main` at `4882b911`). Where
> it names a plugin hook, guard rule or test (`hooks/…`, `permission-guard.sh` and its numbered rules,
> `mcp-guard.sh`, `inventory-counts.test.sh` and the like), it describes that plugin; **none of those runs
> in this method**. Read any rule they held as an **instruction you follow**. What is still mechanical,
> where the workstation installed it: the **deny floor** (native deny rules by command prefix), and
> **each agent's own tool list**, which is native in Claude Code and Kiro and an instruction in Codex. The
> session checks that replaced the plugin's reporting hooks are in `agents-configuration`, *Session-start
> and end-of-turn checks*.
>
> **The scripts this rite runs ship with the method (#170).** `{{method-scripts}}` in this text is the
> directory the method installs them to, the same for every agent harness, so the rite runs them from
> any repository.

Run the funnel review for the period named by `$ARGUMENTS` (default: the active iteration, derived
from the pool per `/agents-configuration` rule 1 — **enumerate, never type a milestone name**).

**This rite exists because it already ran once, by hand, and found something nothing else would
have.** On 2026-09-04 one session read the site's acquisition and landing-page reports, read the post
metrics, compared both against the published corpus, and located a defect neither the owner nor the
loop had named — that a teaser asserting nothing earns no comment, and that the failure sits in the
first line. **That sitting is the rite.** What it was not, until now, is repeatable: it had no
questions written down, no store, no baseline, no cap and no way to tell a run that found nothing
from a run that could not read anything.

## What this is, and the four things it is not

**It is a READ of one period's funnel, end to end** — reach, click, read, share, contact — against
the pieces published in that period, returning where it breaks.

**It is NOT a dashboard.** The value of the prototype sitting was a *located defect*, not a set of
numbers. A rite that renders metrics and stops has replaced a finding with a chart, and a chart is
the thing that gets looked at instead of acted on.

**It is NOT a gate, and it returns no ruling.** Marketing judgement has no ruler, and this
repository's own rule is that a gate with no ruler grades taste. Every observation here is advisory
and droppable. This is the same constraint `/sprint-review` carries, for the same reason, and it is
not a posture that could be tightened later — it is what makes the rite admissible at all.

**It is NOT a generator of work.** The prototype produced three tracked items from one sitting; a
rite producing three items per period is a machine for generating work, which is the failure this
loop names first. **The cap is two findings**, declared as a number in `{{method-scripts}}/funnel-review.sh` and
printed into every report.

**It is NOT a publisher of unbounded numbers.** Every figure ships with its sample size and the
ceiling that bounds it, or it is printed as unusable and not as a figure.

## The cadence is the RETROSPECTIVE's — it has no clock of its own

**Owner ruling, 2026-09-11, verbatim:**

> *«a avaliacao de metricas considerando que deveriamos estar trabalhando em sprints de 1 semana
> deveria ser feita no momento da sprint retrospective acho.»*

So this rite runs **at the moment `/sprint-retrospective` runs**, and the iteration length he named is
**one week**. It declares no interval of its own, and `docs/loop-cadence.md` carries no per-rite
interval field — a second interval axis with one member would be a configuration surface with no
reader.

**It is a fourth rite, not a fourth step of the retrospective.** The retrospective consults each
persona that ran, in isolation, about the **method**; this reads the **audience**. Neither finds the
other's class, which is the same reason `/sprint-review` is a separate rite rather than a section of
one. The order is `/sprint-review` → `/funnel-review` → `/sprint-retrospective` → `/sprint-planning`:
this rite's report is evidence the retrospective can feed back, exactly as the sweep's report is, so
running it after the consultation would produce evidence the consultation could not read.

**The conditional in his own sentence is carried rather than resolved.** *«considerando que
deveríamos estar trabalhando em sprints de 1 semana»* presupposes a ceremony that fires at a
container boundary. Read the mode from `docs/loop-mode.md` **before** assuming one does — and note
that under the lighter mode no rite runs at a boundary at all, so the anchor would be an anchor to
something that does not currently happen. That is a decision about the mode, not about this rite, and
nothing here resolves it.

**The clock carrier NOTICES this rite and cannot fire it.** `docs/loop-cadence.md` carries
~~`cadence-rite: docs/funnel-review /funnel-review here`, so `hooks/scripts/cadence-notice.sh` — a
`SessionStart` hook — reports how long since a report last landed in the store.~~
`cadence-rite: docs/funnel-review /funnel-review here FUNNEL-REVIEW-RAN`, so
`hooks/scripts/cadence-notice.sh` — a `SessionStart` hook — reports how long since a report carrying
`FUNNEL-REVIEW-RAN` last landed in the store. **Struck and narrowed at #473, because the struck form
was false in the direction that hides absence:** the carrier dated the newest commit under the root,
so a README and two reports that each say `FUNNEL-REVIEW-NOT-COLLECTED` were reported as this rite's
freshness while it had never read the funnel once. It now dates **only a tracked file carrying the
marker as a whole line** — *ran and found nothing* counts, *never read anything* does not — and until
one lands the notice says *"has NEVER landed a file carrying FUNNEL-REVIEW-RAN"*. The mechanism is
`docs/loop-cadence.md`'s *optional FOURTH token*. **Noticing is not firing: a hook cannot dispatch.**
And no interval is decided anywhere — the record ships with
`cadence-interval-days` undeclared and the carrier refuses to conclude rather than defaulting, which
stays true until the owner declares one.

## The route is the owner's own authenticated browser — and there is no credential

**Owner ruling, 2026-09-10, verbatim:**

> *«hoje o chrome do host esta autenticado. o claude in chrome consegue acessar.»*

He was offered two routes — an attended fetch he drives by hand, or a read credential held by the
harness — and took neither. **The harness holds no credential of its own and will not.** Claude in
Chrome drives a session that is already authenticated as him; nothing is stored and nothing is
granted to this plugin. The examination a harness-held credential would have owed is therefore **not
owed**, because there is no credential surface to examine.

**Two consequences, and the second is this rite's sharpest property.**

1. **The rite is CONDITIONALLY COLLECTABLE.** It reads when a session runs with an authenticated
   browser present; with none, it reads nothing. Nothing in this harness can open one.
2. **So the two states print DIFFERENT LITERALS**, at column 0, in the report:

   | literal | what it means |
   |---|---|
   | `FUNNEL-REVIEW-NOT-COLLECTED` | **nothing was read.** There is no findings section at all — not an empty one, none |
   | `FUNNEL-REVIEW-RAN` | **the surfaces were read.** The findings section exists and may say it is empty, which is a result |

   **A rite that quietly does nothing is indistinguishable from one that ran and found nothing.** That
   is this repository's own named worst shape and it is the whole reason the two literals exist.
   `scripts/funnel-review.test.sh` runs both branches in one pass and asserts each prints its own
   literal and **not** the other's.

## The containment is STATED, not implied — measured, at head

**No hook in this plugin observes the browser route.** Every registered hook sits on one of three
explicit matchers or on an unfiltered event, and a browser-extension act is none of them:

```
jq -r '[.hooks|to_entries[]|.value[]|.matcher // "none"]|unique|join(" ")' hooks/hooks.json
# -> AskUserQuestion Bash mcp__.* none

jq -r '[.hooks|to_entries[]|.value[]|.hooks[]|.command]|length' hooks/hooks.json          # -> 16
jq -r '[.hooks|to_entries[]|.value[]|.hooks[]|.command]|unique|length' hooks/hooks.json   # -> 15
```

**Both figures are true and they answer different questions** — 16 registrations across 15 distinct
scripts, because `preflight.sh` is registered twice. Publish whichever you mean, with its selector.

**And no registered hook reaches an external surface of its own:**

```
jq -r '.hooks|to_entries[]|.value[]|.hooks[]|.command' hooks/hooks.json \
  | sed 's|.*/hooks/scripts/|hooks/scripts/|; s|"$||' | sort -u \
  | xargs grep -nE '(^|[^[:alnum:]_])(curl|wget|nc)[[:space:]]' | grep -vE ':[0-9]+:[[:space:]]*#'
# -> no output

# CALIBRATION — the same pipeline, a token that IS present in those files:
jq -r '.hooks|to_entries[]|.value[]|.hooks[]|.command' hooks/hooks.json \
  | sed 's|.*/hooks/scripts/|hooks/scripts/|; s|"$||' | sort -u \
  | xargs grep -lE '(^|[^[:alnum:]_])gh[[:space:]]' | wc -l
# -> 11
```

**So reads and writes travel the same ungated road**, and that is a fact this rite carries rather
than a boundary it implies. Nothing verifies that the rite ran, nothing verifies what it read, and
nothing would notice a fabricated collection file.

**What IS mechanical, and it is a different surface entirely.** The only browser a *dispatched
persona* can reach in this plugin is `product-lead`'s read-only `chrome-devtools` subset, and
`hooks/scripts/mcp-guard.sh` denies it to every other persona by default — measured, same payload
shape, only the `agent_type` varying: `product-lead` + `navigate_page` draws no decision, and
`quality-assurance` + the same tool comes back denied with *"holds no MCP grant"*. That guard is
**not** what contains this rite's route; it contains a different one, and saying so is the point.

## The steps

### 0 · Before anything is dispatched — is the owner's authenticated browser reachable on THIS host? (#473)

**Every record this store holds is `FUNNEL-REVIEW-NOT-COLLECTED`, and both times the rite learned the
browser was missing only after its driver had been dispatched** (`docs/funnel-review/sprint-02.md`,
`docs/funnel-review/sprint-04.md`; the sprint-03+04 retrospective's `product-lead` finding 2, carried
onto #473 and incorporated by the owner — *«pode incorpora-los e estima-los»*, 2026-09-24). So the
context that is about to run this rite checks the route **first**, and a dispatch that can only write
the not-collected literal is not made.

**Stated per host, because the route is a property of the host and not of this rite.** *"Claude in
Chrome"* is one host's name for it; it does not exist on the other.

| host | the route | the check, and how settled it is |
|---|---|---|
| **Claude Code** | the Claude in Chrome extension, driven by the session that holds it | one read-only call to the extension. **Measured failure form:** *"Browser extension is not connected"* — the exact text `docs/funnel-review/collected/sprint-04.tsv` records |
| **Codex** | **not established.** Its extension browser drove the production site for the sprint-03 sweep (`-io` `docs/iteration-sweep/sprint-03.md`), unauthenticated; whether that browser carries the owner's analytics login is **unmeasured** | none that can pass today — treat the route as **not reachable** until one attempt reads an analytics surface and says so |
| **any other host** | unmeasured | treat as not reachable |

**The shipped `chrome-devtools` server is NOT this route on any host**, and must not be tried as a
fallback: it holds no authenticated session to any analytics or post-metrics surface (the sprint-04
record says so in its own reason), and it has not completed a sweep of any kind (#525).

~~**If the route is not reachable, send the owner ONE line — an ACTION, not a menu:**~~

~~`Connect <the route above> on <host> for /funnel-review <period> — or reply "skip", or fill docs/funnel-review/collected/<period>.tsv yourself.`~~

**Struck 2026-09-25: this is a DECISION, and the struck line called it an action.** It offers three
different acts, and a second one is clearly defensible: `skip` trades a period's reading for no wait.
By the HITL escalation format (`AGENTS.md`'s escalation section; `CLAUDE.md` until #562), rule 4, that makes it a decision. Rule 3 then requires a
picker, not options numbered or listed in prose. The struck wording came from the retrospective
proposal the owner incorporated (*"one ACTION line: connect, or skip"*). The agents-lead lens on
PR #528 found that it contradicts his own escalation rules. The root brief is where those rules bind the
context that asks, so it wins. The struck line stays visible, even though it never reached `main`.
The lens marker on PR #528 quotes it, and the retrospective proposal still carries the wording, so a
reader coming from either should find it here and see why it changed.

**If the route is not reachable, ask the owner ONE question, as a picker with these three options.
Each option states its consequence, and that consequence is the whole preamble:**

| option | its consequence, stated in the option |
|---|---|
| **Connect** `<the route above>` on `<host>` | the check runs again once he says it is connected, and the rite continues to step 1 on this host |
| **Skip** `<period>` | one `collected: no skipped by the owner` line is written, step 2 prints the not-collected report, and that period has no reading and no baseline |
| **I fill** `collected/<period>.tsv` | no browser is involved. His file runs step 2 unchanged, and he types the figures himself |

- **One question, three options: rule 1 and a ceiling of four.** The question is the whole
  activation. The host and the route go into the option labels, not into a paragraph before them.
- **Bounded exactly as rule 3 is.** A picker is absent from a headless session, and there the model
  falls back silently to the prose numbering this forbids. This step addresses the context that holds
  the browser route, which today is an interactive session. A headless run of this rite would break
  the rule, and nothing would say so.
- **`Skip`** — record it in **one line**: the collection file is
  `collected: no skipped by the owner on <date>: <route> not reachable on <host>`, and step 2 turns it
  into the not-collected report. **A skip is a result with a reason; an absent file is not.**
- **He fills the collection file himself** — the owner's alternative, and it needs no browser in the
  loop at all. His file declares `collected: yes <date> owner` and carries `figure:` lines in the
  store's contract; step 2 runs on it unchanged. **Nothing here can tell his file from a driver's, and
  nothing needs to**: both are assertions by whoever wrote them, which is the bound the store already
  carries.

**What this check does NOT establish, said so it is not over-read.** It proves reachability for the
context that ran it — the one holding the extension. **Whether a dispatched subagent can drive that
extension is still unmeasured**, which is why step 1 below says collection happens wherever the
browser is reachable rather than *"in the driver"*. One attempt with the extension connected would
settle it; this slice did not have one.

### 1 · Collect — where the authenticated browser is, and nowhere else

**The output of this step is a file, not a paragraph:**
`docs/funnel-review/collected/<period>.tsv`, in the contract `docs/funnel-review/README.md` declares.

Read, for the period:

- **the site's own analytics** — sessions, the acquisition split, the landing pages, and every funnel
  event the site declares. Read the event names out of the consuming repository rather than typing a
  list here: a list rots, and the declared set is in that repo's own analytics module;
- **the post metrics** for each piece published in the period — impressions, reactions, comments;
- **nothing else.** X analytics are out of scope by name; they were not read even in the prototype.

**Write `collected: no <reason>` and stop when the browser is not authenticated.** That is the
honest output of a step that could not run, and it is what makes the not-collected literal reachable.
Do not guess a number, do not carry one forward from the prior period, and do not omit the file.

**Whether a dispatched subagent can drive the Claude in Chrome extension at all is UNMEASURED — that
is a hypothesis, in those words**, and this rite is shaped so the answer does not matter: collection
happens wherever the authenticated browser is reachable, and every step after it needs no browser.
What would settle it is one dispatch attempting the act and reporting what came back.

### 2 · Analyse — no network, no credential, against the committed file

```
bash {{method-scripts}}/funnel-review.sh <period>
```

It reads the collection file and the prior period's, prints each figure with its sample size and its
ceiling clause, prints the comparison against the baseline or says there is none, and prints the
report skeleton. **It makes no network call** — asserted by a suite that puts a recorder on `PATH` in
place of `curl`, `wget`, `gh`, `nc`, `ssh`, `open` and `osascript` and reads a file that can be
non-empty, with one direct invocation proving it can.

### 3 · Report — at most two findings, into the store

`product-lead` writes `docs/funnel-review/<period>.md`. It is the driver for the same reason it drives
`/sprint-review`: it holds the reader's and the market's side, and the owner named that view for
exactly this work. It holds `Write` and `Bash`, so it runs step 2 and lands the file itself; nothing
is relayed through the orchestrator, because relaying is what turns a rite's own artifact into
somebody else's summary of it.

**A finding is:** what the numbers show · the figure that shows it · what it costs · the change
proposed, or the price of leaving it. **At most two, the driver choosing which** — and *"None this
period"* under the heading is a result, where a deleted heading is a step that silently did not run.

**A finding MAY carry a candidate rule for `published-voice` (#473)** — the one path from what the
audience did to the ruler that governs the next draft. Before this, the ruler was recalibrated from
one source only: the owner's own rejections, relayed by hand (#471, #472). **The shape, and each part
is what #471 and #472 already did by hand:**

```
Candidate rule: <the rule, one sentence, in the ruler's own register>
Evidence: <each `figure:` line it rests on, quoted verbatim from collected/<period>.tsv, n included>
```

- **Evidence is quoted, never paraphrased, and only from a committed collection file.** A candidate
  whose evidence is not a `figure:` line in this period's collection — or the prior period's, for a
  movement — **is not proposed.** An observation with no citable figure is still a finding; it is not
  a candidate.
- **It is a candidate inside a finding, not a third finding.** The cap is unchanged.
- **The not-collected branch carries none**, because it carries no findings section at all.
- **`Candidate rule:` and `Evidence:` are written at COLUMN 0**, exactly as above. The position is
  what `/sprint-planning` reads the queue by (step 4), and it is also what keeps the shape that
  `{{method-scripts}}/funnel-review.sh` prints as guidance from counting as a candidate. The script indents that
  template by four spaces, so a report that keeps the template as written contains no phantom open
  candidate.

**The honest bound on a candidate, stated with it rather than discovered later:** the samples are
small — #473's own body reports one read event reaching a single-digit number of users over four
weeks, a figure it publishes without a command, so nothing in this tree can re-derive it — so **a
candidate is a story
about that n**, and its evidence line shows the n precisely so the owner can weigh it.

### 4 · The output is a PROPOSAL, and the owner opens whatever becomes work

**A candidate rule reaches `published-voice` only by the owner's ruling.** He holds the voice; a
metric does not get to change how he writes, and the loop's job is to put a defensible candidate in
front of him, not to adopt one. So nothing in this rite edits the ruler, and a candidate he has not
ruled on stays in its report.

~~**How a ruled candidate then lands is NOT decided** — one at a time, each on its own ruling, or as a
queue ruled at `/sprint-planning`. #473's body leaves it open and the build asked him rather than
choosing: the question is on #473. Until he answers, a candidate reaches him inside the period's
report and nothing moves it further.~~ **Struck 2026-09-25: he answered.** The question was put to him
on #473 as a picker (*"Uma por vez"* · *"Fila no planning"*), and he chose **Fila no planning**.
Candidates accumulate as a queue, and he rules on them together at `/sprint-planning`. A candidate may
wait up to one sprint, and that cost was stated in the option he picked.

**Decided by the build, not by his ruling: the `held` carry-over, and it lengthens that wait.** A
candidate he marks `held` stays open and is counted again at the next planning, and he can hold it
again there. So a held candidate can wait **more than one sprint**, with no upper limit. The option he
picked quoted one sprint. `held` exists so that a candidate he wants to see again does not have to be
closed as `not adopted`. Each extra sprint of waiting is his explicit act at a planning, never a
default. It is reversible: dropping `held` from the three rulings below restores the one-sprint bound.

**The queue is the reports themselves. No new store exists.** A candidate waits where the rite
wrote it, in `docs/funnel-review/<period>.md`. A candidate is **open** until a `Ruled:` line other
than `held` follows its `Evidence:` line(s), at column 0. A `held` line records the planning that
deferred it, and the candidate stays open under it:

```
Ruled: adopted <YYYY-MM-DD> at /sprint-planning <iteration>
Ruled: not adopted <YYYY-MM-DD> at /sprint-planning <iteration>
Ruled: held <YYYY-MM-DD> at /sprint-planning <iteration>
```

**Why the ruling goes in the report and not somewhere new.** The candidate, its evidence and its
ruling then sit in one versioned file, so the queue is readable with one `grep`:

```
grep -nE '^(Candidate rule|Evidence|Ruled):' docs/funnel-review/*.md
```

A separate queue file would be a second copy of each candidate. Nothing would keep the copy
aligned with the report, which is the drift this repository keeps paying for. **At the time of
writing that command prints nothing.** Both reports in the store are `FUNNEL-REVIEW-NOT-COLLECTED`,
so no candidate has ever been proposed. The zero is real, not a dead pattern:
the `candidate queue` arms of `scripts/funnel-review.test.sh` append a column-0 candidate to a report
the script wrote and assert the selector finds it.

**`held` keeps the candidate open.** It is his explicit *"ask me again next planning"*, and the next
planning's count includes it. **`adopted` does not edit the ruler either.** An adopted candidate is
filed as an Issue, with no milestone, in the same way `/sprint-planning` files a retrospective finding
he names. The `published-voice` edit then goes through the normal lane like any other change to the
ruler.

Nothing here files an Issue and nothing here changes anything. **Only the owner opens work** — and
this is already mechanical rather than promised: `hooks/scripts/permission-guard.sh`, registered on
`PreToolUse` against the `Bash` matcher, denies `gh issue create` to every subagent but `developer`
(rule 5c), and denies this rite's driver three subcommands by name (rule 5e). Read that as three subcommands, not as *"every public surface"*: `gh pr create`, `gh pr edit`
and a `git push` are untouched by it.

## The questions this rite answers — the corpus, and what it costs

**Read the published corpus out of the consuming repository, never from a list here.** The pieces are
in that repo's own content tree, and a list in this file would rot the way a route list rots. Per
period, against that corpus:

1. **Reach** — did anything published in this period get in front of anyone, and from where?
2. **Click** — did reach become a visit?
3. **Read** — did a visit become a read? *(The prototype found this unmeasured; whether the site's
   declared read events actually fire is a question about the consuming repository, not this rite.)*
   **And did the read reach the DEPTH?** The owner's ruling recorded on #473 is that a piece is layered — accessible
   on the surface, with the detail and references underneath for whoever descends. The depth sits
   later in a piece than the opening, so whether readers reach it is a question the read-depth
   percentages already answer per piece, with no new measurement. *(A question to read, not a
   threshold: no number here says what depth is enough.)*
4. **Share and contact** — did a read become anything at all?
5. **Against the prior period** — which step moved, and is the movement bigger than the sample?

**The honest bound on all five: the per-piece numbers are small.** The prototype's per-article
figures rested on single-digit session counts, and a finding drawn from six sessions is a story about
six sessions. Say the n beside the number or do not say the number — which is why the analysis half
refuses to print a figure that arrived without one.

## What nothing enforces, said before any green is read

- **Nothing fires this.** `/sprint-retrospective` names the moment; that is an instruction in a
  command file. The clock carrier reports that the artifact is stale, one session late, and **cannot
  dispatch** — noticing is not firing, and the two words must not be collapsed.
- **Nothing observes that it ran, or that it read anything.** A collection file asserting
  `collected: yes` with invented numbers produces a byte-identical run to one read off a live
  console. Nothing in this harness can tell them apart, and no layer could: the browser act reaches
  no matcher at all.
- **Nothing pairs a report with its collection.** A report with no collection file beside it passes
  every check in this repository.
- **The cap is held over LANDED artifacts only.** `scripts/funnel-review.test.sh` counts
  `## Finding` headings in the reports that exist under the store root. A period that was never
  reported is invisible to it, and no shell anywhere can count findings inside a model's prose.
- **Nothing makes the step-0 check run before a dispatch.** It is an instruction to the context about
  to dispatch; no layer observes a dispatch, so a driver sent without the check is caught only by the
  not-collected report it then writes.
- **Nothing checks a candidate's evidence against the collection file.** A candidate quoting a
  `figure:` line that is not in `collected/<period>.tsv` passes every check here; the owner reading
  the two side by side is the only comparison.
- **Nothing makes `/sprint-planning` read the queue, or write the `Ruled:` lines.** Both are
  instructions in that rite's step 1. A planning that skips them leaves the candidates open, and they
  stay visible to the next planning's `grep`. That is the one property the shape buys. Nothing reads a
  `Ruled:` line mechanically.
- **Nothing observes whether a piece improved after a candidate became a rule.** No layer reads a
  draft against a prior one, and at these sample sizes a movement in the next period is not evidence
  of a cause. A later period's funnel is what there is, and this rite already says it cannot attribute.
- **`hooks/scripts/inventory-counts.test.sh` asserts this file's rules are WRITTEN.** It cannot
  assert that a session obeyed any of them, and no arm anywhere claims otherwise.

**By this loop's own test — *would something stop me, or only my memory?* — this rite is an
instruction.** What it changes is that the analysis is repeatable, the baseline has a home, and the
two states that used to look identical now print different strings — and, since #473, that the clock
counts only the second of them, and that a finding has a written shape by which it can reach the
owner as a candidate rule.

## What this rite cannot see

- **Anyone who declined consent.** The site's banner gates its analytics entirely, so every
  site-side figure is a count of consenting sessions and a reader who declined is invisible by
  design. That ceiling rides with every site-side figure the analysis prints.
- **Anything a platform does not report.** A post's own metrics are the platform's numbers, with the
  platform's own unstated sampling, unverifiable from here — which is why the ceiling clause is
  surface-aware and says something different on those lines rather than pasting the site's.
- **Whether a number caused anything.** It reads a funnel; attribution is not in the data and
  inventing it is the failure mode this rite's *not a dashboard* clause is aimed at.
- **Every defect in the method, and every defect a reader would meet on the page.** Those are
  `/sprint-retrospective`'s and `/sprint-review`'s classes respectively. Four rites, four blind
  spots, none covering another's.
