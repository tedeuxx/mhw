# Blueprint import, concepts only: Product Requirements Document

Fifteen working-method and distribution concepts, taken from an external harness blueprint at the level
of the problem each one solves, and aligned with the owner one item at a time.

- **Status:** agreed with the owner in an alignment interview on 2026-11-07 (`/blueprint import`).
  Nothing here is decided beyond the answers recorded below.
- **Source:** an external blueprint in scenario form, describing another harness. The owner decided it
  enters **as concepts only**: its design, terms and anything tied to its environment stay out. No
  name, path or term of that source appears in this document.
- **How to read it:** each item states the problem, the agreed target behaviour, the evidence seen in
  this repository and the owner's answer. The order of the work will live in Issues
  (`prd-to-issues`).
- **Parent document:** [the project requirements document](mhw-product-requirements-document-project.md).
  Nothing here weakens the personal policy floor.

## Evidence level

**Everything in this document is *written*. Nothing is built, installed, loaded or enforced.** Each
"measured" figure below was read on 2026-11-07 on the reference machine, with the command given.

## 1. Distribution and installer

### 1.1 Recoverable install

- **Problem:** `mhw install` shows the change, waits for RETURN and keeps backups, and `mhw uninstall`
  restores. An install that stops part-way (a refused password, an error, an interrupt) has no
  automatic way back to its previous state.
- **Target:** every write of an install run is recorded as it happens (paths and digests only, never
  content). `mhw recover` rolls the newest incomplete run back from its backups, after one
  confirmation. `mhw status` names an incomplete run.
- **Owner's answer:** record and recover.

### 1.2 Post-install verification

- **Problem:** `mhw status` reports "evidence: installed; loaded and enforced need a session canary".
  The canary is entirely manual.
- **Target:** `mhw verify` measures each check that needs no person, one line each. For each remaining
  item it prints the one manual step. It raises the evidence from *installed* to *loaded* only where
  the check actually measured it. It never writes the station.
- **Owner's answer:** in.

### 1.3 First-run tour

- **Problem:** the policy set must be replicable by other people. Nothing introduces the commands to a
  first-time user.
- **Target:** `/welcome`, one short card per command (what it is for, a one-line example), ending with
  the glossary. It is **generated** from the command sources, and a check fails when the tour is stale.
- **Owner's answer:** in, generated.

## 2. Workstation hygiene

### 2.1 Cleanup at merge

- **Problem, measured:** this clone holds 53 worktrees (`git worktree list | wc -l`) and 159 local
  branches already merged into `rc/next` (`git branch --merged rc/next | wc -l`). Nothing in
  `workspace/` or `method/` removes them.
- **Target:** after a slice merges, `delivery.py merge` removes that slice's worktree and local branch.
  It does so only when the merged head equals the local head and nothing is uncommitted. The remote
  branch is not touched.
- **Owner's answer:** local only, after proof.

### 2.2 `/cleanup`

- **Problem, measured:** the backlog that 2.1 does not clear: the figures above, and the data volume at
  83% (`df -h ~`).
- **Target:** one read-only scan per class showing what each would free: merged worktrees, merged
  branches, tool caches, unused container images and old backups. **One confirmation from the owner.**
  Then the agent removes only what is proven merged or regenerable, re-checks each item just before
  acting, and reports sizes, never contents.
- **Owner's answer:** all classes, against the recommendation to start with git only. The single
  confirmation and the proof per item are therefore mandatory.

## 3. The delivery loop

### 3.1 Selection reads its own inventory

- **Problem:** `scrum-master` holds no tools, so the main session assembles the pool by hand. An item
  left out disappears from the selection without anyone noticing.
- **Target:** `scrum-master` gains **read-only** access to Issues, pull requests and branches, and
  still writes nothing.
- **Owner's answer:** read-only.

### 3.2 Parallel builds

- **Problem:** `scrum-master` prefers a smaller set over a colliding one, and any shared file counts as
  a collision.
- **Target:** no shared file bars a selection between the drain's own slices. The later pull request
  merges its base, keeps both sides and **re-runs every gate**, which catches a semantic coupling.
- **Owner's answer:** maximal parallelism, against the recommendation of a declared list of
  additive-only files.

### 3.3 Builder done means nothing running

- **Problem:** a builder can report done while a background process can still push. The SHA-pinned
  verdict and merge catch it, but only after a review was spent.
- **Target:** the builder declares that no background process is left. The main session confirms the
  head did not move between "done" and the call to `quality-assurance`.
- **Owner's answer:** both.

### 3.4 Issue closing

- **Problem:** slices merge into `rc/next`, and GitHub runs a closing keyword only on a merge into the
  default branch. A slice's Issue stays open until the release candidate lands, unless it is closed by
  hand.
- **Target:** `delivery.py merge` closes the slice's Issue right after the merge into `rc/next`. Commits
  keep a non-closing `Refs #N`.
- **Owner's answer:** at the slice merge.

### 3.5 Sprint status

- **Problem, observed:** on 2026-11-07 the owner asked for the sprint backlog and the table was
  assembled by hand.
- **Target:** `/autonomy status`, one read-only screen from fresh queries showing items by state
  (merged, in review, in build, blocked) and points delivered against committed. Every number carries
  the command that produced it.
- **Owner's answer:** in.

### 3.6 Session self-analysis

- **Problem:** lessons from one session wait for the iteration retrospective.
- **Target:** an owner command that reads the session's own evidence: blocks, rework, the owner's
  corrections, and rules not followed. It proposes a short list, each item citing a real artifact,
  and searches for an existing Issue first. It **opens nothing without the owner's confirmation**.
- **Owner's answer:** it proposes, the owner opens.

### 3.7 Local test environment

- **Problem:** local and CI runs can differ in tool versions.
- **Target:** the **portable** part of the suite runs in a container with the CI's operating system and
  tool versions, at the station's **native** CPU architecture, with no emulation. The macOS-specific
  part (launchd, zsh, the admin installer, the paste wrapper) stays on the host, which is the reference
  platform. A pull request carries one local-pass marker naming the head SHA for both parts, and
  `quality-assurance` requires it. Related: [the agent runtime document](mhw-product-requirements-document-agent-runtime.md).
- **Owner's answer:** the portable part only. In his words: *"it makes no sense to have to run on the
  CI's CPU architecture."*

## 4. Records and conversation

### 4.1 Generated ADR index

- **Problem:** `docs/adr/README.md` is hand-written. No duplicate number and no merge conflict were
  found (`ls docs/adr`, last 30 merges), but parallel builds (3.2) raise the risk.
- **Target:** the index is generated from the records, and a check fails when it is stale.
- **Owner's answer:** generate, against the recommendation to leave it out.

### 4.2 Short vocabulary and labels

- **Target:** every reference carries a short label (`#456 (ADRs)`), never a bare number. Words at the
  start of an owner message have a fixed effect: register, decide, explain, status, pause, another.
  **No word is an approval:** "decide" records a decision and does not authorise an act the floor asks
  about or denies.
- **Owner's answer:** vocabulary and labels.

### 4.3 Scenario line

- **Target:** every question opens with one or two plain lines on what is happening and why it matters,
  written in the chat just before the picker. The question stem keeps its 280-character limit.
- **Owner's answer:** outside the stem.

## 5. Left out

From the source, outside this repository's scope by the owner's decision that it enters as concepts
only: escalation through an external chat service, installing agent harnesses, and a third-party
server registry. None of them is described further here.

## 6. Decision records owed by the build

The build owes an ADR, or an amendment, for each item that crosses the significance gate: 1.1 (a new
installer behaviour), 2.2 (a new tool class acting on local paths), 3.1 (a persona's grant), 3.2 and
3.4 (the delivery contract), 3.7 (a review precondition) and 4.1 (a cross-cutting pattern).
