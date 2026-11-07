# Evidence provenance study: is a green bound to the checkout, runtime and preview under test?

A read-only study. It asks whether a green harness validation can come from a different checkout,
runtime process or preview than the one meant to be tested, and which layer, if any, could carry a
check for it. This is the deliverable of [#193](https://github.com/tedeuxx/mhw/issues/193), including
the two owner decisions recorded there on 2026-10-17 (the missing Codex origin carrier) and 2026-10-18
(product-lead Finding 1 of sprint-06, the sweep that produced no browser evidence).

**Nothing is implemented here.** No native trust, active protection, installed configuration or
validation semantics was changed. Any control this study points at needs its own owner decision.

- **Tree studied:** `rc/next` at `f10ce74ee228fc35de6a301350cbc98cd60ba9f8`, 2026-11-07.
- **Installed on the reference machine:** workstation `v9.0.1` at
  `f0176952caefd50d9aae564fec2fcff98269a7cf` (the `managed-by` line of `~/.claude/CLAUDE.md`), user and
  admin layers. The npm package `mhw` is the `mhw` on `PATH`.
- **Where it ran:** disposable clones under the session scratch directory (`<scratch>` below), two
  throwaway local HTTP servers, and read-only reads of the live process table and installed files.
- **What it could not run:** a fresh agent harness session, a `/sprint-review` sweep in the owner's
  Chrome, or anything in a throwaway `HOME` (see [Residuals](#residuals-and-owner-actions)).

## How to read it

| Label | Meaning here |
| --- | --- |
| **measured** | Run on this machine today, with the command in [Measurements](#measurements). |
| **read** | Read from source on the tree studied; not exercised. |
| **cited** | Taken from an earlier record (an Issue comment or a source comment), not re-run today. |
| **hypothesis** | Neither measured nor read. Stated with what would settle it. |

Each evidence item names its **intended subject** (what the validation meant to test) and its
**observed provenance** (what actually produced the green), or is marked **unbindable** when no current
artifact can tell the two apart.

## Findings, ordered by what they cost

### 1. `mhw status` run from a checkout can attest a different source than that checkout (scenario 1)

| Run | Intended subject | Observed provenance | Result |
| --- | --- | --- | --- |
| `mhw` on `PATH`, `pwd` in clone A (`f10ce74`, 68 targets differ from the install) | clone A | the npm package, `v9.0.1 @ f017695` | **green**: `check  matches this package` |
| clone B (`f017695` plus one empty commit, `3014596`), full status | clone B | clone B | **detected**: `153 target(s) differ` (every line `STAMP`) |
| clone B, `--summary` | clone B | clone B | **green**: identical to the control run; no drift item |
| clone C (`v9.0.0`), `--summary` | clone C | clone C | visible only as `brief installed in 0/3`; no drift item |
| clone E (`f017695`, control) | clone E | clone E | control: summary clean, full status `1 target(s) differ` (the allow list) |

All **measured**. Three separate gaps:

- **The `PATH` command never reads the checkout it is launched from.** Its source is its own package
  (`ROOT = HERE.parent` in `global/workstation.py`, **read**). The full view labels that
  `(this package)`, and the workspace line names the checkout's directory, but no line shows the
  checkout's `HEAD`. A green here is a statement about the package. **Unbindable** to the checkout with
  the current output.
- **A commit-only mismatch is invisible in the summary.** Content matches, the stamp names another
  commit, so `install.sh --check` prints `STAMP`. The installed `v9.0.1` summary has no drift item at
  all. On `rc/next` the summary gained one (Issue #38), but its pattern is
  `(DRIFT|MISSING|STALE|REFUSE)\s`, which leaves `STAMP` out. Calibrated on `rc/next`: one synthetic
  `DRIFT` line gives `drift: 1 target(s) in other`; one `STAMP` line gives `''`, while `issues()` counts
  both. The protections item also counts a `STAMP` brief as installed.
- **The summary names no source at all.** It shows the installed stamp, never the source stamp the
  check compared against, so a reader cannot tell which checkout or package produced the verdict.

**Cost:** a canary bundle quoting `mhw status --summary` can be green for an install that came from
another commit, and the `PATH` command can be green for a checkout it never looked at.

### 2. The shell's executable is not the running harness (scenario 2)

All **measured**, read-only, on the live process table:

- **Claude Code.** This session's process started at 14:06:31. The file `PATH` resolves to
  (`/opt/homebrew/bin/claude` -> `claude.exe`) was replaced at 14:28:01: the running image is inode
  `116624746`, the file on disk is inode `116661689`, same size. A fresh login shell resolves
  `/opt/homebrew/bin/claude` and reports `2.1.319`. **Whether the running image is also `2.1.319` is
  unbindable from outside the session**: the process table gives the image's inode, not its version.
- **Codex.** `PATH` resolves `/opt/homebrew/bin/codex`, `codex-cli 0.163.0`, which is what `mhw status`
  reports. The Codex processes running now are the ChatGPT app's bundled CLI,
  `codex-cli 0.167.0-alpha.3.2`. A canary run in the desktop surface would be reported with the
  shell's version.
- **Source.** `harness_versions()` takes `shutil.which(...)` and runs `--version` (**read**). Nothing in
  `mhw status` reads the process that will run a canary.

**Against the #189 bundle (cited):** its executable resolution came from a fresh login shell and its
pass/block canaries from fresh sessions. The two are bound only by having been taken minutes apart.
Today's measurement shows they can diverge on this machine without either one going red. Native trust
was **observed only**, by the owner, in those sessions; nothing in this study read or changed it.

### 3. The served page carries a release, not a commit, and the obvious attribution is wrong (scenario 3)

Two throwaway servers on `127.0.0.1`, both **measured**, then stopped (the ports listen on nothing
afterwards):

| Preview | Served from | Process `cwd` | Release identity in the page |
| --- | --- | --- | --- |
| `:47101` | `<scratch>/P1`, a copy of the production page | the mhw worktree | `tadeumendonca-io/releases/tag/v1.2.62` |
| `:47102` | `<scratch>/P2`, a copy of the product checkout's ignored `apps/fed/dist` | the mhw worktree | `tadeumendonca-io/releases/tag/v1.1.135` |

- **Process `cwd` attributes both previews to the wrong checkout.** Each server's working directory is
  a git checkout (this worktree), and neither serves from it (`--directory`). Reading "serving PID ->
  cwd -> `git rev-parse HEAD`" would bind both to a commit that served nothing.
- **The page exposes a release, which is comparable.** The product app bakes its root `VERSION` into
  the footer link at build time (`apps/fed/src/lib/version.ts`, **read**). Production served `v1.2.62`;
  the product checkout's tracked `VERSION` on `origin/main` is `1.2.62` (**measured**); its local `HEAD`
  (`a215edd`) carries `1.2.47`, and its ignored `dist/` (built 2026-09-30) carries `v1.1.135`. So a
  preview served from that local build matches neither the checkout nor production, and the page says
  so, if anyone reads it.
- **A commit is not exposed.** Two commits between version bumps serve the same release string. For a
  local preview of a branch, the commit is **unbindable** with the current artifacts. For production,
  the deploy asserts that the tag resolves to the built commit (**cited**, `version.ts` comment), so the
  release is an exact identity there.
- **The sweep records no identity at all.** `method/skills/sprint-review/SKILL.md` matches no
  `commit|release|version|identity` (0 lines; the positive control `sweep` matches 39).
- **Step 0 is blind to what serves.** The probe printed `89920 unbounded` and `68248 unbounded` with
  either preview up and before them. It reads the browser server's arguments, not the page.
- **A missing route on production answers `200`** (catch-all rewrite, **measured**), so a reachable
  origin does not prove a page exists either.

**Whether `/sprint-review` can complete against the wrong preview** was not run (it needs
`product-lead` in the owner's Chrome). From the above, nothing in step 0 or the sweep's report would go
red. That conclusion is **inferred**, not measured.

### 4. The Codex origin carrier: the bound is retired, and Codex still runs the pre-D8 shape (owner decision 2026-10-17)

The three things the owner asked to compare, all **measured** read-only:

| Layer | What it carries |
| --- | --- |
| tracked declaration | the product repository's `.claude/settings.json`: `HARNESS_SWEEP_ORIGIN` = `https://tadeumendonca.io/*` |
| installed Codex configuration | `[mcp_servers.chrome-devtools]` in `~/.codex/config.toml` still runs the pre-D8 shell: read `HARNESS_SWEEP_ORIGIN`, else the discard port |
| live Codex browser process (parent: the ChatGPT app's bundled `codex`) | `--isolated`, `--allowedUrlPattern http://127.0.0.1:9/*`, no `--autoConnect` |

- **The declared origin never reached the Codex process.** It got the discard port, which is the
  fallback for an unset variable. The variable is declared in a Claude Code settings file, which Codex
  does not read.
- **Since D8 (2026-10-29) the origin is read by nothing** in the method or the policy launch
  (`ADR-0038`, amendment "no origin bound"; `sprint-review` step 0, **read**). The Claude Code browser
  servers run the D8 form (`--autoConnect`, no `--allowedUrlPattern`). The Codex copy is the owner's
  local definition, which D8 says takes effect only once it matches the policy server.
- **Step 0 fails closed for Codex, correctly.** The Codex server carries no `--autoConnect`, so the
  probe prints nothing for it: a sweep dispatched from Codex would stop at `SWEEP-BROWSER-UNREADY`
  rather than report green.

**On owner decision 2026-10-18 (can a harness that carries the origin complete the sweep?):** in Claude
Code no origin needs carrying any more, and step 0's precondition holds on the live table (two
`unbounded` servers). The sweep itself was not run: it needs `product-lead`, Chrome's connection
approval and the owner's browser. **Residual, not inferred coverage.**

## Which layer could carry a provenance check

| Gap | Candidate layer | False positives | False negatives |
| --- | --- | --- | --- |
| 1. summary silent on `STAMP`; no source named | `mhw status --summary` (a check you run; no hook) | every summary run from a checkout ahead of the install reports it, which is true but frequent during development | none for files `install.sh --check` reads |
| 1. `PATH` command run from a checkout | the same summary line, naming the source (`package vX` or `checkout @ sha`) | none | a reader who ignores the line |
| 2. running image vs `PATH` | a status line walking the parent process and comparing inodes | fires after every in-place update even when the version is the same (today's case) | cannot see a desktop-app session that did not start the command |
| 2. canary attribution | the canary record quotes the session's native `/status` version (an instruction) | none | nothing checks the record was taken from the same session |
| 3. preview identity | the sweep report records the served release and the intended tree's `VERSION` | none on production | two commits between bumps; any page without the footer link |
| 4. Codex origin | none needed since D8; step 0 already fails closed | — | — |

## Recommendation

**The smallest provenance contract worth an owner decision is one change to `mhw status --summary`:
count `STAMP` lines as drift, and name the source the check compared against** (package or checkout,
with its stamp). It is the only measured case where a mismatch reports green silently and a check you
run can close it with no hook and no false negative for the files it reads. It changes what counts as
valid harness evidence, so it is boundary class and needs its own Issue.

**Accept the rest as measured residual, held by instruction:** a canary record quotes the session's own
`/status` version rather than shell resolution; a sweep report states the served release beside the
intended `VERSION`. Do not build the inode comparison (its errors run toward false alarms on every
auto-update), and do not attribute a preview by its server's working directory.

## Residuals and owner actions

1. **Fresh-session canary attribution** (scenario 2): whether a canary's session ran the same version as
   the shell reported. Settles with the native `/status` (Claude Code, Codex) quoted in the same bundle
   as the canary. Owner action; outside a subagent's reach.
2. **Throwaway-`HOME` reproduction of scenario 1** was refused by this session's worktree isolation
   ("this command sets HOME"). Scenario 1 was measured instead against the real installed layer,
   read-only (`install.sh --check` writes nothing). A throwaway install from a second commit was not done.
3. **`/sprint-review` against a wrong preview** (scenario 3): needs `product-lead` and the owner's Chrome.
   Owner action.
4. **Codex sweep with the origin carried** (decision 2026-10-18): not reachable without changing the
   owner's local Codex definition, which is out of scope. Since D8 it is moot for the bound.
5. **Trust state** was not read. The #189 record says it was observed, not granted.
6. **Named, not fixed:** this repository's own `.workstation-version` declares `>=5.4 <6` while the
   install is `v9.0.1`, so every summary run here prints a version-key mismatch.

## Measurements

Commands as run, outputs bounded. Paths under the session scratch directory are shown as `<scratch>`.

```
# scenario 1: checkout identities
git -C <scratch>/A log -1 --format='A %H'            # A f10ce74ee228fc35de6a301350cbc98cd60ba9f8
git -C <scratch>/B log -1 --format='B %H parent %P'  # B 30145965339ddcdf6d072a85bf068e24df82077b parent f0176952...
git -C <scratch>/C log -1 --format='C %H %D'         # C 55c299d40c9e4d536e5b6e5de2b425d010addc46 HEAD, tag: v9.0.0
head -3 ~/.claude/CLAUDE.md | grep -o 'release: [^;]*; commit: [0-9a-f]*'   # release: v9.0.1; commit: f0176952...

# PATH mhw launched from clone A
cd <scratch>/A && /opt/homebrew/bin/mhw status --project=<scratch>/A | grep -E '^  (source|installed|check) '
#   source  v9.0.1 @ f017695 (this package) · installed user/admin v9.0.1 @ f017695 · check matches this package

# clone B (empty commit on the installed release)
python3 -B <scratch>/B/global/workstation.py status --summary --project=<scratch>/B | grep -E 'workstation|protections'
#   workstation v9.0.1 @ f017695 ... · protections brief installed in 3/3 ... (no drift item)
python3 -B <scratch>/B/global/workstation.py status --project=<scratch>/B | grep -E '^  (source|check) '
#   source unreleased, after v9.0.1 @ 3014596 (this checkout) · check 153 target(s) differ (admin layer: 5)

# rc/next summary on a STAMP line vs a DRIFT line (calibration)
cd global && python3 -B -c 'import workstation as w; ...drift_text([STAMP line]) / drift_text([DRIFT line])'
#   STAMP -> drift_text ''  | issues 1
#   DRIFT -> drift_text 'drift: 1 target(s) in other — next: ./mhw install' | issues 1

# scenario 2: running image vs PATH file
ps -o pid=,ppid=,comm= -p <ancestors of $$>                   # ... 68222 claude
lsof -p 68222 | awk '$4=="txt"'                               # REG 321995200 116624746 /claude
stat -f '%i %z %Sm' /opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/bin/claude.exe
#   116661689 321995200 Nov  7 14:28:01 2026   (process started 14:06:31)
zsh -l -c 'whence -p claude; command claude --version'        # /opt/homebrew/bin/claude · 2.1.319
/opt/homebrew/bin/codex --version                             # codex-cli 0.163.0
ps -ax -o pid=,comm= | awk '$2 ~ /codex/'                     # /Applications/ChatGPT.app/.../codex-cli/.../codex
/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex --version
#   codex-cli 0.167.0-alpha.3.2

# scenario 3: two previews, then stopped
python3 -m http.server 47101 --bind 127.0.0.1 --directory <scratch>/P1   # and 47102 for P2
lsof -nP -iTCP:47101 -iTCP:47102 -sTCP:LISTEN                  # 69322 :47101 · 69671 :47102
lsof -a -p 69322 -d cwd -Fn                                     # the mhw worktree (same for 69671)
curl -s http://127.0.0.1:47101/ | grep -oE 'tadeumendonca-io/releases/tag/v[0-9.]+'   # v1.2.62
curl -s http://127.0.0.1:47102/ | grep -oE 'tadeumendonca-io/releases/tag/v[0-9.]+'   # v1.1.135
curl -sI https://tadeumendonca.io/no-such-route-193 | head -1   # HTTP/2 200
grep -ciE 'commit|release|version|identity' method/skills/sprint-review/SKILL.md   # 0 (control 'sweep': 39)
kill 69322 69671; lsof -nP -iTCP:47101 -iTCP:47102 -sTCP:LISTEN | wc -l           # 0

# scenario 4 / step 0 on the live table (same output before, during and after the previews)
ps -ax -o pid=,args= | grep -E -- 'chrome-devtools-mcp[^ ]* .*--autoConnect( |$)' | grep -v grep | awk '...'
#   89920 unbounded · 68248 unbounded   (both parents: claude)
ps -o args= -p 64805 | tr ' ' '\n' | grep -E '^(--|https?:)'    # parent: codex (ChatGPT app)
#   --isolated --channel --viewport --no-usage-statistics --no-performance-crux --allowedUrlPattern http://127.0.0.1:9/*
grep -nE '^\[mcp_servers\.chrome|HARNESS_SWEEP_ORIGIN' ~/.codex/config.toml   # the pre-D8 shell reading the variable
```

## Seams

This study does not reopen [#189](https://github.com/tedeuxx/mhw/issues/189), replace
[#174](https://github.com/tedeuxx/mhw/issues/174)'s origin canary, implement
[#38](https://github.com/tedeuxx/mhw/issues/38)'s drift item (it only measures that the item leaves
`STAMP` out) or duplicate [#66](https://github.com/tedeuxx/mhw/issues/66)'s installed-file stamps.
