---
name: "sprint-retrospective"
description: "Run the iteration retrospective as a rite — consult each persona that ran, one at a time and in isolation, on what should change in how we work, each reasoning from its own artifacts rather than from memory. Use when the drain reports its entry snapshot exhausted, or when the owner types it against an iteration that was worked by hand. Produces a proposal he rules on at planning, never an Issue and never a change. It takes an optional iteration title as its argument, typed after its name; without one it uses the active iteration."
purpose: "give the closing of an iteration an object, so improvement stops being invented by the one role that saw the whole iteration and is therefore the least able to see its own bias in the list it produces"
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

> **A skill, not a command, since 2026-10-26** (the owner: *"para mim sao skills"*). Invoke it by name:
> Claude Code `/sprint-retrospective`, Codex `$sprint-retrospective`, Kiro `/sprint-retrospective`. Any agent harness may also load it
> on its own when the task matches its description; the rite's steps and its owner acts are
> unchanged by that.

Run the retrospective rite for the iteration the owner named after this skill's name (default: the
active iteration, derived from the pool per `/agents-configuration` rule 1 — **enumerate, never type a milestone name**).

**This file is the object `/autonomy on` has been promising.** That command has said *"the closing
ceremonies run against the exhausted iteration"* since #326 with no ceremony anywhere in the tree. This
is the retrospective half. ~~**The sprint review half is still unbuilt**~~ — **struck 2026-09-02
(#379): it is built, and it is `/sprint-review`, which runs BEFORE this rite.** The last section
records what its refusal demanded and how the built rite satisfies it.

## What this is, and the one thing it is not

**It is a CONSULTATION, not a report.** Each persona that ran during the iteration is dispatched once,
alone, fed the artifacts it itself produced, and asked one question: *what did you see in this iteration
that should change in how we work?*

**The isolation is the mechanism, not a courtesy.** Its purpose is to stop the improvements being
invented by the orchestrator — the one role that saw the whole iteration, therefore the most likely to
produce a plausible list and the least able to see its own bias in it. A subagent cannot see another
subagent's output, so isolation costs nothing extra here: it is a property of dispatch rather than a
discipline anyone has to keep.

**But isolation alone buys nothing, and this is the finding the rite is built around.** A consulted
persona is a **fresh context with no memory of the iteration**. Handed only a question, N personas
produce N plausible lists — which is the orchestrator's bias relocated to N contexts, not
removed. **Isolated speculation is still speculation.** So the dispatch feeds each persona its own
evidence, and asks it to reason from that. That is what step 3 is for, and it is the reason this rite is
worth running at all.

## The trigger

**The drain reaching exhaustion of its ENTRY SNAPSHOT** — the owner's ratified end-of-sprint signal
(«o gatilho para fim de sprint é o fim dos itens do dreno»), read against `/autonomy on`'s own terminal
condition rather than against a second definition invented here.

**Three things are decoupled deliberately, and keeping them apart is what stops the snapshot-versus-
iteration question being load-bearing:**

> **The TRIGGER is the entry snapshot's exhaustion. The SCOPE is the iteration as it stands at that
> moment. The OUTPUT is a proposal. The iteration's CLOSE stays the owner's, at planning.**

**Why not "the sprint ended".** ~~No command available to this loop can read whether a milestone is
open or closed; the iteration's close is a click in a browser.~~ **Struck 2026-09-29 (#537):
`python3 {{method-scripts}}/milestone-read.py` reads state and `python3 {{method-scripts}}/milestone-close.py` closes it.**
The close is still not the trigger: snapshot exhaustion fires the rites first, and closing the
milestone is an output after those rites have run.

**Why not "the iteration is empty".** ~~Unreachable by working. `loop` Issues join the **active**
iteration at filing (#338) and `loop` is the class generated by working, so a rite keyed on an empty
iteration would never fire.~~ **The reason is REPLACED, not the decision — struck 2026-08-30 (#365),
which removed the premise this rested on.** With nothing admitted to a running iteration automatically,
the pool no longer grows by working, so *"the iteration is empty"* stops being unreachable and this
option **genuinely re-opens**. It is re-decided here rather than left to inherit a dead argument, because
a rejected option kept alive by a struck sentence is how a design decision gets un-made by accident.

**It is still rejected, on two grounds that never depended on #338:**

- **Emptiness of an iteration is not observable as a terminal condition.** The pool predicate requires
  `ready`, and `ready` on the `loop` lane is the owner's decision (applied by the main session once
  aligned with him, #512). An iteration holding an open item he has not decided `ready` never empties
  by working — so the rite would sit un-fired behind ~~a label only he can apply~~ a label only his
  decision releases, which is the same wedge under a different name.
- **The trigger must be an event the running thing produces.** The drain is what runs; its snapshot going
  empty is a fact it observes about itself, at the moment it observes it. Iteration-emptiness is a fact
  about the tracker that nothing in the loop is watching. ~~`grep` any hook for a queue read and every
  `gh issue` call in `hooks/scripts/` is a write path.~~ **Struck: that instruction returns the opposite
  of what it promises.** `grep` the registered hooks and two live READS come back, both in
  `closure-artifact-guard.sh` — an Issue body by number, and **closed** Issues in a rolling date window.
  **The conclusion is unchanged and its real reason is one grep further in:** neither read selects a
  `--label` or a `--milestone`, and no registered hook does, so nothing watches the *eligible* set. This
  site is struck rather than reworded because it told the reader to run a check — and a check whose
  published result is the reverse of its actual output is worse than no check.

**What #365 does change here is the SCOPE clause, and it changes it in the rite's favour:** an iteration
whose contents are fixed at planning makes *"the iteration as it stands at that moment"* a far more
stable object than it was. The decoupling above is unaffected; it simply costs less to defend.

**The typed fallback is this file's `argument-hint`, and it is not a lesser path.** An iteration worked
without `/autonomy on` never reaches the mechanical trigger, so the owner types `/sprint-retrospective
<iteration>` and the rite runs identically. **Nothing distinguishes the two runs in any artifact**, and
nothing needs to: the artifact records the iteration, not the route.

**The rite may fire twice for one iteration, and nothing can stop it.** «The drain exhausted» is a
**per-repo** event — `/autonomy on` takes one repo and builds its pool from one milestone — while the
iteration is two milestone objects in two repositories paired by title alone. A `Stop` hook receives one
`cwd` and therefore sees one repository, which `/agents-configuration` has already measured for the
loop-first detector and called *"a heuristic and the weakest part"*. **The artifact is what makes a
second firing idempotent rather than duplicative**: step 4's files already exist, so the second run
finds them and appends nothing.

## `/funnel-review` runs at THIS moment — the owner anchored it here (#401)

**Owner ruling, 2026-09-11, verbatim:** *«a avaliacao de metricas considerando que deveriamos estar
trabalhando em sprints de 1 semana deveria ser feita no momento da sprint retrospective acho.»*

**It is a separate rite, not a step of this one, and the distinction is load-bearing.** This rite
consults the contexts that ran about the **method**; `/funnel-review` reads the **audience** — one
period's published funnel, end to end, against the pieces published in it. Folding it in would put an
audience reading inside a consultation whose whole mechanism is that each persona reasons from its own
artifacts, and the funnel is nobody's artifact.

**Run it BEFORE the consultation**, for the reason `/sprint-review` already runs before it: its report
is evidence step 3 can feed back, and a report produced after the consultation is evidence the
consultation could not read. The full order is `/sprint-review` → `/funnel-review` →
`/sprint-retrospective` → `/sprint-planning`.

**Nothing fires it either, and its collection step can fail in a way this rite's cannot.** It reads
through the owner's own already-authenticated browser (owner ruling, 2026-09-10) — no credential is
held by the harness — so with no authenticated session it reads nothing and says so in a distinct
literal. **A funnel report reading `FUNNEL-REVIEW-NOT-COLLECTED` is not a finding about the funnel and
must not be fed to step 3 as one.**

## Step 1 — the scope record, written before any consultation

**`agents-lead` writes `docs/retrospective/<iteration>/00-scope.md` first**, and it contains **query
output only** — no findings, no reading of anyone's artifacts. It is the machinery persona because the
scope record is machinery: the queries, the repositories, the snapshot the rite ran against.
~~It is the machinery persona because the orchestrator cannot write it:
`hooks/scripts/orchestrator-write-guard.sh` denies the orchestrator any edit inside a git working tree,
keyed on its empty `agent_type`.~~ **Struck 2026-08-31 (#375): that hook is deleted and the orchestrator
CAN now write this file.** The instruction is unchanged and the reason for it is weaker — it is a
routing convention held by whoever reads the diff, not a deny that would refuse the alternative.

The scope record carries, each with the command that produced it:

- **the iteration, in BOTH repositories**, enumerated and never named from memory, with what was still
  **open** at the moment the rite ran. Exhaustion of a snapshot is not emptiness of an iteration, and a
  rite that does not say so is claiming a completeness it does not have;
- **the count of `loop` items carrying NO milestone**, in both repositories. An unmilestoned `loop` item
  is invisible to the pool predicate, so it is not drained, not retrospected and not reported — it sits
  outside every iteration-scoped mechanism at once, silently. ~~#338's filing rule was already unapplied
  on the very first Issue filed after it merged, so this is a measured class and not a worry.~~
  **Re-authored 2026-08-30 (#365), because the class went from exceptional to universal and the sentence
  would have read as reassurance.** Nothing is admitted to a running iteration automatically now, so
  **every** newly-filed `loop` item is in this count by construction. The number is therefore no longer
  a defect signal — it is the size of the backlog awaiting composition, and reporting it is how that
  backlog stays visible between plannings rather than how a rule-break gets caught;
- **the derived consult set**, from step 2, with the limits step 2 states;
- **the fact that this is a lower bound**, in those words.

## Step 2 — the consult set is DERIVED, and it is a lower bound

**Do not consult a fixed set.** `hooks/scripts/dispatch-metrics-stop.sh` posts one comment **per stop,
onto every Issue the dispatch resolved**, under the marker
`<!-- dispatch-metrics: <plugin>:<agent_type> #<issue> -->`. Per Issue in the iteration:

```
gh issue view <n> --repo <owner>/<repo> --json comments \
  --jq '[.comments[]|select((.body//"")|contains("dispatch-metrics:"))
          |((.body|split("\n")[0])|capture("dispatch-metrics: (?<a>[^ ]+)").a)]
        |group_by(.)|map({(.[0]):length})|add // {}'
```

Measured across `sprint-01` in this repository: **six of seven personas ran; `content-reviewer` ran zero
times.** Consulting the fixed roster instead would spend a dispatch asking a persona that was never in
the iteration to report on it. *(The measurement above is dated and is left at its own denominator: the
roster held seven when `sprint-01` ran and holds **eight** since #375, which is exactly why the consult
set is derived rather than written down.)*

**Measured limits travel WITH the set, and the artifact states them rather than implying them. One of
the three was REPAIRED at #382 and is struck rather than deleted, because a reader who took it from
here adjusted their reading of `sprint-01`'s numbers by it:**

1. ~~**The Issue number comes from the branch, by a fragile grep** —
   `printf '%s' "$branch" | grep -oE '[0-9]+' | head -1`. Probed directly:
   `fix/adr-0002-rewrite-355` yields `0002`, `feat/v2-api-355` yields `2`, and `main` yields nothing at
   all. So a branch carrying an earlier number **misattributes the record to another Issue**~~ —
   **STRUCK 2026-09-02 (#382), and the misattribution half is now FALSE.** The hook resolves a **set**,
   unioned from the PR's own `closingIssuesReferences` and from the branch name tokenised on
   non-alphanumerics, keeping only all-digit tokens with no leading zero and at most five digits. Each
   clause is asserted by its own arm in `hooks/scripts/dispatch-metrics-stop.test.sh` and each was
   mutation-checked on the source. **The `main` half SURVIVES and is not struck:** a dispatch whose
   branch carries no qualifying token and has no PR still posts nothing — chiefly intake work — so the
   recorded set is still *builders and gates* rather than *intake*, and that gap is now asserted
   (`no-issue-resolved`) rather than merely known.
   **The defect this repaired is the one that produced a whole batch reading as one slice:** on PR
   #391 a four-Issue batch branch put every comment on the first number and none on the other three,
   and this step then read *no persona ran* for three quarters of the batch.
2. **`agent_type` is namespaced** — `tadeumendonca-skills:agents-lead`. A consumer matching the bare
   name returns nothing.
3. **It is per-repository.** The other half of the iteration carries its own comments and must be
   queried separately.
4. **The record is CUMULATIVE AT ONE STOP, not one per dispatch — so never sum across comments.**
   `SubagentStop` fires more than once per dispatch and every firing re-reads the same cumulative
   transcript. Group by the `dedupe_key` field (the `agent_id`), keep the record with the greatest
   `duration_seconds`, then sum across `agent_id`s. Measured on `#342`: the naive sum reads 8,931 s
   against a true 5,292 s, **+69%**. The hook's own header claimed one-per-dispatch until #382; every
   comment now carries this rule in its own trailer, so a future consumer gets it from the artifact
   rather than from this file.

5. **The records went dark from 2026-09-11 to 2026-09-24 and were partly MISATTRIBUTED after that
   — repaired at #513, and the window is not re-derivable from them.** Measured from a captured live
   `SubagentStop` payload (build 2.1.283): the payload's `cwd` is the session's **primary checkout**,
   never the slice's worktree, so the hook read whatever branch the primary held at stop. On `main`
   that is silence (`no-issue-resolved`); on another slice's branch it is the **wrong Issue** —
   `-wt-510`/`-wt-512` work landed on `#473`, `-wt-531` work on `#511`, and a `-io` branch named for
   a `-skills` Issue put 17 records on an unrelated `-io` Issue. **So *"no records"* for an Issue in
   that window means nothing, and records on the Issue the primary checkout held are a superset.**
   Since #513 the hook reads the working tree the dispatch's own tool calls used, plus the PRs it
   wrote to; each record carries `worktree:`, `worktree_resolution:`, `payload_cwd:`,
   `prs_written:`, `worktrees_rejected:` and `attribution:` so an attribution can be audited
   instead of trusted. **The misattribution is NARROWED, not closed.** When the dispatch wrote to a
   PR that names an Issue and named no worktree other than the primary, the primary's branch is
   dropped (`attribution: prs-written-only`). This applies even when the dispatch referenced the
   primary, because reviewers read it while it holds an unrelated branch. **A dispatch that names no
   worktree AND writes to no PR still gets the primary checkout's branch**, and so does one that
   writes only to a PR naming no Issue (a chore or rite PR): its record gets `attribution: union`
   with the primary's branch. So while the primary holds another slice's branch, either record still
   lands on that slice's Issue.
   **Read `worktree_resolution: payload-cwd` with `attribution: union` on a record as *unverified*:**
   it is exactly the shape the residual produces. **And several silent shapes survive #513, so *"no
   records"* is still not proof of absence.** At least four are known, and the hook's header
   names three of them. The first is a read-only dispatch on `main` that touched no worktree and
   wrote to no PR. The second is a merge whose PR number follows a flag (`gh pr merge --merge <n>`).
   The third is the sibling-outranking shape: a dispatch whose absolute `git -C` reads of a sibling
   repository outrank its relative-path work in the primary resolves to the sibling, and a PR it
   wrote in the primary's repository is then filtered as foreign. The PR 519 gate lost its record
   this way. The fourth, not in the header, is a dispatch on `main` that writes only to a PR naming
   no Issue.
6. **Codex emits NO records, on any Issue.** `codex-hooks.json` registers `PreToolUse` and
   `UserPromptSubmit` only — there is no `SubagentStop` equivalent and no reference to this hook:

   ```
   jq -r '.hooks|keys[]' codex-hooks.json          # -> PreToolUse, UserPromptSubmit
   grep -c 'dispatch-metrics' codex-hooks.json     # -> 0
   ```

   **An iteration run on Codex derives an EMPTY set from this source by construction**, which is the
   reason the second source below is not optional there.

### The SECOND source — the PR verdict markers, and it answers for two personas only (#513)

**Read the verdict markers on the iteration's merged PRs and UNION them with the records above.** A
marker is posted by the persona itself, on the PR, and names nothing about a working tree, so it
survives every failure in limit 5 and does not depend on the host at all:

```
gh pr list --repo <owner>/<repo> --state merged --search "merged:<start>..<end>" --limit 200 \
  --json number,comments \
  --jq '{prs:length,
         gatekeeper:[.[]|select(any(.comments[];.body|contains("<!-- gatekeeper-verdict:")))|.number],
         harness:[.[]|select(any(.comments[];.body|contains("<!-- harness-lead-verdict:")))|.number]}'
```

Measured 2026-09-25 over `-skills`, merged `2026-09-11..2026-09-22` (sprint-02's window): **36 PRs,
35 carrying a `gatekeeper-verdict`, 36 a `harness-lead-verdict`** — against a derived set of *none*
from the records, which is what `docs/retrospective/sprint-02/00-scope.md` published. **The selector
can return zero**: the same query for the literal `<!-- product-lead-verdict:` returns `0`, because
no such marker exists.

**What it attests, exactly: `gatekeeper-verdict` → `quality-assurance` ran; `harness-lead-verdict` →
`agents-lead` ran.** Nothing else. `product-lead` posts no marker (rule 5e denies it the comment
subcommands), and `developer`, `tech-lead` and the content pair post none either, so **their presence
still comes from the records alone** — the second source raises the floor for two personas and leaves
the lower bound a lower bound. It is per repository, exactly as the records are.

**And the date window is the derivation's own weak limb, not the marker's.** `merged:<start>..<end>`
selects by merge date, so a PR reviewed in the iteration and merged after it is outside the set.
Where the iteration's PRs can be listed by Issue instead, prefer that list.

**And the whole set is a LOWER BOUND, never the set.** That is unchanged by #382 — the repair narrowed
the silent set, it did not close it. `dispatch-metrics-stop.sh` exits 0 silently on several paths, and
since #382 each one is **named in the source** rather than estimated here — read the members, not a
count:

```
grep -n 'silent-exit:' hooks/scripts/dispatch-metrics-stop.sh
```

`dispatch-metrics-stop.test.sh` asserts that no `exit 0` in that file lacks such an annotation, so the
list cannot go stale silently. **A persona that ran and left no comment is still indistinguishable from
one that never ran** — that property is unchanged by #382 and is the reason this remains a lower bound.
Read the query result as *"at least these ran"*, write that phrase into the scope record, and add a
persona by hand when the owner knows it ran.

**Then SUBTRACT every profile that cannot `Write`, and record the subtraction in the scope record by
name.** The rite's artifact is a file the consulted persona writes itself (step 4), so a profile whose
`tools:` grant contains no `Write` cannot produce one — and the derivation above has no filter, so it
will hand you such a profile the moment one has run. At head that is `scrum-master`
(`agents/scrum-master.md`, `tools: []`); the clause is written as a **property** rather than a name so
the next tool-less profile is covered without an edit here. It applies to a hand-added persona exactly
as it applies to a derived one.

**The relay is refused explicitly, and that refusal is the whole reason this is an exclusion rather than
an accommodation.** The available workaround — dispatch it anyway, have the orchestrator write the file
from what it returned — is the aggregation this rite's isolation exists to prevent, in the one step where
it would be invisible: the directory would hold the file, `ls` would answer *"the rite ran"*, and nothing
in the artifact would say the answer passed through the context being retrospected. **A second reason,
measured rather than argued:** `agents/scrum-master.md` records that a tool-less profile asked to act
reports the act as done — *"the `tools: []` probe replied «The command succeeded. File created at the
specified path.» and no file existed"*. Consulted, it would report a write that did not happen, and the
rite has no check that would contradict it.

**What the exclusion costs, stated rather than absorbed:** the process-guardian voice is absent from the
rite, and it is the profile most likely to have something to say about whether the loop ran in order.
The fix for that is a `Write` grant on the profile — a roster decision, with the four-reason test re-run
per that brief's own warning that *"if a future slice gives you a tool, that argument comes back in
full"* — never a relay arranged here.

## Step 3 — one isolated dispatch per persona, fed its OWN artifacts

Dispatch the personas in the derived set **one at a time**. Each dispatch carries, for that persona and
that iteration only:

- its own `dispatch-metrics` comments — durations, tool calls, token cost, output size;
- its own verdict markers — `gatekeeper-verdict` for the gate, `harness-lead-verdict` for the machinery
  lens;
- its own review-file sections — `docs/content-review/<slug>.md` for the content pair;
- **its own iteration-sweep report — `docs/iteration-sweep/<iteration>.md` in the consuming repo, for
  the persona that drove `/sprint-review` (#379).** This bullet is why the review runs **first** of the
  three: the sweep's report is one of the artifacts this step feeds back, so a sweep run after the
  consultation would produce evidence the consultation could not read. **Added here in the same slice
  that made that claim** — it was asserted in four places and this list, which is the one that decides
  it, did not carry it;
- the PRs and Issues it touched.

**All of that is reachable with reads that already exist — `gh` reads, marker greps, and a file read for
the sweep report, which is a tracked file in the other repo rather than anything this loop has to
build. Nothing new is built to produce it.** *(The sweep-report bullet is the one item here that is
NOT a `gh` read, and it is the one this suite can never see: it lands in the consuming repository. If
the file is absent, that is a finding about the handoff — say so — never a silently shorter dispatch.)* The question the dispatch asks is therefore *"here is what you produced; what does it say
should change?"* rather than *"what did you see?"* — a documented-evidence question of the kind this
loop already requires everywhere else.

**Do not put another persona's artifacts in a dispatch, and do not summarise the iteration for it.** A
briefing that explains why a fact matters comes back as a finding carrying no fact; state the artifacts,
not the argument.

## Step 4 — the artifact is a tracked FILE PER PERSONA, and the split is what holds the isolation

**Each consulted persona `Write`s exactly one file: `docs/retrospective/<iteration>/<persona>.md`.**

**One file per persona rather than one shared file with one section each, and the reason is mechanical
rather than tidy.** A persona appending a section to a shared file must open that file, which puts every
earlier answer in its context — **the isolation would survive the dispatch and die at the write.** With
one file each, no consulted persona ever reads another's answer, and the property is held by the shape
of the artifact instead of by an instruction.

**There is no index and no summary, deliberately.** The directory is the artifact; `ls
docs/retrospective/<iteration>/` answers *"did the rite run"*. Anyone composing the sections into one
narrative would be performing the aggregation the isolation exists to prevent, which is why no step here
asks for one.

**A comment was NOT chosen, and four of the eight personas are why.** `permission-guard.sh` rule 5e
allowlists `gh pr comment` / `gh issue comment` / `gh issue create` to the orchestrator, `developer`,
`tech-lead`, `agents-lead` and `quality-assurance`, and **denies `product-lead`, `content-writer` and
`content-reviewer` by name — and `scrum-master` by name too (#375), for its own reason: it holds
no `Bash` at all.** The
criterion is *every persona not on rule 5e's allowlist*, and the count follows from it: **four of the
eight cannot post their own answer at all**, and relaying them through the orchestrator reintroduces
exactly the aggregation this rite exists to avoid. A file lands in a diff he already reads, goes through the gate
like any other change, and is the route rule 5e's own deny text points the denied personas at.

**The price is stated rather than absorbed: the retrospective now costs a branch, a PR and a gate pass.**
That is correct rather than regrettable — it is a `loop` diff and it is reviewed like one.

### The template, and the cap that lives in it

```
# <iteration> — retrospective · <persona>

commit: <the SHA of the repo state this persona read>
fed-with: <the artifacts this dispatch carried, listed>

## Finding 1 — <one line>
what I saw · the artifact that shows it · what it costs · the change I propose, or the price of
leaving it

## Finding 2 — <one line>
(optional — two is the ceiling, not a quota)

## What I would leave alone
```

**At most TWO findings per persona, the persona choosing which two.** The cap is in the template because
that is the strongest place available: **it is checkable by reading — count the `## Finding` headings —
and it is not gateable.** Nothing in this harness can count findings in prose and tell a long report from
a short one; a `PreToolUse` guard reads a command string and a `Stop` hook cannot distinguish a proposal
from a paragraph. **A rule that is checkable by reading and not by running is the honest maximum here**,
and it is written down as such rather than presented as enforcement.

**`quality-assurance` writes a file here, and that is a deliberate narrowing of its own brief.** Its
brief says its `Write` grant exists for one purpose — composing its verdict body in the session
scratchpad — and that *a Write to any repo path is a defect in the review*. That sentence is scoped to a
**review** dispatch, and `agents/quality-assurance.md` now says so. The cost is real and is named where
it lands: an absolute rule became a conditional one, and conditionality is what erodes rules.

## Step 5 — the output is a PROPOSAL, and the owner rules on it

**Nothing here files an Issue, and nothing here changes anything.** The sections are proposals; the owner
decides at planning which, if any, become `loop` items. This is already mechanical rather than
promised — `permission-guard.sh` rule 5c denies `gh issue create` to every subagent but `developer` —
and the rite adds no second control over it.

**Only the owner opens work.** A rite that filed its own findings would convert one decision into a
queue, which is `/agents-configuration`'s *Review does not open work* applied to a ceremony.

## What this costs the NEXT iteration — the amplification, stated where the rite is defined

**A retrospective finding is `loop`-typed, and every link of the chain that follows is already merged.**

1. ~~A `loop` Issue joins the **active** iteration at filing (#338).~~ **Struck 2026-08-30 (#365): a
   ratified finding is filed with NO milestone and reaches the NEXT iteration's planning**, which is the
   owner's own rule for exactly this source of items — *«review e retrospective geram issues somente ao
   final do sprint e submetidos a priorizacao do backlog do proximo»*.
2. Every eligible `loop` item is composed **ahead of every `product` item** at planning (#339).

**The displacement is UNCHANGED and only its timing moved — which is the part worth reading twice.**
Under #338 the findings landed in the iteration the rite was closing, so its scope changed at the moment
it closed and its completion bar became uninterpretable. Under #365 they land unassigned and are composed
at the next planning. **They still displace the product work there, by rule (#339)** — fifteen findings
do not queue behind it. What #365 buys is that the displacement is now something the owner *decides*, in
front of the whole set, rather than something that has already happened to an iteration he thought was
finishing.

**And a second cost nobody has priced.** Every one of those items needs an `sp:N` before the drain may
enter, and a `loop` item takes a median of two estimators. Fifteen findings is **thirty estimation
dispatches** standing between the owner and the next drain, surfaced one at a time by the preflight —
the bootstrap cost of the 128-dispatch first pass arriving in miniature, once per iteration.

**This is why the cap is two per persona.** Six personas at two findings is twelve items, not fifteen,
and the difference is the whole margin. **Read the number as the reason for the cap, not as a promise
that the cap holds** — nothing measures it.

## What nothing enforces, said before any green is read

- **Nothing fires this.** There is no hook. `/autonomy on` names it at its terminal condition; that is
  an instruction, and by this loop's own test — *would something stop me, or only my memory?* — it is
  not engineered.
- **Nothing observes that it ran, or that it ran correctly.** No registered hook reads the
  queue — because none selects a `--label` or a `--milestone`, **not** because every `gh issue` call
  there is a write path, which is false at head (two are reads). A rite skipped, a rite run over the wrong
  iteration, and a rite run with three personas instead of six are indistinguishable from the tracker.
- **Nothing bounds the volume.** The cap is in a template. See step 4.
- **`hooks/scripts/inventory-counts.test.sh` asserts this file's rules are WRITTEN.** It cannot assert
  that a session obeyed any of them, and no arm anywhere claims otherwise.

**Every layer was walked and none can carry any of it.** That is a finding recorded in ADR-0002's
twenty-sixth amendment, not an omission to be repaired later by someone who assumes nobody looked.

## What this cannot catch

- **Anything no persona met.** Each reports only what it saw in its own context, and no persona saw the
  whole iteration except the orchestrator — whose contribution is precisely what the isolation excludes.
  **A defect that lived between two contexts is invisible to this rite by construction.**
- **Anything a persona that left no `dispatch-metrics` comment saw.** See step 2's lower bound.
- **Every defect a reader would meet.** Those are the review half's class, and the review half is
  **`/sprint-review`, which runs before this rite** (#379). This rite finds defects in the **method**; a
  browser sweep finds none of them, and this finds none of a browser sweep's. **The complementarity is
  unchanged by the other half existing** — two rites, two blind spots, neither covering the other.

## The sprint review half IS built now — `/sprint-review` (#379), and the refusal it satisfied

~~## The sprint review half is NOT built, and this is where that is recorded~~ — **struck 2026-09-02
(#379).** This heading was the record of the deferral for three days, and it is struck in place rather
than deleted because it is what every reader of this rite took away about the other half. **The rite
exists: `skills/sprint-review/SKILL.md`, driven by `product-lead`, run FIRST of the three closing rites.**

**The refusal below was SATISFIED, not lifted, and that distinction is the whole design of what
replaced it.** Both grounds were about the review's *shape*, and both were built into it:

- **the route list** — the rite ships **no list**. Its targets come from the consuming repo's own route
  generator, the same function the sitemap and the prerender consume, so a route that exists is in the
  set by construction; its assets are read off the page itself through the network log and the DOM
  snapshot; and only the viewport set is enumerated, which the rite names as its one place staleness
  can enter. **It also declares itself a lower bound**, because route × viewport × assets is not the
  whole surface — an emulated phone is not the phone the original defects were found on.
- **the ruler** — the rite is **not a gate and returns no verdict**, stated in its own second section
  rather than added afterwards, which is the form this section demanded of it.

**What was NOT satisfied and is recorded as an open residual:** nothing fires the sweep, nothing
observes that it ran, and its own failure is loud only because it is instructed to be. It is an
instruction, exactly as this rite is.

**The original deferral, kept verbatim below, because the grounds are the design constraints anyone
changing that rite must still meet:**

**Deliberately deferred, not forgotten.** The half that sweeps the running product in a browser is a
different rite with a different actor, a different input and a different class of finding, and it was
kept out of this slice on two measured grounds rather than on cost:

- **A route list rots**, and a sweep whose list is stale is a green that proves nothing. The defects that
  motivated the ask — a banner off-centre horizontally, then vertically, and a preview bar rendering
  without its link — were found on a phone, at a viewport and on an asset no route list would have
  enumerated by name.
- **The looker's finding is not falsifiable.** It is taste, and this repository's own rule is that a
  gate with no ruler grades taste. So the review **must not be a gate and must not return a verdict** —
  whenever it is built, it produces observations for the owner and nothing else, and that must be said
  in the mechanism rather than afterwards.

**One premise of the original deferral is now false and is corrected here rather than left standing.**
`/agents-configuration` records that REVIEW cannot run unattended because *"no MCP server is reachable
from a dispatched subagent"*. That was true when it was written and is not true now: `product-lead`
declares a read-only `chrome-devtools` subset ~~with a bounded origin~~ *(no origin bound since
2026-10-29, mhw#224 decision D8)*. **The obstacle was never the
browser** — it is a route list that rots and a finding with no ruler, both of which survive the new
capability intact.

~~**The cheapest first slice of the review half is not a sweep at all**, and it is named here so the next
person does not re-derive it: a `SessionStart` arm reading merged PRs that carry
`APPROVE-AND-MERGE-BOUNDARY`.~~ **Struck 2026-09-02 (#379): the owner declined the cheap slice and
chose the full rite, so this is no longer a *first step*.** ~~ADR-0002 amendment #16's booked residual
… **is DISCHARGED by the sweep's report file** … The arm … is now an *addition* to a sweep that exists
rather than a substitute for one that did not.~~ **Struck in the same MR's first review round: that
overclaimed, and the arm is NOT an optional addition.** The residual books three clauses and the sweep
delivers one — a post-deploy look now leaves an artifact, but the report records that **`product-lead`**
looked rather than the owner, and it surfaces **nothing per-merge**. **So the arm is the OPEN HALF of a
partially-discharged residual**, still unbuilt, and it remains the right next thing to build for the two
clauses the sweep cannot reach. The clause-by-clause split is with amendment #16's own bullet.
