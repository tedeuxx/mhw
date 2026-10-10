#!/usr/bin/env python3
"""The owner-action queue (ADR-0035, decision 9): how many OPEN issues in the mhw repository carry the
`owner-action` label, for `mhw status` and `mhw status --summary`.

Read-only: `gh issue list`, and `gh label list` only when the count is zero. Each call is bounded by a
timeout. When the count cannot be read (gh missing, not authenticated, offline, timed out, output not
understood, or the label itself absent) the answer is "not read (<reason>)", never a 0: a false 0 would
tell the owner his queue is empty when nobody looked. gh's own error text is classified, never printed.

Standard library only, Python 3.9+.
"""
import json
import os
import shutil
import subprocess

REPO = "tedeuxx/mhw"
LABEL = "owner-action"
TIMEOUT = 5  # seconds, per gh call
LIMIT = 1000  # gh issue list pages at 30 by default; a count at the limit is shown as "or more"
AUTH_EXIT = 4  # gh's documented exit code for "authentication required" (measured with gh 2.93.0)


def gh_binary():
    return shutil.which("gh")


def _gh(gh, args, timeout):
    """-> (exit code, stdout, stderr). Raises OSError or subprocess.TimeoutExpired.

    errors="replace": bytes gh prints that are not UTF-8 become U+FFFD instead of raising, so they are
    classified like any other unexpected output."""
    env = dict(os.environ, GH_PROMPT_DISABLED="1", NO_COLOR="1")
    p = subprocess.run([gh] + args, stdin=subprocess.DEVNULL, capture_output=True, text=True,
                       errors="replace", timeout=timeout, env=env)
    return p.returncode, p.stdout, p.stderr


def _failure(code, err):
    low = err.lower()
    if code == AUTH_EXIT or "http 401" in low or "bad credentials" in low:
        return "gh not authenticated"
    if "error connecting" in low or "could not resolve" in low or "no such host" in low:
        return "offline, GitHub unreachable"
    return "gh exited %d" % code


def _names(out):
    """The list of JSON objects gh printed, or None when it is not that."""
    try:
        data = json.loads(out)
    except ValueError:
        return None
    if not isinstance(data, list) or not all(isinstance(x, dict) for x in data):
        return None
    return data


def read(gh=None, timeout=TIMEOUT):
    """-> (count, reason). count is an int when read, else None and reason says why.

    Never raises: `mhw status` must exit 0 whatever gh does. Anything not classified below (for
    example JSON nested deep enough to hit RecursionError) reads as "gh output not understood"; the
    exception text is never shown, since it can carry gh's own output."""
    try:
        return _read(gh, timeout)
    except Exception:  # noqa: BLE001 - deliberate catch-all, see the docstring
        return None, "gh output not understood"


def _read(gh, timeout):
    gh = gh or gh_binary()
    if not gh:
        return None, "gh not found"
    try:
        code, out, err = _gh(gh, ["issue", "list", "--repo", REPO, "--label", LABEL, "--state", "open",
                                  "--limit", str(LIMIT), "--json", "number"], timeout)
        if code != 0:
            return None, _failure(code, err)
        issues = _names(out)
        if issues is None:
            return None, "gh output not understood"
        if issues:
            return len(issues), ""
        # An absent label also lists nothing, with exit 0 (measured): confirm it exists before saying 0.
        code, out, err = _gh(gh, ["label", "list", "--repo", REPO, "--limit", str(LIMIT), "--json", "name"],
                             timeout)
    except subprocess.TimeoutExpired:
        return None, "gh timed out after %ss" % timeout
    except OSError:
        return None, "gh could not run"
    if code != 0:
        return None, _failure(code, err)
    labels = _names(out)
    if labels is None:
        return None, "gh output not understood"
    if not any(x.get("name") == LABEL for x in labels):
        return None, "label %s absent in %s" % (LABEL, REPO)
    return 0, ""


def text(result):
    """The short form both views print: '3 open', '0 open' or 'not read (<reason>)'."""
    count, reason = result
    if count is None:
        return "not read (%s)" % (reason or "unknown")
    return "%d or more open" % LIMIT if count >= LIMIT else "%d open" % count
