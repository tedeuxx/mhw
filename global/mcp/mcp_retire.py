#!/usr/bin/env python3
"""Remove the MCP servers the policy retired from the Codex user configuration (ADR-0035 decision 2,
Issue #145).

    mcp_retire.py --mode=install|check|dry-run|uninstall [--home=DIR] [--policy=FILE]

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

Backup. Before the write the previous file is copied, mode kept, to config.toml.pmhwc-mcp-backup. That is
the restore route: uninstall does not re-add a server the policy retired, it names the backup.

Exit codes, as install.sh: 0 ok · 1 a retired server is present (--check) · 2 usage · 3 unreadable, not
valid TOML, a shape this script does not edit, or an edit that would not verify.
"""
import copy
import os
import re
import shutil
import sys
from pathlib import Path

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


def target(home):
    return Path(os.environ.get("CODEX_HOME") or Path(home) / ".codex") / "config.toml"


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


def plan(text, names):
    """-> (new text, removed names, names found only inside the managed block). Raises Refuse."""
    if tomllib is None:
        # No parser to verify with: a file that never names a retired server is settled; one that does is
        # refused rather than edited blind.
        if not any(n in text for n in names):
            return text, [], []
        raise Refuse("it names a retired MCP server, and removing one needs Python 3.11+ (tomllib) to verify "
                     "the edit; nothing written")
    try:
        old = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        raise Refuse("not valid TOML (%s); left untouched" % e)
    servers = old.get("mcp_servers")
    present = [n for n in names if isinstance(servers, dict) and n in servers]
    if not present:
        return text, [], []
    lines = text.splitlines(keepends=True)
    block = _block_span(lines)
    drop, removed, in_block = set(), [], []
    for name in present:
        hit = False
        for i, line in enumerate(lines):
            if not _header_of(line, name):
                continue
            if block and block[0] <= i <= block[1]:
                continue
            hit = True
            # The table runs to the next header. Comment lines directly above that header describe it, so
            # they stay; anything else of this table goes, its trailing blank lines included.
            j = i + 1
            while j < len(lines) and not HEADER_RE.match(lines[j]) and not (block and j == block[0]):
                j += 1
            k = j
            while k > i + 1 and lines[k - 1].lstrip().startswith("#"):
                k -= 1
            drop.update(range(i, k))
        if hit:
            removed.append(name)
        elif block and any(_header_of(l, name) for l in lines[block[0]:block[1] + 1]):
            in_block.append(name)
        else:
            raise Refuse("the retired MCP server %s is not written as a [mcp_servers.%s] table (an inline "
                         "table or dotted keys); nothing written" % (name, name))
    new_text = "".join(l for i, l in enumerate(lines) if i not in drop)
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
    if new != want and new != alt:
        raise Refuse("removing %s would change more than that server; nothing written" % ", ".join(removed))
    return new_text, removed, in_block


def main(argv=None):
    mode, home, policy = None, Path.home(), POLICY
    for arg in (argv if argv is not None else sys.argv[1:]):
        if arg.startswith("--mode="):
            mode = arg.split("=", 1)[1]
        elif arg.startswith("--home="):
            home = Path(arg.split("=", 1)[1])
        elif arg.startswith("--policy="):
            policy = Path(arg.split("=", 1)[1])
        else:
            print("unknown argument: %s" % arg, file=sys.stderr)
            return 2
    if mode not in ("install", "check", "dry-run", "uninstall"):
        print("--mode=install|check|dry-run|uninstall is required", file=sys.stderr)
        return 2
    try:
        names = load_policy(policy)
    except (OSError, ValueError) as e:
        print("REFUSE  retired MCP servers: %s" % e, file=sys.stderr)
        return 2
    path = target(home)
    backup = Path(str(path) + BACKUP)
    if mode == "uninstall":
        if backup.exists():
            print("NOTE    %s: the MCP server(s) mhw removed are in %s; uninstall does not re-add a server the "
                  "policy retired (ADR-0035 decision 2)" % (path, backup))
        return 0
    if not names or not path.exists():
        print("OK      %s: no retired MCP server (%s)" % (path, ", ".join(names) or "none retired"))
        return 0
    try:
        text = path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as e:
        print("REFUSE  %s: unreadable (%s); left untouched" % (path, e.__class__.__name__))
        return 3
    try:
        new_text, removed, in_block = plan(text, names)
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
    shutil.copy2(str(path), str(backup))
    tmp = path.with_name(path.name + ".new.%d" % os.getpid())
    tmp.write_text(new_text, encoding="utf-8")
    shutil.copymode(str(path), str(tmp))
    os.replace(str(tmp), str(path))
    print("CHANGED %s: %s (retired MCP servers, ADR-0035 decision 2; previous file kept as %s)" % (path, what, backup))
    return 0


if __name__ == "__main__":
    sys.exit(main())
