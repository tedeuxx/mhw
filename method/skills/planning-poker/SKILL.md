---
name: "planning-poker"
description: "Run a planning poker estimation round, or diagnose why one produced theater instead of signal. Use when the agents estimate an item's sp:N weight, each dispatched in isolation with the median recorded, when sizing backlog items with a team, choosing between group-consensus estimation and a single person's gut call, or explaining why a session's numbers don't influence anything downstream. The agents of this method use it to estimate (see agents-configuration, Estimation)."
purpose: "give the estimating agents one consensus-estimation method, and say plainly what it buys and when a ceremony is not worth running at all"
---

# Planning Poker — consensus estimation, and what it is actually for

Apply this SDLC-generic technique in any `<project>` that estimates work with a human team. It sits
beside `/definition-of-ready` and `/definition-of-done` in this library's `principles` family, and it
is the same kind of thing: a concept a project either practices deliberately or drifts into practicing
badly, stated once so a team does not have to rediscover its failure modes the hard way.

~~**This is a reference pattern, not a description of anything this repo does.** `tadeumendonca-skills`' own loop, documented in `/agents-configuration`, runs no human estimation ceremony at all — the `scrum-master`, `product-owner` and `product-manager` personas that would once have run one were absorbed into `product-lead`, and the loop's own thesis replaced story points with mechanical, agent-graded criteria (`/definition-of-done`, proven by `/quality-gates`) as the thing that decides whether work is done. This skill exists because the library is explicitly broader than its current consumer — the same stance this repo takes about the `backend` family, which documents an architecture the consuming site retired. Nobody dispatches this skill inside this repo's own operation; it is here for the projects this plugin installs into that do run a human sizing ceremony.~~

**Struck 2026-10-05 (owner ruling on #61): *"planning-poker é usado pelos agentes."*** The agents of this method use this skill to estimate. The personas the loop names as estimators for each type (`agents-configuration`, *Estimation*) are each dispatched in isolation, and the median is recorded as the item's `sp:N` label. That is this skill's simultaneous reveal, carried by dispatch isolation instead of by a room. Struck rather than deleted because the reference-pattern claim stood in the description every agent harness reads, and a reader may have acted on it.

Context: $ARGUMENTS

## What it is, mechanically

A round: every estimator privately picks a card from a fixed scale (classic Fibonacci-ish —
0, 1, 2, 3, 5, 8, 13, 20, 40, 100, plus `?` for "I can't size this" and, sometimes, an infinity card for
"this needs to be broken down before anyone can size it"). Everyone reveals **simultaneously** — the
whole mechanism exists to prevent one voice anchoring the rest, see *Failure modes* below. Where the
votes cluster, the team takes the rough number and moves on. Where they diverge, the **outliers speak
first** — not to justify their number, but to surface what they saw that the middle of the room didn't —
and the group revotes once, informed by that discussion. Two rounds is the usual budget; a group that
cannot converge after the second round has usually found a scope problem, not an estimation problem (see
*Relationship to Definition of Ready*, below).

The mechanism's only real trick is the simultaneous reveal. Every other property of "planning poker" —
Fibonacci-like spacing, a `?` card, physical or virtual cards — is a convention around that one
mechanism, not the mechanism itself. A team that votes on paper slips at the same signal and reads them
aloud together is running planning poker; a team that goes around the table asking each person in turn
is not, whatever cards it uses.

## The reframe that should come before anything else

**The specific unit barely matters. What planning poker is actually building is a long-run estimate of
the team's velocity — not an accurate size for the item in front of it.** This inverts how the technique
is usually taught: most introductions frame it as "how do we estimate *this* story accurately," with the
group consensus process as a means to that per-item end. Treat the reframe as the spine of the technique
instead, because it changes what "doing it well" means. Under the usual framing, a session that produces
a wrong number for one story is a failure. Under the velocity framing, one wrong number barely matters —
what matters is that the team applies the **same relative scale, consistently**, sprint over sprint, so
that "we cleared 40 points last sprint" is a number worth planning against. Accuracy-per-item is close to
incidental; **consistency of process is the actual payoff.**

The practical consequences of taking this seriously:

- **The specific unit is a free choice, and changing it costs little as long as the change is
  deliberate.** Points, ideal hours, t-shirt sizes mapped to a number — none of it matters on its own
  terms. What matters is that the team does not silently redefine what a "3" means between sprints,
  because that is what breaks the velocity signal the technique exists to build.
- **A single session's number is not the deliverable.** The deliverable is the accumulated series across
  many sessions, which is why obsessing over getting one item "exactly right" mistakes the by-product for
  the point.
- **The technique earns its keep only if the ceremony survives contact with the calendar.** A team that
  runs it once and then stops, or runs it inconsistently, never accumulates the series that was the whole
  reason to run it — which is exactly the fourth failure mode below (the empty ritual), from a different
  angle.

## When the ceremony is worth it, read through the reframe

The conventional framing says "use planning poker for high-uncertainty items, skip the ceremony for
obvious ones" — and that is not wrong, but it is not the first question either, once the reframe above is
taken seriously. The first question is **whether this team needs a velocity signal at all.** A single
person doing solo, sporadic work has nothing to build a sprint-over-sprint series against, and no group to
converge; a gut-call estimate or a t-shirt size is the right-sized tool, not a lesser version of planning
poker. A team that ships continuously with no fixed-length iteration to plan against has nowhere for a
velocity number to land either, which is *why* it has no mechanical use for the ceremony rather than a
symptom of skipping a step.

~~— this repo's own loop is exactly that case —~~ **Struck at #515. This stopped being true when #499
selected prospective team velocity.** The loop named there now plans in iterations. It freezes each
item's median estimate when implementation starts, and a worklog report sums the frozen estimates per
iteration. It is a counterexample now: it has a velocity number and still does not run the ceremony. Its
estimators are dispatched in isolation, its median is recorded, and no group converges. **Its rate is
still unmeasured.** Its iterations carry no recorded start or end date, so a points-per-week figure has no
denominator. That leaves the series empty rather than meaningless.

Where a team **does** run fixed-length iterations and plans capacity against them, the uncertainty-based
rule of thumb still applies inside that context: reach for full planning poker on items where the team's
individual estimates would plausibly disagree by more than a small multiple, and let a single senior
estimator's gut call or a coarse t-shirt-size pass stand for anything the team would obviously agree on
anyway. The ceremony's cost is real — a room full of people, once per item — and it should be spent where
divergence is actually likely to surface something.

## Failure modes — four, named together

All four are real, all four happen in practice, and none of them is *the* one — naming them together
rather than picking a winner is deliberate, the same posture `/definition-of-done`'s own failure-modes
section takes for exactly the same reason: ranking them would imply a team that has fixed the top one is
safe from the rest, and it is not.

- **Anchoring.** A strong or senior voice states a number out loud before the round — or reveals early,
  or simply has a reputation the room defers to — and everyone else's private vote converges on it instead
  of being independent. This is precisely what the simultaneous-reveal mechanism exists to prevent, and it
  fails the moment anyone breaks the simultaneity, formally or socially.
- **Poker run on a badly-scoped story.** The estimate becomes theater because nobody in the room actually
  knows what they are estimating. This is the direct, named connection to `/definition-of-ready`'s own
  flagship failure — scope fragmented or undefined at the edges — and it is worth stating plainly: a
  planning poker session cannot fix an item that was never made ready. It can only expose that the item
  wasn't ready, which is a different, smaller win than the one the session was supposed to deliver.
- **False-fast convergence.** Estimators play numbers close to each other on purpose, to avoid the social
  friction of a visible disagreement, so the divergence that is the entire point of the technique never
  surfaces. A round that converges instantly and always is not evidence the team estimates well together;
  it is often evidence nobody is voting their real number.
- **The empty ritual.** The session happens, cards get played, a number gets written down — and that
  number never actually influences prioritization or planning afterward. This is the failure mode the
  reframe above is aimed at directly: if the accumulated series is the actual point, a number nobody
  references again is a session that produced nothing, however smoothly it ran.

## Relationship to Definition of Ready

**A poorly-ready story is planning poker's single most common failure input**, and the connection runs
both directions, the same way `/definition-of-ready` and `/definition-of-done` cross-reference each
other as the two ends of one lifecycle. `/definition-of-ready` names "can we size this in five minutes"
as a cheap, fast probe for readiness — a team that cannot converge on a size has usually found an
ambiguity the rest of the readiness checklist missed. Read from this skill's side, the same fact says the
opposite thing about causation: **planning poker does not fail on its own terms; it fails because its
input was never ready**, and no amount of tuning the estimation technique fixes an item whose scope was
never actually closed. Treat repeated failure to converge, or repeated near-infinite votes, as a signal
to send the item back to readiness — not as a prompt to add more estimation process on top of it.

## Pros & cons

**Pros**
- Simultaneous reveal is a cheap, effective structural defense against one voice dominating an estimate.
- The by-product — outliers explaining their reasoning — surfaces information a single estimator's
  private guess never would.
- Run consistently, it builds a velocity signal that is genuinely useful for capacity planning, which is
  a real payoff a single-person estimate cannot produce.
- Doubles as a fast readiness probe (see above) at close to zero extra cost, since the team is already in
  the room.

**Cons**
- All four failure modes above are real and common; the technique degrades quietly into theater rather
  than failing loudly.
- It costs a room full of people's time, once per item — real overhead that a coarser method (t-shirt
  sizing, a single gut call) avoids for items where the team would obviously agree anyway.
- It has no mechanical footing in a loop with no fixed-length iteration to plan capacity against, or with
  no group of human estimators at all — which is exactly why this plugin's own loop has no use for it.
- The unit chosen is genuinely arbitrary, and a team that keeps re-litigating "should we use hours or
  points" is spending the ceremony's goodwill on the one decision that matters least.

## My take

*(Elicited directly from the owner, who has run and participated in real sessions — this is hands-on
recognition, not a technique read about secondhand.)*

**The reframe, in his words:** *"a metrica pouco importa, é mais para no longo prazo poder ter uma
estimativa de velocidade do time"* — the specific metric matters little; the real point is being able to
build, over the long term, an estimate of the team's velocity. Asked what planning poker is actually
*for*, this was his answer, and it is the opposite emphasis from how the technique is usually sold —
"how do we size this item accurately" — which is why it is the spine of this skill rather than a closing
remark. The specific number produced in any one round is close to incidental; the accumulated series is
the actual deliverable.

**The four failure modes, and he named all of them together rather than ranking one above the rest, the
same pattern as his Definition of Done answer:** anchoring (a strong or senior voice states a number
before the round and the rest of the room converges on it instead of voting independently); poker run on
top of a badly-scoped story (the estimate becomes theater because nobody actually knows what they are
estimating — the direct connection to `/definition-of-ready`'s own flagship failure); false-fast
convergence (everyone plays close numbers to avoid friction, so the divergence that is the whole point of
the technique never surfaces); and the empty ritual (the session happens, but the number it produces
doesn't actually influence prioritization or planning afterward). All four are real, all four happen, and
none of them is singled out as "the" one — the same reason `/definition-of-done`'s own failure-modes
section states its four together.

**No war story here, deliberately.** Unlike the concrete failure pattern behind `/definition-of-ready`'s
flagship section, he did not offer a specific incident for this skill, and asked directly, confirmed this
is pattern-level recognition from real, repeated experience rather than one memorable event worth
narrating. Padding this section with an invented anecdote to match the shape of the other two skills in
this family would manufacture a specificity the elicitation did not produce — worse than the section
simply being shorter here.
