# Restart handoff

The active improvement adds ADR-0022: a shared user/workspace restart obligation and native
Claude Code/Codex stale-tool guards. Read that ADR for coverage; do not treat installation as proof
of native execution. Kiro and desktop surfaces have the same obligation, with the gaps stated there.

After installation, end the affected session. In a new session, perform the workspace's normal
session-mode intake, then verify the installed version and native hook loading before further
improvements. Codex hook trust must be granted by the owner through `/hooks`; never self-grant it.
Run the ADR's disposable pass/block/fresh-session canary per harness. Preserve existing approvals.

The generated `overlay/desktop-instructions.md` contains the updated global rule for Claude account
instructions; generation alone does not apply it. ChatGPT desktop and Kiro native hook activation
remain unverified. Publication is checked through `workspace/delivery.py verify --pr NUMBER` using
the delivered feature head. Keep this handoff free of secrets, configuration values and transcripts.
