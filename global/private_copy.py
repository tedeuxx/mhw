"""The one Python form of private_copy: every .pmhwc-*backup of a harness config is owner-only.

Shared by global/kiro/kiro_permissions.py, global/mcp/mcp_render.py, global/mcp/mcp_retire.py and
global/models/model_defaults.py, which each carried a copy until Issue #145 (they had drifted: only the Kiro
one opened with O_NOFOLLOW). Each of them puts this directory on sys.path and imports it; they all run from
the checkout or the npm package, where global/ is whole.

install.sh keeps a shell form of the same helper (it, and allow-list.sh which it sources, need no python3:
python3 is optional there and only the steps written in Python skip without it). global/private_copy_test.py
runs both forms on the same cases and requires the same result, so the two cannot drift apart unnoticed.
install.ps1 keeps a PowerShell form (Copy-Private) for the backups it writes itself, with the same Windows
access control as below; global/install.test.ps1 asserts it on every backup.
"""
import os
import shutil
import subprocess

FLAGS = os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0) | getattr(os, "O_BINARY", 0)


def owner_only_acl(path):
    """Windows: 0600 is not a Windows mode (it sets only the read-only bit), so the new, still empty file gets
    an access list that grants the current user alone, with inheritance removed (icacls, by SID, so no account
    name is parsed). A failure raises: no backup is written readable by more than its owner."""
    out = subprocess.run(["whoami", "/user", "/fo", "csv", "/nh"], capture_output=True, text=True, check=True)
    sid = out.stdout.strip().split(",")[-1].strip().strip('"')
    if not sid.startswith("S-1-"):
        raise OSError("cannot read the current user's SID")
    subprocess.run(["icacls", path, "/inheritance:r", "/grant:r", "*%s:F" % sid], capture_output=True, text=True,
                   check=True)


def private_copy(src, dst):
    """Copy src to dst, owner-only from its first byte, whatever src's mode: a backup can hold what install
    removed, such as an MCP server's environment values (PR #146 QA advisory, PR #147 lens F1). Whatever is
    already at dst (a file, a hard link, a symbolic link, a FIFO) is unlinked first and never written through;
    dst is then created with O_EXCL and O_NOFOLLOW where the platform has it, so anything planted at dst between
    the unlink and the create makes the copy fail instead of being opened. POSIX: mode 0600. Windows: the empty
    file is given an owner-only access list (owner_only_acl) before a byte is written."""
    if os.path.lexists(dst):
        os.remove(dst)
    fd = os.open(dst, FLAGS, 0o600)
    if os.name == "nt":
        # The exclusive handle stays open across the lockdown and the bytes go through it, so no other file can
        # be swapped in by path between the two. The CRT opens it sharing read, write and delete, and changing
        # an access list is not a data access, so icacls can set it while the handle is held.
        try:
            owner_only_acl(dst)
        except (OSError, subprocess.CalledProcessError) as e:
            os.close(fd)
            os.remove(dst)
            raise OSError("could not make %s owner-only (%s); no backup written" % (dst, e.__class__.__name__))
    with os.fdopen(fd, "wb") as out, open(src, "rb") as inp:
        shutil.copyfileobj(inp, out)
    os.chmod(dst, 0o600)
