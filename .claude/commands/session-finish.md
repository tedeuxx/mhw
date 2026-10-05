---
description: Publish a completed slice into rc/next, or verify an owner-approved release
---
Follow workspace/README.md. For a completed slice: commit, push, open or update its PR with
`--base rc/next` and one semver label, and once CI and the review gate pass merge it with
`gh pr merge NUMBER --merge --match-head-commit SHA`. Never merge the release candidate
(`rc/next` → `main`) without the owner's explicit go; on his go run
`python3 -B workspace/delivery.py merge --pr NUMBER`, then `python3 -B workspace/delivery.py verify
--pr NUMBER` until the CI-created release is verified or a real blocker needs the owner. Retry
pending checks without bypassing failures. Report the release link only on success. A clarification,
ordinary response or tool interruption is not the end of a slice.
