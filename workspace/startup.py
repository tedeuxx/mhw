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
    "additionalContext": "Read AGENTS.md and workspace/session-policy.json. If the owner's first prompt explicitly declares the session type (the label 'Melhoria de harness' or 'Bugfix', or the mode name improvement or bugfix), accept it, confirm it in one line and ask no picker. Never infer a type from the task. Only when no type is declared, begin with one native picker: header 'Session type', labels 'Melhoria de harness' and 'Bugfix', in that order, and wait for the owner before implementation. This explicit two-choice intake is an exception to the normal three-choice rule. A conversation pause is not the end of an improvement session. Follow workspace/README.md for CI publication at session completion."
}}))
