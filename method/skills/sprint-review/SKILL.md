---
name: "sprint-review"
description: "Sweep the running product at iteration close — the live surface, derived rather than listed, at more than one viewport and in every locale, and report what a reader would meet at a derived lower bound. Use when the drain reports its entry snapshot exhausted, or when the owner types it against an iteration worked by hand. It returns observations for the owner, never a verdict, and it gates nothing. It takes an optional iteration title as its argument, typed after its name; without one it uses the active iteration."
purpose: "give the closing of an iteration a look at the running product, because every gate in this loop reads a diff and none of them can see a page that renders wrong"
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
> Claude Code `/sprint-review`, Codex `$sprint-review`, Kiro `/sprint-review`. Any agent harness may also load it
> on its own when the task matches its description; the rite's steps and its owner acts are
> unchanged by that.

Run the sprint review for the iteration the owner named after this skill's name (default: the active
iteration, derived from the pool per `/agents-configuration` rule 1 — **enumerate, never type a milestone name**).

**This file is the second half of a promise that has been plural since #326.** `/autonomy on` has said
*"the closing ceremonies run against the exhausted iteration"* since then; `/sprint-retrospective`
(#355) was the first half and said in its own last section that this half was **not built**. It is
built now, and that section is struck rather than deleted, because it is what told every reader the
half was refused.

## What this is, and the two things it is not

**It is an OBSERVATION SWEEP of the running product.** Merge is deploy under `trunk-single-env`, so
there is no staging copy and no preview: the thing being looked at is what a reader is looking at.

**And it is a LOWER BOUND. Said here, first, before the three axes argue that the objection is
answered.** Its targets are derived rather than listed, which is what stops them rotting — it does not
make them complete. An interaction-gated surface is unreachable under a read-only browser grant,
anything time- or state-dependent is invisible, and **an emulated phone is not the phone the motivating
defects were found on.** *This paragraph is here because it was not: the admission sat at 63% of the
file, after the reader had been told three times that the objection was answered, and this file's own
instruction is to state it in the rite rather than after it. A reader who stops at the end of axis 3 —
the natural stopping point, since the file has just declared the objection answered — must not leave
believing coverage is closed.* The full residual is under *And the sweep is INCOMPLETE* below.

**It is NOT a gate, and it returns NO verdict.** This is not a preference and it is not a posture that
could be tightened later — it is what makes the rite admissible at all. The finding a looker produces
is *taste plus observation*, and this repository's own rule is that
**a gate with no ruler grades taste**. Every finding here is advisory and droppable, including the mechanical ones. The gates that
can block already ran, per PR, on the diff.

**And it is NOT a defect hunt over the diff.** `quality-assurance` reads diffs, twice per merge, under
two lenses. This rite exists for the class no diff carries: a banner off-centre, a preview bar
rendering without its link, a layout that reads wrong at 390px. **Those were found by the owner on his
phone, after every gate went green.** That is the gap, stated as the reason rather than as a slogan.

## The trigger, and where it sits among the three rites

**The drain reaching exhaustion of its ENTRY SNAPSHOT** — the same signal `/sprint-retrospective` uses,
read against `/autonomy on`'s own terminal condition rather than against a second definition invented
here. **The typed fallback is this file's `argument-hint` and it is not a lesser path:** an iteration
worked without `/autonomy on` never reaches the mechanical trigger, so the owner types it.

**It runs FIRST of the three, and the order is Scrum's own:**

> **`/sprint-review` → `/sprint-retrospective` → `/sprint-planning`.**

Two independent reasons, and either alone would settle it:

1. **Legibility, which is why the rites carry Scrum names at all.** In Scrum the Sprint Review precedes
   the Sprint Retrospective. A reader who knows the events and finds them in a different order has been
   handed a name that no longer helps him predict anything, which is the whole of what the naming was
   for.
2. **The retrospective feeds each consulted persona its OWN artifacts, and this rite's report is on
   that list.** Run second, it would be an artifact produced after the consultation that would have
   read it. **The list is `skills/sprint-retrospective/SKILL.md`'s step 3, and it is closed** — check the
   bullet naming `docs/iteration-sweep/<iteration>.md` is there, because that bullet is the whole of
   this reason. **It was NOT there when this sentence was first written**, and the same slice added it
   after a review found the reason resting on a consumption relationship that did not exist. Read that
   as the shape to watch: a mechanical reason is only mechanical while the mechanism names it.

**Nothing sequences these.** No hook fires any of the three; the order is an instruction in a command
file, and by this loop's own test — *would something stop me, or only my memory?* — it is not
engineered.

## Step 0 — confirm the browser bound BEFORE anything is derived or dispatched (#525)

**Run this first, in the session that will dispatch, before the route generator runs and before any
persona is dispatched.** The browser this rite drives is bounded by `--allowedUrlPattern`, with the
value of `HARNESS_SWEEP_ORIGIN` or, when that is unset, empty or not an `http://` or `https://` value,
`http://127.0.0.1:9/*`. ~~`.mcp.json`'s
`--allowedUrlPattern ${HARNESS_SWEEP_ORIGIN:-http://127.0.0.1:9/*}`~~ *(struck 2026-10-13, mhw#174: the
server is no longer the plugin's `.mcp.json`. The workstation renders it into the Claude Code user
configuration, and its shell reads the variable when the server starts, so a project's settings `env`
reaches it. mhw ADR-0038 records why: Claude Code 2.1.296 expands `${…}` in server arguments before it
applies a project's settings `env`.)* The default is the discard port,
so the bound fails closed: with no origin declared, the browser can reach nothing. **Until #525 the
rite learned that only by dispatching a sweep that could only write FAILED.** In three closes in a
row the shipped server rendered no sweep (sprint-02, sprint-03, sprint-04, recorded in
`docs/retrospective/sprint-04/product-lead.md`, Finding 1). Two of those closes, sprint-02 and
sprint-04, wrote FAILED. Sprint-03 rendered its routes only through a browser outside the bound, and
its report reads *completed with named gaps*, not FAILED.

**The probe reads the SERVER, not the environment.** It prints the argument the browser server was
actually launched with, from the process table:

```
ps -ax -o pid=,ppid=,args= | grep -E -- 'chrome-devtools-mcp[^ ]* .*--allowedUrlPattern ' | grep -v grep | grep -oE -- '--allowedUrlPattern [^ ]+'
# measured 2026-09-28, Claude Code 2.1.283, variable unset in the session:
# -> --allowedUrlPattern http://127.0.0.1:9/*
```

**The probe requires the package name before the flag on the same line.** The line that carries the
flag is the `npm exec chrome-devtools-mcp@…` launcher. Its node child does not repeat the arguments.
Measured on the same host with a non-server wrapper running,
`sh -c 'sleep 40; : --allowedUrlPattern https://example.org/*'`: the looser form
`grep -E -- '--allowedUrlPattern'` printed three lines. They were the harness's own quoted eval
wrapper, the `sh -c` line with the complete value unquoted, and the real server. The form above
printed only the server line.

**Why the process and not `printenv HARNESS_SWEEP_ORIGIN`.** The environment says what the session
holds. It does not say what the host passed to the server. A host that does not expand
`${…}` in a plugin's server arguments hands the server the literal string, so `printenv` can pass
while the server still fails. That is the sprint-02 hypothesis: *"Failed to construct 'URLPattern': A
base URL must be provided for a relative constructor string"*. The argv shows the literal when that
happens, so the probe catches it where an environment check would not.

**Classify what it prints. Exactly one outcome proceeds.** If it prints more than one line, proceed
only when one of them equals the tracked declaration, and list all the lines in the dispatch:

| the probe prints | meaning | outcome |
|---|---|---|
| nothing | no browser server is running on this host, or this host's shell cannot see the process table | **`SWEEP-ORIGIN-UNBOUND`** |
| a value beginning `$` | the host passed the argument **unexpanded** | **`SWEEP-ORIGIN-UNBOUND`** |
| `http://127.0.0.1:9/*` | the fail-closed default: nothing declared an origin | **`SWEEP-ORIGIN-UNBOUND`** |
| any other value, and it **differs** from the origin the consuming repository declares in its tracked configuration | bound to something other than production | **`SWEEP-ORIGIN-UNBOUND`** |
| a value **equal to** that tracked declaration | the precondition holds | **proceed**, and put the observed pattern in the driver's dispatch |

**If the consuming repository declares no origin in tracked configuration, the outcome is
`SWEEP-ORIGIN-UNBOUND` too.** The only way the bound could then carry a real origin is an untracked
source, such as a shell profile. The owner ruled that out as the carrier on #525: *«pq vc precisa de
uma variavel no shell profile para algo que deveria ser baseado em uma ancora de comportamento de
harness?»*. With no tracked value, "production" has nothing to be compared against.

**Read the declaration only from the consuming repository's tracked file. Never take it from memory,
from the environment, or from a domain you remember.** Which file holds it and which key names it
belong to the carrier's own design, in the consuming repository, and are not defined here. Until that
carrier exists and defines its read, the no-declaration paragraph above decides every case, so the
last two rows of the table cannot be reached.

### On `SWEEP-ORIGIN-UNBOUND`: stop, emit ONE action line, dispatch nothing

**This is an ACTION pendency, not a decision.** The loop cannot perform the fix. The server starts with
the session, so a new value takes effect only after a restart, and only the owner restarts a session.
Emit exactly one line, carrying the act and where to act:

```
SWEEP-ORIGIN-UNBOUND — declare the production sweep origin in <consumer>'s tracked config, restart the session, rerun /sprint-review: <link to that carrier, or to the Issue tracking it>
```

**The line always points at the consuming repository's TRACKED carrier. It never tells anyone to
`export` a variable in a shell.** A shell profile is per machine and untracked, and no review sees it.
Another host or a fresh checkout loses the value silently. The carrier itself is the consumer's
decision and lives in the consumer's repository, never here: this plugin names no domain.

**Nothing is written for this outcome.** No persona is dispatched, so no sweep report exists for the
iteration. Pay attention to that cost: the retrospective that follows finds no
`docs/iteration-sweep/<iteration>.md`, which reads the same as a rite nobody ran. The action line is the
only record, and it lives in the session.

### `FAILED` is reserved for failures AFTER step 0 held

**`SWEEP-ORIGIN-UNBOUND` and `FAILED` are different literals on purpose, and a missing origin that
step 0 observes never produces `FAILED`.** `FAILED` means the precondition was observed to hold and
the sweep still broke: the generator did not run, a navigation errored, or fewer routes were visited
than emitted. A missing origin is not a sweep failure. It is a sweep that should not have started.
Writing a missing or malformed origin as `FAILED` is how two of those three closes, sprint-02 and
sprint-04, produced reports that recorded an absence, and how *FAILED* began to read as the rite's
normal output. For sprint-02, "missing or malformed" is deliberate: the retrospective's hypothesis is
an unexpanded `$` literal. **The exception is a missing origin step 0 cannot observe, and it has two
known instances.** In the first, another session's server satisfies the probe. In the second, a
wrapper or test process prints the declared value. In both, this session's bound is still missing and
the first navigation fails as `FAILED`. Both are listed under *What step 0 does NOT establish* below.

### What step 0 does NOT establish

- **That Chrome accepts the pattern, or that the origin answers.** The probe reads argv. The first
  navigation is the first real test of the bound. If it fails after step 0 passed, that is a
  legitimate `FAILED`.
- **Which session owns the process.** `ps` lists every browser server on the host. With more than one
  session open, a line from another session can satisfy the probe. That error runs toward
  *proceeding*, and it is visible: the first navigation then fails loudly as `FAILED`. It is not
  silent.
- **That every matching line is a server.** `ps` prints argv joined by spaces, without quoting. So a
  wrapper or test process whose argv names the package and then the flag with the complete value
  prints that value exactly. Step 0 cannot tell it from a server. Measured:
  `sh -c 'sleep 30; : chrome-devtools-mcp --allowedUrlPattern https://example.org/*'` satisfies the
  probe above. If that value equals the declaration while the real server is still on the default,
  step 0 proceeds. That error runs toward *proceeding*, and it shows up as `FAILED` at the first
  navigation, like the multi-session case. Requiring the package name narrows this case but does not
  close it.
- **The `=value` spelling.** A server launched with `--allowedUrlPattern=<pattern>` prints nothing,
  because the probe matches only the spaced form that the rendered server uses. That error also runs
  toward stopping.
- **Which server the driver's tools reach, when the consumer declares its own.** If the consumer
  declares its own `chrome-devtools` server, the probe prints two lines, the user-scope server's value and
  the consumer's origin. Whether the driver's calls go to the second one is the consumer carrier's own
  measurement, not this probe's.
- **Anything on Codex, which is UNMEASURED.** Two open questions. Does Codex expand
  `${HARNESS_SWEEP_ORIGIN:-…}` in a plugin server's arguments? Can Codex's sandboxed shell see the
  process table at all? Neither has been measured. If the shell cannot see the table, the probe prints
  nothing and stops the rite, so that error runs toward stopping. **The probe is also the instrument
  that settles the first question.** The next Codex close that runs step 0 prints the argv the server
  actually received. A `$` literal while the variable is set confirms the sprint-02 hypothesis.
- **That anyone ran it.** Step 0 is an instruction in this file, like the rite's order. Nothing
  fires it, and nothing observes that it was skipped.

## The driver is `product-lead`, and that is a MEASUREMENT rather than a preference

**Dispatch `product-lead`, once.** It is the only persona in the roster holding a browser, and the
brief it already carries — *"You hold a browser — the ITERATION-CLOSE REGRESSION SWEEP of the live
site"* — is the mechanical half of this rite in full: the derivation, the two halves, the fail-loud
rule, the report path. **This file is the rite; that brief is the procedure.** Read them as one thing
and do not restate either inside the other.

**The owner named that persona for it, and his reason is the constraint on everything below** —
*«ele tem a visao de proposito conectada a engenharia»*: the purpose-view held together with enough
engineering to know what a failed request was serving. A console error read by someone who does not
know what the page was for is a line nobody can act on.

**Any other driver is denied by a hook, and this was measured rather than assumed.**
`hooks/scripts/mcp-guard.sh` grants the browser to that persona by name and denies every other
`agent_type` by default:

```
printf '%s' '{"tool_name":"mcp__plugin_tadeumendonca-skills_chrome-devtools__navigate_page","agent_type":"<plugin>:quality-assurance"}' \
  | bash hooks/scripts/mcp-guard.sh
# → permissionDecision: "deny" — "holds no MCP grant … New personas default to DENY here"
```

**So a rite driven by the gatekeeper would fail at its first navigation**, and the repair would be a
second MCP grant — widening a surface that was deliberately narrowed to one persona and one read-only
tool subset. **That is a decision, not an implementation detail**, and it is recorded in ADR-0002's
thirtieth amendment rather than taken here.

**The second reason is about the rite rather than about the hook, and it survives the hook changing.**
The gatekeeper's whole discipline is a ruler external to itself — the Issue's requirements, the
Definition of Done. **This rite deliberately has no ruler.** Handing a rite with no ruler to the one
persona built around one produces either a verdict nobody asked for or a gate with no ground, and both
are the failure this rite's own shape refuses.

### What the choice COSTS, because two reasons for it and no price is not how this file argues

**The driver's competence is split, and only half of it is native.** The judgement half is squarely
its own — layout that reads wrong, wording against `published-voice`, cross-surface staleness. **The
mechanical half is not a product judgement**, and `agents/product-lead.md` states the risk in its own
words: *"the risk is that you under-read console noise a builder would recognise."*

**The compensation is already in that brief and is not restated here: the mechanical half is a
CHECKLIST WITH A COUNT, not an opinion.** Per route the answer is *evidence or not*, and
*"I looked and it seemed fine"* is not one of the values — which, with the two counts leading the
report, is what stops inexperience on that half producing a false green.

**Read the compensation as a bound rather than a cure.** A checklist catches the console error that
was *logged*; it does not make the reader of that line know what it was serving. **That residual is the
price of this driver, and it is paid rather than closed** — the alternative drivers cost either a
second MCP grant or a ruler this rite does not have.

## The hard part: how the sweep knows what to look at, without a list that rots

**A route list rots**, and a sweep whose list is stale reports green over the routes nobody enumerated.
That objection was the reason this half stayed unbuilt, and it is answered here in three axes rather
than argued away. **Two are derived. The third is not enumerable at all, and the rite says so.**

### Axis 1 — the routes are DERIVED from the artifact that already defines them

**Run the consuming repo's own route generator.** Do not type a route list, and do not read one out of
this file — this rite ships no list, deliberately. The concrete command belongs to the consumer and is
named in `agents/product-lead.md`, which is entitled to name it; the property is what matters here:

> **The generator that emits the sweep's targets is the same function the sitemap and the prerender
> consume.** A route that exists in the product is in that list *by construction*, and a route that is
> added without appearing in it is broken for search engines before it is missed by this sweep.

**It is a list, and it does not rot**, because **nothing maintains it FOR THIS SWEEP**: the sweep's copy
is generated at the moment it runs, and its staleness is not a state the product can be in while
working.

**Read that qualifier narrowly — a generator may well hold a hand-written array inside it, and this one
does.** What makes the axis sound is not that no human edits anything upstream; it is the property
above: **the sweep and the product's own published surface consume the same function**, so a route the
sweep cannot see is a route the sitemap and the prerender cannot see either. **If the generator cannot
be run, that is a FAILED sweep, not a sweep with a smaller list.**

### Axis 2 — the viewport is a closed set, and it is where the motivating defects lived

**Every route is looked at on a phone viewport and a desktop viewport, in every locale.** This is a
list, it is small, and it is enumerated in the rite rather than derived — so it is stated as the one
place staleness can enter: **a viewport class the product starts caring about (a tablet, a foldable, a
print stylesheet) is invisible here until someone adds it.**

That is a real residual and it is cheap only because the set is short and its members change rarely.
**It is named here so it is a known bound rather than a discovery.**

**Two of the three motivating defects are this axis's**, and they are named rather than counted:
the banner off-centre **horizontally**, and then — after that fix shipped — the same banner off-centre
**vertically**. Both were mis-positioning visible only at a rendered width; **neither would have
appeared in a network log**, because the image loaded correctly every time.

~~The three defects that motivated this rite were all found at a viewport, so this axis is not
overhead — it is the axis.~~ **Struck in review, and the reason generalises past this sentence.** The
same three-defect set was claimed as decisive here *and* under axis 3, with a universal quantifier in
both places and no attribution in either — and under the readings that make both sentences true
(everything on a phone is at some viewport; a banner is an asset), **neither claim could be falsified.**
A claim true under every reading is a frame, not evidence. Attributed above and under axis 3.

### Axis 3 — the assets are read OFF THE PAGE, and this is the axis no list could have held

**Do not enumerate assets.** The page states its own, and two read-only browser tools answer for them
without anyone writing anything down:

- **the network log** — a missing image, a 404 on a font, a failed API call. A broken asset announces
  itself as a failed request; nothing had to know its name in advance.
- **the accessibility/DOM snapshot** — an element that rendered without the thing it was for. *A preview
  bar rendering without its link* is exactly this shape, and it is why the snapshot is taken per route
  rather than only when something looks wrong.

**This axis is the direct answer to the objection, and ONE of the three motivating defects is its
instance** — *a preview bar rendering without its link*: an element that rendered without the thing it
was for, on a surface no route list would have enumerated by name. No list here does, because the page
is the enumerator. *(The other two are axis 2's; see there. The attribution is deliberate — the same
evidence set was previously claimed as decisive for both axes, universally, which made neither claim
falsifiable.)*

**And the honest consequence of attributing rather than counting: the NETWORK-LOG half of this axis has
no motivating instance at all.** All three defects were things that rendered *wrongly*, not things that
failed to load. The network log is here on the argument that a broken asset announces itself without
anyone knowing its name in advance — which is sound and is **not** evidence from the defects this rite
was built for. Read it as the cheaper half of a two-tool axis, carried on reasoning, while the snapshot
half is carried on an instance.

### And the sweep is INCOMPLETE. It says so, in the report, every time

**Route × viewport × the page's own assets is a product of three derived-or-small sets, and it is still
a lower bound.** State this in the rite rather than after it, because a sweep that reads as complete is
worse than one that admits it is not:

- **Anything behind an interaction the sweep does not perform.** The browser grant is read-only —
  `evaluate_script`, `fill`, `type_text`, `upload_file` and `handle_dialog` are denied by
  `mcp-guard.sh` — so anything reachable only by entering data is out of reach by construction.
- **Anything time-, data- or state-dependent.** The sweep sees one moment, logged out, on a throwaway
  profile.
- **Anything an emulated phone renders differently from a real one.** The defects that motivated this
  rite were found on **an actual phone**; the sweep emulates one. **This is the residual most likely to
  matter, and nothing here closes it.**

**So the honest claim is a lower bound, in those words, in the report.** The counts are what make the
bound checkable rather than rhetorical: `routes emitted: N / routes visited: N`.

## The report — two halves, reported SEPARATELY, and its failure is LOUD

**`product-lead` writes the report itself**, to the consuming repo, one file per iteration, at the path
its own brief names. It is not relayed through the orchestrator: relaying is the aggregation the
closing rites' isolation exists to prevent, already ruled on for the retrospective, and the same
argument applies unchanged.

**The two halves never merge into one list**, because merging makes the first invisible inside the
second and the first is the one that means someone has to act tonight:

| half | what a finding is | who acts |
|---|---|---|
| **mechanical** | evidence — it rendered or it did not, the request failed or it did not | the owner, possibly tonight |
| **judgement** | observation plus taste, labelled as taste | the owner, at the next planning |

**An empty section that says it is empty is a result. A missing section is a step that silently did not
run.** Both headings appear every time.

**A sweep that could not reach the site reports FAILED, never "no findings".** That holds *after*
step 0 held. A bound that never pointed at the site is `SWEEP-ORIGIN-UNBOUND` and is caught before any
dispatch (see *Step 0*). The rite runs at
iteration close, which is exactly the moment nobody is watching, and a clean-looking report is precisely
what a broken sweep produces if it is allowed to. The conditions are in `agents/product-lead.md`; the
rule here is that **the two counts lead the report**, because a reader who sees no counts at all knows
nothing and will assume the best.

## The output is a PROPOSAL, and the owner opens whatever becomes work

**Nothing here files an Issue and nothing here changes anything.** The judgement findings are candidates
for the next iteration and `/sprint-planning` reads them alongside the retrospective's proposals; the
owner rules on each. This is already mechanical rather than promised — `permission-guard.sh` rule 5c
denies `gh issue create` to every subagent but `developer`, and **rule 5e denies this rite's driver
three subcommands by name: `gh pr comment`, `gh issue comment` and `gh issue create`** — and the rite
adds no second control over it.

**Read that as three subcommands and not as "every public surface", which is what this paragraph said
until it was corrected in review.** `gh pr create`, `gh pr edit` and a `git push` are **untouched** by
rule 5e — measured, same payload shape, only the command varying: `gh pr comment` denies,
`gh pr create` draws no decision. The driver's own brief says so in bold, and the overclaim was worse
here than anywhere else in this file, because **this is the paragraph whose job is to say the
containment is mechanical rather than promised.** A reader who takes *"every public surface"* at face
value believes a boundary is closed that is open — in the one place the file is asserting there is
nothing left to promise.

**A sweep finding must never be relayed as a BLOCKING truth finding.** That veto is about *the truth of
a published claim*. A broken image, a console error and a bad line-break at 390px are none of them
claims, and dressing one as a truth finding would convert an advisory rite into a merge blocker through
the one door its driver holds. **This is an instruction and nothing enforces it.**

## What nothing enforces, said before any green is read

- **Nothing fires this.** `/autonomy on` names it at its terminal condition; that is an instruction in a
  command file. ~~No hook can be built for it: nothing in `hooks/scripts/` reads the queue — every
  `gh issue` call there is a write path~~ — **struck 2026-09-09, and BOTH halves were wrong, in
  different ways.** *The reason:* two `gh issue` calls in `closure-artifact-guard.sh` are live READS —
  an Issue body by number, and **closed** Issues in a rolling date window. *The conclusion:*
  `hooks/scripts/cadence-notice.sh` **is** a hook built for this rite. **Keep the two words apart, which
  is the whole of the correction — and this rite is the one where the second word is also negative:**
  **NOTICING is built for the two rites whose artifact root is declared `here`, and is declared INERT
  for THIS one.** `docs/loop-cadence.md` declares `/sprint-review`'s root `sibling`, so the carrier
  names this rite and reports it *"in the CONSUMING repository. Not observable from this tree"* — it
  returns before reading any date, and `sibling` is a static declaration in the record rather than a
  path relative to `cwd`, so the answer is the same from either tree. **FIRING is not built for any of
  the three, and did not move** — no
  layer can observe a snapshot going empty, because no registered hook selects a `--label` or a
  `--milestone`, and a hook receives one `cwd` while an iteration is two milestone objects in two
  repositories. A notice is a report; a report is not a trigger and cannot dispatch.
- **Nothing observes that it ran, or that it ran over the right iteration.** A skipped sweep, a sweep
  run over the wrong iteration and a sweep that visited four routes of eighteen are indistinguishable
  from the tracker.
- **Nothing bounds what it reports.** There is no cap, deliberately: the mechanical half's size is a
  property of the site rather than of the reporter, and capping it would hide failures. The judgement
  half is bounded by the same instruction the retrospective uses and by nothing else.
- **Nothing scopes the driver's `Write`.** It is instructed to write one report file; nothing stops it
  writing elsewhere. `content-reviewer` carries the identical unenforced shape.
- **`hooks/scripts/inventory-counts.test.sh` asserts this file's rules are WRITTEN.** It cannot assert
  that a session obeyed any of them, and no arm anywhere claims otherwise.

## What this rite cannot see

- **Anything outside the three axes above.** See *And the sweep is INCOMPLETE*.
- **Anything only a logged-in reader meets.** No agent authenticates, and that rule is not suspended
  because a tool made it easy.
- **Whether a finding is worth acting on.** It has no ruler for layout and only one for wording
  (`published-voice`, quoted by clause or it is a preference, not a finding). That asymmetry is
  deliberate and is not repaired by inventing a design standard at the moment one is needed.
- **Every defect in the method.** Those are `/sprint-retrospective`'s class. **This rite finds none of
  them, and that rite finds none of these** — which is why there are two, and why the plural in
  *"the closing ceremonies"* is finally true.
