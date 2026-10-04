#!/usr/bin/env python3
"""User-level stale-session guard. Stores opaque fingerprints, never configuration contents.

Native SessionStart(startup) establishes a baseline. The project is anchored on the harness's own
session-stable project directory (Claude Code CLAUDE_PROJECT_DIR), not on the hook's current working
directory, so a `cd` inside a session cannot change what is compared. Only an aggregate hash is stored.
PreToolUse denies missing/changed baselines for every tool that can act; read-only tools and simple
read-only shell commands still pass, with a notice, so a stale session can always be diagnosed.
Resume, clear and compaction never authorize a new baseline. Python 3.9+, no dependencies.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shlex
import sys
import tempfile

MESSAGE = "Reinício necessário. Interrompa o trabalho e abra uma nova sessão; não use resume, clear ou compact como substituto. Nenhum conteúdo de configuração foi registrado."
REASONS = {
    "missing_baseline": "Referência de início ausente para esta sessão; a execução do SessionStart não foi comprovada.",
    "fingerprint_mismatch": "O fingerprint agregado diverge da referência. O estado não permite identificar qual path mudou.",
    "invalid_baseline": "A referência de início está inválida; não foi substituída.",
    "invalid_session": "O evento não forneceu um identificador de sessão válido.",
    "unsafe_state": "O local de estado é um link simbólico; acesso recusado.",
    "guard_error": "Não foi possível verificar ou gravar a referência de início.",
}
READ_NOTICE = "leitura permitida para diagnóstico; ações que alteram algo seguem bloqueadas até uma nova sessão."
ALLOWED = ("baseline_created", "baseline_match", "ignored")
NATIVE = {
    "claude-code": (".claude", ["CLAUDE.md", "settings.json", "settings.local.json", "agents", "commands", "hooks", "skills", "plugins/installed_plugins.json"]),
    "codex": (".codex", ["AGENTS.md", "config.toml", "hooks.json", "rules", "skills"]),
    "kiro-cli": (".kiro", ["settings", "agents", "steering", "prompts", "hooks"]),
}
READ_TOOLS = {"Read", "Grep", "Glob", "LS", "NotebookRead", "TodoWrite", "AskUserQuestion"}
READ_COMMANDS = {"cat", "ls", "head", "tail", "wc", "grep", "rg", "pwd", "stat", "find", "git"}
GIT_READS = {"status", "diff", "log", "show", "rev-parse"}
SHELL_META = set(";|&<>$`\\\n\r")
# Arguments that turn a reading command into one that writes or executes.
# Matched as prefixes: "-exec" also covers "-execdir", "-ok" covers "-okdir", "-fprint" its variants.
UNSAFE_ARGS = ("-exec", "-ok", "-delete", "-fprint", "-fls", "--output", "--pre", "--ext-diff")
MANAGED = ["hitl-escalation-guard.sh", "hitl.conf", "clipboard_guard.py", "clipboard.conf", "paste_wrapper.py", "restart_guard.py", "breaking_glass.py"]


def switch_state(layer):
    """Breaking-glass switch (ADR-0024) from the sibling module; if it cannot load, the layer stays on."""
    here = os.path.dirname(os.path.abspath(__file__))
    if not os.path.isfile(os.path.join(here, "breaking_glass.py")):
        return False, ""
    sys.path.insert(0, here)
    try:
        import breaking_glass
        return breaking_glass.layer_state(layer)
    except Exception:
        return False, ""
    finally:
        sys.path.pop(0)


def with_switches(event, result, state):
    """Apply the restart-guard switch, and announce every switched-off layer at SessionStart."""
    off, note = state
    name = event.get("hook_event_name")
    if off and name in ("SessionStart", "PreToolUse"):
        result = {}
    if note and name == "SessionStart":
        result = dict(result, systemMessage=(result.get("systemMessage", "") + " " + note).strip())
    return result


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def workspace(cwd):
    current = Path(cwd).resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists():
            return candidate
    return current


def project_anchor(harness):
    """Claude Code sets CLAUDE_PROJECT_DIR for the whole session. Codex documents no equivalent; its
    shell commands run as separate processes, so its hook working directory does not follow a `cd`."""
    anchor = os.environ.get("CLAUDE_PROJECT_DIR") if harness == "claude-code" else None
    if anchor and Path(anchor).is_absolute() and Path(anchor).is_dir():
        return Path(anchor)
    return Path.cwd()


def watched(harness, cwd, home, data):
    folder, names = NATIVE[harness]
    user = Path(os.environ.get("CODEX_HOME", str(home / folder))) if harness == "codex" else home / folder
    root = workspace(cwd)
    # Include nested project settings up to the repository root; no file contents are read.
    project_dirs = []
    current = Path(cwd).resolve()
    while True:
        project_dirs.append(current)
        if current == root or current.parent == current:
            break
        current = current.parent
    paths = [user / name for name in names] + [data / name for name in MANAGED]
    for directory in project_dirs:
        paths += [directory / folder / name for name in names]
        paths += [directory / "AGENTS.md", directory / "CLAUDE.md", directory / "workspace/session-policy.json"]
    return paths


def read_only(event):
    """True for a tool call that cannot change anything: a read tool, or one simple read command."""
    tool = event.get("tool_name")
    if tool in READ_TOOLS:
        return True
    if tool != "Bash":
        return False
    command = (event.get("tool_input") or {}).get("command") if isinstance(event.get("tool_input"), dict) else None
    if not isinstance(command, str) or not command.strip() or SHELL_META & set(command):
        return False
    try:
        words = shlex.split(command)
    except ValueError:
        return False
    if not words or words[0] not in READ_COMMANDS:
        return False
    if any(word.startswith(UNSAFE_ARGS) for word in words[1:]):
        return False
    return words[0] != "git" or (len(words) > 1 and words[1] in GIT_READS)


def fingerprint(paths):
    records = []
    for path in sorted(set(paths)):
        children = [path]
        if path.is_dir() and not path.is_symlink():
            children += sorted(path.rglob("*"))
        for child in children:
            try:
                info = child.lstat()
                records.append((str(child), info.st_mtime_ns, info.st_size, info.st_ino, info.st_mode))
            except FileNotFoundError:
                records.append((str(child), None))
    return digest(json.dumps(records))


def evaluate(event, harness, home, data, cwd=None, create_baseline=True):
    name = event.get("hook_event_name")
    if name not in ("SessionStart", "PreToolUse"):
        return "ignored"
    session = event.get("session_id")
    # Never probe a path supplied in stdin. The harness's session-stable project directory wins over
    # the hook process's working directory, which follows a `cd` in a persistent shell.
    cwd = project_anchor(harness) if cwd is None else cwd
    if not isinstance(session, str) or not session:
        return "invalid_session"
    state_dir = data / "restart-state"
    if state_dir.is_symlink():
        return "unsafe_state"
    state = state_dir / (harness + "-" + digest(session) + ".json")
    if state.is_symlink():
        return "unsafe_state"
    if create_baseline and name == "SessionStart" and event.get("source") == "startup" and not state.exists():
        current = fingerprint(watched(harness, cwd, home, data))
        state_dir.mkdir(parents=True, exist_ok=True, mode=0o700)
        temporary = None
        try:
            with tempfile.NamedTemporaryFile(mode="w", dir=state_dir, delete=False) as stream:
                temporary = Path(stream.name)
                json.dump({"fingerprint": current}, stream)
            os.replace(temporary, state)
        finally:
            if temporary and temporary.exists():
                temporary.unlink()
        return "baseline_created"
    if not state.exists():
        return "missing_baseline"
    try:
        saved = json.loads(state.read_text(encoding="utf-8"))
    except (ValueError, UnicodeError):
        return "invalid_baseline"
    value = saved.get("fingerprint") if isinstance(saved, dict) else None
    if not isinstance(value, str) or len(value) != 64 or any(c not in "0123456789abcdef" for c in value):
        return "invalid_baseline"
    current = fingerprint(watched(harness, cwd, home, data))
    return "baseline_match" if value == current else "fingerprint_mismatch"


def inspect(event, harness, home, data, cwd=None):
    """Read-only comparison: cannot establish a baseline, even for a startup event."""
    return evaluate(event, harness, home, data, cwd, create_baseline=False)


def decide(event, harness, home, data, cwd=None):
    """Boolean interface for the shared core tests; native output uses the reason code."""
    status = evaluate(event, harness, home, data, cwd)
    return None if status == "ignored" else status in ALLOWED


def output(event, status):
    if status in ("baseline_created", "baseline_match") and event.get("hook_event_name") == "SessionStart":
        return {"systemMessage": "Restart guard: " + status + "."}
    if status in ALLOWED:
        return {}
    message = "Restart guard [" + status + "]: " + REASONS[status] + " " + MESSAGE
    if event.get("hook_event_name") == "PreToolUse" and read_only(event):
        return {"systemMessage": "Restart guard [" + status + "]: " + READ_NOTICE}
    if event.get("hook_event_name") == "PreToolUse":
        return {"systemMessage": message, "hookSpecificOutput": {
            "hookEventName": "PreToolUse", "permissionDecision": "deny", "permissionDecisionReason": message}}
    return {"continue": False, "stopReason": message, "systemMessage": message}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--harness", required=True, choices=NATIVE)
    parser.add_argument("--diagnose", action="store_true", help="Read-only status for session_id on stdin; never creates or resets state")
    args = parser.parse_args()
    event = {}
    try:
        event = json.load(sys.stdin)
        if not isinstance(event, dict):
            event = {}
        home = Path.home()
        data = Path(os.environ.get("XDG_DATA_HOME", str(home / ".local/share"))) / "personal-multi-harness-workstation-configuration"
        if args.diagnose:
            event = {"hook_event_name": "PreToolUse", "session_id": event.get("session_id")}
        status = evaluate(event, args.harness, home, data, create_baseline=not args.diagnose)
    except (OSError, ValueError, KeyError, RecursionError):
        status = "guard_error"
    if args.diagnose:
        print(json.dumps({"status": status}))
        return 0 if status == "baseline_match" else 1
    result = with_switches(event, output(event, status), switch_state("restart-guard"))
    if result:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
