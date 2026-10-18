# ADR-0039: Align the Codex managed daemon and check descriptor headroom

- **Status:** proposed
- **Date:** 2026-10-18
- **Deciders:** the owner; written by `agents-lead`
- **Issue:** [#200](https://github.com/tedeuxx/mhw/issues/200)

## Context and problem

On the reference macOS workstation, Codex CLI 0.163.0 was talking to a persistent managed app-server
0.160.0. The process inherited launchd's soft `maxfiles` limit of 256. After about 19 hours it held
240 descriptors (135 pipes and 94 regular files), and `thread/start` failed during TUI bootstrap with
`Too many open files (os error 24)`. Codex Doctor reported healthy state and thread databases, but
reported the app-server as not running while its managed daemon process was still alive.

Bounded reproduction separated two causes:

- managed app-server 0.160.0 grew by about 48 descriptors, including 45 pipes, for a thread cycle and
  could plateau near the 256 ceiling;
- a correct unsubscribe did release the retained resources after quiescence (90 to 38 descriptors
  within 60 seconds), so the observed growth was retained session lifecycle, not an irreversible leak;
- standalone/current app-server 0.163.0 stayed flat across repeated start/unsubscribe cycles, including
  retained-session controls;
- restarting the native managed daemon restored headroom, but did not by itself prevent the older
  package from repeating the behavior.

The old app-server's resource behavior and inconsistent lifecycle reporting are vendor defects. The
workstation defect is that its managed daemon could remain on an older package than the CLI, with no
check for the skew or the remaining descriptor headroom. A soft limit of 256 made the failure arrive
sooner, but raising it would only hide the recurrence and widen a workstation setting unrelated
processes inherit.

## Decision drivers

- Keep Codex's managed daemon as the only daemon, socket and lifecycle owner.
- Detect skew across complete validated version tokens, including prerelease/build suffixes, and
  unsafe headroom before the operating-system error.
- Confine raw daemon-version bytes to a trusted, short-lived local sanitizer. Outside that boundary,
  retain and emit only status, backend, versions, PID, process age, limit and aggregate descriptor
  counts by type; never paths, descriptor targets, prompts, logs or vendor errors.
- Make an interrupting update or restart explicit, and only at the final installation boundary.
- Do not raise a global or process descriptor limit and do not add a hook.
- Preserve other harnesses and leave uninstall from mhw unable to downgrade or stop vendor state.

## Considered options

1. **Native alignment plus a headroom check at the install boundary (chosen).** `mhw check` and verbose
   status inspect the native daemon; `mhw install` uses Codex's supported update or restart command only
   when needed, after every independent install check has passed. *Trade-off:* installation can end all
   work attached to the managed daemon and depends on an experimental vendor command's metadata schema.
2. **Raise `maxfiles`.** Either the launchd default or a process-specific wrapper would delay the same
   retained-resource behavior. *Rejected:* the measured current package does not need the larger limit,
   and the global form affects unrelated processes.
3. **Wrap or periodically restart the daemon.** A launch agent, alternate socket or hook could keep the
   count bounded. *Rejected:* it competes with the vendor lifecycle, may interrupt unrelated Codex
   sessions without an explicit boundary, and this is not an existential-risk hook case.
4. **Report only.** Detect skew and ask the owner to run vendor commands manually. *Rejected:* the
   supported native correction is deterministic and belongs in the already-confirmed install boundary.

## Decision outcome

Option 1.

- macOS only: other operating systems and a missing Codex CLI are clean, explicit skips.
- The CLI binary version must equal the daemon metadata's CLI, managed-package and app-server versions.
- A running daemon must resolve to exactly one native `app-server --managed-daemon` process.
- Safe headroom is 64 descriptors: the measured 48-descriptor old-package burst plus 16 descriptors of
  margin. Unlimited is accepted; unavailable evidence fails closed.
- Inspection requests `lsof -Fft` only. It never requests `n` fields, and output is reduced to numeric
  descriptor and type counts before formatting. The local daemon-version sanitizer consumes the raw
  vendor JSON, validates its exact schema, types, status/backend vocabulary and version formats, and
  writes only status, backend and three version fields. Raw bytes and path fields are never retained,
  interpreted or emitted outside that child; its stderr and the vendor command's stderr go directly
  to `DEVNULL`. The sanitizer accepts no arguments and resolves `codex` internally from `PATH`, so the
  mhw parent supplies neither an executable nor a vendor path to the boundary.
- On skew, install runs `codex app-server daemon update --from-cli --yes`. When versions are aligned but
  headroom is unsafe or the lifecycle process is stale/ambiguous, it runs the native daemon restart.
  It then re-inspects and requires aligned versions and safe headroom.
- The lifecycle step runs last and is skipped when any earlier install step failed or remains pending.
  The install preview states that daemon-backed Codex work will end at this boundary.
- `mhw uninstall` does not alter the vendor daemon or package.

## Consequences

Good:

- Version skew and impending descriptor exhaustion become deterministic `mhw check` failures rather
  than a later `thread/start` failure.
- The correction uses the vendor's package and lifecycle commands; no competing daemon or socket exists.
- The setting that exposed the defect is not widened for the whole workstation.

Bad and residual:

- The vendor still owns session unsubscribe and daemon health reporting. A future aligned release may
  regress; the headroom check detects the approach to exhaustion but cannot repair a vendor leak.
- PID discovery delegates the process-argument match to `pgrep`; mhw captures only candidate PIDs, then
  asks `ps` only for PID, parent PID and age. A vendor change to that signature will fail closed until
  adapted.
- Update/restart can interrupt every session attached to the managed daemon. That is why install names
  the effect before confirmation and performs it last.
- The 64-descriptor threshold is calibrated to this incident, not a vendor guarantee.

## Evidence level and installation handoff

The carrier and its fake-daemon tests are **written and tested**. The tests cover aligned state, skew,
unsafe headroom, missing/ambiguous lifecycle processes, malformed private output, the child sanitizer's
allowlist and schema/type/extra-field refusals, native update, native restart, suppressed failures and
failed postconditions. The real native update is deliberately not run while this implementation
session depends on the live daemon.

The reference machine remains **measured-drifted**, not corrected: CLI 0.163.0; managed package and
app-server 0.160.0; soft limit 256. Installation is last. A genuinely fresh, normal daemon-backed Codex
session must then verify aligned versions, safe initial headroom, repeated thread creation/closure,
post-close cleanup and absence of accumulation before the correction is described as installed and
enforced.

## Links

- [Issue #200](https://github.com/tedeuxx/mhw/issues/200)
- [ADR-0022](0022-restart-after-active-customization-changes.md)
- [ADR-0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md)
