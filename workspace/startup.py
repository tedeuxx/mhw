#!/usr/bin/env python3
"""Claude Code SessionStart reminder. No transcripts, writes or model calls."""
import json
import sys

try:
    event = json.load(sys.stdin)
except (ValueError, OSError):
    sys.exit(0)
if not isinstance(event, dict) or event.get("source") not in ("startup", "clear"):
    sys.exit(0)
print(json.dumps({"hookSpecificOutput": {
    "hookEventName": "SessionStart",
    "additionalContext": "Read AGENTS.md and workspace/session-policy.json. Begin this new workspace session with one native picker: header 'Session type', labels 'Melhoria de harness' and 'Bugfix', in that order. Wait for the owner before implementation. This explicit two-choice intake is an exception to the normal three-choice rule. A conversation pause is not the end of an improvement session. Follow workspace/README.md for CI publication at session completion."
}}))
