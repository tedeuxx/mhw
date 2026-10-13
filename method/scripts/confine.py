"""Path confinement for the files whose content these scripts read and may publish (mhw #170).

A milestone description is posted to the forge, and a worklog event or export becomes an Issue comment, so
a path an agent passes is resolved (symlinks and `..` included) and refused unless it lies inside the work
tree of the repository the command runs in, or the system temporary directory. This is the confinement
`method_issue_sync.py` applies to MHW_SYNC_DIR, in the same shape.
"""

import os
import subprocess
import tempfile


def allowed_roots():
    """The roots a readable input may live under: the current work tree, then the temporary directories."""
    roots = []
    try:
        top = subprocess.run(["git", "rev-parse", "--show-toplevel"], capture_output=True, text=True,
                             check=False).stdout.strip()
    except OSError:
        top = ""
    candidates = [top] if top else []
    candidates.append(tempfile.gettempdir())
    if os.path.isdir("/tmp"):
        candidates.append("/tmp")
    for candidate in candidates:
        real = os.path.realpath(candidate)
        if real not in roots:
            roots.append(real)
    return roots


def confined(path):
    """The real path of `path` when it lies under an allowed root; ValueError otherwise. Nothing is read."""
    real = os.path.realpath(os.path.expanduser(str(path)))
    for root in allowed_roots():
        if real != root and os.path.commonpath([root, real]) == root:
            return real
    raise ValueError("%s is outside the repository work tree and the temporary directory; refusing to read it"
                     % path)
