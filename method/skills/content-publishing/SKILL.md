---
name: "content-publishing"
description: "Move a finished piece through the whole lane it travels — the owner's selection, the drafting pair and its two-round bound, the reviewer that REPAIRS a copy defect in place rather than blocking on it, the held preview at the real URL, release, and the social pair in the same batch. Use when a piece is being taken from a ready Issue to live, or when someone needs to know which step runs unattended and which one waits on the owner."
purpose: "give the content lane one written pipeline, so the steps that wait on the owner are named before they are discovered and nobody reads the held preview's isolation as privacy"
---

> **Read this first: hooks named below are the retired plugin's, not controls you have (#61).** This
> text moved from the `tadeumendonca-skills` plugin. Where it names a plugin hook, guard rule or test
> (`hooks/…`, `permission-guard.sh` and its numbered rules, `mcp-guard.sh`, `inventory-counts.test.sh`
> and the like), it describes that plugin; **none of those runs in this method**. Read any rule they
> held as an **instruction you follow**. What is still mechanical, where the workstation installed it:
> the **deny floor** (native deny rules by command prefix — force-push, `git reset --hard`, recursive `rm`, `git clean -f`,
> squash merge, secret writes, `gh api` write methods, `gh repo delete`/`archive`/`rename`, releases and
> package publishing, `terraform apply`/`destroy`, `sudo`), and **each agent's own tool list**, which is
> native in Claude Code and Kiro and an instruction in Codex. The session checks that replaced the
> plugin's reporting hooks are in `agents-configuration`, *Session-start and end-of-turn checks*.

# Content publishing — the lane a piece travels from selection to live, and who waits at each step

`published-voice` judges the **text**. This skill **moves** it. Nothing here restates a rule about how
prose should read; if you are about to, you have left this file and are inventing a second copy of a
ruler two personas already share.

## Why this exists at all

**The lane was implemented and never written down anywhere a session reads.** Every step of it existed —
an interview at capture, a drafting persona, a reviewing pair, a truth veto *(which since 2026-09-03 is
a repair inside the rounds rather than a veto at the gate — step 5)*, a preview affordance, a
distribution generator — and the only place the *order* of them was recorded was a decision record in the
consuming product's own library, which is opened by someone who already knows to look for it.

The cost is measurable and it is not hypothetical: a session asked to put a finished article in front of
the owner offered a rendered artifact instead, because it did not know the platform had a preview mode
scoped and built for exactly that. The owner's correction is the reason this file exists —
*«o modo preview nao é um skill?»* · *«voce trabalhando na producao de um artigo deveria utiliza-lo ao
final para mandar para revisao»*.

**So this is the pipeline, end to end, with one column that matters more than the others: who is waiting.**

## The rule this skill exists to carry

**The owner's words, and they are the load-bearing sentence of the whole file:**

> *«ao final de fechar o texto de um artigo voce deveria fazer o primeiro deploy dele no modo preview e
> me enviar o link para revisao inplace»*

**Read it as: closing the text is not the end of drafting — the first deploy is.** The piece goes out
**held**, and what reaches him is **the link**. Not a paste, not a file, not a rendered artifact, not a
summary. The real page, the real chrome, the real URL, reviewed **in place**.

**The portable rule, stated so it survives leaving this platform:** *the first deploy is part of
drafting, and the author reviews the real artifact in place rather than a representation of it.* Every
representation — a mock, an artifact, a screenshot, a paste — answers a different question than the one
the reviewer is actually asking, which is *how does this land*. The spelling below is one worked example
of that rule, not the rule.

## The one thing that makes this lane different from every other

**Work of this type is SELECTED, one piece at a time, by the owner. It is not a queue and it is not
drained.** Every other lane in this loop reaches a builder through an autonomous drain over a pool
predicate. This one does not, deliberately: the drain's pool is *(the product type OR the loop type) AND
ready*, and that predicate excludes this lane by construction rather than by an exception written into
the drain.

**`ready` on an Issue of this type therefore does NOT mean queued.** It means the description is closed
and the piece is eligible to be chosen. Reading it as a queue is the single most likely way to get this
lane wrong, because on every other lane the two words mean the same thing.

**What that buys and what it costs, stated as a trade rather than as a feature.** It buys the owner
control over what he publishes and when, which is the whole point on a surface whose subject is his own
professional presence. It costs **visibility**: a lane that is never admitted to an iteration is absent
from every iteration-scoped artifact this loop produces — the completion bar, the closing rites, and the
briefs those rites derive. Measured in this harness over one full iteration window, the lane ran the
entire time and appears in none of them; the drafting persona was consulted at the closing rite only
because an unrelated machinery item happened to dispatch it once.

**That is the price of the design, not a defect to fix here.** Do not "fix" it by admitting pieces to an
iteration — that reverses the owner's standing rule. Know that the iteration axis under-reports this lane
and read any iteration report accordingly.

## The pipeline

Each step names its state: **AFK** (runs unattended), **HITL** (waits on the owner), or **UNBUILT**
(nothing carries it; a person does it or it does not happen).

**Step 10's second half is none of the three, and the legend says so rather than rounding it to the
nearest one (#399).** Since the 2026-09-10 ruling the post is performed by the **harness**, in a session
the owner is present for — it does not wait on him, so it is not HITL, and his presence is the entire
containment, so calling it AFK would delete the only thing standing behind the act. A three-value legend
that cannot express *the harness acts and a human being there is the control* would force the one step
with no containment to be labelled like the steps that have one.

**No step below is UNBUILT, and the label is in the legend so that answer is stated rather than
inferred from its absence.** Every step of this lane exists. What does not exist is anything that
*fires* them in sequence — see *What nothing enforces*, which is a different claim and the one that
matters.

### 1 · Capture — the Issue is filed, after an interview · **HITL**

Intake on this lane is not the two-lead intake and not the machinery intake. It is an **owner interview
at capture**, one question at a time, no multiple choice, and his answer recorded **verbatim** rather
than tidied — because the recorded take *is* the source the drafting persona cites for the stance, and a
paraphrase is a stance with no attributable origin.

**The operative wording, the required question, the follow-ups and the two spellings of the marker that
records his take (or its dated absence) live in the intake command, and are deliberately not restated
here.** One rule from it is worth carrying because it decides whether this step blocks: **one line and
stop still opens the Issue.** An interview that costs him a sitting is one he routes around within a
week, and then there is no interview at all.

#### The SOURCE TEST — asked at capture, never discovered at the tenth edit

**Where a piece is built on an EXTERNAL source — a talk, a paper, someone else's argument — the
interview answers one more question before the Issue is filed:**

> **Is the source reachable by whoever will draft, in a form that can be quoted?** Transcript, paper,
> published text — or nothing. **Record the answer, and record it as a dated absence when it is
> nothing.**

**This step did not exist, and its absence cost three days on one piece.** The primary source was a
talk with no transcript indexed anywhere and no reachable route to one; every attribution was the
owner's recollection. **Three review rounds recorded that as a PUBLICATION RISK — a truth question —
and not one of them named it as a CONSTRUCTION constraint, which is what it actually was.** Each time
the draft needed substance from the talk it had one remembered sentence and filled the rest with the
only material within reach: the owner's own repositories. His verdict on the result, verbatim:

> *«nao decompunha os conceitos do video»* · *«nao conectava com nosso publico alvo»*

**The failure is structural and no amount of editing reaches it.** A piece whose spine is an external
argument, drafted against one remembered sentence, becomes a piece about the drafter's own material
wearing the source's title — and every repair round edits the symptom.

**What the answer CHANGES, which is why it belongs at capture rather than in a review round:**

| the source is | what the piece may be |
|---|---|
| **reachable and quotable** | a piece that decomposes the source's argument, quoting it |
| **unreachable** | a piece where the source is the **trigger** and the owner's own material is the **subject** — stated as that at capture, so the spine is designed for it rather than discovered fighting it |

**The second row is not a lesser piece.** It is the piece this lane can actually build, and the whole
cost of the episode was spending ten edits arriving at it instead of one question.

**What this test CANNOT do.** It cannot tell whether a *reachable* source was read, or read correctly
— the sourcing constraint and the reviewer's second repair ground govern that. It cannot judge whether
the owner's recollection is **accurate**, which stays a publication risk exactly as before; this test
is about what may be BUILT, and the two questions are independent. **And nothing fires it:** no hook
in this plugin reads an Issue body for a source field, capture is an interview rather than a tool call,
and no layer observes either. It is an instruction, held by whoever runs the interview and by the lens
that closes the description.

### 2 · Description closed, `ready` applied · **AFK — and the label here is the LEAD's, not the owner's**

**Do not carry the machinery lane's rule across.** On a loop-typed item `ready` is ~~the owner's
transition alone~~ the owner's decision, applied by the main session once aligned with him (struck
2026-09-25, owner ruling on #512); on this lane the product lens closes the description **and** applies the label, so
step 2 needs nobody but a dispatch. The owner's next appearance is step 3, and it is a different act
from applying a label.

The product lens closes the description alone on this lane — intake only. It takes **no part** in the
drafting rounds that follow, and that split is not a matter of taste: **intake judges the ISSUE** (worth
doing, against what else, bounded how) and a drafting round **judges the PROSE**. The act that decides
whether the Issue should exist never enters the flow that produces prose.

~~Its **blocking truth veto on published claims survives untouched** and is a different act again — it
fires at the merge gate, not inside a round.~~ **Struck 2026-09-03: on this lane that veto is gone.**
What the product lens keeps here is **intake and nothing else** — it closes the description and decides
`ready`, because intake judges the **Issue** and a round judges the **prose**. The copy lens is the
reviewer's now, exercised in step 5 as a repair. See step 6.

### 3 · Selection · **HITL, and there is no substitute for it**

The owner names the piece. Nothing derives it, nothing ranks it, and no drain reaches it. **This is the
step most likely to be skipped by a session that has read the other lanes' rules and assumes this one
works the same way.**

### 4 · Draft · **AFK**

The drafting persona works from material the owner already has — it shapes, cuts, structures and
translates an experience, a decision or a result; it never originates one on his behalf. It drafts onto
tracked files and **posts to no public surface directly**. In this method that containment is an
instruction in its brief; the plugin's persona-scoped guard rule that made it mechanical is retired (#61).

### 5 · Review rounds · **AFK, bounded at two**

The reviewing persona reads the draft against **the same ruler the drafter drafted against** — that
shared ruler is the only reason the pair is worth its cost, since two personas reading two copies of a
rule produce two opinions rather than a conflict.

- **It REPAIRS the draft in place; it does not block and it does not hand back.** Owner's ruling
  2026-09-03: *«ele pode resolver e mandar ajustado para preview em vez de bloquear»*. The corrected
  piece goes to the held preview and the owner reads **the result** rather than a verdict about it.
- **It edits on exactly two grounds and on nothing else** — it can **quote a clause** of that ruler, or
  the claim is **false against the source**, with the source the only permitted supply of the
  replacement. Everything else is advisory-and-droppable and the prose is left alone. **That bar is now
  the only thing between a review and a rewrite**, which is why it is stated as a hard edge rather than
  as a severity scale.
- **A false claim the source cannot settle is the one thing it cannot repair** — editing would mean
  inventing the replacement, which the ruler forbids. Its own clause prescribes the remedy: cut the
  claim, and record in the round that it was cut and what would settle whether it comes back. **This
  does not stop the piece.**
- **At most two rounds. There is no round three.** The bound still binds — it is the pair's only
  mechanical stopping rule — but round one is now terminal in the ordinary case whichever literal it
  carries, because re-reading an edit the reviewer made itself produces no information. **Round two
  exists only where the draft changed by another hand.**
- The rounds land in a **tracked review file on the branch**, one section per round, each closed with one
  of two literals. That file is the artifact; there is no comment and no relayed claim.

**This half of the pair is the least exercised thing in the lane, and the skill says so rather than
describing it as routine.** Read the two facts together, because separately each one misleads:

```
# in the repo the drafts live in — the artifact trail
grep -cE '^## Round' docs/content-review/*.md
```

Measured over one full iteration window in this harness: **six drafts, twelve round sections** — the pair
demonstrably ran. And in the same window the loop's **dispatch metric recorded zero dispatches for that
persona in either repository**, which is why a closing rite first excluded it from its own consult set
and had to add it back by hand after the artifacts falsified the metric. **The metric under-reports this
lane exactly as the iteration axis does**, and for the same reason: both are keyed on objects a selected
lane never acquires. Trust the review files; do not trust a dispatch count about this lane.

~~**A residual the rounds carry, from the pair's own retrospective and not from theory:** the two-round
bound is spent on *finding*, so a fix the reviewer prescribed in round 1 is read back in round 2 by the
persona that wrote it, and there is no round left to verify it. Two of six drafts terminated with citable
findings outstanding.~~ **Struck 2026-09-03: the reviewer repairs rather than prescribes, so no
prescription is left waiting for a round that does not exist.** Struck rather than deleted because the
measurement behind it is real and is what the ruling answers.

**The residual MOVED rather than closing, and this is its new shape: nobody re-reads the repair.** The
authorship bias that made a second reader worth paying for now sits on the reviewer's own edit. Two
things absorb it and neither is an instrument — the owner reading the held preview, and the merge gate
reading the diff. And unchanged from before: **nothing mechanical distinguishes a legitimate re-open
from a third round wearing a new heading number, because the terminal condition is a section count and
the section count is authored by the persona the bound constrains.**

#### Five checks the rounds now run, and every one is a RULER clause finally reaching the lane

**Not one is a new judgement. Each is an existing ratified clause that had no step where anybody asked
it**, which is why all five were missed on a piece that passed two rounds clear and then four owner
read-throughs. **Three of them — 3, 4 and 5 — are clauses the ruler did not carry AT ALL until
2026-09-18**, so no reviewer could have raised them however carefully it read.

1. **Do the SPINE SURFACES name the same article as the body?** Title, excerpt and takeaway are the
   three most-read surfaces and the only ones that travel without the body — an index row, an OG card,
   a social unfurl. On the piece these findings came from, a re-spine left all three describing a
   different article from its body **for days**, and it surfaced only because the owner said twice that
   the title did not carry the structure. **Nothing pairs them**, so the check is: read the three
   fields, then read the body's section headings, and name any concept present in one and absent in the
   other. **A mismatch is a ground-1 finding the reviewer may raise and usually CANNOT repair** — a
   re-spine is authorship, not a repair in place, exactly as a split is.
2. **Does the BODY contain the act the title promises?** The ruler's title gate requires the title to
   make the reader want to run an experiment; **the lane had no step where anyone asked whether the
   body contains one.** On this piece it did not, so every gate-passing candidate wrote a cheque the
   article never covered. The check is the ruler's own close clause, read against the body rather than
   against the title.
3. **Does the piece state its TAKEAWAYS explicitly, with one of them reinforced visually?** The ruler's
   rule 16, on his ruling — *«todo artigo tem que ter takeaways explicitos, algum elemento visual para
   reforço»*. **The check has a boundary that is easy to lose:** a takeaway is not a summary, and the
   test is *read the candidate alone with the article covered — if nothing is left, it is a summary*.
   **The frontmatter `takeaway` field does NOT discharge this** — it renders on the index card, not in
   the article, so a reader meets it before the piece and never inside it.
4. **Does the piece end with the SIGNATURE, in both editions?** The ruler's rule 17, ratified
   2026-07-30 and named nowhere in this harness until 2026-09-18. **It is the most repairable finding
   on this list** — a missing final line is an edit in place rather than authorship — and it is the one
   the pair has been dropping silently, because no clause existed to raise it with.

5. **Does every VERBATIM external quotation carry the author's name ON the block?** The ruler's rule
   18, on his ruling — *«bota nas citacoes o nome do autor tbm»*. **Attribution in the prose lead-in
   does not discharge it**, and it matters more on a piece whose source link has been removed, because
   the prose is then the reader's only signal. **The word VERBATIM is the whole safety of this check:**
   a rendered or paraphrased idea attributed on the block puts the owner's sentence in someone else's
   mouth, which is a false claim manufactured by obeying a rule. **A reviewer that cannot tell which it
   is must ask, never attribute.**

**What none of these checks can do.** All five are reader-side judgements about **presence**, so a
reviewer can
say a concept is missing and cannot say the pairing is *good*. Both are run by a persona reading a
draft, and **no layer observes a draft being read** — `PreToolUse` is registered on `Bash` and on the
MCP matcher only, so `Write` and `Edit` are seen by nothing and neither check can ever be more than an
instruction.

#### OPEN, not resolved here: the two-round bound can be reset by the party it constrains

**The bound's terminal condition is a section count in a file the reviewing persona authors.** On this
piece the counter was reset by the **orchestrator** after five owner rulings had replaced the artifact
rounds 1 and 2 had read, and the merge gate accepted the reset for that diff **while pushing back on
the rule** — its objection is the one to carry: *a bound that can be reset by the party it constrains
is not a bound.*

**Both readings are defensible and that is the problem.** Rounds spent on an artifact that no longer
exists are not rounds spent on this draft; equally, *"the piece changed"* is available on every piece
and turns a bound into a formality. **This is with the owner and unanswered. It is recorded here and
deliberately not decided** — the lane does not get to settle its own stopping rule, and nothing in this
skill changes the bound.

**When the rounds terminate, the TEXT is closed and the piece is NOT finished.** By the owner's rule
above, the next act is the first deploy — steps 6 and 7 — not a message to him carrying the words. **Do
not stop here and hand him prose.**

### 6 · The merge gate · **AFK — and since 2026-09-03 no copy hold reaches this lane at all**

The gate reviews the diff under both its lenses like any other change. Publishing in the owner's voice
is a **boundary-class** change, so the verdict says so — and on this harness the gate merges the
boundary class under its own distinct verdict literal rather than holding it, with the owner reviewing
live after deploy.

~~and relays the product lens's **blocking truth veto on published claims**.~~

~~**Of the four holds that stop the gate merging, exactly one is this lane's**: a `BLOCKING` truth
finding from the product lens, or an explicit lens escalation. The other three — an expansion of the
gate's own authority, a machinery diff missing its reviewer's marker, and anything touching
infrastructure — are not reached by a piece of prose and its front matter. **So the honest statement is
that this step is AFK with one live exception, not that it is gated.**~~

~~**A truth finding is the one thing in this lane that stops it dead**, and it stops it at the gate
rather than in a round. That is later than a round and it is deliberate: the veto is about *what is
claimed*, which is not the ruler the rounds apply.~~

**All three struck 2026-09-03. There is no copy BLOCK left on this lane — and the check did not vanish,
it moved one step earlier and changed form.** What used to hold the merge is now a repair inside step 5,
where it costs a sentence instead of a round. Struck rather than deleted because a reader who sees a
hold disappear assumes the coverage disappeared with it.

**So none of the four holds is this lane's**, and the step is AFK with no live exception rather than
with one. What the gate still owes on a `content` diff is its own criterion 10, in the second shape that
criterion took on the same day: **no relayed verdict and no `copy-verdict` fence — instead the review
file on the branch, with a round section and a terminal literal — plus, unchanged, any claim the gate can
itself falsify against a checkable source.**

**The cost of losing the veto here, stated because nothing replaced it:** the reviewer's grounds reach
the ruler and the source, never the world. Cross-surface staleness, evidence proximity, the machine/ATS
read and durability go unread on this lane. The owner accepted that when he ruled — he reads the piece
at the held preview — and the honest form is that the trade bought earliness and spent a world-check.

### 7 · The held preview — the FIRST DEPLOY · **AFK to build, HITL to pass**

The piece is merged and deployed **held**: built, compiled, reachable at its final URL, in the real
components and the real chrome, and absent from every public enumeration. **You send the link. He reads
it there.**

#### The link is FORMED from the artifact, and only then sent

**No link reaches him that was not built from the file it points at.** This is a rule about
**formation**, applied at the moment the URL is composed — not a verification performed afterwards,
because on this architecture the verification that would rescue a wrongly-composed URL does not exist.

**SCOPE, and it must be read before the rule or the rule looks reversed.** This governs **the PREVIEW
link sent to the owner at this step** — not the SHARE link in a social post, which is step 10's and is
governed by `published-voice`'s rule 21. **The two are opposite on purpose and neither is a drift.**
The preview link is locale-prefixed **because he reviews one edition at a time** and because a held
piece is prerendered in no edition at all, so there is nothing for a neutral form to resolve to here.
The share link is neutral because its reader's own language should decide. **Do not "reconcile" them:
a sweep that made this section neutral would send him a link to a page that does not exist.**

**IS:** every segment is read out of the artifact. The **locale prefix** of the edition you are
sending, and the **slug from that edition's own front matter**. Each edition declares its own slug, and
the two are different strings — translating a title translates its slug with it.

**IS NOT**, and each of these has produced or would produce a link that does not open:

- **Not the other edition's slug.** Sending one language's edition under the other language's slug is
  the defect that actually shipped. Slugs are per-edition and the lookup is scoped to the locale asked
  for, so the wrong-language slug matches nothing at all.
- **Not the slug inferred from the filename.** On a multi-edition piece the filename base is the
  **grouping key**, not the slug — it is only what a slug falls back to when the front matter declares
  none, and any piece whose editions have distinct addresses declares one.
- **Not a slug composed from the title.** A slug is authored, and a piece can be retitled without being
  re-addressed.
- **Not "it returned `200`."** This one is stated in full, because it is what let the wrong link
  through. The catch-all rewrite answers `200` for **every** path, including one that does not exist —
  so a status code cannot distinguish a real address from a typo. And a **held** piece is dropped from
  the route enumeration, so it is prerendered in **no** edition: the right URL and the wrong one are
  served **the same bytes**, and only the client-side render tells them apart. A status code, a header
  and a grep of the served HTML are all blind here by construction rather than by oversight. **This is
  the general class in `/engineering-standards` — *a check whose positive result is unconditional is
  not a check* — arriving on this lane.**

**What the two outcomes look like, since anything that ever does check must key on this and not on the
status:** the right slug renders the piece — its own title, its body, the review affordances. A wrong
slug renders the **not-found state**, at the same URL and the same status code. A right slug reached
**without** the preview parameter is a third outcome again, a redirect to the locale landing — which is
why *"it opened something"* is not the observation either.

**Reading the URL out of a generator would be stronger than reading front matter, and for this step it
is not available.** Every generator that emits a piece's URL derives it from the **one route
enumeration** — the sitemap and the prerender read it directly, the social-draft kit resolves against it
by lookup and refuses when nothing matches — and that enumeration **drops a held piece by construction**.
So the one state in which a link is sent to a human is the one state with no generated string to copy,
and the kit skips a held piece outright rather than letting its own lookup refuse.
**If this lane ever gains a generator that emits held-preview URLs, the rule becomes "read it from
there" and this section narrows to say so:** lookup removes the composition step entirely, where front
matter only makes the composition correct.

**Nothing enforces any of this.** No layer can tell a URL read from front matter from one typed from
memory — they are the same string in the same message. Read the rule as an instruction, and read a
sent link as unverified unless the person who composed it says which file each segment came from.

**The worked mechanism, and get it exact — this is the step that has been described wrongly more than
once.** The hold is:

- **An explicit flag in the piece's own front matter** — spelled `draft: true` here — and the page
  renders **only to a visitor arriving with `?preview`** on the final URL.
- **The flag is a SHARED FACT, not a per-edition field.** On a multi-locale site it is authored once for
  every edition of the piece, so a held edition sitting beside a published one — half an article
  published — is impossible by construction rather than by discipline. It is read as **`=== true`, never
  for truthiness**, so a YAML string `"false"` cannot silently hold a finished piece and a missing flag
  reads as published.
- **Five readers see the flag and four act on it.** The piece is dropped from the **public enumeration**
  (index, feed, filters, navigation) · dropped from the **route enumeration**, which is *sitemap and
  prerender together, from one source* · **no share card is required**, so none is generated and a stray
  one reddens the build · **no social draft kit** is produced. The fifth reader — the one that walks the
  content tree with no hold awareness — is deliberately unchanged, and the consequence is stated where
  that decision lives rather than treated as a gap.
- **The load-bearing line is a DIVERGENCE, not an exclusion.** The **public enumeration** loses the piece;
  the **resolution** index keeps it, so the URL still answers. Drop it from both and the page resolves to
  nothing and the piece can never be read before publication; drop it from neither and it is published.
  Everything about the hold follows from getting that one line right.
- **`?preview` is presence, never a value** — see the isolation section below for why a value would be
  actively worse than nothing.
- **Release is a SECOND COMMIT** that removes the flag. See step 9.

**Three alternatives were rejected by measurement rather than by preference, and they are recorded here
so nobody proposes them again:**

1. **A future-`date` runtime filter.** Rejected twice over. The nonce **still shipped in the built
   output** under the strongest possible form of the filter — so it bought isolation while its framing
   claimed privacy, which is worse than buying nothing. And a wall-clock comparison makes **the same
   commit build differently tomorrow**: rebuild a tag the day after its release and the artifact differs
   from the one that shipped, with nothing in the diff to explain it.
2. **A `drafts/` directory outside every reader.** Strongest option on the privacy axis — the exposure
   would hold *by construction* rather than by a filter — and it renders **nowhere**, while rendering at
   the final URL in the real components is the entire requirement. It survives as the upgrade path, not
   as this step.
3. **A per-piece secret token validated at the edge.** Structurally unbuildable here, both halves: an
   edge function's source is **committed to a public repository**, so any secret in it is published; and
   a held route is never prerendered, so it never reaches the function as a distinguishable path at all.

**This is the step the whole skill was asked for, and it has its own section below because its guarantee
is half of what its name suggests.**

### 8 · His validation · **HITL**

He validates, or sends it back. A send-back re-enters at step 4 or step 5, not at step 1.

### 9 · Release · **HITL to trigger, AFK to execute**

Promotion is **a second commit** carrying **one edit** — clear the hold flag, set the real date — and it
rebuilds nothing else. The
piece enters the index, the feed, the sitemap and the prerender in the same build, because the enumeration
that drops a held piece is the same one all of those derive from.

**Scheduling is a scheduled COMMIT, not a scheduled render.** Any mechanism that publishes by comparing
against a wall clock makes the same commit build differently tomorrow, and breaks it silently — a build
that differs from a build, not an error. A commit is strictly more auditable and is the honest
replacement.

### 10 · The social pair, in the same batch · **AFK to draft · the post is the HARNESS's, in an attended session**

**The label on the second half is not AFK and not HITL, and forcing it into either is what makes this
step read wrongly (#399).** The legend above defines HITL as *waits on the owner*, and since the
2026-09-10 ruling the post does not: **the orchestrator performs it.** But it is not AFK either — the
owner's presence in the session is not a convenience, it is **the whole containment**, in the ruling's
own words. So the honest label is the third thing: *the harness acts, and a human being in the chair is
the only thing standing behind it.*

**A publication is not done until it exists on both networks the platform publishes to.** Same batch as
the release — not "later", which in practice means one of the two never ships.

~~**The fan-out is deliberately NOT automated**, and the reason is worth carrying rather than
rediscovering: automating it means holding credentials for a class of unattended public writes.~~
**Struck 2026-09-11 (#399, owner's ruling 2026-09-10 — «O orquestrador, exceção registrada»).** Struck
rather than deleted because it is the sentence a reader took the containment from, and because it had
already been false for six days when it was struck: **the act ran on 2026-09-04**, through a browser,
posting to both networks in the owner's name. A rule describing a practice that has already been
reversed is worse than no rule — it reads as a live constraint.

**What is true instead, and it is three separate facts that must not be collapsed into one.**

1. **WHO. The orchestrator posts** — the main session, not a persona, not a text handed to the owner
   to paste. In this method (#61) the alternatives are closed as follows. **Connector access is the
   agent's own tool list:** no persona's list names a publishing connector, and `product-lead`'s browser
   grant excludes the input-carrying tools. That is native in Claude Code (measured for built-in tools
   on 2.1.289) and Kiro (documented); **Codex custom agents carry no tool list and inherit the parent's
   MCP servers, so there it is an instruction.** The public comment routes (`gh pr comment`,
   `gh issue comment`) are kept from `content-writer`, `content-reviewer` and `product-lead` by their
   briefs, an instruction. The plugin's `mcp-guard.sh` and rule 5e, which held both mechanically on
   Claude Code, are retired.

2. **WHICH HARNESS. The act has run through Claude in Chrome — a browser extension — and not through
   MCP.** The two have different containments and one of them has none. **No matcher in this plugin
   observes an extension act at all**, and in this method no hook runs (#61). A tool list names tools;
   a browser-extension act is not one of them.

3. **WHAT CONTAINS IT: nothing, and the ruling says so in its own words.** The accepted cost, quoted
   rather than paraphrased: *"The only accountability is the census's `W` arm — which reports **after**
   the act and blocks nothing. The whole containment becomes **a URL pattern plus a human in the
   chair**."* That census was the plugin's `orchestrator-tool-census.sh`; it is retired (#61), and its place
   is `agents-configuration`'s end-of-turn check 9, an instruction that lists what the orchestrator did
   with its own hands. **There is no layer
   anywhere that refuses a bad post.**

What is automated is the **cost the manual route actually has** — a generator scaffolds both drafts from
the piece's own frontmatter and **resolves the share URL by lookup in the route enumeration, failing when
no prerendered route matches**. Construction would produce a plausible string for a page that does not
exist; lookup refuses it.

~~Posting is his.~~ **Struck 2026-09-11 (#399): posting is the HARNESS's, by the ruling above.** The
second half is untouched and is now one of four things nothing verifies — see the table at the end of
this section.

**Five steps the lane carries, and each is labelled with what holds it.** ~~Three~~ ~~Four~~ — the
fourth and fifth both landed 2026-09-19, with rules 19–20 and rule 21; the count is stated here rather
than left to be counted, because a reader who takes a stale number from this sentence stops at that
bullet. **It has now moved twice in one day, which is the argument for stating it rather than for
dropping it.**

- **The share URL is FORMED locale-neutral, and only then tagged.** This is where
  `published-voice`'s rule 21 binds — **at formation, textually, before anything is posted**, which is
  the cheapest layer that can hold it and the same move step 7 makes for the preview link. **The two
  formation rules are opposite and both are right**: step 7 is locale-prefixed because the owner
  reviews one edition, this one is neutral because the reader's own language should decide. **Until
  the neutral form resolves to the ARTICLE the localized URL stays** — rule 21 states that precondition
  first, and a drafter checks it by comparing the SERVED CANONICAL against the REQUESTED PATH, never by
  a status code, because the catch-all rewrite answers `200` for a path that was never a page. *Held
  by: an instruction, at the moment the string is composed.*
- **The share URL is tagged.** Build it with `withShareUtm(url, source, AUTHOR_CAMPAIGN)` —
  `utm_source` per network — and put the tagged URL in the post body on **both** networks. The
  instrument exists and was not used: the 2026-09-04 pair carried no UTM at all, so that publication is
  attributable to neither of the two buckets the loop compares. **This is a LOWER BOUND and must be
  read as one** — a tagged URL is observed only when somebody clicks, so no rows means *nobody clicked*
  **or** *nobody posted*, and nothing separates the two. **Precondition, not a follow-up:** confirm the
  tagged form unfurls with the correct card **before** this step is mandatory. A query-tagged URL may be
  scraped as a distinct URL, which lands on the pinning surface below, and getting that wrong pins a
  wrong card permanently. *Held by: an instruction. Nothing reads the post.*
- **The OG card is checked BEFORE the post, not after.** One request: fetch the canonical URL and assert
  the `og:image` it declares returns 200 and is the per-article card. The failure this prevents is the
  least reversible act on this platform — **a scraper pins the card it first fetches, so a wrong card
  outlives the merge that fixed it.** *Held by: an instruction, and nothing else can hold it.* A
  `PreToolUse` hook on `Bash` never sees a browser act; ~~the `mcp__.*` matcher sees a tool name and not
  page state~~ **the `mcp__.*` matcher receives the full `tool_input`, so it sees the TYPED TEXT of the
  call — including a URL — and does NOT see PAGE STATE**; a `Stop` hook is one turn late with the pin
  already taken. **Written precondition at worst, detection at best, and there is no third option** —
  do not build something that reads as a refusal.

  **The strike is narrow and the conclusion above it is UNCHANGED**, which is the point of correcting
  it rather than deleting it. The OG card genuinely is page state — what a scraper fetched, what the
  page declares once rendered — so *"written precondition at worst, detection at best"* is correct for
  **this** bullet. **What the old wording was false about is the INPUT, and the input is where a URL
  lives** — so a reader who took *"the hook cannot see the text"* from it would close the inquiry for
  every clause on this lane that is about a typed string, which is a different and much larger class.
  **That is principle 12's named failure in its most expensive form: an answer that is TRUE and ends
  the investigation.**

  **Provenance, stated because it decides how much the correction is worth.** The payload shape was
  measured against build `2.1.278` with a probe plugin, one MCP call forced, the hook's stdin captured
  and its `deny` honoured — the captured stdin carried `tool_input` in full, with a nonce URL inside
  it, plus an `mcp_server` field. **That measurement is RELAYED here and was not re-derived in this
  slice.** What *is* checkable from this tree corroborates it rather than proving it:
  the plugin's retired `mcp-guard.sh` header said only that an MCP call has no `.tool_input.command` —
  **it never claimed `tool_input` itself was absent**.
- **The drain's `content` exclusion bounds who SELECTS a piece; it does not bound who can POST.**
  `/autonomy on`'s pool is `(product OR loop) AND ready AND active-iteration`, so this lane is out **by
  predicate rather than by exception** — which is the better design and is not the containment anyone
  should be crediting. **Nothing binds the publish act to a `content` Issue at all:** no lane check, no
  label check, no Issue check, on either route. The route into an unattended post is **any session**,
  not the drain, so admitting `content` to the drain is not what would open it.
- **A bilingual post is READ for its two language hints and for its length, BEFORE it is posted.**
  `published-voice`'s rule 19 — a one-line hint at the top in the language of the block it points at,
  a matching one-line marker immediately above the trailing block, 🇧🇷 on the Portuguese one and 🇺🇸 on
  the English one. **Since 2026-09-20 the English block LEADS and the Portuguese block TRAILS**, so on
  a bilingual post the opening hint is always the Portuguese one and the 🇺🇸 half of that clause has no
  live subject here — **a post that leads in Portuguese is a finding this step raises**, and it is as
  countable as the two markers are. And its
  rule 20, the target that is not the 3,000-character ceiling, read per language block. **Both are
  counted, not judged**, which is what makes this a step rather than an opinion: the two markers are
  either in the draft or they are not, and the block lengths are a character count. **The reason it is
  a step at all is that rule 19's element has been DRAFTED correctly exactly once and dropped on every
  post since** — it is the signature defect one surface over, and the owner caught it on the live post
  rather than in a round. **Read that as a claim about DRAFTING, not about the live corpus**: one post
  was brought into conformance on 2026-09-20 by editing the live body, which is a repair after the
  fact and is exactly what this step exists to make unnecessary. **A live surface repaired leaves no
  record in `docs/social/`**, so the corpus a later reading is derived from does not move when one
  happens. *Held by: an instruction, and nothing else.* `Write` and `Edit` are observed
  by no matcher in this plugin, and the post itself goes out through a browser extension that no
  matcher sees at all — so this cannot be more than a written precondition, exactly like the OG-card
  check above. **Neither rule is a merge hold**: no copy hold reaches this lane (step 6), so a post
  missing its hints ships unless somebody reads for it here.

**The drafts are written to a private, ignored location**, because pre-publication copy in a public
repository lets anyone read tomorrow's post today. **Existing files are never overwritten** — the prose
is hand-voiced after generation, and regenerating over it at this cadence buys nothing.

### What nothing enforces on this step — per decision, because flattened it reads as false

| decision | what actually holds it |
|---|---|
| the orchestrator is the only publisher | **the agents' tool lists** keep publishing connectors from every persona in Claude Code and Kiro (an instruction in Codex); **nothing** holds the orchestrator itself, and the browser-extension route has no matcher at all |
| a post is preceded by the OG-card check | **an instruction.** No layer sees page state |
| the share URL carries its campaign | **an instruction**, measurable after the fact as a lower bound only |
| both halves of the pair shipped | **nothing at post time.** Unchanged by any of this |
| a bilingual post carries its two language hints, and sits under the length target | **an instruction** (`published-voice` rules 19–20, 2026-09-19). The gate arm asserts the clauses are WRITTEN; nothing reads a draft, and no copy hold reaches this lane to refuse a post that dropped them |
| the share URL is locale-neutral | **an instruction** (rule 21, 2026-09-19), and it is **inert until the neutral form resolves** — so today what holds it is the precondition the rule states first. An MCP call carries the typed URL, which made a detector conceivable on that route; none exists in this method, and the route that has actually published is the browser extension no matcher sees |
| the publish act is accounted for | **an instruction**: `agents-configuration`'s end-of-turn check 9, after the act, gating nothing |

**By this loop's own test — *would something stop me, or only my memory?* — nothing on this step is
engineered**: the only native layer is the agents' tool lists, and they do not hold the orchestrator. That
is the ruling's accepted cost, written down rather than implied.

## The guarantee that must not be softened: ISOLATION is not PRIVACY

**This is the single most important sentence in this file: a held piece's full text ships in the public
bundle.**

Two different guarantees, and the architecture below delivers one of them cheaply and the other not at
all:

| | what it means | delivered? |
|---|---|---|
| **isolation** | nobody **arrives** — no link, no search result, no sitemap entry, no unfurled card | **yes** |
| **privacy** | the text is **not fetchable** by someone who knows where to look | **no, deliberately** |

**Why, mechanically.** Where the markdown is compiled into the bundle at build time, a runtime filter can
remove a piece from every list the site renders and **cannot** remove its body from the bytes the site
ships — the build-time glob has already resolved it. So the hold is a **divergence**, not an exclusion:
the piece leaves the *public enumeration* and stays in the *resolution* index, or the URL would resolve to
nothing and the piece could never be read before publication.

**A preview parameter is concealment, not enforcement**, on three independent counts, and each stands
alone:

1. the body is in the bundle regardless of any parameter;
2. the check runs in the browser, on code the visitor already holds;
3. a per-piece secret cannot exist in a public repository, and an edge gate on the piece's own URL would
   need per-piece state the edge does not have — while the request that actually carries the text is
   served by a different cache behaviour that no viewer-side function is attached to at all.

**Treat the parameter as presence, never as a value.** A value reads as a credential, and a credential
this mechanism cannot keep is worse than none: it invites the owner to share the URL believing the token
protects it.

**The falsifier, and it is worth running rather than trusting.** Build the static output and grep a nonce
that exists only in a held piece:

```
grep -c <a-nonce-that-exists-only-in-the-held-piece> <dist>/assets/index-*.js
```

Two occurrences on a two-locale site — one per edition. **The mutation that makes it a measurement rather
than a failed search:** move the piece out of the compiled content tree and re-run; the count must go to
zero. A held-state assertion that stays green on a published piece asserts nothing about the hold.

**What a reader gives up by choosing either side.** *Isolation:* roughly three days, no infrastructure
change, no new cloud resource, no new grant, and a draft merge stays out of the boundary class that
touches infrastructure — paid for with the exposure above. *Privacy:* about a week more, and it puts
**every draft merge** into that boundary class permanently, which is a standing cost on cadence rather
than a one-time build cost. **Nothing built for isolation is discarded if privacy is wanted later** — the
privacy package is a strict extension, so the cost of choosing isolation first is a delay and not a
rewrite.

**And say which one you are claiming, out loud, whenever this comes up.** The owner asked for both in one
conversation — *«o problema é isolar trafego organico»* and, separately, *«isso deveria me ajudar com o
requisito de privacidade»* — and the record that decided it delivers the first and states plainly that it
does not deliver the second. **If the second word was load-bearing rather than loose, the decision is
wrong**, and that counter-argument is recorded as unsettled rather than answered. Do not present the hold
as privacy to close the gap.

*(In this harness the decision, its three rejected options and its upgrade path are the consuming
product's own record `ADR-0049`, in that repository's library, not this one's.)*

## What nothing enforces — read this before describing the lane as a machine

**The pipeline is a sequence of named human moments with automation between them. It is not a button, and
this repository blocks on a mechanism presented as stronger than it is.**

- **Nothing fires this skill.** There is no hook, no matcher and no rite that reaches for it at the end
  of a draft. It is reached because a model reads its trigger, which is a discovery mechanism and not a
  control.
- **Nothing checks a held piece was actually read before release.** The promotion edit is one word; no
  artifact records that anyone opened the URL.
- **Nothing verifies the social pair shipped.** The generator writes drafts; ~~posting is manual~~
  **posting is the orchestrator's (#399)** and leaves no trace any gate reads. **Do not read the
  correction as a tightening** — it is the opposite: the act moved from a human's hands into the
  harness's, and the only thing watching it is a `Stop` hook that fires after the fact, covers the MCP
  route and is blind to the browser-extension route that has actually published.
- **Nothing observes a dispatch.** A piece drafted with no review round is indistinguishable from one
  whose rounds were clear until you open the branch's file list.
- **Nothing asks whether the SOURCE exists.** The source test above is an interview question; no hook
  reads an Issue body for it, and a piece can travel the whole lane built on one remembered sentence,
  as one did — the failure only becomes visible as prose the owner rejects, ten edits in.
- **Nothing pairs the frontmatter with the body.** Title, `excerpt` and `takeaway` can describe a
  different article from the one below them indefinitely; nothing in this tree reads the three fields
  against the section headings, and on the piece that produced these rules nothing did for days.
- **Nothing bounds the rounds against a party that can reset the counter.** The terminal condition is
  a section count in a file the reviewing persona authors, and the reset on the one piece where it
  mattered came from the orchestrator. That is open with the owner and is not decided here.
- **Nothing stops a held piece from being published by an edit to one word**, which is precisely why a
  committed fixture exists in the consuming product and every hold assertion runs against it.

**Applied to this lane, the standing test — *if this failed right now, would something stop me, or only
my memory?* — answers "only my memory" for every step above except the two that are mechanical: the
containment that keeps the drafting personas off public surfaces, and the gate's own merge floor.**
Everything else is an instruction. Say so when you describe it.

## Pros & cons

**Pros**
- The owner reads a finished piece at its **real URL in the real chrome**, before it is public — no
  artifact, no mock, no rendered stand-in.
- Isolation is cheap, needs no infrastructure change, and keeps a draft merge out of the boundary class.
- The drafting pair judges against **one ruler**, so its rounds produce a conflict rather than two
  opinions, and the bound stops the pair converting one piece into a queue.
- Reproducibility survives: nothing in the build reads a clock, so a rebuilt tag is the tag that shipped.

**Cons**
- **A held piece's text is public** to anyone who knows where to look. Isolation, not privacy.
- The lane is selected rather than drained, so it is **invisible to the iteration axis** and to any
  dispatch metric keyed on iteration objects — both under-report it, silently.
- The reviewer repairs its own findings, so **nobody re-reads the repair** — the authorship bias moved
  one step over rather than closing.
- **No world-check runs on this lane at all** since the copy veto left it: cross-surface staleness,
  evidence proximity, the machine/ATS read and durability reach the owner unread.
- ~~The social fan-out is manual by decision~~ — **the fan-out is the harness's act since the
  2026-09-10 ruling, and NOTHING contains it** on either route; nothing catches a publication that
  shipped to one network, and nothing refuses one that should not have shipped at all.

## Using this skill

Reach for it when a draft is finished, and again at every step that follows — it is the map of who is
waiting, not a checklist to tick. Before handing anything to the owner, be able to say **which step you
are at** and **whether the next one is yours or his**.

See also: `published-voice` (the ruler the drafting pair judges the text against — this file never
restates it), `agents-configuration` (the state machine this lane's rows sit in, and who acts at each
transition), `definition-of-ready` (what a closed description asserts before selection is possible), and
`documentation-standard` (where the decision behind a step like the hold gets recorded).
