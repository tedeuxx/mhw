---
name: session-finish
description: "Publish a completed slice of this repository into rc/next through the checked merge route, or verify a release the owner approved. Use when a slice is complete and ready to publish, or when the owner has given his explicit go on the release-candidate pull request (rc/next to main)."
---

# session-finish

A skill, not a command, since 2026-10-26 (the owner: *"mesma coisa session finish"*). Invoke it by
name: Claude Code `/session-finish`, Codex `$session-finish`. Kiro follows the same route from
AGENTS.md and the workspace steering. Because it is a skill, an agent may also load it on its own
when a slice is done. That is inside the owner's standing authorization for this repository (AGENTS.md,
*Delivery contract*): agents publish and merge a slice into `rc/next` once its gate passes. **It
authorizes nothing about `main`.** Invoking or loading this skill is never the owner's go.

Follow workspace/README.md. For a completed slice: commit, push, open or update its PR with
`--base rc/next` and one semver label, and once CI and the review gate pass run
`python3 -B workspace/delivery.py merge --pr NUMBER` from the slice branch. It runs the rc/next gate
(the `tests` run registered on the head, `delivery-ci` and Sonar green, a clean merge state) and
merges with a real merge commit pinned to the head; then `python3 -B workspace/delivery.py verify
--pr NUMBER`. Never merge through a bare GitHub CLI merge, which skips that gate. A slice never
targets `main`: only the release-candidate PR (`rc/next` → `main`) does, and **it is never merged
without the owner's explicit go**, given by him on that PR or in his own message; on his go run the
same `merge`, then `verify`, from a checkout of `rc/next` until the CI-created release is verified
or a real blocker needs the owner. Retry pending checks without bypassing failures. Report the
release link only on success. A clarification, ordinary response or tool interruption is not the end
of a slice.
