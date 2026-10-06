---
description: Publish a completed slice into rc/next, or verify an owner-approved release
---
Follow workspace/README.md. For a completed slice: commit, push, open or update its PR with
`--base rc/next` and one semver label, and once CI and the review gate pass run
`python3 -B workspace/delivery.py merge --pr NUMBER` from the slice branch. It runs the rc/next gate
(the `tests` run registered on the head, `delivery-ci` and Sonar green, a clean merge state) and
merges with a real merge commit pinned to the head; then `python3 -B workspace/delivery.py verify
--pr NUMBER`. Never merge through a bare GitHub CLI merge, which skips that gate. A slice never
targets `main`: only the release-candidate PR (`rc/next` → `main`) does, and it is never merged
without the owner's explicit go; on his go run the same `merge`, then `verify`, from a checkout of
`rc/next` until the CI-created release is verified or a real blocker needs the owner. Retry
pending checks without bypassing failures. Report the release link only on success. A clarification,
ordinary response or tool interruption is not the end of a slice.
