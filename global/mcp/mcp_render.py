#!/usr/bin/env python3
"""Render one MCP server definition into every agent surface's own config (ADR-0017).

    mcp_render.py                 render into every installed surface (backup kept beside each file)
    mcp_render.py --dry-run       print what would change where; write nothing
    mcp_render.py --check         exit 1 if a surface is missing a server, holds a stale one, or drifted
    mcp_render.py --scan          read-only, owner-run: list the MCP config KEYS that look like
                                  credentials, in every surface and backup file. Never prints a value
    mcp_render.py --adopt         take over a same-named server that was configured by hand
                                  (JSON surfaces only; a backup is kept)
    --source=FILE                 the definition (default: <data dir>/local-overlay/mcp-servers.json)
    --surfaces=a,b                restrict to these surfaces: codex, claude-code, claude-desktop, kiro

The definition lives only in the untracked local overlay, outside every repository: server names,
commands, args and non-secret environment values. A credential is never in it. A server that needs one
names it under "secrets" with its source (macOS Keychain service, or an environment variable), and is
rendered as global/mcp/mcp-launch.sh, which reads the value when the server starts. So the renderer
never reads a secret, and no rendered file can hold one it was given.

Exit codes, as global/install.sh: 0 ok · 1 drift or missing (--check) · 2 usage, invalid definition or a
missing dependency · 3 something unmanaged, conflicting or unreadable is in the way (left untouched).
Requires Python 3.11+ for the Codex surface (tomllib, to verify the rendered TOML before writing).
"""
import copy
import json
import os
import re
import shutil
import subprocess
import sys

try:
    import tomllib
except ImportError:  # Python < 3.11: the Codex surface refuses, the JSON surfaces still work
    tomllib = None

PROJECT = "personal-multi-harness-workstation-configuration"
MARKER_ID = "managed-by: " + PROJECT
BLOCK_BEGIN = "# >>> %s (mcp servers); generated, do not edit inside this block: re-run global/mcp/mcp_render.py" % MARKER_ID
BLOCK_BEGIN_PREFIX = "# >>> %s (mcp servers)" % MARKER_ID
BLOCK_END = "# <<< %s (mcp servers)" % MARKER_ID
SURFACES = ("codex", "claude-code", "claude-desktop", "kiro")
HERE = os.path.dirname(os.path.abspath(__file__))
LAUNCHER_SRC = os.path.join(HERE, "mcp-launch.sh")

SOURCE_KEYS = {"$schema", "version", "servers"}
SERVER_KEYS = {"description", "command", "args", "env", "secrets", "surfaces", "not_secret"}
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")
ENV_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_]*$")
SERVICE_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._@:+-]{0,127}$")
# A key NAME that suggests a credential. Used to refuse a plain env value in the definition, and by
# --scan to list keys in the surfaces. A false positive is visible and has an escape (not_secret).
CRED_RE = re.compile(r"(TOKEN|SECRET|PASSW(OR)?D|PASSPHRASE|PWD|API[_-]?KEY|ACCESS[_-]?KEY|PRIVATE[_-]?KEY|"
                     r"CLIENT[_-]?KEY|CREDENTIAL|AUTH|BEARER|COOKIE|SESSION|DSN|SIGNATURE|"
                     r"(^|[_.-])(PAT|KEY|KEYS|APIKEY|CERT)([_.-]|$))", re.I)
ARG_FLAG_RE = re.compile(r"^(--?[A-Za-z0-9_.-]+)(=.*)?$", re.S)
URL_CRED_RE = re.compile(r"(://[^/@\s]+:[^/@\s]+@)|([?&][A-Za-z0-9_.-]*(token|key|secret|passw|auth)[A-Za-z0-9_.-]*=)", re.I)
# A credential-looking VALUE, whatever its key is called: userinfo or a credential query parameter in a
# URL, an Authorization-style header, a bearer/basic scheme, a private key block, or a well-known token
# prefix. A hit is refused and reported by location only; the value is never echoed.
VALUE_CRED_RES = (
    URL_CRED_RE,
    re.compile(r"(authorization|proxy-authorization|x-api-key|api[-_]?key|[a-z-]*token|secret|password|cookie)"
               r"\s*:\s*\S", re.I),
    re.compile(r"\b(bearer|basic|token)\s+[A-Za-z0-9._~+/=-]{8,}", re.I),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----"),
    re.compile(r"\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|glpat-[A-Za-z0-9_-]{16,}|"
               r"sk-[A-Za-z0-9_-]{16,}|(sk|rk|pk)_(live|test)_[A-Za-z0-9]{10,}|xox[abposr]-[A-Za-z0-9-]{10,}|"
               r"AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|npm_[A-Za-z0-9]{30,})"),
)


def looks_like_credential_value(s):
    return any(rx.search(s) for rx in VALUE_CRED_RES)


AGENT_ENV = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "CODEX_SANDBOX", "CODEX_SANDBOX_NETWORK_DISABLED")


class Refuse(Exception):
    def __init__(self, code, msg):
        super().__init__(msg)
        self.code = code


# ------------------------------------------------------------------------------------------- paths


def home():
    return os.path.expanduser("~")


def data_dir():
    base = os.environ.get("XDG_DATA_HOME") or os.path.join(home(), ".local", "share")
    return os.path.join(base, PROJECT)


def default_source():
    return os.path.join(data_dir(), "local-overlay", "mcp-servers.json")


def surface_target(surface):
    """(config file, directory whose existence means the surface is installed), or None."""
    h = home()
    if surface == "codex":
        d = os.environ.get("CODEX_HOME") or os.path.join(h, ".codex")
        return os.path.join(d, "config.toml"), d
    if surface == "claude-code":
        return os.path.join(h, ".claude.json"), os.path.join(h, ".claude")
    if surface == "claude-desktop":
        if sys.platform == "darwin":
            d = os.path.join(h, "Library", "Application Support", "Claude")
        elif sys.platform == "win32" and os.environ.get("APPDATA"):
            d = os.path.join(os.environ["APPDATA"], "Claude")
        else:
            return None  # no desktop app is published for this OS
        return os.path.join(d, "claude_desktop_config.json"), d
    if surface == "kiro":
        return os.path.join(h, ".kiro", "settings", "mcp.json"), os.path.join(h, ".kiro")
    raise ValueError(surface)


def launcher_dest():
    return os.path.join(data_dir(), "mcp-launch.sh")


def manifest_path():
    return os.path.join(data_dir(), "mcp-managed.json")


def version():
    path = os.path.join(os.path.dirname(os.path.dirname(HERE)), ".bumpversion.toml")
    with open(path, encoding="utf-8") as fh:
        m = re.search(r'^current_version\s*=\s*"([0-9][0-9.]*)"', fh.read(), re.M)
    if not m:
        raise Refuse(2, "cannot read current_version from .bumpversion.toml")
    return m.group(1)


# -------------------------------------------------------------------------------------- definition


def _no_control(s):
    return not any(ord(c) < 0x20 or ord(c) == 0x7F for c in s)


def validate(doc, platform=sys.platform):
    """Return a list of human-readable errors; empty means the definition is valid."""
    errs = []
    if not isinstance(doc, dict):
        return ["the definition must be a JSON object"]
    for k in doc:
        if k not in SOURCE_KEYS:
            errs.append("unknown top-level key %r" % k)
    if doc.get("version") != 1:
        errs.append('"version" must be 1')
    servers = doc.get("servers")
    if not isinstance(servers, dict):
        return errs + ['"servers" must be an object of name -> server']
    for name, s in servers.items():
        where = "server %r" % name
        if not NAME_RE.match(name):
            errs.append("%s: the name must match %s" % (where, NAME_RE.pattern))
        if not isinstance(s, dict):
            errs.append("%s: must be an object" % where)
            continue
        for k in s:
            if k not in SERVER_KEYS:
                errs.append("%s: unknown key %r" % (where, k))
        cmd = s.get("command")
        if not isinstance(cmd, str) or not cmd.strip():
            errs.append('%s: "command" must be a non-empty string' % where)
        args = s.get("args", [])
        if not isinstance(args, list) or not all(isinstance(a, str) for a in args):
            errs.append('%s: "args" must be a list of strings' % where)
            args = []
        env = s.get("env", {})
        if not isinstance(env, dict) or not all(isinstance(v, str) for v in env.values()):
            errs.append('%s: "env" must map names to strings' % where)
            env = {}
        secrets = s.get("secrets", {})
        if not isinstance(secrets, dict) or not all(isinstance(v, str) for v in secrets.values()):
            errs.append('%s: "secrets" must map names to "keychain:<service>" or "env:<VAR>"' % where)
            secrets = {}
        surfaces = s.get("surfaces", list(SURFACES))
        if not isinstance(surfaces, list) or not surfaces or any(x not in SURFACES for x in surfaces):
            errs.append('%s: "surfaces" must be a non-empty list of %s' % (where, ", ".join(SURFACES)))
        reviewed = s.get("not_secret", [])
        if not isinstance(reviewed, list) or not all(isinstance(x, str) for x in reviewed):
            errs.append('%s: "not_secret" must be a list of strings' % where)
            reviewed = []
        strings = [x for x in [cmd] + args + list(env) + list(env.values()) + list(secrets) + list(secrets.values())
                   if isinstance(x, str)]
        if not all(_no_control(x) for x in strings):
            errs.append("%s: a control character is in a string" % where)
        for k in env:
            if not ENV_RE.match(k):
                errs.append("%s: env name %r is not a valid variable name" % (where, k))
            elif CRED_RE.search(k) and k not in reviewed:
                errs.append("%s: env %r looks like a credential, so its value may not be written in plain text. "
                            "Move it to \"secrets\", or list it in \"not_secret\" if it is not one" % (where, k))
        if isinstance(cmd, str) and looks_like_credential_value(cmd):
            errs.append("%s: \"command\" carries a credential-looking value (not shown)" % where)
        for k, v in env.items():
            if looks_like_credential_value(v):
                errs.append("%s: the value of env %r looks like a credential (not shown). Put the whole value in "
                            "the Keychain and reference it under \"secrets\"" % (where, k))
        for i, a in enumerate(args):
            if looks_like_credential_value(a):
                errs.append("%s: args[%d] looks like a credential (not shown). Pass it through \"secrets\" (an "
                            "environment variable) instead of the command line" % (where, i))
        for i, a in enumerate(args):
            m = ARG_FLAG_RE.match(a)
            if m and CRED_RE.search(m.group(1)) and m.group(1) not in reviewed:
                errs.append("%s: args[%d] flag %r looks like it carries a credential on the command line. "
                            "Pass it through \"secrets\" (an environment variable), or list the flag in "
                            "\"not_secret\" if it is not one" % (where, i, m.group(1)))
        for k, src in secrets.items():
            if not ENV_RE.match(k):
                errs.append("%s: secret name %r is not a valid variable name" % (where, k))
            if k in env:
                errs.append("%s: %r is both in env and in secrets" % (where, k))
            if src.startswith("keychain:"):
                if not SERVICE_RE.match(src[len("keychain:"):]):
                    errs.append("%s: secret %r: the Keychain service must match %s" % (where, k, SERVICE_RE.pattern))
                elif platform != "darwin":
                    errs.append("%s: secret %r: keychain: is macOS only; use env:<VAR> on this OS" % (where, k))
            elif src.startswith("env:"):
                if not ENV_RE.match(src[len("env:"):]):
                    errs.append("%s: secret %r: %r is not a valid variable name" % (where, k, src))
            else:
                errs.append('%s: secret %r: the source must be "keychain:<service>" or "env:<VAR>"' % (where, k))
        if secrets and platform == "win32":
            errs.append("%s: secrets need the POSIX launcher, which is not available on Windows" % where)
    return errs


def load_source(path):
    try:
        with open(path, encoding="utf-8") as fh:
            doc = json.load(fh)
    except FileNotFoundError:
        raise Refuse(2, "no MCP definition at %s. Copy global/mcp/mcp-servers.example.json there and edit it "
                        "(the directory is outside every repository)" % path)
    except (OSError, ValueError) as e:
        raise Refuse(2, "cannot read the MCP definition %s: %s" % (path, e))
    errs = validate(doc)
    if errs:
        raise Refuse(2, "invalid MCP definition %s:\n  - %s" % (path, "\n  - ".join(errs)))
    return doc


def committable(path):
    """True when the file sits in a git work tree and is not ignored there: it could be committed."""
    if not shutil.which("git"):
        return False
    d = os.path.dirname(os.path.abspath(path))
    r = subprocess.run(["git", "-C", d, "rev-parse", "--is-inside-work-tree"], capture_output=True, text=True)
    if r.returncode != 0 or r.stdout.strip() != "true":
        return False
    return subprocess.run(["git", "-C", d, "check-ignore", "-q", os.path.abspath(path)],
                          capture_output=True).returncode != 0


# --------------------------------------------------------------------------------------- rendering


def effective(server, launcher):
    """The command, args, env and forwarded variables one surface runs for this server."""
    secrets = server.get("secrets", {})
    command, args = server["command"], list(server.get("args", []))
    if secrets:
        wrapped = []
        for name in sorted(secrets):
            wrapped += ["--secret", "%s=%s" % (name, secrets[name])]
        command, args = launcher, wrapped + ["--", server["command"]] + args
    env_vars = sorted({src[len("env:"):] for src in secrets.values() if src.startswith("env:")})
    return command, args, dict(server.get("env", {})), env_vars


def entry(surface, server, launcher):
    command, args, env, env_vars = effective(server, launcher)
    if surface == "codex":
        e = {"command": command, "args": args}
        if env:
            e["env"] = env
        if env_vars:
            e["env_vars"] = env_vars
        return e
    e = {"type": "stdio"} if surface == "claude-code" else {}
    e.update({"command": command, "args": args})
    if env:
        e["env"] = env
    return e


def desired(doc, surface, launcher):
    return {n: entry(surface, s, launcher) for n, s in doc["servers"].items()
            if surface in s.get("surfaces", SURFACES)}


def toml_str(s):
    # JSON's string escapes (\" \\ \n \t \uXXXX) are all valid in a TOML basic string, and control
    # characters were refused at validation. The parsed result is compared before anything is written.
    return json.dumps(s, ensure_ascii=True)


def toml_block(servers):
    lines = [BLOCK_BEGIN]
    for name, e in servers.items():
        lines.append("[mcp_servers.%s]" % name)
        lines.append("command = %s" % toml_str(e["command"]))
        lines.append("args = [%s]" % ", ".join(toml_str(a) for a in e["args"]))
        if e.get("env"):
            lines.append("env = { %s }" % ", ".join("%s = %s" % (k, toml_str(v)) for k, v in e["env"].items()))
        if e.get("env_vars"):
            lines.append("env_vars = [%s]" % ", ".join(toml_str(v) for v in e["env_vars"]))
        lines.append("")
    if lines[-1] == "":
        lines.pop()
    lines.append(BLOCK_END)
    return "\n".join(lines) + "\n"


def _without(parsed, names):
    p = copy.deepcopy(parsed)
    servers = p.get("mcp_servers")
    if isinstance(servers, dict):
        for n in names:
            servers.pop(n, None)
        if not servers:
            del p["mcp_servers"]
    return p


def codex_plan(old_text, want):
    """Return the new config.toml text. Every edit is proved with tomllib before it is accepted."""
    if tomllib is None:
        raise Refuse(2, "the Codex surface needs Python 3.11+ (tomllib), to verify the TOML before writing")
    lines = old_text.splitlines(keepends=True)
    begins = [i for i, l in enumerate(lines) if l.startswith(BLOCK_BEGIN_PREFIX)]
    ends = [i for i, l in enumerate(lines) if l.rstrip("\r\n") == BLOCK_END]
    if (len(begins), len(ends)) == (0, 0):
        if not want:
            return old_text, {}
        block_text, outside = "", old_text
    elif len(begins) == 1 and len(ends) == 1 and begins[0] < ends[0]:
        block_text = "".join(lines[begins[0]:ends[0] + 1])
        outside = "".join(lines[:begins[0]] + lines[ends[0] + 1:])
    else:
        raise Refuse(3, "the managed block's markers are damaged (missing, repeated or out of order); "
                        "fix or remove them by hand, then re-run")
    try:
        old = tomllib.loads(old_text)
        out = tomllib.loads(outside)
        ours_before = tomllib.loads(block_text).get("mcp_servers", {})
    except tomllib.TOMLDecodeError as e:
        raise Refuse(3, "not valid TOML (%s); left untouched" % e)
    if _without(old, ours_before) != out:
        raise Refuse(3, "content after the managed block is parsed into its last table, so moving the block "
                        "would change what that content means; move it above the block by hand")
    hand = [n for n in want if n in out.get("mcp_servers", {})]
    if hand:
        raise Refuse(3, "server(s) %s are also configured outside the managed block, by hand. Codex refuses "
                        "to load a config with a duplicate table, so nothing was written: remove those tables "
                        "(after moving any credential to the Keychain), then re-run" % ", ".join(hand))
    base = outside.rstrip("\n")
    if want:
        new_text = (base + "\n\n" if base else "") + toml_block(want)
    else:
        new_text = base + "\n" if base else ""
    try:
        new = tomllib.loads(new_text)
    except tomllib.TOMLDecodeError as e:
        raise Refuse(3, "the rendered TOML does not parse (%s); nothing written" % e)
    got = new.get("mcp_servers", {})
    if _without(new, list(want)) != out or any(got.get(n) != e for n, e in want.items()):
        raise Refuse(3, "the rendered TOML does not parse back to the intended content; nothing written")
    return new_text, ours_before


def json_plan(data, want, managed_before, adopt):
    current = data.get("mcpServers", {})
    if not isinstance(current, dict):
        raise Refuse(3, "its mcpServers is not an object; left untouched")
    hand = [n for n in want if n in current and n not in managed_before and current[n] != want[n]]
    if hand and not adopt:
        raise Refuse(3, "server(s) %s already exist and are not managed by this project. Re-run with --adopt "
                        "to replace them (a backup is kept), or rename them in the definition" % ", ".join(hand))
    servers = dict(current)
    for n in managed_before:
        if n not in want:
            servers.pop(n, None)
    servers.update(want)
    new = dict(data)
    if servers or "mcpServers" in data:
        new["mcpServers"] = servers
    return new


# ------------------------------------------------------------------------------------------ writing


def atomic_write(path, text, backup):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    mode = 0o600
    if os.path.exists(path):
        mode = os.stat(path).st_mode & 0o7777
        if backup:
            shutil.copy2(path, path + ".pmhwc-backup")
    tmp = "%s.new.%d" % (path, os.getpid())
    try:
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, mode)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.chmod(tmp, mode)
        os.replace(tmp, path)
    except BaseException:
        if os.path.exists(tmp):
            os.remove(tmp)
        raise


def change_summary(before, after):
    added = [n for n in after if n not in before]
    removed = [n for n in before if n not in after]
    changed = [n for n in after if n in before and before[n] != after[n]]
    parts = []
    for label, names in (("add", added), ("update", changed), ("remove", removed)):
        if names:
            parts.append("%s %s" % (label, ", ".join(names)))
    return "; ".join(parts) or "no server change"


def _inside(path, root):
    path, root = os.path.realpath(path), os.path.realpath(root)
    return path == root or path.startswith(root.rstrip(os.sep) + os.sep)


def owner_act_refusal(home_dir, targets, env, real_home):
    """An agent session may render only into a throwaway HOME: never the owner's real one, never an
    ancestor of it, and never a write target outside that HOME (CODEX_HOME, XDG_DATA_HOME and APPDATA
    all move targets). A speed bump keyed on environment markers, not a control."""
    if not any(env.get(v) for v in AGENT_ENV):
        return None
    why = ("writing harness configs outside a throwaway HOME is the owner's act (ADR-0017), and this process "
           "runs inside an agent session. Run it from your own terminal")
    if real_home and _inside(real_home, home_dir):
        return why + " (HOME is the real home, or contains it)"
    outside = [t for t in targets if not _inside(t, home_dir)]
    if outside:
        return why + " (%s is outside HOME)" % outside[0]
    return None


def real_home_dir():
    try:
        import pwd
        return pwd.getpwuid(os.getuid()).pw_dir
    except (ImportError, KeyError):
        return None


class Run:
    def __init__(self, mode, adopt):
        self.mode, self.adopt, self.status = mode, adopt, 0

    def raise_(self, code):
        self.status = max(self.status, code)

    def say(self, word, path, extra=""):
        print("%-7s %s%s" % (word, path, (" (%s)" % extra) if extra else ""))

    def refuse(self, path, msg, code):
        print("REFUSE  %s: %s" % (path, msg), file=sys.stderr)
        self.raise_(code)

    def apply(self, path, new_text, exists, summary, show):
        if self.mode == "check":
            self.say("DRIFT" if exists else "MISSING", path, summary)
            self.raise_(1)
        elif self.mode == "dry-run":
            print("WOULD WRITE %s (%s). Only this project's entries are shown, never a current value:" % (path, summary))
            print("----- begin %s" % path)
            sys.stdout.write(show)
            print("----- end %s" % path)
        else:
            atomic_write(path, new_text, backup=True)
            self.say("WROTE", path, summary + ("; previous version kept as .pmhwc-backup" if exists else ""))

    def launcher(self, ver):
        dest = launcher_dest()
        with open(LAUNCHER_SRC, encoding="utf-8") as fh:
            src = fh.read().split("\n", 1)
        text = "%s\n# %s; source: global/mcp/mcp-launch.sh; version: %s; do not edit, re-run the renderer\n%s" % (
            src[0], MARKER_ID, ver, src[1])
        if os.path.exists(dest):
            with open(dest, encoding="utf-8", errors="replace") as fh:
                current = fh.read()
            if MARKER_ID not in "".join(current.splitlines(keepends=True)[:5]):
                self.refuse(dest, "exists and is NOT managed by this project; move it aside. No surface was "
                                  "rendered, because every secret-bearing entry would execute that file", 3)
                return False
            if current == text and os.access(dest, os.X_OK):
                self.say("OK", dest)
                return True
        if self.mode == "check":
            self.say("DRIFT" if os.path.exists(dest) else "MISSING", dest)
            self.raise_(1)
        elif self.mode == "dry-run":
            print("WOULD WRITE %s (the credential launcher, %d bytes)" % (dest, len(text)))
        else:
            atomic_write(dest, text, backup=False)
            os.chmod(dest, 0o755)
            self.say("WROTE", dest)
        return True

    def codex(self, path, want):
        exists = os.path.exists(path)
        try:
            with open(path, encoding="utf-8") as fh:
                old_text = fh.read()
        except FileNotFoundError:
            old_text = ""
        except (OSError, UnicodeDecodeError) as e:
            return self.refuse(path, "unreadable (%s); left untouched" % e, 3)
        try:
            new_text, before = codex_plan(old_text, want)
        except Refuse as e:
            return self.refuse(path, str(e), e.code)
        if new_text == old_text:
            return self.say("OK", path, "%d managed server(s)" % len(want))
        summary = change_summary(before, want)
        self.apply(path, new_text, exists, summary, toml_block(want) if want else "(the managed block is removed)\n")

    def json_surface(self, surface, path, want, managed):
        exists = os.path.exists(path)
        if exists:
            try:
                with open(path, encoding="utf-8") as fh:
                    data = json.load(fh)
            except (OSError, ValueError) as e:
                self.refuse(path, "not readable JSON (%s); left untouched" % e, 3)
                return None
            if not isinstance(data, dict):
                self.refuse(path, "not a JSON object; left untouched", 3)
                return None
        else:
            data = {}
        before = managed.get(surface, [])
        try:
            new = json_plan(data, want, before, self.adopt)
        except Refuse as e:
            self.refuse(path, str(e), e.code)
            return None
        if new == data and (exists or not want):
            self.say("OK", path, "%d managed server(s)" % len(want))
            return list(want)
        current = data.get("mcpServers", {}) if isinstance(data.get("mcpServers"), dict) else {}
        old_ours = {n: current.get(n) for n in list(before) + list(want) if n in current}
        summary = change_summary(old_ours, want)
        if exists and self.mode == "dry-run":
            summary += "; the file is re-serialized (2-space JSON), so whitespace may change"
        self.apply(path, json.dumps(new, indent=2, ensure_ascii=False) + "\n", exists, summary,
                   json.dumps({"mcpServers": want}, indent=2, ensure_ascii=False) + "\n")
        return list(want) if self.mode == "install" else None


def load_manifest():
    try:
        with open(manifest_path(), encoding="utf-8") as fh:
            m = json.load(fh)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        raise Refuse(3, "the managed-server manifest %s is unreadable (%s)" % (manifest_path(), e))
    surfaces = m.get("surfaces", {}) if isinstance(m, dict) else None
    if not isinstance(surfaces, dict) or not all(isinstance(v, list) for v in surfaces.values()):
        raise Refuse(3, "the managed-server manifest %s has an unexpected shape" % manifest_path())
    return m.get("surfaces", {})


def render(mode, source, surfaces, adopt):
    if mode == "install":
        targets = [launcher_dest(), manifest_path()]
        targets += [t[0] for t in (surface_target(x) for x in surfaces) if t is not None]
        why = owner_act_refusal(home(), targets, os.environ, real_home_dir())
        if why:
            raise Refuse(2, why)
    if committable(source):
        raise Refuse(2, "%s is inside a git work tree and not ignored, so it could be committed. The definition "
                        "lives only in the untracked local overlay" % source)
    doc = load_source(source)
    ver = version()
    managed = load_manifest()
    run = Run(mode, adopt)
    launcher = launcher_dest()
    if any(s.get("secrets") for s in doc["servers"].values()) and not run.launcher(ver):
        return run.status
    new_manifest = dict(managed)
    for surface in surfaces:
        target = surface_target(surface)
        if target is None:
            print("SKIP    %s: no published app for this OS" % surface)
            continue
        path, installed_dir = target
        want = desired(doc, surface, launcher)
        if not os.path.isdir(installed_dir) and not os.path.exists(path):
            print("SKIP    %s: not installed (%s absent)" % (surface, installed_dir))
            continue
        if surface == "codex":
            run.codex(path, want)
        else:
            names = run.json_surface(surface, path, want, managed)
            if names is not None:
                new_manifest[surface] = names
        if surface != "codex" and any(src.startswith("env:") for n in want
                                      for src in doc["servers"][n].get("secrets", {}).values()):
            print("NOTE    %s: an env: secret depends on this app passing that variable to the launcher; "
                  "only Codex is told to (env_vars)" % surface)
    if mode == "install" and new_manifest != managed:
        atomic_write(manifest_path(), json.dumps({"version": 1, "surfaces": new_manifest}, indent=2) + "\n", backup=False)
    return run.status


# --------------------------------------------------------------------------------------------- scan


def scan_server(server):
    """Yield the locations (never values) inside one server entry that look like a credential."""
    if not isinstance(server, dict):
        return

    def walk(obj, path):
        if isinstance(obj, dict):
            for k, v in obj.items():
                p = "%s.%s" % (path, k) if path else str(k)
                if k in ("env", "args", "url"):
                    continue
                if isinstance(v, str) and v and CRED_RE.search(str(k)):
                    yield p
                else:
                    yield from walk(v, p)
    env = server.get("env")
    if isinstance(env, dict):
        for k, v in env.items():
            if isinstance(v, str) and v and (CRED_RE.search(str(k)) or looks_like_credential_value(v)):
                yield "env.%s" % k
    args = server.get("args")
    if isinstance(args, list):
        for i, a in enumerate(args):
            m = ARG_FLAG_RE.match(a) if isinstance(a, str) else None
            if isinstance(a, str) and looks_like_credential_value(a):
                yield "args[%d] <credential-looking value>" % i
            elif m and CRED_RE.search(m.group(1)):
                if m.group(2) and len(m.group(2)) > 1:
                    yield "args[%d] %s=<value>" % (i, m.group(1))
                elif i + 1 < len(args) and isinstance(args[i + 1], str) and not args[i + 1].startswith("-"):
                    yield "args[%d] %s <value>" % (i, m.group(1))
    url = server.get("url")
    if isinstance(url, str) and URL_CRED_RE.search(url):
        yield "url (userinfo or a credential-like query parameter)"
    yield from walk(server, "")


def scan(surfaces):
    found = 0
    for surface in surfaces:
        target = surface_target(surface)
        if target is None:
            continue
        folder, base = os.path.split(target[0])
        if os.path.isdir(folder):
            for f in sorted(os.listdir(folder)):
                if re.fullmatch(re.escape(base) + r"\.new\.[0-9]+", f):
                    found += 1
                    print("%s\ttemp\t%s\t-\ta leftover temporary copy of the config (delete it)" % (
                        surface, os.path.join(folder, f)))
        for path, kind in ((target[0], "config"), (target[0] + ".pmhwc-backup", "backup")):
            if not os.path.exists(path):
                continue
            try:
                if surface == "codex":
                    if tomllib is None:
                        print("SKIP    %s: needs Python 3.11+ (tomllib)" % path)
                        continue
                    with open(path, "rb") as fh:
                        servers = tomllib.load(fh).get("mcp_servers", {})
                else:
                    with open(path, encoding="utf-8") as fh:
                        servers = json.load(fh).get("mcpServers", {})
            except Exception as e:  # report the failure class only; a parser message can quote content
                print("SKIP    %s: unreadable (%s)" % (path, type(e).__name__))
                continue
            if not isinstance(servers, dict):
                continue
            for name, server in servers.items():
                for loc in scan_server(server):
                    found += 1
                    print("%s\t%s\t%s\t%s\t%s" % (surface, kind, path, name, loc))
    print("%d credential-looking key(s) found. Key names only: no value was printed. Move each value to the "
          "Keychain (security add-generic-password -s <service> -a \"$USER\" -w, typed at the prompt), "
          "reference it under \"secrets\", remove the plain-text entry, delete the .pmhwc-backup files, "
          "and rotate the credential: it has been on disk in plain text." % found)
    return 0


# --------------------------------------------------------------------------------------------- main


def main(argv):
    mode, adopt, source, surfaces = "install", False, None, list(SURFACES)
    for a in argv:
        if a in ("--dry-run", "--check", "--scan"):
            mode = a[2:]
        elif a == "--adopt":
            adopt = True
        elif a.startswith("--source="):
            source = a[len("--source="):]
        elif a.startswith("--surfaces="):
            surfaces = [x for x in a[len("--surfaces="):].split(",") if x]
            bad = [x for x in surfaces if x not in SURFACES]
            if bad or not surfaces:
                print("unknown surface(s): %s (known: %s)" % (", ".join(bad) or "none given", ", ".join(SURFACES)),
                      file=sys.stderr)
                return 2
        elif a in ("-h", "--help"):
            print(__doc__)
            return 0
        else:
            print("unknown argument: %s" % a, file=sys.stderr)
            return 2
    try:
        if mode == "scan":
            if any(os.environ.get(v) for v in AGENT_ENV):
                raise Refuse(2, "--scan is owner-run only (ADR-0017): it reads the real configs that may hold "
                                "credentials, and this process runs inside an agent session")
            return scan(surfaces)
        return render(mode, source or default_source(), surfaces, adopt)
    except Refuse as e:
        print(str(e), file=sys.stderr)
        return e.code


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
