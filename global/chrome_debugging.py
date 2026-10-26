#!/usr/bin/env python3
"""Turn on Chrome's remote-debugging toggle for the owner (Issue #224; ADR-0038, amendment 2026-10-24).

    chrome_debugging.py --mode=install|check|dry-run|uninstall [--home=DIR]

The chrome-devtools MCP server attaches to the owner's running Chrome (--autoConnect), which needs the
remote-debugging server he would otherwise turn on at chrome://inspect/#remote-debugging. That toggle is
one Chrome preference, devtools.remote_debugging.user-enabled, kept in the browser's Local State file
for all of Chrome (Chromium chrome/common/pref_names.h). Chrome reads it at startup and then runs the
server in its approval-only mode: Chrome still asks the owner to allow a connection (whether on each one
or once per Chrome run is not measured), and nothing here changes that.

The owner's decision on Issue #224: mhw install sets the key itself. The rules it was given:
  - write only while Chrome is not running; if it runs, skip with one line;
  - change only that key: a JSON round-trip that keeps every other field, written atomically (a temporary
    file in Chrome's own directory, then a rename);
  - never print, log or copy the file's contents; no backup is made anywhere;
  - a no-op when the key is already true;
  - only when the chrome-devtools server in its attach form (--autoConnect) is in the Claude Code user
    configuration: if the MCP renderer refused it, or an older isolated copy is kept, nothing would
    attach, so the key is left as it is (a SKIP line).
Uninstall leaves the key alone: it is the owner's browser setting, and turning it off is his click.

Paths: macOS ~/Library/Application Support/Google/Chrome/Local State; Linux ~/.config/google-chrome/Local
State. Other systems are skipped. Output lines use install.sh's words. Exit codes: 0 ok or skipped;
1 the key is not on (--check); 2 usage; 3 the file cannot be read as JSON or cannot be written.
Standard library only, Python 3.9+.
"""

import json
import os
import platform
import subprocess
import sys
import tempfile
from pathlib import Path

KEY = ("devtools", "remote_debugging", "user-enabled")
KEY_NAME = ".".join(KEY)
USER_DATA = {"Darwin": ("Library", "Application Support", "Google", "Chrome"),
             "Linux": (".config", "google-chrome")}
# The process names pgrep -x matches for the stable channel.
PROCESS = {"Darwin": "Google Chrome", "Linux": "chrome"}
LABEL = "(Chrome remote debugging)"
SERVER = "chrome-devtools"


class NotSynced(Exception):
    """The new file is in place, but fsync of its directory failed: the rename may not survive a crash."""


def attach_rendered(home=None):
    """True when Claude Code's user configuration holds the chrome-devtools server in its attach form
    (--autoConnect) with the origin bound (--allowedUrlPattern) in the same args. Only that one entry's args are looked at; nothing is printed. Issue #224 lens: when the
    MCP renderer refused the server (a local copy that conflicts with the policy's, ADR-0038 amendment for
    #219) or left an older copy, nothing here would attach, so remote debugging is not turned on."""
    try:
        with open(Path(home or Path.home()) / ".claude.json", encoding="utf-8") as fh:
            entry = json.load(fh).get("mcpServers", {}).get(SERVER, {})
        words = " ".join(str(a) for a in entry.get("args", [])).split()
        # PR #227 lens advisory: an attach without the origin bound in the same args does not count.
        return "--autoConnect" in words and "--allowedUrlPattern" in words
    except (OSError, ValueError, AttributeError):
        return False


def local_state(system=None, home=None):
    parts = USER_DATA.get(system or platform.system())
    return Path(home or Path.home()).joinpath(*parts, "Local State") if parts else None


def chrome_running(system=None):
    """True when Chrome runs, or when that cannot be told: an unknown answer must not lead to a write."""
    name = PROCESS.get(system or platform.system())
    if name is None:
        return True
    try:
        return subprocess.run(["pgrep", "-x", name], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                              check=False).returncode != 1
    except OSError:
        return True


def read_value(path):
    """The key's value: True, False, None (absent), or the string "unreadable". Only that one key leaves
    this function; the rest of the parsed document is dropped here."""
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except (OSError, ValueError):
        return "unreadable"
    node = doc
    for part in KEY:
        if not isinstance(node, dict) or part not in node:
            return None
        node = node[part]
    return node if isinstance(node, bool) else "unreadable"


def set_on(path):
    """Set the key to true, keeping every other field and key order. Atomic: write beside, then rename."""
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)
    if not isinstance(doc, dict):
        raise ValueError("not a JSON object")
    node = doc
    for part in KEY[:-1]:
        child = node.setdefault(part, {})
        if not isinstance(child, dict):
            raise ValueError("an intermediate key is not an object")
        node = child
    node[KEY[-1]] = True
    mode = os.stat(path).st_mode & 0o777
    fd, tmp = tempfile.mkstemp(prefix=".Local State.mhw-", dir=os.path.dirname(path))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            json.dump(doc, fh, ensure_ascii=False, separators=(",", ":"))
            fh.flush()
            os.fsync(fh.fileno())
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.unlink(tmp)
        raise
    # Durability of the rename itself (PR #227 advisory A5): fsync the directory that holds it. The file is
    # already replaced here, so a failure is reported as such, never as "nothing was written".
    try:
        dfd = os.open(os.path.dirname(path) or ".", os.O_RDONLY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
    except OSError as e:
        raise NotSynced() from e


def status_text(system=None, home=None):
    """The mhw status line: the key's value, never the file's contents."""
    path = local_state(system, home)
    if path is None:
        return "not read (no default Chrome profile path for %s)" % (system or platform.system())
    if not path.is_file():
        return "no Chrome Local State found"
    value = read_value(path)
    port = "DevToolsActivePort present" if (path.parent / "DevToolsActivePort").is_file() else \
        "no DevToolsActivePort"
    if value is True:
        return "on (%s = true; %s; Chrome asks to allow a connection)" % (KEY_NAME, port)
    if value is False or value is None:
        return "off (%s %s; %s); mhw install turns it on while Chrome is closed" % (
            KEY_NAME, "= false" if value is False else "absent", port)
    return "not read (%s: Local State is not readable JSON, or the key is not a boolean)" % KEY_NAME


def run(mode, system=None, home=None, running=None):
    path = local_state(system, home)
    if path is None:
        print("SKIP    Chrome remote debugging: no default Chrome profile path on %s %s" % (
            system or platform.system(), LABEL))
        return 0
    if not path.is_file():
        print("SKIP    %s: no Chrome Local State (Chrome not installed or never started) %s" % (path, LABEL))
        return 0
    value = read_value(path)
    if value == "unreadable":
        print("REFUSE  %s: not readable JSON, or %s is not a boolean; left as it is %s" % (path, KEY_NAME, LABEL))
        return 3
    if value is True:
        print("OK      %s: %s = true %s" % (path, KEY_NAME, LABEL))
        return 0
    old = "false" if value is False else "absent"
    if mode != "uninstall" and not attach_rendered(home):
        print("SKIP    %s: %s %s, left as it is: no %s server in its attach form is in the Claude Code user "
              "configuration (refused or not rendered), so nothing would attach %s" % (path, KEY_NAME, old, SERVER, LABEL))
        return 0
    if mode == "check":
        print("DRIFT   %s: %s %s, want true %s" % (path, KEY_NAME, old, LABEL))
        return 1
    if mode == "uninstall":
        print("NOTE    %s: %s %s; uninstall never changes it %s" % (path, KEY_NAME, old, LABEL))
        return 0
    if mode == "dry-run":
        print("WOULD   %s: %s %s -> true %s" % (path, KEY_NAME, old, LABEL))
        return 0
    if (running or chrome_running)(system):
        print("SKIP    %s: Chrome is running, so %s was not set; quit Chrome and run mhw install again %s"
              % (path, KEY_NAME, LABEL))
        return 0
    try:
        set_on(path)
    except NotSynced:
        print("CHANGED %s: %s %s -> true, but the directory was not synced, so the change may not survive a "
              "crash %s" % (path, KEY_NAME, old, LABEL))
        return 3
    except (OSError, ValueError):
        print("REFUSE  %s: %s could not be set; nothing was written %s" % (path, KEY_NAME, LABEL))
        return 3
    print("CHANGED %s: %s %s -> true %s" % (path, KEY_NAME, old, LABEL))
    return 0


def main(argv):
    mode, home = None, None
    for arg in argv:
        if arg.startswith("--mode="):
            mode = arg[len("--mode="):]
        elif arg.startswith("--home="):
            home = arg[len("--home="):]
        elif arg.startswith("--stamp="):
            pass
        else:
            print("usage: chrome_debugging.py --mode=install|check|dry-run|uninstall [--home=DIR]",
                  file=sys.stderr)
            return 2
    if mode not in ("install", "check", "dry-run", "uninstall"):
        print("usage: chrome_debugging.py --mode=install|check|dry-run|uninstall [--home=DIR]", file=sys.stderr)
        return 2
    return run(mode, home=home)


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
