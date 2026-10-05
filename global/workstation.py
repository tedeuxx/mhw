#!/usr/bin/env python3
"""The one entry point of the managed workstation (Issue #67), run through ./workstation.

    ./workstation install                 user layer, every agent harness, hooks mode detected
    ./workstation install --admin         render and validate the admin layer; print its one sudo line
    ./workstation status [--verbose]      what is installed, which layers and protections, the version key
    ./workstation check                   exit non-zero when an installed target differs from this checkout
    ./workstation update [vX.Y.Z]         fetch tags, check out the newest release (or the one given), install
    ./workstation uninstall               remove the user layer; print the sudo line for the admin layer

Options for every subcommand: --overlay=DIR|none (default: the repository's overlay/), and
--project=DIR for status (default: the git root of the current directory).

global/install.sh and global/install-managed.sh stay the internals: this file decides their flags and
summarises their output, it renders nothing itself. Version key (Issue #57): a project declares the
workstation release range it needs in a .workstation-version file, for example ">=3.1 <4"; status
compares it with the installed provenance stamp (ADR-0029) and never fails on a mismatch.

Environment, tests and probes only: WORKSTATION_MANAGED_ROOT prefixes every admin-layer path.
Standard library only, Python 3.9+. Never writes outside what install.sh writes, never runs sudo.
"""
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import sys

NAME = "personal-multi-harness-workstation-configuration"
MARKER = "managed-by: " + NAME
KEY_FILE = ".workstation-version"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
INSTALL = HERE / "install.sh"
INSTALL_MANAGED = HERE / "install-managed.sh"
FIX = "./workstation install"

# ---------------------------------------------------------------------------------------------------
# Version key (Issue #57): pure functions, no I/O.

_VERSION = re.compile(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?")
_COMPARATOR = re.compile(r"(>=|<=|>|<|=)(v?\d+(?:\.\d+){0,2})")
_RELEASE = re.compile(r"v(\d+)\.(\d+)\.(\d+)")
_AFTER = re.compile(r"unreleased, after v(\d+)\.(\d+)\.(\d+)")


def parse_version(text):
    """'3', '3.1', 'v3.1.2' -> (3, 1, 2); a missing part is 0. Anything else -> None."""
    m = _VERSION.fullmatch(text.strip())
    if not m:
        return None
    return tuple(int(p) if p is not None else 0 for p in m.groups())


def parse_range(text):
    """'>=3.1 <4' -> [('>=', (3, 1, 0)), ('<', (4, 0, 0))]. Comparators are separated by blanks or
    commas and all must hold. Raises ValueError on anything else, an empty range included."""
    parts = [p for p in re.split(r"[\s,]+", text.strip()) if p]
    if not parts:
        raise ValueError("empty range")
    out = []
    for part in parts:
        m = _COMPARATOR.fullmatch(part)
        if not m:
            raise ValueError("not a comparator: " + part)
        out.append((m.group(1), parse_version(m.group(2))))
    return out


def satisfies(version, comparators):
    for op, bound in comparators:
        ok = {">=": version >= bound, "<=": version <= bound, ">": version > bound,
              "<": version < bound, "=": version == bound}[op]
        if not ok:
            return False
    return True


def installed_version(release):
    """The version a provenance stamp's release field stands for. 'vX.Y.Z' is that release; an
    'unreleased, after vX.Y.Z' install is compared as X.Y.Z, because no newer release is in it.
    'none', 'unknown' and 'no tag reachable' stand for nothing."""
    release = (release or "").strip()
    m = _RELEASE.fullmatch(release) or _AFTER.fullmatch(release)
    return tuple(int(g) for g in m.groups()) if m else None


def read_key(text):
    """The range in a .workstation-version file: the first line that is not blank or a # comment."""
    for line in text.splitlines():
        line = line.split("#", 1)[0].strip()
        if line:
            return line
    return ""


def mismatch_line(required, installed):
    return ("Workstation version key: required %s, installed %s. Run %s in the managed-workstation "
            "checkout." % (required, installed or "none", FIX))


def key_verdict(required, release):
    """-> (state, line). state is match, mismatch or invalid; line is the one line to print, or ''."""
    try:
        comparators = parse_range(required)
    except ValueError as e:
        return "invalid", "Workstation version key: %s holds no valid range (%s)." % (KEY_FILE, e)
    version = installed_version(release)
    if version is not None and satisfies(version, comparators):
        return "match", ""
    return "mismatch", mismatch_line(required, release)


# ---------------------------------------------------------------------------------------------------
# Status output: pure, from a facts dictionary gathered below.

def short_stamp(stamp):
    """'release: v3.1.0; commit: <40 hex>' -> 'v3.1.0 @ <7 hex>'; anything else unchanged."""
    if not stamp or stamp == "none":
        return "none"
    m = re.fullmatch(r"release: (.*); commit: (\S+)", stamp)
    if not m:
        return stamp
    commit = m.group(2)
    if re.match(r"[0-9a-f]{40}", commit):
        commit = commit[:7] + commit[40:]
    return "%s @ %s" % (m.group(1), commit)


def release_of(stamp):
    m = re.fullmatch(r"release: (.*); commit: \S+", stamp or "")
    return m.group(1) if m else (stamp or "none")


def render_status(f, verbose=False):
    """The status view. Short by default; verbose adds the per-target lines and versions."""
    lines = ["Workstation status"]
    lines.append("  source           %s (this checkout)" % short_stamp(f["source"]))
    user = sorted(set(f["user_stamps"].values()))
    user_text = " / ".join(short_stamp(s) for s in user) if user else "none"
    admin_text = short_stamp(f["admin_stamp"]) if f["admin"] else "not installed"
    lines.append("  installed        user: %s · admin: %s" % (user_text, admin_text))
    fix = f["user_issues"] + (f["admin_issues"] if f["admin"] else 0)
    check = "matches this checkout" if fix == 0 else "%d target(s) differ; run %s" % (fix, FIX)
    lines.append("  check            %s" % check)
    harnesses = [h for h, v in f["harnesses"].items() if v is not None]
    lines.append("  agent harnesses  %s" % (", ".join(harnesses) if harnesses else "none detected on PATH"))
    ws = f["workspace"]
    ws_text = "%s (%s)" % (ws["name"], ", ".join(ws["carriers"]) if ws["carriers"] else "no carrier") \
        if ws["name"] else "none (not in a git repository)"
    plugins = f["plugins"]
    plugin_text = "%d enabled in Claude Code" % len(plugins) if plugins else "none enabled in Claude Code"
    lines.append("  layers           managed: %s · user: %s · workspace: %s · plugin: %s" % (
        "installed" if f["admin"] else "absent", "installed" if user else "absent", ws_text, plugin_text))
    lines.append("  protections      brief: %s · deny floor: %s · hooks registered: %s" % (
        f["brief"], f["floor"], f["hooks"]))
    key = f["key"]
    if key is None:
        lines.append("  version key      none (%s absent in the workspace)" % KEY_FILE)
    else:
        lines.append("  version key      %s: %s" % (key["required"], key["state"]))
        if key["line"]:
            lines.append("                   " + key["line"])
    lines.append("  runtime          %s" % f["runtime"])
    lines.append("  evidence         installed is the most this view observes; loaded and enforced need a "
                 "session canary")
    if verbose:
        for h, v in f["harnesses"].items():
            lines.append("  agent harness    %s: %s" % (h, v if v is not None else "not on PATH"))
        for p in plugins:
            lines.append("  plugin           %s" % p)
        for line in f["user_lines"] + f["admin_lines"]:
            lines.append("  | " + line)
    return lines


# ---------------------------------------------------------------------------------------------------
# Facts gathering: reads installed files and runs the installers' own --check.

def managed_root():
    return os.environ.get("WORKSTATION_MANAGED_ROOT", "")


def admin_dropin():
    base = "/Library/Application Support/ClaudeCode" if platform.system() == "Darwin" else "/etc/claude-code"
    return Path(managed_root() + base + "/managed-settings.d/50-%s.json" % NAME)


def admin_installed():
    try:
        return NAME in json.loads(admin_dropin().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False


def stamp_in(path):
    """The release and commit of the first managed-by line in a file, or 'none'."""
    try:
        with open(path, encoding="utf-8", errors="replace") as fh:
            for line in fh:
                if MARKER in line:
                    m = re.search(r"; (release: [^;\"]*; commit: [^;\"]*);", line)
                    return m.group(1) if m else "none"
    except OSError:
        pass
    return "none"


def brief_paths():
    home = Path.home()
    codex = Path(os.environ.get("CODEX_HOME") or home / ".codex")
    return {"Claude Code": home / ".claude" / "CLAUDE.md", "Codex": codex / "AGENTS.md",
            "Kiro": home / ".kiro" / "steering" / "workstation-global-brief.md"}


def run(args, capture=True):
    p = subprocess.run(args, capture_output=capture, text=True)
    return p.returncode, ((p.stdout or "") + (p.stderr or "")).splitlines() if capture else []


# The validated --overlay reaches the installers through this environment variable, never through their
# argv: main() sets it once, every child inherits it, and no CLI string is forwarded as an argument.
OVERLAY_ENV = "WORKSTATION_OVERLAY"


def install_args(extra):
    args = ["sh", str(INSTALL)] + extra
    if managed_root():
        args.append("--managed-root=" + managed_root())
    return args


def managed_args(extra):
    args = ["sh", str(INSTALL_MANAGED)] + extra
    if managed_root():
        args.append("--root=" + managed_root())
    return args


_TARGET = re.compile(r"(OK|STAMP|DRIFT|MISSING|STALE|REFUSE|SKIP)\s")


def issues(lines):
    return sum(1 for line in lines if _TARGET.match(line) and not line.startswith(("OK", "SKIP")))


def harness_versions():
    out = {}
    for name, exe in (("Claude Code", "claude"), ("Codex", "codex"), ("Kiro", "kiro-cli")):
        path = shutil.which(exe)
        if not path:
            out[name] = None
            continue
        try:
            p = subprocess.run([path, "--version"], capture_output=True, text=True, timeout=10)
            out[name] = (p.stdout.strip().splitlines() or ["version unknown"])[0]
        except (OSError, subprocess.TimeoutExpired):
            out[name] = "version unknown"
    return out


def workspace(project):
    if project:
        top = Path(project).resolve()
    else:
        code, out = run(["git", "rev-parse", "--show-toplevel"])
        if code != 0 or not out:
            return {"name": "", "root": None, "carriers": []}
        top = Path(out[0])
    carriers = [c for c in (KEY_FILE, "AGENTS.md", "CLAUDE.md", ".claude", ".codex", ".kiro", ".agents")
                if (top / c).exists()]
    return {"name": top.name, "root": top, "carriers": carriers}


def enabled_plugins(ws_root):
    """Claude Code plugins enabled in the user settings, minus those a project settings file disables."""
    enabled = {}
    sources = [Path.home() / ".claude" / "settings.json"]
    if ws_root:
        sources += [ws_root / ".claude" / "settings.json", ws_root / ".claude" / "settings.local.json"]
    for src in sources:
        try:
            doc = json.loads(src.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        plugins = doc.get("enabledPlugins") if isinstance(doc, dict) else None
        if isinstance(plugins, dict):
            for name, on in plugins.items():
                enabled[name] = bool(on)
    return sorted(n for n, on in enabled.items() if on)


def runtime():
    system = "%s %s" % (platform.system(), platform.machine())
    if Path("/run/.containerenv").exists():
        return "container (Podman marker /run/.containerenv) on %s" % system
    if Path("/.dockerenv").exists():
        return "container (Docker marker /.dockerenv) on %s" % system
    if os.environ.get("container"):
        return "container (%s, from $container) on %s" % (os.environ["container"], system)
    try:
        cgroup = Path("/proc/1/cgroup").read_text(encoding="utf-8")
        for word in ("docker", "podman", "containerd", "kubepods"):
            if word in cgroup:
                return "container (%s in /proc/1/cgroup) on %s" % (word, system)
    except OSError:
        pass
    return "host (%s; no container marker found)" % system


GUARD = "hitl-escalation-guard.sh"
PASTE = "clipboard_guard.py"


def _commands(doc, event):
    """Every hook command string registered for one event in a Claude Code or Codex JSON hooks document."""
    out = []
    groups = (doc.get("hooks") or {}).get(event) if isinstance(doc, dict) else None
    for group in groups if isinstance(groups, list) else []:
        for hook in (group.get("hooks") or []) if isinstance(group, dict) else []:
            if isinstance(hook, dict) and isinstance(hook.get("command"), str):
                out.append(hook["command"])
    return out


def _json(path):
    """-> (document, state): state is 'absent', 'read' or 'not read' (unreadable or not JSON)."""
    if not path.exists():
        return None, "absent"
    try:
        return json.loads(path.read_text(encoding="utf-8")), "read"
    except (OSError, ValueError):
        return None, "not read"


def read_hooks():
    """Which of our hooks each layer actually registers, read from the installed files. A hook counts
    only when its entry is registered AND the script it runs is present. -> {layer: [found] | 'not read'}."""
    data = Path(os.environ.get("XDG_DATA_HOME") or Path.home() / ".local" / "share") / NAME
    codex_home = Path(os.environ.get("CODEX_HOME") or Path.home() / ".codex")
    if platform.system() == "Darwin":
        admin_bin = Path(managed_root() + "/Library/Application Support/%s/bin" % NAME)
    else:
        admin_bin = Path(managed_root() + "/etc/%s/bin" % NAME)
    result = {}

    found, unread = [], False
    doc, state = _json(Path.home() / ".claude" / "settings.json")
    unread |= state == "not read"
    if any(GUARD in c for c in _commands(doc, "PreToolUse")) and (data / GUARD).is_file():
        found.append("picker guard (Claude Code)")
    if any(PASTE in c for c in _commands(doc, "UserPromptSubmit")) and (data / PASTE).is_file():
        found.append("paste filter (Claude Code)")
    doc, state = _json(codex_home / "hooks.json")
    unread |= state == "not read"
    if any(PASTE in c for c in _commands(doc, "UserPromptSubmit")) and (data / PASTE).is_file():
        found.append("paste filter (Codex)")
    result["user"] = "not read" if unread and not found else found + (["a file not read"] if unread else [])

    found, unread = [], False
    doc, state = _json(admin_dropin())
    unread |= state == "not read"
    if any(GUARD in c for c in _commands(doc, "PreToolUse")) and (admin_bin / GUARD).is_file():
        found.append("picker guard (Claude Code)")
    if any(PASTE in c for c in _commands(doc, "UserPromptSubmit")) and (admin_bin / PASTE).is_file():
        found.append("paste filter (Claude Code)")
    req = Path(managed_root() + "/etc/codex/requirements.toml")
    try:
        text = req.read_text(encoding="utf-8") if req.exists() else ""
    except OSError:
        text, unread = "", True
    if MARKER in text and "[[hooks.UserPromptSubmit" in text and PASTE in text and (admin_bin / PASTE).is_file():
        found.append("paste filter (Codex)")
    result["admin"] = "not read" if unread and not found else found + (["a file not read"] if unread else [])
    return result


def hooks_text(found):
    """'admin: … · user: …' from read_hooks(); a layer with nothing registered reads 'none'."""
    parts = []
    for layer in ("admin", "user"):
        value = found.get(layer, "not read")
        if isinstance(value, str):
            parts.append("%s: %s" % (layer, value))
        else:
            parts.append("%s: %s" % (layer, ", ".join(value) if value else "none"))
    return " · ".join(parts)


def summarise_protections(user_lines):
    brief = sum(1 for line in user_lines if line.startswith(("OK", "STAMP"))
                and any(str(p) in line for p in brief_paths().values()))
    floor = "not reported"
    for line in user_lines:
        if line.startswith("FLOOR   carried by: "):
            floor = line[len("FLOOR   carried by: "):].split(";")[0]
    return "installed in %d/3 agent harnesses (an instruction)" % brief, floor, hooks_text(read_hooks())


def gather(project):
    admin = admin_installed()
    hooks_mode = "managed" if admin else "user"
    code, user_lines = run(install_args(["--check", "--hooks=" + hooks_mode]))
    source = "none"
    for line in user_lines:
        if line.startswith("SOURCE  "):
            source = line[len("SOURCE  "):]
    admin_lines, admin_stamp = [], "none"
    if admin:
        _, admin_lines = run(managed_args(["--check"]))
        try:
            value = json.loads(admin_dropin().read_text(encoding="utf-8"))[NAME]
            m = re.search(r"; (release: [^;]*; commit: [^;]*);", value)
            admin_stamp = m.group(1) if m else "none"
        except (OSError, ValueError, KeyError):
            pass
    user_stamps = {h: s for h, p in brief_paths().items() if (s := stamp_in(p)) != "none"}
    ws = workspace(project)
    key = None
    if ws["root"] and (ws["root"] / KEY_FILE).is_file():
        required = read_key((ws["root"] / KEY_FILE).read_text(encoding="utf-8"))
        stamps = sorted(set(user_stamps.values()))
        release = release_of(stamps[0]) if len(stamps) == 1 else ("none" if not stamps else "mixed")
        state, line = key_verdict(required, release)
        key = {"required": required or "(empty)", "state": state, "line": line}
    brief, floor, hooks = summarise_protections(user_lines)
    return {"source": source, "user_stamps": user_stamps, "admin": admin, "admin_stamp": admin_stamp,
            "user_issues": issues(user_lines), "admin_issues": issues(admin_lines),
            "user_lines": user_lines, "admin_lines": admin_lines, "harnesses": harness_versions(),
            "workspace": ws, "plugins": enabled_plugins(ws["root"]), "brief": brief, "floor": floor,
            "hooks": hooks, "key": key, "runtime": runtime()}


# ---------------------------------------------------------------------------------------------------
# Subcommands.

def cmd_install(admin_flag):
    if admin_flag:
        # Renders into a stage and prints the one sudo line; the owner runs it. Never sudo here.
        code, _ = run(managed_args([]), capture=False)
        return code
    hooks_mode = "managed" if admin_installed() else "user"
    code, _ = run(install_args(["--hooks=" + hooks_mode]), capture=False)
    if admin_installed():
        acode, alines = run(managed_args(["--check"]))
        if acode == 0:
            print("ADMIN   installed and matching this checkout")
        else:
            print("ADMIN   %d admin target(s) differ from this checkout; run ./workstation install --admin "
                  "and its one sudo line" % max(issues(alines), 1))
    else:
        print("ADMIN   not installed; ./workstation install --admin prints its one sudo line")
    ccode, clines = run(install_args(["--check", "--hooks=" + hooks_mode]))
    if ccode == 0:
        print("CHECK   every user-level target matches this checkout")
    else:
        print("CHECK   the user-level check exits %d with %d target(s) differing; see ./workstation check"
              % (ccode, issues(clines)))
    return max(code, ccode)


def latest_release(tags):
    """The highest strictly numeric vX.Y.Z tag in an iterable of tag names, or None."""
    best = None
    for tag in tags:
        m = _RELEASE.fullmatch(tag.strip())
        if m:
            version = tuple(int(g) for g in m.groups())
            if best is None or version > best[0]:
                best = (version, tag.strip())
    return best[1] if best else None


def git(*args):
    return run(["git", "-C", str(ROOT)] + list(args))


def cmd_update(wanted):
    """Fetch tags, check out the newest release (or the one asked for), then install from it. Refuses on a
    working tree with a tracked change, so nothing uncommitted is carried into or lost by the checkout."""
    code, dirty = git("status", "--porcelain", "--untracked-files=no")
    if code != 0:
        print("REFUSE  %s is not a git checkout; update needs one" % ROOT, file=sys.stderr)
        return 2
    if dirty:
        print("REFUSE  the working tree has %d tracked change(s); commit or stash them, then run update"
              % len(dirty), file=sys.stderr)
        return 3
    code, out = git("fetch", "--tags", "--quiet")
    if code != 0:
        print("REFUSE  git fetch --tags failed: %s" % " ".join(out[-1:]), file=sys.stderr)
        return 2
    _, tags = git("tag", "--list", "v*")
    if wanted is not None:
        # The tag passed to git is the repository's own tag name, never the CLI string.
        known = [t for t in tags if _RELEASE.fullmatch(t) and t == wanted]
        if not known:
            print("REFUSE  %s is not a numeric release tag of this repository (vX.Y.Z)" % wanted,
                  file=sys.stderr)
            return 2
        target = known[0]
    else:
        target = latest_release(tags)
        if target is None:
            print("REFUSE  no numeric release tag found", file=sys.stderr)
            return 2
    new_entry = git("cat-file", "-e", target + ":global/workstation.py")[0] == 0
    if not new_entry and os.environ.get(OVERLAY_ENV) is not None:
        print("REFUSE  %s predates ./workstation and cannot receive --overlay; nothing checked out" % target,
              file=sys.stderr)
        return 2
    _, before = git("rev-parse", "--abbrev-ref", "HEAD")
    if before == ["HEAD"]:
        _, before = git("rev-parse", "--short", "HEAD")
    code, out = git("checkout", "--quiet", "--detach", target)
    if code != 0:
        print("REFUSE  git checkout %s failed: %s" % (target, " ".join(out[-1:])), file=sys.stderr)
        return 2
    print("UPDATE  checked out %s (detached; was %s)" % (target, (before or ["?"])[0]), flush=True)
    # Install with the code of the release just checked out, not with this process's copy.
    new = ROOT / "global" / "workstation.py"
    if new.is_file():
        return run([sys.executable, "-B", str(new), "install"], capture=False)[0]
    hooks_mode = "managed" if admin_installed() else "user"
    return run(install_args(["--hooks=" + hooks_mode]), capture=False)[0]


def cmd_uninstall():
    code, _ = run(install_args(["--uninstall"]), capture=False)
    if admin_installed():
        _, lines = run(managed_args(["--uninstall"]))
        for line in lines:
            if line.startswith("RUN "):
                print(line)
        print("ADMIN   the admin layer stays until you run the sudo line above yourself")
    else:
        print("ADMIN   not installed; nothing to remove there")
    print("THEN    open fresh Claude Code and Codex sessions")
    return code


def cmd_check():
    hooks_mode = "managed" if admin_installed() else "user"
    code, _ = run(install_args(["--check", "--hooks=" + hooks_mode]), capture=False)
    if admin_installed():
        acode, _ = run(managed_args(["--check"]), capture=False)
        code = max(code, acode)
    return code


def valid_overlay(value):
    """The --overlay value an installer may receive: 'none', or an existing directory as an absolute,
    resolved path. Anything else -> None, and the caller refuses before any subprocess runs."""
    if value == "none":
        return value
    if not value or value.startswith("-") or "\0" in value:
        return None
    path = Path(value).expanduser().resolve()
    return str(path) if path.is_dir() else None


def main(argv):
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.split("\n\n")[1] if argv else __doc__)
        return 0 if argv else 2
    command, rest = argv[0], argv[1:]
    overlay, project, verbose, admin, wanted = None, None, False, False, None
    for arg in rest:
        if arg.startswith("--overlay="):
            overlay = arg[len("--overlay="):]
        elif arg.startswith("--project=") and command == "status":
            project = arg[len("--project="):]
        elif arg in ("-v", "--verbose") and command == "status":
            verbose = True
        elif arg == "--admin" and command == "install":
            admin = True
        elif command == "update" and wanted is None and not arg.startswith("-"):
            wanted = arg
        else:
            print("workstation: unknown argument for %s: %s" % (command, arg), file=sys.stderr)
            return 2
    if overlay is not None:
        overlay = valid_overlay(overlay)
        if overlay is None:
            print("workstation: --overlay takes 'none' or an existing directory", file=sys.stderr)
            return 2
        os.environ[OVERLAY_ENV] = overlay
    if command == "install":
        return cmd_install(admin)
    if command == "check":
        return cmd_check()
    if command == "update":
        return cmd_update(wanted)
    if command == "uninstall":
        return cmd_uninstall()
    if command == "status":
        for line in render_status(gather(project), verbose):
            print(line)
        return 0
    print("workstation: unknown subcommand %s (install, install --admin, status, check, update, uninstall)" % command,
          file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
