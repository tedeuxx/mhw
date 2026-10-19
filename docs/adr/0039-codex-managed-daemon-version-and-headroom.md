# ADR-0039: Review Codex daemon descriptor configuration without managing it

- **Status:** proposed
- **Date:** 2026-10-18
- **Deciders:** the owner; written by `agents-lead`
- **Issue:** [#200](https://github.com/tedeuxx/mhw/issues/200)

## Context and problem

On the reference macOS workstation, `thread/start` once failed with `Too many open files (os error
24)`. The first investigation found an older managed app-server package, retained descriptors and a
soft descriptor limit of 256. Bounded reproduction also found that unsubscribe released retained
resources after quiescence and that the then-current app-server stayed flat across repeated cycles.

The initial proposal treated this as an enduring workstation-runtime responsibility. It added a
permanent `mhw` daemon probe, descriptor/headroom reporting and install-time native daemon
update/restart behavior. Issue #210 later narrowed when those actions could run. The owner corrected
the scope on 2026-10-19: Issue #200 is a configuration review, not authority for `mhw` to monitor or
manage Codex's daemon lifecycle.

The bounded current review found:

- Codex CLI, managed package and app-server aligned at 0.163.0;
- Codex Doctor healthy;
- the current session's soft descriptor limit at 4096, while launchd's default soft limit is 256;
- no supported native Codex configuration setting for the managed daemon's descriptor limit.

Those observations describe the measured session and vendor surface. They do not establish a
permanent invariant for future processes, and the current-session limit is not a valid substitute for
another process's live limit.

## Decision drivers

- Keep a configuration review bounded to the configuration surface the owner asked to assess.
- Do not turn incident evidence into a permanent process/FD monitor without an explicit product need.
- Leave Codex as the sole owner of its daemon, socket, package and lifecycle.
- Do not raise a global or process descriptor limit.
- Do not add a hook or change the paste wrapper for a non-existential operational concern.
- Report measured, documented and unavailable evidence at their actual levels.
- Keep installation and status output for every other harness unchanged.

## Considered options

1. **Record the bounded configuration review only (chosen).** Keep the measurements and the absence of
   a supported native daemon-limit setting as review evidence. Remove the permanent probe and every
   install-time daemon action. *Trade-off:* `mhw` will not warn about a later daemon skew or descriptor
   accumulation; a future incident requires a fresh bounded diagnosis.
2. **Keep a read-only permanent daemon/FD monitor.** Continue inspecting versions, processes and open
   descriptors but never alter the daemon. *Rejected:* it still turns a configuration review into a
   runtime product responsibility and requires maintaining a private vendor-schema/process contract.
3. **Keep install-time native update/restart.** Correct detected skew at the explicit install boundary.
   *Rejected:* configuration review does not authorize lifecycle management, and an update or restart
   can interrupt every session attached to the vendor daemon.
4. **Raise the launchd or process descriptor limit.** Make more descriptors available to the daemon.
   *Rejected:* no supported Codex daemon-specific setting was found; a global change reaches unrelated
   processes, while a wrapper would take ownership of vendor startup behavior.

## Decision outcome

Option 1.

- `mhw check`, `mhw status` and `mhw install` do not inspect the Codex daemon, count its descriptors,
  infer headroom, compare daemon versions or resolve daemon processes.
- `mhw install` does not run `codex app-server daemon update`, restart the daemon or otherwise change
  Codex lifecycle state.
- The dedicated sanitizer, runtime monitor and their tests are removed.
- No global or process-specific descriptor limit is changed.
- No hook, paste-wrapper rule, launch agent, socket or native Codex daemon configuration is added or
  changed.
- The measurements above remain documentation evidence only. They are not an installed, loaded or
  enforced control.

## Consequences

Good:

- The implementation now matches the owner's corrected Issue #200 scope.
- `mhw` no longer depends on experimental/private daemon output or process-name inference.
- Install cannot interrupt daemon-backed sessions as a side effect of workstation configuration.
- Other harness installation, status and check behavior remains independent of Codex daemon state.

Bad and residual:

- A future package skew, descriptor accumulation or resource exhaustion is not detected by `mhw`.
- The difference between the current session's soft limit and launchd's default remains descriptive;
  it does not prove which limit a future daemon inherits.
- No supported native setting was found to pin the daemon's descriptor limit. This is an unavailable
  configuration surface, not a reason to substitute a global limit or an unsupported wrapper.

## Withdrawal of the earlier proposal — 2026-10-19

The earlier proposed outcome in this ADR selected permanent version/headroom inspection plus
install-time native correction. That outcome, including Issue #210's stopped-daemon and advisory
headroom refinements, is withdrawn before acceptance. Its implementation was released and is present
in the reference machine's installed v7.0.1; this correction removes it from source. The installed
copy continues to carry the withdrawn monitor until this correction is released and installed.

This amendment records a scope correction, not a finding that monitoring or vendor-native lifecycle
commands are inherently unsafe. They are simply outside Issue #200 as the owner defined it.

## Evidence level

- **Measured, bounded on 2026-10-19:** Codex 0.163.0 version alignment; Doctor healthy; current session
  soft descriptor limit 4096; launchd default soft limit 256.
- **Reviewed:** no supported native Codex managed-daemon descriptor-limit setting was found.
- **Written and tested in this correction:** permanent daemon inspection and install-time lifecycle
  actions are absent from `mhw`; unrelated workstation paths retain their existing behavior.
- **Not installed or enforced:** this proposed correction has not been released or installed.

## Links

- [Issue #200](https://github.com/tedeuxx/mhw/issues/200)
- [Issue #210](https://github.com/tedeuxx/mhw/issues/210)
- [ADR-0022](0022-restart-after-active-customization-changes.md)
- [ADR-0027](0027-native-carrier-per-component-from-the-enforcement-matrix.md)
