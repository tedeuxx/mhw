#!/usr/bin/env python3
"""Remove the MCP servers the policy retired from the Codex user configuration (ADR-0035 decision 2,
Issue #145).

    mcp_retire.py --mode=install|check|dry-run|uninstall

The policy is global/mcp/retired-servers.conf: one server name per line. ADR-0035 decision 2 moves
cloud access to the CLI, so the aws-api server goes ("pode remover, não uso"). The owner's rule of
2026-10-11 (Issue #145) makes the removal installer work rather than an owner action.

Scope. ${CODEX_HOME:-~/.codex}/config.toml only. A retired server written by hand (a [mcp_servers.<name>]
table, with its sub-tables such as [mcp_servers.<name>.env]) is removed, and nothing else in the file
changes. The managed block global/mcp/mcp_render.py writes (ADR-0017) is not edited here: a retired server
declared there is named on a NOTE line, since it comes back from the local MCP definition on the next
render. A server spelt any other way (an inline table, dotted keys) is refused, not guessed at.

Verification. The edit is parsed with tomllib (Python 3.11+) and must equal the original document minus
exactly that server; otherwise nothing is written (REFUSE, exit 3). Without tomllib a file that holds a
retired server is refused the same way.

Never printed: the server's command, arguments, environment or any value. A line names the file, the
server and "present -> absent".

Backup. Before the write the previous file is copied to config.toml.pmhwc-mcp-backup, owner-only (0600)
from its first byte whatever the original's mode, since it holds the removed server's environment
values. That is the restore route: uninstall does not re-add a server the policy retired, it names the backup.

Exit codes, as install.sh: 0 ok · 1 a retired server is present (--check) · 2 usage · 3 unreadable, not
valid TOML, a shape this script does not edit, or an edit that would not verify.
"""
import copy
import os
import re
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parent.parent))  # global/: the one shared private_copy
from private_copy import private_copy  # noqa: E402

try:
    import tomllib
except ImportError:  # Python < 3.11
    tomllib = None

HERE = Path(__file__).resolve().parent
POLICY = HERE / "retired-servers.conf"
BACKUP = ".pmhwc-mcp-backup"
MARKER_ID = "managed-by: personal-multi-harness-workstation-configuration"
BLOCK_BEGIN_PREFIX = "# >>> %s (mcp servers)" % MARKER_ID
BLOCK_END = "# <<< %s (mcp servers)" % MARKER_ID
NAME_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}")
HEADER_RE = re.compile(r"\s*\[")


class Refuse(Exception):
    pass


def load_policy(path):
    names = []
    for raw in Path(path).read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if not NAME_RE.fullmatch(line):
            raise ValueError("%s: not a server name: %r" % (path, line))
        names.append(line)
    return names


def target():
    """The Codex user configuration, from the environment only (HOME, CODEX_HOME), as mcp_render.py does:
    no command-line argument names a path this script writes."""
    return Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex") / "config.toml"


def _header_of(line, name):
    """True when the line opens [mcp_servers.<name>] or one of its sub-tables, in any key spelling."""
    n = re.escape(name)
    return re.match(r"\s*\[\s*mcp_servers\s*\.\s*(?:%s|\"%s\"|'%s')\s*(?:\]|\.)" % (n, n, n), line) is not None


def _block_span(lines):
    begins = [i for i, l in enumerate(lines) if l.startswith(BLOCK_BEGIN_PREFIX)]
    ends = [i for i, l in enumerate(lines) if l.rstrip("\r\n") == BLOCK_END]
    if len(begins) == 1 and len(ends) == 1 and begins[0] < ends[0]:
        return begins[0], ends[0]
    return None


def _in_block(i, block):
    return block is not None and block[0] <= i <= block[1]


def _table_lines(lines, i, block):
    """The line numbers of the table whose header is line i: up to the next header (or the managed block),
    minus the comment lines directly above that header, which describe it and stay."""
    j = i + 1
    while j < len(lines) and not HEADER_RE.match(lines[j]) and not (block and j == block[0]):
        j += 1
    k = j
    while k > i + 1 and lines[k - 1].lstrip().startswith("#"):
        k -= 1
    return range(i, k)


def _drop_lines(lines, name, block):
    """-> the line numbers of every hand-written table of the server (outside the managed block)."""
    drop = set()
    for i, line in enumerate(lines):
        if _header_of(line, name) and not _in_block(i, block):
            drop.update(_table_lines(lines, i, block))
    return drop


def _verify(old, new_text, removed):
    """The edited text must parse to the original document minus exactly the removed servers."""
    try:
        new = tomllib.loads(new_text)
    except tomllib.TOMLDecodeError as e:
        raise Refuse("removing %s would leave invalid TOML (%s); nothing written" % (", ".join(removed), e))
    want = copy.deepcopy(old)
    for name in removed:
        del want["mcp_servers"][name]
    alt = copy.deepcopy(want)
    if alt.get("mcp_servers") == {}:
        del alt["mcp_servers"]
    if new not in (want, alt):
        raise Refuse("removing %s would change more than that server; nothing written" % ", ".join(removed))


def _present(text, names):
    """-> (parsed document, the retired names it holds). Raises Refuse."""
    if tomllib is None:
        # No parser to verify with: a file that never names a retired server is settled; one that does is
        # refused rather than edited blind.
        if not any(n in text for n in names):
            return None, []
        raise Refuse("it names a retired MCP server, and removing one needs Python 3.11+ (tomllib) to verify "
                     "the edit; nothing written")
    try:
        old = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        raise Refuse("not valid TOML (%s); left untouched" % e)
    servers = old.get("mcp_servers")
    return old, [n for n in names if isinstance(servers, dict) and n in servers]


def plan(text, names):
    """-> (new text, removed names, names found only inside the managed block). Raises Refuse."""
    old, present = _present(text, names)
    if not present:
        return text, [], []
    lines = text.splitlines(keepends=True)
    block = _block_span(lines)
    drop, removed, in_block = set(), [], []
    for name in present:
        mine = _drop_lines(lines, name, block)
        if mine:
            drop |= mine
            removed.append(name)
        elif block and any(_header_of(l, name) for l in lines[block[0]:block[1] + 1]):
            in_block.append(name)
        else:
            raise Refuse("the retired MCP server %s is not written as a [mcp_servers.%s] table (an inline "
                         "table or dotted keys); nothing written" % (name, name))
    if not removed:
        return text, [], in_block
    new_text = "".join(l for i, l in enumerate(lines) if i not in drop)
    _verify(old, new_text, removed)
    return new_text, removed, in_block


def _write(path, backup, text):
    """As mcp_render.atomic_write: the new file is created with the old mode from its first byte, so the
    content is never readable more widely than before, even for a moment.
    A config.toml that is a symbolic link (a dotfiles checkout) is written through: the link stays, its
    target loses the server (PR #146 lens L2). The backup holds what was removed, environment values
    included, so it is owner-only (0600) whatever the original's mode."""
    target = os.path.realpath(str(path))
    mode = os.stat(target).st_mode & 0o7777
    private_copy(target, str(backup))
    tmp = "%s.new.%d" % (target, os.getpid())
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, mode)
        os.replace(tmp, target)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def _apply(mode, path, backup, names):
    """install, check or dry-run against one config.toml -> exit code."""
    try:
        text = path.read_text(encoding="utf-8")
        new_text, removed, in_block = plan(text, names)
    except (OSError, UnicodeDecodeError) as e:
        print("REFUSE  %s: unreadable (%s); left untouched" % (path, e.__class__.__name__))
        return 3
    except Refuse as e:
        print("REFUSE  %s: %s" % (path, e))
        return 3
    for name in in_block:
        print("NOTE    %s: the retired MCP server %s is in the managed block, rendered from the local MCP "
              "definition (ADR-0017); remove it there and re-run the renderer" % (path, name))
    if not removed:
        print("OK      %s: no retired MCP server outside the managed block" % path)
        return 0
    what = "; ".join("mcp_servers.%s present -> absent" % n for n in removed)
    if mode == "check":
        print("DRIFT   %s: install would change %s (retired MCP servers, ADR-0035 decision 2)" % (path, what))
        return 1
    if mode == "dry-run":
        print("WOULD CHANGE %s: %s (retired MCP servers; backup %s%s)" % (path, what, path.name, BACKUP))
        return 0
    _write(path, backup, new_text)
    print("CHANGED %s: %s (retired MCP servers, ADR-0035 decision 2; previous file kept as %s)" % (path, what, backup))
    return 0


def main(argv=None):
    args = argv if argv is not None else sys.argv[1:]
    modes = ("install", "check", "dry-run", "uninstall")
    if len(args) != 1 or args[0] not in ["--mode=" + m for m in modes]:
        print("usage: mcp_retire.py --mode=install|check|dry-run|uninstall", file=sys.stderr)
        return 2
    mode = args[0].split("=", 1)[1]
    try:
        names = load_policy(POLICY)
    except (OSError, ValueError) as e:
        print("REFUSE  retired MCP servers: %s" % e, file=sys.stderr)
        return 2
    path = target()
    backup = Path(str(path) + BACKUP)
    if mode == "uninstall":
        if backup.exists():
            print("NOTE    %s: the MCP server(s) mhw removed are in %s; uninstall does not re-add a server the "
                  "policy retired (ADR-0035 decision 2)" % (path, backup))
        return 0
    if not names or not path.exists():
        print("OK      %s: no retired MCP server (%s)" % (path, ", ".join(names) or "none retired"))
        return 0
    return _apply(mode, path, backup, names)


if __name__ == "__main__":
    sys.exit(main())
