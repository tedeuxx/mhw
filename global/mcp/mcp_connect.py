"""The MCP connection check (Issue #219, ADR-0041 amendment of 2026-10-24): start each server of the
declared active set as each agent harness has it configured, and say whether it answers an MCP
initialize.

    mcp_render.py --active --mode=connect [--timeout=SECONDS] [--source=FILE]
    mhw status --mcp-connect[=SECONDS]

Opt-in, never part of the default status: starting a server has side effects (a package fetch, a sign-in
prompt, a process) and costs time. Per server and agent harness where it is enabled:

    stdio       the configured command, args and env, spawned as the agent harness would (a secret-bearing
                server through mcp-launch.sh, which reads the secret itself; this probe never reads one).
                One initialize request on stdin; ok on the matching result, "fail: error response" on the
                matching error, "fail: exited <code>" or "fail: timeout" otherwise. Then the process is
                killed.
    http        a POST of the initialize request with a client User-Agent and no configured header (a
                header can carry a credential, and this probe sends none): 2xx is ok, 401 with
                WWW-Authenticate is "needs login" (reachable), anything else, or a network error, fails.
    sse         a GET of the event stream, headers only: 2xx is ok, 401 as above.

One line per server per agent harness, its name and its result. Never stderr, never a response body,
never a URL or a command: they can carry values. Exit 1 when a set member fails, 0 otherwise.
Only the set members are checked: the policy server and the exempt ones are not started (a policy server
fetches a package at every start, and an exempt one belongs to its app).
"""
import json
import os
import re
import selectors
import subprocess
import sys
import time
import urllib.error
import urllib.request

import mcp_render as r

TAG = "(MCP connect)"
DEFAULT_TIMEOUT = 30
USER_AGENT = "mhw-mcp-connect/1 (+%s)" % r.PROJECT
INITIALIZE = {"jsonrpc": "2.0", "id": 1, "method": "initialize",
              "params": {"protocolVersion": "2025-06-18", "capabilities": {},
                         "clientInfo": {"name": "mhw-mcp-connect", "version": "1"}}}
VAR_RE = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}")


def expand(value, env):
    """${VAR} and ${VAR:-default}, as Claude Code and Kiro expand a configured value."""
    return VAR_RE.sub(lambda m: env.get(m.group(1)) or (m.group(2) or ""), value)


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as fh:
            data = json.load(fh)
    except (OSError, ValueError):
        return None
    return data if isinstance(data, dict) else None


def configured(surface):
    """name -> the entry this agent harness has, enabled only; None when its file cannot be read."""
    target = r.surface_target(surface)
    if target is None or not os.path.exists(target[0]):
        return {}
    if surface == "codex":
        if r.tomllib is None:
            return None
        try:
            with open(target[0], "rb") as fh:
                servers = r.tomllib.load(fh).get("mcp_servers", {})
        except (OSError, r.tomllib.TOMLDecodeError):
            return None
        off = "enabled", False
    else:
        data = _read_json(target[0])
        if data is None:
            return None
        servers = data.get("mcpServers", {})
        off = ("disabled", True) if surface == "kiro" else (None, None)
    if not isinstance(servers, dict):
        return None
    return {n: s for n, s in servers.items() if isinstance(s, dict) and (off[0] is None or s.get(off[0]) is not off[1])}


def _stdio_command(surface, entry):
    """(argv, env) for a stdio entry, or None when it has no command."""
    command, args = entry.get("command"), entry.get("args", [])
    if not isinstance(command, str) or not command or not isinstance(args, list):
        return None
    env = dict(os.environ)
    extra = entry.get("env") if isinstance(entry.get("env"), dict) else {}
    expanding = surface in ("claude-code", "kiro")
    for k, v in extra.items():
        env[str(k)] = expand(str(v), env) if expanding else str(v)
    argv = [command] + [str(a) for a in args]
    if expanding:
        argv = [expand(a, env) for a in argv]
    return argv, env


def probe_stdio(argv, env, timeout):
    """-> "ok" or "fail: ...". stderr is discarded; stdout is parsed for the matching response only."""
    try:
        p = subprocess.Popen(argv, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                             env=env, cwd=r.home(), start_new_session=True)
    except OSError:
        return "fail: could not start"
    try:
        try:
            p.stdin.write((json.dumps(INITIALIZE) + "\n").encode())
            p.stdin.flush()
        except OSError:
            pass  # it exited before reading: reported below from its exit code
        return _await_response(p, time.monotonic() + timeout)
    finally:
        _stop(p)


def _await_response(p, deadline):
    sel = selectors.DefaultSelector()
    sel.register(p.stdout, selectors.EVENT_READ)
    buf = b""
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            return "fail: timeout"
        if not sel.select(timeout=min(left, 0.5)):
            if p.poll() is not None:
                return "fail: exited %d" % p.returncode
            continue
        chunk = os.read(p.stdout.fileno(), 65536)
        if not chunk:
            return "fail: exited %d" % _wait(p, deadline)
        buf += chunk
        lines = buf.split(b"\n")
        buf = lines.pop()
        for line in lines:
            verdict = _verdict(line)
            if verdict:
                return verdict


def _verdict(line):
    try:
        m = json.loads(line)
    except ValueError:
        return None
    if not isinstance(m, dict) or m.get("id") != INITIALIZE["id"]:
        return None
    return "ok" if "result" in m else "fail: error response"


def _wait(p, deadline):
    try:
        return p.wait(timeout=max(deadline - time.monotonic(), 0.1))
    except subprocess.TimeoutExpired:
        return -1


def _stop(p):
    """Kill the server's whole process group, always: a leader that exited first can leave a child behind
    in its group (start_new_session gave the group the leader's pid, which stays the group's id while a
    member lives). An empty group is not an error."""
    try:
        os.killpg(p.pid, 9)
    except (ProcessLookupError, PermissionError):
        pass
    except (OSError, AttributeError):
        if p.poll() is None:
            p.kill()
    try:
        p.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass
    for stream in (p.stdin, p.stdout):
        try:
            stream.close()
        except OSError:
            pass


def probe_http(url, kind, timeout):
    """-> "ok", "needs login" or "fail: ...". Only the status line and one header name are read."""
    if kind == "sse":
        req = urllib.request.Request(url, method="GET", headers={"Accept": "text/event-stream",
                                                                  "User-Agent": USER_AGENT})
    else:
        req = urllib.request.Request(url, data=json.dumps(INITIALIZE).encode(), method="POST", headers={
            "Content-Type": "application/json", "Accept": "application/json, text/event-stream",
            "User-Agent": USER_AGENT})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:  # nosec: the owner's own configured server
            code = resp.status
    except urllib.error.HTTPError as e:
        code = e.code
        if code == 401 and e.headers.get("WWW-Authenticate"):
            e.close()
            return "needs login"
        e.close()
    except (urllib.error.URLError, OSError, ValueError):
        return "fail: unreachable"
    return "ok" if 200 <= code < 300 else "fail: http %d" % code


def probe(surface, entry, timeout):
    url = entry.get("url")
    kind = entry.get("type") or entry.get("transport") or ("http" if isinstance(url, str) else "stdio")
    if isinstance(url, str) and url:
        url = expand(url, os.environ) if surface in ("claude-code", "kiro") else url
        return probe_http(url, "sse" if kind == "sse" else "http", timeout)
    spawn = _stdio_command(surface, entry)
    if spawn is None:
        return "fail: no command or URL"
    return probe_stdio(spawn[0], spawn[1], timeout)


def main(aset, timeout=DEFAULT_TIMEOUT):
    """-> exit code: 1 when a set member fails, 0 otherwise (an undeclared set has nothing to check)."""
    if sys.platform == "win32":
        print("SKIP    MCP connect: not available on Windows %s" % TAG)
        return 0
    if not aset.declared:
        print("SKIP    MCP connect: no active set is declared, so there is nothing to check %s" % TAG)
        return 0
    status = 0
    for surface in r.SURFACES:
        servers = configured(surface)
        if servers is None:
            print("SKIP    %s: its configuration could not be read %s" % (surface, TAG))
            continue
        members = sorted(n for n in aset.servers if n in servers)
        for n in members:
            result = probe(surface, servers[n], timeout)
            print("%-7s %s: %s: %s %s" % ("OK" if not result.startswith("fail") else "FAIL", surface, n, result, TAG))
            if result.startswith("fail"):
                status = 1
        if not members and r.surface_target(surface) is not None and os.path.exists(r.surface_target(surface)[0]):
            print("NOTE    %s: no set member is enabled here %s" % (surface, TAG))
    return status
