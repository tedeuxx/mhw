---
name: "code-review"
description: "Run the author's own completeness pass before opening a merge request — every requirement marked met or unmet, every new assertion mutation-checked, what the change made false, alternative spellings of anything parsed, and the gates run with real output. Use when a slice is finished and not yet submitted, or when anticipating both of the gate's lenses. Not for the definition of done itself (see definition-of-done), or the CI/CD gates it anticipates (see quality-gates)."
purpose: "make the author verify their own completeness before a gate does, so a merge request arrives carrying its evidence rather than its claims"
---

Review your own slice for COMPLETENESS before opening the merge request. Author-side, run by `developer`, and distinct from the gatekeeper's review that comes after.

Context: $ARGUMENTS

## What this is, and what it is not

**An anticipation of both of the gate's lenses, run by the author.** `quality-assurance` will consolidate that every requirement of the Issue was met and every DoD item holds, **and** it will ask whether this can cause a problem in production — one gate, two rulers, since `security` was absorbed into it on 2026-08-04. **You answer both first, while fixing is still free.**

**The merge raised the value of this pass rather than lowering it.** There is no longer a second gatekeeper reading the same diff from a different direction, so a defect one of them would have caught is now caught once or not at all. §7 below is where that lands.

**You verify the DoD items here — you do not defer them.** The gate re-verifies independently, in a fresh context, and that independence is the point of having it. But arriving at the gate with the DoD unchecked outsources your own work to it, and every item it has to raise costs a round, a re-ratification and the owner's attention.

**Why it exists, measured rather than assumed.** Two hook slices in one session took **eight commits between them — six of those corrective, after review** (`tadeumendonca-skills` PRs #123 and #124; `gh pr view <n> --json commits` counts them). Reading back what each correction fixed, almost all of it was reachable by the author before opening:

- a flag spelling (`--base=x`) whose class had **already been hardened in the same file**;
- **seven assertions that could not fail** — three in one guard suite where the dangerous token sat inside a quote pair by accident, a `Storage.prototype` spy that never took, a case short-circuited by an earlier guard, a defence whose test never reached it, and a regression case that denied for a different reason than the one it named. Every one found by mutation; none by reading;
- doc drift in the second PR that was **the exact pattern the first PR had just taught**;
- a rule that could not read a body written the way this repo writes bodies — a convention the author had followed all day.

None needed a fresh context. They needed a list.

**A round costs a dispatch, a re-ratification and the owner's attention. This list costs minutes.**

*Why this skill and not a hook — the harness-design argument, and the owner's rule about where mechanism belongs — is at the end, under **Where the mechanism belongs**. The checklist comes first deliberately: a reader mid-slice is here for what to check.*

---

## 1 · Completeness, at both levels

### The task, and every artifact it owes

**Enumerate the Issue's requirements and mark each met or unmet, individually.** Not "implements the issue" — that consolidates nothing, and it is the sentence the gate rejects.

A thin slice owes **all of its artifacts, not just its code**: the application change, the infrastructure that serves it, the pipeline that ships it, the **automated E2E journey**, the tests written inline, the decision record if a boundary was crossed, and the documentation the change makes stale. An artifact missing is an artifact the gate will ask for.

- Any requirement you cannot mark met is **unfinished work**, not a note for the PR body. Finish it or cut the slice and say what you cut.
- If the description is not closed enough to enumerate — no stated acceptance, a requirement you would have to invent — **stop**. That is an intake failure, and building past it produces a slice that passes its gate and still fails the person who asked.
- **Nothing ships half-done.** Scope you cut, a gate you could not run, an assumption you made: say it in the PR body. The reviewer will find it; finding it in your own report is cheaper for everyone.

### The story, when this task closes it

If this is the **last** task under its story, the story's completeness is now the question — and the leads are about to ask it. Before opening:

- **every task under the story is implemented and merged**, not merely opened;
- the story delivers what its description promised, read against the intake ratification rather than against your memory of it;
- anything it does not deliver is **named**, and named as a task rather than as a caveat.

A story whose last task is green while an earlier one is still open is not finished — and that is a state only the author can see, since each task's own gate passed.

### The DoD, item by item

Verify these yourself. Each with **evidence** — a command's real output, a line in the diff — never "looks fine":

1. **Scope** — one thin vertical slice, no unrelated changes; adjacent debt reported, not fixed inline and not filed.
2. **Traceability** — references its Issue; acceptance covered by E2E journeys.
3. **Tests proportional** — inline, to the coverage floor; a user-visible change adds a green E2E story. §2 is how you check they can fail.
4. **Gates green with real evidence** — §8.
5. **Decision recorded** — an ADR if a significance boundary was crossed; otherwise say "no ADR" explicitly rather than silently.
6. **Observability** — name the artifact that proves the new behaviour where it runs. **`n/a` is a finding, not a shrug**: say what has no observable and why.
7. **No doc drift** — §3.
8. **History hygiene** — conventional subjects; a real merge commit, never squash.
9. **Security posture** — §7.
10. **Content truth** — decide whether the diff changes anything a reader or a crawler sees, and **say which in the PR body**. That is your half: the copy lens is dispatched by the gate, so "the lens has returned" is not a thing you can verify here — but a reader-facing diff that arrives unflagged is one the gate can miss, and a literal in a component or a meta tag counts as reader-facing.

## 2 · Every assertion must be able to fail

**Coverage cannot see this and neither can reading.** A tautological test executes the line, satisfies the threshold, and proves nothing.

> **Mutate the SOURCE, run the suite, count the reds. A new assertion that adds no red asserts nothing.**

Mutate the **source**, never the test — mutating the test proves only the composition you wrote. And after each: **restore, and re-run green.**

Two shapes that recur, both seen more than once:

- **Short-circuit.** The inputs satisfy an earlier guard, so the branch under test never runs. Choose inputs that clear every prior guard, and add a **control** asserting the opposite outcome without the condition.
- **Same literal on both sides.** Asserting `X` against a component built from `X`. Pin the *coupling* instead — read the rendered value and build the expectation from it — and put "is the value right" where a stale literal cannot pass.

**A stub that cannot distinguish the inputs cannot witness the rule.** If the test doubles answer identically whatever they are asked, no assertion in the suite can observe which input the code used.

## 3 · What did this slice make false?

A rule change leaves stale claims in places the diff does not touch.

> **Grep the repo for every identifier, command name, count and claim the slice made FALSE — search the words of the OLD claim, not the words you edited — and do not stop until every hit is read and dispositioned.**

An enumeration of places to look fails open: you check the four you remember. A grep returns the ones you forgot. **But only if you grep the right thing**, and the obvious instinct is the wrong one.

**Why "made false" and not "changed", which is what this line said for one day.** A stale claim survives precisely in the files the diff did **not** touch — and those files are phrased in the words of the *old, now-false* statement. The tokens you edited and the tokens that carry the claim are, in the general case, **disjoint sets**. Searching what you changed searches the one region guaranteed to be already correct, and it returns clean, which reads as *there is nothing there*. **It fails open** — the exact failure this section exists to close.

Measured, twice in one day, on the two slices that followed the one this file shipped in:

- the sweep ran on the term that was **edited** (`agent_type`) while the sentence reaching a sibling ADR was carried by *"no exempt spelling"* and *"denies `gh issue create`"* — neither of which appears in the diff. The gate blocked the merge on it;
- and an earlier round returned three hits and acted on two, which satisfies *"read every hit"* literally. Hence **dispositioned**: each hit gets an outcome — a fix, or a recorded finding that it is not drift.

**A list names the class; a procedure finds the instances** — the same difference §2 turns on. This section was itself rewritten from a list after failing on its own PR, and then corrected again when the procedure searched the wrong thing. *A procedure with the wrong input is a list that also reassures you.*

**A second failure mode, and it is the one that LOOKS like success: a sweep that converges on what a gate can see.** Run the grep, fix the hits that turn something red, watch the suite go green, and stop — because green is the signal you were trained to stop on. **Every remaining hit sits in a field nothing checks, and the sweep is now indistinguishable from a complete one right up until someone reads the prose.**

Measured, on the slice that moved a body of knowledge between two skills. **The claim was left false in every surface a gate does not read, and corrected in every surface one does — and nobody chose that split.** The criterion, not a count, because a count here would age the moment either set moves: *fixed* was exactly *has a gated quotation compared against its carrier*; *missed* was exactly *does not*. Among the missed was the moved file's **own `description:`** — the trigger whose entire job is routing a model to the thing it now carried, telling that model to look elsewhere. Nothing was red at any point.

Re-derive the set with the words of the **old** claim rather than trusting either list:

```
grep -rn "see quality-gates\|/quality-gates" skills/ docs/blueprint-registry.md agents/ commands/ README.md
```

> **Disposition the hits BEFORE running any suite, and count them against what you fixed.** If the number you fixed equals the number that would have gone red, that is not confirmation — it is the signature of a gate-driven sweep, and the remaining hits are in the ungated fields by construction.

The cheap structural check, because a field is gated or it is not and you can tell in one look: **for every record that carries a gated field, read its ungated siblings in the same breath.** A registry row whose quotation is compared to its carrier also carries a description, a purpose and a what-it-does that nothing compares to anything.

**And run the gates BETWEEN corrections, not once at the end.** A correction is a publication and can mint its own defect, so a batch of them landed together arrives as one red with several causes — or, worse, as a green that only holds because two errors were introduced in fields nothing reads. Measured on the slice this section was written from: of four self-minted defects, **the two the suite could see were caught by a mid-round run and would otherwise have shipped inside the fix for someone else's finding.** The cost is seconds; the alternative is a review round spent separating your own corrections from the thing you were correcting.

**And its limit, which is not a defect but is a thing to know: a phrase sweep finds RESTATEMENTS, never OMISSIONS.** A grep of the old claim cannot reach a place that should now say something and says nothing — it shares none of the words you are searching for. Measured: a rule was added to two persona files, an ADR and a state table, and the *procedural narration* an agent actually reads was missed by the sweep and found by reading. **So after the grep, ask separately: where does this repo TELL someone how to do this, and does that place now know?** This section is necessary and not sufficient, for the same reason it gives about lists.

Then read each hit against these, which is where the list still earns its place:

- the **README** or equivalent published description — **and any count or table it carries.** A number bumped by a test while the rows below it stay put is the shape this repo has shipped more than once;
- the **header of the file you changed** — a contract sentence at the top that the body now contradicts;
- the **principles skills and the ADRs** that describe the behaviour;
- **persona files**, if the change alters what a persona must produce or may do.

**Supersede, never rewrite.** Strike the old sentence with the reason it stopped being true. A silently edited claim invites the next sweep to revert the decision.

*The trap worth naming:* deferring this to a later slice fails, because the sentence becomes false **the moment this one merges** — leaving the documented behaviour contradicting the real one for however long the later slice takes.

## 4 · Alternative spellings, if the diff parses anything

If the change matches command strings, paths, branch names or labels, try the forms that are legal and not obvious:

- **attached values** — `--flag=value` and `-Fvalue`, not only `--flag value`;
- **inside quotes** — text that looks like a flag but never reaches the tool as one;
- **the second occurrence** — greedy `.*` takes the *last* match, not the first;
- **word boundaries** — a marker matching inside another word is not a marker;
- **case and prefix** variants of any name you anchor on.

Most of these have escaped a matcher in this repo at least once — the API matcher walked past a quoted URL, and the quote collapse stopped at an escaped quote. Try all five anyway; the list is short and the cost of skipping one is a review round.

## 5 · Does the repo already do this differently?

The convention you are about to break is usually **your own**, from earlier the same day:

- bodies and multi-line text go through `--body-file`, never inline;
- merge with a real merge commit, never squash;
- `git -C <dir>` / `npm --prefix <dir>` instead of `cd`;
- one atomic command per call — a preference for legibility, ~~no `&&` chains~~ **not a permission
  necessity since #383**, which measured that the matcher decomposes a chain and evaluates each element
  (`shell` carries the table).

**If your change makes a repo convention impossible to follow, the change is wrong** — not the convention.

## 6 · The tree is clean and it is yours

- **`git status` before committing.** Foreign changes mean a concurrent agent left work in the tree; committing them ships something nobody reviewed.
- **Reviewers run in the same working tree.** While a gate is reviewing, use a `git worktree` rather than the main checkout — a mutation for verification and an edit for authoring look identical to git, and both parties lose.
- **Verify the branch base.** A branch cut while another slice was mid-merge starts from the wrong commit and carries its diff into your PR.

## 7 · The question the Issue does not contain — anticipate the production lens

The sections above anticipate the delivery lens. This one anticipates the other, and it is the half most often skipped **because the Issue cannot prompt it**: *can this cause a problem in production?* is not enumerable in advance — if it were, it would be a requirement.

Name the axes you looked at and what you found, **the way the gate will**:

- **Dependencies** — a new package, a version change, a lockfile move.
- **Permissions and IAM** — anything widening what CI or the agent may do.
- **Secrets** — a value, a path, a private source quoted into something public.
- **Action pins** — a moving tag where a SHA belongs.
- **New external inputs** — anything the code now reads that someone else writes.
- **The deploy path** — does this merge publish, and does the artifact change?
- **The edge function** — logic running at the CDN edge, where a mistake serves every visitor and the rollback is a deploy.

> **`n/a` is only valid when you NAME the axes you checked and found untouched.** "No security impact" is a reassurance. *"`package.json` and both lockfiles are absent from the diff; no file under `iac/` or `.github/`; a secret-pattern scan over the diff returns nothing"* is a check.

**Verify the ARTIFACT, not the diff's appearance.** A comment-only change is not automatically inert: on a build that inlines and prerenders repository content, the question is whether an edited line can be **emitted**, which is a different question from whether it is a comment.

**And ask which direction a failure takes.** A guard that fails **open** stops protecting silently; one that fails **closed** wedges the loop loudly. Both are defects — but only one announces itself, so the silent direction is the one to check first. Trace every new error path and say where it lands.

**An early return is an allow path.** If the change adds one — an `exit 0`, a `return`, a `continue` — **enumerate every rule downstream of it and prove each is still reachable.** This is not the short-circuit of §2, which is about test inputs, nor the failure direction above, which is about errors: it is a *success* path that silently unreaches code the diff never touched, so every existing test still passes and coverage does not move. Measured: one such return let two commands through with no decision at all, neither of them the case the return was written for.

## 8 · Gates, with real output

Run them and paste what they printed. **Never a claim.**

- The suite you touched, plus the suites you did not — a change to one hook can redden another.
- Lint, typecheck, build.
- The functional regression: **E2E always; an API suite only where an API exists.**
- **A gate that skipped is not a gate that passed.** If a job matched no files, say so in those words.

---

## The one-line version

> **Would a stranger reading only the Issue agree this is finished; can every assertion you added fail; is every sentence this slice leaves behind still true; and can this break production?**

Four clauses because the sections are four jobs, and the mutation pass is the one most easily skipped — by this document's own count, it found seven defects that reading found none of.

If either answer needs a caveat, the caveat belongs in the PR body before the reviewer finds it.

## Where the mechanism belongs

The harness has two ways to hold a rule: a **hook**, which is mechanical and cannot be argued down, and a **skill**, which is only as strong as the reading. The floor belongs to hooks — irreversible acts need a guarantee that survives a long context and a tired session.

**But a hook is expensive, and it can only see a command string.** Measured on the slice that added one narrow exception to the floor: **five commits, four of them corrective, and three separate bypasses** — every fix a regex trying to infer intent from what the model happened to type, across attached flag values, a number that was not the declared one, and a body written to a file. Each fix was correct and each left the next spelling open, because *intent is not in the string*.

A rule about **what "finished" means** is exactly that class. No matcher can express it, and a guard that tried would be the same regex arms race one level up.

So the trade this skill takes deliberately: **a checklist the author follows, instead of a mechanism the author fights.** It is weaker — nothing enforces it — and it is the right weakness here, because what it checks is judgement rather than an act.

**The owner's rule for this harness, in their words — a rule here, not a claim about software in general:**

> **A shell script supporting the workflow of executing tasks is an antipattern.**

Read it as scoped to *this loop's* workflow layer. Plenty of shell earns its place in this repo — the gates, the counts, the tests — and none of that is what the rule is about.

The floor is not workflow. `terraform destroy`, `rm -rf`, `git reset --hard`, a push to the trunk — those escape git and no later commit undoes them, so they earn a mechanism. ~~a force-push … a secret write~~ — **struck (#383): escaping git and being irreparable are different properties, and this sentence used the first as evidence for the second.** A force-push leaves the old tip in the reflog and in the remote's unreachable objects; an AWS secret write sits behind a version stage and a recovery window. ~~Both reverse, so both earn a **question** rather than a refusal.~~ **Second strike, same day: both DO reverse, and they earn a refusal anyway — because this harness has no working middle rung.** A hook `ask` is answered automatically in its default working mode (measured: the guard returned `ask`, the act executed with no prompt), so *question* is not a verdict that reaches anyone. **Read the general lesson and not the instance: a control's ladder is only as long as the rungs the host actually honours, and which rungs those are is a measurement, not a reading of the docs.** A `gh secret set` does not reverse — Actions secrets have no version history — and would keep its refusal under either criterion. **WIP discipline, who may open an Issue, how a story is decomposed, what "finished" means — every one of those is reversible by the next commit**, and every one of them is a rule about judgement, which a matcher cannot read.

*The line, so it does not blur:* **if the act cannot be undone, it needs a hook. If it can be fixed in the next commit, a hook costs more than it returns** — and the cost is not hypothetical: it is review rounds spent on spellings, plus a guard the loop learns to work around rather than follow.

## Decision & trade-off

**An author-side anticipation of both gates, over relying on them to catch everything.** *Trade-off:* it deliberately overlaps what the gatekeepers check, and duplicated checks can drift apart. Accepted because the alternative was measured and is worse — eight rounds on two slices, with most findings reachable before opening.

**The overlap is the design, not a cost to minimise.** The author checks the DoD to *arrive finished*; the gate re-checks it in a fresh context with no authorship bias, which is the only reason its verdict means anything. Running it twice is not waste — running it *only at the gate* is, because every item raised there costs a round.

**When the two disagree, the gate wins.** It is the ruler, and it never inherits this pass as evidence: "the author checked" is not a verification, it is a claim.

**Not a gate itself.** Nothing enforces this and it must not become a required check. It is the author's own pass, and a checklist that blocks is a third gate nobody decided to add.
