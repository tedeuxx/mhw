---
name: "source-command-session-start"
description: "Select improvement or bugfix for a new workspace session"
---

# source-command-session-start

Use this skill when the user asks to run the migrated source command `session-start`.

## Command Template

Read workspace/session-policy.json and AGENTS.md. If this session has no selected type, ask exactly
one native multiple-choice question with header `Session type` and exactly two labels in order:
`Melhoria de harness`, `Bugfix`. Briefly describe scope and risk in each description. Wait for the
owner; never select by inference or a preselected default. Keep the choice in conversation context.
If the session already has a type, report it briefly instead of restarting intake.
