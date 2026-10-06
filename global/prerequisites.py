#!/usr/bin/env python3
"""The prerequisites section of ./workstation check (Issue #89): check-only, never applies anything.

Reads the versioned declaration global/prerequisites.json and reports, per item: present or missing,
authenticated or not, and drift from the preferred settings, with the manual step for each gap. A
required item that is missing makes the section fail (exit 1). Authentication and drift are reported
and do not fail it: they are the owner's acts, and this command never prompts for a credential.

Every probe is read-only and comes from a closed set implemented here; the declaration can only pick
among them. Each command may be probed only as COMMANDS below allows: its own version query, or for
xcode-select its path query. No probe runs an agent harness in any mode but `--version`, so none can
reach a model. Every child runs with PROBE_ENV, which turns off the auto-install and update checks
the tools we probe are known to perform (a tfenv shim installs a missing Terraform otherwise,
measured). Account probes: `gh auth status` (a network call; its output names the account and is only
classified, never printed); global/github-repo-settings.sh --check; and HTTPS GETs that send a token
only when it is already in the environment (SONAR_TOKEN, TFC_API_TOKEN), plus a SonarCloud project
lookup when the overlay names a project key. A credential is never read from anywhere but the
environment, never printed and never written.

Owner-specific values live in the untracked overlay file prerequisites.local.json (gitignored by
*.local.json): {"lanes": [...], "github_repos": ["OWNER/REPO"], "sonar_projects": ["KEY"]}. "lanes"
names the workflow lanes whose required items also fail the section (default: none beyond the items
required overall). With no github_repos, the GitHub merge-settings check reads this checkout's origin.

Environment, tests and probes only: WORKSTATION_PREREQUISITES replaces the declaration path;
WORKSTATION_SONAR_URL, WORKSTATION_TFC_URL and WORKSTATION_GITHUB_URL replace the service base URLs
and are honoured only for a plain-HTTP 127.0.0.1 address with a port, so a token can never be
redirected to another host.
Standard library only, Python 3.9+.
"""
import json
import os
from pathlib import Path
import platform
import re
import shutil
import subprocess
import urllib.error
import urllib.parse
import urllib.request

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
DECLARATION = HERE / "prerequisites.json"
REPO_SETTINGS = HERE / "github-repo-settings.sh"
OVERLAY_FILE = "prerequisites.local.json"
SONAR_URL = "https://sonarcloud.io"
TFC_URL = "https://app.terraform.io"
GITHUB_URL = "https://api.github.com"
LOOPBACK_HOST = "127.0.0.1"
# The closed probe set: every command a declaration may name, with the only arguments it may be run with.
# "version" is its version query; "path" a read-only path query. argv is built from these constants,
# never from the declaration. Agent harnesses get --version only: nothing here can reach a model.
COMMANDS = {
    "claude": {"version": ("--version",)}, "codex": {"version": ("--version",)},
    "kiro-cli": {"version": ("--version",)}, "gh": {"version": ("--version",)},
    "git": {"version": ("--version",)}, "jq": {"version": ("--version",)},
    "python3": {"version": ("--version",)}, "xcode-select": {"path": ("-p",)},
    "security": {}, "node": {"version": ("--version",)}, "terraform": {"version": ("version",)},
    "actionlint": {"version": ("--version",)}, "checkov": {"version": ("--version",)},
    "shellcheck": {"version": ("--version",)}, "bump-my-version": {"version": ("--version",)},
    "pwsh": {"version": ("--version",)}, "uv": {"version": ("--version",)},
    "brew": {"version": ("--version",)}, "docker": {"version": ("--version",)},
    "podman": {"version": ("--version",)},
}
# Every probe child runs with these set: no auto-install, no update or telemetry call. tfenv's shim
# installs a missing Terraform when TFENV_AUTO_INSTALL is unset (measured, tfenv 3.0.0).
PROBE_ENV = {"TFENV_AUTO_INSTALL": "false", "CHECKPOINT_DISABLE": "1", "GH_NO_UPDATE_NOTIFIER": "1",
             "HOMEBREW_NO_AUTO_UPDATE": "1"}
PRESENCE_KINDS = ("manual", "account")
AUTH_KINDS = ("none", "gh-auth-status", "sonarcloud-token", "tfc-token")
PREFERRED_KINDS = ("github-repo-settings", "sonarcloud-project")
REQUIREMENT = ("required", "optional")
_REPO = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")
_SONAR_KEY = re.compile(r"[A-Za-z0-9_.:-]+")
_VERSION = re.compile(r"v?(\d+)(?:\.(\d+))?(?:\.(\d+))?")
TIMEOUT = 15


class DeclarationError(ValueError):
    pass


# ---------------------------------------------------------------------------------------------------
# Declaration and overlay.

def declaration_path():
    return Path(os.environ.get("WORKSTATION_PREREQUISITES") or DECLARATION)


def validate(doc):
    """Raise DeclarationError unless every item uses only the closed probe set."""
    if not isinstance(doc, dict) or not isinstance(doc.get("items"), list):
        raise DeclarationError("no items list")
    lanes = doc.get("lanes") if isinstance(doc.get("lanes"), dict) else {}
    seen = set()
    for item in doc["items"]:
        where = item.get("id") if isinstance(item, dict) else repr(item)
        if not isinstance(item, dict) or not isinstance(item.get("id"), str) or item["id"] in seen:
            raise DeclarationError("item without a unique id: %s" % where)
        seen.add(item["id"])
        for key in ("name", "category", "manual"):
            if not isinstance(item.get(key), str) or not item[key]:
                raise DeclarationError("%s: %s missing" % (where, key))
        if item.get("required") not in REQUIREMENT:
            raise DeclarationError("%s: required must be required or optional" % where)
        for lane, req in (item.get("lanes") or {}).items():
            if lane not in lanes or req not in REQUIREMENT:
                raise DeclarationError("%s: unknown lane or requirement %s=%s" % (where, lane, req))
        presence = item.get("presence")
        if not isinstance(presence, dict):
            raise DeclarationError("%s: presence missing" % where)
        if "commands" in presence:
            cmds = presence["commands"]
            if not (isinstance(cmds, list) and cmds and all(c in COMMANDS for c in cmds)):
                raise DeclarationError("%s: presence.commands outside the closed probe set" % where)
            if "args" in presence and not all(list(COMMANDS[c].get("path", ())) == presence["args"]
                                              for c in cmds):
                raise DeclarationError("%s: presence.args is not the path query of every command" % where)
        elif presence.get("kind") not in PRESENCE_KINDS:
            raise DeclarationError("%s: presence kind unknown" % where)
        version = item.get("version")
        if version is not None:
            if "commands" not in presence or not all(
                    "version" in COMMANDS[c] and list(COMMANDS[c]["version"]) == version.get("args")
                    for c in presence["commands"]):
                raise DeclarationError("%s: version.args is not the version query of every command" % where)
            for bound in ("minimum", "preferred"):
                if bound in version and parse_version(version[bound]) is None:
                    raise DeclarationError("%s: version.%s is not a version" % (where, bound))
        auth = item.get("auth")
        if auth is not None and auth.get("kind") not in AUTH_KINDS:
            raise DeclarationError("%s: auth kind unknown" % where)
        if auth is not None and auth.get("kind") in ("sonarcloud-token", "tfc-token") and \
                not re.fullmatch(r"[A-Z][A-Z0-9_]*", str(auth.get("env", ""))):
            raise DeclarationError("%s: auth.env must name an environment variable" % where)
        preferred = item.get("preferred")
        if preferred is not None and preferred.get("kind") not in PREFERRED_KINDS:
            raise DeclarationError("%s: preferred kind unknown" % where)
        os_list = item.get("os")
        if os_list is not None and not (isinstance(os_list, list) and all(isinstance(o, str) for o in os_list)):
            raise DeclarationError("%s: os must be a list of platform.system() names" % where)
    return doc


def load_declaration(path=None):
    path = path or declaration_path()
    try:
        doc = json.loads(Path(path).read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise DeclarationError("%s not read (%s)" % (path, e.__class__.__name__))
    return validate(doc)


def overlay_dir():
    value = os.environ.get("WORKSTATION_OVERLAY")
    if value == "none":
        return None
    return Path(value) if value else ROOT / "overlay"


def load_overlay(lanes):
    """-> (overlay dict, note). Invalid values are dropped and named in the note; nothing fails on them."""
    empty = {"lanes": [], "github_repos": [], "sonar_projects": []}
    base = overlay_dir()
    if base is None:
        return empty, ""
    path = base / OVERLAY_FILE
    if not path.is_file():
        return empty, ""
    try:
        doc = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return empty, "%s not read; ignored" % OVERLAY_FILE
    if not isinstance(doc, dict):
        return empty, "%s is not an object; ignored" % OVERLAY_FILE
    out, dropped = dict(empty), []
    for key, check in (("lanes", lambda v: v in lanes), ("github_repos", _REPO.fullmatch),
                       ("sonar_projects", _SONAR_KEY.fullmatch)):
        values = doc.get(key, [])
        values = values if isinstance(values, list) else [values]
        out[key] = [v for v in values if isinstance(v, str) and check(v)]
        dropped += [key] if len(out[key]) != len(values) else []
    return out, ("%s: invalid %s ignored" % (OVERLAY_FILE, ", ".join(dropped)) if dropped else "")


# ---------------------------------------------------------------------------------------------------
# Probes: the only places a process or network call happens.

def probe(argv):
    """-> (exit code, combined output, stripped). 127 when the command cannot be run, 124 on timeout."""
    env = dict(os.environ, **PROBE_ENV)
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=TIMEOUT, stdin=subprocess.DEVNULL,
                           env=env)
    except FileNotFoundError:
        return 127, ""
    except (OSError, subprocess.TimeoutExpired):
        return 124, ""
    return p.returncode, ((p.stdout or "") + (p.stderr or "")).strip()


def probe_lines(argv):
    try:
        p = subprocess.run(argv, capture_output=True, text=True, timeout=TIMEOUT * 2, stdin=subprocess.DEVNULL,
                           env=dict(os.environ, **PROBE_ENV))
    except (OSError, subprocess.TimeoutExpired):
        return 124, []
    return p.returncode, ((p.stdout or "") + (p.stderr or "")).splitlines()


def base_url(env_name, default):
    value = os.environ.get(env_name, "")
    if not value:
        return default
    try:
        parts = urllib.parse.urlsplit(value)
        port = parts.port
    except ValueError:
        return default
    if parts.scheme != "http" or parts.hostname != LOOPBACK_HOST or not port or \
            parts.netloc != "%s:%d" % (LOOPBACK_HOST, port) or parts.path not in ("", "/") or \
            parts.query or parts.fragment:
        return default
    return "%s://%s:%d" % (parts.scheme, LOOPBACK_HOST, port)


def http_get(url, token=None):
    """-> (status, body) for one GET; status 0 when the host could not be reached. Never follows a
    redirect with the token: urllib drops Authorization on a cross-host redirect only in newer Pythons,
    so redirects are refused outright."""
    class NoRedirect(urllib.request.HTTPRedirectHandler):
        def redirect_request(self, *a, **k):
            return None
    req = urllib.request.Request(url, headers={"Accept": "application/json"})
    if token:
        req.add_header("Authorization", "Bearer " + token)
    opener = urllib.request.build_opener(NoRedirect)
    try:
        with opener.open(req, timeout=TIMEOUT) as resp:
            return resp.status, resp.read(65536).decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return e.code, ""
    except (urllib.error.URLError, OSError, ValueError):
        return 0, ""


def parse_version(text):
    m = _VERSION.search(str(text or ""))
    return tuple(int(g) if g else 0 for g in m.groups()) if m else None


def origin_repo():
    code, line = probe(["git", "-C", str(ROOT), "remote", "get-url", "origin"])
    m = re.search(r"github\.com[:/]([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+?)(?:\.git)?/?$", line) if code == 0 else None
    return m.group(1) if m else None


# ---------------------------------------------------------------------------------------------------
# Per item.

NOT_AVAILABLE = "not checked (credential not available)"
NO_PROBE = "authentication not checked (no read-only probe declared)"


def check_presence(item):
    """-> (state, text, command path or None, version tuple or None). state: present, missing,
    manual, account."""
    presence = item["presence"]
    if presence.get("kind") == "manual":
        return "manual", "not detectable here (manual)", None, None
    if presence.get("kind") == "account":
        return "account", "account, no local client to detect", None, None
    for declared in presence["commands"]:
        # The constant key and its constant arguments, never the declaration's own strings.
        name = next(c for c in COMMANDS if c == declared)
        allowed = COMMANDS[name]
        path = shutil.which(name)
        if not path:
            continue
        if "args" in presence and probe([path] + list(allowed["path"]))[0] != 0:
            continue
        if item.get("version") and "version" in allowed:
            code, line = probe([path] + list(allowed["version"]))
            found = parse_version(line) if code == 0 else None
            shown = ".".join(str(p) for p in found) if found else "version unknown"
            return "present", "present (%s %s)" % (name, shown), path, found
        return "present", "present (%s)" % name, path, None
    return "missing", "missing (%s not found)" % " or ".join(presence["commands"]), None, None


def version_drift(item, found):
    version = item.get("version") or {}
    for bound in ("minimum", "preferred"):
        if bound in version and found is not None and found < parse_version(version[bound]):
            return "drift: version %s below %s %s" % (".".join(map(str, found)), bound, version[bound])
    return None


def check_auth(item, present_path):
    """-> (state, text). state: ok, no, unchecked, or None when the item declares no auth."""
    auth = item.get("auth")
    if auth is None:
        return None, ""
    kind = auth["kind"]
    if kind == "none":
        return "unchecked", NO_PROBE
    if kind == "gh-auth-status":
        if not present_path:
            return "unchecked", "authentication not checked (gh missing)"
        code, out = probe([present_path, "auth", "status"])  # output names the account: classified only
        if code == 0:
            return "ok", "authenticated"
        if "not logged in" in out.lower():
            return "no", "not authenticated"
        # gh auth status contacts GitHub: offline, it fails like a rejected token. Ask GitHub, no token.
        status, _ = http_get(base_url("WORKSTATION_GITHUB_URL", GITHUB_URL) + "/zen")
        if status == 0:
            return "unreachable", "authentication not checked (GitHub unreachable)"
        return "no", "not authenticated (gh auth status failed with GitHub reachable)"
    token = os.environ.get(auth["env"], "")
    if not token:
        return "unchecked", "authentication %s; $%s unset" % (NOT_AVAILABLE, auth["env"])
    if kind == "sonarcloud-token":
        status, body = http_get(base_url("WORKSTATION_SONAR_URL", SONAR_URL) + "/api/authentication/validate", token)
        try:
            valid = status == 200 and json.loads(body).get("valid") is True
        except (ValueError, AttributeError):
            valid = False
    else:
        status, _ = http_get(base_url("WORKSTATION_TFC_URL", TFC_URL) + "/api/v2/account/details", token)
        valid = status == 200
    if status == 0:
        return "unreachable", "authentication not checked (service unreachable)"
    return ("ok", "authenticated ($%s)" % auth["env"]) if valid else ("no", "not authenticated ($%s rejected)" % auth["env"])


def check_preferred(item, auth_state, overlay):
    """-> list of (state, text). state: ok, drift, unchecked."""
    preferred = item.get("preferred")
    if preferred is None:
        return []
    if preferred["kind"] == "github-repo-settings":
        if auth_state != "ok":
            return [("unchecked", "merge settings " + NOT_AVAILABLE)]
        repos = overlay["github_repos"] or [r for r in [origin_repo()] if r]
        if not repos:
            return [("unchecked", "merge settings not checked (no GitHub origin and none in the overlay)")]
        out = []
        for repo in repos:
            code, lines = probe_lines(["sh", str(REPO_SETTINGS), "--check", repo])
            diffs = [re.sub(r"^DIFF\s+\S+\s+", "", ln) for ln in lines if ln.startswith("DIFF")]
            if code == 0:
                out.append(("ok", "merge settings match the standard (%s)" % repo))
            elif diffs:
                out.append(("drift", "drift %s: %s" % (repo, "; ".join(diffs))))
            elif any(ln.startswith("UNREADABLE") for ln in lines):
                out.append(("unchecked", "merge settings not checked (%s not readable with this login)" % repo))
            else:
                out.append(("unchecked", "merge settings not checked (exit %d)" % code))
        return out
    keys = overlay["sonar_projects"]
    if not keys:
        return [("unchecked", "project not checked (no project key in the overlay)")]
    token = os.environ.get((item.get("auth") or {}).get("env") or "", "") or None
    out = []
    for key in keys:
        url = base_url("WORKSTATION_SONAR_URL", SONAR_URL) + "/api/components/show?component=" + \
            urllib.parse.quote(key, safe="")
        status, _ = http_get(url, token)
        if status == 200:
            out.append(("ok", "project %s reachable" % key))
        elif status == 0:
            out.append(("unchecked", "project %s not checked (service unreachable)" % key))
        else:
            out.append(("drift", "project %s not reachable (HTTP %d)" % (key, status)))
    return out


def requirement(item, active):
    """-> (fatal, label). Fatal when required overall or required in an active lane."""
    lanes = item.get("lanes") or {}
    required_in = [lane for lane, req in lanes.items() if req == "required"]
    fatal = item["required"] == "required" or any(lane in active for lane in required_in)
    if item["required"] == "required":
        return fatal, "required"
    label = "optional; required for " + ", ".join(required_in) if required_in else "optional"
    return fatal, label


def evaluate(item, overlay, system=None):
    """-> dict(tag, fatal, line) for one item. Pure apart from the probes above."""
    system = system or platform.system()
    fatal, label = requirement(item, overlay["lanes"])
    head = "%s [%s]" % (item["id"], label)
    if item.get("os") and system not in item["os"]:
        return {"tag": "SKIP", "fatal": False, "line": "%s: not applicable on %s" % (head, system)}
    state, presence_text, path, found = check_presence(item)
    parts = [presence_text]
    auth_state, auth_text, drift, prefs = None, "", None, []
    if state != "missing":
        auth_state, auth_text = check_auth(item, path)
        drift = version_drift(item, found) if state == "present" else None
        prefs = check_preferred(item, auth_state, overlay)
    parts += [auth_text] if auth_text else []
    parts += [drift] if drift else []
    parts += [t for _, t in prefs]
    drifted = bool(drift) or any(s == "drift" for s, _ in prefs)
    if state == "missing":
        tag = "MISSING" if fatal else "ABSENT"
    elif auth_state == "no":
        tag = "NOAUTH"
    elif drifted:
        tag = "DRIFT"
    elif state == "manual":
        tag = "MANUAL"
    elif auth_state == "unreachable" or (state == "account" and auth_state != "ok"):
        tag = "NOCHECK"
    else:
        tag = "OK"
    line = "%s: %s" % (head, " · ".join(parts))
    if tag != "OK":
        line += " -> " + item["manual"]
    return {"tag": tag, "fatal": fatal and state == "missing", "line": line}


def report(path=None, system=None):
    """-> (exit code, lines). 0: no required item missing; 1: at least one; 2: declaration invalid."""
    try:
        doc = load_declaration(path)
    except DeclarationError as e:
        return 2, ["PREREQ  declaration invalid, nothing checked: %s" % e]
    overlay, note = load_overlay(doc.get("lanes") or {})
    active = ", ".join(overlay["lanes"]) if overlay["lanes"] else "none beyond the overall requirement"
    lines = ["PREREQ  prerequisites (global/prerequisites.json); lanes that also fail on a missing item: %s"
             % active]
    if note:
        lines.append("PREREQ  " + note)
    results = [evaluate(item, overlay, system) for item in doc["items"]]
    for r in results:
        lines.append("%-7s %s" % (r["tag"], r["line"]))
    missing = sum(1 for r in results if r["fatal"])
    lines.append("PREREQ  %d required item(s) missing; check-only, nothing was applied" % missing)
    return (1 if missing else 0), lines


if __name__ == "__main__":
    import sys
    code, out = report()
    print("\n".join(out))
    sys.exit(code)
