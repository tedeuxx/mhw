#!/usr/bin/env python3
"""Print the shell line that opens a fresh session of one agent harness with a prompt (#198, /handoff).

Usage: launch-line.py <claude-code|codex|kiro> <prompt-file>

The prompt is read from a file, never from an argument, so the agent never has to quote it. It is quoted
here, deterministically, for a POSIX shell (zsh, bash): the whole prompt goes inside single quotes, and
each single quote in it becomes '\\''. A newline inside single quotes is literal, so a multi-line prompt
stays one command. The line is meant to be pasted into a terminal, not run by the agent.

Prints, on stdout:
    claude '<prompt>'            claude-code
    codex '<prompt>'             codex
    kiro-cli chat '<prompt>'     kiro, then a shell comment for the Kiro IDE, which has no launch line

The prompt file is read only when it resolves (symlinks and `..` included) under the repository work
tree or the system temporary directory, is a regular file and holds at most 64 KiB (confine.py, as the
worklog and milestone scripts read their inputs). Refuses, exit 1, a prompt that would not be safe to
hand over: empty, carrying a NUL, a first line not
opening with /goal, a line over 280 characters, or a machine-local path (the worklog continuity
contract's refused strings, imported from worklog.py so the two cannot drift). This is a string check:
copied private content carries none of those strings and passes. Exit 2 on a usage error.
Standard library only, Python 3.9+.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # worklog.py ships beside this file (mhw #170)
from confine import confined  # noqa: E402
from worklog import STRICT_PRIVATE  # noqa: E402

LAUNCH = {"claude-code": "claude", "codex": "codex", "kiro": "kiro-cli chat"}
IDE_NOTE = "# Kiro IDE: there is no launch line; open a new chat and paste the prompt above as its first message."
LINE_LIMIT = 280
SIZE_LIMIT = 64 * 1024  # bytes; a prompt is a handful of one-line fields


def quote(text):
    return "'" + text.replace("'", "'\\''") + "'"


def problems(prompt):
    out = []
    if not prompt.strip():
        return ["the prompt is empty"]
    if "\0" in prompt:
        out.append("the prompt carries a NUL character")
    if not prompt.startswith("/goal "):
        out.append("the first line must open with /goal")
    for n, line in enumerate(prompt.split("\n"), 1):
        if len(line) > LINE_LIMIT:
            out.append("line %d is %d characters; the limit is %d" % (n, len(line), LINE_LIMIT))
        if STRICT_PRIVATE.search(line):
            # The text is never echoed: only where it is.
            out.append("line %d carries a machine-local path (a refused string of the worklog contract)" % n)
    return out


def main(argv):
    if len(argv) != 2 or argv[0] not in LAUNCH:
        print("usage: launch-line.py <%s> <prompt-file>" % "|".join(LAUNCH), file=sys.stderr)
        return 2
    # mhw #170 (Sonar S8707): the path is supplied by an agent and its content is printed, so it is resolved
    # (symlinks and `..` included) and read only under the work tree or the temporary directory, only as a
    # regular file, and only up to SIZE_LIMIT bytes.
    try:
        real = Path(confined(argv[1]))
    except ValueError as error:
        print("REFUSE  %s" % error, file=sys.stderr)
        return 1
    try:
        if not real.is_file():
            print("REFUSE  the prompt file is not a regular file", file=sys.stderr)
            return 1
        if real.stat().st_size > SIZE_LIMIT:
            print("REFUSE  the prompt file is over %d bytes" % SIZE_LIMIT, file=sys.stderr)
            return 1
        prompt = real.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as error:
        print("launch-line: cannot read the prompt file: %s" % error.__class__.__name__, file=sys.stderr)
        return 2
    prompt = prompt.replace("\r\n", "\n").rstrip("\n")
    found = problems(prompt)
    if found:
        for p in found:
            print("REFUSE  %s" % p, file=sys.stderr)
        return 1
    print("%s %s" % (LAUNCH[argv[0]], quote(prompt)))
    if argv[0] == "kiro":
        print(IDE_NOTE)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
