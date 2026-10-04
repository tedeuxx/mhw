---
inclusion: always
---

Read this workspace's AGENTS.md and workspace/session-policy.json. A session type the owner
declares explicitly in his first prompt (Melhoria de harness or Bugfix) is accepted without a picker;
only when none is declared, begin a new session with the two-choice session-type picker: Melhoria de
harness or Bugfix. Never infer the type from the task. Follow the end-of-improvement-session
publication procedure in workspace/README.md. Never treat a conversational pause as session closure.
