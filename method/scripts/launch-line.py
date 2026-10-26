#!/usr/bin/env python3
"""Print the one block that opens a fresh session of an agent harness with a prompt (#198, /handoff).

Usage: launch-line.py <target> <prompt-file> [--env NAME=VALUE]...
       launch-line.py --resolve <current> [<first word of the arguments>]

<target> names the agent harness the new session runs in, not the one running now: claude-code (alias
claude), codex, kiro (alias kiro-cli). --resolve prints the canonical target: the first word when it
names a harness, else <current>, and says on its second line whether that word was consumed (`consumed`
or `kept`). /handoff uses it so the default, the current harness, is decided here and not by hand.

The prompt is read from a file, never from an argument, so the agent never has to quote it. It is quoted
here, deterministically, for a POSIX shell (zsh, bash): the whole prompt goes inside single quotes, and
each single quote in it becomes '\\''. Inside single quotes `$`, backticks, `\\`, `!` and `"` are
literal, and a newline is literal, so a multi-line prompt stays one command. The line is meant to be
pasted into a terminal, not run by the agent.

Prints, on stdout, one fenced block and nothing after it (the owner pastes the block):
    NAME='value' claude '<prompt>'           claude-code
    NAME='value' codex '<prompt>'            codex
    NAME='value' kiro-cli chat '<prompt>'    kiro; before the block, one line for the Kiro IDE, which
                                             has no launch line (a `#` line inside the block would be a
                                             command in zsh, where interactive comments are off)
Each --env becomes a prefix assignment, so the variable reaches the agent harness even through the
workstation's paste wrapper function (measured on zsh, bash, bash --posix and sh). The fence is one
backtick longer than any backtick run in the block, so a prompt carrying backticks cannot close it.

The prompt file is read only when it resolves (symlinks and `..` included) under the repository work
tree or the system temporary directory, is a regular file and holds at most 64 KiB (confine.py, as the
worklog and milestone scripts read their inputs). Refuses, exit 1, a prompt that would not be safe to
hand over: empty, carrying a NUL, a first line not opening with /goal, a line over 280 characters, or a
machine-local path (the worklog continuity contract's refused strings, imported from worklog.py so the
two cannot drift); and an --env whose name is not a shell variable name or whose value carries a NUL, a
newline or a machine-local path. This is a string check: copied private content carries none of those
strings and passes. Exit 2 on a usage error. Standard library only, Python 3.9+.
"""

import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # worklog.py ships beside this file (mhw #170)
from confine import confined  # noqa: E402
from worklog import STRICT_PRIVATE  # noqa: E402

LAUNCH = {"claude-code": "claude", "codex": "codex", "kiro": "kiro-cli chat"}
ALIASES = {"claude": "claude-code", "kiro-cli": "kiro"}
IDE_NOTE = ("Kiro IDE: no documented launch command takes an initial prompt. The block below is for Kiro CLI; "
            "in the IDE, open a new chat and paste the text inside the outer quotes, reading each '\\'' as '.")
LINE_LIMIT = 280
SIZE_LIMIT = 64 * 1024  # bytes; a prompt is a handful of one-line fields
ENV_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def canonical(name):
    """The harness id a name or alias stands for, or None."""
    name = ALIASES.get(name, name)
    return name if name in LAUNCH else None


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


def env_problems(pairs):
    out = []
    for n, (name, value) in enumerate(pairs, 1):
        if not ENV_NAME.match(name):
            out.append("--env %d: the name is not a shell variable name" % n)
        if "\0" in value or "\n" in value or "\r" in value:
            out.append("--env %d: the value carries a NUL or a line break" % n)
        if STRICT_PRIVATE.search(value):
            out.append("--env %d: the value carries a machine-local path" % n)
    return out


def fence(body):
    longest = max((len(m) for m in re.findall(r"`+", body)), default=0)
    return "`" * max(3, longest + 1)


def block(target, prompt, pairs):
    prefix = "".join("%s=%s " % (name, quote(value)) for name, value in pairs)
    line = "%s%s %s" % (prefix, LAUNCH[target], quote(prompt))
    f = fence(line)
    return "%s\n%s\n%s" % (f, line, f)


def resolve(argv):
    if not argv or len(argv) > 2 or canonical(argv[0]) is None:
        print("usage: launch-line.py --resolve <%s> [<first word>]" % "|".join(LAUNCH), file=sys.stderr)
        return 2
    word = canonical(argv[1]) if len(argv) == 2 else None
    print(word or canonical(argv[0]))
    print("consumed" if word else "kept")
    return 0


def parse(argv):
    """(target, path, env pairs) or None on a usage error."""
    if len(argv) < 2 or canonical(argv[0]) is None:
        return None
    pairs, rest = [], argv[2:]
    while rest:
        if rest[0] != "--env" or len(rest) < 2 or "=" not in rest[1]:
            return None
        name, value = rest[1].split("=", 1)
        pairs.append((name, value))
        rest = rest[2:]
    return canonical(argv[0]), argv[1], pairs


def main(argv):
    if argv[:1] == ["--resolve"]:
        return resolve(argv[1:])
    parsed = parse(argv)
    if parsed is None:
        names = sorted(list(LAUNCH) + list(ALIASES))
        print("usage: launch-line.py <%s> <prompt-file> [--env NAME=VALUE]..." % "|".join(names), file=sys.stderr)
        return 2
    target, path, pairs = parsed
    # mhw #170 (Sonar S8707): the path is supplied by an agent and its content is printed, so it is resolved
    # (symlinks and `..` included) and read only under the work tree or the temporary directory, only as a
    # regular file, and only up to SIZE_LIMIT bytes.
    try:
        real = Path(confined(path))
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
    found = problems(prompt) + env_problems(pairs)
    if found:
        for p in found:
            print("REFUSE  %s" % p, file=sys.stderr)
        return 1
    if target == "kiro":
        print(IDE_NOTE)
    print(block(target, prompt, pairs))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
