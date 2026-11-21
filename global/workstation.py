#!/usr/bin/env python3
"""mhw, the one entry point of the multi-harness managed workstation (Issue #67), run through ./mhw in a
checkout and as mhw after an npm install (Issue #68). Its deprecated alias, ./workstation and the npm
`workstation` command, was removed in v7 (Issue #206).

    ./mhw install [--yes] [--verbose]   say what will change, wait for RETURN, ask for the administrator
                                          password once (only when the admin layer changes), install the
                                          admin layer and then the user layer, end with the next steps
                                          (Issue #113); without a terminal it only informs, unless --yes
    ./mhw install --no-admin            the user layer only, no password asked
    ./mhw install --admin               the admin layer only
    ./mhw install --method              also render the working method (method/); off by default until
                                          the plugin cutover (#63, #64), kept current once installed
    ./mhw status [--verbose]            what is installed, which layers and protections, the version key
    ./mhw status --summary              the session-start runtime summary an agent harness relays (#80)
    ./mhw status --mcp-connect[=SECONDS]  also start each MCP active-set server and say whether it answers
                                        (opt-in: it starts processes; exit 1 when one fails; #219)
                                        Node since #493 (src/commands/status.js); ./mhw runs it there
    ./mhw check                         exit non-zero when an installed target differs from this checkout
                                          (the admin layer included, stamped or from an earlier release),
                                          or a required prerequisite is missing (global/prerequisites.json)
    ./mhw check --prerequisites         the prerequisites section only (Issue #89); never applies anything
    ./mhw check --project=DIR           also check DIR's root AGENTS.md merge-authority declaration against
                                          the installed method contract (Issue #195): exit 1 on a finding,
                                          2 when the installed method cannot validate it (fail closed)
    ./mhw update [vX.Y.Z] [--yes]       fetch tags, check out the newest release (or the one given), install;
                                          in an npm install (no .git, Issue #68) run the npm update, then
                                          the new package's install (Issue #113)
    ./mhw uninstall [--yes]             remove the admin layer (password asked once) and the user layer;
                                          in an npm install, run it before npm uninstall -g mhw (npm runs
                                          no uninstall script, measured with npm 11.13.0)
    ./mhw scan [--base=REF | PATH...]   the outbound scan (ADR-0035, decision 7): the paste filter's
                                          detectors over the files this branch changed since its upstream
                                          (or REF, or the paths given) and over every unpushed commit's
                                          added lines and message; prints file:line, category and match
                                          length, never the matched text; exit 0 with findings;
                                          needs a git repository in these modes (exit 2 outside one)
    ./mhw scan --file=PATH              the same detectors and report over one text file, whether or
                                          not git tracks it, inside a repository or outside one (a post
                                          before it is published, Issue #34); exit 2 when PATH names no
                                          regular file
    ./mhw policy check [--project=DIR | --file=PATH]
                                        validate a project's ADR-0015 project-policy contract (Issue
                                          #245): DIR/project-policy.json (default: the current
                                          directory) or PATH; exit 0 only when it is valid, 1 when it is
                                          missing, malformed, of an unknown schema_version or breaks the
                                          contract, 2 when it cannot validate (fail closed); reads no
                                          evidence, which is the reference CI/CD's (#246)
    ./mhw postinstall                   what npm's postinstall runs (bin/postinstall.js): one line naming
                                          `mhw install`; it installs nothing (Issue #113)

Options for every subcommand: --overlay=DIR|none (default: the repository's overlay/), and
--project=DIR for status (default: the git root of the current directory) and for check (no default:
the project-brief section runs only when it is given).

global/install.sh and global/install-managed.sh stay the internals: this file decides their flags and
summarises their output, it renders nothing itself. The version key (Issue #57) is read by mhw status,
in Node since #493 (src/lib/readers/version-key.js).

Environment, tests and probes only: WORKSTATION_MANAGED_ROOT prefixes every admin-layer path.
Standard library only, Python 3.9+. Never writes outside what install.sh writes. sudo runs only for
install-managed.sh --apply or --remove, after the owner confirmed in a terminal (or passed --yes) and
sudo itself asked for the password (Issue #113).
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
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
INSTALL = HERE / "install.sh"
INSTALL_MANAGED = HERE / "install-managed.sh"


def npm_package(root=ROOT):
    """True for an npm install of this repository (Issue #68, ADR-0034): package.json present, no .git."""
    return (root / "package.json").is_file() and not (root / ".git").exists()


# The command an instruction names: mhw on PATH after an npm install, ./mhw in a checkout (Issue #68).
CMD = "mhw" if npm_package() else "./mhw"
FIX = CMD + " install"
# What the installed targets are compared with: this package (npm) or this checkout.
SOURCE_NAME = "this package" if CMD == "mhw" else "this checkout"
# The npm package name v4.1.0 shipped, before the rename to mhw (Issue #68).
LEGACY_PACKAGE = NAME
# The one instruction for the upgrade from it, in status, check, the postinstall summary and the docs.
UPGRADE_FIRST = "remove the v4.1.0 package first: `npm uninstall -g %s`" % LEGACY_PACKAGE


# ---------------------------------------------------------------------------------------------------
# Stamps and release tags. The status view, the version key and the owner-action count moved to Node
# (#493, S22 of #470: src/commands/status.js and src/lib/readers/); install, check, update and uninstall
# use what is left here.

_RELEASE = re.compile(r"v(\d+)\.(\d+)\.(\d+)")


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


# ---------------------------------------------------------------------------------------------------
# The admin layer and the installers' own --check, as install and check read them.

def managed_root():
    return os.environ.get("WORKSTATION_MANAGED_ROOT", "")


def admin_dropin():
    base = "/Library/Application Support/ClaudeCode" if platform.system() == "Darwin" else "/etc/claude-code"
    return Path(managed_root() + base + "/managed-settings.d/50-%s.json" % NAME)


def admin_installed():
    """True only for a drop-in carrying the #66 stamp key. Decides the hooks mode; never whether the
    admin layer is checked (an earlier release's admin layer has no stamp and must still be checked)."""
    try:
        return NAME in json.loads(admin_dropin().read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return False


def admin_base():
    base = "/Library/Application Support/" if platform.system() == "Darwin" else "/etc/"
    return Path(managed_root() + base + NAME)


def codex_requirements():
    return Path(managed_root() + "/etc/codex/requirements.toml")


def admin_present():
    """True when any admin layer of ours is on disk, stamped or from an earlier release: our drop-in,
    our admin directory (bin/ or the removed breaking-glass/ switches), or a Codex requirements file
    carrying our managed-by line. The admin --check runs whenever this is true (Issue #52)."""
    if admin_dropin().exists() or admin_base().exists():
        return True
    try:
        return MARKER in codex_requirements().read_text(encoding="utf-8")
    except OSError:
        return False


# Files an earlier release's admin layer installed for controls this release removed, by the name of the
# control (ADR-0028: restart guard and timed breaking-glass; ADR-0013, 2026-10-05: the picker guard and
# the session-intake exception its hitl.conf carried). install-managed.sh --check reports them as STALE.
REMOVED_CONTROLS = (
    ("restart_guard.py", "restart guard"),
    ("hitl-escalation-guard.sh", "picker guard"),
    ("hitl.conf", "session intake (the picker guard's intake exception)"),
    ("breaking_glass.py", "timed breaking-glass"),
    ("breaking-glass", "timed breaking-glass"),
)
_ENTRY = re.compile(r"(STALE|DRIFT|MISSING|STAMP|REFUSE)\s+(.*?)(?::\s.*| \([^()]*\))?$")


def admin_findings(lines):
    """-> ({kind: [file name]}, [removed control]) from install-managed.sh --check output."""
    entries, removed = {}, []
    for line in lines:
        m = _ENTRY.match(line)
        if not m:
            continue
        name = Path(m.group(2).rstrip("/")).name or m.group(2)
        entries.setdefault(m.group(1), []).append(name)
        if m.group(1) == "STALE":
            for file, control in REMOVED_CONTROLS:
                if name == file and control not in removed:
                    removed.append(control)
    order = [control for _, control in REMOVED_CONTROLS]
    return entries, sorted(removed, key=order.index)


ADMIN_NEXT = "next: %s install (it asks for your administrator password once)" % CMD


def admin_report(lines, code, prefix="ADMIN   "):
    """The lines that name what differs in the admin layer, each entry and removed control by name, and
    the exact next step. Empty when the admin --check exits 0."""
    if code == 0 and issues(lines) == 0:
        return []
    entries, removed = admin_findings(lines)
    count = max(issues(lines), 1)
    out = ["%sthe admin layer differs from %s: %d target(s)" % (prefix, SOURCE_NAME, count)]
    for kind in ("STALE", "DRIFT", "MISSING", "STAMP", "REFUSE"):
        if entries.get(kind):
            out.append("%s%s %s" % (prefix, kind, ", ".join(entries[kind])))
    if removed:
        out.append("%sremoved controls still installed: %s" % (prefix, ", ".join(removed)))
    out.append(prefix + ADMIN_NEXT)
    return out


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


# Issue #224 (ADR-0038 amendment 2026-10-24): whether Chrome's remote-debugging toggle is on, read as the
# single key devtools.remote_debugging.user-enabled from Chrome's Local State, so a Chrome update that
# renames the key shows here as "off" or "not read" rather than going silent. Since #480 (S09 of #470) the
# reading is `mhw chrome-debugging --mode=status` (src/render/chrome-debugging.js), spawned here.


# ---------------------------------------------------------------------------------------------------
# Subcommands.

def package_name(root=ROOT):
    """The npm package name of this install: mhw, or the name an earlier release shipped."""
    try:
        return json.loads((root / "package.json").read_text(encoding="utf-8")).get("name") or "mhw"
    except (OSError, ValueError):
        return "mhw"


def source_stamp():
    """This copy's provenance stamp, as install.sh --check computes it (its SOURCE line)."""
    _, lines = run(install_args(["--check", "--hooks=" + ("managed" if admin_installed() else "user")]))
    for line in lines:
        if line.startswith("SOURCE  "):
            return line[len("SOURCE  "):]
    return "none"


NOT_RUN = "installed by npm; the workstation is not set up from it yet"


def npm_notes(source, user_stamps, root=ROOT):
    """Lines about the npm install itself; none for a checkout (Issue #68). A package `mhw install` has not
    set up yet (Issue #113: npm installs nothing more): the user layer does not carry its stamp. And
    the v4.1.0 package, under its old name, still installed beside mhw."""
    if not npm_package(root):
        return []
    out = []
    stamps = sorted(set(user_stamps.values()))
    if source not in stamps:
        out.append("%s: this package is %s, the user layer carries %s; run mhw install" % (
            NOT_RUN, short_stamp(source), " / ".join(short_stamp(s) for s in stamps) if stamps else "nothing"))
    old = root.parent / LEGACY_PACKAGE
    if root.parent.name == "node_modules" and root.name != LEGACY_PACKAGE and (old / "package.json").is_file():
        version = package_version(old)
        # Both packages present means the upgrade went through by luck of route or by --force: npm refuses
        # mhw's workstation bin while the old package owns it (EEXIST, measured with npm 11.13.0 from a
        # tag or branch ref and from a tarball; a pinned commit happened to pass). The documented order is
        # the same either way, so the line names it.
        out.append("the %s package (the name before mhw) is still installed beside mhw; %s, then run mhw update "
                   "(the user layer stays)" % (version, UPGRADE_FIRST))
    return out


def package_version(root):
    try:
        return "v" + json.loads((root / "package.json").read_text(encoding="utf-8")).get("version", "?")
    except (OSError, ValueError):
        return "(version not read)"


# ---------------------------------------------------------------------------------------------------
# The install conversation (Issue #113): mhw is the one door, Homebrew-style. It says what will change,
# waits for RETURN, asks for the administrator password once and only when the admin layer changes,
# shows a few ==> headings, and ends with the result and numbered next steps. The installers' own
# lines are shown with --verbose; a problem line (REFUSE) is always shown. Without a terminal it only
# says what it would do, unless --yes.

SUDO = "/usr/bin/sudo"
_PROBLEM = re.compile(r"(REFUSE|STALE|DRIFT|MISSING)\s")


def _styled(code, text):
    if sys.stdout.isatty() and not os.environ.get("NO_COLOR"):
        return "\033[%sm%s\033[0m" % (code, text)
    return text


def heading(text):
    print("%s %s" % (_styled("34", "==>"), _styled("1", text)), flush=True)


def interactive():
    return sys.stdin.isatty() and sys.stdout.isatty()


def confirm():
    """True on RETURN. One key, no echo; any other key aborts. The terminal leaves line mode before the
    prompt is shown, so a key typed right after it is never held back waiting for a newline."""
    prompt = "Press %s to continue or any other key to abort:" % _styled("1", "RETURN")
    try:
        import termios
        import tty
        fd = sys.stdin.fileno()
        saved = termios.tcgetattr(fd)
        try:
            tty.setcbreak(fd)
            print(prompt, end=" ", flush=True)
            key = os.read(fd, 1)
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, saved)
    except (ImportError, OSError, ValueError):
        print(prompt, end=" ", flush=True)
        key = (sys.stdin.readline() or "x")[:1].encode() or b"\n"
    print()
    return key in (b"\r", b"\n")


def admin_supported():
    return platform.system() in ("Darwin", "Linux")


def install_plan(admin_wanted, user_wanted=True):
    """What `mhw install` would change, read-only: the user-layer targets that differ, and the admin
    layer's state ('current', 'absent', 'differs' or 'skipped')."""
    plan = {"user": 0, "admin": "skipped", "admin_count": 0}
    if user_wanted:
        code, lines = run(install_args(["--check", "--hooks=" + ("managed" if admin_installed() else "user")]))
        plan["user"] = issues(lines) or (1 if code else 0)
    if admin_wanted and admin_supported():
        if not admin_present():
            plan["admin"] = "absent"
        else:
            acode, alines = run(managed_args(["--check"]))
            plan["admin"] = "current" if acode == 0 else "differs"
            plan["admin_count"] = max(issues(alines), 1) if acode else 0
    return plan


def plan_lines(plan):
    out = []
    if plan["user"]:
        out.append("Your settings in Claude Code, Codex and Kiro: %d file(s) to write (no password needed)"
                   % plan["user"])
    if plan["admin"] == "absent":
        out.append("System-wide protections that no session can switch off: install them "
                   "(needs your administrator password, once)")
    elif plan["admin"] == "differs":
        out.append("System-wide protections: %d file(s) to update (needs your administrator password, once)"
                   % plan["admin_count"])
    return out


def show(lines, verbose):
    """The installers' lines: all of them with --verbose; otherwise the problems, and every CHANGED line,
    which names a setting of the owner's that install replaced or removed, old -> new (Issue #145)."""
    for line in lines:
        if verbose or _PROBLEM.match(line) or line.startswith("CHANGED "):
            print("    " + line, flush=True)


def as_root(args):
    """The admin-layer step, run as root by one sudo call that asks for the password itself. `-k` makes
    sudo ignore any cached credential, so the password is typed for this very step; sudo reads it from
    the terminal, not from the captured output. (`sudo -k -v` followed by `sudo -n` would fail: with
    -k, sudo does not cache, per its manual; PR #114 lens.) Under WORKSTATION_MANAGED_ROOT (tests) the
    admin root is a directory of the tests and no sudo runs."""
    if managed_root():
        return args + ["--root=" + managed_root()]
    return [SUDO, "-k", "-p", "Password for %u: "] + args


def admin_apply(verbose):
    """Render the admin stage as the owner, then apply it as root (as_root). -> (code, lines)."""
    code, lines = run(managed_args([]))
    show([l for l in lines if not l.startswith(("RUN ", "THEN"))], verbose)
    if code != 0:
        return code, lines
    run_line = next((l for l in lines if l.startswith("RUN ")), "")
    m = re.search(r'--apply="([^"]+)" --sha256=([0-9a-f]+)', run_line)
    if not m:
        return 3, ["REFUSE  the admin stage did not render"]
    acode, alines = run(as_root(["/bin/sh", str(INSTALL_MANAGED), "--apply=" + m.group(1),
                                 "--sha256=" + m.group(2)]))
    show([l for l in alines if not l.startswith("THEN")], verbose)
    return acode, alines


def admin_access(asking):
    """True when the admin-layer step may run: in a terminal (`asking`), after saying why the password is
    needed. The barrier is the password itself, asked by the one sudo call of as_root with `-k`, so a
    process that only fakes a terminal (an agent can, with `script`) meets a prompt it cannot answer
    (PR #114 lens). Without a terminal, sudo is not run at all. Under WORKSTATION_MANAGED_ROOT (tests)
    no sudo runs, so this is True."""
    if managed_root():
        return True
    if not asking:
        return False
    heading("Administrator access")
    print("The system-wide protections live in folders only an administrator can change, so that no agent")
    print("session can switch them off. sudo asks for your password now; mhw uses it for that step only.")
    return True


def owner_steps(lines):
    """The owner's own acts that install.sh names in its output, as plain next steps (Issue #113)."""
    steps = []
    for i, line in enumerate(lines):
        # Issue #145: install writes the paste wrapper's block into ~/.zshrc or ~/.bashrc itself. Only when
        # it chose no file (another shell, --shell-rc=none, a ZDOTDIR outside HOME) is the line the owner's;
        # install.sh gives the reason in parentheses, and the step repeats it rather than guessing one.
        if line.startswith("NOTE    automatic paste cleaning") and i + 1 < len(lines):
            m = re.search(r"\((.*)\); add this line", line)
            why = " (%s)" % m.group(1) if m else ""
            # macOS bash: ~/.bashrc got the block, only the login file did not (only ~/.profile is there).
            which = "bash login start-up file" if "no bash login start-up file" in line else "shell start-up file"
            steps.append("mhw wrote no %s%s. To clean pasted text automatically, add this "
                         "line to yours:\n       %s" % (which, why, lines[i + 1].strip()))
        if line.startswith("RESTART REQUIRED") and "/hooks" in line:
            steps.append("In Codex, approve the mhw hooks once: type /hooks in a new session.")
    return steps


def next_steps(steps):
    print()
    heading("Next steps")
    for i, step in enumerate(steps, 1):
        print("%d. %s" % (i, step))


FRESH = "Open new Claude Code, Codex and Kiro sessions: a session already running keeps its old settings."


def cmd_install(admin_only=False, method=False, verbose=False, yes=False, no_admin=False):
    version = package_version(ROOT) if npm_package() else "this checkout"
    asking = interactive()
    plan = install_plan(admin_wanted=not no_admin, user_wanted=not admin_only)
    changes = plan_lines(plan)
    if not changes and not method:
        heading("mhw %s is already installed and up to date" % version.lstrip("v")
                if npm_package() else "This workstation already matches this checkout")
        next_steps(["Run `%s status` to see what is installed." % CMD])
        return 0
    heading("mhw %s will change this workstation:" % version.lstrip("v")
            if npm_package() else "mhw will change this workstation from this checkout:")
    for line in changes or ["Your settings: render the working method"]:
        print("  - " + line)
    if not asking and not yes:
        print()
        print("Nothing was changed: no terminal to confirm in.")
        next_steps(["Run `%s install` in a terminal (or `%s install --yes` to skip the question)." % (CMD, CMD)])
        return 0
    if asking and not yes:
        print()
        if not confirm():
            print("Aborted; nothing was changed.")
            return 1
    failed, steps, owner, pending = [], [], [], False
    if plan["admin"] in ("absent", "differs"):
        if admin_access(asking):
            heading("Installing the system-wide protections")
            code, lines = admin_apply(verbose)
            if code != 0:
                failed.append("System-wide protections (exit %d; `%s install --verbose` shows why)" % (code, CMD))
        else:
            pending = True
            steps.append("Run `%s install` in a terminal to install the system-wide protections; it asks for "
                         "your administrator password." % CMD)
    if not admin_only:
        heading("Installing your settings")
        hooks_mode = "managed" if admin_installed() else "user"
        code, lines = run(install_args(["--hooks=" + hooks_mode] + (["--method"] if method else [])))
        show(lines, verbose)
        if code != 0:
            failed.append("Your settings (exit %d; `%s install --verbose` shows why)" % (code, CMD))
        owner = owner_steps(lines)
    heading("Checking")
    hooks_mode = "managed" if admin_installed() else "user"
    ccode, clines = run(install_args(["--check", "--hooks=" + hooks_mode]))
    if not admin_only and ccode != 0:
        show([l for l in clines if _PROBLEM.match(l)], verbose)
        failed.append("Your settings still differ in %d file(s)" % max(issues(clines), 1))
    if admin_present() and not no_admin:
        acode, alines = run(managed_args(["--check"]))
        if acode != 0 and plan["admin"] in ("absent", "differs") and not steps:
            failed.append("System-wide protections still differ in %d file(s)" % max(issues(alines), 1))
    print()
    if failed:
        print(_styled("31;1", "Installation incomplete:"))
        for f in failed:
            print("  - " + f)
        steps.insert(0, "Fix what is named above, then run `%s install` again." % CMD)
    elif pending:
        # The plan listed the system-wide protections and they were not installed: not a success.
        print(_styled("33;1", "Partly installed:") + " your settings are in place; the system-wide "
              "protections are not.")
    else:
        print(_styled("32;1", "Installation successful!"))
    steps += [FRESH] + owner + ["Run `%s status` to see what is installed." % CMD]
    next_steps(steps)
    return 1 if failed or pending else 0


def cmd_postinstall(method=False):
    """What npm's postinstall runs since Issue #113: nothing is installed. One line says where to go next;
    `mhw install` is the one door. Kept so a script calling it does not break; --method is ignored."""
    print("mhw %s is ready. Run `mhw install` to set up or update this workstation."
          % package_version(ROOT).lstrip("v"), flush=True)
    return 0


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


# The GitHub slug (Issue #68). NAME stays the internal identifier of installed files; only the URL moves.
REPO = "tedeuxx/mhw"


def npm_update_lines(wanted, root=ROOT):
    """-> (code, lines): the npm command that updates an npm install, never run here. The tag asked for,
    or the newest release in the installed major (major = breaking, Issue #52), which npm resolves from
    the repository's tags. Same text as bin/mhw.js's updateLines() (global/npm_package_test.py)."""
    if wanted is None:
        try:
            m = re.search(r'^current_version\s*=\s*"(\d+)\.(\d+)\.(\d+)"',
                          (root / ".bumpversion.toml").read_text(encoding="utf-8"), re.M)
        except OSError:
            m = None
        ref = "semver:^%s.%s.%s" % m.groups() if m else "semver:*"
    else:
        m = _RELEASE.fullmatch(wanted)
        if not m:
            return 2, ["REFUSE  the tag must be a numeric release, vX.Y.Z"]
        ref = "v%s.%s.%s" % m.groups()
    return 0, ["UPDATE  run this npm line, then mhw install:",
               "RUN     npm install -g github:%s#%s" % (REPO, ref)]


def npm_binary():
    """npm beside the node that runs mhw (bin/mhw.js passes its own path in MHW_NODE), by absolute path,
    never looked up on PATH. None when there is none."""
    # MHW_NPM: tests only, an absolute path to a stand-in npm.
    if os.path.isabs(os.environ.get("MHW_NPM", "")):
        return os.environ["MHW_NPM"]
    node = os.environ.get("MHW_NODE", "")
    if not os.path.isabs(node):
        return None
    npm = Path(node).parent / "npm"
    return str(npm) if npm.is_file() and os.access(str(npm), os.X_OK) else None


def ux_flags(verbose, yes):
    return (["--verbose"] if verbose else []) + (["--yes"] if yes else [])


def cmd_update_npm(wanted, verbose, yes):
    """Issue #113: mhw runs the npm update itself, then `mhw install` from the new package, so the owner
    meets one conversation. Without npm beside node, it says the one npm line to run instead."""
    code, lines = npm_update_lines(wanted)
    if code != 0:
        print("\n".join(lines), file=sys.stderr)
        return code
    npm = npm_binary()
    if npm is None:
        print("\n".join(lines))
        return 0
    spec = lines[-1].split()[-1]
    heading("Updating mhw (%s)" % ("to " + wanted if wanted else "to the newest release of this major version"))
    args = [npm, "install", "-g", "--no-fund", "--no-audit", "--loglevel=error", spec]
    if verbose:
        print("    " + " ".join(args[1:]), flush=True)
    ncode, nlines = run(args)
    show(nlines, True)
    if ncode != 0:
        print()
        print(_styled("31;1", "Update failed:") + " npm exited %d." % ncode)
        next_steps(["Check your network and run `mhw update` again."])
        return ncode
    # The package on disk is the new one now: its own mhw runs the install conversation.
    return run(["/bin/sh", str(ROOT / "mhw"), "install"] + ux_flags(verbose, yes), capture=False)[0]


def cmd_update(wanted, verbose=False, yes=False):
    """Fetch tags, check out the newest release (or the one asked for), then install from it. Refuses on a
    working tree with a tracked change, so nothing uncommitted is carried into or lost by the checkout.
    An npm install has no checkout: it runs the npm update, then the new package's install."""
    if npm_package():
        return cmd_update_npm(wanted, verbose, yes)
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
        print("REFUSE  %s predates ./mhw (then ./workstation) and cannot receive --overlay; nothing checked out" % target,
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
        # A release from before Issue #113 knows neither --yes nor --verbose for install.
        flags = ux_flags(verbose, yes) if "def install_plan(" in new.read_text(encoding="utf-8") else []
        return run([sys.executable, "-B", str(new), "install"] + flags, capture=False)[0]
    hooks_mode = "managed" if admin_installed() else "user"
    return run(install_args(["--hooks=" + hooks_mode]), capture=False)[0]


def cmd_uninstall(verbose=False, yes=False):
    """Issue #113: the same conversation as install. It says what goes, waits for RETURN, asks for the
    administrator password once when the system-wide protections are installed, removes them, then the
    user layer. Without a terminal it only says what it would do, unless --yes."""
    asking = interactive()
    admin = admin_present() and admin_supported()
    heading("mhw will remove from this workstation:")
    print("  - Your settings in Claude Code, Codex and Kiro that mhw wrote (your own entries stay)")
    if admin:
        print("  - The system-wide protections (needs your administrator password, once)")
    if not asking and not yes:
        print()
        print("Nothing was changed: no terminal to confirm in.")
        next_steps(["Run `%s uninstall` in a terminal (or `%s uninstall --yes`)." % (CMD, CMD)])
        return 0
    if asking and not yes:
        print()
        if not confirm():
            print("Aborted; nothing was changed.")
            return 1
    failed, steps = [], []
    if admin:
        if admin_access(asking):
            heading("Removing the system-wide protections")
            acode, alines = run(as_root(["/bin/sh", str(INSTALL_MANAGED), "--remove"]))
            show(alines, verbose)
            if acode != 0:
                failed.append("System-wide protections (exit %d; `%s uninstall --verbose` shows why)" % (acode, CMD))
        else:
            steps.append("Run `%s uninstall` in a terminal to remove the system-wide protections; it asks for "
                         "your administrator password." % CMD)
    heading("Removing your settings")
    code, lines = run(install_args(["--uninstall"]))
    show(lines, verbose)
    if code != 0:
        failed.append("Your settings (exit %d; `%s uninstall --verbose` shows why)" % (code, CMD))
    # The admin layer still on disk (skipped or failed): not a success, and the package that holds the only
    # tool able to remove it (install-managed.sh --remove) must stay (PR #114 lens).
    left = admin and admin_present()
    print()
    if failed:
        print(_styled("31;1", "Uninstall incomplete:"))
        for f in failed:
            print("  - " + f)
    elif left:
        print(_styled("33;1", "Partly removed:") + " your settings are gone; the system-wide protections "
              "are still installed.")
    else:
        print(_styled("32;1", "Uninstall complete."))
    steps.append(FRESH)
    if npm_package() and not left:
        steps.append("Run `npm uninstall -g %s` to remove the mhw command itself." % package_name())
    next_steps(steps)
    return 1 if failed or left else 0


def cmd_check(prerequisites_only=False, project=None):
    code = 0
    if not prerequisites_only:
        hooks_mode = "managed" if admin_installed() else "user"
        code, _ = run(install_args(["--check", "--hooks=" + hooks_mode]), capture=False)
        if admin_present():
            # Every admin layer of ours, stamped or from an earlier release (Issue #52), read-only.
            acode, alines = run(managed_args(["--check"]))
            print("\n".join(alines + admin_report(alines, acode)), flush=True)
            code = max(code, acode)
        if npm_package():
            notes = npm_notes(source_stamp(), {h: s for h, p in brief_paths().items() if (s := stamp_in(p)) != "none"})
            for note in notes:
                print("NPM     " + note, flush=True)
    # Issue #89: present or missing, authenticated or not, drift from the preferred settings. Read-only.
    import prerequisites
    pcode, lines = prerequisites.report()
    print("\n".join(lines), flush=True)
    code = max(code, pcode)
    if project is not None:
        # Issue #195: the project brief against the installed merge-authority contract. Read-only.
        code = max(code, check_project_brief(project))
    return code


def check_project_brief(project):
    """The --project section of check: exit 0, 1 (findings) or 2 (cannot validate, fail closed)."""
    import merge_authority
    root = Path(project).expanduser().resolve()
    if not root.is_dir():
        print("PROJECT %s is not a directory" % project, flush=True)
        return 2
    mcode, lines = merge_authority.check_project(root, Path.home())
    print("\n".join(lines), flush=True)
    return mcode


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
    # The installers' messages name the same command this process was reached by (Issue #68).
    os.environ["MHW_CMD"] = CMD
    if not argv or argv[0] in ("-h", "--help", "help"):
        print(__doc__.split("\n\n")[1] if argv else __doc__)
        return 0 if argv else 2
    command, rest = argv[0], argv[1:]
    if command == "scan":
        # Node since #486 (S15 of #470): ./mhw and bin/mhw.js run src/commands/scan.js and never reach
        # this file, so only a direct `python3 workstation.py scan` arrives here. It names the command
        # instead of passing its arguments on (no caller-supplied argument reaches a subprocess here).
        print("mhw: mhw scan is the Node command now; run ./mhw scan or node bin/mhw.js scan", file=sys.stderr)
        return 2
    if command == "status":
        # Node since #493 (S22 of #470): ./mhw and bin/mhw.js run src/commands/status.js, so only a direct
        # `python3 workstation.py status` arrives here; it names the command, as scan does.
        print("mhw: mhw status is the Node command now; run ./mhw status or node bin/mhw.js status", file=sys.stderr)
        return 2
    if command == "policy":
        # ADR-0015 lock 3 (Issue #245): validate a project's contract; reads one file, installs nothing.
        if not rest or rest[0] != "check":
            print("mhw: policy takes one subcommand, check [--project=DIR | --file=PATH]", file=sys.stderr)
            return 2
        sys.path.insert(0, str(HERE / "project-policy"))
        import project_policy
        return project_policy.main(rest)
    overlay, project, verbose, admin, wanted, method = None, None, False, False, None, False
    prereq_only, yes, no_admin = False, False, False
    for arg in rest:
        if arg.startswith("--overlay="):
            overlay = arg[len("--overlay="):]
        elif arg.startswith("--project=") and command == "check":
            project = arg[len("--project="):]
        elif arg in ("-v", "--verbose") and command in ("install", "update", "uninstall"):
            verbose = True
        elif arg == "--prerequisites" and command == "check":
            prereq_only = True
        elif arg == "--admin" and command == "install":
            admin = True
        elif arg in ("-y", "--yes") and command in ("install", "update", "uninstall"):
            yes = True
        elif arg == "--no-admin" and command == "install":
            no_admin = True
        elif arg == "--method" and command in ("install", "postinstall"):
            method = True
        elif command == "update" and wanted is None and not arg.startswith("-"):
            wanted = arg
        else:
            print("mhw: unknown argument for %s: %s" % (command, arg), file=sys.stderr)
            return 2
    if overlay is not None:
        overlay = valid_overlay(overlay)
        if overlay is None:
            print("mhw: --overlay takes 'none' or an existing directory", file=sys.stderr)
            return 2
        os.environ[OVERLAY_ENV] = overlay
    if command == "install":
        if admin and no_admin:
            print("mhw: --admin and --no-admin exclude each other", file=sys.stderr)
            return 2
        return cmd_install(admin, method, verbose, yes, no_admin)
    if command == "postinstall":
        return cmd_postinstall(method)
    if command == "check":
        return cmd_check(prereq_only, project)
    if command == "update":
        return cmd_update(wanted, verbose, yes)
    if command == "uninstall":
        return cmd_uninstall(verbose, yes)
    print("mhw: unknown subcommand %s (install, install --admin, status, check, scan, policy check, update, uninstall)"
          % command, file=sys.stderr)
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
