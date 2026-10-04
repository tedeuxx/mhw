---
name: "source-command-session-finish"
description: "Publish and verify the completed improvement session"
---

# source-command-session-finish

Use this skill when the user asks to run the migrated source command `session-finish`.

## Command Template

Follow workspace/README.md. Finish the already authorized scope, commit, push, open/update its PR with
one semver label, and run `python3 -B workspace/delivery.py merge --pr NUMBER`. Retry pending checks
without bypassing failures. Then run `python3 -B workspace/delivery.py verify --pr NUMBER` until the
CI-created release is verified or a real blocker needs the owner. Report the release link on success.
Do not interpret a clarification, ordinary response or tool interruption as session closure.
