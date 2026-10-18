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
- ~~A running daemon must resolve to exactly one native `app-server --managed-daemon` process.~~
  The v6.0.1 canary falsified that argv signature. A running daemon now resolves the exact AF_UNIX
  peer through Darwin `LOCAL_PEERPID`/`LOCAL_PEERCRED`, binds PID to `proc_bsdinfo` start identity,
  resolves the authenticated peer's exact PID/UID/start identity on the bounded executor lineage as
  the session host for this runtime, and revalidates all identities after collecting metrics. A
  process-name predicate is only an unambiguous fallback. Equality between roles is reported only
  when the kernel identities match.
- Safe headroom is 64 descriptors: the measured 48-descriptor old-package burst plus 16 descriptors of
  margin. Unlimited is accepted; ~~unavailable evidence fails closed~~ unavailable descriptor evidence is
  DRIFT for status and check and advisory at install (2026-10-18 amendment).
  ~~The live per-role limit must be used to pass or fail that threshold.~~ On the owner's explicit
  exception for #200, unprivileged macOS provides no public API for another process's
  `RLIMIT_NOFILE`; status therefore reports per-role limit/headroom as unavailable and check neither
  passes nor fails from a launchd global or another process's limit. The calibration remains recorded,
  not asserted against a substitute subject.
- Inspection requests `lsof -Fft` only. It never requests `n` fields, and output is reduced to numeric
  descriptor and type counts before formatting. The local daemon-version sanitizer consumes the raw
  vendor JSON, validates its exact schema, types, status/backend vocabulary and version formats, and
  writes only status, backend, three version fields, and fixed numeric PID/start metadata for the
  socket peer, session host and executor child. Raw bytes and path fields are never retained,
  interpreted or emitted outside that child; its stderr and the vendor command's stderr go directly
  to `DEVNULL`. The sanitizer accepts no arguments and resolves `codex` internally from `PATH`, so the
  mhw parent supplies neither an executable nor a vendor path to the boundary.
- On skew, install runs `codex app-server daemon update --from-cli --yes`. ~~When versions are aligned
  but headroom is unsafe or the lifecycle process is stale/ambiguous, it runs the native daemon
  restart.~~ Since the role-aware amendment, missing, ambiguous or changing identity refuses change;
  incomplete evidence never selects restart. It then re-inspects and requires aligned versions and
  stable resolved roles. A stopped daemon remains untouched (#210).
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
- ~~PID discovery delegates the process-argument match to `pgrep`.~~ The exact live peer is
  kernel-authenticated. `pgrep` remains only in #210's two-signal stopped-daemon branch: a positive
  result says merely "something managed may still be alive" and is never process identity.
- Update/restart can interrupt every session attached to the managed daemon. That is why install names
  the effect before confirmation and performs it last.
- The 64-descriptor threshold is calibrated to this incident, not a vendor guarantee.

## Evidence level and installation handoff

The role-aware carrier and its fake-daemon tests are **written and tested**. They cover aligned state,
skew, kernel peer credential/UID/PID/start predicates, zero/foreign/reused peer identity, missing,
multiple, cycling and changing host lineage, PID/start revalidation after metrics, aggregate FD
totals/types/frontier without targets, malformed private output, exact schema/type/extra-field
refusals, native version update, suppressed failures and failed postconditions. No live lifecycle
change is run while this implementation session depends on the daemon.

The reference machine now reports workstation **v7.0.1 installed**, commit
`8c4f4b7401794dccd36322036ea43a17baca4186`, and its global brief is **loaded** in the current fresh
Codex session (2026-10-18). That release does not contain this branch's role-aware correction, which is
therefore **written and tested only, not installed or enforced**. A consumer-like candidate copy and a
genuinely fresh normal daemon-backed Codex session must still verify aligned versions, stable resolved
roles, a low aggregate baseline, repeated thread/executor creation and closure, post-close quiescence,
no positive retained FD slope and no `os error 24`. Per the amendment below, live per-role
`RLIMIT_NOFILE`/headroom remains explicitly unavailable rather than inferred.

## Amendment 2026-10-18: a stopped daemon and low headroom do not fail install

[Issue #210](https://github.com/tedeuxx/mhw/issues/210). The owner's decision, for a patch release: a
stopped daemon is not a failure of the install, and low descriptor headroom is reported as DRIFT by
`mhw status` and `mhw check` and does not block `mhw install`.

What failed, measured on the reference machine (Codex CLI 0.163.0, macOS): right after a native restart
the daemon held 317 numeric descriptors against an inherited soft limit of 256, so the restart could
never meet the headroom postcondition; and with the daemon stopped, `daemon version` failed and
inspection recorded `daemon metadata unavailable`, which install refused as incomplete evidence. Both
ended `Installation incomplete` with every other step applied.

Decision:

- **Not running is told apart from broken metadata by two independent signals.** The sanitizer still
  never reads vendor stderr; it now exits 3 when the vendor command exits non-zero with empty stdout.
  Only then does the parent ask `pgrep` for a managed-daemon process. No match (exit 1) is
  `daemon not running`: OK for status and check, and install leaves it alone and starts nothing. A
  match is `daemon control unreachable while a managed process runs`, the inconsistent lifecycle
  #200 recorded: it stays an error and install changes nothing. A missing or failing `pgrep` stays an
  error. *Evidence:* measured on this machine with the daemon stopped (vendor exit 1, 0 bytes of
  stdout; sanitizer exit 3; `pgrep` exit 1; the read-only report prints `daemon not running`). The
  alive-but-unreachable branch is tested against a fake, not measured.
- **Headroom selects no install action.** Low headroom and unreadable descriptor evidence (`lsof` or
  `launchctl` missing or unreadable) are DRIFT for status and check, worded as advisory, and install
  neither restarts for them nor fails on them. The install preview does not list them as a change; it
  prints them under an advisory heading. Rejected: keep the restart and accept low headroom after it.
  A restart ends every daemon-backed session and, measured here, cannot raise an inherited soft limit;
  it could only help an accumulation, which install cannot tell apart from a structural baseline
  before interrupting. The owner can still restart natively himself.
- **Version skew and an ambiguous or missing lifecycle process still act**, and their postcondition
  is now "no further action needed": aligned versions and one resolved process, with headroom
  reported but not required.
- **Genuinely broken metadata still refuses install** (schema drift, unreadable versions, an
  unsupported backend, the alive-but-unreachable case), so that an install never changes the daemon
  on evidence it cannot read.

Consequences: `mhw install` completes on the reference machine in both measured states, once the
other steps pass. ~~`mhw check` still exits non-zero on low headroom, so check and install can disagree
by design.~~ The later role-aware amendment records why live headroom cannot be decided from the
available unprivileged evidence. The exhaustion itself stays #200's, and nothing here raises a limit.

## Amendment 2026-10-18: role-aware identity and the per-role limit exception

The released argv predicate reported the managed process missing while the vendor projection was
running and aligned. The intake also established that lifecycle control, AF_UNIX peer, session host and
executor child are roles, not synonyms. The correction authenticates the vendor-reported socket peer
with Darwin peer credentials, binds each role to PID plus kernel start time, and treats that exact peer
identity as the session host when it occurs on the stable executor ancestry. This remains deterministic
with multiple processes named Codex; the name predicate is used only when it has one candidate. The
correction collects only aggregate numeric descriptor totals/types and age, and revalidates identities
after collection. A broken, cycling, multiply-valid or changing lineage and any PID/start change
refuse. Descriptor targets, arguments, executable paths, environment and vendor stderr never cross the
sanitizer boundary.

One original acceptance predicate is unavailable on the selected platform without privilege:
unprivileged Darwin exposes another process's PID, PPID, UID, start identity and open-file count via
public libproc structures, but not its `RLIMIT_NOFILE`; Python has no `resource.prlimit`, `ps`'s `lim`
is a memory limit, and `launchctl procinfo <pid>` requires root. The native Codex version and redacted
Doctor projections expose no per-role file limit either. The owner accepted proceeding without that
test only. The implementation therefore reports live per-role `RLIMIT/headroom unavailable`, never
reads `launchctl limit maxfiles`, and cannot pass or fail check from a global or descendant limit.
Every other identity, stability, aggregate-metric, privacy and lifecycle predicate remains.

This amendment changes no limit, hook, paste wrapper or uninstall behavior. Install updates only on
version skew, leaves a stopped daemon alone, never restarts for descriptor state, and refuses role
ambiguity rather than guessing.

## Links

- [Issue #200](https://github.com/tedeuxx/mhw/issues/200)
- [Issue #210](https://github.com/tedeuxx/mhw/issues/210)
- [ADR-0022](0022-restart-after-active-customization-changes.md)
- [ADR-0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md)
