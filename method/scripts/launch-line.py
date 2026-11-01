#!/usr/bin/env python3
"""Print the one block that opens a fresh session of an agent harness with a prompt (#198, /handoff).

Usage: launch-line.py <target> <prompt-file> --cd <checkout> [--env NAME=VALUE]...
       launch-line.py --resolve <current> [<first word of the arguments>]

<target> names the agent harness the new session runs in, not the one running now: claude-code (alias
claude), codex, kiro (alias kiro-cli). --resolve prints the canonical target: the first word when it
names a harness, else <current>, and says on its second line whether that word was consumed (`consumed`
or `kept`). /handoff uses it so the default, the current harness, is decided here and not by hand.

The prompt is read from a file, never from an argument, so the agent never has to quote it. It is quoted
here, deterministically, for a POSIX shell (zsh, bash): the whole prompt goes inside single quotes, and
each single quote in it becomes '\\''. Inside single quotes `$`, backticks, `\\`, `!` and `"` are
literal, and a newline is literal, so a multi-line prompt stays one command. The --cd checkout is quoted
the same way. The line is meant to be pasted into a terminal, not run by the agent.

Prints, on stdout, exactly one fenced block holding exactly one command, and nothing before or after it
(owner, 2026-11-01, #198: the handoff is always one start command of the agent harness with the prompt
inline, and it carries its own working directory, so pasting it in any terminal starts the right session):
    cd '<checkout>' && NAME='value' claude '<prompt>'           claude-code
    cd '<checkout>' && NAME='value' codex '<prompt>'            codex
    cd '<checkout>' && NAME='value' kiro-cli chat '<prompt>'    kiro
~~kiro; before the block, one line for the Kiro IDE~~ (struck 2026-11-01, #198: that line was text around
the command; the Kiro IDE's `kiro chat [prompt]` is named in the /handoff prose instead.)
Each --env becomes a prefix assignment on the agent harness's command, after the `cd`, so the variable
reaches the agent harness even through the workstation's paste wrapper function (measured on zsh, bash,
bash --posix and sh). The fence is one backtick longer than any backtick run in the block, so a prompt
carrying backticks cannot close it.

The prompt file is read only when it resolves (symlinks and `..` included) under the repository work
tree or the system temporary directory, is a regular file and holds at most 64 KiB (confine.py, as the
worklog and milestone scripts read their inputs). Refuses, exit 1, a prompt that would not be safe to
hand over: empty, a first line opening with /goal, a line over 280 characters, a machine-local path
(the worklog continuity contract's refused strings, imported from worklog.py so the two cannot drift),
or a control character: every Unicode Cc character but the newline (so NUL, TAB, ^C, ^U, ESC and the
rest: in an interactive zsh or bash one of them can end the paste or the quote and run what follows as a
command, and an unbracketed paste eats a TAB) and the bidirectional controls U+202A-U+202E and
U+2066-U+2069, which make the block read differently from what runs. An --env is accepted only when
its name is in LAUNCH_ENV, the launch variables the method declares (an allowlist: a denylist always
misses one more variable that redirects a configuration home, a base URL, an editor or git's own
configuration). It is refused when its value carries a control character (the newline included), a
bidirectional control or a machine-local path. --cd is required, once: an absolute path to an existing
directory holding a `.git` entry (a repository or a worktree), with no control character. It is the
owner's own path, printed for his terminal and never part of the prompt, so it is not checked against the
machine-local strings. ~~a first line not opening with /goal~~ (struck 2026-11-01, #198: the owner ruled
that a fresh session does not start with /goal, so the prompt carries no /goal line and a prompt opening
with one is refused). The refusal names the line, the --env or --cd,
never the content. This is a string check: copied private content carries none of those
strings and passes. Exit 2 on a usage error. Standard library only, Python 3.9+.
"""

import re
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))  # worklog.py ships beside this file (mhw #170)
from confine import confined  # noqa: E402
from worklog import STRICT_PRIVATE  # noqa: E402

LAUNCH = {"claude-code": "claude", "codex": "codex", "kiro": "kiro-cli chat"}
ALIASES = {"claude": "claude-code", "kiro-cli": "kiro"}
LINE_LIMIT = 280
SIZE_LIMIT = 64 * 1024  # bytes; a prompt is a handful of one-line fields
BIDI = frozenset(chr(c) for c in list(range(0x202A, 0x202F)) + list(range(0x2066, 0x206A)))
# The launch variables the method declares: a variable an MCP server or the agent harness reads only when
# it starts. An allowlist, so a name that redirects a configuration home, a base URL, an editor or git's
# configuration is refused without anyone having had to think of it. Add a name here, in a reviewed
# change, when a method file declares a new launch variable.
# None is declared today, so every --env is refused. HARNESS_SWEEP_ORIGIN was the one entry; it left with
# the chrome-devtools origin bound it fed (ADR-0038 amendment D8, 2026-10-29), which was its only consumer.
LAUNCH_ENV = frozenset((
))


def control(text, keep_newline):
    """True when text carries a Cc character (the newline excepted when keep_newline) or a bidi control."""
    return any((unicodedata.category(c) == "Cc" and not (keep_newline and c == "\n")) or c in BIDI for c in text)


def declared_env(name):
    return name in LAUNCH_ENV


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
    if re.match(r"/goal(\s|$)", prompt):
        out.append("the first line opens with /goal; a fresh session does not start with /goal")
    for n, line in enumerate(prompt.split("\n"), 1):
        if len(line) > LINE_LIMIT:
            out.append("line %d is %d characters; the limit is %d" % (n, len(line), LINE_LIMIT))
        if STRICT_PRIVATE.search(line):
            # The text is never echoed: only where it is.
            out.append("line %d carries a machine-local path (a refused string of the worklog contract)" % n)
        if control(line, keep_newline=True):
            out.append("line %d carries a control character (Cc other than the newline, or a bidi control)" % n)
    return out


def env_problems(pairs):
    out = []
    for n, (name, value) in enumerate(pairs, 1):
        if not declared_env(name):
            out.append("--env %d: the name is not a declared launch variable (%s)"
                       % (n, ", ".join(sorted(LAUNCH_ENV)) or "none is declared"))
        if control(value, keep_newline=False):
            out.append("--env %d: the value carries a control character or a line break" % n)
        if STRICT_PRIVATE.search(value):
            out.append("--env %d: the value carries a machine-local path" % n)
    return out


def cd_problems(path):
    if control(path, keep_newline=False):
        return ["--cd carries a control character or a line break"]
    p = Path(path)
    if not p.is_absolute():
        return ["--cd is not an absolute path"]
    if not p.is_dir():
        return ["--cd is not an existing directory"]
    if not (p / ".git").exists():
        return ["--cd is not a git checkout (no .git entry)"]
    return []


def fence(body):
    longest = max((len(m) for m in re.findall(r"`+", body)), default=0)
    return "`" * max(3, longest + 1)


def block(target, prompt, pairs, checkout):
    prefix = "".join("%s=%s " % (name, quote(value)) for name, value in pairs)
    line = "cd %s && %s%s %s" % (quote(checkout), prefix, LAUNCH[target], quote(prompt))
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
    """(target, path, env pairs, checkout) or None on a usage error. --cd is required, once."""
    if len(argv) < 2 or canonical(argv[0]) is None:
        return None
    pairs, checkout, rest = [], None, argv[2:]
    while rest:
        if len(rest) < 2:
            return None
        if rest[0] == "--cd" and checkout is None:
            checkout = rest[1]
        elif rest[0] == "--env" and "=" in rest[1]:
            name, value = rest[1].split("=", 1)
            pairs.append((name, value))
        else:
            return None
        rest = rest[2:]
    if checkout is None:
        return None
    return canonical(argv[0]), argv[1], pairs, checkout


def main(argv):
    if argv[:1] == ["--resolve"]:
        return resolve(argv[1:])
    parsed = parse(argv)
    if parsed is None:
        names = sorted(list(LAUNCH) + list(ALIASES))
        print("usage: launch-line.py <%s> <prompt-file> --cd <checkout> [--env NAME=VALUE]..." % "|".join(names),
              file=sys.stderr)
        return 2
    target, path, pairs, checkout = parsed
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
        # newline="" keeps a lone CR as it is, so it is refused below rather than read as a newline.
        with real.open(encoding="utf-8", newline="") as handle:
            prompt = handle.read()
    except (OSError, UnicodeError) as error:
        print("launch-line: cannot read the prompt file: %s" % error.__class__.__name__, file=sys.stderr)
        return 2
    prompt = prompt.replace("\r\n", "\n").rstrip("\n")
    found = problems(prompt) + env_problems(pairs) + cd_problems(checkout)
    if found:
        for p in found:
            print("REFUSE  %s" % p, file=sys.stderr)
        return 1
    print(block(target, prompt, pairs, checkout))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
