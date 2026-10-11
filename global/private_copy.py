"""The one Python form of private_copy: every .pmhwc-*backup of a harness config is owner-only (0600).

Shared by global/kiro/kiro_permissions.py, global/mcp/mcp_render.py, global/mcp/mcp_retire.py and
global/models/model_defaults.py, which each carried a copy until Issue #145 (they had drifted: only the Kiro
one opened with O_NOFOLLOW). Each of them puts this directory on sys.path and imports it; they all run from
the checkout or the npm package, where global/ is whole.

install.sh keeps a shell form of the same helper (it, and allow-list.sh which it sources, need no python3:
python3 is optional there and only the steps written in Python skip without it). global/private_copy_test.py
runs both forms on the same cases and requires the same result, so the two cannot drift apart unnoticed.
"""
import os
import shutil


def private_copy(src, dst):
    """Copy src to dst, owner-only (0600) from its first byte, whatever src's mode: a backup can hold what
    install removed, such as an MCP server's environment values (PR #146 QA advisory, PR #147 lens F1).
    Whatever is already at dst (a file, a hard link, a symbolic link) is unlinked first and never written
    through; dst is then created with O_EXCL and O_NOFOLLOW where the platform has it, so a link planted at
    dst between the unlink and the create makes the copy fail instead of following it."""
    if os.path.lexists(dst):
        os.remove(dst)
    fd = os.open(dst, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), 0o600)
    with os.fdopen(fd, "wb") as out, open(src, "rb") as inp:
        shutil.copyfileobj(inp, out)
    os.chmod(dst, 0o600)
