# ADR-0040: With the owner present, the agent may create or renew a secret through his browser

- **Status:** proposed. The five decisions it records (D1 to D5) are the owner's own, given on
  [Issue #220](https://github.com/tedeuxx/mhw/issues/220) on 2026-10-24. The record waits for his
  ratification. **The canary has run in local emulation only; the canary on the real forge page is
  owed, not passed** (see the amendment "2026-10-24: canary results in local emulation"). No part of
  this record may be read as a claim that a secret value stays out of the model's context on the real
  page.
- **Date:** 2026-10-24
- **Deciders:** the owner (D1 to D5); written by `agents-lead`
- **Issue:** [#220](https://github.com/tedeuxx/mhw/issues/220)
- **Amends:** [ADR-0016](0016-user-level-deny-floor-rendered-per-harness.md), the reason given for the
  floor row "Writing or deleting a secret": *"A secret is set by the human, never by an agent"*. See
  that record's amendment "2026-10-24: a secret may be created or renewed by the agent in the owner's
  browser while he watches (Issue #220, proposed)".

## Context and problem

A deploy token used by a release workflow appears to have expired (a hypothesis, not measured).
Renewing it means generating a new token on the forge and writing it into a repository secret. The
owner asked the agent to do this for him through the browser, and the agent refused, citing the rule
that a secret is never written by an agent. The owner, verbatim:

> «eu quero que voce me auxilie com minha presenca em sua totalidade, somente qunado nao estou no
> teclado que precisamo tomar cuidados.»

So the caution should depend on **whether he is present**, not only on the act.

Two facts frame the change:

- **The Bash route is denied mechanically and stays denied.** `global/deny-floor.conf` lists
  `cmd gh secret set`, `cmd gh secret delete` and `cmd gh secret remove`, rendered into four installed
  layers: the Claude Code admin and user layers, Codex and Kiro (intake on Issue #220).
- **The browser route is covered by nothing mechanical.** No deny entry matches an MCP or browser tool.
  The earlier refusal came from an instruction alone (intake finding 3).

The decision changes a rule of the personal policy floor and an earlier recorded decision, so a record
is owed (ADR-0001 significance gate).

## The owner's decisions

- **D1, what "present" means:** *«eu acompanhando a acao no chrome-devtools/claude in chrome comandada
  por voce»*. He is present when he is **watching, live, a browser action the agent drives** through
  Chrome DevTools or Claude in Chrome. The secret-store act happens in his browser, under his eyes.
- **D2, scope:** secrets only. The exception covers **creating or renewing a secret or token**.
  Deleting or removing a secret is out of scope, and every other floor item stays as it is.
- **D3, exposure:** *copy without reading*. The agent drives the whole flow and moves the value with
  copy and paste. It takes **no screenshot and no page read while the value is visible**.
- **D4, auto mode** (raised by the gate on PR #221): *"Auto + seu turno"*. As recorded on the Issue:
  *"An interactive session in auto mode counts as present when the owner's latest turn asked for this
  specific act. Otherwise, auto mode stays away."* Evidence level: *"an instruction only. No native
  prompt fires in auto mode."* In acceptance criterion 5 the away list drops plain "auto mode".
- **D5, how the value moves** (raised by canary run 2's reverse calibration): *"Script ou colar"*
  ([Issue comment](https://github.com/tedeuxx/mhw/issues/220#issuecomment-6390004151)). Rule 3 allows
  two routes: the page's own copy control and a paste into the target field, or an in-page script that
  moves the value from the source element into the target field and returns nothing that carries the
  value. **Each route needs its own canary** before any real use.

## Threat model

What the rule protects against, and what each threat costs:

| Threat | What goes wrong | Covered by |
| --- | --- | --- |
| An unattended run writes a secret | A drain, a scheduled run or a subagent replaces a credential nobody asked for; the owner learns of it from a failing deploy, or never | The closed away list below; the Bash denies |
| The value enters the model's context | A screenshot, a page snapshot, a page-text read or a script that returns the value carries the token to the model provider and into the session transcript on disk, against the workstation brief's rule 2 (sanitise secrets) | D3 and D5, copy without reading; the canary, run in local emulation only, **owed on the real page** |
| The browser tool captures the screen on its own | Some browser tools return a screenshot after a click without being asked; the value would enter context even under D3 | **Nothing yet.** The canary must cover it (owner, D3) |
| The agent reads the clipboard | A clipboard read (`pbpaste` or a tool equivalent) after the copy puts the value into context | Instruction: the agent never reads the clipboard while it holds a secret |
| Scope creep | "Present" is read as a general licence for other floor items | D2: secrets only, create or renew only |
| Auto mode taken as presence | In auto mode no native prompt fires, so an act runs with no human confirmation at the moment it happens | D4: auto counts as present only when his latest turn asked for this specific act; an instruction only, no layer checks it |
| A stale or inferred presence | An old approval, or an owner turn about something else, is taken as presence | The away list: presence needs an owner turn that asks for this act, in this session |

## Decision drivers

- Assist the owner in full when he is present (his words above).
- Leave every mechanical deny exactly as it is: no layer can see presence, so loosening one would loosen
  it for the away case too.
- Keep the secret value out of the model's context, and say plainly that this is not yet proven.
- Name the evidence level honestly: an instruction is not a control.

## Considered options

1. **Keep the absolute rule (status quo).** The agent never writes a secret by any route. *Trade-off:*
   the safest reading, but it refuses exactly the help the owner asked for, while he is watching, and he
   ruled it out.
2. **Turn the Bash deny into a settings `ask`, as a proxy for presence.** *Rejected.* An `ask` is not
   proof of presence: the `scm` skill records a hook `ask` that ran with no prompt in auto mode, and a
   settings `ask` in auto mode on the current build is not measured (intake finding 4, a hypothesis).
   It would also loosen the floor for every away mode that does not honour the prompt, and the value
   would still have to reach `gh secret set` through the agent's command.
3. **A hook that observes presence.** *Rejected.* A hook sees a tool payload, not whether the owner is
   watching the screen; and ADR-0035 records the owner's principle that *"hooks somente devem ser
   utilizados para mitigacao de riscos existenciais"* (hooks should only be used to mitigate existential
   risks). Even where that bar were met, a hook that guesses presence would read as enforcement and
   behave as advice.
4. **A presence-conditioned browser route, held as an instruction (chosen).** With the owner present
   (D1), the agent may create or renew a secret or token (D2) in his browser, copying without reading
   (D3). Every Bash deny stays. *Trade-off:* nothing mechanical stops an away run from driving the
   browser, which is exactly today's state; the change widens what an instruction permits, not what a
   layer permits.

## Decision outcome

Chosen option 4.

### The rule

With the owner **present**, the agent may **create or renew** a secret or a token **through his
browser**, driving the flow with Chrome DevTools or Claude in Chrome, on these conditions:

1. **Present means D1:** he is watching the browser, live, while the agent drives it. **And** the
   session is not on the away list below, whose last item (from acceptance criterion 5 on Issue #220,
   not from D1's words) requires that the owner's own latest turn in this session asked for this act.
2. **Create or renew only (D2).** Deleting or removing a secret is not covered, and neither is any other
   floor item.
3. **Copy without reading (D3, as amended by D5).** ~~No screenshot, no page snapshot, no page-text or
   script read, and no clipboard read while the value is visible or held. The agent moves the value with
   the page's own copy control and a paste into the target field.~~ *(Struck 2026-10-24, D5: it forbade
   the script route that canary run 2 measured.)* No screenshot, no page snapshot, no page-text read
   returned to the agent, and no clipboard read while the value is visible or held. The agent moves the
   value by one of two routes:
   - **(a) paste:** the page's own copy control, then a paste into the target field;
   - **(b) script:** an in-page script that moves the value from the source element into the target
     field and returns nothing that carries the value.

   Each route needs its own canary before its first real use (D5).
4. **The browser only.** The Bash secret-store commands stay denied (`gh secret set/delete/remove` and
   the rest of ADR-0016's row). The agent does not pass the value through a shell command, a file or a
   tool argument.
5. **No real use before the canary passes.** The canary below is a precondition of the first real use
   (D3), run through each browser tool and each route of rule 3 that will be used (D5); if it fails,
   that route stays closed.

### Away: a closed list

The owner is **away** in each of these, and the browser route is forbidden there, exactly as it is
today:

- a bypass-permissions mode;
- a headless run (`claude -p`, `codex exec` and the like);
- a dispatched subagent (only the main session that talks to him may act);
- a scheduled run or a cloud run;
- any session, auto mode included, in which his latest turn did not ask for this specific act.

An interactive session in **auto mode** is not on this list by itself: it counts as present when his
latest turn asked for this specific act (D4). No native prompt fires there, so this is held by
instruction only.

The list is closed: a mode not on it is not thereby "present". Presence is the D1 condition holding,
never the absence of an item on this list.

### The layer that carries it, and its evidence level

| Part | Layer | Evidence level |
| --- | --- | --- |
| The Bash secret-store denies | Native deny rules from `global/deny-floor.conf`, four installed layers (ADR-0016) | Unchanged: installed and enforced as before |
| Presence (D1, D4) and the away list | **Instruction.** No layer observes whether the owner is watching | Written only |
| Scope (D2) | Instruction | Written only |
| Copy without reading (D3, D5) | Instruction | Written only. Canary in local emulation only: the script route through `chrome-devtools` passed; the paste route through Claude in Chrome did not. **The canary on the real page is owed** (amendment "2026-10-24: canary results in local emulation") |
| The browser route itself | Instruction. No deny entry matches a browser or MCP tool | Written only, as today |

~~The `chrome-devtools` server this repository installs is bound to the consuming project's declared
origin (ADR-0038), so it reaches a forge settings page only where a project declares that origin. That
is read from ADR-0038, not measured for this route.~~ *(Struck 2026-10-29, ADR-0038 amendment D8: the
server has no origin bound, so it reaches a forge settings page from any project, and no layer confines
rule 3's route to the forge. See the amendment "2026-10-29: no origin bound" below.)* Claude in Chrome is not installed or configured by
this repository; its behaviour, including any screenshot it takes on its own, is outside this
repository's reach.

### The canary, owed

Before the first real use, on a throwaway repository secret:

1. Choose a dummy value carrying a unique marker. It is not a real credential.
2. Run the whole flow under D1 and D3, through each browser tool that will be used for real. Which of
   the two tools (Chrome DevTools or Claude in Chrome) runs it first is **open**, not decided here; a tool
   that has not passed its own canary is not used for a real secret.
3. Count the marker with `grep -c` across the session transcript (JSONL) and the saved tool outputs.
4. Pass only on **0** occurrences. Calibrate it the other way: a deliberate page read of the marker must
   make the count non-zero.

Until it passes, this record makes **no claim that the value never enters the context**. Its result, when
it exists, is recorded as an amendment here.

#### Amendment 2026-10-24: canary results in local emulation

Recorded from the run reports on Issue #220
([run 1](https://github.com/tedeuxx/mhw/issues/220#issuecomment-6389916754),
[run 2 blocked](https://github.com/tedeuxx/mhw/issues/220#issuecomment-6389950373),
[run 2](https://github.com/tedeuxx/mhw/issues/220#issuecomment-6389977724),
[reverse calibration](https://github.com/tedeuxx/mhw/issues/220#issuecomment-6389990795)). **Local
emulation only:** a page served on `127.0.0.1` generated a random fake `github_pat_…` value in the page
itself and showed it beside a password field. No real forge page and no real secret were involved. The
counter used `grep -F -f` across `~/.claude/projects/-Users-tadeumen` and the session's task outputs,
printing counts only.

| Route | Tool | Result | Counts |
| --- | --- | --- | --- |
| (b) script | `chrome-devtools` (run 2) | **Passed in emulation.** One in-page script moved the value into the field and returned only `"ok"`; no snapshot, no screenshot | `positive_control=2`, **`canary=0`** |
| (b) script, reverse calibration | `chrome-devtools` (same session) | A script returned a fresh fake value on purpose | `positive_control=4`, `canary=2`: non-zero, so run 2's 0 is a real negative |
| (a) paste | Claude in Chrome (run 1) | **Not passed.** The copy step put the value into no transcript; the paste into the password field failed (*"Cannot access a chrome-extension:// URL of different extension"*, not diagnosed) | copy step: `positive_control=2`, **`canary=0`** |

- **Run 2 was first blocked:** `chrome-devtools` is launched with
  `--allowedUrlPattern "$HARNESS_SWEEP_ORIGIN"` (ADR-0038) and `--isolated`, so a page opens only in a
  session launched with that variable set to the target origin, in a throwaway profile.
- **Not proven:** the real forge page; the MCP server's own logs, which were not searched; any field
  outside the page, such as a password manager.
- **Still owed before any real use:** the real flow on a **throwaway repository secret** at
  `github.com`~~, in a session launched with `HARNESS_SWEEP_ORIGIN='https://github.com/*'`. *(2026-10-29,
  #220: that bound alone blocked the asset host the secret form needs; under decision D7 the variable
  is a declared list of origins, ADR-0038 amendment, and the rerun sets the list the canary measures.)*~~
  *(Struck 2026-10-29, ADR-0038 amendment D8: there is no origin bound, so the rerun sets no variable
  and the asset host is reachable.)* ~~The owner logs
  in to the isolated window himself;~~ *(struck 2026-10-24, #224: the server now attaches to the owner's
  own Chrome, ADR-0038 amendment, so his existing login is used and he allows the connection)* the
  agent never enters credentials. The first real use repeats the count.

#### Amendment 2026-10-29: no origin bound ([Issue #224](https://github.com/tedeuxx/mhw/issues/224#issuecomment-6511323788), ADR-0038 decision D8)

The owner removed the `chrome-devtools` origin bound (D8, *"Sem limite nenhum"*). Two things in this
record leaned on it, and both are reconciled here:

- **Rule 3 is unchanged in what it asks.** Copy without reading, by route (a) or (b), with no
  screenshot, snapshot, page-text read or clipboard read while the value is visible. What changed is
  what surrounds it: the bound no longer keeps the browser on the forge while the value is on screen,
  so a page outside the forge that the agent opens is not refused. Keeping the flow on the forge's own
  pages is now an instruction only, held with D1 by the owner watching.
- **The canary rerun needs no launch variable.** It runs in any session, and the forge's asset host is
  reachable, which the single-origin bound had blocked.
- **Evidence level:** unchanged for this record, *written only*. The canary on the real page is still
  owed, and nothing here was measured against the unbounded launch.

## Consequences

- **Good:** the owner gets full help while he watches; every mechanical deny is untouched; the rule now
  states its own evidence level instead of implying coverage.
- **Good:** the workstation brief's rule 2 stays as it is. No exception is made to it; D3 is how this
  rule tries to satisfy it.
- **Bad:** presence is not observable, so the rule is held by the agent's reading of the session and
  nothing else. An away run that drives the browser is stopped by no layer, as today.
- **Bad:** the route cannot be used until the canary passes, and a failing canary keeps it closed (D3).
- **Bad:** rule 4 in the two project root briefs still says "never"; it is restated in their own repos,
  tracked by tedeuxx/tadeumendonca-skills#576 and tedeuxx/tadeumendonca-io#781.

## Links

- Issue [#220](https://github.com/tedeuxx/mhw/issues/220), its intake, the owner's D1 to D5 and the canary run reports.
- ADR-0016 (the deny floor), ADR-0035 (hooks only for existential risk), ADR-0038 (the
  `chrome-devtools` server, ~~bounded by origin~~ with no origin bound since its D8 amendment).
- tedeuxx/tadeumendonca-skills#576, tedeuxx/tadeumendonca-io#781.
