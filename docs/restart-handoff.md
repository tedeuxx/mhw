# Restart handoff

The owner-selected name for the planned emergency recovery command is `/breaking-glass`, replacing
the proposed name `/recovery-mode`. The command is not implemented or registered in this checkout;
this naming decision does not change the guard, restart or native trust requirements below.

The current bugfix makes ADR-0022 restart denials distinguish missing, changed and invalid baselines,
adds a read-only diagnostic, and fixes malformed-state exceptions. The historical first-tool refusal
is not yet attributed; no false positive or causal link to plugin drift was demonstrated. Read the
[evidence and reproducible procedure](restart-guard-diagnosis.md). Do not treat installation, a generic
hook success message or direct command replay as proof of native execution.

After installation, end the affected session. In a new session, perform the workspace's normal
session-mode intake, then verify the installed version and native hook loading before further
improvements. Codex hook trust must be granted by the owner through `/hooks`; never self-grant it.
Run the ADR's disposable pass/block/fresh-session canary per harness. Preserve existing approvals.

On the next genuinely new session, select Bugfix (or retain it when resuming this handoff), observe
the guard-specific `baseline_created` message, and correlate the exact session with `--diagnose`.
Do not erase/rebaseline state, bypass a refusal or self-grant hook trust. Stop on an unexpected
refusal and report its reason code. Native verification remains pending until independently observed.

Keep the incomplete `docs/feature-catalog` worktree separate; its draft is not part of this bugfix.
The external issue-body edit remains deferred to a different session after guard verification.

The generated `overlay/desktop-instructions.md` contains the updated global rule for Claude account
instructions; generation alone does not apply it. ChatGPT desktop and Kiro native hook activation
remain unverified. Publication is checked through `workspace/delivery.py verify --pr NUMBER` using
the delivered feature head. Keep this handoff free of secrets, configuration values and transcripts.
